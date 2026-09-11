import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { isValidEntityType, type TagEntityType } from "@/lib/tags";
import { getCurrentBroker } from "@/lib/auth";

const UnassignSchema = z.object({
  tagId: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
});

// POST /api/tags/unassign → body { tagId, entityType, entityId }.
// Removes the EntityTag (if present). Idempotent: un-assigning a tag that
// wasn't assigned is a no-op. Returns { ok: true }.
export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = UnassignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (!isValidEntityType(parsed.data.entityType)) {
    return NextResponse.json({ error: "Invalid entityType" }, { status: 400 });
  }
  const entityType = parsed.data.entityType as TagEntityType;
  // Scope the deleteMany by the tag's broker so we never delete another
  // broker's EntityTag rows (even though the broker would normally only
  // see their own tagIds, this is defence-in-depth).
  await db.entityTag.deleteMany({
    where: {
      tagId: parsed.data.tagId,
      entityType,
      entityId: parsed.data.entityId,
      tag: { brokerId: broker.id },
    },
  });
  return NextResponse.json({ ok: true });
}
