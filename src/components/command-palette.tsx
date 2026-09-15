"use client";

import * as React from "react";
import {
  LayoutDashboard,
  BarChart3,
  Users,
  Factory,
  CalendarCheck,
  FileText,
  Truck,
  Receipt,
  Wallet,
  BadgePercent,
  AlertTriangle,
  Bell,
  ScrollText,
  Plus,
  Loader2,
  Settings,
  Store,
  Clock,
  Search,
  Coffee,
  Tag,
  ShieldCheck,
  Bookmark,
  LayoutTemplate,
  BookOpen,
  Code,
  CloudOff,
  CreditCard,
  ReceiptIndianRupee,
  TrendingUp,
  Scale,
  Banknote,
  FileSpreadsheet,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { useUI, type ViewKey } from "@/lib/ui-store";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type IconType = React.ComponentType<{ className?: string }>;

type NavItemDef = { key: ViewKey; label: string; icon: IconType };

const NAV_ITEMS: NavItemDef[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "digest", label: "Daily Digest", icon: Coffee },
  { key: "clients", label: "Clients", icon: Users },
  { key: "suppliers", label: "Suppliers", icon: Factory },
  { key: "tags", label: "Tags", icon: Tag },
  { key: "visits", label: "Visits", icon: CalendarCheck },
  { key: "pos", label: "Purchase Orders", icon: FileText },
  { key: "dispatches", label: "Dispatch Tracking", icon: Truck },
  { key: "draft-queue", label: "Draft Queue", icon: CloudOff },
  { key: "bills", label: "Bills", icon: Receipt },
  { key: "payments", label: "Payments", icon: Wallet },
  { key: "brokerage", label: "Brokerage", icon: BadgePercent },
  { key: "party-ledger", label: "Party Ledger", icon: BookOpen },
  { key: "expenses", label: "Expenses", icon: ReceiptIndianRupee },
  { key: "invoices", label: "Invoices", icon: FileText },
  { key: "billing", label: "Billing & Plan", icon: CreditCard },
  // ACC2-5 — Accounting group entries.
  { key: "pl-statement", label: "P&L Statement", icon: TrendingUp },
  { key: "gst-filing", label: "GST Filing", icon: FileSpreadsheet },
  { key: "trial-balance", label: "Trial Balance", icon: Scale },
  { key: "cash-flow", label: "Cash Flow", icon: Banknote },
  { key: "disputes", label: "Disputes", icon: AlertTriangle },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "saved-views", label: "Saved Views", icon: Bookmark },
  { key: "report-builder", label: "Report Builder", icon: LayoutTemplate },
  { key: "settings", label: "Settings", icon: Settings },
  { key: "portal", label: "Portals", icon: Store },
];

type QuickActionDef = {
  id: string;
  label: string;
  icon: IconType;
  view: ViewKey;
  toastMsg?: string;
};

const QUICK_ACTIONS: QuickActionDef[] = [
  { id: "new-client", label: "New client", icon: Plus, view: "clients", toastMsg: "Use the New client button" },
  { id: "record-payment", label: "Record payment", icon: Wallet, view: "payments", toastMsg: "Use the Record payment button" },
  { id: "log-dispute", label: "Log dispute", icon: AlertTriangle, view: "disputes", toastMsg: "Use the Log dispute button" },
  { id: "generate-bill", label: "Generate bill", icon: Receipt, view: "bills", toastMsg: "Use the Generate bill button" },
];

// ─── Unified search result (from /api/search) ────────────────────────────────
type SearchResultType =
  | "Client"
  | "Supplier"
  | "Visit"
  | "PurchaseOrder"
  | "Dispatch"
  | "Bill"
  | "Payment"
  | "Dispute"
  | "Notification"
  | "AuditLog";

type SearchResult = {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string;
  entityType: string;
  entityId: string;
};

// Group config — drives ordering, label, and icon per entity type.
type GroupConfig = {
  type: SearchResultType;
  label: string;
  icon: IconType;
};

