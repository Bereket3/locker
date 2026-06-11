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

export function buildCommand(
  imei: string,
  cmd: string,
  data = "",
  isReply = false,
): Buffer {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  const timeStr = `${yy}${mo}${dd}${hh}${mm}${ss}`;

  // 2. Format ACKs properly (Re goes into the command column)
  const commandCode = isReply ? `Re,${cmd}` : cmd;

  // 3. Append data if present
  const dataStr = data ? `,${data}` : "";

  // 4. Construct with exact column alignment
  const body = `*CMDS,OM,${imei},${timeStr},${commandCode}${dataStr}#\n`;

  return Buffer.from(body, "ascii");
}

// ─── Fixed GPS Field Helper ───────────────────────────────────────────────────
export function parseGps(fields: string[]) {
  const isValid = fields[2] === "A";
  return {
    lat: isValid ? parseFloat(fields[3] ?? "0") : 0,
    lon: isValid ? parseFloat(fields[5] ?? "0") : 0,
    speed: parseFloat(fields[7] ?? "0") || 0,
    heading: parseFloat(fields[8] ?? "0") || 0,
    satellites: parseInt(fields[6] ?? "0") || 0,
  };
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
  if (fields.length === 1) {
    const voltage_mv = parseInt(fields[0]);
    return {
      signal: 0,
      batteryVoltage: voltage_mv / 100,
      locked: false,
    };
  }
  return {
    signal: parseInt(fields[0] ?? "0"),
    batteryVoltage: parseInt(fields[1] ?? "0") / 100,
    locked: fields[2] !== "0",
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
