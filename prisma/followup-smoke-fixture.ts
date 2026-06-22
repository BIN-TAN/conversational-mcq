import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { generatePublicId } from "../src/lib/services/ids";
import { createResponsePackage } from "../src/lib/services/response-packages";
import { hashSecret } from "../src/lib/password";
import { runInitialStudentProfiling } from "../src/lib/agents/student-profiling/service";
import { runInitialFormativePlanning } from "../src/lib/agents/formative-planning/service";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

export const followupSmokeEnvKeys = [
  "LLM_PROVIDER",
  "LLM_LIVE_CALLS_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_MODEL_FOLLOWUP",
  "LLM_DAILY_STUDENT_CALL_LIMIT",
  "LLM_DAILY_STUDENT_TOKEN_LIMIT",
  "LLM_DAILY_CLASS_CALL_LIMIT",
  "LLM_DAILY_CLASS_TOKEN_LIMIT",
  "LLM_SESSION_CALL_LIMIT",
  "LLM_SESSION_TOKEN_LIMIT",
  "LLM_AGENT_CALL_LIMIT_PER_SESSION",
  "LLM_USAGE_TIMEZONE",
  "FOLLOWUP_CONTEXT_MAX_TURNS",
  "FOLLOWUP_MESSAGE_MAX_CHARS",
  "FOLLOWUP_CONTEXT_MAX_CHARS",
  "FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE",
  "DEVELOPMENT_ACTIVE_SESSION_CONTROLS_ENABLED",
  "ALLOW_MANUAL_REVIEW_STUDENT_STARTS"
] as const;

export type FollowupSmokeEnvKey = (typeof followupSmokeEnvKeys)[number];

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function minutesAfter(base: Date, minutes: number) {
  return new Date(base.getTime() + minutes * 60_000);
}

