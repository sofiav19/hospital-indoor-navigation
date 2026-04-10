// src/lib/routing/routeEngine.ts
import { buildGraph } from "../geojson/buildGraph";
import { dijkstra } from "./dijkstra";

type RoutePreference = "stairs" | "elevator";
type Coord = [number, number];

const OPPOSITE_ROLE_PENALTY = 500;
const PREFERRED_ROLE_BONUS = 0.5;
const DECISION_TURN_THRESHOLD_DEG = 20;
const WALKING_SPEED_M_PER_MIN = 75;

// helpers to define the shape of the graph data
type FeatureCollection<T = any> = {
  type: "FeatureCollection";
  features: T[];
};

type NodeFeature = {
  type?: string;
  properties?: {
    id?: string;
    label?: string;
    type?: string;
    floor?: number | null;
    role?: string;
    angle?: number;
    [key: string]: any;
  };
  geometry?: {
    type?: string;
    coordinates?: Coord;
  };
};

type LineFeature = {
  type: "Feature";
  properties: Record<string, any>;
  geometry: {
    type: "LineString";
    coordinates: Coord[];
  };
};

type AnyFeatureCollection = {
  type?: string;
  features?: NodeFeature[];
};

type GraphNodeMeta = {
  role?: string;
  floor?: number | null;
  label?: string;
  [key: string]: any;
};

type RouteEdge = {
  id?: string;
  from?: string;
  to?: string;
  coords?: Coord[];
  weight?: number;
  baseWeight?: number;
  [key: string]: any;
};

type GraphNeighbor = {
  to: string;
  weight: number;
  baseWeight?: number;
  edge: RouteEdge;
  [key: string]: any;
};

type GraphLike = {
  adjacency: Map<string, GraphNeighbor[]>;
  nodesById: Map<string, GraphNodeMeta>;
  [key: string]: any;
};

type DijkstraResult = {
  found: boolean;
  reason?: string;
  nodePath: string[];
  edgePath: RouteEdge[];
};

type RouteStep = {
  title: string;
  detail?: string;
  nodeId?: string;
};

type InstructionSegment = {
  fromNodeId: string;
  toNodeId: string;
  nodeIds: string[];
  meters: number;
  floor: number | null;
  toFloor: number | null;
  geojson: FeatureCollection<LineFeature>;
};

function makeEmptyGeojson<T = any>(): FeatureCollection<T> {
  return { type: "FeatureCollection", features: [] };
}
// Create one route line feature from a list of coords for map rendering.
function makeLineGeojson(coords: Coord[], properties: Record<string, any> = { label: "route" }): FeatureCollection<LineFeature> {
  if (!Array.isArray(coords) || coords.length < 2) {
    return makeEmptyGeojson();
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties,
        geometry: {
          type: "LineString",
          coordinates: coords,
        },
      },
    ],
  };
}

function buildNodeIndex(nodes: AnyFeatureCollection): Map<string, NodeFeature> {
  const index = new Map<string, NodeFeature>();
  // Route building keeps looking nodes up by id, so index them once here.
  for (const feature of nodes?.features || []) {
    const id = feature?.properties?.id;
    if (id) index.set(id, feature);
  }
  return index;
}

function getNodeById(nodeIndex: Map<string, NodeFeature>, nodeId: string): NodeFeature | null {
  return nodeIndex.get(nodeId) || null;
}

function getNodeCoords(nodeIndex: Map<string, NodeFeature>, nodeId: string): Coord | null {
  return getNodeById(nodeIndex, nodeId)?.geometry?.coordinates || null;
}

function getNodeFloor(nodeIndex: Map<string, NodeFeature>, nodeId: string): number | null {
  return getNodeById(nodeIndex, nodeId)?.properties?.floor ?? null;
}

function normalizeDeltaDegrees(delta: number): number {
  let value = ((delta + 180) % 360 + 360) % 360 - 180;
  if (value === -180) value = 180;
  return value;
}

function calculateTurnAngle(prev: Coord, curr: Coord, next: Coord): number {
  // Compare the direction before and after the current node to estimate the turn.
  const v1x = curr[0] - prev[0];
  const v1y = curr[1] - prev[1];
  const v2x = next[0] - curr[0];
  const v2y = next[1] - curr[1];

  const dot = v1x * v2x + v1y * v2y;
  const det = v1x * v2y - v1y * v2x;

  return (Math.atan2(det, dot) * 180) / Math.PI;
}

