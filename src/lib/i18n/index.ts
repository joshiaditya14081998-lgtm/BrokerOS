// i18n barrel — exports the locale dictionary + the Locale union type.
//
// Lookup is intentionally simple: a flat `Record<Locale, TranslationDict>`
// keyed by ISO 639-1 code. `useTranslation().t(key)` does a direct lookup,
// falling back to English, then to the key itself (so a typo is loud but
// never crashes the render).

import { en, type TranslationDict } from "./en";
import { hi } from "./hi";
import { gu } from "./gu";

export type Locale = "en" | "hi" | "gu";

export const defaultLocale: Locale = "en";

export const translations: Record<Locale, TranslationDict> = {
  en,
  hi,
  gu,
};

// Languages shown in the Settings picker + the header badge. The `code` is
// the value persisted in the locale store; the `nativeName` is shown as the
// Select option text; `badge` is the short glyph rendered in the header.
export const LOCALE_OPTIONS: {
  code: Locale;
  nativeName: string;
  badge: string;
}[] = [
  { code: "en", nativeName: "English", badge: "EN" },
  { code: "hi", nativeName: "हिन्दी", badge: "हि" },
  { code: "gu", nativeName: "ગુજરાતી", badge: "ગુ" },
];

export type { TranslationDict };
