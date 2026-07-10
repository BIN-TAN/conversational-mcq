import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AgentName } from "@/lib/agents/names";
import { assertNoProhibitedProviderInput, redactForAudit } from "@/lib/agents/redaction";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { getLlmRuntimeConfig, LlmConfigurationError, type AgentModelConfig } from "@/lib/llm/config";
import { providerAuditMetadata } from "@/lib/llm/providers/audit-metadata";
import { createLlmProvider } from "@/lib/llm/providers/provider-factory";
import type { LlmProvider, StructuredAgentResult } from "@/lib/llm/providers/types";
import { toPrismaJson } from "@/lib/services/json";
import {
  assessmentInterpretationContextAuditMetadata,
  buildAssessmentInterpretationContextFromResponsePackage,
  type AssessmentInterpretationContextAuditMetadata,
  type AssessmentInterpretationContextV1
} from "@/lib/services/student-assessment/assessment-interpretation-context";
import {
  FORMATIVE_VALUE_PACKET_SCHEMA_VERSION,
  type FormativeValueDeterminationPacketV1
} from "@/lib/services/student-assessment/formative-value-determination";
import {
  PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
  type ProfileIntegrationInterpretationPacketV1
} from "@/lib/services/student-assessment/profile-integration";
import {
  FORMATIVE_ACTIVITY_AGENT_NAME,
  FORMATIVE_ACTIVITY_SCHEMA_VERSION,
  FormativeActivityFamilySchema,
  FormativeActivityPacketV1Schema,
  assertFormativeActivityPacketIsNotReviewOnlyForRuntime,
  buildFormativeActivityDesignPacketFromPackets,
  validateFormativeActivityPacket,
  type FormativeActivityPacketV1,
  type FormativeActivityValidationIssue
} from "@/lib/services/student-assessment/formative-activity-design";

export const FORMATIVE_ACTIVITY_AGENT_VERSION = "formative-activity-dialogue-v1" as const;
export const FORMATIVE_ACTIVITY_PROMPT_VERSION = "formative-activity-dialogue-prompt-v1" as const;
export const FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_NAME =
  "formative_activity_quality_reviewer_agent" as const;
export const FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_VERSION =
  "formative-activity-quality-reviewer-v1" as const;
export const FORMATIVE_ACTIVITY_QUALITY_REVIEW_SCHEMA_VERSION =
  "formative-activity-quality-review-v1" as const;
export const FORMATIVE_ACTIVITY_QUALITY_REVIEW_PROMPT_VERSION =
  "formative-activity-quality-review-prompt-v1" as const;
export const FORMATIVE_ACTIVITY_REPAIR_PROMPT_VERSION =
  "formative-activity-dialogue-repair-prompt-v1" as const;
export const FORMATIVE_ACTIVITY_LIVE_INPUT_SCHEMA_VERSION =
  "formative-activity-live-input-v1" as const;

export const FORMATIVE_ACTIVITY_PROMPT_INSTRUCTIONS = `
You are the Formative Activity Dialogue Agent for a web-based chat-native MCQ formative assessment platform.

Generate only the first tutor turn and protocol packet for the next formative activity. The platform owns state transitions, persistence, scoring, and whether the packet can be shown to a student.

Hard requirements:
1. Return exactly the student-formative-activity-v1 JSON schema.
2. Set agent_name to formative_activity_dialogue_agent.
3. Set generation_source to live_llm, runtime_servable_to_student to true, and review_only to false.
4. Use the selected formative value and requested activity family from the input.
5. The first turn must include a complete, student-friendly explanation before asking for one next student action.
6. The first turn must be specific to the current profile interpretation, concept focus, and distractor role when relevant.
7. End the first turn with exactly one question. The message must contain exactly one question mark, and that question mark must be at the end.
8. Do not expose answer keys, correct options, correctness labels, distractor metadata, misconception IDs, engagement labels, AI-assistance labels, process data, raw reasoning, raw provider output, system prompts, API keys, headers, or secrets.
9. Do not mention profile integration, formative value, ability evidence, packet confidence, metadata, structured output, agent calls, raw model output, or internal labels in student-facing text.
10. Do not accuse the student of cheating, misconduct, integrity problems, AI use, or suspicious behavior.
11. Do not generate a new scored item or ask the student to answer a scored question.
12. For transfer_and_distractor_generation, make clear that the activity is unscored.
13. Do not use rigid headings such as "What you did well", "Reasoning detail", "Current focus", or "Earlier".
14. If evidence is limited, use conservative language and ask for a fresh explanation rather than overclaiming.
15. The student-facing first turn must include one of these natural concept-explanation phrases: "The key idea is", "A useful way to think", "The core idea is", "The main boundary", "The basic distinction", or "One part describes".
16. The student-facing first turn must explicitly connect to the prior response summary using "your earlier responses", "your earlier thinking", or "your earlier explanation".
17. Do not use more than one sentence ending in a question mark.
18. Do not start expected_student_action.prompt with filler words such as "Please". Start with a meaningful verb that also appears in first_turn.message, such as "Explain", "Compare", "Revise", "Rate", "Apply", or "Generate".
19. Treat the family-specific quoted phrases below as hard acceptance gates, not style suggestions. Copy the required quoted phrases naturally into first_turn.message for the requested family.
20. Do not include rhetorical questions or multiple student-facing prompts in the explanation body. The only question mark in first_turn.message must be the final student action prompt.
21. expected_student_action.prompt must match or safely extract the final student action in first_turn.message. It must not introduce a second different student task.

Family-specific minimums:
- basic_concept_grounding: include 3 to 5 concrete concept-explanation sentences before the prompt. Use the phrase "basic distinction". Include the concrete terms "theta", "ability scale", "item parameters", and "item information" or "difficulty". Include a simple thermometer analogy to separate a learner estimate from item features. Explain the idea from basic parts, connect to the student's prior response pattern in student-safe language, and ask one own-words prompt. Set expected_student_action.prompt to start with "Explain" and include the phrase "in your own words". Do not merely tell the student to explain the concept.
- distractor_contrast: describe the safe tempting alternative or distractor, explain why it can feel tempting, name the hidden assumption, contrast it with the target concept boundary, and ask one compare prompt. The final question and expected_student_action.prompt must both use the verb "Compare".
- reasoning_chain_repair: name the "useful part" or "useful starting point" of the student's reasoning, explain the "missing link", explain how skipping that link makes a "tempting alternative" plausible, and ask one revision prompt. The final question and expected_student_action.prompt must both use the verb "Revise".
- independent_reconstruction: use the phrase "Setting the option choices aside", explain why "current evidence is mixed or unclear", include "in your own words", avoid AI/external-assistance wording, and ask one own-words prompt. The final question and expected_student_action.prompt must both use the verb "Explain" or "Reconstruct".
- confidence_evidence_audit: connect "confidence" to "evidence", include the phrases "usable understanding" and "low confidence can be worth checking", use underconfidence only when adequate understanding evidence is present, and ask one evidence-plus-confidence prompt. The final question and expected_student_action.prompt must both use the verb "Rate" or "Connect".
- transfer_and_distractor_generation: frame the task as "not another scored question", include "Transfer means" and "Distractor generation means", ask for a "nearby situation" or "nearby example" or plausible wrong alternative, explain that the goal is showing a concept boundary rather than tricking anyone, and ask one transfer or generation prompt. The final question and expected_student_action.prompt must both use the verb "Apply" or "Generate".

Acceptable basic_concept_grounding style:
"Let's start with the basic distinction. Theta is a way to describe where a person seems to be on an ability scale. Item parameters describe features of the item, such as how difficult or informative it is. A response is not a thermometer reading of ability; it is evidence that has to be interpreted together with the item. Your earlier responses suggest this boundary is still forming, so we will build the idea from the ground up. Can you explain that distinction in your own words using one detail from your earlier responses?"

Return only the JSON object.
`;

