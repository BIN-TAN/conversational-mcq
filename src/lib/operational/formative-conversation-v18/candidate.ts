import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getPromptForAgent } from "@/lib/agents/prompts/registry";
import { CANONICAL_EVIDENCE_IDENTITY_VERSION } from "@/lib/domain/canonical-evidence-identity";
import { MISCONCEPTION_CLAIM_IDENTITY_VERSION } from "@/lib/domain/misconception-claim-identity";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  FORMATIVE_CONVERSATION_V17_ACTIVE_RUNTIME_HASH,
  FORMATIVE_CONVERSATION_V17_ROLLBACK_RUNTIME_HASH
} from "@/lib/operational/formative-conversation-v17/candidate";
import {
  FORMATIVE_CONVERSATION_MEMORY_VERSION,
  FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION
} from "@/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_V18_CONTEXT_VERSION,
  FORMATIVE_CONVERSATION_V18_PROFILE_RECOMMENDATION_VERSION,
  FORMATIVE_CONVERSATION_V18_PROFILE_SNAPSHOT_VERSION
} from "@/lib/services/student-assessment/formative-conversation/agent-contract-v18";
import { FORMATIVE_CONVERSATION_V18_CANDIDATE_ACCEPTANCE_VERSION } from "@/lib/services/student-assessment/formative-conversation/candidate-validation-v18";
import { FORMATIVE_CONVERSATION_EVIDENCE_ID_VALIDATOR_VERSION } from "@/lib/services/student-assessment/formative-conversation/evidence-identity-validator-v18";
import { FORMATIVE_CONVERSATION_V18_EVIDENCE_REFERENCE_VERSION } from "@/lib/services/student-assessment/formative-conversation/evidence-references-v18";
import {
  FORMATIVE_CONVERSATION_V18_ACCOUNTING_VERSION,
  FORMATIVE_CONVERSATION_V18_EXECUTION_POLICY_VERSION,
  FORMATIVE_CONVERSATION_V18_INCOMPLETE_OUTPUT_RECOVERY_CALLS,
  FORMATIVE_CONVERSATION_V18_MAXIMUM_SEMANTIC_REGENERATIONS,
  FORMATIVE_CONVERSATION_V18_SEMANTIC_REGENERATION_VERSION
} from "@/lib/services/student-assessment/formative-conversation/execution-v18";
import {
  FORMATIVE_CONVERSATION_V18_PROMPT_HASH,
  FORMATIVE_CONVERSATION_V18_PROMPT_VERSION
} from "@/lib/services/student-assessment/formative-conversation/live-runner-v18";
import { FORMATIVE_CONVERSATION_OPENING_VERSION } from "@/lib/services/student-assessment/formative-conversation/opening-contract";
import { FORMATIVE_CONVERSATION_STUDENT_OUTPUT_FORMAT_VERSION } from "@/lib/services/student-assessment/formative-conversation/output-format";
import { FORMATIVE_CONVERSATION_V18_PROFILE_TRANSITION_VERSION } from "@/lib/services/student-assessment/formative-conversation/profile-update-v18";

export const FORMATIVE_CONVERSATION_V18_CANDIDATE_ROOT =
  "config/operational-candidates/formative-conversation-contract-convergence-v18";
export const FORMATIVE_CONVERSATION_V18_CANDIDATE_VERSION =
  "formative-conversation-v18-dissertation-contract-convergence-v1";

export const FORMATIVE_CONVERSATION_V18_RUNTIME_SOURCE_PATHS = [
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
  "src/lib/services/student-assessment/formative-conversation/agent-contract.ts",
  "src/lib/services/student-assessment/formative-conversation/agent-contract-v18.ts",
  "src/lib/services/student-assessment/formative-conversation/candidate-validation-v18.ts",
  "src/lib/services/student-assessment/formative-conversation/context.ts",
  "src/lib/services/student-assessment/formative-conversation/context-v18.ts",
  "src/lib/services/student-assessment/formative-conversation/evidence-identity-validator-v18.ts",
  "src/lib/services/student-assessment/formative-conversation/evidence-references-v18.ts",
  "src/lib/services/student-assessment/formative-conversation/execution-v18.ts",
  "src/lib/services/student-assessment/formative-conversation/index.ts",
  "src/lib/services/student-assessment/formative-conversation/live-runner-v18.ts",
  "src/lib/services/student-assessment/formative-conversation/misconception-claim-closure-v2.ts",
  "src/lib/services/student-assessment/formative-conversation/opening-contract.ts",
  "src/lib/services/student-assessment/formative-conversation/opening-runner.ts",
  "src/lib/services/student-assessment/formative-conversation/output-format.ts",
  "src/lib/services/student-assessment/formative-conversation/profile-projection.ts",
  "src/lib/services/student-assessment/formative-conversation/profile-update.ts",
  "src/lib/services/student-assessment/formative-conversation/profile-update-v18.ts",
  "src/lib/services/student-assessment/formative-conversation/profile-transition-validator.ts",
  "src/lib/services/student-assessment/formative-conversation/runtime-context.ts",
  "src/lib/services/student-assessment/formative-conversation/runtime.ts",
  "src/lib/services/student-assessment/formative-conversation/safety-boundary.ts",
  "src/lib/services/teacher-research-data/analysis-ready-export.ts",
  "src/lib/services/teacher-review/session-detail.ts"
] as const;

