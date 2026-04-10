import React, { useMemo, useRef, useState } from "react";
import { View, Text, Pressable, FlatList, StyleSheet, TextInput, Image } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useNavStore } from "../../store/navStore";
import { AppPalette, useAppAppearance } from "../../constants/theme";
import { computeRoute } from "../../lib/route/routeEngine";
import { distanceMeters } from "../../lib/route/routeHelpers";
import { trackEvent } from "../../lib/monitoring";
import { DIRECTORY_CATEGORIES, HOSPITAL_DIRECTORY, normalizeSearchValue, type DirectoryCategoryKey} from "../../lib/hospitalDirectory";

// Metadata information for each entry
function getEntrySubtitle(item: any) {
  if (item.category === "entrances") {
    return `${item.street || "Entrada"} · Planta ${item.floor}`;}
  let info = `Planta ${item.floor}`;
  if (item.roomNumber) info += ` · Sala ${item.roomNumber}`;
  if (item.doctor) info += ` · ${item.doctor}`;
  return info;
}

// Search across all entry fields to find matches
function getEntrySearchText(entry: any) {
  return [entry.name, entry.doctor || "", entry.roomNumber || "", entry.street || "", `planta ${entry.floor}`, ...entry.keywords]
    .map((value) => normalizeSearchValue(value))
    .join(" ");
}

