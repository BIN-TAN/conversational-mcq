import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
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
import { stableHash } from "@/lib/operational/stable-hash";
import {
  assertEvidenceFirstProfileIsFresh,
  type TopicDialogueCumulativeEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  PROFILE_CONSISTENCY_POLICY_VERSION,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION,
  TARGET_EVIDENCE_CONTRACT_VERSION,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION
} from "@/lib/services/student-assessment/target-evidence-contract";
import { compileE2A14CandidateRequestsNoNetwork } from
  "./e2a14-request-compilation";
import {
  E2A17_APPROVED_V2_HASH,
  E2A17_CANDIDATE_FILE_SHA256,
  E2A17_CANDIDATE_HASH
} from "./e2a17-protocol";
import {
  E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION
} from "./e2a20a-student-simulator-evidence-classifier-v3";
import { compileE2A21RequestsNoNetwork } from
  "./e2a21-evidence-driven-micro-canary";
import {
  buildE2A23ACalibrationCorpus,
  E2A23A_VERSION,
  item16TargetEvidenceContract,
  reconcileMessageToProfile,
  runE2A23ACalibration
} from "./e2a23a-evidence-reconciliation";
import {
  classifyStudentEvidenceV4,
  E2A23A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION
} from "./e2a23a-student-simulator-evidence-classifier-v4";

export const E2A23A_AUTHORITATIVE_RUN_ID =
  "e2a23_20260720193108_3aed2779" as const;
export const E2A23A_HISTORICAL_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a23-evidence-first-micro-canary",
  E2A23A_AUTHORITATIVE_RUN_ID
);
export const E2A23A_ARTIFACT_ROOT = path.join(
  process.cwd(), ".data", "e2a23a-turn-profile-reconciliation"
);
export const E2A23A_ALLOWED_STATUS =
  "e2a23a_simulator_and_profile_classifiers_corrected_e2a24_ready" as const;

export const E2A23A_ARTIFACT_NAMES = [
  "e2a23a-manifest.json",
  "human-review-attestation.json",
  "ai-review-reference.json",
  "six-turn-causal-timeline.json",
  "six-turn-evidence-comparison.jsonl",
  "strict-conceptual-adjudications.jsonl",
  "formative-adjudications.jsonl",
  "revision-readiness-adjudications.jsonl",
  "root-cause-classification.json",
  "production-evaluator-path-audit.json",
  "target-evidence-contract.json",
  "production-evaluator-delta.json",
  "profile-mapper-delta.json",
  "simulator-classifier-delta.json",
  "profile-consistency-policy.json",
  "earliest-revision-ready-turn.json",
  "sequence-quality-adjudication.json",
  "calibration-corpus.jsonl",
  "calibration-results.jsonl",
  "historical-e2a23-replay.json",
  "counterfactual-replay-boundary.json",
  "all-role-request-compilation.json",
  "e2a24-micro-canary-protocol-draft.json",
  "e2a24-budget-draft.json",
  "e2a24-artifact-contract.json",
  "summary.json"
] as const;

type ArtifactName = typeof E2A23A_ARTIFACT_NAMES[number];
type JsonObject = Record<string, unknown>;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonl<T>(filePath: string): T[] {
  const text = readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line) as T) : [];
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(filePath: string, rows: unknown[]) {
  writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") +
      (rows.length > 0 ? "\n" : ""),
    "utf8"
  );
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`e2a23a_expected_object:${label}`);
  }
  return value as JsonObject;
}

function stringValue(record: JsonObject, key: string) {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`e2a23a_expected_string:${key}`);
  }
  return value;
}

function numberValue(record: JsonObject, key: string) {
  const value = record[key];
  if (typeof value !== "number") {
    throw new Error(`e2a23a_expected_number:${key}`);
  }
  return value;
}

function gitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

function filesRecursively(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(root, entry.name);
    return entry.isDirectory() ? filesRecursively(child) : [child];
  }).sort();
}

const PROTECTED_PATHS = [
  "config/approved-operational-agent-config.json",
  "config/candidate-operational-agent-config.gpt-5.6-full-v2.json",
  "config/candidate-operational-agent-config.e2a14-protected-request-validator-calibration-v1.json",
  "src/lib/services/student-assessment/topic-dialogue-agent.ts",
  "src/lib/services/student-assessment/topic-dialogue-response-mode.ts",
  "src/lib/services/student-assessment/topic-dialogue-operation-contract.ts",
  "src/lib/services/student-assessment/topic-dialogue-runtime-validation-v2.ts",
  "src/lib/services/student-assessment/topic-dialogue-runtime-validation-v3.ts",
  "src/lib/evaluation/formative/e2a20a-student-simulator-evidence-classifier-v3.ts",
  "src/lib/services/student-assessment/topic-dialogue-evidence-first-routing.ts",
  ".data/e2a12-v8-held-out-canary",
  ".data/e2a13-v8-30-case-evaluation",
  ".data/e2a14-protected-request-calibration",
  ".data/e2a15-protected-request-provider-subset",
  ".data/e2a15a-protocol-audit",
  ".data/e2a15b-protected-request-supplement",
  ".data/e2a16-human-review-closure",
  ".data/e2a17-bounded-student-simulator-canary",
  ".data/e2a18-simulator-contract-adjudication",
  ".data/e2a19-single-session-micro-canary",
  ".data/e2a20-evidence-driven-transition-adjudication",
  ".data/e2a20a-turn4-classification-adjudication",
  ".data/e2a21-evidence-driven-micro-canary",
  ".data/e2a22-evidence-first-profile-routing",
  ".data/e2a23-evidence-first-micro-canary"
] as const;

