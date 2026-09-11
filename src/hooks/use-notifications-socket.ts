"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

export interface LiveNotification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  dueDate?: string;
}

/**
 * useNotificationsSocket — establishes a single socket.io connection to the
 * notify-service mini-service (port 3003 via the Caddy gateway) and surfaces:
 *
 *   - `count`            : live pending-notification count (null until first push).
 *   - `connected`        : true while the socket is open.
 *   - `lastNotification` : the most recent `new-notification` payload received.
 *
 * Connection contract (CRITICAL — do not change):
 *   - Always use the relative path "/" and pass the port via `XTransformPort`.
 *   - NEVER connect via `io("http://localhost:3003")` — that bypasses the
 *     Caddy gateway and fails in the sandbox.
 */
export function useNotificationsSocket() {
  const [count, setCount] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastNotification, setLastNotification] = useState<LiveNotification | null>(null);

  useEffect(() => {
    const socket: Socket = io("/?XTransformPort=3003", {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      timeout: 10000,
    });

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("notification-count", (data: { count: number }) => setCount(data.count));
    socket.on("new-notification", (data: LiveNotification) => setLastNotification(data));

    return () => {
      socket.disconnect();
    };
  }, []);

  return { count, connected, lastNotification };
}
