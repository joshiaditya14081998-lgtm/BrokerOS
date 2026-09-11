"use client";

import * as React from "react";
import {
  Menu, Bell, Search, Coins, Languages, LogOut, User, Settings2,
  CloudOff, RefreshCw, Loader2, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sidebar } from "@/components/sidebar";
import { useUI } from "@/lib/ui-store";
import { createClient } from "@/lib/supabase/client";
import { CommandPalette } from "@/components/command-palette";
import { useNotificationsSocket } from "@/hooks/use-notifications-socket";
import { useTranslation } from "@/hooks/use-translation";
import { LOCALE_OPTIONS } from "@/lib/i18n";
import { DashboardView } from "@/components/views/dashboard-view";
import { AnalyticsView } from "@/components/views/analytics-view";
import { DigestView } from "@/components/views/digest-view";
import { ClientsView } from "@/components/views/clients-view";
import { SuppliersView } from "@/components/views/suppliers-view";
import { VisitsView } from "@/components/views/visits-view";
import { PosView } from "@/components/views/pos-view";
import { DispatchesView } from "@/components/views/dispatches-view";
import { BillsView } from "@/components/views/bills-view";
import { PaymentsView } from "@/components/views/payments-view";
import { BrokerageView } from "@/components/views/brokerage-view";
import { PartyLedgerView } from "@/components/views/party-ledger-view";
import { DisputesView } from "@/components/views/disputes-view";
import { NotificationsView } from "@/components/views/notifications-view";
import { AuditView } from "@/components/views/audit-view";
import { TagsView } from "@/components/views/tags-view";
import { DataHealthView } from "@/components/views/data-health-view";
import { SavedViewsView } from "@/components/views/saved-views-view";
import { ReportBuilderView } from "@/components/views/report-builder-view";
import { SettingsView } from "@/components/views/settings-view";
import { PortalView } from "@/components/views/portal-view";
import { ApiDocsView } from "@/components/views/api-docs-view";
import { DraftQueueView } from "@/components/views/draft-queue-view";
import { BillingView } from "@/components/views/billing-view";
import { ClientDetailSheet } from "@/components/views/client-detail-sheet";
import { SupplierDetailSheet } from "@/components/views/supplier-detail-sheet";
import { PoDetailSheet } from "@/components/views/po-detail-sheet";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { ShortcutsOverlay } from "@/components/shortcuts-overlay";
import { ShortcutPrefixIndicator } from "@/components/shortcut-prefix-indicator";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type OnboardingState = {
  needsOnboarding: boolean;
  clientCount: number;
  supplierCount: number;
  hasCompletedOnboarding: boolean;
};

// View title translation keys — looked up by `useTranslation().t(key)`.
// Each view maps to a `{key}.title` + `{key}.subtitle` translation entry.
// Keeping this as a key map (rather than a static English string map)
// means the header title + subtitle re-render instantly whenever the broker
// switches the interface language via the Settings picker.
const VIEW_TITLE_KEYS: Record<string, { titleKey: string; subKey: string }> = {
  dashboard: { titleKey: "dashboard.title", subKey: "dashboard.subtitle" },
  analytics: { titleKey: "analytics.title", subKey: "analytics.subtitle" },
  digest: { titleKey: "digest.title", subKey: "digest.subtitle" },
  clients: { titleKey: "clients.title", subKey: "clients.subtitle" },
  suppliers: { titleKey: "suppliers.title", subKey: "suppliers.subtitle" },
  visits: { titleKey: "visits.title", subKey: "visits.subtitle" },
  pos: { titleKey: "nav.purchaseOrders", subKey: "pos.subtitle" },
  dispatches: { titleKey: "dispatches.title", subKey: "dispatches.subtitle" },
  bills: { titleKey: "bills.title", subKey: "bills.subtitle" },
  payments: { titleKey: "payments.title", subKey: "payments.subtitle" },
  brokerage: { titleKey: "brokerage.title", subKey: "brokerage.subtitle" },
  "party-ledger": { titleKey: "partyLedger.title", subKey: "partyLedger.subtitle" },
  disputes: { titleKey: "disputes.title", subKey: "disputes.subtitle" },
  notifications: { titleKey: "notifications.title", subKey: "notifications.subtitle" },
  audit: { titleKey: "audit.title", subKey: "audit.subtitle" },
  "data-health": { titleKey: "dataHealth.title", subKey: "dataHealth.subtitle" },
  tags: { titleKey: "tags.title", subKey: "tags.subtitle" },
  "saved-views": { titleKey: "savedViews.title", subKey: "savedViews.subtitle" },
  "report-builder": { titleKey: "nav.reportBuilder", subKey: "reportBuilder.subtitle" },
  "api-docs": { titleKey: "apiDocs.title", subKey: "apiDocs.subtitle" },
  settings: { titleKey: "settings.title", subKey: "settings.subtitle" },
  portal: { titleKey: "portals.title", subKey: "portals.subtitle" },
  "draft-queue": { titleKey: "draftQueue.title", subKey: "draftQueue.subtitle" },
  drafts: { titleKey: "draftQueue.title", subKey: "draftQueue.subtitle" },
  // SA2 — Billing & Plan view title + subtitle.
  billing: { titleKey: "billing.title", subKey: "billing.subtitle" },
};

