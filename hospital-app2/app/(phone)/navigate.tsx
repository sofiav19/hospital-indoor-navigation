import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, TextInput, PanResponder, Platform } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavStore } from "../../store/navStore";
import IndoorMap from "../../components/map/IndoorMap";
import { computeRoute } from "../../lib/route/routeEngine";
import { buildDetailedInstruction as buildSharedDetailedInstruction } from "../../lib/route/navigationInstructions";
import { AppPalette } from "../../constants/theme";
import { projectCoordsForMap, projectGeoJSONForMap } from "../../lib/coords/localToLngLat";

let LocationImpl: any = null;

try {
  LocationImpl = require("expo-location");
} catch {
  LocationImpl = null;
}

const NODE_CONFIRM_RADIUS_METERS = 0.3;
const REROUTE_SNAP_RADIUS_METERS = 1.25;
const STEP_TARGET_RADIUS_METERS = 1.0;
const STEP_PROGRESS_MIN = 0.97;
const STEP_PROGRESS_WITH_RADIUS_MIN = 0.88;
const STEP_PROGRESS_RADIUS_METERS = 1.8;
const SEGMENT_TUBE_RADIUS_METERS = 1.3;
const OFF_ROUTE_RADIUS_METERS = 2.1;
const ARRIVAL_COMPLETE_RADIUS_METERS = 1.0;
const TRANSITION_ZONE_RADIUS_METERS = 2.0;
const FONT_TITLE = Platform.select({ ios: "SF Pro Display", default: "sans-serif-medium" });
const FONT_BODY = Platform.select({ ios: "Inter", default: "sans-serif" });

function distanceMeters(a: [number, number], b: [number, number]) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

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

function getHeadingFromSegment(coords: [number, number][], point?: [number, number] | null) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;

  let start = coords[0];
  let end = coords[coords.length - 1];

  if (point) {
    let bestDistanceSq = Infinity;
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1];
      const b = coords[i];
      const segX = b[0] - a[0];
      const segY = b[1] - a[1];
      const segLenSq = segX * segX + segY * segY;
      if (segLenSq <= 0) continue;

      const tRaw = ((point[0] - a[0]) * segX + (point[1] - a[1]) * segY) / segLenSq;
      const t = Math.max(0, Math.min(1, tRaw));
      const projX = a[0] + segX * t;
      const projY = a[1] + segY * t;
      const dx = point[0] - projX;
      const dy = point[1] - projY;
      const distSq = dx * dx + dy * dy;

      if (distSq < bestDistanceSq) {
        bestDistanceSq = distSq;
        start = a;
        end = b;
      }
    }
  }

  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return 0;

  const bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

function headingToCardinal(heading: number) {
  const normalized = ((heading % 360) + 360) % 360;
  if (normalized >= 45 && normalized < 135) return "este";
  if (normalized >= 135 && normalized < 225) return "sur";
  if (normalized >= 225 && normalized < 315) return "oeste";
  return "norte";
}

function normalizeAngleDelta(delta: number) {
  if (delta > 180) return delta - 360;
  if (delta < -180) return delta + 360;
  return delta;
}

function smoothHeading(previous: number | null, next: number) {
  if (!Number.isFinite(next)) return previous;
  if (previous === null || !Number.isFinite(previous)) return next;

  const delta = normalizeAngleDelta(next - previous);
  const absDelta = Math.abs(delta);
  if (absDelta < 1) return previous;

  // Dynamic smoothing: track fast real turns without becoming jittery when near target.
  const gain = absDelta > 45 ? 0.55 : absDelta > 20 ? 0.35 : 0.22;
  return (previous + delta * gain + 360) % 360;
}

function getSegmentTurnHint(currentSegment: any, nextSegment: any) {
  const currentCoords = currentSegment?.geojson?.features?.[0]?.geometry?.coordinates || [];
  const nextCoords = nextSegment?.geojson?.features?.[0]?.geometry?.coordinates || [];

  if (!Array.isArray(currentCoords) || currentCoords.length < 2) return "forward" as const;
  if (!Array.isArray(nextCoords) || nextCoords.length < 2) return "forward" as const;

  const currentHeading = getHeadingFromSegment(currentCoords);
  const nextHeading = getHeadingFromSegment(nextCoords);
  const delta = normalizeAngleDelta(nextHeading - currentHeading);
  const absDelta = Math.abs(delta);

  if (absDelta < 22) return "forward" as const;
  if (delta < 0) return absDelta >= 60 ? ("left" as const) : ("left-forward" as const);
  return absDelta >= 60 ? ("right" as const) : ("right-forward" as const);
}

function getTurnFromPreviousSegment(previousSegment: any, currentSegment: any) {
  if (!previousSegment || !currentSegment) return "forward" as const;

  const previousCoords = previousSegment?.geojson?.features?.[0]?.geometry?.coordinates || [];
  const currentCoords = currentSegment?.geojson?.features?.[0]?.geometry?.coordinates || [];

  if (!Array.isArray(previousCoords) || previousCoords.length < 2) return "forward" as const;
  if (!Array.isArray(currentCoords) || currentCoords.length < 2) return "forward" as const;

  const previousHeading = getHeadingFromSegment(previousCoords);
  const currentHeading = getHeadingFromSegment(currentCoords);
  const delta = normalizeAngleDelta(currentHeading - previousHeading);
  const absDelta = Math.abs(delta);

  if (absDelta < 22) return "forward" as const;
  if (delta < 0) return absDelta >= 60 ? ("left" as const) : ("left-forward" as const);
  return absDelta >= 60 ? ("right" as const) : ("right-forward" as const);
}

