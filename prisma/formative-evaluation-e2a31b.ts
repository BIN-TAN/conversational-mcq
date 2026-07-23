import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
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
import { z } from "zod";
import { stableHash } from "../src/lib/operational/stable-hash";
import {
  buildActiveAnchorAliasContract,
  ActiveAnchorAliasContractSchema
} from "../src/lib/services/student-assessment/active-anchor-alias-resolution";
import {
  ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V2,
  resolveActiveAnchorAliasV2
} from "../src/lib/services/student-assessment/active-anchor-alias-resolution-v2";
import {
  ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V3,
  resolveActiveAnchorAliasV3
} from "../src/lib/services/student-assessment/active-anchor-alias-resolution-v3";
import {
  ANCHOR_STANCE_RESOLUTION_VERSION
} from "../src/lib/services/student-assessment/anchor-stance-resolution-v1";
import {
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
  ProductionTurnEvidenceEvaluatorInputV5Schema
} from "../src/lib/services/student-assessment/production-turn-evidence-evaluator-v5";

const VERSION = "e2a31a-anchor-stance-resolution-correction-v1" as const;
const PROTOCOL_VERSION =
  "e2a31b-ecology-anchor-stance-resolution-canary-v1" as const;
const ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a31b-anchor-stance-resolution-protocol"
);
const HISTORICAL_RUN_ID = "e2a31_20260723031323_56517518";
const HISTORICAL_RUN = path.join(
  process.cwd(),
  ".data",
  "e2a31-ecology-held-out-autonomous-canary",
  HISTORICAL_RUN_ID
);
const HISTORICAL_STATUS = "e2a31_canary_failed_anchor_resolution";
const HISTORICAL_CANARY_SUMMARY_SHA =
  "15428e60dcc9c5cc9fe0f68bfa8b3dc3de53a93d930847dbb2020edd1d99d847";
const HISTORICAL_SIMULATOR_OUTPUT_SHA =
  "67d55d7d32304b3bd0b9dbb4a827a104136e2d75f9da199d7755c969f360233d";
const HISTORICAL_ALIAS_RESULTS_SHA =
  "aac875cc07ac8a3c8dd6e07959cd37f7e74684a58a99ceb68001130639acfdf4";
const E2A31A_FREEZE_REQUEST = path.join(
  process.cwd(),
  ".data",
  "e2a31a-ecology-held-out-protocol-freeze",
  "e2a31a_20260723T020426424Z_a2b444da",
  "compiled-evaluator-v5-request.json"
);
const CANDIDATE_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";
const EXPECTED_PROTECTED_HASHES = {
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json":
    "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2",
  "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts":
    "b57df1ed269ef1e5f7e2ec7ad3c394d0c7b247afa54c7d067598caa3e47eda09",
  "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts":
    "6ff02d152f95608235d78592a6a1d4970a1ed1f2d7477bbaaaca7e96a878f9cd",
  "src/lib/services/student-assessment/active-anchor-alias-resolution-v2.ts":
    "4df5bd76487ae081ce9a5d538f6f8a405fdabcc91a95b3200c0d9b891904a700"
} as const;

const REQUIRED_ARTIFACTS = [
  "correction-manifest.json",
  "anchor-stance-calibration.json",
  "e2a31-first-boundary-replay.json",
  "e2a31-historical-integrity-before.json",
  "e2a31-historical-integrity-after.json",
  "compiled-evaluator-v5-request.json",
  "e2a31b-budget.json",
  "e2a31b-artifact-contract.json",
  "e2a31b-protocol.json",
  "e2a31b-protocol.sha256",
  "protected-source-integrity.json",
  "composite-runtime-identity.json",
  "provider-call-guard.json",
  "summary.json",
  "artifact-validation.json"
] as const;

let networkRequestCount = 0;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a31b_network_request_prohibited");
};

type JsonRecord = Record<string, unknown>;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function fileSha(filePath: string) {
  return sha256(readFileSync(filePath));
}

