import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useNavStore } from "../../store/navStore";
import { AppPalette } from "../../constants/theme";

export default function Settings() {
  const prefer = useNavStore((s) => s.navigationUi.prefer);
  const soundEnabled = useNavStore((s) => s.navigationUi.soundEnabled);
  const setNavigationPreference = useNavStore((s) => s.setNavigationPreference);
  const setSoundEnabled = useNavStore((s) => s.setSoundEnabled);

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Ajustes</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Preferencia de ruta</Text>
        <Text style={styles.cardText}>Elija el modo de acceso vertical predeterminado para usar cuando las opciones de ruta incluyan escaleras o ascensores.</Text>
        <View style={styles.row}>
          <Pressable
            style={[styles.option, prefer === "stairs" && styles.optionActive]}
            onPress={() => setNavigationPreference("stairs")}
          >
            <Text style={[styles.optionText, prefer === "stairs" && styles.optionTextActive]}>Stairs</Text>
          </Pressable>
          <Pressable
            style={[styles.option, prefer === "elevator" && styles.optionActive]}
            onPress={() => setNavigationPreference("elevator")}
          >
            <Text style={[styles.optionText, prefer === "elevator" && styles.optionTextActive]}>Elevator</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Leer Instrucciones</Text>
        <Text style={styles.cardText}>Las pistas de audio pueden ser activadas desde la navegación, pero esta opción establece el valor predeterminado.</Text>
        <Pressable
          style={[styles.option, soundEnabled && styles.optionActive, { alignSelf: "flex-start" }]}
          onPress={() => setSoundEnabled(!soundEnabled)}
        >
          <Text style={[styles.optionText, soundEnabled && styles.optionTextActive]}>
            {soundEnabled ? "Sound on" : "Sound off"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <View style={styles.feedbackHeader}>
          <View>
            <Text style={styles.cardTitle}>Feedback y Sugerencias</Text>
            <Text style={styles.cardText}>Ayúdanos a mejorar reportando problemas o enviando sugerencias.</Text>
          </View>
          <Ionicons name="chatbubble-outline" size={24} color={AppPalette.primary} />
        </View>
        <Pressable
          style={[styles.option, { alignSelf: "flex-start" }]}
          onPress={() => router.push("/feedback")}
        >
          <Text style={styles.optionText}>Enviar Feedback</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: AppPalette.background },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  title: { fontSize: 22, fontWeight: "700", color: AppPalette.textSectionTitles },
  card: {
    backgroundColor: AppPalette.surfaceAlt,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  cardTitle: { fontSize: 18, fontWeight: "700", color: AppPalette.textPrimary },
  cardText: { fontSize: 14, color: AppPalette.textPrimary, lineHeight: 20 },
  feedbackHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  row: { flexDirection: "row", gap: 10 },
  option: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AppPalette.lines,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: AppPalette.background,
  },
  optionActive: {
    backgroundColor: AppPalette.primary,
    borderColor: AppPalette.primary,
  },
  optionText: { fontWeight: "700", color: AppPalette.textSectionTitles },
  optionTextActive: { color: AppPalette.background },
});