function getTurnInstruction(turnAngle: number): string {
  const absTurnAngle = Math.abs(turnAngle);

  if (absTurnAngle < DECISION_TURN_THRESHOLD_DEG) return "Continue straight";
  if (absTurnAngle < 60) return turnAngle > 0 ? "Bear left" : "Bear right";
  return turnAngle > 0 ? "Turn left" : "Turn right";
}

function calculatePathMeters(coords: Coord[]): number {
  if (!Array.isArray(coords) || coords.length < 2) return 0;

  // Calculate meters of small segments
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

function applyPreferenceWeights(graph: GraphLike, prefer: RoutePreference): GraphLike {
  const oppositeRole = prefer === "stairs" ? "elevator" : "stairs";
  const adjustedAdjacency = new Map<string, GraphNeighbor[]>();

  // Bias the graph toward the requested stairs/elevator preference without removing
  // the other option completely. That way routing can still succeed if only the non-preferred transition exists.
  for (const [nodeId, neighbors] of graph.adjacency.entries()) {
    const fromRole = graph.nodesById.get(nodeId)?.role;

    const adjustedNeighbors = neighbors.map((neighbor) => {
      const toRole = graph.nodesById.get(neighbor.to)?.role;
      // If either endpoint touches stairs/elevator, treat that edge as part of that transition type for preference weighting.
      const touchesPreferred = fromRole === prefer || toRole === prefer;
      const touchesOpposite = fromRole === oppositeRole || toRole === oppositeRole;

      // Preserve the original distance so route summaries can still show real meters even after the preference penalty/bonus is applied.
      const baseWeight =
        typeof neighbor.baseWeight === "number"
          ? neighbor.baseWeight
          : typeof neighbor.edge?.baseWeight === "number"
          ? neighbor.edge.baseWeight
          : neighbor.weight;

      // Preferred transitions get a tiny bonus, while the opposite type gets a large penalty
      const weightedWeight =
        baseWeight +
        (touchesOpposite ? OPPOSITE_ROLE_PENALTY : 0) +
        (touchesPreferred ? -PREFERRED_ROLE_BONUS : 0);

      return {
        ...neighbor,
        baseWeight,
        weight: weightedWeight,
        // Mirror the same values onto the edge object for future reference 
        edge: neighbor.edge ? { ...neighbor.edge, baseWeight, weight: weightedWeight } : neighbor.edge,
      };
    });

    adjustedAdjacency.set(nodeId, adjustedNeighbors);
  }
  return {
    ...graph,
    adjacency: adjustedAdjacency,
  };
}

function getDecisionNodesFromPath(nodes: AnyFeatureCollection, nodePath: string[], nodeIndex: Map<string, NodeFeature>): FeatureCollection<NodeFeature> {
  if (!Array.isArray(nodePath) || nodePath.length === 0) {
    return makeEmptyGeojson();
  }

  const decisionIds = new Set<string>();

  if (nodePath[0]) decisionIds.add(nodePath[0]);
  if (nodePath[nodePath.length - 1]) decisionIds.add(nodePath[nodePath.length - 1]);

  // Decision nodes are start, destination, floor changes or a noticeable turn.
  for (let i = 1; i < nodePath.length - 1; i++) {
    const prevCoords = getNodeCoords(nodeIndex, nodePath[i - 1]);
    const currCoords = getNodeCoords(nodeIndex, nodePath[i]);
    const nextCoords = getNodeCoords(nodeIndex, nodePath[i + 1]);

    const prevFloor = getNodeFloor(nodeIndex, nodePath[i - 1]);
    const currFloor = getNodeFloor(nodeIndex, nodePath[i]);
    const nextFloor = getNodeFloor(nodeIndex, nodePath[i + 1]);

    if (!prevCoords || !currCoords || !nextCoords) continue;
    if (prevFloor !== currFloor || currFloor !== nextFloor) {decisionIds.add(nodePath[i]); continue;}

    const turnDelta = Math.abs(normalizeDeltaDegrees(calculateTurnAngle(prevCoords, currCoords, nextCoords)));
    if (turnDelta >= DECISION_TURN_THRESHOLD_DEG) { decisionIds.add(nodePath[i]);}}

  return {
    type: "FeatureCollection",
    features: nodePath
      .map((nodeId) => getNodeById(nodeIndex, nodeId))
      .filter((feature): feature is NodeFeature => {
        const id = feature?.properties?.id;
        return Boolean(feature && id && decisionIds.has(id));
      }),
  };
}

// Special instruction when floor changes
function getFloorChangeStep(fromNode: NodeFeature | null, toNode: NodeFeature | null) {
  const fromFloor = fromNode?.properties?.floor ?? null;
  const toFloor = toNode?.properties?.floor ?? null;
  const role = fromNode?.properties?.role || toNode?.properties?.role;
  const goesUp =
    typeof fromFloor === "number" &&
    typeof toFloor === "number" &&
    toFloor > fromFloor;

  if (role === "elevator") {
    return {
      title: `Take the elevator to Floor ${toFloor ?? "?"}`,
      detail: `Then continue on Floor ${toFloor ?? "?"}.`,
    };
  }

  return {
    title: goesUp
      ? `Go up the stairs to Floor ${toFloor ?? "?"}`
      : `Go down the stairs to Floor ${toFloor ?? "?"}`,
    detail: `Then continue on Floor ${toFloor ?? "?"}.`,
  };
}

// Create first instruaciton
function buildRouteSteps(nodeIndex: Map<string, NodeFeature>,instructionSegments: InstructionSegment[],nodePath: string[]): RouteStep[] {
  if (!Array.isArray(nodePath) || nodePath.length === 0) return [];

  const steps: RouteStep[] = [];
  const startFeature = getNodeById(nodeIndex, nodePath[0]);
  const destinationFeature = getNodeById(nodeIndex, nodePath[nodePath.length - 1]);

  if (startFeature) {
    steps.push({
      title: `Start at ${startFeature.properties?.label || "start"}`,
      detail: "Begin following the highlighted path.",
      nodeId: startFeature.properties?.id,
    });
  }

  // Turn into instructions
  for (let i = 0; i < (instructionSegments || []).length; i++) {
    const segment = instructionSegments[i];
    const fromNode = getNodeById(nodeIndex, segment?.fromNodeId);
    const toNode = getNodeById(nodeIndex, segment?.toNodeId);
    if (!fromNode || !toNode) continue;

    if (segment.floor !== segment.toFloor) {
      const floorChange = getFloorChangeStep(fromNode, toNode);
      steps.push({
        ...floorChange,
        nodeId: toNode.properties?.id,
      });
      continue;
    }

    let title = "Continue straight";

    const prevSegment = i > 0 ? instructionSegments[i - 1] : null;
    const prevCoords = prevSegment ? getNodeCoords(nodeIndex, prevSegment.fromNodeId) : null;
    const fromCoords = fromNode.geometry?.coordinates || null;
    const toCoords = toNode.geometry?.coordinates || null;

    if (prevCoords && fromCoords && toCoords) {
      const turnAngle = normalizeDeltaDegrees(calculateTurnAngle(prevCoords, fromCoords, toCoords));
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

export function makeRouteLineFeatureFromNodes(nodes: AnyFeatureCollection,nodePath: string[]): FeatureCollection<LineFeature> {
  // Make the final route rendering with a polyline from those node coordinates.
  const nodeIndex = buildNodeIndex(nodes);
  const coords: Coord[] = nodePath
    .map((nodeId) => getNodeCoords(nodeIndex, nodeId))
    .filter((coord): coord is Coord => Boolean(coord));

  return makeLineGeojson(coords, { label: "route" });
}

function makeFloorRouteLines(nodePairs: [string, string][],nodeIndex: Map<string, NodeFeature>): FeatureCollection<LineFeature> {
  // Current-floor and future-floor previews are both built from simple node pairs.
  const features = nodePairs
    .map(([fromId, toId], index): LineFeature | null => {
      const fromCoords = getNodeCoords(nodeIndex, fromId);
      const toCoords = getNodeCoords(nodeIndex, toId);
      if (!fromCoords || !toCoords) return null;
      // Make a line feature for this segment of the route.
      return {
        type: "Feature" as const,
        properties: { label: `route-segment-${index}` },
        geometry: {
          type: "LineString" as const,
          coordinates: [fromCoords, toCoords],
        },
      };
    })
    .filter((feature): feature is LineFeature => Boolean(feature));

  return {
    type: "FeatureCollection",
    features,
  };
}

function splitRouteByFloor(
  nodes: AnyFeatureCollection,
  nodePath: string[],
  startFloor: number | null,
  nodeIndex: Map<string, NodeFeature>
) {
  // The map shows the current floor path prominently and keeps the rest of the route
  // available separately for previews and floor switching.
  if (!Array.isArray(nodePath) || nodePath.length < 2 || startFloor === null) {
    return {
      currentFloorGeojson: makeRouteLineFeatureFromNodes(nodes, nodePath),
      futureFloorGeojson: makeEmptyGeojson<LineFeature>(),
    };
  }
  const currentFloorPairs: [string, string][] = [];
  const futureFloorPairs: [string, string][] = [];

  for (let i = 0; i < nodePath.length - 1; i++) {
    const fromFloor = getNodeFloor(nodeIndex, nodePath[i]);
    const toFloor = getNodeFloor(nodeIndex, nodePath[i + 1]);
    // add segments to the floor they touch
    if (fromFloor === startFloor && toFloor === startFloor) {
      currentFloorPairs.push([nodePath[i], nodePath[i + 1]]);
    } else {
      futureFloorPairs.push([nodePath[i], nodePath[i + 1]]);
    }
  }
  return {
    currentFloorGeojson: makeFloorRouteLines(currentFloorPairs, nodeIndex),
    futureFloorGeojson: makeFloorRouteLines(futureFloorPairs, nodeIndex),
  };
}

function buildInstructionSegments(nodes: AnyFeatureCollection, nodePath: string[], nodeIndex: Map<string, NodeFeature>): InstructionSegment[] {
  const decisionFeatures =
    getDecisionNodesFromPath(nodes, nodePath, nodeIndex).features || [];
  const decisionIds = decisionFeatures
    .map((feature) => feature?.properties?.id)
    .filter((id): id is string => Boolean(id));

  const segments: InstructionSegment[] = [];

  // Group the node path into segments between decision points
  for (let i = 0; i < decisionIds.length - 1; i++) {
    const fromId = decisionIds[i];
    const toId = decisionIds[i + 1];
    const startIndex = nodePath.indexOf(fromId);
    const endIndex = nodePath.indexOf(toId);
    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) continue;
    const sliceIds = nodePath.slice(startIndex, endIndex + 1);
    const coords = sliceIds
      .map((nodeId) => getNodeCoords(nodeIndex, nodeId))
      .filter((coord): coord is Coord => Boolean(coord));
    // add segment between decision points
    if (coords.length < 2) continue;
    segments.push({
      fromNodeId: fromId,
      toNodeId: toId,
      nodeIds: sliceIds,
      meters: Math.round(calculatePathMeters(coords)),
      floor: getNodeFloor(nodeIndex, fromId),
      toFloor: getNodeFloor(nodeIndex, toId),
      geojson: makeLineGeojson(coords, {
        fromNodeId: fromId,
        toNodeId: toId,
      }),
    });
  }

  return segments;
}

function getRouteEdgeMeters(edge: RouteEdge): number {
  // Prefer the original edge distance if it exists, otherwise rebuild it from coords.
  if (typeof edge?.baseWeight === "number") return edge.baseWeight;
  if (Array.isArray(edge?.coords) && edge.coords.length >= 2) {
    return calculatePathMeters(edge.coords);
  }
  return typeof edge?.weight === "number" ? edge.weight : 0;
}

export function computeRoute(
  nodes: AnyFeatureCollection,
  edges: any,
  startId: string,
  destinationId: string,
  options?: { prefer?: RoutePreference }
) {
  const prefer = options?.prefer || "stairs";
  const nodeIndex = buildNodeIndex(nodes);

  // Build the graph once, bias it to the requested transition preference, then run
  // shortest-path search on the adjusted weights.
  const baseGraph = buildGraph(nodes, edges) as GraphLike;
  const weightedGraph = applyPreferenceWeights(baseGraph, prefer);
  const result = dijkstra(weightedGraph, startId, destinationId) as DijkstraResult;

  if (!result.found) {
    return { ok: false as const, reason: result.reason, routeGeojson: null };
  }

  // Sum the chosen edges to get the route length shown in the summary.
  const totalMeters = Math.round((result.edgePath || []).reduce((sum, edge) => sum + getRouteEdgeMeters(edge), 0));

  // After the shortest path is found, derive the UI route artifacts
  const etaMinutes = Math.max(1, Math.round(totalMeters / WALKING_SPEED_M_PER_MIN));
  const instructionSegments = buildInstructionSegments(nodes, result.nodePath, nodeIndex);
  const steps = buildRouteSteps(nodeIndex, instructionSegments, result.nodePath);
  const startNode = getNodeById(nodeIndex, startId);
  const destinationNode = getNodeById(nodeIndex, destinationId);
  const startFloor = startNode?.properties?.floor ?? null;
  const floorPreviewRoute = splitRouteByFloor(
    nodes,
    result.nodePath,
    startFloor,
    nodeIndex
  );

  return {
    ok: true as const,
    routeGeojson: makeRouteLineFeatureFromNodes(nodes, result.nodePath),
    currentFloorGeojson: floorPreviewRoute.currentFloorGeojson,
    futureFloorGeojson: floorPreviewRoute.futureFloorGeojson,
    routeNodesGeojson: getDecisionNodesFromPath(
      nodes,
      result.nodePath,
      nodeIndex
    ),
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
