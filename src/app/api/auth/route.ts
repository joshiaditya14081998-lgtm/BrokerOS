import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { ensurePlansExist, type PlanTier } from "@/lib/plans";
import { withRateLimit } from "@/lib/api-middleware";

// POST /api/auth/create-profile — auto-create a Broker row + Subscription for
// the newly-signed-up user. Body: { fullName, plan?: "free"|"basic"|"pro"|"enterprise" }
// Defaults to "free" if no plan selected. All plans start in `trialing` status
// with a 14-day trial window.
//
// The selected plan + 14-day trial window is recorded on the Subscription row.
// The plan catalogue is lazily seeded via `ensurePlansExist()` (from
// `src/lib/plans.ts`) so the foreign key on `Subscription.planId` always
// resolves — no separate seed-script run required.
//
// NOTE: this route is exempt from the global middleware rate limit (auth
// routes are public). It carries its own stricter 10 req/min per-IP limit
// because it runs on signup + plan selection — a high-value target for
// credential-stuffing / plan-tampering attempts.
export const POST = withRateLimit(
  async (req: NextRequest) => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const requestedPlan = (body.plan as string) || "free";
    const planName: PlanTier = (
      ["free", "basic", "pro", "enterprise"].includes(requestedPlan)
        ? requestedPlan
        : "free"
    ) as PlanTier;

    // Ensure all 4 Plan rows exist (idempotent upsert) + fetch the chosen plan.
    const plans = await ensurePlansExist();
    const plan = plans[planName];

    // Check if broker profile already exists (idempotent)
    const existing = await db.broker.findUnique({
      where: { id: user.id },
      include: { subscription: true },
    });
    if (existing) {
      // If the broker exists but has no subscription yet, create one now with
      // the selected plan + a fresh 14-day trial.
      if (!existing.subscription) {
        const trialStart = new Date();
        const trialEnd = new Date(trialStart.getTime() + 14 * 24 * 60 * 60 * 1000);
        await db.subscription.create({
          data: {
            brokerId: existing.id,
            planId: plan.id,
            status: "trialing",
            trialStart,
            trialEnd,
          },
        });
      }
      return NextResponse.json({ broker: existing });
    }

    // Create broker + subscription together so a partial failure rolls back.
    const trialStart = new Date();
    const trialEnd = new Date(trialStart.getTime() + 14 * 24 * 60 * 60 * 1000);

    const broker = await db.broker.create({
      data: {
        id: user.id,
        email: user.email ?? "",
        fullName: body.fullName ?? user.email ?? "",
        role: "admin", // first user is admin
        subscription: {
          create: {
            planId: plan.id,
            status: "trialing",
            trialStart,
            trialEnd,
          },
        },
      },
      include: { subscription: true },
    });

    return NextResponse.json({ broker });
  },
  10,
  60_000,
);

// GET /api/auth/me — get current broker profile.
// Light-touch 30 req/min per IP (auth route, so exempt from the global
// middleware limit; this route-scoped cap stops a flood of /api/auth/me polls).
export const GET = withRateLimit(
  async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ user: null, broker: null });
    }

    const broker = await db.broker.findUnique({ where: { id: user.id } });
    return NextResponse.json({ user: { id: user.id, email: user.email }, broker });
  },
  30,
  60_000,
);

// DELETE /api/auth — sign out.
// Same 30 req/min cap — logout is cheap but a flood is still an abuse signal.
export const DELETE = withRateLimit(
  async () => {
    const supabase = await createClient();
    await supabase.auth.signOut();
    return NextResponse.json({ ok: true });
  },
  30,
  60_000,
);
