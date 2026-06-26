---
name: Qwebsocket-engineer
description: Use when building real-time communication systems with WebSockets or Socket.IO. Invoke for bidirectional messaging, horizontal scaling with Redis, presence tracking, room management.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: api-architecture
triggers: WebSocket, Socket.IO, real-time communication, bidirectional messaging, pub/sub, server push, live updates, chat systems, presence tracking
role: specialist
scope: implementation
output-format: code
related-skills: fastapi-expert, nestjs-expert, devops-engineer, monitoring-expert, security-reviewer
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# WebSocket Engineer

## Core Workflow

1. **Analyze requirements** — Identify connection scale, message volume, latency needs
2. **Design architecture** — Plan clustering, pub/sub, state management, failover
3. **Implement** — Build WebSocket server with authentication, rooms, events
4. **Validate locally** — Test connection handling, auth, and room behavior before scaling (e.g., `npx wscat -c ws://localhost:3000`); confirm auth rejection on missing/invalid tokens, room join/leave events, and message delivery
5. **Scale** — Verify Redis connection and pub/sub round-trip before enabling the adapter; configure sticky sessions and confirm with test connections across multiple instances; set up load balancing
6. **Monitor** — Track connections, latency, throughput, error rates; add alerts for connection-count spikes and error-rate thresholds

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Protocol | `references/protocol.md` | WebSocket handshake, frames, ping/pong, close codes |
| Scaling | `references/scaling.md` | Horizontal scaling, Redis pub/sub, sticky sessions |
| Patterns | `references/patterns.md` | Rooms, namespaces, broadcasting, acknowledgments |
| Security | `references/security.md` | Authentication, authorization, rate limiting, CORS |
| Alternatives | `references/alternatives.md` | SSE, long polling, when to choose WebSockets |

## Code Examples

### Server Setup (Socket.IO with Auth and Room Management)

```js
import { createServer } from "http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import jwt from "jsonwebtoken";

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: process.env.ALLOWED_ORIGIN, credentials: true },
  pingTimeout: 20000,
  pingInterval: 25000,
});

// Authentication middleware — runs before connection is established
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Authentication required"));
  try {
    socket.data.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error("Invalid token"));
  }
});

// Redis adapter for horizontal scaling
const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();
await Promise.all([pubClient.connect(), subClient.connect()]);
io.adapter(createAdapter(pubClient, subClient));

io.on("connection", (socket) => {
  const { userId } = socket.data.user;
  console.log(`connected: ${userId} (${socket.id})`);

  // Presence: mark user online
  pubClient.hSet("presence", userId, socket.id);

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    socket.to(roomId).emit("user-joined", { userId });
  });

  socket.on("message", ({ roomId, text }) => {
    io.to(roomId).emit("message", { userId, text, ts: Date.now() });
  });

  socket.on("disconnect", () => {
    pubClient.hDel("presence", userId);
    console.log(`disconnected: ${userId}`);
  });
});

httpServer.listen(3000);
```

### Client-Side Reconnection with Exponential Backoff

```js
import { io } from "socket.io-client";

const socket = io("wss://api.example.com", {
  auth: { token: getAuthToken() },
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,       // initial delay (ms)
  reconnectionDelayMax: 30000,   // cap at 30 s
  randomizationFactor: 0.5,      // jitter to avoid thundering herd
});

// Queue messages while disconnected
let messageQueue = [];

socket.on("connect", () => {
  console.log("connected:", socket.id);
  // Flush queued messages
  messageQueue.forEach((msg) => socket.emit("message", msg));
  messageQueue = [];
});

socket.on("disconnect", (reason) => {
  console.warn("disconnected:", reason);
  if (reason === "io server disconnect") socket.connect(); // manual reconnect
});

socket.on("connect_error", (err) => {
  console.error("connection error:", err.message);
});

function sendMessage(roomId, text) {
  const msg = { roomId, text };
  if (socket.connected) {
    socket.emit("message", msg);
  } else {
    messageQueue.push(msg); // buffer until reconnected
  }
}
```

## Code Patterns

### 1. Basic WebSocket Server with Connection Handling
```js
import { WebSocketServer } from "ws";
const wss = new WebSocketServer({ port: 8080 });
wss.on("connection", (ws) => {
  ws.on("message", (data) => wss.clients.forEach(c => c.send(data)));
  ws.on("close", () => console.log("client disconnected"));
});
```

### 2. Heartbeat/Ping-Pong Pattern
```js
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
ws.on("pong", () => { ws.isAlive = true; });
```

### 3. Room/Channel Broadcasting (Socket.IO)
```js
socket.on("subscribe", (room) => {
  socket.join(room);
  io.to(room).emit("joined", { user: socket.id });
});
socket.on("publish", (room, msg) => {
  io.to(room).emit("message", msg); // only room members receive
});
```

## Comment Template

```js
/**
 * Handles incoming message event
 * @event message
 * @param {Object} data - message payload { roomId, text, ts }
 * @emits message - broadcasts to all clients in room
 * @throws {Error} if roomId missing or not authorized
 */
socket.on("message", ({ roomId, text }) => {
  // validate and broadcast
});
```

## Lint Rules

- **eslint**: no-unused-vars, consistent-async-await
- **tsc --noEmit**: Enable for ws/@types/ws and socket.io type checking; catch missing event handlers and type mismatches
- Run `npm run lint:types` before committing WebSocket code

## Security Checklist

- [ ] **Origin validation**: `CORS` config restricts handshake to allowed domains
- [ ] **Auth on connection**: Token validation via `handshake.auth` or query params before emitting events
- [ ] **Rate limiting per connection**: Implement token bucket or sliding window per socket.id
- [ ] **Message size limits**: Set `maxPayload` in WebSocket config; reject oversized messages
- [ ] **TLS (wss://)**: Use secure WebSocket in production; set `secure: true` for Socket.IO over HTTPS
- [ ] **Input sanitization**: Validate/sanitize all message fields before storing or broadcasting

## Anti-patterns (Wrong vs. Correct)

| ❌ Wrong | ✅ Correct |
|---------|----------|
| No heartbeat; stale connections linger | Implement ping/pong every 30s; terminate isAlive === false |
| `io.emit()` broadcasts to all clients | Use `io.to(room).emit()` to scope by room/channel |
| Blocking event loop in handler (sync I/O) | Use `async/await`; query DB outside event handler |
| Client reconnects without backoff strategy | Exponential backoff + jitter in Socket.IO client config |
| Store all state in server memory | Use Redis for presence, rooms, and persistent data |

## Constraints

### MUST DO
- Use sticky sessions for load balancing (WebSocket connections are stateful — requests must route to the same server instance)
- Implement heartbeat/ping-pong to detect dead connections (TCP keepalive alone is insufficient)
- Use rooms/namespaces for message scoping rather than filtering in application logic
- Queue messages during disconnection windows to avoid silent data loss
- Plan connection limits per instance before scaling horizontally

### MUST NOT DO
- Store large state in memory without a clustering strategy (use Redis or an external store)
- Mix WebSocket and HTTP on the same port without explicit upgrade handling
- Forget to handle connection cleanup (presence records, room membership, in-flight timers)
- Skip load testing before production — connection-count spikes behave differently from HTTP traffic spikes

## Knowledge Reference

Socket.IO, ws, uWebSockets.js, Redis adapter, sticky sessions, nginx WebSocket proxy, JWT over WebSocket, rooms/namespaces, acknowledgments, binary data, compression, heartbeat, backpressure, horizontal pod autoscaling
