import { createHash } from "node:crypto";
import { z } from "zod";
import {
  buildValidatedStudentCommunication,
  STUDENT_COMMUNICATION_FACT_LOCK_VALIDATOR_VERSION,
  STUDENT_COMMUNICATION_FALLBACK_VERSION,
  STUDENT_COMMUNICATION_INPUT_SCHEMA_VERSION,
  STUDENT_COMMUNICATION_LANGUAGE_VALIDATOR_VERSION,
  STUDENT_COMMUNICATION_OUTPUT_SCHEMA_VERSION,
  STUDENT_COMMUNICATION_PROMPT_VERSION,
  STUDENT_COMMUNICATION_RENDERED_VERSION,
  type StudentCommunicationBundleV1,
  type StudentCommunicationInputV1,
  type StudentCommunicationValidationResult
} from "@/lib/services/student-assessment/student-communication-agent";

export const EVIDENCE_INTEGRATED_PROFILE_SCHEMA_VERSION =
  "evidence-integrated-profile-v2" as const;
export const ITEM_EVIDENCE_SCHEMA_VERSION = "item-evidence-v2" as const;
export const PACKAGE_FEEDBACK_SCHEMA_VERSION = "package-feedback-v2" as const;
export const NEXT_INTERACTION_SCHEMA_VERSION = "next-interaction-v2" as const;
export const FORMATIVE_ROUTING_POLICY_VERSION = "distractor-first-routing-v2" as const;
export const ACTIVITY_TAXONOMY_VERSION = "distractor-activity-taxonomy-v2" as const;
export const PROFILE_COHERENCE_VALIDATOR_VERSION =
  "evidence-profile-coherence-validator-v2" as const;
export const FEEDBACK_SPECIFICITY_VALIDATOR_VERSION =
  "package-feedback-specificity-validator-v2" as const;
export const SINGLE_ACTION_VALIDATOR_VERSION = "single-action-state-validator-v2" as const;
export const ROUTING_COHERENCE_VALIDATOR_VERSION =
  "activity-routing-coherence-validator-v2" as const;
export const ANSWER_REVEAL_POLICY_VERSION = "answer-reveal-policy-v1" as const;
export const ANSWER_EXPLANATION_VERSION = "initial-package-answer-explanation-v1" as const;
export const CHAT_NATIVE_STATE_MACHINE_VERSION = "chat-native-state-machine-v2" as const;

export const AnswerRevealPolicySchema = z.enum([
  "after_package",
  "after_formative_activity",
  "after_session",
  "never"
]);
export type AnswerRevealPolicy = z.infer<typeof AnswerRevealPolicySchema>;

export const CorrectnessStatusRevealPolicySchema = z.enum([
  "after_package",
  "after_formative_activity",
  "after_session",
  "never"
]);
export type CorrectnessStatusRevealPolicy = z.infer<
  typeof CorrectnessStatusRevealPolicySchema
>;

export const AssessmentSpecificUnderstandingSchema = z.enum([
  "strong_well_supported_understanding",
  "sound_understanding",
  "partial_understanding",
  "specific_misconception",
  "foundational_knowledge_gap",
  "indeterminate_due_to_insufficient_evidence"
]);
export type AssessmentSpecificUnderstanding = z.infer<
  typeof AssessmentSpecificUnderstandingSchema
>;

export const ReasoningQualitySchema = z.enum([
  "well_supported_and_precise",
  "accurate_but_concise",
  "partially_supported",
  "internally_inconsistent",
  "misconception_based",
  "irrelevant_or_construct_irrelevant",
  "insufficient_reasoning_evidence"
]);
export type ReasoningQuality = z.infer<typeof ReasoningQualitySchema>;

export const ConfidenceCalibrationSchema = z.enum([
  "reasonably_calibrated",
  "underconfident",
  "overconfident",
  "mixed_calibration",
  "insufficient_confidence_evidence"
]);
export type ConfidenceCalibration = z.infer<typeof ConfidenceCalibrationSchema>;

export const EvidenceLimitationSchema = z.enum([
  "limited_elaboration",
  "missing_reasoning",
  "missing_confidence",
  "no_tempting_option_reported",
  "contradictory_responses",
  "incomplete_item_package",
  "low_information_response",
  "possible_rapid_response",
  "prerequisite_language_barrier_possible",
  "prerequisite_quantitative_skill_barrier_possible",
  "construct_identification_unclear",
  "instrumentation_incomplete",
  "transfer_not_yet_observed"
]);
export type EvidenceLimitation = z.infer<typeof EvidenceLimitationSchema>;

export const EvidenceSufficiencyV2Schema = z.enum([
  "insufficient",
  "limited",
  "adequate",
  "strong"
]);
export type EvidenceSufficiencyV2 = z.infer<typeof EvidenceSufficiencyV2Schema>;

export const NextInteractionTypeSchema = z.enum([
  "no_action_move_on",
  "diagnostic_clarification",
  "distractor_focused_activity",
  "scaffolded_distractor_activity",
  "foundational_support_activity",
  "prerequisite_support_activity",
  "enrichment_activity",
  "revision_request",
  "transfer_item"
]);
export type NextInteractionType = z.infer<typeof NextInteractionTypeSchema>;

export const DistractorActivityTypeSchema = z.enum([
  "identify_who_and_why",
  "diagnose_misconception",
  "analyze_reasoning_pattern",
  "distractor_temptation_analysis",
  "peer_prediction",
  "evaluate_and_explain_incorrectness",
  "identify_specific_flaw",
  "correct_incorrect_parts",
  "rank_distractors",
  "generate_distractors",
  "reverse_engineer_stem",
  "transform_distractors",
  "definition_building",
  "diagnostic_clarification"
]);
export type DistractorActivityType = z.infer<typeof DistractorActivityTypeSchema>;

export const CognitiveLevelSchema = z.enum(["applying", "evaluating", "creating", "foundational"]);
export type CognitiveLevel = z.infer<typeof CognitiveLevelSchema>;

const CorrectnessResultSchema = z.enum([
  "correct",
  "incorrect",
  "unanswered",
  "not_scored",
  "unknown"
]);

const ItemOutcomeSchema = z.object({
  item_public_id: z.string().min(1),
  item_position: z.number().int().positive().nullable(),
  selected_option: z.string().nullable(),
  result: CorrectnessResultSchema,
  response_available: z.boolean(),
  reasoning_available: z.boolean(),
  confidence: z.enum(["low", "medium", "high"]).nullable(),
  tempting_option_available: z.boolean(),
  answer_key_revealed: z.boolean(),
  correct_option: z.string().nullable(),
  student_answer: z.string().nullable(),
  answer_explanation_revealed: z.boolean(),
  answer_explanation: z.string().nullable(),
  distractor_boundary: z.string().nullable(),
  revealed_at: z.string().nullable(),
  reveal_trigger: z.string().nullable(),
  explanation_version: z.string().nullable(),
  student_display_acknowledged_at: z.string().nullable()
}).strict();

export const OutcomeSummaryV2Schema = z.object({
  items_administered: z.number().int().nonnegative(),
  items_answered: z.number().int().nonnegative(),
  items_correct: z.number().int().nonnegative(),
  proportion_correct: z.number().min(0).max(1),
  item_results: z.array(ItemOutcomeSchema),
  incomplete_items: z.array(z.string()),
  restricted_answer_reveal_state: z.object({
    answer_reveal_policy: AnswerRevealPolicySchema,
    correctness_status_reveal_policy: CorrectnessStatusRevealPolicySchema,
    answer_reveal_policy_version: z.literal(ANSWER_REVEAL_POLICY_VERSION),
    full_answer_key_revealed: z.boolean()
  }).strict()
}).strict();
export type OutcomeSummaryV2 = z.infer<typeof OutcomeSummaryV2Schema>;

export const EvidenceReferenceSchema = z.object({
  item_public_id: z.string().min(1),
  item_position: z.number().int().positive().nullable(),
  evidence_types: z.array(z.string().min(1)).min(1),
  summary: z.string().min(1)
}).strict();
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const ItemEvidenceV2Schema = z.object({
  item_evidence_schema_version: z.literal(ITEM_EVIDENCE_SCHEMA_VERSION),
  item_public_id: z.string().min(1),
  item_position: z.number().int().positive().nullable(),
  selected_option: z.string().nullable(),
  correctness: CorrectnessResultSchema,
  reasoning_excerpt: z.string().nullable(),
  reasoning_interpretation: z.string().min(1),
  reasoning_quality: ReasoningQualitySchema,
  confidence: z.enum(["low", "medium", "high"]).nullable(),
  tempting_option: z.string().nullable(),
  tempting_option_reason: z.string().nullable(),
  evidence_for_understanding: z.array(z.string()).min(1),
  evidence_against_understanding: z.array(z.string()),
  possible_misconception: z.object({
    present: z.boolean(),
    proposition: z.string().nullable(),
    evidence_refs: z.array(z.string())
  }).strict(),
  alternative_explanations: z.array(z.string()),
  evidence_limitations: z.array(EvidenceLimitationSchema),
  evidence_sufficiency: EvidenceSufficiencyV2Schema,
  source_response_public_id: z.string().nullable(),
  administered_snapshot_version: z.number().int().nullable()
}).strict();
export type ItemEvidenceV2 = z.infer<typeof ItemEvidenceV2Schema>;

