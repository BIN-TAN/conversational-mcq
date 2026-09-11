import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { previewItemDeletion, deleteSelectedItems } from "../src/lib/services/content/item-deletion";
import { ContentServiceError } from "../src/lib/services/content/errors";
import { publishAssessment, publishConceptUnit } from "../src/lib/services/content/publishing";

const database = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_item_delete"));
assert.equal(process.env.LLM_LIVE_CALLS_ENABLED, "false");
assert.equal(process.env.OPENAI_API_KEY ?? "", "");
const checks: string[] = [];

async function fixture() {
  const name = `item_delete_${randomUUID()}`;
  const teacher = await prisma.user.create({ data: { user_id: name, user_id_normalized: name, role: "teacher_researcher" } });
  const assessment = await prisma.assessment.create({ data: {
    title: "Synthetic duplicate-item cleanup", created_by_user_db_id: teacher.id,
    concept_units: { create: {
      title: "Measurement", learning_objective: "Distinguish reliability from validity",
      related_concept_description: "Measurement evidence", order_index: 1,
      items: { create: Array.from({ length: 6 }, (_, index) => ({
        item_order: index + 1, item_stem: `Duplicate ${index % 3 + 1}: What does reliability describe?`,
        options: [{ label: "A", text: "Consistency" }, { label: "B", text: "Every interpretation is valid" }],
        correct_option: "A", status: index === 4 ? "archived" as const : "draft" as const
      })) }
    } }
  }, include: { concept_units: { include: { items: { orderBy: { item_order: "asc" } } } } } });
  const unit = assessment.concept_units[0];
  return { teacher, assessment, unit, items: unit.items,
    scope: { teacher_user_db_id: teacher.id, assessment_public_id: assessment.assessment_public_id } };
}

async function fails(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) => error instanceof ContentServiceError && error.code === code);
}

