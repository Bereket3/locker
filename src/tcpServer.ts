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
        // just Q0 ack — nothing else
        socket.write(
          Buffer.concat([
            Buffer.from([0xff, 0xff]),
            Buffer.from(
              `*CMDS,OM,${imei},000000000000,Q0,${fields[0]}#\n`,
              "ascii",
            ),
          ]),
        );
        console.log(`[Q0] ack sent`);
      }
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
      // L0 = lock confirmation
      const status = fields[0];
      const token = fields[2] ?? "0";

      if (status === "1") {
        const state = upsertState(imei, { locked: true }); // L0 = locked
        console.log(`[L0] ${imei} locked ✓`);
        broadcast({ event: "locked", state });
      } else if (token === "0") {
        console.log(`[L0] ${imei} status broadcast (locked), ignoring`);
        upsertState(imei, { locked: true });
      } else {
        const socket = getSocket(imei);
        if (socket) {
          const data = fields.join(",");
          // socket.write(buildCommand(imei, "L0", data));
          console.log(`[L0] ${imei} echoing challenge: L0,${data}`);
        }
      }
      break;
    }

    case "L1": {
      // L1 = unlock confirmation
      const status = fields[0];
      const token = fields[2] ?? "0";

      if (status === "1") {
        const state = upsertState(imei, { locked: false }); // L1 = unlocked
        console.log(`[L1] ${imei} unlocked ✓`);
        broadcast({ event: "unlocked", state });
      } else if (token === "0") {
        console.log(`[L1] ${imei} status broadcast (unlocked), ignoring`);
        upsertState(imei, { locked: false });
      } else {
        const socket = getSocket(imei);
        if (socket) {
          const data = fields.join(",");
          // socket.write(buildCommand(imei, "L1", data));
          console.log(`[L1] ${imei} echoing challenge: L1,${data}`);
        }
      }
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

    console.log(`[→ LOCK] ${imei} cmd=${cmd}`);
    console.log(`[→ LOCK] raw hex: ${buf.toString("hex")}`);
    console.log(
      `[→ LOCK] readable: ${buf.toString("ascii").replace(/\xFF/g, "<FF>")}`,
    );

    socket.write(buf.toString("hex"));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
