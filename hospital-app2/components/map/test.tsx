import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function IndoorMap() {
  return (
    <View style={styles.container}>
      <Text>Map preview not available on web yet.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});