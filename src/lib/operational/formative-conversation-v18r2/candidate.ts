import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getPromptForAgent } from "@/lib/agents/prompts/registry";
import { CANONICAL_EVIDENCE_IDENTITY_VERSION } from "@/lib/domain/canonical-evidence-identity";
import { MISCONCEPTION_CLAIM_IDENTITY_VERSION } from "@/lib/domain/misconception-claim-identity";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  FORMATIVE_CONVERSATION_V18_PRESERVED_ACTIVE_RUNTIME_HASH,
  FORMATIVE_CONVERSATION_V18_PRESERVED_ROLLBACK_RUNTIME_HASH
} from "@/lib/operational/formative-conversation-v18/candidate";
import {
  FORMATIVE_CONVERSATION_MEMORY_VERSION,
  FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION
} from "@/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_V18R2_CONTEXT_VERSION,
  FORMATIVE_CONVERSATION_V18R2_PROFILE_RECOMMENDATION_VERSION,
  FORMATIVE_CONVERSATION_V18R2_PROFILE_SNAPSHOT_VERSION
} from "@/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { FORMATIVE_CONVERSATION_V18R2_CANDIDATE_ACCEPTANCE_VERSION } from "@/lib/services/student-assessment/formative-conversation/candidate-validation-v18r2";
import {
  FORMATIVE_CONVERSATION_V18R2_ACCOUNTING_VERSION,
  FORMATIVE_CONVERSATION_V18R2_EXECUTION_POLICY_VERSION,
  FORMATIVE_CONVERSATION_V18R2_INCOMPLETE_OUTPUT_RECOVERY_CALLS,
  FORMATIVE_CONVERSATION_V18R2_MAXIMUM_SEMANTIC_REGENERATIONS,
  FORMATIVE_CONVERSATION_V18R2_SEMANTIC_REGENERATION_VERSION
} from "@/lib/services/student-assessment/formative-conversation/execution-v18r2";
import {
  FORMATIVE_CONVERSATION_V18R2_LIFECYCLE_VERSION,
  FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS
} from "@/lib/services/student-assessment/formative-conversation/lifecycle-contract-v18r2";
import {
  FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH,
  FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION
} from "@/lib/services/student-assessment/formative-conversation/live-runner-v18r2";
import {
  FORMATIVE_CONVERSATION_OPENING_VERSION,
  FORMATIVE_CONVERSATION_V18R2_OPENING_ACKNOWLEDGEMENT_VERSION
} from "@/lib/services/student-assessment/formative-conversation/opening-contract";
import { FORMATIVE_CONVERSATION_STUDENT_OUTPUT_FORMAT_VERSION } from "@/lib/services/student-assessment/formative-conversation/output-format";
import { FORMATIVE_CONVERSATION_V18_PROFILE_TRANSITION_VERSION } from "@/lib/services/student-assessment/formative-conversation/profile-update-v18";

export const FORMATIVE_CONVERSATION_V18R2_CANDIDATE_ROOT =
  "config/operational-candidates/formative-conversation-contract-coherence-v18r2";
export const FORMATIVE_CONVERSATION_V18R2_CANDIDATE_VERSION =
  "formative-conversation-v18r2-contract-coherence-and-bounded-lifecycle-v1";

export const FORMATIVE_CONVERSATION_V18R2_IMMUTABLE_V18R1 = {
  reference_version: "formative-conversation-v18r2-immutable-v18r1-reference-v1",
  source_revision: "formative-conversation-host-v5-executable-v18r1",
  git_commit: "2147e4d340e9adbfd8014433ceede852fbdc54fc",
  provider_run_id: "fcv5v18r1_provider_20260813160503_9f33cf65",
  derived_evaluation_id: "fcv5v18r1_derived_20260813160503_1534d9b2",
  aggregate_status: "completed_failed",
  case_counts: { passed: 5, failed: 7, invalid: 0, not_exercised: 0 },
  authorization_consumed_exactly_once: true,
  runtime_candidate_hash:
    "17ca582ac937be7f790a2841d3542a4d79ec9364c04703fecdbfc282134378ca",
  evaluation_protocol_hash:
    "1dda208e9a3f454c1b708663790c9f2181a4054b7b06d99951ab4da04a8c7881",
  candidate_manifest_hash:
    "2fd63af5d200cb684d032bb4b991ef1d027fa19e437a5a221f83f8b04adcee99",
  aggregate_fixture_hash:
    "94bbd1ba2d8eb63c96a041af38f93e84d3d154f4acdd43dd40018d0d347941a1",
  local_artifact_policy: "committed_hash_reference_only",
  required_as_v18r2_runtime_dependency: false,
  source_artifacts_mutated: false,
  live_artifacts_mutated: false,
  rerun_permitted: false
} as const;

