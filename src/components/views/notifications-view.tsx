"use client";

import * as React from "react";
import { AnimatePresence, motion, useMotionValue, useTransform } from "framer-motion";
import {
  Bell, CalendarClock, Truck, Wallet, BadgePercent, Check, X, CalendarDays,
  RefreshCw, Info, CheckCheck, CheckSquare, Trash, ArrowLeft,
} from "lucide-react";
import { useApi, api } from "@/lib/api";
import { formatDate, titleCase, daysBetween } from "@/lib/format";
import { GlassCard, SectionHeader, StatusChip, EmptyState } from "@/components/shared";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useNotificationsSocket } from "@/hooks/use-notifications-socket";
import { useUrlState } from "@/hooks/use-url-state";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { useIsTouchDevice } from "@/hooks/use-is-touch-device";
import { ShareLinkButton } from "@/components/share-link-button";
import { useTranslation } from "@/hooks/use-translation";

const SWIPE_HINT_KEY = "gbos:swipe-hint:notifications";

type Notification = {
  id: string;
  type: string; // visit_followup | dispatch_due | payment_due | brokerage_due
  title: string;
  message: string | null;
  dueDate: string;
  entityType: string | null;
  entityId: string | null;
  status: string; // pending | done | dismissed
  createdAt: string;
};

type FilterKey = "all" | "pending" | "done" | "dismissed";

const FILTERS: { key: FilterKey; labelKey: string }[] = [
  { key: "all", labelKey: "notifications.all" },
  { key: "pending", labelKey: "notifications.pending" },
  { key: "done", labelKey: "notifications.done" },
  { key: "dismissed", labelKey: "notifications.dismissed" },
];

