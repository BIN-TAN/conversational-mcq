import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { createResponsePackage } from "../src/lib/services/response-packages";
import { mergeProvisionalDiagnosticMetadata } from "../src/lib/services/student-assessment/provisional-item-diagnostic-metadata";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

export const teacherReviewAssessmentPublicId = "assessment_demo_teacher_review";
export const teacherReviewConceptUnitPublicId = "concept_demo_teacher_review_initial";
export const teacherReviewSessionPublicId = "session_demo_teacher_review";
export const teacherReviewItemPublicIds = [
  "item_demo_teacher_review_1",
  "item_demo_teacher_review_2",
  "item_demo_teacher_review_3"
] as const;

const teacherUserId = "teacher_demo";
const teacherPassword = "teacher_demo_password";
const studentUserId = "student_demo";
const studentAccessCode = "student_demo_access_code";

function minutesAfter(base: Date, minutes: number) {
  return new Date(base.getTime() + minutes * 60_000);
}

function demoOptions() {
  return [
    { label: "A", text: "The claim is supported by the relationship described in the prompt." },
    { label: "B", text: "The claim reverses the relationship in the prompt." },
    { label: "C", text: "The claim uses an unrelated feature of the situation." }
  ];
}

function demoItem(itemOrder: number) {
  const stems = [
    "A student compares two explanations for why a metal spoon warms in hot soup. Which explanation best fits energy transfer?",
    "A graph shows distance increasing at a constant rate over time. Which claim best describes the motion?",
    "A plant investigation records light exposure and growth direction. Which conclusion is best supported by the observations?"
  ];

  return {
    item_public_id: teacherReviewItemPublicIds[itemOrder - 1],
    item_order: itemOrder,
    item_stem: stems[itemOrder - 1],
    options: demoOptions(),
    correct_option: "A",
    distractor_rationales: {
      B: "This reverses or misreads the target relationship.",
      C: "This focuses on an unrelated cue rather than the target concept."
    },
    expected_reasoning_patterns: [
      "Uses evidence from the prompt to connect the selected option to the concept."
    ],
    possible_misconception_indicators: [
      "Selects a distractor with reasoning that reverses the relationship or uses an unrelated cue."
    ],
    administration_rules: mergeProvisionalDiagnosticMetadata({
      item_public_id: teacherReviewItemPublicIds[itemOrder - 1],
      administration_rules: {
        no_feedback_during_initial_administration: true,
        fixture: "teacher_review_development_only"
      }
    }),
    included_in_published_set: true,
    status: "published" as const,
    version: 1
  };
}

export async function ensureTeacherReviewDemoUsers(prisma: PrismaClient) {
  const [teacherPasswordHash, studentAccessCodeHash] = await Promise.all([
    hashSecret(teacherPassword),
    hashSecret(studentAccessCode)
  ]);
  const teacher = await prisma.user.upsert({
    where: { user_id: teacherUserId },
    update: {
      role: "teacher_researcher",
      user_id_normalized: normalizeUserId(teacherUserId),
      password_hash: teacherPasswordHash,
      access_code_hash: null
    },
    create: {
      user_id: teacherUserId,
      user_id_normalized: normalizeUserId(teacherUserId),
      role: "teacher_researcher",
      password_hash: teacherPasswordHash
    }
  });
  const student = await prisma.user.upsert({
    where: { user_id: studentUserId },
    update: {
      role: "student",
      user_id_normalized: normalizeUserId(studentUserId),
      password_hash: null,
      access_code_hash: studentAccessCodeHash
    },
    create: {
      user_id: studentUserId,
      user_id_normalized: normalizeUserId(studentUserId),
      role: "student",
      access_code_hash: studentAccessCodeHash
    }
  });

  return { teacher, student };
}

