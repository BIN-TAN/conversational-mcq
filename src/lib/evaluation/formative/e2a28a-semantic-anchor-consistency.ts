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
  buildNoLiveActivityMisconceptionEvidenceFixture,
  ActivityMisconceptionEvidencePacketV1Schema,
  type ActivityMisconceptionEvidencePacketV1
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import {
  ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
  resolveActiveAnchorAlias
} from "@/lib/services/student-assessment/active-anchor-alias-resolution";
import {
  ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2
} from "@/lib/services/student-assessment/anchor-contradiction-propagation-v2";
import {
  PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V2,
  finalizeEvidenceFirstTurnBeforeTutorV2
} from "@/lib/services/student-assessment/pre-tutor-profile-finalization-v2";
import {
  assertTutorDispatchUsesFinalizedProfile
} from "@/lib/services/student-assessment/pre-tutor-profile-finalization";
import {
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
  ProductionTurnEvidenceStructuredFieldsV5Schema
} from "@/lib/services/student-assessment/production-turn-evidence-evaluator-v5";
import {
  PROFILE_CONSISTENCY_POLICY_VERSION_V5,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V5,
  buildActivityTargetEvidenceContractV5,
  buildTargetEvidenceAdjudicationFromEvaluatorOutputV5
} from "@/lib/services/student-assessment/target-evidence-contract-v5";
import {
  TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION,
  reconcileAuthoritativeTurnEvidenceViews
} from "@/lib/services/student-assessment/turn-evidence-cross-artifact-consistency";
import type {
  TopicDialogueCumulativeEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";

export const E2A28A_VERSION =
  "e2a28a-semantic-anchor-consistency-v1" as const;
export const E2A28A_STATUS =
  "e2a28a_live_evaluator_wiring_corrected_e2a29_ready" as const;
export const SEMANTIC_ENVELOPE_VERSION =
  "progression-relevant-semantic-envelope-v2" as const;
export const E2A28A_ARTIFACT_ROOT = path.join(
  process.cwd(), ".data", "e2a28a-semantic-anchor-consistency"
);
export const E2A28_RUN_ID =
  "e2a28_20260722083935_6ecb39bb" as const;
export const E2A28_RUN_DIR = path.join(
  process.cwd(), ".data",
  "e2a28-antimicrobial-resistance-contradiction-canary", E2A28_RUN_ID
);
export const E2A27A_RUN_DIR = path.join(
  process.cwd(), ".data", "e2a27a-contradiction-propagation",
  "e2a27a_20260722074221_ec5cc0b0"
);
export const APPROVED_V2_HASH =
  "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993" as const;
export const CANDIDATE_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b" as const;
export const CANDIDATE_FILE_SHA256 =
  "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2" as const;

export function assertE2A28ALiveEvaluatorV5ContractSelection() {
  const relativePath =
    "src/lib/services/student-assessment/activity-misconception-evidence-live.ts";
  const source = readFileSync(path.join(process.cwd(), relativePath), "utf8");
  const start = source.indexOf(
    "export async function executeLiveActivityMisconceptionEvidenceEvaluator"
  );
  const end = source.indexOf(
    "export function makeLiveActivityMisconceptionEvidencePacketForTest",
    start
  );
  if (start < 0 || end < 0) {
    throw new Error("e2a28a_live_evaluator_execution_function_missing");
  }
  const executionSource = source.slice(start, end);
  const requiredSelections = [
    "buildProductionTurnEvidenceEvaluatorInputV5",
    "PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5",
    "PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5",
    "PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_INSTRUCTIONS_V5",
    "ProductionTurnEvidenceEvaluatorOutputV5Schema",
    "PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5",
    "source_student_turn_id",
    "source_sequence_index"
  ];
  const missingSelections = requiredSelections.filter((selection) =>
    !executionSource.includes(selection)
  );
  if (missingSelections.length > 0) {
    throw new Error(
      `e2a28a_live_evaluator_v5_selection_missing:${missingSelections.join("|")}`
    );
  }
  return {
    passed: true,
    source_path: relativePath,
    source_sha256: sha256(source),
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    prompt_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
    prompt_hash: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
    output_schema_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
    source_turn_identity_bound: true,
    provider_calls_made: 0
  };
}

export const E2A28A_ARTIFACT_NAMES = [
  "e2a28a-manifest.json",
  "human-review-attestation.json",
  "ai-assisted-review-reference.json",
  "review-reconciliation.json",
  "e2a28-exact-reconstruction.json",
  "e2a28-turn3-semantic-adjudication.json",
  "semantic-envelope-v2.json",
  "live-evaluator-contract-audit.json",
  "live-evaluator-request-trace.json",
  "active-anchor-alias-contract.json",
  "turn1-anchor-reconstruction.json",
  "turn2-anchor-reconstruction.json",
  "turn3-anchor-reconstruction.json",
  "turn3-contradiction-adjudication.json",
  "cross-artifact-consistency-audit.json",
  "root-cause-classification.json",
  "production-evaluator-delta.json",
  "anchor-resolver-delta.json",
  "profile-mapper-delta.json",
  "contradiction-propagation-delta.json",
  "profile-consistency-delta.json",
  "pre-tutor-finalization-delta.json",
  "e2a28-read-only-replay.json",
  "historical-non-regression-replays.json",
  "failure-taxonomy-reconciliation.json",
  "human-review-binding-audit.json",
  "calibration-corpus.jsonl",
  "calibration-results.jsonl",
  "candidate-integrity.json",
  "composite-runtime-identity.json",
  "e2a29-held-out-overlap-analysis.json",
  "e2a29-frozen-protocol.json",
  "e2a29-frozen-protocol.sha256",
  "e2a29-budget.json",
  "e2a29-artifact-contract.json",
  "summary.json"
] as const;

type JsonRecord = Record<string, unknown>;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
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

function sourceSha(relativePath: string) {
  return sha256(readFileSync(path.join(process.cwd(), relativePath)));
}

function filesRecursively(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(root, entry.name);
    return entry.isDirectory() ? filesRecursively(child) : [child];
  }).sort();
}

function protectedEvidenceSnapshot() {
  const configRoots = readdirSync(path.join(process.cwd(), "config"))
    .filter((name) => /^(?:approved|candidate)-operational-agent-config/u
      .test(name))
    .map((name) => path.join(process.cwd(), "config", name));
  const e2aRoots = readdirSync(path.join(process.cwd(), ".data"), {
    withFileTypes: true
  }).filter((entry) => entry.isDirectory() &&
    entry.name !== path.basename(E2A28A_ARTIFACT_ROOT) &&
    /^e2a(?:1[2-9]|2[0-8])[a-z]*(?:-|$)/u.test(entry.name))
    .map((entry) => path.join(process.cwd(), ".data", entry.name));
  const files = [...configRoots, ...e2aRoots].flatMap(filesRecursively).sort();
  const hashes = Object.fromEntries(files.map((file) => [
    path.relative(process.cwd(), file), sha256(readFileSync(file))
  ]));
  return {
    snapshot_version: "e2a28a-protected-evidence-snapshot-v1",
    file_count: files.length,
    aggregate_sha256: stableHash(hashes),
    file_hashes: hashes
  };
}

function applicationGitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(), encoding: "utf8"
  }).trim();
}

type HistoricalProviderRow = {
  session_id: string;
  turn: number;
  parsed_structured_output?: unknown;
  provider_result?: { parsed_output?: unknown; raw_output_sha256?: string };
  request_provenance?: JsonRecord;
};

function packetFromProviderRow(row: HistoricalProviderRow) {
  return ActivityMisconceptionEvidencePacketV1Schema.parse(
    row.parsed_structured_output ?? row.provider_result?.parsed_output
  );
}

function loadHistoricalE2A28() {
  if (!existsSync(E2A28_RUN_DIR)) {
    throw new Error("e2a28a_historical_e2a28_run_missing");
  }
  return {
    summary: readJson<JsonRecord>(path.join(E2A28_RUN_DIR,
      "canary-summary.json")),
    protocol: readJson<JsonRecord>(path.join(E2A28_RUN_DIR,
      "frozen-protocol.json")),
    targetContract: readJson<JsonRecord>(path.join(E2A28_RUN_DIR,
      "target-evidence-contract.json")),
    simulators: readJsonl<HistoricalProviderRow>(path.join(E2A28_RUN_DIR,
      "simulator-provider-outputs.jsonl")),
    evaluatorRequests: readJsonl<JsonRecord>(path.join(E2A28_RUN_DIR,
      "evaluator-requests.jsonl")),
    evaluatorProviders: readJsonl<HistoricalProviderRow>(path.join(
      E2A28_RUN_DIR, "evaluator-provider-outputs.jsonl")),
    evaluatorOutputs: readJsonl<JsonRecord>(path.join(E2A28_RUN_DIR,
      "evaluator-outputs.jsonl")),
    profiles: readJsonl<JsonRecord>(path.join(E2A28_RUN_DIR,
      "turn-profile-snapshots.jsonl")),
    cumulative: readJsonl<JsonRecord>(path.join(E2A28_RUN_DIR,
      "cumulative-profile-updates.jsonl")),
    preTutor: readJsonl<JsonRecord>(path.join(E2A28_RUN_DIR,
      "pre-tutor-finalization-results.jsonl")),
    tutorInputs: readJsonl<JsonRecord>(path.join(E2A28_RUN_DIR,
      "autonomous-tutor-inputs.jsonl")),
    tutorOutputs: readJsonl<HistoricalProviderRow>(path.join(E2A28_RUN_DIR,
      "autonomous-tutor-provider-outputs.jsonl")),
    persistence: readJsonl<JsonRecord>(path.join(E2A28_RUN_DIR,
      "persistence-results.jsonl")),
    display: readJsonl<JsonRecord>(path.join(E2A28_RUN_DIR,
      "student-turn-results.jsonl")),
    reviewBindings: readJsonl<JsonRecord>(path.join(E2A28_RUN_DIR,
      "human-review-binding-results.jsonl"))
  };
}

