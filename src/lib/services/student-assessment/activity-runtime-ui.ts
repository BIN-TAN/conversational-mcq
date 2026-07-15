import { createHash } from "node:crypto";
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
  createActivityRuntimeAttemptFromEvidenceIntegratedRouter,
  createActivityRuntimeAttemptFromLiveActivityPacket,
  submitStudentActivityResponseForEvidenceUpdate,
  type ActivityRuntimeLoopResult
} from "@/lib/services/student-assessment/activity-runtime-loop";
import { updateAssessmentSessionPhase } from "@/lib/services/session-state";
import { submitChatNativeNextChoice } from "@/lib/services/student-assessment/formative-profile";
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

const alternativeActivityLabels: string[] = [];

const alternativeFamilyOrder: FormativeActivityFamily[] = [
  "distractor_contrast",
  "reasoning_chain_repair",
  "independent_reconstruction",
  "confidence_evidence_audit",
  "basic_concept_grounding",
  "transfer_and_distractor_generation"
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
  distractor_student_safe_description: z.string().min(1),
  source_profile_integration_snapshot_id: z.string().min(1).optional(),
  source_formative_value_packet_id: z.string().min(1).optional(),
  target_item_index: z.number().int().positive().nullable().optional(),
  target_item_id: z.string().min(1).nullable().optional(),
  target_option_label: z.string().min(1).max(8).nullable().optional(),
  target_construct_or_boundary: z.string().min(1).nullable().optional(),
  student_task_prompt: z.string().min(1).optional(),
  expected_response_mode: z.enum(["short_text", "free_text"]).optional(),
  rationale_for_selection: z.string().min(1).optional(),
  semantic_deduplication_key: z.string().min(1).optional()
}).passthrough();

type StudentActivityRuntimeChoiceAction =
  | "choose_another_activity"
  | "skip_activity_to_transfer"
  | "skip_activity_to_next_concept"
  | "finish_assessment"
  | "return_to_summary"
  | "move_on";

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
      .replace(/\bmove on\b/gi, "end the assessment")
      .replace(/\bMove on\b/g, "End assessment"),
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

function hashStudentRuntimeValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function itemRoleFromRules(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const role = (value as Record<string, unknown>).item_role;
  return typeof role === "string" && role.trim() ? role.trim() : null;
}

function inferTargetItemIndex(source: z.infer<typeof SourceActivityPacketRefSchema>) {
  if (source.target_item_index) {
    return source.target_item_index;
  }
  const match = /\bItem\s+(\d+)\b/i.exec(source.safe_activity_prompt);
  return match ? Number(match[1]) : null;
}

function nextAlternativeFamily(currentFamily: FormativeActivityFamily): FormativeActivityFamily {
  const currentIndex = alternativeFamilyOrder.indexOf(currentFamily);
  const nextIndex = currentIndex >= 0
    ? (currentIndex + 1) % alternativeFamilyOrder.length
    : 0;
  return alternativeFamilyOrder[nextIndex];
}