export const FORMATIVE_ACTIVITY_QUALITY_REVIEW_PROMPT_INSTRUCTIONS = `
You are the Formative Activity Quality Reviewer Agent.

Review a proposed formative activity first-turn packet. You do not approve unsafe output by yourself; deterministic validators and hard gates remain authoritative.

Evaluate:
1. Schema and agent-name alignment.
2. Student specificity.
3. Conceptual depth.
4. Quality of distractor use when a distractor role is present.
5. Alignment to selected formative value and activity family.
6. Overclaiming risk.
7. Student safety risk.
8. Internal-label leakage.
9. Answer-key or correctness leakage.

Use review_status=pass only if the packet is ready for deterministic final checks.
Use repair_needed for text-quality issues that can be safely repaired without revealing protected content, including: first turn too short, missing concrete concept explanation, missing family-specific content, missing response connection, basic grounding without depth, distractor family without concrete contrast, generic feedback, colon-spliced template fragments, no clear prompt, missing final prompt, multiple student-facing prompts, rhetorical questions that look like prompts, or expected_student_action.prompt that does not match the final student-facing action.
Use fail_closed for protected leaks, unsafe claims, unsupported source flags, missing provenance requirements, or severe mismatch.

Return only the required formative-activity-quality-review-v1 JSON object.
`;

export const FORMATIVE_ACTIVITY_REPAIR_PROMPT_INSTRUCTIONS = `
You are repairing a formative activity packet after quality review.

You may repair only safe text-quality issues from the supplied validation issue codes and review instructions. Use only the safe source input fields: activity family, selected formative value, student-safe profile status, concept focus, prior response summary, and safe distractor description when available. Do not repair protected leaks by restating them. Do not change source provenance except preserving live_llm/runtime_servable_to_student=true/review_only=false. Do not expose answer keys, correct options, correctness, distractor metadata, misconception IDs, raw reasoning, process data, engagement labels, AI-assistance labels, raw LLM output, prompts, headers, API keys, or secrets. Treat hard_repair_checklist_for_family as literal acceptance gates. Copy the required quoted markers naturally into first_turn.message and align expected_student_action.prompt with the final question.

The repaired first turn must satisfy the family-specific minimums from the generator prompt. It must include exactly one question mark, and that question mark must be the final character. It must include one of these natural concept-explanation phrases: "The key idea is", "A useful way to think", "The core idea is", "The main boundary", "The basic distinction", or "One part describes". It must explicitly connect to the prior response summary using "your earlier responses", "your earlier thinking", or "your earlier explanation". Do not start expected_student_action.prompt with filler words such as "Please"; start with a meaningful verb that also appears in first_turn.message. Match the expected_student_action.prompt verb to the final visible question: use "Explain" for basic grounding, "Compare" for distractor contrast, "Revise" for reasoning-chain repair, "Explain" or "Reconstruct" for independent reconstruction, "Rate" or "Connect" for confidence audit, and "Apply" or "Generate" for transfer/generation. For basic_concept_grounding, include at least six total sentences, with 3 to 5 concrete concept-explanation sentences, the phrase "basic distinction", the terms "theta", "ability scale", "item parameters", and "item information" or "difficulty", a simple thermometer analogy, a connection to the prior response summary, and one final prompt. Set expected_student_action.prompt to start with "Explain" and include "in your own words".

Prompt-count repair rule: first_turn.message must end with exactly one student-facing question. Do not put the only prompt in expected_student_action.prompt while leaving first_turn.message as a statement. Do not include rhetorical questions or a list of questions in first_turn.message. Do not use "Can you..., and also..." or any combined multi-action question. If unsure, make the final sentence exactly: "Can you explain in your own words what theta is and how it is different from item parameters?"

Clean wording repair rule: write complete sentences. Do not use colon-spliced template fragments such as "Your earlier responses: The...", "The idea is: This...", or "in your own words: ...".

Family repair checklist:
- basic_concept_grounding must include "basic distinction" or "key distinction", "thermometer", theta/person ability language, item-parameter or item-information language, and an expected prompt beginning with "Explain".
- distractor_contrast must include "tempting alternative", "hidden assumption", a concrete ability-vs-item boundary, and an expected prompt beginning with "Compare".
- reasoning_chain_repair must include the exact phrases "useful part" or "useful starting point", "missing link", and "tempting alternative"; the expected prompt must begin with "Revise".
- independent_reconstruction must include "Setting the option choices aside", "current evidence is mixed or unclear", and "in your own words". A safe structure is: "Setting the option choices aside helps us rebuild the idea without leaning on recognition from the choices. The current evidence is mixed or unclear, so your own explanation gives a cleaner view of your thinking. Your earlier responses suggest the relationship between theta and item parameters still needs to be stated directly. Can you explain in your own words how theta is different from item parameters?"
- confidence_evidence_audit must include "confidence", "evidence", "usable understanding", and "low confidence can be worth checking".
- transfer_and_distractor_generation must include "not another scored question", "Transfer means", "Distractor generation means", and "nearby situation" or "nearby example".

Return exactly one corrected student-formative-activity-v1 JSON object.
`;

export const FORMATIVE_ACTIVITY_PROMPT_HASH = createHash("sha256")
  .update(FORMATIVE_ACTIVITY_PROMPT_INSTRUCTIONS)
  .digest("hex");
export const FORMATIVE_ACTIVITY_QUALITY_REVIEW_PROMPT_HASH = createHash("sha256")
  .update(FORMATIVE_ACTIVITY_QUALITY_REVIEW_PROMPT_INSTRUCTIONS)
  .digest("hex");
export const FORMATIVE_ACTIVITY_REPAIR_PROMPT_HASH = createHash("sha256")
  .update(FORMATIVE_ACTIVITY_REPAIR_PROMPT_INSTRUCTIONS)
  .digest("hex");

const QualityReviewStatusSchema = z.enum(["pass", "repair_needed", "fail_closed"]);
const QualityScoreSchema = z.enum(["strong", "adequate", "weak", "unsafe"]);
const ReviewerDimensionSchema = z.enum(["strong", "adequate", "weak", "unsafe"]);
const ReviewerRiskSchema = z.enum(["none", "low", "medium", "high"]);

export const FormativeActivityQualityReviewV1Schema = z.object({
  schema_version: z.literal(FORMATIVE_ACTIVITY_QUALITY_REVIEW_SCHEMA_VERSION),
  agent_name: z.literal(FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_NAME),
  review_status: QualityReviewStatusSchema,
  quality_score: QualityScoreSchema,
  student_specificity: ReviewerDimensionSchema,
  conceptual_depth: ReviewerDimensionSchema,
  distractor_use_quality: ReviewerDimensionSchema,
  formative_value_alignment: ReviewerDimensionSchema,
  activity_family_alignment: ReviewerDimensionSchema,
  overclaiming_risk: ReviewerRiskSchema,
  student_safety_risk: ReviewerRiskSchema,
  issues: z.array(z.object({
    field_path: z.string().min(1).max(160),
    rule_code: z.string().min(1).max(120),
    severity: z.enum(["minor", "major", "critical"]),
    safe_summary: z.string().min(1).max(300)
  }).strict()).max(20),
  repair_instructions: z.array(z.string().min(1).max(300)).max(10)
}).strict();

export type FormativeActivityQualityReviewV1 = z.infer<
  typeof FormativeActivityQualityReviewV1Schema
>;

export type FormativeActivityReviewerArtifactSummary = {
  available: boolean;
  unavailable_reason: string | null;
  review_status: FormativeActivityQualityReviewV1["review_status"] | null;
  quality_score: FormativeActivityQualityReviewV1["quality_score"] | null;
  student_specificity: FormativeActivityQualityReviewV1["student_specificity"] | null;
  conceptual_depth: FormativeActivityQualityReviewV1["conceptual_depth"] | null;
  distractor_use_quality: FormativeActivityQualityReviewV1["distractor_use_quality"] | null;
  formative_value_alignment: FormativeActivityQualityReviewV1["formative_value_alignment"] | null;
  activity_family_alignment: FormativeActivityQualityReviewV1["activity_family_alignment"] | null;
  overclaiming_risk: FormativeActivityQualityReviewV1["overclaiming_risk"] | null;
  student_safety_risk: FormativeActivityQualityReviewV1["student_safety_risk"] | null;
  issue_count: number;
  issue_codes: string[];
};