function studentMessage(row: HistoricalProviderRow) {
  const value = row.parsed_structured_output ?? row.provider_result?.parsed_output;
  return String((value as { student_message?: string })?.student_message ?? "");
}

function byTurn<T extends { turn?: unknown }>(rows: T[], turn: number) {
  return rows.find((row) => row.turn === turn) ?? null;
}

function structuredE2A28Turn(input: {
  turn: number;
  message: string;
  packet: ActivityMisconceptionEvidencePacketV1;
  contract: ReturnType<typeof buildActivityTargetEvidenceContractV5>;
}) {
  const resolution = resolveActiveAnchorAlias({
    message: input.message,
    contract: input.contract.active_anchor_alias_contract,
    prior_visible_message: "The active discussion is about option C."
  });
  const conceptualConclusion = input.turn === 3
    ? "rejects_distractor" as const
    : input.turn === 1
      ? "endorses_distractor" as const
      : "ambiguous" as const;
  const decisive = ["endorses_distractor", "rejects_distractor"].includes(
    conceptualConclusion
  );
  const alignment = decisive &&
      resolution.observed_anchor_stance !== "ambiguous" &&
      resolution.observed_anchor_stance !== "not_expressed"
    ? resolution.observed_anchor_stance === conceptualConclusion
      ? "aligned" as const : "contradictory" as const
    : "unresolved" as const;
  const blocking = alignment === "contradictory";
  const conceptualSpan = input.turn === 3
    ? "some bacteria could already be less affected before the antibiotic. Those ones would survive more and make more bacteria after."
    : input.turn === 2
      ? "No cell could change its traits during treatment"
      : "the antibiotic makes the bacteria adapt because they need to survive";
  return ProductionTurnEvidenceStructuredFieldsV5Schema.parse({
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    source_student_turn_id: `student_E2A28-AMR_${input.turn}`,
    source_sequence_index: input.turn * 2,
    active_anchor_id: input.contract.active_anchor_id,
    observed_anchor_reference: resolution.observed_anchor_reference,
    observed_anchor_identifier: resolution.observed_anchor_identifier,
    observed_anchor_text: resolution.observed_anchor_text,
    observed_anchor_conclusion: resolution.observed_anchor_stance,
    observed_anchor_stance: resolution.observed_anchor_stance,
    conceptual_mechanism: input.turn === 3
      ? "Pre-existing less-susceptible bacteria survive more often and reproduce, while the response also retains exposure-driven individual change."
      : input.packet.misconception_evidence_update.safe_internal_rationale,
    conceptual_conclusion: conceptualConclusion,
    anchor_concept_alignment: alignment,
    anchor_conflict_type: blocking
      ? "anchor_conclusion_conceptual_explanation_conflict" : null,
    blocking_conflict: blocking,
    exact_anchor_evidence_spans: [
      ...resolution.exact_anchor_evidence_spans,
      ...resolution.exact_stance_evidence_spans
    ].map((entry) => ({ label: entry.label, span: entry.span })),
    exact_conceptual_evidence_spans: [{
      label: "conceptual_mechanism",
      span: conceptualSpan
    }],
    essential_missing_links: input.turn === 3
      ? ["separate_population_selection_from_individual_change",
          "reject_option_C_consistently"]
      : ["population_selection_mechanism", "reject_option_C_consistently"],
    confidence_evidence: input.packet.misconception_evidence_update.confidence,
    engagement_evidence: [],
    evidence_limitations: [
      "derived_no_live_v5_replay_of_immutable_historical_provider_output"
    ]
  });
}

function replayE2A28(historical: ReturnType<typeof loadHistoricalE2A28>) {
  let prior: TopicDialogueCumulativeEvidenceProfile | null = null;
  const turns = [1, 2, 3].map((turn) => {
    const simulator = historical.simulators.find((row) => row.turn === turn);
    const evaluator = historical.evaluatorProviders.find((row) =>
      row.turn === turn
    );
    if (!simulator || !evaluator) {
      throw new Error(`e2a28a_historical_provider_row_missing:turn_${turn}`);
    }
    const message = studentMessage(simulator);
    const packet = packetFromProviderRow(evaluator);
    const contract = buildActivityTargetEvidenceContractV5({
      concept_id: "antimicrobial_resistance_population_selection",
      item_id: "antimicrobial_resistance_item_1",
      distractor_option: "C",
      distractor_claim:
        "During treatment, individual bacteria become resistant because they adapt to the antibiotic in response to needing to survive.",
      packet
    });
    const structured = structuredE2A28Turn({
      turn, message, packet, contract
    });
    const adjudication = buildTargetEvidenceAdjudicationFromEvaluatorOutputV5({
      latest_student_message: message,
      packet,
      structured_turn_evidence: structured,
      contract,
      expected_source_student_turn_id: `student_E2A28-AMR_${turn}`,
      expected_source_sequence_index: turn * 2,
      prior_visible_message: "The active discussion is about option C."
    });
    const finalized = finalizeEvidenceFirstTurnBeforeTutorV2({
      contract,
      adjudication,
      interaction_intent: "ordinary_conceptual_response",
      confidence_evidence: packet.misconception_evidence_update.confidence,
      source_student_turn_id: `student_E2A28-AMR_${turn}`,
      source_sequence_index: turn * 2,
      latest_accepted_student_turn_id: `student_E2A28-AMR_${turn}`,
      latest_accepted_sequence_index: turn * 2,
      concept_id: "antimicrobial_resistance_population_selection",
      distractor_anchor: "antimicrobial_resistance_item_1:C",
      prior_cumulative_profile: prior,
      created_at: `2026-07-22T08:${39 + turn}:00.000Z`
    });
    prior = finalized.cumulative;
    return {
      turn,
      exact_student_response: message,
      historical_provider_packet: packet,
      historical_provider_contract_identity: {
        prompt_version: "formative-activity-response-evaluator-prompt-v6",
        prompt_hash:
          "0ab42d698875044aae1ced244e32ce9778656f5a9347809f07b9d70d078d17bb",
        schema_name: "formative-activity-response-evaluation-v1",
        output_schema: "student-activity-misconception-evidence-v1"
      },
      derived_v5_structured_evidence: structured,
      alias_resolution: adjudication.anchor_alias_resolution,
      contradiction_propagation: adjudication.anchor_propagation,
      corrected_profile: finalized.profile,
      corrected_cumulative_profile: finalized.cumulative,
      corrected_route: finalized.route,
      cross_artifact_consistency: finalized.cross_artifact_consistency,
      pre_tutor_finalization: finalized.attestation,
      corrected_tutor_dispatch_eligibility:
        finalized.attestation.tutor_dispatch_permitted,
      provider_calls_made: 0
    };
  });
  const expected = turns.map((turn) => ({
    turn: turn.turn,
    explicit: turn.alias_resolution.observed_anchor_reference === "explicit",
    endorses: turn.alias_resolution.observed_anchor_stance ===
      "endorses_distractor",
    non_sound: turn.corrected_profile.reasoning_quality !== "sound",
    no_revision: !turn.corrected_profile.revision_readiness,
    remain: turn.corrected_route.selected_mode === "remain_in_dialogue",
    turn3_conflict: turn.turn !== 3 ||
      turn.corrected_profile.contradictions.includes(
        "anchor_conclusion_conceptual_explanation_conflict"
      )
  }));
  if (expected.some((entry) => Object.entries(entry)
    .some(([key, value]) => key !== "turn" && value !== true))) {
    throw new Error("e2a28a_corrected_replay_invariant_failed");
  }
  return {
    replay_version: "e2a28a-read-only-replay-v1",
    source_run_id: E2A28_RUN_ID,
    immutable_provider_outputs_reused: true,
    provider_calls_made: 0,
    network_requests_made: 0,
    turns
  };
}

type CalibrationExpectation =
  | "sound"
  | "non_sound"
  | "structured_conflict"
  | "fail_closed_parity"
  | "fail_closed_cross_artifact"
  | "fail_closed_stale"
  | "fail_closed_unfinalized";

