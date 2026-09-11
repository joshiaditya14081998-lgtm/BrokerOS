import { NextRequest, NextResponse } from "next/server";
import { runFix, isFixType, type FixResult } from "@/lib/data-health-fix";
import { getCurrentBroker } from "@/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/data-health/fix
//
// Body: { fixType: string, entityId?: string | null }
//
// Runs a single auto-fix. If `entityId` is null/omitted, fixes every
// matching record. Each fix writes an AuditLog row (entityType "DataHealthFix")
// summarising what changed.
//
// Response: { fixed: N, fixType, details: { ... } }
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { fixType, entityId } = (body ?? {}) as {
    fixType?: unknown;
    entityId?: unknown;
  };

  if (!isFixType(fixType)) {
    return NextResponse.json(
      {
        error: `Invalid fixType. Expected one of: create_brokerage, generate_thumbnails, dismiss_stale_notifications, close_forgotten_visits, set_default_commission`,
      },
      { status: 400 },
    );
  }

  // `entityId` may be:
  //   • omitted  → null (fix all matching)
  //   • null     → null (fix all matching, explicit)
  //   • string   → fix just that one record
  // Anything else is rejected.
  let resolvedEntityId: string | null = null;
  if (entityId === undefined || entityId === null) {
    resolvedEntityId = null;
  } else if (typeof entityId === "string" && entityId.trim().length > 0) {
    resolvedEntityId = entityId.trim();
  } else {
    return NextResponse.json(
      { error: "entityId must be a non-empty string or null" },
      { status: 400 },
    );
  }

  let result: FixResult;
  try {
    result = await runFix(fixType, resolvedEntityId, broker.id);
  } catch (e) {
    return NextResponse.json(
      {
        error: `Fix failed: ${e instanceof Error ? e.message : "unknown"}`,
        fixType,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    fixed: result.fixed,
    fixType: result.fixType,
    details: result.details,
  });
}
