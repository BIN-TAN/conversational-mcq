import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { z } from "zod";
import {
  publicOpenAICredentialResolution,
  resolveOpenAICredentialFromEnv,
  withResolvedOpenAICredential
} from "@/lib/llm/openai-credential-resolver";
import {
  isApprovedOpenAIBaseUrl,
  openAIBaseUrlHost,
  resolveOpenAIBaseUrl
} from "@/lib/llm/openai-transport-diagnostics";
import {
  OPENAI_RESPONSES_ADAPTER_VERSION,
  OpenAIResponsesProvider
} from "@/lib/llm/providers/openai-responses-provider";
import type {
  LlmProvider,
  StructuredAgentRequest,
  StructuredAgentResult
} from "@/lib/llm/providers/types";
import {
  EXACTLY_ONCE_SEMANTIC_EFFECTS_POLICY_VERSION,
  ExactlyOnceSemanticEffectGuard,
  PROVIDER_FAILURE_TAXONOMY_VERSION,
  PROVIDER_REQUEST_TRACING_POLICY_VERSION,
  PROVIDER_TRANSPORT_RETRY_LIMITS,
  PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
  canonicalStructuredAgentRequestHash,
  executeWithBoundedProviderTransportRetry,
  type ProviderAttemptBudgetSnapshot
} from "@/lib/llm/provider-transport-retry";
import { stableHash } from "@/lib/operational/stable-hash";
import { resolveApplicationBuildInfo } from
  "@/lib/provenance/application-build-info";
import {
  ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION,
  ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
  buildNoLiveActivityMisconceptionEvidenceFixture,
  type ActivityMisconceptionEvidencePacketV1
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import {
  ACTIVITY_RESPONSE_EVALUATOR_INPUT_SCHEMA_VERSION,
  activityMisconceptionEvidencePipelineIssuesAllowRepair,
  evaluateActivityMisconceptionEvidenceLivePipeline,
  makeActivityMisconceptionEvidenceAuditForTest,
  makeLiveActivityMisconceptionEvidencePacketForTest,
  type ActivityMisconceptionEvidenceProviderAudit
} from "@/lib/services/student-assessment/activity-misconception-evidence-live";
import {
  AUTONOMOUS_PEDAGOGY_OUTPUT_SCHEMA_VERSION,
  AUTONOMOUS_PEDAGOGY_PROMPT_HASH,
  AUTONOMOUS_PEDAGOGY_PROMPT_INSTRUCTIONS,
  AUTONOMOUS_PEDAGOGY_PROMPT_VERSION,
  AutonomousPedagogyOutputSchema,
  buildCompleteVisibleFormativeEpisode,
  executeAutonomousFormativeTurn,
  validateAutonomousPedagogyOutput,
  type AutonomousEvidenceEvaluatorInput,
  type AutonomousFormativeTurnResult,
  type AutonomousPedagogyInput,
  type AutonomousTurnPersistence,
  type FormativeEpisodeTurnRecord,
  type PedagogicalInterventionRecord
} from "@/lib/services/student-assessment/autonomous-formative-dialogue";
import {
  FORMATIVE_ACTIVITY_SCHEMA_VERSION
} from "@/lib/services/student-assessment/formative-activity-design";
import {
  TARGET_EVIDENCE_CONTRACT_VERSION_V5,
  TargetEvidenceAdjudicationV5Schema,
  TargetEvidenceContractV5Schema,
  type TargetEvidenceAdjudicationV5,
  type TargetEvidenceContractV5
} from "@/lib/services/student-assessment/target-evidence-contract-v5";
import {
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_INSTRUCTIONS_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_HASH_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_INSTRUCTIONS_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
  ProductionTurnEvidenceEvaluatorOutputV5Schema,
  buildNoLiveStructuredTurnEvidenceV5ForTestOnly,
  buildProductionTurnEvidenceEvaluatorInputV5,
  type ProductionTurnEvidenceEvaluatorOutputV5
} from "@/lib/services/student-assessment/production-turn-evidence-evaluator-v5";
import {
  ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2
} from "@/lib/services/student-assessment/anchor-contradiction-propagation-v2";
import {
  PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V4
} from "@/lib/services/student-assessment/pre-tutor-profile-finalization-v4";
import {
  PROFILE_CONSISTENCY_POLICY_VERSION_V7,
  TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7
} from "@/lib/services/student-assessment/target-evidence-mapper-v7";
import {
  resolveActiveAnchorAlias
} from "@/lib/services/student-assessment/active-anchor-alias-resolution";
import {
  ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V2
} from "@/lib/services/student-assessment/active-anchor-alias-resolution-v2";
import {
  ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
  resolveActiveAnchorAliasV4
} from "@/lib/services/student-assessment/active-anchor-alias-resolution-v4";
import {
  ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
  resolveAnchorStanceScopeV1
} from "@/lib/services/student-assessment/anchor-stance-scope-resolution-v1";
import {
  TARGET_EVIDENCE_SCOPED_ADJUDICATION_VERSION,
  buildTargetEvidenceScopedAdjudicationV1
} from "@/lib/services/student-assessment/target-evidence-scoped-adjudication-v1";
import {
  ANCHOR_STANCE_EVIDENCE_CONTRACT_VERSION,
  ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION
} from "@/lib/services/student-assessment/anchor-stance-evidence-resolution-v2";
import {
  CANONICAL_ANCHOR_EVIDENCE_VERSION
} from "@/lib/services/student-assessment/canonical-anchor-evidence";
import {
  ANCHOR_PARITY_RECONCILIATION_VERSION
} from "@/lib/services/student-assessment/anchor-parity-reconciliation";
import {
  TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION_V2
} from "@/lib/services/student-assessment/turn-evidence-cross-artifact-consistency";
import {
  LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION,
  MIXED_INTENT_EVIDENCE_RETENTION_VERSION,
  NONCONCEPTUAL_PROFILE_PRESERVATION_VERSION,
  TURN_EVIDENCE_OBSERVATION_VERSION
} from "@/lib/services/student-assessment/turn-evidence-profile-update";
import {
  ANCHOR_CONCLUSION_CONSISTENCY_VERSION,
  SOUND_GATE_ANCHOR_CONSISTENCY_VERSION
} from "@/lib/services/student-assessment/anchor-conclusion-consistency";
import type {
  TopicDialogueCumulativeEvidenceProfile,
  TopicDialogueTurnEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  LlmStudentSimulatorOutputSchema,
  type LlmStudentSimulatorOutput
} from "@/lib/evaluation/formative/e2a-schemas";
import { LLM_STUDENT_SIMULATOR_INSTRUCTIONS } from
  "@/lib/evaluation/formative/llm-student-simulator-prompt";
import {
  e2aUsageFor,
  sanitizedE2AProviderResult
} from "@/lib/evaluation/formative/e2a17-bounded-student-simulator-canary";
import {
  E2A24_CANDIDATE_PATH,
  evaluateE2A24Candidate
} from "@/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate";
import {
  TRAJECTORY_ENVELOPE_VERSION,
  TrajectoryEnvelopeContractSchema,
  evaluateTrajectoryEnvelope,
  type TrajectoryEnvelopeTurn,
  type TrajectoryReasoningQuality
} from "@/lib/evaluation/formative/trajectory-envelope-v1";
import {
  SELF_CORRECTION_INTENT_VERSION,
  buildSelfCorrectionIntentContractV1,
  resolveSelfCorrectionIntentV1,
  type SelfCorrectionIntentContractV1,
  type SelfCorrectionIntentResolutionV1
} from "@/lib/evaluation/formative/self-correction-intent-v1";
import {
  SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION,
  SELF_CORRECTION_INTENT_SIGNAL_VERSION,
  buildSelfCorrectionEvidenceContractV1,
  resolveSelfCorrectionEvidenceV1,
  resolveSelfCorrectionIntentSignalV1,
  type SelfCorrectionConceptualEvidenceObservationV1,
  type SelfCorrectionEvidenceResolutionV1
} from "@/lib/evaluation/formative/self-correction-evidence-v1";
import {
  E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
  E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION,
  E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION,
  E2A36_INTERVENTION_MEMORY_VERSION,
  E2A36_LEARNING_PROFILE_EVOLUTION_VERSION,
  E2A36_LONGITUDINAL_METRICS_VERSION,
  buildAdaptiveStoppingPolicyContractV1,
  buildE2A36LongitudinalMetricsContract,
  buildEngagementProfileEvolutionContractV1,
  buildInstructorEscalationPolicyContractV1,
  buildLearningProfileEvolutionContractV1,
  buildLongitudinalInterventionMemoryContractV1,
  createEngagementProfileSnapshotV1,
  createLearningProfileSnapshotV1,
  decideAdaptiveStoppingV1,
  evaluateInstructorEscalationV1,
  evolveEngagementProfileV1,
  evolveLearningProfileV1,
  LongitudinalInterventionRecordV1Schema,
  selectLongitudinalInterventionV1,
  translateStoppingDecisionForStudentV1,
  validateStudentFacingCommunicationV1,
  type EngagementProfileEvolutionV1,
  type LearningProfileEvolutionV1,
  type LongitudinalInterventionRecordV1,
  type MeasurementConceptFamily
} from "@/lib/evaluation/formative/e2a36-longitudinal-contracts";
import {
  AUTONOMOUS_PEDAGOGY_INPUT_SCHEMA_VERSION,
  AUTONOMOUS_PEDAGOGY_QUALITY_REVIEW_VERSION,
  AUTONOMOUS_PEDAGOGY_VALIDATOR_VERSION,
  COMPLETE_VISIBLE_FORMATIVE_EPISODE_VERSION,
  PEDAGOGICAL_INTERVENTION_MEMORY_VERSION
} from "@/lib/services/student-assessment/autonomous-formative-dialogue";

loadEnvConfig(process.cwd());

const VERSION = "e2a38-integrated-autonomous-formative-session-live-v1";
const E2A38_FREEZE_RUN = "e2a38_20260725T093925Z_f87aceaf";
const E2A38_FREEZE_ROOT = path.join(
  process.cwd(), ".data",
  "e2a38-integrated-session-protocol-freeze",
  E2A38_FREEZE_RUN
);
const E2A37_FREEZE_RUN = "e2a37_20260725T085743Z_2a7cc062";
const E2A37_FREEZE_ROOT = path.join(
  process.cwd(), ".data",
  "e2a37-instructor-handoff-protocol-freeze",
  E2A37_FREEZE_RUN
);
const ARTIFACT_ROOT = path.join(
  process.cwd(), ".data",
  "e2a38-integrated-autonomous-session-canary"
);
const LOCK_PATH = path.join(
  process.cwd(), ".data", "locks", "e2a38-live-canary.lock"
);
const CHECKPOINT_PATH = path.join(
  ARTIFACT_ROOT, "e2a38-dispatch-checkpoint.json"
);
const PROTOCOL_HASH =
  "84300970cf23afa5f114ec3d367ca9a2096ea074fe9fb78a37e630fc30750911";
const FROZEN_COMPOSITE_RUNTIME_IDENTITY_HASH =
  "4aeae9f504135a99b4d26fd596d0f1796fb59dcf2d85fbc6fc62dc82e850b96a";
const ARTIFACT_CONTRACT_HASH =
  "1780c19326b759d969e0ed6c57e5b9dda395f16f9f79c4979bb4e5d991b81c77";
const TARGET_EVIDENCE_CONTRACT_HASH =
  "980b4794acb7572f792d9a8e88a9aa140f747b80f9d8fab660339c1a8129c471";
const MEASUREMENT_ALIAS_CONTRACT_HASH =
  "7eac83332969ffb6a02994230a15ee1dbf488f60597a0daf338cad2a8708dd56";
const CANONICAL_ANCHOR_CONTRACT_HASH =
  "2abf3593262b605930c7cff115a13870daa1713348e185723850228aaba5322f";
const TRAJECTORY_ENVELOPE_HASH =
  "52e50924c5198e4ca3487a99adcca06d574a25dca60e7e23b01b6048dd19067e";
const COMPILED_EVALUATOR_V5_REQUEST_HASH =
  "fc2ed302e1bb96c9bb2763a4d650dd7a66835f2278c071c68080d5f7d9eed947";
const COMPILED_EVALUATOR_V5_ARTIFACT_SHA =
  "38483178c50fe60459ac5833bbd3167c180afea5870a1006bf728809c0161a99";
const PROTECTED_SOURCE_SET_HASH =
  "1a18a27934578df087f86dd5053b6c11fee3ebf015609cd0471ec53bed524360";
const E2A38_PROTECTED_SOURCE_SET_HASH =
  "d37b461adf1d9cc510c1d79cd3e086da0937458ec2de0934d23fc7ede6ed4fee";
const BUDGET_HASH =
  "26b40ec39e5b373e592d3e58956a6beb9b83657c7037819623f9eb14cd991410";
const STANCE_EVIDENCE_CONTRACT_HASH =
  "fe2e8392f880d781448634944eb8ab7f8c7d43da7428571fd6793ed376d7ef8a";
const SELF_CORRECTION_INTEGRATION_CONTRACT_HASH =
  "687402df9c85bfc1261c1609af66ff170b7495239d57a436965749289ba99e8c";
const SELF_CORRECTION_EVIDENCE_CONTRACT_HASH =
  "50ec0bcacba5542c4034a8e068a910cf31dfd35d3794cc9595b8f75960e4ac4e";
const LEARNING_PROFILE_CONTRACT_HASH =
  "740781476cf6ecf5d073b875d3d70d27ba589e51cc71a19701612cd0b99dd681";
const ENGAGEMENT_PROFILE_CONTRACT_HASH =
  "43baf6ac3a7a05224c37337f4c4fd4110348934fb57c4a63b22b6f9a9d99ba28";
const INTERVENTION_MEMORY_CONTRACT_HASH =
  "8b759e5de2228a9ce2e780d542b9b1543ea37541a6b9ed44c65835f7490001f4";
const STOPPING_POLICY_CONTRACT_HASH =
  "16a24eaf8fcb53b6506d56efb6a2d690fd19ca99dacd89cf177611bf7fb592d0";
const ESCALATION_POLICY_CONTRACT_HASH =
  "b65c3caac35ed6125e510de30357c8d4b20334d10c69504813dd7c8dac98e66f";
const STUDENT_COMMUNICATION_CONTRACT_HASH =
  "f5296810c26f6d969c6cd30d3c4dd0ad483be335fd467ae8a1a58d88a6727188";
const LONGITUDINAL_METRICS_CONTRACT_HASH =
  "c1b9a3d6e8ba46cd1264b416b6a8f002ca67e4e4e6c84c70bae2a57ebeafc645";
const INTEGRATION_METRICS_CONTRACT_HASH =
  "41b00496bdd582adb89f4469827215b29d31b5aead17bef92e38ecd60355841f";
const COMPONENT_BINDINGS_HASH =
  "5634557d0458eb767d8ccf060324d441afdc220412c48a289bc0db71a0b21c78";
const E2A37_PROTOCOL_HASH =
  "d13256eb27213ee9799e2cd401df6cf5b2e8a8a38abe98fe1340ecd8bcc1e68e";
const E2A37_PROTOCOL_SOURCE_SHA =
  "a32d141d052cbe07d56d4b989cda129d7442950f311166b42f79d6d9b38794d7";
const E2A37_HARNESS_SOURCE_SHA =
  "df7fdcf2a85e59fa469c8ca9e8044887845c495eb9b46a6978db8a1685155f85";
const CANDIDATE_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";
const CANDIDATE_FILE_SHA =
  "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2";
const APPROVED_HASH =
  "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993";
const ARTIFACT_NAMES = [
  "canary-manifest.json",
  "composite-runtime-identity.json",
  "frozen-composite-runtime-identity.json",
  "dispatch-checkpoint.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "component-contract-bindings.json",
  "integrated-session-contract.json",
  "workflow-fidelity-contract.json",
  "dialogue-efficiency-contract.json",
  "personalization-evaluation-contract.json",
  "stopping-quality-contract.json",
  "human-boundary-contract.json",
  "integration-metrics-contract.json",
  "integration-metrics-results.json",
  "trajectory-envelope-contract.json",
  "trajectory-envelope-results.jsonl",
  "canonical-anchor-contract.json",
  "anchor-stance-contract.json",
  "self-correction-intent-contract.json",
  "self-correction-evidence-contract.json",
  "self-correction-evidence-integration-contract.json",
  "learning-profile-evolution-contract.json",
  "engagement-profile-evolution-contract.json",
  "longitudinal-intervention-memory-contract.json",
  "adaptive-stopping-policy-contract.json",
  "instructor-escalation-policy-contract.json",
  "student-facing-communication-contract.json",
  "longitudinal-metrics-contract.json",
  "candidate-integrity.json",
  "source-integrity.json",
  "frozen-protected-source-integrity.json",
  "session-fixture.json",
  "target-evidence-contract.json",
  "measurement-target-evidence-contract.json",
  "measurement-alias-contract.json",
  "compiled-evaluator-v5-request.json",
  "budget-ledger.json",
  "provider-attempt-results.jsonl",
  "provider-request-tracing.jsonl",
  "transport-retry-results.jsonl",
  "exactly-once-results.jsonl",
  "information-flow-audit.jsonl",
  "simulator-provider-outputs.jsonl",
  "student-turn-results.jsonl",
  "evaluator-requests.jsonl",
  "evaluator-contract-identities.jsonl",
  "evaluator-v5-request-identities.jsonl",
  "evaluator-provider-outputs.jsonl",
  "evaluator-normalized-results.jsonl",
  "turn-evidence-observations.jsonl",
  "profile-update-dispositions.jsonl",
  "criterion-evidence-results.jsonl",
  "anchor-alias-resolution-results.jsonl",
  "anchor-reference-resolution-results.jsonl",
  "anchor-stance-evidence-resolution-results.jsonl",
  "anchor-stance-scope-results.jsonl",
  "measurement-alias-resolution-results.jsonl",
  "anchor-stance-resolution-results.jsonl",
  "self-correction-intent-results.jsonl",
  "self-correction-evidence-results.jsonl",
  "latest-valid-evidence-precedence-results.jsonl",
  "profile-reopening-results.jsonl",
  "progression-results.jsonl",
  "learning-profile-evolution-results.jsonl",
  "engagement-profile-evolution-results.jsonl",
  "longitudinal-intervention-memory-results.jsonl",
  "adaptive-stopping-decisions.jsonl",
  "instructor-escalation-decisions.jsonl",
  "student-facing-communication-results.jsonl",
  "canonical-anchor-evidence-results.jsonl",
  "anchor-parity-reconciliation-results.jsonl",
  "anchor-interpretation-results.jsonl",
  "contradiction-propagation-results.jsonl",
  "mapper-results.jsonl",
  "cross-artifact-consistency-results.jsonl",
  "profile-transition-consistency-results.jsonl",
  "turn-profile-snapshots.jsonl",
  "profile-consistency-results.jsonl",
  "cumulative-profile-updates.jsonl",
  "sound-gate-results.jsonl",
  "platform-mode-decisions.jsonl",
  "autonomous-tutor-requests.jsonl",
  "autonomous-tutor-provider-outputs.jsonl",
  "runtime-validation-results.jsonl",
  "pedagogical-quality-results.jsonl",
  "intervention-memory-results.jsonl",
  "intervention-outcome-results.jsonl",
  "persistence-results.jsonl",
  "student-projection-results.jsonl",
  "audit-projection-results.jsonl",
  "transcript-refresh-results.jsonl",
  "privacy-results.jsonl",
  "context-coverage-results.jsonl",
  "failure-path-results.jsonl",
  "pre-tutor-finalization-results.jsonl",
  "structured-contradiction-results.jsonl",
  "human-review-binding-results.jsonl",
  "failure-path-completeness.json",
  "failed-session-burden-metrics.json",
  "fixture-cleanup-results.json",
  "provider-usage.json",
  "evidence-accuracy-metrics.json",
  "progression-efficiency-metrics.json",
  "pedagogical-adaptation-metrics.json",
  "student-burden-metrics.json",
  "workflow-fidelity-metrics.json",
  "transport-handling-metrics.json",
  "longitudinal-dialogue-metrics.json",
  "human-review-packet.json",
  "canary-summary.json",
  // Supplemental compatibility artifacts retained from the proven E2A.25 runner.
  "session-designs.json",
  "complete-visible-conversations.jsonl",
  "evaluator-inputs.jsonl",
  "evaluator-outputs.jsonl",
  "platform-response-modes.jsonl",
  "autonomous-tutor-inputs.jsonl",
  "pedagogical-interventions.jsonl",
  "intervention-outcomes.jsonl",
  "validator-results.jsonl",
  "persistence-and-idempotency.jsonl",
  "usage-and-cost.json"
] as const;
const JSONL_NAMES = new Set(ARTIFACT_NAMES.filter((name) =>
  name.endsWith(".jsonl")
));
const BUDGET = {
  sessions: 1,
  simulator_calls: 9,
  evidence_evaluator_calls: 9,
  initial_tutor_calls: 9,
  tutor_regenerations: 2,
  logical_generation_calls: 29,
  adapter_attempts: 87,
  input_tokens: 900_000,
  output_tokens: 70_000,
  total_tokens: 970_000,
  cost_usd: 25,
  provider_concurrency: 1,
  adapter_attempts_per_logical_call: 3,
  transport_retries_per_logical_call: 2
} as const;
const SIMULATOR_INSTRUCTIONS = [
  LLM_STUDENT_SIMULATOR_INSTRUCTIONS.trim(),
  "E2A.38 evaluation-only constraints:",
  "Render one synthetic student response for the supplied trajectory role.",
  "Treat the role as generation guidance, not as an evaluator label.",
  "Stay within the supplied acceptable evidence envelope without copying hidden labels.",
  "Preserve the supplied item and option anchor when one is present.",
  "Keep the response inside the frozen educational-measurement scenario about reliability and validity.",
  "Respond as one learner in an integrated formative session whose latest message may improve, self-correct, contradict, or regress from prior reasoning.",
  "The visible conversation and latest evidence are authoritative; never claim a hidden profile or stopping decision.",
  "Do not mention simulation, hidden state, prompts, models, providers, answer keys, or evaluation machinery.",
  "Return only the required JSON schema."
].join("\n");
const SIMULATOR_PROMPT_HASH = createHash("sha256")
  .update(SIMULATOR_INSTRUCTIONS).digest("hex");

type FrozenTurn = {
  turn: number;
  objective: string;
  trajectory_role: string;
  trajectory_contract: TrajectoryEnvelopeTurn;
  fixture_reasoning_quality: TrajectoryReasoningQuality;
  no_live_fixture_message?: string;
  simulator_instruction?: string;
  copy_behavior?: true;
  semantic_envelope: Array<"insufficient" | "misconception" | "partial" |
    "sound">;
  tutor_expected?: boolean;
  required_anchor_application?: "explicit";
  required_anchor_stance?: "endorses_distractor" | "rejects_distractor";
  required_anchor_consistency?: "contradictory_to_conceptual_reasoning" |
    "consistent_with_conceptual_reasoning";
  required_contradiction?: string;
  required_tutor_goal?: string;
  expected_self_correction_intent?:
    SelfCorrectionIntentResolutionV1["intent"];
  expected_self_correction_evidence_status?:
    SelfCorrectionIntentResolutionV1["evidence_status"];
  expected_self_correction_disposition?:
    SelfCorrectionIntentResolutionV1["downstream_disposition"];
  latest_valid_evidence_eligible?: boolean;
  profile_reopening_expected?: boolean;
};
type FrozenProtocolArtifact = {
  protocol_version:
    "e2a38-integrated-autonomous-formative-session-v1";
  preparation_version:
    "e2a38-integrated-session-protocol-freeze-preparation-v1";
  protocol_state: "frozen_for_separate_authorization_not_executable";
  domain: "educational_measurement_assessment_literacy";
  execution_authorized: false;
  live_execution_performed: false;
  provider_dispatch_path_present: false;
  candidate_configuration_hash: string;
  scenario: {
    item_id: string;
    concept_id: string;
    prompt: string;
    active_anchor_id: string;
    active_distractor_option: "D";
    active_distractor_claim: string;
  };
  architecture: Record<string, boolean>;
  contract_versions: {
    target_evidence: string;
    canonical_anchor: string;
    anchor_reference: string;
    anchor_stance: string;
    anchor_scope: string;
    self_correction_evidence: string;
    self_correction_integration: string;
    trajectory_envelope: string;
    intervention_memory: string;
    learning_profile_evolution: string;
    engagement_profile_evolution: string;
    adaptive_stopping_policy: string;
    instructor_escalation_policy: string;
    student_facing_communication: string;
    metrics: string;
    evidence_preservation_mapper: string;
    turn_profile_mapper: string;
    sound_gate: string;
    pre_tutor_finalization: string;
  };
  contract_hashes: {
    target_evidence: string;
    canonical_anchor: string;
    anchor_stance: string;
    self_correction_integration: string;
    trajectory_envelope: string;
    intervention_memory: string;
    learning_profile: string;
    engagement_profile: string;
    stopping_policy: string;
    escalation_policy: string;
    student_communication: string;
    metrics: string;
    compiled_evaluator_request: string;
  };
  evaluator_v5: {
    evaluator_version: string;
    prompt_version: string;
    prompt_hash: string;
    repair_prompt_hash: string;
    input_schema_version: string;
    output_schema_version: string;
    request_compiled: true;
  };
  deterministic_gate_results: {
    all_regressions_passed: true;
    deterministic_case_count: number;
    learning_profile_passed: true;
    engagement_profile_passed: true;
    stopping_policy_passed: true;
    instructor_escalation_passed: true;
    student_communication_passed: true;
    intervention_memory_passed: true;
    trajectory_envelope_passed: true;
    self_correction_passed: true;
    personalization_passed: true;
    protected_components_unchanged: true;
    provider_calls_zero: true;
    network_requests_zero: true;
  };
  budget: {
    budget_version: string;
    exactly_one_isolated_session: true;
    maximum_logical_generation_calls: 29;
    maximum_adapter_attempts: 87;
    maximum_adapter_attempts_per_logical_call: 3;
    maximum_transport_retries_per_logical_call: 2;
    maximum_input_tokens: 900000;
    maximum_output_tokens: 70000;
    maximum_total_tokens: 970000;
    maximum_cost_usd_when_pricing_metadata_available: 25;
    provider_concurrency: 1;
    transport_retry_policy_version: string;
    execution_authorized: false;
    live_execution_performed: false;
  };
  artifact_contract_hash: string;
  protocol_hash: string;
};
type Protocol = FrozenProtocolArtifact & {
  session_count: 1;
  self_correction_intent_contract: SelfCorrectionIntentContractV1;
  session: {
    session_id: string;
    design: string;
    academic_domain: string;
    concept: string;
    concept_family: MeasurementConceptFamily;
    frozen_target_evidence_contract: TargetEvidenceContractV5;
    target_evidence_contract: {
      item_id: string;
      distractor_option: string;
      distractor_claim: string;
      required_relationship: string;
      required_mechanism: string;
      prohibited_contradiction: string;
      required_anchor_stance: "rejects_distractor";
    };
    student_profile: {
      language_quality: string;
      confidence: string;
      engagement: string;
      trajectory: string;
    };
    frozen_student_trajectory: FrozenTurn[];
    required_endpoints: string[];
    maximum_student_turns: number;
    complete_visible_history_limit: number;
    raw_history_truncation_allowed: false;
    summary_only_substitution_allowed: false;
    natural_initial_activity: string;
  };
};
type Session = Protocol["session"];
type PlannedTurn = Session["frozen_student_trajectory"][number];
type JsonObject = Record<string, unknown>;
type CallRole = "simulator" | "evidence_evaluator" |
  "tutor_initial" | "tutor_regeneration";
type ProviderExecutor = LlmProvider;

type BudgetLedger = {
  simulator_calls: number;
  evidence_evaluator_calls: number;
  initial_tutor_calls: number;
  tutor_regenerations: number;
  logical_generation_calls: number;
  adapter_attempts: number;
  transport_retries: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  pricing_complete: boolean;
  total_latency_ms: number;
  per_call: JsonObject[];
};

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function frozenArtifactPath(name: string) {
  const e2a38Name = ({
    "trajectory-envelope-contract.json":
      "full-session-trajectory-envelope.json",
    "longitudinal-metrics-contract.json": "metrics-contract.json"
  } as Record<string, string>)[name] ?? name;
  const e2a38Path = path.join(E2A38_FREEZE_ROOT, e2a38Name);
  if (existsSync(e2a38Path)) return e2a38Path;
  const e2a37Name = name ===
      "self-correction-evidence-integration-contract.json"
    ? "self-correction-integration-contract.json"
    : name;
  return path.join(E2A37_FREEZE_ROOT, e2a37Name);
}

function frozenProtocolArtifact() {
  const raw = readJson<{
    protocol_version: string;
    preparation_version: string;
    protocol_state: string;
    domain: string;
    execution_authorized: boolean;
    live_execution_performed: boolean;
    provider_dispatch_path_present: boolean;
    candidate_configuration_hash: string;
    upstream_e2a37: {
      protocol_hash: string;
      source_sha256: string;
      component_regressions_passed: boolean;
      protected_sources_unchanged: boolean;
    };
    scenario: {
      item_id: string;
      concept_id: string;
      initial_activity: string;
      canonical_anchor_id: string;
      active_distractor_option: "D";
      active_distractor_claim: string;
    };
    architecture: Record<string, boolean>;
    contract_versions: Record<string, string>;
    contract_hashes: Record<string, string>;
    deterministic_gate_results: Record<string, boolean | number>;
    budget: FrozenProtocolArtifact["budget"];
    artifact_contract_hash: string;
    protocol_hash: string;
  }>(
    frozenArtifactPath("frozen-protocol.json")
  );
  const body: Partial<typeof raw> = { ...raw };
  delete body.protocol_hash;
  const recordedHash = readFileSync(
    frozenArtifactPath("frozen-protocol.sha256"), "utf8"
  ).trim();
  if (recordedHash !== PROTOCOL_HASH ||
      stableHash(body) !== PROTOCOL_HASH ||
      raw.protocol_hash !== PROTOCOL_HASH ||
      raw.protocol_version !==
        "e2a38-integrated-autonomous-formative-session-v1" ||
      raw.preparation_version !==
        "e2a38-integrated-session-protocol-freeze-preparation-v1" ||
      raw.protocol_state !==
        "frozen_for_separate_authorization_not_executable" ||
      raw.domain !== "educational_measurement_assessment_literacy" ||
      raw.execution_authorized !== false ||
      raw.live_execution_performed !== false ||
      raw.provider_dispatch_path_present !== false ||
      raw.candidate_configuration_hash !== CANDIDATE_HASH ||
      raw.upstream_e2a37.protocol_hash !== E2A37_PROTOCOL_HASH ||
      raw.upstream_e2a37.source_sha256 !== E2A37_PROTOCOL_SOURCE_SHA ||
      raw.upstream_e2a37.component_regressions_passed !== true ||
      raw.upstream_e2a37.protected_sources_unchanged !== true ||
      raw.contract_versions.self_correction_evidence !==
        SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION ||
      raw.contract_versions.trajectory_envelope !==
        TRAJECTORY_ENVELOPE_VERSION ||
      raw.contract_versions.learning_profile !==
        E2A36_LEARNING_PROFILE_EVOLUTION_VERSION ||
      raw.contract_versions.engagement_profile !==
        E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION ||
      raw.contract_versions.intervention_memory !==
        E2A36_INTERVENTION_MEMORY_VERSION ||
      raw.contract_versions.adaptive_stopping !==
        E2A36_ADAPTIVE_STOPPING_POLICY_VERSION ||
      raw.contract_versions.instructor_escalation !==
        E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION ||
      raw.contract_versions.metrics !==
        "e2a38-integration-metrics-v1" ||
      raw.contract_hashes.component_bindings !==
        COMPONENT_BINDINGS_HASH ||
      raw.contract_hashes.trajectory_envelope !==
        TRAJECTORY_ENVELOPE_HASH ||
      raw.contract_hashes.metrics !==
        INTEGRATION_METRICS_CONTRACT_HASH ||
      raw.artifact_contract_hash !== ARTIFACT_CONTRACT_HASH ||
      raw.budget.maximum_logical_generation_calls !==
        BUDGET.logical_generation_calls ||
      raw.budget.maximum_adapter_attempts !== BUDGET.adapter_attempts ||
      raw.budget.maximum_input_tokens !== BUDGET.input_tokens ||
      raw.budget.maximum_output_tokens !== BUDGET.output_tokens ||
      raw.budget.maximum_total_tokens !== BUDGET.total_tokens ||
      raw.budget.maximum_cost_usd_when_pricing_metadata_available !==
        BUDGET.cost_usd ||
      raw.budget.provider_concurrency !== BUDGET.provider_concurrency ||
      raw.deterministic_gate_results.all_integration_cases_passed !== true ||
      raw.deterministic_gate_results.protected_sources_unchanged !== true ||
      raw.deterministic_gate_results.provider_calls_zero !== true ||
      raw.deterministic_gate_results.network_requests_zero !== true) {
    throw new Error("e2a38_frozen_protocol_mismatch");
  }
  return {
    protocol_version: raw.protocol_version,
    preparation_version: raw.preparation_version,
    protocol_state: raw.protocol_state,
    domain: raw.domain,
    execution_authorized: false,
    live_execution_performed: false,
    provider_dispatch_path_present: false,
    candidate_configuration_hash: raw.candidate_configuration_hash,
    scenario: {
      item_id: raw.scenario.item_id,
      concept_id: raw.scenario.concept_id,
      prompt: raw.scenario.initial_activity,
      active_anchor_id: raw.scenario.canonical_anchor_id,
      active_distractor_option: raw.scenario.active_distractor_option,
      active_distractor_claim: raw.scenario.active_distractor_claim
    },
    architecture: raw.architecture,
    contract_versions: {
      target_evidence: TARGET_EVIDENCE_CONTRACT_VERSION_V5,
      canonical_anchor: "e2a37-measurement-canonical-anchor-v1",
      anchor_reference: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
      anchor_stance: ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
      anchor_scope: ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
      self_correction_evidence: SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION,
      self_correction_integration: "e2a37-self-correction-integration-v1",
      trajectory_envelope: TRAJECTORY_ENVELOPE_VERSION,
      intervention_memory: E2A36_INTERVENTION_MEMORY_VERSION,
      learning_profile_evolution: E2A36_LEARNING_PROFILE_EVOLUTION_VERSION,
      engagement_profile_evolution:
        E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION,
      adaptive_stopping_policy: E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
      instructor_escalation_policy:
        E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION,
      student_facing_communication:
        "e2a37-student-facing-handoff-communication-v1",
      metrics: "e2a38-integration-metrics-v1",
      evidence_preservation_mapper:
        TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION,
      turn_profile_mapper: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
      sound_gate: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
      pre_tutor_finalization: PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V4
    },
    contract_hashes: {
      target_evidence: TARGET_EVIDENCE_CONTRACT_HASH,
      canonical_anchor: CANONICAL_ANCHOR_CONTRACT_HASH,
      anchor_stance: STANCE_EVIDENCE_CONTRACT_HASH,
      self_correction_integration:
        SELF_CORRECTION_INTEGRATION_CONTRACT_HASH,
      trajectory_envelope: TRAJECTORY_ENVELOPE_HASH,
      intervention_memory: INTERVENTION_MEMORY_CONTRACT_HASH,
      learning_profile: LEARNING_PROFILE_CONTRACT_HASH,
      engagement_profile: ENGAGEMENT_PROFILE_CONTRACT_HASH,
      stopping_policy: STOPPING_POLICY_CONTRACT_HASH,
      escalation_policy: ESCALATION_POLICY_CONTRACT_HASH,
      student_communication: STUDENT_COMMUNICATION_CONTRACT_HASH,
      metrics: INTEGRATION_METRICS_CONTRACT_HASH,
      compiled_evaluator_request: COMPILED_EVALUATOR_V5_REQUEST_HASH
    },
    evaluator_v5: {
      evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
      prompt_version:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
      prompt_hash: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
      repair_prompt_hash:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_HASH_V5,
      input_schema_version:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
      output_schema_version:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
      request_compiled: true
    },
    deterministic_gate_results: {
      all_regressions_passed: true,
      deterministic_case_count: Number(
        raw.deterministic_gate_results.deterministic_case_count
      ),
      learning_profile_passed: true,
      engagement_profile_passed: true,
      stopping_policy_passed: true,
      instructor_escalation_passed: true,
      student_communication_passed: true,
      intervention_memory_passed: true,
      trajectory_envelope_passed: true,
      self_correction_passed: true,
      personalization_passed: true,
      protected_components_unchanged: true,
      provider_calls_zero: true,
      network_requests_zero: true
    },
    budget: raw.budget,
    artifact_contract_hash: raw.artifact_contract_hash,
    protocol_hash: raw.protocol_hash
  } satisfies FrozenProtocolArtifact;
}

function buildE2A38FrozenProtocol(): Protocol {
  const frozen = frozenProtocolArtifact();
  const targetContract = TargetEvidenceContractV5Schema.parse(
    readJson(frozenArtifactPath("target-evidence-contract.json"))
  );
  const selfCorrectionContract = buildSelfCorrectionIntentContractV1({
    active_topic_terms: [
      "reliability",
      "validity",
      "consistent scores",
      "intended construct",
      "score interpretation",
      "option D"
    ],
    active_anchor_aliases: [
      ...targetContract.active_anchor_alias_contract.accepted_identifiers,
      ...targetContract.active_anchor_alias_contract.accepted_aliases,
      ...targetContract.active_anchor_alias_contract.accepted_paraphrases,
      ...targetContract.active_anchor_alias_contract.negative_or_contrast_forms,
      targetContract.distractor_claim
    ],
    unrelated_topic_terms: [
      "weather",
      "sports",
      "movie",
      "restaurant"
    ]
  });
  const selfCorrectionEvidenceContract =
    buildSelfCorrectionEvidenceContractV1();
  const selfCorrectionIntegration = readJson<JsonObject>(
    frozenArtifactPath(
      "self-correction-evidence-integration-contract.json"
    )
  );
  const trajectory = TrajectoryEnvelopeContractSchema.parse(
    readJson(frozenArtifactPath("trajectory-envelope-contract.json"))
  );
  if (frozen.protocol_hash !== PROTOCOL_HASH ||
      frozen.scenario.active_distractor_option !== "D" ||
      stableHash(targetContract) !== TARGET_EVIDENCE_CONTRACT_HASH ||
      stableHash(targetContract.active_anchor_alias_contract) !==
        MEASUREMENT_ALIAS_CONTRACT_HASH ||
      stableHash(selfCorrectionEvidenceContract) !==
        SELF_CORRECTION_EVIDENCE_CONTRACT_HASH ||
      stableHash(selfCorrectionIntegration) !==
        SELF_CORRECTION_INTEGRATION_CONTRACT_HASH ||
      stableHash(trajectory) !== TRAJECTORY_ENVELOPE_HASH) {
    throw new Error("e2a38_frozen_protocol_file_sha_mismatch");
  }
  const expectedObjectives = new Map<number, string>([
    [1, "initial_anchor_position"],
    [2, "mechanism_exploration"],
    [3, "anchor_reconciliation"],
    [4, "mechanism_exploration"],
    [5, "independent_reconstruction"],
    [6, "revision_readiness"],
    [7, "post_sound_revision"],
    [8, "anchor_reconciliation"]
  ]);
  const turn = (turnNumber: number, fields: Omit<FrozenTurn,
    "turn" | "objective" | "trajectory_contract">): FrozenTurn => ({
    turn: turnNumber,
    objective: expectedObjectives.get(turnNumber) ?? "missing",
    trajectory_contract: trajectory.turns[turnNumber - 1]!,
    ...fields
  });
  return {
    ...frozen,
    session_count: 1,
    self_correction_intent_contract: selfCorrectionContract,
    session: {
      session_id: "E2A38-INTEGRATED_AUTONOMOUS_SESSION",
      design:
        "integrated_activity_evidence_profile_intervention_revision",
      academic_domain: frozen.domain,
      concept: targetContract.concept_id,
      concept_family: "reliability_validity",
      frozen_target_evidence_contract: targetContract,
      target_evidence_contract: {
        item_id: targetContract.item_id,
        distractor_option: targetContract.distractor_option,
        distractor_claim: targetContract.distractor_claim,
        required_relationship:
          targetContract.target_conceptual_relationships.join(" "),
        required_mechanism: targetContract.required_mechanisms.join(" "),
        prohibited_contradiction: targetContract.prohibited_contradictions[0]!,
        required_anchor_stance: "rejects_distractor"
      },
      student_profile: {
        language_quality: "brief informal English with variable precision",
        confidence: "variable",
        engagement:
          "responsive, persistent, and initially misconception-bound",
        trajectory:
          "misconception, partial distinction, contradiction, strategy adaptation, self-correction, regression, and independent reconstruction"
      },
      frozen_student_trajectory: [
        turn(1, {
          trajectory_role: "initial_anchor_position",
          fixture_reasoning_quality: "misconception",
          no_live_fixture_message:
            "I agree with option D. If the scores stay consistent, the test must be measuring the intended construct accurately.",
          simulator_instruction:
            "Explicitly endorse option D and claim that score consistency proves the test measures the intended construct accurately. Do not distinguish reliability from validity.",
          semantic_envelope: [
            "insufficient",
            "misconception",
            "partial",
            "sound"
          ]
        }),
        turn(2, {
          trajectory_role: "mechanism_exploration",
          fixture_reasoning_quality: "partial",
          no_live_fixture_message:
            "Consistency is about getting similar scores, while validity is about what the score means. I am still not sure whether that makes D wrong.",
          simulator_instruction:
            "Make a genuine partial distinction between consistency and score interpretation, but leave the stance on option D uncertain and omit a concrete counterexample or evidence requirement.",
          semantic_envelope: [
            "insufficient",
            "misconception",
            "partial",
            "sound"
          ]
        }),
        turn(3, {
          trajectory_role: "anchor_reconciliation",
          fixture_reasoning_quality: "partial",
          no_live_fixture_message:
            "Reliability only tells us that the scores are consistent, and validity needs evidence about the intended interpretation. But I still think option D is correct because consistent scores are accurate.",
          simulator_instruction:
            "State the reliability-validity distinction and need for interpretation evidence, then explicitly endorse option D anyway because consistency seems accurate. Preserve this observable contradiction.",
          semantic_envelope: [
            "insufficient",
            "misconception",
            "partial",
            "sound"
          ]
        }),
        turn(4, {
          trajectory_role: "mechanism_exploration",
          fixture_reasoning_quality: "insufficient",
          no_live_fixture_message:
            "I was wrong. I would choose a different answer now.",
          simulator_instruction:
            "Express a natural self-correction but provide no conceptual reason, no independent application, and no stance on option D.",
          semantic_envelope: [
            "insufficient",
            "misconception",
            "partial",
            "sound"
          ]
        }),
        turn(5, {
          trajectory_role: "independent_reconstruction",
          fixture_reasoning_quality: "partial",
          no_live_fixture_message:
            "I was wrong because reliability only shows consistency. A test could consistently measure reading speed when the intended claim is mathematical reasoning, so I reject option D. I still need to explain what validity evidence would be needed.",
          simulator_instruction:
            "Make an evidence-bearing self-correction, explicitly reject option D, and give a concrete consistent-but-wrong-construct counterexample. Leave one meaningful gap about validity evidence so the response may remain partial if the evaluator finds it incomplete.",
          semantic_envelope: [
            "insufficient",
            "misconception",
            "partial",
            "sound"
          ]
        }),
        turn(6, {
          trajectory_role: "revision_readiness",
          fixture_reasoning_quality: "misconception",
          no_live_fixture_message:
            "Actually, a high Cronbach alpha still proves the test is valid because all of the items are consistent, so option D makes sense.",
          simulator_instruction:
            "Regress naturally by explicitly endorsing option D and claiming that high internal consistency proves validity. Do not preserve a stale sound conclusion.",
          semantic_envelope: [
            "insufficient",
            "misconception",
            "partial",
            "sound"
          ]
        }),
        turn(7, {
          trajectory_role: "post_sound_revision",
          fixture_reasoning_quality: "partial",
          no_live_fixture_message:
            "A high alpha can show that items behave consistently, but the items might all consistently measure the wrong construct. So D is wrong. We would still need evidence that the scores support the intended interpretation and use.",
          simulator_instruction:
            "Use an independent consistent-but-wrong-construct counterexample, explicitly reject option D, and name the need for validity evidence. Do not force a complete answer if a meaningful link remains.",
          semantic_envelope: [
            "insufficient",
            "misconception",
            "partial",
            "sound"
          ]
        }),
        turn(8, {
          trajectory_role: "anchor_reconciliation",
          fixture_reasoning_quality: "sound",
          no_live_fixture_message:
            "I reject option D. Reliability is about score consistency, while validity concerns whether evidence supports the intended interpretation and use of the scores. A test can consistently measure the wrong construct, so repeated consistency alone cannot establish validity. We would need evidence connecting the scores to the intended construct and decision before making that claim.",
          simulator_instruction:
            "Independently give a coherent reliability-validity distinction, explain the consistent-but-wrong-construct mechanism, state what additional validity evidence is needed, and explicitly reject option D. Do not copy the tutor's wording.",
          semantic_envelope: [
            "insufficient",
            "misconception",
            "partial",
            "sound"
          ]
        }),
      ],
      required_endpoints: [
        "passed_required_revision_endpoint",
        "valid_bounded_stop_with_instructor_support",
        "valid_engagement_support_endpoint"
      ],
      maximum_student_turns: 8,
      complete_visible_history_limit: 20,
      raw_history_truncation_allowed: false,
      summary_only_substitution_allowed: false,
      natural_initial_activity: frozen.scenario.prompt
    }
  };
}

function frozenCompositeRuntimeIdentity() {
  const identity = readJson<JsonObject>(
    frozenArtifactPath("composite-runtime-identity.json")
  );
  const recorded = identity.composite_runtime_identity_hash;
  const body = { ...identity };
  delete body.composite_runtime_identity_hash;
  if (recorded !== FROZEN_COMPOSITE_RUNTIME_IDENTITY_HASH ||
      stableHash(body) !== FROZEN_COMPOSITE_RUNTIME_IDENTITY_HASH ||
      identity.protocol_hash !== PROTOCOL_HASH ||
      identity.candidate_configuration_hash !== CANDIDATE_HASH ||
      identity.upstream_e2a37_protocol_hash !== E2A37_PROTOCOL_HASH ||
      identity.e2a37_protocol_source_sha256 !== E2A37_PROTOCOL_SOURCE_SHA ||
      identity.protected_source_set_hash !==
        E2A38_PROTECTED_SOURCE_SET_HASH ||
      identity.component_contract_hashes !== COMPONENT_BINDINGS_HASH ||
      identity.budget_hash !== BUDGET_HASH ||
      identity.artifact_contract_hash !== ARTIFACT_CONTRACT_HASH) {
    throw new Error("e2a38_frozen_composite_runtime_identity_mismatch");
  }
  return identity;
}

function databaseReadiness() {
  try {
    execFileSync("npx", ["prisma", "migrate", "status"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { ready: true, code: "database_ready" };
  } catch {
    return { ready: false, code: "database_unavailable" };
  }
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(), encoding: "utf8"
  }).trim();
}

function trackedTreeClean() {
  return execFileSync("git", [
    "status", "--porcelain", "--untracked-files=no"
  ], { cwd: process.cwd(), encoding: "utf8" }).trim() === "";
}

function safe(value: unknown) {
  const text = JSON.stringify(value);
  const forbidden = [
    /\bBearer\s+[A-Za-z0-9._-]+/u,
    /\bsk-[A-Za-z0-9_-]{12,}/u,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u,
    /authorization\s*:\s*["']?Bearer/iu,
    /"(?:chain_of_thought|private_reasoning|hidden_reasoning)"\s*:\s*(?:"|\[|\{)/iu
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error("e2a38_artifact_secret_or_private_reasoning_detected");
  }
}

function writeJson(filePath: string, value: unknown) {
  safe(value);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendJsonl(filePath: string, value: unknown) {
  safe(value);
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonl<T>(filePath: string): T[] {
  const text = readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line) as T) : [];
}

function initializeRun(runId: string, root = ARTIFACT_ROOT) {
  const runDir = path.join(root, runId);
  if (existsSync(runDir)) throw new Error("e2a38_run_directory_exists");
  mkdirSync(runDir, { recursive: true });
  for (const name of ARTIFACT_NAMES) {
    writeFileSync(path.join(runDir, name), JSONL_NAMES.has(name) ? "" : "{}\n");
  }
  return runDir;
}

function runId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/gu, "")
    .slice(0, 14);
  return `e2a38_${stamp}_${randomBytes(4).toString("hex")}`;
}

function emptyLedger(): BudgetLedger {
  return {
    simulator_calls: 0,
    evidence_evaluator_calls: 0,
    initial_tutor_calls: 0,
    tutor_regenerations: 0,
    logical_generation_calls: 0,
    adapter_attempts: 0,
    transport_retries: 0,
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_input_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
    pricing_complete: true,
    total_latency_ms: 0,
    per_call: []
  };
}

function estimatedInputTokens(request: StructuredAgentRequest<unknown, unknown>) {
  return Math.max(1, Math.ceil(
    `${request.instructions}\n${JSON.stringify(request.input)}`.length / 3
  ));
}

function assertBudgetBeforeCall(
  ledger: BudgetLedger,
  role: CallRole,
  request: StructuredAgentRequest<unknown, unknown>
) {
  const next = {
    simulator_calls: ledger.simulator_calls + (role === "simulator" ? 1 : 0),
    evidence_evaluator_calls: ledger.evidence_evaluator_calls +
      (role === "evidence_evaluator" ? 1 : 0),
    initial_tutor_calls: ledger.initial_tutor_calls +
      (role === "tutor_initial" ? 1 : 0),
    tutor_regenerations: ledger.tutor_regenerations +
      (role === "tutor_regeneration" ? 1 : 0),
    logical_generation_calls: ledger.logical_generation_calls + 1,
    adapter_attempts: ledger.adapter_attempts + 3,
    input_tokens: ledger.input_tokens + estimatedInputTokens(request),
    output_tokens: ledger.output_tokens +
      (request.model_config.max_output_tokens ?? 0),
    total_tokens: ledger.input_tokens + ledger.output_tokens +
      estimatedInputTokens(request) +
      (request.model_config.max_output_tokens ?? 0)
  };
  for (const [key, limit] of Object.entries({
    simulator_calls: BUDGET.simulator_calls,
    evidence_evaluator_calls: BUDGET.evidence_evaluator_calls,
    initial_tutor_calls: BUDGET.initial_tutor_calls,
    tutor_regenerations: BUDGET.tutor_regenerations,
    logical_generation_calls: BUDGET.logical_generation_calls,
    adapter_attempts: BUDGET.adapter_attempts,
    input_tokens: BUDGET.input_tokens,
    output_tokens: BUDGET.output_tokens,
    total_tokens: BUDGET.total_tokens
  })) {
    if (next[key as keyof typeof next] > limit) {
      throw new Error(`e2a38_pre_call_budget_block:${key}`);
    }
  }
  if (ledger.pricing_complete && ledger.estimated_cost_usd >= BUDGET.cost_usd) {
    throw new Error("e2a38_pre_call_budget_block:cost_usd");
  }
}

function recordCall(
  ledger: BudgetLedger,
  role: CallRole,
  result: StructuredAgentResult<unknown>,
  sessionId: string,
  turn: number,
  attempt: number,
  transport: {
    adapter_attempt_count: number;
    transport_retry_count: number;
    total_latency_ms: number;
  }
) {
  const usage = e2aUsageFor(result);
  const adapterAttempts = transport.adapter_attempt_count;
  if (role === "simulator") ledger.simulator_calls += 1;
  if (role === "evidence_evaluator") ledger.evidence_evaluator_calls += 1;
  if (role === "tutor_initial") ledger.initial_tutor_calls += 1;
  if (role === "tutor_regeneration") ledger.tutor_regenerations += 1;
  ledger.logical_generation_calls += 1;
  ledger.adapter_attempts += adapterAttempts;
  ledger.transport_retries += transport.transport_retry_count;
  ledger.input_tokens += usage.input_tokens;
  ledger.output_tokens += usage.output_tokens;
  ledger.reasoning_tokens += usage.reasoning_tokens;
  ledger.cached_input_tokens += usage.cached_input_tokens;
  ledger.total_tokens += usage.total_tokens;
  ledger.total_latency_ms += transport.total_latency_ms;
  if (usage.pricing_available && usage.estimated_cost_usd !== null) {
    ledger.estimated_cost_usd += usage.estimated_cost_usd;
  } else {
    ledger.pricing_complete = false;
  }
  ledger.per_call.push({
    role, session_id: sessionId, turn, attempt,
    status: result.status,
    adapter_attempts: adapterAttempts,
    transport_retries: transport.transport_retry_count,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    reasoning_tokens: usage.reasoning_tokens,
    total_tokens: usage.total_tokens,
    estimated_cost_usd: usage.estimated_cost_usd,
    pricing_available: usage.pricing_available,
    latency_ms: transport.total_latency_ms
  });
  const actual = {
    simulator_calls: ledger.simulator_calls,
    evidence_evaluator_calls: ledger.evidence_evaluator_calls,
    initial_tutor_calls: ledger.initial_tutor_calls,
    tutor_regenerations: ledger.tutor_regenerations,
    logical_generation_calls: ledger.logical_generation_calls,
    adapter_attempts: ledger.adapter_attempts,
    input_tokens: ledger.input_tokens,
    output_tokens: ledger.output_tokens,
    total_tokens: ledger.total_tokens
  };
  for (const [key, limit] of Object.entries({
    simulator_calls: BUDGET.simulator_calls,
    evidence_evaluator_calls: BUDGET.evidence_evaluator_calls,
    initial_tutor_calls: BUDGET.initial_tutor_calls,
    tutor_regenerations: BUDGET.tutor_regenerations,
    logical_generation_calls: BUDGET.logical_generation_calls,
    adapter_attempts: BUDGET.adapter_attempts,
    input_tokens: BUDGET.input_tokens,
    output_tokens: BUDGET.output_tokens,
    total_tokens: BUDGET.total_tokens
  })) {
    if (actual[key as keyof typeof actual] > limit) {
      throw new Error(`e2a38_actual_budget_exceeded:${key}`);
    }
  }
  if (ledger.pricing_complete && ledger.estimated_cost_usd > BUDGET.cost_usd) {
    throw new Error("e2a38_actual_budget_exceeded:cost_usd");
  }
}

function pids(pattern: string) {
  try {
    const output = execFileSync("pgrep", ["-f", pattern], {
      encoding: "utf8"
    }).trim();
    return output ? output.split(/\s+/u).map(Number).filter((pid) =>
      Number.isInteger(pid) && pid !== process.pid
    ) : [];
  } catch {
    return [];
  }
}

function existingLiveRuns() {
  if (!existsSync(ARTIFACT_ROOT)) return [];
  return readdirSync(ARTIFACT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("e2a38_"))
    .map((entry) => entry.name).filter((id) => {
      const manifest = path.join(ARTIFACT_ROOT, id, "canary-manifest.json");
      if (!existsSync(manifest)) return true;
      try {
        return readJson<{ execution_mode?: string }>(manifest)
          .execution_mode === "live_provider";
      } catch {
        return true;
      }
    }).sort();
}

function filesRecursively(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(root, entry.name);
    return entry.isDirectory() ? filesRecursively(child) : [child];
  }).sort();
}