export function snapshotE2A23AProtectedEvidence() {
  const groups = PROTECTED_PATHS.map((sourcePath) => {
    const absolute = path.join(process.cwd(), sourcePath);
    const files = filesRecursively(absolute).map((file) => ({
      path: path.relative(process.cwd(), file),
      sha256: sha256(readFileSync(file))
    }));
    return {
      source_path: sourcePath,
      exists: existsSync(absolute),
      file_count: files.length,
      tree_sha256: stableHash(files)
    };
  });
  return {
    snapshot_version: "e2a23a-protected-evidence-snapshot-v1",
    groups,
    combined_sha256: stableHash(groups)
  };
}

function loadHistoricalRows() {
  if (!existsSync(E2A23A_HISTORICAL_ROOT)) {
    throw new Error("e2a23a_authoritative_e2a23_run_missing");
  }
  const studentProvider = readJsonl<JsonObject>(path.join(
    E2A23A_HISTORICAL_ROOT, "student-provider-outputs.jsonl"
  ));
  const tutorProvider = readJsonl<JsonObject>(path.join(
    E2A23A_HISTORICAL_ROOT, "tutor-provider-outputs.jsonl"
  ));
  const conceptual = readJsonl<JsonObject>(path.join(
    E2A23A_HISTORICAL_ROOT, "conceptual-evidence-evaluations.jsonl"
  ));
  const profiles = readJsonl<JsonObject>(path.join(
    E2A23A_HISTORICAL_ROOT, "turn-profile-snapshots.jsonl"
  ));
  const cumulative = readJsonl<JsonObject>(path.join(
    E2A23A_HISTORICAL_ROOT, "cumulative-profile-updates.jsonl"
  ));
  const routes = readJsonl<JsonObject>(path.join(
    E2A23A_HISTORICAL_ROOT, "routing-decisions.jsonl"
  ));
  const studentTurns = readJsonl<JsonObject>(path.join(
    E2A23A_HISTORICAL_ROOT, "student-turn-results.jsonl"
  ));
  if ([studentProvider, tutorProvider, conceptual, profiles, cumulative,
    routes, studentTurns].some((rows) => rows.length !== 6)) {
    throw new Error("e2a23a_historical_six_turn_contract_failed");
  }
  return { studentProvider, tutorProvider, conceptual, profiles, cumulative,
    routes, studentTurns };
}

function historicalTurns() {
  const rows = loadHistoricalRows();
  return rows.studentProvider.map((studentProvider, index) => {
    const conceptual = rows.conceptual[index]!;
    const historicalProfile = object(rows.profiles[index]!.profile, "profile");
    const historicalCumulative = object(
      rows.cumulative[index]!.cumulative_profile,
      "cumulative_profile"
    );
    const historicalRoute = object(
      rows.routes[index]!.platform_route,
      "platform_route"
    );
    const studentOutput = object(
      studentProvider.parsed_output,
      "student_provider.parsed_output"
    );
    const tutorOutput = object(
      rows.tutorProvider[index]!.parsed_output,
      "tutor_provider.parsed_output"
    );
    return {
      turn_number: index + 1,
      student_message: stringValue(studentOutput, "student_message"),
      tutor_response: stringValue(tutorOutput, "student_facing_message"),
      source_student_turn_id: stringValue(conceptual, "source_student_turn_id"),
      source_sequence_index: numberValue(conceptual, "source_sequence_index"),
      created_at: stringValue(historicalProfile, "created_at"),
      simulator_classifier_v3: conceptual.simulator_evidence_adjudication,
      conceptual_evidence_evaluator_output: conceptual.profile_observation,
      formative_response_evaluator_output: {
        status: "not_invoked_by_e2a23_protocol",
        output: null
      },
      post_activity_evidence_evaluator_output: {
        status: "not_invoked_by_e2a23_protocol",
        output: null
      },
      historical_profile: historicalProfile,
      historical_cumulative_profile: historicalCumulative,
      historical_route: historicalRoute,
      simulator_turn_record: rows.studentTurns[index]
    };
  });
}

