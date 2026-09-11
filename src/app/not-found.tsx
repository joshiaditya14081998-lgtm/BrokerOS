"use client";

import * as React from "react";
import Link from "next/link";
import { Compass, Home, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/**
 * Friendly 404 page.
 *
 * Next.js renders this automatically when no route matches OR when the
 * `notFound()` helper is called from a Server Component. Calm, glassmorphic
 * card — not a scary stack-trace-style error page. Shows two CTAs:
 *
 *   - "Go to Dashboard" (only when the visitor is signed in)
 *   - "Go to Landing"   (always — the marketing page lives at `/landing`)
 *
 * Auth is checked client-side via the Supabase browser client (same pattern
 * as the landing page) so the page can be statically rendered and still
 * adapt to the signed-in state.
 */
export default function NotFound() {
  const [authed, setAuthed] = React.useState(false);
  const [checking, setChecking] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        if (!cancelled) setAuthed(!!user);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background px-4 py-12 text-foreground">
      {/* Soft ambient gradient backdrop (matches the rest of the app) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, oklch(0.6 0.12 162 / 0.18), transparent 70%), radial-gradient(40% 40% at 100% 100%, oklch(0.6 0.10 200 / 0.12), transparent 70%)",
        }}
      />

      <section
        role="region"
        aria-label="Page not found"
        className="glass hover-lift w-full max-w-lg rounded-2xl p-6 text-center sm:p-10"
      >
        {/* Compass icon — calm and exploratory, not alarming */}
        <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/30">
          <Compass
            className="size-8 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
        </div>

        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
          404
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">
          Page not found
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground sm:text-base">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
          Let&apos;s get you back to where you need to be.
        </p>

        {/* CTAs */}
        <div className="mt-8 flex flex-col items-center justify-center gap-2 sm:flex-row">
          {authed ? (
            <Button
              asChild
              type="button"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Link href="/">
                <LayoutDashboard className="size-4" aria-hidden="true" />
                Go to Dashboard
              </Link>
            </Button>
          ) : (
            <Button
              asChild
              type="button"
              disabled={checking}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Link href="/landing">
                <Home className="size-4" aria-hidden="true" />
                Go to Landing
              </Link>
            </Button>
          )}
          {authed ? (
            <Button
              asChild
              type="button"
              variant="outline"
              className="border-border text-foreground hover:bg-accent"
            >
              <Link href="/landing">
                <Home className="size-4" aria-hidden="true" />
                Go to Landing
              </Link>
            </Button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
