import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useNavStore } from "../../store/navStore";
import { AppPalette } from "../../constants/theme";

export default function Settings() {
  const navData = useNavStore((s) => s.navData);
  const start = useNavStore((s) => s.start);
  const prefer = useNavStore((s) => s.navigationUi.prefer);
  const soundEnabled = useNavStore((s) => s.navigationUi.soundEnabled);
  const livePosition = useNavStore((s) => s.livePosition);
  const setNavigationPreference = useNavStore((s) => s.setNavigationPreference);
  const setSoundEnabled = useNavStore((s) => s.setSoundEnabled);
  const setLivePositionProvider = useNavStore((s) => s.setLivePositionProvider);
  const nudgeLivePosition = useNavStore((s) => s.nudgeLivePosition);
  const setLiveStepMeters = useNavStore((s) => s.setLiveStepMeters);
  const resetLivePositionToStart = useNavStore((s) => s.resetLivePositionToStart);

  const startFeature = navData.nodes?.features?.find((feature: any) => feature.properties?.id === start.nodeId);

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Settings</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Route preference</Text>
        <Text style={styles.cardText}>Choose the default vertical access mode to use when route options include stairs or elevators.</Text>
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
        <Text style={styles.cardTitle}>Guidance sound</Text>
        <Text style={styles.cardText}>Audio cues can be toggled from navigation too, but this sets the default.</Text>
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
        <Text style={styles.cardTitle}>Tracking provider</Text>
        <Text style={styles.cardText}>
          Keep the app ready for OptiTrack by switching between no live feed, a manual simulator, or OptiTrack.
        </Text>
        <View style={styles.row}>
          <Pressable
            style={[styles.option, livePosition.provider === "none" && styles.optionActive]}
            onPress={() => setLivePositionProvider("none")}
          >
            <Text style={[styles.optionText, livePosition.provider === "none" && styles.optionTextActive]}>None</Text>
          </Pressable>
          <Pressable
            style={[styles.option, livePosition.provider === "simulated" && styles.optionActive]}
            onPress={() => {
              setLivePositionProvider("simulated");
              resetLivePositionToStart();
            }}
          >
            <Text style={[styles.optionText, livePosition.provider === "simulated" && styles.optionTextActive]}>Simulated</Text>
          </Pressable>
          <Pressable
            style={[styles.option, livePosition.provider === "optitrack" && styles.optionActive]}
            onPress={() => setLivePositionProvider("optitrack")}
          >
            <Text style={[styles.optionText, livePosition.provider === "optitrack" && styles.optionTextActive]}>OptiTrack</Text>
          </Pressable>
        </View>
        <Text style={styles.metaText}>
          {`Start anchor: ${startFeature?.properties?.label || "Unknown"} | Current local position: ${livePosition.coords ? `${livePosition.coords[0].toFixed(2)}, ${livePosition.coords[1].toFixed(2)}` : "not set"}`}
        </Text>
      </View>

      {livePosition.provider === "simulated" ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Walk simulator</Text>
          <Text style={styles.cardText}>
            This is the simplest testing pipeline for now: move the live user position in local meters and watch the map respond.
          </Text>
          <View style={styles.row}>
            {[0.5, 1, 2].map((step) => (
              <Pressable
                key={step}
                style={[styles.option, livePosition.stepMeters === step && styles.optionActive]}
                onPress={() => setLiveStepMeters(step)}
              >
                <Text style={[styles.optionText, livePosition.stepMeters === step && styles.optionTextActive]}>
                  {`${step} m`}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.simPad}>
            <Pressable style={styles.simButton} onPress={() => nudgeLivePosition([0, livePosition.stepMeters])}>
              <Text style={styles.simButtonText}>North</Text>
            </Pressable>
            <View style={styles.simRow}>
              <Pressable style={styles.simButton} onPress={() => nudgeLivePosition([-livePosition.stepMeters, 0])}>
                <Text style={styles.simButtonText}>West</Text>
              </Pressable>
              <Pressable style={styles.simButton} onPress={resetLivePositionToStart}>
                <Text style={styles.simButtonText}>Reset</Text>
              </Pressable>
              <Pressable style={styles.simButton} onPress={() => nudgeLivePosition([livePosition.stepMeters, 0])}>
                <Text style={styles.simButtonText}>East</Text>
              </Pressable>
            </View>
            <Pressable style={styles.simButton} onPress={() => nudgeLivePosition([0, -livePosition.stepMeters])}>
              <Text style={styles.simButtonText}>South</Text>
            </Pressable>
          </View>
          <Text style={styles.metaText}>
            Keyboard simulation is possible later on web, but these controls work right now on the phone too.
          </Text>
        </View>
      ) : null}

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
  metaText: { fontSize: 12, color: AppPalette.textSectionTitles, lineHeight: 18 },
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
  simPad: { gap: 10, alignItems: "center" },
  simRow: { flexDirection: "row", gap: 10 },
  simButton: {
    minWidth: 92,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AppPalette.lines,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: AppPalette.background,
  },
  simButtonText: { fontWeight: "700", color: AppPalette.textPrimary },
});
