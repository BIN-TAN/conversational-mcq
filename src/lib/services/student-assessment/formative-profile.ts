import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { FormativeValueSchema } from "@/lib/domain/enums";
import { getLlmRuntimeConfig, resolveAgentModelConfig } from "@/lib/llm/config";
import { providerAuditMetadata } from "@/lib/llm/providers/audit-metadata";
import { createLlmProvider } from "@/lib/llm/providers/provider-factory";
import type { LlmProvider, StructuredAgentResult } from "@/lib/llm/providers/types";
import { assertNoProhibitedProviderInput, redactForAudit } from "@/lib/agents/redaction";
import { toPrismaJson } from "@/lib/services/json";
import { logConversationTurn } from "@/lib/services/conversation-turns";
import { logProcessEvent } from "@/lib/services/process-events";
import { updateAssessmentSessionPhase } from "@/lib/services/session-state";
import { createResponsePackage } from "@/lib/services/response-packages";
import {
  evaluateResponseQuality,
  responseQualityAllowsAdvance,
  responseQualityAuditPayload,
  type ResponseQualityResult,
  type ResponseQualityStage
} from "@/lib/services/student-assessment/response-quality";
import {
  buildInitialAdminPrompt,
  formatInitialAdminItemMessage,
  promptAuditPayload
} from "@/lib/student-assessment/initial-admin-prompts";
import { StudentAssessmentServiceError } from "./errors";

export const FormativeNeedSchema = z.enum([
  "diagnosis",
  "feedback",
  "scaffolding",
  "confidence_calibration",
  "scaffolding_and_feedback",
  "diagnosis_and_feedback"
]);
export const MatchedActivitySchema = z.enum([
  "confirmation_or_extension",
  "confidence_calibration",
  "scaffolded_reasoning",
  "key_distractor_contrast",
  "distractor_justification",
  "distractor_diagnosis",
  "distractor_repair",
  "answer_reasoning_alignment",
  "guided_elimination"
]);
export const NextExpectedActionSchema = z.enum([
  "respond_to_formative_activity",
  "revise_reasoning",
  "choose_next_step"
]);
export const TargetedFeedbackNextExpectedActionSchema = z.enum([
  "revise_reasoning",
  "revise_explanation",
  "revise_confidence",
  "choose_next_step"
]);
export const FormativeActivityNextActionSchema = z.enum([
  "confirm_and_next_choice",
  "ask_revision",
  "provide_scaffold",
  "clarify_question",
  "offer_transfer"
]);

export const ChatNativeFormativeProfileOutputSchema = z.object({
  provisional_learning_state: z.string().trim().min(1).max(600),
  main_issue: z.string().trim().min(1).max(600),
  formative_need: FormativeNeedSchema,
  matched_activity: MatchedActivitySchema,
  evidence_used: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
  confidence_calibration_flag: z.boolean(),
  answer_reasoning_alignment: z.string().trim().min(1).max(500),
  student_facing_pattern_statement: z.string().trim().min(1).max(350),
  student_facing_followup_prompt: z.string().trim().min(1).max(650),
  should_reveal_correct_answer: z.boolean(),
  next_expected_action: NextExpectedActionSchema
}).strict();

export type ChatNativeFormativeProfileOutput = z.infer<
  typeof ChatNativeFormativeProfileOutputSchema
>;

export const ChatNativeFormativeActivityEvaluationOutputSchema = z.object({
  learning_profile: z.object({
    concept_mastery: z.enum(["strong", "partial", "weak", "unclear"]),
    main_concept_understood: z.array(z.string().trim().min(1).max(220)).max(6),
    remaining_issue: z.array(z.string().trim().min(1).max(220)).max(6),
    misconception_evidence: z.array(z.string().trim().min(1).max(220)).max(6),
    reasoning_quality: z.enum([
      "sound",
      "partially_correct",
      "vague",
      "misconception_based",
      "off_topic"
    ]),
    confidence_calibration: z.enum(["aligned", "overconfident", "underconfident", "unknown"]),
    transfer_readiness: z.enum(["ready", "not_ready", "unclear"])
  }).strict(),
  engagement_profile: z.object({
    response_completeness: z.enum(["complete", "partial", "missing"]),
    help_seeking: z.enum(["none", "clarification_requested", "answer_requested", "off_topic"]),
    revision_effort: z.enum(["strong", "adequate", "minimal", "not_observed"]),
    engagement_level: z.enum(["active", "passive", "disengaged", "unclear"])
  }).strict(),
  formative_activity_evaluation: z.object({
    activity_was_appropriate: z.boolean(),
    activity_fit_reason: z.string().trim().min(1).max(500),
    student_response_evaluation: z.string().trim().min(1).max(700),
    next_action: FormativeActivityNextActionSchema,
    student_facing_feedback: z.string().trim().min(1).max(700),
    student_facing_next_prompt: z.string().trim().min(1).max(420)
  }).strict()
}).strict();

export type ChatNativeFormativeActivityEvaluationOutput = z.infer<
  typeof ChatNativeFormativeActivityEvaluationOutputSchema
>;

export const ChatNativeTargetedFeedbackOutputSchema =
  ChatNativeFormativeActivityEvaluationOutputSchema;

export type ChatNativeTargetedFeedbackOutput = ChatNativeFormativeActivityEvaluationOutput;

const CHAT_NATIVE_PROFILE_AGENT_NAME = "formative_value_and_planning_agent";
const CHAT_NATIVE_TARGETED_FEEDBACK_AGENT_NAME = "followup_agent";
const CHAT_NATIVE_PROFILE_AGENT_VERSION = "chat-native-phase5-v1";
const CHAT_NATIVE_TARGETED_FEEDBACK_AGENT_VERSION = "chat-native-phase6-v1";
const CHAT_NATIVE_PROFILE_PROMPT_VERSION = "chat-native-formative-profile-v1";
const CHAT_NATIVE_TARGETED_FEEDBACK_PROMPT_VERSION = "chat-native-formative-activity-evaluation-v1";
const CHAT_NATIVE_PROFILE_SCHEMA_VERSION = "chat-native-formative-profile-output-v1";
const CHAT_NATIVE_TARGETED_FEEDBACK_SCHEMA_VERSION = "chat-native-formative-activity-evaluation-output-v1";
const CHAT_NATIVE_PROFILE_INSTRUCTIONS = `
You are supporting a chat-native formative MCQ assessment after a protected three-item initial package.

Use the response package to produce exactly one short structured formative profile and one matched formative activity.
The application owns state transitions and persistence.

Student-facing text must:
- be short and conversational;
- speak directly to the student using you and your;
- briefly summarize the useful starting point, what still needs work, and what the next activity is trying to support;
- mention any deferred concern from the initial package only in safe summary form when it supports the next activity;
- avoid internal labels such as response profile, formative need, metadata, structured output, system prompt, or answer key;
- avoid visible template headings such as "What you did well:", "Reasoning detail:", "Earlier:", "Current focus:", or "Still developing:";
- not dump the full answer key;
- focus on one activity the student can answer next.

Use only these enum labels:
- formative_need: diagnosis, feedback, scaffolding, confidence_calibration, scaffolding_and_feedback, diagnosis_and_feedback
- matched_activity: confirmation_or_extension, confidence_calibration, scaffolded_reasoning, key_distractor_contrast, distractor_justification, distractor_diagnosis, distractor_repair, answer_reasoning_alignment, guided_elimination
- next_expected_action: respond_to_formative_activity

Do not include a separate student-facing status object. The application will compute the single visible status.
Set should_reveal_correct_answer to false.

Use the required JSON schema only.
`;
const CHAT_NATIVE_TARGETED_FEEDBACK_INSTRUCTIONS = `
You are supporting a chat-native formative MCQ assessment after the student has answered one matched formative activity.

Evaluate the student's formative response, update a provisional learning and engagement profile, and decide the next action.
The application owns all state transitions and persistence.

Student-facing text must:
- acknowledge a relevant part of the student's response;
- clarify the single main distinction when needed;
- avoid long lectures;
- ask for exactly one next prompt when a revision, clarification, or scaffold is needed;
- avoid the sentence "Please revise your answer, reasoning, or confidence based on this feedback.";
- avoid internal labels such as response profile, formative need, metadata, structured output, agent call, system prompt, or answer key;
- avoid visible template headings such as "What you did well:", "Reasoning detail:", "Earlier:", "Current focus:", or "Still developing:";
- not dump the full answer key;
- not restart the answer/reason/confidence/tempting-option cycle.

Use conservative next actions:
- confirm_and_next_choice only when the response is adequate;
- ask_revision when the response is partially correct;
- provide_scaffold when the response is confused or missing;
- clarify_question when the student asks a procedural or conceptual clarification question;
- offer_transfer only when the response is strong enough for transfer.

For the IRT discrimination case, if the student says the ICC is sharper when discrimination is higher and theta remains the person's location, confirm that the ICC sharpness idea is mostly right. Refine that discrimination affects slope, item information, and precision; theta remains the person's location on the latent trait scale; and the meaning of theta remains comparable across linked forms. Do not imply that item location necessarily stays the same unless item difficulty/location is explicitly being discussed.

Use the required JSON schema only.
`;
const CHAT_NATIVE_PROFILE_PROMPT_HASH = createHash("sha256")
  .update(CHAT_NATIVE_PROFILE_INSTRUCTIONS)
  .digest("hex");
const CHAT_NATIVE_TARGETED_FEEDBACK_PROMPT_HASH = createHash("sha256")
  .update(CHAT_NATIVE_TARGETED_FEEDBACK_INSTRUCTIONS)
  .digest("hex");
const FORMATIVE_ACTIVITY_AGENT_NAME = "chat_native_formative_activity";
const TARGETED_FEEDBACK_AGENT_NAME = "chat_native_targeted_feedback";
const TRANSFER_ITEM_AGENT_NAME = "deterministic_transfer_item";
const MAX_FORMATIVE_RESPONSE_CHARS = 5000;
const MAX_REVISION_CHARS = 5000;
const MAX_FORMATIVE_REPAIR_TURNS = 3;
const ASSESSMENT_TUTOR_UNAVAILABLE_MESSAGE =
  "The assessment tutor is temporarily unavailable. Your progress is saved. Please try again in a moment or pause and return later.";
const REPEATED_INVALID_RESPONSE_PROMPT =
  "I still cannot use that as a reason. Choose one:\nA. Try writing your reason again.\nB. Mark this as 'I don't know the reason yet.'";
const MAX_LOOP_GUARD_MESSAGE =
  "This concept may need more practice. You can try another question on the same idea or move on for now.";

function prismaJson(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

let chatNativeFormativeProviderOverrideForTest: LlmProvider | null = null;

export async function withChatNativeFormativeProviderForTest<T>(
  provider: LlmProvider,
  callback: () => Promise<T>
): Promise<T> {
  const previous = chatNativeFormativeProviderOverrideForTest;
  chatNativeFormativeProviderOverrideForTest = provider;

  try {
    return await callback();
  } finally {
    chatNativeFormativeProviderOverrideForTest = previous;
  }
}

function safeValidationMessage(message: string) {
  return message
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED_OPENAI_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [REDACTED_TOKEN]")
    .slice(0, 500);
}

function validationIssueSummaries(issues: z.ZodIssue[]) {
  return issues.map((issue) => ({
    path: issue.path.join(".") || "<root>",
    code: issue.code,
    message: safeValidationMessage(issue.message)
  }));
}

function validationErrorSummary(input: {
  category: "schema_validation" | "student_facing_validation";
  issues: string[] | ReturnType<typeof validationIssueSummaries>;
}) {
  return JSON.stringify({
    category: input.category,
    issues: input.issues
  });
}

function normalizeLabel(value: unknown) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ")
    : null;
}

function canonicalLabel<T extends string>(
  value: unknown,
  aliases: Record<string, T>
) {
  if (typeof value !== "string") {
    return value;
  }

  return aliases[normalizeLabel(value) ?? ""] ?? value;
}

const FORMATIVE_NEED_ALIASES: Record<string, z.infer<typeof FormativeNeedSchema>> = {
  "diagnostic feedback": "diagnosis_and_feedback",
  "diagnostic and feedback": "diagnosis_and_feedback",
  "diagnosis and feedback": "diagnosis_and_feedback",
  "diagnostic clarification": "diagnosis",
  "diagnostic": "diagnosis",
  "reasoning refinement": "scaffolding_and_feedback",
  "reasoning scaffolding": "scaffolding_and_feedback",
  "scaffolded reasoning": "scaffolding",
  "needs attention": "scaffolding_and_feedback",
  "developing": "scaffolding_and_feedback",
  "confidence calibration": "confidence_calibration",
  "feedback only": "feedback"
};

const MATCHED_ACTIVITY_ALIASES: Record<string, z.infer<typeof MatchedActivitySchema>> = {
  "distractor contrast": "key_distractor_contrast",
  "key distractor comparison": "key_distractor_contrast",
  "diagnostic clarification": "distractor_diagnosis",
  "diagnostic": "distractor_diagnosis",
  "reasoning refinement": "scaffolded_reasoning",
  "reasoning scaffolding": "scaffolded_reasoning",
  "developing": "scaffolded_reasoning",
  "needs attention": "scaffolded_reasoning",
  "confidence calibration": "confidence_calibration",
  "consolidation transfer": "confirmation_or_extension",
  "consolidation or transfer": "confirmation_or_extension"
};

const NEXT_EXPECTED_ACTION_ALIASES: Record<string, z.infer<typeof NextExpectedActionSchema>> = {
  "respond to activity": "respond_to_formative_activity",
  "respond to matched activity": "respond_to_formative_activity",
  "respond to formative followup": "respond_to_formative_activity",
  "respond to formative follow up": "respond_to_formative_activity",
  "complete formative activity": "respond_to_formative_activity"
};

const TARGETED_NEXT_ACTION_ALIASES: Record<string, z.infer<typeof FormativeActivityNextActionSchema>> = {
  "next choice": "confirm_and_next_choice",
  "choose next step": "confirm_and_next_choice",
  "ready for next choice": "confirm_and_next_choice",
  "revise": "ask_revision",
  "revision": "ask_revision",
  "ask for revision": "ask_revision",
  "scaffold": "provide_scaffold",
  "scaffolding": "provide_scaffold",
  "clarify": "clarify_question",
  "clarification": "clarify_question",
  "transfer": "offer_transfer"
};

const RIGID_VISIBLE_HEADING_PATTERN =
  /\b(?:What you did well|Still developing|Reasoning detail|Earlier|Current focus)\s*:/i;

function removeRigidVisibleHeadingPrefix(value: string) {
  return value.replace(
    /^\s*(?:What you did well|Still developing|Reasoning detail|Earlier|Current focus)\s*:\s*/i,
    ""
  );
}

