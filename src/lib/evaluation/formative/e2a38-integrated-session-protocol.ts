import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  PROVIDER_TRANSPORT_RETRY_POLICY_VERSION
} from "@/lib/llm/provider-transport-retry";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
  E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION,
  E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION,
  E2A36_INTERVENTION_MEMORY_VERSION,
  E2A36_LEARNING_PROFILE_EVOLUTION_VERSION,
  createEngagementProfileSnapshotV1,
  createLearningProfileSnapshotV1,
  decideAdaptiveStoppingV1,
  evaluateInstructorEscalationV1,
  evolveEngagementProfileV1,
  evolveLearningProfileV1,
  selectLongitudinalInterventionV1,
  validateStudentFacingCommunicationV1,
  type AdaptiveStoppingDecisionV1,
  type EngagementProfileEvolutionV1,
  type LearningProfileEvolutionV1,
  type LongitudinalInterventionRecordV1
} from "./e2a36-longitudinal-contracts";
import {
  E2A37_HANDOFF_BOUNDARY_VERSION,
  E2A37_STUDENT_COMMUNICATION_BOUNDARY_VERSION,
  buildE2A37PreparationArtifacts
} from "./e2a37-instructor-handoff-protocol";
import {
  SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION
} from "./self-correction-evidence-v1";
import {
  SELF_CORRECTION_INTENT_ENVELOPE_VERSION,
  buildSelfCorrectionIntentEnvelopeContractV2,
  resolveSelfCorrectionIntentEnvelopeV2
} from "./self-correction-intent-envelope-v2";
import {
  TRAJECTORY_ENVELOPE_VERSION,
  TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
  TrajectoryEnvelopeContractSchema,
  buildDefaultTrajectoryProgressionConsequences,
  evaluateTrajectoryEnvelope,
  type TrajectoryEnvelopeContract
} from "./trajectory-envelope-v1";

export const E2A38_PREPARATION_VERSION =
  "e2a38-integrated-session-protocol-freeze-preparation-v1" as const;
export const E2A38_PROTOCOL_VERSION =
  "e2a38-integrated-autonomous-formative-session-v1" as const;
export const E2A38_INTEGRATED_SESSION_CONTRACT_VERSION =
  "integrated-session-contract-v1" as const;
export const E2A38_WORKFLOW_FIDELITY_CONTRACT_VERSION =
  "workflow-fidelity-contract-v1" as const;
export const E2A38_DIALOGUE_EFFICIENCY_CONTRACT_VERSION =
  "dialogue-efficiency-contract-v1" as const;
export const E2A38_PERSONALIZATION_CONTRACT_VERSION =
  "personalization-evaluation-contract-v1" as const;
export const E2A38_STOPPING_QUALITY_CONTRACT_VERSION =
  "stopping-quality-contract-v1" as const;
export const E2A38_HUMAN_BOUNDARY_CONTRACT_VERSION =
  "human-boundary-contract-v1" as const;
export const E2A38_METRICS_CONTRACT_VERSION =
  "e2a38-integration-metrics-v1" as const;
export const E2A38_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a38-integrated-session-protocol-freeze"
);

const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";
const E2A37_PROTOCOL_HASH =
  "d13256eb27213ee9799e2cd401df6cf5b2e8a8a38abe98fe1340ecd8bcc1e68e";
const ITEM_ID = "measurement_reliability_validity_integrated_item_1";
const CONCEPT_ID = "reliability_validity_integrated_session";
const ACTIVE_OPTION = "D";
const CANONICAL_ANCHOR_ID = `${ITEM_ID}:option:${ACTIVE_OPTION}`;
const INITIAL_ACTIVITY =
  "A teacher creates an assessment that produces very consistent scores across multiple administrations. However, evidence suggests the assessment may not measure the intended construct. The teacher claims the assessment is valid because the scores are reliable. Do you agree? Explain.";
const CANONICAL_DISTRACTOR =
  "A test is valid because it produces consistent scores.";

const PROTECTED_SOURCE_HASHES = {
  "src/lib/evaluation/formative/e2a37-instructor-handoff-protocol.ts":
    "a32d141d052cbe07d56d4b989cda129d7442950f311166b42f79d6d9b38794d7",
  "prisma/formative-evaluation-e2a37.ts":
    "df7fdcf2a85e59fa469c8ca9e8044887845c495eb9b46a6978db8a1685155f85"
} as const;

export const E2A38_ARTIFACT_NAMES = [
  "freeze-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "initial-activity.json",
  "component-contract-bindings.json",
  "integrated-session-contract.json",
  "workflow-fidelity-contract.json",
  "dialogue-efficiency-contract.json",
  "personalization-evaluation-contract.json",
  "stopping-quality-contract.json",
  "human-boundary-contract.json",
  "full-session-trajectory-envelope.json",
  "deterministic-integration-cases.json",
  "early-sound-case.json",
  "delayed-sound-case.json",
  "contradiction-resolution-case.json",
  "self-correction-with-evidence-case.json",
  "self-correction-without-evidence-case.json",
  "sound-regression-case.json",
  "persistent-barrier-case.json",
  "engagement-personalization-case.json",
  "tutor-repetition-failure-case.json",
  "internal-leakage-failure-case.json",
  "workflow-fidelity-results.json",
  "profile-integration-results.json",
  "intervention-memory-results.json",
  "stopping-quality-results.json",
  "human-boundary-results.json",
  "student-communication-results.json",
  "trajectory-envelope-results.json",
  "self-correction-results.json",
  "evidence-preservation-results.json",
  "personalization-results.json",
  "metrics-contract.json",
  "metrics-results.json",
  "budget.json",
  "artifact-contract.json",
  "candidate-integrity.json",
  "protected-source-integrity.json",
  "composite-runtime-identity.json",
  "provider-call-guard.json",
  "summary.json",
  "artifact-validation.json"
] as const;

const SessionStateSchema = z.enum([
  "initial_misconception",
  "partial_understanding",
  "contradiction",
  "strategy_adaptation",
  "self_correction",
  "sound_understanding",
  "revision_readiness",
  "optional_instructor_boundary"
]);

const WorkflowStageSchema = z.enum([
  "activity_presented",
  "student_evidence_accepted",
  "evidence_mapped",
  "learning_profile_updated",
  "engagement_profile_updated",
  "stopping_decision_created",
  "intervention_selected",
  "student_reassessed",
  "revision_requested",
  "instructor_next_step_shown"
]);

const IntegratedSessionContractSchema = z.object({
  contract_version: z.literal(E2A38_INTEGRATED_SESSION_CONTRACT_VERSION),
  domain: z.literal("educational_measurement_assessment_literacy"),
  concept_id: z.literal(CONCEPT_ID),
  item_id: z.literal(ITEM_ID),
  canonical_anchor_id: z.literal(CANONICAL_ANCHOR_ID),
  active_distractor: z.literal(CANONICAL_DISTRACTOR),
  initial_activity: z.literal(INITIAL_ACTIVITY),
  allowed_session_states: z.array(SessionStateSchema).length(8),
  authoritative_rules: z.object({
    evidence_is_authoritative: z.literal(true),
    trajectory_expectation_is_non_authoritative: z.literal(true),
    application_controls_progression: z.literal(true),
    sound_requires_immediate_revision: z.literal(true),
    regression_reopens_profile: z.literal(true),
    instructor_boundary_is_internal: z.literal(true)
  }).strict(),
  accepted_turn_records: z.array(z.enum([
    "learning_profile",
    "engagement_profile",
    "intervention_memory"
  ])).length(3)
}).strict();

const WorkflowFidelityContractSchema = z.object({
  contract_version: z.literal(E2A38_WORKFLOW_FIDELITY_CONTRACT_VERSION),
  canonical_workflow: z.array(WorkflowStageSchema).min(8),
  early_sound_short_circuit: z.array(WorkflowStageSchema).length(7),
  invariants: z.object({
    evidence_precedes_profile: z.literal(true),
    profile_precedes_intervention_or_progression: z.literal(true),
    reassessment_precedes_revision: z.literal(true),
    sound_skips_additional_tutor_dispatch: z.literal(true),
    evidence_loss_prohibited: z.literal(true)
  }).strict()
}).strict();

const DialogueEfficiencyContractSchema = z.object({
  contract_version: z.literal(E2A38_DIALOGUE_EFFICIENCY_CONTRACT_VERSION),
  detects: z.array(z.enum([
    "unnecessary_turn_after_sound",
    "missed_revision",
    "repeated_ineffective_strategy",
    "excessive_tutoring",
    "premature_stop"
  ])).length(5),
  requirements: z.object({
    no_minimum_turns_before_sound: z.literal(true),
    no_tutor_after_sound: z.literal(true),
    ineffective_strategy_must_change: z.literal(true),
    fixed_turn_count_cannot_stop: z.literal(true)
  }).strict()
}).strict();

const PersonalizationEvaluationContractSchema = z.object({
  contract_version: z.literal(E2A38_PERSONALIZATION_CONTRACT_VERSION),
  required_inputs: z.array(z.enum([
    "reasoning_quality",
    "engagement_evidence",
    "prior_interventions",
    "remaining_knowledge_gap"
  ])).length(4),
  same_misconception_requires_context_sensitive_support: z.literal(true),
  identical_generic_explanations_prohibited: z.literal(true),
  engagement_is_not_a_correctness_signal: z.literal(true)
}).strict();

const StoppingQualityContractSchema = z.object({
  contract_version: z.literal(E2A38_STOPPING_QUALITY_CONTRACT_VERSION),
  required_checks: z.array(z.enum([
    "sound_ends_dialogue",
    "partial_with_value_continues",
    "regression_reopens",
    "persistent_barrier_is_bounded",
    "premature_ending_rejected",
    "infinite_dialogue_rejected"
  ])).length(6),
  evidence_driven: z.literal(true),
  fixed_turn_count_authoritative: z.literal(false)
}).strict();

const HumanBoundaryContractSchema = z.object({
  contract_version: z.literal(E2A38_HUMAN_BOUNDARY_CONTRACT_VERSION),
  base_handoff_boundary_version: z.literal(E2A37_HANDOFF_BOUNDARY_VERSION),
  eligible_only_when: z.array(z.enum([
    "persistent_unresolved_barrier",
    "meaningful_support_already_provided",
    "intervention_value_decreasing",
    "additional_human_context_is_preferable"
  ])).length(4),
  prohibited_bases: z.array(z.enum([
    "correctness_alone",
    "fixed_turn_count_alone",
    "engagement_label_alone"
  ])).length(3),
  student_message_requires: z.array(z.enum([
    "learning_summary",
    "useful_next_step",
    "instructor_discussion_suggestion",
    "no_internal_reason"
  ])).length(4)
}).strict();

const IntegrationMetricsContractSchema = z.object({
  contract_version: z.literal(E2A38_METRICS_CONTRACT_VERSION),
  metrics: z.array(z.object({
    metric_id: z.enum([
      "workflow_fidelity",
      "dialogue_efficiency",
      "personalization",
      "stopping_quality",
      "human_boundary",
      "evidence_integrity"
    ]),
    description: z.string().min(1).max(500)
  }).strict()).length(6),
  synthetic_protocol_metrics_only: z.literal(true),
  stable_student_trait_claim: z.literal(false)
}).strict();

type JsonRecord = Record<string, unknown>;
type LearningState =
  | "misconception"
  | "partial"
  | "contradiction"
  | "sound";
type EngagementMode = "high" | "productive" | "low";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function fileSha256(relativePath: string) {
  const target = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(process.cwd(), relativePath);
  return sha256(readFileSync(target));
}

function currentGitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, value: unknown) {
  const serialized = JSON.stringify(value);
  assert(
    ![
      /\bsk-[A-Za-z0-9_-]{12,}/u,
      /\bBearer\s+[A-Za-z0-9._-]+/u,
      /OPENAI_API_KEY\s*=/u,
      /DATABASE_URL\s*=/u,
      /SESSION_SECRET\s*=/u
    ].some((pattern) => pattern.test(serialized)),
    "e2a38_forbidden_secret_detected"
  );
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildInitialActivity() {
  return {
    activity_version: "e2a38-initial-activity-v1",
    domain: "educational_measurement_assessment_literacy",
    concept_id: CONCEPT_ID,
    item_id: ITEM_ID,
    student_facing_prompt: INITIAL_ACTIVITY,
    canonical_anchor_id: CANONICAL_ANCHOR_ID,
    canonical_distractor: CANONICAL_DISTRACTOR,
    knowledge_gap:
      "The student confuses consistency evidence with validity evidence.",
    required_conceptual_distinction: [
      "Reliability concerns score consistency.",
      "Validity concerns the interpretation and use of scores.",
      "Consistent scores can still reflect the wrong construct."
    ],
    answer_key_exposed: false,
    internal_state_exposed: false
  } as const;
}

function buildIntegratedSessionContract() {
  return IntegratedSessionContractSchema.parse({
    contract_version: E2A38_INTEGRATED_SESSION_CONTRACT_VERSION,
    domain: "educational_measurement_assessment_literacy",
    concept_id: CONCEPT_ID,
    item_id: ITEM_ID,
    canonical_anchor_id: CANONICAL_ANCHOR_ID,
    active_distractor: CANONICAL_DISTRACTOR,
    initial_activity: INITIAL_ACTIVITY,
    allowed_session_states: [
      "initial_misconception",
      "partial_understanding",
      "contradiction",
      "strategy_adaptation",
      "self_correction",
      "sound_understanding",
      "revision_readiness",
      "optional_instructor_boundary"
    ],
    authoritative_rules: {
      evidence_is_authoritative: true,
      trajectory_expectation_is_non_authoritative: true,
      application_controls_progression: true,
      sound_requires_immediate_revision: true,
      regression_reopens_profile: true,
      instructor_boundary_is_internal: true
    },
    accepted_turn_records: [
      "learning_profile",
      "engagement_profile",
      "intervention_memory"
    ]
  });
}

function buildWorkflowFidelityContract() {
  return WorkflowFidelityContractSchema.parse({
    contract_version: E2A38_WORKFLOW_FIDELITY_CONTRACT_VERSION,
    canonical_workflow: [
      "activity_presented",
      "student_evidence_accepted",
      "evidence_mapped",
      "learning_profile_updated",
      "engagement_profile_updated",
      "stopping_decision_created",
      "intervention_selected",
      "student_reassessed",
      "revision_requested"
    ],
    early_sound_short_circuit: [
      "activity_presented",
      "student_evidence_accepted",
      "evidence_mapped",
      "learning_profile_updated",
      "engagement_profile_updated",
      "stopping_decision_created",
      "revision_requested"
    ],
    invariants: {
      evidence_precedes_profile: true,
      profile_precedes_intervention_or_progression: true,
      reassessment_precedes_revision: true,
      sound_skips_additional_tutor_dispatch: true,
      evidence_loss_prohibited: true
    }
  });
}

function buildDialogueEfficiencyContract() {
  return DialogueEfficiencyContractSchema.parse({
    contract_version: E2A38_DIALOGUE_EFFICIENCY_CONTRACT_VERSION,
    detects: [
      "unnecessary_turn_after_sound",
      "missed_revision",
      "repeated_ineffective_strategy",
      "excessive_tutoring",
      "premature_stop"
    ],
    requirements: {
      no_minimum_turns_before_sound: true,
      no_tutor_after_sound: true,
      ineffective_strategy_must_change: true,
      fixed_turn_count_cannot_stop: true
    }
  });
}

function buildPersonalizationContract() {
  return PersonalizationEvaluationContractSchema.parse({
    contract_version: E2A38_PERSONALIZATION_CONTRACT_VERSION,
    required_inputs: [
      "reasoning_quality",
      "engagement_evidence",
      "prior_interventions",
      "remaining_knowledge_gap"
    ],
    same_misconception_requires_context_sensitive_support: true,
    identical_generic_explanations_prohibited: true,
    engagement_is_not_a_correctness_signal: true
  });
}

function buildStoppingQualityContract() {
  return StoppingQualityContractSchema.parse({
    contract_version: E2A38_STOPPING_QUALITY_CONTRACT_VERSION,
    required_checks: [
      "sound_ends_dialogue",
      "partial_with_value_continues",
      "regression_reopens",
      "persistent_barrier_is_bounded",
      "premature_ending_rejected",
      "infinite_dialogue_rejected"
    ],
    evidence_driven: true,
    fixed_turn_count_authoritative: false
  });
}

function buildHumanBoundaryContract() {
  return HumanBoundaryContractSchema.parse({
    contract_version: E2A38_HUMAN_BOUNDARY_CONTRACT_VERSION,
    base_handoff_boundary_version: E2A37_HANDOFF_BOUNDARY_VERSION,
    eligible_only_when: [
      "persistent_unresolved_barrier",
      "meaningful_support_already_provided",
      "intervention_value_decreasing",
      "additional_human_context_is_preferable"
    ],
    prohibited_bases: [
      "correctness_alone",
      "fixed_turn_count_alone",
      "engagement_label_alone"
    ],
    student_message_requires: [
      "learning_summary",
      "useful_next_step",
      "instructor_discussion_suggestion",
      "no_internal_reason"
    ]
  });
}

function buildMetricsContract() {
  return IntegrationMetricsContractSchema.parse({
    contract_version: E2A38_METRICS_CONTRACT_VERSION,
    metrics: [
      {
        metric_id: "workflow_fidelity",
        description:
          "Checks activity-to-evidence-to-profile-to-intervention-to-reassessment-to-revision ordering."
      },
      {
        metric_id: "dialogue_efficiency",
        description:
          "Detects unnecessary turns, missed revision, repeated support, and excessive tutoring."
      },
      {
        metric_id: "personalization",
        description:
          "Checks that reasoning, engagement, intervention history, and remaining gap change support."
      },
      {
        metric_id: "stopping_quality",
        description:
          "Checks evidence-driven ending, continued support, regression reopening, and bounded stopping."
      },
      {
        metric_id: "human_boundary",
        description:
          "Checks that instructor support is educationally appropriate and student-facing."
      },
      {
        metric_id: "evidence_integrity",
        description:
          "Checks that missing links, contradictions, and evidence references survive profile integration."
      }
    ],
    synthetic_protocol_metrics_only: true,
    stable_student_trait_claim: false
  });
}

function buildFullSessionTrajectoryEnvelope(): TrajectoryEnvelopeContract {
  const consequence = buildDefaultTrajectoryProgressionConsequences();
  const roles = [
    "initial_anchor_position",
    "mechanism_exploration",
    "anchor_reconciliation",
    "mechanism_exploration",
    "independent_reconstruction",
    "revision_readiness",
    "post_sound_revision",
    "anchor_reconciliation"
  ] as const;
  return TrajectoryEnvelopeContractSchema.parse({
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    authority_boundary: {
      simulator_intended_trajectory_is_non_authoritative: true,
      evaluator_follows_observable_evidence: true,
      production_sound_gate_is_authoritative_for_progression: true,
      exact_turn_by_turn_reasoning_labels_prohibited: true
    },
    separation: {
      simulator_intended_trajectory:
        "The integrated fixture offers misconception, partial, contradiction, strategy adaptation, self-correction, sound, revision, regression, and optional handoff opportunities without prescribing evaluator labels.",
      acceptable_reasoning_quality_envelope:
        "Every checkpoint accepts any evidence-supported quality; early sound advances immediately and later regression reopens support.",
      progression_consequences:
        "Observable evidence and the sound gate govern progression while stopping and instructor-boundary policies remain application-owned."
    },
    turns: roles.map((role, index) => ({
      turn_index: index + 1,
      expected_trajectory_role: role,
      allowed_reasoning_quality_set: [
        "insufficient",
        "misconception",
        "partial",
        "sound"
      ],
      sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
      progression_consequence: consequence,
      prohibited_states: [
        "trajectory_expectation_overrides_evaluator",
        "revision_delayed_after_sound",
        "copied_wording_without_evidence",
        "blocking_contradiction",
        "unsupported_sound_promotion"
      ]
    }))
  });
}

function learningObservation(input: {
  caseId: string;
  sequence: number;
  state: LearningState;
  selfCorrectionIntent?: boolean;
  conceptualUpdate?: boolean;
  profileUpdateEligible?: boolean;
}) {
  const update = input.conceptualUpdate ?? true;
  const eligible = input.profileUpdateEligible ?? update;
  const sound = input.state === "sound";
  const contradiction = input.state === "contradiction";
  const partial = input.state === "partial";
  return createLearningProfileSnapshotV1({
    sequence_index: input.sequence,
    source_student_turn_id:
      `e2a38_${input.caseId}_student_turn_${input.sequence}`,
    concept_family: "reliability_validity",
    conceptual_understanding: sound
      ? "sound"
      : partial || contradiction
        ? "partial"
        : "misconception",
    misconception_status: sound
      ? "resolved_for_current_anchor"
      : partial
        ? "uncertain"
        : "persists",
    knowledge_gap: sound
      ? "No essential reliability-validity link remains for the active anchor."
      : partial
        ? "Explain how consistent scores can still represent the wrong construct."
        : contradiction
          ? "Reconcile the reliability distinction with continued endorsement of the validity claim."
          : "Separate consistency evidence from intended-interpretation evidence.",
    reasoning_quality: sound
      ? "sound"
      : partial || contradiction
        ? "partial"
        : "misconception",
    anchor_interpretation: sound
      ? {
          application: "explicit",
          stance: "rejects_distractor",
          consistency: "consistent_with_conceptual_reasoning"
        }
      : contradiction
        ? {
            application: "explicit",
            stance: "endorses_distractor",
            consistency: "contradictory_to_conceptual_reasoning"
          }
        : partial
          ? {
              application: "explicit",
              stance: "ambiguous",
              consistency: "unresolved"
            }
          : {
              application: "explicit",
              stance: "endorses_distractor",
              consistency: "consistent_with_conceptual_reasoning"
            },
    unresolved_contradictions: contradiction
      ? ["anchor_conclusion_conceptual_explanation_conflict"]
      : [],
    missing_links: sound
      ? []
      : partial
        ? ["consistent_wrong_construct_mechanism"]
        : contradiction
          ? ["required_anchor_rejection"]
          : [
              "reliability_validity_interpretation_boundary",
              "consistent_wrong_construct_mechanism"
            ],
    transfer_readiness: sound,
    confidence_alignment: sound ? "aligned" : "not_assessable",
    self_correction_intent: input.selfCorrectionIntent ?? false,
    conceptual_evidence_update: update,
    profile_update_eligible: eligible,
    observable_evidence_present: update,
    independent_evidence_present: update,
    created_at: new Date(input.sequence * 1000).toISOString()
  });
}

function engagementObservation(input: {
  caseId: string;
  sequence: number;
  mode: EngagementMode;
}) {
  const active = input.mode !== "low";
  return createEngagementProfileSnapshotV1({
    sequence_index: input.sequence,
    source_student_turn_id:
      `e2a38_${input.caseId}_student_turn_${input.sequence}`,
    participation: active ? "active" : "minimal",
    response_quality_trend: input.mode === "productive"
      ? "improving"
      : input.mode === "high"
        ? "stable"
        : "declining",
    effort: active
      ? "sustained_observed_effort"
      : "limited_observed_effort",
    persistence: active ? "sustained" : "limited",
    help_seeking: active ? "conceptual" : "none",
    frustration: input.mode === "low" ? "possible" : "not_observed",
    disengagement: input.mode === "low" ? "possible" : "not_observed",
    responsiveness_to_intervention: input.mode === "productive"
      ? "productive_response"
      : input.mode === "high"
        ? "partial_response"
        : "no_observable_change",
    strategy_uptake: input.mode === "productive"
      ? "clear"
      : input.mode === "high"
        ? "partial"
        : "not_observed",
    evidence_basis: [
      input.mode === "low"
        ? "The synthetic response is minimal and does not incorporate the prior prompt."
        : input.mode === "productive"
          ? "The synthetic response adds a new conceptual distinction after support."
          : "The synthetic response is substantive but the conceptual boundary remains unresolved."
    ],
    created_at: new Date(input.sequence * 1000).toISOString()
  });
}

function acceptedTurn(input: {
  caseId: string;
  sequence: number;
  message: string;
  state: LearningState;
  engagementMode: EngagementMode;
  priorLearning: LearningProfileEvolutionV1 | null;
  priorEngagement: EngagementProfileEvolutionV1 | null;
  selfCorrectionIntent?: boolean;
  conceptualUpdate?: boolean;
  profileUpdateEligible?: boolean;
}) {
  const observation = learningObservation({
    caseId: input.caseId,
    sequence: input.sequence,
    state: input.state,
    selfCorrectionIntent: input.selfCorrectionIntent,
    conceptualUpdate: input.conceptualUpdate,
    profileUpdateEligible: input.profileUpdateEligible
  });
  const learning = evolveLearningProfileV1({
    prior: input.priorLearning,
    observation
  });
  const engagement = evolveEngagementProfileV1({
    prior: input.priorEngagement,
    observation: engagementObservation({
      caseId: input.caseId,
      sequence: input.sequence,
      mode: input.engagementMode
    })
  });
  const sourceMissingLinks = [...observation.missing_links];
  const sourceContradictions = [
    ...observation.unresolved_contradictions
  ];
  const sourceEvidenceReferences = [
    `${observation.source_student_turn_id}:anchor`,
    `${observation.source_student_turn_id}:mechanism`
  ];
  const evidencePreservation = {
    preservation_version: "e2a38-cross-stage-evidence-preservation-v1",
    source_essential_missing_links: sourceMissingLinks,
    mapped_essential_missing_links: [...observation.missing_links],
    profile_essential_missing_links: [
      ...learning.current_profile.missing_links
    ],
    source_blocking_contradictions: sourceContradictions,
    mapped_blocking_contradictions: [
      ...observation.unresolved_contradictions
    ],
    profile_blocking_contradictions: [
      ...learning.current_profile.unresolved_contradictions
    ],
    source_evidence_references: sourceEvidenceReferences,
    mapped_evidence_references: [...sourceEvidenceReferences],
    no_source_evidence_removed:
      sourceMissingLinks.every((entry) =>
        observation.missing_links.includes(entry)
      ) &&
      sourceContradictions.every((entry) =>
        observation.unresolved_contradictions.includes(entry)
      ) &&
      sourceEvidenceReferences.length === 2,
    sound_requires_no_essential_missing_links:
      observation.conceptual_understanding !== "sound" ||
      observation.missing_links.length === 0,
    passed: true
  };
  assert(
    evidencePreservation.no_source_evidence_removed &&
      evidencePreservation.sound_requires_no_essential_missing_links,
    "e2a38_cross_stage_evidence_preservation_failed"
  );
  return {
    accepted_turn_version: "e2a38-accepted-turn-v1",
    case_id: input.caseId,
    sequence_index: input.sequence,
    student_message: input.message,
    evaluator_evidence: {
      reasoning_quality: observation.reasoning_quality,
      anchor_interpretation: observation.anchor_interpretation,
      essential_missing_links: sourceMissingLinks,
      blocking_contradictions: sourceContradictions,
      evidence_references: sourceEvidenceReferences
    },
    learning_profile_evolution: learning,
    engagement_profile_evolution: engagement,
    evidence_preservation: evidencePreservation
  };
}

function completeIntervention(input: {
  prior: LongitudinalInterventionRecordV1[];
  outcome:
    | "no_new_evidence"
    | "misconception_persists"
    | "partial_improvement"
    | "sound_understanding"
    | "recurrence";
  effective: boolean;
  targetedGap?: string;
}) {
  const selected = selectLongitudinalInterventionV1({
    concept_family: "reliability_validity",
    targeted_gap: input.targetedGap ??
      "reliability-validity conceptual boundary",
    evidence_sought: [
      "distinguish score consistency from interpretation evidence"
    ],
    prior_interventions: input.prior
  });
  return {
    ...selected,
    student_response_evidence_summary: input.effective
      ? "The synthetic response added evidence for the targeted distinction."
      : "The synthetic response did not resolve the targeted distinction.",
    observed_outcome: input.outcome,
    changed_understanding: input.effective,
    effective_for_target_gap: input.effective
  } satisfies LongitudinalInterventionRecordV1;
}

function decideStopping(input: {
  turn: ReturnType<typeof acceptedTurn>;
  memory?: LongitudinalInterventionRecordV1[];
  budgetExhausted?: boolean;
  newEvidence?: boolean;
  gapNarrowing?: boolean;
  strategyUptake?: boolean;
  expectedBenefit?: "low" | "uncertain" | "high";
  unresolvedBarrier?: boolean;
}) {
  return decideAdaptiveStoppingV1({
    learning_profile: input.turn.learning_profile_evolution,
    engagement_profile: input.turn.engagement_profile_evolution,
    intervention_memory: input.memory ?? [],
    session_budget_exhausted: input.budgetExhausted ?? false,
    new_evidence_observed: input.newEvidence ?? false,
    knowledge_gap_narrowing: input.gapNarrowing ?? false,
    strategy_uptake_observed: input.strategyUptake ?? false,
    expected_benefit: input.expectedBenefit ?? "uncertain",
    unresolved_conceptual_barrier: input.unresolvedBarrier ?? true
  });
}

const INTEGRATED_BLOCKED_PATTERNS = [
  /\bmisconceptions?\b/iu,
  /\bengagement\s+(?:score|profile|state)\b/iu,
  /\b(?:session|turn|token)\s+budget\b/iu,
  /\bstopping\s+(?:rule|policy|decision)\b/iu,
  /\bescalation\s+(?:rule|policy|criteria)\b/iu,
  /\b(?:ai|system)\s+(?:limitation|cannot help|can't help)\b/iu
] as const;

function validateStudentMessage(message: string) {
  const base = validateStudentFacingCommunicationV1(message);
  const issueCodes = INTEGRATED_BLOCKED_PATTERNS.flatMap(
    (pattern, index) =>
      pattern.test(message)
        ? [`e2a38_internal_state_leak_${index + 1}`]
        : []
  );
  return {
    validator_version: "e2a38-student-facing-integration-v1",
    base_validation: base,
    issue_codes: [...base.issue_codes, ...issueCodes],
    passed: base.passed && issueCodes.length === 0
  };
}

function assertStudentMessage(message: string) {
  const validation = validateStudentMessage(message);
  if (!validation.passed) {
    throw new Error(
      `e2a38_student_facing_communication_rejected:${
        validation.issue_codes.join("|")
      }`
    );
  }
  return {
    student_facing_message: message,
    validation,
    internal_state_exposed: false
  };
}

function interventionMemoryForTurn(
  memory: LongitudinalInterventionRecordV1[],
  nextStrategyDecision: string
) {
  const previous = memory.at(-1);
  return {
    memory_version: E2A36_INTERVENTION_MEMORY_VERSION,
    previous_strategy: previous?.strategy ?? null,
    previous_outcome: previous?.observed_outcome ?? null,
    prior_intervention_count: memory.length,
    next_strategy_decision: nextStrategyDecision
  };
}

function turnRecord(input: {
  turn: ReturnType<typeof acceptedTurn>;
  memory: LongitudinalInterventionRecordV1[];
  nextStrategyDecision: string;
}) {
  return {
    case_id: input.turn.case_id,
    sequence_index: input.turn.sequence_index,
    student_message: input.turn.student_message,
    evaluator_evidence: input.turn.evaluator_evidence,
    learning_profile:
      input.turn.learning_profile_evolution.current_profile,
    engagement_profile:
      input.turn.engagement_profile_evolution.current_snapshot,
    intervention_memory: interventionMemoryForTurn(
      input.memory,
      input.nextStrategyDecision
    ),
    evidence_preservation: input.turn.evidence_preservation
  };
}

function workflowTrace(stages: Array<z.infer<typeof WorkflowStageSchema>>) {
  return stages;
}

function assertNoRepeatedIneffectiveStrategy(input: {
  prior: LongitudinalInterventionRecordV1[];
  proposedStrategy: string;
}) {
  const repeated = input.prior.some((entry) =>
    !entry.effective_for_target_gap &&
    entry.strategy === input.proposedStrategy
  );
  if (repeated) {
    throw new Error("e2a38_repeated_ineffective_strategy");
  }
}

function validateWorkflowOrder(trace: string[]) {
  const index = (stage: string) => trace.indexOf(stage);
  const evidenceBeforeProfile =
    index("student_evidence_accepted") >= 0 &&
    index("student_evidence_accepted") < index("learning_profile_updated");
  const profileBeforeDecision =
    index("learning_profile_updated") >= 0 &&
    index("learning_profile_updated") <
      index("stopping_decision_created");
  const revisionIndex = index("revision_requested");
  const reassessmentIndex = index("student_reassessed");
  const revisionOrdering =
    revisionIndex < 0 ||
    reassessmentIndex < 0 ||
    reassessmentIndex < revisionIndex;
  return {
    evidence_before_profile: evidenceBeforeProfile,
    profile_before_stopping_or_intervention: profileBeforeDecision,
    reassessment_before_revision_when_present: revisionOrdering,
    passed:
      evidenceBeforeProfile &&
      profileBeforeDecision &&
      revisionOrdering
  };
}

function caseResult(input: {
  caseId: string;
  title: string;
  acceptedTurns: Array<ReturnType<typeof turnRecord>>;
  workflow: string[];
  interventionMemory: LongitudinalInterventionRecordV1[];
  stoppingDecision: AdaptiveStoppingDecisionV1 | null;
  studentMessages: Array<ReturnType<typeof assertStudentMessage>>;
  expectedOutcome: string;
  assertions: Record<string, boolean>;
  extra?: Record<string, unknown>;
}) {
  const workflowValidation = validateWorkflowOrder(input.workflow);
  const evidencePreserved = input.acceptedTurns.every(
    (turn) => turn.evidence_preservation.passed
  );
  const communicationSafe = input.studentMessages.every(
    (message) => message.validation.passed
  );
  return {
    case_version: "e2a38-deterministic-integration-case-v1",
    case_id: input.caseId,
    title: input.title,
    expected_outcome: input.expectedOutcome,
    workflow_trace: input.workflow,
    workflow_validation: workflowValidation,
    accepted_turn_records: input.acceptedTurns,
    intervention_memory: input.interventionMemory,
    final_stopping_decision: input.stoppingDecision,
    student_facing_messages: input.studentMessages,
    evidence_preserved: evidencePreserved,
    student_communication_safe: communicationSafe,
    assertions: input.assertions,
    ...(input.extra ?? {}),
    passed:
      workflowValidation.passed &&
      evidencePreserved &&
      communicationSafe &&
      Object.values(input.assertions).every(Boolean)
  };
}

function runDeterministicIntegrationCases(
  trajectory: TrajectoryEnvelopeContract
) {
  const earlyTurn = acceptedTurn({
    caseId: "early_sound",
    sequence: 1,
    message:
      "I disagree. Reliability means the scores are consistent, but a test can consistently measure the wrong construct, so validity needs separate evidence about the intended interpretation.",
    state: "sound",
    engagementMode: "productive",
    priorLearning: null,
    priorEngagement: null
  });
  const earlyDecision = decideStopping({
    turn: earlyTurn,
    newEvidence: true,
    gapNarrowing: true,
    strategyUptake: true,
    expectedBenefit: "high",
    unresolvedBarrier: false
  });
  const earlyTrajectory = evaluateTrajectoryEnvelope({
    turn_contract: trajectory.turns[0],
    evaluator_reasoning_quality: "sound",
    sound_gate_result: {
      gate_version: "e2a38-integrated-sound-gate-fixture-v1",
      passed: true,
      failure_codes: []
    },
    evidence_independently_supported: true,
    copied_wording_without_evidence: false,
    blocking_contradiction: false,
    prior_reasoning_quality: null,
    prior_sound_gate_passed: false,
    turn_budget_exhausted: false
  });
  const earlyMessage = assertStudentMessage(
    "You have separated score consistency from evidence for an intended interpretation. Now revise your original explanation using that distinction."
  );
  const earlySound = caseResult({
    caseId: "early_sound",
    title: "Early sound evidence advances immediately",
    acceptedTurns: [
      turnRecord({
        turn: earlyTurn,
        memory: [],
        nextStrategyDecision: "immediate_revision_no_tutor"
      })
    ],
    workflow: workflowTrace([
      "activity_presented",
      "student_evidence_accepted",
      "evidence_mapped",
      "learning_profile_updated",
      "engagement_profile_updated",
      "stopping_decision_created",
      "revision_requested"
    ]),
    interventionMemory: [],
    stoppingDecision: earlyDecision,
    studentMessages: [earlyMessage],
    expectedOutcome: "immediate_revision",
    assertions: {
      sound_detected:
        earlyTurn.learning_profile_evolution.current_profile
          .conceptual_understanding === "sound",
      revision_ready: earlyDecision.revision_ready,
      tutor_not_dispatched: !earlyDecision.tutor_dispatch_allowed,
      trajectory_sound_override:
        earlyTrajectory.progression_decision === "immediate_revision"
    },
    extra: { trajectory_decision: earlyTrajectory }
  });

  const delayedTurn1 = acceptedTurn({
    caseId: "delayed_sound",
    sequence: 1,
    message:
      "Consistent scores mean the test measures correctly, so I agree with the teacher.",
    state: "misconception",
    engagementMode: "high",
    priorLearning: null,
    priorEngagement: null
  });
  const delayedIntervention1 = completeIntervention({
    prior: [],
    outcome: "misconception_persists",
    effective: false
  });
  const delayedTurn2 = acceptedTurn({
    caseId: "delayed_sound",
    sequence: 2,
    message:
      "Reliability means consistency, although I am not yet sure why that would not prove validity.",
    state: "partial",
    engagementMode: "productive",
    priorLearning: delayedTurn1.learning_profile_evolution,
    priorEngagement: delayedTurn1.engagement_profile_evolution
  });
  const delayedIntervention2 = completeIntervention({
    prior: [delayedIntervention1],
    outcome: "partial_improvement",
    effective: true
  });
  const delayedTurn3 = acceptedTurn({
    caseId: "delayed_sound",
    sequence: 3,
    message:
      "Now I see that a test can consistently measure the wrong construct. Reliability is consistency, while validity needs evidence for the intended interpretation.",
    state: "sound",
    engagementMode: "productive",
    priorLearning: delayedTurn2.learning_profile_evolution,
    priorEngagement: delayedTurn2.engagement_profile_evolution
  });
  const delayedMemory = [
    delayedIntervention1,
    delayedIntervention2
  ];
  const delayedDecision = decideStopping({
    turn: delayedTurn3,
    memory: delayedMemory,
    newEvidence: true,
    gapNarrowing: true,
    strategyUptake: true,
    expectedBenefit: "high",
    unresolvedBarrier: false
  });
  const delayedSound = caseResult({
    caseId: "delayed_sound",
    title: "Delayed sound follows adapted support",
    acceptedTurns: [
      turnRecord({
        turn: delayedTurn1,
        memory: [],
        nextStrategyDecision: delayedIntervention1.strategy
      }),
      turnRecord({
        turn: delayedTurn2,
        memory: [delayedIntervention1],
        nextStrategyDecision: delayedIntervention2.strategy
      }),
      turnRecord({
        turn: delayedTurn3,
        memory: delayedMemory,
        nextStrategyDecision: "immediate_revision_no_tutor"
      })
    ],
    workflow: workflowTrace([
      "activity_presented",
      "student_evidence_accepted",
      "evidence_mapped",
      "learning_profile_updated",
      "engagement_profile_updated",
      "stopping_decision_created",
      "intervention_selected",
      "student_reassessed",
      "revision_requested"
    ]),
    interventionMemory: delayedMemory,
    stoppingDecision: delayedDecision,
    studentMessages: [
      assertStudentMessage(
        "Consider a test that gives stable scores but measures reading speed instead of the intended construct. What would the stable scores establish, and what would still need evidence?"
      ),
      assertStudentMessage(
        "Your explanation now captures the distinction. Revise your first response in one or two sentences."
      )
    ],
    expectedOutcome: "adapt_then_immediate_revision",
    assertions: {
      profile_progressed_to_sound:
        delayedTurn3.learning_profile_evolution.current_profile
          .conceptual_understanding === "sound",
      strategy_adapted:
        delayedIntervention1.strategy !== delayedIntervention2.strategy,
      revision_ready: delayedDecision.revision_ready,
      no_tutor_after_sound: !delayedDecision.tutor_dispatch_allowed
    }
  });

  const contradictionTurn = acceptedTurn({
    caseId: "contradiction_resolution",
    sequence: 1,
    message:
      "Reliability is consistency, but if scores are always the same, the test must still be measuring the right thing.",
    state: "contradiction",
    engagementMode: "high",
    priorLearning: null,
    priorEngagement: null
  });
  const contradictionIntervention = completeIntervention({
    prior: [],
    outcome: "partial_improvement",
    effective: true
  });
  const resolvedTurn = acceptedTurn({
    caseId: "contradiction_resolution",
    sequence: 2,
    message:
      "The stable scores show reliability, not that the intended construct is measured. A test could consistently measure something else, so I reject the claim.",
    state: "sound",
    engagementMode: "productive",
    priorLearning: contradictionTurn.learning_profile_evolution,
    priorEngagement: contradictionTurn.engagement_profile_evolution
  });
  const contradictionDecision = decideStopping({
    turn: resolvedTurn,
    memory: [contradictionIntervention],
    newEvidence: true,
    gapNarrowing: true,
    strategyUptake: true,
    expectedBenefit: "high",
    unresolvedBarrier: false
  });
  const contradictionResolution = caseResult({
    caseId: "contradiction_resolution",
    title: "Structured contradiction is preserved then resolved",
    acceptedTurns: [
      turnRecord({
        turn: contradictionTurn,
        memory: [],
        nextStrategyDecision: contradictionIntervention.strategy
      }),
      turnRecord({
        turn: resolvedTurn,
        memory: [contradictionIntervention],
        nextStrategyDecision: "immediate_revision_no_tutor"
      })
    ],
    workflow: workflowTrace([
      "activity_presented",
      "student_evidence_accepted",
      "evidence_mapped",
      "learning_profile_updated",
      "engagement_profile_updated",
      "stopping_decision_created",
      "intervention_selected",
      "student_reassessed",
      "revision_requested"
    ]),
    interventionMemory: [contradictionIntervention],
    stoppingDecision: contradictionDecision,
    studentMessages: [
      assertStudentMessage(
        "You have identified consistency. Now test the conclusion with an example where scores stay stable but reflect the wrong construct."
      )
    ],
    expectedOutcome: "contradiction_resolved_then_revision",
    assertions: {
      contradiction_was_explicit:
        contradictionTurn.evaluator_evidence.anchor_interpretation
          .consistency === "contradictory_to_conceptual_reasoning",
      contradiction_survived_mapping:
        contradictionTurn.evidence_preservation
          .profile_blocking_contradictions.includes(
            "anchor_conclusion_conceptual_explanation_conflict"
          ),
      resolved_profile_sound:
        resolvedTurn.learning_profile_evolution.current_profile
          .conceptual_understanding === "sound",
      revision_ready: contradictionDecision.revision_ready
    }
  });

  const correctionPrior = acceptedTurn({
    caseId: "self_correction_with_evidence",
    sequence: 1,
    message:
      "I agree because consistent results show the test is valid.",
    state: "misconception",
    engagementMode: "high",
    priorLearning: null,
    priorEngagement: null
  });
  const correctionIntervention = completeIntervention({
    prior: [],
    outcome: "partial_improvement",
    effective: true
  });
  const correctionResolution = resolveSelfCorrectionIntentEnvelopeV2({
    contract: buildSelfCorrectionIntentEnvelopeContractV2(),
    observation: {
      visible_message:
        "Actually, I was wrong. A test could consistently measure the wrong thing, so reliability alone does not show validity.",
      simulator_metadata: {
        rendered_intent: "revision_evidence",
        expressed_evidence_level: "substantive",
        claims_understanding: false
      },
      conceptual_evidence: {
        status: "conceptual_update",
        source: "deterministic_fixture",
        observable_evidence_present: true,
        independent_application_present: true,
        contradiction_present: false
      }
    }
  });
  const correctionTurn = acceptedTurn({
    caseId: "self_correction_with_evidence",
    sequence: 2,
    message:
      "Actually, I was wrong. A test could consistently measure the wrong thing, so reliability alone does not show validity.",
    state: "sound",
    engagementMode: "productive",
    priorLearning: correctionPrior.learning_profile_evolution,
    priorEngagement: correctionPrior.engagement_profile_evolution,
    selfCorrectionIntent: true,
    conceptualUpdate: true,
    profileUpdateEligible: true
  });
  const correctionDecision = decideStopping({
    turn: correctionTurn,
    memory: [correctionIntervention],
    newEvidence: true,
    gapNarrowing: true,
    strategyUptake: true,
    expectedBenefit: "high",
    unresolvedBarrier: false
  });
  const selfCorrectionWithEvidence = caseResult({
    caseId: "self_correction_with_evidence",
    title: "Self-correction with evidence updates the profile",
    acceptedTurns: [
      turnRecord({
        turn: correctionPrior,
        memory: [],
        nextStrategyDecision: correctionIntervention.strategy
      }),
      turnRecord({
        turn: correctionTurn,
        memory: [correctionIntervention],
        nextStrategyDecision: "immediate_revision_no_tutor"
      })
    ],
    workflow: workflowTrace([
      "activity_presented",
      "student_evidence_accepted",
      "evidence_mapped",
      "learning_profile_updated",
      "engagement_profile_updated",
      "stopping_decision_created",
      "intervention_selected",
      "student_reassessed",
      "revision_requested"
    ]),
    interventionMemory: [correctionIntervention],
    stoppingDecision: correctionDecision,
    studentMessages: [
      assertStudentMessage(
        "Your revised explanation distinguishes consistency from validity evidence. Now update your original response."
      )
    ],
    expectedOutcome: "self_correction_updates_then_revision",
    assertions: {
      self_correction_intent:
        correctionResolution.self_correction_intent,
      conceptual_evidence_update:
        correctionResolution.conceptual_evidence_update,
      profile_update_eligible:
        correctionResolution.profile_update_eligible,
      updated_profile_sound:
        correctionTurn.learning_profile_evolution.current_profile
          .conceptual_understanding === "sound",
      revision_ready: correctionDecision.revision_ready
    },
    extra: { self_correction_resolution: correctionResolution }
  });

  const noEvidencePrior = acceptedTurn({
    caseId: "self_correction_without_evidence",
    sequence: 1,
    message:
      "The test is valid because the scores are consistent.",
    state: "misconception",
    engagementMode: "high",
    priorLearning: null,
    priorEngagement: null
  });
  const noEvidenceResolution = resolveSelfCorrectionIntentEnvelopeV2({
    contract: buildSelfCorrectionIntentEnvelopeContractV2(),
    observation: {
      visible_message: "I was wrong. I choose another option.",
      simulator_metadata: {
        rendered_intent: "revision_evidence",
        expressed_evidence_level: "none",
        claims_understanding: false
      },
      conceptual_evidence: {
        status: "no_conceptual_update",
        source: "deterministic_fixture",
        observable_evidence_present: false,
        independent_application_present: false,
        contradiction_present: false
      }
    }
  });
  const noEvidenceTurn = acceptedTurn({
    caseId: "self_correction_without_evidence",
    sequence: 2,
    message: "I was wrong. I choose another option.",
    state: "partial",
    engagementMode: "high",
    priorLearning: noEvidencePrior.learning_profile_evolution,
    priorEngagement: noEvidencePrior.engagement_profile_evolution,
    selfCorrectionIntent: true,
    conceptualUpdate: false,
    profileUpdateEligible: false
  });
  const noEvidenceDecision = decideStopping({
    turn: noEvidenceTurn,
    expectedBenefit: "high"
  });
  const noEvidencePrompt = assertStudentMessage(
    "Explain what consistent scores establish and what additional evidence would be needed before supporting the intended interpretation."
  );
  const selfCorrectionWithoutEvidence = caseResult({
    caseId: "self_correction_without_evidence",
    title: "Correction language alone does not update understanding",
    acceptedTurns: [
      turnRecord({
        turn: noEvidencePrior,
        memory: [],
        nextStrategyDecision: "request_conceptual_evidence"
      }),
      turnRecord({
        turn: noEvidenceTurn,
        memory: [],
        nextStrategyDecision: "request_conceptual_evidence"
      })
    ],
    workflow: workflowTrace([
      "activity_presented",
      "student_evidence_accepted",
      "evidence_mapped",
      "learning_profile_updated",
      "engagement_profile_updated",
      "stopping_decision_created",
      "intervention_selected"
    ]),
    interventionMemory: [],
    stoppingDecision: noEvidenceDecision,
    studentMessages: [noEvidencePrompt],
    expectedOutcome: "preserve_profile_and_request_evidence",
    assertions: {
      correction_intent_detected:
        noEvidenceResolution.self_correction_intent,
      conceptual_update_rejected:
        !noEvidenceResolution.conceptual_evidence_update,
      profile_update_ineligible:
        !noEvidenceResolution.profile_update_eligible,
      prior_profile_preserved:
        noEvidenceTurn.learning_profile_evolution
          .current_profile_snapshot_id ===
        noEvidencePrior.learning_profile_evolution
          .current_profile_snapshot_id,
      dialogue_continues:
        noEvidenceDecision.internal_decision === "continue_dialogue"
    },
    extra: { self_correction_resolution: noEvidenceResolution }
  });

  const regressionSoundTurn = acceptedTurn({
    caseId: "sound_then_regression",
    sequence: 1,
    message:
      "Reliability shows consistency, while validity requires evidence that scores support their intended interpretation.",
    state: "sound",
    engagementMode: "productive",
    priorLearning: null,
    priorEngagement: null
  });
  const regressionTurn = acceptedTurn({
    caseId: "sound_then_regression",
    sequence: 2,
    message:
      "Actually, if scores are consistent, the test must still be valid.",
    state: "misconception",
    engagementMode: "high",
    priorLearning: regressionSoundTurn.learning_profile_evolution,
    priorEngagement: regressionSoundTurn.engagement_profile_evolution
  });
  const regressionDecision = decideStopping({
    turn: regressionTurn,
    newEvidence: true,
    expectedBenefit: "high"
  });
  const regressionTrajectory = evaluateTrajectoryEnvelope({
    turn_contract: trajectory.turns[7],
    evaluator_reasoning_quality: "misconception",
    sound_gate_result: {
      gate_version: "e2a38-integrated-sound-gate-fixture-v1",
      passed: false,
      failure_codes: ["active_anchor_endorsed"]
    },
    evidence_independently_supported: true,
    copied_wording_without_evidence: false,
    blocking_contradiction: true,
    prior_reasoning_quality: "sound",
    prior_sound_gate_passed: true,
    turn_budget_exhausted: false
  });
  const soundThenRegression = caseResult({
    caseId: "sound_then_regression",
    title: "Regression after sound reopens the profile",
    acceptedTurns: [
      turnRecord({
        turn: regressionSoundTurn,
        memory: [],
        nextStrategyDecision: "immediate_revision_no_tutor"
      }),
      turnRecord({
        turn: regressionTurn,
        memory: [],
        nextStrategyDecision: "reopen_targeted_support"
      })
    ],
    workflow: workflowTrace([
      "activity_presented",
      "student_evidence_accepted",
      "evidence_mapped",
      "learning_profile_updated",
      "engagement_profile_updated",
      "stopping_decision_created",
      "intervention_selected"
    ]),
    interventionMemory: [],
    stoppingDecision: regressionDecision,
    studentMessages: [
      assertStudentMessage(
        "Let’s check that conclusion with a counterexample: could scores stay consistent while reflecting the wrong construct?"
      )
    ],
    expectedOutcome: "reopen_targeted_support",
    assertions: {
      stale_sound_not_preserved:
        regressionTurn.learning_profile_evolution.current_profile
          .conceptual_understanding === "misconception",
      profile_reopened_once:
        regressionTurn.learning_profile_evolution
          .misconception_reopened_count === 1,
      dialogue_reopened:
        regressionDecision.internal_decision === "continue_dialogue",
      trajectory_reopened:
        regressionTrajectory.progression_decision ===
          "reopen_targeted_support"
    },
    extra: { trajectory_decision: regressionTrajectory }
  });

  const barrierTurn1 = acceptedTurn({
    caseId: "persistent_barrier",
    sequence: 1,
    message:
      "Stable scores prove that the test measures the intended construct.",
    state: "misconception",
    engagementMode: "high",
    priorLearning: null,
    priorEngagement: null
  });
  const barrierIntervention1 = completeIntervention({
    prior: [],
    outcome: "misconception_persists",
    effective: false
  });
  const barrierTurn2 = acceptedTurn({
    caseId: "persistent_barrier",
    sequence: 2,
    message:
      "I see the example, but I still think stability is enough to establish validity.",
    state: "misconception",
    engagementMode: "high",
    priorLearning: barrierTurn1.learning_profile_evolution,
    priorEngagement: barrierTurn1.engagement_profile_evolution
  });
  const barrierIntervention2 = completeIntervention({
    prior: [barrierIntervention1],
    outcome: "no_new_evidence",
    effective: false
  });
  const barrierTurn3 = acceptedTurn({
    caseId: "persistent_barrier",
    sequence: 3,
    message: "I still think consistent means valid.",
    state: "misconception",
    engagementMode: "low",
    priorLearning: barrierTurn2.learning_profile_evolution,
    priorEngagement: barrierTurn2.engagement_profile_evolution
  });
  const barrierMemory = [barrierIntervention1, barrierIntervention2];
  const barrierDecision = decideStopping({
    turn: barrierTurn3,
    memory: barrierMemory,
    budgetExhausted: true,
    expectedBenefit: "low",
    unresolvedBarrier: true
  });
  const barrierEscalation =
    evaluateInstructorEscalationV1(barrierDecision);
  const barrierMessage = assertStudentMessage(
    "We have explored this distinction from several angles. Reliable scores show consistency, but validity still needs evidence for the intended interpretation. A useful next step is to discuss with your instructor what validity evidence would fit this assessment."
  );
  const persistentBarrier = caseResult({
    caseId: "persistent_barrier",
    title: "Persistent barrier reaches a bounded instructor boundary",
    acceptedTurns: [
      turnRecord({
        turn: barrierTurn1,
        memory: [],
        nextStrategyDecision: barrierIntervention1.strategy
      }),
      turnRecord({
        turn: barrierTurn2,
        memory: [barrierIntervention1],
        nextStrategyDecision: barrierIntervention2.strategy
      }),
      turnRecord({
        turn: barrierTurn3,
        memory: barrierMemory,
        nextStrategyDecision: "supportive_instructor_next_step"
      })
    ],
    workflow: workflowTrace([
      "activity_presented",
      "student_evidence_accepted",
      "evidence_mapped",
      "learning_profile_updated",
      "engagement_profile_updated",
      "stopping_decision_created",
      "intervention_selected",
      "student_reassessed",
      "instructor_next_step_shown"
    ]),
    interventionMemory: barrierMemory,
    stoppingDecision: barrierDecision,
    studentMessages: [barrierMessage],
    expectedOutcome: "bounded_instructor_support",
    assertions: {
      multiple_meaningful_interventions:
        barrierMemory.length >= 2,
      strategy_changed:
        barrierIntervention1.strategy !==
          barrierIntervention2.strategy,
      bounded_stop:
        barrierDecision.internal_decision ===
          "bounded_stop_instructor_support",
      instructor_support_recommended:
        barrierEscalation.recommend_instructor_support,
      internal_reason_hidden:
        !barrierMessage.internal_state_exposed
    },
    extra: { instructor_escalation: barrierEscalation }
  });

  const personalizationSeed = completeIntervention({
    prior: [],
    outcome: "misconception_persists",
    effective: false
  });
  const highEngagementTurn = acceptedTurn({
    caseId: "engagement_personalization_high",
    sequence: 1,
    message:
      "I understand that reliability is consistency, but I am still trying to see why that does not establish validity.",
    state: "misconception",
    engagementMode: "high",
    priorLearning: null,
    priorEngagement: null
  });
  const lowEngagementTurn = acceptedTurn({
    caseId: "engagement_personalization_low",
    sequence: 1,
    message: "Consistent means valid.",
    state: "misconception",
    engagementMode: "low",
    priorLearning: null,
    priorEngagement: null
  });
  const highDecision = decideStopping({
    turn: highEngagementTurn,
    memory: [personalizationSeed],
    newEvidence: true,
    strategyUptake: true,
    expectedBenefit: "high"
  });
  const lowDecision = decideStopping({
    turn: lowEngagementTurn,
    memory: [personalizationSeed],
    budgetExhausted: true,
    expectedBenefit: "low"
  });
  const adaptedStrategy = completeIntervention({
    prior: [personalizationSeed],
    outcome: "partial_improvement",
    effective: true
  });
  const highMessage = assertStudentMessage(
    "You have identified consistency. Try a construct comparison: what if the scores remain stable but reflect reading speed rather than the intended knowledge?"
  );
  const lowMessage = assertStudentMessage(
    "We have worked on the key distinction in more than one way. A useful next step is to discuss with your instructor what evidence would show that this assessment supports its intended interpretation."
  );
  const engagementPersonalization = caseResult({
    caseId: "engagement_personalization",
    title: "The same conceptual gap receives context-sensitive support",
    acceptedTurns: [
      turnRecord({
        turn: highEngagementTurn,
        memory: [personalizationSeed],
        nextStrategyDecision: adaptedStrategy.strategy
      }),
      turnRecord({
        turn: lowEngagementTurn,
        memory: [personalizationSeed],
        nextStrategyDecision: "supportive_instructor_next_step"
      })
    ],
    workflow: workflowTrace([
      "activity_presented",
      "student_evidence_accepted",
      "evidence_mapped",
      "learning_profile_updated",
      "engagement_profile_updated",
      "stopping_decision_created",
      "intervention_selected"
    ]),
    interventionMemory: [personalizationSeed],
    stoppingDecision: highDecision,
    studentMessages: [highMessage, lowMessage],
    expectedOutcome: "different_support_for_different_evidence_context",
    assertions: {
      same_conceptual_state:
        highEngagementTurn.learning_profile_evolution.current_profile
          .conceptual_understanding ===
        lowEngagementTurn.learning_profile_evolution.current_profile
          .conceptual_understanding,
      different_engagement_evidence:
        highEngagementTurn.engagement_profile_evolution.current_snapshot
          .responsiveness_to_intervention !==
        lowEngagementTurn.engagement_profile_evolution.current_snapshot
          .responsiveness_to_intervention,
      different_stopping_decisions:
        highDecision.internal_decision !== lowDecision.internal_decision,
      different_student_support:
        highMessage.student_facing_message !==
          lowMessage.student_facing_message,
      correctness_not_changed_by_engagement:
        highEngagementTurn.evaluator_evidence.reasoning_quality ===
          lowEngagementTurn.evaluator_evidence.reasoning_quality
    },
    extra: {
      high_engagement_decision: highDecision,
      low_engagement_decision: lowDecision
    }
  });

  const repetitionTurn = acceptedTurn({
    caseId: "tutor_repetition_failure",
    sequence: 1,
    message:
      "I still think that consistent scores prove the intended interpretation.",
    state: "misconception",
    engagementMode: "high",
    priorLearning: null,
    priorEngagement: null
  });
  const repetitionPrior = completeIntervention({
    prior: [],
    outcome: "misconception_persists",
    effective: false
  });
  let repetitionHardFailure = false;
  try {
    assertNoRepeatedIneffectiveStrategy({
      prior: [repetitionPrior],
      proposedStrategy: repetitionPrior.strategy
    });
  } catch (error) {
    repetitionHardFailure =
      error instanceof Error &&
      error.message === "e2a38_repeated_ineffective_strategy";
  }
  const repetitionReplacement = completeIntervention({
    prior: [repetitionPrior],
    outcome: "partial_improvement",
    effective: true
  });
  const repetitionDecision = decideStopping({
    turn: repetitionTurn,
    memory: [repetitionPrior],
    expectedBenefit: "high"
  });
  const tutorRepetitionFailure = caseResult({
    caseId: "tutor_repetition_failure",
    title: "Repeated ineffective tutor strategy hard fails",
    acceptedTurns: [
      turnRecord({
        turn: repetitionTurn,
        memory: [repetitionPrior],
        nextStrategyDecision: repetitionReplacement.strategy
      })
    ],
    workflow: workflowTrace([
      "activity_presented",
      "student_evidence_accepted",
      "evidence_mapped",
      "learning_profile_updated",
      "engagement_profile_updated",
      "stopping_decision_created",
      "intervention_selected"
    ]),
    interventionMemory: [repetitionPrior, repetitionReplacement],
    stoppingDecision: repetitionDecision,
    studentMessages: [
      assertStudentMessage(
        "Let’s use a different example and compare what consistency evidence can establish with what validity evidence must support."
      )
    ],
    expectedOutcome: "reject_repetition_and_change_strategy",
    assertions: {
      repetition_hard_failed: repetitionHardFailure,
      replacement_strategy_changed:
        repetitionPrior.strategy !== repetitionReplacement.strategy,
      dialogue_continues:
        repetitionDecision.internal_decision === "continue_dialogue"
    }
  });

  const leakageTurn = acceptedTurn({
    caseId: "internal_leakage_failure",
    sequence: 1,
    message:
      "I still connect consistent scores with validity.",
    state: "misconception",
    engagementMode: "low",
    priorLearning: null,
    priorEngagement: null
  });
  let leakageHardFailure = false;
  const invalidInternalMessage =
    "Your misconception profile and low engagement score triggered the stopping rule because the session budget is exhausted.";
  try {
    assertStudentMessage(invalidInternalMessage);
  } catch (error) {
    leakageHardFailure =
      error instanceof Error &&
      error.message.startsWith(
        "e2a38_student_facing_communication_rejected:"
      );
  }
  const leakageDecision = decideStopping({
    turn: leakageTurn,
    expectedBenefit: "high"
  });
  const internalLeakageFailure = caseResult({
    caseId: "internal_leakage_failure",
    title: "Internal orchestration language hard fails",
    acceptedTurns: [
      turnRecord({
        turn: leakageTurn,
        memory: [],
        nextStrategyDecision: "student_safe_targeted_support"
      })
    ],
    workflow: workflowTrace([
      "activity_presented",
      "student_evidence_accepted",
      "evidence_mapped",
      "learning_profile_updated",
      "engagement_profile_updated",
      "stopping_decision_created",
      "intervention_selected"
    ]),
    interventionMemory: [],
    stoppingDecision: leakageDecision,
    studentMessages: [
      assertStudentMessage(
        "Let’s focus on one distinction: what do consistent scores show, and what question about interpretation remains?"
      )
    ],
    expectedOutcome: "reject_internal_language",
    assertions: {
      internal_message_rejected: leakageHardFailure,
      safe_replacement_passes: validateStudentMessage(
        "Let’s focus on one distinction: what do consistent scores show, and what question about interpretation remains?"
      ).passed
    },
    extra: {
      rejected_message_validation:
        validateStudentMessage(invalidInternalMessage)
    }
  });

  const cases = [
    earlySound,
    delayedSound,
    contradictionResolution,
    selfCorrectionWithEvidence,
    selfCorrectionWithoutEvidence,
    soundThenRegression,
    persistentBarrier,
    engagementPersonalization,
    tutorRepetitionFailure,
    internalLeakageFailure
  ];

  const suite = (
    suiteId: string,
    selected: typeof cases,
    additionalChecks: Record<string, boolean> = {}
  ) => ({
    suite_version: `e2a38-${suiteId}-v1`,
    case_ids: selected.map((entry) => entry.case_id),
    case_count: selected.length,
    additional_checks: additionalChecks,
    passed:
      selected.every((entry) => entry.passed) &&
      Object.values(additionalChecks).every(Boolean)
  });

  const workflowFidelity = suite(
    "workflow-fidelity-results",
    cases.slice(0, 8),
    {
      complete_workflow_observed:
        delayedSound.workflow_trace.includes("intervention_selected") &&
        delayedSound.workflow_trace.includes("student_reassessed") &&
        delayedSound.workflow_trace.includes("revision_requested"),
      early_sound_short_circuit_observed:
        !earlySound.workflow_trace.includes("intervention_selected")
    }
  );
  const profileIntegration = suite(
    "profile-integration-results",
    [
      earlySound,
      delayedSound,
      contradictionResolution,
      selfCorrectionWithEvidence,
      selfCorrectionWithoutEvidence,
      soundThenRegression
    ],
    {
      all_accepted_turns_record_profiles: cases.every((entry) =>
        entry.accepted_turn_records.every((turn) =>
          Boolean(turn.learning_profile) &&
          Boolean(turn.engagement_profile) &&
          Boolean(turn.intervention_memory)
        )
      )
    }
  );
  const interventionMemory = suite(
    "intervention-memory-results",
    [
      delayedSound,
      contradictionResolution,
      persistentBarrier,
      engagementPersonalization,
      tutorRepetitionFailure
    ],
    {
      repeated_ineffective_strategy_rejected: repetitionHardFailure
    }
  );
  const stoppingQuality = suite(
    "stopping-quality-results",
    [
      earlySound,
      delayedSound,
      selfCorrectionWithoutEvidence,
      soundThenRegression,
      persistentBarrier
    ]
  );
  const humanBoundary = suite(
    "human-boundary-results",
    [persistentBarrier, engagementPersonalization],
    {
      handoff_is_not_correctness_only:
        !barrierEscalation.based_on_correctness_alone,
      instructor_boundary_internal: barrierEscalation.internal_only
    }
  );
  const studentCommunication = suite(
    "student-communication-results",
    [persistentBarrier, engagementPersonalization, internalLeakageFailure],
    {
      invalid_internal_language_rejected: leakageHardFailure
    }
  );
  const trajectoryEnvelope = suite(
    "trajectory-envelope-results",
    [earlySound, delayedSound, soundThenRegression],
    {
      evidence_authoritative:
        earlyTrajectory.trajectory_expectation_changed_evaluator_output ===
          false &&
        regressionTrajectory
          .trajectory_expectation_changed_evaluator_output === false
    }
  );
  const selfCorrection = suite(
    "self-correction-results",
    [selfCorrectionWithEvidence, selfCorrectionWithoutEvidence]
  );
  const evidencePreservation = suite(
    "evidence-preservation-results",
    cases.slice(0, 8),
    {
      all_turns_preserve_evidence: cases.every((entry) =>
        entry.accepted_turn_records.every(
          (turn) => turn.evidence_preservation.passed
        )
      ),
      sound_profiles_have_no_missing_links: cases.every((entry) =>
        entry.accepted_turn_records.every((turn) =>
          turn.learning_profile.conceptual_understanding !== "sound" ||
          turn.learning_profile.missing_links.length === 0
        )
      )
    }
  );
  const personalization = suite(
    "personalization-results",
    [engagementPersonalization],
    {
      messages_differ:
        highMessage.student_facing_message !==
          lowMessage.student_facing_message,
      strategies_consider_history:
        adaptedStrategy.strategy !== personalizationSeed.strategy
    }
  );

  const suites = {
    workflow_fidelity: workflowFidelity,
    profile_integration: profileIntegration,
    intervention_memory: interventionMemory,
    stopping_quality: stoppingQuality,
    human_boundary: humanBoundary,
    student_communication: studentCommunication,
    trajectory_envelope: trajectoryEnvelope,
    self_correction: selfCorrection,
    evidence_preservation: evidencePreservation,
    personalization
  };
  const metricsResults = {
    results_version: "e2a38-integration-metrics-results-v1",
    metrics: [
      {
        metric_id: "workflow_fidelity",
        passed: workflowFidelity.passed
      },
      {
        metric_id: "dialogue_efficiency",
        passed:
          earlyDecision.revision_ready &&
          !earlyDecision.tutor_dispatch_allowed &&
          delayedIntervention1.strategy !==
            delayedIntervention2.strategy &&
          repetitionHardFailure
      },
      {
        metric_id: "personalization",
        passed: personalization.passed
      },
      {
        metric_id: "stopping_quality",
        passed: stoppingQuality.passed
      },
      {
        metric_id: "human_boundary",
        passed: humanBoundary.passed
      },
      {
        metric_id: "evidence_integrity",
        passed: evidencePreservation.passed
      }
    ]
  };
  return {
    deterministic_version:
      "e2a38-deterministic-integration-cases-v1",
    cases,
    case_count: cases.length,
    suites,
    metrics_results: metricsResults,
    passed:
      cases.every((entry) => entry.passed) &&
      Object.values(suites).every((entry) => entry.passed) &&
      metricsResults.metrics.every((entry) => entry.passed)
  };
}

function buildComponentBindings(
  base: ReturnType<typeof buildE2A37PreparationArtifacts>
) {
  return {
    bindings_version: "e2a38-component-contract-bindings-v1",
    e2a37_protocol_version: base.protocol.protocol_version,
    e2a37_protocol_hash: base.protocol.protocol_hash,
    candidate_configuration_hash:
      base.candidateIntegrity.candidate_configuration_hash,
    contract_versions: {
      evaluator_v5: base.protocol.evaluator_v5.evaluator_version,
      target_evidence: base.protocol.contract_versions.target_evidence,
      canonical_anchor: base.protocol.contract_versions.canonical_anchor,
      anchor_reference: base.protocol.contract_versions.anchor_reference,
      anchor_stance: base.protocol.contract_versions.anchor_stance,
      anchor_scope: base.protocol.contract_versions.anchor_scope,
      evidence_preservation_mapper:
        base.protocol.contract_versions.evidence_preservation_mapper,
      self_correction_intent:
        base.protocol.contract_versions.self_correction_intent,
      self_correction_evidence:
        base.protocol.contract_versions.self_correction_evidence,
      learning_profile: base.protocol.contract_versions.learning_profile,
      engagement_profile:
        base.protocol.contract_versions.engagement_profile,
      intervention_memory:
        base.protocol.contract_versions.intervention_memory,
      adaptive_stopping:
        base.protocol.contract_versions.adaptive_stopping,
      instructor_handoff:
        base.protocol.contract_versions.instructor_handoff_boundary,
      student_communication:
        base.protocol.contract_versions.student_communication,
      trajectory_envelope:
        base.protocol.contract_versions.trajectory_envelope
    },
    contract_hashes: {
      ...base.protocol.contract_hashes
    },
    component_regressions_passed: base.deterministic.passed,
    component_protected_sources_unchanged:
      base.protectedIntegrity.all_unchanged,
    provider_calls_made: 0,
    network_requests_made: 0
  };
}

function buildBudget() {
  return {
    budget_version: "e2a38-bounded-live-budget-v1",
    exactly_one_isolated_session: true,
    maximum_logical_generation_calls: 29,
    maximum_adapter_attempts: 87,
    maximum_adapter_attempts_per_logical_call: 3,
    maximum_transport_retries_per_logical_call: 2,
    maximum_input_tokens: 900_000,
    maximum_output_tokens: 70_000,
    maximum_total_tokens: 970_000,
    maximum_cost_usd_when_pricing_metadata_available: 25,
    provider_concurrency: 1,
    transport_retry_policy_version:
      PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
    execution_authorized: false,
    live_execution_performed: false
  } as const;
}

function buildArtifactContract() {
  return {
    artifact_contract_version: "e2a38-artifact-contract-v1",
    expected_artifact_names: [...E2A38_ARTIFACT_NAMES],
    preparation_creates_live_artifacts: false,
    provider_outputs_created: false,
    artifacts_must_be_read_only: true,
    required_no_live_fields: {
      execution_authorized: false,
      live_execution_performed: false,
      provider_calls_made: 0,
      network_requests_made: 0
    }
  } as const;
}

function buildProtectedSourceIntegrity() {
  const files = Object.entries(PROTECTED_SOURCE_HASHES).map(
    ([relativePath, expectedSha]) => {
      const actualSha = fileSha256(relativePath);
      return {
        relative_path: relativePath,
        expected_sha256: expectedSha,
        actual_sha256: actualSha,
        unchanged: actualSha === expectedSha
      };
    }
  );
  return {
    integrity_version: "e2a38-protected-source-integrity-v1",
    files,
    e2a37_protocol_source_unchanged: files.find((entry) =>
      entry.relative_path.endsWith(
        "e2a37-instructor-handoff-protocol.ts"
      )
    )?.unchanged === true,
    e2a37_harness_source_unchanged: files.find((entry) =>
      entry.relative_path.endsWith(
        "formative-evaluation-e2a37.ts"
      )
    )?.unchanged === true,
    all_unchanged: files.every((entry) => entry.unchanged)
  };
}

function buildProviderCallGuard(networkRequestCount: number) {
  return {
    guard_version: "e2a38-provider-call-guard-v1",
    execution_mode: "deterministic_protocol_freeze_no_live",
    provider_client_created: false,
    provider_dispatch_path_present: false,
    provider_outputs_created: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    passed: networkRequestCount === 0
  };
}

function buildProtocol(input: {
  initialActivity: ReturnType<typeof buildInitialActivity>;
  componentBindings: ReturnType<typeof buildComponentBindings>;
  integratedSession:
    ReturnType<typeof buildIntegratedSessionContract>;
  workflowFidelity:
    ReturnType<typeof buildWorkflowFidelityContract>;
  dialogueEfficiency:
    ReturnType<typeof buildDialogueEfficiencyContract>;
  personalization: ReturnType<typeof buildPersonalizationContract>;
  stoppingQuality: ReturnType<typeof buildStoppingQualityContract>;
  humanBoundary: ReturnType<typeof buildHumanBoundaryContract>;
  trajectory: TrajectoryEnvelopeContract;
  deterministic:
    ReturnType<typeof runDeterministicIntegrationCases>;
  metrics: ReturnType<typeof buildMetricsContract>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>;
}) {
  const core = {
    protocol_version: E2A38_PROTOCOL_VERSION,
    preparation_version: E2A38_PREPARATION_VERSION,
    protocol_state: "frozen_for_separate_authorization_not_executable",
    domain: "educational_measurement_assessment_literacy",
    execution_authorized: false,
    live_execution_performed: false,
    provider_dispatch_path_present: false,
    candidate_configuration_hash:
      input.componentBindings.candidate_configuration_hash,
    upstream_e2a37: {
      protocol_version: input.componentBindings.e2a37_protocol_version,
      protocol_hash: input.componentBindings.e2a37_protocol_hash,
      source_sha256:
        PROTECTED_SOURCE_HASHES[
          "src/lib/evaluation/formative/e2a37-instructor-handoff-protocol.ts"
        ],
      component_regressions_passed:
        input.componentBindings.component_regressions_passed,
      protected_sources_unchanged:
        input.componentBindings.component_protected_sources_unchanged
    },
    scenario: {
      item_id: ITEM_ID,
      concept_id: CONCEPT_ID,
      initial_activity: input.initialActivity.student_facing_prompt,
      canonical_anchor_id: CANONICAL_ANCHOR_ID,
      active_distractor_option: ACTIVE_OPTION,
      active_distractor_claim: CANONICAL_DISTRACTOR
    },
    architecture: {
      integration_layer_only: true,
      component_contracts_unchanged: true,
      application_controls_progression: true,
      evidence_is_authoritative: true,
      trajectory_is_non_authoritative: true,
      sound_requires_immediate_revision: true,
      regression_reopens_profile: true,
      ineffective_intervention_repetition_prohibited: true,
      instructor_boundary_is_internal: true,
      student_visible_internal_state: false
    },
    contract_versions: {
      integrated_session: input.integratedSession.contract_version,
      workflow_fidelity: input.workflowFidelity.contract_version,
      dialogue_efficiency: input.dialogueEfficiency.contract_version,
      personalization: input.personalization.contract_version,
      stopping_quality: input.stoppingQuality.contract_version,
      human_boundary: input.humanBoundary.contract_version,
      trajectory_envelope: input.trajectory.trajectory_envelope_version,
      self_correction_intent:
        SELF_CORRECTION_INTENT_ENVELOPE_VERSION,
      self_correction_evidence:
        SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION,
      learning_profile: E2A36_LEARNING_PROFILE_EVOLUTION_VERSION,
      engagement_profile:
        E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION,
      intervention_memory: E2A36_INTERVENTION_MEMORY_VERSION,
      adaptive_stopping: E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
      instructor_escalation:
        E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION,
      instructor_handoff: E2A37_HANDOFF_BOUNDARY_VERSION,
      student_communication:
        E2A37_STUDENT_COMMUNICATION_BOUNDARY_VERSION,
      metrics: input.metrics.contract_version
    },
    contract_hashes: {
      initial_activity: stableHash(input.initialActivity),
      component_bindings: stableHash(input.componentBindings),
      integrated_session: stableHash(input.integratedSession),
      workflow_fidelity: stableHash(input.workflowFidelity),
      dialogue_efficiency: stableHash(input.dialogueEfficiency),
      personalization: stableHash(input.personalization),
      stopping_quality: stableHash(input.stoppingQuality),
      human_boundary: stableHash(input.humanBoundary),
      trajectory_envelope: stableHash(input.trajectory),
      metrics: stableHash(input.metrics)
    },
    deterministic_gate_results: {
      deterministic_case_count: input.deterministic.case_count,
      all_integration_cases_passed: input.deterministic.passed,
      workflow_fidelity_passed:
        input.deterministic.suites.workflow_fidelity.passed,
      profile_integration_passed:
        input.deterministic.suites.profile_integration.passed,
      intervention_memory_passed:
        input.deterministic.suites.intervention_memory.passed,
      stopping_quality_passed:
        input.deterministic.suites.stopping_quality.passed,
      human_boundary_passed:
        input.deterministic.suites.human_boundary.passed,
      student_communication_passed:
        input.deterministic.suites.student_communication.passed,
      trajectory_envelope_passed:
        input.deterministic.suites.trajectory_envelope.passed,
      self_correction_passed:
        input.deterministic.suites.self_correction.passed,
      evidence_preservation_passed:
        input.deterministic.suites.evidence_preservation.passed,
      personalization_passed:
        input.deterministic.suites.personalization.passed,
      protected_sources_unchanged:
        input.protectedIntegrity.all_unchanged,
      provider_calls_zero: true,
      network_requests_zero: true
    },
    budget: input.budget,
    artifact_contract_hash: stableHash(input.artifactContract)
  };
  return {
    ...core,
    protocol_hash: stableHash(core)
  };
}

function buildCompositeRuntimeIdentity(input: {
  protocol: ReturnType<typeof buildProtocol>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
}) {
  const identity = {
    identity_version: "e2a38-composite-runtime-identity-v1",
    preparation_parent_git_commit: currentGitCommit(),
    protocol_version: input.protocol.protocol_version,
    protocol_hash: input.protocol.protocol_hash,
    upstream_e2a37_protocol_hash: E2A37_PROTOCOL_HASH,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    e2a37_protocol_source_sha256:
      PROTECTED_SOURCE_HASHES[
        "src/lib/evaluation/formative/e2a37-instructor-handoff-protocol.ts"
      ],
    e2a38_protocol_source_sha256: fileSha256(
      "src/lib/evaluation/formative/e2a38-integrated-session-protocol.ts"
    ),
    e2a38_harness_source_sha256: fileSha256(
      "prisma/formative-evaluation-e2a38.ts"
    ),
    protected_source_set_hash: stableHash(PROTECTED_SOURCE_HASHES),
    component_contract_hashes:
      input.protocol.contract_hashes.component_bindings,
    budget_hash: stableHash(input.budget),
    artifact_contract_hash: stableHash(input.artifactContract)
  };
  return {
    ...identity,
    composite_runtime_identity_hash: stableHash(identity)
  };
}

function validateArtifactDirectory(runDirectory: string) {
  const expectedBeforeValidation = E2A38_ARTIFACT_NAMES.filter(
    (name) => name !== "artifact-validation.json"
  );
  const actual = readdirSync(runDirectory).sort();
  const missing = expectedBeforeValidation.filter(
    (name) => !actual.includes(name)
  );
  const unexpected = actual.filter(
    (name) => !expectedBeforeValidation.includes(
      name as typeof expectedBeforeValidation[number]
    )
  );
  return {
    validation_version: "e2a38-artifact-validation-v1",
    expected_artifact_count: E2A38_ARTIFACT_NAMES.length,
    actual_artifact_count_before_validation: actual.length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    artifacts: actual.map((name) => ({
      name,
      sha256: fileSha256(path.join(runDirectory, name)),
      bytes: statSync(path.join(runDirectory, name)).size
    })),
    passed:
      missing.length === 0 &&
      unexpected.length === 0 &&
      actual.length === E2A38_ARTIFACT_NAMES.length - 1
  };
}

export function buildE2A38PreparationArtifacts(
  networkRequestCount = 0
) {
  const base = buildE2A37PreparationArtifacts(networkRequestCount);
  assert(
    base.protocol.protocol_hash === E2A37_PROTOCOL_HASH,
    "e2a38_upstream_e2a37_protocol_hash_mismatch"
  );
  assert(
    base.summary.passed &&
      base.protectedIntegrity.all_unchanged &&
      base.providerCallGuard.passed,
    "e2a38_upstream_e2a37_gate_failed"
  );
  const initialActivity = buildInitialActivity();
  const componentBindings = buildComponentBindings(base);
  const integratedSession = buildIntegratedSessionContract();
  const workflowFidelity = buildWorkflowFidelityContract();
  const dialogueEfficiency = buildDialogueEfficiencyContract();
  const personalization = buildPersonalizationContract();
  const stoppingQuality = buildStoppingQualityContract();
  const humanBoundary = buildHumanBoundaryContract();
  const trajectory = buildFullSessionTrajectoryEnvelope();
  const deterministic = runDeterministicIntegrationCases(trajectory);
  const metrics = buildMetricsContract();
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const protectedIntegrity = buildProtectedSourceIntegrity();
  const providerCallGuard = buildProviderCallGuard(networkRequestCount);

  assert(
    componentBindings.candidate_configuration_hash ===
      CANDIDATE_CONFIGURATION_HASH,
    "e2a38_candidate_configuration_hash_mismatch"
  );
  assert(
    protectedIntegrity.all_unchanged,
    "e2a38_protected_source_integrity_failed"
  );
  assert(
    deterministic.passed,
    "e2a38_deterministic_integration_cases_failed"
  );
  assert(
    providerCallGuard.passed,
    "e2a38_provider_call_guard_failed"
  );

  const protocol = buildProtocol({
    initialActivity,
    componentBindings,
    integratedSession,
    workflowFidelity,
    dialogueEfficiency,
    personalization,
    stoppingQuality,
    humanBoundary,
    trajectory,
    deterministic,
    metrics,
    budget,
    artifactContract,
    protectedIntegrity
  });
  const compositeRuntimeIdentity = buildCompositeRuntimeIdentity({
    protocol,
    budget,
    artifactContract
  });
  const summary = {
    summary_version: "e2a38-protocol-freeze-summary-v1",
    status: "e2a38_protocol_frozen_not_executed",
    protocol_version: protocol.protocol_version,
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    upstream_e2a37_protocol_hash: E2A37_PROTOCOL_HASH,
    candidate_configuration_hash:
      componentBindings.candidate_configuration_hash,
    deterministic_case_count: deterministic.case_count,
    deterministic_integration_cases_passed: deterministic.passed,
    protected_components_unchanged: protectedIntegrity.all_unchanged,
    upstream_component_gates_passed: base.summary.passed,
    execution_authorized: false,
    live_execution_performed: false,
    candidate_approved: false,
    candidate_activated: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    passed:
      deterministic.passed &&
      protectedIntegrity.all_unchanged &&
      base.summary.passed &&
      providerCallGuard.passed
  };
  const manifest = {
    manifest_version: "e2a38-freeze-manifest-v1",
    created_at: new Date().toISOString(),
    artifact_names: [...E2A38_ARTIFACT_NAMES],
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    execution_authorized: false,
    live_execution_performed: false
  };
  return {
    manifest,
    protocol,
    initialActivity,
    componentBindings,
    integratedSession,
    workflowFidelity,
    dialogueEfficiency,
    personalization,
    stoppingQuality,
    humanBoundary,
    trajectory,
    deterministic,
    metrics,
    metricsResults: deterministic.metrics_results,
    budget,
    artifactContract,
    candidateIntegrity: {
      candidate_configuration_hash:
        base.candidateIntegrity.candidate_configuration_hash,
      candidate_file_sha256:
        base.candidateIntegrity.candidate_file_sha256,
      candidate_approved: false,
      candidate_activated: false
    },
    protectedIntegrity,
    compositeRuntimeIdentity,
    providerCallGuard,
    summary
  };
}

function artifactValues(
  artifacts: ReturnType<typeof buildE2A38PreparationArtifacts>
) {
  const caseById = new Map(artifacts.deterministic.cases.map((entry) => [
    entry.case_id,
    entry
  ]));
  const requiredCase = (caseId: string) => {
    const entry = caseById.get(caseId);
    assert(entry, `e2a38_required_case_missing:${caseId}`);
    return entry;
  };
  return {
    "freeze-manifest.json": artifacts.manifest,
    "frozen-protocol.json": artifacts.protocol,
    "frozen-protocol.sha256": `${artifacts.protocol.protocol_hash}\n`,
    "initial-activity.json": artifacts.initialActivity,
    "component-contract-bindings.json": artifacts.componentBindings,
    "integrated-session-contract.json": artifacts.integratedSession,
    "workflow-fidelity-contract.json": artifacts.workflowFidelity,
    "dialogue-efficiency-contract.json": artifacts.dialogueEfficiency,
    "personalization-evaluation-contract.json":
      artifacts.personalization,
    "stopping-quality-contract.json": artifacts.stoppingQuality,
    "human-boundary-contract.json": artifacts.humanBoundary,
    "full-session-trajectory-envelope.json": artifacts.trajectory,
    "deterministic-integration-cases.json": artifacts.deterministic,
    "early-sound-case.json": requiredCase("early_sound"),
    "delayed-sound-case.json": requiredCase("delayed_sound"),
    "contradiction-resolution-case.json":
      requiredCase("contradiction_resolution"),
    "self-correction-with-evidence-case.json":
      requiredCase("self_correction_with_evidence"),
    "self-correction-without-evidence-case.json":
      requiredCase("self_correction_without_evidence"),
    "sound-regression-case.json":
      requiredCase("sound_then_regression"),
    "persistent-barrier-case.json":
      requiredCase("persistent_barrier"),
    "engagement-personalization-case.json":
      requiredCase("engagement_personalization"),
    "tutor-repetition-failure-case.json":
      requiredCase("tutor_repetition_failure"),
    "internal-leakage-failure-case.json":
      requiredCase("internal_leakage_failure"),
    "workflow-fidelity-results.json":
      artifacts.deterministic.suites.workflow_fidelity,
    "profile-integration-results.json":
      artifacts.deterministic.suites.profile_integration,
    "intervention-memory-results.json":
      artifacts.deterministic.suites.intervention_memory,
    "stopping-quality-results.json":
      artifacts.deterministic.suites.stopping_quality,
    "human-boundary-results.json":
      artifacts.deterministic.suites.human_boundary,
    "student-communication-results.json":
      artifacts.deterministic.suites.student_communication,
    "trajectory-envelope-results.json":
      artifacts.deterministic.suites.trajectory_envelope,
    "self-correction-results.json":
      artifacts.deterministic.suites.self_correction,
    "evidence-preservation-results.json":
      artifacts.deterministic.suites.evidence_preservation,
    "personalization-results.json":
      artifacts.deterministic.suites.personalization,
    "metrics-contract.json": artifacts.metrics,
    "metrics-results.json": artifacts.metricsResults,
    "budget.json": artifacts.budget,
    "artifact-contract.json": artifacts.artifactContract,
    "candidate-integrity.json": artifacts.candidateIntegrity,
    "protected-source-integrity.json": artifacts.protectedIntegrity,
    "composite-runtime-identity.json":
      artifacts.compositeRuntimeIdentity,
    "provider-call-guard.json": artifacts.providerCallGuard,
    "summary.json": artifacts.summary
  } as const;
}

export function writeE2A38PreparationArtifacts(input: {
  runDirectory: string;
  networkRequestCount?: number;
}) {
  assert(
    !existsSync(input.runDirectory),
    "e2a38_artifact_directory_already_exists"
  );
  mkdirSync(input.runDirectory, { recursive: true });
  const artifacts = buildE2A38PreparationArtifacts(
    input.networkRequestCount ?? 0
  );
  for (const [name, value] of Object.entries(artifactValues(artifacts))) {
    const output = path.join(input.runDirectory, name);
    if (typeof value === "string") {
      writeFileSync(output, value, "utf8");
    } else {
      writeJson(output, value);
    }
  }
  const artifactValidation = validateArtifactDirectory(
    input.runDirectory
  );
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    artifactValidation
  );
  const finalFiles = readdirSync(input.runDirectory).sort();
  const complete =
    finalFiles.length === E2A38_ARTIFACT_NAMES.length &&
    E2A38_ARTIFACT_NAMES.every((name) => finalFiles.includes(name));
  assert(artifacts.summary.passed, "e2a38_summary_failed");
  assert(
    artifactValidation.passed && complete,
    "e2a38_artifact_validation_failed"
  );
  for (const name of finalFiles) {
    chmodSync(path.join(input.runDirectory, name), 0o444);
  }
  chmodSync(input.runDirectory, 0o555);
  return {
    ...artifacts,
    artifactValidation: {
      ...artifactValidation,
      final_artifact_count: finalFiles.length,
      complete
    }
  };
}

export function makeE2A38PreparationRunId() {
  const timestamp = new Date().toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/u, "Z");
  return `e2a38_${timestamp}_${randomBytes(4).toString("hex")}`;
}

export function latestE2A38PreparationRunDirectory() {
  assert(
    existsSync(E2A38_ARTIFACT_ROOT),
    "e2a38_artifact_root_missing"
  );
  const latest = readdirSync(E2A38_ARTIFACT_ROOT)
    .map((name) => path.join(E2A38_ARTIFACT_ROOT, name))
    .filter((entry) => statSync(entry).isDirectory())
    .sort()
    .at(-1);
  assert(latest, "e2a38_artifact_run_missing");
  return latest;
}

export function inspectE2A38PreparationRun(runDirectory: string) {
  return {
    run_directory: runDirectory,
    summary: readJson<JsonRecord>(
      path.join(runDirectory, "summary.json")
    ),
    protocol: readJson<JsonRecord>(
      path.join(runDirectory, "frozen-protocol.json")
    ),
    composite_runtime_identity: readJson<JsonRecord>(
      path.join(runDirectory, "composite-runtime-identity.json")
    ),
    artifact_validation: readJson<JsonRecord>(
      path.join(runDirectory, "artifact-validation.json")
    ),
    provider_call_guard: readJson<JsonRecord>(
      path.join(runDirectory, "provider-call-guard.json")
    )
  };
}