export default function Page() {
  const { view, setView, setCmdOpen } = useUI();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [userEmail, setUserEmail] = React.useState<string | null>(null);
  // SA2 — destructured `t` + `locale` from `useTranslation()` (was `const t =
  // useTranslation();` which assigned the whole return object and made
  // `t(meta.titleKey)` crash at runtime with "t is not a function"). Combined
  // the two prior `useTranslation()` calls into one to avoid the double hook
  // invocation.
  const { t, locale } = useTranslation();
  const meta = VIEW_TITLE_KEYS[view] ?? VIEW_TITLE_KEYS.dashboard;
  const metaTitle = t(meta.titleKey);
  const metaSub = t(meta.subKey);
  const { count, connected, lastNotification } = useNotificationsSocket();
  const { symbol, currency } = useCurrencyFormat();
  const localeBadge = LOCALE_OPTIONS.find((o) => o.code === locale)?.badge ?? locale.toUpperCase();

  // Sprint 4 — online/offline + draft queue status. Powers the header dot /
  // offline badge + the sync badge + the global offline banner above the
  // main content. `useOnlineStatus` is SSR-safe (returns `true` on server +
  // first paint to avoid hydration mismatch); `useOfflineSync` reads the
  // IndexedDB draft queue (`src/lib/offline-db.ts`) and exposes the pending
  // count + a manual sync trigger.
  const { isOnline } = useOnlineStatus();
  const { pendingCount, syncing } = useOfflineSync();

  // Auth gate (SaaS marketing flow). On mount we ask Supabase for the current
  // user. If there is no session, we redirect to the public `/landing`
  // marketing page — NOT to `/login` directly — so the visitor lands on the
  // sales pitch first and picks signup/login from the CTA. If there IS a
  // session, we fall through to the existing app-shell behaviour. The middleware
  // already redirects unauthenticated `/` requests to `/landing`; this is a
  // defensive client-side fallback for any edge case the server check misses
  // (e.g. a stale cookie / hot reload right after sign-out).
  const [authed, setAuthed] = React.useState<boolean | null>(null);

  // SA2 — read the `?view=<key>` URL param on mount + after the auth check
  // passes, so the mock checkout redirect (`/?view=billing`) lands on the
  // Billing view. Once the view is set, the param is stripped from the URL
  // via history.replaceState so subsequent navigations don't carry it.
  const appliedUrlView = React.useRef(false);
  React.useEffect(() => {
    if (appliedUrlView.current) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const v = params.get("view");
    if (!v) return;
    // Only honour keys that exist in the ViewKey union (defensive — a
    // hand-typed `?view=foo` should never crash the router).
    const known = new Set<string>([
      "dashboard", "analytics", "digest", "clients", "suppliers", "visits",
      "pos", "dispatches", "bills", "payments", "brokerage", "party-ledger",
      "disputes", "notifications", "audit", "data-health", "tags",
      "saved-views", "report-builder", "api-docs", "settings", "portal",
      "drafts", "draft-queue", "billing",
    ]);
    if (!known.has(v)) return;
    appliedUrlView.current = true;
    setView(v as never);
    params.delete("view");
    const qs = params.toString();
    const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", newUrl);
  }, [setView]);

  // Fetch current user email on mount
  React.useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        // Soft client-side redirect — preserves browser history.
        window.location.replace("/landing");
        return;
      }
      setAuthed(true);
      setUserEmail(user.email ?? null);
    });
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success("Signed out");
    window.location.href = "/login";
  };

  const initials = userEmail
    ? userEmail.split("@")[0].slice(0, 2).toUpperCase()
    : "?";

  // Global keyboard shortcuts (g-prefix navigation, n-prefix create, ? help,
  // / search, Esc dismiss). Returns the active prefix mode so we can render
  // the floating "g —" / "n —" indicator.
  const { prefixMode } = useKeyboardShortcuts();

  // First-run onboarding gate. On mount we ask the API whether the broker has
  // completed onboarding (or whether the DB is still empty). If yes, the
  // wizard overlay opens. After the wizard closes, we re-check + bump
  // `viewRefreshKey` so the active view re-fetches (the wizard may have added
  // clients/suppliers or loaded demo data).
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [viewRefreshKey, setViewRefreshKey] = React.useState(0);
  const didOnboardingCheck = React.useRef(false);

  const refreshOnboarding = React.useCallback(() => {
    fetch("/api/onboarding")
      .then((r) => r.json())
      .then((d: OnboardingState) => {
        if (d.needsOnboarding) setWizardOpen(true);
      })
      .catch(() => {
        /* non-blocking — if the check fails, skip the wizard */
      });
  }, []);

  React.useEffect(() => {
    if (didOnboardingCheck.current) return;
    didOnboardingCheck.current = true;
    refreshOnboarding();
  }, [refreshOnboarding]);

  const handleWizardClose = React.useCallback(() => {
    setWizardOpen(false);
    // Remount the active view so it re-fetches (the wizard may have added
    // records or loaded demo data).
    setViewRefreshKey((k) => k + 1);
  }, []);

  // Fire a toast exactly once per new notification id.
  const lastShownId = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!lastNotification) return;
    if (lastShownId.current === lastNotification.id) return;
    lastShownId.current = lastNotification.id;
    toast(lastNotification.title, {
      description: lastNotification.message ?? undefined,
    });
  }, [lastNotification]);

  // While the auth check is in flight, render a calm loading screen so the
  // broker never sees a flash of the app shell with no data. This sits AFTER
  // every hook above so it doesn't violate rules-of-hooks (early return only
  // once all hooks have run for this render).
  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-6 animate-spin text-emerald-600" />
          <p className="text-sm">Loading your workspace…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <div className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block">
          <Sidebar />
        </div>

        {/* Mobile sidebar via sheet */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-64 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Sidebar />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="glass sticky top-0 z-20 flex items-center gap-3 border-b border-border/60 px-4 py-3 lg:px-8">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
            </Sheet>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{metaTitle}</h1>
              <p className="truncate text-xs text-muted-foreground">{metaSub}</p>
            </div>
            {/* Search / command palette trigger.
                On desktop this is styled to look like an input field (wider,
                with a subtle border + placeholder text + ⌘K hint) — clicking
                it opens the full command palette which owns the real search
                logic (single source of truth). */}
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className="glass hidden h-9 w-full max-w-xs items-center gap-2 rounded-lg border border-border/60 px-3 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground sm:flex lg:w-80"
              aria-label="Open command palette"
            >
              <Search className="size-4 shrink-0" />
              <span className="flex-1 truncate text-left">Search clients, POs, bills, payments…</span>
              <kbd className="pointer-events-none select-none rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">⌘K</kbd>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="relative sm:hidden"
              onClick={() => setCmdOpen(true)}
              aria-label="Open command palette"
            >
              <Search className="size-5" />
            </Button>
            {/* Display-currency badge — shows the broker's currently selected
                display currency (symbol + code, e.g. "₹ INR"). Clicking it
                opens the Settings view, where the currency selector lives.
                Amounts are stored in INR; this only controls display. */}
            <button
              type="button"
              onClick={() => setView("settings")}
              className="glass inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border/60 px-2 py-1 text-xs font-medium text-foreground transition-colors hover:border-emerald-500/40 hover:text-emerald-700 dark:hover:text-emerald-300"
              aria-label={`Display currency: ${currency}. Click to change in settings.`}
              title={`Display currency — ${currency}. Amounts are stored in INR.`}
            >
              <Coins className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="font-mono font-semibold">{symbol}</span>
              <span className="text-muted-foreground">{currency}</span>
            </button>
            {/* Language badge — shows the current interface locale's short
                glyph (e.g. "EN" / "हि" / "ગુ"). Clicking it opens Settings
                where the full language picker lives. The badge is compact
                (text-xs px-2 py-1) and mirrors the currency badge's styling
                so the two read as a pair. Re-renders instantly on locale
                change because `locale` flows from the Zustand store. */}
            <button
              type="button"
              onClick={() => setView("settings")}
              className="glass inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border/60 px-2 py-1 text-xs font-medium text-foreground transition-colors hover:border-emerald-500/40 hover:text-emerald-700 dark:hover:text-emerald-300"
              aria-label={`Interface language: ${localeBadge}. Click to change in settings.`}
              title={`Interface language — ${localeBadge}. Click to open the language picker in Settings.`}
            >
              <Languages className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="font-semibold">{localeBadge}</span>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              onClick={() => useUI.setState({ view: "notifications" })}
              aria-label={`Notifications${count && count > 0 ? ` (${count} pending)` : ""}`}
            >
              <Bell className="size-5" />
              {count !== null && count > 0 && (
                <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-rose-500 text-[10px] font-bold text-white ring-2 ring-background">
                  {count > 9 ? "9+" : count}
                </span>
              )}
              <span
                aria-hidden
                className={
                  "absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-background " +
                  (connected ? "bg-emerald-500" : "bg-zinc-400")
                }
              />
              <span className="sr-only">
                {connected ? "Real-time updates connected" : "Real-time updates offline"}
              </span>
            </Button>
            {/* Online / offline indicator — subtle emerald dot when online,
                clickable amber "Offline" badge (pulsing) when offline.
                Clicking the badge opens the Draft Queue so the broker can see
                what's queued for sync. Sits just before the user avatar so the
                broker's connectivity state is the rightmost status signal. */}
            {isOnline ? (
              <span
                aria-label="Online"
                title="Online — changes save to the server immediately"
                className="inline-block size-2.5 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20"
              />
            ) : (
              <button
                type="button"
                onClick={() => setView("drafts")}
                aria-label="Offline — drafts will sync when you reconnect. Click to open the Draft Queue."
                title="Offline — drafts will sync when you reconnect. Click to open the Draft Queue."
                className="glass relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/15"
              >
                <span
                  aria-hidden
                  className="absolute -left-0.5 -top-0.5 size-2 rounded-full bg-amber-500 animate-pulse"
                />
                <CloudOff className="size-3.5" />
                <span>Offline</span>
              </button>
            )}
            {/* Sync status badge — shown only when there's something to
                communicate. While a sync pass is running, swaps to a teal
                "Syncing…" pill with a spinner. When drafts are pending,
                shows an amber "{N} drafts" badge that opens the Draft Queue.
                When the queue is empty, renders nothing so the header stays
                clean for the common online case. */}
            {syncing ? (
              <span
                aria-label="Syncing drafts…"
                title="Syncing drafts…"
                className="glass inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-teal-500/40 bg-teal-500/10 px-2.5 py-1 text-xs font-medium text-teal-700 dark:text-teal-300"
              >
                <Loader2 className="size-3.5 animate-spin" />
                <span>Syncing…</span>
              </span>
            ) : pendingCount > 0 ? (
              <button
                type="button"
                onClick={() => setView("drafts")}
                aria-label={`${pendingCount} pending draft${pendingCount === 1 ? "" : "s"}. Click to open the Draft Queue.`}
                title={`${pendingCount} pending draft${pendingCount === 1 ? "" : "s"}. Click to open the Draft Queue.`}
                className="glass inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/15"
              >
                <RefreshCw className="size-3.5" />
                <span>{pendingCount} draft{pendingCount === 1 ? "" : "s"}</span>
              </button>
            ) : null}
            {/* User menu — avatar + email + logout */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="glass flex shrink-0 items-center gap-2 rounded-lg border border-border/60 p-1 transition-colors hover:border-emerald-500/40"
                  aria-label="User menu"
                >
                  <Avatar className="size-7">
                    <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="glass-strong w-56">
                <DropdownMenuLabel className="flex items-center gap-2 text-xs">
                  <User className="size-3 text-muted-foreground" />
                  <span className="truncate font-normal text-muted-foreground">
                    {userEmail ?? "Not signed in"}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setView("settings")}>
                  <Settings2 className="mr-2 size-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-rose-600 dark:text-rose-400 focus:text-rose-600"
                >
                  <LogOut className="mr-2 size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          {/* Main content */}
          <main className="flex-1 px-4 py-6 lg:px-8">
            {/* Offline banner — thin amber strip at the top of the main
                content. NOT sticky: it scrolls with the page so it only shows
                once at the top of the current view (per spec). Auto-hides
                when the browser regains connectivity (`isOnline === true`).
                CloudOff icon + amber background + emerald body text — the
                amber signals the disconnected state, the emerald reassures
                the broker that their changes are still safe (queued locally). */}
            {!isOnline && (
              <div className="glass mb-5 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm">
                <CloudOff className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-emerald-700 dark:text-emerald-300">
                  You're offline — changes will be saved as drafts and synced automatically when you reconnect.
                </p>
              </div>
            )}
            <ViewRouter key={viewRefreshKey} view={view} />
          </main>
        </div>
      </div>

      {/* Footer (sticky bottom) */}
      <footer className="glass mt-auto border-t border-border/60 px-4 py-3 text-center text-xs text-muted-foreground lg:px-8">
        <span className="font-medium text-foreground/80">{t("footer.brand")}</span> · {t("footer.tagline")} ·
        <span className="ml-1">{t("footer.builtWith")}</span> ·
        <span className="ml-1 text-primary">{t("footer.note")}</span>
      </footer>

      {/* Detail sheets (rendered globally, controlled by ui-store) */}
      <DetailSheets />

      {/* Global command palette (Cmd+K / Ctrl+K) */}
      <CommandPalette />

      {/* Keyboard shortcuts help overlay (toggled by "?" key) */}
      <ShortcutsOverlay />

      {/* Floating "g —" / "n —" indicator shown while a prefix key is active */}
      <ShortcutPrefixIndicator mode={prefixMode} />

      {/* First-run onboarding wizard (controlled by /api/onboarding) */}
      <OnboardingWizard open={wizardOpen} onClose={handleWizardClose} />
    </div>
  );
}

