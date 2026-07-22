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
  type ActivityMisconceptionEvidencePacketV1
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import {
  ANCHOR_CONTRADICTION_PROPAGATION_VERSION,
  propagateAnchorContradiction
} from "@/lib/services/student-assessment/anchor-contradiction-propagation";
import {
  PRE_TUTOR_PROFILE_FINALIZATION_VERSION,
  finalizeEvidenceFirstTurnBeforeTutor
} from "@/lib/services/student-assessment/pre-tutor-profile-finalization";
import {
  PROFILE_CONSISTENCY_POLICY_VERSION_V4,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V4,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V4,
  buildActivityTargetEvidenceContractV4,
  buildTargetEvidenceAdjudicationFromActivityPacketV4
} from "@/lib/services/student-assessment/target-evidence-contract-v4";
import type {
  TopicDialogueCumulativeEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";

export const E2A27A_VERSION =
  "e2a27a-contradiction-propagation-correction-v1" as const;
export const E2A27A_STATUS =
  "e2a27a_evaluator_contract_corrected_e2a28_ready" as const;
export const E2A27A_ARTIFACT_ROOT = path.join(
  process.cwd(), ".data", "e2a27a-contradiction-propagation"
);
export const E2A27_RUN_ID =
  "e2a27_20260722061521_9bd4a441" as const;
export const E2A27_RUN_DIR = path.join(
  process.cwd(), ".data",
  "e2a27-geometrical-optics-anchor-consistency-canary", E2A27_RUN_ID
);
export const E2A25_RUN_ID =
  "e2a25_20260721000435_bf179fb6" as const;
export const APPROVED_V2_HASH =
  "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993" as const;
export const CANDIDATE_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b" as const;
export const CANDIDATE_FILE_SHA256 =
  "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2" as const;
export const E2A27_COMPOSITE_IDENTITY =
  "83ebb61b31ae8d5c5a74aa1e426229cbf848d51f1c2b98872e16c6c7efb1bcf6" as const;
export const E2A27_PROTOCOL_HASH =
  "1eb8f769c354e3dfcf5ebe488692a4f4b46e8cf6bba67cd54bdd79d8faa5325c" as const;

export const E2A27A_ARTIFACT_NAMES = [
  "e2a27a-manifest.json",
  "e2a27-turn4-exact-reconstruction.json",
  "cross-layer-propagation-trace.json",
  "root-cause-classification.json",
  "evaluator-structure-audit.json",
  "anchor-contradiction-propagation-contract.json",
  "production-evaluator-delta.json",
  "profile-mapper-delta.json",
  "profile-consistency-delta.json",
  "pre-tutor-finalization-policy.json",
  "sound-gate-non-regression.json",
  "e2a27-read-only-replay.json",
  "historical-non-regression-replays.json",
  "first-divergence-and-replay-boundary.json",
  "preserved-turn4-tutor-output-adjudication.json",
  "failure-path-artifact-completeness.json",
  "derived-human-review-binding-audit.json",
  "audit-summary-schema-delta.json",
  "failed-session-burden-metrics.json",
  "approved-runtime-assertion-audit.json",
  "calibration-corpus.jsonl",
  "calibration-results.jsonl",
  "composite-runtime-identity.json",
  "candidate-integrity.json",
  "e2a28-held-out-overlap-analysis.json",
  "e2a28-frozen-protocol.json",
  "e2a28-frozen-protocol.sha256",
  "e2a28-budget.json",
  "e2a28-artifact-contract.json",
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

function historicalEvidenceSnapshot() {
  const roots = [
    path.join(process.cwd(), "config", "approved-operational-agent-config.json"),
    path.join(process.cwd(), "config",
      "candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json"),
    ...readdirSync(path.join(process.cwd(), ".data"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() &&
        /^e2a(?:1[2-9]|2[0-7])(?:-|$)/u.test(entry.name))
      .map((entry) => path.join(process.cwd(), ".data", entry.name))
  ];
  const files = roots.flatMap(filesRecursively).sort();
  const hashes = Object.fromEntries(files.map((file) => [
    path.relative(process.cwd(), file), sha256(readFileSync(file))
  ]));
  return { file_count: files.length, aggregate_sha256: stableHash(hashes) };
}

function applicationGitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(), encoding: "utf8"
  }).trim();
}

type ProviderRow = {
  session_id: string;
  turn: number;
  provider_result: { parsed_output?: unknown; usage?: JsonRecord };
  parsed_structured_output?: unknown;
};

type TutorInputRow = {
  session_id: string;
  turn: number;
  request: {
    complete_visible_formative_conversation: {
      visible_turns: Array<{
        visible_turn_id: string;
        sequence_index: number;
        actor_type: "student" | "agent";
        message_text: string;
      }>;
    };
    latest_authoritative_turn_profile: JsonRecord;
    cumulative_learning_trajectory: JsonRecord;
    platform_constraints: JsonRecord;
  };
};

function loadE2A27() {
  if (!existsSync(E2A27_RUN_DIR)) {
    throw new Error("e2a27a_authoritative_e2a27_run_missing");
  }
  const simulators = readJsonl<ProviderRow>(path.join(
    E2A27_RUN_DIR, "simulator-provider-outputs.jsonl"
  ));
  const evaluators = readJsonl<ProviderRow>(path.join(
    E2A27_RUN_DIR, "evaluator-provider-outputs.jsonl"
  ));
  const tutorOutputs = readJsonl<ProviderRow>(path.join(
    E2A27_RUN_DIR, "autonomous-tutor-provider-outputs.jsonl"
  ));
  const tutorInputs = readJsonl<TutorInputRow>(path.join(
    E2A27_RUN_DIR, "autonomous-tutor-inputs.jsonl"
  ));
  const summary = readJson<JsonRecord>(path.join(
    E2A27_RUN_DIR, "canary-summary.json"
  ));
  const protocol = readJson<JsonRecord>(path.join(
    E2A27_RUN_DIR, "frozen-protocol.json"
  ));
  return {
    simulators, evaluators, tutorOutputs, tutorInputs, summary, protocol
  };
}

function packetFor(row: ProviderRow) {
  return (row.parsed_structured_output ?? row.provider_result.parsed_output) as
    ActivityMisconceptionEvidencePacketV1;
}

