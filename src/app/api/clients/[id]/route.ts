import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

// GET /api/clients/[id] — full detail: visits, POs, dispatches, bills, payments, brokerages, ledger
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const client = await db.client.findUnique({
    where: { id },
    include: {
      visits: { include: { bookings: { select: { id: true, supplierId: true, bookingDate: true } } }, orderBy: { plannedDate: "desc" } },
      bills: {
        include: { po: { select: { poNumber: true, supplier: { select: { name: true } } } }, payments: { orderBy: { date: "desc" } }, brokerage: true },
        orderBy: { createdAt: "desc" },
      },
      brokerages: { include: { bill: { select: { billNumber: true } }, supplier: { select: { name: true } }, payout: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!client || client.brokerId !== broker.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  type Ledger = { date: Date; type: string; ref: string; debit: number; credit: number; balance: number };
  const entries: Ledger[] = [];
  for (const bill of client.bills) {
    entries.push({ date: bill.createdAt, type: "Bill", ref: bill.billNumber, debit: bill.finalAmount, credit: 0, balance: 0 });
    for (const p of bill.payments) {
      entries.push({ date: p.date, type: "Payment", ref: p.reference || p.id.slice(-6), debit: 0, credit: p.amount, balance: 0 });
    }
  }
  entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  let bal = 0;
  for (const e of entries) { bal += e.debit - e.credit; e.balance = bal; }
  entries.reverse();

  const totalBusiness = client.bills.reduce((s, b) => s + b.finalAmount, 0);
  const outstanding = client.bills.reduce((s, b) => s + (b.finalAmount - b.paidAmount), 0);
  const brokerageEarned = client.brokerages.filter((b) => b.eligible).reduce((s, b) => s + b.brokerageAmount, 0);
  const brokeragePaid = client.brokerages.filter((b) => b.payoutStatus === "paid").reduce((s, b) => s + b.brokerageAmount, 0);

  const poDelivery = await db.purchaseOrder.findMany({
    where: { clientId: id, brokerId: broker.id },
    include: { dispatches: true, supplier: { select: { name: true } } },
  });
  const deliverySummary = poDelivery.map((po) => {
    const dispatchedQty = po.dispatches.reduce((s, d) => s + d.dispatchedQty, 0);
    const orderedQty = JSON.parse(po.lineItemsJson).reduce((s: number, i: { setQty: number }) => s + i.setQty, 0);
    return {
      poNumber: po.poNumber, status: po.status, ordered: po.totalValue, orderedQty, dispatchedQty,
      fulfillment: orderedQty ? Math.round((dispatchedQty / orderedQty) * 100) : 0,
      supplierName: po.supplier.name,
      expectedDispatchDate: po.expectedDispatchDate,
      revisedDispatchDate: po.revisedDispatchDate,
    };
  });

  // ── Client credit metrics (mirrors /api/analytics §5.1) ─────────────────────
  // Credit exposure: sum(finalAmount - paidAmount) across this client's bills.
  // (Same as `outstanding`; surfaced as a distinct concept per spec §5.1.)
  const creditExposure = client.bills.reduce((s, b) => s + (b.finalAmount - b.paidAmount), 0);

  // Avg payment delay (days): for fully-paid bills, avg days between
  // bill.createdAt and the latest payment date. 0 if no qualifying bills.
  let avgPaymentDelay = 0;
  const paidBills = client.bills.filter((b) => b.status === "fully_paid");
  if (paidBills.length > 0) {
    let totalDelay = 0;
    let counted = 0;
    for (const b of paidBills) {
      if (b.payments.length === 0) continue;
      const lastPay = b.payments.reduce(
        (latest, p) => (new Date(p.date) > latest ? new Date(p.date) : latest),
        new Date(0),
      );
      const diff = Math.round(
        (lastPay.getTime() - new Date(b.createdAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (diff >= 0) {
        totalDelay += diff;
        counted += 1;
      }
    }
    avgPaymentDelay = counted > 0 ? Math.round(totalDelay / counted) : 0;
  }

  // Return rate: defective_return disputes linked to this client's POs / total bills × 100.
  let returnRate = 0;
  if (client.bills.length > 0) {
    const clientPoIds = poDelivery.map((p) => p.id);
    const defectiveReturns = clientPoIds.length > 0
      ? await db.dispute.count({ where: { poId: { in: clientPoIds }, type: "defective_return", brokerId: broker.id } })
      : 0;
    returnRate = Math.round((defectiveReturns / client.bills.length) * 100);
  }

  return NextResponse.json({
    client,
    ledger: entries,
    stats: {
      totalBusiness,
      outstanding,
      brokerageEarned,
      brokeragePaid,
      visitCount: client.visits.length,
      billCount: client.bills.length,
      avgPaymentDelay,
      returnRate,
      creditExposure,
    },
    deliverySummary,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const before = await db.client.findUnique({ where: { id } });
  if (!before || before.brokerId !== broker.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id: _id, createdAt: _c, updatedAt: _u, brokerId: _b, ...data } = body;
  const client = await db.client.update({ where: { id }, data });
  await db.auditLog.create({
    data: { brokerId: broker.id, entityType: "Client", entityId: id, action: "update", before: JSON.stringify(before), after: JSON.stringify(client), userName: broker.fullName },
  });
  return NextResponse.json({ client });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  // deleteMany with brokerId — only deletes if both id and brokerId match (prevents cross-tenant delete).
  const result = await db.client.deleteMany({ where: { id, brokerId: broker.id } });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.auditLog.create({ data: { brokerId: broker.id, entityType: "Client", entityId: id, action: "delete", userName: broker.fullName } });
  return NextResponse.json({ ok: true });
}
