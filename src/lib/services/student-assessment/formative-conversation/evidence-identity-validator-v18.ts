import {
  CanonicalEligibleEvidenceCatalogSchema,
  canonicalEvidenceById,
  canonicalEvidenceSequenceIndexes,
  type CanonicalEvidenceCatalog,
  type CanonicalEvidenceRef
} from "@/lib/domain/canonical-evidence-identity";
import {
  CanonicalMisconceptionClaimCatalogSchema,
  canonicalMisconceptionClaimTexts,
  type CanonicalMisconceptionClaimCatalog
} from "@/lib/domain/misconception-claim-identity";
import { projectCanonicalMisconceptionClaimCatalog } from "./misconception-claim-closure-v2";
import {
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS,
  type FormativeConversationCanonicalProfile
} from "./agent-contract";
import type {
  FormativeConversationV18AgentOutput,
  FormativeConversationV18ProfileFieldEvidence
} from "./agent-contract-v18";
import { FormativeConversationV18PersistedProfileSnapshotSchema } from "./agent-contract-v18";

export const FORMATIVE_CONVERSATION_EVIDENCE_ID_VALIDATOR_VERSION =
  "formative-conversation-evidence-id-validator-v2" as const;

export const FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES = {
  catalogInvalid: "profile_transition_evidence_catalog_invalid",
  unknown: "profile_transition_evidence_id_unknown",
  duplicate: "profile_transition_evidence_id_duplicate",
  scope: "profile_transition_evidence_scope_mismatch",
  ineligible: "profile_transition_evidence_ineligible",
  conversation: "profile_transition_evidence_conversation_mismatch",
  temporal: "profile_transition_evidence_temporally_inadmissible",
  currentStudentRequired: "profile_transition_current_student_evidence_missing",
  closure: "profile_transition_evidence_id_closure_violation",
  priorProfileMissing: "profile_transition_prior_profile_missing",
  updatedProfileMissing: "profile_transition_updated_profile_missing",
  fieldMissing: "profile_transition_field_evidence_missing",
  fieldDuplicate: "profile_transition_field_evidence_duplicate",
  retainedFieldChanged: "profile_transition_retained_field_changed",
  updatedFieldUnchanged: "profile_transition_updated_field_unchanged",
  claimUnknown: "profile_transition_misconception_claim_unknown",
  claimDuplicate: "profile_transition_misconception_claim_duplicate",
  claimMissing: "profile_transition_misconception_claim_disposition_missing",
  claimIndicatorMismatch:
    "profile_transition_misconception_claim_indicator_mismatch",
  observationMissing: "profile_transition_evidence_observation_missing",
  snapshotInvalid: "profile_transition_snapshot_invalid",
  snapshotOutcomeMismatch: "profile_transition_snapshot_outcome_mismatch",
  snapshotProfileMismatch: "profile_transition_snapshot_profile_mismatch",
  snapshotRationaleMismatch: "profile_transition_snapshot_rationale_mismatch",
  snapshotSequenceMismatch: "profile_transition_snapshot_sequence_mismatch",
  snapshotTurnReferenceMismatch:
    "profile_transition_snapshot_turn_reference_mismatch"
} as const;

export type FormativeConversationEvidenceIdIssueCode =
  (typeof FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES)[keyof typeof FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES];

export type FormativeConversationEvidenceIdIssue = {
  code: FormativeConversationEvidenceIdIssueCode;
  field_path: string;
  message: string;
};

type TransitionRecommendation = NonNullable<
  FormativeConversationV18AgentOutput["profile_transition_recommendation"]
>;

function issue(
  code: FormativeConversationEvidenceIdIssueCode,
  fieldPath: string,
  message: string
): FormativeConversationEvidenceIdIssue {
  return { code, field_path: fieldPath, message };
}

function valuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function duplicateValues(values: readonly string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates].sort();
}

function eligiblePostProfileStudentEvidence(
  evidence: CanonicalEvidenceRef | undefined,
  conversationPublicId: string,
  priorProfileEvidenceCutoffSequenceIndex: number
) {
  return (
    evidence?.source_role === "student" &&
    evidence.eligibility === "student_understanding" &&
    evidence.evidence_stage === "formative_conversation" &&
    evidence.evidence_kind === "formative_student_turn" &&
    evidence.conversation_public_id === conversationPublicId &&
    evidence.source_sequence_index !== null &&
    evidence.source_sequence_index > priorProfileEvidenceCutoffSequenceIndex
  );
}

