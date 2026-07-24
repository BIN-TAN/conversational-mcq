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
  ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
  ActiveAnchorAliasContractSchema,
  buildActiveAnchorAliasContract,
} from "../src/lib/services/student-assessment/active-anchor-alias-resolution";
import {
  resolveActiveAnchorAliasV3
} from "../src/lib/services/student-assessment/active-anchor-alias-resolution-v3";
import {
  ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
  resolveActiveAnchorAliasV4
} from "../src/lib/services/student-assessment/active-anchor-alias-resolution-v4";
import {
  ANCHOR_STANCE_EVIDENCE_CONTRACT_VERSION,
  ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION
} from "../src/lib/services/student-assessment/anchor-stance-evidence-resolution-v2";
import {
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
  ProductionTurnEvidenceEvaluatorInputV5Schema
} from "../src/lib/services/student-assessment/production-turn-evidence-evaluator-v5";
import {
  TargetEvidenceContractV5Schema
} from "../src/lib/services/student-assessment/target-evidence-contract-v5";
import {
  E2A33TrajectoryEnvelopeContractSchema
} from "../src/lib/evaluation/formative/e2a33-causal-inference-protocol";

const CORRECTION_VERSION =
  "e2a33a-anchor-stance-resolution-correction-v1" as const;
const PROTOCOL_VERSION =
  "e2a33b-causal-inference-anchor-stance-canary-v1" as const;
const ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a33b-anchor-stance-resolution-protocol"
);
const HISTORICAL_RUN_ID = "e2a33_20260724014237_58099b2a";
const HISTORICAL_RUN = path.join(
  process.cwd(),
  ".data",
  "e2a33-causal-inference-held-out-canary",
  HISTORICAL_RUN_ID
);
const HISTORICAL_STATUS = "e2a33_canary_failed_anchor_resolution";
const HISTORICAL_PROTOCOL_HASH =
  "c6536a9861c91692e9d5d26a6868f43d79c87d23dd2f9e7cf4dc744ef4ffa45b";
const HISTORICAL_COMPOSITE_IDENTITY =
  "a0df20358f1850c68e48404826d38d3480322ca6dc422b9be0a7bec75a97c443";
const HISTORICAL_CANARY_SUMMARY_SHA256 =
  "6731067f54669ce5cf344c9a90983e0349354861caa3876a27ffb2db5a7faf6f";
const HISTORICAL_SIMULATOR_OUTPUT_SHA256 =
  "30e787c09ac81489340dde6b1e6647647ddeaf8916321d147e4153ff20be1b24";
const HISTORICAL_PROVIDER_ATTEMPTS_SHA256 =
  "d9ca0764b7064111ac93931b5c76967185dbff6a6174bc441d1d5e88a4010ea8";
const HISTORICAL_HUMAN_REVIEW_SHA256 =
  "70e7838c0d4862cfbcf05f1b1236db32932eaa641632362bd127fe9592408edd";
const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";

const EXPECTED_PROTECTED_HASHES = {
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json":
    "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2",
  "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts":
    "b57df1ed269ef1e5f7e2ec7ad3c394d0c7b247afa54c7d067598caa3e47eda09",
  "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts":
    "6ff02d152f95608235d78592a6a1d4970a1ed1f2d7477bbaaaca7e96a878f9cd",
  "src/lib/services/student-assessment/anchor-stance-resolution-v1.ts":
    "36c291183aaf15378a65a3cf00c847e4625676a275dca8daa47fe1aaf9749e6a",
  "src/lib/services/student-assessment/active-anchor-alias-resolution-v3.ts":
    "29f4c7da1d380c8dc70ade8fd2516010a601d143fd605ab1eba931d8242f0635"
} as const;

const REQUIRED_ARTIFACTS = [
  "correction-manifest.json",
  "stance-evidence-contract.json",
  "anchor-stance-calibration.json",
  "e2a33-first-failure-replay.json",
  "e2a33-historical-integrity-before.json",
  "e2a33-historical-integrity-after.json",
  "target-evidence-contract.json",
  "alias-contract.json",
  "canonical-anchor-contract.json",
  "trajectory-envelope-contract.json",
  "compiled-evaluator-v5-request.json",
  "e2a33b-budget.json",
  "e2a33b-artifact-contract.json",
  "e2a33b-protocol.json",
  "e2a33b-protocol.sha256",
  "protected-source-integrity.json",
  "composite-runtime-identity.json",
  "provider-call-guard.json",
  "summary.json",
  "artifact-validation.json"
] as const;

const SimulatorOutputSchema = z.object({
  session_id: z.string(),
  turn: z.number().int(),
  attempt: z.number().int(),
  parsed_structured_output: z.object({
    student_message: z.string().min(1)
  }).passthrough()
}).passthrough();

type JsonRecord = Record<string, unknown>;

