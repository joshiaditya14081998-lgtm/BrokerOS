import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { getCurrentBroker } from "@/lib/auth";
import { checkLimit } from "@/lib/usage-limits";
import { withRateLimit } from "@/lib/api-middleware";

const SupplierSchema = z.object({
  name: z.string().min(1),
  contactPerson: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  gstNo: z.string().optional().nullable(),
  defaultCommissionRate: z.number().min(0).max(100).default(5),
  defaultGstRate: z.number().min(0).max(100).default(5),
  notes: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const detail = searchParams.get("detail") === "true";
  if (detail) {
    const suppliers = await db.supplier.findMany({
      where: { brokerId: broker.id },
      include: {
        bills: { select: { id: true, finalAmount: true, paidAmount: true, status: true, baseAmount: true, createdAt: true } },
        dispatches: { select: { id: true, status: true, dispatchedQty: true, dispatchDate: true, po: { select: { totalValue: true, lineItemsJson: true } } } },
        brokerages: { select: { id: true, brokerageAmount: true, eligible: true, payoutStatus: true, bill: { select: { billNumber: true } } } },
        tags: { include: { tag: { select: { id: true, name: true, color: true } } }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { name: "asc" },
    });
    const now = new Date();
    const months: { label: string; start: Date; end: Date }[] = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      months.push({ label: start.toLocaleDateString("en-IN", { month: "short" }), start, end });
    }
    const rows = suppliers.map((s) => {
      const totalSupplied = s.bills.reduce((a, b) => a + b.baseAmount, 0);
      const outstandingBrokerage = s.brokerages.filter((b) => b.eligible && b.payoutStatus !== "paid").reduce((a, b) => a + b.brokerageAmount, 0);
      const paidBrokerage = s.brokerages.filter((b) => b.payoutStatus === "paid").reduce((a, b) => a + b.brokerageAmount, 0);
      const totalOrderedQty = s.dispatches.reduce((a, d) => {
        const ordered = JSON.parse(d.po.lineItemsJson).reduce((x: number, i: { setQty: number }) => x + i.setQty, 0);
        return a + ordered;
      }, 0);
      const totalDispatchedQty = s.dispatches.reduce((a, d) => a + d.dispatchedQty, 0);
      const fulfillment = totalOrderedQty ? Math.round((totalDispatchedQty / totalOrderedQty) * 100) : 0;
      const shortShipmentRate = s.dispatches.length ? Math.round((s.dispatches.filter((d) => d.status === "short_shipment").length / s.dispatches.length) * 100) : 0;
      const volumeTrend = months.map((m) => ({
        label: m.label,
        value: s.bills.filter((b) => b.createdAt >= m.start && b.createdAt < m.end).reduce((a, b) => a + b.baseAmount, 0),
      }));
      return {
        id: s.id, name: s.name, contactPerson: s.contactPerson, phone: s.phone, email: s.email, address: s.address, gstNo: s.gstNo,
        defaultCommissionRate: s.defaultCommissionRate, defaultGstRate: s.defaultGstRate, notes: s.notes,
        totalSupplied, outstandingBrokerage, paidBrokerage, fulfillment, shortShipmentRate,
        dispatchCount: s.dispatches.length, billCount: s.bills.length, volumeTrend,
        tags: s.tags.map((et) => et.tag),
      };
    });
    return NextResponse.json({ suppliers: rows });
  }
  const suppliers = await db.supplier.findMany({ where: { brokerId: broker.id }, orderBy: { name: "asc" } });
  return NextResponse.json({ suppliers });
}

// POST /api/suppliers — create a supplier (rate-limited at 30 creates/min per IP).
export const POST = withRateLimit(
  async (req: NextRequest) => {
    const broker = await getCurrentBroker();
    if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const parsed = SupplierSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    // Usage-limit check — 402 if at capacity.
    const limit = await checkLimit(broker.id, "suppliers");
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: "Supplier limit reached. Upgrade to add more suppliers.",
          current: limit.current,
          limit: limit.limit,
          planName: limit.planName,
        },
        { status: 402 },
      );
    }

    const supplier = await db.supplier.create({ data: { ...parsed.data, brokerId: broker.id } });
    await db.auditLog.create({ data: { brokerId: broker.id, entityType: "Supplier", entityId: supplier.id, action: "create", after: JSON.stringify(supplier), userName: broker.fullName } });
    return NextResponse.json({ supplier });
  },
  30,
  60_000,
);
