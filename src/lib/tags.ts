// Shared tag colour palette + helpers — used by the API (server) and the UI
// (client). Keeping the source-of-truth list in one place prevents drift
// between the API validation and the TagBadge / picker swatches.

export const TAG_COLORS = [
  "emerald",
  "amber",
  "rose",
  "teal",
  "plum",
  "slate",
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

export function isValidTagColor(c: unknown): c is TagColor {
  return typeof c === "string" && (TAG_COLORS as readonly string[]).includes(c);
}

// Tailwind class mapping per colour — used by TagBadge and the picker swatch.
// Light + dark variants so the pills stay legible in both themes.
export const TAG_COLOR_CLASS: Record<string, string> = {
  emerald:
    "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
  amber:
    "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300",
  rose: "bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-300",
  teal: "bg-teal-500/15 text-teal-700 border-teal-500/30 dark:text-teal-300",
  plum: "bg-fuchsia-500/15 text-fuchsia-700 border-fuchsia-500/30 dark:text-fuchsia-300",
  slate:
    "bg-slate-500/15 text-slate-700 border-slate-500/30 dark:text-slate-300",
};

// Solid swatch colour — used by the picker's colour-select buttons + the Tags
// management grid cards (the small dot on the card header).
export const TAG_SWATCH_CLASS: Record<string, string> = {
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  teal: "bg-teal-500",
  plum: "bg-fuchsia-500",
  slate: "bg-slate-500",
};

// Allowed entity types for the polymorphic EntityTag — kept in sync with the
// `entityType` column comments in prisma/schema.prisma.
export const TAG_ENTITY_TYPES = ["Client", "Supplier", "PurchaseOrder"] as const;
export type TagEntityType = (typeof TAG_ENTITY_TYPES)[number];

export function isValidEntityType(t: unknown): t is TagEntityType {
  return typeof t === "string" && (TAG_ENTITY_TYPES as readonly string[]).includes(t);
}

// Maps an entityType string to the matching Prisma FK field name on EntityTag.
// Used by /api/tags/assign + /api/tags/unassign so a single code path stays
// correct across all three entity kinds.
export function entityFkField(t: TagEntityType): "clientId" | "supplierId" | "purchaseOrderId" {
  switch (t) {
    case "Client": return "clientId";
    case "Supplier": return "supplierId";
    case "PurchaseOrder": return "purchaseOrderId";
  }
}

// Lightweight Tag shape — what the API returns to the client.
export type TagDTO = {
  id: string;
  name: string;
  color: string;
  createdAt: string;
};