function canonicalizeFormativeProfileOutput(value: unknown) {
  const source = jsonRecord(value);

  if (Object.keys(source).length === 0) {
    return value;
  }

  let usedAlias = false;
  const output: Record<string, unknown> = { ...source };
  const alias = (target: string, ...candidates: string[]) => {
    if (output[target] !== undefined) {
      return;
    }

    for (const candidate of candidates) {
      if (source[candidate] !== undefined) {
        output[target] = source[candidate];
        usedAlias = true;
        return;
      }
    }
  };

  alias("provisional_learning_state", "provisional_learning_profile", "learning_state");
  alias("student_facing_pattern_statement", "student_facing_profile_statement", "student_pattern_statement");
  alias("student_facing_followup_prompt", "student_facing_next_prompt", "student_facing_activity_prompt", "followup_prompt");

  output.formative_need = canonicalLabel(output.formative_need, FORMATIVE_NEED_ALIASES);
  output.matched_activity = canonicalLabel(output.matched_activity, MATCHED_ACTIVITY_ALIASES);
  output.next_expected_action = canonicalLabel(output.next_expected_action, NEXT_EXPECTED_ACTION_ALIASES);

  if (typeof output.student_facing_pattern_statement === "string") {
    output.student_facing_pattern_statement = removeRigidVisibleHeadingPrefix(
      output.student_facing_pattern_statement
    );
  }

  if (!usedAlias) {
    return output;
  }

  return {
    provisional_learning_state: output.provisional_learning_state,
    main_issue: output.main_issue,
    formative_need: output.formative_need,
    matched_activity: output.matched_activity,
    evidence_used: output.evidence_used,
    confidence_calibration_flag: output.confidence_calibration_flag,
    answer_reasoning_alignment: output.answer_reasoning_alignment,
    student_facing_pattern_statement: output.student_facing_pattern_statement,
    student_facing_followup_prompt: output.student_facing_followup_prompt,
    should_reveal_correct_answer: output.should_reveal_correct_answer,
    next_expected_action: output.next_expected_action
  };
}

function canonicalizeTargetedFeedbackOutput(value: unknown) {
  const output = jsonRecord(value);

  if (Object.keys(output).length === 0) {
    return value;
  }

  const evaluation = jsonRecord(output.formative_activity_evaluation);

  if (Object.keys(evaluation).length === 0) {
    return output;
  }

  return {
    ...output,
    formative_activity_evaluation: {
      ...evaluation,
      next_action: canonicalLabel(
        evaluation.next_action,
        TARGETED_NEXT_ACTION_ALIASES
      )
    }
  };
}

export function chatNativeProviderAuditUpdate(
  providerResult: StructuredAgentResult<unknown>
) {
  const rawOutput =
    providerResult.raw_output ?? sanitizedProviderFailureAudit(providerResult);

  return {
    provider: providerResult.provider,
    ...providerAuditMetadata(providerResult),
    raw_output: prismaJson(redactForAudit(rawOutput)),
    latency_ms: providerResult.latency_ms,
    input_tokens: providerResult.usage?.input_tokens,
    output_tokens: providerResult.usage?.output_tokens,
    total_tokens: providerResult.usage?.total_tokens,
    token_usage: providerResult.usage
      ? prismaJson(providerResult.usage.raw ?? providerResult.usage)
      : undefined
  };
}

function safeProviderErrorMessage(providerResult: StructuredAgentResult<unknown>) {
  const error = providerResult.error;

  if (!error) {
    return null;
  }

  return error.category === "unexpected_provider_response"
    ? "Unexpected provider error."
    : error.message;
}

function sanitizedProviderFailureAudit(providerResult: StructuredAgentResult<unknown>) {
  if (providerResult.status !== "failed") {
    return undefined;
  }

  const telemetry = providerResult.transport_telemetry;
  const normalized = telemetry?.normalized_error;

  return {
    provider_failure: {
      provider: providerResult.provider,
      status: providerResult.status,
      error: {
        category: providerResult.error?.category ?? null,
        type: normalized?.error_type ?? normalized?.error_name ?? null,
        code: normalized?.provider_error_code ?? null,
        message: safeProviderErrorMessage(providerResult),
        retryable: providerResult.error?.retryable ?? null
      },
      transport: {
        provider: telemetry?.provider ?? providerResult.provider,
        transport: telemetry?.transport ?? null,
        adapter_version: telemetry?.adapter_version ?? null,
        model_name: telemetry?.model_name ?? null,
        base_url_host: telemetry?.base_url_host ?? null,
        base_url_approved: telemetry?.base_url_approved ?? null,
        http_status: normalized?.http_status ?? telemetry?.http_status ?? null,
        typed_failure_reason: normalized?.typed_failure_reason ?? null,
        provider_error_code: normalized?.provider_error_code ?? null,
        provider_error_type: normalized?.provider_error_type ?? null,
        provider_error_param: normalized?.provider_error_param ?? null,
        network_category: normalized?.network_category ?? null,
        retry_after_ms: normalized?.retry_after_ms ?? telemetry?.retry_after_ms ?? null,
        has_http_response: normalized?.has_http_response ?? null,
        before_request_serialization: normalized?.before_request_serialization ?? null,
        request_serialization_completed: telemetry?.request_serialization_completed ?? null,
        fetch_invoked: normalized?.fetch_invoked ?? telemetry?.fetch_invoked ?? null,
        response_headers_received:
          normalized?.response_headers_received ?? telemetry?.response_headers_received ?? null,
        response_body_received:
          normalized?.response_body_received ?? telemetry?.response_body_received ?? null
      }
    }
  };
}

function providerFailureValidationMessage(input: {
  providerResult: StructuredAgentResult<unknown>;
  phaseLabel: string;
}) {
  const normalized = input.providerResult.transport_telemetry?.normalized_error;
  const parts = [
    `${input.phaseLabel} provider request failed before usable structured output; deterministic fallback used.`,
    `category=${input.providerResult.error?.category ?? "unknown"}`,
    `provider_status=${input.providerResult.status}`
  ];

  if (input.providerResult.error?.retryable !== undefined) {
    parts.push(`retryable=${input.providerResult.error.retryable}`);
  }

  if (normalized?.typed_failure_reason) {
    parts.push(`typed_failure_reason=${normalized.typed_failure_reason}`);
  }

  if (normalized?.http_status !== null && normalized?.http_status !== undefined) {
    parts.push(`http_status=${normalized.http_status}`);
  }

  if (normalized?.provider_error_code) {
    parts.push(`provider_error_code=${normalized.provider_error_code}`);
  }

  const message = safeProviderErrorMessage(input.providerResult);
  if (message) {
    parts.push(`message=${message}`);
  }

  return parts.join("; ");
}

function liveProviderResultBlocked(input: {
  provider_result: StructuredAgentResult<unknown> | null;
  validation_status: string;
}) {
  return Boolean(input.provider_result && input.validation_status !== "validated");
}

async function logLiveFormativeRuntimeBlocked(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  event_category: "formative_profile" | "formative_activity_evaluation";
  agent_call_id: string;
  validation_status: string;
  validation_issues: string[];
  provider_status: string | null;
}) {
  await logProcessEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    event_type: "llm_runtime_blocked",
    event_category: input.event_category,
    event_source: "backend",
    payload: {
      agent_call_id: input.agent_call_id,
      validation_status: input.validation_status,
      validation_issue_count: input.validation_issues.length,
      provider_status: input.provider_status
    }
  });
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function markUnknownChoiceRequested(text: string) {
  const lower = text.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    lower === "b" ||
    lower === "b." ||
    lower === "option b" ||
    lower === "mark unknown" ||
    lower === "mark this as i don't know" ||
    lower === "i don't know the reason yet"
  );
}

function responseQualityIsInsufficientKnowledge(result: ResponseQualityResult) {
  return result.output.response_quality === "insufficient_knowledge";
}

function unknownEvidenceText(stage: ResponseQualityStage) {
  return stage === "revision_response" ? "I don't know the reason yet." : "I don't know yet.";
}

function stringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function itemRoleFromRules(value: unknown): string | null {
  const rules = jsonRecord(value);
  const role = rules.item_role;
  return typeof role === "string" && role.trim() ? role.trim() : null;
}

function safeOptionEntries(value: unknown): Array<{ label: string; text: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const record = jsonRecord(entry);
      const label = stringValue(record, "label");
      const text = stringValue(record, "text");

      return label && text ? { label, text } : null;
    })
    .filter((entry): entry is { label: string; text: string } => Boolean(entry));
}

function transferItemAgentMessage(item: {
  item_public_id: string;
  item_order: number;
  item_stem: string;
  options: unknown;
}) {
  return formatInitialAdminItemMessage({
    item: {
      item_public_id: item.item_public_id,
      item_order: item.item_order,
      item_stem: item.item_stem,
      options: safeOptionEntries(item.options)
    },
    questionLabel: "Additional question",
    itemRole: "transfer"
  });
}

async function findTransferItemForConceptUnit(conceptUnitDbId: string) {
  const candidates = await prisma.item.findMany({
    where: {
      concept_unit_db_id: conceptUnitDbId,
      included_in_published_set: false,
      status: { not: "archived" }
    },
    orderBy: [{ item_order: "asc" }, { created_at: "asc" }]
  });

  return candidates.find((item) => itemRoleFromRules(item.administration_rules) === "transfer") ?? null;
}

function safePackageForProvider(payload: unknown) {
  const record = jsonRecord(payload);
  const conceptUnit = jsonRecord(record.concept_unit);

  return {
    package_type: stringValue(record, "package_type"),
    created_at: stringValue(record, "created_at"),
    assessment: {
      assessment_public_id: stringValue(jsonRecord(record.assessment), "assessment_public_id"),
      title: stringValue(jsonRecord(record.assessment), "title")
    },
    concept_unit: {
      concept_unit_public_id: stringValue(conceptUnit, "concept_unit_public_id"),
      title: stringValue(conceptUnit, "title"),
      learning_objective: stringValue(conceptUnit, "learning_objective"),
      related_concept_description: stringValue(conceptUnit, "related_concept_description")
    },
    included_items: arrayValue(record.included_items).map((entry) => {
      const item = jsonRecord(entry);

      return {
        item_public_id: stringValue(item, "item_public_id"),
        item_order: item.item_order,
        item_stem: stringValue(item, "item_stem"),
        options: item.options,
        item_role: stringValue(item, "item_role"),
        cognitive_demand: stringValue(item, "cognitive_demand"),
        difficulty: stringValue(item, "difficulty"),
        knowledge_component: stringValue(item, "knowledge_component"),
        misconception_cluster: stringValue(item, "misconception_cluster")
      };
    }),
    item_responses: arrayValue(record.item_responses).map((entry) => {
      const response = jsonRecord(entry);

      return {
        item_public_id: stringValue(response, "item_public_id"),
        item_order: response.item_order,
        item_role: stringValue(response, "item_role"),
        cognitive_demand: stringValue(response, "cognitive_demand"),
        difficulty: stringValue(response, "difficulty"),
        selected_answer_final: stringValue(response, "selected_answer_final"),
        correctness: stringValue(response, "correctness"),
        reasoning_text_final: stringValue(response, "reasoning_text_final"),
        confidence_final: stringValue(response, "confidence_final"),
        answer_changed: response.answer_changed === true,
        no_tempting_option: response.no_tempting_option === true,
        tempting_option: stringValue(response, "tempting_option"),
        tempting_option_reason: stringValue(response, "tempting_option_reason"),
        reasoning_submitted_at: stringValue(response, "reasoning_submitted_at"),
        confidence_selected_at: stringValue(response, "confidence_selected_at"),
        item_completed_at: stringValue(response, "item_completed_at"),
        total_item_time_ms:
          typeof response.total_item_time_ms === "number" ? response.total_item_time_ms : null
      };
    }),
    deferred_student_concerns: deferredConcernsFromPackagePayload(payload),
    process_counts: record.process_counts,
    logging_limitations: record.logging_limitations
  };
}

type DeferredStudentConcern = {
  concern_type: "content_question" | "procedural_question" | "uncertainty";
  safe_summary: string;
  source_stage: string | null;
};

function studentFacingPhrase(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return removeRigidVisibleHeadingPrefix(value).trim().replace(/\s+/g, " ")
    .replace(/\bThe student needs to\b/gi, "You may need to")
    .replace(/\bThe student needs\b/gi, "You may need")
    .replace(/\bThe student asked\b/gi, "You asked")
    .replace(/\bThe student\b/gi, "You")
    .replace(/\bstudents\b/gi, "you")
    .replace(/\btheir\b/gi, "your")
    .replace(/\bthey\b/gi, "you")
    .replace(/\bthem\b/gi, "you")
    .replace(/\blearner\b/gi, "you")
    .replace(/\bexaminee\b/gi, "you")
    .replace(/\bThe response\b/gi, "Your response")
    .replace(/\bThe answers\b/gi, "Your answers")
    .replace(/\bThe activity\b/gi, "This activity");
}

