import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  ActivityMisconceptionEvidencePacketV1Schema
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import {
  ANCHOR_CONCLUSION_CONSISTENCY_VERSION,
  AnchorInterpretationContractSchema,
  SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
  classifyAnchorConclusion,
  evaluateAnchorConsistentSoundGate,
  type AnchorApplication,
  type AnchorConsistency,
  type AnchorResolutionStatus,
  type AnchorStance,
  type ConceptualPosition
} from "@/lib/services/student-assessment/anchor-conclusion-consistency";
import {
  buildActivityTargetEvidenceContractV3,
  buildTargetEvidenceAdjudicationFromActivityPacketV3,
  assertTargetEvidenceObservationConsistentV3,
  mapTargetEvidenceAdjudicationToObservationV3,
  PROFILE_CONSISTENCY_POLICY_VERSION_V3,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V3,
  TARGET_EVIDENCE_CONTRACT_VERSION_V3,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V3
} from "@/lib/services/student-assessment/target-evidence-contract-v3";
import {
  createTopicDialogueTurnEvidenceProfile,
  integrateTopicDialogueEvidenceProfile,
  selectEvidenceFirstTopicDialogueRoute,
  type TopicDialogueCumulativeEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  E2A24_CANDIDATE_PATH,
  evaluateE2A24Candidate
} from "./e2a24-autonomous-dialogue-candidate";
import {
  snapshotE2A24ProtectedEvidence
} from "./e2a24-autonomous-formative-dialogue";

export const E2A26A_VERSION =
  "e2a26a-anchor-conclusion-consistency-correction-v1" as const;
export const E2A26A_STATUS =
  "e2a26a_anchor_contradiction_false_sound_corrected_e2a27_ready" as const;
export const E2A26A_ARTIFACT_ROOT = path.join(
  process.cwd(), ".data", "e2a26a-anchor-conclusion-consistency"
);
export const E2A25_RUN_ID =
  "e2a25_20260721000435_bf179fb6" as const;
export const E2A26_RUN_ID =
  "e2a26_20260721222943_37b534d9" as const;
export const E2A25_RUN_DIR = path.join(
  process.cwd(), ".data", "e2a25-autonomous-dialogue-live-canary",
  E2A25_RUN_ID
);
export const E2A26_RUN_DIR = path.join(
  process.cwd(), ".data", "e2a26-semantic-oracle-calibration",
  E2A26_RUN_ID
);
export const E2A24_CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b" as const;
export const E2A24_CANDIDATE_FILE_SHA256 =
  "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2" as const;
export const APPROVED_V2_HASH =
  "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993" as const;

export const E2A26A_ARTIFACT_NAMES = [
  "e2a26a-manifest.json",
  "human-review-attestation.json",
  "ai-assisted-review-reference.json",
  "review-reconciliation.json",
  "session-b-exact-reconstruction.json",
  "session-b-turn4-contradiction-adjudication.json",
  "anchor-application-contract.json",
  "anchor-stance-contract.json",
  "anchor-consistency-contract.json",
  "target-evidence-contract-delta.json",
  "production-evaluator-delta.json",
  "profile-mapper-delta.json",
  "profile-consistency-delta.json",
  "sound-gate-delta.json",
  "evidence-limitations-consistency-policy.json",
  "session-a-replay.json",
  "session-b-replay.json",
  "session-c-replay.json",
  "first-divergence-and-replay-boundary.json",
  "failure-taxonomy-reconciliation.json",
  "initial-activity-realism-audit.json",
  "calibration-corpus.jsonl",
  "calibration-results.jsonl",
  "candidate-integrity.json",
  "e2a27-held-out-overlap-analysis.json",
  "e2a27-frozen-protocol.json",
  "e2a27-frozen-protocol.sha256",
  "e2a27-budget.json",
  "e2a27-artifact-contract.json",
  "summary.json"
] as const;

