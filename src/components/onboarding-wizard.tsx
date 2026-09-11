"use client";

import * as React from "react";
import {
  Sparkles, Shirt, Users, Factory, CheckCircle2, ArrowRight, ArrowLeft,
  Lightbulb, Database, Loader2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { api } from "@/lib/api";

type OnboardingAction = "complete" | "skip" | "load_demo" | "reset";

type Props = {
  open: boolean;
  onClose: () => void;
};

const TOTAL_STEPS = 4;
const STEP_LABELS = ["Welcome", "Add client", "Add supplier", "All set"];

// Shared quick-tips content — also mirrored on the dashboard's Quick Tips card
// so the "View quick guide" reveal matches what the broker sees post-onboarding.
const QUICK_TIPS: { icon: React.ReactNode; title: string; body: string }[] = [
  {
    icon: <Sparkles className="size-4" />,
    title: "Press ⌘K to find anything",
    body: "Quickly find any client, PO, or bill from anywhere in the app.",
  },
  {
    icon: <Lightbulb className="size-4" />,
    title: "Click any KPI card to drill in",
    body: "Jump straight into the filtered list — outstanding bills, eligible brokerage, open disputes.",
  },
  {
    icon: <CheckCircle2 className="size-4" />,
    title: "Check the Action Center daily",
    body: "The dashboard's Action Center surfaces what needs your attention today.",
  },
  {
    icon: <Database className="size-4" />,
    title: "Upload photos at every stage",
    body: "Booking, dispatch, disputes — photos give you a complete audit trail.",
  },
];

export function OnboardingWizard({ open, onClose }: Props) {
  const [step, setStep] = React.useState(0);
  // Guard against double-POSTing the onboarding action (X button + parent
  // unmount can race).
  const closingRef = React.useRef(false);

  // Counts for the summary on step 4
  const [clientsAdded, setClientsAdded] = React.useState(0);
  const [suppliersAdded, setSuppliersAdded] = React.useState(0);

  // Quick-guide reveal on step 4
  const [showGuide, setShowGuide] = React.useState(false);

  const handleClose = React.useCallback(
    async (action: OnboardingAction) => {
      if (!closingRef.current) {
        closingRef.current = true;
        try {
          await api("/api/onboarding", {
            method: "POST",
            body: JSON.stringify({ action }),
          });
        } catch {
          // Non-blocking — the wizard still closes; the setting may already be set.
        }
      }
      onClose();
    },
    [onClose],
  );

  // Reset internal state when the wizard (re)opens.
  React.useEffect(() => {
    if (open) {
      closingRef.current = false;
      setStep(0);
      setClientsAdded(0);
      setSuppliersAdded(0);
      setShowGuide(false);
    }
  }, [open]);

  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        // Steps 2-4: closing via X / outside / escape = "skip" the rest.
        // Step 1: closing is blocked by onInteractOutside / onEscapeKeyDown
        // below, AND the X button is hidden via showCloseButton.
        if (!nextOpen && step !== 0) {
          void handleClose("skip");
        }
      }}
    >
      <DialogContent
        className="glass-strong flex max-h-[95vh] w-full max-w-2xl flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-h-[90vh]"
        showCloseButton={step !== 0}
        onInteractOutside={(e) => {
          if (step === 0) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (step === 0) e.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">Onboarding wizard</DialogTitle>
        <DialogDescription className="sr-only">
          A guided walkthrough to set up your brokerage — add your first client and supplier,
          then load demo data or explore the dashboard.
        </DialogDescription>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 border-b border-border/50 px-6 py-4 sm:gap-2">
          {STEP_LABELS.map((label, i) => {
            const state = i < step ? "done" : i === step ? "current" : "pending";
            const dotClass =
              state === "done"
                ? "bg-emerald-500 border-emerald-500"
                : state === "current"
                  ? "bg-muted-foreground/30 border-muted-foreground/50"
                  : "bg-transparent border-border";
            return (
              <React.Fragment key={label}>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`size-2.5 rounded-full border transition-colors ${dotClass}`}
                    aria-hidden
                  />
                  <span
                    className={`hidden text-[11px] font-medium sm:inline ${
                      state === "pending" ? "text-muted-foreground/60" : "text-foreground/80"
                    }`}
                  >
                    {label}
                  </span>
                </div>
                {i < STEP_LABELS.length - 1 && (
                  <span className="mx-0.5 hidden h-px w-6 bg-border sm:inline" aria-hidden />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Scrollable step body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 sm:px-8 sm:py-8">
          {step === 0 && <WelcomeStep onStart={next} onSkip={() => void handleClose("skip")} />}
          {step === 1 && (
            <ClientStep
              onAdded={() => setClientsAdded((c) => c + 1)}
              onNext={next}
              onBack={back}
            />
          )}
          {step === 2 && (
            <SupplierStep
              onAdded={() => setSuppliersAdded((c) => c + 1)}
              onNext={next}
              onBack={back}
            />
          )}
          {step === 3 && (
            <SummaryStep
              clientsAdded={clientsAdded}
              suppliersAdded={suppliersAdded}
              showGuide={showGuide}
              onToggleGuide={() => setShowGuide((g) => !g)}
              onLoadDemo={() => handleClose("load_demo")}
              onComplete={() => handleClose("complete")}
              onBack={back}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared step sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StepHeader({
  icon,
  eyebrow,
  title,
  description,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
          {eyebrow}
        </p>
        <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
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

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Welcome
// ─────────────────────────────────────────────────────────────────────────────

function WelcomeStep({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="grid size-20 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 ring-4 ring-emerald-500/10 dark:text-emerald-400">
        <Shirt className="size-10" />
      </div>
      <h2 className="mt-6 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        Welcome to Broker OS
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        Your end-to-end command center for garment brokerage — track clients &amp; suppliers,
        manage visits, POs, dispatches, bills, payments, and brokerage payouts with full
        audit trails and real-time reminders.
      </p>

      <div className="mt-6 grid w-full max-w-md grid-cols-3 gap-3 text-center">
        <FeatureMini icon={<Users className="size-4" />} label="Clients" />
        <FeatureMini icon={<Factory className="size-4" />} label="Suppliers" />
        <FeatureMini icon={<Sparkles className="size-4" />} label="Brokerage" />
      </div>

      <div className="mt-8 flex w-full max-w-md flex-col gap-2 sm:flex-row sm:justify-center">
        <Button size="lg" className="flex-1" onClick={onStart}>
          Get started
          <ArrowRight className="ml-1.5 size-4" />
        </Button>
        <Button size="lg" variant="ghost" onClick={onSkip}>
          Skip for now
        </Button>
      </div>
      <p className="mt-4 text-[11px] text-muted-foreground">
        Takes 2 minutes. You can replay this from Settings anytime.
      </p>
    </div>
  );
}

function FeatureMini({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="glass flex flex-col items-center gap-1.5 rounded-xl border border-border/50 px-2 py-3">
      <span className="text-emerald-600 dark:text-emerald-400">{icon}</span>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Add your first client
// ─────────────────────────────────────────────────────────────────────────────

function ClientStep({
  onAdded,
  onNext,
  onBack,
}: {
  onAdded: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [form, setForm] = React.useState({ name: "", contactPerson: "", phone: "" });
  const [saving, setSaving] = React.useState(false);
  const [success, setSuccess] = React.useState(false);
  const [lastAdded, setLastAdded] = React.useState("");

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("Client name is required");
      return;
    }
    setSaving(true);
    try {
      await api("/api/clients", { method: "POST", body: JSON.stringify(form) });
      toast.success("Client added");
      setLastAdded(form.name.trim());
      onAdded();
      setSuccess(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add client");
    } finally {
      setSaving(false);
    }
  };

  const addAnother = () => {
    setForm({ name: "", contactPerson: "", phone: "" });
    setSuccess(false);
  };

  if (success) {
    return (
      <div>
        <StepHeader
          icon={<Users className="size-5" />}
          eyebrow="Step 2 of 4"
          title="Add your first client"
          description="Clients are the buyers you broker goods for. You can add more later from the Clients view."
        />
        <div className="mt-6 flex flex-col items-center rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
          <CheckCircle2 className="size-10 text-emerald-600 dark:text-emerald-400" />
          <p className="mt-3 text-sm font-medium text-foreground">
            Added “{lastAdded}” successfully
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add another client, or continue to the next step.
          </p>
          <div className="mt-4 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
            <Button variant="outline" onClick={addAnother}>
              Add another client
            </Button>
            <Button onClick={onNext}>
              Next
              <ArrowRight className="ml-1.5 size-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <StepHeader
        icon={<Users className="size-5" />}
        eyebrow="Step 2 of 4"
        title="Add your first client"
        description="Clients are the buyers you broker goods for. You can add more later from the Clients view."
      />
      <div className="mt-6 space-y-4">
        <Field label="Client name *">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Sharma Garments"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !saving) void submit();
            }}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact person">
            <Input
              value={form.contactPerson}
              onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
              placeholder="e.g. Raj Sharma"
            />
          </Field>
          <Field label="Phone">
            <Input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+91 …"
            />
          </Field>
        </div>

        <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={onNext}>
            Skip this step
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft className="mr-1.5 size-4" />
              Back
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
              {saving ? "Saving…" : "Save & continue"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Add your first supplier
// ─────────────────────────────────────────────────────────────────────────────

function SupplierStep({
  onAdded,
  onNext,
  onBack,
}: {
  onAdded: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [form, setForm] = React.useState({
    name: "",
    contactPerson: "",
    phone: "",
    defaultCommissionRate: "5",
  });
  const [saving, setSaving] = React.useState(false);
  const [success, setSuccess] = React.useState(false);
  const [lastAdded, setLastAdded] = React.useState("");

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("Supplier name is required");
      return;
    }
    const rate = Number(form.defaultCommissionRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast.error("Commission rate must be between 0 and 100");
      return;
    }
    setSaving(true);
    try {
      await api("/api/suppliers", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          contactPerson: form.contactPerson || undefined,
          phone: form.phone || undefined,
          defaultCommissionRate: rate,
        }),
      });
      toast.success("Supplier added");
      setLastAdded(form.name.trim());
      onAdded();
      setSuccess(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add supplier");
    } finally {
      setSaving(false);
    }
  };

  const addAnother = () => {
    setForm({ name: "", contactPerson: "", phone: "", defaultCommissionRate: "5" });
    setSuccess(false);
  };

  if (success) {
    return (
      <div>
        <StepHeader
          icon={<Factory className="size-5" />}
          eyebrow="Step 3 of 4"
          title="Add your first supplier"
          description="Suppliers are the manufacturers you source goods from. The commission % is what you earn per PO."
        />
        <div className="mt-6 flex flex-col items-center rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
          <CheckCircle2 className="size-10 text-emerald-600 dark:text-emerald-400" />
          <p className="mt-3 text-sm font-medium text-foreground">
            Added “{lastAdded}” successfully
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add another supplier, or continue to the summary.
          </p>
          <div className="mt-4 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
            <Button variant="outline" onClick={addAnother}>
              Add another supplier
            </Button>
            <Button onClick={onNext}>
              Next
              <ArrowRight className="ml-1.5 size-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <StepHeader
        icon={<Factory className="size-5" />}
        eyebrow="Step 3 of 4"
        title="Add your first supplier"
        description="Suppliers are the manufacturers you source goods from. The commission % is what you earn per PO."
      />
      <div className="mt-6 space-y-4">
        <Field label="Supplier name *">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Shree Balaji Textiles"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !saving) void submit();
            }}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact person">
            <Input
              value={form.contactPerson}
              onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
              placeholder="e.g. Ramesh Agarwal"
            />
          </Field>
          <Field label="Phone">
            <Input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+91 …"
            />
          </Field>
        </div>
        <Field label="Default commission rate (%)">
          <Input
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={form.defaultCommissionRate}
            onChange={(e) => setForm({ ...form, defaultCommissionRate: e.target.value })}
            placeholder="5"
          />
        </Field>

        <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={onNext}>
            Skip this step
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft className="mr-1.5 size-4" />
              Back
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
              {saving ? "Saving…" : "Save & continue"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 — You're all set
// ─────────────────────────────────────────────────────────────────────────────

function SummaryStep({
  clientsAdded,
  suppliersAdded,
  showGuide,
  onToggleGuide,
  onLoadDemo,
  onComplete,
  onBack,
}: {
  clientsAdded: number;
  suppliersAdded: number;
  showGuide: boolean;
  onToggleGuide: () => void;
  onLoadDemo: () => Promise<void> | void;
  onComplete: () => Promise<void> | void;
  onBack: () => void;
}) {
  const [loadingDemo, setLoadingDemo] = React.useState(false);
  const [loadingDone, setLoadingDone] = React.useState(false);

  const handleLoadDemo = async () => {
    setLoadingDemo(true);
    try {
      await onLoadDemo();
    } finally {
      setLoadingDemo(false);
    }
  };

  const handleComplete = async () => {
    setLoadingDone(true);
    try {
      await onComplete();
    } finally {
      setLoadingDone(false);
    }
  };

  return (
    <div>
      <StepHeader
        icon={<CheckCircle2 className="size-5" />}
        eyebrow="Step 4 of 4"
        title="You're all set"
        description="Here's a summary of what you added during setup. Choose how you'd like to continue."
      />

      {/* Summary tiles */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="glass flex items-center gap-3 rounded-xl border border-border/50 p-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <Users className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="kpi-num text-2xl font-light text-foreground">{clientsAdded}</p>
            <p className="text-[11px] text-muted-foreground">
              {clientsAdded === 1 ? "client added" : "clients added"}
            </p>
          </div>
        </div>
        <div className="glass flex items-center gap-3 rounded-xl border border-border/50 p-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <Factory className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="kpi-num text-2xl font-light text-foreground">{suppliersAdded}</p>
            <p className="text-[11px] text-muted-foreground">
              {suppliersAdded === 1 ? "supplier added" : "suppliers added"}
            </p>
          </div>
        </div>
      </div>

      {clientsAdded === 0 && suppliersAdded === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No records added yet — that's fine. You can load demo data to explore the system,
          or head straight to the dashboard and add records from the Clients / Suppliers views.
        </p>
      ) : null}

      {/* Quick guide reveal */}
      {showGuide ? (
        <div className="glass mt-5 rounded-2xl border border-border/50 p-4">
          <div className="flex items-center gap-2">
            <Lightbulb className="size-4 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm font-semibold text-foreground">Quick guide</p>
          </div>
          <ul className="mt-3 space-y-2.5">
            {QUICK_TIPS.map((tip) => (
              <li key={tip.title} className="flex items-start gap-2.5">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  {tip.icon}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{tip.title}</p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{tip.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Action buttons */}
      <div className="mt-6 flex flex-col gap-2">
        <Button
          size="lg"
          onClick={handleComplete}
          disabled={loadingDone || loadingDemo}
          className="w-full"
        >
          {loadingDone ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
          {loadingDone ? "Loading…" : "Go to dashboard"}
          {!loadingDone && <ArrowRight className="ml-1.5 size-4" />}
        </Button>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            variant="outline"
            onClick={handleLoadDemo}
            disabled={loadingDemo || loadingDone}
          >
            {loadingDemo ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Database className="mr-1.5 size-4" />}
            {loadingDemo ? "Loading demo…" : "Load demo data"}
          </Button>
          <Button variant="outline" onClick={onToggleGuide} disabled={loadingDemo || loadingDone}>
            <Lightbulb className="mr-1.5 size-4" />
            {showGuide ? "Hide quick guide" : "View quick guide"}
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={onBack} disabled={loadingDemo || loadingDone} className="mt-1">
          <ArrowLeft className="mr-1.5 size-4" />
          Back to supplier step
        </Button>
      </div>
    </div>
  );
}