async function main() {
  const base = await fixture();
  if (process.argv.includes("--fixture")) {
    console.log(JSON.stringify({ teacher: base.teacher, assessmentId: base.assessment.assessment_public_id, itemIds: base.items.map((item) => item.item_public_id) }));
    return;
  }
  const ids = [base.items[3].item_public_id, base.items[4].item_public_id];
  const selection = { ...base.scope, data: { item_public_ids: ids } };
  const preview = await previewItemDeletion(selection);
  assert.equal(preview.remaining_item_count, 4);
  assert.equal(preview.remaining_included_item_count, 4);
  assert.equal(await prisma.item.count({ where: { concept_unit_db_id: base.unit.id } }), 6);
  const payload = { item_public_ids: ids, selection_fingerprint: preview.selection_fingerprint, delete_confirmation: preview.required_delete_confirmation };
  await fails(() => deleteSelectedItems({ ...base.scope, data: { ...payload, delete_confirmation: "DELETE" } }), "validation_failed");
  await assert.rejects(() => previewItemDeletion({ ...base.scope, data: { item_public_ids: [ids[0], ids[0]] } }));
  await assert.rejects(() => previewItemDeletion({ ...base.scope, data: { item_public_ids: [] } }));
  await assert.rejects(() => previewItemDeletion({ ...base.scope, data: { item_public_ids: Array.from({ length: 101 }, (_, i) => `id_${i}`) } }));
  checks.push("preview is read-only; exact confirmation and bounded unique selection required");

  const other = await fixture();
  await fails(() => previewItemDeletion({ ...selection, teacher_user_db_id: other.teacher.id }), "not_found");
  await fails(() => previewItemDeletion({ ...base.scope, data: { item_public_ids: [ids[0], other.items[0].item_public_id] } }), "not_found");
  await prisma.user.update({ where: { id: other.teacher.id }, data: { account_status: "inactive" } });
  await fails(() => previewItemDeletion({ ...selection, teacher_user_db_id: other.teacher.id }), "forbidden");
  await prisma.user.update({ where: { id: other.teacher.id }, data: { account_status: "active", role: "student" } });
  await fails(() => previewItemDeletion({ ...selection, teacher_user_db_id: other.teacher.id }), "forbidden");
  checks.push("other teachers, students, inactive accounts and cross-assessment selections rejected");

  await prisma.item.update({ where: { id: base.items[0].id }, data: { item_stem: "Changed in another tab" } });
  await fails(() => deleteSelectedItems({ ...base.scope, data: payload }), "conflict");
  assert.equal(await prisma.item.count({ where: { concept_unit_db_id: base.unit.id } }), 6);
  checks.push("stale content fingerprint rejects entire deletion");

  const verification = await prisma.itemVerificationRun.create({ data: {
    concept_unit_db_id: base.unit.id, content_fingerprint: "historical-fixture", concept_unit_version: 1,
    verification_status: "passed", deterministic_validation_result: { ok: true }
  } });
  await prisma.conceptUnit.update({ where: { id: base.unit.id }, data: { latest_item_verification_run_db_id: verification.id } });
  const batch = await prisma.mcqItemImportBatch.create({ data: {
    assessment_db_id: base.assessment.id, uploaded_by_user_db_id: base.teacher.id,
    source_type: "synthetic", source_checksum: "historical-fixture", validation_summary: {},
    candidates_payload: { candidates: ids.map((id) => ({ status: "imported", imported_item_public_id: id })) }
  } });
  await prisma.itemMediaAsset.create({ data: {
    item_db_id: base.items[3].id, placement: "item_stem", media_type: "image", source_type: "external_url",
    external_url: "https://example.invalid/synthetic.png", alt_text_or_description: "Synthetic media", media_context_hash: "synthetic"
  } });
  const current = await previewItemDeletion(selection);
  const survivor = await prisma.item.findUnique({ where: { id: base.items[0].id } });
  const deletion = await deleteSelectedItems({ ...base.scope, data: { ...payload, selection_fingerprint: current.selection_fingerprint } });
  assert.deepEqual(deletion.deleted_item_public_ids, ids);
  assert.equal(await prisma.item.count({ where: { concept_unit_db_id: base.unit.id } }), 4);
  assert.equal(await prisma.itemMediaAsset.count({ where: { item_db_id: base.items[3].id } }), 0);
  assert.deepEqual(await prisma.item.findUnique({ where: { id: base.items[0].id } }), survivor);
  assert.deepEqual(await prisma.itemVerificationRun.findUnique({ where: { id: verification.id } }), verification);
  assert.deepEqual(await prisma.mcqItemImportBatch.findUnique({ where: { id: batch.id } }), batch);
  assert.equal((await prisma.conceptUnit.findUniqueOrThrow({ where: { id: base.unit.id } })).latest_item_verification_run_db_id, null);
  const audit = await prisma.assessmentLifecycleOperation.findUniqueOrThrow({ where: { operation_public_id: deletion.deletion_operation_public_id } });
  assert.equal(audit.command_type, "teacher_delete_unused_items");
  assert(!JSON.stringify(audit.response_payload).includes("correct_option"));
  assert(!JSON.stringify(audit.response_payload).includes("reliability"));
  await fails(() => deleteSelectedItems({ ...base.scope, data: { ...payload, selection_fingerprint: current.selection_fingerprint } }), "not_found");
  checks.push("selected draft and archived items removed atomically; survivor content/order, imports and historical verification retained; safe audit; replay rejected");

  for (const status of ["published", "archived"] as const) {
    await prisma.assessment.update({ where: { id: base.assessment.id }, data: { status } });
    await fails(() => previewItemDeletion({ ...base.scope, data: { item_public_ids: [base.items[0].item_public_id] } }), status === "published" ? "published_content_must_return_to_draft_before_editing" : "assessment_archived");
  }
  await prisma.assessment.update({ where: { id: base.assessment.id }, data: { status: "draft" } });
  const beforeSession = await previewItemDeletion({ ...base.scope, data: { item_public_ids: [base.items[0].item_public_id] } });
  const session = await prisma.assessmentSession.create({ data: {
    assessment_db_id: base.assessment.id, user_db_id: other.teacher.id, status: "completed", current_phase: "session_completed"
  } });
  await fails(() => deleteSelectedItems({ ...base.scope, data: { item_public_ids: [base.items[0].item_public_id], selection_fingerprint: beforeSession.selection_fingerprint, delete_confirmation: beforeSession.required_delete_confirmation } }), "content_locked_after_student_session");
  assert.equal(await prisma.assessmentSession.count({ where: { id: session.id } }), 1);
  const evidenceFixture = await fixture();
  await prisma.processEvent.create({ data: {
    assessment_session_db_id: session.id, item_db_id: evidenceFixture.items[0].id,
    event_type: "synthetic", event_category: "synthetic", event_source: "backend", occurred_at: new Date()
  } });
  await fails(() => previewItemDeletion({ ...evidenceFixture.scope, data: { item_public_ids: [evidenceFixture.items[0].item_public_id] } }), "content_locked_after_student_session");
  checks.push("published/archived versions, newly started sessions and cross-linked student evidence protected");

  const concurrent = await fixture();
  const chosen = concurrent.items.slice(0, 2).map((item) => item.item_public_id);
  const concurrentPreview = await previewItemDeletion({ ...concurrent.scope, data: { item_public_ids: chosen } });
  const request = { ...concurrent.scope, data: { item_public_ids: chosen, selection_fingerprint: concurrentPreview.selection_fingerprint, delete_confirmation: concurrentPreview.required_delete_confirmation } };
  const results = await Promise.allSettled([deleteSelectedItems(request), deleteSelectedItems(request)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(await prisma.assessmentLifecycleOperation.count({ where: { target_assessment_public_id: concurrent.assessment.assessment_public_id } }), 1);
  checks.push("simultaneous duplicate deletion commits exactly once");

  // Hold the same parent row used by deletion, then commit a changed generation
  // before queued publication can finish. Publication must reject stale validation.
  for (const publishTopic of [false, true]) {
    const racing = await fixture();
    let release!: () => void, locked!: () => void;
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM assessments WHERE id = ${racing.assessment.id}::uuid FOR UPDATE`);
      locked(); await hold;
      await tx.item.deleteMany({ where: { concept_unit_db_id: racing.unit.id, item_order: { gt: 2 } } });
      await tx.assessment.update({ where: { id: racing.assessment.id }, data: { updated_at: new Date() } });
    }, { timeout: 15_000 });
    await ready;
    const publishing = publishTopic
      ? publishConceptUnit({ teacher_user_db_id: racing.teacher.id, concept_unit_public_id: racing.unit.concept_unit_public_id, confirm_publish_without_current_verification: true })
      : publishAssessment(racing.scope);
    const outcome = publishing.then(() => null, (error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 200));
    release(); await blocker;
    const error = await outcome;
    assert(error instanceof ContentServiceError, "Publication must not publish deleted content");
    assert(["conflict", "publish_validation_failed", "concept_unit_item_count_invalid"].includes(error.code));
    assert.equal((await prisma.assessment.findUniqueOrThrow({ where: { id: racing.assessment.id } })).status, "draft");
  }
  checks.push("both topic and assessment publication reject concurrent deletion");
  assert.equal(await prisma.agentCall.count(), 0);
  console.log(JSON.stringify({ passed: checks.length, checks, provider_calls: 0, production_writes: 0 }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