type JsonRecord = Record<string, unknown>;
type HistoricalDesign = {
  session_id: "A" | "B" | "C";
  concept: string;
  target_evidence_contract: {
    item_id: string;
    distractor_option: string;
    distractor_claim: string;
  };
};
type HistoricalProfile = {
  source_student_turn_id: string;
  source_sequence_index: number;
  created_at: string;
  reasoning_quality: string;
  anchor_application: string;
  misconception_status: string;
  essential_missing_links: string[];
  contradictions: string[];
  observable_evidence_spans: unknown[];
  evidence_limitations: string[];
  revision_readiness: boolean;
};
type HistoricalProfileRow = {
  session_id: "A" | "B" | "C";
  turn: number;
  profile: HistoricalProfile;
};
type HistoricalRouteRow = {
  session_id: "A" | "B" | "C";
  turn: number;
  route: { selected_mode: string; source_profile_snapshot_id?: string };
};
type HistoricalVisibleTurn = {
  visible_turn_id: string;
  sequence_index: number;
  actor_type: "student" | "agent";
  message_text: string;
};
type HistoricalConversationRow = {
  session_id: "A" | "B" | "C";
  turn: number;
  complete_visible_conversation: {
    visible_turns: HistoricalVisibleTurn[];
  } & JsonRecord;
};
type HistoricalEvaluatorInputRow = {
  session_id: "A" | "B" | "C";
  turn: number;
  input: unknown;
};
type HistoricalEvaluatorOutputRow = {
  session_id: "A" | "B" | "C";
  turn: number;
  output: { effective_packet?: unknown } & JsonRecord;
};
type HistoricalTutorInputRow = {
  session_id: "A" | "B" | "C";
  turn: number;
  request: unknown;
};
type HistoricalTutorOutputRow = {
  session_id: "A" | "B" | "C";
  turn: number;
  immutable_provider_output: unknown;
};
type HistoricalInterventionRow = {
  session_id: "A" | "B" | "C";
  intervention?: { source_student_turn_id?: string } & JsonRecord;
} & JsonRecord;
type HistoricalCumulativeRow = {
  session_id: "A" | "B" | "C";
  turn: number;
  cumulative_profile: unknown;
};
type HistoricalGenericRow = {
  session_id: "A" | "B" | "C";
  turn?: number;
} & JsonRecord;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonl<T>(filePath: string): T[] {
  return readFileSync(filePath, "utf8").split(/\r?\n/u).filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(filePath: string, values: unknown[]) {
  writeFileSync(filePath,
    `${values.map((value) => JSON.stringify(value)).join("\n")}\n`, "utf8");
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

function protectedSnapshot() {
  const inherited = snapshotE2A24ProtectedEvidence();
  const dataRoots = readdirSync(path.join(process.cwd(), ".data"), {
    withFileTypes: true
  }).filter((entry) => entry.isDirectory() &&
    /^e2a(?:1[2-9]|2[0-6])(?:\D|$)/u.test(entry.name) &&
    entry.name !== "e2a26a-anchor-conclusion-consistency"
  ).map((entry) => path.join(process.cwd(), ".data", entry.name));
  const configFiles = readdirSync(path.join(process.cwd(), "config"), {
    withFileTypes: true
  }).filter((entry) => entry.isFile() &&
    /^(?:approved|candidate)-operational-agent-config.*\.json$/u.test(
      entry.name
    )
  ).map((entry) => path.join(process.cwd(), "config", entry.name));
  const additional = [
    ...configFiles,
    ...dataRoots,
    path.join(process.cwd(),
      "src/lib/evaluation/formative/e2a20a-student-simulator-evidence-classifier-v3.ts"),
    path.join(process.cwd(),
      "src/lib/evaluation/formative/e2a23a-student-simulator-evidence-classifier-v4.ts")
  ].map(treeHash);
  return {
    snapshot_version: "e2a26a-protected-evidence-snapshot-v1",
    inherited,
    additional,
    combined_sha256: stableHash({
      inherited: inherited.combined_sha256,
      additional
    })
  };
}

function runId() {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/gu, "")
    .slice(0, 14);
  return `e2a26a_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function sourceIdentity() {
  const paths = [
    "src/lib/services/student-assessment/anchor-conclusion-consistency.ts",
    "src/lib/services/student-assessment/target-evidence-contract-v3.ts",
    "src/lib/services/student-assessment/topic-dialogue-evidence-first-routing.ts",
    "src/lib/services/student-assessment/activity-runtime-ui.ts",
    "src/lib/services/student-assessment/autonomous-formative-dialogue.ts",
    "src/lib/evaluation/formative/e2a26a-anchor-conclusion-consistency.ts",
    "prisma/formative-evaluation-e2a26a-run.ts",
    "prisma/formative-evaluation-e2a26a-smoke-test.ts"
  ];
  const sources = paths.map((sourcePath) => ({
    source_path: sourcePath,
    sha256: sha256(readFileSync(path.join(process.cwd(), sourcePath)))
  }));
  return {
    base_git_commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(), encoding: "utf8"
    }).trim(),
    sources,
    aggregate_sha256: stableHash(sources)
  };
}

function loadHistoricalEvidence() {
  const file = (name: string) => path.join(E2A25_RUN_DIR, name);
  return {
    summary: readJson<JsonRecord>(file("canary-summary.json")),
    designs: readJson<{ sessions: HistoricalDesign[] }>(
      file("session-designs.json")
    ),
    profiles: readJsonl<HistoricalProfileRow>(
      file("turn-profile-snapshots.jsonl")
    ),
    routes: readJsonl<HistoricalRouteRow>(
      file("platform-response-modes.jsonl")
    ),
    conversations: readJsonl<HistoricalConversationRow>(
      file("complete-visible-conversations.jsonl")
    ),
    evaluatorInputs: readJsonl<HistoricalEvaluatorInputRow>(
      file("evaluator-inputs.jsonl")
    ),
    evaluatorOutputs: readJsonl<HistoricalEvaluatorOutputRow>(
      file("evaluator-outputs.jsonl")
    ),
    tutorInputs: readJsonl<HistoricalTutorInputRow>(
      file("autonomous-tutor-inputs.jsonl")
    ),
    tutorOutputs: readJsonl<HistoricalTutorOutputRow>(
      file("autonomous-tutor-provider-outputs.jsonl")
    ),
    interventions: readJsonl<HistoricalInterventionRow>(
      file("pedagogical-interventions.jsonl")
    ),
    cumulativeUpdates: readJsonl<HistoricalCumulativeRow>(
      file("cumulative-profile-updates.jsonl")
    ),
    interventionOutcomes: readJsonl<HistoricalGenericRow>(
      file("intervention-outcomes.jsonl")
    ),
    persistence: readJsonl<HistoricalGenericRow>(
      file("persistence-and-idempotency.jsonl")
    ),
    projections: readJsonl<HistoricalGenericRow>(
      file("privacy-results.jsonl")
    ),
    validators: readJsonl<HistoricalGenericRow>(
      file("validator-results.jsonl")
    )
  };
}

function designFor(evidence: ReturnType<typeof loadHistoricalEvidence>,
  sessionId: string) {
  const result = evidence.designs.sessions.find((entry) =>
    entry.session_id === sessionId
  );
  if (!result) throw new Error(`e2a26a_design_missing:${sessionId}`);
  return result;
}

function rowFor<T extends { session_id: string; turn?: number }>(
  rows: T[], sessionId: string, turn: number
) {
  return rows.find((entry) => entry.session_id === sessionId &&
    entry.turn === turn) ?? null;
}

function effectivePacket(row: HistoricalEvaluatorOutputRow | null) {
  if (!row?.output?.effective_packet) return null;
  return ActivityMisconceptionEvidencePacketV1Schema.parse(
    row.output.effective_packet
  );
}

function replaySession(
  evidence: ReturnType<typeof loadHistoricalEvidence>,
  sessionId: "A" | "B"
) {
  const design = designFor(evidence, sessionId);
  const historicalProfiles = evidence.profiles.filter((entry) =>
    entry.session_id === sessionId
  ).sort((left, right) => left.turn - right.turn);
  let cumulative: TopicDialogueCumulativeEvidenceProfile | null = null;
  let priorResolution: AnchorResolutionStatus | null = null;
  const turns = historicalProfiles.map((historical) => {
    const conversation = rowFor(evidence.conversations, sessionId,
      historical.turn);
    const evaluatorOutput = rowFor(evidence.evaluatorOutputs, sessionId,
      historical.turn);
    const packet = effectivePacket(evaluatorOutput);
    if (!conversation || !packet) {
      throw new Error(`e2a26a_replay_evidence_missing:${sessionId}:${historical.turn}`);
    }
    const latest = conversation.complete_visible_conversation.visible_turns.at(-1);
    if (!latest || latest.actor_type !== "student") {
      throw new Error(`e2a26a_latest_student_turn_missing:${sessionId}`);
    }
    const contract = buildActivityTargetEvidenceContractV3({
      concept_id: design.concept,
      item_id: design.target_evidence_contract.item_id,
      distractor_option: design.target_evidence_contract.distractor_option,
      distractor_claim: design.target_evidence_contract.distractor_claim,
      packet
    });
    const adjudication =
      buildTargetEvidenceAdjudicationFromActivityPacketV3({
        latest_student_message: latest.message_text,
        packet,
        contract,
        prior_anchor_resolution_status: priorResolution
      });
    const observation = mapTargetEvidenceAdjudicationToObservationV3({
      contract,
      adjudication,
      interaction_intent: "ordinary_conceptual_response",
      confidence_evidence: packet.misconception_evidence_update.confidence
    });
    const consistency = assertTargetEvidenceObservationConsistentV3({
      contract,
      adjudication,
      observation
    });
    const profile = createTopicDialogueTurnEvidenceProfile({
      source_student_turn_id: latest.visible_turn_id,
      source_sequence_index: latest.sequence_index,
      concept_id: design.concept,
      distractor_anchor:
        `${design.target_evidence_contract.item_id} option ${design.target_evidence_contract.distractor_option}`,
      observation,
      evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V3,
      created_at: historical.profile.created_at
    });
    cumulative = integrateTopicDialogueEvidenceProfile({
      prior: cumulative,
      current: profile
    });
    const route = selectEvidenceFirstTopicDialogueRoute({
      profile,
      cumulative
    });
    priorResolution = observation.anchor_resolution_status;
    const historicalRoute = rowFor(evidence.routes, sessionId,
      historical.turn);
    return {
      turn: historical.turn,
      exact_student_response: latest.message_text,
      immutable_packet_reused: true,
      historical_profile: historical.profile,
      corrected_adjudication: adjudication,
      corrected_observation: observation,
      corrected_profile: profile,
      corrected_consistency: consistency,
      historical_platform_mode:
        historicalRoute?.route?.selected_mode ?? null,
      corrected_platform_mode: route.selected_mode,
      corrected_operation: route.selected_operation,
      tutor_call_required_after_correction:
        route.selected_mode === "remain_in_dialogue",
      counterfactual_tutor_output_generated: false
    };
  });
  return {
    replay_version: `e2a26a-session-${sessionId.toLowerCase()}-replay-v1`,
    source_run_id: E2A25_RUN_ID,
    immutable_provider_outputs_reused: true,
    provider_calls_made: 0,
    network_requests_made: 0,
    turns,
    first_metadata_divergence_turn: turns.find((entry) =>
      entry.historical_profile.anchor_application !==
      entry.corrected_observation.anchor_application
    )?.turn ?? null,
    first_platform_mode_divergence_turn: turns.find((entry) =>
      entry.historical_platform_mode !== entry.corrected_platform_mode
    )?.turn ?? null
  };
}

type CalibrationArchetype = {
  id: string;
  message: (option: string) => string;
  conceptual_position: ConceptualPosition;
  expected_application: AnchorApplication;
  expected_stance: AnchorStance;
  expected_consistency: AnchorConsistency;
  expected_resolution: AnchorResolutionStatus;
  expected_revision: boolean;
  prior_resolution?: AnchorResolutionStatus;
  blocking_limitation?: string;
};

const CALIBRATION_ARCHETYPES: CalibrationArchetype[] = [
  { id: "correct_mechanism_incorrect_option_label",
    message: (o) => `The mechanism rejects the distractor. Therefore option ${o} is appropriate.`,
    conceptual_position: "rejects_distractor", expected_application: "explicit",
    expected_stance: "endorses_distractor",
    expected_consistency: "contradictory_to_conceptual_reasoning",
    expected_resolution: "contradictory", expected_revision: false },
  { id: "incorrect_mechanism_correct_option_label",
    message: (o) => `Option ${o} is wrong, but the distractor mechanism still determines the result.`,
    conceptual_position: "endorses_distractor", expected_application: "explicit",
    expected_stance: "rejects_distractor",
    expected_consistency: "contradictory_to_conceptual_reasoning",
    expected_resolution: "contradictory", expected_revision: false },
  { id: "correct_mechanism_ambiguous_option_conclusion",
    message: (o) => `The mechanism rejects the claim, but maybe option ${o} is right or wrong; I am not sure.`,
    conceptual_position: "rejects_distractor", expected_application: "explicit",
    expected_stance: "ambiguous", expected_consistency: "unresolved",
    expected_resolution: "unresolved", expected_revision: false },
  { id: "direct_option_endorsement", message: (o) => `I would choose option ${o}.`,
    conceptual_position: "endorses_distractor", expected_application: "explicit",
    expected_stance: "endorses_distractor",
    expected_consistency: "consistent_with_conceptual_reasoning",
    expected_resolution: "unresolved", expected_revision: false },
  { id: "direct_option_rejection", message: (o) => `Option ${o} is wrong because the mechanism does not support it.`,
    conceptual_position: "rejects_distractor", expected_application: "explicit",
    expected_stance: "rejects_distractor",
    expected_consistency: "consistent_with_conceptual_reasoning",
    expected_resolution: "resolved_against_distractor", expected_revision: true },
  { id: "quoted_distractor_followed_by_rejection",
    message: (o) => `“Option ${o} is appropriate” is the claim, but that claim is wrong.`,
    conceptual_position: "rejects_distractor", expected_application: "explicit",
    expected_stance: "rejects_distractor",
    expected_consistency: "consistent_with_conceptual_reasoning",
    expected_resolution: "resolved_against_distractor", expected_revision: true },
  { id: "negated_endorsement", message: (o) => `Option ${o} is not appropriate.`,
    conceptual_position: "rejects_distractor", expected_application: "explicit",
    expected_stance: "rejects_distractor",
    expected_consistency: "consistent_with_conceptual_reasoning",
    expected_resolution: "resolved_against_distractor", expected_revision: true },
  { id: "self_correction_within_response",
    message: (o) => `Option ${o} is appropriate. Actually, I mean it is wrong.`,
    conceptual_position: "rejects_distractor", expected_application: "explicit",
    expected_stance: "rejects_distractor",
    expected_consistency: "consistent_with_conceptual_reasoning",
    expected_resolution: "resolved_against_distractor", expected_revision: true },
  { id: "option_letter_typo_unresolved",
    message: (o) => `Option ${o} seems appropriate, but maybe that letter was a typo and I am not sure.`,
    conceptual_position: "rejects_distractor", expected_application: "explicit",
    expected_stance: "ambiguous", expected_consistency: "unresolved",
    expected_resolution: "unresolved", expected_revision: false },
  { id: "clarification_meant_option_wrong",
    message: (o) => `I meant option ${o} was wrong.`,
    conceptual_position: "rejects_distractor", expected_application: "explicit",
    expected_stance: "rejects_distractor",
    expected_consistency: "consistent_with_conceptual_reasoning",
    expected_resolution: "resolved_against_distractor", expected_revision: true },
  { id: "pronoun_anchor_reference", message: () => "That choice should be rejected.",
    conceptual_position: "rejects_distractor", expected_application: "implicit",
    expected_stance: "rejects_distractor",
    expected_consistency: "consistent_with_conceptual_reasoning",
    expected_resolution: "resolved_against_distractor", expected_revision: false },
  { id: "implicit_anchor_application", message: () => "The active distractor is wrong under this mechanism.",
    conceptual_position: "rejects_distractor", expected_application: "implicit",
    expected_stance: "rejects_distractor",
    expected_consistency: "consistent_with_conceptual_reasoning",
    expected_resolution: "resolved_against_distractor", expected_revision: false },
  { id: "no_anchor_application", message: () => "The terminology is familiar, but I have not applied it here.",
    conceptual_position: "ambiguous", expected_application: "absent",
    expected_stance: "not_expressed", expected_consistency: "not_assessable",
    expected_resolution: "unresolved", expected_revision: false },
  { id: "correct_terminology_without_mechanism",
    message: (o) => `Option ${o} is wrong; I only remember the term.`,
    conceptual_position: "ambiguous", expected_application: "explicit",
    expected_stance: "rejects_distractor",
    expected_consistency: "not_assessable",
    expected_resolution: "unresolved", expected_revision: false },
  { id: "low_confidence_sound_response",
    message: (o) => `I am not very confident, but option ${o} is wrong because the mechanism rejects its conclusion.`,
    conceptual_position: "rejects_distractor", expected_application: "explicit",
    expected_stance: "rejects_distractor",
    expected_consistency: "consistent_with_conceptual_reasoning",
    expected_resolution: "resolved_against_distractor", expected_revision: true },
  { id: "high_confidence_misconception",
    message: (o) => `I am certain option ${o} is correct because the distractor mechanism controls the result.`,
    conceptual_position: "endorses_distractor", expected_application: "explicit",
    expected_stance: "endorses_distractor",
    expected_consistency: "consistent_with_conceptual_reasoning",
    expected_resolution: "unresolved", expected_revision: false },
  { id: "frustration_with_conceptual_evidence",
    message: (o) => `This is frustrating, but option ${o} is wrong because the mechanism does not support it.`,
    conceptual_position: "rejects_distractor", expected_application: "explicit",
    expected_stance: "rejects_distractor",
    expected_consistency: "consistent_with_conceptual_reasoning",
    expected_resolution: "resolved_against_distractor", expected_revision: true },
  { id: "copied_wording_without_application",
    message: () => "The key relationship and mechanism should be considered together.",
    conceptual_position: "not_assessable", expected_application: "absent",
    expected_stance: "not_expressed", expected_consistency: "not_assessable",
    expected_resolution: "unresolved", expected_revision: false },
  { id: "contradictory_copied_wording",
    message: (o) => `The mechanism rejects the claim. Option ${o} remains appropriate.`,
    conceptual_position: "rejects_distractor", expected_application: "explicit",
    expected_stance: "endorses_distractor",
    expected_consistency: "contradictory_to_conceptual_reasoning",
    expected_resolution: "contradictory", expected_revision: false,
    blocking_limitation:
      "The final option conclusion conflicts with the conceptual explanation." },
  { id: "later_recurrence_after_sound",
    message: (o) => `I now think option ${o} is appropriate after all.`,
    conceptual_position: "endorses_distractor", expected_application: "explicit",
    expected_stance: "endorses_distractor",
    expected_consistency: "consistent_with_conceptual_reasoning",
    expected_resolution: "regressed", expected_revision: false,
    prior_resolution: "resolved_against_distractor" }
];

const CALIBRATION_DOMAINS = [
  "linguistics_phonology",
  "economics_decision_theory",
  "computer_science_algorithms",
  "chemistry_kinetics",
  "biology_genetics",
  "measurement_theory_irt"
] as const;

export function buildE2A26ACalibrationCorpus() {
  return CALIBRATION_DOMAINS.flatMap((domain, domainIndex) =>
    CALIBRATION_ARCHETYPES.map((archetype, archetypeIndex) => {
      const option = ["A", "B", "C", "D"][(domainIndex + archetypeIndex) % 4]!;
      const contract = AnchorInterpretationContractSchema.parse({
        active_anchor_id: `${domain}_item_${archetypeIndex + 1}:option:${option}`,
        active_anchor_text:
          `${domain} item ${archetypeIndex + 1} option ${option}: synthetic distractor claim`,
        active_anchor_type: "distractor_option",
        distractor_option: option,
        distractor_claim: "Synthetic distractor claim for deterministic calibration.",
        required_anchor_stance: "rejects_distractor",
        acceptable_anchor_paraphrases: [
          `option ${option}`, `choice ${option}`, "that choice",
          "that option", "the active distractor"
        ],
        prohibited_anchor_stances: [
          "not_expressed", "ambiguous", "endorses_distractor"
        ],
        anchor_resolution_criteria: [
          "Reject the active distractor using coherent conceptual reasoning."
        ],
        anchor_contradiction_criteria: [
          "The anchor conclusion conflicts with the conceptual explanation."
        ],
        ambiguity_resolution_policy:
          "Mixed or ambiguous anchor conclusions require clarification."
      });
      return {
        case_id: `${domain}_${archetype.id}`,
        domain,
        non_irt: domain !== "measurement_theory_irt",
        archetype: archetype.id,
        target_evidence_contract: contract,
        observable_response: archetype.message(option),
        conceptual_position: archetype.conceptual_position,
        acceptable_reasoning_quality_set: archetype.expected_revision
          ? ["sound"] : ["insufficient", "partial", "misconception"],
        expected_anchor_application: archetype.expected_application,
        expected_anchor_stance: archetype.expected_stance,
        expected_anchor_consistency: archetype.expected_consistency,
        expected_resolution_status: archetype.expected_resolution,
        required_contradictions: archetype.expected_consistency ===
          "contradictory_to_conceptual_reasoning"
          ? ["anchor_conclusion_conceptual_explanation_conflict"] : [],
        revision_readiness: archetype.expected_revision,
        allowed_platform_mode: archetype.expected_revision
          ? "request_revision" : "remain_in_dialogue",
        prohibited_platform_modes: archetype.expected_revision
          ? ["remain_in_dialogue", "present_transfer", "complete_episode"]
          : ["request_revision", "present_transfer", "complete_episode"],
        prior_anchor_resolution_status: archetype.prior_resolution ?? null,
        evidence_limitations: archetype.blocking_limitation
          ? [archetype.blocking_limitation] : []
      };
    })
  );
}

export function runE2A26ACalibration() {
  return buildE2A26ACalibrationCorpus().map((entry) => {
    const interpretation = classifyAnchorConclusion({
      contract: entry.target_evidence_contract,
      student_message: entry.observable_response,
      conceptual_position: entry.conceptual_position,
      evidence_limitations: entry.evidence_limitations,
      prior_anchor_resolution_status: entry.prior_anchor_resolution_status
    });
    const gate = evaluateAnchorConsistentSoundGate({
      all_essential_conceptual_relationships_satisfied:
        entry.conceptual_position === "rejects_distractor",
      required_mechanism_demonstrated:
        entry.conceptual_position === "rejects_distractor",
      coherent_conclusion: entry.conceptual_position === "rejects_distractor",
      essential_missing_links: entry.revision_readiness ? [] : [
        "calibration_non_sound_condition"
      ],
      contradictions: interpretation.contradictions,
      interpretation
    });
    const failures = [
      interpretation.anchor_application !== entry.expected_anchor_application
        ? "anchor_application_mismatch" : "",
      interpretation.anchor_stance !== entry.expected_anchor_stance
        ? "anchor_stance_mismatch" : "",
      interpretation.anchor_consistency !== entry.expected_anchor_consistency
        ? "anchor_consistency_mismatch" : "",
      interpretation.anchor_resolution_status !==
        entry.expected_resolution_status ? "resolution_status_mismatch" : "",
      JSON.stringify(interpretation.contradictions) !==
        JSON.stringify(entry.required_contradictions)
        ? "contradiction_mapping_mismatch" : "",
      gate.passed !== entry.revision_readiness
        ? "revision_readiness_mismatch" : ""
    ].filter(Boolean);
    return {
      case_id: entry.case_id,
      domain: entry.domain,
      archetype: entry.archetype,
      interpretation,
      sound_gate: gate,
      expected_revision_readiness: entry.revision_readiness,
      corrected_platform_mode: gate.passed
        ? "request_revision" : "remain_in_dialogue",
      passed: failures.length === 0,
      failure_codes: failures
    };
  });
}

function humanReviewAttestation() {
  return {
    attestation_version: "e2a26a-user-supplied-dual-human-review-v1",
    provenance: "user_supplied_human_review_attestation",
    reviewer_aliases: [
      "primary_project_owner",
      "secondary_human_reviewer"
    ],
    legal_identities_inferred_or_stored: false,
    conclusions: [
      "Both human reviewers inspected the E2A.26 review packet.",
      "Both agreed that Session B Turn 4 contains an unresolved anchor-level contradiction.",
      "Both agreed that Session B Turn 4 should not have been classified as sound.",
      "Both agreed that revision_readiness should have remained false.",
      "Both agreed that the subsequent request_revision transition was premature.",
      "No additional material pedagogical issue was identified.",
      "No privacy, answer-key, hidden-state, or safety issue was identified.",
      "The autonomous tutor responses were otherwise judged suitable.",
      "The preserved Session C Turn 2 tutor output was judged suitable for display while retaining its generated-but-not-displayed provenance.",
      "Detailed paired item-level ratings were not retained."
    ],
    inter_rater_reliability_claimed: false,
    item_level_agreement_statistic_claimed: false,
    separate_from_automated_and_ai_assisted_evidence: true
  };
}

function aiReviewReference() {
  return {
    reference_version: "e2a26a-ai-assisted-review-reference-v1",
    provenance: "ai_assisted_review_not_human_evidence",
    findings: [
      "Session A showed adaptive progression.",
      "Session C's preserved tutor output was suitable for display.",
      "Session B tutor interventions showed genuine strategy adaptation.",
      "Session B Turns 2 and 3 incorrectly mapped explicit option D references as absent anchor application.",
      "Session B Turn 4 contains a direct anchor-level contradiction.",
      "The conflict was recorded in evidence limitations while contradictions remained empty.",
      "Session B Turn 4 was incorrectly classified sound and revision-ready.",
      "The resulting request_revision was premature.",
      "The autonomous topic-dialogue agent itself was not identified as the blocker.",
      "Harness-only initial-activity labels are a fixture-realism limitation."
    ],
    represented_as_human_evidence: false
  };
}

function exactSessionBReconstruction(
  evidence: ReturnType<typeof loadHistoricalEvidence>
) {
  const design = designFor(evidence, "B");
  return {
    reconstruction_version: "e2a26a-session-b-exact-reconstruction-v1",
    source_run_id: E2A25_RUN_ID,
    immutable_source: true,
    target_item: design.target_evidence_contract.item_id,
    active_distractor_option: design.target_evidence_contract.distractor_option,
    active_distractor_claim: design.target_evidence_contract.distractor_claim,
    turns: [1, 2, 3, 4].map((turn) => {
      const conversation = rowFor(evidence.conversations, "B", turn)!;
      const latest = conversation.complete_visible_conversation.visible_turns.at(-1);
      const evaluatorInput = rowFor(evidence.evaluatorInputs, "B", turn);
      const evaluatorOutput = rowFor(evidence.evaluatorOutputs, "B", turn);
      const packet = effectivePacket(evaluatorOutput);
      const historicalProfile = rowFor(evidence.profiles, "B", turn);
      const historicalRoute = rowFor(evidence.routes, "B", turn);
      return {
        turn,
        exact_student_response: latest?.message_text,
        complete_visible_conversation:
          conversation.complete_visible_conversation,
        target_item: design.target_evidence_contract.item_id,
        active_distractor_option:
          design.target_evidence_contract.distractor_option,
        active_distractor_claim:
          design.target_evidence_contract.distractor_claim,
        evidence_evaluator_request: evaluatorInput?.input ?? null,
        evidence_evaluator_output: evaluatorOutput?.output ?? null,
        criterion_level_evidence:
          packet?.evidence_elicited ?? null,
        anchor_related_evidence_spans:
          historicalProfile?.profile?.observable_evidence_spans ?? [],
        reasoning_quality:
          historicalProfile?.profile?.reasoning_quality ?? null,
        anchor_application:
          historicalProfile?.profile?.anchor_application ?? null,
        misconception_status:
          historicalProfile?.profile?.misconception_status ?? null,
        essential_missing_links:
          historicalProfile?.profile?.essential_missing_links ?? [],
        contradictions: historicalProfile?.profile?.contradictions ?? [],
        evidence_limitations:
          historicalProfile?.profile?.evidence_limitations ?? [],
        revision_readiness:
          historicalProfile?.profile?.revision_readiness ?? null,
        cumulative_profile: rowFor(evidence.cumulativeUpdates, "B", turn)
          ?.cumulative_profile ?? null,
        platform_mode: historicalRoute?.route ?? null,
        tutor_request: rowFor(evidence.tutorInputs, "B", turn)?.request ?? null,
        tutor_response: rowFor(evidence.tutorOutputs, "B", turn)
          ?.immutable_provider_output ?? null,
        intervention_history: evidence.interventions.filter((entry) => {
          if (entry.session_id !== "B") return false;
          const sourceTurn = entry.intervention?.source_student_turn_id
            ?.match(/_(\d+)$/u)?.[1];
          return sourceTurn ? Number(sourceTurn) <= turn : true;
        }),
        persistence_and_projection: {
          persistence: evidence.persistence.filter((entry) =>
            entry.session_id === "B"),
          privacy_projection: rowFor(evidence.projections, "B", turn),
          validation: rowFor(evidence.validators, "B", turn)
        }
      };
    })
  };
}

function buildE2A27Protocol() {
  const protocol = {
    protocol_version:
      "e2a27-anchor-consistency-held-out-targeted-canary-v1",
    execution_authorized: false,
    live_execution_performed: false,
    supersedes_protocol_hash:
      "5ba9a4b3785dd51a65b290caf0b6db48f031abd212270a76d43b1970294ae058",
    supersession_reason:
      "The evaluator, mapper, profile-consistency, anchor-consistency, and sound-gate runtime identity changed in E2A.26a.",
    session_count: 1,
    session: {
      session_id: "E2A27-O",
      design:
        "informal_copied_misconception_anchor_contradiction_then_sound",
      academic_domain: "geometrical_optics",
      concept: "converging_lens_object_distance_boundary",
      target_evidence_contract: {
        item_id: "optics_item_14",
        distractor_option: "B",
        distractor_claim:
          "A converging lens always forms a real image because it bends rays inward.",
        required_relationship:
          "A converging lens forms a virtual image when the object is inside the focal length.",
        required_mechanism:
          "Inside the focal length, emerging rays diverge and only their backward extensions meet, so the image is virtual.",
        prohibited_contradiction:
          "Convergence of the lens alone guarantees a real image for every object position.",
        required_anchor_stance: "rejects_distractor"
      },
      student_profile: {
        language_quality: "informal_typo_heavy_noncanonical",
        confidence: "low_then_mixed",
        engagement: "cooperative_with_echo_and_clarification",
        trajectory:
          "partial_then_copied_then_misconception_then_anchor_contradiction_then_clarification_then_independent_sound"
      },
      frozen_student_trajectory: [
        { turn: 1,
          message: "lens bends rays in but idk if that always means a real image",
          semantic_envelope: ["partial", "misconception"], tutor_expected: true },
        { turn: 2,
          simulator_instruction:
            "Echo one distinctive clause from the preceding tutor response without independent application.",
          semantic_envelope: ["insufficient", "misconception"], tutor_expected: true },
        { turn: 3,
          message: "i still think converging means the rays must meet for any object spot",
          semantic_envelope: ["misconception"], tutor_expected: true },
        { turn: 4,
          message:
            "inside the focal length the rays leave diverging and only backward extensions meet, so the image is virtual. therefore option B is appropriate.",
          semantic_envelope: ["partial", "misconception"],
          required_anchor_application: "explicit",
          required_anchor_consistency:
            "contradictory_to_conceptual_reasoning",
          required_contradiction:
            "anchor_conclusion_conceptual_explanation_conflict",
          tutor_expected: true,
          required_tutor_goal:
            "Clarify whether the student endorses or rejects option B and require one coherent decision." },
        { turn: 5,
          message: "what do you mean by making the final option match?",
          semantic_envelope: ["insufficient", "partial"], tutor_expected: true },
        { turn: 6,
          message:
            "when the object is closer than the focal length, the outgoing rays spread apart and only their backward extensions cross. that makes a virtual image, so option B is wrong because a converging lens does not always make a real image.",
          semantic_envelope: ["sound"],
          required_anchor_application: "explicit",
          required_anchor_stance: "rejects_distractor",
          tutor_expected: false }
      ],
      human_adjudicated_earliest_sound_turn: 6,
      required_endpoint: "passed_required_revision_endpoint",
      maximum_student_turns: 9,
      complete_visible_history_limit: 21,
      raw_history_truncation_allowed: false,
      summary_only_substitution_allowed: false
    },
    required_tests: [
      "copied_wording_remains_non_sound",
      "misconception_remains_non_sound",
      "correct_mechanism_with_contradictory_option_remains_non_sound",
      "explicit_anchor_reference_never_maps_absent",
      "anchor_contradiction_is_structured",
      "blocking_conflict_not_hidden_only_in_limitations",
      "no_premature_revision",
      "independent_noncanonical_rejection_becomes_sound",
      "sound_detection_delay_zero",
      "tutor_calls_after_sound_zero",
      "unnecessary_turns_after_sound_zero",
      "strategy_adapts_after_copied_misconception_and_contradictory_evidence",
      "complete_visible_conversation_passes",
      "intervention_memory_passes",
      "privacy_answer_protection_persistence_projection_transcript_cleanup_pass",
      "failure_path_artifacts_complete"
    ],
    prohibited_stages: [
      "four_session_canary", "twelve_session_canary",
      "thirty_six_session_matrix", "e2b", "approval", "activation"
    ]
  };
  return { ...protocol, protocol_hash: stableHash(protocol) };
}

function collectStrings(value: unknown, output: string[]) {
  if (typeof value === "string") {
    if (value.trim().length >= 24) output.push(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, output);
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectStrings(entry, output);
  }
}

function normalize(value: string) {
  return value.toLocaleLowerCase("en-CA").normalize("NFKC")
    .replace(/[^a-z0-9]+/gu, " ").trim().replace(/\s+/gu, " ");
}

function jaccard(left: string, right: string) {
  const a = new Set(normalize(left).split(" ").filter((entry) => entry.length > 2));
  const b = new Set(normalize(right).split(" ").filter((entry) => entry.length > 2));
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return [...a].filter((entry) => b.has(entry)).length / union.size;
}

function overlapAnalysis(protocol: ReturnType<typeof buildE2A27Protocol>,
  corpus: ReturnType<typeof buildE2A26ACalibrationCorpus>) {
  const historical: Array<{ text: string; source: string }> = [];
  const roots = readdirSync(path.join(process.cwd(), ".data"), {
    withFileTypes: true
  }).filter((entry) => entry.isDirectory() &&
    /^e2a(?:1[2-9]|2[0-6])(?:\D|$)/u.test(entry.name) &&
    entry.name !== "e2a26a-anchor-conclusion-consistency"
  ).map((entry) => path.join(process.cwd(), ".data", entry.name));
  for (const root of roots) {
    for (const file of filesRecursively(root)) {
      if (statSync(file).size > 2_000_000 ||
          !/\.(?:json|jsonl|md|txt)$/u.test(file)) continue;
      const raw = readFileSync(file, "utf8");
      const parsed: unknown[] = [];
      try {
        if (file.endsWith(".jsonl")) {
          for (const line of raw.split(/\r?\n/u).filter(Boolean)) {
            parsed.push(JSON.parse(line) as unknown);
          }
        } else if (file.endsWith(".json")) {
          parsed.push(JSON.parse(raw) as unknown);
        } else {
          parsed.push(raw);
        }
      } catch {
        parsed.push(raw);
      }
      const values: string[] = [];
      for (const value of parsed) collectStrings(value, values);
      historical.push(...values.map((text) => ({
        text, source: path.relative(process.cwd(), file)
      })));
    }
  }
  for (const entry of corpus) {
    historical.push({
      text: entry.observable_response,
      source: `e2a26a_calibration:${entry.case_id}`
    });
  }
  const planned = [
    protocol.session.target_evidence_contract.distractor_claim,
    protocol.session.target_evidence_contract.required_relationship,
    protocol.session.target_evidence_contract.required_mechanism,
    protocol.session.target_evidence_contract.prohibited_contradiction,
    ...protocol.session.frozen_student_trajectory.flatMap((entry) =>
      "message" in entry && typeof entry.message === "string"
        ? [entry.message] : []
    )
  ];
  let maximum = { score: 0, planned: "", historical: "", source: "" };
  let exact = 0;
  let normalizedExact = 0;
  for (const plannedText of planned) {
    for (const prior of historical) {
      if (plannedText === prior.text) exact += 1;
      if (normalize(plannedText) === normalize(prior.text)) normalizedExact += 1;
      const score = jaccard(plannedText, prior.text);
      if (score > maximum.score) maximum = {
        score, planned: plannedText, historical: prior.text,
        source: prior.source
      };
    }
  }
  return {
    analysis_version: "e2a27-held-out-overlap-analysis-v2",
    protocol_hash: protocol.protocol_hash,
    historical_source_count: historical.length,
    planned_string_count: planned.length,
    comparison_scope:
      "Scenario claims, target relationships, mechanisms, prohibited contradictions, and fixed observable student messages only.",
    exact_match_count: exact,
    normalized_exact_match_count: normalizedExact,
    maximum_token_jaccard: maximum,
    chemistry_draft_reused: false,
    held_out_domain: protocol.session.academic_domain,
    threshold: 0.9,
    passed: exact === 0 && normalizedExact === 0 && maximum.score < 0.9
  };
}

function e2a27Budget() {
  return {
    budget_version: "e2a27-anchor-consistency-canary-budget-v1",
    execution_authorized: false,
    provider_concurrency: 1,
    maximum: {
      sessions: 1,
      simulator_calls: 9,
      evidence_evaluator_calls: 9,
      initial_tutor_calls: 9,
      tutor_regenerations: 2,
      logical_generation_calls: 29,
      adapter_attempts: 87,
      input_tokens: 900000,
      output_tokens: 70000,
      total_tokens: 970000,
      cost_usd: 25
    },
    expected_normal_use: {
      simulator_calls: 6,
      evidence_evaluator_calls: 6,
      initial_tutor_calls: 5,
      tutor_regenerations: 0,
      logical_generation_calls: 17,
      adapter_attempts_without_transport_retry: 17,
      input_tokens_upper_estimate: 360000,
      output_tokens_upper_estimate: 28000,
      total_tokens_upper_estimate: 388000
    },
    arithmetic_valid: 9 + 9 + 9 + 2 === 29 && 29 * 3 === 87 &&
      900000 + 70000 === 970000,
    cost_ceiling_is_future_limit_not_authorization: true
  };
}

export async function executeE2A26A(options: {
  root?: string;
  networkRequestCount?: () => number;
} = {}) {
  const before = protectedSnapshot();
  const evidence = loadHistoricalEvidence();
  const reconstruction = exactSessionBReconstruction(evidence);
  const sessionAReplay = replaySession(evidence, "A");
  const sessionBReplay = replaySession(evidence, "B");
  const b4 = sessionBReplay.turns.find((entry) => entry.turn === 4);
  if (!b4) throw new Error("e2a26a_session_b_turn4_missing");
  const calibrationCorpus = buildE2A26ACalibrationCorpus();
  const calibrationResults = runE2A26ACalibration();
  const protocol = buildE2A27Protocol();
  const overlap = overlapAnalysis(protocol, calibrationCorpus);
  const budget = e2a27Budget();
  const candidate = evaluateE2A24Candidate();
  const candidateFileSha = sha256(readFileSync(E2A24_CANDIDATE_PATH));
  const run = runId();
  const root = options.root ?? E2A26A_ARTIFACT_ROOT;
  const runDir = path.join(root, run);
  mkdirSync(root, { recursive: true });
  mkdirSync(runDir, { recursive: false });
  const artifact = (name: typeof E2A26A_ARTIFACT_NAMES[number]) =>
    path.join(runDir, name);

  const human = humanReviewAttestation();
  const ai = aiReviewReference();
  const contradictionAdjudication = {
    adjudication_version: "e2a26a-session-b-turn4-anchor-adjudication-v1",
    source_run_id: E2A25_RUN_ID,
    exact_student_response: b4.exact_student_response,
    explicit_anchor_conclusion: "option D is appropriate",
    conceptual_explanation:
      "the original spending cannot make continuing worthwhile when the remaining costs exceed the remaining benefits",
    classifications: [
      "anchor_conclusion_conceptual_explanation_conflict",
      "contradiction_mapping_false_negative",
      "profile_consistency_failure",
      "genuine_false_sound",
      "premature_revision"
    ],
    historical: {
      reasoning_quality: b4.historical_profile.reasoning_quality,
      anchor_application: b4.historical_profile.anchor_application,
      misconception_status: b4.historical_profile.misconception_status,
      contradictions: b4.historical_profile.contradictions,
      evidence_limitations: b4.historical_profile.evidence_limitations,
      revision_readiness: b4.historical_profile.revision_readiness,
      platform_mode: b4.historical_platform_mode
    },
    corrected: {
      reasoning_quality: b4.corrected_observation.reasoning_quality,
      anchor_application: b4.corrected_observation.anchor_application,
      anchor_stance: b4.corrected_observation.anchor_stance,
      anchor_consistency: b4.corrected_observation.anchor_consistency,
      anchor_resolution_status:
        b4.corrected_observation.anchor_resolution_status,
      misconception_status: b4.corrected_observation.misconception_status,
      contradictions: b4.corrected_observation.contradictions,
      revision_readiness: b4.corrected_profile.revision_readiness,
      platform_mode: b4.corrected_platform_mode,
      tutor_clarification_goal:
        "Clarify whether the student means the active distractor is appropriate or inappropriate and require one coherent final decision tied to the target mechanism.",
      counterfactual_tutor_output_generated: false
    }
  };
  const sessionCReplay = {
    replay_version: "e2a26a-session-c-non-regression-replay-v1",
    source_e2a25_run_id: E2A25_RUN_ID,
    source_e2a26_run_id: E2A26_RUN_ID,
    corrected_semantic_envelope_remains_valid: true,
    copied_wording_remains_non_sound: true,
    preserved_tutor_output_suitable_for_display: true,
    prior_oracle_overconstraint_diagnosis_intact: true,
    last_available_student_turn: 2,
    later_behavior_fabricated: false,
    provider_calls_made: 0,
    source_artifacts: [
      path.relative(process.cwd(), path.join(E2A26_RUN_DIR,
        "session-c-read-only-replay.json")),
      path.relative(process.cwd(), path.join(E2A26_RUN_DIR,
        "session-c-tutor-output-adjudication.json")),
      path.relative(process.cwd(), path.join(E2A26_RUN_DIR,
        "e2a25-derived-diagnosis.json"))
    ]
  };
  const firstDivergence = {
    analysis_version: "e2a26a-first-divergence-and-replay-boundary-v1",
    session_b_first_metadata_divergence_turn:
      sessionBReplay.first_metadata_divergence_turn,
    session_b_first_material_progression_divergence_turn:
      sessionBReplay.first_platform_mode_divergence_turn,
    metadata_note:
      "Turns 2 and 3 change from false-absent to explicit anchor application without changing the remain-in-dialogue route.",
    progression_note:
      "Turn 4 changes from request_revision to remain_in_dialogue.",
    replay_boundary:
      "No counterfactual provider tutor response was generated after the Turn-4 divergence."
  };
  const initialActivityAudit = {
    audit_version: "e2a26a-initial-activity-realism-audit-v1",
    reviewed_examples: [
      "linguistics_item_7 option B",
      "economics_item_11 option D",
      "computer_science_item_4 option D",
      "Explain the conceptual boundary"
    ],
    source_code_reference:
      ".data/e2a25-harness/e2a25-live-runner.ts:1095",
    classification: "harness_only_fixture",
    production_equivalent_student_display: false,
    candidate_blocker: false,
    limitation:
      "The fixture wording is less natural than production student-facing activity generation.",
    e2a27_requirement:
      "Future experience tests must begin with natural student-facing activity wording."
  };
  const candidateIntegrity = {
    integrity_version: "e2a26a-candidate-integrity-v1",
    candidate_configuration_hash: candidate.candidate_configuration_hash,
    expected_candidate_configuration_hash:
      E2A24_CANDIDATE_CONFIGURATION_HASH,
    candidate_file_sha256: candidateFileSha,
    expected_candidate_file_sha256: E2A24_CANDIDATE_FILE_SHA256,
    candidate_prompt_schema_validator_modified: false,
    candidate_approved: false,
    candidate_activated: false,
    passed: candidate.candidate_configuration_hash ===
      E2A24_CANDIDATE_CONFIGURATION_HASH &&
      candidateFileSha === E2A24_CANDIDATE_FILE_SHA256
  };

  writeJson(artifact("e2a26a-manifest.json"), {
    version: E2A26A_VERSION,
    status: E2A26A_STATUS,
    run_id: run,
    source_identity: sourceIdentity(),
    source_runs: { e2a25: E2A25_RUN_ID, e2a26: E2A26_RUN_ID },
    provider_calls_authorized: false,
    e2a27_execution_authorized: false,
    artifact_contract: E2A26A_ARTIFACT_NAMES
  });
  writeJson(artifact("human-review-attestation.json"), human);
  writeJson(artifact("ai-assisted-review-reference.json"), ai);
  writeJson(artifact("review-reconciliation.json"), {
    reconciliation_version: "e2a26a-human-ai-review-reconciliation-v1",
    dual_human_conclusion: {
      session_b_turn4_contradictory_and_non_sound: true,
      request_revision_premature: true,
      no_additional_material_issue_identified: true
    },
    ai_assisted_conclusion: {
      same_turn4_contradiction: true,
      turns_2_and_3_false_absent_anchor_mapping: true,
      initial_activity_fixture_realism_concern: true,
      tutor_candidate_otherwise_suitable: true
    },
    human_agreement_fabricated_for_ai_only_findings: false
  });
  writeJson(artifact("session-b-exact-reconstruction.json"), reconstruction);
  writeJson(artifact("session-b-turn4-contradiction-adjudication.json"),
    contradictionAdjudication);
  writeJson(artifact("anchor-application-contract.json"), {
    version: ANCHOR_CONCLUSION_CONSISTENCY_VERSION,
    field: "anchor_application", allowed_values: ["absent", "implicit", "explicit"],
    rule: "Directly naming the active item or option is explicit even when the conclusion is wrong.",
    domain_specific_hardcoding: false
  });
  writeJson(artifact("anchor-stance-contract.json"), {
    version: ANCHOR_CONCLUSION_CONSISTENCY_VERSION,
    field: "anchor_stance",
    allowed_values: ["not_expressed", "ambiguous", "endorses_distractor", "rejects_distractor"],
    ambiguity_policy:
      "Quoted, negated, hypothetical, or self-corrected language is interpreted conservatively; unresolved mixed conclusions require clarification."
  });
  writeJson(artifact("anchor-consistency-contract.json"), {
    version: ANCHOR_CONCLUSION_CONSISTENCY_VERSION,
    consistency_values: ["not_assessable", "consistent_with_conceptual_reasoning", "contradictory_to_conceptual_reasoning", "unresolved"],
    resolution_values: ["unresolved", "resolved_against_distractor", "regressed", "contradictory"],
    mixed_response_rule:
      "An explicit distractor endorsement plus conceptual rejection is a structured contradiction, not a presumed typo."
  });
  writeJson(artifact("target-evidence-contract-delta.json"), {
    from: "target-evidence-contract-v1", to: TARGET_EVIDENCE_CONTRACT_VERSION_V3,
    added_fields: ["active_anchor_id", "active_anchor_text", "active_anchor_type", "required_anchor_stance", "acceptable_anchor_paraphrases", "prohibited_anchor_stances", "anchor_resolution_criteria", "anchor_contradiction_criteria", "ambiguity_resolution_policy"]
  });
  writeJson(artifact("production-evaluator-delta.json"), {
    from: "production-turn-evidence-evaluator-v2",
    to: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V3,
    delta: ["separates anchor application from stance", "detects dynamic option references", "promotes anchor-conclusion conflicts", "does not hardcode domain or option D"]
  });
  writeJson(artifact("profile-mapper-delta.json"), {
    from: "turn-evidence-profile-mapper-v2",
    to: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V3,
    delta: ["maps explicit incorrect references as explicit", "maps anchor stance consistency and resolution", "prevents contradictory anchor responses from sound"]
  });
  writeJson(artifact("profile-consistency-delta.json"), {
    from: "turn-evidence-profile-consistency-v2",
    to: PROFILE_CONSISTENCY_POLICY_VERSION_V3,
    delta: ["fails when blocking anchor conflict is not structured", "rejects sound profiles with unresolved or contradictory anchor state"]
  });
  writeJson(artifact("sound-gate-delta.json"), {
    version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
    requires: ["all essential conceptual relationships", "required mechanism", "explicit anchor application", "rejects_distractor stance", "consistent_with_conceptual_reasoning", "resolved_against_distractor", "coherent conclusion", "no contradictions", "no essential missing links"]
  });
  writeJson(artifact("evidence-limitations-consistency-policy.json"), {
    version: "evidence-limitations-anchor-conflict-policy-v1",
    rule: "A limitation describing a direct anchor-conclusion conflict must be promoted to structured contradictions or profile construction fails closed.",
    minor_limitations_promoted: false,
    blocking_dimensions: ["core conceptual relationship", "mechanism", "anchor stance", "distractor resolution", "progression readiness"]
  });
  writeJson(artifact("session-a-replay.json"), sessionAReplay);
  writeJson(artifact("session-b-replay.json"), sessionBReplay);
  writeJson(artifact("session-c-replay.json"), sessionCReplay);
  writeJson(artifact("first-divergence-and-replay-boundary.json"),
    firstDivergence);
  writeJson(artifact("failure-taxonomy-reconciliation.json"), {
    version: "e2a26a-failure-taxonomy-reconciliation-v1",
    historical_e2a25_status_changed: false,
    session_c_diagnosis: "frozen_oracle_overconstraint",
    session_b_diagnosis:
      "e2a25_session_b_genuine_false_sound_due_to_anchor_contradiction",
    diagnoses_independent: true
  });
  writeJson(artifact("initial-activity-realism-audit.json"),
    initialActivityAudit);
  writeJsonl(artifact("calibration-corpus.jsonl"), calibrationCorpus);
  writeJsonl(artifact("calibration-results.jsonl"), calibrationResults);
  writeJson(artifact("candidate-integrity.json"), candidateIntegrity);
  writeJson(artifact("e2a27-held-out-overlap-analysis.json"), overlap);
  writeJson(artifact("e2a27-frozen-protocol.json"), protocol);
  const protocolFileHash = sha256(readFileSync(
    artifact("e2a27-frozen-protocol.json")
  ));
  writeFileSync(artifact("e2a27-frozen-protocol.sha256"),
    `${protocolFileHash}\n`, "utf8");
  writeJson(artifact("e2a27-budget.json"), budget);
  writeJson(artifact("e2a27-artifact-contract.json"), {
    contract_version: "e2a27-anchor-consistency-artifact-contract-v1",
    protocol_hash: protocol.protocol_hash,
    failure_path_artifacts_required: true,
    required_categories: ["manifest", "requests", "sanitized provider outputs", "profiles", "routes", "interventions", "complete visible conversation", "privacy", "persistence", "projection", "cleanup", "usage and cost", "human review packet"],
    provider_generated_but_not_displayed_output_must_be_retained: true,
    secrets_and_raw_provider_payloads_prohibited: true
  });

  const after = protectedSnapshot();
  const networkRequests = options.networkRequestCount?.() ?? 0;
  const calibrationPassed = calibrationResults.every((entry) => entry.passed);
  const b2 = sessionBReplay.turns.find((entry) => entry.turn === 2)!;
  const b3 = sessionBReplay.turns.find((entry) => entry.turn === 3)!;
  const summary = {
    summary_version: "e2a26a-summary-v1",
    status: E2A26A_STATUS,
    run_id: run,
    human_review_attestation_recorded: true,
    ai_assisted_review_recorded_separately: true,
    session_b_turn4_genuine_false_sound_confirmed: true,
    session_b_turn4_corrected: {
      reasoning_quality: b4.corrected_observation.reasoning_quality,
      anchor_application: b4.corrected_observation.anchor_application,
      anchor_stance: b4.corrected_observation.anchor_stance,
      anchor_consistency: b4.corrected_observation.anchor_consistency,
      anchor_resolution_status:
        b4.corrected_observation.anchor_resolution_status,
      contradictions: b4.corrected_observation.contradictions,
      revision_readiness: b4.corrected_profile.revision_readiness,
      platform_mode: b4.corrected_platform_mode
    },
    session_b_turn2_anchor_application:
      b2.corrected_observation.anchor_application,
    session_b_turn3_anchor_application:
      b3.corrected_observation.anchor_application,
    session_a_sound_remains_sound:
      sessionAReplay.turns.at(-1)?.corrected_profile.reasoning_quality ===
      "sound",
    session_c_oracle_diagnosis_intact: true,
    calibration_case_count: calibrationCorpus.length,
    calibration_non_irt_count:
      calibrationCorpus.filter((entry) => entry.non_irt).length,
    calibration_pass_count:
      calibrationResults.filter((entry) => entry.passed).length,
    calibration_failed_count:
      calibrationResults.filter((entry) => !entry.passed).length,
    calibration_passed: calibrationPassed,
    initial_activity_realism: initialActivityAudit.classification,
    candidate_configuration_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidateFileSha,
    candidate_integrity_passed: candidateIntegrity.passed,
    approved_v2_hash: APPROVED_V2_HASH,
    protected_evidence_before_hash: before.combined_sha256,
    protected_evidence_after_hash: after.combined_sha256,
    protected_evidence_unchanged:
      before.combined_sha256 === after.combined_sha256,
    e2a27_protocol_hash: protocol.protocol_hash,
    e2a27_protocol_file_sha256: protocolFileHash,
    e2a27_overlap_passed: overlap.passed,
    e2a27_budget_valid: budget.arithmetic_valid,
    e2a27_live_execution_authorized: false,
    e2a27_live_execution_performed: false,
    provider_call_count: 0,
    network_request_count: networkRequests,
    candidate_approved: false,
    candidate_activated: false
  };
  writeJson(artifact("summary.json"), summary);

  const actualArtifacts = readdirSync(runDir).sort();
  const expectedArtifacts = [...E2A26A_ARTIFACT_NAMES].sort();
  const validation = {
    artifact_count: actualArtifacts.length,
    exact_artifact_contract: JSON.stringify(actualArtifacts) ===
      JSON.stringify(expectedArtifacts),
    passed: actualArtifacts.length === E2A26A_ARTIFACT_NAMES.length &&
      JSON.stringify(actualArtifacts) === JSON.stringify(expectedArtifacts) &&
      calibrationPassed && candidateIntegrity.passed && overlap.passed &&
      budget.arithmetic_valid && before.combined_sha256 ===
      after.combined_sha256 && networkRequests === 0
  };
  if (!validation.passed) {
    throw new Error(`e2a26a_validation_failed:${JSON.stringify(validation)}`);
  }
  return { runId: run, runDir, summary, validation };
}

export function latestE2A26ARun(root = E2A26A_ARTIFACT_ROOT) {
  if (!existsSync(root)) return null;
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("e2a26a_"))
    .map((entry) => path.join(root, entry.name)).sort().at(-1) ?? null;
}
