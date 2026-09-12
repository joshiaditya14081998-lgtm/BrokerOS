/**
 * API route middleware helpers — currently just `withRateLimit()`.
 *
 * `withRateLimit(handler, limit?, windowMs?)` wraps a Next.js Route Handler
 * with an in-memory rate limit keyed by `${clientIp}:${path}`. When the limit
 * is exceeded the wrapper short-circuits with a 429 response:
 *
 *   { "error": "Rate limit exceeded. Try again in N seconds." }
 *
 * plus `Retry-After` + `X-RateLimit-*` headers (per IETF draft + de-facto
 * convention).
 *
 * Defaults: 100 req/min per IP per route — the same default the global
 * middleware uses, so routes that don't specify a stricter limit get the
 * same protection at the per-route level.
 *
 * Auth routes (login / signup / auto-confirm) typically pass a tighter 10/min.
 * Mutation endpoints (clients / bookings / payments) pass 20–30/min.
 *
 * NOTE: identifiers here are scoped to a single route (path), so a flood of
 * requests to `/api/clients` does NOT burn the quota for `/api/payments`.
 * The global middleware-level rate limiter (in `src/middleware.ts`) is the
 * backstop for "X total API requests per minute, any path".
 */

import { type NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

/** Next.js 16 Route Handler context shape — `params` is now a Promise. */
export type RouteContext = {
  params: Promise<Record<string, string | string[]>>;
};

export type RouteHandler = (
  req: NextRequest,
  ctx: RouteContext,
) => Promise<NextResponse> | NextResponse;

/**
 * Wrap a Route Handler with an in-memory rate limit.
 *
 * @param handler   The original handler to wrap.
 * @param limit     Max requests per window. Default 100.
 * @param windowMs  Window in ms. Default 60_000 (1 minute).
 */
export function withRateLimit(
  handler: RouteHandler,
  limit = 100,
  windowMs = 60_000,
): RouteHandler {
  return async (req, ctx) => {
    const ip = getClientIp(req);
    const path = req.nextUrl?.pathname ?? new URL(req.url).pathname;
    const identifier = `route:${ip}:${path}`;

    const result = rateLimit(identifier, limit, windowMs);

    if (!result.allowed) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((result.resetAt - Date.now()) / 1000),
      );
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${retryAfterSec} seconds.` },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSec),
            "X-RateLimit-Limit": String(limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.floor(result.resetAt / 1000)),
          },
        },
      );
    }

    // Successful path — invoke the real handler and tag the response with
    // rate-limit headers so clients can show a remaining-quota indicator.
    const response = await handler(req, ctx);
    response.headers.set("X-RateLimit-Limit", String(limit));
    response.headers.set("X-RateLimit-Remaining", String(result.remaining));
    response.headers.set("X-RateLimit-Reset", String(Math.floor(result.resetAt / 1000)));
    return response;
  };
}

/**
 * Resolve the client IP from the request, preferring the de-facto proxy
 * headers (Vercel + most CDNs set `x-forwarded-for`). Falls back to `req.ip`
 * (Next.js 13.4+ on Vercel — typed defensively since the @next/types stub
 * doesn't always include it) and finally to `"unknown"` so the rate limiter
 * still has *some* key to bucket on.
 */
function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0];
    if (first) return first.trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  // `req.ip` exists at runtime on Vercel but isn't in the @types stub for
  // all Next.js versions — access it via a typed cast so we still get a
  // sensible fallback without `any`.
  const directIp = (req as unknown as { ip?: string }).ip;
  return directIp ?? "unknown";
}
