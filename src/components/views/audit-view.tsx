"use client";

import * as React from "react";
import {
  ScrollText, Eye, User, Download, FileText, Calendar, Filter, X, Clock,
} from "lucide-react";
import { useApi } from "@/lib/api";
import { formatDateTime, titleCase } from "@/lib/format";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { usePagination } from "@/hooks/use-pagination";
import { useUrlState } from "@/hooks/use-url-state";
import { PaginationBar } from "@/components/pagination-bar";
import { SavedViewsBar } from "@/components/saved-views-bar";
import { ShareLinkButton } from "@/components/share-link-button";
import { isFilterActive } from "@/lib/saved-views";
import { useTranslation } from "@/hooks/use-translation";

type AuditLog = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  before: string | null;
  after: string | null;
  userId: string | null;
  userName: string | null;
  reason: string | null;
  createdAt: string;
};

type AuditStats = {
  total: number;
  filtered: number;
  shown: number;
  byAction: Record<string, number>;
  byEntityType: Record<string, number>;
  dateRange: { earliest: string | null; latest: string | null };
};

type AuditResponse = { logs: AuditLog[]; stats: AuditStats };

const ENTITY_TYPES = [
  "All",
  "Payment",
  "Bill",
  "Brokerage",
  "BrokeragePayout",
  "Dispute",
  "Dispatch",
  "PurchaseOrder",
  "Booking",
  "Visit",
  "Client",
  "Supplier",
];

// ── Action → tailwind chip class ─────────────────────────────────────────────
function actionTone(action: string): string {
  const a = action.toLowerCase();
  if (a === "create") return "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (a === "update") return "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300";
  if (a === "delete") return "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300";
  if (a === "force_eligible") return "border-teal-500/30 bg-teal-500/15 text-teal-700 dark:text-teal-300";
  if (a === "payout") return "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  return "border-border/60 bg-card/40 text-muted-foreground";
}

// ── Timeline dot color ────────────────────────────────────────────────────────
function actionDotClass(action: string): string {
  const a = action.toLowerCase();
  if (a === "create") return "bg-emerald-500/25 text-emerald-600 dark:text-emerald-400";
  if (a === "update") return "bg-amber-500/25 text-amber-600 dark:text-amber-400";
  if (a === "delete") return "bg-rose-500/25 text-rose-600 dark:text-rose-400";
  if (a === "force_eligible") return "bg-teal-500/25 text-teal-600 dark:text-teal-400";
  if (a === "payout") return "bg-emerald-500/25 text-emerald-600 dark:text-emerald-400";
  return "bg-zinc-500/25 text-zinc-600 dark:text-zinc-400";
}

// ── Date helpers (yyyy-mm-dd for <input type=date>) ───────────────────────────
function toInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayInputDate(): string {
  return toInputDate(new Date());
}

