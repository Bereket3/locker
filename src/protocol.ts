export type CmdCode = "Q0" | "H0" | "D0" | "L0" | "L1" | "S5" | string;

export interface ParsedPacket {
  raw: string;
  code: string;
  imei: string;
  time: string;
  cmd: CmdCode;
  fields: string[];
}

export function parsePacket(raw: string): ParsedPacket | null {
  const cleaned = raw
    .replace(/^\xFF\xFF/, "")
    .trim()
    .replace(/#$/, "");

  if (!cleaned.startsWith("*CMDR,")) return null;

  const body = cleaned.slice(6);
  const parts = body.split(",");

  if (parts.length < 4) return null;

  const [code, imei, time, cmd, ...fields] = parts;

  return { raw, code, imei, time, cmd, fields };
}

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

  const commandCode = isReply ? `Re,${cmd}` : cmd;

  let finalData = data;
  if (cmd === "L0" && (data === "0,0,0" || data.endsWith(",0"))) {
    const currentUnixTimestamp = Math.floor(now.getTime() / 1000);
    finalData = `0,0xl,${currentUnixTimestamp}`;
  }

  const dataStr = finalData ? `,${finalData}` : "";

  const body = `*CMDS,OM,${imei},${timeStr},${commandCode}${dataStr}#\n`;
  const bodyBuffer = Buffer.from(body, "ascii");

  const preamble = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

  return Buffer.concat([preamble, bodyBuffer]);
}

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

export function parseHeartbeat(fields: string[]) {
  return {
    locked: fields[0] === "1",
    batteryVoltage: parseInt(fields[1] ?? "0") / 100,
    signal: parseInt(fields[2] ?? "0"),
  };
}

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

export function signalLabel(csq: number): string {
  if (csq === 0 || csq === 99) return "none";
  if (csq < 10) return "weak";
  if (csq < 15) return "fair";
  if (csq < 20) return "good";
  return "excellent";
}
