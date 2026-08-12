import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getPromptForAgent } from "@/lib/agents/prompts/registry";
import { stableHash } from "@/lib/operational/stable-hash";
import { MISCONCEPTION_CLAIM_IDENTITY_VERSION } from "@/lib/domain/misconception-claim-identity";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_CONTEXT_VERSION,
  FORMATIVE_CONVERSATION_MEMORY_VERSION,
  FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
  FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION
} from "@/lib/services/student-assessment/formative-conversation/agent-contract";
import { FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_VERSION } from "@/lib/services/student-assessment/formative-conversation/misconception-claim-closure-v2";
import { FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VALIDATOR_VERSION } from "@/lib/services/student-assessment/formative-conversation/profile-transition-validator";
import { FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VERSION } from "@/lib/services/student-assessment/formative-conversation/profile-update";
import {
  FORMATIVE_CONVERSATION_PROMPT_HASH,
  FORMATIVE_CONVERSATION_PROMPT_VERSION
} from "@/lib/services/student-assessment/formative-conversation/live-runner";
import { FORMATIVE_CONVERSATION_TRANSITION_EVIDENCE_CLOSURE_VERSION } from "@/lib/services/student-assessment/formative-conversation/transition-evidence-closure";

export const FORMATIVE_CONVERSATION_V17_CANDIDATE_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v17";
export const FORMATIVE_CONVERSATION_V17_CANDIDATE_VERSION =
  "formative-conversation-v17-canonical-misconception-claim-identity-v1";
export const FORMATIVE_CONVERSATION_V17_PRE_FREEZE_CANDIDATE_IDENTITY =
  "03c27761a59e45341cc76834450b19b89453004cece79325767dad6883660e23";

export const FORMATIVE_CONVERSATION_V17_RUNTIME_SOURCE_PATHS = [
  "src/lib/domain/misconception-claim-identity.ts",
  "src/lib/agents/contracts.ts",
  "src/lib/agents/prompts/student-profiling/v1.ts",
  "src/lib/agents/student-profiling/persistence.ts",
  "src/lib/agents/student-profiling/semantic-validation.ts",
  "src/lib/services/student-assessment/formative-conversation/agent-contract.ts",
  "src/lib/services/student-assessment/formative-conversation/candidate-validation.ts",
  "src/lib/services/student-assessment/formative-conversation/context.ts",
  "src/lib/services/student-assessment/formative-conversation/live-runner.ts",
  "src/lib/services/student-assessment/formative-conversation/misconception-claim-closure-v2.ts",
  "src/lib/services/student-assessment/formative-conversation/output-format.ts",
  "src/lib/services/student-assessment/formative-conversation/profile-projection.ts",
  "src/lib/services/student-assessment/formative-conversation/profile-transition-validator.ts",
  "src/lib/services/student-assessment/formative-conversation/profile-update.ts",
  "src/lib/services/student-assessment/formative-conversation/runtime-context.ts",
  "src/lib/services/student-assessment/formative-conversation/semantic-regeneration.ts",
  "src/lib/services/student-assessment/formative-conversation/transition-evidence-closure.ts",
  "src/lib/services/teacher-research-data/analysis-ready-export.ts",
  "src/lib/services/teacher-review/session-detail.ts"
] as const;

export const FORMATIVE_CONVERSATION_V17_ACTIVE_RUNTIME_HASH =
  "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993";
export const FORMATIVE_CONVERSATION_V17_ROLLBACK_RUNTIME_HASH =
  "58219c34888076486db21c723a99ac4f4dfa5c29ce78dd162cadbc0566ce9ea2";
export const FORMATIVE_CONVERSATION_V17_V16_RUNTIME_HASH =
  "d96ec30d26637887127fe92dd5f3d074de788ee02dd9aea523df2f79ca718034";
export const FORMATIVE_CONVERSATION_V17_V16_PROTOCOL_HASH =
  "d545c4e8e8204b613e7daf0e26359d774930d4c8a2c90412941b9428c6687c26";
export const FORMATIVE_CONVERSATION_V17_V16_RUN_ID =
  "fcv5v16_provider_20260809170902_7934761a";

function fileSha256(relativePath: string) {
  return createHash("sha256")
    .update(readFileSync(path.resolve(process.cwd(), relativePath)))
    .digest("hex");
}

export function buildFormativeConversationV17RuntimeCandidateManifest() {
  const studentProfilingPrompt = getPromptForAgent("student_profiling_agent");
  const runtimeSourceFiles =
    FORMATIVE_CONVERSATION_V17_RUNTIME_SOURCE_PATHS.map((sourcePath) => ({
      path: sourcePath,
      sha256: fileSha256(sourcePath)
    }));
  const runtimeIdentity = {
    candidate_version: FORMATIVE_CONVERSATION_V17_CANDIDATE_VERSION,
    change_scope: "canonical_misconception_claim_identity_only",
    runtime_source_files: runtimeSourceFiles,
    target_role: {
      agent_name: "formative_conversation_agent",
      model_snapshot: "gpt-5.6-sol",
      reasoning_effort: "medium",
      max_output_tokens: 3_500,
      prompt_version: FORMATIVE_CONVERSATION_PROMPT_VERSION,
      prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH
    },
    initial_profiling: {
      agent_name: "student_profiling_agent",
      prompt_version: studentProfilingPrompt.prompt_version,
      prompt_hash: studentProfilingPrompt.prompt_hash,
      schema_version: studentProfilingPrompt.schema_version
    },
    contracts: {
      agent_contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
      context_version: FORMATIVE_CONVERSATION_CONTEXT_VERSION,
      profile_recommendation_version:
        FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
      misconception_claim_identity_version:
        MISCONCEPTION_CLAIM_IDENTITY_VERSION,
      misconception_claim_closure_version:
        FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_VERSION,
      transition_evidence_closure_version:
        FORMATIVE_CONVERSATION_TRANSITION_EVIDENCE_CLOSURE_VERSION,
      transition_validator_version:
        FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VALIDATOR_VERSION,
      profile_transition_version:
        FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VERSION,
      memory_version: FORMATIVE_CONVERSATION_MEMORY_VERSION,
      safety_boundary_version:
        FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION
    },
    unchanged_boundaries: [
      "teaching_strategy",
      "formative_pedagogy",
      "outcome_meanings",
      "mastery_thresholds",
      "answer_visibility_policy",
      "privacy_security_model",
      "lifecycle_architecture",
      "database_schema",
      "activity_topic_dialogue_isolation"
    ]
  };
  const runtimeCandidateHash = stableHash(runtimeIdentity);
  const runtimeCandidateManifest = {
    manifest_version: "formative-conversation-v17-runtime-candidate-manifest-v1",
    ...runtimeIdentity,
    base_v16_runtime_candidate_hash:
      FORMATIVE_CONVERSATION_V17_V16_RUNTIME_HASH,
    runtime_candidate_hash: runtimeCandidateHash
  };
  return runtimeCandidateManifest;
}