const SEARCH_GROUPS: GroupConfig[] = [
  { type: "Client", label: "Clients", icon: Users },
  { type: "Supplier", label: "Suppliers", icon: Factory },
  { type: "PurchaseOrder", label: "Orders", icon: FileText },
  { type: "Bill", label: "Bills", icon: Receipt },
  { type: "Payment", label: "Payments", icon: Wallet },
  { type: "Dispute", label: "Disputes", icon: AlertTriangle },
  { type: "Visit", label: "Visits", icon: CalendarCheck },
  { type: "Dispatch", label: "Dispatches", icon: Truck },
  { type: "Notification", label: "Notifications", icon: Bell },
];

const ICON_BY_TYPE: Record<SearchResultType, IconType> = Object.fromEntries(
  SEARCH_GROUPS.map((g) => [g.type, g.icon]),
) as Record<SearchResultType, IconType>;

// ─── Recent searches (localStorage, last 5 unique) ───────────────────────────
const RECENT_KEY = "broker-os:recent-searches";
const RECENT_MAX = 5;

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === "string").slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function saveRecent(items: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, RECENT_MAX)));
  } catch {
    /* storage may be unavailable (private mode) — non-blocking */
  }
}

function pushRecent(prev: string[], query: string): string[] {
  const q = query.trim();
  if (!q) return prev;
  const without = prev.filter((s) => s.toLowerCase() !== q.toLowerCase());
  return [q, ...without].slice(0, RECENT_MAX);
}

