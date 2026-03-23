import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavStore } from "../../store/navStore";

const NAV_ITEMS = [
  { key: "home", label: "Inicio", route: "/", icon: "home-outline" as const, family: "ion" as const },
  { key: "map", label: "Mapa", route: "/navigate", icon: "map-outline" as const, family: "ion" as const },
  { key: "settings", label: "Ajustes", route: "/settings", icon: "settings-outline" as const, family: "ion" as const },
];

function isItemActive(pathname: string, itemKey: string) {
  if (itemKey === "home") return pathname === "/";
  if (itemKey === "map") return ["/navigate", "/search", "/ar"].includes(pathname);
  if (itemKey === "settings") return pathname === "/settings";
  return false;
}

export default function BottomNav() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const mapViewMode = useNavStore((s) => s.navigationUi.mapViewMode);

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.bar}>
        {NAV_ITEMS.map((item) => {
          const active = isItemActive(pathname, item.key);
          const color = active ? "#56acc4" : "#111111";
          const targetRoute =
            item.key === "map" ? (mapViewMode === "ar" ? "/ar" : "/navigate") : item.route;

          return (
            <Pressable
              key={item.key}
              style={styles.item}
              onPress={() => router.push(targetRoute as any)}
            >
              {item.family === "ion" ? (
                <Ionicons name={item.icon} size={34} color={color} />
              ) : (
                <MaterialCommunityIcons name={item.icon} size={34} color={color} />
              )}
              <Text style={[styles.label, { color }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#d9e0e5",
  },
  bar: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingTop: 10,
  },
  item: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 64,
    gap: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
  },
});
