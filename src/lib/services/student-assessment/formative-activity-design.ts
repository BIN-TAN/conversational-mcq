import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  FORMATIVE_VALUE_PACKET_SCHEMA_VERSION,
  buildFormativeValueDeterminationPacketForSession,
  type FormativeValue,
  type FormativeValueDeterminationPacketV1
} from "@/lib/services/student-assessment/formative-value-determination";
import {
  PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
  buildProfileIntegrationInterpretationPacketForSession,
  type ProfileIntegrationInterpretationPacketV1,
  type ProfileIntegrationPattern
} from "@/lib/services/student-assessment/profile-integration";

export const FORMATIVE_ACTIVITY_SCHEMA_VERSION = "student-formative-activity-v1" as const;
export const FORMATIVE_ACTIVITY_AGENT_NAME = "formative_activity_dialogue_agent" as const;
export const FORMATIVE_ACTIVITY_REVIEW_ARTIFACT_VERSION =
  "formative-activity-review-v1" as const;
export const FORMATIVE_ACTIVITY_DETERMINISTIC_BUILDER_REVIEW_ONLY = true as const;
export const DETERMINISTIC_ACTIVITY_OUTPUT_MUST_NOT_BE_STUDENT_RUNTIME = true as const;

export const FormativeActivityFamilySchema = z.enum([
  "basic_concept_grounding",
  "distractor_contrast",
  "reasoning_chain_repair",
  "independent_reconstruction",
  "confidence_evidence_audit",
  "transfer_and_distractor_generation"
]);

const FormativeActivityModeSchema = z.literal("complete_explanation_plus_dialogue");
const EvidenceGoalSchema = z.enum([
  "clarify_gap",
  "test_misconception",
  "refine_reasoning",
  "calibrate_confidence",
  "verify_independent_understanding",
  "support_transfer"
]);
const DistractorRoleSchema = z.enum([
  "selected_distractor",
  "tempting_distractor",
  "contrast_distractor",
  "reactivation_distractor",
  "generated_distractor",
  "none"
]);
const MessageStructureStepSchema = z.enum([
  "profile_link",
  "concept_explanation",
  "response_connection",
  "distractor_contrast",
  "next_student_action"
]);
const ExpectedStudentActionTypeSchema = z.enum([
  "explain_in_own_words",
  "compare_distractor",
  "identify_assumption",
  "revise_reasoning",
  "rate_confidence_again",
  "apply_to_near_transfer",
  "generate_distractor"
]);
const StudentSafeProfileStatusSchema = z.enum([
  "Mostly understood",
  "Still developing",
  "Needs more work"
]);
const FormativeValueSchema = z.enum([
  "diagnostic_clarification",
  "reasoning_refinement",
  "confidence_calibration",
  "independent_understanding_verification",
  "consolidation_and_transfer"
]);
const FormativeActivityGenerationSourceSchema = z.enum([
  "deterministic_review",
  "live_llm"
]);

export const FormativeActivityPacketV1Schema = z.object({
  schema_version: z.literal(FORMATIVE_ACTIVITY_SCHEMA_VERSION),
  agent_name: z.literal(FORMATIVE_ACTIVITY_AGENT_NAME),
  // Phase 29a deterministic packets are review-only QA artifacts. Runtime
  // student activity output must come from a future live_llm activity agent.
  generation_source: FormativeActivityGenerationSourceSchema,
  runtime_servable_to_student: z.boolean(),
  review_only: z.boolean(),
  session_public_id: z.string().min(1),
  student_public_id: z.string().min(1),
  assessment_public_id: z.string().min(1),
  concept_unit_id: z.string().min(1),
  generated_at: z.string().datetime(),
  source_profile_integration_schema: z.literal(PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION),
  source_formative_value_schema: z.literal(FORMATIVE_VALUE_PACKET_SCHEMA_VERSION),
  source_profile_integration_snapshot_id: z.string().min(1),
  source_formative_value_packet_id: z.string().min(1),
  selected_formative_value: FormativeValueSchema,
  activity_family: FormativeActivityFamilySchema,
  activity_mode: FormativeActivityModeSchema,
  activity_goal: z.object({
    student_safe_goal: z.string().min(1).max(420),
    internal_goal: z.string().min(1).max(700),
    evidence_goal: EvidenceGoalSchema
  }).strict(),
  personalization_basis: z.object({
    uses_selected_option: z.boolean(),
    uses_reasoning_summary: z.boolean(),
    uses_confidence: z.boolean(),
    uses_tempting_option: z.boolean(),
    uses_distractor_diagnostics: z.boolean(),
    uses_engagement_context_internally: z.boolean(),
    student_safe_profile_status: StudentSafeProfileStatusSchema
  }).strict(),
  distractor_use: z.object({
    distractor_role: DistractorRoleSchema,
    student_safe_description: z.string().min(1).max(520),
    internal_diagnostic_reference_present: z.boolean(),
    must_not_reveal_answer_key: z.literal(true)
  }).strict(),
  first_turn: z.object({
    message: z.string().min(1).max(2600),
    message_structure: z.array(MessageStructureStepSchema).min(3).max(5),
    allow_long_explanation: z.literal(true),
    must_be_specific: z.literal(true),
    must_connect_to_student_response: z.literal(true),
    must_connect_to_distractor_when_relevant: z.literal(true),
    must_end_with_one_prompt: z.literal(true)
  }).strict(),
  dialogue_protocol: z.object({
    max_turns_before_summary: z.literal(3),
    student_can_choose_another_activity: z.literal(true),
    student_can_move_on: z.literal(true),
    after_each_student_response_update_evidence: z.literal(true),
    final_turn_collects_evidence: z.literal(true)
  }).strict(),
  expected_student_action: z.object({
    action_type: ExpectedStudentActionTypeSchema,
    prompt: z.string().min(1).max(420)
  }).strict(),
  evidence_update_plan: z.object({
    update_ability_evidence: z.literal(true),
    update_engagement_evidence: z.literal(true),
    update_profile_integration: z.literal(true),
    update_formative_value: z.literal(true),
    requires_student_response_before_update: z.literal(true),
    production_update_not_implemented_in_phase_29a: z.literal(true)
  }).strict(),
  student_choice_policy: z.object({
    can_continue_activity: z.literal(true),
    can_choose_another_activity: z.literal(true),
    can_move_on: z.literal(true),
    override_is_allowed: z.literal(true),
    override_is_recorded: z.literal(true)
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
    activity_generates_new_item: z.literal(false)
  }).strict()
}).strict();

