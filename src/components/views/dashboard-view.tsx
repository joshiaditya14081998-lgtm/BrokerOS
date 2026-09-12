"use client";

import * as React from "react";
import {
  Users, Factory, FileText, AlertTriangle, Wallet, BadgePercent,
  TrendingUp, Clock, ArrowUpRight, Calendar, Loader2, HardDrive, X,
  GripVertical, Eye, EyeOff, RotateCcw, Settings2, Check, Mail, AlertCircle,
  Lightbulb,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  DndContext, PointerSensor, KeyboardSensor, closestCenter,
  useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useApi, api } from "@/lib/api";
import { formatNumber, formatDate, formatDateShort, titleCase, statusChipClass } from "@/lib/format";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { useTranslation } from "@/hooks/use-translation";
import { useUrlState } from "@/hooks/use-url-state";
import { GlassCard, KpiCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useUI } from "@/lib/ui-store";
import { toast } from "sonner";
import { ActionCenter } from "@/components/action-center";
import { QuickTipsCard } from "@/components/quick-tips-card";
import { MobileReorderList } from "@/components/mobile-reorder-list";
import { ShareLinkButton } from "@/components/share-link-button";
import { useIsTouchDevice } from "@/hooks/use-is-touch-device";
import {
  useDashboardLayout,
  isLayoutCustomized,
  DASHBOARD_CARD_LABELS,
  type DashboardCardId,
} from "@/lib/dashboard-layout-store";
import { cn } from "@/lib/utils";

// Per-card icon for the mobile reorder list. Gives each row a small visual
// cue so the broker can scan the list quickly on a phone.
const DASHBOARD_CARD_ICONS: Record<DashboardCardId, React.ReactNode> = {
  kpiOverview: <Wallet className="size-4" />,
  secondaryKpis: <Users className="size-4" />,
  actionCenter: <AlertCircle className="size-4" />,
  earningsChart: <TrendingUp className="size-4" />,
  poStatusChart: <FileText className="size-4" />,
  volumeByClient: <Factory className="size-4" />,
  dueReminders: <Clock className="size-4" />,
  brokeragePosition: <BadgePercent className="size-4" />,
  quickTips: <Lightbulb className="size-4" />,
};

type SettingsResponse = {
  defaults: {
    autoBackupEnabled: boolean;
    lastBackupAt: string | null;
  };
};

const BACKUP_REMINDER_KEY = "broker-os:backup-reminder-dismissed";
const BACKUP_STALE_DAYS = 7;

// Dismissal is keyed by the *error count* at dismiss time, so the banner
// re-appears whenever the error count increases (e.g., dismissed at 2 errors,
// re-appears when a 3rd error appears). A count of 0 is never stored.

