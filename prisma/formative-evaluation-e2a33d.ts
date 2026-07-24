import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
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
  PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V4,
  finalizeEvidenceFirstTurnBeforeTutorV4
} from "@/lib/services/student-assessment/pre-tutor-profile-finalization-v4";
import {
  TARGET_EVIDENCE_CONTRACT_VERSION_V5,
  TargetEvidenceAdjudicationV5Schema,
  TargetEvidenceContractV5Schema,
  buildTargetEvidenceAdjudicationFromEvaluatorOutputV5,
  type TargetEvidenceAdjudicationV5,
  type TargetEvidenceContractV5
} from "@/lib/services/student-assessment/target-evidence-contract-v5";
import type {
  TopicDialogueCumulativeEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  PROFILE_CONSISTENCY_POLICY_VERSION_V7,
  TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
  assertTargetEvidenceObservationConsistentV7,
  buildEvidencePreservingSoundGateInputV7,
  mapTargetEvidenceAdjudicationToObservationV7
} from "@/lib/services/student-assessment/target-evidence-mapper-v7";

const VERSION = "e2a33d-evidence-preserving-mapper-correction-v1";
const SOURCE_RUN_ID = "e2a33b_20260724101300_f5ae71c0";
const SOURCE_STATUS = "e2a33b_canary_failed_evidence_accuracy";
const SOURCE_TREE_SHA256 =
  "ec134ae3d7333fad30c65c188f1a57de320e7dac7ba9cfabd606a077fe10b348";
const SOURCE_FILE_COUNT = 90;
const SOURCE_RUN_DIR = path.join(
  process.cwd(),
  ".data",
  "e2a33b-causal-inference-held-out-canary",
  SOURCE_RUN_ID
);
const ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a33d-evidence-preserving-mapper-correction"
);

const EXPECTED_SOURCE_HASHES = {
  "canary-summary.json":
    "20a16736f1e8c0229b7a0279e8228d474542dd6fcd23f6473c8c732b832f96b5",
  "human-review-packet.json":
    "d658a4039700d667e195f54c3b1182dd0a48edbd38cca169dd8f70bb618b7af8",
  "simulator-provider-outputs.jsonl":
    "60d3cddfc167ab083009cf3fb8020be2e315026d21ccd35f5f249439ef8dc6eb",
  "evaluator-normalized-results.jsonl":
    "8264283cab087dfb280d72ab016c8042f1dde8bced68293c456380a5cc331931",
  "target-evidence-contract.json":
    "b9c0567fba56e53826fa5aabfd1713ed235a875cdbddee6be6dd6cf96a65905b"
} as const;

const EXPECTED_PROTECTED_HASHES = {
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

const PAYLOAD_NAMES = [
  "correction-manifest.json",
  "source-integrity.json",
  "evidence-preservation-contract.json",
  "e2a33b-turn3-offline-replay.json",
  "deterministic-mapper-regressions.json",
  "production-wiring-verification.json",
  "e2a34-protocol-preparation.json",
  "human-review-packet-enhancement.json",
  "summary.json"
] as const;
const ARTIFACT_NAMES = [...PAYLOAD_NAMES, "artifact-validation.json"] as const;

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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonl<T>(filePath: string): T[] {
  const value = readFileSync(filePath, "utf8").trim();
  return value
    ? value.split(/\r?\n/u).map((line) => JSON.parse(line) as T)
    : [];
}

function assertSafe(value: unknown) {
  const text = JSON.stringify(value);
  const forbidden = [
    /\bBearer\s+[A-Za-z0-9._-]+/u,
    /\bsk-[A-Za-z0-9_-]{12,}/u,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u,
    /authorization\s*:\s*["']?bearer/iu
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error("e2a33d_forbidden_secret_detected");
  }
}

function writeJson(filePath: string, value: unknown) {
  assertSafe(value);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function listFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(filePath) : [filePath];
  }).sort();
}

function sourceSnapshot() {
  assert(existsSync(SOURCE_RUN_DIR), "e2a33d_source_run_missing");
  const files = listFiles(SOURCE_RUN_DIR).map((filePath) => ({
    path: path.relative(SOURCE_RUN_DIR, filePath),
    sha256: sha256(readFileSync(filePath))
  }));
  const critical = Object.fromEntries(
    Object.keys(EXPECTED_SOURCE_HASHES).map((name) => [
      name,
      sha256(readFileSync(path.join(SOURCE_RUN_DIR, name)))
    ])
  );
  return {
    snapshot_version: "e2a33d-source-snapshot-v1",
    file_count: files.length,
    aggregate_sha256: sha256(
      files.map((entry) => `${entry.path}:${entry.sha256}`).join("\n")
    ),
    critical_artifact_hashes: critical,
    files
  };
}

