"use client";

// Draft Queue view — offline-tolerant entry (plan §11).
//
// The broker frequently works on-site at supplier markets where internet is
// unreliable. The "Save as draft" buttons in the Record Booking / Record
// Dispatch / Record Payment dialogs persist the form to IndexedDB; this view
// is the management surface for those drafts. It shows:
//   - a status bar (online/offline indicator + pending count + Sync now),
//   - an offline banner when the browser reports no connectivity,
//   - a list of draft cards with type icon, summary, status badge, retry +
//     delete actions,
//   - an empty state once everything has synced.
//
// The hook (`useOfflineSync`) owns all the state: this component just renders
// off its return value + wires button clicks to its callbacks. Auto-sync is
// handled inside the hook (3-second debounce after the "online" event).

import * as React from "react";
import {
  Calendar, Truck, Wallet, CloudOff, RefreshCw, CheckCircle2,
  AlertCircle, Trash2, Loader2,
} from "lucide-react";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useTranslation } from "@/hooks/use-translation";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Draft, DraftType } from "@/lib/offline-db";

// Type → icon map for the leading glyph on each draft card.
const ICON_BY_TYPE: Record<DraftType, React.ComponentType<{ className?: string }>> = {
  booking: Calendar,
  visit: Calendar,
  dispatch: Truck,
  payment: Wallet,
};

// Type → human-readable label (kept English here for now; the queue is a
// system view and these read clearly enough even when the rest of the UI is
// in Hindi/Gujarati).
const LABEL_BY_TYPE: Record<DraftType, string> = {
  booking: "Booking",
  visit: "Visit",
  dispatch: "Dispatch",
  payment: "Payment",
};

// Status badge tones — pending=amber, syncing=teal, synced=emerald, failed=rose.
// Mirrors the design rules in the task brief.
function StatusBadge({ status, retryCount }: { status: Draft["status"]; retryCount: number }) {
  const { t } = useTranslation();
  switch (status) {
    case "pending":
      return (
        <Badge className="border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300">
          <span className="size-1.5 rounded-full bg-amber-500" />
          {t("draftQueue.pending")}
        </Badge>
      );
    case "syncing":
      return (
        <Badge className="border-teal-500/30 bg-teal-500/15 text-teal-700 dark:text-teal-300">
          <Loader2 className="size-3 animate-spin" />
          {t("draftQueue.syncing")}
        </Badge>
      );
    case "synced":
      return (
        <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-3" />
          {t("draftQueue.synced")}
        </Badge>
      );
    case "failed":
      return (
        <Badge className="border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300">
          <AlertCircle className="size-3" />
          {t("draftQueue.failed")}
          {retryCount > 0 ? ` · ${retryCount}×` : ""}
        </Badge>
      );
  }
}

/**
 * Build a one-line summary string for a draft, e.g. "Booking — Balaji
 * Textiles, 3 line items, ₹58,300". The shape depends on the draft type;
 * each branch is defensive about the (Record<string, unknown>) payload.
 */
