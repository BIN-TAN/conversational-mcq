import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ActivityMisconceptionEvidencePacketV1Schema
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import {
  SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
  evaluateAnchorConsistentSoundGate,
  type AnchorResolutionStatus
} from "@/lib/services/student-assessment/anchor-conclusion-consistency";
import {
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
  ProductionTurnEvidenceStructuredFieldsV5Schema
} from "@/lib/services/student-assessment/production-turn-evidence-evaluator-v5";
import {
  PROFILE_CONSISTENCY_POLICY_VERSION_V6,
  TARGET_EVIDENCE_CONTRACT_VERSION_V5,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6,
  TargetEvidenceContractV5Schema,
  buildTargetEvidenceAdjudicationFromEvaluatorOutputV5,
  mapTargetEvidenceAdjudicationToObservationV6,
  type TargetEvidenceAdjudicationV5,
  type TargetEvidenceContractV5
} from "@/lib/services/student-assessment/target-evidence-contract-v5";

export const E2A31C_VERSION =
  "e2a31c-turn5-sound-adjudication-v1" as const;
export const E2A31C_STATUS =
  "e2a31c_frozen_trajectory_oracle_overconstraint_confirmed" as const;
export const E2A31C_SOURCE_RUN_ID =
  "e2a31b_20260723111043_c82c52ae" as const;
export const E2A31C_SOURCE_RUN_STATUS =
  "e2a31b_canary_failed_evidence_accuracy" as const;
export const E2A31C_SOURCE_FAILURE_CODE =
  "e2a31b_genuine_false_sound" as const;
export const E2A31C_SOURCE_PROTOCOL_HASH =
  "66bf3960794ca54f9cbafd7c20e5edebbd097e06454166df3eb6f0491df991ee" as const;
export const E2A31C_SOURCE_RUNTIME_IDENTITY =
  "fd0a9a647bc0dbd271c947ab8ca6f6ebe6ce15bc2c2ce341e34156d5196b6694" as const;
export const E2A31C_SOURCE_TREE_SHA256 =
  "6b8439e9ff9cec3098aa3fb39d162d36608c93d5851238cc1fa1958a1b23bf3b" as const;
export const E2A31C_SOURCE_FILE_COUNT = 84 as const;

export const E2A31C_SOURCE_RUN_DIR = path.join(
  process.cwd(),
  ".data",
  "e2a31b-ecology-anchor-stance-resolution-canary",
  E2A31C_SOURCE_RUN_ID
);
export const E2A31C_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a31c-turn5-sound-adjudication"
);

const EXPECTED_PROTECTED_SOURCE_HASHES = {
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json":
    "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2",
  "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts":
    "b57df1ed269ef1e5f7e2ec7ad3c394d0c7b247afa54c7d067598caa3e47eda09",
  "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts":
    "6ff02d152f95608235d78592a6a1d4970a1ed1f2d7477bbaaaca7e96a878f9cd",
  "src/lib/services/student-assessment/target-evidence-contract-v5.ts":
    "775dd493ce68a11223ec5407bd3fb4a146315e13dfbd566ab5b5159b9e8e2a6a",
  "src/lib/services/student-assessment/anchor-conclusion-consistency.ts":
    "d7c5c368b3e93f2f5b6f2932184491693d98f502cccec2ad5778f331b2caaf83"
} as const;

const EXPECTED_SOURCE_ARTIFACT_HASHES = {
  "canary-summary.json":
    "a7e38b9c0b032820fb5dc69ea4e13bf6eddaac43e021262f54f44e2758622824",
  "human-review-packet.json":
    "23c44df7edb30d2fdfa0855c5e557d89b0451a4fd0fcf47633f72c54d56e31d4",
  "evaluator-normalized-results.jsonl":
    "70907f878a53b6c859c67e1e25dc69a04cec66379c6e208c93e0ef779608fab5",
  "turn-evidence-observations.jsonl":
    "c368eec28f02ecbcb63c99f5ea3445ec4fe7600f89a32c8216a5a7500311b368",
  "session-designs.json":
    "880f322daac851b2ebe3d4867c99d33bb7fc367f78e51455c5b5002df67064c1",
  "contradiction-propagation-results.jsonl":
    "e9a3f6a1debf4c0c2d20f1061e31b6063da62d3f98a3bf9ee7a899bbbbdd9ebf",
  "anchor-stance-resolution-results.jsonl":
    "3090f7ceaf8645be1eac41484861bc216e07bf57ffee5542c323dfdd1eb769b2",
  "failure-path-results.jsonl":
    "9021c54f2958d48fd656a0c6c2c3cdf12f00c44a9c8f1cefeb13a9ecdda576ae",
  "complete-visible-conversations.jsonl":
    "e15590c1c7e30f48c3ff07443f412d595069e3e28d40076885dce4062eef1887"
} as const;

const PAYLOAD_ARTIFACT_NAMES = [
  "adjudication-manifest.json",
  "source-run-integrity.json",
  "turn-reconstruction.jsonl",
  "sound-gate-replay.jsonl",
  "ai-adjudication.json",
  "semantic-oracle-diagnosis.json",
  "human-review-packet-enhancement.json",
  "e2a32-preparation-decision.json",
  "summary.json"
] as const;

export const E2A31C_ARTIFACT_NAMES = [
  ...PAYLOAD_ARTIFACT_NAMES,
  "artifact-validation.json"
] as const;

type JsonObject = Record<string, unknown>;
type FrozenReasoningQuality =
  "insufficient" | "misconception" | "partial" | "sound";