export const EvidenceIntegratedProfileV2Schema = z.object({
  profile_schema_version: z.literal(EVIDENCE_INTEGRATED_PROFILE_SCHEMA_VERSION),
  session_public_id: z.string().min(1),
  assessment_public_id: z.string().min(1),
  assessment_snapshot_version: z.string().min(1),
  response_package_version: z.string().min(1),
  generated_at: z.string().datetime(),
  outcome_summary: OutcomeSummaryV2Schema,
  assessment_specific_understanding: z.object({
    value: AssessmentSpecificUnderstandingSchema,
    student_label: z.string().min(1),
    explanation: z.string().min(1),
    evidence_refs: z.array(EvidenceReferenceSchema).min(1),
    not_a_stable_ability_estimate: z.literal(true)
  }).strict(),
  reasoning_quality: z.object({
    value: ReasoningQualitySchema,
    student_label: z.string().min(1),
    explanation: z.string().min(1),
    evidence_refs: z.array(EvidenceReferenceSchema).min(1)
  }).strict(),
  confidence_calibration: z.object({
    value: ConfidenceCalibrationSchema,
    student_label: z.string().min(1),
    explanation: z.string().min(1),
    evidence_refs: z.array(EvidenceReferenceSchema).min(1)
  }).strict(),
  evidence_limitations: z.array(z.object({
    code: EvidenceLimitationSchema,
    description: z.string().min(1),
    evidence_refs: z.array(EvidenceReferenceSchema)
  }).strict()),
  growth_target: z.object({
    target: z.string().min(1),
    evidence_refs: z.array(EvidenceReferenceSchema).min(1),
    compatible_activity_types: z.array(DistractorActivityTypeSchema).min(1)
  }).strict(),
  item_evidence: z.array(ItemEvidenceV2Schema),
  cross_item_patterns: z.array(z.string()),
  alternative_explanations: z.array(z.string()),
  evidence_sufficiency: EvidenceSufficiencyV2Schema,
  profile_uncertainty: z.string().min(1),
  student_safe_summary: z.object({
    initial_results: z.string().min(1),
    understanding_label: z.string().min(1),
    reasoning_label: z.string().min(1),
    confidence_label: z.string().min(1),
    evidence_limitation_label: z.string().nullable(),
    next_focus: z.string().min(1),
    boundary_statement: z.string().min(1)
  }).strict(),
  source_agent_call_public_id: z.string().nullable(),
  validation_status: z.enum(["validated", "repaired", "blocked"])
}).strict();
export type EvidenceIntegratedProfileV2 = z.infer<typeof EvidenceIntegratedProfileV2Schema>;

export const PackageFeedbackV2Schema = z.object({
  feedback_schema_version: z.literal(PACKAGE_FEEDBACK_SCHEMA_VERSION),
  result_summary: z.string().min(1),
  strengths: z.array(z.string().min(1)).min(1),
  growth_target: z.string().min(1),
  evidence_references: z.array(EvidenceReferenceSchema).min(1),
  cross_item_pattern: z.string().min(1),
  confidence_comment: z.string().min(1),
  evidence_limitation: z.string().nullable(),
  answer_reveal_state: OutcomeSummaryV2Schema.shape.restricted_answer_reveal_state,
  next_interaction_reference: z.string().min(1)
}).strict();
export type PackageFeedbackV2 = z.infer<typeof PackageFeedbackV2Schema>;

export const NextInteractionV2Schema = z.object({
  next_interaction_schema_version: z.literal(NEXT_INTERACTION_SCHEMA_VERSION),
  interaction_type: NextInteractionTypeSchema,
  prompt: z.string().min(1),
  purpose: z.string().min(1),
  expected_response_format: z.string().min(1),
  response_constraints: z.array(z.string().min(1)),
  evaluation_criteria: z.array(z.string().min(1)).min(1),
  linked_growth_target: z.string().min(1),
  linked_evidence_refs: z.array(EvidenceReferenceSchema).min(1),
  activity_family: z.string().min(1),
  activity_type: DistractorActivityTypeSchema,
  cognitive_level: CognitiveLevelSchema,
  distractor_refs: z.array(z.object({
    item_public_id: z.string().min(1),
    option_label: z.string().min(1),
    role: z.enum(["selected", "tempting", "unselected_peer_pattern", "generated"])
  }).strict()),
  next_runtime_state: z.enum([
    "AWAIT_DIAGNOSTIC_CLARIFICATION_RESPONSE",
    "AWAIT_FORMATIVE_ACTIVITY_RESPONSE",
    "AWAIT_FOUNDATIONAL_ACTIVITY_RESPONSE",
    "AWAIT_REVISION_RESPONSE",
    "AWAIT_TRANSFER_RESPONSE",
    "SESSION_COMPLETE_OR_MOVE_ON"
  ]),
  answer_reveal_constraints: z.object({
    may_reveal_correct_option: z.boolean(),
    may_reveal_explanation: z.boolean(),
    policy_version: z.literal(ANSWER_REVEAL_POLICY_VERSION)
  }).strict(),
  routing_policy_version: z.literal(FORMATIVE_ROUTING_POLICY_VERSION),
  activity_taxonomy_version: z.literal(ACTIVITY_TAXONOMY_VERSION),
  routing_justification: z.string().min(1),
  fallback_or_repair_status: z.enum(["not_needed", "deterministic_fallback_used", "repaired"])
}).strict();
export type NextInteractionV2 = z.infer<typeof NextInteractionV2Schema>;

export type EvidenceIntegrationBundleV2 = {
  profile: EvidenceIntegratedProfileV2;
  feedback: PackageFeedbackV2;
  next_interaction: NextInteractionV2;
  validators: {
    profile_coherence: ValidationResult;
    feedback_specificity: ValidationResult;
    single_action_state: ValidationResult;
    activity_routing_coherence: ValidationResult;
    student_communication_fact_lock: ValidationResult;
    student_communication_language: ValidationResult;
  };
  student_communication: StudentCommunicationBundleV1;
  artifact_versions: {
    profile_schema_version: typeof EVIDENCE_INTEGRATED_PROFILE_SCHEMA_VERSION;
    item_evidence_schema_version: typeof ITEM_EVIDENCE_SCHEMA_VERSION;
    feedback_schema_version: typeof PACKAGE_FEEDBACK_SCHEMA_VERSION;
    next_interaction_schema_version: typeof NEXT_INTERACTION_SCHEMA_VERSION;
    routing_policy_version: typeof FORMATIVE_ROUTING_POLICY_VERSION;
    activity_taxonomy_version: typeof ACTIVITY_TAXONOMY_VERSION;
    state_machine_version: typeof CHAT_NATIVE_STATE_MACHINE_VERSION;
    coherence_validator_version: typeof PROFILE_COHERENCE_VALIDATOR_VERSION;
    routing_coherence_validator_version: typeof ROUTING_COHERENCE_VALIDATOR_VERSION;
    answer_reveal_policy_version: typeof ANSWER_REVEAL_POLICY_VERSION;
    student_communication_prompt_version: typeof STUDENT_COMMUNICATION_PROMPT_VERSION;
    student_communication_input_schema_version: typeof STUDENT_COMMUNICATION_INPUT_SCHEMA_VERSION;
    student_communication_output_schema_version: typeof STUDENT_COMMUNICATION_OUTPUT_SCHEMA_VERSION;
    student_communication_fact_lock_validator_version: typeof STUDENT_COMMUNICATION_FACT_LOCK_VALIDATOR_VERSION;
    student_communication_language_validator_version: typeof STUDENT_COMMUNICATION_LANGUAGE_VALIDATOR_VERSION;
    student_communication_fallback_version: typeof STUDENT_COMMUNICATION_FALLBACK_VERSION;
    student_communication_rendered_version: typeof STUDENT_COMMUNICATION_RENDERED_VERSION;
  };
  effective_evidence_package_hash: string;
};

export type ValidationResult = {
  valid: boolean;
  validator_version: string;
  issues: Array<{
    rule_code: string;
    field_path: string;
    message: string;
  }>;
};

