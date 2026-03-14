import React, { useEffect, useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useNavStore } from "../../store/navStore";
import IndoorMap from "../../components/map/IndoorMap";
import { computeRoute } from "../../lib/route/routeEngine";

export default function Navigate() {
  const navData = useNavStore((s) => s.navData);
  const start = useNavStore((s) => s.start);
  const destinationId = useNavStore((s) => s.destinationId);
  const route = useNavStore((s) => s.route);
  const setRoute = useNavStore((s) => s.setRoute);

  // userCoord: for now, show at start node coordinate
  const userCoord = useMemo(() => {
    if (!navData.nodes) return null;
    if (start.coords) return start.coords; // later: OptiTrack local coords converted already
    const f = navData.nodes.features?.find((x: any) => x.properties?.id === start.nodeId);
    return f?.geometry?.coordinates || null;
  }, [navData.nodes, start.coords, start.nodeId]);

  useEffect(() => {
    if (!navData.isLoaded || navData.validationErrors.length) return;

    if (!destinationId) {
      setRoute({ ok: false, geojson: null, summary: null, reason: null });
      return;
    }

    const startId = start.nodeId || "n_hospital_entrance";
    const res = computeRoute(navData.nodes, navData.edges, startId, destinationId);

    if (!res.ok) {
      setRoute({ ok: false, geojson: null, summary: null, reason: res.reason });
      return;
    }

    setRoute({ ok: true, geojson: res.routeGeojson, summary: res.summary, reason: null });
  }, [navData, start.nodeId, destinationId, setRoute]);

  if (!navData.isLoaded) return <View style={styles.page}><Text>Loading…</Text></View>;

  if (navData.validationErrors.length) {
    return (
      <View style={styles.page}>
        <Text style={{ fontWeight: "700" }}>Navigation data invalid</Text>
        <Text>{navData.validationErrors.join("\n")}</Text>
      </View>
    );
  }

  if (!destinationId) {
    return (
      <View style={styles.page}>
        <Text style={{ marginBottom: 8 }}>No destination selected.</Text>
        <Pressable style={styles.btn} onPress={() => router.push("/search")}>
          <Text style={styles.btnText}>Select destination</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.topBar}>
        <Text style={styles.topText}>
          {route.ok ? `Distance: ${route.summary?.totalMeters ?? "?"} m` : "Routing..."}
        </Text>
      </View>

      <IndoorMap
        nodes={navData.nodes}
        edges={navData.edges}
        floorplan={navData.floorplan}
        route={route.geojson}
        userCoord={userCoord}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16 },
  btn: { backgroundColor: "#2b7fff", padding: 12, borderRadius: 10, alignItems: "center" },
  btnText: { color: "white", fontWeight: "700" },
  topBar: { padding: 10, borderBottomWidth: 1, borderBottomColor: "#eee" },
  topText: { fontWeight: "700" },
});