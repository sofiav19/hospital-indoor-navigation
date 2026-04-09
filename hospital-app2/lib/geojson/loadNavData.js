import nodesRaw from "../../assets/data/nodes_hospital.json";
import edgesRaw from "../../assets/data/edges_hospital.json";
import floorplanRaw from "../../assets/data/floorplan_c.json";

const NAV_DATA_URL = process.env.EXPO_PUBLIC_NAV_DATA_URL || "http://localhost:4000/api/nav-data";
const LOCAL_NAV_DATA_VERSION = "Marzo 2026, version 1";
const LOCAL_NAV_DATA_UPDATED_AT = "2026-03-01T00:00:00.000Z";
let cacheNavigationData = null;

// Clone the JSON to prevent accidental overwrites 
function cloneLocalNavData() {
  return {
    nodes: JSON.parse(JSON.stringify(nodesRaw)),
    edges: JSON.parse(JSON.stringify(edgesRaw)),
    floorplan: JSON.parse(JSON.stringify(floorplanRaw)),
    source: "local-fallback",
    version: LOCAL_NAV_DATA_VERSION,
    updatedAt: LOCAL_NAV_DATA_UPDATED_AT,
  };
}

// Fail fast the backend call and use local
async function fetchNavDataWithTimeout() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(NAV_DATA_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function loadNavigationData() {
  if (!cacheNavigationData) {
    // Fetch once and store in cache
    cacheNavigationData = fetchNavDataWithTimeout()
      .then((data) => ({
        nodes: data.nodes,
        edges: data.edges,
        floorplan: data.floorplan,
        version: data.version || LOCAL_NAV_DATA_VERSION,
        updatedAt: data.updatedAt || LOCAL_NAV_DATA_UPDATED_AT,
        source: "backend",
      }))
      .catch((error) => {
        console.log("[NavDataInit] Backend nav data fetch failed, using local fallback", {
          url: NAV_DATA_URL,
          error: error?.message || String(error),
        });
        return cloneLocalNavData();
      });
  }
  return cacheNavigationData;
}