function getNearestNodeId(
  nodes: any,
  point: [number, number],
  floor: number | null,
  destinationId?: string | null,
  allowedIds?: Set<string>,
  maxDistanceMeters?: number
) {
  const features = nodes?.features || [];
  const hasAllowedIds = Boolean(allowedIds?.size);
  const isExcludedRole = (role: string | undefined) => role === "door" || role === "doors";

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
    const role = feature?.properties?.role;
    return !isExcludedRole(role);
  };

  const sameFloorCandidate = (feature: any) => {
    if (!baseCandidate(feature)) return false;
    if (floor === null) return true;
    return (feature?.properties?.floor ?? null) === floor;
  };

  return (
    (destinationId
      ? pickClosest((feature) => sameFloorCandidate(feature) && feature?.properties?.id === destinationId)
      : null) ||
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

function getLookAheadCoordOnSegment(
  point: [number, number],
  coords: [number, number][],
  lookAheadMeters = 2.4
) {
  if (!Array.isArray(coords) || coords.length < 2) return null;

  let bestDistanceSq = Infinity;
  let bestSegmentIndex = 0;
  let bestT = 0;

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

    if (distSq < bestDistanceSq) {
      bestDistanceSq = distSq;
      bestSegmentIndex = i - 1;
      bestT = t;
    }
  }

  let remainingMeters = lookAheadMeters;
  let startIndex = bestSegmentIndex;
  let startT = bestT;

  while (startIndex < coords.length - 1) {
    const start = coords[startIndex];
    const end = coords[startIndex + 1];
    const segX = end[0] - start[0];
    const segY = end[1] - start[1];
    const segLen = Math.sqrt(segX * segX + segY * segY);
    if (segLen <= 0) {
      startIndex += 1;
      startT = 0;
      continue;
    }

    const usableSegLen = segLen * (1 - startT);
    if (remainingMeters <= usableSegLen) {
      const t = startT + remainingMeters / segLen;
      return [start[0] + segX * t, start[1] + segY * t] as [number, number];
    }

    remainingMeters -= usableSegLen;
    startIndex += 1;
    startT = 0;
  }

  return coords[coords.length - 1] || null;
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

function getNodeFeature(nodes: any, nodeId: string | null) {
  if (!nodeId) return null;
  return (nodes?.features || []).find((feature: any) => feature?.properties?.id === nodeId) || null;
}

function getNodeLabel(nodes: any, nodeId: string | null) {
  return getNodeFeature(nodes, nodeId)?.properties?.label || null;
}

function getNodeRole(nodes: any, nodeId: string | null) {
  return getNodeFeature(nodes, nodeId)?.properties?.role || null;
}

function isCrossFloorSegment(segment: any) {
  const fromFloor = segment?.floor ?? null;
  const toFloor = segment?.toFloor ?? null;
  return fromFloor !== null && toFloor !== null && fromFloor !== toFloor;
}

function segmentTouchesFloor(segment: any, floor: number | null) {
  if (!segment || floor === null) return true;
  return segment?.floor === floor || segment?.toFloor === floor;
}

function buildInstructionFromSegment(segment: any, nodes: any, destinationId: string | null) {
  if (!segment) return null;

  const fromFloor = segment?.floor ?? null;
  const toFloor = segment?.toFloor ?? fromFloor;
  const fromNodeId = segment?.fromNodeId ?? null;
  const toNodeId = segment?.toNodeId ?? null;
  const fromLabel = getNodeLabel(nodes, fromNodeId);
  const toLabel = getNodeLabel(nodes, toNodeId);
  const transitionRole = getNodeRole(nodes, fromNodeId) || getNodeRole(nodes, toNodeId);
  const isCrossFloor = isCrossFloorSegment(segment);
  const isArrival = Boolean(destinationId && toNodeId === destinationId);

  const segmentMeters =
    typeof segment?.meters === "number"
      ? Math.round(segment.meters)
      : typeof segment?.distanceMeters === "number"
        ? Math.round(segment.distanceMeters)
        : null;

  let title = "Continúe";
  let detail: string | null = segmentMeters !== null ? `Aproximadamente ${segmentMeters} m` : null;

  if (isCrossFloor) {
    const goingUp = (toFloor ?? 0) > (fromFloor ?? 0);
    if (transitionRole === "elevator") {
      title = goingUp
        ? `Tome el ascensor a la planta ${toFloor}`
        : `Tome el ascensor hacia la planta ${toFloor}`;
    } else if (transitionRole === "stairs") {
      title = goingUp
        ? `Suba por las escaleras a la planta ${toFloor}`
        : `Baje por las escaleras a la planta ${toFloor}`;
    } else {
      title = `Vaya a la planta ${toFloor}`;
    }
    detail = null;
  } else if (isArrival) {
    title = `Ha llegado a ${toLabel || "su destino"}`;
    detail = null;
  } else if (toLabel && fromLabel && toLabel !== fromLabel) {
    title = `Continúe hacia ${toLabel}`;
    detail = segmentMeters !== null ? `Aproximadamente ${segmentMeters} m` : null;
  } else if (toLabel) {
    title = `Diríjase hacia ${toLabel}`;
    detail = segmentMeters !== null ? `Aproximadamente ${segmentMeters} m` : null;
  } else if (toFloor !== null) {
    title = `Continúe en la planta ${toFloor}`;
    detail = segmentMeters !== null ? `Aproximadamente ${segmentMeters} m` : null;
  }

  return {
    title,
    detail,
    fromFloor,
    toFloor,
    fromNodeId,
    toNodeId,
  };
}

function buildDetailedInstruction(
  segment: any,
  previousSegment: any,
  nextSegment: any,
  nodes: any,
  destinationId: string | null
) {
  const base = buildInstructionFromSegment(segment, nodes, destinationId);
  if (!base) return null;

  const isCrossFloor = isCrossFloorSegment(segment);
  const isArrival = Boolean(destinationId && segment?.toNodeId === destinationId);
  const transitionRole = getNodeRole(nodes, segment?.fromNodeId) || getNodeRole(nodes, segment?.toNodeId);
  const toFloor = segment?.toFloor ?? segment?.floor ?? null;
  const segmentMeters =
    typeof segment?.meters === "number"
      ? Math.round(segment.meters)
      : typeof segment?.distanceMeters === "number"
        ? Math.round(segment.distanceMeters)
        : null;

  const currentCoords = segment?.geojson?.features?.[0]?.geometry?.coordinates || [];
  const heading = Array.isArray(currentCoords) && currentCoords.length >= 2 ? getHeadingFromSegment(currentCoords) : 0;
  const headingCardinal = headingToCardinal(heading);

  let maneuver: "forward" | "left" | "right" | "left-forward" | "right-forward" | "up" | "down" | "arrive" =
    getTurnFromPreviousSegment(previousSegment, segment);

  if (isCrossFloor) {
    const fromFloor = segment?.floor ?? null;
    const goingUp = (toFloor ?? 0) > (fromFloor ?? 0);
    maneuver = goingUp ? "up" : "down";
  }

  if (isArrival) {
    maneuver = "arrive";
  }

  let title = base.title;
  let detail = base.detail || null;

  if (isArrival) {
    title = `Ha llegado a ${getNodeLabel(nodes, segment?.toNodeId) || "su destino"}`;
    detail = "Siga la señalización del área para la orientación final.";
  } else if (isCrossFloor) {
    if (transitionRole === "elevator") {
      title = maneuver === "up"
        ? `Tome el ascensor a la planta ${toFloor}`
        : `Tome el ascensor hacia la planta ${toFloor}`;
      detail = "Espere junto al ascensor y continúe al salir.";
    } else if (transitionRole === "stairs") {
      title = maneuver === "up"
        ? `Suba por las escaleras a la planta ${toFloor}`
        : `Baje por las escaleras a la planta ${toFloor}`;
      detail = "Manténgase a la derecha al usar la escalera.";
    } else {
      title = `Cambie a la planta ${toFloor}`;
      detail = "Siga la indicación de planta y continúe la ruta.";
    }
  } else {
    if (maneuver === "left") {
      title = `Gire a la izquierda y continúe ${segmentMeters ?? ""}${segmentMeters ? " m" : ""}`.trim();
    } else if (maneuver === "right") {
      title = `Gire a la derecha y continúe ${segmentMeters ?? ""}${segmentMeters ? " m" : ""}`.trim();
    } else if (maneuver === "left-forward") {
      title = `Leve giro a la izquierda y avance ${segmentMeters ?? ""}${segmentMeters ? " m" : ""}`.trim();
    } else if (maneuver === "right-forward") {
      title = `Leve giro a la derecha y avance ${segmentMeters ?? ""}${segmentMeters ? " m" : ""}`.trim();
    } else {
      title = `Avance recto ${segmentMeters ? `durante ${segmentMeters} m` : ""}`.trim();
    }

    const toLabel = getNodeLabel(nodes, segment?.toNodeId);
    const nextTurn = getSegmentTurnHint(segment, nextSegment);
    const nextTurnText =
      nextTurn === "left"
        ? "Próximo giro: izquierda."
        : nextTurn === "right"
          ? "Próximo giro: derecha."
          : nextTurn === "left-forward"
            ? "Próximo desvío suave: izquierda."
            : nextTurn === "right-forward"
              ? "Próximo desvío suave: derecha."
              : "Continúe por el pasillo principal.";

    detail = `${toLabel ? `Diríjase hacia ${toLabel}. ` : ""}Dirección ${headingCardinal}. ${nextTurnText}`.trim();
  }

  return {
    ...base,
    title,
    detail,
    maneuver,
  };
}

function getInstructionIconName(maneuver?: string | null) {
  switch (maneuver) {
    case "left":
      return "arrow-top-left";
    case "right":
      return "arrow-top-right";
    case "left-forward":
      return "arrow-top-left";
    case "right-forward":
      return "arrow-top-right";
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
  const [showSteps, setShowSteps] = useState(false);
  const [showStartDropdown, setShowStartDropdown] = useState(false);
  const [startQuery, setStartQuery] = useState("");
  const [confirmedNodeId, setConfirmedNodeId] = useState<string | null>(null);
  const [lastPassedNodeId, setLastPassedNodeId] = useState<string | null>(null);
  const [isFollowingUser, setIsFollowingUser] = useState(false);
  const [lockedHeading, setLockedHeading] = useState(0);
  const [committedFloorLock, setCommittedFloorLock] = useState<number | null>(null);
  const [transitionFloorLock, setTransitionFloorLock] = useState<number | null>(null);
  const [hasManualFloorSelection, setHasManualFloorSelection] = useState(false);
  const [showRerouteNotice, setShowRerouteNotice] = useState(false);
  const [recenterTick, setRecenterTick] = useState(0);
  const [isManualMapControl, setIsManualMapControl] = useState(false);
  const [sensorHeading, setSensorHeading] = useState<number | null>(null);
  const [smoothedLiveHeading, setSmoothedLiveHeading] = useState<number | null>(null);
  const [recenterHeading, setRecenterHeading] = useState(0);
  const [recenterRequestedAt, setRecenterRequestedAt] = useState(0);
  const [locationPermissionGranted, setLocationPermissionGranted] = useState<boolean | null>(null);
  const [headingWatchError, setHeadingWatchError] = useState<string | null>(null);
  const [hasHeadingSample, setHasHeadingSample] = useState(false);
  const [showHeadingWarning, setShowHeadingWarning] = useState(false);

  const recenterToUser = useCallback(() => {
    setRecenterHeading(lockedHeading);
    setIsManualMapControl(false);
    setIsFollowingUser(true);
    setRecenterRequestedAt(Date.now());
    setRecenterTick((value) => value + 1);
  }, [lockedHeading]);

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

  const setNavigationStarted = useNavStore((s) => s.setNavigationStarted);
  const setNavigationPreference = useNavStore((s) => s.setNavigationPreference);
  const setMapViewMode = useNavStore((s) => s.setMapViewMode);
  const toggleNavigationPreference = useNavStore((s) => s.toggleNavigationPreference);
  const setSoundEnabled = useNavStore((s) => s.setSoundEnabled);
  const setActiveStepIndex = useNavStore((s) => s.setActiveStepIndex);
  const setNavigationFloor = useNavStore((s) => s.setNavigationFloor);
  const setLiveFloor = useNavStore((s) => s.setLiveFloor);

  const lastRerouteAtRef = useRef(0);
  const lastDestinationIdRef = useRef<string | null>(destinationId ?? null);
  const rerouteNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasHandledArrivalRef = useRef(false);
  const navigationStartedAtRef = useRef(0);

  const effectiveStartNodeId = postNavStartOverrideId || start.nodeId || "n_hospital_entrance_f0";

  useEffect(() => {
    setMapViewMode("navigate");
  }, [setMapViewMode]);

  const userCoord = useMemo(() => {
    if (!navData.nodes) return null;
    if (livePosition.provider !== "none" && livePosition.coords) return livePosition.coords;
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

  const recenterTargetCoord = useMemo(() => {
    if (!isStarted) return mapUserCoord;
    if (!Array.isArray(segments) || !segments.length) return mapUserCoord;

    for (let i = Math.max(0, activeStepIndex); i < segments.length; i++) {
      const segment = segments[i];
      if (!segmentTouchesFloor(segment, currentFloor)) continue;

      const segmentCoords = segment?.geojson?.features?.[0]?.geometry?.coordinates || [];
      if (!Array.isArray(segmentCoords) || segmentCoords.length < 2) continue;

      const localTarget =
        userCoord && i === activeStepIndex
          ? getLookAheadCoordOnSegment(userCoord, segmentCoords)
          : segmentCoords[Math.min(1, segmentCoords.length - 1)] ?? segmentCoords[0];

      if (!localTarget) continue;
      return projectCoordsForMap(localTarget);
    }

    return mapUserCoord;
  }, [activeStepIndex, currentFloor, isStarted, mapUserCoord, segments, userCoord]);

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

  const startNodeOptions = useMemo(() => {
    const features = navData.nodes?.features || [];
    return features
      .filter((feature: any) => {
        const role = feature?.properties?.role;
        return ["door", "doors", "junction", "elevator", "stairs"].includes(role);
      })
      .map((feature: any) => ({
        id: feature.properties?.id,
        label: feature.properties?.label || feature.properties?.id || "Nodo",
        floor: feature.properties?.floor ?? null,
      }))
      .filter((item: any) => Boolean(item.id));
  }, [navData.nodes]);

  const entranceStartOptions = useMemo(() => {
    return startNodeOptions.filter((item: any) => {
      const label = String(item.label || "").toLowerCase();
      const id = String(item.id || "").toLowerCase();
      return label.includes("entrance") || label.includes("entrada") || id.includes("entrance") || id.includes("entrada");
    });
  }, [startNodeOptions]);

  const searchedStartOptions = useMemo(() => {
    const q = startQuery.trim().toLowerCase();
    if (!q) return [];

    return startNodeOptions.filter((item: any) => {
      const floorText = item.floor === null ? "" : `planta ${item.floor}`;
      const haystack = `${String(item.label).toLowerCase()} ${String(item.id).toLowerCase()} ${floorText}`;
      return haystack.includes(q);
    });
  }, [startNodeOptions, startQuery]);

  const nearestCurrentLocationStart = useMemo(() => {
    if (!livePosition.coords || !startNodeOptions.length || !navData.nodes) return null;

    const [userX, userY] = livePosition.coords;
    let nearest: (typeof startNodeOptions)[number] | null = null;
    let nearestDistanceSq = Infinity;

    for (const option of startNodeOptions) {
      const feature = navData.nodes.features?.find((node: any) => node.properties?.id === option.id);
      const coords = feature?.geometry?.coordinates;
      if (!coords) continue;

      const dx = coords[0] - userX;
      const dy = coords[1] - userY;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq;
        nearest = option;
      }
    }

    return nearest;
  }, [livePosition.coords, navData.nodes, startNodeOptions]);

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
    () => currentFloor ?? livePosition.floor ?? confirmedNodeFeature?.properties?.floor ?? null,
    [confirmedNodeFeature, currentFloor, livePosition.floor]
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

    for (let i = clampedActiveIndex; i < segments.length; i++) {
      if (segmentTouchesFloor(segments[i], currentFloor)) return i;
    }

    return clampedActiveIndex;
  }, [
    activeStepIndex,
    currentFloor,
    hasManualFloorSelection,
    instructionItems.length,
    segments,
  ]);

  const nextInstruction = instructionItems[displayedInstructionIndex] || null;
  const instructionIconName = getInstructionIconName(nextInstruction?.maneuver);

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
      const result = computeRoute(navData.nodes, navData.edges, startId, destinationId, { prefer: effectivePrefer });

      if (!result.ok) {
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

      setRoute({
        ok: true,
        geojson: projectGeoJSONForMap(result.routeGeojson),
        currentFloorGeojson: projectGeoJSONForMap(result.currentFloorGeojson),
        futureFloorGeojson: projectGeoJSONForMap(result.futureFloorGeojson),
        routeNodesGeojson: projectGeoJSONForMap(result.routeNodesGeojson),
        summary: result.summary,
        reason,
      });

      setActiveStepIndex(0);
      return true;
    },
    [destinationId, navData.edges, navData.nodes, prefer, setActiveStepIndex, setRoute]
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
    if (showRerouteNotice) return "Recalculando ruta...";
    if (isStarted && visibleFloorOptions.length > 1) {
      const roleLabel = visibleFloorOptions[0]?.role || "transición";
      const floorsText = visibleFloorOptions.map((option: any) => `P${option.floor}`).join(" / ");
      return `Cerca de ${roleLabel} · Presione para ver vista previa ${floorsText}`;
    }
    return `Planta ${currentFloor ?? "-"}`;
  }, [currentFloor, isStarted, showRerouteNotice, visibleFloorOptions]);

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

  const headingStatusMessage = useMemo(() => {
    if (!showHeadingWarning) return null;
    if (typeof optitrackHeading === "number") return null;
    if (typeof sensorHeading === "number") return null;
    if (LocationImpl && !locationPermissionGranted) return "Active ubicación para orientar mejor";
    if (headingWatchError) return "Sensor no disponible";
    if (LocationImpl && locationPermissionGranted && !hasHeadingSample) {
      return "Calibre la brújula moviendo el teléfono en un 8";
    }
    return "Orientación no disponible";
  }, [
    hasHeadingSample,
    headingWatchError,
    locationPermissionGranted,
    optitrackHeading,
    sensorHeading,
    showHeadingWarning,
  ]);

  useEffect(() => {
    if (typeof liveMapHeading !== "number" || !Number.isFinite(liveMapHeading)) {
      setSmoothedLiveHeading(null);
      return;
    }

    setSmoothedLiveHeading((previous) => smoothHeading(previous, liveMapHeading));
  }, [liveMapHeading]);

  useEffect(() => {
    if (typeof optitrackHeading === "number" || typeof sensorHeading === "number") {
      setShowHeadingWarning(false);
      return;
    }

    const timeout = setTimeout(() => {
      setShowHeadingWarning(true);
    }, 5000);

    return () => clearTimeout(timeout);
  }, [optitrackHeading, sensorHeading, locationPermissionGranted, headingWatchError, hasHeadingSample]);

  const arrivalLabel = useMemo(() => {
    const etaMinutes = route.summary?.etaMinutes;
    if (!etaMinutes) return "--:--";

    const now = new Date();
    now.setMinutes(now.getMinutes() + etaMinutes);
    return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, [route.summary?.etaMinutes]);

  const startedRouteLayers = useMemo(() => {
    const primarySegment = segments[displayedInstructionIndex] || null;

    const primaryFeatures =
      primarySegment && segmentTouchesFloor(primarySegment, currentFloor)
        ? primarySegment?.geojson?.features || []
        : [];

    const secondaryFeatures = segments
      .filter((segment: any, index: number) => {
        if (index === displayedInstructionIndex) return false;
        return segmentTouchesFloor(segment, currentFloor);
      })
      .flatMap((segment: any) => segment?.geojson?.features || []);

    return {
      primary: primaryFeatures.length
        ? projectGeoJSONForMap({
            type: "FeatureCollection",
            features: primaryFeatures,
          })
        : route.currentFloorGeojson || route.geojson,
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
  }, [currentFloor, displayedInstructionIndex, route.currentFloorGeojson, route.geojson, segments]);

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
        if (isMounted) {
          setLocationPermissionGranted(granted);
          setHeadingWatchError(null);
        }

        if (!granted) {
          const requestedPermission = await LocationImpl.requestForegroundPermissionsAsync();
          granted = requestedPermission?.granted === true;
          if (isMounted) {
            setLocationPermissionGranted(granted);
          }
        }

        if (!isMounted || !granted) return;

        const initialHeading = await LocationImpl.getHeadingAsync();
        const initialValue =
          typeof initialHeading?.trueHeading === "number" && initialHeading.trueHeading >= 0
            ? initialHeading.trueHeading
            : typeof initialHeading?.magHeading === "number"
              ? initialHeading.magHeading
              : null;

        if (isMounted && typeof initialValue === "number") {
          setSensorHeading(initialValue);
          setHasHeadingSample(true);
        }

        subscription = await LocationImpl.watchHeadingAsync((heading: any) => {
          if (!isMounted) return;

          const nextHeading =
            typeof heading?.trueHeading === "number" && heading.trueHeading >= 0
              ? heading.trueHeading
              : typeof heading?.magHeading === "number"
                ? heading.magHeading
                : null;

          if (typeof nextHeading === "number") {
            setSensorHeading(nextHeading);
            setHasHeadingSample(true);
            setHeadingWatchError(null);
          }
        });
      } catch {
        if (isMounted) {
          setSensorHeading(null);
          setHeadingWatchError("Sensor no disponible");
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
    if (!isStarted) return;
    if (hasManualFloorSelection && transitionFloorLock !== null) return;

    if (visibleFloorOptions.length <= 1) {
      if (transitionFloorLock !== null) setTransitionFloorLock(null);
      if (hasManualFloorSelection) setHasManualFloorSelection(false);
    }
  }, [hasManualFloorSelection, isStarted, transitionFloorLock, visibleFloorOptions.length]);

  useEffect(() => {
    if (!isStarted) return;

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
    setLiveFloor,
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
    if (!segments.length) return;
    if (activeStepIndex >= segments.length) return;

    const currentSegment = segments[activeStepIndex];
    const segmentCoords = currentSegment?.geojson?.features?.[0]?.geometry?.coordinates || [];
    if (!Array.isArray(segmentCoords) || segmentCoords.length < 2) return;

    const targetCoord = segmentCoords[segmentCoords.length - 1];
    const distToTarget = distanceMeters(userCoord, targetCoord);
    const progress = getProgressAlongPolyline(userCoord, segmentCoords);
    const segmentTubeDistance = distanceToPolyline(userCoord, segmentCoords);
    const reachedConfirmedTarget = confirmedNodeId === currentSegment?.toNodeId;

    const shouldAdvance =
      reachedConfirmedTarget ||
      distToTarget <= STEP_TARGET_RADIUS_METERS ||
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
  ]);

  useEffect(() => {
    if (!isStarted || !userCoord) return;
    if (hasManualFloorSelection && transitionFloorLock !== null) return;

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

    const offRouteDistance = Math.min(currentDistance, remainingDistance);
    if (offRouteDistance <= OFF_ROUTE_RADIUS_METERS) return;

    const now = Date.now();
    if (now - lastRerouteAtRef.current < 2000) return;

    const confirmedNodeOnCurrentFloor = isNodeOnFloor(navData.nodes, confirmedNodeId, currentFloor)
      ? confirmedNodeId
      : null;

    const lastPassedNodeOnCurrentFloor = isNodeOnFloor(navData.nodes, lastPassedNodeId, currentFloor)
      ? lastPassedNodeId
      : null;

    const rerouteStartId =
      (currentInstructionNodeIds.size
        ? getNearestNodeId(
            navData.nodes,
            userCoord,
            currentFloor,
            destinationId,
            currentInstructionNodeIds,
            REROUTE_SNAP_RADIUS_METERS
          )
        : null) ||
      getNearestNodeId(
        navData.nodes,
        userCoord,
        currentFloor,
        destinationId,
        forwardAllowedNodeIds,
        REROUTE_SNAP_RADIUS_METERS
      ) ||
      confirmedNodeOnCurrentFloor ||
      lastPassedNodeOnCurrentFloor ||
      getNearestNodeId(
        navData.nodes,
        userCoord,
        currentFloor,
        destinationId,
        forwardAllowedNodeIds
      );

    if (!rerouteStartId || !destinationId) return;

    lastRerouteAtRef.current = now;
    if (rerouteStartId !== confirmedNodeId) setConfirmedNodeId(rerouteStartId);
    if (rerouteStartId !== lastPassedNodeId) setLastPassedNodeId(rerouteStartId);

    setShowRerouteNotice(true);
    if (rerouteNoticeTimeoutRef.current) clearTimeout(rerouteNoticeTimeoutRef.current);
    rerouteNoticeTimeoutRef.current = setTimeout(() => {
      setShowRerouteNotice(false);
    }, 1800);

    computeAndStoreRoute(rerouteStartId, "recalculating");
  }, [
    activeStepIndex,
    computeAndStoreRoute,
    confirmedNodeId,
    currentFloor,
    currentInstructionNodeIds,
    destinationId,
    forwardAllowedNodeIds,
    hasManualFloorSelection,
    isStarted,
    lastPassedNodeId,
    navData.nodes,
    route.geojson,
    segments,
    transitionFloorLock,
    userCoord,
  ]);

  useEffect(() => {
    if (!isStarted) {
      hasHandledArrivalRef.current = false;
      navigationStartedAtRef.current = 0;
      return;
    }

    if (!navigationStartedAtRef.current) {
      navigationStartedAtRef.current = Date.now();
    }

    if (!destinationId || !destinationFeature?.geometry?.coordinates || !userCoord) return;
    if (hasHandledArrivalRef.current) return;
    if (Date.now() - navigationStartedAtRef.current < 1200) return;

    const destinationCoord = destinationFeature.geometry.coordinates as [number, number];
    const distanceToDestination = distanceMeters(userCoord, destinationCoord);
    const reachedDestinationNode =
      confirmedNodeId === destinationId || lastPassedNodeId === destinationId;
    const atFinalInstruction = activeStepIndex >= Math.max(segments.length - 1, 0);

    const shouldComplete =
      reachedDestinationNode ||
      (atFinalInstruction && distanceToDestination <= STEP_TARGET_RADIUS_METERS) ||
      distanceToDestination <= ARRIVAL_COMPLETE_RADIUS_METERS;

    if (!shouldComplete) return;

    hasHandledArrivalRef.current = true;
    setShowSteps(false);
    setNavigationStarted(false);
    router.replace(`/post-navigation?completedDestinationId=${encodeURIComponent(destinationId)}`);
  }, [
    activeStepIndex,
    confirmedNodeId,
    destinationFeature,
    destinationId,
    isStarted,
    lastPassedNodeId,
    segments.length,
    setNavigationStarted,
    userCoord,
  ]);

  const handleFloorPreviewPress = useCallback((previewFloor: number | null) => {
    if (previewFloor === null) return;

    // tap same floor again = go back to automatic behavior
    if (transitionFloorLock === previewFloor) {
      setHasManualFloorSelection(false);
      setTransitionFloorLock(null);
      return;
    }

    // only change the displayed floor
    setHasManualFloorSelection(true);
    setTransitionFloorLock(previewFloor);
  }, [transitionFloorLock]);


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
    ? Math.max(96, insets.top + 104)
    : 0;

  return (
    <View style={styles.screen}>
      {!isStarted ? (
        <View style={styles.header}>
          <Pressable
            style={styles.locationCard}
            onPress={() => {
              setShowStartDropdown((prev) => !prev);
              setStartQuery("");
            }}
          >
            <View style={styles.cardTextWrap}>
              <Text style={styles.cardLabel}>Inicio</Text>
              <Text style={styles.cardTitle}>{startFeature?.properties?.label || "Seleccionar inicio"}</Text>
              <Text style={styles.cardMeta}>
                {`Planta ${route.summary?.startFloor ?? startFeature?.properties?.floor ?? "-"}`}
              </Text>
            </View>
            <Ionicons name="pencil" size={24} color={AppPalette.textPrimary} />
          </Pressable>

          {showStartDropdown ? (
            <View style={styles.startDropdown}>
              <View style={styles.startSearchWrap}>
                <TextInput
                  value={startQuery}
                  onChangeText={setStartQuery}
                  placeholder="Escriba punto de partida"
                  placeholderTextColor="rgba(29, 27, 32, 0.65)"
                  style={styles.startSearchInput}
                />
                <Ionicons name="search" size={18} color="rgba(29, 27, 32, 0.75)" />
              </View>

              <ScrollView style={styles.startOptionsScroll} contentContainerStyle={styles.startOptionsContent}>
                {(startQuery.trim() ? searchedStartOptions : entranceStartOptions).map((option: any) => (
                  <Pressable
                    key={`start-option-${option.id}`}
                    style={[styles.startOptionRow, start.nodeId === option.id && styles.startOptionRowActive]}
                    onPress={() => {
                      setNavigationStarted(false);
                      clearPostNavStartOverride();
                      setStartNode(option.id);
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
                  disabled={!nearestCurrentLocationStart}
                  onPress={() => {
                    if (!nearestCurrentLocationStart) return;
                    setNavigationStarted(false);
                    clearPostNavStartOverride();
                    setStartNode(nearestCurrentLocationStart.id);
                    setShowStartDropdown(false);
                    setStartQuery("");
                  }}
                >
                  <Ionicons
                    name="locate"
                    size={18}
                    color={nearestCurrentLocationStart ? AppPalette.primary : AppPalette.lines}
                  />
                  <Text style={styles.currentLocationOptionText}>
                    {nearestCurrentLocationStart
                      ? `Ubicación actual (${nearestCurrentLocationStart.label})`
                      : "Ubicación actual (no disponible)"}
                  </Text>
                </Pressable>
              </ScrollView>
            </View>
          ) : null}

          <Pressable style={styles.locationCard} onPress={() => router.push("/search")}>
            <View style={styles.cardTextWrap}>
              <Text style={styles.cardLabel}>Destino</Text>
              <Text style={styles.cardTitle}>
                {destinationFeature?.properties?.label || "Seleccionar destino"}
              </Text>
              <Text style={styles.cardMeta}>
                {route.ok
                  ? `Planta ${route.summary?.destinationFloor ?? destinationFeature?.properties?.floor ?? "-"} | ${route.summary?.etaMinutes ?? "?"} min | ${route.summary?.totalMeters ?? "?"} m`
                  : route.reason
                    ? `Error en la ruta: ${route.reason}`
                    : "Preparando ruta"}
              </Text>
            </View>
            <Ionicons name="pencil" size={24} color={AppPalette.textPrimary} />
          </Pressable>
        </View>
      ) : null}

      <View
        style={[
          styles.mapWrap,
          instructionBannerReservedHeight > 0 ? { paddingTop: instructionBannerReservedHeight } : null,
        ]}
      >
        <IndoorMap
          currentFloor={currentFloor}
          nodes={navData.renderNodes}
          floorplan={navData.renderFloorplan}
          route={
            isStarted
              ? startedRouteLayers.primary || route.currentFloorGeojson || route.geojson
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
              <MaterialCommunityIcons
                name={instructionIconName as any}
                size={42}
                color={AppPalette.textPrimary}
                style={styles.instructionIcon}
              />
              <Text
                style={styles.instructionTitle}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                maxFontSizeMultiplier={1}
              >
                {nextInstruction.title}
              </Text>
            </View>
            {nextInstruction?.detail ? (
              <Text style={styles.instructionDetail} numberOfLines={2}>
                {nextInstruction.detail}
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
                color={isFollowingUser ? AppPalette.background : AppPalette.primary}
              />
            </Pressable>

            <View style={styles.mapActions}>
              <Pressable style={styles.mapActionButton} onPress={() => router.replace("/ar")}>
                <Ionicons name="camera-outline" size={26} color={AppPalette.background} />
                <Text style={styles.mapActionBadge}>RA</Text>
              </Pressable>
              <Pressable style={styles.mapActionButton} onPress={handlePreferencePress}>
                <MaterialCommunityIcons
                  name={prefer === "stairs" ? "stairs" : "elevator"}
                  size={28}
                  color={AppPalette.background}
                />
              </Pressable>
              <Pressable style={styles.mapActionButton} onPress={() => setSoundEnabled(!soundEnabled)}>
                <Ionicons
                  name={soundEnabled ? "volume-high" : "volume-mute"}
                  size={28}
                  color={AppPalette.background}
                />
              </Pressable>
              <Pressable style={styles.mapActionButton} onPress={() => router.push("/help")}>
                <Ionicons name="help" size={28} color={AppPalette.background} />
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
                {headingStatusMessage ? (
                  <View style={styles.warningPill}>
                    <Text style={styles.warningPillText}>{headingStatusMessage}</Text>
                  </View>
                ) : null}
              </View>
            )}
          </>
        ) : null}
      </View>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 10) + 10 }]}>
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
                setNavigationStarted(false);
                if (destinationId) {
                  router.replace(`/post-navigation?completedDestinationId=${encodeURIComponent(destinationId)}`);
                }
                return;
              }
              if (postNavStartOverrideId) {
                setStartNode(postNavStartOverrideId);
                clearPostNavStartOverride();
              }
              setActiveStepIndex(0);
              recenterToUser();
              setNavigationStarted(true);
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
                    <Ionicons name="close" size={24} color={AppPalette.textPrimary} />
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
                      index === displayedInstructionIndex && styles.stepItemActive,
                    ]}
                  >
                    {index === displayedInstructionIndex ? <View style={styles.stepActiveBar} /> : null}
                    <View style={[styles.stepDot, index === displayedInstructionIndex && styles.stepDotActive]} />
                    <View style={styles.stepTextWrap}>
                      <Text style={[styles.stepTitle, index === displayedInstructionIndex && styles.stepTitleActive]}>
                        {step?.title || "Continúe"}
                      </Text>
                      {step?.detail ? (
                        <Text style={[styles.stepDetail, index === displayedInstructionIndex && styles.stepDetailActive]}>
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
  startOptionsScroll: {
    marginTop: 8,
  },
  startOptionsContent: {
    gap: 8,
  },
  startOptionRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: AppPalette.lines,
    backgroundColor: AppPalette.background,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  startOptionRowActive: {
    borderColor: AppPalette.primary,
    borderWidth: 2,
  },
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
  mapWrap: { flex: 1, minHeight: 260, overflow: "hidden", position: "relative" },
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
  instructionIcon: { marginRight: 10 },
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
    right: 8,
    bottom: 6,
    fontSize: 10,
    fontWeight: "900",
    color: AppPalette.background,
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
  targetButtonActive: {
    backgroundColor: AppPalette.primary,
    borderWidth: 2,
    borderColor: "#000000",
  },
  targetButtonInactive: {
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: AppPalette.primary,
  },
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
  statusPillInteractive: {
    backgroundColor: "#2A7C8E",
  },
  statusPillText: { fontSize: 16, fontWeight: "800", color: AppPalette.background, fontFamily: FONT_TITLE },
  warningPill: {
    maxWidth: 320,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: "rgba(106, 44, 14, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(255, 196, 140, 0.4)",
  },
  warningPillText: {
    color: "#FFF5EB",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    fontFamily: FONT_BODY,
  },
  floorSwitchRow: {
    position: "absolute",
    right: 24,
    bottom: 24,
    zIndex: 4,
    flexDirection: "row",
    gap: 8,
  },
  floorPillButton: {
    position: "relative",
    right: 0,
    bottom: 0,
    zIndex: 4,
  },
  floorPillButtonInactive: {
    backgroundColor: AppPalette.background,
  },
  floorPillTextInactive: {
    color: AppPalette.textPrimary,
  },
  bottomBar: {
    backgroundColor: AppPalette.primary,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 8,
    marginTop: 6,
  },
  sheetHandle: { alignItems: "center", paddingBottom: 6 },
  handleArrow: { transform: [{ scaleX: 2 }], marginBottom: -4 },
  handleText: { color: AppPalette.background, fontWeight: "700", fontSize: 12, fontFamily: FONT_TITLE },
  metricsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 5 },
  metric: { minWidth: 56 },
  metricValue: { fontSize: 24, fontWeight: "800", color: AppPalette.background, fontFamily: FONT_TITLE },
  metricLabel: { fontSize: 13, fontWeight: "700", color: AppPalette.background, fontFamily: FONT_BODY },
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
  stepsDragHintWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 0,
  },
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
  stepsBridgeArrow: {
    alignSelf: "center",
    transform: [{ scaleX: 2 }],
    marginBottom: -1,
  },
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
  stepItemDivider: {
    borderTopWidth: 1,
    borderTopColor: "#8EC6D4",
  },
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
  stepDotActive: { backgroundColor: AppPalette.textSectionTitles },
  stepTextWrap: { flex: 1 },
  stepTitle: { fontSize: 16, fontWeight: "700", color: AppPalette.textPrimary, fontFamily: FONT_TITLE },
  stepTitleActive: { color: AppPalette.textSectionTitles },
  stepDetail: { fontSize: 13, color: AppPalette.textSectionTitles, marginTop: 2, fontFamily: FONT_BODY },
  stepDetailActive: { color: AppPalette.textPrimary },
});



