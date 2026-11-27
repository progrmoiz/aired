/**
 * Entries as CSV, for the owner's export (dashboard, GET
 * /api/pages/:id/responses.csv, get_responses with format "csv").
 *
 * Columns: id, viewer, key, created_at, updated_at, then one column per
 * top-level field, in the order fields first appear. A nested value is
 * written as JSON. Cells are quoted per RFC 4180, and a cell that starts
 * with = + - @ or a tab or carriage return gets a leading ' so a
 * spreadsheet shows it as text instead of running it as a formula (viewer
 * input lands in the owner's spreadsheet). Numbers and booleans are left
 * as they are, since a negative number is data, not a formula.
 *
 * No imports, so tests load it directly.
 */

/** One saved entry (lib/collect-store.ts re-exports this). */
export type Entry = {
  id: string;
  viewer: string;
  key: string | null;
  data: unknown;
  createdAt: number;
  updatedAt: number;
};

const FIXED = ["id", "viewer", "key", "created_at", "updated_at"] as const;

/** One CSV cell from a string. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function cellOf(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return csvCell(v);
  return csvCell(JSON.stringify(v));
}

/** The field columns for these entries, in the order they first appear, oldest entry first. */
export function fieldColumns(entries: Entry[]): string[] {
  const seen = new Set<string>();
  for (const e of [...entries].sort((a, b) => a.createdAt - b.createdAt)) {
    if (e.data && typeof e.data === "object" && !Array.isArray(e.data)) {
      for (const k of Object.keys(e.data)) seen.add(k);
    }
  }
  return [...seen];
}

/** The header row and one row per entry, CRLF line ends. */
export function toCsv(entries: Entry[], fields = fieldColumns(entries)): string {
  // A field named like a fixed column gets a prefix, so no two columns share a name.
  const header = [...FIXED, ...fields.map((f) => ((FIXED as readonly string[]).includes(f) ? `data.${f}` : f))].map(csvCell).join(",");
  const lines = [header];
  for (const e of entries) {
    const data = e.data && typeof e.data === "object" && !Array.isArray(e.data) ? (e.data as Record<string, unknown>) : {};
    lines.push(
      [
        csvCell(e.id),
        csvCell(e.viewer),
        csvCell(e.key ?? ""),
        new Date(e.createdAt).toISOString(),
        new Date(e.updatedAt).toISOString(),
        ...fields.map((f) => cellOf(data[f])),
      ].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
