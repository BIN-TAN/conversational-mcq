import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  FORMATIVE_ACTIVITY_SCHEMA_VERSION,
  FormativeActivityFamilySchema,
  type FormativeActivityFamily
} from "@/lib/services/student-assessment/formative-activity-design";
import type { FormativeValue } from "@/lib/services/student-assessment/formative-value-determination";

export const ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION =
  "student-activity-misconception-evidence-v1" as const;
export const ACTIVITY_MISCONCEPTION_EVIDENCE_REVIEW_ARTIFACT_VERSION =
  "student-activity-misconception-evidence-review-v1" as const;
export const ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME =
  "formative_activity_response_evaluator_agent" as const;
export const ACTIVITY_RESPONSE_EVALUATOR_SCHEMA_VERSION =
  "formative-activity-response-evaluation-v1" as const;

export const DiagnosticPurposeSchema = z.enum([
  "conceptual_entry_grounding",
  "distractor_misconception_probe",
  "reasoning_boundary_repair",
  "independent_misconception_verification"
]);

export const ActivityResponseKindSchema = z.enum([
  "substantive",
  "partial",
  "low_information",
  "question",
  "move_on",
  "choose_other_activity",
  "off_task",
  "unclear"
]);

export const EvidenceElicitedTypeSchema = z.enum([
  "basic_concept_distinction_stated",
  "distractor_tempting_reason_explained",
  "hidden_assumption_identified",
  "target_boundary_explained",
  "reasoning_link_repaired",
  "independent_reconstruction_given",
  "generated_distractor_explained",
  "confidence_evidence_aligned",
  "none"
]);

export const MisconceptionUpdateStatusSchema = z.enum([
  "conceptual_entry_gap_remains",
  "conceptual_entry_improved",
  "ready_for_distractor_probe",
  "misconception_persisted",
  "misconception_weakened",
  "misconception_unsupported",
  "no_actionable_misconception_evidence",
  "boundary_understanding_improved",
  "reasoning_boundary_still_blurred",
  "independent_evidence_supported",
  "insufficient_new_evidence",
  "student_chose_move_on",
  "student_requested_alternative_activity"
]);

export const ActivityEvidenceQualitySchema = z.enum([
  "high",
  "medium",
  "low",
  "insufficient"
]);

const EvaluationSourceSchema = z.enum(["no_live_fixture", "live_llm", "live_llm_future"]);
const ActivityGenerationSourceSchema = z.enum(["live_llm", "deterministic_review"]);
const ResponseLengthBandSchema = z.enum(["empty", "very_short", "short", "medium", "long"]);
const YesNoPartialSchema = z.enum(["yes", "no", "partial", "not_applicable"]);
const ConfidenceSchema = z.enum(["high", "medium", "low"]);
const EvidenceTargetSchema = z.enum([
  "basic_concept_distinction",
  "distractor_hidden_assumption",
  "target_boundary",
  "reasoning_link",
  "independent_reconstruction",
  "generated_distractor_boundary"
]);
const RecommendedNextDiagnosticPurposeSchema = z.enum([
  "conceptual_entry_grounding",
  "distractor_misconception_probe",
  "reasoning_boundary_repair",
  "independent_misconception_verification",
  "move_on_or_exit",
  "student_choice_needed"
]);
const StudentNextOptionSchema = z.enum(["continue", "choose another activity", "move on"]);

