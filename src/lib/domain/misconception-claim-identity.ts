import { createHash } from "node:crypto";
import { z } from "zod";

export const MISCONCEPTION_CLAIM_IDENTITY_VERSION =
  "misconception-claim-identity-v1" as const;

const PlatformIndicatorIdSchema = z.string().regex(/^mi_[a-f0-9]{24}$/u);
const PlatformClaimIdSchema = z.string().regex(/^mc_[a-f0-9]{24}$/u);
const ProfileScopeIdSchema = z.string().regex(/^mp_[a-f0-9]{24}$/u);
const EvidenceReferenceSchema = z.string().trim().min(1).max(240);

export const StudentProfileAtomicMisconceptionClaimSchema = z
  .object({
    claim_text: z.string().trim().min(1).max(1_200),
    source_evidence_references: z
      .array(EvidenceReferenceSchema)
      .min(1)
      .max(20)
  })
  .strict();

export const CanonicalMisconceptionClaimSchema = z
  .object({
    claim_id: PlatformClaimIdSchema,
    claim_text: z.string().trim().min(1).max(1_200),
    source_evidence_refs: z.array(EvidenceReferenceSchema).min(1).max(20)
  })
  .strict();

export const CanonicalMisconceptionIndicatorSchema = z
  .object({
    indicator_id: PlatformIndicatorIdSchema,
    indicator_text: z.string().trim().min(1).max(1_200),
    source_evidence_refs: z.array(EvidenceReferenceSchema).min(1).max(40),
    indicator_confidence: z.enum(["low", "medium", "high"]),
    indicator_rationale: z.string().trim().min(1).max(1_200).nullable(),
    claims: z.array(CanonicalMisconceptionClaimSchema).min(1).max(20)
  })
  .strict();

export const CanonicalMisconceptionClaimCatalogSchema = z
  .object({
    identity_version: z.literal(MISCONCEPTION_CLAIM_IDENTITY_VERSION),
    profile_scope_id: ProfileScopeIdSchema,
    indicators: z.array(CanonicalMisconceptionIndicatorSchema).max(20)
  })
  .strict();

export type StudentProfileAtomicMisconceptionClaim = z.infer<
  typeof StudentProfileAtomicMisconceptionClaimSchema
>;
export type CanonicalMisconceptionClaim = z.infer<
  typeof CanonicalMisconceptionClaimSchema
>;
export type CanonicalMisconceptionIndicator = z.infer<
  typeof CanonicalMisconceptionIndicatorSchema
>;
export type CanonicalMisconceptionClaimCatalog = z.infer<
  typeof CanonicalMisconceptionClaimCatalogSchema
>;

type ValidatedProfileIndicator = {
  indicator: string;
  evidence_reference: string | null;
  confidence: "low" | "medium" | "high";
  rationale: string | null;
  atomic_claims: readonly StudentProfileAtomicMisconceptionClaim[];
};

export class MisconceptionClaimIdentityError extends Error {
  constructor(
    public readonly code:
      | "misconception_claim_identity_scope_missing"
      | "misconception_indicator_duplicate"
      | "misconception_atomic_claim_duplicate"
      | "legacy_misconception_claim_catalog_unavailable",
    message: string
  ) {
    super(message);
    this.name = "MisconceptionClaimIdentityError";
  }
}

