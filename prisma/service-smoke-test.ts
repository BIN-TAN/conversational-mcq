import { randomUUID } from "node:crypto";
import type { Item } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { generatePublicId } from "../src/lib/services/ids";
import { logProcessEvent } from "../src/lib/services/process-events";
import { logConversationTurn } from "../src/lib/services/conversation-turns";
import { validatePhaseTransition } from "../src/lib/services/phase-transitions";
import {
  startAssessmentSession,
  updateAssessmentSessionPhase
} from "../src/lib/services/session-state";
import { createResponsePackage } from "../src/lib/services/response-packages";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function ensureDemoUsers() {
  const [teacherPasswordHash, studentAccessCodeHash] = await Promise.all([
    hashSecret("teacher_demo_password"),
    hashSecret("student_demo_access_code")
  ]);
  const teacher = await prisma.user.upsert({
    where: { user_id: "teacher_demo" },
    update: {
      role: "teacher_researcher",
      user_id_normalized: normalizeUserId("teacher_demo"),
      password_hash: teacherPasswordHash,
      access_code_hash: null
    },
    create: {
      user_id: "teacher_demo",
      user_id_normalized: normalizeUserId("teacher_demo"),
      role: "teacher_researcher",
      password_hash: teacherPasswordHash
    }
  });
  const student = await prisma.user.upsert({
    where: { user_id: "student_demo" },
    update: {
      role: "student",
      user_id_normalized: normalizeUserId("student_demo"),
      password_hash: null,
      access_code_hash: studentAccessCodeHash
    },
    create: {
      user_id: "student_demo",
      user_id_normalized: normalizeUserId("student_demo"),
      role: "student",
      access_code_hash: studentAccessCodeHash
    }
  });

  return { teacher, student };
}

