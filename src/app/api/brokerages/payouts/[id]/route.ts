import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { withRateLimit, type RouteContext } from "@/lib/api-middleware";
import { reportError } from "@/lib/error-report";
import { z } from "zod";

// PATCH /api/brokerages/payouts/[id]
//
// Updates a BrokeragePayout — primarily used to mark a scheduled payout as
// paid (status: "scheduled" → "paid", set paidAt). Also supports updating
// notes. Verifies brokerId ownership before mutating. AuditLog captures
// before/after so the payout transition is traceable.
//
// Body: { status?: "scheduled" | "paid", paidAt?: ISO string, notes?: string }
// Response: { payout }

const PatchSchema = z.object({
  status: z.enum(["scheduled", "paid"]).optional(),
  paidAt: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const PATCH = withRateLimit(
  async (req: NextRequest, ctx: RouteContext) => {
    try {
      const broker = await getCurrentBroker();
      if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const { id } = await ctx.params;
      const before = await db.brokeragePayout.findUnique({
        where: { id },
        include: { client: { select: { name: true } } },
      });
      if (!before || before.brokerId !== broker.id) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      const body = await req.json();
      const parsed = PatchSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      const next = parsed.data;
      const data: Record<string, unknown> = {};
      let reason: string | undefined;

      if (next.status !== undefined && next.status !== before.status) {
        data.status = next.status;
        if (next.status === "paid") {
          data.paidAt = next.paidAt ? new Date(next.paidAt) : new Date();
          reason = `Payout marked paid: ₹${before.totalAmount} · ${before.client.name}`;
        } else if (next.status === "scheduled") {
          data.paidAt = null;
          reason = `Payout reverted to scheduled: ₹${before.totalAmount} · ${before.client.name}`;
        }
      } else if (next.paidAt !== undefined) {
        data.paidAt = next.paidAt ? new Date(next.paidAt) : null;
      }

      if (next.notes !== undefined) {
        data.notes = next.notes?.trim() || null;
      }

      if (Object.keys(data).length === 0) {
        return NextResponse.json({ payout: before });
      }

      const payout = await db.brokeragePayout.update({
        where: { id },
        data,
        include: { client: { select: { name: true } } },
      });

      // If marking as paid, also update all linked brokerages to payoutStatus="paid"
      if (next.status === "paid" && before.status !== "paid") {
        await db.brokerage.updateMany({
          where: { payoutId: id, brokerId: broker.id },
          data: { payoutStatus: "paid" },
        });
      }
      // If reverting to scheduled, also revert linked brokerages
      if (next.status === "scheduled" && before.status === "paid") {
        await db.brokerage.updateMany({
          where: { payoutId: id, brokerId: broker.id },
          data: { payoutStatus: "scheduled" },
        });
      }

      await db.auditLog.create({
        data: {
          brokerId: broker.id,
          entityType: "BrokeragePayout",
          entityId: id,
          action: "update",
          before: JSON.stringify(before),
          after: JSON.stringify(payout),
          userName: "Broker",
          reason,
        },
      });

      return NextResponse.json({ payout });
    } catch (error) {
      reportError(error, { path: "/api/brokerages/payouts/[id]", method: "PATCH" });
      return NextResponse.json({ error: "Failed to update payout" }, { status: 500 });
    }
  },
  30,
  60_000,
);
