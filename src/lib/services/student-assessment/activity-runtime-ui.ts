import { Prisma, type ActivityRuntimeAttempt } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logProcessEvent } from "@/lib/services/process-events";
import { toPrismaJson } from "@/lib/services/json";
import {
  ACTIVITY_RUNTIME_MAX_RESPONSE_CHARS,
  assertStudentActivityRuntimeProjectionIsSafe,
  studentActivityFocusLabel,
  studentActivityRecommendationLabel,
  type StudentActivityRuntimeProjection
} from "@/lib/student-assessment/activity-runtime-projection";
import {
  createActivityRuntimeAttemptFromLiveActivityPacket,
  submitStudentActivityResponseForEvidenceUpdate,
  type ActivityRuntimeLoopResult,
  type StudentActivityChoiceState
} from "@/lib/services/student-assessment/activity-runtime-loop";
import {
  executeLiveFormativeActivityDialogueAgent,
  type FormativeActivityLiveExecutionResult
} from "@/lib/services/student-assessment/formative-activity-live";
import {
  FORMATIVE_ACTIVITY_AGENT_NAME,
  FormativeActivityFamilySchema,
  FormativeActivityPacketV1Schema,
  type FormativeActivityFamily,
  type FormativeActivityPacketV1
} from "@/lib/services/student-assessment/formative-activity-design";
import {
  buildProfileIntegrationInterpretationPacketForSession,
  type ProfileIntegrationInterpretationPacketV1
} from "@/lib/services/student-assessment/profile-integration";
import {
  buildFormativeValueDeterminationPacketForSession,
  type FormativeValueDeterminationPacketV1
} from "@/lib/services/student-assessment/formative-value-determination";
import type {
  ActivityMisconceptionEvidenceLiveEvaluationInput,
  ActivityMisconceptionEvidenceLiveExecutionResult
} from "@/lib/services/student-assessment/activity-misconception-evidence-live";
import { StudentAssessmentServiceError } from "./errors";

type PrismaClientLike = typeof prisma;

const alternativeActivityLabels = [
  "Start from the basic idea",
  "Work through a tempting option",
  "Repair your explanation",
  "Explain it without the options"
];

const SourceActivityPacketRefSchema = z.object({
  schema_version: z.string().min(1),
  activity_packet_hash: z.string().min(1),
  activity_family: FormativeActivityFamilySchema,
  diagnostic_purpose: z.enum([
    "conceptual_entry_grounding",
    "distractor_misconception_probe",
    "reasoning_boundary_repair",
    "independent_misconception_verification"
  ]),
  selected_formative_value: z.enum([
    "diagnostic_clarification",
    "reasoning_refinement",
    "confidence_calibration",
    "independent_understanding_verification",
    "consolidation_and_transfer"
  ]),
  generation_source: z.enum(["deterministic_review", "live_llm", "evidence_integrated_router"]),
  runtime_servable_to_student: z.boolean(),
  review_only: z.boolean(),
  safe_activity_prompt: z.string().min(1),
  expected_student_action_prompt: z.string().min(1),
  distractor_role: z.string().min(1),
  distractor_student_safe_description: z.string().min(1)
}).passthrough();

const FeedbackSchema = z.object({
  message: z.string().min(1),
  next_options: z.array(z.enum([
    "continue",
    "choose another activity",
    "skip this activity and continue",
    "continue to transfer item",
    "continue to next concept",
    "finish assessment",
    "return to assessment summary",
    "move on"
  ])).min(1).max(3)
}).strict();

function normalizeRuntimeFeedback(feedback: z.infer<typeof FeedbackSchema>):
  StudentActivityRuntimeProjection["feedback"] {
  return {
    message: feedback.message
      .replace(/\bmove on\b/gi, "continue to the next step")
      .replace(/\bMove on\b/g, "Continue to the next step"),
    next_options: feedback.next_options.map((option) =>
      option === "move on" ? "skip this activity and continue" : option
    ) as NonNullable<StudentActivityRuntimeProjection["feedback"]>["next_options"]
  };
}

