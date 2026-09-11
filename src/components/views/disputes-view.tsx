"use client";

import * as React from "react";
import {
  AlertTriangle, Plus, Package, RotateCcw, MoreHorizontal, Trash2, Check, X,
  ChevronDown, ImageIcon, Filter, CheckSquare, CheckCheck, Ban,
} from "lucide-react";
import { useApi, api } from "@/lib/api";
import { formatCurrency, formatDate, titleCase } from "@/lib/format";
import { GlassCard, SectionHeader, StatusChip, EmptyState } from "@/components/shared";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Collapsible, CollapsibleTrigger, CollapsibleContent,
} from "@/components/ui/collapsible";
import { PhotoUpload } from "@/components/photo-upload";
import { useUI } from "@/lib/ui-store";
import { useUrlState } from "@/hooks/use-url-state";
import { useTranslation } from "@/hooks/use-translation";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { SavedViewsBar } from "@/components/saved-views-bar";
import { ShareLinkButton } from "@/components/share-link-button";
import { isFilterActive } from "@/lib/saved-views";

type Dispute = {
  id: string;
  poId: string;
  dispatchId: string | null;
  type: "short_shipment" | "defective_return" | "other";
  description: string | null;
  quantityAffected: number;
  valueAffected: number;
  status: "open" | "resolved" | "rejected";
  resolution: string | null;
  createdAt: string;
  po: { poNumber: string; client: { name: string }; supplier: { name: string } };
  dispatch: { id: string; dispatchDate: string } | null;
  photos: unknown[];
};

type PO = { id: string; poNumber: string; client: { name: string }; supplier: { name: string } };
type Dispatch = { id: string; poId: string; po: { poNumber: string }; dispatchDate: string };

const TYPE_TONE: Record<Dispute["type"], string> = {
  short_shipment: "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300",
  defective_return: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  other: "border-teal-500/30 bg-teal-500/15 text-teal-700 dark:text-teal-300",
};

const TYPE_ICON: Record<Dispute["type"], React.ComponentType<{ className?: string }>> = {
  short_shipment: Package,
  defective_return: RotateCcw,
  other: MoreHorizontal,
};

const TYPE_LABEL: Record<Dispute["type"], string> = {
  short_shipment: "Short shipment",
  defective_return: "Defective return",
  other: "Other",
};

type FilterKey = "all" | "open" | "resolved" | "rejected";

const FILTERS: { key: FilterKey; labelKey: string }[] = [
  { key: "all", labelKey: "common.all" },
  { key: "open", labelKey: "status.open" },
  { key: "resolved", labelKey: "status.resolved" },
  { key: "rejected", labelKey: "status.rejected" },
];

