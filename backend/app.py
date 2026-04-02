import json
import os
from datetime import datetime, timezone
from pathlib import Path
import psycopg
from flask import Flask, jsonify, request

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
ENV_FILE = BASE_DIR / ".env"

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

def init_telemetry_table():
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS telemetry_events (
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

def save_telemetry_event(event):
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
                INSERT INTO telemetry_events (
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
    return jsonify(
        {
            "ok": True,
            "source": "backend-data",
            "nodes": json.loads((DATA_DIR / "nodes_hospital.json").read_text(encoding="utf-8")),
            "edges": json.loads((DATA_DIR / "edges_hospital.json").read_text(encoding="utf-8")),
            "floorplan": json.loads((DATA_DIR / "floorplan_c.json").read_text(encoding="utf-8")),
        }
    )

@app.route("/api/directory", methods=["GET"])
def directory():
    return jsonify(json.loads((DATA_DIR / "hospitalDirectory.json").read_text(encoding="utf-8")))

@app.route("/api/telemetry", methods=["POST"])
def telemetry_ingest():
    event = request.get_json(silent=True) or {}
    save_telemetry_event(event)
    return jsonify({"ok": True, "stored": True})

@app.route("/api/telemetry", methods=["GET"])
def telemetry_list():
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
                FROM telemetry_events
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

if __name__ == "__main__":
    init_telemetry_table()
    app.run(host="0.0.0.0", port=PORT)
