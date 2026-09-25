import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { withRateLimit, type RouteContext } from "@/lib/api-middleware";
import { reportError } from "@/lib/error-report";
import { invalidateBrokerCache } from "@/lib/cache";
import { z } from "zod";
import { INVOICE_STATUSES, type InvoiceStatus } from "@/app/api/invoices/route";

// PATCH — partial update of an invoice. Used for status transitions
// (pending → paid / cancelled) and for adjusting notes / dueDate. Verifies
// brokerId ownership before mutating. AuditLog captures before/after so a
// disputed "I never marked that paid" claim can be resolved from the trail.
const PatchSchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  notes: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
});

// GET — invoice detail with parsed items + client relation. Used by the
// "View" Sheet in the list UI + by the PDF report builder (via a direct Prisma
// call, not this route, but the shape is the same). Ownership: 404 if the
// invoice doesn't exist OR belongs to a different broker (no tenant leak).
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const invoice = await db.invoice.findUnique({
    where: { id },
    include: { client: { select: { id: true, name: true, gstNo: true, address: true, email: true, phone: true } } },
  });
  if (!invoice || invoice.brokerId !== broker.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Parse itemsJson so the client gets a structured array, not a JSON string.
  let items: Array<{ description: string; hsnCode?: string | null; quantity: number; rate: number; amount: number }> = [];
  try {
    items = JSON.parse(invoice.itemsJson) as typeof items;
  } catch {
    items = [];
  }

  return NextResponse.json({ invoice: { ...invoice, items } });
}

export const PATCH = withRateLimit(
  async (req: NextRequest, ctx: RouteContext) => {
    try {
      const broker = await getCurrentBroker();
      if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const { id } = await ctx.params;
      const before = await db.invoice.findUnique({
        where: { id },
        include: { client: { select: { name: true } } },
      });
      if (!before || before.brokerId !== broker.id) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      const body = await req.json();
      const parsed = PatchSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      // Only carry forward non-undefined fields so a PATCH with just `status`
      // doesn't null out notes/dueDate. Strings trimmed; empty → null.
      const next = parsed.data;
      const data: Record<string, unknown> = {};
      let reason: string | undefined;
      if (next.status !== undefined) {
        data.status = next.status as InvoiceStatus;
        if (next.status === "paid" && before.status !== "paid") {
          reason = `Invoice marked paid: ${before.invoiceNumber} · ${before.client.name}`;
        } else if (next.status === "cancelled" && before.status !== "cancelled") {
          reason = `Invoice cancelled: ${before.invoiceNumber} · ${before.client.name}`;
        } else if (next.status !== before.status) {
          reason = `Invoice status: ${before.status} → ${next.status} · ${before.invoiceNumber}`;
        }
      }
      if (next.notes !== undefined) data.notes = next.notes?.trim() || null;
      if (next.dueDate !== undefined) data.dueDate = next.dueDate ? new Date(next.dueDate) : null;

      const invoice = await db.invoice.update({
        where: { id },
        data,
        include: { client: { select: { id: true, name: true, gstNo: true } } },
      });

      await db.auditLog.create({
        data: {
          brokerId: broker.id,
          entityType: "Invoice",
          entityId: id,
          action: "update",
          before: JSON.stringify(before),
          after: JSON.stringify(invoice),
          userName: "Broker",
          reason,
        },
      });

      invalidateBrokerCache(broker.id); return NextResponse.json({ invoice });
    } catch (error) {
      reportError(error, { path: "/api/invoices/[id]", method: "PATCH" });
      return NextResponse.json({ error: "Failed to update invoice" }, { status: 500 });
    }
  },
  30,
  60_000,
);

// DELETE — hard-delete. Only allowed when status === "pending" (the only
// "soft" state). Paid / cancelled invoices must remain on record for audit +
// GST reconciliation. Returns `{ ok: true }`. AuditLog retains the `before`
// snapshot so a deleted pending invoice can still be reconstructed.
export const DELETE = withRateLimit(
  async (_req: NextRequest, ctx: RouteContext) => {
    try {
      const broker = await getCurrentBroker();
      if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const { id } = await ctx.params;
      const before = await db.invoice.findUnique({
        where: { id },
        include: { client: { select: { name: true } } },
      });
      if (!before || before.brokerId !== broker.id) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (before.status !== "pending") {
        return NextResponse.json(
          { error: "Only pending invoices can be deleted" },
          { status: 400 },
        );
      }

      await db.invoice.delete({ where: { id } });

      await db.auditLog.create({
        data: {
          brokerId: broker.id,
          entityType: "Invoice",
          entityId: id,
          action: "delete",
          before: JSON.stringify(before),
          userName: "Broker",
          reason: `Deleted pending invoice: ${before.invoiceNumber} · ${before.client.name}`,
        },
      });

      invalidateBrokerCache(broker.id); return NextResponse.json({ ok: true });
    } catch (error) {
      reportError(error, { path: "/api/invoices/[id]", method: "DELETE" });
      return NextResponse.json({ error: "Failed to delete invoice" }, { status: 500 });
    }
  },
  30,
  60_000,
);
