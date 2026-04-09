import json
import os
from datetime import datetime, timezone
from pathlib import Path
import psycopg
from flask import Flask, jsonify, request

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
ENV_FILE = BASE_DIR / ".env"
NAV_DATA_VERSION = "Marzo 2026, version 1"

def load_local_env():
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key and key not in os.environ:
            os.environ[key] = value

load_local_env()

PORT = int(os.environ.get("PORT", "4000"))
DATABASE_URL = os.environ.get("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("Missing DATABASE_URL. Create backend/.env from backend/.env.example.")

app = Flask(__name__)

def init_monitoring_table():
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS monitoring_events (
                  id TEXT PRIMARY KEY,
                  event_name TEXT NOT NULL,
                  event_timestamp TIMESTAMPTZ NOT NULL,
                  session_id TEXT,
                  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                  sync_status TEXT,
                  retry_count INTEGER NOT NULL DEFAULT 0,
                  last_error TEXT,
                  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )

def save_monitoring_event(event):
    event_id = str(event.get("id") or f"evt-{int(datetime.now().timestamp() * 1000)}")
    event_name = str(event.get("name") or event.get("event_name") or "unknown")
    event_timestamp = str(event.get("timestamp") or datetime.now(timezone.utc).isoformat())
    session_id = event.get("sessionId") or event.get("session_id")
    sync_status = event.get("syncStatus") or event.get("sync_status")
    retry_count = int(event.get("retryCount") or event.get("retry_count") or 0)
    last_error = event.get("lastError") or event.get("last_error")
    if isinstance(event.get("payload"), dict):
        payload = event["payload"]
    else:
        payload = dict(event)
        payload.pop("id", None)
        payload.pop("name", None)
        payload.pop("event_name", None)
        payload.pop("timestamp", None)

    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO monitoring_events (
                  id,
                  event_name,
                  event_timestamp,
                  session_id,
                  payload,
                  sync_status,
                  retry_count,
                  last_error
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                  event_name = EXCLUDED.event_name,
                  event_timestamp = EXCLUDED.event_timestamp,
                  session_id = EXCLUDED.session_id,
                  payload = EXCLUDED.payload,
                  sync_status = EXCLUDED.sync_status,
                  retry_count = EXCLUDED.retry_count,
                  last_error = EXCLUDED.last_error
                """,
                (
                    event_id,
                    event_name,
                    event_timestamp,
                    session_id,
                    json.dumps(payload),
                    sync_status,
                    retry_count,
                    last_error,
                ),
            )

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return response

@app.route("/", methods=["GET"])
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "service": "hospital-navigation-backend"})

@app.route("/api/nav-data", methods=["GET"])
def nav_data():
    nav_files = [
        DATA_DIR / "nodes_hospital.json",
        DATA_DIR / "edges_hospital.json",
        DATA_DIR / "floorplan_c.json",
    ]
    updated_at = max(nav_file.stat().st_mtime for nav_file in nav_files)

    return jsonify(
        {
            "ok": True,
            "source": "backend-data",
            "version": NAV_DATA_VERSION,
            "updatedAt": datetime.fromtimestamp(updated_at, tz=timezone.utc).isoformat(),
            "nodes": json.loads((DATA_DIR / "nodes_hospital.json").read_text(encoding="utf-8")),
            "edges": json.loads((DATA_DIR / "edges_hospital.json").read_text(encoding="utf-8")),
            "floorplan": json.loads((DATA_DIR / "floorplan_c.json").read_text(encoding="utf-8")),
        }
    )

@app.route("/api/directory", methods=["GET"])
def directory():
    return jsonify(json.loads((DATA_DIR / "hospitalDirectory.json").read_text(encoding="utf-8")))

@app.route("/api/monitoring", methods=["POST"])
def monitoring_ingest():
    event = request.get_json(silent=True) or {}
    save_monitoring_event(event)
    return jsonify({"ok": True, "stored": True})

@app.route("/api/monitoring", methods=["GET"])
def monitoring_list():
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  id,
                  event_name,
                  event_timestamp,
                  session_id,
                  payload,
                  sync_status,
                  retry_count,
                  last_error,
                  received_at
                FROM monitoring_events
                ORDER BY received_at DESC
                LIMIT 500
                """
            )

            columns = [column.name for column in cur.description]
            events = []

            for row in cur.fetchall():
                event = dict(zip(columns, row))
                event["event_timestamp"] = event["event_timestamp"].isoformat()
                event["received_at"] = event["received_at"].isoformat()
                events.append(event)

    return jsonify({"ok": True, "events": events})

@app.route("/api/monitoring/route-performance", methods=["GET"])
def monitoring_route_performance():
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                WITH route_events AS (
                  SELECT
                    CASE
                      WHEN COALESCE(payload->>'routeTimingCategory', '') IN ('initial-route', 'reroute')
                        THEN payload->>'routeTimingCategory'
                      WHEN COALESCE(payload->>'reason', '') IN ('recalculating', 'preference-change', 'floor-switch')
                        THEN 'reroute'
                      ELSE 'initial-route'
                    END AS route_timing_category,
                    (payload->>'computeDurationMs')::DOUBLE PRECISION AS compute_duration_ms
                  FROM monitoring_events
                  WHERE event_name = 'route.computed'
                    AND payload ? 'computeDurationMs'
                    AND payload->>'computeDurationMs' ~ '^[0-9]+(\\.[0-9]+)?$'
                )
                SELECT
                  route_timing_category,
                  COUNT(*)::INT AS sample_count,
                  ROUND(
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY compute_duration_ms)::NUMERIC,
                    2
                  )::DOUBLE PRECISION AS median_compute_duration_ms
                FROM route_events
                GROUP BY route_timing_category
                """
            )

            metrics = {
                "initial-route": {"medianComputeDurationMs": None, "sampleCount": 0},
                "reroute": {"medianComputeDurationMs": None, "sampleCount": 0},
            }

            for category, sample_count, median_compute_duration_ms in cur.fetchall():
                metrics[category] = {
                    "medianComputeDurationMs": median_compute_duration_ms,
                    "sampleCount": sample_count,
                }

    return jsonify({"ok": True, "metrics": metrics})

if __name__ == "__main__":
    init_monitoring_table()
    app.run(host="0.0.0.0", port=PORT)
