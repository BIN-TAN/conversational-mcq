import { stringify } from "csv-stringify/sync";

export const RESEARCH_CSV_CONTRACT_VERSION = "research-csv-v2";

// csv-stringify's defaults collapse false and null into the same empty cell.
// Preserve the three states before serialization, including nested export tables.
export function researchCsv(rows: Record<string, unknown>[], columns?: readonly string[]) {
  return stringify(rows, {
    header: true, columns: columns ? [...columns] : undefined,
    cast: { boolean: value => value ? "true" : "false", date: value => value.toISOString() },
    escape_formulas: true, record_delimiter: "\n"
  });
}
