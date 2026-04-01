import React, { useMemo, useState } from "react";
import { View, Text, Pressable, FlatList, StyleSheet, TextInput, Image } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useNavStore } from "../../store/navStore";
import { AppPalette } from "../../constants/theme";
import { computeRoute } from "../../lib/route/routeEngine";
import { trackEvent } from "../../lib/telemetry";
import {
  DIRECTORY_CATEGORIES,
  HOSPITAL_DIRECTORY,
  normalizeSearchValue,
  type DirectoryCategoryKey,
} from "../../lib/hospitalDirectory";

function getBuildingLabel(destinationNodeId: string) {
  if (destinationNodeId.includes("urg")) return "Edificio Urgencias";
  if (destinationNodeId.includes("wr")) return "Edificio Servicios";
  return "Edificio General";
}

function distanceMeters(a: [number, number], b: [number, number]) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

export default function Search() {
  const navData = useNavStore((s) => s.navData);
  const start = useNavStore((s) => s.start);
  const livePosition = useNavStore((s) => s.livePosition);
  const postNavStartOverrideId = useNavStore((s) => s.postNavStartOverrideId);
  const setDestinationId = useNavStore((s) => s.setDestinationId);
  const setStartNode = useNavStore((s) => s.setStartNode);
  const setNavigationStarted = useNavStore((s) => s.setNavigationStarted);
  const recentDestinationIds = useNavStore((s) => s.navigationUi.recentDestinationIds);
  const prefer = useNavStore((s) => s.navigationUi.prefer);
  const [query, setQuery] = useState("");
  const [focusedCategory, setFocusedCategory] = useState<DirectoryCategoryKey | null>(null);

  const availableNodeIds = useMemo(() => {
    const features = navData.nodes?.features || [];
    return new Set(features.map((feature: any) => feature.properties?.id));
  }, [navData.nodes]);

  const availableEntries = useMemo(() => {
    return HOSPITAL_DIRECTORY.filter((entry) => availableNodeIds.has(entry.destinationNodeId));
  }, [availableNodeIds]);

  const availableCategories = useMemo(() => {
    const categoriesWithData = new Set<DirectoryCategoryKey>(["recent"]);
    availableEntries.forEach((entry) => categoriesWithData.add(entry.category));
    return DIRECTORY_CATEGORIES.filter((category) => categoriesWithData.has(category.key));
  }, [availableEntries]);

  const browseCategories = useMemo(() => {
    const preferredOrder: DirectoryCategoryKey[] = ["specialties", "diagnostics", "entrances", "services", "recent"];
    const categoryMap = new Map(availableCategories.map((category) => [category.key, category]));
    return preferredOrder
      .map((key) => categoryMap.get(key))
      .filter((category): category is NonNullable<typeof category> => Boolean(category));
  }, [availableCategories]);

  const recentEntries = useMemo(() => {
    const entriesByDestinationId = new Map(
      availableEntries.map((entry) => [entry.destinationNodeId, entry])
    );

    return recentDestinationIds
      .map((destinationId) => entriesByDestinationId.get(destinationId))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }, [availableEntries, recentDestinationIds]);

  const entranceNodeIds = useMemo(() => {
    return availableEntries
      .filter((entry) => entry.category === "entrances")
      .map((entry) => entry.destinationNodeId);
  }, [availableEntries]);

  const getBestEntranceId = (destinationNodeId: string) => {
    if (!navData.nodes || !navData.edges || !entranceNodeIds.length) return null;

    let bestEntranceId: string | null = null;
    let bestScore = Infinity;
    const evaluations: {
      entranceNodeId: string;
      ok: boolean;
      reason: string | null;
      approachMeters: number | null;
      routeMeters: number | null;
      totalScore: number | null;
    }[] = [];

    for (const entranceNodeId of entranceNodeIds) {
      const entranceFeature =
        navData.nodes.features?.find((feature: any) => feature.properties?.id === entranceNodeId) || null;
      const entranceCoords = entranceFeature?.geometry?.coordinates as [number, number] | undefined;
      const result = computeRoute(navData.nodes, navData.edges, entranceNodeId, destinationNodeId, { prefer });

      const approachMeters =
        livePosition.coords && Array.isArray(entranceCoords)
          ? distanceMeters(livePosition.coords, entranceCoords)
          : 0;

      if (!result.ok) {
        evaluations.push({
          entranceNodeId,
          ok: false,
          reason: result.reason || null,
          approachMeters: Number.isFinite(approachMeters) ? Math.round(approachMeters) : null,
          routeMeters: null,
          totalScore: null,
        });
        continue;
      }

      const routeMeters = result.summary?.totalMeters ?? Infinity;
      const totalScore = approachMeters + routeMeters;
      evaluations.push({
        entranceNodeId,
        ok: true,
        reason: null,
        approachMeters: Number.isFinite(approachMeters) ? Math.round(approachMeters) : null,
        routeMeters: Number.isFinite(routeMeters) ? routeMeters : null,
        totalScore: Number.isFinite(totalScore) ? Math.round(totalScore) : null,
      });

      if (totalScore < bestScore) {
        bestScore = totalScore;
        bestEntranceId = entranceNodeId;
      }
    }

    console.log("[EntrancePicker] evaluated entrances", {
      destinationNodeId,
      prefer,
      livePositionProvider: livePosition.provider,
      liveCoords: livePosition.coords,
      startNodeId: start.nodeId,
      postNavStartOverrideId,
      evaluations,
      chosenEntranceId: bestEntranceId,
      chosenScore: Number.isFinite(bestScore) ? Math.round(bestScore) : null,
      note: "Current implementation compares current-position-to-entrance distance plus entrance-to-destination route length.",
    });

    return bestEntranceId;
  };

  const topDestinations = useMemo(() => {
    const categoryOrder: DirectoryCategoryKey[] = ["specialties", "diagnostics", "entrances", "services"];
    const buckets = new Map<DirectoryCategoryKey, typeof availableEntries>();

    categoryOrder.forEach((key) => buckets.set(key, []));

    availableEntries.forEach((entry) => {
      const bucket = buckets.get(entry.category);
      if (bucket) bucket.push(entry);
    });

    buckets.forEach((bucket) => {
      bucket.sort((a, b) => {
        if (a.floor !== b.floor) return b.floor - a.floor;
        return a.name.localeCompare(b.name);
      });
    });

    const seenByName = new Set<string>();
    const mixed: typeof availableEntries = [];

    while (mixed.length < 10) {
      let addedInRound = false;

      for (const category of categoryOrder) {
        const bucket = buckets.get(category);
        if (!bucket?.length) continue;

        const next = bucket.shift();
        if (!next) continue;

        const dedupeKey = `${next.category}-${normalizeSearchValue(next.name)}`;
        if (seenByName.has(dedupeKey)) continue;

        seenByName.add(dedupeKey);
        mixed.push(next);
        addedInRound = true;

        if (mixed.length >= 10) break;
      }

      if (!addedInRound) break;
    }

    return mixed;
  }, [availableEntries]);

  const selectedCategory = useMemo(() => {
    return availableCategories.find((category) => category.key === (focusedCategory || availableCategories[0]?.key || "specialties"));
  }, [focusedCategory, availableCategories]);

  const visibleEntries = useMemo(() => {
    const normalizedQuery = normalizeSearchValue(query);
    const activeCategoryKey = focusedCategory || browseCategories[0]?.key || "specialties";

    if (!normalizedQuery) {
      if (!focusedCategory) {
        return topDestinations;
      }

      if (activeCategoryKey === "recent") {
        return recentEntries;
      }

      return availableEntries.filter((entry) => entry.category === activeCategoryKey);
    }

    if (activeCategoryKey === "recent") {
      return recentEntries.filter((entry) => {
        const haystack = [entry.name, entry.doctor || "", entry.roomNumber || "", entry.street || "", `planta ${entry.floor}`, ...entry.keywords]
          .map((value) => normalizeSearchValue(value))
          .join(" ");

        return haystack.includes(normalizedQuery);
      });
    }

    return availableEntries.filter((entry) => {
      const inCategory = focusedCategory ? entry.category === focusedCategory : true;
      if (!inCategory) return false;

      const haystack = [entry.name, entry.doctor || "", entry.roomNumber || "", entry.street || "", `planta ${entry.floor}`, ...entry.keywords]
        .map((value) => normalizeSearchValue(value))
        .join(" ");

      return haystack.includes(normalizedQuery);
    });
  }, [availableEntries, browseCategories, focusedCategory, query, recentEntries, topDestinations]);

  if (!navData.isLoaded) return <View style={styles.page}><Text>Loading...</Text></View>;
  if (navData.validationErrors.length) {
    return (
      <View style={styles.page}>
        <Text style={{ fontWeight: "700" }}>Navigation data invalid</Text>
        <Text>{navData.validationErrors.join("\n")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.headerWrap}>
        <View style={styles.brandMark}>
          <Image source={require("../../assets/icons/logo.png")} style={styles.brandLogo} resizeMode="contain" />
        </View>
        <Text style={styles.brandTitle}>
          <Text style={styles.brandTitlePrefix}>Hospital Universitario </Text>
          <Text style={styles.brandTitleAccent}>Santa Teresa</Text>
        </Text>
      </View>

      <View style={styles.searchRow}>
        {focusedCategory ? (
          <Pressable
            onPress={() => {
              setFocusedCategory(null);
              setQuery("");
            }}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={34} color={AppPalette.textPrimary} />
          </Pressable>
        ) : null}
        <View style={styles.searchInputWrap}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={
              focusedCategory
                ? selectedCategory?.searchPlaceholder || "Buscar"
                : "A donde va?"
            }
            placeholderTextColor="rgba(29, 27, 32, 0.65)"
            style={styles.searchInput}
          />
          <Ionicons name="search" size={32} color="rgba(29, 27, 32, 0.75)" />
        </View>
      </View>

      {!focusedCategory ? (
        <>
          <Text style={styles.sectionHeading}>Explorar por tipo</Text>
          <FlatList
            data={browseCategories}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsList}
            contentContainerStyle={styles.chipsListContent}
            keyExtractor={(item) => item.key}
            renderItem={({ item: category }) => (
              <Pressable
                style={styles.chip}
                onPress={() => {
                  setFocusedCategory(category.key);
                  setQuery("");
                }}
              >
                <Text style={styles.chipText}>{category.chipLabel}</Text>
              </Pressable>
            )}
          />
        </>
      ) : null}

      <Text style={styles.sectionHeading}>
        {focusedCategory
          ? selectedCategory?.sectionTitle || "Directorio"
          : "Top Destinations"}
      </Text>
      <FlatList
        data={visibleEntries}
        style={styles.destinationList}
        contentContainerStyle={styles.listContent}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.item}
            onPress={() => {
              setNavigationStarted(false);
              console.log("[EntrancePicker] destination selected", {
                destinationNodeId: item.destinationNodeId,
                livePositionProvider: livePosition.provider,
                liveCoords: livePosition.coords,
                startNodeId: start.nodeId,
                postNavStartOverrideId,
              });
              const bestEntranceId = getBestEntranceId(item.destinationNodeId);
              if (bestEntranceId) {
                console.log("[EntrancePicker] applying entrance start node", {
                  destinationNodeId: item.destinationNodeId,
                  bestEntranceId,
                });
                setStartNode(bestEntranceId);
              }
              trackEvent("navigation.destination_selected", {
                destinationId: item.destinationNodeId,
                destinationName: item.name,
                category: item.category,
                roomNumber: item.roomNumber || null,
                recommendedEntranceId: bestEntranceId,
                livePositionProvider: livePosition.provider,
                liveCoords: livePosition.coords,
              });
              setDestinationId(item.destinationNodeId);
              router.push("/navigate");
            }}
          >
            <Text style={styles.itemText}>{item.name}</Text>
            <Text style={styles.itemMeta}>
              {item.category === "entrances"
                ? `${item.street || getBuildingLabel(item.destinationNodeId)} · Planta ${item.floor}`
                : `${getBuildingLabel(item.destinationNodeId)} · Planta ${item.floor}${item.roomNumber ? ` · Sala ${item.roomNumber}` : ""}${item.doctor ? ` · ${item.doctor}` : ""}`}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {focusedCategory === "recent"
              ? "Todavia no hay destinos recientes."
              : "No hay resultados para esa busqueda."}
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
  brandMark: {
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  brandLogo: {
    width: 68,
    height: 68,
  },
  brandTitle: {
    flex: 1,
    lineHeight: 38,
  },
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
    paddingHorizontal: 14,
  },
  backButton: {
    width: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 28,
    backgroundColor: AppPalette.surfaceAlt,
    paddingHorizontal: 18,
    minHeight: 66,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: AppPalette.textPrimary,
    paddingRight: 14,
  },
  chipsList: { maxHeight: 74, flexGrow: 0 },
  chipsListContent: { gap: 12, paddingHorizontal: 14, paddingRight: 22 },
  chip: {
    borderColor: AppPalette.primary,
    borderWidth: 2,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minHeight: 56,
    justifyContent: "center",
  },
  chipText: {
    fontSize: 20,
    color: AppPalette.textPrimary,
    fontWeight: "500",
  },
  destinationList: { flex: 1 },
  listContent: { paddingBottom: 10 },
  item: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: AppPalette.lines,
    borderRadius: 0,
    backgroundColor: AppPalette.lists,
  },
  itemText: {
    color: AppPalette.textPrimary,
    fontSize: 20,
    fontWeight: "500",
    lineHeight: 26,
  },
  itemMeta: {
    color: "rgba(29, 27, 32, 0.82)",
    fontSize: 16,
    lineHeight: 22,
    marginTop: 4,
  },
  emptyText: {
    color: "rgba(29, 27, 32, 0.65)",
    paddingHorizontal: 22,
    paddingTop: 12,
    fontSize: 14,
  },
});
