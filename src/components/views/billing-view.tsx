"use client";

// Billing & Plan view — Stripe subscription management surface for the broker.
//
// Renders:
//   - a "Current plan" card: plan name, status badge, trial countdown (if
//     trialing), price + renewal date, and a "Manage billing" button that
//     opens the Stripe Billing Portal,
//   - a "Usage" card: 4 progress bars (Clients, Suppliers, POs, Photos) with
//     current vs plan limit + an amber "at limit" callout when capacity is hit,
//   - a "Plans" comparison: 4 plan cards (Free, Basic, Pro, Enterprise) with
//     a feature list + "Upgrade" / "Current" buttons. Clicking "Upgrade"
//     POSTs to /api/billing/checkout and redirects to Stripe (or to the mock
//     in-app redirect if no real Stripe key is configured).
//
// All data flows from GET /api/billing/status. Errors + the loading state are
// surfaced inline so the broker is never staring at a blank screen.

import * as React from "react";
import {
  CreditCard, Check, Zap, Crown, TrendingUp, Loader2, AlertCircle,
  Sparkles, Building2, Users, FileText, Image as ImageIcon,
  Clock, ArrowUpRight, ShieldCheck, LayoutTemplate,
} from "lucide-react";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useApi, api } from "@/lib/api";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── API response types ────────────────────────────────────────────────────
type PlanRow = {
  id: string;
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
  isCurrent: boolean;
};

type UsageStats = {
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

type BillingStatus = {
  usage: UsageStats;
  plans: PlanRow[];
  subscription: {
    status: string;
    trialEnd: string | null;
    currentPeriodEnd: string | null;
    planName: string;
    planDisplayName: string;
  };
};

// ─── Plan accent + icon ────────────────────────────────────────────────────
// Each plan tier gets a distinct accent colour + leading glyph so the
// comparison cards read at a glance. NO indigo/blue per the design rules —
// we use emerald (free), teal (basic), amber (pro), and a deep slate/plum
// (enterprise) to imply increasing premium-ness.
type PlanAccent = "emerald" | "teal" | "amber" | "plum";

const PLAN_ACCENT: Record<string, PlanAccent> = {
  free: "emerald",
  basic: "teal",
  pro: "amber",
  enterprise: "plum",
};

const PLAN_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  free: Users,
  basic: TrendingUp,
  pro: Zap,
  enterprise: Crown,
};

const ACCENT_CLASS: Record<PlanAccent, { ring: string; chip: string; btn: string; bar: string }> = {
  emerald: {
    ring: "border-emerald-500/40",
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    btn: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300",
    bar: "bg-emerald-500",
  },
  teal: {
    ring: "border-teal-500/40",
    chip: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
    btn: "border-teal-500/40 bg-teal-500/10 text-teal-700 hover:bg-teal-500/20 dark:text-teal-300",
    bar: "bg-teal-500",
  },
  amber: {
    ring: "border-amber-500/40",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    btn: "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300",
    bar: "bg-amber-500",
  },
  plum: {
    ring: "border-fuchsia-500/40",
    chip: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
    btn: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 hover:bg-fuchsia-500/20 dark:text-fuchsia-300",
    bar: "bg-fuchsia-500",
  },
};

// ─── Feature list per plan ─────────────────────────────────────────────────
// The DB Plan rows carry the boolean feature flags (portalAccess, aiDigest,
// customReports, advancedAnalytics); we render those as ✓/✗ rows here. The
// "Parties / POs / Photos" rows are derived from the limit fields (-1 = ∞).
function features(plan: PlanRow): { label: string; included: boolean }[] {
  return [
    { label: `Up to ${formatLimit(plan.maxClients)} clients`, included: true },
    { label: `Up to ${formatLimit(plan.maxSuppliers)} suppliers`, included: true },
    { label: `Up to ${formatLimit(plan.maxPOs)} purchase orders`, included: true },
    { label: `${formatLimit(plan.maxPhotos)} photos`, included: true },
    { label: "Supplier & client portals", included: plan.portalAccess },
    { label: "AI daily digest", included: plan.aiDigest },
    { label: "Custom report builder", included: plan.customReports },
    { label: "Advanced analytics + forecasting", included: plan.advancedAnalytics },
  ];
}

function formatLimit(n: number): string {
  return n === -1 ? "Unlimited" : String(n);
}

