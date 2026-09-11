// Shared formatting + financial helpers for the Broker OS

import { formatCurrencyIn } from "@/lib/currency";

export function formatCurrency(amount: number, opts?: { compact?: boolean }): string {
  const value = Number.isFinite(amount) ? amount : 0;
  if (opts?.compact && Math.abs(value) >= 100000) {
    // Indian numbering — lakhs
    const lakhs = value / 100000;
    return `₹${lakhs.toFixed(2)}L`;
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

// Server-safe currency conversion formatter.
//
// Mirrors `useCurrencyFormat().format()` but without the React/Zustand hook
// dependency — safe to call from API route handlers, server components, PDF
// generators, CSV exporters, etc. The caller passes the explicit
// `currencyCode` (e.g. "USD", "EUR", "INR"). For INR this is equivalent to
// `formatCurrency(amount, opts)`.
export function formatCurrencyWith(
  amountInr: number,
  currencyCode: string,
  opts?: { compact?: boolean },
): string {
  return formatCurrencyIn(amountInr, currencyCode, opts);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-IN").format(Number.isFinite(n) ? n : 0);
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Compact "01 Aug" form — used for date-span chips/badges where the year
// would be redundant (e.g. intra-year range selectors).
export function formatDateShort(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function daysSince(date: Date | string): number {
  return daysBetween(new Date(), new Date(date));
}

// Status → tailwind class for muted color-coded chips
export function statusChipClass(status: string): string {
  const s = status.toLowerCase();
  if (["fully_paid", "fully_delivered", "delivered", "resolved", "occurred", "done", "paid"].includes(s)) {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  }
  if (["partially_paid", "partially_delivered", "in_transit", "scheduled", "followed_up", "accrued"].includes(s)) {
    return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
  }
  if (["pending", "open", "no_show", "short_shipment", "defective_return", "overdue"].includes(s)) {
    return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30";
  }
  if (["closed", "rejected", "dismissed"].includes(s)) {
    return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30";
  }
  return "bg-primary/10 text-primary border-primary/25";
}

export function titleCase(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// JSON parse helper that never throws
export function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
