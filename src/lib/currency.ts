// Multi-currency display support for the Broker OS.
//
// All financial amounts are stored in the database in INR (Indian Rupees).
// This module provides display-layer conversion to any supported currency
// using STATIC exchange rates (no live FX feed). Conversion is approximate
// and intended for display / reference only — ledger entries, audit logs and
// bills always preserve the INR source of truth.
//
// Symbols follow the project style rules: emerald accent, NO indigo/blue.

export type Currency = {
  code: string;
  symbol: string;
  name: string;
  rate: number; // INR → target currency (1 INR = rate units of target)
};

// Static rates are approximate (≈ Q1 2025 references). They are NOT live and
// should never be used to settle real invoices — purely a display convenience
// for brokers working with international clients/suppliers.
export const CURRENCIES: Currency[] = [
  { code: "INR", symbol: "₹", name: "Indian Rupee", rate: 1.0 },
  { code: "USD", symbol: "$", name: "US Dollar", rate: 0.012 },
  { code: "EUR", symbol: "€", name: "Euro", rate: 0.011 },
  { code: "GBP", symbol: "£", name: "British Pound", rate: 0.0095 },
  { code: "AED", symbol: "د.إ", name: "UAE Dirham", rate: 0.044 },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar", rate: 0.016 },
  { code: "AUD", symbol: "A$", name: "Australian Dollar", rate: 0.018 },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar", rate: 0.016 },
];

const DEFAULT_CURRENCY: Currency = CURRENCIES[0];

export function getCurrency(code: string | null | undefined): Currency {
  if (!code) return DEFAULT_CURRENCY;
  const found = CURRENCIES.find((c) => c.code === code);
  return found ?? DEFAULT_CURRENCY;
}

export function getCurrencySymbol(code: string | null | undefined): string {
  return getCurrency(code).symbol;
}

// Convert an INR amount into the target currency using the static rate.
// Returns 0 for non-finite inputs to keep the UI safe against NaN/Infinity.
export function convertFromINR(amountInr: number, currencyCode: string): number {
  const value = Number.isFinite(amountInr) ? amountInr : 0;
  const cur = getCurrency(currencyCode);
  return value * cur.rate;
}

// Compact number formatting. Indian numbering uses lakhs (L) and crores (Cr);
// international currencies use thousands (K) and millions (M).
function formatCompact(value: number, currency: Currency): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (currency.code === "INR") {
    if (abs >= 1_00_00_000) {
      // ≥ 1 crore
      return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`;
    }
    if (abs >= 1_00_000) {
      // ≥ 1 lakh
      return `${sign}₹${(abs / 1_00_000).toFixed(2)}L`;
    }
    if (abs >= 1_000) {
      return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
    }
    return `${sign}₹${Math.round(abs)}`;
  }

  // International compact: K / M / B
  if (abs >= 1_000_000_000) {
    return `${sign}${currency.symbol}${(abs / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${currency.symbol}${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${currency.symbol}${(abs / 1_000).toFixed(1)}K`;
  }
  return `${sign}${currency.symbol}${formatFractional(abs, currency)}`;
}

// Full-precision formatting (no K/L/M suffix). Uses 0 decimals for INR (and
// large international amounts) and 2 decimals for fractional international
// amounts (e.g. $734.58) so the live-preview sample in Settings looks right.
function formatFractional(value: number, currency: Currency): string {
  if (currency.code === "INR") {
    // Full rupees — paisa is rarely relevant for broker-level amounts.
    return new Intl.NumberFormat("en-IN", {
      maximumFractionDigits: 0,
    }).format(Math.round(value));
  }
  // International: 2 decimals (e.g. $734.58, €567.34, £582.43).
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

// Format an INR amount in the target currency, applying the conversion rate.
// `opts.compact` toggles the K/L/M suffix form; default is full precision.
export function formatCurrencyIn(
  amountInr: number,
  currencyCode: string,
  opts?: { compact?: boolean },
): string {
  const cur = getCurrency(currencyCode);
  const converted = convertFromINR(amountInr, currencyCode);
  if (opts?.compact) {
    return formatCompact(converted, cur);
  }
  return `${cur.symbol}${formatFractional(converted, cur)}`;
}

// Convenience for live-preview / debug: format the same INR amount in BOTH
// the base INR and a target currency, e.g. "₹61,215 = $734.58".
export function formatConversionPreview(
  amountInr: number,
  currencyCode: string,
): string {
  const inrStr = formatCurrencyIn(amountInr, "INR");
  const targetStr = formatCurrencyIn(amountInr, currencyCode);
  return `${inrStr} = ${targetStr}`;
}
