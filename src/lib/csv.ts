// CSV helpers — pure (server + client safe), no DOM access.
// The API route uses `toCSV` directly; clients can use `downloadCSV` for ad-hoc exports.

export type CsvColumn = { key: string; label: string };

/**
 * Convert an array of records to a CSV string.
 * - Properly escapes values containing commas, double quotes, or newlines by
 *   wrapping them in double quotes and doubling any internal double quotes.
 * - Renders null/undefined as an empty cell.
 * - Numbers are rendered with their natural string form (no thousand separators).
 * - Dates are rendered in ISO format for portability.
 * - Booleans render as "true" / "false".
 */
export function toCSV(
  rows: Record<string, unknown>[],
  columns: CsvColumn[],
): string {
  const escapeCell = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    let str: string;
    if (value instanceof Date) {
      str = value.toISOString();
    } else if (typeof value === "boolean") {
      str = value ? "true" : "false";
    } else if (typeof value === "number") {
      str = Number.isFinite(value) ? String(value) : "";
    } else if (typeof value === "object") {
      // Render objects/arrays as JSON so nested data is preserved.
      try {
        str = JSON.stringify(value);
      } catch {
        str = "";
      }
    } else {
      str = String(value);
    }
    // Escape: wrap in quotes if the value contains comma, quote, newline, or carriage return.
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = columns.map((c) => escapeCell(c.label)).join(",");
  const body = rows
    .map((row) => columns.map((c) => escapeCell(row[c.key])).join(","))
    .join("\r\n");

  // BOM-prefixed so Excel detects UTF-8.
  return `\uFEFF${header}\r\n${body}`;
}

/**
 * Client-only: build a Blob from a CSV string and trigger a browser download.
 * Safe to call from event handlers in client components only.
 */
export function downloadCSV(filename: string, csv: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Defer revoke to give the browser a tick to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