type ResponsePackageItem = Record<string, unknown>;
type PackagePayload = Record<string, unknown>;

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function policyValue<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown
): z.infer<T> | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashEvidenceIntegrationValue(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function shortExcerpt(text: string | null, max = 190) {
  if (!text) {
    return null;
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3).trim()}...` : normalized;
}

function optionText(options: unknown, label: string | null): string | null {
  if (!label || !Array.isArray(options)) {
    return null;
  }

  for (const option of options) {
    const record = recordValue(option);
    if (stringValue(record.label)?.toUpperCase() === label.toUpperCase()) {
      return stringValue(record.text);
    }
  }

  return null;
}

function firstIncorrectOption(input: {
  options: unknown;
  selected_option: string | null;
  correct_option: string | null;
}) {
  if (!Array.isArray(input.options)) {
    return null;
  }

  for (const option of input.options) {
    const label = stringValue(recordValue(option).label);
    if (!label) {
      continue;
    }
    if (label === input.correct_option || label === input.selected_option) {
      continue;
    }
    return {
      label,
      text: optionText(input.options, label)
    };
  }

  return null;
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.replace(/\s+/g, " ").trim())
    .filter((entry) => entry.length > 0 && !/^correct answer\.?$/i.test(entry));
}

function studentSafeAnswerExplanationFromResponse(response: ResponsePackageItem | undefined) {
  if (!response) {
    return null;
  }

  const explicit = stringValue(response.student_safe_answer_explanation);
  if (explicit) {
    return explicit;
  }

  const itemSnapshot = recordValue(response.item_snapshot);
  const correctOption = stringValue(response.correct_option_snapshot);
  const expectedPatterns = stringArrayValue(response.expected_reasoning_patterns).slice(0, 2);
  if (expectedPatterns.length > 0) {
    return expectedPatterns.join(" ");
  }

  const correctOptionText = optionText(itemSnapshot.options, correctOption);
  if (correctOption && correctOptionText) {
    return `Option ${correctOption} fits the item because it states the relevant measurement relationship: ${correctOptionText}`;
  }

  return null;
}

function itemResponses(payload: PackagePayload): ResponsePackageItem[] {
  return Array.isArray(payload.item_responses)
    ? payload.item_responses.filter(
        (entry): entry is ResponsePackageItem => Boolean(entry && typeof entry === "object" && !Array.isArray(entry))
      )
    : [];
}

function includedItemsById(payload: PackagePayload) {
  const map = new Map<string, ResponsePackageItem>();
  if (!Array.isArray(payload.included_items)) {
    return map;
  }

  for (const item of payload.included_items) {
    const record = recordValue(item);
    const publicId = stringValue(record.item_public_id);
    if (publicId) {
      map.set(publicId, record);
    }
  }

  return map;
}

function correctnessValue(value: unknown): z.infer<typeof CorrectnessResultSchema> {
  if (value === "correct" || value === "incorrect" || value === "unanswered" || value === "not_scored") {
    return value;
  }
  return "unknown";
}

function studentLabelForUnderstanding(value: AssessmentSpecificUnderstanding) {
  switch (value) {
    case "strong_well_supported_understanding":
      return "Strong and well-supported";
    case "sound_understanding":
      return "Sound understanding";
    case "partial_understanding":
      return "Partial understanding";
    case "specific_misconception":
      return "A specific idea needs correction";
    case "foundational_knowledge_gap":
      return "Foundational knowledge needs support";
    case "indeterminate_due_to_insufficient_evidence":
      return "Not enough evidence yet";
  }
}

function studentLabelForReasoning(value: ReasoningQuality) {
  switch (value) {
    case "well_supported_and_precise":
      return "Well supported and precise";
    case "accurate_but_concise":
      return "Accurate but somewhat concise";
    case "partially_supported":
      return "Partially supported";
    case "internally_inconsistent":
      return "Some parts are inconsistent";
    case "misconception_based":
      return "Based on an idea that needs correction";
    case "irrelevant_or_construct_irrelevant":
      return "Not focused on the assessed idea";
    case "insufficient_reasoning_evidence":
      return "Not enough reasoning evidence yet";
  }
}

function studentLabelForConfidence(value: ConfidenceCalibration) {
  switch (value) {
    case "reasonably_calibrated":
      return "Your confidence mostly matched your answers.";
    case "underconfident":
      return "You were more cautious than your strongest explanations suggested.";
    case "overconfident":
      return "You sounded more certain than the evidence in your explanation supported.";
    case "mixed_calibration":
      return "Your confidence pattern was mixed across the three questions.";
    case "insufficient_confidence_evidence":
      return "There is not enough confidence information to identify a clear pattern yet.";
  }
}

function allTextForTopic(payload: PackagePayload, items: ResponsePackageItem[]) {
  const assessment = recordValue(payload.assessment);
  const conceptUnit = recordValue(payload.concept_unit);
  return [
    stringValue(assessment.title),
    stringValue(assessment.diagnostic_focus),
    stringValue(conceptUnit.title),
    stringValue(conceptUnit.learning_objective),
    stringValue(conceptUnit.related_concept_description),
    ...items.flatMap((item) => [
      stringValue(item.item_stem),
      stringValue(item.reasoning_text),
      stringValue(item.reasoning_text_final)
    ])
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join(" ");
}

function growthTargetFor(payload: PackagePayload, items: ResponsePackageItem[]) {
  const topicText = allTextForTopic(payload, items);
  if (/\breliab/i.test(topicText) && /\bvalid/i.test(topicText)) {
    return "Explain more precisely why reliability may be necessary for a defensible score interpretation but does not itself constitute validity evidence.";
  }

  const conceptUnit = recordValue(payload.concept_unit);
  const objective =
    stringValue(conceptUnit.learning_objective) ??
    stringValue(conceptUnit.title) ??
    "the target concept";
  return `Explain the specific boundary that makes one option plausible but not supported for ${objective}.`;
}

function evidenceReferenceFor(item: ItemEvidenceV2, summary: string): EvidenceReference {
  return {
    item_public_id: item.item_public_id,
    item_position: item.item_position,
    evidence_types: [
      "answer choice",
      "scored result",
      item.reasoning_excerpt ? "written explanation" : "written explanation unavailable",
      item.confidence ? "confidence rating" : "confidence rating unavailable",
      item.tempting_option ? "tempting option evidence" : "tempting option not reported"
    ],
    summary
  };
}

function analyzeReasoning(input: {
  reasoning: string | null;
  result: z.infer<typeof CorrectnessResultSchema>;
}): {
  quality: ReasoningQuality;
  interpretation: string;
  limitations: EvidenceLimitation[];
  sufficiency: EvidenceSufficiencyV2;
} {
  const reasoning = input.reasoning?.trim() ?? "";
  if (!reasoning) {
    return {
      quality: "insufficient_reasoning_evidence",
      interpretation: "No reasoning text was available for this item.",
      limitations: ["missing_reasoning"],
      sufficiency: "limited"
    };
  }

  const wordCount = reasoning.split(/\s+/).filter(Boolean).length;
  const uncertainty = /\b(i don'?t know|not sure|guess|maybe|idk)\b/i.test(reasoning);
  const offConstruct = /\b(lunch|weather|game|movie|phone)\b/i.test(reasoning) && wordCount < 18;
  const contradictoryReliabilityValidity =
    /\b(reliability\s+(is|equals|means)\s+validity|validity\s+(is|equals|means)\s+reliability|reliability\s+alone\s+proves\s+validity|reliability\s+proves\s+validity|same\s+thing)\b/i.test(reasoning);

  if (offConstruct) {
    return {
      quality: "irrelevant_or_construct_irrelevant",
      interpretation: "The reasoning did not clearly address the assessed idea.",
      limitations: ["low_information_response", "construct_identification_unclear"],
      sufficiency: "limited"
    };
  }

  if (uncertainty && wordCount < 12) {
    return {
      quality: "insufficient_reasoning_evidence",
      interpretation: "The reasoning mainly signaled uncertainty rather than a conceptual explanation.",
      limitations: ["low_information_response"],
      sufficiency: "limited"
    };
  }

  if (contradictoryReliabilityValidity) {
    return {
      quality: "internally_inconsistent",
      interpretation:
        "The selected answer may be correct, but the explanation collapses reliability and validity in a way that conflicts with the assessed boundary.",
      limitations: ["contradictory_responses"],
      sufficiency: "adequate"
    };
  }

  if (input.result === "incorrect" && wordCount >= 8) {
    return {
      quality: "misconception_based",
      interpretation: "The selected answer and explanation may reflect a specific incorrect proposition, but it remains provisional until reviewed with the item context.",
      limitations: [],
      sufficiency: "adequate"
    };
  }

  if (wordCount < 22) {
    return {
      quality: "accurate_but_concise",
      interpretation: "The reasoning is relevant and usable but leaves the conceptual boundary somewhat compressed.",
      limitations: ["limited_elaboration"],
      sufficiency: "adequate"
    };
  }

  return {
    quality: "well_supported_and_precise",
    interpretation: "The reasoning provides usable conceptual support for the selected answer.",
    limitations: [],
    sufficiency: "strong"
  };
}

function confidenceCalibrationFor(input: {
  itemsCorrect: number;
  itemsAnswered: number;
  confidenceValues: Array<"low" | "medium" | "high">;
  reasoningQuality: ReasoningQuality;
}): ConfidenceCalibration {
  if (input.confidenceValues.length === 0) {
    return "insufficient_confidence_evidence";
  }

  const correctRate = input.itemsAnswered > 0 ? input.itemsCorrect / input.itemsAnswered : 0;
  const highCount = input.confidenceValues.filter((value) => value === "high").length;
  const lowCount = input.confidenceValues.filter((value) => value === "low").length;

  if (correctRate >= 0.75 && input.reasoningQuality !== "insufficient_reasoning_evidence") {
    return lowCount > highCount ? "underconfident" : "reasonably_calibrated";
  }

  if (correctRate <= 0.34 && highCount > 0) {
    return "overconfident";
  }

  return "mixed_calibration";
}

function aggregateReasoningQuality(items: ItemEvidenceV2[]): ReasoningQuality {
  if (items.some((item) => item.reasoning_quality === "misconception_based")) {
    return "misconception_based";
  }
  if (items.some((item) => item.reasoning_quality === "internally_inconsistent")) {
    return "internally_inconsistent";
  }
  if (items.every((item) => item.reasoning_quality === "well_supported_and_precise")) {
    return "well_supported_and_precise";
  }
  if (
    items.some((item) => item.reasoning_quality === "accurate_but_concise") &&
    items.every((item) =>
      [
        "accurate_but_concise",
        "well_supported_and_precise"
      ].includes(item.reasoning_quality)
    )
  ) {
    return "accurate_but_concise";
  }
  if (items.every((item) => item.reasoning_quality === "insufficient_reasoning_evidence")) {
    return "insufficient_reasoning_evidence";
  }
  return "partially_supported";
}

function understandingFor(input: {
  itemsCorrect: number;
  itemsAnswered: number;
  reasoningQuality: ReasoningQuality;
  evidenceSufficiency: EvidenceSufficiencyV2;
}): AssessmentSpecificUnderstanding {
  const correctRate = input.itemsAnswered > 0 ? input.itemsCorrect / input.itemsAnswered : 0;
  if (correctRate === 0 && input.reasoningQuality === "insufficient_reasoning_evidence") {
    return "foundational_knowledge_gap";
  }
  if (input.itemsAnswered === 0 || input.evidenceSufficiency === "insufficient") {
    return "indeterminate_due_to_insufficient_evidence";
  }
  if (input.reasoningQuality === "misconception_based") {
    return "specific_misconception";
  }
  if (correctRate === 1 && input.reasoningQuality === "well_supported_and_precise") {
    return "strong_well_supported_understanding";
  }
  if (
    correctRate === 1 &&
    ["accurate_but_concise", "well_supported_and_precise"].includes(input.reasoningQuality) &&
    ["adequate", "strong"].includes(input.evidenceSufficiency)
  ) {
    return "sound_understanding";
  }
  if (correctRate >= 0.5) {
    return "partial_understanding";
  }
  return "foundational_knowledge_gap";
}

function evidenceSufficiencyFor(items: ItemEvidenceV2[]): EvidenceSufficiencyV2 {
  if (items.length === 0) {
    return "insufficient";
  }
  if (items.every((item) => item.evidence_sufficiency === "strong")) {
    return "strong";
  }
  if (items.every((item) => ["adequate", "strong"].includes(item.evidence_sufficiency))) {
    return "adequate";
  }
  if (items.some((item) => item.evidence_sufficiency === "adequate")) {
    return "limited";
  }
  return "insufficient";
}

function studentStatusForUnderstanding(value: AssessmentSpecificUnderstanding) {
  return value === "foundational_knowledge_gap"
    ? "Needs more work"
    : value === "indeterminate_due_to_insufficient_evidence"
      ? "Still developing"
      : "Mostly understood";
}

function studentFacingUnderstandingExplanation(input: {
  profile: EvidenceIntegratedProfileV2;
  initialResults: string;
}) {
  const understanding = input.profile.assessment_specific_understanding.value;
  if (understanding === "strong_well_supported_understanding") {
    return `Your first set shows ${input.initialResults}, with explanations that give clear support for the answers.`;
  }
  if (understanding === "sound_understanding") {
    return `Your first set shows ${input.initialResults}. The next step is to make the main boundary more precise.`;
  }
  if (understanding === "partial_understanding") {
    return `Your first set shows ${input.initialResults}. Some evidence is usable, and one part still needs a clearer boundary.`;
  }
  if (understanding === "specific_misconception") {
    return `Your first set shows ${input.initialResults}. One selected option points to an idea that needs a closer look.`;
  }
  if (understanding === "foundational_knowledge_gap") {
    return `Your first set shows ${input.initialResults}. The next step should rebuild the main idea before moving further.`;
  }
  return `Your first set shows ${input.initialResults}. There is not enough evidence yet for a stronger summary.`;
}

function itemStatusLabel(result: z.infer<typeof CorrectnessResultSchema>) {
  return result === "correct"
    ? "Correct"
    : result === "incorrect"
      ? "Incorrect"
      : result === "unanswered"
        ? "Unanswered"
        : "Not scored";
}

function responseForItem(payload: PackagePayload, itemPublicId: string | null | undefined) {
  if (!itemPublicId) {
    return null;
  }
  return itemResponses(payload).find((entry) => stringValue(entry.item_public_id) === itemPublicId) ?? null;
}

function optionsForItem(payload: PackagePayload, itemPublicId: string | null | undefined) {
  const response = responseForItem(payload, itemPublicId);
  const responseOptions = recordValue(response?.item_snapshot).options;
  if (Array.isArray(responseOptions)) {
    return responseOptions;
  }
  return includedItemsById(payload).get(itemPublicId ?? "")?.options;
}

function optionTextForItem(payload: PackagePayload, itemPublicId: string | null | undefined, label: string | null) {
  return optionText(optionsForItem(payload, itemPublicId), label);
}

function communicationActivitySource(input: {
  payload: PackagePayload;
  profile: EvidenceIntegratedProfileV2;
  nextInteraction: NextInteractionV2;
}) {
  const ref = input.nextInteraction.distractor_refs[0] ?? null;
  const sourceItem = ref
    ? input.profile.item_evidence.find((item) => item.item_public_id === ref.item_public_id)
    : input.profile.item_evidence[0] ?? null;
  const sourceOptionLabel = ref?.option_label ?? sourceItem?.selected_option ?? null;
  return {
    source_item_number: sourceItem?.item_position ?? null,
    source_option_label: sourceOptionLabel,
    source_option_text: optionTextForItem(input.payload, sourceItem?.item_public_id, sourceOptionLabel)
  };
}

function communicationLimitations(profile: EvidenceIntegratedProfileV2) {
  const limitations = [
    profile.student_safe_summary.evidence_limitation_label,
    profile.evidence_limitations.some((entry) => entry.code === "transfer_not_yet_observed")
      ? "This first package does not yet show transfer to a new item."
      : null
  ].filter((entry): entry is string => Boolean(entry));

  return limitations.length > 0
    ? limitations
    : ["This summary uses only the answers, explanations, confidence ratings, and tempting-option evidence from the first set."];
}

export function buildStudentCommunicationInputForEvidenceBundle(input: {
  profile: EvidenceIntegratedProfileV2;
  feedback: PackageFeedbackV2;
  next_interaction: NextInteractionV2;
  response_package_payload?: unknown;
  package_public_id?: string | null;
}): StudentCommunicationInputV1 {
  const payload = recordValue(input.response_package_payload);
  const packagePublicId =
    input.package_public_id ??
    stringValue(payload.response_package_public_id) ??
    stringValue(payload.package_public_id) ??
    `pkg_${hashEvidenceIntegrationValue({
      session_public_id: input.profile.session_public_id,
      generated_at: input.profile.generated_at,
      outcome_summary: input.profile.outcome_summary
    }).slice(0, 16)}`;
  const initialResults = `${input.profile.outcome_summary.items_correct} of ${input.profile.outcome_summary.items_administered} correct`;
  const activitySource = communicationActivitySource({
    payload,
    profile: input.profile,
    nextInteraction: input.next_interaction
  });

  return {
    communication_input_schema_version: STUDENT_COMMUNICATION_INPUT_SCHEMA_VERSION,
    session_public_id: input.profile.session_public_id,
    package_public_id: packagePublicId,
    communication_purpose: "initial_package_results",
    administered_item_summaries: input.profile.outcome_summary.item_results.map((item) => ({
      item_number: item.item_position ?? 1,
      item_public_id: item.item_public_id,
      status_label: itemStatusLabel(item.result),
      student_answer_label: item.student_answer ? `Option ${item.student_answer}` : "No answer recorded",
      correct_answer_label: item.answer_key_revealed && item.correct_option
        ? `Option ${item.correct_option}`
        : null,
      answer_explanation: item.answer_explanation,
      distractor_boundary: item.distractor_boundary
    })),
    validated_outcome_summary: {
      items_administered: input.profile.outcome_summary.items_administered,
      items_correct: input.profile.outcome_summary.items_correct,
      initial_results: initialResults
    },
    validated_understanding_summary: {
      status: studentStatusForUnderstanding(input.profile.assessment_specific_understanding.value),
      student_label: input.profile.student_safe_summary.understanding_label,
      safe_explanation: studentFacingUnderstandingExplanation({
        profile: input.profile,
        initialResults
      })
    },
    validated_reasoning_summary: {
      student_label: input.profile.student_safe_summary.reasoning_label,
      safe_explanation: input.profile.reasoning_quality.explanation
    },
    validated_confidence_summary: {
      student_label: input.profile.student_safe_summary.confidence_label,
      safe_explanation: input.profile.confidence_calibration.explanation
    },
    validated_evidence_limitations: communicationLimitations(input.profile),
    validated_growth_target: {
      student_facing_text: input.profile.growth_target.target,
      compatible_activity_types: input.profile.growth_target.compatible_activity_types
    },
    validated_item_explanations: input.profile.outcome_summary.item_results.map((item) => ({
      item_number: item.item_position ?? 1,
      why_correct:
        item.answer_explanation ??
        "A concise explanation was not available for this administered item.",
      distractor_boundary: item.distractor_boundary
    })),
    validated_activity_contract: {
      activity_family: input.next_interaction.activity_family,
      activity_type: input.next_interaction.activity_type,
      ...activitySource,
      expected_response_format: input.next_interaction.expected_response_format,
      next_runtime_state: input.next_interaction.next_runtime_state,
      prompt: input.next_interaction.prompt
    },
    answer_reveal_state: {
      full_answer_key_revealed:
        input.profile.outcome_summary.restricted_answer_reveal_state.full_answer_key_revealed,
      may_show_correct_options_for_administered_items:
        input.profile.outcome_summary.restricted_answer_reveal_state.full_answer_key_revealed
    },
    language: "en",
    reading_level_target: "undergraduate_plain_english",
    maximum_length_constraints: {
      initial_results_intro_max_chars: 260,
      summary_max_chars: 500,
      activity_prompt_max_chars: 900,
      completion_message_max_chars: 260
    },
    source_profile_version: input.profile.profile_schema_version,
    source_activity_version: input.next_interaction.next_interaction_schema_version
  };
}

function communicationValidationToResult(
  validation: StudentCommunicationValidationResult
): ValidationResult {
  return {
    valid: validation.valid,
    validator_version: validation.validator_version,
    issues: validation.issues.map((issue) => ({
      rule_code: issue.rule_code,
      field_path: issue.field_path,
      message: issue.blocked_pattern_label
        ? `${issue.rule_code}: ${issue.blocked_pattern_label}`
        : issue.rule_code
    }))
  };
}

export function buildEvidenceIntegratedProfileBundle(input: {
  response_package_payload: unknown;
  generated_at?: Date;
  source_agent_call_public_id?: string | null;
  answer_reveal_policy?: AnswerRevealPolicy;
  correctness_status_reveal_policy?: CorrectnessStatusRevealPolicy;
}): EvidenceIntegrationBundleV2 {
  const payload = recordValue(input.response_package_payload);
  const generatedAt = input.generated_at ?? new Date();
  const conceptRules = recordValue(recordValue(payload.concept_unit).administration_rules);
  const answerRevealPolicy =
    input.answer_reveal_policy ??
    policyValue(AnswerRevealPolicySchema, conceptRules.answer_reveal_policy) ??
    "after_package";
  const correctnessStatusRevealPolicy =
    input.correctness_status_reveal_policy ??
    policyValue(CorrectnessStatusRevealPolicySchema, conceptRules.correctness_status_reveal_policy) ??
    "after_package";
  const answersRevealed = answerRevealPolicy === "after_package";
  const responses = itemResponses(payload);
  const sessionRecord = recordValue(payload.assessment_session);
  const assessment = recordValue(payload.assessment);
  const sessionPublicId = stringValue(sessionRecord.session_public_id) ?? "unknown_session";
  const assessmentPublicId = stringValue(assessment.assessment_public_id) ?? "unknown_assessment";

  const itemEvidence = responses.map((response, index): ItemEvidenceV2 => {
    const itemPublicId = stringValue(response.item_public_id) ?? `item_${index + 1}`;
    const selectedOption = stringValue(response.selected_option);
    const result = correctnessValue(response.correctness);
    const reasoning = stringValue(response.reasoning_text_final) ?? stringValue(response.reasoning_text);
    const analysis = analyzeReasoning({ reasoning, result });
    const confidence = stringValue(response.confidence_rating);
    const temptingOption = stringValue(response.tempting_option);
    const noTemptingOption = booleanValue(response.no_tempting_option) === true;
    const limitationSet = new Set<EvidenceLimitation>(analysis.limitations);
    if (!confidence) {
      limitationSet.add("missing_confidence");
    }
    if (noTemptingOption) {
      limitationSet.add("no_tempting_option_reported");
    }

    const evidenceFor = [
      result === "correct"
        ? "The selected answer was scored correct for this administered item."
        : result === "incorrect"
          ? "The selected answer was scored incorrect for this administered item."
          : "A selected answer outcome is available but not strongly interpretable.",
      reasoning
        ? "A written reason was provided and can be interpreted with the item context."
        : "No written reason was available for interpretation.",
      confidence
        ? `The student reported ${confidence} confidence.`
        : "No confidence rating was available."
    ];

    const evidenceAgainst =
      result === "incorrect"
        ? ["The selected option did not match the scored item key."]
        : analysis.quality === "accurate_but_concise"
          ? ["The explanation is concise, so precision should be checked in the next interaction."]
          : [];

    return {
      item_evidence_schema_version: ITEM_EVIDENCE_SCHEMA_VERSION,
      item_public_id: itemPublicId,
      item_position: numberValue(response.initial_item_position) ?? index + 1,
      selected_option: selectedOption,
      correctness: result,
      reasoning_excerpt: shortExcerpt(reasoning),
      reasoning_interpretation: analysis.interpretation,
      reasoning_quality: analysis.quality,
      confidence:
        confidence === "low" || confidence === "medium" || confidence === "high"
          ? confidence
          : null,
      tempting_option: temptingOption,
      tempting_option_reason: stringValue(response.tempting_option_reason),
      evidence_for_understanding: evidenceFor,
      evidence_against_understanding: evidenceAgainst,
      possible_misconception: {
        present: result === "incorrect" && analysis.quality === "misconception_based",
        proposition:
          result === "incorrect" && analysis.quality === "misconception_based"
            ? "The selected distractor may reflect an incorrect proposition that should be reviewed with the item context."
            : null,
        evidence_refs: result === "incorrect" ? [itemPublicId] : []
      },
      alternative_explanations: [
        "Concise wording can reflect brevity rather than misunderstanding.",
        "No tempting-option report is neutral unless the response was required and missing."
      ],
      evidence_limitations: [...limitationSet],
      evidence_sufficiency: analysis.sufficiency,
      source_response_public_id: stringValue(response.item_response_public_id) ?? null,
      administered_snapshot_version: numberValue(response.item_version_snapshot)
    };
  });

  const itemsAnswered = itemEvidence.filter((item) => item.selected_option).length;
  const itemsCorrect = itemEvidence.filter((item) => item.correctness === "correct").length;
  const reasoningQuality = aggregateReasoningQuality(itemEvidence);
  const evidenceSufficiency = evidenceSufficiencyFor(itemEvidence);
  const understanding = understandingFor({
    itemsCorrect,
    itemsAnswered,
    reasoningQuality,
    evidenceSufficiency
  });
  const confidenceCalibration = confidenceCalibrationFor({
    itemsCorrect,
    itemsAnswered,
    confidenceValues: itemEvidence
      .map((item) => item.confidence)
      .filter((value): value is "low" | "medium" | "high" => Boolean(value)),
    reasoningQuality
  });
  const growthTarget = growthTargetFor(payload, responses);
  const evidenceRefs = itemEvidence.map((item) =>
    evidenceReferenceFor(
      item,
      `Item ${item.item_position ?? "?"}: ${item.correctness === "correct" ? "scored correct" : item.correctness === "incorrect" ? "scored incorrect" : "outcome available"} with ${item.reasoning_quality.replaceAll("_", " ")} reasoning.`
    )
  );
  const limitationCodes = new Set<EvidenceLimitation>();
  for (const item of itemEvidence) {
    for (const limitation of item.evidence_limitations) {
      if (limitation !== "no_tempting_option_reported" || itemEvidence.some((entry) => !entry.reasoning_excerpt)) {
        limitationCodes.add(limitation);
      }
    }
  }
  if (reasoningQuality === "accurate_but_concise") {
    limitationCodes.add("limited_elaboration");
  }
  limitationCodes.add("transfer_not_yet_observed");

  const initialResults = `${itemsCorrect} of ${itemEvidence.length} correct`;
  const understandingLabel = studentLabelForUnderstanding(understanding);
  const reasoningLabel = studentLabelForReasoning(reasoningQuality);
  const confidenceLabel = studentLabelForConfidence(confidenceCalibration);
  const crossItemPattern =
    itemsCorrect === itemEvidence.length && itemEvidence.length > 0
      ? `Across Items ${itemEvidence.map((item) => item.item_position ?? "?").join(", ")}, the selected answers were scored correct.`
      : `Across the package, ${itemsCorrect} of ${itemEvidence.length} selected answers were scored correct.`;

  const outcomeSummary: OutcomeSummaryV2 = {
    items_administered: itemEvidence.length,
    items_answered: itemsAnswered,
    items_correct: itemsCorrect,
    proportion_correct: itemEvidence.length > 0 ? itemsCorrect / itemEvidence.length : 0,
    item_results: itemEvidence.map((item) => {
      const response = responses.find(
        (entry) => stringValue(entry.item_public_id) === item.item_public_id
      );
      const answerExplanationRevealed =
        answersRevealed && (booleanValue(response?.answer_explanation_revealed) ?? true);

      return {
        item_public_id: item.item_public_id,
        item_position: item.item_position,
        selected_option: item.selected_option,
        result: item.correctness,
        response_available: Boolean(item.selected_option),
        reasoning_available: Boolean(item.reasoning_excerpt),
        confidence: item.confidence,
        tempting_option_available: Boolean(item.tempting_option || item.tempting_option_reason),
        answer_key_revealed: answersRevealed,
        correct_option: answersRevealed
          ? stringValue(response?.correct_option_snapshot)
          : null,
        student_answer: item.selected_option,
        answer_explanation_revealed: answerExplanationRevealed,
        answer_explanation: answerExplanationRevealed
          ? studentSafeAnswerExplanationFromResponse(response)
          : null,
        distractor_boundary: answerExplanationRevealed
          ? stringValue(response?.student_safe_distractor_boundary)
          : null,
        revealed_at: answerExplanationRevealed ? stringValue(response?.revealed_at) : null,
        reveal_trigger: answerExplanationRevealed ? stringValue(response?.reveal_trigger) : null,
        explanation_version: answerExplanationRevealed
          ? stringValue(response?.explanation_version) ?? ANSWER_EXPLANATION_VERSION
          : null,
        student_display_acknowledged_at: answerExplanationRevealed
          ? stringValue(response?.student_display_acknowledged_at)
          : null
      };
    }),
    incomplete_items: itemEvidence
      .filter((item) => !item.selected_option)
      .map((item) => item.item_public_id),
    restricted_answer_reveal_state: {
      answer_reveal_policy: answerRevealPolicy,
      correctness_status_reveal_policy: correctnessStatusRevealPolicy,
      answer_reveal_policy_version: ANSWER_REVEAL_POLICY_VERSION,
      full_answer_key_revealed: answersRevealed
    }
  };

  const profile: EvidenceIntegratedProfileV2 = {
    profile_schema_version: EVIDENCE_INTEGRATED_PROFILE_SCHEMA_VERSION,
    session_public_id: sessionPublicId,
    assessment_public_id: assessmentPublicId,
    assessment_snapshot_version: stringValue(assessment.title) ?? assessmentPublicId,
    response_package_version: stringValue(payload.package_type) ?? "initial_concept_unit_response_package",
    generated_at: generatedAt.toISOString(),
    outcome_summary: outcomeSummary,
    assessment_specific_understanding: {
      value: understanding,
      student_label: understandingLabel,
      explanation:
        understanding === "sound_understanding"
          ? "The package supports a sound assessment-specific understanding, while the next step should sharpen the conceptual boundary."
          : understanding === "strong_well_supported_understanding"
            ? "The package shows correct answers with precise reasoning, while transfer evidence is still pending."
            : understanding === "specific_misconception"
              ? "One or more responses point to a specific proposition that needs review."
              : "The package evidence is limited or mixed, so the interpretation remains provisional.",
      evidence_refs: evidenceRefs,
      not_a_stable_ability_estimate: true
    },
    reasoning_quality: {
      value: reasoningQuality,
      student_label: reasoningLabel,
      explanation:
        reasoningQuality === "accurate_but_concise"
          ? "The reasoning is conceptually usable but leaves some precision to check."
          : reasoningQuality === "well_supported_and_precise"
            ? "The reasoning gives clear support for the selected answers."
            : "The reasoning evidence needs additional review before making a stronger claim.",
      evidence_refs: evidenceRefs
    },
    confidence_calibration: {
      value: confidenceCalibration,
      student_label: confidenceLabel,
      explanation:
        confidenceCalibration === "reasonably_calibrated"
          ? "Your confidence mostly matched the answers and explanations in this first set."
          : "Your confidence is used as context and does not determine understanding by itself.",
      evidence_refs: evidenceRefs
    },
    evidence_limitations: [...limitationCodes].map((code) => ({
      code,
      description:
        code === "limited_elaboration"
          ? "Some reasoning is concise, so the next interaction should check precision rather than assume misunderstanding."
          : code === "transfer_not_yet_observed"
            ? "The initial package has not yet observed transfer to a new item."
            : code === "no_tempting_option_reported"
              ? "No tempting option was reported; this is neutral evidence unless a required response was missing."
              : "This evidence limitation qualifies the interpretation but does not prove motivation, effort, or misconduct.",
      evidence_refs: code === "transfer_not_yet_observed" ? [] : evidenceRefs
    })),
    growth_target: {
      target: growthTarget,
      evidence_refs: evidenceRefs,
      compatible_activity_types: ["identify_specific_flaw", "rank_distractors", "correct_incorrect_parts"]
    },
    item_evidence: itemEvidence,
    cross_item_patterns: [crossItemPattern],
    alternative_explanations: [
      "Correct answers plus concise reasoning can indicate sound but not fully elaborated understanding.",
      "Confidence ratings are interpreted with answer and reasoning evidence, not as stand-alone proof."
    ],
    evidence_sufficiency: evidenceSufficiency,
    profile_uncertainty:
      "This is assessment-specific current evidence, not a stable ability estimate, course-grade prediction, or personality or motivation trait.",
    student_safe_summary: {
      initial_results: initialResults,
      understanding_label: understandingLabel,
      reasoning_label: reasoningLabel,
      confidence_label: confidenceLabel,
      evidence_limitation_label: limitationCodes.has("limited_elaboration")
        ? "Some reasoning was concise."
        : null,
      next_focus: growthTarget,
      boundary_statement:
        "This profile summarizes only the evidence from this assessment package."
    },
    source_agent_call_public_id: input.source_agent_call_public_id ?? null,
    validation_status: "validated"
  };

  const feedback: PackageFeedbackV2 = {
    feedback_schema_version: PACKAGE_FEEDBACK_SCHEMA_VERSION,
    result_summary: `Initial item results: ${initialResults}.`,
    strengths: [
      itemsCorrect === itemEvidence.length
        ? "All initial answers were scored correct."
        : `${itemsCorrect} of ${itemEvidence.length} initial answers were scored correct.`,
      reasoningQuality === "accurate_but_concise"
        ? "Your reasoning gives useful evidence, but some boundaries are compressed."
        : profile.reasoning_quality.explanation
    ],
    growth_target: growthTarget,
    evidence_references: evidenceRefs,
    cross_item_pattern: crossItemPattern,
    confidence_comment: profile.confidence_calibration.explanation,
    evidence_limitation:
      profile.evidence_limitations.find((limitation) => limitation.code === "limited_elaboration")?.description ?? null,
    answer_reveal_state: outcomeSummary.restricted_answer_reveal_state,
    next_interaction_reference: "next_interaction_v2"
  };

  const nextInteraction = routeNextInteraction({
    profile,
    response_package_payload: payload
  });

  const studentCommunicationInput = buildStudentCommunicationInputForEvidenceBundle({
    profile,
    feedback,
    next_interaction: nextInteraction,
    response_package_payload: payload
  });
  const studentCommunication = {
    input: studentCommunicationInput,
    ...buildValidatedStudentCommunication(studentCommunicationInput)
  };
  const communicationOutput = studentCommunication.output;

  profile.student_safe_summary.initial_results = initialResults;
  profile.student_safe_summary.understanding_label = studentCommunicationInput.validated_understanding_summary.student_label;
  profile.student_safe_summary.reasoning_label = studentCommunicationInput.validated_reasoning_summary.student_label;
  profile.student_safe_summary.confidence_label = studentCommunicationInput.validated_confidence_summary.student_label;
  profile.student_safe_summary.next_focus = studentCommunicationInput.validated_growth_target.student_facing_text;
  profile.student_safe_summary.boundary_statement =
    "This summary uses only the evidence from the administered items in this assessment package.";
  feedback.result_summary = communicationOutput.package_feedback_narrative;
  feedback.strengths = [studentCommunicationInput.validated_reasoning_summary.student_label];
  feedback.cross_item_pattern = studentCommunicationInput.validated_understanding_summary.student_label;
  feedback.confidence_comment = studentCommunicationInput.validated_confidence_summary.student_label;
  feedback.evidence_limitation =
    studentCommunicationInput.validated_evidence_limitations[0] ?? null;
  nextInteraction.prompt = [
    communicationOutput.activity_transition,
    communicationOutput.activity_prompt
  ].join("\n\n");

  const validators = {
    profile_coherence: validateEvidenceProfileCoherence(profile),
    feedback_specificity: validatePackageFeedbackSpecificity({ feedback, profile }),
    single_action_state: validateSingleActionState({ feedback, next_interaction: nextInteraction }),
    activity_routing_coherence: validateActivityRoutingCoherence({
      profile,
      next_interaction: nextInteraction
    }),
    student_communication_fact_lock: communicationValidationToResult(studentCommunication.fact_validation),
    student_communication_language: communicationValidationToResult(studentCommunication.language_validation)
  };
  const bundle = {
    profile,
    feedback,
    next_interaction: nextInteraction,
    student_communication: studentCommunication,
    validators,
    artifact_versions: {
      profile_schema_version: EVIDENCE_INTEGRATED_PROFILE_SCHEMA_VERSION,
      item_evidence_schema_version: ITEM_EVIDENCE_SCHEMA_VERSION,
      feedback_schema_version: PACKAGE_FEEDBACK_SCHEMA_VERSION,
      next_interaction_schema_version: NEXT_INTERACTION_SCHEMA_VERSION,
      routing_policy_version: FORMATIVE_ROUTING_POLICY_VERSION,
      activity_taxonomy_version: ACTIVITY_TAXONOMY_VERSION,
      state_machine_version: CHAT_NATIVE_STATE_MACHINE_VERSION,
      coherence_validator_version: PROFILE_COHERENCE_VALIDATOR_VERSION,
      routing_coherence_validator_version: ROUTING_COHERENCE_VALIDATOR_VERSION,
      answer_reveal_policy_version: ANSWER_REVEAL_POLICY_VERSION,
      student_communication_prompt_version: STUDENT_COMMUNICATION_PROMPT_VERSION,
      student_communication_input_schema_version: STUDENT_COMMUNICATION_INPUT_SCHEMA_VERSION,
      student_communication_output_schema_version: STUDENT_COMMUNICATION_OUTPUT_SCHEMA_VERSION,
      student_communication_fact_lock_validator_version: STUDENT_COMMUNICATION_FACT_LOCK_VALIDATOR_VERSION,
      student_communication_language_validator_version: STUDENT_COMMUNICATION_LANGUAGE_VALIDATOR_VERSION,
      student_communication_fallback_version: STUDENT_COMMUNICATION_FALLBACK_VERSION,
      student_communication_rendered_version: STUDENT_COMMUNICATION_RENDERED_VERSION
    },
    effective_evidence_package_hash: ""
  };

  return {
    ...bundle,
    effective_evidence_package_hash: hashEvidenceIntegrationValue({
      profile,
      feedback,
      next_interaction: nextInteraction
    })
  };
}

export function applyStudentCommunicationToEvidenceBundle(input: {
  bundle: EvidenceIntegrationBundleV2;
  student_communication: StudentCommunicationBundleV1;
}): EvidenceIntegrationBundleV2 {
  const communicationInput = input.student_communication.input;
  const communicationOutput = input.student_communication.output;
  const profile = {
    ...input.bundle.profile,
    student_safe_summary: {
      ...input.bundle.profile.student_safe_summary,
      understanding_label: communicationInput.validated_understanding_summary.student_label,
      reasoning_label: communicationInput.validated_reasoning_summary.student_label,
      confidence_label: communicationInput.validated_confidence_summary.student_label,
      next_focus: communicationInput.validated_growth_target.student_facing_text
    }
  };
  const feedback = {
    ...input.bundle.feedback,
    result_summary: communicationOutput.package_feedback_narrative,
    strengths: [communicationInput.validated_reasoning_summary.student_label],
    cross_item_pattern: communicationInput.validated_understanding_summary.student_label,
    confidence_comment: communicationInput.validated_confidence_summary.student_label,
    evidence_limitation: communicationInput.validated_evidence_limitations[0] ?? null
  };
  const nextInteraction = {
    ...input.bundle.next_interaction,
    prompt: [
      communicationOutput.activity_transition,
      communicationOutput.activity_prompt
    ].join("\n\n")
  };
  const validators = {
    ...input.bundle.validators,
    student_communication_fact_lock:
      communicationValidationToResult(input.student_communication.fact_validation),
    student_communication_language:
      communicationValidationToResult(input.student_communication.language_validation)
  };

  return {
    ...input.bundle,
    profile,
    feedback,
    next_interaction: nextInteraction,
    student_communication: input.student_communication,
    validators,
    effective_evidence_package_hash: hashEvidenceIntegrationValue({
      profile,
      feedback,
      next_interaction: nextInteraction
    })
  };
}

function routeNextInteraction(input: {
  profile: EvidenceIntegratedProfileV2;
  response_package_payload: PackagePayload;
}): NextInteractionV2 {
  const firstItem = input.profile.item_evidence[0] ?? null;
  const responses = itemResponses(input.response_package_payload);
  const responseForFirst = responses.find(
    (response) => stringValue(response.item_public_id) === firstItem?.item_public_id
  );
  const options =
    recordValue(responseForFirst?.item_snapshot).options ??
    includedItemsById(input.response_package_payload).get(firstItem?.item_public_id ?? "")?.options;
  const distractor = firstIncorrectOption({
    options,
    selected_option: firstItem?.selected_option ?? null,
    correct_option: stringValue(responseForFirst?.correct_option_snapshot)
  });
  const distractorRefs = firstItem && distractor
    ? [{
        item_public_id: firstItem.item_public_id,
        option_label: distractor.label,
        role: "unselected_peer_pattern" as const
      }]
    : [];
  const understanding = input.profile.assessment_specific_understanding.value;
  const reasoning = input.profile.reasoning_quality.value;
  const growthTarget = input.profile.growth_target.target;
  const evidenceRefs = input.profile.growth_target.evidence_refs;
  const limitationCodes = new Set(input.profile.evidence_limitations.map((entry) => entry.code));
  const distractorPhrase = distractor
    ? `Option ${distractor.label}`
    : "one of the incorrect options";
  const correctOption = stringValue(responseForFirst?.correct_option_snapshot);
  const answersRevealed =
    input.profile.outcome_summary.restricted_answer_reveal_state.full_answer_key_revealed;
  const knownCorrectAnswerPhrase = correctOption && answersRevealed
    ? `You now know option ${correctOption} is correct. `
    : "";
  const postRevealConstraints = {
    may_reveal_correct_option: answersRevealed,
    may_reveal_explanation: answersRevealed,
    policy_version: ANSWER_REVEAL_POLICY_VERSION
  } as const;

  if (understanding === "strong_well_supported_understanding") {
    return {
      next_interaction_schema_version: NEXT_INTERACTION_SCHEMA_VERSION,
      interaction_type: "distractor_focused_activity",
      prompt: `${knownCorrectAnswerPhrase}${distractorPhrase} could still be attractive to a peer. Rank the flaw in that option by importance, then name the boundary a student would need to notice.`,
      purpose: "Use a higher-order distractor task to extend already well-supported evidence.",
      expected_response_format: "Two or three sentences ranking the flaw and naming the boundary.",
      response_constraints: [
        "Use the administered option text only.",
        "Explain the boundary rather than copying the explanation.",
        "Add a new comparison or rewrite."
      ],
      evaluation_criteria: [
        "Ranks or prioritizes the distractor flaw.",
        "Names a defensible conceptual boundary.",
        "Avoids claims about motivation or effort."
      ],
      linked_growth_target: growthTarget,
      linked_evidence_refs: evidenceRefs,
      activity_family: "distractor_focused_activity",
      activity_type: "rank_distractors",
      cognitive_level: "evaluating",
      distractor_refs: distractorRefs,
      next_runtime_state: "AWAIT_FORMATIVE_ACTIVITY_RESPONSE",
      answer_reveal_constraints: postRevealConstraints,
      routing_policy_version: FORMATIVE_ROUTING_POLICY_VERSION,
      activity_taxonomy_version: ACTIVITY_TAXONOMY_VERSION,
      routing_justification:
        "The package is strong enough for a higher-order distractor evaluation task; foundational support would be below the demonstrated footing.",
      fallback_or_repair_status: "deterministic_fallback_used"
    };
  }

  if (
    understanding === "sound_understanding" ||
    (understanding === "partial_understanding" &&
      ["partially_supported", "accurate_but_concise"].includes(reasoning))
  ) {
    const scaffolded = understanding === "partial_understanding";
    return {
      next_interaction_schema_version: NEXT_INTERACTION_SCHEMA_VERSION,
      interaction_type: scaffolded ? "scaffolded_distractor_activity" : "distractor_focused_activity",
      prompt: scaffolded
        ? `${knownCorrectAnswerPhrase}${distractorPhrase} has one part that could sound reasonable and one part that does not fit. Name both parts, then rewrite the weak part so it becomes accurate.`
        : `${knownCorrectAnswerPhrase}${distractorPhrase} could look plausible to another student. In two or three sentences, identify the most precise flaw in that option, then state the stronger boundary.`,
      purpose: scaffolded
        ? "Use a brief scaffold to keep distractor work accessible after the answer reveal."
        : "Sharpen the conceptual boundary using an administered distractor after the answer reveal.",
      expected_response_format: "Two or three sentences that name the flaw in the distractor and connect it to the growth target.",
      response_constraints: [
        "Use only the options already shown.",
        "Focus on the reasoning difference, not on guessing.",
        "Add a new explanation rather than copying the result summary."
      ],
      evaluation_criteria: [
        "Names one precise flaw in the distractor.",
        "Connects the flaw to the current growth target.",
        "Avoids unsupported claims about motivation or effort."
      ],
      linked_growth_target: growthTarget,
      linked_evidence_refs: evidenceRefs,
      activity_family: scaffolded ? "scaffolded_distractor_activity" : "distractor_focused_activity",
      activity_type: scaffolded ? "correct_incorrect_parts" : "identify_specific_flaw",
      cognitive_level: "evaluating",
      distractor_refs: distractorRefs,
      next_runtime_state: "AWAIT_FORMATIVE_ACTIVITY_RESPONSE",
      answer_reveal_constraints: postRevealConstraints,
      routing_policy_version: FORMATIVE_ROUTING_POLICY_VERSION,
      activity_taxonomy_version: ACTIVITY_TAXONOMY_VERSION,
      routing_justification:
        scaffolded
          ? "The package shows partial relevant knowledge, so the fallback uses a scaffolded distractor task rather than generic definition work."
          : "The package shows enough conceptual footing for distractor analysis; concise reasoning is routed to precision work, not foundational support.",
      fallback_or_repair_status: "deterministic_fallback_used"
    };
  }

  if (understanding === "specific_misconception") {
    return {
      next_interaction_schema_version: NEXT_INTERACTION_SCHEMA_VERSION,
      interaction_type: "distractor_focused_activity",
      prompt: `${knownCorrectAnswerPhrase}Look back at the option you selected. What idea makes it tempting, and what part of that idea needs correction?`,
      purpose: "Use the selected distractor to examine a provisional misconception.",
      expected_response_format: "Two or three sentences naming the tempting idea and the correction.",
      response_constraints: ["Use your own words.", "Add a correction rather than copying the explanation."],
      evaluation_criteria: ["Names the tempting idea.", "Separates the plausible part from the unsupported part."],
      linked_growth_target: growthTarget,
      linked_evidence_refs: evidenceRefs,
      activity_family: "distractor_focused_activity",
      activity_type: "distractor_temptation_analysis",
      cognitive_level: "applying",
      distractor_refs: input.profile.item_evidence
        .filter((item) => item.correctness === "incorrect" && item.selected_option)
        .map((item) => ({
          item_public_id: item.item_public_id,
          option_label: item.selected_option as string,
          role: "selected" as const
        })),
      next_runtime_state: "AWAIT_FORMATIVE_ACTIVITY_RESPONSE",
      answer_reveal_constraints: postRevealConstraints,
      routing_policy_version: FORMATIVE_ROUTING_POLICY_VERSION,
      activity_taxonomy_version: ACTIVITY_TAXONOMY_VERSION,
      routing_justification:
        "A specific misconception route is used only because response evidence contains an incorrect selected option with reasoning.",
      fallback_or_repair_status: "deterministic_fallback_used"
    };
  }

  if (understanding === "foundational_knowledge_gap") {
    return {
      next_interaction_schema_version: NEXT_INTERACTION_SCHEMA_VERSION,
      interaction_type: "foundational_support_activity",
      prompt: `${knownCorrectAnswerPhrase}Reverse-engineer the item: write one sentence explaining the main concept the item was testing in your own words.`,
      purpose: "Establish an accessible starting point before distractor work.",
      expected_response_format: "One sentence in the student's own words.",
      response_constraints: ["Keep it brief.", "Use your own words rather than copying the explanation."],
      evaluation_criteria: ["Names the main concept.", "Avoids unrelated explanation."],
      linked_growth_target: growthTarget,
      linked_evidence_refs: evidenceRefs,
      activity_family: "foundational_support_activity",
      activity_type: "reverse_engineer_stem",
      cognitive_level: "foundational",
      distractor_refs: [],
      next_runtime_state: "AWAIT_FOUNDATIONAL_ACTIVITY_RESPONSE",
      answer_reveal_constraints: postRevealConstraints,
      routing_policy_version: FORMATIVE_ROUTING_POLICY_VERSION,
      activity_taxonomy_version: ACTIVITY_TAXONOMY_VERSION,
      routing_justification:
        "Foundational support is selected only when the package does not show enough footing for distractor work.",
      fallback_or_repair_status: "deterministic_fallback_used"
    };
  }

  if (
    limitationCodes.has("prerequisite_language_barrier_possible") ||
    limitationCodes.has("prerequisite_quantitative_skill_barrier_possible")
  ) {
    return {
      next_interaction_schema_version: NEXT_INTERACTION_SCHEMA_VERSION,
      interaction_type: "prerequisite_support_activity",
      prompt: `${knownCorrectAnswerPhrase}Name the word, symbol, or calculation step that made the item hard to interpret, then say how you would restate it.`,
      purpose: "Address a possible prerequisite barrier before returning to distractor reasoning.",
      expected_response_format: "One short phrase or sentence.",
      response_constraints: ["Name only the barrier you noticed.", "Use your own words."],
      evaluation_criteria: ["Identifies a possible prerequisite barrier.", "Avoids unsupported claims about correctness."],
      linked_growth_target: growthTarget,
      linked_evidence_refs: evidenceRefs,
      activity_family: "prerequisite_support_activity",
      activity_type: "correct_incorrect_parts",
      cognitive_level: "foundational",
      distractor_refs: [],
      next_runtime_state: "AWAIT_FOUNDATIONAL_ACTIVITY_RESPONSE",
      answer_reveal_constraints: postRevealConstraints,
      routing_policy_version: FORMATIVE_ROUTING_POLICY_VERSION,
      activity_taxonomy_version: ACTIVITY_TAXONOMY_VERSION,
      routing_justification:
        "A prerequisite support route is selected because the evidence limitations identify a possible access barrier.",
      fallback_or_repair_status: "deterministic_fallback_used"
    };
  }

  if (limitationCodes.has("construct_identification_unclear")) {
    return {
      next_interaction_schema_version: NEXT_INTERACTION_SCHEMA_VERSION,
      interaction_type: "diagnostic_clarification",
      prompt: `${knownCorrectAnswerPhrase}What idea do you think the item was mainly asking about, and how does the correct answer use that idea?`,
      purpose: "Orient to the assessed construct before assigning a distractor or foundational activity.",
      expected_response_format: "One sentence.",
      response_constraints: ["Use your own words.", "Do not copy the explanation."],
      evaluation_criteria: ["Names the likely target idea.", "Provides enough information for the next route."],
      linked_growth_target: growthTarget,
      linked_evidence_refs: evidenceRefs,
      activity_family: "diagnostic_clarification",
      activity_type: "reverse_engineer_stem",
      cognitive_level: "foundational",
      distractor_refs: [],
      next_runtime_state: "AWAIT_DIAGNOSTIC_CLARIFICATION_RESPONSE",
      answer_reveal_constraints: postRevealConstraints,
      routing_policy_version: FORMATIVE_ROUTING_POLICY_VERSION,
      activity_taxonomy_version: ACTIVITY_TAXONOMY_VERSION,
      routing_justification:
        "Construct identification is unclear, so the router asks one orienting question rather than assigning a misconception.",
      fallback_or_repair_status: "deterministic_fallback_used"
    };
  }

  return {
    next_interaction_schema_version: NEXT_INTERACTION_SCHEMA_VERSION,
    interaction_type: "diagnostic_clarification",
    prompt: `${knownCorrectAnswerPhrase}What information or rule would help explain why the correct answer fits these items?`,
    purpose: "Collect one low-burden clarification because the current evidence is not sufficient for a stronger route.",
    expected_response_format: "One or two sentences.",
    response_constraints: ["Do not worry about being complete.", "Use your own words."],
    evaluation_criteria: ["Provides usable evidence about the rule or idea used."],
    linked_growth_target: growthTarget,
    linked_evidence_refs: evidenceRefs,
    activity_family: "diagnostic_clarification",
    activity_type: "reverse_engineer_stem",
    cognitive_level: "foundational",
    distractor_refs: [],
    next_runtime_state: "AWAIT_DIAGNOSTIC_CLARIFICATION_RESPONSE",
    answer_reveal_constraints: postRevealConstraints,
    routing_policy_version: FORMATIVE_ROUTING_POLICY_VERSION,
    activity_taxonomy_version: ACTIVITY_TAXONOMY_VERSION,
    routing_justification:
      "The evidence is insufficient or mixed, so the router asks for one clarification rather than assigning a misconception.",
    fallback_or_repair_status: "deterministic_fallback_used"
  };
}

export function validateEvidenceProfileCoherence(profile: EvidenceIntegratedProfileV2): ValidationResult {
  const issues: ValidationResult["issues"] = [];
  const allCorrect =
    profile.outcome_summary.items_administered > 0 &&
    profile.outcome_summary.items_correct === profile.outcome_summary.items_administered;

  if (
    allCorrect &&
    profile.reasoning_quality.value === "accurate_but_concise" &&
    ["adequate", "strong"].includes(profile.evidence_sufficiency) &&
    !["sound_understanding", "strong_well_supported_understanding"].includes(
      profile.assessment_specific_understanding.value
    )
  ) {
    issues.push({
      rule_code: "all_correct_concise_cannot_drop_below_sound",
      field_path: "assessment_specific_understanding.value",
      message: "All correct with relevant concise reasoning cannot be below sound solely because it is concise."
    });
  }

  if (
    profile.assessment_specific_understanding.value === "specific_misconception" &&
    !profile.item_evidence.some((item) => item.possible_misconception.present && item.possible_misconception.proposition)
  ) {
    issues.push({
      rule_code: "misconception_requires_named_proposition",
      field_path: "item_evidence.possible_misconception",
      message: "Specific misconception requires a named incorrect proposition supported by item evidence."
    });
  }

  if (
    /\b(cheated|cheating|dishonest)\b/i.test(stableJson(profile)) ||
    /\b(low|poor|weak|strong|high|adequate)\s+(motivation|effort)\b/i.test(stableJson(profile)) ||
    /\b(motivation|effort)\s+(was|is|seems|appears)\b/i.test(stableJson(profile)) ||
    /\bmisconduct\s+(present|detected|suspected|likely)\b/i.test(stableJson(profile))
  ) {
    issues.push({
      rule_code: "forbidden_process_inference",
      field_path: "profile",
      message: "Profile must not infer motivation, effort, cheating, or misconduct."
    });
  }

  return {
    valid: issues.length === 0,
    validator_version: PROFILE_COHERENCE_VALIDATOR_VERSION,
    issues
  };
}

export function validatePackageFeedbackSpecificity(input: {
  feedback: PackageFeedbackV2;
  profile: EvidenceIntegratedProfileV2;
}): ValidationResult {
  const issues: ValidationResult["issues"] = [];
  const scoredCorrectCount = input.profile.outcome_summary.items_correct;
  const scoredCorrectText: Record<number, string> = {
    0: "zero",
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
    9: "nine",
    10: "ten"
  };
  if (input.feedback.evidence_references.length < input.profile.item_evidence.length) {
    issues.push({
      rule_code: "missing_item_evidence_reference",
      field_path: "feedback.evidence_references",
      message: "Feedback must reference each administered item's evidence."
    });
  }
  if (/\b(on the right track|good job|study more|add more detail|review the concept)\b/i.test(input.feedback.growth_target)) {
    issues.push({
      rule_code: "generic_growth_target",
      field_path: "feedback.growth_target",
      message: "Growth target must be evidence-linked and specific."
    });
  }
  if (/[?]\s*$/.test(input.feedback.result_summary) || /Quick check|What do you think/i.test(input.feedback.result_summary)) {
    issues.push({
      rule_code: "actionable_question_in_feedback",
      field_path: "feedback.result_summary",
      message: "Feedback body must not contain the next actionable prompt."
    });
  }
  const summaryLower = input.feedback.result_summary.toLowerCase();
  const includesScoredCount =
    summaryLower.includes(String(scoredCorrectCount)) ||
    Boolean(scoredCorrectText[scoredCorrectCount] && summaryLower.includes(scoredCorrectText[scoredCorrectCount]));
  if (!includesScoredCount) {
    issues.push({
      rule_code: "correctness_summary_mismatch",
      field_path: "feedback.result_summary",
      message: "Feedback result summary must match scored response-package outcomes."
    });
  }

  return {
    valid: issues.length === 0,
    validator_version: FEEDBACK_SPECIFICITY_VALIDATOR_VERSION,
    issues
  };
}

export function validateSingleActionState(input: {
  feedback: PackageFeedbackV2;
  next_interaction: NextInteractionV2;
}): ValidationResult {
  const issues: ValidationResult["issues"] = [];
  const promptCount = [input.next_interaction.prompt].filter((prompt) => prompt.trim().length > 0).length;
  const feedbackText = [
    input.feedback.result_summary,
    ...input.feedback.strengths,
    input.feedback.growth_target,
    input.feedback.cross_item_pattern,
    input.feedback.confidence_comment,
    input.feedback.evidence_limitation ?? ""
  ].join(" ");

  if (promptCount !== 1) {
    issues.push({
      rule_code: "next_interaction_prompt_count_invalid",
      field_path: "next_interaction.prompt",
      message: "Exactly one next-interaction prompt is required."
    });
  }
  if (/[?]/.test(feedbackText) || /\bQuick check\b/i.test(feedbackText)) {
    issues.push({
      rule_code: "unbound_prompt_in_feedback",
      field_path: "feedback",
      message: "Feedback must not contain an actionable question outside NextInteraction."
    });
  }

  return {
    valid: issues.length === 0,
    validator_version: SINGLE_ACTION_VALIDATOR_VERSION,
    issues
  };
}

export function validateActivityRoutingCoherence(input: {
  profile: EvidenceIntegratedProfileV2;
  next_interaction: NextInteractionV2;
}): ValidationResult {
  const issues: ValidationResult["issues"] = [];
  const understanding = input.profile.assessment_specific_understanding.value;
  const sufficientFooting =
    ["sound_understanding", "strong_well_supported_understanding", "partial_understanding"].includes(understanding) &&
    ["adequate", "strong"].includes(input.profile.evidence_sufficiency);
  const distractorRoute = [
    "distractor_focused_activity",
    "scaffolded_distractor_activity"
  ].includes(input.next_interaction.interaction_type);

  if (
    sufficientFooting &&
    input.next_interaction.interaction_type === "foundational_support_activity"
  ) {
    issues.push({
      rule_code: "foundational_route_requires_foundational_evidence",
      field_path: "next_interaction.interaction_type",
      message:
        "Foundational support is not coherent when the package already shows adequate footing for distractor work."
    });
  }

  if (distractorRoute && input.next_interaction.distractor_refs.length === 0) {
    issues.push({
      rule_code: "distractor_route_requires_distractor_reference",
      field_path: "next_interaction.distractor_refs",
      message: "Distractor-focused routes must reference at least one administered distractor."
    });
  }

  if (
    input.next_interaction.activity_type === "diagnose_misconception" &&
    !input.profile.item_evidence.some((item) => item.possible_misconception.present)
  ) {
    issues.push({
      rule_code: "misconception_activity_requires_misconception_evidence",
      field_path: "next_interaction.activity_type",
      message:
        "A misconception diagnosis activity requires a supported possible misconception in item evidence."
    });
  }

  if (
    input.next_interaction.answer_reveal_constraints.may_reveal_correct_option &&
    !input.profile.outcome_summary.restricted_answer_reveal_state.full_answer_key_revealed
  ) {
    issues.push({
      rule_code: "activity_reveals_answer_before_policy",
      field_path: "next_interaction.answer_reveal_constraints",
      message: "The next interaction may not reveal a correct option before answer-reveal policy allows it."
    });
  }

  if (
    understanding === "indeterminate_due_to_insufficient_evidence" &&
    input.next_interaction.activity_type === "diagnose_misconception"
  ) {
    issues.push({
      rule_code: "low_information_cannot_assign_misconception",
      field_path: "next_interaction.activity_type",
      message:
        "Low-information or indeterminate evidence cannot be routed directly to a confident misconception diagnosis."
    });
  }

  return {
    valid: issues.length === 0,
    validator_version: ROUTING_COHERENCE_VALIDATOR_VERSION,
    issues
  };
}

export function studentSafeProjectionFromEvidenceProfile(
  profile: EvidenceIntegratedProfileV2,
  updatedAt: string
) {
  const legacyStatus =
    profile.assessment_specific_understanding.value === "foundational_knowledge_gap"
      ? "Needs more work"
      : profile.assessment_specific_understanding.value === "indeterminate_due_to_insufficient_evidence"
        ? "Still developing"
        : "Mostly understood";

  return {
    status: legacyStatus as "Mostly understood" | "Still developing" | "Needs more work",
    explanation: profile.student_safe_summary.boundary_statement,
    next_focus: profile.student_safe_summary.next_focus,
    updated_at: updatedAt,
    initial_results: profile.student_safe_summary.initial_results,
    current_understanding: {
      label: profile.student_safe_summary.understanding_label,
      value: profile.student_safe_summary.understanding_label
    },
    reasoning: {
      label: profile.student_safe_summary.reasoning_label,
      value: profile.student_safe_summary.reasoning_label
    },
    confidence: {
      label: profile.student_safe_summary.confidence_label,
      value: profile.student_safe_summary.confidence_label
    },
    evidence_limitation: profile.student_safe_summary.evidence_limitation_label
  };
}

export function packageResultsForStudent(profile: EvidenceIntegratedProfileV2) {
  return {
    result_summary: `Initial item results: ${profile.student_safe_summary.initial_results}`,
    answer_reveal_policy: profile.outcome_summary.restricted_answer_reveal_state.answer_reveal_policy,
    result_status_reveal_policy:
      profile.outcome_summary.restricted_answer_reveal_state.correctness_status_reveal_policy,
    full_answer_revealed:
      profile.outcome_summary.restricted_answer_reveal_state.full_answer_key_revealed,
    items: profile.outcome_summary.item_results.map((item) => ({
      item_public_id: item.item_public_id,
      item_position: item.item_position,
      selected_option: item.selected_option,
      status_label:
        item.result === "correct"
          ? "Correct"
          : item.result === "incorrect"
            ? "Incorrect"
            : item.result === "unanswered"
              ? "Unanswered"
              : "Not scored",
      answer_revealed: item.answer_key_revealed,
      revealed_answer: item.answer_key_revealed ? item.correct_option : null,
      student_answer: item.student_answer,
      answer_explanation_revealed: item.answer_explanation_revealed,
      answer_explanation: item.answer_explanation,
      distractor_boundary: item.distractor_boundary
    }))
  };
}