// ─── Component ──────────────────────────────────────────────────────────────
export function BillingView() {
  const { data, error, loading, refresh } = useApi<BillingStatus>("/api/billing/status");
  const { format } = useCurrencyFormat();
  const [billingCycle, setBillingCycle] = React.useState<"monthly" | "yearly">("monthly");
  const [upgradingPlanId, setUpgradingPlanId] = React.useState<string | null>(null);
  const [portalLoading, setPortalLoading] = React.useState(false);

  if (loading) return <BillingSkeleton />;

  if (error || !data) {
    return (
      <div className="space-y-6">
        <SectionHeader
          title="Billing & Plan"
          description="Manage your subscription"
          action={
            <Button size="sm" variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
        <GlassCard className="p-6">
          <EmptyState
            title="Couldn't load billing status"
            hint={error ?? "Unknown error — please try again."}
            icon={<AlertCircle className="size-5 text-rose-600 dark:text-rose-400" />}
          />
        </GlassCard>
      </div>
    );
  }

  const { usage, plans, subscription } = data;

  const handleUpgrade = async (plan: PlanRow) => {
    if (plan.isCurrent) return;
    if (plan.name === "free") {
      toast.message("You're already on the Free tier — pick a paid plan to upgrade.");
      return;
    }
    setUpgradingPlanId(plan.id);
    try {
      const res = await api<{ url: string; mock?: boolean }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ planId: plan.id, billingCycle }),
      });
      if (!res.url) {
        toast.error("Stripe checkout failed to return a URL.");
        return;
      }
      if (res.mock) {
        toast.success(`Mock upgrade to ${plan.displayName} — redirecting…`);
      } else {
        toast.success(`Redirecting to Stripe Checkout (${plan.displayName})…`);
      }
      // Use a full-page redirect so the Stripe-hosted Checkout / mock URL
      // replaces the in-app view (the mock URL points back here afterwards).
      window.location.href = res.url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start checkout");
    } finally {
      setUpgradingPlanId(null);
    }
  };

  const handlePortal = async () => {
    setPortalLoading(true);
    try {
      const res = await api<{ url: string; mock?: boolean }>("/api/billing/portal", {
        method: "POST",
      });
      if (!res.url) {
        toast.error("Stripe portal failed to return a URL.");
        return;
      }
      if (res.mock) {
        toast.message("Stripe isn't configured yet — manage your plan from the cards below.");
      } else {
        toast.success("Opening Stripe billing portal…");
      }
      window.location.href = res.url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to open billing portal");
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Billing & Plan"
        description="Manage your subscription, usage, and billing details."
        action={
          <div className="flex items-center gap-2">
            <BillingCycleSelect value={billingCycle} onChange={setBillingCycle} />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handlePortal()}
              disabled={portalLoading}
            >
              {portalLoading ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <CreditCard className="mr-1.5 size-4" />
              )}
              Manage billing
            </Button>
          </div>
        }
      />

      {/* Current plan card */}
      <CurrentPlanCard
        usage={usage}
        subscription={subscription}
        billingCycle={billingCycle}
        format={format}
      />

      {/* Usage card */}
      <UsageCard usage={usage} />

      {/* Plan comparison */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="size-4 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-base font-semibold text-foreground">Compare plans</h3>
          <Badge variant="outline" className="ml-1 text-muted-foreground">
            {billingCycle === "yearly" ? "2 months free, billed yearly" : "Billed monthly"}
          </Badge>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => {
            const accent = ACCENT_CLASS[PLAN_ACCENT[plan.name] ?? "emerald"];
            const Icon = PLAN_ICON[plan.name] ?? Users;
            const isUpgrading = upgradingPlanId === plan.id;
            const price = billingCycle === "yearly" ? plan.priceYearly : plan.priceMonthly;
            return (
              <GlassCard
                key={plan.id}
                className={cn(
                  "flex flex-col gap-4 p-5 hover-lift",
                  plan.isCurrent && cn("ring-2", accent.ring),
                )}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={cn(
                        "grid size-9 place-items-center rounded-xl border",
                        accent.chip,
                      )}
                    >
                      <Icon className="size-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{plan.displayName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {plan.name === "free" ? "Starter tier" : plan.name === "enterprise" ? "Top tier" : "Paid tier"}
                      </p>
                    </div>
                  </div>
                  {plan.isCurrent && (
                    <Badge className={cn("border", accent.chip)}>Current</Badge>
                  )}
                </div>

                {/* Price */}
                <div>
                  <p className="kpi-num text-2xl font-light text-foreground">
                    {price === 0 ? "₹0" : format(price, { compact: true })}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      /{billingCycle === "yearly" ? "yr" : "mo"}
                    </span>
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {billingCycle === "yearly" && plan.priceMonthly > 0
                      ? `≈ ${format(Math.round(plan.priceYearly / 12), { compact: true })}/mo`
                      : plan.description}
                  </p>
                </div>

                {/* Feature list */}
                <ul className="space-y-1.5 text-xs">
                  {features(plan).map((f) => (
                    <li
                      key={f.label}
                      className={cn(
                        "flex items-start gap-1.5",
                        f.included ? "text-foreground" : "text-muted-foreground/60",
                      )}
                    >
                      {f.included ? (
                        <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <span className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40">—</span>
                      )}
                      <span className={cn(!f.included && "line-through decoration-muted-foreground/30")}>
                        {f.label}
                      </span>
                    </li>
                  ))}
                </ul>

                {/* Action */}
                <div className="mt-auto">
                  {plan.isCurrent ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled
                      className="w-full"
                    >
                      <Check className="mr-1.5 size-3.5" />
                      Your current plan
                    </Button>
                  ) : plan.name === "free" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled
                      className="w-full text-muted-foreground"
                    >
                      <ArrowUpRight className="mr-1.5 size-3.5" />
                      Upgrade to paid
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className={cn("w-full border", accent.btn)}
                      onClick={() => void handleUpgrade(plan)}
                      disabled={isUpgrading}
                    >
                      {isUpgrading ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <ArrowUpRight className="mr-1.5 size-3.5" />
                      )}
                      {isUpgrading ? "Redirecting…" : `Upgrade to ${plan.displayName}`}
                    </Button>
                  )}
                </div>
              </GlassCard>
            );
          })}
        </div>
      </div>

      {/* Help footer */}
      <GlassCard className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="text-sm font-medium text-foreground">Need a custom plan?</p>
            <p className="text-xs text-muted-foreground">
              Volume discounts, multi-broker teams, and on-prem hosting are available on Enterprise.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => (window.location.href = "mailto:sales@broker-os.com?subject=Enterprise%20plan%20enquiry")}
        >
          Contact sales
        </Button>
      </GlassCard>
    </div>
  );
}

