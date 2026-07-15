import { createHash } from "node:crypto";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import type {
  ActivityMisconceptionEvidencePacketV1,
  MisconceptionUpdateStatus
} from "@/lib/services/student-assessment/activity-misconception-evidence";

export const TOPIC_DIALOGUE_AGENT_NAME = "topic_dialogue_agent" as const;
export const TOPIC_DIALOGUE_PROMPT_VERSION = "topic-dialogue-v1" as const;
export const TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION = "topic-dialogue-input-v1" as const;
export const TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION = "topic-dialogue-output-v1" as const;
export const TOPIC_DIALOGUE_BOUNDARY_VALIDATOR_VERSION =
  "topic-dialogue-boundary-validator-v1" as const;
export const TOPIC_DIALOGUE_FALLBACK_VERSION =
  "topic-dialogue-deterministic-fallback-v1" as const;
export const POST_ACTIVITY_LEARNING_DECISION_VERSION =
  "post-activity-learning-decision-v1" as const;
export const TOPIC_DIALOGUE_MAX_STUDENT_TURNS_DEFAULT = 3;
export const TOPIC_DIALOGUE_RECENT_TURN_WINDOW_DEFAULT = 6;

export function getTopicDialoguePolicy() {
  const env = getServerEnv();
  return {
    maximum_student_turns:
      env.TOPIC_DIALOGUE_MAX_STUDENT_TURNS ?? TOPIC_DIALOGUE_MAX_STUDENT_TURNS_DEFAULT,
    recent_turn_window:
      env.TOPIC_DIALOGUE_RECENT_TURN_WINDOW ?? TOPIC_DIALOGUE_RECENT_TURN_WINDOW_DEFAULT
  };
}

export const PostActivityStatusSchema = z.enum([
  "ready_to_advance",
  "improving_but_incomplete",
  "specific_misconception_remaining",
  "foundational_support_needed",
  "insufficient_new_evidence"
]);

export const TopicDialogueNextActionSchema = z.enum([
  "await_topic_dialogue_response",
  "show_progression_choices",
  "show_final_support_options",
  "continue_to_transfer",
  "continue_to_next_topic",
  "end_assessment"
]);

export const TopicDialogueInputV1Schema = z.object({
  dialogue_schema_version: z.literal(TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION),
  dialogue_public_id: z.string().min(1),
  session_public_id: z.string().min(1),
  assessment_public_id: z.string().min(1),
  concept_public_id: z.string().min(1),
  assessment_topic: z.string().min(1).max(220),
  concept_definition: z.string().min(1).max(900),
  allowed_topic_scope: z.array(z.string().min(1).max(220)).min(1).max(10),
  prohibited_scope: z.array(z.string().min(1).max(220)).min(1).max(10),
  frozen_growth_target: z.string().min(1).max(700),
  remaining_issue: z.string().min(1).max(700),
  post_activity_status: PostActivityStatusSchema,
  activity_contract: z.object({
    activity_attempt_public_id: z.string().min(1),
    activity_family: z.string().min(1),
    diagnostic_purpose: z.string().min(1),
    safe_activity_prompt: z.string().min(1).max(2600),
    expected_student_action_prompt: z.string().min(1).max(420)
  }).strict(),
  student_activity_response: z.object({
    response_kind: z.string().min(1).max(80),
    safe_summary: z.string().min(1).max(900)
  }).strict(),
  safe_item_context: z.array(z.object({
    item_number: z.number().int().positive().nullable(),
    option_label: z.string().min(1).max(8).nullable(),
    option_text: z.string().min(1).max(700).nullable()
  }).strict()).max(5),
  latest_student_message: z.string().min(1).max(1200),
  recent_relevant_dialogue_turns: z.array(z.object({
    turn_number: z.number().int().nonnegative(),
    actor_type: z.enum(["student", "agent"]),
    message_summary: z.string().min(1).max(700)
  }).strict()).max(TOPIC_DIALOGUE_RECENT_TURN_WINDOW_DEFAULT),
  dialogue_turn_number: z.number().int().positive(),
  maximum_dialogue_turns: z.number().int().positive().max(5),
  answer_reveal_state: z.object({
    administered_answers_revealed: z.boolean(),
    unadministered_answers_protected: z.literal(true)
  }).strict(),
  available_progression_destinations: z.array(z.enum([
    "transfer_item",
    "next_topic",
    "end_assessment",
    "ask_question"
  ])).min(1).max(4),
  source_profile_version: z.string().min(1),
  source_activity_evaluation_version: z.string().min(1)
}).strict();
export type TopicDialogueInputV1 = z.infer<typeof TopicDialogueInputV1Schema>;

