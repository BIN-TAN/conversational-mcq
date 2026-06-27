import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { FormativeValueSchema } from "@/lib/domain/enums";
import { getLlmRuntimeConfig, resolveAgentModelConfig } from "@/lib/llm/config";
import { createLlmProvider } from "@/lib/llm/providers/provider-factory";
import type { StructuredAgentResult } from "@/lib/llm/providers/types";
import { assertNoProhibitedProviderInput, redactForAudit } from "@/lib/agents/redaction";
import { toPrismaJson } from "@/lib/services/json";
import { logConversationTurn } from "@/lib/services/conversation-turns";
import { logProcessEvent } from "@/lib/services/process-events";
import { updateAssessmentSessionPhase } from "@/lib/services/session-state";
import { createResponsePackage } from "@/lib/services/response-packages";
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

export const ChatNativeTargetedFeedbackOutputSchema = z.object({
  student_facing_feedback: z.string().trim().min(1).max(550),
  revision_prompt: z.string().trim().min(1).max(260),
  next_expected_action: TargetedFeedbackNextExpectedActionSchema
}).strict();

export type ChatNativeTargetedFeedbackOutput = z.infer<
  typeof ChatNativeTargetedFeedbackOutputSchema
>;

const CHAT_NATIVE_PROFILE_AGENT_NAME = "formative_value_and_planning_agent";
const CHAT_NATIVE_TARGETED_FEEDBACK_AGENT_NAME = "followup_agent";
const CHAT_NATIVE_PROFILE_AGENT_VERSION = "chat-native-phase5-v1";
const CHAT_NATIVE_TARGETED_FEEDBACK_AGENT_VERSION = "chat-native-phase6-v1";
const CHAT_NATIVE_PROFILE_PROMPT_VERSION = "chat-native-formative-profile-v1";
const CHAT_NATIVE_TARGETED_FEEDBACK_PROMPT_VERSION = "chat-native-targeted-feedback-v1";
const CHAT_NATIVE_PROFILE_SCHEMA_VERSION = "chat-native-formative-profile-output-v1";
const CHAT_NATIVE_TARGETED_FEEDBACK_SCHEMA_VERSION = "chat-native-targeted-feedback-output-v1";
const CHAT_NATIVE_PROFILE_INSTRUCTIONS = `
You are supporting a chat-native formative MCQ assessment after a protected three-item initial package.

Use the response package to produce exactly one short structured formative profile and one matched formative activity.
The application owns state transitions and persistence.

Student-facing text must:
- be short and conversational;
- avoid internal labels such as response profile, formative need, metadata, structured output, system prompt, or answer key;
- not dump the full answer key;
- focus on one activity the student can answer next.

Use the required JSON schema only.
`;
const CHAT_NATIVE_TARGETED_FEEDBACK_INSTRUCTIONS = `
You are supporting a chat-native formative MCQ assessment after the student has answered one matched formative activity.

Produce brief targeted feedback and exactly one natural revision prompt.
The application owns all state transitions and persistence.

Student-facing text must:
- acknowledge a relevant part of the student's response;
- clarify the single main distinction;
- avoid long lectures;
- ask for exactly one revision task;
- avoid the sentence "Please revise your answer, reasoning, or confidence based on this feedback.";
- avoid internal labels such as response profile, formative need, metadata, structured output, agent call, system prompt, or answer key;
- not dump the full answer key;
- not restart the answer/reason/confidence/tempting-option cycle.

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

function prismaJson(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function transferItemAgentMessage(item: { item_stem: string; options: unknown }) {
  const options = safeOptionEntries(item.options)
    .map((option) => `${option.label}. ${option.text}`)
    .join("\n");

  return [
    "Additional question",
    "",
    item.item_stem,
    "",
    options,
    "",
    "What is your answer?"
  ]
    .filter((part) => part !== "")
    .join("\n");
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
    process_counts: record.process_counts,
    logging_limitations: record.logging_limitations
  };
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
      "The response package shows some useful understanding, but the distinction between item parameters and person ability still needs clarification.",
    main_issue:
      "The student needs to distinguish item difficulty from theta as a person-location estimate on the linked scale.",
    formative_need: "diagnosis_and_feedback",
    matched_activity: "key_distractor_contrast",
    evidence_used: [
      "Three-item initial response package",
      "Reasoning text and confidence ratings",
      "Tempting-option evidence from the fixed IRT item set"
    ],
    confidence_calibration_flag: true,
    answer_reasoning_alignment:
      "The answers and explanations suggest partial alignment, but the b/theta distinction should be made more explicit.",
    student_facing_pattern_statement:
      "Your answers suggest that the main idea is partly in place, but the distinction between item difficulty and person ability needs more attention.",
    student_facing_followup_prompt:
      "Compare the idea of item difficulty with the idea of theta. Which one describes the item, and which one describes the person?",
    should_reveal_correct_answer: false,
    next_expected_action: "respond_to_formative_activity"
  };
}

function deterministicTargetedFeedbackOutput(): ChatNativeTargetedFeedbackOutput {
  return {
    student_facing_feedback:
      "You are close. The key distinction is that item difficulty describes the item, while theta describes the person’s location on the latent trait scale. A harder item set does not automatically mean the same student’s theta should become lower when forms are properly linked.",
    revision_prompt:
      "Now restate the difference between item difficulty and person ability in your own words.",
    next_expected_action: "revise_explanation"
  };
}

function studentFacingText(output: ChatNativeFormativeProfileOutput) {
  return `${output.student_facing_pattern_statement}\n\n${output.student_facing_followup_prompt}`;
}

function targetedFeedbackStudentFacingText(output: ChatNativeTargetedFeedbackOutput) {
  return `${output.student_facing_feedback}\n\n${output.revision_prompt}`;
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

  if (
    lower.includes("please revise your answer, reasoning, or confidence based on this feedback")
  ) {
    issues.push("revision prompt uses the prohibited generic revision sentence");
  }

  if (visibleText.length > 900) {
    issues.push("targeted feedback is too long for chat");
  }

  const revisionPrompt = input.output.revision_prompt.toLowerCase();
  const taskStarts = (revisionPrompt.match(/\b(now|tell me|give|update|restate|revise)\b/g) ?? []).length;

  if (taskStarts > 3 || revisionPrompt.includes(" and then ")) {
    issues.push("revision prompt appears to ask for more than one task");
  }

  if (/what is your answer|how confident|was another option tempting/i.test(visibleText)) {
    issues.push("targeted feedback restarts the protected initial item cycle");
  }

  if (input.output.next_expected_action === "choose_next_step") {
    issues.push("Phase 6 feedback must ask for a revision before next choice");
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
  const provider = createLlmProvider();
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

  if (providerResult.status === "completed") {
    const parsed = ChatNativeFormativeProfileOutputSchema.safeParse(providerResult.parsed_output);
    const validation = parsed.success
      ? validateStudentFacingOutput({ output: parsed.data, correct_options: input.correct_options })
      : { ok: false, issues: parsed.error.issues.map((issue) => issue.message) };

    if (parsed.success && validation.ok) {
      await prisma.agentCall.update({
        where: { id: agentCall.id },
        data: {
          provider: providerResult.provider,
          provider_response_id: providerResult.provider_response_id,
          provider_request_id: providerResult.provider_request_id,
          raw_output: prismaJson(redactForAudit(providerResult.raw_output)),
          output_payload: prismaJson(parsed.data),
          output_validated: true,
          call_status: "succeeded",
          latency_ms: providerResult.latency_ms,
          input_tokens: providerResult.usage?.input_tokens,
          output_tokens: providerResult.usage?.output_tokens,
          total_tokens: providerResult.usage?.total_tokens,
          token_usage: providerResult.usage ? prismaJson(providerResult.usage.raw ?? providerResult.usage) : undefined,
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
  }

  const fallbackOutput = deterministicMockOutput();
  await prisma.agentCall.update({
    where: { id: agentCall.id },
    data: {
      provider: providerResult.provider,
      provider_response_id: providerResult.provider_response_id,
      provider_request_id: providerResult.provider_request_id,
      raw_output: prismaJson(redactForAudit(providerResult.raw_output)),
      output_payload: prismaJson(fallbackOutput),
      output_validated: false,
      validation_error:
        providerResult.status === "completed"
          ? "Provider output failed Phase 5 student-facing validation; deterministic fallback used."
          : `Provider result was ${providerResult.status}; deterministic fallback used.`,
      call_status: providerResult.status === "completed" ? "invalid_output" : "failed",
      error_category:
        providerResult.status === "completed" ? "schema_validation" : providerResult.error?.category,
      latency_ms: providerResult.latency_ms,
      input_tokens: providerResult.usage?.input_tokens,
      output_tokens: providerResult.usage?.output_tokens,
      total_tokens: providerResult.usage?.total_tokens,
      token_usage: providerResult.usage ? prismaJson(providerResult.usage.raw ?? providerResult.usage) : undefined,
      completed_at: new Date()
    }
  });

  return {
    agent_call_id: agentCall.id,
    output: fallbackOutput,
    validation_status: "fallback_after_provider_failure",
    validation_issues: ["provider_output_not_student_safe_or_not_completed"],
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

async function latestStudentTurnForRound(input: {
  followup_round_db_id: string;
  source: string;
}) {
  const turns = await prisma.conversationTurn.findMany({
    where: {
      followup_round_db_id: input.followup_round_db_id,
      actor_type: "student"
    },
    orderBy: [{ created_at: "desc" }],
    select: {
      id: true,
      message_text: true,
      structured_payload: true,
      created_at: true
    },
    take: 20
  });

  return turns.find((turn) => {
    const payload = jsonRecord(turn.structured_payload);
    return payload.source === input.source;
  }) ?? null;
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
    const output = deterministicTargetedFeedbackOutput();
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
      output: validation.ok ? output : deterministicTargetedFeedbackOutput(),
      validation_status: validation.ok ? "validated" : "fallback_after_validation_failure",
      validation_issues: validation.issues,
      provider_result: null as StructuredAgentResult<ChatNativeTargetedFeedbackOutput> | null
    };
  }

  assertNoProhibitedProviderInput(input.provider_input);
  const provider = createLlmProvider();
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

  if (providerResult.status === "completed") {
    const parsed = ChatNativeTargetedFeedbackOutputSchema.safeParse(providerResult.parsed_output);
    const validation = parsed.success
      ? validateTargetedFeedbackOutput({ output: parsed.data, correct_options: input.correct_options })
      : { ok: false, issues: parsed.error.issues.map((issue) => issue.message) };

    if (parsed.success && validation.ok) {
      await prisma.agentCall.update({
        where: { id: agentCall.id },
        data: {
          provider: providerResult.provider,
          provider_response_id: providerResult.provider_response_id,
          provider_request_id: providerResult.provider_request_id,
          raw_output: prismaJson(redactForAudit(providerResult.raw_output)),
          output_payload: prismaJson(parsed.data),
          output_validated: true,
          call_status: "succeeded",
          latency_ms: providerResult.latency_ms,
          input_tokens: providerResult.usage?.input_tokens,
          output_tokens: providerResult.usage?.output_tokens,
          total_tokens: providerResult.usage?.total_tokens,
          token_usage: providerResult.usage ? prismaJson(providerResult.usage.raw ?? providerResult.usage) : undefined,
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
  }

  const fallbackOutput = deterministicTargetedFeedbackOutput();
  await prisma.agentCall.update({
    where: { id: agentCall.id },
    data: {
      provider: providerResult.provider,
      provider_response_id: providerResult.provider_response_id,
      provider_request_id: providerResult.provider_request_id,
      raw_output: prismaJson(redactForAudit(providerResult.raw_output)),
      output_payload: prismaJson(fallbackOutput),
      output_validated: false,
      validation_error:
        providerResult.status === "completed"
          ? "Provider output failed Phase 6 student-facing validation; deterministic fallback used."
          : `Provider result was ${providerResult.status}; deterministic fallback used.`,
      call_status: providerResult.status === "completed" ? "invalid_output" : "failed",
      error_category:
        providerResult.status === "completed" ? "schema_validation" : providerResult.error?.category,
      latency_ms: providerResult.latency_ms,
      input_tokens: providerResult.usage?.input_tokens,
      output_tokens: providerResult.usage?.output_tokens,
      total_tokens: providerResult.usage?.total_tokens,
      token_usage: providerResult.usage ? prismaJson(providerResult.usage.raw ?? providerResult.usage) : undefined,
      completed_at: new Date()
    }
  });

  return {
    agent_call_id: agentCall.id,
    output: fallbackOutput,
    validation_status: "fallback_after_provider_failure",
    validation_issues: ["provider_output_not_student_safe_or_not_completed"],
    provider_result: providerResult
  };
}

async function ensureTargetedFeedbackAndRevisionPrompt(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  followup_round_db_id: string;
  activity_response_turn_db_id: string;
}) {
  if (await targetedFeedbackAlreadyShown(input.followup_round_db_id)) {
    return { status: "already_created" as const };
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
    task: "chat_native_phase6_targeted_feedback_and_revision",
    response_package: safePackageForProvider(responsePackage.payload),
    formative_profile: safeProfileForProvider(profile),
    formative_decision: safeDecisionForProvider(decision),
    student_formative_activity_response: {
      message_text: activityResponseTurn.message_text,
      submitted_at: activityResponseTurn.created_at.toISOString()
    },
    constraints: {
      app_controls_state_transitions: true,
      one_brief_feedback_only: true,
      one_revision_task_only: true,
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

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const alreadyCreated = await tx.conversationTurn.findFirst({
      where: {
        followup_round_db_id: input.followup_round_db_id,
        agent_name: TARGETED_FEEDBACK_AGENT_NAME
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
        message_text: feedbackResult.output.student_facing_feedback,
        structured_payload: prismaJson({
          source: TARGETED_FEEDBACK_AGENT_NAME,
          message_type: "targeted_feedback",
          next_expected_action: feedbackResult.output.next_expected_action,
          based_on_agent_call_id: feedbackResult.agent_call_id,
          validation_status: feedbackResult.validation_status,
          validation_issues: feedbackResult.validation_issues
        }),
        created_at: now
      }
    });
    await tx.conversationTurn.create({
      data: {
        assessment_session_db_id: input.assessment_session_db_id,
        concept_unit_session_db_id: input.concept_unit_session_db_id,
        followup_round_db_id: input.followup_round_db_id,
        phase: "followup_active",
        actor_type: "agent",
        agent_name: TARGETED_FEEDBACK_AGENT_NAME,
        message_text: feedbackResult.output.revision_prompt,
        structured_payload: prismaJson({
          source: TARGETED_FEEDBACK_AGENT_NAME,
          message_type: "revision_prompt",
          next_expected_action: feedbackResult.output.next_expected_action,
          based_on_agent_call_id: feedbackResult.agent_call_id
        }),
        created_at: now
      }
    });
  });

  await updateAssessmentSessionPhase({
    assessment_session_db_id: input.assessment_session_db_id,
    to_phase: "followup_active",
    reason: "chat_native_targeted_feedback_ready",
    payload: { agent_call_id: feedbackResult.agent_call_id }
  });
  await logProcessEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    event_type: "targeted_feedback_shown",
    event_category: "targeted_feedback",
    event_source: "backend",
    payload: {
      agent_call_id: feedbackResult.agent_call_id,
      validation_status: feedbackResult.validation_status
    },
    occurred_at: now
  });
  await logProcessEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    event_type: "revision_requested",
    event_category: "revision",
    event_source: "backend",
    payload: {
      agent_call_id: feedbackResult.agent_call_id,
      next_expected_action: feedbackResult.output.next_expected_action
    },
    occurred_at: now
  });

  return {
    status: "created" as const,
    agent_call_id: feedbackResult.agent_call_id
  };
}

async function persistProfileDecisionAndActivity(input: {
  concept_unit_session_db_id: string;
  assessment_session_db_id: string;
  agent_call_id: string;
  output: ChatNativeFormativeProfileOutput;
  validation_status: string;
  validation_issues: string[];
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

    await tx.conversationTurn.create({
      data: {
        assessment_session_db_id: input.assessment_session_db_id,
        concept_unit_session_db_id: input.concept_unit_session_db_id,
        followup_round_db_id: round.id,
        phase: "planning_completed",
        actor_type: "agent",
        agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
        message_text: input.output.student_facing_pattern_statement,
        structured_payload: prismaJson({
          source: FORMATIVE_ACTIVITY_AGENT_NAME,
          message_type: "pattern_statement",
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

  const providerInput = {
    task: "chat_native_phase5_formative_profile",
    response_package: safePackageForProvider(responsePackage.payload),
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
        validation_issues: []
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
    validation_issues: providerResult.validation_issues
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

  const responseTurn = await logConversationTurn({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    followup_round_db_id: round.id,
    phase: "planning_completed",
    actor_type: "student",
    message_text: message,
    structured_payload: {
      source: "chat_native_formative_activity_response",
      client_message_id: input.client_message_id
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
      response_length: message.length
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

  const existingRevision = await latestStudentTurnForRound({
    followup_round_db_id: round.id,
    source: "chat_native_revision"
  });

  if (existingRevision) {
    throw new StudentAssessmentServiceError(
      "conflict",
      "A revision has already been submitted for this activity.",
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

  await logConversationTurn({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    followup_round_db_id: round.id,
    phase: "followup_active",
    actor_type: "student",
    message_text: message,
    structured_payload: {
      source: "chat_native_revision",
      client_message_id: input.client_message_id
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
      response_length: message.length
    },
    occurred_at: now
  });
  await prisma.followupRound.update({
    where: { id: round.id },
    data: {
      status: "completed",
      completed_at: now
    }
  });
  await prisma.conceptUnitSession.update({
    where: { id: conceptUnitSession.id },
    data: {
      status: "followup_completed",
      followup_status: "completed",
      followup_completed_at: now
    }
  });
  await updateAssessmentSessionPhase({
    assessment_session_db_id: session.id,
    to_phase: "followup_stopped",
    reason: "chat_native_revision_submitted"
  });
  await logProcessEvent({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    event_type: "next_choice_shown",
    event_category: "next_choice",
    event_source: "backend",
    payload: {
      options: ["move_to_next_concept", "try_another_question_same_idea"]
    },
    occurred_at: now
  });

  const response = {
    revision_status: "saved",
    next_choice_available: true
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
          item_role: "transfer"
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
          item_role: "transfer"
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

  const response = {
    choice_status: "session_completed"
  };

  await prisma.studentActionIdempotencyKey.update({
    where: idempotencyWhere,
    data: { response_payload: prismaJson(response) }
  });

  return response;
}
