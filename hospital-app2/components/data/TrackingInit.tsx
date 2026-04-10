import { useEffect } from "react";
import { useNavStore } from "../../store/navStore";

const TRACKING_WS_URL = process.env.EXPO_PUBLIC_TRACKING_WS_URL || "";
type TrackingMessage = {
  type: "position";
  x: number;
  y: number;
  timestamp?: number;
};

// Check position comming from the ws and its format
function isValidTrackingMessage(payload: unknown): payload is TrackingMessage {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  return (
    candidate.type === "position" &&
    typeof candidate.x === "number" &&
    Number.isFinite(candidate.x) &&
    typeof candidate.y === "number" &&
    Number.isFinite(candidate.y)
  );
}

export default function TrackingInit() {
  const ingestTrackedSample = useNavStore((s) => s.ingestTrackedSample);
  const setLivePositionProvider = useNavStore((s) => s.setLivePositionProvider);

  useEffect(() => {
    // Revert to manual tracking if no configured tracking endpoint is available.
    if (!TRACKING_WS_URL) {
      setLivePositionProvider("none");
      return;
    }

    let socket: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(TRACKING_WS_URL);
      socket.onopen = () => {
        // Set as connected
        setLivePositionProvider("optitrack");
      };

      socket.onmessage = (event) => {
        try {
          // parse incomming message
          const payload = JSON.parse(event.data);
          if (!isValidTrackingMessage(payload)) {
            console.log("[TrackingInit] ignored message", payload);
            return;
          }
          // Raw tracking coordinates are calibrated and stored in the nav store.
          ingestTrackedSample([payload.x, payload.y]);
        } catch (error) {
          // Bad JSON should not break the socket loop; we just skip that frame.
          console.warn("[TrackingInit] Failed to parse tracking message", error);
        }
      };

      socket.onerror = (error) => {
        console.warn("[TrackingInit] socket error", error);
        socket?.close();
      };

      socket.onclose = () => {
        console.log("[TrackingInit] disconnected, retrying");
        if (disposed) return;
        // Brief backoff before reconnecting
        reconnectTimeout = setTimeout(connect, 1500);
      };
    };

    connect();
    return () => {
      disposed = true;
      // Stop any scheduled reconnect before closing the current socket.
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (socket) socket.close();
    };
  }, [ingestTrackedSample, setLivePositionProvider]);

  return null;
}