export const TopicDialogueOutputV1Schema = z.object({
  dialogue_schema_version: z.literal(TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION),
  tutor_message: z.string().min(1).max(900),
  response_function: z.enum([
    "clarification",
    "focused_question",
    "misconception_contrast",
    "foundational_scaffold",
    "worked_example",
    "answer_student_question",
    "topic_redirect",
    "readiness_confirmation"
  ]),
  evidence_update: z.string().min(1).max(700),
  remaining_issue: z.string().min(1).max(700),
  evidence_sufficiency: z.enum(["sufficient_to_advance", "needs_more_evidence", "insufficient"]),
  topic_boundary: z.enum(["inside_scope", "redirected_to_topic"]),
  next_action: TopicDialogueNextActionSchema,
  next_runtime_state: z.enum([
    "SHOW_TOPIC_DIALOGUE_PROMPT",
    "AWAIT_TOPIC_DIALOGUE_RESPONSE",
    "SHOW_PROGRESSION_CHOICES",
    "SHOW_FINAL_SUPPORT_OPTIONS"
  ]),
  progression_readiness: z.enum(["ready", "not_ready", "student_choice"]),
  student_safe_summary: z.string().min(1).max(500)
}).strict();
export type TopicDialogueOutputV1 = z.infer<typeof TopicDialogueOutputV1Schema>;

export const PostActivityLearningDecisionV1Schema = z.object({
  decision_version: z.literal(POST_ACTIVITY_LEARNING_DECISION_VERSION),
  activity_public_id: z.string().min(1),
  growth_target: z.string().min(1),
  activity_response_evidence: z.string().min(1),
  understanding_update: z.string().min(1),
  reasoning_update: z.string().min(1),
  remaining_issue: z.string().min(1),
  evidence_sufficiency: z.enum(["sufficient", "partial", "insufficient"]),
  post_activity_status: PostActivityStatusSchema,
  recommended_route: z.enum([
    "show_progression_choices",
    "start_topic_dialogue",
    "show_final_support_options",
    "end_assessment"
  ]),
  route_justification: z.string().min(1),
  maximum_dialogue_turns: z.number().int().positive(),
  next_runtime_state: z.enum([
    "SHOW_POST_ACTIVITY_FEEDBACK",
    "SHOW_TOPIC_DIALOGUE_PROMPT",
    "AWAIT_TOPIC_DIALOGUE_RESPONSE",
    "SHOW_PROGRESSION_CHOICES",
    "SHOW_FINAL_SUPPORT_OPTIONS"
  ])
}).strict();
export type PostActivityLearningDecisionV1 = z.infer<typeof PostActivityLearningDecisionV1Schema>;

export type TopicDialogueValidationIssue = {
  field_path: string;
  rule_code:
    | "schema_invalid"
    | "off_topic_answer"
    | "unbounded_continuation"
    | "multiple_questions"
    | "unsupported_claim"
    | "internal_language"
    | "answer_key_leak"
    | "hidden_content_leak";
  blocked_pattern_label?: string;
};

function hashValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function topicDialoguePublicId(input: {
  session_public_id: string;
  activity_attempt_public_id: string;
}) {
  return `td_${hashValue(input).slice(0, 20)}`;
}