function concernSummaryFromText(text: string, quality: string | null): DeferredStudentConcern | null {
  const lower = text.toLowerCase();
  const concernType: DeferredStudentConcern["concern_type"] =
    quality === "clarification_question"
      ? "procedural_question"
      : /\b(confused|hard|not sure|don't know|dont know|idk|lost|stuck)\b/.test(lower)
        ? "uncertainty"
        : "content_question";

  let safeSummary = "how to think through the current idea";

  if (/\b(theta|ability|latent trait)\b/.test(lower) && /\b(difficulty|discrimination|parameter|item)\b/.test(lower)) {
    safeSummary = "how theta relates to item parameters";
  } else if (/\b(theta|ability|latent trait)\b/.test(lower)) {
    safeSummary = "what theta represents";
  } else if (/\b(difficulty|discrimination|parameter|item)\b/.test(lower)) {
    safeSummary = "how item parameters work";
  } else if (/\bwhat happens next|next|after\b/.test(lower)) {
    safeSummary = "what happens next";
  } else if (concernType === "uncertainty") {
    safeSummary = "that this felt confusing or hard to explain";
  }

  return {
    concern_type: concernType,
    safe_summary: safeSummary,
    source_stage: null
  };
}

function deferredConcernsFromPackagePayload(payload: unknown): DeferredStudentConcern[] {
  const record = jsonRecord(payload);
  const concerns: DeferredStudentConcern[] = [];
  const seen = new Set<string>();

  for (const entry of arrayValue(record.conversation_turns)) {
    const turn = jsonRecord(entry);
    const structured = jsonRecord(turn.structured_payload);
    const source = stringValue(structured, "source") ?? "";
    const quality = stringValue(structured, "response_quality");
    const deferredSummary = stringValue(structured, "deferred_concern_summary");
    const text = stringValue(turn, "message_text") ?? "";
    const isInitialRejectedStudentTurn =
      turn.actor_type === "student" &&
      source.startsWith("initial_") &&
      structured.validation_status === "response_quality_rejected" &&
      (
        ["content_question", "answer_request", "clarification_question"].includes(quality ?? "") ||
        Boolean(deferredSummary)
      );

    if (!isInitialRejectedStudentTurn) {
      continue;
    }

    const concern = deferredSummary
      ? {
          concern_type:
            quality === "answer_request"
              ? "content_question"
              : quality === "clarification_question"
                ? "procedural_question"
                : quality === "insufficient_knowledge"
                  ? "uncertainty"
                  : "content_question",
          safe_summary: deferredSummary.replace(/\.$/, ""),
          source_stage: null
        } satisfies DeferredStudentConcern
      : concernSummaryFromText(text, quality);

    if (concern && !seen.has(concern.safe_summary)) {
      concern.source_stage = stringValue(turn, "phase");
      concerns.push(concern);
      seen.add(concern.safe_summary);
    }
  }

  for (const entry of arrayValue(record.item_responses)) {
    const response = jsonRecord(entry);
    const reasoning = stringValue(response, "reasoning_text_final") ?? "";
    const concern = concernSummaryFromText(reasoning, "insufficient_knowledge");

    if (
      /\b(confused|hard|not sure|don't know|dont know|idk|no idea|lost|stuck)\b/i.test(reasoning) &&
      concern &&
      !seen.has(concern.safe_summary)
    ) {
      concern.source_stage = "initial_item_reasoning";
      concerns.push(concern);
      seen.add(concern.safe_summary);
    }
  }

  return concerns.slice(0, 3);
}

function correctOptionsFromPackage(payload: unknown) {
  const record = jsonRecord(payload);

  return arrayValue(record.item_responses)
    .map((entry) => stringValue(jsonRecord(entry), "correct_option_snapshot"))
    .filter((value): value is string => Boolean(value));
}

function deterministicMockOutput(): ChatNativeFormativeProfileOutput {
  return {
    provisional_learning_state:
      "Your response package shows some useful understanding, but the distinction between item parameters and person ability still needs clarification.",
    main_issue:
      "You may need to distinguish item difficulty from theta as a person-location estimate on the linked scale.",
    formative_need: "diagnosis_and_feedback",
    matched_activity: "key_distractor_contrast",
    evidence_used: [
      "Three-item initial response package",
      "Reasoning text and confidence ratings",
      "Tempting-option evidence from the fixed IRT item set"
    ],
    confidence_calibration_flag: true,
    answer_reasoning_alignment:
      "Your answers and explanations suggest partial alignment, but the item-parameter/theta distinction should be made more explicit.",
    student_facing_pattern_statement:
      "You seem to understand that theta should stay comparable across properly linked forms, and the item-parameter distinction still needs attention.",
    student_facing_followup_prompt:
      "Compare the idea of item difficulty with the idea of theta. Which one describes the item, and which one describes the person?",
    should_reveal_correct_answer: false,
    next_expected_action: "respond_to_formative_activity"
  };
}

function baseEngagementProfile(input?: Partial<ChatNativeTargetedFeedbackOutput["engagement_profile"]>) {
  return {
    response_completeness: input?.response_completeness ?? "partial",
    help_seeking: input?.help_seeking ?? "none",
    revision_effort: input?.revision_effort ?? "not_observed",
    engagement_level: input?.engagement_level ?? "active"
  } satisfies ChatNativeTargetedFeedbackOutput["engagement_profile"];
}

function deterministicTargetedFeedbackOutput(message = ""): ChatNativeTargetedFeedbackOutput {
  const lower = message.toLowerCase();
  const asksQuestion =
    lower.includes("?") ||
    /\b(can you|what does|what do you mean|explain|clarify|i don't understand)\b/.test(lower);
  const asksForAnswer = /\b(answer|correct answer|what is correct|tell me which)\b/.test(lower);
  const confused = /\b(confused|not sure|no idea|i don't know|idk|guess|lost)\b/.test(lower);
  const offTopic = /\b(lunch|weather|movie|game|unrelated)\b/.test(lower);
  const mentionsDiscrimination =
    /\b(discrimination|slope|steeper|sharper|icc|information|precision)\b/.test(lower);
  const mentionsItemParameters =
    /\b(item parameter|item parameters|difficulty|item behavior|item behaves)\b/.test(lower);
  const anchorsTheta = /\b(theta|person|latent trait|ability)\b/.test(lower);
  const saysComparable =
    /\b(comparable|linked|same scale|location|meaning|stays|remain|stable)\b/.test(lower);

  if (asksQuestion && !mentionsDiscrimination) {
    return {
      learning_profile: {
        concept_mastery: "unclear",
        main_concept_understood: [],
        remaining_issue: ["The student asked for clarification before attempting the activity."],
        misconception_evidence: [],
        reasoning_quality: "vague",
        confidence_calibration: "unknown",
        transfer_readiness: "unclear"
      },
      engagement_profile: baseEngagementProfile({
        response_completeness: "partial",
        help_seeking: asksForAnswer ? "answer_requested" : "clarification_requested",
        engagement_level: "active"
      }),
      formative_activity_evaluation: {
        activity_was_appropriate: true,
        activity_fit_reason:
          "The activity is still appropriate, but the student needs simpler wording before responding.",
        student_response_evaluation:
          "The student asked for clarification rather than giving enough evidence to evaluate the concept.",
        next_action: "clarify_question",
        student_facing_feedback:
          "Sure. Theta describes the person's location on the latent trait scale. Item parameters describe how an item behaves on that scale.",
        student_facing_next_prompt:
          "Try the activity again in simpler words: which part describes the person, and which part describes the item?"
      }
    };
  }

  if (confused || offTopic || message.trim().length < 20) {
    return {
      learning_profile: {
        concept_mastery: "weak",
        main_concept_understood: [],
        remaining_issue: ["The response does not yet distinguish theta from item parameters."],
        misconception_evidence: offTopic ? ["The response was off topic."] : [],
        reasoning_quality: offTopic ? "off_topic" : "vague",
        confidence_calibration: "unknown",
        transfer_readiness: "not_ready"
      },
      engagement_profile: baseEngagementProfile({
        response_completeness: message.trim().length < 20 ? "missing" : "partial",
        help_seeking: offTopic ? "off_topic" : "clarification_requested",
        engagement_level: offTopic ? "disengaged" : "passive"
      }),
      formative_activity_evaluation: {
        activity_was_appropriate: true,
        activity_fit_reason:
          "The activity targets the right distinction, but the student needs one scaffold before revising.",
        student_response_evaluation:
          "The response does not yet provide enough conceptual evidence.",
        next_action: "provide_scaffold",
        student_facing_feedback:
          "Let's build the idea one step at a time. In IRT, one part describes the person and one part describes the item.",
        student_facing_next_prompt:
          "Which term describes the person on the latent trait scale: theta or item difficulty?"
      }
    };
  }

  if (
    (mentionsDiscrimination || (mentionsItemParameters && /\b(item behavior|item behaves)\b/.test(lower))) &&
    anchorsTheta &&
    saysComparable
  ) {
    return {
      learning_profile: {
        concept_mastery: "strong",
        main_concept_understood: [
          "Higher discrimination makes the item characteristic curve steeper.",
          "Theta remains the person's location on the latent trait scale.",
          "Theta remains comparable across properly linked forms."
        ],
        remaining_issue: [
          "Avoid implying that item location necessarily stays fixed unless item difficulty is being discussed."
        ],
        misconception_evidence: [],
        reasoning_quality: "sound",
        confidence_calibration: "aligned",
        transfer_readiness: "ready"
      },
      engagement_profile: baseEngagementProfile({
        response_completeness: "complete",
        engagement_level: "active"
      }),
      formative_activity_evaluation: {
        activity_was_appropriate: true,
        activity_fit_reason:
          "The activity elicited evidence about discrimination, item information, and theta comparability.",
        student_response_evaluation:
          "The response is strong and only needs a small language refinement about item location.",
        next_action: "confirm_and_next_choice",
        student_facing_feedback:
          "That is mostly right. Higher discrimination makes the item curve steeper and can increase information or precision near the item location. Theta is still the person's location on the latent trait scale, so its meaning remains comparable across linked forms. Be careful not to say the item location itself stays the same unless item difficulty is the part being discussed.",
        student_facing_next_prompt:
          "Choose one: A. Move to the next concept. B. Try another question on the same idea."
      }
    };
  }

  return {
    learning_profile: {
      concept_mastery: "partial",
      main_concept_understood: [
        "Theta is associated with the person.",
        "Item difficulty or other item parameters are associated with items."
      ],
      remaining_issue: [
        "The response needs to connect the distinction to comparable theta estimates across linked forms."
      ],
      misconception_evidence: [],
      reasoning_quality: "partially_correct",
      confidence_calibration: "unknown",
      transfer_readiness: "not_ready"
    },
    engagement_profile: baseEngagementProfile({
      response_completeness: "partial",
      engagement_level: "active"
    }),
    formative_activity_evaluation: {
      activity_was_appropriate: true,
      activity_fit_reason:
        "The activity is appropriate because the response gives partial evidence about the core distinction.",
      student_response_evaluation:
        "The response is partly correct but needs a clearer link between item parameters and comparable theta estimates.",
      next_action: "ask_revision",
      student_facing_feedback:
        "You have the person-versus-item distinction started. Now make the comparison more precise: item difficulty or discrimination describes item behavior, while theta describes the person's location on the linked latent trait scale.",
      student_facing_next_prompt:
        "Revise in one or two sentences: why should theta remain comparable across properly linked forms even when item parameters differ?"
    }
  };
}

function nextActivityPurpose(output: ChatNativeFormativeProfileOutput) {
  const combined = `${output.main_issue} ${output.student_facing_followup_prompt}`.toLowerCase();

  if (/\b(theta|ability|latent trait)\b/.test(combined) && /\b(difficulty|discrimination|parameter|item)\b/.test(combined)) {
    return "The next activity is meant to help you separate item parameters from theta as a person-location estimate.";
  }

  return `The next activity is meant to help with this focus: ${studentFacingPhrase(output.main_issue)}`;
}

function reasoningDetailStatement(output: ChatNativeFormativeProfileOutput) {
  const alignment = studentFacingPhrase(output.answer_reasoning_alignment);
  const lower = alignment.toLowerCase();

  if (/\b(vague|more explicit|partial|not enough|needs?|detail)\b/.test(lower)) {
    return "Your explanations were useful, and adding a little more detail about why an option fits or does not fit would help me give more precise feedback.";
  }

  return `Your explanations gave useful evidence. ${alignment}`;
}

function variationIndex(output: ChatNativeFormativeProfileOutput) {
  const basis = `${output.main_issue}|${output.student_facing_followup_prompt}|${output.student_facing_pattern_statement}`;
  let total = 0;

  for (const char of basis) {
    total += char.charCodeAt(0);
  }

  return total % 3;
}

function concernSentence(concern: DeferredStudentConcern | undefined) {
  if (!concern) {
    return null;
  }

  if (/what theta means/i.test(concern.safe_summary)) {
    return "Since you asked what theta means, we can now make that clearer: theta is the person's estimated location on the latent trait scale.";
  }

  if (/item parameters|difficulty|discrimination/i.test(concern.safe_summary)) {
    return "Since you asked about item parameters, we can now connect that question to the difference between an item feature and a person's theta.";
  }

  if (concern.concern_type === "uncertainty") {
    return "You also signaled uncertainty earlier, so the next step is meant to make the key distinction easier to explain.";
  }

  return `You also raised a question about ${concern.safe_summary}, and we can address that now that the three responses are complete.`;
}

function studentFacingPostPackageSummary(
  output: ChatNativeFormativeProfileOutput,
  deferredConcerns: DeferredStudentConcern[] = []
) {
  const concern = deferredConcerns[0];
  const openings = [
    "I have enough from your three responses to choose a focused next step.",
    "Your three responses give us a useful starting point for feedback.",
    "Now that the first three questions are complete, we can work on the main idea that needs attention."
  ];
  const pattern = studentFacingPhrase(output.student_facing_pattern_statement);
  const mainIssue = studentFacingPhrase(output.main_issue);
  const sentences = [
    openings[variationIndex(output)],
    pattern,
    `The part to strengthen is ${mainIssue.charAt(0).toLowerCase()}${mainIssue.slice(1)}`,
    reasoningDetailStatement(output),
    concernSentence(concern),
    nextActivityPurpose(output)
  ].filter((line): line is string => Boolean(line));

  return sentences.slice(0, 5).join(" ");
}

function studentFacingText(output: ChatNativeFormativeProfileOutput) {
  return `${studentFacingPostPackageSummary(output)}\n\n${output.student_facing_followup_prompt}`;
}

function targetedFeedbackStudentFacingText(output: ChatNativeTargetedFeedbackOutput) {
  return `${output.formative_activity_evaluation.student_facing_feedback}\n\n${output.formative_activity_evaluation.student_facing_next_prompt}`;
}

async function logFormativeResponseQuality(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  followup_round_db_id: string;
  phase: "planning_completed" | "followup_active";
  stage: ResponseQualityStage;
  result: ResponseQualityResult;
  text_length: number;
  student_facing_message_override?: string;
}) {
  const now = new Date();
  const payload = {
    stage: input.stage,
    text_length: input.text_length,
    ...responseQualityAuditPayload(input.result)
  };

  await logProcessEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    event_type: "response_quality_checked",
    event_category: "response_quality",
    event_source: input.result.source === "llm" ? "agent" : "backend",
    payload,
    occurred_at: now
  });

  if (responseQualityIsInsufficientKnowledge(input.result)) {
    await logProcessEvent({
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      event_type: "insufficient_knowledge_marked",
      event_category: "response_quality",
      event_source: "backend",
      payload,
      occurred_at: now
    });
  }

  if (responseQualityAllowsAdvance(input.result.output)) {
    return;
  }

  await logProcessEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    event_type: "response_quality_rejected",
    event_category: "response_quality",
    event_source: "backend",
    payload,
    occurred_at: now
  });

  const quality = input.result.output.response_quality;
  const extraEvent =
    quality === "clarification_question"
      ? "clarification_answered"
      : quality === "content_question" || quality === "answer_request"
        ? "content_question_deferred"
        : quality === "edit_request"
          ? "edit_request_detected"
          : null;

  if (extraEvent) {
    await logProcessEvent({
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      event_type: extraEvent,
      event_category: "response_quality",
      event_source: "backend",
      payload,
      occurred_at: now
    });
  }

  await logConversationTurn({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    followup_round_db_id: input.followup_round_db_id,
    phase: input.phase,
    actor_type: "agent",
    agent_name: "chat_native_response_quality_gate",
    message_text: input.student_facing_message_override ?? input.result.output.student_facing_message,
    structured_payload: prismaJson({
      source: "response_quality_gate",
      message_type: "repair_prompt",
      stage: input.stage,
      repeated_invalid_response: Boolean(input.student_facing_message_override)
    }),
    created_at: now
  });
}

