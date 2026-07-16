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
import {
  buildDeterministicTopicDialogueResponse,
  buildPostActivityLearningDecision,
  getTopicDialoguePolicy,
  POST_ACTIVITY_LEARNING_DECISION_VERSION,
  TOPIC_DIALOGUE_AGENT_NAME,
  TOPIC_DIALOGUE_FALLBACK_VERSION,
  TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION,
  TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2,
  TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION,
  TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
  TOPIC_DIALOGUE_PROMPT_HASH,
  TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS,
  TOPIC_DIALOGUE_PROMPT_VERSION,
  TOPIC_DIALOGUE_BOUNDARY_VALIDATOR_VERSION,
  TopicDialogueInputV1Schema,
  TopicDialogueOutputV1Schema,
  classifyTopicDialogueStudentMessage,
  topicDialoguePublicId,
  validateTopicDialogueOutput,
  type PostActivityLearningDecisionV1,
  type TopicDialogueOutputV1
} from "@/lib/services/student-assessment/topic-dialogue-agent";
import { getServerEnv } from "@/lib/env";
import {
  executeStudentRuntimeLiveAgent,
} from "@/lib/services/student-assessment/student-runtime-live-agent";
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
import {
  ActivityMisconceptionEvidencePacketV1Schema,
  type ActivityMisconceptionEvidencePacketV1
} from "@/lib/services/student-assessment/activity-misconception-evidence";
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
      current_concept_unit: {
        select: {
          concept_unit_public_id: true,
          title: true,
          learning_objective: true
        }
      }
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

type LatestEvidenceContext = {
  feedback: StudentActivityRuntimeProjection["feedback"];
  decision: PostActivityLearningDecisionV1 | null;
  packet: ActivityMisconceptionEvidencePacketV1 | null;
};

async function latestEvidenceContext(
  attempt: ActivityRuntimeAttempt,
  source: z.infer<typeof SourceActivityPacketRefSchema> | null,
  client: PrismaClientLike
): Promise<LatestEvidenceContext> {
  if (!attempt.latest_evidence_record_public_id) {
    return { feedback: null, decision: null, packet: null };
  }

  const record = await client.activityMisconceptionEvidenceRecord.findUnique({
    where: { evidence_public_id: attempt.latest_evidence_record_public_id },
    select: {
      student_safe_feedback: true,
      evidence_packet: true
    }
  });
  const feedbackParsed = FeedbackSchema.safeParse(record?.student_safe_feedback);
  const packetParsed = ActivityMisconceptionEvidencePacketV1Schema.safeParse(record?.evidence_packet);
  const packet = packetParsed.success ? packetParsed.data : null;
  const dialoguePolicy = getTopicDialoguePolicy();
  const decision = packet && source
    ? buildPostActivityLearningDecision({
        activity_public_id: attempt.activity_attempt_public_id,
        growth_target:
          source.target_construct_or_boundary ??
          source.distractor_student_safe_description,
        evidence_packet: packet,
        maximum_dialogue_turns: dialoguePolicy.maximum_student_turns
      })
    : null;

  return {
    feedback: feedbackParsed.success ? normalizeRuntimeFeedback(feedbackParsed.data) : null,
    decision,
    packet
  };
}