export type StudentActivityRuntimeGenerationOverride = (input: {
  profile_integration_packet: ProfileIntegrationInterpretationPacketV1;
  formative_value_packet: FormativeValueDeterminationPacketV1;
}) => Promise<FormativeActivityLiveExecutionResult>;

export type StudentActivityRuntimeEvaluatorOverride = (
  input: ActivityMisconceptionEvidenceLiveEvaluationInput
) => Promise<ActivityMisconceptionEvidenceLiveExecutionResult>;

function prismaJson(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

async function assertActiveStudentAccount(studentUserDbId: string, client: PrismaClientLike) {
  const user = await client.user.findUnique({
    where: { id: studentUserDbId },
    select: { role: true, account_status: true }
  });

  if (!user || user.role !== "student" || user.account_status !== "active") {
    throw new StudentAssessmentServiceError(
      "account_unavailable",
      "This account is currently unavailable.",
      403
    );
  }
}

async function ownedSessionContext(input: {
  student_user_db_id: string;
  session_public_id: string;
  client: PrismaClientLike;
}) {
  await assertActiveStudentAccount(input.student_user_db_id, input.client);
  const session = await input.client.assessmentSession.findFirst({
    where: {
      session_public_id: input.session_public_id,
      user_db_id: input.student_user_db_id
    },
    select: {
      id: true,
      session_public_id: true,
      current_phase: true,
      current_concept_unit_db_id: true,
      user: { select: { user_id: true } },
      assessment: { select: { assessment_public_id: true } },
      current_concept_unit: { select: { concept_unit_public_id: true } }
    }
  });

  if (!session) {
    throw new StudentAssessmentServiceError(
      "session_not_owned",
      "Session was not found for this student.",
      403
    );
  }

  if (!session.current_concept_unit_db_id || !session.current_concept_unit) {
    throw new StudentAssessmentServiceError(
      "concept_unit_not_current",
      "No current concept unit is set for this session.",
      409
    );
  }

  const conceptUnitSession = await input.client.conceptUnitSession.findUnique({
    where: {
      assessment_session_db_id_concept_unit_db_id: {
        assessment_session_db_id: session.id,
        concept_unit_db_id: session.current_concept_unit_db_id
      }
    },
    select: {
      id: true,
      initial_completed_at: true
    }
  });

  if (!conceptUnitSession) {
    throw new StudentAssessmentServiceError(
      "concept_unit_not_current",
      "Current concept-unit session was not found.",
      409
    );
  }

  return {
    session,
    concept_unit_session: conceptUnitSession
  };
}

async function latestAttemptForSession(sessionPublicId: string, client: PrismaClientLike) {
  return client.activityRuntimeAttempt.findFirst({
    where: { session_public_id: sessionPublicId },
    orderBy: [{ created_at: "desc" }]
  });
}

async function latestEvidenceFeedback(
  attempt: ActivityRuntimeAttempt,
  client: PrismaClientLike
) {
  if (!attempt.latest_evidence_record_public_id) {
    return null;
  }

  const record = await client.activityMisconceptionEvidenceRecord.findUnique({
    where: { evidence_public_id: attempt.latest_evidence_record_public_id },
    select: { student_safe_feedback: true }
  });
  const parsed = FeedbackSchema.safeParse(record?.student_safe_feedback);

  return parsed.success ? normalizeRuntimeFeedback(parsed.data) : null;
}

function projectionForNoAttempt(): StudentActivityRuntimeProjection {
  const projection: StudentActivityRuntimeProjection = {
    available: false,
    activity_attempt_public_id: null,
    ui_state: "not_started",
    status_message: "The next activity will appear when it is ready.",
    focus_label: null,
    first_turn_message: null,
    response_prompt: null,
    helper_text: "Wait for the next prompt before responding.",
    allowed_actions: [],
    can_start: false,
    can_submit_response: false,
    can_choose_another_activity: false,
    can_move_on: false,
    can_continue: false,
    message_max_chars: ACTIVITY_RUNTIME_MAX_RESPONSE_CHARS,
    feedback: null,
    next_recommendation_label: null,
    alternative_activity_labels: alternativeActivityLabels
  };
  assertStudentActivityRuntimeProjectionIsSafe(projection);
  return projection;
}

function projectionForStartFailure(): StudentActivityRuntimeProjection {
  const projection: StudentActivityRuntimeProjection = {
    available: false,
    activity_attempt_public_id: null,
    ui_state: "could_not_prepare_activity_safely",
    status_message: "I could not safely prepare this activity right now.",
    focus_label: null,
    first_turn_message: null,
    response_prompt: null,
    helper_text: "You can try again, choose another activity, or continue to the next step.",
    allowed_actions: ["start_activity", "choose_another_activity", "skip_activity_to_transfer"],
    can_start: true,
    can_submit_response: false,
    can_choose_another_activity: true,
    can_move_on: true,
    can_continue: false,
    message_max_chars: ACTIVITY_RUNTIME_MAX_RESPONSE_CHARS,
    feedback: {
      message: "I could not safely prepare this activity right now. You can try again, choose another activity, or continue to the next step.",
      next_options: ["continue", "choose another activity", "skip this activity and continue"]
    },
    next_recommendation_label: null,
    alternative_activity_labels: alternativeActivityLabels
  };
  assertStudentActivityRuntimeProjectionIsSafe(projection);
  return projection;
}

function sourceFromAttempt(attempt: ActivityRuntimeAttempt) {
  const parsed = SourceActivityPacketRefSchema.safeParse(attempt.source_activity_packet_ref);
  return parsed.success ? parsed.data : null;
}

function uiStateForAttempt(attempt: ActivityRuntimeAttempt):
  StudentActivityRuntimeProjection["ui_state"] {
  switch (attempt.status) {
    case "awaiting_student_activity_response":
      return "waiting_for_your_response";
    case "student_activity_response_received":
    case "evidence_evaluation_pending":
    case "evidence_evaluated":
    case "evidence_persisted":
    case "post_activity_snapshot_created":
      return "reviewing_your_response";
    case "continue_recommended":
      return "feedback_ready";
    case "choose_alternative_recommended":
      return "alternative_requested";
    case "move_on_recommended":
      return "moved_on";
    case "failed_closed":
      return "could_not_review_response_safely";
    default:
      return "activity_ready";
  }
}

async function projectionForAttempt(
  attempt: ActivityRuntimeAttempt,
  client: PrismaClientLike,
  loopResult?: ActivityRuntimeLoopResult
): Promise<StudentActivityRuntimeProjection> {
  const source = sourceFromAttempt(attempt);
  const feedback = loopResult?.student_safe_feedback ?? await latestEvidenceFeedback(attempt, client);
  const uiState = uiStateForAttempt(attempt);
  const focusLabel = source
    ? studentActivityFocusLabel({
        diagnostic_purpose: source.diagnostic_purpose,
        selected_formative_value: source.selected_formative_value,
        activity_family: source.activity_family
      })
    : "Work on this idea";
  const recommendation =
    loopResult?.next_runtime_recommendation ??
    (attempt.status === "move_on_recommended"
        ? "move_on"
      : attempt.status === "choose_alternative_recommended"
        ? "choose_alternative_activity"
        : attempt.status === "failed_closed"
          ? "failed_closed"
          : null);

  const projection: StudentActivityRuntimeProjection = {
    available: Boolean(source) && attempt.status !== "failed_closed",
    activity_attempt_public_id: attempt.activity_attempt_public_id,
    ui_state: uiState,
    status_message:
      uiState === "waiting_for_your_response"
        ? "Activity ready"
        : uiState === "reviewing_your_response"
          ? "Reviewing your response"
          : uiState === "feedback_ready"
            ? "Feedback ready"
            : uiState === "moved_on"
              ? "Activity skipped"
              : uiState === "alternative_requested"
                ? "Alternative activity requested"
                : uiState === "could_not_review_response_safely"
                  ? "I could not safely review this response right now."
                  : "Activity ready",
    focus_label: focusLabel,
    first_turn_message: source?.safe_activity_prompt ?? null,
    response_prompt: source?.expected_student_action_prompt ?? null,
    helper_text:
      uiState === "could_not_review_response_safely"
        ? "You can try again, choose another activity, or continue to the next step."
        : "Write a short response in your own words.",
    allowed_actions:
      uiState === "waiting_for_your_response"
        ? ["submit_response", "choose_another_activity", "skip_activity_to_transfer"]
        : uiState === "feedback_ready"
          ? ["choose_another_activity", "skip_activity_to_transfer"]
          : uiState === "could_not_review_response_safely"
            ? ["submit_response", "choose_another_activity", "skip_activity_to_transfer"]
            : ["choose_another_activity", "skip_activity_to_transfer"],
    can_start: false,
    can_submit_response:
      uiState === "waiting_for_your_response" ||
      uiState === "could_not_review_response_safely",
    can_choose_another_activity:
      uiState !== "moved_on" && uiState !== "reviewing_your_response",
    can_move_on: uiState !== "reviewing_your_response" && uiState !== "moved_on",
    can_continue: uiState === "feedback_ready",
    message_max_chars: ACTIVITY_RUNTIME_MAX_RESPONSE_CHARS,
    feedback:
      feedback ??
      (uiState === "alternative_requested"
        ? {
            message: "Alternative activity selection is recorded for this version. You can continue with the current activity or continue to the next step.",
            next_options: ["continue", "skip this activity and continue"]
          }
        : uiState === "moved_on"
          ? {
              message: "You skipped this activity and continued to the next step. Your progress is saved.",
              next_options: ["continue to transfer item"]
            }
          : uiState === "could_not_review_response_safely"
            ? {
                message: "I could not safely review this response right now. You can try again, choose another activity, or continue to the next step.",
                next_options: ["continue", "choose another activity", "skip this activity and continue"]
              }
            : null),
    next_recommendation_label: studentActivityRecommendationLabel(recommendation),
    alternative_activity_labels: alternativeActivityLabels
  };
  assertStudentActivityRuntimeProjectionIsSafe(projection);
  return projection;
}

async function latestValidatedLiveActivityPacket(input: {
  assessment_session_db_id: string;
  session_public_id: string;
  client: PrismaClientLike;
}) {
  const calls = await input.client.agentCall.findMany({
    where: {
      assessment_session_db_id: input.assessment_session_db_id,
      agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
      provider: "openai",
      call_status: "succeeded",
      output_validated: true,
      output_payload: { not: Prisma.JsonNull }
    },
    orderBy: [{ created_at: "desc" }],
    take: 10,
    select: { id: true, output_payload: true }
  });

  for (const call of calls) {
    const parsed = FormativeActivityPacketV1Schema.safeParse(call.output_payload);
    if (parsed.success && parsed.data.session_public_id === input.session_public_id) {
      return {
        packet: parsed.data,
        agent_call_id: call.id
      };
    }
  }

  return null;
}

export async function getStudentActivityRuntimeState(input: {
  student_user_db_id: string;
  session_public_id: string;
  client?: PrismaClientLike;
}) {
  const client = input.client ?? prisma;
  await ownedSessionContext({
    student_user_db_id: input.student_user_db_id,
    session_public_id: input.session_public_id,
    client
  });
  const attempt = await latestAttemptForSession(input.session_public_id, client);

  return attempt ? projectionForAttempt(attempt, client) : projectionForNoAttempt();
}

export async function startStudentActivityForSession(input: {
  student_user_db_id: string;
  session_public_id: string;
  activity_generation_override?: StudentActivityRuntimeGenerationOverride;
  client?: PrismaClientLike;
}) {
  const client = input.client ?? prisma;
  const context = await ownedSessionContext({
    student_user_db_id: input.student_user_db_id,
    session_public_id: input.session_public_id,
    client
  });

  if (!context.concept_unit_session.initial_completed_at) {
    throw new StudentAssessmentServiceError(
      "conflict",
      "The activity is not available until the initial responses are complete.",
      409
    );
  }

  const existingAttempt = await latestAttemptForSession(input.session_public_id, client);
  if (existingAttempt) {
    return projectionForAttempt(existingAttempt, client);
  }

  try {
    const existingPacket = await latestValidatedLiveActivityPacket({
      assessment_session_db_id: context.session.id,
      session_public_id: input.session_public_id,
      client
    });
    let packet: FormativeActivityPacketV1;
    let firstTurnAgentCallId: string;
    let reviewerAgentCallId: string | null = null;
    let repairAgentCallId: string | null = null;

    if (existingPacket) {
      packet = existingPacket.packet;
      firstTurnAgentCallId = existingPacket.agent_call_id;
    } else {
      const profileIntegrationPacket = await buildProfileIntegrationInterpretationPacketForSession(
        input.session_public_id,
        { execution_mode: "deterministic_mock" }
      );
      const formativeValuePacket = await buildFormativeValueDeterminationPacketForSession(
        input.session_public_id,
        { execution_mode: "deterministic_mock" }
      );
      const result = input.activity_generation_override
        ? await input.activity_generation_override({
            profile_integration_packet: profileIntegrationPacket,
            formative_value_packet: formativeValuePacket
          })
        : await executeLiveFormativeActivityDialogueAgent({
            profile_integration_packet: profileIntegrationPacket,
            formative_value_packet: formativeValuePacket
          });

      if (result.status !== "succeeded") {
        await logProcessEvent({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.concept_unit_session.id,
          event_type: "student_activity_runtime_start_failed",
          event_category: "formative_activity_runtime",
          event_source: "backend",
          payload: {
            blocked_reason: result.blocked_reason,
            issue_count: result.validation_issues.length
          }
        });
        return projectionForStartFailure();
      }

      packet = result.packet;
      firstTurnAgentCallId = result.repair_agent_call_id ?? result.generator_agent_call_id;
      reviewerAgentCallId = result.reviewer_agent_call_id;
      repairAgentCallId = result.repair_agent_call_id ?? null;
    }

    const attempt = await createActivityRuntimeAttemptFromLiveActivityPacket({
      activity_packet: packet,
      first_turn_agent_call_db_id: firstTurnAgentCallId,
      reviewer_agent_call_db_id: reviewerAgentCallId,
      repair_agent_call_db_id: repairAgentCallId,
      limitations: []
    }, client);

    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "student_activity_runtime_started",
      event_category: "formative_activity_runtime",
      event_source: "backend",
      payload: {
        activity_attempt_public_id: attempt.activity_attempt_public_id,
        source: "live_llm_activity_packet"
      }
    });

    return projectionForAttempt(attempt, client);
  } catch (error) {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "student_activity_runtime_start_failed",
      event_category: "formative_activity_runtime",
      event_source: "backend",
      payload: {
        blocked_reason: error instanceof Error ? error.message : "unknown_activity_start_error"
      }
    });
    return projectionForStartFailure();
  }
}