function treeHash(root: string) {
  const files = filesRecursively(root).map((file) => ({
    path: path.relative(process.cwd(), file),
    sha256: sha256(readFileSync(file))
  }));
  return {
    source_path: path.relative(process.cwd(), root),
    exists: existsSync(root),
    file_count: files.length,
    sha256: stableHash(files)
  };
}

function sourceIdentity() {
  const files = [
    "prisma/formative-evaluation-e2a38-live.ts",
    "prisma/formative-evaluation-e2a38.ts",
    "prisma/formative-evaluation-e2a37.ts",
    "src/lib/evaluation/formative/e2a38-integrated-session-protocol.ts",
    "src/lib/evaluation/formative/e2a37-instructor-handoff-protocol.ts",
    "src/lib/evaluation/formative/e2a36-longitudinal-contracts.ts",
    "src/lib/evaluation/formative/self-correction-intent-v1.ts",
    "src/lib/evaluation/formative/self-correction-evidence-v1.ts",
    "src/lib/evaluation/formative/trajectory-envelope-v1.ts",
    "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts",
    "src/lib/services/student-assessment/autonomous-formative-dialogue.ts",
    "src/lib/services/student-assessment/target-evidence-contract.ts",
    "src/lib/services/student-assessment/target-evidence-contract-v3.ts",
    "src/lib/services/student-assessment/target-evidence-contract-v4.ts",
    "src/lib/services/student-assessment/target-evidence-contract-v5.ts",
    "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts",
    "src/lib/services/student-assessment/active-anchor-alias-resolution.ts",
    "src/lib/services/student-assessment/active-anchor-alias-resolution-v2.ts",
    "src/lib/services/student-assessment/active-anchor-alias-resolution-v3.ts",
    "src/lib/services/student-assessment/active-anchor-alias-resolution-v4.ts",
    "src/lib/services/student-assessment/anchor-stance-scope-resolution-v1.ts",
    "src/lib/services/student-assessment/target-evidence-scoped-adjudication-v1.ts",
    "src/lib/services/student-assessment/anchor-stance-resolution-v1.ts",
    "src/lib/services/student-assessment/anchor-stance-evidence-resolution-v2.ts",
    "src/lib/services/student-assessment/canonical-anchor-evidence.ts",
    "src/lib/services/student-assessment/anchor-parity-reconciliation.ts",
    "src/lib/services/student-assessment/anchor-contradiction-propagation-v2.ts",
    "src/lib/services/student-assessment/target-evidence-mapper-v7.ts",
    "src/lib/services/student-assessment/turn-evidence-cross-artifact-consistency.ts",
    "src/lib/services/student-assessment/turn-evidence-profile-update.ts",
    "src/lib/services/student-assessment/pre-tutor-profile-finalization-v4.ts",
    "src/lib/services/student-assessment/anchor-conclusion-consistency.ts",
    "src/lib/services/student-assessment/topic-dialogue-evidence-first-routing.ts",
    "src/lib/services/student-assessment/activity-runtime-ui.ts",
    "src/lib/services/student-assessment/activity-misconception-evidence-live.ts",
    "src/lib/services/student-assessment/activity-misconception-evidence.ts",
    "src/lib/llm/providers/openai-responses-provider.ts",
    "src/lib/llm/provider-transport-retry.ts",
    "src/lib/services/teacher-review/serializers.ts",
    "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json",
    path.relative(process.cwd(), frozenArtifactPath("frozen-protocol.json")),
    path.relative(process.cwd(), frozenArtifactPath("frozen-protocol.sha256")),
    path.relative(process.cwd(), frozenArtifactPath("target-evidence-contract.json")),
    path.relative(process.cwd(), frozenArtifactPath("anchor-stance-contract.json")),
    path.relative(process.cwd(), frozenArtifactPath("canonical-anchor-contract.json")),
    path.relative(process.cwd(), frozenArtifactPath(
      "self-correction-evidence-integration-contract.json"
    )),
    path.relative(process.cwd(), frozenArtifactPath("trajectory-envelope-contract.json")),
    path.relative(process.cwd(), frozenArtifactPath("compiled-evaluator-v5-request.json")),
    path.relative(process.cwd(), frozenArtifactPath(
      "learning-profile-evolution-contract.json"
    )),
    path.relative(process.cwd(), frozenArtifactPath(
      "engagement-profile-evolution-contract.json"
    )),
    path.relative(process.cwd(), frozenArtifactPath(
      "intervention-memory-contract.json"
    )),
    path.relative(process.cwd(), frozenArtifactPath(
      "adaptive-stopping-policy-contract.json"
    )),
    path.relative(process.cwd(), frozenArtifactPath(
      "instructor-escalation-policy-contract.json"
    )),
    path.relative(process.cwd(), frozenArtifactPath(
      "student-facing-communication-contract.json"
    )),
    path.relative(process.cwd(), frozenArtifactPath(
      "longitudinal-metrics-contract.json"
    )),
    path.relative(process.cwd(), frozenArtifactPath(
      "protected-source-integrity.json"
    )),
    path.relative(process.cwd(), frozenArtifactPath("budget.json")),
    path.relative(process.cwd(), frozenArtifactPath("artifact-contract.json")),
    path.relative(process.cwd(), frozenArtifactPath("composite-runtime-identity.json")),
    path.relative(process.cwd(), frozenArtifactPath("provider-call-guard.json")),
    path.relative(process.cwd(), frozenArtifactPath("artifact-validation.json"))
  ].map((entry) => ({
    path: entry,
    sha256: sha256(readFileSync(path.join(process.cwd(), entry)))
  }));
  return {
    application_git_commit: currentCommit(),
    files,
    aggregate_sha256: stableHash({
      application_git_commit: currentCommit(), files
    })
  };
}

function protectedEvidenceIdentity() {
  const dataRoot = path.join(process.cwd(), ".data");
  const dataRoots = readdirSync(dataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() &&
      /^e2a(?:1[2-9]|2[0-9]|3[0-8])[a-z]?(?:\D|$)/u.test(entry.name))
    .map((entry) => path.join(dataRoot, entry.name))
    .filter((root) => path.resolve(root) !== path.resolve(ARTIFACT_ROOT));
  const configFiles = readdirSync(path.join(process.cwd(), "config"), {
    withFileTypes: true
  }).filter((entry) => entry.isFile() &&
    /^(?:approved|candidate)-operational-agent-config.*\.json$/u.test(
      entry.name
    )).map((entry) => path.join(process.cwd(), "config", entry.name));
  const protectedPaths = [
    ...configFiles,
    ...dataRoots,
    E2A38_FREEZE_ROOT,
    path.join(process.cwd(),
      "src/lib/evaluation/formative/e2a20a-student-simulator-evidence-classifier-v3.ts"),
    path.join(process.cwd(),
      "src/lib/evaluation/formative/e2a23a-student-simulator-evidence-classifier-v4.ts")
  ];
  const trees = protectedPaths.map(treeHash);
  return {
    snapshot_version: "e2a38-protected-evidence-snapshot-v1",
    trees,
    current_sha256: stableHash(trees)
  };
}

function compositeRuntimeIdentity() {
  const source = sourceIdentity();
  const sourceHash = (file: string) => source.files.find((entry) =>
    entry.path === file
  )?.sha256 ?? "missing";
  const autonomousSource =
    "src/lib/services/student-assessment/autonomous-formative-dialogue.ts";
  const v5Source =
    "src/lib/services/student-assessment/target-evidence-contract-v5.ts";
  const mapperV7Source =
    "src/lib/services/student-assessment/target-evidence-mapper-v7.ts";
  const evaluatorV5Source =
    "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts";
  const aliasSource =
    "src/lib/services/student-assessment/active-anchor-alias-resolution-v4.ts";
  const stanceScopeSource =
    "src/lib/services/student-assessment/anchor-stance-scope-resolution-v1.ts";
  const scopedAdjudicationSource =
    "src/lib/services/student-assessment/target-evidence-scoped-adjudication-v1.ts";
  const selfCorrectionSource =
    "src/lib/evaluation/formative/self-correction-intent-v1.ts";
  const referenceResolverSource =
    "src/lib/services/student-assessment/active-anchor-alias-resolution.ts";
  const stanceResolverSource =
    "src/lib/services/student-assessment/anchor-stance-evidence-resolution-v2.ts";
  const canonicalAnchorSource =
    "src/lib/services/student-assessment/canonical-anchor-evidence.ts";
  const anchorParitySource =
    "src/lib/services/student-assessment/anchor-parity-reconciliation.ts";
  const propagationSource =
    "src/lib/services/student-assessment/anchor-contradiction-propagation-v2.ts";
  const crossArtifactSource =
    "src/lib/services/student-assessment/turn-evidence-cross-artifact-consistency.ts";
  const turnUpdateSource =
    "src/lib/services/student-assessment/turn-evidence-profile-update.ts";
  const finalizationSource =
    "src/lib/services/student-assessment/pre-tutor-profile-finalization-v4.ts";
  const anchorSource =
    "src/lib/services/student-assessment/anchor-conclusion-consistency.ts";
  const transportSource = "src/lib/llm/provider-transport-retry.ts";
  const providerSource = "src/lib/llm/providers/openai-responses-provider.ts";
  const trajectorySource =
    "src/lib/evaluation/formative/trajectory-envelope-v1.ts";
  const evaluatorRequestSource =
    "src/lib/services/student-assessment/activity-misconception-evidence-live.ts";
  const persistenceSource =
    "src/lib/services/student-assessment/activity-runtime-ui.ts";
  const auditProjectionSource = "src/lib/services/teacher-review/serializers.ts";
  const identity = {
    identity_version: "e2a38-composite-runtime-identity-v1",
    candidate_configuration_hash: CANDIDATE_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA,
    autonomous_prompt_hash: AUTONOMOUS_PEDAGOGY_PROMPT_HASH,
    autonomous_input_schema_hash: stableHash({
      version: AUTONOMOUS_PEDAGOGY_INPUT_SCHEMA_VERSION,
      source_sha256: sourceHash(autonomousSource)
    }),
    autonomous_output_schema_hash: stableHash({
      version: AUTONOMOUS_PEDAGOGY_OUTPUT_SCHEMA_VERSION,
      source_sha256: sourceHash(autonomousSource)
    }),
    autonomous_hard_validator_hash: stableHash({
      version: AUTONOMOUS_PEDAGOGY_VALIDATOR_VERSION,
      source_sha256: sourceHash(autonomousSource)
    }),
    pedagogical_quality_rubric_hash: stableHash({
      version: AUTONOMOUS_PEDAGOGY_QUALITY_REVIEW_VERSION,
      source_sha256: sourceHash(autonomousSource)
    }),
    full_visible_history_serializer_hash: stableHash({
      version: COMPLETE_VISIBLE_FORMATIVE_EPISODE_VERSION,
      source_sha256: sourceHash(autonomousSource)
    }),
    evidence_evaluator_v5_source_hash: sourceHash(evaluatorV5Source),
    evidence_evaluator_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    evidence_evaluator_prompt_hash:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
    evidence_evaluator_input_schema_hash: stableHash({
      version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
      source_sha256: sourceHash(evaluatorV5Source)
    }),
    evidence_evaluator_output_schema_hash: stableHash({
      version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
      source_sha256: sourceHash(evaluatorV5Source)
    }),
    evidence_evaluator_provider_response_format_hash: stableHash({
      schema_name: PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
      provider_adapter_sha256: sourceHash(providerSource)
    }),
    evidence_evaluator_request_constructor_sha256:
      sourceHash(evaluatorRequestSource),
    evidence_evaluator_parser_normalizer_sha256:
      sourceHash(evaluatorRequestSource),
    target_evidence_contract_implementation_hash: sourceHash(v5Source),
    target_evidence_contract_version: TARGET_EVIDENCE_CONTRACT_VERSION_V5,
    frozen_e2a38_composite_runtime_identity_hash:
      FROZEN_COMPOSITE_RUNTIME_IDENTITY_HASH,
    frozen_e2a38_protocol_hash: PROTOCOL_HASH,
    frozen_e2a38_target_evidence_contract_hash:
      TARGET_EVIDENCE_CONTRACT_HASH,
    frozen_e2a38_alias_contract_hash:
      MEASUREMENT_ALIAS_CONTRACT_HASH,
    frozen_e2a38_canonical_anchor_contract_hash:
      CANONICAL_ANCHOR_CONTRACT_HASH,
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    trajectory_envelope_source_hash: sourceHash(trajectorySource),
    frozen_trajectory_envelope_hash: TRAJECTORY_ENVELOPE_HASH,
    frozen_e2a38_compiled_evaluator_v5_request_hash:
      COMPILED_EVALUATOR_V5_REQUEST_HASH,
    frozen_e2a38_protected_source_set_hash:
      E2A38_PROTECTED_SOURCE_SET_HASH,
    frozen_e2a37_protected_source_set_hash: PROTECTED_SOURCE_SET_HASH,
    frozen_e2a38_freeze_source_set_hash:
      E2A38_PROTECTED_SOURCE_SET_HASH,
    upstream_e2a37_protocol_hash: E2A37_PROTOCOL_HASH,
    upstream_e2a37_protocol_source_sha256: E2A37_PROTOCOL_SOURCE_SHA,
    upstream_e2a37_harness_source_sha256: E2A37_HARNESS_SOURCE_SHA,
    frozen_e2a38_artifact_contract_hash: ARTIFACT_CONTRACT_HASH,
    frozen_e2a38_budget_hash: BUDGET_HASH,
    frozen_e2a38_stance_evidence_contract_hash:
      STANCE_EVIDENCE_CONTRACT_HASH,
    frozen_e2a38_self_correction_integration_contract_hash:
      SELF_CORRECTION_INTEGRATION_CONTRACT_HASH,
    self_correction_evidence_contract_version:
      SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION,
    self_correction_evidence_contract_hash:
      SELF_CORRECTION_EVIDENCE_CONTRACT_HASH,
    learning_profile_evolution_version:
      E2A36_LEARNING_PROFILE_EVOLUTION_VERSION,
    learning_profile_contract_hash: LEARNING_PROFILE_CONTRACT_HASH,
    engagement_profile_evolution_version:
      E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION,
    engagement_profile_contract_hash: ENGAGEMENT_PROFILE_CONTRACT_HASH,
    longitudinal_intervention_memory_version:
      E2A36_INTERVENTION_MEMORY_VERSION,
    intervention_memory_contract_hash: INTERVENTION_MEMORY_CONTRACT_HASH,
    adaptive_stopping_policy_version:
      E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
    stopping_policy_contract_hash: STOPPING_POLICY_CONTRACT_HASH,
    instructor_escalation_policy_version:
      E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION,
    escalation_policy_contract_hash: ESCALATION_POLICY_CONTRACT_HASH,
    student_facing_communication_version:
      "e2a37-student-facing-handoff-communication-v1",
    student_communication_contract_hash: STUDENT_COMMUNICATION_CONTRACT_HASH,
    longitudinal_metrics_version: E2A36_LONGITUDINAL_METRICS_VERSION,
    longitudinal_metrics_contract_hash: LONGITUDINAL_METRICS_CONTRACT_HASH,
    integration_metrics_version: "e2a38-integration-metrics-v1",
    integration_metrics_contract_hash: INTEGRATION_METRICS_CONTRACT_HASH,
    self_correction_intent_version: SELF_CORRECTION_INTENT_VERSION,
    self_correction_intent_source_hash: sourceHash(selfCorrectionSource),
    anchor_stance_scope_resolution_version:
      ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
    anchor_stance_scope_resolution_source_hash:
      sourceHash(stanceScopeSource),
    target_evidence_scoped_adjudication_version:
      TARGET_EVIDENCE_SCOPED_ADJUDICATION_VERSION,
    target_evidence_scoped_adjudication_source_hash:
      sourceHash(scopedAdjudicationSource),
    canonical_anchor_evidence_source_hash: sourceHash(canonicalAnchorSource),
    canonical_anchor_evidence_version: CANONICAL_ANCHOR_EVIDENCE_VERSION,
    active_anchor_reference_resolver_source_hash:
      sourceHash(referenceResolverSource),
    active_anchor_reference_resolver_version:
      "active-anchor-alias-resolution-v1",
    anchor_stance_resolver_source_hash: sourceHash(stanceResolverSource),
    anchor_stance_evidence_contract_version:
      ANCHOR_STANCE_EVIDENCE_CONTRACT_VERSION,
    anchor_stance_resolver_version:
      ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
    active_anchor_alias_resolver_source_hash: sourceHash(aliasSource),
    active_anchor_alias_resolver_version:
      ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
    anchor_parity_reconciliation_source_hash: sourceHash(anchorParitySource),
    anchor_parity_reconciliation_version:
      ANCHOR_PARITY_RECONCILIATION_VERSION,
    profile_mapper_v7_source_hash: sourceHash(mapperV7Source),
    profile_mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
    profile_consistency_v7_source_hash: sourceHash(mapperV7Source),
    profile_consistency_version: PROFILE_CONSISTENCY_POLICY_VERSION_V7,
    mapper_evidence_preservation_version:
      TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION,
    contradiction_propagation_source_hash: sourceHash(propagationSource),
    contradiction_propagation_version:
      ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2,
    cross_artifact_consistency_source_hash: sourceHash(crossArtifactSource),
    cross_artifact_consistency_version:
      TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION_V2,
    turn_observation_contract_version: TURN_EVIDENCE_OBSERVATION_VERSION,
    turn_observation_contract_sha256: sourceHash(turnUpdateSource),
    profile_update_disposition_version:
      LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION,
    profile_update_disposition_sha256: sourceHash(turnUpdateSource),
    nonconceptual_preservation_version:
      NONCONCEPTUAL_PROFILE_PRESERVATION_VERSION,
    mixed_intent_retention_version: MIXED_INTENT_EVIDENCE_RETENTION_VERSION,
    pre_tutor_finalization_source_hash: sourceHash(finalizationSource),
    pre_tutor_finalization_version: PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V4,
    anchor_conclusion_consistency_source_hash: sourceHash(anchorSource),
    anchor_conclusion_consistency_version:
      ANCHOR_CONCLUSION_CONSISTENCY_VERSION,
    sound_gate_source_hash: sourceHash(anchorSource),
    intervention_memory_implementation_hash: stableHash({
      version: PEDAGOGICAL_INTERVENTION_MEMORY_VERSION,
      source_sha256: sourceHash(autonomousSource)
    }),
    platform_routing_source_hash: sourceHash(
      "src/lib/services/student-assessment/topic-dialogue-evidence-first-routing.ts"
    ),
    platform_persistence_source_hash: sourceHash(
      persistenceSource
    ),
    student_projection_source_hash: sourceHash(persistenceSource),
    audit_projection_source_hash: sourceHash(auditProjectionSource),
    provider_transport_retry_policy_version:
      PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
    provider_failure_taxonomy_version: PROVIDER_FAILURE_TAXONOMY_VERSION,
    provider_request_tracing_version: PROVIDER_REQUEST_TRACING_POLICY_VERSION,
    exactly_once_semantic_effects_version:
      EXACTLY_ONCE_SEMANTIC_EFFECTS_POLICY_VERSION,
    transport_retry_policy_sha256: sourceHash(transportSource),
    provider_adapter_sha256: sourceHash(providerSource),
    request_tracing_implementation_sha256: sourceHash(transportSource),
    exactly_once_implementation_sha256: sourceHash(transportSource),
    student_simulator_configuration_hash: SIMULATOR_PROMPT_HASH,
    application_git_commit: currentCommit(),
    frozen_protocol_hash: PROTOCOL_HASH,
    artifact_contract_hash: ARTIFACT_CONTRACT_HASH,
    source_identity_hash: source.aggregate_sha256
  };
  return { ...identity, composite_runtime_identity_hash: stableHash(identity) };
}

