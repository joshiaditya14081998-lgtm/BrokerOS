import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Unified global search across ALL entity types in Broker OS.
//
// SQLite (Prisma's provider here) does NOT support `mode: "insensitive"` on
// `contains` filters — string comparisons use the BINARY collation and are
// case-sensitive. To provide a true case-insensitive "contains" experience
// we fetch a capped candidate set per entity (no WHERE filter) and apply the
// matching + scoring in JS. Data volume per table in a single-broker shop is
// well under the cap so this is fast.

type SearchResultType =
  | "Client"
  | "Supplier"
  | "Visit"
  | "PurchaseOrder"
  | "Dispatch"
  | "Bill"
  | "Payment"
  | "Dispute"
  | "Notification"
  | "AuditLog";

export type SearchResult = {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string;
  entityType: string;
  entityId: string;
  score: number;
};

// Per-entity candidate cap. Generous enough to cover real broker volumes
// (a few hundred to a few thousand rows per table) while keeping the
// in-memory scan trivially fast.
const CAP = 1500;

// Score a single field against the lowercased query. Returns -1 if no match.
//
// Scoring rules (per task spec):
//   exact match (case-insensitive): 100
//   starts with query:               80
//   contains at word boundary:        60
//   contains anywhere:                40
//   minus 1 point per char of position (earlier = higher)
function scoreField(qLower: string, field: string): number {
  if (!field) return -1;
  const fl = field.toLowerCase();
  if (fl === qLower) return 100;
  const pos = fl.indexOf(qLower);
  if (pos === -1) return -1;
  if (pos === 0) return 80;
  // Word boundary: previous char is non-word (space, punctuation, start).
  const isWordBoundary = /\W/.test(fl[pos - 1]);
  const base = isWordBoundary ? 60 : 40;
  return base - pos;
}

// Score across multiple fields — take the best.
function scoreMatch(qLower: string, ...fields: (string | null | undefined)[]): number {
  let best = -1;
  for (const f of fields) {
    if (!f) continue;
    const s = scoreField(qLower, f);
    if (s > best) best = s;
  }
  return best;
}

