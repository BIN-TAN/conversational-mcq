import {
  canonicalMisconceptionClaimTexts,
  type CanonicalMisconceptionClaimCatalog
} from "@/lib/domain/misconception-claim-identity";
import {
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS,
  FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
  FormativeConversationProfileEvidenceSchema,
  type FormativeConversationAgentOutput,
  type FormativeConversationCanonicalProfile
} from "./agent-contract";
import {
  validateFormativeConversationMisconceptionEvidenceClosure,
  type FormativeConversationMisconceptionEvidenceClosureIssueCode
} from "./misconception-evidence-closure";
import {
  validateFormativeConversationMisconceptionClaimClosure,
  type FormativeConversationMisconceptionClaimClosureIssueCode
} from "./misconception-claim-closure-v2";
import { validateFormativeConversationMisconceptionEvidence } from "./profile-field-semantics";
import {
  FORMATIVE_CONVERSATION_TRANSITION_EVIDENCE_CLOSURE_ISSUE_CODE,
  validateFormativeConversationTransitionEvidenceClosure
} from "./transition-evidence-closure";

export const FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VALIDATOR_VERSION:
  | "formative-conversation-profile-transition-validator-v4"
  | "formative-conversation-profile-transition-validator-v5"
  | "formative-conversation-profile-transition-validator-v6"
  | "formative-conversation-profile-transition-validator-v7"
  | "formative-conversation-profile-transition-validator-v8" =
  "formative-conversation-profile-transition-validator-v8";

type TransitionRecommendation = NonNullable<
  FormativeConversationAgentOutput["profile_transition_recommendation"]
>;

export type FormativeConversationTransitionEvidenceTurn = {
  sequence_index: number;
  actor: "student" | "tutor";
};

export type FormativeConversationProfileTransitionValidationIssueCode =
  | "profile_transition_prior_profile_missing"
  | "profile_transition_updated_profile_missing"
  | "profile_transition_evidence_missing"
  | typeof FORMATIVE_CONVERSATION_TRANSITION_EVIDENCE_CLOSURE_ISSUE_CODE
  | "profile_transition_evidence_turn_mismatch"
  | "profile_transition_student_evidence_missing"
  | "profile_transition_field_evidence_missing"
  | "profile_transition_field_evidence_duplicate"
  | "profile_transition_retained_field_changed"
  | "profile_transition_updated_field_unchanged"
  | "profile_transition_updated_field_evidence_missing"
  | "profile_transition_recommendation_version_invalid"
  | "profile_transition_legacy_misconception_closure_forbidden"
  | "profile_transition_misconception_claim_dispositions_missing"
  | "profile_transition_new_misconception_claim_identity_missing"
  | FormativeConversationMisconceptionClaimClosureIssueCode
  | FormativeConversationMisconceptionEvidenceClosureIssueCode
  | "profile_transition_misconception_field_semantics_invalid"
  | "profile_transition_snapshot_invalid"
  | "profile_transition_snapshot_outcome_mismatch"
  | "profile_transition_snapshot_profile_mismatch";

export type FormativeConversationProfileTransitionValidationIssue = {
  code: FormativeConversationProfileTransitionValidationIssueCode;
  field_path: string;
  message: string;
};

export type FormativeConversationProfileTransitionValidationResult =
  | {
      valid: true;
      terminal: false;
      issues: [];
      updated_profile: null;
      updated_misconception_claim_catalog: null;
      cited_turn_sequence_indexes: number[];
    }
  | {
      valid: true;
      terminal: true;
      issues: [];
      updated_profile: FormativeConversationCanonicalProfile;
      updated_misconception_claim_catalog: CanonicalMisconceptionClaimCatalog | null;
      cited_turn_sequence_indexes: number[];
    }
  | {
      valid: false;
      terminal: boolean;
      issues: FormativeConversationProfileTransitionValidationIssue[];
      updated_profile: FormativeConversationCanonicalProfile | null;
      updated_misconception_claim_catalog: CanonicalMisconceptionClaimCatalog | null;
      cited_turn_sequence_indexes: number[];
    };

function profileValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function uniqueSorted(values: readonly number[]) {
  return [...new Set(values)].sort((left, right) => left - right);
}

function issue(
  code: FormativeConversationProfileTransitionValidationIssueCode,
  fieldPath: string,
  message: string
): FormativeConversationProfileTransitionValidationIssue {
  return { code, field_path: fieldPath, message };
}

export function validateFormativeConversationProfileTransition(input: {
  recommendation: TransitionRecommendation | null;
  prior_profile: FormativeConversationCanonicalProfile | null;
  prior_misconception_claim_catalog?: CanonicalMisconceptionClaimCatalog | null;
  evidence_observations: FormativeConversationAgentOutput["evidence_observations"];
  available_turns: readonly FormativeConversationTransitionEvidenceTurn[];
}): FormativeConversationProfileTransitionValidationResult {
  const recommendation = input.recommendation;
  if (
    recommendation === null ||
    recommendation.proposed_outcome === "continue_conversation"
  ) {
    return {
      valid: true,
      terminal: false,
      issues: [],
      updated_profile: null,
      updated_misconception_claim_catalog: null,
      cited_turn_sequence_indexes: []
    };
  }

  const issues: FormativeConversationProfileTransitionValidationIssue[] = [];
  const rawUpdatedProfile = recommendation.updated_profile;
  let updatedProfile = rawUpdatedProfile;
  let updatedMisconceptionClaimCatalog:
    | CanonicalMisconceptionClaimCatalog
    | null = null;
  const evidenceClosure =
    validateFormativeConversationTransitionEvidenceClosure({
      recommendation,
      evidence_observations: input.evidence_observations
    });
  for (const closureIssue of evidenceClosure.issues) {
    issues.push(
      issue(
        closureIssue.code,
        closureIssue.field_path,
        closureIssue.message
      )
    );
  }
  const allCitedIndexes = uniqueSorted([
    ...recommendation.source_turn_sequence_indexes,
    ...recommendation.field_evidence.flatMap(
      (entry) => entry.source_turn_sequence_indexes
    ),
    ...(recommendation.misconception_claim_closure ?? []).flatMap(
      (closure) =>
        closure.atomic_claims.flatMap(
          (claim) => claim.source_turn_sequence_indexes
        )
    ),
    ...(recommendation.misconception_claim_dispositions ?? []).flatMap(
      (disposition) => disposition.source_turn_sequence_indexes
    ),
    ...input.evidence_observations.flatMap(
      (entry) => entry.source_turn_sequence_indexes
    )
  ]);
  const availableTurnsByIndex = new Map(
    input.available_turns.map((turn) => [turn.sequence_index, turn])
  );

  if (!input.prior_profile) {
    issues.push(
      issue(
        "profile_transition_prior_profile_missing",
        "current_profile.canonical_profile",
        "A terminal profile transition requires the canonical prior profile."
      )
    );
  }
  if (!updatedProfile) {
    issues.push(
      issue(
        "profile_transition_updated_profile_missing",
        "profile_transition_recommendation.updated_profile",
        "A terminal profile transition requires the complete updated profile."
      )
    );
  }
  if (input.evidence_observations.length === 0) {
    issues.push(
      issue(
        "profile_transition_evidence_missing",
        "evidence_observations",
        "A terminal profile transition requires observable conversation evidence."
      )
    );
  }

  const missingTurnIndexes = allCitedIndexes.filter(
    (sequenceIndex) => !availableTurnsByIndex.has(sequenceIndex)
  );
  if (missingTurnIndexes.length > 0) {
    issues.push(
      issue(
        "profile_transition_evidence_turn_mismatch",
        "profile_transition_recommendation.source_turn_sequence_indexes",
        `Transition evidence references unavailable conversation turns: ${missingTurnIndexes.join(", ")}.`
      )
    );
  }
  if (
    !allCitedIndexes.some(
      (sequenceIndex) =>
        availableTurnsByIndex.get(sequenceIndex)?.actor === "student"
    )
  ) {
    issues.push(
      issue(
        "profile_transition_student_evidence_missing",
        "profile_transition_recommendation.source_turn_sequence_indexes",
        "A terminal profile transition requires at least one supporting student turn."
      )
    );
  }

  if (input.prior_misconception_claim_catalog) {
    if (
      recommendation.recommendation_version !==
      FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION
    ) {
      issues.push(
        issue(
          "profile_transition_recommendation_version_invalid",
          "profile_transition_recommendation.recommendation_version",
          "A V17 claim catalog requires the ID-based profile recommendation contract."
        )
      );
    }
    if ((recommendation.misconception_claim_closure ?? []).length > 0) {
      issues.push(
        issue(
          "profile_transition_legacy_misconception_closure_forbidden",
          "profile_transition_recommendation.misconception_claim_closure",
          "V17 transitions must use canonical claim IDs instead of free-text misconception closure."
        )
      );
    }
    if (recommendation.misconception_claim_dispositions == null) {
      issues.push(
        issue(
          "profile_transition_misconception_claim_dispositions_missing",
          "profile_transition_recommendation.misconception_claim_dispositions",
          "A V17 terminal transition requires the complete ID-based claim disposition set."
        )
      );
    }
    const claimClosure =
      validateFormativeConversationMisconceptionClaimClosure({
        prior_catalog: input.prior_misconception_claim_catalog,
        claim_dispositions:
          recommendation.misconception_claim_dispositions ?? [],
        available_turns: input.available_turns
      });
    for (const closureIssue of claimClosure.issues) {
      issues.push(
        issue(
          closureIssue.code,
          closureIssue.field_path,
          closureIssue.message
        )
      );
    }
    updatedMisconceptionClaimCatalog = claimClosure.updated_catalog;
    if (rawUpdatedProfile) {
      if (
        input.prior_misconception_claim_catalog.indicators.length === 0 &&
        rawUpdatedProfile.misconception_indicators.length > 0
      ) {
        issues.push(
          issue(
            "profile_transition_new_misconception_claim_identity_missing",
            "profile_transition_recommendation.updated_profile.misconception_indicators",
            "A transition cannot add a misconception that has no platform-assigned claim identity in the allowed catalog."
          )
        );
      }
      updatedProfile = {
        ...rawUpdatedProfile,
        misconception_indicators: canonicalMisconceptionClaimTexts(
          claimClosure.updated_catalog
        )
      };
    }
  }

  const fieldEvidence = new Map<
    (typeof FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS)[number],
    TransitionRecommendation["field_evidence"][number][]
  >();
  for (const entry of recommendation.field_evidence) {
    for (const field of entry.profile_fields) {
      const entries = fieldEvidence.get(field) ?? [];
      entries.push(entry);
      fieldEvidence.set(field, entries);
    }
  }

  for (const field of FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS) {
    const entries = fieldEvidence.get(field) ?? [];
    if (entries.length === 0) {
      issues.push(
        issue(
          "profile_transition_field_evidence_missing",
          `profile_transition_recommendation.field_evidence.${field}`,
          `The transition does not state how ${field} is supported.`
        )
      );
      continue;
    }
    if (entries.length > 1) {
      issues.push(
        issue(
          "profile_transition_field_evidence_duplicate",
          `profile_transition_recommendation.field_evidence.${field}`,
          `The transition provides more than one evidence disposition for ${field}.`
        )
      );
      continue;
    }
    if (!input.prior_profile || !updatedProfile) {
      continue;
    }

    const entry = entries[0];
    const changed = !profileValuesEqual(
      input.prior_profile[field],
      updatedProfile[field]
    );
    if (
      entry.disposition === "retained_evidence_remains_valid" &&
      changed
    ) {
      issues.push(
        issue(
          "profile_transition_retained_field_changed",
          `profile_transition_recommendation.updated_profile.${field}`,
          `The retained ${field} field must preserve its canonical prior value exactly. Append, rewrite, replacement, or deletion requires an explicit evidence-backed update.`
        )
      );
      continue;
    }
    if (
      entry.disposition === "updated_from_conversation_evidence" &&
      !changed
    ) {
      issues.push(
        issue(
          "profile_transition_updated_field_unchanged",
          `profile_transition_recommendation.updated_profile.${field}`,
          `The ${field} field is marked updated but its canonical value is unchanged.`
        )
      );
      continue;
    }
    if (entry.disposition === "updated_from_conversation_evidence") {
      const citesStudentEvidence =
        entry.evidence_basis !== "prior_profile_evidence" &&
        entry.source_turn_sequence_indexes.some(
          (sequenceIndex) =>
            availableTurnsByIndex.get(sequenceIndex)?.actor === "student"
        );
      if (!citesStudentEvidence) {
        issues.push(
          issue(
            "profile_transition_updated_field_evidence_missing",
            `profile_transition_recommendation.field_evidence.${field}`,
            `The ${field} update must cite an available supporting student turn.`
          )
        );
      }
    }
  }

  if (updatedProfile) {
    if (input.prior_profile && !input.prior_misconception_claim_catalog) {
      const misconceptionClosure =
        validateFormativeConversationMisconceptionEvidenceClosure({
          prior_misconception_indicators:
            input.prior_profile.misconception_indicators,
          updated_misconception_indicators:
            updatedProfile.misconception_indicators,
          claim_closure: recommendation.misconception_claim_closure,
          available_turns: input.available_turns
        });
      for (const closureIssue of misconceptionClosure.issues) {
        issues.push(
          issue(
            closureIssue.code,
            closureIssue.field_path,
            closureIssue.message
          )
        );
      }
    }
    for (const semanticIssue of
      validateFormativeConversationMisconceptionEvidence(
        rawUpdatedProfile?.misconception_indicators ??
          updatedProfile.misconception_indicators
      )) {
      issues.push(
        issue(
          "profile_transition_misconception_field_semantics_invalid",
          `profile_transition_recommendation.updated_profile.misconception_indicators.${semanticIssue.index}`,
          semanticIssue.role === "resolved_prior_misconception"
            ? "Current misconception evidence must not contain a resolved or historical misconception."
            : "Current misconception evidence must not contain a remaining limitation, uncertainty, or question."
        )
      );
    }
  }

  return issues.length > 0
    ? {
        valid: false,
        terminal: true,
        issues,
        updated_profile: updatedProfile,
        updated_misconception_claim_catalog:
          updatedMisconceptionClaimCatalog,
        cited_turn_sequence_indexes: allCitedIndexes
      }
    : {
        valid: true,
        terminal: true,
        issues: [],
        updated_profile: updatedProfile as FormativeConversationCanonicalProfile,
        updated_misconception_claim_catalog:
          updatedMisconceptionClaimCatalog,
        cited_turn_sequence_indexes: allCitedIndexes
      };
}