export function setFollowupSmokeEnv(
  values: Partial<Record<FollowupSmokeEnvKey, string | undefined>>
) {
  for (const key of followupSmokeEnvKeys) {
    if (values[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  }
}

export function assertNoForbiddenSerializedFields(value: unknown, label: string) {
  const serialized = JSON.stringify(value).toLowerCase();
  const forbidden = [
    "password_hash",
    "access_code_hash",
    "session_cookie",
    "authorization_header",
    "api_key",
    "database_url",
    "session_secret",
    "auth_token",
    "cookie",
    "agent_call_id",
    "summative",
    "_db_id",
    "\"id\""
  ];

  for (const field of forbidden) {
    assert(!serialized.includes(field), `${label} leaked ${field}.`);
  }
}

export function assertNoStudentProfileOrPlanningLabels(value: unknown, label: string) {
  const serialized = JSON.stringify(value).toLowerCase();
  const forbidden = [
    "ability_profile",
    "engagement_profile",
    "integrated_diagnostic_profile",
    "formative_value",
    "confidence_alignment",
    "independence_interpretability",
    "evidence_sufficiency",
    "correct_option",
    "correctness",
    "distractor_rationales"
  ];

  for (const field of forbidden) {
    assert(!serialized.includes(field), `${label} exposed student-hidden field ${field}.`);
  }
}

export async function cleanupFollowupSmoke(prisma: PrismaClient, prefix: string) {
  const assessments = await prisma.assessment.findMany({
    where: { title: { startsWith: prefix } },
    select: { id: true }
  });
  const assessmentIds = assessments.map((assessment) => assessment.id);

  if (assessmentIds.length > 0) {
    const sessions = await prisma.assessmentSession.findMany({
      where: { assessment_db_id: { in: assessmentIds } },
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
    await prisma.workflowOverride.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    await prisma.workflowJob.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    await prisma.studentActionIdempotencyKey.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    await prisma.conceptProgressionRecord.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    await prisma.conversationTurn.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    await prisma.processEvent.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    await prisma.agentCall.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    await prisma.followupUpdateCycle.deleteMany({
      where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
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
      where: { concept_unit: { assessment_db_id: { in: assessmentIds } } }
    });
    await prisma.conceptUnit.deleteMany({
      where: { assessment_db_id: { in: assessmentIds } }
    });
    await prisma.assessment.deleteMany({
      where: { id: { in: assessmentIds } }
    });
  }

  await prisma.user.deleteMany({
    where: { user_id: { startsWith: prefix } }
  });
}

function itemSeed(itemOrder: number) {
  return {
    item_order: itemOrder,
    item_stem: `Follow-up smoke item ${itemOrder}`,
    options: [
      { label: "A", text: "Best-supported answer" },
      { label: "B", text: "Partial distractor" },
      { label: "C", text: "Misconception distractor" }
    ],
    correct_option: "A",
    distractor_rationales: {
      B: "B reflects partial understanding.",
      C: "C reflects a plausible misconception."
    },
    expected_reasoning_patterns: ["Connects the option to concept evidence."],
    possible_misconception_indicators: ["Selects C with reversed reasoning."]
  };
}

export async function createFollowupSmokeFixture(
  prisma: PrismaClient,
  input: {
    prefix: string;
    suffix: string;
    withProfile?: boolean;
    withPlanning?: boolean;
  }
) {
  const base = new Date("2026-06-21T17:00:00.000Z");
  const [teacherPasswordHash, studentAccessCodeHash] = await Promise.all([
    hashSecret(`${input.prefix}_teacher_password`),
    hashSecret(`${input.prefix}_student_access_code`)
  ]);
  const teacher = await prisma.user.create({
    data: {
      user_id: `${input.prefix}_${input.suffix}_teacher`,
      user_id_normalized: normalizeUserId(`${input.prefix}_${input.suffix}_teacher`),
      role: "teacher_researcher",
      password_hash: teacherPasswordHash
    }
  });
  const student = await prisma.user.create({
    data: {
      user_id: `${input.prefix}_${input.suffix}_student`,
      user_id_normalized: normalizeUserId(`${input.prefix}_${input.suffix}_student`),
      role: "student",
      access_code_hash: studentAccessCodeHash
    }
  });
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: generatePublicId("assessment"),
      title: `${input.prefix} ${input.suffix}`,
      description: "Temporary Phase 6D1 follow-up smoke fixture.",
      status: "published",
      created_by_user_db_id: teacher.id
    }
  });
  const conceptUnit = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: generatePublicId("concept_unit"),
      assessment_db_id: assessment.id,
      title: `Follow-up smoke concept ${input.suffix}`,
      learning_objective: "Verify first-round Follow-up Agent integration.",
      related_concept_description: "Temporary concept for follow-up smoke testing.",
      administration_rules: { no_feedback_during_initial_administration: true },
      order_index: 1,
      status: "published",
      version: 1
    }
  });
  const items = [];

  for (const order of [1, 2, 3]) {
    const seed = itemSeed(order);
    items.push(
      await prisma.item.create({
        data: {
          item_public_id: generatePublicId("item"),
          concept_unit_db_id: conceptUnit.id,
          item_order: seed.item_order,
          item_stem: seed.item_stem,
          options: seed.options,
          correct_option: seed.correct_option,
          distractor_rationales: seed.distractor_rationales,
          expected_reasoning_patterns: seed.expected_reasoning_patterns,
          possible_misconception_indicators: seed.possible_misconception_indicators,
          administration_rules: { no_feedback_during_initial_administration: true },
          included_in_published_set: true,
          status: "published",
          version: 1
        }
      })
    );
  }

  const session = await prisma.assessmentSession.create({
    data: {
      session_public_id: generatePublicId("session"),
      user_db_id: student.id,
      assessment_db_id: assessment.id,
      attempt_number: 1,
      status: "active",
      current_phase: "profiling_pending",
      current_concept_unit_db_id: conceptUnit.id,
      started_at: base,
      last_activity_at: minutesAfter(base, 20)
    }
  });
  const conceptUnitSession = await prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_db_id: conceptUnit.id,
      status: "initial_completed",
      initial_started_at: minutesAfter(base, 1),
      initial_completed_at: minutesAfter(base, 19),
      followup_status: "not_started",
      followup_round_count: 0
    }
  });
  const snapshots = items.map((item) => ({
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
        correct_option_snapshot: "A",
        correctness: "correct",
        reasoning_text: "A matches the evidence in the prompt.",
        confidence_rating: "high",
        item_response_time_ms: 90_000,
        item_started_at: minutesAfter(base, 2),
        item_submitted_at: minutesAfter(base, 5),
        item_version_snapshot: 1,
        item_snapshot: snapshots[0],
        client_submission_id: `${input.suffix}_item_1`
      },
      {
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[1].id,
        selected_option: "B",
        correct_option_snapshot: "A",
        correctness: "incorrect",
        reasoning_text: "B sounded partly related, but I am not sure.",
        confidence_rating: "medium",
        item_response_time_ms: 120_000,
        item_started_at: minutesAfter(base, 6),
        item_submitted_at: minutesAfter(base, 11),
        revision_count: 1,
        item_version_snapshot: 1,
        item_snapshot: snapshots[1],
        client_submission_id: `${input.suffix}_item_2`
      },
      {
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[2].id,
        selected_option: null,
        correct_option_snapshot: "A",
        correctness: "unanswered",
        reasoning_text: null,
        confidence_rating: null,
        item_response_time_ms: 60_000,
        item_started_at: minutesAfter(base, 12),
        item_submitted_at: minutesAfter(base, 18),
        skipped_item: true,
        skipped_reasoning: true,
        skipped_confidence: true,
        missing_evidence_repair_offered: true,
        item_version_snapshot: 1,
        item_snapshot: snapshots[2],
        client_submission_id: `${input.suffix}_item_3`
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
        actor_type: "student",
        message_text: "I choose A because it matches the evidence.",
        structured_payload: { selected_option: "A", confidence_rating: "high" },
        created_at: minutesAfter(base, 4)
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[1].id,
        phase: "initial_item_administration",
        actor_type: "student",
        message_text: "I think B is related, but I am uncertain.",
        structured_payload: { selected_option: "B", confidence_rating: "medium" },
        created_at: minutesAfter(base, 10)
      }
    ]
  });
  await prisma.processEvent.createMany({
    data: [
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[1].id,
        event_type: "reasoning_revised",
        event_category: "student_response",
        event_source: "backend",
        payload: { revision_count: 1 },
        occurred_at: minutesAfter(base, 9)
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[2].id,
        event_type: "long_pause",
        event_category: "student_process",
        event_source: "frontend",
        pause_duration_ms: 45_000,
        payload: { threshold_ms: 30_000 },
        occurred_at: minutesAfter(base, 13)
      }
    ]
  });

  const responsePackage = await createResponsePackage({
    concept_unit_session_db_id: conceptUnitSession.id,
    package_type: "initial_concept_unit_response_package",
    created_at: minutesAfter(base, 19)
  });

  if (input.withProfile !== false) {
    const profiling = await runInitialStudentProfiling({
      concept_unit_session_db_id: conceptUnitSession.id,
      invocation_reason: "phase6d1_fixture_profile"
    });

    assert(profiling.status === "profile_created", "Fixture profile was not created.");
  }

  if (input.withPlanning !== false && input.withProfile !== false) {
    const planning = await runInitialFormativePlanning({
      concept_unit_session_db_id: conceptUnitSession.id,
      invocation_reason: "phase6d1_fixture_planning"
    });

    assert(planning.status === "decision_created", "Fixture formative decision was not created.");
  }

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

export async function createSyntheticOpenAiCall(
  prisma: PrismaClient,
  prefix: string,
  sessionId: string
) {
  await prisma.agentCall.create({
    data: {
      assessment_session_db_id: sessionId,
      agent_name: "followup_agent",
      agent_version: "followup-smoke",
      model_name: "synthetic-followup-smoke-model",
      provider: "openai",
      client_request_id: `${prefix}_client_${randomUUID()}`,
      agent_invocation_key: `${prefix}_usage_${randomUUID()}`,
      prompt_hash: "followup-smoke-prompt-hash",
      prompt_version: "followup-smoke-prompt",
      schema_version: "followup-smoke-schema",
      input_payload: { synthetic: true },
      raw_output: { synthetic: true },
      output_payload: { synthetic: true },
      output_validated: true,
      retry_count: 0,
      call_status: "succeeded",
      live_call_allowed: true,
      input_tokens: 5,
      output_tokens: 5,
      total_tokens: 10,
      started_at: new Date(),
      completed_at: new Date()
    }
  });
}
