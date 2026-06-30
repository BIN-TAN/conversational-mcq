import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  completeInitialConceptUnitAdministration,
  getStudentSessionState,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession,
  submitFormativeActivityResponse,
  submitRevisionResponse
} from "../src/lib/services/student-assessment/service";
import {
  canonicalizeStudentFacingLearningStatus,
  withChatNativeFormativeProviderForTest,
  type ChatNativeFormativeActivityEvaluationOutput,
  type ChatNativeFormativeProfileOutput
} from "../src/lib/services/student-assessment/formative-profile";
import {
  FORMATIVE_LOOP_GUARD_MESSAGE,
  getFormativeLoopGuardDecision,
  stopFollowupForFormativeLoopGuard
} from "../src/lib/services/student-assessment/formative-loop-guard";
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

function targetedOutputForAction(
  nextAction: ChatNativeFormativeActivityEvaluationOutput["formative_activity_evaluation"]["next_action"]
): ChatNativeFormativeActivityEvaluationOutput {
  const ready = nextAction === "confirm_and_next_choice" || nextAction === "offer_transfer";

  return {
    learning_profile: {
      ...validTargetedOutput.learning_profile,
      concept_mastery: ready ? "strong" : "partial",
      transfer_readiness: ready ? "ready" : "not_ready"
    },
    engagement_profile: validTargetedOutput.engagement_profile,
    formative_activity_evaluation: {
      ...validTargetedOutput.formative_activity_evaluation,
      next_action: nextAction,
      student_facing_feedback:
        nextAction === "confirm_and_next_choice"
          ? "That revision now separates the person estimate from item features clearly enough to choose your next step."
          : "You are moving toward the distinction. Add one clearer sentence about which part belongs to the item.",
      student_facing_next_prompt:
        nextAction === "provide_scaffold"
          ? "Try one sentence using this frame: theta describes the person, while item parameters describe the item."
          : nextAction === "ask_revision"
            ? "Revise one more sentence to explain why theta can stay comparable across linked forms."
            : "Choose whether to move on or try another question on the same idea."
    }
  };
}

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
      profile:
        | "valid"
        | "invalid"
        | "canonicalizable"
        | "internal_label"
        | "protected_content"
        | "multiple_statuses"
        | "long_text";
      targeted?: "valid" | "invalid" | "heading" | "iterative" | "endless_revision";
    }
  ) {}

  private targetedCallCount = 0;

  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    const isProfile = request.agent_name === "formative_value_and_planning_agent";
    const mode = isProfile ? this.outputs.profile : this.outputs.targeted ?? "valid";
    const parsedOutput = (() => {
      if (mode === "valid") {
        return isProfile ? validProfileOutput : validTargetedOutput;
      }

      if (mode === "canonicalizable" && isProfile) {
        return {
          provisional_learning_profile:
            "Still developing: You are separating person estimates from item features, but the contrast needs clearer wording.",
          main_issue:
            "Needs attention: make the item-versus-person distinction explicit.",
          formative_need: "diagnostic feedback",
          matched_activity: "distractor contrast",
          evidence_used: [
            "Three protected initial item responses",
            "Reasoning text",
            "Confidence evidence"
          ],
          confidence_calibration_flag: false,
          answer_reasoning_alignment:
            "The answer choices and reasoning are partly aligned.",
          student_facing_profile_statement:
            "Still developing: you have part of the theta idea in place.",
          student_facing_next_prompt:
            "Explain which value describes the person and which describes the item.",
          should_reveal_correct_answer: false,
          next_expected_action: "respond to activity",
          student_facing_learning_profile: {
            status: "Developing"
          }
        };
      }

      if (mode === "internal_label" && isProfile) {
        return {
          ...validProfileOutput,
          student_facing_pattern_statement:
            "Your response profile shows a formative_need label that should never be shown."
        };
      }

      if (mode === "protected_content" && isProfile) {
        return {
          ...validProfileOutput,
          student_facing_pattern_statement:
            "The correct option and distractor rationale should stay hidden from you."
        };
      }

      if (mode === "multiple_statuses" && isProfile) {
        return {
          ...validProfileOutput,
          student_facing_pattern_statement:
            "Mostly understood and Still developing are both visible profile statuses here."
        };
      }

      if (mode === "long_text" && isProfile) {
        return {
          ...validProfileOutput,
          main_issue:
            "separate theta as a person estimate from item features with concise wording ".repeat(7),
          student_facing_pattern_statement:
            "Detailed starting point ".repeat(14).trim(),
          student_facing_followup_prompt:
            "Explain this distinction carefully ".repeat(18).trim()
        };
      }

      if (mode === "heading" && !isProfile) {
        return {
          ...validTargetedOutput,
          formative_activity_evaluation: {
            ...validTargetedOutput.formative_activity_evaluation,
            student_facing_feedback:
              "What you did well: you named theta, but this visible heading should be removed."
          }
        };
      }

      if (mode === "iterative" && !isProfile) {
        this.targetedCallCount += 1;
        return targetedOutputForAction(
          this.targetedCallCount === 1
            ? "provide_scaffold"
            : this.targetedCallCount === 2
              ? "ask_revision"
              : "confirm_and_next_choice"
        );
      }

      if (mode === "endless_revision" && !isProfile) {
        this.targetedCallCount += 1;
        return targetedOutputForAction(this.targetedCallCount === 1 ? "provide_scaffold" : "ask_revision");
      }

      return isProfile
        ? {
            provisional_learning_state: "Missing required fields in this synthetic invalid output."
          }
        : {
            learning_profile: {
              concept_mastery: "partial"
            }
          };
    })();

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

