import React, { useMemo } from "react";
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
} from "@maplibre/maplibre-react-native";
console.log("MapView", MapView);
console.log("ShapeSource", ShapeSource);
console.log("CircleLayer", CircleLayer);
console.log("Images", Images);
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

export default function IndoorMap({
  nodes,
  edges,
  floorplan,
  route,
  userCoord,
}: {
  nodes: any;
  edges: any;
  floorplan: any;
  route: any | null;
  userCoord: [number, number] | null;
}) {
  // pick a reasonable initial center:
  const initialCenter = useMemo<[number, number]>(() => {
    const entrance =
      nodes?.features?.find((f: any) => f.properties?.role === "doors") ||
      nodes?.features?.[0];
    return entrance?.geometry?.coordinates || [-3.67983, 40.43246];
  }, [nodes]);

  const userPoint = useMemo(() => {
    console.log("userCoord:", userCoord);
    console.log("userPoint:", JSON.stringify(userPoint));
    if (!userCoord) return EMPTY_FC;
    return {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: userCoord } },
      ],
    };
  }, [userCoord]);

  return (
    <View style={styles.wrap}>
      <MapView style={styles.map} mapStyle={MAP_STYLE} rotateEnabled={false} pitchEnabled={false}>
        <Camera centerCoordinate={initialCenter} zoomLevel={20} />

        {/* Floorplan */}
        <ShapeSource id="floorplan" shape={floorplan || EMPTY_FC}>
          <FillLayer
            id="floor-fill"
            style={{ fillColor: "#75ad70", fillOpacity: 1.0 }}
          />
          <LineLayer
            id="floor-outline"
            style={{ lineColor: "#cfcfcf", lineWidth: 2 }}
          />
        </ShapeSource>

        {/* Edges */}
        <ShapeSource id="edges" shape={edges || EMPTY_FC}>
          <LineLayer id="edges-layer" style={{ lineColor: "#2b7fff", lineWidth: 4 }} />
        </ShapeSource>

        {/* Route */}
        <ShapeSource id="route" shape={route || EMPTY_FC}>
          <LineLayer id="route-layer" style={{ lineColor: "#ff7a00", lineWidth: 6 }} />
        </ShapeSource>

        {/* POI icons */}
        <Images
          images={{
            "door-icon": require("../../assets/icons/door.png"),
            "doors-icon": require("../../assets/icons/doors.png"),
            "stairs-icon": require("../../assets/icons/stairs.png"),
            "elevator-icon": require("../../assets/icons/elevator.png"),
          }}
        />

        <ShapeSource id="nodes" shape={nodes || EMPTY_FC}>
          <SymbolLayer
            id="poi-layer"
            filter={[
              "in",
              ["get", "role"],
              ["literal", ["door", "doors", "stairs", "elevator"]],
            ]}
            style={{
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              iconImage: [
                "match",
                ["get", "role"],
                "door",
                "door-icon",
                "doors",
                "doors-icon",
                "stairs",
                "stairs-icon",
                "elevator",
                "elevator-icon",
                "door-icon",
              ],
              iconSize: 0.15,
              iconRotate: ["coalesce", ["get", "angle"], 0],
              iconRotationAlignment: "map",
            }}
          />
        </ShapeSource>

        {/* User dot */}
        <ShapeSource id="user" shape={userPoint}>
          <CircleLayer
            id="user-layer"
            style={{
              circleRadius: 6,
              circleColor: "#2b7fff",
              circleStrokeWidth: 2,
              circleStrokeColor: "#ffffff",
            }}
          />
        </ShapeSource>
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  map: { flex: 1 },
});