// POST /api/webhooks/stripe
//
// Stripe webhook receiver — no auth (Stripe verifies its own signature).
// Handles the 4 lifecycle events that drive the Subscription model:
//
//   checkout.session.completed     → create/activate Subscription
//   customer.subscription.updated   → update status + period + plan
//   customer.subscription.deleted   → status = canceled
//   invoice.payment_failed          → status = past_due
//
// Verifies the Stripe-Signature header using `STRIPE_WEBHOOK_SECRET`. While
// the placeholder secret is in use, signature verification is skipped and
// the route processes events as if they were verified (so mock / dev testing
// works). With a real secret, an invalid signature returns 400.
//
// Writes AdminAuditLog entries for each lifecycle mutation so there's a
// tamper-evident record of every subscription state change.

import { NextRequest, NextResponse } from "next/server";
import { Stripe } from "stripe";
import { stripe, hasStripeWebhookSecret } from "@/lib/stripe";
import { db } from "@/lib/db";
import { ensurePlansExist, type PlanTier } from "@/lib/plans";

// ─── Period extraction helper ───────────────────────────────────────────────
// Stripe SDK v22 types the Subscription object against the latest API
// version ("2026-08-26.dahlia"), which moved `current_period_start`/`_end`
// off the Subscription and onto each SubscriptionItem. We pin our request
// `apiVersion` to "2024-06-20" — at runtime, Stripe returns those legacy
// top-level fields, so we read them defensively: try the top-level fields
// first (works with our pinned version), then fall back to the first
// subscription item's period fields (works with the SDK's default version).
function extractPeriod(sub: Stripe.Subscription): { start: Date | null; end: Date | null } {
  // Legacy: top-level fields (Stripe API ≤ ~2025).
  const legacy = sub as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };
  if (typeof legacy.current_period_start === "number" && typeof legacy.current_period_end === "number") {
    return {
      start: new Date(legacy.current_period_start * 1000),
      end: new Date(legacy.current_period_end * 1000),
    };
  }
  // New: SubscriptionItem.current_period_start/end (Stripe API "dahlia"+).
  const firstItem = sub.items?.data?.[0];
  if (firstItem && typeof firstItem.current_period_start === "number" && typeof firstItem.current_period_end === "number") {
    return {
      start: new Date(firstItem.current_period_start * 1000),
      end: new Date(firstItem.current_period_end * 1000),
    };
  }
  return { start: null, end: null };
}

// ─── Subscription extraction from an Invoice ───────────────────────────────
// In Stripe SDK v22 the Invoice type's `subscription` field was moved to
// `invoice.parent.subscription_details.subscription`. Try both for safety.
function extractInvoiceSubscription(invoice: Stripe.Invoice): string | null {
  // New API path.
  const subDetails = (invoice as { parent?: { subscription_details?: { subscription?: string | { id: string } } | null } | null }).parent?.subscription_details;
  if (subDetails && subDetails.subscription) {
    return typeof subDetails.subscription === "string" ? subDetails.subscription : subDetails.subscription.id;
  }
  // Legacy top-level field.
  const legacy = invoice as unknown as { subscription?: string | { id: string } | null };
  if (legacy.subscription) {
    return typeof legacy.subscription === "string" ? legacy.subscription : legacy.subscription.id;
  }
  return null;
}