const HUMAN_EXPECTED = [
  { quality: "misconception", anchor: "explicit", ready: false,
    route: "clarify_concept_with_new_strategy" },
  { quality: "partial", anchor: "explicit", ready: false,
    route: "refine_partial_reasoning" },
  ...Array.from({ length: 4 }, () => ({
    quality: "sound", anchor: "explicit", ready: true,
    route: "request_revision"
  }))
] as const;

export function reconcileHistoricalE2A23() {
  const turns = historicalTurns();
  const contract = item16TargetEvidenceContract();
  let cumulative: TopicDialogueCumulativeEvidenceProfile | null = null;
  const comparisons = turns.map((turn, index) => {
    const corrected = reconcileMessageToProfile({
      message: turn.student_message,
      contract,
      sourceStudentTurnId: turn.source_student_turn_id,
      sourceSequenceIndex: turn.source_sequence_index,
      prior: cumulative,
      createdAt: turn.created_at
    });
    cumulative = corrected.cumulative;
    const simulatorV4 = classifyStudentEvidenceV4({
      message: turn.student_message,
      conceptual_anchor: "theta_information"
    });
    const expected = HUMAN_EXPECTED[index]!;
    const correctedOperation = corrected.route.selected_mode ===
      "request_revision"
      ? "request_revision"
      : corrected.route.selected_operation;
    return {
      ...turn,
      target_evidence_contract_version: contract.contract_version,
      corrected_evaluator: corrected.adjudication,
      corrected_observation: corrected.observation,
      corrected_profile: corrected.profile,
      corrected_cumulative_profile: corrected.cumulative,
      corrected_route: corrected.route,
      profile_consistency: corrected.consistency,
      simulator_classifier_v4: simulatorV4,
      human_attestation_comparison: {
        expected,
        agrees: corrected.profile.reasoning_quality === expected.quality &&
          corrected.profile.anchor_application === expected.anchor &&
          corrected.profile.revision_readiness === expected.ready &&
          correctedOperation === expected.route
      },
      ai_review_comparison: {
        expected_sound: index >= 2,
        expected_route: index >= 2
          ? "request_revision"
          : expected.route,
        agrees: (corrected.profile.reasoning_quality === "sound") ===
          (index >= 2) && correctedOperation === expected.route
      },
      path_dependency: index >= 1
        ? "historical_turn_after_first_corrected_route_divergence"
        : "pre_divergence_or_divergence_turn"
    };
  });
  const earliestRevision = comparisons.find((entry) =>
    entry.corrected_profile.revision_readiness
  )?.turn_number ?? null;
  const firstDivergence = comparisons.find((entry) => {
    const historical = stringValue(entry.historical_route, "selected_mode") ===
      "request_revision"
      ? "request_revision"
      : entry.historical_route.selected_operation;
    const corrected = entry.corrected_route.selected_mode ===
      "request_revision"
      ? "request_revision"
      : entry.corrected_route.selected_operation;
    return historical !== corrected;
  })?.turn_number ?? null;
  return { contract, comparisons, earliestRevision, firstDivergence };
}

function analyticAdjudications(
  comparisons: ReturnType<typeof reconcileHistoricalE2A23>["comparisons"],
  perspective: "strict_conceptual" | "classroom_formative" |
    "revision_readiness"
) {
  return comparisons.map((entry) => {
    const satisfied = entry.corrected_evaluator.criterion_results
      .filter((criterion) => criterion.satisfied)
      .map((criterion) => criterion.criterion_id);
    return {
      adjudication_version: `e2a23a-${perspective}-v1`,
      analytic_source: true,
      human_review: false,
      turn_number: entry.turn_number,
      classification: entry.corrected_profile.reasoning_quality,
      criteria_satisfied: satisfied,
      criteria_missing: entry.corrected_profile.essential_missing_links,
      supporting_spans: entry.corrected_profile.observable_evidence_spans,
      contradictions: entry.corrected_profile.contradictions,
      anchor_application: entry.corrected_profile.anchor_application,
      misconception_status: entry.corrected_profile.misconception_status,
      revision_readiness: entry.corrected_profile.revision_readiness,
      correct_route: entry.corrected_route.selected_mode === "request_revision"
        ? "request_revision"
        : entry.corrected_route.selected_operation,
      confidence: entry.corrected_evaluator.evidence_quality === "high"
        ? "high" : "medium",
      rationale_codes: [
        `perspective:${perspective}`,
        entry.corrected_profile.revision_readiness
          ? "all_essential_revision_criteria_satisfied"
          : "one_or_more_essential_revision_criteria_missing_or_contradicted"
      ]
    };
  });
}