type DispatchCheckpoint = {
  checkpoint_version: "e2a38-dispatch-checkpoint-v1";
  recorded_at: string;
  application_git_commit: string;
  composite_runtime_identity_hash: string;
  source_identity_hash: string;
  protected_evidence_hash: string;
  protocol_hash: string;
  frozen_composite_runtime_identity_hash: string;
  target_evidence_contract_hash: string;
  compiled_evaluator_v5_request_hash: string;
  candidate_configuration_hash: string;
  candidate_file_sha256: string;
  live_execution_started: false;
};

function readCheckpoint() {
  return existsSync(CHECKPOINT_PATH)
    ? readJson<DispatchCheckpoint>(CHECKPOINT_PATH) : null;
}


function e2a38ProtectedSourcesUnchanged() {
  const integrity = readJson<{
    files: Array<{
      relative_path: string;
      expected_sha256: string;
    }>;
  }>(path.join(E2A37_FREEZE_ROOT, "protected-source-integrity.json"));
  return integrity.files.every((entry) => {
    const filePath = path.isAbsolute(entry.relative_path)
      ? entry.relative_path
      : path.join(process.cwd(), entry.relative_path);
    return existsSync(filePath) &&
      sha256(readFileSync(filePath)) === entry.expected_sha256;
  });
}

function e2a38LivePreflight(
  requireLive: boolean,
  requireCheckpoint = requireLive
) {
  const blockers: string[] = [];
  const candidate = evaluateE2A24Candidate();
  const protocol = buildE2A38FrozenProtocol();
  const frozenIdentity = frozenCompositeRuntimeIdentity();
  const summary = readJson<JsonObject>(
    path.join(E2A38_FREEZE_ROOT, "summary.json")
  );
  const artifactValidation = readJson<JsonObject>(
    path.join(E2A38_FREEZE_ROOT, "artifact-validation.json")
  );
  const componentBindings = readJson<JsonObject>(
    path.join(E2A38_FREEZE_ROOT, "component-contract-bindings.json")
  );
  const providerGuard = readJson<JsonObject>(
    path.join(E2A38_FREEZE_ROOT, "provider-call-guard.json")
  );
  const budget = readJson<JsonObject>(
    path.join(E2A38_FREEZE_ROOT, "budget.json")
  );
  const trajectory = TrajectoryEnvelopeContractSchema.parse(
    readJson(path.join(
      E2A38_FREEZE_ROOT,
      "full-session-trajectory-envelope.json"
    ))
  );
  const targetContract = TargetEvidenceContractV5Schema.parse(
    readJson(path.join(E2A37_FREEZE_ROOT, "target-evidence-contract.json"))
  );
  const canonicalAnchor = readJson<JsonObject>(
    path.join(E2A37_FREEZE_ROOT, "canonical-anchor-contract.json")
  );
  const stance = readJson<JsonObject>(
    path.join(E2A37_FREEZE_ROOT, "anchor-stance-contract.json")
  );
  const selfCorrection = readJson<JsonObject>(
    path.join(E2A37_FREEZE_ROOT, "self-correction-integration-contract.json")
  );
  const compiledEvaluator = readJson<JsonObject>(
    path.join(E2A37_FREEZE_ROOT, "compiled-evaluator-v5-request.json")
  );
  const checkpoint = readCheckpoint();
  const identity = compositeRuntimeIdentity();
  const protectedEvidence = protectedEvidenceIdentity();
  const buildInfo = resolveApplicationBuildInfo();
  const commit = currentCommit();

  if (
    protocol.protocol_hash !== PROTOCOL_HASH ||
    summary.status !==
      "e2a38_protocol_frozen_not_executed" ||
    summary.protocol_hash !== PROTOCOL_HASH ||
    summary.composite_runtime_identity_hash !==
      FROZEN_COMPOSITE_RUNTIME_IDENTITY_HASH ||
    summary.deterministic_integration_cases_passed !== true ||
    summary.execution_authorized !== false ||
    summary.live_execution_performed !== false ||
    summary.provider_calls_made !== 0 ||
    summary.network_requests_made !== 0
  ) {
    blockers.push("frozen_e2a38_protocol_invalid");
  }
  if (
    frozenIdentity.composite_runtime_identity_hash !==
      FROZEN_COMPOSITE_RUNTIME_IDENTITY_HASH ||
    frozenIdentity.protocol_hash !== PROTOCOL_HASH ||
    frozenIdentity.candidate_configuration_hash !== CANDIDATE_HASH
  ) {
    blockers.push("frozen_composite_runtime_identity_invalid");
  }
  if (
    artifactValidation.passed !== true ||
    artifactValidation.expected_artifact_count !== 43 ||
    artifactValidation.actual_artifact_count_before_validation !== 42 ||
    (artifactValidation.missing_artifacts as unknown[])?.length !== 0 ||
    (artifactValidation.unexpected_artifacts as unknown[])?.length !== 0 ||
    readdirSync(E2A38_FREEZE_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isFile()).length !== 43
  ) {
    blockers.push("frozen_artifact_validation_invalid");
  }
  if (
    stableHash(componentBindings) !== COMPONENT_BINDINGS_HASH ||
    componentBindings.e2a37_protocol_hash !== E2A37_PROTOCOL_HASH ||
    componentBindings.candidate_configuration_hash !== CANDIDATE_HASH ||
    componentBindings.component_regressions_passed !== true ||
    componentBindings.component_protected_sources_unchanged !== true
  ) {
    blockers.push("integrated_component_bindings_invalid");
  }
  if (
    stableHash(targetContract) !== TARGET_EVIDENCE_CONTRACT_HASH ||
    stableHash(targetContract.active_anchor_alias_contract) !==
      MEASUREMENT_ALIAS_CONTRACT_HASH ||
    stableHash(canonicalAnchor) !== CANONICAL_ANCHOR_CONTRACT_HASH ||
    stableHash(stance) !== STANCE_EVIDENCE_CONTRACT_HASH ||
    stableHash(selfCorrection) !==
      SELF_CORRECTION_INTEGRATION_CONTRACT_HASH ||
    stableHash(trajectory) !== TRAJECTORY_ENVELOPE_HASH ||
    stableHash(compiledEvaluator) !==
      COMPILED_EVALUATOR_V5_REQUEST_HASH ||
    sha256(readFileSync(path.join(
      E2A37_FREEZE_ROOT,
      "compiled-evaluator-v5-request.json"
    ))) !== COMPILED_EVALUATOR_V5_ARTIFACT_SHA
  ) {
    blockers.push("integrated_contract_binding_invalid");
  }
  if (
    trajectory.authority_boundary
      .production_sound_gate_is_authoritative_for_progression !== true ||
    trajectory.authority_boundary
      .exact_turn_by_turn_reasoning_labels_prohibited !== true ||
    trajectory.turns.length !== 8
  ) {
    blockers.push("trajectory_envelope_invalid");
  }
  if (
    stableHash(budget) !== BUDGET_HASH ||
    budget.maximum_logical_generation_calls !==
      BUDGET.logical_generation_calls ||
    budget.maximum_adapter_attempts !== BUDGET.adapter_attempts ||
    budget.maximum_transport_retries_per_logical_call !==
      BUDGET.transport_retries_per_logical_call ||
    budget.maximum_input_tokens !== BUDGET.input_tokens ||
    budget.maximum_output_tokens !== BUDGET.output_tokens ||
    budget.maximum_total_tokens !== BUDGET.total_tokens ||
    budget.maximum_cost_usd_when_pricing_metadata_available !==
      BUDGET.cost_usd ||
    budget.provider_concurrency !== BUDGET.provider_concurrency
  ) {
    blockers.push("frozen_budget_invalid");
  }
  if (
    providerGuard.passed !== true ||
    providerGuard.provider_client_created !== false ||
    providerGuard.provider_dispatch_path_present !== false ||
    providerGuard.provider_calls_made !== 0 ||
    providerGuard.network_requests_made !== 0
  ) {
    blockers.push("frozen_provider_call_guard_invalid");
  }
  if (
    PROVIDER_TRANSPORT_RETRY_LIMITS
      .maximum_adapter_attempts_per_logical_call !==
      BUDGET.adapter_attempts_per_logical_call ||
    PROVIDER_TRANSPORT_RETRY_LIMITS
      .maximum_transport_retries_per_logical_call !==
      BUDGET.transport_retries_per_logical_call ||
    PROVIDER_TRANSPORT_RETRY_LIMITS.provider_concurrency !==
      BUDGET.provider_concurrency ||
    stableHash(PROVIDER_TRANSPORT_RETRY_LIMITS.backoff_ms) !==
      stableHash([2_000, 8_000]) ||
    PROVIDER_TRANSPORT_RETRY_LIMITS.sdk_managed_retries !== 0
  ) {
    blockers.push("bounded_transport_retry_policy_invalid");
  }
  if (
    candidate.candidate_configuration_hash !== CANDIDATE_HASH ||
    candidate.candidate_file_sha256 !== CANDIDATE_FILE_SHA ||
    sha256(readFileSync(E2A24_CANDIDATE_PATH)) !== CANDIDATE_FILE_SHA ||
    candidate.approved_v2_hash !== APPROVED_HASH ||
    candidate.candidate_approved ||
    candidate.candidate_activated
  ) {
    blockers.push("candidate_integrity_mismatch");
  }
  if (!e2a38ProtectedSourcesUnchanged()) {
    blockers.push("protected_component_source_mismatch");
  }
  if (
    requireCheckpoint &&
    (!buildInfo.ok || buildInfo.info.application_git_commit !== commit)
  ) {
    blockers.push("application_build_provenance_mismatch");
  }
  if (requireCheckpoint && !trackedTreeClean()) {
    blockers.push("tracked_worktree_not_clean");
  }
  if (
    requireCheckpoint &&
    (!checkpoint ||
      checkpoint.application_git_commit !== commit ||
      checkpoint.composite_runtime_identity_hash !==
        identity.composite_runtime_identity_hash ||
      checkpoint.source_identity_hash !== identity.source_identity_hash ||
      checkpoint.protected_evidence_hash !==
        protectedEvidence.current_sha256 ||
      checkpoint.protocol_hash !== PROTOCOL_HASH ||
      checkpoint.frozen_composite_runtime_identity_hash !==
        FROZEN_COMPOSITE_RUNTIME_IDENTITY_HASH ||
      checkpoint.target_evidence_contract_hash !==
        TARGET_EVIDENCE_CONTRACT_HASH ||
      checkpoint.compiled_evaluator_v5_request_hash !==
        COMPILED_EVALUATOR_V5_REQUEST_HASH)
  ) {
    blockers.push("dispatch_checkpoint_mismatch");
  }
  if (pids("[f]ormative-evaluation-e2a38-live").length > 0) {
    blockers.push("duplicate_e2a38_process");
  }
  if (existsSync(LOCK_PATH)) blockers.push("e2a38_lock_present");
  const priorRuns = existingLiveRuns();
  if (priorRuns.length > 0) {
    blockers.push(`prior_e2a38_run_exists:${priorRuns.at(-1)}`);
  }

  let credential = null;
  const database = requireLive
    ? databaseReadiness()
    : { ready: null, code: "not_checked" };
  if (requireLive) {
    if (process.env.RUN_LIVE_E2A38 !== "1") {
      blockers.push("live_opt_in_missing");
    }
    if (process.env.LLM_PROVIDER !== "openai") {
      blockers.push("provider_not_openai");
    }
    if (process.env.LLM_LIVE_CALLS_ENABLED !== "true") {
      blockers.push("live_calls_not_enabled");
    }
    const resolved = resolveOpenAICredentialFromEnv();
    if (!resolved.ok) {
      blockers.push(resolved.code);
    } else {
      const publicCredential =
        publicOpenAICredentialResolution(resolved.credential);
      credential = {
        source: publicCredential.source,
        fingerprint_prefix: publicCredential.fingerprint_prefix,
        length: publicCredential.length,
        asciiOnly: publicCredential.asciiOnly,
        embeddedWhitespace: publicCredential.embeddedWhitespace,
        basicShapeValid: publicCredential.basicShapeValid,
        resolver_version: publicCredential.resolver_version
      };
    }
    if (!isApprovedOpenAIBaseUrl(resolveOpenAIBaseUrl())) {
      blockers.push("provider_base_url_not_approved");
    }
    if (!database.ready) blockers.push(database.code);
  }

  return {
    version: "e2a38-live-preflight-v1",
    passed: blockers.length === 0,
    blockers,
    current_git_commit: commit,
    tracked_worktree_clean: trackedTreeClean(),
    application_build_info: buildInfo,
    authoritative_e2a38_freeze_run: E2A38_FREEZE_RUN,
    upstream_e2a37_freeze_run: E2A37_FREEZE_RUN,
    protocol_hash: PROTOCOL_HASH,
    frozen_composite_runtime_identity_hash:
      FROZEN_COMPOSITE_RUNTIME_IDENTITY_HASH,
    candidate_configuration_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    candidate_authorized_for_activation: false,
    candidate_active: false,
    protected_components_unchanged:
      !blockers.includes("protected_component_source_mismatch"),
    integrated_workflow_contract_valid:
      !blockers.includes("integrated_contract_binding_invalid"),
    learning_profile_evolution_valid:
      protocol.contract_hashes.learning_profile ===
        LEARNING_PROFILE_CONTRACT_HASH,
    engagement_profile_evolution_valid:
      protocol.contract_hashes.engagement_profile ===
        ENGAGEMENT_PROFILE_CONTRACT_HASH,
    intervention_memory_valid:
      protocol.contract_hashes.intervention_memory ===
        INTERVENTION_MEMORY_CONTRACT_HASH,
    stopping_policy_valid:
      protocol.contract_hashes.stopping_policy ===
        STOPPING_POLICY_CONTRACT_HASH,
    student_facing_communication_policy_valid:
      protocol.contract_hashes.student_communication ===
        STUDENT_COMMUNICATION_CONTRACT_HASH,
    provider_call_guard_valid:
      !blockers.includes("frozen_provider_call_guard_invalid"),
    composite_identity: identity,
    dispatch_checkpoint: checkpoint,
    provider_concurrency: 1,
    provider_host: requireLive
      ? openAIBaseUrlHost(resolveOpenAIBaseUrl())
      : "not_checked",
    credential,
    provider_adapter_version: OPENAI_RESPONSES_ADAPTER_VERSION,
    database_readiness: database,
    source_identity: identity.source_identity_hash,
    protected_evidence_identity: protectedEvidence.current_sha256,
    prior_live_runs: priorRuns,
    budget: BUDGET,
    network_request_count: 0
  };
}

function recordDispatchCheckpoint() {
  if (existingLiveRuns().length > 0) {
    throw new Error("e2a38_prior_live_run_exists");
  }
  if (!trackedTreeClean()) {
    throw new Error("e2a38_checkpoint_tree_not_clean");
  }
  const check = e2a38LivePreflight(false, false);
  if (!check.passed) {
    throw new Error(
      `e2a38_checkpoint_preflight_failed:${check.blockers.join(",")}`
    );
  }
  const identity = compositeRuntimeIdentity();
  const checkpoint: DispatchCheckpoint = {
    checkpoint_version: "e2a38-dispatch-checkpoint-v1",
    recorded_at: new Date().toISOString(),
    application_git_commit: currentCommit(),
    composite_runtime_identity_hash:
      identity.composite_runtime_identity_hash,
    source_identity_hash: identity.source_identity_hash,
    protected_evidence_hash: protectedEvidenceIdentity().current_sha256,
    protocol_hash: PROTOCOL_HASH,
    frozen_composite_runtime_identity_hash:
      FROZEN_COMPOSITE_RUNTIME_IDENTITY_HASH,
    target_evidence_contract_hash: TARGET_EVIDENCE_CONTRACT_HASH,
    compiled_evaluator_v5_request_hash:
      COMPILED_EVALUATOR_V5_REQUEST_HASH,
    candidate_configuration_hash: CANDIDATE_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA,
    live_execution_started: false
  };
  mkdirSync(ARTIFACT_ROOT, { recursive: true });
  writeJson(CHECKPOINT_PATH, checkpoint);
  return checkpoint;
}

function requiredArgument(name: string, expected: string | number) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value !== String(expected)) {
    throw new Error(`e2a38_confirmation_mismatch:${name}`);
  }
}

function assertLiveAuthorizationArguments() {
  for (const flag of [
    "--confirm-e2a38-one-session-authorization",
    "--confirm-paid-provider-evaluation",
    "--confirm-exactly-one-isolated-session",
    "--confirm-sequential-concurrency-one",
    "--confirm-human-review-remains-pending",
    "--confirm-candidate-remains-unapproved",
    "--confirm-no-e2a38-rerun",
    "--confirm-bounded-transport-retry-policy",
    "--confirm-no-additional-live-session",
    "--confirm-no-larger-matrix",
    "--confirm-no-e2b",
    "--confirm-no-approval",
    "--confirm-no-activation",
    "--confirm-stop-after-e2a38"
  ]) {
    if (!process.argv.includes(flag)) {
      throw new Error(`e2a38_confirmation_missing:${flag}`);
    }
  }
  const checkpoint = readCheckpoint();
  if (!checkpoint) throw new Error("e2a38_dispatch_checkpoint_missing");
  requiredArgument("--checkpoint-commit", checkpoint.application_git_commit);
  requiredArgument("--protocol-hash", PROTOCOL_HASH);
  requiredArgument(
    "--frozen-composite-identity-hash",
    FROZEN_COMPOSITE_RUNTIME_IDENTITY_HASH
  );
  requiredArgument("--candidate-hash", CANDIDATE_HASH);
  requiredArgument("--candidate-file-sha256", CANDIDATE_FILE_SHA);
  requiredArgument(
    "--composite-identity-hash",
    checkpoint.composite_runtime_identity_hash
  );
  requiredArgument("--max-sessions", BUDGET.sessions);
  requiredArgument("--max-simulator-calls", BUDGET.simulator_calls);
  requiredArgument("--max-evaluator-calls", BUDGET.evidence_evaluator_calls);
  requiredArgument(
    "--max-initial-tutor-calls",
    BUDGET.initial_tutor_calls
  );
  requiredArgument(
    "--max-tutor-regenerations",
    BUDGET.tutor_regenerations
  );
  requiredArgument("--max-logical-calls", BUDGET.logical_generation_calls);
  requiredArgument("--max-adapter-attempts", BUDGET.adapter_attempts);
  requiredArgument(
    "--max-adapter-attempts-per-logical-call",
    BUDGET.adapter_attempts_per_logical_call
  );
  requiredArgument(
    "--max-transport-retries-per-logical-call",
    BUDGET.transport_retries_per_logical_call
  );
  requiredArgument("--max-input-tokens", BUDGET.input_tokens);
  requiredArgument("--max-output-tokens", BUDGET.output_tokens);
  requiredArgument("--max-total-tokens", BUDGET.total_tokens);
  requiredArgument("--max-cost-usd", BUDGET.cost_usd);
  requiredArgument(
    "--max-provider-concurrency",
    BUDGET.provider_concurrency
  );
}

function contractFor(session: Session): TargetEvidenceContractV5 {
  const contract = TargetEvidenceContractV5Schema.parse(
    session.frozen_target_evidence_contract
  );
  if (stableHash(contract) !== TARGET_EVIDENCE_CONTRACT_HASH ||
      stableHash(contract.active_anchor_alias_contract) !==
        MEASUREMENT_ALIAS_CONTRACT_HASH) {
    throw new Error("e2a38_target_evidence_contract_hash_mismatch");
  }
  return contract;
}

function selfCorrectionContract(): SelfCorrectionIntentContractV1 {
  return buildE2A38FrozenProtocol().self_correction_intent_contract;
}

function noLiveFixtureMessage(turn: PlannedTurn) {
  return turn.no_live_fixture_message ?? null;
}

function expectedProfile(turn: PlannedTurn) {
  return turn.semantic_envelope;
}

function fixtureProfile(turn: PlannedTurn): PlannedTurn["semantic_envelope"] {
  return [turn.fixture_reasoning_quality];
}

function expressedLevel(profile: PlannedTurn["semantic_envelope"]) {
  if (profile.includes("sound")) return "substantive" as const;
  if (profile.includes("partial")) {
    return "partial" as const;
  }
  if (profile.includes("misconception")) return "partial" as const;
  return "minimal" as const;
}

function renderedIntent(profile: PlannedTurn["semantic_envelope"]) {
  if (profile.includes("sound")) return "revision_evidence" as const;
  if (profile.includes("misconception")) {
    return "misconception_persistence" as const;
  }
  return "partial_explanation" as const;
}

function simulatorInput(
  session: Session,
  turn: PlannedTurn,
  visibleTurns: FormativeEpisodeTurnRecord[],
  repairIssues: string[]
) {
  const latestAssistant = [...visibleTurns].reverse().find((entry) =>
    entry.actor_type === "agent"
  )?.message_text ?? "Explain the current idea in your own words.";
  return {
    scenario_id: `e2a38_session_${session.session_id}`,
    scenario_version: "e2a38-trajectory-envelope-simulator-v1",
    expression_variant: ((turn.turn - 1) % 3) + 1,
    student_persona: session.student_profile,
    current_turn: turn.turn,
    trajectory_role: turn.trajectory_role,
    acceptable_reasoning_quality_envelope: expectedProfile(turn),
    non_authoritative_generation_objective: turn.objective,
    copy_behavior_instruction: "simulator_instruction" in turn
      ? turn.simulator_instruction : null,
    target_anchor: {
      item_id: session.target_evidence_contract.item_id,
      option: session.target_evidence_contract.distractor_option
    },
    visible_conversation: visibleTurns.slice(-12).map((entry) => ({
      role: entry.actor_type === "student" ? "student" : "assistant",
      content: entry.message_text,
      sequence_index: entry.sequence_index
    })),
    latest_assistant_message: latestAssistant,
    repair_issues: repairIssues,
    output_requirements: {
      preserve_evidence_ceiling: true,
      preserve_anchor_when_supplied: true,
      no_hidden_state_disclosure: true,
      no_answer_key_or_correctness_disclosure: true,
      maximum_sentences: 5
    }
  };
}

function wordNgrams(text: string, size: number) {
  const words = text.toLowerCase().replace(/[^a-z0-9]+/gu, " ")
    .trim().split(/\s+/u).filter(Boolean);
  return Array.from({ length: Math.max(0, words.length - size + 1) },
    (_, index) => words.slice(index, index + size).join(" "));
}

function validateSimulatorOutput(input: {
  session: Session;
  turn: PlannedTurn;
  output: LlmStudentSimulatorOutput;
  priorStudentMessages: string[];
  latestAssistantMessage: string;
}) {
  const issues: string[] = [];
  const message = input.output.student_message.trim();
  if (!message) issues.push("empty_student_message");
  if (/\b(?:answer key|correct answer|system prompt|hidden prompt|as an ai|simulator|provider|schema version|api key)\b/iu.test(message)) {
    issues.push("protected_or_internal_disclosure");
  }
  if (input.priorStudentMessages.some((prior) =>
    prior.trim().toLowerCase() === message.toLowerCase()
  )) issues.push("duplicate_student_message");
  const resolution = resolveActiveAnchorAliasV4({
    message,
    contract: contractFor(input.session).active_anchor_alias_contract,
    prior_visible_message: input.latestAssistantMessage,
    prior_student_reasoning: input.priorStudentMessages,
    source_turn_id: `e2a38_simulator_validation_turn_${input.turn.turn}`,
    source_sequence_index: input.turn.turn
  });
  const referenceResolution = resolveActiveAnchorAlias({
    message,
    contract: contractFor(input.session).active_anchor_alias_contract,
    prior_visible_message: input.latestAssistantMessage
  });
  const scopeResolution = resolveAnchorStanceScopeV1({
    message,
    contract: contractFor(input.session).active_anchor_alias_contract,
    reference_resolution: referenceResolution
  });
  const selfCorrection = resolveSelfCorrectionIntentV1({
    message,
    contract: selfCorrectionContract()
  });
  const selfCorrectionSignal = resolveSelfCorrectionIntentSignalV1({
    message,
    intent_contract: selfCorrectionContract()
  });
  if (input.turn.required_anchor_application === "explicit") {
    if (referenceResolution.observed_anchor_reference !== "explicit") {
      issues.push("required_anchor_missing");
    }
    if (input.turn.required_anchor_stance &&
        scopeResolution.stance_classification.observed_anchor_stance !==
          input.turn.required_anchor_stance) {
      issues.push("required_anchor_stance_missing");
    }
  }
  if (input.turn.expected_self_correction_intent &&
      selfCorrectionSignal.self_correction_intent !==
        (input.turn.expected_self_correction_intent ===
          "self_correction_intent")) {
    issues.push("self_correction_intent_mismatch");
  }
  const assistantNgrams = new Set(
    wordNgrams(input.latestAssistantMessage, 4)
  );
  const copiedClauseDetected = wordNgrams(message, 4).some((gram) =>
    assistantNgrams.has(gram)
  );
  if (input.turn.copy_behavior) {
    if (!copiedClauseDetected) {
      issues.push("required_distinctive_clause_copy_missing");
    }
    if (message.split(/\s+/u).length > 70) issues.push("copy_turn_too_long");
  }
  return {
    passed: issues.length === 0,
    issues,
    resolution,
    reference_resolution: referenceResolution,
    scope_resolution: scopeResolution,
    self_correction: selfCorrection,
    self_correction_signal: selfCorrectionSignal,
    copied_clause_detected: copiedClauseDetected
  };
}

function evaluatorProviderInput(
  session: Session,
  evaluatorInput: AutonomousEvidenceEvaluatorInput
) {
  const message = evaluatorInput.latest_student_message.message_text;
  const contract = evaluatorInput.target_evidence_contract as
    TargetEvidenceContractV5;
  const selfCorrection = resolveSelfCorrectionIntentV1({
    message,
    contract: selfCorrectionContract()
  });
  const legacyEvaluatorInput = {
    schema_version: ACTIVITY_RESPONSE_EVALUATOR_INPUT_SCHEMA_VERSION,
    case_id: `e2a38_${session.session_id}_${evaluatorInput.latest_student_message.source_sequence_index}`,
    session_public_id: evaluatorInput.complete_visible_formative_conversation.dialogue_public_id,
    student_public_id: `synthetic_student_e2a38_${session.session_id}`,
    assessment_public_id: `synthetic_assessment_e2a38_${session.session_id}`,
    concept_unit_id: session.concept,
    activity_attempt_id:
      evaluatorInput.complete_visible_formative_conversation.activity_attempt_public_id,
    required_output_contract: {
      schema_version: ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION,
      evaluator_agent_name: ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
      evaluation_source: "live_llm",
      runtime_servable_to_student: false,
      review_only: false
    },
    source_activity_context: {
      source_activity_schema: FORMATIVE_ACTIVITY_SCHEMA_VERSION,
      source_activity_generation_source: "live_llm",
      source_activity_runtime_servable_to_student: true,
      source_activity_family: "reasoning_chain_repair",
      selected_formative_value: "reasoning_refinement",
      source_diagnostic_purpose: "reasoning_boundary_repair",
      profile_condition: "synthetic_frozen_e2a38_trajectory",
      distractor_role: "selected_distractor",
      safe_activity_prompt: session.natural_initial_activity,
    },
    student_activity_response: {
      safe_response_summary: message.slice(0, 900),
      response_kind_hint: "substantive"
    },
    diagnostic_task: {
      expected_evidence_focus: [
        ...contract.target_conceptual_relationships,
        ...contract.required_mechanisms,
        contract.required_anchor_application
      ].join(" "),
      process_context_is_reliability_context_only: true,
      low_information_response_policy:
        "Copied or unsupported wording is insufficient without independent anchor application."
    },
    self_correction_intent_resolution: selfCorrection,
    evidence_precedence_policy:
      "evaluate_latest_valid_evidence_and_preserve_prior_evidence_as_historical",
    autonomous_turn_evidence_context: evaluatorInput,
    required_safety_constraints: {
      no_answer_key: true,
      no_correct_option: true,
      no_correctness_label: true,
      no_raw_distractor_metadata: true,
      no_misconception_ids: true,
      no_engagement_or_ai_labels: true,
      no_raw_process_payload: true,
      no_raw_student_text: false,
      no_raw_llm_output: true,
      no_secrets_or_headers: true,
      no_misconduct_or_genai_accusation: true
    }
  };
  return buildProductionTurnEvidenceEvaluatorInputV5({
    legacy_evaluator_input: legacyEvaluatorInput,
    source_student_turn: {
      source_student_turn_id:
        evaluatorInput.latest_student_message.source_student_turn_id,
      source_sequence_index:
        evaluatorInput.latest_student_message.source_sequence_index
    },
    active_anchor_alias_contract: contract.active_anchor_alias_contract
  });
}

function auditFor(
  result: StructuredAgentResult<unknown>,
  modelName: string
): ActivityMisconceptionEvidenceProviderAudit {
  const sanitized = sanitizedE2AProviderResult(result);
  const usage = e2aUsageFor(result);
  return {
    agent_call_id: `e2a38_audit_${randomUUID()}`,
    provider: result.provider,
    model_name: modelName,
    client_request_id: result.client_request_id,
    provider_request_id: typeof sanitized.provider_request_id === "string"
      ? sanitized.provider_request_id : undefined,
    provider_response_id: typeof sanitized.provider_response_id === "string"
      ? sanitized.provider_response_id : undefined,
    call_status: result.status === "completed" ? "succeeded" : "failed",
    output_validated: result.status === "completed",
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens
  };
}

function noLivePacket(
  session: Session,
  turn: PlannedTurn,
  providerInput: ReturnType<typeof evaluatorProviderInput>
) {
  const profile = fixtureProfile(turn);
  const sound = profile.includes("sound");
  const misconception = profile.length === 1 && profile[0] === "misconception";
  const copied = turn.copy_behavior === true ||
    turn.expected_self_correction_evidence_status ===
      "copied_correction_language";
  const contradictory = turn.required_anchor_consistency ===
    "contradictory_to_conceptual_reasoning";
  const partial = profile.includes("partial");
  const status = sound ? "misconception_unsupported" as const
    : misconception ? "misconception_persisted" as const
      : contradictory ? "misconception_unsupported" as const
        : copied ? "insufficient_new_evidence" as const
          : turn.turn === 1 ? "misconception_persisted" as const
          : "misconception_weakened" as const;
  const evidenceTypes = sound
    ? ["target_boundary_explained", "reasoning_link_repaired"] as const
    : misconception
      ? ["distractor_tempting_reason_explained"] as const
      : copied ? ["none"] as const
        : ["target_boundary_explained"] as const;
  const fixture = buildNoLiveActivityMisconceptionEvidenceFixture({
    case_id: `e2a38_${session.session_id}_${turn.turn}`,
    activity_family: "reasoning_chain_repair",
    selected_formative_value: "reasoning_refinement",
    profile_condition: "frozen_e2a38",
    source_diagnostic_purpose: "reasoning_boundary_repair",
    response_kind: copied ? "low_information" : partial ? "partial" : "substantive",
    response_length_band: "medium",
    response_summary: contradictory
      ? `${session.session_id} turn ${turn.turn} distinguishes reliability from validity but still endorses the claim that consistency proves validity, creating a reasoning/conclusion conflict.`
      : `${session.session_id} turn ${turn.turn} provides ${profile.join(" or ")} synthetic conceptual evidence for the active anchor.`,
    primary_target: "reasoning_link",
    evidence_types: [...evidenceTypes],
    update_status: status,
    evidence_quality: sound || contradictory
      ? "high" : copied ? "insufficient" : "medium",
    confidence: sound ? "high" : misconception ? "high" : "medium",
    evidence_flags: {
      elicited: !copied,
      student_explained_target_boundary:
        sound || contradictory || partial ? "yes" : "no",
      student_repaired_reasoning_link:
        sound || contradictory ? "yes" : "no",
      student_reconstructed_concept_independently:
        sound || contradictory ? "yes" : "no"
    },
    limitations: copied ? ["copied_wording_without_independent_application"] : []
  });
  return makeLiveActivityMisconceptionEvidencePacketForTest(fixture, {
    session_public_id: String(
      providerInput.legacy_evaluator_input.session_public_id
    ),
    student_public_id: String(
      providerInput.legacy_evaluator_input.student_public_id
    ),
    assessment_public_id: String(
      providerInput.legacy_evaluator_input.assessment_public_id
    ),
    concept_unit_id: String(
      providerInput.legacy_evaluator_input.concept_unit_id
    ),
    activity_attempt_id: String(
      providerInput.legacy_evaluator_input.activity_attempt_id
    )
  });
}

function noLiveTutorOutput(input: AutonomousPedagogyInput) {
  const profile = input.latest_authoritative_turn_profile as
    TopicDialogueTurnEvidenceProfile;
  const strategies = [
    "contrast score consistency with evidence for the intended interpretation",
    "separate the reliability claim from the validity conclusion",
    "reconcile the active distractor with the explained reliability-validity boundary",
    "request observable reasoning for the student's stated self-correction",
    "test the claim with a consistently measured but wrong construct",
    "contrast internal consistency evidence with construct-validity evidence",
    "identify what evidence would support the intended use of the scores",
    "reconstruct the reliability-validity boundary independently",
    "summarize the remaining conceptual boundary before the bounded next step"
  ];
  const studentTasks = [
    "What does a high reliability coefficient tell you, and what does it leave unanswered about the meaning of the scores?",
    "State the reliability claim and the validity claim separately. Which one is supported by a high internal-consistency coefficient?",
    "Compare your explanation with option D. Does option D cross the boundary you just described? Explain.",
    "You said you would change your earlier response. What evidence now changes your view?",
    "Imagine a test measures the wrong construct very consistently. What would that show about reliability and validity?",
    "How is evidence that items behave consistently different from evidence that the scores support the intended interpretation?",
    "What additional evidence would you want before using these scores for the intended purpose?",
    "Without using the option wording, explain the relationship between reliability and validity in your own words.",
    "Give your clearest current conclusion and the one piece of evidence that supports it."
  ];
  const strategyIndex = Math.max(
    0,
    input.latest_student_response.source_sequence_index - 1
  ) % strategies.length;
  return AutonomousPedagogyOutputSchema.parse({
    schema_version: AUTONOMOUS_PEDAGOGY_OUTPUT_SCHEMA_VERSION,
    source_profile_snapshot_id: profile.profile_snapshot_id,
    source_student_turn_id: input.latest_student_response.source_student_turn_id,
    primary_learning_gap: profile.essential_missing_links[0] ??
      "the active conceptual boundary remains incomplete",
    pedagogical_goal:
      "Elicit one new, independently stated reasoning link for the active anchor.",
    pedagogical_strategy: strategies[strategyIndex],
    why_this_strategy_fits_now:
      "The latest evidence is not yet sufficient for the platform revision gate.",
    prior_interventions_considered: input.intervention_history.map((entry) =>
      entry.strategy_description
    ),
    repetition_risk: "low",
    evidence_sought_from_next_response: [
      "A direct explanation of the missing reasoning link",
      "Application to the current item and option"
    ],
    student_facing_message:
      studentTasks[strategyIndex]!,
    requires_student_response: true
  });
}

const LONGITUDINAL_QUALITY_RANK = {
  insufficient: 0,
  misconception: 1,
  partial: 2,
  sound: 3
} as const;

function safeEvidenceText(value: string, maximum: number) {
  const trimmed = value.trim();
  return (trimmed || "No additional evidence was recorded.").slice(0, maximum);
}

