"use client";

import * as React from "react";
import { Tag as TagIcon, Plus, Trash2, Palette, Users, Factory, FileText, Loader2 } from "lucide-react";
import { useApi, api } from "@/lib/api";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  TAG_COLORS, TAG_COLOR_CLASS, TAG_SWATCH_CLASS, isValidTagColor,
} from "@/lib/tags";
import { useTranslation } from "@/hooks/use-translation";

type TagRow = {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  counts: { clients: number; suppliers: number; purchaseOrders: number; total: number };
};

export function TagsView() {
  const { t } = useTranslation();
  const { data, loading, refresh } = useApi<{ tags: TagRow[] }>("/api/tags");
  const [open, setOpen] = React.useState(false);

  const tags = data?.tags ?? [];

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("tags.title")}
        description={t("tags.subtitle")}
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1.5 size-4" />{t("tags.newTag")}
              </Button>
            </DialogTrigger>
            <NewTagDialog onDone={() => { setOpen(false); refresh(); }} />
          </Dialog>
        }
      />

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      ) : tags.length === 0 ? (
        <GlassCard className="p-8">
          <EmptyState
            title={t("tags.noTagsYet")}
            hint="Create tags like “VIP”, “Festive Season”, or “Bulk Buyer” to organise your clients, suppliers, and POs."
            icon={<TagIcon className="size-5" />}
          />
        </GlassCard>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tags.map((tag) => (
            <TagCard key={tag.id} tag={tag} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function TagCard({ tag, onChanged }: { tag: TagRow; onChanged: () => void }) {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const remove = async () => {
    setDeleting(true);
    try {
      await api(`/api/tags/${tag.id}`, { method: "DELETE" });
      toast.success(`Tag “${tag.name}” deleted`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete tag");
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  };

  const colorClass = TAG_COLOR_CLASS[tag.color] ?? TAG_COLOR_CLASS.emerald;
  const swatchClass = TAG_SWATCH_CLASS[tag.color] ?? "bg-emerald-500";

  return (
    <GlassCard className="group relative overflow-hidden p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("size-2.5 shrink-0 rounded-full", swatchClass)} />
            <p className="truncate text-sm font-semibold text-foreground">{tag.name}</p>
          </div>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {tag.color}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
            colorClass,
          )}
        >
          <TagIcon className="size-2.5" />
          {tag.counts.total} {tag.counts.total === 1 ? t("tags.entity") : t("tags.entities")}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <CountChip icon={<Users className="size-3" />} label="Clients" value={tag.counts.clients} />
        <CountChip icon={<Factory className="size-3" />} label="Suppliers" value={tag.counts.suppliers} />
        <CountChip icon={<FileText className="size-3" />} label="POs" value={tag.counts.purchaseOrders} />
      </div>

      <div className="mt-3 flex justify-end border-t border-border/40 pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-rose-600 dark:hover:text-rose-300"
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 className="size-3" />{t("tags.deleteTag")}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tags.deleteTagConfirm")} “{tag.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {t("tags.assignedTo")} {tag.counts.total} {tag.counts.total === 1 ? t("tags.entity") : t("tags.entities")}.
              The entities themselves are not affected. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              disabled={deleting}
              className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500/40"
            >
              {deleting ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
              {t("tags.deleteTag")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </GlassCard>
  );
}

function CountChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/40 bg-card/40 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="kpi-num text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function NewTagDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState<string>("emerald");
  const [saving, setSaving] = React.useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("tags.tagNameRequired"));
      return;
    }
    if (!isValidTagColor(color)) {
      toast.error(t("tags.pickColor"));
      return;
    }
    setSaving(true);
    try {
      await api("/api/tags", {
        method: "POST",
        body: JSON.stringify({ name: trimmed, color }),
      });
      toast.success(`Tag “${trimmed}” created`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create tag");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="glass-strong max-w-md">
      <DialogHeader>
        <DialogTitle>{t("tags.newTag")}</DialogTitle>
        <DialogDescription>
          Tags help you label and filter clients, suppliers, and purchase orders.
          Pick a colour to make it easy to spot at a glance.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">{t("tags.tagName")}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. VIP, Festive Season, Bulk Buyer"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Palette className="size-3.5" />
            {t("tags.color")}
          </Label>
          <div className="flex flex-wrap gap-2">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                onClick={() => setColor(c)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all",
                  color === c
                    ? "border-foreground/30 bg-card/60"
                    : "border-transparent hover:bg-card/40",
                )}
              >
                <span className={cn("size-3 rounded-full", TAG_SWATCH_CLASS[c])} />
                <span className="capitalize text-foreground">{c}</span>
              </button>
            ))}
          </div>
        </div>
        {/* Live preview */}
        {name.trim() ? (
          <div className="rounded-lg border border-border/40 bg-card/30 p-2.5">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{t("tags.preview")}</p>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                TAG_COLOR_CLASS[color] ?? TAG_COLOR_CLASS.emerald,
              )}
            >
              <TagIcon className="size-2.5" />
              {name.trim()}
            </span>
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
          {t("tags.createTag")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
