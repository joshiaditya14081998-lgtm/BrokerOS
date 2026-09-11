import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { getCurrentBroker } from "@/lib/auth";
import { checkLimit } from "@/lib/usage-limits";
import { withRateLimit } from "@/lib/api-middleware";
import { reportError } from "@/lib/error-report";

const LineItemSchema = z.object({
  styleName: z.string().min(1),
  color: z.string().optional().nullable(),
  setQty: z.number().int().min(1),
  unitPrice: z.number().min(0),
});

const BookingSchema = z.object({
  visitId: z.string().min(1),
  clientId: z.string().optional(), // optional — derived from visit if not provided
  supplierId: z.string().min(1),
  commissionRate: z.number().optional().nullable(),
  bookingDate: z.string().optional(),
  notes: z.string().optional().nullable(),
  lineItems: z.array(LineItemSchema).min(1),
});

// GET /api/bookings
export async function GET(_req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bookings = await db.booking.findMany({
    where: { brokerId: broker.id },
    include: {
      visit: { select: { plannedDate: true, status: true } },
      client: { select: { name: true } },
      supplier: { select: { name: true } },
      lineItems: true,
      purchaseOrder: { select: { id: true, poNumber: true, status: true, totalValue: true } },
    },
    orderBy: { bookingDate: "desc" },
  });
  return NextResponse.json({ bookings });
}

// POST /api/bookings — creates a booking AND auto-generates the linked PO.
// Rate-limited at 20 req/min per IP — bookings + POs are heavier writes
// (audit log entries, derived totals), so cap them tighter than clients.
export const POST = withRateLimit(
  async (req: NextRequest) => {
    try {
      const broker = await getCurrentBroker();
      if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const body = await req.json();
      const parsed = BookingSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

      // Usage-limit check — every booking creates a PO, so check the PO limit.
      // 402 if at capacity. Checked BEFORE the visit/supplier/client lookups so
      // the broker gets a fast "you've hit your PO cap" rejection.
      const limit = await checkLimit(broker.id, "pos");
      if (!limit.allowed) {
        return NextResponse.json(
          {
            error: "Purchase order limit reached. Upgrade to add more orders.",
            current: limit.current,
            limit: limit.limit,
            planName: limit.planName,
          },
          { status: 402 },
        );
      }

      const { visitId, clientId: clientIdRaw, supplierId, commissionRate, bookingDate, notes, lineItems } = parsed.data;

      // Derive clientId from the visit if not explicitly provided (visit must belong to this broker).
      let clientId = clientIdRaw;
      if (!clientId) {
        const visit = await db.visit.findUnique({ where: { id: visitId, brokerId: broker.id }, select: { clientId: true } });
        if (!visit) return NextResponse.json({ error: "Visit not found" }, { status: 400 });
        clientId = visit.clientId;
      }

      const supplier = await db.supplier.findUnique({ where: { id: supplierId, brokerId: broker.id } });
      if (!supplier) return NextResponse.json({ error: "Supplier not found" }, { status: 400 });
      const client = await db.client.findUnique({ where: { id: clientId, brokerId: broker.id } });
      if (!client) return NextResponse.json({ error: "Client not found" }, { status: 400 });

      const effCommission = commissionRate ?? supplier.defaultCommissionRate;
      const effGst = client.gstRate;
      const totalValue = lineItems.reduce((s, i) => s + i.setQty * i.unitPrice, 0);

      // Generate next PO number — count only this broker's POs to keep numbering scoped.
      const poCount = await db.purchaseOrder.count({ where: { brokerId: broker.id } });
      const poNumber = `PO-${new Date().getFullYear()}-${String(poCount + 1).padStart(4, "0")}`;

      const booking = await db.booking.create({
        data: {
          brokerId: broker.id,
          visitId,
          clientId,
          supplierId,
          commissionRate: effCommission,
          bookingDate: bookingDate ? new Date(bookingDate) : new Date(),
          notes,
          lineItems: { create: lineItems.map((i) => ({ styleName: i.styleName, color: i.color ?? null, setQty: i.setQty, unitPrice: i.unitPrice })) },
          purchaseOrder: {
            create: {
              brokerId: broker.id,
              poNumber,
              clientId,
              supplierId,
              lineItemsJson: JSON.stringify(lineItems.map((i) => ({ styleName: i.styleName, color: i.color, setQty: i.setQty, unitPrice: i.unitPrice, lineTotal: i.setQty * i.unitPrice }))),
              totalValue,
              commissionRate: effCommission,
              gstRate: effGst,
              status: "open",
            },
          },
        },
        include: { purchaseOrder: true, lineItems: true },
      });

      await db.auditLog.create({ data: { brokerId: broker.id, entityType: "Booking", entityId: booking.id, action: "create", after: JSON.stringify(booking), userName: broker.fullName } });
      // The PO is unconditionally created above via nested `create`, so it is never null here.
      const po = booking.purchaseOrder!;
      await db.auditLog.create({ data: { brokerId: broker.id, entityType: "PurchaseOrder", entityId: po.id, action: "create", after: JSON.stringify(po), userName: broker.fullName, reason: "Auto-generated from booking." } });

      return NextResponse.json({ booking, po });
    } catch (error) {
      reportError(error, { path: "/api/bookings", method: "POST" });
      return NextResponse.json({ error: "Failed to create booking" }, { status: 500 });
    }
  },
  20,
  60_000,
);
