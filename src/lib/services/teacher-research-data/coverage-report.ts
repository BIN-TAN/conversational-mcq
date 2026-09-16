import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const COLUMNS = ["dataset", "group_by", "group_value", "variable_name", "row_count", "populated_count", "blank_count", "zero_count", "false_count", "populated_percent", "coverage_status"];

// Inspect the actual serialized exports, not schemas or assumed instrumentation.
// Never copy student text, IDs or example values into this aggregate report.
export function researchCoverageFiles(files: { path: string; data: string }[]) {
  const report: Record<string, string | number | null>[] = [];
  for (const file of files) {
    if (!file.path.endsWith(".csv") || /dictionary|codebook|coverage/.test(file.path)) continue;
    const matrix = parse(file.data) as string[][];
    const [columns, ...rows] = matrix;
    if (!columns) continue;
    const groupColumn = ["actor_type", "response_stage"].find(name => columns.includes(name));
    const groups = [{ name: "all_rows", value: "all", rows }];
    if (groupColumn) {
      const index = columns.indexOf(groupColumn);
      // Only allow category values, never arbitrary text, in report labels.
      const allowed = new Set(["student", "agent", "system", "teacher", "answer", "reasoning", "confidence", "tempting_option", "tempting_reason", "revision", "package_review"]);
      for (const value of new Set(rows.map(row => row[index]).filter(value => allowed.has(value)))) {
        groups.push({ name: groupColumn, value, rows: rows.filter(row => row[index] === value) });
      }
    }
    for (const group of groups) columns.forEach((variable_name, index) => {
      const values = group.rows.map(row => row[index] ?? "");
      const populated = values.filter(value => value !== "").length;
      report.push({ dataset: file.path, group_by: group.name, group_value: group.value, variable_name,
        row_count: values.length, populated_count: populated, blank_count: values.length - populated,
        zero_count: values.filter(value => value === "0").length,
        false_count: values.filter(value => value === "false").length,
        populated_percent: values.length ? Math.round(10000 * populated / values.length) / 100 : null,
        coverage_status: !values.length ? "no_rows" : !populated ? "all_blank" : populated === values.length ? "populated" : "partly_populated" });
    });
  }
  return [
    { path: "data_coverage.csv", data: stringify(report, { header: true, columns: COLUMNS, escape_formulas: true }) },
    { path: "data_coverage_notes.txt", data: [
      "Coverage is calculated from the actual CSV files in this ZIP, within its selected sessions and database snapshot.",
      "Rows: one dataset x group x exported variable. all_rows groups cover entire tables; actor_type/response_stage groups are optional observed subgroups and overlap all_rows. Do not add groups together.",
      "row_count = number of data rows in the group. populated_count = cells not equal to the empty CSV string. blank_count = row_count - populated_count.",
      "zero_count = cells exactly equal to '0'; false_count = cells exactly equal to 'false'. Both are populated values, not missing values.",
      "populated_percent = round(100 * populated_count / row_count, 2); blank when row_count=0. This is observed population, NOT eligible-record completeness.",
      "coverage_status: no_rows if row_count=0; all_blank if populated_count=0; populated if all cells nonempty; partly_populated otherwise.",
      "Conditional fields (text input on chip-only stages, errors on successful turns, tutor token counts on student rows, optional transfer) may legitimately be blank. Empty timing_limitations means no listed flags, not missing telemetry.",
      "An all_blank/no_rows field warrants source/applicability review; do not fill it with zeros. Populated does not prove validity, correct clock use, or complete real-world event capture.",
      "Use dictionaries, timing_quality_status, timing_limitations, actor_type, versions and phase with this report. Legacy records cannot acquire new browser timing retroactively.",
      "Reports contain aggregate counts only; they exclude dictionaries/codebooks and themselves. Synthetic demos remain separate from the approved classroom research cohort."
    ].join("\n") + "\n" }
  ];
}
