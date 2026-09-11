"use client";

// useOnlineStatus — SSR-safe browser online/offline detection.
//
// The Garment Broker OS runs on-site at supplier markets where connectivity
// drops frequently. This hook powers the header indicator + the global
// offline banner so the broker always knows whether their submits will go
// straight to the server or be queued in the local IndexedDB drafts store.
//
// SSR safety:
//   - On the server (no `window`), we return `true` so the first paint matches
//     the optimistic client render — preventing a hydration mismatch flash.
//   - On the client, the very first render also returns `true` (state init),
//     then a mount effect reads `navigator.onLine` + subscribes to the
//     `online` / `offline` window events and updates state if different.
//     The first-paint hydration stays stable; the indicator only flips after
//     mount if the browser is actually offline.
//
// Reconnection cascade:
//   - The companion `useOfflineSync()` hook (S4A) listens to the same `online`
//     event to kick its sync loop. We keep these two hooks decoupled — this
//     one only reports status; it doesn't trigger sync. The hook is cheap
//     enough (one event listener + a setState) that any number of components
//     can subscribe independently without inflating the listener count
//     meaningfully.

import * as React from "react";

export type OnlineStatus = {
  /** `true` when the browser reports `navigator.onLine === true`. */
  isOnline: boolean;
};

export function useOnlineStatus(): OnlineStatus {
  // Initialise to `true` so the server-rendered HTML matches the first client
  // render (no `navigator` on the server, and we want to avoid an offline
  // flash on first paint of any online session). The mount effect below
  // corrects the value if the browser is actually offline.
  const [isOnline, setIsOnline] = React.useState(true);

  React.useEffect(() => {
    // Defensive — older non-browser runtimes can lack `navigator`.
    const initial = typeof navigator !== "undefined" ? navigator.onLine : true;
    setIsOnline(initial);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return { isOnline };
}