async function countPriorFormativeRejectedAttempts(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  stage: ResponseQualityStage;
}) {
  const events = await prisma.processEvent.findMany({
    where: {
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      event_type: "response_quality_rejected",
      event_category: "response_quality"
    },
    select: { payload: true },
    orderBy: [{ occurred_at: "desc" }, { created_at: "desc" }],
    take: 20
  });

  return events.filter((event) => jsonRecord(event.payload).stage === input.stage).length;
}

async function logRepeatedFormativeInvalidResponse(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  stage: ResponseQualityStage;
  attempt_count: number;
}) {
  await logProcessEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    event_type: "repeated_invalid_response",
    event_category: "response_quality",
    event_source: "backend",
    payload: {
      stage: input.stage,
      attempt_count: input.attempt_count
    }
  });
}

async function stopFollowupForMaxLoopGuard(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  followup_round_db_id: string;
  stage: ResponseQualityStage;
  attempt_count: number;
}) {
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const existingPrompt = await tx.conversationTurn.findFirst({
      where: {
        followup_round_db_id: input.followup_round_db_id,
        actor_type: "agent",
        structured_payload: {
          path: ["source"],
          equals: "chat_native_formative_loop_guard"
        }
      },
      select: { id: true }
    });

    if (!existingPrompt) {
      await tx.conversationTurn.create({
        data: {
          assessment_session_db_id: input.assessment_session_db_id,
          concept_unit_session_db_id: input.concept_unit_session_db_id,
          followup_round_db_id: input.followup_round_db_id,
          phase: "followup_active",
          actor_type: "agent",
          agent_name: "chat_native_formative_loop_guard",
          message_text: MAX_LOOP_GUARD_MESSAGE,
          structured_payload: prismaJson({
            source: "chat_native_formative_loop_guard",
            message_type: "max_loop_guard",
            stage: input.stage,
            attempt_count: input.attempt_count
          }),
          created_at: now
        }
      });
    }

    await tx.followupRound.update({
      where: { id: input.followup_round_db_id },
      data: {
        status: "stopped",
        completed_at: now
      }
    });
    await tx.conceptUnitSession.update({
      where: { id: input.concept_unit_session_db_id },
      data: {
        status: "followup_completed",
        followup_status: "stopped",
        followup_completed_at: now
      }
    });
  });

  await updateAssessmentSessionPhase({
    assessment_session_db_id: input.assessment_session_db_id,
    to_phase: "followup_stopped",
    reason: "chat_native_formative_loop_guard",
    payload: {
      stage: input.stage,
      attempt_count: input.attempt_count
    }
  });
  await logProcessEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    event_type: "formative_loop_guard_triggered",
    event_category: "formative_loop",
    event_source: "backend",
    payload: {
      stage: input.stage,
      attempt_count: input.attempt_count,
      max_attempts: MAX_FORMATIVE_REPAIR_TURNS
    },
    occurred_at: now
  });
  await logProcessEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    event_type: "next_choice_shown",
    event_category: "next_choice",
    event_source: "backend",
    payload: {
      reason: "max_formative_repair_turns",
      options: ["move_to_next_concept", "try_another_question_same_idea"]
    },
    occurred_at: now
  });
}

