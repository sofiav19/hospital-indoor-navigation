import React, { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppAppearance } from "../../constants/theme";
import { trackEvent } from "../../lib/monitoring";

const problemOptions = [
  { id: "direction", label: "Direccion incorrecta" },
  { id: "room_not_found", label: "Sala no encontrada" },
  { id: "confusing_route", label: "Ruta confusa" },
  { id: "map_error", label: "Error en el mapa" },
  { id: "other", label: "Otro" },
];

const PENDING_FEEDBACK_STORAGE_KEY = "pending-feedback-events";

type PendingFeedback = {
  rating: number;
  problems: string[];
  location: string | null;
  description: string;
  timestamp: string;
};

export default function Feedback() {
  const insets = useSafeAreaInsets();
  const { palette, scaleFont, scaleLineHeight } = useAppAppearance();
  const [stars, setStars] = useState(0);
  const [pickedProblems, setPickedProblems] = useState<string[]>([]);
  const [place, setPlace] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const toggleProblem = (id: string) => {
    setPickedProblems((old) => {
      if (old.includes(id)) {
        return old.filter((item) => item !== id);
      }
      return [...old, id];
    });
  };

  async function savePendingFeedback(entry: PendingFeedback) {
    const raw = await AsyncStorage.getItem(PENDING_FEEDBACK_STORAGE_KEY);
    const pending = raw ? (JSON.parse(raw) as PendingFeedback[]) : [];
    const nextPending = Array.isArray(pending) ? [...pending, entry] : [entry];
    await AsyncStorage.setItem(PENDING_FEEDBACK_STORAGE_KEY, JSON.stringify(nextPending));
  }

  const sendFeedback = async () => {
    if (stars === 0) {
      Alert.alert("Error", "Por favor selecciona una valoracion.");
      return;
    }

    if (pickedProblems.length === 0) {
      Alert.alert("Error", "Por favor selecciona al menos un tipo de problema.");
      return;
    }

    if (text.trim().length === 0) {
      Alert.alert("Error", "Por favor describe el problema.");
      return;
    }

    const data: PendingFeedback = {
      rating: stars,
      problems: pickedProblems,
      location: place.trim() || null,
      description: text.trim(),
      timestamp: new Date().toISOString(),
    };

    setSending(true);

    try {
      await trackEvent("feedback.submitted", data, { throwOnFailure: true });

      Alert.alert("Enviado con exito", "Gracias por tu feedback. Tu opinion nos ayuda a mejorar.", [
        {
          text: "Ok",
          onPress: () => router.back(),
        },
      ]);
    } catch {
      try {
        await savePendingFeedback(data);
        Alert.alert(
          "Guardado sin conexion",
          "Tu feedback se ha guardado en este dispositivo. Puedes volver a intentarlo mas tarde.",
          [
            {
              text: "Ok",
              onPress: () => router.back(),
            },
          ]
        );
      } catch {
        Alert.alert("Error", "No se pudo enviar ni guardar el feedback. Intenta de nuevo.");
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.primary }]}>
      <View
        style={[
          styles.sheetWrap,
          { marginTop: insets.top + 8, marginBottom: 12, borderColor: palette.primary },
        ]}
      >
        <View style={[styles.sheet, { backgroundColor: palette.surfaceAlt }]}>
          <ScrollView
            style={styles.scroll}
            bounces={false}
            alwaysBounceVertical={false}
            overScrollMode="never"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.sheetContent}
          >
            <View style={styles.headerRow}>
              <Text
                style={[
                  styles.title,
                  {
                    fontSize: scaleFont(24),
                    lineHeight: scaleLineHeight(30),
                    color: palette.primary,
                  },
                ]}
              >
                Feedback
              </Text>
              <Pressable style={styles.closeButton} onPress={() => router.back()}>
                <Ionicons name="close" size={38} color={palette.textPrimary} />
              </Pressable>
            </View>

            <Text
              style={[
                styles.description,
                {
                  fontSize: scaleFont(15),
                  lineHeight: scaleLineHeight(22),
                  color: palette.textPrimary,
                },
              ]}
            >
              Tu opinion es anonima y nos ayuda a mejorar la experiencia.
            </Text>

            <View style={styles.section}>
              <Text
                style={[
                  styles.sectionTitle,
                  { fontSize: scaleFont(16), color: palette.textPrimary },
                ]}
              >
                Valoracion general
              </Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((item) => (
                  <Pressable key={item} onPress={() => setStars(item)} style={styles.starButton}>
                    <MaterialCommunityIcons
                      name={item <= stars ? "star" : "star-outline"}
                      size={40}
                      color={item <= stars ? "#FFB800" : "#D0D0D0"}
                    />
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.section}>
              <Text
                style={[
                  styles.sectionTitle,
                  { fontSize: scaleFont(16), color: palette.textPrimary },
                ]}
              >
                Tipo de problema
              </Text>
              {problemOptions.map((item) => (
                <Pressable
                  key={item.id}
                  style={[
                    styles.checkboxRow,
                    {
                      backgroundColor: palette.background,
                      borderColor: palette.lines,
                    },
                  ]}
                  onPress={() => toggleProblem(item.id)}
                >
                  <View
                    style={[
                      styles.checkbox,
                      { borderColor: "rgba(29, 27, 32, 0.3)" },
                      pickedProblems.includes(item.id) && {
                        borderColor: palette.primary,
                        backgroundColor: palette.lists,
                      },
                    ]}
                  >
                    {pickedProblems.includes(item.id) && (
                      <MaterialCommunityIcons name="check" size={16} color={palette.primary} />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.checkboxLabel,
                      { fontSize: scaleFont(15), color: palette.textPrimary },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.section}>
              <Text
                style={[
                  styles.sectionTitle,
                  { fontSize: scaleFont(16), color: palette.textPrimary },
                ]}
              >
                Ubicacion (opcional)
              </Text>
              <View style={[styles.inputContainer, { backgroundColor: palette.background }]}>
                <TextInput
                  style={[styles.input, { fontSize: scaleFont(15), color: palette.textPrimary }]}
                  placeholder="Sala, planta o area"
                  placeholderTextColor="rgba(29, 27, 32, 0.5)"
                  value={place}
                  onChangeText={setPlace}
                  maxLength={100}
                />
                {place.length > 0 && (
                  <Pressable onPress={() => setPlace("")} style={styles.clearButton}>
                    <MaterialCommunityIcons
                      name="close-circle"
                      size={20}
                      color="rgba(29, 27, 32, 0.5)"
                    />
                  </Pressable>
                )}
              </View>
            </View>

            <View style={styles.section}>
              <Text
                style={[
                  styles.sectionTitle,
                  { fontSize: scaleFont(16), color: palette.textPrimary },
                ]}
              >
                Descripcion
              </Text>
              <View style={[styles.inputContainer, { backgroundColor: palette.background }]}>
                <TextInput
                  style={[
                    styles.input,
                    styles.textArea,
                    { fontSize: scaleFont(15), color: palette.textPrimary },
                  ]}
                  placeholder="Describe el problema que encontraste"
                  placeholderTextColor="rgba(29, 27, 32, 0.5)"
                  value={text}
                  onChangeText={setText}
                  multiline
                  numberOfLines={4}
                  maxLength={500}
                  textAlignVertical="top"
                />
                {text.length > 0 && (
                  <Pressable
                    onPress={() => setText("")}
                    style={[styles.clearButton, styles.clearButtonTextArea]}
                  >
                    <MaterialCommunityIcons
                      name="close-circle"
                      size={20}
                      color="rgba(29, 27, 32, 0.5)"
                    />
                  </Pressable>
                )}
              </View>
              <Text
                style={[
                  styles.charCount,
                  { fontSize: scaleFont(12), color: palette.textPrimary },
                ]}
              >
                {text.length}/500
              </Text>
            </View>

            <Pressable
              style={[
                styles.submitButton,
                { backgroundColor: palette.primary },
                sending && styles.submitButtonDisabled,
              ]}
              onPress={sendFeedback}
              disabled={sending}
            >
              <Text
                style={[
                  styles.submitButtonText,
                  { fontSize: scaleFont(16), color: palette.background },
                ]}
              >
                {sending ? "Enviando..." : "Enviar"}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 8 },
  sheetWrap: {
    flex: 1,
    borderTopWidth: 14,
    borderLeftWidth: 14,
    borderRightWidth: 14,
    borderBottomWidth: 0,
  },
  sheet: {
    flex: 1,
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
    overflow: "hidden",
    paddingTop: 18,
    paddingHorizontal: 14,
  },
  scroll: { flex: 1 },
  sheetContent: { paddingBottom: 60 },
  headerRow: {
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 5,
  },
  closeButton: {
    position: "absolute",
    right: 0,
    top: 0,
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontWeight: "700", textAlign: "center" },
  description: { textAlign: "center", marginBottom: 20, paddingHorizontal: 14 },
  section: { marginBottom: 20 },
  sectionTitle: { fontWeight: "700", marginBottom: 12, paddingHorizontal: 4 },
  starsRow: { flexDirection: "row", justifyContent: "center", gap: 12 },
  starButton: { padding: 4 },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxLabel: { flex: 1, fontWeight: "500" },
  inputContainer: {
    position: "relative",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(29, 27, 32, 0.1)",
  },
  input: { paddingHorizontal: 14, paddingVertical: 12, paddingRight: 40 },
  textArea: { minHeight: 100, paddingTop: 12 },
  clearButton: { position: "absolute", right: 10, top: 12, padding: 4 },
  clearButtonTextArea: { top: 8 },
  charCount: { textAlign: "right", paddingRight: 12, marginTop: 4 },
  submitButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { fontWeight: "700" },
});
