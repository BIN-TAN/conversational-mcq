import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  TOPIC_DIALOGUE_ENVELOPE_VALIDATION_PROVENANCE_V1_VERSION,
  TOPIC_DIALOGUE_PEDAGOGICAL_RUBRIC_V1_VERSION,
  TOPIC_DIALOGUE_REGENERATION_POLICY_V2_VERSION,
  TOPIC_DIALOGUE_REVIEW_FLAG_SCHEMA_V1_VERSION,
  TOPIC_DIALOGUE_RUNTIME_VALIDATOR_V2_VERSION,
  TOPIC_DIALOGUE_VALIDATION_POLICY_V2_VERSION
} from "@/lib/services/student-assessment/topic-dialogue-runtime-validation-v2";
import {
  changedPaths,
  E2A4_APPROVED_V2_HASH,
  readE2A4BaselineManifest,
  sha256,
  type E2A4BaselineManifest
} from "./e2a4-topic-dialogue-contract";
import {
  E2A9_CANDIDATE_FILE_SHA256,
  E2A9_CANDIDATE_HASH,
  E2A9_CANDIDATE_PATH,
  deriveE2A9FullCandidate
} from "./e2a9-topic-dialogue-operation-candidate";

export const E2A11_CANDIDATE_PATH = path.join(
  process.cwd(),
  "config",
  "candidate-operational-agent-config.e2a11-topic-dialogue-validator-calibration-v1.json"
);

export const E2A11_CANDIDATE_HASH =
  "7f12d942aae671847b0555ae7322a4b98565b5c355771f20e2de6782ebc960a9";
export const E2A11_CANDIDATE_FILE_SHA256 =
  "10ed9433541aca94216d91fe4f4fd4717208ba89393101e1075978e4b9681307";

const DeltaSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1)
}).strict();