function validateStudentFacingOutput(input: {
  output: ChatNativeFormativeProfileOutput;
  correct_options: string[];
}) {
  const issues: string[] = [];
  const visibleText = studentFacingText(input.output);
  const lower = visibleText.toLowerCase();
  const forbiddenTerms = [
    "response profile",
    "formative need",
    "metadata",
    "answer key",
    "system prompt",
    "structured output",
    "agent call",
    "llm decision"
  ];

  for (const term of forbiddenTerms) {
    if (lower.includes(term)) {
      issues.push(`student-facing text includes internal term: ${term}`);
    }
  }

  if (input.output.should_reveal_correct_answer) {
    issues.push("should_reveal_correct_answer must remain false in Phase 5");
  }

  if (visibleText.length > 1000) {
    issues.push("student-facing text is too long for chat");
  }

  if (RIGID_VISIBLE_HEADING_PATTERN.test(visibleText)) {
    issues.push("student-facing text includes rigid visible heading labels");
  }

  const uniqueCorrectOptions = [...new Set(input.correct_options)];
  const mentionedCorrectOptions = uniqueCorrectOptions.filter((option) =>
    new RegExp(`\\b${option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(visibleText)
  );

  if (
    uniqueCorrectOptions.length >= 3 &&
    mentionedCorrectOptions.length >= uniqueCorrectOptions.length &&
    /correct|answer/i.test(visibleText)
  ) {
    issues.push("student-facing text appears to reveal the full answer key");
  }

  if (input.output.next_expected_action !== "respond_to_formative_activity") {
    issues.push("next_expected_action must be respond_to_formative_activity in Phase 5");
  }

  return { ok: issues.length === 0, issues };
}

function validateTargetedFeedbackOutput(input: {
  output: ChatNativeTargetedFeedbackOutput;
  correct_options: string[];
}) {
  const issues: string[] = [];
  const visibleText = targetedFeedbackStudentFacingText(input.output);
  const lower = visibleText.toLowerCase();
  const nextPrompt = input.output.formative_activity_evaluation.student_facing_next_prompt;
  const nextPromptLower = nextPrompt.toLowerCase();
  const forbiddenTerms = [
    "learning profile",
    "engagement profile",
    "response profile",
    "formative need",
    "metadata",
    "answer key",
    "system prompt",
    "structured output",
    "agent call",
    "llm decision"
  ];

  for (const term of forbiddenTerms) {
    if (lower.includes(term)) {
      issues.push(`student-facing text includes internal term: ${term}`);
    }
  }

  if (
    lower.includes("please revise your answer, reasoning, or confidence based on this feedback")
  ) {
    issues.push("revision prompt uses the prohibited generic revision sentence");
  }

  if (RIGID_VISIBLE_HEADING_PATTERN.test(visibleText)) {
    issues.push("targeted feedback includes rigid visible heading labels");
  }

  if (visibleText.length > 900) {
    issues.push("targeted feedback is too long for chat");
  }

  const taskStarts = (
    nextPromptLower.match(/\b(now|tell me|give|update|restate|revise|try|which)\b/g) ?? []
  ).length;
  const questionCount = (nextPrompt.match(/\?/g) ?? []).length;

  if (questionCount > 1 || taskStarts > 3 || nextPromptLower.includes(" and then ")) {
    issues.push("next prompt appears to ask for more than one task");
  }

  if (/what is your answer|how confident|was another option tempting/i.test(visibleText)) {
    issues.push("targeted feedback restarts the protected initial item cycle");
  }

  if (
    input.output.formative_activity_evaluation.next_action === "confirm_and_next_choice" &&
    input.output.learning_profile.transfer_readiness === "not_ready"
  ) {
    issues.push("next choice cannot be offered when transfer readiness is not_ready");
  }

  const uniqueCorrectOptions = [...new Set(input.correct_options)];
  const mentionedCorrectOptions = uniqueCorrectOptions.filter((option) =>
    new RegExp(`\\b${option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(visibleText)
  );

  if (
    uniqueCorrectOptions.length >= 3 &&
    mentionedCorrectOptions.length >= uniqueCorrectOptions.length &&
    /correct|answer/i.test(visibleText)
  ) {
    issues.push("student-facing text appears to reveal the full answer key");
  }

  return { ok: issues.length === 0, issues };
}

function nextActionIsReadyForChoice(output: ChatNativeTargetedFeedbackOutput) {
  return (
    output.formative_activity_evaluation.next_action === "confirm_and_next_choice" ||
    output.formative_activity_evaluation.next_action === "offer_transfer"
  );
}

function promptMessageTypeFor(output: ChatNativeTargetedFeedbackOutput) {
  switch (output.formative_activity_evaluation.next_action) {
    case "provide_scaffold":
      return "scaffold_prompt";
    case "clarify_question":
      return "clarification_prompt";
    case "ask_revision":
      return "revision_prompt";
    case "confirm_and_next_choice":
    case "offer_transfer":
      return "next_choice_ready";
  }
}

function profileEnumsForActivityEvaluation(output: ChatNativeTargetedFeedbackOutput) {
  const hasMisconceptionEvidence = output.learning_profile.misconception_evidence.length > 0;

  const abilityProfile =
    output.learning_profile.concept_mastery === "strong"
      ? output.learning_profile.transfer_readiness === "ready"
        ? "robust_transfer_ready_understanding"
        : "mostly_correct_understanding"
      : output.learning_profile.concept_mastery === "partial"
        ? "partial_understanding"
        : hasMisconceptionEvidence
          ? "misconception_based_understanding"
          : "fragmented_or_limited_understanding";

  const engagementProfile =
    output.engagement_profile.engagement_level === "active"
      ? "productive_engagement"
      : output.engagement_profile.engagement_level === "passive"
        ? "variable_engagement"
        : output.engagement_profile.engagement_level === "disengaged"
          ? "low_engagement"
          : "insufficient_process_evidence";

  const integratedDiagnosticProfile =
    output.learning_profile.concept_mastery === "strong" &&
    output.learning_profile.transfer_readiness === "ready"
      ? "robust_understanding_ready_for_transfer"
      : hasMisconceptionEvidence
        ? "misconception_with_sufficient_engagement"
        : output.learning_profile.concept_mastery === "partial"
          ? "developing_understanding_with_productive_engagement"
          : "conflicting_evidence_needs_clarification";

  const confidenceAlignment =
    output.learning_profile.confidence_calibration === "aligned"
      ? "well_calibrated"
      : output.learning_profile.confidence_calibration === "overconfident"
        ? "overconfident"
        : output.learning_profile.confidence_calibration === "underconfident"
          ? "underconfident"
          : "insufficient_evidence";

  const evidenceSufficiency =
    output.engagement_profile.response_completeness === "complete"
      ? "strong"
      : output.engagement_profile.response_completeness === "partial"
        ? "adequate"
        : "limited";

  return {
    ability_profile: abilityProfile,
    engagement_profile: engagementProfile,
    integrated_diagnostic_profile: integratedDiagnosticProfile,
    confidence_alignment: confidenceAlignment,
    evidence_sufficiency: evidenceSufficiency
  } as const;
}

function activityResponseMessageFromProviderInput(value: unknown) {
  const record = jsonRecord(value);
  const activityResponse = jsonRecord(record.student_formative_activity_response);
  return stringValue(activityResponse, "message_text") ?? "";
}

async function persistFormativeActivityEvaluationProfile(input: {
  concept_unit_session_db_id: string;
  agent_call_id: string;
  output: ChatNativeTargetedFeedbackOutput;
  validation_status: string;
  validation_issues: string[];
}) {
  const existing = await prisma.studentProfile.findFirst({
    where: {
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      profile_type: "updated",
      based_on_agent_call_db_id: input.agent_call_id
    },
    orderBy: [{ created_at: "desc" }]
  });

  if (existing) {
    await prisma.conceptUnitSession.update({
      where: { id: input.concept_unit_session_db_id },
      data: { latest_student_profile_db_id: existing.id }
    });
    return existing;
  }

  const enums = profileEnumsForActivityEvaluation(input.output);
  const evaluation = input.output.formative_activity_evaluation;
  const profile = await prisma.studentProfile.create({
    data: {
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      profile_type: "updated",
      ability_profile: enums.ability_profile,
      ability_pattern_flags: prismaJson(input.output.learning_profile),
      engagement_profile: enums.engagement_profile,
      engagement_pattern_flags: prismaJson(input.output.engagement_profile),
      integrated_diagnostic_profile: enums.integrated_diagnostic_profile,
      integrated_profile_confidence: input.output.learning_profile.concept_mastery === "strong" ? "high" : "medium",
      integrated_profile_rationale: evaluation.student_response_evaluation,
      evidence_sufficiency: enums.evidence_sufficiency,
      confidence_alignment: enums.confidence_alignment,
      independence_interpretability: "not_applicable",
      misconception_indicators: prismaJson(input.output.learning_profile.misconception_evidence),
      item_level_evidence: prismaJson({
        formative_activity_evaluation: evaluation,
        validation_status: input.validation_status,
        validation_issues: input.validation_issues
      }),
      reasoning_quality_summary: evaluation.student_response_evaluation,
      engagement_summary: [
        `Response completeness: ${input.output.engagement_profile.response_completeness}.`,
        `Help seeking: ${input.output.engagement_profile.help_seeking}.`,
        `Engagement level: ${input.output.engagement_profile.engagement_level}.`
      ].join(" "),
      process_interpretation_cautions: prismaJson([
        "Process data are contextual evidence, not misconduct evidence.",
        "This profile update is based on the student's formative activity response."
      ]),
      profile_confidence: input.output.learning_profile.concept_mastery === "strong" ? "high" : "medium",
      rationale: evaluation.activity_fit_reason,
      recommended_next_evidence: prismaJson({
        next_action: evaluation.next_action,
        student_facing_next_prompt: evaluation.student_facing_next_prompt
      }),
      based_on_agent_call_db_id: input.agent_call_id
    }
  });

  await prisma.conceptUnitSession.update({
    where: { id: input.concept_unit_session_db_id },
    data: { latest_student_profile_db_id: profile.id }
  });

  return profile;
}

function formativeValueFor(output: ChatNativeFormativeProfileOutput) {
  const byActivity: Partial<Record<z.infer<typeof MatchedActivitySchema>, z.infer<typeof FormativeValueSchema>>> = {
    confirmation_or_extension: "consolidation_or_transfer",
    confidence_calibration: "confidence_calibration",
    scaffolded_reasoning: "reasoning_refinement",
    key_distractor_contrast: "diagnostic_clarification",
    distractor_justification: "diagnostic_clarification",
    distractor_diagnosis: "diagnostic_clarification",
    distractor_repair: "reasoning_refinement",
    answer_reasoning_alignment: "reasoning_refinement",
    guided_elimination: "reasoning_refinement"
  };

  return byActivity[output.matched_activity] ?? (
    output.formative_need === "confidence_calibration"
      ? "confidence_calibration"
      : output.formative_need.includes("diagnosis")
        ? "diagnostic_clarification"
        : "reasoning_refinement"
  );
}

function profileEnumsFor(output: ChatNativeFormativeProfileOutput) {
  const state = output.provisional_learning_state.toLowerCase();
  const issue = output.main_issue.toLowerCase();

  return {
    ability_profile: state.includes("robust")
      ? "mostly_correct_understanding"
      : issue.includes("misconception")
        ? "misconception_based_understanding"
        : "partial_understanding",
    integrated_diagnostic_profile: issue.includes("misconception")
      ? "misconception_with_sufficient_engagement"
      : output.confidence_calibration_flag
        ? "underconfident_but_reasoning_supported"
        : "developing_understanding_with_productive_engagement",
    confidence_alignment: output.confidence_calibration_flag ? "mixed" : "well_calibrated"
  } as const;
}

async function latestInitialResponsePackage(conceptUnitSessionDbId: string) {
  return prisma.responsePackage.findFirst({
    where: {
      concept_unit_session_db_id: conceptUnitSessionDbId,
      package_type: "initial_concept_unit_response_package"
    },
    orderBy: [{ created_at: "desc" }]
  });
}

async function callProviderOrMock(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  agent_invocation_key: string;
  provider_input: unknown;
  correct_options: string[];
}) {
  const startedAt = new Date();
  let runtimeProvider: "mock" | "openai" = "mock";
  let modelName = "mock-chat-native-formative-profile";
  let liveCallAllowed = false;

  try {
    const runtime = getLlmRuntimeConfig();
    runtimeProvider = runtime.provider;
    liveCallAllowed = runtime.provider === "openai" && runtime.live_calls_enabled;

    if (liveCallAllowed) {
      modelName = resolveAgentModelConfig(CHAT_NATIVE_PROFILE_AGENT_NAME).model_name;
    }
  } catch {
    runtimeProvider = "mock";
    liveCallAllowed = false;
  }

  const agentCall = await prisma.agentCall.create({
    data: {
      id: randomUUID(),
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      agent_name: CHAT_NATIVE_PROFILE_AGENT_NAME,
      agent_version: CHAT_NATIVE_PROFILE_AGENT_VERSION,
      model_name: modelName,
      provider: runtimeProvider,
      client_request_id: `chat_native_profile_${randomUUID()}`,
      agent_invocation_key: input.agent_invocation_key,
      prompt_hash: CHAT_NATIVE_PROFILE_PROMPT_HASH,
      prompt_version: CHAT_NATIVE_PROFILE_PROMPT_VERSION,
      schema_version: CHAT_NATIVE_PROFILE_SCHEMA_VERSION,
      input_payload: prismaJson(redactForAudit(input.provider_input)),
      live_call_allowed: liveCallAllowed,
      call_status: "started",
      started_at: startedAt
    }
  });

  if (!liveCallAllowed) {
    const output = deterministicMockOutput();
    const validation = validateStudentFacingOutput({
      output,
      correct_options: input.correct_options
    });

    await prisma.agentCall.update({
      where: { id: agentCall.id },
      data: {
        raw_output: prismaJson({ provider: "mock", output }),
        output_payload: prismaJson(output),
        output_validated: validation.ok,
        validation_error: validation.ok ? null : validation.issues.join("; "),
        call_status: validation.ok ? "succeeded" : "invalid_output",
        error_category: validation.ok ? null : "schema_validation",
        retry_count: 0,
        latency_ms: Math.max(0, Date.now() - startedAt.getTime()),
        token_usage: prismaJson({ mock: true }),
        completed_at: new Date()
      }
    });

    return {
      agent_call_id: agentCall.id,
      output: validation.ok ? output : deterministicMockOutput(),
      validation_status: validation.ok ? "validated" : "fallback_after_validation_failure",
      validation_issues: validation.issues,
      provider_result: null as StructuredAgentResult<ChatNativeFormativeProfileOutput> | null
    };
  }

  assertNoProhibitedProviderInput(input.provider_input);
  const provider = chatNativeFormativeProviderOverrideForTest ?? createLlmProvider();
  const modelConfig = resolveAgentModelConfig(CHAT_NATIVE_PROFILE_AGENT_NAME);
  const providerResult = await provider.executeStructured({
    agent_name: CHAT_NATIVE_PROFILE_AGENT_NAME,
    model_config: modelConfig,
    instructions: CHAT_NATIVE_PROFILE_INSTRUCTIONS,
    input: input.provider_input,
    output_schema: ChatNativeFormativeProfileOutputSchema,
    schema_name: CHAT_NATIVE_PROFILE_SCHEMA_VERSION.replace(/[^a-zA-Z0-9_-]/g, "_"),
    client_request_id: agentCall.client_request_id ?? `chat_native_profile_${randomUUID()}`,
    timeout_ms: getLlmRuntimeConfig().request_timeout_ms,
    metadata: {
      purpose: "chat_native_formative_profile",
      prompt_version: CHAT_NATIVE_PROFILE_PROMPT_VERSION,
      schema_version: CHAT_NATIVE_PROFILE_SCHEMA_VERSION
    }
  });
  let validationIssues: string[] | ReturnType<typeof validationIssueSummaries> = [
    "provider_output_not_student_safe_or_not_completed"
  ];
  let validationCategory: "schema_validation" | "student_facing_validation" = "schema_validation";

  if (providerResult.status === "completed") {
    const normalizedOutput = canonicalizeFormativeProfileOutput(providerResult.parsed_output);
    const parsed = ChatNativeFormativeProfileOutputSchema.safeParse(normalizedOutput);
    const validation = parsed.success
      ? validateStudentFacingOutput({ output: parsed.data, correct_options: input.correct_options })
      : { ok: false, issues: validationIssueSummaries(parsed.error.issues) };

    if (parsed.success && validation.ok) {
      await prisma.agentCall.update({
        where: { id: agentCall.id },
        data: {
          ...chatNativeProviderAuditUpdate(providerResult),
          output_payload: prismaJson(parsed.data),
          output_validated: true,
          call_status: "succeeded",
          completed_at: new Date()
        }
      });

      return {
        agent_call_id: agentCall.id,
        output: parsed.data,
        validation_status: "validated",
        validation_issues: [] as string[],
        provider_result: providerResult
      };
    }

    validationIssues = validation.issues;
    validationCategory = parsed.success ? "student_facing_validation" : "schema_validation";
  }

  const fallbackOutput = deterministicMockOutput();
  await prisma.agentCall.update({
    where: { id: agentCall.id },
    data: {
      ...chatNativeProviderAuditUpdate(providerResult),
      output_payload: Prisma.JsonNull,
      output_validated: false,
      validation_error:
        providerResult.status === "completed"
          ? validationErrorSummary({
              category: validationCategory,
              issues: validationIssues
            })
          : providerFailureValidationMessage({
              providerResult,
              phaseLabel: "Phase 5 formative profile"
            }),
      call_status: providerResult.status === "completed" ? "invalid_output" : "failed",
      error_category:
        providerResult.status === "completed" ? "schema_validation" : providerResult.error?.category,
      completed_at: new Date()
    }
  });

  return {
    agent_call_id: agentCall.id,
    output: fallbackOutput,
    validation_status:
      providerResult.status === "completed"
        ? "blocked_after_validation_failure"
        : "blocked_after_provider_failure",
    validation_issues: validationIssues.map((issue) =>
      typeof issue === "string" ? issue : `${issue.path}: ${issue.message}`
    ),
    provider_result: providerResult
  };
}

function safeProfileForProvider(profile: {
  profile_type: string;
  ability_profile: string;
  engagement_profile: string;
  integrated_diagnostic_profile: string;
  integrated_profile_confidence: string;
  integrated_profile_rationale: string;
  evidence_sufficiency: string;
  confidence_alignment: string;
  reasoning_quality_summary: string;
  engagement_summary: string;
  rationale: string;
  recommended_next_evidence: unknown;
} | null) {
  if (!profile) {
    return null;
  }

  return {
    profile_type: profile.profile_type,
    ability_profile: profile.ability_profile,
    engagement_profile: profile.engagement_profile,
    integrated_diagnostic_profile: profile.integrated_diagnostic_profile,
    integrated_profile_confidence: profile.integrated_profile_confidence,
    integrated_profile_rationale: profile.integrated_profile_rationale,
    evidence_sufficiency: profile.evidence_sufficiency,
    confidence_alignment: profile.confidence_alignment,
    reasoning_quality_summary: profile.reasoning_quality_summary,
    engagement_summary: profile.engagement_summary,
    rationale: profile.rationale,
    recommended_next_evidence: profile.recommended_next_evidence
  };
}

function safeDecisionForProvider(decision: {
  formative_value: string;
  formative_action_plan: string;
  target_evidence: unknown;
  success_criteria: unknown;
  rationale: string;
  mapping_followed: boolean;
  mapping_deviation_reason: string | null;
} | null) {
  if (!decision) {
    return null;
  }

  return {
    formative_value: decision.formative_value,
    formative_action_plan: decision.formative_action_plan,
    target_evidence: decision.target_evidence,
    success_criteria: decision.success_criteria,
    rationale: decision.rationale,
    mapping_followed: decision.mapping_followed,
    mapping_deviation_reason: decision.mapping_deviation_reason
  };
}

async function targetedFeedbackAlreadyShown(roundDbId: string) {
  const turn = await prisma.conversationTurn.findFirst({
    where: {
      followup_round_db_id: roundDbId,
      agent_name: TARGETED_FEEDBACK_AGENT_NAME
    },
    select: { id: true, structured_payload: true }
  });

  return Boolean(turn);
}

async function callTargetedFeedbackProviderOrMock(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  followup_round_db_id: string;
  agent_invocation_key: string;
  provider_input: unknown;
  correct_options: string[];
}) {
  const startedAt = new Date();
  let runtimeProvider: "mock" | "openai" = "mock";
  let modelName = "mock-chat-native-targeted-feedback";
  let liveCallAllowed = false;

  try {
    const runtime = getLlmRuntimeConfig();
    runtimeProvider = runtime.provider;
    liveCallAllowed = runtime.provider === "openai" && runtime.live_calls_enabled;

    if (liveCallAllowed) {
      modelName = resolveAgentModelConfig(CHAT_NATIVE_TARGETED_FEEDBACK_AGENT_NAME).model_name;
    }
  } catch {
    runtimeProvider = "mock";
    liveCallAllowed = false;
  }

  const agentCall = await prisma.agentCall.create({
    data: {
      id: randomUUID(),
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      followup_round_db_id: input.followup_round_db_id,
      agent_name: CHAT_NATIVE_TARGETED_FEEDBACK_AGENT_NAME,
      agent_version: CHAT_NATIVE_TARGETED_FEEDBACK_AGENT_VERSION,
      model_name: modelName,
      provider: runtimeProvider,
      client_request_id: `chat_native_targeted_feedback_${randomUUID()}`,
      agent_invocation_key: input.agent_invocation_key,
      prompt_hash: CHAT_NATIVE_TARGETED_FEEDBACK_PROMPT_HASH,
      prompt_version: CHAT_NATIVE_TARGETED_FEEDBACK_PROMPT_VERSION,
      schema_version: CHAT_NATIVE_TARGETED_FEEDBACK_SCHEMA_VERSION,
      input_payload: prismaJson(redactForAudit(input.provider_input)),
      live_call_allowed: liveCallAllowed,
      call_status: "started",
      started_at: startedAt
    }
  });

  if (!liveCallAllowed) {
    const activityResponseMessage = activityResponseMessageFromProviderInput(input.provider_input);
    const output = deterministicTargetedFeedbackOutput(activityResponseMessage);
    const validation = validateTargetedFeedbackOutput({
      output,
      correct_options: input.correct_options
    });

    await prisma.agentCall.update({
      where: { id: agentCall.id },
      data: {
        raw_output: prismaJson({ provider: "mock", output }),
        output_payload: prismaJson(output),
        output_validated: validation.ok,
        validation_error: validation.ok ? null : validation.issues.join("; "),
        call_status: validation.ok ? "succeeded" : "invalid_output",
        error_category: validation.ok ? null : "schema_validation",
        retry_count: 0,
        latency_ms: Math.max(0, Date.now() - startedAt.getTime()),
        token_usage: prismaJson({ mock: true }),
        completed_at: new Date()
      }
    });

    return {
      agent_call_id: agentCall.id,
      output: validation.ok ? output : deterministicTargetedFeedbackOutput(activityResponseMessage),
      validation_status: validation.ok ? "validated" : "fallback_after_validation_failure",
      validation_issues: validation.issues,
      provider_result: null as StructuredAgentResult<ChatNativeTargetedFeedbackOutput> | null
    };
  }

  assertNoProhibitedProviderInput(input.provider_input);
  const provider = chatNativeFormativeProviderOverrideForTest ?? createLlmProvider();
  const modelConfig = resolveAgentModelConfig(CHAT_NATIVE_TARGETED_FEEDBACK_AGENT_NAME);
  const providerResult = await provider.executeStructured({
    agent_name: CHAT_NATIVE_TARGETED_FEEDBACK_AGENT_NAME,
    model_config: modelConfig,
    instructions: CHAT_NATIVE_TARGETED_FEEDBACK_INSTRUCTIONS,
    input: input.provider_input,
    output_schema: ChatNativeTargetedFeedbackOutputSchema,
    schema_name: CHAT_NATIVE_TARGETED_FEEDBACK_SCHEMA_VERSION.replace(/[^a-zA-Z0-9_-]/g, "_"),
    client_request_id: agentCall.client_request_id ?? `chat_native_targeted_feedback_${randomUUID()}`,
    timeout_ms: getLlmRuntimeConfig().request_timeout_ms,
    metadata: {
      purpose: "chat_native_targeted_feedback",
      prompt_version: CHAT_NATIVE_TARGETED_FEEDBACK_PROMPT_VERSION,
      schema_version: CHAT_NATIVE_TARGETED_FEEDBACK_SCHEMA_VERSION
    }
  });
  let validationIssues: string[] | ReturnType<typeof validationIssueSummaries> = [
    "provider_output_not_student_safe_or_not_completed"
  ];
  let validationCategory: "schema_validation" | "student_facing_validation" = "schema_validation";

  if (providerResult.status === "completed") {
    const normalizedOutput = canonicalizeTargetedFeedbackOutput(providerResult.parsed_output);
    const parsed = ChatNativeTargetedFeedbackOutputSchema.safeParse(normalizedOutput);
    const validation = parsed.success
      ? validateTargetedFeedbackOutput({ output: parsed.data, correct_options: input.correct_options })
      : { ok: false, issues: validationIssueSummaries(parsed.error.issues) };

    if (parsed.success && validation.ok) {
      await prisma.agentCall.update({
        where: { id: agentCall.id },
        data: {
          ...chatNativeProviderAuditUpdate(providerResult),
          output_payload: prismaJson(parsed.data),
          output_validated: true,
          call_status: "succeeded",
          completed_at: new Date()
        }
      });

      return {
        agent_call_id: agentCall.id,
        output: parsed.data,
        validation_status: "validated",
        validation_issues: [] as string[],
        provider_result: providerResult
      };
    }

    validationIssues = validation.issues;
    validationCategory = parsed.success ? "student_facing_validation" : "schema_validation";
  }

  const fallbackOutput = deterministicTargetedFeedbackOutput(
    activityResponseMessageFromProviderInput(input.provider_input)
  );
  await prisma.agentCall.update({
    where: { id: agentCall.id },
    data: {
      ...chatNativeProviderAuditUpdate(providerResult),
      output_payload: Prisma.JsonNull,
      output_validated: false,
      validation_error:
        providerResult.status === "completed"
          ? validationErrorSummary({
              category: validationCategory,
              issues: validationIssues
            })
          : providerFailureValidationMessage({
              providerResult,
              phaseLabel: "Phase 12 formative activity evaluation"
            }),
      call_status: providerResult.status === "completed" ? "invalid_output" : "failed",
      error_category:
        providerResult.status === "completed" ? "schema_validation" : providerResult.error?.category,
      completed_at: new Date()
    }
  });

  return {
    agent_call_id: agentCall.id,
    output: fallbackOutput,
    validation_status:
      providerResult.status === "completed"
        ? "blocked_after_validation_failure"
        : "blocked_after_provider_failure",
    validation_issues: validationIssues.map((issue) =>
      typeof issue === "string" ? issue : `${issue.path}: ${issue.message}`
    ),
    provider_result: providerResult
  };
}

