import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { isValidTagColor } from "@/lib/tags";
import { getCurrentBroker } from "@/lib/auth";

// GET /api/tags → returns all tags with counts of how many entities use each
// (split by entityType so the Tags management view can show "C / S / PO").
export async function GET() {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tags = await db.tag.findMany({
    where: { brokerId: broker.id },
    orderBy: { name: "asc" },
    include: {
      entityTags: {
        select: { id: true, entityType: true },
      },
    },
  });
  const rows = tags.map((t) => {
    const clientCount = t.entityTags.filter((e) => e.entityType === "Client").length;
    const supplierCount = t.entityTags.filter((e) => e.entityType === "Supplier").length;
    const poCount = t.entityTags.filter((e) => e.entityType === "PurchaseOrder").length;
    return {
      id: t.id,
      name: t.name,
      color: t.color,
      createdAt: t.createdAt.toISOString(),
      counts: {
        clients: clientCount,
        suppliers: supplierCount,
        purchaseOrders: poCount,
        total: t.entityTags.length,
      },
    };
  });
  return NextResponse.json({ tags: rows });
}

const CreateSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().optional(),
});

// POST /api/tags → body { name, color? }. Creates a tag. Name must be unique.
export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const name = parsed.data.name.trim();
  const color = parsed.data.color && isValidTagColor(parsed.data.color)
    ? parsed.data.color
    : "emerald";

  // Reject duplicate tag names with a clear, actionable error.
  const existing = await db.tag.findUnique({ where: { name } });
  if (existing) {
    return NextResponse.json(
      { error: "A tag with that name already exists." },
      { status: 409 },
    );
  }

  const tag = await db.tag.create({ data: { name, color, brokerId: broker.id } });
  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: "Tag",
      entityId: tag.id,
      action: "create",
      after: JSON.stringify(tag),
      userName: broker.fullName,
    },
  });
  return NextResponse.json({
    tag: {
      id: tag.id,
      name: tag.name,
      color: tag.color,
      createdAt: tag.createdAt.toISOString(),
    },
  });
}
