import { HOSPITAL_DIRECTORY } from "../hospitalDirectory";

const CURVE_TURN_MIN_DEGREES = 12;
const HARD_TURN_MIN_DEGREES = 60;

function getNodeFeature(nodes: any, nodeId: string | null) {
  if (!nodeId) return null;
  return (nodes?.features || []).find((feature: any) => feature?.properties?.id === nodeId) || null;
}

function getNodeLabel(nodes: any, nodeId: string | null) {
  const directoryLabel =
    HOSPITAL_DIRECTORY.find((entry) => entry.destinationNodeId === nodeId)?.name || null;
  return directoryLabel || null;
}

function getNodeRole(nodes: any, nodeId: string | null) {
  return getNodeFeature(nodes, nodeId)?.properties?.role || null;
}

function normalizeAngleDelta(delta: number) {
  if (delta > 180) return delta - 360;
  if (delta < -180) return delta + 360;
  return delta;
}

export function getHeadingFromSegment(coords: [number, number][]) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;

  const start = coords[0];
  const end = coords[coords.length - 1];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return 0;

  const bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

export function getSegmentTurnHint(currentSegment: any, nextSegment: any) {
  const currentCoords = currentSegment?.geojson?.features?.[0]?.geometry?.coordinates || [];
  const nextCoords = nextSegment?.geojson?.features?.[0]?.geometry?.coordinates || [];

  if (!Array.isArray(currentCoords) || currentCoords.length < 2) return "forward" as const;
  if (!Array.isArray(nextCoords) || nextCoords.length < 2) return "forward" as const;

  const currentHeading = getHeadingFromSegment(currentCoords);
  const nextHeading = getHeadingFromSegment(nextCoords);
  const delta = normalizeAngleDelta(nextHeading - currentHeading);
  const absDelta = Math.abs(delta);

  if (absDelta < CURVE_TURN_MIN_DEGREES) return "forward" as const;
  if (delta < 0) return absDelta >= HARD_TURN_MIN_DEGREES ? ("left" as const) : ("left-forward" as const);
  return absDelta >= HARD_TURN_MIN_DEGREES ? ("right" as const) : ("right-forward" as const);
}

function getTurnFromPreviousSegment(previousSegment: any, currentSegment: any) {
  if (!previousSegment || !currentSegment) return "forward" as const;

  const previousCoords = previousSegment?.geojson?.features?.[0]?.geometry?.coordinates || [];
  const currentCoords = currentSegment?.geojson?.features?.[0]?.geometry?.coordinates || [];

  if (!Array.isArray(previousCoords) || previousCoords.length < 2) return "forward" as const;
  if (!Array.isArray(currentCoords) || currentCoords.length < 2) return "forward" as const;

  const previousHeading = getHeadingFromSegment(previousCoords);
  const currentHeading = getHeadingFromSegment(currentCoords);
  const delta = normalizeAngleDelta(currentHeading - previousHeading);
  const absDelta = Math.abs(delta);

  if (absDelta < CURVE_TURN_MIN_DEGREES) return "forward" as const;
  if (delta < 0) return absDelta >= HARD_TURN_MIN_DEGREES ? ("left" as const) : ("left-forward" as const);
  return absDelta >= HARD_TURN_MIN_DEGREES ? ("right" as const) : ("right-forward" as const);
}

function formatMeters(meters: number | null) {
  if (typeof meters !== "number" || !Number.isFinite(meters)) return null;
  return `${Math.max(1, Math.round(meters))} m`;
}

function getNextTurnText(nextTurn: ReturnType<typeof getSegmentTurnHint>) {
  if (nextTurn === "left") return "Gire a la izquierda.";
  if (nextTurn === "right") return "Gire a la derecha.";
  if (nextTurn === "left-forward") return "Gire ligeramente a la izquierda.";
  if (nextTurn === "right-forward") return "Gire ligeramente a la derecha.";
  return "Siga recto.";
}

function getContinueTitle(metersText: string | null, targetLabel?: string | null) {
  if (metersText && targetLabel) return `Siga recto ${metersText} hasta ${targetLabel}`;
  if (metersText) return `Siga recto ${metersText}`;
  if (targetLabel) return `Siga recto hasta ${targetLabel}`;
  return "Siga recto";
}

export function isCrossFloorSegment(segment: any) {
  const fromFloor = segment?.floor ?? null;
  const toFloor = segment?.toFloor ?? null;
  return fromFloor !== null && toFloor !== null && fromFloor !== toFloor;
}

export function segmentTouchesFloor(segment: any, floor: number | null) {
  if (!segment || floor === null) return true;
  return segment?.floor === floor || segment?.toFloor === floor;
}

export function buildDetailedInstruction(
  segment: any,
  previousSegment: any,
  nextSegment: any,
  nodes: any,
  destinationId: string | null
) {
  if (!segment) return null;

  const fromFloor = segment?.floor ?? null;
  const toFloor = segment?.toFloor ?? fromFloor;
  const transitionRole = getNodeRole(nodes, segment?.fromNodeId) || getNodeRole(nodes, segment?.toNodeId);
  const isCrossFloor = isCrossFloorSegment(segment);
  const isArrival = Boolean(destinationId && segment?.toNodeId === destinationId);
  const segmentMeters =
    typeof segment?.meters === "number"
      ? Math.round(segment.meters)
      : typeof segment?.distanceMeters === "number"
        ? Math.round(segment.distanceMeters)
        : null;
  const metersText = formatMeters(segmentMeters);

  let maneuver: "forward" | "left" | "right" | "left-forward" | "right-forward" | "up" | "down" | "arrive" =
    getTurnFromPreviousSegment(previousSegment, segment);

  if (isCrossFloor) {
    const goingUp = (toFloor ?? 0) > (fromFloor ?? 0);
    maneuver = goingUp ? "up" : "down";
  }

  if (isArrival) {
    maneuver = "arrive";
  }

  let title = getContinueTitle(metersText);
  let detail: string | null = null;

  if (isArrival) {
    const destinationLabel = getNodeLabel(nodes, segment?.toNodeId) || "su destino";
    title = getContinueTitle(metersText, destinationLabel);
    detail = "Llegara a su destino.";
  } else if (isCrossFloor) {
    const transitionLabel =
      transitionRole === "elevator"
        ? "el ascensor"
        : transitionRole === "stairs"
          ? "las escaleras"
          : "el cambio de planta";

    title = getContinueTitle(metersText, transitionLabel);

    if (transitionRole === "elevator") {
      detail = maneuver === "up"
        ? `Suba a la planta ${toFloor} en ascensor.`
        : `Baje a la planta ${toFloor} en ascensor.`;
    } else if (transitionRole === "stairs") {
      detail = maneuver === "up"
        ? `Suba a la planta ${toFloor} por las escaleras.`
        : `Baje a la planta ${toFloor} por las escaleras.`;
    } else {
      detail = `Cambie a la planta ${toFloor}.`;
    }
  } else {
    maneuver = "forward";
    const nextTurn = getSegmentTurnHint(segment, nextSegment);
    const currentTargetLabel = getNodeLabel(nodes, segment?.toNodeId);
    const nextLabel = getNodeLabel(nodes, nextSegment?.toNodeId) || currentTargetLabel;

    title = getContinueTitle(metersText, currentTargetLabel);

    if (nextSegment) {
      const nextTransitionRole =
        getNodeRole(nodes, nextSegment?.fromNodeId) || getNodeRole(nodes, nextSegment?.toNodeId);

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
