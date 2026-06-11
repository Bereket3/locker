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
  console.log(raw.toString());
  const packet = parsePacket(raw);
  if (!packet) {
    console.warn(`[TCP] Unrecognised packet: ${raw}`);
    return;
  }

  const { imei, cmd, fields } = packet;
  const socket = getSocket(imei);

  switch (cmd) {
    case "Q0": {
      const batteryVoltage = parseInt(fields[0] ?? "0") / 100;
      upsertState(imei, {
        batteryVoltage,
        locked: true,
        connectedAt: new Date().toISOString(),
      });

      const socket = getSocket(imei);
      if (socket) {
        socket.write(buildCommand(imei, "Q0", fields[0], true));
        console.log(`[Q0] ack sent`);
      }
      break;
    }

    case "H0": {
      const { locked, batteryVoltage, signal } = parseHeartbeat(fields);
      const state = upsertState(imei, { locked, batteryVoltage, signal });
      console.log(
        `[H0] ${imei} | locked=${locked} | battery=${batteryVoltage.toFixed(2)}V`,
      );

      if (socket) {
        // Acknowledge Heartbeat
        socket.write(buildCommand(imei, "H0", "", true));
      }
      broadcast({ event: "heartbeat", state });
      break;
    }

    case "D0": {
      const gps = parseGps(fields);
      const state = upsertState(imei, {
        location: { ...gps, updatedAt: new Date().toISOString() },
      });
      console.log(`[D0] ${imei} | lat=${gps.lat} lon=${gps.lon}`);

      if (socket) {
        // CRITICAL: Acknowledge GPS upload to clear hardware retry buffer
        socket.write(buildCommand(imei, "D0", "", true));
        console.log(`[D0] ack sent`);
      }
      broadcast({ event: "location", imei, location: state.location });
      break;
    }

    case "L0": {
      // L0 confirmation from device means it successfully UNLOCKED
      const state = upsertState(imei, { locked: false });
      console.log(`[L0] ${imei} confirmed UNLOCKED ✓`);
      broadcast({ event: "unlocked", state });
      break;
    }

    case "L1": {
      // L1 from device is an active notification that it was LOCKED
      const state = upsertState(imei, { locked: true });
      console.log(`[L1] ${imei} confirmed LOCKED ✓`);

      if (socket) {
        // CRITICAL: Acknowledge lock reporting event (Matches Screenshot 1)
        socket.write(buildCommand(imei, "L1", "", true));
        console.log(`[L1] ack sent`);
      }
      broadcast({ event: "locked", state });
      break;
    }

    default:
      console.log(`[TCP] ${imei} unhandled cmd=${cmd}`);
  }
}

// ─── Command sender ───────────────────────────────────────────────────────────

export type LockCommand = "L0" | "L1" | "D0" | "S5";

export function sendCommand(
  imei: string,
  cmd: LockCommand,
  data = "",
): { ok: boolean; error?: string } {
  const socket = getSocket(imei);
  if (!socket) return { ok: false, error: "Lock not connected" };
  if (socket.destroyed) return { ok: false, error: "Socket closed" };

  try {
    // isReply = false because this is an active outbound command initiation
    const buf = buildCommand(imei, cmd, data, false);

    console.log(
      `[→ LOCK] Sending Active Command ${imei} cmd=${cmd} data=${data}`,
    );
    socket.write(buf);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export function startTcpServer(): void {
  const server = net.createServer((socket) => {
    const addr = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[TCP] New connection from ${addr}`);

    let imei: string | null = null;
    let buffer = "";

    socket.on("data", (chunk: Buffer) => {
      console.log(`[← LOCK] raw hex: ${chunk.toString("hex")}`);
      console.log(
        `[← LOCK] readable: ${chunk.toString("ascii").replace(/[^\x20-\x7E]/g, (c) => `<${c.charCodeAt(0).toString(16).toUpperCase()}>`)}`,
      );

      buffer += chunk.toString("ascii");

      const parts = buffer.split("#");

      buffer = parts.pop() ?? "";

      for (const raw of parts) {
        const trimmed = raw.replace(/^\n/, "").trim();
        if (!trimmed) continue;

        const fields = trimmed.split(",");
        if (fields.length >= 3 && trimmed.startsWith("*CMDR")) {
          const packetImei = fields[2];
          if (packetImei) {
            if (packetImei !== imei) {
              imei = packetImei;
            }
            registerSocket(imei, socket);
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
