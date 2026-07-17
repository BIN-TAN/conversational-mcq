import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { applyProvisionalItemDiagnosticMetadata } from "../src/lib/services/student-assessment/provisional-item-diagnostic-metadata";
import {
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession,
  completeInitialConceptUnitAdministration,
  getStudentSafeTranscript
} from "../src/lib/services/student-assessment/service";
import {
  getStudentActivityRuntimeState,
  recordStudentActivityRuntimeChoice,
  startStudentActivityForSession,
  submitStudentActivityRuntimeResponse,
  type StudentActivityRuntimeEvaluatorOverride,
  type StudentActivityRuntimeGenerationOverride
} from "../src/lib/services/student-assessment/activity-runtime-ui";
import {
  topicDialoguePublicId
} from "../src/lib/services/student-assessment/topic-dialogue-agent";
import {
  validateStudentActivityRuntimeProjection,
  type StudentActivityRuntimeProjection
} from "../src/lib/student-assessment/activity-runtime-projection";
import {
  FORMATIVE_ACTIVITY_AGENT_NAME,
  FormativeActivityPacketV1Schema,
  buildFormativeActivityDesignPacketFromPackets,
  type FormativeActivityPacketV1
} from "../src/lib/services/student-assessment/formative-activity-design";
import {
  FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_NAME,
  makePassingActivityQualityReviewForTest,
  type FormativeActivityQualityReviewV1,
  type FormativeActivityLiveExecutionResult
} from "../src/lib/services/student-assessment/formative-activity-live";
import {
  buildNoLiveActivityMisconceptionEvidenceFixture,
  type ActivityMisconceptionEvidencePacketV1,
  type MisconceptionUpdateStatus
} from "../src/lib/services/student-assessment/activity-misconception-evidence";
import {
  buildActivityMisconceptionEvidenceLiveAgentInput,
  makeLiveActivityMisconceptionEvidencePacketForTest,
  type ActivityMisconceptionEvidenceLiveEvaluationInput,
  type ActivityMisconceptionEvidenceLiveExecutionResult
} from "../src/lib/services/student-assessment/activity-misconception-evidence-live";
import { prisma } from "../src/lib/db";
import { demoAssessmentPublicId, ensureDemoStudentAssessment } from "./demo-student-assessment-fixture";
import {
  assert,
  assertStudentVisibleTextIsSafe,
  cleanupSmokeStudentSessions,
  completeInitialItem,
  createSmokeStudent
} from "./student-mvp-smoke-helpers";
import {
  configureNoLiveFormativeValueRuntime
} from "./student-formative-value-helpers";
import { activityMisconceptionEvidenceFixtureCases } from "./student-activity-misconception-evidence-fixtures";

const SMOKE_PREFIX = "actrt_ui_phase30g";

type CompletedSession = {
  student_db_id: string;
  session_public_id: string;
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  concept_unit_public_id: string;
};

function assertProjectionSafe(projection: StudentActivityRuntimeProjection, label: string) {
  const validation = validateStudentActivityRuntimeProjection(projection);
  assert(validation.valid, `${label}: student activity runtime projection should be safe.`);
  assertStudentVisibleTextIsSafe(projection);
  const serialized = JSON.stringify(projection);
  assert(
    !/(basic_concept_grounding|distractor_contrast|reasoning_chain_repair|independent_reconstruction|confidence_evidence_audit|transfer_and_distractor_generation|conceptual_entry_grounding|distractor_misconception_probe|reasoning_boundary_repair|independent_misconception_verification|misconception_|evidence_quality|engagement category|ai assistance|agent call|structured output|raw model output|answer key|available choices for a future version|recorded for this version|workflow|runtime|routing|selection rationale|diagnostic purpose|persisted|schema|fallback|Confidence calibrated|reasonably_calibrated|overconfident|underconfident)/i.test(serialized),
    `${label}: projection leaked internal labels or protected answer information.`
  );
  assert(
    !/which option is correct|discover which option|find the correct option|guess the correct/i.test(serialized),
    `${label}: projection should not ask the student to rediscover the correct option after reveal.`
  );
}

