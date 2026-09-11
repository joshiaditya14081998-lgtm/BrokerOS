import { type NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Middleware — runs on every request.
 * 1. Refreshes the Supabase auth session (updates access token cookie if expired).
 * 2. Protects app routes — redirects to the right login page if no session:
 *    - `/admin/login`     → public (super admin login page).
 *    - `/admin/*`         → protected (middleware enforces session; super-admin
 *                          check is in the API/page handler). No session → /admin/login.
 *    - `/portal/*` routes (the client/supplier portal) → `/portal/login`.
 *    - `/` (broker dashboard root) → `/landing` (the marketing page) so visitors
 *      land on the SaaS pitch first; the landing page CTAs handle the
 *      signup/login flow. All other broker-protected routes still go to `/login`.
 *    - All other protected routes (the broker app) → `/login`.
 * 3. Public routes — no auth required:
 *    - `/landing`                   — public marketing page (always).
 *    - `/login`, `/signup`          — broker login/signup.
 *    - `/admin/login`               — super admin login.
 *    - `/portal/login`              — portal login (clients + suppliers).
 *    - `/api/auth/*`, `/api/auth/callback` — auth API.
 *    - `/api/admin/*`               — admin API (auth checked by the route handler
 *                                      via getCurrentSuperAdmin; returns 403 if not).
 *    - Static assets (`/_next`, `/uploads`, `/logo.svg`, `/favicon.ico`).
 * 4. If authenticated and on a login page, redirects to the matching dashboard:
 *    - `/login` or `/signup` → `/` (broker dashboard).
 *    - `/admin/login`        → `/admin` (super admin panel).
 *    - `/portal/login`      → `/portal`.
 *    - `/landing`           — STAYS public even when authed (the landing page
 *                              itself swaps its CTA to "Go to Dashboard" if
 *                              the visitor is logged in, so we let it through).
 *
 * `/api/portal/*` + `/api/admin/*` API routes: middleware passes through;
 * each route handler checks auth itself.
 *
 * ─── Security hardening (Task SEC1) ──────────────────────────────────────────
 * A. Global API rate limit — 100 req/min per IP on every `/api/*` route EXCEPT
 *    `/api/auth/*` (auth routes carry their own tighter limits, see
 *    `src/lib/api-middleware.ts`) and `/api/webhooks/*` (external callers —
 *    Stripe — verify their own signatures and don't deserve a per-IP cap).
 *    Exceeded → 429 with `Retry-After` header.
 * B. Security headers on every response — defense-in-depth against XSS,
 *    clickjacking, MIME-sniffing, and overly-permissive referrer / device
 *    APIs. CSP is a permissive-but-real baseline (allows Next.js inline +
 *    eval in dev, Supabase connect-src). Tighten the script-src once a nonce
 *    strategy is in place.
 */

/**
 * Security headers applied to every response. These are defense-in-depth and
 * work even on legacy browsers (X-XSS-Protection) alongside modern ones (CSP).
 *
 * CSP note: `unsafe-inline` + `unsafe-eval` on `script-src` are needed for
 * Next.js dev mode (HMR + fast refresh injects inline scripts). In production
 * on Vercel this is still acceptable for v1; the next hardening pass should
 * swap them for a per-request nonce.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  ].join("; "),
};

/** Apply the security headers to any NextResponse (mutates in place). */
function addSecurityHeaders(res: NextResponse): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    // Only set if not already set — let route handlers override if they need to.
    if (!res.headers.has(key)) res.headers.set(key, value);
  }
}

/** Resolve client IP for rate-limit keying. Same logic as `api-middleware.ts`. */
function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0];
    if (first) return first.trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  // `req.ip` exists at runtime on Vercel but isn't in the @types stub for all
  // Next.js versions — access via a typed cast so we don't break type-check.
  const directIp = (req as unknown as { ip?: string }).ip;
  return directIp ?? "unknown";
}