function relativeFileSha(relativePath: string) {
  return fileSha(path.join(process.cwd(), relativePath));
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonLines<T>(filePath: string): T[] {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/gu)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function listFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const fullPath = path.join(root, name);
    return statSync(fullPath).isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

function hashTree(root: string) {
  if (!existsSync(root)) {
    throw new Error(`e2a31b_historical_tree_missing:${root}`);
  }
  const files = listFiles(root).sort().map((filePath) => ({
    path: path.relative(root, filePath),
    sha256: fileSha(filePath)
  }));
  return {
    tree_hash_version: "e2a31b-stable-file-inventory-v1",
    root: path.relative(process.cwd(), root),
    file_count: files.length,
    tree_sha256: stableHash(files),
    files
  };
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

function makeRunId() {
  const timestamp = new Date().toISOString().replace(/[-:.Z]/gu, "");
  return `e2a31b_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function protectedSourceIntegrity() {
  const actual = Object.fromEntries(Object.keys(EXPECTED_PROTECTED_HASHES).map(
    (relativePath) => [relativePath, relativeFileSha(relativePath)]
  ));
  const mismatches = Object.entries(EXPECTED_PROTECTED_HASHES)
    .filter(([relativePath, expected]) => actual[relativePath] !== expected)
    .map(([relativePath, expected]) => ({
      relative_path: relativePath,
      expected_sha256: expected,
      actual_sha256: actual[relativePath]
    }));
  return {
    integrity_version: "e2a31b-protected-source-integrity-v1",
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
    frozen_v2_resolver_unchanged: actual[
      "src/lib/services/student-assessment/active-anchor-alias-resolution-v2.ts"
    ] === EXPECTED_PROTECTED_HASHES[
      "src/lib/services/student-assessment/active-anchor-alias-resolution-v2.ts"
    ],
    candidate_configuration_hash: CANDIDATE_HASH,
    expected_sha256: EXPECTED_PROTECTED_HASHES,
    actual_sha256: actual,
    mismatches,
    passed: mismatches.length === 0
  };
}

type CalibrationDomain = {
  domain_id: string;
  option_label: string;
  option_text: string;
  paraphrase: string;
};

const CALIBRATION_DOMAINS: CalibrationDomain[] = [
  {
    domain_id: "generic_direct_pathway",
    option_label: "D",
    option_text: "The direct pathway always guarantees the final outcome.",
    paraphrase: "the direct effect guarantees the final result"
  },
  {
    domain_id: "generic_association",
    option_label: "B",
    option_text: "An observed association always proves the proposed cause.",
    paraphrase: "the association proves the cause"
  },
  {
    domain_id: "generic_measurement",
    option_label: "C",
    option_text: "A larger observed measure always proves more of the construct.",
    paraphrase: "the larger measure proves more of the construct"
  },
  {
    domain_id: "generic_generalization",
    option_label: "A",
    option_text: "One matching example always establishes the general rule.",
    paraphrase: "one example proves the general rule"
  },
  {
    domain_id: "generic_sequence",
    option_label: "D",
    option_text: "The first visible effect always determines the final outcome.",
    paraphrase: "the first effect determines the final result"
  },
  {
    domain_id: "generic_interpretation",
    option_label: "C",
    option_text: "A single indicator always proves the intended interpretation.",
    paraphrase: "one indicator proves the interpretation"
  },
  {
    domain_id: "generic_prediction",
    option_label: "B",
    option_text: "A repeated pattern always guarantees the next result.",
    paraphrase: "the pattern guarantees what happens next"
  },
  {
    domain_id: "generic_boundary",
    option_label: "A",
    option_text: "A result in one condition always applies in every condition.",
    paraphrase: "the result applies in every condition"
  }
];

type CalibrationArchetype = {
  archetype_id: string;
  expected_stance:
    | "endorses_distractor"
    | "rejects_distractor"
    | "ambiguous";
  message: (domain: CalibrationDomain) => string;
  prior_reasoning?: (domain: CalibrationDomain) => string[];
  expected_prior_used?: boolean;
};

const CALIBRATION_ARCHETYPES: CalibrationArchetype[] = [
  {
    archetype_id: "keep_option",
    expected_stance: "endorses_distractor",
    message: (domain) => `I keep option ${domain.option_label}`
  },
  {
    archetype_id: "would_keep_label",
    expected_stance: "endorses_distractor",
    message: (domain) => `I would keep ${domain.option_label}`
  },
  {
    archetype_id: "still_correct",
    expected_stance: "endorses_distractor",
    message: (domain) => `${domain.option_label} is still correct`
  },
  {
    archetype_id: "choose_option",
    expected_stance: "endorses_distractor",
    message: (domain) => `I choose option ${domain.option_label}`
  },
  {
    archetype_id: "makes_sense",
    expected_stance: "endorses_distractor",
    message: (domain) => `Option ${domain.option_label} makes sense`
  },
  {
    archetype_id: "retain_as_answer",
    expected_stance: "endorses_distractor",
    message: (domain) => `I retain ${domain.option_label} as my answer`
  },
  {
    archetype_id: "keep_as_distractor",
    expected_stance: "rejects_distractor",
    message: (domain) => `Keep ${domain.option_label} as a distractor`
  },
  {
    archetype_id: "contrast_rejection",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `${domain.option_label} sounds right but is wrong`
  },
  {
    archetype_id: "direct_rejection",
    expected_stance: "rejects_distractor",
    message: (domain) => `I reject option ${domain.option_label}`
  },
  {
    archetype_id: "negated_positive",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `Option ${domain.option_label} is not correct`
  },
  {
    archetype_id: "negated_negative",
    expected_stance: "endorses_distractor",
    message: (domain) =>
      `Option ${domain.option_label} is not wrong`
  },
  {
    archetype_id: "plausible_but_wrong",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `Option ${domain.option_label} looks plausible, but it is wrong`
  },
  {
    archetype_id: "unsure",
    expected_stance: "ambiguous",
    message: (domain) => `I am unsure about ${domain.option_label}`
  },
  {
    archetype_id: "maybe",
    expected_stance: "ambiguous",
    message: (domain) => `Maybe ${domain.option_label}`
  },
  {
    archetype_id: "might_be_right",
    expected_stance: "ambiguous",
    message: (domain) => `${domain.option_label} might be right`
  },
  {
    archetype_id: "prior_rejection_continuity",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `My view of option ${domain.option_label} is unchanged`,
    prior_reasoning: (domain) => [
      `I reject option ${domain.option_label} because its claim is too strong`
    ],
    expected_prior_used: true
  },
  {
    archetype_id: "prior_endorsement_continuity",
    expected_stance: "endorses_distractor",
    message: (domain) =>
      `I still hold the same view about option ${domain.option_label}`,
    prior_reasoning: (domain) => [
      `I choose option ${domain.option_label} because the claim fits my reasoning`
    ],
    expected_prior_used: true
  },
  {
    archetype_id: "uncertainty_overrides_prior",
    expected_stance: "ambiguous",
    message: (domain) =>
      `I am still unsure about option ${domain.option_label}`,
    prior_reasoning: (domain) => [
      `I choose option ${domain.option_label} because the claim fits my reasoning`
    ],
    expected_prior_used: false
  }
];

function calibrationContract(domain: CalibrationDomain) {
  return buildActiveAnchorAliasContract({
    active_anchor_id: `${domain.domain_id}:option:${domain.option_label}`,
    option_label: domain.option_label,
    option_text: domain.option_text,
    accepted_paraphrases: [domain.paraphrase]
  });
}

function runCalibration() {
  const results = CALIBRATION_DOMAINS.flatMap((domain) => {
    const contract = calibrationContract(domain);
    return CALIBRATION_ARCHETYPES.map((archetype, archetypeIndex) => {
      const message = archetype.message(domain);
      const result = resolveActiveAnchorAliasV3({
        message,
        contract,
        source_turn_id:
          `calibration_${domain.domain_id}_${archetype.archetype_id}`,
        source_sequence_index: archetypeIndex + 1,
        prior_visible_message:
          `We are reviewing option ${domain.option_label}.`,
        prior_student_reasoning:
          archetype.prior_reasoning?.(domain) ?? []
      });
      const priorUsed =
        result.independent_stance_resolution.prior_reasoning_used;
      const passed =
        result.observed_anchor_reference === "explicit" &&
        result.observed_anchor_stance === archetype.expected_stance &&
        (archetype.expected_prior_used === undefined ||
          priorUsed === archetype.expected_prior_used);
      return {
        case_id: `${domain.domain_id}:${archetype.archetype_id}`,
        domain_id: domain.domain_id,
        archetype_id: archetype.archetype_id,
        message,
        expected_stance: archetype.expected_stance,
        observed_reference: result.observed_anchor_reference,
        observed_stance: result.observed_anchor_stance,
        resolution_basis:
          result.independent_stance_resolution.resolution_basis,
        cue_codes: result.independent_stance_resolution.cue_codes,
        prior_reasoning_used: priorUsed,
        passed
      };
    });
  });
  const requiredMessages = [
    "I keep option D",
    "I would keep D",
    "D is still correct",
    "Keep D as a distractor",
    "D sounds right but is wrong",
    "I am unsure about D",
    "Maybe D"
  ];
  const requiredCoverage = requiredMessages.map((message) => ({
    message,
    present: results.some((entry) => entry.message === message),
    passed: results.some((entry) => entry.message === message && entry.passed)
  }));
  const categoryCounts = results.reduce<Record<string, number>>(
    (counts, entry) => {
      counts[entry.expected_stance] =
        (counts[entry.expected_stance] ?? 0) + 1;
      return counts;
    },
    {}
  );
  return {
    calibration_version: "e2a31b-anchor-stance-calibration-v1",
    resolver_version: ANCHOR_STANCE_RESOLUTION_VERSION,
    composed_resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V3,
    case_count: results.length,
    minimum_required_case_count: 120,
    category_counts: categoryCounts,
    required_message_coverage: requiredCoverage,
    results,
    passed: results.length >= 120 &&
      results.every((entry) => entry.passed) &&
      requiredCoverage.every((entry) => entry.present && entry.passed),
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  };
}

const SimulatorOutputSchema = z.object({
  session_id: z.string(),
  turn: z.number().int(),
  attempt: z.number().int(),
  parsed_structured_output: z.object({
    student_message: z.string().min(1)
  }).passthrough()
}).passthrough();

function historicalIntegrity() {
  const tree = hashTree(HISTORICAL_RUN);
  const canarySummaryPath = path.join(HISTORICAL_RUN, "canary-summary.json");
  const simulatorOutputPath = path.join(
    HISTORICAL_RUN,
    "simulator-provider-outputs.jsonl"
  );
  const aliasResultsPath = path.join(
    HISTORICAL_RUN,
    "anchor-alias-resolution-results.jsonl"
  );
  const summary = readJson<JsonRecord>(canarySummaryPath);
  const criticalHashes = {
    canary_summary_sha256: fileSha(canarySummaryPath),
    simulator_provider_outputs_sha256: fileSha(simulatorOutputPath),
    anchor_alias_resolution_results_sha256: fileSha(aliasResultsPath)
  };
  const passed = summary.status === HISTORICAL_STATUS &&
    criticalHashes.canary_summary_sha256 ===
      HISTORICAL_CANARY_SUMMARY_SHA &&
    criticalHashes.simulator_provider_outputs_sha256 ===
      HISTORICAL_SIMULATOR_OUTPUT_SHA &&
    criticalHashes.anchor_alias_resolution_results_sha256 ===
      HISTORICAL_ALIAS_RESULTS_SHA;
  return {
    integrity_version: "e2a31b-historical-evidence-integrity-v1",
    historical_run_id: HISTORICAL_RUN_ID,
    historical_status: summary.status,
    expected_historical_status: HISTORICAL_STATUS,
    historical_e2a31_passed: false,
    tree,
    critical_hashes: criticalHashes,
    passed
  };
}

function replayFirstFailingBoundary() {
  const simulatorRows = readJsonLines<unknown>(path.join(
    HISTORICAL_RUN,
    "simulator-provider-outputs.jsonl"
  )).map((row) => SimulatorOutputSchema.parse(row));
  const boundary = simulatorRows.find((row) =>
    row.session_id === "E2A31-ECOLOGY" &&
    row.turn === 3 &&
    row.attempt === 1
  );
  if (!boundary) {
    throw new Error("e2a31b_first_failing_boundary_missing");
  }
  const priorStudentReasoning = simulatorRows
    .filter((row) =>
      row.session_id === boundary.session_id &&
      row.turn < boundary.turn &&
      row.attempt === 1
    )
    .sort((left, right) => left.turn - right.turn)
    .map((row) => row.parsed_structured_output.student_message);
  const contract = ActiveAnchorAliasContractSchema.parse(readJson(
    path.join(HISTORICAL_RUN, "ecology-alias-contract.json")
  ));
  const message = boundary.parsed_structured_output.student_message;
  const frozenV2 = resolveActiveAnchorAliasV2({
    message,
    contract,
    source_turn_id: "student_E2A31-ECOLOGY_3",
    source_sequence_index: 6,
    prior_visible_message:
      "Complete this sentence: I would keep or reject option D because..."
  });
  const corrected = resolveActiveAnchorAliasV3({
    message,
    contract,
    source_turn_id: "student_E2A31-ECOLOGY_3",
    source_sequence_index: 6,
    prior_visible_message:
      "Complete this sentence: I would keep or reject option D because...",
    prior_student_reasoning: priorStudentReasoning
  });
  return {
    replay_version: "e2a31b-first-failing-boundary-replay-v1",
    replay_mode: "immutable_provider_output_no_provider_dispatch",
    historical_run_id: HISTORICAL_RUN_ID,
    session_id: boundary.session_id,
    turn: boundary.turn,
    attempt: boundary.attempt,
    source_provider_output_sha256: HISTORICAL_SIMULATOR_OUTPUT_SHA,
    source_student_message_sha256: sha256(message),
    source_message_preserved_in_historical_artifact_only: true,
    frozen_v2: {
      resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V2,
      observed_reference:
        frozenV2.independent_text_resolution.observed_anchor_reference,
      observed_stance:
        frozenV2.independent_text_resolution.observed_anchor_stance,
      reproduced_historical_failure:
        frozenV2.independent_text_resolution.observed_anchor_reference ===
          "explicit" &&
        frozenV2.independent_text_resolution.observed_anchor_stance ===
          "ambiguous"
    },
    corrected_v3: {
      resolver_version: corrected.resolver_version,
      reference_resolver_version: corrected.reference_resolver_version,
      stance_resolver_version: corrected.stance_resolver_version,
      observed_reference:
        corrected.independent_reference_resolution.observed_anchor_reference,
      observed_stance:
        corrected.independent_stance_resolution.observed_anchor_stance,
      resolution_basis:
        corrected.independent_stance_resolution.resolution_basis,
      cue_codes: corrected.independent_stance_resolution.cue_codes,
      prior_reasoning_considered:
        corrected.independent_stance_resolution.prior_reasoning_considered,
      prior_reasoning_used:
        corrected.independent_stance_resolution.prior_reasoning_used
    },
    e2a31_historical_status_unchanged: HISTORICAL_STATUS,
    e2a31_pass_claimed: false,
    passed:
      frozenV2.independent_text_resolution.observed_anchor_reference ===
        "explicit" &&
      frozenV2.independent_text_resolution.observed_anchor_stance ===
        "ambiguous" &&
      corrected.independent_reference_resolution.observed_anchor_reference ===
        "explicit" &&
      corrected.independent_stance_resolution.observed_anchor_stance ===
        "endorses_distractor",
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  };
}

function compiledEvaluatorRequest() {
  const source = readJson<JsonRecord>(E2A31A_FREEZE_REQUEST);
  const parsedInput = ProductionTurnEvidenceEvaluatorInputV5Schema.parse(
    source.input
  );
  const compiled = {
    request_compilation_version: "e2a31b-evaluator-v5-request-v1",
    compilation_mode: "compile_only_no_provider",
    agent_name: source.agent_name,
    model_config: source.model_config,
    prompt_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
    prompt_hash: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    input_schema_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
    output_schema_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
    schema_name: PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
    input: parsedInput,
    metadata: {
      evaluation_phase: "e2a31b_protocol_only_no_live",
      execution_authorized: "false",
      anchor_reference_resolver_version:
        "active-anchor-alias-resolution-v1",
      anchor_stance_resolver_version: ANCHOR_STANCE_RESOLUTION_VERSION,
      composed_anchor_resolver_version:
        ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V3
    },
    provider_dispatch_performed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  };
  const serialized = JSON.stringify(compiled);
  const oldContractHits = [
    "production-turn-evidence-evaluator-v1",
    "production-turn-evidence-evaluator-v2",
    "production-turn-evidence-evaluator-v3",
    "production-turn-evidence-evaluator-v4"
  ].filter((value) => serialized.includes(value));
  return {
    ...compiled,
    canonical_request_hash: stableHash(compiled),
    old_evaluator_contract_matches: oldContractHits,
    passed:
      oldContractHits.length === 0 &&
      parsedInput.schema_version ===
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5
  };
}

function buildBudget() {
  return {
    budget_version: "e2a31b-bounded-live-budget-v1",
    execution_authorized: false,
    protocol_only: true,
    isolated_session_limit: 1,
    maximum_logical_calls: 29,
    maximum_adapter_attempts: 87,
    maximum_adapter_attempts_per_logical_call: 3,
    maximum_transport_retries_per_logical_call: 2,
    maximum_input_tokens: 900_000,
    maximum_output_tokens: 70_000,
    maximum_total_tokens: 970_000,
    maximum_cost_usd_when_pricing_available: 25,
    provider_concurrency: 1,
    passed: true
  };
}

function buildArtifactContract() {
  const historicalArtifactNames = listFiles(HISTORICAL_RUN)
    .map((filePath) => path.relative(HISTORICAL_RUN, filePath))
    .sort();
  const requiredFutureArtifacts = [...new Set([
    ...historicalArtifactNames,
    "anchor-stance-resolution-results.jsonl"
  ])].sort();
  return {
    artifact_contract_version: "e2a31b-artifact-contract-v1",
    execution_authorized: false,
    historical_e2a31_artifacts_are_read_only: true,
    historical_artifact_count: historicalArtifactNames.length,
    required_future_live_artifacts: requiredFutureArtifacts,
    required_future_live_artifact_count: requiredFutureArtifacts.length,
    correction_specific_artifacts: [
      "anchor-stance-resolution-results.jsonl",
      "anchor-alias-resolution-results.jsonl",
      "canonical-anchor-evidence-results.jsonl",
      "anchor-parity-reconciliation-results.jsonl"
    ],
    passed: historicalArtifactNames.length > 0 &&
      requiredFutureArtifacts.includes(
        "anchor-stance-resolution-results.jsonl"
      )
  };
}

function buildProtocol(input: {
  calibration: ReturnType<typeof runCalibration>;
  replay: ReturnType<typeof replayFirstFailingBoundary>;
  compiledRequest: ReturnType<typeof compiledEvaluatorRequest>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
  historical: ReturnType<typeof historicalIntegrity>;
  protectedSources: ReturnType<typeof protectedSourceIntegrity>;
}) {
  const sourceHashes = {
    reference_resolver_v1_sha256: relativeFileSha(
      "src/lib/services/student-assessment/active-anchor-alias-resolution.ts"
    ),
    stance_resolver_v1_sha256: relativeFileSha(
      "src/lib/services/student-assessment/anchor-stance-resolution-v1.ts"
    ),
    composed_resolver_v3_sha256: relativeFileSha(
      "src/lib/services/student-assessment/active-anchor-alias-resolution-v3.ts"
    )
  };
  const protocol = {
    protocol_version: PROTOCOL_VERSION,
    correction_version: VERSION,
    protocol_state: "frozen_protocol_only",
    execution_authorized: false,
    live_execution_performed: false,
    e2a31_rerun_performed: false,
    historical_e2a31_run_id: HISTORICAL_RUN_ID,
    historical_e2a31_status: HISTORICAL_STATUS,
    historical_e2a31_passed: false,
    candidate_configuration_hash: CANDIDATE_HASH,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    evaluator_prompt_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
    evaluator_prompt_hash: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
    evaluator_input_schema:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
    evaluator_output_schema:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
    reference_resolver_version: "active-anchor-alias-resolution-v1",
    stance_resolver_version: ANCHOR_STANCE_RESOLUTION_VERSION,
    composed_resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V3,
    source_hashes: sourceHashes,
    calibration_hash: stableHash(input.calibration),
    replay_hash: stableHash(input.replay),
    evaluator_request_hash:
      input.compiledRequest.canonical_request_hash,
    budget_hash: stableHash(input.budget),
    artifact_contract_hash: stableHash(input.artifactContract),
    historical_evidence_tree_hash:
      input.historical.tree.tree_sha256,
    protected_source_hashes:
      input.protectedSources.actual_sha256,
    gates: {
      calibration_passed: input.calibration.passed,
      immutable_replay_passed: input.replay.passed,
      evaluator_v5_request_passed: input.compiledRequest.passed,
      budget_valid: input.budget.passed,
      artifact_contract_valid: input.artifactContract.passed,
      historical_evidence_unchanged: input.historical.passed,
      evaluator_v5_unchanged:
        input.protectedSources.evaluator_v5_unchanged,
      tutor_candidate_unchanged:
        input.protectedSources.tutor_candidate_unchanged,
      provider_call_guard_passed: networkRequestCount === 0
    }
  };
  return {
    ...protocol,
    protocol_hash: stableHash(protocol),
    passed: Object.values(protocol.gates).every(Boolean)
  };
}

function buildCompositeIdentity(input: {
  protocol: ReturnType<typeof buildProtocol>;
  historical: ReturnType<typeof historicalIntegrity>;
}) {
  const identity = {
    identity_version: "e2a31b-composite-runtime-identity-v1",
    preparation_base_commit: currentCommit(),
    candidate_configuration_hash: CANDIDATE_HASH,
    protocol_hash: input.protocol.protocol_hash,
    reference_resolver_version: "active-anchor-alias-resolution-v1",
    stance_resolver_version: ANCHOR_STANCE_RESOLUTION_VERSION,
    composed_resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V3,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    evaluator_prompt_hash: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
    historical_e2a31_run_id: HISTORICAL_RUN_ID,
    historical_e2a31_status: HISTORICAL_STATUS,
    historical_evidence_tree_hash:
      input.historical.tree.tree_sha256,
    execution_authorized: false
  };
  return {
    ...identity,
    composite_runtime_identity_hash: stableHash(identity)
  };
}

function buildAll(outputDirectory: string) {
  mkdirSync(outputDirectory, { recursive: true });
  const historicalBefore = historicalIntegrity();
  const protectedSources = protectedSourceIntegrity();
  const calibration = runCalibration();
  const replay = replayFirstFailingBoundary();
  const compiledRequest = compiledEvaluatorRequest();
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const protocol = buildProtocol({
    calibration,
    replay,
    compiledRequest,
    budget,
    artifactContract,
    historical: historicalBefore,
    protectedSources
  });
  const compositeIdentity = buildCompositeIdentity({
    protocol,
    historical: historicalBefore
  });
  const historicalAfter = historicalIntegrity();
  const historicalUnchanged = historicalBefore.tree.tree_sha256 ===
      historicalAfter.tree.tree_sha256 &&
    historicalBefore.tree.file_count === historicalAfter.tree.file_count &&
    historicalBefore.passed &&
    historicalAfter.passed;

  writeJson(path.join(outputDirectory, "correction-manifest.json"), {
    correction_version: VERSION,
    protocol_version: PROTOCOL_VERSION,
    run_mode: "deterministic_protocol_preparation_only",
    live_execution_authorized: false,
    live_execution_performed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  });
  writeJson(
    path.join(outputDirectory, "anchor-stance-calibration.json"),
    calibration
  );
  writeJson(
    path.join(outputDirectory, "e2a31-first-boundary-replay.json"),
    replay
  );
  writeJson(
    path.join(outputDirectory, "e2a31-historical-integrity-before.json"),
    historicalBefore
  );
  writeJson(
    path.join(outputDirectory, "e2a31-historical-integrity-after.json"),
    historicalAfter
  );
  writeJson(
    path.join(outputDirectory, "compiled-evaluator-v5-request.json"),
    compiledRequest
  );
  writeJson(path.join(outputDirectory, "e2a31b-budget.json"), budget);
  writeJson(
    path.join(outputDirectory, "e2a31b-artifact-contract.json"),
    artifactContract
  );
  writeJson(path.join(outputDirectory, "e2a31b-protocol.json"), protocol);
  writeFileSync(
    path.join(outputDirectory, "e2a31b-protocol.sha256"),
    `${protocol.protocol_hash}\n`,
    "utf8"
  );
  writeJson(
    path.join(outputDirectory, "protected-source-integrity.json"),
    protectedSources
  );
  writeJson(
    path.join(outputDirectory, "composite-runtime-identity.json"),
    compositeIdentity
  );
  const providerCallGuard = {
    guard_version: "e2a31b-provider-call-guard-v1",
    provider_dispatch_path_present: false,
    live_command_present: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    passed: networkRequestCount === 0
  };
  writeJson(
    path.join(outputDirectory, "provider-call-guard.json"),
    providerCallGuard
  );
  const summary = {
    status: protocol.passed && historicalUnchanged &&
        providerCallGuard.passed
      ? "e2a31b_protocol_ready_for_separate_authorization"
      : "e2a31b_protocol_not_ready",
    correction_version: VERSION,
    protocol_version: PROTOCOL_VERSION,
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeIdentity.composite_runtime_identity_hash,
    calibration_case_count: calibration.case_count,
    calibration_passed: calibration.passed,
    first_failing_boundary_replay_passed: replay.passed,
    corrected_boundary_reference:
      replay.corrected_v3.observed_reference,
    corrected_boundary_stance:
      replay.corrected_v3.observed_stance,
    historical_e2a31_run_id: HISTORICAL_RUN_ID,
    historical_e2a31_status: HISTORICAL_STATUS,
    historical_e2a31_passed: false,
    historical_evidence_unchanged: historicalUnchanged,
    evaluator_v5_unchanged: protectedSources.evaluator_v5_unchanged,
    tutor_candidate_unchanged: protectedSources.tutor_candidate_unchanged,
    e2a31_rerun_performed: false,
    e2a31b_live_execution_performed: false,
    execution_authorized: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  };
  writeJson(path.join(outputDirectory, "summary.json"), summary);

  const missingArtifacts = REQUIRED_ARTIFACTS
    .filter((name) => name !== "artifact-validation.json")
    .filter((name) => !existsSync(path.join(outputDirectory, name)));
  const artifactValidation = {
    validation_version: "e2a31b-artifact-validation-v1",
    required_artifact_count: REQUIRED_ARTIFACTS.length,
    missing_artifacts: missingArtifacts,
    historical_evidence_unchanged: historicalUnchanged,
    protocol_hash_matches_file:
      readFileSync(
        path.join(outputDirectory, "e2a31b-protocol.sha256"),
        "utf8"
      ).trim() === protocol.protocol_hash,
    calibration_passed: calibration.passed,
    replay_passed: replay.passed,
    compiled_evaluator_request_passed: compiledRequest.passed,
    protected_sources_passed: protectedSources.passed,
    provider_call_guard_passed: providerCallGuard.passed,
    execution_authorized: false,
    passed: missingArtifacts.length === 0 &&
      historicalUnchanged &&
      protocol.passed &&
      providerCallGuard.passed
  };
  writeJson(
    path.join(outputDirectory, "artifact-validation.json"),
    artifactValidation
  );
  if (!artifactValidation.passed) {
    throw new Error("e2a31b_deterministic_verification_failed");
  }
  return { summary, artifactValidation };
}

function latestRunDirectory() {
  if (!existsSync(ARTIFACT_ROOT)) {
    throw new Error("e2a31b_artifact_root_missing");
  }
  const latest = readdirSync(ARTIFACT_ROOT)
    .map((name) => path.join(ARTIFACT_ROOT, name))
    .filter((entry) => statSync(entry).isDirectory())
    .sort()
    .at(-1);
  if (!latest) throw new Error("e2a31b_artifact_run_missing");
  return latest;
}

function runPersistent() {
  const runId = makeRunId();
  const outputDirectory = path.join(ARTIFACT_ROOT, runId);
  const result = buildAll(outputDirectory);
  console.log(JSON.stringify({
    ...result.summary,
    artifact_directory: path.relative(process.cwd(), outputDirectory)
  }, null, 2));
}

function runSmoke(suite: string) {
  const outputDirectory = mkdtempSync(
    path.join(tmpdir(), "e2a31b-anchor-stance-")
  );
  try {
    const result = buildAll(outputDirectory);
    const checks: Record<string, boolean> = {
      all: result.artifactValidation.passed,
      calibration: result.summary.calibration_passed,
      replay: result.summary.first_failing_boundary_replay_passed,
      artifact: result.artifactValidation.passed,
      "provider-call-guard":
        result.summary.provider_calls_made === 0 &&
        result.summary.network_requests_made === 0
    };
    if (!(suite in checks)) {
      throw new Error(`e2a31b_unknown_smoke_suite:${suite}`);
    }
    if (!checks[suite]) throw new Error(`e2a31b_${suite}_smoke_failed`);
    console.log(JSON.stringify({
      status: "passed",
      suite,
      provider_calls_made: 0,
      network_requests_made: networkRequestCount,
      historical_e2a31_passed: false,
      live_execution_performed: false
    }, null, 2));
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

function main() {
  const command = process.argv[2] ?? "report";
  if (command === "run") {
    runPersistent();
    return;
  }
  if (command === "report") {
    const outputDirectory = latestRunDirectory();
    console.log(JSON.stringify({
      ...readJson(path.join(outputDirectory, "summary.json")),
      artifact_directory: path.relative(process.cwd(), outputDirectory)
    }, null, 2));
    return;
  }
  if (command === "smoke") {
    const suiteIndex = process.argv.indexOf("--suite");
    runSmoke(suiteIndex >= 0 ? process.argv[suiteIndex + 1] ?? "all" : "all");
    return;
  }
  throw new Error(`e2a31b_unknown_command:${command}`);
}

main();
