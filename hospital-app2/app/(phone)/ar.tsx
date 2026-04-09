import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Speech from "expo-speech";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavStore } from "../../store/navStore";
import { computeRoute } from "../../lib/route/routeEngine";
import {
  buildDetailedInstruction,
  formatInstructionForSpeech,
  getHeadingFromSegment,
  getImmediateTurnTitle,
  getSegmentTurnHint,
  isCrossFloorSegment,
  normalizeAngleDelta,
  segmentTouchesFloor,
} from "../../lib/route/navigationInstructions";
import {
  distanceMeters,
  getHeadingValue,
  getNodeRole,
  smoothHeading,
} from "../../lib/route/routeHelpers";
import { AppPalette, useAppAppearance } from "../../constants/theme";
import { projectGeoJSONForMap } from "../../lib/coords/localToLngLat";
import { trackEvent } from "../../lib/monitoring";

let CameraViewImpl: any = null;
let useCameraPermissionsImpl: any = null;
let LocationImpl: any = null;

const STEP_PROGRESS_MIN = 0.992;
const TURN_PROMPT_PROGRESS_MIN = 0.62;
const TURN_PROMPT_DISTANCE_METERS = 1.4;

try {
  const expoCamera = require("expo-camera");
  CameraViewImpl = expoCamera.CameraView;
  useCameraPermissionsImpl = expoCamera.useCameraPermissions;
} catch {
  CameraViewImpl = null;
  useCameraPermissionsImpl = () => [null, async () => {}];
}

try {
  LocationImpl = require("expo-location");
} catch {
  LocationImpl = null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));}

// Get the instruction for turns
function parseMeters(detail: string | null | undefined) {
  if (!detail) return null;
  const match = detail.match(/(\d+)/);
  if (!match) return null;
  return Number(match[1]);
}

function getBannerIconName(hint: string) {
  switch (hint) {
    case "left":
      return "arrow-left-top-bold";
    case "right":
      return "arrow-right-top-bold";
    case "left-forward":
      return "arrow-left-top-bold";
    case "right-forward":
      return "arrow-right-top-bold";
    case "up":
      return "stairs-up";
    case "down":
      return "stairs-down";
    case "arrive":
      return "map-marker-check";
    case "forward":
    default:
      return "arrow-up-thin";
  }
}

// Helper of possible hints
function isFloorGuideHint(hint: string) {
  return ["forward", "left", "right", "left-forward", "right-forward"].includes(hint);
}

// arrows will only show left and right directions not soft turns
function getFloorGuideVariant(hint: string) {
  if (hint === "left" || hint === "left-forward") return "left" as const;
  if (hint === "right" || hint === "right-forward") return "right" as const;
  return "forward" as const;
}

// Animate turns by shifting arrows
function getFloorGuideShift(variant: ReturnType<typeof getFloorGuideVariant>, progress: number) {
  const depth = 1 - progress;
  if (depth <= 0.58) return 0;
  const normalized = Math.min(1, (depth - 0.58) / 0.42);
  const amount = Math.pow(normalized, 1.2) * 48;
  if (variant === "left") return -amount;
  if (variant === "right") return amount;
  return 0;
}