let networkRequestCount = 0;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a33b_network_request_prohibited");
};

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
    throw new Error(`e2a33b_historical_tree_missing:${root}`);
  }
  const files = listFiles(root).sort().map((filePath) => ({
    path: path.relative(root, filePath),
    sha256: fileSha(filePath),
    bytes: statSync(filePath).size,
    owner_writable: (statSync(filePath).mode & 0o200) !== 0
  }));
  return {
    tree_hash_version: "e2a33b-stable-file-inventory-v1",
    root: path.relative(process.cwd(), root),
    file_count: files.length,
    tree_sha256: stableHash(files.map((entry) => ({
      path: entry.path,
      sha256: entry.sha256,
      bytes: entry.bytes
    }))),
    writable_file_count: files.filter((entry) => entry.owner_writable).length,
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
  return `e2a33b_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function historicalIntegrity() {
  const tree = hashTree(HISTORICAL_RUN);
  const summaryPath = path.join(HISTORICAL_RUN, "canary-summary.json");
  const simulatorPath = path.join(
    HISTORICAL_RUN,
    "simulator-provider-outputs.jsonl"
  );
  const attemptsPath = path.join(
    HISTORICAL_RUN,
    "provider-attempt-results.jsonl"
  );
  const reviewPath = path.join(HISTORICAL_RUN, "human-review-packet.json");
  const summary = readJson<JsonRecord>(summaryPath);
  const criticalHashes = {
    canary_summary_sha256: fileSha(summaryPath),
    simulator_provider_outputs_sha256: fileSha(simulatorPath),
    provider_attempt_results_sha256: fileSha(attemptsPath),
    human_review_packet_sha256: fileSha(reviewPath)
  };
  const passed =
    summary.status === HISTORICAL_STATUS &&
    summary.passed === false &&
    criticalHashes.canary_summary_sha256 ===
      HISTORICAL_CANARY_SUMMARY_SHA256 &&
    criticalHashes.simulator_provider_outputs_sha256 ===
      HISTORICAL_SIMULATOR_OUTPUT_SHA256 &&
    criticalHashes.provider_attempt_results_sha256 ===
      HISTORICAL_PROVIDER_ATTEMPTS_SHA256 &&
    criticalHashes.human_review_packet_sha256 ===
      HISTORICAL_HUMAN_REVIEW_SHA256 &&
    tree.writable_file_count === 0;
  return {
    integrity_version: "e2a33b-historical-evidence-integrity-v1",
    historical_run_id: HISTORICAL_RUN_ID,
    historical_status: summary.status,
    expected_historical_status: HISTORICAL_STATUS,
    historical_protocol_hash: HISTORICAL_PROTOCOL_HASH,
    historical_composite_runtime_identity:
      HISTORICAL_COMPOSITE_IDENTITY,
    historical_e2a33_passed: false,
    historical_evidence_read_only: tree.writable_file_count === 0,
    tree,
    critical_hashes: criticalHashes,
    passed
  };
}

function protectedSourceIntegrity() {
  const actual = Object.fromEntries(
    Object.keys(EXPECTED_PROTECTED_HASHES).map((relativePath) => [
      relativePath,
      relativeFileSha(relativePath)
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
    integrity_version: "e2a33b-protected-source-integrity-v1",
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    evaluator_v5_unchanged:
      actual[
        "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
      ] === EXPECTED_PROTECTED_HASHES[
        "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
      ],
    tutor_candidate_unchanged:
      actual[
        "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
      ] === EXPECTED_PROTECTED_HASHES[
        "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
      ],
    stance_resolver_v1_unchanged:
      actual[
        "src/lib/services/student-assessment/anchor-stance-resolution-v1.ts"
      ] === EXPECTED_PROTECTED_HASHES[
        "src/lib/services/student-assessment/anchor-stance-resolution-v1.ts"
      ],
    composed_resolver_v3_unchanged:
      actual[
        "src/lib/services/student-assessment/active-anchor-alias-resolution-v3.ts"
      ] === EXPECTED_PROTECTED_HASHES[
        "src/lib/services/student-assessment/active-anchor-alias-resolution-v3.ts"
      ],
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
    domain_id: "generic_pathway",
    option_label: "D",
    option_text: "The direct pathway always guarantees the final outcome.",
    paraphrase: "the direct pathway guarantees the result"
  },
  {
    domain_id: "generic_indicator",
    option_label: "C",
    option_text: "A single indicator always proves the intended conclusion.",
    paraphrase: "one indicator proves the conclusion"
  },
  {
    domain_id: "generic_sequence",
    option_label: "B",
    option_text: "The first visible event always determines the final state.",
    paraphrase: "the first event determines the final state"
  },
  {
    domain_id: "generic_boundary",
    option_label: "A",
    option_text: "A result in one condition always applies in every condition.",
    paraphrase: "the result applies in every condition"
  },
  {
    domain_id: "generic_prediction",
    option_label: "E",
    option_text: "A repeated pattern always guarantees the next observation.",
    paraphrase: "the pattern guarantees what happens next"
  },
  {
    domain_id: "generic_comparison",
    option_label: "F",
    option_text: "The larger observed value always identifies the better choice.",
    paraphrase: "the larger value proves the better choice"
  }
];

type ExpectedStance =
  | "endorses_distractor"
  | "rejects_distractor"
  | "ambiguous";
type CalibrationArchetype = {
  archetype_id: string;
  category:
    | "agreement"
    | "disagreement"
    | "negation"
    | "contrast"
    | "uncertainty"
    | "pronoun"
    | "paraphrase"
    | "prior_reasoning";
  expected_stance: ExpectedStance;
  message: (domain: CalibrationDomain) => string;
  prior_reasoning?: (domain: CalibrationDomain) => string[];
};

const CALIBRATION_ARCHETYPES: CalibrationArchetype[] = [
  {
    archetype_id: "agree_label",
    category: "agreement",
    expected_stance: "endorses_distractor",
    message: (domain) => `I agree with ${domain.option_label}`
  },
  {
    archetype_id: "agree_option",
    category: "agreement",
    expected_stance: "endorses_distractor",
    message: (domain) => `I agree with option ${domain.option_label}`
  },
  {
    archetype_id: "label_correct",
    category: "agreement",
    expected_stance: "endorses_distractor",
    message: (domain) => `${domain.option_label} is correct`
  },
  {
    archetype_id: "label_right",
    category: "agreement",
    expected_stance: "endorses_distractor",
    message: (domain) => `${domain.option_label} is right`
  },
  {
    archetype_id: "choose_label",
    category: "agreement",
    expected_stance: "endorses_distractor",
    message: (domain) => `I choose ${domain.option_label}`
  },
  {
    archetype_id: "makes_sense",
    category: "agreement",
    expected_stance: "endorses_distractor",
    message: (domain) => `${domain.option_label} makes sense`
  },
  {
    archetype_id: "paraphrase_agreement",
    category: "paraphrase",
    expected_stance: "endorses_distractor",
    message: (domain) => `I agree with ${domain.paraphrase}`
  },
  {
    archetype_id: "pronoun_agreement",
    category: "pronoun",
    expected_stance: "endorses_distractor",
    message: () => "I agree with that option"
  },
  {
    archetype_id: "negated_disagreement",
    category: "negation",
    expected_stance: "endorses_distractor",
    message: (domain) =>
      `I do not disagree with ${domain.option_label}`
  },
  {
    archetype_id: "contrast_final_endorsement",
    category: "contrast",
    expected_stance: "endorses_distractor",
    message: (domain) =>
      `${domain.option_label} seemed wrong, but now I agree with ${domain.option_label}`
  },
  {
    archetype_id: "direct_disagreement",
    category: "disagreement",
    expected_stance: "rejects_distractor",
    message: (domain) => `I disagree with ${domain.option_label}`
  },
  {
    archetype_id: "negated_agreement",
    category: "negation",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `I do not agree with ${domain.option_label}`
  },
  {
    archetype_id: "label_wrong",
    category: "disagreement",
    expected_stance: "rejects_distractor",
    message: (domain) => `${domain.option_label} is wrong`
  },
  {
    archetype_id: "tempting_but_incorrect",
    category: "contrast",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `${domain.option_label} is tempting but incorrect`
  },
  {
    archetype_id: "reject_option",
    category: "disagreement",
    expected_stance: "rejects_distractor",
    message: (domain) => `I reject option ${domain.option_label}`
  },
  {
    archetype_id: "paraphrase_disagreement",
    category: "paraphrase",
    expected_stance: "rejects_distractor",
    message: (domain) => `I disagree with ${domain.paraphrase}`
  },
  {
    archetype_id: "pronoun_disagreement",
    category: "pronoun",
    expected_stance: "rejects_distractor",
    message: () => "I disagree with that option"
  },
  {
    archetype_id: "contrast_final_rejection",
    category: "contrast",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `I agree with ${domain.option_label} at first, but ${domain.option_label} is wrong`
  },
  {
    archetype_id: "would_not_choose",
    category: "negation",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `I would not choose ${domain.option_label}`
  },
  {
    archetype_id: "does_not_make_sense",
    category: "negation",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `${domain.option_label} does not make sense`
  },
  {
    archetype_id: "unsure",
    category: "uncertainty",
    expected_stance: "ambiguous",
    message: (domain) => `I am unsure about ${domain.option_label}`
  },
  {
    archetype_id: "might_be_possible",
    category: "uncertainty",
    expected_stance: "ambiguous",
    message: (domain) => `${domain.option_label} might be possible`
  },
  {
    archetype_id: "maybe_label",
    category: "uncertainty",
    expected_stance: "ambiguous",
    message: (domain) => `Maybe ${domain.option_label}`
  },
  {
    archetype_id: "might_agree",
    category: "uncertainty",
    expected_stance: "ambiguous",
    message: (domain) =>
      `I might agree with ${domain.option_label}`
  },
  {
    archetype_id: "could_be_correct_question",
    category: "uncertainty",
    expected_stance: "ambiguous",
    message: (domain) => `Could ${domain.option_label} be correct?`
  },
  {
    archetype_id: "undecided",
    category: "uncertainty",
    expected_stance: "ambiguous",
    message: (domain) =>
      `I am undecided about option ${domain.option_label}`
  },
  {
    archetype_id: "conflicting_without_discourse",
    category: "contrast",
    expected_stance: "ambiguous",
    message: (domain) =>
      `${domain.option_label} is right. ${domain.option_label} is wrong.`
  },
  {
    archetype_id: "prior_endorsement_continuity",
    category: "prior_reasoning",
    expected_stance: "endorses_distractor",
    message: (domain) =>
      `My view of option ${domain.option_label} is unchanged`,
    prior_reasoning: (domain) => [
      `I agree with option ${domain.option_label}`
    ]
  },
  {
    archetype_id: "prior_rejection_continuity",
    category: "prior_reasoning",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `My view of option ${domain.option_label} is unchanged`,
    prior_reasoning: (domain) => [
      `I disagree with option ${domain.option_label}`
    ]
  },
  {
    archetype_id: "uncertainty_overrides_prior",
    category: "prior_reasoning",
    expected_stance: "ambiguous",
    message: (domain) =>
      `I am still unsure about option ${domain.option_label}`,
    prior_reasoning: (domain) => [
      `I agree with option ${domain.option_label}`
    ]
  },
  {
    archetype_id: "self_correction_rejection",
    category: "contrast",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `${domain.option_label} is right. Actually, ${domain.option_label} is wrong.`
  },
  {
    archetype_id: "self_correction_endorsement",
    category: "contrast",
    expected_stance: "endorses_distractor",
    message: (domain) =>
      `${domain.option_label} is wrong. Actually, ${domain.option_label} is right.`
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
    return CALIBRATION_ARCHETYPES.map((archetype, index) => {
      const message = archetype.message(domain);
      const resolution = resolveActiveAnchorAliasV4({
        message,
        contract,
        source_turn_id:
          `e2a33b_${domain.domain_id}_${archetype.archetype_id}`,
        source_sequence_index: index + 1,
        prior_visible_message:
          `We are reviewing option ${domain.option_label}.`,
        prior_student_reasoning:
          archetype.prior_reasoning?.(domain) ?? []
      });
      const evidence =
        resolution.independent_stance_evidence_resolution;
      return {
        case_id: `${domain.domain_id}:${archetype.archetype_id}`,
        domain_id: domain.domain_id,
        archetype_id: archetype.archetype_id,
        category: archetype.category,
        message,
        expected_stance: archetype.expected_stance,
        observed_reference: resolution.observed_anchor_reference,
        observed_stance: resolution.observed_anchor_stance,
        reference_resolver_version: resolution.reference_resolver_version,
        stance_evidence_resolver_version:
          resolution.stance_evidence_resolver_version,
        resolution_basis: evidence.resolution_basis,
        cue_codes: evidence.cue_codes,
        prior_reasoning_used: evidence.prior_reasoning_used,
        passed:
          resolution.observed_anchor_reference === "explicit" &&
          resolution.observed_anchor_stance ===
            archetype.expected_stance
      };
    });
  });
  const requiredCases = [
    ["I agree with D", "endorses_distractor"],
    ["D is correct", "endorses_distractor"],
    ["D is right", "endorses_distractor"],
    ["I choose D", "endorses_distractor"],
    ["D makes sense", "endorses_distractor"],
    ["D is wrong", "rejects_distractor"],
    ["D is tempting but incorrect", "rejects_distractor"],
    ["I disagree with D", "rejects_distractor"],
    ["I am unsure about D", "ambiguous"],
    ["D might be possible", "ambiguous"]
  ] as const;
  const requiredCoverage = requiredCases.map(([message, stance]) => ({
    message,
    expected_stance: stance,
    present: results.some((entry) =>
      entry.message === message &&
      entry.expected_stance === stance
    ),
    passed: results.some((entry) =>
      entry.message === message &&
      entry.expected_stance === stance &&
      entry.passed
    )
  }));
  const categoryCounts = results.reduce<Record<string, number>>(
    (counts, entry) => {
      counts[entry.category] = (counts[entry.category] ?? 0) + 1;
      return counts;
    },
    {}
  );
  const requiredCategories = [
    "agreement",
    "disagreement",
    "negation",
    "contrast",
    "uncertainty",
    "pronoun",
    "paraphrase",
    "prior_reasoning"
  ];
  return {
    calibration_version: "e2a33b-anchor-stance-calibration-v1",
    evidence_contract_version:
      ANCHOR_STANCE_EVIDENCE_CONTRACT_VERSION,
    stance_evidence_resolver_version:
      ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
    composed_resolver_version:
      ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
    case_count: results.length,
    minimum_required_case_count: 150,
    category_counts: categoryCounts,
    required_categories: requiredCategories,
    required_message_coverage: requiredCoverage,
    results,
    passed:
      results.length >= 150 &&
      results.every((entry) => entry.passed) &&
      requiredCategories.every((category) =>
        (categoryCounts[category] ?? 0) > 0
      ) &&
      requiredCoverage.every((entry) => entry.present && entry.passed),
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  };
}

function stanceEvidenceContract() {
  return {
    contract_version: ANCHOR_STANCE_EVIDENCE_CONTRACT_VERSION,
    resolver_version: ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
    authority_boundary: {
      anchor_reference_resolution:
        ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
      anchor_stance_evidence_resolution:
        ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
      reference_must_be_explicit_before_stance_is_decisive: true,
      domain_specific_terms_hardcoded: false
    },
    decisive_stances: [
      "endorses_distractor",
      "rejects_distractor"
    ],
    non_decisive_stances: ["ambiguous", "not_expressed"],
    endorsement_examples: [
      "I agree with D",
      "D is correct",
      "D is right",
      "I choose D",
      "D makes sense"
    ],
    rejection_examples: [
      "D is wrong",
      "D is tempting but incorrect",
      "I disagree with D"
    ],
    ambiguity_examples: [
      "I am unsure about D",
      "D might be possible"
    ],
    discourse_features: [
      "negation",
      "contrast",
      "self_correction",
      "prior_student_reasoning",
      "contextual_pronoun"
    ],
    passed: true
  };
}

function replayFirstFailure() {
  const outputPath = path.join(
    HISTORICAL_RUN,
    "simulator-provider-outputs.jsonl"
  );
  const rows = readJsonLines<unknown>(outputPath)
    .map((row) => SimulatorOutputSchema.parse(row))
    .filter((row) =>
      row.session_id === "E2A33-CAUSAL_INFERENCE" &&
      row.turn === 1
    )
    .sort((left, right) => left.attempt - right.attempt);
  if (rows.length !== 2) {
    throw new Error("e2a33b_historical_boundary_attempts_missing");
  }
  const contract = ActiveAnchorAliasContractSchema.parse(readJson(
    path.join(HISTORICAL_RUN, "causal-inference-alias-contract.json")
  ));
  const attempts = rows.map((row, index) => {
    const message = row.parsed_structured_output.student_message;
    const frozenV3 = resolveActiveAnchorAliasV3({
      message,
      contract,
      source_turn_id: `e2a33_historical_turn_1_attempt_${row.attempt}`,
      source_sequence_index: 1,
      prior_visible_message:
        "Do you agree with option D? Explain."
    });
    const correctedV4 = resolveActiveAnchorAliasV4({
      message,
      contract,
      source_turn_id: `e2a33b_replay_turn_1_attempt_${row.attempt}`,
      source_sequence_index: 1,
      prior_visible_message:
        "Do you agree with option D? Explain."
    });
    const evidence =
      correctedV4.independent_stance_evidence_resolution;
    return {
      attempt: row.attempt,
      is_first_failed_boundary: index === 0,
      source_message_sha256: sha256(message),
      source_message_preserved_in_historical_artifact_only: true,
      frozen_v3: {
        resolver_version: frozenV3.resolver_version,
        stance_resolver_version: frozenV3.stance_resolver_version,
        observed_reference:
          frozenV3.independent_reference_resolution
            .observed_anchor_reference,
        observed_stance:
          frozenV3.independent_stance_resolution
            .observed_anchor_stance,
        historical_failure_reproduced:
          frozenV3.independent_reference_resolution
            .observed_anchor_reference === "explicit" &&
          frozenV3.independent_stance_resolution
            .observed_anchor_stance === "ambiguous"
      },
      corrected_v4: {
        resolver_version: correctedV4.resolver_version,
        stance_evidence_resolver_version:
          correctedV4.stance_evidence_resolver_version,
        observed_reference:
          correctedV4.independent_reference_resolution
            .observed_anchor_reference,
        observed_stance: evidence.observed_anchor_stance,
        resolution_basis: evidence.resolution_basis,
        cue_codes: evidence.cue_codes,
        direct_agreement_detected:
          evidence.direct_agreement_detected
      },
      passed:
        frozenV3.independent_reference_resolution
          .observed_anchor_reference === "explicit" &&
        frozenV3.independent_stance_resolution
          .observed_anchor_stance === "ambiguous" &&
        correctedV4.independent_reference_resolution
          .observed_anchor_reference === "explicit" &&
        evidence.observed_anchor_stance === "endorses_distractor" &&
        evidence.direct_agreement_detected
    };
  });
  return {
    replay_version: "e2a33b-first-failure-offline-replay-v1",
    replay_mode: "immutable_provider_output_no_provider_dispatch",
    historical_run_id: HISTORICAL_RUN_ID,
    historical_status: HISTORICAL_STATUS,
    source_provider_output_sha256: fileSha(outputPath),
    attempts,
    explicit_agreement_maps_to_endorsement:
      attempts.every((entry) =>
        entry.corrected_v4.observed_stance ===
          "endorses_distractor"
      ),
    e2a33_historical_status_unchanged: HISTORICAL_STATUS,
    e2a33_pass_claimed: false,
    passed: attempts.every((entry) => entry.passed),
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  };
}

function baseContracts() {
  const targetEvidence = TargetEvidenceContractV5Schema.parse(readJson(
    path.join(HISTORICAL_RUN, "causal-inference-target-evidence-contract.json")
  ));
  const aliasContract = ActiveAnchorAliasContractSchema.parse(readJson(
    path.join(HISTORICAL_RUN, "causal-inference-alias-contract.json")
  ));
  const baseCanonical = readJson<JsonRecord>(
    path.join(HISTORICAL_RUN, "canonical-anchor-contract.json")
  );
  const canonicalAnchor = {
    ...baseCanonical,
    canonical_anchor_contract_version:
      "e2a33b-causal-inference-canonical-anchor-v1",
    anchor_reference_resolver_version:
      ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
    anchor_stance_resolver_version:
      ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION
  };
  const trajectoryEnvelope =
    E2A33TrajectoryEnvelopeContractSchema.parse(readJson(
      path.join(HISTORICAL_RUN, "trajectory-envelope-contract.json")
    ));
  return {
    targetEvidence,
    aliasContract,
    canonicalAnchor,
    trajectoryEnvelope
  };
}

function compiledEvaluatorRequest() {
  const source = readJson<JsonRecord>(path.join(
    HISTORICAL_RUN,
    "compiled-evaluator-v5-request.json"
  ));
  const input = ProductionTurnEvidenceEvaluatorInputV5Schema.parse(
    source.input
  );
  const compiled = {
    request_compilation_version: "e2a33b-evaluator-v5-request-v1",
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
    schema_name:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
    input,
    metadata: {
      evaluation_phase: "e2a33b_protocol_only_no_live",
      execution_authorized: "false",
      anchor_reference_resolver_version:
        ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
      anchor_stance_evidence_resolver_version:
        ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
      composed_anchor_resolver_version:
        ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4
    },
    provider_dispatch_performed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  };
  const oldEvaluatorContracts = [
    "production-turn-evidence-evaluator-v1",
    "production-turn-evidence-evaluator-v2",
    "production-turn-evidence-evaluator-v3",
    "production-turn-evidence-evaluator-v4"
  ].filter((value) => JSON.stringify(compiled).includes(value));
  return {
    ...compiled,
    canonical_request_hash: stableHash(compiled),
    old_evaluator_contract_matches: oldEvaluatorContracts,
    passed:
      oldEvaluatorContracts.length === 0 &&
      input.schema_version ===
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5
  };
}

function buildBudget() {
  const maximum = {
    isolated_sessions: 1,
    logical_generation_calls: 29,
    adapter_attempts: 87,
    adapter_attempts_per_logical_call: 3,
    transport_retries_per_logical_call: 2,
    input_tokens: 900_000,
    output_tokens: 70_000,
    total_tokens: 970_000,
    cost_usd_when_pricing_available: 25,
    provider_concurrency: 1
  };
  return {
    budget_version: "e2a33b-bounded-live-budget-v1",
    execution_authorized: false,
    protocol_only: true,
    maximum,
    arithmetic_valid:
      maximum.logical_generation_calls * 3 ===
        maximum.adapter_attempts &&
      maximum.input_tokens + maximum.output_tokens ===
        maximum.total_tokens,
    passed: true
  };
}

function buildArtifactContract() {
  const historicalArtifacts = listFiles(HISTORICAL_RUN)
    .map((filePath) => path.relative(HISTORICAL_RUN, filePath))
    .sort();
  const requiredFutureArtifacts = [...new Set([
    ...historicalArtifacts,
    "anchor-reference-resolution-results.jsonl",
    "anchor-stance-evidence-resolution-results.jsonl"
  ])].sort();
  return {
    artifact_contract_version: "e2a33b-artifact-contract-v1",
    execution_authorized: false,
    historical_e2a33_artifacts_are_read_only: true,
    historical_artifact_count: historicalArtifacts.length,
    required_future_live_artifacts: requiredFutureArtifacts,
    required_future_live_artifact_count: requiredFutureArtifacts.length,
    correction_specific_artifacts: [
      "anchor-reference-resolution-results.jsonl",
      "anchor-stance-evidence-resolution-results.jsonl",
      "anchor-parity-reconciliation-results.jsonl",
      "canonical-anchor-evidence-results.jsonl"
    ],
    separation_required: {
      reference_resolution_is_independent: true,
      stance_evidence_resolution_is_independent: true
    },
    passed:
      historicalArtifacts.length === 88 &&
      requiredFutureArtifacts.includes(
        "anchor-reference-resolution-results.jsonl"
      ) &&
      requiredFutureArtifacts.includes(
        "anchor-stance-evidence-resolution-results.jsonl"
      )
  };
}

function buildProtocol(input: {
  contract: ReturnType<typeof stanceEvidenceContract>;
  calibration: ReturnType<typeof runCalibration>;
  replay: ReturnType<typeof replayFirstFailure>;
  contracts: ReturnType<typeof baseContracts>;
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
    historical_stance_resolver_v1_sha256: relativeFileSha(
      "src/lib/services/student-assessment/anchor-stance-resolution-v1.ts"
    ),
    historical_composed_resolver_v3_sha256: relativeFileSha(
      "src/lib/services/student-assessment/active-anchor-alias-resolution-v3.ts"
    ),
    stance_evidence_resolver_v2_sha256: relativeFileSha(
      "src/lib/services/student-assessment/anchor-stance-evidence-resolution-v2.ts"
    ),
    composed_resolver_v4_sha256: relativeFileSha(
      "src/lib/services/student-assessment/active-anchor-alias-resolution-v4.ts"
    )
  };
  const protocol = {
    protocol_version: PROTOCOL_VERSION,
    correction_version: CORRECTION_VERSION,
    protocol_state: "frozen_protocol_only",
    execution_authorized: false,
    live_execution_performed: false,
    e2a33_rerun_performed: false,
    historical_e2a33_run_id: HISTORICAL_RUN_ID,
    historical_e2a33_status: HISTORICAL_STATUS,
    historical_e2a33_passed: false,
    historical_protocol_hash: HISTORICAL_PROTOCOL_HASH,
    historical_composite_runtime_identity:
      HISTORICAL_COMPOSITE_IDENTITY,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    evaluator_prompt_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
    evaluator_prompt_hash:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
    evaluator_input_schema:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
    evaluator_output_schema:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
    reference_resolver_version:
      ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
    stance_evidence_contract_version:
      ANCHOR_STANCE_EVIDENCE_CONTRACT_VERSION,
    stance_evidence_resolver_version:
      ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
    composed_resolver_version:
      ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
    source_hashes: sourceHashes,
    stance_evidence_contract_hash: stableHash(input.contract),
    calibration_hash: stableHash(input.calibration),
    replay_hash: stableHash(input.replay),
    target_evidence_contract_hash:
      stableHash(input.contracts.targetEvidence),
    alias_contract_hash: stableHash(input.contracts.aliasContract),
    canonical_anchor_contract_hash:
      stableHash(input.contracts.canonicalAnchor),
    trajectory_envelope_contract_hash:
      stableHash(input.contracts.trajectoryEnvelope),
    evaluator_request_hash:
      input.compiledRequest.canonical_request_hash,
    budget_hash: stableHash(input.budget),
    artifact_contract_hash: stableHash(input.artifactContract),
    historical_evidence_tree_hash:
      input.historical.tree.tree_sha256,
    protected_source_hashes:
      input.protectedSources.actual_sha256,
    gates: {
      stance_evidence_contract_valid: input.contract.passed,
      calibration_passed: input.calibration.passed,
      immutable_replay_passed: input.replay.passed,
      explicit_agreement_maps_to_endorsement:
        input.replay.explicit_agreement_maps_to_endorsement,
      evaluator_v5_request_passed: input.compiledRequest.passed,
      budget_valid:
        input.budget.passed && input.budget.arithmetic_valid,
      artifact_contract_valid: input.artifactContract.passed,
      historical_evidence_unchanged: input.historical.passed,
      evaluator_v5_unchanged:
        input.protectedSources.evaluator_v5_unchanged,
      tutor_candidate_unchanged:
        input.protectedSources.tutor_candidate_unchanged,
      historical_resolvers_unchanged:
        input.protectedSources.stance_resolver_v1_unchanged &&
        input.protectedSources.composed_resolver_v3_unchanged,
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
    identity_version: "e2a33b-composite-runtime-identity-v1",
    preparation_application_git_commit: currentCommit(),
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    protocol_hash: input.protocol.protocol_hash,
    reference_resolver_version:
      ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
    stance_evidence_contract_version:
      ANCHOR_STANCE_EVIDENCE_CONTRACT_VERSION,
    stance_evidence_resolver_version:
      ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
    composed_resolver_version:
      ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    evaluator_prompt_hash:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
    historical_e2a33_run_id: HISTORICAL_RUN_ID,
    historical_e2a33_status: HISTORICAL_STATUS,
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
  const contract = stanceEvidenceContract();
  const calibration = runCalibration();
  const replay = replayFirstFailure();
  const contracts = baseContracts();
  const compiledRequest = compiledEvaluatorRequest();
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const protocol = buildProtocol({
    contract,
    calibration,
    replay,
    contracts,
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
  const historicalUnchanged =
    historicalBefore.tree.tree_sha256 ===
      historicalAfter.tree.tree_sha256 &&
    historicalBefore.tree.file_count ===
      historicalAfter.tree.file_count &&
    historicalBefore.passed &&
    historicalAfter.passed;

  writeJson(path.join(outputDirectory, "correction-manifest.json"), {
    correction_version: CORRECTION_VERSION,
    protocol_version: PROTOCOL_VERSION,
    run_mode: "deterministic_protocol_preparation_only",
    live_execution_authorized: false,
    live_execution_performed: false,
    e2a33_rerun_performed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  });
  writeJson(
    path.join(outputDirectory, "stance-evidence-contract.json"),
    contract
  );
  writeJson(
    path.join(outputDirectory, "anchor-stance-calibration.json"),
    calibration
  );
  writeJson(
    path.join(outputDirectory, "e2a33-first-failure-replay.json"),
    replay
  );
  writeJson(
    path.join(outputDirectory, "e2a33-historical-integrity-before.json"),
    historicalBefore
  );
  writeJson(
    path.join(outputDirectory, "e2a33-historical-integrity-after.json"),
    historicalAfter
  );
  writeJson(
    path.join(outputDirectory, "target-evidence-contract.json"),
    contracts.targetEvidence
  );
  writeJson(
    path.join(outputDirectory, "alias-contract.json"),
    contracts.aliasContract
  );
  writeJson(
    path.join(outputDirectory, "canonical-anchor-contract.json"),
    contracts.canonicalAnchor
  );
  writeJson(
    path.join(outputDirectory, "trajectory-envelope-contract.json"),
    contracts.trajectoryEnvelope
  );
  writeJson(
    path.join(outputDirectory, "compiled-evaluator-v5-request.json"),
    compiledRequest
  );
  writeJson(path.join(outputDirectory, "e2a33b-budget.json"), budget);
  writeJson(
    path.join(outputDirectory, "e2a33b-artifact-contract.json"),
    artifactContract
  );
  writeJson(path.join(outputDirectory, "e2a33b-protocol.json"), protocol);
  writeFileSync(
    path.join(outputDirectory, "e2a33b-protocol.sha256"),
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
    guard_version: "e2a33b-provider-call-guard-v1",
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
    status:
      protocol.passed && historicalUnchanged && providerCallGuard.passed
        ? "e2a33b_protocol_ready_for_separate_authorization"
        : "e2a33b_protocol_not_ready",
    correction_version: CORRECTION_VERSION,
    protocol_version: PROTOCOL_VERSION,
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeIdentity.composite_runtime_identity_hash,
    calibration_case_count: calibration.case_count,
    minimum_calibration_case_count:
      calibration.minimum_required_case_count,
    calibration_passed: calibration.passed,
    first_failure_replay_passed: replay.passed,
    corrected_first_failure_reference:
      replay.attempts[0]?.corrected_v4.observed_reference,
    corrected_first_failure_stance:
      replay.attempts[0]?.corrected_v4.observed_stance,
    historical_e2a33_run_id: HISTORICAL_RUN_ID,
    historical_e2a33_status: HISTORICAL_STATUS,
    historical_e2a33_passed: false,
    historical_evidence_unchanged: historicalUnchanged,
    evaluator_v5_unchanged: protectedSources.evaluator_v5_unchanged,
    tutor_candidate_unchanged: protectedSources.tutor_candidate_unchanged,
    e2a33_rerun_performed: false,
    e2a33b_live_execution_performed: false,
    execution_authorized: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  };
  writeJson(path.join(outputDirectory, "summary.json"), summary);

  const missingArtifacts = REQUIRED_ARTIFACTS
    .filter((name) => name !== "artifact-validation.json")
    .filter((name) => !existsSync(path.join(outputDirectory, name)));
  const unexpectedArtifacts = readdirSync(outputDirectory)
    .filter((name) => !REQUIRED_ARTIFACTS.includes(
      name as typeof REQUIRED_ARTIFACTS[number]
    ));
  const unsafePatterns = [
    /\bsk-[A-Za-z0-9_-]{12,}\b/u,
    /Bearer\s+[A-Za-z0-9._-]+/iu,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u,
    /Authorization\s*:/iu
  ];
  const unsafeArtifacts = readdirSync(outputDirectory)
    .filter((name) => {
      const filePath = path.join(outputDirectory, name);
      return statSync(filePath).isFile() &&
        unsafePatterns.some((pattern) =>
          pattern.test(readFileSync(filePath, "utf8"))
        );
    });
  const artifactValidation = {
    validation_version: "e2a33b-artifact-validation-v1",
    required_artifact_count: REQUIRED_ARTIFACTS.length,
    missing_artifacts: missingArtifacts,
    unexpected_artifacts: unexpectedArtifacts,
    unsafe_artifacts: unsafeArtifacts,
    historical_evidence_unchanged: historicalUnchanged,
    historical_evidence_read_only:
      historicalAfter.historical_evidence_read_only,
    protocol_hash_matches_file:
      readFileSync(
        path.join(outputDirectory, "e2a33b-protocol.sha256"),
        "utf8"
      ).trim() === protocol.protocol_hash,
    calibration_passed: calibration.passed,
    replay_passed: replay.passed,
    compiled_evaluator_request_passed: compiledRequest.passed,
    protected_sources_passed: protectedSources.passed,
    provider_call_guard_passed: providerCallGuard.passed,
    execution_authorized: false,
    passed:
      missingArtifacts.length === 0 &&
      unexpectedArtifacts.length === 0 &&
      unsafeArtifacts.length === 0 &&
      historicalUnchanged &&
      protocol.passed &&
      providerCallGuard.passed
  };
  writeJson(
    path.join(outputDirectory, "artifact-validation.json"),
    artifactValidation
  );
  if (!artifactValidation.passed) {
    throw new Error("e2a33b_deterministic_verification_failed");
  }
  return { summary, artifactValidation };
}

function latestRunDirectory() {
  if (!existsSync(ARTIFACT_ROOT)) {
    throw new Error("e2a33b_artifact_root_missing");
  }
  const latest = readdirSync(ARTIFACT_ROOT)
    .map((name) => path.join(ARTIFACT_ROOT, name))
    .filter((entry) => statSync(entry).isDirectory())
    .sort()
    .at(-1);
  if (!latest) throw new Error("e2a33b_artifact_run_missing");
  return latest;
}

function runPersistent() {
  const outputDirectory = path.join(ARTIFACT_ROOT, makeRunId());
  const result = buildAll(outputDirectory);
  console.log(JSON.stringify({
    ...result.summary,
    artifact_directory: path.relative(process.cwd(), outputDirectory)
  }, null, 2));
}

function runSmoke(suite: string) {
  const outputDirectory = mkdtempSync(
    path.join(tmpdir(), "e2a33b-anchor-stance-")
  );
  try {
    const result = buildAll(outputDirectory);
    const checks: Record<string, boolean> = {
      all: result.artifactValidation.passed,
      calibration: result.summary.calibration_passed,
      replay: result.summary.first_failure_replay_passed,
      artifact: result.artifactValidation.passed,
      historical: result.summary.historical_evidence_unchanged,
      "provider-call-guard":
        result.summary.provider_calls_made === 0 &&
        result.summary.network_requests_made === 0
    };
    if (!(suite in checks)) {
      throw new Error(`e2a33b_unknown_smoke_suite:${suite}`);
    }
    if (!checks[suite]) {
      throw new Error(`e2a33b_${suite}_smoke_failed`);
    }
    console.log(JSON.stringify({
      status: "passed",
      suite,
      calibration_case_count:
        result.summary.calibration_case_count,
      corrected_first_failure_stance:
        result.summary.corrected_first_failure_stance,
      provider_calls_made: 0,
      network_requests_made: networkRequestCount,
      historical_e2a33_passed: false,
      e2a33_rerun_performed: false,
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
    runSmoke(
      suiteIndex >= 0 ? process.argv[suiteIndex + 1] ?? "all" : "all"
    );
    return;
  }
  throw new Error(`e2a33b_unknown_command:${command}`);
}

main();
