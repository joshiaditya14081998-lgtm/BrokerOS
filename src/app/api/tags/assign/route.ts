import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { isValidEntityType, entityFkField, type TagEntityType } from "@/lib/tags";
import { getCurrentBroker } from "@/lib/auth";

const AssignSchema = z.object({
  tagId: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
});

// POST /api/tags/assign → body { tagId, entityType, entityId }.
// Creates an EntityTag (if not already exists). Returns { ok: true }.
// The polymorphic FK column matching `entityType` is set in the same write so
// the Prisma relation on Client/Supplier/PurchaseOrder stays in sync — this
// lets `include: { tags: true }` reads work uniformly across all three kinds.
export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = AssignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (!isValidEntityType(parsed.data.entityType)) {
    return NextResponse.json({ error: "Invalid entityType" }, { status: 400 });
  }
  const tag = await db.tag.findUnique({ where: { id: parsed.data.tagId } });
  if (!tag || tag.brokerId !== broker.id) {
    return NextResponse.json({ error: "Tag not found" }, { status: 404 });
  }
  const entityType = parsed.data.entityType as TagEntityType;
  const entityId = parsed.data.entityId;

  // Verify the parent entity exists AND belongs to this broker (so we don't
  // create orphan EntityTag rows for a deleted client/supplier/PO, or one
  // owned by a different broker).
  const exists = await entityExists(broker.id, entityType, entityId);
  if (!exists) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }

  // upsert keyed on the unique [entityType, entityId, tagId] constraint —
  // idempotent: re-assigning an already-assigned tag is a no-op.
  await db.entityTag.upsert({
    where: {
      entityType_entityId_tagId: {
        entityType,
        entityId,
        tagId: parsed.data.tagId,
      },
    },
    create: {
      tagId: parsed.data.tagId,
      entityType,
      entityId,
      [entityFkField(entityType)]: entityId,
    },
    update: {},
  });

  return NextResponse.json({ ok: true });
}

async function entityExists(brokerId: string, type: TagEntityType, id: string): Promise<boolean> {
  switch (type) {
    case "Client": {
      const c = await db.client.findUnique({ where: { id }, select: { id: true, brokerId: true } });
      return !!c && c.brokerId === brokerId;
    }
    case "Supplier": {
      const s = await db.supplier.findUnique({ where: { id }, select: { id: true, brokerId: true } });
      return !!s && s.brokerId === brokerId;
    }
    case "PurchaseOrder": {
      const p = await db.purchaseOrder.findUnique({ where: { id }, select: { id: true, brokerId: true } });
      return !!p && p.brokerId === brokerId;
    }
  }
}
