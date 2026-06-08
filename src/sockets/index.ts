import { Server } from "socket.io";
import { Server as HttpServer } from "http";
import { registerSocketHandlers } from "./handlers.js";
import { bridgeTcpToSocketIO } from "./emitter.js";
import { createLogger } from "../libs/logger.js";

const logger = createLogger("Socket.io-index");

let io: Server;

export function initSocket(server: HttpServer) {
  io = new Server(server, {
    path: "/ws/",
    serveClient: true,
    cors: { origin: "*" },
  });

  bridgeTcpToSocketIO();

  io.on("connection", (socket) => {
    logger.info("client connected:", socket.id);
    registerSocketHandlers(io, socket);
  });

  io.on("error", (err) => {
    logger.error("Socket error:", err);
  });

  return io;
}

export function getIO() {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
}
