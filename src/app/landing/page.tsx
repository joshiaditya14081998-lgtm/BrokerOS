"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Shirt,
  ArrowRight,
  Check,
  Star,
  Zap,
  Users,
  Factory,
  Calendar,
  FileText,
  Truck,
  Receipt,
  Wallet,
  BadgePercent,
  AlertTriangle,
  Camera,
  TrendingUp,
  Shield,
  BookOpen,
  Bell,
  Calculator,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Plan catalogue — kept in sync with the backend `create-profile` route.
// ─────────────────────────────────────────────────────────────────────────────
type PlanId = "free" | "basic" | "pro" | "enterprise";

type PlanDef = {
  id: PlanId;
  name: string;
  price: number; // ₹ per month; 0 for free
  tagline: string;
  features: string[];
  cta: string;
  highlight?: boolean;
};

const PLANS: PlanDef[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    tagline: "Try the full workflow with a small book.",
    features: [
      "Up to 5 clients & 5 suppliers",
      "Up to 10 active POs",
      "Up to 50 photos",
      "Core modules: visits, bookings, dispatches, bills",
      "Manual brokerage calculation",
      "Community support",
    ],
    cta: "Start Free",
  },
  {
    id: "basic",
    name: "Basic",
    price: 999,
    tagline: "For a solo broker running a steady book.",
    features: [
      "Up to 50 clients & 50 suppliers",
      "Up to 200 active POs",
      "Up to 500 photos",
      "Auto brokerage calculation",
      "Daily AI digest email",
      "Email support",
    ],
    cta: "Choose Basic",
  },
  {
    id: "pro",
    name: "Pro",
    price: 2999,
    tagline: "Most popular — for brokers scaling up.",
    features: [
      "Unlimited clients, suppliers & POs",
      "5,000 photos",
      "Client + supplier portal access",
      "Custom report builder",
      "Advanced analytics + forecasting",
      "Priority support",
    ],
    cta: "Choose Pro",
    highlight: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 9999,
    tagline: "For multi-broker teams with heavier needs.",
    features: [
      "Everything in Pro, unlimited",
      "Unlimited photos",
      "Multi-user team seats",
      "Custom integrations & API access",
      "Onboarding + training session",
      "Dedicated account manager",
    ],
    cta: "Talk to Sales",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Section data
// ─────────────────────────────────────────────────────────────────────────────

const PAIN_POINTS = [
  {
    icon: BookOpen,
    title: "Manual Ledger Hell",
    body: "Every booking, dispatch and payment lives in a worn-out notebook. One missed page = one lost payment.",
  },
  {
    icon: Bell,
    title: "Forgotten Dispatches",
    body: "Expected dispatch dates slip silently. Suppliers miss deadlines; clients lose trust; you eat the blame.",
  },
  {
    icon: Calculator,
    title: "Delayed Brokerage",
    body: "Commission is calculated by hand at month-end. Errors creep in. You wait months to get paid what you earned.",
  },
];

const SOLUTIONS = [
  {
    icon: FileText,
    title: "Digital Tracking",
    body: "Every visit, booking, PO, dispatch and bill — captured in one glassmorphic dashboard. Search it. Filter it. Trust it.",
  },
  {
    icon: Bell,
    title: "Auto Reminders",
    body: "The system watches every expected dispatch + payment date and nudges you before anything slips through the cracks.",
  },
  {
    icon: BadgePercent,
    title: "Auto Brokerage Calculation",
    body: "Commission computed on every fully-paid bill, grouped by client payout cadence — immediate, 4-month, or 12-month.",
  },
];

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Calendar, title: "Visits", body: "Plan + log market visits. Tag photos. Track follow-ups." },
  { icon: BookOpen, title: "Bookings", body: "Record styles, sets, prices per supplier per visit." },
  { icon: FileText, title: "Purchase Orders", body: "Auto-generated POs from bookings with GST snapshot." },
  { icon: Truck, title: "Dispatches", body: "Partial + full dispatches with photo proof + date logs." },
  { icon: Receipt, title: "Bills", body: "Auto-compute base, GST and final amount per PO." },
  { icon: Wallet, title: "Payments", body: "Record payments in any mode. Track outstanding per client." },
  { icon: BadgePercent, title: "Brokerage", body: "Auto-calc commission per bill, grouped by payout cadence." },
  { icon: AlertTriangle, title: "Disputes", body: "Log short-shipments, defective returns, resolutions." },
  { icon: Camera, title: "Photos", body: "Stage-polymorphic photo log — visits, dispatches, disputes." },
];

