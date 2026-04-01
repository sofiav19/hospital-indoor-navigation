import AsyncStorage from "@react-native-async-storage/async-storage";

type TelemetryPayload = Record<string, unknown>;
type TelemetrySyncStatus = "pending" | "sent" | "failed";

export type TelemetryEvent = {
  id: string;
  name: string;
  timestamp: string;
  sessionId: string;
  payload: TelemetryPayload;
  syncStatus: TelemetrySyncStatus;
  retryCount: number;
  lastError?: string | null;
};

const TELEMETRY_INGEST_URL = process.env.EXPO_PUBLIC_TELEMETRY_INGEST_URL || "";
const TELEMETRY_STORAGE_KEY = "hospital.telemetry.queue.v1";
const sessionId = `session-${Math.random().toString(36).slice(2, 10)}`;
const telemetryBuffer: TelemetryEvent[] = [];
const MAX_BUFFER_SIZE = 500;

let initPromise: Promise<void> | null = null;
let persistPromise: Promise<void> = Promise.resolve();

function buildTelemetryEvent(name: string, payload: TelemetryPayload = {}): TelemetryEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    timestamp: new Date().toISOString(),
    sessionId,
    payload,
    syncStatus: TELEMETRY_INGEST_URL ? "pending" : "pending",
    retryCount: 0,
    lastError: null,
  };
}

function clampTelemetryBuffer() {
  if (telemetryBuffer.length > MAX_BUFFER_SIZE) {
    telemetryBuffer.splice(0, telemetryBuffer.length - MAX_BUFFER_SIZE);
  }
}

function replaceTelemetryBuffer(nextEvents: TelemetryEvent[]) {
  telemetryBuffer.splice(0, telemetryBuffer.length, ...nextEvents);
  clampTelemetryBuffer();
}

function queuePersist() {
  persistPromise = persistPromise
    .catch(() => undefined)
    .then(async () => {
      try {
        await AsyncStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(telemetryBuffer));
      } catch (error) {
        console.warn("[Telemetry] persist failed", error);
      }
    });

  return persistPromise;
}

async function initTelemetryStorage() {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(TELEMETRY_STORAGE_KEY);
        if (!raw) return;

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;

        const normalized = parsed.filter(Boolean).map((event: any) => ({
          id: String(event?.id || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
          name: String(event?.name || "unknown"),
          timestamp: String(event?.timestamp || new Date().toISOString()),
          sessionId: String(event?.sessionId || sessionId),
          payload: typeof event?.payload === "object" && event?.payload ? event.payload : {},
          syncStatus:
            event?.syncStatus === "sent" || event?.syncStatus === "failed" ? event.syncStatus : "pending",
          retryCount: typeof event?.retryCount === "number" ? event.retryCount : 0,
          lastError: typeof event?.lastError === "string" ? event.lastError : null,
        })) as TelemetryEvent[];

        replaceTelemetryBuffer(normalized);
      } catch (error) {
        console.warn("[Telemetry] init failed", error);
      }
    })();
  }

  return initPromise;
}

function bufferTelemetryEvent(event: TelemetryEvent) {
  telemetryBuffer.push(event);
  clampTelemetryBuffer();
}

function updateTelemetryEvent(eventId: string, partial: Partial<TelemetryEvent>) {
  const index = telemetryBuffer.findIndex((event) => event.id === eventId);
  if (index < 0) return;
  telemetryBuffer[index] = { ...telemetryBuffer[index], ...partial };
}

export async function getTelemetryBuffer() {
  await initTelemetryStorage();
  return [...telemetryBuffer];
}

export async function clearTelemetryBuffer() {
  replaceTelemetryBuffer([]);
  await queuePersist();
}

export async function trackEvent(name: string, payload: TelemetryPayload = {}) {
  await initTelemetryStorage();

  const event = buildTelemetryEvent(name, payload);
  bufferTelemetryEvent(event);
  await queuePersist();

  console.log("[Telemetry] queued", event);

  if (!TELEMETRY_INGEST_URL) {
    return event;
  }

  try {
    const response = await fetch(TELEMETRY_INGEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }

    updateTelemetryEvent(event.id, {
      syncStatus: "sent",
      lastError: null,
    });
    await queuePersist();
  } catch (error) {
    updateTelemetryEvent(event.id, {
      syncStatus: "failed",
      retryCount: event.retryCount + 1,
      lastError: error instanceof Error ? error.message : String(error),
    });
    await queuePersist();

    console.warn("[Telemetry] ingest failed", {
      name,
      url: TELEMETRY_INGEST_URL,
      error,
    });
  }

  return event;
}