function assertStudentComponentCopyIsHardened() {
  const source = readFileSync(
    "src/components/student-assessment/assessment-session-client.tsx",
    "utf8"
  );
  assert(source.includes("Total correct"), "Student sidebar should retain compact initial-results wording.");
  assert(source.includes("data-testid=\"initial-answer-review-list\""), "Student sidebar should retain answer reviews.");
  assert(!source.includes("What your responses show"), "Student sidebar should not duplicate the profile narrative.");
  assert(!source.includes("Your explanations"), "Student sidebar should not duplicate reasoning narrative.");
  assert(!source.includes("How sure you were"), "Student sidebar should not duplicate confidence narrative.");
  assert(!source.includes("Current learning profile"), "Student view should not use Current learning profile.");
  assert(!source.includes("Confidence calibrated"), "Student view should not show Confidence calibrated.");
  assert(!/reasonably_calibrated|overconfident|underconfident/.test(source), "Student view should not expose confidence enum values.");
  assert(source.includes("data-testid=\"activity-runtime-end-assessment\""), "End assessment action should have its own student control.");
  assert(source.includes("data-testid=\"end-attempt\""), "Global End attempt control should remain present.");
  assert(source.includes("End the assessment?"), "End assessment dialog title is missing.");
  assert(
    source.includes("This will end the current assessment conversation."),
    "End assessment dialog message is missing."
  );
  assert(source.includes("Keep working"), "End assessment dialog should include Keep working.");
  assert(!/data being saved|database|research records|system versions|your data is saved/i.test(source), "End assessment copy should not expose persistence or research language.");
  assert(!source.includes("Available choices for a future version"), "Abstract activity menu should not be rendered.");
  assert(!source.includes("Alternative activity selection is recorded for this version"), "Activity switching should not show audit wording.");
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function assertCompleteDialogueContext(input: {
  context: CompletedSession;
  activity_attempt_public_id: string;
  client_operation_id: string;
  latest_student_message: string;
  expected_visible_messages: string[];
  invisible_message: string;
}) {
  const call = await prisma.agentCall.findUniqueOrThrow({
    where: {
      agent_invocation_key:
        `topic-dialogue:${topicDialoguePublicId({
          session_public_id: input.context.session_public_id,
          activity_attempt_public_id: input.activity_attempt_public_id
        })}:${input.client_operation_id}`
    },
    select: { input_payload: true }
  });
  const request = jsonRecord(call.input_payload);
  const turnContext = jsonRecord(request.formative_turn_context);
  const purpose = jsonRecord(turnContext.assessment_purpose_and_workflow);
  assert(
    jsonArray(purpose.complete_workflow).length === 6,
    "Dialogue context should include the complete formative assessment workflow."
  );
  const initialPackage = jsonRecord(turnContext.complete_initial_response_package);
  const interpretation = jsonRecord(initialPackage.assessment_interpretation_context);
  const observed = jsonRecord(interpretation.observed_student_evidence);
  assert(jsonArray(interpretation.items).length === 3, "Dialogue context should include all three initial items.");
  assert(
    jsonArray(observed.item_responses).length === 3,
    "Dialogue context should include all three initial item responses."
  );
  const profiles = jsonRecord(turnContext.complete_profile_history);
  const plans = jsonRecord(turnContext.complete_formative_plan_history);
  assert(jsonArray(profiles.versions).length > 0, "Dialogue context should include profile history.");
  assert(profiles.staged_candidate_for_this_turn, "Dialogue context should include this turn's staged profile.");
  assert(jsonArray(plans.versions).length > 0, "Dialogue context should include planning history.");
  assert(plans.staged_candidate_for_this_turn, "Dialogue context should include this turn's staged plan.");
  const activityHistory = jsonRecord(turnContext.complete_activity_runtime_history);
  assert(
    jsonArray(activityHistory.strategies_already_attempted).length > 0,
    "Dialogue context should list strategies already shown to the student."
  );
  assert(
    Array.isArray(activityHistory.strategies_not_to_repeat),
    "Dialogue context should explicitly separate strategies that should not be repeated."
  );
  const attempts = jsonArray(activityHistory.attempts).map(jsonRecord);
  const currentAttempt = attempts.find(
    (attempt) => attempt.activity_attempt_public_id === input.activity_attempt_public_id
  );
  assert(currentAttempt?.was_actually_shown === true, "Current activity should be recorded as actually shown.");
  assert(
    Object.keys(jsonRecord(currentAttempt?.distractor_anchor)).length > 0,
    "Activity context should expose the current distractor anchor."
  );
  assert(
    jsonArray(currentAttempt?.student_responses).length > 0,
    "Activity context should include the persisted student responses."
  );
  const visibleTranscript = jsonArray(turnContext.complete_visible_transcript).map(jsonRecord);
  const visibleMessages = visibleTranscript.map((turn) => String(turn.message_text ?? ""));
  for (const message of input.expected_visible_messages) {
    assert(visibleMessages.includes(message), `Dialogue context omitted a shown message: ${message}`);
  }
  assert(
    !visibleMessages.includes(input.invisible_message),
    "Dialogue context must exclude an unshown draft."
  );
  const internalHistory = jsonRecord(turnContext.internal_evaluation_and_routing_history);
  assert(
    internalHistory.never_assume_shown_to_student === true,
    "Internal history should be explicitly separated from visible dialogue."
  );
  assert(jsonArray(internalHistory.agent_calls).length > 0, "Internal agent-call history should be present.");
  assert(jsonArray(internalHistory.routing_events).length > 0, "Internal routing history should be present.");
  const platformState = jsonRecord(turnContext.current_platform_and_runtime_state);
  assert(
    platformState.global_assessment_phase === "planning_completed",
    "The orthogonal formative runtime should work while the global phase remains planning_completed."
  );
  assert(platformState.current_activity_attempt_public_id === input.activity_attempt_public_id, "Current attempt is missing.");
  const roleTask = jsonRecord(turnContext.current_agent_role_and_turn_task);
  assert(roleTask.role === "student_facing_dialogue", "Dialogue call should receive its exact role and task.");
  const latest = jsonRecord(turnContext.latest_student_message);
  assert(latest.message_text === input.latest_student_message, "Latest student message should be repeated exactly.");
}

function packetByStatus(
  packets: ActivityMisconceptionEvidencePacketV1[],
  status: MisconceptionUpdateStatus
) {
  const packet = packets.find((entry) => entry.misconception_evidence_update.status === status);
  assert(packet, `Expected activity misconception fixture with status ${status}.`);
  return packet;
}

async function createAgentCall(input: {
  context: CompletedSession;
  suffix: string;
  agent_name: string;
  agent_version: string;
  model_name: string;
  prompt_version: string;
  schema_version: string;
  output_payload: unknown;
}) {
  return prisma.agentCall.create({
    data: {
      assessment_session_db_id: input.context.assessment_session_db_id,
      concept_unit_session_db_id: input.context.concept_unit_session_db_id,
      agent_name: input.agent_name,
      agent_version: input.agent_version,
      model_name: input.model_name,
      provider: "openai",
      provider_request_id: `req_${SMOKE_PREFIX}_${input.suffix}`,
      provider_response_id: `resp_${SMOKE_PREFIX}_${input.suffix}`,
      client_request_id: `client_${SMOKE_PREFIX}_${input.suffix}`,
      prompt_version: input.prompt_version,
      schema_version: input.schema_version,
      input_payload: { smoke: true, redacted: true },
      raw_output: { smoke: true, redacted: true },
      output_payload: input.output_payload as Prisma.InputJsonValue,
      output_validated: true,
      live_call_allowed: true,
      call_status: "succeeded",
      input_tokens: 17,
      output_tokens: 29,
      total_tokens: 46,
      token_usage: { input_tokens: 17, output_tokens: 29, total_tokens: 46 },
      started_at: new Date(),
      completed_at: new Date()
    }
  });
}

async function createLiveActivityAgentCall(
  context: CompletedSession,
  suffix: string,
  packet: FormativeActivityPacketV1
) {
  return createAgentCall({
    context,
    suffix: `activity_${suffix}`,
    agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
    agent_version: "formative-activity-dialogue-v1",
    model_name: "synthetic-live-shaped-formative-activity",
    prompt_version: "formative-activity-dialogue-prompt-v1",
    schema_version: "student-formative-activity-v1",
    output_payload: packet
  });
}

async function createReviewerAgentCall(
  context: CompletedSession,
  suffix: string,
  review: FormativeActivityQualityReviewV1
) {
  return createAgentCall({
    context,
    suffix: `reviewer_${suffix}`,
    agent_name: FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_NAME,
    agent_version: "formative-activity-quality-reviewer-v1",
    model_name: "synthetic-live-shaped-formative-activity-reviewer",
    prompt_version: "formative-activity-quality-review-prompt-v1",
    schema_version: "formative-activity-quality-review-v1",
    output_payload: review
  });
}

async function createEvaluatorAgentCall(input: {
  context: CompletedSession;
  suffix: string;
  packet: ActivityMisconceptionEvidencePacketV1;
}) {
  return createAgentCall({
    context: input.context,
    suffix: `evaluator_${input.suffix}`,
    agent_name: "formative_activity_response_evaluator_agent",
    agent_version: "formative-activity-response-evaluator-v1",
    model_name: "synthetic-live-shaped-activity-response-evaluator",
    prompt_version: "formative-activity-response-evaluator-prompt-v6",
    schema_version: "formative-activity-response-evaluation-v1",
    output_payload: input.packet
  });
}

function makeActivityGenerationOverride(input: {
  context: CompletedSession;
  suffix: string;
  deterministicReviewOnly?: boolean;
}): StudentActivityRuntimeGenerationOverride {
  return async ({ profile_integration_packet, formative_value_packet }) => {
    const deterministic = buildFormativeActivityDesignPacketFromPackets({
      profile_integration_packet,
      formative_value_packet
    });
    const packet = input.deterministicReviewOnly
      ? deterministic
      : FormativeActivityPacketV1Schema.parse({
          ...deterministic,
          generation_source: "live_llm",
          runtime_servable_to_student: true,
          review_only: false
        });
    const review = makePassingActivityQualityReviewForTest();
    const [generatorCall, reviewerCall] = await Promise.all([
      createLiveActivityAgentCall(input.context, input.suffix, packet),
      createReviewerAgentCall(input.context, input.suffix, review)
    ]);

    return {
      status: "succeeded",
      packet,
      quality_review: review,
      generator_agent_call_id: generatorCall.id,
      reviewer_agent_call_id: reviewerCall.id,
      repair_attempted: false,
      generator_call_status: "succeeded",
      reviewer_call_status: "succeeded",
      repair_status: "not_attempted"
    } satisfies FormativeActivityLiveExecutionResult;
  };
}

function makeEvaluator(input: {
  context: CompletedSession;
  base_packets: ActivityMisconceptionEvidencePacketV1[];
  status: MisconceptionUpdateStatus;
  suffix: string;
  noLiveFixture?: boolean;
}): StudentActivityRuntimeEvaluatorOverride {
  return async (
    evaluationInput: ActivityMisconceptionEvidenceLiveEvaluationInput
  ): Promise<ActivityMisconceptionEvidenceLiveExecutionResult> => {
    let providerInput;
    try {
      providerInput = buildActivityMisconceptionEvidenceLiveAgentInput(evaluationInput);
    } catch (error) {
      const paths = (error as { paths?: string[] }).paths ?? [];
      throw new Error(`provider_input_rejected:${paths.join("|")}`);
    }
    assert(
      providerInput.formative_turn_context === evaluationInput.formative_turn_context,
      "The real evaluator provider-input serializer should retain the authoritative formative context."
    );
    const basePacket = packetByStatus(input.base_packets, input.status);
    const commonOverrides = {
      session_public_id: evaluationInput.session_public_id,
      student_public_id: evaluationInput.student_public_id,
      assessment_public_id: evaluationInput.assessment_public_id,
      concept_unit_id: evaluationInput.concept_unit_id,
      activity_attempt_id: evaluationInput.activity_attempt_id,
      source_activity_family: evaluationInput.source_activity_family,
      source_diagnostic_purpose: evaluationInput.source_diagnostic_purpose,
      source_activity_generation_source: "live_llm" as const,
      source_activity_runtime_servable_to_student: true,
      student_activity_response: {
        ...basePacket.student_activity_response,
        response_kind: evaluationInput.response_kind_hint ?? basePacket.student_activity_response.response_kind,
        student_response_text_redacted_or_safe_summary: evaluationInput.safe_student_activity_response
      }
    };
    const packet = input.noLiveFixture
      ? ({
          ...basePacket,
          ...commonOverrides,
          evaluation_source: "no_live_fixture",
          review_only: true,
          runtime_servable_to_student: false
        } as ActivityMisconceptionEvidencePacketV1)
      : makeLiveActivityMisconceptionEvidencePacketForTest(basePacket, commonOverrides);
    const call = await createEvaluatorAgentCall({
      context: input.context,
      suffix: `${input.suffix}_${evaluationInput.activity_attempt_id}`,
      packet
    });
    return {
      status: "succeeded",
      packet,
      evaluator_agent_call_id: call.id,
      repair_attempted: false,
      evaluator_call_status: "succeeded",
      repair_status: "not_attempted"
    };
  };
}

function failingEvaluator(): StudentActivityRuntimeEvaluatorOverride {
  return async () => ({
    status: "invalid_output",
    blocked_reason: "synthetic_evaluator_failure",
    validation_issues: [{
      field_path: "student_safe_feedback.message",
      rule_code: "candidate_validation_failed",
      blocked_pattern_label: "synthetic_failure"
    }],
    evaluator_call_status: "invalid_output",
    repair_attempted: false,
    repair_status: "not_attempted"
  });
}

async function cleanupRuntimeForSessions(sessionPublicIds: string[]) {
  const attempts = await prisma.activityRuntimeAttempt.findMany({
    where: { session_public_id: { in: sessionPublicIds } },
    select: { activity_attempt_public_id: true }
  });
  const attemptIds = attempts.map((attempt) => attempt.activity_attempt_public_id);
  const records = attemptIds.length > 0
    ? await prisma.activityMisconceptionEvidenceRecord.findMany({
        where: { activity_attempt_id: { in: attemptIds } },
        select: { id: true }
      })
    : [];
  await prisma.postActivityDiagnosticSnapshot.deleteMany({
    where: { evidence_record_db_id: { in: records.map((record) => record.id) } }
  });
  await prisma.activityMisconceptionEvidenceRecord.deleteMany({
    where: { activity_attempt_id: { in: attemptIds } }
  });
  await prisma.activityRuntimeAttempt.deleteMany({
    where: { activity_attempt_public_id: { in: attemptIds } }
  });
  await prisma.agentCall.deleteMany({
    where: { client_request_id: { startsWith: `client_${SMOKE_PREFIX}_` } }
  });
}

async function createCompletedSession(suffix: string): Promise<CompletedSession> {
  const prefix = `${SMOKE_PREFIX}_${suffix}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await createSmokeStudent({
    prisma,
    prefix,
    accessCode: `${prefix}_access`
  });
  const started = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: demoAssessmentPublicId,
    new_attempt: true
  });
  let state = await startConceptUnitInitialAdministration({
    student_user_db_id: student.id,
    session_public_id: started.session.session_public_id,
    concept_unit_public_id: started.state.current_concept_unit?.concept_unit_public_id ?? ""
  });

  for (const itemIndex of [1, 2, 3]) {
    state = await completeInitialItem({
      studentDbId: student.id,
      sessionPublicId: started.session.session_public_id,
      prefix,
      state,
      itemIndex,
      withTemptingReason: itemIndex === 2
    });
  }
  assert(state.assessment_state === "PACKAGE_REVIEW", `${suffix}: package review should be reached.`);
  const completed = await completeInitialConceptUnitAdministration({
    student_user_db_id: student.id,
    session_public_id: started.session.session_public_id,
    concept_unit_public_id: started.state.current_concept_unit?.concept_unit_public_id ?? ""
  });
  assert(
    completed.state.assessment_state === "FORMATIVE_ACTIVITY",
    `${suffix}: completed package should reach formative activity state.`
  );

  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: started.session.session_public_id },
    select: { id: true }
  });
  const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
    where: { assessment_session_db_id: session.id },
    select: { id: true }
  });

  await cleanupRuntimeForSessions([started.session.session_public_id]);

  return {
    student_db_id: student.id,
    session_public_id: started.session.session_public_id,
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    concept_unit_public_id: started.state.current_concept_unit?.concept_unit_public_id ?? ""
  };
}

async function cleanupCompletedSessions(contexts: CompletedSession[]) {
  const sessionPublicIds = contexts.map((context) => context.session_public_id);
  await cleanupRuntimeForSessions(sessionPublicIds);
  for (const context of contexts) {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: context.student_db_id,
      sessionPublicIds: [context.session_public_id]
    });
  }
}

async function operationalCounts() {
  return {
    profiles: await prisma.studentProfile.count(),
    decisions: await prisma.formativeDecision.count(),
    responsePackages: await prisma.responsePackage.count()
  };
}

async function assertOperationalCountsUnchanged(
  before: Awaited<ReturnType<typeof operationalCounts>>,
  label: string
) {
  const after = await operationalCounts();
  assert(after.profiles === before.profiles, `${label}: activity runtime UI must not overwrite profiles.`);
  assert(after.decisions === before.decisions, `${label}: activity runtime UI must not overwrite plans.`);
  assert(
    after.responsePackages === before.responsePackages,
    `${label}: activity runtime UI must not mutate response packages.`
  );
}

async function assertOperationalTurnCycleCreated(
  before: Awaited<ReturnType<typeof operationalCounts>>,
  label: string
) {
  const after = await operationalCounts();
  assert(after.profiles === before.profiles, `${label}: a failed update must preserve the prior profile row.`);
  assert(after.decisions === before.decisions, `${label}: a failed update must preserve the prior plan row.`);
  assert(
    after.responsePackages === before.responsePackages + 2,
    `${label}: profile and planning context packages are required.`
  );
}

async function currentStagePointers(conceptUnitSessionDbId: string) {
  return prisma.conceptUnitSession.findUniqueOrThrow({
    where: { id: conceptUnitSessionDbId },
    select: {
      latest_student_profile_db_id: true,
      latest_formative_decision_db_id: true
    }
  });
}

async function assertStaleStageAuditPersisted(input: {
  concept_unit_session_db_id: string;
  assessment_session_db_id: string;
  client_operation_id: string;
}) {
  const packages = await prisma.responsePackage.findMany({
    where: {
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      package_type: "followup_evidence_update_package",
      payload: { path: ["formative_turn", "client_operation_id"], equals: input.client_operation_id }
    }
  });
  assert(packages.length === 2, "Profile and planning fallback packages should both be persisted.");
  const audits = packages.map((entry) => jsonRecord(jsonRecord(entry.payload).orchestration_result));
  const profile = audits.find((audit) => audit.stage === "profile");
  const planning = audits.find((audit) => audit.stage === "planning");
  assert(profile?.profile_update_failed === undefined, "Package audit should use the normalized update_failed field.");
  assert(profile?.update_failed === true && profile.stale_version_used === true, "Stale profile use must be explicit.");
  assert(planning?.update_failed === true && planning.stale_version_used === true, "Stale plan use must be explicit.");
  assert(typeof profile.fallback_source_version === "string", "Profile fallback source version is required.");
  assert(typeof planning.fallback_source_version === "string", "Planning fallback source version is required.");
  assert("failure_agent_call_id" in profile, "Profile failure agent-call metadata key is required.");
  assert("failure_agent_call_id" in planning, "Planning failure agent-call metadata key is required.");

  const failureEvents = await prisma.processEvent.findMany({
    where: {
      assessment_session_db_id: input.assessment_session_db_id,
      event_type: { in: ["followup_profile_update_failed", "followup_planning_update_failed"] },
      payload: { path: ["client_operation_id"], equals: input.client_operation_id }
    }
  });
  assert(failureEvents.length === 2, "Teacher/research audit should expose both stale-stage events.");
}

async function main() {
  configureNoLiveFormativeValueRuntime();
  process.env.OPERATIONAL_AGENT_MODE = "disabled";
  assertStudentComponentCopyIsHardened();
  await ensureDemoStudentAssessment(prisma);
  await applyProvisionalItemDiagnosticMetadata(prisma);

  const contexts: CompletedSession[] = [];
  const fixtures = activityMisconceptionEvidenceFixtureCases();
  const noLivePackets = fixtures.map((fixture) => buildNoLiveActivityMisconceptionEvidenceFixture(fixture));

  try {
    const validContext = await createCompletedSession("valid");
    contexts.push(validContext);
    const validCountsBeforeRuntime = await operationalCounts();
    let projection = await getStudentActivityRuntimeState({
      student_user_db_id: validContext.student_db_id,
      session_public_id: validContext.session_public_id
    });
    assert(projection.ui_state === "not_started", "Initial projection should be not_started.");
    assertProjectionSafe(projection, "not_started");

    projection = await startStudentActivityForSession({
      student_user_db_id: validContext.student_db_id,
      session_public_id: validContext.session_public_id,
      activity_generation_override: makeActivityGenerationOverride({
        context: validContext,
        suffix: "valid"
      })
    });
    assert(projection.ui_state === "waiting_for_your_response", "Start should return a ready response prompt.");
    assert(projection.available, "Started activity should be available.");
    assert(projection.first_turn_message, "Started activity should expose a first turn.");
    assert(projection.response_prompt, "Started activity should expose a response prompt.");
    assert(projection.focus_label, "Started activity should expose a safe focus label.");
    assert(
      !/\bOption\s+[A-E]\b/i.test(projection.first_turn_message ?? "") ||
        /\bItem\s+\d+\b/i.test(projection.first_turn_message ?? ""),
      "Option-specific activity prompts should include an explicit item anchor."
    );
    assertProjectionSafe(projection, "started");

    const originalActivityAttemptId = projection.activity_attempt_public_id;
    const originalFirstTurn = projection.first_turn_message;
    projection = await submitStudentActivityRuntimeResponse({
      student_user_db_id: validContext.student_db_id,
      session_public_id: validContext.session_public_id,
      activity_attempt_public_id: projection.activity_attempt_public_id ?? "",
      response_text: "Theta is the learner estimate, and the item features describe the question rather than the learner.",
      client_message_id: "activity-runtime-ui-response-valid",
      evaluator_override: makeEvaluator({
        context: validContext,
        base_packets: noLivePackets,
        status: "conceptual_entry_improved",
        suffix: "valid"
      })
    });
    const completedAttempt = await prisma.activityRuntimeAttempt.findUniqueOrThrow({
      where: { activity_attempt_public_id: projection.activity_attempt_public_id ?? "" },
      select: { limitations: true }
    });
    assert(
      projection.topic_dialogue?.state === "awaiting_response" ||
        projection.topic_dialogue?.state === "final_support",
      `Response should return an active student-facing dialogue reply: ${JSON.stringify(completedAttempt.limitations)}`
    );
    assert(projection.feedback?.message, "Feedback message should be present.");
    assert(
      !JSON.stringify(completedAttempt.limitations).includes("formative_turn_cycle_recovery_used"),
      `Valid runtime response unexpectedly used recovery: ${JSON.stringify(completedAttempt.limitations)}`
    );
    assertProjectionSafe(projection, "feedback_ready");
    await assertOperationalTurnCycleCreated(validCountsBeforeRuntime, "valid runtime response");

    projection = await recordStudentActivityRuntimeChoice({
      student_user_db_id: validContext.student_db_id,
      session_public_id: validContext.session_public_id,
      activity_attempt_public_id: projection.activity_attempt_public_id,
      choice_state: "choose_another_activity",
      client_action_id: "activity-runtime-ui-choose-other"
    });
    assert(projection.ui_state === "waiting_for_your_response", "Choose another should immediately return a different activity.");
    assert(
      projection.activity_attempt_public_id && projection.activity_attempt_public_id !== originalActivityAttemptId,
      "Choose another should create a replacement activity attempt."
    );
    assert(
      projection.first_turn_message && projection.first_turn_message !== originalFirstTurn,
      "Choose another should render a different activity prompt immediately."
    );
    assert(
      projection.alternative_activity_labels.length === 0,
      "Choose another should not expose an abstract activity menu."
    );
    assertProjectionSafe(projection, "replacement_activity_ready");
    const replacementTranscript = await getStudentSafeTranscript({
      student_user_db_id: validContext.student_db_id,
      session_public_id: validContext.session_public_id
    });
    assert(
      replacementTranscript.transcript.some((turn) => turn.message_text.includes(originalFirstTurn ?? "__missing__")),
      "The original shown activity should remain in the visible transcript."
    );
    assert(
      replacementTranscript.transcript.some((turn) => turn.message_text.includes(projection.first_turn_message ?? "__missing__")),
      "The replacement activity should be a new visible transcript turn."
    );
    assert(
      /Item\s+\d+/i.test(projection.first_turn_message ?? "") &&
        /option\s+[A-D]/i.test(projection.first_turn_message ?? ""),
      "The replacement activity must retain the persisted item and distractor anchor."
    );

    const repeatedContext = await createCompletedSession("repeated_confusion");
    contexts.push(repeatedContext);
    let repeatedProjection = await startStudentActivityForSession({
      student_user_db_id: repeatedContext.student_db_id,
      session_public_id: repeatedContext.session_public_id,
      activity_generation_override: makeActivityGenerationOverride({
        context: repeatedContext,
        suffix: "repeated_confusion"
      })
    });
    const repeatedAttemptId = repeatedProjection.activity_attempt_public_id ?? "";
    const promptTurn = await prisma.conversationTurn.findFirstOrThrow({
      where: {
        assessment_session_db_id: repeatedContext.assessment_session_db_id,
        actor_type: "agent",
        agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
        structured_payload: {
          path: ["activity_attempt_public_id"],
          equals: repeatedAttemptId
        }
      },
      select: { message_text: true }
    });
    const invisibleMessage = "This unshown strategy draft must not enter the visible context.";
    await prisma.conversationTurn.create({
      data: {
        assessment_session_db_id: repeatedContext.assessment_session_db_id,
        concept_unit_session_db_id: repeatedContext.concept_unit_session_db_id,
        phase: "planning_completed",
        actor_type: "agent",
        agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
        message_text: invisibleMessage,
        structured_payload: {
          message_type: "formative_activity_draft",
          activity_attempt_public_id: repeatedAttemptId,
          visibility_status: "not_shown",
          shown_to_student: false
        }
      }
    });
    const expectedVisibleMessages = [promptTurn.message_text ?? ""];
    let completedReplayExpected: StudentActivityRuntimeProjection | null = null;
    const confusionTurns = [
      { id: "activity-runtime-confusion-1", message: "I don't understand." },
      { id: "activity-runtime-confusion-2", message: "I still don't know what you mean." },
      { id: "activity-runtime-confusion-3", message: "Can you explain the question?" }
    ];
    for (const turn of confusionTurns) {
      const before = await operationalCounts();
      const pointersBefore = await currentStagePointers(repeatedContext.concept_unit_session_db_id);
      repeatedProjection = await submitStudentActivityRuntimeResponse({
        student_user_db_id: repeatedContext.student_db_id,
        session_public_id: repeatedContext.session_public_id,
        activity_attempt_public_id: repeatedAttemptId,
        response_text: turn.message,
        client_message_id: turn.id,
        evaluator_override: makeEvaluator({
          context: repeatedContext,
          base_packets: noLivePackets,
          status: "conceptual_entry_gap_remains",
          suffix: turn.id
        })
      });
      if (turn.id === confusionTurns[2]?.id) {
        completedReplayExpected = structuredClone(repeatedProjection);
      }
      await assertOperationalTurnCycleCreated(before, turn.id);
      const pointersAfter = await currentStagePointers(repeatedContext.concept_unit_session_db_id);
      assert(
        pointersAfter.latest_student_profile_db_id === pointersBefore.latest_student_profile_db_id &&
          pointersAfter.latest_formative_decision_db_id === pointersBefore.latest_formative_decision_db_id,
        `${turn.id}: failed profile and planning updates must keep prior validated pointers.`
      );
      await assertStaleStageAuditPersisted({
        concept_unit_session_db_id: repeatedContext.concept_unit_session_db_id,
        assessment_session_db_id: repeatedContext.assessment_session_db_id,
        client_operation_id: turn.id
      });
      assert(
        repeatedProjection.latest_reply_visible_in_transcript,
        `${turn.id}: every accepted response should persist a visible assistant reply.`
      );
      await assertCompleteDialogueContext({
        context: repeatedContext,
        activity_attempt_public_id: repeatedAttemptId,
        client_operation_id: turn.id,
        latest_student_message: turn.message,
        expected_visible_messages: [...expectedVisibleMessages, turn.message],
        invisible_message: invisibleMessage
      });
      const turnsForOperation = await prisma.conversationTurn.findMany({
        where: {
          assessment_session_db_id: repeatedContext.assessment_session_db_id,
          structured_payload: { path: ["client_operation_id"], equals: turn.id }
        },
        orderBy: [{ sequence_index: "asc" }],
        select: { id: true, sequence_index: true, actor_type: true, message_text: true }
      });
      assert(turnsForOperation.length === 2, `${turn.id}: one student and one assistant turn are required.`);
      assert(turnsForOperation[0]?.actor_type === "student", `${turn.id}: student turn must be first.`);
      assert(turnsForOperation[1]?.actor_type === "agent", `${turn.id}: assistant turn must follow.`);
      assert(
        (turnsForOperation[0]?.sequence_index ?? 0) < (turnsForOperation[1]?.sequence_index ?? 0),
        `${turn.id}: persisted sequence must preserve student-before-assistant causality.`
      );
      assert(
        /Item\s+\d+|Option\s+[A-D]|theta|item difficulty|item discrimination/i.test(
          turnsForOperation[1]?.message_text ?? ""
        ),
        `${turn.id}: repeated confusion support must remain tied to the active distractor or concept boundary: ${turnsForOperation[1]?.message_text ?? "<missing>"}`
      );
      if (turn.id === confusionTurns[0]?.id) {
        const tiedTimestamp = new Date("2026-07-17T09:00:00.000Z");
        await prisma.conversationTurn.updateMany({
          where: { id: { in: turnsForOperation.map((entry) => entry.id) } },
          data: { created_at: tiedTimestamp }
        });
        const sameTimestampTurns = await prisma.conversationTurn.findMany({
          where: { id: { in: turnsForOperation.map((entry) => entry.id) } },
          orderBy: [{ sequence_index: "asc" }],
          select: { actor_type: true, created_at: true, sequence_index: true }
        });
        assert(
          sameTimestampTurns[0]?.created_at.getTime() === sameTimestampTurns[1]?.created_at.getTime(),
          "Timeline regression fixture should force equal timestamps."
        );
        assert(
          sameTimestampTurns[0]?.actor_type === "student" &&
            sameTimestampTurns[1]?.actor_type === "agent" &&
            sameTimestampTurns[0].sequence_index < sameTimestampTurns[1].sequence_index,
          "Monotonic sequence must preserve causal order when timestamps tie."
        );
      }
      expectedVisibleMessages.push(turn.message, turnsForOperation[1]?.message_text ?? "");
    }
    const countsBeforeReplay = await operationalCounts();
    const replayTurnCount = await prisma.conversationTurn.count({
      where: { assessment_session_db_id: repeatedContext.assessment_session_db_id }
    });
    await Promise.all([
      submitStudentActivityRuntimeResponse({
        student_user_db_id: repeatedContext.student_db_id,
        session_public_id: repeatedContext.session_public_id,
        activity_attempt_public_id: repeatedAttemptId,
        response_text: confusionTurns[2]!.message,
        client_message_id: confusionTurns[2]!.id,
        evaluator_override: makeEvaluator({
          context: repeatedContext,
          base_packets: noLivePackets,
          status: "conceptual_entry_gap_remains",
          suffix: "duplicate-a"
        })
      }),
      submitStudentActivityRuntimeResponse({
        student_user_db_id: repeatedContext.student_db_id,
        session_public_id: repeatedContext.session_public_id,
        activity_attempt_public_id: repeatedAttemptId,
        response_text: confusionTurns[2]!.message,
        client_message_id: confusionTurns[2]!.id,
        evaluator_override: makeEvaluator({
          context: repeatedContext,
          base_packets: noLivePackets,
          status: "conceptual_entry_gap_remains",
          suffix: "duplicate-b"
        })
      })
    ]);
    await assertOperationalCountsUnchanged(countsBeforeReplay, "concurrent idempotent replay");
    assert(
      await prisma.conversationTurn.count({
        where: { assessment_session_db_id: repeatedContext.assessment_session_db_id }
      }) === replayTurnCount,
      "Concurrent idempotent replay must not duplicate visible turns."
    );
    const concurrentCountsBefore = await operationalCounts();
    const concurrentTurns = [
      { id: "activity-runtime-concurrent-a", message: "I understand." },
      { id: "activity-runtime-concurrent-b", message: "I have another question about this idea." }
    ];
    const concurrentResults = await Promise.allSettled(
      concurrentTurns.map((turn) => submitStudentActivityRuntimeResponse({
        student_user_db_id: repeatedContext.student_db_id,
        session_public_id: repeatedContext.session_public_id,
        activity_attempt_public_id: repeatedAttemptId,
        response_text: turn.message,
        client_message_id: turn.id,
        evaluator_override: makeEvaluator({
          context: repeatedContext,
          base_packets: noLivePackets,
          status: "conceptual_entry_gap_remains",
          suffix: turn.id
        })
      }))
    );
    assert(
      concurrentResults.filter((result) => result.status === "fulfilled").length === 1,
      "Only one of two distinct concurrent formative submissions may be accepted."
    );
    assert(
      concurrentResults.filter((result) => result.status === "rejected").length === 1,
      "The competing formative submission should be rejected before persistence."
    );
    await assertOperationalTurnCycleCreated(concurrentCountsBefore, "distinct concurrent submission");
    const concurrentConversationTurns = await prisma.conversationTurn.findMany({
      where: {
        assessment_session_db_id: repeatedContext.assessment_session_db_id,
        OR: concurrentTurns.map((turn) => ({
          structured_payload: { path: ["client_operation_id"], equals: turn.id }
        }))
      },
      orderBy: [{ sequence_index: "asc" }],
      select: { actor_type: true, structured_payload: true }
    });
    assert(
      concurrentConversationTurns.length === 2 &&
        concurrentConversationTurns[0]?.actor_type === "student" &&
        concurrentConversationTurns[1]?.actor_type === "agent",
      "The accepted concurrent turn should have exactly one ordered student/assistant pair."
    );
    const acceptedConcurrentPayload = jsonRecord(concurrentConversationTurns[0]?.structured_payload);
    const acceptedConcurrentId = String(acceptedConcurrentPayload.client_operation_id ?? "");
    const acceptedConcurrent = concurrentTurns.find((turn) => turn.id === acceptedConcurrentId);
    assert(acceptedConcurrent, "The accepted concurrent operation should be identifiable.");
    await assertCompleteDialogueContext({
      context: repeatedContext,
      activity_attempt_public_id: repeatedAttemptId,
      client_operation_id: acceptedConcurrentId,
      latest_student_message: acceptedConcurrent!.message,
      expected_visible_messages: [...expectedVisibleMessages, acceptedConcurrent!.message],
      invisible_message: invisibleMessage
    });
    const latestEvidence = await prisma.activityMisconceptionEvidenceRecord.findFirstOrThrow({
      where: { activity_attempt_id: repeatedAttemptId },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      select: { misconception_update_status: true }
    });
    assert(
      latestEvidence.misconception_update_status === "conceptual_entry_gap_remains",
      "A bare claim of understanding must not resolve the misconception without evaluator evidence."
    );
    const firstRefresh = await getStudentSafeTranscript({
      student_user_db_id: repeatedContext.student_db_id,
      session_public_id: repeatedContext.session_public_id
    });
    const secondRefresh = await getStudentSafeTranscript({
      student_user_db_id: repeatedContext.student_db_id,
      session_public_id: repeatedContext.session_public_id
    });
    assert(
      JSON.stringify(firstRefresh) === JSON.stringify(secondRefresh),
      "Refresh should reconstruct the same stable transcript order and identifiers."
    );
    assert(
      !firstRefresh.transcript.some((turn) => turn.message_text === invisibleMessage),
      "Refresh must not expose the invisible activity draft."
    );
    const repeatedSession = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: repeatedContext.session_public_id },
      select: { current_phase: true }
    });
    assert(
      repeatedSession.current_phase === "planning_completed",
      "Active formative dialogue should remain compatible with the orthogonal planning_completed phase."
    );

    await recordStudentActivityRuntimeChoice({
      student_user_db_id: repeatedContext.student_db_id,
      session_public_id: repeatedContext.session_public_id,
      activity_attempt_public_id: repeatedAttemptId,
      choice_state: "finish_assessment",
      client_action_id: "activity-runtime-terminal-choice"
    });
    const countsBeforeTerminalReplay = await operationalCounts();
    const terminalReplay = await submitStudentActivityRuntimeResponse({
      student_user_db_id: repeatedContext.student_db_id,
      session_public_id: repeatedContext.session_public_id,
      activity_attempt_public_id: repeatedAttemptId,
      response_text: confusionTurns[2]!.message,
      client_message_id: confusionTurns[2]!.id,
      evaluator_override: makeEvaluator({
        context: repeatedContext,
        base_packets: noLivePackets,
        status: "conceptual_entry_gap_remains",
        suffix: "terminal-replay"
      })
    });
    assert(completedReplayExpected, "The completed replay fixture must capture the accepted result.");
    assert(
      JSON.stringify(terminalReplay) === JSON.stringify(completedReplayExpected),
      "completed_idempotency_key_replays_cached_result: terminal replay must return the exact accepted result."
    );
    await assertOperationalCountsUnchanged(
      countsBeforeTerminalReplay,
      "completed same-key replay after terminal completion"
    );

    let newTerminalKeyRejected = false;
    try {
      await submitStudentActivityRuntimeResponse({
        student_user_db_id: repeatedContext.student_db_id,
        session_public_id: repeatedContext.session_public_id,
        activity_attempt_public_id: repeatedAttemptId,
        response_text: "I have a new response after completion.",
        client_message_id: "activity-runtime-new-key-after-terminal",
        evaluator_override: makeEvaluator({
          context: repeatedContext,
          base_packets: noLivePackets,
          status: "conceptual_entry_gap_remains",
          suffix: "new-terminal-key"
        })
      });
    } catch (error) {
      newTerminalKeyRejected =
        error instanceof Error && error.message === "This formative episode has already ended.";
    }
    assert(
      newTerminalKeyRejected,
      "new_key_after_terminal_is_rejected: a new key must not create a post-terminal cycle."
    );
    await assertOperationalCountsUnchanged(
      countsBeforeTerminalReplay,
      "new key rejected after terminal completion"
    );

    const moveContext = await createCompletedSession("move");
    contexts.push(moveContext);
    const moveCountsBeforeRuntime = await operationalCounts();
    projection = await startStudentActivityForSession({
      student_user_db_id: moveContext.student_db_id,
      session_public_id: moveContext.session_public_id,
      activity_generation_override: makeActivityGenerationOverride({
        context: moveContext,
        suffix: "move"
      })
    });
    projection = await recordStudentActivityRuntimeChoice({
      student_user_db_id: moveContext.student_db_id,
      session_public_id: moveContext.session_public_id,
      activity_attempt_public_id: projection.activity_attempt_public_id,
      choice_state: "move_on",
      client_action_id: "activity-runtime-ui-move-on"
    });
    assert(projection.ui_state === "moved_on", "End assessment should record a safe terminal state.");
    assert(projection.status_message === "Assessment ended", "End assessment should use terminal student-facing status.");
    assert(
      projection.feedback?.message === "The assessment has ended for this attempt.",
      "End assessment should use clean terminal feedback."
    );
    assertProjectionSafe(projection, "moved_on");
    await assertOperationalCountsUnchanged(moveCountsBeforeRuntime, "move-on runtime choice");

    const deterministicContext = await createCompletedSession("deterministic");
    contexts.push(deterministicContext);
    const deterministicCountsBeforeRuntime = await operationalCounts();
    projection = await startStudentActivityForSession({
      student_user_db_id: deterministicContext.student_db_id,
      session_public_id: deterministicContext.session_public_id,
      activity_generation_override: makeActivityGenerationOverride({
        context: deterministicContext,
        suffix: "deterministic",
        deterministicReviewOnly: true
      })
    });
    assert(
      projection.ui_state === "could_not_prepare_activity_safely",
      "Deterministic review activity packet must fail closed for runtime UI."
    );
    assertProjectionSafe(projection, "deterministic_rejected");
    await assertOperationalCountsUnchanged(
      deterministicCountsBeforeRuntime,
      "deterministic review packet rejection"
    );

    const noLiveContext = await createCompletedSession("no_live_evidence");
    contexts.push(noLiveContext);
    const noLiveCountsBeforeRuntime = await operationalCounts();
    projection = await startStudentActivityForSession({
      student_user_db_id: noLiveContext.student_db_id,
      session_public_id: noLiveContext.session_public_id,
      activity_generation_override: makeActivityGenerationOverride({
        context: noLiveContext,
        suffix: "no_live_evidence"
      })
    });
    projection = await submitStudentActivityRuntimeResponse({
      student_user_db_id: noLiveContext.student_db_id,
      session_public_id: noLiveContext.session_public_id,
      activity_attempt_public_id: projection.activity_attempt_public_id ?? "",
      response_text: "I can explain this now.",
      client_message_id: "activity-runtime-ui-no-live-evidence",
      evaluator_override: makeEvaluator({
        context: noLiveContext,
        base_packets: noLivePackets,
        status: "conceptual_entry_improved",
        suffix: "no_live_evidence",
        noLiveFixture: true
      })
    });
    assert(
      projection.ui_state === "waiting_for_your_response",
      "No-live fixture evaluator output must fail closed internally while keeping the student conversation resumable."
    );
    assert(
      projection.latest_reply_visible_in_transcript,
      "No-live fixture rejection should persist a neutral visible recovery reply."
    );
    assertProjectionSafe(projection, "no_live_fixture_rejected");
    await assertOperationalCountsUnchanged(noLiveCountsBeforeRuntime, "no-live fixture rejection");

    const evaluatorFailureContext = await createCompletedSession("evaluator_failure");
    contexts.push(evaluatorFailureContext);
    const evaluatorFailureCountsBeforeRuntime = await operationalCounts();
    projection = await startStudentActivityForSession({
      student_user_db_id: evaluatorFailureContext.student_db_id,
      session_public_id: evaluatorFailureContext.session_public_id,
      activity_generation_override: makeActivityGenerationOverride({
        context: evaluatorFailureContext,
        suffix: "evaluator_failure"
      })
    });
    projection = await submitStudentActivityRuntimeResponse({
      student_user_db_id: evaluatorFailureContext.student_db_id,
      session_public_id: evaluatorFailureContext.session_public_id,
      activity_attempt_public_id: projection.activity_attempt_public_id ?? "",
      response_text: "This answer is incomplete.",
      client_message_id: "activity-runtime-ui-evaluator-failure",
      evaluator_override: failingEvaluator()
    });
    assert(
      projection.ui_state === "waiting_for_your_response",
      "Evaluator failure must fail closed internally while keeping the student conversation resumable."
    );
    assert(
      projection.latest_reply_visible_in_transcript,
      "Evaluator failure should persist a neutral visible recovery reply."
    );
    const evaluatorRecoveryTurn = await prisma.conversationTurn.findFirstOrThrow({
      where: {
        assessment_session_db_id: evaluatorFailureContext.assessment_session_db_id,
        actor_type: "agent",
        structured_payload: {
          path: ["client_operation_id"],
          equals: "activity-runtime-ui-evaluator-failure"
        }
      },
      select: { message_text: true, structured_payload: true }
    });
    assert(
      /Item\s+\d+|Option\s+[A-D]/i.test(evaluatorRecoveryTurn.message_text ?? ""),
      "Evaluator failure recovery must retain the persisted item or distractor anchor."
    );
    assert(
      jsonRecord(evaluatorRecoveryTurn.structured_payload).distractor_anchor_preserved === true,
      "Evaluator failure recovery must identify that its distractor anchor was preserved."
    );
    assertProjectionSafe(projection, "evaluator_failure");
    await assertOperationalCountsUnchanged(
      evaluatorFailureCountsBeforeRuntime,
      "evaluator failure fail-closed path"
    );

    const unsafeProjectionValidation = validateStudentActivityRuntimeProjection({
      ...projection,
      feedback: {
        message: "The answer key says A is correct.",
        next_options: ["continue"]
      }
    });
    assert(
      !unsafeProjectionValidation.valid,
      "Projection validator should reject correctness or answer-key language."
    );

    console.log(JSON.stringify({
      status: "passed",
      no_openai_call_made: true,
      sessions_exercised: contexts.length,
      repeated_confusion_turns: confusionTurns.length,
      complete_context_propagation_verified: true,
      invisible_draft_isolation_verified: true,
      idempotent_replay_verified: true,
      completed_idempotency_key_replays_cached_result: true,
      new_key_after_terminal_is_rejected: true,
      distinct_concurrent_submission_serialized: true,
      unsupported_resolution_claim_rejected: true,
      refresh_timeline_verified: true,
      activity_runtime_projection_safe: true,
      deterministic_review_packet_rejected: true,
      no_live_fixture_evidence_rejected: true,
      evaluator_failure_failed_closed: true,
      response_package_count_unchanged_after_setup: true
    }, null, 2));
  } finally {
    await cleanupCompletedSessions(contexts);
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
