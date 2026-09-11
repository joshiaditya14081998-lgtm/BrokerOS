"use client";

import * as React from "react";
import {
  LayoutTemplate, Plus, Trash2, Eye, Download, Save, Loader2, FileText,
  ChevronUp, ChevronDown, X, Database, Receipt, Wallet, BadgePercent,
  Truck, AlertTriangle, Users, Factory, Filter, BarChart3,
} from "lucide-react";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useApi, api } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  REPORT_COLUMNS, ENTITY_TYPES, ENTITY_LABELS, GROUP_BY_OPTIONS,
  STATUS_FILTER_OPTIONS, DATE_RANGE_OPTIONS, TEMPLATE_TYPES, parseConfig,
  type EntityType, type ReportColumn, type ReportTemplateDTO,
  type ReportTemplateConfig, type TemplateType,
} from "@/lib/report-columns";
import { useTranslation } from "@/hooks/use-translation";

// ── Tag row (lightweight shape, only id + name + color needed for the
//    tag-filter dropdown). ────────────────────────────────────────────────────
type TagRow = { id: string; name: string; color: string };

// ── Editor state — wraps the user-facing metadata (name/description/type)
//    plus the structured config that gets JSON-stringified into `configJson`.
type EditorState = {
  name: string;
  description: string;
  type: TemplateType;
  config: ReportTemplateConfig;
};

function defaultConfig(): ReportTemplateConfig {
  return {
    entityType: "client",
    columns: ["name", "totalBusiness", "outstanding", "brokerageEarned"],
    filters: { dateRange: "all" },
    groupBy: null,
    sortBy: { field: "totalBusiness", direction: "desc" },
    title: "Custom Report",
    includeCharts: false,
    includeSummary: true,
  };
}

function emptyEditor(): EditorState {
  return {
    name: "",
    description: "",
    type: "custom",
    config: defaultConfig(),
  };
}

// Load a saved template DTO into the editor state. The configJson is parsed
// via `parseConfig` (defensive — older templates may have missing fields).
function editorFromTemplate(t: ReportTemplateDTO): EditorState {
  const cfg = parseConfig(t.configJson);
  return {
    name: t.name,
    description: t.description ?? "",
    type: (["summary", "comparison", "ledger", "custom"] as const).includes(t.type as TemplateType)
      ? (t.type as TemplateType)
      : "custom",
    config: cfg,
  };
}

// Entity-type → icon (used in the template list cards).
const ENTITY_ICON: Record<EntityType, React.ComponentType<{ className?: string }>> = {
  client: Users,
  supplier: Factory,
  bill: Receipt,
  payment: Wallet,
  brokerage: BadgePercent,
  dispatch: Truck,
  dispute: AlertTriangle,
};

// ── Component ──────────────────────────────────────────────────────────────────

