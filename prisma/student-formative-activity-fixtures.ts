import {
  FORMATIVE_VALUE_PACKET_SCHEMA_VERSION,
  FormativeValueDeterminationPacketV1Schema,
  type FormativeValue,
  type FormativeValueDeterminationPacketV1
} from "../src/lib/services/student-assessment/formative-value-determination";
import {
  PROFILE_INTEGRATION_AGENT_NAME,
  PROFILE_INTEGRATION_AGENT_VERSION,
  PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
  PROFILE_INTEGRATION_PROMPT_VERSION,
  ProfileIntegrationInterpretationPacketV1Schema,
  type ProfileIntegrationInterpretationPacketV1,
  type ProfileIntegrationPattern
} from "../src/lib/services/student-assessment/profile-integration";

const FORMATIVE_VALUE_LABELS: Record<FormativeValue, string> = {
  diagnostic_clarification: "Diagnostic clarification",
  reasoning_refinement: "Reasoning refinement",
  confidence_calibration: "Confidence calibration",
  independent_understanding_verification: "Independent understanding verification",
  consolidation_and_transfer: "Consolidation and transfer"
};

type StudentSafeStatus = ProfileIntegrationInterpretationPacketV1["student_facing_status"];
type StatusConfidence = ProfileIntegrationInterpretationPacketV1["status_confidence"];

function nowIso() {
  return new Date().toISOString();
}

function statusForPattern(pattern: ProfileIntegrationPattern): StudentSafeStatus {
  if (pattern === "stable_understanding") return "Mostly understood";
  if (pattern === "likely_knowledge_gap" || pattern === "insufficient_evidence") return "Needs more work";
  return "Still developing";
}

function supportsForPattern(
  pattern: ProfileIntegrationPattern
): ProfileIntegrationInterpretationPacketV1["evidence_rationale"][number]["supports"] {
  if (pattern === "likely_knowledge_gap") return "knowledge_gap";
  if (pattern === "likely_misconception") return "misconception";
  if (pattern === "mixed_or_conflicting_evidence") return "mixed_evidence";
  return pattern;
}

function reasonForValue(value: FormativeValue) {
  switch (value) {
    case "diagnostic_clarification":
      return "knowledge_gap";
    case "reasoning_refinement":
      return "reasoning_partial";
    case "confidence_calibration":
      return "underconfident_adequate_reasoning";
    case "independent_understanding_verification":
      return "mixed_evidence";
    case "consolidation_and_transfer":
      return "stable_understanding";
  }
}

function alternativesFor(value: FormativeValue) {
  return (Object.keys(FORMATIVE_VALUE_LABELS) as FormativeValue[])
    .filter((alternative) => alternative !== value)
    .slice(0, 2)
    .map((alternative) => ({
      value: alternative,
      label: FORMATIVE_VALUE_LABELS[alternative],
      student_safe_reason: "This is another possible focus if the student chooses it."
    }));
}

