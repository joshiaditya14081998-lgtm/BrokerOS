import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

// GET /api/brokerages — list all with relations (scoped to current broker)
export async function GET(_req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const brokerages = await db.brokerage.findMany({
    where: { brokerId: broker.id },
    include: {
      bill: { select: { billNumber: true, finalAmount: true, baseAmount: true, status: true, po: { select: { poNumber: true } } } },
      client: { select: { name: true, payoutCadence: true } },
      supplier: { select: { name: true } },
      payout: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const payouts = await db.brokeragePayout.findMany({
    where: { brokerId: broker.id },
    include: { client: { select: { name: true } }, brokerages: { select: { id: true, brokerageAmount: true, bill: { select: { billNumber: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ brokerages, payouts });
}

// POST /api/brokerages — force eligible / create payout batch
export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { action } = body as { action: "force_eligible" | "create_payout"; brokerageId?: string; reason?: string; payoutIds?: string[]; paidAt?: string };

  if (action === "force_eligible") {
    const brokerage = await db.brokerage.findUnique({ where: { id: body.brokerageId } });
    if (!brokerage || brokerage.brokerId !== broker.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const before = { ...brokerage };
    const updated = await db.brokerage.update({
      where: { id: brokerage.id },
      data: { eligible: true, forceEligible: true, forceReason: body.reason || "Manual override", eligibleAt: brokerage.eligibleAt ?? new Date(), payoutStatus: brokerage.payoutStatus === "accrued" ? "scheduled" : brokerage.payoutStatus },
    });
    await db.auditLog.create({
      data: {
        brokerId: broker.id,
        entityType: "Brokerage", entityId: brokerage.id, action: "force_eligible",
        before: JSON.stringify(before), after: JSON.stringify(updated),
        userName: "Broker", reason: body.reason,
      },
    });
    return NextResponse.json({ brokerage: updated });
  }

  if (action === "create_payout") {
    // Group selected eligible brokerages into a payout batch (scoped to broker)
    const ids: string[] = body.payoutIds ?? [];
    if (!ids.length) return NextResponse.json({ error: "No brokerages selected" }, { status: 400 });
    const brokerages = await db.brokerage.findMany({
      where: { id: { in: ids }, brokerId: broker.id, eligible: true, payoutId: null },
    });
    if (!brokerages.length) return NextResponse.json({ error: "No eligible unpaid brokerages" }, { status: 400 });

    const first = brokerages[0];
    const total = brokerages.reduce((s, b) => s + b.brokerageAmount, 0);
    const client = await db.client.findUnique({ where: { id: first.clientId } });
    const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();

    const payout = await db.brokeragePayout.create({
      data: {
        brokerId: broker.id,
        clientId: first.clientId,
        cadence: client?.payoutCadence ?? "immediate",
        periodStart: new Date(Math.min(...brokerages.map((b) => b.eligibleAt?.getTime() ?? Date.now()))),
        periodEnd: paidAt,
        totalAmount: total,
        status: "paid",
        paidAt,
        notes: `Batch payout of ${brokerages.length} brokerage entries.`,
        brokerages: { connect: brokerages.map((b) => ({ id: b.id })) },
      },
    });
    await db.brokerage.updateMany({
      where: { id: { in: ids }, brokerId: broker.id },
      data: { payoutId: payout.id, payoutStatus: "paid" },
    });
    await db.auditLog.create({
      data: {
        brokerId: broker.id,
        entityType: "BrokeragePayout", entityId: payout.id, action: "create",
        after: JSON.stringify(payout), userName: "Broker",
        reason: `Payout batch of ${brokerages.length} brokerages, total ${total}.`,
      },
    });
    return NextResponse.json({ payout });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
