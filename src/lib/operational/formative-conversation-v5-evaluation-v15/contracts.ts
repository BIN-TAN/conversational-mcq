export {
  FormativeConversationV5CompiledCaseSchema,
  FormativeConversationV5CompiledPlanSchema,
  FormativeConversationV5FixtureSchema
} from "../formative-conversation-v5-evaluation-v14/contracts";
export type {
  FormativeConversationV5CompiledCase,
  FormativeConversationV5CompiledPlan,
  FormativeConversationV5Fixture
} from "../formative-conversation-v5-evaluation-v14/contracts";

export const FORMATIVE_CONVERSATION_V5_EXECUTABLE_REVISION =
  "formative-conversation-host-v5-executable-v15";
export const FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION =
  "formative-conversation-v5-protocol-runner-v15";
export const FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v15";
export const FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/candidate-manifest.json`;
export const FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/candidate-identity.json`;
export const FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/executable-evaluation-protocol.json`;
export const FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/source-configuration.json`;
export const FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/fixture-manifest.json`;
export const FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/compiled-execution-plan.json`;
export const FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/approval-evidence-placeholder.json`;
export const FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/live-environment-contract.json`;
export const FORMATIVE_CONVERSATION_V5_DISPATCH_CHECKPOINT_CONTRACT_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/dispatch-checkpoint-contract.json`;
export const FORMATIVE_CONVERSATION_V5_AUTHORIZATION_PACKAGE_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/live-execution-authorization.json`;
export const FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/fixtures`;
export const FORMATIVE_CONVERSATION_V5_PLAN_OUTPUT_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v15/plans";
export const FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v15/runs";

export const FORMATIVE_CONVERSATION_V5_CASE_ORDER = [
  "fcv5_01_assistant_first_opening",
  "fcv5_02_first_principles_adaptation",
  "fcv5_03_direct_answer_handling",
  "fcv5_04_related_concept_discussion",
  "fcv5_05_sound_profile_transition",
  "fcv5_06_largely_improved_temporal",
  "fcv5_07_persistent_barrier_teacher_assistance",
  "fcv5_08_mixed_resolved_evidence"
] as const;

export const FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS = [
  "source-provider-run.json",
  "derived-evaluation.json",
  "aggregate-evaluation.json",
  "human-review-package.json",
  "teacher-export-consistency.json",
  "research-export-integrity.json",
  "provider-retry-milestone-evidence.json",
  "persistence-observability.json",
  "provenance-manifest.json",
  "artifact-hash-manifest.json",
  "finalized-artifact-manifest.json",
  "artifact-scan-attestation.json"
] as const;
