import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppPalette } from "../../constants/theme";

export default function Help() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <View style={[styles.sheetWrap, { marginTop: insets.top + 8 }]}>
        <View style={styles.sheet}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.sheetContent}
          >
            <Pressable style={styles.closeButton} onPress={() => router.back()}>
              <Ionicons name="close" size={38} color={AppPalette.textPrimary} />
            </Pressable>

            <Text style={styles.title}>Ayuda</Text>

            <View style={styles.block}>
              <Text style={styles.blockTitle}>Como usar la app</Text>
              <Text style={styles.blockBody}>Busca tu destino.{"\n"}Pulsa Comenzar para iniciar la ruta.{"\n"}Sigue la instruccion de arriba y la linea en el mapa.</Text>
            </View>

            <View style={styles.block}>
              <Text style={styles.blockTitle}>Si te has perdido</Text>
              <Text style={styles.blockBody}>Si tienes dudas, abre Pasos y comprueba el ultimo giro.{"\n"}Si lo necesitas, pregunta en Informacion.</Text>
            </View>

            <View style={styles.block}>
              <Text style={styles.blockTitle}>Modo AR (camara)</Text>
              <Text style={styles.blockBody}>El modo AR muestra flechas a seguir sobre la camara.</Text>
            </View>

            <View style={styles.suggestWrap}>
              <Pressable style={styles.suggestButton} onPress={() => router.push("/feedback")}>
                <Text style={styles.suggestButtonText}>Sugerencias</Text>
              </Pressable>
              <Text style={styles.suggestSubtext}>Cuentanos tu problema</Text>
            </View>
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
    paddingTop: 18,
    paddingHorizontal: 14,
  },
  sheetContent: {
    paddingBottom: 18,
  },
  closeButton: {
    alignSelf: "flex-end",
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    textAlign: "center",
    fontWeight: "700",
    color: AppPalette.primary,
    marginBottom: 14,
  },
  block: {
    backgroundColor: "#C9DCE4",
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  blockTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
    color: AppPalette.textPrimary,
    marginBottom: 6,
  },
  blockBody: {
    fontSize: 16,
    lineHeight: 24,
    color: "#454650",
  },
  suggestWrap: {
    marginTop: 8,
    alignItems: "center",
  },
  suggestButton: {
    width: "84%",
    borderWidth: 3,
    borderColor: AppPalette.primary,
    borderRadius: 14,
    backgroundColor: "#DCE8ED",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  suggestButtonText: {
    fontSize: 18,
    fontWeight: "600",
    color: AppPalette.textPrimary,
  },
  suggestSubtext: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: "700",
    color: AppPalette.textPrimary,
  },
});