function persistedOutcomeToRecommendationOutcome(
  outcome: "sound" | "largely_improved" | "teacher_assistance_recommended"
): TransitionRecommendation["proposed_outcome"] {
  if (outcome === "sound") {
    return "sound_understanding";
  }
  if (outcome === "largely_improved") {
    return "largely_improved_understanding";
  }
  return "teacher_assistance_recommended";
}

export function validatePersistedFormativeConversationProfileTransition(input: {
  prior_profile: FormativeConversationCanonicalProfile;
  prior_misconception_claim_catalog?: CanonicalMisconceptionClaimCatalog | null;
  updated_profile: FormativeConversationCanonicalProfile;
  updated_misconception_claim_catalog?: CanonicalMisconceptionClaimCatalog | null;
  profile_snapshot: unknown;
  learning_outcome:
    | "sound"
    | "largely_improved"
    | "teacher_assistance_recommended";
  learning_observations: unknown;
  evidence_interpretation: string | null;
  supporting_turns: readonly FormativeConversationTransitionEvidenceTurn[];
}) {
  const snapshot = FormativeConversationProfileEvidenceSchema.safeParse(
    input.profile_snapshot
  );
  if (!snapshot.success || !snapshot.data.canonical_profile) {
    return {
      valid: false as const,
      terminal: true as const,
      issues: [
        issue(
          "profile_transition_snapshot_invalid",
          "profile_snapshot",
          "The persisted transition snapshot is not a complete canonical profile."
        )
      ],
      updated_profile: null,
      cited_turn_sequence_indexes: []
    };
  }
  if (!input.evidence_interpretation) {
    return {
      valid: false as const,
      terminal: true as const,
      issues: [
        issue(
          "profile_transition_evidence_missing",
          "evidence_interpretation",
          "The persisted transition does not include its evidence interpretation."
        )
      ],
      updated_profile: snapshot.data.canonical_profile,
      cited_turn_sequence_indexes: []
    };
  }

  const expectedOutcome =
    persistedOutcomeToRecommendationOutcome(input.learning_outcome);
  if (snapshot.data.outcome !== expectedOutcome) {
    return {
      valid: false as const,
      terminal: true as const,
      issues: [
        issue(
          "profile_transition_snapshot_outcome_mismatch",
          "profile_snapshot.outcome",
          "The persisted profile snapshot outcome does not match the transition outcome."
        )
      ],
      updated_profile: snapshot.data.canonical_profile,
      cited_turn_sequence_indexes: []
    };
  }
  if (
    !profileValuesEqual(
      snapshot.data.canonical_profile,
      input.updated_profile
    )
  ) {
    return {
      valid: false as const,
      terminal: true as const,
      issues: [
        issue(
          "profile_transition_snapshot_profile_mismatch",
          "profile_snapshot.canonical_profile",
          "The persisted canonical snapshot does not match the updated profile row."
        )
      ],
      updated_profile: snapshot.data.canonical_profile,
      cited_turn_sequence_indexes: []
    };
  }
  if (
    snapshot.data.misconception_claim_catalog &&
    (!input.updated_misconception_claim_catalog ||
      !profileValuesEqual(
        snapshot.data.misconception_claim_catalog,
        input.updated_misconception_claim_catalog
      ))
  ) {
    return {
      valid: false as const,
      terminal: true as const,
      issues: [
        issue(
          "profile_transition_snapshot_profile_mismatch",
          "profile_snapshot.misconception_claim_catalog",
          "The persisted misconception claim catalog does not match the updated profile row."
        )
      ],
      updated_profile: snapshot.data.canonical_profile,
      cited_turn_sequence_indexes: []
    };
  }

  const observations = Array.isArray(input.learning_observations)
    ? input.learning_observations.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return [];
        }
        const record = value as Record<string, unknown>;
        if (
          typeof record.evidence_type !== "string" ||
          typeof record.observation !== "string" ||
          !Array.isArray(record.source_turn_sequence_indexes) ||
          !record.source_turn_sequence_indexes.every(
            (entry) => Number.isInteger(entry) && Number(entry) > 0
          )
        ) {
          return [];
        }
        return [
          {
            evidence_type: record.evidence_type,
            observation: record.observation,
            source_turn_sequence_indexes:
              record.source_turn_sequence_indexes as number[]
          }
        ];
      })
    : [];
  const sourceTurnIndexes = uniqueSorted(
    input.supporting_turns.map((turn) => turn.sequence_index)
  );
  const recommendation: TransitionRecommendation = {
    recommendation_version:
      FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
    recommended: true,
    proposed_outcome: expectedOutcome,
    rationale: input.evidence_interpretation,
    source_turn_sequence_indexes: sourceTurnIndexes,
    updated_profile: snapshot.data.canonical_profile,
    field_evidence: snapshot.data.field_evidence,
    misconception_claim_closure:
      snapshot.data.misconception_claim_closure ?? [],
    misconception_claim_dispositions:
      snapshot.data.misconception_claim_dispositions
  };
  return validateFormativeConversationProfileTransition({
    recommendation,
    prior_profile: input.prior_profile,
    prior_misconception_claim_catalog:
      input.prior_misconception_claim_catalog,
    evidence_observations: observations,
    available_turns: input.supporting_turns
  });
}