export async function submitStudentActivityRuntimeResponse(input: {
  student_user_db_id: string;
  session_public_id: string;
  activity_attempt_public_id: string;
  response_text: string;
  client_message_id: string;
  evaluator_override?: StudentActivityRuntimeEvaluatorOverride;
  client?: PrismaClientLike;
}) {
  const client = input.client ?? prisma;
  const context = await ownedSessionContext({
    student_user_db_id: input.student_user_db_id,
    session_public_id: input.session_public_id,
    client
  });
  const message = input.response_text.trim();

  if (!message) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "Enter a response before sending.",
      400
    );
  }
  if (message.length > ACTIVITY_RUNTIME_MAX_RESPONSE_CHARS) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      `Keep the response under ${ACTIVITY_RUNTIME_MAX_RESPONSE_CHARS} characters.`,
      400
    );
  }

  const result = await submitStudentActivityResponseForEvidenceUpdate({
    activity_attempt_public_id: input.activity_attempt_public_id,
    session_public_id: input.session_public_id,
    student_response_text: message,
    student_choice_state: "continue",
    evaluator_override: input.evaluator_override
  }, client);

  await logProcessEvent({
    assessment_session_db_id: context.session.id,
    concept_unit_session_db_id: context.concept_unit_session.id,
    event_type: "student_activity_response_submitted",
    event_category: "formative_activity_runtime",
    event_source: "frontend",
    payload: {
      activity_attempt_public_id: input.activity_attempt_public_id,
      client_message_id: input.client_message_id,
      result_status: result.status,
      runtime_state: result.runtime_state
    }
  });

  const attempt = await client.activityRuntimeAttempt.findUniqueOrThrow({
    where: { activity_attempt_public_id: input.activity_attempt_public_id }
  });

  return projectionForAttempt(attempt, client, result);
}

