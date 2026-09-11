"use client";

// useOfflineSync — production offline-draft sync hook (Sprint 4 / S4A).
//
// Owns the offline draft-save sync loop and the in-memory snapshot of the
// IndexedDB draft queue. The hook mounts in:
//   - the page header (pending-count badge + sync indicator),
//   - the Settings Network Status card (last-sync timestamp + sync-now),
//   - the Draft Queue view (full list + retry + discard + status badges).
//
// Public surface (consumers in `src/app/page.tsx` + the Draft Queue view rely
// on these exact field names — preserve across edits):
//   pendingCount : number               — drafts still needing sync.
//   syncing      : boolean              — true while a sync pass is in-flight.
//   lastSync     : Date | null          — last successful sync timestamp.
//   drafts       : Draft[]              — full queue, newest-first.
//   syncNow()    : Promise<SyncResult>  — kick a sync pass (manual button).
//   discard(id)  : Promise<void>        — drop a draft without retrying.
//   retryDraft(id): Promise<void>       — flip a failed draft back to pending
//                                          and re-run the sync loop.
//   lastSyncError: string | null        — first error message from the last
//                                          pass (null when fully clean).
//
// Auto-sync: when the browser fires the "online" event, we debounce 3
// seconds (early-reconnect connectivity is often flaky) and then trigger a
// sync pass — so the broker rarely has to click "Sync now" themselves.
//
// Auth: every fetch is same-origin, so the Supabase auth cookie (set by
// Sprint 2's middleware) is automatically attached. A 401 stops the loop
// and surfaces the error so the UI can prompt re-auth.
//
// Concurrency: a module-level `globalSyncing` flag + a per-instance
// `syncingRef` guard together prevent two consumers (page header auto-sync
// + a manual "Sync now" click) from racing the same queue.

import * as React from "react";
import {
  getAllDrafts,
  saveDraft,
  deleteDraft,
  type Draft,
  type DraftType,
} from "@/lib/offline-db";

// localStorage key for the last successful sync timestamp. We persist this
// in localStorage (not IndexedDB) so the Settings "Last sync" label can
// hydrate synchronously on first render — no flicker waiting for the IDB
// read.
const LAST_SYNC_KEY = "broker-os:last-sync";

// Module-level guard preventing two `useOfflineSync` consumers (e.g. the
// page header auto-sync + a manual "Sync now" click from the Draft Queue
// view) from running concurrent sync passes against the same queue.
let globalSyncing = false;

// Maps each draft type to the API endpoint the sync loop POSTs to.
const ENDPOINT_BY_TYPE: Record<DraftType, string> = {
  booking: "/api/bookings",
  visit: "/api/visits",
  dispatch: "/api/dispatches",
  payment: "/api/payments",
};

export type SyncResult = {
  synced: number;
  failed: number;
  authRequired: boolean;
  error?: string;
};

export type OfflineSyncState = {
  /** Drafts that are still `pending`, `syncing`, or `failed` — i.e. unsynced. */
  pendingCount: number;
  /** `true` while a sync pass is in-flight (used for the "Syncing…" spinner). */
  syncing: boolean;
  /** Timestamp of the last successful sync pass (null if never synced). */
  lastSync: Date | null;
  /** Full queue, newest-first (Draft Queue view renders this list). */
  drafts: Draft[];
  /** Kick a sync pass immediately (manual "Sync now" button). */
  syncNow: () => Promise<SyncResult>;
  /** Drop a draft from the queue without retrying (broker discards it). */
  discard: (id: string) => Promise<void>;
  /** Reset a failed draft back to `pending` and re-run the sync loop. */
  retryDraft: (id: string) => Promise<void>;
  /** First error message from the last pass; null when fully clean. */
  lastSyncError: string | null;
};

function readLastSync(): Date | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(LAST_SYNC_KEY);
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t) : null;
}

function writeLastSync(d: Date) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LAST_SYNC_KEY, d.toISOString());
  } catch {
    // Storage may be unavailable (private mode / quota) — non-fatal.
  }
}

