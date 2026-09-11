// IndexedDB draft store — offline-tolerant entry (plan §11).
//
// Brokers frequently operate on-site at supplier markets where connectivity
// is unreliable. To prevent data loss when a booking/dispatch/payment can't
// be POSTed immediately, we persist the form payload to a local IndexedDB
// "drafts" store. A sync loop (`src/hooks/use-offline-sync.ts`) replays
// pending drafts to the server when the browser regains connectivity.
//
// Why raw IndexedDB (no `idb` package)?
//   - Avoids a runtime dependency for what is a tiny, single-object-store DB.
//   - The surface area we need (open + get/put/delete/count/getAll) maps
//     directly onto the IndexedDB request API.
//
// The DB is keyed by client-generated UUIDs (crypto.randomUUID) so drafts
// created offline can be referenced by id before they ever reach the server.

export type DraftType = "booking" | "visit" | "dispatch" | "payment";

export type DraftStatus = "pending" | "syncing" | "synced" | "failed";

export type Draft = {
  // Client-generated UUID (crypto.randomUUID) — stable identity across edits
  // and sync attempts. The server assigns its own id on successful insert;
  // we then delete the draft from IndexedDB.
  id: string;
  type: DraftType;
  // The API payload verbatim — what we'll POST to the matching endpoint
  // (e.g. /api/bookings, /api/dispatches, /api/payments). Stored as an
  // opaque record so the sync layer doesn't need to know the shape of every
  // draft type; the producing dialog is responsible for assembling the
  // correct payload.
  data: Record<string, unknown>;
  createdAt: string; // ISO timestamp — used for ordering + the queue UI.
  status: DraftStatus;
  // Last sync error message (set when status === "failed"). Surfaced in the
  // Draft Queue so the broker can decide whether to retry, edit, or discard.
  error?: string;
  // Monotonic per-draft retry counter — incremented on each failed sync
  // attempt. Used by the queue UI to show "retry 2×" context.
  retryCount: number;
};

const DB_NAME = "broker-os-drafts";
const DB_VERSION = 1;
const STORE_NAME = "drafts";

// Cache the opened DB promise so repeat callers (sync loop + UI reads) don't
// re-trigger the versionchange handshake. The promise resolves to an
// IDBDatabase; rejects if the user's browser blocks IndexedDB (private mode
// in some browsers) — callers should fall back to a no-op.
let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Opens (or creates) the "broker-os-drafts" database with a single "drafts"
 * object store. The store is keyed by `draft.id` (client-generated UUID).
 * Resolves to the live IDBDatabase handle. Caches the promise across calls.
 */
export function openDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB not available"));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // First-open init: create the drafts object store keyed by id. We
      // also create an index on `status` so the sync layer can pull only
      // pending drafts without scanning the whole store (cheap at this
      // scale, but keeps the door open for larger queues).
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open drafts DB"));
    req.onblocked = () => reject(new Error("Drafts DB open blocked by another tab"));
  });

  // If the DB is forcibly closed elsewhere (e.g. another tab upgrades the
  // version), drop the cached promise so the next call re-opens cleanly.
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

/** Wrap a single IDBRequest in a Promise, forwarding the request error. */
function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * Saves (or updates) a draft. Keyed by `draft.id` — call with the same id to
 * mutate an existing draft (e.g. transitioning status pending → syncing).
 * Reads-back nothing; callers should keep their own in-memory copy in sync.
 */
export async function saveDraft(draft: Draft): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  await reqToPromise(tx.objectStore(STORE_NAME).put(draft));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("tx aborted"));
  });
}

/**
 * Returns all drafts, sorted by createdAt ascending (oldest first). The sync
 * loop iterates this list and the Draft Queue view renders it newest-first
 * for the human; both call this single helper.
 */
export async function getAllDrafts(): Promise<Draft[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const all = await reqToPromise<Draft[]>(tx.objectStore(STORE_NAME).getAll());
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Deletes a draft after successful sync (or when the broker discards it).
 * Silent no-op if the id is missing — the queue UI doesn't care whether the
 * draft was already gone.
 */
export async function deleteDraft(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  await reqToPromise(tx.objectStore(STORE_NAME).delete(id));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("tx aborted"));
  });
}

/** Returns the total draft count (any status) — used for the sidebar badge. */
export async function getDraftCount(): Promise<number> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  return reqToPromise<number>(tx.objectStore(STORE_NAME).count());
}

/**
 * Returns the pending draft count — i.e. drafts that still need to sync.
 * Computed by filtering getAllDrafts rather than the status index, so we
 * only maintain one read path (simpler at this scale).
 */
export async function getPendingDraftCount(): Promise<number> {
  const all = await getAllDrafts().catch(() => [] as Draft[]);
  return all.filter((d) => d.status === "pending" || d.status === "failed" || d.status === "syncing").length;
}
