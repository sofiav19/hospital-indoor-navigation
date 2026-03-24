export function validateNavigationData({ nodes, edges }: { nodes: any; edges: any }) {
  const errors: string[] = [];

  if (!nodes?.features || !Array.isArray(nodes.features)) {
    errors.push("Nodes GeoJSON is missing the 'features' array");
  }
  if (!edges?.features || !Array.isArray(edges.features)) {
    errors.push("Edges GeoJSON is missing the 'features' array");
  }

  if (errors.length) return { valid: false, errors };

  const nodeIdSet = new Set<string>();
  const edgeIdSet = new Set<string>();
  const nodesById = new Map<string, any>();
  const adjacency = new Map<string, string[]>();

  let hasDoorsEntrance = false;
  let hasStairsPOI = false;
  let hasElevatorPOI = false;

  const entranceIds: string[] = [];
  const stairsIds: string[] = [];
  const elevatorIds: string[] = [];

  for (const f of nodes.features) {
    const p = f.properties || {};

    if (!p.id) {
      errors.push("Node missing properties.id");
    } else {
      if (nodeIdSet.has(p.id)) errors.push(`Duplicate node id: ${p.id}`);
      nodeIdSet.add(p.id);
      nodesById.set(p.id, f);
      if (!adjacency.has(p.id)) adjacency.set(p.id, []);
    }

    if (!p.label) errors.push(`Node ${p.id || "?"} missing label`);
    if (!p.type) errors.push(`Node ${p.id || "?"} missing type`);
    if (!p.role) errors.push(`Node ${p.id || "?"} missing role`);
    if (typeof p.floor === "undefined") errors.push(`Node ${p.id || "?"} missing floor`);
    if (!f.geometry || f.geometry.type !== "Point") errors.push(`Node ${p.id || "?"} missing Point geometry`);
    if (!f.geometry?.coordinates) errors.push(`Node ${p.id || "?"} missing coordinates`);

    // Only require angle where you actually need it visually
    if (["door", "elevator"].includes(p.role)) {
      if (typeof p.angle === "undefined") errors.push(`Node ${p.id || "?"} missing angle (even if 0)`);
    }

    if (p.role === "doors") {
      hasDoorsEntrance = true;
      if (p.id) entranceIds.push(p.id);
    }
    if (p.role === "stairs") {
      hasStairsPOI = true;
      if (p.id) stairsIds.push(p.id);
    }
    if (p.role === "elevator") {
      hasElevatorPOI = true;
      if (p.id) elevatorIds.push(p.id);
    }
  }

  for (const f of edges.features) {
    const p = f.properties || {};
    const edgeId = p.id || "?";

    if (!p.id) errors.push("Edge missing properties.id");
    else {
      if (edgeIdSet.has(p.id)) errors.push(`Duplicate edge id: ${p.id}`);
      edgeIdSet.add(p.id);
    }

    if (!p.label) errors.push(`Edge ${edgeId} missing label`);
    if (!p.type) errors.push(`Edge ${edgeId} missing type`);
    if (typeof p.floor === "undefined") errors.push(`Edge ${edgeId} missing floor`);
    if (!p.from) errors.push(`Edge ${edgeId} missing from property`);
    if (!p.to) errors.push(`Edge ${edgeId} missing to property`);

    // property must exist even if null
    if (!Object.prototype.hasOwnProperty.call(p, "door_id")) {
      errors.push(`Edge ${edgeId} missing door_id property (even if null)`);
    }

    if (!f.geometry || f.geometry.type !== "LineString") errors.push(`Edge ${edgeId} missing LineString geometry`);
    if (!f.geometry?.coordinates) errors.push(`Edge ${edgeId} missing coordinates`);

    if (p.from && !nodesById.has(p.from)) errors.push(`Edge ${edgeId} references unknown from node: ${p.from}`);
    if (p.to && !nodesById.has(p.to)) errors.push(`Edge ${edgeId} references unknown to node: ${p.to}`);

    if (p.from && p.to && nodesById.has(p.from) && nodesById.has(p.to)) {
      adjacency.get(p.from)!.push(p.to);
      adjacency.get(p.to)!.push(p.from);
    }
  }

  if (!hasDoorsEntrance) errors.push(`No entrance node found with role "doors"`);
  if (!hasStairsPOI) errors.push(`No stairs POI found (role "stairs")`);
  if (!hasElevatorPOI) errors.push(`No elevator POI found (role "elevator")`);

  // Connectivity: ensure entrances & POIs are connected to the graph
  for (const id of entranceIds) {
    if ((adjacency.get(id) || []).length === 0) errors.push(`Entrance node ${id} is not connected to any edge`);
  }
  for (const id of stairsIds) {
    if ((adjacency.get(id) || []).length === 0) errors.push(`Stairs POI ${id} is not connected to any edge`);
  }
  for (const id of elevatorIds) {
    if ((adjacency.get(id) || []).length === 0) errors.push(`Elevator POI ${id} is not connected to any edge`);
  }

  return { valid: errors.length === 0, errors };
}