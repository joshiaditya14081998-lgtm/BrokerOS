import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import ZAI from "z-ai-web-dev-sdk";
import { getCurrentBroker } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // LLM call can take several seconds

// ─────────────────────────────────────────────────────────────────────────────
// Daily Broker Digest — a consolidated snapshot of what needs the broker's
// attention today, served in three formats:
//   • text  → plain-text summary (also feeds the KPI strip in the UI)
//   • html  → standalone HTML email body (inline CSS, emerald accent, tables)
//             that the broker can copy/paste into Gmail/Outlook or send later
//   • email → AI-generated "morning brief" via z-ai-web-dev-sdk LLM
//             (returns { subject, body }) — friendly 3-4 paragraph summary
//
// All three formats share the same underlying data, gathered once via Prisma.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

type Priority = "urgent" | "high" | "normal";

type ActionItem = {
  type: string;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string;
};

type DigestData = {
  generatedAt: string; // ISO
  generatedAtDisplay: string; // "12 Aug 2026, 09:30 AM"
  dateLabel: string; // "12 Aug 2026"
  actionItems: ActionItem[];
  outstandingReceivable: {
    total: number;
    topClients: { name: string; due: number }[];
  };
  overdueDispatches: {
    poNumber: string;
    supplierName: string;
    dueDate: string;
    daysOverdue: number;
  }[];
  paymentsDueNext7Days: {
    billNumber: string;
    clientName: string;
    amount: number;
    dueDate: string;
  }[];
  brokeragePendingPayout: {
    accrued: number; // eligible, awaiting payout
    scheduled: number; // already in a payout batch
    total: number;
  };
  openDisputesCount: number;
  pendingNotificationsCount: number;
  summary: {
    pendingActions: number;
    outstandingTotal: number;
    duePaymentsCount: number; // bills due within next 7 days (or already overdue)
    openDisputes: number;
  };
};