export const FORMATIVE_CONVERSATION_V18R2_RUNTIME_SOURCE_PATHS = [
  "src/app/api/student/sessions/[sessionPublicId]/formative-conversation/messages/route.ts",
  "src/app/api/student/sessions/[sessionPublicId]/formative-conversation/messages/retry/route.ts",
  "src/lib/agents/contracts.ts",
  "src/lib/agents/execute-agent.ts",
  "src/lib/agents/provider-request.ts",
  "src/lib/agents/prompts/registry.ts",
  "src/lib/agents/prompts/student-profiling/v1.ts",
  "src/lib/agents/student-profiling/input-builder.ts",
  "src/lib/agents/student-profiling/persistence.ts",
  "src/lib/agents/student-profiling/semantic-validation.ts",
  "src/lib/agents/student-profiling/service.ts",
  "src/lib/domain/canonical-evidence-identity.ts",
  "src/lib/domain/misconception-claim-identity.ts",
  "src/lib/llm/config.ts",
  "src/lib/llm/provider-input-privacy.ts",
  "src/lib/llm/provider-transport-retry.ts",
  "src/lib/llm/providers/openai-responses-provider.ts",
  "src/lib/llm/providers/types.ts",
  "src/lib/services/student-assessment/api.ts",
  "src/lib/services/student-assessment/formative-conversation/agent-contract.ts",
  "src/lib/services/student-assessment/formative-conversation/agent-contract-v18.ts",
  "src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2.ts",
  "src/lib/services/student-assessment/formative-conversation/candidate-validation-v18.ts",
  "src/lib/services/student-assessment/formative-conversation/candidate-validation-v18r2.ts",
  "src/lib/services/student-assessment/formative-conversation/context.ts",
  "src/lib/services/student-assessment/formative-conversation/context-v18.ts",
  "src/lib/services/student-assessment/formative-conversation/context-v18r2.ts",
  "src/lib/services/student-assessment/formative-conversation/evidence-identity-validator-v18.ts",
  "src/lib/services/student-assessment/formative-conversation/evidence-references-v18.ts",
  "src/lib/services/student-assessment/formative-conversation/execution-v18.ts",
  "src/lib/services/student-assessment/formative-conversation/execution-v18r2.ts",
  "src/lib/services/student-assessment/formative-conversation/index.ts",
  "src/lib/services/student-assessment/formative-conversation/lifecycle-contract-v18r2.ts",
  "src/lib/services/student-assessment/formative-conversation/live-runner-v18r2.ts",
  "src/lib/services/student-assessment/formative-conversation/misconception-claim-closure-v2.ts",
  "src/lib/services/student-assessment/formative-conversation/opening-contract.ts",
  "src/lib/services/student-assessment/formative-conversation/opening-runner.ts",
  "src/lib/services/student-assessment/formative-conversation/output-format.ts",
  "src/lib/services/student-assessment/formative-conversation/persistence-observability.ts",
  "src/lib/services/student-assessment/formative-conversation/profile-projection.ts",
  "src/lib/services/student-assessment/formative-conversation/profile-update.ts",
  "src/lib/services/student-assessment/formative-conversation/profile-update-v18.ts",
  "src/lib/services/student-assessment/formative-conversation/profile-transition-validator.ts",
  "src/lib/services/student-assessment/formative-conversation/projection.ts",
  "src/lib/services/student-assessment/formative-conversation/runtime-context.ts",
  "src/lib/services/student-assessment/formative-conversation/runtime.ts",
  "src/lib/services/student-assessment/formative-conversation/safety-boundary.ts",
  "src/lib/services/student-assessment/formative-conversation/service.ts",
  "src/lib/services/student-assessment/formative-conversation/telemetry-contract.ts",
  "src/lib/services/student-assessment/formative-conversation/telemetry.ts",
  "src/lib/services/teacher-research-data/analysis-ready-export.ts",
  "src/lib/services/teacher-review/session-detail.ts"
] as const;

export const FORMATIVE_CONVERSATION_V18R2_VERIFICATION_SOURCE_PATHS = [
  "package.json",
  "prisma/formative-conversation-v18r2-contract-smoke-test.ts",
  "prisma/formative-conversation-v18r2-lifecycle-runtime-smoke-test.ts",
  "prisma/formative-conversation-v18r2-pipeline-runtime-smoke-test.ts",
  "prisma/formative-conversation-v18r2-provider-request-smoke-test.ts",
  "prisma/formative-conversation-v18r2-runtime-database-smoke-test.ts",
  "prisma/formative-conversation-v18r2-test-fixtures.ts",
  "prisma/helpers/formative-conversation-v5-v18r2-test-environment.ts",
  "prisma/operational-formative-conversation-v18r2-accounting-smoke-test.ts",
  "prisma/operational-formative-conversation-v18r2-materialize.ts",
  "prisma/operational-formative-conversation-v18r2-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r2-compilation-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r2-deployment-provenance-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r2-dispatch-checkpoint-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r2-environment-parity-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r2-launcher-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r2-provenance-boundary-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18r2-security-smoke-test.ts",
  "src/lib/evaluation/synthetic-student-validation/framework.ts",
  "src/lib/operational/formative-conversation-v18r2/candidate.ts",
  "docs/operations/FORMATIVE_CONVERSATION_V18R2_CONTRACT_COHERENCE.md",
  "docs/operations/FORMATIVE_CONVERSATION_V18R2_DEPLOYMENT_PROVENANCE.md",
  `${FORMATIVE_CONVERSATION_V18R2_CANDIDATE_ROOT}/fixtures/v18r1-seven-failed-primary-candidates.json`
] as const;

