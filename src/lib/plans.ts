// Default plans — lazily seeded on first billing API call.
//
// The Plan rows back the subscription + checkout + usage-limit flows. They are
// idempotently created here so the app works on a fresh database without
// requiring a seed-script run. The 4 plans (free / basic / pro / enterprise)
// mirror the spec's tier structure. Each limit field uses -1 for unlimited.
//
// Prices are in INR (₹) per the schema comment. The `priceMonthly`/`priceYearly`
// fields are mirrored into Stripe as line-item amounts in the checkout route.
//
// Keep this array in sync with the public PLAN_DISPLAY constant in
// `src/components/views/billing-view.tsx` — the DB rows are the source of
// truth for limits, the client-side constant carries the UX copy (tagline,
// feature bullets, accent colour).

import { db } from "@/lib/db";

export type PlanTier = "free" | "basic" | "pro" | "enterprise";

type PlanSeed = {
  name: PlanTier;
  displayName: string;
  priceMonthly: number;
  priceYearly: number;
  maxClients: number;
  maxSuppliers: number;
  maxPOs: number;
  maxPhotos: number;
  portalAccess: boolean;
  aiDigest: boolean;
  customReports: boolean;
  advancedAnalytics: boolean;
  description: string;
};

// Default plan catalogue. Limits tuned for a single-broker garment operation:
//   free        — trial / very small (5/5/10/50)
//   basic       — early-stage broker (50/25/100/500) — ₹999/mo
//   pro         — established broker (unlimited clients/suppliers/POs, 5k photos) — ₹2,999/mo
//   enterprise  — unlimited everything + all premium features — ₹9,999/mo
//
// Prices match the public marketing landing page (`src/app/landing/page.tsx`)
// + the signup plan picker (`src/app/signup/page.tsx`). Keep all four surfaces in
// sync when you change a price here — search for the literal `₹` strings.
export const DEFAULT_PLANS: PlanSeed[] = [
  {
    name: "free",
    displayName: "Free",
    priceMonthly: 0,
    priceYearly: 0,
    maxClients: 5,
    maxSuppliers: 5,
    maxPOs: 10,
    maxPhotos: 50,
    portalAccess: false,
    aiDigest: false,
    customReports: false,
    advancedAnalytics: false,
    description: "Get started — explore the full pipeline with a small catalogue.",
  },
  {
    name: "basic",
    displayName: "Basic",
    priceMonthly: 999,
    priceYearly: 9990,
    maxClients: 50,
    maxSuppliers: 50,
    maxPOs: 200,
    maxPhotos: 500,
    portalAccess: false,
    aiDigest: true,
    customReports: false,
    advancedAnalytics: false,
    description: "For solo brokers running a steady book of business.",
  },
  {
    name: "pro",
    displayName: "Pro",
    priceMonthly: 2999,
    priceYearly: 29990,
    maxClients: -1,
    maxSuppliers: -1,
    maxPOs: -1,
    maxPhotos: 5000,
    portalAccess: true,
    aiDigest: true,
    customReports: true,
    advancedAnalytics: true,
    description: "Unlimited parties + orders, portal access, AI digest, custom reports.",
  },
  {
    name: "enterprise",
    displayName: "Enterprise",
    priceMonthly: 9999,
    priceYearly: 99990,
    maxClients: -1,
    maxSuppliers: -1,
    maxPOs: -1,
    maxPhotos: -1,
    portalAccess: true,
    aiDigest: true,
    customReports: true,
    advancedAnalytics: true,
    description: "Unlimited everything + advanced analytics + forecasting.",
  },
];

// Idempotently ensure all default plans exist. Safe to call from any billing
// route — uses upsert keyed on the unique `name` column so re-runs are a no-op.
// Returns the plans keyed by name for quick lookup.
export async function ensurePlansExist(): Promise<Record<PlanTier, PlanSeed & { id: string }>> {
  for (const plan of DEFAULT_PLANS) {
    await db.plan.upsert({
      where: { name: plan.name },
      create: plan,
      update: {
        // Keep DB rows in sync if the defaults change (price tweaks, limit
        // bumps) — but never override a row the broker's subscription depends
        // on with breaking changes (e.g. renaming the tier). The upsert key
        // is `name`, which is stable.
        displayName: plan.displayName,
        priceMonthly: plan.priceMonthly,
        priceYearly: plan.priceYearly,
        maxClients: plan.maxClients,
        maxSuppliers: plan.maxSuppliers,
        maxPOs: plan.maxPOs,
        maxPhotos: plan.maxPhotos,
        portalAccess: plan.portalAccess,
        aiDigest: plan.aiDigest,
        customReports: plan.customReports,
        advancedAnalytics: plan.advancedAnalytics,
        description: plan.description,
        isActive: true,
      },
    });
  }
  const rows = await db.plan.findMany({ where: { name: { in: DEFAULT_PLANS.map((p) => p.name) } } });
  const byName = new Map(rows.map((r) => [r.name as PlanTier, r]));
  // The non-null assertion is safe — we just upserted every name.
  return Object.fromEntries(
    DEFAULT_PLANS.map((p) => [p.name, { ...p, id: byName.get(p.name)!.id }]),
  ) as Record<PlanTier, PlanSeed & { id: string }>;
}

// Get a broker's active plan + subscription. Auto-creates a Free subscription
// (with a 14-day trial) for brokers who don't yet have one so every API call
// has a concrete plan + limits to enforce against.
export async function getBrokerPlan(brokerId: string) {
  const plans = await ensurePlansExist();
  let subscription = await db.subscription.findUnique({
    where: { brokerId },
    include: { plan: true },
  });
  if (!subscription) {
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days
    subscription = await db.subscription.create({
      data: {
        brokerId,
        planId: plans.free.id,
        status: "trialing",
        trialStart: now,
        trialEnd,
      },
      include: { plan: true },
    });
  }
  return { subscription, plans };
}
