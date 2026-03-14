import React, { useMemo } from "react";
import { View, Text, Pressable, FlatList, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useNavStore } from "../../store/navStore";

export default function Search() {
  const navData = useNavStore((s) => s.navData);
  const setDestinationId = useNavStore((s) => s.setDestinationId);
  const setStartNode = useNavStore((s) => s.setStartNode);

  const entrances = useMemo(() => {
    return (navData.nodes?.features || []).filter((f: any) => f.properties?.role === "doors");
  }, [navData.nodes]);

  const destinations = useMemo(() => {
    return (navData.nodes?.features || []).filter((f: any) => f.properties?.role === "door");
  }, [navData.nodes]);

  if (!navData.isLoaded) return <View style={styles.page}><Text>Loading…</Text></View>;
  if (navData.validationErrors.length) {
    return (
      <View style={styles.page}>
        <Text style={{ fontWeight: "700" }}>Navigation data invalid</Text>
        <Text>{navData.validationErrors.join("\n")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <Text style={styles.title}>Select Start</Text>

      <View style={{ gap: 8 }}>
        {entrances.map((f: any) => (
          <Pressable
            key={f.properties.id}
            style={styles.item}
            onPress={() => setStartNode(f.properties.id)}
          >
            <Text>{f.properties.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.title, { marginTop: 16 }]}>Select Destination</Text>

      <FlatList
        data={destinations}
        keyExtractor={(f: any) => f.properties.id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.item}
            onPress={() => {
              setDestinationId(item.properties.id);
              router.push("/navigate");
            }}
          >
            <Text>{item.properties.label}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16, gap: 10 },
  title: { fontSize: 16, fontWeight: "700" },
  item: { padding: 12, borderWidth: 1, borderColor: "#ddd", borderRadius: 10 },
});