export type FormativeActivityFamily = z.infer<typeof FormativeActivityFamilySchema>;
export type FormativeActivityPacketV1 = z.infer<typeof FormativeActivityPacketV1Schema>;
type StudentChoiceInput = {
  choice: "not_chosen" | "accepted_recommendation" | "chose_alternative" | "moved_on";
  preferred_activity_family?: FormativeActivityFamily;
};
export type FormativeActivityValidationIssue = {
  field_path: string;
  rule_code:
    | "schema_invalid"
    | "generic_feedback_detected"
    | "template_splice_artifact"
    | "internal_evidence_label_exposed"
    | "generic_feedback"
    | "missing_concept_focus"
    | "missing_concept_explanation"
    | "missing_concrete_concept_explanation"
    | "missing_response_connection"
    | "missing_next_student_action"
    | "missing_family_specific_content"
    | "missing_non_null_student_safe_profile_status"
    | "missing_concrete_distractor_description"
    | "template_colon_splice"
    | "label_sentence_duplication"
    | "missing_basic_concept_depth"
    | "missing_hidden_assumption"
    | "missing_transfer_or_generation_logic"
    | "weak_generic_tempting_alternative"
    | "family_metadata_missing"
    | "invalid_generation_source_metadata"
    | "multiple_or_missing_prompts"
    | "missing_student_prompt"
    | "multiple_student_prompts"
    | "duplicate_first_turn_and_action_prompt"
    | "missing_distractor_contrast"
    | "fake_distractor_contrast"
    | "missing_student_safe_profile_status"
    | "broken_concept_focus"
    | "impersonal_student_reference"
    | "answer_key_leak_detected"
    | "correct_option_leak_detected"
    | "correctness_label_detected"
    | "distractor_metadata_detected"
    | "misconception_id_exposed"
    | "raw_reasoning_exposed"
    | "raw_process_payload_exposed"
    | "raw_llm_output_exposed"
    | "secret_or_header_exposed"
    | "engagement_or_ai_label_exposed"
    | "unsupported_integrity_language_detected"
    | "low_participation_language_detected"
    | "new_scored_item_generated"
    | "unstructured_wall_of_text"
    | "missing_student_response_update_gate"
    | "unsafe_safety_flag";
  blocked_pattern_label?: string;
};

type FormativeActivityDesignInput = {
  session_public_id: string;
  student_public_id: string;
  assessment_public_id: string;
  concept_unit_id: string;
  source_profile_integration_snapshot_id: string;
  source_formative_value_packet_id: string;
  selected_formative_value: FormativeValue;
  profile_integration_pattern: ProfileIntegrationPattern;
  student_safe_profile_status: ProfileIntegrationInterpretationPacketV1["student_facing_status"];
  concept_focus: string;
  response_connection_summary: string;
  reasoning_summary: string;
  confidence_summary: string;
  selected_option_summary?: string;
  tempting_option_summary?: string;
  distractor_contrast_summary?: string;
  distractor_diagnostics_available?: boolean;
  selected_distractor_present?: boolean;
  tempting_distractor_present?: boolean;
  underconfidence_present?: boolean;
  reliability_limited?: boolean;
  uses_engagement_context_internally?: boolean;
  student_preference?: StudentChoiceInput;
};

type ActivitySelection = {
  activity_family: FormativeActivityFamily;
  evidence_goal: z.infer<typeof EvidenceGoalSchema>;
  action_type: z.infer<typeof ExpectedStudentActionTypeSchema>;
  distractor_role: z.infer<typeof DistractorRoleSchema>;
  mapping_rationale: string[];
};

const ACTIVITY_GOALS: Record<FormativeActivityFamily, string> = {
  basic_concept_grounding:
    "Build a clearer starting point for the concept before asking for a short explanation in the student's own words.",
  distractor_contrast:
    "Contrast the target idea with a tempting alternative reasoning path so the student can name the boundary.",
  reasoning_chain_repair:
    "Help the student repair one missing link in the explanation and then restate the reasoning more completely.",
  independent_reconstruction:
    "Give the student a chance to express the idea without relying on option choice or recognition.",
  confidence_evidence_audit:
    "Help the student connect confidence to evidence from their reasoning instead of to a feeling alone.",
  transfer_and_distractor_generation:
    "Extend the current understanding to a nearby situation while keeping the task unscored."
};

const FAMILY_INTERNAL_GOALS: Record<FormativeActivityFamily, string> = {
  basic_concept_grounding:
    "Clarify a likely gap or insufficient evidence with a complete explanation and one evidence-producing prompt.",
  distractor_contrast:
    "Use the selected or tempting alternative as a diagnostic reasoning path without revealing scoring metadata.",
  reasoning_chain_repair:
    "Repair incomplete reasoning by making the skipped conceptual link explicit and asking for a revision.",
  independent_reconstruction:
    "Collect a fresh in-platform expression of understanding before any profile or formative-value update.",
  confidence_evidence_audit:
    "Calibrate confidence against evidence only when understanding evidence is adequate enough for that focus.",
  transfer_and_distractor_generation:
    "Support near transfer and possible student-generated plausible alternative reasoning without creating a scored item."
};

const FORBIDDEN_STUDENT_TEXT_RULES: Array<{
  pattern: RegExp;
  rule_code: FormativeActivityValidationIssue["rule_code"];
  label: string;
}> = [
  { pattern: /\banswer key\b/i, rule_code: "answer_key_leak_detected", label: "answer_key_language" },
  { pattern: /\bcorrect option\b/i, rule_code: "correct_option_leak_detected", label: "correct_option_language" },
  { pattern: /\b(correct|incorrect)\s+(answer|choice|option)\b/i, rule_code: "correctness_label_detected", label: "correctness_option_label" },
  { pattern: /\b(is|was)\s+(correct|incorrect)\b/i, rule_code: "correctness_label_detected", label: "correctness_judgment" },
  { pattern: /\bdistractor metadata\b/i, rule_code: "distractor_metadata_detected", label: "distractor_metadata_label" },
  { pattern: /\bmisconception[_ -]?id\b/i, rule_code: "misconception_id_exposed", label: "misconception_id_label" },
  { pattern: /\braw reasoning\b/i, rule_code: "raw_reasoning_exposed", label: "raw_reasoning_label" },
  { pattern: /\braw process\b/i, rule_code: "raw_process_payload_exposed", label: "raw_process_label" },
  { pattern: /\braw llm\b|\braw model\b|\bprovider output\b/i, rule_code: "raw_llm_output_exposed", label: "raw_provider_label" },
  { pattern: /\b(api key|authorization header|bearer token|session secret|database url)\b/i, rule_code: "secret_or_header_exposed", label: "secret_or_header_label" },
  { pattern: /\b(engagement category|ai assistance|external assistance signal|process data)\b/i, rule_code: "engagement_or_ai_label_exposed", label: "engagement_ai_label" },
  { pattern: /\b(ability evidence|ability[- ]packet|packet confidence|confidence alignment in the ability packet|profile integration|formative value|formative value packet)\b/i, rule_code: "internal_evidence_label_exposed", label: "internal_evidence_label" },
  { pattern: /\b(cheating|misconduct|integrity|authenticity|suspicious)\b/i, rule_code: "unsupported_integrity_language_detected", label: "integrity_language" },
  { pattern: /\b(low engagement|disengaged|low participation|low task participation)\b/i, rule_code: "low_participation_language_detected", label: "low_participation_language" },
  { pattern: /\b(create|generate|write|make|give|answer)\s+(a\s+)?(new\s+)?(scored|graded)\s+(item|question|task)\b|\bscore this\b/i, rule_code: "new_scored_item_generated", label: "new_scored_item_language" }
];