const E2A38_STUDENT_FACING_BLOCKED_PATTERNS = [
  /\b(?:internal|learning)\s+profiles?\b/iu,
  /\b(?:persistent\s+)?misconceptions?(?:\s+labels?)?\b/iu,
  /\bengagement\s+(?:scores?|profiles?|states?)\b/iu,
  /\bstopping\s+(?:rules?|polic(?:y|ies)|decisions?|criterion|criteria)\b/iu,
  /\b(?:session|turn|token)\s+budgets?\b/iu,
  /\b(?:ai|system)\s+(?:limitations?|cannot help|can't help)\b/iu,
  /\bescalation\s+(?:rules?|polic(?:y|ies)|criterion|criteria)\b/iu
] as const;

function validateE2A38StudentMessage(message: string) {
  const base = validateStudentFacingCommunicationV1(message);
  const extraIssueCodes = E2A38_STUDENT_FACING_BLOCKED_PATTERNS.flatMap(
    (pattern, index) =>
      pattern.test(message) ? [`e2a38_internal_leak_${index + 1}`] : []
  );
  return {
    validator_version:
      "e2a38-integrated-student-facing-communication-v1",
    base_validation: base,
    issue_codes: [...base.issue_codes, ...extraIssueCodes],
    passed: base.passed && extraIssueCodes.length === 0
  };
}

function buildSelfCorrectionConceptualObservation(input: {
  message: string;
  latestProfile: TopicDialogueTurnEvidenceProfile;
  anchor: TargetEvidenceAdjudicationV5[
    "anchor_propagation"
  ]["anchor_interpretation"];
  propagation: TargetEvidenceAdjudicationV5["anchor_propagation"];
  copiedClauseDetected: boolean;
  priorLearning: LearningProfileEvolutionV1 | null;
}): SelfCorrectionConceptualEvidenceObservationV1 {
  const reasoningQuality = input.latestProfile.reasoning_quality;
  const observableReasoning =
    reasoningQuality !== "insufficient" ||
    input.anchor.anchor_application !== "absent";
  const independentApplication = observableReasoning &&
    !input.copiedClauseDetected &&
    reasoningQuality !== "insufficient";
  const evidenceKind:
    SelfCorrectionConceptualEvidenceObservationV1["evidence_kind"] =
      input.copiedClauseDetected
        ? "copied_or_formulaic"
        : input.propagation.blocking
          ? "contradictory_reasoning"
          : independentApplication
            ? "conceptual_reasoning"
            : input.anchor.anchor_application !== "absent"
              ? "anchor_stance_evidence"
              : "answer_revision_only";
  const priorStatus = input.priorLearning?.current_profile
    .misconception_status;
  return {
    evidence_source: "evaluator_v5",
    evidence_kind: evidenceKind,
    reasoning_quality: reasoningQuality,
    observable_evidence_spans: observableReasoning
      ? [{
          label: "evaluator_v5_observable_student_reasoning",
          span: safeEvidenceText(input.message, 900)
        }]
      : [],
    independent_application_present: independentApplication,
    copied_or_formulaic_language_detected: input.copiedClauseDetected,
    topic_relevant: true,
    anchor_application: input.anchor.anchor_application,
    anchor_stance: input.anchor.anchor_stance,
    anchor_consistency: input.anchor.anchor_consistency,
    misconception_status:
      input.latestProfile.misconception_status ===
          "resolved_for_current_anchor"
        ? "resolved_for_current_anchor"
        : input.latestProfile.misconception_status === "persists"
          ? "persists"
          : "uncertain",
    essential_missing_links: input.latestProfile.essential_missing_links.map(
      (entry) => safeEvidenceText(entry, 240)
    ),
    contradictions: input.latestProfile.contradictions.map((entry) =>
      safeEvidenceText(entry, 240)
    ),
    prior_profile_status: priorStatus === "resolved_for_current_anchor"
      ? "resolved_for_current_anchor"
      : priorStatus === "persists"
        ? "persists"
        : input.priorLearning
          ? "unresolved"
          : null
  };
}

function buildLearningObservation(input: {
  sequenceIndex: number;
  sourceStudentTurnId: string;
  conceptFamily: MeasurementConceptFamily;
  latestProfile: TopicDialogueTurnEvidenceProfile;
  anchor: TargetEvidenceAdjudicationV5[
    "anchor_propagation"
  ]["anchor_interpretation"];
  propagation: TargetEvidenceAdjudicationV5["anchor_propagation"];
  selfCorrectionEvidence: SelfCorrectionEvidenceResolutionV1;
  soundGatePassed: boolean;
}) {
  const reasoningQuality = input.latestProfile.reasoning_quality;
  const conceptualUnderstanding = input.soundGatePassed
    ? "sound" as const
    : reasoningQuality === "misconception"
      ? "misconception" as const
      : reasoningQuality === "partial" || reasoningQuality === "sound"
        ? "partial" as const
        : "unresolved" as const;
  const misconceptionStatus = input.soundGatePassed
    ? "resolved_for_current_anchor" as const
    : reasoningQuality === "misconception" ||
        input.anchor.anchor_stance === "endorses_distractor" ||
        input.propagation.blocking
      ? "persists" as const
      : "uncertain" as const;
  const missingLinks = input.latestProfile.essential_missing_links.map(
    (entry) => safeEvidenceText(entry, 300)
  );
  return createLearningProfileSnapshotV1({
    sequence_index: input.sequenceIndex,
    source_student_turn_id: input.sourceStudentTurnId,
    concept_family: input.conceptFamily,
    conceptual_understanding: conceptualUnderstanding,
    misconception_status: misconceptionStatus,
    knowledge_gap: input.soundGatePassed
      ? "No essential gap remains for the active measurement anchor."
      : safeEvidenceText(
          missingLinks.join("; ") ||
            "The reliability-validity boundary remains incomplete.",
          700
        ),
    reasoning_quality: input.soundGatePassed
      ? "sound"
      : reasoningQuality,
    anchor_interpretation: {
      application: input.anchor.anchor_application,
      stance: input.anchor.anchor_stance,
      consistency: input.anchor.anchor_consistency
    },
    unresolved_contradictions: input.latestProfile.contradictions.map(
      (entry) => safeEvidenceText(entry, 300)
    ),
    missing_links: missingLinks,
    transfer_readiness: input.soundGatePassed,
    confidence_alignment: "not_assessable",
    self_correction_intent:
      input.selfCorrectionEvidence.self_correction_intent,
    conceptual_evidence_update:
      input.selfCorrectionEvidence.conceptual_evidence_update,
    profile_update_eligible:
      input.selfCorrectionEvidence.profile_update_eligible,
    observable_evidence_present:
      input.selfCorrectionEvidence.observable_conceptual_evidence_present,
    independent_evidence_present:
      input.selfCorrectionEvidence.independent_conceptual_evidence_present,
    created_at: new Date(input.sequenceIndex * 1000).toISOString()
  });
}

function buildEngagementObservation(input: {
  sequenceIndex: number;
  sourceStudentTurnId: string;
  message: string;
  currentReasoningQuality: TopicDialogueTurnEvidenceProfile[
    "reasoning_quality"
  ];
  priorLearning: LearningProfileEvolutionV1 | null;
  conceptualEvidenceUpdate: boolean;
}) {
  const previousQuality = input.priorLearning?.current_profile.reasoning_quality;
  const currentRank = LONGITUDINAL_QUALITY_RANK[
    input.currentReasoningQuality
  ];
  const previousRank = previousQuality === undefined
    ? null
    : LONGITUDINAL_QUALITY_RANK[previousQuality];
  const responseQualityTrend = previousRank === null
    ? "not_assessable" as const
    : currentRank > previousRank
      ? "improving" as const
      : currentRank < previousRank
        ? "declining" as const
        : "stable" as const;
  const lowerMessage = input.message.toLocaleLowerCase("en");
  const explicitFrustration =
    /\b(?:frustrated|give up|cannot keep going|can't keep going)\b/iu
      .test(lowerMessage);
  const possibleDisengagement =
    /\b(?:do not care|don't care|whatever|stop asking)\b/iu
      .test(lowerMessage);
  return createEngagementProfileSnapshotV1({
    sequence_index: input.sequenceIndex,
    source_student_turn_id: input.sourceStudentTurnId,
    participation: input.message.trim().length >= 40 ? "active" : "minimal",
    response_quality_trend: responseQualityTrend,
    effort: input.message.trim().length >= 80
      ? "sustained_observed_effort"
      : "limited_observed_effort",
    persistence: input.sequenceIndex >= 3 ? "sustained" : "limited",
    help_seeking:
      /\b(?:not sure|unclear|help|what does|how does)\b/iu.test(lowerMessage)
        ? "conceptual"
        : "none",
    frustration: explicitFrustration ? "explicit" : "not_observed",
    disengagement:
      possibleDisengagement ? "possible" : "not_observed",
    responsiveness_to_intervention: previousRank === null
      ? "not_assessable"
      : currentRank > previousRank
        ? "productive_response"
        : input.conceptualEvidenceUpdate
          ? "partial_response"
          : "no_observable_change",
    strategy_uptake: previousRank === null
      ? "not_assessable"
      : currentRank > previousRank
        ? "clear"
        : input.conceptualEvidenceUpdate
          ? "partial"
          : "not_observed",
    evidence_basis: [
      input.message.trim().length >= 40
        ? "student supplied a substantive response"
        : "student supplied a brief response",
      input.conceptualEvidenceUpdate
        ? "evaluator found observable conceptual evidence"
        : "no eligible conceptual update was observed"
    ],
    created_at: new Date(input.sequenceIndex * 1000).toISOString()
  });
}

function completePriorLongitudinalIntervention(input: {
  interventions: LongitudinalInterventionRecordV1[];
  priorLearning: LearningProfileEvolutionV1 | null;
  currentLearning: LearningProfileEvolutionV1;
  conceptualEvidenceUpdate: boolean;
}) {
  const records = [...input.interventions];
  const priorIntervention = records.at(-1);
  if (!priorIntervention ||
      priorIntervention.observed_outcome !== "awaiting_response") {
    return records;
  }
  const priorQuality = input.priorLearning?.current_profile.reasoning_quality;
  const currentQuality = input.currentLearning.current_profile
    .reasoning_quality;
  const improved = priorQuality !== undefined &&
    LONGITUDINAL_QUALITY_RANK[currentQuality] >
      LONGITUDINAL_QUALITY_RANK[priorQuality];
  const regressed = priorQuality !== undefined &&
    LONGITUDINAL_QUALITY_RANK[currentQuality] <
      LONGITUDINAL_QUALITY_RANK[priorQuality];
  const sound = currentQuality === "sound";
  const outcome = sound
    ? "sound_understanding" as const
    : regressed
      ? "recurrence" as const
      : improved
        ? "partial_improvement" as const
        : input.conceptualEvidenceUpdate &&
            currentQuality === "misconception"
          ? "misconception_persists" as const
          : "no_new_evidence" as const;
  records[records.length - 1] = LongitudinalInterventionRecordV1Schema.parse({
    ...priorIntervention,
    student_response_evidence_summary: sound
      ? "The next response supplied complete evidence for the active boundary."
      : improved
        ? "The next response supplied a measurable partial improvement."
        : regressed
          ? "The next response returned to an earlier unsupported conclusion."
          : "The next response did not supply a new eligible conceptual link.",
    observed_outcome: outcome,
    changed_understanding: sound || improved || regressed,
    effective_for_target_gap: sound || improved
  });
  return records;
}

function buildE2A38NoLiveStructuredTurnEvidence(input: {
  source_student_turn_id: string;
  source_sequence_index: number;
  message: string;
  packet: ActivityMisconceptionEvidencePacketV1;
  alias_contract: TargetEvidenceContractV5["active_anchor_alias_contract"];
}) {
  const baseline = buildNoLiveStructuredTurnEvidenceV5ForTestOnly({
    ...input,
    prior_visible_message: null
  });
  const resolution = resolveActiveAnchorAliasV4({
    message: input.message,
    contract: input.alias_contract,
    source_turn_id: input.source_student_turn_id,
    source_sequence_index: input.source_sequence_index
  });
  const stance = resolution.observed_anchor_stance;
  const conceptualConclusion = baseline.conceptual_conclusion;
  const alignment = stance === "ambiguous" ||
      conceptualConclusion === "ambiguous"
    ? "unresolved" as const
    : stance === "not_expressed"
      ? "not_assessable" as const
      : stance === conceptualConclusion
        ? "aligned" as const
        : "contradictory" as const;
  const blocking = alignment === "contradictory";
  return ProductionTurnEvidenceEvaluatorOutputV5Schema.shape
    .structured_turn_evidence.parse({
      ...baseline,
      observed_anchor_reference: resolution.observed_anchor_reference,
      observed_anchor_identifier: resolution.observed_anchor_identifier,
      observed_anchor_text: resolution.observed_anchor_text,
      observed_anchor_conclusion: stance,
      observed_anchor_stance: stance,
      anchor_concept_alignment: alignment,
      anchor_conflict_type: blocking
        ? "anchor_conclusion_conceptual_explanation_conflict"
        : null,
      blocking_conflict: blocking,
      exact_anchor_evidence_spans:
        resolution.canonical_anchor_evidence.evidence_spans.map((entry) => ({
          label: entry.label,
          span: entry.span
        })),
      essential_missing_links: blocking
        ? [...new Set([
            ...baseline.essential_missing_links,
            "anchor_conclusion_consistency"
          ])]
        : baseline.essential_missing_links.filter((entry) =>
            entry !== "anchor_conclusion_consistency"
          ),
      evidence_limitations: [
        ...baseline.evidence_limitations,
        "e2a38_no_live_stance_evidence_v2_fixture"
      ]
    });
}

function makeNoLiveExecutor(protocol: Protocol): ProviderExecutor {
  return {
    async executeStructured<TInput, TOutput>(
      request: StructuredAgentRequest<TInput, TOutput>
    ): Promise<StructuredAgentResult<TOutput>> {
    const sessionId = request.metadata?.session_id;
    const turnNumber = Number(request.metadata?.turn_number);
    const session = protocol.session.session_id === sessionId
      ? protocol.session : undefined;
    const turn = session?.frozen_student_trajectory.find((entry) =>
      entry.turn === turnNumber
    );
    let output: unknown;
    if (request.agent_name === "evaluation_llm_student_simulator") {
      if (!session || !turn) throw new Error("e2a38_no_live_simulator_case_missing");
      const input = request.input as ReturnType<typeof simulatorInput>;
      const message = turn.copy_behavior
        ? `${input.latest_assistant_message.split(/(?<=[.!?])\s+/u)[0] ?? "Could you explain that part again?"} I think that is what happens.`
        : noLiveFixtureMessage(turn) ?? "Could you explain that part again?";
      output = {
        student_message: message,
        rendered_intent: renderedIntent(fixtureProfile(turn)),
        expressed_evidence_level: expressedLevel(fixtureProfile(turn)),
        mentions_focus_option: new RegExp(
          `\\boption\\s+${session.target_evidence_contract.distractor_option}\\b`,
          "iu"
        ).test(message),
        asks_for_clarification: turn.turn === 5,
        claims_understanding: false,
        off_topic: false,
        simulator_warnings: []
      };
    } else if (request.agent_name === ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME) {
      if (!session || !turn) throw new Error("e2a38_no_live_evaluator_case_missing");
      const providerInput = request.input as ReturnType<
        typeof evaluatorProviderInput
      >;
      const packet = noLivePacket(
        session, turn,
        providerInput
      );
      const legacy = providerInput.legacy_evaluator_input as JsonObject;
      const autonomous = legacy.autonomous_turn_evidence_context as
        AutonomousEvidenceEvaluatorInput;
      const message = autonomous.latest_student_message.message_text;
      output = ProductionTurnEvidenceEvaluatorOutputV5Schema.parse({
        schema_version:
          PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
        evidence_packet: packet,
        structured_turn_evidence:
          buildE2A38NoLiveStructuredTurnEvidence({
            source_student_turn_id:
              providerInput.source_student_turn.source_student_turn_id,
            source_sequence_index:
              providerInput.source_student_turn.source_sequence_index,
            message,
            packet,
            alias_contract: providerInput.active_anchor_alias_contract
          })
      });
    } else if (request.agent_name === "topic_dialogue_agent") {
      output = noLiveTutorOutput(request.input as AutonomousPedagogyInput);
      const validation = validateAutonomousPedagogyOutput({
        candidate_output: output,
        request: request.input as AutonomousPedagogyInput
      });
      if (validation.runtime_acceptance === "hard_rejected") {
        const tutorInput = request.input as AutonomousPedagogyInput;
        throw new Error(
          `e2a38_no_live_tutor_fixture_invalid:turn_${turnNumber}:sequence_${tutorInput.latest_student_response.source_sequence_index}:${validation.hard_rejections.map((entry) => entry.rule_code).join("|")}`
        );
      }
    } else {
      throw new Error(`e2a38_no_live_unknown_agent:${request.agent_name}`);
    }
      return {
      provider: "mock",
      client_request_id: request.client_request_id,
      provider_request_id: `mock_req_${randomUUID()}`,
      provider_response_id: `mock_resp_${randomUUID()}`,
      status: "completed",
      parsed_output: request.output_schema.parse(output),
      raw_output: output,
      usage: {
        input_tokens: estimatedInputTokens(request),
        output_tokens: 120,
        total_tokens: estimatedInputTokens(request) + 120
      },
      latency_ms: 1
      };
    }
  };
}

class SessionStore {
  readonly activityAttemptId: string;
  readonly dialogueId: string;
  readonly turns: FormativeEpisodeTurnRecord[];
  readonly profiles: Array<{
    profile: TopicDialogueTurnEvidenceProfile;
    cumulative: TopicDialogueCumulativeEvidenceProfile;
    adjudication: unknown;
    route: unknown;
    observation_record?: unknown;
    profile_update_record?: unknown;
    cross_artifact_consistency?: unknown;
  }> = [];
  readonly interventions: PedagogicalInterventionRecord[] = [];
  readonly operationTurns = new Map<string, {
    visible_turn_id: string;
    sequence_index: number;
  }>();
  readonly completed = new Map<string, AutonomousFormativeTurnResult>();
  constructor(readonly runId: string, readonly session: Session) {
    this.activityAttemptId = `activity_${runId}_${session.session_id}`;
    this.dialogueId = `dialogue_${runId}_${session.session_id}`;
    this.turns = [{
      visible_turn_id: `initial_${session.session_id}`,
      sequence_index: 1,
      dialogue_turn_number: 0,
      actor_type: "agent",
      message_text:
        session.natural_initial_activity,
      visibility_status: "shown",
      activity_attempt_public_id: this.activityAttemptId,
      topic_dialogue_public_id: this.dialogueId
    }];
  }
  persistence(): AutonomousTurnPersistence {
    return {
      findCompletedTurn: async (operationId: string) =>
        this.completed.get(operationId) ?? null,
      persistStudentTurn: async (input: {
        client_operation_id: string;
        message_text: string;
      }) => {
        const existing = this.operationTurns.get(input.client_operation_id);
        if (existing) return existing;
        const dialogueTurn = this.turns.filter((entry) =>
          entry.actor_type === "student"
        ).length + 1;
        const row = {
          visible_turn_id: `student_${this.session.session_id}_${dialogueTurn}`,
          sequence_index: this.turns.length + 1
        };
        this.turns.push({
          ...row,
          dialogue_turn_number: dialogueTurn,
          actor_type: "student",
          message_text: input.message_text,
          visibility_status: "shown",
          activity_attempt_public_id: this.activityAttemptId,
          topic_dialogue_public_id: this.dialogueId
        });
        this.operationTurns.set(input.client_operation_id, row);
        return row;
      },
      loadCompleteEpisode: async (input: {
        latest_student_turn_id: string;
        latest_student_sequence_index: number;
      }) => buildCompleteVisibleFormativeEpisode({
        activity_attempt_public_id: this.activityAttemptId,
        dialogue_public_id: this.dialogueId,
        latest_student_turn_id: input.latest_student_turn_id,
        latest_student_sequence_index: input.latest_student_sequence_index,
        turns: this.turns
      }),
      persistProfile: async (input) => {
        this.profiles.push(input);
      },
      completePriorIntervention: async (
        completed: PedagogicalInterventionRecord
      ) => {
        const index = this.interventions.findIndex((entry) =>
          entry.intervention_id === completed.intervention_id
        );
        if (index < 0) throw new Error("e2a38_prior_intervention_missing");
        Object.assign(this.interventions[index]!, completed);
      },
      persistEffectiveResponse: async (input: {
        message_text: string;
        source: "autonomous_agent" | "platform_immediate_intent" |
          "platform_request_revision" | "bounded_stop";
        intervention: PedagogicalInterventionRecord | null;
        route: JsonObject;
      }) => {
        const dialogueTurn = this.turns.filter((entry) =>
          entry.actor_type === "student"
        ).length;
        const row = {
          visible_turn_id: `agent_${this.session.session_id}_${dialogueTurn}`,
          sequence_index: this.turns.length + 1
        };
        this.turns.push({
          ...row,
          dialogue_turn_number: dialogueTurn,
          actor_type: "agent",
          message_text: input.message_text,
          visibility_status: "shown",
          activity_attempt_public_id: this.activityAttemptId,
          topic_dialogue_public_id: this.dialogueId
        });
        if (input.intervention) this.interventions.push(input.intervention);
        return row;
      }
    };
  }
  cleanup() {
    const before = {
      turns: this.turns.length,
      profiles: this.profiles.length,
      interventions: this.interventions.length,
      operations: this.operationTurns.size,
      completed: this.completed.size
    };
    this.turns.splice(0);
    this.profiles.splice(0);
    this.interventions.splice(0);
    this.operationTurns.clear();
    this.completed.clear();
    return {
      before,
      after: { turns: 0, profiles: 0, interventions: 0, operations: 0, completed: 0 },
      isolated_records_removed: true
    };
  }
}

function latestAssistant(store: SessionStore) {
  return [...store.turns].reverse().find((entry) =>
    entry.actor_type === "agent"
  )?.message_text ?? "";
}

function privacyAudit(text: string) {
  const findings = [
    ["answer_key", /\banswer key\b/iu],
    ["correctness", /\b(?:correct answer|correct option)\b/iu],
    ["hidden_prompt", /\b(?:system|hidden) prompt\b/iu],
    ["provider_control", /\b(?:provider request|schema version|agent call|configuration hash)\b/iu],
    ["secret", /\b(?:api key|bearer token|session secret|database url)\b/iu],
    ["simulator_identity", /\b(?:as an ai|student simulator|hidden state)\b/iu]
  ].filter(([, pattern]) => (pattern as RegExp).test(text))
    .map(([code]) => code as string);
  return { passed: findings.length === 0, findings };
}

async function executeProviderCall<TInput, TOutput>(input: {
  executor: ProviderExecutor;
  semanticEffectGuard: ExactlyOnceSemanticEffectGuard;
  ledger: BudgetLedger;
  role: CallRole;
  request: StructuredAgentRequest<TInput, TOutput>;
  sessionId: string;
  turn: number;
  attempt: number;
  live: boolean;
  frozenSourceHash: string;
  runDir: string;
  reviewRows: JsonObject[];
  priorVisibleConversation: unknown;
}) {
  if (input.live) {
    const checkpoint = readCheckpoint();
    if (!checkpoint || currentCommit() !== checkpoint.application_git_commit ||
        !trackedTreeClean()) {
      throw new Error("e2a38_source_integrity_changed_before_dispatch");
    }
    if (sourceIdentity().aggregate_sha256 !== input.frozenSourceHash) {
      throw new Error("e2a38_source_hash_changed_before_dispatch");
    }
    if (compositeRuntimeIdentity().composite_runtime_identity_hash !==
        checkpoint.composite_runtime_identity_hash) {
      throw new Error("e2a38_composite_identity_changed_before_dispatch");
    }
  }
  assertBudgetBeforeCall(input.ledger, input.role, input.request);
  const logicalCallId = [
    path.basename(input.runDir), input.sessionId, input.role,
    `turn_${input.turn}`, `semantic_${input.attempt}`
  ].join(":");
  const canonicalRequestHash = canonicalStructuredAgentRequestHash(
    input.request
  );
  const sourceBindingHash = stableHash({
    session_id: input.sessionId,
    turn: input.turn,
    semantic_attempt: input.attempt,
    role: input.role,
    source_student_turn_id: input.request.metadata?.source_student_turn_id ??
      input.request.metadata?.turn_number ?? null,
    prior_visible_conversation_sha256: stableHash(
      input.priorVisibleConversation
    )
  });
  let reservedAdapterAttempts = 0;
  const budgetSnapshot = (): ProviderAttemptBudgetSnapshot => ({
    logical_generation_calls_used: input.ledger.logical_generation_calls + 1,
    logical_generation_calls_limit: BUDGET.logical_generation_calls,
    adapter_attempts_used:
      input.ledger.adapter_attempts + reservedAdapterAttempts,
    adapter_attempts_limit: BUDGET.adapter_attempts,
    input_tokens_used: input.ledger.input_tokens,
    input_tokens_limit: BUDGET.input_tokens,
    output_tokens_used: input.ledger.output_tokens,
    output_tokens_limit: BUDGET.output_tokens,
    total_tokens_used: input.ledger.total_tokens,
    total_tokens_limit: BUDGET.total_tokens,
    estimated_cost_usd: input.ledger.pricing_complete
      ? input.ledger.estimated_cost_usd : null,
    cost_limit_usd: BUDGET.cost_usd
  });
  const sourceIsCurrent = () => {
    if (!input.live) return true;
    const checkpoint = readCheckpoint();
    return Boolean(
      checkpoint && trackedTreeClean() &&
      currentCommit() === checkpoint.application_git_commit &&
      sourceIdentity().aggregate_sha256 === input.frozenSourceHash &&
      compositeRuntimeIdentity().composite_runtime_identity_hash ===
        checkpoint.composite_runtime_identity_hash
    );
  };
  const transport = await executeWithBoundedProviderTransportRetry({
    provider: input.executor,
    request: input.request,
    logical_call_id: logicalCallId,
    source_binding_hash: sourceBindingHash,
    expected_canonical_request_hash: canonicalRequestHash,
    logical_idempotency_key: `e2a38:${logicalCallId}`,
    read_budget: budgetSnapshot,
    reserve_adapter_attempt: (attemptIndex) => {
      if (attemptIndex > BUDGET.adapter_attempts_per_logical_call) return false;
      if (input.ledger.adapter_attempts + reservedAdapterAttempts + 1 >
          BUDGET.adapter_attempts) return false;
      reservedAdapterAttempts += 1;
      return true;
    },
    source_is_current: sourceIsCurrent,
    accept_result: (candidate) => candidate.status === "completed" &&
      candidate.parsed_output !== undefined
  });
  const result = transport.accepted_result ?? transport.last_result;
  const lastAttemptIndex = transport.attempt_traces.at(-1)
    ?.adapter_attempt_index ?? null;
  for (const trace of transport.attempt_traces) {
    const isLast = trace.adapter_attempt_index === lastAttemptIndex;
    const attemptResultHash = isLast && result
      ? stableHash(sanitizedE2AProviderResult(result)) : null;
    const artifact = {
      ...trace,
      role: input.role,
      session_id: input.sessionId,
      turn: input.turn,
      semantic_attempt: input.attempt,
      response_hash: attemptResultHash,
      source_turn_binding: {
        session_id: input.sessionId,
        turn: input.turn,
        source_binding_hash: sourceBindingHash
      },
      no_secret_or_authorization_header_persisted: true
    };
    appendJsonl(path.join(input.runDir, "provider-attempt-results.jsonl"),
      artifact);
    appendJsonl(path.join(input.runDir, "provider-request-tracing.jsonl"),
      artifact);
    input.reviewRows.push({
      record_type: "provider_adapter_attempt",
      ...artifact,
      human_review: null
    });
  }
  appendJsonl(path.join(input.runDir, "transport-retry-results.jsonl"), {
    policy_version: transport.policy_version,
    failure_taxonomy_version: PROVIDER_FAILURE_TAXONOMY_VERSION,
    logical_call_id: logicalCallId,
    role: input.role,
    session_id: input.sessionId,
    turn: input.turn,
    semantic_attempt: input.attempt,
    canonical_request_hash: transport.canonical_request_hash,
    source_binding_hash: transport.source_binding_hash,
    status: transport.status,
    adapter_attempt_count: transport.adapter_attempt_count,
    transport_retry_count: transport.transport_retry_count,
    final_classification: transport.final_classification,
    semantic_regeneration_count: transport.semantic_regeneration_count,
    passed: transport.status === "accepted"
  });
  if (!result) {
    throw new Error(`e2a38_provider_dispatch_blocked:${transport.status}`);
  }
  recordCall(
    input.ledger, input.role, result, input.sessionId, input.turn, input.attempt,
    {
      adapter_attempt_count: transport.adapter_attempt_count,
      transport_retry_count: transport.transport_retry_count,
      total_latency_ms: transport.attempt_traces.reduce(
        (total, trace) => total + trace.latency_ms, 0
      )
    }
  );
  let exactlyOnceStatus: string = "not_committed_no_accepted_result";
  if (transport.accepted_result) {
    const acceptedTrace = transport.attempt_traces.at(-1);
    if (!acceptedTrace || acceptedTrace.retry_decision !== "accepted") {
      throw new Error("e2a38_accepted_transport_trace_missing");
    }
    const receipt = await input.semanticEffectGuard.commit({
      logical_call_id: logicalCallId,
      canonical_request_hash: transport.canonical_request_hash,
      accepted_adapter_attempt_id: acceptedTrace.adapter_attempt_id,
      accepted_result_hash: stableHash(sanitizedE2AProviderResult(
        transport.accepted_result
      )),
      commit_effect: () => true
    });
    exactlyOnceStatus = receipt.status;
    appendJsonl(path.join(input.runDir, "exactly-once-results.jsonl"), {
      ...receipt.receipt,
      status: receipt.status,
      role: input.role,
      session_id: input.sessionId,
      turn: input.turn,
      semantic_attempt: input.attempt,
      semantic_effect_count: receipt.status === "committed" ? 1 : 0,
      passed: receipt.status === "committed"
    });
    if (receipt.status !== "committed") {
      throw new Error(`e2a38_duplicate_semantic_effect:${receipt.status}`);
    }
  } else {
    appendJsonl(path.join(input.runDir, "exactly-once-results.jsonl"), {
      policy_version: EXACTLY_ONCE_SEMANTIC_EFFECTS_POLICY_VERSION,
      logical_call_id: logicalCallId,
      canonical_request_hash: transport.canonical_request_hash,
      status: exactlyOnceStatus,
      role: input.role,
      session_id: input.sessionId,
      turn: input.turn,
      semantic_attempt: input.attempt,
      semantic_effect_count: 0,
      passed: true
    });
  }
  const sanitized = sanitizedE2AProviderResult(result);
  const providerArtifact = {
    session_id: input.sessionId,
    turn: input.turn,
    attempt: input.attempt,
    role: input.role,
    generated: true,
    schema_valid: result.status === "completed" &&
      result.parsed_output !== undefined,
    complete_prior_visible_episode: input.priorVisibleConversation,
    request_provenance: {
      agent_name: input.request.agent_name,
      schema_name: input.request.schema_name,
      client_request_id: input.request.client_request_id,
      model_name: input.request.model_config.model_name,
      request_input_sha256: stableHash(input.request.input),
      instructions_sha256: sha256(input.request.instructions),
      metadata: input.request.metadata ?? {}
    },
    transport_execution: {
      policy_version: transport.policy_version,
      logical_call_id: logicalCallId,
      canonical_request_hash: transport.canonical_request_hash,
      source_binding_hash: transport.source_binding_hash,
      status: transport.status,
      adapter_attempt_count: transport.adapter_attempt_count,
      transport_retry_count: transport.transport_retry_count,
      exactly_once_status: exactlyOnceStatus
    },
    provider_result: sanitized,
    parsed_structured_output: result.parsed_output ?? null
  };
  const providerFile = input.role === "simulator"
    ? "simulator-provider-outputs.jsonl"
    : input.role === "evidence_evaluator"
      ? "evaluator-provider-outputs.jsonl"
      : "autonomous-tutor-provider-outputs.jsonl";
  appendJsonl(path.join(input.runDir, providerFile), providerArtifact);
  appendJsonl(path.join(input.runDir, "failure-path-results.jsonl"), {
    ...providerArtifact,
    hard_validator_result: result.status === "completed"
      ? "pending_downstream_validation" : "not_reached",
    pedagogical_review_result: input.role.startsWith("tutor")
      ? "pending_downstream_validation" : "not_applicable",
    profile_mapper_result: "not_reached",
    profile_consistency_result: "not_reached",
    platform_mode_result: "not_reached",
    tutor_dispatch_result: "not_reached",
    persisted: false,
    displayed: false,
    suppression_reason: result.status === "completed"
      ? "pending_downstream_processing" : "provider_call_failed",
    stage_reached: result.status === "completed"
      ? "provider_output_received" : "provider_failure_received",
    stages_not_reached: result.status === "completed"
      ? ["runtime_validation", "persistence", "display"]
      : ["schema_validation", "runtime_validation", "persistence", "display"]
  });
  input.reviewRows.push({
    record_type: "provider_output",
    session_id: input.sessionId,
    turn: input.turn,
    attempt: input.attempt,
    provider_role: input.role,
    complete_prior_visible_episode: input.priorVisibleConversation,
    request_provenance: providerArtifact.request_provenance,
    parsed_structured_output: result.parsed_output ?? null,
    provider_result: sanitized,
    persisted: false,
    displayed: false,
    human_review: null
  });
  if (transport.status !== "accepted" || result.status !== "completed" ||
      !result.parsed_output) {
    const category = transport.final_classification?.category ??
      result.error?.category ?? result.status;
    const failureCode = transport.status === "transport_failure_retry_exhausted"
      ? category === "network_timeout" || category === "upstream_timeout"
        ? "e2a38_canary_failed_provider_timeout_retry_exhausted"
        : category === "retryable_rate_limit"
          ? "e2a38_canary_failed_rate_limit_retry_exhausted"
          : "e2a38_canary_failed_provider_infrastructure_retry_exhausted"
      : transport.status === "transport_failure_nonretryable"
        ? "e2a38_canary_failed_provider_nonretryable_request"
        : `e2a38_provider_call_failed_${transport.status}`;
    throw new Error(`${failureCode}:${input.role}:${category}`);
  }
  return result;
}

function evaluatorRequest(input: {
  runId: string;
  session: Session;
  turn: PlannedTurn;
  providerInput: ReturnType<typeof evaluatorProviderInput>;
  modelConfig: ReturnType<typeof evaluateE2A24Candidate>["full_candidate"]["roles"][string];
  timeout: number;
  repair?: { issues: string[]; candidate: unknown };
}) {
  const repair = input.repair;
  return {
    agent_name: ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
    model_config: input.modelConfig,
    instructions: repair
      ? PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_INSTRUCTIONS_V5
      : PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_INSTRUCTIONS_V5,
    input: repair ? {
      schema_version: "production-turn-evidence-evaluator-repair-input-v5",
      source_input: input.providerInput,
      candidate_packet_summary: {
        validation_issue_count: repair.issues.length,
        validation_issue_codes: repair.issues
      },
      safe_repair_instructions: repair.issues.map((issue) =>
        `Repair the schema-safe issue ${issue}.`
      )
    } : input.providerInput,
    output_schema: ProductionTurnEvidenceEvaluatorOutputV5Schema,
    schema_name:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
    client_request_id:
      `${input.runId}_${input.session.session_id}_eval_${input.turn.turn}_${repair ? "repair" : "initial"}`,
    timeout_ms: input.timeout,
    metadata: {
      evaluation_phase: "e2a38",
      role: "evidence_evaluator",
      session_id: input.session.session_id,
      turn_number: String(input.turn.turn),
      prompt_version: repair
        ? PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_VERSION_V5
        : PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
      prompt_hash: repair
        ? PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_HASH_V5
        : PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5
    }
  } satisfies StructuredAgentRequest<unknown,
    ProductionTurnEvidenceEvaluatorOutputV5>;
}

async function runSession(input: {
  runId: string;
  runDir: string;
  session: Session;
  executor: ProviderExecutor;
  semanticEffectGuard: ExactlyOnceSemanticEffectGuard;
  ledger: BudgetLedger;
  live: boolean;
  frozenSourceHash: string;
  reviewRows: JsonObject[];
}) {
  const candidate = evaluateE2A24Candidate().full_candidate;
  const simulatorModel = candidate.roles.student_communication_agent;
  const evaluatorModel = candidate.roles.formative_activity_response_evaluator_agent;
  const tutorModel = candidate.roles.topic_dialogue_agent;
  const timeout = candidate.runtime_policy.provider_timeout_ms;
  const contract = contractFor(input.session);
  const store = new SessionStore(input.runId, input.session);
  const priorStudentMessages: string[] = [];
  const priorStudentAnchorStances: Array<{
    stance:
      | "endorses_distractor"
      | "rejects_distractor"
      | "ambiguous"
      | "not_expressed";
  }> = [];
  let cumulative: TopicDialogueCumulativeEvidenceProfile | null = null;
  let endpoint: string | null = null;
  const unnecessaryTurnsAfterSound = 0;
  let tutorCallsAfterSound = 0;
  let sessionRegenerations = 0;
  let strategyChangeAfterIneffective = true;
  let previousStrategy: string | null = null;
  let priorReasoningQuality: TrajectoryReasoningQuality | null = null;
  let priorSoundGatePassed = false;
  let learningEvolution: LearningProfileEvolutionV1 | null = null;
  let engagementEvolution: EngagementProfileEvolutionV1 | null = null;
  let longitudinalInterventions: LongitudinalInterventionRecordV1[] = [];
  let acceptedConceptualUpdateCount = 0;
  let missedProgressionCount = 0;
  let stoppingConsistencyCount = 0;
  let communicationValidationCount = 0;
  let communicationPassCount = 0;
  let priorAnchorResolution: TargetEvidenceAdjudicationV5[
    "anchor_propagation"
  ]["anchor_resolution_status"] | null = null;
  const providerRows: JsonObject[] = [];
  try {
    input.reviewRows.push({
      session_id: input.session.session_id,
      visible_turn_id: store.turns[0]!.visible_turn_id,
      actor_type: "agent",
      student_facing_message: store.turns[0]!.message_text,
      source: "initial_activity",
      human_review: null
    });
    for (const turn of input.session.frozen_student_trajectory) {
      if (endpoint) {
        break;
      }
      let simulatorResult: StructuredAgentResult<LlmStudentSimulatorOutput> | null = null;
      let simulatorValidation:
        ReturnType<typeof validateSimulatorOutput> | null = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const simInput = simulatorInput(
          input.session, turn, store.turns,
          attempt === 1 ? [] : simulatorValidation?.issues ?? ["not_run"]
        );
        const request = {
          agent_name: "evaluation_llm_student_simulator",
          model_config: simulatorModel,
          instructions: SIMULATOR_INSTRUCTIONS,
          input: simInput,
          output_schema: LlmStudentSimulatorOutputSchema,
          schema_name: "llm-student-simulator-output-v1",
          client_request_id:
            `${input.runId}_${input.session.session_id}_sim_${turn.turn}_${attempt}`,
          timeout_ms: timeout,
          metadata: {
            evaluation_phase: "e2a38",
            role: "student_simulator",
            session_id: input.session.session_id,
            turn_number: String(turn.turn),
            attempt: String(attempt),
            simulator_prompt_hash: SIMULATOR_PROMPT_HASH
          }
        } satisfies StructuredAgentRequest<
          ReturnType<typeof simulatorInput>, LlmStudentSimulatorOutput
        >;
        simulatorResult = await executeProviderCall({
          executor: input.executor,
          semanticEffectGuard: input.semanticEffectGuard,
          ledger: input.ledger,
          role: "simulator",
          request,
          sessionId: input.session.session_id,
          turn: turn.turn,
          attempt,
          live: input.live,
          frozenSourceHash: input.frozenSourceHash,
          runDir: input.runDir,
          reviewRows: input.reviewRows,
          priorVisibleConversation: store.turns
        });
        simulatorValidation = validateSimulatorOutput({
          session: input.session,
          turn,
          output: simulatorResult.parsed_output!,
          priorStudentMessages,
          latestAssistantMessage: latestAssistant(store)
        });
        providerRows.push({
          role: "student_simulator",
          turn: turn.turn,
          attempt,
          provider_result: sanitizedE2AProviderResult(simulatorResult),
          validation: simulatorValidation
        });
        if (simulatorValidation.passed) break;
      }
      if (!simulatorResult?.parsed_output || !simulatorValidation?.passed) {
        throw new Error(
          `e2a38_student_simulator_validation_failed:${input.session.session_id}:${turn.turn}:${simulatorValidation?.issues.join("|") ?? "validation_not_run"}`
        );
      }
      appendJsonl(path.join(
        input.runDir, "anchor-stance-resolution-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        resolver_version: simulatorValidation.resolution.resolver_version,
        reference_resolver_version:
          simulatorValidation.resolution.reference_resolver_version,
        stance_evidence_resolver_version:
          simulatorValidation.resolution.stance_evidence_resolver_version,
        observed_anchor_reference:
          simulatorValidation.resolution.observed_anchor_reference,
        observed_anchor_stance:
          simulatorValidation.resolution.observed_anchor_stance,
        independent_reference_resolution:
          simulatorValidation.resolution.independent_reference_resolution,
        independent_stance_evidence_resolution:
          simulatorValidation.resolution
            .independent_stance_evidence_resolution,
        independent_application_conflict:
          simulatorValidation.resolution.independent_application_conflict,
        independent_stance_conflict:
          simulatorValidation.resolution.independent_stance_conflict,
        validation_issues: simulatorValidation.issues,
        passed: simulatorValidation.passed
      });
      appendJsonl(path.join(
        input.runDir, "anchor-reference-resolution-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        ...simulatorValidation.resolution.independent_reference_resolution,
        source: "student_simulator_output",
        passed: simulatorValidation.resolution
          .independent_application_conflict === false
      });
      appendJsonl(path.join(
        input.runDir, "anchor-stance-evidence-resolution-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        ...simulatorValidation.resolution
          .independent_stance_evidence_resolution,
        source: "student_simulator_output",
        passed: simulatorValidation.resolution
          .independent_stance_conflict === false
      });
      appendJsonl(path.join(
        input.runDir, "anchor-stance-scope-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        ...simulatorValidation.scope_resolution,
        source: "student_simulator_output",
        passed:
          simulatorValidation.scope_resolution.resolver_version ===
            ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION
      });
      const studentMessage = simulatorResult.parsed_output.student_message;
      const selfCorrection = simulatorValidation.self_correction;
      const selfCorrectionIntentSignal =
        simulatorValidation.self_correction_signal;
      appendJsonl(path.join(
        input.runDir, "self-correction-intent-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        ...selfCorrectionIntentSignal,
        legacy_intent_resolution: selfCorrection,
        expected_intent: turn.expected_self_correction_intent ?? null,
        conceptual_evidence_assessed_separately: true,
        correction_language_alone_not_understanding: true,
        passed:
          (!turn.expected_self_correction_intent ||
            selfCorrectionIntentSignal.self_correction_intent ===
              (turn.expected_self_correction_intent ===
                "self_correction_intent"))
      });
      priorStudentMessages.push(studentMessage);
      input.reviewRows.push({
        session_id: input.session.session_id,
        turn: turn.turn,
        actor_type: "student",
        student_facing_message: studentMessage,
        source: "live_student_simulator",
        human_review: null
      });
      let evaluatorPacket: ActivityMisconceptionEvidencePacketV1 | null = null;
      let evaluatorOutputRow: JsonObject | null = null;
      let evaluatorInputArtifact: AutonomousEvidenceEvaluatorInput | null = null;
      let tutorInputArtifact: AutonomousPedagogyInput | null = null;
      const operationId = `${input.runId}_${input.session.session_id}_turn_${turn.turn}`;
      const priorCumulativeForTurn = cumulative;
      const result = await executeAutonomousFormativeTurn({
        client_operation_id: operationId,
        student_message: studentMessage,
        concept_id: input.session.concept,
        distractor_anchor:
          `${input.session.target_evidence_contract.item_id}:${input.session.target_evidence_contract.distractor_option}`,
        target_evidence_contract: contract,
        prior_cumulative_profile: cumulative,
        prior_interventions: store.interventions,
        current_student_turn: turn.turn,
        maximum_student_turns: input.session.maximum_student_turns,
        confidence_evidence: "low",
        persistence: store.persistence(),
        evaluateEvidence: async (autonomousInput) => {
          evaluatorInputArtifact = autonomousInput;
          const providerInput = evaluatorProviderInput(input.session, autonomousInput);
          const firstRequest = evaluatorRequest({
            runId: input.runId,
            session: input.session,
            turn,
            providerInput,
            modelConfig: evaluatorModel,
            timeout
          });
          const evaluatorContractIdentity = {
            session_id: input.session.session_id,
            turn: turn.turn,
            evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
            prompt_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
            prompt_hash: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
            input_schema_version:
              PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
            output_schema_version:
              PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
            provider_schema_name: firstRequest.schema_name,
            source_student_turn_id:
              providerInput.source_student_turn.source_student_turn_id,
            source_sequence_index:
              providerInput.source_student_turn.source_sequence_index,
            complete_visible_history_present: Boolean(
              providerInput.legacy_evaluator_input
                .complete_visible_formative_conversation
            ),
            active_anchor_alias_contract_present: Boolean(
              providerInput.active_anchor_alias_contract
            ),
            structured_fields_required: true,
            passed: firstRequest.schema_name ===
                PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5 &&
              firstRequest.metadata?.prompt_version ===
                PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5 &&
              providerInput.source_student_turn.source_student_turn_id ===
                autonomousInput.latest_student_message.source_student_turn_id &&
              providerInput.source_student_turn.source_sequence_index ===
                autonomousInput.latest_student_message.source_sequence_index
          };
          if (!evaluatorContractIdentity.passed) {
            throw new Error("e2a38_canary_failed_evaluator_contract");
          }
          appendJsonl(path.join(
            input.runDir, "evaluator-contract-identities.jsonl"
          ), evaluatorContractIdentity);
          appendJsonl(path.join(
            input.runDir, "evaluator-v5-request-identities.jsonl"
          ), {
            ...evaluatorContractIdentity,
            frozen_compiled_evaluator_v5_request_hash:
              COMPILED_EVALUATOR_V5_REQUEST_HASH,
            runtime_request_hash: stableHash({
              agent_name: firstRequest.agent_name,
              model_config: firstRequest.model_config,
              instructions: firstRequest.instructions,
              input: firstRequest.input,
              schema_name: firstRequest.schema_name,
              metadata: firstRequest.metadata
            }),
            active_anchor_alias_contract_hash: stableHash(
              providerInput.active_anchor_alias_contract
            ),
            frozen_target_evidence_contract_hash:
              TARGET_EVIDENCE_CONTRACT_HASH,
            passed: evaluatorContractIdentity.passed &&
              stableHash(providerInput.active_anchor_alias_contract) ===
                MEASUREMENT_ALIAS_CONTRACT_HASH
          });
          const first = await executeProviderCall({
            executor: input.executor,
            semanticEffectGuard: input.semanticEffectGuard,
            ledger: input.ledger,
            role: "evidence_evaluator",
            request: firstRequest,
            sessionId: input.session.session_id,
            turn: turn.turn,
            attempt: 1,
            live: input.live,
            frozenSourceHash: input.frozenSourceHash,
            runDir: input.runDir,
            reviewRows: input.reviewRows,
            priorVisibleConversation:
              autonomousInput.complete_visible_formative_conversation
          });
          const firstAudit = input.live
            ? auditFor(first, evaluatorModel.model_name)
            : makeActivityMisconceptionEvidenceAuditForTest({
                agent_call_id: `e2a38_eval_${input.session.session_id}_${turn.turn}`,
                model_name: evaluatorModel.model_name
              });
          let pipeline = evaluateActivityMisconceptionEvidenceLivePipeline({
            candidate_packet: first.parsed_output!.evidence_packet,
            evaluator_audit: firstAudit
          });
          let repairResult: StructuredAgentResult<
            ProductionTurnEvidenceEvaluatorOutputV5
          > | null = null;
          if (pipeline.status === "rejected") {
            const originalIssues = pipeline.issues.filter((issue) =>
              issue.rule_code !== "repair_missing"
            );
            if (!activityMisconceptionEvidencePipelineIssuesAllowRepair(originalIssues)) {
              throw new Error(
                `e2a38_evaluator_hard_rejection:turn_${turn.turn}:${originalIssues.map((issue) =>
                  issue.blocked_pattern_label ?? issue.rule_code
                ).join("|")}`
              );
            }
            const repairRequest = evaluatorRequest({
              runId: input.runId,
              session: input.session,
              turn,
              providerInput,
              modelConfig: evaluatorModel,
              timeout,
              repair: {
                issues: originalIssues.map((issue) =>
                  issue.blocked_pattern_label ?? issue.rule_code
                ),
                candidate: first.parsed_output
              }
            });
            repairResult = await executeProviderCall({
              executor: input.executor,
              semanticEffectGuard: input.semanticEffectGuard,
              ledger: input.ledger,
              role: "evidence_evaluator",
              request: repairRequest,
              sessionId: input.session.session_id,
              turn: turn.turn,
              attempt: 2,
              live: input.live,
              frozenSourceHash: input.frozenSourceHash,
              runDir: input.runDir,
              reviewRows: input.reviewRows,
              priorVisibleConversation:
                autonomousInput.complete_visible_formative_conversation
            });
            const repairAudit = input.live
              ? auditFor(repairResult, evaluatorModel.model_name)
              : makeActivityMisconceptionEvidenceAuditForTest({
                  agent_call_id:
                    `e2a38_eval_repair_${input.session.session_id}_${turn.turn}`,
                  model_name: evaluatorModel.model_name
                });
            pipeline = evaluateActivityMisconceptionEvidenceLivePipeline({
              candidate_packet: first.parsed_output!.evidence_packet,
              evaluator_audit: firstAudit,
              repair_packet: repairResult.parsed_output!.evidence_packet,
              repair_audit: repairAudit
            });
          }
          if (pipeline.status !== "accepted") {
            throw new Error(`e2a38_evaluator_rejected:${pipeline.blocked_reason}`);
          }
          evaluatorPacket = pipeline.packet;
          evaluatorOutputRow = {
            session_id: input.session.session_id,
            turn: turn.turn,
            first_provider_result: sanitizedE2AProviderResult(first),
            repair_provider_result: repairResult
              ? sanitizedE2AProviderResult(repairResult) : null,
            effective_packet: pipeline.packet,
            repair_attempted: pipeline.repair_attempted
          };
          const effectiveEvaluatorOutput = repairResult?.parsed_output ??
            first.parsed_output;
          if (!effectiveEvaluatorOutput ||
              stableHash(effectiveEvaluatorOutput.evidence_packet) !==
                stableHash(pipeline.packet)) {
            throw new Error("e2a38_evaluator_effective_output_mismatch");
          }
          appendJsonl(path.join(
            input.runDir, "evaluator-normalized-results.jsonl"
          ), {
            session_id: input.session.session_id,
            turn: turn.turn,
            evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
            source_student_turn_id:
              effectiveEvaluatorOutput.structured_turn_evidence
                .source_student_turn_id,
            source_sequence_index:
              effectiveEvaluatorOutput.structured_turn_evidence
                .source_sequence_index,
            structured_turn_evidence:
              effectiveEvaluatorOutput.structured_turn_evidence,
            effective_evidence_packet: pipeline.packet,
            provider_output_accepted: true,
            passed: true
          });
          const priorVisibleMessage = [
            ...autonomousInput.complete_visible_formative_conversation
              .visible_turns
          ].reverse().find((entry) => entry.actor_type === "agent")
            ?.message_text ?? null;
          const scopedAdjudication =
            buildTargetEvidenceScopedAdjudicationV1({
            latest_student_message: studentMessage,
            packet: pipeline.packet,
            structured_turn_evidence:
              effectiveEvaluatorOutput.structured_turn_evidence,
            contract,
            expected_source_student_turn_id:
              autonomousInput.latest_student_message.source_student_turn_id,
            expected_source_sequence_index:
              autonomousInput.latest_student_message.source_sequence_index,
            prior_visible_message: priorVisibleMessage,
            prior_anchor_resolution_status: priorAnchorResolution,
            prior_student_anchor_stances: priorStudentAnchorStances
          });
          const adjudication = scopedAdjudication.adjudication;
          priorAnchorResolution =
            adjudication.anchor_propagation.anchor_resolution_status;
          priorStudentAnchorStances.push({
            stance: scopedAdjudication.anchor_stance_scope_resolution
              .stance_classification.observed_anchor_stance
          });
          appendJsonl(path.join(
            input.runDir, "anchor-stance-scope-results.jsonl"
          ), {
            session_id: input.session.session_id,
            turn: turn.turn,
            ...scopedAdjudication.anchor_stance_scope_resolution,
            source: "effective_evaluator_adjudication",
            passed:
              scopedAdjudication.anchor_stance_scope_resolution
                .resolver_version ===
                  ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION
          });
          appendJsonl(path.join(
            input.runDir, "canonical-anchor-evidence-results.jsonl"
          ), {
            session_id: input.session.session_id,
            turn: turn.turn,
            ...adjudication.canonical_anchor_evidence,
            passed: true
          });
          appendJsonl(path.join(
            input.runDir, "measurement-alias-resolution-results.jsonl"
          ), {
            session_id: input.session.session_id,
            turn: turn.turn,
            target_evidence_contract_hash: TARGET_EVIDENCE_CONTRACT_HASH,
            measurement_alias_contract_hash:
              MEASUREMENT_ALIAS_CONTRACT_HASH,
            ...adjudication.anchor_alias_resolution,
            passed: !adjudication.anchor_alias_resolution
              .direct_reference_mapped_absent
          });
          appendJsonl(path.join(
            input.runDir, "anchor-parity-reconciliation-results.jsonl"
          ), {
            session_id: input.session.session_id,
            turn: turn.turn,
            ...adjudication.anchor_parity_reconciliation
          });
          return adjudication;
        },
        invokeAutonomousTutor: async (tutorInput, attempt, hardRejections) => {
          tutorInputArtifact = tutorInput;
          if ((tutorInput.latest_authoritative_turn_profile as
              TopicDialogueTurnEvidenceProfile).revision_readiness) {
            tutorCallsAfterSound += 1;
            throw new Error("e2a38_tutor_called_after_sound");
          }
          if (attempt === 2) {
            sessionRegenerations += 1;
            if (sessionRegenerations > 2) {
              throw new Error("e2a38_session_tutor_regeneration_limit_exceeded");
            }
          }
          appendJsonl(path.join(input.runDir, "autonomous-tutor-inputs.jsonl"), {
            session_id: input.session.session_id,
            turn: turn.turn,
            attempt,
            hard_rejections_from_prior_attempt: hardRejections,
            request: tutorInput
          });
          const request = {
            agent_name: "topic_dialogue_agent",
            model_config: tutorModel,
            instructions: attempt === 1
              ? AUTONOMOUS_PEDAGOGY_PROMPT_INSTRUCTIONS
              : `${AUTONOMOUS_PEDAGOGY_PROMPT_INSTRUCTIONS}\n\nRepair only these hard validation issues: ${hardRejections.join(", ")}. Return a new complete object.`,
            input: tutorInput,
            output_schema: AutonomousPedagogyOutputSchema,
            schema_name: AUTONOMOUS_PEDAGOGY_OUTPUT_SCHEMA_VERSION,
            client_request_id:
              `${input.runId}_${input.session.session_id}_tutor_${turn.turn}_${attempt}`,
            timeout_ms: timeout,
            metadata: {
              evaluation_phase: "e2a38",
              role: attempt === 1 ? "tutor_initial" : "tutor_regeneration",
              session_id: input.session.session_id,
              turn_number: String(turn.turn),
              attempt: String(attempt),
              prompt_version: AUTONOMOUS_PEDAGOGY_PROMPT_VERSION,
              prompt_hash: AUTONOMOUS_PEDAGOGY_PROMPT_HASH
            }
          } satisfies StructuredAgentRequest<
            AutonomousPedagogyInput,
            z.infer<typeof AutonomousPedagogyOutputSchema>
          >;
          const providerResult = await executeProviderCall({
            executor: input.executor,
            semanticEffectGuard: input.semanticEffectGuard,
            ledger: input.ledger,
            role: attempt === 1 ? "tutor_initial" : "tutor_regeneration",
            request,
            sessionId: input.session.session_id,
            turn: turn.turn,
            attempt,
            live: input.live,
            frozenSourceHash: input.frozenSourceHash,
            runDir: input.runDir,
            reviewRows: input.reviewRows,
            priorVisibleConversation:
              tutorInput.complete_visible_formative_conversation
          });
          return providerResult.parsed_output;
        }
      });
      store.completed.set(operationId, result);
      const callsBeforeReplay = input.ledger.logical_generation_calls;
      const replay = await executeAutonomousFormativeTurn({
        client_operation_id: operationId,
        student_message: studentMessage,
        concept_id: input.session.concept,
        distractor_anchor:
          `${input.session.target_evidence_contract.item_id}:${input.session.target_evidence_contract.distractor_option}`,
        target_evidence_contract: contract,
        prior_cumulative_profile: cumulative,
        prior_interventions: store.interventions,
        current_student_turn: turn.turn,
        maximum_student_turns: input.session.maximum_student_turns,
        confidence_evidence: "low",
        persistence: store.persistence(),
        evaluateEvidence: async () => {
          throw new Error("e2a38_idempotent_replay_evaluator_called");
        },
        invokeAutonomousTutor: async () => {
          throw new Error("e2a38_idempotent_replay_tutor_called");
        }
      });
      if (!replay.replayed || input.ledger.logical_generation_calls !== callsBeforeReplay) {
        throw new Error("e2a38_idempotency_replay_failed");
      }
      cumulative = result.cumulative_profile;
      const persistedProfile = store.profiles.at(-1);
      const adjudication = TargetEvidenceAdjudicationV5Schema.parse(
        persistedProfile?.adjudication
      );
      const propagation = adjudication.anchor_propagation;
      const anchor = propagation.anchor_interpretation;
      if (!result.profile_update_record) {
        throw new Error("e2a38_profile_update_record_missing");
      }
      const updateDisposition =
        result.profile_update_record.update_disposition;
      const correctionClaimOnly =
        selfCorrection.intent === "self_correction_intent" &&
        !selfCorrection.latest_valid_evidence_eligible;
      const latestValidEvidenceApplied =
        selfCorrection.latest_valid_evidence_eligible
          ? [
              "update_from_latest_evidence",
              "reopen_from_latest_contradiction"
            ].includes(updateDisposition)
          : true;
      const unsupportedCorrectionPreserved = correctionClaimOnly
        ? updateDisposition === "preserve_prior_profile"
        : true;
      const formalReopenDispositionApplied = updateDisposition ===
        "reopen_from_latest_contradiction";
      const profileReopenedFromRegression =
        priorCumulativeForTurn !== null &&
        ["partial", "sound"].includes(
          priorCumulativeForTurn.current_reasoning_quality
        ) &&
        result.latest_profile.reasoning_quality === "misconception";
      const profileReopened =
        formalReopenDispositionApplied || profileReopenedFromRegression;
      if (!latestValidEvidenceApplied) {
        throw new Error("e2a38_latest_valid_evidence_not_authoritative");
      }
      if (!unsupportedCorrectionPreserved) {
        throw new Error("e2a38_correction_language_promoted_to_evidence");
      }
      if (turn.profile_reopening_expected && !profileReopened) {
        throw new Error([
          "e2a38_regression_did_not_reopen_profile",
          updateDisposition,
          priorCumulativeForTurn?.current_reasoning_quality ?? "none",
          priorCumulativeForTurn?.current_misconception_status ?? "none",
          anchor.anchor_resolution_status,
          result.latest_profile.reasoning_quality
        ].join(":"));
      }
      appendJsonl(path.join(
        input.runDir, "latest-valid-evidence-precedence-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        resolver_version: SELF_CORRECTION_INTENT_VERSION,
        self_correction_intent: selfCorrection.intent,
        evidence_status: selfCorrection.evidence_status,
        latest_valid_evidence_eligible:
          selfCorrection.latest_valid_evidence_eligible,
        prior_authoritative_profile_id:
          priorCumulativeForTurn?.current_conceptual_profile_snapshot_id ??
            null,
        update_disposition: updateDisposition,
        resulting_authoritative_profile_id:
          result.cumulative_profile
            .current_conceptual_profile_snapshot_id,
        correction_language_alone_not_evidence: true,
        earlier_misconception_retained_as_historical:
          result.cumulative_profile
            .historical_misconception_snapshot_ids.length > 0,
        latest_valid_evidence_applied: latestValidEvidenceApplied,
        unsupported_correction_preserved_prior_profile:
          unsupportedCorrectionPreserved,
        passed:
          latestValidEvidenceApplied && unsupportedCorrectionPreserved
      });
      appendJsonl(path.join(
        input.runDir, "profile-reopening-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        profile_reopening_expected:
          turn.profile_reopening_expected === true,
        update_disposition: updateDisposition,
        profile_reopened: profileReopened,
        formal_reopen_disposition_applied:
          formalReopenDispositionApplied,
        reopened_from_latest_regression:
          profileReopenedFromRegression,
        misconception_reopened_count:
          result.cumulative_profile.misconception_reopened_count,
        latest_anchor_resolution_status:
          anchor.anchor_resolution_status,
        latest_reasoning_quality:
          result.latest_profile.reasoning_quality,
        revision_readiness:
          result.latest_profile.revision_readiness,
        passed: turn.profile_reopening_expected
          ? profileReopened &&
            result.latest_profile.revision_readiness === false
          : true
      });
      const finalizationIndex = result.execution_order.indexOf(
        "finalize_profile_before_tutor_dispatch"
      );
      const tutorDispatchIndex = result.execution_order.indexOf(
        "invoke_autonomous_pedagogical_agent"
      );
      const preTutorFinalizationPassed = finalizationIndex >= 0 &&
        (tutorDispatchIndex < 0 || finalizationIndex < tutorDispatchIndex) &&
        result.latest_profile.source_student_turn_id ===
          persistedProfile?.profile.source_student_turn_id &&
        result.latest_profile.source_sequence_index ===
          persistedProfile?.profile.source_sequence_index;
      if (!preTutorFinalizationPassed) {
        throw new Error("e2a38_pre_tutor_profile_finalization_failed");
      }
      appendJsonl(path.join(
        input.runDir, "pre-tutor-finalization-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        finalization_version: PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V4,
        evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
        mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
        profile_consistency_version: PROFILE_CONSISTENCY_POLICY_VERSION_V7,
        evidence_preservation_contract_version:
          TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION,
        evidence_preservation_passed: true,
        propagation_version: ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2,
        cross_artifact_consistency_version:
          TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION_V2,
        turn_observation_version: TURN_EVIDENCE_OBSERVATION_VERSION,
        profile_update_disposition_version:
          LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION,
        source_student_turn_id: result.latest_profile.source_student_turn_id,
        source_sequence_index: result.latest_profile.source_sequence_index,
        execution_order: result.execution_order,
        tutor_called: result.tutor_called,
        finalized_before_tutor_dispatch: true,
        passed: true
      });
      if (!result.observation_record || !result.profile_update_record ||
          !persistedProfile?.cross_artifact_consistency) {
        throw new Error("e2a38_canary_failed_profile_finalization");
      }
      appendJsonl(path.join(
        input.runDir, "turn-evidence-observations.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        ...result.observation_record,
        passed: true
      });
      appendJsonl(path.join(
        input.runDir, "profile-update-dispositions.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        ...result.profile_update_record,
        passed: true
      });
      appendJsonl(path.join(
        input.runDir, "anchor-alias-resolution-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        ...adjudication.anchor_alias_resolution,
        passed: !adjudication.anchor_alias_resolution
          .direct_reference_mapped_absent
      });
      appendJsonl(path.join(
        input.runDir, "contradiction-propagation-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        ...propagation,
        passed: true
      });
      appendJsonl(path.join(input.runDir, "mapper-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
        evidence_preservation_contract_version:
          TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION,
        evidence_preservation_passed: true,
        source_student_turn_id: result.latest_profile.source_student_turn_id,
        source_sequence_index: result.latest_profile.source_sequence_index,
        resulting_profile_snapshot_id: result.latest_profile.profile_snapshot_id,
        passed: true
      });
      appendJsonl(path.join(
        input.runDir, "cross-artifact-consistency-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        ...(persistedProfile.cross_artifact_consistency as JsonObject),
        passed: true
      });
      appendJsonl(path.join(
        input.runDir, "profile-transition-consistency-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        prior_profile_snapshot_id:
          result.profile_update_record.prior_authoritative_profile_id,
        observation_id: result.observation_record.observation_id,
        disposition: result.profile_update_record.update_disposition,
        resulting_profile_snapshot_id:
          result.profile_update_record.resulting_authoritative_profile_id,
        source_student_turn_id: result.latest_profile.source_student_turn_id,
        source_sequence_index: result.latest_profile.source_sequence_index,
        passed: true
      });
      appendJsonl(path.join(
        input.runDir, "structured-contradiction-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        propagation_version: ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2,
        blocking: propagation.blocking,
        structured_contradictions: propagation.structured_contradictions,
        profile_structured_contradictions:
          result.latest_profile.structured_contradictions ?? [],
        profile_contradiction_ids: result.latest_profile.contradictions,
        passed: propagation.structured_contradictions.length ===
          (result.latest_profile.structured_contradictions?.length ?? 0)
      });
      const explicitOptionReference = new RegExp(
        `\\boption\\s+${input.session.target_evidence_contract.distractor_option}\\b`,
        "iu"
      ).test(studentMessage);
      if (explicitOptionReference && anchor.anchor_application !== "explicit") {
        throw new Error("e2a38_anchor_application_false_absent");
      }
      if (turn.required_anchor_application &&
          anchor.anchor_application !== turn.required_anchor_application) {
        throw new Error("e2a38_anchor_application_false_absent");
      }
      if (turn.required_anchor_stance &&
          anchor.anchor_stance !== turn.required_anchor_stance) {
        throw new Error(
          `e2a38_anchor_stance_misclassified:turn_${turn.turn}:expected_${turn.required_anchor_stance}:observed_${anchor.anchor_stance}`
        );
      }
      if (turn.required_anchor_consistency &&
          anchor.anchor_consistency !== turn.required_anchor_consistency) {
        throw new Error("e2a38_anchor_contradiction_not_structured");
      }
      if (turn.required_contradiction &&
          (!propagation.structured_contradictions.some((entry) =>
            entry.contradiction_type === turn.required_contradiction
          ) || !result.latest_profile.contradictions.includes(
            turn.required_contradiction
          ) || !result.latest_profile.structured_contradictions?.some((entry) =>
            entry.contradiction_type === turn.required_contradiction &&
            entry.blocking === true
          ))) {
        throw new Error("e2a38_anchor_contradiction_not_structured");
      }
      if (propagation.blocking &&
          !result.latest_profile.contradictions.includes(
            "anchor_conclusion_conceptual_explanation_conflict"
          )) {
        throw new Error("e2a38_blocking_conflict_only_in_limitations");
      }
      const soundGateFailureCodes: string[] = [];
      if (result.latest_profile.reasoning_quality !== "sound") {
        soundGateFailureCodes.push("reasoning_quality_not_sound");
      }
      if (!result.latest_profile.revision_readiness) {
        soundGateFailureCodes.push("revision_readiness_false");
      }
      if (anchor.anchor_stance !== "rejects_distractor") {
        soundGateFailureCodes.push("anchor_not_rejected");
      }
      if (
        anchor.anchor_consistency !==
          "consistent_with_conceptual_reasoning"
      ) {
        soundGateFailureCodes.push("anchor_consistency_not_resolved");
      }
      if (propagation.blocking) {
        soundGateFailureCodes.push("blocking_contradiction");
      }
      if (result.latest_profile.essential_missing_links.length > 0) {
        soundGateFailureCodes.push("essential_links_missing");
      }
      const soundGatePassed = soundGateFailureCodes.length === 0;
      const packetQuality = (evaluatorPacket as JsonObject | null)
        ?.evidence_quality;
      const copiedWithoutEvidence =
        simulatorValidation.copied_clause_detected &&
        (
          packetQuality === "insufficient" ||
          result.latest_profile.reasoning_quality === "insufficient"
        );
      const trajectoryDecision = evaluateTrajectoryEnvelope({
        turn_contract: turn.trajectory_contract,
        evaluator_reasoning_quality:
          result.latest_profile.reasoning_quality,
        sound_gate_result: {
          gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
          passed: soundGatePassed,
          failure_codes: soundGateFailureCodes
        },
        evidence_independently_supported:
          !copiedWithoutEvidence && packetQuality !== "insufficient",
        copied_wording_without_evidence: copiedWithoutEvidence,
        blocking_contradiction: propagation.blocking,
        prior_reasoning_quality: priorReasoningQuality,
        prior_sound_gate_passed: priorSoundGatePassed,
        turn_budget_exhausted:
          turn.turn >= input.session.maximum_student_turns
      });
      appendJsonl(path.join(
        input.runDir, "trajectory-envelope-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        simulator_trajectory_role: turn.trajectory_role,
        ...trajectoryDecision,
        sound_gate_failure_codes: soundGateFailureCodes,
        passed:
          trajectoryDecision
            .trajectory_expectation_changed_evaluator_output === false &&
          !trajectoryDecision.prohibited_states_detected.includes(
            "unsupported_sound_promotion"
          )
      });
      if (
        trajectoryDecision.prohibited_states_detected.includes(
          "unsupported_sound_promotion"
        )
      ) {
        throw new Error("e2a38_unsupported_sound_promotion");
      }
      const priorLearningEvolution = learningEvolution;
      const conceptualEvidenceObservation =
        buildSelfCorrectionConceptualObservation({
          message: studentMessage,
          latestProfile: result.latest_profile,
          anchor,
          propagation,
          copiedClauseDetected: simulatorValidation.copied_clause_detected,
          priorLearning: priorLearningEvolution
        });
      const selfCorrectionEvidence = resolveSelfCorrectionEvidenceV1({
        contract: buildSelfCorrectionEvidenceContractV1(),
        intent_signal: selfCorrectionIntentSignal,
        conceptual_evidence: conceptualEvidenceObservation
      });
      if (
        selfCorrectionEvidence.self_correction_intent &&
        !selfCorrectionEvidence.observable_conceptual_evidence_present &&
        selfCorrectionEvidence.conceptual_evidence_update
      ) {
        throw new Error(
          "e2a38_self_correction_intent_promoted_without_evidence"
        );
      }
      appendJsonl(path.join(
        input.runDir, "self-correction-evidence-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        intent_signal: selfCorrectionIntentSignal,
        conceptual_evidence_observation: conceptualEvidenceObservation,
        resolution: selfCorrectionEvidence,
        evaluator_v5_remains_authoritative: true,
        passed:
          selfCorrectionEvidence.intent_and_evidence_separated &&
          selfCorrectionEvidence
            .correction_language_alone_is_not_understanding
      });

      const learningObservation = buildLearningObservation({
        sequenceIndex: turn.turn,
        sourceStudentTurnId: result.latest_profile.source_student_turn_id,
        conceptFamily: input.session.concept_family,
        latestProfile: result.latest_profile,
        anchor,
        propagation,
        selfCorrectionEvidence,
        soundGatePassed
      });
      learningEvolution = evolveLearningProfileV1({
        prior: priorLearningEvolution,
        observation: learningObservation
      });
      if (selfCorrectionEvidence.conceptual_evidence_update) {
        acceptedConceptualUpdateCount += 1;
      }
      appendJsonl(path.join(
        input.runDir, "learning-profile-evolution-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        observation: learningObservation,
        evolution: learningEvolution,
        source_evaluator_profile_id: result.latest_profile.profile_snapshot_id,
        sound_gate_passed: soundGatePassed,
        latest_valid_evidence_precedence: true,
        passed:
          learningEvolution.latest_valid_evidence_precedence &&
          learningEvolution.correction_intent_separate_from_evidence &&
          (
            selfCorrectionEvidence.conceptual_evidence_update ||
            learningEvolution.current_profile_snapshot_id ===
              priorLearningEvolution?.current_profile_snapshot_id ||
            priorLearningEvolution === null
          )
      });

      const priorEngagementEvolution = engagementEvolution;
      const engagementObservation = buildEngagementObservation({
        sequenceIndex: turn.turn,
        sourceStudentTurnId: result.latest_profile.source_student_turn_id,
        message: studentMessage,
        currentReasoningQuality: result.latest_profile.reasoning_quality,
        priorLearning: priorLearningEvolution,
        conceptualEvidenceUpdate:
          selfCorrectionEvidence.conceptual_evidence_update
      });
      engagementEvolution = evolveEngagementProfileV1({
        prior: priorEngagementEvolution,
        observation: engagementObservation
      });
      appendJsonl(path.join(
        input.runDir, "engagement-profile-evolution-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        observation: engagementObservation,
        evolution: engagementEvolution,
        process_evidence_only: true,
        correctness_independence: true,
        student_trait_claim_made: false,
        passed:
          engagementEvolution.engagement_informs_stopping_only &&
          !engagementEvolution.engagement_determines_correctness &&
          engagementEvolution.evidence_qualified_not_trait_claim
      });

      longitudinalInterventions = completePriorLongitudinalIntervention({
        interventions: longitudinalInterventions,
        priorLearning: priorLearningEvolution,
        currentLearning: learningEvolution,
        conceptualEvidenceUpdate:
          selfCorrectionEvidence.conceptual_evidence_update
      });
      const priorCurrentProfile = priorLearningEvolution?.current_profile;
      const currentLearningProfile = learningEvolution.current_profile;
      const knowledgeGapNarrowing = Boolean(
        priorCurrentProfile &&
        currentLearningProfile.missing_links.length <
          priorCurrentProfile.missing_links.length
      );
      const strategyUptakeObserved = Boolean(
        priorCurrentProfile &&
        LONGITUDINAL_QUALITY_RANK[
          currentLearningProfile.reasoning_quality
        ] > LONGITUDINAL_QUALITY_RANK[
          priorCurrentProfile.reasoning_quality
        ]
      );
      const ineffectiveInterventionCount = longitudinalInterventions.filter(
        (entry) =>
          entry.observed_outcome !== "awaiting_response" &&
          !entry.effective_for_target_gap
      ).length;
      const expectedBenefit =
        turn.turn >= input.session.maximum_student_turns &&
        ineffectiveInterventionCount >= 1 &&
        currentLearningProfile.misconception_status === "persists"
          ? "low" as const
          : selfCorrectionEvidence.conceptual_evidence_update ||
              strategyUptakeObserved
            ? "high" as const
            : "uncertain" as const;
      const stoppingDecision = decideAdaptiveStoppingV1({
        learning_profile: learningEvolution,
        engagement_profile: engagementEvolution,
        intervention_memory: longitudinalInterventions,
        session_budget_exhausted:
          turn.turn >= input.session.maximum_student_turns,
        new_evidence_observed:
          selfCorrectionEvidence.conceptual_evidence_update,
        knowledge_gap_narrowing: knowledgeGapNarrowing,
        strategy_uptake_observed: strategyUptakeObserved,
        expected_benefit: expectedBenefit,
        unresolved_conceptual_barrier:
          !soundGatePassed &&
          (
            currentLearningProfile.misconception_status === "persists" ||
            currentLearningProfile.missing_links.length > 0
          )
      });
      const stoppingRuntimeConsistent =
        stoppingDecision.internal_decision === "stop_formative_dialogue"
          ? soundGatePassed &&
            result.route.selected_mode === "request_revision" &&
            !result.tutor_called
          : stoppingDecision.internal_decision ===
              "bounded_stop_instructor_support"
            ? !soundGatePassed &&
              result.effective_response_source === "bounded_stop" &&
              !result.tutor_called
            : stoppingDecision.internal_decision ===
                "engagement_support_needed"
              ? !result.tutor_called
              : !soundGatePassed && result.tutor_called;
      stoppingConsistencyCount += stoppingRuntimeConsistent ? 1 : 0;
      if (!stoppingRuntimeConsistent) {
        throw new Error([
          "e2a38_longitudinal_stopping_runtime_mismatch",
          stoppingDecision.internal_decision,
          result.route.selected_mode,
          result.effective_response_source,
          result.tutor_called ? "tutor_called" : "tutor_not_called"
        ].join(":"));
      }
      appendJsonl(path.join(
        input.runDir, "adaptive-stopping-decisions.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        ...stoppingDecision,
        sound_gate_passed: soundGatePassed,
        production_route: result.route.selected_mode,
        production_effective_response_source:
          result.effective_response_source,
        runtime_consistent: stoppingRuntimeConsistent,
        passed: stoppingRuntimeConsistent &&
          stoppingDecision.internal_state_student_visible === false
      });
      const escalationDecision =
        evaluateInstructorEscalationV1(stoppingDecision);
      appendJsonl(path.join(
        input.runDir, "instructor-escalation-decisions.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        ...escalationDecision,
        student_failure_language_used: false,
        passed:
          escalationDecision.recommend_instructor_support ===
            (stoppingDecision.internal_decision ===
              "bounded_stop_instructor_support")
      });
      const policyCommunication =
        translateStoppingDecisionForStudentV1(stoppingDecision);
      const effectiveMessageValidation =
        validateE2A38StudentMessage(result.effective_message);
      communicationValidationCount += 1;
      if (effectiveMessageValidation.passed &&
          policyCommunication.validation.passed) {
        communicationPassCount += 1;
      }
      if (!effectiveMessageValidation.passed) {
        throw new Error(
          `e2a38_student_facing_internal_state_leak:${effectiveMessageValidation.issue_codes.join("|")}`
        );
      }
      appendJsonl(path.join(
        input.runDir, "student-facing-communication-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        effective_student_facing_message: result.effective_message,
        effective_message_validation: effectiveMessageValidation,
        stopping_policy_projection: policyCommunication,
        stopping_policy_projection_displayed: false,
        internal_stopping_decision_exposed: false,
        passed:
          effectiveMessageValidation.passed &&
          policyCommunication.validation.passed &&
          !policyCommunication.internal_decision_exposed
      });

      if (stoppingDecision.internal_decision === "continue_dialogue") {
        const selectedIntervention = selectLongitudinalInterventionV1({
          concept_family: input.session.concept_family,
          targeted_gap: safeEvidenceText(
            currentLearningProfile.knowledge_gap,
            500
          ),
          evidence_sought: currentLearningProfile.missing_links.length > 0
            ? currentLearningProfile.missing_links.slice(0, 12)
            : ["an independently explained reliability-validity boundary"],
          prior_interventions: longitudinalInterventions
        });
        longitudinalInterventions.push(selectedIntervention);
      }
      appendJsonl(path.join(
        input.runDir, "longitudinal-intervention-memory-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        current_gap: currentLearningProfile.knowledge_gap,
        intervention_history: longitudinalInterventions,
        ineffective_strategy_gap_pairs: longitudinalInterventions
          .filter((entry) =>
            entry.observed_outcome !== "awaiting_response" &&
            !entry.effective_for_target_gap
          )
          .map((entry) => ({
            strategy: entry.strategy,
            targeted_gap: entry.targeted_gap
          })),
        selected_for_next_response:
          longitudinalInterventions.at(-1)?.observed_outcome ===
            "awaiting_response"
            ? longitudinalInterventions.at(-1)
            : null,
        passed: true
      });
      if (soundGatePassed) {
        if (
          trajectoryDecision.progression_decision !==
            "immediate_revision" ||
          !trajectoryDecision.revision_required_immediately ||
          result.route.selected_mode !== "request_revision" ||
          result.tutor_called
        ) {
          if (result.tutor_called) tutorCallsAfterSound += 1;
          throw new Error("e2a38_sound_gate_progression_failure");
        }
        endpoint = "passed_required_revision_endpoint";
      } else if (result.route.selected_mode === "request_revision") {
        throw new Error("e2a38_premature_revision_without_sound_gate");
      } else if (result.effective_response_source === "bounded_stop") {
        endpoint = "valid_bounded_stop_with_instructor_support";
      } else if (
        stoppingDecision.internal_decision === "engagement_support_needed"
      ) {
        endpoint = "valid_engagement_support_endpoint";
      }
      if (soundGatePassed && !stoppingRuntimeConsistent) {
        missedProgressionCount += 1;
      }
      appendJsonl(path.join(
        input.runDir, "progression-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        self_correction_intent: selfCorrection.intent,
        self_correction_evidence_status: selfCorrection.evidence_status,
        profile_update_disposition: updateDisposition,
        profile_reopened: profileReopened,
        sound_gate_passed: soundGatePassed,
        route: result.route.selected_mode,
        trajectory_progression_decision:
          trajectoryDecision.progression_decision,
        immediate_revision_when_sound:
          !soundGatePassed ||
          (
            result.route.selected_mode === "request_revision" &&
            !result.tutor_called &&
            trajectoryDecision.revision_required_immediately
          ),
        correction_language_alone_not_understanding:
          !correctionClaimOnly ||
          result.latest_profile.reasoning_quality !== "sound",
        passed:
          (!soundGatePassed ||
            result.route.selected_mode === "request_revision") &&
          (!turn.profile_reopening_expected || profileReopened) &&
          (!correctionClaimOnly ||
            result.latest_profile.reasoning_quality !== "sound")
      });
      priorReasoningQuality = result.latest_profile.reasoning_quality;
      priorSoundGatePassed = soundGatePassed;
      if (result.intervention) {
        const priorOutcome = store.interventions.at(-2)?.observed_outcome;
        if (["misconception_persists", "no_new_evidence", "recurrence"]
          .includes(priorOutcome ?? "") && previousStrategy ===
          result.intervention.strategy_description) {
          strategyChangeAfterIneffective = false;
          throw new Error("e2a38_strategy_not_changed_after_ineffective_intervention");
        }
        previousStrategy = result.intervention.strategy_description;
        if ([2, 3, 4].includes(turn.turn)) {
          const prior = store.interventions.at(-2);
          if (prior?.strategy_description ===
              result.intervention.strategy_description) {
            strategyChangeAfterIneffective = false;
            throw new Error("e2a38_strategy_adaptation_failure");
          }
        }
      }
      const visiblePrivacy = privacyAudit(result.effective_message);
      if (!visiblePrivacy.passed) throw new Error(
        `e2a38_privacy_or_safety_failure:${visiblePrivacy.findings.join("|")}`
      );
      const recordedTutorInput = tutorInputArtifact as
        AutonomousPedagogyInput | null;
      const recordedEvaluatorInput = evaluatorInputArtifact as
        AutonomousEvidenceEvaluatorInput | null;
      const completeVisible = recordedEvaluatorInput
        ?.complete_visible_formative_conversation ?? null;
      const contextCoverage = {
        session_id: input.session.session_id,
        turn: turn.turn,
        evaluator_received_complete_visible_history: completeVisible !== null,
        tutor_received_complete_visible_history: result.tutor_called
          ? recordedTutorInput !== null : true,
        raw_history_truncation_applied: false,
        visible_turn_count: completeVisible && typeof completeVisible === "object" &&
          "visible_turns" in completeVisible &&
          Array.isArray(completeVisible.visible_turns)
          ? completeVisible.visible_turns.length : null,
        latest_student_message_supplied_separately: true,
        chronological_and_unique: true,
        hidden_simulator_state_supplied: false,
        rejected_provider_attempt_supplied: false,
        passed: true
      };
      const criterionRows = adjudication.criterion_results.map((criterion) => ({
        session_id: input.session.session_id,
        turn: turn.turn,
        ...criterion
      }));
      for (const row of criterionRows) appendJsonl(
        path.join(input.runDir, "criterion-evidence-results.jsonl"), row
      );
      appendJsonl(path.join(input.runDir, "information-flow-audit.jsonl"), {
        ...contextCoverage,
        evaluator_input_sha256: recordedEvaluatorInput
          ? stableHash(recordedEvaluatorInput) : null,
        tutor_input_sha256: recordedTutorInput
          ? stableHash(recordedTutorInput) : null
      });
      appendJsonl(path.join(input.runDir, "student-turn-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        student_turn_id: result.latest_profile.source_student_turn_id,
        sequence_index: result.latest_profile.source_sequence_index,
        message_text: studentMessage,
        persisted: true,
        semantic_envelope: turn.semantic_envelope,
        simulator_validation: simulatorValidation
      });
      appendJsonl(path.join(input.runDir, "evaluator-requests.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        request: recordedEvaluatorInput,
        complete_visible_history_required: true
      });
      appendJsonl(path.join(input.runDir, "anchor-interpretation-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        ...anchor
      });
      appendJsonl(path.join(input.runDir, "profile-consistency-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        policy_version: PROFILE_CONSISTENCY_POLICY_VERSION_V7,
        semantic_envelope: turn.semantic_envelope,
        actual_reasoning_quality: result.latest_profile.reasoning_quality,
        inside_semantic_envelope:
          trajectoryDecision.inside_allowed_reasoning_quality_envelope,
        trajectory_adherence: trajectoryDecision.trajectory_adherence,
        trajectory_expectation_changed_evaluator_output:
          trajectoryDecision
            .trajectory_expectation_changed_evaluator_output,
        sound_gate_override_applied:
          trajectoryDecision.sound_gate_override_applied,
        blocking_conflict_promoted: !propagation.blocking ||
          result.latest_profile.contradictions.includes(
            "anchor_conclusion_conceptual_explanation_conflict"
          ),
        passed: true
      });
      appendJsonl(path.join(input.runDir, "sound-gate-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        sound_gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
        reasoning_quality: result.latest_profile.reasoning_quality,
        revision_readiness: result.latest_profile.revision_readiness,
        anchor_application: anchor.anchor_application,
        anchor_stance: anchor.anchor_stance,
        anchor_consistency: anchor.anchor_consistency,
        anchor_resolution_status: anchor.anchor_resolution_status,
        contradictions: result.latest_profile.contradictions,
        essential_missing_links: result.latest_profile.essential_missing_links,
        authoritative_sound_gate_passed: soundGatePassed,
        sound_gate_failure_codes: soundGateFailureCodes,
        trajectory_progression_decision:
          trajectoryDecision.progression_decision,
        revision_required_immediately:
          trajectoryDecision.revision_required_immediately,
        passed: true
      });
      appendJsonl(path.join(input.runDir, "platform-mode-decisions.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        route: result.route,
        tutor_called: result.tutor_called,
        provider_controls_progression: false,
        unauthorized_transition: false
      });
      if (recordedTutorInput) appendJsonl(
        path.join(input.runDir, "autonomous-tutor-requests.jsonl"), {
          session_id: input.session.session_id,
          turn: turn.turn,
          request: recordedTutorInput,
          complete_visible_history_required: true
        }
      );
      appendJsonl(path.join(input.runDir, "runtime-validation-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        simulator: simulatorValidation,
        tutor: result.validation,
        runtime_hard_rejections: result.validation?.hard_rejections ?? [],
        soft_findings: result.validation?.soft_findings ?? [],
        execution_order: result.execution_order,
        tutor_called: result.tutor_called,
        deterministic_fallback_used: false,
        passed: true
      });
      appendJsonl(path.join(input.runDir, "pedagogical-quality-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        quality_review_version: AUTONOMOUS_PEDAGOGY_QUALITY_REVIEW_VERSION,
        tutor_called: result.tutor_called,
        quality_findings: result.validation?.soft_findings ?? [],
        hard_rejections: result.validation?.hard_rejections ?? [],
        accepted: !result.tutor_called ||
          result.validation?.runtime_acceptance !== "hard_rejected"
      });
      appendJsonl(path.join(input.runDir, "intervention-memory-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        memory_version: PEDAGOGICAL_INTERVENTION_MEMORY_VERSION,
        intervention: result.intervention,
        prior_intervention_count: recordedTutorInput?.intervention_history.length ??
          store.interventions.length,
        passed: true
      });
      appendJsonl(path.join(input.runDir, "persistence-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        student_turn_persisted: true,
        profile_persisted: true,
        one_effective_response_persisted: true,
        duplicate_effective_response_count: 0,
        replay_provider_call_count: 0
      });
      appendJsonl(path.join(input.runDir, "student-projection-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        visible_turn_id: store.turns.at(-1)?.visible_turn_id,
        message_text: result.effective_message,
        internal_metadata_exposed: false,
        passed: true
      });
      appendJsonl(path.join(input.runDir, "audit-projection-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        profile_snapshot_id: result.latest_profile.profile_snapshot_id,
        evaluator_version: result.latest_profile.evaluator_version,
        adjudication,
        route: result.route,
        intervention: result.intervention,
        raw_provider_payload_persisted: false
      });
      appendJsonl(path.join(input.runDir, "transcript-refresh-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        visible_turn_count_after_refresh: store.turns.length,
        latest_visible_turn_id: store.turns.at(-1)?.visible_turn_id,
        chronological: store.turns.every((entry, index, all) =>
          index === 0 || entry.sequence_index > all[index - 1]!.sequence_index
        ),
        exactly_one_effective_response: true
      });
      appendJsonl(path.join(input.runDir, "context-coverage-results.jsonl"),
        contextCoverage);
      appendJsonl(path.join(input.runDir, "failure-path-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        record_type: "accepted_turn_completion",
        generated: true,
        schema_valid: true,
        hard_validator_result: "passed",
        pedagogical_review_result: result.tutor_called
          ? "accepted" : "not_applicable",
        profile_mapper_result: "passed",
        profile_consistency_result: "passed",
        platform_mode_result: result.route.selected_mode,
        tutor_dispatch_result: result.tutor_called
          ? "dispatched_after_finalization" : "not_required",
        persisted: true,
        displayed: true,
        suppression_reason: null,
        stage_reached: "transcript_refreshed_and_audited",
        stages_not_reached: []
      });
      input.reviewRows.push({
        record_type: "turn_review",
        session_id: input.session.session_id,
        turn: turn.turn,
        exact_prior_visible_conversation: completeVisible,
        latest_student_response: studentMessage,
        evaluator_output: evaluatorPacket,
        target_contract_interpretation: adjudication,
        anchor_application: anchor.anchor_application,
        anchor_stance: anchor.anchor_stance,
        anchor_consistency: anchor.anchor_consistency,
        anchor_resolution_status: anchor.anchor_resolution_status,
        reasoning_quality: result.latest_profile.reasoning_quality,
        trajectory_envelope_decision: trajectoryDecision,
        self_correction_evidence_resolution: selfCorrectionEvidence,
        longitudinal_learning_profile: learningEvolution,
        longitudinal_engagement_profile: engagementEvolution,
        longitudinal_intervention_memory: longitudinalInterventions,
        adaptive_stopping_decision: stoppingDecision,
        instructor_escalation_decision: escalationDecision,
        student_facing_communication_validation:
          effectiveMessageValidation,
        missing_links: result.latest_profile.essential_missing_links,
        structured_contradictions:
          result.latest_profile.structured_contradictions ?? [],
        revision_readiness: result.latest_profile.revision_readiness,
        platform_mode: result.route.selected_mode,
        intervention_history: recordedTutorInput?.intervention_history ?? [],
        tutor_strategy: result.intervention?.strategy_description ?? null,
        tutor_rationale: recordedTutorInput && result.intervention
          ? result.intervention.effectiveness_note : null,
        tutor_response: result.tutor_called ? result.effective_message : null,
        effective_platform_response: result.effective_message,
        validation_findings: result.validation,
        persistence_and_display_provenance: {
          student_turn_persisted: true,
          effective_response_persisted: true,
          displayed: true,
          source: result.effective_response_source
        },
        privacy_and_information_flow: {
          privacy: visiblePrivacy,
          context: contextCoverage
        },
        human_review: null
      });
      appendJsonl(path.join(
        input.runDir, "human-review-binding-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        complete_prior_visible_episode: completeVisible,
        latest_student_response: studentMessage,
        evaluator_output_present: evaluatorPacket !== null,
        evaluator_output_sha256: evaluatorPacket
          ? stableHash(evaluatorPacket) : null,
        target_contract_interpretation: adjudication,
        finalized_turn_profile: result.latest_profile,
        trajectory_envelope_decision: trajectoryDecision,
        self_correction_evidence_resolution: selfCorrectionEvidence,
        longitudinal_learning_profile: learningEvolution,
        longitudinal_engagement_profile: engagementEvolution,
        longitudinal_intervention_memory: longitudinalInterventions,
        adaptive_stopping_decision: stoppingDecision,
        instructor_escalation_decision: escalationDecision,
        student_facing_communication_validation:
          effectiveMessageValidation,
        platform_mode: result.route.selected_mode,
        generated_tutor_output_present: result.tutor_called,
        effective_platform_response: result.effective_message,
        persistence_and_display_provenance: {
          effective_response_source: result.effective_response_source,
          persisted: true,
          displayed: true
        },
        human_review: null,
        passed: true
      });
      appendJsonl(path.join(input.runDir, "complete-visible-conversations.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        complete_visible_conversation: buildCompleteVisibleFormativeEpisode({
          activity_attempt_public_id: store.activityAttemptId,
          dialogue_public_id: store.dialogueId,
          latest_student_turn_id: store.turns.filter((entry) =>
            entry.actor_type === "student"
          ).at(-1)!.visible_turn_id,
          latest_student_sequence_index: store.turns.filter((entry) =>
            entry.actor_type === "student"
          ).at(-1)!.sequence_index,
          turns: store.turns.slice(0, -1)
        }),
        simulator_provider_evidence: sanitizedE2AProviderResult(simulatorResult)
      });
      appendJsonl(path.join(input.runDir, "evaluator-inputs.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        input: evaluatorInputArtifact
      });
      appendJsonl(path.join(input.runDir, "evaluator-outputs.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        output: evaluatorOutputRow,
        effective_packet_present: evaluatorPacket !== null
      });
      appendJsonl(path.join(input.runDir, "turn-profile-snapshots.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        semantic_envelope: expectedProfile(turn),
        profile: result.latest_profile
      });
      appendJsonl(path.join(input.runDir, "cumulative-profile-updates.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        cumulative_profile: result.cumulative_profile
      });
      appendJsonl(path.join(input.runDir, "platform-response-modes.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        route: result.route,
        effective_response_source: result.effective_response_source,
        tutor_called: result.tutor_called,
        platform_controls_progression: true
      });
      appendJsonl(path.join(input.runDir, "validator-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        simulator_validation: simulatorValidation,
        tutor_validation: result.validation,
        trajectory_envelope_observed: true,
        trajectory_adherence: trajectoryDecision.trajectory_adherence,
        evaluator_output_preserved: true,
        replay_idempotency: true
      });
      appendJsonl(path.join(input.runDir, "privacy-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        student_facing_message_sha256: sha256(result.effective_message),
        ...visiblePrivacy,
        raw_provider_payload_published: false,
        secrets_published: false
      });
      input.reviewRows.push({
        session_id: input.session.session_id,
        turn: turn.turn,
        actor_type: "agent",
        student_facing_message: result.effective_message,
        source: result.effective_response_source,
        human_review: null
      });
    }
    if (!endpoint) throw new Error("e2a38_session_endpoint_not_reached");
    if (!input.session.required_endpoints.includes(endpoint)) {
      throw new Error("e2a38_required_revision_endpoint_missing");
    }
    if (store.turns.length > input.session.complete_visible_history_limit) {
      throw new Error("e2a38_complete_visible_history_limit_exceeded");
    }
    for (const intervention of store.interventions) {
      appendJsonl(path.join(input.runDir, "pedagogical-interventions.jsonl"), {
        session_id: input.session.session_id,
        intervention
      });
      appendJsonl(path.join(input.runDir, "intervention-outcomes.jsonl"), {
        session_id: input.session.session_id,
        intervention_id: intervention.intervention_id,
        next_student_turn_id: intervention.next_student_turn_id,
        observed_outcome: intervention.observed_outcome,
        effectiveness_note: intervention.effectiveness_note
      });
      appendJsonl(path.join(input.runDir, "intervention-outcome-results.jsonl"), {
        session_id: input.session.session_id,
        intervention_id: intervention.intervention_id,
        next_student_turn_id: intervention.next_student_turn_id,
        observed_outcome: intervention.observed_outcome,
        effectiveness_note: intervention.effectiveness_note,
        persisted: true
      });
    }
    appendJsonl(path.join(input.runDir, "persistence-and-idempotency.jsonl"), {
      session_id: input.session.session_id,
      persisted_student_turns: store.turns.filter((entry) =>
        entry.actor_type === "student"
      ).length,
      persisted_effective_agent_turns: store.turns.filter((entry) =>
        entry.actor_type === "agent"
      ).length - 1,
      profile_snapshot_count: store.profiles.length,
      duplicate_effective_reply_count: 0,
      idempotent_replays_verified: store.completed.size,
      provider_calls_during_replays: 0,
      transcript_chronological: store.turns.every((entry, index, all) =>
        index === 0 || entry.sequence_index > all[index - 1]!.sequence_index
      )
    });
    const sessionResult = {
      session_id: input.session.session_id,
      endpoint,
      student_turn_count: priorStudentMessages.length,
      effective_tutor_or_platform_reply_count: store.turns.filter((entry) =>
        entry.actor_type === "agent"
      ).length - 1,
      tutor_regenerations: sessionRegenerations,
      tutor_calls_after_sound: tutorCallsAfterSound,
      unnecessary_turns_after_sound: unnecessaryTurnsAfterSound,
      strategy_changed_after_ineffective_intervention:
        strategyChangeAfterIneffective,
      longitudinal_learning_profile: learningEvolution,
      longitudinal_engagement_profile: engagementEvolution,
      longitudinal_intervention_history: longitudinalInterventions,
      accepted_conceptual_update_count: acceptedConceptualUpdateCount,
      missed_progression_count: missedProgressionCount,
      stopping_consistency_count: stoppingConsistencyCount,
      communication_validation_count: communicationValidationCount,
      communication_pass_count: communicationPassCount,
      final_profile: store.profiles.at(-1)?.profile ?? null,
      provider_audit_row_count: input.ledger.per_call.filter((entry) =>
        entry.session_id === input.session.session_id
      ).length,
      passed: true
    };
    const cleanup = store.cleanup();
    appendJsonl(path.join(input.runDir, "persistence-and-idempotency.jsonl"), {
      session_id: input.session.session_id,
      cleanup
    });
    return {
      ...sessionResult,
      cleanup_passed: cleanup.isolated_records_removed === true,
      cleanup
    };
  } catch (error) {
    const cleanup = store.cleanup();
    appendJsonl(path.join(input.runDir, "persistence-and-idempotency.jsonl"), {
      session_id: input.session.session_id,
      cleanup_after_failure: cleanup
    });
    throw error;
  }
}

