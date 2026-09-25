"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useUpgradeModal } from "@/lib/upgrade-store";
import { useUI } from "@/lib/ui-store";
import { useApi, api } from "@/lib/api";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { cn } from "@/lib/utils";
import { Check, Zap, Star, Building2, Users, Factory, FileText, Camera, ArrowUpRight, Sparkles } from "lucide-react";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// UpgradeModal — shown when a broker hits a plan limit (402 Payment Required).
//
// Instead of a scary red "Client limit reached" toast, this modal shows:
//   1. A friendly message ("You've reached the Free plan limit")
//   2. Three plan cards (Basic, Pro, Enterprise) with pricing + features
//   3. "Upgrade" buttons → POST /api/billing/checkout → redirect to Stripe
//   4. "Maybe later" button → close (navigate to Billing page for details)
//
// Triggered automatically by the `api()` helper when it detects HTTP 402.
// ─────────────────────────────────────────────────────────────────────────────

type PlanRow = {
  id: string;
  name: string;
  displayName: string;
  priceMonthly: number;
  maxClients: number;
  maxSuppliers: number;
  maxPOs: number;
  maxPhotos: number;
  description: string;
};

const RESOURCE_LABELS: Record<string, { singular: string; icon: React.ReactNode }> = {
  clients: { singular: "clients", icon: <Users className="size-4" /> },
  suppliers: { singular: "suppliers", icon: <Factory className="size-4" /> },
  pos: { singular: "purchase orders", icon: <FileText className="size-4" /> },
  photos: { singular: "photos", icon: <Camera className="size-4" /> },
};

const PLAN_ICONS: Record<string, React.ReactNode> = {
  basic: <Zap className="size-5" />,
  pro: <Star className="size-5" />,
  enterprise: <Building2 className="size-5" />,
};

