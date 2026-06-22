import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { createResponsePackage } from "../src/lib/services/response-packages";
import { deleteExportFile } from "../src/lib/services/master-export/storage";
import { ensureTeacherReviewDemoUsers } from "./demo-teacher-review-fixture";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

export const dataExportAssessmentPublicId = "assessment_demo_data_export";
export const dataExportConceptUnitPublicId = "concept_demo_data_export_initial";
export const dataExportSecondConceptUnitPublicId = "concept_demo_data_export_transfer";
export const dataExportItemPublicIds = [
  "item_demo_data_export_1",
  "item_demo_data_export_2",
  "item_demo_data_export_3"
] as const;
export const dataExportSecondConceptItemPublicIds = [
  "item_demo_data_export_transfer_1",
  "item_demo_data_export_transfer_2",
  "item_demo_data_export_transfer_3"
] as const;
export const dataExportCompleteSessionPublicId = "session_demo_data_export_complete";
export const dataExportIncompleteSessionPublicId = "session_demo_data_export_incomplete";
export const dataExportSkippedSessionPublicId = "session_demo_data_export_skipped";
export const dataExportInactiveSessionPublicId = "session_demo_data_export_inactive_placeholder";
export const dataExportSecondStudentUserId = "student_export_demo";
export const dataExportSecondStudentAccessCode = "student_export_demo_access_code";
export const dataExportInactiveStudentUserId = "student_export_inactive_demo";
export const dataExportInactiveStudentAccessCode = "student_export_inactive_access_code";
export const dataExportOutcomeNames = ["final_exam", "final_course_score"] as const;

function minutesAfter(base: Date, minutes: number) {
  return new Date(base.getTime() + minutes * 60_000);
}

function demoOptions() {
  return [
    { label: "A", text: "The evidence supports the target relationship." },
    { label: "B", text: "The relationship is reversed." },
    { label: "C", text: "The response uses an unrelated detail." }
  ];
}

function itemSnapshot(item: {
  item_public_id: string;
  item_order: number;
  item_stem: string;
  options: Prisma.JsonValue;
  correct_option: string;
  version: number;
}) {
  return {
    item_public_id: item.item_public_id,
    item_order: item.item_order,
    item_stem: item.item_stem,
    options: item.options,
    correct_option: item.correct_option,
    version: item.version
  };
}

async function ensureDataExportUsers(prisma: PrismaClient) {
  const { teacher, student } = await ensureTeacherReviewDemoUsers(prisma);
  const accessCodeHash = await hashSecret(dataExportSecondStudentAccessCode);
  const inactiveAccessCodeHash = await hashSecret(dataExportInactiveStudentAccessCode);
  const secondStudent = await prisma.user.upsert({
    where: { user_id: dataExportSecondStudentUserId },
    update: {
      role: "student",
      user_id_normalized: normalizeUserId(dataExportSecondStudentUserId),
      account_status: "active",
      password_hash: null,
      access_code_hash: accessCodeHash
    },
    create: {
      user_id: dataExportSecondStudentUserId,
      user_id_normalized: normalizeUserId(dataExportSecondStudentUserId),
      role: "student",
      access_code_hash: accessCodeHash
    }
  });
  const inactiveStudent = await prisma.user.upsert({
    where: { user_id: dataExportInactiveStudentUserId },
    update: {
      role: "student",
      user_id_normalized: normalizeUserId(dataExportInactiveStudentUserId),
      account_status: "inactive",
      deactivated_at: new Date("2026-06-19T14:00:00.000Z"),
      password_hash: null,
      access_code_hash: inactiveAccessCodeHash
    },
    create: {
      user_id: dataExportInactiveStudentUserId,
      user_id_normalized: normalizeUserId(dataExportInactiveStudentUserId),
      display_name: "Inactive Export Demo",
      role: "student",
      account_status: "inactive",
      deactivated_at: new Date("2026-06-19T14:00:00.000Z"),
      access_code_hash: inactiveAccessCodeHash
    }
  });

  return { teacher, student, secondStudent, inactiveStudent };
}