export default function Search() {
  const { palette } = useAppAppearance();
  // Take these values from the navigation store
  const navData = useNavStore((state) => state.navData);
  const livePosition = useNavStore((state) => state.livePosition);
  const setDestinationId = useNavStore((state) => state.setDestinationId);
  const setStartNode = useNavStore((state) => state.setStartNode);
  const setNavigationStarted = useNavStore((state) => state.setNavigationStarted);
  const recentIds = useNavStore((state) => state.navigationUi.recentDestinationIds);
  const routePreference = useNavStore((state) => state.navigationUi.prefer);
  const [query, setQuery] = useState("");
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<DirectoryCategoryKey | null>(null);
  const selectionStartedAt = useRef(Date.now());

  // Show only destinations that exist in the current map
  const availableNodeIds = useMemo(() => {
    const list = navData.nodes?.features || [];
    return new Set(list.map((item: any) => item.properties?.id));
  }, [navData.nodes]);

  const entries = useMemo(() => HOSPITAL_DIRECTORY.filter((entry) => availableNodeIds.has(entry.destinationNodeId)), [availableNodeIds]);

  // Filters categories to the ones that have destinations right now
  const categories = useMemo(() => {
    const keys = new Set<DirectoryCategoryKey>(["recent"]);
    entries.forEach((entry) => keys.add(entry.category));
    return DIRECTORY_CATEGORIES.filter((category) => keys.has(category.key));
  }, [entries]);

  // Order categories
  const browseCategories = useMemo(() => {
    const order: DirectoryCategoryKey[] = ["specialties", "diagnostics", "entrances", "services", "recent"];
    const map = new Map(categories.map((category) => [category.key, category]));

    return order
      .map((key) => map.get(key))
      .filter((category): category is NonNullable<typeof category> => Boolean(category));
  }, [categories]);

  // Show recent destinations by recency, but only if they are still available
  const recentEntries = useMemo(() => {
    const map = new Map(entries.map((entry) => [entry.destinationNodeId, entry]));
    return recentIds
      .map((id) => map.get(id))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }, [entries, recentIds]);

  // Save entrances to later decide which is the best one to start the route from
  const entranceIds = useMemo(() => {
    return entries
      .filter((entry) => entry.category === "entrances")
      .map((entry) => entry.destinationNodeId);
  }, [entries]);

  // Make top entries list
  const topEntries = useMemo(() => {
    const order: DirectoryCategoryKey[] = ["specialties", "diagnostics", "entrances", "services"];
    const map = new Map<DirectoryCategoryKey, typeof entries>();
    const used = new Set<string>();
    const finalList: typeof entries = [];

    order.forEach((key) => map.set(key, []));

    entries.forEach((entry) => {
      const list = map.get(entry.category);
      if (list) list.push(entry);
    });
    // after making the groups of each category, sort them by floor and name
    map.forEach((list) => {
      list.sort((a, b) => {
        if (a.floor !== b.floor) return b.floor - a.floor;
        return a.name.localeCompare(b.name);
      });
    });

    while (finalList.length < 10) {
      let added = false;
      for (const key of order) {
        const list = map.get(key);
        if (!list?.length) continue;
        const item = list.shift();
        if (!item) continue;
        // avoid duplicates
        const nameKey = `${item.category}-${normalizeSearchValue(item.name)}`;
        if (used.has(nameKey)) continue;
        used.add(nameKey);
        finalList.push(item);
        added = true;
        if (finalList.length >= 10) break;
      }
      if (!added) break;
    }
    return finalList;
  }, [entries]);

  // Selected category for title and placeholder
  const selectedCategory = useMemo(() => {
    return categories.find((category) => category.key === (selectedCategoryKey || categories[0]?.key || "specialties"));
  }, [selectedCategoryKey, categories]);

  // Final list depending on category or search query
  const shownEntries = useMemo(() => {
    const text = normalizeSearchValue(query);
    const currentCategory = selectedCategoryKey || browseCategories[0]?.key || "specialties";
    if (!text) {
      if (!selectedCategoryKey) return topEntries;
      if (currentCategory === "recent") return recentEntries;
      return entries.filter((entry) => entry.category === currentCategory);}

    if (currentCategory === "recent") {
      return recentEntries.filter((entry) => getEntrySearchText(entry).includes(text));}

    return entries.filter((entry) => {
      const sameCat = selectedCategoryKey ? entry.category === selectedCategoryKey : true;
      if (!sameCat) return false;
      return getEntrySearchText(entry).includes(text);
    });
  }, [entries, browseCategories, selectedCategoryKey, query, recentEntries, topEntries]);

  // Go back to the default state when removing a category
  const resetSearch = () => {
    setSelectedCategoryKey(null);
    setQuery("");
    selectionStartedAt.current = Date.now();
  };

  // Choose the best entrance to start the route from
  const pickBestEntrance = (destinationId: string) => {
    if (!navData.nodes || !navData.edges || !entranceIds.length) return null;
    let bestId: string | null = null;
    let bestScore = Infinity;

    for (const entranceId of entranceIds) {
      const entranceData = navData.nodes.features?.find((item: any) => item.properties?.id === entranceId) || null;
      const entranceCoords = entranceData?.geometry?.coordinates as [number, number] | undefined;
      const route = computeRoute(navData.nodes, navData.edges, entranceId, destinationId, { prefer: routePreference });
      const outMeters = livePosition.coords && Array.isArray(entranceCoords) ? distanceMeters(livePosition.coords, entranceCoords) : 0;
      const routeMeters = route.summary?.totalMeters ?? Infinity;
      const total = outMeters + routeMeters;
      if (total < bestScore) {
        bestScore = total;
        bestId = entranceId;
      }
    }
    return bestId;
  };

  // Select destination for navigation and track when a destination is selected
  const chooseDestination = (item: any) => {
    setNavigationStarted(false);
    const bestId = pickBestEntrance(item.destinationNodeId);

    if (bestId) { setStartNode(bestId, "auto-entrance", null);}

    trackEvent("navigation.destination_selected", {
      destinationId: item.destinationNodeId,
      destinationName: item.name,
      category: item.category,
      roomNumber: item.roomNumber || null,
      recommendedEntranceId: bestId,
      livePositionProvider: livePosition.provider,
      selectionDurationSeconds: Math.round((Date.now() - selectionStartedAt.current) / 1000),
      queryText: query.trim() || null,
      focusedCategory: selectedCategoryKey || null,
      resultsCount: shownEntries.length,
    });

    selectionStartedAt.current = Date.now();
    setDestinationId(item.destinationNodeId);
    router.push("/navigate");
  };

  if (!navData.isLoaded) return <View style={[styles.page, { backgroundColor: palette.background }]}><Text style={{ color: palette.textPrimary }}>Loading...</Text></View>;

  if (navData.validationErrors.length) {
    return (
      <View style={[styles.page, { backgroundColor: palette.background }]}>
        <Text style={{ fontWeight: "700", color: palette.textPrimary }}>Navigation data invalid</Text>
        <Text style={{ color: palette.textPrimary }}>{navData.validationErrors.join("\n")}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.page, { backgroundColor: palette.background }]}>
      {/* Heading with name and Logo */}
      <View style={styles.headerWrap}>
        <View style={styles.brandMark}>
          <Image source={require("../../assets/icons/logo.png")} style={styles.brandLogo} resizeMode="contain" />
        </View>
        <Text style={styles.brandTitle}>
          <Text style={styles.brandTitlePrefix}>Hospital Universitario </Text>
          <Text style={styles.brandTitleAccent}>Santa Teresa</Text>
        </Text>
      </View>

      {/* Search bar and back button if already in a category */}
      <View style={styles.searchRow}>
        {selectedCategoryKey ? (
          <Pressable onPress={() => resetSearch()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={34} color={palette.textPrimary} />
          </Pressable>
        ) : null}

        <View style={[styles.searchInputWrap, { backgroundColor: palette.surfaceAlt }]}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={selectedCategoryKey ? selectedCategory?.searchPlaceholder || "Buscar" : "A donde va?"}
            placeholderTextColor="rgba(29, 27, 32, 0.65)"
            style={[styles.searchInput, { color: palette.textPrimary }]}
          />
          <Ionicons name="search" size={32} color="rgba(29, 27, 32, 0.75)" />
        </View>
      </View>

      {!selectedCategoryKey ? (
        <>
          {/* Buttons for each category */}
          <Text style={[styles.sectionHeading, { color: palette.textSectionTitles }]}>Explorar por tipo</Text>
          <FlatList
            data={browseCategories}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsList}
            contentContainerStyle={styles.chipsListContent}
            keyExtractor={(item) => item.key}
            renderItem={({ item: category }) => (
              <Pressable
                style={[styles.chip, { borderColor: palette.primary }]}
                onPress={() => {
                  setSelectedCategoryKey(category.key);
                  setQuery("");
                  selectionStartedAt.current = Date.now();
                }}
              >
                <Text style={[styles.chipText, { color: palette.textPrimary }]}>{category.chipLabel}</Text>
              </Pressable>
            )}
          />
        </>
      ) : null}

      <Text style={[styles.sectionHeading, { color: palette.textSectionTitles }]}>
        {selectedCategoryKey ? selectedCategory?.sectionTitle || "Directorio" : "Top Destinations"}
      </Text>

      {/* Search results */}
      <FlatList
        data={shownEntries}
        style={styles.destinationList}
        contentContainerStyle={styles.listContent}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable style={[styles.item, { borderColor: palette.lines, backgroundColor: palette.lists }]} onPress={() => chooseDestination(item)}>
            <Text style={[styles.itemText, { color: palette.textPrimary }]}>{item.name}</Text>
            <Text style={[styles.itemMeta, { color: palette.textPrimary }]}>
              {getEntrySubtitle(item)}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: palette.textPrimary }]}>
            {selectedCategoryKey === "recent" ? "Todavia no hay destinos recientes." : "No hay resultados para esa busqueda."}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: AppPalette.background, paddingTop: 14 },
  headerWrap: {
    paddingHorizontal: 22,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  brandMark: { width: 54, height: 54, alignItems: "center", justifyContent: "center" },
  brandLogo: { width: 68, height: 68 },
  brandTitle: { flex: 1, lineHeight: 38 },
  brandTitlePrefix: {
    fontSize: 24,
    fontWeight: "600",
    color: AppPalette.textSectionTitles,
    lineHeight: 38,
  },
  brandTitleAccent: {
    fontSize: 32,
    fontWeight: "800",
    color: "#175C8E",
    lineHeight: 38,
  },
  sectionHeading: {
    fontSize: 18,
    fontWeight: "700",
    color: AppPalette.textSectionTitles,
    marginBottom: 10,
    marginTop: 10,
    paddingHorizontal: 22,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
    marginTop: 4,
    paddingHorizontal: 14,},
  backButton: { width: 54, alignItems: "center", justifyContent: "center" },
  searchInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 28,
    backgroundColor: AppPalette.surfaceAlt,
    paddingHorizontal: 18,
    minHeight: 66 },
  searchInput: { flex: 1, fontSize: 14, color: AppPalette.textPrimary, paddingRight: 14 },
  chipsList: { maxHeight: 74, flexGrow: 0 },
  chipsListContent: { gap: 12, paddingHorizontal: 14, paddingRight: 22 },
  chip: {
    borderColor: AppPalette.primary,
    borderWidth: 2,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minHeight: 56,
    justifyContent: "center" },
  chipText: { fontSize: 20, color: AppPalette.textPrimary, fontWeight: "500" },
  destinationList: { flex: 1 },
  listContent: { paddingBottom: 10 },
  item: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: AppPalette.lines,
    borderRadius: 0,
    backgroundColor: AppPalette.lists },
  itemText: { color: AppPalette.textPrimary, fontSize: 20, fontWeight: "500", lineHeight: 26 },
  itemMeta: { color: "rgba(29, 27, 32, 0.82)", fontSize: 16, lineHeight: 22, marginTop: 4 },
  emptyText: { color: "rgba(29, 27, 32, 0.65)", paddingHorizontal: 22, paddingTop: 12, fontSize: 14 },
});
