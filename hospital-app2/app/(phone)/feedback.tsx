import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, Alert } from "react-native";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppPalette } from "../../constants/theme";
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
    } catch (error) {
      Alert.alert("Error", "No se pudo enviar el feedback. Intenta de nuevo.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.sheetWrap, { marginTop: insets.top + 8, marginBottom: 12 }]}>
        <View style={styles.sheet}>
          <ScrollView
            style={styles.scroll}
            bounces={false}
            alwaysBounceVertical={false}
            overScrollMode="never"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.sheetContent}
          >
            <View style={styles.headerRow}>
              <Text style={styles.title}>Feedback</Text>
              <Pressable style={styles.closeButton} onPress={() => router.back()}>
                <Ionicons name="close" size={38} color={AppPalette.textPrimary} />
              </Pressable>
            </View>

            <Text style={styles.description}>
              Su opinión es anónima y nos ayuda a mejorar la experiencia.
            </Text>

            {/* Valoración General */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Valoración General</Text>
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
              <Text style={styles.sectionTitle}>Tipo de Problema</Text>
              {PROBLEM_TYPES.map((problem) => (
                <Pressable
                  key={problem.id}
                  style={styles.checkboxRow}
                  onPress={() => toggleProblem(problem.id)}
                >
                  <View
                    style={[
                      styles.checkbox,
                      selectedProblems.includes(problem.id) && styles.checkboxActive,
                    ]}
                  >
                    {selectedProblems.includes(problem.id) && (
                      <MaterialCommunityIcons name="check" size={16} color={AppPalette.primary} />
                    )}
                  </View>
                  <Text style={styles.checkboxLabel}>{problem.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* Ubicación */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Ubicación (opcional)</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
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
              <Text style={styles.sectionTitle}>Descripción</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={[styles.input, styles.textArea]}
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
              <Text style={styles.charCount}>{description.length}/500</Text>
            </View>

            {/* Botón Enviar */}
            <Pressable
              style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={isSubmitting}
            >
              <Text style={styles.submitButtonText}>
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
    backgroundColor: AppPalette.primary,
    paddingHorizontal: 8,
  },
  sheetWrap: {
    flex: 1,
    borderTopWidth: 14,
    borderLeftWidth: 14,
    borderRightWidth: 14,
    borderBottomWidth: 0,
    borderColor: AppPalette.primary,
  },
  sheet: {
    flex: 1,
    backgroundColor: "#D8E5EA",
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
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "700",
    color: AppPalette.primary,
    textAlign: "center",
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    color: "rgba(29, 27, 32, 0.75)",
    marginBottom: 20,
    paddingHorizontal: 14,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: AppPalette.textPrimary,
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
    backgroundColor: AppPalette.background,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(29, 27, 32, 0.1)",
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: "rgba(29, 27, 32, 0.3)",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxActive: {
    borderColor: AppPalette.primary,
    backgroundColor: "rgba(63, 155, 176, 0.1)",
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 15,
    color: AppPalette.textPrimary,
    fontWeight: "500",
  },
  inputContainer: {
    position: "relative",
    backgroundColor: AppPalette.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(29, 27, 32, 0.1)",
  },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: AppPalette.textPrimary,
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
    fontSize: 12,
    color: "rgba(29, 27, 32, 0.5)",
    textAlign: "right",
    paddingRight: 12,
    marginTop: 4,
  },
  submitButton: {
    backgroundColor: AppPalette.primary,
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
    fontSize: 16,
    fontWeight: "700",
    color: AppPalette.background,
  },
});
