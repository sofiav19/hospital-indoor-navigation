import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, Alert } from "react-native";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppAppearance } from "../../constants/theme";
import { trackEvent } from "../../lib/telemetry";

const PROBLEM_TYPES = [
  { id: "direction", label: "Dirección Incorrecta" },
  { id: "room_not_found", label: "Sala no encontrada" },
  { id: "confusing_route", label: "Ruta confusa" },
  { id: "map_error", label: "Error en el mapa" },
  { id: "other", label: "Otro" },
];

export default function Feedback() {
  const insets = useSafeAreaInsets();
  const { palette, scaleFont, scaleLineHeight } = useAppAppearance();
  const [rating, setRating] = useState(0);
  const [selectedProblems, setSelectedProblems] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleProblem = (id: string) => {
    setSelectedProblems((prev) => {
      if (prev.includes(id)) {
        return prev.filter((p) => p !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  const handleSubmit = async () => {
    if (rating === 0) {
      Alert.alert("Error", "Por favor selecciona una valoración");
      return;
    }

    if (selectedProblems.length === 0) {
      Alert.alert("Error", "Por favor selecciona al menos un tipo de problema");
      return;
    }

    if (description.trim().length === 0) {
      Alert.alert("Error", "Por favor describe el problema");
      return;
    }

    setIsSubmitting(true);

    try {
      const feedbackData = {
        rating,
        problems: selectedProblems,
        location: location.trim() || null,
        description: description.trim(),
        timestamp: new Date().toISOString(),
      };

      // Aquí puedes enviar los datos a un servidor
      await trackEvent("feedback.submitted", feedbackData);

      Alert.alert("Éxito", "Gracias por tu feedback. Tu opinión nos ayuda a mejorar.", [
        {
          text: "Ok",
          onPress: () => router.back(),
        },
      ]);
    } catch {
      Alert.alert("Error", "No se pudo enviar el feedback. Intenta de nuevo.");
    } finally {
      setIsSubmitting(false);
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
              Su opinión es anónima y nos ayuda a mejorar la experiencia.
            </Text>

            {/* Valoración General */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { fontSize: scaleFont(16), color: palette.textPrimary }]}>
                Valoración General
              </Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Pressable
                    key={star}
                    onPress={() => setRating(star)}
                    style={styles.starButton}
                  >
                    <MaterialCommunityIcons
                      name={star <= rating ? "star" : "star-outline"}
                      size={40}
                      color={star <= rating ? "#FFB800" : "#D0D0D0"}
                    />
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Tipo de Problema */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { fontSize: scaleFont(16), color: palette.textPrimary }]}>
                Tipo de Problema
              </Text>
              {PROBLEM_TYPES.map((problem) => (
                <Pressable
                  key={problem.id}
                  style={[
                    styles.checkboxRow,
                    { backgroundColor: palette.background, borderColor: highContrastBorderColor(palette.lines) },
                  ]}
                  onPress={() => toggleProblem(problem.id)}
                >
                  <View
                    style={[
                      styles.checkbox,
                      { borderColor: highContrastBorderColor("rgba(29, 27, 32, 0.3)") },
                      selectedProblems.includes(problem.id) && {
                        borderColor: palette.primary,
                        backgroundColor: palette.lists,
                      },
                    ]}
                  >
                    {selectedProblems.includes(problem.id) && (
                      <MaterialCommunityIcons name="check" size={16} color={palette.primary} />
                    )}
                  </View>
                  <Text style={[styles.checkboxLabel, { fontSize: scaleFont(15), color: palette.textPrimary }]}>
                    {problem.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Ubicación */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { fontSize: scaleFont(16), color: palette.textPrimary }]}>
                Ubicación (opcional)
              </Text>
              <View style={[styles.inputContainer, { backgroundColor: palette.background }]}>
                <TextInput
                  style={[styles.input, { fontSize: scaleFont(15), color: palette.textPrimary }]}
                  placeholder="Sala, Planta o Área"
                  placeholderTextColor="rgba(29, 27, 32, 0.5)"
                  value={location}
                  onChangeText={setLocation}
                  maxLength={100}
                />
                {location.length > 0 && (
                  <Pressable onPress={() => setLocation("")} style={styles.clearButton}>
                    <MaterialCommunityIcons name="close-circle" size={20} color="rgba(29, 27, 32, 0.5)" />
                  </Pressable>
                )}
              </View>
            </View>

            {/* Descripción */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { fontSize: scaleFont(16), color: palette.textPrimary }]}>
                Descripción
              </Text>
              <View style={[styles.inputContainer, { backgroundColor: palette.background }]}>
                <TextInput
                  style={[styles.input, styles.textArea, { fontSize: scaleFont(15), color: palette.textPrimary }]}
                  placeholder="Describe el problema que encontró"
                  placeholderTextColor="rgba(29, 27, 32, 0.5)"
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  numberOfLines={4}
                  maxLength={500}
                  textAlignVertical="top"
                />
                {description.length > 0 && (
                  <Pressable
                    onPress={() => setDescription("")}
                    style={[styles.clearButton, styles.clearButtonTextArea]}
                  >
                    <MaterialCommunityIcons name="close-circle" size={20} color="rgba(29, 27, 32, 0.5)" />
                  </Pressable>
                )}
              </View>
              <Text style={[styles.charCount, { fontSize: scaleFont(12), color: palette.textPrimary }]}>
                {description.length}/500
              </Text>
            </View>

            {/* Botón Enviar */}
            <Pressable
              style={[
                styles.submitButton,
                { backgroundColor: palette.primary },
                isSubmitting && styles.submitButtonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={isSubmitting}
            >
              <Text style={[styles.submitButtonText, { fontSize: scaleFont(16), color: palette.background }]}>
                {isSubmitting ? "Enviando..." : "Enviar"}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 8,
  },
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
  scroll: {
    flex: 1,
  },
  sheetContent: {
    paddingBottom: 60,
  },
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
  title: {
    fontWeight: "700",
    textAlign: "center",
  },
  description: {
    textAlign: "center",
    marginBottom: 20,
    paddingHorizontal: 14,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontWeight: "700",
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  starsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
  },
  starButton: {
    padding: 4,
  },
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
  checkboxLabel: {
    flex: 1,
    fontWeight: "500",
  },
  inputContainer: {
    position: "relative",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(29, 27, 32, 0.1)",
  },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    paddingRight: 40,
  },
  textArea: {
    minHeight: 100,
    paddingTop: 12,
  },
  clearButton: {
    position: "absolute",
    right: 10,
    top: 12,
    padding: 4,
  },
  clearButtonTextArea: {
    top: 8,
  },
  charCount: {
    textAlign: "right",
    paddingRight: 12,
    marginTop: 4,
  },
  submitButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontWeight: "700",
  },
});

function highContrastBorderColor(color: string) {
  return color;
}
