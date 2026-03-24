let cacheNavigationData = null;

export async function loadNavigationData() {
  if (!cacheNavigationData) {
    cacheNavigationData = Promise.all([
      fetch("/data/nodes_hospital.geojson").then((r) => r.json()),
      fetch("/data/edges_hospital.geojson").then((r) => r.json()),
      fetch("/data/floorplan_c.geojson").then((r) => r.json()),
    ]).then(([nodes, edges, floorplan]) => ({ nodes, edges, floorplan }));
  }
  return cacheNavigationData;
}

export function clearNavigationDataCache() {
  cacheNavigationData = null;
}