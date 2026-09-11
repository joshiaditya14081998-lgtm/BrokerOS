"use client";

import * as React from "react";
import { Bookmark, Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useApi, api } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useUI } from "@/lib/ui-store";
import {
  SAVED_VIEW_ICONS,
  getSavedViewIcon,
  isValidSavedViewIcon,
  summarizeFilter,
  type SavedViewDTO,
  type SavedFilter,
} from "@/lib/saved-views";

// ── Tag lookup (for tag-filtered views) ────────────────────────────────────────
//
// When the parent's `currentFilter` includes `selectedTagIds` (clients /
// suppliers / pos), we want the saved view's filterJson to also carry the
// human-readable tag *names* so `summarizeFilter` can render "Tags: VIP,
// Premium" without a DB lookup. We fetch the tag list once per bar instance
// (cheap call) and resolve IDs → names at save time.

type TagLite = { id: string; name: string };

const TAG_VIEWS = new Set(["clients", "suppliers", "pos"]);

// ── Props ──────────────────────────────────────────────────────────────────────

export type SavedViewsBarProps = {
  // ViewKey string — used to fetch only the saved views for this view type.
  view: string;
  // The current filter state of the parent view. Stored verbatim (as JSON)
  // when the user clicks "Save current". Shape varies per view — see
  // `src/lib/saved-views.ts` for the per-view contract.
  currentFilter: SavedFilter;
  // Whether `currentFilter` differs from the view's default state. When
  // false, the "Save current" button is hidden (nothing meaningful to save).
  // The parent computes this; `isFilterActive` from `@/lib/saved-views` is
  // the canonical helper.
  isFilterActive: boolean;
  // Called with the parsed filterJson when the user clicks a saved-view pill.
  // The parent applies the filter to its local state.
  onApply: (filter: SavedFilter) => void;
  // Optional className override for the outer wrapper.
  className?: string;
};

// ── Component ──────────────────────────────────────────────────────────────────