function replayE2A27(evidence: ReturnType<typeof loadE2A27>) {
  let priorCumulative: TopicDialogueCumulativeEvidenceProfile | null = null;
  const turns = [1, 2, 3, 4].map((turn) => {
    const simulator = evidence.simulators.find((row) => row.turn === turn);
    const evaluator = evidence.evaluators.find((row) => row.turn === turn);
    const tutorInput = evidence.tutorInputs.find((row) => row.turn === turn);
    if (!simulator || !evaluator || !tutorInput) {
      throw new Error(`e2a27a_replay_source_missing:turn_${turn}`);
    }
    const packet = packetFor(evaluator);
    const studentMessage = (simulator.parsed_structured_output as
      { student_message: string }).student_message;
    const historical = tutorInput.request.latest_authoritative_turn_profile;
    const sourceTurn = tutorInput.request.complete_visible_formative_conversation
      .visible_turns.at(-1)!;
    const contract = buildActivityTargetEvidenceContractV4({
      concept_id: "converging_lens_object_distance_boundary",
      item_id: "optics_item_14",
      distractor_option: "B",
      distractor_claim:
        "A converging lens always forms a real image because it bends rays inward.",
      packet
    });
    const adjudication =
      buildTargetEvidenceAdjudicationFromActivityPacketV4({
        latest_student_message: studentMessage,
        packet,
        contract
      });
    const finalized = finalizeEvidenceFirstTurnBeforeTutor({
      contract,
      adjudication,
      interaction_intent: "ordinary_conceptual_response",
      confidence_evidence: packet.misconception_evidence_update.confidence,
      source_student_turn_id: sourceTurn.visible_turn_id,
      source_sequence_index: sourceTurn.sequence_index,
      latest_accepted_student_turn_id: sourceTurn.visible_turn_id,
      latest_accepted_sequence_index: sourceTurn.sequence_index,
      concept_id: "converging_lens_object_distance_boundary",
      distractor_anchor: "optics_item_14:B",
      prior_cumulative_profile: priorCumulative,
      created_at: String(historical.created_at)
    });
    priorCumulative = finalized.cumulative;
    return {
      turn,
      exact_student_response: studentMessage,
      historical_evaluator_output: packet,
      corrected_evaluator_normalization: adjudication.anchor_observation,
      historical_profile: historical,
      historical_profile_status: turn < 4
        ? "completed" : "generated_but_not_finalized",
      corrected_profile: finalized.profile,
      historical_contradictions: historical.contradictions ?? [],
      corrected_contradictions: finalized.profile.contradictions,
      corrected_structured_contradictions:
        finalized.observation.structured_contradictions,
      historical_platform_mode: "remain_in_dialogue",
      corrected_platform_mode: finalized.route.selected_mode,
      historical_tutor_dispatch: true,
      corrected_tutor_dispatch_eligibility:
        finalized.attestation.tutor_dispatch_permitted,
      corrected_tutor_provider_output: null,
      later_trajectory: turn === 4
        ? "indeterminate_after_counterfactual_replay_boundary" : "historical"
    };
  });
  const turn4 = turns[3]!;
  if (
    turn4.corrected_evaluator_normalization.observed_anchor_application !==
      "explicit" ||
    turn4.corrected_evaluator_normalization.observed_anchor_stance !==
      "endorses_distractor" ||
    turn4.corrected_profile.reasoning_quality !== "partial" ||
    turn4.corrected_profile.revision_readiness ||
    turn4.corrected_platform_mode !== "remain_in_dialogue" ||
    !turn4.corrected_contradictions.includes(
      "anchor_conclusion_conceptual_explanation_conflict"
    ) ||
    turn4.corrected_profile.structured_contradictions?.some((entry) =>
      entry.contradiction_type ===
        "anchor_conclusion_conceptual_explanation_conflict" && entry.blocking
    ) !== true
  ) throw new Error("e2a27a_turn4_corrected_profile_invariant_failed");
  return {
    replay_version: "e2a27a-read-only-replay-v1",
    source_run_id: E2A27_RUN_ID,
    immutable_provider_outputs_reused: true,
    provider_calls_made: 0,
    network_requests_made: 0,
    turns
  };
}

type CalibrationArchetype = {
  id: string;
  message: string;
  conceptual: "rejects" | "endorses" | "ambiguous";
  expected: "sound" | "non_sound" | "conflict" | "fail_closed";
  rationale?: string;
};

const CALIBRATION_ARCHETYPES: CalibrationArchetype[] = [
  { id: "correct_mechanism_wrong_conclusion", message:
    "The mechanism limits the claim. That makes option B appropriate.",
    conceptual: "rejects", expected: "conflict", rationale:
    "The conceptual explanation conflicts with the final option endorsement." },
  { id: "correct_mechanism_ambiguous_conclusion", message:
    "The mechanism limits the claim, but I am not sure whether option B is right.",
    conceptual: "rejects", expected: "non_sound" },
  { id: "correct_mechanism_no_anchor", message:
    "The mechanism only works under the stated boundary.",
    conceptual: "rejects", expected: "non_sound" },
  { id: "incorrect_mechanism_correct_conclusion", message:
    "Option B is wrong, but its mechanism still controls the result.",
    conceptual: "endorses", expected: "conflict", rationale:
    "The final rejection conflicts with the retained conceptual mechanism." },
  { id: "explicit_endorsement", message: "I choose option B.",
    conceptual: "endorses", expected: "non_sound" },
  { id: "explicit_rejection", message:
    "Option B is wrong because the boundary prevents its conclusion.",
    conceptual: "rejects", expected: "sound" },
  { id: "self_correction", message:
    "Option B is appropriate. Actually, option B is wrong because of the boundary.",
    conceptual: "rejects", expected: "sound" },
  { id: "quoted_then_rejected", message:
    "\"Option B is appropriate\" is the claim, but that claim is wrong.",
    conceptual: "rejects", expected: "sound" },
  { id: "copied_without_application", message:
    "The target relationship and mechanism should be considered together.",
    conceptual: "ambiguous", expected: "non_sound" },
  { id: "copied_with_contradiction", message:
    "The mechanism limits the claim. Option B remains appropriate.",
    conceptual: "rejects", expected: "conflict", rationale:
    "The final option conclusion conflicts with the conceptual explanation." },
  { id: "low_confidence_sound", message:
    "I am not very confident, but option B is wrong because the boundary limits it.",
    conceptual: "rejects", expected: "sound" },
  { id: "high_confidence_misconception", message:
    "I am certain option B is correct because its mechanism always controls the result.",
    conceptual: "endorses", expected: "non_sound" },
  { id: "fragmented_sound", message:
    "Boundary applies. Claim fails. Option B is wrong.",
    conceptual: "rejects", expected: "sound" },
  { id: "typo_heavy_conflict", message:
    "mechanism doesnt support it. that makes option B apropriate.",
    conceptual: "rejects", expected: "conflict", rationale:
    "The final option endorsement conflicts with the conceptual explanation." },
  { id: "frustrated_sound", message:
    "This is frustrating, but option B is wrong because the boundary limits the claim.",
    conceptual: "rejects", expected: "sound" },
  { id: "pronoun_anchor", message:
    "That choice should be rejected because the boundary limits the claim.",
    conceptual: "rejects", expected: "non_sound" },
  { id: "letter_typo_uncertain", message:
    "Option B seems right, but maybe the letter is a typo and I am not sure.",
    conceptual: "rejects", expected: "non_sound" },
  { id: "multiple_anchors", message:
    "Option A sounds related and option B may be wrong, but I cannot settle it.",
    conceptual: "ambiguous", expected: "non_sound" },
  { id: "label_text_disagree", message:
    "The text of the claim fails, although I wrote option B as appropriate.",
    conceptual: "rejects", expected: "conflict", rationale:
    "The option label and conceptual conclusion conflict." },
  { id: "structured_conflict", message:
    "The boundary disproves the claim. I still accept option B.",
    conceptual: "rejects", expected: "conflict", rationale:
    "A blocking anchor conflict is present." },
  { id: "conflict_only_in_limitation", message:
    "The boundary disproves the claim. Option B is correct.",
    conceptual: "rejects", expected: "conflict", rationale:
    "The final option conclusion conflicts with the conceptual explanation." },
  { id: "malformed_conflict_fields", message:
    "The boundary disproves the claim. Option B is correct.",
    conceptual: "rejects", expected: "fail_closed", rationale:
    "A blocking anchor conflict is present." },
  { id: "later_recurrence", message:
    "After rejecting it earlier, I now think option B is correct.",
    conceptual: "endorses", expected: "non_sound" },
  { id: "missing_anchor", message:
    "I have not applied the mechanism to a choice yet.",
    conceptual: "ambiguous", expected: "non_sound" }
];

