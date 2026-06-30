import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  completeInitialConceptUnitAdministration,
  getStudentSessionState,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession,
  submitFormativeActivityResponse
} from "../src/lib/services/student-assessment/service";
import {
  withChatNativeFormativeProviderForTest,
  type ChatNativeFormativeActivityEvaluationOutput,
  type ChatNativeFormativeProfileOutput
} from "../src/lib/services/student-assessment/formative-profile";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import {
  assert,
  cleanupSmokeStudentSessions,
  completeInitialItem,
  createSmokeStudent
} from "./student-mvp-smoke-helpers";
import type {
  LlmProvider,
  StructuredAgentRequest,
  StructuredAgentResult
} from "../src/lib/llm/providers/types";

const prisma = new PrismaClient();

const tutorUnavailableMessage =
  "The assessment tutor is temporarily unavailable. Your progress is saved. Please try again in a moment or pause and return later.";

const validProfileOutput: ChatNativeFormativeProfileOutput = {
  provisional_learning_state:
    "You are starting to separate theta as a person estimate from item parameters.",
  main_issue:
    "The distinction between item difficulty and theta should be made more explicit.",
  formative_need: "diagnosis_and_feedback",
  matched_activity: "key_distractor_contrast",
  evidence_used: [
    "Three protected initial item responses",
    "Reasoning text",
    "Confidence and tempting-option evidence"
  ],
  confidence_calibration_flag: false,
  answer_reasoning_alignment:
    "The selected answers and reasoning are partly aligned, but the explanation needs a clearer contrast.",
  student_facing_pattern_statement:
    "You have part of the theta idea in place, and the item-versus-person distinction still needs sharpening.",
  student_facing_followup_prompt:
    "In one or two sentences, explain which value describes the person and which value describes the item.",
  should_reveal_correct_answer: false,
  next_expected_action: "respond_to_formative_activity"
};

const validTargetedOutput: ChatNativeFormativeActivityEvaluationOutput = {
  learning_profile: {
    concept_mastery: "partial",
    main_concept_understood: ["Theta describes the person location."],
    remaining_issue: ["The item-parameter contrast needs one clearer sentence."],
    misconception_evidence: [],
    reasoning_quality: "partially_correct",
    confidence_calibration: "unknown",
    transfer_readiness: "not_ready"
  },
  engagement_profile: {
    response_completeness: "complete",
    help_seeking: "none",
    revision_effort: "adequate",
    engagement_level: "active"
  },
  formative_activity_evaluation: {
    activity_was_appropriate: true,
    activity_fit_reason:
      "The activity targets the item-versus-person distinction shown in the initial package.",
    student_response_evaluation:
      "The response is partly correct and needs a more precise comparison.",
    next_action: "ask_revision",
    student_facing_feedback:
      "You have the person part started. Now make the contrast clearer: theta describes the person, while item difficulty or discrimination describes the item.",
    student_facing_next_prompt:
      "Revise in one or two sentences: why can theta stay comparable even when item parameters differ?"
  }
};

function withTemporaryEnv<T>(values: Record<string, string | undefined>, callback: () => Promise<T>) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );

  return (async () => {
    try {
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }

      return await callback();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  })();
}

function mockRuntimeEnv() {
  return {
    ITEM_ADMIN_TUTOR_MODE: "mock",
    ALLOW_LOCAL_MOCK_RUNTIME: "true",
    LLM_PROVIDER: "mock",
    LLM_LIVE_CALLS_ENABLED: "false",
    OPENAI_API_KEY: "",
    OPENAI_API_KEY_FILE: "",
    OPENAI_MODEL_ITEM_ADMIN: "",
    OPENAI_MODEL_PLANNING: "",
    OPENAI_MODEL_FOLLOWUP: "",
    NODE_ENV: "development"
  };
}

function simulatedLiveRuntimeEnv() {
  return {
    ITEM_ADMIN_TUTOR_MODE: "mock",
    ALLOW_LOCAL_MOCK_RUNTIME: "true",
    LLM_PROVIDER: "openai",
    LLM_LIVE_CALLS_ENABLED: "true",
    OPENAI_API_KEY: "sk-formative-live-validation-smoke-000000000000",
    OPENAI_API_KEY_FILE: "",
    OPENAI_MODEL_PLANNING: "synthetic-formative-profile-model",
    OPENAI_MODEL_FOLLOWUP: "synthetic-targeted-feedback-model",
    NODE_ENV: "development"
  };
}

class SyntheticFormativeProvider implements LlmProvider {
  constructor(
    private readonly outputs: {
      profile: "valid" | "invalid";
      targeted?: "valid" | "invalid";
    }
  ) {}

  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    const isProfile = request.agent_name === "formative_value_and_planning_agent";
    const mode = isProfile ? this.outputs.profile : this.outputs.targeted ?? "valid";
    const parsedOutput = mode === "valid"
      ? (isProfile ? validProfileOutput : validTargetedOutput)
      : (isProfile
          ? {
              provisional_learning_state: "Missing required fields in this synthetic invalid output."
            }
          : {
              learning_profile: {
                concept_mastery: "partial"
              }
            });