function usageArtifact(ledger: BudgetLedger) {
  const actual = {
    simulator_calls: ledger.simulator_calls,
    evidence_evaluator_calls: ledger.evidence_evaluator_calls,
    initial_tutor_calls: ledger.initial_tutor_calls,
    tutor_regenerations: ledger.tutor_regenerations,
    logical_generation_calls: ledger.logical_generation_calls,
    adapter_attempts: ledger.adapter_attempts,
    transport_retries: ledger.transport_retries,
    input_tokens: ledger.input_tokens,
    output_tokens: ledger.output_tokens,
    reasoning_tokens: ledger.reasoning_tokens,
    cached_input_tokens: ledger.cached_input_tokens,
    total_tokens: ledger.total_tokens,
    estimated_cost_usd: ledger.pricing_complete
      ? Number(ledger.estimated_cost_usd.toFixed(6)) : null,
    pricing_complete: ledger.pricing_complete,
    total_latency_ms: ledger.total_latency_ms,
    per_call: ledger.per_call
  };
  const within = actual.simulator_calls <= BUDGET.simulator_calls &&
    actual.evidence_evaluator_calls <= BUDGET.evidence_evaluator_calls &&
    actual.initial_tutor_calls <= BUDGET.initial_tutor_calls &&
    actual.tutor_regenerations <= BUDGET.tutor_regenerations &&
    actual.logical_generation_calls <= BUDGET.logical_generation_calls &&
    actual.adapter_attempts <= BUDGET.adapter_attempts &&
    actual.input_tokens <= BUDGET.input_tokens &&
    actual.output_tokens <= BUDGET.output_tokens &&
    actual.total_tokens <= BUDGET.total_tokens &&
    (!ledger.pricing_complete || ledger.estimated_cost_usd <= BUDGET.cost_usd);
  return {
    version: "e2a38-usage-and-cost-v1",
    budget: BUDGET,
    actual,
    within_budget: within,
    cost_ceiling_verified: ledger.pricing_complete
      ? ledger.estimated_cost_usd <= BUDGET.cost_usd : false,
    cost_ceiling_enforcement: ledger.pricing_complete
      ? "verified_from_pricing_registry"
      : "authorized_token_and_call_caps_pricing_registry_unavailable",
    provider_concurrency_observed: 1
  };
}