function draftSummary(draft: Draft, fmtCurrency: (n: number, opts?: { compact?: boolean }) => string): string {
  const d = draft.data;
  switch (draft.type) {
    case "booking": {
      const supplierName = typeof d.supplierName === "string" ? d.supplierName : null;
      const items = Array.isArray(d.lineItems) ? d.lineItems : [];
      const lineCount = items.length;
      const total = items.reduce((s, it) => {
        const li = it as { setQty?: number; unitPrice?: number };
        return s + (Number(li.setQty) || 0) * (Number(li.unitPrice) || 0);
      }, 0);
      const parts = [supplierName, `${lineCount} line item${lineCount === 1 ? "" : "s"}`].filter(Boolean) as string[];
      return parts.length > 0
        ? `${parts.join(", ")} · ${fmtCurrency(total, { compact: true })}`
        : `Booking · ${fmtCurrency(total, { compact: true })}`;
    }
    case "visit": {
      const purpose = typeof d.purpose === "string" ? d.purpose : null;
      return purpose ?? "Visit draft";
    }
    case "dispatch": {
      const poNumber = typeof d.poNumber === "string" ? d.poNumber : null;
      const items = Array.isArray(d.items) ? d.items : [];
      const totalQty = items.reduce((s, it) => {
        const di = it as { qty?: number };
        return s + (Number(di.qty) || 0);
      }, 0);
      const parts = [poNumber, `${totalQty} sets`].filter(Boolean) as string[];
      return parts.length > 0 ? parts.join(" · ") : "Dispatch draft";
    }
    case "payment": {
      const amount = typeof d.amount === "number" ? d.amount : Number(d.amount) || 0;
      const mode = typeof d.mode === "string" ? d.mode : null;
      const ref = typeof d.reference === "string" && d.reference ? d.reference : null;
      const parts = [fmtCurrency(amount, { compact: true }), mode, ref].filter(Boolean) as string[];
      return parts.length > 0 ? parts.join(" · ") : fmtCurrency(amount, { compact: true });
    }
  }
}

export function DraftQueueView() {
  const { t } = useTranslation();
  const { format: fmtCurrency } = useCurrencyFormat();
  const { isOnline } = useOnlineStatus();
  const {
    pendingCount, syncing, lastSyncError,
    syncNow, drafts, retryDraft, discard,
  } = useOfflineSync();

  // Manual sync button — surfaces the result counts via a toast so the
  // broker gets immediate confirmation. The hook guards against re-entry.
  const onSyncNow = React.useCallback(async () => {
    const res = await syncNow();
    if (res.authRequired) {
      toast.error(res.error ?? "Authentication required — please log in to sync drafts");
      return;
    }
    if (res.synced > 0 && res.failed === 0) {
      toast.success(`${res.synced} draft${res.synced === 1 ? "" : "s"} synced`);
    } else if (res.synced > 0 && res.failed > 0) {
      toast.warning(`${res.synced} synced · ${res.failed} failed`);
    } else if (res.failed > 0) {
      toast.error(`${res.failed} draft${res.failed === 1 ? "" : "s"} failed to sync`);
    } else if (res.synced === 0 && res.failed === 0) {
      toast.info("No drafts to sync");
    }
  }, [syncNow]);

  // Manual retry on a single failed draft — flips it back to pending and
  // runs a focused sync pass for just that id.
  const onRetry = React.useCallback(
    async (id: string) => {
      await retryDraft(id);
      toast.info("Retrying draft…");
    },
    [retryDraft],
  );

  // Sort newest-first so the freshest drafts are at the top of the queue.
  // The hook's `drafts` array is oldest-first (createdAt asc); reverse a
  // copy for display.
  const sorted = React.useMemo(() => [...drafts].reverse(), [drafts]);

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("draftQueue.title")}
        description={t("draftQueue.subtitle")}
        action={
          isOnline && pendingCount > 0 ? (
            <Button size="sm" onClick={() => void onSyncNow()} disabled={syncing}>
              {syncing ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 size-4" />
              )}
              {syncing ? t("draftQueue.syncing") : t("draftQueue.syncNow")}
            </Button>
          ) : null
        }
      />

      {/* Status bar — online/offline dot + pending count + (optional) last error. */}
      <GlassCard className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
              isOnline
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                isOnline ? "bg-emerald-500" : "bg-amber-500 animate-pulse",
              )}
            />
            {isOnline ? t("draftQueue.online") : t("draftQueue.offline")}
          </span>
          <span className="text-sm text-muted-foreground">
            {pendingCount > 0
              ? `${pendingCount} draft${pendingCount === 1 ? "" : "s"} pending`
              : t("draftQueue.noPending")}
          </span>
        </div>
        {lastSyncError ? (
          <p className="inline-flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400">
            <AlertCircle className="size-3.5" />
            <span className="truncate">{lastSyncError}</span>
          </p>
        ) : null}
      </GlassCard>

      {/* Offline banner — only shows when the browser reports no connectivity. */}
      {!isOnline ? (
        <GlassCard className="flex items-start gap-3 border-amber-500/30 bg-amber-500/5 p-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <CloudOff className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{t("draftQueue.offlineBannerTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("draftQueue.offlineBannerBody")}</p>
          </div>
        </GlassCard>
      ) : null}

      {/* Draft list / empty / loading. The hook never surfaces a "loading"
          flag (it has no fetch step — it just reads IndexedDB), so the
          initial render with no drafts is treated as "empty / all synced"
          rather than a skeleton. We reserve the skeleton for the very first
          mount tick to avoid a flash of "no drafts" before IndexedDB has
          returned. */}
      <DraftList
        drafts={sorted}
        syncing={syncing}
        isOnline={isOnline}
        fmtCurrency={fmtCurrency}
        onRetry={onRetry}
        onDiscard={(id) => void discard(id)}
      />
    </div>
  );
}

