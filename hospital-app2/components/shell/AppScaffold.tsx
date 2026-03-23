import React from "react";
import { StyleSheet, View } from "react-native";
import { usePathname } from "expo-router";
import BottomNav from "./BottomNav";

export default function AppScaffold({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showBottomNav = !pathname.startsWith("/modal");

  return (
    <View style={styles.container}>
      <View style={styles.content}>{children}</View>
      {showBottomNav ? <BottomNav /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
});
