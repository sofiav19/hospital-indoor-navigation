export const COORD_MODE: "local" | "lnglat" = "local";
export const ORIGIN_LNGLAT: [number, number] = [-3.67987641902835, 40.43248084928142];

const METERS_PER_DEG_LAT = 111_320;

function metersPerDegLon(latDeg: number) {
  return METERS_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180);
}

export function localToLngLat(localXY: [number, number]): [number, number] {
  const [xMeters, yMeters] = localXY;
  const [lon0, lat0] = ORIGIN_LNGLAT;
  const lon = lon0 + xMeters / metersPerDegLon(lat0);
  const lat = lat0 + yMeters / METERS_PER_DEG_LAT;
  return [lon, lat];
}

export function lngLatToLocal(lnglat: [number, number]): [number, number] {
  const [lon, lat] = lnglat;
  const [lon0, lat0] = ORIGIN_LNGLAT;
  const x = (lon - lon0) * metersPerDegLon(lat0);
  const y = (lat - lat0) * METERS_PER_DEG_LAT;
  return [x, y];
}

export function projectCoordsForMap(coords: [number, number]): [number, number] {
  return COORD_MODE === "local" ? localToLngLat(coords) : coords;
}

export function projectGeoJSONForMap(geojson: any) {
  if (!geojson || COORD_MODE !== "local") return geojson;

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