export function mapPostActivityStatus(
  status: MisconceptionUpdateStatus
): PostActivityLearningDecisionV1["post_activity_status"] {
  switch (status) {
    case "misconception_unsupported":
    case "no_actionable_misconception_evidence":
    case "boundary_understanding_improved":
    case "independent_evidence_supported":
    case "student_chose_move_on":
      return "ready_to_advance";
    case "conceptual_entry_gap_remains":
      return "foundational_support_needed";
    case "misconception_persisted":
    case "reasoning_boundary_still_blurred":
      return "specific_misconception_remaining";
    case "insufficient_new_evidence":
      return "insufficient_new_evidence";
    case "conceptual_entry_improved":
    case "ready_for_distractor_probe":
    case "misconception_weakened":
    case "student_requested_alternative_activity":
      return "improving_but_incomplete";
  }
}

export function buildPostActivityLearningDecision(input: {
  activity_public_id: string;
  growth_target: string;
  evidence_packet: ActivityMisconceptionEvidencePacketV1;
  maximum_dialogue_turns?: number;
}): PostActivityLearningDecisionV1 {
  const postActivityStatus = mapPostActivityStatus(
    input.evidence_packet.misconception_evidence_update.status
  );
  const ready = postActivityStatus === "ready_to_advance";
  const insufficient = postActivityStatus === "insufficient_new_evidence";

  return PostActivityLearningDecisionV1Schema.parse({
    decision_version: POST_ACTIVITY_LEARNING_DECISION_VERSION,
    activity_public_id: input.activity_public_id,
    growth_target: input.growth_target,
    activity_response_evidence:
      input.evidence_packet.student_activity_response.student_response_text_redacted_or_safe_summary,
    understanding_update: input.evidence_packet.misconception_evidence_update.status,
    reasoning_update: input.evidence_packet.evidence_elicited.types.join(", "),
    remaining_issue: input.growth_target,
    evidence_sufficiency:
      input.evidence_packet.misconception_evidence_update.evidence_quality === "high"
        ? "sufficient"
        : input.evidence_packet.misconception_evidence_update.evidence_quality === "insufficient"
          ? "insufficient"
          : "partial",
    post_activity_status: postActivityStatus,
    recommended_route: ready
      ? "show_progression_choices"
      : insufficient
        ? "show_final_support_options"
        : "start_topic_dialogue",
    route_justification: ready
      ? "The activity response supplied enough evidence to offer progression choices."
      : "The activity response left a bounded issue that can be addressed within the current topic.",
    maximum_dialogue_turns: input.maximum_dialogue_turns ?? TOPIC_DIALOGUE_MAX_STUDENT_TURNS_DEFAULT,
    next_runtime_state: ready
      ? "SHOW_PROGRESSION_CHOICES"
      : insufficient
        ? "SHOW_FINAL_SUPPORT_OPTIONS"
        : "AWAIT_TOPIC_DIALOGUE_RESPONSE"
  });
}

function collectStrings(value: unknown, path = "output"): Array<{ path: string; value: string }> {
  if (typeof value === "string") return [{ path, value }];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectStrings(entry, `${path}.${index}`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      collectStrings(entry, `${path}.${key}`)
    );
  }
  return [];
}

function isLikelyOffTopic(message: string) {
  return /\b(weather|sports|movie|music|recipe|politics|stock|crypto|vacation|university admissions)\b/i.test(message);
}