async function cleanupAssessmentRecords(prisma: PrismaClient) {
  const assessment = await prisma.assessment.findUnique({
    where: { assessment_public_id: dataExportAssessmentPublicId },
    select: { id: true }
  });

  if (!assessment) {
    return false;
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
  await prisma.followupUpdateCycle.updateMany({
    where: { assessment_session_db_id: { in: sessionIds } },
    data: { progression_record_db_id: null }
  });
  await prisma.conceptProgressionRecord.updateMany({
    where: { assessment_session_db_id: { in: sessionIds } },
    data: { final_update_cycle_db_id: null }
  });
  await prisma.conceptProgressionRecord.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.followupUpdateCycle.deleteMany({
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

  return true;
}

async function cleanupOutcomeAndExportRecords(prisma: PrismaClient) {
  const userIds = ["student_demo", dataExportSecondStudentUserId, dataExportInactiveStudentUserId];
  const jobs = await prisma.exportJob.findMany({
    select: { id: true, options: true, storage_key: true }
  });
  const fixtureJobs = jobs.filter((job) => {
    const options = job.options;

    return (
      options &&
      typeof options === "object" &&
      !Array.isArray(options) &&
      (options as Record<string, unknown>).assessment_public_id === dataExportAssessmentPublicId
    );
  });

  for (const job of fixtureJobs) {
    if (job.storage_key) {
      await deleteExportFile(job.storage_key).catch(() => undefined);
    }
  }

  await prisma.exportJob.deleteMany({
    where: { id: { in: fixtureJobs.map((job) => job.id) } }
  });
  await prisma.summativeOutcome.deleteMany({
    where: {
      user_id_snapshot: { in: userIds },
      outcome_name: { in: [...dataExportOutcomeNames] }
    }
  });
  await prisma.summativeOutcomeImportBatch.deleteMany({
    where: {
      OR: [
        { source_file_name: { startsWith: "data-export-demo" } },
        { source_file_name: { startsWith: "summative-import-smoke" } }
      ]
    }
  });
}

async function createFixtureAssessment(prisma: PrismaClient, teacherId: string) {
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: dataExportAssessmentPublicId,
      title: "Development Demo: Data Export",
      description: "Development-only fixture for summative outcomes and master CSV export.",
      status: "published",
      created_by_user_db_id: teacherId
    }
  });
  const conceptUnit = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: dataExportConceptUnitPublicId,
      assessment_db_id: assessment.id,
      title: "Data export demo concept",
      learning_objective: "Provide mixed item evidence for CSV export verification.",
      related_concept_description:
        "Fixture concept used to test complete, incomplete, and skipped evidence exports.",
      administration_rules: { no_feedback_during_initial_administration: true },
      order_index: 1,
      status: "published",
      version: 1
    }
  });
  const secondConceptUnit = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: dataExportSecondConceptUnitPublicId,
      assessment_db_id: assessment.id,
      title: "Data export transfer concept",
      learning_objective: "Provide a second concept for progression and completion export verification.",
      related_concept_description:
        "Fixture concept used to test multi-concept row ordering and final completion fields.",
      administration_rules: { no_feedback_during_initial_administration: true },
      order_index: 2,
      status: "published",
      version: 2
    }
  });
  const stems = [
    "Which option best connects the observation to the target concept?",
    "Which claim is best supported by the graph described in the prompt?",
    "Which conclusion follows from the investigation record?"
  ];
  const items = [];
  const secondConceptItems = [];

  for (const itemOrder of [1, 2, 3]) {
    items.push(
      await prisma.item.create({
        data: {
          item_public_id: dataExportItemPublicIds[itemOrder - 1],
          concept_unit_db_id: conceptUnit.id,
          item_order: itemOrder,
          item_stem: stems[itemOrder - 1],
          options: demoOptions(),
          correct_option: "A",
          distractor_rationales: {
            B: "This reverses the relationship.",
            C: "This uses an unrelated cue."
          },
          expected_reasoning_patterns: ["Connects the selected option to provided evidence."],
          possible_misconception_indicators: ["Uses a reversed relationship or unrelated cue."],
          administration_rules: { no_feedback_during_initial_administration: true },
          included_in_published_set: true,
          status: "published",
          version: 1
        }
      })
    );
    secondConceptItems.push(
      await prisma.item.create({
        data: {
          item_public_id: dataExportSecondConceptItemPublicIds[itemOrder - 1],
          concept_unit_db_id: secondConceptUnit.id,
          item_order: itemOrder,
          item_stem: `Transfer item ${itemOrder}: Which response best applies the concept in a new case?`,
          options: demoOptions(),
          correct_option: "A",
          distractor_rationales: {
            B: "This applies the relationship in the opposite direction.",
            C: "This relies on an unrelated feature."
          },
          expected_reasoning_patterns: ["Applies the concept to a transfer case."],
          possible_misconception_indicators: ["Transfers a surface feature instead of the relationship."],
          administration_rules: { no_feedback_during_initial_administration: true },
          included_in_published_set: true,
          status: "published",
          version: 2
        }
      })
    );
  }

  return { assessment, conceptUnit, secondConceptUnit, items, secondConceptItems };
}