export function summarizeFormativeActivityQualityReviewForArtifact(
  review: unknown,
  unavailableReason = "reviewer_output_unavailable"
): FormativeActivityReviewerArtifactSummary {
  const parsed = FormativeActivityQualityReviewV1Schema.safeParse(review);
  if (!parsed.success) {
    return {
      available: false,
      unavailable_reason: unavailableReason,
      review_status: null,
      quality_score: null,
      student_specificity: null,
      conceptual_depth: null,
      distractor_use_quality: null,
      formative_value_alignment: null,
      activity_family_alignment: null,
      overclaiming_risk: null,
      student_safety_risk: null,
      issue_count: 0,
      issue_codes: []
    };
  }

  return {
    available: true,
    unavailable_reason: null,
    review_status: parsed.data.review_status,
    quality_score: parsed.data.quality_score,
    student_specificity: parsed.data.student_specificity,
    conceptual_depth: parsed.data.conceptual_depth,
    distractor_use_quality: parsed.data.distractor_use_quality,
    formative_value_alignment: parsed.data.formative_value_alignment,
    activity_family_alignment: parsed.data.activity_family_alignment,
    overclaiming_risk: parsed.data.overclaiming_risk,
    student_safety_risk: parsed.data.student_safety_risk,
    issue_count: parsed.data.issues.length,
    issue_codes: parsed.data.issues.map((issue) => issue.rule_code)
  };
}

export type FormativeActivityLiveSmokeOutcome = {
  overall_status: "passed" | "failed";
  synthetic_cases_passed: boolean;
  real_session_included: boolean;
  real_session_case_passed: boolean | null;
  failed_case_ids: string[];
};

export function summarizeFormativeActivityLiveSmokeOutcome(
  results: Array<{ case_id?: unknown; status?: unknown }>
): FormativeActivityLiveSmokeOutcome {
  const syntheticResults = results.filter((result) =>
    typeof result.case_id === "string" && result.case_id.startsWith("activity_live_")
  );
  const realSessionResults = results.filter((result) =>
    typeof result.case_id === "string" && result.case_id.startsWith("real_session_")
  );
  const executedRealSessionResults = realSessionResults.filter((result) =>
    result.status !== "skipped"
  );
  const failedCaseIds = results
    .filter((result) => result.status !== "succeeded" && result.status !== "skipped")
    .map((result) => typeof result.case_id === "string" ? result.case_id : "unknown_case");
  const syntheticCasesPassed = syntheticResults.length > 0 &&
    syntheticResults.every((result) => result.status === "succeeded");
  const realSessionIncluded = executedRealSessionResults.length > 0;
  const realSessionCasePassed = realSessionIncluded
    ? executedRealSessionResults.every((result) => result.status === "succeeded")
    : null;

  return {
    overall_status:
      syntheticCasesPassed && (!realSessionIncluded || realSessionCasePassed === true)
        ? "passed"
        : "failed",
    synthetic_cases_passed: syntheticCasesPassed,
    real_session_included: realSessionIncluded,
    real_session_case_passed: realSessionCasePassed,
    failed_case_ids: failedCaseIds
  };
}

type ProviderLabel = "mock" | "openai";

