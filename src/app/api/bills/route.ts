import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { invalidateBrokerCache } from "@/lib/cache";

// GET /api/bills
export async function GET(_req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bills = await db.bill.findMany({
    where: { brokerId: broker.id },
    include: {
      po: { select: { poNumber: true, supplier: { select: { name: true } } } },
      client: { select: { name: true } },
      payments: { select: { id: true, amount: true, date: true, mode: true, reference: true }, orderBy: { date: "desc" } },
      brokerage: { select: { id: true, brokerageAmount: true, eligible: true, payoutStatus: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  invalidateBrokerCache(broker.id); return NextResponse.json({ bills });
}

// POST /api/bills — create a bill for a PO. Computes base (po - shortship - returns), GST, final.
export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { poId } = body as { poId: string };
  // PO must belong to this broker — otherwise a cross-tenant broker could bill another's PO.
  const po = await db.purchaseOrder.findUnique({
    where: { id: poId, brokerId: broker.id },
    include: { dispatches: true, disputes: true, client: true, supplier: true },
  });
  if (!po) return NextResponse.json({ error: "PO not found" }, { status: 400 });
  const existing = await db.bill.findUnique({ where: { poId } });
  if (existing) return NextResponse.json({ error: "Bill already exists for this PO", bill: existing }, { status: 400 });

  const poItems = JSON.parse(po.lineItemsJson) as { setQty: number; unitPrice: number }[];
  const poValue = poItems.reduce((s, i) => s + i.setQty * i.unitPrice, 0);
  const totalOrderedQty = poItems.reduce((s, i) => s + i.setQty, 0);
  const totalDispatchedQty = po.dispatches.reduce((s, d) => s + d.dispatchedQty, 0);
  const shortShipmentValue = totalOrderedQty > totalDispatchedQty ? poValue * (1 - totalDispatchedQty / totalOrderedQty) : 0;
  const returnsValue = po.disputes.filter((d) => d.type === "defective_return" && d.status === "resolved").reduce((s, d) => s + d.valueAffected, 0);

  const base = Math.max(0, poValue - shortShipmentValue - returnsValue);
  const gstRate = po.gstRate;
  const gst = Math.round(base * (gstRate / 100));
  const final = base + gst;

  const billCount = await db.bill.count({ where: { brokerId: broker.id } });
  const billNumber = `BILL-${new Date().getFullYear()}-${String(billCount + 1).padStart(4, "0")}`;

  const bill = await db.bill.create({
    data: {
      brokerId: broker.id,
      billNumber, poId, clientId: po.clientId, supplierId: po.supplierId,
      baseAmount: base, gstRate, gstAmount: gst, finalAmount: final, paidAmount: 0, status: "pending",
    },
  });

  // Pre-create the brokerage record (accrued, not eligible until fully paid)
  const brokerageAmount = Math.round(base * (po.commissionRate / 100));
  await db.brokerage.create({
    data: {
      brokerId: broker.id,
      billId: bill.id, supplierId: po.supplierId, clientId: po.clientId,
      commissionRate: po.commissionRate, baseAmount: base, brokerageAmount,
      eligible: false, payoutStatus: "accrued",
    },
  });

  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: "Bill", entityId: bill.id, action: "create", after: JSON.stringify(bill),
      userName: "Broker", reason: `Bill generated from ${po.poNumber}.`,
    },
  });
  invalidateBrokerCache(broker.id); return NextResponse.json({ bill });
}
