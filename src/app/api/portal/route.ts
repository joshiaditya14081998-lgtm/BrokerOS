import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

// GET /api/portal?persona=supplier&id=X  — read-only supplier-scoped portal view
// GET /api/portal?persona=client&id=X   — read-only client-scoped portal view
//
// These portal endpoints are mockups — they demonstrate what a supplier or
// client would see when logging into their own portal. They reuse the same
// data model as the broker views but reshape the payloads to surface only
// what each party should care about:
//   • Supplier: dispatch actions owed to buyers + brokerage earned.
//   • Client:   orders owed to them + bills they owe + payments made.
//
// All queries are scoped to the authenticated broker's tenant — a broker can
// only preview portals for their own clients/suppliers.
export async function GET(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const persona = searchParams.get("persona");
  const id = searchParams.get("id");
  if (!persona || !id) {
    return NextResponse.json({ error: "persona and id are required" }, { status: 400 });
  }
  if (persona !== "supplier" && persona !== "client") {
    return NextResponse.json({ error: "persona must be 'supplier' or 'client'" }, { status: 400 });
  }
  try {
    if (persona === "supplier") {
      return NextResponse.json(await buildSupplierPortal(id, broker.id));
    }
    return NextResponse.json(await buildClientPortal(id, broker.id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Supplier portal — what a supplier sees: POs awaiting dispatch, their
// dispatches (last 5), their brokerage earnings, performance summary.
// ─────────────────────────────────────────────────────────────────────────────
export async function buildSupplierPortal(supplierId: string, brokerId: string) {
  const supplier = await db.supplier.findUnique({
    where: { id: supplierId, brokerId },
    select: {
      id: true, name: true, contactPerson: true, phone: true, email: true,
      address: true, gstNo: true, defaultCommissionRate: true, defaultGstRate: true,
      notes: true, createdAt: true,
    },
  });
  if (!supplier) return { error: "Supplier not found" };

  // All POs for this supplier — used for "awaiting dispatch" + history.
  const pos = await db.purchaseOrder.findMany({
    where: { supplierId, brokerId },
    include: {
      client: { select: { name: true } },
      dispatches: { select: { id: true, dispatchedQty: true, dispatchDate: true, status: true }, orderBy: { dispatchDate: "desc" } },
      bill: { select: { id: true, billNumber: true, status: true, finalAmount: true, paidAmount: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // All dispatches for this supplier — recent activity + performance metrics.
  const dispatches = await db.dispatch.findMany({
    where: { supplierId, brokerId },
    include: {
      po: {
        select: {
          poNumber: true, totalValue: true, lineItemsJson: true,
          expectedDispatchDate: true, revisedDispatchDate: true, status: true,
          client: { select: { name: true } },
        },
      },
    },
    orderBy: { dispatchDate: "desc" },
  });

  // Brokerage entries for this supplier — what they've earned.
  const brokerages = await db.brokerage.findMany({
    where: { supplierId, brokerId },
    include: {
      bill: { select: { billNumber: true, baseAmount: true, status: true } },
      client: { select: { name: true } },
      payout: { select: { id: true, status: true, paidAt: true, totalAmount: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Performance summary — derived from the same data the broker sees, but
  // framed as the supplier's own reliability score.
  const totalOrderedQty = dispatches.reduce((s, d) => {
    const items = JSON.parse(d.po.lineItemsJson) as { setQty: number }[];
    return s + items.reduce((x: number, i: { setQty: number }) => x + i.setQty, 0);
  }, 0);
  const totalDispatchedQty = dispatches.reduce((s, d) => s + d.dispatchedQty, 0);
  const fulfillment = totalOrderedQty ? Math.round((totalDispatchedQty / totalOrderedQty) * 100) : 100;

  const onTimeDispatches = dispatches.filter((d) => {
    const expected = d.po.revisedDispatchDate ?? d.po.expectedDispatchDate;
    return expected && d.dispatchDate <= expected;
  });
  const dispatchesWithExpected = dispatches.filter((d) => d.po.expectedDispatchDate || d.po.revisedDispatchDate);
  const onTimeRate = dispatchesWithExpected.length
    ? Math.round((onTimeDispatches.length / dispatchesWithExpected.length) * 100)
    : 100;

  const shortShipmentRate = dispatches.length
    ? Math.round((dispatches.filter((d) => d.status === "short_shipment").length / dispatches.length) * 100)
    : 0;

  const totalSupplied = brokerages.reduce((s, b) => s + b.baseAmount, 0);
  const brokerageEarned = brokerages.reduce((s, b) => s + b.brokerageAmount, 0);
  const outstandingBrokerage = brokerages
    .filter((b) => b.eligible && b.payoutStatus !== "paid")
    .reduce((s, b) => s + b.brokerageAmount, 0);
  const paidBrokerage = brokerages
    .filter((b) => b.payoutStatus === "paid")
    .reduce((s, b) => s + b.brokerageAmount, 0);

  // POs awaiting dispatch — these are the action items. Status "open" or
  // "partially_delivered" means there's still outstanding qty to ship.
  const posAwaitingDispatch = pos
    .filter((p) => p.status === "open" || p.status === "partially_delivered")
    .map((p) => {
      const items = JSON.parse(p.lineItemsJson) as { setQty: number }[];
      const orderedQty = items.reduce((s: number, i: { setQty: number }) => s + i.setQty, 0);
      const dispatchedQty = p.dispatches.reduce((s, d) => s + d.dispatchedQty, 0);
      return {
        id: p.id,
        poNumber: p.poNumber,
        buyer: p.client.name,
        status: p.status,
        orderedQty,
        dispatchedQty,
        expectedDispatchDate: p.expectedDispatchDate,
        revisedDispatchDate: p.revisedDispatchDate,
        billStatus: p.bill?.status ?? null,
        createdAt: p.createdAt,
      };
    });

  // Recent dispatches (last 5).
  const recentDispatches = dispatches.slice(0, 5).map((d) => {
    const items = JSON.parse(d.po.lineItemsJson) as { setQty: number }[];
    const orderedQty = items.reduce((s: number, i: { setQty: number }) => s + i.setQty, 0);
    return {
      id: d.id,
      poNumber: d.po.poNumber,
      buyer: d.po.client.name,
      dispatchDate: d.dispatchDate,
      dispatchedQty: d.dispatchedQty,
      orderedQty,
      status: d.status,
    };
  });

  // Brokerage entries reshaped for the supplier's "earnings" perspective.
  const brokerageEntries = brokerages.map((b) => ({
    id: b.id,
    billNumber: b.bill.billNumber,
    buyer: b.client.name,
    baseAmount: b.baseAmount,
    commissionRate: b.commissionRate,
    brokerageAmount: b.brokerageAmount,
    eligible: b.eligible,
    payoutStatus: b.payoutStatus,
    eligibleAt: b.eligibleAt,
    createdAt: b.createdAt,
    payout: b.payout
      ? { id: b.payout.id, status: b.payout.status, paidAt: b.payout.paidAt, totalAmount: b.payout.totalAmount }
      : null,
  }));

  return {
    persona: "supplier" as const,
    profile: supplier,
    performance: {
      fulfillment,
      onTimeRate,
      shortShipmentRate,
      totalSupplied,
      brokerageEarned,
      outstandingBrokerage,
      paidBrokerage,
      poCount: pos.length,
      dispatchCount: dispatches.length,
    },
    sections: {
      posAwaitingDispatch,
      recentDispatches,
      brokerage: brokerageEntries,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Client portal — what a client sees: their orders, what's been delivered,
// bills they owe, payments they've made, brokerage earned on their account.
// ─────────────────────────────────────────────────────────────────────────────
export async function buildClientPortal(clientId: string, brokerId: string) {
  const client = await db.client.findUnique({
    where: { id: clientId, brokerId },
    select: {
      id: true, name: true, contactPerson: true, phone: true, email: true,
      address: true, gstNo: true, defaultPaymentCycleDays: true, payoutCadence: true,
      gstRate: true, notes: true, createdAt: true,
    },
  });
  if (!client) return { error: "Client not found" };

  // All POs for this client — "My Orders" view with fulfillment progress.
  const pos = await db.purchaseOrder.findMany({
    where: { clientId, brokerId },
    include: {
      supplier: { select: { name: true } },
      dispatches: { select: { id: true, dispatchedQty: true, dispatchDate: true, status: true }, orderBy: { dispatchDate: "desc" } },
      bill: { select: { id: true, billNumber: true, status: true, finalAmount: true, paidAmount: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Bills for this client — what they owe.
  const bills = await db.bill.findMany({
    where: { clientId, brokerId },
    include: {
      po: { select: { poNumber: true, supplier: { select: { name: true } } } },
      payments: { orderBy: { date: "desc" } },
      brokerage: { select: { id: true, brokerageAmount: true, eligible: true, payoutStatus: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Brokerage entries on this client's account — their payout cadence drives
  // when the broker gets paid, but they can see what's been earned.
  const brokerages = await db.brokerage.findMany({
    where: { clientId, brokerId },
    include: {
      bill: { select: { billNumber: true, baseAmount: true } },
      supplier: { select: { name: true } },
      payout: { select: { id: true, status: true, paidAt: true, totalAmount: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Recent deliveries (last 5) — dispatches received across all POs.
  const recentDeliveries = await db.dispatch.findMany({
    where: { po: { clientId, brokerId } },
    include: {
      po: {
        select: {
          poNumber: true, lineItemsJson: true, totalValue: true,
          supplier: { select: { name: true } },
        },
      },
    },
    orderBy: { dispatchDate: "desc" },
    take: 5,
  });

  // Payments made — full history across all bills.
  const payments = await db.payment.findMany({
    where: { clientId, brokerId },
    include: { bill: { select: { billNumber: true, po: { select: { poNumber: true } } } } },
    orderBy: { date: "desc" },
  });

  // Summary KPIs — what the client owes + has paid + brokerage earned.
  const totalBusiness = bills.reduce((s, b) => s + b.finalAmount, 0);
  const outstanding = bills.reduce((s, b) => s + (b.finalAmount - b.paidAmount), 0);
  const totalPaid = bills.reduce((s, b) => s + b.paidAmount, 0);
  const brokerageEarned = brokerages.filter((b) => b.eligible).reduce((s, b) => s + b.brokerageAmount, 0);
  const brokeragePaid = brokerages.filter((b) => b.payoutStatus === "paid").reduce((s, b) => s + b.brokerageAmount, 0);

  // My Orders — reshaped with supplier name + fulfillment progress.
  const myOrders = pos.map((p) => {
    const items = JSON.parse(p.lineItemsJson) as { setQty: number }[];
    const orderedQty = items.reduce((s: number, i: { setQty: number }) => s + i.setQty, 0);
    const dispatchedQty = p.dispatches.reduce((s, d) => s + d.dispatchedQty, 0);
    const fulfillment = orderedQty ? Math.min(100, Math.round((dispatchedQty / orderedQty) * 100)) : 0;
    const lastDispatch = p.dispatches[0]?.dispatchDate ?? null;
    return {
      id: p.id,
      poNumber: p.poNumber,
      supplier: p.supplier.name,
      status: p.status,
      orderedQty,
      dispatchedQty,
      fulfillment,
      expectedDispatchDate: p.expectedDispatchDate,
      revisedDispatchDate: p.revisedDispatchDate,
      lastDispatch,
      billStatus: p.bill?.status ?? null,
      finalAmount: p.bill?.finalAmount ?? p.totalValue,
      paidAmount: p.bill?.paidAmount ?? 0,
      createdAt: p.createdAt,
    };
  });

  // Outstanding bills — what they owe. Emphasize due amount.
  const outstandingBills = bills
    .filter((b) => b.finalAmount - b.paidAmount > 0)
    .map((b) => {
      // Computed due date = createdAt + defaultPaymentCycleDays.
      const dueDate = new Date(b.createdAt);
      dueDate.setDate(dueDate.getDate() + client.defaultPaymentCycleDays);
      const overdue = new Date() > dueDate;
      return {
        id: b.id,
        billNumber: b.billNumber,
        poNumber: b.po.poNumber,
        supplier: b.po.supplier.name,
        finalAmount: b.finalAmount,
        paidAmount: b.paidAmount,
        dueAmount: b.finalAmount - b.paidAmount,
        status: b.status,
        createdAt: b.createdAt,
        dueDate,
        overdue,
      };
    });

  // Payment history — recent 8 payments.
  const paymentHistory = payments.slice(0, 8).map((p) => ({
    id: p.id,
    billNumber: p.bill.billNumber,
    poNumber: p.bill.po.poNumber,
    amount: p.amount,
    date: p.date,
    mode: p.mode,
    reference: p.reference,
  }));

  // Recent deliveries reshaped.
  const deliveries = recentDeliveries.map((d) => {
    const items = JSON.parse(d.po.lineItemsJson) as { setQty: number }[];
    const orderedQty = items.reduce((s: number, i: { setQty: number }) => s + i.setQty, 0);
    return {
      id: d.id,
      poNumber: d.po.poNumber,
      supplier: d.po.supplier.name,
      dispatchDate: d.dispatchDate,
      dispatchedQty: d.dispatchedQty,
      orderedQty,
      status: d.status,
    };
  });

  // Brokerage entries — what's been earned on this client's account.
  const brokerageEntries = brokerages.map((b) => ({
    id: b.id,
    billNumber: b.bill.billNumber,
    supplier: b.supplier.name,
    baseAmount: b.bill.baseAmount,
    commissionRate: b.commissionRate,
    brokerageAmount: b.brokerageAmount,
    eligible: b.eligible,
    payoutStatus: b.payoutStatus,
    eligibleAt: b.eligibleAt,
    createdAt: b.createdAt,
  }));

  return {
    persona: "client" as const,
    profile: client,
    summary: {
      totalBusiness,
      outstanding,
      totalPaid,
      brokerageEarned,
      brokeragePaid,
      billCount: bills.length,
      poCount: pos.length,
    },
    sections: {
      myOrders,
      outstandingBills,
      paymentHistory,
      recentDeliveries: deliveries,
      brokerage: brokerageEntries,
    },
  };
}