async function addInitialPackageSession(input: {
  prisma: PrismaClient;
  userDbId: string;
  assessmentDbId: string;
  conceptUnitDbId: string;
  items: Array<{
    id: string;
    item_public_id: string;
    item_order: number;
    item_stem: string;
    options: Prisma.JsonValue;
    correct_option: string;
    version: number;
  }>;
  sessionPublicId: string;
  attemptNumber: number;
  status: "active" | "completed";
  currentPhase: "profiling_pending" | "session_completed";
  base: Date;
  skipped: boolean;
  workflowMode?: "manual_review" | "automatic";
}) {
  const session = await input.prisma.assessmentSession.create({
    data: {
      session_public_id: input.sessionPublicId,
      user_db_id: input.userDbId,
      assessment_db_id: input.assessmentDbId,
      attempt_number: input.attemptNumber,
      status: input.status,
      current_phase: input.currentPhase,
      workflow_mode_snapshot: input.workflowMode ?? "automatic",
      current_concept_unit_db_id: input.conceptUnitDbId,
      started_at: input.base,
      last_activity_at: minutesAfter(input.base, 20),
      completed_at: input.status === "completed" ? minutesAfter(input.base, 24) : null
    }
  });
  const conceptUnitSession = await input.prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_db_id: input.conceptUnitDbId,
      status: input.status === "completed" ? "completed" : "initial_completed",
      initial_started_at: minutesAfter(input.base, 1),
      initial_completed_at: minutesAfter(input.base, 20),
      followup_status: "not_started",
      followup_round_count: 0
    }
  });

  const responses = input.items.map((item, index) => {
    const skipped = input.skipped && index === 2;
    const selected = skipped ? null : index === 1 ? "B" : "A";

    return {
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: item.id,
      selected_option: selected,
      correct_option_snapshot: item.correct_option,
      correctness: skipped ? "unanswered" : selected === item.correct_option ? "correct" : "incorrect",
      reasoning_text: skipped
        ? null
        : index === 0
          ? "=This formula-like reasoning is student text and should be protected in spreadsheets."
          : "I used the evidence in the prompt, but I may have reversed the relationship.",
      confidence_rating: skipped ? null : index === 0 ? "high" : "medium",
      item_response_time_ms: index === 0 ? 78_000 : index === 1 ? 125_000 : 64_000,
      item_started_at: minutesAfter(input.base, 2 + index * 5),
      item_submitted_at: minutesAfter(input.base, 5 + index * 5),
      skipped_reasoning: skipped,
      skipped_confidence: skipped,
      skipped_item: skipped,
      revision_count: index === 1 ? 1 : 0,
      missing_evidence_repair_offered: skipped,
      item_version_snapshot: item.version,
      item_snapshot: itemSnapshot(item),
      client_submission_id: `${input.sessionPublicId}_item_${index + 1}`
    } satisfies Prisma.ItemResponseUncheckedCreateInput;
  });

  await input.prisma.itemResponse.createMany({ data: responses });
  await input.prisma.conversationTurn.createMany({
    data: [
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: input.items[0].id,
        phase: "initial_item_administration",
        actor_type: "orchestrator",
        message_text: "Please choose an option for item 1.",
        structured_payload: { item_public_id: input.items[0].item_public_id },
        created_at: minutesAfter(input.base, 2)
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: input.items[0].id,
        phase: "initial_item_administration",
        actor_type: "student",
        message_text:
          "=I choose A because the observation supports that relationship.",
        structured_payload: { selected_option: "A", confidence_rating: "high" },
        created_at: minutesAfter(input.base, 4)
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: input.items[2].id,
        phase: input.skipped ? "missing_evidence_repair" : "initial_item_administration",
        actor_type: "student",
        message_text: input.skipped ? "I want to skip this item." : "I finished the last item.",
        structured_payload: input.skipped ? { skipped_item: true } : { finalized: true },
        created_at: minutesAfter(input.base, 18)
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
      item_db_id: input.items[0].id,
      event_type: "item_presented",
      event_category: "student_response",
      event_source: "backend",
      payload: { item_public_id: input.items[0].item_public_id },
      occurred_at: minutesAfter(input.base, 2)
    },
    {
      ...eventBase,
      item_db_id: input.items[0].id,
      event_type: "option_selected",
      event_category: "student_response",
      event_source: "backend",
      payload: { selected_option: "A" },
      occurred_at: minutesAfter(input.base, 3)
    },
    {
      ...eventBase,
      item_db_id: input.items[1].id,
      event_type: "option_selected",
      event_category: "student_response",
      event_source: "backend",
      payload: { selected_option: "B", revision: true, revision_count: 1 },
      occurred_at: minutesAfter(input.base, 9)
    },
    {
      ...eventBase,
      item_db_id: input.items[1].id,
      event_type: "reasoning_revised",
      event_category: "student_response",
      event_source: "backend",
      payload: { revision_count: 1 },
      occurred_at: minutesAfter(input.base, 10)
    },
    {
      ...eventBase,
      event_type: "page_hidden",
      event_category: "student_process",
      event_source: "frontend",
      visibility_duration_ms: 9000,
      payload: { fixture: "data_export" },
      occurred_at: minutesAfter(input.base, 7)
    },
    {
      ...eventBase,
      event_type: "page_visible",
      event_category: "student_process",
      event_source: "frontend",
      visibility_duration_ms: 9000,
      payload: { fixture: "data_export" },
      occurred_at: minutesAfter(input.base, 7.2)
    },
    {
      ...eventBase,
      event_type: "long_pause",
      event_category: "student_process",
      event_source: "frontend",
      pause_duration_ms: 42_000,
      payload: { threshold_ms: 30000 },
      occurred_at: minutesAfter(input.base, 13)
    }
  ];

  if (input.skipped) {
    events.push({
      ...eventBase,
      item_db_id: input.items[2].id,
      event_type: "schema_validation_failed",
      event_category: "validation",
      event_source: "backend",
      payload: { missing_fields: ["answer", "reasoning", "confidence"] },
      occurred_at: minutesAfter(input.base, 17)
    });
  }

  for (const event of events) {
    await input.prisma.processEvent.create({ data: event });
  }

  await createResponsePackage({
    concept_unit_session_db_id: conceptUnitSession.id,
    package_type: "initial_concept_unit_response_package"
  });

  return { session, conceptUnitSession };
}