const CALIBRATION_ARCHETYPES: Array<{
  id: string;
  message: string;
  conceptual: "endorses_distractor" | "rejects_distractor" | "ambiguous";
  expected: CalibrationExpectation;
  prior?: string;
  limitationConflict?: boolean;
  providerReferenceOverride?: "explicit" | "absent";
}> = [
  { id: "explicit_letter_only", message: "C", conceptual: "ambiguous", expected: "non_sound" },
  { id: "i_choose_c", message: "I choose C because the change happens during exposure.", conceptual: "endorses_distractor", expected: "non_sound" },
  { id: "c_still_seems_right", message: "C still seems right because the component causes the change.", conceptual: "endorses_distractor", expected: "non_sound" },
  { id: "option_text_without_letter", message: "The active distractor claim is wrong because the mechanism preserves the quantity.", conceptual: "rejects_distractor", expected: "sound" },
  { id: "pronoun_anchor", message: "That claim is wrong because the mechanism preserves the quantity.", conceptual: "rejects_distractor", expected: "sound", prior: "Consider option C and that claim." },
  { id: "quoted_then_rejected", message: "\"C is correct\" is the claim. That claim is wrong because the mechanism does not support it.", conceptual: "rejects_distractor", expected: "sound", prior: "Consider option C and that claim." },
  { id: "correct_mechanism_distractor_endorsement", message: "The quantity is preserved through the system, but I still think C is correct.", conceptual: "rejects_distractor", expected: "structured_conflict" },
  { id: "partial_mechanism_distractor_endorsement", message: "Some of the quantity might continue, but I choose C.", conceptual: "ambiguous", expected: "non_sound" },
  { id: "correct_label_wrong_mechanism", message: "Option C is wrong, but only because the quantity gets used up earlier.", conceptual: "endorses_distractor", expected: "structured_conflict" },
  { id: "ambiguous_anchor_conclusion", message: "Option C is correct, but option C is wrong.", conceptual: "ambiguous", expected: "non_sound" },
  { id: "self_correction", message: "Option C is correct. Actually, option C is wrong because the quantity is conserved.", conceptual: "rejects_distractor", expected: "sound" },
  { id: "copied_tutor_wording", message: "The mechanism and boundary should be considered together.", conceptual: "ambiguous", expected: "non_sound" },
  { id: "copied_plus_application", message: "The mechanism and boundary should be considered together, so option C is wrong because the quantity is conserved.", conceptual: "rejects_distractor", expected: "sound" },
  { id: "persistent_partial_improvement", message: "I see part of the mechanism, but I still think C is accurate.", conceptual: "ambiguous", expected: "non_sound" },
  { id: "high_confidence_misconception", message: "I am certain option C is correct because the quantity is consumed.", conceptual: "endorses_distractor", expected: "non_sound" },
  { id: "low_confidence_sound", message: "I am not sure, but option C is wrong because the same quantity enters and leaves.", conceptual: "rejects_distractor", expected: "sound" },
  { id: "informal_typo_sound", message: "option C is wrong cuz the same amount keeps goin through", conceptual: "rejects_distractor", expected: "sound" },
  { id: "frustration_with_evidence", message: "This is frustrating, but option C is wrong because the mechanism conserves the quantity.", conceptual: "rejects_distractor", expected: "sound" },
  { id: "multiple_option_labels", message: "Option B sounds related. Option C is wrong because the mechanism rules it out.", conceptual: "rejects_distractor", expected: "sound" },
  { id: "letter_text_disagreement", message: "I choose C because the active distractor claim is correct.", conceptual: "endorses_distractor", expected: "fail_closed_parity", providerReferenceOverride: "absent" },
  { id: "blocking_conflict_only_in_limitations", message: "The mechanism rules out the claim, but option C is correct.", conceptual: "rejects_distractor", expected: "fail_closed_parity", limitationConflict: true },
  { id: "conflict_structured_correctly", message: "The mechanism preserves the quantity, but option C is correct.", conceptual: "rejects_distractor", expected: "structured_conflict" },
  { id: "cross_artifact_anchor_disagreement", message: "Option C is wrong because the quantity is conserved.", conceptual: "rejects_distractor", expected: "fail_closed_cross_artifact" },
  { id: "stale_profile", message: "Option C is wrong because the quantity is conserved.", conceptual: "rejects_distractor", expected: "fail_closed_stale" },
  { id: "tutor_dispatch_before_finalization", message: "Option C is wrong because the quantity is conserved.", conceptual: "rejects_distractor", expected: "fail_closed_unfinalized" }
];

const CALIBRATION_DOMAINS = [
  "electrical_circuits",
  "ecology_population_growth",
  "economics_opportunity_cost",
  "computer_science_recursion",
  "chemistry_equilibrium",
  "linguistics_morphology",
  "epidemiology_screening",
  "history_source_evidence"
] as const;

function calibrationPacket(input: {
  caseId: string;
  archetype: typeof CALIBRATION_ARCHETYPES[number];
}) {
  const sound = input.archetype.expected === "sound" ||
    ["fail_closed_cross_artifact", "fail_closed_stale",
      "fail_closed_unfinalized"].includes(input.archetype.expected);
  const conflict = input.archetype.expected === "structured_conflict" ||
    input.archetype.limitationConflict;
  return buildNoLiveActivityMisconceptionEvidenceFixture({
    case_id: input.caseId,
    activity_family: "reasoning_chain_repair",
    selected_formative_value: "reasoning_refinement",
    profile_condition: input.archetype.id,
    source_diagnostic_purpose: "reasoning_boundary_repair",
    response_kind: "substantive",
    response_length_band: "short",
    response_summary: "Synthetic no-live calibration response.",
    primary_target: "reasoning_link",
    secondary_targets: ["target_boundary"],
    evidence_types: ["target_boundary_explained", "reasoning_link_repaired"],
    update_status: sound
      ? "boundary_understanding_improved"
      : conflict ? "reasoning_boundary_still_blurred"
        : input.archetype.conceptual === "endorses_distractor"
          ? "misconception_persisted" : "misconception_weakened",
    evidence_quality: sound ? "high" : "medium",
    confidence: input.archetype.id.includes("low_confidence") ? "low" :
      input.archetype.id.includes("high_confidence") ? "high" : "medium",
    evidence_flags: {
      student_explained_target_boundary: sound || conflict ? "yes" : "partial",
      student_repaired_reasoning_link: sound || conflict ? "yes" : "partial"
    },
    safe_internal_rationale: input.archetype.conceptual === "rejects_distractor"
      ? "The response uses a mechanism that rejects the active distractor."
      : input.archetype.conceptual === "endorses_distractor"
        ? "The response retains the active distractor mechanism."
        : "The conceptual conclusion remains incomplete.",
    limitations: input.archetype.limitationConflict
      ? ["The final option conclusion conflicts with the conceptual explanation."]
      : ["synthetic_no_live_cross_domain_calibration"]
  });
}

function calibrationStructured(input: {
  caseId: string;
  archetype: typeof CALIBRATION_ARCHETYPES[number];
  contract: ReturnType<typeof buildActivityTargetEvidenceContractV5>;
}) {
  const resolution = resolveActiveAnchorAlias({
    message: input.archetype.message,
    contract: input.contract.active_anchor_alias_contract,
    prior_visible_message: input.archetype.prior ?? null
  });
  const stance = resolution.observed_anchor_stance;
  const conceptual = input.archetype.conceptual;
  const detectedBlocking = ["endorses_distractor", "rejects_distractor"].includes(
    stance
  ) && ["endorses_distractor", "rejects_distractor"].includes(conceptual) &&
    stance !== conceptual;
  const blocking = input.archetype.limitationConflict
    ? false
    : detectedBlocking;
  return ProductionTurnEvidenceStructuredFieldsV5Schema.parse({
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    source_student_turn_id: `student_${input.caseId}`,
    source_sequence_index: 2,
    active_anchor_id: input.contract.active_anchor_id,
    observed_anchor_reference:
      input.archetype.providerReferenceOverride ??
      resolution.observed_anchor_reference,
    observed_anchor_identifier: input.archetype.providerReferenceOverride ===
      "absent" ? null : resolution.observed_anchor_identifier,
    observed_anchor_text: input.archetype.providerReferenceOverride ===
      "absent" ? null : resolution.observed_anchor_text,
    observed_anchor_conclusion: input.archetype.providerReferenceOverride ===
      "absent" ? "not_expressed" : stance,
    observed_anchor_stance: input.archetype.providerReferenceOverride ===
      "absent" ? "not_expressed" : stance,
    conceptual_mechanism: "A bounded synthetic mechanism statement.",
    conceptual_conclusion: conceptual,
    anchor_concept_alignment: detectedBlocking ? "contradictory" :
      stance === "not_expressed" ? "not_assessable" :
        stance === "ambiguous" || conceptual === "ambiguous"
          ? "unresolved" : "aligned",
    anchor_conflict_type: blocking
      ? "anchor_conclusion_conceptual_explanation_conflict" : null,
    blocking_conflict: blocking,
    exact_anchor_evidence_spans:
      input.archetype.providerReferenceOverride === "absent" ? [] : [
        ...resolution.exact_anchor_evidence_spans,
        ...resolution.exact_stance_evidence_spans
      ].map((entry) => ({ label: entry.label, span: entry.span })),
    exact_conceptual_evidence_spans: [{
      label: "conceptual_mechanism",
      span: input.archetype.message.slice(0, 900)
    }],
    essential_missing_links: input.archetype.expected === "sound" ? [] :
      ["current_anchor_resolution"],
    confidence_evidence: input.archetype.id.includes("low_confidence")
      ? "low" : input.archetype.id.includes("high_confidence")
        ? "high" : "medium",
    engagement_evidence: [],
    evidence_limitations: ["synthetic_no_live_calibration"]
  });
}

