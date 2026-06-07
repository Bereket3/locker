import * as net from "net";

import {
  registerSocket,
  removeSocket,
  upsertState,
  broadcast,
  getSocket,
} from "./lockStore.js";
import {
  parsePacket,
  parseSignIn,
  parseHeartbeat,
  parseGps,
  buildCommand,
} from "./protocol.js";

const TCP_PORT = 9679;

// ─── Packet handler ───────────────────────────────────────────────────────────

function handlePacket(raw: string): void {
  const packet = parsePacket(raw);
  if (!packet) {
    console.warn(`[TCP] Unrecognised packet: ${raw}`);
    return;
  }

  const { imei, cmd, fields } = packet;

  switch (cmd) {
    case "Q0": {
      const { signal, batteryVoltage, locked } = parseSignIn(fields);
      const state = upsertState(imei, {
        signal,
        batteryVoltage,
        locked,
        connectedAt: new Date().toISOString(),
      });
      console.log(
        `[Q0] Lock ${imei} signed in | signal=${signal}/31 | battery=${batteryVoltage.toFixed(2)}V`,
      );
      broadcast({ event: "connected", state });
      break;
    }

    case "H0": {
      const { locked, batteryVoltage, signal } = parseHeartbeat(fields);
      const state = upsertState(imei, { locked, batteryVoltage, signal });
      console.log(
        `[H0] ${imei} | locked=${locked} | battery=${batteryVoltage.toFixed(2)}V | signal=${signal}/31`,
      );
      broadcast({ event: "heartbeat", state });
      break;
    }

    case "D0": {
      const gps = parseGps(fields);
      const state = upsertState(imei, {
        location: { ...gps, updatedAt: new Date().toISOString() },
      });
      console.log(
        `[D0] ${imei} | lat=${gps.lat} lon=${gps.lon} | speed=${gps.speed}km/h | sats=${gps.satellites}`,
      );
      broadcast({ event: "location", imei, location: state.location });
      break;
    }

    case "L0": {
      const state = upsertState(imei, { locked: false });
      console.log(`[L0] ${imei} unlocked ✓`);
      broadcast({ event: "unlocked", state });
      break;
    }

    case "L1": {
      const state = upsertState(imei, { locked: true });
      console.log(`[L1] ${imei} locked ✓`);
      broadcast({ event: "locked", state });
      break;
    }

    case "S5": {
      const locked = fields[0] === "1";
      const state = upsertState(imei, { locked });
      console.log(`[S5] ${imei} status=${locked ? "locked" : "unlocked"}`);
      broadcast({ event: "status", state });
      break;
    }

    default:
      console.log(
        `[TCP] ${imei} unhandled cmd=${cmd} fields=${fields.join(",")}`,
      );
  }
}

// ─── TCP server ───────────────────────────────────────────────────────────────

export function startTcpServer(): void {
  const server = net.createServer((socket) => {
    const addr = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[TCP] New connection from ${addr}`);

    let imei: string | null = null;
    let buffer = "";

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("ascii");

      // packets end with #\n — split and process complete ones
      const parts = buffer.split(/(?<=#)\n/);
      buffer = parts.pop() ?? ""; // last item may be incomplete

      for (const raw of parts) {
        const trimmed = raw.trim();
        if (!trimmed) continue;

        // register socket on first packet
        const fields = trimmed.split(",");
        if (!imei && fields.length >= 3 && trimmed.startsWith("*CMDR")) {
          imei = fields[2];
          registerSocket(imei, socket);
          console.log(`[TCP] Lock IMEI identified: ${imei}`);
        }

        handlePacket(trimmed);
      }
    });

    socket.on("close", () => {
      console.log(`[TCP] ${imei ?? addr} disconnected`);
      if (imei) {
        removeSocket(imei);
        broadcast({ event: "disconnected", imei });
      }
    });

    socket.on("error", (err) => {
      console.error(`[TCP] Socket error (${imei ?? addr}):`, err.message);
    });
  });

  server.listen(TCP_PORT, "0.0.0.0", () => {
    console.log(`[TCP] Listening on port ${TCP_PORT} for lock connections`);
  });

  server.on("error", (err) => {
    console.error("[TCP] Server error:", err.message);
  });
}

// ─── Command sender ───────────────────────────────────────────────────────────

export type LockCommand = "L0" | "L1" | "D0" | "S5";

export function sendCommand(
  imei: string,
  cmd: LockCommand,
): { ok: boolean; error?: string } {
  const socket = getSocket(imei);
  if (!socket) return { ok: false, error: "Lock not connected" };
  if (socket.destroyed) return { ok: false, error: "Socket closed" };

  try {
    socket.write(buildCommand(imei, cmd));
    console.log(`[→ LOCK] ${imei} cmd=${cmd}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
