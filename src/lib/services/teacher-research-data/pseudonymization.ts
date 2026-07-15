import { createHash, createHmac } from "node:crypto";

export const RESEARCH_PSEUDONYMIZATION_HMAC_VERSION = "hmac_sha256_v1" as const;
export const RESEARCH_PSEUDONYMIZATION_LEGACY_VERSION = "legacy_sha256_v1" as const;
export const RESEARCH_PSEUDONYMIZATION_DEFAULT_TEST_KEY =
  "local-test-research-pseudonymization-key-not-for-production";

export type ResearchPseudonymizationVersion =
  | typeof RESEARCH_PSEUDONYMIZATION_HMAC_VERSION
  | typeof RESEARCH_PSEUDONYMIZATION_LEGACY_VERSION;

export type ResearchPseudonymizationMetadata = {
  research_pseudonym_version: ResearchPseudonymizationVersion;
  pseudonymization_method: "HMAC-SHA-256" | "legacy namespace SHA-256";
  pseudonymization_key_fingerprint: string;
  production_ready: boolean;
};

export class ResearchPseudonymizationConfigError extends Error {
  constructor(
    public readonly code:
      | "research_pseudonymization_key_missing"
      | "research_pseudonymization_key_inadequate"
      | "research_pseudonymization_version_invalid"
      | "legacy_pseudonymization_not_allowed_in_production",
    message: string
  ) {
    super(message);
    this.name = "ResearchPseudonymizationConfigError";
  }
}

function canonicalOperationalUserIdentifier(userId: string) {
  return userId.trim().toLowerCase();
}

export function researchPseudonymizationKeyFingerprint(key: string) {
  return createHash("sha256")
    .update(`research_pseudonymization_key_fingerprint:v1:${key}`)
    .digest("hex")
    .slice(0, 12);
}

function legacyResearchStudentId(userId: string) {
  return `rs_${createHash("sha256").update(`research_student_id:v1:${userId}`).digest("hex").slice(0, 20)}`;
}

function requestedVersion(env: NodeJS.ProcessEnv): ResearchPseudonymizationVersion | null {
  const value = env.RESEARCH_PSEUDONYMIZATION_VERSION?.trim();
  if (!value) return null;
  if (value === RESEARCH_PSEUDONYMIZATION_HMAC_VERSION || value === RESEARCH_PSEUDONYMIZATION_LEGACY_VERSION) {
    return value;
  }
  throw new ResearchPseudonymizationConfigError(
    "research_pseudonymization_version_invalid",
    "RESEARCH_PSEUDONYMIZATION_VERSION must be hmac_sha256_v1 or legacy_sha256_v1."
  );
}

function isProductionLike(env: NodeJS.ProcessEnv) {
  return env.APP_ENV === "production";
}

function effectiveVersion(env: NodeJS.ProcessEnv): ResearchPseudonymizationVersion {
  return requestedVersion(env) ?? RESEARCH_PSEUDONYMIZATION_HMAC_VERSION;
}

function resolvedKey(env: NodeJS.ProcessEnv) {
  const key = env.RESEARCH_PSEUDONYMIZATION_KEY?.trim();
  if (key) {
    if (isProductionLike(env) && key.length < 16) {
      throw new ResearchPseudonymizationConfigError(
        "research_pseudonymization_key_inadequate",
        "RESEARCH_PSEUDONYMIZATION_KEY is too short for production research exports."
      );
    }
    return { key, productionReady: true };
  }
  if (isProductionLike(env)) {
    throw new ResearchPseudonymizationConfigError(
      "research_pseudonymization_key_missing",
      "RESEARCH_PSEUDONYMIZATION_KEY is required for production research exports."
    );
  }
  return { key: RESEARCH_PSEUDONYMIZATION_DEFAULT_TEST_KEY, productionReady: false };
}

export function researchPseudonymizationMetadata(env: NodeJS.ProcessEnv = process.env): ResearchPseudonymizationMetadata {
  const version = effectiveVersion(env);
  if (version === RESEARCH_PSEUDONYMIZATION_LEGACY_VERSION) {
    if (isProductionLike(env)) {
      throw new ResearchPseudonymizationConfigError(
        "legacy_pseudonymization_not_allowed_in_production",
        "legacy_sha256_v1 pseudonymization is not allowed for production research exports."
      );
    }
    return {
      research_pseudonym_version: RESEARCH_PSEUDONYMIZATION_LEGACY_VERSION,
      pseudonymization_method: "legacy namespace SHA-256",
      pseudonymization_key_fingerprint: "legacy_sha256_no_key",
      production_ready: false
    };
  }

  const { key, productionReady } = resolvedKey(env);
  return {
    research_pseudonym_version: RESEARCH_PSEUDONYMIZATION_HMAC_VERSION,
    pseudonymization_method: "HMAC-SHA-256",
    pseudonymization_key_fingerprint: researchPseudonymizationKeyFingerprint(key),
    production_ready: productionReady
  };
}

export function assertResearchPseudonymizationReadyForExport(env: NodeJS.ProcessEnv = process.env) {
  researchPseudonymizationMetadata(env);
}

export function researchStudentId(userId: string, env: NodeJS.ProcessEnv = process.env) {
  const version = effectiveVersion(env);
  if (version === RESEARCH_PSEUDONYMIZATION_LEGACY_VERSION) return legacyResearchStudentId(userId);

  const { key } = resolvedKey(env);
  const digest = createHmac("sha256", key)
    .update(`research_student_id:hmac_sha256_v1:${canonicalOperationalUserIdentifier(userId)}`)
    .digest("hex")
    .slice(0, 20);
  return `rs_${digest}`;
}
