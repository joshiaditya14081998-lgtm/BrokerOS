import type { NextRequest } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
// Server-side i18n helper (Task 20-c)
//
// The client-side i18n (Task 18-b) handles UI labels via Zustand + the
// `useTranslation` hook — but server-generated content (notification messages,
// action-center item titles/descriptions) was still hardcoded English. When a
// broker switches to Hindi/Gujarati, the UI chrome translated but the content
// delivered by the API stayed English.
//
// This module:
//   1. Reads the `locale` query param that the client `api()` helper now
//      appends to every GET request (see src/lib/api.ts).
//   2. Holds the small translation maps for the two server-side content
//      channels — notifications + action-center — so both API routes can use a
//      single source of truth instead of duplicating strings.
//   3. Exposes `translateNotification` and `translateAction` that pick the
//      template for the requested locale, then `{placeholder}`-interpolate the
//      caller-provided params.
//
// Design notes:
//   - Templates use `{name}` placeholders. A simple regex replaces them; if a
//     param is missing, the placeholder is left intact so the gap is visible
//     during dev (better than silently dropping context).
//   - English (en) templates match the original hardcoded strings exactly, so
//     there is zero behavior change for the default locale — only hi/gu users
//     see new translations.
//   - The maps are intentionally inline (not imported from the client i18n
//     files) so the server bundle stays small and decoupled from the client's
//     TranslationDict shape.
// ─────────────────────────────────────────────────────────────────────────────

export type SupportedLocale = "en" | "hi" | "gu";

/**
 * Read the `locale` query param from the request URL. Defaults to "en" for any
 * missing / unrecognized value. Accepts only the three supported locale codes;
 * anything else falls back to English so a malformed `?locale=fr` can't crash
 * the lookup.
 */
export function getLocale(req: NextRequest): SupportedLocale {
  const raw = req.nextUrl.searchParams.get("locale");
  if (raw === "en" || raw === "hi" || raw === "gu") return raw;
  return "en";
}

/**
 * Replace `{name}` placeholders in `template` with values from `params`.
 * Missing keys are left as `{name}` (visible during dev, never crashes).
 */
function interpolate(
  template: string,
  params: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(params, key)
      ? String(params[key])
      : match;
  });
}

// ── Notification templates ───────────────────────────────────────────────────
//
// Four notification channels (visit_followup, dispatch_due, payment_due,
// brokerage_due). Each has a title + message template per locale. The English
// strings match the original hardcoded values verbatim.
type NotificationTemplate = { title: string; message: string };

const NOTIFICATION_TEMPLATES: Record<string, Record<SupportedLocale, NotificationTemplate>> = {
  visit_followup: {
    en: {
      title: "Follow up: {client}",
      message: "Visit was scheduled for {date} — client hasn't shown. Call to reschedule.",
    },
    hi: {
      title: "फॉलो-अप: {client}",
      message: "विज़िट {date} को निर्धारित थी — क्लाइंट नहीं आया। पुनः शेड्यूल करने के लिए कॉल करें।",
    },
    gu: {
      title: "ફોલો-અપ: {client}",
      message: "વિઝિટ {date} માટે નિર્ધારિત હતી — ક્લાયન્ટ નથી આવ્યા. ફરી શેડ્યૂલ કરવા માટે કૉલ કરો.",
    },
  },
  dispatch_due: {
    en: {
      title: "Dispatch due: {poNumber}",
      message: "{supplier} — dispatch {status}. Due {date}.",
    },
    hi: {
      title: "डिस्पैच देय: {poNumber}",
      message: "{supplier} — डिस्पैच {status}। देय तिथि {date}।",
    },
    gu: {
      title: "ડિસ્પેચ બાકી: {poNumber}",
      message: "{supplier} — ડિસ્પેચ {status}. બાકી {date}.",
    },
  },
  payment_due: {
    en: {
      title: "Payment due: {billNumber}",
      message: "{client} — {amount} due. Bill {status}.",
    },
    hi: {
      title: "भुगतान देय: {billNumber}",
      message: "{client} — {amount} देय। बिल {status}।",
    },
    gu: {
      title: "ચુકવણી બાકી: {billNumber}",
      message: "{client} — {amount} બાકી. બિલ {status}.",
    },
  },
  brokerage_due: {
    en: {
      title: "Brokerage payout due: {client}",
      message: "{amount} eligible — {cadence} cadence. {n} brokerage(s) pending payout.",
    },
    hi: {
      title: "ब्रोकरेज भुगतान देय: {client}",
      message: "{amount} पात्र — {cadence} कैडेंस। {n} ब्रोकरेज भुगतान के लिए लंबित।",
    },
    gu: {
      title: "બ્રોકરેજ ચુકવણી બાકી: {client}",
      message: "{amount} પાત્ર — {cadence} કેડન્સ. {n} બ્રોકરેજ ચુકવણી માટે બાકી.",
    },
  },
};

