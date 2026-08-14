import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stableHash } from "@/lib/operational/stable-hash";
import { buildFormativeConversationV18R2RuntimeCandidateManifest } from "@/lib/operational/formative-conversation-v18r2/candidate";
import {
  FORMATIVE_CONVERSATION_V18R2_CANDIDATE_ACCEPTANCE_VERSION
} from "@/lib/services/student-assessment/formative-conversation/candidate-validation-v18r2";
import {
  FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH,
  FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION
} from "@/lib/services/student-assessment/formative-conversation/live-runner-v18r2";
import {
  FORMATIVE_CONVERSATION_OPENING_VERSION,
  FORMATIVE_CONVERSATION_V18R2_OPENING_ACKNOWLEDGEMENT_VERSION
} from "@/lib/services/student-assessment/formative-conversation/opening-contract";

export const FORMATIVE_CONVERSATION_V18R2_UX_POLISH_CANDIDATE_ROOT =
  "config/operational-candidates/formative-conversation-v18r2-ux-polish";
export const FORMATIVE_CONVERSATION_V18R2_UX_POLISH_CANDIDATE_VERSION =
  "formative-conversation-v18r2-ux-polish-v1" as const;

export const FORMATIVE_CONVERSATION_V18R2_UX_POLISH_FIXTURE_PATH =
  `${FORMATIVE_CONVERSATION_V18R2_UX_POLISH_CANDIDATE_ROOT}/fixtures/ux-polish-regression-cases.json`;

export const FORMATIVE_CONVERSATION_V18R2_UX_POLISH_REQUIRED_TESTS = [
  "operational:formative-conversation-v18r2-ux-polish-smoke",
  "operational:formative-conversation-v18r2-ux-polish-candidate-smoke",
  "operational:formative-conversation-v18r2-contract-smoke",
  "operational:formative-conversation-v18r2-provider-request-smoke",
  "typecheck",
  "lint",
  "git diff --check"
] as const;

export const FORMATIVE_CONVERSATION_V18R2_IMMUTABLE_LIVE_REFERENCE = {
  reference_version: "formative-conversation-v18r2-ux-polish-live-reference-v1",
  provider_run_id: "fcv5v18r2_provider_20260814042303_c675790a",
  runtime_candidate_hash:
    "db71fa1ed5e9d5ce007bddf21a102cd006ab337584708386a9c4e081a556d58e",
  prompt_version: "formative-conversation-host-v7.1",
  prompt_hash:
    "471304a46132d50d3aadfb6f693685c8b838ba5d601dca56d67612890b863451",
  evaluation_protocol_hash:
    "0b491563a116efcdc83e3a46fff31cc8f2751256357a3921f40e31645e8ce870",
  evidence_mutated: false,
  evaluated_the_ux_polish_candidate: false
} as const;

function fileIdentity(relativePath: string) {
  return {
    path: relativePath,
    sha256: createHash("sha256")
      .update(readFileSync(path.resolve(process.cwd(), relativePath)))
      .digest("hex")
  };
}