export type FormativeActivityProviderAudit = {
  agent_call_id?: string;
  provider: ProviderLabel;
  model_name: string;
  client_request_id?: string;
  provider_request_id?: string;
  provider_response_id?: string;
  call_status?: "succeeded" | "failed" | "invalid_output" | "started";
  output_validated?: boolean;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

export type FormativeActivityLivePipelineIssue = {
  field_path: string;
  rule_code:
    | "schema_invalid"
    | "generator_deterministic_validation_failed"
    | "reviewer_schema_invalid"
    | "reviewer_fail_closed"
    | "reviewer_repair_needed"
    | "repair_missing"
    | "repair_not_allowed"
    | "repair_deterministic_validation_failed"
    | "missing_provider_metadata"
    | "missing_token_usage"
    | "missing_audit_metadata"
    | "runtime_guard_rejected";
  blocked_pattern_label?: string;
};

export type FormativeActivityLivePipelineResult =
  | {
      status: "accepted";
      packet: FormativeActivityPacketV1;
      quality_review: FormativeActivityQualityReviewV1;
      repair_attempted: boolean;
      issues: [];
    }
  | {
      status: "rejected";
      quality_review?: FormativeActivityQualityReviewV1;
      repair_attempted: boolean;
      issues: FormativeActivityLivePipelineIssue[];
      blocked_reason: string;
    };

type LiveActivitySourceInput = {
  profile_integration_packet: ProfileIntegrationInterpretationPacketV1;
  formative_value_packet: FormativeValueDeterminationPacketV1;
  assessment_interpretation_context?: AssessmentInterpretationContextV1;
};

export type FormativeActivityLiveAgentInput = ReturnType<typeof buildFormativeActivityLiveAgentInput>;

function nowIso() {
  return new Date().toISOString();
}

function configured(value?: string | null) {
  return typeof value === "string" && value.trim().length > 0;
}

function prismaJson(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function providerAuditUpdate(providerResult: StructuredAgentResult<unknown>) {
  const rawOutput =
    providerResult.raw_output ?? (
      providerResult.status === "failed"
        ? {
            provider_failure: {
              provider: providerResult.provider,
              status: providerResult.status,
              category: providerResult.error?.category ?? null,
              message: providerResult.error?.message ?? null,
              retryable: providerResult.error?.retryable ?? null,
              transport: providerResult.transport_telemetry
                ? {
                    adapter_version: providerResult.transport_telemetry.adapter_version,
                    model_name: providerResult.transport_telemetry.model_name,
                    http_status:
                      providerResult.transport_telemetry.normalized_error?.http_status ??
                      providerResult.transport_telemetry.http_status ??
                      null,
                    typed_failure_reason:
                      providerResult.transport_telemetry.normalized_error?.typed_failure_reason ??
                      null,
                    provider_error_code:
                      providerResult.transport_telemetry.normalized_error?.provider_error_code ??
                      null
                  }
                : null
            }
          }
        : undefined
    );

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

function validationErrorPayload(input: {
  category:
    | "formative_activity_validation"
    | "formative_activity_review_validation"
    | "formative_activity_pipeline_validation"
    | "provider_failure";
  issues?: Array<FormativeActivityValidationIssue | FormativeActivityLivePipelineIssue>;
  message?: string;
}) {
  return JSON.stringify({
    category: input.category,
    issue_count: input.issues?.length ?? 0,
    ...(input.issues ? { issues: input.issues } : {}),
    ...(input.message ? { message: input.message.slice(0, 500) } : {})
  });
}

function safeProviderFailureReason(providerResult: StructuredAgentResult<unknown>) {
  return [
    providerResult.error?.category ?? providerResult.status,
    providerResult.transport_telemetry?.normalized_error?.typed_failure_reason,
    providerResult.transport_telemetry?.normalized_error?.http_status !== undefined &&
      providerResult.transport_telemetry.normalized_error.http_status !== null
      ? `http_${providerResult.transport_telemetry.normalized_error.http_status}`
      : null
  ].filter(Boolean).join(":");
}

function resolveFormativeActivityModelConfig(): AgentModelConfig {
  const env = getServerEnv();
  const modelName = [env.OPENAI_MODEL_PROFILE_INTEGRATION, env.OPENAI_MODEL_PLANNING, env.OPENAI_MODEL_FOLLOWUP]
    .find((value) => configured(value));

  if (!configured(modelName)) {
    throw new LlmConfigurationError(
      "formative_activity_model_missing",
      "OPENAI_MODEL_PROFILE_INTEGRATION, OPENAI_MODEL_PLANNING, or OPENAI_MODEL_FOLLOWUP is required when live formative activity generation is explicitly enabled.",
      { agent_name: FORMATIVE_ACTIVITY_AGENT_NAME }
    );
  }

  return {
    model_name: String(modelName),
    reasoning_effort: (env.OPENAI_REASONING_EFFORT_PLANNING ??
      env.OPENAI_REASONING_EFFORT_FOLLOWUP) as AgentModelConfig["reasoning_effort"],
    max_output_tokens:
      env.OPENAI_MAX_OUTPUT_TOKENS_PROFILE_INTEGRATION ??
      env.OPENAI_MAX_OUTPUT_TOKENS_PLANNING ??
      env.OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP ??
      3500
  };
}

async function resolveAuditContext(sessionPublicId: string) {
  const session = await prisma.assessmentSession.findUnique({
    where: { session_public_id: sessionPublicId },
    select: {
      id: true,
      concept_unit_sessions: {
        orderBy: [{ updated_at: "desc" }],
        take: 1,
        select: { id: true }
      }
    }
  });

  return {
    assessment_session_db_id: session?.id,
    concept_unit_session_db_id: session?.concept_unit_sessions[0]?.id
  };
}

async function resolveAssessmentContext(sessionPublicId: string) {
  const responsePackage = await prisma.responsePackage.findFirst({
    where: {
      package_type: "initial_concept_unit_response_package",
      concept_unit_session: {
        assessment_session: {
          session_public_id: sessionPublicId
        }
      }
    },
    orderBy: [{ created_at: "desc" }],
    select: { payload: true }
  });

  return responsePackage
    ? buildAssessmentInterpretationContextFromResponsePackage({
        response_package_payload: responsePackage.payload,
        phase: "formative_activity"
      })
    : undefined;
}

function selectedFormativeValue(packet: FormativeValueDeterminationPacketV1) {
  return packet.student_choice_state.selected_value &&
    packet.student_choice_state.selected_value !== "move_on"
    ? packet.student_choice_state.selected_value
    : packet.primary_value;
}

function familyQualityMarkers(family: FormativeActivityPacketV1["activity_family"]) {
  switch (family) {
    case "basic_concept_grounding":
      return [
        "\"basic distinction\" or \"key distinction\"",
        "\"thermometer\"",
        "\"theta\"",
        "\"ability scale\"",
        "\"item parameters\"",
        "\"item information\" or \"difficulty\"",
        "expected prompt starts with Explain and includes in your own words"
      ];
    case "distractor_contrast":
      return [
        "\"tempting alternative\"",
        "\"hidden assumption\"",
        "person ability versus item features boundary",
        "expected prompt starts with Compare"
      ];
    case "reasoning_chain_repair":
      return [
        "\"useful part\" or \"useful starting point\"",
        "\"missing link\"",
        "\"tempting alternative\"",
        "expected prompt starts with Revise"
      ];
    case "independent_reconstruction":
      return [
        "\"Setting the option choices aside\"",
        "\"current evidence is mixed or unclear\"",
        "\"in your own words\"",
        "expected prompt starts with Explain or Reconstruct"
      ];
    case "confidence_evidence_audit":
      return [
        "\"confidence\"",
        "\"evidence\"",
        "\"usable understanding\"",
        "\"low confidence can be worth checking\"",
        "expected prompt starts with Rate or Connect"
      ];
    case "transfer_and_distractor_generation":
      return [
        "\"not another scored question\"",
        "\"Transfer means\"",
        "\"Distractor generation means\"",
        "\"nearby situation\" or \"nearby example\"",
        "expected prompt starts with Apply or Generate"
      ];
  }
}

export function buildFormativeActivityLiveAgentInput(input: LiveActivitySourceInput) {
  const designPacket = buildFormativeActivityDesignPacketFromPackets(input);
  const profile = input.profile_integration_packet;
  const formative = input.formative_value_packet;
  const contextFields = input.assessment_interpretation_context
    ? {
        assessment_interpretation_context: input.assessment_interpretation_context,
        assessment_context_audit: assessmentInterpretationContextAuditMetadata(
          input.assessment_interpretation_context
        ) satisfies AssessmentInterpretationContextAuditMetadata
      }
    : {};

  const liveInput = {
    schema_version: FORMATIVE_ACTIVITY_LIVE_INPUT_SCHEMA_VERSION,
    session_public_id: formative.session_public_id,
    student_public_id: formative.student_public_id,
    assessment_public_id: formative.assessment_public_id,
    concept_unit_id: formative.concept_unit_id,
    required_output_contract: {
      schema_version: FORMATIVE_ACTIVITY_SCHEMA_VERSION,
      agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
      generation_source: "live_llm",
      runtime_servable_to_student: true,
      review_only: false
    },
    source_schemas: {
      profile_integration_schema: PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
      formative_value_schema: FORMATIVE_VALUE_PACKET_SCHEMA_VERSION
    },
    selected_formative_value: selectedFormativeValue(formative),
    required_activity_family: designPacket.activity_family,
    required_family_quality_markers: familyQualityMarkers(designPacket.activity_family),
    required_activity_mode: designPacket.activity_mode,
    concept_focus: profile.student_safe_message.knowledge_focus,
    student_safe_profile_status: profile.student_facing_status,
    student_safe_profile_message: profile.student_safe_message.message,
    ability_summary: profile.ability_interpretation.summary,
    confidence_summary: profile.ability_interpretation.confidence_calibration_summary,
    evidence_consistency: profile.ability_interpretation.evidence_consistency,
    main_conceptual_issue: profile.ability_interpretation.main_conceptual_issue,
    formative_value_student_summary: formative.rationale.student_safe_summary,
    formative_value_choice_prompt: formative.student_safe_message.choice_prompt,
    distractor_role: designPacket.distractor_use.distractor_role,
    distractor_student_safe_description: designPacket.distractor_use.student_safe_description,
    activity_goal: designPacket.activity_goal.student_safe_goal,
    expected_student_action_type: designPacket.expected_student_action.action_type,
    required_dialogue_protocol: designPacket.dialogue_protocol,
    required_student_choice_policy: designPacket.student_choice_policy,
    safety_constraints: {
      no_answer_key: true,
      no_correct_option: true,
      no_correctness_label: true,
      no_raw_distractor_metadata: true,
      no_misconception_ids: true,
      no_engagement_or_ai_labels: true,
      no_raw_process_payload: true,
      no_raw_reasoning: true,
      no_raw_llm_output: true,
      no_secrets_or_headers: true,
      no_scored_item_generation: true
    },
    ...contextFields
  } as const;

  assertNoProhibitedProviderInput(liveInput);
  return liveInput;
}

function candidateWithGeneratedAt(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>;
    return {
      ...candidate,
      generated_at: typeof candidate.generated_at === "string" ? candidate.generated_at : nowIso()
    };
  }
  return value;
}

function auditHasProviderMetadata(audit: FormativeActivityProviderAudit | undefined) {
  return Boolean(audit?.provider_request_id || audit?.provider_response_id);
}

function auditHasTokenUsage(audit: FormativeActivityProviderAudit | undefined) {
  return Boolean(
    typeof audit?.input_tokens === "number" ||
      typeof audit?.output_tokens === "number" ||
      typeof audit?.total_tokens === "number"
  );
}

function auditHasCoreMetadata(audit: FormativeActivityProviderAudit | undefined) {
  return Boolean(audit?.agent_call_id && audit.client_request_id && audit.model_name && audit.provider);
}

function providerAuditFromResult(input: {
  agent_call_id: string;
  model_name: string;
  providerResult: StructuredAgentResult<unknown>;
}): FormativeActivityProviderAudit {
  const ids = providerAuditMetadata(input.providerResult);
  return {
    agent_call_id: input.agent_call_id,
    provider: input.providerResult.provider,
    model_name: input.model_name,
    client_request_id: input.providerResult.client_request_id,
    provider_request_id: ids.provider_request_id,
    provider_response_id: ids.provider_response_id,
    call_status:
      input.providerResult.status === "completed"
        ? "succeeded"
        : input.providerResult.status === "failed"
          ? "failed"
          : "invalid_output",
    output_validated: input.providerResult.status === "completed",
    input_tokens: input.providerResult.usage?.input_tokens,
    output_tokens: input.providerResult.usage?.output_tokens,
    total_tokens: input.providerResult.usage?.total_tokens
  };
}

function pushPipelineIssue(
  issues: FormativeActivityLivePipelineIssue[],
  field_path: string,
  rule_code: FormativeActivityLivePipelineIssue["rule_code"],
  blocked_pattern_label?: string
) {
  issues.push({ field_path, rule_code, ...(blocked_pattern_label ? { blocked_pattern_label } : {}) });
}

const NON_REPAIRABLE_VALIDATION_RULES = new Set<FormativeActivityValidationIssue["rule_code"]>([
  "schema_invalid",
  "invalid_generation_source_metadata",
  "answer_key_leak_detected",
  "correct_option_leak_detected",
  "correctness_label_detected",
  "distractor_metadata_detected",
  "misconception_id_exposed",
  "raw_reasoning_exposed",
  "raw_process_payload_exposed",
  "raw_llm_output_exposed",
  "secret_or_header_exposed",
  "engagement_or_ai_label_exposed",
  "internal_evidence_label_exposed",
  "unsupported_integrity_language_detected",
  "low_participation_language_detected",
  "new_scored_item_generated",
  "unsafe_safety_flag"
]);

function validationIssuesAreRepairable(issues: FormativeActivityValidationIssue[]) {
  return issues.length > 0 && issues.every((issue) => !NON_REPAIRABLE_VALIDATION_RULES.has(issue.rule_code));
}

function addAuditGateIssues(
  issues: FormativeActivityLivePipelineIssue[],
  prefix: "generator" | "reviewer" | "repair",
  audit: FormativeActivityProviderAudit | undefined
) {
  if (!auditHasCoreMetadata(audit)) {
    pushPipelineIssue(issues, `${prefix}_audit`, "missing_audit_metadata");
  }
  if (!auditHasProviderMetadata(audit)) {
    pushPipelineIssue(issues, `${prefix}_audit`, "missing_provider_metadata");
  }
  if (!auditHasTokenUsage(audit)) {
    pushPipelineIssue(issues, `${prefix}_audit`, "missing_token_usage");
  }
}

function issueCanTriggerRepair(issue: FormativeActivityLivePipelineIssue) {
  if (issue.rule_code === "generator_deterministic_validation_failed") {
    return !NON_REPAIRABLE_VALIDATION_RULES.has(
      issue.blocked_pattern_label as FormativeActivityValidationIssue["rule_code"]
    );
  }

  return ["reviewer_repair_needed", "repair_missing"].includes(issue.rule_code);
}

export function formativeActivityPipelineIssuesAllowRepair(
  issues: FormativeActivityLivePipelineIssue[]
) {
  return issues.length > 0 && issues.every(issueCanTriggerRepair);
}

export function formativeActivityPipelineNeedsRepair(
  result: FormativeActivityLivePipelineResult
) {
  return result.status === "rejected" &&
    result.blocked_reason === "formative_activity_repair_missing" &&
    formativeActivityPipelineIssuesAllowRepair(result.issues);
}

function repairInstructionForIssue(issue: FormativeActivityLivePipelineIssue) {
  const label = issue.blocked_pattern_label ?? issue.rule_code;
  switch (label) {
    case "missing_concept_explanation":
    case "missing_concrete_concept_explanation":
      return "Add concrete student-facing concept explanation before the prompt.";
    case "missing_family_specific_content":
      return "Add activity-family-specific content instead of generic feedback.";
    case "missing_basic_concept_depth":
      return "For basic concept grounding, include 3 to 5 concrete concept-explanation sentences.";
    case "missing_response_connection":
      return "Connect the first turn to the student's prior response pattern in student-safe language.";
    case "missing_hidden_assumption":
      return "Name the hidden assumption behind the tempting alternative.";
    case "weak_generic_tempting_alternative":
    case "fake_distractor_contrast":
    case "missing_distractor_contrast":
    case "missing_concrete_distractor_description":
      return "Make the distractor contrast concrete, including why it feels tempting and how the target idea differs.";
    case "generic_feedback":
    case "generic_feedback_detected":
      return "Replace generic feedback with specific concept explanation and a response connection.";
    case "template_splice_artifact":
    case "label_sentence_duplication":
      return "Remove colon-spliced template fragments and write complete natural sentences.";
    case "multiple_or_missing_prompts":
    case "missing_student_prompt":
      return "End first_turn.message with exactly one final student-facing question mark; do not put the only prompt in expected_student_action.prompt.";
    case "multiple_student_prompts":
    case "duplicate_first_turn_and_action_prompt":
      return "End with exactly one clear student action question.";
    default:
      return `Repair safe quality issue: ${label}.`;
  }
}

function repairInstructionsFromPipelineIssues(
  issues: FormativeActivityLivePipelineIssue[],
  reviewerInstructions: string[]
) {
  return Array.from(new Set([
    ...reviewerInstructions,
    ...issues
      .filter((issue) => issue.rule_code === "generator_deterministic_validation_failed")
      .map(repairInstructionForIssue)
  ])).slice(0, 10);
}

function safeReviewIssuesFromPipelineIssues(issues: FormativeActivityLivePipelineIssue[]) {
  return issues.map((issue) => ({
    field_path: issue.field_path,
    rule_code: issue.blocked_pattern_label ?? issue.rule_code,
    severity: "major" as const,
    safe_summary: repairInstructionForIssue(issue)
  }));
}

export function evaluateFormativeActivityLivePipeline(input: {
  candidate_packet: unknown;
  generator_audit: FormativeActivityProviderAudit;
  reviewer_output: unknown;
  reviewer_audit: FormativeActivityProviderAudit;
  repair_packet?: unknown;
  repair_audit?: FormativeActivityProviderAudit;
}): FormativeActivityLivePipelineResult {
  const issues: FormativeActivityLivePipelineIssue[] = [];
  addAuditGateIssues(issues, "generator", input.generator_audit);
  addAuditGateIssues(issues, "reviewer", input.reviewer_audit);

  const reviewParse = FormativeActivityQualityReviewV1Schema.safeParse(input.reviewer_output);
  if (!reviewParse.success) {
    for (const issue of reviewParse.error.issues) {
      pushPipelineIssue(issues, issue.path.join(".") || "quality_review", "reviewer_schema_invalid");
    }
  }
  const review = reviewParse.success ? reviewParse.data : undefined;

  const candidate = candidateWithGeneratedAt(input.candidate_packet);
  const validation = validateFormativeActivityPacket(candidate);
  if (!validation.valid) {
    for (const issue of validation.issues) {
      pushPipelineIssue(
        issues,
        issue.field_path,
        "generator_deterministic_validation_failed",
        issue.rule_code
      );
    }
  }

  if (review?.review_status === "fail_closed") {
    pushPipelineIssue(issues, "quality_review.review_status", "reviewer_fail_closed");
  }

  const repairRequested = review?.review_status === "repair_needed";
  const deterministicRepairAllowed = !validation.valid && validationIssuesAreRepairable(validation.issues);
  const reviewerRepairAllowed = validation.valid && repairRequested;
  const repairAllowed = deterministicRepairAllowed || reviewerRepairAllowed;

  if (repairRequested && !repairAllowed) {
    pushPipelineIssue(issues, "quality_review.review_status", "repair_not_allowed");
  }

  if (issues.length > 0 && !repairAllowed) {
    return {
      status: "rejected",
      quality_review: review,
      repair_attempted: false,
      issues,
      blocked_reason: "formative_activity_live_hard_gate_failed"
    };
  }

  if (repairAllowed) {
    if (!input.repair_packet || !input.repair_audit) {
      pushPipelineIssue(issues, "repair_packet", "repair_missing");
      return {
        status: "rejected",
        quality_review: review,
        repair_attempted: false,
        issues,
        blocked_reason: "formative_activity_repair_missing"
      };
    }

    const repairIssues = issues.filter((issue) =>
      !["generator_deterministic_validation_failed", "reviewer_repair_needed"].includes(issue.rule_code)
    );
    addAuditGateIssues(repairIssues, "repair", input.repair_audit);
    const repairValidation = validateFormativeActivityPacket(candidateWithGeneratedAt(input.repair_packet));
    if (!repairValidation.valid) {
      for (const issue of repairValidation.issues) {
        pushPipelineIssue(
          repairIssues,
          issue.field_path,
          "repair_deterministic_validation_failed",
          issue.rule_code
        );
      }
    }
    if (repairIssues.length > 0 || !repairValidation.valid) {
      return {
        status: "rejected",
        quality_review: review,
        repair_attempted: true,
        issues: repairIssues,
        blocked_reason: "formative_activity_repair_failed_hard_gate"
      };
    }

    try {
      assertFormativeActivityPacketIsNotReviewOnlyForRuntime(repairValidation.packet);
    } catch (error) {
      pushPipelineIssue(
        repairIssues,
        "repair_packet",
        "runtime_guard_rejected",
        error instanceof Error ? error.message : "runtime_guard_error"
      );
      return {
        status: "rejected",
        quality_review: review,
        repair_attempted: true,
        issues: repairIssues,
        blocked_reason: "formative_activity_runtime_guard_rejected_repair"
      };
    }

    return {
      status: "accepted",
      packet: repairValidation.packet,
      quality_review: review ?? failClosedReview("reviewer_schema_missing_after_repair"),
      repair_attempted: true,
      issues: []
    };
  }

  if (!validation.valid || issues.length > 0 || !review || review.review_status !== "pass") {
    if (review?.review_status === "repair_needed") {
      pushPipelineIssue(issues, "quality_review.review_status", "reviewer_repair_needed");
    }
    return {
      status: "rejected",
      quality_review: review,
      repair_attempted: false,
      issues,
      blocked_reason: "formative_activity_live_pipeline_rejected"
    };
  }

  try {
    assertFormativeActivityPacketIsNotReviewOnlyForRuntime(validation.packet);
  } catch (error) {
    pushPipelineIssue(
      issues,
      "candidate_packet",
      "runtime_guard_rejected",
      error instanceof Error ? error.message : "runtime_guard_error"
    );
    return {
      status: "rejected",
      quality_review: review,
      repair_attempted: false,
      issues,
      blocked_reason: "formative_activity_runtime_guard_rejected"
    };
  }

  return {
    status: "accepted",
    packet: validation.packet,
    quality_review: review,
    repair_attempted: false,
    issues: []
  };
}

function failClosedReview(reason: string): FormativeActivityQualityReviewV1 {
  return {
    schema_version: FORMATIVE_ACTIVITY_QUALITY_REVIEW_SCHEMA_VERSION,
    agent_name: FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_NAME,
    review_status: "fail_closed",
    quality_score: "unsafe",
    student_specificity: "unsafe",
    conceptual_depth: "unsafe",
    distractor_use_quality: "unsafe",
    formative_value_alignment: "unsafe",
    activity_family_alignment: "unsafe",
    overclaiming_risk: "high",
    student_safety_risk: "high",
    issues: [{
      field_path: "quality_review",
      rule_code: reason,
      severity: "critical",
      safe_summary: "Quality review could not safely approve this output."
    }],
    repair_instructions: []
  };
}

function passedQualityReview(): FormativeActivityQualityReviewV1 {
  return {
    schema_version: FORMATIVE_ACTIVITY_QUALITY_REVIEW_SCHEMA_VERSION,
    agent_name: FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_NAME,
    review_status: "pass",
    quality_score: "strong",
    student_specificity: "strong",
    conceptual_depth: "strong",
    distractor_use_quality: "adequate",
    formative_value_alignment: "strong",
    activity_family_alignment: "strong",
    overclaiming_risk: "none",
    student_safety_risk: "none",
    issues: [],
    repair_instructions: []
  };
}

async function createAgentCall(input: {
  audit_context?: Awaited<ReturnType<typeof resolveAuditContext>>;
  agent_name: string;
  agent_version: string;
  model_config: AgentModelConfig;
  provider_label: ProviderLabel;
  prompt_hash: string;
  prompt_version: string;
  schema_version: string;
  input_payload: unknown;
  live_call_allowed: boolean;
  invocation_prefix: string;
}) {
  const startedAt = new Date();
  const clientRequestId = `${input.invocation_prefix}_${randomUUID()}`;

  const agentCall = await prisma.agentCall.create({
    data: {
      id: randomUUID(),
      assessment_session_db_id: input.audit_context?.assessment_session_db_id,
      concept_unit_session_db_id: input.audit_context?.concept_unit_session_db_id,
      agent_name: input.agent_name,
      agent_version: input.agent_version,
      model_name: input.model_config.model_name,
      provider: input.provider_label,
      client_request_id: clientRequestId,
      agent_invocation_key: `${input.invocation_prefix}:${hashJson(input.input_payload).slice(0, 24)}:${randomUUID()}`,
      prompt_hash: input.prompt_hash,
      reasoning_effort: input.model_config.reasoning_effort,
      max_output_tokens: input.model_config.max_output_tokens,
      prompt_version: input.prompt_version,
      schema_version: input.schema_version,
      input_payload: prismaJson(redactForAudit(input.input_payload)),
      live_call_allowed: input.live_call_allowed,
      call_status: "started",
      started_at: startedAt
    }
  });

  return { agentCall, clientRequestId };
}

async function executeStructuredWithAudit<TInput, TOutput>(input: {
  audit_context?: Awaited<ReturnType<typeof resolveAuditContext>>;
  provider: LlmProvider;
  provider_label: ProviderLabel;
  model_config: AgentModelConfig;
  request_timeout_ms: number;
  live_call_allowed: boolean;
  agent_name: string;
  agent_version: string;
  prompt_hash: string;
  prompt_version: string;
  instructions: string;
  request_input: TInput;
  output_schema: z.ZodType<TOutput>;
  schema_version: string;
  schema_name: string;
  invocation_prefix: string;
  metadata: Record<string, string>;
}) {
  assertNoProhibitedProviderInput(input.request_input);
  const { agentCall, clientRequestId } = await createAgentCall({
    audit_context: input.audit_context,
    agent_name: input.agent_name,
    agent_version: input.agent_version,
    model_config: input.model_config,
    provider_label: input.provider_label,
    prompt_hash: input.prompt_hash,
    prompt_version: input.prompt_version,
    schema_version: input.schema_version,
    input_payload: input.request_input,
    live_call_allowed: input.live_call_allowed,
    invocation_prefix: input.invocation_prefix
  });

  try {
    const providerResult = await input.provider.executeStructured({
      agent_name: input.agent_name as unknown as AgentName,
      model_config: input.model_config,
      instructions: input.instructions,
      input: input.request_input,
      output_schema: input.output_schema,
      schema_name: input.schema_name.replace(/[^a-zA-Z0-9_-]/g, "_"),
      client_request_id: clientRequestId,
      timeout_ms: input.request_timeout_ms,
      metadata: input.metadata
    });

    if (providerResult.status === "completed") {
      await prisma.agentCall.update({
        where: { id: agentCall.id },
        data: {
          ...providerAuditUpdate(providerResult),
          output_payload: prismaJson(providerResult.parsed_output ?? Prisma.JsonNull),
          output_validated: true,
          call_status: "succeeded",
          completed_at: new Date()
        }
      });
    } else {
      await prisma.agentCall.update({
        where: { id: agentCall.id },
        data: {
          ...providerAuditUpdate(providerResult),
          output_payload: Prisma.JsonNull,
          output_validated: false,
          validation_error: validationErrorPayload({
            category: "provider_failure",
            message:
              providerResult.error?.message ??
              providerResult.refusal ??
              providerResult.incomplete_reason ??
              "Formative activity provider call did not complete."
          }),
          refusal_text: providerResult.refusal,
          incomplete_reason: providerResult.incomplete_reason,
          call_status: "failed",
          error_category: providerResult.error?.category ?? providerResult.status,
          blocked_reason: safeProviderFailureReason(providerResult),
          completed_at: new Date()
        }
      });
    }

    return {
      agent_call_id: agentCall.id,
      providerResult
    };
  } catch (error) {
    await prisma.agentCall.update({
      where: { id: agentCall.id },
      data: {
        output_payload: Prisma.JsonNull,
        output_validated: false,
        validation_error: validationErrorPayload({
          category: "provider_failure",
          message: error instanceof Error ? error.message : "Formative activity provider call failed."
        }),
        call_status: "failed",
        error_category: "unexpected_provider_response",
        completed_at: new Date()
      }
    });

    throw error;
  }
}

export type FormativeActivityLiveExecutionResult =
  | {
      status: "succeeded";
      packet: FormativeActivityPacketV1;
      quality_review: FormativeActivityQualityReviewV1;
      generator_agent_call_id: string;
      reviewer_agent_call_id: string;
      repair_agent_call_id?: string;
      repair_attempted: boolean;
      generator_call_status: "succeeded" | "invalid_output";
      reviewer_call_status: "succeeded";
      repair_status: "not_attempted" | "succeeded";
    }
  | {
      status: "failed" | "invalid_output" | "configuration_blocked";
      blocked_reason: string;
      validation_issues: FormativeActivityLivePipelineIssue[];
      generator_agent_call_id?: string;
      reviewer_agent_call_id?: string;
      repair_agent_call_id?: string;
      repair_attempted: boolean;
      generator_call_status?: "not_started" | "succeeded" | "failed" | "invalid_output";
      reviewer_call_status?: "not_started" | "succeeded" | "failed" | "invalid_output";
      repair_status?: "not_attempted" | "succeeded" | "failed" | "invalid_output";
    };

export async function executeLiveFormativeActivityDialogueAgent(input: {
  profile_integration_packet: ProfileIntegrationInterpretationPacketV1;
  formative_value_packet: FormativeValueDeterminationPacketV1;
  provider_override?: LlmProvider;
}): Promise<FormativeActivityLiveExecutionResult> {
  let runtime;
  let modelConfig;

  try {
    runtime = getLlmRuntimeConfig();
    modelConfig = resolveFormativeActivityModelConfig();
  } catch (error) {
    return {
      status: "configuration_blocked",
      blocked_reason: error instanceof Error ? error.message : "Formative activity live configuration failed.",
      validation_issues: [{
        field_path: "configuration",
        rule_code: "missing_audit_metadata",
        blocked_pattern_label: error instanceof LlmConfigurationError ? error.code : "configuration_error"
      }],
      repair_attempted: false,
      generator_call_status: "not_started",
      reviewer_call_status: "not_started",
      repair_status: "not_attempted"
    };
  }

  if (runtime.provider !== "openai" || !runtime.live_calls_enabled) {
    return {
      status: "configuration_blocked",
      blocked_reason: "Set LLM_PROVIDER=openai and LLM_LIVE_CALLS_ENABLED=true for live formative activity generation.",
      validation_issues: [{
        field_path: "configuration",
        rule_code: "missing_audit_metadata",
        blocked_pattern_label: "live_calls_not_enabled"
      }],
      repair_attempted: false,
      generator_call_status: "not_started",
      reviewer_call_status: "not_started",
      repair_status: "not_attempted"
    };
  }

  const provider = input.provider_override ?? createLlmProvider();
  const providerLabel: ProviderLabel = input.provider_override ? "mock" : "openai";
  const assessmentContext = await resolveAssessmentContext(
    input.formative_value_packet.session_public_id
  );
  const agentInput = buildFormativeActivityLiveAgentInput({
    ...input,
    assessment_interpretation_context: assessmentContext
  });
  const auditContext = await resolveAuditContext(input.formative_value_packet.session_public_id);

  const generator = await executeStructuredWithAudit({
    audit_context: auditContext,
    provider,
    provider_label: providerLabel,
    model_config: modelConfig,
    request_timeout_ms: runtime.request_timeout_ms,
    live_call_allowed: providerLabel === "openai",
    agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
    agent_version: FORMATIVE_ACTIVITY_AGENT_VERSION,
    prompt_hash: FORMATIVE_ACTIVITY_PROMPT_HASH,
    prompt_version: FORMATIVE_ACTIVITY_PROMPT_VERSION,
    instructions: FORMATIVE_ACTIVITY_PROMPT_INSTRUCTIONS,
    request_input: agentInput,
    output_schema: FormativeActivityPacketV1Schema,
    schema_version: FORMATIVE_ACTIVITY_SCHEMA_VERSION,
    schema_name: FORMATIVE_ACTIVITY_SCHEMA_VERSION,
    invocation_prefix: "formative_activity_generator",
    metadata: {
      purpose: "chat_native_formative_activity_generation",
      agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
      prompt_version: FORMATIVE_ACTIVITY_PROMPT_VERSION,
      schema_version: FORMATIVE_ACTIVITY_SCHEMA_VERSION
    }
  });

  if (generator.providerResult.status !== "completed") {
    return {
      status: "failed",
      blocked_reason: "formative_activity_generator_provider_failed",
      validation_issues: [{
        field_path: "generator_provider",
        rule_code: "missing_audit_metadata",
        blocked_pattern_label: safeProviderFailureReason(generator.providerResult)
      }],
      generator_agent_call_id: generator.agent_call_id,
      repair_attempted: false,
      generator_call_status: "failed",
      reviewer_call_status: "not_started",
      repair_status: "not_attempted"
    };
  }

  const reviewerInput = {
    schema_version: "formative-activity-reviewer-input-v1",
    source_input: agentInput,
    candidate_packet: candidateWithGeneratedAt(generator.providerResult.parsed_output)
  };
  const reviewer = await executeStructuredWithAudit({
    audit_context: auditContext,
    provider,
    provider_label: providerLabel,
    model_config: modelConfig,
    request_timeout_ms: runtime.request_timeout_ms,
    live_call_allowed: providerLabel === "openai",
    agent_name: FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_NAME,
    agent_version: FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_VERSION,
    prompt_hash: FORMATIVE_ACTIVITY_QUALITY_REVIEW_PROMPT_HASH,
    prompt_version: FORMATIVE_ACTIVITY_QUALITY_REVIEW_PROMPT_VERSION,
    instructions: FORMATIVE_ACTIVITY_QUALITY_REVIEW_PROMPT_INSTRUCTIONS,
    request_input: reviewerInput,
    output_schema: FormativeActivityQualityReviewV1Schema,
    schema_version: FORMATIVE_ACTIVITY_QUALITY_REVIEW_SCHEMA_VERSION,
    schema_name: FORMATIVE_ACTIVITY_QUALITY_REVIEW_SCHEMA_VERSION,
    invocation_prefix: "formative_activity_quality_review",
    metadata: {
      purpose: "chat_native_formative_activity_quality_review",
      agent_name: FORMATIVE_ACTIVITY_QUALITY_REVIEWER_AGENT_NAME,
      prompt_version: FORMATIVE_ACTIVITY_QUALITY_REVIEW_PROMPT_VERSION,
      schema_version: FORMATIVE_ACTIVITY_QUALITY_REVIEW_SCHEMA_VERSION
    }
  });

  if (reviewer.providerResult.status !== "completed") {
    return {
      status: "failed",
      blocked_reason: "formative_activity_reviewer_provider_failed",
      validation_issues: [{
        field_path: "reviewer_provider",
        rule_code: "missing_audit_metadata",
        blocked_pattern_label: safeProviderFailureReason(reviewer.providerResult)
      }],
      generator_agent_call_id: generator.agent_call_id,
      reviewer_agent_call_id: reviewer.agent_call_id,
      repair_attempted: false,
      generator_call_status: "succeeded",
      reviewer_call_status: "failed",
      repair_status: "not_attempted"
    };
  }

  const firstPipeline = evaluateFormativeActivityLivePipeline({
    candidate_packet: generator.providerResult.parsed_output,
    generator_audit: providerAuditFromResult({
      agent_call_id: generator.agent_call_id,
      model_name: modelConfig.model_name,
      providerResult: generator.providerResult
    }),
    reviewer_output: reviewer.providerResult.parsed_output,
    reviewer_audit: providerAuditFromResult({
      agent_call_id: reviewer.agent_call_id,
      model_name: modelConfig.model_name,
      providerResult: reviewer.providerResult
    })
  });

  if (firstPipeline.status === "accepted") {
    return {
      status: "succeeded",
      packet: firstPipeline.packet,
      quality_review: firstPipeline.quality_review,
      generator_agent_call_id: generator.agent_call_id,
      reviewer_agent_call_id: reviewer.agent_call_id,
      repair_attempted: false,
      generator_call_status: "succeeded",
      reviewer_call_status: "succeeded",
      repair_status: "not_attempted"
    };
  }

  const reviewerOutput = FormativeActivityQualityReviewV1Schema.safeParse(
    reviewer.providerResult.parsed_output
  );

  const repairIsAllowed = formativeActivityPipelineIssuesAllowRepair(firstPipeline.issues);
  const reviewerBlocksRepair = reviewerOutput.data?.review_status === "fail_closed";
  const generatorHadValidationFailure = firstPipeline.issues.some(
    (issue) => issue.rule_code === "generator_deterministic_validation_failed"
  );

  if (!repairIsAllowed || reviewerBlocksRepair) {
    await prisma.agentCall.update({
      where: { id: generator.agent_call_id },
      data: {
        output_validated: false,
        validation_error: validationErrorPayload({
          category: "formative_activity_pipeline_validation",
          issues: firstPipeline.issues
        }),
        call_status: "invalid_output",
        error_category: "formative_activity_pipeline_validation"
      }
    });
    return {
      status: "invalid_output",
      blocked_reason: firstPipeline.blocked_reason,
      validation_issues: firstPipeline.issues,
      generator_agent_call_id: generator.agent_call_id,
      reviewer_agent_call_id: reviewer.agent_call_id,
      repair_attempted: false,
      generator_call_status: "invalid_output",
      reviewer_call_status: "succeeded",
      repair_status: "not_attempted"
    };
  }

  if (generatorHadValidationFailure) {
    await prisma.agentCall.update({
      where: { id: generator.agent_call_id },
      data: {
        output_validated: false,
        validation_error: validationErrorPayload({
          category: "formative_activity_pipeline_validation",
          issues: firstPipeline.issues
        }),
        call_status: "invalid_output",
        error_category: "formative_activity_pipeline_validation"
      }
    });
  }

  const repairInput = {
    schema_version: "formative-activity-repair-input-v1",
    source_input: agentInput,
    hard_repair_checklist_for_family: familyQualityMarkers(agentInput.required_activity_family),
    candidate_packet_summary: {
      output_schema_valid: FormativeActivityPacketV1Schema.safeParse(
        candidateWithGeneratedAt(generator.providerResult.parsed_output)
      ).success,
      validation_issue_count: firstPipeline.issues.length,
      validation_issue_codes: firstPipeline.issues.map((issue) =>
        issue.blocked_pattern_label ?? issue.rule_code
      )
    },
    safe_repair_instructions: repairInstructionsFromPipelineIssues(
      firstPipeline.issues,
      reviewerOutput.data?.repair_instructions ?? []
    ),
    safe_review_issues: [
      ...(reviewerOutput.data?.issues.map((issue) => ({
        field_path: issue.field_path,
        rule_code: issue.rule_code,
        severity: issue.severity,
        safe_summary: issue.safe_summary
      })) ?? []),
      ...safeReviewIssuesFromPipelineIssues(firstPipeline.issues)
    ].slice(0, 20)
  };
  const repair = await executeStructuredWithAudit({
    audit_context: auditContext,
    provider,
    provider_label: providerLabel,
    model_config: modelConfig,
    request_timeout_ms: runtime.request_timeout_ms,
    live_call_allowed: providerLabel === "openai",
    agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
    agent_version: FORMATIVE_ACTIVITY_AGENT_VERSION,
    prompt_hash: FORMATIVE_ACTIVITY_REPAIR_PROMPT_HASH,
    prompt_version: FORMATIVE_ACTIVITY_REPAIR_PROMPT_VERSION,
    instructions: FORMATIVE_ACTIVITY_REPAIR_PROMPT_INSTRUCTIONS,
    request_input: repairInput,
    output_schema: FormativeActivityPacketV1Schema,
    schema_version: FORMATIVE_ACTIVITY_SCHEMA_VERSION,
    schema_name: FORMATIVE_ACTIVITY_SCHEMA_VERSION,
    invocation_prefix: "formative_activity_repair",
    metadata: {
      purpose: "chat_native_formative_activity_repair",
      agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
      prompt_version: FORMATIVE_ACTIVITY_REPAIR_PROMPT_VERSION,
      schema_version: FORMATIVE_ACTIVITY_SCHEMA_VERSION
    }
  });

  if (repair.providerResult.status !== "completed") {
    return {
      status: "failed",
      blocked_reason: "formative_activity_repair_provider_failed",
      validation_issues: [{
        field_path: "repair_provider",
        rule_code: "missing_audit_metadata",
        blocked_pattern_label: safeProviderFailureReason(repair.providerResult)
      }],
      generator_agent_call_id: generator.agent_call_id,
      reviewer_agent_call_id: reviewer.agent_call_id,
      repair_agent_call_id: repair.agent_call_id,
      repair_attempted: true,
      generator_call_status: generatorHadValidationFailure ? "invalid_output" : "succeeded",
      reviewer_call_status: "succeeded",
      repair_status: "failed"
    };
  }

  const repairedPipeline = evaluateFormativeActivityLivePipeline({
    candidate_packet: generator.providerResult.parsed_output,
    generator_audit: providerAuditFromResult({
      agent_call_id: generator.agent_call_id,
      model_name: modelConfig.model_name,
      providerResult: generator.providerResult
    }),
    reviewer_output: reviewer.providerResult.parsed_output,
    reviewer_audit: providerAuditFromResult({
      agent_call_id: reviewer.agent_call_id,
      model_name: modelConfig.model_name,
      providerResult: reviewer.providerResult
    }),
    repair_packet: repair.providerResult.parsed_output,
    repair_audit: providerAuditFromResult({
      agent_call_id: repair.agent_call_id,
      model_name: modelConfig.model_name,
      providerResult: repair.providerResult
    })
  });

  if (repairedPipeline.status === "accepted") {
    return {
      status: "succeeded",
      packet: repairedPipeline.packet,
      quality_review: repairedPipeline.quality_review,
      generator_agent_call_id: generator.agent_call_id,
      reviewer_agent_call_id: reviewer.agent_call_id,
      repair_agent_call_id: repair.agent_call_id,
      repair_attempted: true,
      generator_call_status: generatorHadValidationFailure ? "invalid_output" : "succeeded",
      reviewer_call_status: "succeeded",
      repair_status: "succeeded"
    };
  }

  await prisma.agentCall.update({
    where: { id: repair.agent_call_id },
    data: {
      output_validated: false,
      validation_error: validationErrorPayload({
        category: "formative_activity_pipeline_validation",
        issues: repairedPipeline.issues
      }),
      call_status: "invalid_output",
      error_category: "formative_activity_pipeline_validation"
    }
  });

  return {
    status: "invalid_output",
    blocked_reason: repairedPipeline.blocked_reason,
    validation_issues: repairedPipeline.issues,
    generator_agent_call_id: generator.agent_call_id,
    reviewer_agent_call_id: reviewer.agent_call_id,
    repair_agent_call_id: repair.agent_call_id,
    repair_attempted: true,
    generator_call_status: generatorHadValidationFailure ? "invalid_output" : "succeeded",
    reviewer_call_status: "succeeded",
    repair_status: "invalid_output"
  };
}

export function makeLiveActivityPacketForTest(packet: FormativeActivityPacketV1) {
  return FormativeActivityPacketV1Schema.parse({
    ...packet,
    generation_source: "live_llm",
    runtime_servable_to_student: true,
    review_only: false,
    generated_at: nowIso()
  });
}

export function makePassingActivityQualityReviewForTest(
  overrides: Partial<FormativeActivityQualityReviewV1> = {}
) {
  return FormativeActivityQualityReviewV1Schema.parse({
    ...passedQualityReview(),
    ...overrides
  });
}

export function makeFormativeActivityAuditForTest(
  overrides: Partial<FormativeActivityProviderAudit> = {}
): FormativeActivityProviderAudit {
  return {
    agent_call_id: `agent_call_${randomUUID()}`,
    provider: "mock",
    model_name: "mock-formative-activity-dialogue",
    client_request_id: `client_${randomUUID()}`,
    provider_request_id: `mock_req_${randomUUID()}`,
    provider_response_id: `mock_resp_${randomUUID()}`,
    call_status: "succeeded",
    output_validated: true,
    input_tokens: 10,
    output_tokens: 20,
    total_tokens: 30,
    ...overrides
  };
}

export const FORMATIVE_ACTIVITY_LIVE_SMOKE_FAMILIES = FormativeActivityFamilySchema.options;