function backupAgeDays(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

type Range = "month" | "quarter" | "year" | "all";

type DashboardData = {
  range: Range;
  rangeStart: string | null;
  rangeEnd: string;
  outstandingIsAllTime?: boolean;
  kpis: {
    clients: number; suppliers: number; activePOs: number; openDisputes: number;
    outstandingReceivable: number; brokerageAccrued: number; brokerageScheduled: number;
    brokeragePaid: number; brokeragePending: number;
  };
  charts: {
    earningsTrend: { label: string; earned: number; paid: number }[];
    volumeByClient: { id: string; name: string; value: number }[];
    poStatus: { name: string; value: number }[];
  };
  notifications: {
    id: string; type: string; title: string; message: string | null;
    dueDate: string; status: string; entityType: string | null; entityId: string | null;
  }[];
  counts: { visits: number; bills: number; payments: number; payouts: number };
};

const PO_STATUS_COLORS: Record<string, string> = {
  open: "oklch(0.7 0.15 162)",
  partially_delivered: "oklch(0.78 0.14 85)",
  fully_delivered: "oklch(0.6 0.12 200)",
  closed: "oklch(0.55 0.02 165)",
};

const RANGE_OPTIONS: { value: Range; short: string; long: string }[] = [
  { value: "month", short: "Month", long: "This Month" },
  { value: "quarter", short: "Quarter", long: "This Quarter" },
  { value: "year", short: "Year", long: "This Year" },
  { value: "all", short: "All", long: "All Time" },
];

function earningsDescription(range: Range): string {
  switch (range) {
    case "month": return "Last 30 days (daily) — earned vs. paid out";
    case "quarter": return "This quarter (weekly) — earned vs. paid out";
    case "year": return "This year (monthly) — earned vs. paid out";
    case "all":
    default: return "Last 6 months — earned vs. paid out";
  }
}

export function DashboardView() {
  // URL-persisted date range (Task 19-b). `range` syncs to `?range=` so a
  // refresh or shared link preserves the dashboard's date scope — e.g. a
  // broker can share `/?range=month` to deep-link to “this month” KPIs.
  const [range, setRange] = useUrlState<Range>("range", "all");
  const { format: fmtCurrency } = useCurrencyFormat();
  const { t } = useTranslation();
  const { data, loading, refresh } = useApi<DashboardData>(
    `/api/dashboard?range=${range}`,
    { refreshKey: range },
  );
  const { data: settingsData } = useApi<SettingsResponse>("/api/settings");
  const { setView, openDetail, drillTo } = useUI();

  // ─────────────────────────────────────────────────────────────────────────
  // Dashboard layout store — card visibility + order, persisted to localStorage.
  // `hydrate()` runs once on mount to read the saved layout (and merge in any
  // newly-added cards at the end). Until hydration completes we render the
  // default order; since `data` is also loading at that point (useApi returns
  // null on first render), the user sees the skeleton — no flash of the
  // default order before the saved layout kicks in.
  // ─────────────────────────────────────────────────────────────────────────
  const {
    cardOrder,
    hiddenCards,
    customizeMode,
    hydrated,
    setCardOrder,
    toggleCard,
    resetLayout,
    setCustomizeMode,
    hydrate,
  } = useDashboardLayout();

  // Touch-device detection (Task 14-b). On phones/tablets, customize mode
  // uses the MobileReorderList (up/down arrows) instead of dnd-kit
  // drag-and-drop — long-press drag is awkward on a touch screen,
  // especially when the broker is on-site with one hand.
  const isTouchDevice = useIsTouchDevice();

  React.useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrated, hydrate]);

  // dnd-kit sensors. PointerSensor covers mouse + touch + pen; the 6px
  // activation constraint lets taps/clicks through without starting a drag.
  // KeyboardSensor gives keyboard users arrow-key reordering (focus the grip,
  // press Space to pick up, arrows to move, Space to drop).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = React.useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = cardOrder.indexOf(active.id as DashboardCardId);
    const newIdx = cardOrder.indexOf(over.id as DashboardCardId);
    if (oldIdx === -1 || newIdx === -1) return;
    setCardOrder(arrayMove(cardOrder, oldIdx, newIdx));
  }, [cardOrder, setCardOrder]);

  const handleReset = () => {
    resetLayout();
    toast.success("Layout reset to default");
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Backup-age reminder — dismissible via localStorage so it doesn't nag
  // after the broker has seen it. Re-appears if the last backup gets even
  // staler than when they dismissed it (so a 14-day dismissal re-appears
  // at 30 days).
  // ─────────────────────────────────────────────────────────────────────────
  const [backupReminderDismissed, setBackupReminderDismissed] = React.useState<number>(0);
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(BACKUP_REMINDER_KEY);
      if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n)) setBackupReminderDismissed(n);
      }
    } catch {
      /* localStorage unavailable — ignore */
    }
  }, []);

  const backupAge = backupAgeDays(settingsData?.defaults.lastBackupAt ?? null);
  const backupIsStale = backupAge === null || backupAge > BACKUP_STALE_DAYS;
  // Dismissal is keyed by the age at dismiss time, so the reminder re-appears
  // if the backup gets even staler (e.g., dismissed at 10d, reappears at 30d).
  // For the "never backed up" case (null), we use a large sentinel so a single
  // dismissal is sticky until a real backup happens.
  const effectiveAgeForDismiss = backupAge ?? 9999;
  const showBackupReminder =
    backupIsStale && effectiveAgeForDismiss > backupReminderDismissed;

  const dismissBackupReminder = () => {
    setBackupReminderDismissed(effectiveAgeForDismiss);
    try {
      localStorage.setItem(BACKUP_REMINDER_KEY, String(effectiveAgeForDismiss));
    } catch {
      /* localStorage unavailable — state-only dismissal still works for this session */
    }
  };

  const dismissNotif = async (id: string) => {
    await api("/api/notifications", { method: "PATCH", body: JSON.stringify({ id, status: "done" }) });
    toast.success("Notification dismissed");
    refresh();
  };

  // Fire-and-forget reminder auto-generation on mount. The POST route reads
  // the `auto_generate_notifications` setting and no-ops (returns
  // `{ generated: 0, skipped: true }`) when disabled, so this is always safe.
  // Silent (no toast); we just refresh the dashboard so any newly-generated
  // reminders appear in the "Due Reminders" panel.
  const didAutoGen = React.useRef(false);
  React.useEffect(() => {
    if (didAutoGen.current) return;
    didAutoGen.current = true;
    void api("/api/notifications/generate", { method: "POST" })
      .then(() => refresh())
      .catch(() => {
        /* silent — non-blocking background job */
      });
  }, []);

  // First-load skeleton (no data yet)
  if (!data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-full max-w-md rounded-lg" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
          <Skeleton className="h-72 rounded-2xl sm:col-span-2" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    );
  }

  const { kpis, charts, notifications } = data;
  const isAllTime = range === "all";
  const rangeSubtitle = isAllTime
    ? "Showing all-time data"
    : `Showing data from ${formatDate(data.rangeStart)} to ${formatDate(data.rangeEnd)}`;

  const visibleCards = cardOrder.filter((id) => !hiddenCards.includes(id));
  const customized = isLayoutCustomized({ cardOrder, hiddenCards });

  // Per-card content. Each SortableCard renders its content via this switch.
  // The content is built fresh from `data` on every render — no memoization
  // needed since the parent re-renders whenever `data` or `cardOrder` changes.
  const renderCard = (id: DashboardCardId): React.ReactNode => {
    switch (id) {
      case "kpiOverview":
        return (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label={t("dashboard.outstandingReceivable")}
              value={fmtCurrency(kpis.outstandingReceivable, { compact: true })}
              sub={`${kpis.clients} active clients · all-time snapshot`}
              icon={<Wallet className="size-5" />}
              accent="amber"
              onClick={() => drillTo("bills", "due")}
            />
            <KpiCard
              label={t("dashboard.brokerageEarned")}
              value={fmtCurrency(kpis.brokeragePaid + kpis.brokerageScheduled + kpis.brokerageAccrued, { compact: true })}
              sub={`${fmtCurrency(kpis.brokeragePaid, { compact: true })} paid · ${fmtCurrency(kpis.brokerageAccrued + kpis.brokerageScheduled, { compact: true })} due`}
              icon={<BadgePercent className="size-5" />}
              accent="emerald"
              onClick={() => drillTo("brokerage", "eligible")}
            />
            <KpiCard
              label={t("dashboard.pending")}
              value={fmtCurrency(kpis.brokeragePending, { compact: true })}
              sub="Awaiting full bill payment"
              icon={<Clock className="size-5" />}
              accent="rose"
              onClick={() => drillTo("brokerage", "pending")}
            />
            <KpiCard
              label={t("dashboard.activePOs")}
              value={formatNumber(kpis.activePOs)}
              sub={`${kpis.openDisputes} open disputes`}
              icon={<FileText className="size-5" />}
              accent="teal"
              onClick={() => drillTo("disputes", "open")}
            />
          </div>
        );

      case "secondaryKpis":
        return (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MiniStat icon={<Users className="size-4" />} label={t("dashboard.mini.clients")} value={kpis.clients} onClick={() => setView("clients")} />
            <MiniStat icon={<Factory className="size-4" />} label={t("dashboard.mini.suppliers")} value={kpis.suppliers} onClick={() => setView("suppliers")} />
            <MiniStat icon={<TrendingUp className="size-4" />} label={t("dashboard.mini.bills")} value={data.counts.bills} onClick={() => setView("bills")} />
            <MiniStat icon={<AlertTriangle className="size-4" />} label={t("dashboard.mini.openDisputes")} value={kpis.openDisputes} onClick={() => setView("disputes")} />
          </div>
        );

      case "actionCenter":
        return <ActionCenter />;

      case "earningsChart":
        return (
          <GlassCard className="p-5">
            <SectionHeader title={t("dashboard.earningsTrend")} description={earningsDescription(range)} />
            <div className="mt-4 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={charts.earningsTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="gEarned" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.7 0.15 162)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="oklch(0.7 0.15 162)" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gPaid" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.6 0.12 200)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="oklch(0.6 0.12 200)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.7 0.02 160 / 0.2)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 12, fill: "oklch(0.5 0.02 165)" }}
                    axisLine={false}
                    tickLine={false}
                    interval={Math.max(0, Math.floor(charts.earningsTrend.length / 8))}
                    minTickGap={4}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "oklch(0.5 0.02 165)" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtCurrency(v as number, { compact: true })} width={50} />
                  <Tooltip
                    contentStyle={{ background: "oklch(0.16 0.012 170 / 0.92)", border: "1px solid oklch(1 0 0 / 0.12)", borderRadius: 12, color: "white", backdropFilter: "blur(12px)" }}
                    formatter={(v: number) => fmtCurrency(v)}
                  />
                  <Area type="monotone" dataKey="earned" name="Earned" stroke="oklch(0.7 0.15 162)" strokeWidth={2} fill="url(#gEarned)" />
                  <Area type="monotone" dataKey="paid" name="Paid out" stroke="oklch(0.6 0.12 200)" strokeWidth={2} fill="url(#gPaid)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </GlassCard>
        );

      case "poStatusChart":
        return (
          <GlassCard className="p-5">
            <SectionHeader title={t("dashboard.poStatus")} description={isAllTime ? "All-time open vs. delivered" : `POs created in selected range`} />
            <div className="mt-4 h-64 w-full">
              {charts.poStatus.length === 0 ? (
                <EmptyState title="No POs in range" hint="Try a wider date range." icon={<FileText className="size-5" />} />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={charts.poStatus}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      onClick={(payload: { name?: string }) => {
                        if (payload && typeof payload === "object" && "name" in payload && payload.name) {
                          drillTo("pos", String(payload.name));
                        }
                      }}
                    >
                      {charts.poStatus.map((entry, i) => (
                        <Cell key={i} fill={PO_STATUS_COLORS[entry.name] ?? "oklch(0.6 0.02 165)"} stroke="none" className="cursor-pointer" />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "oklch(0.16 0.012 170 / 0.92)", border: "1px solid oklch(1 0 0 / 0.12)", borderRadius: 12, color: "white" }}
                      formatter={(v: number, n: string) => [`${v} POs`, titleCase(n)]}
                    />
                    <Legend formatter={(v) => titleCase(v)} wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </GlassCard>
        );

      case "volumeByClient":
        return (
          <GlassCard className="p-5">
            <SectionHeader title={t("dashboard.volumeByClient")} description={isAllTime ? "Final billed amount (₹) — all-time" : "Final billed amount (₹) — bills raised in range"} />
            <div className="mt-4 h-56 w-full">
              {charts.volumeByClient.length === 0 ? (
                <EmptyState title="No bills in range" hint="No bills were raised during this period." icon={<TrendingUp className="size-5" />} />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={charts.volumeByClient} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.7 0.02 160 / 0.2)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "oklch(0.5 0.02 165)" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtCurrency(v as number, { compact: true })} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "oklch(0.5 0.02 165)" }} axisLine={false} tickLine={false} width={120} />
                    <Tooltip
                      cursor={{ fill: "oklch(0.7 0.02 160 / 0.08)" }}
                      contentStyle={{ background: "oklch(0.16 0.012 170 / 0.92)", border: "1px solid oklch(1 0 0 / 0.12)", borderRadius: 12, color: "white" }}
                      formatter={(v: number) => fmtCurrency(v)}
                    />
                    <Bar
                      dataKey="value"
                      name="Volume"
                      fill="oklch(0.65 0.13 162)"
                      radius={[0, 6, 6, 0]}
                      className="cursor-pointer"
                      onClick={(payload: { id?: string }) => {
                        if (payload && typeof payload === "object" && "id" in payload && payload.id) {
                          openDetail("Client", String(payload.id));
                        }
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </GlassCard>
        );

      case "dueReminders":
        return (
          <GlassCard className="p-5">
            <SectionHeader title={t("dashboard.dueReminders")} description={`${notifications.length} pending`} action={<Button variant="ghost" size="sm" onClick={() => setView("notifications")}>{t("common.viewAll")}</Button>} />
            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
              {notifications.length === 0 ? (
                <EmptyState title="All caught up" hint="No pending reminders." icon={<Clock className="size-5" />} />
              ) : notifications.map((n) => (
                <div key={n.id} className="group rounded-xl border border-border/50 bg-card/40 p-3 transition-colors hover:bg-card/70">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{n.title}</p>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusChipClass(n.type === "brokerage_due" ? "overdue" : "pending")}`}>
                      {titleCase(n.type.replace(/_/g, " "))}
                    </span>
                  </div>
                  {n.message ? <p className="mt-1 text-xs text-muted-foreground">{n.message}</p> : null}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">Due {formatDate(n.dueDate)}</span>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] opacity-0 group-hover:opacity-100" onClick={() => dismissNotif(n.id)}>Dismiss</Button>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        );

      case "brokeragePosition":
        return (
          <GlassCard className="p-5">
            <SectionHeader title={t("dashboard.brokeragePosition")} description={isAllTime ? "Eligibility & payout status — all-time" : "Eligibility & payout status — range-filtered"} action={<Button variant="outline" size="sm" onClick={() => setView("brokerage")}>{t("dashboard.manageBrokerage")} <ArrowUpRight className="ml-1 size-3.5" /></Button>} />
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <BrokerageTile label={t("dashboard.brokerage.pending")} value={kpis.brokeragePending} hint={t("dashboard.brokerage.pendingHint")} tone="rose" />
              <BrokerageTile label={t("dashboard.brokerage.accrued")} value={kpis.brokerageAccrued} hint={t("dashboard.brokerage.accruedHint")} tone="amber" />
              <BrokerageTile label={t("dashboard.brokerage.scheduled")} value={kpis.brokerageScheduled} hint={t("dashboard.brokerage.scheduledHint")} tone="teal" />
              <BrokerageTile label={t("dashboard.brokerage.paid")} value={kpis.brokeragePaid} hint={t("dashboard.brokerage.paidHint")} tone="emerald" />
            </div>
          </GlassCard>
        );

      case "quickTips":
        return <QuickTipsCard />;

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Date range selector */}
      <div className="flex items-center gap-2">
        <ToggleGroup
          type="single"
          value={range}
          onValueChange={(v) => v && setRange(v as typeof range)}
          size="sm"
          className="glass rounded-lg border border-border/60 p-0.5"
          aria-label="Dashboard date range"
        >
          {RANGE_OPTIONS.map((opt) => (
            <ToggleGroupItem
              key={opt.value}
              value={opt.value}
              aria-label={opt.long}
              className="rounded-md px-2.5 text-xs font-medium data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-700 dark:data-[state=on]:text-emerald-300"
            >
              <span className="hidden sm:inline">{opt.long}</span>
              <span className="sm:hidden">{opt.short}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* ───────────────────────────────────────────────────────────────────
          Customize-mode body.

          On TOUCH devices (phones / tablets), we render the MobileReorderList
          instead of the dnd-kit drag-and-drop layout. Long-press drag is
          awkward on a touch screen — especially on-site with one hand — so
          the broker gets a simple up/down arrow list with big 44px tap
          targets, haptic feedback, and an inline hidden-cards recovery
          section. The card content itself isn't shown in touch customize
          mode (just labels + icons) to keep the list scannable; the broker
          taps "Done" to see the cards in their new order.

          On DESKTOP, we keep the existing dnd-kit drag-and-drop layout
          (SortableCard with grip handle + customize bar) plus the desktop
          hidden-cards recovery panel below.
          ─────────────────────────────────────────────────────────────── */}
      {customizeMode && isTouchDevice ? (
        <MobileReorderList
          items={visibleCards.map((id) => ({
            id,
            label: DASHBOARD_CARD_LABELS[id],
            icon: DASHBOARD_CARD_ICONS[id],
          }))}
          hiddenItems={hiddenCards.map((id) => ({
            id,
            label: DASHBOARD_CARD_LABELS[id],
            icon: DASHBOARD_CARD_ICONS[id],
          }))}
          onReorder={(newOrder) => setCardOrder(newOrder as DashboardCardId[])}
          onShow={(id) => toggleCard(id as DashboardCardId)}
          onHide={(id) => toggleCard(id as DashboardCardId)}
        />
      ) : (
        <>
          {/* Draggable dashboard cards (desktop customize mode + normal mode) */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={visibleCards} strategy={verticalListSortingStrategy}>
              <div className="space-y-6">
                {visibleCards.map((id) => (
                  <SortableCard
                    key={id}
                    id={id}
                    label={DASHBOARD_CARD_LABELS[id]}
                    customizeMode={customizeMode}
                  >
                    {renderCard(id)}
                  </SortableCard>
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* Hidden-cards recovery panel — desktop customize mode only.
              On touch, the MobileReorderList renders its own hidden section. */}
          {customizeMode && hiddenCards.length > 0 && (
            <GlassCard className="p-5">
              <SectionHeader
                title="Hidden cards"
                description="Click a card below to bring it back to your dashboard."
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {hiddenCards.map((id) => (
                  <Button
                    key={id}
                    variant="outline"
                    size="sm"
                    onClick={() => toggleCard(id)}
                    className="gap-1.5 border-emerald-500/30 bg-emerald-500/5 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
                    aria-label={`Show ${DASHBOARD_CARD_LABELS[id]} card`}
                  >
                    <Eye className="size-3.5" />
                    {DASHBOARD_CARD_LABELS[id]}
                  </Button>
                ))}
              </div>
            </GlassCard>
          )}

          {/* Empty-state hint when the broker has hidden everything. */}
          {customizeMode && visibleCards.length === 0 && hiddenCards.length > 0 && (
            <GlassCard className="p-8">
              <EmptyState
                title="No cards visible"
                hint="Re-add a card from the Hidden cards panel above to see your dashboard again."
                icon={<EyeOff className="size-5" />}
              />
            </GlassCard>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SortableCard — wraps a dashboard section with dnd-kit's useSortable hook.
//
// In customize mode, a thin bar appears above the card content with:
//   • a grip drag handle (the activator for dnd-kit)
//   • the card label
//   • a "Hide" button (eye-off icon) that removes the card from the layout
//
// Out of customize mode, the bar is hidden and a small floating grip appears
// at the top-right corner of the card on hover — clicking it enters customize
// mode (so the hover affordance isn't a tease). The floating grip uses
// `pointer-events-none` until hovered so it never blocks clicks on underlying
// card content (e.g. KPI tile drill-downs).
//
// While dragging, the card lifts with `scale-[1.02] shadow-xl z-10` per spec.
// ─────────────────────────────────────────────────────────────────────────────
function SortableCard({
  id,
  label,
  customizeMode,
  children,
}: {
  id: DashboardCardId;
  label: string;
  customizeMode: boolean;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const toggleCard = useDashboardLayout((s) => s.toggleCard);
  const setCustomizeMode = useDashboardLayout((s) => s.setCustomizeMode);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/sort relative",
        isDragging && "z-10 scale-[1.02] shadow-xl",
      )}
    >
      {customizeMode ? (
        <div className="mb-2 flex items-center justify-between rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/5 px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              className="grid size-6 shrink-0 cursor-grab place-items-center rounded-md text-muted-foreground transition-colors hover:bg-emerald-500/10 hover:text-emerald-600 active:cursor-grabbing dark:hover:text-emerald-400"
              aria-label={`Drag ${label} to reorder`}
            >
              <GripVertical className="size-4" />
            </button>
            <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
            onClick={() => toggleCard(id)}
            aria-label={`Hide ${label} from dashboard`}
          >
            <EyeOff className="size-3.5" />
            <span className="hidden sm:inline">Hide</span>
          </Button>
        </div>
      ) : (
        // Floating grip — visible on hover only. Clicking it enters customize
        // mode so the broker can start rearranging. pointer-events-none until
        // hovered so it never blocks underlying card interactions.
        <button
          type="button"
          onClick={() => setCustomizeMode(true)}
          aria-label="Customize dashboard layout"
          className="absolute right-2 top-2 z-20 grid size-7 cursor-pointer place-items-center rounded-md bg-background/70 text-muted-foreground opacity-0 backdrop-blur-sm transition-all hover:text-emerald-600 group-hover/sort:opacity-100 group-hover/sort:pointer-events-auto pointer-events-none dark:hover:text-emerald-400"
        >
          <GripVertical className="size-3.5" />
        </button>
      )}
      {children}
    </div>
  );
}

function MiniStat({ icon, label, value, onClick }: { icon: React.ReactNode; label: string; value: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="glass hover-lift flex items-center justify-between rounded-2xl p-4 text-left">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="kpi-num mt-1 text-2xl font-light text-foreground">{formatNumber(value)}</p>
      </div>
      <div className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">{icon}</div>
    </button>
  );
}

function BrokerageTile({ label, value, hint, tone }: { label: string; value: number; hint: string; tone: "emerald" | "amber" | "rose" | "teal" }) {
  const { format: fmtCurrency } = useCurrencyFormat();
  const toneClass: Record<string, string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/5",
    amber: "border-amber-500/30 bg-amber-500/5",
    rose: "border-rose-500/30 bg-rose-500/5",
    teal: "border-teal-500/30 bg-teal-500/5",
  };
  return (
    <div className={`rounded-xl border p-4 ${toneClass[tone]}`}>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="kpi-num mt-2 text-2xl font-light text-foreground">{fmtCurrency(value, { compact: true })}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
