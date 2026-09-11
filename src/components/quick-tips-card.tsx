"use client";

import * as React from "react";
import {
  Sparkles, Lightbulb, X, Database, CheckCircle2, Command,
} from "lucide-react";
import { GlassCard } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// localStorage key — when "true", the Quick Tips card stays hidden on the
// dashboard until the user clears browser storage or replays onboarding.
const DISMISS_KEY = "broker-os:quick-tips-dismissed";

// Only show for first-time brokers: onboarding completed AND fewer than 3
// clients in the system. Once they've grown past 3 clients (or dismissed the
// card), it stays out of the way.
const CLIENT_THRESHOLD = 3;

type OnboardingState = {
  needsOnboarding: boolean;
  clientCount: number;
  supplierCount: number;
  hasCompletedOnboarding: boolean;
};

const TIPS: { icon: React.ReactNode; title: string; body: string }[] = [
  {
    icon: <Command className="size-4" />,
    title: "Press ⌘K to find anything",
    body: "Quickly find any client, PO, or bill from anywhere in the app.",
  },
  {
    icon: <Sparkles className="size-4" />,
    title: "Click any KPI card to drill in",
    body: "Jump straight into the filtered list — outstanding bills, eligible brokerage, open disputes.",
  },
  {
    icon: <CheckCircle2 className="size-4" />,
    title: "Check the Action Center daily",
    body: "Use the Action Center above to see what needs your attention today.",
  },
  {
    icon: <Database className="size-4" />,
    title: "Upload photos at every stage",
    body: "Booking, dispatch, disputes — photos give you a complete audit trail.",
  },
];

export function QuickTipsCard() {
  const [state, setState] = React.useState<OnboardingState | null>(null);
  const [dismissed, setDismissed] = React.useState(true); // default hidden until we read localStorage
  const [loading, setLoading] = React.useState(true);

  // Read the dismissal flag from localStorage on mount (guarded for SSR).
  React.useEffect(() => {
    try {
      const v = window.localStorage.getItem(DISMISS_KEY);
      setDismissed(v === "true");
    } catch {
      setDismissed(false);
    }
  }, []);

  // Fetch onboarding state to decide whether to show.
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/onboarding")
      .then((r) => r.json())
      .then((d: OnboardingState) => {
        if (cancelled) return;
        setState(d);
      })
      .catch(() => {
        /* non-blocking — card just stays hidden */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const shouldShow =
    !loading &&
    !dismissed &&
    state !== null &&
    state.hasCompletedOnboarding &&
    state.clientCount < CLIENT_THRESHOLD;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      /* ignore storage errors */
    }
  };

  if (!shouldShow) {
    // Reserve a tiny skeleton while we're still deciding, so the dashboard
    // layout doesn't jump once the fetch resolves.
    if (loading && !dismissed) {
      return <Skeleton className="h-24 rounded-2xl" />;
    }
    return null;
  }

  return (
    <GlassCard className="relative overflow-hidden p-5">
      {/* Subtle emerald gradient backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/8 to-transparent"
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <Lightbulb className="size-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Quick tips</h3>
            <p className="text-xs text-muted-foreground">
              New here? Here are a few shortcuts to get you moving fast.
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={dismiss}
          aria-label="Dismiss quick tips"
        >
          <X className="size-4" />
        </Button>
      </div>

      <ul className="relative mt-4 grid gap-2.5 sm:grid-cols-2">
        {TIPS.map((tip) => (
          <li
            key={tip.title}
            className="glass flex items-start gap-2.5 rounded-xl border border-border/50 p-3"
          >
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              {tip.icon}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{tip.title}</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{tip.body}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="relative mt-3 text-[11px] text-muted-foreground">
        You can replay the full onboarding anytime from{" "}
        <span className="font-medium text-foreground">Settings → Onboarding &amp; help</span>.
      </p>
    </GlassCard>
  );
}
