"use client";

import * as React from "react";
import { useLocale } from "@/lib/locale-store";
import { translations, defaultLocale, type Locale } from "@/lib/i18n";

// Translation hook for client components.
//
// Reads the broker's selected interface locale from the persisted Zustand
// store and returns a `t(key)` function that resolves a dot-notation key
// against the active locale's dictionary.
//
// Lookup order:
//   1. Current locale's dictionary.
//   2. English dictionary (source of truth) — guarantees that a partial
//      translation never shows a raw key for a string we DO have in English.
//   3. The key itself — so a typo'd key is loud (visible in the UI) rather
//      than silently returning `undefined` and crashing a downstream
//      `text-truncate` or similar.
//
// Hydration: the store is created with `skipHydration: true`, so on the
// server (and the very first client render) we always render in
// `defaultLocale` ("en"). `rehydrate()` runs in a `useEffect` so the saved
// locale applies on mount without a server/client hydration mismatch.
export function useTranslation(): {
  t: (key: string) => string;
  locale: Locale;
  setLocale: (l: Locale) => void;
} {
  const locale = useLocale((s) => s.locale);
  const setLocale = useLocale((s) => s.setLocale);

  // Rehydrate the persisted locale exactly once on mount. Safe no-op if
  // already hydrated.
  React.useEffect(() => {
    void useLocale.persist?.rehydrate?.();
  }, []);

  const t = React.useCallback(
    (key: string): string => {
      const dict = translations[locale] ?? translations[defaultLocale];
      const value = dict[key as keyof typeof dict];
      if (typeof value === "string") return value;
      // Fallback 1: English source of truth.
      const fallback = translations[defaultLocale][key as keyof typeof translations[typeof defaultLocale]];
      if (typeof fallback === "string") return fallback;
      // Fallback 2: the key itself (so missing keys are visible, not empty).
      return key;
    },
    [locale],
  );

  return { t, locale, setLocale };
}