async function ensureTargetedFeedbackAndRevisionPrompt(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  followup_round_db_id: string;
  activity_response_turn_db_id: string;
  trigger_kind?: "activity_response" | "revision_response";
}) {
  const triggerKind = input.trigger_kind ?? "activity_response";

  if (
    triggerKind === "activity_response" &&
    (await targetedFeedbackAlreadyShown(input.followup_round_db_id))
  ) {
    return { status: "already_created" as const, next_action: null };
  }

  const [responsePackage, profile, decision, activityResponseTurn] = await Promise.all([
    latestInitialResponsePackage(input.concept_unit_session_db_id),
    prisma.studentProfile.findFirst({
      where: { concept_unit_session_db_id: input.concept_unit_session_db_id },
      orderBy: [{ created_at: "desc" }]
    }),
    prisma.formativeDecision.findFirst({
      where: { concept_unit_session_db_id: input.concept_unit_session_db_id },
      orderBy: [{ created_at: "desc" }]
    }),
    prisma.conversationTurn.findUnique({
      where: { id: input.activity_response_turn_db_id },
      select: { id: true, message_text: true, created_at: true }
    })
  ]);

  if (!responsePackage || !activityResponseTurn) {
    throw new StudentAssessmentServiceError(
      "conflict",
      "Targeted feedback requires a response package and formative activity response.",
      409
    );
  }

  const providerInput = {
    task: "chat_native_phase12_formative_activity_evaluation",
    response_package: safePackageForProvider(responsePackage.payload),
    formative_profile: safeProfileForProvider(profile),
    formative_decision: safeDecisionForProvider(decision),
    student_formative_activity_response: {
      message_text: activityResponseTurn.message_text,
      submitted_at: activityResponseTurn.created_at.toISOString()
    },
    constraints: {
      app_controls_state_transitions: true,
      evaluate_activity_before_next_choice: true,
      update_learning_and_engagement_profiles: true,
      one_student_facing_next_prompt_only: true,
      next_choice_only_when_ready: true,
      no_full_answer_key_dump: true,
      no_internal_labels_in_student_text: true,
      do_not_restart_initial_cycle: true
    }
  };
  assertNoProhibitedProviderInput(providerInput);

  const invocationKey = createHash("sha256")
    .update(
      JSON.stringify({
        followup_round_db_id: input.followup_round_db_id,
        activity_response_turn_db_id: input.activity_response_turn_db_id,
        prompt_hash: CHAT_NATIVE_TARGETED_FEEDBACK_PROMPT_HASH,
        schema_version: CHAT_NATIVE_TARGETED_FEEDBACK_SCHEMA_VERSION
      })
    )
    .digest("hex");
  const existingCall = await prisma.agentCall.findUnique({
    where: { agent_invocation_key: invocationKey }
  });
  let feedbackResult:
    | Awaited<ReturnType<typeof callTargetedFeedbackProviderOrMock>>
    | null = null;

  if (existingCall?.call_status === "succeeded" && existingCall.output_payload) {
    const parsed = ChatNativeTargetedFeedbackOutputSchema.safeParse(existingCall.output_payload);

    if (parsed.success) {
      feedbackResult = {
        agent_call_id: existingCall.id,
        output: parsed.data,
        validation_status: "validated_idempotent_replay",
        validation_issues: [],
        provider_result: null
      };
    }
  }

  if (!feedbackResult) {
    feedbackResult = await callTargetedFeedbackProviderOrMock({
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      followup_round_db_id: input.followup_round_db_id,
      agent_invocation_key: invocationKey,
      provider_input: providerInput,
      correct_options: correctOptionsFromPackage(responsePackage.payload)
    });
  }

  if (liveProviderResultBlocked({
    provider_result: feedbackResult.provider_result,
    validation_status: feedbackResult.validation_status
  })) {
    await logLiveFormativeRuntimeBlocked({
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      event_category: "formative_activity_evaluation",
      agent_call_id: feedbackResult.agent_call_id,
      validation_status: feedbackResult.validation_status,
      validation_issues: feedbackResult.validation_issues,
      provider_status: feedbackResult.provider_result?.status ?? null
    });
    throw new StudentAssessmentServiceError(
      "llm_not_ready",
      ASSESSMENT_TUTOR_UNAVAILABLE_MESSAGE,
      409,
      {
        agent_call_id: feedbackResult.agent_call_id,
        validation_status: feedbackResult.validation_status
      }
    );
  }

  const now = new Date();
  const updatedProfile = await persistFormativeActivityEvaluationProfile({
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    agent_call_id: feedbackResult.agent_call_id,
    output: feedbackResult.output,
    validation_status: feedbackResult.validation_status,
    validation_issues: feedbackResult.validation_issues
  });
  const readyForNextChoice = nextActionIsReadyForChoice(feedbackResult.output);
  const promptMessageType = promptMessageTypeFor(feedbackResult.output);
  const nextAction = feedbackResult.output.formative_activity_evaluation.next_action;

  await prisma.$transaction(async (tx) => {
    const alreadyCreated = await tx.conversationTurn.findFirst({
      where: {
        followup_round_db_id: input.followup_round_db_id,
        agent_name: TARGETED_FEEDBACK_AGENT_NAME,
        structured_payload: {
          path: ["based_on_agent_call_id"],
          equals: feedbackResult.agent_call_id
        }
      },
      select: { id: true }
    });

    if (alreadyCreated) {
      return;
    }

    await tx.conversationTurn.create({
      data: {
        assessment_session_db_id: input.assessment_session_db_id,
        concept_unit_session_db_id: input.concept_unit_session_db_id,
        followup_round_db_id: input.followup_round_db_id,
        phase: "followup_active",
        actor_type: "agent",
        agent_name: TARGETED_FEEDBACK_AGENT_NAME,
        message_text: feedbackResult.output.formative_activity_evaluation.student_facing_feedback,
        structured_payload: prismaJson({
          source: TARGETED_FEEDBACK_AGENT_NAME,
          message_type: "targeted_feedback",
          next_action: nextAction,
          based_on_agent_call_id: feedbackResult.agent_call_id,
          updated_student_profile_db_id: updatedProfile.id,
          validation_status: feedbackResult.validation_status,
          validation_issues: feedbackResult.validation_issues
        }),
        created_at: now
      }
    });

    if (readyForNextChoice) {
      await tx.followupRound.update({
        where: { id: input.followup_round_db_id },
        data: {
          status: "stopped",
          completed_at: now,
          updated_student_profile_db_id: updatedProfile.id
        }
      });
      await tx.conceptUnitSession.update({
        where: { id: input.concept_unit_session_db_id },
        data: {
          status: "followup_completed",
          followup_status: "stopped",
          followup_completed_at: now,
          latest_student_profile_db_id: updatedProfile.id
        }
      });
    } else {
      await tx.conversationTurn.create({
        data: {
          assessment_session_db_id: input.assessment_session_db_id,
          concept_unit_session_db_id: input.concept_unit_session_db_id,
          followup_round_db_id: input.followup_round_db_id,
          phase: "followup_active",
          actor_type: "agent",
          agent_name: TARGETED_FEEDBACK_AGENT_NAME,
          message_text: feedbackResult.output.formative_activity_evaluation.student_facing_next_prompt,
          structured_payload: prismaJson({
            source: TARGETED_FEEDBACK_AGENT_NAME,
            message_type: promptMessageType,
            next_action: nextAction,
            based_on_agent_call_id: feedbackResult.agent_call_id,
            updated_student_profile_db_id: updatedProfile.id
          }),
          created_at: now
        }
      });
    }
  });

  await updateAssessmentSessionPhase({
    assessment_session_db_id: input.assessment_session_db_id,
    to_phase: readyForNextChoice ? "followup_stopped" : "followup_active",
    reason: readyForNextChoice
      ? "chat_native_formative_activity_ready_for_next_choice"
      : "chat_native_formative_activity_revision_needed",
    payload: {
      agent_call_id: feedbackResult.agent_call_id,
      updated_student_profile_db_id: updatedProfile.id,
      next_action: nextAction
    }
  });
  await logProcessEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    event_type: "targeted_feedback_shown",
    event_category: "targeted_feedback",
    event_source: "backend",
    payload: {
      agent_call_id: feedbackResult.agent_call_id,
      validation_status: feedbackResult.validation_status,
      next_action: nextAction
    },
    occurred_at: now
  });
  await logProcessEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    event_type: "formative_activity_evaluated",
    event_category: "formative_activity_evaluation",
    event_source: "backend",
    payload: {
      agent_call_id: feedbackResult.agent_call_id,
      updated_student_profile_db_id: updatedProfile.id,
      next_action: nextAction,
      validation_status: feedbackResult.validation_status
    },
    occurred_at: now
  });
  await logProcessEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    event_type: "learning_profile_updated",
    event_category: "formative_activity_evaluation",
    event_source: "backend",
    payload: {
      agent_call_id: feedbackResult.agent_call_id,
      updated_student_profile_db_id: updatedProfile.id,
      learning_profile: feedbackResult.output.learning_profile
    },
    occurred_at: now
  });
  await logProcessEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    event_type: "engagement_profile_updated",
    event_category: "formative_activity_evaluation",
    event_source: "backend",
    payload: {
      agent_call_id: feedbackResult.agent_call_id,
      updated_student_profile_db_id: updatedProfile.id,
      engagement_profile: feedbackResult.output.engagement_profile
    },
    occurred_at: now
  });

  if (!readyForNextChoice) {
    await logProcessEvent({
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      event_type: "revision_requested",
      event_category: nextAction === "provide_scaffold" ? "scaffold" : "revision",
      event_source: "backend",
      payload: {
        agent_call_id: feedbackResult.agent_call_id,
        next_action: nextAction,
        prompt_message_type: promptMessageType
      },
      occurred_at: now
    });
  }

  if (nextAction === "provide_scaffold") {
    await logProcessEvent({
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      event_type: "scaffold_prompt_shown",
      event_category: "scaffold",
      event_source: "backend",
      payload: {
        agent_call_id: feedbackResult.agent_call_id,
        updated_student_profile_db_id: updatedProfile.id
      },
      occurred_at: now
    });
  }

  if (readyForNextChoice) {
    await logProcessEvent({
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      event_type: "next_choice_shown",
      event_category: "next_choice",
      event_source: "backend",
      payload: {
        agent_call_id: feedbackResult.agent_call_id,
        next_action: nextAction,
        options: ["move_to_next_concept", "try_another_question_same_idea"]
      },
      occurred_at: now
    });
  }

  return {
    status: "created" as const,
    agent_call_id: feedbackResult.agent_call_id,
    next_action: nextAction
  };
}

async function persistProfileDecisionAndActivity(input: {
  concept_unit_session_db_id: string;
  assessment_session_db_id: string;
  agent_call_id: string;
  output: ChatNativeFormativeProfileOutput;
  validation_status: string;
  validation_issues: string[];
  deferred_student_concerns?: DeferredStudentConcern[];
}) {
  const enums = profileEnumsFor(input.output);
  const formativeValue = formativeValueFor(input.output);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const existingRound = await tx.followupRound.findFirst({
      where: {
        concept_unit_session_db_id: input.concept_unit_session_db_id,
        status: { in: ["active", "completed"] }
      },
      orderBy: [{ round_index: "desc" }]
    });

    if (existingRound) {
      return {
        status: "already_created" as const,
        round: existingRound
      };
    }

    const profile = await tx.studentProfile.create({
      data: {
        concept_unit_session_db_id: input.concept_unit_session_db_id,
        profile_type: "initial",
        ability_profile: enums.ability_profile,
        ability_pattern_flags: prismaJson(["no_clear_pattern"]),
        engagement_profile: "adequate_engagement",
        engagement_pattern_flags: prismaJson(["no_clear_pattern"]),
        integrated_diagnostic_profile: enums.integrated_diagnostic_profile,
        integrated_profile_confidence: "medium",
        integrated_profile_rationale: input.output.provisional_learning_state,
        evidence_sufficiency: "adequate",
        confidence_alignment: enums.confidence_alignment,
        independence_interpretability: "not_applicable",
        misconception_indicators: prismaJson([
          {
            indicator: input.output.main_issue,
            evidence_reference: "initial_three_item_package",
            confidence: "medium",
            rationale: input.output.answer_reasoning_alignment
          }
        ]),
        item_level_evidence: prismaJson(input.output.evidence_used),
        reasoning_quality_summary: input.output.answer_reasoning_alignment,
        engagement_summary:
          "Initial chat-native package was completed with answer, reasoning, confidence, and tempting-option evidence.",
        process_interpretation_cautions: prismaJson([
          "Process data are contextual evidence, not misconduct evidence.",
          "This Phase 5 profile is provisional and used only to select one formative activity."
        ]),
        profile_confidence: "medium",
        rationale: input.output.main_issue,
        recommended_next_evidence: prismaJson([
          {
            evidence_type: input.output.matched_activity,
            reason: input.output.student_facing_followup_prompt,
            item_public_id: null
          }
        ]),
        based_on_agent_call_db_id: input.agent_call_id
      }
    });
    const decision = await tx.formativeDecision.create({
      data: {
        concept_unit_session_db_id: input.concept_unit_session_db_id,
        student_profile_db_id: profile.id,
        formative_value: formativeValue,
        formative_action_plan: input.output.student_facing_followup_prompt,
        target_evidence: prismaJson(input.output.evidence_used),
        success_criteria: prismaJson([
          "Student response addresses the distinction named in the matched formative activity.",
          input.output.answer_reasoning_alignment
        ]),
        followup_prompt_constraints: prismaJson([
          "Show only the student-facing pattern statement and one formative activity.",
          "Do not reveal the full answer key.",
          "Do not provide targeted feedback until the next phase."
        ]),
        profile_update_triggers: prismaJson([
          "Student responds to the Phase 5 formative activity."
        ]),
        rationale: input.output.main_issue,
        mapping_followed: true,
        mapping_deviation_reason: null,
        based_on_agent_call_db_id: input.agent_call_id
      }
    });
    const latest = await tx.followupRound.findFirst({
      where: { concept_unit_session_db_id: input.concept_unit_session_db_id },
      orderBy: [{ round_index: "desc" }],
      select: { round_index: true }
    });
    const round = await tx.followupRound.create({
      data: {
        concept_unit_session_db_id: input.concept_unit_session_db_id,
        round_index: (latest?.round_index ?? 0) + 1,
        formative_decision_db_id: decision.id,
        status: "active",
        started_at: now
      }
    });

    await tx.conceptUnitSession.update({
      where: { id: input.concept_unit_session_db_id },
      data: {
        latest_student_profile_db_id: profile.id,
        latest_formative_decision_db_id: decision.id,
        followup_status: "active",
        followup_started_at: now,
        followup_round_count: { increment: 1 }
      }
    });

    const postPackageSummary = studentFacingPostPackageSummary(
      input.output,
      input.deferred_student_concerns ?? []
    );

    await tx.conversationTurn.create({
      data: {
        assessment_session_db_id: input.assessment_session_db_id,
        concept_unit_session_db_id: input.concept_unit_session_db_id,
        followup_round_db_id: round.id,
        phase: "planning_completed",
        actor_type: "agent",
        agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
        message_text: postPackageSummary,
        structured_payload: prismaJson({
          source: FORMATIVE_ACTIVITY_AGENT_NAME,
          message_type: "pattern_statement",
          summary_version: "student-facing-post-package-summary-v1",
          deferred_student_concerns: input.deferred_student_concerns ?? [],
          validation_status: input.validation_status,
          validation_issues: input.validation_issues
        }),
        created_at: now
      }
    });
    await tx.conversationTurn.create({
      data: {
        assessment_session_db_id: input.assessment_session_db_id,
        concept_unit_session_db_id: input.concept_unit_session_db_id,
        followup_round_db_id: round.id,
        phase: "planning_completed",
        actor_type: "agent",
        agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
        message_text: input.output.student_facing_followup_prompt,
        structured_payload: prismaJson({
          source: FORMATIVE_ACTIVITY_AGENT_NAME,
          message_type: "matched_formative_activity",
          matched_activity: input.output.matched_activity,
          next_expected_action: input.output.next_expected_action
        }),
        created_at: now
      }
    });

    return {
      status: "created" as const,
      profile,
      decision,
      round
    };
  });
}

