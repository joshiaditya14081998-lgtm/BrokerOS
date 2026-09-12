/**
 * Isomorphic error reporting utility.
 *
 * Used by the in-app error boundary, the global error page, and API route
 * catch blocks. Always logs to the console; additionally forwards to Sentry
 * when a DSN is configured (the SDK is a no-op when `enabled: false` or when
 * the DSN is empty, so it's safe to call unconditionally).
 *
 * Imported from both client ("use client") and server (route handlers / edge)
 * code — `@sentry/nextjs` is isomorphic and works in all Next.js runtimes.
 */

import * as Sentry from "@sentry/nextjs";

/** A snapshot of arbitrary metadata to attach to the reported event. */
export type ErrorContext = Record<string, unknown>;

/**
 * Report an unexpected error to the console and (when configured) Sentry.
 *
 * @param error   The Error instance (or value) that was thrown.
 * @param context Optional structured metadata — route, user action, etc.
 */
export function reportError(error: unknown, context?: ErrorContext): void {
  // Always log locally so developers see the trace in the terminal / browser
  // console even when no Sentry DSN is configured.
  console.error("[error-report]", error, context ?? {});

  try {
    if (context && Object.keys(context).length > 0) {
      Sentry.captureException(error, {
        contexts: { app: context },
        tags: normalizeTags(context),
      });
    } else {
      Sentry.captureException(error);
    }
  } catch {
    // Reporting should never throw — swallow Sentry failures silently.
    console.error("[error-report] failed to forward to Sentry", error);
  }
}

/**
 * Report a structured API error (non-2xx response from a route handler).
 *
 * @param path    The API path, e.g. "/api/bookings".
 * @param status  HTTP status code returned.
 * @param message Short human-readable message describing the failure.
 */
export function reportApiError(
  path: string,
  status: number,
  message: string,
): void {
  console.error("[api-error]", { path, status, message });

  try {
    Sentry.captureMessage(`${status} ${path}: ${message}`, {
      level: status >= 500 ? "error" : status >= 400 ? "warning" : "info",
      tags: { component: "api", path, status: String(status) },
    });
  } catch {
    console.error("[api-error] failed to forward to Sentry", { path, status });
  }
}

/**
 * Flatten common tag-shaped keys from a context object into Sentry tags.
 * Tags must be strings, so non-string values are stringified.
 */
function normalizeTags(context: ErrorContext): Record<string, string> {
  const tagKeys = ["path", "method", "route", "view", "action", "component"];
  const tags: Record<string, string> = {};
  for (const key of tagKeys) {
    const value = context[key];
    if (typeof value === "string" || typeof value === "number") {
      tags[key] = String(value);
    } else if (value !== undefined && value !== null) {
      try {
        tags[key] = String(value);
      } catch {
        // ignore non-serializable values
      }
    }
  }
  return tags;
}
