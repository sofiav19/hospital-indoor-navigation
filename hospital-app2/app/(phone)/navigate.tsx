import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, TextInput, PanResponder, Platform, Linking, Alert } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Speech from "expo-speech";
import { useNavStore } from "../../store/navStore";
import IndoorMap from "../../components/map/IndoorMap";
import { computeRoute } from "../../lib/route/routeEngine";
import {
  buildDetailedInstruction as buildSharedDetailedInstruction,
  formatInstructionForSpeech,
  getHeadingFromSegment,
  getImmediateTurnTitle,
  getSegmentTurnHint,
  isCrossFloorSegment,
  segmentTouchesFloor,
} from "../../lib/route/navigationInstructions";
import {
  distanceMeters,
  getHeadingValue,
  getNodeFeature,
  getNodeRole,
  smoothHeading,
} from "../../lib/route/routeHelpers";
import { HOSPITAL_DIRECTORY, normalizeSearchValue } from "../../lib/hospitalDirectory";
import { AppPalette, useAppAppearance } from "../../constants/theme";
import { projectCoordsForMap, projectGeoJSONForMap } from "../../lib/coords/localToLngLat";
import { trackEvent } from "../../lib/monitoring";

let LocationImpl: any = null;

try {
  LocationImpl = require("expo-location");
} catch {
  LocationImpl = null;
}

const NODE_CONFIRM_RADIUS_METERS = 0.55;
const REROUTE_SNAP_RADIUS_METERS = 1.25;
const STEP_TARGET_RADIUS_METERS = 0.3;
const TRANSITION_STEP_TARGET_RADIUS_METERS = 0.75;
const STEP_PROGRESS_MIN = 0.992;
const STEP_PROGRESS_WITH_RADIUS_MIN = 0.97;
const TURN_PROMPT_PROGRESS_MIN = 0.62;
const TURN_PROMPT_DISTANCE_METERS = 1.4;
const STEP_PROGRESS_RADIUS_METERS = 0.85;
const SEGMENT_TUBE_RADIUS_METERS = 1.1;
const OFF_ROUTE_RADIUS_METERS = 2.1;
const ARRIVAL_COMPLETE_RADIUS_METERS = 1.0;
const TRANSITION_ZONE_RADIUS_METERS = 2.0;
const OUTDOOR_HANDOFF_THRESHOLD_METERS = 12;
const FONT_TITLE = Platform.select({ ios: "SF Pro Display", default: "sans-serif-medium" });
const FONT_BODY = Platform.select({ ios: "Inter", default: "sans-serif" });

function distanceToPolyline(point: [number, number], coords: [number, number][]) {
  if (!Array.isArray(coords) || coords.length < 2) return Infinity;

  let bestDistanceSq = Infinity;

  for (let i = 1; i < coords.length; i++) {
    const start = coords[i - 1];
    const end = coords[i];
    const segX = end[0] - start[0];
    const segY = end[1] - start[1];
    const segLenSq = segX * segX + segY * segY;

    if (segLenSq <= 0) continue;

    const tRaw =
      ((point[0] - start[0]) * segX + (point[1] - start[1]) * segY) / segLenSq;
    const t = Math.max(0, Math.min(1, tRaw));
    const projX = start[0] + segX * t;
    const projY = start[1] + segY * t;
    const dx = point[0] - projX;
    const dy = point[1] - projY;
    const distSq = dx * dx + dy * dy;

    if (distSq < bestDistanceSq) bestDistanceSq = distSq;
  }

  return Math.sqrt(bestDistanceSq);
}


function getNearestNodeId(
  nodes: any,
  point: [number, number],
  floor: number | null,
  allowedIds?: Set<string>,
  maxDistanceMeters?: number
) {
  const features = nodes?.features || [];
  const hasAllowedIds = Boolean(allowedIds?.size);

  const pickClosest = (predicate: (feature: any) => boolean) => {
    let bestId: string | null = null;
    let bestDistance = Infinity;

    for (const feature of features) {
      if (!predicate(feature)) continue;

      const coords = feature?.geometry?.coordinates;
      if (!coords) continue;

      const dist = distanceMeters(point, coords);
      if (typeof maxDistanceMeters === "number" && dist > maxDistanceMeters) continue;

      if (dist < bestDistance) {
        bestDistance = dist;
        bestId = feature.properties?.id || null;
      }
    }

    return bestId;
  };

  const baseCandidate = (feature: any) => {
    return Boolean(feature?.properties?.id);
  };

  const sameFloorCandidate = (feature: any) => {
    if (!baseCandidate(feature)) return false;
    if (floor === null) return true;
    return (feature?.properties?.floor ?? null) === floor;
  };

  return (
    (hasAllowedIds
      ? pickClosest((feature) => sameFloorCandidate(feature) && Boolean(allowedIds?.has(feature?.properties?.id)))
      : null) ||
    pickClosest(sameFloorCandidate) ||
    pickClosest(baseCandidate)
  );
}

function getProgressAlongPolyline(point: [number, number], coords: [number, number][]) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;

  let totalLength = 0;
  let bestDistanceSq = Infinity;
  let bestProgress = 0;
  let traversedLength = 0;

  for (let i = 1; i < coords.length; i++) {
    totalLength += distanceMeters(coords[i - 1], coords[i]);
  }

  if (totalLength <= 0) return 0;

  for (let i = 1; i < coords.length; i++) {
    const start = coords[i - 1];
    const end = coords[i];
    const segX = end[0] - start[0];
    const segY = end[1] - start[1];
    const segLenSq = segX * segX + segY * segY;
    const segLen = Math.sqrt(segLenSq);

    if (segLenSq <= 0) continue;

    const tRaw =
      ((point[0] - start[0]) * segX + (point[1] - start[1]) * segY) / segLenSq;
    const t = Math.max(0, Math.min(1, tRaw));
    const projX = start[0] + segX * t;
    const projY = start[1] + segY * t;
    const dx = point[0] - projX;
    const dy = point[1] - projY;
    const distSq = dx * dx + dy * dy;

    if (distSq < bestDistanceSq) {
      bestDistanceSq = distSq;
      bestProgress = (traversedLength + segLen * t) / totalLength;
    }

    traversedLength += segLen;
  }

  return bestProgress;
}

function getEquivalentNodeIdOnFloor(
  nodes: any,
  nodeId: string | null,
  floor: number | null
) {
  if (!nodeId || floor === null) return null;

  const features = nodes?.features || [];
  const sourceFeature = features.find((feature: any) => feature?.properties?.id === nodeId) || null;
  if (!sourceFeature) return null;

  const sourceCoords = sourceFeature?.geometry?.coordinates;
  if (!Array.isArray(sourceCoords) || sourceCoords.length < 2) return null;

  const sourceRole = sourceFeature?.properties?.role ?? null;
  const sourceLabel = sourceFeature?.properties?.label ?? null;

  const exactMatch = features.find((feature: any) => {
    const coords = feature?.geometry?.coordinates;
    return (
      feature?.properties?.floor === floor &&
      feature?.properties?.role === sourceRole &&
      feature?.properties?.label === sourceLabel &&
      Array.isArray(coords) &&
      coords[0] === sourceCoords[0] &&
      coords[1] === sourceCoords[1]
    );
  });

  if (exactMatch?.properties?.id) return exactMatch.properties.id;

  const coordMatch = features.find((feature: any) => {
    const coords = feature?.geometry?.coordinates;
    return (
      feature?.properties?.floor === floor &&
      Array.isArray(coords) &&
      coords[0] === sourceCoords[0] &&
      coords[1] === sourceCoords[1]
    );
  });

  return coordMatch?.properties?.id || null;
}

function isNodeOnFloor(nodes: any, nodeId: string | null, floor: number | null) {
  if (!nodeId || floor === null) return false;
  const feature = (nodes?.features || []).find((f: any) => f?.properties?.id === nodeId);
  return (feature?.properties?.floor ?? null) === floor;
}

function getNodeLabel(nodes: any, nodeId: string | null) {
  const directoryLabel =
    HOSPITAL_DIRECTORY.find((entry) => entry.destinationNodeId === nodeId)?.name || null;
  return directoryLabel || getNodeFeature(nodes, nodeId)?.properties?.label || null;
}

function getInstructionIconName(maneuver?: string | null) {
  switch (maneuver) {
    case "left":
      return "arrow-left-top-bold";
    case "right":
      return "arrow-right-top-bold";
    case "left-forward":
      return "arrow-left-top-bold";
    case "right-forward":
      return "arrow-right-top-bold";
    case "down":
      return "stairs-down";
    case "up":
      return "stairs-up";
    case "arrive":
      return "map-marker-check";
    case "forward":
    default:
      return "arrow-up";
  }
}

