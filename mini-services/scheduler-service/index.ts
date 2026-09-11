/**
 * scheduler-service — Garment Broker OS notification auto-generation scheduler.
 *
 * Runs in the background (port 3004) and triggers the main app's
 * `/api/notifications/generate` endpoint on a cron-like schedule so reminders
 * stay fresh even when nobody has the dashboard open. After generating, it
 * also triggers `/api/notifications/email` so the broker receives an email
 * digest of pending reminders (gated by the `email_notifications_enabled`
 * system setting — the email route no-ops when disabled, so this is safe to
 * call unconditionally).
 *
 * Schedule:
 *   - Once on startup (10s delay so the main Next.js app is up).
 *   - Every 60 minutes thereafter (idempotent — the generate route is safe to
 *     re-run; it only creates PENDING notifications for items that don't yet
 *     have one).
 *
 * The service itself only owns the schedule + bookkeeping (lastRun, nextRun,
 * totalRuns, lastResult). All business logic lives in the main app.
 *
 * Health endpoint:
 *   GET /  or  GET /health  →  { status, lastRun, nextRun, totalRuns, lastResult, lastEmail }
 *
 * Server-to-server: the scheduler calls `http://localhost:3000/...` directly
 * (no Caddy gateway). The main app's `/api/scheduler` route proxies to
 * `http://localhost:3004/` (also direct) so the browser can read the status
 * without CORS issues.
 *
 * NOTE (Sprint 2 — multi-tenancy): the main app's API routes now require
 * authentication via `getCurrentBroker()` (Supabase session). The scheduler
 * does not have a session, so both the generate and email calls currently
 * return 401 in the authenticated environment. This is a known follow-up —
 * add a service-account broker id (or an internal-call bypass header) so the
 * scheduler can act on behalf of each broker. The error logs are visible in
 * stdout; the service itself stays alive.
 */

import { createServer } from "http";

const MAIN_APP = "http://localhost:3000";
const INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const PORT = 3004;
const STARTUP_DELAY_MS = 10_000;

type GenResult = {
  generated: number;
  skipped?: boolean;
  details: Record<string, number>;
};

type EmailResult = {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  count?: number;
  email?: { to: string; subject: string; textLength: number };
};

let lastRun: string | null = null;
let nextRun: string = new Date(Date.now() + INTERVAL_MS).toISOString();
let totalRuns = 0;
let lastResult: GenResult | null = null;
let lastEmail: { at: string; result: EmailResult | null } | null = null;

async function runGeneration() {
  const startedAt = new Date();
  try {
    const res = await fetch(`${MAIN_APP}/api/notifications/generate`, {
      method: "POST",
    });
    if (res.ok) {
      const json = (await res.json()) as GenResult;
      lastResult = json;
      totalRuns += 1;
      console.log(
        `[${startedAt.toISOString()}] Generated ${json.generated} notifications (skipped=${json.skipped ?? false})`,
      );
    } else {
      console.error(
        `[${startedAt.toISOString()}] Generation failed — HTTP ${res.status} ${res.statusText}`,
      );
    }
  } catch (e) {
    console.error(
      `[${startedAt.toISOString()}] Generation failed:`,
      e instanceof Error ? e.message : e,
    );
  }
  lastRun = startedAt.toISOString();
  nextRun = new Date(Date.now() + INTERVAL_MS).toISOString();

  // ── After generation, fire the email digest endpoint ───────────────────
  // The email route checks the `email_notifications_enabled` setting itself
  // and no-ops (returns { skipped: true }) when disabled, so this call is
  // always safe. Only proceeds with HTML generation + audit-log write when
  // the broker has opted in via Settings → Email Notifications.
  await runEmailDigest();
}

async function runEmailDigest() {
  const startedAt = new Date();
  try {
    const res = await fetch(`${MAIN_APP}/api/notifications/email`, {
      method: "POST",
    });
    if (res.ok) {
      const json = (await res.json()) as EmailResult;
      lastEmail = { at: startedAt.toISOString(), result: json };
      if (json.skipped) {
        console.log(
          `[${startedAt.toISOString()}] Email digest skipped — ${json.reason ?? "disabled"}`,
        );
      } else if (json.success) {
        console.log(
          `[${startedAt.toISOString()}] Email digest generated — ${json.count ?? 0} reminder(s) → ${json.email?.to ?? "(no recipient)"}`,
        );
      } else {
        console.error(
          `[${startedAt.toISOString()}] Email digest failed — ${json.reason ?? "unknown"}`,
        );
      }
    } else {
      // 401 is expected in the authenticated environment until a service
      // account is wired (see module doc). Log quietly so the hourly loop
      // doesn't spam the log.
      console.error(
        `[${startedAt.toISOString()}] Email digest failed — HTTP ${res.status} ${res.statusText}`,
      );
      lastEmail = { at: startedAt.toISOString(), result: null };
    }
  } catch (e) {
    console.error(
      `[${startedAt.toISOString()}] Email digest failed:`,
      e instanceof Error ? e.message : e,
    );
    lastEmail = { at: startedAt.toISOString(), result: null };
  }
}

// Initial run after a short delay so the main Next.js app has time to boot.
setTimeout(() => {
  void runGeneration();
}, STARTUP_DELAY_MS);

// Recurring hourly run.
setInterval(() => {
  void runGeneration();
}, INTERVAL_MS);

const httpServer = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/" || url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        lastRun,
        nextRun,
        totalRuns,
        lastResult,
        lastEmail,
      }),
    );
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

httpServer.listen(PORT, () => {
  console.log(`Scheduler service running on port ${PORT}`);
});

// Graceful shutdown on SIGTERM / SIGINT.
function shutdown(signal: string) {
  console.log(`[scheduler-service] Received ${signal}, shutting down…`);
  httpServer.close(() => {
    console.log("[scheduler-service] Closed");
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