const TEMPLATE_SPLICE_RULES = [
  { pattern: /:\s+(Your|The|This|It)\b/, label: "colon_sentence_splice" },
  { pattern: /\b(The missing link is that\s+The)\b/, label: "missing_link_capitalized_sentence_splice" },
  { pattern: /\b(is the idea we need to make clearer:\s+in this assessment)\b/i, label: "concept_label_colon_splice" },
  { pattern: /,\s+your\s+/i, label: "comma_repeats_your_clause" },
  { pattern: /summary is that\s+the current evidence/i, label: "summary_is_that_current_evidence" },
  { pattern: /because\s+confidence evidence/i, label: "because_confidence_evidence" },
  { pattern: /the key idea is\s+focus on/i, label: "key_idea_focus_on" },
  { pattern: /in your earlier responses,\s+your responses/i, label: "earlier_responses_your_responses" }
];

const LABEL_SENTENCE_DUPLICATION_RULES = [
  { pattern: /\bYour earlier responses suggest[^.?!]*:\s+Your\b/i, label: "earlier_responses_suggests_your" },
  { pattern: /\bYour earlier responses show[^.?!]*:\s+Your\b/i, label: "earlier_responses_show_your" },
  { pattern: /\bYour earlier responses give[^.?!]*:\s+Your\b/i, label: "earlier_responses_give_your" },
  { pattern: /\bYour earlier responses point[^.?!]*:\s+Your\b/i, label: "earlier_responses_point_your" },
  { pattern: /\bThe missing link is that\s+The\b/i, label: "missing_link_the_sentence" }
];

const INTERNAL_PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bcurrent ability evidence is interpreted as\b/gi, "your current work suggests"],
  [/\bability evidence\b/gi, "your work"],
  [/\bability[- ]packet confidence\b/gi, "how clear the current pattern is"],
  [/\bpacket confidence\b/gi, "how clear the current pattern is"],
  [/\bconfidence alignment in the ability packet\b/gi, "how your confidence lines up with your explanation"],
  [/\bprofile integration\b/gi, "the current review"],
  [/\bformative value packet\b/gi, "the current focus"],
  [/\bformative value\b/gi, "the current focus"],
  [/\bengagement category\b/gi, "participation context"],
  [/\bai assistance signal\b/gi, "context"],
  [/\bprocess data\b/gi, "timing context"],
  [/\bthe student appears\b/gi, "you seem"]
];

function nowIso() {
  return new Date().toISOString();
}