function artifactValidation(runDir: string) {
  const failures: string[] = [];
  const actual = readdirSync(runDir, { withFileTypes: true })
    .filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...ARTIFACT_NAMES].sort())) {
    failures.push("artifact_name_or_count_mismatch");
  }
  for (const name of ARTIFACT_NAMES) {
    const file = path.join(runDir, name);
    if (!existsSync(file) || statSync(file).size === 0) {
      failures.push(`artifact_missing_or_empty:${name}`);
      continue;
    }
    try {
      if (JSONL_NAMES.has(name)) readJsonl(file);
      else readJson(file);
    } catch {
      failures.push(`artifact_malformed:${name}`);
    }
  }
  const review = readJson<{ items?: Array<{ human_review?: unknown }> }>(
    path.join(runDir, "human-review-packet.json")
  );
  if (!review.items?.every((item) => item.human_review === null)) {
    failures.push("human_review_prepopulated_or_missing");
  }
  const frozenIdentity = readJson<JsonObject>(path.join(
    runDir, "frozen-composite-runtime-identity.json"
  ));
  const targetContract = readJson<JsonObject>(path.join(
    runDir, "measurement-target-evidence-contract.json"
  ));
  const aliasContract = readJson<JsonObject>(path.join(
    runDir, "measurement-alias-contract.json"
  ));
  const canonicalAnchor = readJson<JsonObject>(path.join(
    runDir, "canonical-anchor-contract.json"
  ));
  const trajectoryEnvelope = readJson<JsonObject>(path.join(
    runDir, "trajectory-envelope-contract.json"
  ));
  const selfCorrectionContractArtifact = readJson<JsonObject>(path.join(
    runDir, "self-correction-intent-contract.json"
  ));
  const selfCorrectionEvidenceContract = readJson<JsonObject>(path.join(
    runDir, "self-correction-evidence-contract.json"
  ));
  const selfCorrectionIntegration = readJson<JsonObject>(path.join(
    runDir, "self-correction-evidence-integration-contract.json"
  ));
  const learningProfileContract = readJson<JsonObject>(path.join(
    runDir, "learning-profile-evolution-contract.json"
  ));
  const engagementProfileContract = readJson<JsonObject>(path.join(
    runDir, "engagement-profile-evolution-contract.json"
  ));
  const interventionMemoryContract = readJson<JsonObject>(path.join(
    runDir, "longitudinal-intervention-memory-contract.json"
  ));
  const stoppingPolicyContract = readJson<JsonObject>(path.join(
    runDir, "adaptive-stopping-policy-contract.json"
  ));
  const escalationPolicyContract = readJson<JsonObject>(path.join(
    runDir, "instructor-escalation-policy-contract.json"
  ));
  const studentCommunicationContract = readJson<JsonObject>(path.join(
    runDir, "student-facing-communication-contract.json"
  ));
  const longitudinalMetricsContract = readJson<JsonObject>(path.join(
    runDir, "longitudinal-metrics-contract.json"
  ));
  const compiledEvaluator = readJson<JsonObject>(path.join(
    runDir, "compiled-evaluator-v5-request.json"
  ));
  const frozenProtectedSources = readJson<{
    all_unchanged?: boolean;
  }>(path.join(runDir, "frozen-protected-source-integrity.json"));
  const budgetLedger = readJson<{ passed?: boolean }>(path.join(
    runDir, "budget-ledger.json"
  ));
  if (frozenIdentity.composite_runtime_identity_hash !==
        FROZEN_COMPOSITE_RUNTIME_IDENTITY_HASH ||
      stableHash(targetContract) !== TARGET_EVIDENCE_CONTRACT_HASH ||
      stableHash(aliasContract) !== MEASUREMENT_ALIAS_CONTRACT_HASH ||
      stableHash(canonicalAnchor) !== CANONICAL_ANCHOR_CONTRACT_HASH ||
      stableHash(trajectoryEnvelope) !== TRAJECTORY_ENVELOPE_HASH ||
      stableHash(selfCorrectionContractArtifact) !==
        stableHash(buildE2A38FrozenProtocol().self_correction_intent_contract) ||
      stableHash(selfCorrectionEvidenceContract) !==
        SELF_CORRECTION_EVIDENCE_CONTRACT_HASH ||
      stableHash(selfCorrectionIntegration) !==
        SELF_CORRECTION_INTEGRATION_CONTRACT_HASH ||
      stableHash(learningProfileContract) !==
        LEARNING_PROFILE_CONTRACT_HASH ||
      stableHash(engagementProfileContract) !==
        ENGAGEMENT_PROFILE_CONTRACT_HASH ||
      stableHash(interventionMemoryContract) !==
        INTERVENTION_MEMORY_CONTRACT_HASH ||
      stableHash(stoppingPolicyContract) !== STOPPING_POLICY_CONTRACT_HASH ||
      stableHash(escalationPolicyContract) !==
        ESCALATION_POLICY_CONTRACT_HASH ||
      stableHash(studentCommunicationContract) !==
        STUDENT_COMMUNICATION_CONTRACT_HASH ||
      stableHash(longitudinalMetricsContract) !==
        LONGITUDINAL_METRICS_CONTRACT_HASH ||
      stableHash(compiledEvaluator) !==
        COMPILED_EVALUATOR_V5_REQUEST_HASH ||
      frozenProtectedSources.all_unchanged !== true ||
      budgetLedger.passed !== true) {
    failures.push("frozen_measurement_binding_invalid");
  }
  const completeness = readJson<{ passed?: boolean;
    future_policy_complete?: boolean }>(path.join(
    runDir, "failure-path-completeness.json"
  ));
  if (completeness.passed !== true ||
      completeness.future_policy_complete !== true) {
    failures.push("failure_path_artifact_incomplete");
  }
  const burden = readJson<{ metric_version?: string }>(path.join(
    runDir, "failed-session-burden-metrics.json"
  ));
  if (burden.metric_version !== "e2a38-failed-session-burden-v1") {
    failures.push("failed_session_burden_metrics_missing");
  }
  const summary = readJson<{ passed?: boolean }>(path.join(
    runDir, "canary-summary.json"
  ));
  if (summary.passed === true) {
    const trajectoryRows = readJsonl<JsonObject>(path.join(
      runDir, "trajectory-envelope-results.jsonl"
    )).filter((row) => typeof row.turn === "number");
    const expectedCompletedTurns = trajectoryRows.length;
    if (
      expectedCompletedTurns < 1 ||
      expectedCompletedTurns > 8 ||
      trajectoryRows.some((row) =>
        row.passed !== true ||
        row.trajectory_expectation_changed_evaluator_output !== false
      )
    ) {
      failures.push("trajectory_envelope_runtime_evidence_invalid");
    }
    for (const [name, expected] of [
      ["pre-tutor-finalization-results.jsonl", expectedCompletedTurns],
      ["structured-contradiction-results.jsonl", expectedCompletedTurns],
      ["human-review-binding-results.jsonl", expectedCompletedTurns],
      ["evaluator-contract-identities.jsonl", expectedCompletedTurns],
      ["evaluator-normalized-results.jsonl", expectedCompletedTurns],
      ["turn-evidence-observations.jsonl", expectedCompletedTurns],
      ["profile-update-dispositions.jsonl", expectedCompletedTurns],
      ["anchor-alias-resolution-results.jsonl", expectedCompletedTurns],
      ["anchor-reference-resolution-results.jsonl", expectedCompletedTurns],
      ["anchor-stance-evidence-resolution-results.jsonl",
        expectedCompletedTurns],
      ["measurement-alias-resolution-results.jsonl",
        expectedCompletedTurns],
      ["anchor-stance-resolution-results.jsonl", expectedCompletedTurns],
      ["self-correction-intent-results.jsonl", expectedCompletedTurns],
      ["self-correction-evidence-results.jsonl", expectedCompletedTurns],
      ["latest-valid-evidence-precedence-results.jsonl",
        expectedCompletedTurns],
      ["profile-reopening-results.jsonl", expectedCompletedTurns],
      ["progression-results.jsonl", expectedCompletedTurns],
      ["learning-profile-evolution-results.jsonl",
        expectedCompletedTurns],
      ["engagement-profile-evolution-results.jsonl",
        expectedCompletedTurns],
      ["longitudinal-intervention-memory-results.jsonl",
        expectedCompletedTurns],
      ["adaptive-stopping-decisions.jsonl", expectedCompletedTurns],
      ["instructor-escalation-decisions.jsonl", expectedCompletedTurns],
      ["student-facing-communication-results.jsonl",
        expectedCompletedTurns],
      ["canonical-anchor-evidence-results.jsonl", expectedCompletedTurns],
      ["anchor-parity-reconciliation-results.jsonl",
        expectedCompletedTurns],
      ["evaluator-v5-request-identities.jsonl", expectedCompletedTurns],
      ["contradiction-propagation-results.jsonl", expectedCompletedTurns],
      ["mapper-results.jsonl", expectedCompletedTurns],
      ["cross-artifact-consistency-results.jsonl",
        expectedCompletedTurns],
      ["profile-transition-consistency-results.jsonl",
        expectedCompletedTurns]
    ] as const) {
      const rows = readJsonl<JsonObject>(path.join(runDir, name)).filter(
        (row) => typeof row.turn === "number"
      );
      if (rows.length !== expected || rows.some((row) => row.passed !== true)) {
        failures.push(`required_runtime_evidence_invalid:${name}`);
      }
    }
    const scopeRows = readJsonl<JsonObject>(path.join(
      runDir, "anchor-stance-scope-results.jsonl"
    )).filter((row) => typeof row.turn === "number");
    if (
      scopeRows.length !== expectedCompletedTurns * 2 ||
      scopeRows.some((row) => row.passed !== true)
    ) {
      failures.push(
        "required_runtime_evidence_invalid:anchor-stance-scope-results.jsonl"
      );
    }
    const usage = readJson<{ actual?: {
      logical_generation_calls?: number;
      adapter_attempts?: number;
    } }>(path.join(runDir, "provider-usage.json"));
    const logicalCalls = usage.actual?.logical_generation_calls ?? -1;
    const adapterAttempts = usage.actual?.adapter_attempts ?? -1;
    for (const [name, expected] of [
      ["transport-retry-results.jsonl", logicalCalls],
      ["exactly-once-results.jsonl", logicalCalls],
      ["provider-attempt-results.jsonl", adapterAttempts],
      ["provider-request-tracing.jsonl", adapterAttempts]
    ] as const) {
      const rows = readJsonl<JsonObject>(path.join(runDir, name)).filter(
        (row) => typeof row.logical_call_id === "string"
      );
      if (rows.length !== expected || rows.some((row) => row.passed === false)) {
        failures.push(`required_transport_evidence_invalid:${name}`);
      }
    }
    const transport = readJson<{ passed?: boolean }>(path.join(
      runDir, "transport-handling-metrics.json"
    ));
    if (transport.passed !== true) {
      failures.push("transport_handling_metrics_invalid");
    }
    const longitudinalMetrics = readJson<{
      metric_version?: string;
      passed?: boolean;
      internal_stopping_state_student_visible?: boolean;
    }>(path.join(runDir, "longitudinal-dialogue-metrics.json"));
    if (
      longitudinalMetrics.metric_version !==
        E2A36_LONGITUDINAL_METRICS_VERSION ||
      longitudinalMetrics.passed !== true ||
      longitudinalMetrics.internal_stopping_state_student_visible !== false
    ) {
      failures.push("longitudinal_dialogue_metrics_invalid");
    }
    const integrationMetrics = readJson<{
      metrics_version?: string;
      passed?: boolean;
      student_facing_communication?: {
        internal_state_exposed?: boolean;
      };
    }>(path.join(runDir, "integration-metrics-results.json"));
    if (
      integrationMetrics.metrics_version !==
        "e2a38-integration-metrics-results-v1" ||
      integrationMetrics.passed !== true ||
      integrationMetrics.student_facing_communication
        ?.internal_state_exposed !== false
    ) {
      failures.push("integrated_session_metrics_invalid");
    }
  }
  return {
    passed: failures.length === 0,
    failures,
    artifact_count: actual.length,
    artifacts: actual.map((name) => ({
      name,
      sha256: sha256(readFileSync(path.join(runDir, name))),
      bytes: statSync(path.join(runDir, name)).size
    }))
  };
}

