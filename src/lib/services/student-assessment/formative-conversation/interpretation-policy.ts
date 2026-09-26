import { createHash } from "node:crypto";
import type { StructuredAgentResult } from "@/lib/llm/providers/types";
import {
  FormativeConversationV18R2AgentOutputSchema,
  type FormativeConversationV18R2AgentInput,
  type FormativeConversationV18R2AgentOutput
} from "./agent-contract-v18r2";
import { validateFormativeConversationV18R2CandidateAcceptance } from "./candidate-validation-v18r2";

export const FORMATIVE_INTERPRETATION_POLICY_VERSION = "formative-interpretation-policy-v1";

// This projection fixes bookkeeping only. Raw output and every evidence reference survive.
export function prepareFormativeInterpretationResult(
  result: StructuredAgentResult<FormativeConversationV18R2AgentOutput>,
  context: FormativeConversationV18R2AgentInput
): StructuredAgentResult<FormativeConversationV18R2AgentOutput> {
  if (result.status !== "completed") return result;
  const parsed = FormativeConversationV18R2AgentOutputSchema.safeParse(result.parsed_output);
  const prior = context.current_profile.canonical_profile;
  if (!parsed.success || !prior || !parsed.data.profile_transition_recommendation?.updated_profile) return result;
  const output = parsed.data;
  const recommendation = output.profile_transition_recommendation!;
  const updated = recommendation.updated_profile!;
  const normalizedFields: string[] = [];
  recommendation.field_evidence = recommendation.field_evidence.flatMap(entry => {
    if (entry.disposition !== "updated_from_conversation_evidence") return [entry];
    const unchanged = entry.profile_fields.filter(field => JSON.stringify(prior[field]) === JSON.stringify(updated[field]));
    const changed = entry.profile_fields.filter(field => !unchanged.includes(field));
    normalizedFields.push(...unchanged);
    return [
      ...(changed.length ? [{ ...entry, profile_fields: changed }] : []),
      ...(unchanged.length ? [{ ...entry, profile_fields: unchanged,
        disposition: "retained_evidence_remains_valid" as const }] : [])
    ];
  });
  if (!normalizedFields.length) return result;
  return {
    ...result,
    parsed_output: output,
    raw_output: {
      provider_raw_output: result.raw_output ?? null,
      original_parsed_output: result.parsed_output,
      interpretation_projection: {
        policy_version: FORMATIVE_INTERPRETATION_POLICY_VERSION,
        operation: "unchanged_updated_fields_marked_retained",
        fields: normalizedFields,
        original_sha256: createHash("sha256").update(JSON.stringify(result.parsed_output)).digest("hex"),
        projected_sha256: createHash("sha256").update(JSON.stringify(output)).digest("hex")
      }
    }
  };
}

// Apply to new live candidates, not to replay/interpretation of historical stored profiles.
export function validateFormativeInterpretation(input: {
  candidate: unknown;
  context: FormativeConversationV18R2AgentInput;
}) {
  const validation = validateFormativeConversationV18R2CandidateAcceptance(input);
  if (!validation.valid || !validation.output) return validation;
  const output = validation.output;
  const prior = input.context.current_profile.canonical_profile;
  const recommendation = output.profile_transition_recommendation;
  const updated = recommendation?.updated_profile;
  const issues: string[] = [];
  const uncatalogued = output.evidence_observations.filter(observation =>
    observation.evidence_type === "uncatalogued_misconception"
  );
  for (const observation of uncatalogued) {
    if (!observation.evidence_ids.length || observation.evidence_ids.some(id =>
      !input.context.allowed_evidence_catalog.evidence.some(evidence =>
        evidence.evidence_id === id && evidence.source_role === "student" &&
        evidence.eligibility === "student_understanding" &&
        evidence.evidence_stage === "formative_conversation" &&
        evidence.conversation_public_id === input.context.conversation_public_id &&
        (evidence.source_sequence_index ?? 0) > input.context.current_profile.evidence_cutoff_sequence_index
      )
    )) issues.push("interpretation.uncatalogued_misconception.current_student_evidence_required");
  }
  if (uncatalogued.length && recommendation) {
    if (output.outcome !== "teacher_assistance_recommended" ||
        output.teacher_assistance_recommendation.reason_code !== "uncatalogued_misconception_requires_review") {
      issues.push("interpretation.uncatalogued_misconception.teacher_review_required");
    }
    if (updated?.ability_profile === "robust_transfer_ready_understanding" ||
        updated?.integrated_diagnostic_profile === "robust_understanding_ready_for_transfer") {
      issues.push("interpretation.uncatalogued_misconception.strongest_profile_not_supported");
    }
  }
  if (prior && updated && updated.confidence_alignment !== prior.confidence_alignment) {
    issues.push("interpretation.confidence_alignment_not_reassessed");
  }
  if (updated && recommendation) {
    for (const [field, strongest] of [
      ["ability_profile", "robust_transfer_ready_understanding"],
      ["integrated_diagnostic_profile", "robust_understanding_ready_for_transfer"]
    ] as const) {
      if (updated[field] !== strongest || prior?.[field] === strongest) continue;
      const fieldIds = recommendation.field_evidence.find(entry => entry.profile_fields.includes(field))?.evidence_ids ?? [];
      const support = output.evidence_observations.some(observation =>
        observation.evidence_type === "independent_transfer_application" &&
        observation.evidence_ids.some(id => fieldIds.includes(id) &&
          input.context.allowed_evidence_catalog.evidence.some(evidence =>
            evidence.evidence_id === id && evidence.source_role === "student" &&
            evidence.eligibility === "student_understanding" &&
            evidence.evidence_stage === "formative_conversation" &&
            evidence.conversation_public_id === input.context.conversation_public_id &&
            (evidence.source_sequence_index ?? 0) > input.context.current_profile.evidence_cutoff_sequence_index
          )
        )
      );
      if (!support) issues.push(`interpretation.${field}.independent_transfer_evidence_required`);
    }
  }
  return issues.length ? {
    ...validation, valid: false, validation_status: "semantic_contract_invalid" as const,
    validation_issue_paths: issues
  } : validation;
}
