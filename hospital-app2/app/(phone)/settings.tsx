import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useNavStore } from "../../store/navStore";
import { useAppAppearance } from "../../constants/theme";

const textSizeOptions = [{ id: "small", label: "Pequeño" }, { id: "medium", label: "Mediano" }, { id: "large", label: "Grande" },] as const;

function getMapUpdatedLabel(updatedAt: string | null) {
  if (!updatedAt) return "No disponible";

  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) 
    return updatedAt;

  const label = new Intl.DateTimeFormat("es-ES", {
    month: "long",
    year: "numeric",
  }).format(date);

  return label.replace(" de ", " ").replace(/^./, (char) => char.toUpperCase());
}

function getMapSourceLabel(source: string | null) {
  if (source === "backend") return "Backend";
  if (source === "local-fallback") return "Copia local";
  return "No disponible";
}

export default function Settings() {
  // Use values from navigation store
  const mapVersion = useNavStore((state) => state.navData.version) || "Marzo 2026, version 1";
  const mapUpdated = useNavStore((state) => state.navData.updatedAt);
  const mapSource = useNavStore((state) => state.navData.source);
  const routePreference = useNavStore((state) => state.navigationUi.prefer);
  const isSoundEnabled = useNavStore((state) => state.navigationUi.soundEnabled);
  const selectedTextSize = useNavStore((state) => state.navigationUi.textSize);
  const isHighContrastEnabled = useNavStore((state) => state.navigationUi.highContrastEnabled);
  const setRoutePreference = useNavStore((state) => state.setNavigationPreference);
  const setSoundEnabled = useNavStore((state) => state.setSoundEnabled);
  const setTextSize = useNavStore((state) => state.setTextSize);
  const setHighContrastEnabled = useNavStore((state) => state.setHighContrastEnabled);
  const { palette, scaleFont, scaleLineHeight } = useAppAppearance();
  const mapUpdatedLabel = getMapUpdatedLabel(mapUpdated);
  const mapSourceLabel = getMapSourceLabel(mapSource);
  return (
    <ScrollView
      style={[styles.page, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text
        style={[styles.title, { color: palette.textSectionTitles,fontSize: scaleFont(22), lineHeight: scaleLineHeight(28),}, ]}
      >
        Ajustes
      </Text>

      {/* Choose accessibility options */}
      <View style={[styles.card, { backgroundColor: palette.surfaceAlt }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary, fontSize: scaleFont(18) }]}>
          Preferencia de ruta
        </Text>
        <Text
          style={[styles.cardText, {color: palette.textPrimary,fontSize: scaleFont(14),lineHeight: scaleLineHeight(20),}]}
        >
          Elija el modo de acceso vertical predeterminado cuando la ruta incluya escaleras o ascensores.
        </Text>
        <View style={styles.row}>
          <SimpleOption
            label="Stairs"
            selected={routePreference === "stairs"}
            palette={palette}
            fontSize={scaleFont(15)}
            onPress={() => setRoutePreference("stairs")}
          />
          <SimpleOption
            label="Elevator"
            selected={routePreference === "elevator"}
            palette={palette}
            fontSize={scaleFont(15)}
            onPress={() => setRoutePreference("elevator")}
          />
        </View>
      </View>

      {/* Sound option */}
      <View style={[styles.card, { backgroundColor: palette.surfaceAlt }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary, fontSize: scaleFont(18) }]}>
          Leer instrucciones
        </Text>
        <Text
          style={[styles.cardText,{color: palette.textPrimary, fontSize: scaleFont(14), lineHeight: scaleLineHeight(20),},]}
        >
          Puede activarse durante la navegacion, pero aqui se define el valor predeterminado.
        </Text>
        <SimpleOption
          label={isSoundEnabled ? "Sound on" : "Sound off"}
          selected={isSoundEnabled}
          palette={palette}
          fontSize={scaleFont(15)}
          onPress={() => setSoundEnabled(!isSoundEnabled)}
        />
      </View>

      {/* Multiple text size options */}
      <View style={[styles.card, { backgroundColor: palette.surfaceAlt }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary, fontSize: scaleFont(18) }]}>
          Tamano del texto
        </Text>
        <Text style={[styles.cardText,{color: palette.textPrimary,fontSize: scaleFont(14),lineHeight: scaleLineHeight(20),},]}
        >
          Ajuste el tamano general del texto para que pueda leer mas facilmente
        </Text>
        <View style={styles.rowWrap}>
          {textSizeOptions.map((option) => (
            <SimpleOption
              key={option.id}
              label={option.label}
              selected={selectedTextSize === option.id}
              palette={palette}
              fontSize={scaleFont(15)}
              onPress={() => setTextSize(option.id)}
            />
          ))}
        </View>
      </View>

      {/* Contrast option */}
      <View style={[styles.card, { backgroundColor: palette.surfaceAlt }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary, fontSize: scaleFont(18) }]}>
          Modo de alto contraste
        </Text>
        <Text
          style={[styles.cardText,{color: palette.textPrimary, fontSize: scaleFont(14), lineHeight: scaleLineHeight(20),},]}
        >
          Aumente el contraste entre texto, bordes y superficies para mejorar la legibilidad.
        </Text>
        <SimpleOption
          label={isHighContrastEnabled ? "Activado" : "Desactivado"}
          selected={isHighContrastEnabled}
          palette={palette}
          fontSize={scaleFont(15)}
          onPress={() => setHighContrastEnabled(!isHighContrastEnabled)}
        />
      </View>

      {/* Feedback entry */}
      <View style={[styles.card, { backgroundColor: palette.surfaceAlt }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary, fontSize: scaleFont(18) }]}>
          Feedback y sugerencias
        </Text>
        <Text
          style={[styles.cardText,{color: palette.textPrimary, fontSize: scaleFont(14), lineHeight: scaleLineHeight(20),},]}
        >
          Ayudanos a mejorar reportando problemas o enviando sugerencias.
        </Text>
        <SimpleOption
          label="Enviar feedback"
          selected={false}
          palette={palette}
          fontSize={scaleFont(15)}
          onPress={() => router.push("/feedback")}
        />
      </View>

      {/* Versioning information */}
      <View style={[styles.card, { backgroundColor: palette.surfaceAlt }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary, fontSize: scaleFont(18) }]}>
          Mapa y version
        </Text>
        <Text
          style={[styles.cardText, {color: palette.textPrimary, fontSize: scaleFont(14), lineHeight: scaleLineHeight(20),},]}
        >
          Version del mapa: {mapVersion}
        </Text>
        <Text
          style={[styles.cardText,{color: palette.textPrimary, fontSize: scaleFont(14), lineHeight: scaleLineHeight(20),},]}
        >
          Ultima actualizacion: {mapUpdatedLabel}
        </Text>
        <Text
          style={[styles.cardText, {color: palette.textPrimary, fontSize: scaleFont(14), lineHeight: scaleLineHeight(20),},]}
        >
          Fuente de datos: {mapSourceLabel}
        </Text>
      </View>
    </ScrollView>
  );
}

function SimpleOption({
  label,
  selected,
  palette,
  fontSize,
  onPress,
}: {
  label: string;
  selected: boolean;
  palette: {
    primary: string;
    background: string;
    lines: string;
    textSectionTitles: string;
  };
  fontSize: number;
  onPress: () => void;
}) {
  return (
    // Reusing toggle button
    <Pressable
      style={[
        styles.option,
        {
          backgroundColor: selected ? palette.primary : palette.background,
          borderColor: selected ? palette.primary : palette.lines,
        },
      ]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.optionText,
          {
            color: selected ? palette.background : palette.textSectionTitles,
            fontSize,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  title: { fontWeight: "700" },
  card: {
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  cardTitle: { fontWeight: "700" },
  cardText: {},
  row: { flexDirection: "row", gap: 10 },
  rowWrap: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  option: {
    alignSelf: "flex-start",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  optionText: { fontWeight: "700" },
});