function truncate(s: string | null | undefined, n = 60): string {
  if (!s) return "";
  const trimmed = s.trim().replace(/\s+/g, " ");
  return trimmed.length > n ? trimmed.slice(0, n - 1) + "…" : trimmed;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export async function GET(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const qRaw = (searchParams.get("q") ?? "").trim();
  const limitRaw = parseInt(searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 20;

  // Empty or single-char queries return nothing — avoids noisy 1-char matches.
  if (qRaw.length < 2) {
    return NextResponse.json({ results: [] });
  }
  const qLower = qRaw.toLowerCase();

  // Fetch candidates from every entity type in parallel.
  const [
    clients,
    suppliers,
    visits,
    pos,
    dispatches,
    bills,
    payments,
    disputes,
    notifications,
    auditLogs,
  ] = await Promise.all([
    db.client.findMany({
      where: { brokerId: broker.id },
      take: CAP,
      select: {
        id: true,
        name: true,
        contactPerson: true,
        phone: true,
        email: true,
        gstNo: true,
      },
    }),
    db.supplier.findMany({
      where: { brokerId: broker.id },
      take: CAP,
      select: {
        id: true,
        name: true,
        contactPerson: true,
        phone: true,
        email: true,
        gstNo: true,
      },
    }),
    db.visit.findMany({
      where: { brokerId: broker.id },
      take: CAP,
      select: {
        id: true,
        clientId: true,
        notes: true,
        plannedDate: true,
        status: true,
        client: { select: { name: true } },
      },
    }),
    db.purchaseOrder.findMany({
      where: { brokerId: broker.id },
      take: CAP,
      select: {
        id: true,
        poNumber: true,
        status: true,
        client: { select: { name: true } },
        supplier: { select: { name: true } },
      },
    }),
    db.dispatch.findMany({
      where: { brokerId: broker.id },
      take: CAP,
      select: {
        id: true,
        notes: true,
        dispatchDate: true,
        status: true,
        po: { select: { poNumber: true } },
      },
    }),
    db.bill.findMany({
      where: { brokerId: broker.id },
      take: CAP,
      select: {
        id: true,
        billNumber: true,
        status: true,
        poId: true,
        client: { select: { name: true } },
      },
    }),
    db.payment.findMany({
      where: { brokerId: broker.id },
      take: CAP,
      select: {
        id: true,
        reference: true,
        notes: true,
        amount: true,
        date: true,
        bill: { select: { billNumber: true } },
      },
    }),
    db.dispute.findMany({
      where: { brokerId: broker.id },
      take: CAP,
      select: {
        id: true,
        type: true,
        description: true,
        resolution: true,
        status: true,
        po: { select: { poNumber: true } },
      },
    }),
    db.notification.findMany({
      where: { brokerId: broker.id },
      take: CAP,
      select: {
        id: true,
        title: true,
        message: true,
        type: true,
        dueDate: true,
        status: true,
      },
    }),
    db.auditLog.findMany({
      where: { brokerId: broker.id },
      take: CAP,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        action: true,
        reason: true,
        userName: true,
        createdAt: true,
      },
    }),
  ]);

  const results: SearchResult[] = [];

  // Clients — match on name, contactPerson, phone, email, gstNo.
  for (const c of clients) {
    const score = scoreMatch(qLower, c.name, c.contactPerson, c.phone, c.email, c.gstNo);
    if (score < 0) continue;
    const subtitleParts = [c.contactPerson, c.phone].filter(Boolean);
    results.push({
      id: c.id,
      type: "Client",
      title: c.name,
      subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : "—",
      entityType: "Client",
      entityId: c.id,
      score,
    });
  }

  // Suppliers — match on name, contactPerson, phone, email, gstNo.
  for (const s of suppliers) {
    const score = scoreMatch(qLower, s.name, s.contactPerson, s.phone, s.email, s.gstNo);
    if (score < 0) continue;
    const subtitleParts = [s.contactPerson, s.phone].filter(Boolean);
    results.push({
      id: s.id,
      type: "Supplier",
      title: s.name,
      subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : "—",
      entityType: "Supplier",
      entityId: s.id,
      score,
    });
  }

  // Visits — match on notes; title shows the linked client.
  for (const v of visits) {
    const score = scoreMatch(qLower, v.notes);
    if (score < 0) continue;
    const clientName = v.client?.name ?? "Visit";
    const dateStr = fmtDate(v.plannedDate);
    const notesPreview = truncate(v.notes, 50);
    const subtitleParts = [dateStr, notesPreview].filter(Boolean);
    results.push({
      id: v.id,
      type: "Visit",
      title: clientName,
      subtitle: subtitleParts.join(" · "),
      entityType: "Visit",
      entityId: v.id,
      score,
    });
  }

  // PurchaseOrders — match on poNumber (exact-ish).
  for (const p of pos) {
    const score = scoreMatch(qLower, p.poNumber);
    if (score < 0) continue;
    const subtitleParts = [p.client?.name, p.supplier?.name].filter(Boolean);
    results.push({
      id: p.id,
      type: "PurchaseOrder",
      title: p.poNumber,
      subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : (p.status ?? "—"),
      entityType: "PurchaseOrder",
      entityId: p.id,
      score,
    });
  }

  // Dispatches — match on notes.
  for (const d of dispatches) {
    const score = scoreMatch(qLower, d.notes);
    if (score < 0) continue;
    const poLabel = d.po?.poNumber ? `PO ${d.po.poNumber}` : "Dispatch";
    const dateStr = fmtDate(d.dispatchDate);
    const subtitleParts = [dateStr, d.status, poLabel].filter(Boolean);
    results.push({
      id: d.id,
      type: "Dispatch",
      title: poLabel,
      subtitle: subtitleParts.join(" · "),
      entityType: "Dispatch",
      entityId: d.id,
      score,
    });
  }

  // Bills — match on billNumber; entityId = poId so opening jumps to the PO.
  for (const b of bills) {
    const score = scoreMatch(qLower, b.billNumber);
    if (score < 0) continue;
    results.push({
      id: b.id,
      type: "Bill",
      title: b.billNumber,
      subtitle: b.client?.name ?? (b.status ?? "—"),
      entityType: "PurchaseOrder",
      entityId: b.poId,
      score,
    });
  }

  // Payments — match on reference + notes.
  for (const p of payments) {
    const score = scoreMatch(qLower, p.reference, p.notes);
    if (score < 0) continue;
    const amountStr = `₹${Math.round(p.amount ?? 0).toLocaleString("en-IN")}`;
    const dateStr = fmtDate(p.date);
    const billRef = p.bill?.billNumber ?? "";
    const subtitleParts = [amountStr, billRef, dateStr].filter(Boolean);
    const title = p.reference?.trim() || (billRef ? `Payment · ${billRef}` : "Payment");
    results.push({
      id: p.id,
      type: "Payment",
      title,
      subtitle: subtitleParts.join(" · "),
      entityType: "Payment",
      entityId: p.id,
      score,
    });
  }

  // Disputes — match on description + resolution.
  for (const d of disputes) {
    const score = scoreMatch(qLower, d.description, d.resolution);
    if (score < 0) continue;
    const poLabel = d.po?.poNumber ? `PO ${d.po.poNumber}` : d.type;
    const desc = truncate(d.description, 50) || truncate(d.resolution, 50) || d.type;
    results.push({
      id: d.id,
      type: "Dispute",
      title: poLabel,
      subtitle: [d.type, desc].filter(Boolean).join(" · "),
      entityType: "Dispute",
      entityId: d.id,
      score,
    });
  }

  // Notifications — match on title + message.
  for (const n of notifications) {
    const score = scoreMatch(qLower, n.title, n.message);
    if (score < 0) continue;
    const dateStr = fmtDate(n.dueDate);
    const msgPreview = truncate(n.message, 60);
    const subtitleParts = [dateStr, msgPreview].filter(Boolean);
    results.push({
      id: n.id,
      type: "Notification",
      title: n.title,
      subtitle: subtitleParts.join(" · "),
      entityType: "Notification",
      entityId: n.id,
      score,
    });
  }

  // AuditLog — match on reason, action, entityId.
  for (const a of auditLogs) {
    const score = scoreMatch(qLower, a.reason, a.action, a.entityId);
    if (score < 0) continue;
    const title = `${a.action} · ${a.entityType}`;
    const subtitle =
      truncate(a.reason, 50) ||
      [a.userName, `${a.entityType} ${a.entityId.slice(-6)}`].filter(Boolean).join(" · ");
    results.push({
      id: a.id,
      type: "AuditLog",
      title,
      subtitle,
      entityType: "AuditLog",
      entityId: a.id,
      score,
    });
  }

  // Sort by score desc (earlier + better matches first), then alphabetically
  // by title for stable ordering of equal-score ties.
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.title.localeCompare(b.title);
  });

  // Strip the internal `score` field from the response payload.
  const top = results.slice(0, limit).map((r) => {
    const { score: _score, ...rest } = r;
    void _score;
    return rest;
  });

  return NextResponse.json({ results: top });
}
