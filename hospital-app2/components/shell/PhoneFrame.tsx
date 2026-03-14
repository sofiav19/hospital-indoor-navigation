// src/components/shell/PhoneFrame.tsx
import React from "react";
import { SafeAreaView, View, StyleSheet } from "react-native";

export default function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f6f6f6" },
  container: { flex: 1, backgroundColor: "#ffffff" },
});