function promptForAlternativeActivity(input: {
  source: z.infer<typeof SourceActivityPacketRefSchema>;
  family: FormativeActivityFamily;
}) {
  const itemIndex = inferTargetItemIndex(input.source);
  const optionLabel = itemIndex ? input.source.target_option_label : null;
  const itemPrefix = itemIndex ? `For Item ${itemIndex}, ` : "Using one answer from your first set, ";
  const optionPhrase = optionLabel ? `option ${optionLabel}` : "one tempting option";

  switch (input.family) {
    case "distractor_contrast":
      return {
        prompt: `${itemPrefix}${optionPhrase} may still feel plausible. Explain what makes it tempting, then name the key boundary that separates it from the idea you want to use.`,
        expected: "Write two or three sentences that compare the tempting idea with your own reasoning.",
        construct: "separating a tempting distractor from the target idea"
      };
    case "reasoning_chain_repair":
      return {
        prompt: "Choose one of your explanations from the first three questions. Rewrite it as two linked steps: first the evidence you used, then the conclusion that evidence supports.",
        expected: "Write the repaired explanation in the chat box.",
        construct: "linking evidence to a conclusion"
      };
    case "independent_reconstruction":
      return {
        prompt: "Setting the option choices aside, explain the difference between a learner estimate and an item feature in your own words.",
        expected: "Write a short explanation without using the answer choices.",
        construct: "explaining the idea without relying on the options"
      };
    case "confidence_evidence_audit":
      return {
        prompt: "Pick one answer you felt sure about. Name the evidence that supported that confidence, then name one thing that would make the answer less certain.",
        expected: "Write a short confidence check in the chat box.",
        construct: "connecting confidence to evidence"
      };
    case "basic_concept_grounding":
      return {
        prompt: "Start with the basic distinction. In your own words, describe what belongs to the learner and what belongs to the item.",
        expected: "Write a concise explanation of the distinction.",
        construct: "grounding the learner-versus-item distinction"
      };
    case "transfer_and_distractor_generation":
      return {
        prompt: "Create a nearby example that could confuse someone about this idea. Then explain the boundary that would keep the example from being misleading.",
        expected: "Write the example and the boundary in the chat box.",
        construct: "testing the idea in a nearby example"
      };
  }
}

function assertAlternativeActivityIsExecutable(input: {
  prompt: string;
  expected: string;
  targetItemIndex: number | null;
  targetOptionLabel: string | null;
}) {
  if (!/\b(write|explain|describe|name|create|rewrite)\b/i.test(`${input.prompt} ${input.expected}`)) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "I could not safely prepare this activity right now.",
      409
    );
  }

  if (input.targetOptionLabel && !input.targetItemIndex) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "I could not safely prepare this activity right now.",
      409
    );
  }

  if (/\b(workflow|runtime|routing|schema|fallback|recorded for this version|future version)\b/i.test(input.prompt)) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "I could not safely prepare this activity right now.",
      409
    );
  }
}

async function activityDestinationAvailability(input: {
  attempt: ActivityRuntimeAttempt;
  client: PrismaClientLike;
}) {
  const session = await input.client.assessmentSession.findUnique({
    where: { session_public_id: input.attempt.session_public_id },
    select: {
      current_concept_unit_db_id: true,
      current_concept_unit: {
        select: {
          assessment_db_id: true,
          order_index: true
        }
      }
    }
  });

  if (!session?.current_concept_unit_db_id || !session.current_concept_unit) {
    return {
      transfer_item_available: false,
      next_concept_available: false
    };
  }

  const [candidateTransferItems, nextConceptCount] = await Promise.all([
    input.client.item.findMany({
      where: {
        concept_unit_db_id: session.current_concept_unit_db_id,
        included_in_published_set: false,
        status: { not: "archived" }
      },
      select: { administration_rules: true },
      orderBy: [{ item_order: "asc" }, { created_at: "asc" }]
    }),
    input.client.conceptUnit.count({
      where: {
        assessment_db_id: session.current_concept_unit.assessment_db_id,
        order_index: { gt: session.current_concept_unit.order_index },
        status: "published"
      }
    })
  ]);

  return {
    transfer_item_available: candidateTransferItems.some((item) =>
      itemRoleFromRules(item.administration_rules) === "transfer"
    ),
    next_concept_available: nextConceptCount > 0
  };
}

function feedbackOptionsForDestinations(input: {
  transfer_item_available: boolean;
  next_concept_available: boolean;
}) {
  const options: NonNullable<StudentActivityRuntimeProjection["feedback"]>["next_options"] = [];

  if (input.transfer_item_available) {
    options.push("continue to transfer item");
  }
  if (input.next_concept_available) {
    options.push("continue to next concept");
  }
  options.push("finish assessment");

  return options.slice(0, 3);
}

