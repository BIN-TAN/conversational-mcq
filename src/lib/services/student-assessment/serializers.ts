import type {
  Assessment,
  AssessmentSession,
  ConceptUnit,
  ConfidenceLevel,
  Item,
  ItemResponse,
  SessionStatus
} from "@prisma/client";

type SafeOptions = Array<{ label: string; text: string }>;

const forbiddenStudentKeys = new Set([
  "id",
  "correct_option",
  "correct_option_snapshot",
  "correctness",
  "distractor_rationales",
  "expected_reasoning_patterns",
  "possible_misconception_indicators",
  "administration_rules",
  "ability_profile",
  "engagement_profile",
  "integrated_diagnostic_profile",
  "formative_value",
  "formative_action_plan",
  "target_evidence",
  "success_criteria",
  "followup_prompt_constraints",
  "profile_update_triggers",
  "mapping_followed",
  "mapping_deviation_reason",
  "followup_action_type",
  "target_formative_value",
  "evidence_trigger_candidate",
  "should_offer_move_on",
  "off_topic_detected",
  "prompt_hash",
  "model_name",
  "agent_version",
  "prompt_version",
  "schema_version",
  "agent_call",
  "output_payload",
  "raw_output"
]);

function safeOptions(value: unknown): SafeOptions {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const label = typeof record.label === "string" ? record.label : "";
      const text = typeof record.text === "string" ? record.text : "";

      if (!label || !text) {
        return null;
      }

      return { label, text };
    })
    .filter((entry): entry is { label: string; text: string } => Boolean(entry));
}

export type StudentSafeItem = {
  item_public_id: string;
  item_order: number;
  item_stem: string;
  options: SafeOptions;
  item_version: number;
  existing_selected_option: string | null;
  existing_reasoning_text: string | null;
  existing_confidence_rating: ConfidenceLevel | null;
  no_tempting_option: boolean;
  tempting_option: string | null;
  tempting_option_reason: string | null;
  submission_state: "not_started" | "draft" | "missing_evidence_repair" | "submitted";
};

export function itemSubmissionState(
  response?: Pick<ItemResponse, "item_submitted_at" | "missing_evidence_repair_offered"> | null
): StudentSafeItem["submission_state"] {
  if (!response) {
    return "not_started";
  }

  if (response.item_submitted_at) {
    return "submitted";
  }

  if (response.missing_evidence_repair_offered) {
    return "missing_evidence_repair";
  }

  return "draft";
}

export function serializeStudentSafeItem(
  item: Pick<Item, "item_public_id" | "item_order" | "item_stem" | "options" | "version">,
  response?: Pick<
    ItemResponse,
    | "selected_option"
    | "reasoning_text"
    | "confidence_rating"
    | "item_submitted_at"
    | "missing_evidence_repair_offered"
  > | null,
  temptingOptionEvidence?: {
    no_tempting_option: boolean;
    tempting_option: string | null;
    tempting_option_reason: string | null;
  } | null
): StudentSafeItem {
  return {
    item_public_id: item.item_public_id,
    item_order: item.item_order,
    item_stem: item.item_stem,
    options: safeOptions(item.options),
    item_version: item.version,
    existing_selected_option: response?.selected_option ?? null,
    existing_reasoning_text: response?.reasoning_text ?? null,
    existing_confidence_rating: response?.confidence_rating ?? null,
    no_tempting_option: temptingOptionEvidence?.no_tempting_option ?? false,
    tempting_option: temptingOptionEvidence?.tempting_option ?? null,
    tempting_option_reason: temptingOptionEvidence?.tempting_option_reason ?? null,
    submission_state: itemSubmissionState(response)
  };
}

export function serializeStudentAssessment(
  assessment: Pick<Assessment, "assessment_public_id" | "title" | "description">
) {
  return {
    assessment_public_id: assessment.assessment_public_id,
    title: assessment.title,
    description: assessment.description
  };
}

export function serializeStudentConceptUnit(
  conceptUnit: Pick<ConceptUnit, "concept_unit_public_id" | "title" | "learning_objective">
) {
  return {
    concept_unit_public_id: conceptUnit.concept_unit_public_id,
    title: conceptUnit.title,
    learning_objective: conceptUnit.learning_objective
  };
}

export function serializeStudentSessionSummary(
  session: Pick<
    AssessmentSession,
    "session_public_id" | "status" | "current_phase" | "attempt_number"
  >
) {
  return {
    session_public_id: session.session_public_id,
    session_status: session.status as SessionStatus,
    current_phase: session.current_phase,
    attempt_number: session.attempt_number
  };
}

export function assertStudentPayloadIsSafe(value: unknown, path = "payload") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertStudentPayloadIsSafe(entry, `${path}.${index}`));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenStudentKeys.has(key) || key.endsWith("_db_id")) {
      throw new Error(`Forbidden student payload key at ${path}.${key}`);
    }

    assertStudentPayloadIsSafe(entry, `${path}.${key}`);
  }
}