export const E2A11CandidateManifestSchema = z.object({
  manifest_version: z.literal(
    "e2a11-topic-dialogue-validator-calibration-candidate-v1"
  ),
  approval_state: z.literal("candidate_not_approved"),
  activation_state: z.literal("not_activated"),
  baseline_approved_runtime_hash: z.literal(E2A4_APPROVED_V2_HASH),
  failed_v7_candidate_hash: z.literal(E2A9_CANDIDATE_HASH),
  failed_v7_candidate_path: z.string().min(1),
  failed_v7_candidate_sha256: z.literal(E2A9_CANDIDATE_FILE_SHA256),
  candidate_profile_name: z.string().min(1),
  evaluation_required: z.literal(true),
  human_review_required: z.literal(true),
  student_facing_operational_use_approved: z.literal(false),
  teacher_tool_use_approved: z.literal(false),
  roles_unchanged_from_v7: z.literal(true),
  prompts_unchanged_from_v7: z.literal(true),
  schemas_unchanged_from_v7: z.literal(true),
  routing_unchanged_from_v7: z.literal(true),
  model_and_runtime_policy_unchanged_from_v7: z.literal(true),
  topic_dialogue_validation: z.object({
    runtime_validator_version: z.literal(
      TOPIC_DIALOGUE_RUNTIME_VALIDATOR_V2_VERSION
    ),
    pedagogical_rubric_version: z.literal(
      TOPIC_DIALOGUE_PEDAGOGICAL_RUBRIC_V1_VERSION
    ),
    validation_policy_version: z.literal(
      TOPIC_DIALOGUE_VALIDATION_POLICY_V2_VERSION
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
    soft_findings_trigger_regeneration: z.literal(false),
    soft_findings_trigger_fallback: z.literal(false),
    hard_text_rejection_requires_evidence: z.literal(true),
    maximum_regenerations_per_turn: z.literal(1)
  }).strict(),
  exact_delta_from_v7: z.record(z.string(), DeltaSchema),
  acceptance_criteria: z.record(z.string(), z.literal(true))
}).strict();

export function readE2A11CandidateManifest() {
  const raw = readFileSync(E2A11_CANDIDATE_PATH, "utf8");
  return {
    candidate: E2A11CandidateManifestSchema.parse(JSON.parse(raw)),
    raw,
    file_sha256: sha256(raw)
  };
}

export function deriveE2A11FullCandidate(
  baseline: E2A4BaselineManifest = readE2A4BaselineManifest()
) {
  const derived = deriveE2A9FullCandidate(baseline);
  const metadata =
    derived.configuration_fingerprint.role_version_metadata.topic_dialogue_agent;
  if (!metadata) throw new Error("e2a11_topic_dialogue_role_metadata_missing");
  metadata.validator_version = TOPIC_DIALOGUE_RUNTIME_VALIDATOR_V2_VERSION;
  metadata.pedagogical_evaluation_rubric_version =
    TOPIC_DIALOGUE_PEDAGOGICAL_RUBRIC_V1_VERSION;
  metadata.validation_policy_version = TOPIC_DIALOGUE_VALIDATION_POLICY_V2_VERSION;
  metadata.regeneration_trigger_policy_version =
    TOPIC_DIALOGUE_REGENERATION_POLICY_V2_VERSION;
  metadata.review_flag_schema_version =
    TOPIC_DIALOGUE_REVIEW_FLAG_SCHEMA_V1_VERSION;
  metadata.server_envelope_validation_provenance_version =
    TOPIC_DIALOGUE_ENVELOPE_VALIDATION_PROVENANCE_V1_VERSION;
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

export function evaluateE2A11Candidate(options: {
  enforce_expected_hashes?: boolean;
} = {}) {
  const manifest = readE2A11CandidateManifest();
  const baseline = readE2A4BaselineManifest();
  const v7 = deriveE2A9FullCandidate(baseline);
  const v8 = deriveE2A11FullCandidate(baseline);
  const v7RoleHashes = roleHashes(v7);
  const v8RoleHashes = roleHashes(v8);
  const unrelatedRoleHashMismatches = Object.keys(v8RoleHashes).filter(
    (role) => role !== "topic_dialogue_agent" &&
      v8RoleHashes[role] !== v7RoleHashes[role]
  );
  const deltaFromV7 = changedPaths(v7, v8);
  const allowedDeltaPaths = Object.keys(manifest.candidate.exact_delta_from_v7)
    .map((key) => key.replace("topic_dialogue_agent.",
      "configuration_fingerprint.role_version_metadata.topic_dialogue_agent."))
    .sort();
  if (unrelatedRoleHashMismatches.length > 0) {
    throw new Error(
      `e2a11_unrelated_role_changed:${unrelatedRoleHashMismatches.join(",")}`
    );
  }
  if (JSON.stringify([...deltaFromV7].sort()) !== JSON.stringify(allowedDeltaPaths)) {
    throw new Error(`e2a11_delta_outside_validation_policy:${deltaFromV7.join(",")}`);
  }
  const candidateConfigurationHash = stableHash(v8);
  if (options.enforce_expected_hashes !== false && (
    candidateConfigurationHash !== E2A11_CANDIDATE_HASH ||
    manifest.file_sha256 !== E2A11_CANDIDATE_FILE_SHA256
  )) {
    throw new Error("e2a11_candidate_hash_not_reproducible");
  }
  return {
    candidate: manifest.candidate,
    candidate_configuration_hash: candidateConfigurationHash,
    candidate_file_sha256: manifest.file_sha256,
    full_candidate: v8,
    v7_full_candidate: v7,
    role_config_hashes: v8RoleHashes,
    inherited_role_hashes: Object.fromEntries(
      Object.entries(v8RoleHashes).filter(([role]) =>
        role !== "topic_dialogue_agent"
      )
    ),
    exact_delta_paths_from_v7: deltaFromV7,
    exact_delta_paths_from_approved_v2: changedPaths(baseline, v8),
    v7_prompt_metadata_unchanged:
      v7.configuration_fingerprint.role_version_metadata.topic_dialogue_agent
        ?.prompt_hash ===
      v8.configuration_fingerprint.role_version_metadata.topic_dialogue_agent
        ?.prompt_hash,
    v7_schema_metadata_unchanged:
      v7.configuration_fingerprint.role_version_metadata.topic_dialogue_agent
        ?.output_schema_version ===
      v8.configuration_fingerprint.role_version_metadata.topic_dialogue_agent
        ?.output_schema_version,
    unrelated_role_configuration_changed: false,
    approved_v2_hash: E2A4_APPROVED_V2_HASH,
    failed_v7_hash: E2A9_CANDIDATE_HASH,
    failed_v7_file_sha256: E2A9_CANDIDATE_FILE_SHA256,
    failed_v7_candidate_path: E2A9_CANDIDATE_PATH,
    candidate_approved: false,
    candidate_activated: false
  };
}