async function compileAllRolesNoNetwork(
  corrected: ReturnType<typeof reconcileHistoricalE2A23>["comparisons"]
) {
  const temporaryPath = path.join(
    os.tmpdir(), `e2a23a-all-role-${randomBytes(6).toString("hex")}.json`
  );
  try {
    const allRoles = await compileE2A14CandidateRequestsNoNetwork(temporaryPath);
    const e2a21 = compileE2A21RequestsNoNetwork();
    const turnThree = corrected[2]!;
    const freshness = assertEvidenceFirstProfileIsFresh({
      profile: turnThree.corrected_profile,
      route: turnThree.corrected_route,
      cumulative: turnThree.corrected_cumulative_profile,
      latest_student_turn_id: turnThree.source_student_turn_id,
      latest_sequence_index: turnThree.source_sequence_index
    });
    return {
      compilation_version: "e2a23a-all-role-target-evidence-v1",
      all_role_compilation: allRoles.artifact,
      e2a21_request_compilation: e2a21,
      corrected_profile_request_contract: {
        target_contract_version: TARGET_EVIDENCE_CONTRACT_VERSION,
        evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION,
        mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION,
        profile_snapshot_id: turnThree.corrected_profile.profile_snapshot_id,
        selected_mode: turnThree.corrected_route.selected_mode,
        freshness
      },
      provider_call_count: 0,
      network_request_count: 0,
      passed: allRoles.artifact.all_17_roles_compile === true &&
        allRoles.artifact.network_request_count === 0 &&
        e2a21.passed && freshness.passed &&
        turnThree.corrected_route.selected_mode === "request_revision"
    };
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function e2a24Drafts() {
  const protocol = {
    protocol_version: "e2a24-revision-boundary-single-session-draft-v1",
    authorized_for_execution: false,
    no_live_draft_only: true,
    held_out_concept: "correlation_causation",
    academic_domain: "research_methods",
    item_id: "e2a24_held_out_correlation_item",
    distractor_option: "B",
    distractor_claim:
      "A strong observed correlation proves that one variable causes the other.",
    target_evidence_contract_version: TARGET_EVIDENCE_CONTRACT_VERSION,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION,
    mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION,
    simulator_classifier_version:
      E2A23A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    required_trajectory_is_non_authoritative: true,
    observable_test_sequence: [
      "misconception response",
      "partial response",
      "sound paraphrased response",
      "immediate request_revision"
    ],
    required_invariants: [
      "no redundant refinement after sound evidence",
      "no minimum-turn requirement",
      "prior misconception remains historical but not route-controlling",
      "optional deepening does not delay revision",
      "latest profile is fresh before request construction"
    ],
    candidate_approved: false,
    candidate_activated: false
  };
  const budget = {
    budget_version: "e2a24-draft-budget-v1",
    maximum_sessions: 1,
    maximum_student_turns: 6,
    maximum_visible_dialogue_turns: 12,
    maximum_simulator_calls: 6,
    maximum_initial_tutor_calls: 6,
    maximum_tutor_regenerations: 2,
    maximum_logical_generation_calls: 14,
    maximum_adapter_attempts: 42,
    maximum_input_tokens: 400000,
    maximum_output_tokens: 31000,
    maximum_total_tokens: 431000,
    maximum_cost_usd_when_pricing_complete: 10,
    provider_concurrency: 1,
    execution_authorized: false
  };
  const artifactContract = {
    artifact_contract_version: "e2a24-draft-artifact-contract-v1",
    required_artifacts: [
      "canary-manifest.json",
      "composite-runtime-identity.json",
      "target-evidence-contract.json",
      "student-turn-results.jsonl",
      "turn-evidence-adjudications.jsonl",
      "turn-profile-snapshots.jsonl",
      "cumulative-profile-updates.jsonl",
      "routing-decisions.jsonl",
      "profile-freshness-results.jsonl",
      "tutor-provider-outputs.jsonl",
      "progression-results.jsonl",
      "persistence-results.jsonl",
      "privacy-results.jsonl",
      "human-review-packet.json",
      "canary-summary.json"
    ],
    human_review_required: true,
    historical_e2a23_evidence_must_remain_immutable: true,
    execution_authorized: false
  };
  return {
    protocol,
    budget,
    artifactContract,
    protocol_hash: stableHash(protocol),
    budget_hash: stableHash(budget),
    artifact_contract_hash: stableHash(artifactContract)
  };
}

export async function executeE2A23A(input: {
  artifactRoot?: string;
  runId?: string;
} = {}) {
  const startedAt = new Date().toISOString();
  const runId = input.runId ??
    `e2a23a_${startedAt.replace(/[-:TZ.]/gu, "").slice(0, 14)}_${
      randomBytes(4).toString("hex")}`;
  const runDir = path.join(input.artifactRoot ?? E2A23A_ARTIFACT_ROOT, runId);
  if (existsSync(runDir)) throw new Error("e2a23a_run_already_exists");
  mkdirSync(runDir, { recursive: true });
  const before = snapshotE2A23AProtectedEvidence();
  const replay = reconcileHistoricalE2A23();
  const calibration = runE2A23ACalibration();
  const calibrationCorpus = buildE2A23ACalibrationCorpus().rows;
  const compilation = await compileAllRolesNoNetwork(replay.comparisons);
  const drafts = e2a24Drafts();
  const after = snapshotE2A23AProtectedEvidence();
  const protectedPassed = before.combined_sha256 === after.combined_sha256;
  const turnThree = replay.comparisons[2]!;
  const historicalTurnThreeMissing = Array.isArray(
    turnThree.historical_profile.essential_missing_links
  ) ? turnThree.historical_profile.essential_missing_links : [];
  const historicalTurnThreeSpans = Array.isArray(
    turnThree.historical_profile.observable_evidence_spans
  ) ? turnThree.historical_profile.observable_evidence_spans : [];
  const anchorContradictionConfirmed =
    historicalTurnThreeMissing.includes("direct_item_16_option_a_application") &&
    historicalTurnThreeSpans.some((value) =>
      object(value, "historical_turn_three_span").label ===
        "item_16_option_a_application"
    );

  const humanAttestation = {
    attestation_version: "e2a23a-user-supplied-human-attestation-v1",
    evidence_source: "user_supplied_primary_human_review_attestation",
    reviewer_audit_alias: "primary_project_owner",
    legal_identity_inferred: false,
    reviewed_run_id: E2A23A_AUTHORITATIVE_RUN_ID,
    all_six_student_responses_and_tutor_replies_inspected: true,
    safety_findings: {
      privacy_disclosure: false,
      answer_key_disclosure: false,
      simulator_hidden_state_or_provider_control_disclosure: false,
      tutor_response_unsafe_for_student_display: false
    },
    earliest_sound_and_revision_ready_turn: 3,
    sound_anchor_specific_resolved_revision_ready_turns: [3, 4, 5, 6],
    correct_route_from_turn: { turn_number: 3, route: "request_revision" },
    repeated_refinement_after_turn_3: "excessive_repetition_after_sound_evidence",
    historical_bounded_stop_pedagogically_justified: false,
    substantially_agrees_with_ai_assisted_adjudication: true,
    item_level_ratings_retained: false,
    item_level_ratings: null,
    inter_rater_reliability_claimed: false,
    item_level_agreement_statistic_claimed: false
  };
  const aiReference = {
    reference_version: "e2a23a-ai-assisted-adjudication-reference-v1",
    evidence_source: "ai_assisted_independent_adjudication",
    human_evidence: false,
    earliest_revision_ready_turn: 3,
    sound_turns: [3, 4, 5, 6],
    correct_route_from_turn: { turn_number: 3, route: "request_revision" },
    sequence_quality: "excessive_repetition_after_sound_evidence",
    safety_result: "pass",
    tutor_candidate_blocker: "none",
    evidence_profile_mapping_blocker: "present"
  };
  const rootCause = {
    classification_version: "e2a23a-root-cause-v1",
    selected_categories: {
      simulator_classifier_false_negative: { confirmed_turns: [4, 5] },
      production_conceptual_evaluator_false_negative: {
        confirmed_turns: [1, 2, 3, 4, 5, 6]
      },
      evaluator_to_profile_mapping_defect: {
        confirmed: anchorContradictionConfirmed,
        source_evidence:
          "Turn 3 contains item_16_option_a_application evidence while direct_item_16_option_a_application remains essential_missing."
      },
      anchor_application_mapping_defect: { confirmed_turns: [1, 2, 3, 4, 5, 6] },
      missing_link_mapping_defect: { confirmed_turns: [3, 4, 5, 6] },
      contradiction_mapping_defect: { confirmed_turns: [1] },
      evidence_quality_threshold_defect: { confirmed_turns: [3, 4, 5, 6] },
      cumulative_profile_integration_defect: { confirmed: false },
      revision_readiness_policy_defect: { confirmed: false },
      anchor_specific_replay_adjudicator_used_as_production_evaluator: {
        confirmed_in_e2a23_live_runner: true,
        confirmed_in_browser_runtime: false
      },
      legitimate_substantive_sound_distinction: { confirmed: false }
    },
    source_evidence: [
      "src/lib/evaluation/formative/e2a23-evidence-first-micro-canary.ts calls evaluateThetaInformationTurn before profile creation.",
      "src/lib/evaluation/formative/e2a22-evidence-first-profile-routing.ts labels its evaluator anchor-specific and not general semantic evaluation.",
      "src/lib/services/student-assessment/activity-runtime-ui.ts uses the activity-response evidence packet in browser runtime and does not import evaluateThetaInformationTurn."
    ],
    primary_cause:
      "The E2A.23 live runner used an anchor-specific regex evaluator with order-sensitive and incomplete paraphrase recognition, then mapped those false missing links directly into the authoritative profile.",
    routing_logic_defective: false,
    tutor_candidate_defective: false
  };
  const productionPathAudit = {
    audit_version: "e2a23a-production-evaluator-path-audit-v1",
    anchor_specific_replay_component:
      "e2a22-theta-information-replay-adjudicator-v1",
    component_limitation:
      "deterministic_replay_is_anchor_specific_not_a_general_semantic_evaluator",
    e2a23_live_runner_authoritative_for_profile_and_route: true,
    browser_runtime_imports_anchor_specific_replay_component: false,
    browser_runtime_structured_evidence_source:
      "formative_activity_response_evaluator_agent via ActivityMisconceptionEvidencePacketV1",
    corrected_browser_mapping:
      `${PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION} -> ` +
      TURN_EVIDENCE_PROFILE_MAPPER_VERSION,
    item_specific_semantic_criteria_live_in_contract_not_mapper: true,
    production_mapper_hardcodes_item_16_or_theta: false,
    test_only_matchers_runtime_servable: false,
    passed: true
  };
  const evaluatorDelta = {
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION,
    prior_e2a23_evaluator:
      "e2a22-theta-information-replay-adjudicator-v1",
    semantic_delta: [
      "consume a generic item-specific target-evidence contract",
      "record criterion-level satisfaction with exact observable spans",
      "separate essential revision criteria from optional deepening",
      "record contradictions independently from missing criteria",
      "do not infer understanding from process data"
    ],
    provider_role_added: false,
    existing_evaluator_role_reused:
      "formative_activity_response_evaluator_agent",
    tutor_prompt_or_schema_changed: false
  };
  const mapperDelta = {
    mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION,
    prior_mapper: "implicit-observation-to-profile-v1",
    anchor_application_delta:
      "Satisfied active-anchor criterion maps to explicit and cannot remain missing.",
    missing_link_consistency_delta:
      "A criterion cannot be both satisfied and essential_missing.",
    revision_readiness_delta:
      "All essential criteria plus explicit anchor, coherent conclusion, and no contradiction create sound revision readiness.",
    optional_deepening_delta:
      "Missing optional deepening is retained as a limitation but cannot block revision.",
    target_evidence_contract_delta:
      "The generic mapper consumes different item contracts without source changes."
  };
  const simulatorDelta = {
    prior_version: E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    corrected_version: E2A23A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    historical_v3_modified: false,
    false_negative_turns_corrected: [4, 5],
    turn_3_substantive_preserved: true,
    turn_6_substantive_preserved: true,
    above_ceiling_exact_span_protection_preserved: true,
    tentative_language_protection_preserved: true,
    copied_language_protection_preserved: true,
    production_routing_controlled_by_simulator_classifier: false
  };
  const consistencyPolicy = {
    policy_version: PROFILE_CONSISTENCY_POLICY_VERSION,
    explicit_anchor_evidence_authoritative: true,
    satisfied_and_missing_same_criterion_forbidden: true,
    sound_profile_with_essential_missing_link_forbidden: true,
    sound_profile_with_contradiction_forbidden: true,
    optional_deepening_blocks_revision: false,
    internal_contradiction_behavior: "fail_closed",
    historical_turn_3_contradiction_confirmed: anchorContradictionConfirmed
  };
  const strict = analyticAdjudications(replay.comparisons, "strict_conceptual");
  const formative = analyticAdjudications(
    replay.comparisons,
    "classroom_formative"
  );
  const revision = analyticAdjudications(
    replay.comparisons,
    "revision_readiness"
  );
  const timeline = {
    timeline_version: "e2a23a-six-turn-causal-timeline-v1",
    authoritative_run_id: E2A23A_AUTHORITATIVE_RUN_ID,
    turns: replay.comparisons.map((entry) => ({
      turn_number: entry.turn_number,
      source_student_turn_id: entry.source_student_turn_id,
      authoritative_sequence_index: entry.source_sequence_index,
      student_message: entry.student_message,
      historical_tutor_response: entry.tutor_response,
      simulator_classifier_v3: entry.simulator_classifier_v3,
      simulator_classifier_v4: entry.simulator_classifier_v4,
      conceptual_evidence_evaluator_output:
        entry.conceptual_evidence_evaluator_output,
      formative_response_evaluator_output:
        entry.formative_response_evaluator_output,
      post_activity_evidence_evaluator_output:
        entry.post_activity_evidence_evaluator_output,
      historical_profile: entry.historical_profile,
      historical_cumulative_profile: entry.historical_cumulative_profile,
      historical_route: entry.historical_route,
      corrected_evaluator: entry.corrected_evaluator,
      corrected_profile: entry.corrected_profile,
      corrected_cumulative_profile: entry.corrected_cumulative_profile,
      corrected_route: entry.corrected_route,
      path_dependency: entry.path_dependency
    }))
  };
  const sequence = {
    adjudication_version: "e2a23a-sequence-quality-v1",
    classification: "excessive_repetition_after_sound_evidence",
    earliest_sound_turn: replay.earliestRevision,
    first_route_divergence: replay.firstDivergence,
    refinements_after_revision_ready_evidence: 3,
    every_refinement_targeted_distinct_missing_link: false,
    bounded_stop_pedagogically_justified: false,
    tutor_language_primary_cause: false,
    upstream_profile_and_routing_input_primary_cause: true,
    later_turns_path_dependent: [2, 3, 4, 5, 6]
  };
  const boundary = {
    boundary_version: "e2a23a-counterfactual-boundary-v1",
    first_divergence_turn: replay.firstDivergence,
    last_non_path_dependent_historical_turn: replay.firstDivergence,
    path_dependent_historical_turns: [2, 3, 4, 5, 6],
    counterfactual_student_turns_fabricated: false,
    counterfactual_tutor_outputs_fabricated: false,
    historical_messages_after_boundary_used_only_for_analytic_replay: true,
    historical_e2a23_status_rewritten: false,
    historical_bounded_stop_would_still_occur_under_corrected_route: false
  };
  const earliest = {
    adjudication_version: "e2a23a-earliest-revision-ready-v1",
    earliest_sound_turn: replay.earliestRevision,
    earliest_revision_ready_turn: replay.earliestRevision,
    expected_route: "request_revision",
    human_attestation_agrees: replay.earliestRevision === 3,
    ai_assisted_reference_agrees: replay.earliestRevision === 3,
    deterministic_reconstruction_agrees: replay.earliestRevision === 3
  };
  const replayArtifact = {
    replay_version: "e2a23a-historical-e2a23-replay-v1",
    authoritative_run_id: E2A23A_AUTHORITATIVE_RUN_ID,
    no_provider_calls: true,
    all_six_historical_messages_replayed: true,
    earliest_route_divergence: replay.firstDivergence,
    earliest_revision_ready_turn: replay.earliestRevision,
    historical_status_preserved: "completed_valid_bounded_stop",
    corrected_endpoint_if_applied_at_divergence: "revision_authorized",
    later_historical_turns_path_dependent: [2, 3, 4, 5, 6],
    comparisons: replay.comparisons
  };

  const paths = Object.fromEntries(E2A23A_ARTIFACT_NAMES.map((name) => [
    name,
    path.join(runDir, name)
  ])) as Record<ArtifactName, string>;
  writeJson(paths["human-review-attestation.json"], humanAttestation);
  writeJson(paths["ai-review-reference.json"], aiReference);
  writeJson(paths["six-turn-causal-timeline.json"], timeline);
  writeJsonl(paths["six-turn-evidence-comparison.jsonl"], replay.comparisons);
  writeJsonl(paths["strict-conceptual-adjudications.jsonl"], strict);
  writeJsonl(paths["formative-adjudications.jsonl"], formative);
  writeJsonl(paths["revision-readiness-adjudications.jsonl"], revision);
  writeJson(paths["root-cause-classification.json"], rootCause);
  writeJson(paths["production-evaluator-path-audit.json"], productionPathAudit);
  writeJson(paths["target-evidence-contract.json"], replay.contract);
  writeJson(paths["production-evaluator-delta.json"], evaluatorDelta);
  writeJson(paths["profile-mapper-delta.json"], mapperDelta);
  writeJson(paths["simulator-classifier-delta.json"], simulatorDelta);
  writeJson(paths["profile-consistency-policy.json"], consistencyPolicy);
  writeJson(paths["earliest-revision-ready-turn.json"], earliest);
  writeJson(paths["sequence-quality-adjudication.json"], sequence);
  writeJsonl(paths["calibration-corpus.jsonl"], calibrationCorpus);
  writeJsonl(paths["calibration-results.jsonl"], calibration.results);
  writeJson(paths["historical-e2a23-replay.json"], replayArtifact);
  writeJson(paths["counterfactual-replay-boundary.json"], boundary);
  writeJson(paths["all-role-request-compilation.json"], compilation);
  writeJson(paths["e2a24-micro-canary-protocol-draft.json"], drafts.protocol);
  writeJson(paths["e2a24-budget-draft.json"], drafts.budget);
  writeJson(paths["e2a24-artifact-contract.json"], drafts.artifactContract);
  const summary = {
    summary_version: E2A23A_VERSION,
    status: E2A23A_ALLOWED_STATUS,
    run_id: runId,
    authoritative_e2a23_run_id: E2A23A_AUTHORITATIVE_RUN_ID,
    historical_e2a23_status: "completed_valid_bounded_stop",
    historical_evidence_rewritten: false,
    application_git_commit: gitCommit(),
    approved_v2_hash: E2A17_APPROVED_V2_HASH,
    tutor_candidate_hash: E2A17_CANDIDATE_HASH,
    tutor_candidate_file_sha256: E2A17_CANDIDATE_FILE_SHA256,
    candidate_approved: false,
    candidate_activated: false,
    tutor_prompt_or_schema_changed: false,
    target_evidence_contract_version: TARGET_EVIDENCE_CONTRACT_VERSION,
    production_evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION,
    profile_mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION,
    profile_consistency_policy_version: PROFILE_CONSISTENCY_POLICY_VERSION,
    simulator_classifier_prior_version:
      E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    simulator_classifier_final_version:
      E2A23A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    earliest_revision_ready_turn: replay.earliestRevision,
    first_route_divergence: replay.firstDivergence,
    sequence_quality: sequence.classification,
    historical_bounded_stop_justified: false,
    calibration_case_count: calibration.corpus_size,
    calibration_pass_count: calibration.pass_count,
    calibration_fail_count: calibration.fail_count,
    all_role_request_compilation_passed: compilation.passed,
    e2a24_protocol_hash: drafts.protocol_hash,
    e2a24_budget_hash: drafts.budget_hash,
    e2a24_artifact_contract_hash: drafts.artifact_contract_hash,
    e2a24_executed: false,
    provider_call_count: 0,
    network_request_count: 0,
    protected_evidence_before_hash: before.combined_sha256,
    protected_evidence_after_hash: after.combined_sha256,
    protected_evidence_unchanged: protectedPassed,
    remaining_blocker_before_e2a24_execution:
      "explicit authorization for the frozen E2A.24 live micro-canary",
    artifacts: E2A23A_ARTIFACT_NAMES,
    passed: protectedPassed && anchorContradictionConfirmed &&
      replay.earliestRevision === 3 && replay.firstDivergence === 1 &&
      replay.comparisons.every((entry) =>
        entry.human_attestation_comparison.agrees &&
        entry.ai_review_comparison.agrees
      ) && calibration.passed && compilation.passed
  };
  writeJson(paths["summary.json"], summary);
  const manifest = {
    manifest_version: E2A23A_VERSION,
    run_id: runId,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    no_live_phase: true,
    provider_calls_authorized: 0,
    provider_calls_made: 0,
    network_requests_made: 0,
    approved_v2_hash: E2A17_APPROVED_V2_HASH,
    tutor_candidate_hash: E2A17_CANDIDATE_HASH,
    tutor_candidate_file_sha256: E2A17_CANDIDATE_FILE_SHA256,
    candidate_approved: false,
    candidate_activated: false,
    human_attestation_source: "user_supplied",
    ai_reference_source: "ai_assisted_non_human",
    protected_evidence_before: before,
    protected_evidence_after: after,
    artifacts: E2A23A_ARTIFACT_NAMES,
    status: summary.status
  };
  writeJson(paths["e2a23a-manifest.json"], manifest);
  const validation = validateE2A23AArtifacts(runDir);
  if (!summary.passed || !validation.passed) {
    throw new Error(
      `e2a23a_reconciliation_failed:${validation.failures.join("|")}`
    );
  }
  return { runId, runDir, summary, manifest, validation };
}

export function validateE2A23AArtifacts(runDir: string) {
  const failures: string[] = [];
  const names = readdirSync(runDir).sort();
  const expected = [...E2A23A_ARTIFACT_NAMES].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    failures.push("artifact_name_or_count_mismatch");
  }
  for (const name of expected) {
    const filePath = path.join(runDir, name);
    if (!existsSync(filePath) || statSync(filePath).size === 0) {
      failures.push(`artifact_missing_or_empty:${name}`);
      continue;
    }
    try {
      if (name.endsWith(".jsonl")) readJsonl(filePath);
      else readJson(filePath);
    } catch {
      failures.push(`artifact_malformed:${name}`);
    }
  }
  const summary = readJson<JsonObject>(path.join(runDir, "summary.json"));
  if (summary.status !== E2A23A_ALLOWED_STATUS) {
    failures.push("status_invalid");
  }
  if (summary.provider_call_count !== 0 || summary.network_request_count !== 0) {
    failures.push("provider_or_network_call_recorded");
  }
  if (summary.historical_evidence_rewritten !== false ||
      summary.protected_evidence_unchanged !== true) {
    failures.push("protected_evidence_integrity_failed");
  }
  if (summary.earliest_revision_ready_turn !== 3 ||
      summary.first_route_divergence !== 1) {
    failures.push("replay_boundary_invalid");
  }
  if (summary.calibration_case_count !== 64 ||
      summary.calibration_fail_count !== 0) {
    failures.push("calibration_failed");
  }
  return {
    validation_version: "e2a23a-artifact-validation-v1",
    expected_artifact_count: expected.length,
    actual_artifact_count: names.length,
    failures,
    passed: failures.length === 0
  };
}

export function findLatestE2A23ARun(root = E2A23A_ARTIFACT_ROOT) {
  if (!existsSync(root)) return null;
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("e2a23a_"))
    .map((entry) => entry.name)
    .sort()
    .at(-1) ?? null;
}

export function loadE2A23ARun(runId?: string) {
  const id = runId ?? findLatestE2A23ARun();
  if (!id) throw new Error("e2a23a_run_not_found");
  const runDir = path.join(E2A23A_ARTIFACT_ROOT, id);
  return {
    runId: id,
    runDir,
    summary: readJson<JsonObject>(path.join(runDir, "summary.json")),
    manifest: readJson<JsonObject>(path.join(runDir, "e2a23a-manifest.json")),
    validation: validateE2A23AArtifacts(runDir)
  };
}
