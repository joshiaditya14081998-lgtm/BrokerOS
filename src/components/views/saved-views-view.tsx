"use client";

import * as React from "react";
import {
  Bookmark, Trash2, ArrowRight, Star, Users, Factory, FileText, Receipt,
  AlertTriangle, ScrollText, Filter,
} from "lucide-react";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useApi, api } from "@/lib/api";
import { useUI, type ViewKey } from "@/lib/ui-store";
import { toast } from "sonner";
import {
  getSavedViewIcon,
  summarizeFilter,
  viewLabel,
  type SavedViewDTO,
  type SavedFilter,
} from "@/lib/saved-views";
import { formatDate } from "@/lib/format";
import { useTranslation } from "@/hooks/use-translation";

// ── View-key → icon map (for the group headers) ───────────────────────────────
//
// Mirrors the sidebar's icons so the management page reads as a natural
// extension of the navigation. Kept local since the sidebar's NAV array
// includes non-list views (Dashboard, Analytics, …) we don't want here.

const VIEW_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  clients: Users,
  suppliers: Factory,
  pos: FileText,
  bills: Receipt,
  disputes: AlertTriangle,
  audit: ScrollText,
};

// ── Component ──────────────────────────────────────────────────────────────────

export function SavedViewsView() {
  const { t } = useTranslation();
  const { data, loading, refresh } = useApi<{ savedViews: SavedViewDTO[] }>(
    "/api/saved-views",
  );
  const { applySavedView, setView } = useUI();

  const all = data?.savedViews ?? [];

  // Group by view type, preserving the order in which views first appear
  // (which, since the API returns createdAt desc, surfaces the most recently
  // used view types at the top).
  const groups = React.useMemo(() => {
    const map = new Map<string, SavedViewDTO[]>();
    for (const sv of all) {
      const list = map.get(sv.view) ?? [];
      list.push(sv);
      map.set(sv.view, list);
    }
    return Array.from(map.entries());
  }, [all]);

  const total = all.length;

  // Delete confirmation state — holds the id of the saved view pending
  // deletion, or null when the alert is closed.
  const [deleteTarget, setDeleteTarget] = React.useState<SavedViewDTO | null>(null);

  const handleApply = (sv: SavedViewDTO) => {
    let filter: SavedFilter = {};
    try {
      filter = JSON.parse(sv.filterJson) as SavedFilter;
    } catch {
      toast.error(`Saved view "${sv.name}" has invalid filter data`);
      return;
    }
    // Push the apply trigger first so the target view's SavedViewsBar picks
    // it up after navigation. The trigger survives `setView` (we don't clear
    // it in setView by design — see `src/lib/ui-store.ts`).
    applySavedView(sv.view, filter);
    setView(sv.view as ViewKey);
    toast.success(`Applying "${sv.name}"…`);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await api(`/api/saved-views/${target.id}`, { method: "DELETE" });
      toast.success(`Deleted "${target.name}"`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("savedViews.title")}
        description={t("savedViews.subtitle")}
        action={
          <Badge
            variant="outline"
            className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          >
            <Bookmark className="mr-1 size-3" />
            {total} {total === 1 ? t("savedViews.savedView") : t("savedViews.savedViews")}
          </Badge>
        }
      />

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : total === 0 ? (
        <GlassCard className="p-10">
          <EmptyState
            title={t("savedViews.noSavedViewsYet")}
            hint="Open any list view (Clients, POs, Bills, Disputes, Audit) and apply a filter combination — then click the bookmark button above the filter bar to save it here for one-click re-use."
            icon={<Bookmark className="size-5" />}
          />
        </GlassCard>
      ) : (
        <div className="space-y-6">
          {groups.map(([viewKey, items]) => {
            const Icon = VIEW_ICON[viewKey] ?? Star;
            return (
              <section key={viewKey} className="space-y-2">
                {/* Group header — view-type icon + label + count chip. */}
                <div className="flex items-center gap-2 px-1">
                  <div className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-3.5" />
                  </div>
                  <h3 className="text-sm font-semibold tracking-tight text-foreground">
                    {viewLabel(viewKey)}
                  </h3>
                  <Badge variant="outline" className="border-border/60 text-[10px] text-muted-foreground">
                    {items.length}
                  </Badge>
                </div>

                {/* Grid of saved-view cards for this view type. */}
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {items.map((sv) => {
                    const ViewIcon = getSavedViewIcon(sv.icon);
                    const summary = summarizeFilter(sv.view, safeParse(sv.filterJson));
                    return (
                      <SavedViewCard
                        key={sv.id}
                        savedView={sv}
                        icon={<ViewIcon className="size-4 text-emerald-600 dark:text-emerald-400" />}
                        summary={summary}
                        onApply={() => handleApply(sv)}
                        onDelete={() => setDeleteTarget(sv)}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("savedViews.deleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `This permanently removes "${deleteTarget.name}". You can re-create it from the ${viewLabel(deleteTarget.view)} view if needed.`
                : "This permanently removes the saved view."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-600"
            >
              <Trash2 className="mr-1.5 size-3.5" />
              {t("savedViews.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Saved-view card ────────────────────────────────────────────────────────────

function SavedViewCard({
  savedView, icon, summary, onApply, onDelete,
}: {
  savedView: SavedViewDTO;
  icon: React.ReactNode;
  summary: string;
  onApply: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <GlassCard className="group flex flex-col gap-3 p-4">
      {/* Header — icon tile + name + view-type badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10">
            {icon}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{savedView.name}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {viewLabel(savedView.view)}
              {savedView.entityType ? ` · ${savedView.entityType}` : ""}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onDelete}
          aria-label={`Delete saved view "${savedView.name}"`}
          className="size-7 shrink-0 text-muted-foreground hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-400"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {/* Filter summary — human-readable list of active filters */}
      <div className="rounded-lg border border-border/40 bg-card/30 p-2.5">
        <div className="flex items-start gap-1.5">
          <Filter className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-relaxed text-foreground/80">{summary}</p>
        </div>
      </div>

      {/* Footer — created date + Apply button */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/40 pt-2.5">
        <span className="text-[10px] text-muted-foreground">
          {t("savedViews.created")} {formatDate(savedView.createdAt)}
        </span>
        <Button
          type="button"
          size="sm"
          onClick={onApply}
          className="h-7 gap-1 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
        >
          {t("savedViews.apply")}
          <ArrowRight className="size-3" />
        </Button>
      </div>
    </GlassCard>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
