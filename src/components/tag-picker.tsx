"use client";

import * as React from "react";
import { Plus, Tag as TagIcon, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TagBadge, type TagLike } from "@/components/tag-badge";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TAG_COLORS, TAG_SWATCH_CLASS, isValidTagColor } from "@/lib/tags";
import { toast } from "sonner";

// TagPicker — embeddable in any detail sheet. Props:
//   entityType — "Client" | "Supplier" | "PurchaseOrder"
//   entityId   — the row's id
// Behaviour:
//   1. On mount, fetches the entity's current tags from /api/tags/entity.
//   2. Shows current tags as TagBadges (click to remove).
//   3. A "+" button opens a Popover:
//        - existing tags shown as a clickable list (assigned tags get a check)
//        - an inline "Create new tag" form (name + colour picker) at the bottom
//   4. On assign/unassign, calls the API + refreshes the local tag list.

type AllTag = TagLike & {
  counts?: { clients: number; suppliers: number; purchaseOrders: number; total: number };
};

export function TagPicker({
  entityType,
  entityId,
  align = "start",
  compact,
}: {
  entityType: string;
  entityId: string;
  align?: "start" | "center" | "end";
  compact?: boolean;
}) {
  const [tags, setTags] = React.useState<TagLike[]>([]);
  const [allTags, setAllTags] = React.useState<AllTag[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);

  // Fetch this entity's current tags.
  const refreshEntity = React.useCallback(async () => {
    try {
      const data = await api<{ tags: TagLike[] }>(
        `/api/tags/entity?entityType=${entityType}&entityId=${entityId}`,
      );
      setTags(data.tags ?? []);
    } catch {
      // silent — entity tags are non-critical
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  // Fetch the full tag list (for the picker dropdown).
  const refreshAll = React.useCallback(async () => {
    try {
      const data = await api<{ tags: AllTag[] }>("/api/tags");
      setAllTags(data.tags ?? []);
    } catch {
      /* silent */
    }
  }, []);

  React.useEffect(() => {
    setLoading(true);
    refreshEntity();
  }, [refreshEntity]);

  React.useEffect(() => {
    if (open) refreshAll();
  }, [open, refreshAll]);

  const assign = async (tagId: string) => {
    try {
      await api("/api/tags/assign", {
        method: "POST",
        body: JSON.stringify({ tagId, entityType, entityId }),
      });
      await refreshEntity();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to assign tag");
    }
  };

  const unassign = async (tagId: string) => {
    try {
      await api("/api/tags/unassign", {
        method: "POST",
        body: JSON.stringify({ tagId, entityType, entityId }),
      });
      await refreshEntity();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove tag");
    }
  };

  const assignedIds = new Set(tags.map((t) => t.id));

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", compact ? "" : "min-h-[28px]")}>
      {loading ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Tags…
        </span>
      ) : (
        <>
          {tags.length === 0 ? (
            !compact ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <TagIcon className="size-3" /> No tags yet
              </span>
            ) : null
          ) : (
            tags.map((t) => <TagBadge key={t.id} tag={t} size="sm" onRemove={() => unassign(t.id)} />)
          )}

          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 gap-1 border-dashed px-2 text-[11px] text-muted-foreground hover:text-foreground"
                aria-label="Add tag"
              >
                <Plus className="size-3" />
                {tags.length === 0 ? "Add tag" : "Add"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align={align} className="w-72 p-0">
              <TagPopoverBody
                allTags={allTags}
                assignedIds={assignedIds}
                onAssign={assign}
                onUnassign={unassign}
                onCreated={async (newTag) => {
                  // After creating, immediately assign it to this entity.
                  await assign(newTag.id);
                  await refreshAll();
                }}
              />
            </PopoverContent>
          </Popover>
        </>
      )}
    </div>
  );
}

function TagPopoverBody({
  allTags,
  assignedIds,
  onAssign,
  onUnassign,
  onCreated,
}: {
  allTags: AllTag[];
  assignedIds: Set<string>;
  onAssign: (id: string) => void;
  onUnassign: (id: string) => void;
  onCreated: (t: TagLike) => Promise<void>;
}) {
  const [mode, setMode] = React.useState<"list" | "create">("list");
  const [q, setQ] = React.useState("");

  const filtered = allTags.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex flex-col">
      <div className="border-b border-border/60 p-2">
        <Input
          placeholder="Search or create tag…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-8 border-0 bg-transparent text-xs shadow-none focus-visible:ring-1"
          autoFocus
        />
      </div>
      <div className="max-h-56 overflow-y-auto p-1">
        {mode === "list" ? (
          filtered.length === 0 ? (
            <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
              No tags match.{" "}
              <button
                type="button"
                onClick={() => setMode("create")}
                className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
              >
                Create “{q}”
              </button>
            </div>
          ) : (
            filtered.map((t) => {
              const assigned = assignedIds.has(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => (assigned ? onUnassign(t.id) : onAssign(t.id))}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/60"
                >
                  <span className={cn("size-2.5 shrink-0 rounded-full", (TAG_SWATCH_CLASS[t.color] ?? "bg-emerald-500"))} />
                  <span className="flex-1 truncate text-foreground">{t.name}</span>
                  {assigned ? (
                    <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : null}
                </button>
              );
            })
          )
        ) : null}

        {mode === "create" ? (
          <CreateTagForm
            initialName={q}
            onCancel={() => setMode("list")}
            onCreated={async (t) => {
              await onCreated(t);
              setMode("list");
              setQ("");
            }}
          />
        ) : null}
      </div>

      {mode === "list" ? (
        <div className="border-t border-border/60 p-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-1.5 text-[11px] text-muted-foreground"
            onClick={() => setMode("create")}
          >
            <Plus className="size-3" />Create new tag…
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CreateTagForm({
  initialName,
  onCancel,
  onCreated,
}: {
  initialName: string;
  onCancel: () => void;
  onCreated: (t: TagLike) => Promise<void>;
}) {
  const [name, setName] = React.useState(initialName);
  const [color, setColor] = React.useState<string>("emerald");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setName(initialName);
  }, [initialName]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Tag name is required");
      return;
    }
    if (!isValidTagColor(color)) {
      toast.error("Pick a colour");
      return;
    }
    setSaving(true);
    try {
      const data = await api<{ tag: TagLike }>("/api/tags", {
        method: "POST",
        body: JSON.stringify({ name: trimmed, color }),
      });
      toast.success(`Tag “${data.tag.name}” created`);
      await onCreated(data.tag);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create tag");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 p-2">
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. VIP, Festive Season"
          className="h-8 text-xs"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Colour</Label>
        <div className="flex flex-wrap gap-1.5">
          {TAG_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              onClick={() => setColor(c)}
              className={cn(
                "size-6 rounded-full transition-transform hover:scale-110",
                TAG_SWATCH_CLASS[c],
                color === c && "ring-2 ring-offset-2 ring-offset-background ring-foreground/40",
              )}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="h-7 text-xs">
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={saving} className="h-7 text-xs">
          {saving ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
          Create
        </Button>
      </div>
    </div>
  );
}