/**
 * Attempt to sync a single draft to its matching API endpoint. Mutates the
 * draft's status through the lifecycle:
 *   pending → syncing → (success: deleteDraft) | (failure: failed + retryCount++)
 *
 * A 401 is special-cased: the function rethrows a sentinel error so the
 * caller can stop the loop without marking the draft as failed (the user
 * just needs to log in, then we'll retry).
 */
async function syncOne(draft: Draft): Promise<boolean> {
  // Mark as syncing in the store + persist so a re-render mid-sync shows
  // the teal "Syncing" badge.
  await saveDraft({ ...draft, status: "syncing", error: undefined });

  const endpoint = ENDPOINT_BY_TYPE[draft.type];
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft.data),
      credentials: "same-origin",
    });
  } catch (e) {
    // Network error (still offline, DNS failure, etc.) — keep the draft
    // and mark as failed so the user sees the rose badge + can retry.
    await saveDraft({
      ...draft,
      status: "failed",
      error: e instanceof Error ? e.message : "Network error",
      retryCount: draft.retryCount + 1,
    });
    return false;
  }

  if (res.status === 401) {
    // Auth required — rethrow a typed sentinel so the loop stops. Don't
    // mark the draft as failed; leave it pending so the next successful
    // login can retry.
    await saveDraft({ ...draft, status: "pending" });
    const err = new Error("Authentication required (401)") as Error & {
      authRequired?: boolean;
    };
    err.authRequired = true;
    throw err;
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const message = `API ${endpoint} → ${res.status}${txt ? `: ${txt.slice(0, 160)}` : ""}`;
    await saveDraft({
      ...draft,
      status: "failed",
      error: message,
      retryCount: draft.retryCount + 1,
    });
    return false;
  }

  // Success — delete the draft from IndexedDB. The server is now the source
  // of truth for this record.
  await deleteDraft(draft.id);
  return true;
}