export const FORMATIVE_CONVERSATION_V18R2_REQUIRED_NO_PROVIDER_TESTS = [
  "operational:formative-conversation-v18r2-candidate-smoke",
  "operational:formative-conversation-v18r2-accounting-smoke",
  "operational:formative-conversation-v18r2-contract-smoke",
  "operational:formative-conversation-v18r2-provider-request-smoke",
  "operational:formative-conversation-v18r2-pipeline-runtime-smoke",
  "operational:formative-conversation-v18r2-lifecycle-runtime-smoke",
  "operational:formative-conversation-v18r2-runtime-database-smoke",
  "operational:formative-conversation-v5-v18r2-compilation-smoke",
  "operational:formative-conversation-v5-v18r2-launcher-smoke",
  "operational:formative-conversation-v5-v18r2-environment-parity-smoke",
  "operational:formative-conversation-v5-v18r2-security-smoke",
  "operational:formative-conversation-v5-v18r2-deployment-provenance-smoke",
  "operational:formative-conversation-v5-v18r2-provenance-boundary-smoke",
  "operational:formative-conversation-v5-v18r2-dispatch-checkpoint-smoke",
  "operational:formative-conversation-v18-v17-forensic-replay-smoke",
  "operational:formative-conversation-v18-provider-request-smoke",
  "operational:formative-conversation-v18-contract-smoke",
  "operational:formative-conversation-v17-identity-smoke",
  "operational:formative-conversation-v17-profiling-canary-smoke",
  "operational:formative-conversation-v17-v16-replay-smoke",
  "operational:formative-conversation-v16-misconception-evidence-closure-smoke",
  "operational:formative-conversation-transition-evidence-closure-v1-smoke",
  "operational:formative-conversation-semantic-regeneration-v2-smoke",
  "operational:formative-conversation-profile-transition-v4-smoke",
  "operational:provider-transport-retry-v3-smoke",
  "operational:formative-conversation-output-format-v1-smoke",
  "student:profiling-semantic-validation-smoke",
  "student:formative-privacy-smoke",
  "operational:formative-conversation-v7-profile-disposition-smoke",
  "operational:formative-conversation-v8-profile-disposition-smoke",
  "npx prisma validate",
  "typecheck",
  "lint",
  "build_with_8gb_heap",
  "git diff --check"
] as const;

function fileSha256(relativePath: string) {
  return createHash("sha256")
    .update(readFileSync(path.resolve(process.cwd(), relativePath)))
    .digest("hex");
}

export function v18r2FileIdentity(relativePath: string) {
  return { path: relativePath, sha256: fileSha256(relativePath) };
}

