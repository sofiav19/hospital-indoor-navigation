type MonitoringPayload = Record<string, unknown>;
type TrackEventOptions = {
  throwOnFailure?: boolean;
};

export type MonitoringEvent = {
  id: string;
  name: string;
  timestamp: string;
  sessionId: string;
  payload: MonitoringPayload;
};

const MONITORING_INGEST_URL =
  process.env.EXPO_PUBLIC_MONITORING_INGEST_URL || "";
const sessionId = `session-${Math.random().toString(36).slice(2, 10)}`;

// Create general function to create an event
function createMonitoringEvent(
  name: string,
  payload: MonitoringPayload = {}
): MonitoringEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    timestamp: new Date().toISOString(),
    sessionId,
    payload,
  };
}

// Send event to the backend
export async function trackEvent(
  name: string,
  payload: MonitoringPayload = {},
  options: TrackEventOptions = {}
) {
  const event = createMonitoringEvent(name, payload);

  if (!MONITORING_INGEST_URL) {
    if (options.throwOnFailure) { throw new Error("MONITORING_URL_MISSING"); }
    return { event, sent: false };
  }

  try {
    const response = await fetch(MONITORING_INGEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }
  } catch (error) {
    console.warn("[Monitoring] send failed", {
      name,
      url: MONITORING_INGEST_URL,
      error,
    });
    
    if (options.throwOnFailure) { throw error; }
    return { event, sent: false };
  }
  return { event, sent: true };
}