    return {
      provider: "openai",
      client_request_id: request.client_request_id,
      provider_request_id: `req_${randomUUID()}`,
      provider_response_id: `resp_${randomUUID()}`,
      status: "completed",
      parsed_output: parsedOutput as TOutput,
      raw_output: {
        id: `resp_${randomUUID()}`,
        status: "completed",
        output_parsed: parsedOutput,
        usage: {
          input_tokens: 11,
          output_tokens: 13,
          total_tokens: 24
        }
      },
      usage: {
        input_tokens: 11,
        output_tokens: 13,
        total_tokens: 24
      },
      latency_ms: 1
    };
  }
}

async function createPackageReviewSession(prefix: string) {
  const student = await createSmokeStudent({
    prisma,
    prefix,
    accessCode: `${prefix}_access`
  });
  const sessionPublicIds: string[] = [];

  const result = await withTemporaryEnv(mockRuntimeEnv(), async () => {
    const started = await startOrResumeStudentAssessmentSession({
      student_user_db_id: student.id,
      assessment_public_id: demoAssessmentPublicId
    });
    sessionPublicIds.push(started.session.session_public_id);

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
    assert(state.assessment_state === "PACKAGE_REVIEW", "Synthetic session should reach package review.");

    return { started, state };
  });

  return { student, sessionPublicIds, ...result };
}

async function assertInvalidProfileBlocks() {
  const prefix = `formative_invalid_profile_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const { student, sessionPublicIds, started, state } = await createPackageReviewSession(prefix);

  try {
    const errorMessage = await withTemporaryEnv(simulatedLiveRuntimeEnv(), async () =>
      withChatNativeFormativeProviderForTest(
        new SyntheticFormativeProvider({ profile: "invalid" }),
        async () => {
          try {
            await completeInitialConceptUnitAdministration({
              student_user_db_id: student.id,
              session_public_id: started.session.session_public_id,
              concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
            });
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }

          throw new Error("Invalid live formative profile output should block completion.");
        }
      )
    );
    assert(errorMessage === tutorUnavailableMessage, "Invalid live profile should return the safe unavailable message.");

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true, current_phase: true }
    });
    assert(session.current_phase === "profiling_pending", "Invalid live profile should leave session in profiling_pending.");

    const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
      where: { assessment_session_db_id: session.id },
      select: { id: true }
    });
    const [profileCount, decisionCount, roundCount, blockedEvents, invalidCall] = await Promise.all([
      prisma.studentProfile.count({ where: { concept_unit_session_db_id: conceptUnitSession.id } }),
      prisma.formativeDecision.count({ where: { concept_unit_session_db_id: conceptUnitSession.id } }),
      prisma.followupRound.count({ where: { concept_unit_session_db_id: conceptUnitSession.id } }),
      prisma.processEvent.count({
        where: {
          assessment_session_db_id: session.id,
          event_type: "llm_runtime_blocked"
        }
      }),
      prisma.agentCall.findFirstOrThrow({
        where: {
          assessment_session_db_id: session.id,
          agent_name: "formative_value_and_planning_agent"
        },
        select: {
          call_status: true,
          output_validated: true,
          output_payload: true,
          validation_error: true,
          token_usage: true,
          provider_request_id: true,
          provider_response_id: true
        }
      })
    ]);

    assert(profileCount === 0, "Invalid live profile must not create a student profile.");
    assert(decisionCount === 0, "Invalid live profile must not create a formative decision.");
    assert(roundCount === 0, "Invalid live profile must not create a follow-up round.");
    assert(blockedEvents > 0, "Invalid live profile should log llm_runtime_blocked.");
    assert(invalidCall.call_status === "invalid_output", "Invalid live profile call should be audited as invalid_output.");
    assert(invalidCall.output_validated === false, "Invalid live profile call should not be validated.");
    assert(invalidCall.output_payload === null, "Invalid live profile call should not store deterministic profile payload.");
    assert(Boolean(invalidCall.validation_error), "Invalid live profile should store validation diagnostics.");
    assert(Boolean(invalidCall.token_usage), "Invalid live profile should preserve token usage when provider returns it.");
    assert(
      Boolean(invalidCall.provider_request_id || invalidCall.provider_response_id),
      "Invalid live profile should preserve provider metadata when available."
    );
  } finally {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: student.id,
      sessionPublicIds
    });
  }
}

async function assertValidProfileAndTargetedFeedbackSucceed() {
  const prefix = `formative_valid_live_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const { student, sessionPublicIds, started, state } = await createPackageReviewSession(prefix);

  try {
    await withTemporaryEnv(simulatedLiveRuntimeEnv(), async () =>
      withChatNativeFormativeProviderForTest(
        new SyntheticFormativeProvider({ profile: "valid", targeted: "valid" }),
        async () => {
          const completed = await completeInitialConceptUnitAdministration({
            student_user_db_id: student.id,
            session_public_id: started.session.session_public_id,
            concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
          });
          assert(completed.state.assessment_state === "FORMATIVE_ACTIVITY", "Valid live profile should show activity.");

          const response = await submitFormativeActivityResponse({
            student_user_db_id: student.id,
            session_public_id: started.session.session_public_id,
            message: "Theta describes the person, while item difficulty describes the item.",
            client_message_id: `${prefix}_activity_response`
          });
          assert(response.targeted_feedback_available === true, "Valid targeted feedback should be available.");
          assert(response.state.assessment_state === "REVISION", "Valid targeted feedback should request revision.");
        }
      )
    );

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true }
    });
    const calls = await prisma.agentCall.findMany({
      where: { assessment_session_db_id: session.id },
      select: {
        agent_name: true,
        call_status: true,
        output_validated: true,
        provider: true,
        token_usage: true,
        provider_request_id: true,
        provider_response_id: true
      },
      orderBy: [{ created_at: "asc" }]
    });
    const liveCalls = calls.filter((call) => call.provider === "openai");
    assert(liveCalls.length >= 2, "Valid simulated live path should audit profile and targeted feedback calls.");
    for (const call of liveCalls) {
      assert(call.call_status === "succeeded", `${call.agent_name} should succeed.`);
      assert(call.output_validated === true, `${call.agent_name} should validate.`);
      assert(Boolean(call.token_usage), `${call.agent_name} should persist token usage.`);
      assert(
        Boolean(call.provider_request_id || call.provider_response_id),
        `${call.agent_name} should persist provider metadata.`
      );
    }
  } finally {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: student.id,
      sessionPublicIds
    });
  }
}

