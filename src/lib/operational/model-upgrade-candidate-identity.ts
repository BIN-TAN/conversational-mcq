import { stableHash } from "./stable-hash";

export type RuntimeCandidateIdentityInput = {
  roles: Record<string, unknown>;
  runtime_policy?: unknown;
  configuration_fingerprint?: {
    semantic_validator_version: string;
    safety_validator_version: string;
    effective_result_version: string;
    effective_validator_version: string;
    deterministic_guard_versions: Record<string, string>;
    canonicalization_versions: Record<string, string>;
    fallback_versions: Record<string, string>;
    role_version_metadata: Record<string, unknown>;
  };
};

export function modelUpgradeCandidateRuntimeSnapshot(
  candidate: RuntimeCandidateIdentityInput,
  orderedRoles: readonly string[]
) {
  const fingerprint = candidate.configuration_fingerprint;
  return {
    roles: Object.fromEntries(orderedRoles.map((role) => [role, candidate.roles[role]])),
    runtime_policy: candidate.runtime_policy ?? null,
    production_versions: fingerprint
      ? {
          semantic_validator_version: fingerprint.semantic_validator_version,
          safety_validator_version: fingerprint.safety_validator_version,
          effective_result_version: fingerprint.effective_result_version,
          effective_validator_version: fingerprint.effective_validator_version,
          deterministic_guard_versions: fingerprint.deterministic_guard_versions,
          canonicalization_versions: fingerprint.canonicalization_versions,
          fallback_versions: fingerprint.fallback_versions,
          role_version_metadata: fingerprint.role_version_metadata
        }
      : null
  };
}

export function modelUpgradeCandidateRuntimeHash(
  candidate: RuntimeCandidateIdentityInput,
  orderedRoles: readonly string[]
) {
  return stableHash(modelUpgradeCandidateRuntimeSnapshot(candidate, orderedRoles));
}