function validationRuleCodes(value: string | null) {
  if (!value) {
    return [] as string[];
  }

  const parsed = JSON.parse(value) as {
    issues?: Array<{ rule_code?: string; code?: string }>;
  };

  return (parsed.issues ?? [])
    .map((issue) => issue.rule_code ?? issue.code)
    .filter((ruleCode): ruleCode is string => Boolean(ruleCode));
}

function validationFieldPaths(value: string | null) {
  if (!value) {
    return [] as string[];
  }

  const parsed = JSON.parse(value) as {
    issues?: Array<{ field_path?: string; path?: string }>;
  };

  return (parsed.issues ?? [])
    .map((issue) => issue.field_path ?? issue.path)
    .filter((fieldPath): fieldPath is string => Boolean(fieldPath));
}

async function assertInvalidProfileModeBlocks(input: {
  mode: "internal_label" | "protected_content" | "multiple_statuses" | "long_text";
  expectedRuleCode: string;
  expectedFieldPath: string;
}) {
  const prefix = `formative_${input.mode}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const { student, sessionPublicIds, started, state } = await createPackageReviewSession(prefix);

  try {
    const errorMessage = await withTemporaryEnv(simulatedLiveRuntimeEnv(), async () =>
      withChatNativeFormativeProviderForTest(
        new SyntheticFormativeProvider({ profile: input.mode }),
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

          throw new Error(`${input.mode} profile output should block completion.`);
        }
      )
    );
    assert(errorMessage === tutorUnavailableMessage, `${input.mode}: invalid live profile should return safe unavailable message.`);

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true }
    });
    const invalidCall = await prisma.agentCall.findFirstOrThrow({
      where: {
        assessment_session_db_id: session.id,
        agent_name: "formative_value_and_planning_agent"
      },
      select: {
        call_status: true,
        output_validated: true,
        validation_error: true
      }
    });
    assert(invalidCall.call_status === "invalid_output", `${input.mode}: should be audited as invalid_output.`);
    assert(invalidCall.output_validated === false, `${input.mode}: should not validate.`);
    const ruleCodes = validationRuleCodes(invalidCall.validation_error);
    const fieldPaths = validationFieldPaths(invalidCall.validation_error);
    assert(
      ruleCodes.includes(input.expectedRuleCode),
      `${input.mode}: expected rule code ${input.expectedRuleCode}; got ${ruleCodes.join(", ")}.`
    );
    assert(
      fieldPaths.includes(input.expectedFieldPath),
      `${input.mode}: expected field path ${input.expectedFieldPath}; got ${fieldPaths.join(", ")}.`
    );
    assert(
      !(invalidCall.validation_error ?? "").includes("response profile shows"),
      `${input.mode}: validation diagnostics should not store raw blocked student-facing text.`
    );
  } finally {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: student.id,
      sessionPublicIds
    });
  }
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

async function assertCanonicalizableProfileLabelsValidate() {
  const prefix = `formative_canonical_profile_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const { student, sessionPublicIds, started, state } = await createPackageReviewSession(prefix);

  try {
    const completed = await withTemporaryEnv(simulatedLiveRuntimeEnv(), async () =>
      withChatNativeFormativeProviderForTest(
        new SyntheticFormativeProvider({ profile: "canonicalizable", targeted: "valid" }),
        async () => completeInitialConceptUnitAdministration({
          student_user_db_id: student.id,
          session_public_id: started.session.session_public_id,
          concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
        })
      )
    );
    assert(completed.state.assessment_state === "FORMATIVE_ACTIVITY", "Canonicalized live profile should show activity.");
    assert(completed.state.learning_profile, "Canonicalized live profile should produce one student-facing status.");
    assert(
      ["Mostly understood", "Still developing", "Needs more work"].includes(completed.state.learning_profile.status),
      "Student-facing learning profile should use one approved status."
    );

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true }
    });
    const profileCall = await prisma.agentCall.findFirstOrThrow({
      where: {
        assessment_session_db_id: session.id,
        agent_name: "formative_value_and_planning_agent"
      },
      select: {
        call_status: true,
        output_validated: true,
        output_payload: true
      }
    });
    assert(profileCall.call_status === "succeeded", "Canonicalizable profile should be audited as succeeded.");
    assert(profileCall.output_validated === true, "Canonicalizable profile should validate.");
    const payload = profileCall.output_payload as Record<string, unknown>;
    assert(payload.provisional_learning_state !== undefined, "Profile alias should map to provisional_learning_state.");
    assert(payload.formative_need === "diagnosis_and_feedback", "Diagnostic feedback should canonicalize.");
    assert(payload.matched_activity === "key_distractor_contrast", "Distractor contrast should canonicalize.");
    assert(payload.next_expected_action === "respond_to_formative_activity", "Next action should canonicalize.");
    assert(
      typeof payload.student_facing_pattern_statement === "string" &&
        !/^Still developing:/i.test(payload.student_facing_pattern_statement),
      "Visible heading prefix should be removed from the persisted student-facing pattern."
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

async function assertRigidTargetedFeedbackHeadingSanitizes() {
  const prefix = `formative_heading_targeted_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const { student, sessionPublicIds, started, state } = await createPackageReviewSession(prefix);

  try {
    await withTemporaryEnv(simulatedLiveRuntimeEnv(), async () =>
      withChatNativeFormativeProviderForTest(
        new SyntheticFormativeProvider({ profile: "valid", targeted: "heading" }),
        async () => {
          const completed = await completeInitialConceptUnitAdministration({
            student_user_db_id: student.id,
            session_public_id: started.session.session_public_id,
            concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
          });
          assert(completed.state.assessment_state === "FORMATIVE_ACTIVITY", "Valid profile should show activity before heading block.");

          const feedback = await submitFormativeActivityResponse({
            student_user_db_id: student.id,
            session_public_id: started.session.session_public_id,
            message: "Theta describes the person, while item difficulty describes the item.",
            client_message_id: `${prefix}_activity_response`
          });
          assert(
            feedback.state.assessment_state === "REVISION",
            "Harmless targeted feedback heading should sanitize and proceed."
          );
        }
      )
    );

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true }
    });
    const invalidCall = await prisma.agentCall.findFirstOrThrow({
      where: {
        assessment_session_db_id: session.id,
        agent_name: "followup_agent",
        schema_version: "chat-native-formative-activity-evaluation-output-v1"
      },
      select: {
        call_status: true,
        output_validated: true,
        validation_error: true,
        output_payload: true
      }
    });
    assert(invalidCall.call_status === "succeeded", "Sanitized heading targeted feedback should succeed.");
    assert(invalidCall.output_validated === true, "Sanitized heading targeted feedback should validate.");
    assert(invalidCall.validation_error === null, "Sanitized heading targeted feedback should not store a validation error.");
    const payload = invalidCall.output_payload as {
      formative_activity_evaluation?: { student_facing_feedback?: string };
    };
    assert(
      typeof payload.formative_activity_evaluation?.student_facing_feedback === "string" &&
        !/^What you did well:/i.test(payload.formative_activity_evaluation.student_facing_feedback),
      "Sanitized targeted feedback should remove the visible heading prefix."
    );
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

async function assertIterativeFormativeLoopReachesNextChoice() {
  const prefix = `formative_iterative_loop_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const { student, sessionPublicIds, started, state } = await createPackageReviewSession(prefix);

  try {
    await withTemporaryEnv(simulatedLiveRuntimeEnv(), async () =>
      withChatNativeFormativeProviderForTest(
        new SyntheticFormativeProvider({ profile: "valid", targeted: "iterative" }),
        async () => {
          const completed = await completeInitialConceptUnitAdministration({
            student_user_db_id: student.id,
            session_public_id: started.session.session_public_id,
            concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
          });
          assert(completed.state.assessment_state === "FORMATIVE_ACTIVITY", "Valid profile should show activity.");

          const activity = await submitFormativeActivityResponse({
            student_user_db_id: student.id,
            session_public_id: started.session.session_public_id,
            message: "Theta describes the person, while item difficulty describes the item.",
            client_message_id: `${prefix}_activity_response`
          });
          assert(
            activity.state.assessment_state === "REVISION",
            "First iterative targeted output should request a scaffold/revision."
          );

          const firstRevision = await submitRevisionResponse({
            student_user_db_id: student.id,
            session_public_id: started.session.session_public_id,
            message:
              "Theta is the person estimate; item parameters describe item behavior.",
            client_message_id: `${prefix}_revision_1`
          });
          assert(
            firstRevision.state.assessment_state === "REVISION" ||
              firstRevision.state.assessment_state === "FOLLOWUP_RESPONSE",
            "Second iterative targeted output should keep the formative loop open."
          );

          const secondRevision = await submitRevisionResponse({
            student_user_db_id: student.id,
            session_public_id: started.session.session_public_id,
            message:
              "Theta stays on the linked person scale, while item difficulty and discrimination describe how each item functions.",
            client_message_id: `${prefix}_revision_2`
          });
          assert(
            secondRevision.state.assessment_state === "NEXT_CHOICE",
            "Third iterative targeted output should reach next choice."
          );
        }
      )
    );

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true }
    });
    const targetedCalls = await prisma.agentCall.findMany({
      where: {
        assessment_session_db_id: session.id,
        agent_name: "followup_agent",
        schema_version: "chat-native-formative-activity-evaluation-output-v1"
      },
      select: {
        call_status: true,
        output_validated: true
      }
    });
    assert(targetedCalls.length === 3, "Iterative loop should create three targeted-feedback evaluations.");
    assert(
      targetedCalls.every((call) => call.call_status === "succeeded" && call.output_validated),
      "Every iterative targeted-feedback call should validate."
    );
  } finally {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: student.id,
      sessionPublicIds
    });
  }
}