export const ActivityMisconceptionEvidencePacketV1Schema = z.object({
  schema_version: z.literal(ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION),
  evaluator_agent_name: z.literal(ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME),
  evaluation_source: EvaluationSourceSchema,
  runtime_servable_to_student: z.literal(false),
  review_only: z.boolean(),
  session_public_id: z.string().min(1),
  student_public_id: z.string().min(1),
  assessment_public_id: z.string().min(1),
  concept_unit_id: z.string().min(1),
  activity_attempt_id: z.string().min(1),
  source_activity_schema: z.literal(FORMATIVE_ACTIVITY_SCHEMA_VERSION),
  source_activity_family: FormativeActivityFamilySchema,
  source_diagnostic_purpose: DiagnosticPurposeSchema,
  source_activity_generation_source: ActivityGenerationSourceSchema,
  source_activity_runtime_servable_to_student: z.boolean(),
  student_activity_response: z.object({
    response_kind: ActivityResponseKindSchema,
    response_length_band: ResponseLengthBandSchema,
    student_response_text_redacted_or_safe_summary: z.string().min(1).max(900),
    raw_response_stored_elsewhere: z.literal(false)
  }).strict(),
  evidence_elicitation_target: z.object({
    primary_target: EvidenceTargetSchema,
    secondary_targets: z.array(EvidenceTargetSchema).max(6),
    what_counts_as_strong_evidence: z.array(z.string().min(1).max(240)).min(1).max(8),
    what_counts_as_weak_evidence: z.array(z.string().min(1).max(240)).min(1).max(8)
  }).strict(),
  evidence_elicited: z.object({
    elicited: z.boolean(),
    types: z.array(EvidenceElicitedTypeSchema).min(1).max(8),
    student_identified_why_distractor_is_tempting: YesNoPartialSchema,
    student_identified_hidden_assumption: YesNoPartialSchema,
    student_explained_target_boundary: YesNoPartialSchema,
    student_reconstructed_concept_independently: YesNoPartialSchema,
    student_generated_plausible_distractor: YesNoPartialSchema,
    student_repaired_reasoning_link: YesNoPartialSchema
  }).strict(),
  misconception_evidence_update: z.object({
    status: MisconceptionUpdateStatusSchema,
    evidence_quality: ActivityEvidenceQualitySchema,
    confidence: ConfidenceSchema,
    safe_internal_rationale: z.string().min(1).max(1100),
    limitations: z.array(z.string().min(1).max(220)).max(10)
  }).strict(),
  recommended_next_diagnostic_purpose: RecommendedNextDiagnosticPurposeSchema,
  student_safe_feedback: z.object({
    message: z.string().min(1).max(700),
    next_options: z.array(StudentNextOptionSchema).min(1).max(3)
  }).strict(),
  safety_check: z.object({
    answer_key_exposed: z.literal(false),
    correct_option_value_exposed: z.literal(false),
    correctness_label_exposed: z.literal(false),
    raw_distractor_metadata_exposed: z.literal(false),
    raw_misconception_id_exposed: z.literal(false),
    engagement_or_ai_label_exposed: z.literal(false),
    raw_process_payload_exposed: z.literal(false),
    raw_llm_output_exposed: z.literal(false),
    secret_or_header_exposed: z.literal(false),
    deterministic_final_diagnostic_decision_used: z.literal(false)
  }).strict()
}).strict();

export type DiagnosticPurpose = z.infer<typeof DiagnosticPurposeSchema>;
export type ActivityResponseKind = z.infer<typeof ActivityResponseKindSchema>;
export type EvidenceElicitedType = z.infer<typeof EvidenceElicitedTypeSchema>;
export type MisconceptionUpdateStatus = z.infer<typeof MisconceptionUpdateStatusSchema>;
export type ActivityEvidenceQuality = z.infer<typeof ActivityEvidenceQualitySchema>;
export type ActivityMisconceptionEvidencePacketV1 = z.infer<
  typeof ActivityMisconceptionEvidencePacketV1Schema
>;

export type ActivityMisconceptionEvidenceValidationIssue = {
  field_path: string;
  rule_code:
    | "schema_invalid"
    | "invalid_generation_source_metadata"
    | "deterministic_fixture_not_production_evaluation"
    | "deterministic_final_diagnostic_decision_used"
    | "answer_key_leak_detected"
    | "correct_option_value_leak_detected"
    | "correctness_label_detected"
    | "raw_distractor_metadata_exposed"
    | "raw_misconception_id_exposed"
    | "engagement_or_ai_label_exposed"
    | "raw_process_payload_exposed"
    | "raw_llm_output_exposed"
    | "secret_or_header_exposed"
    | "misconduct_language_detected"
    | "invalid_no_actionable_claim"
    | "process_context_only_misconception_claim"
    | "invalid_conceptual_entry_improvement_claim"
    | "generic_student_feedback_detected"
    | "missing_evidence_type"
    | "unsafe_student_facing_text";
  blocked_pattern_label?: string;
};

