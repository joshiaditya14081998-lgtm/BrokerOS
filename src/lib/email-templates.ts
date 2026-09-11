// ─────────────────────────────────────────────────────────────────────────────
// Email template generator — produces email-client-friendly HTML bodies for
// the broker's pending-reminders digest.
//
// Used by:
//   • POST /api/notifications/email  — generates the HTML body that gets
//     returned for preview + (future) SMTP delivery.
//
// Design rules:
//   • 100% inline CSS — no <style> tags, no external stylesheets. Every mail
//     client (Gmail / Outlook / Apple Mail / Android) reliably honors inline
//     styles; class-based CSS is often stripped.
//   • Table-based layout — table role="presentation" is the most universally
//     supported layout primitive in email.
//   • Max-width 600px container — mobile-friendly without media queries.
//   • Emerald accent (#059669 / #047857) — matches the in-app glassmorphic
//     design system. NO indigo/blue.
//   • No external images, fonts, or scripts — fully self-contained.
//
// When SMTP keys are added (Resend / Nodemailer), this body is ready to send
// as-is via `transporter.sendMail({ html: ... })`.
// ─────────────────────────────────────────────────────────────────────────────

export type NotificationItem = {
  type: "visit_followup" | "dispatch_due" | "payment_due" | "brokerage_due" | (string & {});
  title: string;
  message: string;
  dueDate: string; // ISO date string
  severity: "overdue" | "soon" | "future" | (string & {});
};

// ── Color palette ────────────────────────────────────────────────────────────
// Mirrors src/app/api/digest/route.ts → buildHtmlDigest so the email digest
// reads as part of the same design family as the Daily Digest email.
const ACCENT = "#059669"; // emerald-600
const ACCENT_DARK = "#047857"; // emerald-700
const SUBTLE = "#f1f5f9"; // slate-100
const BORDER = "#e2e8f0"; // slate-200
const MUTED = "#64748b"; // slate-500
const TEXT = "#0f172a"; // slate-900

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Per-type icon + label. We use emoji icons because emoji render uniformly
// across email clients (no font / image dependency). The accent stripe on
// the row also encodes the type so color-blind readers still get a signal.
const TYPE_META: Record<
  string,
  { icon: string; label: string; stripe: string; tint: string }
> = {
  visit_followup: { icon: "📞", label: "Visit follow-up", stripe: "#0d9488", tint: "#ccfbf1" }, // teal
  dispatch_due: { icon: "🚚", label: "Dispatch due", stripe: "#d97706", tint: "#fef3c7" }, // amber
  payment_due: { icon: "💸", label: "Payment due", stripe: "#dc2626", tint: "#fee2e2" }, // red
  brokerage_due: { icon: "🪙", label: "Brokerage due", stripe: "#059669", tint: "#d1fae5" }, // emerald
};

function typeMeta(type: string) {
  return TYPE_META[type] ?? { icon: "🔔", label: "Reminder", stripe: ACCENT, tint: SUBTLE };
}

// Severity badge — mirrors the urgency badge logic used in the Notifications
// view (Overdue = rose, Due in ≤3d = amber, Future = teal). The email is read
// once and statically, so we encode severity directly in the row's right cell.
function severityBadge(sev: string): string {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    overdue: { bg: "#fee2e2", fg: "#991b1b", label: "OVERDUE" },
    soon: { bg: "#fef3c7", fg: "#92400e", label: "DUE SOON" },
    future: { bg: "#ccfbf1", fg: "#115e59", label: "UPCOMING" },
  };
  const v = map[sev] ?? { bg: SUBTLE, fg: MUTED, label: sev.toUpperCase() };
  return `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:700;letter-spacing:0.04em;background:${v.bg};color:${v.fg};">${escapeHtml(v.label)}</span>`;
}

// ── Email body builder ───────────────────────────────────────────────────────

/**
 * Generate the broker's pending-reminders digest email.
 *
 * @param brokerName  Display name (Broker.fullName ?? Broker.email). Used in
 *                    the greeting line; falls back to "there" if empty.
 * @param notifications  Pending notifications to include in the table.
 * @returns `{ subject, html }` ready to pass to an SMTP transporter.
 */
