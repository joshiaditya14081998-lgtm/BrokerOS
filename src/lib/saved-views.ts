// Saved Views — pure helpers (no React, no Prisma) shared by the API routes,
// the SavedViewsBar component, and the Saved Views management page.
//
// A SavedView is a user-persisted filter combination for a list view
// (Clients / POs / Bills / Disputes / Audit / …). The filter state is stored
// as JSON in `filterJson`; this module owns the canonical icon set, the
// view-key → human-label map, and `summarizeFilter` which turns a parsed
// filter object into a single human-readable string used by both the save
// dialog preview and the Saved Views management page.

import {
  Star, Heart, Pin, Flag, Bookmark, type LucideIcon,
} from "lucide-react";
import { titleCase } from "@/lib/format";

// ── Icon set ──────────────────────────────────────────────────────────────────

export const SAVED_VIEW_ICONS = [
  "star", "heart", "pin", "flag", "bookmark",
] as const;
export type SavedViewIcon = (typeof SAVED_VIEW_ICONS)[number];

export const SAVED_VIEW_ICON_MAP: Record<SavedViewIcon, LucideIcon> = {
  star: Star,
  heart: Heart,
  pin: Pin,
  flag: Flag,
  bookmark: Bookmark,
};

export function isValidSavedViewIcon(icon: string): icon is SavedViewIcon {
  return (SAVED_VIEW_ICONS as readonly string[]).includes(icon);
}

export function getSavedViewIcon(name: string): LucideIcon {
  return SAVED_VIEW_ICON_MAP[isValidSavedViewIcon(name) ? name : "star"];
}

// ── View-key → label map ──────────────────────────────────────────────────────
//
// Used by the Saved Views management page to group entries by view type with
// a friendly heading. Kept here so the API route can validate `view` and the
// client can render headings from the same source of truth.

export const SAVED_VIEW_KEYS = [
  "clients", "suppliers", "pos", "bills", "disputes", "audit",
] as const;
export type SavedViewKey = (typeof SAVED_VIEW_KEYS)[number];

export const VIEW_LABELS: Record<string, string> = {
  clients: "Clients",
  suppliers: "Suppliers",
  pos: "Purchase Orders",
  bills: "Bills",
  disputes: "Disputes",
  audit: "Audit Trail",
};

export function isValidSavedViewKey(view: string): view is SavedViewKey {
  return (SAVED_VIEW_KEYS as readonly string[]).includes(view);
}

export function viewLabel(view: string): string {
  return VIEW_LABELS[view] ?? titleCase(view);
}

// ── Filter summary ────────────────────────────────────────────────────────────
//
// `summarizeFilter` takes a parsed filter object (the JSON stored in
// `filterJson`) and returns a single human-readable string like:
//
//   "Search: 'sharma' · Tags: VIP, Premium · Status: Open"
//
// It is defensive: any missing / unknown field is silently skipped, so a
// partially-populated filter (e.g. only `q`) still produces a useful summary.
//
// Shape expectations per view (all fields optional):
//   clients   → { q, selectedTagIds, selectedTagNames }
//   suppliers → { q, selectedTagIds, selectedTagNames }
//   pos       → { q, status, selectedTagIds, selectedTagNames }
//   bills     → { q, dueOnly }
//   disputes  → { q, filter }                   (filter = all|open|resolved|rejected)
//   audit     → { q, entityFilter, userFilter, fromDate, toDate }
//
// `selectedTagNames` is stored at save-time so the summary can render tag
// names without needing a DB lookup. If only `selectedTagIds` is present
// (older saved views or direct API use), the summary falls back to a count.

export type SavedFilter = Record<string, unknown>;

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function asBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