export function SavedViewsBar({
  view, currentFilter, isFilterActive, onApply, className,
}: SavedViewsBarProps) {
  // Saved views for this view type.
  const { data, refresh } = useApi<{ savedViews: SavedViewDTO[] }>(
    `/api/saved-views?view=${encodeURIComponent(view)}`,
  );

  // Cross-view "apply saved view" trigger — fired by the Saved Views
  // management page when the user clicks Apply on a saved view from another
  // view. We watch `savedViewApply` and call `onApply` with the parsed filter
  // when it matches this bar's view, then clear the trigger so it doesn't
  // re-fire. The ref mirror of `onApply` keeps the effect's dependency list
  // stable so we don't miss a trigger because the parent passed a new
  // `onApply` identity on every render.
  const savedViewApply = useUI((s) => s.savedViewApply);
  const clearSavedViewApply = useUI((s) => s.clearSavedViewApply);
  const onApplyRef = React.useRef(onApply);
  React.useEffect(() => { onApplyRef.current = onApply; }, [onApply]);
  React.useEffect(() => {
    if (savedViewApply && savedViewApply.view === view) {
      onApplyRef.current(savedViewApply.filter);
      clearSavedViewApply();
      toast.success(`Applied saved view`);
    }
  }, [savedViewApply, view, clearSavedViewApply]);

  // Tag lookup — only fetched for views that filter by tags. The result is
  // used to enrich the saved filterJson with tag names at save time.
  const needsTags = TAG_VIEWS.has(view);
  const { data: tagData } = useApi<{ tags: TagLite[] } | null>(
    needsTags ? "/api/tags" : null,
  );
  const tagMap = React.useMemo(() => {
    const m = new Map<string, string>();
    if (tagData?.tags) {
      for (const t of tagData.tags) m.set(t.id, t.name);
    }
    return m;
  }, [tagData]);

  const savedViews = data?.savedViews ?? [];

  // "Save current" dialog state.
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [icon, setIcon] = React.useState<string>("star");
  const [saving, setSaving] = React.useState(false);

  // Delete confirmation state — holds the id of the saved view pending
  // deletion, or null when the alert is closed.
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  // Reset the dialog form whenever it opens.
  React.useEffect(() => {
    if (saveOpen) {
      setName("");
      setIcon("star");
    }
  }, [saveOpen]);

  // The filter object that will be persisted. Includes the resolved tag
  // names (for tag-filtered views) so the saved view can be summarised
  // without a DB lookup later.
  const filterToSave = React.useMemo<SavedFilter>(() => {
    const enriched: SavedFilter = { ...currentFilter };
    const ids = Array.isArray(currentFilter.selectedTagIds)
      ? (currentFilter.selectedTagIds as unknown[]).filter(
          (x): x is string => typeof x === "string",
        )
      : [];
    if (ids.length > 0) {
      const names = ids
        .map((id) => tagMap.get(id))
        .filter((n): n is string => !!n);
      enriched.selectedTagNames = names;
    }
    return enriched;
  }, [currentFilter, tagMap]);

  const previewSummary = React.useMemo(
    () => summarizeFilter(view, filterToSave),
    [view, filterToSave],
  );

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give the saved view a name");
      return;
    }
    setSaving(true);
    try {
      await api("/api/saved-views", {
        method: "POST",
        body: JSON.stringify({
          name: trimmed,
          view,
          filterJson: JSON.stringify(filterToSave),
          icon,
          // entityType helps the management view describe tag-filtered
          // presets; we set it for the views that actually use tags.
          entityType: view === "clients"
            ? "Client"
            : view === "suppliers"
              ? "Supplier"
              : view === "pos"
                ? "PurchaseOrder"
                : undefined,
        }),
      });
      toast.success(`Saved view "${trimmed}" created`);
      setSaveOpen(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save view");
    } finally {
      setSaving(false);
    }
  };

  const handleApply = (sv: SavedViewDTO) => {
    let parsed: SavedFilter = {};
    try {
      parsed = JSON.parse(sv.filterJson) as SavedFilter;
    } catch {
      toast.error(`Saved view "${sv.name}" has invalid filter data`);
      return;
    }
    onApply(parsed);
    toast.success(`Applied "${sv.name}"`);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const target = savedViews.find((sv) => sv.id === deleteId);
    const id = deleteId;
    setDeleteId(null);
    try {
      await api(`/api/saved-views/${id}`, { method: "DELETE" });
      toast.success(`Deleted "${target?.name ?? "saved view"}"`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  // ── Render gates ──────────────────────────────────────────────────────────
  //
  // The bar is only rendered when there's something to show: either the
  // user already has saved views for this view type, OR the current filter
  // is non-default (so the "Save current" button is meaningful). When
  // neither holds, we render nothing — no empty chrome.
  const showBar = savedViews.length > 0 || isFilterActive;
  if (!showBar) return null;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Horizontal scrollable row of saved-view pills + the "Save current"
          button. On narrow viewports this scrolls horizontally; on wide
          viewports the row lays out naturally. */}
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {savedViews.map((sv) => {
          const Icon = getSavedViewIcon(sv.icon);
          return (
            <SavedViewPill
              key={sv.id}
              savedView={sv}
              icon={<Icon className="size-3.5 text-emerald-600 dark:text-emerald-400" />}
              onApply={() => handleApply(sv)}
              onDelete={() => setDeleteId(sv.id)}
            />
          );
        })}
      </div>

      {/* "Save current" button — only shown when the current filter differs
          from the view's defaults (i.e. there's something worth saving). */}
      {isFilterActive ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setSaveOpen(true)}
          className="h-8 shrink-0 gap-1.5 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 hover:text-emerald-700 dark:text-emerald-300"
          aria-label="Save current filter as a view"
        >
          <Bookmark className="size-3.5" />
          <span className="hidden sm:inline">Save current</span>
        </Button>
      ) : null}

      {/* Save dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="glass-strong max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
            <DialogDescription>
              Capture this filter combination with a name so you can re-apply
              it later from the bar above or the Saved Views page.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="saved-view-name" className="text-xs font-medium text-muted-foreground">
                Name *
              </Label>
              <Input
                id="saved-view-name"
                placeholder="e.g. VIP clients with dues"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !saving) {
                    e.preventDefault();
                    void handleSave();
                  }
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Icon</Label>
              <div className="flex flex-wrap gap-2">
                {SAVED_VIEW_ICONS.map((ic) => {
                  const Icon = getSavedViewIcon(ic);
                  const active = (icon === ic) || (ic === "star" && !isValidSavedViewIcon(icon));
                  return (
                    <button
                      key={ic}
                      type="button"
                      onClick={() => setIcon(ic)}
                      aria-label={`Icon: ${ic}`}
                      aria-pressed={active}
                      className={cn(
                        "grid size-9 place-items-center rounded-lg border transition-all",
                        active
                          ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "border-border/60 bg-card/40 text-muted-foreground hover:border-border hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Filter preview — human-readable summary so the user knows
                exactly what they're about to save. */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Filter preview</Label>
              <div className="rounded-lg border border-border/60 bg-card/40 p-3">
                <div className="flex items-start gap-2">
                  <Save className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <p className="text-xs leading-relaxed text-foreground/80">
                    {previewSummary}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={() => void handleSave()}
              disabled={saving || !name.trim()}
              className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              {saving ? "Saving…" : "Save view"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete saved view?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the saved view. The filter will need to
              be re-built manually if you want it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-600"
            >
              <Trash2 className="mr-1.5 size-3.5" />
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Saved-view pill ────────────────────────────────────────────────────────────
//
// A glass pill with the saved view's icon + name. Click to apply. Hover
// reveals a small X button to delete (with confirm handled by the parent).

function SavedViewPill({
  savedView, icon, onApply, onDelete,
}: {
  savedView: SavedViewDTO;
  icon: React.ReactNode;
  onApply: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group relative inline-flex shrink-0 items-center">
      <button
        type="button"
        onClick={onApply}
        title={`Apply "${savedView.name}"`}
        className="glass hover-lift inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-foreground/90 transition-all hover:border-emerald-500/40 hover:text-emerald-700 dark:hover:text-emerald-300"
      >
        {icon}
        <span className="max-w-[160px] truncate">{savedView.name}</span>
      </button>
      {/* Delete (X) button — appears on hover/focus. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={`Delete saved view "${savedView.name}"`}
        className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border border-border/60 bg-background text-muted-foreground opacity-0 shadow-sm transition-all hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-400 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50"
      >
        <Plus className="size-3 rotate-45" />
      </button>
    </div>
  );
}