export async function recordStudentActivityRuntimeChoice(input: {
  student_user_db_id: string;
  session_public_id: string;
  activity_attempt_public_id?: string | null;
  choice_state: Exclude<StudentActivityChoiceState, "continue">;
  selected_alternative_activity_family?: FormativeActivityFamily | null;
  client_action_id: string;
  client?: PrismaClientLike;
}) {
  const client = input.client ?? prisma;
  const context = await ownedSessionContext({
    student_user_db_id: input.student_user_db_id,
    session_public_id: input.session_public_id,
    client
  });
  const attempt = input.activity_attempt_public_id
    ? await client.activityRuntimeAttempt.findUnique({
        where: { activity_attempt_public_id: input.activity_attempt_public_id }
      })
    : await latestAttemptForSession(input.session_public_id, client);

  if (!attempt || attempt.session_public_id !== input.session_public_id) {
    if (input.choice_state === "choose_another_activity") {
      return projectionForStartFailure();
    }
    return projectionForNoAttempt();
  }

  if (
    (input.choice_state === "move_on" && attempt.status === "move_on_recommended") ||
    (input.choice_state === "choose_another_activity" && attempt.status === "choose_alternative_recommended")
  ) {
    return projectionForAttempt(attempt, client);
  }

  const responseReference = attempt.latest_activity_response_reference
    ? undefined
    : prismaJson({
        activity_response_reference_id: `activity_choice_${input.client_action_id}`,
        student_choice_state: input.choice_state,
        selected_alternative_activity_family: input.selected_alternative_activity_family ?? null,
        raw_response_stored_elsewhere: false,
        submitted_at: new Date().toISOString()
      });
  const nextStatus =
    input.choice_state === "move_on"
      ? "move_on_recommended"
      : "choose_alternative_recommended";
  const updated = await client.activityRuntimeAttempt.update({
    where: { id: attempt.id },
    data: {
      status: nextStatus,
      completed_at: new Date(),
      ...(responseReference ? { latest_activity_response_reference: responseReference } : {})
    }
  });

  await logProcessEvent({
    assessment_session_db_id: context.session.id,
    concept_unit_session_db_id: context.concept_unit_session.id,
    event_type:
      input.choice_state === "move_on"
        ? "student_activity_runtime_move_on"
        : "student_activity_runtime_choose_another",
    event_category: "formative_activity_runtime",
    event_source: "frontend",
    payload: {
      activity_attempt_public_id: attempt.activity_attempt_public_id,
      client_action_id: input.client_action_id,
      selected_alternative_activity_family: input.selected_alternative_activity_family ?? null
    }
  });

  if (input.choice_state === "move_on") {
    const nextPhase =
      context.session.current_phase === "session_completed"
        ? "session_completed"
        : "followup_stopped";

    if (nextPhase !== "session_completed" && context.session.current_phase !== "followup_stopped") {
      await client.assessmentSession.update({
        where: { id: context.session.id },
        data: {
          current_phase: nextPhase,
          status: "active",
          last_activity_at: new Date()
        }
      });
    }

    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "formative_activity_skipped",
      event_category: "formative_activity_runtime",
      event_source: "frontend",
      payload: {
        activity_attempt_public_id: attempt.activity_attempt_public_id,
        client_action_id: input.client_action_id,
        selected_navigation_destination: "skip_activity_to_transfer",
        next_runtime_state: "TRANSFER_ITEM",
        skipped_not_completed: true
      }
    });
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "continue_to_transfer_selected",
      event_category: "assessment_navigation",
      event_source: "frontend",
      payload: {
        activity_attempt_public_id: attempt.activity_attempt_public_id,
        client_action_id: input.client_action_id,
        destination_type: "transfer_item"
      }
    });
  } else {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "alternative_activity_requested",
      event_category: "formative_activity_runtime",
      event_source: "frontend",
      payload: {
        activity_attempt_public_id: attempt.activity_attempt_public_id,
        client_action_id: input.client_action_id,
        selected_alternative_activity_family: input.selected_alternative_activity_family ?? null
      }
    });
  }

  return projectionForAttempt(updated, client);
}
