import { classifyFormativeConversationMisconceptionEvidence } from "./profile-field-semantics";

export const FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_VERSION =
  "formative-conversation-misconception-evidence-closure-v1" as const;

export const FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_ISSUE_CODES = {
  missing: "profile_transition_misconception_claim_closure_missing",
  duplicatePrior:
    "profile_transition_misconception_claim_closure_duplicate_prior_indicator",
  unknownPrior:
    "profile_transition_misconception_claim_closure_unknown_prior_indicator",
  emptyClaims:
    "profile_transition_misconception_claim_closure_empty_claims",
  duplicateClaim:
    "profile_transition_misconception_claim_closure_duplicate_claim",
  resolvedEvidenceMissing:
    "profile_transition_misconception_claim_resolution_evidence_missing",
  resolvedStillCurrent:
    "profile_transition_resolved_misconception_still_current",
  retainedMissing:
    "profile_transition_retained_misconception_missing",
  retainedSemanticsInvalid:
    "profile_transition_retained_misconception_semantics_invalid"
} as const;

export type FormativeConversationMisconceptionEvidenceClosureIssueCode =
  (typeof FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_ISSUE_CODES)[keyof typeof FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_ISSUE_CODES];

export type FormativeConversationMisconceptionAtomicClaim = {
  claim_text: string;
  disposition:
    | "resolved_by_conversation_evidence"
    | "retained_current_misconception";
  evidence_basis: "prior_profile_evidence" | "conversation_evidence" | "combined";
  evidence_summary: string;
  source_turn_sequence_indexes: readonly number[];
};

export type FormativeConversationMisconceptionIndicatorClosure = {
  closure_version: typeof FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_VERSION;
  prior_indicator: string;
  coverage: "all_atomic_claims_represented";
  atomic_claims: readonly FormativeConversationMisconceptionAtomicClaim[];
};

type AvailableTurn = {
  sequence_index: number;
  actor: "student" | "tutor";
};

export type FormativeConversationMisconceptionEvidenceClosureIssue = {
  code: FormativeConversationMisconceptionEvidenceClosureIssueCode;
  field_path: string;
  message: string;
};

const CANONICAL_METADATA_PREFIXES = [
  "evidence reference:",
  "confidence:",
  "rationale:"
] as const;

function normalized(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function normalizedKey(value: string) {
  return normalized(value).toLocaleLowerCase("en-US");
}

export function currentMisconceptionClaims(values: readonly string[]) {
  const claims: string[] = [];
  for (const rawValue of values) {
    const value = normalized(rawValue);
    if (!value) {
      continue;
    }
    const lower = value.toLocaleLowerCase("en-US");
    if (
      CANONICAL_METADATA_PREFIXES.some((prefix) =>
        lower.startsWith(prefix)
      )
    ) {
      continue;
    }
    const claim = lower.startsWith("indicator:")
      ? normalized(value.slice("indicator:".length))
      : value;
    if (
      claim &&
      !claims.some(
        (entry) => normalizedKey(entry) === normalizedKey(claim)
      )
    ) {
      claims.push(claim);
    }
  }
  return claims;
}

function issue(
  code: FormativeConversationMisconceptionEvidenceClosureIssueCode,
  fieldPath: string,
  message: string
): FormativeConversationMisconceptionEvidenceClosureIssue {
  return { code, field_path: fieldPath, message };
}

function claimSetsEqual(left: readonly string[], right: readonly string[]) {
  const leftKeys = [...left].map(normalizedKey).sort();
  const rightKeys = [...right].map(normalizedKey).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((value, index) => value === rightKeys[index])
  );
}

