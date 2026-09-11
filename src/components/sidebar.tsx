"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import {
  LayoutDashboard, BarChart3, Users, Factory, CalendarCheck, FileText, Truck,
  Receipt, Wallet, BadgePercent, AlertTriangle, Bell, ScrollText,
  Moon, Sun, Shirt, Settings, Store, Coffee, Tag, ShieldCheck, Bookmark, LayoutTemplate,
  BookOpen, Code, CloudOff, CreditCard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useUI, type ViewKey } from "@/lib/ui-store";
import { useTranslation } from "@/hooks/use-translation";
import { useDraftPendingCount } from "@/hooks/use-offline-sync";

type NavItem = { key: ViewKey; labelKey: string; icon: React.ComponentType<{ className?: string }>; groupKey: string };

const NAV: NavItem[] = [
  { key: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, groupKey: "nav.overview" },
  { key: "analytics", labelKey: "nav.analytics", icon: BarChart3, groupKey: "nav.overview" },
  { key: "digest", labelKey: "nav.digest", icon: Coffee, groupKey: "nav.overview" },
  { key: "clients", labelKey: "nav.clients", icon: Users, groupKey: "nav.contacts" },
  { key: "suppliers", labelKey: "nav.suppliers", icon: Factory, groupKey: "nav.contacts" },
  { key: "tags", labelKey: "nav.tags", icon: Tag, groupKey: "nav.contacts" },
  { key: "visits", labelKey: "nav.visits", icon: CalendarCheck, groupKey: "nav.operations" },
  { key: "pos", labelKey: "nav.purchaseOrders", icon: FileText, groupKey: "nav.operations" },
  { key: "dispatches", labelKey: "nav.dispatches", icon: Truck, groupKey: "nav.operations" },
  { key: "draft-queue", labelKey: "nav.draftQueue", icon: CloudOff, groupKey: "nav.operations" },
  { key: "bills", labelKey: "nav.bills", icon: Receipt, groupKey: "nav.finance" },
  { key: "payments", labelKey: "nav.payments", icon: Wallet, groupKey: "nav.finance" },
  { key: "brokerage", labelKey: "nav.brokerage", icon: BadgePercent, groupKey: "nav.finance" },
  { key: "party-ledger", labelKey: "nav.partyLedger", icon: BookOpen, groupKey: "nav.finance" },
  { key: "billing", labelKey: "nav.billing", icon: CreditCard, groupKey: "nav.finance" },
  { key: "portal", labelKey: "nav.portal", icon: Store, groupKey: "nav.portals" },
  { key: "disputes", labelKey: "nav.disputes", icon: AlertTriangle, groupKey: "nav.operations" },
  { key: "notifications", labelKey: "nav.notifications", icon: Bell, groupKey: "nav.system" },
  { key: "audit", labelKey: "nav.audit", icon: ScrollText, groupKey: "nav.system" },
  { key: "data-health", labelKey: "nav.dataHealth", icon: ShieldCheck, groupKey: "nav.system" },
  { key: "saved-views", labelKey: "nav.savedViews", icon: Bookmark, groupKey: "nav.system" },
  { key: "report-builder", labelKey: "nav.reportBuilder", icon: LayoutTemplate, groupKey: "nav.system" },
  { key: "api-docs", labelKey: "nav.apiDocs", icon: Code, groupKey: "nav.system" },
  { key: "settings", labelKey: "nav.settings", icon: Settings, groupKey: "nav.system" },
];

