import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  TOPIC_DIALOGUE_ENVELOPE_VALIDATION_PROVENANCE_V1_VERSION,
  TOPIC_DIALOGUE_PEDAGOGICAL_RUBRIC_V1_VERSION,
  TOPIC_DIALOGUE_REGENERATION_POLICY_V2_VERSION,
  TOPIC_DIALOGUE_REVIEW_FLAG_SCHEMA_V1_VERSION
} from "@/lib/services/student-assessment/topic-dialogue-runtime-validation-v2";
import {
  TOPIC_DIALOGUE_PROTECTED_HARD_REJECTION_POLICY_V1_VERSION,
  TOPIC_DIALOGUE_PROTECTED_REQUEST_POLICY_V1_VERSION,
  TOPIC_DIALOGUE_RUNTIME_VALIDATOR_V3_VERSION,
  TOPIC_DIALOGUE_VALIDATION_POLICY_V3_VERSION
} from "@/lib/services/student-assessment/topic-dialogue-runtime-validation-v3";
import {
  changedPaths,
  E2A4_APPROVED_V2_HASH,
  readE2A4BaselineManifest,
  sha256,
  type E2A4BaselineManifest
} from "./e2a4-topic-dialogue-contract";
import {
  E2A11_CANDIDATE_FILE_SHA256,
  E2A11_CANDIDATE_HASH,
  E2A11_CANDIDATE_PATH,
  deriveE2A11FullCandidate
} from "./e2a11-v8-validator-candidate";

export const E2A14_CANDIDATE_PATH = path.join(
  process.cwd(),
  "config",
  "candidate-operational-agent-config.e2a14-protected-request-validator-calibration-v1.json"
);

export const E2A14_CANDIDATE_HASH =
  "f6b4eaaf22f4342d4ccfd37bd3bc10aa75c31206343a84c27abfbde8fbbbc58a";
export const E2A14_CANDIDATE_FILE_SHA256 =
  "a229603d767bf4fa0adc19a0b31a60c976bd3ee0cb0ad3dcfed05a30663790e8";

const DeltaSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1)
}).strict();

export const E2A14CandidateManifestSchema = z.object({
  manifest_version: z.literal(
    "e2a14-protected-request-validator-calibration-candidate-v1"
  ),
  approval_state: z.literal("candidate_not_approved"),
  activation_state: z.literal("not_activated"),
  baseline_approved_runtime_hash: z.literal(E2A4_APPROVED_V2_HASH),
  v8_candidate_hash: z.literal(E2A11_CANDIDATE_HASH),
  v8_candidate_path: z.string().min(1),
  v8_candidate_sha256: z.literal(E2A11_CANDIDATE_FILE_SHA256),
  candidate_profile_name: z.string().min(1),
  evaluation_required: z.literal(true),
  human_review_required: z.literal(true),
  student_facing_operational_use_approved: z.literal(false),
  teacher_tool_use_approved: z.literal(false),
  roles_unchanged_from_v8: z.literal(true),
  prompts_unchanged_from_v8: z.literal(true),
  schemas_unchanged_from_v8: z.literal(true),
  routing_unchanged_from_v8: z.literal(true),
  model_and_runtime_policy_unchanged_from_v8: z.literal(true),
  topic_dialogue_validation: z.object({
    runtime_validator_version: z.literal(
      TOPIC_DIALOGUE_RUNTIME_VALIDATOR_V3_VERSION
    ),
    pedagogical_rubric_version: z.literal(
      TOPIC_DIALOGUE_PEDAGOGICAL_RUBRIC_V1_VERSION
    ),
    validation_policy_version: z.literal(
      TOPIC_DIALOGUE_VALIDATION_POLICY_V3_VERSION
    ),
    protected_request_validation_policy_version: z.literal(
      TOPIC_DIALOGUE_PROTECTED_REQUEST_POLICY_V1_VERSION
    ),
    protected_request_hard_rejection_policy_version: z.literal(
      TOPIC_DIALOGUE_PROTECTED_HARD_REJECTION_POLICY_V1_VERSION
    ),
    regeneration_trigger_policy_version: z.literal(
      TOPIC_DIALOGUE_REGENERATION_POLICY_V2_VERSION
    ),
    review_flag_schema_version: z.literal(
      TOPIC_DIALOGUE_REVIEW_FLAG_SCHEMA_V1_VERSION
    ),
    server_envelope_validation_provenance_version: z.literal(
      TOPIC_DIALOGUE_ENVELOPE_VALIDATION_PROVENANCE_V1_VERSION
    ),
    runtime_acceptance_levels: z.tuple([
      z.literal("accepted"),
      z.literal("accepted_with_review_flags"),
      z.literal("hard_rejected")
    ]),
    safe_refusal_may_name_protected_object: z.literal(true),
    actual_disclosure_hard_rejected: z.literal(true),
    protected_disclosure_requires_exact_evidence: z.literal(true),
    protected_disclosure_requires_explanation: z.literal(true),
    soft_findings_trigger_regeneration: z.literal(false),
    soft_findings_trigger_fallback: z.literal(false),
    maximum_regenerations_per_turn: z.literal(1)
  }).strict(),
  exact_delta_from_v8: z.record(z.string(), DeltaSchema),
  acceptance_criteria: z.record(z.string(), z.literal(true))
}).strict();

