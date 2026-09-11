import { db } from "@/lib/db";

/**
 * Admin-helpers — shared utilities for the Super Admin Panel API routes.
 *
 * `ensureDefaultPlans()` is idempotent: it creates the four canonical plan
 * rows (free / basic / pro / enterprise) if any are missing, and updates
 * existing rows to match the canonical defaults. It is called by every
 * admin API route that reads from the `Plan` table so the panel always has
 * a sensible set of plans even on a fresh database (e.g. before the seed
 * script has been run, or after a `--force-reset`).
 */

export type DefaultPlan = {
  name: string;
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

// Canonical SaaS plan catalogue. Prices are in INR (₹/month).
// `maxX: -1` means unlimited.
export const DEFAULT_PLANS: DefaultPlan[] = [
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
    description: "Starter plan for individual brokers evaluating the platform.",
  },
  {
    name: "basic",
    displayName: "Basic",
    priceMonthly: 999,
    priceYearly: 9990,
    maxClients: 25,
    maxSuppliers: 25,
    maxPOs: 100,
    maxPhotos: 500,
    portalAccess: true,
    aiDigest: false,
    customReports: false,
    advancedAnalytics: false,
    description: "For solo brokers running a small book of business.",
  },
  {
    name: "pro",
    displayName: "Pro",
    priceMonthly: 2999,
    priceYearly: 29990,
    maxClients: 100,
    maxSuppliers: 100,
    maxPOs: 500,
    maxPhotos: 5000,
    portalAccess: true,
    aiDigest: true,
    customReports: true,
    advancedAnalytics: false,
    description: "For growing brokerages that need portals + AI digest.",
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
    description: "Unlimited everything + advanced forecasting. For multi-broker firms.",
  },
];

/**
 * Idempotently ensure the four canonical plans exist in the database.
 * Returns the full plan list (ordered by price ascending) so callers can
 * use the result directly without an extra round-trip.
 */
export async function ensureDefaultPlans() {
  // Upsert each canonical plan. `name` is unique so `upsert` is safe.
  for (const p of DEFAULT_PLANS) {
    await db.plan.upsert({
      where: { name: p.name },
      create: {
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
        isActive: true,
      },
      update: {
        // Only update non-price display fields on existing rows; price +
        // limits are editable from the admin Settings page so we don't
        // clobber the admin's custom values here. Description + display
        // name are kept in sync with the canonical copy.
        displayName: p.displayName,
        description: p.description,
      },
    });
  }
  return db.plan.findMany({ orderBy: { priceMonthly: "asc" } });
}
