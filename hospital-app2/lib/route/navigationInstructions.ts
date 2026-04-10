import { HOSPITAL_DIRECTORY } from "../hospitalDirectory";
import { getNodeFeature, getNodeRole } from "./routeHelpers";

const CURVE_TURN_MIN_DEGREES = 22;
const HARD_TURN_MIN_DEGREES = 60;

type Maneuver =
  | "forward"
  | "left"
  | "right"
  | "left-forward"
  | "right-forward"
  | "up"
  | "down"
  | "arrive";

type Segment = {
  floor?: number | null;
  toFloor?: number | null;
  fromNodeId?: string | null;
  toNodeId?: string | null;
  meters?: number;
  geojson?: {
    features?: Array<{
      geometry?: {
        coordinates?: [number, number][];
      };
    }>;
  };
} | null;

function getNodeLabel(nodeId?: string | null) {
  // Use the instruction text from the directory
  return HOSPITAL_DIRECTORY.find((entry) => entry.destinationNodeId === nodeId)?.name || null;
}

export function normalizeAngleDelta(delta: number) {
  if (delta > 180) return delta - 360;
  if (delta < -180) return delta + 360;
  return delta;
}

export function getHeadingFromSegment(coords: [number, number][], point?: [number, number] | null) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;

  let start = coords[0];
  let end = coords[coords.length - 1];

  // First find the segment point closest to the user
  if (point) {
    let bestDistanceSq = Infinity;
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1];
      const b = coords[i];
      const segX = b[0] - a[0];
      const segY = b[1] - a[1];
      const segLenSq = segX * segX + segY * segY;
      if (segLenSq <= 0) continue;

      const tRaw = ((point[0] - a[0]) * segX + (point[1] - a[1]) * segY) / segLenSq;
      const t = Math.max(0, Math.min(1, tRaw));
      const projX = a[0] + segX * t;
      const projY = a[1] + segY * t;
      const dx = point[0] - projX;
      const dy = point[1] - projY;
      const distSq = dx * dx + dy * dy;

      // Use that segment to decide the heading 
      if (distSq < bestDistanceSq) {
        bestDistanceSq = distSq;
        start = a;
        end = b;
      }
    }
  }
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return 0;

  const bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

// Pull the route polyline out of one instruction segment so the turn helpers below
// can work with plain coordinates instead of GeoJSON nesting.
function getSegmentCoords(segment: Segment) {
  return segment?.geojson?.features?.[0]?.geometry?.coordinates || [];
}

// Convert a heading change into the small maneuver vocabulary used by the app UI.
function getTurnFromHeadings(
  fromHeading: number,
  toHeading: number
): Maneuver {
  const delta = normalizeAngleDelta(toHeading - fromHeading);
  const absDelta = Math.abs(delta);

  // Small bends as "forward", larger deltas become turns.
  if (absDelta < CURVE_TURN_MIN_DEGREES) return "forward";
  if (delta < 0) return absDelta >= HARD_TURN_MIN_DEGREES ? "left" : "left-forward";
  return absDelta >= HARD_TURN_MIN_DEGREES ? "right" : "right-forward";
}

// Calculate what is the next movement by comparing the current segment direction with the segment that follows it.
export function getSegmentTurnHint(currentSegment: Segment, nextSegment: Segment) {
  const currentCoords = getSegmentCoords(currentSegment);
  const nextCoords = getSegmentCoords(nextSegment);
  // avoid bad format input 
  if (currentCoords.length < 2 || nextCoords.length < 2) return "forward";
  return getTurnFromHeadings(getHeadingFromSegment(currentCoords), getHeadingFromSegment(nextCoords));
}

// Save previous segment to compare
function getTurnFromPreviousSegment(previousSegment: Segment, currentSegment: Segment): Maneuver {
  const previousCoords = getSegmentCoords(previousSegment);
  const currentCoords = getSegmentCoords(currentSegment);

  if (previousCoords.length < 2 || currentCoords.length < 2) return "forward";

  return getTurnFromHeadings(getHeadingFromSegment(previousCoords),getHeadingFromSegment(currentCoords)
  );
}

// Meter distance helper
function formatMeters(meters: number | null) {
  if (typeof meters !== "number" || !Number.isFinite(meters)) return null;
  return `${Math.max(1, Math.round(meters))} m`;}