function daysAgoInputDate(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toInputDate(d);
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function AuditView() {
  const { t } = useTranslation();
  // URL-persisted server-side filters (Task 19-b). `entity`, `user`, `from`,
  // `to` sync to URL query params so a refresh or shared link preserves the
  // filter. The defaults ("All" / "All" / "" / "") match the existing UI
  // semantics — "All" means "no filter" for the entity/user selects; empty
  // string means "no date filter" for the date inputs.
  const [entityFilter, setEntityFilter] = useUrlState<string>("entity", "All");
  const [userFilter, setUserFilter] = useUrlState<string>("user", "All");
  const [fromDate, setFromDate] = useUrlState<string>("from", "");
  const [toDate, setToDate] = useUrlState<string>("to", "");

  // URL-persisted client-side search (applied to fetched logs).
  const [q, setQ] = useUrlState<string>("q", "");

  // View mode toggle
  const [view, setView] = React.useState<"table" | "timeline">("table");

  // Build the API path from active server filters. Empty values are omitted
  // so the API uses its own defaults.
  const apiPath = React.useMemo(() => {
    const params = new URLSearchParams();
    if (entityFilter !== "All") params.set("entityType", entityFilter);
    if (userFilter !== "All") params.set("user", userFilter);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    params.set("limit", "500");
    const qs = params.toString();
    return `/api/audit${qs ? `?${qs}` : ""}`;
  }, [entityFilter, userFilter, fromDate, toDate]);

  const { data, loading } = useApi<AuditResponse>(apiPath);

  const logs = data?.logs ?? [];
  const stats = data?.stats;

  // Distinct user names from fetched data — used to populate the user filter
  const userOptions = React.useMemo(() => {
    const set = new Set<string>();
    for (const l of logs) {
      if (l.userName) set.add(l.userName);
    }
    return Array.from(set).sort();
  }, [logs]);

  // Client-side text search across action / entityId / userName / reason
  const filtered = React.useMemo(() => {
    const term = q.toLowerCase().trim();
    if (!term) return logs;
    return logs.filter((l) =>
      l.action.toLowerCase().includes(term) ||
      l.entityId.toLowerCase().includes(term) ||
      (l.userName ?? "").toLowerCase().includes(term) ||
      (l.reason ?? "").toLowerCase().includes(term),
    );
  }, [logs, q]);

  // Apply pagination to the filtered logs (audit has many rows — default 20).
  const {
    paginated, currentPage, totalPages, size, setPage, setSize, range,
  } = usePagination<AuditLog>(filtered, 20);

  // Reset to page 1 whenever the active filters change so the user is never
  // stuck on a page that no longer exists after filtering.
  React.useEffect(() => {
    setPage(1);
  }, [q, entityFilter, userFilter, fromDate, toDate, setPage]);

  // Build the filter query string for export endpoints (CSV + PDF) — matches
  // the audit API's filter semantics.
  const exportQs = React.useMemo(() => {
    const params = new URLSearchParams();
    if (entityFilter !== "All") params.set("entityType", entityFilter);
    if (userFilter !== "All") params.set("user", userFilter);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    return params.toString();
  }, [entityFilter, userFilter, fromDate, toDate]);

  const exportCsvHref = `/api/export?type=audit${exportQs ? `&${exportQs}` : ""}`;
  const exportPdfHref = `/api/reports?type=audit-trail${exportQs ? `&${exportQs}` : ""}`;

  function applyPreset(preset: "today" | "7d" | "30d" | "all") {
    if (preset === "today") {
      setFromDate(todayInputDate());
      setToDate(todayInputDate());
    } else if (preset === "7d") {
      setFromDate(daysAgoInputDate(6));
      setToDate(todayInputDate());
    } else if (preset === "30d") {
      setFromDate(daysAgoInputDate(29));
      setToDate(todayInputDate());
    } else {
      setFromDate("");
      setToDate("");
    }
  }

  // Active filter badges (individually clearable)
  const activeFilters: { key: string; label: string; onClear: () => void }[] = [];
  if (entityFilter !== "All") {
    activeFilters.push({
      key: "entity",
      label: `${t("audit.entity")}: ${titleCase(entityFilter)}`,
      onClear: () => setEntityFilter("All"),
    });
  }
  if (userFilter !== "All") {
    activeFilters.push({
      key: "user",
      label: `${t("audit.user")}: ${userFilter}`,
      onClear: () => setUserFilter("All"),
    });
  }
  if (fromDate) {
    activeFilters.push({
      key: "from",
      label: `${t("audit.from")}: ${fromDate}`,
      onClear: () => setFromDate(""),
    });
  }
  if (toDate) {
    activeFilters.push({
      key: "to",
      label: `${t("audit.to")}: ${toDate}`,
      onClear: () => setToDate(""),
    });
  }
  if (q.trim()) {
    activeFilters.push({
      key: "q",
      label: `${t("audit.searchLabel")}: "${q.trim()}"`,
      onClear: () => setQ(""),
    });
  }

  const hasActiveFilters = activeFilters.length > 0;

  function clearAllFilters() {
    setEntityFilter("All");
    setUserFilter("All");
    setFromDate("");
    setToDate("");
    setQ("");
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("audit.title")}
        description={t("audit.subtitle")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ShareLinkButton />
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open(exportCsvHref, "_blank")}
            >
              <Download className="mr-1.5 size-4" />{t("audit.exportCsv")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open(exportPdfHref, "_blank")}
            >
              <FileText className="mr-1.5 size-4" />{t("audit.exportPdf")}
            </Button>
          </div>
        }
      />

      {/* Stats summary bar */}
      {stats ? <StatsBar stats={stats} /> : null}

      <SavedViewsBar
        view="audit"
        currentFilter={{ q, entityFilter, userFilter, fromDate, toDate }}
        isFilterActive={isFilterActive({ q, entityFilter, userFilter, fromDate, toDate })}
        onApply={(f) => {
          setQ(typeof f.q === "string" ? f.q : "");
          if (typeof f.entityFilter === "string") setEntityFilter(f.entityFilter);
          if (typeof f.userFilter === "string") setUserFilter(f.userFilter);
          if (typeof f.fromDate === "string") setFromDate(f.fromDate);
          if (typeof f.toDate === "string") setToDate(f.toDate);
        }}
      />

      {/* Filters */}
      <GlassCard className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Filter className="size-3.5" />{t("audit.filters")}
          </div>

          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="h-9 w-full sm:w-48">
              <SelectValue placeholder={t("audit.entityType")} />
            </SelectTrigger>
            <SelectContent>
              {ENTITY_TYPES.map((et) => (
                <SelectItem key={et} value={et}>
                  {et === "All" ? t("audit.allEntities") : titleCase(et)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={userFilter} onValueChange={setUserFilter}>
            <SelectTrigger className="h-9 w-full sm:w-44">
              <SelectValue placeholder={t("audit.user")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">{t("audit.allUsers")}</SelectItem>
              {userOptions.map((u) => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1.5">
            <Calendar className="size-3.5 shrink-0 text-muted-foreground" />
            <Input
              type="date"
              aria-label="From date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-9 w-[150px]"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <Input
              type="date"
              aria-label="To date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-9 w-[150px]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <PresetButton label={t("audit.today")} onClick={() => applyPreset("today")} />
            <PresetButton label={t("audit.last7Days")} onClick={() => applyPreset("7d")} />
            <PresetButton label={t("audit.last30Days")} onClick={() => applyPreset("30d")} />
            <PresetButton label={t("audit.all")} onClick={() => applyPreset("all")} />
          </div>

          <Input
            placeholder={t("audit.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 w-full sm:w-64 sm:ml-auto"
          />
        </div>

        {/* Active filter badges */}
        {hasActiveFilters ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {activeFilters.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={f.onClear}
                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300"
              >
                {f.label}
                <X className="size-3" />
              </button>
            ))}
            <button
              type="button"
              onClick={clearAllFilters}
              className="ml-1 text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {t("audit.clearAll")}
            </button>
          </div>
        ) : null}
      </GlassCard>

      {/* Log card with table/timeline toggle */}
      <GlassCard className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t("audit.changeLog")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("audit.showing")} {filtered.length} {t("audit.of")} {logs.length} {t("audit.fetchedRecords")}
              {stats ? ` · ${stats.filtered} ${t("audit.matchFilters")} · ${stats.total} ${t("audit.totalInSystem")}` : ""}.
            </p>
          </div>
          <Tabs value={view} onValueChange={(v) => setView(v as "table" | "timeline")}>
            <TabsList className="h-8">
              <TabsTrigger value="table" className="text-xs">
                <Filter className="mr-1 size-3" />{t("audit.table")}
              </TabsTrigger>
              <TabsTrigger value="timeline" className="text-xs">
                <Clock className="mr-1 size-3" />{t("audit.timeline")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {loading ? (
          <div className="mt-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title={t("audit.noAuditEntries")}
              hint={t("audit.noAuditEntriesHint")}
              icon={<ScrollText className="size-5" />}
            />
          </div>
        ) : view === "table" ? (
          <AuditTable logs={paginated} />
        ) : (
          <AuditTimeline logs={paginated} />
        )}

        {!loading && filtered.length > 0 ? (
          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            range={range}
            onPageChange={setPage}
            pageSize={size}
            onPageSizeChange={setSize}
          />
        ) : null}
      </GlassCard>
    </div>
  );
}

// ── Stats summary bar ─────────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: AuditStats }) {
  const { t } = useTranslation();
  const byAction = stats.byAction ?? {};
  const createCount = byAction["create"] ?? 0;
  const updateCount = byAction["update"] ?? 0;
  const deleteCount = byAction["delete"] ?? 0;
  const forceCount = byAction["force_eligible"] ?? 0;
  const payoutCount = byAction["payout"] ?? 0;

  const earliest = stats.dateRange?.earliest ? formatDateTime(stats.dateRange.earliest) : "—";
  const latest = stats.dateRange?.latest ? formatDateTime(stats.dateRange.latest) : "—";

  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label={t("audit.totalEntries")} value={stats.total} sub={`${t("audit.showing")} ${stats.shown}`} tone="default" />
        <StatTile label={t("audit.created")} value={createCount} sub={t("audit.newRecords")} tone="emerald" />
        <StatTile label={t("audit.updated")} value={updateCount} sub={t("audit.edits")} tone="amber" />
        <StatTile label={t("audit.deleted")} value={deleteCount} sub={t("audit.removals")} tone="rose" />
        <StatTile label={t("audit.forceEligible")} value={forceCount} sub={t("audit.overrides")} tone="teal" />
        <StatTile label={t("audit.payouts")} value={payoutCount} sub={t("audit.settled")} tone="emerald" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/40 pt-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Calendar className="size-3" />
          <span className="font-medium text-foreground/70">{t("audit.range")}:</span>
          <span>{earliest}</span>
          <span>→</span>
          <span>{latest}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <User className="size-3" />
          <span className="font-medium text-foreground/70">{t("audit.filtered")}:</span>
          <span>{stats.filtered}</span>
          <span>/</span>
          <span>{stats.total}</span>
        </span>
      </div>
    </GlassCard>
  );
}

function StatTile({
  label, value, sub, tone = "default",
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: "default" | "emerald" | "amber" | "rose" | "teal";
}) {
  const toneClass: Record<string, string> = {
    default: "text-foreground",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    rose: "text-rose-600 dark:text-rose-400",
    teal: "text-teal-600 dark:text-teal-400",
  };
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("kpi-num mt-1 text-2xl font-light", toneClass[tone])}>{value}</p>
      {sub ? <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function PresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={onClick}
      className="h-8 px-2.5 text-[11px] font-medium"
    >
      {label}
    </Button>
  );
}

// ── Table view ─────────────────────────────────────────────────────────────────

function AuditTable({ logs }: { logs: AuditLog[] }) {
  const { t } = useTranslation();
  const actionLabel = (action: string) =>
    action === "create" ? t("audit.create") :
    action === "update" ? t("audit.update") :
    action === "delete" ? t("audit.delete") :
    action === "force_eligible" ? t("audit.forceEligible") :
    action === "payout" ? t("audit.payout") :
    titleCase(action);
  return (
    <div className="mt-4 -mx-2 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-border/60">
            <TableHead className="pl-2">{t("audit.time")}</TableHead>
            <TableHead>{t("audit.user")}</TableHead>
            <TableHead>{t("audit.entity")}</TableHead>
            <TableHead>{t("audit.action")}</TableHead>
            <TableHead>{t("audit.reason")}</TableHead>
            <TableHead className="text-right pr-2">{t("audit.details")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => (
            <TableRow key={log.id} className="border-border/40">
              <TableCell className="pl-2 text-[11px] text-muted-foreground whitespace-nowrap">
                {formatDateTime(log.createdAt)}
              </TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5 text-xs text-foreground/80">
                  <User className="size-3 text-muted-foreground" />
                  {log.userName ?? t("audit.system")}
                </span>
              </TableCell>
              <TableCell className="text-xs">{titleCase(log.entityType)}</TableCell>
              <TableCell>
                <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", actionTone(log.action))}>
                  {actionLabel(log.action)}
                </span>
              </TableCell>
              <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground" title={log.reason ?? ""}>
                {log.reason ?? "—"}
              </TableCell>
              <TableCell className="pr-2 text-right">
                <DetailsButton log={log} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Timeline view ─────────────────────────────────────────────────────────────

function AuditTimeline({ logs }: { logs: AuditLog[] }) {
  const { t } = useTranslation();
  const actionLabel = (action: string) =>
    action === "create" ? t("audit.create") :
    action === "update" ? t("audit.update") :
    action === "delete" ? t("audit.delete") :
    action === "force_eligible" ? t("audit.forceEligible") :
    action === "payout" ? t("audit.payout") :
    titleCase(action);
  return (
    <div className="mt-4">
      <ol className="relative space-y-4 border-l border-border/60 pl-5">
        {logs.map((log) => (
          <li key={log.id} className="relative">
            <span
              className={cn(
                "absolute -left-[1.55rem] top-1 grid size-4 place-items-center rounded-full border-2 border-background",
                actionDotClass(log.action),
              )}
            >
              <span className="size-1.5 rounded-full bg-current opacity-90" />
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", actionTone(log.action))}>
                {actionLabel(log.action)}
              </span>
              <span className="text-sm font-medium text-foreground">{titleCase(log.entityType)}</span>
              <span className="font-mono text-[11px] text-muted-foreground">#{log.entityId.slice(-8)}</span>
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <User className="size-3" />
                {log.userName ?? t("audit.system")}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{formatDateTime(log.createdAt)}</p>
            {log.reason ? (
              <p className="mt-1 max-w-2xl rounded-md border border-border/40 bg-card/40 px-2 py-1 text-xs text-foreground/80">
                {log.reason}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Details dialog (unchanged from prior version) ────────────────────────────

function DetailsButton({ log }: { log: AuditLog }) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const hasPayload = !!(log.before || log.after);
  const actionLabel = (action: string) =>
    action === "create" ? t("audit.create") :
    action === "update" ? t("audit.update") :
    action === "delete" ? t("audit.delete") :
    action === "force_eligible" ? t("audit.forceEligible") :
    action === "payout" ? t("audit.payout") :
    titleCase(action);
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-[11px]"
        onClick={() => setOpen(true)}
        disabled={!hasPayload}
      >
        <Eye className="mr-1 size-3" />{hasPayload ? t("common.view") : "—"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="glass-strong max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", actionTone(log.action))}>
                {actionLabel(log.action)}
              </span>
              <span className="text-muted-foreground">{titleCase(log.entityType)}</span>
              <span className="font-mono text-xs text-muted-foreground">{log.entityId.slice(-8)}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">Audit log entry details: action, entity, user, time, reason, and before/after JSON payload.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("audit.user")}>{log.userName ?? t("audit.system")}</Field>
              <Field label={t("audit.time")}>{formatDateTime(log.createdAt)}</Field>
            </div>
            {log.reason && (
              <Field label={t("audit.reason")}>
                <p className="rounded-lg border border-border/60 bg-card/40 p-2">{log.reason}</p>
              </Field>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <PayloadBlock label={t("audit.before")} payload={log.before} tone="rose" />
              <PayloadBlock label={t("audit.after")} payload={log.after} tone="emerald" />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PayloadBlock({ label, payload, tone }: { label: string; payload: string | null; tone: "rose" | "emerald" }) {
  const { t } = useTranslation();
  const parsed = React.useMemo(() => {
    if (!payload) return null;
    try {
      return JSON.stringify(JSON.parse(payload), null, 2);
    } catch {
      return payload;
    }
  }, [payload]);
  const toneClass = tone === "rose"
    ? "border-rose-500/30 bg-rose-500/5"
    : "border-emerald-500/30 bg-emerald-500/5";
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className={cn("rounded-lg border p-2", toneClass)}>
        {parsed ? (
          <pre className="max-h-72 overflow-auto font-mono text-[11px] leading-relaxed text-foreground/80">{parsed}</pre>
        ) : (
          <p className="text-[11px] italic text-muted-foreground">{t("audit.noData")}</p>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-xs text-foreground/80">{children}</div>
    </div>
  );
}