export function readE2A14CandidateManifest() {
  const raw = readFileSync(E2A14_CANDIDATE_PATH, "utf8");
  return {
    candidate: E2A14CandidateManifestSchema.parse(JSON.parse(raw)),
    raw,
    file_sha256: sha256(raw)
  };
}

export function deriveE2A14FullCandidate(
  baseline: E2A4BaselineManifest = readE2A4BaselineManifest()
) {
  const derived = deriveE2A11FullCandidate(baseline);
  const metadata =
    derived.configuration_fingerprint.role_version_metadata.topic_dialogue_agent;
  if (!metadata) throw new Error("e2a14_topic_dialogue_role_metadata_missing");
  metadata.validator_version = TOPIC_DIALOGUE_RUNTIME_VALIDATOR_V3_VERSION;
  metadata.validation_policy_version = TOPIC_DIALOGUE_VALIDATION_POLICY_V3_VERSION;
  metadata.protected_request_validation_policy_version =
    TOPIC_DIALOGUE_PROTECTED_REQUEST_POLICY_V1_VERSION;
  metadata.protected_request_hard_rejection_policy_version =
    TOPIC_DIALOGUE_PROTECTED_HARD_REJECTION_POLICY_V1_VERSION;
  return derived;
}

function roleHashes(candidate: E2A4BaselineManifest) {
  return Object.fromEntries(Object.keys(candidate.roles).sort().map((role) => [
    role,
    stableHash({
      role,
      model_config: candidate.roles[role],
      version_metadata:
        candidate.configuration_fingerprint.role_version_metadata[role] ?? null,
      runtime_policy: role === "topic_dialogue_agent"
        ? candidate.runtime_policy.topic_dialogue_policy
        : null
    })
  ]));
}

export function evaluateE2A14Candidate(options: {
  enforce_expected_hashes?: boolean;
} = {}) {
  const manifest = readE2A14CandidateManifest();
  const baseline = readE2A4BaselineManifest();
  const v8 = deriveE2A11FullCandidate(baseline);
  const candidate = deriveE2A14FullCandidate(baseline);
  const v8RoleHashes = roleHashes(v8);
  const candidateRoleHashes = roleHashes(candidate);
  const unrelatedRoleHashMismatches = Object.keys(candidateRoleHashes).filter(
    (role) => role !== "topic_dialogue_agent" &&
      candidateRoleHashes[role] !== v8RoleHashes[role]
  );
  const deltaFromV8 = changedPaths(v8, candidate);
  const allowedDeltaPaths = Object.keys(manifest.candidate.exact_delta_from_v8)
    .map((key) => key.replace(
      "topic_dialogue_agent.",
      "configuration_fingerprint.role_version_metadata.topic_dialogue_agent."
    ))
    .sort();
  if (unrelatedRoleHashMismatches.length > 0) {
    throw new Error(
      `e2a14_unrelated_role_changed:${unrelatedRoleHashMismatches.join(",")}`
    );
  }
  if (JSON.stringify([...deltaFromV8].sort()) !==
    JSON.stringify(allowedDeltaPaths)) {
    throw new Error(`e2a14_delta_outside_validator_policy:${deltaFromV8.join(",")}`);
  }
  const candidateConfigurationHash = stableHash(candidate);
  if (options.enforce_expected_hashes !== false && (
    candidateConfigurationHash !== E2A14_CANDIDATE_HASH ||
    manifest.file_sha256 !== E2A14_CANDIDATE_FILE_SHA256
  )) {
    throw new Error("e2a14_candidate_hash_not_reproducible");
  }
  const v8Metadata =
    v8.configuration_fingerprint.role_version_metadata.topic_dialogue_agent;
  const candidateMetadata =
    candidate.configuration_fingerprint.role_version_metadata.topic_dialogue_agent;
  return {
    candidate: manifest.candidate,
    candidate_configuration_hash: candidateConfigurationHash,
    candidate_file_sha256: manifest.file_sha256,
    full_candidate: candidate,
    v8_full_candidate: v8,
    role_config_hashes: candidateRoleHashes,
    inherited_role_hashes: Object.fromEntries(
      Object.entries(candidateRoleHashes).filter(([role]) =>
        role !== "topic_dialogue_agent"
      )
    ),
    exact_delta_paths_from_v8: deltaFromV8,
    exact_delta_paths_from_approved_v2: changedPaths(baseline, candidate),
    v8_prompt_metadata_unchanged:
      v8Metadata?.prompt_hash === candidateMetadata?.prompt_hash,
    v8_input_schema_metadata_unchanged:
      v8Metadata?.input_schema_version === candidateMetadata?.input_schema_version,
    v8_output_schema_metadata_unchanged:
      v8Metadata?.output_schema_version === candidateMetadata?.output_schema_version,
    v8_model_and_runtime_policy_unchanged:
      JSON.stringify(v8.roles) === JSON.stringify(candidate.roles) &&
      JSON.stringify(v8.runtime_policy) === JSON.stringify(candidate.runtime_policy),
    unrelated_role_configuration_changed: false,
    approved_v2_hash: E2A4_APPROVED_V2_HASH,
    v8_hash: E2A11_CANDIDATE_HASH,
    v8_file_sha256: E2A11_CANDIDATE_FILE_SHA256,
    v8_candidate_path: E2A11_CANDIDATE_PATH,
    candidate_approved: false,
    candidate_activated: false
  };
}
