import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isValidEntityType, type TagEntityType } from "@/lib/tags";

// GET /api/tags/entity?entityType=X&entityId=Y
// → returns { tags: TagDTO[] } for a specific entity, newest-first.
// Used by the TagPicker component to render an entity's currently-assigned
// tags inside the detail sheets (client / supplier / PO).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const entityTypeParam = searchParams.get("entityType");
  const entityId = searchParams.get("entityId");
  if (!entityTypeParam || !entityId) {
    return NextResponse.json(
      { error: "entityType and entityId are required" },
      { status: 400 },
    );
  }
  if (!isValidEntityType(entityTypeParam)) {
    return NextResponse.json({ error: "Invalid entityType" }, { status: 400 });
  }
  const entityType = entityTypeParam as TagEntityType;
  const entityTags = await db.entityTag.findMany({
    where: { entityType, entityId },
    include: { tag: true },
    orderBy: { createdAt: "asc" },
  });
  const tags = entityTags.map((et) => ({
    id: et.tag.id,
    name: et.tag.name,
    color: et.tag.color,
    createdAt: et.tag.createdAt.toISOString(),
  }));
  return NextResponse.json({ tags });
}