export function CommandPalette() {
  const { cmdOpen, setCmdOpen, setView, openDetail } = useUI();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [recent, setRecent] = React.useState<string[]>([]);

  // Global Cmd+K (Mac) / Ctrl+K (Win/Linux) listener — toggles palette.
  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const state = useUI.getState();
        state.setCmdOpen(!state.cmdOpen);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Load recent searches from localStorage whenever the palette opens.
  React.useEffect(() => {
    if (cmdOpen) {
      setRecent(loadRecent());
    }
  }, [cmdOpen]);

  // Reset query + results whenever the palette closes.
  React.useEffect(() => {
    if (!cmdOpen) {
      setQuery("");
      setResults(null);
      setLoading(false);
    }
  }, [cmdOpen]);

  // Debounced single-fetch search against /api/search once the query is 2+ chars.
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const data = await api<{ results: SearchResult[] }>(
          `/api/search?q=${encodeURIComponent(q)}&limit=20`,
        );
        if (cancelled) return;
        setResults(data.results ?? []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const close = React.useCallback(() => setCmdOpen(false), [setCmdOpen]);

  // Selecting a search result: dispatch to the right action + record recent.
  const selectResult = React.useCallback(
    (r: SearchResult) => {
      // Record this query in recent searches (most-recent-first, unique).
      setRecent((prev) => {
        const next = pushRecent(prev, query.trim());
        saveRecent(next);
        return next;
      });
      switch (r.type) {
        case "Client":
          openDetail("Client", r.entityId);
          break;
        case "Supplier":
          openDetail("Supplier", r.entityId);
          break;
        case "PurchaseOrder":
          openDetail("PurchaseOrder", r.entityId);
          break;
        case "Bill":
          // Bills link to their parent PO.
          openDetail("PurchaseOrder", r.entityId);
          break;
        case "Visit":
          setView("visits");
          break;
        case "Payment":
          setView("payments");
          break;
        case "Dispute":
          setView("disputes");
          break;
        case "Notification":
          setView("notifications");
          break;
        case "Dispatch":
          setView("dispatches");
          break;
      }
      close();
    },
    [query, openDetail, setView, close],
  );

  // Clicking a recent search fills the input — the debounce effect re-searches.
  const selectRecent = React.useCallback((q: string) => {
    setQuery(q);
  }, []);

  const showSearchGroup = query.trim().length >= 2;
  const hasResults = !!results && results.length > 0;

  // Group results by entity type, preserving SEARCH_GROUPS order.
  const grouped = React.useMemo(() => {
    if (!results || results.length === 0) return [];
    const map = new Map<SearchResultType, SearchResult[]>();
    for (const r of results) {
      const list = map.get(r.type) ?? [];
      list.push(r);
      map.set(r.type, list);
    }
    return SEARCH_GROUPS.filter((g) => map.has(g.type)).map((g) => ({
      config: g,
      items: map.get(g.type)!,
    }));
  }, [results]);

  return (
    <Dialog open={cmdOpen} onOpenChange={setCmdOpen}>
      <DialogContent
        className={cn(
          "glass-strong top-[15vh] translate-y-0 gap-0 overflow-hidden rounded-2xl border p-0 sm:max-w-xl",
        )}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search views, quick actions, and records across Broker OS — clients, suppliers,
          orders, bills, payments, disputes, visits, dispatches, notifications, and audit log.
        </DialogDescription>
        <Command shouldFilter={false} className="bg-transparent">
          <CommandInput
            placeholder="Search clients, POs, bills, payments, disputes…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[60vh]">
            {/* When NOT searching: show recent + navigation + quick actions. */}
            {!showSearchGroup && (
              <>
                {recent.length > 0 && (
                  <CommandGroup heading="Recent searches">
                    {recent.map((q) => (
                      <CommandItem
                        key={`recent-${q}`}
                        value={`recent-${q}`}
                        onSelect={() => selectRecent(q)}
                      >
                        <Clock className="size-4 text-muted-foreground" />
                        <span>{q}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                <CommandGroup heading="Navigation">
                  {NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <CommandItem
                        key={item.key}
                        value={`nav-${item.key}-${item.label}`}
                        onSelect={() => {
                          setView(item.key);
                          close();
                        }}
                      >
                        <Icon className="size-4 text-muted-foreground" />
                        <span>{item.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>

                <CommandSeparator />

                <CommandGroup heading="Quick Actions">
                  {QUICK_ACTIONS.map((a) => {
                    const Icon = a.icon;
                    return (
                      <CommandItem
                        key={a.id}
                        value={`action-${a.id}-${a.label}`}
                        onSelect={() => {
                          setView(a.view);
                          if (a.toastMsg) toast(a.toastMsg);
                          close();
                        }}
                      >
                        <Icon className="size-4 text-muted-foreground" />
                        <span>{a.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}

            {/* When searching: show loading / count / results / empty. */}
            {showSearchGroup && (
              <>
                {/* Result count header (or searching indicator). */}
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                  {loading ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>Searching…</span>
                    </>
                  ) : results ? (
                    <span>
                      {results.length} result{results.length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>

                {!loading && !hasResults && (
                  <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-sm text-muted-foreground">
                    <Search className="size-5 opacity-50" />
                    <span>
                      No results for <span className="font-medium text-foreground">“{query.trim()}”</span>
                    </span>
                  </div>
                )}

                {!loading && hasResults && (
                  <>
                    {grouped.map(({ config, items }, gi) => {
                      const Icon = config.icon;
                      return (
                        <React.Fragment key={config.type}>
                          {gi > 0 && <CommandSeparator />}
                          <CommandGroup heading={config.label}>
                            {items.map((r) => {
                              const ItemIcon = ICON_BY_TYPE[r.type] ?? Icon;
                              return (
                                <CommandItem
                                  key={`${r.type}-${r.id}`}
                                  value={`${r.type}-${r.id}-${r.title}`}
                                  // Emerald accent for selected items.
                                  className="data-[selected=true]:!bg-emerald-500/15 data-[selected=true]:!text-emerald-50 [&_svg:not([class*='text-'])]:text-muted-foreground"
                                  onSelect={() => selectResult(r)}
                                >
                                  <ItemIcon className="size-4 text-emerald-400/80" />
                                  <div className="flex min-w-0 flex-col">
                                    <span className="truncate">{r.title}</span>
                                    {r.subtitle && (
                                      <span className="truncate text-xs text-muted-foreground">
                                        {r.subtitle}
                                      </span>
                                    )}
                                  </div>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </React.Fragment>
                      );
                    })}
                  </>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
