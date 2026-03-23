import { useEffect } from "react";
import { useNavStore } from "../../store/navStore";

type TrackingMessage = {
  type?: string;
  x?: number;
  y?: number;
  timestamp?: number;
};

const TRACKING_WS_URL = process.env.EXPO_PUBLIC_TRACKING_WS_URL || "";

function isValidTrackingMessage(payload: TrackingMessage) {
  return (
    payload?.type === "position" &&
    typeof payload?.x === "number" &&
    Number.isFinite(payload.x) &&
    typeof payload?.y === "number" &&
    Number.isFinite(payload.y)
  );
}

export default function TrackingInit() {
  const ingestTrackedSample = useNavStore((s) => s.ingestTrackedSample);
  const setLivePositionProvider = useNavStore((s) => s.setLivePositionProvider);

  useEffect(() => {
    const provider = TRACKING_WS_URL ? "optitrack" : "none";
    setLivePositionProvider(provider);
    console.log("[TrackingInit] boot", { provider, url: TRACKING_WS_URL || "(empty)" });

    if (!TRACKING_WS_URL) {
      return;
    }

    let socket: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;

      console.log("[TrackingInit] connecting", { url: TRACKING_WS_URL });
      socket = new WebSocket(TRACKING_WS_URL);

      socket.onopen = () => {
        console.log("[TrackingInit] connected");
        setLivePositionProvider("optitrack");
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as TrackingMessage;
          if (!isValidTrackingMessage(payload)) {
            console.log("[TrackingInit] ignored message", payload);
            return;
          }

          console.log("[TrackingInit] sample", payload);
          ingestTrackedSample([payload.x as number, payload.y as number]);
        } catch (error) {
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
        reconnectTimeout = setTimeout(connect, 1500);
      };
    };

    connect();

    return () => {
      disposed = true;

      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }

      if (socket) {
        socket.close();
      }
    };
  }, [ingestTrackedSample, setLivePositionProvider]);

  return null;
}