export function buildFormativeConversationV18R2UxPolishArtifacts() {
  const currentV18R2 = buildFormativeConversationV18R2RuntimeCandidateManifest();
  const {
    manifest_version: ignoredManifestVersion,
    runtime_candidate_hash: ignoredRuntimeHash,
    candidate_version: ignoredCandidateVersion,
    base_v18r1_runtime_candidate_hash: ignoredBaseRuntimeHash,
    change_scope: ignoredChangeScope,
    ...currentRuntimeBoundary
  } = currentV18R2;
  void ignoredManifestVersion;
  void ignoredRuntimeHash;
  void ignoredCandidateVersion;
  void ignoredBaseRuntimeHash;
  void ignoredChangeScope;

  const runtimeIdentity = {
    candidate_version:
      FORMATIVE_CONVERSATION_V18R2_UX_POLISH_CANDIDATE_VERSION,
    base_v18r2_runtime_candidate_hash:
      FORMATIVE_CONVERSATION_V18R2_IMMUTABLE_LIVE_REFERENCE.runtime_candidate_hash,
    change_scope: "student_facing_conversation_guidance_and_opening_acknowledgement",
    ...currentRuntimeBoundary,
    ux_behavior_contract: {
      adaptive_response_depth: true,
      fixed_or_preferred_word_count: null,
      tutor_question_required_every_turn: false,
      no_question_continue_conversation_allowed: true,
      per_turn_diagnostic_evidence_required: false,
      immediate_student_intent_priority: true,
      persistent_misconception_mental_model_exploration_allowed: true,
      deterministic_misconception_probe_trigger: false,
      legacy_activity_routing_added: false
    },
    preserved_semantics: [
      "profiling",
      "canonical_claim_identity",
      "canonical_evidence_identity",
      "evidence_eligibility",
      "temporal_admissibility",
      "profile_transition",
      "continue_conversation_representation",
      "twelve_student_turn_lifecycle",
      "teacher_assistance_recommended",
      "platform_lifecycle_handoff",
      "persistence_and_provenance",
      "teacher_and_research_exports"
    ],
    historical_v18r2_live_reference:
      FORMATIVE_CONVERSATION_V18R2_IMMUTABLE_LIVE_REFERENCE
  } as const;
  const runtimeCandidateManifest = {
    manifest_version:
      "formative-conversation-v18r2-ux-polish-runtime-candidate-manifest-v1",
    ...runtimeIdentity,
    runtime_candidate_hash: stableHash(runtimeIdentity)
  };

  const fixtureFile = fileIdentity(
    FORMATIVE_CONVERSATION_V18R2_UX_POLISH_FIXTURE_PATH
  );
  const fixtureIdentity = {
    manifest_version:
      "formative-conversation-v18r2-ux-polish-fixture-manifest-v1",
    fixture_version: "formative-conversation-v18r2-ux-polish-regression-v1",
    files: [fixtureFile]
  } as const;
  const fixtureManifest = {
    ...fixtureIdentity,
    fixture_manifest_hash: stableHash(fixtureIdentity)
  };

  const protocolIdentity = {
    protocol_version:
      "formative-conversation-v18r2-ux-polish-targeted-no-provider-v1",
    runtime_candidate_hash: runtimeCandidateManifest.runtime_candidate_hash,
    prompt_version: FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION,
    prompt_hash: FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH,
    candidate_acceptance_version:
      FORMATIVE_CONVERSATION_V18R2_CANDIDATE_ACCEPTANCE_VERSION,
    opening_receipt_version: FORMATIVE_CONVERSATION_OPENING_VERSION,
    opening_acknowledgement_version:
      FORMATIVE_CONVERSATION_V18R2_OPENING_ACKNOWLEDGEMENT_VERSION,
    fixture_manifest_hash: fixtureManifest.fixture_manifest_hash,
    required_tests: [
      ...FORMATIVE_CONVERSATION_V18R2_UX_POLISH_REQUIRED_TESTS
    ],
    targeted_behavior_case_count: 7,
    targeted_opening_case_count: 6,
    exact_production_responses_schema_compilation_required: true,
    provider_calls_permitted: 0,
    model_auth_requests_permitted: 0,
    generation_network_requests_permitted: 0,
    real_dispatch_checkpoints_permitted: 0,
    full_v18r2_live_evaluation_permitted: false
  } as const;
  const targetedValidationProtocol = {
    ...protocolIdentity,
    protocol_hash: stableHash(protocolIdentity)
  };

  const candidateIdentity = {
    identity_version:
      "formative-conversation-v18r2-ux-polish-candidate-identity-v1",
    candidate_version:
      FORMATIVE_CONVERSATION_V18R2_UX_POLISH_CANDIDATE_VERSION,
    runtime_candidate_hash: runtimeCandidateManifest.runtime_candidate_hash,
    prompt_version: FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION,
    prompt_hash: FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH,
    protocol_hash: targetedValidationProtocol.protocol_hash,
    fixture_manifest_hash: fixtureManifest.fixture_manifest_hash,
    candidate_acceptance_version:
      FORMATIVE_CONVERSATION_V18R2_CANDIDATE_ACCEPTANCE_VERSION,
    opening_acknowledgement_version:
      FORMATIVE_CONVERSATION_V18R2_OPENING_ACKNOWLEDGEMENT_VERSION,
    governance: {
      live_authorization_created: false,
      live_execution_prepared: false,
      approval_eligible: false,
      activation_permitted: false
    }
  } as const;

  return {
    runtimeCandidateManifest,
    fixtureManifest,
    targetedValidationProtocol,
    candidateIdentity: {
      ...candidateIdentity,
      candidate_identity_hash: stableHash(candidateIdentity)
    }
  };
}