export function useOfflineSync(): OfflineSyncState {
  const [drafts, setDrafts] = React.useState<Draft[]>([]);
  const [pendingCount, setPendingCount] = React.useState(0);
  const [syncing, setSyncing] = React.useState(false);
  const [lastSync, setLastSync] = React.useState<Date | null>(null);
  const [lastSyncError, setLastSyncError] = React.useState<string | null>(null);
  const syncingRef = React.useRef(false);

  // Initial hydration: pull drafts + pending count from IndexedDB + read the
  // last-sync timestamp from localStorage. Runs once on mount.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await getAllDrafts();
        if (cancelled) return;
        // `getAllDrafts` returns oldest-first; the queue UI shows newest-first.
        setDrafts([...all].reverse());
        const pending = all.filter(
          (d) => d.status === "pending" || d.status === "failed" || d.status === "syncing",
        ).length;
        setPendingCount(pending);
      } catch {
        // IndexedDB may be unavailable (private mode). Fail silently — the
        // UI just renders an empty queue, which is correct for a no-op
        // session.
        if (!cancelled) {
          setDrafts([]);
          setPendingCount(0);
        }
      }
      if (!cancelled) setLastSync(readLastSync());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh the in-memory snapshot from IndexedDB. Called after every sync
  // pass + after a draft is discarded. Cheap (single getAll) and keeps the
  // UI's two state atoms coherent with the source of truth.
  const refresh = React.useCallback(async () => {
    try {
      const all = await getAllDrafts();
      setDrafts([...all].reverse());
      const pending = all.filter(
        (d) => d.status === "pending" || d.status === "failed" || d.status === "syncing",
      ).length;
      setPendingCount(pending);
    } catch {
      setDrafts([]);
      setPendingCount(0);
    }
  }, []);

  // Single sync pass: iterate every pending/failed draft, POST its payload
  // to the matching endpoint, delete on success, mark `failed` on error.
  // The first sync attempt also transitions `pending` → `syncing` so the
  // queue UI reflects in-flight work.
  const syncNow = React.useCallback(async (): Promise<SyncResult> => {
    if (globalSyncing || syncingRef.current) {
      return { synced: 0, failed: 0, authRequired: false };
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setLastSyncError("Offline — can't sync right now");
      return { synced: 0, failed: 0, authRequired: false };
    }
    globalSyncing = true;
    syncingRef.current = true;
    setSyncing(true);
    setLastSyncError(null);

    let synced = 0;
    let failed = 0;
    let authRequired = false;
    let firstError: string | undefined;

    try {
      const all = await getAllDrafts().catch(() => [] as Draft[]);
      const queue = all.filter((d) => d.status === "pending");
      for (const draft of queue) {
        try {
          const ok = await syncOne(draft);
          if (ok) synced += 1;
          else {
            failed += 1;
            if (!firstError) firstError = "Some drafts failed to sync";
          }
        } catch (e) {
          const err = e as Error & { authRequired?: boolean };
          if (err.authRequired) {
            authRequired = true;
            firstError = "Authentication required — please log in to sync drafts";
            break;
          }
          failed += 1;
          if (!firstError) firstError = err.message;
        }
      }
      if (synced > 0) {
        const stamp = new Date();
        writeLastSync(stamp);
        setLastSync(stamp);
      }
    } finally {
      globalSyncing = false;
      syncingRef.current = false;
      setSyncing(false);
      if (firstError) setLastSyncError(firstError);
      await refresh();
    }

    return { synced, failed, authRequired, error: firstError };
  }, [refresh]);

  // Discard a draft — drops it from IndexedDB without attempting sync.
  const discard = React.useCallback(
    async (id: string) => {
      await deleteDraft(id).catch(() => undefined);
      await refresh();
    },
    [refresh],
  );

  // Manual single-draft retry — flips a `failed` draft back to `pending`
  // and immediately runs a sync pass for just that id (syncNow iterates all
  // pending drafts so this naturally picks up the reset one).
  const retryDraft = React.useCallback(
    async (id: string) => {
      const all = await getAllDrafts().catch(() => [] as Draft[]);
      const draft = all.find((d) => d.id === id);
      if (!draft) return;
      await saveDraft({ ...draft, status: "pending", error: undefined });
      await refresh();
      await syncNow();
    },
    [refresh, syncNow],
  );

  // Auto-sync when the browser comes back online. We debounce 3 seconds —
  // early-reconnect connectivity is often flaky and a premature attempt
  // would just mark drafts as failed and require manual retry.
  React.useEffect(() => {
    const handleOnline = () => {
      void refresh();
      setTimeout(() => {
        void syncNow();
      }, 3000);
    };
    const handleOffline = () => {
      void refresh();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refresh, syncNow]);

  return {
    pendingCount,
    syncing,
    lastSync,
    drafts,
    syncNow,
    discard,
    retryDraft,
    lastSyncError,
  };
}

/**
 * Lightweight read-only hook for the sidebar's Draft Queue badge. Subscribes
 * to the IndexedDB pending-draft count + online/offline status WITHOUT
 * triggering the sync loop (so mounting the sidebar doesn't auto-sync).
 *
 * The sidebar polls every 30 seconds (cheap — IndexedDB count() on a small
 * store is sub-millisecond) and refreshes immediately on online/offline
 * transitions so a reconnect visibly clears the badge once a sync completes.
 *
 * This is a separate hook (rather than reusing `useOfflineSync`) because the
 * sidebar mounts at app shell level — we don't want a sync attempt every
 * time the broker opens the app, only when they navigate to the Draft Queue
 * view (which mounts the full hook).
 */
export function useDraftPendingCount(): { count: number; isOnline: boolean } {
  const [count, setCount] = React.useState(0);
  const [isOnline, setIsOnline] = React.useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  React.useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const all = await getAllDrafts();
        if (cancelled) return;
        const pending = all.filter(
          (d) => d.status === "pending" || d.status === "failed" || d.status === "syncing",
        ).length;
        setCount(pending);
      } catch {
        if (!cancelled) setCount(0);
      }
    };
    void read();
    // Poll every 30 seconds — cheap and keeps the badge fresh even without
    // a connectivity event to nudge us.
    const id = window.setInterval(() => void read(), 30_000);

    const onOnline = () => {
      setIsOnline(true);
      // Slight delay so a just-completed sync pass has had time to delete
      // its drafts before we re-read the count.
      setTimeout(() => void read(), 1500);
    };
    const onOffline = () => {
      setIsOnline(false);
      void read();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return { count, isOnline };
}
