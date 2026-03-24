export function dijkstra(
  graph: { adjacency: Map<string, { to: string; weight: number; edge: any }[]> },
  startId: string,
  goalId: string
) {
  const { adjacency } = graph;

  if (!adjacency.has(startId) || !adjacency.has(goalId)) {
    return { found: false, reason: "INVALID_START_OR_GOAL" as const };
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, { nodeId: string; edge: any }>();
  const visited = new Set<string>();

  for (const id of adjacency.keys()) dist.set(id, Infinity);
  dist.set(startId, 0);

  while (visited.size < adjacency.size) {
    let current: string | null = null;
    let best = Infinity;

    for (const [id, d] of dist.entries()) {
      if (!visited.has(id) && d < best) {
        best = d;
        current = id;
      }
    }

    if (current === null || best === Infinity) break;
    if (current === goalId) break;

    visited.add(current);

    for (const nb of adjacency.get(current) || []) {
      const currentDist = dist.get(current) ?? Infinity;
      const neighborDist = dist.get(nb.to) ?? Infinity;
      const alt = currentDist + nb.weight;

      if (alt < neighborDist) {
        dist.set(nb.to, alt);
        prev.set(nb.to, { nodeId: current, edge: nb.edge });
      }
    }
  }

  if ((dist.get(goalId) ?? Infinity) === Infinity) {
    return { found: false, reason: "NO_PATH" as const };
  }

  const nodePath: string[] = [];
  const edgePath: any[] = [];
  let cur: string | null = goalId;

  while (cur) {
    nodePath.unshift(cur);
    const step = prev.get(cur);
    if (!step) break;
    edgePath.unshift(step.edge);
    cur = step.nodeId;
  }

  return {
    found: true as const,
    nodePath,
    edgePath,
    totalWeight: dist.get(goalId)!,
  };
}
