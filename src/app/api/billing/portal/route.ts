// POST /api/billing/portal
//
// Creates a Stripe Billing Portal session for the broker to manage their
// subscription (update payment method, swap plan, cancel, view invoices).
// Returns `{ url }` — the client redirects to Stripe.
//
// While no real Stripe key is configured, returns a mock URL pointing back
// to the in-app billing view so the button is testable.
//
// Auth: requires a logged-in broker.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentBroker } from "@/lib/auth";
import { db } from "@/lib/db";
import { stripe, hasStripeKey } from "@/lib/stripe";
import { getBrokerPlan } from "@/lib/plans";

export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Ensure the broker has a subscription row (auto-creates Free + trial).
  const { subscription } = await getBrokerPlan(broker.id);

  // Mock flow — no real Stripe key.
  if (!hasStripeKey()) {
    return NextResponse.json({
      url: "/?view=billing",
      mock: true,
      message: "Stripe key not configured — returning in-app billing URL.",
    });
  }

  const customerId = subscription.stripeCustomerId;
  if (!customerId) {
    return NextResponse.json(
      { error: "No Stripe customer is linked to your account yet. Subscribe to a plan first." },
      { status: 400 },
    );
  }

  const origin = new URL(req.url).origin;
  const returnUrl = `${origin}/?view=billing`;

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (e) {
    console.error("[billing/portal] Stripe error:", e);
    return NextResponse.json(
      { error: `Failed to create billing portal session: ${e instanceof Error ? e.message : "unknown"}` },
      { status: 502 },
    );
  }
}

export const dynamic = "force-dynamic";

// Also export a GET handler that redirects to the billing view — this makes
// the route callable from a link/button without a fetch wrapper (e.g. the
// Settings "Manage billing" button could just be a regular link to
// `/api/billing/portal`). Forwards to POST via a 307 redirect semantics by
// reusing the same handler.
export async function GET(req: NextRequest) {
  return POST(req);
}
