import { readFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import {
  createActivityRuntimeAttemptFromLiveActivityPacket,
  submitStudentActivityResponseForEvidenceUpdate,
  writeActivityRuntimeLoopReview,
  type ActivityRuntimeRecommendation
} from "../src/lib/services/student-assessment/activity-runtime-loop";
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
import {
  FORMATIVE_ACTIVITY_AGENT_NAME,
  FormativeActivityPacketV1Schema,
  buildFormativeActivityDesignPacketFromPackets,
  type FormativeActivityPacketV1
} from "../src/lib/services/student-assessment/formative-activity-design";
import { prisma } from "../src/lib/db";
import { assert } from "./student-mvp-smoke-helpers";
import { activityMisconceptionEvidenceFixtureCases } from "./student-activity-misconception-evidence-fixtures";
import { buildSyntheticActivitySourcePackets } from "./student-formative-activity-fixtures";

const SMOKE_PREFIX = "actrt_phase30f_smoke";

function packetByStatus(
  packets: ActivityMisconceptionEvidencePacketV1[],
  status: MisconceptionUpdateStatus
) {
  const packet = packets.find((entry) => entry.misconception_evidence_update.status === status);
  assert(packet, `Expected activity misconception fixture with status ${status}.`);
  return packet;
}

function liveActivityPacket(input: {
  suffix: string;
  pattern?: Parameters<typeof buildSyntheticActivitySourcePackets>[0]["pattern"];
  primary_value?: Parameters<typeof buildSyntheticActivitySourcePackets>[0]["primary_value"];
}): FormativeActivityPacketV1 {
  const source = buildSyntheticActivitySourcePackets({
    pattern: input.pattern ?? "likely_knowledge_gap",
    primary_value: input.primary_value ?? "diagnostic_clarification",
    session_public_id: `sess_${SMOKE_PREFIX}_${input.suffix}`,
    student_choice: "accepted_recommendation"
  });
  const packet = buildFormativeActivityDesignPacketFromPackets({
    profile_integration_packet: source.profile,
    formative_value_packet: source.formative
  });
  return FormativeActivityPacketV1Schema.parse({
    ...packet,
    generation_source: "live_llm",
    runtime_servable_to_student: true,
    review_only: false
  });
}

async function createSourceActivityAgentCall(suffix: string, overrides: {
  call_status?: "succeeded" | "failed" | "invalid_output";
  output_validated?: boolean;
  provider?: string;
} = {}) {
  return prisma.agentCall.create({
    data: {
      agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
      agent_version: "formative-activity-dialogue-v1",
      model_name: "synthetic-live-shaped-formative-activity",
      provider: overrides.provider ?? "openai",
      provider_request_id: `req_${SMOKE_PREFIX}_activity_${suffix}`,
      provider_response_id: `resp_${SMOKE_PREFIX}_activity_${suffix}`,
      client_request_id: `client_${SMOKE_PREFIX}_activity_${suffix}`,
      prompt_version: "formative-activity-dialogue-prompt-v1",
      schema_version: "student-formative-activity-v1",
      input_payload: { smoke: true, redacted: true },
      raw_output: { smoke: true, redacted: true },
      output_payload: { smoke: true, redacted: true },
      output_validated: overrides.output_validated ?? true,
      live_call_allowed: true,
      call_status: overrides.call_status ?? "succeeded",
      input_tokens: 12,
      output_tokens: 18,
      total_tokens: 30,
      token_usage: { input_tokens: 12, output_tokens: 18, total_tokens: 30 },
      started_at: new Date(),
      completed_at: new Date()
    }
  });
}

async function createEvaluatorAgentCall(input: {
  suffix: string;
  packet: ActivityMisconceptionEvidencePacketV1;
}) {
  return prisma.agentCall.create({
    data: {
      agent_name: "formative_activity_response_evaluator_agent",
      agent_version: "formative-activity-response-evaluator-v1",
      model_name: "synthetic-live-shaped-activity-response-evaluator",
      provider: "openai",
      provider_request_id: `req_${SMOKE_PREFIX}_evaluator_${input.suffix}`,
      provider_response_id: `resp_${SMOKE_PREFIX}_evaluator_${input.suffix}`,
      client_request_id: `client_${SMOKE_PREFIX}_evaluator_${input.suffix}`,
      prompt_version: "formative-activity-response-evaluator-prompt-v6",
      schema_version: "formative-activity-response-evaluation-v1",
      input_payload: { smoke: true, redacted: true },
      raw_output: { smoke: true, redacted: true },
      output_payload: input.packet as unknown as Prisma.InputJsonValue,
      output_validated: true,
      live_call_allowed: true,
      call_status: "succeeded",
      input_tokens: 21,
      output_tokens: 34,
      total_tokens: 55,
      token_usage: { input_tokens: 21, output_tokens: 34, total_tokens: 55 },
      started_at: new Date(),
      completed_at: new Date()
    }
  });
}

function makeEvaluator(input: {
  base_packets: ActivityMisconceptionEvidencePacketV1[];
  status: MisconceptionUpdateStatus;
  suffix: string;
  unsafe_feedback?: boolean;
}) {
  return async (
    evaluationInput: ActivityMisconceptionEvidenceLiveEvaluationInput
  ): Promise<ActivityMisconceptionEvidenceLiveExecutionResult> => {
    const basePacket = packetByStatus(input.base_packets, input.status);
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
      },
      ...(input.unsafe_feedback
        ? {
            student_safe_feedback: {
              ...basePacket.student_safe_feedback,
              message: "The answer key says A is correct."
            }
          }
        : {})
    });
    const call = await createEvaluatorAgentCall({
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

async function cleanup() {
  const attempts = await prisma.activityRuntimeAttempt.findMany({
    where: { activity_attempt_public_id: { startsWith: SMOKE_PREFIX } },
    select: { activity_attempt_public_id: true }
  });
  const attemptIds = attempts.map((attempt) => attempt.activity_attempt_public_id);
  const records = await prisma.activityMisconceptionEvidenceRecord.findMany({
    where: { activity_attempt_id: { in: attemptIds } },
    select: { id: true }
  });
  await prisma.postActivityDiagnosticSnapshot.deleteMany({
    where: { evidence_record_db_id: { in: records.map((record) => record.id) } }
  });
  await prisma.activityMisconceptionEvidenceRecord.deleteMany({
    where: { activity_attempt_id: { in: attemptIds } }
  });
  await prisma.activityRuntimeAttempt.deleteMany({
    where: { activity_attempt_public_id: { startsWith: SMOKE_PREFIX } }
  });
  await prisma.agentCall.deleteMany({
    where: {
      OR: [
        { client_request_id: { startsWith: `client_${SMOKE_PREFIX}_activity_` } },
        { client_request_id: { startsWith: `client_${SMOKE_PREFIX}_evaluator_` } }
      ]
    }
  });
}

async function createAttempt(input: {
  suffix: string;
  packet?: FormativeActivityPacketV1;
}) {
  const packet = input.packet ?? liveActivityPacket({ suffix: input.suffix });
  const sourceCall = await createSourceActivityAgentCall(input.suffix);
  return createActivityRuntimeAttemptFromLiveActivityPacket({
    activity_packet: packet,
    activity_attempt_public_id: `${SMOKE_PREFIX}_${input.suffix}`,
    first_turn_agent_call_db_id: sourceCall.id,
    limitations: ["synthetic_no_live_runtime_loop_smoke"]
  });
}

async function submitAndAssert(input: {
  suffix: string;
  status: MisconceptionUpdateStatus;
  expectedRecommendation: ActivityRuntimeRecommendation;
  basePackets: ActivityMisconceptionEvidencePacketV1[];
  choiceState?: "continue" | "choose_another_activity" | "move_on";
}) {
  const attempt = await createAttempt({ suffix: input.suffix });
  const result = await submitStudentActivityResponseForEvidenceUpdate({
    activity_attempt_public_id: attempt.activity_attempt_public_id,
    session_public_id: attempt.session_public_id,
    student_response_text: input.choiceState === "move_on"
      ? "I want to move on."
      : input.choiceState === "choose_another_activity"
        ? "I would like a different activity."
        : "I can explain that the learner estimate is separate from the item features.",
    student_choice_state: input.choiceState ?? "continue",
    evaluator_override: makeEvaluator({
      base_packets: input.basePackets,
      status: input.status,
      suffix: input.suffix
    })
  });
  assert(result.status === "ok", `${input.suffix}: runtime loop should succeed.`);
  assert(
    result.next_runtime_recommendation === input.expectedRecommendation,
    `${input.suffix}: expected ${input.expectedRecommendation}, got ${result.next_runtime_recommendation}.`
  );
  assert(result.evidence_record_public_id, `${input.suffix}: evidence record should be created.`);
  assert(result.post_activity_snapshot_public_id, `${input.suffix}: snapshot should be created.`);
  return result;
}

async function main() {
  await cleanup();
  const profileCountBefore = await prisma.studentProfile.count();
  const responsePackageCountBefore = await prisma.responsePackage.count();
  const fixtures = activityMisconceptionEvidenceFixtureCases();
  const noLivePackets = fixtures.map((fixture) => buildNoLiveActivityMisconceptionEvidenceFixture(fixture));

  const initialAttempt = await createAttempt({ suffix: "valid_awaiting" });
  assert(
    initialAttempt.status === "awaiting_student_activity_response",
    "Valid live-shaped activity attempt should enter awaiting response."
  );

  const accepted = await submitStudentActivityResponseForEvidenceUpdate({
    activity_attempt_public_id: initialAttempt.activity_attempt_public_id,
    session_public_id: initialAttempt.session_public_id,
    student_response_text: "The learner estimate and item features are not the same thing.",
    student_choice_state: "continue",
    evaluator_override: makeEvaluator({
      base_packets: noLivePackets,
      status: "conceptual_entry_improved",
      suffix: "valid_awaiting"
    })
  });
  assert(accepted.status === "ok", "Student response should be accepted and evaluated.");
  const acceptedAttempt = await prisma.activityRuntimeAttempt.findUnique({
    where: { id: initialAttempt.id },
    select: { latest_activity_response_reference: true }
  });
  assert(
    acceptedAttempt?.latest_activity_response_reference,
    "Student activity response should be safely referenced on the attempt."
  );

  const deterministicPacket = buildFormativeActivityDesignPacketFromPackets(
    (() => {
      const source = buildSyntheticActivitySourcePackets({
      pattern: "likely_knowledge_gap",
      primary_value: "diagnostic_clarification",
      session_public_id: `sess_${SMOKE_PREFIX}_deterministic`
      });
      return {
        profile_integration_packet: source.profile,
        formative_value_packet: source.formative
      };
    })()
  );
  const sourceCall = await createSourceActivityAgentCall("deterministic_rejected");
  let deterministicRejected = false;
  try {
    await createActivityRuntimeAttemptFromLiveActivityPacket({
      activity_packet: deterministicPacket,
      activity_attempt_public_id: `${SMOKE_PREFIX}_deterministic_rejected`,
      first_turn_agent_call_db_id: sourceCall.id
    });
  } catch (error) {
    deterministicRejected = error instanceof Error &&
      /formative_activity_runtime_rejected/.test(error.message);
  }
  assert(deterministicRejected, "Deterministic review activity must be rejected by runtime attempt creation.");

  const reviewOnlyPacket = FormativeActivityPacketV1Schema.parse({
    ...liveActivityPacket({ suffix: "review_only" }),
    review_only: true
  });
  let reviewOnlyRejected = false;
  try {
    await createActivityRuntimeAttemptFromLiveActivityPacket({
      activity_packet: reviewOnlyPacket,
      activity_attempt_public_id: `${SMOKE_PREFIX}_review_only_rejected`,
      first_turn_agent_call_db_id: sourceCall.id
    });
  } catch (error) {
    reviewOnlyRejected = error instanceof Error &&
      /formative_activity_runtime_rejected_review_only_packet/.test(error.message);
  }
  assert(reviewOnlyRejected, "Review-only activity must be rejected.");

  let missingSourceRejected = false;
  try {
    await createActivityRuntimeAttemptFromLiveActivityPacket({
      activity_packet: liveActivityPacket({ suffix: "missing_source" }),
      activity_attempt_public_id: `${SMOKE_PREFIX}_missing_source_rejected`,
      first_turn_agent_call_db_id: "00000000-0000-0000-0000-000000000000"
    });
  } catch (error) {
    missingSourceRejected = error instanceof Error &&
      /activity_runtime_source_activity_agent_call_not_found/.test(error.message);
  }
  assert(missingSourceRejected, "Missing source activity agent call must be rejected.");

  const unsafeAttempt = await createAttempt({ suffix: "unsafe_feedback" });
  const unsafe = await submitStudentActivityResponseForEvidenceUpdate({
    activity_attempt_public_id: unsafeAttempt.activity_attempt_public_id,
    session_public_id: unsafeAttempt.session_public_id,
    student_response_text: "I can explain the boundary.",
    student_choice_state: "continue",
    evaluator_override: makeEvaluator({
      base_packets: noLivePackets,
      status: "misconception_weakened",
      suffix: "unsafe_feedback",
      unsafe_feedback: true
    })
  });
  assert(unsafe.status === "failed_closed", "Unsafe student-safe feedback must fail closed.");

  await submitAndAssert({
    suffix: "move_on",
    status: "student_chose_move_on",
    expectedRecommendation: "move_on",
    basePackets: noLivePackets,
    choiceState: "move_on"
  });
  await submitAndAssert({
    suffix: "choose_other",
    status: "student_requested_alternative_activity",
    expectedRecommendation: "choose_alternative_activity",
    basePackets: noLivePackets,
    choiceState: "choose_another_activity"
  });
  await submitAndAssert({
    suffix: "conceptual_improved",
    status: "conceptual_entry_improved",
    expectedRecommendation: "continue_distractor_misconception_probe",
    basePackets: noLivePackets
  });
  await submitAndAssert({
    suffix: "misconception_weakened",
    status: "misconception_weakened",
    expectedRecommendation: "continue_reasoning_boundary_repair",
    basePackets: noLivePackets
  });
  await submitAndAssert({
    suffix: "no_actionable",
    status: "no_actionable_misconception_evidence",
    expectedRecommendation: "move_on",
    basePackets: noLivePackets
  });
  await submitAndAssert({
    suffix: "insufficient",
    status: "insufficient_new_evidence",
    expectedRecommendation: "retry_or_choose_or_move_on",
    basePackets: noLivePackets
  });

  const review = await writeActivityRuntimeLoopReview({
    session_public_id: initialAttempt.session_public_id
  });
  assert(review.runtime_attempt_count >= 1, "Runtime loop review should find attempts.");
  assert(review.evidence_record_count >= 1, "Runtime loop review should find evidence records.");
  assert(review.snapshot_count >= 1, "Runtime loop review should find snapshots.");
  const reviewArtifact = JSON.parse(await readFile(review.artifact_path, "utf8")) as unknown;
  const serializedArtifact = JSON.stringify(reviewArtifact);
  assert(
    !/answer key|correct option|raw provider output|raw prompt|api key|authorization header|bearer token|session secret|database url|mis_[a-z0-9_]+/i.test(serializedArtifact),
    "Runtime loop review artifact must remain redacted."
  );

  assert(await prisma.studentProfile.count() === profileCountBefore, "Runtime loop must not overwrite operational profiles.");
  assert(
    await prisma.responsePackage.count() === responsePackageCountBefore,
    "Runtime loop must not mutate response packages."
  );

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call_made: true,
    runtime_attempts_created: await prisma.activityRuntimeAttempt.count({
      where: { activity_attempt_public_id: { startsWith: SMOKE_PREFIX } }
    }),
    review_artifact_path: review.artifact_path,
    operational_profile_unchanged: true,
    response_package_count_unchanged: true
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