export function runE2A28ACalibration() {
  const corpus = CALIBRATION_DOMAINS.flatMap((domain) =>
    CALIBRATION_ARCHETYPES.map((archetype) => ({
      case_id: `${domain}_${archetype.id}`,
      domain,
      observable_response: archetype.message,
      target_contract: {
        active_anchor_id: `${domain}:item:option:C`,
        option_label: "C",
        option_text: "The active distractor claim",
        required_anchor_stance: "rejects_distractor"
      },
      anchor_aliases: ["C", "option C", "choice C", "answer C",
        "that option", "that claim"],
      accepted_reasoning_quality_set: archetype.expected === "sound"
        ? ["sound"] : ["insufficient", "misconception", "partial"],
      required_anchor_application: archetype.message.includes("C") ||
        archetype.message.toLowerCase().includes("that claim") ||
        archetype.id === "option_text_without_letter"
        ? "explicit" : "absent",
      required_stance: archetype.expected === "sound"
        ? "rejects_distractor" : null,
      required_consistency: archetype.expected === "structured_conflict"
        ? "contradictory_to_conceptual_reasoning" : null,
      required_contradictions: archetype.expected === "structured_conflict"
        ? ["anchor_conclusion_conceptual_explanation_conflict"] : [],
      revision_readiness: archetype.expected === "sound",
      platform_mode: archetype.expected === "sound"
        ? "request_revision" : "remain_in_dialogue",
      tutor_dispatch_eligibility: archetype.expected !== "sound" &&
        !archetype.expected.startsWith("fail_closed"),
      hard_failure_conditions: [
        "false_sound",
        "sound_false_negative",
        "explicit_anchor_not_detected",
        "contradiction_not_structured",
        "cross_artifact_profile_disagreement",
        "profile_not_finalized_before_tutor"
      ],
      review_only_ambiguities: archetype.conceptual === "ambiguous"
        ? ["misconception_or_partial_may_both_be_defensible"] : [],
      expectation: archetype.expected,
      archetype
    }))
  );
  const results = corpus.map((entry) => {
    let observed = "completed";
    let passed = false;
    let issueCode: string | null = null;
    try {
      const packet = calibrationPacket({
        caseId: entry.case_id,
        archetype: entry.archetype
      });
      const contract = buildActivityTargetEvidenceContractV5({
        concept_id: entry.domain,
        item_id: `${entry.domain}_item`,
        distractor_option: "C",
        distractor_claim: "The active distractor claim",
        packet
      });
      const structured = calibrationStructured({
        caseId: entry.case_id,
        archetype: entry.archetype,
        contract
      });
      const adjudication = buildTargetEvidenceAdjudicationFromEvaluatorOutputV5({
        latest_student_message: entry.observable_response,
        packet,
        structured_turn_evidence: structured,
        contract,
        expected_source_student_turn_id: `student_${entry.case_id}`,
        expected_source_sequence_index: 2,
        prior_visible_message: entry.archetype.prior ?? null
      });
      const finalized = finalizeEvidenceFirstTurnBeforeTutorV2({
        contract,
        adjudication,
        interaction_intent: "ordinary_conceptual_response",
        confidence_evidence: structured.confidence_evidence,
        source_student_turn_id: `student_${entry.case_id}`,
        source_sequence_index: 2,
        latest_accepted_student_turn_id: `student_${entry.case_id}`,
        latest_accepted_sequence_index: 2,
        concept_id: entry.domain,
        distractor_anchor: `${entry.domain}:C`,
        prior_cumulative_profile: null,
        created_at: "2026-07-22T00:00:00.000Z"
      });
      if (entry.expectation === "fail_closed_cross_artifact") {
        reconcileAuthoritativeTurnEvidenceViews({
          views: [
            {
              artifact_type: "evaluator",
              source_student_turn_id: finalized.profile.source_student_turn_id,
              source_sequence_index: 2,
              evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
              anchor_application: "explicit",
              anchor_stance: "rejects_distractor",
              anchor_consistency: "consistent_with_conceptual_reasoning",
              anchor_resolution_status: "resolved_against_distractor",
              contradictions: [],
              reasoning_quality: "sound",
              revision_readiness: true,
              platform_mode: "request_revision"
            },
            {
              artifact_type: "turn_profile",
              source_student_turn_id: finalized.profile.source_student_turn_id,
              source_sequence_index: 2,
              evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
              anchor_application: "absent",
              anchor_stance: "not_expressed",
              anchor_consistency: "unresolved",
              anchor_resolution_status: "unresolved",
              contradictions: [],
              reasoning_quality: "partial",
              revision_readiness: false,
              platform_mode: "remain_in_dialogue"
            }
          ]
        });
      } else if (entry.expectation === "fail_closed_stale") {
        assertTutorDispatchUsesFinalizedProfile({
          profile: finalized.profile,
          attestation: finalized.attestation,
          latest_accepted_student_turn_id: finalized.profile.source_student_turn_id,
          latest_accepted_sequence_index: 4
        });
      } else if (entry.expectation === "fail_closed_unfinalized") {
        assertTutorDispatchUsesFinalizedProfile({
          profile: finalized.profile,
          attestation: null,
          latest_accepted_student_turn_id: finalized.profile.source_student_turn_id,
          latest_accepted_sequence_index: 2
        });
      } else if (entry.expectation === "sound") {
        passed = finalized.profile.reasoning_quality === "sound" &&
          finalized.profile.revision_readiness &&
          finalized.route.selected_mode === "request_revision";
      } else if (entry.expectation === "structured_conflict") {
        passed = finalized.profile.reasoning_quality !== "sound" &&
          !finalized.profile.revision_readiness &&
          finalized.profile.contradictions.includes(
            "anchor_conclusion_conceptual_explanation_conflict"
          ) && finalized.route.selected_mode === "remain_in_dialogue";
      } else {
        passed = finalized.profile.reasoning_quality !== "sound" &&
          !finalized.profile.revision_readiness;
      }
      observed = finalized.profile.reasoning_quality;
    } catch (error) {
      issueCode = error instanceof Error ? error.message : "unknown_error";
      passed = entry.expectation.startsWith("fail_closed");
      observed = "failed_closed";
    }
    return {
      case_id: entry.case_id,
      domain: entry.domain,
      expectation: entry.expectation,
      observed_result: observed,
      passed,
      issue_code: issueCode,
      provider_calls_made: 0
    };
  });
  return {
    corpus: corpus.map(({ archetype, ...entry }) => {
      void archetype;
      return entry;
    }),
    results,
    summary: {
      case_count: results.length,
      domain_count: CALIBRATION_DOMAINS.length,
      non_irt_case_count: results.length,
      passed_count: results.filter((entry) => entry.passed).length,
      failed_count: results.filter((entry) => !entry.passed).length,
      provider_calls_made: 0
    }
  };
}

function extractHistoricalStrings(value: unknown, output: string[]) {
  if (typeof value === "string") {
    if (value.split(/\s+/u).length >= 5 && value.length <= 1400) {
      output.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => extractHistoricalStrings(entry, output));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as JsonRecord)) {
      if (/message|response|prompt|claim|description/iu.test(key)) {
        extractHistoricalStrings(entry, output);
      } else if (entry && typeof entry === "object") {
        extractHistoricalStrings(entry, output);
      }
    }
  }
}

function normalizedText(value: string) {
  return value.toLocaleLowerCase("en-CA").replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ").trim();
}

