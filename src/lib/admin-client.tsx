"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Shield } from "lucide-react";
import { api } from "@/lib/api";

/**
 * Admin client helpers — shared by every `/admin/*` page.
 *
 * `useAdminGate()` calls `/api/admin/dashboard` once on mount. The route
 * returns 403 when the logged-in Supabase user is not a super admin (or not
 * authenticated at all). In that case we redirect to `/admin/login?redirect=…`.
 * Otherwise it returns `{ ok: true, loading: true }` while the dashboard API
 * is in flight and `{ ok: true, loading: false }` once verified, so the page
 * can render its real content.
 *
 * Each page that uses this hook still fetches its own data via `useApi` — the
 * gate is only for the access check, not for fetching the dashboard payload.
 */
export function useAdminGate() {
  const router = useRouter();
  const [ok, setOk] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [forbidden, setForbidden] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The dashboard route only resolves (200) for super admins. A 403
        // means the user is logged in but not a super admin; a 401 means no
        // session at all. Either way, bounce to /admin/login.
        await api("/api/admin/dashboard");
        if (!cancelled) {
          setOk(true);
          setLoading(false);
        }
      } catch {
        if (cancelled) return;
        setForbidden(true);
        setLoading(false);
        // Slight delay so the user sees the forbidden state briefly before
        // the redirect kicks in (otherwise the page just flashes blank).
        const redirect = encodeURIComponent(
          typeof window !== "undefined" ? window.location.pathname : "/admin",
        );
        setTimeout(() => router.replace(`/admin/login?redirect=${redirect}`), 600);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return { ok, loading, forbidden };
}

/**
 * Shared error + loading wrapper for admin pages. Renders a centered
 * glassmorphic panel with the Shield icon while the gate is in flight, and
 * a forbidden notice if the user is not a super admin (before the redirect
 * to /admin/login kicks in).
 */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const { ok, loading, forbidden } = useAdminGate();
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="glass rounded-2xl px-8 py-6 text-center">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-xl bg-teal-600 text-white">
            <Shield />
          </div>
          <p className="text-sm text-muted-foreground">Verifying super admin access…</p>
        </div>
      </div>
    );
  }
  if (forbidden || !ok) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="glass rounded-2xl px-8 py-6 text-center">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-xl bg-rose-500/15 text-rose-600">
            <Shield />
          </div>
          <p className="text-sm font-medium text-foreground">Access denied</p>
          <p className="mt-1 text-xs text-muted-foreground">
            You are not a super admin. Redirecting to login…
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