/**
 * Translate a notification. `type` is one of: visit_followup, dispatch_due,
 * payment_due, brokerage_due. `params` provides the `{placeholder}` values.
 *
 * Unknown types fall back to a generic English template so the notification
 * still renders (never throws) — but this should never happen in practice
 * since the generator only emits the four known types.
 */
export function translateNotification(
  type: string,
  locale: string,
  params: Record<string, string>,
): { title: string; message: string } {
  const map = NOTIFICATION_TEMPLATES[type];
  const loc: SupportedLocale =
    locale === "hi" || locale === "gu" ? locale : "en";
  const tpl = map?.[loc] ?? {
    title: type,
    message: "",
  };
  return {
    title: interpolate(tpl.title, params),
    message: interpolate(tpl.message, params),
  };
}

// ── Action-center templates ──────────────────────────────────────────────────
//
// Action item titles + descriptions. The action-center has 8 distinct
// (title, description) patterns across the 5 channels — the visit channel
// alone has 3 variants (overdue follow-up, re-follow-up, upcoming), and the
// payment channel has 2 (past-due vs. upcoming). Each is keyed separately so
// the caller picks the right template explicitly rather than trying to encode
// the variant inside a param.
type ActionTemplate = { title: string; description: string };

const ACTION_TEMPLATES: Record<string, Record<SupportedLocale, ActionTemplate>> = {
  // (a) Visit — overdue scheduled visit.
  visit_followup_overdue: {
    en: {
      title: "Follow up with {client}",
      description: "Visit was {days} ago. Call to reschedule.",
    },
    hi: {
      title: "{client} का फॉलो-अप करें",
      description: "विज़िट {days} पहले थी। पुनः शेड्यूल करने के लिए कॉल करें।",
    },
    gu: {
      title: "{client} નો ફોલો-અપ કરો",
      description: "વિઝિટ {days} પહેલા હતી. ફરી શેડ્યૂલ કરવા કૉલ કરો.",
    },
  },
  // (a) Visit — re-follow-up (was followed_up but plannedDate is >3d past).
  visit_refollow: {
    en: {
      title: "Re-follow-up: {client}",
      description: "Original visit was {days} ago and still pending closure.",
    },
    hi: {
      title: "पुनः फॉलो-अप: {client}",
      description: "मूल विज़िट {days} पहले थी और अभी भी बंद होना बाकी है।",
    },
    gu: {
      title: "ફરી ફોલો-અપ: {client}",
      description: "મૂળ વિઝિટ {days} પહેલા હતી અને હજુ બંધ થવાની વાકે.",
    },
  },
  // (a) Visit — upcoming scheduled within next 3d (with a `days` value).
  visit_upcoming: {
    en: {
      title: "Upcoming visit: {client}",
      description: "Visit scheduled in {days}.",
    },
    hi: {
      title: "आगामी विज़िट: {client}",
      description: "विज़िट {days} में निर्धारित।",
    },
    gu: {
      title: "આગામી વિઝિટ: {client}",
      description: "વિઝિટ {days} માં નિર્ધારિત.",
    },
  },
  // (a) Visit — upcoming scheduled for today (no `days` placeholder).
  visit_upcoming_today: {
    en: {
      title: "Upcoming visit: {client}",
      description: "Visit scheduled for today.",
    },
    hi: {
      title: "आगामी विज़िट: {client}",
      description: "विज़िट आज निर्धारित।",
    },
    gu: {
      title: "આગામી વિઝિટ: {client}",
      description: "વિઝિટ આજે નિર્ધારિત.",
    },
  },
  // (b) Dispatch due.
  dispatch: {
    en: {
      title: "Record dispatch: {poNumber}",
      description: "Supplier {supplier} dispatch is overdue.",
    },
    hi: {
      title: "{poNumber} का डिस्पैच रिकॉर्ड करें",
      description: "सप्लायर {supplier} का डिस्पैच अतिदेय है।",
    },
    gu: {
      title: "{poNumber} નો ડિસ્પેચ રેકોર્ડ કરો",
      description: "સપ્લાયર {supplier} નો ડિસ્પેચ વધારે બાકી છે.",
    },
  },
  // (c) Payment — past due.
  payment_past: {
    en: {
      title: "Collect payment: {billNumber}",
      description: "{client} owes {amount}. {days} overdue.",
    },
    hi: {
      title: "{billNumber} का भुगतान वसूलें",
      description: "{client} पर {amount} बकाया। {days} अतिदेय।",
    },
    gu: {
      title: "{billNumber} ની ચુકવણી વસૂલો",
      description: "{client} પર {amount} બાકી. {days} વધારે બાકી.",
    },
  },
  // (c) Payment — upcoming within 7d (with a `days` value).
  payment_upcoming: {
    en: {
      title: "Collect payment: {billNumber}",
      description: "{client} owes {amount}. Due in {days}.",
    },
    hi: {
      title: "{billNumber} का भुगतान वसूलें",
      description: "{client} पर {amount} बकाया। {days} में देय।",
    },
    gu: {
      title: "{billNumber} ની ચુકવણી વસૂલો",
      description: "{client} પર {amount} બાકી. {days} માં બાકી.",
    },
  },
  // (c) Payment — due today.
  payment_upcoming_today: {
    en: {
      title: "Collect payment: {billNumber}",
      description: "{client} owes {amount}. Due today.",
    },
    hi: {
      title: "{billNumber} का भुगतान वसूलें",
      description: "{client} पर {amount} बकाया। आज देय।",
    },
    gu: {
      title: "{billNumber} ની ચુકવણી વસૂલો",
      description: "{client} પર {amount} બાકી. આજે બાકી.",
    },
  },
  // (d) Brokerage payout (aggregated per client).
  brokerage: {
    en: {
      title: "Pay out brokerage: {client}",
      description: "{amount} eligible for {cadence} payout.",
    },
    hi: {
      title: "{client} को ब्रोकरेज चुकाएं",
      description: "{amount} पात्र — {cadence} भुगतान के लिए।",
    },
    gu: {
      title: "{client} ને બ્રોકરેજ ચૂકવો",
      description: "{amount} પાત્ર — {cadence} ચુકવણી માટે.",
    },
  },
  // (e) Dispute resolution.
  dispute: {
    en: {
      title: "Resolve dispute: {poNumber}",
      description: "{typeLabel} — {desc}. Open for {days}.",
    },
    hi: {
      title: "{poNumber} का विवाद सुलझाएं",
      description: "{typeLabel} — {desc}। {days} से खुला।",
    },
    gu: {
      title: "{poNumber} નો વિવાદ ઉકેલો",
      description: "{typeLabel} — {desc}. {days} થી ખુલ્લું.",
    },
  },
};

/**
 * Translate an action-center item. `type` is one of the keys in
 * ACTION_TEMPLATES above. `params` provides the `{placeholder}` values.
 *
 * Unknown types fall back to a generic English template so the action still
 * renders (never throws).
 */
export function translateAction(
  type: string,
  locale: string,
  params: Record<string, string>,
): { title: string; description: string } {
  const map = ACTION_TEMPLATES[type];
  const loc: SupportedLocale =
    locale === "hi" || locale === "gu" ? locale : "en";
  const tpl = map?.[loc] ?? {
    title: type,
    description: "",
  };
  return {
    title: interpolate(tpl.title, params),
    description: interpolate(tpl.description, params),
  };
}
