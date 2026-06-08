import net from "net";
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
      const unlockStatus = fields[0];

      if (unlockStatus === "1") {
        const state = upsertState(imei, { locked: false });
        console.log(`[L0] ${imei} unlocked ✓`);
        broadcast({ event: "unlocked", state });
      } else {
        // lock is asking for unlock confirmation — send L0 back
        console.log(
          `[L0] ${imei} requesting unlock confirmation, sending L0 back`,
        );
        const socket = getSocket(imei);
        if (socket) {
          socket.write(buildCommand(imei, "L0"));
        }
      }
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
      // Log raw incoming bytes — critical for debugging
      console.log(`[← LOCK] raw hex: ${chunk.toString("hex")}`);
      console.log(
        `[← LOCK] readable: ${chunk.toString("ascii").replace(/[^\x20-\x7E]/g, (c) => `<${c.charCodeAt(0).toString(16).toUpperCase()}>`)}`,
      );

      buffer += chunk.toString("ascii");

      // Some firmwares end with #\n, some with just #
      // Split on # and treat each complete segment as a packet
      const parts = buffer.split("#");

      // Last element is either empty (packet ended cleanly) or an incomplete packet
      buffer = parts.pop() ?? "";

      for (const raw of parts) {
        const trimmed = raw.replace(/^\n/, "").trim(); // strip leading \n from previous split
        if (!trimmed) continue;

        // extract IMEI and register/refresh the socket on every packet
        const fields = trimmed.split(",");
        if (fields.length >= 3 && trimmed.startsWith("*CMDR")) {
          const packetImei = fields[2];
          if (packetImei && packetImei !== imei) {
            imei = packetImei;
            registerSocket(imei, socket);
            console.log(`[TCP] Lock IMEI identified: ${imei}`);
          }
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
    const buf = buildCommand(imei, cmd);

    // Log exactly what we're sending — hex so we can verify the \xFF\xFF prefix
    // and the full packet body character by character
    console.log(`[→ LOCK] ${imei} cmd=${cmd}`);
    console.log(`[→ LOCK] raw hex: ${buf.toString("hex")}`);
    console.log(
      `[→ LOCK] readable: ${buf.toString("ascii").replace(/\xFF/g, "<FF>")}`,
    );

    socket.write(buf);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