async function createFixtureAgentCall(input: {
  prisma: PrismaClient;
  sessionId: string;
  conceptUnitSessionId?: string;
  followupRoundId?: string;
  agentName:
    | "student_profiling_agent"
    | "formative_value_and_planning_agent"
    | "followup_agent";
  suffix: string;
  callStatus?: "succeeded" | "failed" | "invalid_output" | "needs_review";
  outputValidated?: boolean;
  retryCount?: number;
  blockedReason?: string | null;
}) {
  const startedAt = new Date("2026-06-19T15:31:00.000Z");

  return input.prisma.agentCall.create({
    data: {
      assessment_session_db_id: input.sessionId,
      concept_unit_session_db_id: input.conceptUnitSessionId,
      followup_round_db_id: input.followupRoundId,
      agent_name: input.agentName,
      agent_version: "phase7b-export-fixture",
      model_name: "mock-phase7b-export-model",
      provider: "mock",
      client_request_id: `phase7b_export_${input.suffix}_client`,
      agent_invocation_key: `phase7b_export_${input.suffix}`,
      prompt_hash: `phase7b_prompt_hash_${input.suffix}`,
      prompt_version: "phase7b-export-fixture-prompt",
      schema_version: "phase7b-export-fixture-schema",
      input_payload: { fixture: "data_export", suffix: input.suffix },
      raw_output: { output_status: input.outputValidated === false ? "needs_review" : "ok" },
      output_payload: { output_status: input.outputValidated === false ? "needs_review" : "ok" },
      output_validated: input.outputValidated ?? true,
      validation_error: input.outputValidated === false ? "Fixture validation failure." : null,
      retry_count: input.retryCount ?? 0,
      call_status: input.callStatus ?? "succeeded",
      blocked_reason: input.blockedReason ?? null,
      error_category: input.callStatus === "failed" ? "fixture_failure" : null,
      live_call_allowed: false,
      input_tokens: 40,
      output_tokens: 60,
      total_tokens: 100,
      token_usage: { input_tokens: 40, output_tokens: 60, total_tokens: 100 },
      estimated_cost: "0.000000",
      started_at: startedAt,
      completed_at: minutesAfter(startedAt, 1)
    }
  });
}

