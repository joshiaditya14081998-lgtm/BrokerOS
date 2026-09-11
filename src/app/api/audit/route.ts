import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { getCurrentBroker } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/audit — filtered audit trail with stats summary
// Query params (all optional):
//   entityType  — case-insensitive exact match (e.g. "Payment")
//   user        — case-insensitive contains on userName
//   from        — ISO date string, createdAt >=
//   to          — ISO date string, createdAt <=
//   limit       — int, default 200, max 1000
//
// Response: { logs, stats } where stats = { total, byAction, byEntityType, dateRange }
export async function GET(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const entityType = searchParams.get("entityType")?.trim();
  const user = searchParams.get("user")?.trim();
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");
  const limitRaw = searchParams.get("limit");

  // Build Prisma where clause
  // Note: SQLite (Prisma's provider here) does not support `mode: "insensitive"`.
  // String comparison uses the default BINARY collation (case-sensitive).
  // Stored entityType values are PascalCase and the UI dropdown uses matching
  // values, so case-sensitive equals is sufficient.
  const where: Prisma.AuditLogWhereInput = { brokerId: broker.id };
  if (entityType) {
    where.entityType = entityType;
  }
  if (user) {
    where.userName = { contains: user };
  }
  const range: { gte?: Date; lte?: Date } = {};
  if (fromRaw) {
    const d = new Date(fromRaw);
    if (!Number.isNaN(d.getTime())) range.gte = d;
  }
  if (toRaw) {
    // include the entire 'to' day
    const d = new Date(toRaw);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      range.lte = d;
    }
  }
  if (range.gte || range.lte) {
    where.createdAt = range;
  }

  // limit clamp
  let limit = 200;
  if (limitRaw) {
    const n = parseInt(limitRaw, 10);
    if (Number.isFinite(n) && n > 0) {
      limit = Math.min(1000, Math.max(1, n));
    }
  }

  // Fetch logs (capped) for display
  const [logs, aggAll, aggFiltered, minMax] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    // total count across all logs (no filter) — global activity metric
    db.auditLog.count({ where: { brokerId: broker.id } }),
    // count + group-by under the active filter (matches the displayed rows' superset)
    db.auditLog.groupBy({
      by: ["action"],
      where,
      _count: { _all: true },
    }),
    db.auditLog.aggregate({
      where,
      _min: { createdAt: true },
      _max: { createdAt: true },
    }),
  ]);

  // Action breakdown (under active filter)
  const byAction: Record<string, number> = {};
  for (const g of aggFiltered) {
    byAction[g.action] = g._count._all;
  }
  const filteredTotal = aggFiltered.reduce((s, g) => s + g._count._all, 0);

  // Entity type breakdown — fetch via a second groupBy on the same where
  const aggByEntity = await db.auditLog.groupBy({
    by: ["entityType"],
    where,
    _count: { _all: true },
  });
  const byEntityType: Record<string, number> = {};
  for (const g of aggByEntity) {
    byEntityType[g.entityType] = g._count._all;
  }

  return NextResponse.json({
    logs,
    stats: {
      total: aggAll,
      filtered: filteredTotal,
      shown: logs.length,
      byAction,
      byEntityType,
      dateRange: {
        earliest: minMax._min.createdAt?.toISOString() ?? null,
        latest: minMax._max.createdAt?.toISOString() ?? null,
      },
    },
  });
}
