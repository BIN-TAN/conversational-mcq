import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { readBoundedOfficeArchive } from "./office-archive";
import { ContentServiceError } from "./errors";
import { MiniTestJsonSchema, MINI_TEST_JSON_VERSION, type MiniTestJson } from "./mini-test-json-contract";
import { stageMiniTestDocument, withImportTransaction } from "./mini-test-json-import";
import { WORKBOOK_MAX_BYTES, type WorkbookGuide, type WorkbookPreview } from "./mini-test-workbook-contract";

const header = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const reject = (message: string): never => { throw new ContentServiceError("validation_failed", message, 400); };
type SourceRow = { row: number; values: Record<string, string> };
type ParsedSheet = { sheet_name: string; document: MiniTestJson; rows: SourceRow[] };

export async function parseMiniTestWorkbook(bytes: Buffer) {
  if (!bytes.length || bytes.length > WORKBOOK_MAX_BYTES) reject("Choose an XLSX workbook up to 2 MB.");
  const archive = await readBoundedOfficeArchive(bytes);
  if (!archive.file("xl/workbook.xml")) reject("A standard XLSX workbook is required.");
  if (Object.keys(archive.files).some(name => /^xl\/(media|embeddings)\//i.test(name))) {
    reject("This workbook contains embedded images or objects. Import its text items separately and add the media during item review.");
  }
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(await archive.generateAsync({ type: "nodebuffer" }), { type: "buffer", cellFormula: true, sheetRows: 502 }); }
  catch { return reject("The XLSX workbook could not be read."); }
  if (workbook.SheetNames.length > 24) reject("Use a workbook with at most 24 worksheets.");
  const sheets: ParsedSheet[] = [], guides: WorkbookGuide[] = [], warnings: string[] = [];
  let totalRows = 0, totalText = 0;
  for (const [index, name] of workbook.SheetNames.entries()) {
    if (Number(workbook.Workbook?.Sheets?.[index]?.Hidden ?? 0) > 0) { warnings.push(`Hidden sheet excluded: ${name}`); continue; }
    const sheet = workbook.Sheets[name];
    if (!sheet?.["!ref"]) { warnings.push(`Empty sheet excluded: ${name}`); continue; }
    const range = XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"]);
    if (range.e.r >= 501 || range.e.c >= 32) reject(`${name}: use at most 501 rows (including headers) and 32 columns.`);
    for (const [address, cell] of Object.entries(sheet)) {
      if (!address.startsWith("!") && (cell.f || cell.t === "e")) reject(`${name}!${address}: replace formulas or spreadsheet errors with reviewed values before uploading.`);
    }
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "", blankrows: true, range: 0 })
      .map((cells, row) => ({ row: row + 1, cells: cells.map(value => String(value ?? "")) }))
      .filter(row => row.cells.some(value => value.trim()));
    totalRows += rows.length;
    totalText += rows.reduce((sum, row) => sum + row.cells.join("").length, 0);
    if (totalRows > 1500 || totalText > 1_000_000) reject("The workbook exceeds the safe total row or text limit. Split it into smaller workbooks.");
    const keys = rows[0]?.cells.map(header) ?? [];
    const hasStem = keys.includes("stem") || keys.includes("item_stem");
    const hasOptions = keys.includes("option_a") && keys.includes("option_b");
    if (!hasStem && !hasOptions) { guides.push({ sheet_name: name, rows }); continue; }
    if (!hasStem || !hasOptions) reject(`${name}: item sheets need stem, option_a and option_b columns in their first nonempty row.`);
    const named = keys.filter(Boolean);
    if (new Set(named).size !== named.length) reject(`${name}: duplicate column headers must be corrected.`);
    const sourceRows = rows.slice(1).map(({ row, cells }) => {
      if (cells.some((value, column) => value.trim() && !keys[column])) reject(`${name}, row ${row}: every nonempty column needs a header.`);
      return { row, values: Object.fromEntries(keys.filter(Boolean).map(key => [key, cells[keys.indexOf(key)] ?? ""])) };
    });
    const items = sourceRows.map(({ row, values: v }) => ({
      item_label: v.item_label || v.item_id || null, stem: v.stem || v.item_stem || "",
      options: ["A", "B", "C", "D", "E", "F"].filter(label => v[`option_${label.toLowerCase()}`]?.trim())
        .map(label => ({ label, text: v[`option_${label.toLowerCase()}`] })),
      key: (v.key || v.correct_option || "").trim().toUpperCase() || null,
      target_reasoning_note: v.target_reasoning_note || null,
      strong_reasoning_should_mention: v.strong_reasoning_should_mention || null,
      distractor_diagnostic_notes: v.distractor_diagnostic_notes || null,
      source_reference: v.source_attribution || v.source_reference || `${name}!${row}`
    }));
    const parsed = MiniTestJsonSchema.safeParse({ schema_version: MINI_TEST_JSON_VERSION, assessment: { title: name }, items });
    if (!parsed.success) reject(`${name}: ${parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    sheets.push({ sheet_name: name, document: parsed.data!, rows: sourceRows });
    const unmapped = named.filter(key => !["item_label", "item_id", "stem", "item_stem", "option_a", "option_b", "option_c", "option_d", "option_e", "option_f", "key", "correct_option", "target_reasoning_note", "strong_reasoning_should_mention", "distractor_diagnostic_notes", "source_attribution", "source_reference"].includes(key));
    if (unmapped.length) warnings.push(`${name}: additional columns retained in original source only: ${unmapped.join(", ")}`);
    if (items.length < 3 || items.length > 12) warnings.push(`${name}: select 3-12 items before publishing this mini test.`);
  }
  if (!sheets.length) reject("No item sheets found. Use stem, option_a, option_b, and key headers; additional options C-F and diagnostic notes are supported.");
  if (sheets.reduce((sum, sheet) => sum + sheet.document.items.length, 0) > 500) reject("A workbook may contain at most 500 item candidates.");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const preview: WorkbookPreview = { checksum, sheets: sheets.map(sheet => ({ sheet_name: sheet.sheet_name,
    item_count: sheet.document.items.length, supplied_keys: sheet.document.items.filter(item => item.key).length,
    item_labels: sheet.document.items.map((item, index) => item.item_label || `Item ${index + 1}`) })), guides, warnings };
  return { preview, sheets };
}

function linkedGuideRows(guides: WorkbookGuide[], label: string | null | undefined) {
  if (!label) return [];
  return guides.flatMap(guide => {
    const heading = guide.rows.find(row => row.cells.some(cell => ["item_id", "item_label"].includes(header(cell))));
    if (!heading) return [];
    const idColumn = heading.cells.findIndex(cell => ["item_id", "item_label"].includes(header(cell)));
    return guide.rows.filter(row => row.row > heading.row && row.cells[idColumn]?.trim() === label.trim())
      .map(row => ({ sheet_name: guide.sheet_name, row: row.row,
        fields: heading.cells.map((field, i) => ({ field, value: row.cells[i] ?? "" })).filter(entry => entry.field && entry.value) }));
  });
}

export async function stageMiniTestWorkbook(input: { teacher_user_db_id: string; bytes: Buffer; source_file_name: string; selected_sheets: string[] }) {
  const { preview, sheets } = await parseMiniTestWorkbook(input.bytes);
  const selected = new Set(input.selected_sheets);
  if (!selected.size || selected.size !== input.selected_sheets.length || [...selected].some(name => !sheets.some(sheet => sheet.sheet_name === name))) {
    reject("Select at least one recognized item sheet, with no duplicate or unknown sheets.");
  }
  const labels = sheets.flatMap(sheet => sheet.document.items.map(item => item.item_label).filter(Boolean));
  return withImportTransaction(async tx => {
    const tests = [];
    for (const sheet of sheets.filter(sheet => selected.has(sheet.sheet_name))) {
      const result = await stageMiniTestDocument(tx, {
        teacher_user_db_id: input.teacher_user_db_id, source_text: JSON.stringify(sheet.document), source_file_name: input.source_file_name,
        source_context: { original_source_type: "xlsx", parser_version: "mini-test-workbook-v1", workbook_checksum: preview.checksum,
          sheet_name: sheet.sheet_name, workbook_guides: preview.guides, workbook_warnings: preview.warnings },
        candidate_contexts: sheet.rows.map((row, index) => ({
          source_location: `${sheet.sheet_name}!${row.row}`, original_source_text: JSON.stringify(row.values),
          source_metadata: { original_source_type: "xlsx", workbook_checksum: preview.checksum, sheet_name: sheet.sheet_name, row_number: row.row,
            diagnostic_guide: labels.filter(label => label === sheet.document.items[index].item_label).length === 1
              ? linkedGuideRows(preview.guides, sheet.document.items[index].item_label) : [],
            guide_mapping_note: "Guide notes are teacher source material, not active student instructions or evidence of student performance." }
        }))
      });
      tests.push({ ...result, sheet_name: sheet.sheet_name, item_count: sheet.document.items.length });
    }
    return { tests };
  });
}