async function attachProfileDecisionFollowupFixture(input: {
  prisma: PrismaClient;
  sessionId: string;
  conceptUnitSessionId: string;
  base: Date;
}) {
  const initialProfileCall = await createFixtureAgentCall({
    prisma: input.prisma,
    sessionId: input.sessionId,
    conceptUnitSessionId: input.conceptUnitSessionId,
    agentName: "student_profiling_agent",
    suffix: "initial_profile"
  });
  const initialProfile = await input.prisma.studentProfile.create({
    data: {
      concept_unit_session_db_id: input.conceptUnitSessionId,
      profile_type: "initial",
      ability_profile: "fragile_correct_understanding",
      ability_pattern_flags: ["correct_with_partial_reasoning"],
      engagement_profile: "adequate_engagement",
      engagement_pattern_flags: ["completed_initial_item_set"],
      integrated_diagnostic_profile: "correct_but_fragile_understanding",
      integrated_profile_confidence: "medium",
      integrated_profile_rationale:
        "Initial responses were mostly correct, but one revision and reasoning uncertainty suggested fragility.",
      evidence_sufficiency: "adequate",
      confidence_alignment: "mixed",
      independence_interpretability: "independent_understanding_uncertain",
      misconception_indicators: ["possible_reversed_relationship"],
      item_level_evidence: [{ item_public_id: dataExportItemPublicIds[1], correctness: "incorrect" }],
      reasoning_quality_summary: "Reasoning connected evidence to claims but included one reversed relationship.",
      engagement_summary: "Student completed the initial set with one revision and a long pause.",
      process_interpretation_cautions: ["Process data are contextual and not misconduct evidence."],
      profile_confidence: "medium",
      rationale: "Correctness was treated as evidence alongside reasoning, confidence, and process context.",
      recommended_next_evidence: ["Ask for transfer reasoning using the same relationship."],
      based_on_agent_call_db_id: initialProfileCall.id,
      created_at: minutesAfter(input.base, 31)
    }
  });
  const initialDecisionCall = await createFixtureAgentCall({
    prisma: input.prisma,
    sessionId: input.sessionId,
    conceptUnitSessionId: input.conceptUnitSessionId,
    agentName: "formative_value_and_planning_agent",
    suffix: "initial_planning"
  });
  const initialDecision = await input.prisma.formativeDecision.create({
    data: {
      concept_unit_session_db_id: input.conceptUnitSessionId,
      student_profile_db_id: initialProfile.id,
      formative_value: "reasoning_refinement",
      formative_action_plan: "Ask the student to explain the relationship using a new example.",
      target_evidence: ["transfer_reasoning", "confidence_calibration"],
      success_criteria: ["Uses the relationship direction correctly."],
      followup_prompt_constraints: { no_correctness_reveal: true, conversational: true },
      profile_update_triggers: ["transfer_application", "reasoning_revision"],
      rationale: "The saved profile indicated mostly correct but fragile reasoning.",
      mapping_followed: true,
      mapping_deviation_reason: null,
      based_on_agent_call_db_id: initialDecisionCall.id,
      created_at: minutesAfter(input.base, 32)
    }
  });
  const roundOne = await input.prisma.followupRound.create({
    data: {
      concept_unit_session_db_id: input.conceptUnitSessionId,
      round_index: 1,
      formative_decision_db_id: initialDecision.id,
      status: "completed",
      evidence_trigger_type: "transfer_application",
      started_at: minutesAfter(input.base, 33),
      completed_at: minutesAfter(input.base, 38),
      created_at: minutesAfter(input.base, 33)
    }
  });

  await input.prisma.conversationTurn.createMany({
    data: [
      {
        assessment_session_db_id: input.sessionId,
        concept_unit_session_db_id: input.conceptUnitSessionId,
        followup_round_db_id: roundOne.id,
        phase: "followup_active",
        actor_type: "agent",
        agent_name: "followup_agent",
        message_text: "Try applying the same relationship to this new case.",
        structured_payload: { fixture: "followup_round_one" },
        created_at: minutesAfter(input.base, 34)
      },
      {
        assessment_session_db_id: input.sessionId,
        concept_unit_session_db_id: input.conceptUnitSessionId,
        followup_round_db_id: roundOne.id,
        phase: "followup_active",
        actor_type: "student",
        message_text: "The direction matters; the evidence should increase with the cause in this case.",
        structured_payload: { substantive: true },
        created_at: minutesAfter(input.base, 36)
      }
    ]
  });
  const updatedProfileCall = await createFixtureAgentCall({
    prisma: input.prisma,
    sessionId: input.sessionId,
    conceptUnitSessionId: input.conceptUnitSessionId,
    followupRoundId: roundOne.id,
    agentName: "student_profiling_agent",
    suffix: "updated_profile"
  });
  const updatedPlanningCall = await createFixtureAgentCall({
    prisma: input.prisma,
    sessionId: input.sessionId,
    conceptUnitSessionId: input.conceptUnitSessionId,
    followupRoundId: roundOne.id,
    agentName: "formative_value_and_planning_agent",
    suffix: "updated_planning",
    retryCount: 1
  });
  const updatedProfile = await input.prisma.studentProfile.create({
    data: {
      concept_unit_session_db_id: input.conceptUnitSessionId,
      profile_type: "updated",
      ability_profile: "mostly_correct_understanding",
      ability_pattern_flags: ["improved_transfer_reasoning"],
      engagement_profile: "productive_engagement",
      engagement_pattern_flags: ["substantive_followup_response"],
      integrated_diagnostic_profile: "developing_understanding_with_productive_engagement",
      integrated_profile_confidence: "medium",
      integrated_profile_rationale:
        "Follow-up evidence showed improved transfer reasoning while still warranting cautious interpretation.",
      evidence_sufficiency: "strong",
      confidence_alignment: "well_calibrated",
      independence_interpretability: "independent_understanding_uncertain",
      misconception_indicators: [],
      item_level_evidence: [{ followup_round_index: 1, evidence: "transfer reasoning improved" }],
      reasoning_quality_summary: "Student explained the relationship direction more clearly in follow-up.",
      engagement_summary: "Student gave a substantive follow-up response.",
      process_interpretation_cautions: ["Independence is not confirmed by process data alone."],
      profile_confidence: "medium",
      rationale: "Active updated profile was created only after a successful update cycle.",
      recommended_next_evidence: ["Offer a choice to move to the next concept."],
      based_on_agent_call_db_id: updatedProfileCall.id,
      created_at: minutesAfter(input.base, 39)
    }
  });
  const updatedDecision = await input.prisma.formativeDecision.create({
    data: {
      concept_unit_session_db_id: input.conceptUnitSessionId,
      student_profile_db_id: updatedProfile.id,
      formative_value: "consolidation_or_transfer",
      formative_action_plan: "Invite the student to move on after confirming the unresolved evidence boundary.",
      target_evidence: ["student_move_on_choice"],
      success_criteria: ["Student explicitly chooses whether to continue or move on."],
      followup_prompt_constraints: { no_profile_labels_to_student: true },
      profile_update_triggers: ["move_on_request"],
      rationale: "Updated profile supported moving toward concept progression without claiming full independence.",
      mapping_followed: true,
      mapping_deviation_reason: null,
      based_on_agent_call_db_id: updatedPlanningCall.id,
      created_at: minutesAfter(input.base, 40)
    }
  });
  const roundTwo = await input.prisma.followupRound.create({
    data: {
      concept_unit_session_db_id: input.conceptUnitSessionId,
      round_index: 2,
      formative_decision_db_id: updatedDecision.id,
      status: "stopped",
      evidence_trigger_type: "move_on_request",
      started_at: minutesAfter(input.base, 41),
      completed_at: minutesAfter(input.base, 43),
      updated_student_profile_db_id: updatedProfile.id,
      created_at: minutesAfter(input.base, 41)
    }
  });
  await input.prisma.conversationTurn.createMany({
    data: [
      {
        assessment_session_db_id: input.sessionId,
        concept_unit_session_db_id: input.conceptUnitSessionId,
        followup_round_db_id: roundTwo.id,
        phase: "followup_active",
        actor_type: "agent",
        agent_name: "followup_agent",
        message_text: "You can continue with this concept or choose to move on.",
        structured_payload: { move_on_offer: true },
        created_at: minutesAfter(input.base, 42)
      },
      {
        assessment_session_db_id: input.sessionId,
        concept_unit_session_db_id: input.conceptUnitSessionId,
        followup_round_db_id: roundTwo.id,
        phase: "followup_active",
        actor_type: "student",
        message_text: "I'm ready to move on.",
        structured_payload: { student_choice: "next_concept" },
        created_at: minutesAfter(input.base, 43)
      }
    ]
  });
  await input.prisma.processEvent.createMany({
    data: [
      {
        assessment_session_db_id: input.sessionId,
        concept_unit_session_db_id: input.conceptUnitSessionId,
        event_type: "followup_evidence_trigger_candidate",
        event_category: "followup",
        event_source: "backend",
        payload: { trigger_type: "transfer_application" },
        occurred_at: minutesAfter(input.base, 37)
      },
      {
        assessment_session_db_id: input.sessionId,
        concept_unit_session_db_id: input.conceptUnitSessionId,
        event_type: "followup_update_triggered",
        event_category: "workflow",
        event_source: "backend",
        payload: { trigger_type: "transfer_application" },
        occurred_at: minutesAfter(input.base, 38)
      },
      {
        assessment_session_db_id: input.sessionId,
        concept_unit_session_db_id: input.conceptUnitSessionId,
        event_type: "move_on_offer",
        event_category: "followup",
        event_source: "agent",
        payload: { source: "fixture" },
        occurred_at: minutesAfter(input.base, 42)
      },
      {
        assessment_session_db_id: input.sessionId,
        concept_unit_session_db_id: input.conceptUnitSessionId,
        event_type: "concept_progression_requested",
        event_category: "workflow",
        event_source: "backend",
        payload: { student_choice: "next_concept" },
        occurred_at: minutesAfter(input.base, 43)
      }
    ]
  });
  const failedProfileCall = await createFixtureAgentCall({
    prisma: input.prisma,
    sessionId: input.sessionId,
    conceptUnitSessionId: input.conceptUnitSessionId,
    followupRoundId: roundTwo.id,
    agentName: "student_profiling_agent",
    suffix: "failed_update",
    callStatus: "failed",
    outputValidated: false,
    retryCount: 2
  });
  await input.prisma.followupUpdateCycle.create({
    data: {
      cycle_public_id: "cycle_demo_data_export_successful_update",
      assessment_session_db_id: input.sessionId,
      concept_unit_session_db_id: input.conceptUnitSessionId,
      source_followup_round_db_id: roundOne.id,
      source_student_profile_db_id: initialProfile.id,
      source_formative_decision_db_id: initialDecision.id,
      trigger_type: "transfer_application",
      trigger_details: { fixture: "successful_update" },
      status: "completed",
      final_update: false,
      create_next_round: true,
      stop_after_cycle: false,
      profile_agent_call_db_id: updatedProfileCall.id,
      planning_agent_call_db_id: updatedPlanningCall.id,
      completed_at: minutesAfter(input.base, 40),
      created_at: minutesAfter(input.base, 38)
    }
  });
  await input.prisma.followupUpdateCycle.create({
    data: {
      cycle_public_id: "cycle_demo_data_export_failed_update",
      assessment_session_db_id: input.sessionId,
      concept_unit_session_db_id: input.conceptUnitSessionId,
      source_followup_round_db_id: roundTwo.id,
      source_student_profile_db_id: updatedProfile.id,
      source_formative_decision_db_id: updatedDecision.id,
      trigger_type: "move_on_request",
      trigger_details: { fixture: "failed_final_update" },
      status: "failed",
      final_update: true,
      create_next_round: false,
      stop_after_cycle: true,
      profile_agent_call_db_id: failedProfileCall.id,
      staged_profile_output: { ability_profile: "robust_transfer_ready_understanding" },
      failure_stage: "profiling",
      failure_category: "fixture_failure",
      failure_message: "Fixture failed cycle should not activate staged profile output.",
      created_at: minutesAfter(input.base, 44)
    }
  });
  await input.prisma.conceptUnitSession.update({
    where: { id: input.conceptUnitSessionId },
    data: {
      latest_student_profile_db_id: updatedProfile.id,
      latest_formative_decision_db_id: updatedDecision.id,
      followup_status: "completed",
      followup_round_count: 2,
      followup_started_at: minutesAfter(input.base, 33),
      followup_completed_at: minutesAfter(input.base, 43),
      status: "completed"
    }
  });

  return { initialProfile, updatedProfile, initialDecision, updatedDecision, roundOne, roundTwo };
}

