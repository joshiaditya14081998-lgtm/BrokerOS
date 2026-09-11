"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shirt, Loader2, AlertCircle, Factory, Users, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

type PartyType = "supplier" | "client";

export default function PortalLoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [partyType, setPartyType] = React.useState<PartyType>("supplier");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/portal");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-500/10 via-background to-teal-500/10 p-4">
      <div className="glass-strong w-full max-w-md rounded-2xl p-8">
        {/* Logo + heading */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <Shirt className="size-7" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">Portal Login</h1>
            <p className="text-sm text-muted-foreground">
              Supplier &amp; client self-service portal
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Party type toggle */}
          <div className="space-y-2">
            <Label>I am a…</Label>
            <div className="grid grid-cols-2 gap-2">
              <PartyButton
                active={partyType === "supplier"}
                onClick={() => setPartyType("supplier")}
                icon={<Factory className="size-4" />}
                label="Supplier"
              />
              <PartyButton
                active={partyType === "client"}
                onClick={() => setPartyType("client")}
                icon={<Users className="size-4" />}
                label="Client"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {partyType === "supplier"
                ? "Log in to view POs awaiting dispatch, your recent shipments, and brokerage earned."
                : "Log in to view your orders, outstanding bills, payment history, and deliveries."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder={partyType === "supplier" ? "supplier@example.com" : "client@example.com"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {loading ? "Signing in…" : `Sign in as ${partyType === "supplier" ? "Supplier" : "Client"}`}
          </Button>
        </form>

        <div className="mt-6 space-y-3 text-center">
          <p className="text-xs text-muted-foreground">
            Don&apos;t have a portal account? Ask your broker to enable portal access for you.
          </p>
          <button
            onClick={() => router.push("/login")}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
          >
            <ExternalLink className="size-3" />
            Broker sign in
          </button>
        </div>
      </div>
    </div>
  );
}

function PartyButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all",
        active
          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 shadow-sm dark:text-emerald-300"
          : "border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70 hover:text-foreground",
      )}
    >
      <span className={cn(active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}