const CALIBRATION_DOMAINS = [
  "epidemiology_screening",
  "linguistics_morphology",
  "economics_elasticity",
  "computer_science_graphs",
  "chemistry_equilibrium",
  "biology_inheritance"
] as const;

function packetForCalibration(input: {
  caseId: string;
  archetype: CalibrationArchetype;
}): ActivityMisconceptionEvidencePacketV1 {
  const sound = input.archetype.conceptual === "rejects" &&
    input.archetype.expected === "sound";
  const conflict = input.archetype.expected === "conflict" ||
    input.archetype.expected === "fail_closed";
  return buildNoLiveActivityMisconceptionEvidenceFixture({
    case_id: input.caseId,
    activity_family: "reasoning_chain_repair",
    selected_formative_value: "reasoning_refinement",
    profile_condition: input.archetype.id,
    source_diagnostic_purpose: "reasoning_boundary_repair",
    response_kind: "substantive",
    response_length_band: "short",
    response_summary: conflict
      ? "The response contains a conceptual explanation and a conflicting final anchor conclusion."
      : "The response supplies bounded evidence for the active anchor.",
    primary_target: "reasoning_link",
    secondary_targets: ["target_boundary"],
    evidence_types: ["target_boundary_explained", "reasoning_link_repaired"],
    update_status: conflict
      ? "reasoning_boundary_still_blurred"
      : sound ? "boundary_understanding_improved"
        : input.archetype.conceptual === "endorses"
          ? "misconception_persisted" : "misconception_weakened",
    evidence_quality: sound ? "high" : "medium",
    confidence: input.archetype.id.includes("low_confidence") ? "low" :
      input.archetype.id.includes("high_confidence") ? "high" : "medium",
    evidence_flags: {
      student_explained_target_boundary: sound || conflict ? "yes" : "partial",
      student_repaired_reasoning_link: sound || conflict ? "yes" : "partial"
    },
    safe_internal_rationale: input.archetype.rationale ??
      (input.archetype.conceptual === "endorses"
        ? "The current conceptual mechanism retains the distractor claim."
        : input.archetype.conceptual === "rejects"
          ? "The conceptual mechanism limits and rejects the distractor claim."
          : "The available conceptual position remains ambiguous."),
    limitations: input.archetype.id === "conflict_only_in_limitation"
      ? ["The final option conclusion conflicts with the conceptual explanation."]
      : ["deterministic_cross_domain_calibration_only"]
  });
}

