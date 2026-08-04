export const FORMATIVE_CONVERSATION_TRANSITION_EVIDENCE_CLOSURE_VERSION =
  "formative-conversation-transition-evidence-closure-v1";

export const FORMATIVE_CONVERSATION_TRANSITION_EVIDENCE_CLOSURE_ISSUE_CODE =
  "profile_transition_evidence_closure_violation" as const;

type EvidenceReferenceSource = {
  source_turn_sequence_indexes: readonly number[];
};

type TransitionEvidenceClosureRecommendation = {
  proposed_outcome:
    | "sound_understanding"
    | "largely_improved_understanding"
    | "teacher_assistance_recommended"
    | "continue_conversation";
  source_turn_sequence_indexes: readonly number[];
  field_evidence: readonly EvidenceReferenceSource[];
};

export type FormativeConversationTransitionEvidenceClosureIssue = {
  code: typeof FORMATIVE_CONVERSATION_TRANSITION_EVIDENCE_CLOSURE_ISSUE_CODE;
  field_path: string;
  message: string;
  missing_turn_sequence_indexes: number[];
};

function uniqueSorted(values: readonly number[]) {
  return [...new Set(values)].sort((left, right) => left - right);
}

export function validateFormativeConversationTransitionEvidenceClosure(input: {
  recommendation: TransitionEvidenceClosureRecommendation | null;
  evidence_observations: readonly EvidenceReferenceSource[];
}) {
  const recommendation = input.recommendation;
  if (
    recommendation === null ||
    recommendation.proposed_outcome === "continue_conversation"
  ) {
    return {
      valid: true as const,
      canonical_turn_sequence_indexes: [] as number[],
      referenced_turn_sequence_indexes: [] as number[],
      missing_turn_sequence_indexes: [] as number[],
      issues: [] as FormativeConversationTransitionEvidenceClosureIssue[]
    };
  }

  const canonical = uniqueSorted(
    recommendation.source_turn_sequence_indexes
  );
  const canonicalSet = new Set(canonical);
  const referenceGroups = [
    ...recommendation.field_evidence.map((entry, index) => ({
      field_path: `profile_transition_recommendation.field_evidence.${index}.source_turn_sequence_indexes`,
      source_turn_sequence_indexes: entry.source_turn_sequence_indexes
    })),
    ...input.evidence_observations.map((entry, index) => ({
      field_path: `evidence_observations.${index}.source_turn_sequence_indexes`,
      source_turn_sequence_indexes: entry.source_turn_sequence_indexes
    }))
  ];
  const issues = referenceGroups.flatMap((group) => {
    const missing = uniqueSorted(
      group.source_turn_sequence_indexes.filter(
        (sequenceIndex) => !canonicalSet.has(sequenceIndex)
      )
    );
    return missing.length === 0
      ? []
      : [
          {
            code: FORMATIVE_CONVERSATION_TRANSITION_EVIDENCE_CLOSURE_ISSUE_CODE,
            field_path: group.field_path,
            message: `Transition evidence references must be closed over the canonical evidence set. Missing turn indexes: ${missing.join(", ")}.`,
            missing_turn_sequence_indexes: missing
          }
        ];
  });
  const referenced = uniqueSorted(
    referenceGroups.flatMap((group) => group.source_turn_sequence_indexes)
  );
  const missing = uniqueSorted(
    issues.flatMap((entry) => entry.missing_turn_sequence_indexes)
  );

  return issues.length === 0
    ? {
        valid: true as const,
        canonical_turn_sequence_indexes: canonical,
        referenced_turn_sequence_indexes: referenced,
        missing_turn_sequence_indexes: [] as number[],
        issues: [] as FormativeConversationTransitionEvidenceClosureIssue[]
      }
    : {
        valid: false as const,
        canonical_turn_sequence_indexes: canonical,
        referenced_turn_sequence_indexes: referenced,
        missing_turn_sequence_indexes: missing,
        issues
      };
}