// ─── Current plan card ──────────────────────────────────────────────────────
function CurrentPlanCard({
  usage,
  subscription,
  billingCycle,
  format,
}: {
  usage: UsageStats;
  subscription: BillingStatus["subscription"];
  billingCycle: "monthly" | "yearly";
  format: (n: number, opts?: { compact?: boolean }) => string;
}) {
  const status = subscription.status;
  const statusTone = STATUS_TONE[status] ?? STATUS_TONE.active;
  const Icon = PLAN_ICON[usage.planName] ?? Users;
  const accent = ACCENT_CLASS[PLAN_ACCENT[usage.planName] ?? "emerald"];

  const trialEnd = subscription.trialEnd ? new Date(subscription.trialEnd) : null;
  const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000))) : null;
  const renewalDate = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;

  return (
    <GlassCard className={cn("relative overflow-hidden p-5 hover-lift", "ring-1", accent.ring)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className={cn("grid size-11 place-items-center rounded-xl border", accent.chip)}>
            <Icon className="size-5" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Current plan
            </p>
            <p className="text-xl font-semibold text-foreground">{subscription.planDisplayName}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge className={cn("border capitalize", statusTone.chip)}>
                <span className={cn("size-1.5 rounded-full", statusTone.dot)} />
                {STATUS_LABEL[status] ?? status}
              </Badge>
              {status === "trialing" && daysLeft !== null && (
                <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                  <Clock className="size-3" />
                  {daysLeft === 0 ? "Trial ends today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
                </Badge>
              )}
              {renewalDate && status !== "trialing" && status !== "canceled" && (
                <span className="text-[11px] text-muted-foreground">
                  Renews {renewalDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {billingCycle === "yearly" ? "Yearly" : "Monthly"} cost
          </p>
          <p className="kpi-num text-2xl font-light text-foreground">
            {usage.planName === "free"
              ? "₹0"
              : format(billingCycle === "yearly" ? findPlanPrice(usage.planName, "yearly") : findPlanPrice(usage.planName, "monthly"), { compact: true })}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              /{billingCycle === "yearly" ? "yr" : "mo"}
            </span>
          </p>
        </div>
      </div>
      {status === "past_due" && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Your last payment failed. Update your payment method in the billing portal to restore full access —
            new records are limited to the Free plan until then.
          </span>
        </div>
      )}
      {status === "trialing" && daysLeft !== null && daysLeft <= 3 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
          <Clock className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Your trial ends in {daysLeft} day{daysLeft === 1 ? "" : "s"}. Pick a plan above to keep your full catalogue live.
          </span>
        </div>
      )}
    </GlassCard>
  );
}

// Hardcoded price fallback for the current plan card — avoids an extra
// lookup of the current plan's price from the catalogue (the catalogue rows
// are available, but keeping the price inline here keeps the CurrentPlanCard
// self-contained). Synced with DEFAULT_PLANS in src/lib/plans.ts.
function findPlanPrice(_planName: string, _cycle: "monthly" | "yearly"): number {
  // The catalogue is passed in `data.plans` but we don't have it here —
  // the simplest path is to derive the price from the usage card's planName
  // and the billingCycle. We use the static DEFAULT_PLANS-equivalent values.
  // If the broker is on a custom plan not in the catalogue, returns 0 (Free).
  const PRICES: Record<string, { monthly: number; yearly: number }> = {
    free: { monthly: 0, yearly: 0 },
    basic: { monthly: 1499, yearly: 14990 },
    pro: { monthly: 3999, yearly: 39990 },
    enterprise: { monthly: 9999, yearly: 99990 },
  };
  return PRICES[_planName]?.[_cycle] ?? 0;
}

// ─── Usage card ─────────────────────────────────────────────────────────────
function UsageCard({ usage }: { usage: UsageStats }) {
  const items: { label: string; icon: React.ReactNode; current: number; limit: number }[] = [
    { label: "Clients", icon: <Users className="size-3.5" />, current: usage.clients.current, limit: usage.clients.limit },
    { label: "Suppliers", icon: <Building2 className="size-3.5" />, current: usage.suppliers.current, limit: usage.suppliers.limit },
    { label: "Purchase Orders", icon: <FileText className="size-3.5" />, current: usage.pos.current, limit: usage.pos.limit },
    { label: "Photos", icon: <ImageIcon className="size-3.5" />, current: usage.photos.current, limit: usage.photos.limit },
  ];

  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <LayoutTemplate className="size-4 text-emerald-600 dark:text-emerald-400" />
        <h3 className="text-base font-semibold text-foreground">Usage</h3>
        <span className="text-xs text-muted-foreground">
          against your <span className="font-medium text-foreground">{usage.planDisplayName}</span> plan
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {items.map((item) => {
          const isUnlimited = item.limit === -1;
          const pct = isUnlimited ? 0 : item.limit === 0 ? 100 : Math.min(100, Math.round((item.current / item.limit) * 100));
          const isAtLimit = !isUnlimited && item.current >= item.limit;
          const isNearLimit = !isUnlimited && !isAtLimit && pct >= 80;
          return (
            <div key={item.label} className="glass flex flex-col gap-2 rounded-xl border border-border/50 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  {item.icon}
                  {item.label}
                </div>
                {isAtLimit ? (
                  <Badge className="border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300">
                    At limit
                  </Badge>
                ) : isNearLimit ? (
                  <Badge className="border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300">
                    Near limit
                  </Badge>
                ) : isUnlimited ? (
                  <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                    Unlimited
                  </Badge>
                ) : null}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="kpi-num text-xl font-light text-foreground">{item.current}</span>
                <span className="text-xs text-muted-foreground">
                  / {isUnlimited ? "∞" : item.limit}
                </span>
              </div>
              {!isUnlimited && (
                <Progress
                  value={pct}
                  className={cn(
                    "h-1.5",
                    isAtLimit
                      ? "[&>[data-slot=progress-indicator]]:bg-rose-500"
                      : isNearLimit
                        ? "[&>[data-slot=progress-indicator]]:bg-amber-500"
                        : "[&>[data-slot=progress-indicator]]:bg-emerald-500",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

// ─── Billing cycle select ───────────────────────────────────────────────────
function BillingCycleSelect({
  value,
  onChange,
}: {
  value: "monthly" | "yearly";
  onChange: (v: "monthly" | "yearly") => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as "monthly" | "yearly")}>
      <SelectTrigger size="sm" className="h-8 w-32" aria-label="Billing cycle">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="monthly">Monthly</SelectItem>
        <SelectItem value="yearly">Yearly (2 months free)</SelectItem>
      </SelectContent>
    </Select>
  );
}

// ─── Loading skeleton ──────────────────────────────────────────────────────
function BillingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-8 w-40" />
      </div>
      <Skeleton className="h-32 w-full rounded-2xl" />
      <Skeleton className="h-56 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-72 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

// ─── Status tones ──────────────────────────────────────────────────────────
type StatusToneKey = "active" | "trialing" | "past_due" | "canceled" | "paused";
const STATUS_TONE: Record<StatusToneKey, { chip: string; dot: string }> = {
  active: { chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  trialing: { chip: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
  past_due: { chip: "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300", dot: "bg-rose-500" },
  canceled: { chip: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300", dot: "bg-zinc-400" },
  paused: { chip: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300", dot: "bg-teal-500" },
};
const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
  canceled: "Canceled",
  paused: "Paused",
};
