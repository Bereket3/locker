# Bike Lock Server

A Hono + TypeScript server that manages OC32 smart bike locks.
Runs two servers side by side:

- **TCP :9679** — the lock connects here over its 4G SIM
- **HTTP :3000** — your mobile app calls this to unlock/lock/locate

---

## Project Structure

```
src/
├── index.ts       — entry point, starts both servers
├── routes.ts      — Hono HTTP + WebSocket endpoints
├── tcpServer.ts   — raw TCP server (talks to the lock)
├── protocol.ts    — packet parser + command builder
└── lockStore.ts   — in-memory state + WebSocket pub/sub
```

---

## Setup

```bash
npm install
npm run dev        # development with hot reload
npm run build      # compile to dist/
npm start          # run compiled output
```

---

## Pointing the Lock at Your Server

1. Install the **BleTool APK** (Omni provides this) on an Android phone
2. Stand next to the lock, enable Bluetooth
3. Open BleTool → connect to the lock
4. Go to **Set IP** → enter `YOUR_SERVER_IP:9679`
5. Save — the lock reboots and connects to your TCP server

> **Important:** Your server needs a **public static IP** and port 9679 open in
> the firewall. On a VPS: `ufw allow 9679/tcp && ufw allow 3000/tcp`

---

## HTTP API

### List all locks
```
GET /locks
```
```json
{
  "locks": [{
    "imei": "863725031194523",
    "locked": true,
    "batteryVoltage": 3.80,
    "signal": 18,
    "signalLabel": "good",
    "connectedAt": "2026-06-07T10:00:00.000Z",
    "lastSeenAt": "2026-06-07T10:05:00.000Z",
    "location": { "lat": 9.0250, "lon": 38.7469, "speed": 0, ... }
  }]
}
```

### Get one lock
```
GET /locks/:imei
```

### Unlock
```
POST /locks/:imei/unlock
```
Returns immediately. The lock physically opens and sends an `L0` confirmation
packet — you'll see it on the WebSocket.

### Lock
```
POST /locks/:imei/lock
```

### Last known location
```
GET /locks/:imei/location
```

### Request fresh GPS from lock
```
POST /locks/:imei/location
```
Returns cached location immediately and asks the lock to send a fresh `D0`
packet. Subscribe to `/ws` to receive the fresh reading.

---

## WebSocket `/ws`

Connect to `ws://your-server:3000/ws` to receive all lock events in real time.

**On connect** you immediately receive a snapshot:
```json
{ "event": "snapshot", "locks": [ ...all current states... ] }
```

**Ongoing events:**
```json
{ "event": "connected",     "state": { ...LockState } }
{ "event": "heartbeat",     "state": { ...LockState } }
{ "event": "location",      "imei": "...", "location": { "lat": 9.02, "lon": 38.74, ... } }
{ "event": "unlocked",      "state": { ...LockState } }
{ "event": "locked",        "state": { ...LockState } }
{ "event": "disconnected",  "imei": "..." }
```

**Mobile app example:**
```typescript
const ws = new WebSocket("ws://your-server:3000/ws");

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);

  if (msg.event === "location" && msg.imei === targetImei) {
    map.updateMarker(msg.location.lat, msg.location.lon);
  }

  if (msg.event === "unlocked") {
    showToast("Bike unlocked!");
  }
};
```

---

## Protocol Reference

The lock speaks a plain TCP text protocol:

```
Lock  → Server:  *CMDR,OM,<imei>,<datetime>,<cmd>[,fields...]#\n
Server → Lock:   \xFF\xFF*CMDS,OM,<imei>,000000000000,<cmd>#\n
```

| Code | Direction | Meaning |
|------|-----------|---------|
| Q0 | Lock → Server | Sign-in on boot |
| H0 | Lock → Server | Heartbeat (every ~30s) |
| D0 | Both | GPS position |
| L0 | Both | Unlock command / confirmation |
| L1 | Both | Lock command / confirmation |
| S5 | Server → Lock | Request status |

---

## Diagnosing Connection Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Blue LED off | No SIM / no signal | Check SIM inserted, check coverage |
| Q0 never arrives | Wrong IP in lock or firewall | Recheck BleTool IP setting, open port 9679 |
| signal = 0 or 99 | SIM not registered on network | Check APN settings with Omni |
| Location always null | No GPS satellite lock | Move bike outdoors, wait ~60s |