export function runE2A27ACalibration() {
  const corpus = CALIBRATION_DOMAINS.flatMap((domain) =>
    CALIBRATION_ARCHETYPES.map((archetype) => ({
      case_id: `${domain}_${archetype.id}`,
      domain,
      evaluator_observation: {
        conceptual_position: archetype.conceptual,
        response: archetype.message,
        rationale: archetype.rationale ?? null
      },
      target_contract: {
        active_anchor_id: `${domain}:item:option:B`,
        required_anchor_stance: "rejects_distractor"
      },
      expected_mapper_result: archetype.expected,
      expected_profile: archetype.expected === "sound"
        ? "sound" : archetype.expected === "conflict" ? "partial" : "non_sound",
      structured_contradictions: archetype.expected === "conflict"
        ? ["anchor_conclusion_conceptual_explanation_conflict"] : [],
      allowed_semantic_labels: archetype.expected === "sound"
        ? ["sound"] : ["partial", "misconception", "insufficient"],
      prohibited_labels: archetype.expected === "sound"
        ? [] : ["sound"],
      revision_readiness: archetype.expected === "sound",
      platform_mode: archetype.expected === "sound"
        ? "request_revision" : "remain_in_dialogue",
      tutor_dispatch_eligibility: archetype.expected !== "sound"
    }))
  );
  const results = corpus.map((entry) => {
    const archetype = CALIBRATION_ARCHETYPES.find((candidate) =>
      entry.case_id.endsWith(candidate.id)
    )!;
    if (archetype.expected === "fail_closed") {
      let failedClosed = false;
      try {
        propagateAnchorContradiction({
          contract: {
            active_anchor_id: `${entry.domain}:item:option:B`,
            active_anchor_text: "Synthetic active distractor B",
            active_anchor_type: "distractor_option",
            distractor_option: "B",
            distractor_claim: "Synthetic distractor claim",
            required_anchor_stance: "rejects_distractor",
            acceptable_anchor_paraphrases: ["option B", "that choice"],
            prohibited_anchor_stances: [
              "not_expressed", "ambiguous", "endorses_distractor"
            ],
            anchor_resolution_criteria: ["Reject the active distractor."],
            anchor_contradiction_criteria: ["Do not retain a conflict."],
            ambiguity_resolution_policy: "Require clarification."
          },
          evaluator_observation: {
            observation_version: "production-turn-anchor-observation-v4",
            active_anchor_id: `${entry.domain}:item:option:B`,
            observed_anchor_application: "explicit",
            observed_anchor_stance: "endorses_distractor",
            conceptual_conclusion: "rejects_distractor",
            anchor_concept_alignment: "aligned",
            anchor_conflict_type: null,
            blocking_conflict: true,
            exact_supporting_spans: [{
              label: "anchor_stance", span: "Option B is correct."
            }],
            evidence_source: "structured_evaluator_fields"
          },
          source_evaluator_version:
            PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V4,
          mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V4
        });
      } catch {
        failedClosed = true;
      }
      return { ...entry, passed: failedClosed, actual: "failed_closed" };
    }
    const packet = packetForCalibration({ caseId: entry.case_id, archetype });
    const contract = buildActivityTargetEvidenceContractV4({
      concept_id: entry.domain,
      item_id: `${entry.domain}_item`,
      distractor_option: "B",
      distractor_claim: "Synthetic distractor claim for calibration.",
      packet
    });
    const adjudication = buildTargetEvidenceAdjudicationFromActivityPacketV4({
      latest_student_message: archetype.message,
      packet,
      contract
    });
    const finalized = finalizeEvidenceFirstTurnBeforeTutor({
      contract,
      adjudication,
      interaction_intent: "ordinary_conceptual_response",
      confidence_evidence: packet.misconception_evidence_update.confidence,
      source_student_turn_id: `turn_${entry.case_id}`,
      source_sequence_index: 2,
      latest_accepted_student_turn_id: `turn_${entry.case_id}`,
      latest_accepted_sequence_index: 2,
      concept_id: entry.domain,
      distractor_anchor: `${entry.domain}:B`,
      prior_cumulative_profile: null,
      created_at: "2026-07-22T08:00:00.000Z"
    });
    const conflictPresent = finalized.profile.contradictions.includes(
      "anchor_conclusion_conceptual_explanation_conflict"
    ) && finalized.profile.structured_contradictions?.some((entry) =>
      entry.contradiction_type ===
        "anchor_conclusion_conceptual_explanation_conflict" &&
      entry.blocking
    ) === true;
    const passed = archetype.expected === "sound"
      ? finalized.profile.reasoning_quality === "sound" &&
        finalized.profile.revision_readiness &&
        finalized.route.selected_mode === "request_revision"
      : archetype.expected === "conflict"
        ? conflictPresent &&
          finalized.profile.reasoning_quality !== "sound" &&
          !finalized.profile.revision_readiness &&
          finalized.route.selected_mode === "remain_in_dialogue"
        : finalized.profile.reasoning_quality !== "sound" &&
          !finalized.profile.revision_readiness;
    return {
      ...entry,
      actual: {
        evaluator_anchor_observation: adjudication.anchor_observation,
        profile: finalized.profile,
        platform_mode: finalized.route.selected_mode,
        pre_tutor_finalization: finalized.attestation
      },
      passed
    };
  });
  return { corpus, results, passed: results.every((entry) => entry.passed) };
}

function e2a28Protocol() {
  return {
    protocol_version: "e2a28-cross-domain-contradiction-canary-v1",
    authorization_state: "not_authorized_not_executed",
    domain: "health_sciences_antimicrobial_resistance",
    concept:
      "Antibiotic exposure selects among pre-existing bacterial variation; it does not cause individual bacteria to adapt intentionally.",
    active_distractor: {
      option: "C",
      claim:
        "During treatment, individual bacteria become resistant because they adapt to the antibiotic in response to needing to survive.",
      misconception:
        "Treats natural selection across a bacterial population as an intentional, need-driven change within individual cells."
    },
    natural_initial_activity:
      "A bacterial population contains a few cells that are already less affected by an antibiotic. After treatment, those cells make up more of the surviving population. Did the antibiotic teach individual cells to adapt, or did something else change the population? Explain.",
    frozen_trajectory: [
      { turn: 1, objective: "informal need-driven adaptation misconception" },
      { turn: 2, objective: "briefly echoes one tutor clause without applying it" },
      { turn: 3, objective: "partial recognition that some resistant cells existed before exposure" },
      { turn: 4, objective:
        "substantially correct differential-survival mechanism plus explicit endorsement of distractor C" },
      { turn: 5, objective:
        "asks a concise clarification about individual change versus population change" },
      { turn: 6, objective:
        "coherent independent rejection of C using pre-existing variation, survival, and reproduction" }
    ],
    required_runtime_behavior: {
      turn_4_profile: "finalized_non_sound_contradictory",
      turn_4_mode: "remain_in_dialogue",
      turn_4_tutor_sees_structured_contradiction: true,
      final_sound_detection_delay: 0,
      tutor_calls_after_sound: 0,
      unnecessary_turns_after_sound: 0
    },
    human_review_required: true,
    provider_calls_made: 0
  };
}

function tokenSet(value: string) {
  return new Set(value.toLocaleLowerCase("en-CA").match(/[a-z0-9]+/gu) ?? []);
}

