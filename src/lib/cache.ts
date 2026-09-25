// ─────────────────────────────────────────────────────────────────────────────
// Simple in-memory cache for API responses.
//
// On Vercel serverless functions, this cache is per-instance (each cold start
// gets a fresh cache). But for warm instances handling rapid successive calls
// (e.g., dashboard loads → 5 API calls in 2 seconds), this avoids redundant
// DB queries.
//
// Cache key: `${brokerId}:${endpoint}:${queryKey}`
// Cache TTL: 60 seconds for dashboard, 5 minutes for reports.
// ─────────────────────────────────────────────────────────────────────────────

type CacheEntry<T> = {
  data: T;
  expires: number;
};

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Get a cached value. Returns null if not cached or expired.
 */
export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

/**
 * Set a cached value with a TTL in milliseconds.
 */
export function setCached<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

/**
 * Invalidate all cache entries for a specific broker.
 * Call this after any mutation (create/update/delete) to ensure stale data
 * isn't served from cache.
 */
export function invalidateBrokerCache(brokerId: string): void {
  const prefix = `${brokerId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Invalidate a specific cache key.
 */
export function invalidateKey(key: string): void {
  cache.delete(key);
}

// Standard TTLs
export const CACHE_TTL = {
  DASHBOARD: 60 * 1000,        // 1 minute — dashboard data changes on mutations
  REPORTS: 5 * 60 * 1000,      // 5 minutes — reports are computed, less time-sensitive
  COUNTS: 2 * 60 * 1000,       // 2 minutes — simple counts (clients, suppliers)
  LIGHTWEIGHT: 30 * 1000,      // 30 seconds — scheduler status, settings
} as const;
