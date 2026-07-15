import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Prisma, PrismaClient } from "@prisma/client";
import { applyProvisionalItemDiagnosticMetadata } from "../src/lib/services/student-assessment/provisional-item-diagnostic-metadata";
import {
  completeInitialConceptUnitAdministration,
  getStudentSessionState,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession
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
import { buildClassroomPilotWorkflowReview } from "../src/lib/services/classroom-pilot-readiness";
import { assertStudentPayloadIsSafe } from "../src/lib/services/student-assessment/serializers";
import { getTeacherReviewSessionDetail } from "../src/lib/services/teacher-review/session-detail";
import { getTeacherReviewTranscript } from "../src/lib/services/teacher-review/transcripts";
import { getTeacherReadableTranscript } from "../src/lib/services/teacher-review/readable-transcript";
import { buildTeacherSessionDataAudit } from "../src/lib/services/teacher-review/session-data-audit";
import { buildTeacherResearchBulkExport } from "../src/lib/services/teacher-research-export/service";
import { buildResearchExportIntegrityReview } from "../src/lib/services/teacher-research-export/integrity-review";
import { demoAssessmentPublicId, ensureDemoStudentAssessment } from "./demo-student-assessment-fixture";
import {
  assert,
  assertStudentVisibleTextIsSafe,
  cleanupSmokeStudentSessions,
  completeInitialItem,
  createSmokeStudent
} from "./student-mvp-smoke-helpers";
import { configureNoLiveFormativeValueRuntime } from "./student-formative-value-helpers";
import { activityMisconceptionEvidenceFixtureCases } from "./student-activity-misconception-evidence-fixtures";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const SMOKE_PREFIX = "classroom_pilot_phase31a";

type CompletedSession = {
  student_db_id: string;
  session_public_id: string;
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  concept_unit_public_id: string;
};

function assertProjectionSafe(projection: StudentActivityRuntimeProjection, label: string) {
  const validation = validateStudentActivityRuntimeProjection(projection);
  assert(validation.valid, `${label}: activity runtime projection should validate.`);
  assertStudentVisibleTextIsSafe(projection);
}

function assertNoProtectedTeacherResearchData(value: unknown, label: string) {
  const serialized = JSON.stringify(value).toLowerCase();
  const forbidden = [
    /"password_hash"\s*:/,
    /"access_code_hash"\s*:/,
    /"api_key"\s*:/,
    /authorization\s*:/,
    /bearer\s+[a-z0-9._-]{10,}/,
    /"database_url"\s*:/,
    /"session_secret"\s*:/,
    /"raw_output"\s*:/,
    /"input_payload"\s*:/,
    /"output_payload"\s*:/,
    /"correct_option"\s*:/,
    /"correct_option_snapshot"\s*:/,
    /"answer_key"\s*:/,
    /"distractor_rationales"\s*:/,
    /"possible_misconception_indicators"\s*:/,
    /"expected_reasoning_patterns"\s*:/,
    /"misconception_ids?"\s*:/,
    /\bthe correct answer is\b/,
    /\bthe answer is\b/
  ];

  for (const pattern of forbidden) {
    assert(!pattern.test(serialized), `${label} leaked protected content matching ${pattern.source}.`);
  }
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
      input_tokens: 11,
      output_tokens: 23,
      total_tokens: 34,
      token_usage: { input_tokens: 11, output_tokens: 23, total_tokens: 34 },
      started_at: new Date(),
      completed_at: new Date()
    }
  });
}