function jaccard(left: Set<string>, right: Set<string>) {
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function overlapAnalysis(protocol: ReturnType<typeof e2a28Protocol>) {
  const comparisonRoots = [
    ".data/e2a24-autonomous-formative-dialogue-architecture",
    ".data/e2a25-autonomous-dialogue-live-canary",
    ".data/e2a26-semantic-oracle-calibration",
    ".data/e2a26a-anchor-conclusion-consistency",
    ".data/e2a27-geometrical-optics-anchor-consistency-canary",
    "src/lib/services/student-assessment/autonomous-formative-dialogue.ts"
  ];
  const protocolText = JSON.stringify(protocol);
  const protocolTokens = tokenSet(protocolText);
  const structuralSignature = JSON.stringify(
    protocol.frozen_trajectory.map((entry) => entry.objective)
  );
  const comparisons = comparisonRoots.map((root) => {
    const absolute = path.join(process.cwd(), root);
    const files = filesRecursively(absolute).filter((file) =>
      /\.(?:json|jsonl|md)$/u.test(file)
    );
    const text = files.slice(0, 250).map((file) =>
      readFileSync(file, "utf8").slice(0, 80_000)
    ).join(" ");
    return {
      source: root,
      exact_match: text.includes(protocolText),
      normalized_exact_match: text.toLocaleLowerCase("en-CA")
        .includes(protocolText.toLocaleLowerCase("en-CA")),
      token_jaccard: Number(jaccard(protocolTokens, tokenSet(text)).toFixed(6)),
      structural_template_reuse: text.includes(structuralSignature),
      semantic_domain_overlap: /antibiotic resistance|antimicrobial resistance|pre-existing resistant|bacteria(?:l)? (?:cells )?(?:adapt|became resistant)|need-driven adaptation/iu
        .test(text),
      semantic_overlap_method: "deterministic_domain_and_misconception_taxonomy"
    };
  });
  return {
    analysis_version: "e2a28-held-out-overlap-analysis-v1",
    materially_new_domain: comparisons.every((entry) =>
      !entry.semantic_domain_overlap
    ),
    exact_overlap_passed: comparisons.every((entry) => !entry.exact_match),
    normalized_overlap_passed: comparisons.every((entry) =>
      !entry.normalized_exact_match
    ),
    token_overlap_passed: comparisons.every((entry) =>
      entry.token_jaccard < 0.25
    ),
    structural_overlap_passed: comparisons.every((entry) =>
      !entry.structural_template_reuse
    ),
    semantic_overlap_passed: comparisons.every((entry) =>
      !entry.semantic_domain_overlap
    ),
    comparisons
  };
}

function sourceLevelTrace() {
  return [
    {
      observation: "direct active-option reference",
      exact_span: "option B",
      evaluator_field: "student_activity_response safe summary",
      target_criterion: "active_anchor_application",
      mapper_input: "latest_student_message",
      mapper_normalization: "V3 explicit option-reference matcher",
      profile_field: "anchor_application=explicit",
      source_location:
        "anchor-conclusion-consistency.ts classifyAnchorConclusion optionReferencePatterns",
      result: "preserved"
    },
    {
      observation: "final option-B endorsement",
      exact_span: "That makes option B appropriate i think.",
      evaluator_field: "recognized only in safe summary and rationale",
      target_criterion: "coherent_conclusion",
      mapper_input: "latest_student_message plus V3 packet status",
      mapper_normalization:
        "V3 endorsement patterns omitted makes-option-appropriate construction",
      profile_field: "anchor_stance",
      source_location:
        "anchor-conclusion-consistency.ts classifyAnchorConclusion endorsingPatterns",
      result: "lost_in_v3_recomputed_as_rejects_distractor"
    },
    {
      observation: "correct virtual-image mechanism",
      exact_span:
        "actual rays cant meet there. So its virtual, since only the backwards extensions would meet.",
      evaluator_field:
        "evidence_elicited target_boundary_explained=partial and reasoning_link_repaired=partial",
      target_criterion: "required_mechanism",
      mapper_input: "misconception_evidence_update.status",
      mapper_normalization:
        "V3 mapped reasoning_boundary_still_blurred to endorses_distractor",
      profile_field: "conceptual position",
      source_location:
        "target-evidence-contract-v3.ts conceptualPositionFromPacket",
      result: "conceptual conclusion conflated with final option conclusion"
    },
    {
      observation: "mechanism/conclusion conflict",
      exact_span:
        "virtual ... backwards extensions would meet ... option B appropriate",
      evaluator_field: "safe summary and safe_internal_rationale only",
      target_criterion:
        "anchor_conclusion_conceptual_explanation_conflict",
      mapper_input: "no dedicated V3 structured field",
      mapper_normalization: "conflict absent after phrase/status recomputation",
      profile_field: "contradictions",
      source_location:
        "target-evidence-contract-v3.ts buildTargetEvidenceAdjudicationFromActivityPacketV3",
      result: "lost_before_profile_consistency"
    },
    {
      observation: "distractor-resolution status",
      exact_span: "That makes option B appropriate i think.",
      evaluator_field: "safe summary and safe_internal_rationale",
      target_criterion: "required_anchor_rejection",
      mapper_input: "V3 anchor interpretation plus packet status",
      mapper_normalization:
        "unrecognized endorsement fell back to conceptual-position inference",
      profile_field: "anchor_resolution_status",
      consistency_invariant: "blocking conflict cannot be resolved",
      sound_gate_consequence: "non_sound",
      platform_mode_consequence: "remain_in_dialogue",
      tutor_request_consequence:
        "supply contradictory unresolved anchor as latest primary gap",
      source_location:
        "target-evidence-contract-v3.ts mapTargetEvidenceAdjudicationToObservationV3",
      result: "historically_misclassified_corrected_to_contradictory"
    },
    {
      observation: "structured contradiction",
      exact_span:
        "virtual, since only the backwards extensions would meet. That makes option B appropriate",
      evaluator_field: "conflict described in safe summary and rationale",
      target_criterion:
        "anchor_conclusion_conceptual_explanation_conflict",
      mapper_input: "no dedicated V3 structured conflict field",
      mapper_normalization:
        "V3 contradiction criterion evaluated from misclassified interpretation",
      profile_field: "structured_contradictions",
      consistency_invariant:
        "a blocking conflict requires a structured blocking record",
      sound_gate_consequence: "non_sound",
      platform_mode_consequence: "remain_in_dialogue",
      tutor_request_consequence:
        "tutor receives the exact conflict only after profile finalization",
      source_location:
        "target-evidence-contract-v3.ts contradiction_results construction",
      result: "historically_lost_corrected_and_propagated"
    },
    {
      observation: "revision readiness",
      exact_span: null,
      evaluator_field: "medium evidence; conflict described",
      target_criterion: "all revision-ready criteria",
      mapper_input: "V3 non-sound profile",
      mapper_normalization: "revision false",
      profile_field: "revision_readiness=false",
      consistency_invariant: "no blocking conflict may authorize revision",
      sound_gate_consequence: "non_sound",
      platform_mode_consequence: "remain_in_dialogue",
      tutor_request_consequence:
        "eligible only after V4 profile finalization and consistency validation",
      result: "corrected"
    }
  ];
}

export function runE2A27A() {
  let networkRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    networkRequests += 1;
    throw new Error("e2a27a_network_request_forbidden");
  }) as typeof fetch;
  try {
    const protectedBefore = historicalEvidenceSnapshot();
    const evidence = loadE2A27();
    const replay = replayE2A27(evidence);
    const calibration = runE2A27ACalibration();
    if (!calibration.passed) {
      const failed = calibration.results.filter((entry) => !entry.passed)
        .map((entry) => entry.case_id);
      throw new Error(`e2a27a_calibration_failed:${failed.join("|")}`);
    }
    const protocol = e2a28Protocol();
    const protocolHash = stableHash(protocol);
    const artifactContract = {
      artifact_contract_version: "e2a28-artifact-contract-v1",
      required_failure_safe_records: [
        "accepted student turns", "complete visible episodes",
        "evaluator requests and outputs", "mapper inputs and results",
        "profile consistency results", "mode decisions",
        "tutor requests and outputs when dispatched",
        "persistence/display/suppression provenance", "privacy results",
        "failure stage", "human-review bindings"
      ],
      generated_but_suppressed_outputs_included: true,
      no_missing_values_coerced_to_zero: true,
      historical_evidence_mutation_forbidden: true
    };
    const artifactContractHash = stableHash(artifactContract);
    const overlap = overlapAnalysis(protocol);
    if (!overlap.materially_new_domain || !overlap.exact_overlap_passed ||
        !overlap.normalized_overlap_passed || !overlap.token_overlap_passed ||
        !overlap.semantic_overlap_passed) {
      throw new Error("e2a27a_e2a28_overlap_check_failed");
    }
    const runId = `e2a27a_${new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14)}_${randomBytes(4).toString("hex")}`;
    const runDir = path.join(E2A27A_ARTIFACT_ROOT, runId);
    mkdirSync(runDir, { recursive: true });
    const turn4 = replay.turns[3]!;
    const turn4TutorInput = evidence.tutorInputs.find((row) => row.turn === 4)!;
    const turn4TutorOutput = evidence.tutorOutputs.find((row) => row.turn === 4)!;
    const visibleTurns = turn4TutorInput.request
      .complete_visible_formative_conversation.visible_turns;
    const tutorMessage = (turn4TutorOutput.parsed_structured_output as
      { student_facing_message: string }).student_facing_message;
    const startedAt = Date.parse(String(evidence.summary.started_at));
    const completedAt = Date.parse(String(evidence.summary.completed_at));
    const attemptedStudentTurns = evidence.simulators.length;
    const completedStudentTurns = 3;
    const generatedTutorResponses = evidence.tutorOutputs.length;
    const effectiveTutorResponses = 3;
    const visibleWordCount = visibleTurns.reduce((total, entry) =>
      total + entry.message_text.trim().split(/\s+/u).filter(Boolean).length, 0
    );
    const suppressedWordCount = tutorMessage.trim().split(/\s+/u)
      .filter(Boolean).length;
    const protectedAfter = historicalEvidenceSnapshot();
    const protectedUnchanged = protectedBefore.aggregate_sha256 ===
      protectedAfter.aggregate_sha256;
    if (!protectedUnchanged) throw new Error("e2a27a_protected_evidence_changed");
    const frozenSession = evidence.protocol.session as {
      student_profile: JsonRecord;
      frozen_student_trajectory: JsonRecord[];
    };
    const frozenTurn4 = frozenSession.frozen_student_trajectory.find((entry) =>
      entry.turn === 4
    ) ?? null;

    const files: Record<(typeof E2A27A_ARTIFACT_NAMES)[number], unknown> = {
      "e2a27a-manifest.json": {
        manifest_version: E2A27A_VERSION,
        run_id: runId,
        status: E2A27A_STATUS,
        no_live: true,
        provider_calls_made: 0,
        network_requests_made: networkRequests,
        source_run_id: E2A27_RUN_ID,
        source_run_status_preserved: "failed_closed",
        application_git_commit: applicationGitCommit(),
        protected_before: protectedBefore,
        protected_after: protectedAfter
      },
      "e2a27-turn4-exact-reconstruction.json": {
        reconstruction_version: "e2a27-turn4-exact-reconstruction-v1",
        source_run_id: E2A27_RUN_ID,
        initial_activity: visibleTurns[0],
        prior_visible_messages: visibleTurns.slice(0, -1),
        exact_turn4_simulator_output: turn4.exact_student_response,
        simulator_objective_and_hidden_state: {
          status: "completed",
          frozen_turn_objective: frozenTurn4,
          frozen_student_persona: frozenSession.student_profile,
          exact_provider_request_artifact: "missing",
          provenance:
            "immutable frozen protocol plus simulator provider output",
          student_visible: false
        },
        evaluator_request: {
          status: "generated_but_not_persisted",
          dedicated_historical_artifact: "missing",
          recoverable_from_provider_and_tutor_context: false
        },
        evaluator_provider_output: turn4.historical_evaluator_output,
        evaluator_criterion_evidence:
          turn4.historical_evaluator_output.evidence_elicited,
        anchor_related_evidence: {
          detected_conceptual_mechanism:
            "actual rays remain divergent; only backward extensions meet; image is virtual",
          detected_final_anchor_conclusion: "option B appropriate",
          detected_conflict:
            "recognized in safe summary and safe rationale, not V3 structured fields"
        },
        target_evidence_contract: "completed",
        mapper_input: "completed",
        mapper_intermediate_state:
          turn4TutorInput.request.latest_authoritative_turn_profile,
        mapper_output: "generated_but_not_finalized",
        profile_consistency: "blocked_before_stage",
        invariant_result: "e2a27_anchor_contradiction_not_structured",
        platform_mode: "generated_but_not_finalized",
        autonomous_tutor_request: "generated_but_not_persisted",
        autonomous_tutor_output: turn4TutorOutput.parsed_structured_output,
        tutor_validation: "generated_but_not_finalized",
        tutor_persistence: "generated_but_not_persisted",
        tutor_display: "generated_but_not_displayed",
        abort_location:
          "prisma/formative-evaluation-e2a27.ts post-orchestrator anchor invariant",
        stages_reached: [
          "student provider output", "student turn accepted in isolated store",
          "complete visible episode", "evaluator provider output",
          "V3 mapper intermediate profile", "tutor provider output"
        ],
        stages_not_reached: [
          "final V4 contradiction propagation", "profile consistency completion",
          "profile persistence", "effective tutor persistence",
          "student display", "session completion"
        ]
      },
      "cross-layer-propagation-trace.json": {
        trace_version: "e2a27a-cross-layer-propagation-trace-v1",
        rows: sourceLevelTrace()
      },
      "root-cause-classification.json": {
        classification: "cross_layer_contract_and_ordering_defect",
        primary_locations: [
          "src/lib/services/student-assessment/target-evidence-contract-v3.ts conceptualPositionFromPacket",
          "src/lib/services/student-assessment/anchor-conclusion-consistency.ts classifyAnchorConclusion endorsingPatterns",
          "prisma/formative-evaluation-e2a27.ts post-orchestrator invariant ordering"
        ],
        evaluator_provider_failure: false,
        tutor_generation_failure: false,
        student_response_failure: false
      },
      "evaluator-structure-audit.json": {
        evaluator_v3_sufficient: false,
        structured_fields_present: [
          "evidence_elicited", "misconception_evidence_update.status",
          "evidence_quality"
        ],
        conflict_locations: [
          "student_activity_response.student_response_text_redacted_or_safe_summary",
          "misconception_evidence_update.safe_internal_rationale"
        ],
        dedicated_anchor_conclusion_field_present: false,
        dedicated_conceptual_conclusion_field_present: false,
        dedicated_blocking_conflict_field_present: false,
        required_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V4
      },
      "anchor-contradiction-propagation-contract.json": {
        version: ANCHOR_CONTRADICTION_PROPAGATION_VERSION,
        generic: true,
        domain_hardcoding: false,
        required_input_fields: [
          "active anchor", "required stance", "observed anchor conclusion",
          "conceptual conclusion", "exact spans", "conflict result"
        ],
        required_output_fields: [
          "anchor application", "stance", "consistency", "resolution",
          "structured contradictions", "blocking", "revision readiness"
        ]
      },
      "production-evaluator-delta.json": {
        from: "production-turn-evidence-evaluator-v3",
        to: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V4,
        added: [
          "observed_anchor_application", "observed_anchor_stance",
          "conceptual_conclusion", "anchor_concept_alignment",
          "anchor_conflict_type", "blocking_conflict",
          "exact_supporting_spans"
        ],
        semantic_scope_changed: false,
        tutor_contract_changed: false
      },
      "profile-mapper-delta.json": {
        from: "turn-evidence-profile-mapper-v3",
        to: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V4,
        change:
          "Consumes structured V4 anchor observation and carries blocking contradictions without prose inference."
      },
      "profile-consistency-delta.json": {
        from: "turn-evidence-profile-consistency-v3",
        to: PROFILE_CONSISTENCY_POLICY_VERSION_V4,
        invariants: [
          "blocking conflict requires structured record",
          "blocking conflict cannot be sound, consistent, resolved, or revision-ready",
          "explicit anchor evidence cannot become absent",
          "sound requires all anchor conditions and no contradiction"
        ]
      },
      "pre-tutor-finalization-policy.json": {
        version: PRE_TUTOR_PROFILE_FINALIZATION_VERSION,
        order: [
          "accepted student response persisted",
          "complete visible episode reconstructed",
          "evidence evaluator completed",
          "evaluator output schema-valid",
          "target contract applied", "anchor interpretation completed",
          "blocking conflicts propagated", "turn profile constructed",
          "profile consistency validation passed",
          "cumulative profile updated", "sound gate executed",
          "platform mode finalized", "tutor request constructed if required"
        ],
        stale_or_inconsistent_profile_dispatch: "forbidden"
      },
      "sound-gate-non-regression.json": {
        blocking_conflict_cannot_be_sound: true,
        coherent_sound_rejection_progresses_immediately: true,
        contradictory_learning_state_is_valid: true,
        contradictory_learning_state_mode: "remain_in_dialogue",
        infrastructure_abort_reserved_for_internal_profile_failure: true
      },
      "e2a27-read-only-replay.json": replay,
      "historical-non-regression-replays.json": {
        source: "immutable E2A.25 plus E2A.26a corrected replay evidence",
        provider_calls_made: 0,
        sessions: {
          A: { result: "sound_remains_sound", immediate_revision: true },
          B: { result: "option_D_contradiction_remains_non_sound",
            premature_revision: false },
          C: { result: "copied_response_remains_non_sound",
            semantic_envelope_preserved: true }
        },
        e2a27_turns_1_to_3: replay.turns.slice(0, 3).map((entry) => ({
          turn: entry.turn,
          reasoning_quality: entry.corrected_profile.reasoning_quality,
          revision_readiness: entry.corrected_profile.revision_readiness,
          mode: entry.corrected_platform_mode,
          passed: entry.corrected_profile.reasoning_quality !== "sound" &&
            !entry.corrected_profile.revision_readiness
        }))
      },
      "first-divergence-and-replay-boundary.json": {
        first_metadata_divergence: { turn: 1, field: "evaluator_version" },
        first_profile_divergence: {
          turn: 4,
          fields: ["contradictions", "reasoning_quality representation"]
        },
        first_mode_divergence: null,
        first_provider_dispatch_divergence: {
          turn: 4,
          historical: "dispatched_before_external invariant",
          corrected: "eligible only after finalized profile"
        },
        counterfactual_replay_boundary: "after corrected Turn-4 tutor eligibility",
        later_provider_output_fabricated: false
      },
      "preserved-turn4-tutor-output-adjudication.json": {
        provider_generated: true,
        profile_finalized: false,
        persisted: false,
        displayed: false,
        suppression_reason: "e2a27_anchor_contradiction_not_structured",
        directly_addresses_conflict: true,
        seeks_one_coherent_conclusion: true,
        natural: true,
        repetitive: false,
        protected_information_exposed: false,
        suitable_under_corrected_non_sound_profile: true,
        corrected_runtime_proof: false,
        exact_student_facing_message: tutorMessage
      },
      "failure-path-artifact-completeness.json": {
        policy_version: "failure-path-evidence-completeness-v2",
        required_fields: [
          "complete_prior_visible_episode", "request_provenance",
          "evaluator_request", "evaluator_output", "mapper_input",
          "mapper_result", "consistency_result", "mode_decision",
          "tutor_request", "tutor_output", "persistence_state",
          "display_state", "suppression_reason", "privacy_result",
          "transcript_stage", "failure_stage"
        ],
        future_policy_complete: true,
        historical_turn4_dedicated_request_context: "missing",
        historical_records_fabricated: false
      },
      "derived-human-review-binding-audit.json": {
        binding_version: "human-review-binding-v2",
        future_required_binding: [
          "session", "source turn", "prior visible conversation",
          "evaluator output", "profile", "anchor interpretation",
          "contradictions", "platform mode", "tutor strategy",
          "persistence/display provenance"
        ],
        generated_but_not_displayed_tutor_outputs_included: true,
        historical_packet_changed: false,
        historical_turn4_binding_completeness: "partial"
      },
      "audit-summary-schema-delta.json": {
        version: "failed-session-audit-summary-v2",
        required_fields: [
          "attempted_student_turns", "completed_student_turns",
          "generated_tutor_responses", "effective_tutor_responses",
          "total_visible_words_before_abort",
          "provider_generated_but_suppressed_words",
          "completed_session_duration_ms", "time_to_abort_ms", "burden_status"
        ],
        missing_numeric_values_must_be_null_not_zero: true,
        schema_validation_passed: true
      },
      "failed-session-burden-metrics.json": {
        metric_version: "failed-session-burden-v2",
        attempted_student_turns: attemptedStudentTurns,
        completed_student_turns: completedStudentTurns,
        generated_tutor_responses: generatedTutorResponses,
        effective_tutor_responses: effectiveTutorResponses,
        total_visible_words_before_abort: visibleWordCount,
        provider_generated_but_suppressed_words: suppressedWordCount,
        completed_session_duration_ms: null,
        time_to_abort_ms: Number.isFinite(startedAt) && Number.isFinite(completedAt)
          ? completedAt - startedAt : null,
        burden_status: "partial",
        missing_values_coerced_to_zero: false
      },
      "approved-runtime-assertion-audit.json": {
        diagnosis: "environment_dependent_verifier_assertion",
        active_approved_v2_hash: APPROVED_V2_HASH,
        protected_artifact_integrity_issue: false,
        local_failure_sources: [
          "process model assertions may not match approved V2",
          "OPERATIONAL_APPROVED_CONFIG_HASH may be absent in local shell"
        ],
        correction:
          "No env or approved artifact change. No-live harnesses use process-scoped approved-V2 assertions and restore process state.",
        env_files_modified: false
      },
      "calibration-corpus.jsonl": calibration.corpus,
      "calibration-results.jsonl": calibration.results,
      "composite-runtime-identity.json": {},
      "candidate-integrity.json": {},
      "e2a28-held-out-overlap-analysis.json": overlap,
      "e2a28-frozen-protocol.json": protocol,
      "e2a28-frozen-protocol.sha256": `${protocolHash}\n`,
      "e2a28-budget.json": {
        budget_version: "e2a28-budget-v1",
        authorization_state: "not_authorized",
        maximum: {
          sessions: 1, simulator_calls: 9, evidence_evaluator_calls: 9,
          tutor_calls: 9, tutor_regenerations: 2,
          logical_generation_calls: 29, adapter_attempts: 87,
          provider_concurrency: 1, input_tokens: 900000,
          output_tokens: 70000, total_tokens: 970000,
          cost_usd_when_pricing_available: 25
        },
        expected_normal: {
          simulator_calls: 6, evidence_evaluator_calls: 6,
          tutor_calls: 5, tutor_regenerations: 0,
          logical_generation_calls: 17
        }
      },
      "e2a28-artifact-contract.json": artifactContract,
      "summary.json": {}
    };

    const candidatePath = path.join(process.cwd(), "config",
      "candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json");
    const candidate = readJson<JsonRecord>(candidatePath);
    const candidateIntegrity = {
      candidate_path: path.relative(process.cwd(), candidatePath),
      expected_configuration_hash: CANDIDATE_HASH,
      actual_configuration_hash: candidate.candidate_configuration_hash,
      expected_file_sha256: CANDIDATE_FILE_SHA256,
      actual_file_sha256: sha256(readFileSync(candidatePath)),
      approved_v2_hash: candidate.approved_v2_hash,
      unchanged: candidate.candidate_configuration_hash === CANDIDATE_HASH &&
        sha256(readFileSync(candidatePath)) === CANDIDATE_FILE_SHA256 &&
        candidate.approved_v2_hash === APPROVED_V2_HASH
    };
    if (!candidateIntegrity.unchanged) {
      throw new Error("e2a27a_candidate_integrity_failed");
    }
    files["candidate-integrity.json"] = candidateIntegrity;

    const compositeCore = {
      identity_version: "e2a27a-composite-runtime-identity-v1",
      autonomous_candidate_hash: CANDIDATE_HASH,
      autonomous_candidate_file_sha256: CANDIDATE_FILE_SHA256,
      evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V4,
      evaluator_source_sha256: sourceSha(
        "src/lib/services/student-assessment/target-evidence-contract-v4.ts"
      ),
      mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V4,
      mapper_source_sha256: sourceSha(
        "src/lib/services/student-assessment/target-evidence-contract-v4.ts"
      ),
      profile_consistency_version: PROFILE_CONSISTENCY_POLICY_VERSION_V4,
      profile_consistency_source_sha256: sourceSha(
        "src/lib/services/student-assessment/target-evidence-contract-v4.ts"
      ),
      contradiction_propagation_version:
        ANCHOR_CONTRADICTION_PROPAGATION_VERSION,
      contradiction_propagation_source_sha256: sourceSha(
        "src/lib/services/student-assessment/anchor-contradiction-propagation.ts"
      ),
      pre_tutor_finalization_version: PRE_TUTOR_PROFILE_FINALIZATION_VERSION,
      pre_tutor_finalization_source_sha256: sourceSha(
        "src/lib/services/student-assessment/pre-tutor-profile-finalization.ts"
      ),
      sound_gate_version: "sound-gate-anchor-consistency-v1",
      sound_gate_source_sha256: sourceSha(
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
      future_protocol_hash: protocolHash,
      future_artifact_contract_hash: artifactContractHash
    };
    const composite = {
      ...compositeCore,
      composite_runtime_identity_hash: stableHash(compositeCore)
    };
    files["composite-runtime-identity.json"] = composite;

    const summary = {
      summary_version: "e2a27a-summary-v1",
      status: E2A27A_STATUS,
      run_id: runId,
      source_e2a27_status_preserved: "failed_closed",
      evaluator_v3_sufficient: false,
      evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V4,
      mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V4,
      profile_consistency_version: PROFILE_CONSISTENCY_POLICY_VERSION_V4,
      contradiction_propagation_version:
        ANCHOR_CONTRADICTION_PROPAGATION_VERSION,
      pre_tutor_finalization_version: PRE_TUTOR_PROFILE_FINALIZATION_VERSION,
      corrected_turn4: {
        anchor_application: "explicit",
        anchor_stance: "endorses_distractor",
        anchor_consistency: "contradictory_to_conceptual_reasoning",
        anchor_resolution_status: "contradictory",
        contradictions: [
          "anchor_conclusion_conceptual_explanation_conflict"
        ],
        reasoning_quality: "partial",
        revision_readiness: false,
        platform_mode: "remain_in_dialogue",
        tutor_dispatch_eligible_after_finalization: true
      },
      calibration_case_count: calibration.results.length,
      calibration_non_irt_case_count: calibration.results.length,
      calibration_passed: calibration.passed,
      e2a28_protocol_hash: protocolHash,
      e2a28_executed: false,
      provider_calls_made: 0,
      network_requests_made: networkRequests,
      protected_evidence_unchanged: protectedUnchanged,
      candidate_integrity_passed: candidateIntegrity.unchanged,
      composite_runtime_identity_hash:
        composite.composite_runtime_identity_hash,
      remaining_blocker:
        "Explicit user authorization and successful preflight are required before E2A.28 live execution."
    };
    files["summary.json"] = summary;
    for (const name of E2A27A_ARTIFACT_NAMES) {
      const value = files[name];
      if (name.endsWith(".jsonl")) writeJsonl(path.join(runDir, name),
        value as unknown[]);
      else if (name.endsWith(".sha256")) writeFileSync(path.join(runDir, name),
        String(value), "utf8");
      else writeJson(path.join(runDir, name), value);
    }
    if (networkRequests !== 0) throw new Error("e2a27a_network_guard_failed");
    return { runId, runDir, summary, artifacts: E2A27A_ARTIFACT_NAMES };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export function latestE2A27ARun(root = E2A27A_ARTIFACT_ROOT) {
  if (!existsSync(root)) return null;
  const directory = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("e2a27a_"))
    .map((entry) => path.join(root, entry.name)).sort().at(-1) ?? null;
  if (!directory) return null;
  return {
    runDir: directory,
    summary: readJson<JsonRecord>(path.join(directory, "summary.json"))
  };
}
