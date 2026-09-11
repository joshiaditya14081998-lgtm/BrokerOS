import { type NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/server";

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
 *    - `/login`, `/signup`           — broker login/signup.
 *    - `/admin/login`                — super admin login.
 *    - `/portal/login`               — portal login (clients + suppliers).
 *    - `/api/auth/*`, `/api/auth/callback` — auth API.
 *    - `/api/admin/*`                — admin API (auth checked by the route handler
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
 */
export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient(req);

  // Refresh session (no-op if no session; updates cookie if token refreshed)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = req.nextUrl;

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
      return res;
    }
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
    return NextResponse.redirect(redirectUrl);
  }

  // Authenticated on /admin/login → bounce to /admin
  if (user && pathname === "/admin/login") {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/admin";
    redirectUrl.searchParams.delete("redirect");
    return NextResponse.redirect(redirectUrl);
  }

  // ─── Portal routes: redirect to /portal/login if no session ──────────────
  // `/portal/login` itself is public (handled above). All other `/portal/*`
  // routes require a Supabase session.
  const isPortalRoute = pathname.startsWith("/portal");
  if (!user && isPortalRoute && !isPublicRoute) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/portal/login";
    redirectUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Authenticated on /portal/login → bounce to /portal
  if (user && pathname === "/portal/login") {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/portal";
    redirectUrl.searchParams.delete("redirect");
    return NextResponse.redirect(redirectUrl);
  }

  // ─── Broker dashboard root: redirect to /landing if no session ───────────
  // The landing page is the marketing funnel — it owns the signup/login CTA
  // so visitors land on the pitch first instead of a bare login form.
  if (!user && pathname === "/") {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/landing";
    return NextResponse.redirect(redirectUrl);
  }

  // ─── Other broker app routes: redirect to /login if no session ───────────
  if (!user && !isPublicRoute) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Authenticated on /login or /signup → bounce to broker dashboard
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.searchParams.delete("redirect");
    return NextResponse.redirect(redirectUrl);
  }

  return res;
}

export const config = {
  matcher: [
    // Run on all routes except static assets
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
