import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";

export default function Home() {
  return (
    <View style={styles.page}>
      <Text style={styles.title}>Hospital Wayfinding</Text>
      <Text style={styles.subtitle}>Start navigation in under a minute.</Text>

      <Pressable style={styles.btn} onPress={() => router.push("/search")}>
        <Text style={styles.btnText}>Start</Text>
      </Pressable>

      <Pressable style={styles.linkBtn} onPress={() => router.push("/settings")}>
        <Text style={styles.linkText}>Settings</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 14, color: "#555" },
  btn: { backgroundColor: "#2b7fff", padding: 14, borderRadius: 10, alignItems: "center" },
  btnText: { color: "white", fontWeight: "700" },
  linkBtn: { padding: 10, alignItems: "center" },
  linkText: { color: "#2b7fff", fontWeight: "600" },
});