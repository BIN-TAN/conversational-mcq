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
  ANCHOR_CONCLUSION_CONSISTENCY_VERSION,
  SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
  evaluateAnchorConsistentSoundGate,
  type AnchorInterpretation,
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
  TargetEvidenceConsistencyErrorV5,
  TargetEvidenceContractV5Schema,
  assertTargetEvidenceObservationConsistentV6,
  buildTargetEvidenceAdjudicationFromEvaluatorOutputV5,
  mapTargetEvidenceAdjudicationToObservationV6,
  type TargetEvidenceAdjudicationV5,
  type TargetEvidenceContractV5
} from "@/lib/services/student-assessment/target-evidence-contract-v5";
import {
  TargetEvidenceAdjudicationV3Schema,
  TargetEvidenceContractV3Schema,
  mapTargetEvidenceAdjudicationToObservationV3
} from "@/lib/services/student-assessment/target-evidence-contract-v3";

export const E2A33C_VERSION =
  "e2a33c-causal-inference-false-sound-adjudication-v1" as const;
export const E2A33C_STATUS =
  "e2a33c_mapper_evidence_ordering_defect_confirmed" as const;
export const E2A33C_SOURCE_RUN_ID =
  "e2a33b_20260724101300_f5ae71c0" as const;
export const E2A33C_SOURCE_RUN_STATUS =
  "e2a33b_canary_failed_evidence_accuracy" as const;
export const E2A33C_SOURCE_FAILURE_CODE =
  "target_evidence_profile_inconsistent_v5:false_sound" as const;
export const E2A33C_SOURCE_PROTOCOL_HASH =
  "acc8b7453d57f3b2827e45bea860e8d7b24a4e349c6a17fb36f947185cc5b18d" as const;
export const E2A33C_SOURCE_RUNTIME_IDENTITY =
  "99c957224b4d71aa29a4cef4e0a1a02aaa7a938b5ca949dca3b09958a4161d79" as const;
export const E2A33C_SOURCE_TREE_SHA256 =
  "ec134ae3d7333fad30c65c188f1a57de320e7dac7ba9cfabd606a077fe10b348" as const;
export const E2A33C_SOURCE_FILE_COUNT = 90 as const;

export const E2A33C_SOURCE_RUN_DIR = path.join(
  process.cwd(),
  ".data",
  "e2a33b-causal-inference-held-out-canary",
  E2A33C_SOURCE_RUN_ID
);
export const E2A33C_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a33c-causal-inference-false-sound-adjudication"
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
    "20a16736f1e8c0229b7a0279e8228d474542dd6fcd23f6473c8c732b832f96b5",
  "human-review-packet.json":
    "d658a4039700d667e195f54c3b1182dd0a48edbd38cca169dd8f70bb618b7af8",
  "simulator-provider-outputs.jsonl":
    "60d3cddfc167ab083009cf3fb8020be2e315026d21ccd35f5f249439ef8dc6eb",
  "evaluator-provider-outputs.jsonl":
    "17f4d561bb57ce06c5d028b7632753830ecc0366efecfe6ac31e995ef1c831a6",
  "evaluator-normalized-results.jsonl":
    "8264283cab087dfb280d72ab016c8042f1dde8bced68293c456380a5cc331931",
  "canonical-anchor-evidence-results.jsonl":
    "00b50a5e071da6da94854b4a70716d11e9d9dfd1d8f9a6d8b85ff8664be32c76",
  "mapper-results.jsonl":
    "2205728e32f1555c27594b41c2ea5a89c25c22f3a8e5ca915cc5a21f777b6de5",
  "turn-evidence-observations.jsonl":
    "bd01741ba8bd3618f5e98dc857c3c9a7851c040e81ed65d09c47e6ff51e68055",
  "target-evidence-contract.json":
    "b9c0567fba56e53826fa5aabfd1713ed235a875cdbddee6be6dd6cf96a65905b"
} as const;

const PAYLOAD_ARTIFACT_NAMES = [
  "adjudication-manifest.json",
  "source-run-integrity.json",
  "turn-3-reconstruction.json",
  "mapper-decision-trace.json",
  "sound-gate-replay.json",
  "consistency-guard-replay.json",
  "deterministic-regressions.json",
  "root-cause-adjudication.json",
  "human-review-packet-enhancement.json",
  "summary.json"
] as const;

export const E2A33C_ARTIFACT_NAMES = [
  ...PAYLOAD_ARTIFACT_NAMES,
  "artifact-validation.json"
] as const;

type JsonObject = Record<string, unknown>;
type SourceTreeSnapshot = {
  snapshot_version: string;
  root: string;
  file_count: number;
  aggregate_sha256: string;
  files: Array<{ path: string; sha256: string }>;
  critical_artifact_hashes: Record<string, string>;
};
type SimulatorRow = {
  session_id: string;
  turn: number;
  complete_prior_visible_episode: Array<{
    actor_type: "agent" | "student";
    message_text: string;
  }>;
  parsed_structured_output: {
    student_message: string;
    expressed_evidence_level: string;
    rendered_intent: string;
  };
};
type EvaluatorRow = {
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
    throw new Error("e2a33c_forbidden_secret_detected");
  }
}

function writeJson(filePath: string, value: unknown) {
  assertSafeArtifact(value);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => listFiles(path.join(root, entry.name)))
    .sort();
}

