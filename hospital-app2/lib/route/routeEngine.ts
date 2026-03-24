// src/lib/routing/routeEngine.ts
import { buildGraph } from "../geojson/buildGraph";
import { dijkstra } from "./dijkstra";

type RoutePreference = "stairs" | "elevator";

function applyPreferenceWeights(graph: any, prefer: RoutePreference) {
  const oppositeRole = prefer === "stairs" ? "elevator" : "stairs";

  return {
    ...graph,
    adjacency: new Map(
      [...graph.adjacency.entries()].map(([nodeId, neighbors]) => [
        nodeId,
        neighbors.map((neighbor: any) => {
          const fromRole = graph.nodesById.get(nodeId)?.role;
          const toRole = graph.nodesById.get(neighbor.to)?.role;
          const touchesPreferred = fromRole === prefer || toRole === prefer;
          const touchesOpposite = fromRole === oppositeRole || toRole === oppositeRole;

          return {
            ...neighbor,
            weight:
              neighbor.weight +
              (touchesOpposite ? 500 : 0) +
              (touchesPreferred ? -0.5 : 0),
          };
        }),
      ])
    ),
  };
}

export function makeRouteLineFeature(edgePath: any[]) {
  const coords: [number, number][] = [];

  edgePath.forEach((edge: any, idx: number) => {
    const seg: [number, number][] = edge.coords || [];
    if (!seg.length) return;
    if (idx === 0) coords.push(...seg);
    else coords.push(...seg.slice(1));
  });

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { label: "route" },
        geometry: { type: "LineString", coordinates: coords },
      },
    ],
  };
}

export function makeRouteNodesFeature(nodes: any, nodePath: string[]) {
  const wanted = new Set(nodePath);

  return {
    type: "FeatureCollection",
    features: (nodes?.features || []).filter((feature: any) =>
      wanted.has(feature?.properties?.id)
    ),
  };
}

function getNodeFeatureById(nodes: any, nodeId: string) {
  return (nodes?.features || []).find((feature: any) => feature?.properties?.id === nodeId) || null;
}

function normalizeDeltaDegrees(delta: number) {
  let value = ((delta + 180) % 360 + 360) % 360 - 180;
  if (value === -180) value = 180;
  return value;
}

function getTurnAngle(prev: [number, number], curr: [number, number], next: [number, number]) {
  const v1x = curr[0] - prev[0];
  const v1y = curr[1] - prev[1];
  const v2x = next[0] - curr[0];
  const v2y = next[1] - curr[1];

  const dot = v1x * v2x + v1y * v2y;
  const det = v1x * v2y - v1y * v2x;
  return (Math.atan2(det, dot) * 180) / Math.PI;
}

export function makeDecisionRouteNodesFeature(nodes: any, nodePath: string[]) {
  if (!Array.isArray(nodePath) || nodePath.length === 0) {
    return { type: "FeatureCollection", features: [] };
  }

  const decisionIds = new Set<string>();

  if (nodePath[0]) decisionIds.add(nodePath[0]);
  if (nodePath[nodePath.length - 1]) decisionIds.add(nodePath[nodePath.length - 1]);

  for (let i = 1; i < nodePath.length - 1; i++) {
    const prev = getNodeFeatureById(nodes, nodePath[i - 1]);
    const curr = getNodeFeatureById(nodes, nodePath[i]);
    const next = getNodeFeatureById(nodes, nodePath[i + 1]);

    const prevCoords = prev?.geometry?.coordinates;
    const currCoords = curr?.geometry?.coordinates;
    const nextCoords = next?.geometry?.coordinates;
    const prevFloor = prev?.properties?.floor;
    const currFloor = curr?.properties?.floor;
    const nextFloor = next?.properties?.floor;

    if (!prevCoords || !currCoords || !nextCoords) continue;

    if (prevFloor !== currFloor || currFloor !== nextFloor) {
      decisionIds.add(nodePath[i]);
      continue;
    }

    const turnDelta = Math.abs(normalizeDeltaDegrees(getTurnAngle(prevCoords, currCoords, nextCoords)));

    if (turnDelta >= 20) {
      decisionIds.add(nodePath[i]);
    }
  }

  return {
    type: "FeatureCollection",
    features: nodePath
      .map((nodeId) => getNodeFeatureById(nodes, nodeId))
      .filter((feature: any) => feature && decisionIds.has(feature.properties?.id)),
  };
}

function getTurnInstruction(turnAngle: number) {
  const abs = Math.abs(turnAngle);

  if (abs < 20) return "Continue straight";
  if (abs < 60) return turnAngle > 0 ? "Bear left" : "Bear right";
  return turnAngle > 0 ? "Turn left" : "Turn right";
}

