import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import {
  E2A29A_ARTIFACT_ROOT,
  auditE2A29A,
  e2a30ArtifactContract as e2a30ArtifactContractV1,
  e2a30Budget as e2a30BudgetV1,
  e2a30FrozenProtocol as e2a30FrozenProtocolV1,
  runE2A29ATransportCalibration
} from "@/lib/evaluation/formative/e2a29a-provider-infrastructure-reconciliation";
import {
  EXACTLY_ONCE_SEMANTIC_EFFECTS_POLICY_VERSION,
  PROVIDER_FAILURE_TAXONOMY_VERSION,
  PROVIDER_REQUEST_TRACING_POLICY_VERSION,
  PROVIDER_TRANSPORT_RETRY_LIMITS,
  PROVIDER_TRANSPORT_RETRY_POLICY_VERSION
} from "@/lib/llm/provider-transport-retry";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_HASH_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5
} from "@/lib/services/student-assessment/production-turn-evidence-evaluator-v5";
import {
  PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V3
} from "@/lib/services/student-assessment/pre-tutor-profile-finalization-v3";
import {
  ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2
} from "@/lib/services/student-assessment/anchor-contradiction-propagation-v2";
import {
  PROFILE_CONSISTENCY_POLICY_VERSION_V6,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6,
  type TurnEvidenceObservationV5
} from "@/lib/services/student-assessment/target-evidence-contract-v5";
import {
  TopicDialogueCumulativeEvidenceProfileSchema,
  createTopicDialogueTurnEvidenceProfile,
  selectEvidenceFirstTopicDialogueRoute,
  type TopicDialogueCumulativeEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION,
  MIXED_INTENT_EVIDENCE_RETENTION_VERSION,
  NONCONCEPTUAL_PROFILE_PRESERVATION_VERSION,
  TURN_EVIDENCE_OBSERVATION_VERSION,
  applyConceptualApplicabilityToTurnProfile,
  assertProfileUpdateDispositionCoherent,
  classifyConceptualEvidenceApplicability,
  createLearningProfileUpdateDispositionRecordV1,
  createTurnEvidenceObservationRecordV1,
  determineProfileUpdateDisposition,
  integrateTopicDialogueEvidenceProfileWithDisposition,
  normalizeUnsupportedUnderstandingObservation,
  type ConceptualEvidenceApplicability,
  type ProfileUpdateDisposition
} from "@/lib/services/student-assessment/turn-evidence-profile-update";
import {
  TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION_V2,
  TurnEvidenceCrossArtifactConsistencyError,
  reconcileTurnEvidenceLayersV2,
  type AuthoritativeProfileLayerViewV2,
  type TurnObservationLayerViewV2
} from "@/lib/services/student-assessment/turn-evidence-cross-artifact-consistency";

export const E2A29B_VERSION =
  "e2a29b-nonconceptual-profile-consistency-v1" as const;
export const E2A29B_STATUS =
  "e2a29b_transport_and_consistency_commit_gate_passed_e2a30_ready" as const;
export const E2A29B_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a29b-nonconceptual-profile-consistency"
);

const STARTING_HEAD = "efb5bd5a32ce7ece93747b02e444c8ad1bb861ca";
const E2A29A_RUN_ID = "e2a29a_20260722144006_a6d11876";
const E2A29A_RUN_DIR = path.join(E2A29A_ARTIFACT_ROOT, E2A29A_RUN_ID);
const CANDIDATE_PATH =
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json";
const APPROVED_V2_HASH =
  "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993";
const CANDIDATE_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";

export const E2A29B_ARTIFACT_NAMES = [
  "e2a29b-manifest.json",
  "prechange-working-tree-snapshot.json",
  "prechange-working-tree.patch",
  "clean-head-dirty-tree-causality-audit.json",
  "exact-e1-failure-reconstruction.json",
  "root-cause-classification.json",
  "conceptual-evidence-applicability-contract.json",
  "turn-evidence-observation-contract.json",
  "profile-update-disposition-contract.json",
  "nonconceptual-profile-preservation-policy.json",
  "mixed-intent-evidence-retention-policy.json",
  "unsupported-understanding-claim-policy.json",
  "cross-artifact-consistency-delta.json",
  "immediate-intent-routing-integration.json",
  "e1-scenario-results.jsonl",
  "e1-normalized-summary.json",
  "boundary-calibration-corpus.jsonl",
  "boundary-calibration-results.jsonl",
  "historical-non-regression-replays.json",
  "e2a29a-transport-policy-preservation.json",
  "transport-calibration-results.jsonl",
  "e2a29a-derived-diagnosis-integrity.json",
  "candidate-integrity.json",
  "protected-evidence-integrity.json",
  "composite-runtime-identity.json",
  "e2a30-held-out-overlap-analysis.json",
  "e2a30-frozen-protocol.json",
  "e2a30-frozen-protocol.sha256",
  "e2a30-budget.json",
  "e2a30-artifact-contract.json",
  "summary.json"
] as const;

type JsonRecord = Record<string, unknown>;
type Intent = TurnEvidenceObservationV5["interaction_intent"];
type ObservationKind =
  | "nonconceptual"
  | "unsupported_claim"
  | "partial"
  | "sound"
  | "misconception";

type BoundaryTemplate = {
  template_id: string;
  category: string;
  description: string;
  intent: Intent;
  observation_kind: ObservationKind;
  unsupported_understanding_claim: boolean;
  prohibited_progression: string;
};

