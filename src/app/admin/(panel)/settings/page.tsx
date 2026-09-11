"use client";

import * as React from "react";
import {
  Settings as SettingsIcon, Shield, Save, Send, Loader2, Sparkles,
  AlertTriangle, Info, Wrench, CreditCard, Check,
} from "lucide-react";
import { api } from "@/lib/api";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { AdminGate } from "@/lib/admin-client";

type Plan = {
  id: string;
  name: string;
  displayName: string;
  priceMonthly: number;
  priceYearly: number;
  maxClients: number;
  maxSuppliers: number;
  maxPOs: number;
  maxPhotos: number;
  portalAccess: boolean;
  aiDigest: boolean;
  customReports: boolean;
  advancedAnalytics: boolean;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type PlansResponse = { plans: Plan[] };

const ANNOUNCEMENT_TYPES = [
  { value: "info", label: "Info", icon: Info },
  { value: "warning", label: "Warning", icon: AlertTriangle },
  { value: "maintenance", label: "Maintenance", icon: Wrench },
  { value: "billing", label: "Billing", icon: CreditCard },
] as const;

const NUMBER_LIMIT_FIELDS: { key: "maxClients" | "maxSuppliers" | "maxPOs" | "maxPhotos"; label: string }[] = [
  { key: "maxClients", label: "Max Clients" },
  { key: "maxSuppliers", label: "Max Suppliers" },
  { key: "maxPOs", label: "Max POs" },
  { key: "maxPhotos", label: "Max Photos" },
];

const BOOLEAN_FEATURE_FIELDS: { key: "portalAccess" | "aiDigest" | "customReports" | "advancedAnalytics"; label: string }[] = [
  { key: "portalAccess", label: "Portal access" },
  { key: "aiDigest", label: "AI daily digest" },
  { key: "customReports", label: "Custom reports" },
  { key: "advancedAnalytics", label: "Advanced analytics" },
];

export default function AdminSettingsPage() {
  return (
    <AdminGate>
      <AdminSettingsContent />
    </AdminGate>
  );
}

function AdminSettingsContent() {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Platform Settings"
        description="Edit the four SaaS plans and broadcast announcements to all brokers."
      />

      <PlansEditor />
      <AnnouncementComposer />
    </div>
  );
}

