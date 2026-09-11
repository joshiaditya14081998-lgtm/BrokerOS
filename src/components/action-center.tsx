"use client";

import * as React from "react";
import {
  CalendarClock,
  Truck,
  Wallet,
  BadgePercent,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { useApi } from "@/lib/api";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUI, type ViewKey } from "@/lib/ui-store";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Action Center — consolidated pending broker actions on the dashboard.
//
// Fetches /api/action-center on mount and renders a glass card with:
//   • summary strip (3 priority dots + total)
//   • scrollable list of prioritised action rows (max 15)
//   • empty state when nothing is pending
//   • 5-row skeleton while loading
// Each row's action button navigates to the relevant view via useUI().setView,
// except visit actions which open the Visit detail sheet via openDetail.
// ─────────────────────────────────────────────────────────────────────────────

type Priority = "urgent" | "high" | "normal";

type ActionType =
  | "visit_followup"
  | "dispatch_due"
  | "payment_due"
  | "brokerage_payout"
  | "dispute_resolve";

type Action = {
  id: string;
  type: ActionType;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string;
  entityType: string;
  entityId: string | null;
  actionLabel: string;
  actionView: string;
};

type ActionCenterData = {
  actions: Action[];
  summary: { total: number; urgent: number; high: number; normal: number };
};

// Priority → dot + text colours. Urgent=rose, High=amber, Normal=teal.
const PRIORITY_DOT: Record<Priority, string> = {
  urgent: "bg-rose-500",
  high: "bg-amber-500",
  normal: "bg-teal-500",
};
const PRIORITY_TINT: Record<Priority, string> = {
  urgent: "text-rose-600 dark:text-rose-400",
  high: "text-amber-600 dark:text-amber-400",
  normal: "text-teal-600 dark:text-teal-400",
};
const PRIORITY_TILE: Record<Priority, string> = {
  urgent: "bg-rose-500/10",
  high: "bg-amber-500/10",
  normal: "bg-teal-500/10",
};

// Action type → lucide icon. Tinted by priority at render time.
const TYPE_ICON: Record<ActionType, React.ComponentType<{ className?: string }>> = {
  visit_followup: CalendarClock,
  dispatch_due: Truck,
  payment_due: Wallet,
  brokerage_payout: BadgePercent,
  dispute_resolve: AlertTriangle,
};

export function ActionCenter() {
  const { data, loading, refresh } = useApi<ActionCenterData>("/api/action-center");
  const { setView, openDetail } = useUI();

  const handleAction = (a: Action) => {
    // Visit rows open the Visit detail sheet so the broker can act in-context.
    if (a.type === "visit_followup" && a.entityId) {
      openDetail("Visit", a.entityId);
      return;
    }
    setView(a.actionView as ViewKey);
  };

  const summary = data?.summary ?? { total: 0, urgent: 0, high: 0, normal: 0 };
  const showSkeleton = loading && !data;
  const showEmpty = !showSkeleton && (!data || data.actions.length === 0);

  return (
    <GlassCard className="p-5">
      <SectionHeader
        title="Action Center"
        description="Pending items requiring your attention"
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refresh()}
            disabled={loading}
            aria-label="Refresh action center"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        }
      />

      {/* Summary strip — 3 priority dots + total */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <SummaryDot dotClass="bg-rose-500" label="Urgent" count={summary.urgent} />
        <SummaryDot dotClass="bg-amber-500" label="High" count={summary.high} />
        <SummaryDot dotClass="bg-teal-500" label="Normal" count={summary.normal} />
        <div className="ml-auto text-muted-foreground">
          <span className="kpi-num text-sm font-semibold text-foreground">
            {summary.total}
          </span>{" "}
          total
        </div>
      </div>

      {/* Scrollable list — max-h-96, custom scrollbar via globals.css */}
      <div className="mt-4 max-h-96 space-y-2 overflow-y-auto pr-1">
        {showSkeleton ? (
          <LoadingSkeleton />
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <div className="grid size-12 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                All caught up — no pending actions.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Visit follow-ups, dispatches, payments, brokerage and disputes are all current.
              </p>
            </div>
          </div>
        ) : (
          data!.actions.map((a) => (
            <ActionRow key={a.id} action={a} onAction={() => handleAction(a)} />
          ))
        )}
      </div>
    </GlassCard>
  );
}

function SummaryDot({
  dotClass,
  label,
  count,
}: {
  dotClass: string;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-full", dotClass)} aria-hidden />
      <span className="text-muted-foreground">{label}</span>
      <span className="kpi-num font-semibold text-foreground">{count}</span>
    </div>
  );
}

function ActionRow({ action, onAction }: { action: Action; onAction: () => void }) {
  const Icon = TYPE_ICON[action.type];
  const isOverdue = new Date(action.dueDate) < new Date();

  return (
    <div className="hover-lift group flex items-center gap-3 rounded-xl border border-border/50 bg-card/40 p-3 transition-colors hover:bg-card/70">
      {/* Left: priority dot + type icon (tinted by priority) */}
      <div className="flex flex-col items-center gap-1.5">
        <span
          className={cn("size-2.5 rounded-full", PRIORITY_DOT[action.priority])}
          aria-label={`Priority: ${action.priority}`}
        />
      </div>
      <div
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          PRIORITY_TILE[action.priority],
          PRIORITY_TINT[action.priority],
        )}
      >
        <Icon className="size-4" />
      </div>

      {/* Middle: title + description + due date */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{action.title}</p>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {action.description}
        </p>
        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          {isOverdue ? (
            <AlertCircle className="size-3 text-rose-500" aria-hidden />
          ) : null}
          <span className={cn(isOverdue && "text-rose-600 dark:text-rose-400")}>
            {isOverdue ? "Overdue · " : "Due "}
            {formatDate(action.dueDate)}
          </span>
        </div>
      </div>

      {/* Right: action button (emerald accent) */}
      <Button
        size="sm"
        variant="outline"
        onClick={onAction}
        className="shrink-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 hover:text-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
      >
        <span className="hidden sm:inline">{action.actionLabel}</span>
        <span className="sm:hidden">
          <ChevronRight className="size-3.5" />
        </span>
        <ChevronRight className="hidden size-3.5 sm:inline" />
      </Button>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/40 p-3"
        >
          <Skeleton className="size-2.5 rounded-full" />
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
          <Skeleton className="h-7 w-28 rounded-md" />
        </div>
      ))}
    </div>
  );
}
