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
  parseHeartbeat,
  parseGps,
  buildCommand,
} from "./protocol.js";

const TCP_PORT = 9679;

function handlePacket(raw: string): void {
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
        socket.write(buildCommand(imei, "H0", "", true));
      }
      broadcast({ event: "heartbeat", state });
      break;
    }

    case "W0": {
      const freq = fields[0];
      console.log(`[W0] ${imei} | frequency=${freq}`);

      if (socket) {
        socket.write(buildCommand(imei, "W0", "", true));
      }

      broadcast({ event: "alarm", freq });
      break;
    }

    case "D0": {
      const gps = parseGps(fields);

      const state = upsertState(imei, {
        location: { ...gps, updatedAt: new Date().toISOString() },
      });

      console.log(`[D0] ${imei} | lat=${gps.lat} lon=${gps.lon}`);

      if (socket) {
        socket.write(buildCommand(imei, "D0", "", true));
      }

      broadcast({ event: "location", imei, location: state.location });
      break;
    }

    case "L0": {
      const state = upsertState(imei, { locked: false });
      if (socket) {
        socket.write(buildCommand(imei, "L0", "", true));
        console.log(`[L0] ack sent`);
      }
      console.log(`[L0] ${imei} confirmed UNLOCKED ✓`);
      broadcast({ event: "unlocked", state });
      break;
    }

    case "L1": {
      const state = upsertState(imei, { locked: true });
      console.log(`[L1] ${imei} confirmed LOCKED ✓`);

      if (socket) {
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
      console.log(`[LOCK: incoming] raw hex: ${chunk.toString("hex")}`);
      console.log(
        `[LOCK: incoming] readable: ${chunk.toString("ascii").replace(/[^\x20-\x7E]/g, (c) => `<${c.charCodeAt(0).toString(16).toUpperCase()}>`)}`,
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