function evidenceGroups(input: {
  recommendation: TransitionRecommendation;
  observations: FormativeConversationV18AgentOutput["evidence_observations"];
}) {
  return [
    {
      path: "profile_transition_recommendation.canonical_evidence_ids",
      evidence_ids: input.recommendation.canonical_evidence_ids,
      closure_required: false
    },
    ...input.recommendation.field_evidence.map((entry, index) => ({
      path: `profile_transition_recommendation.field_evidence.${index}.evidence_ids`,
      evidence_ids: entry.evidence_ids,
      closure_required: true
    })),
    ...input.recommendation.misconception_claim_dispositions.map(
      (entry, index) => ({
        path: `profile_transition_recommendation.misconception_claim_dispositions.${index}.evidence_ids`,
        evidence_ids: entry.evidence_ids,
        closure_required: true
      })
    ),
    ...input.observations.map((entry, index) => ({
      path: `evidence_observations.${index}.evidence_ids`,
      evidence_ids: entry.evidence_ids,
      closure_required: true
    }))
  ];
}

export function validateFormativeConversationV18Transition(input: {
  conversation_public_id: string;
  prior_profile_evidence_cutoff_sequence_index: number;
  recommendation: TransitionRecommendation | null;
  prior_profile: FormativeConversationCanonicalProfile | null;
  prior_misconception_claim_catalog: CanonicalMisconceptionClaimCatalog;
  allowed_evidence_catalog: CanonicalEvidenceCatalog;
  evidence_observations: FormativeConversationV18AgentOutput["evidence_observations"];
}) {
  const recommendation = input.recommendation;
  if (
    recommendation === null ||
    recommendation.proposed_outcome === "continue_conversation"
  ) {
    return {
      valid: true as const,
      terminal: false as const,
      issues: [] as FormativeConversationEvidenceIdIssue[],
      updated_profile: null,
      updated_misconception_claim_catalog: null,
      canonical_evidence_ids: [] as string[],
      cited_turn_sequence_indexes: [] as number[]
    };
  }

  const issues: FormativeConversationEvidenceIdIssue[] = [];
  const catalog = CanonicalEligibleEvidenceCatalogSchema.safeParse(
    input.allowed_evidence_catalog
  );
  if (!catalog.success) {
    issues.push(
      issue(
        FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.catalogInvalid,
        "allowed_evidence_catalog",
        "The allowed evidence catalog is not a valid eligible platform catalog."
      )
    );
  }
  const evidenceById = canonicalEvidenceById(input.allowed_evidence_catalog);
  const canonicalSet = new Set(recommendation.canonical_evidence_ids);
  const groups = evidenceGroups({
    recommendation,
    observations: input.evidence_observations
  });

  for (const group of groups) {
    const duplicates = duplicateValues(group.evidence_ids);
    if (duplicates.length > 0) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.duplicate,
          group.path,
          `Canonical evidence IDs must not be repeated: ${duplicates.join(", ")}.`
        )
      );
    }
    for (const evidenceId of group.evidence_ids) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) {
        issues.push(
          issue(
            FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.unknown,
            group.path,
            `Evidence ID ${evidenceId} is not in the platform catalog.`
          )
        );
        continue;
      }
      if (
        evidence.evidence_scope_id !==
        input.allowed_evidence_catalog.evidence_scope_id
      ) {
        issues.push(
          issue(
            FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.scope,
            group.path,
            `Evidence ID ${evidenceId} belongs to another evidence scope.`
          )
        );
      }
      if (
        evidence.source_role === "tutor" ||
        evidence.source_role === "teacher_private" ||
        evidence.eligibility === "not_eligible"
      ) {
        issues.push(
          issue(
            FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.ineligible,
            group.path,
            `Evidence ID ${evidenceId} is not eligible evidence of student understanding.`
          )
        );
      }
      if (
        evidence.evidence_kind === "formative_student_turn" &&
        evidence.conversation_public_id !== input.conversation_public_id
      ) {
        issues.push(
          issue(
            FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.conversation,
            group.path,
            `Evidence ID ${evidenceId} belongs to another formative conversation.`
          )
        );
      }
      if (group.closure_required && !canonicalSet.has(evidenceId)) {
        issues.push(
          issue(
            FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.closure,
            group.path,
            `Evidence ID ${evidenceId} is missing from the canonical transition evidence set.`
          )
        );
      }
    }
  }

  if (!input.prior_profile) {
    issues.push(
      issue(
        FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.priorProfileMissing,
        "current_profile.canonical_profile",
        "A terminal transition requires a canonical prior profile."
      )
    );
  }
  if (!recommendation.updated_profile) {
    issues.push(
      issue(
        FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.updatedProfileMissing,
        "profile_transition_recommendation.updated_profile",
        "A terminal transition requires a complete updated profile."
      )
    );
  }
  if (
    !recommendation.canonical_evidence_ids.some((evidenceId) =>
      eligiblePostProfileStudentEvidence(
        evidenceById.get(evidenceId),
        input.conversation_public_id,
        input.prior_profile_evidence_cutoff_sequence_index
      )
    )
  ) {
    issues.push(
      issue(
        FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.currentStudentRequired,
        "profile_transition_recommendation.canonical_evidence_ids",
        "A terminal transition requires current student-authored conversation evidence."
      )
    );
  }
  if (input.evidence_observations.length === 0) {
    issues.push(
      issue(
        FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.observationMissing,
        "evidence_observations",
        "A terminal transition requires a persisted evidence observation."
      )
    );
  }
  input.evidence_observations.forEach((observation, index) => {
    if (
      observation.evidence_ids.some(
        (evidenceId) =>
          !eligiblePostProfileStudentEvidence(
            evidenceById.get(evidenceId),
            input.conversation_public_id,
            input.prior_profile_evidence_cutoff_sequence_index
          )
      )
    ) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.temporal,
          `evidence_observations.${index}.evidence_ids`,
          "A learning-change observation must cite eligible student evidence observed after the prior profile state."
        )
      );
    }
  });

  const claimsById = new Map(
    input.prior_misconception_claim_catalog.indicators.flatMap((indicator) =>
      indicator.claims.map((claim) => [
        claim.claim_id,
        { indicator, claim }
      ] as const)
    )
  );
  const dispositionsByClaim = new Map<string, number[]>();
  recommendation.misconception_claim_dispositions.forEach(
    (disposition, index) => {
      const canonical = claimsById.get(disposition.claim_id);
      if (!canonical) {
        issues.push(
          issue(
            FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.claimUnknown,
            `profile_transition_recommendation.misconception_claim_dispositions.${index}.claim_id`,
            "The disposition references a claim outside the canonical catalog."
          )
        );
      } else if (
        canonical.indicator.indicator_id !== disposition.indicator_id
      ) {
        issues.push(
          issue(
            FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.claimIndicatorMismatch,
            `profile_transition_recommendation.misconception_claim_dispositions.${index}.indicator_id`,
            "The claim ID belongs to a different canonical indicator."
          )
        );
      }
      const indexes = dispositionsByClaim.get(disposition.claim_id) ?? [];
      indexes.push(index);
      dispositionsByClaim.set(disposition.claim_id, indexes);

      if (
        disposition.disposition === "resolved" &&
        disposition.evidence_ids.some((evidenceId) =>
          !eligiblePostProfileStudentEvidence(
            evidenceById.get(evidenceId),
            input.conversation_public_id,
            input.prior_profile_evidence_cutoff_sequence_index
          )
        )
      ) {
        issues.push(
          issue(
            FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.temporal,
            `profile_transition_recommendation.misconception_claim_dispositions.${index}.evidence_ids`,
            "Every resolved-claim reference must be eligible student evidence observed after the prior profile state."
          )
        );
      }
      if (
        disposition.disposition === "retained" &&
        disposition.evidence_ids.some(
          (evidenceId) =>
            !eligiblePostProfileStudentEvidence(
              evidenceById.get(evidenceId),
              input.conversation_public_id,
              input.prior_profile_evidence_cutoff_sequence_index
            )
        )
      ) {
        issues.push(
          issue(
            FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.currentStudentRequired,
            `profile_transition_recommendation.misconception_claim_dispositions.${index}.evidence_ids`,
            "Optional new evidence for a retained claim must be current student-authored conversation evidence; historical provenance is preserved by the platform."
          )
        );
      }
    }
  );
  for (const claimId of claimsById.keys()) {
    const indexes = dispositionsByClaim.get(claimId) ?? [];
    if (indexes.length === 0) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.claimMissing,
          "profile_transition_recommendation.misconception_claim_dispositions",
          `The transition omits canonical claim ${claimId}.`
        )
      );
    } else if (indexes.length > 1) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.claimDuplicate,
          "profile_transition_recommendation.misconception_claim_dispositions",
          `The transition repeats canonical claim ${claimId}.`
        )
      );
    }
  }

  const retainedClaimIds = new Set(
    recommendation.misconception_claim_dispositions
      .filter((entry) => entry.disposition === "retained")
      .map((entry) => entry.claim_id)
  );
  const projectedClaimCatalog = projectCanonicalMisconceptionClaimCatalog({
    prior_catalog: input.prior_misconception_claim_catalog,
    retained_claim_ids: retainedClaimIds
  });
  const dispositionByClaimId = new Map(
    recommendation.misconception_claim_dispositions.map((entry) => [
      entry.claim_id,
      entry
    ])
  );
  const updatedClaimCatalog = CanonicalMisconceptionClaimCatalogSchema.parse({
    ...projectedClaimCatalog,
    indicators: projectedClaimCatalog.indicators.map((indicator) => ({
      ...indicator,
      claims: indicator.claims.map((claim) => {
        const additionalEvidence =
          dispositionByClaimId.get(claim.claim_id)?.evidence_ids ?? [];
        return {
          ...claim,
          source_evidence_refs: [
            ...new Set([
              ...claim.source_evidence_refs,
              ...additionalEvidence
            ])
          ].sort()
        };
      }),
      source_evidence_refs: [
        ...new Set(
          indicator.claims.flatMap((claim) => [
            ...claim.source_evidence_refs,
            ...(dispositionByClaimId.get(claim.claim_id)?.evidence_ids ?? [])
          ])
        )
      ].sort()
    }))
  });
  const updatedProfile = recommendation.updated_profile
    ? {
        ...recommendation.updated_profile,
        misconception_indicators:
          canonicalMisconceptionClaimTexts(updatedClaimCatalog)
      }
    : null;

  const fieldEvidence = new Map<
    (typeof FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS)[number],
    FormativeConversationV18ProfileFieldEvidence[]
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
          FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.fieldMissing,
          `profile_transition_recommendation.field_evidence.${field}`,
          `The transition does not state how ${field} is supported.`
        )
      );
      continue;
    }
    if (entries.length > 1) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.fieldDuplicate,
          `profile_transition_recommendation.field_evidence.${field}`,
          `The transition provides more than one disposition for ${field}.`
        )
      );
      continue;
    }
    if (!input.prior_profile || !updatedProfile) {
      continue;
    }
    const entry = entries[0];
    const changed = !valuesEqual(
      input.prior_profile[field],
      updatedProfile[field]
    );
    if (
      entry.disposition === "retained_evidence_remains_valid" &&
      changed
    ) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.retainedFieldChanged,
          `profile_transition_recommendation.updated_profile.${field}`,
          `Retained field ${field} must preserve its prior canonical value.`
        )
      );
    }
    if (
      entry.disposition === "updated_from_conversation_evidence" &&
      !changed
    ) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.updatedFieldUnchanged,
          `profile_transition_recommendation.updated_profile.${field}`,
          `Field ${field} is marked updated but is unchanged.`
        )
      );
    }
    if (
      entry.disposition === "updated_from_conversation_evidence" &&
      entry.evidence_ids.some((evidenceId) =>
        !eligiblePostProfileStudentEvidence(
          evidenceById.get(evidenceId),
          input.conversation_public_id,
          input.prior_profile_evidence_cutoff_sequence_index
        )
      )
    ) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.temporal,
          `profile_transition_recommendation.field_evidence.${field}.evidence_ids`,
          `Every reference for updated field ${field} must be eligible student evidence observed after the prior profile state.`
        )
      );
    }
    if (
      entry.disposition === "retained_evidence_remains_valid" &&
      entry.evidence_ids.some(
        (evidenceId) =>
          !eligiblePostProfileStudentEvidence(
            evidenceById.get(evidenceId),
            input.conversation_public_id,
            input.prior_profile_evidence_cutoff_sequence_index
          )
      )
    ) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.currentStudentRequired,
          `profile_transition_recommendation.field_evidence.${field}.evidence_ids`,
          `Optional new evidence for retained field ${field} must be current student-authored conversation evidence; prior evidence is retained automatically.`
        )
      );
    }
  }

  const canonicalIds = [...new Set(recommendation.canonical_evidence_ids)];
  const citedIndexes = canonicalEvidenceSequenceIndexes(
    input.allowed_evidence_catalog,
    canonicalIds
  );
  return issues.length === 0
    ? {
        valid: true as const,
        terminal: true as const,
        issues: [] as FormativeConversationEvidenceIdIssue[],
        updated_profile: updatedProfile as FormativeConversationCanonicalProfile,
        updated_misconception_claim_catalog: updatedClaimCatalog,
        canonical_evidence_ids: canonicalIds,
        cited_turn_sequence_indexes: citedIndexes
      }
    : {
        valid: false as const,
        terminal: true as const,
        issues,
        updated_profile: updatedProfile,
        updated_misconception_claim_catalog: updatedClaimCatalog,
        canonical_evidence_ids: canonicalIds,
        cited_turn_sequence_indexes: citedIndexes
      };
}