export function buildSyntheticProfileIntegrationPacket(input: {
  session_public_id?: string;
  pattern: ProfileIntegrationPattern;
  status?: StudentSafeStatus;
  status_confidence?: StatusConfidence;
  evidence_consistency?: ProfileIntegrationInterpretationPacketV1["ability_interpretation"]["evidence_consistency"];
  knowledge_focus?: string;
  student_message?: string;
  ability_summary?: string;
  confidence_summary?: string;
  misconception_strength?: ProfileIntegrationInterpretationPacketV1["ability_interpretation"]["misconception_claim_strength"];
  knowledge_gap_strength?: ProfileIntegrationInterpretationPacketV1["ability_interpretation"]["knowledge_gap_claim_strength"];
  reliability_limited?: boolean;
  ai_assistance_context?: boolean;
}): ProfileIntegrationInterpretationPacketV1 {
  const status = input.status ?? statusForPattern(input.pattern);
  const misconceptionStrength =
    input.misconception_strength ??
    (input.pattern === "likely_misconception" ? "moderate" : "insufficient_evidence");
  const knowledgeGapStrength =
    input.knowledge_gap_strength ??
    (input.pattern === "likely_knowledge_gap" ? "moderate" : "insufficient_evidence");

  return ProfileIntegrationInterpretationPacketV1Schema.parse({
    agent_name: PROFILE_INTEGRATION_AGENT_NAME,
    agent_version: PROFILE_INTEGRATION_AGENT_VERSION,
    prompt_version: PROFILE_INTEGRATION_PROMPT_VERSION,
    schema_version: PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
    output_status: "ok",
    generation_mode: "deterministic_mock",
    session_public_id: input.session_public_id ?? `sess_activity_${input.pattern}`,
    student_public_id: "student_activity_synthetic",
    assessment_public_id: "assessment_activity_synthetic",
    concept_unit_id: "concept_theta_invariance",
    generated_at: nowIso(),
    source_packets: {
      ability_evidence_packet_schema: "ability-evidence-packet-v1",
      engagement_evidence_packet_schema: "engagement-evidence-packet-v1"
    },
    internal_integrated_status: input.pattern === "insufficient_evidence" ? "Insufficient evidence" : status,
    student_facing_status: status,
    status_confidence: input.status_confidence ?? "medium",
    integration_pattern: input.pattern,
    ability_interpretation: {
      summary:
        input.ability_summary ??
        "The student's explanation is about the distinction between a person's estimated ability and item parameter information.",
      evidence_consistency:
        input.evidence_consistency ??
        (input.pattern === "stable_understanding" ? "consistent" : "mixed"),
      main_conceptual_issue:
        input.pattern === "stable_understanding"
          ? null
          : "The concept boundary between person ability estimates and item information needs clarification.",
      misconception_claim_strength: misconceptionStrength,
      knowledge_gap_claim_strength: knowledgeGapStrength,
      confidence_calibration_summary:
        input.confidence_summary ??
        "Confidence can be checked against the explanation the student gives.",
      limitations: input.reliability_limited ? ["synthetic_reliability_limited_context"] : ["synthetic_fixture"]
    },
    engagement_context: {
      summary: "Engagement evidence is retained only as internal interpretation context.",
      engagement_category: "moderately_engaged",
      engagement_effect_on_interpretation: input.reliability_limited ? "lowers_confidence" : "supports_interpretation",
      ai_assistance_signal: input.ai_assistance_context
        ? "likely_external_assistance_pattern"
        : "insufficient_evidence",
      ai_assistance_effect_on_interpretation: input.ai_assistance_context
        ? "contextualizes_reasoning_evidence"
        : "insufficient_evidence",
      limitations: ["synthetic_engagement_context"]
    },
    evidence_rationale: [{
      claim_type: "ability",
      claim: "Synthetic evidence supports this integration pattern for no-live activity design.",
      supports: supportsForPattern(input.pattern),
      strength: input.status_confidence ?? "medium"
    }],
    uncertainty_and_limitations: ["synthetic_no_live_fixture"],
    student_safe_message: {
      status,
      message:
        input.student_message ??
        "Your answers suggest this idea is still forming and can be strengthened with a focused explanation.",
      knowledge_focus:
        input.knowledge_focus ??
        "the distinction between theta as a student ability estimate and item parameters"
    },
    teacher_research_summary: {
      safe_internal_summary: "Synthetic profile integration summary for formative activity design.",
      evidence_trace_summary: [`integration_pattern=${input.pattern}`]
    },
    safety_check: {
      answer_key_exposed: false,
      correct_option_value_exposed: false,
      distractor_metadata_exposed: false,
      misconception_ids_exposed_to_student_projection: false,
      raw_reasoning_exposed: false,
      raw_process_payload_exposed: false,
      raw_llm_output_exposed: false,
      api_key_or_secret_exposed: false,
      unsupported_integrity_claim_present: false,
      instructional_direction_present: false,
      activity_recommendation_present: false,
      engagement_label_exposed_to_student_projection: false,
      ai_assistance_label_exposed_to_student_projection: false
    }
  });
}