export async function cleanupTeacherReviewDemoFixture(prisma: PrismaClient) {
  const assessment = await prisma.assessment.findUnique({
    where: { assessment_public_id: teacherReviewAssessmentPublicId },
    select: { id: true }
  });

  if (!assessment) {
    return { deleted: false };
  }

  const sessions = await prisma.assessmentSession.findMany({
    where: { assessment_db_id: assessment.id },
    select: { id: true }
  });
  const sessionIds = sessions.map((session) => session.id);
  const conceptUnitSessions = await prisma.conceptUnitSession.findMany({
    where: { assessment_session_db_id: { in: sessionIds } },
    select: { id: true }
  });
  const conceptUnitSessionIds = conceptUnitSessions.map((session) => session.id);

  await prisma.conceptUnitSession.updateMany({
    where: { id: { in: conceptUnitSessionIds } },
    data: {
      latest_student_profile_db_id: null,
      latest_formative_decision_db_id: null
    }
  });
  await prisma.studentActionIdempotencyKey.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.agentCall.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.conversationTurn.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.followupRound.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
  });
  await prisma.formativeDecision.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
  });
  await prisma.studentProfile.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
  });
  await prisma.responsePackage.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
  });
  await prisma.workflowOverride.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.workflowJob.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.agentCall.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.processEvent.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.conversationTurn.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.itemResponse.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
  });
  await prisma.conceptUnitSession.deleteMany({
    where: { id: { in: conceptUnitSessionIds } }
  });
  await prisma.assessmentSession.deleteMany({
    where: { id: { in: sessionIds } }
  });
  await prisma.item.deleteMany({
    where: { concept_unit: { assessment_db_id: assessment.id } }
  });
  await prisma.conceptUnit.deleteMany({
    where: { assessment_db_id: assessment.id }
  });
  await prisma.assessment.delete({
    where: { id: assessment.id }
  });

  return { deleted: true };
}

