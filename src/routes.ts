import { Hono } from "hono";
import type { WSContext } from "hono/ws";
import {
  connectedImeis,
  getState,
  getAllStates,
  subscribe,
  getSocket,
} from "./lockStore.js";
import { sendCommand } from "./tcpServer.js";
import { signalLabel } from "./protocol.js";

export const api = new Hono();

// GET /locks — all connected locks + state
api.get("/locks", (c) => {
  const locks = getAllStates().map((s) => ({
    ...s,
    signalLabel: signalLabel(s.signal),
    connected: connectedImeis().includes(s.imei),
  }));
  return c.json({ locks });
});

// GET /locks/:imei — single lock state
api.get("/locks/:imei", (c) => {
  const { imei } = c.req.param();
  const state = getState(imei);
  if (!state) return c.json({ error: "Lock not found" }, 404);
  return c.json({ ...state, signalLabel: signalLabel(state.signal) });
});

// routes.ts — temporary debug endpoint
api.post("/locks/:imei/unlock/:variant", async (c) => {
  const { imei, variant } = c.req.param();
  const socket = getSocket(imei);
  if (!socket) return c.json({ error: "not connected" }, 503);

  const commands: Record<string, string> = {
    a: `\xFF\xFF*CMDS,OM,${imei},${getTimestamp()},L0,1#\n`,
    b: `\xFF\xFF*CMDS,OM,${imei},${getTimestamp()},L0,0,1#\n`,
    c: `\xFF\xFF*CMDS,OM,${imei},${getTimestamp()},L0,0000#\n`,
    d: `\xFF\xFF*CMDS,OM,${imei},${getTimestamp()},L0,1234#\n`,
    e: `\xFF\xFF*CMDS,OM,${imei},${getTimestamp()},L0,0,0,0#\n`,
  };

  const cmd = commands[variant];
  if (!cmd) return c.json({ error: "unknown variant" }, 400);

  const buf = Buffer.concat([
    Buffer.from([0xff, 0xff]),
    Buffer.from(cmd.slice(2), "ascii"),
  ]);
  socket.write(buf);
  console.log(
    `[DEBUG] sent variant ${variant}: ${cmd.replace(/\xFF/g, "<FF>")}`,
  );
  return c.json({ ok: true, sent: cmd });
});

function getTimestamp() {
  const n = new Date();
  return [
    String(n.getFullYear()).slice(2),
    String(n.getMonth() + 1).padStart(2, "0"),
    String(n.getDate()).padStart(2, "0"),
    String(n.getHours()).padStart(2, "0"),
    String(n.getMinutes()).padStart(2, "0"),
    String(n.getSeconds()).padStart(2, "0"),
  ].join("");
}

// routes.ts
api.post("/locks/:imei/unlock", (c) => {
  const { imei } = c.req.param();
  const result = sendCommand(imei, "L0");
  if (!result.ok) return c.json({ error: result.error }, 503);
  return c.json({ ok: true, message: `Unlock sent to ${imei}` });
});

api.post("/locks/:imei/lock", (c) => {
  const { imei } = c.req.param();
  const result = sendCommand(imei, "L0"); // L0 = lock
  if (!result.ok) return c.json({ error: result.error }, 503);
  return c.json({ ok: true, message: `Lock sent to ${imei}` });
});

// GET /locks/:imei/location — last known GPS
api.get("/locks/:imei/location", (c) => {
  const { imei } = c.req.param();
  const state = getState(imei);
  if (!state) return c.json({ error: "Lock not found" }, 404);
  if (!state.location) return c.json({ error: "No GPS fix yet" }, 404);
  return c.json(state.location);
});

// POST /locks/:imei/location — request fresh GPS from lock
api.post("/locks/:imei/location", (c) => {
  const { imei } = c.req.param();
  const state = getState(imei);
  const result = sendCommand(imei, "D0");
  if (!result.ok) return c.json({ error: result.error }, 503);
  return c.json({
    ok: true,
    cached: state?.location ?? null,
    message: "Fresh GPS requested — subscribe to /ws for the live response",
  });
});

// WebSocket factory — called from index.ts with the upgradeWebSocket helper
export function buildWsHandler(upgradeWebSocket: Function) {
  return upgradeWebSocket(() => ({
    onOpen(_evt: unknown, ws: WSContext) {
      console.log("[WS] Client connected");

      // send current snapshot
      ws.send(JSON.stringify({ event: "snapshot", locks: getAllStates() }));

      // subscribe to live lock events
      const unsub = subscribe((data) => {
        try {
          ws.send(JSON.stringify(data));
        } catch {
          /* client gone */
        }
      });

      // stash for cleanup
      (ws as any)._unsub = unsub;
    },
    onClose(_evt: unknown, ws: WSContext) {
      console.log("[WS] Client disconnected");
      (ws as any)._unsub?.();
    },
  }));
}