function sourceTreeSnapshot(): SourceTreeSnapshot {
  if (!existsSync(E2A33C_SOURCE_RUN_DIR)) {
    throw new Error("e2a33c_source_run_missing");
  }
  const files = listFiles(E2A33C_SOURCE_RUN_DIR).map((filePath) => ({
    path: path.relative(E2A33C_SOURCE_RUN_DIR, filePath),
    sha256: sha256(readFileSync(filePath))
  }));
  const criticalArtifactHashes = Object.fromEntries(
    Object.keys(EXPECTED_SOURCE_ARTIFACT_HASHES).map((name) => [
      name,
      sha256(readFileSync(path.join(E2A33C_SOURCE_RUN_DIR, name)))
    ])
  );
  return {
    snapshot_version: "e2a33c-source-tree-snapshot-v1",
    root: path.relative(process.cwd(), E2A33C_SOURCE_RUN_DIR),
    file_count: files.length,
    aggregate_sha256: sha256(
      files.map((entry) => `${entry.path}:${entry.sha256}`).join("\n")
    ),
    files,
    critical_artifact_hashes: criticalArtifactHashes
  };
}

function sourceSnapshotPassed(snapshot: SourceTreeSnapshot) {
  return snapshot.file_count === E2A33C_SOURCE_FILE_COUNT &&
    snapshot.aggregate_sha256 === E2A33C_SOURCE_TREE_SHA256 &&
    Object.entries(EXPECTED_SOURCE_ARTIFACT_HASHES).every(
      ([name, expected]) =>
        snapshot.critical_artifact_hashes[name] === expected
    );
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
    integrity_version: "e2a33c-protected-source-integrity-v1",
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
    mapper_unchanged: actual[
      "src/lib/services/student-assessment/target-evidence-contract-v5.ts"
    ] === EXPECTED_PROTECTED_SOURCE_HASHES[
      "src/lib/services/student-assessment/target-evidence-contract-v5.ts"
    ],
    sound_gate_unchanged: actual[
      "src/lib/services/student-assessment/anchor-conclusion-consistency.ts"
    ] === EXPECTED_PROTECTED_SOURCE_HASHES[
      "src/lib/services/student-assessment/anchor-conclusion-consistency.ts"
    ],
    passed: mismatches.length === 0
  };
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
  return `e2a33c_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function v3Contract(contract: TargetEvidenceContractV5) {
  const { active_anchor_alias_contract: _aliases, ...rest } = contract;
  void _aliases;
  return TargetEvidenceContractV3Schema.parse({
    ...rest,
    contract_version: "target-evidence-contract-v2"
  });
}

function v3Adjudication(adjudication: TargetEvidenceAdjudicationV5) {
  const {
    structured_turn_evidence: _structured,
    canonical_anchor_evidence: _canonical,
    anchor_alias_resolution: _aliases,
    anchor_parity_reconciliation: _parity,
    anchor_propagation: propagation,
    ...legacy
  } = adjudication;
  void _structured;
  void _canonical;
  void _aliases;
  void _parity;
  return TargetEvidenceAdjudicationV3Schema.parse({
    ...legacy,
    evaluator_version: "production-turn-evidence-evaluator-v3",
    target_evidence_contract_version: "target-evidence-contract-v2",
    anchor_interpretation: propagation.anchor_interpretation
  });
}

function criterionDerivedGateInput(
  contract: TargetEvidenceContractV5,
  adjudication: TargetEvidenceAdjudicationV5
) {
  const resultById = new Map(adjudication.criterion_results.map((entry) => [
    entry.criterion_id,
    entry
  ]));
  const conceptualCriteria = contract.criteria.filter((criterion) =>
    criterion.criterion_kind === "conceptual_relationship"
  );
  const mechanismCriteria = contract.criteria.filter((criterion) =>
    criterion.criterion_kind === "required_mechanism"
  );
  const missing = contract.criteria.filter((criterion) =>
    criterion.essential_for_revision &&
    !resultById.get(criterion.criterion_id)?.satisfied
  ).map((criterion) => criterion.criterion_id);
  const interpretation =
    adjudication.anchor_propagation.anchor_interpretation;
  if (interpretation.anchor_stance !== contract.required_anchor_stance) {
    missing.push("required_anchor_rejection");
  }
  if (interpretation.anchor_consistency !==
      "consistent_with_conceptual_reasoning") {
    missing.push("anchor_conclusion_consistency");
  }
  if (interpretation.anchor_resolution_status !==
      "resolved_against_distractor") {
    missing.push("anchor_resolution_against_distractor");
  }
  return {
    all_essential_conceptual_relationships_satisfied:
      conceptualCriteria.length > 0 &&
      conceptualCriteria.every((criterion) =>
        resultById.get(criterion.criterion_id)?.satisfied === true
      ),
    required_mechanism_demonstrated:
      mechanismCriteria.length > 0 &&
      mechanismCriteria.every((criterion) =>
        resultById.get(criterion.criterion_id)?.satisfied === true
      ),
    coherent_conclusion: adjudication.coherent_conclusion,
    essential_missing_links: unique(missing),
    contradictions: unique(
      adjudication.contradiction_results
        .filter((entry) => entry.present)
        .map((entry) => entry.contradiction_id)
    ),
    interpretation
  };
}

function resolvedInterpretation(): AnchorInterpretation {
  return {
    interpretation_version: ANCHOR_CONCLUSION_CONSISTENCY_VERSION,
    anchor_application: "explicit",
    anchor_stance: "rejects_distractor",
    anchor_consistency: "consistent_with_conceptual_reasoning",
    anchor_resolution_status: "resolved_against_distractor",
    anchor_reference_spans: ["active distractor"],
    anchor_stance_spans: ["rejects active distractor"],
    blocking_limitations: [],
    contradictions: [],
    clarification_required: false
  };
}

function nonAppliedInterpretation(): AnchorInterpretation {
  return {
    interpretation_version: ANCHOR_CONCLUSION_CONSISTENCY_VERSION,
    anchor_application: "absent",
    anchor_stance: "not_expressed",
    anchor_consistency: "not_assessable",
    anchor_resolution_status: "unresolved",
    anchor_reference_spans: [],
    anchor_stance_spans: [],
    blocking_limitations: [],
    contradictions: [],
    clarification_required: false
  };
}

function retainedDistractorInterpretation(): AnchorInterpretation {
  return {
    interpretation_version: ANCHOR_CONCLUSION_CONSISTENCY_VERSION,
    anchor_application: "explicit",
    anchor_stance: "endorses_distractor",
    anchor_consistency: "contradictory_to_conceptual_reasoning",
    anchor_resolution_status: "contradictory",
    anchor_reference_spans: ["active distractor"],
    anchor_stance_spans: ["endorses active distractor"],
    blocking_limitations: [],
    contradictions: [
      "anchor_conclusion_conceptual_explanation_conflict"
    ],
    clarification_required: true
  };
}

type RegressionCase = {
  case_id: string;
  description: string;
  expected_sound: boolean;
  gate_input: Parameters<typeof evaluateAnchorConsistentSoundGate>[0];
};

export function runE2A33CDeterministicRegressions() {
  const cases: RegressionCase[] = [
    {
      case_id: "reject_distractor_missing_causal_design",
      description:
        "Rejects the distractor and explains confounding, but does not provide a design that addresses alternative explanations.",
      expected_sound: false,
      gate_input: {
        all_essential_conceptual_relationships_satisfied: true,
        required_mechanism_demonstrated: true,
        coherent_conclusion: true,
        essential_missing_links: ["credible_causal_design_required"],
        contradictions: [],
        interpretation: resolvedInterpretation()
      }
    },
    {
      case_id: "reject_distractor_complete_causal_explanation",
      description:
        "Explains association limits, a plausible confounder and its effect, a credible causal design, and rejects the distractor.",
      expected_sound: true,
      gate_input: {
        all_essential_conceptual_relationships_satisfied: true,
        required_mechanism_demonstrated: true,
        coherent_conclusion: true,
        essential_missing_links: [],
        contradictions: [],
        interpretation: resolvedInterpretation()
      }
    },
    {
      case_id: "copied_causal_language_without_application",
      description:
        "Repeats causal language without independently applying it to the active distractor.",
      expected_sound: false,
      gate_input: {
        all_essential_conceptual_relationships_satisfied: false,
        required_mechanism_demonstrated: false,
        coherent_conclusion: false,
        essential_missing_links: [
          "independent_causal_application_required"
        ],
        contradictions: [],
        interpretation: nonAppliedInterpretation()
      }
    },
    {
      case_id: "confounder_mention_without_conclusion_change",
      description:
        "Mentions a confounder but retains the direct causal distractor.",
      expected_sound: false,
      gate_input: {
        all_essential_conceptual_relationships_satisfied: true,
        required_mechanism_demonstrated: true,
        coherent_conclusion: false,
        essential_missing_links: [
          "coherent_causal_conclusion_required",
          "distractor_rejection_required"
        ],
        contradictions: [
          "anchor_conclusion_conceptual_explanation_conflict"
        ],
        interpretation: retainedDistractorInterpretation()
      }
    }
  ];
  const results = cases.map((entry) => {
    const gate = evaluateAnchorConsistentSoundGate(entry.gate_input);
    const actualSound = gate.passed;
    return {
      regression_version: "e2a33c-causal-sufficiency-regression-v1",
      ...entry,
      sound_gate_result: gate,
      actual_sound: actualSound,
      passed: actualSound === entry.expected_sound
    };
  });
  return {
    suite_version: "e2a33c-causal-sufficiency-regression-suite-v1",
    sound_criteria: [
      "mechanism_understanding",
      "causal_reasoning_sufficiency",
      "rejection_of_distractor",
      "no_essential_missing_links",
      "coherent_conclusion"
    ],
    criteria_weakened: false,
    case_count: results.length,
    passed_case_count: results.filter((entry) => entry.passed).length,
    cases: results,
    passed: results.every((entry) => entry.passed),
    provider_calls_made: 0
  };
}

function loadSourceEvidence() {
  const summary = readJson<{
    run_id: string;
    status: string;
    failure_reason: string;
    protocol_hash: string;
    frozen_composite_runtime_identity_hash: string;
    candidate_approved: boolean;
    candidate_activated: boolean;
  }>(path.join(E2A33C_SOURCE_RUN_DIR, "canary-summary.json"));
  const humanReview = readJson<{
    packet_version: string;
    item_count: number;
    human_review_required: boolean;
    human_review_complete: boolean;
    ratings_prepopulated: boolean;
  }>(path.join(E2A33C_SOURCE_RUN_DIR, "human-review-packet.json"));
  const contract = TargetEvidenceContractV5Schema.parse(
    readJson(path.join(E2A33C_SOURCE_RUN_DIR, "target-evidence-contract.json"))
  );
  const simulatorRows = readJsonl<SimulatorRow>(
    path.join(E2A33C_SOURCE_RUN_DIR, "simulator-provider-outputs.jsonl")
  );
  const evaluatorRows = readJsonl<EvaluatorRow>(
    path.join(E2A33C_SOURCE_RUN_DIR, "evaluator-normalized-results.jsonl")
  );
  const profileRows = readJsonl<{ turn: number }>(
    path.join(E2A33C_SOURCE_RUN_DIR, "turn-profile-snapshots.jsonl")
  );
  const gateRows = readJsonl<{ turn: number }>(
    path.join(E2A33C_SOURCE_RUN_DIR, "sound-gate-results.jsonl")
  );
  const consistencyRows = readJsonl<{ turn: number }>(
    path.join(E2A33C_SOURCE_RUN_DIR, "profile-consistency-results.jsonl")
  );
  const finalizationRows = readJsonl<{
    turn: number;
    tutor_called: boolean;
  }>(path.join(
    E2A33C_SOURCE_RUN_DIR,
    "pre-tutor-finalization-results.jsonl"
  ));
  const valid = summary.run_id === E2A33C_SOURCE_RUN_ID &&
    summary.status === E2A33C_SOURCE_RUN_STATUS &&
    summary.failure_reason === E2A33C_SOURCE_FAILURE_CODE &&
    summary.protocol_hash === E2A33C_SOURCE_PROTOCOL_HASH &&
    summary.frozen_composite_runtime_identity_hash ===
      E2A33C_SOURCE_RUNTIME_IDENTITY &&
    !summary.candidate_approved && !summary.candidate_activated &&
    humanReview.item_count === 24 &&
    humanReview.human_review_required &&
    !humanReview.human_review_complete &&
    !humanReview.ratings_prepopulated &&
    simulatorRows.length === 3 && evaluatorRows.length === 3 &&
    profileRows.length === 2 && gateRows.length === 2 &&
    consistencyRows.length === 2 && finalizationRows.length === 2 &&
    !profileRows.some((entry) => entry.turn === 3) &&
    !finalizationRows.some((entry) => entry.turn === 3);
  if (!valid) throw new Error("e2a33c_source_contract_mismatch");
  return {
    summary,
    humanReview,
    contract,
    simulatorRows,
    evaluatorRows,
    profileRows,
    gateRows,
    consistencyRows,
    finalizationRows
  };
}

function reconstructTurn3(source: ReturnType<typeof loadSourceEvidence>) {
  let priorAnchorResolution: AnchorResolutionStatus | null = null;
  let turn3Result: {
    simulator: SimulatorRow;
    evaluator: EvaluatorRow;
    adjudication: TargetEvidenceAdjudicationV5;
  } | null = null;
  for (const turn of [1, 2, 3]) {
    const simulator = source.simulatorRows.find((entry) =>
      entry.turn === turn
    );
    const evaluator = source.evaluatorRows.find((entry) =>
      entry.turn === turn
    );
    if (!simulator || !evaluator) {
      throw new Error(`e2a33c_turn_source_missing:turn_${turn}`);
    }
    const latestAgentMessage = [...simulator.complete_prior_visible_episode]
      .reverse().find((entry) => entry.actor_type === "agent")
      ?.message_text ?? null;
    const adjudication = buildTargetEvidenceAdjudicationFromEvaluatorOutputV5({
      latest_student_message:
        simulator.parsed_structured_output.student_message,
      packet: ActivityMisconceptionEvidencePacketV1Schema.parse(
        evaluator.effective_evidence_packet
      ),
      structured_turn_evidence:
        ProductionTurnEvidenceStructuredFieldsV5Schema.parse(
          evaluator.structured_turn_evidence
        ),
      contract: source.contract,
      expected_source_student_turn_id: evaluator.source_student_turn_id,
      expected_source_sequence_index: evaluator.source_sequence_index,
      prior_visible_message: latestAgentMessage,
      prior_anchor_resolution_status: priorAnchorResolution
    });
    priorAnchorResolution =
      adjudication.anchor_propagation.anchor_resolution_status;
    if (turn === 3) turn3Result = { simulator, evaluator, adjudication };
  }
  if (!turn3Result) throw new Error("e2a33c_turn3_reconstruction_missing");
  return turn3Result;
}

function buildDecisionTrace(
  source: ReturnType<typeof loadSourceEvidence>,
  reconstructed: ReturnType<typeof reconstructTurn3>
) {
  const { simulator, evaluator, adjudication } = reconstructed;
  const contract = source.contract;
  const legacyObservation = mapTargetEvidenceAdjudicationToObservationV3({
    contract: v3Contract(contract),
    adjudication: v3Adjudication(adjudication),
    interaction_intent: "ordinary_conceptual_response",
    confidence_evidence:
      adjudication.structured_turn_evidence.confidence_evidence
  });
  const v6Observation = mapTargetEvidenceAdjudicationToObservationV6({
    contract,
    adjudication,
    interaction_intent: "ordinary_conceptual_response",
    confidence_evidence:
      adjudication.structured_turn_evidence.confidence_evidence
  });
  const legacyGateInput = criterionDerivedGateInput(contract, adjudication);
  const legacyGate = evaluateAnchorConsistentSoundGate(legacyGateInput);
  const evidenceCompleteGateInput = {
    ...legacyGateInput,
    essential_missing_links: unique([
      ...legacyGateInput.essential_missing_links,
      ...adjudication.structured_turn_evidence.essential_missing_links
    ])
  };
  const evidenceCompleteGate = evaluateAnchorConsistentSoundGate(
    evidenceCompleteGateInput
  );
  let consistencyDecision: {
    passed: boolean;
    error_name: string | null;
    issue_codes: string[];
  };
  try {
    assertTargetEvidenceObservationConsistentV6({
      contract,
      adjudication,
      observation: v6Observation
    });
    consistencyDecision = {
      passed: true,
      error_name: null,
      issue_codes: []
    };
  } catch (error) {
    if (!(error instanceof TargetEvidenceConsistencyErrorV5)) throw error;
    consistencyDecision = {
      passed: false,
      error_name: error.name,
      issue_codes: error.issue_codes
    };
  }
  const satisfiedCriteria = adjudication.criterion_results
    .filter((entry) => entry.satisfied)
    .map((entry) => entry.criterion_id);
  const unsatisfiedCriteria = adjudication.criterion_results
    .filter((entry) => !entry.satisfied)
    .map((entry) => entry.criterion_id);
  const structured = adjudication.structured_turn_evidence;
  const packet = ActivityMisconceptionEvidencePacketV1Schema.parse(
    evaluator.effective_evidence_packet
  );
  return {
    reconstruction: {
      reconstruction_version: "e2a33c-turn3-reconstruction-v1",
      source_run_id: E2A33C_SOURCE_RUN_ID,
      session_id: evaluator.session_id,
      turn: 3,
      source_student_turn_id: evaluator.source_student_turn_id,
      source_sequence_index: evaluator.source_sequence_index,
      exact_student_response:
        simulator.parsed_structured_output.student_message,
      simulator_self_report: {
        expressed_evidence_level:
          simulator.parsed_structured_output.expressed_evidence_level,
        rendered_intent:
          simulator.parsed_structured_output.rendered_intent
      },
      evaluator_v5_output: {
        evaluator_version: evaluator.evaluator_version,
        provider_output_accepted: evaluator.provider_output_accepted,
        normalized_output_passed: evaluator.passed,
        structured_turn_evidence: structured,
        effective_evidence_packet: packet
      },
      essential_missing_links: structured.essential_missing_links,
      mechanism_evidence: {
        conceptual_mechanism: structured.conceptual_mechanism,
        exact_conceptual_evidence_spans:
          structured.exact_conceptual_evidence_spans,
        packet_hidden_assumption:
          packet.evidence_elicited.student_identified_hidden_assumption,
        packet_target_boundary:
          packet.evidence_elicited.student_explained_target_boundary,
        packet_reasoning_link:
          packet.evidence_elicited.student_repaired_reasoning_link,
        packet_independent_reconstruction:
          packet.evidence_elicited.student_reconstructed_concept_independently
      },
      canonical_anchor_evidence:
        adjudication.canonical_anchor_evidence,
      anchor_stance: {
        canonical_application:
          adjudication.canonical_anchor_evidence.application,
        canonical_stance: adjudication.canonical_anchor_evidence.stance,
        propagated_application:
          adjudication.anchor_propagation.anchor_application,
        propagated_stance: adjudication.anchor_propagation.anchor_stance,
        propagated_consistency:
          adjudication.anchor_propagation.anchor_consistency,
        propagated_resolution:
          adjudication.anchor_propagation.anchor_resolution_status,
        parity_passed:
          adjudication.anchor_parity_reconciliation.passed
      }
    },
    mapperTrace: {
      trace_version: "e2a33c-mapper-decision-trace-v1",
      source_mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6,
      mapper_input: {
        evaluator_packet_status:
          packet.misconception_evidence_update.status,
        evaluator_packet_evidence_quality:
          packet.misconception_evidence_update.evidence_quality,
        criterion_results: adjudication.criterion_results,
        satisfied_criterion_ids: satisfiedCriteria,
        unsatisfied_criterion_ids: unsatisfiedCriteria,
        evaluator_structured_essential_missing_links:
          structured.essential_missing_links,
        coherent_conclusion: adjudication.coherent_conclusion,
        anchor_propagation: adjudication.anchor_propagation
      },
      profile_before_sound_gate: {
        relationship_flag_from_coarse_packet:
          legacyGateInput.all_essential_conceptual_relationships_satisfied,
        mechanism_flag_from_coarse_packet:
          legacyGateInput.required_mechanism_demonstrated,
        coherent_conclusion_from_coarse_packet:
          legacyGateInput.coherent_conclusion,
        criterion_derived_missing_links:
          legacyGateInput.essential_missing_links,
        evaluator_structured_missing_links_not_yet_merged:
          structured.essential_missing_links
      },
      legacy_v3_sound_gate_input: legacyGateInput,
      legacy_v3_sound_gate_decision: legacyGate,
      legacy_v3_mapper_output_before_structured_merge: legacyObservation,
      v6_mapper_output_after_structured_merge: v6Observation,
      ordering_defect: {
        detected: legacyGate.passed &&
          legacyObservation.reasoning_quality === "sound" &&
          structured.essential_missing_links.length > 0 &&
          v6Observation.reasoning_quality === "sound" &&
          v6Observation.essential_missing_links.length > 0,
        code:
          "structured_missing_links_merged_after_sound_classification",
        coarse_projection_code:
          "criterion_kind_truth_reused_across_required_mechanism_criteria",
        impact:
          "causal_design_requirement_was_not_available_to_the_sound_decision"
      }
    },
    soundGateReplay: {
      replay_version: "e2a33c-sound-gate-replay-v1",
      unchanged_sound_gate_version:
        SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
      legacy_mapper_input: legacyGateInput,
      legacy_mapper_decision: legacyGate,
      evidence_complete_input: evidenceCompleteGateInput,
      evidence_complete_decision: evidenceCompleteGate,
      evidence_complete_reasoning_quality:
        evidenceCompleteGate.passed ? "sound" : "partial",
      criteria_weakened: false,
      expected_correction:
        "include_evaluator_structured_missing_links_before_sound_decision"
    },
    consistencyReplay: {
      replay_version: "e2a33c-consistency-guard-replay-v1",
      policy_version: PROFILE_CONSISTENCY_POLICY_VERSION_V6,
      observation_received: v6Observation,
      decision: consistencyDecision,
      turn3_profile_persisted:
        source.profileRows.some((entry) => entry.turn === 3),
      turn3_sound_gate_artifact_persisted:
        source.gateRows.some((entry) => entry.turn === 3),
      turn3_consistency_artifact_persisted:
        source.consistencyRows.some((entry) => entry.turn === 3),
      turn3_pre_tutor_finalization_persisted:
        source.finalizationRows.some((entry) => entry.turn === 3),
      turn3_tutor_dispatched:
        source.finalizationRows.some((entry) =>
          entry.turn === 3 && entry.tutor_called
        ),
      fail_closed_before_profile_finalization: !consistencyDecision.passed &&
        !source.profileRows.some((entry) => entry.turn === 3) &&
        !source.finalizationRows.some((entry) => entry.turn === 3)
    }
  };
}

function buildRootCauseAdjudication(
  trace: ReturnType<typeof buildDecisionTrace>,
  regressions: ReturnType<typeof runE2A33CDeterministicRegressions>
) {
  return {
    adjudication_version: "e2a33c-root-cause-adjudication-v1",
    review_source: "ai_agent_no_live_immutable_evidence_review",
    source_run_id: E2A33C_SOURCE_RUN_ID,
    source_run_remains_historical_failure: true,
    adjudicated_turn: 3,
    root_cause_options: [
      {
        code: "A",
        label: "evaluator_v5_defect",
        selected: false,
        reason:
          "Evaluator V5 classified the evidence as partial and retained two causal-design missing links."
      },
      {
        code: "B",
        label: "mapper_dropped_evidence",
        selected: true,
        reason:
          "The mapper derived a sound decision from coarse criterion-kind flags before merging Evaluator V5 essential missing links."
      },
      {
        code: "C",
        label: "sound_gate_missing_criteria",
        selected: false,
        reason:
          "The unchanged sound gate already rejects any non-empty essential-missing-link list."
      },
      {
        code: "D",
        label: "trajectory_envelope_override",
        selected: false,
        reason:
          "Turn 3 allowed partial or sound, and no trajectory value altered the evaluator or mapper result."
      },
      {
        code: "E",
        label: "other",
        selected: false,
        reason:
          "No additional cause is needed to explain the observed projection."
      }
    ],
    selected_root_cause: {
      code: "B",
      label: "mapper_dropped_evidence",
      precise_failure:
        "structured_missing_links_excluded_from_sound_decision_then_appended_to_sound_observation",
      confidence: "high"
    },
    evaluator_v5_assessment: {
      implicated: false,
      evidence_quality:
        trace.reconstruction.evaluator_v5_output
          .effective_evidence_packet.misconception_evidence_update
          .evidence_quality,
      independent_reconstruction:
        trace.reconstruction.mechanism_evidence
          .packet_independent_reconstruction,
      reasoning_link:
        trace.reconstruction.mechanism_evidence.packet_reasoning_link,
      essential_missing_links:
        trace.reconstruction.essential_missing_links
    },
    sound_gate_assessment: {
      implicated: false,
      version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
      legacy_incomplete_input_passed:
        trace.soundGateReplay.legacy_mapper_decision.passed,
      evidence_complete_input_passed:
        trace.soundGateReplay.evidence_complete_decision.passed,
      evidence_complete_failure_codes:
        trace.soundGateReplay.evidence_complete_decision.failure_codes,
      criteria_weakened: false
    },
    consistency_guard_assessment: {
      implicated: false,
      result: "correctly_failed_closed",
      issue_codes: trace.consistencyReplay.decision.issue_codes,
      tutor_dispatch_blocked:
        !trace.consistencyReplay.turn3_tutor_dispatched
    },
    required_sound_criteria_preserved: [
      "mechanism_understanding",
      "causal_reasoning_sufficiency",
      "rejection_of_distractor",
      "no_essential_missing_links",
      "coherent_conclusion"
    ],
    regression_suite_passed: regressions.passed,
    historical_e2a33b_reclassified_as_passed: false,
    evaluator_v5_modified: false,
    tutor_candidate_modified: false,
    provider_calls_made: 0
  };
}

function buildHumanReviewEnhancement(
  source: ReturnType<typeof loadSourceEvidence>,
  trace: ReturnType<typeof buildDecisionTrace>,
  adjudication: ReturnType<typeof buildRootCauseAdjudication>
) {
  return {
    enhancement_version: "e2a33c-human-review-packet-enhancement-v1",
    source_run_id: E2A33C_SOURCE_RUN_ID,
    source_packet_binding: {
      packet_version: source.humanReview.packet_version,
      sha256:
        EXPECTED_SOURCE_ARTIFACT_HASHES["human-review-packet.json"],
      item_count: source.humanReview.item_count,
      source_packet_mutated: false
    },
    review_focus: "turn_3_false_sound_boundary",
    exact_student_response:
      trace.reconstruction.exact_student_response,
    evaluator_summary: {
      evaluator_version:
        trace.reconstruction.evaluator_v5_output.evaluator_version,
      evidence_update_status:
        trace.reconstruction.evaluator_v5_output
          .effective_evidence_packet.misconception_evidence_update.status,
      evidence_quality:
        trace.reconstruction.evaluator_v5_output
          .effective_evidence_packet.misconception_evidence_update
          .evidence_quality,
      essential_missing_links:
        trace.reconstruction.essential_missing_links,
      mechanism_evidence:
        trace.reconstruction.mechanism_evidence
    },
    anchor_summary: trace.reconstruction.anchor_stance,
    mapper_summary: {
      input: trace.mapperTrace.mapper_input,
      legacy_output:
        trace.mapperTrace.legacy_v3_mapper_output_before_structured_merge,
      v6_output:
        trace.mapperTrace.v6_mapper_output_after_structured_merge,
      ordering_defect: trace.mapperTrace.ordering_defect
    },
    sound_gate_summary: trace.soundGateReplay,
    consistency_guard_summary: trace.consistencyReplay,
    ai_adjudication: {
      selected_root_cause: adjudication.selected_root_cause,
      evaluator_v5_assessment: adjudication.evaluator_v5_assessment,
      sound_gate_assessment: adjudication.sound_gate_assessment,
      consistency_guard_assessment:
        adjudication.consistency_guard_assessment
    },
    human_review_questions: [
      "Does Turn 3 explain how motivation could affect both app use and exam scores?",
      "Does Turn 3 explain why comparing existing users with nonusers may remain confounded?",
      "Does Turn 3 name a design that addresses alternative explanations?",
      "Should the evaluator's two essential missing links block sound classification?",
      "Does the consistency guard correctly prevent tutor dispatch after the internally inconsistent projection?"
    ],
    human_review_required: true,
    human_review_complete: false,
    human_reviewer: null,
    human_rating: null,
    human_notes: null,
    classroom_validity: false,
    provider_calls_made: 0
  };
}

function pathsFor(runDir: string) {
  return Object.fromEntries(E2A33C_ARTIFACT_NAMES.map((name) => [
    name,
    path.join(runDir, name)
  ])) as Record<typeof E2A33C_ARTIFACT_NAMES[number], string>;
}

export function validateE2A33CArtifacts(runDir: string) {
  const failures: string[] = [];
  const expected = [...E2A33C_ARTIFACT_NAMES].sort();
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
      const parsed = readJson(filePath);
      assertSafeArtifact(parsed);
    } catch {
      failures.push(`artifact_malformed_or_unsafe:${name}`);
    }
  }
  return {
    validation_version: "e2a33c-artifact-validation-v1",
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

export async function executeE2A33C(
  input: { artifactRoot?: string } = {}
) {
  const sourceBefore = sourceTreeSnapshot();
  const protectedBefore = protectedSourceIntegrity();
  if (!sourceSnapshotPassed(sourceBefore)) {
    throw new Error("e2a33c_source_integrity_precheck_failed");
  }
  if (!protectedBefore.passed) {
    throw new Error("e2a33c_protected_source_precheck_failed");
  }
  const source = loadSourceEvidence();
  const reconstructed = reconstructTurn3(source);
  const trace = buildDecisionTrace(source, reconstructed);
  const regressions = runE2A33CDeterministicRegressions();
  if (!regressions.passed ||
      !trace.mapperTrace.ordering_defect.detected ||
      trace.soundGateReplay.evidence_complete_decision.passed ||
      trace.consistencyReplay.decision.passed ||
      !trace.consistencyReplay.decision.issue_codes.includes("false_sound") ||
      !trace.consistencyReplay.fail_closed_before_profile_finalization) {
    throw new Error("e2a33c_decisive_replay_failed");
  }
  const rootCause = buildRootCauseAdjudication(trace, regressions);
  const humanReview = buildHumanReviewEnhancement(
    source,
    trace,
    rootCause
  );
  const sourceAfterReplay = sourceTreeSnapshot();
  const protectedAfter = protectedSourceIntegrity();
  const sourceUnchanged = JSON.stringify(sourceBefore) ===
    JSON.stringify(sourceAfterReplay);
  const protectedUnchanged = JSON.stringify(protectedBefore.actual_sha256) ===
    JSON.stringify(protectedAfter.actual_sha256);
  if (!sourceUnchanged || !protectedUnchanged) {
    throw new Error("e2a33c_source_mutation_detected");
  }

  const artifactRoot = input.artifactRoot ?? E2A33C_ARTIFACT_ROOT;
  const runId = makeRunId();
  const runDir = path.join(artifactRoot, runId);
  mkdirSync(artifactRoot, { recursive: true });
  mkdirSync(runDir, { recursive: false });
  const paths = pathsFor(runDir);
  writeJson(paths["adjudication-manifest.json"], {
    manifest_version: E2A33C_VERSION,
    run_id: runId,
    application_git_commit: currentCommit(),
    source_run_id: E2A33C_SOURCE_RUN_ID,
    source_run_status: E2A33C_SOURCE_RUN_STATUS,
    source_failure_code: E2A33C_SOURCE_FAILURE_CODE,
    source_protocol_hash: E2A33C_SOURCE_PROTOCOL_HASH,
    source_runtime_identity: E2A33C_SOURCE_RUNTIME_IDENTITY,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    target_contract_version: TARGET_EVIDENCE_CONTRACT_VERSION_V5,
    mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6,
    sound_gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
    source_evidence_mutation_allowed: false,
    evaluator_modified: false,
    tutor_candidate_modified: false,
    runtime_mapper_modified: false,
    provider_calls_made: 0,
    live_rerun_executed: false,
    e2a34_executed: false
  });
  writeJson(paths["source-run-integrity.json"], {
    integrity_version: "e2a33c-source-run-integrity-v1",
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
  writeJson(paths["turn-3-reconstruction.json"], trace.reconstruction);
  writeJson(paths["mapper-decision-trace.json"], trace.mapperTrace);
  writeJson(paths["sound-gate-replay.json"], trace.soundGateReplay);
  writeJson(paths["consistency-guard-replay.json"], trace.consistencyReplay);
  writeJson(paths["deterministic-regressions.json"], regressions);
  writeJson(paths["root-cause-adjudication.json"], rootCause);
  writeJson(
    paths["human-review-packet-enhancement.json"],
    humanReview
  );
  const summary = {
    summary_version: "e2a33c-false-sound-adjudication-summary-v1",
    status: E2A33C_STATUS,
    run_id: runId,
    run_directory: path.relative(process.cwd(), runDir),
    source_run_id: E2A33C_SOURCE_RUN_ID,
    source_run_status: E2A33C_SOURCE_RUN_STATUS,
    source_failure_code: E2A33C_SOURCE_FAILURE_CODE,
    source_run_reclassified_as_passed: false,
    adjudicated_turn: 3,
    selected_root_cause: rootCause.selected_root_cause,
    evaluator_v5_defect: false,
    mapper_dropped_evidence: true,
    sound_gate_missing_criteria: false,
    trajectory_envelope_override: false,
    consistency_guard_correctly_failed_closed: true,
    legacy_incomplete_gate_passed:
      trace.soundGateReplay.legacy_mapper_decision.passed,
    evidence_complete_gate_passed:
      trace.soundGateReplay.evidence_complete_decision.passed,
    deterministic_regression_count: regressions.case_count,
    deterministic_regressions_passed: regressions.passed,
    sound_criteria_weakened: false,
    human_review_packet_enhanced: true,
    human_review_complete: false,
    human_review_pending: true,
    classroom_validity: false,
    source_evidence_unchanged: sourceUnchanged,
    evaluator_v5_modified: false,
    tutor_candidate_modified: false,
    runtime_mapper_modified: false,
    e2a33b_rerun: false,
    e2a34_executed: false,
    provider_calls_made: 0,
    network_requests_made: 0,
    completed_at: new Date().toISOString()
  };
  writeJson(paths["summary.json"], summary);
  writeJson(paths["artifact-validation.json"], {
    validation_version: "e2a33c-payload-artifact-validation-v1",
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
  });
  const artifactValidation = validateE2A33CArtifacts(runDir);
  const sourceAfterArtifacts = sourceTreeSnapshot();
  if (!artifactValidation.passed ||
      JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfterArtifacts)) {
    throw new Error("e2a33c_artifact_or_source_validation_failed");
  }
  return {
    runId,
    runDir,
    summary,
    trace,
    regressions,
    rootCause,
    humanReview,
    artifactValidation,
    sourceBefore,
    sourceAfter: sourceAfterArtifacts
  };
}

export function loadE2A33CRun(
  runId: string,
  artifactRoot = E2A33C_ARTIFACT_ROOT
) {
  const runDir = path.join(artifactRoot, runId);
  if (!existsSync(runDir)) throw new Error("e2a33c_run_not_found");
  return {
    runDir,
    summary: readJson<JsonObject>(path.join(runDir, "summary.json")),
    rootCause: readJson<JsonObject>(
      path.join(runDir, "root-cause-adjudication.json")
    ),
    humanReview: readJson<JsonObject>(
      path.join(runDir, "human-review-packet-enhancement.json")
    ),
    artifactValidation: validateE2A33CArtifacts(runDir)
  };
}

export function temporaryE2A33CArtifactRoot() {
  return path.join(os.tmpdir(), `e2a33c-${randomBytes(5).toString("hex")}`);
}

export function removeTemporaryE2A33CArtifactRoot(root: string) {
  rmSync(root, { recursive: true, force: true });
}