function recordFromJson(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringFromRecord(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function dialogueTurnPayload(value: unknown) {
  const record = recordFromJson(value);
  return {
    message_type: stringFromRecord(record.message_type),
    topic_dialogue_public_id: stringFromRecord(record.topic_dialogue_public_id),
    dialogue_turn_number: typeof record.dialogue_turn_number === "number"
      ? record.dialogue_turn_number
      : null,
    client_operation_id: stringFromRecord(record.client_operation_id),
    next_action: stringFromRecord(record.next_action),
    topic_boundary: stringFromRecord(record.topic_boundary)
  };
}

async function latestTopicDialogueProjection(input: {
  attempt: ActivityRuntimeAttempt;
  source: z.infer<typeof SourceActivityPacketRefSchema> | null;
  decision: PostActivityLearningDecisionV1 | null;
  client: PrismaClientLike;
}): Promise<StudentActivityRuntimeProjection["topic_dialogue"]> {
  if (!input.source || !input.decision) {
    return null;
  }

  const dialoguePublicId = topicDialoguePublicId({
    session_public_id: input.attempt.session_public_id,
    activity_attempt_public_id: input.attempt.activity_attempt_public_id
  });
  const turns = await input.client.conversationTurn.findMany({
    where: {
      assessment_session: { session_public_id: input.attempt.session_public_id },
      structured_payload: { path: ["topic_dialogue_public_id"], equals: dialoguePublicId }
    },
    orderBy: [{ created_at: "asc" }],
    select: {
      actor_type: true,
      message_text: true,
      structured_payload: true
    }
  });
  const tutorTurns = turns.filter((turn) => turn.actor_type === "agent");
  const latestTutor = tutorTurns.at(-1) ?? null;
  const latestPayload = latestTutor ? dialogueTurnPayload(latestTutor.structured_payload) : null;
  const studentTurnCount = turns.filter((turn) => turn.actor_type === "student").length;

  if (input.decision.post_activity_status === "ready_to_advance") {
    return {
      dialogue_public_id: dialoguePublicId,
      state: "ready_to_advance",
      turn_number: studentTurnCount,
      maximum_turns: input.decision.maximum_dialogue_turns,
      tutor_message: null,
      response_prompt: null,
      remaining_issue: null,
      next_action: "show_progression_choices",
      topic_boundary: "inside_scope"
    };
  }

  if (
    latestPayload?.next_action === "show_progression_choices" ||
    latestPayload?.next_action === "continue_to_transfer" ||
    latestPayload?.next_action === "continue_to_next_topic"
  ) {
    return {
      dialogue_public_id: dialoguePublicId,
      state: "ready_to_advance",
      turn_number: studentTurnCount,
      maximum_turns: input.decision.maximum_dialogue_turns,
      tutor_message: latestTutor?.message_text ?? null,
      response_prompt: null,
      remaining_issue: null,
      next_action: latestPayload.next_action,
      topic_boundary: latestPayload.topic_boundary === "redirected_to_topic"
        ? "redirected_to_topic"
        : "inside_scope"
    };
  }

  if (
    studentTurnCount >= input.decision.maximum_dialogue_turns ||
    latestPayload?.next_action === "show_final_support_options"
  ) {
    return {
      dialogue_public_id: dialoguePublicId,
      state: "final_support",
      turn_number: studentTurnCount,
      maximum_turns: input.decision.maximum_dialogue_turns,
      tutor_message:
        latestTutor?.message_text ??
        `The main issue to keep working on is ${input.decision.growth_target}. You can continue to the next available step, or end the assessment now.`,
      response_prompt: null,
      remaining_issue: input.decision.remaining_issue,
      next_action: "show_final_support_options",
      topic_boundary: latestPayload?.topic_boundary === "redirected_to_topic"
        ? "redirected_to_topic"
        : "inside_scope"
    };
  }

  return {
    dialogue_public_id: dialoguePublicId,
    state: "awaiting_response",
    turn_number: studentTurnCount,
    maximum_turns: input.decision.maximum_dialogue_turns,
      tutor_message:
        latestTutor?.message_text ??
        `Focus on this part: ${input.decision.growth_target}`,
    response_prompt: "Write one short response or ask one question about this topic.",
    remaining_issue: input.decision.remaining_issue,
    next_action: "await_topic_dialogue_response",
    topic_boundary: latestPayload?.topic_boundary === "redirected_to_topic"
      ? "redirected_to_topic"
      : "inside_scope"
  };
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
    topic_dialogue: null,
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
    topic_dialogue: null,
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
  const evidence = await latestEvidenceContext(attempt, source, client);
  const feedback = loopResult?.student_safe_feedback ?? evidence.feedback;
  const uiState = uiStateForAttempt(attempt);
  const topicDialogue = await latestTopicDialogueProjection({
    attempt,
    source,
    decision: evidence.decision,
    client
  });
  const topicDialogueActive =
    topicDialogue?.state === "awaiting_response" ||
    topicDialogue?.state === "final_support";
  const shouldResolveDestinations =
    uiState === "feedback_ready" &&
    (!topicDialogueActive || topicDialogue?.state === "final_support");
  const destinations = shouldResolveDestinations
    ? await activityDestinationAvailability({ attempt, client })
    : { transfer_item_available: false, next_concept_available: false };
  const feedbackWithDestinations = uiState === "feedback_ready" && !topicDialogueActive
    ? {
        message: feedback?.message ?? "Nice work. You can continue when you are ready.",
        next_options: feedbackOptionsForDestinations(destinations)
      }
    : topicDialogueActive
      ? {
          message:
            topicDialogue?.tutor_message ??
            "Let us work through the remaining part of this idea together.",
          next_options: topicDialogue?.state === "final_support"
            ? ([
                ...(destinations.transfer_item_available ? ["continue to transfer item" as const] : []),
                "finish assessment" as const
              ])
            : ["continue" as const]
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
      topicDialogue?.state === "awaiting_response"
        ? ["submit_topic_dialogue_response", "finish_assessment"]
        : topicDialogue?.state === "final_support"
          ? [
              ...(destinations.transfer_item_available ? ["skip_activity_to_transfer" as const] : []),
              ...(destinations.next_concept_available ? ["skip_activity_to_next_concept" as const] : []),
              "finish_assessment" as const
            ]
        : uiState === "waiting_for_your_response"
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
      topicDialogue?.state === "awaiting_response" ||
      uiState === "waiting_for_your_response" ||
      uiState === "could_not_review_response_safely",
    can_choose_another_activity:
      !topicDialogueActive &&
      uiState !== "moved_on" && uiState !== "reviewing_your_response" && uiState !== "feedback_ready",
    can_move_on: uiState !== "reviewing_your_response" && uiState !== "moved_on",
    can_continue:
      uiState === "feedback_ready" &&
      (!topicDialogueActive || topicDialogue?.state === "final_support") &&
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
    topic_dialogue: topicDialogue,
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
  const dialoguePolicy = getTopicDialoguePolicy();
  if (message.length > dialoguePolicy.maximum_student_message_chars) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      `Keep the response under ${dialoguePolicy.maximum_student_message_chars} characters.`,
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
  const source = sourceFromAttempt(attempt);
  const evidence = await latestEvidenceContext(attempt, source, client);
  if (evidence.decision) {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "post_activity_decision_created",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        activity_attempt_public_id: input.activity_attempt_public_id,
        decision_version: POST_ACTIVITY_LEARNING_DECISION_VERSION,
        post_activity_status: evidence.decision.post_activity_status,
        recommended_route: evidence.decision.recommended_route,
        next_runtime_state: evidence.decision.next_runtime_state
      }
    });
  }

  return projectionForAttempt(attempt, client, result);
}

