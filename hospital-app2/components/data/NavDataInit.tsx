// src/components/NavDataInit.tsx
import { useEffect } from "react";
import { useNavStore } from "../../store/navStore";
import { validateNavigationData } from "../../lib/geojson/validateNavData";
import { projectGeoJSONForMap } from "../../lib/coords/localToLngLat";

// assets
import nodesRaw from "../../assets/data/nodes_hospital.json";
import edgesRaw from "../../assets/data/edges_hospital.json";
import floorplanRaw from "../../assets/data/floorplan_c.json";

export default function NavDataInit() {
  const setNavData = useNavStore((s) => s.setNavData);

  useEffect(() => {
    try {
      setNavData({ isLoaded: false, validationErrors: [] });

      const nodes = JSON.parse(JSON.stringify(nodesRaw));
      const edges = JSON.parse(JSON.stringify(edgesRaw));
      const floorplan = JSON.parse(JSON.stringify(floorplanRaw));

      const renderNodes = projectGeoJSONForMap(nodes);
      const renderEdges = projectGeoJSONForMap(edges);
      const renderFloorplan = projectGeoJSONForMap(floorplan);

      const report = validateNavigationData({ nodes, edges });

      if (!report.valid) {
        setNavData({
          nodes,
          edges,
          floorplan,
          renderNodes,
          renderEdges,
          renderFloorplan,
          isLoaded: true,
          validationErrors: report.errors || [],
        });
        return;
      }

      setNavData({
        nodes,
        edges,
        floorplan,
        renderNodes,
        renderEdges,
        renderFloorplan,
        isLoaded: true,
        validationErrors: [],
      });
    } catch (e: any) {
      setNavData({
        isLoaded: true,
        validationErrors: [`Failed to load nav data: ${e?.message || String(e)}`],
      });
    }
  }, [setNavData]);

  return null;
}