export function generateNotificationDigestEmail(
  brokerName: string,
  notifications: NotificationItem[],
): { subject: string; html: string } {
  const now = new Date();
  const dateLabel = now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const generatedAtDisplay = now.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const greetingName = brokerName?.trim() || "there";

  // Group counts for the summary line.
  const counts: Record<string, number> = {};
  for (const n of notifications) {
    counts[n.type] = (counts[n.type] ?? 0) + 1;
  }
  const total = notifications.length;
  const overdueCount = notifications.filter((n) => n.severity === "overdue").length;

  // Notification table rows.
  const rows = total
    ? notifications
        .map((n) => {
          const meta = typeMeta(n.type);
          return `
        <tr>
          <td style="padding:12px;border-bottom:1px solid ${BORDER};vertical-align:top;width:44px;">
            <div style="width:34px;height:34px;border-radius:10px;background:${meta.tint};text-align:center;line-height:34px;font-size:18px;">${meta.icon}</div>
          </td>
          <td style="padding:12px;border-bottom:1px solid ${BORDER};vertical-align:top;border-left:3px solid ${meta.stripe};">
            <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${meta.stripe};">${escapeHtml(meta.label)}</div>
            <div style="font-size:14px;font-weight:600;color:${TEXT};margin-top:2px;">${escapeHtml(n.title)}</div>
            <div style="font-size:12px;color:${MUTED};margin-top:4px;line-height:1.5;">${escapeHtml(n.message)}</div>
            <div style="font-size:11px;color:${MUTED};margin-top:6px;">Due: <span style="color:${TEXT};font-weight:600;">${escapeHtml(fmtDate(n.dueDate))}</span></div>
          </td>
          <td style="padding:12px;border-bottom:1px solid ${BORDER};vertical-align:top;white-space:nowrap;text-align:right;">${severityBadge(n.severity)}</td>
        </tr>`;
        })
        .join("")
    : `<tr><td colspan="3" style="padding:24px 12px;text-align:center;color:${MUTED};font-size:13px;">
        ✅ All caught up — no pending reminders right now.
      </td></tr>`;

  // Summary line items.
  const summaryParts: string[] = [];
  if (counts.visit_followup) summaryParts.push(`${counts.visit_followup} visit follow-up${counts.visit_followup === 1 ? "" : "s"}`);
  if (counts.dispatch_due) summaryParts.push(`${counts.dispatch_due} dispatch${counts.dispatch_due === 1 ? "" : "es"}`);
  if (counts.payment_due) summaryParts.push(`${counts.payment_due} payment${counts.payment_due === 1 ? "" : "s"}`);
  if (counts.brokerage_due) summaryParts.push(`${counts.brokerage_due} brokerage payout${counts.brokerage_due === 1 ? "" : "s"}`);
  const summaryLine = summaryParts.length ? summaryParts.join(" · ") : "no channel-specific reminders";

  const subject = `Broker OS — ${total === 0 ? "all caught up" : `${total} pending reminder${total === 1 ? "" : "s"}`} · ${dateLabel}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${TEXT};">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${BORDER};box-shadow:0 1px 3px rgba(15,23,42,0.06);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,${ACCENT} 0%,${ACCENT_DARK} 100%);padding:24px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#a7f3d0;">Garment Broker OS</div>
                    <div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:4px;">Pending Reminders Digest</div>
                    <div style="font-size:13px;color:#d1fae5;margin-top:4px;">${escapeHtml(generatedAtDisplay)}</div>
                  </td>
                  <td align="right" valign="top" style="font-size:36px;line-height:1;">🔔</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Greeting + summary -->
          <tr>
            <td style="padding:22px 28px 6px 28px;">
              <div style="font-size:15px;color:${TEXT};">Hello ${escapeHtml(greetingName)},</div>
              <div style="font-size:13px;color:${MUTED};margin-top:6px;line-height:1.55;">
                ${
                  total === 0
                    ? "You have no pending reminders right now — a quiet day. We'll let you know when something needs your attention."
                    : `You have <span style="color:${TEXT};font-weight:700;">${total} pending reminder${total === 1 ? "" : "s"}</span>${
                        overdueCount > 0
                          ? ` (<span style="color:#b91c1c;font-weight:700;">${overdueCount} overdue</span>)`
                          : ""
                      }. Here's the digest — log in to Broker OS to take action.`
                }
              </div>
            </td>
          </tr>

          ${
            total > 0
              ? `<!-- Summary chips -->
          <tr>
            <td style="padding:6px 28px 4px 28px;">
              <div style="background:${SUBTLE};border-radius:10px;padding:10px 14px;font-size:12px;color:${TEXT};">
                <span style="font-weight:700;color:${ACCENT};">Channels:</span> ${escapeHtml(summaryLine)}
              </div>
            </td>
          </tr>`
              : ""
          }

          <!-- Notifications table -->
          <tr>
            <td style="padding:18px 28px 6px 28px;">
              <div style="font-size:14px;font-weight:700;color:${TEXT};border-left:3px solid ${ACCENT};padding-left:10px;">${total === 0 ? "Status" : "Pending reminders"}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 28px 18px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid ${BORDER};border-radius:10px;overflow:hidden;">
                <thead>
                  <tr style="background:${SUBTLE};">
                    <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};width:44px;">Type</th>
                    <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">Reminder</th>
                    <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">Severity</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </td>
          </tr>

          <!-- Call to action -->
          <tr>
            <td style="padding:6px 28px 18px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="padding:14px;background:${SUBTLE};border-radius:10px;">
                    <div style="font-size:13px;color:${TEXT};font-weight:600;">
                      ${total === 0 ? "✓ Nothing to action today." : `Log in to Broker OS to take action on ${total} reminder${total === 1 ? "" : "s"}.`}
                    </div>
                    <div style="font-size:11px;color:${MUTED};margin-top:4px;">
                      ${total === 0
                        ? "We'll email you again when new reminders are generated."
                        : "Mark them done, dismiss, or follow the link to the relevant module."}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:14px 28px;background:${SUBTLE};border-top:1px solid ${BORDER};">
              <div style="font-size:11px;color:${MUTED};text-align:center;line-height:1.55;">
                Generated by Garment Broker OS on ${escapeHtml(generatedAtDisplay)}.<br>
                You receive this because <span style="font-weight:600;color:${TEXT};">email notifications are enabled</span> in your settings.
                Disable anytime from Settings → Email notifications.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}