export default function ArNavigation() {
  const { palette } = useAppAppearance();
  const insets = useSafeAreaInsets();
  const [cameraPermission, requestCameraPermission] = useCameraPermissionsImpl();
  const isCameraNativeAvailable = Boolean(CameraViewImpl);

  const [locationPermissionGranted, setLocationPermissionGranted] = useState<boolean | null>(null);
  const [sensorHeading, setSensorHeading] = useState<number | null>(null);
  const [smoothedSensorHeading, setSmoothedSensorHeading] = useState<number | null>(null);
  const [headingWatchError, setHeadingWatchError] = useState(false);
  const [hasHeadingSample, setHasHeadingSample] = useState(false);
  const [showHeadingBlocker, setShowHeadingBlocker] = useState(true);
  const [showHeadingGraceHint, setShowHeadingGraceHint] = useState(false);
  const [showHeadingReady, setShowHeadingReady] = useState(false);
  const lastSpokenInstructionKeyRef = React.useRef<string | null>(null);
  const hasShownLocationPrivacyNoteRef = React.useRef(false);

  // Main data taken from the navigation store
  const navData = useNavStore((s) => s.navData);
  const start = useNavStore((s) => s.start);
  const destinationId = useNavStore((s) => s.destinationId);
  const route = useNavStore((s) => s.route);
  const isStarted = useNavStore((s) => s.navigationUi.isStarted);
  const activeStepIndex = useNavStore((s) => s.navigationUi.activeStepIndex);
  const currentFloor = useNavStore((s) => s.navigationUi.navigationFloor);
  const prefer = useNavStore((s) => s.navigationUi.prefer);
  const soundEnabled = useNavStore((s) => s.navigationUi.soundEnabled);
  const routeStartedAtMs = useNavStore((s) => s.navigationUi.routeStartedAtMs);
  const setNavigationPreference = useNavStore((s) => s.setNavigationPreference);
  const setMapViewMode = useNavStore((s) => s.setMapViewMode);
  const setRoute = useNavStore((s) => s.setRoute);
  const setSoundEnabled = useNavStore((s) => s.setSoundEnabled);
  const livePosition = useNavStore((s) => s.livePosition);
  // Prefer tracked heading if it exists
  const optitrackHeading =
    (livePosition as any)?.heading ??
    (livePosition as any)?.yawDegrees ??
    (livePosition as any)?.orientationDegrees ??
    null;

  useEffect(() => {
    setMapViewMode("ar");
  }, [setMapViewMode]);

  // Ask for camera access when entering AR
  useEffect(() => {
    if (!cameraPermission || cameraPermission.granted) return;
    requestCameraPermission();
  }, [cameraPermission, requestCameraPermission]);

  // Start heading updates and restart them when the app comes back
  useEffect(() => {
    let subscription: any = null;
    let isMounted = true;

    function stopHeadingWatch() {
      if (subscription?.remove) {
        subscription.remove();}
      subscription = null;
    }

    // Start async function to watch for heading
    async function startHeadingWatch() {
      if (!LocationImpl) return;
      stopHeadingWatch();
      setHeadingWatchError(false);

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
        if (!isMounted) return;
        setLocationPermissionGranted(granted);

        if (!granted) {
          setSensorHeading(null);
          setHasHeadingSample(false);
          return;}

        setHasHeadingSample(false);
        const initialHeading = await LocationImpl.getHeadingAsync();
        const initialValue = getHeadingValue(initialHeading);

        if (isMounted && typeof initialValue === "number") {
          setSensorHeading(initialValue);
          setHasHeadingSample(true);}

        subscription = await LocationImpl.watchHeadingAsync((heading: any) => {
          if (!isMounted) return;

          const nextHeading = getHeadingValue(heading);
          if (typeof nextHeading === "number") {
            setSensorHeading(nextHeading);
            setHasHeadingSample(true);}
        });
      } catch {
        if (isMounted) {
          setHeadingWatchError(true);
          setSensorHeading(null);
          setHasHeadingSample(false);
        }
      }
    }

    startHeadingWatch();
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        startHeadingWatch();
      }
    });

    return () => {
      isMounted = false;
      appStateSubscription.remove();
      stopHeadingWatch();
    };
  }, []);

  const segments = useMemo(() => route.summary?.instructionSegments || [], [route.summary?.instructionSegments]);

  // Build one instruction per route segment
  const instructionItems = useMemo(
    () =>
      segments.map((segment: any, index: number) =>
        buildDetailedInstruction(
          segment,
          index > 0 ? segments[index - 1] : null,
          index + 1 < segments.length ? segments[index + 1] : null,
          navData.nodes,
          destinationId
        )
      ),
    [destinationId, navData.nodes, segments]
  );

  const userCoord = ((livePosition as any)?.coords as [number, number] | null) ?? null;
  const destinationFeature = useMemo(() => navData.nodes?.features?.find((item: any) => item.properties?.id === destinationId) || null, [destinationId, navData.nodes]);

  // Check if the user is already close to the destination
  const isAtDestination = useMemo(() => {
    if (!isStarted || !destinationFeature || !userCoord) return false;

    const destinationCoords = destinationFeature?.geometry?.coordinates;
    const destinationFloor = destinationFeature?.properties?.floor ?? null;
    const userFloor = livePosition.floor ?? currentFloor ?? null;
    if (!Array.isArray(destinationCoords)) return false;

    if (
      destinationFloor !== null &&
      userFloor !== null &&
      destinationFloor !== userFloor
    ) {
      return false;
    }

    return distanceMeters(userCoord, destinationCoords as [number, number]) <= 1.0;
  }, [currentFloor, destinationFeature, isStarted, livePosition.floor, userCoord]);

  // Decide which instruction should be shown now
  const displayedInstructionIndex = useMemo(() => {
    if (!instructionItems.length) return 0;
    if (isAtDestination) return instructionItems.length - 1;

    const clampedActiveIndex = Math.min(activeStepIndex, instructionItems.length - 1);
    const activeSegment = segments[clampedActiveIndex] || null;
    if (!activeSegment) return clampedActiveIndex;

    if (currentFloor !== null) {
      if (segmentTouchesFloor(activeSegment, currentFloor)) return clampedActiveIndex;

      for (let i = clampedActiveIndex - 1; i >= 0; i--) {
        if (segmentTouchesFloor(segments[i], currentFloor)) return i;
      }

      for (let i = clampedActiveIndex; i < segments.length; i++) {
        if (segmentTouchesFloor(segments[i], currentFloor)) return i;
      }
    }

    return clampedActiveIndex;
  }, [activeStepIndex, currentFloor, instructionItems.length, isAtDestination, segments]);

  const currentSegment = segments[displayedInstructionIndex] || null;
  const nextSegment = segments[displayedInstructionIndex + 1] || null;

  // Progress inside the current segment
  const activeInstructionProgress = useMemo(() => {
    if (!userCoord) return 0;
    const coords = currentSegment?.geojson?.features?.[0]?.geometry?.coordinates || [];
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
      if (segLenSq <= 0 || segLen <= 0) continue;

      const tRaw = ((userCoord[0] - start[0]) * segX + (userCoord[1] - start[1]) * segY) / segLenSq;
      const t = Math.max(0, Math.min(1, tRaw));
      const projX = start[0] + segX * t;
      const projY = start[1] + segY * t;
      const dx = userCoord[0] - projX;
      const dy = userCoord[1] - projY;
      const distSq = dx * dx + dy * dy;

      if (distSq < bestDistanceSq) {
        bestDistanceSq = distSq;
        bestProgress = (traversedLength + segLen * t) / totalLength;
      }

      traversedLength += segLen;
    }

    return bestProgress;
  }, [currentSegment, userCoord]);

  // Distance to the end of the current segment
  const activeInstructionDistanceToEnd = useMemo(() => {
    if (!userCoord) return Infinity;
    const coords = currentSegment?.geojson?.features?.[0]?.geometry?.coordinates || [];
    if (!Array.isArray(coords) || coords.length < 2) return Infinity;
    return distanceMeters(userCoord, coords[coords.length - 1]);
  }, [currentSegment, userCoord]);

  // Show the next turn a bit early when close enough
  const bannerInstruction = useMemo(() => {
    const currentInstruction = instructionItems[displayedInstructionIndex] || null;
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
    currentSegment,
    displayedInstructionIndex,
    instructionItems,
    segments,
  ]);

  // Main hint used by the AR guide
  const arHint = useMemo(() => {
    const maneuver = bannerInstruction?.maneuver;
    if (typeof maneuver === "string" && maneuver.length > 0) return maneuver;
    return getSegmentTurnHint(currentSegment, nextSegment);
  }, [bannerInstruction?.maneuver, currentSegment, nextSegment]);

  const floorGuideVariant = useMemo(() => getFloorGuideVariant(arHint), [arHint]);

  const hasActiveRoute = Boolean(destinationId && route?.ok && segments.length);

  // Use the best heading source we have
  const activeHeading = useMemo(() => {
    if (typeof optitrackHeading === "number") return optitrackHeading;
    if (typeof smoothedSensorHeading === "number") return smoothedSensorHeading;
    return null;
  }, [optitrackHeading, smoothedSensorHeading]);

  const hasUsableHeading = typeof activeHeading === "number" && Number.isFinite(activeHeading);

  // Smooth raw phone heading
  useEffect(() => {
    if (typeof sensorHeading !== "number" || !Number.isFinite(sensorHeading)) {
      setSmoothedSensorHeading(null);
      return;
    }
    setSmoothedSensorHeading((previous) => smoothHeading(previous, sensorHeading));
  }, [sensorHeading]);

  // Heading the user should face for the route
  const targetHeading = useMemo(() => {
    const nextCoords = nextSegment?.geojson?.features?.[0]?.geometry?.coordinates || [];
    const currentCoords = currentSegment?.geojson?.features?.[0]?.geometry?.coordinates || [];

    if (Array.isArray(nextCoords) && nextCoords.length >= 2) {
      return getHeadingFromSegment(nextCoords);
    }
    if (Array.isArray(currentCoords) && currentCoords.length >= 2) {
      return getHeadingFromSegment(currentCoords);
    }
    return null;
  }, [currentSegment, nextSegment]);

  // Difference between current heading and route heading
  const headingError = useMemo(() => {
    if (typeof activeHeading !== "number" || typeof targetHeading !== "number") return 0;
    return normalizeAngleDelta(targetHeading - activeHeading);
  }, [activeHeading, targetHeading]);

  const arrowOffsetX = useMemo(() => {
    // Calculate error 
    return clamp(headingError * 2.2, -130, 130);
  }, [headingError]);

  const instructionDistanceMeters = useMemo(
    () => parseMeters(bannerInstruction?.title) ?? parseMeters(bannerInstruction?.detail),
    [bannerInstruction?.detail, bannerInstruction?.title]
  );

  const arrowScale = useMemo(() => {
    if (!instructionDistanceMeters || instructionDistanceMeters <= 0) return 1;
    // Bigger if the distance is small, smaller if the distance is large
    const raw = 1.35 - instructionDistanceMeters / 30;
    return clamp(raw, 0.85, 1.35);
  }, [instructionDistanceMeters]);

  // Ccalibration text to show the user
  const directionCaption = useMemo(() => {
    if (typeof activeHeading !== "number" || typeof targetHeading !== "number") {
      return "Apunte el telefono hacia la ruta";
    }

    const absError = Math.abs(headingError);
    if (absError < 12) return "Esta alineado";
    if (headingError < 0) return absError > 45 ? "Gire a la izquierda" : "Leve giro a la izquierda";
    return absError > 45 ? "Gire a la derecha" : "Leve giro a la derecha";
  }, [activeHeading, headingError, targetHeading]);

  const bannerIconName = useMemo(() => getBannerIconName(arHint), [arHint]);

  // Reset spoken instruction when navigation stops
  useEffect(() => {
    if (!isStarted) {
      lastSpokenInstructionKeyRef.current = null;
    }
  }, [destinationId, isStarted]);

  // Read each new instruction only once
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

  // Wait a bit before showing the compass help hint
  useEffect(() => {
    if (hasUsableHeading) {
      setShowHeadingGraceHint(false);
      return;
    }

    const timeout = setTimeout(() => {
      setShowHeadingGraceHint(true);
    }, 5000);

    return () => clearTimeout(timeout);
  }, [hasUsableHeading]);

  // Hide the blocker once heading is ready
  useEffect(() => {
    if (!showHeadingBlocker) return;
    if (hasUsableHeading) {
      setShowHeadingReady(true);
      const timeout = setTimeout(() => {
        setShowHeadingReady(false);
        setShowHeadingBlocker(false);
      }, 1400);
      return () => clearTimeout(timeout);
    }
    setShowHeadingReady(false);
  }, [hasUsableHeading, showHeadingBlocker]);

  // Text shown inside the heading blocker
  const headingBlockerState = useMemo(() => {
    if (showHeadingReady) {
      return {
        tone: "success" as const,
        title: "Brújula calibrada",
        body: "Todo listo. Ya puede usar la navegación en RA.",
      };
    }

    if (typeof optitrackHeading === "number") {
      return {
        tone: "success" as const,
        title: "Referencia local lista",
        body: "Ya puede usar la navegación en RA.",
      };
    }

    if (locationPermissionGranted === null && LocationImpl) {
      return {
        tone: "info" as const,
        title: "Comprobando orientación",
        body: "Espere un momento mientras preparamos la orientación del dispositivo.",
      };
    }

    if (LocationImpl && !locationPermissionGranted) {
      return {
        tone: "warning" as const,
        title: "Se necesita orientación",
        body: "Active la ubicación para orientar mejor la navegación en RA.",
      };
    }

    if (headingWatchError) {
      return {
        tone: "warning" as const,
        title: "Sensor no disponible",
        body: "No hemos podido leer la brújula del teléfono. Cierre esta vista e inténtelo de nuevo.",
      };
    }

    if (LocationImpl && locationPermissionGranted && !hasHeadingSample) {
      return showHeadingGraceHint
        ? {
            tone: "warning" as const,
            title: "Calibre la brújula",
            body: "Mueva el teléfono dibujando un 8 para calibrar la orientación.",
          }
        : {
            tone: "info" as const,
            title: "Preparando la brújula",
            body: "Mantenga el teléfono estable un momento mientras obtenemos la orientación.",
          };
    }

    return {
      tone: "warning" as const,
      title: "Orientación no disponible",
      body: "No hay orientación disponible todavía para la navegación en RA.",
    };
  }, [
    hasHeadingSample,
    headingWatchError,
    locationPermissionGranted,
    optitrackHeading,
    showHeadingGraceHint,
    showHeadingReady,
  ]);

  const transitionZoneOptions = useMemo(() => {
    if (!userCoord || !navData.nodes) return [];

    const list = (navData.nodes.features || [])
      .filter((feature: any) => {
        const role = feature?.properties?.role;
        // keep only stairs and elevator nodes that are closer than 2 meters
        if (!["stairs", "elevator"].includes(role)) return false;
        return distanceMeters(userCoord, feature.geometry?.coordinates) <= 2.0;
      })
      .map((feature: any) => ({
        floor: feature.properties?.floor ?? null,
        role: feature.properties?.role,
        id: feature.properties?.id,
      }))
      .filter((option: any, index: number, list: any[]) =>
        index === list.findIndex((item) => item.floor === option.floor)
      );
      // return options sorted by floor
    return list.sort((a: any, b: any) => (a.floor ?? 0) - (b.floor ?? 0));
  }, [navData.nodes, userCoord]);

  // Showw floor info when near a transition
  const visibleFloorOptions = useMemo(() => {
    if (!isStarted) return [];
    if (transitionZoneOptions.length > 1) return transitionZoneOptions;
    if (isCrossFloorSegment(currentSegment)) {
      const fromFloor = currentSegment?.floor ?? null;
      const toFloor = currentSegment?.toFloor ?? null;
      const role = getNodeRole(navData.nodes, currentSegment?.fromNodeId) || "transition";

      return [fromFloor, toFloor]
        .filter((floor, index, list) => floor !== null && list.indexOf(floor) === index)
        .sort((a: any, b: any) => a - b)
        .map((floor: any) => ({ floor, role }));
    }
    return [];
  }, [currentSegment, isStarted, navData.nodes, transitionZoneOptions]);

  // Small status label at the bottom right
  const arStatusMessage = useMemo(() => {
    if (isStarted && visibleFloorOptions.length > 1) {
      const roleLabel = visibleFloorOptions[0]?.role || "transición";
      const floorsText = visibleFloorOptions.map((option: any) => `P${option.floor}`).join(" / ");
      return `Cerca de ${roleLabel} · ${floorsText}`;
    }
    return `Planta ${currentFloor ?? "-"}`;
  }, [currentFloor, isStarted, visibleFloorOptions]);

  // Compute a route and save it in the store
  const computeAndStoreRoute = useCallback(
    (startId: string, reason: string | null = null, preferOverride?: "stairs" | "elevator") => {
      if (!destinationId) return false;

      const effectivePrefer = preferOverride ?? prefer;
      const routeTimingCategory =
        reason === null || reason === "initial" || (reason === "destination-change" && !isStarted)
          ? "initial-route"
          : "reroute";
      const startedAt = Date.now();
      const result = computeRoute(navData.nodes, navData.edges, startId, destinationId, { prefer: effectivePrefer });
      const computeDurationMs = Date.now() - startedAt;

      if (!result.ok) {
        trackEvent("route.compute_failed", {
          startId,
          destinationId,
          prefer: effectivePrefer,
          reason: reason || result.reason || null,
          routeError: result.reason || null,
          routeTimingCategory,
          computeDurationMs,
          sourceView: "ar",
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
        reason: reason || "initial",
        routeTimingCategory,
        totalMeters: result.summary?.totalMeters ?? null,
        etaMinutes: result.summary?.etaMinutes ?? null,
        destinationFloor: result.summary?.destinationFloor ?? null,
        computeDurationMs,
        sourceView: "ar",
      });

      return true;
    },
    [destinationId, isStarted, navData.edges, navData.nodes, prefer, setRoute]
  );

  // Change stairs or elevator mode and reroute if needed
  const handlePreferencePress = useCallback(() => {
    const nextPrefer = prefer === "stairs" ? "elevator" : "stairs";
    setNavigationPreference(nextPrefer);
    if (!isStarted || !destinationId) {
      return;
    }

    const rerouteStartId = currentSegment?.fromNodeId || start.nodeId || "n_hospital_entrance_f0";
    computeAndStoreRoute(rerouteStartId, "preference-change", nextPrefer);
  }, [
    computeAndStoreRoute,
    currentSegment,
    destinationId,
    isStarted,
    prefer,
    setNavigationPreference,
    start.nodeId,
  ]);

  // Leave AR and go back to the normal map screen
  const handleReturnToMap = useCallback(() => {
    trackEvent("navigation.guidance_mode_changed", {
      fromMode: "ar",
      toMode: "2d",
      destinationId,
      activeStepIndex,
      routeElapsedSeconds: routeStartedAtMs
        ? Math.round((Date.now() - routeStartedAtMs) / 1000)
        : null,
    });
    router.replace("/navigate");
  }, [activeStepIndex, destinationId, routeStartedAtMs]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      {isCameraNativeAvailable && cameraPermission?.granted ? (
        <CameraViewImpl facing="back" style={styles.camera} />
      ) : !isCameraNativeAvailable ? (
        <View style={styles.permissionFallback}>
          <Text style={styles.permissionTitle}>Módulo de cámara no disponible</Text>
          <Text style={styles.permissionBody}>
            Esta versión de desarrollo no incluye Expo Camera. Vuelva a compilar e instale de nuevo el cliente.
          </Text>
        </View>
      ) : (
        <View style={styles.permissionFallback}>
          <Text style={styles.permissionTitle}>Se necesita permiso de cámara</Text>
          <Text style={styles.permissionBody}>Permita el acceso a la cámara para ver las flechas de RA.</Text>
          <Pressable style={styles.permissionButton} onPress={requestCameraPermission}>
            <Text style={styles.permissionButtonText}>Permitir cámara</Text>
          </Pressable>
        </View>
      )}

      <View pointerEvents="box-none" style={styles.overlay}>
        {/* Instruction header */}
        <View style={[styles.instructionCard, { paddingTop: Math.max(insets.top, 14) + 8 }]}>
          <View style={styles.instructionHeaderRow}>
            <MaterialCommunityIcons
              name={bannerIconName as any}
              size={76}
              color={palette.textPrimary}
              style={styles.instructionHeaderIcon}
            />
            <View style={styles.instructionTextWrap}>
              <Text
                style={styles.instructionTitle}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                maxFontSizeMultiplier={1}
              >
                {!hasActiveRoute
                  ? "Inicie la navegación para ver guía en cámara"
                  : !isStarted
                    ? "Inicie la navegación para ver guía en cámara"
                    : bannerInstruction?.title || "Continúe"}
              </Text>

              {isStarted && bannerInstruction?.detail ? (
                <Text style={styles.instructionDetail}>{bannerInstruction.detail}</Text>
              ) : null}

            </View>
          </View>
        </View>

        {/* Side button bar */}
        <View style={[styles.mapActions, { top: Math.max(insets.top, 12) + 112 }]}>
          <Pressable style={styles.actionButton} onPress={handleReturnToMap}>
            <Ionicons name="map-outline" size={28} color={palette.background} />
          </Pressable>
          {/* Toggle stairs/elevator preference */}
          <Pressable style={styles.actionButton} onPress={handlePreferencePress}>
            <MaterialCommunityIcons
              name={prefer === "stairs" ? "stairs" : "elevator"}
              size={28}
              color={palette.background}
            />
          </Pressable>
          {/* Toggle sound for spoken instructions */}
          <Pressable style={styles.actionButton} onPress={() => setSoundEnabled(!soundEnabled)}>
            <Ionicons
              name={soundEnabled ? "volume-high" : "volume-mute"}
              size={28}
              color={palette.background}
            />
          </Pressable>
          {/* Help button */}
          <Pressable style={styles.actionButton} onPress={() => router.push("/help")}>
            <Ionicons name="help" size={28} color={palette.background} />
          </Pressable>
        </View>

        {isStarted && hasActiveRoute ? (
          <View style={styles.arrowZone}>
            {/* Display short text for orientation */}
            <View style={styles.directionCaptionWrap}>
              <Text style={styles.directionCaption}>{directionCaption}</Text>
            </View>

            {visibleFloorOptions.length > 1 ? (
              <View style={styles.floorSwitchRow}>
                {visibleFloorOptions.map((option: any, index: number) => {
                  const isActive = currentFloor === option.floor || (index === 0 && currentFloor === null);
                  return (
                    <View
                      key={`ar-floor-${option.floor}`}
                      style={[
                        styles.statusPill,
                        styles.floorPillButton,
                        !isActive && styles.floorPillButtonInactive,
                        isActive && styles.statusPillInteractive,
                      ]}
                    >
                      <Text style={[styles.statusPillText, !isActive && styles.floorPillTextInactive]}>
                        {`Planta ${option.floor}`}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={styles.statusPill}>
                <Text style={styles.statusPillText}>{arStatusMessage}</Text>
              </View>
            )}

            {/* Arrow and main guide for AR */}
            <View
              style={[
                styles.arrowFloating,
                {
                  transform: [
                    { translateX: arrowOffsetX },
                    { scale: arrowScale },
                  ],
                },
              ]}
            >
              {arHint === "arrive" ? (
                <MaterialCommunityIcons name="map-marker-check" size={132} color="#A9F2C0" />
              ) : null}
              {/* Illusion to make the arrows be on the floor */}
              {isFloorGuideHint(arHint) ? (
                <View style={styles.floorGuidePlane}>
                  <View style={styles.floorGuideField}>
                  {Array.from({ length: 12 }).map((_, index, list) => {
                    const progress = index / Math.max(1, list.length - 1);
                    const shift = getFloorGuideShift(floorGuideVariant, progress);
                    const color = ["#55F5FF", "#1739FF"][index % 2];
                    const width = 72 + progress * 190;
                    const pointWidth = 24 + progress * 110;
                    const pointHeight = 9 + progress * 10;
                    const depth = 1 - progress;
                    const turnStrength =
                      floorGuideVariant === "forward" || depth <= 0.58
                        ? 0
                        : Math.pow((depth - 0.58) / 0.42, 1.5);
                    const turnDirection =
                      floorGuideVariant === "left" ? -1 : floorGuideVariant === "right" ? 1 : 0;
                    const curveOffsetX = turnDirection * turnStrength * 18;
                    const curveRotation = turnDirection * turnStrength * 55;
                    return (
                      <View
                        key={`floor-guide-arrow-${index}`}
                        style={[
                          styles.floorGuideArrow,
                          {
                            opacity: 0.5 + progress * 0.45,
                            width,
                            transform: [{ translateX: shift }],
                            marginBottom: progress > 0.8 ? 2 : -2,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.floorGuideArrowPoint,
                            {
                              borderLeftWidth: pointWidth,
                              borderRightWidth: pointWidth,
                              borderBottomWidth: pointHeight,
                              borderLeftColor: "transparent",
                              borderRightColor: "transparent",
                              borderBottomColor: color,
                              transform: [
                                { translateX: curveOffsetX },
                                { rotateZ: `${curveRotation}deg` },
                              ],
                            },
                          ]}
                        />
                      </View>
                    );
                  })}
                  </View>
                </View>
              ) : null}

              {arHint === "up" ? (
                <View style={styles.floorArrowWrap}>
                  <MaterialCommunityIcons name="stairs-up" size={112} color={palette.primary} />
                  <MaterialCommunityIcons name="arrow-up-bold" size={96} color={palette.primary} />
                </View>
              ) : null}

              {arHint === "down" ? (
                <View style={styles.floorArrowWrap}>
                  <MaterialCommunityIcons name="stairs-down" size={112} color={palette.primary} />
                  <MaterialCommunityIcons name="arrow-down-bold" size={96} color={palette.primary} />
                </View>
              ) : null}
            </View>

            {/* Calibration bar on the bottom */}
            <View style={styles.alignmentBarWrap}>
              <View style={styles.alignmentBar} />
              <View
                style={[
                  styles.alignmentMarker,
                  {
                    left: `${50 + clamp((headingError / 90) * 40, -40, 40)}%`,
                  },
                ]}
              />
            </View>
          </View>
        ) : null}
      </View>

      {showHeadingBlocker && isCameraNativeAvailable && cameraPermission?.granted && isStarted && hasActiveRoute ? (
        /* Display messages and block AR */
        <View style={styles.blockerScrim}>
          <View
            style={[
              styles.blockerCard,
              headingBlockerState.tone === "success" ? styles.blockerCardSuccess : null,
            ]}
          >
            <View
              style={[
                styles.blockerIconWrap,
                headingBlockerState.tone === "success" ? styles.blockerIconWrapSuccess : null,
              ]}
            >
              <Ionicons
                name={headingBlockerState.tone === "success" ? "checkmark-circle" : "compass-outline"}
                size={36}
                color={headingBlockerState.tone === "success" ? "#175C36" : palette.textPrimary}
              />
            </View>
            <Text style={styles.blockerTitle}>{headingBlockerState.title}</Text>
            <Text style={styles.blockerBody}>{headingBlockerState.body}</Text>
            {!showHeadingReady ? (
              <Pressable style={styles.blockerExitButton} onPress={handleReturnToMap}>
                <Text style={styles.blockerExitButtonText}>Salir de RA</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0D1B22" },
  camera: { ...StyleSheet.absoluteFillObject },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(8, 15, 18, 0.16)" },

  instructionCard: { marginHorizontal: 10, borderRadius: 24, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: AppPalette.primary },
  instructionHeaderRow: { flexDirection: "row", alignItems: "center" },
  instructionHeaderIcon: { marginRight: 12 },
  instructionTextWrap: { flex: 1 },
  instructionTitle: { fontSize: 24, fontWeight: "800", color: AppPalette.textPrimary, lineHeight: 30 },
  instructionDetail: { marginTop: 4, fontSize: 14, fontWeight: "700", color: "rgba(29, 27, 32, 0.78)" },
  mapActions: { position: "absolute", right: 16, zIndex: 3, gap: 12, backgroundColor: "rgba(255,255,255,0.55)", borderRadius: 18, paddingVertical: 10, paddingHorizontal: 8 },
  actionButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: AppPalette.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#000000",
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },

  arrowZone: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20, paddingBottom: 80 },
  directionCaptionWrap: { position: "absolute", left: 18, bottom: 8, borderRadius: 16, backgroundColor: AppPalette.primary, paddingHorizontal: 16, paddingVertical: 10 },
  directionCaption: { fontSize: 16, fontWeight: "800", color: AppPalette.background },
  arrowFloating: { position: "absolute", bottom: 58, left: "50%", marginLeft: -130, width: 260, alignItems: "center", justifyContent: "center" },
  floorGuideField: { width: "100%", alignItems: "center", justifyContent: "flex-end", gap: 0 },
  floorGuidePlane: { width: "100%", alignItems: "center", justifyContent: "flex-end", transform: [{ perspective: 900 }, { rotateX: "68deg" }] },
  floorGuideArrow: { alignItems: "center", justifyContent: "flex-start", marginBottom: -5 },
  floorGuideArrowPoint: { width: 0, height: 0 },
  stackCenter: { alignItems: "center", justifyContent: "center" },
  floorArrowWrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
    opacity: 0.94,
    transform: [{ scaleX: 1.35 }, { scaleY: 0.8 }],
  },

  alignmentBarWrap: { position: "absolute", bottom: 72, width: "78%", alignItems: "center", justifyContent: "center" },
  alignmentBar: { width: "100%", height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.28)" },
  alignmentMarker: {
    position: "absolute",
    marginLeft: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: AppPalette.primary,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    top: -5,
  },
  statusPill: {
    position: "absolute",
    right: 24,
    bottom: 8,
    backgroundColor: AppPalette.primary,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  statusPillInteractive: { backgroundColor: "#2A7C8E" },
  statusPillText: { fontSize: 16, fontWeight: "800", color: AppPalette.background },
  floorSwitchRow: { position: "absolute", right: 24, bottom: 8, flexDirection: "row", gap: 8 },
  floorPillButton: { position: "relative", right: 0, bottom: 0 },
  floorPillButtonInactive: { backgroundColor: AppPalette.background },
  floorPillTextInactive: { color: AppPalette.textPrimary },

  permissionFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "#0D1B22",
  },
  permissionTitle: { fontSize: 24, fontWeight: "800", color: "#FFFFFF", textAlign: "center" },
  permissionBody: { marginTop: 8, fontSize: 14, fontWeight: "600", color: "#CBE6EE", textAlign: "center" },
  permissionButton: {
    marginTop: 16,
    borderRadius: 14,
    backgroundColor: AppPalette.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  permissionButtonText: {
    fontSize: 15,
    fontWeight: "800",
    color: AppPalette.background,
  },
  blockerScrim: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "rgba(7, 14, 18, 0.72)",
    zIndex: 20,
    elevation: 20,
  },
  blockerCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingVertical: 24,
    alignItems: "center",
    backgroundColor: "#F3E4BB",
    borderWidth: 2,
    borderColor: "rgba(29, 27, 32, 0.14)",
  },
  blockerCardSuccess: { backgroundColor: "#DDF4E3" },
  blockerIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.55)",
    marginBottom: 14,
  },
  blockerIconWrapSuccess: { backgroundColor: "rgba(255,255,255,0.72)" },
  blockerTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
    color: AppPalette.textPrimary,
    textAlign: "center",
  },
  blockerBody: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
    color: "rgba(29, 27, 32, 0.8)",
    textAlign: "center",
  },
  blockerExitButton: {
    marginTop: 18,
    minWidth: 160,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: AppPalette.textPrimary,
  },
  blockerExitButtonText: {
    fontSize: 15,
    fontWeight: "800",
    color: AppPalette.background,
    textAlign: "center",
  },
});