export function ReportBuilderView() {
  const { t } = useTranslation();
  const { data, loading, refresh } = useApi<{ templates: ReportTemplateDTO[] }>(
    "/api/report-templates",
  );
  const { data: tagsData } = useApi<{ tags: TagRow[] }>("/api/tags");

  const [editor, setEditor] = React.useState<EditorState>(emptyEditor);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string>("");
  const [deleteTarget, setDeleteTarget] = React.useState<ReportTemplateDTO | null>(null);

  const templates = data?.templates ?? [];
  const tags = tagsData?.tags ?? [];

  // ── Dirty-state tracking: compare current editor against the loaded
  //    template (or empty). Used to show the "unsaved changes" indicator
  //    and to disable Save when nothing has changed.
  const isDirty = React.useMemo(() => {
    if (!editingId) {
      return editor.name.trim() !== "" || JSON.stringify(editor.config) !== JSON.stringify(defaultConfig());
    }
    const original = templates.find((t) => t.id === editingId);
    if (!original) return false;
    const origEditor = editorFromTemplate(original);
    return (
      origEditor.name !== editor.name ||
      origEditor.description !== editor.description ||
      origEditor.type !== editor.type ||
      JSON.stringify(origEditor.config) !== JSON.stringify(editor.config)
    );
  }, [editor, editingId, templates]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleNew = () => {
    setEditor(emptyEditor());
    setEditingId(null);
  };

  const handleLoad = (t: ReportTemplateDTO) => {
    setEditor(editorFromTemplate(t));
    setEditingId(t.id);
  };

  // Persist the current editor state. If editingId is set → PATCH, else POST.
  // On success: refresh the list + keep the editor pointed at the saved id.
  const handleSave = async (opts?: { silent?: boolean }): Promise<string | null> => {
    const name = editor.name.trim();
    if (!name) {
      toast.error("Report name is required");
      return null;
    }
    if (editor.config.columns.length === 0) {
      toast.error("Pick at least one column");
      return null;
    }
    setSaving(true);
    try {
      const configJson = JSON.stringify(editor.config);
      if (editingId) {
        const data = await api<{ template: ReportTemplateDTO }>(
          `/api/report-templates/${editingId}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              name,
              description: editor.description.trim() || undefined,
              type: editor.type,
              configJson,
            }),
          },
        );
        if (!opts?.silent) toast.success(`Saved "${data.template.name}"`);
        await refresh();
        return data.template.id;
      } else {
        const data = await api<{ template: ReportTemplateDTO }>(
          "/api/report-templates",
          {
            method: "POST",
            body: JSON.stringify({
              name,
              description: editor.description.trim() || undefined,
              type: editor.type,
              configJson,
            }),
          },
        );
        if (!opts?.silent) toast.success(`Created "${data.template.name}"`);
        setEditingId(data.template.id);
        await refresh();
        return data.template.id;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save template");
      return null;
    } finally {
      setSaving(false);
    }
  };

  // Preview: save first (so the URL is valid), then open the inline iframe.
  const handlePreview = async () => {
    const id = await handleSave({ silent: true });
    if (!id) return;
    setPreviewUrl(`/api/reports/custom?templateId=${id}`);
    setPreviewOpen(true);
  };

  // Generate PDF: save first (so the URL is valid), then open in a new tab.
  // The report's auto-print script triggers the browser's print dialog where
  // the user picks "Save as PDF".
  const handleGeneratePdf = async () => {
    const id = await handleSave({ silent: true });
    if (!id) return;
    window.open(`/api/reports/custom?templateId=${id}`, "_blank");
    toast.success("Opening print-ready report…");
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await api(`/api/report-templates/${target.id}`, { method: "DELETE" });
      toast.success(`Deleted "${target.name}"`);
      if (editingId === target.id) {
        setEditor(emptyEditor());
        setEditingId(null);
      }
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  // ── Editor sub-state setters (memoized to keep render identity stable) ───
  const updateConfig = React.useCallback(
    (patch: Partial<ReportTemplateConfig>) => {
      setEditor((prev) => ({ ...prev, config: { ...prev.config, ...patch } }));
    },
    [],
  );

  // When the entity type changes, the selected columns / groupBy / sortBy
  // may no longer be valid — reset them to safe defaults for the new type.
  const handleEntityTypeChange = (next: EntityType) => {
    const cols = REPORT_COLUMNS[next];
    const defaultCols = cols.slice(0, 4).map((c) => c.key);
    const firstSortable = cols.find((c) => c.sortable);
    setEditor((prev) => ({
      ...prev,
      config: {
        ...prev.config,
        entityType: next,
        columns: defaultCols,
        groupBy: null,
        sortBy: firstSortable
          ? { field: firstSortable.key, direction: "desc" }
          : undefined,
        filters: { ...prev.config.filters, status: undefined },
      },
    }));
  };

  const toggleColumn = (key: string) => {
    setEditor((prev) => {
      const cols = prev.config.columns;
      const idx = cols.indexOf(key);
      const next = idx === -1 ? [...cols, key] : cols.filter((c) => c !== key);
      return { ...prev, config: { ...prev.config, columns: next } };
    });
  };

  const moveColumn = (key: string, dir: -1 | 1) => {
    setEditor((prev) => {
      const cols = [...prev.config.columns];
      const idx = cols.indexOf(key);
      if (idx === -1) return prev;
      const target = idx + dir;
      if (target < 0 || target >= cols.length) return prev;
      [cols[idx], cols[target]] = [cols[target], cols[idx]];
      return { ...prev, config: { ...prev.config, columns: cols } };
    });
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("reportBuilder.title")}
        description={t("reportBuilder.subtitle")}
        action={
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            >
              <LayoutTemplate className="mr-1 size-3" />
              {templates.length} template{templates.length === 1 ? "" : "s"}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={handleNew}
              className="h-8 gap-1.5"
            >
              <Plus className="size-3.5" />
              New
            </Button>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        {/* ── Left: saved templates list ─────────────────────────────────────── */}
        <GlassCard className="flex max-h-[calc(100vh-12rem)] flex-col p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Saved templates
            </p>
            <span className="text-[10px] text-muted-foreground">
              {templates.length} saved
            </span>
          </div>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : templates.length === 0 ? (
            <div className="px-2 py-6">
              <EmptyState
                title="No saved templates"
                hint="Click “New” to design your first custom report — or use one of the 3 default templates seeded into the system."
                icon={<LayoutTemplate className="size-4" />}
              />
            </div>
          ) : (
            <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
              {templates.map((t) => {
                const cfg = parseConfig(t.configJson);
                const Icon = ENTITY_ICON[cfg.entityType] ?? FileText;
                const active = editingId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleLoad(t)}
                    className={cn(
                      "group flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition-all",
                      active
                        ? "border-emerald-500/40 bg-emerald-500/10 ring-1 ring-emerald-500/20"
                        : "border-border/50 bg-card/30 hover:border-emerald-500/30 hover:bg-emerald-500/5",
                    )}
                  >
                    <div
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-lg",
                        active
                          ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground group-hover:bg-emerald-500/10 group-hover:text-emerald-600 dark:group-hover:text-emerald-400",
                      )}
                    >
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{t.name}</p>
                      <p className="mt-0.5 truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                        {ENTITY_LABELS[cfg.entityType]} · {t.type}
                      </p>
                      {t.description ? (
                        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                          {t.description}
                        </p>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </GlassCard>

        {/* ── Right: editor ─────────────────────────────────────────────────── */}
        <GlassCard className="space-y-5 p-5">
          {/* Action bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {editingId ? "Edit template" : "New template"}
              </h3>
              {isDirty ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                  <span className="size-1.5 rounded-full bg-amber-500" />
                  Unsaved
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handlePreview}
                disabled={saving || !editor.name.trim()}
                className="h-8 gap-1.5"
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
                {t("reportBuilder.preview")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleGeneratePdf}
                disabled={saving || !editor.name.trim()}
                className="h-8 gap-1.5"
              >
                <Download className="size-3.5" />
                {t("reportBuilder.generatePdf")}
              </Button>
              <Button
                size="sm"
                onClick={() => void handleSave()}
                disabled={saving || !isDirty || !editor.name.trim()}
                className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                {editingId ? t("reportBuilder.save") : t("common.add")}
              </Button>
              {editingId ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDeleteTarget(templates.find((t) => t.id === editingId) ?? null)}
                  className="h-8 gap-1.5 text-muted-foreground hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-400"
                  aria-label="Delete template"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </div>
          </div>

          {/* Basics section */}
          <Section title="Basics" icon={<FileText className="size-3.5" />}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rb-name" className="text-xs text-muted-foreground">
                  {t("reportBuilder.reportName")}
                </Label>
                <Input
                  id="rb-name"
                  value={editor.name}
                  onChange={(e) => setEditor((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Weekly Client Performance"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rb-type" className="text-xs text-muted-foreground">
                  Report type
                </Label>
                <Select
                  value={editor.type}
                  onValueChange={(v) => setEditor((p) => ({ ...p, type: v as TemplateType }))}
                >
                  <SelectTrigger id="rb-type" className="h-9 w-full">
                    <SelectValue placeholder="Pick a type" />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_TYPES.map((t) => (
                      <SelectItem key={t.key} value={t.key}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="rb-desc" className="text-xs text-muted-foreground">
                  Description (optional)
                </Label>
                <Textarea
                  id="rb-desc"
                  value={editor.description}
                  onChange={(e) => setEditor((p) => ({ ...p, description: e.target.value }))}
                  placeholder="What this report shows, who it's for, when to use it…"
                  className="min-h-12 text-sm"
                />
              </div>
            </div>
          </Section>

          {/* Data source section */}
          <Section title={t("reportBuilder.dataSource")} icon={<Database className="size-3.5" />}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Entity type</Label>
                <Select
                  value={editor.config.entityType}
                  onValueChange={(v) => handleEntityTypeChange(v as EntityType)}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENTITY_TYPES.map((e) => {
                      const Icon = ENTITY_ICON[e];
                      return (
                        <SelectItem key={e} value={e}>
                          <span className="inline-flex items-center gap-2">
                            <Icon className="size-3.5" />
                            {ENTITY_LABELS[e]}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Report title (printed)</Label>
                <Input
                  value={editor.config.title}
                  onChange={(e) => updateConfig({ title: e.target.value })}
                  placeholder="Heading shown on the PDF"
                  className="h-9"
                />
              </div>
            </div>
          </Section>

          {/* Columns section */}
          <Section
            title={t("reportBuilder.columns")}
            icon={<BarChart3 className="size-3.5" />}
            subtitle={`${editor.config.columns.length} of ${REPORT_COLUMNS[editor.config.entityType].length} selected`}
          >
            <ColumnsEditor
              entityType={editor.config.entityType}
              selected={editor.config.columns}
              onToggle={toggleColumn}
              onMove={moveColumn}
            />
          </Section>

          {/* Filters section */}
          <Section title={t("reportBuilder.filters")} icon={<Filter className="size-3.5" />}>
            <FiltersEditor
              config={editor.config}
              tags={tags}
              onUpdate={(patch) => updateConfig({ filters: { ...editor.config.filters, ...patch } })}
            />
          </Section>

          {/* Grouping + Sorting */}
          <div className="grid gap-5 md:grid-cols-2">
            <Section title={t("reportBuilder.grouping")} icon={<LayoutTemplate className="size-3.5" />}>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Group by</Label>
                <Select
                  value={editor.config.groupBy ?? "none"}
                  onValueChange={(v) => updateConfig({ groupBy: v === "none" ? null : v })}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUP_BY_OPTIONS[editor.config.entityType].map((g) => (
                      <SelectItem key={g.key} value={g.key}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Groups rows under a header + shows a sub-total row per group.
                </p>
              </div>
            </Section>

            <Section title={t("reportBuilder.sorting")} icon={<BarChart3 className="size-3.5" />}>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Sort by</Label>
                  <Select
                    value={editor.config.sortBy?.field ?? ""}
                    onValueChange={(v) =>
                      updateConfig({
                        sortBy: { field: v, direction: editor.config.sortBy?.direction ?? "desc" },
                      })
                    }
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue placeholder="Pick a column" />
                    </SelectTrigger>
                    <SelectContent>
                      {REPORT_COLUMNS[editor.config.entityType]
                        .filter((c) => c.sortable)
                        .map((c) => (
                          <SelectItem key={c.key} value={c.key}>
                            {c.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Dir.</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      updateConfig({
                        sortBy: {
                          field: editor.config.sortBy?.field ?? "name",
                          direction: editor.config.sortBy?.direction === "asc" ? "desc" : "asc",
                        },
                      })
                    }
                    className="h-9 w-16 gap-1"
                  >
                    {editor.config.sortBy?.direction === "asc" ? (
                      <>
                        <ChevronUp className="size-3.5" /> Asc
                      </>
                    ) : (
                      <>
                        <ChevronDown className="size-3.5" /> Desc
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </Section>
          </div>

          {/* Options section */}
          <Section title={t("reportBuilder.options")} icon={<Eye className="size-3.5" />}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-card/30 p-3">
                <div className="pr-3">
                  <p className="text-sm font-medium text-foreground">Include charts</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Embed an inline SVG bar chart at the top of the PDF.
                  </p>
                </div>
                <Switch
                  checked={editor.config.includeCharts}
                  onCheckedChange={(v) => updateConfig({ includeCharts: v })}
                  aria-label="Toggle chart inclusion"
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-card/30 p-3">
                <div className="pr-3">
                  <p className="text-sm font-medium text-foreground">Include summary</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Show a KPI summary header (record count + totals).
                  </p>
                </div>
                <Switch
                  checked={editor.config.includeSummary ?? true}
                  onCheckedChange={(v) => updateConfig({ includeSummary: v })}
                  aria-label="Toggle summary inclusion"
                />
              </div>
            </div>
          </Section>
        </GlassCard>
      </div>

      {/* ── Inline preview dialog (iframe to the print-optimized HTML) ──────── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="glass-strong h-[90vh] max-w-6xl gap-0 overflow-hidden p-0">
          <DialogHeader className="flex flex-row items-center justify-between border-b border-border/60 px-4 py-3">
            <div>
              <DialogTitle className="text-sm">Report preview</DialogTitle>
              <DialogDescription className="text-[10px]">
                Print-optimized HTML — use the Print button in the preview to save as PDF.
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(previewUrl, "_blank")}
                className="h-8 gap-1.5"
              >
                <Download className="size-3.5" />
                Open in new tab
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPreviewOpen(false)}
                className="h-8 gap-1.5"
              >
                <X className="size-3.5" />
                Close
              </Button>
            </div>
          </DialogHeader>
          <iframe
            src={previewUrl}
            title="Report preview"
            className="h-full w-full border-0 bg-white"
          />
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ────────────────────────────────────────────── */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete report template?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `This permanently removes "${deleteTarget.name}". The PDF generator will no longer accept this template id. You can re-create it from the Report Builder if needed.`
                : "This permanently removes the report template."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-600"
            >
              <Trash2 className="mr-1.5 size-3.5" />
              {t("reportBuilder.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  title, subtitle, icon, children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        {icon ? (
          <span className="grid size-6 place-items-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            {icon}
          </span>
        ) : null}
        <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">{title}</h4>
        {subtitle ? (
          <span className="text-[10px] text-muted-foreground">· {subtitle}</span>
        ) : null}
      </div>
      <div>{children}</div>
    </section>
  );
}

// ── Columns editor — checkbox list (left) + ordered selected list (right) ────

function ColumnsEditor({
  entityType, selected, onToggle, onMove,
}: {
  entityType: EntityType;
  selected: string[];
  onToggle: (key: string) => void;
  onMove: (key: string, dir: -1 | 1) => void;
}) {
  const all = REPORT_COLUMNS[entityType];
  const selectedSet = new Set(selected);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {/* Available columns */}
      <div className="rounded-lg border border-border/50 bg-card/30 p-2.5">
        <p className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Available ({all.length})
        </p>
        <div className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
          {all.map((col) => {
            const isSelected = selectedSet.has(col.key);
            return (
              <label
                key={col.key}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                  isSelected
                    ? "bg-emerald-500/10 text-foreground"
                    : "hover:bg-muted/60 text-foreground/90",
                )}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggle(col.key)}
                  className="data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                />
                <span className="flex-1 truncate">{col.label}</span>
                <ColumnBadge col={col} />
              </label>
            );
          })}
        </div>
      </div>

      {/* Selected columns (ordered) */}
      <div className="rounded-lg border border-border/50 bg-card/30 p-2.5">
        <p className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Selected ({selected.length}) — drag with arrows
        </p>
        {selected.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
            Pick at least one column from the left.
          </p>
        ) : (
          <div className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
            {selected.map((key, idx) => {
              const col = all.find((c) => c.key === key);
              if (!col) return null;
              return (
                <div
                  key={key}
                  className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5"
                >
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => onMove(key, -1)}
                      disabled={idx === 0}
                      className="text-muted-foreground hover:text-emerald-600 disabled:opacity-30"
                      aria-label={`Move ${col.label} up`}
                    >
                      <ChevronUp className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMove(key, 1)}
                      disabled={idx === selected.length - 1}
                      className="text-muted-foreground hover:text-emerald-600 disabled:opacity-30"
                      aria-label={`Move ${col.label} down`}
                    >
                      <ChevronDown className="size-3" />
                    </button>
                  </div>
                  <span className="flex-1 truncate text-xs text-foreground">{col.label}</span>
                  <ColumnBadge col={col} />
                  <button
                    type="button"
                    onClick={() => onToggle(key)}
                    className="text-muted-foreground hover:text-rose-600"
                    aria-label={`Remove ${col.label}`}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ColumnBadge({ col }: { col: ReportColumn }) {
  const colors: Record<string, string> = {
    text:     "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
    number:   "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    currency: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    date:     "bg-teal-500/10 text-teal-700 dark:text-teal-300",
    status:   "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  };
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide",
        colors[col.type],
      )}
    >
      {col.type}
    </span>
  );
}

// ── Filters editor — date range + status + tag ───────────────────────────────

function FiltersEditor({
  config, tags, onUpdate,
}: {
  config: ReportTemplateConfig;
  tags: TagRow[];
  onUpdate: (patch: Partial<ReportTemplateConfig["filters"]>) => void;
}) {
  const statusOptions = STATUS_FILTER_OPTIONS[config.entityType];
  const showCustomDates = config.filters.dateRange === "custom";

  return (
    <div className="space-y-3">
      {/* Date range */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Date range</Label>
          <Select
            value={config.filters.dateRange ?? "all"}
            onValueChange={(v) => onUpdate({ dateRange: v as ReportTemplateConfig["filters"]["dateRange"] })}
          >
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_RANGE_OPTIONS.map((d) => (
                <SelectItem key={d.key} value={d.key}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {statusOptions.length > 0 ? (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Status filter</Label>
            <Select
              value={config.filters.status ?? "all"}
              onValueChange={(v) => onUpdate({ status: v === "all" ? undefined : v })}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statusOptions.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Status filter</Label>
            <div className="flex h-9 items-center rounded-md border border-dashed border-border/60 px-3 text-[11px] text-muted-foreground">
              No status column for {ENTITY_LABELS[config.entityType].toLowerCase()}.
            </div>
          </div>
        )}
      </div>

      {/* Custom date range inputs (shown only when dateRange === "custom") */}
      {showCustomDates ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rb-from" className="text-xs text-muted-foreground">From date</Label>
            <Input
              id="rb-from"
              type="date"
              value={config.filters.fromDate ?? ""}
              onChange={(e) => onUpdate({ fromDate: e.target.value })}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rb-to" className="text-xs text-muted-foreground">To date</Label>
            <Input
              id="rb-to"
              type="date"
              value={config.filters.toDate ?? ""}
              onChange={(e) => onUpdate({ toDate: e.target.value })}
              className="h-9"
            />
          </div>
        </div>
      ) : null}

      {/* Tag filter */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Tag filter (optional)</Label>
        <Select
          value={config.filters.tagId ?? "none"}
          onValueChange={(v) => onUpdate({ tagId: v === "none" ? undefined : v })}
        >
          <SelectTrigger className="h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No tag filter</SelectItem>
            {tags.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">
          Restricts the report to entities tagged with the selected label.
        </p>
      </div>
    </div>
  );
}