async function main() {
  const prefix = `service_smoke_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const { teacher, student } = await ensureDemoUsers();
  const created = {
    assessmentId: "",
    conceptUnitId: "",
    itemIds: [] as string[],
    assessmentSessionId: "",
    conceptUnitSessionId: ""
  };

  try {
    const assessment = await prisma.assessment.create({
      data: {
        assessment_public_id: generatePublicId("assessment"),
        title: "Phase 2B Service Smoke Assessment",
        description: `Temporary service smoke test ${prefix}`,
        status: "draft",
        created_by_user_db_id: teacher.id
      }
    });
    created.assessmentId = assessment.id;

    const conceptUnit = await prisma.conceptUnit.create({
      data: {
        concept_unit_public_id: generatePublicId("concept_unit"),
        assessment_db_id: assessment.id,
        title: "Phase 2B Service Smoke Concept",
        learning_objective: "Verify foundational backend services.",
        related_concept_description: "Temporary concept unit for service smoke testing.",
        administration_rules: { initial_administration: "no_feedback" },
        order_index: 1,
        status: "draft",
        version: 1
      }
    });
    created.conceptUnitId = conceptUnit.id;

    const items: Item[] = [];
    for (const itemOrder of [1, 2, 3]) {
      const item = await prisma.item.create({
        data: {
          item_public_id: generatePublicId("item"),
          concept_unit_db_id: conceptUnit.id,
          item_order: itemOrder,
          item_stem: `Phase 2B service smoke item ${itemOrder}`,
          options: [
            { key: "A", text: "Alpha" },
            { key: "B", text: "Beta" },
            { key: "C", text: "Gamma" }
          ],
          correct_option: "A",
          distractor_rationales: { B: "Temporary distractor", C: "Temporary distractor" },
          expected_reasoning_patterns: ["Identifies Alpha as the temporary correct answer."],
          possible_misconception_indicators: ["Selects a temporary distractor."],
          administration_rules: { confidence_required: true },
          status: "draft",
          version: 1
        }
      });
      items.push(item);
      created.itemIds.push(item.id);
    }

    const assessmentSession = await startAssessmentSession({
      user_db_id: student.id,
      assessment_db_id: assessment.id,
      session_public_id: generatePublicId("session")
    });
    created.assessmentSessionId = assessmentSession.id;

    const conceptUnitSession = await prisma.conceptUnitSession.create({
      data: {
        assessment_session_db_id: assessmentSession.id,
        concept_unit_db_id: conceptUnit.id,
        status: "initial_in_progress",
        initial_started_at: new Date(),
        followup_status: "not_started"
      }
    });
    created.conceptUnitSessionId = conceptUnitSession.id;

    await prisma.assessmentSession.update({
      where: { id: assessmentSession.id },
      data: { current_concept_unit_db_id: conceptUnit.id }
    });

    assert(
      validatePhaseTransition("session_started", "concept_unit_intro").allowed,
      "Expected session_started -> concept_unit_intro to be valid."
    );
    assert(
      !validatePhaseTransition("initial_item_administration", "planning_pending").allowed,
      "Expected arbitrary phase jump to be rejected."
    );

    await updateAssessmentSessionPhase({
      assessment_session_db_id: assessmentSession.id,
      to_phase: "concept_unit_intro"
    });
    await updateAssessmentSessionPhase({
      assessment_session_db_id: assessmentSession.id,
      to_phase: "initial_item_administration"
    });

    const rejected = await updateAssessmentSessionPhase({
      assessment_session_db_id: assessmentSession.id,
      to_phase: "planning_pending",
      reason: "Service smoke rejected jump"
    });
    assert(!rejected.transition.allowed, "Rejected transition was incorrectly allowed.");

    await updateAssessmentSessionPhase({
      assessment_session_db_id: assessmentSession.id,
      to_phase: "missing_evidence_repair"
    });
    await updateAssessmentSessionPhase({
      assessment_session_db_id: assessmentSession.id,
      to_phase: "initial_item_administration"
    });
    await updateAssessmentSessionPhase({
      assessment_session_db_id: assessmentSession.id,
      to_phase: "initial_concept_unit_completed"
    });

    const firstItem = items[0];
    const itemResponse = await prisma.itemResponse.create({
      data: {
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: firstItem.id,
        selected_option: "A",
        correct_option_snapshot: firstItem.correct_option,
        correctness: "correct",
        reasoning_text: "Temporary service smoke reasoning.",
        confidence_rating: "high",
        item_response_time_ms: 1500,
        item_started_at: new Date(),
        item_submitted_at: new Date(),
        skipped_reasoning: false,
        skipped_confidence: false,
        revision_count: 1,
        missing_evidence_repair_offered: false,
        item_version_snapshot: firstItem.version,
        item_snapshot: {
          item_public_id: firstItem.item_public_id,
          item_stem: firstItem.item_stem,
          options: firstItem.options,
          correct_option: firstItem.correct_option,
          version: firstItem.version
        },
        client_submission_id: `${prefix}_submission_1`
      }
    });
    assert(itemResponse.correctness === "correct", "Item response was not written.");

    await logConversationTurn({
      assessment_session_db_id: assessmentSession.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: firstItem.id,
      phase: "initial_item_administration",
      actor_type: "student",
      message_text: "I choose A.",
      structured_payload: { selected_option: "A", confidence_rating: "high" }
    });
    await logConversationTurn({
      assessment_session_db_id: assessmentSession.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: firstItem.id,
      phase: "initial_item_administration",
      actor_type: "orchestrator",
      message_text: "Recorded initial response.",
      structured_payload: { client_submission_id: `${prefix}_submission_1` }
    });
    await logConversationTurn({
      assessment_session_db_id: assessmentSession.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      phase: "followup_active",
      actor_type: "student",
      message_text: "A later follow-up turn placeholder."
    });

    const eventBase = {
      assessment_session_db_id: assessmentSession.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: firstItem.id,
      event_category: "service_smoke",
      event_source: "backend" as const
    };
    await logProcessEvent({ ...eventBase, event_type: "item_submitted", payload: { source: prefix } });
    await logProcessEvent({ ...eventBase, event_type: "page_hidden", visibility_duration_ms: 250 });
    await logProcessEvent({ ...eventBase, event_type: "page_visible", visibility_duration_ms: 250 });
    await logProcessEvent({ ...eventBase, event_type: "long_pause", pause_duration_ms: 30000 });
    await logProcessEvent({ ...eventBase, event_type: "invalid_help_request" });
    await logProcessEvent({ ...eventBase, event_type: "prompt_injection_attempt" });
    await logProcessEvent({ ...eventBase, event_type: "procedural_clarification_request" });
    await logProcessEvent({ ...eventBase, event_type: "emotional_or_frustration_response" });
    await logProcessEvent({ ...eventBase, event_type: "agent_retry_scheduled", item_db_id: undefined });
    await logProcessEvent({ ...eventBase, event_type: "schema_validation_failed", item_db_id: undefined });

    const responsePackage = await createResponsePackage({
      concept_unit_session_db_id: conceptUnitSession.id,
      package_type: "initial_concept_unit_response_package"
    });
    const packagePayload = responsePackage.payload as {
      process_counts?: {
        event_count_by_type?: Record<string, number>;
        page_switch_count?: number;
        long_pause_count?: number;
        invalid_help_request_count?: number;
        prompt_injection_attempt_count?: number;
        procedural_clarification_count?: number;
        emotional_response_count?: number;
        agent_retry_count?: number;
        validation_failure_count?: number;
        followup_turn_count?: number;
      };
      item_responses?: unknown[];
      conversation_turns?: unknown[];
    };

    assert(responsePackage.package_type === "initial_concept_unit_response_package", "Wrong package type.");
    assert(packagePayload.item_responses?.length === 1, "Response package missing item response.");
    assert(packagePayload.conversation_turns?.length === 3, "Response package missing conversation turns.");
    assert(packagePayload.process_counts?.page_switch_count === 2, "Incorrect page switch count.");
    assert(packagePayload.process_counts?.long_pause_count === 1, "Incorrect long pause count.");
    assert(
      packagePayload.process_counts?.invalid_help_request_count === 1,
      "Incorrect invalid help request count."
    );
    assert(
      packagePayload.process_counts?.prompt_injection_attempt_count === 1,
      "Incorrect prompt injection count."
    );
    assert(
      packagePayload.process_counts?.procedural_clarification_count === 1,
      "Incorrect procedural clarification count."
    );
    assert(
      packagePayload.process_counts?.emotional_response_count === 1,
      "Incorrect emotional response count."
    );
    assert(packagePayload.process_counts?.agent_retry_count === 1, "Incorrect agent retry count.");
    assert(
      packagePayload.process_counts?.validation_failure_count === 1,
      "Incorrect validation failure count."
    );
    assert(packagePayload.process_counts?.followup_turn_count === 1, "Incorrect follow-up turn count.");

    console.log("Phase 2B service smoke test passed.");
  } finally {
    if (created.conceptUnitSessionId) {
      await prisma.responsePackage.deleteMany({
        where: { concept_unit_session_db_id: created.conceptUnitSessionId }
      });
      await prisma.itemResponse.deleteMany({
        where: { concept_unit_session_db_id: created.conceptUnitSessionId }
      });
      await prisma.conversationTurn.deleteMany({
        where: { concept_unit_session_db_id: created.conceptUnitSessionId }
      });
      await prisma.processEvent.deleteMany({
        where: { concept_unit_session_db_id: created.conceptUnitSessionId }
      });
      await prisma.conceptUnitSession
        .delete({ where: { id: created.conceptUnitSessionId } })
        .catch(() => undefined);
    }
    if (created.assessmentSessionId) {
      await prisma.processEvent.deleteMany({
        where: { assessment_session_db_id: created.assessmentSessionId }
      });
      await prisma.conversationTurn.deleteMany({
        where: { assessment_session_db_id: created.assessmentSessionId }
      });
      await prisma.assessmentSession
        .delete({ where: { id: created.assessmentSessionId } })
        .catch(() => undefined);
    }
    if (created.itemIds.length > 0) {
      await prisma.item.deleteMany({ where: { id: { in: created.itemIds } } });
    }
    if (created.conceptUnitId) {
      await prisma.conceptUnit.delete({ where: { id: created.conceptUnitId } }).catch(() => undefined);
    }
    if (created.assessmentId) {
      await prisma.assessment.delete({ where: { id: created.assessmentId } }).catch(() => undefined);
    }
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