function ViewRouter({ view }: { view: string }) {
  switch (view) {
    case "dashboard": return <DashboardView />;
    case "analytics": return <AnalyticsView />;
    case "digest": return <DigestView />;
    case "clients": return <ClientsView />;
    case "suppliers": return <SuppliersView />;
    case "visits": return <VisitsView />;
    case "pos": return <PosView />;
    case "dispatches": return <DispatchesView />;
    case "bills": return <BillsView />;
    case "payments": return <PaymentsView />;
    case "brokerage": return <BrokerageView />;
    case "party-ledger": return <PartyLedgerView />;
    case "disputes": return <DisputesView />;
    case "notifications": return <NotificationsView />;
    case "audit": return <AuditView />;
    case "data-health": return <DataHealthView />;
    case "tags": return <TagsView />;
    case "saved-views": return <SavedViewsView />;
    case "report-builder": return <ReportBuilderView />;
    case "api-docs": return <ApiDocsView />;
    case "settings": return <SettingsView />;
    case "portal": return <PortalView />;
    // Sprint 4 — Draft Queue. S4A's production view renders under both the
    // `draft-queue` key (sidebar nav + command palette) and the `drafts` key
    // (S4B's header offline/sync badge + Settings Network Status card
    // navigate here). Both routes land on the same component so the broker
    // sees a consistent UX regardless of entry point.
    case "draft-queue":
    case "drafts": return <DraftQueueView />;
    case "billing": return <BillingView />;
    default: return <DashboardView />;
  }
}

