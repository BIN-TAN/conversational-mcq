import assert from "node:assert/strict";
import {
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS,
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_VERSION,
  FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
  type FormativeConversationAgentOutput,
  type FormativeConversationCanonicalProfile
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  FORMATIVE_CONVERSATION_INSTRUCTIONS,
  FORMATIVE_CONVERSATION_PROMPT_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/live-runner";
import { validateFormativeConversationProfileTransition } from "../src/lib/services/student-assessment/formative-conversation/profile-transition-validator";

function priorProfile(): FormativeConversationCanonicalProfile {
  return {
    schema_version: FORMATIVE_CONVERSATION_CANONICAL_PROFILE_VERSION,
    ability_profile: "misconception_based_understanding",
    ability_pattern_flags: ["Reliability is treated as proof of validity."],
    engagement_profile: "productive_engagement",
    engagement_pattern_flags: ["The student responds to each explanation."],
    integrated_diagnostic_profile:
      "misconception_with_sufficient_engagement",
    integrated_profile_confidence: "high",
    integrated_profile_rationale:
      "Repeated assessment evidence supports a persistent conceptual barrier.",
    evidence_sufficiency: "strong",
    confidence_alignment: "overconfident",
    independence_interpretability: "independent_understanding_likely",
    misconception_indicators: [
      "High reliability is interpreted as sufficient validity evidence."
    ],
    item_level_evidence: [
      "The administered response explicitly endorses the reliability-validity inference."
    ],
    reasoning_quality_summary:
      "The explanation is coherent but preserves the central misconception.",
    engagement_summary:
      "Observable responses provide enough evidence for interpretation.",
    process_interpretation_cautions: [
      "Process events do not establish motivation or effort."
    ],
    profile_confidence: "high",
    rationale:
      "The available evidence supports the current profile without a trait claim.",
    recommended_next_evidence: [
      "Independent application of the reliability-validity distinction."
    ]
  };
}

function recommendation(input: {
  prior: FormativeConversationCanonicalProfile;
  dispositionForUnchangedAbility:
    | "updated_from_conversation_evidence"
    | "retained_evidence_remains_valid";
}) {
  const updated = structuredClone(input.prior);
  updated.integrated_profile_rationale =
    "The conversation confirms that the barrier remains after supportive explanation.";
  updated.rationale =
    "Teacher assistance may be useful because the cited student turn still endorses the misconception.";

  const changedFields =
    FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
      (field) =>
        JSON.stringify(input.prior[field]) !==
        JSON.stringify(updated[field])
    );
  const retainedFields =
    FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
      (field) => !changedFields.includes(field)
    );
  const unchangedAbilityIsUpdated =
    input.dispositionForUnchangedAbility ===
    "updated_from_conversation_evidence";
  const retainedWithoutAbility = retainedFields.filter(
    (field) => field !== "ability_profile"
  );

  const value: NonNullable<
    FormativeConversationAgentOutput["profile_transition_recommendation"]
  > = {
    recommendation_version:
      FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
    recommended: true,
    proposed_outcome: "teacher_assistance_recommended",
    rationale:
      "The cited student turn continues to endorse the misconception after support.",
    source_turn_sequence_indexes: [5],
    updated_profile: updated,
    misconception_claim_closure: [],
    field_evidence: [
      {
        profile_fields: changedFields,
        disposition: "updated_from_conversation_evidence",
        evidence_basis: "conversation_evidence",
        rationale:
          "The conversation changes these canonical narrative fields.",
        source_turn_sequence_indexes: [5]
      },
      {
        profile_fields: retainedWithoutAbility,
        disposition: "retained_evidence_remains_valid",
        evidence_basis: "prior_profile_evidence",
        rationale:
          "These fields preserve their exact canonical prior values.",
        source_turn_sequence_indexes: []
      },
      {
        profile_fields: ["ability_profile"],
        disposition: input.dispositionForUnchangedAbility,
        evidence_basis: unchangedAbilityIsUpdated
          ? "conversation_evidence"
          : "prior_profile_evidence",
        rationale: unchangedAbilityIsUpdated
          ? "The unchanged field was relevant to the conversation."
          : "The canonical ability value is unchanged and its prior evidence remains valid.",
        source_turn_sequence_indexes: unchangedAbilityIsUpdated ? [5] : []
      }
    ]
  };
  return value;
}

function validate(
  value: NonNullable<
    FormativeConversationAgentOutput["profile_transition_recommendation"]
  >
) {
  return validateFormativeConversationProfileTransition({
    recommendation: value,
    prior_profile: priorProfile(),
    evidence_observations: [
      {
        evidence_type: "persistent_barrier",
        observation:
          "The student still treats reliability as proof of validity.",
        source_turn_sequence_indexes: [5]
      }
    ],
    available_turns: [
      { sequence_index: 4, actor: "tutor" },
      { sequence_index: 5, actor: "student" }
    ]
  });
}

function main() {
  assert.equal(
    FORMATIVE_CONVERSATION_PROMPT_VERSION,
    "formative-conversation-host-v5.2"
  );
  assert.match(
    FORMATIVE_CONVERSATION_INSTRUCTIONS,
    /If the canonical\s+value is unchanged, you MUST use retained_evidence_remains_valid/
  );
  assert.match(
    FORMATIVE_CONVERSATION_INSTRUCTIONS,
    /Use updated_from_conversation_evidence only\s+when the canonical value actually changes/
  );

  const invalid = validate(
    recommendation({
      prior: priorProfile(),
      dispositionForUnchangedAbility:
        "updated_from_conversation_evidence"
    })
  );
  assert.equal(invalid.valid, false);
  assert(
    invalid.issues.some(
      (issue) =>
        issue.code === "profile_transition_updated_field_unchanged" &&
        issue.field_path.endsWith("ability_profile")
    )
  );

  const valid = validate(
    recommendation({
      prior: priorProfile(),
      dispositionForUnchangedAbility:
        "retained_evidence_remains_valid"
    })
  );
  assert.equal(valid.valid, true);
  assert.equal(valid.terminal, true);

  console.log(
    JSON.stringify(
      {
        status: "passed",
        prompt_version: FORMATIVE_CONVERSATION_PROMPT_VERSION,
        unchanged_field_mislabeled_update_rejected: true,
        unchanged_field_retained_transition_valid: true,
        validator_weakened: false,
        provider_calls: 0,
        network_requests: 0
      },
      null,
      2
    )
  );
}

main();
