/**
 * In-memory rate limiter (Map-based, sliding window per identifier).
 *
 * Used by:
 *   - `src/middleware.ts` — global API rate limit (100 req/min/IP for non-auth,
 *     non-webhook API routes).
 *   - `src/lib/api-middleware.ts` `withRateLimit()` — per-route stricter limits
 *     (e.g. 10/min for auth routes, 20/min for payments, 30/min for clients).
 *
 * Pros: zero external dependencies, instant, works in both Edge + Node runtimes.
 * Cons: per-instance state — limits are per server (or per serverless instance),
 *   not globally distributed. For beta launch this is acceptable; for production
 *   at scale, swap this module's `rateLimit` body with `@upstash/ratelimit` so
 *   every Vercel serverless instance shares the same counters via Upstash Redis.
 *
 * @upstash/ratelimit + @upstash/redis are already installed as dependencies
 * (Task SEC1) so the production swap is a 1-file change with no new install.
 */

type Bucket = { count: number; resetTime: number };

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

// Per-identifier bucket. Identifier is typically `${ip}:${path}` or `${ip}:api`.
const buckets = new Map<string, Bucket>();

/**
 * Returns `allowed: false` once the bucket exceeds `limit` calls within the
 * last `windowMs`. Resets the bucket when the window elapses.
 *
 * @param identifier Stable key (IP + path, or IP + scope).
 * @param limit     Max calls allowed in the window.
 * @param windowMs  Window length in ms (default 60_000 = 1 minute).
 */
export function rateLimit(
  identifier: string,
  limit = 50,
  windowMs = 60_000,
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(identifier);

  // No bucket yet, or window has expired → start a fresh bucket.
  if (!bucket || now > bucket.resetTime) {
    const resetAt = now + windowMs;
    buckets.set(identifier, { count: 1, resetTime: resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  bucket.count++;
  if (bucket.count > limit) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetTime };
  }

  return { allowed: true, remaining: limit - bucket.count, resetAt: bucket.resetTime };
}

// Garbage-collect expired buckets every 5 minutes so the Map doesn't grow
// unboundedly over a long-running server process. New buckets are created on
// demand, so deleting an expired entry just means the next request starts a
// fresh window — which is exactly what we want.
if (typeof setInterval === "function") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now > bucket.resetTime) buckets.delete(key);
    }
  }, 300_000).unref?.();
}