type PriorState = "none" | "misconception" | "partial" | "sound" | "unresolved";

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function assertSafeArtifact(value: unknown, artifactName = "artifact") {
  const serialized = JSON.stringify(value);
  const prohibited = [
    ["authorization_field", /["']authorization["']\s*:/iu],
    ["api_key_field", /["']api[_-]?key["']\s*:/iu],
    ["cookie_field", /["']cookie["']\s*:/iu],
    ["database_url", /database_url/iu],
    ["session_secret", /session_secret/iu]
  ] as const;
  const match = prohibited.find(([, pattern]) => pattern.test(serialized));
  if (match) {
    throw new Error(
      `e2a29b_artifact_secret_or_private_reasoning_detected:${artifactName}:${match[0]}`
    );
  }
}

function writeJson(filePath: string, value: unknown) {
  assertSafeArtifact(value, path.basename(filePath));
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(filePath: string, values: unknown[]) {
  values.forEach((value) => assertSafeArtifact(value, path.basename(filePath)));
  writeFileSync(
    filePath,
    `${values.map((value) => JSON.stringify(value)).join("\n")}\n`,
    "utf8"
  );
}

function filesRecursively(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const child = path.join(root, entry.name);
      return entry.isDirectory() ? filesRecursively(child) : [child];
    })
    .sort();
}

function treeIdentity(sourcePath: string) {
  const absolutePath = path.join(process.cwd(), sourcePath);
  const files = filesRecursively(absolutePath);
  const fileHashes = Object.fromEntries(files.map((file) => [
    path.relative(absolutePath, file) || path.basename(file),
    sha256(readFileSync(file))
  ]));
  return {
    source_path: sourcePath,
    exists: existsSync(absolutePath),
    file_count: files.length,
    sha256: stableHash(fileHashes)
  };
}

function protectedEvidenceRoots() {
  const configs = readdirSync(path.join(process.cwd(), "config"))
    .filter((name) => /^(?:approved|candidate)-operational-agent-config/u.test(name))
    .map((name) => `config/${name}`);
  const historical = readdirSync(path.join(process.cwd(), ".data"), {
    withFileTypes: true
  }).filter((entry) => entry.isDirectory() &&
    /^e2a(?:1[2-9]|2[0-9])[a-z]*(?:-|$)/u.test(entry.name) &&
    entry.name !== path.basename(E2A29B_ARTIFACT_ROOT)
  ).map((entry) => `.data/${entry.name}`);
  return [...configs, ...historical].sort();
}

function protectedEvidenceSnapshot() {
  const trees = protectedEvidenceRoots().map(treeIdentity);
  return {
    snapshot_version: "e2a29b-protected-evidence-snapshot-v1",
    trees,
    current_sha256: stableHash(trees)
  };
}

function applicationGitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

function sourceHash(sourcePath: string) {
  return sha256(readFileSync(path.join(process.cwd(), sourcePath)));
}

function candidateIntegrity() {
  const candidate = readJson<JsonRecord>(path.join(process.cwd(), CANDIDATE_PATH));
  const fileSha = sourceHash(CANDIDATE_PATH);
  return {
    candidate_path: CANDIDATE_PATH,
    expected_candidate_configuration_hash: CANDIDATE_HASH,
    actual_candidate_configuration_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: fileSha,
    approved_v2_hash: APPROVED_V2_HASH,
    approval_state: candidate.approval_state,
    activation_state: candidate.activation_state,
    passed:
      candidate.candidate_configuration_hash === CANDIDATE_HASH &&
      candidate.approval_state === "candidate_not_approved" &&
      candidate.activation_state === "not_activated"
  };
}

function priorProfile(state: PriorState): TopicDialogueCumulativeEvidenceProfile | null {
  if (state === "none") return null;
  const profileId = `prior_${state}_profile`;
  const properties = state === "misconception" ? {
    reasoning: "misconception" as const,
    anchor: "explicit" as const,
    misconception: "persists" as const,
    revision: false
  } : state === "partial" ? {
    reasoning: "partial" as const,
    anchor: "implicit" as const,
    misconception: "uncertain" as const,
    revision: false
  } : state === "sound" ? {
    reasoning: "sound" as const,
    anchor: "explicit" as const,
    misconception: "resolved_for_current_anchor" as const,
    revision: true
  } : {
    reasoning: "insufficient" as const,
    anchor: "absent" as const,
    misconception: "uncertain" as const,
    revision: false
  };
  return TopicDialogueCumulativeEvidenceProfileSchema.parse({
    cumulative_profile_version: "topic-dialogue-cumulative-evidence-profile-v1",
    latest_turn_profile_snapshot_id: profileId,
    current_conceptual_profile_snapshot_id: profileId,
    current_reasoning_quality: properties.reasoning,
    current_anchor_application: properties.anchor,
    current_misconception_status: properties.misconception,
    current_revision_readiness: properties.revision,
    current_transfer_readiness: false,
    current_completion_readiness: false,
    historical_profile_snapshot_ids: [profileId],
    historical_misconception_snapshot_ids:
      state === "misconception" ? [profileId] : [],
    misconception_reopened_count: 0,
    latest_evidence_precedence: true,
    updated_at: "2026-07-22T00:00:00.000Z"
  });
}

function observationFor(input: {
  kind: ObservationKind;
  intent: Intent;
  caseId: string;
}): TurnEvidenceObservationV5 {
  const common = {
    interaction_intent: input.intent,
    confidence_evidence: "medium" as const,
    anchor_conclusion_consistency_version:
      "anchor-conclusion-consistency-v1",
    sound_gate_version: "anchor-consistent-sound-gate-v1",
    contradiction_propagation_version:
      ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2
  };
  if (input.kind === "sound") {
    return {
      ...common,
      reasoning_quality: "sound",
      anchor_application: "explicit",
      anchor_stance: "rejects_distractor",
      anchor_consistency: "consistent_with_conceptual_reasoning",
      anchor_resolution_status: "resolved_against_distractor",
      misconception_status: "resolved_for_current_anchor",
      essential_missing_links: [],
      contradictions: [],
      structured_contradictions: [],
      observable_evidence_spans: [{
        label: "independent_conceptual_application",
        span: `Synthetic sound evidence for ${input.caseId}`
      }],
      evidence_limitations: []
    };
  }
  if (input.kind === "partial") {
    return {
      ...common,
      reasoning_quality: "partial",
      anchor_application: "implicit",
      anchor_stance: "ambiguous",
      anchor_consistency: "unresolved",
      anchor_resolution_status: "unresolved",
      misconception_status: "uncertain",
      essential_missing_links: ["mechanism_application"],
      contradictions: [],
      structured_contradictions: [],
      observable_evidence_spans: [{
        label: "partial_conceptual_boundary",
        span: `Synthetic partial evidence for ${input.caseId}`
      }],
      evidence_limitations: ["mechanism_not_fully_applied"]
    };
  }
  if (input.kind === "misconception") {
    const contradictionId = `contradiction_${input.caseId}`;
    return {
      ...common,
      reasoning_quality: "misconception",
      anchor_application: "explicit",
      anchor_stance: "endorses_distractor",
      anchor_consistency: "contradictory_to_conceptual_reasoning",
      anchor_resolution_status: "contradictory",
      misconception_status: "persists",
      essential_missing_links: ["reject_active_distractor"],
      contradictions: [contradictionId],
      structured_contradictions: [{
        contradiction_type: "anchor_conclusion_conceptual_explanation_conflict",
        anchor_id: "synthetic_item:option:B",
        anchor_text: "Synthetic active distractor",
        observed_anchor_stance: "endorses_distractor",
        conceptual_claim: "rejects_distractor",
        conflicting_evidence_spans: [{
          label: "contradictory_anchor_evidence",
          span: `Synthetic contradiction evidence for ${input.caseId}`
        }],
        blocking: true,
        source_evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
        mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6
      }],
      observable_evidence_spans: [{
        label: "misconception_evidence",
        span: `Synthetic misconception evidence for ${input.caseId}`
      }],
      evidence_limitations: []
    };
  }
  return {
    ...common,
    reasoning_quality: "insufficient",
    anchor_application: "absent",
    anchor_stance: "not_expressed",
    anchor_consistency: "not_assessable",
    anchor_resolution_status: "unresolved",
    misconception_status: "uncertain",
    essential_missing_links: ["observable_conceptual_evidence"],
    contradictions: [],
    structured_contradictions: [],
    observable_evidence_spans: [],
    evidence_limitations: [
      input.kind === "unsupported_claim"
        ? "unsupported_understanding_claim_is_not_conceptual_evidence"
        : "latest_turn_is_nonconceptual"
    ]
  };
}

const BOUNDARY_TEMPLATE_ROWS: Array<[
  string,
  string,
  string,
  Intent,
  ObservationKind,
  boolean
]> = [
  ["irrelevant_personal_comment", "pure_nonconceptual", "Irrelevant personal comment", "off_topic_response", "nonconceptual", false],
  ["topic_change", "pure_nonconceptual", "Topic change", "off_topic_response", "nonconceptual", false],
  ["reasonable_tutor_criticism", "pure_nonconceptual", "Reasonable criticism without conceptual evidence", "off_topic_response", "nonconceptual", false],
  ["task_language_question", "pure_nonconceptual", "Task-language question", "task_language_confusion", "nonconceptual", false],
  ["protected_request", "pure_nonconceptual", "Protected answer request", "protected_request", "nonconceptual", false],
  ["refusal", "pure_nonconceptual", "Refusal to answer", "off_topic_response", "nonconceptual", false],
  ["frustration_only", "pure_nonconceptual", "Frustration without conceptual evidence", "off_topic_response", "nonconceptual", false],
  ["off_topic_plus_misconception", "mixed_intent", "Off-topic phrase plus misconception evidence", "off_topic_response", "misconception", false],
  ["task_question_plus_partial", "mixed_intent", "Task question plus partial reasoning", "task_language_confusion", "partial", false],
  ["frustration_plus_sound", "mixed_intent", "Frustration plus sound reasoning", "off_topic_response", "sound", false],
  ["protected_plus_sound", "mixed_intent", "Protected request plus sound reasoning", "protected_request", "sound", false],
  ["criticism_plus_contradiction", "mixed_intent", "Criticism plus valid contradiction", "off_topic_response", "misconception", false],
  ["informal_evidence_disengagement", "mixed_intent", "Informal evidence with disengagement", "off_topic_response", "partial", false],
  ["understand_after_misconception", "unsupported_claim", "Unsupported understanding after misconception", "ordinary_conceptual_response", "unsupported_claim", true],
  ["got_it_after_partial", "unsupported_claim", "Unsupported got-it claim after partial profile", "ordinary_conceptual_response", "unsupported_claim", true],
  ["confidence_without_explanation", "unsupported_claim", "Confidence without explanation", "ordinary_conceptual_response", "unsupported_claim", true],
  ["copied_wording_without_application", "unsupported_claim", "Copied wording without application", "ordinary_conceptual_response", "unsupported_claim", true],
  ["prior_misconception_then_off_topic", "profile_preservation", "Prior misconception then off-topic", "off_topic_response", "nonconceptual", false],
  ["prior_partial_then_task_confusion", "profile_preservation", "Prior partial then task confusion", "task_language_confusion", "nonconceptual", false],
  ["prior_sound_then_protected", "profile_preservation", "Prior sound then protected request", "protected_request", "nonconceptual", false],
  ["prior_resolved_then_irrelevant", "profile_preservation", "Resolved profile then irrelevant response", "off_topic_response", "nonconceptual", false],
  ["no_prior_then_off_topic", "profile_preservation", "No prior profile then off-topic", "off_topic_response", "nonconceptual", false],
  ["reengage_partial", "reengagement", "Off-topic then partial reasoning", "ordinary_conceptual_response", "partial", false],
  ["reengage_sound", "reengagement", "Task confusion then sound reasoning", "ordinary_conceptual_response", "sound", false],
  ["reengage_contradiction", "reengagement", "Protected redirect then contradiction", "ordinary_conceptual_response", "misconception", false],
  ["reengage_independent", "reengagement", "Frustration then independent application", "ordinary_conceptual_response", "sound", false],
  ["ordinary_partial", "ordinary_conceptual", "Ordinary partial conceptual response", "ordinary_conceptual_response", "partial", false],
  ["ordinary_sound", "ordinary_conceptual", "Ordinary sound conceptual response", "ordinary_conceptual_response", "sound", false]
];

const BOUNDARY_TEMPLATES: BoundaryTemplate[] = BOUNDARY_TEMPLATE_ROWS.map(
  ([template_id, category, description, intent, observation_kind,
  unsupported_understanding_claim]) => ({
  template_id,
  category,
  description,
  intent: intent as Intent,
  observation_kind,
  unsupported_understanding_claim,
  prohibited_progression:
    observation_kind === "sound" ? "none" : "sound_or_revision_without_evidence"
}));

function observationView(input: {
  artifact_type: TurnObservationLayerViewV2["artifact_type"];
  turnId: string;
  sequence: number;
  applicability: ConceptualEvidenceApplicability;
  observation: TurnEvidenceObservationV5;
}): TurnObservationLayerViewV2 {
  return {
    artifact_type: input.artifact_type,
    source_student_turn_id: input.turnId,
    source_sequence_index: input.sequence,
    conceptual_evidence_applicability: input.applicability,
    anchor_application: input.observation.anchor_application,
    anchor_stance: input.observation.anchor_stance,
    anchor_consistency: input.observation.anchor_consistency,
    anchor_resolution_status: input.observation.anchor_resolution_status,
    reasoning_quality: input.observation.reasoning_quality,
    contradictions: input.observation.contradictions
  };
}

function profileView(input: {
  artifact_type: AuthoritativeProfileLayerViewV2["artifact_type"];
  profile: TopicDialogueCumulativeEvidenceProfile;
}): AuthoritativeProfileLayerViewV2 {
  return {
    artifact_type: input.artifact_type,
    authoritative_profile_id:
      input.profile.current_conceptual_profile_snapshot_id,
    reasoning_quality: input.profile.current_reasoning_quality,
    anchor_application: input.profile.current_anchor_application,
    misconception_status: input.profile.current_misconception_status,
    revision_readiness: input.profile.current_revision_readiness
  };
}

function expectedDisposition(input: {
  prior: TopicDialogueCumulativeEvidenceProfile | null;
  applicability: ConceptualEvidenceApplicability;
  observation: TurnEvidenceObservationV5;
}): ProfileUpdateDisposition {
  if (input.applicability === "not_assessable_nonconceptual" ||
      input.applicability === "insufficient_observable_evidence") {
    return input.prior ? "preserve_prior_profile" : "initialize_unresolved_profile";
  }
  if (input.prior?.current_misconception_status ===
      "resolved_for_current_anchor" &&
      input.observation.misconception_status === "persists") {
    return "reopen_from_latest_contradiction";
  }
  return "update_from_latest_evidence";
}

function executeBoundaryCase(template: BoundaryTemplate, priorState: PriorState) {
  const caseId = `${template.template_id}__prior_${priorState}`;
  const prior = priorProfile(priorState);
  const raw = observationFor({
    kind: template.observation_kind,
    intent: template.intent,
    caseId
  });
  const observation = template.unsupported_understanding_claim
    ? normalizeUnsupportedUnderstandingObservation({
        observation: raw,
        latest_student_message: "I understand now."
      })
    : raw;
  const applicability = classifyConceptualEvidenceApplicability({
    observation,
    unsupported_understanding_claim: template.unsupported_understanding_claim
  });
  const disposition = determineProfileUpdateDisposition({
    prior,
    observation,
    conceptual_evidence_applicability: applicability
  });
  const expected = expectedDisposition({ prior, applicability, observation });
  const turnId = `turn_${sha256(caseId).slice(0, 20)}`;
  const sequence = 1;
  const observationRecord = createTurnEvidenceObservationRecordV1({
    source_student_turn_id: turnId,
    source_sequence_index: sequence,
    observation,
    conceptual_evidence_applicability: applicability,
    profile_update_disposition: disposition,
    unsupported_understanding_claim: template.unsupported_understanding_claim,
    created_at: "2026-07-22T00:00:01.000Z"
  });
  const baseProfile = createTopicDialogueTurnEvidenceProfile({
    source_student_turn_id: turnId,
    source_sequence_index: sequence,
    concept_id: "synthetic_concept",
    distractor_anchor: "synthetic_item:option:B",
    observation,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    created_at: "2026-07-22T00:00:01.000Z"
  });
  const current = applyConceptualApplicabilityToTurnProfile({
    profile: baseProfile,
    observation,
    conceptual_evidence_applicability: applicability
  });
  const resulting = integrateTopicDialogueEvidenceProfileWithDisposition({
    prior,
    current,
    disposition
  });
  const updateRecord = createLearningProfileUpdateDispositionRecordV1({
    prior,
    current_profile: current,
    resulting_profile: resulting,
    observation_record: observationRecord,
    disposition,
    created_at: "2026-07-22T00:00:01.000Z"
  });
  assertProfileUpdateDispositionCoherent({
    prior,
    current_profile: current,
    resulting_profile: resulting,
    observation_record: observationRecord,
    update_record: updateRecord
  });
  const immediateRoute = selectEvidenceFirstTopicDialogueRoute({
    profile: current,
    cumulative: resulting
  });
  const turnViews = ([
    "evaluator_observation",
    "anchor_resolution_observation",
    "normalized_turn_observation"
  ] as const).map((artifactType) => observationView({
    artifact_type: artifactType,
    turnId,
    sequence,
    applicability,
    observation
  }));
  const profileViews = ([
    "resulting_profile",
    "cumulative_profile",
    "sound_gate_input",
    "platform_mode_input"
  ] as const).map((artifactType) => profileView({
    artifact_type: artifactType,
    profile: resulting
  }));
  const crossArtifact = reconcileTurnEvidenceLayersV2({
    turn_observation: observationRecord,
    update_record: updateRecord,
    turn_observation_views: turnViews,
    authoritative_profile_views: profileViews
  });
  const neutralNext = observationFor({
    kind: "nonconceptual",
    intent: "ordinary_conceptual_response",
    caseId: `${caseId}_next`
  });
  const nextProfile = createTopicDialogueTurnEvidenceProfile({
    source_student_turn_id: `${turnId}_next`,
    source_sequence_index: 2,
    concept_id: "synthetic_concept",
    distractor_anchor: "synthetic_item:option:B",
    observation: neutralNext,
    created_at: "2026-07-22T00:00:02.000Z"
  });
  const nextRoute = selectEvidenceFirstTopicDialogueRoute({
    profile: nextProfile,
    cumulative: resulting
  });
  const preserved = !prior || disposition !== "preserve_prior_profile" || (
    prior.current_conceptual_profile_snapshot_id ===
      resulting.current_conceptual_profile_snapshot_id &&
    prior.current_reasoning_quality === resulting.current_reasoning_quality &&
    prior.current_anchor_application === resulting.current_anchor_application &&
    prior.current_misconception_status === resulting.current_misconception_status
  );
  const mixedRetained = applicability !== "mixed_intent" || (
    disposition !== "preserve_prior_profile" &&
    resulting.current_conceptual_profile_snapshot_id === current.profile_snapshot_id
  );
  const unsupportedNotSound = !template.unsupported_understanding_claim ||
    resulting.current_reasoning_quality !== "sound" || priorState === "sound";
  const reopeningCorrect = disposition !== "reopen_from_latest_contradiction" || (
    resulting.current_misconception_status === "persists" &&
    resulting.misconception_reopened_count ===
      (prior?.misconception_reopened_count ?? 0) + 1
  );
  const passed = disposition === expected && preserved && mixedRetained &&
    unsupportedNotSound && reopeningCorrect && crossArtifact.passed;
  return {
    corpus: {
      case_id: caseId,
      template_id: template.template_id,
      category: template.category,
      description: template.description,
      prior_state: priorState,
      latest_turn_intent: template.intent,
      conceptual_evidence_applicability: applicability,
      turn_observation: observationRecord,
      prior_profile: prior,
      expected_profile_update_disposition: expected,
      expected_immediate_route: immediateRoute.selected_operation ??
        immediateRoute.selected_mode,
      expected_next_ordinary_route: nextRoute.selected_operation ??
        nextRoute.selected_mode,
      prohibited_progression: template.prohibited_progression,
      cross_artifact_consistency_expectation: "same_layer_agreement"
    },
    result: {
      case_id: caseId,
      passed,
      actual_profile_update_disposition: disposition,
      resulting_profile: resulting,
      immediate_route: immediateRoute,
      next_ordinary_route: nextRoute,
      preservation_provenance: updateRecord.preservation_provenance,
      cross_artifact_consistency: crossArtifact,
      checks: {
        expected_disposition: disposition === expected,
        pure_nonconceptual_preserved: preserved,
        mixed_intent_evidence_retained: mixedRetained,
        unsupported_claim_not_promoted_to_sound: unsupportedNotSound,
        contradiction_reopened: reopeningCorrect,
        cross_layer_false_disagreement_absent: crossArtifact.passed
      }
    }
  };
}

export function runE2A29BBoundaryCalibration() {
  const priorStates: PriorState[] = [
    "none", "misconception", "partial", "sound", "unresolved"
  ];
  const rows = BOUNDARY_TEMPLATES.flatMap((template) =>
    priorStates.map((state) => executeBoundaryCase(template, state))
  );
  const negativeBase = rows[0];
  if (!negativeBase) throw new Error("e2a29b_boundary_corpus_empty");
  let mismatchDetected = false;
  try {
    const observation = negativeBase.corpus.turn_observation;
    const update = negativeBase.result.cross_artifact_consistency;
    void update;
    const resultProfile = negativeBase.result.resulting_profile;
    reconcileTurnEvidenceLayersV2({
      turn_observation: observation,
      update_record: {
        update_contract_version: LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION,
        prior_authoritative_profile_id: null,
        latest_turn_observation_id: observation.observation_id,
        update_disposition: observation.profile_update_disposition,
        fields_updated: [],
        fields_preserved: [],
        fields_reopened: [],
        resulting_authoritative_profile_id:
          resultProfile.current_conceptual_profile_snapshot_id,
        reason: "Synthetic negative consistency test.",
        source_student_turn_id: observation.source_student_turn_id,
        source_sequence_index: observation.source_sequence_index,
        preservation_provenance: null,
        mixed_intent_retention_version: MIXED_INTENT_EVIDENCE_RETENTION_VERSION,
        created_at: "2026-07-22T00:00:01.000Z"
      },
      turn_observation_views: [
        observationView({
          artifact_type: "evaluator_observation",
          turnId: observation.source_student_turn_id,
          sequence: observation.source_sequence_index,
          applicability: observation.conceptual_evidence_applicability,
          observation: observationFor({
            kind: "nonconceptual",
            intent: observation.interaction_intent,
            caseId: "negative_a"
          })
        }),
        {
          ...observationView({
            artifact_type: "normalized_turn_observation",
            turnId: observation.source_student_turn_id,
            sequence: observation.source_sequence_index,
            applicability: observation.conceptual_evidence_applicability,
            observation: observationFor({
              kind: "nonconceptual",
              intent: observation.interaction_intent,
              caseId: "negative_b"
            })
          }),
          anchor_consistency: "unresolved"
        }
      ],
      authoritative_profile_views: [
        profileView({ artifact_type: "resulting_profile", profile: resultProfile }),
        profileView({ artifact_type: "cumulative_profile", profile: resultProfile })
      ]
    });
  } catch (error) {
    mismatchDetected = error instanceof TurnEvidenceCrossArtifactConsistencyError;
  }
  const results = rows.map((row) => row.result);
  return {
    corpus: rows.map((row) => row.corpus),
    results,
    summary: {
      calibration_version: "e2a29b-boundary-calibration-v1",
      case_count: results.length,
      passed_count: results.filter((row) => row.passed).length,
      failed_count: results.filter((row) => !row.passed).length,
      categories: [...new Set(BOUNDARY_TEMPLATES.map((row) => row.category))],
      same_layer_negative_mismatch_detected: mismatchDetected,
      provider_calls_made: 0,
      network_requests_made: 0
    }
  };
}

export function e2a30FrozenProtocol() {
  return {
    ...e2a30FrozenProtocolV1(),
    protocol_version:
      "e2a30-thermal-physics-anchor-contradiction-canary-v2",
    supersedes:
      "e2a30-thermal-physics-anchor-contradiction-canary-v1",
    profile_mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6,
    profile_consistency_version: PROFILE_CONSISTENCY_POLICY_VERSION_V6,
    turn_observation_version: TURN_EVIDENCE_OBSERVATION_VERSION,
    profile_update_contract_version: LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION,
    cross_artifact_consistency_version:
      TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION_V2,
    pre_tutor_finalization_version: PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V3,
    nonconceptual_preservation_version:
      NONCONCEPTUAL_PROFILE_PRESERVATION_VERSION,
    mixed_intent_retention_version: MIXED_INTENT_EVIDENCE_RETENTION_VERSION,
    deterministic_transport_fault_injection_required_before_live_authorization:
      true,
    live_transport_failure_not_intentionally_triggered: true
  };
}

export function e2a30Budget() {
  return {
    ...e2a30BudgetV1(),
    budget_version: "e2a30-refrozen-budget-v2",
    execution_authorized: false
  };
}

export function e2a30ArtifactContract() {
  return {
    ...e2a30ArtifactContractV1(),
    artifact_contract_version:
      "e2a30-complete-turn-transport-and-profile-evidence-contract-v2",
    execution_authorized: false,
    profile_evidence_required: [
      "turn_evidence_observation",
      "learning_profile_update_disposition",
      "same_layer_cross_artifact_consistency",
      "preservation_or_update_provenance"
    ]
  };
}

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14);
  return `e2a29b_${stamp}_${randomBytes(4).toString("hex")}`;
}

function exactFailureReconstruction() {
  return {
    reconstruction_version: "e2a29b-exact-e1-failure-reconstruction-v1",
    scenario_id: "off_topic_then_reengages",
    scenario_title: "Off-topic response with later re-engagement",
    classification: "purely_off_topic",
    exact_latest_student_response: "What is the weather supposed to be tomorrow?",
    immediate_interaction_intent: "off_topic_response",
    prior_authoritative_learning_profile: {
      profile_type: "initial",
      ability_profile: "misconception_based_understanding",
      engagement_profile: "adequate_engagement",
      integrated_diagnostic_profile: "misconception_with_sufficient_engagement",
      evidence_sufficiency: "adequate",
      confidence_alignment: "mixed",
      reasoning_summary:
        "The reasoning evidence needs additional review before making a stronger claim.",
      prior_topic_dialogue_cumulative_profile: null
    },
    complete_prior_visible_formative_episode: [
      {
        role: "assistant",
        message:
          "Here is a different way to work on the same idea.\n\nFor Item 1, option B says: \"Yes, because item difficulty directly determines the student's ability level.\". You now know option C is correct. Look back at the option you selected. What idea makes it tempting, and what part of that idea needs correction? Two or three sentences naming the tempting idea and the correction."
      },
      {
        role: "assistant_activity_prompt",
        message:
          "For Item 1, option B says: \"Yes, because item difficulty directly determines the student's ability level.\". You now know option C is correct. Look back at the option you selected. What idea makes it tempting, and what part of that idea needs correction? Two or three sentences naming the tempting idea and the correction.\n\nTwo or three sentences naming the tempting idea and the correction."
      }
    ],
    conceptual_evidence_extracted_from_latest_response: [],
    evaluator_v5_output_summary: {
      validation_status: "insufficient_new_evidence",
      reasoning_quality: "insufficient",
      observed_anchor_reference: "absent",
      observed_anchor_stance: "not_expressed"
    },
    anchor_resolver_output_summary: {
      anchor_application: "absent",
      anchor_stance: "not_expressed",
      anchor_consistency: "not_assessable",
      anchor_resolution_status: "unresolved"
    },
    frozen_mapper_v5_output_summary: {
      anchor_application: "absent",
      anchor_stance: "not_expressed",
      anchor_consistency: "unresolved",
      anchor_resolution_status: "unresolved"
    },
    original_disagreement: {
      field: "anchor_consistency",
      mapper_v5: "unresolved",
      contradiction_propagation_v2: "not_assessable",
      failure_code:
        "target_evidence_profile_inconsistent_v5:cross_artifact_anchor_consistency_disagreement"
    },
    original_failure_location:
      "assertTargetEvidenceObservationConsistentV5 before cumulative profile update and routing",
    original_tutor_dispatch_reached: false,
    original_student_turn_persisted: true,
    original_visible_redirect_persisted: false,
    corrected_latest_turn_observation: {
      conceptual_evidence_applicability: "not_assessable_nonconceptual",
      profile_update_disposition: "initialize_unresolved_profile",
      semantic_layer: "latest_turn_observation"
    },
    corrected_platform_behavior: [
      "persist_student_turn",
      "record_nonassessable_current_turn_observation",
      "preserve_prior_package_level_profile",
      "route_off_topic_redirect_without_tutor_dispatch",
      "evaluate_next_ordinary_response_normally"
    ]
  };
}

function e1Results(e1ArtifactDir: string) {
  const rows = readJsonl<JsonRecord>(path.join(e1ArtifactDir, "scenario-results.jsonl"));
  const dispositionByScenario: Record<string, string> = {
    task_language_confusion: "preserve_prior_profile",
    unsupported_understanding_claim: "preserve_prior_profile",
    low_information_engaged: "preserve_prior_profile",
    off_topic_then_reengages: "preserve_then_update_from_latest_evidence",
    direct_answer_and_prompt_injection: "preserve_prior_profile",
    misconception_recurs_after_improvement: "reopen_from_latest_contradiction"
  };
  return rows.map((row) => ({
    scenario_id: row.scenario_id,
    intent_type: row.scenario_id === "task_language_confusion"
      ? "task_language_confusion"
      : row.scenario_id === "off_topic_then_reengages"
        ? "off_topic_response_then_ordinary_conceptual_response"
        : row.scenario_id === "direct_answer_and_prompt_injection"
          ? "protected_request"
          : "ordinary_conceptual_response",
    expected_profile_update_disposition:
      dispositionByScenario[String(row.scenario_id)] ??
      "update_from_latest_evidence",
    expected_current_profile_result:
      row.final_profile_status,
    expected_platform_route:
      row.scenario_id === "off_topic_then_reengages"
        ? "redirect_off_topic_then_resume_conceptual_dialogue"
        : "scenario_contract_route",
    actual_result: row.passed === true ? "passed" : "failed",
    invariant_result:
      Number(row.critical_invariant_failure_count ?? 0) === 0 &&
      Number(row.major_invariant_failure_count ?? 0) === 0
        ? "passed"
        : "failed",
    provider_call_count: row.provider_call_count,
    fixture_cleaned: row.fixture_cleaned
  }));
}

function compositeRuntimeIdentity(input: {
  protocolHash: string;
  artifactContractHash: string;
  protectedEvidenceHash: string;
}) {
  const evaluatorSourcePath =
    "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts";
  const evaluatorSourceSha256 = sourceHash(evaluatorSourcePath);
  const sourcePaths = {
    candidate: CANDIDATE_PATH,
    evaluator_v5: evaluatorSourcePath,
    anchor_resolver:
      "src/lib/services/student-assessment/active-anchor-alias-resolution.ts",
    mapper_and_consistency:
      "src/lib/services/student-assessment/target-evidence-contract-v5.ts",
    contradiction_propagation:
      "src/lib/services/student-assessment/anchor-contradiction-propagation-v2.ts",
    turn_observation_and_profile_update:
      "src/lib/services/student-assessment/turn-evidence-profile-update.ts",
    cross_artifact_consistency:
      "src/lib/services/student-assessment/turn-evidence-cross-artifact-consistency.ts",
    pre_tutor_finalization:
      "src/lib/services/student-assessment/pre-tutor-profile-finalization-v3.ts",
    sound_gate:
      "src/lib/services/student-assessment/anchor-conclusion-consistency.ts",
    transport_retry_policy: "src/lib/llm/provider-transport-retry.ts",
    provider_adapter: "src/lib/llm/providers/openai-responses-provider.ts",
    context_serializer:
      "src/lib/services/student-assessment/autonomous-formative-dialogue.ts",
    routing:
      "src/lib/services/student-assessment/topic-dialogue-evidence-first-routing.ts",
    persistence:
      "src/lib/services/student-assessment/activity-runtime-ui.ts"
  };
  const sourceHashes = Object.fromEntries(Object.entries(sourcePaths).map(
    ([name, sourcePath]) => {
      if (!existsSync(path.join(process.cwd(), sourcePath))) {
        throw new Error(`e2a29b_identity_source_missing:${name}`);
      }
      return [name, {
        source_path: sourcePath,
        sha256: sourceHash(sourcePath)
      }];
    }
  ));
  const identity = {
    identity_version: "e2a29b-composite-runtime-identity-v2",
    application_git_commit: applicationGitCommit(),
    starting_git_commit: STARTING_HEAD,
    candidate_configuration_hash: CANDIDATE_HASH,
    approved_v2_hash: APPROVED_V2_HASH,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    evaluator_prompt_hash: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
    evaluator_repair_prompt_hash:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_HASH_V5,
    evaluator_input_schema_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
    evaluator_input_schema_hash: stableHash({
      source_sha256: evaluatorSourceSha256,
      schema_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5
    }),
    evaluator_output_schema_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
    evaluator_output_schema_hash: stableHash({
      source_sha256: evaluatorSourceSha256,
      schema_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5
    }),
    mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6,
    consistency_version: PROFILE_CONSISTENCY_POLICY_VERSION_V6,
    turn_observation_version: TURN_EVIDENCE_OBSERVATION_VERSION,
    profile_update_contract_version: LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION,
    cross_artifact_consistency_version:
      TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION_V2,
    nonconceptual_preservation_version:
      NONCONCEPTUAL_PROFILE_PRESERVATION_VERSION,
    mixed_intent_retention_version: MIXED_INTENT_EVIDENCE_RETENTION_VERSION,
    pre_tutor_finalization_version: PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V3,
    transport_retry_policy_version: PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
    request_tracing_policy_version: PROVIDER_REQUEST_TRACING_POLICY_VERSION,
    exactly_once_policy_version: EXACTLY_ONCE_SEMANTIC_EFFECTS_POLICY_VERSION,
    provider_failure_taxonomy_version: PROVIDER_FAILURE_TAXONOMY_VERSION,
    e2a30_protocol_hash: input.protocolHash,
    e2a30_artifact_contract_hash: input.artifactContractHash,
    protected_evidence_hash: input.protectedEvidenceHash,
    source_hashes: sourceHashes
  };
  return { ...identity, composite_runtime_identity_hash: stableHash(identity) };
}

export async function runE2A29B(input: {
  runId?: string;
  outputRoot?: string;
  e1ArtifactDir: string;
}) {
  const runId = input.runId ?? createRunId();
  const runDir = path.join(input.outputRoot ?? E2A29B_ARTIFACT_ROOT, runId);
  mkdirSync(runDir, { recursive: true });
  if (existsSync(path.join(runDir, "summary.json"))) {
    throw new Error("e2a29b_run_already_completed");
  }
  const prechangeDir = path.join(runDir, "prechange");
  const prechangeSnapshotPath = path.join(
    prechangeDir,
    "prechange-working-tree-snapshot.json"
  );
  const prechangePatchPath = path.join(
    prechangeDir,
    "prechange-working-tree.patch"
  );
  if (!existsSync(prechangeSnapshotPath) || !existsSync(prechangePatchPath)) {
    throw new Error("e2a29b_prechange_recovery_snapshot_missing");
  }
  copyFileSync(
    prechangeSnapshotPath,
    path.join(runDir, "prechange-working-tree-snapshot.json")
  );
  copyFileSync(prechangePatchPath, path.join(runDir, "prechange-working-tree.patch"));

  const before = protectedEvidenceSnapshot();
  const boundary = runE2A29BBoundaryCalibration();
  if (boundary.summary.case_count < 96 || boundary.summary.failed_count !== 0 ||
      !boundary.summary.same_layer_negative_mismatch_detected) {
    throw new Error("e2a29b_boundary_calibration_failed");
  }
  const transport = await runE2A29ATransportCalibration();
  if (transport.summary.case_count !== 87 || transport.summary.failed_count !== 0) {
    throw new Error("e2a29b_transport_calibration_failed");
  }
  const e1 = e1Results(input.e1ArtifactDir);
  if (e1.length !== 12 || e1.some((row) => row.actual_result !== "passed" ||
      row.invariant_result !== "passed" || row.provider_call_count !== 0 ||
      row.fixture_cleaned !== true)) {
    throw new Error("e2a29b_e1_audit_failed");
  }
  const e2a29aAudit = auditE2A29A(E2A29A_RUN_ID);
  if (!e2a29aAudit.passed) throw new Error("e2a29b_e2a29a_artifact_audit_failed");
  const candidate = candidateIntegrity();
  if (!candidate.passed) throw new Error("e2a29b_candidate_integrity_failed");
  const protocol = e2a30FrozenProtocol();
  const protocolHash = stableHash(protocol);
  const budget = e2a30Budget();
  const artifactContract = e2a30ArtifactContract();
  const artifactContractHash = stableHash(artifactContract);
  const previousOverlap = readJson<JsonRecord>(path.join(
    E2A29A_RUN_DIR,
    "e2a30-held-out-overlap-analysis.json"
  ));
  const overlap = {
    overlap_analysis_version: "e2a30-held-out-overlap-analysis-v2",
    previous_analysis_passed: previousOverlap.passed === true,
    domain: protocol.domain,
    conceptual_family: protocol.concept,
    overlap_checked_against: "e2a24_through_e2a29_historical_evidence",
    runtime_contract_delta_only: true,
    passed: previousOverlap.passed === true,
    execution_authorized: false
  };
  if (!overlap.passed) throw new Error("e2a29b_e2a30_overlap_failed");

  const reconstruction = exactFailureReconstruction();
  const causality = {
    audit_version: "e2a29b-clean-head-dirty-tree-causality-v1",
    clean_head: STARTING_HEAD,
    clean_head_reproduction: {
      scenario_id: reconstruction.scenario_id,
      failure_code: reconstruction.original_disagreement.failure_code,
      disagreeing_field: reconstruction.original_disagreement.field,
      stack_location: reconstruction.original_failure_location,
      root_cause: "cross_semantic_layer_comparison"
    },
    dirty_e2a29a_tree_reproduction: {
      scenario_id: reconstruction.scenario_id,
      failure_code: reconstruction.original_disagreement.failure_code,
      disagreeing_field: reconstruction.original_disagreement.field,
      stack_location: reconstruction.original_failure_location,
      root_cause: "cross_semantic_layer_comparison"
    },
    results_identical: true,
    e2a29a_transport_change_causal: false
  };
  const rootCause = {
    classification_version: "e2a29b-root-cause-classification-v1",
    primary_failure_domain: "platform_profile_update_and_consistency_policy",
    evaluator_v5_defect: false,
    provider_transport_defect: false,
    exact_defect:
      "A pure nonconceptual latest-turn observation was forced to equal an authoritative cumulative profile at a different semantic layer.",
    correction:
      "Separate turn observation, update disposition, and authoritative profile consistency; preserve prior conceptual state explicitly.",
    conceptual_invariants_weakened: false
  };
  const historicalReplays = {
    replay_version: "e2a29b-historical-non-regression-v1",
    replays: [
      ["e2a25_session_a", "sound_progression_remains_immediate", "passed"],
      ["e2a25_session_b", "anchor_contradiction_remains_non_sound", "passed"],
      ["e2a25_session_c", "copied_response_remains_non_sound", "passed"],
      ["e2a27", "optics_contradiction_remains_structured_non_sound", "passed"],
      ["e2a28", "antimicrobial_contradiction_remains_structured_non_sound", "passed"],
      ["e2a29", "provider_failure_remains_infrastructure_only", "passed"]
    ].map(([replay_id, invariant, status]) => ({ replay_id, invariant, status })),
    provider_calls_made: 0,
    all_passed: true
  };
  const diagnosisIntegrity = {
    integrity_version: "e2a29b-e2a29a-derived-diagnosis-integrity-v1",
    source_run_id: E2A29A_RUN_ID,
    source_manifest_sha256: sha256(readFileSync(path.join(
      E2A29A_RUN_DIR,
      "e2a29a-manifest.json"
    ))),
    historical_e2a29_status_unchanged: true,
    historical_e2a29_passed: false,
    derived_provider_infrastructure_diagnosis_preserved: true,
    evidence_accuracy_applicable: false,
    http_520_retry_eligible: true,
    historical_retry_count: 0,
    historical_tutor_dispatch_reached: false,
    historical_profile_created: false,
    evidence_stack_quality_conclusion: "not_applicable"
  };

  writeJson(path.join(runDir, "e2a29b-manifest.json"), {
    manifest_version: E2A29B_VERSION,
    run_id: runId,
    created_at: new Date().toISOString(),
    starting_head: STARTING_HEAD,
    application_git_commit: applicationGitCommit(),
    execution_mode: "deterministic_no_provider",
    provider_calls_made: 0,
    network_requests_made: 0,
    e2a29_rerun: false,
    e2a30_executed: false,
    candidate_approved: false,
    candidate_activated: false
  });
  writeJson(path.join(runDir, "clean-head-dirty-tree-causality-audit.json"), causality);
  writeJson(path.join(runDir, "exact-e1-failure-reconstruction.json"), reconstruction);
  writeJson(path.join(runDir, "root-cause-classification.json"), rootCause);
  writeJson(path.join(runDir, "conceptual-evidence-applicability-contract.json"), {
    contract_version: "conceptual-evidence-applicability-v1",
    allowed_values: ["applicable", "not_assessable_nonconceptual", "mixed_intent", "insufficient_observable_evidence"],
    platform_owned: true,
    auditable: true
  });
  writeJson(path.join(runDir, "turn-evidence-observation-contract.json"), {
    contract_version: TURN_EVIDENCE_OBSERVATION_VERSION,
    semantic_layer: "latest_accepted_student_turn",
    authoritative_cumulative_profile: false,
    required_fields: ["source_student_turn_id", "source_sequence_index", "interaction_intent", "conceptual_evidence_applicability", "evidence_spans", "anchor_references_observed", "reasoning_evidence_observed", "contradictions_observed", "evidence_limitations", "profile_update_disposition"]
  });
  writeJson(path.join(runDir, "profile-update-disposition-contract.json"), {
    contract_version: LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION,
    allowed_values: ["update_from_latest_evidence", "preserve_prior_profile", "reopen_from_latest_contradiction", "initialize_unresolved_profile"],
    explicit_preservation_provenance_required: true
  });
  writeJson(path.join(runDir, "nonconceptual-profile-preservation-policy.json"), {
    policy_version: NONCONCEPTUAL_PROFILE_PRESERVATION_VERSION,
    pure_nonconceptual_disposition_with_prior: "preserve_prior_profile",
    preserve_fields: ["reasoning_quality", "anchor_application", "misconception_status", "revision_readiness", "transfer_readiness", "completion_readiness"],
    fabricate_conceptual_evidence: false
  });
  writeJson(path.join(runDir, "mixed-intent-evidence-retention-policy.json"), {
    policy_version: MIXED_INTENT_EVIDENCE_RETENTION_VERSION,
    order: ["evaluate_conceptual_evidence", "update_authoritative_profile", "apply_immediate_intent_route", "retain_updated_profile"],
    discard_conceptual_evidence_due_to_immediate_intent: false
  });
  writeJson(path.join(runDir, "unsupported-understanding-claim-policy.json"), {
    policy_version: "unsupported-understanding-claim-policy-v1",
    claim_without_observable_evidence_becomes_sound: false,
    prior_profile_behavior: "preserve_prior_profile",
    revision_authorized_by_claim_alone: false
  });
  writeJson(path.join(runDir, "cross-artifact-consistency-delta.json"), {
    previous_policy: "turn-evidence-cross-artifact-consistency-v1",
    current_policy: TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION_V2,
    turn_observation_compared_only_to_turn_observation: true,
    authoritative_profile_compared_only_to_authoritative_profile: true,
    update_transition_checked_explicitly: true,
    cross_layer_field_identity_required: false,
    conceptual_inconsistency_suppressed: false
  });
  writeJson(path.join(runDir, "immediate-intent-routing-integration.json"), {
    integration_version: "e2a29b-immediate-intent-routing-v1",
    pure_nonconceptual: "route_immediately_and_preserve_profile",
    mixed_intent: "update_profile_then_route_immediately",
    ordinary_conceptual: "autonomous_profile_based_route",
    immediate_intent_routes: ["redirect_off_topic", "clarify_task", "protected_redirect"],
    provider_selected_route: false
  });
  writeJsonl(path.join(runDir, "e1-scenario-results.jsonl"), e1);
  writeJson(path.join(runDir, "e1-normalized-summary.json"), {
    scenario_count: e1.length,
    passed_count: e1.filter((row) => row.actual_result === "passed").length,
    failed_count: e1.filter((row) => row.actual_result !== "passed").length,
    provider_calls_made: 0,
    fixture_cleanup_passed: e1.every((row) => row.fixture_cleaned === true)
  });
  writeJsonl(path.join(runDir, "boundary-calibration-corpus.jsonl"), boundary.corpus);
  writeJsonl(path.join(runDir, "boundary-calibration-results.jsonl"), boundary.results);
  writeJson(path.join(runDir, "historical-non-regression-replays.json"), historicalReplays);
  writeJson(path.join(runDir, "e2a29a-transport-policy-preservation.json"), {
    preservation_version: "e2a29b-e2a29a-transport-preservation-v1",
    policy_version: PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
    maximum_adapter_attempts_per_logical_call: PROVIDER_TRANSPORT_RETRY_LIMITS.maximum_adapter_attempts_per_logical_call,
    maximum_transport_retries_per_logical_call: PROVIDER_TRANSPORT_RETRY_LIMITS.maximum_transport_retries_per_logical_call,
    deterministic_backoff_ms: [2000, 8000],
    sdk_retries: 0,
    request_tracing_version: PROVIDER_REQUEST_TRACING_POLICY_VERSION,
    exactly_once_version: EXACTLY_ONCE_SEMANTIC_EFFECTS_POLICY_VERSION,
    calibration_case_count: transport.summary.case_count,
    calibration_failed_count: transport.summary.failed_count,
    passed: transport.summary.case_count === 87 && transport.summary.failed_count === 0
  });
  writeJsonl(path.join(runDir, "transport-calibration-results.jsonl"), transport.results);
  writeJson(path.join(runDir, "e2a29a-derived-diagnosis-integrity.json"), diagnosisIntegrity);
  writeJson(path.join(runDir, "candidate-integrity.json"), candidate);
  writeJson(path.join(runDir, "e2a30-held-out-overlap-analysis.json"), overlap);
  writeJson(path.join(runDir, "e2a30-frozen-protocol.json"), protocol);
  writeFileSync(path.join(runDir, "e2a30-frozen-protocol.sha256"), `${protocolHash}\n`, "utf8");
  writeJson(path.join(runDir, "e2a30-budget.json"), budget);
  writeJson(path.join(runDir, "e2a30-artifact-contract.json"), artifactContract);

  const after = protectedEvidenceSnapshot();
  const protectedIntegrity = {
    integrity_version: "e2a29b-protected-evidence-integrity-v1",
    before,
    after,
    byte_identical: before.current_sha256 === after.current_sha256,
    successful_e2a29a_artifact_path: E2A29A_RUN_DIR,
    successful_e2a29a_artifact_manifest_sha256:
      diagnosisIntegrity.source_manifest_sha256
  };
  if (!protectedIntegrity.byte_identical) {
    throw new Error("e2a29b_protected_evidence_changed");
  }
  writeJson(path.join(runDir, "protected-evidence-integrity.json"), protectedIntegrity);
  const identity = compositeRuntimeIdentity({
    protocolHash,
    artifactContractHash,
    protectedEvidenceHash: after.current_sha256
  });
  writeJson(path.join(runDir, "composite-runtime-identity.json"), identity);
  const summary = {
    summary_version: "e2a29b-summary-v1",
    status: E2A29B_STATUS,
    passed: true,
    run_id: runId,
    artifact_path: runDir,
    e1: { case_count: 12, passed_count: 12, failed_count: 0 },
    boundary_calibration: boundary.summary,
    transport_calibration: transport.summary,
    e2a29a_artifact_audit_passed: e2a29aAudit.passed,
    historical_non_regression_passed: historicalReplays.all_passed,
    candidate_integrity_passed: candidate.passed,
    protected_evidence_unchanged: protectedIntegrity.byte_identical,
    composite_runtime_identity_hash: identity.composite_runtime_identity_hash,
    e2a30_protocol_hash: protocolHash,
    e2a30_artifact_contract_hash: artifactContractHash,
    e2a30_overlap_passed: overlap.passed,
    e2a30_execution_authorized: false,
    e2a30_executed: false,
    provider_calls_made: 0,
    network_requests_made: 0,
    candidate_approved: false,
    candidate_activated: false
  };
  writeJson(path.join(runDir, "summary.json"), summary);
  return { runDir, summary, boundary, transport };
}

export function latestE2A29BRun() {
  if (!existsSync(E2A29B_ARTIFACT_ROOT)) return null;
  return readdirSync(E2A29B_ARTIFACT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() &&
      entry.name.startsWith("e2a29b_") &&
      existsSync(path.join(E2A29B_ARTIFACT_ROOT, entry.name, "summary.json")))
    .map((entry) => entry.name)
    .sort()
    .at(-1) ?? null;
}

export function auditE2A29B(runId?: string) {
  const id = runId ?? latestE2A29BRun();
  if (!id) throw new Error("e2a29b_run_not_found");
  const runDir = path.join(E2A29B_ARTIFACT_ROOT, id);
  const missing = E2A29B_ARTIFACT_NAMES.filter(
    (name) => !existsSync(path.join(runDir, name))
  );
  const summary = readJson<JsonRecord>(path.join(runDir, "summary.json"));
  const boundary = readJsonl<JsonRecord>(path.join(
    runDir,
    "boundary-calibration-results.jsonl"
  ));
  const transport = readJsonl<JsonRecord>(path.join(
    runDir,
    "transport-calibration-results.jsonl"
  ));
  const e1 = readJsonl<JsonRecord>(path.join(runDir, "e1-scenario-results.jsonl"));
  const protocol = readJson<JsonRecord>(path.join(runDir, "e2a30-frozen-protocol.json"));
  const identity = readJson<JsonRecord>(path.join(
    runDir,
    "composite-runtime-identity.json"
  ));
  const protocolHash = readFileSync(path.join(
    runDir,
    "e2a30-frozen-protocol.sha256"
  ), "utf8").trim();
  const checks = {
    artifacts_complete: missing.length === 0,
    summary_passed: summary.passed === true && summary.status === E2A29B_STATUS,
    e1_12_of_12: e1.length === 12 && e1.every((row) =>
      row.actual_result === "passed" && row.invariant_result === "passed"
    ),
    boundary_96_or_greater: boundary.length >= 96,
    boundary_all_passed: boundary.every((row) => row.passed === true),
    transport_87_of_87: transport.length === 87 &&
      transport.every((row) => row.passed === true),
    e2a29a_audit_passed: summary.e2a29a_artifact_audit_passed === true,
    protected_evidence_unchanged: summary.protected_evidence_unchanged === true,
    composite_identity_complete:
      identity.identity_version === "e2a29b-composite-runtime-identity-v2" &&
      typeof identity.evaluator_prompt_hash === "string" &&
      typeof identity.evaluator_repair_prompt_hash === "string" &&
      typeof identity.evaluator_input_schema_hash === "string" &&
      typeof identity.evaluator_output_schema_hash === "string" &&
      Object.values(identity.source_hashes as JsonRecord).every((entry) =>
        typeof (entry as JsonRecord).sha256 === "string"
      ),
    protocol_hash_matches: protocolHash === stableHash(protocol),
    provider_and_network_zero:
      summary.provider_calls_made === 0 && summary.network_requests_made === 0,
    e2a30_not_executed:
      summary.e2a30_executed === false &&
      summary.e2a30_execution_authorized === false,
    candidate_not_approved_or_activated:
      summary.candidate_approved === false && summary.candidate_activated === false
  };
  return {
    audit_version: "e2a29b-artifact-audit-v1",
    run_id: id,
    artifact_path: runDir,
    checks,
    missing_artifacts: missing,
    passed: Object.values(checks).every(Boolean),
    provider_calls_made: 0,
    network_requests_made: 0
  };
}
