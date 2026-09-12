"use client";

import * as React from "react";
import {
  Settings as SettingsIcon, Save, AlertCircle, Database, Download,
  Percent, Receipt, BadgePercent, ShieldCheck, FileText, RotateCcw,
  BellRing, Printer, ImageIcon, HardDrive, Upload, AlertTriangle,
  Shield, Clock, Loader2, Sparkles, Lightbulb, Mail, Coffee, ArrowRight,
  Calendar, Zap, RefreshCw, Timer, Coins, Languages, Send,
  CloudOff, Wifi, CheckCircle2, Inbox,
} from "lucide-react";
import { useApi, api } from "@/lib/api";
import { useUI } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { GlassCard, SectionHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { CURRENCIES, getCurrency, formatConversionPreview } from "@/lib/currency";
import { useCurrency } from "@/lib/currency-store";
import { useTranslation } from "@/hooks/use-translation";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { LOCALE_OPTIONS, type Locale } from "@/lib/i18n";

type SettingRow = {
  id: string;
  key: string;
  value: string;
  notes: string | null;
};

type SettingsResponse = {
  settings: SettingRow[];
  defaults: {
    defaultGstRate: number;
    defaultCommissionRate: number;
    brokerageOnGst: boolean;
    autoGenerateNotifications: boolean;
    autoBackupEnabled: boolean;
    lastBackupAt: string | null;
    autoDigestEnabled: boolean;
    digestEmail: string;
    // Sprint 3 — outbound email notification digest
    emailNotificationsEnabled: boolean;
    emailDigestFrequency: string;
    emailAddress: string;
  };
};

type ParsedBackup = {
  version: number;
  exportedAt?: string;
  tables: Record<string, unknown[]>;
  bytes: number;
};

type RestoreResponse = {
  success?: boolean;
  error?: string;
  sourceExportedAt?: string | null;
  counts?: Record<string, number>;
};

type PhotoStats = {
  count: number;
  totalSizeBytes: number;
  totalSizeMB: number;
};

// Scheduler mini-service health status (proxied via /api/scheduler).
// `status: "offline"` is returned when the scheduler service on port 3004 is
// unreachable — the UI renders an "Offline" badge in that case.
type SchedulerStatus = {
  status: "ok" | "offline";
  lastRun: string | null;
  nextRun: string | null;
  totalRuns: number;
  lastResult: {
    generated: number;
    skipped?: boolean;
    details: Record<string, number>;
  } | null;
};

const EXPORT_LINKS: { type: string; label: string; icon: React.ReactNode }[] = [
  { type: "clients", label: "Clients", icon: <Database className="size-4" /> },
  { type: "suppliers", label: "Suppliers", icon: <Database className="size-4" /> },
  { type: "pos", label: "Purchase Orders", icon: <FileText className="size-4" /> },
  { type: "bills", label: "Bills", icon: <Receipt className="size-4" /> },
  { type: "payments", label: "Payments", icon: <Receipt className="size-4" /> },
  { type: "brokerage", label: "Brokerage", icon: <BadgePercent className="size-4" /> },
  { type: "audit", label: "Audit Trail", icon: <FileText className="size-4" /> },
];

const PDF_REPORTS: { href: string; label: string; hint: string; icon: React.ReactNode }[] = [
  {
    href: "/api/reports?type=brokerage-statement&range=all",
    label: "Brokerage Statement",
    hint: "Monthly earnings, eligibility & payouts (all-time).",
    icon: <BadgePercent className="size-4" />,
  },
  {
    href: "",
    label: "Client Ledger",
    hint: "Open any client and click “Print ledger” in the sheet header.",
    icon: <Receipt className="size-4" />,
  },
  {
    href: "",
    label: "Supplier Summary",
    hint: "Open any supplier and click “Print summary” in the sheet header.",
    icon: <Database className="size-4" />,
  },
];

const BUSINESS_RULES: {
  icon: React.ReactNode;
  title: string;
  body: string;
  tone: "emerald" | "amber" | "teal" | "rose";
}[] = [
  {
    icon: <BadgePercent className="size-4" />,
    title: "Brokerage excludes GST",
    body: "Brokerage is always computed on the bill's base amount (PO value − short-shipment − returns), never on the GST component.",
    tone: "emerald",
  },
  {
    icon: <ShieldCheck className="size-4" />,
    title: "Eligible only on full payment",
    body: "A brokerage entry stays 'accrued' until the linked bill is fully paid. The moment status becomes fully_paid, brokerage auto-flips to 'eligible'.",
    tone: "teal",
  },
  {
    icon: <RotateCcw className="size-4" />,
    title: "Payout follows client cadence",
    body: "Eligible brokerages are batched into a payout following the client's cadence — immediate, 4-month cumulative, or 12-month cumulative.",
    tone: "amber",
  },
  {
    icon: <Percent className="size-4" />,
    title: "Commission set per supplier",
    body: "Each supplier has a default commission % (defaults to 5%). It can be overridden per booking/PO at record time; the snapshot is used for brokerage.",
    tone: "emerald",
  },
  {
    icon: <Receipt className="size-4" />,
    title: "Adjustments before GST & brokerage",
    body: "Short-shipment and resolved defective returns reduce the base amount BEFORE GST and brokerage are computed — never after.",
    tone: "rose",
  },
];

const BACKUP_TABLE_LABELS: { key: string; label: string }[] = [
  { key: "clients", label: "Clients" },
  { key: "suppliers", label: "Suppliers" },
  { key: "visits", label: "Visits" },
  { key: "bookings", label: "Bookings" },
  { key: "bookingLineItems", label: "Booking line items" },
  { key: "purchaseOrders", label: "Purchase orders" },
  { key: "dispatchDateLogs", label: "Dispatch date logs" },
  { key: "dispatches", label: "Dispatches" },
  { key: "bills", label: "Bills" },
  { key: "payments", label: "Payments" },
  { key: "brokerages", label: "Brokerages" },
  { key: "brokeragePayouts", label: "Brokerage payouts" },
  { key: "disputes", label: "Disputes" },
  { key: "photos", label: "Photos" },
  { key: "notifications", label: "Notifications" },
  { key: "auditLogs", label: "Audit logs" },
  { key: "systemSettings", label: "System settings" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "Never";
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon} month${mon === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function parseBackupFile(text: string, fileName: string, fileSize: number): { ok: true; backup: ParsedBackup } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: `"${fileName}" is not valid JSON.` };
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { ok: false, error: "Backup file must be a JSON object." };
  }
  const obj = json as Record<string, unknown>;
  if (obj.version !== 1) {
    return { ok: false, error: `Unsupported backup version (expected 1, got ${String(obj.version)}).` };
  }
  if (typeof obj.tables !== "object" || obj.tables === null || Array.isArray(obj.tables)) {
    return { ok: false, error: "Backup file is missing the 'tables' object." };
  }
  const tables = obj.tables as Record<string, unknown>;
  for (const t of BACKUP_TABLE_LABELS) {
    if (!Array.isArray(tables[t.key])) {
      return { ok: false, error: `Backup file is missing the "${t.key}" table.` };
    }
  }
  return {
    ok: true,
    backup: {
      version: 1,
      exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : undefined,
      tables: tables as Record<string, unknown[]>,
      bytes: fileSize,
    },
  };
}

