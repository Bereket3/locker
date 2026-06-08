type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel = (() => {
  const v = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  return v in LEVEL_RANK ? v : "info";
})();

const COLORS: Record<LogLevel, string> = {
  debug: "\x1b[36m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const RESET = "\x1b[0m";

function emit(
  level: LogLevel,
  component: string,
  msg: string,
  meta?: Record<string, unknown>,
): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) return;

  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      component,
      msg,
      ...meta,
    };
    process.stderr.write(JSON.stringify(entry) + "\n");
  } else {
    const color = COLORS[level];
    const prefix = `${color}[${level.toUpperCase()}]${RESET} [${component}]`;
    const metaStr =
      meta && Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
    process.stderr.write(`${prefix} ${msg}${metaStr}\n`);
  }
}

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

function toMeta(val: unknown): Record<string, unknown> | undefined {
  if (val === undefined || val === null) return undefined;
  if (val instanceof Error) return { error: val.message, stack: val.stack };
  if (typeof val === "object") return val as Record<string, unknown>;
  return { detail: String(val) };
}

export function createLogger(component: string): Logger {
  return {
    debug: (msg, meta) => emit("debug", component, msg, toMeta(meta)),
    info: (msg, meta) => emit("info", component, msg, toMeta(meta)),
    warn: (msg, meta) => emit("warn", component, msg, toMeta(meta)),
    error: (msg, meta) => emit("error", component, msg, toMeta(meta)),
  };
}
