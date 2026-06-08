import { getAllStates } from "../lockStore.js";
import { getIO } from "./index.js";
import { subscribe } from "../lockStore.js";

export function bridgeTcpToSocketIO() {
  subscribe((data) => {
    const io = getIO();
    io.emit("lockEvent", data);
  });
}

export function sendSnapshotToClient(socketId: string) {
  const io = getIO();
  io.to(socketId).emit("snapshot", {
    locks: getAllStates(),
  });
}