export async function POST(req: NextRequest) {
  const payload = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

  let event: Stripe.Event;
  if (hasStripeWebhookSecret()) {
    try {
      event = stripe.webhooks.constructEvent(payload, signature, secret);
    } catch (e) {
      console.error("[webhooks/stripe] signature verification failed:", e);
      return NextResponse.json(
        { error: `Invalid signature: ${e instanceof Error ? e.message : "unknown"}` },
        { status: 400 },
      );
    }
  } else {
    // Mock mode — parse the payload directly without verifying. Used during
    // dev / testing before a real webhook secret is configured.
    try {
      event = JSON.parse(payload) as Stripe.Event;
    } catch (e) {
      return NextResponse.json(
        { error: `Invalid payload (no webhook secret configured, raw parse failed): ${e instanceof Error ? e.message : "unknown"}` },
        { status: 400 },
      );
    }
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event);
        break;
      default:
        // Acknowledge unhandled events so Stripe doesn't retry them.
        break;
    }
  } catch (e) {
    console.error("[webhooks/stripe] handler error for", event.type, e);
    return NextResponse.json(
      { error: `Handler error: ${e instanceof Error ? e.message : "unknown"}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true, type: event.type });
}

// checkout.session.completed — the broker just paid. Metadata on the
// session + the underlying subscription carry the brokerId + planId so we
// can activate the Subscription row.
async function handleCheckoutCompleted(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  const brokerId = (session.metadata?.brokerId as string | undefined) ?? (session.client_reference_id as string | undefined);
  const planId = session.metadata?.planId as string | undefined;
  if (!brokerId) {
    console.warn("[webhooks/stripe] checkout.session.completed — missing brokerId in metadata");
    return;
  }
  const plans = await ensurePlansExist();
  // Resolve the planId from metadata first; if missing, fall back to the
  // current plan so the activation still proceeds.
  const planRow = planId
    ? Object.values(plans).find((p) => p.id === planId)
    : undefined;
  if (!planRow) {
    console.warn("[webhooks/stripe] checkout.session.completed — unknown planId:", planId);
    // Don't bail — still update the subscription with the stripe IDs + status.
  }

  const before = await db.subscription.findUnique({ where: { brokerId } });

  // Fetch the underlying subscription object for the period timestamps.
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  let stripeSubId: string | null = null;
  if (typeof session.subscription === "string" && session.subscription.length > 0) {
    stripeSubId = session.subscription;
    try {
      const sub = await stripe.subscriptions.retrieve(stripeSubId);
      const period = extractPeriod(sub);
      periodStart = period.start;
      periodEnd = period.end;
    } catch (e) {
      console.warn("[webhooks/stripe] couldn't retrieve subscription for period:", e);
    }
  }

  const now = new Date();
  const subscription = await db.subscription.upsert({
    where: { brokerId },
    create: {
      brokerId,
      planId: planRow?.id ?? before?.planId ?? plans.free.id,
      status: "active",
      stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
      stripeSubId,
      currentPeriodStart: periodStart ?? now,
      currentPeriodEnd: periodEnd,
      canceledAt: null,
    },
    update: {
      planId: planRow?.id ?? before?.planId ?? plans.free.id,
      status: "active",
      stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? before?.stripeCustomerId ?? null,
      stripeSubId: stripeSubId ?? before?.stripeSubId ?? null,
      currentPeriodStart: periodStart ?? before?.currentPeriodStart ?? now,
      currentPeriodEnd: periodEnd ?? before?.currentPeriodEnd ?? null,
      canceledAt: null,
    },
    include: { plan: true },
  });

  await db.adminAuditLog.create({
    data: {
      adminId: brokerId,
      action: "change_plan",
      targetType: "Subscription",
      targetId: subscription.id,
      before: before ? JSON.stringify({ planId: before.planId, status: before.status }) : null,
      after: JSON.stringify({
        planId: subscription.planId,
        planName: subscription.plan.name,
        status: "active",
        stripeSubId,
      }),
      reason: `Stripe checkout completed — event ${event.id}`,
    },
  });
}

// customer.subscription.updated — plan upgrade/downgrade, period renewal, or
// status change. We mirror the Stripe-side state into our Subscription row.
async function handleSubscriptionUpdated(event: Stripe.Event) {
  const sub = event.data.object as Stripe.Subscription;
  const brokerId = (sub.metadata?.brokerId as string | undefined) ?? null;
  if (!brokerId) {
    // Try to find by stripeSubId as a fallback. `stripeSubId` is not a unique
    // column in the schema (only `brokerId` is), so we use `findFirst`.
    const existing = await db.subscription.findFirst({ where: { stripeSubId: sub.id } });
    if (!existing) {
      console.warn("[webhooks/stripe] subscription.updated — no brokerId in metadata and no existing row for", sub.id);
      return;
    }
    await applySubscriptionUpdate(existing.brokerId, sub, event.id);
    return;
  }
  await applySubscriptionUpdate(brokerId, sub, event.id);
}

async function applySubscriptionUpdate(brokerId: string, sub: Stripe.Subscription, eventId: string) {
  const plans = await ensurePlansExist();
  const planName = (sub.metadata?.planName as string | undefined) as PlanTier | undefined;
  const planIdFromMeta = sub.metadata?.planId as string | undefined;
  const planRow = planIdFromMeta
    ? Object.values(plans).find((p) => p.id === planIdFromMeta)
    : planName
      ? plans[planName]
      : undefined;

  const before = await db.subscription.findUnique({ where: { brokerId } });
  if (!before) {
    console.warn("[webhooks/stripe] subscription.updated — no existing Subscription for broker", brokerId);
    return;
  }

  const period = extractPeriod(sub);
  const periodStart = period.start;
  const periodEnd = period.end;
  const newStatus = mapStripeStatus(sub.status);

  const updated = await db.subscription.update({
    where: { brokerId },
    data: {
      planId: planRow?.id ?? before.planId,
      status: newStatus,
      stripeSubId: sub.id,
      currentPeriodStart: periodStart ?? before.currentPeriodStart,
      currentPeriodEnd: periodEnd ?? before.currentPeriodEnd,
      canceledAt: newStatus === "canceled" ? new Date() : before.canceledAt,
    },
    include: { plan: true },
  });

  await db.adminAuditLog.create({
    data: {
      adminId: brokerId,
      action: "update_subscription",
      targetType: "Subscription",
      targetId: updated.id,
      before: JSON.stringify({ planId: before.planId, status: before.status }),
      after: JSON.stringify({ planId: updated.planId, planName: updated.plan.name, status: newStatus, stripeSubId: sub.id }),
      reason: `Stripe subscription updated — event ${eventId}`,
    },
  });
}

// customer.subscription.deleted — broker canceled (or Stripe canceled for
// non-payment after dunning). Mark the row canceled; the usage-limit helper
// will fall back to Free limits on the next create request.
async function handleSubscriptionDeleted(event: Stripe.Event) {
  const sub = event.data.object as Stripe.Subscription;
  const brokerId = (sub.metadata?.brokerId as string | undefined) ?? null;
  if (!brokerId) {
    const existing = await db.subscription.findFirst({ where: { stripeSubId: sub.id } });
    if (!existing) {
      console.warn("[webhooks/stripe] subscription.deleted — no brokerId in metadata and no existing row for", sub.id);
      return;
    }
    await applySubscriptionDeleted(existing.brokerId, sub, event.id);
    return;
  }
  await applySubscriptionDeleted(brokerId, sub, event.id);
}

async function applySubscriptionDeleted(brokerId: string, sub: Stripe.Subscription, eventId: string) {
  const before = await db.subscription.findUnique({ where: { brokerId } });
  if (!before) return;
  const now = new Date();
  const updated = await db.subscription.update({
    where: { brokerId },
    data: {
      status: "canceled",
      canceledAt: now,
      stripeSubId: sub.id,
    },
    include: { plan: true },
  });
  await db.adminAuditLog.create({
    data: {
      adminId: brokerId,
      action: "cancel_subscription",
      targetType: "Subscription",
      targetId: updated.id,
      before: JSON.stringify({ planId: before.planId, status: before.status }),
      after: JSON.stringify({ planId: updated.planId, planName: updated.plan.name, status: "canceled" }),
      reason: `Stripe subscription deleted — event ${eventId}`,
    },
  });
}

// invoice.payment_failed — dunning failed. Mark the subscription past_due so
// the UI can show a warning + the usage-limit helper degrades to Free limits.
async function handleInvoicePaymentFailed(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId = extractInvoiceSubscription(invoice);
  if (!subscriptionId) {
    console.warn("[webhooks/stripe] invoice.payment_failed — no subscription id on invoice");
    return;
  }
  // `stripeSubId` is not a unique column — use `findFirst`.
  const existing = await db.subscription.findFirst({ where: { stripeSubId: subscriptionId } });
  if (!existing) {
    console.warn("[webhooks/stripe] invoice.payment_failed — no existing subscription for", subscriptionId);
    return;
  }
  const before = JSON.stringify({ planId: existing.planId, status: existing.status });
  await db.subscription.update({
    where: { brokerId: existing.brokerId },
    data: { status: "past_due" },
  });
  await db.adminAuditLog.create({
    data: {
      adminId: existing.brokerId,
      action: "payment_failed",
      targetType: "Subscription",
      targetId: existing.id,
      before,
      after: JSON.stringify({ planId: existing.planId, status: "past_due" }),
      reason: `Stripe invoice payment failed — event ${event.id}`,
    },
  });
}

// Map Stripe's subscription status enum to our schema's status union.
function mapStripeStatus(stripeStatus: Stripe.Subscription.Status): string {
  switch (stripeStatus) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "paused":
      return "paused";
    case "unpaid":
      return "past_due";
    case "incomplete":
    case "incomplete_expired":
      return "past_due";
    default:
      return "active";
  }
}

export const dynamic = "force-dynamic";
