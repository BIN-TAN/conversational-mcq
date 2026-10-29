/**
 * Item review v2 against the database (item-review-decisions-v2):
 * - Tutor flags (FormativeConversationReviewSignal, feedback_v8_instructor_review,
 *   possible_item_issue) are tied to the items they name and join the item review.
 * - A decision resolves a tutor flag only when every item the flag names has a decision made
 *   after it; a flag that arrives after a decision asks for attention again.
 * - The instructor home page finds mini tests with items awaiting a decision through the
 *   profile and signal pre-queries.
 * No provider calls. Run with: npx tsx prisma/item-review-tutor-flags-smoke-test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createResponsePackage } from "../src/lib/services/response-packages";
import { loadInterpretationInputV8 } from "../src/lib/services/student-assessment/interpretation-v8/input-builder";
import { buildStoredInterpretationV8 } from "../src/lib/services/student-assessment/interpretation-v8/profile";
import {
  listItemReviews,
  listItemsAwaitingReview,
  recordItemReviewDecision
} from "../src/lib/services/item-review/service";
import { cleanupResponseCollectionFixture, createResponseCollectionFixture } from "./response-collection-smoke-fixture";

const prisma = new PrismaClient();

process.env.LLM_PROVIDER = "mock";
process.env.LLM_LIVE_CALLS_ENABLED = "false";
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY_FILE;

async function cleanup(prefix: string) {
  const items = await prisma.item.findMany({
    where: { concept_unit: { assessment: { title: { startsWith: prefix } } } },
    select: { id: true }
  });
  for (const item of items) {
    await prisma.$executeRaw`DELETE FROM item_review_decisions WHERE item_db_id = ${item.id}::uuid`;
  }
  await prisma.formativeConversationSession.deleteMany({
    where: { assessment_session: { assessment: { title: { startsWith: prefix } } } }
  });
  await cleanupResponseCollectionFixture(prisma, prefix);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const prefix = `item_review_v2_${Date.now()}_${randomUUID().slice(0, 8)}`;
  await cleanup(prefix);
  try {
    const fixture = await createResponseCollectionFixture({ prisma, prefix, responseCollectionMode: "deterministic" });
    const completedAt = new Date("2026-10-27T18:00:00.000Z");
    await prisma.conceptUnitSession.update({
      where: { id: fixture.conceptUnitSession.id },
      data: { status: "initial_completed", initial_completed_at: completedAt }
    });
    for (const [index, item] of fixture.items.entries()) {
      await prisma.itemResponse.create({
        data: {
          concept_unit_session_db_id: fixture.conceptUnitSession.id,
          item_db_id: item.id,
          selected_option: index === 1 ? "B" : "A",
          correct_option_snapshot: "A",
          correctness: index === 1 ? "incorrect" : "correct",
          reasoning_text: index === 1 ? "B also fits the way the stem is worded." : "The response uses the evidence described in the item.",
          confidence_rating: "medium",
          item_started_at: new Date(completedAt.getTime() - 60_000),
          item_submitted_at: completedAt,
          answer_explanation_revealed: true,
          revealed_at: completedAt,
          reveal_trigger: "initial_package_review",
          item_version_snapshot: item.version,
          item_snapshot: {
            item_public_id: item.item_public_id,
            item_stem: item.item_stem,
            options: item.options,
            expected_reasoning_patterns: item.expected_reasoning_patterns
          }
        }
      });
    }
    await createResponsePackage({
      concept_unit_session_db_id: fixture.conceptUnitSession.id,
      package_type: "initial_concept_unit_response_package"
    });
    const responsePackage = await prisma.responsePackage.findFirstOrThrow({
      where: { concept_unit_session_db_id: fixture.conceptUnitSession.id, package_type: "initial_concept_unit_response_package" },
      select: { id: true }
    });
    const loaded = await loadInterpretationInputV8({
      concept_unit_session_db_id: fixture.conceptUnitSession.id,
      response_package_id: responsePackage.id
    });
    assert.deepEqual(loaded.input.items.map((item) => item.item_id), fixture.items.map((item) => item.item_public_id));
    const stored = buildStoredInterpretationV8({
      model_input: loaded.input,
      output: null,
      generation_mode: "local_test",
      fallback_reason: null,
      response_package_id: loaded.response_package_id,
      answer_review_v2: null
    });
    // The interpretation flags Item 2 as a possible item issue.
    stored.items = stored.items.map((item, index) => index === 1
      ? { ...item, status: "not_supported", item_review_flag: true, evidence_quote: "B also fits the way the stem is worded", rationale: "The student's reading of the stem looks defensible." }
      : { ...item, status: "supported" });
    const profile = await prisma.studentProfile.create({
      data: {
        concept_unit_session_db_id: fixture.conceptUnitSession.id,
        profile_type: "initial",
        ability_profile: "partial_understanding",
        ability_pattern_flags: [],
        engagement_profile: "adequate_engagement",
        engagement_pattern_flags: ["no_clear_pattern"],
        integrated_diagnostic_profile: "developing_understanding_with_productive_engagement",
        integrated_profile_confidence: "medium",
        integrated_profile_rationale: "Item review v2 smoke fixture.",
        evidence_sufficiency: "adequate",
        confidence_alignment: "well_calibrated",
        independence_interpretability: "not_applicable",
        misconception_indicators: [],
        item_level_evidence: JSON.parse(JSON.stringify(stored)),
        reasoning_quality_summary: "Fixture.",
        engagement_summary: "The initial package was completed.",
        process_interpretation_cautions: [],
        profile_confidence: "medium",
        rationale: "Item review v2 smoke fixture.",
        recommended_next_evidence: []
      }
    });
    const conversation = await prisma.formativeConversationSession.create({
      data: {
        assessment_session_db_id: fixture.session.id,
        concept_unit_session_db_id: fixture.conceptUnitSession.id,
        initial_student_profile_db_id: profile.id,
        current_student_profile_db_id: profile.id
      }
    });
    const signal = (reason: string, focusItems: number[]) => prisma.formativeConversationReviewSignal.create({
      data: {
        formative_conversation_session_db_id: conversation.id,
        source_student_profile_db_id: profile.id,
        signal_type: "feedback_v8_instructor_review",
        reason_code: "possible_item_issue",
        evidence_summary: { reason, focus: { item_numbers: focusItems, focus_type: "single_item", concept: "Fixture" }, student_evidence: [] }
      }
    });
    const named3 = await signal("Item 3: options B and C say nearly the same thing.", [1]);
    const focusFlagged = await signal("The student's reading of the stem may be defensible.", [2]);
    const named1and3 = await signal("Items 1 and 3 may each allow a second reading.", [1]);
    // A flag of another kind is not part of the item review.
    await prisma.formativeConversationReviewSignal.create({
      data: {
        formative_conversation_session_db_id: conversation.id,
        signal_type: "feedback_v8_instructor_review",
        reason_code: "student_requested_instructor",
        evidence_summary: { reason: "Item 1: the student asked for the instructor.", focus: { item_numbers: [1] } }
      }
    });

    const teacher = fixture.teacher.id;
    const assessmentPublicId = fixture.assessment.assessment_public_id;
    const [item1, item2, item3] = fixture.items.map((item) => item.item_public_id);
    const review = async () => {
      const result = await listItemReviews({ teacher_user_db_id: teacher, assessment_public_id: assessmentPublicId });
      return { result, byId: new Map(result.items.map((item) => [item.item_public_id, item])) };
    };

    const first = await review();
    const result = first.result;
    let byId = first.byId;
    assert.equal(result.item_review_version, "item-review-decisions-v2");
    assert.deepEqual(result.items.map((item) => item.item_number), [1, 2, 3], "Items are numbered as students saw them");
    assert.deepEqual(byId.get(item3)!.tutor_flags.map((flag) => flag.signal_public_id).sort(), [named3.signal_public_id, named1and3.signal_public_id].sort());
    assert.deepEqual(byId.get(item2)!.tutor_flags.map((flag) => flag.signal_public_id), [focusFlagged.signal_public_id],
      "A flag that names no item goes to the focus item the interpretation flagged");
    assert.deepEqual(byId.get(item1)!.tutor_flags.map((flag) => flag.signal_public_id), [named1and3.signal_public_id]);
    assert.equal(byId.get(item2)!.flagged_by.length, 1);
    assert(result.items.every((item) => item.awaiting_decision));
    assert.deepEqual(result.untied_tutor_flags, []);

    const awaiting = await listItemsAwaitingReview({ teacher_user_db_id: teacher });
    assert.deepEqual(awaiting, [{ assessment_public_id: assessmentPublicId, title: fixture.assessment.title, items_awaiting: 3 }],
      "The home page finds the mini test through the profile and signal pre-queries");

    // A decision on Item 3 resolves the flag that names only Item 3, not the one that also names Item 1.
    await recordItemReviewDecision({ teacher_user_db_id: teacher, assessment_public_id: assessmentPublicId, item_public_id: item3, decision: "kept" });
    const status = async (id: string) => (await prisma.formativeConversationReviewSignal.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
    assert.equal(await status(named3.id), "resolved");
    assert.equal(await status(named1and3.id), "open");
    ({ byId } = await review());
    assert.equal(byId.get(item3)!.awaiting_decision, false);
    assert(byId.get(item3)!.tutor_flags.every((flag) => !flag.after_decision));
    assert.equal(byId.get(item1)!.awaiting_decision, true);

    await recordItemReviewDecision({ teacher_user_db_id: teacher, assessment_public_id: assessmentPublicId, item_public_id: item1, decision: "kept" });
    assert.equal(await status(named1and3.id), "resolved", "Once both items have a decision, the flag is resolved");
    await recordItemReviewDecision({ teacher_user_db_id: teacher, assessment_public_id: assessmentPublicId, item_public_id: item2, decision: "excluded", note: "Stem allows B." });
    assert.equal(await status(focusFlagged.id), "resolved");
    assert.deepEqual(await listItemsAwaitingReview({ teacher_user_db_id: teacher }), []);

    // A flag after the decision on Item 3 asks for attention again.
    await pause(50);
    const later = await signal("Item 3 still reads two ways for this student.", [3]);
    ({ byId } = await review());
    assert.equal(byId.get(item3)!.awaiting_decision, true);
    assert.equal(byId.get(item3)!.tutor_flags.find((flag) => flag.signal_public_id === later.signal_public_id)!.after_decision, true);
    assert.equal(byId.get(item1)!.awaiting_decision, false);
    // The decision cache is cleared only by a decision; read the uncached result through a new decision.
    await recordItemReviewDecision({ teacher_user_db_id: teacher, assessment_public_id: assessmentPublicId, item_public_id: item1, decision: "kept" });
    assert.deepEqual((await listItemsAwaitingReview({ teacher_user_db_id: teacher })).map((entry) => entry.items_awaiting), [1]);
    await recordItemReviewDecision({ teacher_user_db_id: teacher, assessment_public_id: assessmentPublicId, item_public_id: item3, decision: "kept" });
    assert.equal(await status(later.id), "resolved");
    assert.deepEqual(await listItemsAwaitingReview({ teacher_user_db_id: teacher }), []);

    // Another instructor cannot read this review.
    await assert.rejects(listItemReviews({ teacher_user_db_id: randomUUID(), assessment_public_id: assessmentPublicId }), /not found/i);

    console.log("Item review v2 smoke test passed. No provider calls were made.");
  } finally {
    await cleanup(prefix);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
