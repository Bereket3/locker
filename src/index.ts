import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { startTcpServer } from "./tcpServer.js";
import { api } from "./routes.js";
import { Server as HttpServer } from "http";
import { initSocket } from "./sockets/index.js";

const app = new Hono();
app.use("*", logger());
app.use("*", cors());

app.route("/", api);

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

const server = serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.info(`Server is running on http://localhost:${info.port}`);
  },
);

const io = initSocket(server as HttpServer);
