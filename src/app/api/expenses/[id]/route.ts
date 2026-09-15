import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { withRateLimit, type RouteContext } from "@/lib/api-middleware";
import { reportError } from "@/lib/error-report";
import { z } from "zod";
import { EXPENSE_CATEGORIES } from "@/app/api/expenses/route";

// PATCH — partial update of an expense. Verifies brokerId ownership before
// mutating. Returns the updated record. AuditLog entry captures before/after
// so a dispute ("I never logged that ₹15,000 travel expense") can be resolved
// from the audit trail.
const PatchSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  amount: z.number().min(0.01).optional(),
  date: z.string().optional(),
  description: z.string().optional().nullable(),
  vendor: z.string().optional().nullable(),
  receiptUrl: z.string().optional().nullable(),
});

export const PATCH = withRateLimit(
  async (req: NextRequest, ctx: RouteContext) => {
    try {
      const broker = await getCurrentBroker();
      if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const { id } = await ctx.params;
      const before = await db.expense.findUnique({ where: { id } });
      if (!before || before.brokerId !== broker.id) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      const body = await req.json();
      const parsed = PatchSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      // Only carry forward non-undefined fields so a PATCH with just `amount`
      // doesn't null out description/vendor. Strings are trimmed; empty
      // strings collapse to null to keep the DB consistent.
      const next = parsed.data;
      const data: Record<string, unknown> = {};
      if (next.category !== undefined) data.category = next.category;
      if (next.amount !== undefined) data.amount = next.amount;
      if (next.date !== undefined) data.date = new Date(next.date);
      if (next.description !== undefined) data.description = next.description?.trim() || null;
      if (next.vendor !== undefined) data.vendor = next.vendor?.trim() || null;
      if (next.receiptUrl !== undefined) data.receiptUrl = next.receiptUrl?.trim() || null;

      const expense = await db.expense.update({ where: { id }, data });

      await db.auditLog.create({
        data: {
          brokerId: broker.id,
          entityType: "Expense",
          entityId: id,
          action: "update",
          before: JSON.stringify(before),
          after: JSON.stringify(expense),
          userName: "Broker",
        },
      });

      return NextResponse.json({ expense });
    } catch (error) {
      reportError(error, { path: "/api/expenses/[id]", method: "PATCH" });
      return NextResponse.json({ error: "Failed to update expense" }, { status: 500 });
    }
  },
  30,
  60_000,
);

// DELETE — verifies ownership, then hard-deletes. Returns `{ ok: true }`.
// AuditLog entry retains the `before` snapshot so a deleted expense can still
// be reconstructed from the audit trail if disputed.
export const DELETE = withRateLimit(
  async (_req: NextRequest, ctx: RouteContext) => {
    try {
      const broker = await getCurrentBroker();
      if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const { id } = await ctx.params;
      const before = await db.expense.findUnique({ where: { id } });
      if (!before || before.brokerId !== broker.id) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      await db.expense.delete({ where: { id } });

      await db.auditLog.create({
        data: {
          brokerId: broker.id,
          entityType: "Expense",
          entityId: id,
          action: "delete",
          before: JSON.stringify(before),
          userName: "Broker",
          reason: `Deleted expense: ${before.category} · ${before.amount}`,
        },
      });

      return NextResponse.json({ ok: true });
    } catch (error) {
      reportError(error, { path: "/api/expenses/[id]", method: "DELETE" });
      return NextResponse.json({ error: "Failed to delete expense" }, { status: 500 });
    }
  },
  30,
  60_000,
);