function makeActivityGenerationOverride(input: {
  context: CompletedSession;
  suffix: string;
}): StudentActivityRuntimeGenerationOverride {
  return async ({ profile_integration_packet, formative_value_packet }) => {
    const deterministicPacket = buildFormativeActivityDesignPacketFromPackets({
      profile_integration_packet,
      formative_value_packet
    });
    const packet: FormativeActivityPacketV1 = FormativeActivityPacketV1Schema.parse({
      ...deterministicPacket,
      generation_source: "live_llm",
      runtime_servable_to_student: true,
      review_only: false
    });
    const review: FormativeActivityQualityReviewV1 = makePassingActivityQualityReviewForTest();
    const [generatorCall, reviewerCall] = await Promise.all([
      createAgentCall({
        context: input.context,
        suffix: `activity_${input.suffix}`,
        agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
        agent_version: "formative-activity-dialogue-v1",
        model_name: "synthetic-live-shaped-formative-activity",
        prompt_version: "formative-activity-dialogue-prompt-v1",
        schema_version: "student-formative-activity-v1",
        output_payload: packet
      }),
      createAgentCall({
        context: input.context,
        suffix: `reviewer_${input.suffix}`,
        agent_name: FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_NAME,
        agent_version: "formative-activity-quality-reviewer-v1",
        model_name: "synthetic-live-shaped-formative-activity-reviewer",
        prompt_version: "formative-activity-quality-review-prompt-v1",
        schema_version: "formative-activity-quality-review-v1",
        output_payload: review
      })
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
  packets: ActivityMisconceptionEvidencePacketV1[];
  status: MisconceptionUpdateStatus;
  suffix: string;
}): StudentActivityRuntimeEvaluatorOverride {
  return async (
    evaluationInput: ActivityMisconceptionEvidenceLiveEvaluationInput
  ): Promise<ActivityMisconceptionEvidenceLiveExecutionResult> => {
    const basePacket = packetByStatus(input.packets, input.status);
    const packet = makeLiveActivityMisconceptionEvidencePacketForTest(basePacket, {
      session_public_id: evaluationInput.session_public_id,
      student_public_id: evaluationInput.student_public_id,
      assessment_public_id: evaluationInput.assessment_public_id,
      concept_unit_id: evaluationInput.concept_unit_id,
      activity_attempt_id: evaluationInput.activity_attempt_id,
      source_activity_family: evaluationInput.source_activity_family,
      source_diagnostic_purpose: evaluationInput.source_diagnostic_purpose,
      source_activity_generation_source: "live_llm",
      source_activity_runtime_servable_to_student: true,
      student_activity_response: {
        ...basePacket.student_activity_response,
        response_kind: evaluationInput.response_kind_hint ?? basePacket.student_activity_response.response_kind,
        student_response_text_redacted_or_safe_summary: evaluationInput.safe_student_activity_response
      }
    });
    const call = await createAgentCall({
      context: input.context,
      suffix: `evaluator_${input.suffix}_${evaluationInput.activity_attempt_id}`,
      agent_name: "formative_activity_response_evaluator_agent",
      agent_version: "formative-activity-response-evaluator-v1",
      model_name: "synthetic-live-shaped-activity-response-evaluator",
      prompt_version: "formative-activity-response-evaluator-prompt-v6",
      schema_version: "formative-activity-response-evaluation-v1",
      output_payload: packet
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

async function cleanupRuntimeForSessions(sessionPublicIds: string[]) {
  const attempts = await prisma.activityRuntimeAttempt.findMany({
    where: { session_public_id: { in: sessionPublicIds } },
    select: { activity_attempt_public_id: true }
  });
  const attemptIds = attempts.map((attempt) => attempt.activity_attempt_public_id);
  const records = attemptIds.length
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
    `${suffix}: completed package should reach formative activity.`
  );

  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: started.session.session_public_id },
    select: { id: true }
  });
  const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
    where: { assessment_session_db_id: session.id },
    select: { id: true }
  });

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
    student_profiles: await prisma.studentProfile.count(),
    response_packages: await prisma.responsePackage.count()
  };
}