export const FORMATIVE_CONVERSATION_V18_VERIFICATION_SOURCE_PATHS = [
  ".env.example",
  "package.json",
  "prisma/formative-conversation-v18-fixture-materialize.ts",
  "prisma/formative-conversation-v7-profile-disposition-smoke-test.ts",
  "prisma/formative-conversation-v8-profile-disposition-smoke-test.ts",
  "prisma/formative-conversation-v18-test-fixtures.ts",
  "prisma/formative-conversation-v18-v17-forensic-replay-smoke-test.ts",
  "prisma/formative-conversation-v18-provider-request-smoke-test.ts",
  "prisma/formative-conversation-v18-contract-smoke-test.ts",
  "prisma/formative-conversation-v18-pipeline-runtime-smoke-test.ts",
  "prisma/formative-conversation-v18-runtime-database-smoke-test.ts",
  "prisma/operational-formative-conversation-v18-materialize.ts",
  "prisma/operational-formative-conversation-v18-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18-compilation-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18-launcher-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18-environment-parity-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18-dispatch-checkpoint-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18-security-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18-provenance-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18-evaluate.ts",
  "prisma/helpers/formative-conversation-v5-v18-test-environment.ts",
  "prisma/student-profiling-semantic-validation-smoke-test.ts",
  "scripts/operational-formative-conversation-v5-v18-launcher.mjs",
  "scripts/operational-formative-conversation-v5-v18-process-local-runner.mjs",
  "src/lib/evaluation/synthetic-student-validation/framework.ts",
  "src/lib/llm/providers/mock-provider.ts",
  "src/lib/operational/formative-conversation-v18/candidate.ts",
  "src/lib/operational/formative-conversation-v18/forensics.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18/candidate-runner.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18/contracts.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18/dispatch-checkpoint.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18/evaluation-accounting.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18/live-environment.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18/package.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18/provenance.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18/security-release.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18/service.ts",
  "docs/operations/FORMATIVE_CONVERSATION_V18_CONTRACT_CONVERGENCE.md"
] as const;

export const FORMATIVE_CONVERSATION_V18_REQUIRED_NO_PROVIDER_TESTS = [
  "operational:formative-conversation-v18-candidate-smoke",
  "operational:formative-conversation-v5-v18-compilation-smoke",
  "operational:formative-conversation-v18-v17-forensic-replay-smoke",
  "operational:formative-conversation-v18-provider-request-smoke",
  "operational:formative-conversation-v18-contract-smoke",
  "student:profiling-semantic-validation-smoke",
  "operational:formative-conversation-v17-identity-smoke",
  "operational:formative-conversation-v17-profiling-canary-smoke",
  "operational:formative-conversation-v17-v16-replay-smoke",
  "operational:formative-conversation-v16-misconception-evidence-closure-smoke",
  "operational:formative-conversation-transition-evidence-closure-v1-smoke",
  "operational:formative-conversation-semantic-regeneration-v2-smoke",
  "operational:formative-conversation-profile-transition-v4-smoke",
  "operational:provider-transport-retry-v3-smoke",
  "operational:formative-conversation-output-format-v1-smoke",
  "student:formative-privacy-smoke",
  "operational:formative-conversation-v5-v17-security-smoke",
  "operational:formative-conversation-v5-v15-security-smoke",
  "operational:formative-conversation-v7-profile-disposition-smoke",
  "operational:formative-conversation-v8-profile-disposition-smoke",
  "operational:formative-conversation-v18-runtime-database-smoke",
  "operational:formative-conversation-v5-v18-launcher-smoke",
  "operational:formative-conversation-v5-v18-environment-parity-smoke",
  "operational:formative-conversation-v5-v18-dispatch-checkpoint-smoke",
  "operational:formative-conversation-v5-v18-security-smoke",
  "operational:formative-conversation-v5-v18-provenance-smoke",
  "npx prisma validate",
  "typecheck",
  "lint",
  "build_with_8gb_heap"
] as const;

function fileSha256(relativePath: string) {
  return createHash("sha256")
    .update(readFileSync(path.resolve(process.cwd(), relativePath)))
    .digest("hex");
}

