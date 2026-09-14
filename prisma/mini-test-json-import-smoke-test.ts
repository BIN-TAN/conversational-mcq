import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { parseMiniTestJson, MINI_TEST_JSON_MAX_BYTES } from "../src/lib/services/content/mini-test-json-contract";
import { stageMiniTestJsonImport } from "../src/lib/services/content/mini-test-json-import";
import { commitMcqItemImport, getMcqItemImportBatch, previewMcqItemImport } from "../src/lib/services/content/mcq-import";
import { getAssessmentItemDesign, itemDesignBlueprintHash } from "../src/lib/services/content/item-design";

const url = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.startsWith("/conversational_mcq_classroom_audit_"), "Disposable local database required");
const source = readFileSync("public/samples/mini-test-import.json", "utf8");
const sample = parseMiniTestJson(source);
const checks: string[] = [];
const userIds: string[] = [];
const expectError = (value: unknown) => assert.throws(() => parseMiniTestJson(JSON.stringify(value)));

async function evidenceCounts() {
  return [await prisma.assessmentSession.count(), await prisma.itemResponse.count(), await prisma.processEvent.count(), await prisma.agentCall.count()];
}

async function main() {
  assert.equal(sample.items.length, 3);
  assert.deepEqual(parseMiniTestJson(`\uFEFF${source}`), sample);
  expectError({ ...sample, status: "published" });
  expectError({ ...sample, items: [{ ...sample.items[0], teacher_confirmed_key: "B" }] });
  expectError({ ...sample, items: [{ ...sample.items[0], key: "F" }] });
  expectError({ ...sample, items: [{ ...sample.items[0], objective_ids: ["unknown"] }] });
  expectError({ ...sample, items: [{ ...sample.items[0], options: [sample.items[0].options[0], sample.items[0].options[0]] }] });
  assert.throws(() => parseMiniTestJson("x".repeat(MINI_TEST_JSON_MAX_BYTES + 1)));
  assert.throws(() => parseMiniTestJson("{broken"));
  checks.push("sample, BOM, invalid JSON, size, keys, labels, references, and protected fields");
  const before = await evidenceCounts();
  for (let i = 0; i < 3; i++) {
    const id = `json_import_${randomUUID()}`;
    const user = await prisma.user.create({ data: { user_id: id, user_id_normalized: id, role: i === 2 ? "student" : "teacher_researcher" } });
    userIds.push(user.id);
  }
  const input = { teacher_user_db_id: userIds[0], source_text: source, source_file_name: "sample.json" };
  const first = await stageMiniTestJsonImport(input);
  const again = await stageMiniTestJsonImport({ ...input, source_text: JSON.stringify(JSON.parse(source)) });
  assert.equal(first.assessment_public_id, again.assessment_public_id);
  assert.equal(first.batch_public_id, again.batch_public_id);
  assert(again.reused);
  const concurrentSource = JSON.stringify({ ...sample, assessment: { ...sample.assessment, title: "Concurrent JSON import" } });
  const concurrent = await Promise.all([1, 2, 3].map(() => stageMiniTestJsonImport({ ...input, source_text: concurrentSource })));
  assert.equal(new Set(concurrent.map(result => result.batch_public_id)).size, 1);
  assert.equal(await prisma.assessment.count({ where: { created_by_user_db_id: userIds[0] } }), 2);
  assert.equal(await prisma.item.count({ where: { concept_unit: { assessment: { created_by_user_db_id: userIds[0] } } } }), 0);
  checks.push("atomic review-only staging and sequential/concurrent retry deduplication");

  const context = { teacher_user_db_id: userIds[0], assessment_public_id: first.assessment_public_id, batch_public_id: first.batch_public_id };
  const { batch } = await getMcqItemImportBatch(context);
  assert(batch.candidates.every(item => item.teacher_confirmed_key === null && item.llm_suggested_key === null));
  assert.equal(batch.source_file_name, "sample.json");
  assert.equal(batch.candidates[0].source_location, "items[0]");
  assert.deepEqual(JSON.parse(batch.candidates[0].original_source_text), JSON.parse(source).items[0]);
  const design = await getAssessmentItemDesign(context);
  assert.deepEqual(design.blueprint, sample.design);
  assert.equal(design.blueprint_hash, itemDesignBlueprintHash(sample.design!));
  assert.equal(batch.candidates[0].source_metadata?.blueprint_hash, design.blueprint_hash);
  checks.push("design round trip, source provenance, unconfirmed supplied keys");

  const other = await stageMiniTestJsonImport({ ...input, teacher_user_db_id: userIds[1] });
  assert.notEqual(other.assessment_public_id, first.assessment_public_id);
  await assert.rejects(getMcqItemImportBatch({ ...context, teacher_user_db_id: userIds[1] }));
  checks.push("teacher ownership isolation");

  const counts = await prisma.assessment.count({ where: { created_by_user_db_id: userIds[0] } });
  const invalidMedia = { ...sample, assessment: { ...sample.assessment, title: "Unsafe media" }, items: [{ ...sample.items[0], media_assets: [{ media_type: "image", source_type: "external_url", external_url: "http://127.0.0.1/private", alt_text_or_description: "Unsafe" }] }] };
  await assert.rejects(stageMiniTestJsonImport({ ...input, source_text: JSON.stringify(invalidMedia) }));
  assert.equal(await prisma.assessment.count({ where: { created_by_user_db_id: userIds[0] } }), counts);
  checks.push("unsafe media rejected with complete transaction rollback");

  const mediaDoc = { ...sample, assessment: { ...sample.assessment, title: "Media JSON" }, items: [{ ...sample.items[0], media_assets: [{ media_type: "reference_link", source_type: "external_url", external_url: "https://example.com/course", alt_text_or_description: "Course reference", source_attribution: "Teacher source" }] }] };
  const mediaStage = await stageMiniTestJsonImport({ ...input, source_text: JSON.stringify(mediaDoc) });
  const mediaContext = { ...context, assessment_public_id: mediaStage.assessment_public_id, batch_public_id: mediaStage.batch_public_id };
  const mediaBatch = (await getMcqItemImportBatch(mediaContext)).batch;
  assert.equal(mediaBatch.candidates[0].media_assets[0].external_url, "https://example.com/course");
  // The existing per-assessment importer accepts the same new JSON format.
  const compatible = await previewMcqItemImport({ ...context, data: { source_type: "project_json", source_text: source } });
  assert.deepEqual(compatible.batch.candidates[0].source_metadata, batch.candidates[0].source_metadata);
  await assert.rejects(previewMcqItemImport({ ...context, data: { source_type: "project_json", source_text: JSON.stringify({ ...sample, items: [] }) } }), error => (error as { status?: number }).status === 400);
  const committed = await commitMcqItemImport({ ...context, data: {
    expected_updated_at: batch.updated_at,
    candidate_updates: batch.candidates.map(item => ({ candidate_public_id: item.candidate_public_id, teacher_confirmed_key: item.imported_key }))
  } });
  const items = await prisma.item.findMany({ where: { concept_unit: { assessment: { assessment_public_id: first.assessment_public_id } } }, orderBy: { item_order: "asc" } });
  assert.equal(items.length, 3);
  assert(items.every(item => item.status === "draft"));
  assert.deepEqual(items.map(item => item.correct_option), sample.items.map(item => item.key));
  const rules = items[0].administration_rules as { import_provenance: { source_metadata: { objective_ids: string[] }; teacher_confirmed_key: string } };
  assert.deepEqual(rules.import_provenance.source_metadata.objective_ids, sample.items[0].objective_ids);
  assert.equal(rules.import_provenance.teacher_confirmed_key, "B");
  await assert.rejects(commitMcqItemImport({ ...context, data: { expected_updated_at: batch.updated_at } }));
  await commitMcqItemImport({ ...context, data: { expected_updated_at: committed.batch.updated_at } });
  assert.equal(await prisma.item.count({ where: { concept_unit: { assessment: { assessment_public_id: first.assessment_public_id } } } }), 3);
  checks.push("shared review import, media retention, confirmed draft keys, provenance, repeat-commit protection");

  for (const status of ["published", "archived"] as const) {
    await prisma.assessment.update({ where: { assessment_public_id: first.assessment_public_id }, data: { status } });
    await assert.rejects(stageMiniTestJsonImport(input));
  }
  const usedAssessment = await prisma.assessment.update({ where: { assessment_public_id: first.assessment_public_id }, data: { status: "draft" } });
  const session = await prisma.assessmentSession.create({ data: { assessment_db_id: usedAssessment.id, user_db_id: userIds[2], started_at: new Date() } });
  await assert.rejects(stageMiniTestJsonImport(input));
  assert.deepEqual(await prisma.assessmentSession.findUnique({ where: { id: session.id } }), session);
  assert.deepEqual(await prisma.item.findMany({ where: { concept_unit: { assessment_db_id: usedAssessment.id } }, orderBy: { item_order: "asc" } }), items);
  await prisma.assessmentSession.delete({ where: { id: session.id } });
  const minimal = { schema_version: sample.schema_version, assessment: { title: "Items without a design or key" }, items: [{ stem: "A teacher question", options: [{ label: "A", text: "One" }, { label: "B", text: "Two" }] }] };
  const minimalStage = await stageMiniTestJsonImport({ ...input, source_text: JSON.stringify(minimal) });
  const minimalBatch = (await getMcqItemImportBatch({ ...context, assessment_public_id: minimalStage.assessment_public_id, batch_public_id: minimalStage.batch_public_id })).batch;
  assert.equal(minimalBatch.candidates[0].teacher_confirmed_key, null);
  assert.equal(minimalBatch.candidates[0].target_reasoning_note, null);
  assert.deepEqual(await evidenceCounts(), before);
  checks.push("published/archive/used-test protection; missing design/notes/keys not invented; research/provider records unchanged");
  console.log(JSON.stringify({ status: "passed", checks, provider_calls: 0 }, null, 2));
}

main().finally(async () => {
  const where = { created_by_user_db_id: { in: userIds } };
  await prisma.assessmentSession.deleteMany({ where: { assessment: where } });
  await prisma.itemMediaAsset.deleteMany({ where: { item: { concept_unit: { assessment: where } } } });
  await prisma.item.deleteMany({ where: { concept_unit: { assessment: where } } });
  await prisma.mcqItemImportBatch.deleteMany({ where: { assessment: where } });
  await prisma.conceptUnit.deleteMany({ where: { assessment: where } });
  await prisma.assessment.deleteMany({ where });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}).catch(error => { console.error(error); process.exitCode = 1; });
