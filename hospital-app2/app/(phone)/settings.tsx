import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useNavStore } from "../../store/navStore";
import { useAppAppearance } from "../../constants/theme";
import { NAV_DATA_UPDATED_AT, NAV_DATA_VERSION, TELEMETRY_RETENTION_DAYS } from "../../lib/appMetadata";

const TEXT_SIZE_OPTIONS = [
  { id: "small", label: "Pequeño" },
  { id: "medium", label: "Mediano" },
  { id: "large", label: "Grande" },
] as const;

export default function Settings() {
  const prefer = useNavStore((s) => s.navigationUi.prefer);
  const soundEnabled = useNavStore((s) => s.navigationUi.soundEnabled);
  const textSize = useNavStore((s) => s.navigationUi.textSize);
  const highContrastEnabled = useNavStore((s) => s.navigationUi.highContrastEnabled);
  const setNavigationPreference = useNavStore((s) => s.setNavigationPreference);
  const setSoundEnabled = useNavStore((s) => s.setSoundEnabled);
  const setTextSize = useNavStore((s) => s.setTextSize);
  const setHighContrastEnabled = useNavStore((s) => s.setHighContrastEnabled);
  const { palette, scaleFont, scaleLineHeight } = useAppAppearance();
  const formattedMapTimestamp = new Date(NAV_DATA_UPDATED_AT).toLocaleString("es-ES", {
    hour12: false,
  });

  return (
    <ScrollView
      style={[styles.page, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text
        style={[
          styles.title,
          {
            color: palette.textSectionTitles,
            fontSize: scaleFont(22),
            lineHeight: scaleLineHeight(28),
          },
        ]}
      >
        Ajustes
      </Text>

      <View style={[styles.card, { backgroundColor: palette.surfaceAlt }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary, fontSize: scaleFont(18) }]}>
          Preferencia de ruta
        </Text>
        <Text
          style={[
            styles.cardText,
            {
              color: palette.textPrimary,
              fontSize: scaleFont(14),
              lineHeight: scaleLineHeight(20),
            },
          ]}
        >
          Elija el modo de acceso vertical predeterminado cuando la ruta incluya escaleras o ascensores.
        </Text>
        <View style={styles.row}>
          <SettingChip
            label="Stairs"
            selected={prefer === "stairs"}
            palette={palette}
            fontSize={scaleFont(15)}
            onPress={() => setNavigationPreference("stairs")}
          />
          <SettingChip
            label="Elevator"
            selected={prefer === "elevator"}
            palette={palette}
            fontSize={scaleFont(15)}
            onPress={() => setNavigationPreference("elevator")}
          />
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: palette.surfaceAlt }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary, fontSize: scaleFont(18) }]}>
          Leer instrucciones
        </Text>
        <Text
          style={[
            styles.cardText,
            {
              color: palette.textPrimary,
              fontSize: scaleFont(14),
              lineHeight: scaleLineHeight(20),
            },
          ]}
        >
          Las pistas de audio pueden activarse durante la navegacion, pero aqui se define el valor predeterminado.
        </Text>
        <SettingChip
          label={soundEnabled ? "Sound on" : "Sound off"}
          selected={soundEnabled}
          palette={palette}
          fontSize={scaleFont(15)}
          onPress={() => setSoundEnabled(!soundEnabled)}
        />
      </View>

      <View style={[styles.card, { backgroundColor: palette.surfaceAlt }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary, fontSize: scaleFont(18) }]}>
          Tamano del texto
        </Text>
        <Text
          style={[
            styles.cardText,
            {
              color: palette.textPrimary,
              fontSize: scaleFont(14),
              lineHeight: scaleLineHeight(20),
            },
          ]}
        >
          Ajuste el tamano general del texto para que la interfaz sea mas comoda de leer.
        </Text>
        <View style={styles.rowWrap}>
          {TEXT_SIZE_OPTIONS.map((option) => (
            <SettingChip
              key={option.id}
              label={option.label}
              selected={textSize === option.id}
              palette={palette}
              fontSize={scaleFont(15)}
              onPress={() => setTextSize(option.id)}
            />
          ))}
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: palette.surfaceAlt }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary, fontSize: scaleFont(18) }]}>
          Modo de alto contraste
        </Text>
        <Text
          style={[
            styles.cardText,
            {
              color: palette.textPrimary,
              fontSize: scaleFont(14),
              lineHeight: scaleLineHeight(20),
            },
          ]}
        >
          Aumente el contraste entre texto, bordes y superficies para mejorar la legibilidad.
        </Text>
        <SettingChip
          label={highContrastEnabled ? "Activado" : "Desactivado"}
          selected={highContrastEnabled}
          palette={palette}
          fontSize={scaleFont(15)}
          onPress={() => setHighContrastEnabled(!highContrastEnabled)}
        />
      </View>

      <View style={[styles.card, { backgroundColor: palette.surfaceAlt }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary, fontSize: scaleFont(18) }]}>
          Mapa y version
        </Text>
        <Text
          style={[
            styles.cardText,
            {
              color: palette.textPrimary,
              fontSize: scaleFont(14),
              lineHeight: scaleLineHeight(20),
            },
          ]}
        >
          Version del mapa: {NAV_DATA_VERSION}
        </Text>
        <Text
          style={[
            styles.cardText,
            {
              color: palette.textPrimary,
              fontSize: scaleFont(14),
              lineHeight: scaleLineHeight(20),
            },
          ]}
        >
          Ultima actualizacion: {formattedMapTimestamp}
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: palette.surfaceAlt }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary, fontSize: scaleFont(18) }]}>
          Feedback y sugerencias
        </Text>
        <Text
          style={[
            styles.cardText,
            {
              color: palette.textPrimary,
              fontSize: scaleFont(14),
              lineHeight: scaleLineHeight(20),
            },
          ]}
        >
          Ayudanos a mejorar reportando problemas o enviando sugerencias.
        </Text>
        <SettingChip
          label="Enviar feedback"
          selected={false}
          palette={palette}
          fontSize={scaleFont(15)}
          onPress={() => router.push("/feedback")}
        />
        <Text
          style={[
            styles.cardText,
            {
              color: palette.textPrimary,
              fontSize: scaleFont(13),
              lineHeight: scaleLineHeight(18),
            },
          ]}
        >
          Los eventos anonimos se guardan localmente hasta {TELEMETRY_RETENTION_DAYS} dias.
        </Text>
        <SettingChip
          label="Ver telemetria"
          selected={false}
          palette={palette}
          fontSize={scaleFont(15)}
          onPress={() => router.push("/telemetry")}
        />
      </View>
    </ScrollView>
  );
}

function SettingChip({
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
