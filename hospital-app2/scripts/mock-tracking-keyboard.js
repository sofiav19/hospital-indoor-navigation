#!/usr/bin/env node

const DEFAULT_PORT = Number(process.env.TRACKING_MOCK_PORT || 8080);
const DEFAULT_STEP = Number(process.env.TRACKING_MOCK_STEP || 100);
const DEFAULT_X = Number(process.env.TRACKING_MOCK_START_X || 0);
const DEFAULT_Y = Number(process.env.TRACKING_MOCK_START_Y || 0);

let WebSocketServer;

try {
  ({ WebSocketServer } = require("ws"));
} catch (error) {
  console.error('Missing dependency "ws". Run: npm install ws');
  process.exit(1);
}

let x = Number.isFinite(DEFAULT_X) ? DEFAULT_X : 0;
let y = Number.isFinite(DEFAULT_Y) ? DEFAULT_Y : 0;
let step = Number.isFinite(DEFAULT_STEP) && DEFAULT_STEP > 0 ? DEFAULT_STEP : 0.5;

const wss = new WebSocketServer({ host: "0.0.0.0", port: DEFAULT_PORT });

function buildPayload() {
  return JSON.stringify({
    type: "position",
    x,
    y,
    timestamp: Date.now(),
  });
}

function broadcastPosition() {
  const payload = buildPayload();

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }

  renderStatus();
}

function renderStatus() {
  console.clear();
  console.log(`Mock tracking WS listening on ws://0.0.0.0:${DEFAULT_PORT}`);
  console.log("");
  console.log(`Raw position: x=${x.toFixed(2)}  y=${y.toFixed(2)}  step=${step.toFixed(2)}`);
  console.log(`Clients: ${wss.clients.size}`);
  console.log("");
  console.log("Controls:");
  console.log("  W / ArrowUp       move north (+y)");
  console.log("  S / ArrowDown     move south (-y)");
  console.log("  A / ArrowLeft     move west (-x)");
  console.log("  D / ArrowRight    move east (+x)");
  console.log("  +                 increase step by 20");
  console.log("  -                 decrease step by 20");
  console.log("  R                 reset to start");
  console.log("  P                 rebroadcast current position");
  console.log("  Q or Ctrl+C       quit");
}

function roundStep(value) {
  return Math.max(20, Math.round(value));
}

function move(dx, dy) {
  x = Math.round((x + dx) * 1000) / 1000;
  y = Math.round((y + dy) * 1000) / 1000;
  broadcastPosition();
}

function resetPosition() {
  x = Number.isFinite(DEFAULT_X) ? DEFAULT_X : 0;
  y = Number.isFinite(DEFAULT_Y) ? DEFAULT_Y : 0;
  broadcastPosition();
}

function handleKey(buffer) {
  const key = buffer.toString();

  if (key === "\u0003" || key === "q" || key === "Q") {
    shutdown();
    return;
  }

  if (key === "w" || key === "W" || key === "\u001b[A") {
    move(step, 0);
    return;
  }

  if (key === "s" || key === "S" || key === "\u001b[B") {
    move(-step, 0);
    return;
  }

  if (key === "a" || key === "A" || key === "\u001b[D") {
    move(0, step);
    return;
  }

  if (key === "d" || key === "D" || key === "\u001b[C") {
    move(0, -step);
    return;
  }

  if (key === "+" || key === "=") {
    step = roundStep(step + 20);
    renderStatus();
    return;
  }

  if (key === "-" || key === "_") {
    step = roundStep(step - 20);
    renderStatus();
    return;
  }

  if (key === "r" || key === "R") {
    resetPosition();
    return;
  }

  if (key === "p" || key === "P") {
    broadcastPosition();
  }
}

function shutdown() {
  process.stdin.setRawMode(false);
  process.stdin.pause();
  wss.close(() => process.exit(0));
}

wss.on("connection", (socket) => {
  socket.send(buildPayload());
  renderStatus();
});

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", handleKey);

process.on("SIGINT", shutdown);

renderStatus();
