"use client";

import * as React from "react";
import { useCurrency } from "@/lib/currency-store";
import { formatCurrencyIn, getCurrencySymbol, getCurrency } from "@/lib/currency";

// Currency-aware format hook for client components.
//
// Reads the broker's selected display currency from the persisted Zustand
// store and returns a `format(amountInr, opts?)` function that converts and
// formats INR amounts into the selected currency.
//
// Hydration: the store is created with `skipHydration: true`, so on the
// server (and the very first client render) we always use INR. We call
// `rehydrate()` in a `useEffect` so the saved currency applies on mount
// without triggering a server/client hydration mismatch.
export function useCurrencyFormat(): {
  format: (amountInr: number, opts?: { compact?: boolean }) => string;
  currency: string;
  symbol: string;
} {
  const currency = useCurrency((s) => s.currency);

  // Rehydrate the persisted currency preference exactly once on mount.
  // The `persist` API is attached to the bound store itself (not the state
  // returned by the hook) — safe no-op if already hydrated.
  React.useEffect(() => {
    void useCurrency.persist?.rehydrate?.();
  }, []);

  const format = React.useCallback(
    (amountInr: number, opts?: { compact?: boolean }) =>
      formatCurrencyIn(amountInr, currency, opts),
    [currency],
  );

  return {
    format,
    currency,
    symbol: getCurrencySymbol(currency),
  };
}

// Re-export selected helpers so view components can `import { getCurrency }`
// from a single module if they need the full Currency object (e.g. for the
// Settings live-preview sample).
export { getCurrencySymbol, getCurrency };
