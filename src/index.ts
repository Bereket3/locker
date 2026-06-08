import { serve, upgradeWebSocket } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { startTcpServer } from "./tcpServer.js";
import { api, buildWsHandler } from "./routes.js";

const HTTP_PORT = 3000;

const app = new Hono();
app.use("*", logger());
app.use("*", cors());

app.route("/", api);

// wire up WebSocket route here so upgradeWebSocket is in scope
app.get("/ws", buildWsHandler(upgradeWebSocket));

app.get("/", (c) =>
  c.json({
    service: "Bike Lock Server",
    status: "running",
    endpoints: [
      "GET  /locks",
      "GET  /locks/:imei",
      "POST /locks/:imei/unlock",
      "POST /locks/:imei/lock",
      "GET  /locks/:imei/location",
      "POST /locks/:imei/location",
      "WS   /ws",
    ],
  }),
);

startTcpServer();

serve({ fetch: app.fetch, port: HTTP_PORT }, (info) => {
  console.log(`[HTTP] API running on http://localhost:${info.port}`);
});
