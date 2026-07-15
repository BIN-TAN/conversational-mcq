import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { applyProvisionalItemDiagnosticMetadata } from "../src/lib/services/student-assessment/provisional-item-diagnostic-metadata";
import {
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession,
  completeInitialConceptUnitAdministration
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
  assert(source.includes("What your responses show"), "Student profile panel should use evidence-summary wording.");
  assert(!source.includes("Current learning profile"), "Student view should not use Current learning profile.");
  assert(!source.includes("Confidence calibrated"), "Student view should not show Confidence calibrated.");
  assert(!/reasonably_calibrated|overconfident|underconfident/.test(source), "Student view should not expose confidence enum values.");
  assert(source.includes("data-testid=\"activity-runtime-end-assessment\""), "End assessment action should have its own student control.");
  assert(source.includes("data-testid=\"end-attempt\""), "Global End attempt control should remain present.");
  assert(source.includes("End the assessment?"), "End assessment dialog title is missing.");
  assert(
    source.includes("This will end the assessment now. You will not complete another activity or transfer item in this attempt."),
    "End assessment dialog message is missing."
  );
  assert(source.includes("Keep working"), "End assessment dialog should include Keep working.");
  assert(!/data being saved|database|research records|system versions|your data is saved/i.test(source), "End assessment copy should not expose persistence or research language.");
  assert(!source.includes("Available choices for a future version"), "Abstract activity menu should not be rendered.");
  assert(!source.includes("Alternative activity selection is recorded for this version"), "Activity switching should not show audit wording.");
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
    responsePackages: await prisma.responsePackage.count()
  };
}

async function assertOperationalCountsUnchanged(
  before: Awaited<ReturnType<typeof operationalCounts>>,
  label: string
) {
  const after = await operationalCounts();
  assert(after.profiles === before.profiles, `${label}: activity runtime UI must not overwrite profiles.`);
  assert(
    after.responsePackages === before.responsePackages,
    `${label}: activity runtime UI must not mutate response packages.`
  );
}

async function main() {
  configureNoLiveFormativeValueRuntime();
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
    assert(projection.ui_state === "feedback_ready", "Response should return safe feedback.");
    assert(projection.feedback?.message, "Feedback message should be present.");
    assertProjectionSafe(projection, "feedback_ready");
    await assertOperationalCountsUnchanged(validCountsBeforeRuntime, "valid runtime response");

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
      projection.ui_state === "could_not_review_response_safely",
      "No-live fixture evaluator output must fail closed for production diagnosis."
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
      projection.ui_state === "could_not_review_response_safely",
      "Evaluator failure must fail closed for the student UI."
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
