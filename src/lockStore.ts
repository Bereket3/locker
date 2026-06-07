import type { Socket } from "net";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LockLocation {
  lat: number;
  lon: number;
  speed: number;      // km/h
  heading: number;    // degrees 0–360
  satellites: number;
  updatedAt: string;  // ISO timestamp
}

export interface LockState {
  imei: string;
  locked: boolean;
  batteryVoltage: number;   // volts, e.g. 3.80
  signal: number;           // CSQ 0–31
  connectedAt: string;      // ISO timestamp
  lastSeenAt: string;       // ISO timestamp
  location: LockLocation | null;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

// Active TCP sockets: imei → Socket
const sockets = new Map<string, Socket>();

// Latest known state per lock
const states = new Map<string, LockState>();

// WebSocket broadcast subscribers (plain callback so we stay framework-agnostic)
type BroadcastFn = (data: unknown) => void;
const subscribers = new Set<BroadcastFn>();

// ─── Socket management ────────────────────────────────────────────────────────

export function registerSocket(imei: string, socket: Socket): void {
  sockets.set(imei, socket);
}

export function removeSocket(imei: string): void {
  sockets.delete(imei);
  states.delete(imei);
}

export function getSocket(imei: string): Socket | undefined {
  return sockets.get(imei);
}

export function connectedImeis(): string[] {
  return [...sockets.keys()];
}

// ─── State management ─────────────────────────────────────────────────────────

export function upsertState(imei: string, patch: Partial<LockState>): LockState {
  const existing = states.get(imei) ?? {
    imei,
    locked: true,
    batteryVoltage: 0,
    signal: 0,
    connectedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    location: null,
  };
  const next: LockState = { ...existing, ...patch, lastSeenAt: new Date().toISOString() };
  states.set(imei, next);
  return next;
}

export function getState(imei: string): LockState | undefined {
  return states.get(imei);
}

export function getAllStates(): LockState[] {
  return [...states.values()];
}

// ─── WebSocket pub/sub ────────────────────────────────────────────────────────

export function subscribe(fn: BroadcastFn): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);   // returns unsubscribe
}

export function broadcast(data: unknown): void {
  for (const fn of subscribers) {
    try { fn(data); } catch { /* dead subscriber */ }
  }
}