type FrozenTurn = {
  turn: number;
  objective: string;
  no_live_fixture_message: string;
  simulator_instruction: string;
  semantic_envelope: FrozenReasoningQuality[];
  tutor_expected: boolean;
  required_anchor_application?: string;
  required_anchor_stance?: string;
  required_anchor_consistency?: string;
  required_contradiction?: string;
};
type VisibleTurn = {
  visible_turn_id: string;
  sequence_index: number;
  dialogue_turn_number: number;
  actor_type: "agent" | "student";
  message_text: string;
};
type FailurePathRow = {
  role: string | null;
  turn: number;
  parsed_structured_output?: {
    student_message?: string;
    expressed_evidence_level?: string;
    mentions_focus_option?: boolean;
  };
  complete_prior_visible_episode?:
    | VisibleTurn[]
    | { visible_turns?: VisibleTurn[] };
};
type EvaluatorNormalizedRow = {
  session_id: string;
  turn: number;
  evaluator_version: string;
  source_student_turn_id: string;
  source_sequence_index: number;
  structured_turn_evidence: unknown;
  effective_evidence_packet: unknown;
  provider_output_accepted: boolean;
  passed: boolean;
};
type PropagationRow = {
  session_id: string;
  turn: number;
  propagation_version: string;
  anchor_application: string;
  anchor_stance: string;
  anchor_consistency: string;
  anchor_resolution_status: string;
  structured_contradictions: unknown[];
  blocking: boolean;
  revision_ready: boolean;
  anchor_interpretation: unknown;
  passed: boolean;
};
type SourceTreeSnapshot = {
  snapshot_version: string;
  root: string;
  file_count: number;
  aggregate_sha256: string;
  files: Array<{ path: string; sha256: string }>;
  critical_artifact_hashes: Record<string, string>;
};
type ReconstructionRow = ReturnType<typeof reconstructTurns>[number];

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonl<T>(filePath: string): T[] {
  const text = readFileSync(filePath, "utf8").trim();
  return text
    ? text.split(/\r?\n/u).map((line) => JSON.parse(line) as T)
    : [];
}