function persistedOutcomeToRecommendationOutcome(
  outcome: "sound" | "largely_improved" | "teacher_assistance_recommended"
) {
  if (outcome === "sound") return "sound_understanding" as const;
  if (outcome === "largely_improved") {
    return "largely_improved_understanding" as const;
  }
  return "teacher_assistance_recommended" as const;
}

function sortedUniqueNumbers(values: readonly number[]) {
  return [...new Set(values)].sort((left, right) => left - right);
}

export function validatePersistedFormativeConversationV18Transition(input: {
  prior_profile: FormativeConversationCanonicalProfile;
  prior_misconception_claim_catalog: CanonicalMisconceptionClaimCatalog;
  updated_profile: FormativeConversationCanonicalProfile;
  updated_misconception_claim_catalog: CanonicalMisconceptionClaimCatalog;
  profile_snapshot: unknown;
  learning_outcome:
    | "sound"
    | "largely_improved"
    | "teacher_assistance_recommended";
  evidence_interpretation: string | null;
  supporting_turns: readonly {
    sequence_index: number;
    actor: "student" | "tutor";
  }[];
}) {
  const parsed = FormativeConversationV18PersistedProfileSnapshotSchema.safeParse(
    input.profile_snapshot
  );
  if (!parsed.success || !parsed.data.profile.canonical_profile) {
    return {
      valid: false as const,
      terminal: true as const,
      issues: [
        issue(
          FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.snapshotInvalid,
          "profile_snapshot",
          "The persisted V18 transition snapshot is incomplete or invalid."
        )
      ]
    };
  }
  const snapshot = parsed.data;
  const issues: FormativeConversationEvidenceIdIssue[] = [];
  const expectedOutcome = persistedOutcomeToRecommendationOutcome(
    input.learning_outcome
  );
  if (snapshot.profile.outcome !== expectedOutcome) {
    issues.push(
      issue(
        FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.snapshotOutcomeMismatch,
        "profile_snapshot.profile.outcome",
        "The V18 snapshot outcome does not match the persisted transition outcome."
      )
    );
  }
  if (!valuesEqual(snapshot.profile.canonical_profile, input.updated_profile)) {
    issues.push(
      issue(
        FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.snapshotProfileMismatch,
        "profile_snapshot.profile.canonical_profile",
        "The V18 snapshot profile does not match the persisted updated profile."
      )
    );
  }
  if (
    !valuesEqual(
      snapshot.profile.misconception_claim_catalog,
      input.updated_misconception_claim_catalog
    )
  ) {
    issues.push(
      issue(
        FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.snapshotProfileMismatch,
        "profile_snapshot.profile.misconception_claim_catalog",
        "The V18 snapshot claim catalog does not match the persisted updated profile."
      )
    );
  }
  if (
    input.evidence_interpretation === null ||
    snapshot.rationale !== input.evidence_interpretation
  ) {
    issues.push(
      issue(
        FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.snapshotRationaleMismatch,
        "profile_snapshot.rationale",
        "The V18 snapshot rationale does not match the persisted evidence interpretation."
      )
    );
  }

  const conversationIds = [
    ...new Set(
      snapshot.canonical_evidence_catalog.evidence.flatMap((entry) =>
        entry.conversation_public_id ? [entry.conversation_public_id] : []
      )
    )
  ];
  if (conversationIds.length !== 1) {
    issues.push(
      issue(
        FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.snapshotInvalid,
        "profile_snapshot.canonical_evidence_catalog",
        "The V18 evidence catalog must bind to exactly one conversation."
      )
    );
  }
  const recommendation: NonNullable<
    FormativeConversationV18AgentOutput["profile_transition_recommendation"]
  > = {
    recommendation_version: "formative-conversation-profile-recommendation-v4",
    recommended: true,
    proposed_outcome: expectedOutcome,
    rationale: snapshot.rationale,
    canonical_evidence_ids: snapshot.canonical_evidence_ids,
    updated_profile: snapshot.profile.canonical_profile,
    field_evidence: snapshot.field_evidence,
    misconception_claim_dispositions:
      snapshot.misconception_claim_dispositions
  };
  const validation = validateFormativeConversationV18Transition({
    conversation_public_id: conversationIds[0] ?? "invalid_conversation",
    prior_profile_evidence_cutoff_sequence_index:
      snapshot.prior_profile_evidence_cutoff_sequence_index,
    recommendation,
    prior_profile: input.prior_profile,
    prior_misconception_claim_catalog:
      input.prior_misconception_claim_catalog,
    allowed_evidence_catalog: snapshot.canonical_evidence_catalog,
    evidence_observations: snapshot.evidence_observations
  });
  issues.push(...validation.issues);

  if (
    validation.updated_profile &&
    !valuesEqual(validation.updated_profile, input.updated_profile)
  ) {
    issues.push(
      issue(
        FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.snapshotProfileMismatch,
        "profile_snapshot.profile.canonical_profile",
        "Revalidating the V18 snapshot does not reproduce the persisted profile."
      )
    );
  }
  if (
    validation.updated_misconception_claim_catalog &&
    !valuesEqual(
      validation.updated_misconception_claim_catalog,
      input.updated_misconception_claim_catalog
    )
  ) {
    issues.push(
      issue(
        FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.snapshotProfileMismatch,
        "profile_snapshot.profile.misconception_claim_catalog",
        "Revalidating the V18 snapshot does not reproduce the persisted claim catalog."
      )
    );
  }

  const expectedIndexes = sortedUniqueNumbers(
    validation.cited_turn_sequence_indexes
  );
  if (
    !valuesEqual(
      expectedIndexes,
      sortedUniqueNumbers(snapshot.derived_source_turn_sequence_indexes)
    )
  ) {
    issues.push(
      issue(
        FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.snapshotSequenceMismatch,
        "profile_snapshot.derived_source_turn_sequence_indexes",
        "Derived turn indexes do not match the canonical evidence IDs."
      )
    );
  }
  const persistedStudentIndexes = sortedUniqueNumbers(
    input.supporting_turns.flatMap((turn) =>
      turn.actor === "student" ? [turn.sequence_index] : []
    )
  );
  if (!valuesEqual(expectedIndexes, persistedStudentIndexes)) {
    issues.push(
      issue(
        FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.snapshotTurnReferenceMismatch,
        "supporting_turn_references",
        "Persisted student turn references do not match canonical evidence provenance."
      )
    );
  }
  if (!input.supporting_turns.some((turn) => turn.actor === "tutor")) {
    issues.push(
      issue(
        FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.snapshotTurnReferenceMismatch,
        "supporting_turn_references",
        "The persisted transition is missing its tutor interpretation turn."
      )
    );
  }

  return {
    valid: issues.length === 0,
    terminal: true as const,
    issues
  };
}
