"use client";

import * as React from "react";
import {
  Copy, ExternalLink, RefreshCw, Mail, CheckCircle2,
  AlertTriangle, Wallet, ListTodo, Loader2, Inbox, Sparkles,
} from "lucide-react";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useApi, api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/format";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/use-translation";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type DigestStats = {
  pendingActions: number;
  outstandingTotal: number;
  duePaymentsCount: number;
  openDisputes: number;
};

type TextDigestResponse = {
  format: "text";
  text: string;
  stats: DigestStats;
  generatedAt: string;
};

type HtmlDigestResponse = {
  format: "html";
  html: string;
  stats: DigestStats;
  generatedAt: string;
};

type EmailDigestResponse = {
  format: "email";
  subject: string;
  body: string;
  aiGenerated: boolean;
  stats: DigestStats;
  generatedAt: string;
};

type SettingsResponse = {
  defaults: {
    autoDigestEnabled: boolean;
    digestEmail: string;
  };
};

// Custom events used by the header "Refresh" button to bump both sub-panels
// without prop-drilling callbacks through the SectionHeader.
const BRIEF_REFRESH_EVENT = "digest:brief-refresh";
const EMAIL_REFRESH_EVENT = "digest:email-refresh";

// ─────────────────────────────────────────────────────────────────────────────
// Digest view — KPI strip on top + two tabs (AI Brief / Email Ready).
// ─────────────────────────────────────────────────────────────────────────────
export function DigestView() {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState<"brief" | "email">("brief");

  // KPI strip — fetched once from the text format (cheap, no LLM call).
  const { data: textData, loading: textLoading, refresh: refreshText } = useApi<TextDigestResponse>(
    "/api/digest?format=text",
  );

  // Settings — controls auto-generate behavior on the AI Brief tab.
  const { data: settingsData } = useApi<SettingsResponse>("/api/settings");
  const autoDigestEnabled = settingsData?.defaults.autoDigestEnabled ?? true;

  const stats = textData?.stats ?? null;

  const handleRefreshAll = () => {
    refreshText();
    window.dispatchEvent(new CustomEvent(BRIEF_REFRESH_EVENT));
    window.dispatchEvent(new CustomEvent(EMAIL_REFRESH_EVENT));
    toast.info("Refreshing digest…");
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("digest.title")}
        description={t("digest.subtitle")}
        action={
          <Button variant="outline" size="sm" onClick={handleRefreshAll}>
            <RefreshCw className="mr-1.5 size-4" />
            {t("digest.refresh")}
          </Button>
        }
      />

      {/* KPI strip — 4 mini-cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiMini
          icon={<ListTodo className="size-4" />}
          label={t("digest.pendingActions")}
          value={textLoading && !stats ? null : stats ? formatNumber(stats.pendingActions) : null}
          accent="emerald"
          hint={t("digest.pendingActionsHint")}
        />
        <KpiMini
          icon={<Wallet className="size-4" />}
          label={t("digest.outstanding")}
          value={textLoading && !stats ? null : stats ? formatCurrency(stats.outstandingTotal, { compact: true }) : null}
          accent="amber"
          hint={t("digest.outstandingHint")}
        />
        <KpiMini
          icon={<Inbox className="size-4" />}
          label={t("digest.duePayments")}
          value={textLoading && !stats ? null : stats ? formatNumber(stats.duePaymentsCount) : null}
          accent="amber"
          hint={t("digest.duePaymentsHint")}
        />
        <KpiMini
          icon={<AlertTriangle className="size-4" />}
          label={t("digest.openDisputes")}
          value={textLoading && !stats ? null : stats ? formatNumber(stats.openDisputes) : null}
          accent="rose"
          hint={t("digest.openDisputesHint")}
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "brief" | "email")}>
        <TabsList className="glass border border-border/60">
          <TabsTrigger value="brief" className="gap-1.5">
            <Sparkles className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            {t("digest.aiBrief")}
          </TabsTrigger>
          <TabsTrigger value="email" className="gap-1.5">
            <Mail className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            {t("digest.emailReady")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="brief" className="mt-4">
          <AiBriefPanel autoGenerate={autoDigestEnabled} />
        </TabsContent>

        <TabsContent value="email" className="mt-4">
          <EmailReadyPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI mini-card
// ─────────────────────────────────────────────────────────────────────────────
function KpiMini({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint: string;
  accent: "emerald" | "amber" | "rose";
}) {
  const accentClass: Record<string, string> = {
    emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    rose: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  };
  return (
    <GlassCard className="hover-lift p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          {value === null ? (
            <Skeleton className="mt-2 h-7 w-20" />
          ) : (
            <p className="kpi-num mt-1.5 text-2xl font-light text-foreground">{value}</p>
          )}
          <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
        </div>
        <div className={`grid size-9 shrink-0 place-items-center rounded-xl ${accentClass[accent]}`}>
          {icon}
        </div>
      </div>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Brief panel — fetches /api/digest?format=email, shows the LLM-generated
// morning brief in a glass card with emerald gradient + sparkle accent.
// ─────────────────────────────────────────────────────────────────────────────
function AiBriefPanel({ autoGenerate }: { autoGenerate: boolean }) {
  const { t } = useTranslation();
  const [data, setData] = React.useState<EmailDigestResponse | null>(null);
  const [loading, setLoading] = React.useState<boolean>(autoGenerate);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [manualTrigger, setManualTrigger] = React.useState(0);

  // Listen for the header Refresh button's custom event.
  React.useEffect(() => {
    function onRefresh() {
      setManualTrigger((n) => n + 1);
    }
    window.addEventListener(BRIEF_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(BRIEF_REFRESH_EVENT, onRefresh);
  }, []);

  // Fetch the AI brief. Triggers on mount (if autoGenerate) or on manual
  // trigger (button click or header Refresh). `autoGenerate` in deps so the
  // effect re-runs if the setting loads AFTER mount with a different value.
  React.useEffect(() => {
    if (!autoGenerate && manualTrigger === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = `/api/digest?format=email&_=${Date.now()}`;
    api<EmailDigestResponse>(url)
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to generate brief");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [autoGenerate, manualTrigger]);

  const handleCopy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(`${data.subject}\n\n${data.body}`);
      setCopied(true);
      toast.success("Brief copied to clipboard");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't access clipboard — try selecting and copying manually.");
    }
  };

  const handleRegenerate = () => setManualTrigger((n) => n + 1);

  // Idle state — auto-generate off, user hasn't clicked yet
  if (!loading && !data && !error && !autoGenerate && manualTrigger === 0) {
    return (
      <GlassCard className="p-10">
        <EmptyState
          icon={<Sparkles className="size-5" />}
          title={t("digest.autoGenerateOff")}
          hint={t("digest.autoGenerateOffHint")}
        />
        <div className="mt-4 flex justify-center">
          <Button onClick={handleRegenerate} className="bg-emerald-600 text-white hover:bg-emerald-700">
            <Sparkles className="mr-1.5 size-4" />
            {t("digest.generateBrief")}
          </Button>
        </div>
      </GlassCard>
    );
  }

  // Loading state — skeleton with "Generating your brief…"
  if (loading && !data) {
    return (
      <GlassCard className="overflow-hidden p-0">
        <div className="relative border-b border-border/50 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent px-6 py-5">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Sparkles className="size-4 animate-pulse" />
            </div>
            <div>
              <Skeleton className="h-4 w-64" />
              <Skeleton className="mt-1.5 h-3 w-40" />
            </div>
          </div>
        </div>
        <div className="space-y-3 p-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
            <span>{t("digest.generatingBrief")}</span>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-[95%]" />
          <Skeleton className="h-3 w-[88%]" />
          <Skeleton className="h-3 w-[92%]" />
          <Skeleton className="h-3 w-[70%]" />
          <div className="h-2" />
          <Skeleton className="h-3 w-[90%]" />
          <Skeleton className="h-3 w-[85%]" />
          <Skeleton className="h-3 w-[60%]" />
        </div>
      </GlassCard>
    );
  }

  // Error state
  if (error && !data) {
    return (
      <GlassCard className="p-6">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{t("digest.couldNotGenerateBrief")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{error}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={handleRegenerate}>
              <RefreshCw className="mr-1.5 size-4" />
              {t("common.tryAgain")}
            </Button>
          </div>
        </div>
      </GlassCard>
    );
  }

  if (!data) return null;

  // Success state — show the AI brief card
  return (
    <GlassCard className="overflow-hidden p-0">
      {/* Header — gradient + sparkle icon, AI-generated badge */}
      <div className="relative border-b border-border/50 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                {t("digest.aiMorningBrief")}
              </p>
              <p className="mt-0.5 text-sm font-medium text-foreground">{data.subject}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Generated {new Date(data.generatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
              </p>
            </div>
          </div>
          {data.aiGenerated ? (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
              <Sparkles className="mr-1 size-3" />
              {t("digest.aiGenerated")}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[10px] font-medium text-amber-700 dark:text-amber-300">
              {t("digest.templatedFallback")}
            </Badge>
          )}
        </div>
      </div>

      {/* Body — the LLM-generated brief text */}
      <div className="px-6 py-5">
        <div className="prose-sm whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
          {data.body}
        </div>
      </div>

      {/* Footer — actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 bg-card/30 px-6 py-3">
        <Button size="sm" onClick={handleRegenerate} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 size-3.5" />
          )}
          {t("digest.regenerate")}
        </Button>
        <Button size="sm" variant="outline" onClick={handleCopy} disabled={loading}>
          {copied ? (
            <>
              <CheckCircle2 className="mr-1.5 size-3.5 text-emerald-600 dark:text-emerald-400" />
              {t("common.copied")}
            </>
          ) : (
            <>
              <Copy className="mr-1.5 size-3.5" />
              {t("digest.copyText")}
            </>
          )}
        </Button>
        {!data.aiGenerated && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            LLM unavailable — showing templated brief.
          </span>
        )}
      </div>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Email Ready panel — iframe preview of the HTML email + copy/open actions
// ─────────────────────────────────────────────────────────────────────────────
function EmailReadyPanel() {
  const { t } = useTranslation();
  const [data, setData] = React.useState<HtmlDigestResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [manualTrigger, setManualTrigger] = React.useState(0);

  React.useEffect(() => {
    function onRefresh() {
      setManualTrigger((n) => n + 1);
    }
    window.addEventListener(EMAIL_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(EMAIL_REFRESH_EVENT, onRefresh);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = `/api/digest?format=html&_=${Date.now()}`;
    api<HtmlDigestResponse>(url)
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load digest");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [manualTrigger]);

  const handleCopyHtml = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.html);
      setCopied(true);
      toast.success("HTML email copied — paste into Gmail/Outlook compose");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't access clipboard — try opening in a new tab instead.");
    }
  };

  const handleOpenNewTab = () => {
    if (!data) return;
    // Open a blank window and write the HTML so the broker can use Ctrl+A →
    // copy, save the page, or print it. We can't use a data: URL because
    // some browsers block top-level data: navigation.
    const w = window.open("", "_blank");
    if (!w) {
      toast.error("Pop-up blocked — allow pop-ups for this site to use 'Open in new tab'.");
      return;
    }
    w.document.open();
    w.document.write(data.html);
    w.document.close();
  };

  if (loading && !data) {
    return (
      <GlassCard className="overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-border/50 bg-gradient-to-r from-emerald-500/10 to-transparent px-6 py-4">
          <Mail className="size-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm font-medium text-foreground">{t("digest.emailPreview")}</span>
          <Loader2 className="ml-auto size-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="space-y-3 p-6">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </GlassCard>
    );
  }

  if (error && !data) {
    return (
      <GlassCard className="p-6">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{t("digest.couldNotLoadEmail")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{error}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setManualTrigger((n) => n + 1)}>
              <RefreshCw className="mr-1.5 size-4" />
              {t("common.tryAgain")}
            </Button>
          </div>
        </div>
      </GlassCard>
    );
  }

  if (!data) return null;

  return (
    <GlassCard className="overflow-hidden p-0">
      {/* Header — actions */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-gradient-to-r from-emerald-500/10 to-transparent px-6 py-3">
        <Mail className="size-4 text-emerald-600 dark:text-emerald-400" />
        <span className="text-sm font-medium text-foreground">{t("digest.emailPreview")}</span>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">
          · standalone HTML · inline CSS · ready to paste into any email client
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleCopyHtml}>
            {copied ? (
              <>
                <CheckCircle2 className="mr-1.5 size-3.5 text-emerald-600 dark:text-emerald-400" />
                {t("common.copied")}
              </>
            ) : (
              <>
                <Copy className="mr-1.5 size-3.5" />
                {t("digest.copyHtml")}
              </>
            )}
          </Button>
          <Button size="sm" variant="outline" onClick={handleOpenNewTab}>
            <ExternalLink className="mr-1.5 size-3.5" />
            {t("digest.openInNewTab")}
          </Button>
        </div>
      </div>

      {/* iframe preview — sandboxed for safety; srcDoc renders the HTML string
          directly so we don't need a separate fetch round-trip. */}
      <div className="bg-card/30 p-3 sm:p-4">
        <iframe
          title="Daily digest email preview"
          srcDoc={data.html}
          sandbox="allow-same-origin"
          className="h-[640px] w-full rounded-xl border border-border/60 bg-white"
        />
      </div>

      <div className="border-t border-border/50 bg-card/20 px-6 py-2.5">
        <p className="text-[11px] text-muted-foreground">
          Tip: Use <span className="font-medium text-foreground">Copy HTML</span> to paste the source into an email
          client that supports HTML compose, or <span className="font-medium text-foreground">Open in new tab</span> to
          render the email in your browser for screen-capture or print-to-PDF.
        </p>
      </div>
    </GlassCard>
  );
}
