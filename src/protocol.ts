// ─── Omni Wire Protocol ───────────────────────────────────────────────────────
//
// Lock  → Server:  *CMDR,<code>,<imei>,<datetime>,<cmd>[,<data...>]#\n
// Server → Lock:   \xFF\xFF*CMDS,<code>,<imei>,000000000000,<cmd>[,<data>]#\n
//
// Command codes:
//   Q0  sign-in          (lock → server on connect)
//   H0  heartbeat        (lock → server, periodic)
//   D0  GPS position     (bidirectional: server requests, lock responds)
//   L0  unlock           (server → lock to unlock; lock → server to confirm)
//   L1  lock             (server → lock to lock;   lock → server to confirm)
//   S5  status request   (server → lock)

export type CmdCode = "Q0" | "H0" | "D0" | "L0" | "L1" | "S5" | string;

export interface ParsedPacket {
  raw: string;
  code: string; // device code, e.g. "OM"
  imei: string;
  time: string;
  cmd: CmdCode;
  fields: string[]; // everything after cmd
}

// ─── Parser ───────────────────────────────────────────────────────────────────

export function parsePacket(raw: string): ParsedPacket | null {
  // strip frame header (\xFF\xFF), leading/trailing whitespace, trailing #
  const cleaned = raw
    .replace(/^\xFF\xFF/, "")
    .trim()
    .replace(/#$/, "");

  if (!cleaned.startsWith("*CMDR,")) return null;

  // *CMDR,OM,863725031194523,230615103045,H0,1,380,24
  const body = cleaned.slice(6); // strip "*CMDR,"
  const parts = body.split(",");

  if (parts.length < 4) return null;

  const [code, imei, time, cmd, ...fields] = parts;

  return { raw, code, imei, time, cmd, fields };
}

// ─── Command builder ──────────────────────────────────────────────────────────

export function buildCommand(imei: string, cmd: CmdCode, data = ""): Buffer {
  const now = new Date();
  const ts = [
    String(now.getFullYear()).slice(2),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  const body = data
    ? `*CMDS,OM,${imei},${ts},${cmd},${data}#\n`
    : `*CMDS,OM,${imei},${ts},${cmd}#\n`;

  const prefix = Buffer.from([0xff, 0xff]);
  const rest = Buffer.from(body, "ascii");
  return Buffer.concat([prefix, rest]);
}

// ─── Parsed field helpers ─────────────────────────────────────────────────────

// H0 fields:  [locked, voltage_mv, csq]
// e.g. "1,380,24"  →  locked=true, battery=3.80V, signal=24
export function parseHeartbeat(fields: string[]) {
  return {
    locked: fields[0] === "1",
    batteryVoltage: parseInt(fields[1] ?? "0") / 100,
    signal: parseInt(fields[2] ?? "0"),
  };
}

// Q0 fields:  [csq, voltage_mv, locked]
export function parseSignIn(fields: string[]) {
  return {
    signal: parseInt(fields[0] ?? "0"),
    batteryVoltage: parseInt(fields[1] ?? "0") / 100,
    locked: fields[2] === "1",
  };
}

// D0 fields:  [lat, lon, speed, heading, satellites]
export function parseGps(fields: string[]) {
  return {
    lat: parseFloat(fields[0] ?? "0"),
    lon: parseFloat(fields[1] ?? "0"),
    speed: parseFloat(fields[2] ?? "0"),
    heading: parseFloat(fields[3] ?? "0"),
    satellites: parseInt(fields[4] ?? "0"),
  };
}

// signal quality label
export function signalLabel(csq: number): string {
  if (csq === 0 || csq === 99) return "none";
  if (csq < 10) return "weak";
  if (csq < 15) return "fair";
  if (csq < 20) return "good";
  return "excellent";
}