export function buildSyntheticFormativeValuePacket(input: {
  profile: ProfileIntegrationInterpretationPacketV1;
  primary_value: FormativeValue;
  selected_value?: FormativeValue | "move_on" | null;
  student_choice?: "not_chosen" | "accepted_recommendation" | "chose_alternative" | "moved_on";
}): FormativeValueDeterminationPacketV1 {
  const selectedValue =
    input.selected_value === undefined
      ? null
      : input.selected_value;

  return FormativeValueDeterminationPacketV1Schema.parse({
    schema_version: FORMATIVE_VALUE_PACKET_SCHEMA_VERSION,
    session_public_id: input.profile.session_public_id,
    student_public_id: input.profile.student_public_id,
    assessment_public_id: input.profile.assessment_public_id,
    concept_unit_id: input.profile.concept_unit_id,
    generated_at: nowIso(),
    source_profile_integration_schema: input.profile.schema_version,
    source_profile_integration_snapshot_id: `profile_snapshot_${input.profile.integration_pattern}`,
    primary_value: input.primary_value,
    primary_value_label: FORMATIVE_VALUE_LABELS[input.primary_value],
    primary_value_confidence: input.profile.status_confidence,
    rationale: {
      student_safe_summary: "This focus is selected from the current profile interpretation.",
      teacher_research_summary: "Synthetic formative value packet for no-live activity design.",
      evidence_basis: [{
        source: "profile_integration",
        reason_code: reasonForValue(input.primary_value),
        strength: input.profile.status_confidence
      }],
      limitations: ["synthetic_formative_value_packet"]
    },
    secondary_considerations: [],
    alternative_values: alternativesFor(input.primary_value),
    student_choice_policy: {
      can_accept_recommendation: true,
      can_choose_alternative: true,
      can_move_on: true,
      override_is_allowed: true,
      override_is_recorded: true
    },
    student_choice_state: {
      recommendation_presented: true,
      student_choice: input.student_choice ?? "not_chosen",
      selected_value: selectedValue,
      student_override: input.student_choice === "chose_alternative" || input.student_choice === "moved_on",
      chosen_at: input.student_choice ? nowIso() : null
    },
    implementation_guidance_for_next_stage: {
      allow_detailed_explanation: true,
      avoid_hard_length_limit: true,
      suggested_explanation_depth: "moderate",
      must_remain_personalized: true,
      activity_planning_not_included: true
    },
    student_safe_message: {
      recommended_value_label: FORMATIVE_VALUE_LABELS[input.primary_value],
      why_this_focus: "This focus matches the current evidence without exposing internal labels.",
      choice_prompt: "You can continue with this focus, choose another focus, or move on."
    },
    safety_check: {
      answer_key_exposed: false,
      correct_option_value_exposed: false,
      distractor_metadata_exposed: false,
      misconception_ids_exposed_to_student: false,
      raw_reasoning_exposed: false,
      raw_process_payload_exposed: false,
      raw_llm_output_exposed: false,
      api_key_or_secret_exposed: false,
      engagement_or_ai_label_exposed_to_student: false,
      activity_recommendation_present: false,
      specific_task_generated: false
    }
  });
}

export function buildSyntheticActivitySourcePackets(input: {
  pattern: ProfileIntegrationPattern;
  primary_value: FormativeValue;
  session_public_id?: string;
  status?: StudentSafeStatus;
  status_confidence?: StatusConfidence;
  knowledge_focus?: string;
  student_message?: string;
  ability_summary?: string;
  confidence_summary?: string;
  reliability_limited?: boolean;
  ai_assistance_context?: boolean;
  selected_value?: FormativeValue | "move_on" | null;
  student_choice?: "not_chosen" | "accepted_recommendation" | "chose_alternative" | "moved_on";
}) {
  const profile = buildSyntheticProfileIntegrationPacket({
    pattern: input.pattern,
    session_public_id: input.session_public_id,
    status: input.status,
    status_confidence: input.status_confidence,
    knowledge_focus: input.knowledge_focus,
    student_message: input.student_message,
    ability_summary: input.ability_summary,
    confidence_summary: input.confidence_summary,
    reliability_limited: input.reliability_limited,
    ai_assistance_context: input.ai_assistance_context
  });
  const formative = buildSyntheticFormativeValuePacket({
    profile,
    primary_value: input.primary_value,
    selected_value: input.selected_value,
    student_choice: input.student_choice
  });

  return { profile, formative };
}