async function assertFormativeLoopGuardStopsEndlessRevision() {
  const prefix = `formative_loop_guard_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const { student, sessionPublicIds, started, state } = await createPackageReviewSession(prefix);

  try {
    await withTemporaryEnv(simulatedLiveRuntimeEnv(), async () =>
      withChatNativeFormativeProviderForTest(
        new SyntheticFormativeProvider({ profile: "valid", targeted: "endless_revision" }),
        async () => {
          const completed = await completeInitialConceptUnitAdministration({
            student_user_db_id: student.id,
            session_public_id: started.session.session_public_id,
            concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
          });
          assert(completed.state.assessment_state === "FORMATIVE_ACTIVITY", "Valid profile should show activity.");

          const activity = await submitFormativeActivityResponse({
            student_user_db_id: student.id,
            session_public_id: started.session.session_public_id,
            message: "Theta describes the person, while item parameters describe the item.",
            client_message_id: `${prefix}_activity_response`
          });
          assert(activity.state.assessment_state === "REVISION", "Endless provider should first request revision.");

          let current = activity.state;

          for (const index of [1, 2, 3, 4]) {
            const revision = await submitRevisionResponse({
              student_user_db_id: student.id,
              session_public_id: started.session.session_public_id,
              message: `Revision ${index}: theta is the person estimate and item parameters describe item behavior.`,
              client_message_id: `${prefix}_revision_${index}`
            });
            current = revision.state;
          }

          assert(current.assessment_state === "NEXT_CHOICE", "Loop guard should transition to next choice.");
          assert(current.next_step === "followup_stopped", "Loop guard should use the stopped follow-up step.");
          assert(current.followup?.status === "stopped", "Loop guard should stop the active follow-up round.");
        }
      )
    );

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true, current_phase: true }
    });
    const events = await prisma.processEvent.findMany({
      where: {
        assessment_session_db_id: session.id,
        event_type: { in: ["formative_loop_guard_triggered", "formative_loop_terminal_choice_shown"] }
      },
      select: { event_type: true, payload: true }
    });
    const guardEvent = events.find((event) => event.event_type === "formative_loop_guard_triggered");
    const terminalEvent = events.find((event) => event.event_type === "formative_loop_terminal_choice_shown");
    const guardPayload = guardEvent?.payload as Record<string, unknown> | undefined;
    const transcript = await prisma.conversationTurn.findMany({
      where: {
        assessment_session_db_id: session.id,
        agent_name: "chat_native_formative_loop_guard"
      },
      select: { message_text: true, structured_payload: true }
    });

    assert(session.current_phase === "followup_stopped", "Guarded session should persist stopped phase for resume.");
    assert(Boolean(guardEvent), "Loop guard should create formative_loop_guard_triggered.");
    assert(Boolean(terminalEvent), "Loop guard should create formative_loop_terminal_choice_shown.");
    assert(guardPayload?.reason_code === "max_formative_loop_turns", "Guard should report max-loop reason.");
    assert(guardPayload?.assessment_state_after === "NEXT_CHOICE", "Guard payload should report next-choice state.");
    assert(transcript.length === 1, "Guard should create one student-safe terminal message.");
    assert(
      transcript[0]?.message_text === FORMATIVE_LOOP_GUARD_MESSAGE,
      "Guard terminal message should use the approved student-facing copy."
    );
    assert(
      JSON.stringify(transcript).toLowerCase().includes("answer key") === false,
      "Guard transcript must not expose answer-key language."
    );
    assert(
      JSON.stringify(transcript).toLowerCase().includes("mastered") === false,
      "Guard should not automatically claim mastery."
    );
  } finally {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: student.id,
      sessionPublicIds
    });
  }
}

async function assertRepeatedFollowupGuardDecisionStopsRound() {
  const prefix = `repeated_followup_guard_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const { student, sessionPublicIds, started, state } = await createPackageReviewSession(prefix);

  try {
    const completed = await withTemporaryEnv(simulatedLiveRuntimeEnv(), async () =>
      withChatNativeFormativeProviderForTest(
        new SyntheticFormativeProvider({ profile: "valid", targeted: "valid" }),
        () =>
          completeInitialConceptUnitAdministration({
            student_user_db_id: student.id,
            session_public_id: started.session.session_public_id,
            concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
          })
      )
    );
    assert(completed.state.assessment_state === "FORMATIVE_ACTIVITY", "Fixture should show formative activity.");

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: started.session.session_public_id },
      select: { id: true, current_concept_unit_db_id: true }
    });
    const conceptUnitSession = await prisma.conceptUnitSession.findUniqueOrThrow({
      where: {
        assessment_session_db_id_concept_unit_db_id: {
          assessment_session_db_id: session.id,
          concept_unit_db_id: session.current_concept_unit_db_id ?? ""
        }
      },
      select: { id: true }
    });
    const round = await prisma.followupRound.findFirstOrThrow({
      where: { concept_unit_session_db_id: conceptUnitSession.id, status: "active" },
      orderBy: [{ round_index: "desc" }],
      select: { id: true }
    });

    await prisma.assessmentSession.update({
      where: { id: session.id },
      data: { current_phase: "followup_active" }
    });

    for (const index of [1, 2, 3]) {
      await prisma.conversationTurn.create({
        data: {
          assessment_session_db_id: session.id,
          concept_unit_session_db_id: conceptUnitSession.id,
          followup_round_db_id: round.id,
          phase: "followup_active",
          actor_type: "student",
          message_text: `Synthetic follow-up ${index}`,
          structured_payload: { client_message_id: `${prefix}_followup_${index}` }
        }
      });
    }

    const decision = await getFormativeLoopGuardDecision({ followup_round_db_id: round.id });
    assert(decision.triggered === true, "Repeated follow-up turns should trigger guard decision.");
    assert(decision.reason_code === "repeated_followup_limit", "Repeated follow-up guard should use repeated limit reason.");

    await stopFollowupForFormativeLoopGuard({
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      followup_round_db_id: round.id,
      stage: "followup_response",
      assessment_state_before: "FOLLOWUP_RESPONSE",
      reason_code: decision.reason_code,
      loop_turn_count: decision.loop_turn_count,
      repeated_followup_count: decision.repeated_followup_count,
      latest_agent_call_id: null
    });

    const stoppedState = await getStudentSessionState({
      student_user_db_id: student.id,
      session_public_id: started.session.session_public_id
    });

    assert(stoppedState.assessment_state === "NEXT_CHOICE", "Repeated follow-up guard should produce next-choice state.");
    assert(stoppedState.next_step === "followup_stopped", "Repeated follow-up guard should persist stopped next step.");
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
  await assertCanonicalizableProfileLabelsValidate();
  await assertInvalidProfileBlocks();
  await assertInvalidProfileModeBlocks({
    mode: "internal_label",
    expectedRuleCode: "internal_label_detected",
    expectedFieldPath: "student_facing_pattern_statement"
  });
  await assertInvalidProfileModeBlocks({
    mode: "protected_content",
    expectedRuleCode: "correctness_label_detected",
    expectedFieldPath: "student_facing_pattern_statement"
  });
  await assertInvalidProfileModeBlocks({
    mode: "multiple_statuses",
    expectedRuleCode: "multiple_profile_statuses_detected",
    expectedFieldPath: "student_learning_profile.status"
  });
  await assertInvalidProfileModeBlocks({
    mode: "long_text",
    expectedRuleCode: "unsafe_student_facing_text",
    expectedFieldPath: "student_facing_text"
  });
  assert(
    canonicalizeStudentFacingLearningStatus("Developing") === "Still developing",
    "Developing should canonicalize to Still developing."
  );
  assert(
    canonicalizeStudentFacingLearningStatus("Needs attention") === "Needs more work",
    "Needs attention should canonicalize to Needs more work."
  );
  await assertInvalidTargetedFeedbackBlocks();
  await assertRigidTargetedFeedbackHeadingSanitizes();
  await assertIterativeFormativeLoopReachesNextChoice();
  await assertFormativeLoopGuardStopsEndlessRevision();
  await assertRepeatedFollowupGuardDecisionStopsRound();

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