export function v18FileIdentity(relativePath: string) {
  return { path: relativePath, sha256: fileSha256(relativePath) };
}

export function buildFormativeConversationV18RuntimeCandidateManifest() {
  const profilingPrompt = getPromptForAgent("student_profiling_agent");
  const runtimeIdentity = {
    candidate_version: FORMATIVE_CONVERSATION_V18_CANDIDATE_VERSION,
    base_v17_runtime_candidate_hash:
      "b077ba062c37340eac2918a2578f118c36fa852006196d31ef4735598ed21e6e",
    change_scope: "dissertation_aligned_llm_platform_contract_convergence",
    runtime_source_files:
      FORMATIVE_CONVERSATION_V18_RUNTIME_SOURCE_PATHS.map(v18FileIdentity),
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
      prompt_version: FORMATIVE_CONVERSATION_V18_PROMPT_VERSION,
      prompt_hash: FORMATIVE_CONVERSATION_V18_PROMPT_HASH,
      schema_version: FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
      context_version: FORMATIVE_CONVERSATION_V18_CONTEXT_VERSION
    },
    contracts: {
      canonical_claim_identity_version: MISCONCEPTION_CLAIM_IDENTITY_VERSION,
      canonical_evidence_identity_version: CANONICAL_EVIDENCE_IDENTITY_VERSION,
      evidence_reference_version:
        FORMATIVE_CONVERSATION_V18_EVIDENCE_REFERENCE_VERSION,
      evidence_validator_version:
        FORMATIVE_CONVERSATION_EVIDENCE_ID_VALIDATOR_VERSION,
      candidate_acceptance_version:
        FORMATIVE_CONVERSATION_V18_CANDIDATE_ACCEPTANCE_VERSION,
      profile_recommendation_version:
        FORMATIVE_CONVERSATION_V18_PROFILE_RECOMMENDATION_VERSION,
      profile_snapshot_version:
        FORMATIVE_CONVERSATION_V18_PROFILE_SNAPSHOT_VERSION,
      profile_transition_version:
        FORMATIVE_CONVERSATION_V18_PROFILE_TRANSITION_VERSION,
      execution_policy_version:
        FORMATIVE_CONVERSATION_V18_EXECUTION_POLICY_VERSION,
      semantic_regeneration_version:
        FORMATIVE_CONVERSATION_V18_SEMANTIC_REGENERATION_VERSION,
      accounting_version: FORMATIVE_CONVERSATION_V18_ACCOUNTING_VERSION,
      opening_version: FORMATIVE_CONVERSATION_OPENING_VERSION,
      output_format_version:
        FORMATIVE_CONVERSATION_STUDENT_OUTPUT_FORMAT_VERSION,
      memory_version: FORMATIVE_CONVERSATION_MEMORY_VERSION,
      safety_boundary_version:
        FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION
    },
    recovery_policy: {
      maximum_semantic_regenerations:
        FORMATIVE_CONVERSATION_V18_MAXIMUM_SEMANTIC_REGENERATIONS,
      incomplete_output_recovery_calls:
        FORMATIVE_CONVERSATION_V18_INCOMPLETE_OUTPUT_RECOVERY_CALLS,
      structured_output_recovery_implemented: false
    },
    responsibility_boundary: {
      llm_owns: [
        "assessment_evidence_interpretation",
        "provisional_semantic_profile",
        "adaptive_formative_teaching",
        "learning_change_judgment",
        "profile_and_outcome_recommendation"
      ],
      platform_owns: [
        "canonical_evidence",
        "entity_and_evidence_identity",
        "sequence_and_lifecycle_state",
        "privacy",
        "persistence",
        "provenance",
        "structured_contract_validity",
        "fail_closed_transition_integrity",
        "teacher_and_research_reconstruction"
      ],
      deterministic_pedagogy_added: false
    },
    unchanged_boundaries: [
      "activity_selection",
      "fixed_tutoring_sequences",
      "mastery_thresholds",
      "profile_outcome_meanings",
      "database_schema",
      "research_export_architecture",
      "privacy_controls",
      "active_approval_bundle",
      "rollback_bundle"
    ]
  } as const;
  return {
    manifest_version: "formative-conversation-v18-runtime-candidate-manifest-v1",
    ...runtimeIdentity,
    runtime_candidate_hash: stableHash(runtimeIdentity)
  };
}

export const FORMATIVE_CONVERSATION_V18_PRESERVED_ACTIVE_RUNTIME_HASH =
  FORMATIVE_CONVERSATION_V17_ACTIVE_RUNTIME_HASH;
export const FORMATIVE_CONVERSATION_V18_PRESERVED_ROLLBACK_RUNTIME_HASH =
  FORMATIVE_CONVERSATION_V17_ROLLBACK_RUNTIME_HASH;
