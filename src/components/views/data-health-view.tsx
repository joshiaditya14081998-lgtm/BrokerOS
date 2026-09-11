"use client";

import * as React from "react";
import {
  AlertCircle, AlertTriangle, Info, CheckCircle2, ChevronDown, Wrench,
  HardDrive, Clock, Database, RefreshCw, Activity, Zap, ScrollText,
} from "lucide-react";
import { toast } from "sonner";
import { useApi, api } from "@/lib/api";
import { formatNumber, formatDateTime } from "@/lib/format";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible, CollapsibleTrigger, CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useUI, type ViewKey } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/use-translation";

// ─────────────────────────────────────────────────────────────────────────────
// Types — mirror the API response shape exactly.
// ─────────────────────────────────────────────────────────────────────────────
type Severity = "error" | "warning" | "info";

type IssueExample = { id: string; label: string };

type DataHealthIssue = {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  description: string;
  count: number;
  entityType: string;
  actionView: string;
  examples?: IssueExample[];
  // Auto-fix metadata (added in Task 18-a). `fixable` is true when the issue
  // can be programmatically resolved by POST /api/data-health/fix; `fixType`
  // names the corresponding fix routine.
  fixable: boolean;
  fixType: string | null;
};

type MissingField = { field: string; label: string };
type MissingRecord = { id: string; label: string; missing: MissingField[] };

type CompletenessBucket = {
  total: number;
  complete: number;
  pct: number;
  missing: MissingRecord[];
};