/** Global per-IP API rate limit applied in middleware. */
const GLOBAL_API_LIMIT = 100;
const GLOBAL_API_WINDOW_MS = 60_000;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ─── A. Global API rate limit (skip auth + webhook routes) ────────────────
  // Auth routes carry their own tighter limits (see `withRateLimit` wrappers).
  // Webhook routes are external callers that verify their own signatures.
  if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/auth") &&
    !pathname.startsWith("/api/webhooks")
  ) {
    const ip = getClientIp(req);
    const result = rateLimit(`global:${ip}`, GLOBAL_API_LIMIT, GLOBAL_API_WINDOW_MS);
    if (!result.allowed) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((result.resetAt - Date.now()) / 1000),
      );
      const res = NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${retryAfterSec} seconds.` },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSec),
            "X-RateLimit-Limit": String(GLOBAL_API_LIMIT),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.floor(result.resetAt / 1000)),
          },
        },
      );
      addSecurityHeaders(res);
      return res;
    }
  }

  const res = NextResponse.next();
  const supabase = createMiddlewareClient(req);

  // Refresh session (no-op if no session; updates cookie if token refreshed)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ─── Public routes — no auth required ────────────────────────────────────
  // `/landing` is always public so the marketing page renders for everyone,
  // including authenticated brokers who happen to navigate back to it.
  const isPublicRoute =
    pathname === "/landing" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/admin/login") ||
    pathname.startsWith("/portal/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/auth/callback") ||
    pathname.startsWith("/terms") ||
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/uploads") ||
    pathname === "/robots.txt" ||
    pathname === "/logo.svg" ||
    pathname === "/favicon.ico";

  // ─── API routes: attach user info but don't redirect ──────────────────────
  // (APIs check auth themselves via createClient() or getCurrentBroker().)
  if (pathname.startsWith("/api/")) {
    // Skip auth check for auth routes + the health check
    if (pathname.startsWith("/api/auth") || pathname === "/api") {
      addSecurityHeaders(res);
      return res;
    }
    addSecurityHeaders(res);
    return res;
  }

  // ─── Admin routes — separate from the broker app ─────────────────────────
  // `/admin/login` is public (handled above). All other `/admin/*` routes
  // require a Supabase session; the super-admin check is in the API/page
  // handler. No session → redirect to /admin/login.
  const isAdminRoute = pathname.startsWith("/admin");
  if (!user && isAdminRoute && !isPublicRoute) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/admin/login";
    redirectUrl.searchParams.set("redirect", pathname);
    const redirect = NextResponse.redirect(redirectUrl);
    addSecurityHeaders(redirect);
    return redirect;
  }

  // Authenticated on /admin/login → bounce to /admin
  if (user && pathname === "/admin/login") {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/admin";
    redirectUrl.searchParams.delete("redirect");
    const redirect = NextResponse.redirect(redirectUrl);
    addSecurityHeaders(redirect);
    return redirect;
  }

  // ─── Portal routes: redirect to /portal/login if no session ──────────────
  // `/portal/login` itself is public (handled above). All other `/portal/*`
  // routes require a Supabase session.
  const isPortalRoute = pathname.startsWith("/portal");
  if (!user && isPortalRoute && !isPublicRoute) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/portal/login";
    redirectUrl.searchParams.set("redirect", pathname);
    const redirect = NextResponse.redirect(redirectUrl);
    addSecurityHeaders(redirect);
    return redirect;
  }

  // Authenticated on /portal/login → bounce to /portal
  if (user && pathname === "/portal/login") {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/portal";
    redirectUrl.searchParams.delete("redirect");
    const redirect = NextResponse.redirect(redirectUrl);
    addSecurityHeaders(redirect);
    return redirect;
  }

  // ─── Broker dashboard root: redirect to /landing if no session ───────────
  // The landing page is the marketing funnel — it owns the signup/login CTA
  // so visitors land on the pitch first instead of a bare login form.
  if (!user && pathname === "/") {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/landing";
    const redirect = NextResponse.redirect(redirectUrl);
    addSecurityHeaders(redirect);
    return redirect;
  }

  // ─── Other broker app routes: redirect to /login if no session ───────────
  if (!user && !isPublicRoute) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("redirect", pathname);
    const redirect = NextResponse.redirect(redirectUrl);
    addSecurityHeaders(redirect);
    return redirect;
  }

  // Authenticated on /login or /signup → bounce to broker dashboard
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.searchParams.delete("redirect");
    const redirect = NextResponse.redirect(redirectUrl);
    addSecurityHeaders(redirect);
    return redirect;
  }

  // Default passthrough — security headers attached.
  addSecurityHeaders(res);
  return res;
}

export const config = {
  matcher: [
    // Run on all routes except static assets
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