const TYPE_META: Record<string, { icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  visit_followup: { icon: CalendarClock, tone: "border-teal-500/30 bg-teal-500/15 text-teal-700 dark:text-teal-300" },
  dispatch_due: { icon: Truck, tone: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  payment_due: { icon: Wallet, tone: "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  brokerage_due: { icon: BadgePercent, tone: "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
};

function urgencyFor(dueDate: string): "overdue" | "soon" | "future" {
  const days = daysBetween(new Date(dueDate), new Date());
  if (days < 0) return "overdue";
  if (days <= 3) return "soon";
  return "future";
}

export function NotificationsView() {
  const { t } = useTranslation();
  const { data, loading, refresh } = useApi<{ notifications: Notification[] }>("/api/notifications");
  // URL-persisted filter state (Task 19-b). `filter` (status chip) syncs to
  // URL query params so a refresh or shared link preserves the filter.
  const [filter, setFilter] = useUrlState<FilterKey>("filter", "all");
  const [generating, setGenerating] = React.useState(false);
  const { connected, count: liveCount } = useNotificationsSocket();

  // One-time swipe-to-dismiss hint, shown only on the first visit (per
  // browser/device). Auto-dismisses after a few seconds and persists a flag
  // in localStorage so it never re-appears.
  const [swipeHintVisible, setSwipeHintVisible] = React.useState(false);
  React.useEffect(() => {
    try {
      if (localStorage.getItem(SWIPE_HINT_KEY)) return;
    } catch {
      return;
    }
    const t1 = window.setTimeout(() => setSwipeHintVisible(true), 600);
    const t2 = window.setTimeout(() => {
      setSwipeHintVisible(false);
      try { localStorage.setItem(SWIPE_HINT_KEY, "1"); } catch { /* ignore */ }
    }, 5500);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  // Bulk-select state
  const [selectMode, setSelectMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = React.useState(false);

  const all = data?.notifications ?? [];

  const filtered = all.filter((n) => (filter === "all" ? true : n.status === filter));

  // The "select all" affordance operates over the currently-filtered *pending*
  // set — bulk mark done / dismiss only meaningfully applies to pending items.
  const pendingFilteredIds = React.useMemo(
    () => filtered.filter((n) => n.status === "pending").map((n) => n.id),
    [filtered],
  );
  const allPendingSelected =
    pendingFilteredIds.length > 0 &&
    pendingFilteredIds.every((id) => selectedIds.has(id));

  const counts = {
    all: all.length,
    pending: all.filter((n) => n.status === "pending").length,
    done: all.filter((n) => n.status === "done").length,
    dismissed: all.filter((n) => n.status === "dismissed").length,
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await api<{ generated: number; skipped?: boolean; details: Record<string, number> }>(
        "/api/notifications/generate",
        { method: "POST" }
      );
      if (res.skipped) {
        toast.info("Auto-generation is disabled in Settings");
      } else if (res.generated === 0) {
        toast.info("No new reminders — everything's already tracked.");
      } else {
        const parts = Object.entries(res.details)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`);
        toast.success(`Generated ${res.generated} new reminder${res.generated === 1 ? "" : "s"}`, {
          description: parts.join(" · "),
        });
      }
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate reminders");
    } finally {
      setGenerating(false);
    }
  };

  // --- Bulk helpers -------------------------------------------------------
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allPendingSelected) {
      // Deselect only the pending-filtered ids (keep any non-pending selections).
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of pendingFilteredIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of pendingFilteredIds) next.add(id);
        return next;
      });
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const exitSelectMode = () => {
    setSelectMode(false);
    clearSelection();
  };

  const runBulk = async (action: "done" | "dismissed") => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await api<{ updated: number }>("/api/notifications/bulk", {
        method: "PATCH",
        body: JSON.stringify({ ids, action }),
      });
      toast.success(
        `${res.updated} notification${res.updated === 1 ? "" : "s"} ${action === "done" ? "marked done" : "dismissed"}`,
      );
      clearSelection();
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk update failed");
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("notifications.title")}
        description={t("notifications.subtitle")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ShareLinkButton />
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                connected
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-zinc-500/30 bg-zinc-500/10 text-zinc-500 dark:text-zinc-400"
              )}
              title={connected ? "Real-time connection established" : "Real-time connection offline"}
            >
              <span className="relative flex size-2">
                {connected && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                )}
                <span
                  className={cn(
                    "relative inline-flex size-2 rounded-full",
                    connected ? "bg-emerald-500" : "bg-zinc-400"
                  )}
                />
              </span>
              {connected ? t("notifications.live") : t("notifications.offline")}
              {connected && liveCount !== null && liveCount > 0 && (
                <span className="ml-0.5 rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                  {liveCount > 9 ? "9+" : liveCount}
                </span>
              )}
            </span>
            <Button
              size="sm"
              onClick={generate}
              disabled={generating}
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 hover:text-emerald-600 dark:text-emerald-400"
              variant="outline"
            >
              <RefreshCw className={cn("mr-1.5 size-4", generating && "animate-spin")} />
              {generating ? t("notifications.generating") : t("notifications.generateReminders")}
            </Button>
            <Button
              size="sm"
              variant={selectMode ? "default" : "outline"}
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              aria-pressed={selectMode}
              className={cn(
                !selectMode &&
                  "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 hover:text-emerald-600 dark:text-emerald-400",
              )}
            >
              <CheckSquare className="mr-1.5 size-4" />
              {selectMode ? t("notifications.exitSelect") : t("notifications.select")}
            </Button>
          </div>
        }
      />

      {/* Info note */}
      <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3.5 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <p>
          Reminders auto-generate for overdue visits, upcoming dispatches, due payments, and eligible brokerage. Click{" "}
          <span className="font-medium text-foreground">Generate reminders</span> to scan now. Use{" "}
          <span className="font-medium text-foreground">Select</span> to mark several done or dismiss them in bulk.
        </p>
      </div>

      <div className="inline-flex flex-wrap rounded-xl border border-border/60 bg-card/30 p-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              filter === f.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(f.labelKey)}
            <span className="ml-1.5 text-[10px] opacity-70">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {selectMode && (
        <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/30 px-3 py-2">
          <label
            htmlFor="notif-select-all"
            className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground"
          >
            <Checkbox
              id="notif-select-all"
              checked={allPendingSelected}
              onCheckedChange={toggleSelectAll}
              disabled={pendingFilteredIds.length === 0}
              className="data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600 text-white"
            />
            {t("notifications.selectAllPending")}
            <span className="rounded-full bg-card/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {pendingFilteredIds.length}
            </span>
          </label>
          <span className="text-[11px] text-muted-foreground">
            {selectedIds.size === 0
              ? t("notifications.tapCardToSelect")
              : `${selectedIds.size} ${t("common.selected")}`}
          </span>
        </div>
      )}

      {/* One-time swipe-to-dismiss hint tooltip */}
      <AnimatePresence>
        {swipeHintVisible && filtered.some((n) => n.status === "pending") ? (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex items-center justify-center"
            role="status"
          >
            <div className="glass flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 px-3.5 py-1.5 text-xs font-medium text-rose-600 shadow-sm dark:text-rose-300">
              <ArrowLeft className="size-3.5" />
              <span>{t("notifications.swipeHint")}</span>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : filtered.length === 0 ? (
        <GlassCard className="p-10">
          <EmptyState
            title={t("notifications.allCaughtUp")}
            hint={t("notifications.allCaughtUpHint")}
            icon={<Bell className="size-5" />}
          />
        </GlassCard>
      ) : (
        <PullToRefresh onRefresh={refresh}>
          <div className="space-y-3">
            {filtered.map((n) => (
              <NotificationCard
                key={n.id}
                notification={n}
                onDone={refresh}
                selectMode={selectMode}
                selected={selectedIds.has(n.id)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        </PullToRefresh>
      )}

      <BulkActionBar selectedCount={selectedIds.size} onClear={clearSelection}>
        <Button
          size="sm"
          onClick={() => runBulk("done")}
          disabled={bulkBusy}
          className="h-8 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          <CheckCheck className="mr-1.5 size-3.5" />
          {t("notifications.markDone")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => runBulk("dismissed")}
          disabled={bulkBusy}
          className="h-8 border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 hover:text-amber-700 dark:text-amber-300"
        >
          <X className="mr-1.5 size-3.5" />
          {t("notifications.dismiss")}
        </Button>
      </BulkActionBar>
    </div>
  );
}

function NotificationCard({
  notification,
  onDone,
  selectMode,
  selected,
  onToggleSelect,
}: {
  notification: Notification;
  onDone: () => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const meta = TYPE_META[notification.type] ?? { icon: Bell, tone: "border-border/60 bg-card/40 text-muted-foreground" };
  const Icon = meta.icon;
  const urgency = urgencyFor(notification.dueDate);
  const days = daysBetween(new Date(notification.dueDate), new Date());

  const urgencyChip: Record<string, string> = {
    overdue: "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300",
    soon: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300",
    future: "border-teal-500/30 bg-teal-500/15 text-teal-700 dark:text-teal-300",
  };

  const typeLabelKey =
    notification.type === "visit_followup" ? "notifications.visitFollowup" :
    notification.type === "dispatch_due" ? "notifications.dispatchDue" :
    notification.type === "payment_due" ? "notifications.paymentDue" :
    notification.type === "brokerage_due" ? "notifications.brokerageDue" :
    null;

  const urgencyLabel =
    urgency === "overdue"
      ? `${t("notifications.overdueBy")} ${Math.abs(days)}d`
      : days === 0
      ? t("notifications.dueToday")
      : days > 0
      ? `${t("notifications.dueIn")} ${days}d`
      : `${t("notifications.dueIn")} ${Math.abs(days)}d`;

  const [busy, setBusy] = React.useState(false);
  const isPending = notification.status === "pending";

  const patch = async (status: "done" | "dismissed") => {
    setBusy(true);
    try {
      await api("/api/notifications", {
        method: "PATCH",
        body: JSON.stringify({ id: notification.id, status }),
      });
      toast.success(status === "done" ? "Marked done" : "Dismissed");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  // --- Swipe-to-dismiss (touch-only, pending + non-select-mode) -----------
  // The card can be dragged left to reveal a rose "Dismiss" background. If
  // the drag crosses -100px, we trigger the dismiss flow: animate the card
  // out (height collapse via AnimatePresence exit), then call the API. The
  // explicit Dismiss button above stays for non-touch users.
  const isTouch = useIsTouchDevice();
  const swipeable = isTouch && isPending && !selectMode;
  const [dismissing, setDismissing] = React.useState(false);
  const dragX = useMotionValue(0);
  // Background opacity fades in as the card is dragged left, hitting full
  // opacity around -100px.
  const dismissBgOpacity = useTransform(dragX, [-100, -10], [1, 0]);

  const handleSwipeDismiss = async () => {
    if (dismissing || busy) return;
    setDismissing(true);
    // Wait for the AnimatePresence exit animation to play before calling
    // the API — keeps the swipe gesture feeling responsive.
    await new Promise((r) => setTimeout(r, 250));
    await patch("dismissed");
    // If the card is still mounted after refresh (e.g. filter="all" shows
    // dismissed notifications), reset dismissing so it re-renders as the
    // dimmed dismissed state instead of staying hidden.
    setDismissing(false);
  };

  // The checkbox must not bubble up to the card (or any future card-level
  // click handler that toggles expand/collapse). Stop propagation explicitly.
  const handleCheckboxClick = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
  };

  const card = (
    <GlassCard
      className={cn(
        "p-4 sm:p-5 transition-opacity",
        !isPending && "opacity-70",
        selectMode && selected && "ring-2 ring-emerald-500/40",
      )}
    >
      <div className="flex items-start gap-3">
        {selectMode && (
          <div
            className="flex shrink-0 items-center pt-0.5"
            onClick={handleCheckboxClick}
            onPointerDown={handleCheckboxClick}
          >
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggleSelect(notification.id)}
              aria-label={`Select notification: ${notification.title}`}
              className="data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600 text-white"
            />
          </div>
        )}
        <div className={cn("grid size-10 shrink-0 place-items-center rounded-xl border", meta.tone)}>
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{notification.title}</p>
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium", meta.tone)}>
              {typeLabelKey ? t(typeLabelKey) : titleCase(notification.type.replace(/_/g, " "))}
            </span>
            <StatusChip status={notification.status} />
          </div>
          {notification.message ? (
            <p className="mt-1 text-sm text-muted-foreground">{notification.message}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3" />
              {t("notifications.due")} {formatDate(notification.dueDate)}
            </span>
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium", urgencyChip[urgency])}>
              {urgencyLabel}
            </span>
          </div>
        </div>

        {/* Per-card actions are hidden in select mode to avoid redundancy
            with the floating bulk-action bar. */}
        {isPending && !selectMode && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-emerald-500/30 text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
              onClick={() => patch("done")}
              disabled={busy}
            >
              <Check className="mr-1 size-3.5" />{t("common.done")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-muted-foreground hover:text-rose-500"
              onClick={() => patch("dismissed")}
              disabled={busy}
            >
              <X className="mr-1 size-3.5" />{t("notifications.dismiss")}
            </Button>
          </div>
        )}
      </div>
    </GlassCard>
  );

  // Non-swipeable case: render the plain card as before. (Select mode or
  // already-resolved notifications have no swipe gesture.)
  if (!swipeable) return card;

  // Swipeable case: wrap the card in a draggable motion.div with a rose
  // dismiss background. AnimatePresence collapses the row on dismiss.
  return (
    <AnimatePresence initial={false}>
      {!dismissing ? (
        <motion.div
          key={notification.id}
          className="relative overflow-hidden"
          exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          {/* Rose "Dismiss" background — fades in as the card is swiped left */}
          <motion.div
            className="pointer-events-none absolute inset-0 flex items-center justify-end rounded-2xl bg-rose-500/20 px-5"
            style={{ opacity: dismissBgOpacity }}
            aria-hidden
          >
            <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-300">
              <Trash className="size-4" />
              <span className="text-xs font-semibold uppercase tracking-wide">{t("notifications.dismiss")}</span>
            </div>
          </motion.div>

          {/* Draggable card — constrained to left-only, slight elastic */}
          <motion.div
            drag="x"
            dragConstraints={{ left: -150, right: 0 }}
            dragElastic={0.1}
            style={{ x: dragX }}
            onDragEnd={(_e, info) => {
              if (info.offset.x < -100 && !dismissing && !busy) {
                void handleSwipeDismiss();
              }
            }}
          >
            {card}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