function assertSafeArtifact(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const forbidden = [
    /\bBearer\s+[A-Za-z0-9._-]+/u,
    /\bsk-[A-Za-z0-9_-]{12,}/u,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u,
    /authorization\s*:\s*["']?bearer/iu,
    /cookie\s*:\s*["'][^"']+/iu
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error("e2a31c_forbidden_secret_detected");
  }
}

function writeJson(filePath: string, value: unknown) {
  assertSafeArtifact(value);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(filePath: string, rows: unknown[]) {
  rows.forEach(assertSafeArtifact);
  writeFileSync(
    filePath,
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8"
  );
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => listFiles(path.join(root, entry.name)))
    .sort();
}

function sourceTreeSnapshot(): SourceTreeSnapshot {
  if (!existsSync(E2A31C_SOURCE_RUN_DIR)) {
    throw new Error("e2a31c_source_run_missing");
  }
  const files = listFiles(E2A31C_SOURCE_RUN_DIR).map((filePath) => ({
    path: path.relative(E2A31C_SOURCE_RUN_DIR, filePath),
    sha256: sha256(readFileSync(filePath))
  }));
  const criticalArtifactHashes = Object.fromEntries(
    Object.keys(EXPECTED_SOURCE_ARTIFACT_HASHES).map((name) => [
      name,
      sha256(readFileSync(path.join(E2A31C_SOURCE_RUN_DIR, name)))
    ])
  );
  return {
    snapshot_version: "e2a31c-source-tree-snapshot-v1",
    root: path.relative(process.cwd(), E2A31C_SOURCE_RUN_DIR),
    file_count: files.length,
    aggregate_sha256: sha256(
      files.map((entry) => `${entry.path}:${entry.sha256}`).join("\n")
    ),
    files,
    critical_artifact_hashes: criticalArtifactHashes
  };
}

function protectedSourceIntegrity() {
  const actual = Object.fromEntries(
    Object.keys(EXPECTED_PROTECTED_SOURCE_HASHES).map((relativePath) => [
      relativePath,
      sha256(readFileSync(path.join(process.cwd(), relativePath)))
    ])
  );
  const mismatches = Object.entries(EXPECTED_PROTECTED_SOURCE_HASHES)
    .filter(([relativePath, expected]) => actual[relativePath] !== expected)
    .map(([relativePath, expected]) => ({
      relative_path: relativePath,
      expected_sha256: expected,
      actual_sha256: actual[relativePath]
    }));
  return {
    integrity_version: "e2a31c-protected-source-integrity-v1",
    candidate_configuration_hash:
      "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b",
    expected_sha256: EXPECTED_PROTECTED_SOURCE_HASHES,
    actual_sha256: actual,
    mismatches,
    evaluator_v5_unchanged: actual[
      "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
    ] === EXPECTED_PROTECTED_SOURCE_HASHES[
      "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
    ],
    tutor_candidate_unchanged: actual[
      "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
    ] === EXPECTED_PROTECTED_SOURCE_HASHES[
      "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
    ],
    sound_gate_unchanged: actual[
      "src/lib/services/student-assessment/anchor-conclusion-consistency.ts"
    ] === EXPECTED_PROTECTED_SOURCE_HASHES[
      "src/lib/services/student-assessment/anchor-conclusion-consistency.ts"
    ],
    passed: mismatches.length === 0
  };
}

function sourceSnapshotPassed(snapshot: SourceTreeSnapshot) {
  return snapshot.file_count === E2A31C_SOURCE_FILE_COUNT &&
    snapshot.aggregate_sha256 === E2A31C_SOURCE_TREE_SHA256 &&
    Object.entries(EXPECTED_SOURCE_ARTIFACT_HASHES).every(
      ([name, expected]) =>
        snapshot.critical_artifact_hashes[name] === expected
    );
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

function makeRunId() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/gu, "")
    .slice(0, 14);
  return `e2a31c_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function visibleTurns(row: FailurePathRow): VisibleTurn[] {
  if (Array.isArray(row.complete_prior_visible_episode)) {
    return row.complete_prior_visible_episode;
  }
  return row.complete_prior_visible_episode?.visible_turns ?? [];
}

function gateInputs(
  contract: TargetEvidenceContractV5,
  adjudication: TargetEvidenceAdjudicationV5
) {
  const results = new Map(adjudication.criterion_results.map((entry) => [
    entry.criterion_id,
    entry
  ]));
  const conceptualCriteria = contract.criteria.filter((criterion) =>
    criterion.criterion_kind === "conceptual_relationship"
  );
  const mechanismCriteria = contract.criteria.filter((criterion) =>
    criterion.criterion_kind === "required_mechanism"
  );
  const essentialMissingLinks = contract.criteria.filter((criterion) =>
    criterion.essential_for_revision &&
    !results.get(criterion.criterion_id)?.satisfied
  ).map((criterion) => criterion.criterion_id);
  const interpretation =
    adjudication.anchor_propagation.anchor_interpretation;
  if (interpretation.anchor_stance !== contract.required_anchor_stance) {
    essentialMissingLinks.push("required_anchor_rejection");
  }
  if (interpretation.anchor_consistency !==
      "consistent_with_conceptual_reasoning") {
    essentialMissingLinks.push("anchor_conclusion_consistency");
  }
  if (interpretation.anchor_resolution_status !==
      "resolved_against_distractor") {
    essentialMissingLinks.push("anchor_resolution_against_distractor");
  }
  const contradictions = adjudication.contradiction_results
    .filter((entry) => entry.present)
    .map((entry) => entry.contradiction_id);
  return {
    all_essential_conceptual_relationships_satisfied:
      conceptualCriteria.length > 0 &&
      conceptualCriteria.every((criterion) =>
        results.get(criterion.criterion_id)?.satisfied === true
      ),
    required_mechanism_demonstrated:
      mechanismCriteria.length > 0 &&
      mechanismCriteria.every((criterion) =>
        results.get(criterion.criterion_id)?.satisfied === true
      ),
    coherent_conclusion: adjudication.coherent_conclusion,
    essential_missing_links: [...new Set(essentialMissingLinks)],
    contradictions: [...new Set(contradictions)],
    interpretation
  };
}

function stableComparablePropagation(row: PropagationRow) {
  return {
    anchor_application: row.anchor_application,
    anchor_stance: row.anchor_stance,
    anchor_consistency: row.anchor_consistency,
    anchor_resolution_status: row.anchor_resolution_status,
    blocking: row.blocking,
    revision_ready: row.revision_ready,
    structured_contradictions: row.structured_contradictions
  };
}

function stableComparableReplayedPropagation(
  adjudication: TargetEvidenceAdjudicationV5,
  revisionReady: boolean
) {
  const propagation = adjudication.anchor_propagation;
  return {
    anchor_application: propagation.anchor_application,
    anchor_stance: propagation.anchor_stance,
    anchor_consistency: propagation.anchor_consistency,
    anchor_resolution_status: propagation.anchor_resolution_status,
    blocking: propagation.blocking,
    revision_ready: revisionReady,
    structured_contradictions: propagation.structured_contradictions
  };
}

function reconstructTurns(source: {
  contract: TargetEvidenceContractV5;
  frozenTurns: FrozenTurn[];
  humanAdjudicatedEarliestSoundTurn: number;
  simulatorRows: FailurePathRow[];
  evaluatorRows: EvaluatorNormalizedRow[];
  propagationRows: PropagationRow[];
}) {
  let priorAnchorResolution: AnchorResolutionStatus | null = null;
  return source.frozenTurns.filter((turn) => turn.turn <= 5).map(
    (frozenTurn) => {
      const simulator = source.simulatorRows.find((entry) =>
        entry.turn === frozenTurn.turn
      );
      const evaluator = source.evaluatorRows.find((entry) =>
        entry.turn === frozenTurn.turn
      );
      const persistedPropagation = source.propagationRows.find((entry) =>
        entry.turn === frozenTurn.turn
      );
      const studentMessage =
        simulator?.parsed_structured_output?.student_message;
      if (!simulator || !evaluator || !persistedPropagation ||
          !studentMessage) {
        throw new Error(
          `e2a31c_turn_source_incomplete:turn_${frozenTurn.turn}`
        );
      }
      const history = visibleTurns(simulator);
      const priorVisibleAgentMessage = [...history].reverse()
        .find((entry) => entry.actor_type === "agent")?.message_text ?? null;
      const packet = ActivityMisconceptionEvidencePacketV1Schema.parse(
        evaluator.effective_evidence_packet
      );
      const structured =
        ProductionTurnEvidenceStructuredFieldsV5Schema.parse(
          evaluator.structured_turn_evidence
        );
      const adjudication =
        buildTargetEvidenceAdjudicationFromEvaluatorOutputV5({
          latest_student_message: studentMessage,
          packet,
          structured_turn_evidence: structured,
          contract: source.contract,
          expected_source_student_turn_id: evaluator.source_student_turn_id,
          expected_source_sequence_index: evaluator.source_sequence_index,
          prior_visible_message: priorVisibleAgentMessage,
          prior_anchor_resolution_status: priorAnchorResolution
        });
      priorAnchorResolution =
        adjudication.anchor_propagation.anchor_resolution_status;
      const observation = mapTargetEvidenceAdjudicationToObservationV6({
        contract: source.contract,
        adjudication,
        interaction_intent: "ordinary_conceptual_response",
        confidence_evidence: structured.confidence_evidence
      });
      const inputs = gateInputs(source.contract, adjudication);
      const gate = evaluateAnchorConsistentSoundGate(inputs);
      const revisionReady = gate.passed &&
        observation.reasoning_quality === "sound" &&
        observation.essential_missing_links.length === 0 &&
        observation.contradictions.length === 0;
      const propagationMatches =
        JSON.stringify(stableComparablePropagation(persistedPropagation)) ===
        JSON.stringify(stableComparableReplayedPropagation(
          adjudication,
          revisionReady
        ));
      const insideFrozenEnvelope = frozenTurn.semantic_envelope.includes(
        observation.reasoning_quality
      );
      const explicitFinalStanceObserved =
        adjudication.anchor_propagation.anchor_application === "explicit" &&
        ["endorses_distractor", "rejects_distractor"].includes(
          adjudication.anchor_propagation.anchor_stance
        );
      return {
        reconstruction_version: "e2a31c-turn-reconstruction-v1",
        source_run_id: E2A31C_SOURCE_RUN_ID,
        session_id: evaluator.session_id,
        turn: frozenTurn.turn,
        student_response: studentMessage,
        prior_visible_agent_message: priorVisibleAgentMessage,
        frozen_expected_trajectory: {
          objective: frozenTurn.objective,
          simulator_instruction: frozenTurn.simulator_instruction,
          semantic_envelope: frozenTurn.semantic_envelope,
          tutor_expected: frozenTurn.tutor_expected,
          human_adjudicated_earliest_sound_turn:
            source.humanAdjudicatedEarliestSoundTurn
        },
        simulator_self_report: {
          expressed_evidence_level:
            simulator.parsed_structured_output?.expressed_evidence_level ??
            null,
          mentions_focus_option:
            simulator.parsed_structured_output?.mentions_focus_option ?? null
        },
        evaluator_output: {
          evaluator_version: evaluator.evaluator_version,
          provider_output_accepted: evaluator.provider_output_accepted,
          normalized_output_passed: evaluator.passed,
          structured_turn_evidence: structured,
          effective_evidence_packet: packet
        },
        anchor_evidence: {
          reference: adjudication.canonical_anchor_evidence.application,
          stance: adjudication.canonical_anchor_evidence.stance,
          anchor_id: adjudication.canonical_anchor_evidence.anchor_id,
          parity_passed:
            adjudication.anchor_parity_reconciliation.passed,
          alias_resolution:
            adjudication.anchor_alias_resolution.observed_anchor_reference,
          propagated_application:
            adjudication.anchor_propagation.anchor_application,
          propagated_stance: adjudication.anchor_propagation.anchor_stance,
          propagated_consistency:
            adjudication.anchor_propagation.anchor_consistency,
          propagated_resolution_status:
            adjudication.anchor_propagation.anchor_resolution_status,
          explicit_final_stance_observed: explicitFinalStanceObserved
        },
        contradiction_status: {
          blocking: adjudication.anchor_propagation.blocking,
          structured_contradictions:
            adjudication.anchor_propagation.structured_contradictions,
          observation_contradictions: observation.contradictions
        },
        sound_gate_inputs: inputs,
        sound_gate_result: gate,
        mapped_profile: {
          mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6,
          policy_version: PROFILE_CONSISTENCY_POLICY_VERSION_V6,
          reasoning_quality: observation.reasoning_quality,
          misconception_status: observation.misconception_status,
          essential_missing_links: observation.essential_missing_links,
          contradictions: observation.contradictions,
          revision_readiness: revisionReady
        },
        frozen_oracle_comparison: {
          actual_reasoning_quality: observation.reasoning_quality,
          inside_frozen_semantic_envelope: insideFrozenEnvelope,
          scripted_tutor_expectation_matches:
            frozenTurn.tutor_expected === !gate.passed,
          simulator_instruction_adherence:
            frozenTurn.turn === 5 && explicitFinalStanceObserved
              ? "violated_no_final_stance_constraint"
              : "no_adjudicated_violation"
        },
        persisted_propagation: persistedPropagation,
        replay_matches_persisted_propagation: propagationMatches,
        source_evaluator_or_tutor_modified: false
      };
    }
  );
}

function loadSourceEvidence() {
  const summary = readJson<{
    run_id: string;
    status: string;
    failure_reason: string;
    protocol_hash: string;
    candidate_approved: boolean;
    candidate_activated: boolean;
  }>(path.join(E2A31C_SOURCE_RUN_DIR, "canary-summary.json"));
  const frozenIdentity = readJson<{
    composite_runtime_identity_hash: string;
  }>(path.join(
    E2A31C_SOURCE_RUN_DIR,
    "frozen-composite-runtime-identity.json"
  ));
  const designs = readJson<{
    sessions: Array<{
      session_id: string;
      frozen_student_trajectory: FrozenTurn[];
      human_adjudicated_earliest_sound_turn: number;
    }>;
  }>(path.join(E2A31C_SOURCE_RUN_DIR, "session-designs.json"));
  const humanReview = readJson<{
    packet_version: string;
    item_count: number;
    human_review_required: boolean;
    human_review_complete: boolean;
    ratings_prepopulated: boolean;
    recommendation: string;
  }>(path.join(E2A31C_SOURCE_RUN_DIR, "human-review-packet.json"));
  const contract = TargetEvidenceContractV5Schema.parse(
    readJson(path.join(E2A31C_SOURCE_RUN_DIR, "target-evidence-contract.json"))
  );
  const failureRows = readJsonl<FailurePathRow>(
    path.join(E2A31C_SOURCE_RUN_DIR, "failure-path-results.jsonl")
  );
  const simulatorRows = failureRows.filter((entry) =>
    entry.role === "simulator" &&
    typeof entry.parsed_structured_output?.student_message === "string"
  );
  const evaluatorRows = readJsonl<EvaluatorNormalizedRow>(
    path.join(
      E2A31C_SOURCE_RUN_DIR,
      "evaluator-normalized-results.jsonl"
    )
  );
  const propagationRows = readJsonl<PropagationRow>(
    path.join(
      E2A31C_SOURCE_RUN_DIR,
      "contradiction-propagation-results.jsonl"
    )
  );
  const preTutorRows = readJsonl<{
    turn: number;
    tutor_called: boolean;
    finalized_before_tutor_dispatch: boolean;
    passed: boolean;
  }>(path.join(
    E2A31C_SOURCE_RUN_DIR,
    "pre-tutor-finalization-results.jsonl"
  ));
  const session = designs.sessions[0];
  const valid = summary.run_id === E2A31C_SOURCE_RUN_ID &&
    summary.status === E2A31C_SOURCE_RUN_STATUS &&
    summary.failure_reason === E2A31C_SOURCE_FAILURE_CODE &&
    summary.protocol_hash === E2A31C_SOURCE_PROTOCOL_HASH &&
    frozenIdentity.composite_runtime_identity_hash ===
      E2A31C_SOURCE_RUNTIME_IDENTITY &&
    !summary.candidate_approved && !summary.candidate_activated &&
    session?.session_id === "E2A31B-ECOLOGY" &&
    session.frozen_student_trajectory.length === 6 &&
    session.human_adjudicated_earliest_sound_turn === 6 &&
    simulatorRows.length === 5 && evaluatorRows.length === 5 &&
    propagationRows.length === 5 &&
    preTutorRows.find((entry) => entry.turn === 5)?.tutor_called === false &&
    humanReview.item_count === 42 &&
    humanReview.human_review_required &&
    !humanReview.human_review_complete &&
    !humanReview.ratings_prepopulated;
  if (!valid) throw new Error("e2a31c_source_contract_mismatch");
  return {
    summary,
    frozenIdentity,
    session,
    humanReview,
    contract,
    simulatorRows,
    evaluatorRows,
    propagationRows,
    preTutorRows
  };
}

function buildAiAdjudication(turns: ReconstructionRow[]) {
  const turn5 = turns.find((entry) => entry.turn === 5);
  if (!turn5) throw new Error("e2a31c_turn5_missing");
  return {
    adjudication_version: "e2a31c-ai-adjudication-v1",
    review_source: "ai_agent_no_live_evidence_review",
    review_target: "e2a31b_turn_5_evaluator_sound_classification",
    source_run_id: E2A31C_SOURCE_RUN_ID,
    source_run_remains_historical_failure: true,
    human_review_complete: false,
    human_reviewer: null,
    human_rating: null,
    candidate_outcomes: [
      {
        outcome:
          "genuine_false_sound_evaluator_promoted_non_sound_response",
        selected: false,
        disposition: "rejected_by_existing_sound_gate_replay"
      },
      {
        outcome:
          "frozen_trajectory_oracle_overconstraint_evaluator_detected_sound_earlier_than_scripted",
        selected: true,
        disposition: "supported_by_existing_sound_gate_replay"
      }
    ],
    selected_outcome: "frozen_trajectory_oracle_overconstraint",
    confidence: "high",
    evidence: {
      turn5_student_response: turn5.student_response,
      evaluator_version:
        turn5.evaluator_output.evaluator_version,
      anchor_application:
        turn5.anchor_evidence.propagated_application,
      anchor_stance: turn5.anchor_evidence.propagated_stance,
      anchor_consistency:
        turn5.anchor_evidence.propagated_consistency,
      anchor_resolution_status:
        turn5.anchor_evidence.propagated_resolution_status,
      contradiction_count:
        turn5.contradiction_status.observation_contradictions.length,
      essential_missing_link_count:
        turn5.mapped_profile.essential_missing_links.length,
      sound_gate_version: turn5.sound_gate_result.gate_version,
      sound_gate_passed: turn5.sound_gate_result.passed,
      revision_readiness: turn5.mapped_profile.revision_readiness,
      frozen_turn5_semantic_envelope:
        turn5.frozen_expected_trajectory.semantic_envelope,
      frozen_oracle_match:
        turn5.frozen_oracle_comparison.inside_frozen_semantic_envelope,
      trajectory_instruction_adherence:
        turn5.frozen_oracle_comparison.simulator_instruction_adherence
    },
    rationale: [
      "The response supplies the required indirect consumer mechanism.",
      "The response states that focal prey could decrease, defeating the guaranteed-increase claim.",
      "The response explicitly rejects the active anchor through an accepted claim-level paraphrase.",
      "The propagated anchor evidence is consistent, resolved, and contradiction-free.",
      "Every existing production sound-gate condition passes.",
      "The scripted Turn 5 envelope required partial evidence only because the simulator was instructed to postpone its final stance."
    ],
    limitations: [
      "The response followed substantial scaffolding.",
      "Independent transfer to a new ecology case was not observed.",
      "This adjudication addresses evaluator accuracy for one synthetic turn and does not establish classroom validity."
    ],
    provider_calls_made: 0
  };
}

function buildSemanticOracleDiagnosis(turns: ReconstructionRow[]) {
  const turn5 = turns.find((entry) => entry.turn === 5);
  if (!turn5) throw new Error("e2a31c_turn5_missing");
  return {
    diagnosis_version: "e2a31c-semantic-oracle-diagnosis-v1",
    source_run_id: E2A31C_SOURCE_RUN_ID,
    historical_failure_code: E2A31C_SOURCE_FAILURE_CODE,
    historical_failure_code_preserved: true,
    historical_evidence_mutated: false,
    diagnosis: "frozen_trajectory_oracle_overconstraint",
    failure_location:
      "post-finalization scripted semantic-envelope comparison",
    production_evidence_decision: {
      sound_gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
      evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
      mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6,
      sound_gate_passed: turn5.sound_gate_result.passed,
      revision_ready: turn5.mapped_profile.revision_readiness,
      tutor_correctly_suppressed: true
    },
    simulator_trajectory_decision: {
      scripted_turn: 5,
      expected_semantic_envelope:
        turn5.frozen_expected_trajectory.semantic_envelope,
      expected_no_explicit_final_stance: true,
      explicit_final_stance_observed:
        turn5.anchor_evidence.explicit_final_stance_observed,
      adherence_result: "trajectory_instruction_violation"
    },
    responsibility_split: {
      evaluator_accuracy: "passed",
      production_sound_gate: "passed",
      simulator_trajectory_adherence: "failed",
      frozen_oracle_classification: "overconstrained",
      tutor_candidate_implicated: false,
      evaluator_v5_implicated: false
    },
    required_future_oracle_behavior: [
      "Judge evaluator accuracy from observable evidence using the production sound gate.",
      "Record a simulator trajectory-adherence failure separately when a generated response advances earlier than scripted.",
      "Do not convert an evidence-supported early sound response into a false-sound evaluator failure.",
      "Preserve fail-closed behavior for actual missing mechanisms, unresolved anchors, contradictions, or unsupported progression."
    ],
    provider_calls_made: 0
  };
}

function buildHumanReviewEnhancement(
  turns: ReconstructionRow[],
  aiAdjudication: ReturnType<typeof buildAiAdjudication>,
  sourceHumanReview: ReturnType<typeof loadSourceEvidence>["humanReview"]
) {
  const turn5 = turns.find((entry) => entry.turn === 5);
  if (!turn5) throw new Error("e2a31c_turn5_missing");
  return {
    enhancement_version: "e2a31c-human-review-packet-enhancement-v1",
    source_run_id: E2A31C_SOURCE_RUN_ID,
    source_packet_binding: {
      packet_version: sourceHumanReview.packet_version,
      sha256:
        EXPECTED_SOURCE_ARTIFACT_HASHES["human-review-packet.json"],
      item_count: sourceHumanReview.item_count,
      source_packet_mutated: false
    },
    enhancement_scope:
      "turns_1_through_5_evaluator_accuracy_and_oracle_responsibility",
    turn_review_rows: turns.map((entry) => ({
      turn: entry.turn,
      student_response: entry.student_response,
      frozen_objective:
        entry.frozen_expected_trajectory.objective,
      frozen_semantic_envelope:
        entry.frozen_expected_trajectory.semantic_envelope,
      evaluator_reasoning_quality:
        entry.mapped_profile.reasoning_quality,
      anchor_application:
        entry.anchor_evidence.propagated_application,
      anchor_stance: entry.anchor_evidence.propagated_stance,
      anchor_consistency:
        entry.anchor_evidence.propagated_consistency,
      contradiction_count:
        entry.contradiction_status.observation_contradictions.length,
      essential_missing_links:
        entry.mapped_profile.essential_missing_links,
      sound_gate_passed: entry.sound_gate_result.passed,
      revision_readiness:
        entry.mapped_profile.revision_readiness,
      inside_frozen_semantic_envelope:
        entry.frozen_oracle_comparison.inside_frozen_semantic_envelope
    })),
    turn5_review_focus: {
      evaluator_output: turn5.evaluator_output,
      sound_gate_inputs: turn5.sound_gate_inputs,
      sound_gate_result: turn5.sound_gate_result,
      frozen_expected_trajectory:
        turn5.frozen_expected_trajectory,
      ai_adjudication: aiAdjudication.selected_outcome
    },
    human_review_questions: [
      "Does Turn 5 state a plausible indirect food-web mechanism?",
      "Does Turn 5 reject the guaranteed prey-increase claim?",
      "Does the claim-level rejection count as explicit application to the active anchor?",
      "Is any contradiction or essential missing link observable?",
      "Should the scripted trajectory violation be separated from evaluator accuracy?"
    ],
    human_review_required: true,
    human_review_complete: false,
    human_reviewer: null,
    human_rating: null,
    human_notes: null,
    ai_review_present: true,
    provider_calls_made: 0
  };
}

function buildE2A32Decision(
  diagnosis: ReturnType<typeof buildSemanticOracleDiagnosis>
) {
  return {
    decision_version: "e2a31c-e2a32-preparation-decision-v1",
    source_run_id: E2A31C_SOURCE_RUN_ID,
    preparation_allowed: diagnosis.diagnosis ===
      "frozen_trajectory_oracle_overconstraint",
    live_execution_authorized: false,
    provider_dispatch_authorized: false,
    protocol_frozen: false,
    candidate_approved: false,
    candidate_activated: false,
    larger_matrix_authorized: false,
    required_before_any_future_live_execution: [
      "Create a separately versioned E2A.32 protocol.",
      "Separate simulator trajectory adherence from evaluator evidence accuracy.",
      "Use the existing production sound gate as the evaluator-accuracy oracle.",
      "Retain the existing evaluator V5 and tutor candidate unchanged.",
      "Run complete no-live protocol, artifact, budget, and provider-call-guard verification.",
      "Obtain separate explicit user authorization."
    ],
    human_review_pending: true,
    classroom_validity: false,
    provider_calls_made: 0
  };
}

function pathsFor(runDir: string) {
  return Object.fromEntries(E2A31C_ARTIFACT_NAMES.map((name) => [
    name,
    path.join(runDir, name)
  ])) as Record<typeof E2A31C_ARTIFACT_NAMES[number], string>;
}

export function validateE2A31CArtifacts(runDir: string) {
  const failures: string[] = [];
  const expected = [...E2A31C_ARTIFACT_NAMES].sort();
  const actual = existsSync(runDir) ? readdirSync(runDir).sort() : [];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push("artifact_name_or_count_mismatch");
  }
  for (const name of expected) {
    const filePath = path.join(runDir, name);
    if (!existsSync(filePath) || statSync(filePath).size === 0) {
      failures.push(`artifact_missing_or_empty:${name}`);
      continue;
    }
    try {
      const parsed = name.endsWith(".jsonl")
        ? readJsonl(filePath)
        : readJson(filePath);
      assertSafeArtifact(parsed);
    } catch {
      failures.push(`artifact_malformed_or_unsafe:${name}`);
    }
  }
  if (existsSync(path.join(runDir, "turn-reconstruction.jsonl")) &&
      readJsonl(path.join(runDir, "turn-reconstruction.jsonl")).length !== 5) {
    failures.push("turn_reconstruction_count_mismatch");
  }
  if (existsSync(path.join(runDir, "sound-gate-replay.jsonl")) &&
      readJsonl(path.join(runDir, "sound-gate-replay.jsonl")).length !== 5) {
    failures.push("sound_gate_replay_count_mismatch");
  }
  return {
    validation_version: "e2a31c-artifact-validation-v1",
    expected_artifact_count: expected.length,
    actual_artifact_count: actual.length,
    artifact_hashes: actual.map((name) => ({
      name,
      sha256: sha256(readFileSync(path.join(runDir, name)))
    })),
    failures,
    passed: failures.length === 0
  };
}

export async function executeE2A31C(
  input: { artifactRoot?: string } = {}
) {
  const sourceBefore = sourceTreeSnapshot();
  const protectedBefore = protectedSourceIntegrity();
  if (!sourceSnapshotPassed(sourceBefore)) {
    throw new Error("e2a31c_source_integrity_precheck_failed");
  }
  if (!protectedBefore.passed) {
    throw new Error("e2a31c_protected_source_precheck_failed");
  }
  const source = loadSourceEvidence();
  const turns = reconstructTurns({
    contract: source.contract,
    frozenTurns: source.session.frozen_student_trajectory,
    humanAdjudicatedEarliestSoundTurn:
      source.session.human_adjudicated_earliest_sound_turn,
    simulatorRows: source.simulatorRows,
    evaluatorRows: source.evaluatorRows,
    propagationRows: source.propagationRows
  });
  const turn5 = turns.find((entry) => entry.turn === 5);
  const turn3 = turns.find((entry) => entry.turn === 3);
  if (!turn5 || !turn3) throw new Error("e2a31c_required_turn_missing");
  const decisiveBoundaryPassed = turn5.sound_gate_result.passed &&
    turn5.mapped_profile.reasoning_quality === "sound" &&
    turn5.mapped_profile.revision_readiness &&
    turn5.anchor_evidence.propagated_application === "explicit" &&
    turn5.anchor_evidence.propagated_stance === "rejects_distractor" &&
    turn5.anchor_evidence.propagated_consistency ===
      "consistent_with_conceptual_reasoning" &&
    turn5.anchor_evidence.propagated_resolution_status ===
      "resolved_against_distractor" &&
    turn5.contradiction_status.observation_contradictions.length === 0 &&
    turn5.mapped_profile.essential_missing_links.length === 0 &&
    !turn5.frozen_oracle_comparison.inside_frozen_semantic_envelope &&
    turn5.frozen_oracle_comparison.simulator_instruction_adherence ===
      "violated_no_final_stance_constraint";
  const repairedTurn3BoundaryPassed =
    !turn3.sound_gate_result.passed &&
    turn3.anchor_evidence.propagated_stance === "endorses_distractor" &&
    turn3.anchor_evidence.propagated_consistency ===
      "contradictory_to_conceptual_reasoning" &&
    turn3.contradiction_status.blocking;
  if (!decisiveBoundaryPassed || !repairedTurn3BoundaryPassed ||
      turns.some((entry) => !entry.replay_matches_persisted_propagation)) {
    throw new Error("e2a31c_sound_gate_replay_failed");
  }

  const aiAdjudication = buildAiAdjudication(turns);
  const oracleDiagnosis = buildSemanticOracleDiagnosis(turns);
  const humanReviewEnhancement = buildHumanReviewEnhancement(
    turns,
    aiAdjudication,
    source.humanReview
  );
  const e2a32Decision = buildE2A32Decision(oracleDiagnosis);
  const artifactRoot = input.artifactRoot ?? E2A31C_ARTIFACT_ROOT;
  const runId = makeRunId();
  const runDir = path.join(artifactRoot, runId);
  mkdirSync(artifactRoot, { recursive: true });
  mkdirSync(runDir, { recursive: false });
  const paths = pathsFor(runDir);
  const startedAt = new Date().toISOString();
  const sourceAfterReplay = sourceTreeSnapshot();
  const protectedAfter = protectedSourceIntegrity();
  const sourceUnchanged = JSON.stringify(sourceBefore) ===
    JSON.stringify(sourceAfterReplay);
  const protectedUnchanged = JSON.stringify(protectedBefore.actual_sha256) ===
    JSON.stringify(protectedAfter.actual_sha256);
  if (!sourceUnchanged || !protectedUnchanged) {
    throw new Error("e2a31c_source_mutation_detected");
  }

  writeJson(paths["adjudication-manifest.json"], {
    manifest_version: E2A31C_VERSION,
    run_id: runId,
    started_at: startedAt,
    application_git_commit: currentCommit(),
    source_run_id: E2A31C_SOURCE_RUN_ID,
    source_run_status: E2A31C_SOURCE_RUN_STATUS,
    source_failure_code: E2A31C_SOURCE_FAILURE_CODE,
    source_protocol_hash: E2A31C_SOURCE_PROTOCOL_HASH,
    source_runtime_identity: E2A31C_SOURCE_RUNTIME_IDENTITY,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    target_contract_version: TARGET_EVIDENCE_CONTRACT_VERSION_V5,
    mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6,
    sound_gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
    source_evidence_mutation_allowed: false,
    evaluator_modified: false,
    tutor_candidate_modified: false,
    provider_calls_made: 0,
    live_rerun_executed: false
  });
  writeJson(paths["source-run-integrity.json"], {
    integrity_version: "e2a31c-source-run-integrity-v1",
    source_before: sourceBefore,
    source_after: sourceAfterReplay,
    source_unchanged: sourceUnchanged,
    source_snapshot_passed: sourceSnapshotPassed(sourceBefore),
    protected_source_before: protectedBefore,
    protected_source_after: protectedAfter,
    protected_source_unchanged: protectedUnchanged,
    historical_run_status_unchanged: true,
    historical_failure_code_unchanged: true,
    passed: sourceUnchanged && protectedUnchanged &&
      sourceSnapshotPassed(sourceBefore) && protectedAfter.passed
  });
  writeJsonl(paths["turn-reconstruction.jsonl"], turns);
  writeJsonl(paths["sound-gate-replay.jsonl"], turns.map((entry) => ({
    replay_version: "e2a31c-production-sound-gate-replay-v1",
    source_run_id: E2A31C_SOURCE_RUN_ID,
    session_id: entry.session_id,
    turn: entry.turn,
    sound_gate_inputs: entry.sound_gate_inputs,
    sound_gate_result: entry.sound_gate_result,
    mapped_reasoning_quality: entry.mapped_profile.reasoning_quality,
    revision_readiness: entry.mapped_profile.revision_readiness,
    frozen_semantic_envelope:
      entry.frozen_expected_trajectory.semantic_envelope,
    inside_frozen_semantic_envelope:
      entry.frozen_oracle_comparison.inside_frozen_semantic_envelope,
    replay_matches_persisted_propagation:
      entry.replay_matches_persisted_propagation,
    provider_calls_made: 0
  })));
  writeJson(paths["ai-adjudication.json"], aiAdjudication);
  writeJson(paths["semantic-oracle-diagnosis.json"], oracleDiagnosis);
  writeJson(
    paths["human-review-packet-enhancement.json"],
    humanReviewEnhancement
  );
  writeJson(paths["e2a32-preparation-decision.json"], e2a32Decision);
  const summary = {
    summary_version: "e2a31c-turn5-sound-adjudication-summary-v1",
    status: E2A31C_STATUS,
    run_id: runId,
    run_directory: path.relative(process.cwd(), runDir),
    source_run_id: E2A31C_SOURCE_RUN_ID,
    source_run_status: E2A31C_SOURCE_RUN_STATUS,
    source_failure_code: E2A31C_SOURCE_FAILURE_CODE,
    source_run_reclassified_as_passed: false,
    adjudicated_turn: 5,
    reconstructed_turn_count: turns.length,
    selected_outcome: aiAdjudication.selected_outcome,
    genuine_false_sound: false,
    frozen_trajectory_oracle_overconstraint: true,
    evaluator_v5_accuracy_for_turn5: "supported",
    production_sound_gate_passed: true,
    turn5_revision_readiness: true,
    turn5_tutor_called: false,
    turn3_anchor_stance_boundary_preserved: repairedTurn3BoundaryPassed,
    human_review_packet_enhanced: true,
    human_review_complete: false,
    human_review_pending: true,
    e2a32_preparation_allowed: e2a32Decision.preparation_allowed,
    e2a32_live_execution_authorized: false,
    candidate_approved: false,
    candidate_activated: false,
    classroom_validity: false,
    source_evidence_unchanged: sourceUnchanged,
    evaluator_modified: false,
    tutor_candidate_modified: false,
    provider_calls_made: 0,
    network_requests_made: 0,
    live_rerun_executed: false,
    completed_at: new Date().toISOString()
  };
  writeJson(paths["summary.json"], summary);
  const payloadValidation = {
    validation_version: "e2a31c-payload-artifact-validation-v1",
    expected_payload_artifact_count: PAYLOAD_ARTIFACT_NAMES.length,
    actual_payload_artifact_count: PAYLOAD_ARTIFACT_NAMES.filter((name) =>
      existsSync(path.join(runDir, name))
    ).length,
    payload_artifact_hashes: PAYLOAD_ARTIFACT_NAMES.map((name) => ({
      name,
      sha256: sha256(readFileSync(path.join(runDir, name)))
    })),
    passed: PAYLOAD_ARTIFACT_NAMES.every((name) =>
      existsSync(path.join(runDir, name)) &&
      statSync(path.join(runDir, name)).size > 0
    )
  };
  writeJson(paths["artifact-validation.json"], payloadValidation);
  const artifactValidation = validateE2A31CArtifacts(runDir);
  const sourceAfterArtifacts = sourceTreeSnapshot();
  if (!artifactValidation.passed ||
      JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfterArtifacts)) {
    throw new Error("e2a31c_artifact_or_source_validation_failed");
  }
  return {
    runId,
    runDir,
    summary,
    turns,
    aiAdjudication,
    oracleDiagnosis,
    humanReviewEnhancement,
    e2a32Decision,
    artifactValidation,
    sourceBefore,
    sourceAfter: sourceAfterArtifacts
  };
}

export function loadE2A31CRun(
  runId: string,
  artifactRoot = E2A31C_ARTIFACT_ROOT
) {
  const runDir = path.join(artifactRoot, runId);
  if (!existsSync(runDir)) throw new Error("e2a31c_run_not_found");
  return {
    runDir,
    summary: readJson<JsonObject>(path.join(runDir, "summary.json")),
    aiAdjudication: readJson<JsonObject>(
      path.join(runDir, "ai-adjudication.json")
    ),
    oracleDiagnosis: readJson<JsonObject>(
      path.join(runDir, "semantic-oracle-diagnosis.json")
    ),
    humanReviewEnhancement: readJson<JsonObject>(
      path.join(runDir, "human-review-packet-enhancement.json")
    ),
    e2a32Decision: readJson<JsonObject>(
      path.join(runDir, "e2a32-preparation-decision.json")
    ),
    artifactValidation: validateE2A31CArtifacts(runDir)
  };
}

export function temporaryE2A31CArtifactRoot() {
  return path.join(os.tmpdir(), `e2a31c-${randomBytes(5).toString("hex")}`);
}

export function removeTemporaryE2A31CArtifactRoot(root: string) {
  rmSync(root, { recursive: true, force: true });
}