async function assertInvalidTargetedFeedbackBlocks() {
  const prefix = `formative_invalid_targeted_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const { student, sessionPublicIds, started, state } = await createPackageReviewSession(prefix);

  try {
    await withTemporaryEnv(simulatedLiveRuntimeEnv(), async () =>
      withChatNativeFormativeProviderForTest(
        new SyntheticFormativeProvider({ profile: "valid", targeted: "invalid" }),
        async () => {
          const completed = await completeInitialConceptUnitAdministration({
            student_user_db_id: student.id,
            session_public_id: started.session.session_public_id,
            concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
          });
          assert(completed.state.assessment_state === "FORMATIVE_ACTIVITY", "Valid profile should show activity before targeted block.");

          try {
            await submitFormativeActivityResponse({
              student_user_db_id: student.id,
              session_public_id: started.session.session_public_id,
              message: "Theta describes the person, while item difficulty describes the item.",
              client_message_id: `${prefix}_activity_response`
            });
          } catch (error) {
            assert(
              error instanceof Error && error.message === tutorUnavailableMessage,
              "Invalid targeted feedback should return the safe unavailable message."
            );
            return;
          }

          throw new Error("Invalid targeted feedback output should block progression.");
        }
      )
    );

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true, current_phase: true }
    });
    assert(session.current_phase === "planning_completed", "Invalid targeted feedback should keep formative activity phase open.");
    const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
      where: { assessment_session_db_id: session.id },
      select: { id: true }
    });
    const [updatedProfiles, blockedEvents, targetedTurns, invalidCall] = await Promise.all([
      prisma.studentProfile.count({
        where: {
          concept_unit_session_db_id: conceptUnitSession.id,
          profile_type: "updated"
        }
      }),
      prisma.processEvent.count({
        where: {
          assessment_session_db_id: session.id,
          event_type: "llm_runtime_blocked"
        }
      }),
      prisma.conversationTurn.count({
        where: {
          assessment_session_db_id: session.id,
          agent_name: "chat_native_targeted_feedback"
        }
      }),
      prisma.agentCall.findFirstOrThrow({
        where: {
          assessment_session_db_id: session.id,
          agent_name: "followup_agent",
          schema_version: "chat-native-formative-activity-evaluation-output-v1"
        },
        select: {
          call_status: true,
          output_validated: true,
          output_payload: true,
          validation_error: true
        }
      })
    ]);

    assert(updatedProfiles === 0, "Invalid targeted feedback must not create an updated profile.");
    assert(blockedEvents > 0, "Invalid targeted feedback should log llm_runtime_blocked.");
    assert(targetedTurns === 0, "Invalid targeted feedback must not create student-facing feedback turns.");
    assert(invalidCall.call_status === "invalid_output", "Invalid targeted feedback should be audited as invalid_output.");
    assert(invalidCall.output_validated === false, "Invalid targeted feedback should not validate.");
    assert(invalidCall.output_payload === null, "Invalid targeted feedback should not store fallback output payload.");
    assert(Boolean(invalidCall.validation_error), "Invalid targeted feedback should store validation diagnostics.");

    const currentState = await getStudentSessionState({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });
    assert(currentState.assessment_state === "FORMATIVE_ACTIVITY", "Student should remain at formative activity after block.");
  } finally {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: student.id,
      sessionPublicIds
    });
  }
}

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";
  await ensureDemoStudentAssessment(prisma);

  await assertValidProfileAndTargetedFeedbackSucceed();
  await assertInvalidProfileBlocks();
  await assertInvalidTargetedFeedbackBlocks();

  console.log("Student formative live-validation smoke passed. No OpenAI call was made.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