type DataHealthResponse = {
  summary: {
    totalEntities: number;
    lastUpdated: string | null;
    storageUsedMB: number;
  };
  issues: DataHealthIssue[];
  completeness: {
    clients: CompletenessBucket;
    suppliers: CompletenessBucket;
    pos: CompletenessBucket;
    bills: CompletenessBucket;
  };
  canFixAll: boolean;
  lastFixedAt: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Severity palette (rose / amber / teal) — no indigo/blue anywhere.
// ─────────────────────────────────────────────────────────────────────────────
const SEVERITY_STYLES: Record<
  Severity,
  {
    icon: React.ComponentType<{ className?: string }>;
    iconWrap: string;
    iconColor: string;
    badge: string;
    bar: string;
    accent: string;
    ring: string;
  }
> = {
  error: {
    icon: AlertCircle,
    iconWrap: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
    iconColor: "text-rose-600 dark:text-rose-400",
    badge: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    bar: "bg-rose-500",
    accent: "rose",
    ring: "oklch(0.65 0.22 12)",
  },
  warning: {
    icon: AlertTriangle,
    iconWrap: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    iconColor: "text-amber-600 dark:text-amber-400",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    bar: "bg-amber-500",
    accent: "amber",
    ring: "oklch(0.78 0.16 75)",
  },
  info: {
    icon: Info,
    iconWrap: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
    iconColor: "text-teal-600 dark:text-teal-400",
    badge: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
    bar: "bg-teal-500",
    accent: "teal",
    ring: "oklch(0.7 0.11 200)",
  },
};

// Health score thresholds for the ScoreRing colour.
function scoreColor(score: number): string {
  if (score > 85) return "oklch(0.7 0.15 162)"; // emerald
  if (score >= 60) return "oklch(0.78 0.16 75)"; // amber
  return "oklch(0.65 0.22 12)"; // rose
}

function scoreTone(score: number): "emerald" | "amber" | "rose" {
  if (score > 85) return "emerald";
  if (score >= 60) return "amber";
  return "rose";
}

// ─────────────────────────────────────────────────────────────────────────────
// ScoreRing — circular SVG progress (reuse the pattern from analytics).
// ─────────────────────────────────────────────────────────────────────────────
function ScoreRing({ score, size = 96 }: { score: number; size?: number }) {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = scoreColor(score);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="oklch(0.7 0.02 160 / 0.2)" strokeWidth={6} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="kpi-num text-2xl font-semibold" style={{ color }}>
          {score}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main view
// ─────────────────────────────────────────────────────────────────────────────
export function DataHealthView() {
  const { t } = useTranslation();
  const { data, loading, refresh } = useApi<DataHealthResponse>("/api/data-health");
  const { setView } = useUI();

  // Fix-all dialog state — opens the prominent "Fix all auto-fixable"
  // confirmation. The dialog body explains the impact (N issues across 5
  // categories) before the broker commits.
  const [fixAllOpen, setFixAllOpen] = React.useState(false);
  const [fixAllBusy, setFixAllBusy] = React.useState(false);

  // Single-issue fix in-flight marker — used to render the "Fixing…" label
  // on the matching IssueCard and disable its Fix button. Other cards stay
  // interactive (parallel fixes are fine, they touch disjoint tables).
  // Declared above the early-return so the rules-of-hooks are satisfied.
  const [fixingId, setFixingId] = React.useState<string | null>(null);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-full max-w-md rounded-lg" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  const { summary, issues, completeness, canFixAll, lastFixedAt } = data;

  // Health score = % of non-error checks out of all checks. Treat each issue
  // as one "check"; if there are no issues at all, score = 100.
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const totalChecks = issues.length;
  const healthScore = totalChecks === 0
    ? 100
    : Math.round(((totalChecks - errorCount) / totalChecks) * 100);

  const tone = scoreTone(healthScore);

  // Sum of fixable issue counts — shown on the "Fix all" button badge.
  const fixableTotalCount = issues
    .filter((i) => i.fixable)
    .reduce((sum, i) => sum + i.count, 0);

  const goTo = (view: string) => {
    setView(view as ViewKey);
  };

  // ── Single-issue fix ──────────────────────────────────────────────────────
  // Called by each `IssueCard`'s "Fix" button. If the issue has count > 1
  // the card itself shows a confirm (so this callback is only invoked once
  // the broker has confirmed). We always call /api/data-health/fix with
  // `entityId: null` so the fix applies to every matching record of that
  // type — that matches the "Fix all N" promise on the button.
  const runSingleFix = async (issue: DataHealthIssue) => {
    if (!issue.fixType) return;
    setFixingId(issue.id);
    try {
      const res = await api<{ fixed: number; fixType: string }>("/api/data-health/fix", {
        method: "POST",
        body: JSON.stringify({ fixType: issue.fixType, entityId: null }),
      });
      toast.success(
        `Fixed ${res.fixed} ${issue.entityType.toLowerCase()}${res.fixed === 1 ? "" : "s"}`,
        { description: res.fixed > 0 ? undefined : "No matching records to fix." },
      );
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Auto-fix failed");
    } finally {
      setFixingId(null);
    }
  };

  // ── Fix-all ───────────────────────────────────────────────────────────────
  const runFixAll = async () => {
    setFixAllBusy(true);
    try {
      const res = await api<{ totalFixed: number; results: { fixType: string; fixed: number }[] }>(
        "/api/data-health/fix-all",
        { method: "POST", body: JSON.stringify({}) },
      );
      toast.success(`Fixed ${res.totalFixed} issue${res.totalFixed === 1 ? "" : "s"} total`, {
        description: res.results
          .filter((r) => r.fixed > 0)
          .map((r) => `${r.fixType}: ${r.fixed}`)
          .join(" · ") || "No matching records to fix.",
      });
      setFixAllOpen(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fix-all failed");
    } finally {
      setFixAllBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("dataHealth.title")}
        description={t("dataHealth.subtitle")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {lastFixedAt && (
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              >
                <Wrench className="size-3" />
                {t("dataHealth.lastAutoFix")}: {formatDateTime(lastFixedAt)}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => refresh()}>
              <RefreshCw className="size-3.5" />
              <span className="hidden sm:inline">{t("dataHealth.rerunChecks")}</span>
            </Button>
          </div>
        }
      />

      {/* ─── Summary strip: 4 KPI mini-cards ─────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <GlassCard className="relative overflow-hidden p-5">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-emerald-500/0" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("dataHealth.totalEntities")}</p>
              <p className="kpi-num mt-2 text-3xl font-light text-foreground">{formatNumber(summary.totalEntities)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Across 13 tables</p>
            </div>
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Database className="size-5" />
            </div>
          </div>
        </GlassCard>

        <GlassCard className="relative overflow-hidden p-5">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-teal-500/10 to-teal-500/0" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("dataHealth.storageUsed")}</p>
              <p className="kpi-num mt-2 text-3xl font-light text-foreground">
                {summary.storageUsedMB.toFixed(2)}
                <span className="ml-1 text-base font-normal text-muted-foreground">MB</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">DB + photos on disk</p>
            </div>
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-500/15 text-teal-600 dark:text-teal-400">
              <HardDrive className="size-5" />
            </div>
          </div>
        </GlassCard>

        <GlassCard className="relative overflow-hidden p-5">
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("dataHealth.lastUpdated")}</p>
              <p className="mt-2 text-sm font-medium text-foreground">
                {summary.lastUpdated ? formatDateTime(summary.lastUpdated) : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Most recent record change</p>
            </div>
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <Clock className="size-5" />
            </div>
          </div>
        </GlassCard>

        {/* Overall Health Score with ScoreRing */}
        <GlassCard className="relative overflow-hidden p-5">
          <div
            className={cn(
              "pointer-events-none absolute inset-0 bg-gradient-to-br",
              tone === "emerald" && "from-emerald-500/10 to-emerald-500/0",
              tone === "amber" && "from-amber-500/10 to-amber-500/0",
              tone === "rose" && "from-rose-500/10 to-rose-500/0",
            )}
          />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("dataHealth.overallHealth")}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {totalChecks === 0
                  ? t("dataHealth.allClear")
                  : `${errorCount} error${errorCount === 1 ? "" : "s"} · ${totalChecks} total check${totalChecks === 1 ? "" : "s"}`}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {tone === "emerald" ? t("dataHealth.healthy") : tone === "amber" ? t("dataHealth.needsAttention") : t("dataHealth.critical")}
              </p>
            </div>
            <ScoreRing score={healthScore} />
          </div>
        </GlassCard>
      </div>

      {/* ─── Issues list ────────────────────────────────────────────────── */}
      <GlassCard className="p-5">
        <SectionHeader
          title={t("dataHealth.issues")}
          description="Detected data quality problems, grouped by severity"
          action={
            <div className="flex flex-wrap items-center gap-2">
              {canFixAll && (
                <Button
                  size="sm"
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => setFixAllOpen(true)}
                >
                  <Zap className="size-3.5" />
                  {t("dataHealth.fixAllAutoFixable")}
                  <Badge
                    variant="outline"
                    className="ml-1 border-white/30 bg-white/15 text-white"
                  >
                    {fixableTotalCount}
                  </Badge>
                </Button>
              )}
              <Badge
                variant="outline"
                className={cn(
                  "border-border/60",
                  tone === "emerald"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : tone === "amber"
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      : "bg-rose-500/10 text-rose-700 dark:text-rose-300",
                )}
              >
                <Activity className="size-3" />
                {issues.length === 0 ? t("dataHealth.allClear") : `${issues.length} issue${issues.length === 1 ? "" : "s"}`}
              </Badge>
            </div>
          }
        />

        <div className="mt-4">
          {issues.length === 0 ? (
            <EmptyState
              title={t("dataHealth.allDataHealthy")}
              hint="No compliance gaps, stuck records, or integrity issues detected. Keep it up!"
              icon={<CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />}
            />
          ) : (
            <div className="space-y-3">
              {issues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  fixing={fixingId === issue.id}
                  onNavigate={() => goTo(issue.actionView)}
                  onFix={() => runSingleFix(issue)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Audit trail note — auto-fixes are logged identically to manual
            mutations so the broker can audit them later. */}
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          <ScrollText className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Auto-fixable issues can be resolved in one click. Issues marked{" "}
            <span className="font-medium text-foreground">{t("dataHealth.manual")}</span> require a
            decision (entering a GST number, uploading a photo, recording a payment).
            All auto-fixes are logged in the{" "}
            <button
              type="button"
              className="font-medium text-emerald-600 underline-offset-2 hover:underline dark:text-emerald-400"
              onClick={() => goTo("audit")}
            >
              {t("dataHealth.auditTrail")}
            </button>
            .
          </span>
        </div>
      </GlassCard>

      {/* ─── Completeness section ───────────────────────────────────────── */}
      <GlassCard className="p-5">
        <SectionHeader
          title={t("dataHealth.completeness")}
          description="% of records with all required fields filled"
        />
        <div className="mt-4 space-y-3">
          <CompletenessRow
            label="Clients"
            requiredHint="name · phone · email · GST · address"
            bucket={completeness.clients}
          />
          <CompletenessRow
            label="Suppliers"
            requiredHint="name · phone · GST · commission rate"
            bucket={completeness.suppliers}
          />
          <CompletenessRow
            label="Purchase Orders"
            requiredHint="expected dispatch date · ≥1 dispatch · bill"
            bucket={completeness.pos}
          />
          <CompletenessRow
            label="Bills"
            requiredHint="≥1 payment · brokerage created"
            bucket={completeness.bills}
          />
        </div>
      </GlassCard>

      {/* ─── Fix-all confirmation dialog ────────────────────────────────── */}
      <AlertDialog open={fixAllOpen} onOpenChange={setFixAllOpen}>
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("dataHealth.fixAllN")} {fixableTotalCount} auto-fixable issue{fixableTotalCount === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will automatically resolve <span className="font-medium text-foreground">{fixableTotalCount}</span>{" "}
              issue{fixableTotalCount === 1 ? "" : "s"} across{" "}
              <span className="font-medium text-foreground">
                {issues.filter((i) => i.fixable).length}
              </span>{" "}
              categories: create missing brokerage, generate thumbnails, dismiss stale
              notifications, close forgotten visits, and set default commission rates.
              Every change is logged in the Audit Trail. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={fixAllBusy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={(e) => {
                e.preventDefault();
                void runFixAll();
              }}
              disabled={fixAllBusy}
            >
              {fixAllBusy ? t("dataHealth.fixing") : `${t("dataHealth.fixAllN")} ${fixableTotalCount}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// IssueCard — expandable card for one DataHealthIssue.
//
// Renders the existing "Fix now" navigation button (jumps to the relevant
// list view) plus, for `fixable` issues, an emerald "Fix" button that calls
// the auto-fix API. For non-fixable issues, a muted "Manual" badge replaces
// the Fix button so the broker knows why there's no quick fix.
// ─────────────────────────────────────────────────────────────────────────────
function IssueCard({
  issue,
  fixing,
  onNavigate,
  onFix,
}: {
  issue: DataHealthIssue;
  fixing: boolean;
  onNavigate: () => void;
  onFix: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  // Per-card confirm dialog: only shown when count > 1, so the broker has
  // to explicitly opt into fixing all N records at once.
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const styles = SEVERITY_STYLES[issue.severity];
  const Icon = styles.icon;
  const hasExamples = !!issue.examples && issue.examples.length > 0;

  const handleFixClick = () => {
    if (issue.count > 1) {
      setConfirmOpen(true);
    } else {
      onFix();
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "rounded-xl border bg-card/40 transition-colors",
          issue.severity === "error" && "border-rose-500/20",
          issue.severity === "warning" && "border-amber-500/20",
          issue.severity === "info" && "border-teal-500/20",
        )}
      >
        <div className="flex items-start gap-3 p-4">
          <div className={cn("grid size-9 shrink-0 place-items-center rounded-lg", styles.iconWrap)}>
            <Icon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn("border-border/60", styles.badge)}>
                {issue.category}
              </Badge>
              <span className="text-sm font-semibold text-foreground">{issue.title}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{issue.description}</p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  "border-border/60",
                  issue.severity === "error" && "bg-rose-500/10 text-rose-700 dark:text-rose-300",
                  issue.severity === "warning" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                  issue.severity === "info" && "bg-teal-500/10 text-teal-700 dark:text-teal-300",
                )}
              >
                {issue.count} {issue.entityType.toLowerCase()}
                {issue.count === 1 ? "" : "s"} affected
              </Badge>

              {issue.fixable ? (
                <Button
                  size="sm"
                  className="h-7 gap-1.5 bg-emerald-600 px-2.5 text-[11px] text-white hover:bg-emerald-700"
                  onClick={handleFixClick}
                  disabled={fixing}
                >
                  <Wrench className="size-3" />
                  {fixing ? t("dataHealth.fixing") : t("dataHealth.fix")}
                </Button>
              ) : (
                <Badge
                  variant="outline"
                  className="border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-400"
                >
                  {t("dataHealth.manual")}
                </Badge>
              )}

              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2.5 text-[11px]"
                onClick={onNavigate}
              >
                {t("common.view")}
              </Button>

              {hasExamples && (
                <CollapsibleTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <span>{open ? t("dataHealth.hideExamples") : t("dataHealth.showExamples")}</span>
                    <ChevronDown
                      className={cn("size-3 transition-transform", open && "rotate-180")}
                    />
                  </Button>
                </CollapsibleTrigger>
              )}
            </div>
          </div>
        </div>

        {hasExamples && (
          <CollapsibleContent>
            <div className="border-t border-border/50 bg-muted/20 px-4 py-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("dataHealth.topAffected")} {issue.entityType.toLowerCase()}s
              </p>
              <ul className="space-y-1">
                {issue.examples!.map((ex) => (
                  <li key={ex.id} className="flex items-center gap-2 text-xs text-foreground">
                    <span className={cn("size-1.5 shrink-0 rounded-full", styles.bar)} />
                    <span className="truncate font-medium">{ex.label}</span>
                  </li>
                ))}
              </ul>
              {issue.count > issue.examples!.length && (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  + {issue.count - issue.examples!.length} more — open the {issue.actionView} view to see all.
                </p>
              )}
            </div>
          </CollapsibleContent>
        )}
      </div>

      {/* Per-issue confirm — only rendered when count > 1 (handleFixClick
          routes single-count issues straight to onFix). */}
      {issue.count > 1 && (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent className="glass-strong">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("dataHealth.fixAllN")} {issue.count} {issue.entityType.toLowerCase()}{issue.count === 1 ? "" : "s"}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This will automatically resolve{" "}
                <span className="font-medium text-foreground">{issue.count}</span>{" "}
                {issue.title.toLowerCase()}. The change is logged in the Audit Trail.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={fixing}>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={(e) => {
                  e.preventDefault();
                  setConfirmOpen(false);
                  onFix();
                }}
                disabled={fixing}
              >
                {t("dataHealth.fixAllN")} {issue.count}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Collapsible>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CompletenessRow — one progress bar with an expandable missing-fields list.
// ─────────────────────────────────────────────────────────────────────────────
function CompletenessRow({
  label,
  requiredHint,
  bucket,
}: {
  label: string;
  requiredHint: string;
  bucket: CompletenessBucket;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const hasMissing = bucket.missing.length > 0;
  // Indicator colour class (overrides shadcn Progress's default `bg-primary`
  // via Tailwind v4 arbitrary variant on the indicator data-slot).
  const indicatorColor =
    bucket.pct > 85 ? "[&_[data-slot=progress-indicator]]:bg-emerald-500"
    : bucket.pct >= 60 ? "[&_[data-slot=progress-indicator]]:bg-amber-500"
    : "[&_[data-slot=progress-indicator]]:bg-rose-500";
  const textColor =
    bucket.pct > 85 ? "text-emerald-600 dark:text-emerald-400"
    : bucket.pct >= 60 ? "text-amber-600 dark:text-amber-400"
    : "text-rose-600 dark:text-rose-400";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-xl border border-border/60 bg-card/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{label}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Required: {requiredHint}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="text-right">
              <p className={cn("kpi-num text-sm font-semibold", textColor)}>
                {bucket.pct}%
              </p>
              <p className="text-[10px] text-muted-foreground">
                {bucket.complete} / {bucket.total} {t("dataHealth.complete")}
              </p>
            </div>
            {hasMissing && (
              <CollapsibleTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <span>{open ? t("dataHealth.hideExamples") : t("dataHealth.details")}</span>
                  <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
                </Button>
              </CollapsibleTrigger>
            )}
          </div>
        </div>

        <div className="mt-3">
          <Progress
            value={bucket.pct}
            className={cn("h-2 bg-muted", indicatorColor)}
          />
        </div>

        {hasMissing && (
          <CollapsibleContent>
            <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Records with missing fields ({bucket.missing.length}
                {bucket.total > 50 && bucket.missing.length === 50 ? "+" : ""})
              </p>
              <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {bucket.missing.map((rec) => (
                  <li
                    key={rec.id}
                    className="flex flex-col gap-1 rounded-lg bg-muted/30 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="truncate text-xs font-medium text-foreground">{rec.label}</span>
                    <div className="flex flex-wrap gap-1">
                      {rec.missing.map((m) => (
                        <span
                          key={m.field}
                          className="inline-flex items-center rounded-md border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-300"
                        >
                          {m.label}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  );
}
