#!/usr/bin/env node

const PORT = 8080;
const START_X = 0;
const START_Y = 0;
const STEP_X = 0.5;
const STEP_Y = 0.5;

let WebSocketServer;

try {
  ({ WebSocketServer } = require("ws"));
} catch (error) {
  console.error('Missing dependency "ws". Run: npm install ws');
  process.exit(1);
}

let x = START_X;
let y = START_Y;
let stepX = STEP_X;
let stepY = STEP_Y;

const wss = new WebSocketServer({ host: "0.0.0.0", port: PORT });

function getPayload() {
  return JSON.stringify({
    type: "position",
    x,
    y,
    timestamp: Date.now(),
  });
}

function broadcastPosition() {
  const payload = getPayload();

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }

  printStatus();
}

function printStatus() {
  console.clear();
  console.log(`Mock tracking server: ws://0.0.0.0:${PORT}`);
  console.log("");
  console.log(`Position -> x=${x.toFixed(2)} y=${y.toFixed(2)}`);
  console.log(`Step -> x=${stepX.toFixed(2)} y=${stepY.toFixed(2)}`);
  console.log(`Clients -> ${wss.clients.size}`);
  console.log("");
  console.log("Controls:");
  console.log("  W / ArrowUp    move north (+y)");
  console.log("  S / ArrowDown  move south (-y)");
  console.log("  A / ArrowLeft  move west (-x)");
  console.log("  D / ArrowRight move east (+x)");
  console.log("  +              bigger step");
  console.log("  -              smaller step");
  console.log("  R              reset position");
  console.log("  P              send current position");
  console.log("  Q or Ctrl+C    quit");
}

function move(dx, dy) {
  x = Math.round((x + dx) * 1000) / 1000;
  y = Math.round((y + dy) * 1000) / 1000;
  broadcastPosition();
}

function resetPosition() {
  x = START_X;
  y = START_Y;
  broadcastPosition();
}

function increaseStep() {
  stepX = Math.round((stepX + 0.1) * 10) / 10;
  stepY = Math.round((stepY + 0.1) * 10) / 10;
  printStatus();
}

function decreaseStep() {
  stepX = Math.max(0.1, Math.round((stepX - 0.1) * 10) / 10);
  stepY = Math.max(0.1, Math.round((stepY - 0.1) * 10) / 10);
  printStatus();
}

function handleKey(buffer) {
  const key = buffer.toString();

  if (key === "\u0003" || key === "q" || key === "Q") {
    shutdown();
    return;
  }

  if (key === "w" || key === "W" || key === "\u001b[A") {
    move(0, stepY);
    return;
  }

  if (key === "s" || key === "S" || key === "\u001b[B") {
    move(0, -stepY);
    return;
  }

  if (key === "a" || key === "A" || key === "\u001b[D") {
    move(-stepX, 0);
    return;
  }

  if (key === "d" || key === "D" || key === "\u001b[C") {
    move(stepX, 0);
    return;
  }

  if (key === "+" || key === "=") {
    increaseStep();
    return;
  }

  if (key === "-" || key === "_") {
    decreaseStep();
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
  if (process.stdin.isRaw) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
  wss.close(() => process.exit(0));
}

wss.on("connection", (socket) => {
  socket.send(getPayload());
  printStatus();
});

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", handleKey);
process.on("SIGINT", shutdown);

printStatus();
