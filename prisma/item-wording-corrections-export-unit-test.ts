/**
 * Database-free checks for item_wording_corrections.csv in the research dataset: every column is
 * documented in the data dictionary, the file is listed with the other files, the row builder
 * writes pipe-separated changed fields and pseudonymous instructor IDs, the before/after content
 * is restricted, and the loader returns no rows on a database without the table. Run with:
 *
 *   npx tsx prisma/item-wording-corrections-export-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

process.env.DATABASE_URL ??= "postgresql://synthetic:synthetic@127.0.0.1:5432/item_wording_corrections_unit";
process.env.SESSION_SECRET ??= "item-wording-corrections-unit-test-session-secret-000";
process.on("unhandledRejection", (error) => {
  if ((error as { name?: string })?.name === "PrismaClientInitializationError") return;
  console.error(error);
  process.exitCode = 1;
});

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok - ${name}`);
}

type CorrectionRecord = import("../src/lib/services/teacher-research-data/item-wording-corrections-export").ItemWordingCorrectionRecord;

async function main() {
  const corrections = await import("../src/lib/services/teacher-research-data/item-wording-corrections-export");
  const correctionDictionary = await import("../src/lib/services/teacher-research-data/item-wording-corrections-dictionary");
  const dictionary = await import("../src/lib/services/teacher-research-data/dictionary");
  const { assertAnalysisReadySafety } = await import("../src/lib/services/teacher-research-data/analysis-ready-export");
  const { researchInstructorId, researchPseudonymizationMetadata } = await import("../src/lib/services/teacher-research-data/pseudonymization");
  const header = (data: string) => (parse(data, { to_line: 1 }) as string[][])[0];
  const rows = (data: string) => parse(data, { columns: true }) as Record<string, string>[];

  const pseudonym = { instructor: (userId: string) => researchInstructorId(userId), version: researchPseudonymizationMetadata().research_pseudonym_version };
  const record = (id: string, item: string, at: string, extra: Partial<CorrectionRecord> = {}): CorrectionRecord => ({
    correction_public_id: id, assessment_public_id: "asm_1", item_public_id: item, item_version: 2,
    changed_fields: ["item_stem", "options"], reason: "Typo in the stem.",
    before_content: { item_stem: "PRIVATE_STEM_BEFORE", distractor_rationales: { B: "PRIVATE_RATIONALE" } },
    after_content: { item_stem: "PRIVATE_STEM_AFTER", distractor_rationales: { B: "PRIVATE_RATIONALE fixed" } },
    responses_before: 12, sessions_before: 5, corrected_at: new Date(at),
    research_instructor_id: pseudonym.instructor("teacher_demo"), research_pseudonym_version: pseudonym.version, ...extra
  });
  const records = [
    record("iwc_3", "q2", "2026-10-28T09:00:00.000Z", { changed_fields: ["teacher_notes"], responses_before: 0, sessions_before: 0 }),
    record("iwc_2", "q1", "2026-10-28T10:00:00.000Z", { changed_fields: ["distractor_rationales"] }),
    record("iwc_1", "q1", "2026-10-28T08:00:00.000Z")
  ];

  await check("Rows: one per fix, by item then time, pipe-separated changed fields, pseudonymous instructor", () => {
    const built = corrections.itemWordingCorrectionRows(records, { include_restricted: false });
    assert.deepEqual(built.map((row) => row.correction_public_id), ["iwc_1", "iwc_2", "iwc_3"]);
    assert.equal(built[0].changed_fields, "item_stem|options");
    assert.equal(built[1].changed_fields, "distractor_rationales");
    assert.equal(built[0].corrected_at, "2026-10-28T08:00:00.000Z");
    assert.equal(built[0].item_version, 2);
    assert.equal(built[2].responses_before, 0);
    assert.match(String(built[0].research_instructor_id), /^ri_[0-9a-f]{20}$/);
    assert.equal(built[0].research_instructor_id, researchInstructorId("teacher_demo"));
    assert.equal(built[0].research_pseudonym_version, pseudonym.version);
    assert.ok(!("before_json" in built[0]) && !("after_json" in built[0]), "Default rows carry no item content");
    const restricted = corrections.itemWordingCorrectionRows(records, { include_restricted: true });
    assert.deepEqual(JSON.parse(String(restricted[0].before_json)), records[2].before_content);
    assert.equal(restricted[0].after_json, JSON.stringify(records[2].after_content), "Compact JSON text");
    assert.equal(corrections.itemWordingCorrectionRows([record("iwc_x", "q1", "2026-10-28T08:00:00.000Z", { changed_fields: [] })],
      { include_restricted: false })[0].changed_fields, null);
  });

  await check("File: default exports omit before_json and after_json; restricted exports include them", () => {
    const defaults = corrections.itemWordingCorrectionFile(records, false);
    assert.equal(defaults.path, "item_wording_corrections.csv");
    assert.deepEqual(header(defaults.data), correctionDictionary.ITEM_WORDING_CORRECTIONS_COLUMNS.filter((column) => column !== "before_json" && column !== "after_json"));
    assert.equal(rows(defaults.data)[0].changed_fields, "item_stem|options");
    assert.ok(!/teacher_demo|@/.test(defaults.data), "No instructor username or email");
    assert.ok(!/PRIVATE_/.test(defaults.data), "No item content in a default export");
    assert.doesNotThrow(() => assertAnalysisReadySafety([defaults], false));
    const restricted = corrections.itemWordingCorrectionFile(records, true);
    assert.deepEqual(header(restricted.data), [...correctionDictionary.ITEM_WORDING_CORRECTIONS_COLUMNS]);
    assert.throws(() => assertAnalysisReadySafety([restricted], false), /restricted column (before|after)_json/);
    assert.doesNotThrow(() => assertAnalysisReadySafety([restricted], true));
    const empty = corrections.itemWordingCorrectionFile([], false);
    assert.equal(rows(empty.data).length, 0);
    assert.ok(header(empty.data).length > 0, "A mini-test without fixes still gets the header");
  });

  await check("Loader: no table, no rows; otherwise the instructor is pseudonymised and the raw user id is dropped", async () => {
    const fakeTx = (presence: boolean, data: unknown[]) => {
      let calls = 0;
      return { $queryRaw: async () => (calls++ === 0 ? [{ present: presence }] : data) } as never;
    };
    assert.deepEqual(await corrections.loadItemWordingCorrectionRecords(fakeTx(false, []), "asm_1", pseudonym), []);
    const loaded = await corrections.loadItemWordingCorrectionRecords(fakeTx(true, [{
      correction_public_id: "iwc_1", assessment_public_id: "asm_1", item_public_id: "q1", item_version: 2, changed_fields: ["item_stem"],
      reason: "Typo.", before_content: { item_stem: "a" }, after_content: { item_stem: "b" }, responses_before: BigInt(3), sessions_before: 1,
      corrected_at: new Date("2026-10-28T08:00:00.000Z"), corrected_by: "teacher_demo"
    }]), "asm_1", pseudonym);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].research_instructor_id, researchInstructorId("teacher_demo"));
    assert.equal(loaded[0].research_pseudonym_version, pseudonym.version);
    assert.equal(loaded[0].responses_before, 3);
    assert.ok(!JSON.stringify(loaded[0], (_key, value) => (typeof value === "bigint" ? Number(value) : value)).includes("teacher_demo"));
  });

  const entries = dictionary.buildAnalysisReadyDictionaryEntries();
  const byName = new Map(entries.map((entry) => [entry.qualified_name, entry]));

  await check("Dictionary: every column is documented like the other research files", () => {
    assert.ok((dictionary.RESEARCH_DATASET_TABLES as readonly string[]).includes("item_wording_corrections"));
    assert.deepEqual(dictionary.analysisReadyColumnsByTable().item_wording_corrections, correctionDictionary.ITEM_WORDING_CORRECTIONS_COLUMNS);
    for (const column of correctionDictionary.ITEM_WORDING_CORRECTIONS_COLUMNS) {
      const entry = byName.get(`item_wording_corrections.${column}`);
      assert.ok(entry, `item_wording_corrections.${column} lacks a dictionary entry`);
      assert.ok(entry.definition.length > 30, `${column} needs a substantive definition`);
      assert.ok(entry.collection_or_generation_method.length > 40, `${column} needs a substantive method`);
      assert.equal(entry.measurement_level, "item_wording_correction");
      assert.ok(entry.not_applicable_condition && entry.missing_value_meaning && entry.zero_value_meaning);
      assert.ok(entry.research_category_id && entry.substantive_category && entry.privacy_level);
      if (column !== "research_pseudonym_version") {
        assert.equal(entry.definition, correctionDictionary.itemWordingCorrectionColumnDoc("item_wording_corrections", column)?.definition);
      }
    }
    for (const column of ["before_json", "after_json"]) {
      const entry = byName.get(`item_wording_corrections.${column}`)!;
      assert.equal(entry.export_policy, "restricted_research_dataset_only");
      assert.equal(entry.audience, "restricted_researcher");
    }
    assert.equal(byName.get("item_wording_corrections.reason")!.privacy_level, "research_sensitive_text");
    assert.equal(byName.get("item_wording_corrections.reason")!.export_policy, byName.get("item_review_decisions.note")!.export_policy);
    assert.equal(byName.get("item_wording_corrections.research_instructor_id")!.privacy_level, "pseudonymous_research_id");
    assert.match(byName.get("item_wording_corrections.research_instructor_id")!.source_code_reference, /pseudonymization\.ts:researchInstructorId/);
    assert.match(byName.get("item_wording_corrections.changed_fields")!.source_code_reference, /item-wording-corrections-export\.ts:itemWordingCorrectionRows/);
    assert.ok(byName.get("item_wording_corrections.corrected_at")!.calculation_formula);
    const report = dictionary.researchDataDictionarySemanticReport();
    assert.deepEqual(report.undocumented_exported_columns, []);
    assert.equal(report.placeholder_research_definitions, 0);
    assert.equal(report.timing_variables_missing_formula, 0);
  });

  await check("Export wiring: one file per mini-test, listed with the other files and explained in the README", () => {
    const source = readFileSync(new URL("../src/lib/services/teacher-research-data/analysis-ready-export.ts", import.meta.url), "utf8");
    const included = source.slice(source.indexOf("included_files: ["), source.indexOf("]", source.indexOf("included_files: [")));
    assert.match(included, /"item_review_decisions\.csv",\s*\n\s*ITEM_WORDING_CORRECTIONS_FILE,/, "Listed after item_review_decisions.csv");
    assert.equal(correctionDictionary.ITEM_WORDING_CORRECTIONS_FILE, "item_wording_corrections.csv");
    assert.match(source, /correctionRecordsByAssessment\.set\(assessmentPublicId, await loadItemWordingCorrectionRecords\(tx, assessmentPublicId, instructorPseudonym\)\)/);
    assert.match(source, /for \(const records of correctionRecordsByAssessment\.values\(\)\) await emit\(itemWordingCorrectionFile\(records, includeRestricted\)\)/);
    assert.match(source, /\.\.\.ITEM_WORDING_CORRECTIONS_README_LINES/);
    assert.match(source, /\.\.\.ITEM_WORDING_CORRECTIONS_RESTRICTED_COLUMNS/, "The safety scan refuses before_json and after_json in default exports");
    const readme = correctionDictionary.ITEM_WORDING_CORRECTIONS_README_LINES.join("\n");
    assert.match(readme, /leaves the item's ID and version unchanged/);
    assert.match(readme, /assessment_content\.csv \(built from the answer's item snapshot\)/);
    assert.match(readme, /responses before corrected_at saw the earlier wording/);
  });

  console.log(`\n${passed} item wording corrections export checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
