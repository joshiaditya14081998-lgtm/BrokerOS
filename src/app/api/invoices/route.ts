import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { withRateLimit } from "@/lib/api-middleware";
import { reportError } from "@/lib/error-report";
import { z } from "zod";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Invoices — GST-compliant service invoices for clients.
//
// GET  /api/invoices?status=<>&clientId=<>&from=ISO&to=ISO&q=<>
// POST /api/invoices  { clientId, issueDate, dueDate?, items, gstRate?, notes?, placeOfSupply? }
//
// Status transitions + delete live in `[id]/route.ts` (PATCH/DELETE) which
// imports `INVOICE_STATUSES` + `InvoiceStatus` from this module.
//
// Invoice numbers are auto-generated as `INV-YYYY-NNNN` (zero-padded sequence
// per calendar year) — the `NNNN` is `currentCountForYear + 1`. There's a
// small race window between count + create, but @unique on `invoiceNumber`
// guarantees no collision at the DB level; a rare collision bubbles up as a
// 500 and the broker retries. Good enough for v1 single-broker use.
// ─────────────────────────────────────────────────────────────────────────────

export const INVOICE_STATUSES = ["pending", "paid", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

const ItemSchema = z.object({
  description: z.string().min(1),
  hsnCode: z.string().optional().nullable().default("9985"),
  quantity: z.number().min(0.01).default(1),
  rate: z.number().min(0),
});
const CreateSchema = z.object({
  clientId: z.string().min(1),
  issueDate: z.string(),
  dueDate: z.string().optional().nullable(),
  items: z.array(ItemSchema).min(1),
  gstRate: z.number().min(0).max(100).default(5.0),
  notes: z.string().optional().nullable(),
  placeOfSupply: z.string().optional().nullable(),
});

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Generate `INV-YYYY-NNNN` — NNNN = number of invoices this broker has
// already created in year YYYY, plus 1. Zero-padded to 4 digits.
async function generateInvoiceNumber(brokerId: string, issueDate: Date): Promise<string> {
  const year = issueDate.getFullYear();
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);
  const count = await db.invoice.count({
    where: {
      brokerId,
      issueDate: { gte: yearStart, lt: yearEnd },
    },
  });
  const seq = String(count + 1).padStart(4, "0");
  return `INV-${year}-${seq}`;
}

// GET — list invoices for the broker with optional filters.
export const GET = withRateLimit(
  async (req: NextRequest) => {
    try {
      const broker = await getCurrentBroker();
      if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const { searchParams } = new URL(req.url);
      const status = searchParams.get("status")?.trim() || undefined;
      const clientId = searchParams.get("clientId")?.trim() || undefined;
      const from = parseDate(searchParams.get("from"));
      const toRaw = parseDate(searchParams.get("to"));
      const q = searchParams.get("q")?.trim().toLowerCase() || undefined;

      // Defensive: only apply `status` if it's a known value.
      const statusFilter =
        status && (INVOICE_STATUSES as readonly string[]).includes(status)
          ? status
          : undefined;
      const to = toRaw ? new Date(toRaw.getTime()) : null;
      if (to) to.setHours(23, 59, 59, 999);

      const where = {
        brokerId: broker.id,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(clientId ? { clientId } : {}),
        ...(from || to
          ? { issueDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
        ...(q ? { invoiceNumber: { contains: q } } : {}),
      };

      const invoices = await db.invoice.findMany({
        where,
        orderBy: { issueDate: "desc" },
        include: {
          client: { select: { id: true, name: true, gstNo: true, address: true } },
        },
      });

      return NextResponse.json({ invoices });
    } catch (error) {
      reportError(error, { path: "/api/invoices", method: "GET" });
      return NextResponse.json({ error: "Failed to load invoices" }, { status: 500 });
    }
  },
  30,
  60_000,
);

// POST — create a new invoice. Auto-generates invoice number + computes
// subtotal / GST / round-off / total server-side (the client's preview is
// for display only; the persisted numbers are authoritative).
export const POST = withRateLimit(
  async (req: NextRequest) => {
    try {
      const broker = await getCurrentBroker();
      if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const body = await req.json();
      const parsed = CreateSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }
      const input = parsed.data;

      // Verify the client belongs to this broker (no cross-tenant invoice
      // creation). 404 — not 403 — so we don't leak existence of other
      // brokers' client IDs.
      const client = await db.client.findFirst({
        where: { id: input.clientId, brokerId: broker.id },
        select: { id: true, name: true },
      });
      if (!client) {
        return NextResponse.json({ error: "Client not found" }, { status: 404 });
      }

      const issueDate = new Date(input.issueDate);
      const dueDate = input.dueDate ? new Date(input.dueDate) : null;

      // Compute totals server-side — these are the authoritative numbers.
      const items = input.items.map((it) => ({
        description: it.description,
        hsnCode: it.hsnCode ?? "9985",
        quantity: it.quantity,
        rate: it.rate,
        amount: it.quantity * it.rate,
      }));
      const subtotal = items.reduce((s, it) => s + it.amount, 0);
      const gstAmount = subtotal * (input.gstRate / 100);
      const rawTotal = subtotal + gstAmount;
      const totalAmount = Math.round(rawTotal);
      const roundOff = totalAmount - rawTotal;

      const invoiceNumber = await generateInvoiceNumber(broker.id, issueDate);

      const invoice = await db.invoice.create({
        data: {
          brokerId: broker.id,
          clientId: input.clientId,
          invoiceNumber,
          issueDate,
          dueDate,
          itemsJson: JSON.stringify(items),
          subtotal,
          gstRate: input.gstRate,
          gstAmount,
          roundOff,
          totalAmount,
          status: "pending",
          notes: input.notes?.trim() || null,
          placeOfSupply: input.placeOfSupply?.trim() || null,
        },
        include: {
          client: { select: { id: true, name: true, gstNo: true, address: true } },
        },
      });

      await db.auditLog.create({
        data: {
          brokerId: broker.id,
          entityType: "Invoice",
          entityId: invoice.id,
          action: "create",
          after: JSON.stringify(invoice),
          userName: "Broker",
          reason: `Invoice created: ${invoice.invoiceNumber} · ${client.name} · ₹${totalAmount}`,
        },
      });

      return NextResponse.json({ invoice }, { status: 201 });
    } catch (error) {
      reportError(error, { path: "/api/invoices", method: "POST" });
      return NextResponse.json({ error: "Failed to create invoice" }, { status: 500 });
    }
  },
  30,
  60_000,
);