const PLAN_HIGHLIGHTS: Record<string, { label: string; color: string }[]> = {
  basic: [
    { label: "50 clients", color: "text-emerald-600 dark:text-emerald-400" },
    { label: "50 suppliers", color: "text-emerald-600 dark:text-emerald-400" },
    { label: "200 POs", color: "text-emerald-600 dark:text-emerald-400" },
    { label: "500 photos", color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Auto brokerage", color: "text-emerald-600 dark:text-emerald-400" },
  ],
  pro: [
    { label: "Unlimited clients", color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Unlimited POs", color: "text-emerald-600 dark:text-emerald-400" },
    { label: "5,000 photos", color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Portal access", color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Advanced analytics", color: "text-emerald-600 dark:text-emerald-400" },
    { label: "GST filing reports", color: "text-emerald-600 dark:text-emerald-400" },
    { label: "P&L + Trial Balance", color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Invoice generation", color: "text-emerald-600 dark:text-emerald-400" },
  ],
  enterprise: [
    { label: "Everything unlimited", color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Multi-user seats", color: "text-emerald-600 dark:text-emerald-400" },
    { label: "API access", color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Dedicated manager", color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Custom reports", color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Priority support", color: "text-emerald-600 dark:text-emerald-400" },
  ],
};

export function UpgradeModal() {
  const { open, resource, current, limit, planName, close } = useUpgradeModal();
  const { setView } = useUI();
  const { format: fmtCurrency } = useCurrencyFormat();
  const [upgrading, setUpgrading] = React.useState<string | null>(null);

  // Fetch plans from billing status
  const { data: billingData } = useApi<{ plans: PlanRow[]; usage: { planName: string } } | null>(
    open ? "/api/billing/status" : null
  );

  const resInfo = RESOURCE_LABELS[resource] ?? RESOURCE_LABELS.clients;
  const paidPlans = billingData?.plans?.filter((p) => p.priceMonthly > 0) ?? [];

  const handleUpgrade = async (plan: PlanRow) => {
    setUpgrading(plan.id);
    try {
      const res = await api<{ url: string; mock?: boolean }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ planId: plan.id, billingCycle: "monthly" }),
      });
      if (res.mock) {
        toast.success(`Mock upgrade to ${plan.displayName} — you now have ${plan.name === "pro" || plan.name === "enterprise" ? "unlimited" : plan.maxClients} ${resource}!`);
        close();
        // Reload to pick up the new subscription
        window.location.reload();
      } else if (res.url) {
        window.location.href = res.url;
      } else {
        toast.error("Checkout failed to return a URL.");
      }
    } catch {
      toast.error("Failed to start checkout. Please try again.");
    } finally {
      setUpgrading(null);
    }
  };

  const handleLater = () => {
    close();
    setView("billing");
    toast.info("Visit Billing & Plan anytime to upgrade.");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="glass-strong max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/30">
            <Sparkles className="size-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <DialogTitle className="text-center text-xl font-semibold">
            You've reached the {planName} plan limit
          </DialogTitle>
          <DialogDescription className="text-center text-sm">
            You can add up to <strong>{limit === -1 ? "unlimited" : limit}</strong> {resInfo.singular} on the {planName} plan.
            You currently have <strong>{current}</strong>. Upgrade to add more and unlock premium features.
          </DialogDescription>
        </DialogHeader>

        {/* Plan cards */}
        <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-3">
          {paidPlans.map((plan) => {
            const highlights = PLAN_HIGHLIGHTS[plan.name] ?? [];
            const isPro = plan.name === "pro";
            const icon = PLAN_ICONS[plan.name] ?? <Zap className="size-5" />;
            const isUpgrading = upgrading === plan.id;

            return (
              <div
                key={plan.id}
                className={cn(
                  "glass relative flex flex-col rounded-2xl border p-5 transition-all hover-lift",
                  isPro
                    ? "border-emerald-500/40 ring-1 ring-emerald-500/20"
                    : "border-border/60",
                )}
              >
                {isPro && (
                  <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-emerald-600 text-white">
                    ⭐ Most Popular
                  </Badge>
                )}

                <div className="flex items-center gap-2">
                  <div className={cn(
                    "grid size-9 place-items-center rounded-xl",
                    isPro ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-primary/10 text-primary",
                  )}>
                    {icon}
                  </div>
                  <h3 className="text-sm font-bold">{plan.displayName}</h3>
                </div>

                <div className="mt-3">
                  <span className="kpi-num text-2xl font-light text-foreground">
                    ₹{plan.priceMonthly.toLocaleString("en-IN")}
                  </span>
                  <span className="text-xs text-muted-foreground">/month</span>
                </div>

                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{plan.description}</p>

                <ul className="mt-3 flex-1 space-y-1.5">
                  {highlights.map((h, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-xs">
                      <Check className={cn("size-3.5 shrink-0", h.color)} />
                      <span className="text-foreground">{h.label}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  size="sm"
                  className={cn(
                    "mt-4 w-full gap-1.5",
                    isPro
                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                      : "",
                  )}
                  variant={isPro ? "default" : "outline"}
                  disabled={isUpgrading}
                  onClick={() => handleUpgrade(plan)}
                >
                  {isUpgrading ? (
                    <>
                      <span className="animate-pulse">Upgrading…</span>
                    </>
                  ) : (
                    <>
                      <ArrowUpRight className="size-3.5" />
                      Upgrade to {plan.displayName}
                    </>
                  )}
                </Button>
              </div>
            );
          })}
        </div>

        {/* Resource-specific hint */}
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-center text-xs text-muted-foreground">
          {resInfo.icon}
          <span className="ml-1">
            Upgrading instantly increases your <strong>{resInfo.singular}</strong> limit.
            No data is lost — existing {resInfo.singular} stay as they are.
          </span>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button variant="ghost" size="sm" onClick={handleLater} className="gap-1.5">
            Maybe later — show me Billing page
          </Button>
          <p className="text-[11px] text-muted-foreground">
            🔒 Secure payment via Stripe · Cancel anytime
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