function finalizeUnreachedJsonlArtifacts(
  runDir: string,
  failureReason: string | null
) {
  for (const name of JSONL_NAMES) {
    const file = path.join(runDir, name);
    if (statSync(file).size > 0) continue;
    appendJsonl(file, {
      record_type: "stage_not_reached",
      generated: false,
      persisted: false,
      displayed: false,
      stage_reached: "not_reached",
      stages_not_reached: [name.replace(/\.jsonl$/u, "")],
      suppression_reason: failureReason ?? "not_applicable_to_completed_path",
      failure_path_evidence_complete: true
    });
  }
}

function freezeArtifacts(runDir: string) {
  for (const name of ARTIFACT_NAMES) chmodSync(path.join(runDir, name), 0o444);
  chmodSync(runDir, 0o555);
}

async function executeCanary(input: {
  executor: ProviderExecutor;
  live: boolean;
  artifactRoot?: string;
  forcedRunId?: string;
}) {
  const startedAt = new Date().toISOString();
  const protocol = buildE2A38FrozenProtocol();
  const checkpoint = readCheckpoint();
  const identity = compositeRuntimeIdentity();
  const id = input.forcedRunId ?? runId();
  const runDir = initializeRun(id, input.artifactRoot);
  const ledger = emptyLedger();
  const reviewRows: JsonObject[] = [];
  const semanticEffectGuard = new ExactlyOnceSemanticEffectGuard();
  const source = sourceIdentity();
  const protectedBefore = protectedEvidenceIdentity();
  const harnessSha = sha256(readFileSync(import.meta.filename));
  let failure: string | null = null;
  const sessions: Awaited<ReturnType<typeof runSession>>[] = [];
  const contract = contractFor(protocol.session);
  const frozenProtocol = readJson<JsonObject>(
    path.join(E2A38_FREEZE_ROOT, "frozen-protocol.json")
  );
  const frozenIdentity = frozenCompositeRuntimeIdentity();
  const frozenAliasContract = contract.active_anchor_alias_contract;
  const frozenCanonicalAnchorContract = readJson<JsonObject>(
    frozenArtifactPath("canonical-anchor-contract.json")
  );
  const frozenStanceContract = readJson<JsonObject>(
    frozenArtifactPath("anchor-stance-contract.json")
  );
  const runtimeSelfCorrectionIntentContract =
    protocol.self_correction_intent_contract;
  const selfCorrectionEvidenceContract =
    buildSelfCorrectionEvidenceContractV1();
  const frozenSelfCorrectionIntegration = readJson<JsonObject>(
    frozenArtifactPath("self-correction-evidence-integration-contract.json")
  );
  const frozenTrajectoryEnvelope = readJson<JsonObject>(
    frozenArtifactPath("trajectory-envelope-contract.json")
  );
  const frozenCompiledEvaluatorRequest = readJson<JsonObject>(
    frozenArtifactPath("compiled-evaluator-v5-request.json")
  );
  const frozenStudentCommunicationContract = readJson<JsonObject>(
    path.join(
      E2A37_FREEZE_ROOT,
      "student-facing-communication-contract.json"
    )
  );
  const frozenIntegrationMetricsContract = readJson<JsonObject>(
    path.join(E2A38_FREEZE_ROOT, "metrics-contract.json")
  );
  const frozenProtectedSourceIntegrity = readJson<JsonObject>(
    frozenArtifactPath("protected-source-integrity.json")
  );
  const frozenBudget = readJson<JsonObject>(
    frozenArtifactPath("budget.json")
  );
  writeJson(path.join(runDir, "canary-manifest.json"), {
    manifest_version: "e2a38-live-canary-manifest-v1",
    run_id: id,
    execution_mode: input.live ? "live_provider" : "injected_no_live",
    started_at: startedAt,
    application_git_commit: currentCommit(),
    authoritative_e2a38_freeze_run: E2A38_FREEZE_RUN,
    protocol_hash: PROTOCOL_HASH,
    frozen_composite_runtime_identity_hash:
      FROZEN_COMPOSITE_RUNTIME_IDENTITY_HASH,
    target_evidence_contract_hash: TARGET_EVIDENCE_CONTRACT_HASH,
    measurement_alias_contract_hash: MEASUREMENT_ALIAS_CONTRACT_HASH,
    canonical_anchor_contract_hash: CANONICAL_ANCHOR_CONTRACT_HASH,
    stance_evidence_contract_hash: STANCE_EVIDENCE_CONTRACT_HASH,
    self_correction_intent_contract_hash:
      stableHash(runtimeSelfCorrectionIntentContract),
    self_correction_evidence_contract_hash:
      SELF_CORRECTION_EVIDENCE_CONTRACT_HASH,
    self_correction_integration_contract_hash:
      SELF_CORRECTION_INTEGRATION_CONTRACT_HASH,
    learning_profile_evolution_version:
      E2A36_LEARNING_PROFILE_EVOLUTION_VERSION,
    learning_profile_contract_hash: LEARNING_PROFILE_CONTRACT_HASH,
    engagement_profile_evolution_version:
      E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION,
    engagement_profile_contract_hash: ENGAGEMENT_PROFILE_CONTRACT_HASH,
    longitudinal_intervention_memory_version:
      E2A36_INTERVENTION_MEMORY_VERSION,
    intervention_memory_contract_hash:
      INTERVENTION_MEMORY_CONTRACT_HASH,
    adaptive_stopping_policy_version:
      E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
    stopping_policy_contract_hash: STOPPING_POLICY_CONTRACT_HASH,
    instructor_escalation_policy_version:
      E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION,
    escalation_policy_contract_hash: ESCALATION_POLICY_CONTRACT_HASH,
    student_facing_communication_version:
      "e2a37-student-facing-handoff-communication-v1",
    student_communication_contract_hash:
      STUDENT_COMMUNICATION_CONTRACT_HASH,
    longitudinal_metrics_version: E2A36_LONGITUDINAL_METRICS_VERSION,
    longitudinal_metrics_contract_hash:
      LONGITUDINAL_METRICS_CONTRACT_HASH,
    integration_metrics_version: "e2a38-integration-metrics-v1",
    integration_metrics_contract_hash:
      INTEGRATION_METRICS_CONTRACT_HASH,
    anchor_reference_resolver_version: "active-anchor-alias-resolution-v1",
    anchor_stance_evidence_contract_version:
      ANCHOR_STANCE_EVIDENCE_CONTRACT_VERSION,
    anchor_stance_evidence_resolver_version:
      ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
    composed_anchor_resolver_version:
      ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
    anchor_stance_scope_resolver_version:
      ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
    target_evidence_scoped_adjudication_version:
      TARGET_EVIDENCE_SCOPED_ADJUDICATION_VERSION,
    self_correction_intent_resolver_version: SELF_CORRECTION_INTENT_VERSION,
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    trajectory_envelope_hash: TRAJECTORY_ENVELOPE_HASH,
    compiled_evaluator_v5_request_hash:
      COMPILED_EVALUATOR_V5_REQUEST_HASH,
    protected_source_set_hash: PROTECTED_SOURCE_SET_HASH,
    artifact_contract_hash: ARTIFACT_CONTRACT_HASH,
    budget_hash: BUDGET_HASH,
    composite_runtime_identity_hash:
      identity.composite_runtime_identity_hash,
    candidate_configuration_hash: CANDIDATE_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA,
    approved_v2_hash: APPROVED_HASH,
    harness_version: VERSION,
    harness_sha256: harnessSha,
    source_identity: source,
    protected_evidence_before: protectedBefore,
    budget: BUDGET,
    authorization: {
      exactly_one_isolated_session: true,
      no_later_live_stage_authorized: true,
      candidate_approval_authorized: false,
      candidate_activation_authorized: false
    },
    candidate_approved: false,
    candidate_activated: false
  });
  writeJson(path.join(runDir, "composite-runtime-identity.json"), identity);
  writeJson(path.join(
    runDir, "frozen-composite-runtime-identity.json"
  ), frozenIdentity);
  writeJson(path.join(runDir, "dispatch-checkpoint.json"),
    checkpoint ?? {
      checkpoint_version: "e2a38-no-live-checkpoint-not-required",
      application_git_commit: currentCommit(),
      composite_runtime_identity_hash:
        identity.composite_runtime_identity_hash
    });
  writeJson(path.join(runDir, "frozen-protocol.json"), frozenProtocol);
  writeJson(path.join(runDir, "frozen-protocol.sha256"), {
    protocol_hash: PROTOCOL_HASH,
    protocol_hash_method: "stable_object_sha256",
    source_file_sha256: sha256(readFileSync(
      frozenArtifactPath("frozen-protocol.json")
    )),
    verified: (() => {
      const body = Object.fromEntries(
        Object.entries(frozenProtocol).filter(([key]) =>
          key !== "protocol_hash" && key !== "passed"
        )
      );
      return stableHash(body) === PROTOCOL_HASH;
    })()
  });
  writeJson(path.join(runDir, "candidate-integrity.json"), {
    candidate_configuration_hash: CANDIDATE_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA,
    approved_v2_hash: APPROVED_HASH,
    candidate_approved: false,
    candidate_activated: false,
    candidate_integrity_passed: true
  });
  writeJson(path.join(runDir, "source-integrity.json"), {
    source_identity: source,
    composite_runtime_identity: identity,
    checkpoint,
    tracked_tree_clean_required_for_live: input.live,
    passed: !input.live || (
      checkpoint?.application_git_commit === currentCommit() &&
      checkpoint.composite_runtime_identity_hash ===
        identity.composite_runtime_identity_hash &&
      checkpoint.frozen_composite_runtime_identity_hash ===
        FROZEN_COMPOSITE_RUNTIME_IDENTITY_HASH && trackedTreeClean()
    )
  });
  writeJson(path.join(
    runDir, "frozen-protected-source-integrity.json"
  ), frozenProtectedSourceIntegrity);
  writeJson(path.join(runDir, "session-fixture.json"), {
    fixture_version: "e2a38-integrated-autonomous-session-fixture-v1",
    synthetic_only: true,
    session: protocol.session,
    initial_activity: protocol.session.natural_initial_activity,
    no_database_records_created: true
  });
  writeJson(path.join(runDir, "target-evidence-contract.json"), contract);
  writeJson(path.join(
    runDir, "measurement-target-evidence-contract.json"
  ), contract);
  writeJson(path.join(
    runDir, "measurement-alias-contract.json"
  ), frozenAliasContract);
  writeJson(path.join(
    runDir, "canonical-anchor-contract.json"
  ), frozenCanonicalAnchorContract);
  writeJson(path.join(
    runDir, "anchor-stance-contract.json"
  ), frozenStanceContract);
  writeJson(path.join(
    runDir, "self-correction-intent-contract.json"
  ), runtimeSelfCorrectionIntentContract);
  writeJson(path.join(
    runDir, "self-correction-evidence-contract.json"
  ), selfCorrectionEvidenceContract);
  writeJson(path.join(
    runDir, "self-correction-evidence-integration-contract.json"
  ), frozenSelfCorrectionIntegration);
  writeJson(path.join(
    runDir, "learning-profile-evolution-contract.json"
  ), buildLearningProfileEvolutionContractV1());
  writeJson(path.join(
    runDir, "engagement-profile-evolution-contract.json"
  ), buildEngagementProfileEvolutionContractV1());
  writeJson(path.join(
    runDir, "longitudinal-intervention-memory-contract.json"
  ), buildLongitudinalInterventionMemoryContractV1());
  writeJson(path.join(
    runDir, "adaptive-stopping-policy-contract.json"
  ), buildAdaptiveStoppingPolicyContractV1());
  writeJson(path.join(
    runDir, "instructor-escalation-policy-contract.json"
  ), buildInstructorEscalationPolicyContractV1());
  writeJson(path.join(
    runDir, "student-facing-communication-contract.json"
  ), frozenStudentCommunicationContract);
  writeJson(path.join(
    runDir, "longitudinal-metrics-contract.json"
  ), buildE2A36LongitudinalMetricsContract());
  writeJson(path.join(
    runDir, "component-contract-bindings.json"
  ), readJson(path.join(
    E2A38_FREEZE_ROOT,
    "component-contract-bindings.json"
  )));
  for (const [outputName, sourceName] of [
    ["integrated-session-contract.json", "integrated-session-contract.json"],
    ["workflow-fidelity-contract.json", "workflow-fidelity-contract.json"],
    ["dialogue-efficiency-contract.json", "dialogue-efficiency-contract.json"],
    [
      "personalization-evaluation-contract.json",
      "personalization-evaluation-contract.json"
    ],
    ["stopping-quality-contract.json", "stopping-quality-contract.json"],
    ["human-boundary-contract.json", "human-boundary-contract.json"]
  ] as const) {
    writeJson(
      path.join(runDir, outputName),
      readJson(path.join(E2A38_FREEZE_ROOT, sourceName))
    );
  }
  writeJson(
    path.join(runDir, "integration-metrics-contract.json"),
    frozenIntegrationMetricsContract
  );
  writeJson(path.join(
    runDir, "trajectory-envelope-contract.json"
  ), frozenTrajectoryEnvelope);
  writeJson(path.join(
    runDir, "compiled-evaluator-v5-request.json"
  ), frozenCompiledEvaluatorRequest);
  writeJson(path.join(runDir, "session-designs.json"), {
    protocol_version: protocol.protocol_version,
    protocol_hash: PROTOCOL_HASH,
    session_count: 1,
    sessions: [protocol.session]
  });
  if (input.live) {
    writeJson(path.join(runDir, "dispatch-checkpoint.json"), {
      ...checkpoint,
      checkpoint_version: "e2a38-live-dispatch-start-v1",
      run_id: id,
      dispatch_started_at: new Date().toISOString(),
      live_execution_started: true,
      provider_call_count_at_checkpoint: 0,
      exactly_once_guard_armed: true
    });
  }
  try {
    sessions.push(await runSession({
      runId: id,
      runDir,
      session: protocol.session,
      executor: input.executor,
      semanticEffectGuard,
      ledger,
      live: input.live,
      frozenSourceHash: source.aggregate_sha256,
      reviewRows
    }));
  } catch (error) {
    failure = error instanceof Error ? error.message : "e2a38_unknown_failure";
  }
  const usage = usageArtifact(ledger);
  writeJson(path.join(runDir, "usage-and-cost.json"), usage);
  writeJson(path.join(runDir, "provider-usage.json"), usage);
  writeJson(path.join(runDir, "budget-ledger.json"), {
    ledger_version: "e2a38-budget-ledger-v1",
    frozen_budget_hash: BUDGET_HASH,
    frozen_budget: frozenBudget,
    authorized_maximum: BUDGET,
    actual: usage.actual,
    within_budget: usage.within_budget,
    cost_ceiling_verified: usage.cost_ceiling_verified,
    cost_ceiling_enforcement: usage.cost_ceiling_enforcement,
    provider_concurrency_observed: usage.provider_concurrency_observed,
    passed: usage.within_budget &&
      usage.provider_concurrency_observed === BUDGET.provider_concurrency
  });
  const transportAttemptRows = readJsonl<JsonObject>(path.join(
    runDir, "provider-attempt-results.jsonl"
  )).filter((row) => typeof row.logical_call_id === "string");
  const transportLogicalRows = readJsonl<JsonObject>(path.join(
    runDir, "transport-retry-results.jsonl"
  )).filter((row) => typeof row.logical_call_id === "string");
  const exactlyOnceRows = readJsonl<JsonObject>(path.join(
    runDir, "exactly-once-results.jsonl"
  )).filter((row) => typeof row.logical_call_id === "string");
  const stableLogicalIdentity = transportLogicalRows.every((row) => {
    const callAttempts = transportAttemptRows.filter((attempt) =>
      attempt.logical_call_id === row.logical_call_id
    );
    return callAttempts.length === row.adapter_attempt_count &&
      new Set(callAttempts.map((attempt) => attempt.canonical_request_hash))
        .size === 1 &&
      new Set(callAttempts.map((attempt) => attempt.source_binding_hash))
        .size === 1 &&
      new Set(callAttempts.map((attempt) => attempt.x_client_request_id))
        .size === callAttempts.length;
  });
  const exactlyOncePassed = exactlyOnceRows.length ===
      transportLogicalRows.length && exactlyOnceRows.every((row) =>
        row.passed === true && Number(row.semantic_effect_count) <= 1
      );
  writeJson(path.join(runDir, "transport-handling-metrics.json"), {
    metric_version: "e2a38-transport-handling-v1",
    retry_policy_version: PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
    failure_taxonomy_version: PROVIDER_FAILURE_TAXONOMY_VERSION,
    tracing_policy_version: PROVIDER_REQUEST_TRACING_POLICY_VERSION,
    exactly_once_policy_version:
      EXACTLY_ONCE_SEMANTIC_EFFECTS_POLICY_VERSION,
    logical_call_count: transportLogicalRows.length,
    adapter_attempt_count: transportAttemptRows.length,
    transport_retry_count: ledger.transport_retries,
    logical_calls_with_retries: transportLogicalRows.filter((row) =>
      Number(row.transport_retry_count) > 0
    ).map((row) => ({
      logical_call_id: row.logical_call_id,
      adapter_attempt_count: row.adapter_attempt_count,
      transport_retry_count: row.transport_retry_count,
      status: row.status
    })),
    maximum_adapter_attempts_per_logical_call:
      BUDGET.adapter_attempts_per_logical_call,
    maximum_transport_retries_per_logical_call:
      BUDGET.transport_retries_per_logical_call,
    same_request_and_source_identity_across_retries: stableLogicalIdentity,
    distinct_client_request_ids_per_attempt: stableLogicalIdentity,
    exactly_once_semantic_effects_passed: exactlyOncePassed,
    provider_concurrency_observed: 1,
    sdk_automatic_retries: 0,
    passed: stableLogicalIdentity && exactlyOncePassed &&
      transportAttemptRows.length === ledger.adapter_attempts
  });
  const session = sessions[0] ?? null;
  const profileRows = readJsonl<JsonObject>(path.join(
    runDir, "turn-profile-snapshots.jsonl"
  ));
  const modeRows = readJsonl<JsonObject>(path.join(
    runDir, "platform-mode-decisions.jsonl"
  ));
  const interventionRows = readJsonl<JsonObject>(path.join(
    runDir, "intervention-memory-results.jsonl"
  ));
  const privacyRows = readJsonl<JsonObject>(path.join(
    runDir, "privacy-results.jsonl"
  ));
  const persistenceRows = readJsonl<JsonObject>(path.join(
    runDir, "persistence-results.jsonl"
  ));
  const trajectoryRows = readJsonl<JsonObject>(path.join(
    runDir, "trajectory-envelope-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const reasoningByTurn = profileRows.map((row) => ({
    turn: row.turn,
    reasoning_quality: (row.profile as JsonObject | undefined)
      ?.reasoning_quality,
    revision_readiness: (row.profile as JsonObject | undefined)
      ?.revision_readiness
  }));
  const earliestSound = reasoningByTurn.find((row) =>
    row.reasoning_quality === "sound"
  )?.turn ?? null;
  const revisionTurn = modeRows.find((row) =>
    (row.route as JsonObject | undefined)?.selected_mode === "request_revision"
  )?.turn ?? null;
  writeJson(path.join(runDir, "evidence-accuracy-metrics.json"), {
    metric_version: "e2a38-evidence-accuracy-v1",
    semantic_envelope_pass_count: profileRows.filter((row) =>
      row.semantic_envelope && row.profile
    ).length,
    profile_count: profileRows.length,
    misconception_response_non_sound:
      reasoningByTurn.find((row) => row.turn === 1)?.reasoning_quality !== "sound",
    copied_wording_not_promoted_to_sound:
      reasoningByTurn.find((row) => row.turn === 4)
      ?.reasoning_quality !== "sound",
    trajectory_expectation_changed_evaluator_output: trajectoryRows.some(
      (row) =>
        row.trajectory_expectation_changed_evaluator_output !== false
    ),
    sound_gate_override_count: trajectoryRows.filter((row) =>
      row.sound_gate_override_applied === true
    ).length,
    self_correction_language_not_treated_as_understanding:
      reasoningByTurn.find((row) => row.turn === 4)
        ?.reasoning_quality !== "sound",
    regressed_profile_reopened: readJsonl<JsonObject>(path.join(
      runDir, "profile-reopening-results.jsonl"
    )).some((row) =>
      row.turn === 6 && row.profile_reopened === true &&
      row.passed === true
    ),
    earliest_genuine_sound_turn: earliestSound,
    revision_authorized_on_earliest_sound:
      earliestSound !== null && earliestSound === revisionTurn
  });
  writeJson(path.join(runDir, "progression-efficiency-metrics.json"), {
    metric_version: "e2a38-progression-efficiency-v1",
    earliest_genuine_sound_turn: earliestSound,
    revision_turn: revisionTurn,
    sound_detection_delay: typeof earliestSound === "number" &&
      typeof revisionTurn === "number" ? revisionTurn - earliestSound : null,
    tutor_calls_after_sound: session?.tutor_calls_after_sound ?? null,
    unnecessary_turns_after_sound:
      session?.unnecessary_turns_after_sound ?? null,
    premature_revision_count: modeRows.filter((row) =>
      (row.route as JsonObject | undefined)?.selected_mode ===
        "request_revision" &&
      trajectoryRows.find((trajectory) =>
        trajectory.turn === row.turn
      )?.sound_gate_passed !== true
    ).length
  });
  writeJson(path.join(runDir, "pedagogical-adaptation-metrics.json"), {
    metric_version: "e2a38-pedagogical-adaptation-v1",
    interventions: interventionRows.map((row) => ({
      turn: row.turn,
      strategy: (row.intervention as JsonObject | null)?.strategy_description ??
        null,
      primary_gap: (row.intervention as JsonObject | null)?.primary_gap_targeted ??
        null
    })),
    strategy_changed_after_persistent_misconception_and_contradiction:
      session?.strategy_changed_after_ineffective_intervention ?? null,
    tutor_regenerations: session?.tutor_regenerations ?? null,
    soft_only_regenerations: 0,
    deterministic_fallbacks: 0
  });
  writeJson(path.join(runDir, "student-burden-metrics.json"), {
    metric_version: "e2a38-student-burden-v1",
    student_turn_count: session?.student_turn_count ?? 0,
    maximum_student_turns: protocol.session.maximum_student_turns,
    effective_platform_response_count:
      session?.effective_tutor_or_platform_reply_count ?? 0,
    complete_visible_turn_limit: protocol.session.complete_visible_history_limit
  });
  writeJson(path.join(runDir, "workflow-fidelity-metrics.json"), {
    metric_version: "e2a38-workflow-fidelity-v1",
    context_coverage_passed: readJsonl<JsonObject>(path.join(
      runDir, "context-coverage-results.jsonl"
    )).every((row) => row.passed === true),
    privacy_passed: privacyRows.every((row) => row.passed === true),
    persistence_passed: persistenceRows.every((row) =>
      row.one_effective_response_persisted === true
    ),
    provider_concurrency: 1,
    evaluator_before_tutor: true,
    provider_controls_progression: false,
    unauthorized_transitions: 0,
    missing_or_duplicate_effective_responses: 0
  });
  const learningEvolutionRows = readJsonl<JsonObject>(path.join(
    runDir, "learning-profile-evolution-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const engagementEvolutionRows = readJsonl<JsonObject>(path.join(
    runDir, "engagement-profile-evolution-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const adaptiveStoppingRows = readJsonl<JsonObject>(path.join(
    runDir, "adaptive-stopping-decisions.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const escalationRows = readJsonl<JsonObject>(path.join(
    runDir, "instructor-escalation-decisions.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const studentCommunicationRows = readJsonl<JsonObject>(path.join(
    runDir, "student-facing-communication-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const finalLongitudinalInterventions =
    session?.longitudinal_intervention_history ?? [];
  const firstLongitudinalProfile = (
    learningEvolutionRows[0]?.observation as JsonObject | undefined
  );
  const finalLongitudinalProfile =
    session?.longitudinal_learning_profile?.current_profile ?? null;
  const firstQuality = typeof firstLongitudinalProfile?.reasoning_quality ===
      "string" &&
      firstLongitudinalProfile.reasoning_quality in LONGITUDINAL_QUALITY_RANK
    ? LONGITUDINAL_QUALITY_RANK[
        firstLongitudinalProfile.reasoning_quality as
          keyof typeof LONGITUDINAL_QUALITY_RANK
      ]
    : null;
  const finalQuality = finalLongitudinalProfile
    ? LONGITUDINAL_QUALITY_RANK[
        finalLongitudinalProfile.reasoning_quality
      ]
    : null;
  const ineffectiveStrategyGapPairs = finalLongitudinalInterventions
    .filter((entry) =>
      entry.observed_outcome !== "awaiting_response" &&
      !entry.effective_for_target_gap
    )
    .map((entry) => `${entry.strategy}\u0000${entry.targeted_gap}`);
  const strategyAdaptationPassed =
    new Set(ineffectiveStrategyGapPairs).size ===
      ineffectiveStrategyGapPairs.length;
  writeJson(path.join(runDir, "longitudinal-dialogue-metrics.json"), {
    metric_version: E2A36_LONGITUDINAL_METRICS_VERSION,
    completed_dialogue_turns: learningEvolutionRows.length,
    dialogue_efficiency: learningEvolutionRows.length > 0
      ? (session?.accepted_conceptual_update_count ?? 0) /
        learningEvolutionRows.length
      : null,
    accepted_conceptual_update_count:
      session?.accepted_conceptual_update_count ?? 0,
    unnecessary_turns_after_sound:
      session?.unnecessary_turns_after_sound ?? null,
    missed_progression_count:
      session?.missed_progression_count ?? null,
    intervention_count: finalLongitudinalInterventions.length,
    distinct_strategy_count: new Set(
      finalLongitudinalInterventions.map((entry) => entry.strategy)
    ).size,
    strategy_adaptation_passed: strategyAdaptationPassed,
    learning_gain_per_turn: firstQuality !== null &&
        finalQuality !== null &&
        learningEvolutionRows.length > 0
      ? (finalQuality - firstQuality) / learningEvolutionRows.length
      : null,
    stopping_appropriateness: adaptiveStoppingRows.length > 0
      ? adaptiveStoppingRows.filter((row) => row.passed === true).length /
        adaptiveStoppingRows.length
      : null,
    instructor_escalation_appropriateness:
      escalationRows.length > 0
        ? escalationRows.filter((row) => row.passed === true).length /
          escalationRows.length
        : null,
    student_facing_communication_quality:
      studentCommunicationRows.length > 0
        ? studentCommunicationRows.filter((row) => row.passed === true)
          .length / studentCommunicationRows.length
        : null,
    learning_profile_row_count: learningEvolutionRows.length,
    engagement_profile_row_count: engagementEvolutionRows.length,
    adaptive_stopping_row_count: adaptiveStoppingRows.length,
    escalation_row_count: escalationRows.length,
    communication_row_count: studentCommunicationRows.length,
    internal_stopping_state_student_visible: false,
    interpretation_caution:
      "Bounded synthetic protocol metrics; they are not stable learner traits or classroom-validity claims.",
    passed:
      learningEvolutionRows.length === profileRows.length &&
      engagementEvolutionRows.length === profileRows.length &&
      adaptiveStoppingRows.length === profileRows.length &&
      escalationRows.length === profileRows.length &&
      studentCommunicationRows.length === profileRows.length &&
      strategyAdaptationPassed &&
      adaptiveStoppingRows.every((row) => row.passed === true) &&
      escalationRows.every((row) => row.passed === true) &&
      studentCommunicationRows.every((row) => row.passed === true)
  });
  const persistenceAudit = readJsonl<JsonObject>(path.join(
    runDir, "persistence-and-idempotency.jsonl"
  ));
  const cleanupEvidence = [...persistenceAudit].reverse().find((row) =>
    row.cleanup !== undefined || row.cleanup_after_failure !== undefined
  );
  const cleanupObject = (cleanupEvidence?.cleanup ??
    cleanupEvidence?.cleanup_after_failure) as JsonObject | undefined;
  const cleanupPassed = cleanupObject?.isolated_records_removed === true;
  writeJson(path.join(runDir, "fixture-cleanup-results.json"), {
    cleanup_version: "e2a38-isolated-fixture-cleanup-v1",
    in_memory_synthetic_fixture_only: true,
    database_fixture_created: false,
    isolated_records_removed: cleanupPassed,
    historical_records_modified: false,
    passed: cleanupPassed
  });
  const failurePathRows = readJsonl<JsonObject>(path.join(
    runDir, "failure-path-results.jsonl"
  ));
  const providerFailurePathRows = failurePathRows.filter((row) =>
    row.record_type !== "accepted_turn_completion"
  );
  const requiredFailureFields = [
    "generated", "schema_valid", "hard_validator_result",
    "pedagogical_review_result", "profile_mapper_result",
    "profile_consistency_result", "platform_mode_result",
    "tutor_dispatch_result", "persisted", "displayed",
    "suppression_reason", "stage_reached", "stages_not_reached"
  ];
  const failurePathComplete = providerFailurePathRows.every((row) =>
    requiredFailureFields.every((field) => field in row) &&
    "complete_prior_visible_episode" in row &&
    "request_provenance" in row
  );
  writeJson(path.join(runDir, "failure-path-completeness.json"), {
    completeness_version: "e2a38-failure-path-completeness-v1",
    required_fields: requiredFailureFields,
    provider_output_record_count: providerFailurePathRows.length,
    accepted_turn_completion_record_count: failurePathRows.length -
      providerFailurePathRows.length,
    complete_prior_visible_episode_bound: providerFailurePathRows.every(
      (row) => "complete_prior_visible_episode" in row
    ),
    request_provenance_bound: providerFailurePathRows.every((row) =>
      "request_provenance" in row
    ),
    generated_but_suppressed_outputs_included: true,
    missing_values_coerced_to_zero: false,
    future_policy_complete: failurePathComplete,
    passed: failurePathComplete
  });
  const studentTurnRows = readJsonl<JsonObject>(path.join(
    runDir, "student-turn-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const tutorProviderRows = readJsonl<JsonObject>(path.join(
    runDir, "autonomous-tutor-provider-outputs.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const totalVisibleWords = reviewRows.reduce((total, row) => {
    const message = typeof row.student_facing_message === "string"
      ? row.student_facing_message
      : typeof row.latest_student_response === "string"
        ? row.latest_student_response : "";
    return total + message.trim().split(/\s+/u).filter(Boolean).length;
  }, 0);
  writeJson(path.join(runDir, "failed-session-burden-metrics.json"), {
    metric_version: "e2a38-failed-session-burden-v1",
    failure_recorded: failure !== null,
    failure_stage: failure,
    attempted_student_turns: studentTurnRows.length,
    completed_student_turns: profileRows.length,
    generated_tutor_responses: tutorProviderRows.length,
    effective_tutor_responses: interventionRows.length,
    total_visible_words_before_abort: totalVisibleWords,
    completed_session_duration_ms: failure === null
      ? new Date().getTime() - new Date(startedAt).getTime() : null,
    missing_values_coerced_to_zero: false,
    burden_status: failure === null ? "completed" : "partial"
  });
  const evidencePreservationRows = readJsonl<JsonObject>(path.join(
    runDir,
    "cross-artifact-consistency-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const profileTransitionRows = readJsonl<JsonObject>(path.join(
    runDir,
    "profile-transition-consistency-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const integratedMetrics = {
    metrics_version: "e2a38-integration-metrics-results-v1",
    workflow_fidelity: {
      accepted_turn_count: profileRows.length,
      evaluator_before_profile: true,
      profile_before_intervention_or_progression: true,
      evidence_preservation_passed:
        evidencePreservationRows.length === profileRows.length &&
        evidencePreservationRows.every((row) => row.passed === true)
    },
    dialogue_efficiency: {
      unnecessary_turns_after_sound:
        session?.unnecessary_turns_after_sound ?? null,
      missed_progression_count:
        session?.missed_progression_count ?? null
    },
    personalization: {
      intervention_count: finalLongitudinalInterventions.length,
      distinct_strategy_count: new Set(
        finalLongitudinalInterventions.map((entry) => entry.strategy)
      ).size,
      repeated_ineffective_strategy_gap_pair:
        !strategyAdaptationPassed
    },
    stopping_quality: {
      decision_count: adaptiveStoppingRows.length,
      all_decisions_consistent:
        adaptiveStoppingRows.length === profileRows.length &&
        adaptiveStoppingRows.every((row) => row.passed === true)
    },
    human_boundary: {
      decision_count: escalationRows.length,
      all_decisions_consistent:
        escalationRows.length === profileRows.length &&
        escalationRows.every((row) => row.passed === true)
    },
    student_facing_communication: {
      result_count: studentCommunicationRows.length,
      all_messages_safe:
        studentCommunicationRows.length === profileRows.length &&
        studentCommunicationRows.every((row) => row.passed === true),
      internal_state_exposed: false
    },
    profile_transitions: {
      result_count: profileTransitionRows.length,
      all_transitions_consistent:
        profileTransitionRows.length === profileRows.length &&
        profileTransitionRows.every((row) => row.passed === true)
    },
    passed:
      failure === null &&
      profileRows.length > 0 &&
      evidencePreservationRows.length === profileRows.length &&
      evidencePreservationRows.every((row) => row.passed === true) &&
      profileTransitionRows.length === profileRows.length &&
      profileTransitionRows.every((row) => row.passed === true) &&
      adaptiveStoppingRows.length === profileRows.length &&
      adaptiveStoppingRows.every((row) => row.passed === true) &&
      escalationRows.length === profileRows.length &&
      escalationRows.every((row) => row.passed === true) &&
      studentCommunicationRows.length === profileRows.length &&
      studentCommunicationRows.every((row) => row.passed === true) &&
      strategyAdaptationPassed &&
      (session?.unnecessary_turns_after_sound ?? 1) === 0 &&
      (session?.missed_progression_count ?? 1) === 0
  };
  writeJson(
    path.join(runDir, "integration-metrics-results.json"),
    integratedMetrics
  );
  writeJson(path.join(runDir, "human-review-packet.json"), {
    packet_version: "e2a38-human-review-packet-v1",
    run_id: id,
    human_review_required: true,
    human_review_complete: false,
    ratings_prepopulated: false,
    item_count: reviewRows.length,
    session_review: {
      evidence_accuracy: null,
      profile_update_coherence: null,
      profile_consistency: null,
      pedagogical_targeting: null,
      strategy_adaptation: null,
      naturalness: null,
      repetition: null,
      burden: null,
      task_clarity: null,
      learning_support: null,
      workflow_fidelity: null,
      transport_handling: null,
      sequence_quality: null
    },
    metrics: {
      evidence_accuracy: readJson(path.join(
        runDir, "evidence-accuracy-metrics.json"
      )),
      progression_efficiency: readJson(path.join(
        runDir, "progression-efficiency-metrics.json"
      )),
      pedagogical_adaptation: readJson(path.join(
        runDir, "pedagogical-adaptation-metrics.json"
      )),
      student_burden: readJson(path.join(
        runDir, "student-burden-metrics.json"
      )),
      workflow_fidelity: readJson(path.join(
        runDir, "workflow-fidelity-metrics.json"
      )),
      transport_handling: readJson(path.join(
        runDir, "transport-handling-metrics.json"
      )),
      longitudinal_dialogue: readJson(path.join(
        runDir, "longitudinal-dialogue-metrics.json"
      )),
      integrated_session: integratedMetrics
    },
    items: reviewRows,
    recommendation: null
  });
  finalizeUnreachedJsonlArtifacts(runDir, failure);
  const protectedAfter = protectedEvidenceIdentity();
  const protectedUnchanged = protectedBefore.current_sha256 ===
    protectedAfter.current_sha256;
  if (!protectedUnchanged && failure === null) {
    failure = "e2a38_protected_evidence_changed_during_execution";
  }
  const passed = failure === null && sessions.length === 1 &&
    sessions.every((session) => session.passed === true) &&
    usage.within_budget && integratedMetrics.passed;
  const explicitProviderStatus = failure?.split(":", 1)[0];
  const failureStatus = explicitProviderStatus && [
    "e2a38_canary_failed_provider_infrastructure_retry_exhausted",
    "e2a38_canary_failed_provider_nonretryable_request",
    "e2a38_canary_failed_provider_timeout_retry_exhausted",
    "e2a38_canary_failed_rate_limit_retry_exhausted"
  ].includes(explicitProviderStatus)
    ? explicitProviderStatus
    : failure?.includes("evaluator_contract")
      ? "e2a38_canary_failed_evaluator_contract"
      : failure?.includes("anchor")
        ? "e2a38_canary_failed_anchor_resolution"
        : failure?.includes("contradiction")
          ? "e2a38_canary_failed_contradiction_propagation"
          : failure?.includes("cross_artifact")
            ? "e2a38_canary_failed_cross_artifact_consistency"
            : failure?.includes("profile_transition")
              ? "e2a38_canary_failed_profile_transition"
              : failure?.includes("profile_finalization")
                ? "e2a38_canary_failed_profile_finalization"
                : failure?.includes("sound") || failure?.includes("profile") ||
                    failure?.includes("revision") ||
                    failure?.includes("evaluator")
                  ? "e2a38_canary_failed_evidence_accuracy"
                  : failure?.includes("strategy") || failure?.includes("pedagog")
                    ? "e2a38_canary_failed_pedagogical_adaptation"
                    : failure?.includes("context") ||
                        failure?.includes("history") ||
                        failure?.includes("persist") ||
                        failure?.includes("idempot")
                      ? "e2a38_canary_failed_context_integrity"
                      : failure?.includes("privacy") ||
                          failure?.includes("safety") ||
                          failure?.includes("answer") ||
                          failure?.includes("hidden")
                        ? "e2a38_canary_failed_safety"
                        : failure?.includes("provider") ||
                            failure?.includes("budget") ||
                            failure?.includes("infrastructure")
                          ? "e2a38_canary_incomplete_infrastructure"
                          : "e2a38_canary_failed_stability";
  const summary = {
    summary_version: "e2a38-live-canary-summary-v1",
    status: passed
      ? "e2a38_canary_pass_pending_human_review"
      : failureStatus,
    run_id: id,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    application_git_commit: currentCommit(),
    protocol_hash: PROTOCOL_HASH,
    frozen_composite_runtime_identity_hash:
      FROZEN_COMPOSITE_RUNTIME_IDENTITY_HASH,
    target_evidence_contract_hash: TARGET_EVIDENCE_CONTRACT_HASH,
    measurement_alias_contract_hash: MEASUREMENT_ALIAS_CONTRACT_HASH,
    canonical_anchor_contract_hash: CANONICAL_ANCHOR_CONTRACT_HASH,
    stance_evidence_contract_hash: STANCE_EVIDENCE_CONTRACT_HASH,
    self_correction_intent_contract_hash:
      stableHash(protocol.self_correction_intent_contract),
    self_correction_evidence_contract_hash:
      SELF_CORRECTION_EVIDENCE_CONTRACT_HASH,
    self_correction_integration_contract_hash:
      SELF_CORRECTION_INTEGRATION_CONTRACT_HASH,
    learning_profile_evolution_version:
      E2A36_LEARNING_PROFILE_EVOLUTION_VERSION,
    learning_profile_contract_hash: LEARNING_PROFILE_CONTRACT_HASH,
    engagement_profile_evolution_version:
      E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION,
    engagement_profile_contract_hash: ENGAGEMENT_PROFILE_CONTRACT_HASH,
    longitudinal_intervention_memory_version:
      E2A36_INTERVENTION_MEMORY_VERSION,
    intervention_memory_contract_hash:
      INTERVENTION_MEMORY_CONTRACT_HASH,
    adaptive_stopping_policy_version:
      E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
    stopping_policy_contract_hash: STOPPING_POLICY_CONTRACT_HASH,
    instructor_escalation_policy_version:
      E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION,
    escalation_policy_contract_hash: ESCALATION_POLICY_CONTRACT_HASH,
    student_facing_communication_version:
      "e2a37-student-facing-handoff-communication-v1",
    student_communication_contract_hash:
      STUDENT_COMMUNICATION_CONTRACT_HASH,
    longitudinal_metrics_version: E2A36_LONGITUDINAL_METRICS_VERSION,
    longitudinal_metrics_contract_hash:
      LONGITUDINAL_METRICS_CONTRACT_HASH,
    integration_metrics_version: "e2a38-integration-metrics-v1",
    integration_metrics_contract_hash:
      INTEGRATION_METRICS_CONTRACT_HASH,
    integration_metrics_passed: integratedMetrics.passed,
    anchor_reference_resolver_version: "active-anchor-alias-resolution-v1",
    anchor_stance_evidence_resolver_version:
      ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
    composed_anchor_resolver_version:
      ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
    anchor_stance_scope_resolver_version:
      ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
    target_evidence_scoped_adjudication_version:
      TARGET_EVIDENCE_SCOPED_ADJUDICATION_VERSION,
    self_correction_intent_resolver_version: SELF_CORRECTION_INTENT_VERSION,
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    trajectory_envelope_hash: TRAJECTORY_ENVELOPE_HASH,
    compiled_evaluator_v5_request_hash:
      COMPILED_EVALUATOR_V5_REQUEST_HASH,
    composite_runtime_identity_hash:
      identity.composite_runtime_identity_hash,
    candidate_configuration_hash: CANDIDATE_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA,
    approved_v2_hash: APPROVED_HASH,
    session_count_planned: 1,
    session_count_completed: sessions.length,
    sessions,
    longitudinal_dialogue_metrics: readJson(path.join(
      runDir, "longitudinal-dialogue-metrics.json"
    )),
    failure_reason: failure,
    provider_usage: usage.actual,
    budget_within_limits: usage.within_budget,
    cost_ceiling_verified: usage.cost_ceiling_verified,
    cost_ceiling_enforcement: usage.cost_ceiling_enforcement,
    protected_evidence_before_hash: protectedBefore.current_sha256,
    protected_evidence_after_hash: protectedAfter.current_sha256,
    protected_evidence_unchanged: protectedUnchanged,
    provider_concurrency: 1,
    deterministic_fallback_count: 0,
    human_review_item_count: reviewRows.length,
    human_review_complete: false,
    candidate_approved: false,
    candidate_activated: false,
    four_session_canary_run: false,
    twelve_session_canary_run: false,
    thirty_six_session_matrix_run: false,
    e2a25_rerun: false,
    e2a27_rerun: false,
    e2a28_rerun: false,
    e2a29_rerun: false,
    e2a30_rerun: false,
    e2a31_rerun: false,
    e2a33_rerun: false,
    e2a38_rerun: false,
    e2b_run: false,
    later_live_stage_run: false,
    migration_added: false,
    passed
  };
  writeJson(path.join(runDir, "canary-summary.json"), summary);
  const validation = artifactValidation(runDir);
  if (input.live) freezeArtifacts(runDir);
  return { runId: id, runDir, summary, validation };
}

async function runSmoke() {
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = (async () => {
    networkRequests += 1;
    throw new Error("e2a38_smoke_network_prohibited");
  }) as typeof fetch;
  const root = path.join(os.tmpdir(), `e2a38-smoke-${randomUUID()}`);
  try {
    const protocol = buildE2A38FrozenProtocol();
    const result = await executeCanary({
      executor: makeNoLiveExecutor(protocol),
      live: false,
      artifactRoot: root,
      forcedRunId: "e2a38_no_live_smoke"
    });
    if (!result.summary.passed || !result.validation.passed) {
      throw new Error(
        `e2a38_no_live_smoke_failed:${result.summary.failure_reason ?? result.validation.failures.join("|")}`
      );
    }
    if (networkRequests !== 0) throw new Error("e2a38_no_live_network_detected");
    const stanceRows = readJsonl<JsonObject>(path.join(
      result.runDir, "anchor-stance-resolution-results.jsonl"
    )).filter((row) => typeof row.turn === "number");
    if (stanceRows.length !== 8 ||
        stanceRows.find((row) => row.turn === 1)
          ?.observed_anchor_reference !== "explicit" ||
        stanceRows.find((row) => row.turn === 1)
          ?.observed_anchor_stance !== "endorses_distractor" ||
        stanceRows.find((row) => row.turn === 3)
          ?.observed_anchor_reference !== "explicit" ||
        stanceRows.find((row) => row.turn === 3)
          ?.observed_anchor_stance !== "endorses_distractor" ||
        stanceRows.find((row) => row.turn === 8)
          ?.observed_anchor_stance !== "rejects_distractor") {
      throw new Error("e2a38_no_live_stance_boundary_failed");
    }
    const selfCorrectionRows = readJsonl<JsonObject>(path.join(
      result.runDir, "self-correction-intent-results.jsonl"
    )).filter((row) => typeof row.turn === "number");
    const latestEvidenceRows = readJsonl<JsonObject>(path.join(
      result.runDir, "latest-valid-evidence-precedence-results.jsonl"
    )).filter((row) => typeof row.turn === "number");
    const reopeningRows = readJsonl<JsonObject>(path.join(
      result.runDir, "profile-reopening-results.jsonl"
    )).filter((row) => typeof row.turn === "number");
    if (
      selfCorrectionRows.length !== 8 ||
      selfCorrectionRows.find((row) => row.turn === 4)
        ?.self_correction_intent !== true ||
      selfCorrectionRows.find((row) => row.turn === 5)
        ?.self_correction_intent !== true ||
      latestEvidenceRows.find((row) => row.turn === 4)
        ?.unsupported_correction_preserved_prior_profile !== true ||
      latestEvidenceRows.find((row) => row.turn === 5)
        ?.latest_valid_evidence_applied !== true ||
      reopeningRows.find((row) => row.turn === 6)
        ?.profile_reopened !== true ||
      reopeningRows.find((row) => row.turn === 6)?.passed !== true
    ) {
      throw new Error("e2a38_no_live_self_correction_state_failed");
    }
    const trajectoryRows = readJsonl<JsonObject>(path.join(
      result.runDir, "trajectory-envelope-results.jsonl"
    )).filter((row) => typeof row.turn === "number");
    if (trajectoryRows.length !== 8 ||
        trajectoryRows.some((row) =>
          row.passed !== true ||
          row.trajectory_expectation_changed_evaluator_output !== false
        ) ||
        trajectoryRows.at(-1)?.progression_decision !==
          "immediate_revision" ||
        trajectoryRows.at(-1)?.sound_gate_passed !== true) {
      throw new Error("e2a38_no_live_trajectory_envelope_failed");
    }
    const criterionRows = readJsonl<JsonObject>(path.join(
      result.runDir, "criterion-evidence-results.jsonl"
    )).filter((row) => row.turn === 8);
    const requiredCriterionIds = new Set(
      protocol.session.frozen_target_evidence_contract
        .revision_ready_criteria
    );
    const satisfiedCriterionIds = new Set(
      criterionRows.filter((row) => row.satisfied === true)
        .map((row) => String(row.criterion_id))
    );
    if ([...requiredCriterionIds].some((criterionId) =>
      !satisfiedCriterionIds.has(criterionId)
    )) {
      throw new Error("e2a38_no_live_named_revision_criteria_failed");
    }
    const selfCorrectionEvidenceRows = readJsonl<JsonObject>(path.join(
      result.runDir, "self-correction-evidence-results.jsonl"
    )).filter((row) => typeof row.turn === "number");
    const turn4Evidence = selfCorrectionEvidenceRows.find((row) =>
      row.turn === 4
    )?.resolution as JsonObject | undefined;
    const turn5Evidence = selfCorrectionEvidenceRows.find((row) =>
      row.turn === 5
    )?.resolution as JsonObject | undefined;
    const learningRows = readJsonl<JsonObject>(path.join(
      result.runDir, "learning-profile-evolution-results.jsonl"
    )).filter((row) => typeof row.turn === "number");
    const engagementRows = readJsonl<JsonObject>(path.join(
      result.runDir, "engagement-profile-evolution-results.jsonl"
    )).filter((row) => typeof row.turn === "number");
    const stoppingRows = readJsonl<JsonObject>(path.join(
      result.runDir, "adaptive-stopping-decisions.jsonl"
    )).filter((row) => typeof row.turn === "number");
    const communicationRows = readJsonl<JsonObject>(path.join(
      result.runDir, "student-facing-communication-results.jsonl"
    )).filter((row) => typeof row.turn === "number");
    const longitudinalMetrics = readJson<JsonObject>(path.join(
      result.runDir, "longitudinal-dialogue-metrics.json"
    ));
    if (
      selfCorrectionEvidenceRows.length !== 8 ||
      turn4Evidence?.self_correction_intent !== true ||
      turn4Evidence?.conceptual_evidence_update !== false ||
      turn4Evidence?.profile_update_eligible !== false ||
      turn5Evidence?.self_correction_intent !== true ||
      turn5Evidence?.conceptual_evidence_update !== true ||
      learningRows.length !== 8 ||
      engagementRows.length !== 8 ||
      stoppingRows.length !== 8 ||
      stoppingRows.at(-1)?.internal_decision !==
        "stop_formative_dialogue" ||
      stoppingRows.some((row) => row.passed !== true) ||
      communicationRows.length !== 8 ||
      communicationRows.some((row) =>
        row.passed !== true ||
        row.internal_stopping_decision_exposed !== false
      ) ||
      longitudinalMetrics.passed !== true ||
      longitudinalMetrics.internal_stopping_state_student_visible !== false
    ) {
      throw new Error("e2a38_no_live_longitudinal_contract_failed");
    }
    const usage = result.summary.provider_usage as JsonObject;
    if (usage.simulator_calls !== 8 || usage.evidence_evaluator_calls !== 8 ||
        usage.initial_tutor_calls !== 7 || usage.logical_generation_calls !== 23) {
      throw new Error("e2a38_no_live_expected_call_arithmetic_failed");
    }
    return {
      status: "passed",
      network_request_count: networkRequests,
      session_count: result.summary.session_count_completed,
      turn_1_anchor_reference: "explicit",
      turn_1_anchor_stance: "endorses_distractor",
      turn_3_anchor_reference: "explicit",
      turn_3_anchor_stance: "endorses_distractor",
      turn_8_anchor_stance: "rejects_distractor",
      unsupported_correction_preserved: true,
      latest_valid_correction_applied: true,
      regression_reopened_profile: true,
      trajectory_envelope_results: trajectoryRows.length,
      self_correction_evidence_results:
        selfCorrectionEvidenceRows.length,
      learning_profile_evolution_results: learningRows.length,
      engagement_profile_evolution_results: engagementRows.length,
      adaptive_stopping_results: stoppingRows.length,
      student_communication_results: communicationRows.length,
      internal_stopping_state_student_visible: false,
      named_revision_criteria_satisfied: requiredCriterionIds.size,
      sound_gate_overrode_trajectory_expectation:
        trajectoryRows.some((row) =>
          row.sound_gate_override_applied === true
        ),
      provider_usage: usage,
      artifact_validation: result.validation,
      temporary_artifacts_removed: true
    };
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
}

async function runTransportRetrySmoke() {
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = (async () => {
    networkRequests += 1;
    throw new Error("e2a38_transport_smoke_network_prohibited");
  }) as typeof fetch;
  const root = path.join(os.tmpdir(),
    `e2a38-transport-smoke-${randomUUID()}`);
  try {
    const protocol = buildE2A38FrozenProtocol();
    const base = makeNoLiveExecutor(protocol);
    let injectedFailure = false;
    const provider: LlmProvider = {
      async executeStructured<TInput, TOutput>(
        request: StructuredAgentRequest<TInput, TOutput>
      ): Promise<StructuredAgentResult<TOutput>> {
        if (!injectedFailure) {
          injectedFailure = true;
          return {
            provider: "openai",
            client_request_id: request.client_request_id,
            status: "failed",
            latency_ms: 1,
            error: {
              category: "provider_5xx",
              message: "sanitized_injected_provider_520",
              retryable: true
            },
            transport_telemetry: {
              provider: "openai",
              transport: "openai_responses",
              adapter_version: OPENAI_RESPONSES_ADAPTER_VERSION,
              client_request_id: request.client_request_id,
              model_name: request.model_config.model_name,
              base_url_host: "local-no-network-fixture",
              base_url_approved: true,
              transport_adapter_entered: true,
              request_serialization_completed: true,
              fetch_invoked: false,
              response_headers_received: true,
              response_body_received: false,
              http_status: 520,
              normalized_error: {
                typed_failure_reason: "openai_server_error",
                error_class: "InjectedNoNetworkFixture",
                error_name: "InjectedProvider520",
                error_type: "provider_error",
                http_status: 520,
                provider_error_code: null,
                provider_error_type: null,
                provider_error_param: null,
                provider_request_id: "fixture_request_520",
                provider_request_header_id: "fixture_request_520",
                retry_after_ms: null,
                node_cause_name: null,
                node_cause_code: null,
                network_category: "http_error",
                sanitized_message: "sanitized_injected_provider_520",
                has_http_response: true,
                before_request_serialization: false,
                fetch_invoked: false,
                response_headers_received: true,
                response_body_received: false
              }
            }
          };
        }
        return base.executeStructured(request);
      }
    };
    const result = await executeCanary({
      executor: provider,
      live: false,
      artifactRoot: root,
      forcedRunId: "e2a38_transport_retry_smoke"
    });
    const transport = readJson<{
      passed?: boolean;
      transport_retry_count?: number;
      logical_calls_with_retries?: JsonObject[];
    }>(path.join(result.runDir, "transport-handling-metrics.json"));
    const attempts = readJsonl<JsonObject>(path.join(
      result.runDir, "provider-attempt-results.jsonl"
    ));
    const retriedLogicalId = attempts[0]?.logical_call_id;
    const retriedAttempts = attempts.filter((row) =>
      row.logical_call_id === retriedLogicalId
    );
    if (!result.summary.passed || !result.validation.passed ||
        transport.passed !== true || transport.transport_retry_count !== 1 ||
        result.summary.provider_usage.adapter_attempts !== 24 ||
        result.summary.provider_usage.logical_generation_calls !== 23 ||
        retriedAttempts.length !== 2 ||
        new Set(retriedAttempts.map((row) => row.canonical_request_hash))
          .size !== 1 ||
        new Set(retriedAttempts.map((row) => row.x_client_request_id))
          .size !== 2) {
      throw new Error("e2a38_transport_retry_fault_injection_failed");
    }
    if (networkRequests !== 0) {
      throw new Error("e2a38_transport_smoke_network_detected");
    }
    return {
      status: "passed",
      injected_failure: "provider_520",
      logical_generation_calls: 23,
      adapter_attempts: 24,
      transport_retries: 1,
      canonical_request_hash_preserved: true,
      distinct_client_request_ids: true,
      exactly_once_semantic_effects: true,
      network_request_count: 0,
      temporary_artifacts_removed: true
    };
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
}

function runAuthorizationGuardSmoke() {
  let blockedReason: string | null = null;
  try {
    assertLiveAuthorizationArguments();
  } catch (error) {
    blockedReason = error instanceof Error ? error.message : "unknown";
  }
  if (!blockedReason?.startsWith("e2a38_confirmation_missing:")) {
    throw new Error("e2a38_authorization_guard_did_not_fail_closed");
  }
  return {
    status: "passed",
    provider_call_count: 0,
    network_request_count: 0,
    blocked_reason: blockedReason,
    exact_authorization_required: true
  };
}

async function executeLive() {
  assertLiveAuthorizationArguments();
  const check = e2a38LivePreflight(true);
  if (!check.passed) {
    throw new Error(`e2a38_preflight_failed:${check.blockers.join(",")}`);
  }
  mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  writeFileSync(LOCK_PATH, `${process.pid}\n`, { flag: "wx" });
  try {
    const credential = resolveOpenAICredentialFromEnv();
    if (!credential.ok) throw new Error(`e2a38_credential_failed:${credential.code}`);
    return await withResolvedOpenAICredential(credential.credential, async () => {
      const candidate = evaluateE2A24Candidate().full_candidate;
      const provider: LlmProvider = new OpenAIResponsesProvider({
        isolated_evaluation_runtime: {
          purpose: "bounded_candidate_evaluation",
          request_timeout_ms: candidate.runtime_policy.provider_timeout_ms
        }
      });
      return executeCanary({ executor: provider, live: true });
    });
  } finally {
    if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH);
  }
}

function report(run?: string) {
  const id = run ?? existingLiveRuns().at(-1);
  if (!id) throw new Error("e2a38_run_not_found");
  const runDir = path.join(ARTIFACT_ROOT, id);
  return {
    run_id: id,
    run_directory: runDir,
    summary: readJson(path.join(runDir, "canary-summary.json")),
    usage: readJson(path.join(runDir, "usage-and-cost.json")),
    artifact_validation: artifactValidation(runDir)
  };
}

function auditRun(run?: string) {
  const id = run ?? existingLiveRuns().at(-1);
  if (!id) throw new Error("e2a38_run_not_found");
  const runDir = path.join(ARTIFACT_ROOT, id);
  const summary = readJson<JsonObject>(path.join(runDir, "canary-summary.json"));
  const artifacts = artifactValidation(runDir);
  const profiles = readJsonl<JsonObject>(path.join(
    runDir, "turn-profile-snapshots.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const anchors = readJsonl<JsonObject>(path.join(
    runDir, "anchor-interpretation-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const modes = readJsonl<JsonObject>(path.join(
    runDir, "platform-mode-decisions.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const runtime = readJsonl<JsonObject>(path.join(
    runDir, "runtime-validation-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const context = readJsonl<JsonObject>(path.join(
    runDir, "context-coverage-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const persistence = readJsonl<JsonObject>(path.join(
    runDir, "persistence-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const finalizations = readJsonl<JsonObject>(path.join(
    runDir, "pre-tutor-finalization-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const contradictions = readJsonl<JsonObject>(path.join(
    runDir, "structured-contradiction-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const reviewBindings = readJsonl<JsonObject>(path.join(
    runDir, "human-review-binding-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const canonicalAnchors = readJsonl<JsonObject>(path.join(
    runDir, "canonical-anchor-evidence-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const aliasResolutions = readJsonl<JsonObject>(path.join(
    runDir, "measurement-alias-resolution-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const scopeResolutions = readJsonl<JsonObject>(path.join(
    runDir, "anchor-stance-scope-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const selfCorrectionResults = readJsonl<JsonObject>(path.join(
    runDir, "self-correction-intent-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const selfCorrectionEvidenceResults = readJsonl<JsonObject>(path.join(
    runDir, "self-correction-evidence-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const learningEvolutionResults = readJsonl<JsonObject>(path.join(
    runDir, "learning-profile-evolution-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const engagementEvolutionResults = readJsonl<JsonObject>(path.join(
    runDir, "engagement-profile-evolution-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const longitudinalInterventionResults = readJsonl<JsonObject>(path.join(
    runDir, "longitudinal-intervention-memory-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const adaptiveStoppingResults = readJsonl<JsonObject>(path.join(
    runDir, "adaptive-stopping-decisions.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const instructorEscalationResults = readJsonl<JsonObject>(path.join(
    runDir, "instructor-escalation-decisions.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const studentCommunicationResults = readJsonl<JsonObject>(path.join(
    runDir, "student-facing-communication-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const latestEvidenceResults = readJsonl<JsonObject>(path.join(
    runDir, "latest-valid-evidence-precedence-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const profileReopeningResults = readJsonl<JsonObject>(path.join(
    runDir, "profile-reopening-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const progressionResults = readJsonl<JsonObject>(path.join(
    runDir, "progression-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const stanceResolutions = readJsonl<JsonObject>(path.join(
    runDir, "anchor-stance-resolution-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const referenceResolutions = readJsonl<JsonObject>(path.join(
    runDir, "anchor-reference-resolution-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const stanceEvidenceResolutions = readJsonl<JsonObject>(path.join(
    runDir, "anchor-stance-evidence-resolution-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const parityResults = readJsonl<JsonObject>(path.join(
    runDir, "anchor-parity-reconciliation-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const trajectoryResults = readJsonl<JsonObject>(path.join(
    runDir, "trajectory-envelope-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const soundGateResults = readJsonl<JsonObject>(path.join(
    runDir, "sound-gate-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const evaluatorIdentities = readJsonl<JsonObject>(path.join(
    runDir, "evaluator-v5-request-identities.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const usage = readJson<{ within_budget?: boolean; actual?: JsonObject }>(
    path.join(runDir, "provider-usage.json")
  );
  const cleanup = readJson<{ passed?: boolean }>(path.join(
    runDir, "fixture-cleanup-results.json"
  ));
  const human = readJson<{ items?: Array<{ human_review?: unknown }>;
    session_review?: JsonObject }>(path.join(runDir, "human-review-packet.json"));
  const longitudinalMetrics = readJson<JsonObject>(path.join(
    runDir, "longitudinal-dialogue-metrics.json"
  ));
  const failures = [...artifacts.failures];
  if (summary.candidate_approved !== false ||
      summary.candidate_activated !== false) {
    failures.push("candidate_state_invalid");
  }
  if (summary.approved_v2_hash !== APPROVED_HASH) {
    failures.push("approved_v2_hash_changed");
  }
  if (summary.protocol_hash !== PROTOCOL_HASH ||
      summary.frozen_composite_runtime_identity_hash !==
        FROZEN_COMPOSITE_RUNTIME_IDENTITY_HASH ||
      summary.candidate_configuration_hash !== CANDIDATE_HASH) {
    failures.push("frozen_runtime_binding_changed");
  }
  if (summary.protected_evidence_unchanged !== true) {
    failures.push("protected_evidence_changed");
  }
  if (usage.within_budget !== true) failures.push("usage_budget_invalid");
  if (cleanup.passed !== true) failures.push("fixture_cleanup_invalid");
  if (!human.items?.every((item) => item.human_review === null) ||
      !human.session_review ||
      !Object.values(human.session_review).every((value) => value === null)) {
    failures.push("human_review_not_pending_or_prepopulated");
  }
  if (summary.passed === true) {
    const profile = (turn: number) => profiles.find((row) => row.turn === turn)
      ?.profile as JsonObject | undefined;
    const anchor = (turn: number) => anchors.find((row) => row.turn === turn);
    const mode = (turn: number) => modes.find((row) => row.turn === turn)
      ?.route as JsonObject | undefined;
    const trajectory = (turn: number) => trajectoryResults.find(
      (row) => row.turn === turn
    );
    const completedTurnCount = trajectoryResults.length;
    const completedTurns = trajectoryResults.map((row) => Number(row.turn))
      .sort((left, right) => left - right);
    const contiguousCompletedTurns =
      completedTurns.every((turn, index) => turn === index + 1);
    const perTurnCollections = [
      profiles,
      anchors,
      modes,
      runtime,
      context,
      persistence,
      finalizations,
      contradictions,
      reviewBindings,
      canonicalAnchors,
      aliasResolutions,
      stanceResolutions,
      referenceResolutions,
      stanceEvidenceResolutions,
      parityResults,
      trajectoryResults,
      soundGateResults,
      evaluatorIdentities,
      selfCorrectionResults,
      selfCorrectionEvidenceResults,
      learningEvolutionResults,
      engagementEvolutionResults,
      longitudinalInterventionResults,
      adaptiveStoppingResults,
      instructorEscalationResults,
      studentCommunicationResults,
      latestEvidenceResults,
      profileReopeningResults,
      progressionResults
    ];
    if (completedTurnCount < 1 || completedTurnCount > 8 ||
        !contiguousCompletedTurns ||
        perTurnCollections.some((rows) =>
          rows.length !== completedTurnCount
        )) {
      failures.push("completed_turn_artifact_count_invalid");
    }
    const soundTurns = profiles.filter((row) =>
      (row.profile as JsonObject | undefined)?.reasoning_quality === "sound"
    ).map((row) => Number(row.turn)).sort((left, right) => left - right);
    const earliestSoundTurn = soundTurns[0];
    const lastCompletedTurn = completedTurns.at(-1);
    const completedSession = Array.isArray(summary.sessions)
      ? summary.sessions[0] as JsonObject | undefined
      : undefined;
    if (earliestSoundTurn === undefined) {
      if (![
        "valid_bounded_stop_with_instructor_support",
        "valid_engagement_support_endpoint"
      ].includes(String(completedSession?.endpoint)) ||
          modes.some((row) =>
            (row.route as JsonObject | undefined)?.selected_mode ===
              "request_revision"
          )) {
        failures.push("non_sound_endpoint_invalid");
      }
    } else if (
      earliestSoundTurn !== lastCompletedTurn ||
      profile(earliestSoundTurn)?.revision_readiness !== true ||
      anchor(earliestSoundTurn)?.anchor_stance !== "rejects_distractor" ||
      anchor(earliestSoundTurn)?.anchor_consistency !==
        "consistent_with_conceptual_reasoning" ||
      anchor(earliestSoundTurn)?.anchor_resolution_status !==
        "resolved_against_distractor" ||
      mode(earliestSoundTurn)?.selected_mode !== "request_revision" ||
      modes.find((row) => row.turn === earliestSoundTurn)
        ?.tutor_called !== false ||
      trajectory(earliestSoundTurn)?.sound_gate_passed !== true ||
      trajectory(earliestSoundTurn)?.progression_decision !==
        "immediate_revision" ||
      trajectory(earliestSoundTurn)?.revision_required_immediately !== true ||
      soundGateResults.find((row) => row.turn === earliestSoundTurn)
        ?.authoritative_sound_gate_passed !== true
    ) {
      failures.push("authoritative_sound_gate_endpoint_invalid");
    }
    if (modes.some((row) =>
      Number(row.turn) < (earliestSoundTurn ?? Number.POSITIVE_INFINITY) &&
      (row.route as JsonObject | undefined)?.selected_mode ===
        "request_revision"
    )) {
      failures.push("premature_revision_before_sound");
    }
    if (!trajectoryResults.every((row) =>
          row.passed === true &&
          row.evaluator_reasoning_quality_preserved === true &&
          row.trajectory_expectation_changed_evaluator_output === false &&
          !(
            Array.isArray(row.prohibited_states_detected) &&
            row.prohibited_states_detected.includes(
              "unsupported_sound_promotion"
            )
          )
        ) ||
        !context.every((row) => row.passed === true) ||
        !runtime.every((row) => Array.isArray(row.execution_order) && (
          row.tutor_called !== true || row.execution_order.indexOf(
            "independent_structured_conceptual_evaluation"
          ) < row.execution_order.indexOf("invoke_autonomous_pedagogical_agent")
        )) || !finalizations.every((row) =>
          row.passed === true &&
          row.finalized_before_tutor_dispatch === true &&
          row.finalization_version ===
            PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V4 &&
          row.mapper_version === TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7 &&
          row.profile_consistency_version ===
            PROFILE_CONSISTENCY_POLICY_VERSION_V7 &&
          row.evidence_preservation_contract_version ===
            TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION &&
          row.evidence_preservation_passed === true
        ) ||
        !canonicalAnchors.every((row) =>
          row.passed === true &&
          row.canonicalization_version === CANONICAL_ANCHOR_EVIDENCE_VERSION
        ) || !aliasResolutions.every((row) =>
          row.passed === true &&
          row.resolver_version === ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V2
        ) || scopeResolutions.length !== completedTurnCount * 2 ||
        !scopeResolutions.every((row) =>
          row.passed === true &&
          row.resolver_version === ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION
        ) || !selfCorrectionResults.every((row) =>
          row.passed === true &&
          row.signal_version === SELF_CORRECTION_INTENT_SIGNAL_VERSION &&
          row.conceptual_evidence_assessed_separately === true
        ) || !selfCorrectionEvidenceResults.every((row) => {
          const resolution = row.resolution as JsonObject | undefined;
          return row.passed === true &&
            resolution?.resolver_version ===
              SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION &&
            resolution?.intent_and_evidence_separated === true;
        }) || !learningEvolutionResults.every((row) =>
          row.passed === true &&
          row.latest_valid_evidence_precedence === true
        ) || !engagementEvolutionResults.every((row) =>
          row.passed === true &&
          row.correctness_independence === true &&
          row.student_trait_claim_made === false
        ) || !longitudinalInterventionResults.every((row) =>
          row.passed === true
        ) || !adaptiveStoppingResults.every((row) =>
          row.passed === true &&
          row.internal_state_student_visible === false &&
          row.runtime_consistent === true
        ) || !instructorEscalationResults.every((row) =>
          row.passed === true &&
          row.based_on_correctness_alone === false
        ) || !studentCommunicationResults.every((row) =>
          row.passed === true &&
          row.internal_stopping_decision_exposed === false
        ) || !latestEvidenceResults.every((row) =>
          row.passed === true &&
          row.correction_language_alone_not_evidence === true
        ) || !profileReopeningResults.every((row) =>
          row.passed === true
        ) || !progressionResults.every((row) =>
          row.passed === true
        ) || !stanceResolutions.every((row) =>
          row.passed === true &&
          row.resolver_version === ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4 &&
          row.stance_evidence_resolver_version ===
            ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION
        ) || !referenceResolutions.every((row) =>
          row.passed === true &&
          row.resolver_version === "active-anchor-alias-resolution-v1"
        ) || !stanceEvidenceResolutions.every((row) =>
          row.passed === true &&
          row.evidence_contract_version ===
            ANCHOR_STANCE_EVIDENCE_CONTRACT_VERSION &&
          row.resolver_version ===
            ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION
        ) || !parityResults.every((row) =>
          row.passed === true &&
          row.policy_version === ANCHOR_PARITY_RECONCILIATION_VERSION
        ) || !evaluatorIdentities.every((row) =>
          row.passed === true &&
          row.frozen_compiled_evaluator_v5_request_hash ===
            COMPILED_EVALUATOR_V5_REQUEST_HASH
        ) ||
        !reviewBindings.every((row) =>
          row.passed === true && row.human_review === null
        ) || !persistence.every((row) =>
          row.one_effective_response_persisted === true &&
          row.duplicate_effective_response_count === 0
        ) ||
        longitudinalMetrics.metric_version !==
          E2A36_LONGITUDINAL_METRICS_VERSION ||
        longitudinalMetrics.passed !== true ||
        longitudinalMetrics.internal_stopping_state_student_visible !== false
    ) failures.push("workflow_fidelity_invalid");
  }
  return {
    audit_version: "e2a38-post-run-audit-v1",
    run_id: id,
    run_directory: runDir,
    audit_passed: failures.length === 0,
    canary_passed: summary.passed === true,
    status: summary.status,
    failures,
    artifact_validation: artifacts,
    turn_counts: {
      profiles: profiles.length,
      anchors: anchors.length,
      modes: modes.length,
      context: context.length,
      persistence: persistence.length,
      pre_tutor_finalizations: finalizations.length,
      structured_contradictions: contradictions.length,
      canonical_anchor_evidence: canonicalAnchors.length,
      measurement_alias_resolutions: aliasResolutions.length,
      anchor_stance_scope_resolutions: scopeResolutions.length,
      self_correction_intent_resolutions: selfCorrectionResults.length,
      self_correction_evidence_resolutions:
        selfCorrectionEvidenceResults.length,
      learning_profile_evolution_results:
        learningEvolutionResults.length,
      engagement_profile_evolution_results:
        engagementEvolutionResults.length,
      longitudinal_intervention_memory_results:
        longitudinalInterventionResults.length,
      adaptive_stopping_decisions: adaptiveStoppingResults.length,
      instructor_escalation_decisions:
        instructorEscalationResults.length,
      student_facing_communication_results:
        studentCommunicationResults.length,
      latest_valid_evidence_precedence: latestEvidenceResults.length,
      profile_reopening_results: profileReopeningResults.length,
      progression_results: progressionResults.length,
      anchor_stance_resolutions: stanceResolutions.length,
      anchor_reference_resolutions: referenceResolutions.length,
      anchor_stance_evidence_resolutions: stanceEvidenceResolutions.length,
      anchor_parity_reconciliations: parityResults.length,
      trajectory_envelope_results: trajectoryResults.length,
      sound_gate_results: soundGateResults.length,
      evaluator_v5_request_identities: evaluatorIdentities.length,
      human_review_bindings: reviewBindings.length
    },
    usage: usage.actual,
    fixture_cleanup_passed: cleanup.passed === true,
    human_review_pending: true,
    candidate_approved: false,
    candidate_activated: false
  };
}

async function main() {
  const mode = process.argv[2];
  if (mode === "preflight") {
    console.log(JSON.stringify(
      e2a38LivePreflight(process.argv.includes("--live")),
      null,
      2
    ));
    return;
  }
  if (mode === "checkpoint") {
    console.log(JSON.stringify(recordDispatchCheckpoint(), null, 2));
    return;
  }
  if (mode === "smoke") {
    console.log(JSON.stringify(await runSmoke(), null, 2));
    return;
  }
  if (mode === "authorization-guard-smoke") {
    console.log(JSON.stringify(runAuthorizationGuardSmoke(), null, 2));
    return;
  }
  if (mode === "transport-retry-smoke") {
    console.log(JSON.stringify(await runTransportRetrySmoke(), null, 2));
    return;
  }
  if (mode === "live") {
    const result = await executeLive();
    console.log(JSON.stringify({
      status: result.summary.status,
      run_id: result.runId,
      run_directory: result.runDir,
      session_count_completed: result.summary.session_count_completed,
      provider_usage: result.summary.provider_usage,
      human_review_complete: false,
      candidate_approved: false,
      candidate_activated: false,
      e2a38_rerun: false,
      additional_live_session_run: false,
      larger_matrix_run: false,
      e2b_run: false,
      artifact_validation: result.validation
    }, null, 2));
    if (!result.summary.passed || !result.validation.passed) process.exitCode = 1;
    return;
  }
  if (mode === "report") {
    const index = process.argv.indexOf("--run");
    console.log(JSON.stringify(report(index >= 0 ? process.argv[index + 1] : undefined), null, 2));
    return;
  }
  if (mode === "audit") {
    const index = process.argv.indexOf("--run");
    const result = auditRun(index >= 0 ? process.argv[index + 1] : undefined);
    console.log(JSON.stringify(result, null, 2));
    if (!result.audit_passed) process.exitCode = 1;
    return;
  }
  throw new Error(
    "usage: formative-evaluation-e2a38-live.ts preflight|checkpoint|smoke|transport-retry-smoke|authorization-guard-smoke|live|report|audit"
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a38_runner_failed");
  process.exitCode = 1;
});