export default function Navigate() {
  const { palette } = useAppAppearance();
  const [showSteps, setShowSteps] = useState(false);
  const [showStartDropdown, setShowStartDropdown] = useState(false);
  const [showCurrentLocationFloorPrompt, setShowCurrentLocationFloorPrompt] = useState(false);
  const [showOutdoorHandoffPopup, setShowOutdoorHandoffPopup] = useState(true);
  const [startQuery, setStartQuery] = useState("");
  const [confirmedNodeId, setConfirmedNodeId] = useState<string | null>(null);
  const [lastPassedNodeId, setLastPassedNodeId] = useState<string | null>(null);
  const [isFollowingUser, setIsFollowingUser] = useState(false);
  const [lockedHeading, setLockedHeading] = useState(0);
  const [committedFloorLock, setCommittedFloorLock] = useState<number | null>(null);
  const [transitionFloorLock, setTransitionFloorLock] = useState<number | null>(null);
  const [hasManualFloorSelection, setHasManualFloorSelection] = useState(false);
  const [showRerouteNotice, setShowRerouteNotice] = useState(false);
  const [routePreferenceNotice, setRoutePreferenceNotice] = useState<string | null>(null);
  const [recenterTick, setRecenterTick] = useState(0);
  const [isManualMapControl, setIsManualMapControl] = useState(false);
  const [sensorHeading, setSensorHeading] = useState<number | null>(null);
  const [smoothedLiveHeading, setSmoothedLiveHeading] = useState<number | null>(null);
const [recenterHeading, setRecenterHeading] = useState(0);
const [recenterRequestedAt, setRecenterRequestedAt] = useState(0);
  const lastSpokenInstructionKeyRef = useRef<string | null>(null);

  const insets = useSafeAreaInsets();

  const navData = useNavStore((s) => s.navData);
  const start = useNavStore((s) => s.start);
  const postNavStartOverrideId = useNavStore((s) => s.postNavStartOverrideId);
  const livePosition = useNavStore((s) => s.livePosition);
  const setStartNode = useNavStore((s) => s.setStartNode);
  const clearPostNavStartOverride = useNavStore((s) => s.clearPostNavStartOverride);
  const destinationId = useNavStore((s) => s.destinationId);
  const route = useNavStore((s) => s.route);
  const setRoute = useNavStore((s) => s.setRoute);

  const isStarted = useNavStore((s) => s.navigationUi.isStarted);
  const prefer = useNavStore((s) => s.navigationUi.prefer);
  const soundEnabled = useNavStore((s) => s.navigationUi.soundEnabled);
  const activeStepIndex = useNavStore((s) => s.navigationUi.activeStepIndex);
  const navigationFloor = useNavStore((s) => s.navigationUi.navigationFloor);
  const routeStartedAtMs = useNavStore((s) => s.navigationUi.routeStartedAtMs);

  const setNavigationStarted = useNavStore((s) => s.setNavigationStarted);
  const setNavigationPreference = useNavStore((s) => s.setNavigationPreference);
  const setMapViewMode = useNavStore((s) => s.setMapViewMode);
  const setSoundEnabled = useNavStore((s) => s.setSoundEnabled);
  const setActiveStepIndex = useNavStore((s) => s.setActiveStepIndex);
  const setNavigationFloor = useNavStore((s) => s.setNavigationFloor);
  const setLiveFloor = useNavStore((s) => s.setLiveFloor);

  const lastRerouteAtRef = useRef(0);
  const lastDestinationIdRef = useRef<string | null>(destinationId ?? null);
  const rerouteNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFollowRecenterAtRef = useRef(0);
  const lastFollowUserCoordRef = useRef<[number, number] | null>(null);
  const lastFollowStepIndexRef = useRef(-1);
  const hasShownLocationPrivacyNoteRef = useRef(false);

  const effectiveStartNodeId = postNavStartOverrideId || start.nodeId || "n_hospital_entrance_f0";
  const followsCurrentLocation = postNavStartOverrideId !== null || start.source !== "manual-node";

  useEffect(() => {
    setMapViewMode("navigate");
  }, [setMapViewMode]);

  const userCoord = useMemo(() => {
    if (!navData.nodes) return null;
    if (livePosition.provider !== "none" && livePosition.coords) {
      return livePosition.coords;
    }
    if (start.coords) return start.coords;

    const feature = navData.nodes.features?.find((item: any) => item.properties?.id === effectiveStartNodeId);
    return feature?.geometry?.coordinates || null;
  }, [effectiveStartNodeId, livePosition.coords, livePosition.provider, navData.nodes, start.coords]);

  const mapUserCoord = useMemo(() => {
    if (!userCoord) return null;
    return projectCoordsForMap(userCoord);
  }, [userCoord]);

  const optitrackHeading = useMemo(() => {
    const value =
      (livePosition as any)?.heading ??
      (livePosition as any)?.yawDegrees ??
      (livePosition as any)?.orientationDegrees ??
      null;

    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }, [livePosition]);

  const liveMapUserHeading = isStarted ? smoothedLiveHeading ?? lockedHeading : lockedHeading;

  const recenterToUser = useCallback(() => {
    const now = Date.now();
    setRecenterHeading(lockedHeading);
    setIsManualMapControl(false);
    setIsFollowingUser(true);
    lastFollowRecenterAtRef.current = now;
    lastFollowUserCoordRef.current = userCoord;
    lastFollowStepIndexRef.current = activeStepIndex;
    setRecenterRequestedAt(now);
    setRecenterTick((value) => value + 1);
  }, [activeStepIndex, lockedHeading, userCoord]);

  const startFeature = useMemo(
    () =>
      navData.nodes?.features?.find(
        (item: any) => item.properties?.id === effectiveStartNodeId
      ) || null,
    [effectiveStartNodeId, navData.nodes]
  );

  const destinationFeature = useMemo(
    () => navData.nodes?.features?.find((item: any) => item.properties?.id === destinationId) || null,
    [destinationId, navData.nodes]
  );
  const isAtDestination = useMemo(() => {
    if (!isStarted || !destinationFeature || !userCoord) return false;

    const destinationCoords = destinationFeature?.geometry?.coordinates;
    const destinationFloor = destinationFeature?.properties?.floor ?? null;
    const userFloor =
      livePosition.floor ??
      navigationFloor ??
      startFeature?.properties?.floor ??
      null;
    if (!Array.isArray(destinationCoords)) return false;

    if (
      destinationFloor !== null &&
      userFloor !== null &&
      destinationFloor !== userFloor
    ) {
      return confirmedNodeId === destinationId;
    }

    return (
      confirmedNodeId === destinationId ||
      distanceMeters(userCoord, destinationCoords as [number, number]) <= ARRIVAL_COMPLETE_RADIUS_METERS
    );
  }, [confirmedNodeId, destinationFeature, destinationId, isStarted, livePosition.floor, navigationFloor, startFeature, userCoord,]);

  const destinationDirectoryEntry = useMemo(
    () => HOSPITAL_DIRECTORY.find((entry) => entry.destinationNodeId === destinationId) || null,
    [destinationId]
  );

  const activeEntranceEntry = useMemo(
    () => HOSPITAL_DIRECTORY.find((entry) => entry.destinationNodeId === effectiveStartNodeId && entry.category === "entrances") || null,
    [effectiveStartNodeId]
  );

  const distanceToNearestEntrance = useMemo(() => {
    if (!livePosition.coords) return null;

    const entranceCoords = (navData.nodes?.features || [])
      .filter((feature: any) => feature.properties?.role === "doors")
      .map((feature: any) => feature.geometry?.coordinates)
      .filter((coords: any): coords is [number, number] => Array.isArray(coords) && coords.length >= 2);

    if (!entranceCoords.length) return null;

    return entranceCoords.reduce((best: number, coords: [number, number]) => {
      return Math.min(best, distanceMeters(livePosition.coords as [number, number], coords));
    }, Infinity);
  }, [livePosition.coords, navData.nodes]);

  const shouldShowOutdoorHandoff = useMemo(() => {
    return Boolean(
      !isStarted &&
      activeEntranceEntry?.street &&
      livePosition.coords &&
      typeof distanceToNearestEntrance === "number" &&
      Number.isFinite(distanceToNearestEntrance) &&
      distanceToNearestEntrance > OUTDOOR_HANDOFF_THRESHOLD_METERS
    );
  }, [activeEntranceEntry?.street, distanceToNearestEntrance, isStarted, livePosition.coords]);

  useEffect(() => {
    if (shouldShowOutdoorHandoff) {
      setShowOutdoorHandoffPopup(true);
    }
  }, [shouldShowOutdoorHandoff, destinationId]);

  const handleOpenGoogleMaps = useCallback(() => {
    if (!activeEntranceEntry) return;
    trackEvent("handoff.google_maps_opened", {
      entranceId: activeEntranceEntry.destinationNodeId,
      entranceName: activeEntranceEntry.name,
      street: activeEntranceEntry.street || null,
      destinationId,
    });
    const query = encodeURIComponent(
      `${activeEntranceEntry.name}, ${activeEntranceEntry.street}, Hospital Universitario Santa Teresa`
    );
    const url = `https://www.google.com/maps/search/?api=1&query=${query}`;
    Linking.openURL(url).catch((error) => {
      console.warn("[OutdoorHandoff] Failed to open Google Maps", error);
    });
  }, [activeEntranceEntry, destinationId]);

  const startNodeOptions = useMemo(() => {
    return HOSPITAL_DIRECTORY
      .filter((entry) => entry.category === "entrances")
      .map((entry) => ({
        id: entry.destinationNodeId,
        label: entry.name,
        floor: entry.floor,
      }))
      .filter((item: any) => Boolean(item.id));
  }, []);

  const searchedStartOptions = useMemo(() => {
    const q = normalizeSearchValue(startQuery);
    if (!q) return [];

    return HOSPITAL_DIRECTORY
      .map((entry) => ({
        id: entry.destinationNodeId,
        label: entry.name,
        floor: entry.floor,
        keywords: entry.keywords || [],
      }))
      .filter((item: any) => Boolean(item.id))
      .filter((item: any) => {
        const floorText = item.floor === null ? "" : `planta ${item.floor}`;
        const haystack = normalizeSearchValue(
          `${String(item.label)} ${String(item.id)} ${floorText} ${item.keywords.join(" ")}`
        );
        return haystack.includes(q);
      })
      .filter(
        (item: any, index: number, list: any[]) =>
          index ===
          list.findIndex(
            (candidate: any) =>
              candidate.id === item.id &&
              candidate.floor === item.floor
          )
      );
  }, [startQuery]);

  const currentLocationAvailable = useMemo(() => {
    return Boolean(userCoord && navData.nodes?.features?.length);
  }, [navData.nodes, userCoord]);

  const getNearestCurrentLocationNodeForFloor = useCallback(
    (floor: number) => {
      if (!userCoord || !navData.nodes?.features?.length) return null;

      const [userX, userY] = userCoord;
      let nearest: { id: string; label: string; floor: number | null } | null = null;
      let nearestDistanceSq = Infinity;

      for (const feature of navData.nodes.features || []) {
        if ((feature?.properties?.floor ?? null) !== floor) continue;
        const coords = feature?.geometry?.coordinates;
        if (!coords) continue;

        const dx = coords[0] - userX;
        const dy = coords[1] - userY;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq < nearestDistanceSq) {
          nearestDistanceSq = distanceSq;
          nearest = {
            id: feature.properties?.id,
            label: getNodeLabel(navData.nodes, feature.properties?.id) || feature.properties?.id || "Nodo",
            floor: feature.properties?.floor ?? null,
          };
        }
      }

      return nearest;
    },
    [navData.nodes, userCoord]
  );

  const renderedDestinationFeature = useMemo(
    () => navData.renderNodes?.features?.find((item: any) => item.properties?.id === destinationId) || null,
    [destinationId, navData.renderNodes]
  );

  const confirmedNodeFeature = useMemo(
    () => navData.nodes?.features?.find((item: any) => item.properties?.id === confirmedNodeId) || null,
    [confirmedNodeId, navData.nodes]
  );

  const segments = useMemo(
    () => route.summary?.instructionSegments || [],
    [route.summary?.instructionSegments]
  );

  const autoFloor = useMemo(() => {
    if (committedFloorLock !== null) return committedFloorLock;
    if (navigationFloor !== null && navigationFloor !== undefined) return navigationFloor;
    if (livePosition.floor !== null && livePosition.floor !== undefined) return livePosition.floor;
    if (confirmedNodeFeature?.properties?.floor !== undefined) return confirmedNodeFeature.properties.floor;
    if (route.summary?.startFloor !== undefined) return route.summary.startFloor;
    if (startFeature?.properties?.floor !== undefined) return startFeature.properties.floor;
    return null;
  }, [
    committedFloorLock,
    confirmedNodeFeature,
    livePosition.floor,
    navigationFloor,
    route.summary?.startFloor,
    startFeature,
  ]);

  const currentFloor = useMemo(() => {
    if (transitionFloorLock !== null) return transitionFloorLock;
    if (committedFloorLock !== null) return committedFloorLock;
    if (navigationFloor !== null && navigationFloor !== undefined) return navigationFloor;
    return autoFloor;
  }, [autoFloor, committedFloorLock, navigationFloor, transitionFloorLock]);

  const recenterTargetCoord = useMemo(() => {
    return mapUserCoord;
  }, [mapUserCoord]);

  const routingFloor = useMemo(() => {
    if (committedFloorLock !== null) return committedFloorLock;
    if (navigationFloor !== null && navigationFloor !== undefined) return navigationFloor;
    return autoFloor;
  }, [autoFloor, committedFloorLock, navigationFloor]);

  const routeNodeOrder = useMemo(() => {
    const order = new Map<string, number>();
    (route.summary?.nodePath || []).forEach((nodeId: string, index: number) => {
      order.set(nodeId, index);
    });
    return order;
  }, [route.summary?.nodePath]);

  const allowedSameFloorNodeIds = useMemo(() => {
    const allowedIds = new Set<string>();

    for (let i = activeStepIndex; i < segments.length; i++) {
      const segment = segments[i];
      const staysOnCurrentFloor =
        segment?.floor === currentFloor && segment?.toFloor === currentFloor;

      if (!staysOnCurrentFloor) {
        if (segment?.fromNodeId) allowedIds.add(segment.fromNodeId);
        if (segment?.toNodeId) allowedIds.add(segment.toNodeId);
        break;
      }

      if (segment?.fromNodeId) allowedIds.add(segment.fromNodeId);
      if (segment?.toNodeId) allowedIds.add(segment.toNodeId);
    }

    return allowedIds;
  }, [activeStepIndex, currentFloor, segments]);

  const forwardAllowedNodeIds = useMemo(() => {
    if (!allowedSameFloorNodeIds.size) return allowedSameFloorNodeIds;

    const confirmedIndex =
      confirmedNodeId && routeNodeOrder.has(confirmedNodeId)
        ? routeNodeOrder.get(confirmedNodeId) ?? -1
        : -1;

    const filtered = new Set<string>();

    for (const nodeId of allowedSameFloorNodeIds) {
      const nodeIndex = routeNodeOrder.get(nodeId);
      if (nodeIndex === undefined || nodeIndex >= confirmedIndex) {
        filtered.add(nodeId);
      }
    }

    if (confirmedNodeId) filtered.add(confirmedNodeId);

    return filtered;
  }, [allowedSameFloorNodeIds, confirmedNodeId, routeNodeOrder]);

  const currentInstructionNodeIds = useMemo(() => {
    const segment = segments[activeStepIndex];
    return new Set<string>((segment?.nodeIds || []).filter(Boolean));
  }, [activeStepIndex, segments]);

  const nodeSelectionFloor = useMemo(
    () => routingFloor ?? livePosition.floor ?? confirmedNodeFeature?.properties?.floor ?? null,
    [confirmedNodeFeature, livePosition.floor, routingFloor]
  );

  const nearbyAllowedNode = useMemo(() => {
    if (!userCoord || !navData.nodes || !forwardAllowedNodeIds.size) return null;

    let bestFeature: any = null;
    let bestDistance = Infinity;

    for (const feature of navData.nodes.features || []) {
      const nodeId = feature?.properties?.id;
      const nodeCoords = feature?.geometry?.coordinates;
      const nodeFloor = feature?.properties?.floor ?? null;

      if (!nodeId || !nodeCoords || !forwardAllowedNodeIds.has(nodeId)) continue;
      if (nodeSelectionFloor !== null && nodeFloor !== nodeSelectionFloor) continue;

      const dist = distanceMeters(userCoord, nodeCoords);
      if (dist <= NODE_CONFIRM_RADIUS_METERS && dist < bestDistance) {
        bestFeature = feature;
        bestDistance = dist;
      }
    }

    return bestFeature;
  }, [forwardAllowedNodeIds, navData.nodes, nodeSelectionFloor, userCoord]);

  const nearbyInstructionNode = useMemo(() => {
    if (!userCoord || !navData.nodes || !currentInstructionNodeIds.size) return null;

    let bestFeature: any = null;
    let bestDistance = Infinity;

    for (const feature of navData.nodes.features || []) {
      const nodeId = feature?.properties?.id;
      const nodeCoords = feature?.geometry?.coordinates;
      const nodeFloor = feature?.properties?.floor ?? null;

      if (!nodeId || !nodeCoords || !currentInstructionNodeIds.has(nodeId)) continue;
      if (nodeSelectionFloor !== null && nodeFloor !== nodeSelectionFloor) continue;

      const dist = distanceMeters(userCoord, nodeCoords);
      if (dist <= REROUTE_SNAP_RADIUS_METERS && dist < bestDistance) {
        bestFeature = feature;
        bestDistance = dist;
      }
    }

    return bestFeature;
  }, [currentInstructionNodeIds, navData.nodes, nodeSelectionFloor, userCoord]);

  const transitionZoneOptions = useMemo(() => {
    if (!userCoord || !navData.nodes) return [];

    const options = (navData.nodes.features || [])
      .filter((feature: any) => {
        const role = feature?.properties?.role;
        if (!["stairs", "elevator"].includes(role)) return false;
        return distanceMeters(userCoord, feature.geometry?.coordinates) <= TRANSITION_ZONE_RADIUS_METERS;
      })
      .map((feature: any) => ({
        floor: feature.properties?.floor ?? null,
        role: feature.properties?.role,
        id: feature.properties?.id,
      }))
      .filter((option: any, index: number, list: any[]) =>
        index === list.findIndex((item) => item.floor === option.floor)
      );

    return options.sort((a: any, b: any) => (a.floor ?? 0) - (b.floor ?? 0));
  }, [navData.nodes, userCoord]);

  const activeInstructionSegment = segments[activeStepIndex] || null;

  const activeInstructionProgress = useMemo(() => {
    if (!userCoord) return 0;

    const coords = activeInstructionSegment?.geojson?.features?.[0]?.geometry?.coordinates || [];
    if (!Array.isArray(coords) || coords.length < 2) return 0;

    return getProgressAlongPolyline(userCoord, coords);
  }, [activeInstructionSegment, userCoord]);

  const activeInstructionDistanceToEnd = useMemo(() => {
    if (!userCoord) return Infinity;

    const coords = activeInstructionSegment?.geojson?.features?.[0]?.geometry?.coordinates || [];
    if (!Array.isArray(coords) || coords.length < 2) return Infinity;

    return distanceMeters(userCoord, coords[coords.length - 1]);
  }, [activeInstructionSegment, userCoord]);

  const activeInstructionFloorOverride = useMemo(() => {
    if (!isStarted) return null;
    if (!isCrossFloorSegment(activeInstructionSegment)) return null;

    const fromFloor = activeInstructionSegment?.floor ?? null;
    const toFloor = activeInstructionSegment?.toFloor ?? null;
    if (fromFloor === null || toFloor === null) return null;

    return activeInstructionProgress >= 0.5 ? toFloor : fromFloor;
  }, [activeInstructionProgress, activeInstructionSegment, isStarted]);

  const instructionItems = useMemo(
    () =>
      segments.map((segment: any, index: number) =>
        buildSharedDetailedInstruction(
          segment,
          index > 0 ? segments[index - 1] : null,
          index + 1 < segments.length ? segments[index + 1] : null,
          navData.nodes,
          destinationId
        )
      ),
    [destinationId, navData.nodes, segments]
  );

  const displayedInstructionIndex = useMemo(() => {
    if (!instructionItems.length) return 0;
    if (isAtDestination) return instructionItems.length - 1;

    const clampedActiveIndex = Math.min(activeStepIndex, instructionItems.length - 1);
    const activeSegment = segments[clampedActiveIndex] || null;

    if (!activeSegment) return clampedActiveIndex;
    if (currentFloor === null) return clampedActiveIndex;

    // Cuando el usuario está haciendo preview manual, buscamos la transición relevante
    // (escalera/ascensor) más cercana al paso activo.
    if (hasManualFloorSelection) {
      let transitionIndex = -1;

      if (isCrossFloorSegment(activeSegment)) {
        transitionIndex = clampedActiveIndex;
      } else if (
        clampedActiveIndex + 1 < segments.length &&
        isCrossFloorSegment(segments[clampedActiveIndex + 1])
      ) {
        transitionIndex = clampedActiveIndex + 1;
      } else if (
        clampedActiveIndex - 1 >= 0 &&
        isCrossFloorSegment(segments[clampedActiveIndex - 1])
      ) {
        transitionIndex = clampedActiveIndex - 1;
      } else {
        for (let i = clampedActiveIndex; i < segments.length; i++) {
          if (isCrossFloorSegment(segments[i])) {
            transitionIndex = i;
            break;
          }
        }
      }

      if (transitionIndex >= 0) {
        const transitionSegment = segments[transitionIndex];
        const fromFloor = transitionSegment?.floor ?? null;
        const toFloor = transitionSegment?.toFloor ?? null;
        const entryNodeId = transitionSegment?.fromNodeId ?? null;
        const exitNodeId = transitionSegment?.toNodeId ?? null;

        // Preview de la planta origen:
        // mostrar la instrucción que lleva a la escalera/ascensor
        if (currentFloor === fromFloor) {
          for (let i = transitionIndex - 1; i >= 0; i--) {
            const seg = segments[i];
            if (!segmentTouchesFloor(seg, currentFloor)) continue;

            // Preferimos el segmento que termina justo en la transición
            if (entryNodeId && seg?.toNodeId === entryNodeId) {
              return i;
            }
          }

          // fallback: última instrucción visible en esa planta antes de la transición
          for (let i = transitionIndex - 1; i >= 0; i--) {
            if (segmentTouchesFloor(segments[i], currentFloor)) return i;
          }

          return clampedActiveIndex;
        }

        // Preview de la planta destino:
        // mostrar la instrucción que sale de la escalera/ascensor
        if (currentFloor === toFloor) {
          for (let i = transitionIndex + 1; i < segments.length; i++) {
            const seg = segments[i];
            if (!segmentTouchesFloor(seg, currentFloor)) continue;

            // Preferimos el segmento que empieza justo al salir de la transición
            if (exitNodeId && seg?.fromNodeId === exitNodeId) {
              return i;
            }
          }

          // fallback: primera instrucción visible en esa planta tras la transición
          for (let i = transitionIndex + 1; i < segments.length; i++) {
            if (segmentTouchesFloor(segments[i], currentFloor)) return i;
          }

          return clampedActiveIndex;
        }
      }
    }

    // Comportamiento normal si no hay preview manual
    if (segmentTouchesFloor(activeSegment, currentFloor)) {
      return clampedActiveIndex;
    }

    // If the active step is already on another floor, keep showing the most recent
    // visible instruction on the current floor before jumping ahead to a future one.
    for (let i = clampedActiveIndex - 1; i >= 0; i--) {
      if (segmentTouchesFloor(segments[i], currentFloor)) return i;
    }

    for (let i = clampedActiveIndex; i < segments.length; i++) {
      if (segmentTouchesFloor(segments[i], currentFloor)) return i;
    }

    return clampedActiveIndex;
  }, [
    activeStepIndex,
    currentFloor,
    hasManualFloorSelection,
    instructionItems.length,
    isAtDestination,
    segments,
  ]);

  const nextInstruction = instructionItems[displayedInstructionIndex] || null;
  const bannerInstruction = useMemo(() => {
    const currentInstruction = instructionItems[displayedInstructionIndex] || null;
    const currentSegment = segments[displayedInstructionIndex] || null;
    const followingInstruction = instructionItems[displayedInstructionIndex + 1] || null;
    const followingSegment = segments[displayedInstructionIndex + 1] || null;
    const closeEnoughForTurnPrompt =
      activeInstructionProgress >= TURN_PROMPT_PROGRESS_MIN ||
      activeInstructionDistanceToEnd <= TURN_PROMPT_DISTANCE_METERS;

    if (
      !currentInstruction ||
      !currentSegment ||
      !followingSegment ||
      isCrossFloorSegment(currentSegment) ||
      isCrossFloorSegment(followingSegment) ||
      !closeEnoughForTurnPrompt ||
      activeInstructionProgress >= STEP_PROGRESS_MIN
    ) {
      return currentInstruction;
    }

    const upcomingTurn = getSegmentTurnHint(currentSegment, followingSegment);
    const turnTitle = getImmediateTurnTitle(upcomingTurn);

    if (!turnTitle) return currentInstruction;

    return {
      ...currentInstruction,
      title: turnTitle,
      detail: followingInstruction?.title || currentInstruction?.detail || null,
      maneuver: upcomingTurn,
    };
  }, [
    activeInstructionDistanceToEnd,
    activeInstructionProgress,
    displayedInstructionIndex,
    instructionItems,
    segments,
  ]);
  const instructionIconName = getInstructionIconName(bannerInstruction?.maneuver);

  useEffect(() => {
    if (!isStarted) {
      lastSpokenInstructionKeyRef.current = null;
    }
  }, [destinationId, isStarted]);

  useEffect(() => {
    if (!isStarted || !soundEnabled || !bannerInstruction?.title) return;

    const instructionKey = `${displayedInstructionIndex}:${bannerInstruction.title}`;
    if (lastSpokenInstructionKeyRef.current === instructionKey) return;

    lastSpokenInstructionKeyRef.current = instructionKey;
    Speech.stop();
    Speech.speak(formatInstructionForSpeech(bannerInstruction.title), {
      language: "es-ES",
      rate: 0.95,
    });
  }, [bannerInstruction?.detail, bannerInstruction?.title, displayedInstructionIndex, isStarted, soundEnabled]);

  const visibleFloorOptions = useMemo(() => {
    if (!isStarted) return [];
    if (transitionZoneOptions.length > 1) {
      return transitionZoneOptions.filter(
        (option: any, index: number, list: any[]) =>
          index === list.findIndex((item) => item.floor === option.floor)
      );
    }
    if (isCrossFloorSegment(activeInstructionSegment)) {
      const fromFloor = activeInstructionSegment?.floor ?? null;
      const toFloor = activeInstructionSegment?.toFloor ?? null;
      return [fromFloor, toFloor]
        .filter((floor, index, list) => floor !== null && list.indexOf(floor) === index)
        .sort((a: any, b: any) => a - b)
        .map((floor: any) => ({
          floor,
          role: getNodeRole(navData.nodes, activeInstructionSegment?.fromNodeId) || "transition",
        }));
    }
    return [];
  }, [activeInstructionSegment, isStarted, navData.nodes, transitionZoneOptions]);

  const syncAnchoredNodesToFloor = useCallback(
    (floor: number | null) => {
      if (floor === null) return;

      const equivalentNodeId = getEquivalentNodeIdOnFloor(
        navData.nodes,
        confirmedNodeId || lastPassedNodeId,
        floor
      );

      if (equivalentNodeId && equivalentNodeId !== confirmedNodeId) {
        setConfirmedNodeId(equivalentNodeId);
      }
      if (equivalentNodeId && equivalentNodeId !== lastPassedNodeId) {
        setLastPassedNodeId(equivalentNodeId);
      }
    },
    [confirmedNodeId, lastPassedNodeId, navData.nodes]
  );

  const computeAndStoreRoute = useCallback(
    (startId: string, reason: string | null = null, preferOverride?: "stairs" | "elevator") => {
      if (!destinationId) {
        return false;
      }

      const effectivePrefer = preferOverride ?? prefer;
      const alternatePrefer = effectivePrefer === "stairs" ? "elevator" : "stairs";
      const routeTimingCategory =
        reason === null || reason === "initial" || (reason === "destination-change" && !isStarted)
          ? "initial-route"
          : "reroute";
      const routeComputeStartedAtMs = Date.now();
      const preferredResult = computeRoute(navData.nodes, navData.edges, startId, destinationId, {
        prefer: effectivePrefer,
      });
      let result = preferredResult;
      let usedFallbackPreference = false;

      if (!preferredResult.ok) {
        const alternateResult = computeRoute(navData.nodes, navData.edges, startId, destinationId, {
          prefer: alternatePrefer,
        });

        if (alternateResult.ok) {
          result = alternateResult;
          usedFallbackPreference = true;
        }
      }

      const computeDurationMs = Date.now() - routeComputeStartedAtMs;

      if (!result.ok) {
        setRoutePreferenceNotice(null);
        trackEvent("route.compute_failed", {
          startId,
          destinationId,
          prefer: effectivePrefer,
          reason: reason || result.reason || null,
          routeError: result.reason || null,
          routeTimingCategory,
          computeDurationMs,
        });
        setRoute({
          ok: false,
          geojson: null,
          currentFloorGeojson: null,
          futureFloorGeojson: null,
          routeNodesGeojson: null,
          summary: null,
          reason: result.reason,
        });
        return false;
      }

      setRoutePreferenceNotice(
        usedFallbackPreference
          ? effectivePrefer === "elevator"
            ? "No se encontro una ruta por ascensor. Mostrando la mejor ruta disponible."
            : "No se encontro una ruta que priorice escaleras. Mostrando la mejor ruta disponible."
          : null
      );

      setRoute({
        ok: true,
        geojson: projectGeoJSONForMap(result.routeGeojson),
        currentFloorGeojson: projectGeoJSONForMap(result.currentFloorGeojson),
        futureFloorGeojson: projectGeoJSONForMap(result.futureFloorGeojson),
        routeNodesGeojson: projectGeoJSONForMap(result.routeNodesGeojson),
        summary: result.summary,
        reason,
      });

      trackEvent("route.computed", {
        startId,
        destinationId,
        prefer: effectivePrefer,
        appliedPrefer: result.summary?.prefer ?? effectivePrefer,
        usedFallbackPreference,
        reason: reason || "initial",
        routeTimingCategory,
        totalMeters: result.summary?.totalMeters ?? null,
        etaMinutes: result.summary?.etaMinutes ?? null,
        destinationFloor: result.summary?.destinationFloor ?? null,
        computeDurationMs,
      });

      setActiveStepIndex(0);
      return true;
    },
    [destinationId, isStarted, navData.edges, navData.nodes, prefer, setActiveStepIndex, setRoute]
  );

  useEffect(() => {
    if (lastDestinationIdRef.current === destinationId) return;

    lastDestinationIdRef.current = destinationId ?? null;

    if (!destinationId) return;
    if (!navData.isLoaded || navData.validationErrors.length) return;

    const rerouteStartId = isStarted
      ? confirmedNodeId || lastPassedNodeId || effectiveStartNodeId
      : effectiveStartNodeId;

    computeAndStoreRoute(rerouteStartId, "destination-change");
  }, [
    computeAndStoreRoute,
    confirmedNodeId,
    destinationId,
    effectiveStartNodeId,
    isStarted,
    lastPassedNodeId,
    navData.isLoaded,
    navData.validationErrors.length,
  ]);

  const statusMessage = useMemo(() => {
    if (routePreferenceNotice) return routePreferenceNotice;
    if (showRerouteNotice) return "Recalculando ruta...";
    if (isStarted && visibleFloorOptions.length > 1) {
      const roleLabel = visibleFloorOptions[0]?.role || "transición";
      const floorsText = visibleFloorOptions.map((option: any) => `P${option.floor}`).join(" / ");
      return `Cerca de ${roleLabel} · Presione para ver vista previa ${floorsText}`;
    }
    return `Planta ${currentFloor ?? "-"}`;
  }, [currentFloor, isStarted, routePreferenceNotice, showRerouteNotice, visibleFloorOptions]);

  const userHeading = useMemo(() => {
    if (!isStarted) {
      return Number.isFinite(startFeature?.properties?.angle) ? startFeature.properties.angle : 0;
    }

    let coords: [number, number][] = [];
    for (let i = displayedInstructionIndex; i < segments.length; i++) {
      const segment = segments[i];
      const segmentCoords = segment?.geojson?.features?.[0]?.geometry?.coordinates || [];

      if (!segmentTouchesFloor(segment, currentFloor)) continue;
      if (!Array.isArray(segmentCoords) || segmentCoords.length < 2) continue;

      const first = segmentCoords[0];
      const last = segmentCoords[segmentCoords.length - 1];
      if (distanceMeters(first, last) <= 0.01) continue;

      coords = segmentCoords;
      break;
    }

    if (!coords.length) {
      const fallbackSegment = segments[displayedInstructionIndex] || null;
      coords = fallbackSegment?.geojson?.features?.[0]?.geometry?.coordinates || [];
    }

    if (!Array.isArray(coords) || coords.length < 2) return null;
    return getHeadingFromSegment(coords, userCoord);
  }, [currentFloor, displayedInstructionIndex, isStarted, segments, startFeature, userCoord]);

  const liveMapHeading = useMemo(() => {
    if (typeof optitrackHeading === "number" && Number.isFinite(optitrackHeading)) {
      return optitrackHeading;
    }

    if (typeof sensorHeading === "number" && Number.isFinite(sensorHeading)) {
      return sensorHeading;
    }

    return null;
  }, [optitrackHeading, sensorHeading]);


  useEffect(() => {
    if (typeof liveMapHeading !== "number" || !Number.isFinite(liveMapHeading)) {
      setSmoothedLiveHeading(null);
      return;
    }

    setSmoothedLiveHeading((previous) => smoothHeading(previous, liveMapHeading));
  }, [liveMapHeading]);

  const arrivalLabel = useMemo(() => {
    const etaMinutes = route.summary?.etaMinutes;
    if (!etaMinutes) return "--:--";

    const now = new Date();
    now.setMinutes(now.getMinutes() + etaMinutes);
    return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, [route.summary?.etaMinutes]);

  const startedRouteLayers = useMemo(() => {
    const visibleSegments: { segment: any; index: number }[] = segments
      .map((segment: any, index: number) => ({ segment, index }))
      .filter((item: { segment: any; index: number }) => segmentTouchesFloor(item.segment, currentFloor));

    const remainingVisibleSegments = visibleSegments.filter(
      (item: { segment: any; index: number }) => item.index >= activeStepIndex
    );
    const completedVisibleSegments = visibleSegments.filter(
      (item: { segment: any; index: number }) => item.index < activeStepIndex
    );

    const primarySegment =
      remainingVisibleSegments[0]?.segment ||
      completedVisibleSegments[completedVisibleSegments.length - 1]?.segment ||
      null;

    const primaryFeatures = primarySegment?.geojson?.features || [];
    const secondaryRemainingSegments = remainingVisibleSegments.filter(
      (item: { segment: any; index: number }) => item.segment !== primarySegment
    );
    const secondaryCompletedSegments = completedVisibleSegments.filter(
      (item: { segment: any; index: number }) => item.segment !== primarySegment
    );
    const collectFeatures = (items: { segment: any; index: number }[]) =>
      items.reduce((allFeatures: any[], item) => {
        return [...allFeatures, ...(item.segment?.geojson?.features || [])];
      }, [] as any[]);

    const secondaryFeatures = [
      ...collectFeatures(secondaryCompletedSegments),
      ...collectFeatures(secondaryRemainingSegments),
    ];

    return {
      primary: primaryFeatures.length
        ? projectGeoJSONForMap({
            type: "FeatureCollection",
            features: primaryFeatures,
          })
        : null,
      secondary: secondaryFeatures.length
        ? {
            type: "FeatureCollection",
            features:
              projectGeoJSONForMap({
                type: "FeatureCollection",
                features: secondaryFeatures,
              })?.features || [],
          }
        : null,
    };
  }, [activeStepIndex, currentFloor, segments]);

  useEffect(() => {
    return () => {
      if (rerouteNoticeTimeoutRef.current) {
        clearTimeout(rerouteNoticeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isStarted) {
      setLockedHeading(Number.isFinite(startFeature?.properties?.angle) ? startFeature.properties.angle : 0);
      return;
    }

    if (typeof userHeading === "number" && Number.isFinite(userHeading)) {
      setLockedHeading(userHeading);
    }
  }, [isStarted, startFeature, userHeading]);

  useEffect(() => {
    if (!LocationImpl) return;

    let subscription: any = null;
    let isMounted = true;

    async function startHeadingWatch() {
      try {
        const currentPermission = await LocationImpl.getForegroundPermissionsAsync();
        let granted = currentPermission?.granted === true;

        if (!granted) {
          if (hasShownLocationPrivacyNoteRef.current) {
            const requestedPermission = await LocationImpl.requestForegroundPermissionsAsync();
            granted = requestedPermission?.granted === true;
          } else {
            hasShownLocationPrivacyNoteRef.current = true;
            granted = await new Promise<boolean>((resolve) => {
              Alert.alert("Nota de privacidad", "La localizacion se usa solo para mostrar tu posicion y recomendar la mejor entrada.", [
                { text: "Ahora no", style: "cancel", onPress: () => resolve(false) },
                {
                  text: "Continuar",
                  onPress: async () => {
                    const requestedPermission = await LocationImpl.requestForegroundPermissionsAsync();
                    resolve(requestedPermission?.granted === true);
                  },
                },
              ]);
            });
          }
        }

        if (!isMounted || !granted) return;

        const initialHeading = await LocationImpl.getHeadingAsync();
        const initialValue = getHeadingValue(initialHeading);

        if (isMounted && typeof initialValue === "number") {
          setSensorHeading(initialValue);
        }

        subscription = await LocationImpl.watchHeadingAsync((heading: any) => {
          if (!isMounted) return;
          const nextHeading = getHeadingValue(heading);

          if (typeof nextHeading === "number") {
            setSensorHeading(nextHeading);
          }
        });
      } catch {
        if (isMounted) {
          setSensorHeading(null);
        }
      }
    }

    startHeadingWatch();

    return () => {
      isMounted = false;
      if (subscription?.remove) subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (isStarted) return;
    if (!navData.isLoaded || navData.validationErrors.length) return;

    if (!destinationId) {
      setRoute({
        ok: false,
        geojson: null,
        currentFloorGeojson: null,
        futureFloorGeojson: null,
        routeNodesGeojson: null,
        summary: null,
        reason: null,
      });
      return;
    }

    const startId = effectiveStartNodeId;
    computeAndStoreRoute(startId);
  }, [
    computeAndStoreRoute,
    destinationId,
    effectiveStartNodeId,
    isStarted,
    navData.isLoaded,
    navData.validationErrors.length,
    setRoute,
  ]);

  useEffect(() => {
    if (!isStarted) {
      if (isFollowingUser) setIsFollowingUser(false);

      const initialNodeId = effectiveStartNodeId;
      if (confirmedNodeId !== initialNodeId) setConfirmedNodeId(initialNodeId);
      if (lastPassedNodeId !== initialNodeId) setLastPassedNodeId(initialNodeId);

      const initialFloor = startFeature?.properties?.floor ?? 0;
      if (navigationFloor !== initialFloor) setNavigationFloor(initialFloor);

      if (committedFloorLock !== null) setCommittedFloorLock(null);
      if (transitionFloorLock !== null) setTransitionFloorLock(null);
      if (hasManualFloorSelection) setHasManualFloorSelection(false);

      return;
    }

  }, [
    committedFloorLock,
    confirmedNodeId,
    hasManualFloorSelection,
    isStarted,
    lastPassedNodeId,
    navigationFloor,
    setNavigationFloor,
    effectiveStartNodeId,
    startFeature,
    transitionFloorLock,
  ]);

  useEffect(() => {
    if (!isManualMapControl) return;
    if (isFollowingUser) setIsFollowingUser(false);
  }, [isFollowingUser, isManualMapControl]);

  useEffect(() => {
    if (!isStarted || !isFollowingUser || isManualMapControl) return;
    if (!userCoord) return;

    const now = Date.now();
    const lastCoord = lastFollowUserCoordRef.current;
    const movedEnough = !lastCoord || distanceMeters(lastCoord, userCoord) >= 0.35;
    const stepChanged = lastFollowStepIndexRef.current !== activeStepIndex;
    const throttled = now - lastFollowRecenterAtRef.current < 300;

    if ((!movedEnough && !stepChanged) || throttled) return;

    lastFollowRecenterAtRef.current = now;
    lastFollowUserCoordRef.current = userCoord;
    lastFollowStepIndexRef.current = activeStepIndex;
    setRecenterHeading(lockedHeading);
    setRecenterRequestedAt(now);
    setRecenterTick((value) => value + 1);
  }, [activeStepIndex, isFollowingUser, isManualMapControl, isStarted, lockedHeading, userCoord]);

  useEffect(() => {
    if (!isStarted) return;
    if (hasManualFloorSelection && transitionFloorLock !== null) return;

    if (visibleFloorOptions.length <= 1) {
      if (transitionFloorLock !== null) setTransitionFloorLock(null);
      if (hasManualFloorSelection) setHasManualFloorSelection(false);
    }
  }, [hasManualFloorSelection, isStarted, transitionFloorLock, visibleFloorOptions.length]);

  useEffect(() => {
    if (!isStarted) return;
    if (!followsCurrentLocation) return;

    const nearbyNodeId =
      nearbyInstructionNode?.properties?.id ||
      nearbyAllowedNode?.properties?.id ||
      null;

    if (!nearbyNodeId) return;

    const nearbyNodeFloor =
      nearbyInstructionNode?.properties?.floor ??
      nearbyAllowedNode?.properties?.floor ??
      null;

    const nearbyNodeIndex = routeNodeOrder.get(nearbyNodeId) ?? -1;
    const lastPassedIndex =
      lastPassedNodeId && routeNodeOrder.has(lastPassedNodeId)
        ? routeNodeOrder.get(lastPassedNodeId) ?? -1
        : -1;

    if (nearbyNodeIndex >= lastPassedIndex) {
      if (nearbyNodeId !== lastPassedNodeId) setLastPassedNodeId(nearbyNodeId);
      if (nearbyNodeId !== confirmedNodeId) setConfirmedNodeId(nearbyNodeId);

      if (
        nearbyNodeFloor !== null &&
        committedFloorLock !== null &&
        nearbyNodeFloor !== committedFloorLock
      ) {
        setCommittedFloorLock(null);
      }

      if (
        nearbyNodeFloor !== null &&
        committedFloorLock !== null &&
        nearbyNodeFloor === committedFloorLock &&
        livePosition.floor !== committedFloorLock
      ) {
        setLiveFloor(committedFloorLock);
      }
    }
  }, [
    committedFloorLock,
    confirmedNodeId,
    isStarted,
    lastPassedNodeId,
    livePosition.floor,
    nearbyAllowedNode,
    nearbyInstructionNode,
    routeNodeOrder,
    setCommittedFloorLock,
    setLiveFloor,
    followsCurrentLocation,
  ]);

  useEffect(() => {
    if (!isStarted) return;

    if (committedFloorLock !== null) {
      if (navigationFloor !== committedFloorLock) setNavigationFloor(committedFloorLock);
      if (livePosition.floor !== committedFloorLock) setLiveFloor(committedFloorLock);
      return;
    }

    if (
      isCrossFloorSegment(activeInstructionSegment) &&
      activeInstructionFloorOverride !== null &&
      transitionFloorLock === null
    ) {
      if (navigationFloor !== activeInstructionFloorOverride) {
        setNavigationFloor(activeInstructionFloorOverride);
      }
      if (livePosition.floor !== activeInstructionFloorOverride) {
        setLiveFloor(activeInstructionFloorOverride);
      }
      return;
    }

    const confirmedFloor = confirmedNodeFeature?.properties?.floor ?? null;
    if (transitionFloorLock === null && confirmedFloor !== null) {
      if (navigationFloor !== confirmedFloor) setNavigationFloor(confirmedFloor);
      if (livePosition.floor !== confirmedFloor) setLiveFloor(confirmedFloor);
    }
  }, [
    activeInstructionFloorOverride,
    activeInstructionSegment,
    committedFloorLock,
    confirmedNodeFeature,
    isStarted,
    livePosition.floor,
    navigationFloor,
    setLiveFloor,
    setNavigationFloor,
    transitionFloorLock,
  ]);

  useEffect(() => {
    if (!isStarted || !userCoord) return;
    if (!followsCurrentLocation) return;
    if (!segments.length) return;
    if (activeStepIndex >= segments.length) return;

    const currentSegment = segments[activeStepIndex];
    const segmentCoords = currentSegment?.geojson?.features?.[0]?.geometry?.coordinates || [];
    if (!Array.isArray(segmentCoords) || segmentCoords.length < 2) return;

    const targetCoord = segmentCoords[segmentCoords.length - 1];
    const distToTarget = distanceMeters(userCoord, targetCoord);
    const progress = getProgressAlongPolyline(userCoord, segmentCoords);
    const segmentTubeDistance = distanceToPolyline(userCoord, segmentCoords);
    const stepTargetRadius = isCrossFloorSegment(currentSegment)
      ? TRANSITION_STEP_TARGET_RADIUS_METERS
      : STEP_TARGET_RADIUS_METERS;
    const reachedConfirmedTarget =
      confirmedNodeId === currentSegment?.toNodeId &&
      distToTarget <= STEP_PROGRESS_RADIUS_METERS;

    const shouldAdvance =
      reachedConfirmedTarget ||
      distToTarget <= stepTargetRadius ||
      progress >= STEP_PROGRESS_MIN ||
      (
        progress >= STEP_PROGRESS_WITH_RADIUS_MIN &&
        distToTarget <= STEP_PROGRESS_RADIUS_METERS &&
        segmentTubeDistance <= SEGMENT_TUBE_RADIUS_METERS
      );

    if (!shouldAdvance) return;

    if (isCrossFloorSegment(currentSegment)) {
      const destinationFloor = currentSegment?.toFloor ?? null;

      if (destinationFloor !== null) {
        if (committedFloorLock !== destinationFloor) setCommittedFloorLock(destinationFloor);
        if (transitionFloorLock !== null) setTransitionFloorLock(null);
        syncAnchoredNodesToFloor(destinationFloor);
        if (navigationFloor !== destinationFloor) setNavigationFloor(destinationFloor);
        if (livePosition.floor !== destinationFloor) setLiveFloor(destinationFloor);
      }
    }

    const nextIndex = Math.min(activeStepIndex + 1, Math.max(segments.length - 1, 0));
    if (nextIndex !== activeStepIndex) {
      setActiveStepIndex(nextIndex);
    }
  }, [
    activeStepIndex,
    committedFloorLock,
    confirmedNodeId,
    isStarted,
    livePosition.floor,
    navigationFloor,
    segments,
    setActiveStepIndex,
    setLiveFloor,
    setNavigationFloor,
    syncAnchoredNodesToFloor,
    transitionFloorLock,
    userCoord,
    followsCurrentLocation,
  ]);

  useEffect(() => {
    if (!isStarted || !userCoord) return;
    if (!followsCurrentLocation) return;

    const activeSegment = segments[activeStepIndex] || null;
    const activeCoords = activeSegment?.geojson?.features?.[0]?.geometry?.coordinates || [];
    const fullRouteCoords = route.geojson?.features?.[0]?.geometry?.coordinates || [];
    const remainingCoords = segments
      .slice(activeStepIndex)
      .flatMap((segment: any) => segment?.geojson?.features?.[0]?.geometry?.coordinates || []);

    const primaryCoords =
      Array.isArray(activeCoords) && activeCoords.length >= 2
        ? activeCoords
        : Array.isArray(remainingCoords) && remainingCoords.length >= 2
          ? remainingCoords
          : fullRouteCoords;

    if (!Array.isArray(primaryCoords) || primaryCoords.length < 2) return;

    const currentDistance = distanceToPolyline(userCoord, primaryCoords);
    const remainingDistance =
      Array.isArray(remainingCoords) && remainingCoords.length >= 2
        ? distanceToPolyline(userCoord, remainingCoords)
        : currentDistance;

    const offRouteDistance = Math.min(currentDistance);
    if (offRouteDistance <= OFF_ROUTE_RADIUS_METERS) return;

    const now = Date.now();
    if (now - lastRerouteAtRef.current < 2000) return;

    const confirmedNodeOnCurrentFloor = isNodeOnFloor(navData.nodes, confirmedNodeId, routingFloor)
      ? confirmedNodeId
      : null;

    const lastPassedNodeOnCurrentFloor = isNodeOnFloor(navData.nodes, lastPassedNodeId, routingFloor)
      ? lastPassedNodeId
      : null;

    const rerouteStartId =
      (currentInstructionNodeIds.size
        ? getNearestNodeId(
            navData.nodes,
            userCoord,
            routingFloor,
            currentInstructionNodeIds,
            REROUTE_SNAP_RADIUS_METERS
          )
        : null) ||
      getNearestNodeId(
        navData.nodes,
        userCoord,
        routingFloor,
        forwardAllowedNodeIds,
        REROUTE_SNAP_RADIUS_METERS
      ) ||
      confirmedNodeOnCurrentFloor ||
      lastPassedNodeOnCurrentFloor ||
      getNearestNodeId(
        navData.nodes,
        userCoord,
        routingFloor,
        forwardAllowedNodeIds
      );

    if (!rerouteStartId || !destinationId) return;

    lastRerouteAtRef.current = now;
    if (rerouteStartId !== confirmedNodeId) setConfirmedNodeId(rerouteStartId);
    if (rerouteStartId !== lastPassedNodeId) setLastPassedNodeId(rerouteStartId);

    setShowRerouteNotice(true);
    trackEvent("navigation.reroute_triggered", {
      destinationId,
      rerouteStartId,
      activeStepIndex,
      currentFloor: routingFloor,
    });
    if (rerouteNoticeTimeoutRef.current) clearTimeout(rerouteNoticeTimeoutRef.current);
    rerouteNoticeTimeoutRef.current = setTimeout(() => {
      setShowRerouteNotice(false);
    }, 1800);

    computeAndStoreRoute(rerouteStartId, "recalculating");
  }, [
    activeStepIndex,
    computeAndStoreRoute,
    confirmedNodeId,
    currentInstructionNodeIds,
    destinationId,
    forwardAllowedNodeIds,
    isStarted,
    lastPassedNodeId,
    navData.nodes,
    routingFloor,
    route.geojson,
    segments,
    userCoord,
    followsCurrentLocation,
  ]);

  const handlePreferencePress = useCallback(() => {
    const nextPrefer = prefer === "stairs" ? "elevator" : "stairs";
    setNavigationPreference(nextPrefer);

    if (!isStarted || !destinationId) {
      return;
    }

    const rerouteStartId = confirmedNodeId || lastPassedNodeId || start.nodeId || "n_hospital_entrance_f0";
    computeAndStoreRoute(rerouteStartId, "preference-change", nextPrefer);
  }, [
    computeAndStoreRoute,
    confirmedNodeId,
    destinationId,
    isStarted,
    lastPassedNodeId,
    prefer,
    setNavigationPreference,
    start.nodeId,
  ]);

  const handleFloorPreviewPress = useCallback((previewFloor: number | null) => {
    if (previewFloor === null) return;

    if (committedFloorLock !== previewFloor) {
      setCommittedFloorLock(previewFloor);
    }
    if (navigationFloor !== previewFloor) {
      setNavigationFloor(previewFloor);
    }
    if (livePosition.floor !== previewFloor) {
      setLiveFloor(previewFloor);
    }
    syncAnchoredNodesToFloor(previewFloor);
    setActiveStepIndex(0);

    if (hasManualFloorSelection) {
      setHasManualFloorSelection(false);
    }
    if (transitionFloorLock !== null) {
      setTransitionFloorLock(null);
    }

    if (isStarted && destinationId) {
      const rerouteStartId = getEquivalentNodeIdOnFloor(
        navData.nodes,
        confirmedNodeId || lastPassedNodeId || effectiveStartNodeId,
        previewFloor
      ) || confirmedNodeId || lastPassedNodeId || effectiveStartNodeId;

      computeAndStoreRoute(rerouteStartId, "floor-switch");
    }
  }, [
    committedFloorLock,
    computeAndStoreRoute,
    confirmedNodeId,
    destinationId,
    effectiveStartNodeId,
    hasManualFloorSelection,
    isStarted,
    lastPassedNodeId,
    livePosition.floor,
    navData.nodes,
    navigationFloor,
    syncAnchoredNodesToFloor,
    transitionFloorLock,
    setActiveStepIndex,
    setCommittedFloorLock,
    setLiveFloor,
    setNavigationFloor,
  ]);

  const sheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          gestureState.dy < -6 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy < -18) {
            setShowSteps(true);
          }
        },
      }),
    []
  );

  const stepsSheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          gestureState.dy > 6 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 18) {
            setShowSteps(false);
          }
        },
      }),
    []
  );

  if (!navData.isLoaded) {
    return (
      <View style={styles.page}>
        <Text style={styles.emptyText}>Cargando...</Text>
      </View>
    );
  }

  if (navData.validationErrors.length) {
    return (
      <View style={styles.page}>
        <Text style={styles.errorTitle}>Datos de navegación inválidos</Text>
        <Text>{navData.validationErrors.join("\n")}</Text>
      </View>
    );
  }

  if (!destinationId) {
    return (
      <View style={styles.page}>
        <Text style={styles.emptyText}>No hay destino seleccionado.</Text>
        <Pressable style={styles.primaryButton} onPress={() => router.push("/search")}>
          <Text style={styles.primaryButtonText}>Seleccionar destino</Text>
        </Pressable>
      </View>
    );
  }

  const showInstructionBanner = isStarted && Boolean(nextInstruction);
  const instructionBannerReservedHeight = showInstructionBanner
    ? Math.max(110, insets.top + 114)
    : 0;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      {!isStarted ? (
        <View style={styles.header}>
          <Pressable
            style={styles.locationCard}
            onPress={() => {
              setShowCurrentLocationFloorPrompt(false);
              setShowStartDropdown((prev) => !prev);
              setStartQuery("");
            }}
          >
            <View style={styles.cardTextWrap}>
              <Text style={styles.cardLabel}>Inicio</Text>
              <Text style={styles.cardTitle}>{getNodeLabel(navData.nodes, effectiveStartNodeId) || "Seleccionar inicio"}</Text>
              <Text style={styles.cardMeta}>
                {`Planta ${route.summary?.startFloor ?? startFeature?.properties?.floor ?? "-"}`}
              </Text>
            </View>
            <Ionicons name="pencil" size={24} color={AppPalette.textPrimary} />
          </Pressable>

          {showStartDropdown ? (
            <View style={styles.startDropdown}>
              <View style={styles.startSearchWrap}>
                <TextInput value={startQuery} onChangeText={setStartQuery} placeholder="Escriba punto de partida" placeholderTextColor="rgba(29, 27, 32, 0.65)" style={styles.startSearchInput} />
                <Ionicons name="search" size={18} color="rgba(29, 27, 32, 0.75)" />
              </View>

              {showCurrentLocationFloorPrompt ? (
                <View style={styles.currentLocationFloorPrompt}>
                  <Text style={styles.currentLocationFloorPromptTitle}>
                    ¿En qué planta se encuentra?
                  </Text>
                    <Text style={styles.currentLocationFloorPromptBody}>
                      Antes de usar su ubicacion actual, indique si se encuentra en la planta 0 o en la planta 1.
                    </Text>
                  <View style={styles.currentLocationFloorPromptActions}>
                    {[0, 1].map((floor) => (
                      <Pressable
                        key={`current-location-floor-top-${floor}`}
                        style={styles.currentLocationFloorButton}
                        onPress={() => {
                          const option = getNearestCurrentLocationNodeForFloor(floor);
                          if (!option) return;
                          setNavigationStarted(false);
                          clearPostNavStartOverride();
                          setLiveFloor(floor);
                          setStartNode(option.id, "current-location", userCoord);
                          setShowCurrentLocationFloorPrompt(false);
                          setShowStartDropdown(false);
                          setStartQuery("");
                        }}
                      >
                        <Text style={styles.currentLocationFloorButtonText}>{`Planta ${floor}`}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              <ScrollView style={styles.startOptionsScroll} contentContainerStyle={styles.startOptionsContent}>
                {(startQuery.trim() ? searchedStartOptions : startNodeOptions).map((option: any) => (
                  <Pressable
                    key={`start-option-${option.id}`}
                    style={[styles.startOptionRow, start.nodeId === option.id && styles.startOptionRowActive]}
                    onPress={() => {
                      setNavigationStarted(false);
                      clearPostNavStartOverride();
                      setStartNode(option.id, "manual-node", userCoord);
                      setShowCurrentLocationFloorPrompt(false);
                      setShowStartDropdown(false);
                      setStartQuery("");
                    }}
                  >
                    <Text style={styles.startOptionTitle}>{option.label}</Text>
                    <Text style={styles.startOptionMeta}>{`Planta ${option.floor ?? "-"}`}</Text>
                  </Pressable>
                ))}

                  <Pressable
                    style={styles.currentLocationOption}
                    onPress={() => {
                      if (!currentLocationAvailable) {
                        Alert.alert(
                          "Ubicacion no disponible",
                          "Puedes seguir usando la app eligiendo manualmente el punto de inicio."
                        );
                        return;
                      }
                      setShowCurrentLocationFloorPrompt(true);
                    }}
                  >
                  <Ionicons
                    name="locate"
                    size={18}
                    color={currentLocationAvailable ? AppPalette.primary : AppPalette.lines}
                  />
                  <Text style={styles.currentLocationOptionText}>
                    {currentLocationAvailable ? "Ubicación actual" : "Ubicación actual (no disponible)"}
                  </Text>
                </Pressable>

                {showCurrentLocationFloorPrompt ? (
                  <View style={styles.currentLocationFloorPrompt}>
                    <Text style={styles.currentLocationFloorPromptTitle}>
                      ¿En qué planta se encuentra?
                    </Text>
                    <View style={styles.currentLocationFloorPromptActions}>
                      {[0, 1].map((floor) => (
                        <Pressable
                          key={`current-location-floor-${floor}`}
                          style={styles.currentLocationFloorButton}
                          onPress={() => {
                            const option = getNearestCurrentLocationNodeForFloor(floor);
                            if (!option) return;
                            setNavigationStarted(false);
                            clearPostNavStartOverride();
                            setLiveFloor(floor);
                            setStartNode(option.id, "current-location", userCoord);
                            setShowCurrentLocationFloorPrompt(false);
                            setShowStartDropdown(false);
                            setStartQuery("");
                          }}
                        >
                          <Text style={styles.currentLocationFloorButtonText}>{`Planta ${floor}`}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}
              </ScrollView>
            </View>
          ) : null}

          <Pressable style={[styles.locationCard, { backgroundColor: palette.surfaceAlt }]} onPress={() => router.push("/search")}>
            <View style={styles.cardTextWrap}>
              <Text style={[styles.cardLabel, { color: palette.textSectionTitles }]}>Destino</Text>
              <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>{getNodeLabel(navData.nodes, destinationId) || "Seleccionar destino"}</Text>
              <Text style={[styles.cardMeta, { color: palette.textPrimary }]}>
                {route.ok
                  ? `Planta ${route.summary?.destinationFloor ?? destinationFeature?.properties?.floor ?? "-"}${destinationDirectoryEntry?.roomNumber ? ` | Sala ${destinationDirectoryEntry.roomNumber}` : ""} | ${route.summary?.etaMinutes ?? "?"} min | ${route.summary?.totalMeters ?? "?"} m`
                  : route.reason
                    ? `Error en la ruta: ${route.reason}`
                    : "Preparando ruta"}
              </Text>
            </View>
            <Ionicons name="pencil" size={24} color={palette.textPrimary} />
          </Pressable>

        </View>
      ) : null}

      {!isStarted && shouldShowOutdoorHandoff && showOutdoorHandoffPopup ? (
        <View style={[styles.popupWrap, { top: Math.max(insets.top, 14) + 8 }]}>
          <View style={styles.popupCard}>
            <Pressable
              style={styles.popupClose}
              onPress={() => setShowOutdoorHandoffPopup(false)}
            >
              <Ionicons name="close" size={20} color={palette.textPrimary} />
            </Pressable>
            <Text style={styles.popupTitle}>Fuera del hospital</Text>
            <Text style={styles.popupBody}>
              No se ha detectado localizacion interior todavia. Algunas capacidades pueden estar limitadas hasta entrar al hospital.
            </Text>
            <Text style={styles.popupBody}>
              Entrada recomendada: {activeEntranceEntry?.name} ({activeEntranceEntry?.street}).
            </Text>
            <Pressable style={styles.popupButton} onPress={handleOpenGoogleMaps}>
              <Text style={styles.popupButtonText}>Abrir en Google Maps</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={[styles.mapWrap, instructionBannerReservedHeight > 0 ? { paddingTop: instructionBannerReservedHeight } : null]}>
        <IndoorMap
          currentFloor={currentFloor}
          nodes={navData.renderNodes}
          floorplan={navData.renderFloorplan}
          route={
            isStarted
              ? startedRouteLayers.primary
              : route.currentFloorGeojson || route.geojson
          }
          secondaryRoute={
            isStarted
              ? startedRouteLayers.secondary
              : route.futureFloorGeojson || null
          }
          routeNodes={route.routeNodesGeojson}
          destinationFeature={renderedDestinationFeature}
          mapHeading={recenterHeading}
          userCoord={mapUserCoord}
          recenterTargetCoord={recenterTargetCoord}
          userHeading={liveMapUserHeading}
          isStarted={isStarted}
          allowAutoCamera={!isStarted && !isManualMapControl}
          allowRecenterCamera={!isManualMapControl}
          cameraEnabled={!isManualMapControl}
          recenterTick={recenterTick}
          recenterRequestedAt={recenterRequestedAt}
          onMapInteraction={() => {
            if (!isManualMapControl) setIsManualMapControl(true);
            if (isFollowingUser) setIsFollowingUser(false);
          }}
        />

        {showInstructionBanner ? (
          <View style={[styles.instructionBanner, { top: insets.top + 6 }]}>
            <View style={styles.instructionRow}>
              <View style={styles.instructionIconWrap}>
                <MaterialCommunityIcons
                  name={instructionIconName as any}
                  size={44}
                  color={palette.textPrimary}
                  style={styles.instructionIcon}
                />
              </View>
              <Text
                style={styles.instructionTitle}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                maxFontSizeMultiplier={1}
              >
                {bannerInstruction?.title}
              </Text>
            </View>
            {bannerInstruction?.detail ? (
              <Text style={styles.instructionDetail} numberOfLines={2}>
                {bannerInstruction.detail}
              </Text>
            ) : null}
          </View>
        ) : null}

        {isStarted ? (
          <>
            <Pressable
              style={[styles.targetButton, isFollowingUser ? styles.targetButtonActive : styles.targetButtonInactive]}
              onPress={() => {
                recenterToUser();
              }}
            >
              <MaterialCommunityIcons
                name="crosshairs-gps"
                size={28}
                color={isFollowingUser ? palette.background : palette.primary}
              />
            </Pressable>

            <View style={styles.mapActions}>
              <Pressable
                style={styles.mapActionButton}
                onPress={() => {
                  trackEvent("navigation.guidance_mode_changed", {
                    fromMode: "2d",
                    toMode: "ar",
                    destinationId,
                    activeStepIndex,
                    routeElapsedSeconds: routeStartedAtMs
                      ? Math.round((Date.now() - routeStartedAtMs) / 1000)
                      : null,
                  });
                  router.replace("/ar");
                }}
              >
                <Ionicons name="camera-outline" size={26} color={palette.background} />
                <Text style={styles.mapActionBadge}>RA</Text>
              </Pressable>
              <Pressable style={styles.mapActionButton} onPress={handlePreferencePress}>
                <MaterialCommunityIcons
                  name={prefer === "stairs" ? "stairs" : "elevator"}
                  size={28}
                  color={palette.background}
                />
              </Pressable>
              <Pressable style={styles.mapActionButton} onPress={() => setSoundEnabled(!soundEnabled)}>
                <Ionicons
                  name={soundEnabled ? "volume-high" : "volume-mute"}
                  size={28}
                  color={palette.background}
                />
              </Pressable>
              <Pressable style={styles.mapActionButton} onPress={() => router.push("/help")}>
                <Ionicons name="help" size={28} color={palette.background} />
              </Pressable>
            </View>

            {visibleFloorOptions.length > 1 ? (
              <View style={styles.floorSwitchRow}>
                {visibleFloorOptions.map((option: any) => {
                  const isActive = currentFloor === option.floor;
                  return (
                    <Pressable
                      key={`floor-option-${option.floor}`}
                      style={[
                        styles.statusPill,
                        styles.floorPillButton,
                        !isActive && styles.floorPillButtonInactive,
                        isActive && styles.statusPillInteractive,
                      ]}
                      onPress={() => handleFloorPreviewPress(option.floor ?? null)}
                    >
                      <Text style={[styles.statusPillText, !isActive && styles.floorPillTextInactive]}>
                        {`Planta ${option.floor}`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View style={styles.mapStatusWrap}>
                <View style={styles.statusPill}>
                  <Text style={styles.statusPillText}>{statusMessage}</Text>
                </View>
              </View>
            )}
          </>
        ) : null}
      </View>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom - 4, 6) }]}>
        <Pressable
          style={styles.sheetHandle}
          onPress={() => setShowSteps(true)}
          {...sheetPanResponder.panHandlers}
        >
          <MaterialCommunityIcons name="menu-up" size={24} color={AppPalette.background} style={styles.handleArrow} />
          <Text style={styles.handleText}>Ruta</Text>
        </Pressable>

        <View style={styles.metricsRow}>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{arrivalLabel}</Text>
            <Text style={styles.metricLabel}>Llegada</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{route.summary?.etaMinutes ?? "-"}</Text>
            <Text style={styles.metricLabel}>min</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{route.summary?.totalMeters ?? "-"}</Text>
            <Text style={styles.metricLabel}>m</Text>
          </View>
          <Pressable
            style={styles.startButton}
            onPress={() => {
              if (isStarted) {
                setShowSteps(false);
                trackEvent("navigation.completed", {
                  destinationId,
                  totalMeters: route.summary?.totalMeters ?? null,
                  etaMinutes: route.summary?.etaMinutes ?? null,
                  activeStepIndex,
                  actualDurationSeconds: routeStartedAtMs
                    ? Math.round((Date.now() - routeStartedAtMs) / 1000)
                    : null,
                });
                setNavigationStarted(false);
                if (destinationId) {
                  router.replace(`/post-navigation?completedDestinationId=${encodeURIComponent(destinationId)}`);
                }
                return;
              }
              if (postNavStartOverrideId) {
                setStartNode(
                  postNavStartOverrideId,
                  "current-location",
                  livePosition.coords ?? userCoord ?? null
                );
                clearPostNavStartOverride();
              }
              setActiveStepIndex(0);
              setNavigationStarted(true);
              trackEvent("navigation.started", {
                startId: postNavStartOverrideId || effectiveStartNodeId,
                destinationId,
                totalMeters: route.summary?.totalMeters ?? null,
                etaMinutes: route.summary?.etaMinutes ?? null,
                prefer,
              });
              recenterToUser();
            }}
          >
            <Text style={styles.startButtonText}>{isStarted ? "Finalizar" : "Comenzar"}</Text>
          </Pressable>
        </View>
      </View>

      {showSteps ? (
        <View style={styles.stepsOverlay}>
          <View
            style={styles.stepsSheet}
          >
            <View style={styles.stepsDragHintWrap} {...stepsSheetPanResponder.panHandlers}>
              <View style={styles.stepsBridge}>
                <MaterialCommunityIcons name="menu-up" size={24} color={AppPalette.background} style={styles.stepsBridgeArrow} />
                <View style={styles.stepsBridgeRow}>
                  <View style={styles.stepsBridgeMetrics}>
                    <View style={styles.metric}>
                      <Text style={styles.metricValue}>{arrivalLabel}</Text>
                      <Text style={styles.metricLabel}>Llegada</Text>
                    </View>
                    <View style={styles.metric}>
                      <Text style={styles.metricValue}>{route.summary?.etaMinutes ?? "-"}</Text>
                      <Text style={styles.metricLabel}>min</Text>
                    </View>
                    <View style={styles.metric}>
                      <Text style={styles.metricValue}>{route.summary?.totalMeters ?? "-"}</Text>
                      <Text style={styles.metricLabel}>m</Text>
                    </View>
                  </View>
                  <Pressable onPress={() => setShowSteps(false)} style={styles.stepsClose}>
                    <Ionicons name="close" size={24} color={palette.textPrimary} />
                  </Pressable>
                </View>
              </View>
            </View>

            <View style={styles.stepsListCard}>
              <ScrollView style={styles.stepsList} contentContainerStyle={[styles.stepsContent, { paddingBottom: Math.max(insets.bottom, 12) + 18 }]}>
                {instructionItems.map((step: any, index: number) => (
                  <View
                    key={`${step?.toNodeId || step?.fromNodeId || "step"}-${index}`}
                    style={[
                      styles.stepItem,
                      index > 0 && styles.stepItemDivider,
                      index < activeStepIndex && styles.stepItemCompleted,
                      index === displayedInstructionIndex && styles.stepItemActive,
                    ]}
                  >
                    {index === displayedInstructionIndex ? <View style={styles.stepActiveBar} /> : null}
                    <View
                      style={[
                        styles.stepDot,
                        index < activeStepIndex && styles.stepDotCompleted,
                        index === displayedInstructionIndex && styles.stepDotActive,
                      ]}
                    />
                    <View style={styles.stepTextWrap}>
                      <Text
                        style={[
                          styles.stepTitle,
                          index < activeStepIndex && styles.stepTitleCompleted,
                          index === displayedInstructionIndex && styles.stepTitleActive,
                        ]}
                      >
                        {step?.title || "Continúe"}
                      </Text>
                      {step?.detail ? (
                        <Text
                          style={[
                            styles.stepDetail,
                            index < activeStepIndex && styles.stepDetailCompleted,
                            index === displayedInstructionIndex && styles.stepDetailActive,
                          ]}
                        >
                          {step.detail}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </ScrollView>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AppPalette.background },
  page: { flex: 1, padding: 16, justifyContent: "center" },
  errorTitle: { fontWeight: "700", marginBottom: 8, color: AppPalette.textPrimary },
  emptyText: { marginBottom: 8, color: AppPalette.textPrimary, fontFamily: FONT_BODY },
  primaryButton: {
    backgroundColor: AppPalette.primary,
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  primaryButtonText: { color: AppPalette.background, fontWeight: "700", fontFamily: FONT_TITLE },
  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
    gap: 8,
  },
  locationCard: {
    backgroundColor: AppPalette.surfaceAlt,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTextWrap: { flex: 1, paddingRight: 12 },
  cardLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: AppPalette.textSectionTitles,
    textTransform: "uppercase",
    fontFamily: FONT_TITLE,
  },
  cardTitle: { fontSize: 20, fontWeight: "700", color: AppPalette.textPrimary, fontFamily: FONT_TITLE },
  cardMeta: { fontSize: 13, color: AppPalette.textPrimary, marginTop: 2, fontFamily: FONT_BODY },
  cardEdit: { fontSize: 14, fontWeight: "700", color: AppPalette.primary },
  popupWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 20,
  },
  popupCard: {
    borderRadius: 18,
    backgroundColor: "#F3E8B7",
    borderWidth: 2,
    borderColor: "#C48C2E",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  popupClose: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  popupTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: AppPalette.textPrimary,
    fontFamily: FONT_TITLE,
    paddingRight: 28,
  },
  popupBody: {
    fontSize: 13,
    lineHeight: 20,
    color: AppPalette.textPrimary,
    fontFamily: FONT_BODY,
  },
  popupButton: {
    alignSelf: "flex-start",
    borderRadius: 12,
    backgroundColor: AppPalette.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  popupButtonText: {
    fontSize: 14,
    fontWeight: "800",
    color: AppPalette.background,
    fontFamily: FONT_BODY,
  },
  startDropdown: {
    borderRadius: 16,
    backgroundColor: AppPalette.surfaceAlt,
    padding: 10,
    maxHeight: 280,
  },
  startSearchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    backgroundColor: AppPalette.background,
    borderWidth: 1,
    borderColor: AppPalette.lines,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  startSearchInput: {
    flex: 1,
    fontSize: 14,
    color: AppPalette.textPrimary,
    fontFamily: FONT_BODY,
  },
  startOptionsScroll: { marginTop: 8 },
  startOptionsContent: { gap: 8 },
  startOptionRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: AppPalette.lines,
    backgroundColor: AppPalette.background,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  startOptionRowActive: { borderColor: AppPalette.primary, borderWidth: 2 },
  startOptionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: AppPalette.textPrimary,
    fontFamily: FONT_TITLE,
  },
  startOptionMeta: {
    marginTop: 2,
    fontSize: 12,
    color: AppPalette.textSectionTitles,
    fontFamily: FONT_BODY,
  },
  currentLocationOption: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: AppPalette.lines,
    backgroundColor: AppPalette.background,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  currentLocationOptionText: {
    fontSize: 13,
    fontWeight: "700",
    color: AppPalette.primary,
    fontFamily: FONT_BODY,
  },
  currentLocationFloorPrompt: {
    marginTop: 8,
    borderRadius: 16,
    backgroundColor: "#EAF4FB",
    borderWidth: 2,
    borderColor: AppPalette.primary,
    padding: 14,
    gap: 10,
    shadowColor: "#0D3A5A",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  currentLocationFloorPromptTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: AppPalette.primary,
    fontFamily: FONT_TITLE,
  },
  currentLocationFloorPromptBody: {
    fontSize: 12,
    lineHeight: 18,
    color: AppPalette.textPrimary,
    fontFamily: FONT_BODY,
  },
  currentLocationFloorPromptActions: { flexDirection: "row", gap: 8 },
  currentLocationFloorButton: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: AppPalette.primary,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  currentLocationFloorButtonText: { fontSize: 14, fontWeight: "800", color: "#FFFFFF", fontFamily: FONT_BODY },
  mapWrap: { flex: 1, minHeight: 300, overflow: "hidden", position: "relative" },
  instructionBanner: {
    position: "absolute",
    left: 10,
    right: 10,
    zIndex: 2,
    backgroundColor: AppPalette.primary,
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  instructionRow: { flexDirection: "row", alignItems: "center" },
  instructionIconWrap: { width: 48, height: 48, marginRight: 10, alignItems: "center", justifyContent: "center" },
  instructionIcon: { textAlign: "center" },
  instructionTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "800",
    color: AppPalette.textPrimary,
    fontFamily: FONT_TITLE,
    flexShrink: 1,
    lineHeight: 22,
  },
  instructionDetail: {
    fontSize: 14,
    color: AppPalette.textPrimary,
    marginTop: 2,
    fontWeight: "600",
    textAlign: "left",
    fontFamily: FONT_BODY,
    marginLeft: 52,
  },
  mapActions: {
    position: "absolute",
    right: 16,
    top: 130,
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.55)",
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  mapActionButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: AppPalette.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    borderWidth: 2,
    borderColor: "#000000",
  },
  mapActionBadge: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 3,
    fontSize: 10,
    fontWeight: "900",
    color: AppPalette.background,
    textAlign: "center",
  },
  targetButton: {
    position: "absolute",
    left: 18,
    bottom: 22,
    zIndex: 3,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: AppPalette.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  targetButtonActive: { backgroundColor: AppPalette.primary, borderWidth: 2, borderColor: "#000000" },
  targetButtonInactive: { backgroundColor: "#ffffff", borderWidth: 2, borderColor: AppPalette.primary },
  mapStatusWrap: {
    position: "absolute",
    right: 24,
    bottom: 24,
    zIndex: 4,
    alignItems: "flex-end",
    gap: 8,
  },
  statusPill: {
    backgroundColor: AppPalette.primary,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  statusPillInteractive: { backgroundColor: "#2A7C8E" },
  statusPillText: { fontSize: 16, fontWeight: "800", color: AppPalette.background, fontFamily: FONT_TITLE },
  floorSwitchRow: {
    position: "absolute",
    right: 24,
    bottom: 24,
    zIndex: 4,
    flexDirection: "row",
    gap: 8,
  },
  floorPillButton: { position: "relative", right: 0, bottom: 0, zIndex: 4 },
  floorPillButtonInactive: { backgroundColor: AppPalette.background },
  floorPillTextInactive: { color: AppPalette.textPrimary },
  bottomBar: {
    backgroundColor: AppPalette.primary,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 0,
    paddingBottom: 0,
    marginTop: 2,
  },
  sheetHandle: { alignItems: "center", paddingBottom: 0 },
  handleArrow: { transform: [{ scaleX: 2 }], marginBottom: -6 },
  handleText: {
    color: AppPalette.background,
    fontWeight: "900",
    fontSize: 15,
    fontFamily: FONT_TITLE,
    transform: [{ translateY: -4 }],
  },
  metricsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 5, transform: [{ translateY: 8 }] },
  metric: { minWidth: 56 },
  metricValue: { fontSize: 22, fontWeight: "800", color: AppPalette.background, fontFamily: FONT_TITLE },
  metricLabel: { fontSize: 12, fontWeight: "700", color: AppPalette.background, fontFamily: FONT_BODY },
  startButton: {
    backgroundColor: AppPalette.background,
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  startButtonText: { fontSize: 16, fontWeight: "800", color: AppPalette.textPrimary, fontFamily: FONT_TITLE },
  stepsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(6, 34, 44, 0.28)",
    justifyContent: "flex-end",
  },
  stepsSheet: {
    flex: 1,
    flexDirection: "column",
    backgroundColor: AppPalette.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 0,
    marginTop: 72,
  },
  stepsDragHintWrap: { alignItems: "center", justifyContent: "center", paddingBottom: 0 },
  stepsBridge: {
    width: "100%",
    backgroundColor: AppPalette.primary,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingTop: 2,
    paddingBottom: 12,
    paddingHorizontal: 12,
  },
  stepsBridgeArrow: { alignSelf: "center", transform: [{ scaleX: 2 }], marginBottom: -1 },
  stepsBridgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  stepsBridgeMetrics: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 28,
    flex: 1,
  },

  stepsClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppPalette.surfaceAlt,
  },
  stepsListCard: {
    flex: 1,
    marginTop: 0,
    borderRadius: 0,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#9CCAD8",
    backgroundColor: "#E6F3F7",
  },
  stepsList: { marginTop: 0, flex: 1 },
  stepsContent: { gap: 0, paddingBottom: 14 },
  stepItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 0,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#E6F3F7",
  },
  stepItemDivider: { borderTopWidth: 1, borderTopColor: "#8EC6D4" },
  stepItemCompleted: { backgroundColor: "#EEF5F8" },
  stepItemActive: { backgroundColor: "#D8EBF2" },
  stepActiveBar: {
    width: 4,
    borderRadius: 2,
    alignSelf: "stretch",
    backgroundColor: AppPalette.primary,
    marginRight: 8,
  },
  stepDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
    backgroundColor: AppPalette.primary,
  },
  stepDotCompleted: { backgroundColor: "#AEBFC8" },
  stepDotActive: { backgroundColor: AppPalette.textSectionTitles },
  stepTextWrap: { flex: 1 },
  stepTitle: { fontSize: 16, fontWeight: "700", color: AppPalette.textPrimary, fontFamily: FONT_TITLE },
  stepTitleCompleted: { color: "#7A8A92" },
  stepTitleActive: { color: AppPalette.textSectionTitles },
  stepDetail: { fontSize: 13, color: AppPalette.textSectionTitles, marginTop: 2, fontFamily: FONT_BODY },
  stepDetailCompleted: { color: "#93A4AC" },
  stepDetailActive: { color: AppPalette.textPrimary },
});