function normalizedText(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function normalizedKey(value: string) {
  return normalizedText(value).toLocaleLowerCase("en-US");
}

function stableId(prefix: "mi" | "mc" | "mp", material: string) {
  return `${prefix}_${createHash("sha256")
    .update(`${MISCONCEPTION_CLAIM_IDENTITY_VERSION}\u0000${material}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function uniqueEvidenceReferences(values: readonly string[]) {
  return [...new Set(values.map(normalizedText).filter(Boolean))].sort();
}

export function emptyCanonicalMisconceptionClaimCatalog(identityScope: string) {
  const scope = normalizedText(identityScope);
  if (!scope) {
    throw new MisconceptionClaimIdentityError(
      "misconception_claim_identity_scope_missing",
      "A canonical misconception catalog requires a stable platform scope."
    );
  }
  return CanonicalMisconceptionClaimCatalogSchema.parse({
    identity_version: MISCONCEPTION_CLAIM_IDENTITY_VERSION,
    profile_scope_id: stableId("mp", scope),
    indicators: []
  });
}

export function createCanonicalMisconceptionClaimCatalog(input: {
  identity_scope: string;
  indicators: readonly ValidatedProfileIndicator[];
}): CanonicalMisconceptionClaimCatalog {
  const empty = emptyCanonicalMisconceptionClaimCatalog(input.identity_scope);
  const seenIndicators = new Set<string>();
  const indicators = input.indicators.map((indicator, indicatorIndex) => {
    const indicatorText = normalizedText(indicator.indicator);
    const indicatorKey = normalizedKey(indicatorText);
    if (seenIndicators.has(indicatorKey)) {
      throw new MisconceptionClaimIdentityError(
        "misconception_indicator_duplicate",
        `The validated profile repeats misconception indicator ${indicatorIndex + 1}.`
      );
    }
    seenIndicators.add(indicatorKey);

    const indicatorId = stableId(
      "mi",
      `${empty.profile_scope_id}\u0000${indicatorIndex}`
    );
    const seenClaims = new Set<string>();
    const claims = indicator.atomic_claims.map((claim, claimIndex) => {
      const claimText = normalizedText(claim.claim_text);
      const claimKey = normalizedKey(claimText);
      if (seenClaims.has(claimKey)) {
        throw new MisconceptionClaimIdentityError(
          "misconception_atomic_claim_duplicate",
          `The validated indicator repeats atomic claim ${claimIndex + 1}.`
        );
      }
      seenClaims.add(claimKey);
      return {
        claim_id: stableId(
          "mc",
          `${empty.profile_scope_id}\u0000${indicatorId}\u0000${claimIndex}`
        ),
        claim_text: claimText,
        source_evidence_refs: uniqueEvidenceReferences(
          claim.source_evidence_references
        )
      };
    });
    const sourceEvidenceRefs = uniqueEvidenceReferences([
      ...(indicator.evidence_reference ? [indicator.evidence_reference] : []),
      ...claims.flatMap((claim) => claim.source_evidence_refs)
    ]);

    return {
      indicator_id: indicatorId,
      indicator_text: indicatorText,
      source_evidence_refs: sourceEvidenceRefs,
      indicator_confidence: indicator.confidence,
      indicator_rationale: indicator.rationale
        ? normalizedText(indicator.rationale)
        : null,
      claims
    };
  });

  return CanonicalMisconceptionClaimCatalogSchema.parse({
    ...empty,
    indicators
  });
}

export function parseCanonicalMisconceptionClaimCatalog(value: unknown) {
  const parsed = CanonicalMisconceptionClaimCatalogSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function requireCanonicalMisconceptionClaimCatalog(input: {
  value: unknown;
  legacy_profile_scope: string;
}) {
  const parsed = parseCanonicalMisconceptionClaimCatalog(input.value);
  if (parsed) {
    return parsed;
  }
  if (Array.isArray(input.value) && input.value.length === 0) {
    return emptyCanonicalMisconceptionClaimCatalog(
      `legacy-empty:${input.legacy_profile_scope}`
    );
  }
  throw new MisconceptionClaimIdentityError(
    "legacy_misconception_claim_catalog_unavailable",
    "A nonempty legacy misconception profile cannot enter V17 generation without validated atomic claims."
  );
}

export function canonicalMisconceptionClaimTexts(
  catalog: CanonicalMisconceptionClaimCatalog
) {
  return catalog.indicators.flatMap((indicator) =>
    indicator.claims.map((claim) => claim.claim_text)
  );
}

export function canonicalMisconceptionClaimIds(
  catalog: CanonicalMisconceptionClaimCatalog
) {
  return catalog.indicators.flatMap((indicator) =>
    indicator.claims.map((claim) => claim.claim_id)
  );
}

export function canonicalMisconceptionIndicatorIds(
  catalog: CanonicalMisconceptionClaimCatalog
) {
  return catalog.indicators.map((indicator) => indicator.indicator_id);
}
