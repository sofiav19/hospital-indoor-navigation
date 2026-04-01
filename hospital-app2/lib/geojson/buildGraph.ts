import { COORD_MODE } from "../coords/localToLngLat";

type NodeRec = {
  id: string;
  floor: number;
  role: string | null;
  label: string;
  coords: [number, number];
  properties: any;
};

type EdgeRec = {
  id: string;
  from: string;
  to: string;
  floor: number;
  type: string;
  weight: number;
  coords: [number, number][];
  properties: any;
};

function distanceMetersApprox(a: [number, number], b: [number, number]) {
    if (COORD_MODE === "local") {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  const avgLatRad = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  const metersPerDegLat = 111_320;
  const metersPerDegLon = metersPerDegLat * Math.cos(avgLatRad);
  const dx = Math.abs((a[0] - b[0]) * metersPerDegLon);
  const dy = Math.abs((a[1] - b[1]) * metersPerDegLat);
  return dx + dy;
}

function lineLength(coords: [number, number][]) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += distanceMetersApprox(coords[i - 1], coords[i]);
  return total;
}

export function buildGraph(nodesGeojson: any, edgesGeojson: any) {
  const nodesById = new Map<string, NodeRec>();
  const adjacency = new Map<string, { to: string; weight: number; edge: EdgeRec }[]>();

  // init adjacency lists
  for (const f of nodesGeojson.features || []) {
    const p = f.properties || {};
    const id = p.id;
    if (!id) continue;

    const node: NodeRec = {
      id,
      floor: p.floor,
      role: p.role || null,
      label: p.label || p.name || id,
      coords: f.geometry.coordinates,
      properties: p,
    };

    nodesById.set(id, node);
    adjacency.set(id, [] as any);
  }

  for (const f of edgesGeojson.features || []) {
    const p = f.properties || {};
    const from = p.from;
    const to = p.to;
    if (!from || !to) continue;
    if (!nodesById.has(from) || !nodesById.has(to)) continue;

    const coords: [number, number][] =
      f.geometry?.coordinates || [nodesById.get(from)!.coords, nodesById.get(to)!.coords];

    const edge: EdgeRec = {
      id: p.id || `${from}->${to}`,
      from,
      to,
      floor: p.floor,
      type: p.type || "edge",
      weight: Number.isFinite(p.weight) ? p.weight : lineLength(coords),
      coords,
      properties: p,
    };

    (adjacency.get(from) as any).push({ to, weight: edge.weight, edge });
    (adjacency.get(to) as any).push({ to: from, weight: edge.weight, edge });
  }

  return { nodesById, adjacency };
}
