// GET /api/billing/status
//
// Returns the broker's subscription + usage snapshot for the billing
// dashboard: current plan details, status, trial end, current period, and
// per-resource usage vs plan limits (clients / suppliers / POs / photos).
// Also returns the full plan catalogue so the UI can render the upgrade
// matrix without a second fetch.
//
// Auth: requires a logged-in broker.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentBroker } from "@/lib/auth";
import { getBrokerPlan, ensurePlansExist } from "@/lib/plans";
import { getUsage } from "@/lib/usage-limits";

export async function GET(_req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Make sure plans exist + the broker has a subscription (auto-creates Free
  // + 14-day trial on first call). The `usage` aggregate re-uses getBrokerPlan
  // internally so this call also primes the cache.
  await getBrokerPlan(broker.id);
  const usage = await getUsage(broker.id);
  const plans = await ensurePlansExist();

  // Plan catalogue for the upgrade matrix — all 4 plans with their limits +
  // feature flags so the UI can render the comparison cards. `isCurrent` is
  // computed from the broker's subscribed plan name.
  const planCatalogue = (Object.values(plans).map((p) => ({
    id: p.id,
    name: p.name,
    displayName: p.displayName,
    priceMonthly: p.priceMonthly,
    priceYearly: p.priceYearly,
    maxClients: p.maxClients,
    maxSuppliers: p.maxSuppliers,
    maxPOs: p.maxPOs,
    maxPhotos: p.maxPhotos,
    portalAccess: p.portalAccess,
    aiDigest: p.aiDigest,
    customReports: p.customReports,
    advancedAnalytics: p.advancedAnalytics,
    description: p.description,
    isCurrent: p.name === usage.planName,
  }))).sort((a, b) => {
    // Sort by price ascending: free, basic, pro, enterprise.
    const order: Record<string, number> = { free: 0, basic: 1, pro: 2, enterprise: 3 };
    return (order[a.name] ?? 99) - (order[b.name] ?? 99);
  });

  return NextResponse.json({
    usage,
    plans: planCatalogue,
    subscription: {
      status: usage.status,
      trialEnd: usage.trialEnd,
      currentPeriodEnd: usage.currentPeriodEnd,
      planName: usage.planName,
      planDisplayName: usage.planDisplayName,
    },
  });
}

export const dynamic = "force-dynamic";