function getNextTurnText(nextTurn: Maneuver) {
  if (nextTurn === "left") return "Gire a la izquierda.";
  if (nextTurn === "right") return "Gire a la derecha.";
  if (nextTurn === "left-forward") return "Gire ligeramente a la izquierda.";
  if (nextTurn === "right-forward") return "Gire ligeramente a la derecha.";
  return "Siga recto.";
}
export function getImmediateTurnTitle(maneuver: string | null | undefined) {
  if (maneuver === "left") return "Gire a la izquierda";
  if (maneuver === "right") return "Gire a la derecha";
  if (maneuver === "left-forward") return "Gire ligeramente a la izquierda";
  if (maneuver === "right-forward") return "Gire ligeramente a la derecha";
  return null;
}
function getContinueTitle(metersText: string | null, targetLabel?: string | null) {
  if (metersText && targetLabel) return `Siga recto ${metersText} hasta ${targetLabel}`;
  if (metersText) return `Siga recto ${metersText}`;
  if (targetLabel) return `Siga recto hasta ${targetLabel}`;
  return "Siga recto";
}

export function formatInstructionForSpeech(title: string) {
  return title.replace(/(\d+)\s?m\b/g, "$1 metros");
}

export function isCrossFloorSegment(segment: Segment) {
  const fromFloor = segment?.floor ?? null;
  const toFloor = segment?.toFloor ?? null;
  return fromFloor !== null && toFloor !== null && fromFloor !== toFloor;
}

export function segmentTouchesFloor(segment: Segment, floor: number | null) {
  if (!segment || floor === null) return true;
  return segment?.floor === floor || segment?.toFloor === floor;
}

function getSegmentMeters(segment: Segment) {
  if (typeof segment?.meters === "number") return Math.round(segment.meters);
  return null;
}

function getCrossFloorDetail(role: string | null, maneuver: Maneuver, toFloor: number | null) {
  if (role === "elevator") {
    return maneuver === "up"
      ? `Suba a la planta ${toFloor} en ascensor.`
      : `Baje a la planta ${toFloor} en ascensor.`;
  }

  if (role === "stairs") {
    return maneuver === "up"
      ? `Suba a la planta ${toFloor} por las escaleras.`
      : `Baje a la planta ${toFloor} por las escaleras.`;
  }

  return `Cambie a la planta ${toFloor}.`;
}

export function buildDetailedInstruction(
  segment: Segment,
  previousSegment: Segment,
  nextSegment: Segment,
  nodes: any,
  destinationId: string | null
) {
  if (!segment) return null;

  const fromFloor = segment?.floor ?? null;
  const toFloor = segment?.toFloor ?? fromFloor;
  const transitionRole = getNodeRole(nodes, segment?.fromNodeId) || getNodeRole(nodes, segment?.toNodeId);
  const isCrossFloor = isCrossFloorSegment(segment);
  const isArrival = false;
  const metersText = formatMeters(getSegmentMeters(segment));

  // Each step gets the current maneuver from the previous instruction
  let maneuver: Maneuver = getTurnFromPreviousSegment(previousSegment, segment);

  if (isCrossFloor) {maneuver = (toFloor ?? 0) > (fromFloor ?? 0) ? "up" : "down";}

  let title = getContinueTitle(metersText);
  let detail: string | null = null;

  if (isArrival) {
    const destinationLabel = getNodeLabel(segment?.toNodeId ?? null) || "su destino";
    title = `Ha llegado a ${destinationLabel}`;
    detail = "Ya está en la puerta de su destino.";
  } else if (isCrossFloor) {
    // Different instruction style for floor changes
    let transitionLabel = "el cambio de planta";
    if (transitionRole === "elevator") transitionLabel = "el ascensor";
    if (transitionRole === "stairs") transitionLabel = "las escaleras";
    title = getContinueTitle(metersText, transitionLabel);
    detail = getCrossFloorDetail(transitionRole, maneuver, toFloor);
  } else {
    // simple forward/turn instructions if on the same floor
    maneuver = "forward";
    const nextTurn = getSegmentTurnHint(segment, nextSegment);
    const currentTargetLabel = getNodeLabel(segment?.toNodeId ?? null);
    const nextLabel = getNodeLabel(nextSegment?.toNodeId ?? null) || currentTargetLabel;

    title = getContinueTitle(metersText, currentTargetLabel);

    // For details, we use what the future instruction will be
    if (nextSegment) {
      const nextTransitionRole = getNodeRole(nodes, nextSegment?.fromNodeId) || getNodeRole(nodes, nextSegment?.toNodeId);
      if (nextTransitionRole === "stairs") {
        detail = "Vaya hacia las escaleras.";
      } else if (nextTransitionRole === "elevator") {
        detail = "Vaya hacia el ascensor.";
      } else if (nextLabel) {
        detail = `${getNextTurnText(nextTurn)} Hacia ${nextLabel}.`;
      } else {
        detail = getNextTurnText(nextTurn);
      }
    } else if (nextLabel) {
      detail = `Continue hacia ${nextLabel}.`;
    }
  }
  return {
    title,
    detail,
    fromFloor,
    toFloor,
    fromNodeId: segment?.fromNodeId ?? null,
    toNodeId: segment?.toNodeId ?? null,
    maneuver,
  };
}
