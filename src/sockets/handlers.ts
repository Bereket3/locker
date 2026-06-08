import { Server, Socket } from "socket.io";
import { createLogger } from "../libs/logger.js";
import { sendSnapshotToClient } from "./emitter.js";

const logger = createLogger("Socket.io-handler");

export function registerSocketHandlers(io: Server, socket: Socket) {
  sendSnapshotToClient(socket.id);

  socket.on("disconnect", () => {
    logger.info("Client disconnected:", socket.id);
  });

  socket.on("ping", () => {
    socket.emit("pong");
  });

  socket.on("snapshot", () => {
    sendSnapshotToClient(socket.id);
  });
}
