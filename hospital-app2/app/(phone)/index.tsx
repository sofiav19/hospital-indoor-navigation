import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { AppPalette } from "../../constants/theme";
import { useNavStore } from "../../store/navStore";
import SearchScreen from "./search";

function IntroScreen() {
  const hideIntro = useNavStore((state) => state.setIntroDismissed);

  return (
    <View style={styles.page}>
      {/* Intro */}
      <View style={styles.hero}>
        <Text style={styles.title}>PRESENTAMOS UNA</Text>
        <Text style={styles.title}>FORMA MAS FACIL</Text>
        <Text style={styles.title}>DE LLEGAR A TU</Text>
        <Text style={styles.title}>CONSULTA</Text>
      </View>

      <Pressable
        style={styles.btn}
        onPress={() => {
          hideIntro(true);
        }}
      >
        <Text style={styles.btnText}>COMENZAR</Text>
      </Pressable>

      {/* Settings entry in case they want to change some accessibility settings */}
      <Pressable onPress={() => router.push("/settings")}>
        <Text style={styles.linkText}>Ajustes</Text>
      </Pressable>
    </View>
  );
}

export default function Home() {
  const introWasClosed = useNavStore((state) => state.navigationUi.hasDismissedIntro);

  // Dont show again if it was already closed
  if (introWasClosed) {
    return <SearchScreen />;
  }
  return <IntroScreen />;
}

const styles = StyleSheet.create({
  page: { 
    flex: 1, 
    paddingHorizontal: 28, 
    paddingVertical: 40, 
    justifyContent: "center", 
    alignItems: "center", 
    backgroundColor: AppPalette.primary },
  hero: { alignItems: "center", gap: 26, marginBottom: 44 },
  title: { 
    fontSize: 31, 
    fontWeight: "400", 
    color: AppPalette.background, 
    textAlign: "center" },
  btn: { 
    backgroundColor: AppPalette.background, 
    paddingHorizontal: 22, 
    paddingVertical: 14, 
    borderRadius: 24, 
    alignItems: "center", 
    minWidth: 248, 
    marginBottom: 18 },
  btnText: { color: AppPalette.primary, fontWeight: "800", fontSize: 28 },
  linkText: { 
    color: AppPalette.background, 
    fontWeight: "600", 
    fontSize: 15, 
    textDecorationLine: "underline" },
});
