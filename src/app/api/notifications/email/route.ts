import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { generateNotificationDigestEmail, type NotificationItem } from "@/lib/email-templates";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Email notification digest endpoint
//
// POST /api/notifications/email
//   • Requires authentication (getCurrentBroker).
//   • Gathers all PENDING notifications for the broker (scoped by brokerId).
//   • Resolves the recipient email:
//       1. broker-level `email_address` setting (if set + non-empty)
//       2. else the broker's profile email (Broker.email)
//   • Reads the `email_notifications_enabled` setting. When disabled → returns
//     `{ success: false, skipped: true, reason: "Email notifications disabled" }`
//     without generating HTML, so the scheduler / settings "Send test" can
//     short-circuit cleanly.
//   • Generates the HTML email body via `generateNotificationDigestEmail()`
//     (inline CSS, emerald accent, responsive — email-client-friendly).
//   • Writes an AuditLog entry: "Email digest generated for N notifications".
//   • Returns `{ success, email: { to, subject, html, textLength }, count, note }`.
//
// SMTP / Resend integration (future):
//   This endpoint currently returns the HTML body for preview. When SMTP
//   credentials are added (env: SMTP_HOST / SMTP_USER / SMTP_PASS, or a
//   Resend API key), insert the actual send call between "generate HTML"
//   and "write audit log" — the body is ready to send as-is via
//   `transporter.sendMail({ to, subject, html })`. The rest of the flow
//   (audit log, response shape) stays unchanged.
//
// The scheduler mini-service calls this endpoint after generating
// notifications, so the broker receives an email digest automatically when
// new pending reminders appear (gated by the email-enabled setting).
// ─────────────────────────────────────────────────────────────────────────────

async function readSetting(key: string, fallback: string): Promise<string> {
  const row = await db.systemSetting.findUnique({ where: { key } });
  return row?.value ?? fallback;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Severity classification — mirrors the urgency badge logic used in the
// Notifications view so the email severity chip stays consistent with the UI.
function classifySeverity(dueDate: Date, now: Date): "overdue" | "soon" | "future" {
  if (dueDate < now) return "overdue";
  const diffMs = dueDate.getTime() - now.getTime();
  if (diffMs <= 3 * DAY_MS) return "soon";
  return "future";
}

export async function POST(_req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Read settings.
  const enabledRaw = await readSetting("email_notifications_enabled", "false");
  const enabled = enabledRaw.toLowerCase() === "true";
  const emailAddress = (await readSetting("email_address", "")).trim();

  if (!enabled) {
    return NextResponse.json({
      success: false,
      skipped: true,
      reason: "Email notifications disabled. Enable them in Settings → Email notifications.",
    });
  }

  // Resolve recipient: per-broker setting override → broker profile email.
  const to = emailAddress || broker.email;
  if (!to) {
    return NextResponse.json(
      { success: false, skipped: true, reason: "No recipient email address configured." },
      { status: 400 },
    );
  }

  // Gather pending notifications (scoped to this broker — multi-tenant safe).
  const now = new Date();
  const pending = await db.notification.findMany({
    where: { status: "pending", brokerId: broker.id },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    select: { id: true, type: true, title: true, message: true, dueDate: true },
  });

  const items: NotificationItem[] = pending.map((n) => ({
    type: n.type,
    title: n.title,
    message: n.message ?? "",
    dueDate: n.dueDate.toISOString(),
    severity: classifySeverity(n.dueDate, now),
  }));

  // Generate HTML email body.
  const brokerName = broker.fullName || broker.email || "";
  const { subject, html } = generateNotificationDigestEmail(brokerName, items);

  // Audit log entry — every email-digest generation is attributable.
  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: "Notification",
      entityId: "email-digest",
      action: "create",
      before: null,
      after: JSON.stringify({ to, subject, count: items.length, textLength: html.length }),
      userName: broker.fullName,
      reason: `Email digest generated for ${items.length} notification${items.length === 1 ? "" : "s"}.`,
    },
  });

  return NextResponse.json({
    success: true,
    skipped: false,
    count: items.length,
    email: {
      to,
      subject,
      html,
      textLength: html.length,
    },
    note:
      "Email sending requires SMTP/Resend integration. The HTML body is ready to send — add SMTP credentials and call transporter.sendMail({ to, subject, html }).",
  });
}

// GET /api/notifications/email — read-only metadata, used by the Settings
// "Send test email" button's preview and by the scheduler for health checks.
// Returns the current email-notifications config + the last-digest audit
// entry, without generating a new digest.
export async function GET(_req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [enabledRaw, frequency, emailAddress] = await Promise.all([
    readSetting("email_notifications_enabled", "false"),
    readSetting("email_digest_frequency", "daily"),
    readSetting("email_address", ""),
  ]);

  const lastDigest = await db.auditLog.findFirst({
    where: { brokerId: broker.id, entityType: "Notification", entityId: "email-digest" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, reason: true, after: true },
  });

  return NextResponse.json({
    enabled: enabledRaw.toLowerCase() === "true",
    frequency: frequency || "daily",
    emailAddress: emailAddress || broker.email,
    lastDigest: lastDigest
      ? {
          at: lastDigest.createdAt.toISOString(),
          reason: lastDigest.reason,
        }
      : null,
  });
}
