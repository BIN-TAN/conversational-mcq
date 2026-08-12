import { z } from "zod";
import {
  CanonicalMisconceptionClaimCatalogSchema,
  MISCONCEPTION_CLAIM_IDENTITY_VERSION,
  type CanonicalMisconceptionClaimCatalog
} from "@/lib/domain/misconception-claim-identity";

export const FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_VERSION =
  "formative-conversation-misconception-claim-closure-v2" as const;

export const FormativeConversationMisconceptionClaimDispositionSchema = z
  .object({
    identity_version: z.literal(MISCONCEPTION_CLAIM_IDENTITY_VERSION),
    indicator_id: z.string().regex(/^mi_[a-f0-9]{24}$/u),
    claim_id: z.string().regex(/^mc_[a-f0-9]{24}$/u),
    disposition: z.enum(["resolved", "retained"]),
    evidence_basis: z.enum([
      "prior_profile_evidence",
      "conversation_evidence",
      "combined"
    ]),
    evidence_summary: z.string().trim().min(1).max(1_200),
    source_turn_sequence_indexes: z
      .array(z.number().int().positive())
      .max(40)
  })
  .strict();

export type FormativeConversationMisconceptionClaimDisposition = z.infer<
  typeof FormativeConversationMisconceptionClaimDispositionSchema
>;

export const FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_ISSUE_CODES = {
  identityVersion:
    "profile_transition_misconception_claim_identity_version_invalid",
  unknownIndicator:
    "profile_transition_misconception_claim_indicator_unknown",
  unknownClaim: "profile_transition_misconception_claim_unknown",
  claimIndicatorMismatch:
    "profile_transition_misconception_claim_indicator_mismatch",
  duplicateClaim: "profile_transition_misconception_claim_duplicate",
  missingClaim: "profile_transition_misconception_claim_disposition_missing",
  resolvedEvidenceMissing:
    "profile_transition_misconception_claim_resolution_evidence_missing"
} as const;

export type FormativeConversationMisconceptionClaimClosureIssueCode =
  (typeof FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_ISSUE_CODES)[keyof typeof FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_ISSUE_CODES];

export type FormativeConversationMisconceptionClaimClosureIssue = {
  code: FormativeConversationMisconceptionClaimClosureIssueCode;
  field_path: string;
  message: string;
};

type AvailableTurn = {
  sequence_index: number;
  actor: "student" | "tutor";
};

function issue(
  code: FormativeConversationMisconceptionClaimClosureIssueCode,
  fieldPath: string,
  message: string
): FormativeConversationMisconceptionClaimClosureIssue {
  return { code, field_path: fieldPath, message };
}

export function projectCanonicalMisconceptionClaimCatalog(input: {
  prior_catalog: CanonicalMisconceptionClaimCatalog;
  retained_claim_ids: ReadonlySet<string>;
}) {
  return CanonicalMisconceptionClaimCatalogSchema.parse({
    ...input.prior_catalog,
    indicators: input.prior_catalog.indicators.flatMap((indicator) => {
      const claims = indicator.claims.filter((claim) =>
        input.retained_claim_ids.has(claim.claim_id)
      );
      return claims.length === 0 ? [] : [{ ...indicator, claims }];
    })
  });
}