async function addSecondConceptToSession(input: {
  prisma: PrismaClient;
  sessionId: string;
  conceptUnitDbId: string;
  items: Array<{
    id: string;
    item_public_id: string;
    item_order: number;
    item_stem: string;
    options: Prisma.JsonValue;
    correct_option: string;
    version: number;
  }>;
  base: Date;
}) {
  const conceptUnitSession = await input.prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: input.sessionId,
      concept_unit_db_id: input.conceptUnitDbId,
      status: "completed",
      initial_started_at: minutesAfter(input.base, 50),
      initial_completed_at: minutesAfter(input.base, 65),
      followup_status: "not_started",
      followup_round_count: 0
    }
  });
  await input.prisma.itemResponse.createMany({
    data: input.items.map((item, index) => ({
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: item.id,
      selected_option: "A",
      correct_option_snapshot: item.correct_option,
      correctness: "correct",
      reasoning_text: `Transfer reasoning ${index + 1} applies the relationship to a new case.`,
      confidence_rating: "medium",
      item_response_time_ms: 70_000 + index * 10_000,
      item_started_at: minutesAfter(input.base, 52 + index * 4),
      item_submitted_at: minutesAfter(input.base, 54 + index * 4),
      skipped_reasoning: false,
      skipped_confidence: false,
      skipped_item: false,
      revision_count: 0,
      missing_evidence_repair_offered: false,
      item_version_snapshot: item.version,
      item_snapshot: itemSnapshot(item),
      client_submission_id: `${dataExportCompleteSessionPublicId}_transfer_item_${index + 1}`
    }))
  });
  await createResponsePackage({
    concept_unit_session_db_id: conceptUnitSession.id,
    package_type: "initial_concept_unit_response_package"
  });

  return conceptUnitSession;
}

