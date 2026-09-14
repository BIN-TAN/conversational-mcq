import type { WorkbookGuide } from "@/lib/services/content/mini-test-workbook-contract";

export function WorkbookGuides({ guides }: { guides: WorkbookGuide[] }) {
  if (!guides.length) return null;
  return <section className="min-w-0 space-y-3" aria-label="Workbook reference sheets">
    <h2 className="text-lg font-semibold">Reference sheets</h2>
    {guides.map(guide => <details key={guide.sheet_name} className="min-w-0 border-y border-line py-3">
      <summary className="cursor-pointer font-semibold">{guide.sheet_name} ({guide.rows.length} rows)</summary>
      <div className="mt-3 max-h-96 overflow-auto" tabIndex={0} role="region" aria-label={guide.sheet_name}>
        <table className="w-full text-left text-sm"><tbody>{guide.rows.map(row => <tr key={row.row} className="border-b border-line">
          <th className="p-2 align-top text-muted" scope="row">{row.row}</th>
          {row.cells.filter(cell => cell.trim()).length === 1
            ? <td colSpan={Math.max(...guide.rows.map(entry => entry.cells.length))} className="whitespace-pre-wrap break-words p-2 align-top">{row.cells.find(cell => cell.trim())}</td>
            : row.cells.map((cell, index) => <td key={index} className="min-w-40 max-w-md whitespace-pre-wrap break-words p-2 align-top">{cell}</td>)}
        </tr>)}</tbody></table>
      </div>
    </details>)}
  </section>;
}

export function WorkbookItemGuide({ metadata }: { metadata?: Record<string, unknown> | null }) {
  const entries = metadata?.diagnostic_guide;
  if (!Array.isArray(entries) || !entries.length) return null;
  const fields = entries.flatMap(entry => Array.isArray(entry?.fields) ? entry.fields : [])
    .filter((entry): entry is { field: string; value: string } => typeof entry?.field === "string" && typeof entry?.value === "string");
  if (!fields.length) return null;
  return <details className="mt-3 border-t border-line pt-3 text-sm">
    <summary className="cursor-pointer font-semibold">Item guide notes</summary>
    <dl className="mt-3 space-y-3">{fields.map((entry, index) => <div key={index}>
      <dt className="font-semibold">{entry.field}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-muted">{entry.value}</dd>
    </div>)}</dl>
  </details>;
}

export function readWorkbookGuides(summary: unknown): WorkbookGuide[] {
  const context = (summary as { source_context?: { workbook_guides?: unknown } } | null)?.source_context;
  const guides = context?.workbook_guides;
  if (!Array.isArray(guides)) return [];
  return guides.filter((guide): guide is WorkbookGuide => Boolean(guide && typeof guide.sheet_name === "string" &&
    Array.isArray(guide.rows) && guide.rows.every((row: WorkbookGuide["rows"][number]) =>
      row && Number.isInteger(row.row) && Array.isArray(row.cells) && row.cells.every(cell => typeof cell === "string"))));
}