export function validateTopicDialogueOutput(value: unknown) {
  const parsed = TopicDialogueOutputV1Schema.safeParse(value);
  const issues: TopicDialogueValidationIssue[] = [];

  if (!parsed.success) {
    return {
      valid: false as const,
      issues: parsed.error.issues.map((issue) => ({
        field_path: issue.path.join(".") || "output",
        rule_code: "schema_invalid" as const
      }))
    };
  }

  for (const entry of collectStrings(parsed.data)) {
    if (/\b(api key|system prompt|database url|password hash|teacher note|raw model output|chain of thought)\b/i.test(entry.value)) {
      issues.push({
        field_path: entry.path,
        rule_code: "hidden_content_leak",
        blocked_pattern_label: "hidden_or_secret_content"
      });
    }
    if (/\b(correct answer for item [4-9]|unadministered answer|answer key)\b/i.test(entry.value)) {
      issues.push({
        field_path: entry.path,
        rule_code: "answer_key_leak",
        blocked_pattern_label: "unadministered_or_raw_key"
      });
    }
    if (/\b(runtime|routing|schema|fallback|persisted|diagnostic purpose|raw process)\b/i.test(entry.value)) {
      issues.push({
        field_path: entry.path,
        rule_code: "internal_language",
        blocked_pattern_label: "internal_runtime_language"
      });
    }
    if (/\b(cheating|misconduct|motivation|low effort|ability trait)\b/i.test(entry.value)) {
      issues.push({
        field_path: entry.path,
        rule_code: "unsupported_claim",
        blocked_pattern_label: "unsupported_psychological_or_misconduct_claim"
      });
    }
  }

  const questionCount = (parsed.data.tutor_message.match(/\?/g) ?? []).length;
  if (questionCount > 1) {
    issues.push({
      field_path: "tutor_message",
      rule_code: "multiple_questions",
      blocked_pattern_label: "more_than_one_actionable_question"
    });
  }
  if (/keep chatting|anything else|ask me anything|whatever you want/i.test(parsed.data.tutor_message)) {
    issues.push({
      field_path: "tutor_message",
      rule_code: "unbounded_continuation",
      blocked_pattern_label: "unbounded_chat_offer"
    });
  }

  return { valid: issues.length === 0, issues };
}

export function buildDeterministicTopicDialogueResponse(
  input: TopicDialogueInputV1
): TopicDialogueOutputV1 {
  const atLimit = input.dialogue_turn_number >= input.maximum_dialogue_turns;
  const offTopic = isLikelyOffTopic(input.latest_student_message);
  const readySignal = /\b(now i understand|i understand|validity needs evidence|consistency alone is not enough|reliability.*not.*validity)\b/i
    .test(input.latest_student_message);
  const nextAction: z.infer<typeof TopicDialogueNextActionSchema> = offTopic
    ? "await_topic_dialogue_response"
    : readySignal
      ? "show_progression_choices"
      : atLimit
        ? "show_final_support_options"
        : "await_topic_dialogue_response";
  const tutorMessage = offTopic
    ? `I can help with questions about ${input.assessment_topic} in this activity. Which part of ${input.frozen_growth_target} would you like to work through?`
    : readySignal
      ? "That response addresses the key distinction more clearly. You can continue when you are ready."
      : atLimit
        ? `The main issue to keep working on is ${input.frozen_growth_target}. You can continue to the next available step, or end the assessment now.`
        : `Focus on this boundary: ${input.frozen_growth_target}. In one or two sentences, explain why consistency by itself is not enough for the intended interpretation.`;

  return TopicDialogueOutputV1Schema.parse({
    dialogue_schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION,
    tutor_message: tutorMessage,
    response_function: offTopic
      ? "topic_redirect"
      : readySignal
        ? "readiness_confirmation"
        : input.post_activity_status === "foundational_support_needed"
          ? "foundational_scaffold"
          : input.post_activity_status === "specific_misconception_remaining"
            ? "misconception_contrast"
            : "focused_question",
    evidence_update: readySignal
      ? "Student gave a clearer statement of the target boundary."
      : offTopic
        ? "Student message was outside the activity topic and was redirected."
        : "Student still needs one bounded response tied to the current growth target.",
    remaining_issue: readySignal ? "No bounded issue remains for this turn." : input.remaining_issue,
    evidence_sufficiency: readySignal
      ? "sufficient_to_advance"
      : atLimit
        ? "insufficient"
        : "needs_more_evidence",
    topic_boundary: offTopic ? "redirected_to_topic" : "inside_scope",
    next_action: nextAction,
    next_runtime_state: nextAction === "show_progression_choices"
      ? "SHOW_PROGRESSION_CHOICES"
      : nextAction === "show_final_support_options"
        ? "SHOW_FINAL_SUPPORT_OPTIONS"
        : "AWAIT_TOPIC_DIALOGUE_RESPONSE",
    progression_readiness: nextAction === "show_progression_choices" ? "ready" : "student_choice",
    student_safe_summary: readySignal
      ? "The latest response gave enough evidence to continue."
      : offTopic
        ? "The dialogue stayed within the assessment topic."
        : "The dialogue remains focused on the current concept boundary."
  });
}
