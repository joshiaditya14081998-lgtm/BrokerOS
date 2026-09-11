import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentSuperAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/admin/audit — AdminAuditLog entries (paginated, filterable by action).
//
// Query params:
//   - action   — case-sensitive exact match on AdminAuditLog.action
//   - adminId  — filter by the admin Broker.id (so a multi-admin team can
//                see only their own actions)
//   - target   — filter by targetType (Broker | Subscription | Plan | Notification)
//   - page     — 1-based (default 1)
//   - pageSize — default 20, max 100
export async function GET(req: NextRequest) {
  const admin = await getCurrentSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action")?.trim() ?? "";
  const adminId = searchParams.get("adminId")?.trim() ?? "";
  const targetType = searchParams.get("targetType")?.trim() ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10) || 20),
  );

  const where: Prisma.AdminAuditLogWhereInput = {};
  if (action) where.action = action;
  if (adminId) where.adminId = adminId;
  if (targetType) where.targetType = targetType;

  const [total, logs, adminIds, actions] = await Promise.all([
    db.adminAuditLog.count({ where }),
    db.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    // Distinct admin IDs (so the UI can populate an admin filter dropdown)
    db.adminAuditLog.findMany({
      where,
      select: { adminId: true },
      distinct: ["adminId"],
    }),
    db.adminAuditLog.groupBy({
      by: ["action"],
      where,
      _count: { _all: true },
    }),
  ]);

  // Hydrate admin names so the table can show "Ramesh" instead of a UUID.
  const adminBrokerRows = adminIds.length === 0
    ? []
    : await db.broker.findMany({
        where: { id: { in: adminIds.map((r) => r.adminId) } },
        select: { id: true, email: true, fullName: true },
      });
  const adminMap = new Map(adminBrokerRows.map((b) => [b.id, b]));

  const byAction: Record<string, number> = {};
  for (const g of actions) byAction[g.action] = g._count._all;

  return NextResponse.json({
    logs: logs.map((l) => {
      const adminRow = adminMap.get(l.adminId);
      return {
        id: l.id,
        adminId: l.adminId,
        adminName: adminRow?.fullName ?? adminRow?.email ?? l.adminId,
        action: l.action,
        targetType: l.targetType,
        targetId: l.targetId,
        before: l.before,
        after: l.after,
        reason: l.reason,
        ipAddress: l.ipAddress,
        createdAt: l.createdAt.toISOString(),
      };
    }),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    admins: adminBrokerRows.map((b) => ({ id: b.id, fullName: b.fullName, email: b.email })),
    byAction,
  });
}
