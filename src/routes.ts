import { Hono } from "hono";
import { connectedImeis, getState, getAllStates } from "./lockStore.js";
import { sendCommand } from "./tcpServer.js";
import { signalLabel } from "./protocol.js";

export const api = new Hono();

api.get("/locks", (c) => {
  const locks = getAllStates().map((s) => ({
    ...s,
    signalLabel: signalLabel(s.signal),
    connected: connectedImeis().includes(s.imei),
  }));
  return c.json({ locks });
});

api.get("/locks/:imei", (c) => {
  const { imei } = c.req.param();
  const state = getState(imei);
  if (!state) return c.json({ error: "Lock not found" }, 404);
  return c.json({ ...state, signalLabel: signalLabel(state.signal) });
});

api.post("/locks/:imei/unlock", (c) => {
  const { imei } = c.req.param();

  const result = sendCommand(imei, "L0", "0,0,0");

  if (!result.ok) return c.json({ error: result.error }, 503);

  return c.json({
    ok: true,
    message: `Active Unlock command (L0) sent to ${imei}`,
  });
});

api.post("/locks/:imei/lock", (c) => {
  const { imei } = c.req.param();

  const result = sendCommand(imei, "L1");

  if (!result.ok) return c.json({ error: result.error }, 503);
  return c.json({ ok: true, message: `Active Lock command sent to ${imei}` });
});

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