function DraftList({
  drafts, syncing, isOnline, fmtCurrency, onRetry, onDiscard,
}: {
  drafts: Draft[];
  syncing: boolean;
  isOnline: boolean;
  fmtCurrency: (n: number, opts?: { compact?: boolean }) => string;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const { t } = useTranslation();
  // First-render placeholder: before IndexedDB has answered, `drafts` is
  // empty — we show a 3-row skeleton so the empty state doesn't flash.
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => {
    // Microtask: by the time this effect runs, the hook's mount read has
    // had a chance to populate `drafts`. We mark hydrated on the next tick
    // so the empty state shows only after the read has actually completed.
    const id = window.setTimeout(() => setHydrated(true), 200);
    return () => window.clearTimeout(id);
  }, []);

  if (!hydrated) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (drafts.length === 0) {
    return (
      <GlassCard className="p-10">
        <EmptyState
          title={t("draftQueue.empty")}
          hint={t("draftQueue.emptyHint")}
          icon={<CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />}
        />
      </GlassCard>
    );
  }

  return (
    <div className="space-y-3">
      {drafts.map((draft) => {
        const Icon = ICON_BY_TYPE[draft.type] ?? Calendar;
        const label = LABEL_BY_TYPE[draft.type] ?? "Draft";
        const summary = draftSummary(draft, fmtCurrency);
        const canRetry = draft.status === "failed" && isOnline;
        return (
          <GlassCard key={draft.id} className="p-4 hover-lift">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-foreground">
                    {label} — <span className="text-muted-foreground">{summary}</span>
                  </p>
                  <StatusBadge status={draft.status} retryCount={draft.retryCount} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("draftQueue.created")}: {formatDate(draft.createdAt)}
                </p>
                {draft.status === "failed" && draft.error ? (
                  <p className="mt-2 inline-flex items-start gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/5 px-2 py-1 text-xs text-rose-700 dark:text-rose-300">
                    <AlertCircle className="mt-0.5 size-3 shrink-0" />
                    <span className="break-all">{draft.error}</span>
                  </p>
                ) : null}
                <div className="mt-3 flex items-center gap-2">
                  {canRetry ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onRetry(draft.id)}
                      disabled={syncing}
                    >
                      <RefreshCw className={cn("mr-1.5 size-3.5", syncing && "animate-spin")} />
                      {t("draftQueue.retry")}
                    </Button>
                  ) : null}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
                      >
                        <Trash2 className="mr-1.5 size-3.5" />
                        {t("draftQueue.delete")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="glass-strong">
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("draftQueue.deleteTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("draftQueue.deleteConfirm")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-rose-600 text-white hover:bg-rose-700"
                          onClick={() => onDiscard(draft.id)}
                        >
                          {t("draftQueue.delete")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          </GlassCard>
        );
      })}
    </div>
  );
}