export function SettingsView() {
  const { data, loading, refresh } = useApi<SettingsResponse>("/api/settings");
  const { data: photoStats } = useApi<PhotoStats>("/api/photos/stats");
  const { setView } = useUI();
  const { t } = useTranslation();

  const [gstRate, setGstRate] = React.useState<string>("5");
  const [commissionRate, setCommissionRate] = React.useState<string>("5");
  const [brokerageOnGst, setBrokerageOnGst] = React.useState<boolean>(false);
  const [autoGen, setAutoGen] = React.useState<boolean>(true);
  const [saving, setSaving] = React.useState(false);
  const [seedOpen, setSeedOpen] = React.useState(false);
  const [seeding, setSeeding] = React.useState(false);

  // Onboarding replay / demo-load state
  const [replayOpen, setReplayOpen] = React.useState(false);
  const [replaying, setReplaying] = React.useState(false);
  const [loadDemoOpen, setLoadDemoOpen] = React.useState(false);
  const [loadingDemo, setLoadingDemo] = React.useState(false);

  // Backup / restore state
  const [downloading, setDownloading] = React.useState(false);
  const [autoBackup, setAutoBackup] = React.useState(false);
  const [autoBackupSaving, setAutoBackupSaving] = React.useState(false);
  const [restoreOpen, setRestoreOpen] = React.useState(false);
  const [restoring, setRestoring] = React.useState(false);
  const [parsedBackup, setParsedBackup] = React.useState<ParsedBackup | null>(null);
  const [fileInputKey, setFileInputKey] = React.useState(0);

  // Daily digest state
  const [autoDigest, setAutoDigest] = React.useState(true);
  const [autoDigestSaving, setAutoDigestSaving] = React.useState(false);
  const [digestEmail, setDigestEmail] = React.useState("");
  const [digestEmailSaving, setDigestEmailSaving] = React.useState(false);

  // Track the original loaded values so we can show a "dirty" indicator.
  const [original, setOriginal] = React.useState({ gstRate: "5", commissionRate: "5", brokerageOnGst: false, autoGen: true });

  React.useEffect(() => {
    if (!data) return;
    const g = String(data.defaults.defaultGstRate);
    const c = String(data.defaults.defaultCommissionRate);
    const b = data.defaults.brokerageOnGst;
    const a = data.defaults.autoGenerateNotifications;
    setGstRate(g);
    setCommissionRate(c);
    setBrokerageOnGst(b);
    setAutoGen(a);
    setAutoBackup(data.defaults.autoBackupEnabled);
    setAutoDigest(data.defaults.autoDigestEnabled);
    setDigestEmail(data.defaults.digestEmail ?? "");
    setOriginal({ gstRate: g, commissionRate: c, brokerageOnGst: b, autoGen: a });
  }, [data]);

  const dirty =
    gstRate !== original.gstRate ||
    commissionRate !== original.commissionRate ||
    brokerageOnGst !== original.brokerageOnGst ||
    autoGen !== original.autoGen;

  const save = async () => {
    const gstNum = Number(gstRate);
    const commNum = Number(commissionRate);
    if (!Number.isFinite(gstNum) || gstNum < 0 || gstNum > 100) {
      toast.error("Default GST rate must be a number between 0 and 100");
      return;
    }
    if (!Number.isFinite(commNum) || commNum < 0 || commNum > 100) {
      toast.error("Default commission rate must be a number between 0 and 100");
      return;
    }

    setSaving(true);
    const changes: { key: string; value: string; notes?: string }[] = [];
    if (gstRate !== original.gstRate) {
      changes.push({ key: "default_gst_rate", value: gstRate, notes: "Default GST % applied to bills." });
    }
    if (commissionRate !== original.commissionRate) {
      changes.push({ key: "default_commission_rate", value: commissionRate, notes: "Default broker commission %." });
    }
    if (brokerageOnGst !== original.brokerageOnGst) {
      changes.push({ key: "brokerage_on_gst", value: brokerageOnGst ? "true" : "false", notes: "Brokerage is computed on base amount, excluding GST." });
    }
    if (autoGen !== original.autoGen) {
      changes.push({ key: "auto_generate_notifications", value: autoGen ? "true" : "false", notes: "Auto-generate reminders on dashboard load and on-demand." });
    }

    if (changes.length === 0) {
      toast.info("Nothing to save — no changes detected.");
      setSaving(false);
      return;
    }

    try {
      for (const c of changes) {
        await api("/api/settings", { method: "POST", body: JSON.stringify(c) });
      }
      toast.success(`Saved ${changes.length} setting${changes.length > 1 ? "s" : ""}`);
      setOriginal({ gstRate, commissionRate, brokerageOnGst, autoGen });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const runSeed = async () => {
    setSeeding(true);
    try {
      const res = await api<{ ok: boolean; message?: string; error?: string }>("/api/seed", { method: "POST" });
      if (res.ok) {
        toast.success("Database re-seeded. Refresh other views to see the fresh dataset.");
        setSeedOpen(false);
        refresh();
      } else {
        toast.error(res.error ?? "Re-seed failed");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Re-seed failed");
    } finally {
      setSeeding(false);
    }
  };

  // ── Onboarding handlers ───────────────────────────────────────────────────
  // POST /api/onboarding { action: "reset" } clears the `onboarding_completed`
  // setting so the wizard shows again on the next page load.
  const runReplay = async () => {
    setReplaying(true);
    try {
      await api<{ ok: boolean }>("/api/onboarding", {
        method: "POST",
        body: JSON.stringify({ action: "reset" }),
      });
      toast.success("Onboarding reset — reloading…");
      setReplayOpen(false);
      // Hard reload so the wizard overlay re-appears (page.tsx checks
      // /api/onboarding on mount).
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reset onboarding");
      setReplaying(false);
    }
  };

  // POST /api/onboarding { action: "load_demo" } re-runs the seed script AND
  // marks onboarding complete in one shot. Useful for testing without having
  // to walk through the wizard.
  const runLoadDemo = async () => {
    setLoadingDemo(true);
    try {
      const res = await api<{ ok: boolean; error?: string; message?: string }>(
        "/api/onboarding",
        { method: "POST", body: JSON.stringify({ action: "load_demo" }) },
      );
      if (res.ok) {
        toast.success(res.message ?? "Demo data loaded — reloading…");
        setLoadDemoOpen(false);
        setTimeout(() => window.location.reload(), 1200);
      } else {
        toast.error(res.error ?? "Load demo failed");
        setLoadingDemo(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load demo failed");
      setLoadingDemo(false);
    }
  };

  // ── Backup / restore handlers ─────────────────────────────────────────────

  const handleDownload = async () => {
    setDownloading(true);
    try {
      // Use a fetch + blob + anchor click so we know when the download
      // finishes (so we can refresh `lastBackupAt`) without leaving the page.
      const res = await fetch("/api/backup", { method: "GET" });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Backup failed (${res.status}): ${txt}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = (() => {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      })();
      a.download = `broker-os-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded — full DB snapshot saved.");
      // Give the audit log a tick to land, then refresh settings so the
      // "Last backup" timestamp updates.
      setTimeout(() => void refresh(), 400);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backup download failed");
    } finally {
      setDownloading(false);
    }
  };

  const toggleAutoBackup = async (next: boolean) => {
    setAutoBackup(next);
    setAutoBackupSaving(true);
    try {
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          key: "auto_backup_enabled",
          value: next ? "true" : "false",
          notes: "When enabled, a backup file will be downloaded automatically once per day when the app is opened.",
        }),
      });
      toast.success(`Auto-backup ${next ? "enabled" : "disabled"}`);
      refresh();
    } catch (e) {
      // Revert on failure
      setAutoBackup(!next);
      toast.error(e instanceof Error ? e.message : "Failed to save auto-backup setting");
    } finally {
      setAutoBackupSaving(false);
    }
  };

  // Daily digest auto-generate toggle — immediately persists.
  const toggleAutoDigest = async (next: boolean) => {
    setAutoDigest(next);
    setAutoDigestSaving(true);
    try {
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          key: "auto_digest_enabled",
          value: next ? "true" : "false",
          notes: "When enabled, the AI brief generates automatically when you open the Digest view.",
        }),
      });
      toast.success(`Daily digest auto-generate ${next ? "enabled" : "disabled"}`);
      refresh();
    } catch (e) {
      setAutoDigest(!next);
      toast.error(e instanceof Error ? e.message : "Failed to save digest setting");
    } finally {
      setAutoDigestSaving(false);
    }
  };

  // Digest recipient email — save on blur (or Enter) so the broker can type
  // freely without a "Save changes" round-trip per keystroke.
  const saveDigestEmail = async () => {
    const trimmed = digestEmail.trim();
    // Light validation — empty string is allowed (clears the value).
    if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Enter a valid email address (e.g. broker@example.com)");
      return;
    }
    // Skip the round-trip if nothing actually changed vs. the loaded value.
    if (trimmed === (data?.defaults.digestEmail ?? "")) return;
    setDigestEmailSaving(true);
    try {
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          key: "digest_email",
          value: trimmed,
          notes: "Recipient email for future automated daily digest delivery.",
        }),
      });
      toast.success(trimmed ? "Digest email saved" : "Digest email cleared");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save digest email");
    } finally {
      setDigestEmailSaving(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const result = parseBackupFile(text, file.name, file.size);
    if (!result.ok) {
      toast.error(result.error);
      // Reset the input so the same file can be re-selected later.
      setFileInputKey((k) => k + 1);
      setParsedBackup(null);
      return;
    }
    setParsedBackup(result.backup);
    toast.info(`Backup loaded — ${formatBytes(file.size)}, ${BACKUP_TABLE_LABELS.reduce((s, t) => s + ((result.backup.tables[t.key]?.length as number) ?? 0), 0)} rows total. Review and confirm below.`);
  };

  const openRestoreConfirm = () => {
    if (!parsedBackup) {
      toast.error("Select a backup file first.");
      return;
    }
    setRestoreOpen(true);
  };

  const handleRestore = async () => {
    if (!parsedBackup) return;
    setRestoring(true);
    try {
      // Send the parsed JSON as the request body (raw JSON).
      const payload = JSON.stringify({
        version: parsedBackup.version,
        exportedAt: parsedBackup.exportedAt,
        tables: parsedBackup.tables,
      });
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      const data = await res.json().catch(() => ({})) as RestoreResponse;
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? `Restore failed (HTTP ${res.status})`);
      }
      toast.success("Backup restored — reloading…");
      setRestoreOpen(false);
      // Wait 1.5s for the toast to land, then hard reload so all
      // client-side cached state is reset.
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed");
      setRestoring(false);
    }
  };

  const cancelRestore = () => {
    if (restoring) return; // no cancel mid-restore
    setRestoreOpen(false);
  };

  const clearSelectedBackup = () => {
    setParsedBackup(null);
    setFileInputKey((k) => k + 1);
  };

  const lastBackupAt = data?.defaults.lastBackupAt ?? null;

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("settings.title")}
        description={t("settings.subtitle")}
        action={
          <Button size="sm" onClick={save} disabled={saving || !dirty}>
            <Save className="mr-1.5 size-4" />
            {saving ? t("common.saving") : t("common.saveChanges")}
          </Button>
        }
      />

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Card 1 — System defaults form */}
          <GlassCard className="hover-lift p-6">
            <div className="flex items-center gap-2.5">
              <div className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
                <SettingsIcon className="size-4.5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">{t("settings.systemDefaults")}</h3>
                <p className="text-xs text-muted-foreground">Default rates applied when no per-party override exists.</p>
              </div>
            </div>

            <div className="mt-5 space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="gst-rate" className="text-xs font-medium text-muted-foreground">
                  Default GST rate (%)
                </Label>
                <Input
                  id="gst-rate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={gstRate}
                  onChange={(e) => setGstRate(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Applied to new bills when no client/supplier GST rate is set.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="comm-rate" className="text-xs font-medium text-muted-foreground">
                  Default commission rate (%)
                </Label>
                <Input
                  id="comm-rate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={commissionRate}
                  onChange={(e) => setCommissionRate(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Default broker commission % — overridden by per-supplier rates.
                </p>
              </div>

              <div className="flex items-start justify-between gap-3 rounded-xl border border-border/50 bg-card/30 p-3">
                <div className="min-w-0 space-y-1">
                  <Label htmlFor="brokerage-gst" className="text-xs font-medium text-muted-foreground">
                    Brokerage on GST
                  </Label>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Brokerage is always computed on the base amount <span className="font-semibold text-foreground">excluding GST</span>.
                    Toggle is informational only — the rule is enforced system-wide.
                  </p>
                </div>
                <Switch
                  id="brokerage-gst"
                  checked={brokerageOnGst}
                  onCheckedChange={setBrokerageOnGst}
                  aria-label="Brokerage on GST"
                />
              </div>

              <div className="flex items-start justify-between gap-3 rounded-xl border border-border/50 bg-card/30 p-3">
                <div className="min-w-0 space-y-1">
                  <Label htmlFor="auto-gen" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <BellRing className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                    {t("settings.autoGenerateReminders")}
                  </Label>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    When enabled, the dashboard fires a background scan on load that creates pending notifications for overdue visits, upcoming dispatches (≤ 7d), due payments (≤ 14d), and eligible brokerage payouts. The Notifications view always allows manual generation.
                  </p>
                </div>
                <Switch
                  id="auto-gen"
                  checked={autoGen}
                  onCheckedChange={setAutoGen}
                  aria-label="Auto-generate reminders"
                />
              </div>

              {dirty && (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-700 dark:text-amber-300">
                  <AlertCircle className="size-3" />
                  Unsaved changes — click “Save changes” to persist.
                </div>
              )}
            </div>
          </GlassCard>

          {/* Card 2 — Business rules reference */}
          <GlassCard className="hover-lift p-6">
            <div className="flex items-center gap-2.5">
              <div className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
                <ShieldCheck className="size-4.5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">{t("settings.businessRules")}</h3>
                <p className="text-xs text-muted-foreground">Core financial rules enforced across the system (§7).</p>
              </div>
            </div>

            <ul className="mt-5 space-y-3">
              {BUSINESS_RULES.map((rule) => (
                <RuleRow key={rule.title} {...rule} />
              ))}
            </ul>
          </GlassCard>
        </div>
      )}

      {/* Card — Display currency (multi-currency display layer) */}
      <DisplayCurrencyCard />

      {/* Card — Interface language (i18n) */}
      <LanguageCard />

      {/* Card 3 — Data management */}
      <GlassCard className="hover-lift p-6">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
            <Database className="size-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t("settings.dataManagement")}</h3>
            <p className="text-xs text-muted-foreground">Export data as CSV or reset the demo dataset.</p>
          </div>
        </div>

        {/* Photo storage mini-stat — full-res originals + 400px JPEG thumbnails under public/uploads */}
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="glass flex items-center gap-3 rounded-xl border border-border/50 p-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <ImageIcon className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Photos</p>
              <p className="kpi-num text-base font-semibold text-foreground">
                {photoStats ? photoStats.count : "—"}
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                  {photoStats && photoStats.count === 1 ? "record" : "records"}
                </span>
              </p>
            </div>
          </div>
          <div className="glass flex items-center gap-3 rounded-xl border border-border/50 p-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <HardDrive className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Storage used</p>
              <p className="kpi-num text-base font-semibold text-foreground">
                {photoStats ? `${photoStats.totalSizeMB} MB` : "—"}
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                  {photoStats ? `(${photoStats.totalSizeBytes.toLocaleString()} bytes)` : "in /uploads"}
                </span>
              </p>
            </div>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Originals are stored full-resolution in <code className="rounded bg-card/60 px-1 py-0.5 text-[10px]">public/uploads/</code>;
          a 400&nbsp;px JPEG thumbnail (q80) is generated on upload for fast gallery loading.
        </p>

        <div className="mt-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Export data (CSV)</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {EXPORT_LINKS.map((link) => (
              <a
                key={link.type}
                href={`/api/export?type=${link.type}`}
                target="_blank"
                rel="noopener noreferrer"
                className="glass hover-lift inline-flex items-center gap-2 rounded-xl border border-border/50 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:text-primary"
              >
                {link.icon}
                <span className="truncate">{link.label}</span>
                <Download className="ml-auto size-3 text-muted-foreground" />
              </a>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Print-ready PDF reports</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Opens a print-optimized page in a new tab — the browser's print dialog auto-launches, where you can choose “Save as PDF” as the destination.
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {PDF_REPORTS.map((r) => {
              const isLink = r.href.length > 0;
              const cls = "glass hover-lift inline-flex items-start gap-2 rounded-xl border border-border/50 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:text-primary";
              const inner = (
                <>
                  <span className="mt-0.5 text-emerald-600 dark:text-emerald-400">{r.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{r.label}</span>
                    <span className="block text-[10px] font-normal leading-snug text-muted-foreground">{r.hint}</span>
                  </span>
                  <Printer className="ml-auto size-3 shrink-0 text-muted-foreground" />
                </>
              );
              return isLink ? (
                <a key={r.label} href={r.href} target="_blank" rel="noopener noreferrer" className={cls}>
                  {inner}
                </a>
              ) : (
                <span key={r.label} className={`${cls} cursor-default opacity-80`}>
                  {inner}
                </span>
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-border/50 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Re-seed database</p>
            <p className="text-[11px] text-muted-foreground">
              Wipes <span className="font-semibold">all</span> current data and writes a fresh demo dataset. Use only in development.
            </p>
          </div>
          <Button
            variant="outline"
            className="border-rose-500/30 text-rose-600 hover:text-rose-500 dark:text-rose-400"
            onClick={() => setSeedOpen(true)}
          >
            <RotateCcw className="mr-1.5 size-4" />Re-seed
          </Button>
        </div>
      </GlassCard>

      {/* Card 5 — Daily Digest */}
      <GlassCard className="hover-lift p-6">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <Coffee className="size-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t("settings.dailyDigest")}</h3>
            <p className="text-xs text-muted-foreground">{t("settings.dailyDigestHint")}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {/* Auto-generate toggle */}
          <div className="glass flex flex-col gap-3 rounded-xl border border-border/50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <Label htmlFor="auto-digest" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Coffee className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  {t("settings.autoGenerateDigest")}
                </Label>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  When enabled, the AI brief generates automatically when you open the Digest view. Disable if you prefer to generate on-demand.
                </p>
              </div>
              <Switch
                id="auto-digest"
                checked={autoDigest}
                onCheckedChange={toggleAutoDigest}
                disabled={autoDigestSaving}
                aria-label="Auto-generate daily digest"
              />
            </div>
            <Button
              variant="outline"
              className="w-full border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200"
              onClick={() => setView("digest")}
            >
              <Mail className="mr-1.5 size-4" />
              {t("settings.generateNow")}
              <ArrowRight className="ml-1.5 size-3.5" />
            </Button>
          </div>

          {/* Recipient email */}
          <div className="glass flex flex-col gap-3 rounded-xl border border-border/50 p-4">
            <div className="space-y-1">
              <Label htmlFor="digest-email" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Mail className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                Send digest to
              </Label>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Email address to receive the daily digest automatically (future enhancement).
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                id="digest-email"
                type="email"
                placeholder="broker@example.com"
                value={digestEmail}
                onChange={(e) => setDigestEmail(e.target.value)}
                onBlur={saveDigestEmail}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                disabled={digestEmailSaving}
                className="text-sm"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={saveDigestEmail}
                disabled={digestEmailSaving}
                className="shrink-0"
              >
                {digestEmailSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                <span className="sr-only">Save email</span>
              </Button>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Email sending coming soon — for now, use the <span className="font-semibold">Copy</span> buttons in the Digest view.
              </span>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Card 5b — Email Notifications (outbound email digest plumbing) */}
      <EmailNotificationsCard />

      {/* Card 6 — Notification Scheduler */}
      <SchedulerCard />

      {/* Card 6b — Network Status (online/offline + draft sync queue).
          Sprint 4 — surfaces the same `useOnlineStatus` + `useOfflineSync`
          state that drives the header indicator, but with full context
          (last sync timestamp, manual sync trigger, jump-to-draft-queue)
          for brokers who want a deeper view than the compact header badge. */}
      <NetworkStatusCard />

      {/* Card 7 — Onboarding & help */}
      <GlassCard className="hover-lift p-6">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t("settings.onboardingHelp")}</h3>
            <p className="text-xs text-muted-foreground">{t("settings.onboardingHelpHint")}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {/* Replay onboarding */}
          <div className="glass flex flex-col gap-3 rounded-xl border border-border/50 p-4">
            <div className="flex items-start gap-2.5">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <RotateCcw className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{t("settings.replayOnboarding")}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  Re-opens the welcome wizard so you can walk through the guided setup again.
                  No data is touched — only the onboarding flag is reset.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="border-emerald-500/30 text-emerald-700 hover:text-emerald-600 dark:text-emerald-300 dark:hover:text-emerald-200"
              onClick={() => setReplayOpen(true)}
            >
              <Sparkles className="mr-1.5 size-4" />
              {t("settings.replayOnboarding")}
            </Button>
          </div>

          {/* Load demo data */}
          <div className="glass flex flex-col gap-3 rounded-xl border border-border/50 p-4">
            <div className="flex items-start gap-2.5">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <Database className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{t("settings.loadDemoData")}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  Wipes all current data and writes a fresh demo dataset, then marks onboarding
                  complete. Handy for testing without walking through the wizard.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="border-rose-500/30 text-rose-600 hover:text-rose-500 dark:text-rose-400"
              onClick={() => setLoadDemoOpen(true)}
            >
              <Database className="mr-1.5 size-4" />
              {t("settings.loadDemoData")}
            </Button>
          </div>
        </div>

        {/* Inline quick-tips reference */}
        <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2">
            <Lightbulb className="size-4 text-emerald-600 dark:text-emerald-400" />
            <p className="text-xs font-semibold text-foreground">Quick tips</p>
          </div>
          <ul className="mt-2.5 grid gap-2 sm:grid-cols-2">
            <li className="text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">⌘K</span> — open the command palette to find any client, PO, or bill.
            </li>
            <li className="text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Click any KPI card</span> — drill into the filtered list.
            </li>
            <li className="text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Action Center</span> — see what needs your attention today.
            </li>
            <li className="text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Upload photos</span> at every stage for a complete audit trail.
            </li>
          </ul>
        </div>
      </GlassCard>

      {/* Restore confirmation — explicit AlertDialog to prevent accidental data loss */}
      <AlertDialog
        open={restoreOpen}
        onOpenChange={(o) => { if (!o && !restoring) setRestoreOpen(false); }}
      >
        <AlertDialogContent className="glass-strong max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore from this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently replace ALL current data with the contents of the selected backup file. The action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {parsedBackup && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[11px] text-rose-700 dark:text-rose-300">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="size-3.5" />
                Restore preview
              </div>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                <dt className="opacity-80">Exported at</dt>
                <dd className="font-medium">{formatDateTime(parsedBackup.exportedAt)}</dd>
                <dt className="opacity-80">File size</dt>
                <dd className="font-medium">{formatBytes(parsedBackup.bytes)}</dd>
                <dt className="opacity-80">Total rows</dt>
                <dd className="font-medium">
                  {BACKUP_TABLE_LABELS.reduce(
                    (s, t) => s + ((parsedBackup.tables[t.key]?.length as number) ?? 0),
                    0,
                  )}
                </dd>
              </dl>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={(e) => { e.preventDefault(); void handleRestore(); }}
              disabled={restoring}
            >
              {restoring ? "Restoring…" : "Restore — replace all data"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Re-seed confirm */}
      <AlertDialog open={seedOpen} onOpenChange={setSeedOpen}>
        <AlertDialogContent className="glass-strong max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Re-seed database?</AlertDialogTitle>
            <AlertDialogDescription>
              This will erase all current data (clients, suppliers, POs, bills, payments, brokerage, disputes, audit logs) and replace it with a fresh demo dataset. The action is irreversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[11px] text-rose-700 dark:text-rose-300">
            <AlertCircle className="mr-1 inline size-3.5" />
            Make sure no one else is actively working in the system — running this mid-session will invalidate their data.
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={seeding}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={(e) => { e.preventDefault(); void runSeed(); }}
              disabled={seeding}
            >
              {seeding ? "Seeding…" : "Yes, re-seed everything"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Replay onboarding confirm — low-risk (only clears a setting), but
          we confirm because the page will hard-reload. */}
      <AlertDialog open={replayOpen} onOpenChange={(o) => { if (!o && !replaying) setReplayOpen(false); }}>
        <AlertDialogContent className="glass-strong max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Replay the onboarding wizard?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reset the onboarding flag and reload the page so the welcome wizard
              appears again. None of your clients, suppliers, or other data will be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={replaying}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={(e) => { e.preventDefault(); void runReplay(); }}
              disabled={replaying}
            >
              {replaying ? "Resetting…" : "Replay onboarding"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Load demo data confirm — destructive (wipes all data) */}
      <AlertDialog open={loadDemoOpen} onOpenChange={(o) => { if (!o && !loadingDemo) setLoadDemoOpen(false); }}>
        <AlertDialogContent className="glass-strong max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Load demo data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will erase <span className="font-semibold">all</span> current data and write a
              fresh demo dataset (same as re-seeding), then mark onboarding complete. The action is
              irreversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[11px] text-rose-700 dark:text-rose-300">
            <AlertCircle className="mr-1 inline size-3.5" />
            Useful for testing the wizard end-to-end without walking through it manually.
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loadingDemo}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={(e) => { e.preventDefault(); void runLoadDemo(); }}
              disabled={loadingDemo}
            >
              {loadingDemo ? "Loading…" : "Yes, load demo data"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RuleRow({
  icon,
  title,
  body,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  tone: "emerald" | "amber" | "teal" | "rose";
}) {
  const toneWrap: Record<string, string> = {
    emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    teal: "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/30",
    rose: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
  };
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border/40 bg-card/30 p-3">
      <div className={`grid size-8 shrink-0 place-items-center rounded-lg border ${toneWrap[tone]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EmailNotificationsCard — outbound email digest settings + "Send test email".
//
// Wires three SystemSetting keys (all surfaced via GET /api/settings → defaults):
//   • email_notifications_enabled (Switch — default false)
//   • email_digest_frequency     (Select — daily | weekly | monthly, default daily)
//   • email_address              (Input — defaults to broker's profile email)
//
// The "Send test email" button calls POST /api/notifications/email, which
// gathers all PENDING notifications for this broker, generates an HTML email
// body (inline CSS, emerald accent — see src/lib/email-templates.ts), writes
// an AuditLog entry, and returns the HTML for preview. Email SENDING requires
// SMTP/Resend integration — the route is fully built; once SMTP credentials
// are added the same endpoint will deliver the email. Until then, the broker
// can use "Send test email" to verify the digest content + recipient.
//
// The hourly scheduler mini-service also calls /api/notifications/email after
// generating notifications, so when this toggle is ON the broker automatically
// gets an email digest whenever new pending reminders appear.
// ─────────────────────────────────────────────────────────────────────────────
type EmailDigestResponse = {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  count?: number;
  email?: { to: string; subject: string; html: string; textLength: number };
  note?: string;
};

const EMAIL_FREQUENCY_OPTIONS: { value: string; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

function EmailNotificationsCard() {
  const { data } = useApi<SettingsResponse>("/api/settings");
  // Local mirrors of the three settings — updated instantly on toggle / blur.
  const [enabled, setEnabled] = React.useState(false);
  const [frequency, setFrequency] = React.useState("daily");
  const [emailAddress, setEmailAddress] = React.useState("");
  const [emailOriginal, setEmailOriginal] = React.useState({ enabled: false, frequency: "daily", emailAddress: "" });

  // Persisting flags — disable controls while a single setting is saving.
  const [enabledSaving, setEnabledSaving] = React.useState(false);
  const [freqSaving, setFreqSaving] = React.useState(false);
  const [emailSaving, setEmailSaving] = React.useState(false);
  const [sending, setSending] = React.useState(false);

  React.useEffect(() => {
    if (!data) return;
    const e = data.defaults.emailNotificationsEnabled;
    const f = data.defaults.emailDigestFrequency || "daily";
    const a = data.defaults.emailAddress ?? "";
    setEnabled(e);
    setFrequency(f);
    setEmailAddress(a);
    setEmailOriginal({ enabled: e, frequency: f, emailAddress: a });
  }, [data]);

  const persist = async (key: string, value: string, notes: string) => {
    await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({ key, value, notes }),
    });
  };

  const toggleEnabled = async (next: boolean) => {
    setEnabled(next);
    setEnabledSaving(true);
    try {
      await persist(
        "email_notifications_enabled",
        next ? "true" : "false",
        "When enabled, the broker receives an email digest of pending reminders (gated by the hourly scheduler).",
      );
      toast.success(`Email notifications ${next ? "enabled" : "disabled"}`);
      setEmailOriginal((o) => ({ ...o, enabled: next }));
    } catch (e) {
      setEnabled(!next);
      toast.error(e instanceof Error ? e.message : "Failed to save email setting");
    } finally {
      setEnabledSaving(false);
    }
  };

  const changeFrequency = async (next: string) => {
    const prev = frequency;
    setFrequency(next);
    setFreqSaving(true);
    try {
      await persist(
        "email_digest_frequency",
        next,
        "How often the broker wants an email digest of pending reminders (daily / weekly / monthly).",
      );
      toast.success(`Digest frequency set to ${next}`);
      setEmailOriginal((o) => ({ ...o, frequency: next }));
    } catch (e) {
      setFrequency(prev);
      toast.error(e instanceof Error ? e.message : "Failed to save frequency");
    } finally {
      setFreqSaving(false);
    }
  };

  const saveEmailAddress = async () => {
    const trimmed = emailAddress.trim();
    if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Enter a valid email address (e.g. broker@example.com)");
      return;
    }
    if (trimmed === emailOriginal.emailAddress) return;
    setEmailSaving(true);
    try {
      await persist(
        "email_address",
        trimmed,
        "Recipient email for the outbound notification digest. Falls back to the broker's profile email when blank.",
      );
      toast.success(trimmed ? "Email address saved" : "Email address cleared — will use broker profile email");
      setEmailOriginal((o) => ({ ...o, emailAddress: trimmed }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save email address");
    } finally {
      setEmailSaving(false);
    }
  };

  const sendTest = async () => {
    setSending(true);
    try {
      const res = await api<EmailDigestResponse>("/api/notifications/email", {
        method: "POST",
      });
      if (res.skipped) {
        toast.error(res.reason ?? "Email send skipped");
      } else if (res.success) {
        toast.success(
          `Email digest ready — ${res.count ?? 0} pending reminder${(res.count ?? 0) === 1 ? "" : "s"} → ${res.email?.to}`,
          { description: "HTML body generated. SMTP integration needed to actually deliver." },
        );
      } else {
        toast.error("Email send failed");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send test email");
    } finally {
      setSending(false);
    }
  };

  return (
    <GlassCard className="hover-lift p-6">
      <div className="flex items-center gap-2.5">
        <div className="grid size-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Mail className="size-4.5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Email Notifications</h3>
          <p className="text-xs text-muted-foreground">
            Receive an email digest of pending reminders automatically (scheduler-driven).
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {/* Enable + frequency */}
        <div className="glass flex flex-col gap-4 rounded-xl border border-border/50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="email-notif" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <BellRing className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                Email notifications
              </Label>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                When enabled, the hourly scheduler also calls the email digest endpoint. You'll get an email summary of pending reminders instead of only seeing them in-app.
              </p>
            </div>
            <Switch
              id="email-notif"
              checked={enabled}
              onCheckedChange={toggleEnabled}
              disabled={enabledSaving}
              aria-label="Email notifications"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email-freq" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Clock className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              Digest frequency
            </Label>
            <Select
              value={frequency}
              onValueChange={changeFrequency}
              disabled={freqSaving}
            >
              <SelectTrigger id="email-freq" className="w-full">
                <SelectValue placeholder="Select frequency" />
              </SelectTrigger>
              <SelectContent>
                {EMAIL_FREQUENCY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              How often the broker wants the digest emailed (the scheduler currently runs hourly — the frequency gates which scheduled runs trigger an email).
            </p>
          </div>
        </div>

        {/* Recipient email + send test */}
        <div className="glass flex flex-col gap-3 rounded-xl border border-border/50 p-4">
          <div className="space-y-1">
            <Label htmlFor="email-addr" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Mail className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              Email address
            </Label>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Recipient for the outbound digest. Leave blank to use your broker profile email ({emailOriginal.emailAddress || "your login email"}).
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              id="email-addr"
              type="email"
              placeholder="broker@example.com"
              value={emailAddress}
              onChange={(e) => setEmailAddress(e.target.value)}
              onBlur={saveEmailAddress}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              disabled={emailSaving}
              className="text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={saveEmailAddress}
              disabled={emailSaving}
              className="shrink-0"
            >
              {emailSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              <span className="sr-only">Save email</span>
            </Button>
          </div>

          <Button
            variant="outline"
            className="w-full border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200"
            onClick={sendTest}
            disabled={sending}
          >
            {sending ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Send className="mr-1.5 size-4" />}
            {sending ? "Generating…" : "Send test email"}
          </Button>

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Email sending requires SMTP integration. Enable to receive digests of pending reminders — the HTML body is ready to send.
            </span>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SchedulerCard — Notification Scheduler status & controls.
//
// The scheduler runs as a separate bun project (mini-services/scheduler-service)
// on port 3004. It triggers `POST /api/notifications/generate` every hour so
// reminders stay fresh without the broker needing to open the dashboard.
//
// This card polls `/api/scheduler` (a server-to-server proxy to the scheduler's
// health endpoint) every 60 seconds. The "Run now" button hits the generate
// route directly for an immediate trigger, then re-fetches status so the
// lastRun/totalRuns counters update.
// ─────────────────────────────────────────────────────────────────────────────
function SchedulerCard() {
  const { t } = useTranslation();
  const [status, setStatus] = React.useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [running, setRunning] = React.useState(false);
  // Ticking state — refreshes the countdown to nextRun every second so the
  // "in 58 min" label stays accurate without re-fetching the API.
  const [, setTick] = React.useState(0);

  const fetchStatus = React.useCallback(async () => {
    try {
      const d = await api<SchedulerStatus>("/api/scheduler");
      setStatus(d);
    } catch {
      setStatus({ status: "offline", lastRun: null, nextRun: null, totalRuns: 0, lastResult: null });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchStatus();
    const id = setInterval(() => void fetchStatus(), 60_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // 1-second ticker to keep the countdown fresh between API polls.
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await api<{ generated: number; skipped?: boolean; details: Record<string, number> }>(
        "/api/notifications/generate",
        { method: "POST" },
      );
      toast.success(
        res.skipped
          ? "Auto-generation is disabled in Settings"
          : `Generated ${res.generated} new reminder${res.generated === 1 ? "" : "s"}`,
      );
      // Re-fetch scheduler status so lastRun/totalRuns update immediately.
      void fetchStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to run generation");
    } finally {
      setRunning(false);
    }
  };

  const isOffline = !loading && (!status || status.status !== "ok");
  const lastRun = status?.lastRun ?? null;
  const nextRun = status?.nextRun ?? null;
  const totalRuns = status?.totalRuns ?? 0;
  const lastGenerated = status?.lastResult?.generated ?? null;

  return (
    <GlassCard className="hover-lift p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <Timer className="size-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t("settings.notificationScheduler")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("settings.notificationSchedulerHint")}
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={
            isOffline
              ? "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          }
        >
          <span
            className={cn(
              "mr-1 inline-block size-1.5 rounded-full",
              isOffline ? "bg-rose-500" : "bg-emerald-500 animate-pulse",
            )}
          />
          {isOffline ? t("settings.offline") : t("settings.running")}
        </Badge>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Last run */}
        <div className="glass flex flex-col gap-1 rounded-xl border border-border/50 p-3">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Clock className="size-3" />
            Last run
          </div>
          <p className="text-sm font-medium text-foreground">
            {loading ? "…" : lastRun ? formatRelative(lastRun) : "Never"}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {lastRun ? formatDateTime(lastRun) : "Not run yet"}
          </p>
        </div>

        {/* Next run */}
        <div className="glass flex flex-col gap-1 rounded-xl border border-border/50 p-3">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Calendar className="size-3" />
            Next run
          </div>
          <p className="text-sm font-medium text-foreground">
            {loading ? "…" : nextRun ? formatCountdown(nextRun) : "—"}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {nextRun ? formatDateTime(nextRun) : "Pending"}
          </p>
        </div>

        {/* Total runs */}
        <div className="glass flex flex-col gap-1 rounded-xl border border-border/50 p-3">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <RefreshCw className="size-3" />
            Total runs
          </div>
          <p className="text-sm font-medium text-foreground">
            {loading ? "…" : totalRuns}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {totalRuns === 1 ? "scheduled run" : "scheduled runs"}
          </p>
        </div>

        {/* Last result */}
        <div className="glass flex flex-col gap-1 rounded-xl border border-border/50 p-3">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Zap className="size-3" />
            Last result
          </div>
          <p className="text-sm font-medium text-foreground">
            {loading ? "…" : lastGenerated === null ? "—" : `${lastGenerated}`}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {lastGenerated === null
              ? "No run yet"
              : status?.lastResult?.skipped
                ? "skipped (disabled)"
                : `notification${lastGenerated === 1 ? "" : "s"} generated`}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-border/50 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{t("settings.runNow")}</p>
          <p className="text-[11px] text-muted-foreground">
            Triggers an immediate scan — same as the hourly schedule. Idempotent, so safe to re-run.
          </p>
        </div>
        <Button
          variant="outline"
          className="border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200"
          onClick={runNow}
          disabled={running}
        >
          {running ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Zap className="mr-1.5 size-4" />}
          {running ? t("settings.running") : t("settings.runNow")}
        </Button>
      </div>
    </GlassCard>
  );
}

// Returns "in 23 min" / "in 1 hr 4 min" / "now" / "—" for an ISO timestamp.
function formatCountdown(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = t - Date.now();
  if (diff <= 0) return "now";
  const min = Math.floor(diff / 60000);
  if (min < 60) return `in ${min} min`;
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  return rem === 0 ? `in ${hr} hr` : `in ${hr} hr ${rem} min`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Display Currency card — lets the broker pick the currency in which all
// amounts are displayed across the app. The underlying ledger stays in INR;
// this is purely a display-layer conversion using the static exchange rates
// defined in `src/lib/currency.ts`. Choice is persisted to localStorage via
// the `useCurrency` Zustand store and applies instantly across all views.
// ─────────────────────────────────────────────────────────────────────────────
function DisplayCurrencyCard() {
  const currency = useCurrency((s) => s.currency);
  const setCurrency = useCurrency((s) => s.setCurrency);
  const { t } = useTranslation();

  const cur = getCurrency(currency);
  // Sample INR amount for the live preview — picked large enough to show the
  // K / L / M suffix in compact form and the 2-decimal precision in full form.
  const SAMPLE_INR = 61_215;

  return (
    <GlassCard className="hover-lift p-6">
      <div className="flex items-center gap-2.5">
        <div className="grid size-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Coins className="size-4.5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t("settings.displayCurrency")}</h3>
          <p className="text-xs text-muted-foreground">
            Convert all displayed amounts to a preferred currency — ledger stays in INR.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="display-currency" className="text-xs font-medium text-muted-foreground">
            Display currency
          </Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger id="display-currency" className="w-full">
              <SelectValue placeholder="Select currency" />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  <span className="font-mono font-semibold text-foreground">{c.symbol}</span>
                  <span className="ml-2 font-medium">{c.code}</span>
                  <span className="ml-1.5 text-muted-foreground">— {c.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Amounts are stored in INR and displayed in the selected currency using static exchange rates.
            Rates are approximate — for reference only.
          </p>
        </div>

        {/* Live preview row — updates instantly as the broker picks a currency.
            Shows both the INR source amount and the converted display amount,
            e.g. "₹61,215 = $734.58". */}
        <div className="flex flex-col gap-2 rounded-xl border border-border/50 bg-card/30 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Live preview
            </p>
            <p className="kpi-num mt-0.5 text-base font-semibold text-foreground">
              {formatConversionPreview(SAMPLE_INR, currency)}
            </p>
          </div>
          <div className="flex items-center gap-2 text-right text-[11px] text-muted-foreground">
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 font-mono text-emerald-700 dark:text-emerald-300"
            >
              {cur.symbol} {cur.code}
            </Badge>
            <span>1 INR = {cur.rate} {cur.code}</span>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NetworkStatusCard — online/offline + draft-sync queue dashboard.
//
// Surfaces the same `useOnlineStatus` + `useOfflineSync` state that drives
// the compact header indicator, but with full context for brokers who want
// the deeper view: current network status, pending-draft count, last sync
// timestamp, a manual "Sync now" trigger (gated by online + pending > 0),
// and a "View drafts" shortcut to the Draft Queue.
//
// The card mirrors the SchedulerCard pattern: header with status badge +
// a 3-stat grid (online status, pending count, last sync) + an action row.
// Emerald = online / healthy, amber = offline / pending, teal = syncing.
// ─────────────────────────────────────────────────────────────────────────────
function NetworkStatusCard() {
  const { isOnline } = useOnlineStatus();
  const { pendingCount, syncing, lastSync, syncNow } = useOfflineSync();
  const { setView } = useUI();
  const { t } = useTranslation();
  const [syncingNow, setSyncingNow] = React.useState(false);

  const handleSyncNow = async () => {
    setSyncingNow(true);
    try {
      await syncNow();
      toast.success(
        pendingCount === 0
          ? "No drafts to sync — queue is up to date."
          : `Sync pass complete.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncingNow(false);
    }
  };

  const lastSyncIso = lastSync ? lastSync.toISOString() : null;
  const isBusy = syncing || syncingNow;
  // "Sync now" is enabled only when there's something to sync AND the
  // browser is online. The Draft Queue view is always reachable.
  const canSyncNow = isOnline && pendingCount > 0 && !isBusy;

  return (
    <GlassCard className="hover-lift p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "grid size-9 place-items-center rounded-xl",
              isOnline
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
            )}
          >
            {isOnline ? <Wifi className="size-4.5" /> : <CloudOff className="size-4.5" />}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Network Status</h3>
            <p className="text-xs text-muted-foreground">
              Live connectivity + offline-draft sync queue. Drafts auto-sync when you reconnect.
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={
            isOnline
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
          }
        >
          <span
            className={cn(
              "mr-1 inline-block size-1.5 rounded-full",
              isOnline ? "bg-emerald-500 animate-pulse" : "bg-amber-500",
            )}
          />
          {isOnline ? "Online" : t("settings.offline")}
        </Badge>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {/* Status tile */}
        <div className="glass flex flex-col gap-1 rounded-xl border border-border/50 p-3">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {isOnline ? <Wifi className="size-3" /> : <CloudOff className="size-3" />}
            Status
          </div>
          <p
            className={cn(
              "text-sm font-medium",
              isOnline
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400",
            )}
          >
            {isOnline ? "Online" : "Offline"}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {isOnline ? "Submits hit the server live" : "Submits queue as drafts"}
          </p>
        </div>

        {/* Pending drafts tile */}
        <div className="glass flex flex-col gap-1 rounded-xl border border-border/50 p-3">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Inbox className="size-3" />
            Pending drafts
          </div>
          <p
            className={cn(
              "text-sm font-medium",
              pendingCount > 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-foreground",
            )}
          >
            {pendingCount}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {pendingCount === 0
              ? "Queue empty"
              : pendingCount === 1
                ? "1 draft waiting"
                : `${pendingCount} drafts waiting`}
          </p>
        </div>

        {/* Last sync tile */}
        <div className="glass col-span-2 flex flex-col gap-1 rounded-xl border border-border/50 p-3 sm:col-span-1">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <RefreshCw className="size-3" />
            Last sync
          </div>
          <p className="text-sm font-medium text-foreground">
            {isBusy ? "Syncing…" : formatRelative(lastSyncIso)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {lastSyncIso ? formatDateTime(lastSyncIso) : "No sync yet"}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-border/50 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Draft Queue</p>
          <p className="text-[11px] text-muted-foreground">
            {pendingCount > 0
              ? "Open the queue to review, retry, or discard pending drafts."
              : "No drafts queued — new entries appear here when submits can't reach the server."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void handleSyncNow()}
            disabled={!canSyncNow}
            className={cn(
              "border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200",
              !canSyncNow && "opacity-50",
            )}
          >
            {isBusy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <RefreshCw className="mr-1.5 size-4" />}
            {isBusy ? "Syncing…" : "Sync now"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setView("drafts")}
            className="border-amber-500/30 text-amber-700 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-300 dark:hover:bg-amber-500/10 dark:hover:text-amber-200"
          >
            <Inbox className="mr-1.5 size-4" />
            View drafts{pendingCount > 0 ? ` (${pendingCount})` : ""}
          </Button>
        </div>
      </div>

      {/* Inline reassuring line — same copy as the header offline banner so
          the broker sees a consistent message whether they're checking the
          compact indicator or this full card. Only shown when offline. */}
      {!isOnline && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          <CloudOff className="size-3 shrink-0" />
          <span>You're offline — changes will be saved as drafts and synced automatically when you reconnect.</span>
        </div>
      )}
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LanguageCard — interface-language picker.
//
// Lets the broker switch the entire UI between English / Hindi / Gujarati.
// Choice is persisted to localStorage via the `useLocale` Zustand store and
// applies INSTANTLY across all views (no page reload) because every
// translated component reads `locale` from the store via `useTranslation`.
//
// The picker shows each language's native name so a Hindi/Gujarati-speaking
// broker can find their language without parsing an English label first.
// ─────────────────────────────────────────────────────────────────────────────
function LanguageCard() {
  const { locale, setLocale, t } = useTranslation();

  return (
    <GlassCard className="hover-lift p-6">
      <div className="flex items-center gap-2.5">
        <div className="grid size-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Languages className="size-4.5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t("settings.language")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("settings.languageHint")}
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="interface-language" className="text-xs font-medium text-muted-foreground">
            {t("settings.languageLabel")}
          </Label>
          <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
            <SelectTrigger id="interface-language" className="w-full">
              <SelectValue placeholder={t("settings.languageLabel")} />
            </SelectTrigger>
            <SelectContent>
              {LOCALE_OPTIONS.map((opt) => (
                <SelectItem key={opt.code} value={opt.code}>
                  <span className="font-medium">{opt.nativeName}</span>
                  <span className="ml-1.5 text-[11px] uppercase text-muted-foreground">({opt.code})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("settings.languageHint")}
          </p>
        </div>

        {/* Live preview row — re-renders instantly when the broker picks a
            different language. Shows the translated Settings title + a
            translated "Save changes" button label as a sample so they can
            verify the language actually took effect before navigating away. */}
        <div className="flex flex-col gap-2 rounded-xl border border-border/50 bg-card/30 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Live preview
            </p>
            <p className="kpi-num mt-0.5 text-base font-semibold text-foreground">
              {t("settings.title")} · {t("common.saveChanges")}
            </p>
          </div>
          <div className="flex items-center gap-2 text-right text-[11px] text-muted-foreground">
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 font-mono text-emerald-700 dark:text-emerald-300"
            >
              {locale.toUpperCase()}
            </Badge>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