function makeFloorChangeInstruction(fromNode: any, toNode: any) {
  const fromFloor = fromNode?.properties?.floor ?? null;
  const toFloor = toNode?.properties?.floor ?? null;
  const role = fromNode?.properties?.role || toNode?.properties?.role;
  const goesUp = typeof fromFloor === "number" && typeof toFloor === "number" && toFloor > fromFloor;

  if (role === "elevator") {
    return {
      title: `Take the elevator to Floor ${toFloor ?? "?"}`,
      detail: `Then continue on Floor ${toFloor ?? "?"}.`,
    };
  }

  return {
    title: goesUp ? `Go up the stairs to Floor ${toFloor ?? "?"}` : `Go down the stairs to Floor ${toFloor ?? "?"}`,
    detail: `Then continue on Floor ${toFloor ?? "?"}.`,
  };
}

export function makeRouteSteps(nodes: any, instructionSegments: any[], nodePath: string[]) {
  if (!Array.isArray(nodePath) || nodePath.length === 0) return [];

  const steps: { title: string; detail?: string; nodeId?: string }[] = [];
  const startFeature = getNodeFeatureById(nodes, nodePath[0]);
  const destinationFeature = getNodeFeatureById(nodes, nodePath[nodePath.length - 1]);

  if (startFeature) {
    steps.push({
      title: `Start at ${startFeature.properties?.label || "start"}`,
      detail: "Begin following the highlighted path.",
      nodeId: startFeature.properties?.id,
    });
  }

  for (let i = 0; i < (instructionSegments || []).length; i++) {
    const segment = instructionSegments[i];
    const fromNode = getNodeFeatureById(nodes, segment?.fromNodeId);
    const toNode = getNodeFeatureById(nodes, segment?.toNodeId);
    const fromCoords = fromNode?.geometry?.coordinates;
    const sharedCoords = toNode?.geometry?.coordinates;
    const prevSegment = i > 0 ? instructionSegments[i - 1] : null;
    const prevNode = prevSegment ? getNodeFeatureById(nodes, prevSegment.fromNodeId) : null;
    const prevCoords = prevNode?.geometry?.coordinates;

    if (!fromNode || !toNode) continue;

    if (segment?.floor !== segment?.toFloor) {
      const floorChange = makeFloorChangeInstruction(fromNode, toNode);
      steps.push({
        ...floorChange,
        nodeId: toNode.properties?.id,
      });
      continue;
    }

    let title = "Continue straight";
    if (prevCoords && fromCoords && sharedCoords) {
      const turnAngle = normalizeDeltaDegrees(getTurnAngle(prevCoords, fromCoords, sharedCoords));
      title = getTurnInstruction(turnAngle);
    }

    steps.push({
      title,
      detail: toNode.properties?.label || "Continue to the next point",
      nodeId: toNode.properties?.id,
    });
  }

  if (destinationFeature) {
    steps.push({
      title: `Arrive at ${destinationFeature.properties?.label || "destination"}`,
      detail: "You have reached your destination.",
      nodeId: destinationFeature.properties?.id,
    });
  }

  return steps;
}

function getRouteNode(nodes: any, nodeId: string) {
  return (nodes?.features || []).find((feature: any) => feature?.properties?.id === nodeId) || null;
}

export function makeRouteLineFeatureFromNodes(nodes: any, nodePath: string[]) {
  const coords: [number, number][] = nodePath
    .map((nodeId) =>
      (nodes?.features || []).find((feature: any) => feature?.properties?.id === nodeId)?.geometry
        ?.coordinates
    )
    .filter(Boolean);

  return {
    type: "FeatureCollection",
    features: coords.length >= 2
      ? [
          {
            type: "Feature",
            properties: { label: "route" },
            geometry: { type: "LineString", coordinates: coords },
          },
        ]
      : [],
  };
}

function makeRouteLineFeatureForNodePairs(nodePairs: [string, string][], nodes: any) {
  const features = nodePairs
    .map(([fromId, toId], index) => {
      const fromCoords = getNodeFeatureById(nodes, fromId)?.geometry?.coordinates;
      const toCoords = getNodeFeatureById(nodes, toId)?.geometry?.coordinates;

      if (!fromCoords || !toCoords) return null;

      return {
        type: "Feature",
        properties: { label: `route-segment-${index}` },
        geometry: { type: "LineString", coordinates: [fromCoords, toCoords] },
      };
    })
    .filter(Boolean);

  return {
    type: "FeatureCollection",
    features,
  };
}