export function validateFormativeConversationMisconceptionEvidenceClosure(input: {
  prior_misconception_indicators: readonly string[];
  updated_misconception_indicators: readonly string[];
  claim_closure:
    | readonly FormativeConversationMisconceptionIndicatorClosure[]
    | undefined;
  available_turns: readonly AvailableTurn[];
}) {
  const priorClaims = currentMisconceptionClaims(
    input.prior_misconception_indicators
  );
  const updatedClaims = currentMisconceptionClaims(
    input.updated_misconception_indicators
  );
  const closure = input.claim_closure ?? [];
  const issues: FormativeConversationMisconceptionEvidenceClosureIssue[] = [];

  if (claimSetsEqual(priorClaims, updatedClaims)) {
    return {
      valid: true as const,
      prior_claims: priorClaims,
      updated_claims: updatedClaims,
      issues: [] as FormativeConversationMisconceptionEvidenceClosureIssue[]
    };
  }

  const priorByKey = new Map(
    priorClaims.map((claim) => [normalizedKey(claim), claim])
  );
  const updatedKeys = new Set(updatedClaims.map(normalizedKey));
  const closureByPrior = new Map<
    string,
    Array<{
      entry: FormativeConversationMisconceptionIndicatorClosure;
      index: number;
    }>
  >();

  closure.forEach((entry, index) => {
    const key = normalizedKey(entry.prior_indicator);
    const entries = closureByPrior.get(key) ?? [];
    entries.push({ entry, index });
    closureByPrior.set(key, entries);
    if (!priorByKey.has(key)) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_ISSUE_CODES.unknownPrior,
          `profile_transition_recommendation.misconception_claim_closure.${index}.prior_indicator`,
          "Misconception closure references an indicator that is not present in the canonical prior profile."
        )
      );
    }
  });

  for (const priorClaim of priorClaims) {
    const key = normalizedKey(priorClaim);
    const entries = closureByPrior.get(key) ?? [];
    if (entries.length === 0) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_ISSUE_CODES.missing,
          "profile_transition_recommendation.misconception_claim_closure",
          `The changed misconception field does not provide atomic claim closure for prior indicator: ${priorClaim}`
        )
      );
      continue;
    }
    if (entries.length > 1) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_ISSUE_CODES.duplicatePrior,
          "profile_transition_recommendation.misconception_claim_closure",
          `The prior misconception indicator has more than one closure record: ${priorClaim}`
        )
      );
      continue;
    }

    const { entry, index: closureIndex } = entries[0];
    if (entry.atomic_claims.length === 0) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_ISSUE_CODES.emptyClaims,
          `profile_transition_recommendation.misconception_claim_closure.${closureIndex}.atomic_claims`,
          "Atomic misconception closure must represent every claim in the prior indicator."
        )
      );
      continue;
    }

    const seenClaims = new Set<string>();
    entry.atomic_claims.forEach((atomicClaim, claimIndex) => {
      const claimKey = normalizedKey(atomicClaim.claim_text);
      const fieldPath =
        `profile_transition_recommendation.misconception_claim_closure.${closureIndex}.atomic_claims.${claimIndex}`;
      if (seenClaims.has(claimKey)) {
        issues.push(
          issue(
            FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_ISSUE_CODES.duplicateClaim,
            `${fieldPath}.claim_text`,
            `Atomic misconception claim is duplicated: ${atomicClaim.claim_text}`
          )
        );
      }
      seenClaims.add(claimKey);

      if (
        atomicClaim.disposition ===
        "resolved_by_conversation_evidence"
      ) {
        const citesStudentTurn = atomicClaim.source_turn_sequence_indexes.some(
          (sequenceIndex) =>
            input.available_turns.some(
              (turn) =>
                turn.sequence_index === sequenceIndex &&
                turn.actor === "student"
            )
        );
        if (
          atomicClaim.evidence_basis === "prior_profile_evidence" ||
          !citesStudentTurn
        ) {
          issues.push(
            issue(
              FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_ISSUE_CODES.resolvedEvidenceMissing,
              `${fieldPath}.source_turn_sequence_indexes`,
              "A resolved misconception claim requires cited conversation evidence from a student turn."
            )
          );
        }
        if (updatedKeys.has(claimKey)) {
          issues.push(
            issue(
              FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_ISSUE_CODES.resolvedStillCurrent,
              `${fieldPath}.claim_text`,
              "A claim marked resolved must not remain in current misconception evidence."
            )
          );
        }
        return;
      }

      if (
        classifyFormativeConversationMisconceptionEvidence(
          atomicClaim.claim_text
        ) !== "current_misconception_evidence"
      ) {
        issues.push(
          issue(
            FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_ISSUE_CODES.retainedSemanticsInvalid,
            `${fieldPath}.claim_text`,
            "A retained claim must describe a current misconception, not a limitation, uncertainty, or resolved history."
          )
        );
      }
      if (!updatedKeys.has(claimKey)) {
        issues.push(
          issue(
            FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_ISSUE_CODES.retainedMissing,
            `${fieldPath}.claim_text`,
            "A partially resolved misconception must preserve every retained atomic claim in the updated profile."
          )
        );
      }
    });
  }

  return issues.length === 0
    ? {
        valid: true as const,
        prior_claims: priorClaims,
        updated_claims: updatedClaims,
        issues: [] as FormativeConversationMisconceptionEvidenceClosureIssue[]
      }
    : {
        valid: false as const,
        prior_claims: priorClaims,
        updated_claims: updatedClaims,
        issues
      };
}
