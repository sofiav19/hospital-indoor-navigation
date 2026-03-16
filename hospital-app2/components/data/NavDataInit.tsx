// src/components/NavDataInit.tsx
import React, { useEffect } from "react";
import { useNavStore } from "../../store/navStore";
import { validateNavigationData } from "../../lib/geojson/validateNavData";
import { COORD_MODE, localToLngLat } from "../../lib/coords/localToLngLat";

// assets
import nodesRaw from "../../assets/data/nodes_hospital.json";
import edgesRaw from "../../assets/data/edges_hospital.json";
import floorplanRaw from "../../assets/data/floorplan_c.json";

function mapCoordsGeoJSON(geojson: any) {
  // Converts local XY -> lng/lat if COORD_MODE === "local"
  if (COORD_MODE !== "local") return geojson;

  const clone = JSON.parse(JSON.stringify(geojson));

  for (const f of clone.features || []) {
    const g = f.geometry;
    if (!g) continue;

    if (g.type === "Point") {
      g.coordinates = localToLngLat(g.coordinates);
    } else if (g.type === "LineString") {
      g.coordinates = g.coordinates.map((c: any) => localToLngLat(c));
    } else if (g.type === "Polygon") {
      g.coordinates = g.coordinates.map((ring: any) => ring.map((c: any) => localToLngLat(c)));
    } else if (g.type === "MultiPolygon") {
      g.coordinates = g.coordinates.map((poly: any) =>
        poly.map((ring: any) => ring.map((c: any) => localToLngLat(c)))
      );
    }
  }

  return clone;
}

export default function NavDataInit() {
  const setNavData = useNavStore((s) => s.setNavData);

  useEffect(() => {
    try {
      setNavData({ isLoaded: false, validationErrors: [] });

      // Convert coordinates if needed for rendering
      const nodes = mapCoordsGeoJSON(nodesRaw);
      const edges = mapCoordsGeoJSON(edgesRaw);
      const floorplan = mapCoordsGeoJSON(floorplanRaw);

      const report = validateNavigationData({ nodes, edges });

      if (!report.valid) {
        setNavData({
          nodes,
          edges,
          floorplan,
          isLoaded: true,
          validationErrors: report.errors || [],
        });
        return;
      }

      setNavData({
        nodes,
        edges,
        floorplan,
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