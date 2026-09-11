"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { UserCheck, Link2, Unlink, Loader2, AlertCircle, Mail, ExternalLink } from "lucide-react";
import { toast } from "sonner";

// PortalAccessSection — broker-side UI for enabling/disabling portal access
// for a single party (Client or Supplier).
//
// States:
//   1. Not linked (`userId === null`): renders the "Enable portal access"
//      button. Clicking opens a Dialog asking for the party's email — defaults
//      to the party row's existing `email` field if present. Submitting calls
//      POST /api/portal/invite which creates (or finds) a Supabase Auth user
//      by that email and links the resulting user id to the party row.
//   2. Linked (`userId !== null`): renders a "Portal enabled" badge + the
//      email + a "Disable" button. Disabling calls DELETE /api/portal/invite
//      which clears the `userId` field (does NOT delete the Supabase auth
//      user; the broker can do that in the Supabase dashboard if needed).
//
// Both actions fire a toast on success/failure and call `onLinkedChange()` so
// the parent sheet can refetch its data and update its UI immediately.
//
// `partyEmail` is the email currently on the party row (string | null) —
// used as the dialog's default value when enabling access. After a
// successful invite, the API also writes this email back to the party row,
// so the next refetch surfaces it in the "Portal enabled — {email}" state.
export function PortalAccessSection({
  partyType,
  partyId,
  userId,
  partyEmail,
  onLinkedChange,
}: {
  partyType: "client" | "supplier";
  partyId: string;
  userId: string | null;
  partyEmail: string | null;
  onLinkedChange?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState(partyEmail ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Keep the email input in sync with the party's email whenever the dialog
  // is re-opened (the party email may change between opens).
  React.useEffect(() => {
    if (open) {
      setEmail(partyEmail ?? "");
      setError(null);
    }
  }, [open, partyEmail]);

  const enabled = !!userId;

  async function handleEnable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Email is required");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/portal/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partyType, partyId, email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      toast.success(
        data?.created
          ? "Portal access enabled — new login created"
          : "Portal access enabled — existing login linked",
      );
      setOpen(false);
      onLinkedChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enable portal access");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    if (!enabled) return;
    setBusy(true);
    try {
      const res = await fetch("/api/portal/invite", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partyType, partyId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      toast.success("Portal access disabled");
      onLinkedChange?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to disable portal access");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border/40 bg-card/30 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <UserCheck className="size-3.5" />Portal access
      </div>
      {enabled ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            >
              <UserCheck className="size-3" />Enabled
            </Badge>
            {partyEmail ? (
              <span className="inline-flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
                <Mail className="size-3 shrink-0" />
                <span className="truncate">{partyEmail}</span>
              </span>
            ) : null}
            <a
              href="/portal/login"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:underline dark:text-emerald-400"
            >
              <ExternalLink className="size-3" />Open portal
            </a>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleDisable}
            disabled={busy}
            className="h-8 border-rose-500/30 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
          >
            {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Unlink className="mr-1.5 size-3.5" />}
            Disable
          </Button>
        </div>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button type="button" size="sm" variant="outline" className="h-8">
              <Link2 className="mr-1.5 size-3.5" />Enable portal access
            </Button>
          </DialogTrigger>
          <DialogContent className="glass-strong sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Enable portal access</DialogTitle>
              <DialogDescription>
                Create a Supabase login for this {partyType === "client" ? "client" : "supplier"} so they can sign in
                at <span className="font-medium text-foreground">/portal/login</span> and see only their own data. If a
                Supabase user already exists with this email, it will be linked instead of creating a new one.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleEnable} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="portal-email">Email</Label>
                <Input
                  id="portal-email"
                  type="email"
                  placeholder={partyType === "supplier" ? "supplier@example.com" : "client@example.com"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              {error ? (
                <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                A temporary password will be generated. The {partyType} should reset it via the
                &ldquo;Forgot password&rdquo; link on the portal login page.
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  {busy ? "Enabling…" : "Enable access"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
