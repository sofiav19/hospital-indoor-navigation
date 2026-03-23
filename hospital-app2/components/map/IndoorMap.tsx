import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet } from "react-native";
import {
  MapView,
  Camera,
  ShapeSource,
  FillLayer,
  LineLayer,
  CircleLayer,
  SymbolLayer,
  Images,
  MarkerView,
  type CameraRef,
} from "@maplibre/maplibre-react-native";

const EMPTY_FC = { type: "FeatureCollection", features: [] };

const MAP_STYLE = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "bg",
      type: "background",
      paint: { "background-color": "#f6f6f6" },
    },
  ],
};

function getBoundsFromGeoJSON(data: any) {
  if (!data) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const visitCoords = (coords: any) => {
    if (!Array.isArray(coords)) return;

    if (
      coords.length >= 2 &&
      typeof coords[0] === "number" &&
      typeof coords[1] === "number"
    ) {
      const [lng, lat] = coords;
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
      return;
    }

    for (const child of coords) {
      visitCoords(child);
    }
  };

  if (data.type === "FeatureCollection") {
    for (const feature of data.features || []) {
      visitCoords(feature?.geometry?.coordinates);
    }
  } else if (data.type === "Feature") {
    visitCoords(data.geometry?.coordinates);
  } else {
    visitCoords(data.coordinates);
  }

  if (
    !isFinite(minLng) ||
    !isFinite(minLat) ||
    !isFinite(maxLng) ||
    !isFinite(maxLat)
  ) {
    return null;
  }

  return {
    sw: [minLng, minLat] as [number, number],
    ne: [maxLng, maxLat] as [number, number],
  };
}

function getCenterFromVisibleBounds(
  visibleBounds: [[number, number], [number, number]] | undefined
): [number, number] | null {
  if (!Array.isArray(visibleBounds) || visibleBounds.length < 2) return null;

  const [first, second] = visibleBounds;
  if (
    !Array.isArray(first) ||
    !Array.isArray(second) ||
    first.length < 2 ||
    second.length < 2
  ) {
    return null;
  }

  const [lngA, latA] = first;
  const [lngB, latB] = second;
  if (
    typeof lngA !== "number" ||
    typeof latA !== "number" ||
    typeof lngB !== "number" ||
    typeof latB !== "number"
  ) {
    return null;
  }

  return [(lngA + lngB) / 2, (latA + latB) / 2];
}

function filterFeatureCollectionByFloor(
  data: any,
  floor: number | null,
  includeFloorless = false
) {
  if (!data || data.type !== "FeatureCollection") return data || EMPTY_FC;
  if (floor === null || floor === undefined) return data;

  return {
    ...data,
    features: (data.features || []).filter((feature: any) => {
      const featureFloor = feature?.properties?.floor;
      if (featureFloor === undefined || featureFloor === null) return includeFloorless;
      return featureFloor === floor;
    }),
  };
}

function filterDestinationByFloor(feature: any, floor: number | null) {
  if (!feature) return null;
  if (floor === null || floor === undefined) return feature;

  const featureFloor = feature?.properties?.floor ?? null;
  if (featureFloor === null) return feature;
  return featureFloor === floor ? feature : null;
}

