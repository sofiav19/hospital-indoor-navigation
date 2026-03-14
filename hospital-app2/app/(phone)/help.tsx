import React from "react";
import { View, Text } from "react-native";

export default function Help() {
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: "700" }}>Help</Text>
      <Text style={{ marginTop: 8 }}>FAQ + route to reception later.</Text>
    </View>
  );
}