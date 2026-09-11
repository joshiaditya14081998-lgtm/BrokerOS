"use client";

import * as React from "react";
import { Tag as TagIcon, X } from "lucide-react";
import { TagBadge, type TagLike } from "@/components/tag-badge";
import { useApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

// TagFilterBar — a horizontally-wrapping row of toggleable tag pills used by
// the Clients / Suppliers / POs views to filter their lists by tag.
//
// Behaviour:
//   - Fetches all available tags from /api/tags (with counts).
//   - Clicking a pill toggles its selection in the parent's `selected` set.
//   - Tags with 0 entities are still shown (so the broker can see all
//     available tags) but rendered muted to indicate they won't filter
//     anything yet.
//   - Hidden entirely when there are no tags at all (avoids a confusing empty
//     bar on a fresh install — the Tags management view is the right place to
//     create tags first).
//   - Includes a "clear" affordance when at least one tag is selected.

type TagWithCounts = TagLike & {
  counts?: { clients: number; suppliers: number; purchaseOrders: number; total: number };
};

export function TagFilterBar({
  selected,
  onToggle,
  onClear,
  entityTypeCount,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
  // Which count column to surface — e.g. for the Clients view we want the
  // `clients` count per tag, for Suppliers the `suppliers` count, etc.
  entityTypeCount?: "clients" | "suppliers" | "purchaseOrders";
}) {
  const { data, loading } = useApi<{ tags: TagWithCounts[] }>("/api/tags");

  if (loading) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-16 rounded-full" />
        ))}
      </div>
    );
  }

  const tags = data?.tags ?? [];
  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 pr-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <TagIcon className="size-3" />Tags
      </span>
      {tags.map((t) => {
        const active = selected.has(t.id);
        const count = entityTypeCount ? t.counts?.[entityTypeCount] ?? 0 : t.counts?.total ?? 0;
        return (
          <TagBadge
            key={t.id}
            tag={t}
            size="sm"
            active={active}
            onClick={() => onToggle(t.id)}
            className={cn(count === 0 && !active && "opacity-50")}
          />
        );
      })}
      {selected.size > 0 ? (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-300"
        >
          <X className="size-2.5" />
          Clear ({selected.size})
        </button>
      ) : null}
    </div>
  );
}

// Helper: filter a list of entities (which each carry a `tags` array) by a
// set of selected tag ids. OR semantics — an entity passes if it has ANY of
// the selected tags. Empty selection = show all.
export function filterByTags<T extends { tags?: TagLike[] }>(
  rows: T[],
  selected: Set<string>,
): T[] {
  if (selected.size === 0) return rows;
  return rows.filter((r) => (r.tags ?? []).some((t) => selected.has(t.id)));
}