function hashJson(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function stableId(prefix: string, value: unknown) {
  return `${prefix}_${hashJson(value).slice(0, 16)}`;
}

function normalizeConceptFocus(value: string | null | undefined) {
  const trimmed = sanitizeStudentSafeSummary(value, "").replace(/[.?!]+$/g, "").trim();
  const strippedInstruction = trimmed
    .replace(/^focus on\s+/i, "")
    .replace(/^explaining\s+/i, "")
    .replace(/^explain\s+/i, "")
    .replace(/\s+in your own words\b/i, "")
    .trim();

  if (!strippedInstruction || strippedInstruction.length < 4) {
    return "the key distinction in this concept";
  }
  if (/^(focus on|explain|explaining)\b/i.test(trimmed)) {
    if (/key distinction/i.test(strippedInstruction)) {
      return "the key distinction in this concept";
    }
    return strippedInstruction.slice(0, 180);
  }
  if (/^(task|question|prompt)$/i.test(strippedInstruction)) {
    return "the key distinction in this concept";
  }
  return strippedInstruction.slice(0, 180);
}

function safeSummary(value: string | null | undefined, fallback: string, maxLength = 260) {
  return sanitizeStudentSafeSummary(value, fallback, maxLength);
}

function stripTerminalPunctuation(text: string) {
  return text.replace(/[.?!]+$/g, "").trim();
}

function lowerInitial(text: string) {
  const trimmed = text.trim();
  return trimmed.length === 0 ? trimmed : `${trimmed[0].toLowerCase()}${trimmed.slice(1)}`;
}

function safeSentence(value: string | null | undefined, fallback: string, maxLength = 260) {
  return stripTerminalPunctuation(safeSummary(value, fallback, maxLength));
}

function responsePatternPhrase(value: string | null | undefined) {
  const sentence = safeSentence(value, "this boundary needs more support", 220);
  if (/basic boundary is still forming/i.test(sentence)) {
    return "the basic boundary is still forming";
  }
  if (/tempting alternative is pulling two ideas together/i.test(sentence)) {
    return "a tempting alternative is pulling the person-side and item-side ideas together";
  }
  if (/useful start but needs one clearer connection/i.test(sentence)) {
    return "your reasoning has a useful start, but the connection between the ideas needs to be clearer";
  }
  if (/explanation unclear enough/i.test(sentence)) {
    return "the explanation is not clear enough yet to show exactly how you connect the ideas";
  }
  if (/enough substance to check confidence/i.test(sentence)) {
    return "your explanation has enough substance to check confidence against what you wrote";
  }
  if (/stable base for extending the concept/i.test(sentence)) {
    return "your answers give a stable base for extending the concept";
  }
  if (/needs more work before it is stable/i.test(sentence)) {
    return "the concept boundary still needs more work before it is stable";
  }
  return lowerInitial(sentence);
}

function reasoningEvidencePhrase(value: string | null | undefined) {
  const sentence = safeSentence(value, "your explanation needs one clearer connection", 260);
  if (/names theta and item information but does not yet separate their roles/i.test(sentence)) {
    return "your explanation names theta and item information, but it does not yet separate their roles";
  }
  if (/mixes a person's estimated ability with the information provided by the item/i.test(sentence)) {
    return "your explanation mixes the person's estimated ability with the information provided by the item";
  }
  if (/points toward theta but skips the link to item information/i.test(sentence)) {
    return "your explanation points toward theta, but it skips the link to item information";
  }
  if (/responses vary between option recognition and a partial concept explanation/i.test(sentence)) {
    return "your responses vary between recognizing an option and explaining the concept directly";
  }
  if (/separates the person-side estimate from the item-side information/i.test(sentence)) {
    return "your explanation separates the person-side estimate from item-side information";
  }
  if (/keeps the person-side estimate separate from item information/i.test(sentence)) {
    return "your explanation keeps the person-side estimate separate from item information";
  }
  return lowerInitial(sentence);
}

function confidenceEvidencePhrase(value: string | null | undefined) {
  const sentence = safeSentence(value, "your confidence can be checked against your explanation", 220);
  if (/cautious even though the explanation gives usable evidence/i.test(sentence)) {
    return "you were cautious even though your explanation gives usable evidence";
  }
  if (/confidence can be checked against the explanation/i.test(sentence)) {
    return "your confidence can be checked against the explanation you give";
  }
  return lowerInitial(sentence);
}

function sanitizeStudentSafeSummary(value: string | null | undefined, fallback: string, maxLength = 260) {
  let normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  for (const [pattern, replacement] of INTERNAL_PHRASE_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  normalized = normalized
    .replace(/\bthe current evidence concerns\b/gi, "your work is about")
    .replace(/\bconfidence evidence\b/gi, "your confidence")
    .replace(/\bevidence is retained only as internal interpretation context\b/gi, "this is background context")
    .replace(/\bsynthetic\b/gi, "sample")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized.length > 0 ? normalized : fallback).slice(0, maxLength);
}

function sentenceCase(text: string) {
  const trimmed = text.trim();
  return trimmed.length === 0 ? trimmed : `${trimmed[0].toUpperCase()}${trimmed.slice(1)}`;
}

function selectedFormativeValue(packet: FormativeValueDeterminationPacketV1): FormativeValue {
  const selected = packet.student_choice_state.selected_value;
  return selected && selected !== "move_on" ? selected : packet.primary_value;
}

function hasTemptingOptionSummary(input: FormativeActivityDesignInput) {
  return Boolean(input.tempting_option_summary && input.tempting_option_summary.trim().length > 0);
}

function activitySelectionFor(input: FormativeActivityDesignInput): ActivitySelection {
  const rationale: string[] = [];
  let activity_family: FormativeActivityFamily;

  if (
    input.student_preference?.choice === "chose_alternative" &&
    input.student_preference.preferred_activity_family &&
    isBackupFamilyAllowed(input, input.student_preference.preferred_activity_family)
  ) {
    activity_family = input.student_preference.preferred_activity_family;
    rationale.push("student_preference_selected_allowed_backup_family");
  } else if (
    input.selected_formative_value === "diagnostic_clarification" &&
    input.profile_integration_pattern === "likely_misconception"
  ) {
    activity_family = "distractor_contrast";
    rationale.push("diagnostic_clarification_with_likely_misconception");
  } else if (
    input.selected_formative_value === "diagnostic_clarification" &&
    input.profile_integration_pattern === "insufficient_evidence" &&
    input.reliability_limited
  ) {
    activity_family = "independent_reconstruction";
    rationale.push("diagnostic_clarification_with_insufficient_reliability_limited_evidence");
  } else if (input.selected_formative_value === "diagnostic_clarification") {
    activity_family = "basic_concept_grounding";
    rationale.push("diagnostic_clarification_requires_basic_concept_access");
  } else if (
    input.selected_formative_value === "reasoning_refinement" &&
    input.profile_integration_pattern === "likely_misconception"
  ) {
    activity_family = "distractor_contrast";
    rationale.push("reasoning_refinement_with_likely_misconception");
  } else if (input.selected_formative_value === "reasoning_refinement") {
    activity_family = "reasoning_chain_repair";
    rationale.push("reasoning_refinement_with_developing_or_partial_reasoning");
  } else if (input.selected_formative_value === "confidence_calibration") {
    activity_family = "confidence_evidence_audit";
    rationale.push("confidence_calibration_with_adequate_understanding_evidence");
  } else if (input.selected_formative_value === "independent_understanding_verification") {
    activity_family = "independent_reconstruction";
    rationale.push("independent_understanding_verification_requires_fresh_student_expression");
  } else {
    activity_family = "transfer_and_distractor_generation";
    rationale.push("consolidation_and_transfer_with_stable_understanding");
  }

  if (input.student_preference?.choice === "moved_on") {
    rationale.push("student_move_on_is_allowed_by_policy_not_forced_by_activity");
  }

  const distractor_role = distractorRoleForSafe(input, activity_family);
  return {
    activity_family,
    evidence_goal: evidenceGoalFor(activity_family),
    action_type: actionTypeFor(activity_family),
    distractor_role,
    mapping_rationale: rationale
  };
}

function isBackupFamilyAllowed(input: FormativeActivityDesignInput, family: FormativeActivityFamily) {
  if (family === "transfer_and_distractor_generation") {
    return input.selected_formative_value === "consolidation_and_transfer";
  }
  if (family === "confidence_evidence_audit") {
    return input.selected_formative_value === "confidence_calibration" || input.underconfidence_present === true;
  }
  return true;
}

function distractorRoleForSafe(
  input: FormativeActivityDesignInput,
  family: FormativeActivityFamily
): z.infer<typeof DistractorRoleSchema> {
  if (family === "transfer_and_distractor_generation") return "generated_distractor";
  if (family === "distractor_contrast") {
    if (hasTemptingOptionSummary(input)) return "tempting_distractor";
    if (input.selected_distractor_present) return "selected_distractor";
    return "contrast_distractor";
  }
  if (family === "independent_reconstruction" && input.distractor_diagnostics_available) {
    return "reactivation_distractor";
  }
  if (family === "confidence_evidence_audit" && input.distractor_diagnostics_available) {
    return "contrast_distractor";
  }
  return "none";
}

function evidenceGoalFor(family: FormativeActivityFamily): z.infer<typeof EvidenceGoalSchema> {
  switch (family) {
    case "basic_concept_grounding":
      return "clarify_gap";
    case "distractor_contrast":
      return "test_misconception";
    case "reasoning_chain_repair":
      return "refine_reasoning";
    case "independent_reconstruction":
      return "verify_independent_understanding";
    case "confidence_evidence_audit":
      return "calibrate_confidence";
    case "transfer_and_distractor_generation":
      return "support_transfer";
  }
}

function actionTypeFor(family: FormativeActivityFamily): z.infer<typeof ExpectedStudentActionTypeSchema> {
  switch (family) {
    case "basic_concept_grounding":
    case "independent_reconstruction":
      return "explain_in_own_words";
    case "distractor_contrast":
      return "compare_distractor";
    case "reasoning_chain_repair":
      return "revise_reasoning";
    case "confidence_evidence_audit":
      return "rate_confidence_again";
    case "transfer_and_distractor_generation":
      return "apply_to_near_transfer";
  }
}

function expectedPromptFor(input: FormativeActivityDesignInput, selection: ActivitySelection) {
  const concept = normalizeConceptFocus(input.concept_focus);
  switch (selection.action_type) {
    case "compare_distractor":
      return "Can you compare those two ideas and name the assumption that makes the tempting alternative feel plausible?";
    case "revise_reasoning":
      return "Can you revise one sentence of your reasoning so it explains the missing link more clearly?";
    case "rate_confidence_again":
      return "Can you name one piece of evidence in your explanation and then rate your confidence again?";
    case "apply_to_near_transfer":
      return "Can you apply the same idea to a nearby practice example in your own words?";
    case "generate_distractor":
      return "Can you invent one plausible practice alternative and explain what assumption would make it tempting?";
    case "identify_assumption":
      return "Can you identify the assumption that separates your first idea from the target idea?";
    case "explain_in_own_words":
    default:
      return `Can you explain ${concept} in your own words using one detail from your earlier responses?`;
  }
}

function distractorDescriptionFor(input: FormativeActivityDesignInput, selection: ActivitySelection) {
  const contrast = safeSummary(
    input.distractor_contrast_summary ?? input.tempting_option_summary,
    "A tempting alternative treats item difficulty or item information as if it directly gives the person's ability estimate.",
    360
  );

  switch (selection.distractor_role) {
    case "selected_distractor":
      return `The selected alternative is used as a student-safe contrast point because ${stripTerminalPunctuation(contrast)}.`;
    case "tempting_distractor":
      return `The tempting alternative treats item difficulty or item information as interchangeable with the person's estimated ability. It can feel plausible because the item response is the observed evidence.`;
    case "contrast_distractor":
      return `A plausible alternative reasoning path treats item information and person ability as interchangeable, which clarifies the target concept boundary.`;
    case "reactivation_distractor":
      return `A plausible alternative reasoning path is reactivated to check whether the student can separate item information from the person's ability estimate.`;
    case "generated_distractor":
      return "The activity asks for a plausible unscored practice alternative that mixes person ability with item information, so the student can show the concept boundary in a nearby situation without creating a scored assessment item.";
    case "none":
      return "No distractor contrast is required for this activity family.";
  }
}

function firstTurnParts(input: FormativeActivityDesignInput, selection: ActivitySelection) {
  const concept = normalizeConceptFocus(input.concept_focus);
  const responseConnection = responsePatternPhrase(input.response_connection_summary);
  const reasoning = reasoningEvidencePhrase(input.reasoning_summary);
  const confidence = confidenceEvidencePhrase(input.confidence_summary);
  const distractorContrast = safeSentence(
    input.distractor_contrast_summary ?? input.tempting_option_summary,
    "the tempting alternative treats item information and the person's estimated ability as interchangeable",
    360
  );
  const prompt = expectedPromptFor(input, selection);

  switch (selection.activity_family) {
    case "basic_concept_grounding":
      return [
        "Let's start with the basic distinction.",
        "Theta describes where a person seems to be on an ability scale.",
        "Item parameters describe features of the item, such as how difficult or informative the item is.",
        "Responses connect the two because an item response gives evidence for estimating theta, but theta and item information are not the same object.",
        "A useful contrast is a thermometer. The reading tells us something about the room, but the thermometer's sensitivity is not the room's temperature.",
        `Your earlier work suggests ${responseConnection} before we add more complexity.`,
        prompt
      ];
    case "distractor_contrast":
      return [
        "Let's use the tempting alternative to sharpen the idea instead of just moving past it.",
        "One tempting alternative treats the item's difficulty or information as if it directly tells us the person's ability.",
        "That can feel reasonable because the item response is what we observe first.",
        "The hidden assumption is that item information and person ability are interchangeable.",
        "The target idea keeps them separate. The item provides evidence, while theta describes the person's estimated location on the ability scale.",
        `Your earlier work suggests ${responseConnection}.`,
        prompt
      ];
    case "reasoning_chain_repair":
      return [
        "Let's keep the useful part of your reasoning and repair the missing link.",
        `${sentenceCase(concept)} depends on connecting the person-side estimate to the item-side information without treating them as identical.`,
        `Your earlier explanation already has a useful starting point because ${responseConnection}.`,
        `The missing link is how evidence from item responses supports an estimate of ability while remaining different from the item features themselves.`,
        `When that link is skipped, the tempting alternative becomes plausible because ${distractorContrast}.`,
        prompt
      ];
    case "independent_reconstruction":
      return [
        "Let's set the option choices aside for a moment and rebuild the idea in your own words.",
        `${sentenceCase(concept)} is easier to check when you explain the relationship directly instead of leaning on recognition from the choices.`,
        "The reason for setting the options aside is that the current evidence is mixed or unclear, so a fresh explanation gives a cleaner view of your thinking.",
        `Your earlier work suggests ${responseConnection}.`,
        "This is a chance to show the concept in your own language before we decide what kind of support is useful.",
        prompt
      ];
    case "confidence_evidence_audit":
      return [
        "Let's connect your confidence to the evidence in your own explanation.",
        `${sentenceCase(concept)} is already partly supported when you can separate the person-side estimate from item-side information.`,
        `Your earlier work suggests there is usable understanding to check because ${responseConnection}.`,
        `One piece of evidence is that ${reasoning}.`,
        `Low confidence can be worth checking when the explanation has some solid pieces but still feels uncertain; here, ${confidence}.`,
        prompt
      ];
    case "transfer_and_distractor_generation":
      return [
        "Let's extend the idea carefully.",
        `${sentenceCase(concept)} can transfer to a nearby situation when you keep person ability and item information in separate roles.`,
        "Transfer means using the same distinction in a new example, not memorizing the wording from this one.",
        "Distractor generation means creating a plausible wrong alternative that shows where the concept boundary is, not trying to trick anyone.",
        `Your earlier work suggests ${responseConnection}, so this can be an unscored way to test whether the distinction holds in a nearby example.`,
        "This is not another scored question.",
        prompt
      ];
  }
}

// Review-only deterministic prose for schema, validator, fixture, and redaction QA.
// This must never be served as production student activity dialogue.
export function buildDeterministicFormativeActivityFirstTurnForReviewOnly(
  input: FormativeActivityDesignInput,
  selection = activitySelectionFor(input)
) {
  return {
    message: firstTurnParts(input, selection).join(" "),
    message_structure: [
      "profile_link",
      "concept_explanation",
      "response_connection",
      ...(selection.distractor_role !== "none" ? ["distractor_contrast" as const] : []),
      "next_student_action"
    ],
    allow_long_explanation: true as const,
    must_be_specific: true as const,
    must_connect_to_student_response: true as const,
    must_connect_to_distractor_when_relevant: true as const,
    must_end_with_one_prompt: true as const
  };
}

export const buildDeterministicFormativeActivityFirstTurn =
  buildDeterministicFormativeActivityFirstTurnForReviewOnly;

function inputFromPackets(input: {
  profile_integration_packet: ProfileIntegrationInterpretationPacketV1;
  formative_value_packet: FormativeValueDeterminationPacketV1;
  student_preference?: StudentChoiceInput;
}): FormativeActivityDesignInput {
  const profile = input.profile_integration_packet;
  const formative = input.formative_value_packet;
  const selectedValue = selectedFormativeValue(formative);
  const misconceptionSignal =
    profile.integration_pattern === "likely_misconception" ||
    profile.ability_interpretation.misconception_claim_strength === "moderate" ||
    profile.ability_interpretation.misconception_claim_strength === "strong";

  return {
    session_public_id: formative.session_public_id,
    student_public_id: formative.student_public_id,
    assessment_public_id: formative.assessment_public_id,
    concept_unit_id: formative.concept_unit_id,
    source_profile_integration_snapshot_id: formative.source_profile_integration_snapshot_id,
    source_formative_value_packet_id: stableId("fv", formative),
    selected_formative_value: selectedValue,
    profile_integration_pattern: profile.integration_pattern,
    student_safe_profile_status: profile.student_facing_status,
    concept_focus: profile.student_safe_message.knowledge_focus,
    response_connection_summary: profile.student_safe_message.message,
    reasoning_summary: profile.ability_interpretation.summary,
    confidence_summary: profile.ability_interpretation.confidence_calibration_summary,
    distractor_diagnostics_available: misconceptionSignal,
    selected_distractor_present: misconceptionSignal && profile.ability_interpretation.evidence_consistency !== "insufficient",
    tempting_distractor_present: misconceptionSignal,
    tempting_option_summary: misconceptionSignal
      ? "A tempting option appears to reflect a plausible but incomplete version of the concept boundary."
      : undefined,
    distractor_contrast_summary: misconceptionSignal
      ? "it treats the person's estimated ability and the item's difficulty or information as if they were interchangeable"
      : undefined,
    reliability_limited:
      profile.integration_pattern === "mixed_or_conflicting_evidence" ||
      profile.integration_pattern === "insufficient_evidence" ||
      profile.engagement_context.ai_assistance_effect_on_interpretation === "contextualizes_reasoning_evidence",
    underconfidence_present:
      formative.primary_value === "confidence_calibration" ||
      /underconfident|low confidence|not confident/i.test(profile.ability_interpretation.confidence_calibration_summary),
    uses_engagement_context_internally:
      profile.engagement_context.engagement_effect_on_interpretation !== "insufficient_evidence" ||
      profile.engagement_context.ai_assistance_effect_on_interpretation !== "insufficient_evidence",
    student_preference: input.student_preference
  };
}

export function buildFormativeActivityDesignPacketFromPackets(input: {
  profile_integration_packet: ProfileIntegrationInterpretationPacketV1;
  formative_value_packet: FormativeValueDeterminationPacketV1;
  student_preference?: StudentChoiceInput;
}): FormativeActivityPacketV1 {
  const designInput = inputFromPackets(input);
  const selection = activitySelectionFor(designInput);
  const firstTurn = buildDeterministicFormativeActivityFirstTurnForReviewOnly(designInput, selection);
  const expectedPrompt = expectedPromptFor(designInput, selection);

  return FormativeActivityPacketV1Schema.parse({
    schema_version: FORMATIVE_ACTIVITY_SCHEMA_VERSION,
    agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
    generation_source: "deterministic_review",
    runtime_servable_to_student: false,
    review_only: true,
    session_public_id: designInput.session_public_id,
    student_public_id: designInput.student_public_id,
    assessment_public_id: designInput.assessment_public_id,
    concept_unit_id: designInput.concept_unit_id,
    generated_at: nowIso(),
    source_profile_integration_schema: PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
    source_formative_value_schema: FORMATIVE_VALUE_PACKET_SCHEMA_VERSION,
    source_profile_integration_snapshot_id: designInput.source_profile_integration_snapshot_id,
    source_formative_value_packet_id: designInput.source_formative_value_packet_id,
    selected_formative_value: designInput.selected_formative_value,
    activity_family: selection.activity_family,
    activity_mode: "complete_explanation_plus_dialogue",
    activity_goal: {
      student_safe_goal: ACTIVITY_GOALS[selection.activity_family],
      internal_goal: `${FAMILY_INTERNAL_GOALS[selection.activity_family]} Mapping rationale: ${selection.mapping_rationale.join("; ")}.`,
      evidence_goal: selection.evidence_goal
    },
    personalization_basis: {
      uses_selected_option: Boolean(designInput.selected_option_summary || designInput.selected_distractor_present),
      uses_reasoning_summary: true,
      uses_confidence: true,
      uses_tempting_option: hasTemptingOptionSummary(designInput),
      uses_distractor_diagnostics: selection.distractor_role !== "none",
      uses_engagement_context_internally: Boolean(designInput.uses_engagement_context_internally),
      student_safe_profile_status: designInput.student_safe_profile_status
    },
    distractor_use: {
      distractor_role: selection.distractor_role,
      student_safe_description: distractorDescriptionFor(designInput, selection),
      internal_diagnostic_reference_present: selection.distractor_role !== "none",
      must_not_reveal_answer_key: true
    },
    first_turn: firstTurn,
    dialogue_protocol: {
      max_turns_before_summary: 3,
      student_can_choose_another_activity: true,
      student_can_move_on: true,
      after_each_student_response_update_evidence: true,
      final_turn_collects_evidence: true
    },
    expected_student_action: {
      action_type: selection.action_type,
      prompt: expectedPrompt
    },
    evidence_update_plan: {
      update_ability_evidence: true,
      update_engagement_evidence: true,
      update_profile_integration: true,
      update_formative_value: true,
      requires_student_response_before_update: true,
      production_update_not_implemented_in_phase_29a: true
    },
    student_choice_policy: {
      can_continue_activity: true,
      can_choose_another_activity: true,
      can_move_on: true,
      override_is_allowed: true,
      override_is_recorded: true
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
      activity_generates_new_item: false
    }
  });
}

export async function buildFormativeActivityDesignPacketForSession(
  sessionPublicId: string
): Promise<FormativeActivityPacketV1> {
  const profileIntegrationPacket = await buildProfileIntegrationInterpretationPacketForSession(
    sessionPublicId,
    { execution_mode: "deterministic_mock" }
  );
  const formativeValuePacket = await buildFormativeValueDeterminationPacketForSession(
    sessionPublicId,
    { execution_mode: "deterministic_mock" }
  );

  return buildFormativeActivityDesignPacketFromPackets({
    profile_integration_packet: profileIntegrationPacket,
    formative_value_packet: formativeValuePacket
  });
}

export function assertFormativeActivityPacketIsNotReviewOnlyForRuntime(
  value: unknown
): asserts value is FormativeActivityPacketV1 {
  const parsed = FormativeActivityPacketV1Schema.safeParse(value);
  if (!parsed.success) {
    throw new Error("formative_activity_runtime_packet_invalid_schema");
  }

  const packet = parsed.data;
  if (packet.generation_source === "deterministic_review") {
    throw new Error("formative_activity_runtime_rejected_deterministic_review_packet");
  }
  if (packet.review_only) {
    throw new Error("formative_activity_runtime_rejected_review_only_packet");
  }
  if (!packet.runtime_servable_to_student) {
    throw new Error("formative_activity_runtime_rejected_nonservable_packet");
  }

  const validation = validateFormativeActivityPacket(packet);
  if (!validation.valid) {
    throw new Error("formative_activity_runtime_packet_failed_validation");
  }
}

function pushIssue(
  issues: FormativeActivityValidationIssue[],
  field_path: string,
  rule_code: FormativeActivityValidationIssue["rule_code"],
  blocked_pattern_label?: string
) {
  issues.push({ field_path, rule_code, ...(blocked_pattern_label ? { blocked_pattern_label } : {}) });
}

function safeFieldEntries(packet: FormativeActivityPacketV1) {
  return [
    { path: "activity_goal.student_safe_goal", text: packet.activity_goal.student_safe_goal },
    { path: "distractor_use.student_safe_description", text: packet.distractor_use.student_safe_description },
    { path: "first_turn.message", text: packet.first_turn.message },
    { path: "expected_student_action.prompt", text: packet.expected_student_action.prompt }
  ];
}

function countPrompts(text: string) {
  return (text.match(/\?/g) ?? []).length;
}

function hasQuestionBeforeFinalPrompt(text: string) {
  return /\?\s+\S/.test(text.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function conceptToken(conceptFocus: string) {
  return conceptFocus
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .find((token) => token.length >= 5);
}

function hasConcreteConceptExplanation(text: string) {
  return (
    /\b(theta|ability scale|estimated ability|person's estimated ability|person ability)\b/i.test(text) &&
    /\b(item|item information|item parameter|difficulty|information)\b/i.test(text)
  ) || /\bkey distinction in this concept\b/i.test(text);
}

function hasConcreteDistractorContrast(text: string) {
  const hasTemptingAlternative = /\b(tempting alternative|tempting option|plausible alternative)\b/i.test(text);
  const hasHiddenAssumption = /\bhidden assumption|assumption\b/i.test(text);
  const hasConcreteBoundary =
    /\b(person|ability|ability scale|estimated ability)\b[\s\S]{0,160}\b(item|difficulty|information)\b/i.test(text) ||
    /\b(item|difficulty|information)\b[\s\S]{0,160}\b(person|ability|ability scale|estimated ability)\b/i.test(text) ||
    /\binterchangeable|swapped|keeps them separate\b/i.test(text);
  return hasTemptingAlternative && hasHiddenAssumption && hasConcreteBoundary;
}

function sentenceCount(text: string) {
  return text
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function basicConceptExplanationSentenceCount(text: string) {
  return text
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter((sentence) =>
      /\b(theta|ability scale|estimated ability|person ability|item parameters|item information|difficulty|informative|responses connect|item response)\b/i.test(sentence)
    ).length;
}

function hasConcreteDistractorDescription(text: string) {
  return (
    text.trim().length >= 80 &&
    /\b(item|difficulty|information|item response)\b/i.test(text) &&
    /\b(person|ability|theta|ability estimate|ability scale)\b/i.test(text) &&
    /\b(interchangeable|separate|boundary|evidence|plausible|observed)\b/i.test(text)
  );
}

function familyContentPassed(packet: FormativeActivityPacketV1) {
  const text = packet.first_turn.message;
  switch (packet.activity_family) {
    case "basic_concept_grounding":
      return (
        /\b(basic distinction|basic boundary|key distinction|core distinction)\b/i.test(text) &&
        basicConceptExplanationSentenceCount(text) >= 3 &&
        /\bthermometer\b/i.test(text) &&
        /\bin your own words\b/i.test(packet.expected_student_action.prompt)
      );
    case "distractor_contrast":
      return (
        hasConcreteDistractorContrast(text) &&
        /\bhidden assumption\b/i.test(text) &&
        hasConcreteDistractorDescription(packet.distractor_use.student_safe_description)
      );
    case "reasoning_chain_repair":
      return /\buseful (part|starting point)\b/i.test(text) &&
        /\bmissing link\b/i.test(text) &&
        /\b(tempting alternative|tempting option|plausible alternative)\b/i.test(text);
    case "independent_reconstruction":
      return /\b(set|sets|setting) the option choices aside\b/i.test(text) &&
        /\bcurrent evidence is mixed or unclear\b/i.test(text) &&
        /\bin your own words\b/i.test(text);
    case "confidence_evidence_audit":
      return /\bconfidence\b/i.test(text) && /\bevidence\b/i.test(text) && /\busable understanding\b/i.test(text) && /\blow confidence can be worth checking\b/i.test(text);
    case "transfer_and_distractor_generation":
      return (
        /\bnot another scored question\b/i.test(text) &&
        /\bTransfer means\b/.test(text) &&
        /\bDistractor generation means\b/.test(text) &&
        /\bnearby (situation|example)\b/i.test(text)
      );
  }
}

export function validateFormativeActivityPacket(value: unknown) {
  const schemaResult = FormativeActivityPacketV1Schema.safeParse(value);
  const issues: FormativeActivityValidationIssue[] = [];

  if (isRecord(value)) {
    const personalization = value.personalization_basis;
    if (isRecord(personalization)) {
      const status = personalization.student_safe_profile_status;
      if (status === null || status === undefined || status === "None") {
        pushIssue(issues, "personalization_basis.student_safe_profile_status", "missing_non_null_student_safe_profile_status");
      }
    }
    const distractorUse = value.distractor_use;
    const family = value.activity_family;
    if (family === "distractor_contrast" && isRecord(distractorUse)) {
      const role = distractorUse.distractor_role;
      const description = distractorUse.student_safe_description;
      if (role === null || role === undefined || role === "none" || role === "None") {
        pushIssue(issues, "distractor_use.distractor_role", "family_metadata_missing", "distractor_family_missing_role");
      }
      if (typeof description !== "string" || !hasConcreteDistractorDescription(description)) {
        pushIssue(issues, "distractor_use.student_safe_description", "missing_concrete_distractor_description");
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
  const message = packet.first_turn.message;
  const lowerMessage = message.toLowerCase();

  if (
    packet.generation_source === "deterministic_review" &&
    (!packet.review_only || packet.runtime_servable_to_student)
  ) {
    pushIssue(issues, "generation_source", "invalid_generation_source_metadata", "deterministic_review_must_be_review_only");
  }
  if (
    packet.generation_source === "live_llm" &&
    (packet.review_only || !packet.runtime_servable_to_student)
  ) {
    pushIssue(issues, "generation_source", "invalid_generation_source_metadata", "live_llm_must_be_runtime_servable");
  }

  if (/good job|review the concept|try again|study more/i.test(message)) {
    pushIssue(issues, "first_turn.message", "generic_feedback", "generic_feedback");
  }
  for (const rule of TEMPLATE_SPLICE_RULES) {
    if (rule.pattern.test(message)) {
      pushIssue(issues, "first_turn.message", "template_splice_artifact", rule.label);
    }
  }
  for (const rule of LABEL_SENTENCE_DUPLICATION_RULES) {
    if (rule.pattern.test(message)) {
      pushIssue(issues, "first_turn.message", "label_sentence_duplication", rule.label);
    }
  }
  if (/:\s+(Your|The|This|It)\b/.test(message)) {
    pushIssue(issues, "first_turn.message", "template_colon_splice", "colon_before_sentence");
  }
  if (/\bthe student appears\b/i.test(message)) {
    pushIssue(issues, "first_turn.message", "impersonal_student_reference", "the_student_appears");
  }
  if (/\bfocus on\b/i.test(message) || /\bfocus on\b/i.test(packet.expected_student_action.prompt)) {
    pushIssue(issues, "first_turn.message", "broken_concept_focus", "focus_on_instruction");
  }
  if (!hasConcreteConceptExplanation(message)) {
    pushIssue(issues, "first_turn.message", "missing_concrete_concept_explanation");
  }
  if (!/\b(the key idea is|a useful way to think|the core idea is|the main boundary|the basic distinction|one part describes|one side is about|one part of the explanation|depends on connecting|already partly supported|easier to check|the target idea keeps|responses connect the two|transfer means)\b/i.test(message)) {
    pushIssue(issues, "first_turn.message", "missing_concept_explanation");
  }
  if (!/\b(your earlier responses|your prior responses|your earlier thinking|your earlier work|your earlier explanation)\b/i.test(message)) {
    pushIssue(issues, "first_turn.message", "missing_response_connection");
  }
  if (!familyContentPassed(packet)) {
    pushIssue(issues, "first_turn.message", "missing_family_specific_content", packet.activity_family);
  }
  if (
    packet.activity_family === "basic_concept_grounding" &&
    (basicConceptExplanationSentenceCount(message) < 3 || sentenceCount(message) < 6)
  ) {
    pushIssue(issues, "first_turn.message", "missing_basic_concept_depth");
  }
  if (packet.activity_family === "distractor_contrast" && !/\bhidden assumption\b/i.test(message)) {
    pushIssue(issues, "first_turn.message", "missing_hidden_assumption");
  }
  if (
    packet.activity_family === "distractor_contrast" &&
    /\btempting alternative\b/i.test(message) &&
    !/\b(item|difficulty|information|person|ability|theta|interchangeable|observed)\b/i.test(message)
  ) {
    pushIssue(issues, "first_turn.message", "weak_generic_tempting_alternative");
  }
  if (
    packet.activity_family === "transfer_and_distractor_generation" &&
    (!/\bTransfer means\b/.test(message) || !/\bDistractor generation means\b/.test(message))
  ) {
    pushIssue(issues, "first_turn.message", "missing_transfer_or_generation_logic");
  }
  const firstTurnPromptCount = countPrompts(message);
  if (firstTurnPromptCount === 0 || !message.trim().endsWith("?")) {
    pushIssue(issues, "first_turn.message", "missing_student_prompt");
  } else if (firstTurnPromptCount > 1 || hasQuestionBeforeFinalPrompt(message)) {
    pushIssue(issues, "first_turn.message", "multiple_student_prompts");
  }

  const expectedActionPromptCount = countPrompts(packet.expected_student_action.prompt);
  if (
    expectedActionPromptCount > 1 ||
    (expectedActionPromptCount === 1 && !packet.expected_student_action.prompt.trim().endsWith("?"))
  ) {
    pushIssue(issues, "expected_student_action.prompt", "multiple_student_prompts");
  }
  if (!packet.first_turn.message_structure.includes("next_student_action")) {
    pushIssue(issues, "first_turn.message_structure", "missing_next_student_action");
  }
  const focus = conceptToken(packet.expected_student_action.prompt) ?? conceptToken(packet.first_turn.message);
  if (focus && !lowerMessage.includes(focus)) {
    pushIssue(issues, "first_turn.message", "missing_concept_focus");
  }
  if (
    packet.distractor_use.distractor_role !== "none" &&
    !hasConcreteDistractorContrast(message) &&
    packet.distractor_use.distractor_role !== "generated_distractor"
  ) {
    pushIssue(issues, "first_turn.message", "fake_distractor_contrast");
  }
  if (
    packet.distractor_use.distractor_role !== "none" &&
    !hasConcreteDistractorDescription(packet.distractor_use.student_safe_description)
  ) {
    pushIssue(issues, "distractor_use.student_safe_description", "missing_concrete_distractor_description");
  }
  if (
    packet.activity_family === "distractor_contrast" &&
    packet.distractor_use.distractor_role === "none"
  ) {
    pushIssue(issues, "distractor_use.distractor_role", "family_metadata_missing", "distractor_contrast_without_role");
  }
  if (
    packet.distractor_use.distractor_role !== "none" &&
    !/(estimated ability|ability scale|item|difficulty|information|concept boundary|alternative reasoning|interchangeable)/i.test(packet.distractor_use.student_safe_description)
  ) {
    pushIssue(issues, "distractor_use.student_safe_description", "fake_distractor_contrast", "generic_distractor_description");
  }
  if (!StudentSafeProfileStatusSchema.safeParse(packet.personalization_basis.student_safe_profile_status).success) {
    pushIssue(issues, "personalization_basis.student_safe_profile_status", "missing_student_safe_profile_status");
  }
  if (message.length > 2200 && countPrompts(message) === 0) {
    pushIssue(issues, "first_turn.message", "unstructured_wall_of_text");
  }
  if (
    !packet.evidence_update_plan.requires_student_response_before_update ||
    !packet.evidence_update_plan.production_update_not_implemented_in_phase_29a
  ) {
    pushIssue(issues, "evidence_update_plan", "missing_student_response_update_gate");
  }

  for (const entry of safeFieldEntries(packet)) {
    for (const rule of FORBIDDEN_STUDENT_TEXT_RULES) {
      if (rule.pattern.test(entry.text)) {
        pushIssue(issues, entry.path, rule.rule_code, rule.label);
      }
    }
  }

  for (const [key, value] of Object.entries(packet.safety_check)) {
    if (value !== false) {
      pushIssue(issues, `safety_check.${key}`, "unsafe_safety_flag");
    }
  }

  return issues.length === 0
    ? { valid: true as const, packet, issues }
    : { valid: false as const, issues };
}

function redactedReviewArtifact(packet: FormativeActivityPacketV1, validation: ReturnType<typeof validateFormativeActivityPacket>) {
  return {
    artifact_version: FORMATIVE_ACTIVITY_REVIEW_ARTIFACT_VERSION,
    sample_id: stableId("formative_activity_sample", {
      session_public_id: packet.session_public_id,
      activity_family: packet.activity_family,
      selected_formative_value: packet.selected_formative_value,
      source_formative_value_packet_id: packet.source_formative_value_packet_id
    }),
    generation_source: packet.generation_source,
    runtime_servable_to_student: packet.runtime_servable_to_student,
    review_only: packet.review_only,
    generated_at: nowIso(),
    schema_version: packet.schema_version,
    session_public_id: packet.session_public_id,
    assessment_public_id: packet.assessment_public_id,
    concept_unit_id: packet.concept_unit_id,
    selected_formative_value: packet.selected_formative_value,
    activity_family: packet.activity_family,
    activity_mode: packet.activity_mode,
    student_safe_profile_status: packet.personalization_basis.student_safe_profile_status,
    distractor_role: packet.distractor_use.distractor_role,
    distractor_student_safe_description: packet.distractor_use.student_safe_description,
    activity_goal: {
      student_safe_goal: packet.activity_goal.student_safe_goal,
      evidence_goal: packet.activity_goal.evidence_goal
    },
    distractor_use: {
      distractor_role: packet.distractor_use.distractor_role,
      student_safe_description: packet.distractor_use.student_safe_description
    },
    first_turn: validation.valid ? packet.first_turn : {
      message: "[REDACTED_UNSAFE_FIRST_TURN]",
      message_structure: packet.first_turn.message_structure
    },
    expected_student_action: packet.expected_student_action,
    dialogue_protocol: packet.dialogue_protocol,
    evidence_update_plan: packet.evidence_update_plan,
    student_choice_policy: packet.student_choice_policy,
    quality_check: {
      passed: validation.valid,
      issue_count: validation.issues.length,
      issues: validation.issues
    },
    safety_check: {
      answer_key_exposed: packet.safety_check.answer_key_exposed,
      option_solution_value_exposed: packet.safety_check.correct_option_value_exposed,
      correctness_label_exposed: packet.safety_check.correctness_label_exposed,
      raw_option_diagnostic_metadata_exposed: packet.safety_check.raw_distractor_metadata_exposed,
      raw_diagnostic_identifier_exposed: packet.safety_check.raw_misconception_id_exposed,
      engagement_or_ai_label_exposed: packet.safety_check.engagement_or_ai_label_exposed,
      raw_process_context_exposed: packet.safety_check.raw_process_payload_exposed,
      raw_provider_text_exposed: packet.safety_check.raw_llm_output_exposed,
      secret_or_header_exposed: packet.safety_check.secret_or_header_exposed,
      activity_generates_new_item: packet.safety_check.activity_generates_new_item
    },
    limitations: [
      "phase_29a_no_live_provider_dispatch",
      "phase_29a_no_runtime_ui_integration",
      "phase_29a_profile_update_requires_future_student_response"
    ]
  };
}

export async function writeRedactedFormativeActivityReviewArtifact(input: {
  packet: FormativeActivityPacketV1;
  output_dir?: string;
}) {
  const validation = validateFormativeActivityPacket(input.packet);
  const outputDir =
    input.output_dir ?? path.join(process.cwd(), ".data", "formative-activity-review");
  await mkdir(outputDir, { recursive: true });
  const fileName = `${input.packet.session_public_id}-${Date.now()}-${hashJson(input.packet).slice(0, 8)}.json`;
  const artifactPath = path.join(outputDir, fileName);
  await writeFile(
    artifactPath,
    `${JSON.stringify(redactedReviewArtifact(input.packet, validation), null, 2)}\n`,
    "utf8"
  );
  return artifactPath;
}