const STEPS = [
  { icon: Zap, title: "Sign up", body: "Create your account in 30 seconds. No credit card required." },
  { icon: Users, title: "Add clients & suppliers", body: "Import your contact book. Set commission + GST defaults." },
  { icon: BookOpen, title: "Record bookings", body: "Log visits and bookings — POs and bills are generated automatically." },
  { icon: Wallet, title: "Get paid", body: "Track payments, watch brokerage accrue, and trigger payouts." },
];

const TESTIMONIALS = [
  {
    quote:
      "I used to spend every Sunday night reconciling my ledger. Now Broker OS does it as I go. My weekends are mine again.",
    name: "Ramesh Agarwal",
    role: "Garment broker, Surat",
  },
  {
    quote:
      "Dispatch reminders alone have saved me three clients. The system pings me two days before a slip — I call the supplier before the client even notices.",
    name: "Priya Shah",
    role: "Independent broker, Mumbai",
  },
  {
    quote:
      "Brokerage calculation used to take two days at month-end. Now it's instant. I can finally quote new clients with confidence.",
    name: "Imran Sheikh",
    role: "Multi-client broker, Tirupur",
  },
];

const FAQS = [
  {
    q: "Is the 14-day free trial really free? Do I need a credit card?",
    a: "Yes — the trial is completely free, and no credit card is required to start. You get full access to the Pro plan features for 14 days. After the trial, you can stay on the Free plan or pick a paid plan.",
  },
  {
    q: "Can I switch plans later?",
    a: "Yes, at any time. Upgrades take effect immediately. Downgrades take effect at the start of your next billing cycle, so you keep your current features until then.",
  },
  {
    q: "What if I work in a market area with poor internet?",
    a: "Broker OS is offline-tolerant. You can save bookings, dispatches and payments as local drafts while offline — they auto-sync the moment you reconnect.",
  },
  {
    q: "Does my data stay private to me?",
    a: "Yes. Each broker's data is scoped to their Supabase auth account. Portal users (clients + suppliers) only see their own records — never another broker's data.",
  },
  {
    q: "Can my clients and suppliers log in to see their own data?",
    a: "Yes — on Pro and Enterprise plans, you can invite clients + suppliers to a self-serve portal where they see only their own POs, dispatches, bills and payments.",
  },
  {
    q: "Do you support Indian GST and brokerage payout cadences?",
    a: "Yes. GST % is configurable per supplier with a system default. Brokerage payouts can be immediate, 4-month cumulative, or 12-month cumulative — per client.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Animated section wrapper
// ─────────────────────────────────────────────────────────────────────────────

function Section({
  id,
  children,
  className,
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      id={id}
      className={cn("scroll-mt-24", className)}
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// In-page screenshot mockups — CSS-rendered, themeable, instant.
// ─────────────────────────────────────────────────────────────────────────────

function ScreenshotDashboard() {
  return (
    <div className="flex h-full w-full flex-col gap-3 p-4">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-border/60 pb-2">
        <div className="size-2.5 rounded-full bg-emerald-500/80" />
        <div className="h-2 w-20 rounded bg-foreground/30" />
        <div className="ml-auto h-2 w-12 rounded bg-foreground/15" />
      </div>
      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { l: "Clients", v: "48", a: "text-emerald-500" },
          { l: "Open POs", v: "23", a: "text-teal-500" },
          { l: "Outstanding", v: "₹4.2L", a: "text-amber-500" },
          { l: "Brokerage", v: "₹1.8L", a: "text-emerald-500" },
        ].map((k) => (
          <div key={k.l} className="rounded-lg border border-border/50 bg-card/60 p-2">
            <div className="text-[8px] uppercase tracking-wide text-muted-foreground">{k.l}</div>
            <div className={cn("text-base font-light tabular-nums", k.a)}>{k.v}</div>
          </div>
        ))}
      </div>
      {/* Chart row */}
      <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-border/50 bg-card/60 p-2">
          <div className="mb-1 text-[8px] uppercase tracking-wide text-muted-foreground">
            Earnings — last 6 months
          </div>
          <svg viewBox="0 0 200 60" className="h-full w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="lg1" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="oklch(0.52 0.13 162)" stopOpacity="0.5" />
                <stop offset="100%" stopColor="oklch(0.52 0.13 162)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0,50 L33,42 L66,46 L100,28 L133,32 L166,18 L200,22 L200,60 L0,60 Z"
              fill="url(#lg1)"
            />
            <path
              d="M0,50 L33,42 L66,46 L100,28 L133,32 L166,18 L200,22"
              fill="none"
              stroke="oklch(0.52 0.13 162)"
              strokeWidth="1.5"
            />
          </svg>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/60 p-2">
          <div className="mb-1 text-[8px] uppercase tracking-wide text-muted-foreground">
            PO status
          </div>
          <div className="flex h-full items-end gap-1.5">
            {[40, 70, 28, 52, 38, 60, 30].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-sm bg-emerald-500/60"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScreenshotPoDetail() {
  return (
    <div className="flex h-full w-full flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <div className="size-6 rounded bg-emerald-500/20 text-[8px] text-emerald-600 grid place-items-center font-bold">
          PO
        </div>
        <div className="text-xs font-semibold">PO-2025-0042</div>
        <Badge className="ml-auto bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
          partially_delivered
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[9px]">
        <div className="rounded border border-border/50 bg-card/60 p-1.5">
          <div className="text-muted-foreground">Client</div>
          <div className="font-medium">Sharma Hosiery</div>
        </div>
        <div className="rounded border border-border/50 bg-card/60 p-1.5">
          <div className="text-muted-foreground">Supplier</div>
          <div className="font-medium">Texmark Mills</div>
        </div>
      </div>
      <div className="overflow-hidden rounded border border-border/50">
        <div className="grid grid-cols-4 bg-muted/40 px-2 py-1 text-[8px] uppercase tracking-wide text-muted-foreground">
          <div>Style</div>
          <div className="text-right">Sets</div>
          <div className="text-right">Rate</div>
          <div className="text-right">Total</div>
        </div>
        {[
          ["Cotton Round Tee", "120", "₹450", "₹54,000"],
          ["Linen Shirt Premium", "80", "₹720", "₹57,600"],
          ["Fleece Hoodie", "60", "₹890", "₹53,400"],
        ].map((row, i) => (
          <div
            key={i}
            className="grid grid-cols-4 px-2 py-1 text-[9px] odd:bg-card/40"
          >
            <div className="truncate">{row[0]}</div>
            <div className="text-right tabular-nums">{row[1]}</div>
            <div className="text-right tabular-nums">{row[2]}</div>
            <div className="text-right tabular-nums font-medium">{row[3]}</div>
          </div>
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between border-t border-border/60 pt-2">
        <div className="text-[9px] text-muted-foreground">
          Commission <span className="font-medium text-emerald-600">5%</span>
        </div>
        <div className="text-xs font-semibold tabular-nums">₹1,65,000</div>
      </div>
    </div>
  );
}

function ScreenshotBrokerage() {
  return (
    <div className="flex h-full w-full flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <BadgePercent className="size-4 text-emerald-600" />
        <div className="text-xs font-semibold">Brokerage ledger</div>
        <Badge className="ml-auto bg-teal-500/15 text-teal-700 dark:text-teal-300">
          3 eligible
        </Badge>
      </div>
      <div className="overflow-hidden rounded border border-border/50">
        <div className="grid grid-cols-4 bg-muted/40 px-2 py-1 text-[8px] uppercase tracking-wide text-muted-foreground">
          <div>Bill</div>
          <div>Client</div>
          <div className="text-right">Base</div>
          <div className="text-right">Commission</div>
        </div>
        {[
          ["BILL-104", "Sharma Hosiery", "₹1.65L", "₹8,250"],
          ["BILL-098", "Patel Knitwear", "₹2.30L", "₹11,500"],
          ["BILL-091", "Mehta Garments", "₹0.98L", "₹4,900"],
        ].map((row, i) => (
          <div
            key={i}
            className="grid grid-cols-4 px-2 py-1 text-[9px] odd:bg-card/40"
          >
            <div className="font-medium">{row[0]}</div>
            <div className="truncate text-muted-foreground">{row[1]}</div>
            <div className="text-right tabular-nums">{row[2]}</div>
            <div className="text-right tabular-nums font-medium text-emerald-600">{row[3]}</div>
          </div>
        ))}
      </div>
      <div className="mt-auto grid grid-cols-2 gap-2">
        <div className="rounded border border-border/50 bg-card/60 p-2">
          <div className="text-[8px] uppercase tracking-wide text-muted-foreground">
            Accrued this period
          </div>
          <div className="text-base font-light tabular-nums text-emerald-600">₹24,650</div>
        </div>
        <div className="rounded border border-border/50 bg-card/60 p-2">
          <div className="text-[8px] uppercase tracking-wide text-muted-foreground">
            Next payout
          </div>
          <div className="text-base font-light tabular-nums">15 Sep</div>
        </div>
      </div>
    </div>
  );
}

function ScreenshotAnalytics() {
  return (
    <div className="flex h-full w-full flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <TrendingUp className="size-4 text-emerald-600" />
        <div className="text-xs font-semibold">Analytics</div>
        <Badge className="ml-auto bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
          +18% MoM
        </Badge>
      </div>
      <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-border/50 bg-card/60 p-2">
          <div className="mb-1 text-[8px] uppercase tracking-wide text-muted-foreground">
            Volume by client
          </div>
          <div className="flex h-full items-end gap-1.5">
            {[
              { h: 70, c: "bg-emerald-500/60" },
              { h: 55, c: "bg-teal-500/60" },
              { h: 40, c: "bg-amber-500/60" },
              { h: 30, c: "bg-emerald-500/40" },
              { h: 22, c: "bg-teal-500/40" },
            ].map((bar, i) => (
              <div
                key={i}
                className={cn("flex-1 rounded-t-sm", bar.c)}
                style={{ height: `${bar.h}%` }}
              />
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/60 p-2">
          <div className="mb-1 text-[8px] uppercase tracking-wide text-muted-foreground">
            Reliability score
          </div>
          <svg viewBox="0 0 100 100" className="h-full w-full">
            <circle cx="50" cy="50" r="38" fill="none" stroke="oklch(0.86 0.01 160 / 0.4)" strokeWidth="10" />
            <circle
              cx="50"
              cy="50"
              r="38"
              fill="none"
              stroke="oklch(0.52 0.13 162)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${0.86 * 2 * Math.PI * 38} ${2 * Math.PI * 38}`}
              transform="rotate(-90 50 50)"
            />
            <text x="50" y="54" textAnchor="middle" fontSize="16" fill="currentColor" fontWeight="500">
              86%
            </text>
          </svg>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded border border-border/50 bg-card/60 p-1.5">
          <div className="text-[8px] uppercase tracking-wide text-muted-foreground">Avg delay</div>
          <div className="text-xs font-light tabular-nums">2.4 days</div>
        </div>
        <div className="rounded border border-border/50 bg-card/60 p-1.5">
          <div className="text-[8px] uppercase tracking-wide text-muted-foreground">Fulfillment</div>
          <div className="text-xs font-light tabular-nums text-emerald-600">94%</div>
        </div>
        <div className="rounded border border-border/50 bg-card/60 p-1.5">
          <div className="text-[8px] uppercase tracking-wide text-muted-foreground">Credit exposure</div>
          <div className="text-xs font-light tabular-nums">₹6.8L</div>
        </div>
      </div>
    </div>
  );
}

const SCREENSHOTS = [
  { title: "Dashboard", sub: "Live KPIs + charts", render: ScreenshotDashboard },
  { title: "PO Detail", sub: "Line items + GST snapshot", render: ScreenshotPoDetail },
  { title: "Brokerage", sub: "Auto-computed commission", render: ScreenshotBrokerage },
  { title: "Analytics", sub: "Reliability + trends", render: ScreenshotAnalytics },
];

// ─────────────────────────────────────────────────────────────────────────────
// Pricing card
// ─────────────────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  href,
}: {
  plan: PlanDef;
  href?: string;
}) {
  const isPro = plan.highlight;
  return (
    <div
      className={cn(
        "glass relative flex flex-col rounded-2xl p-6 transition-all duration-200 hover-lift",
        isPro && "border-emerald-500/50 ring-1 ring-emerald-500/30",
      )}
    >
      {isPro && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="bg-emerald-500 text-primary-foreground shadow-md">
            <Star className="size-3" /> Most popular
          </Badge>
        </div>
      )}
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-lg font-semibold tracking-tight">{plan.name}</h3>
        {plan.price === 0 ? (
          <span className="text-sm text-muted-foreground">Forever</span>
        ) : (
          <span className="text-xs text-muted-foreground">per month</span>
        )}
      </div>
      <div className="mb-4 flex items-baseline gap-1">
        <span className="text-3xl font-light tabular-nums">
          {plan.price === 0 ? "₹0" : `₹${plan.price.toLocaleString("en-IN")}`}
        </span>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{plan.tagline}</p>
      <ul className="mb-6 space-y-2.5 text-sm">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="text-foreground/90">{f}</span>
          </li>
        ))}
      </ul>
      <Button
        asChild
        variant={isPro ? "default" : "outline"}
        className={cn(
          "mt-auto w-full",
          !isPro && "border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300",
        )}
      >
        <a href={href ?? "/signup"}>{plan.cta}</a>
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Landing page
// ─────────────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const router = useRouter();
  const [authed, setAuthed] = React.useState(false);
  const [checking, setChecking] = React.useState(true);

  // Supabase session check — if the user IS logged in, swap the
  // "Start Free Trial" CTA for "Go to Dashboard".
  React.useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setAuthed(!!user);
      setChecking(false);
    });
  }, []);

  const ctaHref = authed ? "/" : "/signup";
  const ctaLabel = authed ? "Go to Dashboard" : "14-दिन का Free Trial शुरू करें";

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      {/* ───────────── Ambient hero background ───────────── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[760px] -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, oklch(0.52 0.13 162 / 0.18) 0%, transparent 70%), radial-gradient(40% 40% at 80% 10%, oklch(0.65 0.12 200 / 0.14) 0%, transparent 70%), radial-gradient(40% 40% at 20% 20%, oklch(0.72 0.14 85 / 0.12) 0%, transparent 70%)",
        }}
      />

      {/* ───────────── Navbar ───────────── */}
      <header className="glass-strong sticky top-0 z-40 border-b border-border/60">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow">
              <Shirt className="size-5" />
            </div>
            <div className="text-base font-semibold tracking-tight">Broker OS</div>
          </div>
          <nav className="ml-6 hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#pricing" className="transition-colors hover:text-foreground">Pricing</a>
            <a href="#faq" className="transition-colors hover:text-foreground">FAQ</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {!checking && authed ? (
              <Button asChild size="sm" className="gap-1.5">
                <a href="/">
                  <Shield className="size-4" /> Dashboard
                </a>
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/login")}
                className="hidden sm:inline-flex"
              >
                Sign in
              </Button>
            )}
            <Button asChild size="sm" className="gap-1.5">
              <a href={ctaHref}>
                {!authed && <ArrowRight className="size-4" />}
                {authed ? "Dashboard" : "Start Free Trial"}
              </a>
            </Button>
          </div>
        </div>
      </header>

      {/* ───────────── 1. Hero ───────────── */}
      <Section className="mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <Badge className="mb-4 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <Zap className="size-3" /> Built for Indian garment brokers
            </Badge>
            <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              अपने Garment Brokerage को{" "}
              <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent dark:from-emerald-400 dark:to-teal-300">
                Digital
              </span>{" "}
              बनाएं
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              Track every visit, booking, PO, dispatch, bill, payment and brokerage
              commission in one beautiful, glassmorphic workspace. Auto-calc GST,
              auto-trigger reminders, auto-pay your commission. Built for the
              Indian garment trade.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild size="lg" className="gap-2 text-base">
                <a href={ctaHref}>
                  {!checking && authed ? <Shield className="size-5" /> : <Zap className="size-5" />}
                  {ctaLabel}
                </a>
              </Button>
              {!authed && (
                <span className="text-sm text-muted-foreground">
                  No credit card required
                </span>
              )}
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-emerald-600" /> 14-day Pro trial
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-emerald-600" /> Works offline
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-emerald-600" /> Hindi / English / Gujarati
              </span>
            </div>
          </div>

          {/* Hero "screenshot" card */}
          <div className="relative">
            <div className="glass-strong rounded-2xl p-3 shadow-2xl">
              <div className="overflow-hidden rounded-xl border border-border/60 bg-background/60">
                <div className="h-[360px] sm:h-[420px]">
                  <ScreenshotDashboard />
                </div>
              </div>
            </div>
            {/* Floating accent badges */}
            <motion.div
              className="glass absolute -left-4 top-12 hidden rounded-xl px-3 py-2 text-xs shadow-lg sm:block"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5, duration: 0.6 }}
            >
              <div className="flex items-center gap-2">
                <BadgePercent className="size-4 text-emerald-600" />
                <div>
                  <div className="font-medium">₹1.8L brokerage</div>
                  <div className="text-muted-foreground">accrued this month</div>
                </div>
              </div>
            </motion.div>
            <motion.div
              className="glass absolute -right-4 bottom-12 hidden rounded-xl px-3 py-2 text-xs shadow-lg sm:block"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.7, duration: 0.6 }}
            >
              <div className="flex items-center gap-2">
                <Bell className="size-4 text-amber-500" />
                <div>
                  <div className="font-medium">3 reminders</div>
                  <div className="text-muted-foreground">dispatches due this week</div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </Section>

      {/* ───────────── 2. Problem / Solution ───────────── */}
      <Section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <Badge variant="outline" className="mb-3 border-rose-500/30 text-rose-600 dark:text-rose-400">
            The problem
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Running a brokerage on paper is costing you money
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            The garment trade moves fast. Manual ledgers and forgotten reminders
            mean delayed commission, lost clients, and longer hours for less pay.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {PAIN_POINTS.map((p) => (
            <div
              key={p.title}
              className="glass rounded-2xl p-6"
            >
              <div className="mb-4 grid size-11 place-items-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
                <p.icon className="size-5" />
              </div>
              <h3 className="mb-2 text-base font-semibold">{p.title}</h3>
              <p className="text-sm text-muted-foreground">{p.body}</p>
            </div>
          ))}
        </div>

        {/* Arrow row */}
        <div className="my-10 flex justify-center">
          <div className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
            <ArrowRight className="size-4" /> Broker OS solves this
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {SOLUTIONS.map((s) => (
            <div
              key={s.title}
              className="glass rounded-2xl border-emerald-500/20 p-6"
            >
              <div className="mb-4 grid size-11 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <s.icon className="size-5" />
              </div>
              <h3 className="mb-2 text-base font-semibold">{s.title}</h3>
              <p className="text-sm text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ───────────── 3. Features grid ───────────── */}
      <Section id="features" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <Badge variant="outline" className="mb-3 border-emerald-500/30 text-emerald-700 dark:text-emerald-300">
            Features
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Everything a garment broker needs — in one place
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            Nine core modules covering the full visit → booking → PO → dispatch →
            bill → payment → brokerage lifecycle.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="glass group rounded-2xl p-5 transition-colors hover:border-emerald-500/40 hover-lift"
            >
              <div className="mb-3 grid size-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 transition-colors group-hover:bg-emerald-500/20 dark:text-emerald-400">
                <f.icon className="size-5" />
              </div>
              <h3 className="mb-1.5 text-sm font-semibold">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ───────────── 4. Screenshots ───────────── */}
      <Section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <Badge variant="outline" className="mb-3 border-teal-500/30 text-teal-700 dark:text-teal-300">
            Product tour
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            A workspace your team will actually want to use
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            Glassmorphic cards, gentle motion, emerald accent. Built mobile-first
            so it works in the market and at the office.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {SCREENSHOTS.map((s) => (
            <div key={s.title} className="glass rounded-2xl p-3 shadow-lg hover-lift">
              <div className="overflow-hidden rounded-xl border border-border/60 bg-background/60">
                <div className="h-[280px] sm:h-[320px]">
                  <s.render />
                </div>
              </div>
              <div className="flex items-center justify-between px-2 pt-3 pb-1">
                <div>
                  <div className="text-sm font-semibold">{s.title}</div>
                  <div className="text-xs text-muted-foreground">{s.sub}</div>
                </div>
                <ArrowRight className="size-4 text-emerald-600" />
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ───────────── 5. How it works ───────────── */}
      <Section id="how" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <Badge variant="outline" className="mb-3 border-emerald-500/30 text-emerald-700 dark:text-emerald-300">
            How it works
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            From signup to your first paid brokerage in 4 steps
          </h2>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <div key={step.title} className="glass relative rounded-2xl p-6">
              <div className="absolute -top-3 -left-3 grid size-9 place-items-center rounded-full bg-emerald-500 text-base font-semibold text-primary-foreground shadow-md">
                {i + 1}
              </div>
              <div className="mb-3 mt-2 grid size-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <step.icon className="size-5" />
              </div>
              <h3 className="mb-1.5 text-sm font-semibold">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ───────────── 6. Pricing ───────────── */}
      <Section id="pricing" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <Badge variant="outline" className="mb-3 border-emerald-500/30 text-emerald-700 dark:text-emerald-300">
            Pricing
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Simple pricing that scales with your book
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            Every plan starts with a 14-day Pro trial. No credit card required.
            Cancel anytime.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((p) => (
            <PlanCard key={p.id} plan={p} href={`/signup?plan=${p.id}`} />
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-muted-foreground">
          All prices in INR (₹). Annual billing saves ~2 months. GST applicable as
          per Indian law.
        </p>
      </Section>

      {/* ───────────── 7. Testimonials ───────────── */}
      <Section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <Badge variant="outline" className="mb-3 border-amber-500/30 text-amber-600 dark:text-amber-400">
            Testimonials
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Brokers across India are ditching the ledger
          </h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <div key={t.name} className="glass flex flex-col rounded-2xl p-6">
              <div className="mb-4 flex gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="size-4 fill-amber-500 text-amber-500" />
                ))}
              </div>
              <blockquote className="mb-4 flex-1 text-sm text-foreground/90">
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <div className="flex items-center gap-3 border-t border-border/60 pt-4">
                <div className="grid size-9 place-items-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                  <Users className="size-4" />
                </div>
                <div>
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Placeholder testimonials — to be replaced with real ones from early
          access brokers.
        </p>
      </Section>

      {/* ───────────── 8. FAQ ───────────── */}
      <Section id="faq" className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <Badge variant="outline" className="mb-3 border-emerald-500/30 text-emerald-700 dark:text-emerald-300">
            FAQ
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Frequently asked questions
          </h2>
        </div>
        <div className="glass rounded-2xl p-6">
          <Accordion type="single" collapsible className="w-full">
            {FAQS.map((item, i) => (
              <AccordionItem key={i} value={`item-${i}`}>
                <AccordionTrigger className="text-left text-base">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </Section>

      {/* ───────────── 9. Final CTA ───────────── */}
      <Section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="glass-strong relative overflow-hidden rounded-3xl p-8 text-center sm:p-16">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                "radial-gradient(50% 60% at 50% 30%, oklch(0.52 0.13 162 / 0.18) 0%, transparent 70%)",
            }}
          />
          <Factory className="mx-auto mb-4 size-10 text-emerald-600 dark:text-emerald-400" />
          <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
            Ready to digitize your brokerage?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Start your 14-day free trial today. No credit card. Set up in minutes.
            See your first auto-computed brokerage by tonight.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="gap-2 text-base">
              <a href={ctaHref}>
                {!checking && authed ? <Shield className="size-5" /> : <Zap className="size-5" />}
                {authed ? "Open Dashboard" : "Start Free Trial"}
              </a>
            </Button>
            {!authed && (
              <Button
                variant="outline"
                size="lg"
                onClick={() => router.push("/login")}
                className="border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
              >
                Sign in
              </Button>
            )}
          </div>
        </div>
      </Section>

      {/* ───────────── 10. Footer ───────────── */}
      <footer className="glass-strong mt-12 border-t border-border/60">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-sm">
              <div className="flex items-center gap-2">
                <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <Shirt className="size-4" />
                </div>
                <span className="font-semibold tracking-tight">Broker OS</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                A glassmorphic operations system for Indian garment brokers.
                Track every visit, booking, PO, dispatch, bill, payment and
                brokerage commission.
              </p>
            </div>
            <nav className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
              <a href="#features" className="text-muted-foreground transition-colors hover:text-foreground">
                Features
              </a>
              <a href="#pricing" className="text-muted-foreground transition-colors hover:text-foreground">
                Pricing
              </a>
              <a href="#faq" className="text-muted-foreground transition-colors hover:text-foreground">
                FAQ
              </a>
              <Link href="/privacy" className="text-muted-foreground transition-colors hover:text-foreground">
                Privacy Policy
              </Link>
              <Link href="/terms" className="text-muted-foreground transition-colors hover:text-foreground">
                Terms of Service
              </Link>
              <a href="mailto:support@broker-os.com" className="text-muted-foreground transition-colors hover:text-foreground">
                Contact
              </a>
            </nav>
          </div>
          <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex-row">
            <p>© {new Date().getFullYear()} Broker OS. Made for India&rsquo;s garment trade.</p>
            <div className="flex items-center gap-1.5">
              <Shield className="size-3.5 text-emerald-600" />
              <span>Supabase auth · Multi-tenant · 14-day trial on every plan</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