// ── Plans editor (inline) ────────────────────────────────────────────────
function PlansEditor() {
  const { data, error, loading, refresh } = usePlansApi();

  if (loading && !data) {
    return (
      <GlassCard className="p-4">
        <Skeleton className="h-6 w-48" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </GlassCard>
    );
  }
  if (error || !data) {
    return (
      <GlassCard className="p-6">
        <EmptyState title="Failed to load plans" hint={error ?? ""} icon={<SettingsIcon />} />
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-5">
      <SectionHeader
        title="Plans"
        description="Edit price, limits, and features for each plan. Saved per-plan."
      />
      <div className="mt-4 space-y-4">
        {data.plans.map((plan) => (
          <PlanEditor key={plan.id} plan={plan} onSaved={refresh} />
        ))}
      </div>
    </GlassCard>
  );
}

function usePlansApi() {
  const [data, setData] = React.useState<PlansResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const refresh = React.useCallback(() => setRefreshKey((k) => k + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<PlansResponse>("/api/admin/plans")
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  return { data, error, loading, refresh };
}

function PlanEditor({ plan, onSaved }: { plan: Plan; onSaved: () => void }) {
  const [form, setForm] = React.useState({
    displayName: plan.displayName,
    priceMonthly: plan.priceMonthly,
    priceYearly: plan.priceYearly,
    maxClients: plan.maxClients,
    maxSuppliers: plan.maxSuppliers,
    maxPOs: plan.maxPOs,
    maxPhotos: plan.maxPhotos,
    portalAccess: plan.portalAccess,
    aiDigest: plan.aiDigest,
    customReports: plan.customReports,
    advancedAnalytics: plan.advancedAnalytics,
    description: plan.description ?? "",
  });
  const [saving, setSaving] = React.useState(false);

  // Sync form state when the plan prop changes (after refresh).
  React.useEffect(() => {
    setForm({
      displayName: plan.displayName,
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      maxClients: plan.maxClients,
      maxSuppliers: plan.maxSuppliers,
      maxPOs: plan.maxPOs,
      maxPhotos: plan.maxPhotos,
      portalAccess: plan.portalAccess,
      aiDigest: plan.aiDigest,
      customReports: plan.customReports,
      advancedAnalytics: plan.advancedAnalytics,
      description: plan.description ?? "",
    });
  }, [plan]);

  function update<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api(`/api/admin/plans/${plan.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          displayName: form.displayName,
          priceMonthly: Number(form.priceMonthly),
          priceYearly: Number(form.priceYearly),
          maxClients: Number(form.maxClients),
          maxSuppliers: Number(form.maxSuppliers),
          maxPOs: Number(form.maxPOs),
          maxPhotos: Number(form.maxPhotos),
          portalAccess: form.portalAccess,
          aiDigest: form.aiDigest,
          customReports: form.customReports,
          advancedAnalytics: form.advancedAnalytics,
          description: form.description || null,
        }),
      });
      toast.success(`${plan.displayName} plan updated`);
      onSaved();
    } catch (e) {
      toast.error("Failed to update plan", {
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setSaving(false);
    }
  }

  const dirty = JSON.stringify(form) !== JSON.stringify({
    displayName: plan.displayName,
    priceMonthly: plan.priceMonthly,
    priceYearly: plan.priceYearly,
    maxClients: plan.maxClients,
    maxSuppliers: plan.maxSuppliers,
    maxPOs: plan.maxPOs,
    maxPhotos: plan.maxPhotos,
    portalAccess: plan.portalAccess,
    aiDigest: plan.aiDigest,
    customReports: plan.customReports,
    advancedAnalytics: plan.advancedAnalytics,
    description: plan.description ?? "",
  });

  return (
    <div className="glass rounded-xl p-4">
      {/* Header — plan name + price highlight */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="border-teal-500/40 text-teal-700 dark:text-teal-300 capitalize"
          >
            {plan.name}
          </Badge>
          <Input
            value={form.displayName}
            onChange={(e) => update("displayName", e.target.value)}
            className="h-8 w-40"
            placeholder="Display name"
          />
          {!plan.isActive ? <Badge variant="secondary">Inactive</Badge> : null}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            ₹<Input
              type="number"
              value={form.priceMonthly}
              onChange={(e) => update("priceMonthly", Number(e.target.value))}
              className="ml-1 inline-flex h-7 w-20"
            />
            /mo
          </span>
          <span>
            ₹<Input
              type="number"
              value={form.priceYearly}
              onChange={(e) => update("priceYearly", Number(e.target.value))}
              className="ml-1 inline-flex h-7 w-24"
            />
            /yr
          </span>
        </div>
      </div>

      {/* Limits — -1 = unlimited */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {NUMBER_LIMIT_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {label} (-1 = unlimited)
            </Label>
            <Input
              type="number"
              value={form[key]}
              onChange={(e) => update(key, Number(e.target.value))}
              className="mt-0.5 h-8"
            />
          </div>
        ))}
      </div>

      {/* Feature flags */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {BOOLEAN_FEATURE_FIELDS.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <Label className="text-xs">{label}</Label>
            <Switch
              checked={form[key]}
              onCheckedChange={(v) => update(key, v)}
              aria-label={label}
            />
          </div>
        ))}
      </div>

      {/* Description */}
      <div className="mt-3">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Description
        </Label>
        <Textarea
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          rows={2}
          className="mt-0.5 text-sm"
          placeholder="Short marketing description for this plan."
        />
      </div>

      {/* Save */}
      <div className="mt-3 flex justify-end">
        <Button onClick={handleSave} disabled={saving || !dirty} size="sm">
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
          Save {plan.displayName}
        </Button>
      </div>
    </div>
  );
}

// ── Announcement composer ────────────────────────────────────────────────
function AnnouncementComposer() {
  const [title, setTitle] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [type, setType] = React.useState<(typeof ANNOUNCEMENT_TYPES)[number]["value"]>("info");
  const [sending, setSending] = React.useState(false);

  async function handleSend() {
    if (!title.trim() || !message.trim()) {
      toast.error("Title and message are required");
      return;
    }
    setSending(true);
    try {
      const res = await api<{ success: boolean; recipients: number; title: string; type: string }>(
        "/api/admin/announcements",
        {
          method: "POST",
          body: JSON.stringify({ title: title.trim(), message: message.trim(), type }),
        },
      );
      toast.success("Announcement sent", {
        description: `${res.recipients} broker${res.recipients === 1 ? "" : "s"} notified.`,
      });
      setTitle("");
      setMessage("");
      setType("info");
    } catch (e) {
      toast.error("Failed to send announcement", {
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setSending(false);
    }
  }

  const TypeIcon = ANNOUNCEMENT_TYPES.find((t) => t.value === type)?.icon ?? Info;

  return (
    <GlassCard className="p-5">
      <SectionHeader
        title="Broadcast Announcement"
        description="Send a notification to every broker on the platform. Appears in each broker's bell badge."
      />
      <div className="mt-4 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
          <div>
            <Label htmlFor="ann-title">Title</Label>
            <Input
              id="ann-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Scheduled maintenance this Sunday"
              maxLength={120}
            />
          </div>
          <div>
            <Label htmlFor="ann-type">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger id="ann-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANNOUNCEMENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <span className="flex items-center gap-2">
                      <t.icon className="size-3.5" />
                      {t.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="ann-message">Message</Label>
          <Textarea
            id="ann-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Write the announcement body. Appears in each broker's notifications list."
            maxLength={2000}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            {message.length}/2000 characters
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          <TypeIcon className="size-3.5" />
          <span>
            This will create a <Badge variant="outline" className="mx-1 text-[10px]">Notification</Badge>
            row for every broker + an AdminAuditLog entry recording the broadcast.
          </span>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={handleSend}
            disabled={sending || !title.trim() || !message.trim()}
            className="bg-teal-600 hover:bg-teal-700"
          >
            {sending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Send className="mr-2 size-4" />}
            Broadcast to all brokers
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}

// ── Decorative shield ────────────────────────────────────────────────────
export function SettingsPageShield() {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Shield className="size-3.5 text-teal-600" />
      <span>Super admin session</span>
    </div>
  );
}

// Tiny helper used in headers to indicate features.
function FeatureCheck({ on }: { on: boolean }) {
  return on ? <Check className="size-3 text-emerald-600" /> : <Sparkles className="size-3 text-muted-foreground/40" />;
}
export { FeatureCheck };