export function DisputesView() {
  const { t } = useTranslation();
  const { data, loading, refresh } = useApi<{ disputes: Dispute[] }>("/api/disputes");
  // URL-persisted filter state (Task 19-b). `filter` (status chip) and `q`
  // (search) sync to URL query params so a refresh or shared link preserves
  // the filter. FilterKey is a string-literal union, which extends the
  // Primitive `string` constraint on useUrlState's generic.
  const [filter, setFilter] = useUrlState<FilterKey>("filter", "all");
  const [q, setQ] = useUrlState<string>("q", "");
  const [open, setOpen] = React.useState(false);
  const { drillFilter, clearDrill } = useUI();

  // Bulk-select state
  const [selectMode, setSelectMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [resolveAllOpen, setResolveAllOpen] = React.useState(false);
  const [rejectAllOpen, setRejectAllOpen] = React.useState(false);
  const [bulkResolution, setBulkResolution] = React.useState("");

  // Consume drill-down preset from the dashboard "Active POs / Disputes" KPI —
  // preset "open" selects the existing Open filter chip. The chip highlight +
  // the Filtered badge below both surface the active filter to the user.
  // Because `setFilter` is now backed by useUrlState, the drill-down also
  // syncs to the URL — so a refresh after a drill-down preserves the filter
  // via `?filter=open`. The URL on mount takes precedence for the initial
  // state; this drill effect only fires when a new drillFilter arrives
  // after mount.
  const consumedDrill = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!drillFilter) return;
    const key = `${drillFilter.view}:${drillFilter.preset}`;
    if (consumedDrill.current === key) return;
    if (drillFilter.view === "disputes" && drillFilter.preset === "open") {
      setFilter("open");
      consumedDrill.current = key;
      clearDrill();
    }
  }, [drillFilter, clearDrill, setFilter]);

  const disputes = data?.disputes ?? [];

  const filtered = disputes.filter((d) => {
    if (filter !== "all" && d.status !== filter) return false;
    const term = q.toLowerCase().trim();
    if (!term) return true;
    return (
      d.po.poNumber.toLowerCase().includes(term) ||
      d.po.client.name.toLowerCase().includes(term) ||
      d.po.supplier.name.toLowerCase().includes(term) ||
      (d.description ?? "").toLowerCase().includes(term) ||
      TYPE_LABEL[d.type].toLowerCase().includes(term)
    );
  });

  // Select-all operates over the currently-filtered OPEN disputes (the only
  // status where bulk resolve/reject meaningfully applies).
  const openFilteredIds = React.useMemo(
    () => filtered.filter((d) => d.status === "open").map((d) => d.id),
    [filtered],
  );
  const allOpenSelected =
    openFilteredIds.length > 0 &&
    openFilteredIds.every((id) => selectedIds.has(id));

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
    if (allOpenSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of openFilteredIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of openFilteredIds) next.add(id);
        return next;
      });
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const exitSelectMode = () => {
    setSelectMode(false);
    clearSelection();
  };

  const runBulkResolve = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await api<{ updated: number }>("/api/disputes/bulk", {
        method: "PATCH",
        body: JSON.stringify({
          ids,
          action: "resolve",
          resolution: bulkResolution.trim() || "Bulk resolved.",
        }),
      });
      toast.success(
        `${res.updated} dispute${res.updated === 1 ? "" : "s"} resolved`,
        { description: bulkResolution.trim() || undefined },
      );
      setBulkResolution("");
      setResolveAllOpen(false);
      clearSelection();
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk resolve failed");
    } finally {
      setBulkBusy(false);
    }
  };

  const runBulkReject = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await api<{ updated: number }>("/api/disputes/bulk", {
        method: "PATCH",
        body: JSON.stringify({ ids, action: "reject" }),
      });
      toast.success(
        `${res.updated} dispute${res.updated === 1 ? "" : "s"} rejected`,
      );
      setRejectAllOpen(false);
      clearSelection();
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk reject failed");
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("disputes.title")}
        description={t("disputes.subtitle")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ShareLinkButton />
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
              {selectMode ? t("disputes.exitSelect") : t("disputes.select")}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="mr-1.5 size-4" />{t("disputes.logDispute")}</Button>
              </DialogTrigger>
              <LogDisputeDialog onDone={() => { setOpen(false); refresh(); }} />
            </Dialog>
          </div>
        }
      />

      <SavedViewsBar
        view="disputes"
        currentFilter={{ q, filter }}
        isFilterActive={isFilterActive({ q, filter })}
        onApply={(f) => {
          setQ(typeof f.q === "string" ? f.q : "");
          if (typeof f.filter === "string") setFilter(f.filter as FilterKey);
        }}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-xl border border-border/60 bg-card/30 p-1">
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
              <span className="ml-1.5 text-[10px] opacity-70">
                {f.key === "all" ? disputes.length : disputes.filter((d) => d.status === f.key).length}
              </span>
            </button>
          ))}
        </div>
        <Input
          placeholder={t("disputes.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-9 sm:w-64"
        />
      </div>

      {filter !== "all" && (
        <div className="-mt-1">
          <Badge
            variant="outline"
            className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          >
            <Filter className="mr-1 size-3" />
            {t("audit.filtered")}:{" "}
            {filter === "open" ? t("disputes.openOnly") : filter === "resolved" ? t("disputes.resolvedOnly") : t("disputes.rejectedOnly")}
            <button
              type="button"
              onClick={() => setFilter("all")}
              aria-label="Clear dispute filter"
              className="ml-1 inline-flex size-3.5 items-center justify-center rounded-full hover:bg-emerald-500/20"
            >
              <X className="size-3" />
            </button>
          </Badge>
        </div>
      )}

      {selectMode && (
        <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/30 px-3 py-2">
          <label
            htmlFor="dispute-select-all"
            className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground"
          >
            <Checkbox
              id="dispute-select-all"
              checked={allOpenSelected}
              onCheckedChange={toggleSelectAll}
              disabled={openFilteredIds.length === 0}
              className="data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600 text-white"
            />
            {t("disputes.selectAllOpen")}
            <span className="rounded-full bg-card/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {openFilteredIds.length}
            </span>
          </label>
          <span className="text-[11px] text-muted-foreground">
            {selectedIds.size === 0
              ? t("disputes.tapCardToSelect")
              : `${selectedIds.size} ${t("common.selected")}`}
          </span>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      ) : filtered.length === 0 ? (
        <GlassCard className="p-8">
          <EmptyState
            title={t("disputes.noDisputes")}
            hint={t("disputes.noDisputesHint")}
            icon={<AlertTriangle className="size-5" />}
          />
        </GlassCard>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((d) => (
            <DisputeCard
              key={d.id}
              dispute={d}
              onDone={refresh}
              selectMode={selectMode}
              selected={selectedIds.has(d.id)}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      )}

      {/* Bulk action bar — fixed at the bottom of the viewport */}
      <BulkActionBar selectedCount={selectedIds.size} onClear={clearSelection}>
        <Button
          size="sm"
          onClick={() => { setBulkResolution(""); setResolveAllOpen(true); }}
          disabled={bulkBusy}
          className="h-8 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          <CheckCheck className="mr-1.5 size-3.5" />
          {t("disputes.resolveAll")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setRejectAllOpen(true)}
          disabled={bulkBusy}
          className="h-8 border-rose-500/40 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 hover:text-rose-700 dark:text-rose-300"
        >
          <Ban className="mr-1.5 size-3.5" />
          {t("disputes.rejectAll")}
        </Button>
      </BulkActionBar>

      {/* Bulk resolve dialog — shared resolution note for all selected */}
      <Dialog open={resolveAllOpen} onOpenChange={(o) => { setResolveAllOpen(o); if (!o) setBulkResolution(""); }}>
        <DialogContent className="glass-strong max-w-md">
          <DialogHeader>
            <DialogTitle>{t("disputes.resolve")} {selectedIds.size} {t("disputes.disputeNoun")}</DialogTitle>
            <DialogDescription className="sr-only">
              Apply one resolution note to every selected dispute. Resolved defective-return disputes will trigger an automatic bill recompute per linked PO.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-xs font-medium text-muted-foreground">{t("disputes.sharedResolutionNote")}</Label>
            <Textarea
              placeholder="e.g. Verified with supplier — credit note issued for the affected quantity."
              value={bulkResolution}
              onChange={(e) => setBulkResolution(e.target.value)}
              rows={4}
            />
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
              Any defective-return dispute in the selection will automatically recompute its linked bill (base − short-shipment − returns).
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveAllOpen(false)} disabled={bulkBusy}>{t("common.cancel")}</Button>
            <Button onClick={runBulkResolve} disabled={bulkBusy} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {bulkBusy ? t("disputes.resolving") : `${t("disputes.resolve")} ${selectedIds.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk reject confirmation */}
      <AlertDialog open={rejectAllOpen} onOpenChange={setRejectAllOpen}>
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("disputes.reject")} {selectedIds.size} {t("disputes.disputeNoun")}?</AlertDialogTitle>
            <AlertDialogDescription>
              All selected disputes will be marked <span className="font-medium text-foreground">rejected</span>. Linked bills are not affected. This action is recorded in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={runBulkReject}
              disabled={bulkBusy}
            >
              {bulkBusy ? t("disputes.rejecting") : `${t("disputes.reject")} ${selectedIds.size}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DisputeCard({
  dispute,
  onDone,
  selectMode,
  selected,
  onToggleSelect,
}: {
  dispute: Dispute;
  onDone: () => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const Icon = TYPE_ICON[dispute.type];
  const [resolveOpen, setResolveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [resolution, setResolution] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [photosOpen, setPhotosOpen] = React.useState(false);
  // Track photo count locally so the trigger label reflects new uploads
  // without forcing a full dispute list refresh.
  const [photoCount, setPhotoCount] = React.useState<number>(
    Array.isArray(dispute.photos) ? dispute.photos.length : 0,
  );

  const patch = async (status: "resolved" | "rejected", reason: string) => {
    setBusy(true);
    try {
      await api(`/api/disputes/${dispute.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, resolution: reason }),
      });
      toast.success(`Dispute ${status}`);
      setResolveOpen(false);
      setRejectOpen(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/api/disputes/${dispute.id}`, { method: "DELETE" });
      toast.success("Dispute deleted");
      setDeleteOpen(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard className={cn("p-5 hover-lift", selectMode && selected && "ring-2 ring-emerald-500/40")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          {selectMode && (
            <div
              className="flex shrink-0 items-center pt-1"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Checkbox
                checked={selected}
                onCheckedChange={() => onToggleSelect(dispute.id)}
                aria-label={`Select dispute ${dispute.po.poNumber}`}
                className="data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600 text-white"
              />
            </div>
          )}
          <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-border/60 bg-card/40 text-muted-foreground">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {dispute.po.poNumber} <span className="text-muted-foreground">— {dispute.po.client.name}</span>
            </p>
            <p className="text-[11px] text-muted-foreground">{dispute.po.supplier.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", TYPE_TONE[dispute.type])}>
            {dispute.type === "short_shipment" ? t("disputes.shortShipment") : dispute.type === "defective_return" ? t("disputes.defectiveReturn") : t("disputes.other")}
          </span>
          <StatusChip status={dispute.status} />
        </div>
      </div>

      {dispute.description ? (
        <p className="mt-3 text-sm text-foreground/80">{dispute.description}</p>
      ) : (
        <p className="mt-3 text-xs italic text-muted-foreground">{t("disputes.noDescription")}</p>
      )}

      <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border/50 pt-3">
        <Metric label={t("disputes.quantityAffected")} value={`${dispute.quantityAffected}`} />
        <Metric label={t("disputes.valueAffected")} value={formatCurrency(dispute.valueAffected)} tone="rose" />
        <Metric label={t("disputes.logged")} value={formatDate(dispute.createdAt)} />
      </div>

      {dispute.dispatch && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("disputes.dispatch")}: {formatDate(dispute.dispatch.dispatchDate)}
        </p>
      )}

      {dispute.status === "open" && !selectMode ? (
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" className="h-8 border-rose-500/30 text-rose-600 hover:text-rose-500 dark:text-rose-400" onClick={() => { setResolution(""); setRejectOpen(true); }}>
            <X className="mr-1 size-3.5" />{t("disputes.reject")}
          </Button>
          <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700" onClick={() => { setResolution(""); setResolveOpen(true); }}>
            <Check className="mr-1 size-3.5" />{t("disputes.resolve")}
          </Button>
        </div>
      ) : (
        dispute.resolution && (
          <div className="mt-3 rounded-lg border border-border/50 bg-card/30 p-2.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("disputes.resolution")}</p>
            <p className="mt-0.5 text-xs text-foreground/80">{dispute.resolution}</p>
          </div>
        )
      )}

      <div className="mt-3">
        <Collapsible open={photosOpen} onOpenChange={setPhotosOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-lg border border-border/50 bg-card/30 px-3 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-card/50 hover:text-foreground"
            >
              <span className="inline-flex items-center gap-1.5">
                <ImageIcon className="size-3.5" />
                {t("disputes.evidencePhotos")}
                <span className="rounded-full bg-card/80 px-1.5 py-0.5 text-[10px]">{photoCount}</span>
              </span>
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform duration-200",
                  photosOpen && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <PhotoUpload
              entityType="Dispute"
              entityId={dispute.id}
              stage="dispute"
              label={t("disputes.disputeEvidence")}
              hint="Defect close-ups, shortage photos, return acknowledgement, debit note."
              onUploaded={() => {
                // Optimistically bump the count; the PhotoUpload widget
                // manages its own list, but the trigger label needs to know
                // there's at least one photo now.
                setPhotoCount((c) => Math.max(c, 1));
                onDone();
              }}
            />
          </CollapsibleContent>
        </Collapsible>
      </div>

      {!selectMode && (
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground hover:text-rose-500" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-1 size-3" />{t("common.delete")}
          </Button>
        </div>
      )}

      {/* Resolve dialog */}
      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent className="glass-strong max-w-md">
          <DialogHeader>
            <DialogTitle>{t("disputes.resolveDispute")}</DialogTitle>
            <DialogDescription className="sr-only">Mark this dispute as resolved with a note. Resolving a defective return recomputes the linked bill automatically.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-xs font-medium text-muted-foreground">{t("disputes.resolutionNote")}</Label>
            <Textarea
              placeholder="e.g. Verified goods returned to supplier, debit note issued."
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              rows={3}
            />
            {dispute.type === "defective_return" && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                Resolving a defective return will automatically recompute the linked bill (base amount − returns value).
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={() => patch("resolved", resolution)} disabled={busy}>
              {busy ? t("disputes.resolving") : t("disputes.confirmResolve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="glass-strong max-w-md">
          <DialogHeader>
            <DialogTitle>{t("disputes.rejectDispute")}</DialogTitle>
            <DialogDescription className="sr-only">Reject this dispute with an optional reason. The linked bill is not affected.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-xs font-medium text-muted-foreground">{t("disputes.reason")}</Label>
            <Textarea
              placeholder="e.g. Could not substantiate claim — no evidence of shortage."
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => patch("rejected", resolution)} disabled={busy}>
              {busy ? t("disputes.rejecting") : t("disputes.confirmReject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("disputes.deleteDisputeConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the dispute record. The linked bill will not be recomputed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={remove}
              disabled={busy}
            >
              {busy ? t("disputes.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </GlassCard>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "rose" }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        "kpi-num text-sm font-semibold",
        tone === "rose" ? "text-rose-600 dark:text-rose-400" : "text-foreground"
      )}>{value}</p>
    </div>
  );
}

function LogDisputeDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { data: poData, loading: poLoading } = useApi<{ purchaseOrders: PO[] }>("/api/purchase-orders");
  const { data: dispData } = useApi<{ dispatches: Dispatch[] }>("/api/dispatches");
  const [poId, setPoId] = React.useState<string>("");
  const [dispatchId, setDispatchId] = React.useState<string>("");
  const [type, setType] = React.useState<Dispute["type"]>("short_shipment");
  const [description, setDescription] = React.useState("");
  const [quantity, setQuantity] = React.useState(0);
  const [value, setValue] = React.useState(0);
  const [saving, setSaving] = React.useState(false);

  const dispatchesForPo = (dispData?.dispatches ?? []).filter((d) => d.poId === poId);

  const submit = async () => {
    if (!poId) { toast.error("Select a PO"); return; }
    setSaving(true);
    try {
      await api("/api/disputes", {
        method: "POST",
        body: JSON.stringify({
          poId,
          dispatchId: dispatchId || undefined,
          type,
          description: description || undefined,
          quantityAffected: Number(quantity),
          valueAffected: Number(value),
        }),
      });
      toast.success("Dispute logged");
      await new Promise(r => setTimeout(r, 300));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="glass-strong max-h-[90vh] max-w-lg overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t("disputes.logDispute")}</DialogTitle>
        <DialogDescription className="sr-only">Record a short-shipment, defective return, or other dispute against a purchase order with affected quantity and value.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <Field label={`${t("dispatches.purchaseOrder")} *`}>
          <Select value={poId} onValueChange={(v) => { setPoId(v); setDispatchId(""); }}>
            <SelectTrigger className="w-full"><SelectValue placeholder={poLoading ? t("common.loading") : t("dispatches.selectPo")} /></SelectTrigger>
            <SelectContent>
              {(poData?.purchaseOrders ?? []).map((po) => (
                <SelectItem key={po.id} value={po.id}>
                  {po.poNumber} — {po.client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {poId && dispatchesForPo.length > 0 && (
          <Field label={`${t("disputes.dispatch")} ${t("common.optional")}`}>
            <Select value={dispatchId} onValueChange={setDispatchId}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t("disputes.noSpecificDispatch")} /></SelectTrigger>
              <SelectContent>
                {dispatchesForPo.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {formatDate(d.dispatchDate)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        <Field label={`${t("disputes.type")} *`}>
          <Select value={type} onValueChange={(v) => setType(v as Dispute["type"])}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="short_shipment">{t("disputes.shortShipment")}</SelectItem>
              <SelectItem value="defective_return">{t("disputes.defectiveReturn")}</SelectItem>
              <SelectItem value="other">{t("disputes.other")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label={t("disputes.description")}>
          <Textarea
            placeholder={t("disputes.descriptionPlaceholder")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("disputes.quantityAffected")}>
            <Input
              type="number"
              min={0}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </Field>
          <Field label={`${t("disputes.valueAffected")} (₹)`}>
            <Input
              type="number"
              min={0}
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
            />
          </Field>
        </div>
        {value > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("disputes.valuePreview")}: <span className="font-semibold text-rose-600 dark:text-rose-400">{formatCurrency(value)}</span>
          </p>
        )}
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={saving}>
          {saving ? t("disputes.logging") : t("disputes.logDispute")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
