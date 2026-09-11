"use client";

export const dynamic = "force-dynamic";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { GlassCard } from "@/components/shared";
import { EmptyState } from "@/components/shared";
import { Shirt, LogOut, Factory, Users, AlertCircle, Link2Off } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  SupplierPortalDashboard,
  ClientPortalDashboard,
  type SupplierPortalData,
  type ClientPortalData,
} from "@/components/views/portal-view";

// `/api/portal/me` response shape.
type MeResponse = {
  partyType: "client" | "supplier" | null;
  party: {
    id: string;
    name: string;
    email: string | null;
    contactPerson: string | null;
  } | null;
};

// `/api/portal/data?partyType=X&partyId=Y` response shape — same as the existing
// `/api/portal` route but scoped to the logged-in party only.
type PortalData = SupplierPortalData | ClientPortalData;

export default function PortalPage() {
  const router = useRouter();
  const supabase = createClient();

  const [bootstrapping, setBootstrapping] = React.useState(true);
  const [me, setMe] = React.useState<MeResponse | null>(null);
  const [meError, setMeError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<PortalData | null>(null);
  const [dataError, setDataError] = React.useState<string | null>(null);
  const [loadingData, setLoadingData] = React.useState(false);

  // Bootstrap: read the Supabase session, then call /api/portal/me to find the
  // linked party. If no session, redirect to /portal/login.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/portal/login");
        return;
      }
      try {
        const res = await fetch("/api/portal/me", { headers: { "Content-Type": "application/json" } });
        if (res.status === 401) {
          // Session expired — bounce to login.
          router.replace("/portal/login");
          return;
        }
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`API /api/portal/me → ${res.status}: ${txt}`);
        }
        const payload = (await res.json()) as MeResponse;
        if (cancelled) return;
        setMe(payload);
      } catch (e) {
        if (cancelled) return;
        setMeError(e instanceof Error ? e.message : "Failed to load portal profile");
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router, supabase]);

  // Fetch the portal data once we know the party type + id.
  const party = me?.party;
  const partyType = me?.partyType;
  React.useEffect(() => {
    if (!party || !partyType) return;
    let cancelled = false;
    setLoadingData(true);
    setDataError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/portal/data?partyType=${partyType}&partyId=${party.id}`,
          { headers: { "Content-Type": "application/json" } },
        );
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`API /api/portal/data → ${res.status}: ${txt}`);
        }
        const payload = (await res.json()) as PortalData;
        if (!cancelled) setData(payload);
      } catch (e) {
        if (!cancelled) setDataError(e instanceof Error ? e.message : "Failed to load portal data");
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => { cancelled = true; };
  }, [party?.id, partyType]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/portal/login");
    router.refresh();
  }

  // ─── Bootstrap / loading / error states ────────────────────────────────────
  if (bootstrapping) {
    return (
      <PortalShell partyName={null} onSignOut={handleSignOut}>
        <div className="space-y-4">
          <Skeleton className="h-24 rounded-2xl" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </PortalShell>
    );
  }

  if (meError) {
    return (
      <PortalShell partyName={null} onSignOut={handleSignOut}>
        <EmptyState
          title="Couldn't load your portal profile"
          hint={meError}
          icon={<AlertCircle className="size-5" />}
        />
      </PortalShell>
    );
  }

  // No linked party — the Supabase auth user isn't tied to any Client or
  // Supplier row. This happens when a broker creates a portal login but hasn't
  // linked it to a party yet, or for a broker who happens to land here.
  if (!party || !partyType) {
    return (
      <PortalShell partyName={null} onSignOut={handleSignOut}>
        <GlassCard className="p-6">
          <div className="flex flex-col items-start gap-4">
            <div className="grid size-12 place-items-center rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <Link2Off className="size-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Your account is not linked to a client or supplier</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This Supabase login is not yet tied to a party record. Please
                contact your broker and ask them to enable portal access for you
                — they&apos;ll link your email to your client or supplier
                profile, after which you&apos;ll see your own data here.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="mr-1.5 size-4" />
              Sign out
            </Button>
          </div>
        </GlassCard>
      </PortalShell>
    );
  }

  // ─── Render the appropriate portal dashboard ────────────────────────────────
  return (
    <PortalShell partyName={party.name} partyType={partyType} onSignOut={handleSignOut}>
      {loadingData && !data ? (
        <div className="space-y-4">
          <Skeleton className="h-24 rounded-2xl" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : dataError ? (
        <EmptyState
          title="Couldn't load your portal data"
          hint={dataError}
          icon={<AlertCircle className="size-5" />}
        />
      ) : !data ? (
        <EmptyState title="No data available" icon={<AlertCircle className="size-5" />} />
      ) : partyType === "supplier" && data.persona === "supplier" ? (
        <SupplierPortalDashboard data={data} />
      ) : partyType === "client" && data.persona === "client" ? (
        <ClientPortalDashboard data={data} />
      ) : (
        <EmptyState
          title="Mismatched portal data"
          hint={`Expected ${partyType} portal data but got ${data.persona}.`}
          icon={<AlertCircle className="size-5" />}
        />
      )}
    </PortalShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PortalShell — minimal header (no broker sidebar) for the portal experience.
// Sticky on top, glass surface, emerald accent. Responsive.
// ─────────────────────────────────────────────────────────────────────────────
function PortalShell({
  partyName,
  partyType,
  onSignOut,
  children,
}: {
  partyName: string | null;
  partyType?: "client" | "supplier" | null;
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-500/5 via-background to-teal-500/5">
      <header className="glass-strong sticky top-0 z-20 border-b border-border/40">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow">
              <Shirt className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">
                {partyName ?? "Portal"}
              </p>
              <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                {partyType === "supplier" ? (
                  <>
                    <Factory className="size-3" /> Supplier portal
                  </>
                ) : partyType === "client" ? (
                  <>
                    <Users className="size-3" /> Client portal
                  </>
                ) : (
                  "Self-service portal"
                )}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onSignOut}>
            <LogOut className="mr-1.5 size-4" />
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