function fmtINR(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function fmtINRCompact(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  if (Math.abs(v) >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`;
  if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(2)}L`;
  if (Math.abs(v) >= 1000) return `₹${(v / 1000).toFixed(1)}K`;
  return fmtINR(v);
}

function fmtDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(d: Date): string {
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pluralDays(n: number): string {
  const abs = Math.max(1, Math.abs(n));
  return `${abs} day${abs === 1 ? "" : "s"}`;
}

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2 };

// ─────────────────────────────────────────────────────────────────────────────
// gatherDigestData — single pass over Prisma, mirrors the action-center logic
// (simplified) plus the digest-specific aggregations (top clients, payments
// due next 7d, brokerage pending payout).
// ─────────────────────────────────────────────────────────────────────────────
async function gatherDigestData(brokerId: string): Promise<DigestData> {
  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * DAY_MS);

  const [
    visits,
    overduePOs,
    openBills,
    eligibleBrokerages,
    openDisputes,
    pendingNotifications,
  ] = await Promise.all([
    db.visit.findMany({
      where: {
        brokerId,
        status: { in: ["scheduled", "followed_up"] },
        plannedDate: { lte: new Date(now.getTime() + 3 * DAY_MS) },
      },
      include: { client: { select: { name: true } } },
      orderBy: { plannedDate: "asc" },
    }),
    db.purchaseOrder.findMany({
      where: { brokerId, status: "open", expectedDispatchDate: { not: null, lt: now } },
      include: { supplier: { select: { name: true } } },
      orderBy: { expectedDispatchDate: "asc" },
    }),
    db.bill.findMany({
      where: { brokerId, status: { not: "fully_paid" } },
      include: { client: { select: { name: true, defaultPaymentCycleDays: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.brokerage.findMany({
      where: { brokerId, eligible: true, payoutStatus: { in: ["accrued", "scheduled"] } },
      include: { client: { select: { name: true } } },
    }),
    db.dispute.findMany({
      where: { brokerId, status: "open" },
      include: { po: { select: { poNumber: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.notification.count({ where: { brokerId, status: "pending" } }),
  ]);

  // ── Action items (simplified from /api/action-center) ────────────────────
  const actionItems: ActionItem[] = [];

  for (const v of visits) {
    const daysOverdue = Math.floor((now.getTime() - v.plannedDate.getTime()) / DAY_MS);
    const isPast = v.plannedDate < now;
    if (v.status === "scheduled" && isPast) {
      actionItems.push({
        type: "visit_followup",
        title: `Follow up with ${v.client.name}`,
        description: `Visit was ${pluralDays(daysOverdue)} ago. Call to reschedule.`,
        priority: daysOverdue > 2 ? "urgent" : "high",
        dueDate: v.plannedDate.toISOString(),
      });
    } else if (
      v.status === "followed_up" &&
      v.plannedDate < new Date(now.getTime() - 3 * DAY_MS)
    ) {
      actionItems.push({
        type: "visit_followup",
        title: `Re-follow-up: ${v.client.name}`,
        description: `Original visit was ${pluralDays(daysOverdue)} ago and still pending closure.`,
        priority: "high",
        dueDate: v.plannedDate.toISOString(),
      });
    } else if (v.status === "scheduled" && !isPast) {
      const daysAhead = Math.max(
        0,
        Math.floor((v.plannedDate.getTime() - now.getTime()) / DAY_MS),
      );
      actionItems.push({
        type: "visit_followup",
        title: `Upcoming visit: ${v.client.name}`,
        description:
          daysAhead === 0
            ? "Visit scheduled for today."
            : `Visit scheduled in ${pluralDays(daysAhead)}.`,
        priority: "normal",
        dueDate: v.plannedDate.toISOString(),
      });
    }
  }

  // Overdue dispatches → also feed the dispatches list separately
  const overdueDispatchList: DigestData["overdueDispatches"] = [];
  for (const po of overduePOs) {
    const effective = po.revisedDispatchDate ?? po.expectedDispatchDate;
    if (!effective) continue;
    const daysOverdue = Math.max(
      1,
      Math.floor((now.getTime() - effective.getTime()) / DAY_MS),
    );
    actionItems.push({
      type: "dispatch_due",
      title: `Record dispatch: ${po.poNumber}`,
      description: `Supplier ${po.supplier.name} dispatch is overdue.`,
      priority: "high",
      dueDate: effective.toISOString(),
    });
    overdueDispatchList.push({
      poNumber: po.poNumber,
      supplierName: po.supplier.name,
      dueDate: effective.toISOString(),
      daysOverdue,
    });
  }

  // Payments due — collect bills whose computed due date is within 7 days OR
  // already past due.
  const paymentsDueNext7Days: DigestData["paymentsDueNext7Days"] = [];
  for (const bill of openBills) {
    const remaining = Math.max(0, bill.finalAmount - bill.paidAmount);
    if (remaining <= 0) continue;
    const dueDate = new Date(
      bill.createdAt.getTime() + bill.client.defaultPaymentCycleDays * DAY_MS,
    );
    const diffDays = Math.floor((now.getTime() - dueDate.getTime()) / DAY_MS);
    const isPast = dueDate < now;
    if (isPast) {
      const priority: Priority = diffDays > 14 ? "urgent" : "high";
      actionItems.push({
        type: "payment_due",
        title: `Collect payment: ${bill.billNumber}`,
        description: `${bill.client.name} owes ${fmtINR(remaining)}. ${pluralDays(diffDays)} overdue.`,
        priority,
        dueDate: dueDate.toISOString(),
      });
      paymentsDueNext7Days.push({
        billNumber: bill.billNumber,
        clientName: bill.client.name,
        amount: remaining,
        dueDate: dueDate.toISOString(),
      });
    } else if (dueDate <= in7d) {
      const daysAhead = Math.max(
        0,
        Math.floor((dueDate.getTime() - now.getTime()) / DAY_MS),
      );
      actionItems.push({
        type: "payment_due",
        title: `Collect payment: ${bill.billNumber}`,
        description:
          daysAhead === 0
            ? `${bill.client.name} owes ${fmtINR(remaining)}. Due today.`
            : `${bill.client.name} owes ${fmtINR(remaining)}. Due in ${pluralDays(daysAhead)}.`,
        priority: "normal",
        dueDate: dueDate.toISOString(),
      });
      paymentsDueNext7Days.push({
        billNumber: bill.billNumber,
        clientName: bill.client.name,
        amount: remaining,
        dueDate: dueDate.toISOString(),
      });
    }
  }

  // Brokerage pending payout — aggregate per client, one action per client
  const brokerageByClient = new Map<string, { total: number; name: string; earliest: Date }>();
  let accruedTotal = 0;
  let scheduledTotal = 0;
  for (const b of eligibleBrokerages) {
    if (b.payoutStatus === "accrued") accruedTotal += b.brokerageAmount;
    if (b.payoutStatus === "scheduled") scheduledTotal += b.brokerageAmount;
    const eligibleAt = b.eligibleAt ?? b.createdAt;
    const prev = brokerageByClient.get(b.clientId);
    if (prev) {
      prev.total += b.brokerageAmount;
      if (eligibleAt < prev.earliest) prev.earliest = eligibleAt;
    } else {
      brokerageByClient.set(b.clientId, {
        total: b.brokerageAmount,
        name: b.client.name,
        earliest: eligibleAt,
      });
    }
  }
  for (const [, agg] of brokerageByClient) {
    actionItems.push({
      type: "brokerage_payout",
      title: `Pay out brokerage: ${agg.name}`,
      description: `${fmtINR(agg.total)} eligible for payout.`,
      priority: "high",
      dueDate: agg.earliest.toISOString(),
    });
  }

  // Open disputes
  for (const d of openDisputes) {
    const daysOpen = Math.max(
      1,
      Math.floor((now.getTime() - d.createdAt.getTime()) / DAY_MS),
    );
    actionItems.push({
      type: "dispute_resolve",
      title: `Resolve dispute: ${d.po.poNumber}`,
      description: `${d.type.replace(/_/g, " ")} — open for ${pluralDays(daysOpen)}.`,
      priority: daysOpen > 7 ? "urgent" : "high",
      dueDate: d.createdAt.toISOString(),
    });
  }

  // Sort actions: priority asc, then dueDate asc — cap at 12 for the digest
  actionItems.sort((a, b) => {
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pr !== 0) return pr;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });

  // Outstanding receivable — top 3 clients by due amount
  const byClient = new Map<string, { name: string; due: number }>();
  for (const bill of openBills) {
    const remaining = Math.max(0, bill.finalAmount - bill.paidAmount);
    if (remaining <= 0) continue;
    const prev = byClient.get(bill.clientId);
    if (prev) {
      prev.due += remaining;
    } else {
      byClient.set(bill.clientId, { name: bill.client.name, due: remaining });
    }
  }
  const topClients = Array.from(byClient.values())
    .sort((a, b) => b.due - a.due)
    .slice(0, 3);
  const outstandingTotal = Array.from(byClient.values()).reduce((s, c) => s + c.due, 0);

  return {
    generatedAt: now.toISOString(),
    generatedAtDisplay: fmtDateTime(now),
    dateLabel: fmtDate(now),
    actionItems: actionItems.slice(0, 12),
    outstandingReceivable: {
      total: outstandingTotal,
      topClients,
    },
    overdueDispatches: overdueDispatchList.slice(0, 6),
    paymentsDueNext7Days: paymentsDueNext7Days
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
      .slice(0, 6),
    brokeragePendingPayout: {
      accrued: accruedTotal,
      scheduled: scheduledTotal,
      total: accruedTotal + scheduledTotal,
    },
    openDisputesCount: openDisputes.length,
    pendingNotificationsCount: pendingNotifications,
    summary: {
      pendingActions: actionItems.length,
      outstandingTotal,
      duePaymentsCount: paymentsDueNext7Days.length,
      openDisputes: openDisputes.length,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Format builders
// ─────────────────────────────────────────────────────────────────────────────

function buildTextDigest(d: DigestData): string {
  const lines: string[] = [];
  lines.push(`BROKER OS — DAILY DIGEST`);
  lines.push(`${d.generatedAtDisplay}`);
  lines.push("=".repeat(48));
  lines.push("");
  lines.push(`Pending actions: ${d.summary.pendingActions}`);
  lines.push(`Outstanding receivable: ${fmtINR(d.summary.outstandingTotal)}`);
  lines.push(`Payments due (next 7 days): ${d.summary.duePaymentsCount}`);
  lines.push(`Open disputes: ${d.summary.openDisputes}`);
  lines.push(`Pending notifications: ${d.pendingNotificationsCount}`);
  lines.push("");

  lines.push("─ TODAY'S PRIORITISED ACTIONS ─");
  if (d.actionItems.length === 0) {
    lines.push("All caught up — no pending actions.");
  } else {
    d.actionItems.forEach((a, i) => {
      const prio = a.priority.toUpperCase();
      lines.push(`${i + 1}. [${prio}] ${a.title}`);
      lines.push(`   ${a.description}`);
      lines.push(`   Due: ${fmtDate(a.dueDate)}`);
    });
  }
  lines.push("");

  lines.push("─ OUTSTANDING RECEIVABLES ─");
  lines.push(`Total: ${fmtINR(d.outstandingReceivable.total)}`);
  if (d.outstandingReceivable.topClients.length > 0) {
    lines.push("Top clients with due:");
    d.outstandingReceivable.topClients.forEach((c) => {
      lines.push(`   • ${c.name}: ${fmtINR(c.due)}`);
    });
  }
  lines.push("");

  lines.push("─ OVERDUE DISPATCHES ─");
  if (d.overdueDispatches.length === 0) {
    lines.push("No overdue dispatches.");
  } else {
    d.overdueDispatches.forEach((x) => {
      lines.push(`   • ${x.poNumber} — ${x.supplierName} — ${pluralDays(x.daysOverdue)} overdue (was ${fmtDate(x.dueDate)})`);
    });
  }
  lines.push("");

  lines.push("─ PAYMENTS DUE (NEXT 7 DAYS) ─");
  if (d.paymentsDueNext7Days.length === 0) {
    lines.push("No payments due in the next 7 days.");
  } else {
    d.paymentsDueNext7Days.forEach((p) => {
      lines.push(`   • ${p.billNumber} — ${p.clientName} — ${fmtINR(p.amount)} — due ${fmtDate(p.dueDate)}`);
    });
  }
  lines.push("");

  lines.push("─ BROKERAGE PENDING PAYOUT ─");
  lines.push(`   Accrued (eligible, awaiting payout): ${fmtINR(d.brokeragePendingPayout.accrued)}`);
  lines.push(`   Scheduled (in a payout batch):       ${fmtINR(d.brokeragePendingPayout.scheduled)}`);
  lines.push(`   Total pending:                       ${fmtINR(d.brokeragePendingPayout.total)}`);
  lines.push("");

  lines.push("─ OPEN DISPUTES ─");
  lines.push(`${d.openDisputesCount} open dispute${d.openDisputesCount === 1 ? "" : "s"}.`);
  lines.push("");

  lines.push("=".repeat(48));
  lines.push("Generated by Garment Broker OS");
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function priorityBadge(p: Priority): string {
  const map: Record<Priority, { bg: string; fg: string; label: string }> = {
    urgent: { bg: "#fee2e2", fg: "#991b1b", label: "URGENT" },
    high: { bg: "#fef3c7", fg: "#92400e", label: "HIGH" },
    normal: { bg: "#d1fae5", fg: "#065f46", label: "NORMAL" },
  };
  const v = map[p];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:700;letter-spacing:0.04em;background:${v.bg};color:${v.fg};">${v.label}</span>`;
}

function buildHtmlDigest(d: DigestData): string {
  const accent = "#059669"; // emerald-600
  const accentDark = "#047857";
  const subtle = "#f1f5f9";
  const border = "#e2e8f0";
  const muted = "#64748b";
  const text = "#0f172a";

  // Action items rows
  const actionRows = d.actionItems.length
    ? d.actionItems
        .map(
          (a, i) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid ${border};vertical-align:top;width:32px;color:${muted};font-weight:600;">${i + 1}</td>
          <td style="padding:10px 12px;border-bottom:1px solid ${border};vertical-align:top;">
            <div style="font-weight:600;color:${text};font-size:14px;">${escapeHtml(a.title)}</div>
            <div style="color:${muted};font-size:12px;margin-top:2px;">${escapeHtml(a.description)}</div>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid ${border};vertical-align:top;white-space:nowrap;">${priorityBadge(a.priority)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid ${border};vertical-align:top;white-space:nowrap;color:${muted};font-size:12px;">${escapeHtml(fmtDate(a.dueDate))}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" style="padding:20px 12px;text-align:center;color:${muted};font-size:13px;">All caught up — no pending actions today.</td></tr>`;

  // Top clients rows
  const clientRows = d.outstandingReceivable.topClients.length
    ? d.outstandingReceivable.topClients
        .map(
          (c) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid ${border};color:${text};font-size:13px;">${escapeHtml(c.name)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid ${border};color:${text};font-size:13px;text-align:right;font-weight:600;white-space:nowrap;">${escapeHtml(fmtINR(c.due))}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="2" style="padding:14px 12px;text-align:center;color:${muted};font-size:13px;">No outstanding receivables.</td></tr>`;

  // Dispatch rows
  const dispatchRows = d.overdueDispatches.length
    ? d.overdueDispatches
        .map(
          (x) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid ${border};color:${text};font-size:13px;font-weight:600;">${escapeHtml(x.poNumber)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid ${border};color:${text};font-size:13px;">${escapeHtml(x.supplierName)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid ${border};color:${muted};font-size:12px;white-space:nowrap;">${escapeHtml(fmtDate(x.dueDate))}</td>
          <td style="padding:8px 12px;border-bottom:1px solid ${border};color:#b91c1c;font-size:12px;font-weight:600;white-space:nowrap;">${escapeHtml(pluralDays(x.daysOverdue))} overdue</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" style="padding:14px 12px;text-align:center;color:${muted};font-size:13px;">No overdue dispatches.</td></tr>`;

  // Payments due rows
  const paymentRows = d.paymentsDueNext7Days.length
    ? d.paymentsDueNext7Days
        .map(
          (p) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid ${border};color:${text};font-size:13px;font-weight:600;">${escapeHtml(p.billNumber)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid ${border};color:${text};font-size:13px;">${escapeHtml(p.clientName)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid ${border};color:${text};font-size:13px;text-align:right;font-weight:600;white-space:nowrap;">${escapeHtml(fmtINR(p.amount))}</td>
          <td style="padding:8px 12px;border-bottom:1px solid ${border};color:${muted};font-size:12px;white-space:nowrap;">${escapeHtml(fmtDate(p.dueDate))}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" style="padding:14px 12px;text-align:center;color:${muted};font-size:13px;">No payments due in the next 7 days.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Broker OS Daily Digest — ${escapeHtml(d.dateLabel)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${text};">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="640" style="max-width:640px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${border};box-shadow:0 1px 3px rgba(15,23,42,0.06);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,${accent} 0%,${accentDark} 100%);padding:24px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#a7f3d0;">Garment Broker OS</div>
                    <div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:4px;">Daily Digest</div>
                    <div style="font-size:13px;color:#d1fae5;margin-top:4px;">${escapeHtml(d.generatedAtDisplay)}</div>
                  </td>
                  <td align="right" valign="top" style="font-size:42px;line-height:1;">🧥</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- KPI strip -->
          <tr>
            <td style="padding:18px 28px 4px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td width="25%" style="padding:6px;">
                    <div style="background:${subtle};border-radius:10px;padding:12px;text-align:center;">
                      <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${muted};">Pending</div>
                      <div style="font-size:22px;font-weight:700;color:${accent};margin-top:2px;">${d.summary.pendingActions}</div>
                      <div style="font-size:11px;color:${muted};">actions</div>
                    </div>
                  </td>
                  <td width="25%" style="padding:6px;">
                    <div style="background:${subtle};border-radius:10px;padding:12px;text-align:center;">
                      <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${muted};">Outstanding</div>
                      <div style="font-size:18px;font-weight:700;color:#b45309;margin-top:2px;">${escapeHtml(fmtINRCompact(d.summary.outstandingTotal))}</div>
                      <div style="font-size:11px;color:${muted};">receivable</div>
                    </div>
                  </td>
                  <td width="25%" style="padding:6px;">
                    <div style="background:${subtle};border-radius:10px;padding:12px;text-align:center;">
                      <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${muted};">Due 7d</div>
                      <div style="font-size:22px;font-weight:700;color:#b45309;margin-top:2px;">${d.summary.duePaymentsCount}</div>
                      <div style="font-size:11px;color:${muted};">payments</div>
                    </div>
                  </td>
                  <td width="25%" style="padding:6px;">
                    <div style="background:${subtle};border-radius:10px;padding:12px;text-align:center;">
                      <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${muted};">Open</div>
                      <div style="font-size:22px;font-weight:700;color:#b91c1c;margin-top:2px;">${d.summary.openDisputes}</div>
                      <div style="font-size:11px;color:${muted};">disputes</div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Prioritised actions -->
          <tr>
            <td style="padding:18px 28px 6px 28px;">
              <div style="font-size:14px;font-weight:700;color:${text};border-left:3px solid ${accent};padding-left:10px;">Today's prioritised actions</div>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 28px 18px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid ${border};border-radius:10px;overflow:hidden;">
                <thead>
                  <tr style="background:${subtle};">
                    <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${muted};">#</th>
                    <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${muted};">Action</th>
                    <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${muted};">Priority</th>
                    <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${muted};">Due</th>
                  </tr>
                </thead>
                <tbody>${actionRows}</tbody>
              </table>
            </td>
          </tr>

          <!-- Outstanding receivables + Overdue dispatches -->
          <tr>
            <td style="padding:6px 28px 18px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td width="50%" style="padding-right:8px;vertical-align:top;">
                    <div style="font-size:14px;font-weight:700;color:${text};border-left:3px solid #b45309;padding-left:10px;margin-bottom:8px;">Outstanding receivables</div>
                    <div style="background:${subtle};border-radius:10px;padding:12px;">
                      <div style="font-size:11px;color:${muted};">Total outstanding</div>
                      <div style="font-size:20px;font-weight:700;color:#b45309;margin-top:2px;">${escapeHtml(fmtINR(d.outstandingReceivable.total))}</div>
                    </div>
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:8px;border:1px solid ${border};border-radius:10px;overflow:hidden;">
                      <thead>
                        <tr style="background:${subtle};">
                          <th style="padding:6px 12px;text-align:left;font-size:11px;font-weight:700;color:${muted};">Top clients</th>
                          <th style="padding:6px 12px;text-align:right;font-size:11px;font-weight:700;color:${muted};">Due</th>
                        </tr>
                      </thead>
                      <tbody>${clientRows}</tbody>
                    </table>
                  </td>
                  <td width="50%" style="padding-left:8px;vertical-align:top;">
                    <div style="font-size:14px;font-weight:700;color:${text};border-left:3px solid #b91c1c;padding-left:10px;margin-bottom:8px;">Overdue dispatches</div>
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid ${border};border-radius:10px;overflow:hidden;">
                      <thead>
                        <tr style="background:${subtle};">
                          <th style="padding:6px 12px;text-align:left;font-size:11px;font-weight:700;color:${muted};">PO</th>
                          <th style="padding:6px 12px;text-align:left;font-size:11px;font-weight:700;color:${muted};">Supplier</th>
                          <th style="padding:6px 12px;text-align:left;font-size:11px;font-weight:700;color:${muted};">Due</th>
                          <th style="padding:6px 12px;text-align:left;font-size:11px;font-weight:700;color:${muted};">Late</th>
                        </tr>
                      </thead>
                      <tbody>${dispatchRows}</tbody>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Payments due + brokerage -->
          <tr>
            <td style="padding:6px 28px 18px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td width="50%" style="padding-right:8px;vertical-align:top;">
                    <div style="font-size:14px;font-weight:700;color:${text};border-left:3px solid #b45309;padding-left:10px;margin-bottom:8px;">Payments due (next 7 days)</div>
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid ${border};border-radius:10px;overflow:hidden;">
                      <thead>
                        <tr style="background:${subtle};">
                          <th style="padding:6px 12px;text-align:left;font-size:11px;font-weight:700;color:${muted};">Bill</th>
                          <th style="padding:6px 12px;text-align:left;font-size:11px;font-weight:700;color:${muted};">Client</th>
                          <th style="padding:6px 12px;text-align:right;font-size:11px;font-weight:700;color:${muted};">Amount</th>
                          <th style="padding:6px 12px;text-align:left;font-size:11px;font-weight:700;color:${muted};">Due</th>
                        </tr>
                      </thead>
                      <tbody>${paymentRows}</tbody>
                    </table>
                  </td>
                  <td width="50%" style="padding-left:8px;vertical-align:top;">
                    <div style="font-size:14px;font-weight:700;color:${text};border-left:3px solid ${accent};padding-left:10px;margin-bottom:8px;">Brokerage pending payout</div>
                    <div style="background:${subtle};border-radius:10px;padding:14px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td style="font-size:12px;color:${muted};padding-bottom:6px;">Accrued (eligible)</td>
                          <td style="font-size:13px;font-weight:600;color:${text};text-align:right;padding-bottom:6px;white-space:nowrap;">${escapeHtml(fmtINR(d.brokeragePendingPayout.accrued))}</td>
                        </tr>
                        <tr>
                          <td style="font-size:12px;color:${muted};padding-bottom:6px;">Scheduled (in batch)</td>
                          <td style="font-size:13px;font-weight:600;color:${text};text-align:right;padding-bottom:6px;white-space:nowrap;">${escapeHtml(fmtINR(d.brokeragePendingPayout.scheduled))}</td>
                        </tr>
                        <tr>
                          <td style="font-size:13px;font-weight:700;color:${text};border-top:1px solid ${border};padding-top:8px;">Total pending</td>
                          <td style="font-size:16px;font-weight:700;color:${accent};text-align:right;padding-top:8px;white-space:nowrap;">${escapeHtml(fmtINR(d.brokeragePendingPayout.total))}</td>
                        </tr>
                      </table>
                    </div>
                    <div style="margin-top:10px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:10px 12px;">
                      <div style="font-size:12px;color:#b91c1c;font-weight:600;">⚠ ${d.openDisputesCount} open dispute${d.openDisputesCount === 1 ? "" : "s"} · ${d.pendingNotificationsCount} pending notification${d.pendingNotificationsCount === 1 ? "" : "s"}</div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:14px 28px;background:${subtle};border-top:1px solid ${border};">
              <div style="font-size:11px;color:${muted};text-align:center;">
                Generated by Garment Broker OS · Brokerage excl. GST, paid on full bill settlement
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI brief via z-ai-web-dev-sdk
// Builds a concise data summary → LLM → returns { subject, body }.
// Falls back to a templated brief if the LLM call fails (so the UI always
// gets a usable response).
// ─────────────────────────────────────────────────────────────────────────────
async function buildEmailBrief(d: DigestData): Promise<{ subject: string; body: string; aiGenerated: boolean }> {
  const subject = `Broker OS Daily Digest — ${d.dateLabel}`;

  // Build a compact data summary for the LLM to write from.
  const dataSummary = {
    date: d.dateLabel,
    generatedAt: d.generatedAtDisplay,
    pendingActions: d.summary.pendingActions,
    outstandingReceivableINR: fmtINR(d.outstandingReceivable.total),
    paymentsDueNext7Days: d.summary.duePaymentsCount,
    openDisputes: d.summary.openDisputes,
    pendingNotifications: d.pendingNotificationsCount,
    topActions: d.actionItems.slice(0, 6).map((a) => ({
      priority: a.priority,
      title: a.title,
      description: a.description,
    })),
    topClientsWithDue: d.outstandingReceivable.topClients.map((c) => ({
      name: c.name,
      dueINR: fmtINR(c.due),
    })),
    overdueDispatches: d.overdueDispatches.slice(0, 4).map((x) => ({
      poNumber: x.poNumber,
      supplier: x.supplierName,
      daysOverdue: x.daysOverdue,
    })),
    paymentsDue: d.paymentsDueNext7Days.slice(0, 4).map((p) => ({
      billNumber: p.billNumber,
      client: p.clientName,
      amountINR: fmtINR(p.amount),
      dueDate: fmtDate(p.dueDate),
    })),
    brokeragePendingPayoutINR: fmtINR(d.brokeragePendingPayout.total),
    brokerageAccruedINR: fmtINR(d.brokeragePendingPayout.accrued),
    brokerageScheduledINR: fmtINR(d.brokeragePendingPayout.scheduled),
  };

  const systemPrompt =
    "You are a concise, professional assistant briefing a garment broker on their day. " +
    "Summarize the key actions needed today based on the data. Be specific with names and amounts. " +
    "Keep it under 200 words. Use Indian Rupee formatting (e.g. ₹1,25,000). " +
    "Write 3-4 short paragraphs in a friendly but professional tone, as if briefing the broker over morning coffee. " +
    "Do not use markdown headings or bullet points — just plain paragraphs. " +
    "Start with a one-line greeting that includes the date.";

  const userPrompt =
    "Here is today's broker digest data (JSON):\n\n" +
    JSON.stringify(dataSummary, null, 2) +
    "\n\nWrite the morning brief now.";

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      thinking: { type: "disabled" },
    });
    const body =
      completion?.choices?.[0]?.message?.content?.trim() ||
      buildFallbackBrief(d);
    return { subject, body, aiGenerated: !!completion?.choices?.[0]?.message?.content };
  } catch {
    return { subject, body: buildFallbackBrief(d), aiGenerated: false };
  }
}

// Templated fallback brief — used if the LLM is unavailable or returns empty.
function buildFallbackBrief(d: DigestData): string {
  const parts: string[] = [];
  parts.push(
    `Good morning. Here's your broker brief for ${d.dateLabel}. ` +
      `You have ${d.summary.pendingActions} pending action${d.summary.pendingActions === 1 ? "" : "s"} to address today, ` +
      `with ${d.summary.outstandingTotal > 0 ? fmtINR(d.summary.outstandingTotal) + " outstanding across receivables" : "no outstanding receivables"}.`,
  );
  if (d.outstandingReceivable.topClients.length > 0) {
    const top = d.outstandingReceivable.topClients[0];
    parts.push(
      `Your top due is from ${top.name} at ${fmtINR(top.due)}. ` +
        `${d.summary.duePaymentsCount} payment${d.summary.duePaymentsCount === 1 ? "" : "s"} fall due in the next 7 days — follow up promptly to keep cashflow healthy.`,
    );
  }
  if (d.overdueDispatches.length > 0) {
    const first = d.overdueDispatches[0];
    parts.push(
      `${d.overdueDispatches.length} dispatch${d.overdueDispatches.length === 1 ? "" : "es"} ${d.overdueDispatches.length === 1 ? "is" : "are"} overdue, the most overdue being ${first.poNumber} from ${first.supplierName} (${pluralDays(first.daysOverdue)} late). Chase the supplier and record the dispatch as soon as it ships.`,
    );
  }
  parts.push(
    `${fmtINR(d.brokeragePendingPayout.total)} in brokerage is awaiting payout ` +
      `(${fmtINR(d.brokeragePendingPayout.accrued)} accrued + ${fmtINR(d.brokeragePendingPayout.scheduled)} scheduled). ` +
      `${d.openDisputesCount} open dispute${d.openDisputesCount === 1 ? "" : "s"} ${d.openDisputesCount === 1 ? "needs" : "need"} resolution. ` +
      `Have a productive day.`,
  );
  return parts.join("\n\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "text").toLowerCase();
  const validFormats = ["text", "html", "email"];
  if (!validFormats.includes(format)) {
    return NextResponse.json(
      { error: `Invalid format. Use one of: ${validFormats.join(", ")}.` },
      { status: 400 },
    );
  }

  const data = await gatherDigestData(broker.id);

  const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate" };

  if (format === "text") {
    return NextResponse.json(
      { format: "text", text: buildTextDigest(data), stats: data.summary, generatedAt: data.generatedAt },
      { headers: noStore },
    );
  }

  if (format === "html") {
    return NextResponse.json(
      { format: "html", html: buildHtmlDigest(data), stats: data.summary, generatedAt: data.generatedAt },
      { headers: noStore },
    );
  }

  // format === "email" — AI brief via LLM
  const brief = await buildEmailBrief(data);
  return NextResponse.json(
    {
      format: "email",
      subject: brief.subject,
      body: brief.body,
      aiGenerated: brief.aiGenerated,
      stats: data.summary,
      generatedAt: data.generatedAt,
    },
    { headers: noStore },
  );
}
