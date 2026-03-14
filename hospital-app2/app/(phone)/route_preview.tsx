import React from "react";
import { View, Text } from "react-native";

export default function RoutePreview() {
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: "700" }}>Route Preview</Text>
      <Text style={{ marginTop: 8 }}>Show summary + Start button later.</Text>
    </View>
  );
}