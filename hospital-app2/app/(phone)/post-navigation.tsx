import React, { useMemo } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppPalette } from "../../constants/theme";
import { useNavStore } from "../../store/navStore";
import { trackEvent } from "../../lib/monitoring";
import { HOSPITAL_DIRECTORY, normalizeSearchValue, type DirectoryCategoryKey } from "../../lib/hospitalDirectory";

function getParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

export default function PostNavigation() {
  const insets = useSafeAreaInsets();
  const navData = useNavStore((state) => state.navData);
  const setStartId = useNavStore((state) => state.setPostNavStartOverrideId);
  const setDestinationId = useNavStore((state) => state.setDestinationId);
  const setNavigationStarted = useNavStore((state) => state.setNavigationStarted);
  const { completedDestinationId } = useLocalSearchParams<{ completedDestinationId?: string | string[] }>();
  const lastId = getParam(completedDestinationId);

  // Name of the last destination
  const lastLabel = useMemo(() => {
    if (!lastId) return "tu destino";
    const nodeLabel =
      navData.nodes?.features?.find((item: any) => item.properties?.id === lastId)?.properties?.label || null;
    if (nodeLabel) return nodeLabel;
    return HOSPITAL_DIRECTORY.find((entry) => entry.destinationNodeId === lastId)?.name || "tu destino";
  }, [navData.nodes, lastId]);

  // Filter destinations available
  const nodeIds = useMemo(() => {
    const list = navData.nodes?.features || [];
    return new Set(list.map((item: any) => item.properties?.id));
  }, [navData.nodes]);

  const entries = useMemo(() => {
    return HOSPITAL_DIRECTORY.filter((entry) => nodeIds.has(entry.destinationNodeId));
  }, [nodeIds]);

  // Select suggestions and remove the last destination
  const quickEntries = useMemo(() => {
    const order: DirectoryCategoryKey[] = ["specialties", "diagnostics", "entrances", "services"];
    const map = new Map<DirectoryCategoryKey, typeof entries>();
    const used = new Set<string>();
    const finalList: typeof entries = [];

    order.forEach((key) => map.set(key, []));
    entries
      .filter((entry) => entry.destinationNodeId !== lastId)
      .forEach((entry) => {
        const list = map.get(entry.category);
        if (list) list.push(entry);
      });

    map.forEach((list) => {
      list.sort((a, b) => {
        if (a.floor !== b.floor) return b.floor - a.floor;
        return a.name.localeCompare(b.name);
      });
    });

    while (finalList.length < 4) {
      let added = false;
      for (const key of order) {
        const list = map.get(key);
        if (!list?.length) continue;
        const item = list.shift();
        if (!item) continue;
        const nameKey = `${item.category}-${normalizeSearchValue(item.name)}`;
        if (used.has(nameKey)) continue;

        used.add(nameKey);
        finalList.push(item);
        added = true;
        if (finalList.length >= 4) break;
      }
      if (!added) break;
    }
    return finalList;
  }, [entries, lastId]);

  // Use last destination as start for the next route
  const prepareStart = () => {
    if (lastId) {
      setStartId(lastId);
    }
    setNavigationStarted(false);
  };

  // go to search screen and prepare the store for a new navigation 
  const goToAnotherRoute = () => {
    prepareStart();
    trackEvent("navigation.new_route_requested", {
      previousDestinationId: lastId,
      source: "completion_screen",
    });
    router.replace("/");
  };

  // prepare the store for a new navigation to a quick destination and go to the navigation screen
  const goToQuickDestination = (id: string) => {
    prepareStart();
    trackEvent("navigation.quick_destination_selected", {
      previousDestinationId: lastId,
      nextDestinationId: id,
      source: "completion_screen",
    });
    setDestinationId(id);
    router.replace("/navigate");
  };

  return (
    <View style={styles.page}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 18 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Logo and name */}
        <View style={styles.logoRow}>
          <View style={styles.logoMark}>
            <Image source={require("../../assets/icons/logo.png")} style={styles.logoImage} resizeMode="contain" />
          </View>
          <View style={styles.logoTextWrap}>
            <Text style={styles.logoTitle}>
              <Text style={styles.logoTopText}>Hospital Universitario </Text>
              <Text style={styles.logoMainText}>Santa Teresa</Text>
            </Text>
          </View>
        </View>
        <View style={styles.titleRow}>
          <Pressable style={styles.backButton} onPress={() => router.replace("/")}>
            <Ionicons name="arrow-back" size={34} color={AppPalette.textPrimary} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.9}>
            Buscas algo más?
          </Text>
        </View>

        <Text style={styles.subtitle}>Último destino: {lastLabel}</Text>
        <Pressable style={styles.fullOption} onPress={goToAnotherRoute}>
          <Text style={styles.fullOptionText}>Otra Ruta</Text>
        </Pressable>
        <Text style={styles.sectionLabel}>Destinos sugeridos</Text>
        <View style={styles.grid}>
          {quickEntries.map((entry) => (
            <Pressable key={entry.id} style={styles.gridOption} onPress={() => goToQuickDestination(entry.destinationNodeId)}>
              <View style={styles.gridOptionInner}>
                <Text style={styles.gridOptionText} numberOfLines={2}>
                  {entry.name}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Tu experiencia</Text>
        <View style={styles.actionRow}>
          <Pressable style={styles.actionButton} onPress={() => router.push("/feedback")}>
            <Text style={styles.actionButtonText}>Valóranos</Text>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={() => router.push("/feedback")}>
            <Text style={styles.actionButtonText}>Sugerencias</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#FFFFFF" },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 14, gap: 10 },
  logoRow: { flexDirection: "row", alignItems: "center", marginTop: 6, marginBottom: 14 },
  logoMark: { width: 60, height: 60, alignItems: "center", justifyContent: "center", marginRight: 14 },
  logoImage: { width: 60, height: 60 },
  logoTextWrap: { flex: 1 },
  logoTitle: { lineHeight: 30 },
  logoTopText: { fontSize: 24, lineHeight: 30, color: AppPalette.textSectionTitles, fontWeight: "600" },
  logoMainText: { fontSize: 32, lineHeight: 30, color: "#175C8E", fontWeight: "800" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  backButton: { width: 52, height: 52, alignItems: "center", justifyContent: "center", marginTop: -4, marginLeft: -8 },
  title: {
    fontSize: 36,
    lineHeight: 40,
    fontWeight: "700",
    color: AppPalette.primary,
    textAlign: "center",
    flex: 1,
    marginRight: 7,
    flexShrink: 1,
  },
  subtitle: { marginTop: -6, textAlign: "center", color: AppPalette.textPrimary, fontSize: 13 },
  fullOption: {
    borderWidth: 3,
    borderColor: AppPalette.primary,
    borderRadius: 14,
    backgroundColor: AppPalette.primary,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 78,
    marginTop: 4,
  },
  fullOptionText: { fontSize: 24, color: AppPalette.background, fontWeight: "700" },
  sectionLabel: { marginTop: 8, marginBottom: 2, fontSize: 14, lineHeight: 18, color: AppPalette.textSectionTitles, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 10, marginTop: 2 },
  gridOption: {
    width: "47%",
    aspectRatio: 1,
    borderWidth: 2,
    borderColor: AppPalette.primary,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  gridOptionInner: { width: "100%", flex: 1, alignItems: "center", justifyContent: "center" },
  gridOptionText: { fontSize: 18, lineHeight: 22, color: AppPalette.textPrimary, textAlign: "center", fontWeight: "600" },
  actionRow: { marginTop: 6, flexDirection: "row", justifyContent: "space-between", gap: 8 },
  actionButton: {
    width: "48.5%",
    borderWidth: 2,
    borderColor: AppPalette.primary,
    borderRadius: 12,
    backgroundColor: AppPalette.surfaceAlt,
    alignItems: "center",
    paddingVertical: 11,
  },
  actionButtonText: { fontSize: 16, lineHeight: 20, color: AppPalette.textPrimary, fontWeight: "600" },
});