export type ActivityMisconceptionEvidenceFixtureInput = {
  case_id: string;
  activity_family: FormativeActivityFamily;
  selected_formative_value: FormativeValue;
  profile_condition: string;
  source_diagnostic_purpose: DiagnosticPurpose;
  response_kind: ActivityResponseKind;
  response_length_band: z.infer<typeof ResponseLengthBandSchema>;
  response_summary: string;
  primary_target: z.infer<typeof EvidenceTargetSchema>;
  secondary_targets?: Array<z.infer<typeof EvidenceTargetSchema>>;
  evidence_types: EvidenceElicitedType[];
  update_status: MisconceptionUpdateStatus;
  evidence_quality: ActivityEvidenceQuality;
  confidence?: z.infer<typeof ConfidenceSchema>;
  recommended_next_diagnostic_purpose?: z.infer<typeof RecommendedNextDiagnosticPurposeSchema>;
  activity_generation_source?: z.infer<typeof ActivityGenerationSourceSchema>;
  activity_runtime_servable_to_student?: boolean;
  evidence_flags?: Partial<ActivityMisconceptionEvidencePacketV1["evidence_elicited"]>;
  limitations?: string[];
  safe_internal_rationale?: string;
  student_safe_message?: string;
};

function nowIso() {
  return new Date().toISOString();
}

