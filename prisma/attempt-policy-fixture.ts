import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";

export function assertLocalAttemptTest() {
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(database.hostname));
  assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_"));
  assert.equal(process.env.LLM_LIVE_CALLS_ENABLED, "false");
}

export async function createAttemptPolicyFixture(db: PrismaClient, prefix: string) {
  assertLocalAttemptTest();
  const teacher = await db.user.create({ data: { user_id: `${prefix}_teacher`, user_id_normalized: `${prefix}_teacher`, role: "teacher_researcher" } });
  const students = [];
  for (let index = 0; index < 4; index++) students.push(await db.user.create({ data: {
    user_id: `${prefix}_student${index}`, user_id_normalized: `${prefix}_student${index}`, role: "student",
    created_by_teacher_user_id: teacher.id
  } }));
  const assessment = await db.assessment.create({ data: { assessment_public_id: `${prefix}_assessment`,
    title: `${prefix} Measurement concepts`, status: "published", workflow_mode: "automatic", response_collection_mode: "llm_assisted",
    created_by_user_db_id: teacher.id } });
  const concept = await db.conceptUnit.create({ data: { concept_unit_public_id: `${prefix}_concept`, assessment_db_id: assessment.id,
    title: "Interpreting measurement", learning_objective: "Distinguish score consistency from validity evidence",
    related_concept_description: "Synthetic classroom examples", administration_rules: {}, order_index: 1, status: "published" } });
  const items = [];
  for (let index = 1; index <= 3; index++) items.push(await db.item.create({ data: {
    item_public_id: `${prefix}_item${index}`, concept_unit_db_id: concept.id, item_order: index,
    item_stem: `Example ${index}: Does a consistent score establish that a test measures its intended construct?`,
    options: [{ label: "A", text: "No. We also need evidence supporting the intended interpretation." },
      { label: "B", text: "Yes. Consistency alone establishes validity." }, { label: "C", text: "Only the number of questions matters." }],
    correct_option: "A", distractor_rationales: { B: "Confuses consistency with validity", C: "Confuses length with validity" },
    expected_reasoning_patterns: ["Distinguishes reliability from validity"], possible_misconception_indicators: ["Consistency guarantees validity"],
    administration_rules: {}, included_in_published_set: true, status: "published", version: 1
  } }));
  return { teacher, students, assessment, concept, items };
}

export async function createRecordedAttempt(db: PrismaClient, fixture: Awaited<ReturnType<typeof createAttemptPolicyFixture>>,
  studentIndex: number, attempt: number, selected: string | null, legacy = false) {
  const at = new Date(Date.UTC(2026, 8, 1 + attempt, 12));
  const session = await db.assessmentSession.create({ data: {
    session_public_id: `${fixture.assessment.assessment_public_id}_${studentIndex}_${attempt}`,
    assessment_db_id: fixture.assessment.id, user_db_id: fixture.students[studentIndex].id, attempt_number: attempt,
    status: selected ? "student_exited" : "active", current_phase: selected ? "student_exited" : "initial_item_administration",
    started_at: at, created_at: at, current_concept_unit_db_id: fixture.concept.id
  } });
  if (!legacy) await db.assessmentAttemptChance.create({ data: { session_public_id: session.session_public_id,
    student_db_id: session.user_db_id, assessment_public_id: fixture.assessment.assessment_public_id,
    assessment_family_public_id: fixture.assessment.assessment_public_id, attempt_number: attempt, used_at: at } });
  const conceptSession = await db.conceptUnitSession.create({ data: { assessment_session_db_id: session.id,
    concept_unit_db_id: fixture.concept.id, initial_started_at: at } });
  if (selected) {
    const submitted = new Date(at.getTime() + 120_000);
    for (const item of fixture.items) await db.itemResponse.create({ data: {
      concept_unit_session_db_id: conceptSession.id, item_db_id: item.id, selected_option: selected,
      correct_option_snapshot: "A", correctness: selected === "A" ? "correct" : "incorrect", confidence_rating: "high",
      reasoning_text: "Synthetic reasoning", item_version_snapshot: 1, item_snapshot: { item }, item_submitted_at: submitted
    } });
    await db.responsePackage.create({ data: { concept_unit_session_db_id: conceptSession.id,
      package_type: "initial_concept_unit_response_package", created_at: submitted, payload: {
        initial_item_count: 3, completed_initial_item_count: 3,
        concept_unit: { learning_objective: fixture.concept.learning_objective },
        included_items: fixture.items.map(item => ({ item_public_id: item.item_public_id })),
        item_responses: fixture.items.map(item => ({ item_public_id: item.item_public_id, item_order: item.item_order,
          item_version_snapshot: 1, item_snapshot: { item }, correct_option_snapshot: "A",
          selected_answer_initial: "B", selected_answer_final: selected, confidence_initial: "low", confidence_final: "high",
          reasoning_text_initial: "First reason", reasoning_text_final: "Synthetic reasoning",
          correctness: selected === "A" ? "correct" : "incorrect" }))
      } } });
  }
  return session;
}