async function main() {
  configureNoLiveFormativeValueRuntime();
  await ensureDemoStudentAssessment(prisma);
  await applyProvisionalItemDiagnosticMetadata(prisma);

  const contexts: CompletedSession[] = [];
  const fixturePackets = activityMisconceptionEvidenceFixtureCases()
    .map((fixture) => buildNoLiveActivityMisconceptionEvidenceFixture(fixture));

  try {
    const teacher = await prisma.user.findUnique({ where: { user_id: "teacher_demo" } });
    const demoStudent = await prisma.user.findUnique({ where: { user_id: "student_demo" } });
    assert(teacher?.role === "teacher_researcher", "Synthetic teacher account should exist.");
    assert(demoStudent?.role === "student" && demoStudent.account_status === "active", "Synthetic student account should exist.");

    const responseContext = await createCompletedSession("response");
    contexts.push(responseContext);
    const countsBeforeRuntime = await operationalCounts();
    const initialProjection = await getStudentActivityRuntimeState({
      student_user_db_id: responseContext.student_db_id,
      session_public_id: responseContext.session_public_id
    });
    assert(
      initialProjection.ui_state === "waiting_for_your_response",
      "Phase 31al activity runtime should expose the single next interaction without a prepare step."
    );
    assertProjectionSafe(initialProjection, "initial runtime projection");

    let projection = initialProjection;

    projection = await submitStudentActivityRuntimeResponse({
      student_user_db_id: responseContext.student_db_id,
      session_public_id: responseContext.session_public_id,
      activity_attempt_public_id: projection.activity_attempt_public_id ?? "",
      response_text:
        "Theta is the person estimate on the linked scale; item parameters describe the question rather than the person.",
      client_message_id: `${SMOKE_PREFIX}_activity_response`,
      evaluator_override: makeEvaluator({
        context: responseContext,
        packets: fixturePackets,
        status: "conceptual_entry_improved",
        suffix: "response"
      })
    });
    assert(projection.ui_state === "feedback_ready", "Injected evaluator output should produce safe feedback.");
    assertProjectionSafe(projection, "activity feedback");

    const previousActivityAttemptPublicId = projection.activity_attempt_public_id;
    projection = await recordStudentActivityRuntimeChoice({
      student_user_db_id: responseContext.student_db_id,
      session_public_id: responseContext.session_public_id,
      activity_attempt_public_id: projection.activity_attempt_public_id,
      choice_state: "choose_another_activity",
      client_action_id: `${SMOKE_PREFIX}_choose_another`
    });
    assert(
      projection.ui_state === "waiting_for_your_response",
      "Choose-another activity should immediately render a replacement activity."
    );
    assert(
      projection.activity_attempt_public_id !== previousActivityAttemptPublicId,
      "Choose-another activity should activate a different activity attempt."
    );
    assertProjectionSafe(projection, "choose another projection");

    const countsAfterRuntime = await operationalCounts();
    assert(
      countsAfterRuntime.student_profiles === countsBeforeRuntime.student_profiles,
      "Activity runtime must not overwrite or create operational profiles."
    );
    assert(
      countsAfterRuntime.response_packages === countsBeforeRuntime.response_packages,
      "Activity runtime must not mutate response packages."
    );

    const moveContext = await createCompletedSession("move_on");
    contexts.push(moveContext);
    projection = await startStudentActivityForSession({
      student_user_db_id: moveContext.student_db_id,
      session_public_id: moveContext.session_public_id,
      activity_generation_override: makeActivityGenerationOverride({
        context: moveContext,
        suffix: "move_on"
      })
    });
    projection = await recordStudentActivityRuntimeChoice({
      student_user_db_id: moveContext.student_db_id,
      session_public_id: moveContext.session_public_id,
      activity_attempt_public_id: projection.activity_attempt_public_id,
      choice_state: "move_on",
      client_action_id: `${SMOKE_PREFIX}_move_on`
    });
    assert(projection.ui_state === "moved_on", "Move-on path should be recorded.");
    assertProjectionSafe(projection, "move-on projection");

    const sessionState = await getStudentSessionState({
      student_user_db_id: responseContext.student_db_id,
      session_public_id: responseContext.session_public_id
    });
    assertStudentPayloadIsSafe(sessionState);
    assertStudentVisibleTextIsSafe(sessionState);

    const [detail, readable, structured, audit, exportResult, integrityReview, workflowReview] =
      await Promise.all([
        getTeacherReviewSessionDetail(responseContext.session_public_id),
        getTeacherReadableTranscript(responseContext.session_public_id),
        getTeacherReviewTranscript(responseContext.session_public_id),
        buildTeacherSessionDataAudit({
          session_public_id: responseContext.session_public_id,
          write_artifact: false
        }),
        buildTeacherResearchBulkExport({
          session_public_id: responseContext.session_public_id,
          generated_by_role: "teacher_researcher"
        }),
        buildResearchExportIntegrityReview({
          session_public_id: responseContext.session_public_id,
          write_artifact: false
        }),
        buildClassroomPilotWorkflowReview({ write_artifact: true })
      ]);

    assert(detail.session.session_public_id === responseContext.session_public_id, "Teacher session detail should load.");
    assert(audit.session_public_id === responseContext.session_public_id, "Session evidence audit should load.");
    assert(readable.turns.length > 0, "Readable transcript should be available.");
    assert(structured.turns.length > 0, "Structured event log should be available.");
    assert(exportResult.buffer.subarray(0, 2).toString("utf8") === "PK", "Teacher research export should be a ZIP.");
    assert(integrityReview.summary.status !== "failed", "Research export integrity should pass or report limitations.");
    assert(
      audit.activity_runtime_summary.attempt_count >= 1,
      "Session evidence audit should include activity runtime attempts."
    );
    assert(
      audit.misconception_evidence_summary.record_count >= 1,
      "Session evidence audit should include post-activity evidence records."
    );
    assert(
      audit.diagnostic_snapshot_summary.snapshot_count >= 1,
      "Session evidence audit should include post-activity diagnostic snapshots."
    );
    assertNoProtectedTeacherResearchData(readable, "readable transcript");
    assertNoProtectedTeacherResearchData(structured, "structured event log");
    assertNoProtectedTeacherResearchData(audit, "session evidence audit");
    assert(workflowReview.status !== "failed", "Workflow review should pass or complete with limitations.");
    assert(workflowReview.artifact_path, "Workflow review should write an artifact.");
    assert(workflowReview.no_openai_call_made, "Workflow review must make no provider call.");

    console.log(JSON.stringify({
      status: "passed",
      no_openai_call_made: true,
      teacher_account_available: true,
      student_account_available: true,
      session_initialized: true,
      initial_flow_reached_package_completion: true,
      activity_runtime_projection_prepared_safely: true,
      activity_response_submission_with_injected_evaluator_output: true,
      move_on_path_available: true,
      choose_another_path_available: true,
      teacher_session_detail_available: true,
      session_evidence_audit_available: true,
      readable_transcript_available: true,
      structured_event_log_available: true,
      bulk_export_generated: true,
      research_export_integrity_status: integrityReview.summary.status,
      student_projection_safety_passed: true,
      teacher_research_projection_safety_passed: true,
      operational_profile_not_overwritten: true,
      response_package_not_mutated: true,
      workflow_review_artifact_path: workflowReview.artifact_path,
      synthetic_sessions_exercised: contexts.length
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