function hashJson(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function defaultStrongEvidence(primaryTarget: z.infer<typeof EvidenceTargetSchema>) {
  switch (primaryTarget) {
    case "basic_concept_distinction":
      return [
        "Student states the basic distinction in their own words.",
        "Student connects the distinction to the current concept without relying on option recognition."
      ];
    case "distractor_hidden_assumption":
      return [
        "Student explains why the distractor can feel tempting.",
        "Student identifies the hidden assumption and contrasts it with the target concept."
      ];
    case "target_boundary":
      return [
        "Student explains the boundary between target reasoning and distractor reasoning.",
        "Student names what changes when the hidden assumption is removed."
      ];
    case "reasoning_link":
      return [
        "Student repairs the missing reasoning link in a coherent sentence.",
        "Student explains how the repaired link changes the conclusion."
      ];
    case "independent_reconstruction":
      return [
        "Student reconstructs the idea in their own words without leaning on option labels.",
        "Student uses concept language that separates the target idea from the distractor path."
      ];
    case "generated_distractor_boundary":
      return [
        "Student generates a plausible alternative and explains why it is wrong or limited.",
        "Student uses the generated distractor to show the concept boundary."
      ];
  }
}

function defaultWeakEvidence() {
  return [
    "Student only says they understand now.",
    "Student repeats wording without explaining the assumption, boundary, or reasoning link.",
    "Student asks only a procedural question or gives an unrelated answer."
  ];
}

function defaultRecommendedNext(status: MisconceptionUpdateStatus) {
  switch (status) {
    case "conceptual_entry_gap_remains":
      return "conceptual_entry_grounding";
    case "conceptual_entry_improved":
    case "ready_for_distractor_probe":
      return "distractor_misconception_probe";
    case "misconception_persisted":
    case "misconception_weakened":
      return "reasoning_boundary_repair";
    case "boundary_understanding_improved":
    case "misconception_unsupported":
    case "no_actionable_misconception_evidence":
    case "independent_evidence_supported":
      return "move_on_or_exit";
    case "reasoning_boundary_still_blurred":
    case "insufficient_new_evidence":
      return "independent_misconception_verification";
    case "student_chose_move_on":
      return "move_on_or_exit";
    case "student_requested_alternative_activity":
      return "student_choice_needed";
  }
}

function defaultFeedback(status: MisconceptionUpdateStatus) {
  switch (status) {
    case "student_chose_move_on":
      return "You chose to move on. We can keep your progress and continue from here.";
    case "student_requested_alternative_activity":
      return "You asked for a different activity. We can switch to another safe way to work on the idea.";
    case "no_actionable_misconception_evidence":
    case "misconception_unsupported":
    case "independent_evidence_supported":
      return "Your response gives useful evidence for the current idea, so the next step can move forward without making a stronger claim than the evidence supports.";
    case "insufficient_new_evidence":
      return "Your response does not yet give enough new evidence to update the current interpretation.";
    default:
      return "Your response gives new evidence about the concept. The next step should use that evidence cautiously.";
  }
}

function defaultEvidenceFlags(
  input: ActivityMisconceptionEvidenceFixtureInput
): ActivityMisconceptionEvidencePacketV1["evidence_elicited"] {
  const has = (type: EvidenceElicitedType) => input.evidence_types.includes(type);
  return {
    elicited: !input.evidence_types.includes("none"),
    types: input.evidence_types.length > 0 ? input.evidence_types : ["none"],
    student_identified_why_distractor_is_tempting:
      has("distractor_tempting_reason_explained") ? "yes" : "not_applicable",
    student_identified_hidden_assumption:
      has("hidden_assumption_identified") ? "yes" : "not_applicable",
    student_explained_target_boundary:
      has("target_boundary_explained") ? "yes" : "not_applicable",
    student_reconstructed_concept_independently:
      has("independent_reconstruction_given") ? "yes" : "not_applicable",
    student_generated_plausible_distractor:
      has("generated_distractor_explained") ? "yes" : "not_applicable",
    student_repaired_reasoning_link:
      has("reasoning_link_repaired") ? "yes" : "not_applicable"
  };
}

export function buildNoLiveActivityMisconceptionEvidenceFixture(
  input: ActivityMisconceptionEvidenceFixtureInput
): ActivityMisconceptionEvidencePacketV1 {
  const evidenceFlags = {
    ...defaultEvidenceFlags(input),
    ...input.evidence_flags
  };

  return ActivityMisconceptionEvidencePacketV1Schema.parse({
    schema_version: ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION,
    evaluator_agent_name: ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
    evaluation_source: "no_live_fixture",
    runtime_servable_to_student: false,
    review_only: true,
    session_public_id: `sess_activity_misconception_${input.case_id}`,
    student_public_id: "student_activity_misconception_synthetic",
    assessment_public_id: "assessment_fixed_irt_synthetic",
    concept_unit_id: "concept_theta_invariance",
    activity_attempt_id: `activity_attempt_${input.case_id}`,
    source_activity_schema: FORMATIVE_ACTIVITY_SCHEMA_VERSION,
    source_activity_family: input.activity_family,
    source_diagnostic_purpose: input.source_diagnostic_purpose,
    source_activity_generation_source: input.activity_generation_source ?? "live_llm",
    source_activity_runtime_servable_to_student: input.activity_runtime_servable_to_student ?? true,
    student_activity_response: {
      response_kind: input.response_kind,
      response_length_band: input.response_length_band,
      student_response_text_redacted_or_safe_summary: input.response_summary,
      raw_response_stored_elsewhere: false
    },
    evidence_elicitation_target: {
      primary_target: input.primary_target,
      secondary_targets: input.secondary_targets ?? [],
      what_counts_as_strong_evidence: defaultStrongEvidence(input.primary_target),
      what_counts_as_weak_evidence: defaultWeakEvidence()
    },
    evidence_elicited: evidenceFlags,
    misconception_evidence_update: {
      status: input.update_status,
      evidence_quality: input.evidence_quality,
      confidence: input.confidence ?? (input.evidence_quality === "high" ? "high" : input.evidence_quality === "insufficient" ? "low" : "medium"),
      safe_internal_rationale:
        input.safe_internal_rationale ??
        `${input.case_id}: fixture-only rationale for ${input.update_status}; a future LLM evaluator must make production diagnostic judgments from redacted evidence.`,
      limitations: input.limitations ?? ["no_live_fixture_not_production_evaluation"]
    },
    recommended_next_diagnostic_purpose:
      input.recommended_next_diagnostic_purpose ?? defaultRecommendedNext(input.update_status),
    student_safe_feedback: {
      message: input.student_safe_message ?? defaultFeedback(input.update_status),
      next_options: ["continue", "choose another activity", "move on"]
    },
    safety_check: {
      answer_key_exposed: false,
      correct_option_value_exposed: false,
      correctness_label_exposed: false,
      raw_distractor_metadata_exposed: false,
      raw_misconception_id_exposed: false,
      engagement_or_ai_label_exposed: false,
      raw_process_payload_exposed: false,
      raw_llm_output_exposed: false,
      secret_or_header_exposed: false,
      deterministic_final_diagnostic_decision_used: false
    }
  });
}

const PROTECTED_TEXT_RULES: Array<{
  pattern: RegExp;
  rule_code: ActivityMisconceptionEvidenceValidationIssue["rule_code"];
  label: string;
}> = [
  { pattern: /\banswer key\b/i, rule_code: "answer_key_leak_detected", label: "answer_key_phrase" },
  { pattern: /\b(correct option|correct answer|correct choice)\b/i, rule_code: "correct_option_value_leak_detected", label: "correct_option_phrase" },
  { pattern: /\b(correct|incorrect)\b/i, rule_code: "correctness_label_detected", label: "correctness_label" },
  { pattern: /\bdistractor (metadata|rationale|diagnostic)\b/i, rule_code: "raw_distractor_metadata_exposed", label: "raw_distractor_metadata" },
  { pattern: /\bmisconception[_ -]?id\b|\bmis_[a-z0-9_]+\b/i, rule_code: "raw_misconception_id_exposed", label: "raw_misconception_id" },
  { pattern: /\b(engagement category|engagement profile|ai assistance|external assistance|genai)\b/i, rule_code: "engagement_or_ai_label_exposed", label: "engagement_or_ai_label" },
  { pattern: /\b(raw process|process payload|process data)\b/i, rule_code: "raw_process_payload_exposed", label: "raw_process_payload" },
  { pattern: /\b(raw llm|raw model|provider output|structured output)\b/i, rule_code: "raw_llm_output_exposed", label: "raw_llm_output" },
  { pattern: /\b(api key|authorization header|bearer token|session secret|database url)\b/i, rule_code: "secret_or_header_exposed", label: "secret_or_header" },
  { pattern: /\b(cheat|cheating|misconduct|integrity|authenticity|suspicious)\b/i, rule_code: "misconduct_language_detected", label: "misconduct_language" }
];

function pushIssue(
  issues: ActivityMisconceptionEvidenceValidationIssue[],
  field_path: string,
  rule_code: ActivityMisconceptionEvidenceValidationIssue["rule_code"],
  blocked_pattern_label?: string
) {
  issues.push({ field_path, rule_code, ...(blocked_pattern_label ? { blocked_pattern_label } : {}) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scanText(
  issues: ActivityMisconceptionEvidenceValidationIssue[],
  fieldPath: string,
  text: string
) {
  for (const rule of PROTECTED_TEXT_RULES) {
    if (rule.pattern.test(text)) {
      pushIssue(issues, fieldPath, rule.rule_code, rule.label);
    }
  }
  if (/\b(no|none|zero)\s+(misconceptions?|misconception evidence anywhere)\b/i.test(text)) {
    pushIssue(issues, fieldPath, "invalid_no_actionable_claim", "absence_of_all_misconceptions_claim");
  }
}

export function validateActivityMisconceptionEvidencePacket(value: unknown) {
  const schemaResult = ActivityMisconceptionEvidencePacketV1Schema.safeParse(value);
  const issues: ActivityMisconceptionEvidenceValidationIssue[] = [];

  if (isRecord(value)) {
    const safetyCheck = value.safety_check;
    if (isRecord(safetyCheck)) {
      for (const [key, flagValue] of Object.entries(safetyCheck)) {
        if (flagValue !== true) continue;
        if (key === "deterministic_final_diagnostic_decision_used") {
          pushIssue(issues, `safety_check.${key}`, "deterministic_final_diagnostic_decision_used");
          continue;
        }
        const ruleCodeByFlag: Record<string, ActivityMisconceptionEvidenceValidationIssue["rule_code"]> = {
          answer_key_exposed: "answer_key_leak_detected",
          correct_option_value_exposed: "correct_option_value_leak_detected",
          correctness_label_exposed: "correctness_label_detected",
          raw_distractor_metadata_exposed: "raw_distractor_metadata_exposed",
          raw_misconception_id_exposed: "raw_misconception_id_exposed",
          engagement_or_ai_label_exposed: "engagement_or_ai_label_exposed",
          raw_process_payload_exposed: "raw_process_payload_exposed",
          raw_llm_output_exposed: "raw_llm_output_exposed",
          secret_or_header_exposed: "secret_or_header_exposed"
        };
        const ruleCode = ruleCodeByFlag[key];
        if (ruleCode) {
          pushIssue(issues, `safety_check.${key}`, ruleCode);
        }
      }
    }
  }

  if (!schemaResult.success) {
    for (const issue of schemaResult.error.issues) {
      pushIssue(issues, issue.path.join(".") || "output", "schema_invalid");
    }
    return { valid: false as const, issues };
  }

  const packet = schemaResult.data;
  if (packet.evaluation_source === "no_live_fixture" && (!packet.review_only || packet.runtime_servable_to_student)) {
    pushIssue(issues, "evaluation_source", "invalid_generation_source_metadata", "no_live_fixture_must_be_review_only");
  }
  if ((packet.evaluation_source === "live_llm" || packet.evaluation_source === "live_llm_future") && packet.review_only) {
    pushIssue(issues, "evaluation_source", "deterministic_fixture_not_production_evaluation", "live_evaluator_output_must_not_be_review_only_for_production_update");
  }
  if (packet.evidence_elicited.types.length === 0 || packet.evidence_elicited.types.includes("none") && packet.evidence_elicited.types.length > 1) {
    pushIssue(issues, "evidence_elicited.types", "missing_evidence_type");
  }

  const textFields = [
    {
      field_path: "student_activity_response.student_response_text_redacted_or_safe_summary",
      text: packet.student_activity_response.student_response_text_redacted_or_safe_summary
    },
    {
      field_path: "misconception_evidence_update.safe_internal_rationale",
      text: packet.misconception_evidence_update.safe_internal_rationale
    },
    {
      field_path: "student_safe_feedback.message",
      text: packet.student_safe_feedback.message
    },
    ...packet.evidence_elicitation_target.what_counts_as_strong_evidence.map((text, index) => ({
      field_path: `evidence_elicitation_target.what_counts_as_strong_evidence.${index}`,
      text
    })),
    ...packet.evidence_elicitation_target.what_counts_as_weak_evidence.map((text, index) => ({
      field_path: `evidence_elicitation_target.what_counts_as_weak_evidence.${index}`,
      text
    }))
  ];

  for (const field of textFields) {
    scanText(issues, field.field_path, field.text);
  }

  const evidenceTypes = packet.evidence_elicited.types;
  const limitationsText = packet.misconception_evidence_update.limitations.join(" ");
  if (
    packet.misconception_evidence_update.status === "misconception_persisted" &&
    (!packet.evidence_elicited.elicited ||
      evidenceTypes.includes("none") ||
      /process_context_is_evidence_quality_context_only|no_direct_misconception_update_from_process_data/i.test(limitationsText))
  ) {
    pushIssue(
      issues,
      "misconception_evidence_update.status",
      "process_context_only_misconception_claim",
      "process_context_cannot_create_misconception_update"
    );
  }

  if (
    (packet.misconception_evidence_update.status === "conceptual_entry_improved" ||
      packet.misconception_evidence_update.status === "ready_for_distractor_probe") &&
    (!packet.evidence_elicited.elicited ||
      evidenceTypes.includes("none") ||
      /process_context_is_evidence_quality_context_only|no_direct_misconception_update_from_process_data/i.test(limitationsText))
  ) {
    pushIssue(
      issues,
      "misconception_evidence_update.status",
      "invalid_conceptual_entry_improvement_claim",
      "conceptual_entry_improvement_requires_response_evidence"
    );
  }

  if (
    packet.student_activity_response.response_kind === "low_information" &&
    (packet.misconception_evidence_update.status === "conceptual_entry_improved" ||
      packet.misconception_evidence_update.status === "ready_for_distractor_probe")
  ) {
    pushIssue(
      issues,
      "misconception_evidence_update.status",
      "invalid_conceptual_entry_improvement_claim",
      "low_information_response_cannot_improve_conceptual_entry"
    );
  }

  if (
    packet.student_activity_response.response_kind === "low_information" &&
    packet.misconception_evidence_update.status === "no_actionable_misconception_evidence"
  ) {
    pushIssue(
      issues,
      "misconception_evidence_update.status",
      "invalid_no_actionable_claim",
      "low_information_response_cannot_rule_out_actionable_evidence"
    );
  }

  if (
    packet.student_activity_response.response_kind === "low_information" &&
    /\b(i understand|understand now|got it|makes sense)\b/i.test(
      packet.student_activity_response.student_response_text_redacted_or_safe_summary
    ) &&
    packet.misconception_evidence_update.status === "no_actionable_misconception_evidence"
  ) {
    pushIssue(
      issues,
      "student_activity_response.student_response_text_redacted_or_safe_summary",
      "invalid_no_actionable_claim",
      "understand_now_is_not_misconception_resolution_evidence"
    );
  }

  if (
    /^(good job|nice work|great work|try again|review the concept|keep going)[.! ]*$/i.test(
      packet.student_safe_feedback.message.trim()
    )
  ) {
    pushIssue(
      issues,
      "student_safe_feedback.message",
      "generic_student_feedback_detected",
      "generic_feedback_without_diagnostic_next_step"
    );
  }

  return issues.length === 0
    ? { valid: true as const, issues: [] }
    : { valid: false as const, issues };
}

export function assertActivityMisconceptionEvidencePacketIsLiveEvaluatedForProductionUpdate(
  value: unknown
): asserts value is ActivityMisconceptionEvidencePacketV1 {
  const validation = validateActivityMisconceptionEvidencePacket(value);
  if (!validation.valid) {
    throw new Error("activity_misconception_evidence_packet_invalid");
  }
  const packet = ActivityMisconceptionEvidencePacketV1Schema.parse(value);
  if (packet.evaluation_source !== "live_llm" && packet.evaluation_source !== "live_llm_future") {
    throw new Error("activity_misconception_evidence_runtime_rejected_no_live_fixture");
  }
  if (packet.review_only) {
    throw new Error("activity_misconception_evidence_runtime_rejected_review_only_packet");
  }
  if (packet.safety_check.deterministic_final_diagnostic_decision_used) {
    throw new Error("activity_misconception_evidence_runtime_rejected_deterministic_decision");
  }
}

function redactedReviewArtifact(
  packet: ActivityMisconceptionEvidencePacketV1,
  validation: ReturnType<typeof validateActivityMisconceptionEvidencePacket>
) {
  return {
    artifact_version: ACTIVITY_MISCONCEPTION_EVIDENCE_REVIEW_ARTIFACT_VERSION,
    sample_id: `activity_misconception_review_${hashJson(packet).slice(0, 16)}`,
    generated_at: nowIso(),
    no_live_provider_call_made: true,
    schema_version: packet.schema_version,
    evaluator_agent_name: packet.evaluator_agent_name,
    evaluator_schema_version: ACTIVITY_RESPONSE_EVALUATOR_SCHEMA_VERSION,
    evaluation_source: packet.evaluation_source,
    runtime_servable_to_student: packet.runtime_servable_to_student,
    review_only: packet.review_only,
    session_public_id: packet.session_public_id,
    assessment_public_id: packet.assessment_public_id,
    concept_unit_id: packet.concept_unit_id,
    activity_attempt_id: packet.activity_attempt_id,
    source_activity_schema: packet.source_activity_schema,
    source_activity_family: packet.source_activity_family,
    source_diagnostic_purpose: packet.source_diagnostic_purpose,
    source_activity_generation_source: packet.source_activity_generation_source,
    source_activity_runtime_servable_to_student: packet.source_activity_runtime_servable_to_student,
    response_kind: packet.student_activity_response.response_kind,
    response_length_band: packet.student_activity_response.response_length_band,
    student_response_safe_summary: packet.student_activity_response.student_response_text_redacted_or_safe_summary,
    evidence_elicitation_target: packet.evidence_elicitation_target,
    evidence_elicited: packet.evidence_elicited,
    misconception_evidence_update: packet.misconception_evidence_update,
    recommended_next_diagnostic_purpose: packet.recommended_next_diagnostic_purpose,
    student_safe_feedback: validation.valid
      ? packet.student_safe_feedback
      : { message: "[REDACTED_UNSAFE_STUDENT_FEEDBACK]", next_options: packet.student_safe_feedback.next_options },
    safety_check: packet.safety_check,
    validation: {
      passed: validation.valid,
      issue_count: validation.issues.length,
      issues: validation.issues
    },
    limitations: [
      "no_live_fixture_not_production_evaluation",
      "substantive_production_update_requires_future_live_llm_evaluator",
      "deterministic_logic_used_only_for_schema_safety_audit_and_fixture_review"
    ]
  };
}

export async function writeRedactedActivityMisconceptionEvidenceReviewArtifact(input: {
  packets: ActivityMisconceptionEvidencePacketV1[];
  session_review?: unknown;
  output_dir?: string;
}) {
  const outputDir =
    input.output_dir ?? path.join(process.cwd(), ".data", "activity-misconception-evidence-review");
  await mkdir(outputDir, { recursive: true });
  const generatedAt = nowIso();
  const artifact = {
    artifact_version: ACTIVITY_MISCONCEPTION_EVIDENCE_REVIEW_ARTIFACT_VERSION,
    generated_at: generatedAt,
    no_live_provider_call_made: true,
    packet_count: input.packets.length,
    packets: input.packets.map((packet) =>
      redactedReviewArtifact(packet, validateActivityMisconceptionEvidencePacket(packet))
    ),
    session_review: input.session_review ?? null
  };
  const fileName = `activity-misconception-evidence-review-${generatedAt.replace(/[:.]/g, "-")}-${hashJson(artifact).slice(0, 8)}.json`;
  const artifactPath = path.join(outputDir, fileName);
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifactPath;
}
