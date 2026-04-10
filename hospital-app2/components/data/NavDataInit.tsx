import { useEffect } from "react";
import { useNavStore } from "../../store/navStore";
import { loadHospitalDirectory } from "../../lib/hospitalDirectory";
import { loadNavigationData } from "../../lib/geojson/loadNavData";
import { validateNavigationData } from "../../lib/geojson/validateNavData";
import { projectGeoJSONForMap } from "../../lib/coords/localToLngLat";
import { trackEvent } from "../../lib/monitoring";

export default function NavDataInit() {
  const setNavData = useNavStore((s) => s.setNavData);

  useEffect(() => {
    let isMounted = true;

    async function initNavData() {
      try {
        const loadStartedAtMs = Date.now();
        setNavData({ isLoaded: false, validationErrors: [] });

        // Load local directory
        const directoryResult = await loadHospitalDirectory();
        if (!isMounted) return;
        // Load nav data from backend
        const { nodes, edges, floorplan, source, version, updatedAt } = await loadNavigationData();
        if (!isMounted) return;

        trackEvent("data_sources.loaded", {
          navDataSource: source,
          navDataVersion: version,
          navDataUpdatedAt: updatedAt,
          directorySource: directoryResult?.source || "unknown",
          directoryEntries: directoryResult?.entriesCount ?? null,
          directoryCategories: directoryResult?.categoriesCount ?? null,
          directoryError: directoryResult?.error || null,
          loadDurationMs: Date.now() - loadStartedAtMs,
        });

        // Keep raw geometry for routing logic and store projected copies only for rendering.
        const renderNodes = projectGeoJSONForMap(nodes);
        const renderEdges = projectGeoJSONForMap(edges);
        const renderFloorplan = projectGeoJSONForMap(floorplan);
        const report = validateNavigationData({ nodes, edges, floorplan });
        const nextNavData = {
          nodes,
          edges,
          floorplan,
          renderNodes,
          renderEdges,
          renderFloorplan,
          version,
          updatedAt,
          source,
          isLoaded: true,
        };

        if (!report.valid) {
          // Report validation problems
          setNavData({ ...nextNavData, validationErrors: report.errors || [] });
          return;
        }
        setNavData({ ...nextNavData, validationErrors: [] });

      } catch (e: any) {
        if (!isMounted) return;
        setNavData({
          isLoaded: true,
          validationErrors: [`Failed to load nav data: ${e?.message || String(e)}`],
        });
      }
    }

    initNavData();

    return () => {
      isMounted = false;
    };
  }, [setNavData]);

  return null;
}