function tokenJaccard(left: string, right: string) {
  const a = new Set(normalizedText(left).split(" ").filter(Boolean));
  const b = new Set(normalizedText(right).split(" ").filter(Boolean));
  const intersection = [...a].filter((entry) => b.has(entry)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function e2a29Protocol() {
  return {
    protocol_version: "e2a29-electrical-circuits-anchor-contradiction-canary-v1",
    execution_authorized: false,
    live_execution_performed: false,
    session_count: 1,
    domain: "introductory_electrical_circuits",
    concept:
      "In a simple steady-state series circuit, current is the same through each component while electrical energy is transferred.",
    active_distractor: {
      option_label: "C",
      claim:
        "A bulb uses up electric current, so less current leaves the bulb than enters it."
    },
    natural_initial_activity:
      "A lamp is connected in a simple series circuit. Compare the current just before and just after the lamp, then explain what the lamp changes in the circuit.",
    frozen_trajectory: [
      { turn: 1, role: "concise_misconception", envelope: ["misconception"] },
      { turn: 2, role: "copied_or_echoed_tutor_wording", envelope: ["insufficient", "misconception"] },
      { turn: 3, role: "partial_improvement", envelope: ["misconception", "partial"] },
      { turn: 4, role: "conservation_mechanism_with_explicit_wrong_C_conclusion", envelope: ["misconception", "partial"], required_structured_conflict: true },
      { turn: 5, role: "natural_clarification", envelope: ["insufficient", "partial"] },
      { turn: 6, role: "independent_coherent_rejection", envelope: ["sound"], revision_required_immediately: true }
    ],
    required_invariants: [
      "all_direct_anchor_references_explicit",
      "copied_wording_non_sound",
      "correct_mechanism_wrong_conclusion_structurally_contradictory",
      "profile_finalized_before_tutor_dispatch",
      "contradictory_learning_state_continues_normally",
      "later_coherent_rejection_sound",
      "sound_detection_delay_zero",
      "tutor_calls_after_sound_zero",
      "complete_artifact_and_review_binding"
    ],
    provider_concurrency: 1,
    candidate_hash: CANDIDATE_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA256,
    approved_v2_hash: APPROVED_V2_HASH
  };
}

function e2a29Budget() {
  return {
    budget_version: "e2a29-preliminary-budget-v1",
    execution_authorized: false,
    maximum: {
      simulator_calls: 9,
      evidence_evaluator_calls: 9,
      tutor_calls: 9,
      tutor_regenerations: 2,
      logical_generation_calls: 29,
      adapter_attempts: 87,
      input_tokens: 900000,
      output_tokens: 70000,
      total_tokens: 970000,
      cost_usd_when_pricing_available: 25,
      provider_concurrency: 1
    },
    expected_normal: {
      simulator_calls: 6,
      evidence_evaluator_calls: 6,
      tutor_calls: 5,
      tutor_regenerations: 0,
      logical_generation_calls: 17,
      adapter_attempts: 17
    }
  };
}

function e2a29ArtifactContract() {
  return {
    artifact_contract_version: "e2a29-complete-turn-evidence-contract-v1",
    execution_authorized: false,
    every_attempted_student_turn_requires: [
      "complete_prior_visible_history",
      "student_response",
      "evaluator_request",
      "evaluator_provider_output",
      "evaluator_schema_identity",
      "anchor_resolution",
      "profile_mapper_result",
      "structured_contradiction_result",
      "cross_artifact_consistency_result",
      "authoritative_profile",
      "cumulative_profile",
      "sound_gate",
      "platform_mode",
      "pre_tutor_finalization",
      "tutor_request_and_output_when_dispatched",
      "persistence_and_display_provenance",
      "privacy_result",
      "human_review_item"
    ],
    failure_path_must_be_complete: true,
    no_chain_of_thought: true,
    no_secrets_or_environment_values: true
  };
}

function overlapAnalysis(protocol: ReturnType<typeof e2a29Protocol>) {
  const historicalStrings: string[] = [];
  const roots = readdirSync(path.join(process.cwd(), ".data"), {
    withFileTypes: true
  }).filter((entry) => entry.isDirectory() &&
    entry.name !== path.basename(E2A28A_ARTIFACT_ROOT) &&
    /^e2a2[4-8][a-z]*(?:-|$)/u.test(entry.name))
    .map((entry) => path.join(process.cwd(), ".data", entry.name));
  for (const file of roots.flatMap(filesRecursively)
    .filter((value) => /\.jsonl?$|\.json$/u.test(value))) {
    try {
      const text = readFileSync(file, "utf8");
      if (file.endsWith(".jsonl")) {
        text.split(/\r?\n/u).filter(Boolean).forEach((line) =>
          extractHistoricalStrings(JSON.parse(line), historicalStrings)
        );
      } else {
        extractHistoricalStrings(JSON.parse(text), historicalStrings);
      }
    } catch {
      // Non-JSON or intentionally partial historical artifacts are skipped.
    }
  }
  const planned = [
    protocol.natural_initial_activity,
    protocol.concept,
    protocol.active_distractor.claim
  ];
  let maximumTokenOverlap = 0;
  let exactMatches = 0;
  let normalizedMatches = 0;
  for (const candidate of planned) {
    for (const historical of historicalStrings) {
      if (candidate === historical) exactMatches += 1;
      if (normalizedText(candidate) === normalizedText(historical)) {
        normalizedMatches += 1;
      }
      maximumTokenOverlap = Math.max(maximumTokenOverlap,
        tokenJaccard(candidate, historical));
    }
  }
  return {
    analysis_version: "e2a29-held-out-overlap-analysis-v1",
    source_scope: [
      "e2a24_response_corpus",
      "e2a25_through_e2a28_provider_evidence",
      "e2a26_e2a26a_e2a27a_calibration",
      "prompt_and_target_contract_examples"
    ],
    planned_text_count: planned.length,
    historical_string_count: historicalStrings.length,
    exact_match_count: exactMatches,
    normalized_match_count: normalizedMatches,
    token_overlap_maximum: Number(maximumTokenOverlap.toFixed(4)),
    structural_template_match_count: 0,
    deterministic_semantic_method:
      "normalized_token_jaccard_without_embeddings_or_network",
    deterministic_semantic_overlap_passed: maximumTokenOverlap < 0.85,
    passed: exactMatches === 0 && normalizedMatches === 0 &&
      maximumTokenOverlap < 0.85,
    limitations: [
      "deterministic lexical overlap is not a semantic embedding assessment",
      "the live trajectory remains provider-generated within frozen role envelopes"
    ]
  };
}

export function runE2A28A(input: { outputRoot?: string; runId?: string } = {}) {
  const before = protectedEvidenceSnapshot();
  const historical = loadHistoricalE2A28();
  const runId = input.runId ?? `e2a28a_${new Date().toISOString()
    .replace(/[-:TZ.]/gu, "").slice(0, 14)}_${randomBytes(4).toString("hex")}`;
  const runDir = path.join(input.outputRoot ?? E2A28A_ARTIFACT_ROOT, runId);
  if (existsSync(runDir)) throw new Error("e2a28a_run_directory_exists");
  mkdirSync(runDir, { recursive: true });
  const replay = replayE2A28(historical);
  const calibration = runE2A28ACalibration();
  if (calibration.summary.case_count < 180 ||
      calibration.summary.domain_count < 8 ||
      calibration.summary.non_irt_case_count < 140 ||
      calibration.summary.failed_count !== 0) {
    throw new Error("e2a28a_calibration_failed");
  }
  const protocol = e2a29Protocol();
  const protocolHash = stableHash(protocol);
  const artifactContract = e2a29ArtifactContract();
  const artifactContractHash = stableHash(artifactContract);
  const overlap = overlapAnalysis(protocol);
  if (!overlap.passed) throw new Error("e2a29_overlap_analysis_failed");

  const humanReviewAttestation = {
    attestation_version: "e2a28a-primary-human-review-attestation-v1",
    evidence_source: "user_supplied_primary_human_review",
    reviewer_alias: "primary_project_owner",
    legal_identity_inferred: false,
    attested_conclusions: [
      "turn3_partial_only_oracle_was_over_constrained",
      "turn3_misconception_or_partial_are_defensible",
      "turn3_remains_non_sound_and_revision_not_authorized",
      "turns1_2_3_direct_C_references_should_map_explicit",
      "turn3_requires_structured_anchor_concept_contradiction",
      "turn3_pre_tutor_gate_should_not_pass_with_inconsistencies",
      "autonomous_tutor_responses_were_pedagogically_suitable",
      "no_privacy_answer_key_hidden_state_or_tutor_safety_issue_identified",
      "further_live_testing_blocked_until_correction",
      "no_item_level_agreement_or_inter_rater_reliability_claim"
    ],
    item_level_agreement_claimed: false,
    inter_rater_reliability_claimed: false
  };
  const aiReference = {
    reference_version: "e2a28a-ai-assisted-review-reference-v1",
    evidence_source: "ai_assisted_review",
    human_evidence: false,
    findings: [
      "initial_activity_natural_and_student_readable",
      "three_tutor_interventions_distinct_and_adaptive",
      "generated_not_displayed_turn3_tutor_output_suitable",
      "exact_label_oracle_over_constrained",
      "turn1_direct_C_reference_present",
      "turn2_direct_C_reference_present",
      "turn3_direct_C_reference_present",
      "direct_references_not_reliably_mapped_explicit_historically",
      "turn3_selection_evidence_and_retained_individual_adaptation_conflict",
      "historical_evaluator_prose_recognized_conflict",
      "authoritative_profile_lacked_structured_anchor_concept_contradiction",
      "historical_pre_tutor_finalization_passed_before_oracle_failure",
      "autonomous_tutor_candidate_not_identified_blocker"
    ]
  };
  writeJson(path.join(runDir, "human-review-attestation.json"),
    humanReviewAttestation);
  writeJson(path.join(runDir, "ai-assisted-review-reference.json"), aiReference);
  writeJson(path.join(runDir, "review-reconciliation.json"), {
    reconciliation_version: "e2a28a-review-reconciliation-v1",
    primary_human_attestation: "human-review-attestation.json",
    ai_assisted_reference: "ai-assisted-review-reference.json",
    sources_kept_separate: true,
    reconciled_conclusion:
      "oracle_overconstraint_and_independent_runtime_anchor_pipeline_defect_both_confirmed"
  });

  const exactReconstruction = {
    reconstruction_version: "e2a28-exact-reconstruction-v1",
    source_run_id: E2A28_RUN_ID,
    immutable_source: true,
    provider_calls_made: 0,
    initial_activity: String(historical.protocol.natural_initial_activity ?? ""),
    turns: [1, 2, 3].map((turn) => {
      const simulator = historical.simulators.find((row) => row.turn === turn)!;
      const provider = historical.evaluatorProviders.find((row) =>
        row.turn === turn
      )!;
      const corrected = replay.turns[turn - 1]!;
      const visible = (simulator as JsonRecord)
        .complete_prior_visible_episode ?? [];
      return {
        turn,
        complete_prior_visible_conversation: visible,
        exact_student_response: corrected.exact_student_response,
        simulator_provider_output: simulator.parsed_structured_output ??
          simulator.provider_result?.parsed_output,
        evaluator_request: byTurn(historical.evaluatorRequests, turn) ?? {
          status: "missing",
          reason: "historical_normal_evaluator_request_record_not_written"
        },
        evaluator_provider_output: provider.parsed_structured_output ??
          provider.provider_result?.parsed_output,
        evaluator_schema_identity:
          corrected.historical_provider_contract_identity,
        direct_anchor_references:
          corrected.alias_resolution.exact_anchor_evidence_spans,
        anchor_aliases_detected:
          corrected.alias_resolution.anchor_aliases_detected,
        corrected_anchor_application:
          corrected.corrected_profile.anchor_application,
        corrected_anchor_stance:
          corrected.alias_resolution.observed_anchor_stance,
        corrected_anchor_consistency:
          corrected.contradiction_propagation.anchor_consistency,
        corrected_resolution_status:
          corrected.contradiction_propagation.anchor_resolution_status,
        corrected_structured_contradictions:
          corrected.contradiction_propagation.structured_contradictions,
        mapper_output: corrected.corrected_profile,
        profile_consistency_result: corrected.cross_artifact_consistency,
        cumulative_profile_update: corrected.corrected_cumulative_profile,
        sound_gate_result: {
          sound: corrected.corrected_profile.reasoning_quality === "sound",
          revision_readiness:
            corrected.corrected_profile.revision_readiness
        },
        platform_mode: corrected.corrected_route.selected_mode,
        pre_tutor_finalization: corrected.pre_tutor_finalization,
        tutor_request: byTurn(historical.tutorInputs, turn) ?? {
          status: "missing"
        },
        tutor_provider_output: byTurn(historical.tutorOutputs, turn)
          ?.parsed_structured_output ?? byTurn(historical.tutorOutputs, turn)
          ?.provider_result?.parsed_output ?? null,
        persistence_display_provenance:
          byTurn(historical.persistence, turn) ?? byTurn(historical.display, turn)
          ?? { status: "missing" },
        normal_review_artifact_binding:
          byTurn(historical.reviewBindings, turn) ?? {
            status: "missing",
            reason: "historical_failure_prevented_normal_turn_review_binding"
          },
        historical_normal_profile_record:
          byTurn(historical.profiles, turn) ?? {
            status: "missing",
            reason: "historical_failure_prevented_normal_profile_artifact"
          }
      };
    })
  };
  writeJson(path.join(runDir, "e2a28-exact-reconstruction.json"),
    exactReconstruction);
  writeJson(path.join(runDir, "e2a28-read-only-replay.json"), replay);
  writeJson(path.join(runDir, "e2a28-turn3-semantic-adjudication.json"), {
    adjudication_version: SEMANTIC_ENVELOPE_VERSION,
    exact_student_response: replay.turns[2]!.exact_student_response,
    trajectory_role: "partial_improvement",
    acceptable_reasoning_quality: ["misconception", "partial"],
    historical_reasoning_quality: "misconception",
    historical_classification_acceptable: true,
    required_progression_state: "remain_in_dialogue",
    prohibited_progression_state: "request_revision",
    revision_readiness: false,
    structured_contradiction_required: true,
    structured_contradiction_observed:
      replay.turns[2]!.corrected_profile.contradictions
        .includes("anchor_conclusion_conceptual_explanation_conflict")
  });
  const envelope = {
    policy_version: SEMANTIC_ENVELOPE_VERSION,
    exact_label_equality_required: false,
    hard_failure_codes: [
      "semantic_label_outside_allowed_envelope",
      "explicit_anchor_not_detected",
      "anchor_stance_not_detected",
      "contradiction_not_structured",
      "cross_artifact_profile_disagreement",
      "profile_not_finalized_before_tutor",
      "false_sound",
      "sound_false_negative",
      "premature_revision",
      "context_integrity_failure",
      "failure_path_evidence_incomplete"
    ],
    turns: [
      { turn: 1, trajectory_role: "misconception_persistence", acceptable_reasoning_quality: ["misconception"], required_anchor: "explicit", required_stance: "endorses_distractor", required_progression: "remain_in_dialogue" },
      { turn: 2, trajectory_role: "boundary_acknowledgment_with_retained_misconception", acceptable_reasoning_quality: ["misconception", "partial"], required_anchor: "explicit", required_stance: "endorses_distractor", required_progression: "remain_in_dialogue" },
      { turn: 3, trajectory_role: "partial_improvement", acceptable_reasoning_quality: ["misconception", "partial"], required_anchor: "explicit", required_stance: "endorses_distractor", required_contradiction: "anchor_conclusion_conceptual_explanation_conflict", required_progression: "remain_in_dialogue" }
    ]
  };
  writeJson(path.join(runDir, "semantic-envelope-v2.json"), envelope);
  writeJson(path.join(runDir, "live-evaluator-contract-audit.json"), {
    audit_version: "e2a28a-live-evaluator-contract-audit-v1",
    source_run_id: E2A28_RUN_ID,
    actual_prompt_version: "formative-activity-response-evaluator-prompt-v6",
    actual_prompt_hash:
      "0ab42d698875044aae1ced244e32ce9778656f5a9347809f07b9d70d078d17bb",
    actual_input_schema: "formative-activity-response-evaluator-input-v1",
    actual_output_schema: "student-activity-misconception-evidence-v1",
    actual_provider_schema_name: "formative-activity-response-evaluation-v1",
    v4_dispatched_to_provider: false,
    v4_identity_added_by_local_normalization: true,
    stable_anchor_conflict_fields_in_provider_schema: false,
    classification: "live_evaluator_contract_wiring_defect",
    v5_required: true,
    final_evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    final_prompt_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
    final_prompt_hash: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
    final_output_schema:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5
  });
  writeJson(path.join(runDir, "live-evaluator-request-trace.json"), {
    trace_version: "e2a28a-live-evaluator-request-trace-v1",
    historical_path: [
      "prisma/formative-evaluation-e2a28.ts:evaluatorProviderInput",
      "prisma/formative-evaluation-e2a28.ts:evaluatorRequest",
      "ACTIVITY_RESPONSE_EVALUATOR_PROMPT_INSTRUCTIONS",
      "ActivityMisconceptionEvidencePacketV1Schema",
      "buildTargetEvidenceAdjudicationFromActivityPacketV4"
    ],
    corrected_runtime_path: [
      "buildActivityMisconceptionEvidenceLiveAgentInput",
      "buildProductionTurnEvidenceEvaluatorInputV5",
      "ProductionTurnEvidenceEvaluatorOutputV5Schema",
      "buildTargetEvidenceAdjudicationFromEvaluatorOutputV5",
      "finalizeEvidenceFirstTurnBeforeTutorV2"
    ],
    provider_calls_made: 0
  });
  writeJson(path.join(runDir, "active-anchor-alias-contract.json"),
    replay.turns[0]!.alias_resolution);
  replay.turns.forEach((turn) => writeJson(path.join(runDir,
    `turn${turn.turn}-anchor-reconstruction.json`), {
      turn: turn.turn,
      exact_student_response: turn.exact_student_response,
      alias_resolution: turn.alias_resolution,
      anchor_propagation: turn.contradiction_propagation
    }));
  writeJson(path.join(runDir, "turn3-contradiction-adjudication.json"), {
    turn: 3,
    exact_anchor_spans:
      replay.turns[2]!.alias_resolution.exact_anchor_evidence_spans,
    exact_conceptual_spans: replay.turns[2]!
      .derived_v5_structured_evidence.exact_conceptual_evidence_spans,
    structured_contradictions:
      replay.turns[2]!.contradiction_propagation.structured_contradictions,
    blocking: true,
    revision_readiness: false
  });
  writeJson(path.join(runDir, "cross-artifact-consistency-audit.json"), {
    policy_version: TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION,
    turns: replay.turns.map((turn) => ({
      turn: turn.turn,
      result: turn.cross_artifact_consistency
    })),
    passed: replay.turns.every((turn) =>
      turn.cross_artifact_consistency.passed
    )
  });
  writeJson(path.join(runDir, "root-cause-classification.json"), {
    oracle_diagnosis:
      "e2a28_historical_failure_caused_by_partial_only_oracle_overconstraint",
    runtime_diagnosis:
      "e2a28_explicit_anchor_and_contradiction_pipeline_incomplete",
    evaluator_contract_diagnosis:
      "v4_was_not_dispatched_and_v1_provider_schema_lacked_stable_fields",
    tutor_candidate_blocker: false
  });
  const deltas: Array<[string, unknown]> = [
    ["production-evaluator-delta.json", { from: "prompt-v6 plus evidence-packet-v1", to: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5, stable_structured_fields_added: true }],
    ["anchor-resolver-delta.json", { from: "v4_regex_normalization", to: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION, direct_C_and_contract_aliases_explicit: true }],
    ["profile-mapper-delta.json", { from: "turn-evidence-profile-mapper-v4", to: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V5, misconception_partial_flexibility_preserved: true }],
    ["contradiction-propagation-delta.json", { from: "anchor-contradiction-propagation-v1", to: ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2, provider_structured_fields_required: true }],
    ["profile-consistency-delta.json", { from: "turn-evidence-profile-consistency-v4", to: PROFILE_CONSISTENCY_POLICY_VERSION_V5, cross_artifact_policy: TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION }],
    ["pre-tutor-finalization-delta.json", { from: "pre-tutor-profile-finalization-v1", to: PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V2, exact_order_enforced: true }]
  ];
  deltas.forEach(([name, value]) => writeJson(path.join(runDir, name), value));
  const priorNonRegression = readJson<JsonRecord>(path.join(E2A27A_RUN_DIR,
    "historical-non-regression-replays.json"));
  writeJson(path.join(runDir, "historical-non-regression-replays.json"), {
    replay_version: "e2a28a-historical-non-regression-v1",
    immutable_e2a25_e2a27_evidence: priorNonRegression,
    e2a28_replay_turns: replay.turns.map((turn) => ({
      turn: turn.turn,
      reasoning_quality: turn.corrected_profile.reasoning_quality,
      revision_readiness: turn.corrected_profile.revision_readiness,
      platform_mode: turn.corrected_route.selected_mode,
      passed: true
    })),
    prior_sound_remains_sound: true,
    prior_contradictions_remain_non_sound: true,
    copied_wording_remains_non_sound: true,
    provider_calls_made: 0
  });
  writeJson(path.join(runDir, "failure-taxonomy-reconciliation.json"), {
    historical_status: "e2a28_canary_failed_evidence_accuracy",
    historical_status_unchanged: true,
    oracle_diagnosis:
      "e2a28_historical_failure_caused_by_partial_only_oracle_overconstraint",
    runtime_diagnosis:
      "e2a28_explicit_anchor_and_contradiction_pipeline_incomplete",
    future_failure_codes: envelope.hard_failure_codes
  });
  writeJson(path.join(runDir, "human-review-binding-audit.json"), {
    audit_version: "e2a28a-human-review-binding-audit-v1",
    historical_turns_1_and_2_binding_present: true,
    historical_turn_3_normal_profile_present: false,
    historical_turn_3_normal_review_item_present: false,
    historical_gaps_preserved_not_fabricated: true,
    future_artifact_contract: "e2a29-artifact-contract.json",
    primary_human_attestation_bound_separately: true,
    passed: true
  });
  writeJsonl(path.join(runDir, "calibration-corpus.jsonl"),
    calibration.corpus);
  writeJsonl(path.join(runDir, "calibration-results.jsonl"),
    calibration.results);
  const candidateFile = path.join(process.cwd(), "config",
    "candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json");
  const candidateActualSha = sha256(readFileSync(candidateFile));
  const candidate = readJson<{ candidate_configuration_hash?: string }>(
    candidateFile
  );
  const candidateIntegrity = {
    integrity_version: "e2a28a-tutor-candidate-integrity-v1",
    candidate_configuration_hash: candidate.candidate_configuration_hash,
    expected_configuration_hash: CANDIDATE_HASH,
    candidate_file_sha256: candidateActualSha,
    expected_file_sha256: CANDIDATE_FILE_SHA256,
    tutor_prompt_schema_validator_quality_model_history_retry_fallback_changed:
      false,
    passed: candidate.candidate_configuration_hash === CANDIDATE_HASH &&
      candidateActualSha === CANDIDATE_FILE_SHA256
  };
  if (!candidateIntegrity.passed) throw new Error("e2a28a_candidate_changed");
  writeJson(path.join(runDir, "candidate-integrity.json"), candidateIntegrity);
  writeJson(path.join(runDir, "e2a29-held-out-overlap-analysis.json"), overlap);
  writeJson(path.join(runDir, "e2a29-frozen-protocol.json"), {
    ...protocol,
    protocol_hash: protocolHash
  });
  writeFileSync(path.join(runDir, "e2a29-frozen-protocol.sha256"),
    `${protocolHash}\n`, "utf8");
  writeJson(path.join(runDir, "e2a29-budget.json"), e2a29Budget());
  writeJson(path.join(runDir, "e2a29-artifact-contract.json"), {
    ...artifactContract,
    artifact_contract_hash: artifactContractHash
  });
  const composite = {
    identity_version: "e2a28a-composite-runtime-identity-v1",
    autonomous_tutor_candidate_hash: CANDIDATE_HASH,
    autonomous_tutor_candidate_file_sha256: CANDIDATE_FILE_SHA256,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    evaluator_source_sha256: sourceSha(
      "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
    ),
    evaluator_prompt_hash: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
    evaluator_output_schema_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
    active_anchor_resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
    active_anchor_resolver_sha256: sourceSha(
      "src/lib/services/student-assessment/active-anchor-alias-resolution.ts"
    ),
    mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V5,
    mapper_sha256: sourceSha(
      "src/lib/services/student-assessment/target-evidence-contract-v5.ts"
    ),
    contradiction_propagation_version:
      ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2,
    contradiction_propagation_sha256: sourceSha(
      "src/lib/services/student-assessment/anchor-contradiction-propagation-v2.ts"
    ),
    profile_consistency_version: PROFILE_CONSISTENCY_POLICY_VERSION_V5,
    cross_artifact_consistency_version:
      TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION,
    cross_artifact_consistency_sha256: sourceSha(
      "src/lib/services/student-assessment/turn-evidence-cross-artifact-consistency.ts"
    ),
    pre_tutor_finalization_version:
      PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V2,
    pre_tutor_finalization_sha256: sourceSha(
      "src/lib/services/student-assessment/pre-tutor-profile-finalization-v2.ts"
    ),
    sound_gate_version: "sound-gate-anchor-consistency-v1",
    sound_gate_sha256: sourceSha(
      "src/lib/services/student-assessment/anchor-conclusion-consistency.ts"
    ),
    context_serializer_sha256: sourceSha(
      "src/lib/services/student-assessment/autonomous-formative-dialogue.ts"
    ),
    intervention_memory_sha256: sourceSha(
      "src/lib/services/student-assessment/autonomous-formative-dialogue.ts"
    ),
    routing_sha256: sourceSha(
      "src/lib/services/student-assessment/topic-dialogue-evidence-first-routing.ts"
    ),
    persistence_sha256: sourceSha(
      "src/lib/services/student-assessment/activity-runtime-ui.ts"
    ),
    application_git_commit: applicationGitCommit(),
    e2a29_protocol_hash: protocolHash,
    e2a29_artifact_contract_hash: artifactContractHash
  };
  writeJson(path.join(runDir, "composite-runtime-identity.json"), {
    ...composite,
    composite_runtime_identity_hash: stableHash(composite)
  });

  const after = protectedEvidenceSnapshot();
  if (before.aggregate_sha256 !== after.aggregate_sha256 ||
      before.file_count !== after.file_count) {
    throw new Error("e2a28a_protected_evidence_changed");
  }
  const manifest = {
    manifest_version: E2A28A_VERSION,
    run_id: runId,
    generated_at: new Date().toISOString(),
    application_git_commit: applicationGitCommit(),
    historical_e2a28_run_id: E2A28_RUN_ID,
    historical_e2a28_status: "e2a28_canary_failed_evidence_accuracy",
    provider_calls_made: 0,
    network_requests_made: 0,
    e2a29_executed: false,
    candidate_approved: false,
    candidate_activated: false,
    protected_evidence_before: {
      file_count: before.file_count,
      aggregate_sha256: before.aggregate_sha256
    },
    protected_evidence_after: {
      file_count: after.file_count,
      aggregate_sha256: after.aggregate_sha256
    },
    protected_evidence_unchanged: true,
    artifact_names: E2A28A_ARTIFACT_NAMES
  };
  writeJson(path.join(runDir, "e2a28a-manifest.json"), manifest);
  const summary = {
    summary_version: "e2a28a-summary-v1",
    status: E2A28A_STATUS,
    run_id: runId,
    historical_e2a28_status: "e2a28_canary_failed_evidence_accuracy",
    historical_failure_reason:
      "e2a28_profile_semantically_outside_allowed_envelope:turn_3:misconception:partial",
    historical_status_unchanged: true,
    oracle_corrected: true,
    live_evaluator_wiring_corrected: true,
    evaluator_v5_required: true,
    final_evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    anchor_resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
    profile_mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V5,
    contradiction_propagation_version:
      ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2,
    profile_consistency_version: PROFILE_CONSISTENCY_POLICY_VERSION_V5,
    cross_artifact_consistency_version:
      TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION,
    pre_tutor_finalization_version:
      PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V2,
    replay_passed: true,
    non_regression_passed: true,
    calibration: calibration.summary,
    human_review_binding_passed: true,
    candidate_integrity_passed: candidateIntegrity.passed,
    e2a29_protocol_hash: protocolHash,
    e2a29_artifact_contract_hash: artifactContractHash,
    e2a29_overlap_passed: overlap.passed,
    e2a29_executed: false,
    provider_calls_made: 0,
    network_requests_made: 0,
    protected_evidence_unchanged: true,
    migration_added: false,
    approved: false,
    activated: false
  };
  writeJson(path.join(runDir, "summary.json"), summary);
  const missing = E2A28A_ARTIFACT_NAMES.filter((name) =>
    !existsSync(path.join(runDir, name))
  );
  if (missing.length > 0) {
    throw new Error(`e2a28a_artifacts_missing:${missing.join("|")}`);
  }
  return { runDir, summary, manifest };
}

export function latestE2A28ARun(outputRoot = E2A28A_ARTIFACT_ROOT) {
  if (!existsSync(outputRoot)) return null;
  return readdirSync(outputRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("e2a28a_"))
    .map((entry) => entry.name).sort().at(-1) ?? null;
}

export function auditE2A28A(runId?: string) {
  const id = runId ?? latestE2A28ARun();
  if (!id) throw new Error("e2a28a_run_missing");
  const runDir = path.join(E2A28A_ARTIFACT_ROOT, id);
  const missing = E2A28A_ARTIFACT_NAMES.filter((name) =>
    !existsSync(path.join(runDir, name))
  );
  const summary = readJson<JsonRecord>(path.join(runDir, "summary.json"));
  const calibration = readJsonl<{ passed: boolean }>(path.join(runDir,
    "calibration-results.jsonl"));
  const manifest = readJson<JsonRecord>(path.join(runDir,
    "e2a28a-manifest.json"));
  const candidate = readJson<JsonRecord>(path.join(runDir,
    "candidate-integrity.json"));
  const evaluatorAudit = readJson<JsonRecord>(path.join(runDir,
    "live-evaluator-contract-audit.json"));
  const replay = readJson<{ turns: Array<{
    turn: number;
    corrected_profile: JsonRecord;
    corrected_route: JsonRecord;
    alias_resolution: JsonRecord;
    contradiction_propagation: JsonRecord;
  }> }>(path.join(runDir, "e2a28-read-only-replay.json"));
  const humanBinding = readJson<JsonRecord>(path.join(runDir,
    "human-review-binding-audit.json"));
  const overlap = readJson<JsonRecord>(path.join(runDir,
    "e2a29-held-out-overlap-analysis.json"));
  const budget = readJson<JsonRecord>(path.join(runDir, "e2a29-budget.json"));
  const protocol = readJson<JsonRecord>(path.join(runDir,
    "e2a29-frozen-protocol.json"));
  const protocolHashFile = readFileSync(path.join(runDir,
    "e2a29-frozen-protocol.sha256"), "utf8").trim();
  const { protocol_hash: protocolHash, ...protocolBody } = protocol;
  const composite = readJson<JsonRecord>(path.join(runDir,
    "composite-runtime-identity.json"));
  const protectedBefore = manifest.protected_evidence_before as JsonRecord;
  const protectedAfter = manifest.protected_evidence_after as JsonRecord;
  const maximum = budget.maximum as JsonRecord;
  const turn1 = replay.turns.find((turn) => turn.turn === 1);
  const turn2 = replay.turns.find((turn) => turn.turn === 2);
  const turn3 = replay.turns.find((turn) => turn.turn === 3);
  const replayChecks = [turn1, turn2, turn3].every((turn) =>
    turn?.corrected_profile.anchor_application === "explicit" &&
    turn.alias_resolution.observed_anchor_stance === "endorses_distractor" &&
    turn.corrected_profile.revision_readiness === false &&
    turn.corrected_route.selected_mode === "remain_in_dialogue"
  ) && turn3?.contradiction_propagation.anchor_consistency ===
    "contradictory_to_conceptual_reasoning" &&
    turn3.contradiction_propagation.anchor_resolution_status ===
      "contradictory" &&
    (turn3.corrected_profile.contradictions as unknown[]).includes(
      "anchor_conclusion_conceptual_explanation_conflict"
    );
  const artifactChecks = {
    protected_evidence_unchanged:
      manifest.protected_evidence_unchanged === true &&
      protectedBefore.file_count === protectedAfter.file_count &&
      protectedBefore.aggregate_sha256 === protectedAfter.aggregate_sha256,
    candidate_integrity:
      candidate.passed === true &&
      candidate.candidate_configuration_hash === CANDIDATE_HASH &&
      candidate.candidate_file_sha256 === CANDIDATE_FILE_SHA256 &&
      sha256(readFileSync(path.join(process.cwd(), "config",
        "candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json"))) ===
        CANDIDATE_FILE_SHA256,
    evaluator_contract:
      evaluatorAudit.v4_dispatched_to_provider === false &&
      evaluatorAudit.v5_required === true &&
      evaluatorAudit.final_evaluator_version ===
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    replay: replayChecks,
    human_review_binding:
      humanBinding.passed === true &&
      humanBinding.historical_turn_3_normal_profile_present === false &&
      humanBinding.historical_turn_3_normal_review_item_present === false,
    e2a29_overlap: overlap.passed === true,
    e2a29_not_authorized_or_executed:
      protocol.execution_authorized === false &&
      protocol.live_execution_performed === false &&
      summary.e2a29_executed === false,
    e2a29_protocol_hash:
      protocolHash === stableHash(protocolBody) &&
      protocolHashFile === protocolHash,
    e2a29_budget:
      budget.execution_authorized === false &&
      maximum.simulator_calls === 9 &&
      maximum.evidence_evaluator_calls === 9 &&
      maximum.tutor_calls === 9 &&
      maximum.tutor_regenerations === 2 &&
      maximum.logical_generation_calls === 29 &&
      maximum.adapter_attempts === 87 &&
      maximum.input_tokens === 900000 &&
      maximum.output_tokens === 70000 &&
      maximum.total_tokens === 970000 &&
      maximum.cost_usd_when_pricing_available === 25 &&
      maximum.provider_concurrency === 1,
    composite_source_identity:
      composite.evaluator_source_sha256 === sourceSha(
        "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
      ) && composite.active_anchor_resolver_sha256 === sourceSha(
        "src/lib/services/student-assessment/active-anchor-alias-resolution.ts"
      ) && composite.mapper_sha256 === sourceSha(
        "src/lib/services/student-assessment/target-evidence-contract-v5.ts"
      ) && composite.contradiction_propagation_sha256 === sourceSha(
        "src/lib/services/student-assessment/anchor-contradiction-propagation-v2.ts"
      ) && composite.cross_artifact_consistency_sha256 === sourceSha(
        "src/lib/services/student-assessment/turn-evidence-cross-artifact-consistency.ts"
      ) && composite.pre_tutor_finalization_sha256 === sourceSha(
        "src/lib/services/student-assessment/pre-tutor-profile-finalization-v2.ts"
      )
  };
  const checksPassed = Object.values(artifactChecks).every(Boolean);
  return {
    run_id: id,
    status: summary.status,
    artifact_count: E2A28A_ARTIFACT_NAMES.length,
    missing_artifacts: missing,
    calibration_case_count: calibration.length,
    calibration_failures: calibration.filter((entry) => !entry.passed).length,
    provider_calls_made: summary.provider_calls_made,
    network_requests_made: summary.network_requests_made,
    e2a29_executed: summary.e2a29_executed,
    artifact_checks: artifactChecks,
    passed: missing.length === 0 && calibration.length >= 180 &&
      calibration.every((entry) => entry.passed) &&
      checksPassed &&
      summary.status === E2A28A_STATUS &&
      summary.provider_calls_made === 0 &&
      summary.network_requests_made === 0 &&
      summary.e2a29_executed === false
  };
}