export function buildFormativeConversationV18R2RuntimeCandidateManifest() {
  const profilingPrompt = getPromptForAgent("student_profiling_agent");
  const runtimeIdentity = {
    candidate_version: FORMATIVE_CONVERSATION_V18R2_CANDIDATE_VERSION,
    base_v18r1_runtime_candidate_hash:
      FORMATIVE_CONVERSATION_V18R2_IMMUTABLE_V18R1.runtime_candidate_hash,
    change_scope: "nonterminal_transition_contract_coherence_and_bounded_conversation",
    runtime_source_files:
      FORMATIVE_CONVERSATION_V18R2_RUNTIME_SOURCE_PATHS.map(v18r2FileIdentity),
    student_profiling_role: {
      agent_name: "student_profiling_agent",
      model_snapshot: "gpt-5.6-terra",
      reasoning_effort: "medium",
      max_output_tokens: 4_000,
      prompt_version: profilingPrompt.prompt_version,
      prompt_hash: profilingPrompt.prompt_hash,
      schema_version: profilingPrompt.schema_version
    },
    formative_conversation_role: {
      agent_name: "formative_conversation_agent",
      model_snapshot: "gpt-5.6-sol",
      reasoning_effort: "medium",
      max_output_tokens: 7_000,
      prompt_version: FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION,
      prompt_hash: FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH,
      schema_version: FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
      context_version: FORMATIVE_CONVERSATION_V18R2_CONTEXT_VERSION
    },
    contracts: {
      canonical_claim_identity_version: MISCONCEPTION_CLAIM_IDENTITY_VERSION,
      canonical_evidence_identity_version: CANONICAL_EVIDENCE_IDENTITY_VERSION,
      candidate_acceptance_version:
        FORMATIVE_CONVERSATION_V18R2_CANDIDATE_ACCEPTANCE_VERSION,
      profile_recommendation_version:
        FORMATIVE_CONVERSATION_V18R2_PROFILE_RECOMMENDATION_VERSION,
      profile_snapshot_version:
        FORMATIVE_CONVERSATION_V18R2_PROFILE_SNAPSHOT_VERSION,
      profile_transition_version:
        FORMATIVE_CONVERSATION_V18_PROFILE_TRANSITION_VERSION,
      lifecycle_version: FORMATIVE_CONVERSATION_V18R2_LIFECYCLE_VERSION,
      maximum_formative_student_turns:
        FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS,
      execution_policy_version:
        FORMATIVE_CONVERSATION_V18R2_EXECUTION_POLICY_VERSION,
      semantic_regeneration_version:
        FORMATIVE_CONVERSATION_V18R2_SEMANTIC_REGENERATION_VERSION,
      accounting_version: FORMATIVE_CONVERSATION_V18R2_ACCOUNTING_VERSION,
      opening_version: FORMATIVE_CONVERSATION_OPENING_VERSION,
      opening_acknowledgement_version:
        FORMATIVE_CONVERSATION_V18R2_OPENING_ACKNOWLEDGEMENT_VERSION,
      output_format_version:
        FORMATIVE_CONVERSATION_STUDENT_OUTPUT_FORMAT_VERSION,
      memory_version: FORMATIVE_CONVERSATION_MEMORY_VERSION,
      safety_boundary_version: FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION
    },
    branch_contract: {
      continue_conversation_profile_transition_recommendation: null,
      terminal_transition_required: true,
      observation_evidence_transition_authoritative: false,
      canonical_evidence_ids_semantics:
        "student_evidence_supporting_an_actual_profile_transition"
    },
    lifecycle_policy: {
      counter_scope: "formative_conversation_student_messages_only",
      counter_initial_value: 0,
      assessment_administration_counted: false,
      assistant_opening_counted: false,
      retries_or_replays_counted: false,
      final_allowed_turn: 12,
      continue_admissible_through_turn: 11,
      final_turn_continue_classification: "semantic_lifecycle_invalid",
      deterministic_terminal_outcome: false,
      platform_handoff_fabricates_profile_transition: false
    },
    recovery_policy: {
      maximum_semantic_regenerations:
        FORMATIVE_CONVERSATION_V18R2_MAXIMUM_SEMANTIC_REGENERATIONS,
      incomplete_output_recovery_calls:
        FORMATIVE_CONVERSATION_V18R2_INCOMPLETE_OUTPUT_RECOVERY_CALLS,
      structured_output_recovery_implemented: false,
      final_turn_double_invalid_action: "platform_lifecycle_handoff_without_transition"
    },
    responsibility_boundary: {
      llm_owns: [
        "student_evidence_interpretation",
        "adaptive_formative_teaching",
        "continued_conversation_judgment_when_available",
        "learning_change_judgment",
        "terminal_profile_and_outcome_recommendation"
      ],
      platform_owns: [
        "canonical_claim_and_evidence_identity",
        "evidence_eligibility_and_temporal_admissibility",
        "formative_turn_availability",
        "persistence_and_idempotency",
        "provenance_privacy_and_security",
        "teacher_and_research_reconstruction",
        "fail_closed_lifecycle_handoff"
      ],
      deterministic_pedagogy_added: false
    },
    unchanged_boundaries: [
      "student_profiling_prompt_and_schema",
      "terminal_profile_meanings",
      "terminal_evidence_integrity",
      "database_schema",
      "assessment_evidence_model",
      "privacy_controls",
      "active_approval_bundle",
      "rollback_bundle"
    ]
  } as const;
  return {
    manifest_version: "formative-conversation-v18r2-runtime-candidate-manifest-v1",
    ...runtimeIdentity,
    runtime_candidate_hash: stableHash(runtimeIdentity)
  };
}

export const FORMATIVE_CONVERSATION_V18R2_PRESERVED_ACTIVE_RUNTIME_HASH =
  FORMATIVE_CONVERSATION_V18_PRESERVED_ACTIVE_RUNTIME_HASH;
export const FORMATIVE_CONVERSATION_V18R2_PRESERVED_ROLLBACK_RUNTIME_HASH =
  FORMATIVE_CONVERSATION_V18_PRESERVED_ROLLBACK_RUNTIME_HASH;