async function attachProgressionAndWorkflowFixture(input: {
  prisma: PrismaClient;
  teacherId: string;
  sessionId: string;
  sourceConceptUnitSessionId: string;
  finalConceptUnitSessionId: string;
  destinationConceptUnitId: string;
  sourceProfileId: string;
  sourceDecisionId: string;
  base: Date;
}) {
  await input.prisma.conceptProgressionRecord.create({
    data: {
      progression_public_id: "progression_demo_data_export_next_concept",
      assessment_session_db_id: input.sessionId,
      source_concept_unit_session_db_id: input.sourceConceptUnitSessionId,
      destination_concept_unit_db_id: input.destinationConceptUnitId,
      source_student_profile_db_id: input.sourceProfileId,
      source_formative_decision_db_id: input.sourceDecisionId,
      progression_type: "next_concept",
      trigger_type: "student_move_on_request",
      student_choice: "next_concept",
      status: "completed",
      resolution_status: "resolved",
      moved_on_with_unresolved_evidence: false,
      completed_with_unresolved_evidence: false,
      idempotency_key: "progression_demo_data_export_next_concept_key",
      requested_at: minutesAfter(input.base, 43),
      confirmed_at: minutesAfter(input.base, 44),
      completed_at: minutesAfter(input.base, 45)
    }
  });
  await input.prisma.conceptProgressionRecord.create({
    data: {
      progression_public_id: "progression_demo_data_export_completion",
      assessment_session_db_id: input.sessionId,
      source_concept_unit_session_db_id: input.finalConceptUnitSessionId,
      source_student_profile_db_id: input.sourceProfileId,
      source_formative_decision_db_id: input.sourceDecisionId,
      progression_type: "complete_assessment",
      trigger_type: "student_explicit_button",
      student_choice: "complete_assessment",
      status: "completed",
      resolution_status: "unresolved",
      moved_on_with_unresolved_evidence: false,
      completed_with_unresolved_evidence: true,
      idempotency_key: "progression_demo_data_export_completion_key",
      requested_at: minutesAfter(input.base, 66),
      confirmed_at: minutesAfter(input.base, 67),
      completed_at: minutesAfter(input.base, 68)
    }
  });
  await input.prisma.processEvent.create({
    data: {
      assessment_session_db_id: input.sessionId,
      concept_unit_session_db_id: input.finalConceptUnitSessionId,
      event_type: "concept_progression_unresolved_confirmed",
      event_category: "workflow",
      event_source: "backend",
      payload: { completion_with_unresolved_evidence: true },
      occurred_at: minutesAfter(input.base, 67)
    }
  });
  await input.prisma.workflowJob.createMany({
    data: [
      {
        job_type: "run_initial_profiling",
        status: "completed",
        assessment_session_db_id: input.sessionId,
        concept_unit_session_db_id: input.sourceConceptUnitSessionId,
        idempotency_key: "workflow_demo_data_export_profile",
        payload: { fixture: "profile" },
        attempt_count: 1,
        max_attempts: 3,
        run_after: minutesAfter(input.base, 30),
        completed_at: minutesAfter(input.base, 31)
      },
      {
        job_type: "run_followup_profile_update",
        status: "failed",
        assessment_session_db_id: input.sessionId,
        concept_unit_session_db_id: input.sourceConceptUnitSessionId,
        idempotency_key: "workflow_demo_data_export_failed_update",
        payload: { fixture: "failed_update" },
        attempt_count: 3,
        max_attempts: 3,
        run_after: minutesAfter(input.base, 44),
        last_error_category: "fixture_failure",
        last_error_message: "Development fixture failed workflow job."
      }
    ]
  });
  await input.prisma.workflowOverride.create({
    data: {
      override_public_id: "override_demo_data_export_pause",
      assessment_session_db_id: input.sessionId,
      concept_unit_session_db_id: input.sourceConceptUnitSessionId,
      action_type: "pause_automation",
      reason: "Development fixture workflow pause.",
      created_by_user_db_id: input.teacherId,
      created_at: minutesAfter(input.base, 46)
    }
  });
}

export async function cleanupDataExportDemoFixture(prisma: PrismaClient) {
  await cleanupOutcomeAndExportRecords(prisma);
  const deletedAssessment = await cleanupAssessmentRecords(prisma);
  await prisma.user.deleteMany({
    where: {
      user_id: { in: [dataExportSecondStudentUserId, dataExportInactiveStudentUserId] }
    }
  });

  return { deleted_assessment: deletedAssessment };
}

