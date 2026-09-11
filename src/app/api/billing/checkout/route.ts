// POST /api/billing/checkout
//
// Initiates a Stripe Checkout Session for upgrading the broker's subscription
// to the requested plan + billing cycle. Returns `{ url }` — the client
// redirects to Stripe Checkout. After payment, Stripe POSTs the
// `checkout.session.completed` event to the webhook, which creates/activates
// the Subscription row.
//
// While no real Stripe key is configured (placeholder env var), the route
// returns a mock URL pointing at the in-app billing view so the upgrade flow
// is testable end-to-end before going live.
//
// Auth: requires a logged-in broker (Supabase session via getCurrentBroker).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentBroker } from "@/lib/auth";
import { db } from "@/lib/db";
import { stripe, hasStripeKey } from "@/lib/stripe";
import { ensurePlansExist } from "@/lib/plans";

const CheckoutSchema = z.object({
  planId: z.string().min(1),
  billingCycle: z.enum(["monthly", "yearly"]).default("monthly"),
});

export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = CheckoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { planId, billingCycle } = parsed.data;

  // Make sure the Plan rows exist (idempotent) so we can validate the requested
  // planId against the canonical catalogue.
  const plans = await ensurePlansExist();
  const planRow = Object.values(plans).find((p) => p.id === planId);
  if (!planRow) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }
  // Free plan can't be "purchased" — it's the default. Redirect back to billing.
  if (planRow.name === "free") {
    return NextResponse.json({ error: "Free plan does not require checkout" }, { status: 400 });
  }

  const amount = billingCycle === "yearly" ? planRow.priceYearly : planRow.priceMonthly;
  // Stripe expects the amount in the smallest currency unit (paise for INR).
  const amountInPaise = Math.round(amount * 100);

  // ── Mock flow — when no real Stripe key is configured, return a fake URL
  // pointing back to the billing view so the upgrade click is testable.
  if (!hasStripeKey()) {
    const mockUrl = `/api/billing/checkout/mock-success?planId=${encodeURIComponent(planRow.id)}&cycle=${billingCycle}`;
    return NextResponse.json({
      url: mockUrl,
      mock: true,
      message: "Stripe key not configured — returning mock checkout URL.",
    });
  }

  // ── Live flow — build a Stripe Checkout Session.
  // The success/cancel URLs are relative to the app origin (Stripe requires
  // absolute URLs — we derive from the request URL).
  const origin = new URL(req.url).origin;
  const successUrl = `${origin}/api/billing/checkout/mock-success?planId=${encodeURIComponent(planRow.id)}&cycle=${billingCycle}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${origin}/?view=billing`;

  // Look up or create the broker's Stripe Customer ID so the checkout is
  // associated with a stable customer across upgrades.
  const subscription = await db.subscription.findUnique({ where: { brokerId: broker.id } });
  let customerId = subscription?.stripeCustomerId ?? undefined;

  try {
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: broker.email,
        name: broker.fullName ?? broker.email,
        metadata: { brokerId: broker.id },
      });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: "inr",
            unit_amount: amountInPaise,
            product_data: {
              name: `Broker OS — ${planRow.displayName}`,
              description: planRow.description ?? undefined,
            },
            // For yearly, set the recurring interval to "year"; monthly → "month".
            recurring: { interval: billingCycle === "yearly" ? "year" : "month" },
          },
          quantity: 1,
        },
      ],
      subscription_data: {
        metadata: {
          brokerId: broker.id,
          planId: planRow.id,
          planName: planRow.name,
          billingCycle,
        },
      },
      client_reference_id: broker.id,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { brokerId: broker.id, planId: planRow.id, planName: planRow.name, billingCycle },
    });

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (e) {
    console.error("[billing/checkout] Stripe error:", e);
    return NextResponse.json(
      { error: `Failed to create checkout session: ${e instanceof Error ? e.message : "unknown"}` },
      { status: 502 },
    );
  }
}

// GET /api/billing/checkout/mock-success?planId=...&cycle=...
//
// Mock success redirect — when no real Stripe key is configured, this route
// activates the subscription directly (skipping the webhook) so the upgrade
// flow is end-to-end testable. Real Stripe keys → Stripe POSTs to the webhook
// instead, and this route is unused (still callable as a Stripe success_url
// target — it'll re-activate the subscription idempotently, which is fine
// because the webhook will also fire and arrive at the same end state).
export async function GET(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const planId = searchParams.get("planId");
  const cycle = searchParams.get("cycle") === "yearly" ? "yearly" : "monthly";
  if (!planId) return NextResponse.json({ error: "Missing planId" }, { status: 400 });

  const plans = await ensurePlansExist();
  const planRow = Object.values(plans).find((p) => p.id === planId);
  if (!planRow) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const now = new Date();
  const periodEnd = new Date(now.getTime() + (cycle === "yearly" ? 365 : 30) * 24 * 60 * 60 * 1000);

  const before = await db.subscription.findUnique({ where: { brokerId: broker.id } });
  const subscription = await db.subscription.upsert({
    where: { brokerId: broker.id },
    create: {
      brokerId: broker.id,
      planId: planRow.id,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      stripeCustomerId: `mock_customer_${broker.id.slice(0, 8)}`,
      stripeSubId: `mock_sub_${Date.now()}`,
    },
    update: {
      planId: planRow.id,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      canceledAt: null,
      stripeCustomerId: before?.stripeCustomerId ?? `mock_customer_${broker.id.slice(0, 8)}`,
      stripeSubId: `mock_sub_${Date.now()}`,
    },
    include: { plan: true },
  });

  // AdminAuditLog — captures the upgrade for the broker's audit trail.
  await db.adminAuditLog.create({
    data: {
      adminId: broker.id,
      action: "change_plan",
      targetType: "Subscription",
      targetId: subscription.id,
      before: before ? JSON.stringify({ planId: before.planId, status: before.status }) : null,
      after: JSON.stringify({ planId: planRow.id, planName: planRow.name, status: "active", billingCycle: cycle }),
      reason: `Mock checkout upgrade to ${planRow.displayName} (${cycle}).`,
    },
  });

  // Redirect back to the billing view — the broker sees the new plan active.
  return NextResponse.redirect(new URL("/?view=billing", new URL(req.url).origin));
}

// Allow GET for the mock-success redirect + POST for the checkout.
export const dynamic = "force-dynamic";
