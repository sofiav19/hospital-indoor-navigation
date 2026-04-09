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

const EMPTY_FC: any = { type: "FeatureCollection", features: [] };
const MAP_STYLE = JSON.stringify({
  version: 8,
  sources: {},
  layers: [
    {
      id: "bg",
      type: "background",
      paint: { "background-color": "#f6f6f6" },
    },
  ],
});

function getBoundsFromGeoJSON(data: any) {
  if (!data) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  // Loop to find the bounds of the geojson data
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

// return the features that correspond to the given floor
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

// filter to be able to only show the destination if the user is on the correct floor
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
  // These constants are so the map does not immediately snap back while the user is panning or zooming.
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

  // track the user intended view and set the camera to that
  const freezeCameraToViewport = (event: any) => {
    if (!cameraRef.current) return;
    if (manualFreezeInProgressRef.current) return;

    const zoom =
      event?.properties?.zoom ??
      event?.properties?.zoomLevel ??
      currentZoomRef.current;
    const heading = event?.properties?.heading ?? currentCameraHeadingRef.current ?? 0;
    const visibleBounds = event?.properties?.visibleBounds;
    let boundsCenter: [number, number] | null = null;

    if (Array.isArray(visibleBounds) && visibleBounds.length >= 2) {
      const [first, second] = visibleBounds;
      if (
        Array.isArray(first) &&
        Array.isArray(second) &&
        first.length >= 2 &&
        second.length >= 2 &&
        typeof first[0] === "number" &&
        typeof first[1] === "number" &&
        typeof second[0] === "number" &&
        typeof second[1] === "number"
      ) {
        boundsCenter = [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
      }
    }

    const center = currentCenterRef.current ?? boundsCenter;

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
    // Keep the latest live position
    latestUserCoordRef.current = userCoord;
  }, [userCoord]);

  useEffect(() => {
    // Keep requested recenter target available for the next recenter event.
    latestRecenterTargetCoordRef.current = recenterTargetCoord;
  }, [recenterTargetCoord]);

  useEffect(() => {
    // Recenter should preserve the latest heading that the screen asked the map to use.
    latestMapHeadingRef.current = mapHeading;
  }, [mapHeading]);

  // Show only the floorplan for the floor the user is currently viewing.
  const filteredFloorplan = useMemo(
    () => filterFeatureCollectionByFloor(floorplan || EMPTY_FC, currentFloor, false),
    [currentFloor, floorplan]
  );

  // Filter decision nodes by floor
  const filteredRouteNodes = useMemo(
    () => filterFeatureCollectionByFloor(routeNodes || EMPTY_FC, currentFloor, false),
    [currentFloor, routeNodes]
  );
  // Filter nodes by floor
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
    // Before navigation starts we can keep showing the destination freely; once
    // navigation starts, only show it on the matching floor.
    if (!destinationFeature) return null;
    if (!isStarted) return destinationFeature;
    return filterDestinationByFloor(destinationFeature, currentFloor);
  }, [currentFloor, destinationFeature, isStarted]);

  const initialCenter = useMemo<[number, number]>(() => {
    // Start the map near the main entrance when possible, otherwise fall back to the
    // first known node or a hardcoded hospital center.
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

  // Keep the camera element stable so MapLibre does not recreate it on every render.
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
    // Prefer to fit the route first
    const routeBounds = getBoundsFromGeoJSON(route);
    return routeBounds || getBoundsFromGeoJSON(filteredFloorplan) || getBoundsFromGeoJSON(iconNodes);
  }, [filteredFloorplan, iconNodes, route]);

  const goalPoint = useMemo<any>(() => {
    // Wrap the destination into a point feature for rendering
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
    // When navigation has not started yet, auto-fit to the map bounds
    if (!allowAutoCamera || !mapLoaded || !cameraRef.current || isStarted || !activeBounds) return;
    // if the user has manually interacted, do not auto-fit
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
    // Handle explicit recenter requests from the parent screen, but do not override
    // a manual interaction that happened after that request was made.
    if (recenterTick <= 0) return;
    if (recenterTick <= lastHandledRecenterTickRef.current) return;

    if (!allowRecenterCamera) return;
    if (lastManualInteractionAtRef.current > recenterRequestedAt) return;
    if (!mapLoaded || !cameraRef.current) return;

    const latestUserCoord = latestUserCoordRef.current;
    const targetCoord = latestRecenterTargetCoordRef.current ?? latestUserCoord;
    if (!targetCoord) return;

    lastHandledRecenterTickRef.current = recenterTick;
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

  return (
    <View
      style={styles.wrap}
      onTouchStart={() => {
        // Touching the map means the user is taking control, so pause follow mode.
        isTouchingMapRef.current = true;
        markManualInteraction();
      }}
      onTouchMove={() => {
        // Keep marking movement as manual interaction while the user drags the map.
        isTouchingMapRef.current = true;
        markManualInteraction();
      }}
      onTouchEnd={() => {
        isTouchingMapRef.current = false;
      }}
      onTouchCancel={() => {
        isTouchingMapRef.current = false;
      }}
    >
      <MapView
        style={styles.map}
        mapStyle={MAP_STYLE}
        rotateEnabled
        pitchEnabled={false}
        compassEnabled={false}
        zoomEnabled
        onRegionWillChange={(event: any) => {
          const isUserInteraction = event?.properties?.isUserInteraction;
          if (isTouchingMapRef.current || isUserInteraction === true) {
            // Freeze the camera to the user's current viewport so automatic follow
            // logic does not immediately snap the map somewhere else.
            markManualInteraction();
            freezeCameraToViewport(event);
            return;
          }

          // Ignore the move if it came from our own setCamera call.
          const isProgrammatic = Date.now() < programmaticCameraUntilRef.current;
          if (isProgrammatic) return;

          if (isUserInteraction === true) {
            markManualInteraction();
          }
        }}
        onRegionDidChange={(event: any) => {
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
        // Wait until the map is ready before trying to fit bounds or recenter it.
        onDidFinishLoadingMap={() => setMapLoaded(true)}
      >
        {cameraEnabled ? cameraElement : null}

        {/* Main floor polygon for the visible floor. */}
        <ShapeSource id="floorplan" shape={filteredFloorplan || EMPTY_FC}>
          <FillLayer id="floor-fill" style={{ fillColor: "#b9dfe8", fillOpacity: 1.0 }} />
          <LineLayer id="floor-outline" style={{ lineColor: "#0f1e21", lineWidth: 2 }} />
        </ShapeSource>

        {/* Primary route shown on the current map view. */}
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

        {/* Secondary route preview, usually future-floor path. */}
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

        {/* Decision points or route nodes highlighted along the route. */}
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

        {/* Custom map icons used by the node layers below. */}
        <Images
          images={{
            "door-icon": require("../../assets/icons/door.png"),
            "doors-icon": require("../../assets/icons/doors.png"),
            "stairs-icon": require("../../assets/icons/stairs.png"),
            "elevator-icon": require("../../assets/icons/elevator.png"),
            "goal-icon": require("../../assets/icons/goal.png"),
          }}
        />

        {/* Visible door, stairs, and elevator icons for the active floor. */}
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

        {/* Destination marker and optional label bubble. */}
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
          // Live user marker with optional heading arrow.
          <MarkerView coordinate={userCoord} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
            <View style={styles.userMarkerWrap} pointerEvents="none">
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
  },
  headingArrowSlot: {
    position: "absolute",
    top: 10,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  headingArrowShadow: {
    position: "absolute",
    width: 0,
    height: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#6291e2",
  },
  headingArrow: {
    position: "absolute",
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 10,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#0B57D0",
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
