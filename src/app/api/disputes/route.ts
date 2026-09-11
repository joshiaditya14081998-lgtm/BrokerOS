import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { z } from "zod";

const DisputeSchema = z.object({
  poId: z.string().min(1),
  dispatchId: z.string().optional().nullable(),
  type: z.enum(["short_shipment", "defective_return", "other"]),
  description: z.string().optional().nullable(),
  quantityAffected: z.number().int().min(0).default(0),
  valueAffected: z.number().min(0).default(0),
});

export async function GET(_req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const disputes = await db.dispute.findMany({
    where: { brokerId: broker.id },
    include: {
      po: { select: { poNumber: true, client: { select: { name: true } }, supplier: { select: { name: true } } } },
      dispatch: { select: { id: true, dispatchDate: true } },
      photos: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ disputes });
}

export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = DisputeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  // PO must belong to this broker — prevents a tenant from opening disputes on another's PO.
  const po = await db.purchaseOrder.findUnique({ where: { id: parsed.data.poId, brokerId: broker.id }, select: { id: true } });
  if (!po) return NextResponse.json({ error: "PO not found" }, { status: 400 });

  const dispute = await db.dispute.create({
    data: { ...parsed.data, brokerId: broker.id, dispatchId: parsed.data.dispatchId ?? null, status: "open" },
  });
  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: "Dispute", entityId: dispute.id, action: "create",
      after: JSON.stringify(dispute), userName: "Broker",
    },
  });
  return NextResponse.json({ dispute });
}
