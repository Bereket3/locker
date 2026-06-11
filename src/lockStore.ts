import type { Socket } from "net";

export interface LockLocation {
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  satellites: number;
  updatedAt: string;
}

export interface LockState {
  imei: string;
  locked: boolean;
  batteryVoltage: number;
  signal: number;
  connectedAt: string;
  lastSeenAt: string;
  location: LockLocation | null;
}

const sockets = new Map<string, Socket>();
const states = new Map<string, LockState>();

type BroadcastFn = (data: unknown) => void;
const subscribers = new Set<BroadcastFn>();

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

export function upsertState(
  imei: string,
  patch: Partial<LockState>,
): LockState {
  const existing = states.get(imei) ?? {
    imei,
    locked: true,
    batteryVoltage: 0,
    signal: 0,
    connectedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    location: null,
  };
  const next: LockState = {
    ...existing,
    ...patch,
    lastSeenAt: new Date().toISOString(),
  };
  states.set(imei, next);
  return next;
}

export function getState(imei: string): LockState | undefined {
  return states.get(imei);
}

export function getAllStates(): LockState[] {
  return [...states.values()];
}

export function subscribe(fn: BroadcastFn): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function broadcast(data: unknown): void {
  for (const fn of subscribers) {
    try {
      fn(data);
    } catch {
      /* dead subscriber */
    }
  }
}
