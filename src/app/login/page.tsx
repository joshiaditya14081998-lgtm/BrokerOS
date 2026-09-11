"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shirt, Loader2, AlertCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const redirect = searchParams.get("redirect") || "/";

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

    router.push(redirect);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-500/10 via-background to-teal-500/10 p-4">
      <div className="glass-strong w-full max-w-md rounded-2xl p-8">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <Shirt className="size-7" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">Broker OS</h1>
            <p className="text-sm text-muted-foreground">Garment Brokerage Operations</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="broker@example.com"
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
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <div className="mt-6 space-y-3">
          <p className="text-center text-sm text-muted-foreground">
            New broker?{" "}
            <button
              onClick={() => router.push("/signup")}
              className="font-medium text-primary hover:underline"
            >
              Create an account
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>}>
      <LoginForm />
    </Suspense>
  );
}
