"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { statusChipClass, titleCase } from "@/lib/format";
import { useTranslation } from "@/hooks/use-translation";

// Glass card surface
export function GlassCard({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div className={cn("glass rounded-2xl", className)} {...props}>
      {children}
    </div>
  );
}

// KPI tile — large light numerals + muted label.
// When `onClick` is provided, the tile renders as a button with cursor-pointer,
// a hover-lift affordance, and a subtle chevron "drill" cue in the corner that
// fades in on hover. Used by the dashboard for drill-down navigation.
export function KpiCard({
  label,
  value,
  sub,
  icon,
  accent = "default",
  className,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  accent?: "default" | "emerald" | "amber" | "rose" | "teal";
  className?: string;
  onClick?: () => void;
}) {
  const accentRing: Record<string, string> = {
    default: "from-transparent to-transparent",
    emerald: "from-emerald-500/10 to-emerald-500/0",
    amber: "from-amber-500/10 to-amber-500/0",
    rose: "from-rose-500/10 to-rose-500/0",
    teal: "from-teal-500/10 to-teal-500/0",
  };
  const inner = (
    <>
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", accentRing[accent])} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="kpi-num mt-2 text-3xl font-light text-foreground">{value}</p>
          {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
        </div>
        {icon ? (
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            {icon}
          </div>
        ) : null}
      </div>
      {onClick ? (
        <span className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-600/0 opacity-0 transition-all duration-200 group-hover:text-emerald-600/80 group-hover:opacity-100 dark:group-hover:text-emerald-400/80">
          Drill
          <ChevronRight className="size-3" />
        </span>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group glass relative block w-full overflow-hidden rounded-2xl p-5 text-left hover-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50",
          className,
        )}
      >
        {inner}
      </button>
    );
  }

  return (
    <GlassCard className={cn("relative overflow-hidden p-5 hover-lift", className)}>
      {inner}
    </GlassCard>
  );
}

export function StatusChip({ status, className }: { status: string; className?: string }) {
  const { t } = useTranslation();
  // Translate the status label if a matching `status.<value>` key exists.
  // Falls back to `titleCase(status)` (the original behaviour) for any
  // status that doesn't have a translation key — e.g. custom string states.
  const translationKey = `status.${status}`;
  const translated = t(translationKey);
  const label = translated === translationKey ? titleCase(status) : translated;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
        statusChipClass(status),
        className
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon ? <div className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">{icon}</div> : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