export function Sidebar() {
  const { view, setView } = useUI();
  const { t } = useTranslation();
  const groups = React.useMemo(() => {
    const map = new Map<string, NavItem[]>();
    for (const item of NAV) {
      if (!map.has(item.groupKey)) map.set(item.groupKey, []);
      map.get(item.groupKey)!.push(item);
    }
    return Array.from(map.entries());
  }, []);

  return (
    <aside className="glass-panel flex h-full w-64 flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Shirt className="size-5" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight text-foreground">Broker OS</p>
          <p className="text-[11px] text-muted-foreground">Garment operations</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map(([groupKey, items]) => (
          <div key={groupKey} className="mb-4">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{t(groupKey)}</p>
            <div className="space-y-0.5">
              {items.map((item) => {
                const active = view === item.key;
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    onClick={() => setView(item.key)}
                    className={cn(
                      "group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0 transition-transform", active ? "text-primary" : "group-hover:scale-110")} />
                    <span className="flex-1 truncate text-left">{t(item.labelKey)}</span>
                    {item.key === "draft-queue" ? <DraftQueueBadge /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border px-3 py-3">
        <ThemeToggle />
        <SchedulerIndicator />
        <HealthIndicator />
        <div className="mt-2 flex flex-col gap-0.5 px-3 text-[10px] text-muted-foreground/70">
          <span>v1.0 · Glassmorphic build</span>
          <span className="inline-flex items-center gap-1">
            Press
            <kbd className="pointer-events-none select-none rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px] font-medium text-muted-foreground">?</kbd>
            for shortcuts
          </span>
        </div>
      </div>
    </aside>
  );
}

// DraftQueueBadge — small pill shown on the "Draft Queue" sidebar nav item
// when there are pending drafts in IndexedDB. Reads via the lightweight
// `useDraftPendingCount` hook (which polls every 30s + refreshes on
// online/offline transitions) so mounting the sidebar doesn't trigger the
// full sync loop. The pill is amber + count, mirroring the header badge.
// Hidden when count === 0 so the nav reads cleanly during normal use.
function DraftQueueBadge() {
  const { count } = useDraftPendingCount();
  if (count <= 0) return null;
  return (
    <span
      className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white ring-2 ring-background"
      aria-label={`${count} pending draft${count === 1 ? "" : "s"}`}
      title={`${count} pending draft${count === 1 ? "" : "s"} — click to open the Draft Queue`}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const isDark = theme === "dark";
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {mounted && isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      <span>{mounted ? (isDark ? t("sidebar.lightMode") : t("sidebar.darkMode")) : t("sidebar.theme")}</span>
    </Button>
  );
}

// SchedulerIndicator — small footer pill that shows whether the notification
// scheduler mini-service (port 3004) is alive. Polls /api/scheduler on mount
// and every 60 seconds. Emerald dot = running, gray dot = offline.
function SchedulerIndicator() {
  const { t } = useTranslation();
  const [running, setRunning] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/scheduler", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setRunning(false);
          return;
        }
        const data = (await res.json()) as { status?: string };
        if (!cancelled) setRunning(data?.status === "ok");
      } catch {
        if (!cancelled) setRunning(false);
      }
    };
    void check();
    const id = setInterval(() => void check(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const isRunning = running === true;
  return (
    <div
      className={cn(
        "mt-2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-medium",
        isRunning
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400",
      )}
      title={
        running === null
          ? "Checking scheduler status…"
          : isRunning
            ? "Notification scheduler running — reminders auto-generated hourly"
            : "Notification scheduler offline — reminders only generate on dashboard load"
      }
    >
      <span
        className={cn(
          "inline-block size-1.5 rounded-full",
          running === null
            ? "bg-muted-foreground/50"
            : isRunning
              ? "bg-emerald-500 animate-pulse"
              : "bg-zinc-400",
        )}
      />
      <span>
        {t("sidebar.scheduler")}:{" "}
        {running === null ? t("sidebar.schedulerChecking") : isRunning ? t("sidebar.schedulerRunning") : t("sidebar.schedulerOffline")}
      </span>
    </div>
  );
}

// HealthIndicator — small footer pill that shows the system's overall data
// health score. Fetches /api/data-health on mount + every 5 minutes. The dot
// colour mirrors the ScoreRing thresholds in the Data Health view:
//   emerald > 85 · amber 60-85 · rose < 60.
// Clicking it navigates to the Data Health view so the broker can drill in.
function HealthIndicator() {
  const { t } = useTranslation();
  const setView = useUI((s) => s.setView);
  const [score, setScore] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/data-health", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setScore(null);
          return;
        }
        const data = (await res.json()) as {
          issues?: { severity: string }[];
        };
        if (cancelled) return;
        const issues = data.issues ?? [];
        const errorCount = issues.filter((i) => i.severity === "error").length;
        const total = issues.length;
        const s = total === 0 ? 100 : Math.round(((total - errorCount) / total) * 100);
        setScore(s);
      } catch {
        if (!cancelled) setScore(null);
      }
    };
    void check();
    // Re-fetch every 5 minutes — data health is a slow-changing signal.
    const id = setInterval(() => void check(), 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const tone =
    score === null ? "muted"
    : score > 85 ? "emerald"
    : score >= 60 ? "amber"
    : "rose";

  return (
    <button
      type="button"
      onClick={() => setView("data-health")}
      className={cn(
        "mt-2 flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-medium transition-colors",
        tone === "emerald" && "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400",
        tone === "amber" && "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400",
        tone === "rose" && "bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:text-rose-400",
        tone === "muted" && "bg-zinc-500/10 text-zinc-500 hover:bg-zinc-500/20 dark:text-zinc-400",
      )}
      title={
        score === null
          ? "Checking data health…"
          : `Data health score: ${score}/100 — click to open the Data Health view`
      }
      aria-label={
        score === null
          ? "Data health: checking"
          : `Data health: ${score} percent — open Data Health view`
      }
    >
      <span
        className={cn(
          "inline-block size-1.5 rounded-full",
          tone === "emerald" && "bg-emerald-500",
          tone === "amber" && "bg-amber-500",
          tone === "rose" && "bg-rose-500 animate-pulse",
          tone === "muted" && "bg-muted-foreground/50",
        )}
      />
      <span>
        {t("sidebar.health")}:{" "}
        {score === null ? t("sidebar.healthChecking") : `${score}%`}
      </span>
    </button>
  );
}
