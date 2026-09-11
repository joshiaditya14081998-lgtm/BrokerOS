"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Shirt,
  Loader2,
  AlertCircle,
  Check,
  Star,
  Zap,
  Users,
  ArrowRight,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Plan catalogue — kept in sync with the backend `create-profile` route.
// ─────────────────────────────────────────────────────────────────────────────
type PlanId = "free" | "basic" | "pro" | "enterprise";

type PlanDef = {
  id: PlanId;
  name: string;
  price: number; // ₹ per month
  tagline: string;
  features: string[];
  highlight?: boolean;
};

const PLANS: PlanDef[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    tagline: "Try the full workflow.",
    features: [
      "5 clients / 5 suppliers",
      "10 POs",
      "50 photos",
      "Core modules",
    ],
  },
  {
    id: "basic",
    name: "Basic",
    price: 999,
    tagline: "For solo brokers.",
    features: [
      "50 clients / 50 suppliers",
      "200 POs",
      "500 photos",
      "Auto brokerage",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 2999,
    tagline: "Most popular.",
    features: [
      "Unlimited clients + POs",
      "5,000 photos",
      "Portal access",
      "Advanced analytics",
    ],
    highlight: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 9999,
    tagline: "For teams.",
    features: [
      "Everything unlimited",
      "Multi-user seats",
      "API access",
      "Dedicated manager",
    ],
  },
];

const VALID_PLANS: PlanId[] = ["free", "basic", "pro", "enterprise"];

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [plan, setPlan] = React.useState<PlanId>("free");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Pre-select the plan from the URL `?plan=` param (set by the pricing
  // section CTAs on the landing page). Falls back to "free" if invalid.
  React.useEffect(() => {
    const fromUrl = searchParams.get("plan");
    if (fromUrl && VALID_PLANS.includes(fromUrl as PlanId)) {
      setPlan(fromUrl as PlanId);
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    if (data.user) {
      // Auto-confirm email via server-side admin API (avoids requiring the
      // user to check their inbox). Then sign in immediately.
      try {
        await fetch("/api/auth/auto-confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: data.user.id }),
        });
        // Auto-login (sign in with the same credentials)
        await supabase.auth.signInWithPassword({ email, password });
      } catch {
        // Non-critical — user can login manually after email confirm
      }

      // Auto-create a Broker profile + Subscription in our DB
      try {
        await fetch("/api/auth/create-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName, plan }),
        });
      } catch {
        // Non-critical — profile will be auto-created on first API call
      }
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-500/10 via-background to-teal-500/10 p-4 py-8">
      <div className="glass-strong w-full max-w-2xl rounded-2xl p-8">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <Shirt className="size-7" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">Create Account</h1>
            <p className="text-sm text-muted-foreground">
              Start your 14-day Pro trial · No credit card required
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Full Name</Label>
            <Input
              id="name"
              type="text"
              placeholder="Ramesh Agarwal"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="broker@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Min 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          {/* Plan selector */}
          <div className="space-y-2.5 pt-2">
            <Label>Choose your plan</Label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {PLANS.map((p) => {
                const selected = plan === p.id;
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => setPlan(p.id)}
                    aria-pressed={selected}
                    className={cn(
                      "group relative flex flex-col rounded-xl border p-4 text-left transition-all duration-200",
                      "glass hover-lift",
                      selected
                        ? "border-emerald-500 ring-2 ring-emerald-500/60"
                        : "border-border hover:border-emerald-500/40",
                    )}
                  >
                    {p.highlight && !selected && (
                      <div className="absolute -top-2.5 right-3">
                        <Badge className="bg-emerald-500 text-primary-foreground shadow">
                          <Star className="size-3" /> Popular
                        </Badge>
                      </div>
                    )}
                    {selected && (
                      <div className="absolute -top-2.5 right-3">
                        <Badge className="bg-emerald-500 text-primary-foreground shadow">
                          <Check className="size-3" /> Selected
                        </Badge>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">{p.name}</div>
                      <div className="text-sm font-light tabular-nums">
                        {p.price === 0 ? "₹0" : `₹${p.price.toLocaleString("en-IN")}`}
                      </div>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{p.tagline}</p>
                    <ul className="mt-3 space-y-1">
                      {p.features.map((f) => (
                        <li
                          key={f}
                          className="flex items-start gap-1.5 text-[11px] text-foreground/80"
                        >
                          <Check className="mt-0.5 size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              All plans start with a 14-day Pro trial. Switch or cancel anytime.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" className="w-full gap-2" disabled={loading}>
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Zap className="size-4" />
            )}
            {loading ? "Creating account…" : `Start 14-day free trial`}
          </Button>
        </form>

        <div className="mt-6 flex flex-col gap-3 text-center text-sm text-muted-foreground">
          <p>
            Already have an account?{" "}
            <button
              onClick={() => router.push("/login")}
              className="font-medium text-primary hover:underline"
            >
              Sign in
            </button>
          </p>
          <p className="flex items-center justify-center gap-1.5 text-xs">
            <Users className="size-3.5 text-emerald-600" />
            <span>Multi-tenant · Supabase auth · Your data stays yours</span>
          </p>
        </div>

        <div className="mt-6 border-t border-border/60 pt-4 text-center">
          <a
            href="/landing"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowRight className="size-3.5 rotate-180" />
            Back to landing page
          </a>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>}>
      <SignupForm />
    </Suspense>
  );
}
