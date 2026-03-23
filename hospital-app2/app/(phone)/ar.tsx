import React, { useEffect, useMemo, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavStore } from "../../store/navStore";
import { buildDetailedInstruction } from "../../lib/route/navigationInstructions";
import { AppPalette } from "../../constants/theme";

let CameraViewImpl: any = null;
let useCameraPermissionsImpl: any = null;
let LocationImpl: any = null;

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
  return Math.max(min, Math.min(max, value));
}

function distanceMeters(a: [number, number], b: [number, number]) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
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

function getHeadingFromSegment(coords: [number, number][]) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;

  const start = coords[0];
  const end = coords[coords.length - 1];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return 0;

  const bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (bearing + 360) % 360;
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

  // Same dynamic smoothing as map view to keep both experiences aligned.
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

function parseMeters(detail: string | null | undefined) {
  if (!detail) return null;
  const match = detail.match(/(\d+)/);
  if (!match) return null;
  return Number(match[1]);
}

function getBannerIconName(hint: string) {
  switch (hint) {
    case "left":
      return "arrow-left-thin";
    case "right":
      return "arrow-right-thin";
    case "left-forward":
      return "arrow-top-left-thin";
    case "right-forward":
      return "arrow-top-right-thin";
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

const FLOOR_GUIDE_COLORS = ["#55F5FF", "#1739FF"];

function isFloorGuideHint(hint: string) {
  return ["forward", "left", "right", "left-forward", "right-forward"].includes(hint);
}

function getFloorGuideShift(hint: string, progress: number) {
  if (hint === "left") return -Math.max(0, progress - 0.62) * 140;
  if (hint === "right") return Math.max(0, progress - 0.62) * 140;
  if (hint === "left-forward") return -Math.max(0, progress - 0.72) * 170;
  if (hint === "right-forward") return Math.max(0, progress - 0.72) * 170;
  return 0;
}

export default function ArNavigation() {
  const insets = useSafeAreaInsets();
  const [cameraPermission, requestCameraPermission] = useCameraPermissionsImpl();
  const isCameraNativeAvailable = Boolean(CameraViewImpl);

  const [locationPermissionGranted, setLocationPermissionGranted] = useState<boolean | null>(null);
  const [sensorHeading, setSensorHeading] = useState<number | null>(null);
  const [smoothedSensorHeading, setSmoothedSensorHeading] = useState<number | null>(null);
  const [headingWatchError, setHeadingWatchError] = useState(false);
  const [hasHeadingSample, setHasHeadingSample] = useState(false);

  const navData = useNavStore((s) => s.navData);
  const destinationId = useNavStore((s) => s.destinationId);
  const route = useNavStore((s) => s.route);
  const isStarted = useNavStore((s) => s.navigationUi.isStarted);
  const activeStepIndex = useNavStore((s) => s.navigationUi.activeStepIndex);
  const currentFloor = useNavStore((s) => s.navigationUi.navigationFloor);
  const prefer = useNavStore((s) => s.navigationUi.prefer);
  const soundEnabled = useNavStore((s) => s.navigationUi.soundEnabled);
  const setNavigationPreference = useNavStore((s) => s.setNavigationPreference);
  const setMapViewMode = useNavStore((s) => s.setMapViewMode);
  const setSoundEnabled = useNavStore((s) => s.setSoundEnabled);
  const livePosition = useNavStore((s) => s.livePosition);

  // Optional future OptiTrack/local-frame heading from store.
  const optitrackHeading =
    (livePosition as any)?.heading ??
    (livePosition as any)?.yawDegrees ??
    (livePosition as any)?.orientationDegrees ??
    null;

  useEffect(() => {
    setMapViewMode("ar");
  }, [setMapViewMode]);

  useEffect(() => {
    if (!cameraPermission || cameraPermission.granted) return;
    requestCameraPermission();
  }, [cameraPermission, requestCameraPermission]);

  useEffect(() => {
    let subscription: any = null;
    let isMounted = true;

    function stopHeadingWatch() {
      if (subscription?.remove) {
        subscription.remove();
      }
      subscription = null;
    }

    async function startHeadingWatch() {
      if (!LocationImpl) return;

      stopHeadingWatch();
      setHeadingWatchError(false);

      try {
        const currentPermission = await LocationImpl.getForegroundPermissionsAsync();
        let granted = currentPermission?.granted === true;

        if (!granted) {
          const requestedPermission = await LocationImpl.requestForegroundPermissionsAsync();
          granted = requestedPermission?.granted === true;
        }

        if (!isMounted) return;

        setLocationPermissionGranted(granted);

        if (!granted) {
          setSensorHeading(null);
          setHasHeadingSample(false);
          return;
        }

        setHasHeadingSample(false);

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
          }
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

  const segments = useMemo(
    () => route.summary?.instructionSegments || [],
    [route.summary?.instructionSegments]
  );

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

  const displayedInstructionIndex = useMemo(() => {
    if (!instructionItems.length) return 0;

    const clampedActiveIndex = Math.min(activeStepIndex, instructionItems.length - 1);
    const activeSegment = segments[clampedActiveIndex] || null;
    if (!activeSegment) return clampedActiveIndex;

    if (currentFloor !== null) {
      if (segmentTouchesFloor(activeSegment, currentFloor)) return clampedActiveIndex;

      for (let i = clampedActiveIndex; i < segments.length; i++) {
        if (segmentTouchesFloor(segments[i], currentFloor)) return i;
      }
    }

    return clampedActiveIndex;
  }, [activeStepIndex, currentFloor, instructionItems.length, segments]);

  const currentSegment = segments[displayedInstructionIndex] || null;
  const nextSegment = segments[displayedInstructionIndex + 1] || null;
  const nextInstruction = instructionItems[displayedInstructionIndex] || null;
  const userCoord = ((livePosition as any)?.coords as [number, number] | null) ?? null;

  const arHint = useMemo(() => {
    const maneuver = nextInstruction?.maneuver;
    if (typeof maneuver === "string" && maneuver.length > 0) return maneuver;
    return getSegmentTurnHint(currentSegment, nextSegment);
  }, [currentSegment, nextInstruction?.maneuver, nextSegment]);

  const hasActiveRoute = Boolean(destinationId && route?.ok && segments.length);

  const activeHeading = useMemo(() => {
    if (typeof optitrackHeading === "number") return optitrackHeading;
    if (typeof smoothedSensorHeading === "number") return smoothedSensorHeading;
    return null;
  }, [optitrackHeading, smoothedSensorHeading]);

  useEffect(() => {
    if (typeof sensorHeading !== "number" || !Number.isFinite(sensorHeading)) {
      setSmoothedSensorHeading(null);
      return;
    }

    setSmoothedSensorHeading((previous) => smoothHeading(previous, sensorHeading));
  }, [sensorHeading]);

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

  const headingError = useMemo(() => {
    if (typeof activeHeading !== "number" || typeof targetHeading !== "number") return 0;
    return normalizeAngleDelta(targetHeading - activeHeading);
  }, [activeHeading, targetHeading]);

  const arrowOffsetX = useMemo(() => {
    // 1 degree â‰ˆ 2.2 px, clamped for readability.
    return clamp(headingError * 2.2, -130, 130);
  }, [headingError]);

  const instructionDistanceMeters = useMemo(() => parseMeters(nextInstruction?.detail), [nextInstruction?.detail]);

  const arrowScale = useMemo(() => {
    if (!instructionDistanceMeters || instructionDistanceMeters <= 0) return 1;
    // larger when closer, smaller when farther
    const raw = 1.35 - instructionDistanceMeters / 30;
    return clamp(raw, 0.85, 1.35);
  }, [instructionDistanceMeters]);

  const directionCaption = useMemo(() => {
    if (typeof activeHeading !== "number" || typeof targetHeading !== "number") {
      return "Apunte el telÃ©fono hacia la ruta";
    }

    const absError = Math.abs(headingError);
    if (absError < 12) return "EstÃ¡ alineado";
    if (headingError < 0) return absError > 45 ? "Gire a la izquierda" : "Leve giro a la izquierda";
    return absError > 45 ? "Gire a la derecha" : "Leve giro a la derecha";
  }, [activeHeading, headingError, targetHeading]);

  const headingSourceLabel = useMemo(() => {
    if (typeof optitrackHeading === "number") return "Referencia local";
    if (typeof sensorHeading === "number") return "Brújula del teléfono";
    if (locationPermissionGranted === null && LocationImpl) return "Comprobando orientación";
    if (LocationImpl && !locationPermissionGranted) return "Active ubicación para orientar mejor";
    if (headingWatchError) return "Sensor no disponible";
    if (LocationImpl && locationPermissionGranted && !hasHeadingSample) {
      return "Calibre la brújula moviendo el teléfono en un 8";
    }
    return "Orientación no disponible";
  }, [hasHeadingSample, headingWatchError, locationPermissionGranted, optitrackHeading, sensorHeading]);

  const bannerIconName = useMemo(() => getBannerIconName(arHint), [arHint]);

  const transitionZoneOptions = useMemo(() => {
    if (!userCoord || !navData.nodes) return [];

    const options = (navData.nodes.features || [])
      .filter((feature: any) => {
        const role = feature?.properties?.role;
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

    return options.sort((a: any, b: any) => (a.floor ?? 0) - (b.floor ?? 0));
  }, [navData.nodes, userCoord]);

  const visibleFloorOptions = useMemo(() => {
    if (!isStarted) return [];
    if (transitionZoneOptions.length > 1) return transitionZoneOptions;
    if (isCrossFloorSegment(currentSegment)) {
      const fromFloor = currentSegment?.floor ?? null;
      const toFloor = currentSegment?.toFloor ?? null;
      return [fromFloor, toFloor]
        .filter((floor, index, list) => floor !== null && list.indexOf(floor) === index)
        .sort((a: any, b: any) => a - b)
        .map((floor: any) => ({ floor, role: getNodeRole(navData.nodes, currentSegment?.fromNodeId) || "transition" }));
    }
    return [];
  }, [currentSegment, isStarted, navData.nodes, transitionZoneOptions]);

  const arStatusMessage = useMemo(() => {
    if (isStarted && visibleFloorOptions.length > 1) {
      const roleLabel = visibleFloorOptions[0]?.role || "transiciÃ³n";
      const floorsText = visibleFloorOptions.map((option: any) => `P${option.floor}`).join(" / ");
      return `Cerca de ${roleLabel} Â· ${floorsText}`;
    }
    return `Planta ${currentFloor ?? "-"}`;
  }, [currentFloor, isStarted, visibleFloorOptions]);

  return (
    <View style={styles.screen}>
      {isCameraNativeAvailable && cameraPermission?.granted ? (
        <CameraViewImpl facing="back" style={styles.camera} />
      ) : !isCameraNativeAvailable ? (
        <View style={styles.permissionFallback}>
          <Text style={styles.permissionTitle}>MÃ³dulo de cÃ¡mara no disponible</Text>
          <Text style={styles.permissionBody}>
            Esta versiÃ³n de desarrollo no incluye Expo Camera. Vuelva a compilar e instale de nuevo el cliente.
          </Text>
        </View>
      ) : (
        <View style={styles.permissionFallback}>
          <Text style={styles.permissionTitle}>Se necesita permiso de cÃ¡mara</Text>
          <Text style={styles.permissionBody}>Permita el acceso a la cÃ¡mara para ver las flechas de RA.</Text>
          <Pressable style={styles.permissionButton} onPress={requestCameraPermission}>
            <Text style={styles.permissionButtonText}>Permitir cÃ¡mara</Text>
          </Pressable>
        </View>
      )}

      <View pointerEvents="box-none" style={styles.overlay}>
        <View style={[styles.instructionCard, { paddingTop: Math.max(insets.top, 14) + 8 }]}>
          <View style={styles.instructionHeaderRow}>
            <MaterialCommunityIcons
              name={bannerIconName as any}
              size={76}
              color={AppPalette.textPrimary}
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
                  ? "Inicie la navegaciÃ³n para ver guÃ­a en cÃ¡mara"
                  : !isStarted
                    ? "Inicie la navegaciÃ³n para ver guÃ­a en cÃ¡mara"
                    : nextInstruction?.title || "ContinÃºe"}
              </Text>

              {isStarted && nextInstruction?.detail ? (
                <Text style={styles.instructionDetail}>{nextInstruction.detail}</Text>
              ) : null}

              {isStarted ? (
                <View style={styles.headingMetaPill}>
                  <Ionicons name="compass-outline" size={13} color={AppPalette.background} style={styles.headingMetaIcon} />
                  <Text style={styles.headingMeta}>{headingSourceLabel}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={[styles.mapActions, { top: Math.max(insets.top, 12) + 112 }]}>
          <Pressable style={styles.actionButton} onPress={() => router.replace("/navigate")}>
            <Ionicons name="map-outline" size={28} color={AppPalette.background} />
          </Pressable>
          <Pressable style={styles.actionButton} onPress={() => setNavigationPreference(prefer === "stairs" ? "elevator" : "stairs")}>
            <MaterialCommunityIcons
              name={prefer === "stairs" ? "stairs" : "elevator"}
              size={28}
              color={AppPalette.background}
            />
          </Pressable>
          <Pressable style={styles.actionButton} onPress={() => setSoundEnabled(!soundEnabled)}>
            <Ionicons
              name={soundEnabled ? "volume-high" : "volume-mute"}
              size={28}
              color={AppPalette.background}
            />
          </Pressable>
          <Pressable style={styles.actionButton} onPress={() => router.push("/help")}>
            <Ionicons name="help" size={28} color={AppPalette.background} />
          </Pressable>
        </View>

        {isStarted && hasActiveRoute ? (
          <View style={styles.arrowZone}>
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

              {isFloorGuideHint(arHint) ? (
                <View style={styles.floorGuideField}>
                  {Array.from({ length: 6 }).map((_, index, list) => {
                    const progress = index / Math.max(1, list.length - 1);
                    const shift = getFloorGuideShift(arHint, progress);
                    const color = FLOOR_GUIDE_COLORS[index % FLOOR_GUIDE_COLORS.length];
                    const width = 72 + progress * 190;
                    const pointWidth = 24 + progress * 110;
                    const pointHeight = 9 + progress * 10;
                    return (
                      <View
                        key={`floor-guide-arrow-${index}`}
                        style={[
                          styles.floorGuideArrow,
                          {
                            opacity: 0.5 + progress * 0.45,
                            width,
                            transform: [{ translateX: shift }],
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
                            },
                          ]}
                        />
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {arHint === "up" ? (
                <View style={styles.floorArrowWrap}>
                  <MaterialCommunityIcons name="stairs-up" size={112} color={AppPalette.primary} />
                  <MaterialCommunityIcons name="arrow-up-bold" size={96} color={AppPalette.primary} />
                </View>
              ) : null}

              {arHint === "down" ? (
                <View style={styles.floorArrowWrap}>
                  <MaterialCommunityIcons name="stairs-down" size={112} color={AppPalette.primary} />
                  <MaterialCommunityIcons name="arrow-down-bold" size={96} color={AppPalette.primary} />
                </View>
              ) : null}
            </View>

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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0D1B22" },
  camera: { ...StyleSheet.absoluteFillObject },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(8, 15, 18, 0.16)" },

  instructionCard: {
    marginHorizontal: 10,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: AppPalette.primary,
  },
  instructionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  instructionHeaderIcon: {
    marginRight: 12,
  },
  instructionTextWrap: {
    flex: 1,
  },
  instructionTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: AppPalette.textPrimary,
    lineHeight: 30,
  },
  instructionDetail: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: "700",
    color: "rgba(29, 27, 32, 0.78)",
  },
  headingMeta: {
    fontSize: 11,
    fontWeight: "800",
    color: AppPalette.background,
  },
  headingMetaPill: {
    alignSelf: "flex-start",
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    backgroundColor: "rgba(15, 30, 33, 0.42)",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  headingMetaIcon: {
    marginRight: 6,
  },
  mapActions: {
    position: "absolute",
    right: 16,
    zIndex: 3,
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.55)",
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
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

  arrowZone: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingBottom: 80,
  },
  directionCaptionWrap: {
    position: "absolute",
    left: 18,
    bottom: 8,
    borderRadius: 16,
    backgroundColor: AppPalette.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  directionCaption: {
    fontSize: 16,
    fontWeight: "800",
    color: AppPalette.background,
  },
  arrowFloating: {
    position: "absolute",
    bottom: 86,
    left: "50%",
    marginLeft: -118,
    width: 236,
    alignItems: "center",
    justifyContent: "center",
  },
  floorGuideField: {
    width: "100%",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
  },
  floorGuideArrow: {
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 0,
  },
  floorGuideArrowPoint: {
    width: 0,
    height: 0,
  },
  stackCenter: {
    alignItems: "center",
    justifyContent: "center",
  },
  floorArrowWrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
    opacity: 0.94,
    transform: [{ scaleX: 1.35 }, { scaleY: 0.8 }],
  },

  alignmentBarWrap: {
    position: "absolute",
    bottom: 72,
    width: "78%",
    alignItems: "center",
    justifyContent: "center",
  },
  alignmentBar: {
    width: "100%",
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
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
  statusPillInteractive: {
    backgroundColor: "#2A7C8E",
  },
  statusPillText: {
    fontSize: 16,
    fontWeight: "800",
    color: AppPalette.background,
  },
  floorSwitchRow: {
    position: "absolute",
    right: 24,
    bottom: 8,
    flexDirection: "row",
    gap: 8,
  },
  floorPillButton: {
    position: "relative",
    right: 0,
    bottom: 0,
  },
  floorPillButtonInactive: {
    backgroundColor: AppPalette.background,
  },
  floorPillTextInactive: {
    color: AppPalette.textPrimary,
  },

  permissionFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "#0D1B22",
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
  },
  permissionBody: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: "600",
    color: "#CBE6EE",
    textAlign: "center",
  },
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
});