async function createAlternativeActivityAttempt(input: {
  source: z.infer<typeof SourceActivityPacketRefSchema>;
  attempt: ActivityRuntimeAttempt;
  client: PrismaClientLike;
}) {
  const family = nextAlternativeFamily(input.source.activity_family);
  const targetItemIndex = inferTargetItemIndex(input.source);
  const targetOptionLabel = targetItemIndex ? input.source.target_option_label ?? null : null;
  const alternative = promptForAlternativeActivity({
    source: input.source,
    family
  });

  assertAlternativeActivityIsExecutable({
    prompt: alternative.prompt,
    expected: alternative.expected,
    targetItemIndex,
    targetOptionLabel
  });

  return createActivityRuntimeAttemptFromEvidenceIntegratedRouter({
    session_public_id: input.attempt.session_public_id,
    student_public_id: input.attempt.student_public_id,
    assessment_public_id: input.attempt.assessment_public_id,
    concept_unit_id: input.attempt.concept_unit_id,
    activity_family:
      family === "distractor_contrast"
        ? "distractor_focused_activity"
        : family === "basic_concept_grounding"
          ? "foundational_support_activity"
          : "diagnostic_clarification",
    diagnostic_purpose:
      family === "distractor_contrast"
        ? "distractor_misconception_probe"
        : family === "reasoning_chain_repair"
          ? "reasoning_boundary_repair"
          : family === "basic_concept_grounding"
            ? "conceptual_entry_grounding"
            : "independent_misconception_verification",
    selected_formative_value: input.source.selected_formative_value,
    safe_activity_prompt: `Here is a different way to work on the same idea.\n\n${alternative.prompt}`,
    expected_student_action_prompt: alternative.expected,
    distractor_role: input.source.distractor_role,
    distractor_student_safe_description: input.source.distractor_student_safe_description,
    source_profile_integration_snapshot_id:
      input.source.source_profile_integration_snapshot_id ?? input.source.activity_packet_hash,
    source_formative_value_packet_id:
      input.source.source_formative_value_packet_id ?? input.source.activity_packet_hash,
    next_interaction_schema_version: "student-activity-runtime-alternative-v1",
    routing_policy_version: "student-requested-alternative-v1",
    activity_type: `student_requested_alternative_${family}`,
    routing_justification:
      "Student requested a different activity, so the runtime selected a different activity family with a chat-answerable prompt.",
    target_item_index: targetItemIndex,
    target_item_id: input.source.target_item_id ?? null,
    target_option_label: targetOptionLabel,
    target_construct_or_boundary:
      input.source.target_construct_or_boundary ?? alternative.construct,
    student_task_prompt: alternative.prompt,
    expected_response_mode: "free_text",
    rationale_for_selection:
      "Student requested a different activity; this activity uses a different response pattern while staying anchored to the same response package.",
    semantic_deduplication_key: hashStudentRuntimeValue({
      family,
      source_attempt: input.attempt.activity_attempt_public_id,
      prompt: alternative.prompt
    }),
    replaced_activity_attempt_public_id: input.attempt.activity_attempt_public_id,
    activity_switch_reason: "student_requested_different_activity",
    limitations: []
  }, input.client);
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
    helper_text: "You can try again, choose another activity, or end the assessment.",
    allowed_actions: ["start_activity", "choose_another_activity", "finish_assessment"],
    can_start: true,
    can_submit_response: false,
    can_choose_another_activity: true,
    can_move_on: true,
    can_continue: false,
    message_max_chars: ACTIVITY_RUNTIME_MAX_RESPONSE_CHARS,
    feedback: {
      message: "I could not safely prepare this activity right now. You can try again, choose another activity, or end the assessment.",
      next_options: ["continue", "choose another activity", "finish assessment"]
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
  const destinations = uiState === "feedback_ready"
    ? await activityDestinationAvailability({ attempt, client })
    : { transfer_item_available: false, next_concept_available: false };
  const feedbackWithDestinations = uiState === "feedback_ready"
    ? {
        message: feedback?.message ?? "Nice work. You can continue when you are ready.",
        next_options: feedbackOptionsForDestinations(destinations)
      }
    : feedback;
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
              ? "Assessment ended"
              : uiState === "alternative_requested"
                ? "Preparing a different activity"
                : uiState === "could_not_review_response_safely"
                  ? "I could not safely review this response right now."
                  : "Activity ready",
    focus_label: focusLabel,
    first_turn_message: source?.safe_activity_prompt ?? null,
    response_prompt: source?.expected_student_action_prompt ?? null,
    helper_text:
      uiState === "could_not_review_response_safely"
        ? "You can try again, choose another activity, or end the assessment."
        : "Write a short response in your own words.",
    allowed_actions:
      uiState === "waiting_for_your_response"
        ? ["submit_response", "choose_another_activity", "finish_assessment"]
        : uiState === "feedback_ready"
          ? [
              ...(destinations.transfer_item_available ? ["skip_activity_to_transfer" as const] : []),
              ...(destinations.next_concept_available ? ["skip_activity_to_next_concept" as const] : []),
              "finish_assessment" as const
            ]
          : uiState === "could_not_review_response_safely"
            ? ["submit_response", "choose_another_activity", "finish_assessment"]
            : ["choose_another_activity", "finish_assessment"],
    can_start: false,
    can_submit_response:
      uiState === "waiting_for_your_response" ||
      uiState === "could_not_review_response_safely",
    can_choose_another_activity:
      uiState !== "moved_on" && uiState !== "reviewing_your_response" && uiState !== "feedback_ready",
    can_move_on: uiState !== "reviewing_your_response" && uiState !== "moved_on",
    can_continue: uiState === "feedback_ready" &&
      (destinations.transfer_item_available || destinations.next_concept_available),
    message_max_chars: ACTIVITY_RUNTIME_MAX_RESPONSE_CHARS,
    feedback:
      feedbackWithDestinations ??
      (uiState === "alternative_requested"
        ? {
            message: "I am preparing a different activity.",
            next_options: ["continue"]
          }
        : uiState === "moved_on"
          ? {
              message: "The assessment has ended for this attempt.",
              next_options: ["return to assessment summary"]
            }
          : uiState === "could_not_review_response_safely"
            ? {
                message: "I could not safely review this response right now. You can try again, choose another activity, or end the assessment.",
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
  choice_state: StudentActivityRuntimeChoiceAction;
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

  const terminalChoice =
    input.choice_state === "move_on" ||
    input.choice_state === "finish_assessment" ||
    input.choice_state === "return_to_summary";
  const destinationChoice =
    input.choice_state === "skip_activity_to_transfer" ||
    input.choice_state === "skip_activity_to_next_concept";

  if (
    (terminalChoice && attempt.status === "move_on_recommended") ||
    (input.choice_state === "choose_another_activity" && attempt.status === "choose_alternative_recommended")
  ) {
    if (input.choice_state === "choose_another_activity") {
      const latestAttempt = await latestAttemptForSession(input.session_public_id, client);
      if (latestAttempt && latestAttempt.id !== attempt.id) {
        return projectionForAttempt(latestAttempt, client);
      }
    }
    return projectionForAttempt(attempt, client);
  }

  const source = sourceFromAttempt(attempt);

  if (destinationChoice) {
    if (attempt.status !== "continue_recommended") {
      throw new StudentAssessmentServiceError(
        "invalid_phase_for_action",
        "You can continue after this activity response has been reviewed.",
        409
      );
    }

    const destinations = await activityDestinationAvailability({ attempt, client });
    if (input.choice_state === "skip_activity_to_transfer" && !destinations.transfer_item_available) {
      throw new StudentAssessmentServiceError(
        "transfer_item_unavailable",
        "No transfer item is available for this concept unit.",
        409
      );
    }
    if (input.choice_state === "skip_activity_to_next_concept" && !destinations.next_concept_available) {
      throw new StudentAssessmentServiceError(
        "invalid_phase_for_action",
        "No next concept is available from this activity.",
        409
      );
    }

    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type:
        input.choice_state === "skip_activity_to_transfer"
          ? "continue_to_transfer_selected"
          : "continue_to_next_concept_selected",
      event_category: "formative_activity_runtime",
      event_source: "frontend",
      payload: {
        activity_attempt_public_id: attempt.activity_attempt_public_id,
        client_action_id: input.client_action_id,
        selected_navigation_destination:
          input.choice_state === "skip_activity_to_transfer"
            ? "transfer_item"
            : "next_concept"
      }
    });

    await updateAssessmentSessionPhase({
      assessment_session_db_id: context.session.id,
      to_phase: "followup_stopped",
      reason:
        input.choice_state === "skip_activity_to_transfer"
          ? "activity_runtime_continue_to_transfer"
          : "activity_runtime_continue_to_next_concept",
      payload: {
        activity_attempt_public_id: attempt.activity_attempt_public_id
      }
    });

    await submitChatNativeNextChoice({
      student_user_db_id: input.student_user_db_id,
      session_public_id: input.session_public_id,
      choice: input.choice_state === "skip_activity_to_transfer" ? "try_another" : "move_next",
      client_action_id: input.client_action_id
    });

    return projectionForAttempt(attempt, client);
  }

  const responseReference = attempt.latest_activity_response_reference
    ? undefined
    : prismaJson({
        activity_response_reference_id: `activity_choice_${input.client_action_id}`,
        student_choice_state: input.choice_state === "choose_another_activity"
          ? "choose_another_activity"
          : "move_on",
        selected_alternative_activity_family: input.selected_alternative_activity_family ?? null,
        raw_response_stored_elsewhere: false,
        submitted_at: new Date().toISOString()
      });
  const nextStatus = terminalChoice ? "move_on_recommended" : "choose_alternative_recommended";
  const updated = await client.activityRuntimeAttempt.update({
    where: { id: attempt.id },
    data: {
      status: terminalChoice && attempt.status === "continue_recommended" ? attempt.status : nextStatus,
      completed_at: new Date(),
      ...(responseReference ? { latest_activity_response_reference: responseReference } : {})
    }
  });

  await logProcessEvent({
    assessment_session_db_id: context.session.id,
    concept_unit_session_db_id: context.concept_unit_session.id,
    event_type: terminalChoice
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

  if (terminalChoice) {
    const now = new Date();
    if (context.session.current_phase !== "session_completed") {
      await client.assessmentSession.update({
        where: { id: context.session.id },
        data: {
          current_phase: "session_completed",
          status: "completed",
          completed_at: now,
          last_activity_at: now
        }
      });
      await client.conceptUnitSession.update({
        where: { id: context.concept_unit_session.id },
        data: {
          status: "completed",
          followup_status: "stopped",
          followup_completed_at: now
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
        selected_navigation_destination: "end_assessment",
        terminal_reason: "ended_during_formative_activity",
        next_runtime_state: "SESSION_COMPLETE",
        skipped_not_completed: attempt.status !== "continue_recommended"
      }
    });
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "finish_assessment_selected",
      event_category: "assessment_navigation",
      event_source: "frontend",
      payload: {
        activity_attempt_public_id: attempt.activity_attempt_public_id,
        client_action_id: input.client_action_id,
        destination_type: "assessment_end",
        terminal_reason: "ended_during_formative_activity"
      }
    });
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "session_completed",
      event_category: "session",
      event_source: "backend",
      payload: {
        terminal_reason: "ended_during_formative_activity",
        activity_attempt_public_id: attempt.activity_attempt_public_id
      }
    });
  } else {
    if (!source) {
      return projectionForStartFailure();
    }
    const nextAttempt = await createAlternativeActivityAttempt({
      source,
      attempt,
      client
    });
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "alternative_activity_requested",
      event_category: "formative_activity_runtime",
      event_source: "frontend",
      payload: {
        activity_attempt_public_id: attempt.activity_attempt_public_id,
        replacement_activity_attempt_public_id: nextAttempt.activity_attempt_public_id,
        client_action_id: input.client_action_id,
        selected_alternative_activity_family: nextAttempt.activity_family,
        activity_switch_reason: "student_requested_different_activity"
      }
    });
    return projectionForAttempt(nextAttempt, client);
  }

  return projectionForAttempt(updated, client);
}