export default function IndoorMap({
  currentFloor = null,
  nodes,
  floorplan,
  route,
  secondaryRoute = null,
  routeNodes,
  destinationFeature = null,
  mapHeading = 0,
  userCoord,
  recenterTargetCoord = null,
  userHeading = null,
  isStarted = false,
  allowAutoCamera = true,
  allowRecenterCamera = true,
  cameraEnabled = true,
  recenterTick = 0,
  recenterRequestedAt = 0,
  onMapInteraction,
}: {
  currentFloor?: number | null;
  nodes: any;
  floorplan: any;
  route: any | null;
  secondaryRoute?: any | null;
  routeNodes?: any | null;
  destinationFeature?: any | null;
  mapHeading?: number;
  userCoord: [number, number] | null;
  recenterTargetCoord?: [number, number] | null;
  userHeading?: number | null;
  isStarted?: boolean;
  allowAutoCamera?: boolean;
  allowRecenterCamera?: boolean;
  cameraEnabled?: boolean;
  recenterTick?: number;
  recenterRequestedAt?: number;
  onMapInteraction?: () => void;
}) {
  const cameraRef = useRef<CameraRef>(null);
  const latestUserCoordRef = useRef<[number, number] | null>(null);
  const latestRecenterTargetCoordRef = useRef<[number, number] | null>(null);
  const latestMapHeadingRef = useRef<number>(0);
  const lastHandledRecenterTickRef = useRef<number>(-1);
  const followPausedByUserRef = useRef(false);
  const manualOverrideRef = useRef(false);
  const lastManualInteractionAtRef = useRef(0);
  const isTouchingMapRef = useRef(false);
  const currentZoomRef = useRef<number>(21);
  const currentCenterRef = useRef<[number, number] | null>(null);
  const currentCameraHeadingRef = useRef<number>(0);
  const programmaticCameraUntilRef = useRef(0);
  const recenteredUntilRef = useRef(0);
  const manualFreezeInProgressRef = useRef(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [showGoalLabel, setShowGoalLabel] = useState(false);

  const markProgrammaticCameraMove = (durationMs = 550) => {
    programmaticCameraUntilRef.current = Date.now() + durationMs;
  };

  const markManualInteraction = () => {
    const wasManualOverrideActive = manualOverrideRef.current;
    manualOverrideRef.current = true;
    followPausedByUserRef.current = true;
    lastManualInteractionAtRef.current = Date.now();

    if (!wasManualOverrideActive) {
      onMapInteraction?.();
    }
  };

  const freezeCameraToViewport = (event: any) => {
    if (!cameraRef.current) return;
    if (manualFreezeInProgressRef.current) return;

    const zoom =
      event?.properties?.zoom ??
      event?.properties?.zoomLevel ??
      currentZoomRef.current;
    const heading =
      event?.properties?.heading ?? currentCameraHeadingRef.current ?? 0;
    const center =
      currentCenterRef.current ??
      getCenterFromVisibleBounds(event?.properties?.visibleBounds);

    if (
      !center ||
      typeof zoom !== "number" ||
      !Number.isFinite(zoom) ||
      typeof heading !== "number" ||
      !Number.isFinite(heading)
    ) {
      return;
    }

    manualFreezeInProgressRef.current = true;

    markProgrammaticCameraMove(120);
    cameraRef.current.setCamera({
      centerCoordinate: center,
      zoomLevel: zoom,
      heading,
      animationDuration: 0,
      animationMode: "moveTo",
    });

    setTimeout(() => {
      manualFreezeInProgressRef.current = false;
    }, 150);
  };

  useEffect(() => {
    latestUserCoordRef.current = userCoord;
  }, [userCoord]);

  useEffect(() => {
    latestRecenterTargetCoordRef.current = recenterTargetCoord;
  }, [recenterTargetCoord]);

  useEffect(() => {
    latestMapHeadingRef.current = mapHeading;
  }, [mapHeading]);

  const filteredFloorplan = useMemo(
    () => filterFeatureCollectionByFloor(floorplan || EMPTY_FC, currentFloor, false),
    [currentFloor, floorplan]
  );

  const filteredRouteNodes = useMemo(
    () => filterFeatureCollectionByFloor(routeNodes || EMPTY_FC, currentFloor, false),
    [currentFloor, routeNodes]
  );

  const filteredNodes = useMemo(
    () => filterFeatureCollectionByFloor(nodes || EMPTY_FC, currentFloor, false),
    [currentFloor, nodes]
  );

  const iconNodes = useMemo(() => {
    const routeNodeFeatures = filteredRouteNodes?.features || [];
    if (routeNodeFeatures.length) return filteredRouteNodes;
    return filteredNodes;
  }, [filteredNodes, filteredRouteNodes]);

  const visibleDestinationFeature = useMemo(() => {
    if (!destinationFeature) return null;
    if (!isStarted) return destinationFeature;
    return filterDestinationByFloor(destinationFeature, currentFloor);
  }, [currentFloor, destinationFeature, isStarted]);

  const initialCenter = useMemo<[number, number]>(() => {
    const entrance =
      filteredNodes?.features?.find((f: any) => f.properties?.role === "doors") ||
      filteredNodes?.features?.[0] ||
      nodes?.features?.find((f: any) => f.properties?.role === "doors") ||
      nodes?.features?.[0];

    return entrance?.geometry?.coordinates || [-3.67983, 40.43246];
  }, [filteredNodes, nodes]);

  const cameraDefaultSettingsRef = useRef({
    centerCoordinate: initialCenter,
    zoomLevel: 21,
    heading: 0,
  });

  const cameraElement = useMemo(
    () => (
      <Camera
        ref={cameraRef}
        defaultSettings={cameraDefaultSettingsRef.current}
        minZoomLevel={15}
        maxZoomLevel={24}
      />
    ),
    []
  );

  const activeBounds = useMemo(() => {
    const routeBounds = getBoundsFromGeoJSON(route);
    return routeBounds || getBoundsFromGeoJSON(filteredFloorplan) || getBoundsFromGeoJSON(iconNodes);
  }, [filteredFloorplan, iconNodes, route]);

  const userPoint = useMemo<any>(() => {
    if (!userCoord) return EMPTY_FC;

    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Point",
            coordinates: userCoord,
          },
        },
      ],
    };
  }, [userCoord]);

  const goalPoint = useMemo(() => {
    if (!visibleDestinationFeature?.geometry?.coordinates) return EMPTY_FC;

    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            ...(visibleDestinationFeature.properties || {}),
            goalLabel: visibleDestinationFeature.properties?.label || "Destination",
          },
          geometry: {
            type: "Point",
            coordinates: visibleDestinationFeature.geometry.coordinates,
          },
        },
      ],
    };
  }, [visibleDestinationFeature]);

  useEffect(() => {
    if (!allowAutoCamera || !mapLoaded || !cameraRef.current || isStarted || !activeBounds) return;
    if (manualOverrideRef.current) return;
    if (followPausedByUserRef.current) return;
    if (Date.now() < recenteredUntilRef.current) return;

    markProgrammaticCameraMove();
    cameraRef.current.setCamera({
      bounds: {
        ne: activeBounds.ne,
        sw: activeBounds.sw,
      },
      padding: {
        paddingTop: 80,
        paddingRight: 40,
        paddingBottom: 40,
        paddingLeft: 40,
      },
      animationDuration: 0,
      animationMode: "moveTo",
    });
  }, [activeBounds, allowAutoCamera, isStarted, mapLoaded]);

  useEffect(() => {
    if (recenterTick <= 0) return;
    if (recenterTick <= lastHandledRecenterTickRef.current) return;

    if (!allowRecenterCamera) return;
    if (lastManualInteractionAtRef.current > recenterRequestedAt) return;
    if (!mapLoaded || !cameraRef.current) return;

    const latestUserCoord = latestUserCoordRef.current;
    const targetCoord = latestRecenterTargetCoordRef.current ?? latestUserCoord;
    if (!targetCoord) return;

    // Consume tick only once we can actually apply the target view.
    lastHandledRecenterTickRef.current = recenterTick;

    // Re-enable guided follow only when user explicitly requests recenter/target.
    followPausedByUserRef.current = false;
    manualOverrideRef.current = false;

    markProgrammaticCameraMove(120);
    recenteredUntilRef.current = Date.now() + 120;
    cameraRef.current.setCamera({
      centerCoordinate: targetCoord,
      zoomLevel: 22,
      heading: latestMapHeadingRef.current,
      animationDuration: 0,
      animationMode: "moveTo",
    });
  }, [allowRecenterCamera, mapLoaded, recenterRequestedAt, recenterTick]);

  // Intentionally no continuous auto-follow camera effect.
  // Camera recenter/orientation is only applied on explicit recenterTick requests
  // (target button / start action), so manual map control stays stable.

  return (
    <View style={styles.wrap}>
      <MapView
        style={styles.map}
        mapStyle={MAP_STYLE}
        rotateEnabled
        pitchEnabled={false}
        compassEnabled={false}
        zoomEnabled
        onTouchStart={() => {
          isTouchingMapRef.current = true;
          markManualInteraction();
        }}
        onTouchMove={() => {
          isTouchingMapRef.current = true;
          markManualInteraction();
        }}
        onTouchEnd={() => {
          isTouchingMapRef.current = false;
        }}
        onTouchCancel={() => {
          isTouchingMapRef.current = false;
        }}
        onRegionWillChange={(event: any) => {
          const isUserInteraction = event?.properties?.isUserInteraction;
          if (isTouchingMapRef.current || isUserInteraction === true) {
            markManualInteraction();
            freezeCameraToViewport(event);
            return;
          }

          const isProgrammatic = Date.now() < programmaticCameraUntilRef.current;
          if (isProgrammatic) return;

          if (isUserInteraction !== false) {
            markManualInteraction();
          }
        }}
        onCameraChanged={(event: any) => {
          const zoom = event?.properties?.zoom ?? event?.properties?.zoomLevel;
          if (typeof zoom === "number" && Number.isFinite(zoom)) {
            currentZoomRef.current = zoom;
          }

          const center =
            event?.properties?.centerCoordinate ??
            event?.properties?.center ??
            null;
          if (
            Array.isArray(center) &&
            center.length >= 2 &&
            typeof center[0] === "number" &&
            typeof center[1] === "number"
          ) {
            currentCenterRef.current = [center[0], center[1]];
          }

          const heading = event?.properties?.heading;
          if (typeof heading === "number" && Number.isFinite(heading)) {
            currentCameraHeadingRef.current = heading;
          }
        }}
        onDidFinishLoadingMap={() => setMapLoaded(true)}
      >
        {cameraEnabled ? cameraElement : null}

        <ShapeSource id="floorplan" shape={filteredFloorplan || EMPTY_FC}>
          <FillLayer id="floor-fill" style={{ fillColor: "#b9dfe8", fillOpacity: 1.0 }} />
          <LineLayer id="floor-outline" style={{ lineColor: "#0f1e21", lineWidth: 2 }} />
        </ShapeSource>

        <ShapeSource id="route" shape={route || EMPTY_FC}>
          <LineLayer
            id="route-layer"
            style={{
              lineColor: "#0c3a44",
              lineWidth: 10,
              lineOpacity: 1,
            }}
          />
        </ShapeSource>

        <ShapeSource id="route-secondary" shape={secondaryRoute || EMPTY_FC}>
          <LineLayer
            id="route-secondary-layer"
            style={{
              lineColor: "#78AEBB",
              lineWidth: 10,
              lineOpacity: 0.8,
            }}
          />
        </ShapeSource>

        <ShapeSource id="route-node-points" shape={filteredRouteNodes || EMPTY_FC}>
          <CircleLayer
            id="route-node-points-layer"
            style={{
              circleRadius: 4,
              circleColor: "#3F9BB0",
              circleStrokeColor: "#ffffff",
              circleStrokeWidth: 2,
            }}
          />
        </ShapeSource>

        <Images
          images={{
            "door-icon": require("../../assets/icons/door.png"),
            "doors-icon": require("../../assets/icons/doors.png"),
            "stairs-icon": require("../../assets/icons/stairs.png"),
            "elevator-icon": require("../../assets/icons/elevator.png"),
            "goal-icon": require("../../assets/icons/goal.png"),
          }}
        />

        <ShapeSource id="nodes" shape={iconNodes || EMPTY_FC}>
          <SymbolLayer
            id="door-layer"
            filter={["==", ["get", "role"], "door"]}
            style={{
              iconOffset: [0, -70],
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              iconImage: "door-icon",
              iconSize: ["interpolate", ["linear"], ["zoom"], 18, 0.08, 20, 0.12, 22, 0.18, 24, 0.18],
              iconRotate: ["coalesce", ["get", "angle"], 0],
              iconRotationAlignment: "map",
            }}
          />

          <SymbolLayer
            id="doors-layer"
            filter={["==", ["get", "role"], "doors"]}
            style={{
              iconOffset: [0, -110],
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              iconImage: "doors-icon",
              iconSize: ["interpolate", ["linear"], ["zoom"], 18, 0.03, 20, 0.05, 22, 0.1, 24, 0.18],
              iconRotate: ["coalesce", ["get", "angle"], 0],
              iconRotationAlignment: "map",
            }}
          />

          <SymbolLayer
            id="stairs-layer"
            filter={["==", ["get", "role"], "stairs"]}
            style={{
              iconOffset: [0, -120],
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              iconImage: "stairs-icon",
              iconSize: ["interpolate", ["linear"], ["zoom"], 18, 0.04, 20, 0.08, 22, 0.12, 24, 0.18],
            }}
          />

          <SymbolLayer
            id="elevator-layer"
            filter={["==", ["get", "role"], "elevator"]}
            style={{
              iconOffset: [0, 80],
              iconRotate: ["coalesce", ["get", "angle"], 0],
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              iconImage: "elevator-icon",
              iconSize: ["interpolate", ["linear"], ["zoom"], 18, 0.02, 20, 0.06, 22, 0.1, 24, 0.16],
            }}
          />
        </ShapeSource>

        <ShapeSource id="goal-point" shape={goalPoint} onPress={() => setShowGoalLabel((value) => !value)}>
          <SymbolLayer
            id="goal-marker-layer"
            style={{
              iconOffset: [0, -400],
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              iconImage: "goal-icon",
              iconSize: ["interpolate", ["linear"], ["zoom"], 18, 0.01, 20, 0.03, 22, 0.06, 24, 0.08],
            }}
          />
          <SymbolLayer
            id="goal-label-layer"
            style={{
              textField: showGoalLabel ? ["get", "goalLabel"] : "",
              textSize: ["interpolate", ["linear"], ["zoom"], 18, 14, 20, 13, 22, 11, 24, 10],
              textOffset: [0, 2.3],
              textAnchor: "top",
              textColor: "#1D1B20",
              textHaloColor: "#FFFFFF",
              textHaloWidth: 1.5,
            }}
          />
        </ShapeSource>

        {userCoord ? (
          <MarkerView coordinate={userCoord} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
            <View style={styles.userMarkerWrap}>
              {typeof userHeading === "number" && Number.isFinite(userHeading) ? (
                <View
                  style={[
                    styles.headingArrowSlot,
                    { transform: [{ rotate: `${userHeading}deg` }] },
                  ]}
                >
                  <View style={styles.headingArrowShadow} />
                  <View style={styles.headingArrow} />
                </View>
              ) : null}
              <View style={styles.userDotShadow} />
              <View style={styles.userDot} />
            </View>
          </MarkerView>
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  map: { flex: 1 },
  userMarkerWrap: {
    width: 36,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  },
  headingArrowSlot: {
    position: "absolute",
    top: 10,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "flex-right",
    overflow: "hidden",
  },
  headingArrowShadow: {
    position: "absolute",
    width: 0,
    height: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#6291e2",
  },
  headingArrow: {
    position: "absolute",
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 10,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#0B57D0",
  },
  userDotShadow: {
    position: "absolute",
    top: 18,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  userDot: {
    position: "absolute",
    top: 21,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#1A73E8",
  },
});