export async function submitTopicDialogueResponse(input: {
  student_user_db_id: string;
  session_public_id: string;
  dialogue_public_id: string;
  student_message: string;
  client_operation_id: string;
  expected_dialogue_version?: string | null;
  client?: PrismaClientLike;
}) {
  const client = input.client ?? prisma;
  const context = await ownedSessionContext({
    student_user_db_id: input.student_user_db_id,
    session_public_id: input.session_public_id,
    client
  });
  const message = input.student_message.trim();
  const dialoguePolicy = getTopicDialoguePolicy();

  if (!message) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "Enter a response before sending.",
      400
    );
  }
  if (message.length > dialoguePolicy.maximum_student_message_chars) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      `Keep the response under ${dialoguePolicy.maximum_student_message_chars} characters.`,
      400
    );
  }

  const attempt = await latestAttemptForSession(input.session_public_id, client);
  const source = attempt ? sourceFromAttempt(attempt) : null;
  if (!attempt || !source) {
    throw new StudentAssessmentServiceError(
      "conflict",
      "There is no active topic dialogue for this assessment.",
      409
    );
  }
  const expectedDialoguePublicId = topicDialoguePublicId({
    session_public_id: attempt.session_public_id,
    activity_attempt_public_id: attempt.activity_attempt_public_id
  });
  if (input.dialogue_public_id !== expectedDialoguePublicId) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "This topic dialogue is no longer current.",
      409
    );
  }

  const evidence = await latestEvidenceContext(attempt, source, client);
  const topicProjection = await latestTopicDialogueProjection({
    attempt,
    source,
    decision: evidence.decision,
    client
  });
  if (!evidence.decision || topicProjection?.state !== "awaiting_response") {
    throw new StudentAssessmentServiceError(
      "conflict",
      "This topic dialogue is not waiting for a response.",
      409
    );
  }
  const currentConcept = context.session.current_concept_unit;
  if (!currentConcept) {
    throw new StudentAssessmentServiceError(
      "concept_unit_not_current",
      "No current concept unit is set for this session.",
      409
    );
  }

  const existingAgentCall = await client.agentCall.findUnique({
    where: {
      agent_invocation_key: `topic-dialogue:${input.dialogue_public_id}:${input.client_operation_id}`
    }
  });
  if (existingAgentCall) {
    return projectionForAttempt(attempt, client);
  }

  const existingStudentTurn = await client.conversationTurn.findFirst({
    where: {
      assessment_session_db_id: context.session.id,
      structured_payload: {
        path: ["client_operation_id"],
        equals: input.client_operation_id
      }
    },
    select: { id: true }
  });

  const priorTurns = await client.conversationTurn.findMany({
    where: {
      assessment_session_db_id: context.session.id,
      structured_payload: { path: ["topic_dialogue_public_id"], equals: input.dialogue_public_id }
    },
    orderBy: [{ created_at: "asc" }],
    select: {
      actor_type: true,
      message_text: true,
      structured_payload: true
    }
  });
  const priorStudentTurns = priorTurns.filter((turn) => turn.actor_type === "student").length;
  const dialogueTurnNumber = priorStudentTurns + 1;
  if (!existingStudentTurn) {
    await client.conversationTurn.create({
      data: {
        assessment_session_db_id: context.session.id,
        concept_unit_session_db_id: context.concept_unit_session.id,
        phase: "planning_completed",
        actor_type: "student",
        message_text: message,
        structured_payload: prismaJson({
          message_type: "topic_dialogue_student",
          topic_dialogue_public_id: input.dialogue_public_id,
          dialogue_turn_number: dialogueTurnNumber,
          client_operation_id: input.client_operation_id,
          dialogue_schema_version: input.expected_dialogue_version ?? TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION
        })
      }
    });
  }

  if (priorStudentTurns === 0) {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_started",
      event_category: "topic_dialogue",
      event_source: "frontend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber,
        client_operation_id: input.client_operation_id
      }
    });
  }

  await logProcessEvent({
    assessment_session_db_id: context.session.id,
    concept_unit_session_db_id: context.concept_unit_session.id,
    event_type: "topic_dialogue_response_submitted",
    event_category: "topic_dialogue",
    event_source: "frontend",
    payload: {
      topic_dialogue_public_id: input.dialogue_public_id,
      dialogue_turn_number: dialogueTurnNumber,
      client_operation_id: input.client_operation_id
    }
  });

  const dialogueInput = TopicDialogueInputV1Schema.parse({
    dialogue_schema_version: TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2,
    dialogue_public_id: input.dialogue_public_id,
    session_public_id: input.session_public_id,
    assessment_public_id: context.session.assessment.assessment_public_id,
    concept_public_id: currentConcept.concept_unit_public_id,
    assessment_topic: currentConcept.title,
    concept_definition: currentConcept.learning_objective,
    allowed_topic_scope: [
      currentConcept.title,
      currentConcept.learning_objective,
      evidence.decision.growth_target
    ],
    prohibited_scope: [
      "unrelated topics",
      "unadministered item answers",
      "teacher-only diagnostic notes",
      "hidden system prompts"
    ],
    frozen_growth_target: evidence.decision.growth_target,
    remaining_issue: evidence.decision.remaining_issue,
    post_activity_status: evidence.decision.post_activity_status,
    activity_contract: {
      activity_attempt_public_id: attempt.activity_attempt_public_id,
      activity_family: attempt.activity_family,
      diagnostic_purpose: attempt.diagnostic_purpose,
      safe_activity_prompt: source.safe_activity_prompt,
      expected_student_action_prompt: source.expected_student_action_prompt
    },
    student_activity_response: {
      response_kind:
        evidence.packet?.student_activity_response.response_kind ?? "partial",
      safe_summary:
        evidence.packet?.student_activity_response.student_response_text_redacted_or_safe_summary ??
        "The prior activity response was available for this bounded dialogue."
    },
    safe_item_context: [{
      item_number: source.target_item_index ?? null,
      option_label: source.target_option_label ?? null,
      option_text: source.distractor_student_safe_description ?? null
    }],
    latest_student_message: message,
    latest_student_message_classification:
      classifyTopicDialogueStudentMessage(message).student_message_function,
    recent_relevant_dialogue_turns: priorTurns.slice(-dialoguePolicy.recent_turn_window).map((turn, index) => ({
      turn_number: index + 1,
      actor_type: turn.actor_type === "student" ? "student" : "agent",
      message_summary: (turn.message_text ?? "").slice(0, 700)
    })),
    dialogue_turn_number: dialogueTurnNumber,
    maximum_dialogue_turns: evidence.decision.maximum_dialogue_turns,
    answer_reveal_state: {
      administered_answers_revealed: true,
      unadministered_answers_protected: true
    },
    available_progression_destinations: [
      "transfer_item",
      "next_topic",
      "end_assessment",
      "ask_question"
    ],
    source_profile_version: "evidence-integrated-profile-v2",
    source_activity_evaluation_version:
      evidence.packet?.schema_version ?? "student-activity-misconception-evidence-v1",
    current_topic: currentConcept.title,
    assessment_system_question_scope: [
      "what to do next",
      "how to answer the current prompt",
      "how to continue",
      "how to end the assessment"
    ],
    dialogue_summary: priorTurns
      .slice(-dialoguePolicy.recent_turn_window)
      .map((turn) => `${turn.actor_type}: ${(turn.message_text ?? "").slice(0, 160)}`)
      .join(" | "),
    progression_options: [
      "continue with this topic",
      "choose another activity",
      "continue to transfer item when available",
      "end assessment"
    ],
    source_versions: {
      topic_dialogue_input_schema_version: TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2,
      topic_dialogue_output_schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
      topic_dialogue_policy_version: "topic-dialogue-policy-v2"
    }
  });
  await client.topicDialogue.upsert({
    where: {
      assessment_session_db_id_activity_attempt_public_id: {
        assessment_session_db_id: context.session.id,
        activity_attempt_public_id: attempt.activity_attempt_public_id
      }
    },
    update: {
      current_remaining_issue: evidence.decision.remaining_issue,
      current_turn: dialogueTurnNumber,
      status: "active"
    },
    create: {
      dialogue_public_id: input.dialogue_public_id,
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      activity_attempt_public_id: attempt.activity_attempt_public_id,
      topic_anchor: prismaJson({
        assessment_topic: currentConcept.title,
        concept_public_id: currentConcept.concept_unit_public_id,
        safe_item_context: dialogueInput.safe_item_context
      }),
      growth_target: evidence.decision.growth_target,
      initial_remaining_issue: evidence.decision.remaining_issue,
      current_remaining_issue: evidence.decision.remaining_issue,
      maximum_turns: evidence.decision.maximum_dialogue_turns,
      current_turn: dialogueTurnNumber,
      status: "active",
      policy_version: "topic-dialogue-policy-v2"
    }
  });
  await client.topicDialogueTurn.upsert({
    where: {
      dialogue_public_id_turn_number_actor_type: {
        dialogue_public_id: input.dialogue_public_id,
        turn_number: dialogueTurnNumber,
        actor_type: "student"
      }
    },
    update: {},
    create: {
      dialogue_public_id: input.dialogue_public_id,
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      activity_attempt_public_id: attempt.activity_attempt_public_id,
      turn_number: dialogueTurnNumber,
      actor_type: "student",
      message_function: dialogueInput.latest_student_message_classification ?? null,
      topic_relation: classifyTopicDialogueStudentMessage(message).topic_relation,
      message_text: message,
      structured_payload: prismaJson({
        client_operation_id: input.client_operation_id,
        input_schema_version: TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2
      })
    }
  });
  if (getServerEnv().TOPIC_DIALOGUE_LIVE_CALLS_ENABLED) {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_live_call_started",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber,
        output_schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2
      }
    });
  }
  const liveResult = await executeStudentRuntimeLiveAgent({
    client,
    live_enabled: getServerEnv().TOPIC_DIALOGUE_LIVE_CALLS_ENABLED,
    role: TOPIC_DIALOGUE_AGENT_NAME,
    agent_name: TOPIC_DIALOGUE_AGENT_NAME,
    agent_version: TOPIC_DIALOGUE_PROMPT_VERSION,
    prompt_version: TOPIC_DIALOGUE_PROMPT_VERSION,
    prompt_hash: TOPIC_DIALOGUE_PROMPT_HASH,
    schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
    schema_name: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
    instructions: TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS,
    request_input: dialogueInput,
    output_schema: TopicDialogueOutputV1Schema,
    invocation_key: `topic-dialogue:${input.dialogue_public_id}:${input.client_operation_id}`,
    assessment_session_db_id: context.session.id,
    concept_unit_session_db_id: context.concept_unit_session.id,
    metadata: {
      dialogue_public_id: input.dialogue_public_id,
      schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2
    }
  });
  const output = liveResult.status === "succeeded"
    ? liveResult.output
    : buildDeterministicTopicDialogueResponse(dialogueInput);
  const validation = validateTopicDialogueOutput(output);
  const persistedOutput: TopicDialogueOutputV1 = validation.valid
    ? output
    : buildDeterministicTopicDialogueResponse({
        ...dialogueInput,
        latest_student_message: "Please keep the discussion on this assessment topic."
      });
  const fallbackUsed = liveResult.status !== "succeeded" || !validation.valid;
  const agentCall = liveResult.status === "succeeded"
    ? await client.agentCall.update({
        where: { id: liveResult.agent_call_id },
        data: {
          output_payload: prismaJson(persistedOutput),
          output_validated: validation.valid,
          validation_error: validation.valid
            ? null
            : validation.issues.map((issue) => {
                const blocked = "blocked_pattern_label" in issue ? issue.blocked_pattern_label : undefined;
                return `${issue.field_path}:${blocked ?? issue.rule_code}`;
              }).join("; "),
          call_status: validation.valid ? "succeeded" : "invalid_output"
        }
      })
    : await client.agentCall.create({
        data: {
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.concept_unit_session.id,
          agent_name: TOPIC_DIALOGUE_AGENT_NAME,
          agent_version: TOPIC_DIALOGUE_PROMPT_VERSION,
          model_name: "deterministic_topic_dialogue_fallback",
          provider: "mock",
          agent_invocation_key: `topic-dialogue:${input.dialogue_public_id}:${input.client_operation_id}`,
          prompt_version: TOPIC_DIALOGUE_PROMPT_VERSION,
          schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
          prompt_hash: TOPIC_DIALOGUE_PROMPT_HASH,
          input_payload: prismaJson(dialogueInput),
          output_payload: prismaJson(persistedOutput),
          raw_output: prismaJson(persistedOutput),
          output_validated: validation.valid,
          validation_error: validation.valid
            ? null
            : validation.issues.map((issue) => {
                const blocked = "blocked_pattern_label" in issue ? issue.blocked_pattern_label : undefined;
                return `${issue.field_path}:${blocked ?? issue.rule_code}`;
              }).join("; "),
          blocked_reason:
            liveResult.status === "not_attempted" ? liveResult.blocked_reason : undefined,
          call_status: validation.valid ? "succeeded" : "invalid_output",
          live_call_allowed: false,
          started_at: new Date(),
          completed_at: new Date()
        }
      });

  await client.conversationTurn.create({
    data: {
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      phase: "planning_completed",
      actor_type: "agent",
      agent_name: TOPIC_DIALOGUE_AGENT_NAME,
      message_text: persistedOutput.tutor_message,
      structured_payload: prismaJson({
        message_type: "topic_dialogue_tutor",
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber,
        client_operation_id: input.client_operation_id,
        agent_call_id: agentCall.id,
        response_function: persistedOutput.response_function,
        evidence_update: persistedOutput.evidence_update,
        evidence_sufficiency: persistedOutput.evidence_sufficiency,
        topic_boundary: persistedOutput.topic_boundary,
        next_action: persistedOutput.next_action,
        next_runtime_state: persistedOutput.next_runtime_state,
        progression_readiness: persistedOutput.progression_readiness,
        student_message_function: persistedOutput.student_message_function ?? null,
        topic_relation: persistedOutput.topic_relation ?? null,
        system_question_answered: persistedOutput.system_question_answered ?? false,
        post_turn_understanding: persistedOutput.post_turn_understanding ?? null,
        requires_student_response: persistedOutput.requires_student_response ?? null,
        expected_response_guidance: persistedOutput.expected_response_guidance ?? null,
        safety_flags: persistedOutput.safety_flags ?? [],
        schema_version: persistedOutput.schema_version ?? TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION,
        fallback_used: fallbackUsed,
        fallback_version: TOPIC_DIALOGUE_FALLBACK_VERSION,
        boundary_validator_version: TOPIC_DIALOGUE_BOUNDARY_VALIDATOR_VERSION
      })
    }
  });
  await client.topicDialogueTurn.upsert({
    where: {
      dialogue_public_id_turn_number_actor_type: {
        dialogue_public_id: input.dialogue_public_id,
        turn_number: dialogueTurnNumber,
        actor_type: "agent"
      }
    },
    update: {},
    create: {
      dialogue_public_id: input.dialogue_public_id,
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      activity_attempt_public_id: attempt.activity_attempt_public_id,
      turn_number: dialogueTurnNumber,
      actor_type: "agent",
      message_function: persistedOutput.student_message_function ?? null,
      topic_relation: persistedOutput.topic_relation ?? null,
      system_question_answered: persistedOutput.system_question_answered ?? false,
      evidence_update: persistedOutput.evidence_update,
      remaining_issue: persistedOutput.remaining_issue,
      post_turn_understanding: persistedOutput.post_turn_understanding ?? null,
      next_action: persistedOutput.next_action,
      next_runtime_state: persistedOutput.next_runtime_state,
      progression_readiness: persistedOutput.progression_readiness,
      requires_student_response: persistedOutput.requires_student_response ?? null,
      fallback_used: fallbackUsed,
      agent_call_db_id: agentCall.id,
      message_text: persistedOutput.tutor_message,
      structured_payload: prismaJson(persistedOutput)
    }
  });
  await client.topicDialogue.update({
    where: { dialogue_public_id: input.dialogue_public_id },
    data: {
      current_remaining_issue: persistedOutput.remaining_issue,
      current_turn: dialogueTurnNumber,
      status:
        persistedOutput.next_action === "show_progression_choices" ||
        persistedOutput.next_action === "show_final_support_options"
          ? "ready_for_progression"
          : "active"
    }
  });

  await logProcessEvent({
    assessment_session_db_id: context.session.id,
    concept_unit_session_db_id: context.concept_unit_session.id,
    event_type: "topic_dialogue_response_generated",
    event_category: "topic_dialogue",
    event_source: "backend",
    payload: {
      topic_dialogue_public_id: input.dialogue_public_id,
      dialogue_turn_number: dialogueTurnNumber,
      response_function: persistedOutput.response_function,
      next_action: persistedOutput.next_action,
      topic_boundary: persistedOutput.topic_boundary,
      agent_call_id: agentCall.id,
      fallback_used: fallbackUsed
    }
  });
  if (liveResult.status === "succeeded" && validation.valid) {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_live_call_completed",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber,
        agent_call_id: agentCall.id
      }
    });
  }
  if (fallbackUsed) {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_fallback_used",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber,
        reason:
          liveResult.status === "not_attempted"
            ? liveResult.blocked_reason
            : validation.valid
              ? "live_call_failed"
              : "topic_dialogue_output_validation_failed"
      }
    });
  }
  if (persistedOutput.student_message_function === "clarification_request") {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_clarification_requested",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber
      }
    });
  }
  if (persistedOutput.system_question_answered) {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_system_question_answered",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber
      }
    });
  }
  if (persistedOutput.topic_boundary === "redirected_to_topic") {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_boundary_redirected",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber
      }
    });
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_off_topic_redirected",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber
      }
    });
  }
  if (persistedOutput.next_action === "show_progression_choices") {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_ready_to_advance",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber
      }
    });
  }
  if (dialogueTurnNumber >= evidence.decision.maximum_dialogue_turns) {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_turn_limit_reached",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber,
        maximum_dialogue_turns: evidence.decision.maximum_dialogue_turns
      }
    });
  }

  return projectionForAttempt(attempt, client);
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
