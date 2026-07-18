import { z } from "zod";
import {
  TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
  TopicDialogueNextActionSchema,
  TopicDialogueOutputV1Schema,
  validateTopicDialogueOutput,
  type TopicDialogueOutputV1,
  type TopicDialogueValidationIssue
} from "@/lib/services/student-assessment/topic-dialogue-agent";

export const TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V3 =
  "topic-dialogue-output-v3" as const;
export const TOPIC_DIALOGUE_BOUNDARY_VALIDATOR_VERSION_V3 =
  "eval-topic-boundary-v3" as const;

/**
 * Candidate-only provider contract. Every property is required because OpenAI
 * strict Structured Outputs rejects optional object properties. Logical
 * absence uses null or an empty array instead of z.optional().
 */
export const TopicDialogueOutputV3Schema = z.object({
  dialogue_schema_version: z.literal(TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2),
  schema_version: z.literal(TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V3),
  tutor_message: z.string().min(1).max(900),
  student_message_function: z.enum([
    "substantive_answer",
    "conceptual_question",
    "clarification_request",
    "prompt_instruction_question",
    "assessment_system_question",
    "request_for_example",
    "request_for_alternative_explanation",
    "off_topic",
    "unclear_but_valid"
  ]),
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
  post_turn_understanding: z.enum([
    "sound_or_strong",
    "partial",
    "misconception_present",
    "foundational_gap",
    "unclear"
  ]),
  evidence_sufficiency: z.enum([
    "sufficient_to_advance",
    "needs_more_evidence",
    "insufficient"
  ]),
  topic_relation: z.enum([
    "current_assessment_content",
    "assessment_system",
    "off_topic",
    "unclear_but_valid"
  ]),
  topic_boundary: z.enum(["inside_scope", "redirected_to_topic"]),
  system_question_answered: z.boolean(),
  next_action: TopicDialogueNextActionSchema,
  next_runtime_state: z.enum([
    "SHOW_TOPIC_DIALOGUE_PROMPT",
    "AWAIT_TOPIC_DIALOGUE_RESPONSE",
    "SHOW_PROGRESSION_CHOICES",
    "SHOW_FINAL_SUPPORT_OPTIONS"
  ]),
  progression_readiness: z.enum(["ready", "not_ready", "student_choice"]),
  requires_student_response: z.boolean(),
  expected_response_guidance: z.string().min(1).max(420).nullable(),
  safety_flags: z.array(z.string().min(1).max(80)).max(8),
  student_safe_summary: z.string().min(1).max(500)
}).strict();

export type TopicDialogueOutputV3 = z.infer<typeof TopicDialogueOutputV3Schema>;

export function topicDialogueOutputV3ToRuntimeV2(
  value: TopicDialogueOutputV3
): TopicDialogueOutputV1 {
  return TopicDialogueOutputV1Schema.parse({
    ...value,
    dialogue_schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
    schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
    expected_response_guidance: value.expected_response_guidance ?? undefined
  });
}

export function validateTopicDialogueOutputV3(value: unknown):
  | {
      valid: true;
      issues: TopicDialogueValidationIssue[];
      provider_output: TopicDialogueOutputV3;
      runtime_output: TopicDialogueOutputV1;
    }
  | {
      valid: false;
      issues: TopicDialogueValidationIssue[];
    } {
  const parsed = TopicDialogueOutputV3Schema.safeParse(value);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        field_path: issue.path.join(".") || "output",
        rule_code: "schema_invalid" as const
      }))
    };
  }

  const runtimeOutput = topicDialogueOutputV3ToRuntimeV2(parsed.data);
  const semanticValidation = validateTopicDialogueOutput(runtimeOutput);
  if (!semanticValidation.valid) {
    return { valid: false, issues: semanticValidation.issues };
  }

  return {
    valid: true,
    issues: [],
    provider_output: parsed.data,
    runtime_output: runtimeOutput
  };
}

export function serializeTopicDialogueV3ForStudent(value: TopicDialogueOutputV3) {
  return {
    tutor_message: value.tutor_message,
    requires_student_response: value.requires_student_response,
    expected_response_guidance: value.expected_response_guidance
  };
}

export function topicDialogueV3AuditProjection(value: TopicDialogueOutputV3) {
  return {
    output_schema_version: value.schema_version,
    dialogue_schema_version: value.dialogue_schema_version,
    validator_version: TOPIC_DIALOGUE_BOUNDARY_VALIDATOR_VERSION_V3,
    response_function: value.response_function,
    evidence_sufficiency: value.evidence_sufficiency,
    next_action: value.next_action,
    next_runtime_state: value.next_runtime_state,
    safety_flags: value.safety_flags
  };
}