function makePreviewRouteFeatures(nodes: any, nodePath: string[], startFloor: number | null) {
  if (!Array.isArray(nodePath) || nodePath.length < 2 || startFloor === null) {
    return {
      currentFloorGeojson: makeRouteLineFeatureFromNodes(nodes, nodePath),
      futureFloorGeojson: { type: "FeatureCollection", features: [] },
    };
  }

  const currentFloorPairs: [string, string][] = [];
  const futureFloorPairs: [string, string][] = [];

  for (let i = 0; i < nodePath.length - 1; i++) {
    const fromNode = getNodeFeatureById(nodes, nodePath[i]);
    const toNode = getNodeFeatureById(nodes, nodePath[i + 1]);
    const fromFloor = fromNode?.properties?.floor ?? null;
    const toFloor = toNode?.properties?.floor ?? null;

    if (fromFloor === startFloor && toFloor === startFloor) {
      currentFloorPairs.push([nodePath[i], nodePath[i + 1]]);
    } else {
      futureFloorPairs.push([nodePath[i], nodePath[i + 1]]);
    }
  }

  return {
    currentFloorGeojson: makeRouteLineFeatureForNodePairs(currentFloorPairs, nodes),
    futureFloorGeojson: makeRouteLineFeatureForNodePairs(futureFloorPairs, nodes),
  };
}

function getPolylineMeters(coords: [number, number][]) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;

  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const start = coords[i - 1];
    const end = coords[i];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    total += Math.sqrt(dx * dx + dy * dy);
  }

  return total;
}

function makeInstructionSegments(nodes: any, nodePath: string[]) {
  const decisionFeatures = makeDecisionRouteNodesFeature(nodes, nodePath).features || [];
  const decisionIds = decisionFeatures.map((feature: any) => feature?.properties?.id).filter(Boolean);

  const segments = [];

  for (let i = 0; i < decisionIds.length - 1; i++) {
    const fromId = decisionIds[i];
    const toId = decisionIds[i + 1];
    const startIndex = nodePath.indexOf(fromId);
    const endIndex = nodePath.indexOf(toId);

    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) continue;

    const sliceIds = nodePath.slice(startIndex, endIndex + 1);
    const coords = sliceIds
      .map((nodeId) => getNodeFeatureById(nodes, nodeId)?.geometry?.coordinates)
      .filter(Boolean);

    if (coords.length < 2) continue;

    const fromNode = getNodeFeatureById(nodes, fromId);
    const toNode = getNodeFeatureById(nodes, toId);

    segments.push({
      fromNodeId: fromId,
      toNodeId: toId,
      nodeIds: sliceIds,
      meters: Math.round(getPolylineMeters(coords)),
      floor: fromNode?.properties?.floor ?? null,
      toFloor: toNode?.properties?.floor ?? null,
      geojson: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              fromNodeId: fromId,
              toNodeId: toId,
            },
            geometry: { type: "LineString", coordinates: coords },
          },
        ],
      },
    });
  }

  return segments;
}

export function computeRoute(
  nodes: any,
  edges: any,
  startId: string,
  destinationId: string,
  options?: { prefer?: RoutePreference }
) {
  const prefer = options?.prefer || "stairs";
  const graph = applyPreferenceWeights(buildGraph(nodes, edges), prefer);
  const result = dijkstra(graph, startId, destinationId);

  if (!result.found) {
    return { ok: false as const, reason: result.reason, routeGeojson: null };
  }

  const totalMeters = Math.round(
    (result.edgePath || []).reduce((sum: number, edge: any) => sum + (edge?.weight || 0), 0)
  );
  const etaMinutes = Math.max(1, Math.round(totalMeters / 75));
  const instructionSegments = makeInstructionSegments(nodes, result.nodePath);
  const steps = makeRouteSteps(nodes, instructionSegments, result.nodePath);
  const startNode = getRouteNode(nodes, startId);
  const destinationNode = getRouteNode(nodes, destinationId);
  const startFloor = startNode?.properties?.floor ?? null;
  const previewRoute = makePreviewRouteFeatures(nodes, result.nodePath, startFloor);

  return {
    ok: true as const,
    routeGeojson: makeRouteLineFeatureFromNodes(nodes, result.nodePath),
    currentFloorGeojson: previewRoute.currentFloorGeojson,
    futureFloorGeojson: previewRoute.futureFloorGeojson,
    routeNodesGeojson: makeDecisionRouteNodesFeature(nodes, result.nodePath),
    summary: {
      totalMeters,
      etaMinutes,
      destinationId,
      startId,
      startFloor,
      destinationFloor: destinationNode?.properties?.floor ?? null,
      nodePath: result.nodePath,
      steps,
      instructionSegments,
      nextInstruction: steps[1] || steps[0] || null,
      prefer,
    },
  };
}