function sourceSnapshotPassed(snapshot: ReturnType<typeof sourceSnapshot>) {
  return snapshot.file_count === SOURCE_FILE_COUNT &&
    snapshot.aggregate_sha256 === SOURCE_TREE_SHA256 &&
    Object.entries(EXPECTED_SOURCE_HASHES).every(([name, expected]) =>
      snapshot.critical_artifact_hashes[name] === expected
    );
}

function protectedIntegrity() {
  const actual = Object.fromEntries(
    Object.keys(EXPECTED_PROTECTED_HASHES).map((relativePath) => [
      relativePath,
      sha256(readFileSync(path.join(process.cwd(), relativePath)))
    ])
  );
  const mismatches = Object.entries(EXPECTED_PROTECTED_HASHES)
    .filter(([relativePath, expected]) => actual[relativePath] !== expected)
    .map(([relativePath, expected]) => ({
      relative_path: relativePath,
      expected_sha256: expected,
      actual_sha256: actual[relativePath]
    }));
  return {
    integrity_version: "e2a33d-protected-source-integrity-v1",
    expected_sha256: EXPECTED_PROTECTED_HASHES,
    actual_sha256: actual,
    mismatches,
    evaluator_v5_unchanged: actual[
      "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
    ] === EXPECTED_PROTECTED_HASHES[
      "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
    ],
    tutor_candidate_unchanged: actual[
      "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
    ] === EXPECTED_PROTECTED_HASHES[
      "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
    ],
    evaluator_v5_contract_unchanged: actual[
      "src/lib/services/student-assessment/target-evidence-contract-v5.ts"
    ] === EXPECTED_PROTECTED_HASHES[
      "src/lib/services/student-assessment/target-evidence-contract-v5.ts"
    ],
    sound_gate_unchanged: actual[
      "src/lib/services/student-assessment/anchor-conclusion-consistency.ts"
    ] === EXPECTED_PROTECTED_HASHES[
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
  return `e2a33d_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function loadSource() {
  const summary = readJson<{
    run_id: string;
    status: string;
    failure_reason: string;
  }>(path.join(SOURCE_RUN_DIR, "canary-summary.json"));
  const contract = TargetEvidenceContractV5Schema.parse(
    readJson(path.join(SOURCE_RUN_DIR, "target-evidence-contract.json"))
  );
  return {
    summary,
    contract,
    simulatorRows: readJsonl<SimulatorRow>(
      path.join(SOURCE_RUN_DIR, "simulator-provider-outputs.jsonl")
    ),
    evaluatorRows: readJsonl<EvaluatorRow>(
      path.join(SOURCE_RUN_DIR, "evaluator-normalized-results.jsonl")
    )
  };
}

function reconstructTurns(source: ReturnType<typeof loadSource>) {
  let priorAnchorResolution: AnchorResolutionStatus | null = null;
  return [1, 2, 3].map((turn) => {
    const simulator = source.simulatorRows.find((entry) =>
      entry.turn === turn
    );
    const evaluator = source.evaluatorRows.find((entry) =>
      entry.turn === turn
    );
    assert(simulator && evaluator, `e2a33d_turn_${turn}_source_missing`);
    const priorAgentMessage = [...simulator.complete_prior_visible_episode]
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
      prior_visible_message: priorAgentMessage,
      prior_anchor_resolution_status: priorAnchorResolution
    });
    priorAnchorResolution =
      adjudication.anchor_propagation.anchor_resolution_status;
    return { turn, simulator, evaluator, adjudication };
  });
}

function mappedCase(input: {
  case_id: string;
  description: string;
  contract: TargetEvidenceContractV5;
  adjudication: TargetEvidenceAdjudicationV5;
  expected_sound: boolean;
}) {
  const observation = mapTargetEvidenceAdjudicationToObservationV7({
    contract: input.contract,
    adjudication: input.adjudication,
    interaction_intent: "ordinary_conceptual_response",
    confidence_evidence:
      input.adjudication.structured_turn_evidence.confidence_evidence
  });
  const consistency = assertTargetEvidenceObservationConsistentV7({
    contract: input.contract,
    adjudication: input.adjudication,
    observation
  });
  const gateInput = buildEvidencePreservingSoundGateInputV7({
    contract: input.contract,
    adjudication: input.adjudication
  });
  const gate = evaluateAnchorConsistentSoundGate(gateInput);
  const actualSound = observation.reasoning_quality === "sound";
  return {
    case_id: input.case_id,
    description: input.description,
    expected_sound: input.expected_sound,
    actual_sound: actualSound,
    reasoning_quality: observation.reasoning_quality,
    essential_missing_links: observation.essential_missing_links,
    gate_input_essential_missing_links: gateInput.essential_missing_links,
    sound_gate_result: gate,
    preservation_audit: consistency.evidence_preservation,
    passed: actualSound === input.expected_sound &&
      actualSound === gate.passed &&
      consistency.evidence_preservation.passed &&
      (!actualSound || observation.essential_missing_links.length === 0)
  };
}

function completeCausalDesignAdjudication(
  source: TargetEvidenceAdjudicationV5
) {
  return TargetEvidenceAdjudicationV5Schema.parse({
    ...source,
    limitations: [
      "Synthetic no-live mapper fixture; no broader causal claim is assessed."
    ],
    structured_turn_evidence: {
      ...source.structured_turn_evidence,
      conceptual_mechanism:
        "Motivation can affect both app use and scores; random assignment can balance preexisting differences and support a causal comparison.",
      exact_conceptual_evidence_spans: [
        ...source.structured_turn_evidence.exact_conceptual_evidence_spans,
        {
          label: "conceptual_mechanism",
          span: "random assignment can balance preexisting differences"
        }
      ],
      essential_missing_links: [],
      evidence_limitations: [
        "Synthetic no-live mapper fixture; no broader causal claim is assessed."
      ]
    }
  });
}

function runRegressions(input: {
  contract: TargetEvidenceContractV5;
  turns: ReturnType<typeof reconstructTurns>;
}) {
  const turn2 = input.turns.find((entry) => entry.turn === 2);
  const turn3 = input.turns.find((entry) => entry.turn === 3);
  assert(turn2 && turn3, "e2a33d_regression_turns_missing");
  const sourceMissingLinks =
    turn3.adjudication.structured_turn_evidence.essential_missing_links;
  const cases = [
    mappedCase({
      case_id: "A_confounder_rejected_no_causal_design",
      description:
        "A confounder is applied and the distractor is rejected, but Evaluator V5 retains the missing causal-design links.",
      contract: input.contract,
      adjudication: turn3.adjudication,
      expected_sound: false
    }),
    mappedCase({
      case_id: "B_confounder_valid_design_rejected",
      description:
        "A validated evaluator result includes confounding, a valid causal design, and explicit distractor rejection with no essential missing links.",
      contract: input.contract,
      adjudication: completeCausalDesignAdjudication(turn3.adjudication),
      expected_sound: true
    }),
    mappedCase({
      case_id: "C_copied_language_without_independent_application",
      description:
        "The student repeats the prompted confounder language without independently applying it to the active distractor or causal design.",
      contract: input.contract,
      adjudication: turn2.adjudication,
      expected_sound: false
    })
  ];
  const caseD = cases[0];
  const missingLinksSurvive = sourceMissingLinks.every((link) =>
    caseD.essential_missing_links.includes(link) &&
    caseD.gate_input_essential_missing_links.includes(link) &&
    caseD.preservation_audit.mapped_missing_links.includes(link)
  );
  const preservationCase = {
    case_id: "D_missing_links_survive_mapper_transformation",
    description:
      "Every Evaluator V5 essential missing link reaches both the mapped observation and the sound-gate input.",
    source_essential_missing_links: sourceMissingLinks,
    mapped_essential_missing_links: caseD.essential_missing_links,
    sound_gate_input_essential_missing_links:
      caseD.gate_input_essential_missing_links,
    preservation_contract_version:
      caseD.preservation_audit.preservation_version,
    passed: missingLinksSurvive &&
      caseD.preservation_audit
        .sound_gate_received_all_evaluator_missing_links &&
      caseD.preservation_audit.sound_requires_no_essential_missing_links
  };
  return {
    suite_version: "e2a33d-evidence-preserving-mapper-regressions-v1",
    mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
    preservation_contract_version:
      TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION,
    sound_gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
    cases: [...cases, preservationCase],
    case_count: cases.length + 1,
    passed_case_count: cases.filter((entry) => entry.passed).length +
      (preservationCase.passed ? 1 : 0),
    sound_criteria_weakened: false,
    evaluator_v5_modified: false,
    passed: cases.every((entry) => entry.passed) &&
      preservationCase.passed,
    provider_calls_made: 0
  };
}

function replayTurn3(input: {
  contract: TargetEvidenceContractV5;
  turns: ReturnType<typeof reconstructTurns>;
}) {
  let cumulative: TopicDialogueCumulativeEvidenceProfile | null = null;
  const finalizations = input.turns.map((entry) => {
    const finalized = finalizeEvidenceFirstTurnBeforeTutorV4({
      contract: input.contract,
      adjudication: entry.adjudication,
      latest_student_message:
        entry.simulator.parsed_structured_output.student_message,
      interaction_intent: "ordinary_conceptual_response",
      confidence_evidence:
        entry.adjudication.structured_turn_evidence.confidence_evidence,
      source_student_turn_id: entry.evaluator.source_student_turn_id,
      source_sequence_index: entry.evaluator.source_sequence_index,
      latest_accepted_student_turn_id:
        entry.evaluator.source_student_turn_id,
      latest_accepted_sequence_index:
        entry.evaluator.source_sequence_index,
      concept_id: input.contract.concept_id,
      distractor_anchor: input.contract.active_anchor_id,
      prior_cumulative_profile: cumulative,
      created_at: `2026-07-24T00:00:0${entry.turn}.000Z`
    });
    cumulative = finalized.cumulative;
    return { turn: entry.turn, finalized };
  });
  const turn3Source = input.turns.find((entry) => entry.turn === 3);
  const turn3 = finalizations.find((entry) => entry.turn === 3)?.finalized;
  assert(turn3Source && turn3, "e2a33d_turn3_finalization_missing");
  const sourceLinks =
    turn3Source.adjudication.structured_turn_evidence.essential_missing_links;
  const sourceLinksPreserved = sourceLinks.every((link) =>
    turn3.observation.essential_missing_links.includes(link) &&
    turn3.consistency.evidence_preservation
      .source_evaluator_missing_links.includes(link) &&
    turn3.consistency.evidence_preservation
      .mapped_missing_links.includes(link)
  );
  return {
    replay_version: "e2a33d-e2a33b-turn3-offline-replay-v1",
    source_run_id: SOURCE_RUN_ID,
    source_run_status: SOURCE_STATUS,
    source_turn: 3,
    exact_student_response:
      turn3Source.simulator.parsed_structured_output.student_message,
    evaluator_version: turn3Source.evaluator.evaluator_version,
    evaluator_essential_missing_links: sourceLinks,
    mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
    mapped_reasoning_quality: turn3.observation.reasoning_quality,
    mapped_essential_missing_links:
      turn3.observation.essential_missing_links,
    mapped_contradictions: turn3.observation.contradictions,
    preservation_audit: turn3.consistency.evidence_preservation,
    finalization_version: turn3.attestation.finalization_version,
    finalization_evidence_preservation_passed:
      turn3.attestation.evidence_preservation_passed,
    revision_ready: turn3.profile.revision_readiness,
    selected_route: turn3.route.selected_mode,
    tutor_dispatch_permitted:
      turn3.attestation.tutor_dispatch_permitted,
    source_links_preserved: sourceLinksPreserved,
    expected_corrected_result: "partial_non_sound",
    corrected_result_passed:
      turn3.observation.reasoning_quality === "partial" &&
      !turn3.profile.revision_readiness &&
      turn3.route.selected_mode === "remain_in_dialogue" &&
      turn3.attestation.tutor_dispatch_permitted &&
      sourceLinksPreserved,
    source_run_reclassified_as_passed: false,
    provider_calls_made: 0
  };
}

function productionWiringVerification() {
  const autonomous = readFileSync(path.join(
    process.cwd(),
    "src/lib/services/student-assessment/autonomous-formative-dialogue.ts"
  ), "utf8");
  const runtime = readFileSync(path.join(
    process.cwd(),
    "src/lib/services/student-assessment/activity-runtime-ui.ts"
  ), "utf8");
  const finalizer = readFileSync(path.join(
    process.cwd(),
    "src/lib/services/student-assessment/pre-tutor-profile-finalization-v4.ts"
  ), "utf8");
  const checks = {
    autonomous_uses_v4_finalizer:
      autonomous.includes("finalizeEvidenceFirstTurnBeforeTutorV4"),
    autonomous_requires_v7_preservation_attestation:
      autonomous.includes("consistency.evidence_preservation.passed"),
    runtime_uses_v4_finalizer:
      runtime.includes("finalizeEvidenceFirstTurnBeforeTutorV4"),
    runtime_persists_v7_mapper:
      runtime.includes("TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7"),
    finalizer_attests_preservation:
      finalizer.includes("evidence_preservation_passed") &&
      finalizer.includes("mapper_evidence_preservation_verified")
  };
  return {
    verification_version: "e2a33d-production-wiring-verification-v1",
    ...checks,
    historical_v3_finalizer_preserved: existsSync(path.join(
      process.cwd(),
      "src/lib/services/student-assessment/pre-tutor-profile-finalization-v3.ts"
    )),
    passed: Object.values(checks).every(Boolean)
  };
}

function evidencePreservationContract() {
  return {
    contract_version: TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION,
    mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
    profile_consistency_version: PROFILE_CONSISTENCY_POLICY_VERSION_V7,
    rule:
      "The mapper may aggregate evaluator evidence but must not remove evidence that can block sound classification or support audit reconstruction.",
    required_preserved_fields: [
      "essential_missing_links",
      "blocking_contradictions",
      "unresolved_limitations",
      "source_evidence_spans"
    ],
    invariants: [
      {
        invariant_id: "evaluator_missing_links_reach_sound_gate",
        condition:
          "Every evaluator structured essential missing link is present in the sound-gate input."
      },
      {
        invariant_id: "sound_requires_empty_missing_links",
        condition:
          "A mapped observation may be sound only when essential_missing_links is empty."
      },
      {
        invariant_id: "blocking_evidence_is_monotonic",
        condition:
          "Mapping may add normalized blocking evidence but may not remove source blocking evidence."
      }
    ],
    evaluator_v5_unchanged: true,
    sound_gate_criteria_unchanged: true,
    tutor_candidate_unchanged: true
  };
}

function e2a34Preparation() {
  return {
    preparation_version:
      "e2a34-evidence-preservation-held-out-preparation-v1",
    status: "prepared_not_frozen_not_executable",
    prerequisite_versions: {
      mapper: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
      evidence_preservation:
        TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION,
      finalization: PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V4,
      evaluator: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5
    },
    required_protocol_checks: [
      "held_out_domain_and_scenario_must_be_frozen_separately",
      "evaluator_missing_links_must_reach_mapper_and_sound_gate",
      "sound_must_require_zero_essential_missing_links",
      "blocking_contradictions_limitations_and_spans_must_be_preserved",
      "provider_call_guard_must_pass_before_separate_authorization"
    ],
    held_out_domain_frozen: false,
    protocol_complete: false,
    protocol_hash: null,
    composite_runtime_identity: null,
    live_execution_authorized: false,
    provider_dispatch_authorized: false,
    e2a34_executed: false,
    blocked_reason: "held_out_domain_and_full_protocol_not_frozen"
  };
}

function validateArtifacts(runDir: string) {
  const expected = [...ARTIFACT_NAMES].sort();
  const actual = readdirSync(runDir).sort();
  const failures: string[] = [];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push("artifact_name_or_count_mismatch");
  }
  for (const name of actual) {
    const filePath = path.join(runDir, name);
    try {
      assert(statSync(filePath).size > 0, "empty");
      assertSafe(readJson(filePath));
    } catch {
      failures.push(`artifact_malformed_or_unsafe:${name}`);
    }
  }
  return {
    validation_version: "e2a33d-artifact-validation-v1",
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

function execute(artifactRoot = ARTIFACT_ROOT) {
  const sourceBefore = sourceSnapshot();
  const protectedBefore = protectedIntegrity();
  assert(sourceSnapshotPassed(sourceBefore),
    "e2a33d_source_integrity_precheck_failed");
  assert(protectedBefore.passed,
    "e2a33d_protected_integrity_precheck_failed");
  const source = loadSource();
  assert(source.summary.run_id === SOURCE_RUN_ID &&
    source.summary.status === SOURCE_STATUS,
  "e2a33d_source_status_mismatch");
  const turns = reconstructTurns(source);
  const regressions = runRegressions({ contract: source.contract, turns });
  const replay = replayTurn3({ contract: source.contract, turns });
  const wiring = productionWiringVerification();
  assert(regressions.passed && replay.corrected_result_passed &&
    wiring.passed, "e2a33d_green_gate_failed");

  const sourceAfterReplay = sourceSnapshot();
  const protectedAfter = protectedIntegrity();
  assert(JSON.stringify(sourceBefore) === JSON.stringify(sourceAfterReplay),
    "e2a33d_historical_source_mutated");
  assert(protectedAfter.passed,
    "e2a33d_protected_source_changed");

  const runId = makeRunId();
  const runDir = path.join(artifactRoot, runId);
  mkdirSync(artifactRoot, { recursive: true });
  mkdirSync(runDir, { recursive: false });
  const values: Record<typeof PAYLOAD_NAMES[number], unknown> = {
    "correction-manifest.json": {
      manifest_version: VERSION,
      run_id: runId,
      application_git_commit: currentCommit(),
      source_run_id: SOURCE_RUN_ID,
      source_run_status: SOURCE_STATUS,
      evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
      target_contract_version: TARGET_EVIDENCE_CONTRACT_VERSION_V5,
      mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
      preservation_contract_version:
        TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION,
      finalization_version: PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V4,
      evaluator_modified: false,
      sound_gate_modified: false,
      tutor_candidate_modified: false,
      semantic_envelope_modified: false,
      e2a33b_rerun: false,
      e2a34_executed: false,
      provider_calls_made: 0
    },
    "source-integrity.json": {
      integrity_version: "e2a33d-source-integrity-v1",
      source_before: sourceBefore,
      source_after: sourceAfterReplay,
      historical_source_unchanged:
        JSON.stringify(sourceBefore) === JSON.stringify(sourceAfterReplay),
      protected_before: protectedBefore,
      protected_after: protectedAfter,
      passed: sourceSnapshotPassed(sourceAfterReplay) &&
        protectedAfter.passed
    },
    "evidence-preservation-contract.json": evidencePreservationContract(),
    "e2a33b-turn3-offline-replay.json": replay,
    "deterministic-mapper-regressions.json": regressions,
    "production-wiring-verification.json": wiring,
    "e2a34-protocol-preparation.json": e2a34Preparation(),
    "human-review-packet-enhancement.json": {
      packet_version: "e2a33d-human-review-packet-enhancement-v1",
      source_run_id: SOURCE_RUN_ID,
      source_packet_sha256:
        EXPECTED_SOURCE_HASHES["human-review-packet.json"],
      review_focus: "turn_3_evidence_preserving_mapper_correction",
      exact_student_response: replay.exact_student_response,
      evaluator_missing_links: replay.evaluator_essential_missing_links,
      corrected_mapper_result: {
        reasoning_quality: replay.mapped_reasoning_quality,
        essential_missing_links: replay.mapped_essential_missing_links,
        revision_ready: replay.revision_ready,
        route: replay.selected_route
      },
      preservation_audit: replay.preservation_audit,
      review_questions: [
        "Did every Evaluator V5 essential missing link survive mapping?",
        "Did those links reach the unchanged sound gate before classification?",
        "Is partial/non-sound the supported Turn 3 result?",
        "Does the corrected runtime remain in dialogue without authorizing revision?"
      ],
      human_review_required: true,
      human_review_complete: false,
      source_packet_mutated: false,
      source_run_reclassified_as_passed: false,
      classroom_validity: false,
      provider_calls_made: 0
    },
    "summary.json": {
      summary_version: "e2a33d-summary-v1",
      status: "e2a33d_evidence_preserving_mapper_correction_passed_no_live",
      run_id: runId,
      source_run_id: SOURCE_RUN_ID,
      source_run_status: SOURCE_STATUS,
      source_run_reclassified_as_passed: false,
      corrected_turn: 3,
      corrected_reasoning_quality: replay.mapped_reasoning_quality,
      corrected_revision_ready: replay.revision_ready,
      evaluator_missing_link_count:
        replay.evaluator_essential_missing_links.length,
      mapped_missing_link_count: replay.mapped_essential_missing_links.length,
      preservation_contract_passed:
        replay.preservation_audit.passed,
      deterministic_regressions:
        `${regressions.passed_case_count}/${regressions.case_count}`,
      production_wiring_passed: wiring.passed,
      historical_source_unchanged: true,
      e2a34_preparation_status:
        e2a34Preparation().status,
      e2a34_executed: false,
      evaluator_v5_modified: false,
      sound_gate_criteria_modified: false,
      tutor_candidate_modified: false,
      semantic_envelope_modified: false,
      provider_calls_made: 0,
      network_requests_made: 0,
      completed_at: new Date().toISOString()
    }
  };
  for (const name of PAYLOAD_NAMES) {
    writeJson(path.join(runDir, name), values[name]);
  }
  writeJson(path.join(runDir, "artifact-validation.json"), {
    validation_version: "e2a33d-payload-validation-v1",
    expected_payload_count: PAYLOAD_NAMES.length,
    actual_payload_count: PAYLOAD_NAMES.filter((name) =>
      existsSync(path.join(runDir, name))
    ).length,
    passed: PAYLOAD_NAMES.every((name) =>
      existsSync(path.join(runDir, name)) &&
      statSync(path.join(runDir, name)).size > 0
    )
  });
  const validation = validateArtifacts(runDir);
  assert(validation.passed, "e2a33d_artifact_validation_failed");
  const sourceAfterArtifacts = sourceSnapshot();
  assert(JSON.stringify(sourceBefore) === JSON.stringify(sourceAfterArtifacts),
    "e2a33d_historical_source_changed_after_artifacts");
  return {
    runId,
    runDir,
    replay,
    regressions,
    wiring,
    validation,
    summary: values["summary.json"]
  };
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const command = process.argv[2] ?? "smoke";
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = (async () => {
    networkRequests += 1;
    throw new Error("e2a33d_provider_call_prohibited");
  }) as typeof fetch;
  try {
    if (command === "run") {
      const result = execute();
      assert(networkRequests === 0, "e2a33d_network_request_detected");
      console.log(JSON.stringify({
        status: "passed",
        run_id: result.runId,
        run_directory: path.relative(process.cwd(), result.runDir),
        corrected_turn3_quality:
          result.replay.mapped_reasoning_quality,
        deterministic_regressions:
          `${result.regressions.passed_case_count}/${result.regressions.case_count}`,
        e2a34_status:
          (result.summary as { e2a34_preparation_status: string })
            .e2a34_preparation_status,
        provider_calls_made: 0,
        network_requests_made: networkRequests
      }, null, 2));
      return;
    }
    if (command === "smoke") {
      const temporaryRoot = mkdtempSync(path.join(
        tmpdir(),
        "e2a33d-evidence-preservation-"
      ));
      try {
        const result = execute(temporaryRoot);
        assert(result.replay.corrected_result_passed,
          "e2a33d_turn3_replay_failed");
        assert(result.regressions.passed_case_count === 4 &&
          result.regressions.passed,
        "e2a33d_regressions_failed");
        assert(result.validation.passed && result.wiring.passed,
          "e2a33d_validation_failed");
        assert(networkRequests === 0,
          "e2a33d_network_request_detected");
        console.log(JSON.stringify({
          status: "passed",
          suite: argument("--suite") ?? "all",
          source_run_id: SOURCE_RUN_ID,
          source_tree_sha256: SOURCE_TREE_SHA256,
          corrected_turn3_quality:
            result.replay.mapped_reasoning_quality,
          source_missing_links:
            result.replay.evaluator_essential_missing_links.length,
          mapped_missing_links:
            result.replay.mapped_essential_missing_links.length,
          deterministic_regressions:
            `${result.regressions.passed_case_count}/${result.regressions.case_count}`,
          artifact_count: result.validation.actual_artifact_count,
          historical_source_unchanged: true,
          provider_calls_made: 0,
          network_requests_made: networkRequests
        }, null, 2));
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
      return;
    }
    if (command === "report") {
      const runId = argument("--run");
      assert(runId, "e2a33d_run_id_required");
      const runDir = path.join(ARTIFACT_ROOT, runId);
      const validation = validateArtifacts(runDir);
      assert(validation.passed, "e2a33d_report_artifacts_invalid");
      console.log(JSON.stringify({
        run_id: runId,
        summary: readJson(path.join(runDir, "summary.json")),
        turn3_replay: readJson(path.join(
          runDir,
          "e2a33b-turn3-offline-replay.json"
        )),
        artifact_validation: validation,
        provider_calls_made: 0,
        network_requests_made: networkRequests
      }, null, 2));
      return;
    }
    throw new Error(`e2a33d_unknown_command:${command}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a33d_command_failed");
  process.exitCode = 1;
});