export function summarizeFilter(view: string, filter: unknown): string {
  if (!filter || typeof filter !== "object") return "No filters";
  const f = filter as SavedFilter;
  const parts: string[] = [];

  // Search query — present on every view.
  const q = asString(f.q)?.trim();
  if (q) parts.push(`Search: '${q}'`);

  // Tags — clients / suppliers / pos. Prefer stored names; fall back to count.
  const tagNames = asStringArray(f.selectedTagNames);
  const tagIds = asStringArray(f.selectedTagIds);
  if (tagNames.length > 0) {
    parts.push(`Tags: ${tagNames.join(", ")}`);
  } else if (tagIds.length > 0) {
    parts.push(`Tags: ${tagIds.length} selected`);
  }

  // POs status chip.
  const status = asString(f.status);
  if (status && status !== "all") {
    parts.push(`Status: ${titleCase(status.replace(/_/g, " "))}`);
  }

  // Bills "due only" toggle.
  if (asBool(f.dueOnly) === true) {
    parts.push("Due only");
  }

  // Disputes filter chip (all | open | resolved | rejected).
  const dFilter = asString(f.filter);
  if (dFilter && dFilter !== "all") {
    parts.push(`Status: ${titleCase(dFilter)}`);
  }

  // Audit-trail filters — entity type, user, date range.
  const entityFilter = asString(f.entityFilter);
  if (entityFilter && entityFilter !== "All") {
    parts.push(`Entity: ${titleCase(entityFilter)}`);
  }
  const userFilter = asString(f.userFilter);
  if (userFilter && userFilter !== "All") {
    parts.push(`User: ${userFilter}`);
  }
  const fromDate = asString(f.fromDate);
  if (fromDate) parts.push(`From: ${fromDate}`);
  const toDate = asString(f.toDate);
  if (toDate) parts.push(`To: ${toDate}`);

  // View-specific extras not covered above are ignored — the summary is a
  // best-effort human label, not a full serialisation.
  void view;

  return parts.length === 0 ? "No filters" : parts.join(" · ");
}

// ── Filter "is active" predicate ──────────────────────────────────────────────
//
// Returns true when the filter object has at least one non-default value,
// i.e. there's something worth saving. Used by the SavedViewsBar to decide
// whether to render the "Save current" affordance.
//
// Mirrors the defaults baked into each list view:
//   q === ""           (no search)
//   selectedTagIds     (empty array)
//   status === "all"   (POs default)
//   dueOnly === false  (bills default)
//   filter === "all"   (disputes default)
//   entityFilter === "All"  (audit default)
//   userFilter === "All"
//   fromDate / toDate === "" (audit default)

export function isFilterActive(filter: unknown): boolean {
  if (!filter || typeof filter !== "object") return false;
  const f = filter as SavedFilter;

  const q = asString(f.q)?.trim();
  if (q) return true;

  if (asStringArray(f.selectedTagIds).length > 0) return true;

  const status = asString(f.status);
  if (status && status !== "all") return true;

  if (asBool(f.dueOnly) === true) return true;

  const dFilter = asString(f.filter);
  if (dFilter && dFilter !== "all") return true;

  const entityFilter = asString(f.entityFilter);
  if (entityFilter && entityFilter !== "All") return true;

  const userFilter = asString(f.userFilter);
  if (userFilter && userFilter !== "All") return true;

  if (asString(f.fromDate)) return true;
  if (asString(f.toDate)) return true;

  return false;
}

// ── DTO shape ─────────────────────────────────────────────────────────────────
//
// The shape every API endpoint returns for a SavedView. Kept here so the
// client and server share a single type definition.

export type SavedViewDTO = {
  id: string;
  name: string;
  view: string;
  filterJson: string;
  entityType: string | null;
  icon: string;
  createdAt: string;
  updatedAt: string;
};

export function toSavedViewDTO(sv: {
  id: string;
  name: string;
  view: string;
  filterJson: string;
  entityType: string | null;
  icon: string;
  createdAt: Date;
  updatedAt: Date;
}): SavedViewDTO {
  return {
    id: sv.id,
    name: sv.name,
    view: sv.view,
    filterJson: sv.filterJson,
    entityType: sv.entityType,
    icon: sv.icon,
    createdAt: sv.createdAt.toISOString(),
    updatedAt: sv.updatedAt.toISOString(),
  };
}
