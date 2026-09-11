import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import {
  isValidSavedViewIcon,
  isValidSavedViewKey,
  toSavedViewDTO,
} from "@/lib/saved-views";
import { getCurrentBroker } from "@/lib/auth";

// GET /api/saved-views?view={viewKey}
//
// Returns all saved views, optionally filtered by view type. Always sorted
// by createdAt desc (most-recently-saved first) so the SavedViewsBar shows
// the freshest presets closest to the "Save current" button.
//
// Response: { savedViews: SavedViewDTO[] }
export async function GET(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const viewParam = req.nextUrl.searchParams.get("view");
  const where = viewParam && isValidSavedViewKey(viewParam)
    ? { brokerId: broker.id, view: viewParam }
    : { brokerId: broker.id };
  const rows = await db.savedView.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ savedViews: rows.map(toSavedViewDTO) });
}

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  view: z.string().min(1).max(40),
  filterJson: z.string().min(2), // must be at least a valid JSON-ish string
  entityType: z.string().max(40).optional(),
  icon: z.string().max(20).optional(),
});

// POST /api/saved-views
//
// Body: { name, view, filterJson, entityType?, icon? }
//
// Creates a new SavedView. `filterJson` is stored verbatim — the caller is
// responsible for passing a JSON.stringify-ed filter object. We do a light
// JSON-validity check so we don't persist garbage (the schema column is a
// plain String, not a JSON column, because SQLite doesn't have a native JSON
// type and Prisma handles JSON as TEXT anyway).
//
// Response: { savedView: SavedViewDTO }
export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Validate JSON shape — refuse to persist invalid JSON.
  try {
    JSON.parse(parsed.data.filterJson);
  } catch {
    return NextResponse.json(
      { error: "filterJson must be valid JSON" },
      { status: 400 },
    );
  }

  const name = parsed.data.name.trim();
  const view = parsed.data.view.trim();
  const icon = parsed.data.icon && isValidSavedViewIcon(parsed.data.icon)
    ? parsed.data.icon
    : "star";

  const sv = await db.savedView.create({
    data: {
      name,
      view,
      filterJson: parsed.data.filterJson,
      entityType: parsed.data.entityType?.trim() || null,
      icon,
      brokerId: broker.id,
    },
  });

  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: "SavedView",
      entityId: sv.id,
      action: "create",
      after: JSON.stringify(sv),
      userName: broker.fullName,
      reason: `Saved view "${sv.name}" for ${sv.view}`,
    },
  });

  return NextResponse.json({ savedView: toSavedViewDTO(sv) });
}