export async function ensureChatNativeFormativeActivity(input: {
  concept_unit_session_db_id: string;
  invocation_reason: string;
}) {
  const conceptUnitSession = await prisma.conceptUnitSession.findUniqueOrThrow({
    where: { id: input.concept_unit_session_db_id },
    select: {
      id: true,
      initial_completed_at: true,
      assessment_session_db_id: true,
      assessment_session: {
        select: {
          id: true,
          current_phase: true,
          session_public_id: true
        }
      }
    }
  });

  if (!conceptUnitSession.initial_completed_at) {
    throw new Error("Initial package must be completed before formative profiling.");
  }

  const existingRound = await prisma.followupRound.findFirst({
    where: {
      concept_unit_session_db_id: conceptUnitSession.id,
      status: { in: ["active", "completed"] }
    },
    orderBy: [{ round_index: "desc" }]
  });

  if (existingRound) {
    return {
      status: "already_created" as const,
      round_id: existingRound.id
    };
  }

  let responsePackage = await latestInitialResponsePackage(conceptUnitSession.id);

  if (!responsePackage) {
    responsePackage = await createResponsePackage({
      concept_unit_session_db_id: conceptUnitSession.id,
      package_type: "initial_concept_unit_response_package"
    });
  }
  const safeResponsePackage = safePackageForProvider(responsePackage.payload);
  const deferredStudentConcerns = deferredConcernsFromPackagePayload(responsePackage.payload);

  const providerInput = {
    task: "chat_native_phase5_formative_profile",
    response_package: safeResponsePackage,
    deferred_student_concerns: deferredStudentConcerns,
    constraints: {
      app_controls_state_transitions: true,
      one_focused_activity_only: true,
      no_full_answer_key_dump: true,
      no_internal_labels_in_student_text: true,
      targeted_feedback_deferred_to_next_phase: true
    }
  };
  assertNoProhibitedProviderInput(providerInput);
  const invocationKey = createHash("sha256")
    .update(
      JSON.stringify({
        concept_unit_session_db_id: conceptUnitSession.id,
        response_package_id: responsePackage.id,
        prompt_hash: CHAT_NATIVE_PROFILE_PROMPT_HASH,
        schema_version: CHAT_NATIVE_PROFILE_SCHEMA_VERSION
      })
    )
    .digest("hex");
  const existingCall = await prisma.agentCall.findUnique({
    where: { agent_invocation_key: invocationKey }
  });

  if (existingCall?.call_status === "succeeded" && existingCall.output_payload) {
    const parsed = ChatNativeFormativeProfileOutputSchema.safeParse(existingCall.output_payload);

    if (parsed.success) {
      const persisted = await persistProfileDecisionAndActivity({
        concept_unit_session_db_id: conceptUnitSession.id,
        assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
        agent_call_id: existingCall.id,
        output: parsed.data,
        validation_status: "validated_idempotent_replay",
        validation_issues: [],
        deferred_student_concerns: deferredStudentConcerns
      });

      if (conceptUnitSession.assessment_session.current_phase === "profiling_pending") {
        await updateAssessmentSessionPhase({
          assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
          to_phase: "profiling_completed",
          reason: "chat_native_formative_profile_replayed"
        });
      }
      const latestSession = await prisma.assessmentSession.findUniqueOrThrow({
        where: { id: conceptUnitSession.assessment_session_db_id },
        select: { current_phase: true }
      });

      if (latestSession.current_phase === "profiling_completed") {
        await updateAssessmentSessionPhase({
          assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
          to_phase: "planning_pending",
          reason: "chat_native_formative_activity_replayed"
        });
        await updateAssessmentSessionPhase({
          assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
          to_phase: "planning_completed",
          reason: "chat_native_formative_activity_ready"
        });
      }

      return {
        status: persisted.status,
        agent_call_id: existingCall.id
      };
    }
  }

  await logProcessEvent({
    assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
    concept_unit_session_db_id: conceptUnitSession.id,
    event_type: "llm_profile_requested",
    event_category: "formative_profile",
    event_source: "backend",
    payload: {
      invocation_reason: input.invocation_reason,
      response_package_type: responsePackage.package_type
    }
  });

  const providerResult = await callProviderOrMock({
    assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
    concept_unit_session_db_id: conceptUnitSession.id,
    agent_invocation_key: invocationKey,
    provider_input: providerInput,
    correct_options: correctOptionsFromPackage(responsePackage.payload)
  });

  await logProcessEvent({
    assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
    concept_unit_session_db_id: conceptUnitSession.id,
    event_type: "llm_profile_received",
    event_category: "formative_profile",
    event_source: "backend",
    payload: {
      agent_call_id: providerResult.agent_call_id,
      validation_status: providerResult.validation_status,
      provider_status: providerResult.provider_result?.status ?? "mock_fallback"
    }
  });

  if (liveProviderResultBlocked({
    provider_result: providerResult.provider_result,
    validation_status: providerResult.validation_status
  })) {
    await logLiveFormativeRuntimeBlocked({
      assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
      concept_unit_session_db_id: conceptUnitSession.id,
      event_category: "formative_profile",
      agent_call_id: providerResult.agent_call_id,
      validation_status: providerResult.validation_status,
      validation_issues: providerResult.validation_issues,
      provider_status: providerResult.provider_result?.status ?? null
    });
    throw new StudentAssessmentServiceError(
      "llm_not_ready",
      ASSESSMENT_TUTOR_UNAVAILABLE_MESSAGE,
      409,
      {
        agent_call_id: providerResult.agent_call_id,
        validation_status: providerResult.validation_status
      }
    );
  }

  if (conceptUnitSession.assessment_session.current_phase === "profiling_pending") {
    await updateAssessmentSessionPhase({
      assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
      to_phase: "profiling_completed",
      reason: "chat_native_formative_profile_completed",
      payload: { agent_call_id: providerResult.agent_call_id }
    });
  }
  const currentAfterProfile = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: conceptUnitSession.assessment_session_db_id },
    select: { current_phase: true }
  });

  if (currentAfterProfile.current_phase === "profiling_completed") {
    await updateAssessmentSessionPhase({
      assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
      to_phase: "planning_pending",
      reason: "chat_native_formative_activity_planning_started",
      payload: { agent_call_id: providerResult.agent_call_id }
    });
  }

  const persisted = await persistProfileDecisionAndActivity({
    concept_unit_session_db_id: conceptUnitSession.id,
    assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
    agent_call_id: providerResult.agent_call_id,
    output: providerResult.output,
    validation_status: providerResult.validation_status,
    validation_issues: providerResult.validation_issues,
    deferred_student_concerns: deferredStudentConcerns
  });

  const currentAfterPersist = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: conceptUnitSession.assessment_session_db_id },
    select: { current_phase: true }
  });

  if (currentAfterPersist.current_phase === "planning_pending") {
    await updateAssessmentSessionPhase({
      assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
      to_phase: "planning_completed",
      reason: "chat_native_formative_activity_ready",
      payload: {
        agent_call_id: providerResult.agent_call_id,
        review_target: "student_facing_formative_activity"
      }
    });
  }

  await logProcessEvent({
    assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
    concept_unit_session_db_id: conceptUnitSession.id,
    event_type: "formative_activity_shown",
    event_category: "formative_activity",
    event_source: "backend",
    payload: {
      agent_call_id: providerResult.agent_call_id,
      matched_activity: providerResult.output.matched_activity,
      persistence_status: persisted.status
    }
  });

  return {
    status: persisted.status,
    agent_call_id: providerResult.agent_call_id
  };
}

export async function submitChatNativeFormativeActivityResponse(input: {
  student_user_db_id: string;
  session_public_id: string;
  message: string;
  client_message_id: string;
}) {
  const message = input.message.trim();

  if (!message) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "Enter a response before sending.",
      400
    );
  }

  if (message.length > MAX_FORMATIVE_RESPONSE_CHARS) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      `Keep the response under ${MAX_FORMATIVE_RESPONSE_CHARS} characters.`,
      400
    );
  }

  const session = await prisma.assessmentSession.findFirst({
    where: {
      session_public_id: input.session_public_id,
      user_db_id: input.student_user_db_id
    },
    select: {
      id: true,
      current_phase: true,
      current_concept_unit_db_id: true
    }
  });

  if (!session) {
    throw new StudentAssessmentServiceError(
      "session_not_owned",
      "Session was not found for this student.",
      403
    );
  }

  if (!session.current_concept_unit_db_id) {
    throw new StudentAssessmentServiceError(
      "concept_unit_not_current",
      "No current concept unit is set for this session.",
      409
    );
  }

  const conceptUnitSession = await prisma.conceptUnitSession.findUnique({
    where: {
      assessment_session_db_id_concept_unit_db_id: {
        assessment_session_db_id: session.id,
        concept_unit_db_id: session.current_concept_unit_db_id
      }
    },
    select: { id: true }
  });

  if (!conceptUnitSession) {
    throw new StudentAssessmentServiceError(
      "concept_unit_not_current",
      "Current concept-unit session was not found.",
      409
    );
  }

  const round = await prisma.followupRound.findFirst({
    where: {
      concept_unit_session_db_id: conceptUnitSession.id,
      status: "active"
    },
    orderBy: [{ round_index: "desc" }]
  });

  if (!round) {
    throw new StudentAssessmentServiceError(
      "active_followup_round_required",
      "The formative activity is not currently accepting responses.",
      409
    );
  }
  const idempotencyWhere = {
    assessment_session_db_id_client_action_id: {
      assessment_session_db_id: session.id,
      client_action_id: input.client_message_id
    }
  };
  const existingKey = await prisma.studentActionIdempotencyKey.findUnique({
    where: idempotencyWhere
  });

  if (existingKey?.response_payload && typeof existingKey.response_payload === "object") {
    return existingKey.response_payload as Record<string, unknown>;
  }

  if (session.current_phase !== "planning_completed") {
    throw new StudentAssessmentServiceError(
      "invalid_phase_for_action",
      "The formative activity is not currently accepting responses.",
      409,
      { current_phase: session.current_phase }
    );
  }

  if (!existingKey) {
    await prisma.studentActionIdempotencyKey.create({
      data: {
        assessment_session_db_id: session.id,
        client_action_id: input.client_message_id,
        action_type: "formative_activity_response",
        request_hash: createHash("sha256")
          .update(JSON.stringify({ session_public_id: input.session_public_id, message }))
        .digest("hex")
      }
    });
  }

  const qualityStage: ResponseQualityStage = "formative_activity_response";
  const priorRejectedAttempts = await countPriorFormativeRejectedAttempts({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    stage: qualityStage
  });
  const submittedMessage =
    priorRejectedAttempts > 0 && markUnknownChoiceRequested(message)
      ? unknownEvidenceText(qualityStage)
      : message;
  const qualityResult = await evaluateResponseQuality({
    stage: "formative_activity_response",
    text: submittedMessage
  });

  if (!responseQualityAllowsAdvance(qualityResult.output)) {
    const repeatedAttemptCount = priorRejectedAttempts + 1;
    await logConversationTurn({
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      followup_round_db_id: round.id,
      phase: "planning_completed",
      actor_type: "student",
      message_text: submittedMessage,
      structured_payload: {
        source: "chat_native_formative_activity_response_quality_rejected",
        client_message_id: input.client_message_id,
        validation_status: "response_quality_rejected"
      }
    });
    await logProcessEvent({
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      event_type: "followup_response_submitted",
      event_category: "formative_activity",
      event_source: "frontend",
      payload: {
        source: "chat_native_formative_activity",
        client_message_id: input.client_message_id,
        response_length: submittedMessage.length,
        validation_status: "response_quality_rejected"
      }
    });
    await logFormativeResponseQuality({
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      followup_round_db_id: round.id,
      phase: "planning_completed",
      stage: "formative_activity_response",
      result: qualityResult,
      text_length: submittedMessage.length,
      student_facing_message_override:
        repeatedAttemptCount >= 2 ? REPEATED_INVALID_RESPONSE_PROMPT : undefined
    });
    if (repeatedAttemptCount >= 2) {
      await logRepeatedFormativeInvalidResponse({
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        stage: qualityStage,
        attempt_count: repeatedAttemptCount
      });
    }

    if (repeatedAttemptCount >= MAX_FORMATIVE_REPAIR_TURNS) {
      await stopFollowupForMaxLoopGuard({
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        followup_round_db_id: round.id,
        stage: qualityStage,
        attempt_count: repeatedAttemptCount
      });
    }

    const response = {
      message_status: "response_quality_rejected",
      targeted_feedback_available: false,
      next_choice_available: repeatedAttemptCount >= MAX_FORMATIVE_REPAIR_TURNS
    };

    await prisma.studentActionIdempotencyKey.update({
      where: idempotencyWhere,
      data: { response_payload: prismaJson(response) }
    });

    return response;
  }

  await logFormativeResponseQuality({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    followup_round_db_id: round.id,
    phase: "planning_completed",
    stage: "formative_activity_response",
    result: qualityResult,
    text_length: submittedMessage.length
  });

  const responseTurn = await logConversationTurn({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    followup_round_db_id: round.id,
    phase: "planning_completed",
    actor_type: "student",
    message_text: submittedMessage,
    structured_payload: {
      source: "chat_native_formative_activity_response",
      client_message_id: input.client_message_id,
      response_quality: qualityResult.output.response_quality
    }
  });
  await logProcessEvent({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    event_type: "followup_response_submitted",
    event_category: "formative_activity",
    event_source: "frontend",
    payload: {
      source: "chat_native_formative_activity",
      client_message_id: input.client_message_id,
      response_length: submittedMessage.length,
      response_quality: qualityResult.output.response_quality
    }
  });
  const feedback = await ensureTargetedFeedbackAndRevisionPrompt({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    followup_round_db_id: round.id,
    activity_response_turn_db_id: responseTurn.id
  });

  const response = {
    message_status: "saved",
    targeted_feedback_available: true,
    targeted_feedback_status: feedback.status
  };

  await prisma.studentActionIdempotencyKey.update({
    where: idempotencyWhere,
    data: { response_payload: prismaJson(response) }
  });

  return response;
}