function DetailSheets() {
  const { detailType, detailId, closeDetail } = useUI();
  if (!detailType || !detailId) return null;
  if (detailType === "Client") return <ClientDetailSheet id={detailId} onClose={closeDetail} />;
  if (detailType === "Supplier") return <SupplierDetailSheet id={detailId} onClose={closeDetail} />;
  if (detailType === "PurchaseOrder") return <PoDetailSheet id={detailId} onClose={closeDetail} />;
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// DraftsViewFallback — minimal Draft Queue shown when the broker navigates
// to the `drafts` view (via the header offline badge or the Settings Network
// Status card) before S4A's production `DraftsView` ships. Renders the live
// pending-count KPI, a manual "Sync now" button, and a list of queued drafts
// (with type + status + retry count + error). S4A will replace this with a
// richer component (edit, retry, per-draft discard, filtering) — this stub
// is intentionally small but functional so the offline UX is end-to-end
// usable during the parallel-build window.
// ────────────────────────────────────────────────────────────────────────────
function DraftsViewFallback() {
  const { drafts, pendingCount, syncing, lastSync, syncNow, discard } = useOfflineSync();
  const { isOnline } = useOnlineStatus();
  const { setView } = useUI();
  const lastSyncLabel = lastSync
    ? lastSync.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Never";
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Draft Queue"
        description="Offline drafts waiting to sync. New entries appear here when submissions can't reach the server."
        action={
          <Button
            size="sm"
            onClick={() => void syncNow()}
            disabled={syncing || pendingCount === 0 || !isOnline}
          >
            {syncing ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 size-4" />
            )}
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        }
      />
      <GlassCard className="hover-lift p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <DraftStat
            label="Pending"
            value={String(pendingCount)}
            tone={pendingCount > 0 ? "amber" : "emerald"}
            icon={<RefreshCw className="size-3.5" />}
          />
          <DraftStat
            label="Status"
            value={isOnline ? "Online" : "Offline"}
            tone={isOnline ? "emerald" : "amber"}
            icon={isOnline ? <CheckCircle2 className="size-3.5" /> : <CloudOff className="size-3.5" />}
          />
          <DraftStat
            label="Last sync"
            value={lastSyncLabel}
            tone="default"
            icon={<RefreshCw className="size-3.5" />}
          />
          <DraftStat
            label="Total queued"
            value={String(drafts.length)}
            tone="default"
            icon={<RefreshCw className="size-3.5" />}
          />
        </div>
      </GlassCard>
      {drafts.length === 0 ? (
        <EmptyState
          title="No drafts queued"
          hint="When you submit a booking, dispatch, or payment while offline, it'll appear here and sync automatically once you reconnect."
          icon={<CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />}
        />
      ) : (
        <div className="space-y-3">
          {drafts.map((d) => (
            <GlassCard key={d.id} className="hover-lift p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        "capitalize",
                        d.status === "pending" && "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                        d.status === "syncing" && "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300",
                        d.status === "failed" && "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
                        d.status === "synced" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                      )}
                    >
                      {d.status}
                    </Badge>
                    <Badge variant="outline" className="capitalize">{d.type}</Badge>
                    {d.retryCount > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        retry {d.retryCount}×
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {new Date(d.createdAt).toLocaleString()}
                  </p>
                  {d.error && (
                    <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{d.error}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void discard(d.id)}
                  className="border-rose-500/30 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                >
                  Discard
                </Button>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setView("dashboard")}>
          Back to dashboard
        </Button>
      </div>
    </div>
  );
}

function DraftStat({
  label, value, tone = "default", icon,
}: {
  label: string;
  value: string;
  tone?: "default" | "emerald" | "amber";
  icon?: React.ReactNode;
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";
  return (
    <div className="glass flex flex-col gap-1 rounded-xl border border-border/50 p-3">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className={cn("kpi-num text-sm font-semibold", toneClass)}>{value}</p>
    </div>
  );
}