export async function ensureDataExportDemoFixture(prisma: PrismaClient) {
  await cleanupDataExportDemoFixture(prisma);
  const { teacher, student, secondStudent, inactiveStudent } = await ensureDataExportUsers(prisma);
  const { assessment, conceptUnit, secondConceptUnit, items, secondConceptItems } =
    await createFixtureAssessment(prisma, teacher.id);

  const complete = await addInitialPackageSession({
    prisma,
    userDbId: secondStudent.id,
    assessmentDbId: assessment.id,
    conceptUnitDbId: conceptUnit.id,
    items,
    sessionPublicId: dataExportCompleteSessionPublicId,
    attemptNumber: 1,
    status: "completed",
    currentPhase: "session_completed",
    base: new Date("2026-06-19T15:00:00.000Z"),
    skipped: false,
    workflowMode: "automatic"
  });
  const longitudinal = await attachProfileDecisionFollowupFixture({
    prisma,
    sessionId: complete.session.id,
    conceptUnitSessionId: complete.conceptUnitSession.id,
    base: new Date("2026-06-19T15:00:00.000Z")
  });
  const finalConceptUnitSession = await addSecondConceptToSession({
    prisma,
    sessionId: complete.session.id,
    conceptUnitDbId: secondConceptUnit.id,
    items: secondConceptItems,
    base: new Date("2026-06-19T15:00:00.000Z")
  });
  await attachProgressionAndWorkflowFixture({
    prisma,
    teacherId: teacher.id,
    sessionId: complete.session.id,
    sourceConceptUnitSessionId: complete.conceptUnitSession.id,
    finalConceptUnitSessionId: finalConceptUnitSession.id,
    destinationConceptUnitId: secondConceptUnit.id,
    sourceProfileId: longitudinal.updatedProfile.id,
    sourceDecisionId: longitudinal.updatedDecision.id,
    base: new Date("2026-06-19T15:00:00.000Z")
  });
  await prisma.assessmentSession.update({
    where: { id: complete.session.id },
    data: {
      current_concept_unit_db_id: secondConceptUnit.id,
      completed_at: new Date("2026-06-19T16:10:00.000Z"),
      last_activity_at: new Date("2026-06-19T16:10:00.000Z")
    }
  });
  await inputIncompleteSession(prisma, {
    userDbId: secondStudent.id,
    assessmentDbId: assessment.id,
    conceptUnitDbId: conceptUnit.id
  });
  await addInitialPackageSession({
    prisma,
    userDbId: student.id,
    assessmentDbId: assessment.id,
    conceptUnitDbId: conceptUnit.id,
    items,
    sessionPublicId: dataExportSkippedSessionPublicId,
    attemptNumber: 1,
    status: "active",
    currentPhase: "profiling_pending",
    base: new Date("2026-06-19T16:00:00.000Z"),
    skipped: true,
    workflowMode: "automatic"
  });
  await inputConceptUnitPlaceholderSession(prisma, {
    userDbId: inactiveStudent.id,
    assessmentDbId: assessment.id,
    conceptUnitDbId: conceptUnit.id
  });

  return {
    teacher,
    student,
    secondStudent,
    inactiveStudent,
    assessment,
    conceptUnit,
    secondConceptUnit,
    items
  };
}

async function inputIncompleteSession(
  prisma: PrismaClient,
  input: {
    userDbId: string;
    assessmentDbId: string;
    conceptUnitDbId: string;
  }
) {
  const base = new Date("2026-06-19T17:00:00.000Z");

  return prisma.assessmentSession.create({
    data: {
      session_public_id: dataExportIncompleteSessionPublicId,
      user_db_id: input.userDbId,
      assessment_db_id: input.assessmentDbId,
      attempt_number: 2,
      status: "active",
      current_phase: "concept_unit_intro",
      current_concept_unit_db_id: input.conceptUnitDbId,
      started_at: base,
      last_activity_at: minutesAfter(base, 3),
      completed_at: null,
      needs_review: true,
      needs_review_reason: "Development fixture interrupted before concept-unit responses."
    }
  });
}

async function inputConceptUnitPlaceholderSession(
  prisma: PrismaClient,
  input: {
    userDbId: string;
    assessmentDbId: string;
    conceptUnitDbId: string;
  }
) {
  const base = new Date("2026-06-19T18:00:00.000Z");
  const session = await prisma.assessmentSession.create({
    data: {
      session_public_id: dataExportInactiveSessionPublicId,
      user_db_id: input.userDbId,
      assessment_db_id: input.assessmentDbId,
      attempt_number: 1,
      status: "active",
      current_phase: "initial_item_administration",
      workflow_mode_snapshot: "manual_review",
      current_concept_unit_db_id: input.conceptUnitDbId,
      started_at: base,
      last_activity_at: minutesAfter(base, 4),
      completed_at: null,
      automation_paused_at: minutesAfter(base, 4),
      needs_review: true,
      needs_review_reason: "Development fixture concept unit was opened but no item response was submitted."
    }
  });

  await prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_db_id: input.conceptUnitDbId,
      status: "initial_in_progress",
      initial_started_at: minutesAfter(base, 1),
      followup_status: "not_started",
      followup_round_count: 0
    }
  });

  return session;
}
