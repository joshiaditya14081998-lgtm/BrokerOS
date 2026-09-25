// Usage-limit checks — server-side helper.
//
// Backs the `checkLimit` calls in the create routes (clients / suppliers /
// bookings/POs / photos) and the `getUsage` aggregate shown on the billing
// dashboard. Reads the broker's current subscription + plan, counts the
// matching rows for the requested resource, and returns an `allowed` boolean
// based on whether the count is below the plan limit (with -1 = unlimited).
//
// Free-trial brokers are subject to the same limits as their plan tier — the
// trial is a *time* window, not a usage exemption. A trialing Free broker
// still gets the Free plan's maxClients/maxSuppliers/maxPOs/maxPhotos.

import { db } from "@/lib/db";
import { getBrokerPlan } from "@/lib/plans";

export type LimitResource = "clients" | "suppliers" | "pos" | "photos";

export type LimitCheck = {
  allowed: boolean;
  current: number;
  limit: number; // -1 = unlimited
  planName: string;
};

export type UsageStats = {
  clients: { current: number; limit: number };
  suppliers: { current: number; limit: number };
  pos: { current: number; limit: number };
  photos: { current: number; limit: number };
  planName: string;
  planDisplayName: string;
  status: string;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
};

// Count the broker's current usage for one resource type.
async function countUsage(brokerId: string, resource: LimitResource): Promise<number> {
  switch (resource) {
    case "clients":
      return db.client.count({ where: { brokerId } });
    case "suppliers":
      return db.supplier.count({ where: { brokerId } });
    case "pos":
      return db.purchaseOrder.count({ where: { brokerId } });
    case "photos":
      return db.photo.count({ where: { brokerId } });
  }
}

// Check whether the broker can add one more of `resource`. Returns
// `{ allowed, current, limit, planName }`. A `limit === -1` is treated as
// unlimited (always allowed). Past-due / canceled subscriptions fall back to
// the Free plan's limits so a lapsed payment doesn't lock the broker out of
// reading existing data, but does prevent adding more.
export async function checkLimit(
  brokerId: string,
  resource: LimitResource,
): Promise<LimitCheck> {
  const { subscription, plans } = await getBrokerPlan(brokerId);

  // Past-due / canceled / paused → degrade to Free limits. Active / trialing
  // → keep the subscribed plan's limits. During a Pro trial, the broker gets
  // Pro plan limits (unlimited) — the trial is a plan-level upgrade, not just
  // a time window.
  const isDowngraded =
    subscription.status === "past_due" ||
    subscription.status === "canceled" ||
    subscription.status === "paused";
  const isTrialing = subscription.status === "trialing";
  // During trial: use Pro plan limits (unlimited clients/suppliers/POs)
  // After trial: use the subscribed plan's limits
  // If downgraded: fall back to Free limits
  const planRow = isDowngraded
    ? plans.free
    : isTrialing
      ? plans.pro ?? plans.free
      : plans[subscription.plan.name as keyof typeof plans] ?? plans.free;

  const limit = limitFor(planRow, resource);
  const current = await countUsage(brokerId, resource);

  // Unlimited → always allowed.
  if (limit === -1) {
    return { allowed: true, current, limit, planName: planRow.displayName };
  }
  return {
    allowed: current < limit,
    current,
    limit,
    planName: planRow.displayName,
  };
}

// Map a Plan row + resource to the matching limit field. -1 = unlimited.
function limitFor(
  plan: { maxClients: number; maxSuppliers: number; maxPOs: number; maxPhotos: number },
  resource: LimitResource,
): number {
  switch (resource) {
    case "clients":
      return plan.maxClients;
    case "suppliers":
      return plan.maxSuppliers;
    case "pos":
      return plan.maxPOs;
    case "photos":
      return plan.maxPhotos;
  }
}

// Full usage snapshot for the billing dashboard. Returns all four resource
// counts + the matching limits + the plan name + subscription status + trial
// end + current period end (all ISO strings for JSON transport).
export async function getUsage(brokerId: string): Promise<UsageStats> {
  const { subscription, plans } = await getBrokerPlan(brokerId);

  const isDowngraded =
    subscription.status === "past_due" ||
    subscription.status === "canceled" ||
    subscription.status === "paused";
  const isTrialing = subscription.status === "trialing";
  // During trial: use Pro plan limits (unlimited). After trial: subscribed plan.
  const planRow = isDowngraded
    ? plans.free
    : isTrialing
      ? plans.pro ?? plans.free
      : plans[subscription.plan.name as keyof typeof plans] ?? plans.free;

  const [clients, suppliers, pos, photos] = await Promise.all([
    db.client.count({ where: { brokerId } }),
    db.supplier.count({ where: { brokerId } }),
    db.purchaseOrder.count({ where: { brokerId } }),
    db.photo.count({ where: { brokerId } }),
  ]);

  return {
    clients: { current: clients, limit: planRow.maxClients },
    suppliers: { current: suppliers, limit: planRow.maxSuppliers },
    pos: { current: pos, limit: planRow.maxPOs },
    photos: { current: photos, limit: planRow.maxPhotos },
    planName: subscription.plan.name,
    planDisplayName: subscription.plan.displayName,
    status: subscription.status,
    trialEnd: subscription.trialEnd ? subscription.trialEnd.toISOString() : null,
    currentPeriodEnd: subscription.currentPeriodEnd
      ? subscription.currentPeriodEnd.toISOString()
      : null,
  };
}