export async function submitChatNativeRevisionResponse(input: {
  student_user_db_id: string;
  session_public_id: string;
  message: string;
  client_message_id: string;
}) {
  const message = input.message.trim();

  if (!message) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "Enter a revision before sending.",
      400
    );
  }

  if (message.length > MAX_REVISION_CHARS) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      `Keep the revision under ${MAX_REVISION_CHARS} characters.`,
      400
    );
  }

  const session = await prisma.assessmentSession.findFirst({
    where: {
      session_public_id: input.session_public_id,
      user_db_id: input.student_user_db_id
    },
    select: {
      id: true,
      current_phase: true,
      current_concept_unit_db_id: true
    }
  });

  if (!session) {
    throw new StudentAssessmentServiceError(
      "session_not_owned",
      "Session was not found for this student.",
      403
    );
  }

  const idempotencyWhere = {
    assessment_session_db_id_client_action_id: {
      assessment_session_db_id: session.id,
      client_action_id: input.client_message_id
    }
  };
  const existingKey = await prisma.studentActionIdempotencyKey.findUnique({
    where: idempotencyWhere
  });

  if (existingKey?.response_payload && typeof existingKey.response_payload === "object") {
    return existingKey.response_payload as Record<string, unknown>;
  }

  if (session.current_phase !== "followup_active") {
    throw new StudentAssessmentServiceError(
      "invalid_phase_for_action",
      "The revision is not currently accepting responses.",
      409,
      { current_phase: session.current_phase }
    );
  }

  if (!session.current_concept_unit_db_id) {
    throw new StudentAssessmentServiceError(
      "concept_unit_not_current",
      "No current concept unit is set for this session.",
      409
    );
  }

  const conceptUnitSession = await prisma.conceptUnitSession.findUnique({
    where: {
      assessment_session_db_id_concept_unit_db_id: {
        assessment_session_db_id: session.id,
        concept_unit_db_id: session.current_concept_unit_db_id
      }
    },
    select: { id: true }
  });

  if (!conceptUnitSession) {
    throw new StudentAssessmentServiceError(
      "concept_unit_not_current",
      "Current concept-unit session was not found.",
      409
    );
  }

  const round = await prisma.followupRound.findFirst({
    where: {
      concept_unit_session_db_id: conceptUnitSession.id,
      status: "active"
    },
    orderBy: [{ round_index: "desc" }]
  });

  if (!round) {
    throw new StudentAssessmentServiceError(
      "active_followup_round_required",
      "The revision is not currently accepting responses.",
      409
    );
  }

  if (!(await targetedFeedbackAlreadyShown(round.id))) {
    throw new StudentAssessmentServiceError(
      "invalid_phase_for_action",
      "A revision can be submitted only after targeted feedback is shown.",
      409
    );
  }

  if (!existingKey) {
    await prisma.studentActionIdempotencyKey.create({
      data: {
        assessment_session_db_id: session.id,
        client_action_id: input.client_message_id,
        action_type: "revision_response",
        request_hash: createHash("sha256")
          .update(JSON.stringify({ session_public_id: input.session_public_id, message }))
          .digest("hex")
      }
    });
  }

  const now = new Date();
  const qualityStage: ResponseQualityStage = "revision_response";
  const priorRejectedAttempts = await countPriorFormativeRejectedAttempts({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    stage: qualityStage
  });
  const submittedMessage =
    priorRejectedAttempts > 0 && markUnknownChoiceRequested(message)
      ? unknownEvidenceText(qualityStage)
      : message;
  const qualityResult = await evaluateResponseQuality({
    stage: "revision_response",
    text: submittedMessage
  });

  if (!responseQualityAllowsAdvance(qualityResult.output)) {
    const repeatedAttemptCount = priorRejectedAttempts + 1;
    await logConversationTurn({
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      followup_round_db_id: round.id,
      phase: "followup_active",
      actor_type: "student",
      message_text: submittedMessage,
      structured_payload: {
        source: "chat_native_revision_quality_rejected",
        client_message_id: input.client_message_id,
        validation_status: "response_quality_rejected"
      },
      created_at: now
    });
    await logProcessEvent({
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      event_type: "revision_submitted",
      event_category: "revision",
      event_source: "frontend",
      payload: {
        source: "chat_native_revision",
        client_message_id: input.client_message_id,
        response_length: submittedMessage.length,
        validation_status: "response_quality_rejected"
      },
      occurred_at: now
    });
    await logFormativeResponseQuality({
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      followup_round_db_id: round.id,
      phase: "followup_active",
      stage: "revision_response",
      result: qualityResult,
      text_length: submittedMessage.length,
      student_facing_message_override:
        repeatedAttemptCount >= 2 ? REPEATED_INVALID_RESPONSE_PROMPT : undefined
    });
    if (repeatedAttemptCount >= 2) {
      await logRepeatedFormativeInvalidResponse({
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        stage: qualityStage,
        attempt_count: repeatedAttemptCount
      });
    }

    if (repeatedAttemptCount >= MAX_FORMATIVE_REPAIR_TURNS) {
      await stopFollowupForMaxLoopGuard({
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        followup_round_db_id: round.id,
        stage: qualityStage,
        attempt_count: repeatedAttemptCount
      });
    }

    const response = {
      revision_status: "response_quality_rejected",
      next_choice_available: repeatedAttemptCount >= MAX_FORMATIVE_REPAIR_TURNS
    };

    await prisma.studentActionIdempotencyKey.update({
      where: idempotencyWhere,
      data: { response_payload: prismaJson(response) }
    });

    return response;
  }

  await logFormativeResponseQuality({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    followup_round_db_id: round.id,
    phase: "followup_active",
    stage: "revision_response",
    result: qualityResult,
    text_length: submittedMessage.length
  });

  const revisionTurn = await logConversationTurn({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    followup_round_db_id: round.id,
    phase: "followup_active",
    actor_type: "student",
    message_text: submittedMessage,
    structured_payload: {
      source: "chat_native_revision",
      client_message_id: input.client_message_id,
      response_quality: qualityResult.output.response_quality
    },
    created_at: now
  });
  await logProcessEvent({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    event_type: "revision_submitted",
    event_category: "revision",
    event_source: "frontend",
    payload: {
      source: "chat_native_revision",
      client_message_id: input.client_message_id,
      response_length: submittedMessage.length,
      response_quality: qualityResult.output.response_quality
    },
    occurred_at: now
  });

  const feedback = await ensureTargetedFeedbackAndRevisionPrompt({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    followup_round_db_id: round.id,
    activity_response_turn_db_id: revisionTurn.id,
    trigger_kind: "revision_response"
  });

  const response = {
    revision_status: "saved",
    next_choice_available: feedback.next_action === "confirm_and_next_choice" || feedback.next_action === "offer_transfer",
    targeted_feedback_status: feedback.status
  };

  await prisma.studentActionIdempotencyKey.update({
    where: idempotencyWhere,
    data: { response_payload: prismaJson(response) }
  });

  return response;
}

export async function submitChatNativeNextChoice(input: {
  student_user_db_id: string;
  session_public_id: string;
  choice: "move_next" | "try_another";
  client_action_id: string;
}) {
  const session = await prisma.assessmentSession.findFirst({
    where: {
      session_public_id: input.session_public_id,
      user_db_id: input.student_user_db_id
    },
    select: {
      id: true,
      current_phase: true,
      current_concept_unit_db_id: true
    }
  });

  if (!session) {
    throw new StudentAssessmentServiceError(
      "session_not_owned",
      "Session was not found for this student.",
      403
    );
  }

  const idempotencyWhere = {
    assessment_session_db_id_client_action_id: {
      assessment_session_db_id: session.id,
      client_action_id: input.client_action_id
    }
  };
  const existingKey = await prisma.studentActionIdempotencyKey.findUnique({
    where: idempotencyWhere
  });

  if (existingKey?.response_payload && typeof existingKey.response_payload === "object") {
    return existingKey.response_payload as Record<string, unknown>;
  }

  if (session.current_phase !== "followup_stopped") {
    throw new StudentAssessmentServiceError(
      "invalid_phase_for_action",
      "The next choice is not currently available.",
      409,
      { current_phase: session.current_phase }
    );
  }

  const conceptUnitSession = session.current_concept_unit_db_id
    ? await prisma.conceptUnitSession.findUnique({
        where: {
          assessment_session_db_id_concept_unit_db_id: {
            assessment_session_db_id: session.id,
            concept_unit_db_id: session.current_concept_unit_db_id
          }
        },
        select: { id: true }
      })
    : null;

  if (!existingKey) {
    await prisma.studentActionIdempotencyKey.create({
      data: {
        assessment_session_db_id: session.id,
        client_action_id: input.client_action_id,
        action_type: "next_choice",
        request_hash: createHash("sha256")
          .update(JSON.stringify({ session_public_id: input.session_public_id, choice: input.choice }))
          .digest("hex")
      }
    });
  }

  const now = new Date();
  const choiceLabel = input.choice === "move_next" ? "A" : "B";

  await logConversationTurn({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession?.id,
    phase: "followup_stopped",
    actor_type: "student",
    message_text: choiceLabel,
    structured_payload: {
      source: "chat_native_next_choice",
      choice: input.choice,
      client_action_id: input.client_action_id
    },
    created_at: now
  });
  await logProcessEvent({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession?.id,
    event_type: "next_choice_selected",
    event_category: "next_choice",
    event_source: "frontend",
    payload: { choice: input.choice },
    occurred_at: now
  });

  if (input.choice === "try_another") {
    if (!session.current_concept_unit_db_id || !conceptUnitSession) {
      throw new StudentAssessmentServiceError(
        "concept_unit_not_current",
        "Current concept-unit session was not found.",
        409
      );
    }

    const transferItem = await findTransferItemForConceptUnit(session.current_concept_unit_db_id);

    if (!transferItem) {
      throw new StudentAssessmentServiceError(
        "transfer_item_unavailable",
        "No transfer item is available for this concept unit.",
        409
      );
    }

    const alreadyPresented = await prisma.processEvent.count({
      where: {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: transferItem.id,
        event_type: "transfer_item_presented"
      }
    });

    if (alreadyPresented === 0) {
      const transferPrompt = buildInitialAdminPrompt({
        kind: "answer_prompt",
        assessmentState: "TRANSFER_ITEM",
        itemPublicId: transferItem.item_public_id,
        itemOrder: transferItem.item_order,
        itemRole: "transfer"
      });
      await logProcessEvent({
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: transferItem.id,
        event_type: "transfer_item_presented",
        event_category: "transfer_item",
        event_source: "backend",
        payload: {
          item_public_id: transferItem.item_public_id,
          item_role: "transfer",
          source_choice: "try_another"
        },
        occurred_at: now
      });
      await logProcessEvent({
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: transferItem.id,
        event_type: "agent_message_shown",
        event_category: "transfer_item",
        event_source: "backend",
        payload: {
          source: TRANSFER_ITEM_AGENT_NAME,
          prompt_type: "item_presented",
          item_public_id: transferItem.item_public_id,
          item_role: "transfer",
          ...promptAuditPayload(transferPrompt)
        },
        occurred_at: now
      });
      await logConversationTurn({
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: transferItem.id,
        phase: "followup_stopped",
        actor_type: "agent",
        agent_name: TRANSFER_ITEM_AGENT_NAME,
        message_text: transferItemAgentMessage(transferItem),
        structured_payload: {
          source: TRANSFER_ITEM_AGENT_NAME,
          prompt_type: "item_presented",
          item_public_id: transferItem.item_public_id,
          item_role: "transfer",
          ...promptAuditPayload(transferPrompt)
        },
        created_at: now
      });
    }

    const response = {
      choice_status: "transfer_item_started",
      item_public_id: transferItem.item_public_id
    };

    await prisma.studentActionIdempotencyKey.update({
      where: idempotencyWhere,
      data: { response_payload: prismaJson(response) }
    });

    return response;
  }

  if (conceptUnitSession) {
    await prisma.conceptUnitSession.update({
      where: { id: conceptUnitSession.id },
      data: { status: "completed" }
    });
  }
  await updateAssessmentSessionPhase({
    assessment_session_db_id: session.id,
    to_phase: "between_concept_units",
    reason: "chat_native_next_choice_move_next"
  });
  await updateAssessmentSessionPhase({
    assessment_session_db_id: session.id,
    to_phase: "session_completed",
    reason: "chat_native_phase6_completion"
  });
  await logProcessEvent({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession?.id,
    event_type: "session_completed",
    event_category: "session",
    event_source: "backend",
    payload: {
      reason: "chat_native_next_choice_move_next"
    },
    occurred_at: now
  });

  const response = {
    choice_status: "session_completed"
  };

  await prisma.studentActionIdempotencyKey.update({
    where: idempotencyWhere,
    data: { response_payload: prismaJson(response) }
  });

  return response;
}
