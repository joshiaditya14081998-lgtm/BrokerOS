/**
 * notify-service — Garment Broker OS real-time notification relay.
 *
 * This is a lightweight socket.io server that polls the main Next.js app's
 * `/api/notifications` endpoint every 30 seconds and pushes updates to all
 * connected browser clients. The mini-service does NOT touch the DB directly —
 * it always reads through the main app's REST API so all business rules stay
 * in one place.
 *
 * Connection contract (CRITICAL — do not change):
 *   - Path MUST be "/" so the Caddy gateway can route by XTransformPort query.
 *   - Frontend connects via `io("/?XTransformPort=3003")` (never a direct URL).
 *
 * Events emitted to clients:
 *   - `notification-count` { count, timestamp } — pushed when pending count changes.
 *   - `new-notification`   { id, type, title, message, dueDate } — pushed once per new pending notification.
 */

import { createServer } from "http";
import { Server } from "socket.io";

const httpServer = createServer();
const io = new Server(httpServer, {
  // DO NOT change the path — it is used by Caddy to forward the request to the correct port.
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const MAIN_APP = "http://localhost:3000";
const POLL_INTERVAL_MS = 30_000;

let lastCount = -1;
let lastSeenIds = new Set<string>();

interface NotificationDTO {
  id: string;
  type: string;
  title: string;
  message: string | null;
  dueDate: string;
  status: string;
}

async function pollNotifications() {
  try {
    const res = await fetch(`${MAIN_APP}/api/notifications`);
    if (!res.ok) return;
    const data = (await res.json()) as { notifications?: NotificationDTO[] };
    const notifications = data.notifications ?? [];
    const pending = notifications.filter((n) => n.status === "pending");

    const count = pending.length;
    if (count !== lastCount) {
      io.emit("notification-count", {
        count,
        timestamp: new Date().toISOString(),
      });
      lastCount = count;
    }

    // Detect brand-new pending notifications (IDs we haven't seen before).
    const currentIds = new Set(pending.map((n) => n.id));
    for (const n of pending) {
      if (!lastSeenIds.has(n.id)) {
        io.emit("new-notification", {
          id: n.id,
          type: n.type,
          title: n.title,
          message: n.message,
          dueDate: n.dueDate,
        });
      }
    }
    lastSeenIds = currentIds;
  } catch (_e) {
    // Main app might be starting up or briefly unreachable — silently retry on next tick.
  }
}

io.on("connection", (socket) => {
  console.log(`[notify-service] Client connected: ${socket.id}`);
  // Send current count immediately so the badge isn't blank on first load.
  pollNotifications();
  socket.on("disconnect", (reason) => {
    console.log(`[notify-service] Client disconnected: ${socket.id} (${reason})`);
  });
  socket.on("error", (err) => {
    console.error(`[notify-service] Socket error (${socket.id}):`, err);
  });
});

// Poll every 30 seconds.
setInterval(pollNotifications, POLL_INTERVAL_MS);
// Initial poll on boot.
pollNotifications();

const PORT = 3003;
httpServer.listen(PORT, () => {
  console.log(`[notify-service] Running on port ${PORT} (polling ${MAIN_APP}/api/notifications every 30s)`);
});

// Graceful shutdown.
function shutdown(signal: string) {
  console.log(`[notify-service] Received ${signal}, shutting down…`);
  io.close(() => {
    httpServer.close(() => {
      console.log("[notify-service] Closed");
      process.exit(0);
    });
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