export async function ensureTeacherReviewDemoFixture(prisma: PrismaClient) {
  await cleanupTeacherReviewDemoFixture(prisma);

  const { teacher, student } = await ensureTeacherReviewDemoUsers(prisma);
  const base = new Date("2026-06-19T14:00:00.000Z");
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: teacherReviewAssessmentPublicId,
      title: "Development Demo: Teacher Session Review",
      description: "Development-only fixture for Phase 5A teacher_researcher session review.",
      status: "published",
      created_by_user_db_id: teacher.id
    }
  });
  const conceptUnit = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: teacherReviewConceptUnitPublicId,
      assessment_db_id: assessment.id,
      title: "Teacher review demo concept",
      learning_objective: "Review mixed MCQ evidence without generating profiles.",
      related_concept_description:
        "Development fixture concept used to inspect item evidence, process context, and response packages.",
      administration_rules: { no_feedback_during_initial_administration: true },
      order_index: 1,
      status: "published",
      version: 1
    }
  });
  const items = [];

  for (const itemOrder of [1, 2, 3]) {
    const item = demoItem(itemOrder);
    const createdItem = await prisma.item.create({
      data: {
        item_public_id: item.item_public_id,
        concept_unit_db_id: conceptUnit.id,
        item_order: item.item_order,
        item_stem: item.item_stem,
        options: item.options,
        correct_option: item.correct_option,
        distractor_rationales: item.distractor_rationales,
        expected_reasoning_patterns: item.expected_reasoning_patterns,
        possible_misconception_indicators: item.possible_misconception_indicators,
        administration_rules: item.administration_rules,
        included_in_published_set: true,
        status: "published",
        version: item.version
      }
    });

    items.push(createdItem);
  }

  const session = await prisma.assessmentSession.create({
    data: {
      session_public_id: teacherReviewSessionPublicId,
      user_db_id: student.id,
      assessment_db_id: assessment.id,
      attempt_number: 1,
      status: "active",
      current_phase: "profiling_pending",
      current_concept_unit_db_id: conceptUnit.id,
      started_at: base,
      last_activity_at: minutesAfter(base, 22),
      completed_at: null
    }
  });
  const conceptUnitSession = await prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_db_id: conceptUnit.id,
      status: "initial_completed",
      initial_started_at: minutesAfter(base, 1),
      initial_completed_at: minutesAfter(base, 21),
      followup_status: "not_started",
      followup_round_count: 0
    }
  });

  const itemSnapshots = items.map((item) => ({
    item_public_id: item.item_public_id,
    item_order: item.item_order,
    item_stem: item.item_stem,
    options: item.options,
    correct_option: item.correct_option,
    version: item.version
  }));

  await prisma.itemResponse.createMany({
    data: [
      {
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[0].id,
        selected_option: "A",
        correct_option_snapshot: items[0].correct_option,
        correctness: "correct",
        reasoning_text:
          "The spoon warms because energy transfers from the hotter soup to the cooler metal spoon.",
        confidence_rating: "high",
        item_response_time_ms: 134_000,
        item_started_at: minutesAfter(base, 2),
        item_submitted_at: minutesAfter(base, 6),
        skipped_reasoning: false,
        skipped_confidence: false,
        skipped_item: false,
        revision_count: 1,
        missing_evidence_repair_offered: false,
        item_version_snapshot: items[0].version,
        item_snapshot: itemSnapshots[0],
        client_submission_id: "teacher_review_demo_item_1"
      },
      {
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[1].id,
        selected_option: "B",
        correct_option_snapshot: items[1].correct_option,
        correctness: "incorrect",
        reasoning_text:
          "I think the graph changes direction because time keeps moving, so B seemed best.",
        confidence_rating: "medium",
        item_response_time_ms: 208_000,
        item_started_at: minutesAfter(base, 7),
        item_submitted_at: minutesAfter(base, 13),
        skipped_reasoning: false,
        skipped_confidence: false,
        skipped_item: false,
        revision_count: 2,
        missing_evidence_repair_offered: false,
        item_version_snapshot: items[1].version,
        item_snapshot: itemSnapshots[1],
        client_submission_id: "teacher_review_demo_item_2"
      },
      {
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[2].id,
        selected_option: null,
        correct_option_snapshot: items[2].correct_option,
        correctness: "unanswered",
        reasoning_text: null,
        confidence_rating: null,
        item_response_time_ms: 96_000,
        item_started_at: minutesAfter(base, 14),
        item_submitted_at: minutesAfter(base, 20),
        skipped_reasoning: true,
        skipped_confidence: true,
        skipped_item: true,
        revision_count: 0,
        missing_evidence_repair_offered: true,
        item_version_snapshot: items[2].version,
        item_snapshot: itemSnapshots[2],
        client_submission_id: "teacher_review_demo_item_3"
      }
    ]
  });

  await prisma.conversationTurn.createMany({
    data: [
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[0].id,
        phase: "initial_item_administration",
        actor_type: "orchestrator",
        message_text: "Please choose an option for item 1.",
        structured_payload: { item_public_id: items[0].item_public_id },
        created_at: minutesAfter(base, 2)
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[0].id,
        phase: "initial_item_administration",
        actor_type: "student",
        message_text:
          "I choose A because heat moves from the hotter soup into the cooler spoon.",
        structured_payload: { selected_option: "A", confidence_rating: "high" },
        created_at: minutesAfter(base, 5)
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[1].id,
        phase: "initial_item_administration",
        actor_type: "orchestrator",
        message_text: "Please choose an option for item 2.",
        structured_payload: { item_public_id: items[1].item_public_id },
        created_at: minutesAfter(base, 7)
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[1].id,
        phase: "initial_item_administration",
        actor_type: "student",
        message_text:
          "I choose B. I revised my reasoning, but I am still unsure about the graph.",
        structured_payload: {
          selected_option: "B",
          confidence_rating: "medium",
          revision_count: 2
        },
        created_at: minutesAfter(base, 12)
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[2].id,
        phase: "missing_evidence_repair",
        actor_type: "orchestrator",
        message_text:
          "You can still provide an answer, reasoning, and confidence, or explicitly skip.",
        structured_payload: {
          missing_fields: ["answer", "reasoning", "confidence"],
          item_public_id: items[2].item_public_id
        },
        created_at: minutesAfter(base, 18)
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[2].id,
        phase: "missing_evidence_repair",
        actor_type: "student",
        message_text: "I want to skip this one.",
        structured_payload: {
          skipped_item: true,
          skipped_reasoning: true,
          skipped_confidence: true
        },
        created_at: minutesAfter(base, 19)
      }
    ]
  });

  const eventBase = {
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id
  };
  const events: Prisma.ProcessEventUncheckedCreateInput[] = [
    {
      ...eventBase,
      item_db_id: items[0].id,
      event_type: "item_presented",
      event_category: "student_response",
      event_source: "backend",
      payload: { item_public_id: items[0].item_public_id },
      occurred_at: minutesAfter(base, 2)
    },
    {
      ...eventBase,
      item_db_id: items[0].id,
      event_type: "option_selected",
      event_category: "student_response",
      event_source: "backend",
      payload: { selected_option: "A" },
      occurred_at: minutesAfter(base, 3)
    },
    {
      ...eventBase,
      item_db_id: items[0].id,
      event_type: "reasoning_entered",
      event_category: "student_response",
      event_source: "backend",
      payload: { length: 78 },
      occurred_at: minutesAfter(base, 4)
    },
    {
      ...eventBase,
      item_db_id: items[0].id,
      event_type: "confidence_selected",
      event_category: "student_response",
      event_source: "backend",
      payload: { confidence_rating: "high" },
      occurred_at: minutesAfter(base, 5)
    },
    {
      ...eventBase,
      item_db_id: items[0].id,
      event_type: "item_submitted",
      event_category: "student_response",
      event_source: "backend",
      payload: { finalized: true },
      occurred_at: minutesAfter(base, 6)
    },
    {
      ...eventBase,
      item_db_id: items[1].id,
      event_type: "item_presented",
      event_category: "student_response",
      event_source: "backend",
      payload: { item_public_id: items[1].item_public_id },
      occurred_at: minutesAfter(base, 7)
    },
    {
      ...eventBase,
      item_db_id: items[1].id,
      event_type: "option_selected",
      event_category: "student_response",
      event_source: "backend",
      payload: { selected_option: "C" },
      occurred_at: minutesAfter(base, 8)
    },
    {
      ...eventBase,
      item_db_id: items[1].id,
      event_type: "option_selected",
      event_category: "student_response",
      event_source: "backend",
      payload: { selected_option: "B", revision: true, revision_count: 1 },
      occurred_at: minutesAfter(base, 9)
    },
    {
      ...eventBase,
      item_db_id: items[1].id,
      event_type: "reasoning_entered",
      event_category: "student_response",
      event_source: "backend",
      payload: { length: 52 },
      occurred_at: minutesAfter(base, 10)
    },
    {
      ...eventBase,
      item_db_id: items[1].id,
      event_type: "reasoning_revised",
      event_category: "student_response",
      event_source: "backend",
      payload: { revision_count: 1 },
      occurred_at: minutesAfter(base, 11)
    },
    {
      ...eventBase,
      item_db_id: items[1].id,
      event_type: "confidence_selected",
      event_category: "student_response",
      event_source: "backend",
      payload: { confidence_rating: "medium" },
      occurred_at: minutesAfter(base, 12)
    },
    {
      ...eventBase,
      item_db_id: items[1].id,
      event_type: "item_submitted",
      event_category: "student_response",
      event_source: "backend",
      payload: { finalized: true },
      occurred_at: minutesAfter(base, 13)
    },
    {
      ...eventBase,
      item_db_id: items[2].id,
      event_type: "item_presented",
      event_category: "student_response",
      event_source: "backend",
      payload: { item_public_id: items[2].item_public_id },
      occurred_at: minutesAfter(base, 14)
    },
    {
      ...eventBase,
      item_db_id: items[2].id,
      event_type: "missing_evidence_detected",
      event_category: "validation",
      event_source: "backend",
      payload: { missing_fields: ["answer", "reasoning", "confidence"] },
      occurred_at: minutesAfter(base, 17)
    },
    {
      ...eventBase,
      item_db_id: items[2].id,
      event_type: "missing_evidence_repair_prompted",
      event_category: "validation",
      event_source: "backend",
      payload: { repair_offer: true },
      occurred_at: minutesAfter(base, 18)
    },
    {
      ...eventBase,
      item_db_id: items[2].id,
      event_type: "missing_evidence_skipped",
      event_category: "validation",
      event_source: "backend",
      payload: { skipped_item: true },
      occurred_at: minutesAfter(base, 19)
    },
    {
      ...eventBase,
      item_db_id: items[2].id,
      event_type: "item_submitted",
      event_category: "student_response",
      event_source: "backend",
      payload: { finalized: true, skipped_item: true },
      occurred_at: minutesAfter(base, 20)
    },
    {
      ...eventBase,
      event_type: "page_hidden",
      event_category: "student_process",
      event_source: "frontend",
      visibility_duration_ms: 12_000,
      payload: { context: "demo fixture" },
      occurred_at: minutesAfter(base, 5)
    },
    {
      ...eventBase,
      event_type: "page_visible",
      event_category: "student_process",
      event_source: "frontend",
      visibility_duration_ms: 12_000,
      payload: { context: "demo fixture" },
      occurred_at: minutesAfter(base, 5.3)
    },
    {
      ...eventBase,
      event_type: "long_pause",
      event_category: "student_process",
      event_source: "frontend",
      pause_duration_ms: 45_000,
      payload: { threshold_ms: 30000 },
      occurred_at: minutesAfter(base, 16)
    },
    {
      ...eventBase,
      event_type: "inactivity_detected",
      event_category: "student_process",
      event_source: "frontend",
      pause_duration_ms: 65_000,
      payload: { threshold_ms: 60000 },
      occurred_at: minutesAfter(base, 17)
    },
    {
      ...eventBase,
      event_type: "navigation_event",
      event_category: "student_process",
      event_source: "frontend",
      payload: { action: "review_panel_opened" },
      occurred_at: minutesAfter(base, 12)
    },
    {
      ...eventBase,
      item_db_id: items[0].id,
      event_type: "invalid_help_request",
      event_category: "student_message_boundary",
      event_source: "backend",
      payload: { reason: "asked_for_answer" },
      occurred_at: minutesAfter(base, 4.5)
    },
    {
      ...eventBase,
      item_db_id: items[1].id,
      event_type: "prompt_injection_attempt",
      event_category: "student_message_boundary",
      event_source: "backend",
      payload: { matched_boundary: "ignore_previous_instructions" },
      occurred_at: minutesAfter(base, 10.5)
    },
    {
      ...eventBase,
      item_db_id: items[2].id,
      event_type: "procedural_clarification_request",
      event_category: "student_message_boundary",
      event_source: "backend",
      payload: { topic: "how_to_skip" },
      occurred_at: minutesAfter(base, 18.5)
    },
    {
      ...eventBase,
      item_db_id: items[2].id,
      event_type: "emotional_or_frustration_response",
      event_category: "student_message_boundary",
      event_source: "backend",
      payload: { affective_text_present: true },
      occurred_at: minutesAfter(base, 19.5)
    },
    {
      ...eventBase,
      item_db_id: items[2].id,
      event_type: "schema_validation_failed",
      event_category: "validation",
      event_source: "backend",
      payload: { missing_fields: ["answer", "reasoning", "confidence"] },
      occurred_at: minutesAfter(base, 17.5)
    }
  ];

  for (const event of events) {
    await prisma.processEvent.create({ data: event });
  }

  const responsePackage = await createResponsePackage({
    concept_unit_session_db_id: conceptUnitSession.id,
    package_type: "initial_concept_unit_response_package",
    created_at: minutesAfter(base, 21)
  });

  return {
    teacher,
    student,
    assessment,
    conceptUnit,
    items,
    session,
    conceptUnitSession,
    responsePackage
  };
}
