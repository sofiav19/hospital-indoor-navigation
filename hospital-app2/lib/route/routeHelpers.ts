import { normalizeAngleDelta } from "./navigationInstructions";

export function distanceMeters(a: [number, number], b: [number, number]) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

// Prefer true heading when available, otherwise fall back to magnetic heading.
export function getHeadingValue(value: any) {
  if (typeof value?.trueHeading === "number" && value.trueHeading >= 0) return value.trueHeading;
  if (typeof value?.magHeading === "number") return value.magHeading;
  return null;
}

// Smooth heading updates
export function smoothHeading(previous: number | null, next: number) {
  if (!Number.isFinite(next)) return previous;
  if (previous === null || !Number.isFinite(previous)) return next;

  const delta = normalizeAngleDelta(next - previous);
  const absDelta = Math.abs(delta);
  if (absDelta < 1) return previous;
  // Bigger changes, more smoothing (but always keep at least 22% of the change to avoid excessive lag)
  const gain = absDelta > 45 ? 0.55 : absDelta > 20 ? 0.35 : 0.22;
  return (previous + delta * gain + 360) % 360;
}

// Helpers to get node properties
export function getNodeFeature(nodes: any, nodeId?: string | null) {
  if (!nodeId) return null;
  return (nodes?.features || []).find((feature: any) => feature?.properties?.id === nodeId) || null;
}
export function getNodeRole(nodes: any, nodeId?: string | null) {
  return getNodeFeature(nodes, nodeId)?.properties?.role || null;
}