export function validateFormativeConversationMisconceptionClaimClosure(input: {
  prior_catalog: CanonicalMisconceptionClaimCatalog;
  claim_dispositions: readonly FormativeConversationMisconceptionClaimDisposition[];
  available_turns: readonly AvailableTurn[];
}) {
  const issues: FormativeConversationMisconceptionClaimClosureIssue[] = [];
  const indicatorsById = new Map(
    input.prior_catalog.indicators.map((indicator) => [
      indicator.indicator_id,
      indicator
    ])
  );
  const claimsById = new Map(
    input.prior_catalog.indicators.flatMap((indicator) =>
      indicator.claims.map((claim) => [
        claim.claim_id,
        { indicator, claim }
      ] as const)
    )
  );
  const dispositionsByClaimId = new Map<
    string,
    Array<{
      disposition: FormativeConversationMisconceptionClaimDisposition;
      index: number;
    }>
  >();

  input.claim_dispositions.forEach((disposition, index) => {
    const fieldPath =
      `profile_transition_recommendation.misconception_claim_dispositions.${index}`;
    if (disposition.identity_version !== MISCONCEPTION_CLAIM_IDENTITY_VERSION) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_ISSUE_CODES.identityVersion,
          `${fieldPath}.identity_version`,
          "The claim disposition does not use the active canonical identity contract."
        )
      );
    }
    if (!indicatorsById.has(disposition.indicator_id)) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_ISSUE_CODES.unknownIndicator,
          `${fieldPath}.indicator_id`,
          "The claim disposition references an indicator outside the current canonical catalog."
        )
      );
    }
    const canonical = claimsById.get(disposition.claim_id);
    if (!canonical) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_ISSUE_CODES.unknownClaim,
          `${fieldPath}.claim_id`,
          "The claim disposition references a claim outside the current canonical catalog."
        )
      );
    } else if (
      canonical.indicator.indicator_id !== disposition.indicator_id
    ) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_ISSUE_CODES.claimIndicatorMismatch,
          `${fieldPath}.indicator_id`,
          "The claim ID belongs to a different canonical indicator."
        )
      );
    }

    const entries = dispositionsByClaimId.get(disposition.claim_id) ?? [];
    entries.push({ disposition, index });
    dispositionsByClaimId.set(disposition.claim_id, entries);
  });

  for (const [claimId, canonical] of claimsById) {
    const entries = dispositionsByClaimId.get(claimId) ?? [];
    if (entries.length === 0) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_ISSUE_CODES.missingClaim,
          "profile_transition_recommendation.misconception_claim_dispositions",
          `The transition omits a disposition for canonical claim ${claimId}.`
        )
      );
      continue;
    }
    if (entries.length > 1) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_ISSUE_CODES.duplicateClaim,
          "profile_transition_recommendation.misconception_claim_dispositions",
          `The transition repeats canonical claim ${claimId}.`
        )
      );
      continue;
    }

    const { disposition, index } = entries[0];
    if (disposition.disposition !== "resolved") {
      continue;
    }
    const citesStudentEvidence =
      disposition.evidence_basis !== "prior_profile_evidence" &&
      disposition.source_turn_sequence_indexes.some((sequenceIndex) =>
        input.available_turns.some(
          (turn) =>
            turn.sequence_index === sequenceIndex && turn.actor === "student"
        )
      );
    if (!citesStudentEvidence) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_ISSUE_CODES.resolvedEvidenceMissing,
          `profile_transition_recommendation.misconception_claim_dispositions.${index}.source_turn_sequence_indexes`,
          `Resolved claim ${canonical.claim.claim_id} requires cited student conversation evidence.`
        )
      );
    }
  }

  for (const [claimId, entries] of dispositionsByClaimId) {
    if (entries.length > 1 && !claimsById.has(claimId)) {
      issues.push(
        issue(
          FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_ISSUE_CODES.duplicateClaim,
          "profile_transition_recommendation.misconception_claim_dispositions",
          `The transition repeats unknown claim ${claimId}.`
        )
      );
    }
  }

  const retainedClaimIds = new Set(
    input.claim_dispositions
      .filter(
        (disposition) =>
          disposition.disposition === "retained" &&
          claimsById.has(disposition.claim_id)
      )
      .map((disposition) => disposition.claim_id)
  );
  const updatedCatalog = projectCanonicalMisconceptionClaimCatalog({
    prior_catalog: input.prior_catalog,
    retained_claim_ids: retainedClaimIds
  });

  return issues.length === 0
    ? {
        valid: true as const,
        issues: [] as FormativeConversationMisconceptionClaimClosureIssue[],
        updated_catalog: updatedCatalog
      }
    : {
        valid: false as const,
        issues,
        updated_catalog: updatedCatalog
      };
}
