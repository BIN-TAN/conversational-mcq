import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { prisma } from "../src/lib/db";
import { parseMiniTestWorkbook, stageMiniTestWorkbook } from "../src/lib/services/content/mini-test-workbook-import";
import { commitMcqItemImport, getMcqItemImportBatch, previewMcqItemImport } from "../src/lib/services/content/mcq-import";

const url = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.startsWith("/conversational_mcq_classroom_audit_"), "Disposable local database required");
const users: string[] = [], checks: string[] = [];
function fixture(edit?: (workbook: XLSX.WorkBook) => void) {
  const workbook = XLSX.utils.book_new();
  for (const [index, count] of [5, 4, 6].entries()) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(Array.from({ length: count }, (_, row) => ({
      item_label: `T${index + 1}-${row + 1}`, stem: `Synthetic question ${index + 1}.${row + 1}?`,
      option_a: "First", option_b: "Second", option_c: "Third", option_d: "Fourth", key: "A",
      target_reasoning_note: "A supplied teacher reasoning note.", strong_reasoning_should_mention: "A supplied evidence requirement.",
      distractor_diagnostic_notes: "B: a possible alternate reasoning path.", source_attribution: "Synthetic source"
    }))), `Test ${index + 1}`);
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Diagnostic guide"], [], ["Item ID", "Learning objective", "Formative follow-up", "Expected follow-up evidence"],
    ["T1-1", "Supplied objective", "Teacher-only optional follow-up", "Not initial MCQ evidence"],
    ["Source", "Synthetic fixture, not a student record"]
  ]), "Diagnostic guide");
  edit?.(workbook);
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}
async function evidenceCounts() {
  return [await prisma.assessmentSession.count(), await prisma.itemResponse.count(), await prisma.processEvent.count(), await prisma.agentCall.count()];
}
async function main() {
  const bytes = fixture();
  const inspected = await parseMiniTestWorkbook(bytes);
  assert.deepEqual(inspected.preview.sheets.map(sheet => sheet.item_count), [5, 4, 6]);
  assert.equal(inspected.preview.guides.length, 1);
  assert.equal(inspected.preview.guides[0].rows[2].row, 4);
  await assert.rejects(parseMiniTestWorkbook(Buffer.from("not xlsx")));
  await assert.rejects(parseMiniTestWorkbook(Buffer.alloc(2_000_001)));
  await assert.rejects(parseMiniTestWorkbook(fixture(wb => { wb.Sheets["Test 2"].G2 = { t: "s", v: "Z" }; })));
  await assert.rejects(parseMiniTestWorkbook(fixture(wb => { wb.Sheets["Test 2"].A2.f = "1+1"; })));
  await assert.rejects(parseMiniTestWorkbook(fixture(wb => { wb.Sheets["Test 1"]["!ref"] = "A1:AZ2"; })));
  const hidden = await parseMiniTestWorkbook(fixture(wb => { wb.Workbook = { Sheets: [{ name: "Test 1", Hidden: 1 }] }; }));
  assert.deepEqual(hidden.preview.sheets.map(sheet => sheet.sheet_name), ["Test 2", "Test 3"]);
  assert(hidden.preview.warnings.some(warning => warning.includes("Hidden sheet")));
  for (const path of ["xl/vbaProject.bin", "xl/media/image1.png"]) {
    const zip = await JSZip.loadAsync(bytes); zip.file(path, "fake bytes");
    await assert.rejects(parseMiniTestWorkbook(await zip.generateAsync({ type: "nodebuffer" })));
  }
  checks.push("all visible sheets, guides, row provenance; malformed/oversized/formula/error/media/macro boundaries");
  if (process.env.WORKBOOK_TEST_FILE) {
    const actual = await parseMiniTestWorkbook(readFileSync(process.env.WORKBOOK_TEST_FILE));
    assert.deepEqual(actual.preview.sheets.map(sheet => sheet.item_count), [5, 4, 6]);
    assert(actual.preview.guides.some(guide => guide.sheet_name === "Diagnostic guide"));
    checks.push("actual Lecture 1 workbook: 3 mini tests, all 15 items and diagnostic guide recognized");
  }
  const before = await evidenceCounts();
  for (let i = 0; i < 3; i++) {
    const name = `workbook_smoke_${randomUUID()}`;
    users.push((await prisma.user.create({ data: { user_id: name, user_id_normalized: name, role: "teacher_researcher" } })).id);
  }
  const input = { teacher_user_db_id: users[0], bytes, source_file_name: "fixture.xlsx", selected_sheets: ["Test 1", "Test 2", "Test 3"] };
  await assert.rejects(stageMiniTestWorkbook({ ...input, selected_sheets: [] }));
  await assert.rejects(stageMiniTestWorkbook({ ...input, selected_sheets: ["Test 1", "unknown"] }));
  assert.equal(await prisma.assessment.count({ where: { created_by_user_db_id: users[0] } }), 0);
  const first = await stageMiniTestWorkbook(input);
  assert.deepEqual(first.tests.map(test => test.item_count), [5, 4, 6]);
  const context = { teacher_user_db_id: users[0], ...first.tests[0] };
  const { batch } = await getMcqItemImportBatch(context);
  assert.equal(batch.candidates.length, 5);
  assert(batch.candidates.every(candidate => candidate.teacher_confirmed_key === null));
  assert.equal(batch.candidates[0].source_location, "Test 1!2");
  assert.equal(JSON.parse(batch.candidates[0].original_source_text).source_attribution, "Synthetic source");
  assert.equal((batch.candidates[0].source_metadata?.diagnostic_guide as Array<unknown>).length, 1);
  assert(JSON.stringify(batch.validation_summary).includes("Teacher-only optional follow-up"));
  const topic = await prisma.conceptUnit.findFirstOrThrow({ where: { assessment: { assessment_public_id: context.assessment_public_id } } });
  assert(!JSON.stringify(topic.administration_rules).includes("Teacher-only optional follow-up"));
  const assessments = await prisma.assessment.findMany({ where: { created_by_user_db_id: users[0] } });
  assert(assessments.every(assessment => assessment.status === "draft"));
  assert.equal(await prisma.item.count({ where: { concept_unit: { assessment: { created_by_user_db_id: users[0] } } } }), 0);
  await assert.rejects(commitMcqItemImport({ ...context, data: { selected_candidate_public_ids: batch.candidates.map(candidate => candidate.candidate_public_id) } }), /Confirm an answer key/);
  assert.equal(await prisma.item.count({ where: { concept_unit_db_id: topic.id } }), 0);
  await assert.rejects(getMcqItemImportBatch({ ...context, teacher_user_db_id: users[1] }));
  await assert.rejects(previewMcqItemImport({ ...context, data: { source_type: "xlsx", file_base64: bytes.toString("base64") } }), /multiple visible sheets/);
  checks.push("atomic draft staging, source and guide retention, key confirmation, ownership, old importer rejects silent truncation");
  const repeated = await stageMiniTestWorkbook({ ...input, source_file_name: "renamed.xlsx" });
  assert(repeated.tests.every(test => test.reused));
  assert.deepEqual(repeated.tests.map(test => test.batch_public_id), first.tests.map(test => test.batch_public_id));
  const concurrent = await Promise.all([1, 2].map(() => stageMiniTestWorkbook({ ...input, teacher_user_db_id: users[1] })));
  assert.deepEqual(concurrent[0].tests.map(test => test.batch_public_id), concurrent[1].tests.map(test => test.batch_public_id));
  assert.notEqual(concurrent[0].tests[0].assessment_public_id, first.tests[0].assessment_public_id);
  const partial = await stageMiniTestWorkbook({ ...input, teacher_user_db_id: users[2], selected_sheets: ["Test 2"] });
  await prisma.assessment.update({ where: { assessment_public_id: partial.tests[0].assessment_public_id }, data: { status: "published" } });
  await assert.rejects(stageMiniTestWorkbook({ ...input, teacher_user_db_id: users[2] }), /already imported/);
  assert.equal(await prisma.assessment.count({ where: { created_by_user_db_id: users[2] } }), 1);
  checks.push("same-file rename/retry/concurrent deduplication, teacher isolation, published lock and all-or-nothing rollback");
  const reviewed = (await getMcqItemImportBatch(context)).batch;
  await commitMcqItemImport({ ...context, data: { expected_updated_at: reviewed.updated_at, selected_candidate_public_ids: batch.candidates.map(candidate => candidate.candidate_public_id),
    candidate_updates: batch.candidates.map(candidate => ({ candidate_public_id: candidate.candidate_public_id, teacher_confirmed_key: candidate.imported_key })) } });
  const item = await prisma.item.findFirstOrThrow({ where: { concept_unit_db_id: topic.id }, orderBy: { item_order: "asc" } });
  assert.equal(item.status, "draft");
  assert(JSON.stringify(item.administration_rules).includes("diagnostic_guide"));
  assert.deepEqual(await evidenceCounts(), before);
  checks.push("reviewed draft materialization preserves guide provenance; research data and provider calls unchanged");
  console.log(JSON.stringify({ status: "passed", checks, provider_calls: 0 }, null, 2));
}
main().finally(async () => {
  const where = { created_by_user_db_id: { in: users } };
  await prisma.mcqItemImportBatch.deleteMany({ where: { assessment: where } });
  await prisma.item.deleteMany({ where: { concept_unit: { assessment: where } } });
  await prisma.conceptUnit.deleteMany({ where: { assessment: where } });
  await prisma.assessment.deleteMany({ where });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
}).catch(error => { console.error(error); process.exitCode = 1; });
