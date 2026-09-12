"use client";

import * as React from "react";
import { AlertCircle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/error-report";

/**
 * Global root error boundary.
 *
 * In Next.js App Router, `error.tsx` at the app root catches errors thrown
 * by the root layout itself (and any child route that isn't wrapped in its
 * own error boundary). It MUST be a Client Component and accept a `reset`
 * prop to retry rendering.
 *
 * The fallback is calm, glassmorphic, emerald-accented. It shows the
 * truncated error message and two actions: "Try again" (calls `reset()`)
 * and "Go home" (a soft link back to "/").
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Forward to console + Sentry once per mount (avoid spamming on every
  // re-render of the fallback).
  React.useEffect(() => {
    reportError(error, {
      component: "GlobalError",
      digest: error.digest,
    });
  }, [error]);

  const truncated =
    error.message && error.message.length > 180
      ? `${error.message.slice(0, 180)}…`
      : error.message;

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
        role="alert"
        aria-live="assertive"
        className="glass hover-lift w-full max-w-lg rounded-2xl p-6 text-center sm:p-10"
      >
        <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/30">
          <AlertCircle
            className="size-8 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
        </div>

        <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
          Something went wrong
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground sm:text-base">
          We hit an unexpected error. Our team has been notified — try again,
          or head home.
        </p>

        {truncated ? (
          <p
            className="mx-auto mt-4 max-w-md break-words rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground"
            title={error.message}
          >
            {truncated}
          </p>
        ) : null}

        <div className="mt-8 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Button
            type="button"
            onClick={() => reset()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Try again
          </Button>
          <Button
            asChild
            type="button"
            variant="outline"
            className="border-border text-foreground hover:bg-accent"
          >
            <a href="/">
              <Home className="size-4" aria-hidden="true" />
              Go home
            </a>
          </Button>
        </div>
      </section>
    </main>
  );
}
