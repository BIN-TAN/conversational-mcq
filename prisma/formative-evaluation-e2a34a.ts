// Historical no-live E2A.34a scope-correction preparation harness.
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
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
  ActivityMisconceptionEvidencePacketV1Schema
} from "../src/lib/services/student-assessment/activity-misconception-evidence";
import {
  ActiveAnchorAliasResolutionSchema,
  buildActiveAnchorAliasContract,
  resolveActiveAnchorAlias
} from "../src/lib/services/student-assessment/active-anchor-alias-resolution";
import {
  ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
  resolveAnchorStanceScopeV1
} from "../src/lib/services/student-assessment/anchor-stance-scope-resolution-v1";
import {
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
  ProductionTurnEvidenceStructuredFieldsV5Schema
} from "../src/lib/services/student-assessment/production-turn-evidence-evaluator-v5";
import {
  TargetEvidenceContractV5Schema,
  buildTargetEvidenceAdjudicationFromEvaluatorOutputV5
} from "../src/lib/services/student-assessment/target-evidence-contract-v5";
import {
  TARGET_EVIDENCE_SCOPED_ADJUDICATION_VERSION,
  buildTargetEvidenceScopedAdjudicationV1
} from "../src/lib/services/student-assessment/target-evidence-scoped-adjudication-v1";

const CORRECTION_VERSION =
  "e2a34a-anchor-stance-scope-resolution-correction-v1" as const;
const PROTOCOL_VERSION =
  "e2a35-statistical-inference-anchor-stance-scope-canary-v1" as const;
const ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a35-anchor-stance-scope-protocol"
);
const HISTORICAL_RUN_ID = "e2a34_20260724162010_49f33990";
const HISTORICAL_RUN = path.join(
  process.cwd(),
  ".data",
  "e2a34-statistical-inference-held-out-canary",
  HISTORICAL_RUN_ID
);
const HISTORICAL_STATUS = "e2a34_canary_failed_anchor_resolution";
const HISTORICAL_PROTOCOL_HASH =
  "83ddef09e6d70631ce30f1161659fe85aa25b3bcc38891ba7b3f7bc6a9e0c405";
const HISTORICAL_COMPOSITE_IDENTITY =
  "39f61e1aa128a7586b1c6f534c6401ffaadbdc61ab59e54943556dde84f35195";
const HISTORICAL_TREE_SHA256 =
  "ba8be92757911bc75ad43a6fb6d1239da4fd1ea26a62cd5f7b83137b390ae78a";
const HISTORICAL_FILE_COUNT = 90;
const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";

const EXPECTED_HISTORICAL_HASHES = {
  "canary-summary.json":
    "46bb5702593897a0758d80f10edb32e5bb424eafe2a82766f364cea793a2accd",
  "simulator-provider-outputs.jsonl":
    "1f2b80b4b82fbd402f203db1c4c21a7c7f65f7bdfab65bbc8b9166f0a9a52058",
  "evaluator-provider-outputs.jsonl":
    "d8292fb6600d1a31f5f73f78b3358aa7ca0d431b3b23e76218e18992d08f9357",
  "provider-attempt-results.jsonl":
    "bc96fc910a12f6d23dc04db20663522e04df4955ab67c5bd1fb1d33bd51f8f39",
  "human-review-packet.json":
    "197065e0b2c0aec492ebdc65f6b2e3c93fadf33935a49012ad7717b2ed9cd223"
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
  "src/lib/services/student-assessment/active-anchor-alias-resolution-v2.ts":
    "4df5bd76487ae081ce9a5d538f6f8a405fdabcc91a95b3200c0d9b891904a700"
} as const;

const ARTIFACT_NAMES = [
  "correction-manifest.json",
  "anchor-stance-scope-contract.json",
  "anchor-stance-scope-calibration.json",
  "e2a34-turn-1-offline-replay.json",
  "e2a34-historical-integrity-before.json",
  "e2a34-historical-integrity-after.json",
  "protected-source-integrity.json",
  "runtime-wiring-verification.json",
  "e2a35-budget.json",
  "e2a35-artifact-contract.json",
  "e2a35-protocol.json",
  "e2a35-protocol.sha256",
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

const EvaluatorNormalizedSchema = z.object({
  session_id: z.string(),
  turn: z.number().int(),
  source_student_turn_id: z.string().min(1),
  source_sequence_index: z.number().int().positive(),
  structured_turn_evidence: ProductionTurnEvidenceStructuredFieldsV5Schema,
  effective_evidence_packet: ActivityMisconceptionEvidencePacketV1Schema
}).passthrough();

type JsonRecord = Record<string, unknown>;
type CanonicalStance =
  | "endorses_distractor"
  | "rejects_distractor"
  | "ambiguous"
  | "not_expressed";

let networkRequestCount = 0;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a35_network_request_prohibited");
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function fileSha(filePath: string) {
  return sha256(readFileSync(filePath));
}

function relativeFileSha(relativePath: string) {
  return fileSha(path.join(process.cwd(), relativePath));
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonl<T>(filePath: string): T[] {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/gu)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function listFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const fullPath = path.join(root, name);
    return statSync(fullPath).isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

function treeSnapshot(root: string) {
  assert(existsSync(root), `e2a35_historical_run_missing:${root}`);
  const files = listFiles(root).sort().map((filePath) => ({
    path: path.relative(root, filePath),
    sha256: fileSha(filePath),
    bytes: statSync(filePath).size,
    owner_writable: (statSync(filePath).mode & 0o200) !== 0
  }));
  return {
    snapshot_version: "e2a35-stable-file-inventory-v1",
    root: path.relative(process.cwd(), root),
    file_count: files.length,
    tree_sha256: stableHash(files.map(({ path: filePath, sha256: hash, bytes }) => ({
      path: filePath,
      sha256: hash,
      bytes
    }))),
    writable_file_count: files.filter((entry) => entry.owner_writable).length,
    files
  };
}

function historicalIntegrity() {
  const tree = treeSnapshot(HISTORICAL_RUN);
  const summary = readJson<JsonRecord>(
    path.join(HISTORICAL_RUN, "canary-summary.json")
  );
  const critical_hashes = Object.fromEntries(
    Object.keys(EXPECTED_HISTORICAL_HASHES).map((name) => [
      name,
      fileSha(path.join(HISTORICAL_RUN, name))
    ])
  );
  const hashMismatches = Object.entries(EXPECTED_HISTORICAL_HASHES)
    .filter(([name, expected]) => critical_hashes[name] !== expected)
    .map(([name, expected]) => ({
      artifact: name,
      expected_sha256: expected,
      actual_sha256: critical_hashes[name]
    }));
  const passed =
    summary.status === HISTORICAL_STATUS &&
    summary.passed === false &&
    tree.file_count === HISTORICAL_FILE_COUNT &&
    tree.tree_sha256 === HISTORICAL_TREE_SHA256 &&
    tree.writable_file_count === 0 &&
    hashMismatches.length === 0;
  return {
    integrity_version: "e2a35-e2a34-historical-integrity-v1",
    historical_run_id: HISTORICAL_RUN_ID,
    historical_status: summary.status,
    historical_passed: false,
    historical_protocol_hash: HISTORICAL_PROTOCOL_HASH,
    historical_composite_runtime_identity:
      HISTORICAL_COMPOSITE_IDENTITY,
    critical_hashes,
    hash_mismatches: hashMismatches,
    tree,
    passed
  };
}

function protectedSourceIntegrity() {
  const actual_sha256 = Object.fromEntries(
    Object.keys(EXPECTED_PROTECTED_HASHES).map((relativePath) => [
      relativePath,
      relativeFileSha(relativePath)
    ])
  );
  const mismatches = Object.entries(EXPECTED_PROTECTED_HASHES)
    .filter(([relativePath, expected]) =>
      actual_sha256[relativePath] !== expected
    )
    .map(([relativePath, expected]) => ({
      relative_path: relativePath,
      expected_sha256: expected,
      actual_sha256: actual_sha256[relativePath]
    }));
  return {
    integrity_version: "e2a35-protected-source-integrity-v1",
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    evaluator_v5_unchanged:
      actual_sha256[
        "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
      ] === EXPECTED_PROTECTED_HASHES[
        "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
      ],
    tutor_candidate_unchanged:
      actual_sha256[
        "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
      ] === EXPECTED_PROTECTED_HASHES[
        "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
      ],
    legacy_parity_resolver_unchanged:
      actual_sha256[
        "src/lib/services/student-assessment/active-anchor-alias-resolution-v2.ts"
      ] === EXPECTED_PROTECTED_HASHES[
        "src/lib/services/student-assessment/active-anchor-alias-resolution-v2.ts"
      ],
    legacy_target_evidence_v5_unchanged:
      actual_sha256[
        "src/lib/services/student-assessment/target-evidence-contract-v5.ts"
      ] === EXPECTED_PROTECTED_HASHES[
        "src/lib/services/student-assessment/target-evidence-contract-v5.ts"
      ],
    actual_sha256,
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
    domain_id: "generic_claim",
    option_label: "D",
    option_text: "The stated claim always guarantees the observed outcome.",
    paraphrase: "the stated claim guarantees the outcome"
  },
  {
    domain_id: "generic_measure",
    option_label: "C",
    option_text: "A single measure always proves the intended conclusion.",
    paraphrase: "one measure proves the conclusion"
  },
  {
    domain_id: "generic_pathway",
    option_label: "B",
    option_text: "The direct pathway always determines the final state.",
    paraphrase: "the direct pathway determines the result"
  },
  {
    domain_id: "generic_comparison",
    option_label: "A",
    option_text: "The larger value always identifies the better explanation.",
    paraphrase: "the larger value proves the explanation"
  },
  {
    domain_id: "generic_pattern",
    option_label: "E",
    option_text: "A repeated pattern always guarantees the next observation.",
    paraphrase: "the pattern guarantees the next observation"
  },
  {
    domain_id: "generic_sequence",
    option_label: "F",
    option_text: "The first event always causes the final event.",
    paraphrase: "the first event causes the final event"
  },
  {
    domain_id: "generic_boundary",
    option_label: "G",
    option_text: "A result in one condition always applies in every condition.",
    paraphrase: "the result applies in every condition"
  },
  {
    domain_id: "generic_indicator",
    option_label: "H",
    option_text: "One indicator always establishes the hidden property.",
    paraphrase: "one indicator establishes the property"
  }
];

type CalibrationArchetype = {
  case_id: string;
  category:
    | "anchor_polarity"
    | "non_anchor_polarity"
    | "negation"
    | "contrast"
    | "uncertainty"
    | "pronoun"
    | "multiple_entities"
    | "causal_statistical_language"
    | "paraphrase"
    | "prior_reasoning";
  expected_stance: CanonicalStance;
  message: (domain: CalibrationDomain) => string;
  prior_stance?: CanonicalStance;
};

const CALIBRATION_ARCHETYPES: CalibrationArchetype[] = [
  {
    case_id: "option_wrong",
    category: "anchor_polarity",
    expected_stance: "rejects_distractor",
    message: (domain) => `Option ${domain.option_label} is wrong`
  },
  {
    case_id: "label_wrong",
    category: "anchor_polarity",
    expected_stance: "rejects_distractor",
    message: (domain) => `${domain.option_label} is wrong`
  },
  {
    case_id: "label_right",
    category: "anchor_polarity",
    expected_stance: "endorses_distractor",
    message: (domain) => `${domain.option_label} is right`
  },
  {
    case_id: "agree_option",
    category: "anchor_polarity",
    expected_stance: "endorses_distractor",
    message: (domain) => `I agree with option ${domain.option_label}`
  },
  {
    case_id: "disagree_option",
    category: "anchor_polarity",
    expected_stance: "rejects_distractor",
    message: (domain) => `I disagree with option ${domain.option_label}`
  },
  {
    case_id: "choose_mixed_non_anchor_negative",
    category: "multiple_entities",
    expected_stance: "endorses_distractor",
    message: (domain) =>
      `I choose ${domain.option_label}, although the result may be wrong`
  },
  {
    case_id: "result_wrong_non_anchor",
    category: "non_anchor_polarity",
    expected_stance: "ambiguous",
    message: (domain) =>
      `Option ${domain.option_label} is under review. The result is wrong.`
  },
  {
    case_id: "estimate_correct_non_anchor",
    category: "non_anchor_polarity",
    expected_stance: "ambiguous",
    message: (domain) =>
      `Option ${domain.option_label} is under review. The estimate is correct.`
  },
  {
    case_id: "score_false_non_anchor",
    category: "non_anchor_polarity",
    expected_stance: "ambiguous",
    message: (domain) =>
      `I am considering ${domain.option_label}. The score is false.`
  },
  {
    case_id: "anchor_wrong_result_correct",
    category: "multiple_entities",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `${domain.option_label} is wrong, although the result is correct.`
  },
  {
    case_id: "unsure_whether_right",
    category: "uncertainty",
    expected_stance: "ambiguous",
    message: (domain) =>
      `I am unsure whether ${domain.option_label} is right`
  },
  {
    case_id: "maybe_possible",
    category: "uncertainty",
    expected_stance: "ambiguous",
    message: (domain) => `Maybe ${domain.option_label} is possible`
  },
  {
    case_id: "might_be_possible",
    category: "uncertainty",
    expected_stance: "ambiguous",
    message: (domain) => `${domain.option_label} might be possible`
  },
  {
    case_id: "negated_agreement",
    category: "negation",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `I do not agree with ${domain.option_label}`
  },
  {
    case_id: "negated_disagreement",
    category: "negation",
    expected_stance: "endorses_distractor",
    message: (domain) =>
      `I do not disagree with ${domain.option_label}`
  },
  {
    case_id: "not_right",
    category: "negation",
    expected_stance: "rejects_distractor",
    message: (domain) => `${domain.option_label} is not right`
  },
  {
    case_id: "not_wrong",
    category: "negation",
    expected_stance: "endorses_distractor",
    message: (domain) => `${domain.option_label} is not wrong`
  },
  {
    case_id: "tempting_but_incorrect",
    category: "contrast",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `${domain.option_label} is tempting but incorrect`
  },
  {
    case_id: "sounds_right_but_wrong",
    category: "contrast",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `${domain.option_label} sounds right but is wrong`
  },
  {
    case_id: "anchor_right_calculation_wrong",
    category: "multiple_entities",
    expected_stance: "endorses_distractor",
    message: (domain) =>
      `${domain.option_label} is right, but the calculation is wrong`
  },
  {
    case_id: "result_wrong_anchor_right",
    category: "multiple_entities",
    expected_stance: "endorses_distractor",
    message: (domain) =>
      `The result is wrong, but ${domain.option_label} is right`
  },
  {
    case_id: "pronoun_agreement",
    category: "pronoun",
    expected_stance: "endorses_distractor",
    message: () => "I agree with that option"
  },
  {
    case_id: "pronoun_disagreement",
    category: "pronoun",
    expected_stance: "rejects_distractor",
    message: () => "I disagree with that option"
  },
  {
    case_id: "paraphrase_agreement",
    category: "paraphrase",
    expected_stance: "endorses_distractor",
    message: (domain) => `I agree with ${domain.paraphrase}`
  },
  {
    case_id: "paraphrase_disagreement",
    category: "paraphrase",
    expected_stance: "rejects_distractor",
    message: (domain) => `I disagree with ${domain.paraphrase}`
  },
  {
    case_id: "keep_as_distractor",
    category: "anchor_polarity",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `Keep ${domain.option_label} as a distractor`
  },
  {
    case_id: "conflicting_anchor_polarity",
    category: "contrast",
    expected_stance: "ambiguous",
    message: (domain) =>
      `${domain.option_label} is right. ${domain.option_label} is wrong.`
  },
  {
    case_id: "self_correction_rejection",
    category: "contrast",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `${domain.option_label} is right. Actually, ${domain.option_label} is wrong.`
  },
  {
    case_id: "self_correction_endorsement",
    category: "contrast",
    expected_stance: "endorses_distractor",
    message: (domain) =>
      `${domain.option_label} is wrong. Actually, ${domain.option_label} is right.`
  },
  {
    case_id: "prior_endorsement_continuity",
    category: "prior_reasoning",
    expected_stance: "endorses_distractor",
    message: (domain) =>
      `My view of option ${domain.option_label} is unchanged`,
    prior_stance: "endorses_distractor"
  },
  {
    case_id: "prior_rejection_continuity",
    category: "prior_reasoning",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `My view of option ${domain.option_label} is unchanged`,
    prior_stance: "rejects_distractor"
  },
  {
    case_id: "uncertainty_overrides_prior",
    category: "prior_reasoning",
    expected_stance: "ambiguous",
    message: (domain) =>
      `I am still unsure about option ${domain.option_label}`,
    prior_stance: "endorses_distractor"
  },
  {
    case_id: "causal_result_wrong",
    category: "causal_statistical_language",
    expected_stance: "ambiguous",
    message: (domain) =>
      `Option ${domain.option_label} is under review. The causal result is wrong.`
  },
  {
    case_id: "statistical_estimate_invalid",
    category: "causal_statistical_language",
    expected_stance: "ambiguous",
    message: (domain) =>
      `I am examining ${domain.option_label}. The statistical estimate is invalid.`
  },
  {
    case_id: "statistic_wrong_anchor_correct",
    category: "causal_statistical_language",
    expected_stance: "endorses_distractor",
    message: (domain) =>
      `The statistic is wrong, but ${domain.option_label} is correct.`
  },
  {
    case_id: "estimate_correct_anchor_wrong",
    category: "causal_statistical_language",
    expected_stance: "rejects_distractor",
    message: (domain) =>
      `The estimate is correct, but ${domain.option_label} is wrong.`
  }
];

function runCalibration() {
  const results = CALIBRATION_DOMAINS.flatMap((domain) => {
    const contract = buildActiveAnchorAliasContract({
      active_anchor_id: `${domain.domain_id}:option:${domain.option_label}`,
      option_label: domain.option_label,
      option_text: domain.option_text,
      accepted_paraphrases: [domain.paraphrase]
    });
    return CALIBRATION_ARCHETYPES.map((archetype) => {
      const message = archetype.message(domain);
      const reference = ActiveAnchorAliasResolutionSchema.parse(
        resolveActiveAnchorAlias({
          message,
          contract,
          prior_visible_message:
            `We are reviewing option ${domain.option_label}.`
        })
      );
      const resolution = resolveAnchorStanceScopeV1({
        message,
        contract,
        reference_resolution: reference,
        prior_student_reasoning: archetype.prior_stance
          ? [{ stance: archetype.prior_stance }]
          : []
      });
      const observed =
        resolution.stance_classification.observed_anchor_stance;
      return {
        case_id: `${domain.domain_id}:${archetype.case_id}`,
        domain_id: domain.domain_id,
        archetype_id: archetype.case_id,
        category: archetype.category,
        message,
        expected_reference: "explicit",
        observed_reference: reference.observed_anchor_reference,
        expected_stance: archetype.expected_stance,
        observed_stance: observed,
        resolution_basis:
          resolution.stance_classification.resolution_basis,
        anchor_targeted_cue_count:
          resolution.anchor_target_attachment.anchor_targeted_cue_count,
        non_anchor_cue_count:
          resolution.anchor_target_attachment.non_anchor_cue_count,
        passed:
          reference.observed_anchor_reference === "explicit" &&
          observed === archetype.expected_stance
      };
    });
  });
  const category_counts = Object.fromEntries(
    [...new Set(results.map((entry) => entry.category))].map((category) => [
      category,
      results.filter((entry) => entry.category === category).length
    ])
  );
  const requiredCases = [
    ["Option D is wrong", "rejects_distractor"],
    ["The result is wrong", "ambiguous"],
    [
      "I choose D, although the result may be wrong",
      "endorses_distractor"
    ],
    ["I am unsure whether D is right", "ambiguous"]
  ] as const;
  const required_boundaries = requiredCases.map(([snippet, expected]) => {
    const result = results.find((entry) =>
      entry.message.includes(snippet) &&
      entry.expected_stance === expected
    );
    return {
      snippet,
      expected_stance: expected,
      present: Boolean(result),
      passed: result?.passed === true
    };
  });
  return {
    calibration_version: "e2a34a-anchor-stance-scope-calibration-v1",
    resolver_version: ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
    case_count: results.length,
    minimum_required_case_count: 150,
    category_counts,
    required_boundaries,
    results,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    passed:
      results.length >= 150 &&
      results.every((entry) => entry.passed) &&
      required_boundaries.every((entry) => entry.present && entry.passed)
  };
}

function replayE2A34Turn1() {
  const simulatorPath = path.join(
    HISTORICAL_RUN,
    "simulator-provider-outputs.jsonl"
  );
  const evaluatorPath = path.join(
    HISTORICAL_RUN,
    "evaluator-normalized-results.jsonl"
  );
  const simulator = SimulatorOutputSchema.parse(
    readJsonl<unknown>(simulatorPath).find((row) => {
      const parsed = SimulatorOutputSchema.safeParse(row);
      return parsed.success && parsed.data.turn === 1;
    })
  );
  const evaluator = EvaluatorNormalizedSchema.parse(
    readJsonl<unknown>(evaluatorPath).find((row) => {
      const parsed = EvaluatorNormalizedSchema.safeParse(row);
      return parsed.success && parsed.data.turn === 1;
    })
  );
  const contract = TargetEvidenceContractV5Schema.parse(
    readJson<unknown>(path.join(HISTORICAL_RUN, "target-evidence-contract.json"))
  );
  const commonInput = {
    latest_student_message:
      simulator.parsed_structured_output.student_message,
    packet: evaluator.effective_evidence_packet,
    structured_turn_evidence: evaluator.structured_turn_evidence,
    contract,
    expected_source_student_turn_id: evaluator.source_student_turn_id,
    expected_source_sequence_index: evaluator.source_sequence_index,
    prior_visible_message: null
  };
  let legacyFailure: {
    name: string;
    message: string;
    issue_codes: string[];
  } | null = null;
  try {
    buildTargetEvidenceAdjudicationFromEvaluatorOutputV5(commonInput);
  } catch (error) {
    const candidate = error as {
      name?: string;
      message?: string;
      issue_codes?: string[];
    };
    legacyFailure = {
      name: candidate.name ?? "Error",
      message: candidate.message ?? "unknown_legacy_failure",
      issue_codes: candidate.issue_codes ?? []
    };
  }
  const corrected = buildTargetEvidenceScopedAdjudicationV1(commonInput);
  const wrongCueIds = corrected.anchor_stance_scope_resolution
    .polarity_detection.cues.filter((cue) =>
      cue.span.toLocaleLowerCase("en-CA") === "wrong"
    ).map((cue) => cue.cue_id);
  const wrongCueAttachments = corrected.anchor_stance_scope_resolution
    .anchor_target_attachment.decisions.filter((decision) =>
      wrongCueIds.includes(decision.cue_id)
    );
  const passed =
    legacyFailure?.issue_codes.includes("anchor_stance_not_detected") === true &&
    evaluator.structured_turn_evidence.observed_anchor_stance ===
      "endorses_distractor" &&
    corrected.anchor_stance_scope_resolution.stance_classification
      .observed_anchor_stance === "endorses_distractor" &&
    wrongCueAttachments.length > 0 &&
    wrongCueAttachments.every((entry) =>
      entry.attachment === "non_anchor"
    ) &&
    corrected.adjudication.canonical_anchor_evidence.stance ===
      "endorses_distractor" &&
    corrected.adjudication.anchor_parity_reconciliation.passed;
  return {
    replay_version: "e2a34a-turn-1-offline-replay-v1",
    replay_mode: "immutable_provider_output_no_provider_dispatch",
    historical_run_id: HISTORICAL_RUN_ID,
    historical_status: HISTORICAL_STATUS,
    historical_e2a34_passed: false,
    source_simulator_output_sha256: fileSha(simulatorPath),
    source_evaluator_output_sha256: fileSha(evaluatorPath),
    source_turn: {
      session_id: simulator.session_id,
      turn: simulator.turn,
      student_message: simulator.parsed_structured_output.student_message
    },
    before: {
      resolver: "active-anchor-alias-resolution-v2",
      failure: legacyFailure,
      false_parity_rejection_reproduced:
        legacyFailure?.issue_codes.includes(
          "anchor_stance_not_detected"
        ) === true
    },
    after: {
      resolver: ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
      integration_version: TARGET_EVIDENCE_SCOPED_ADJUDICATION_VERSION,
      canonical_anchor_stance:
        corrected.adjudication.canonical_anchor_evidence.stance,
      scoped_anchor_stance:
        corrected.anchor_stance_scope_resolution.stance_classification
          .observed_anchor_stance,
      resolution_basis:
        corrected.anchor_stance_scope_resolution.stance_classification
          .resolution_basis,
      wrong_polarity_attachment: wrongCueAttachments,
      canonical_anchor_stance_preserved:
        corrected.adjudication.canonical_anchor_evidence.stance ===
        evaluator.structured_turn_evidence.observed_anchor_stance,
      parity_passed:
        corrected.adjudication.anchor_parity_reconciliation.passed
    },
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    passed
  };
}

function scopeContract() {
  return {
    contract_version: "anchor-stance-scope-resolution-contract-v1",
    resolver_version: ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
    stages: [
      {
        stage: "polarity_detection",
        responsibility:
          "Detect positive, negative, uncertain, and negated language without assigning it to an entity."
      },
      {
        stage: "anchor_target_attachment",
        responsibility:
          "Attach each cue to the active anchor, a non-anchor entity, or an unresolved target."
      },
      {
        stage: "stance_classification",
        responsibility:
          "Classify anchor stance only from anchor-targeted evidence, discourse scope, and bounded prior student reasoning."
      }
    ],
    invariants: [
      "lexical_polarity_without_anchor_attachment_cannot_change_anchor_stance",
      "uncertainty_attached_to_the_anchor_remains_ambiguous",
      "contrast_applies_only_to_anchor_targeted_cues",
      "canonical_evaluator_anchor_evidence_is_not_rewritten",
      "reference_resolution_and_stance_resolution_remain_separate"
    ],
    required_boundaries: [
      {
        message: "Option D is wrong",
        expected_attachment: "anchor_targeted",
        expected_stance: "rejects_distractor"
      },
      {
        message: "The result is wrong",
        expected_attachment: "non_anchor",
        expected_effect_on_anchor_stance: "none"
      },
      {
        message: "I choose D, although the result may be wrong",
        expected_attachment: "mixed",
        expected_stance: "endorses_distractor"
      },
      {
        message: "I am unsure whether D is right",
        expected_attachment: "anchor_targeted",
        expected_stance: "ambiguous"
      }
    ],
    domain_specific_rules_present: false,
    evaluator_v5_modified: false,
    tutor_candidate_modified: false,
    passed: true
  };
}

function runtimeWiringVerification() {
  const runtimePath =
    "src/lib/services/student-assessment/activity-runtime-ui.ts";
  const runtime = readFileSync(path.join(process.cwd(), runtimePath), "utf8");
  const checks = {
    scoped_builder_is_runtime_path:
      runtime.includes("buildTargetEvidenceScopedAdjudicationV1"),
    legacy_builder_not_runtime_path:
      !runtime.includes("buildTargetEvidenceAdjudicationFromEvaluatorOutputV5"),
    scope_resolution_is_persisted:
      runtime.includes("evidence_first_anchor_stance_scope_resolution"),
    integration_version_is_persisted:
      runtime.includes(
        "evidence_first_target_adjudication_integration_version"
      ),
    process_event_has_scope_version:
      runtime.includes("anchor_stance_scope_resolution_version"),
    process_event_has_scope_basis:
      runtime.includes("anchor_stance_scope_resolution_basis")
  };
  return {
    verification_version: "e2a34a-runtime-wiring-verification-v1",
    runtime_path: runtimePath,
    runtime_sha256: relativeFileSha(runtimePath),
    checks,
    passed: Object.values(checks).every(Boolean)
  };
}

function budgetContract() {
  const budget = {
    budget_version: "e2a35-bounded-live-budget-v1",
    isolated_session_count: 1,
    maximum_logical_calls: 29,
    maximum_adapter_attempts: 87,
    maximum_transport_retries_per_logical_call: 2,
    maximum_adapter_attempts_per_logical_call: 3,
    maximum_input_tokens: 900_000,
    maximum_output_tokens: 70_000,
    maximum_total_tokens: 970_000,
    maximum_cost_usd_when_pricing_available: 25,
    provider_concurrency: 1
  };
  return {
    ...budget,
    arithmetic_valid:
      budget.maximum_adapter_attempts ===
        budget.maximum_logical_calls *
          budget.maximum_adapter_attempts_per_logical_call &&
      budget.maximum_total_tokens ===
        budget.maximum_input_tokens + budget.maximum_output_tokens,
    execution_authorized: false,
    passed: true
  };
}

function futureArtifactContract() {
  const historicalNames = listFiles(HISTORICAL_RUN)
    .map((filePath) => path.relative(HISTORICAL_RUN, filePath))
    .sort();
  const required = [...new Set([
    ...historicalNames,
    "anchor-stance-scope-resolution-results.jsonl",
    "scope-attachment-parity-results.jsonl"
  ])].sort();
  return {
    artifact_contract_version: "e2a35-live-artifact-contract-v1",
    required_artifacts: required,
    required_new_artifacts: [
      "anchor-stance-scope-resolution-results.jsonl",
      "scope-attachment-parity-results.jsonl"
    ],
    preserve_provider_outputs: true,
    preserve_reference_and_stance_separately: true,
    human_review_required: true,
    immutable_after_completion: true,
    execution_authorized: false,
    passed:
      required.includes("simulator-provider-outputs.jsonl") &&
      required.includes("evaluator-provider-outputs.jsonl") &&
      required.includes("anchor-stance-scope-resolution-results.jsonl") &&
      required.includes("human-review-packet.json")
  };
}

function buildProtocol(input: {
  calibration: ReturnType<typeof runCalibration>;
  replay: ReturnType<typeof replayE2A34Turn1>;
  historical: ReturnType<typeof historicalIntegrity>;
  protectedSources: ReturnType<typeof protectedSourceIntegrity>;
  runtimeWiring: ReturnType<typeof runtimeWiringVerification>;
  scope: ReturnType<typeof scopeContract>;
  budget: ReturnType<typeof budgetContract>;
  artifacts: ReturnType<typeof futureArtifactContract>;
}) {
  const sourceHashes = {
    scope_resolver_sha256: relativeFileSha(
      "src/lib/services/student-assessment/anchor-stance-scope-resolution-v1.ts"
    ),
    scoped_adjudication_sha256: relativeFileSha(
      "src/lib/services/student-assessment/target-evidence-scoped-adjudication-v1.ts"
    ),
    runtime_wiring_sha256: relativeFileSha(
      "src/lib/services/student-assessment/activity-runtime-ui.ts"
    ),
    evaluator_v5_sha256:
      input.protectedSources.actual_sha256[
        "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
      ],
    tutor_candidate_sha256:
      input.protectedSources.actual_sha256[
        "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
      ]
  };
  const targetContractHash = fileSha(
    path.join(HISTORICAL_RUN, "target-evidence-contract.json")
  );
  const canonicalAnchorHash = fileSha(
    path.join(HISTORICAL_RUN, "canonical-anchor-contract.json")
  );
  const trajectoryEnvelopeHash = fileSha(
    path.join(HISTORICAL_RUN, "trajectory-envelope-contract.json")
  );
  const protocol = {
    protocol_version: PROTOCOL_VERSION,
    correction_version: CORRECTION_VERSION,
    protocol_state: "prepared_for_separate_authorization_not_executable",
    execution_authorized: false,
    live_harness_present: false,
    live_execution_performed: false,
    e2a34_rerun_performed: false,
    historical_e2a34_passed: false,
    historical_run_id: HISTORICAL_RUN_ID,
    historical_status: HISTORICAL_STATUS,
    historical_protocol_hash: HISTORICAL_PROTOCOL_HASH,
    historical_composite_runtime_identity:
      HISTORICAL_COMPOSITE_IDENTITY,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    scope_resolution_version: ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
    scoped_adjudication_version:
      TARGET_EVIDENCE_SCOPED_ADJUDICATION_VERSION,
    source_hashes: sourceHashes,
    target_evidence_contract_hash: targetContractHash,
    canonical_anchor_contract_hash: canonicalAnchorHash,
    trajectory_envelope_contract_hash: trajectoryEnvelopeHash,
    scope_contract_hash: stableHash(input.scope),
    calibration_hash: stableHash(input.calibration),
    replay_hash: stableHash(input.replay),
    budget_hash: stableHash(input.budget),
    artifact_contract_hash: stableHash(input.artifacts),
    historical_evidence_tree_hash: input.historical.tree.tree_sha256,
    gates: {
      scope_contract_valid: input.scope.passed,
      calibration_passed: input.calibration.passed,
      immutable_replay_passed: input.replay.passed,
      historical_evidence_unchanged: input.historical.passed,
      protected_sources_unchanged: input.protectedSources.passed,
      runtime_wiring_verified: input.runtimeWiring.passed,
      budget_valid: input.budget.passed && input.budget.arithmetic_valid,
      artifact_contract_valid: input.artifacts.passed,
      provider_call_guard_passed: networkRequestCount === 0
    }
  };
  return {
    ...protocol,
    protocol_hash: stableHash(protocol),
    passed: Object.values(protocol.gates).every(Boolean)
  };
}

function compositeRuntimeIdentity(input: {
  protocol: ReturnType<typeof buildProtocol>;
  historical: ReturnType<typeof historicalIntegrity>;
}) {
  const identity = {
    identity_version: "e2a35-composite-runtime-identity-v1",
    preparation_application_git_commit: execFileSync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: process.cwd(), encoding: "utf8" }
    ).trim(),
    protocol_hash: input.protocol.protocol_hash,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    scope_resolution_version: ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
    scoped_adjudication_version:
      TARGET_EVIDENCE_SCOPED_ADJUDICATION_VERSION,
    historical_e2a34_run_id: HISTORICAL_RUN_ID,
    historical_evidence_tree_hash: input.historical.tree.tree_sha256,
    execution_authorized: false
  };
  return {
    ...identity,
    composite_runtime_identity_hash: stableHash(identity)
  };
}

function validateArtifacts(outputDirectory: string) {
  const expected = ARTIFACT_NAMES
    .filter((name) => name !== "artifact-validation.json")
    .sort();
  const expectedSet = new Set<string>(expected);
  const actual = readdirSync(outputDirectory).sort();
  const missing = expected.filter((name) => !actual.includes(name));
  const unexpected = actual.filter((name) => !expectedSet.has(name));
  const unsafePatterns = [
    /\bsk-[A-Za-z0-9_-]{12,}\b/u,
    /Bearer\s+[A-Za-z0-9._-]+/iu,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u,
    /Authorization\s*:/iu
  ];
  const unsafe = actual.filter((name) => {
    const filePath = path.join(outputDirectory, name);
    return statSync(filePath).isFile() &&
      unsafePatterns.some((pattern) =>
        pattern.test(readFileSync(filePath, "utf8"))
      );
  });
  return {
    validation_version: "e2a35-artifact-validation-v1",
    expected_artifact_count: expected.length,
    actual_artifact_count_before_validation_record: actual.length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    unsafe_artifacts: unsafe,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    passed:
      missing.length === 0 &&
      unexpected.length === 0 &&
      unsafe.length === 0 &&
      networkRequestCount === 0
  };
}

function makeRunId() {
  return `e2a35_${new Date().toISOString().replace(/[-:.Z]/gu, "")}_${
    randomBytes(4).toString("hex")
  }`;
}

function execute(outputDirectory: string) {
  mkdirSync(outputDirectory, { recursive: true });
  const historicalBefore = historicalIntegrity();
  const protectedSources = protectedSourceIntegrity();
  const scope = scopeContract();
  const calibration = runCalibration();
  const replay = replayE2A34Turn1();
  const runtimeWiring = runtimeWiringVerification();
  const budget = budgetContract();
  const artifacts = futureArtifactContract();
  const protocol = buildProtocol({
    calibration,
    replay,
    historical: historicalBefore,
    protectedSources,
    runtimeWiring,
    scope,
    budget,
    artifacts
  });
  const composite = compositeRuntimeIdentity({
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
  const providerGuard = {
    guard_version: "e2a35-provider-call-guard-v1",
    fetch_guard_installed: true,
    provider_client_created: false,
    provider_dispatch_path_present: false,
    live_command_present: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    passed: networkRequestCount === 0
  };
  const summary = {
    status:
      protocol.passed && historicalUnchanged && providerGuard.passed
        ? "e2a35_protocol_prepared_for_separate_authorization"
        : "e2a35_protocol_not_ready",
    correction_version: CORRECTION_VERSION,
    protocol_version: PROTOCOL_VERSION,
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      composite.composite_runtime_identity_hash,
    calibration_case_count: calibration.case_count,
    calibration_passed: calibration.passed,
    e2a34_turn_1_replay_passed: replay.passed,
    historical_e2a34_run_id: HISTORICAL_RUN_ID,
    historical_e2a34_status: HISTORICAL_STATUS,
    historical_e2a34_passed: false,
    historical_evidence_unchanged: historicalUnchanged,
    evaluator_v5_unchanged: protectedSources.evaluator_v5_unchanged,
    tutor_candidate_unchanged: protectedSources.tutor_candidate_unchanged,
    e2a34_rerun_performed: false,
    e2a35_execution_authorized: false,
    e2a35_live_execution_performed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  };

  writeJson(path.join(outputDirectory, "correction-manifest.json"), {
    correction_version: CORRECTION_VERSION,
    execution_mode: "deterministic_no_live_protocol_preparation",
    e2a34_rerun_performed: false,
    e2a35_live_execution_performed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  });
  writeJson(
    path.join(outputDirectory, "anchor-stance-scope-contract.json"),
    scope
  );
  writeJson(
    path.join(outputDirectory, "anchor-stance-scope-calibration.json"),
    calibration
  );
  writeJson(
    path.join(outputDirectory, "e2a34-turn-1-offline-replay.json"),
    replay
  );
  writeJson(
    path.join(outputDirectory, "e2a34-historical-integrity-before.json"),
    historicalBefore
  );
  writeJson(
    path.join(outputDirectory, "e2a34-historical-integrity-after.json"),
    historicalAfter
  );
  writeJson(
    path.join(outputDirectory, "protected-source-integrity.json"),
    protectedSources
  );
  writeJson(
    path.join(outputDirectory, "runtime-wiring-verification.json"),
    runtimeWiring
  );
  writeJson(path.join(outputDirectory, "e2a35-budget.json"), budget);
  writeJson(
    path.join(outputDirectory, "e2a35-artifact-contract.json"),
    artifacts
  );
  writeJson(path.join(outputDirectory, "e2a35-protocol.json"), protocol);
  writeFileSync(
    path.join(outputDirectory, "e2a35-protocol.sha256"),
    `${protocol.protocol_hash}\n`,
    "utf8"
  );
  writeJson(
    path.join(outputDirectory, "composite-runtime-identity.json"),
    composite
  );
  writeJson(
    path.join(outputDirectory, "provider-call-guard.json"),
    providerGuard
  );
  writeJson(path.join(outputDirectory, "summary.json"), summary);

  const artifactValidation = validateArtifacts(outputDirectory);
  writeJson(
    path.join(outputDirectory, "artifact-validation.json"),
    artifactValidation
  );
  const finalPassed =
    artifactValidation.passed &&
    protocol.passed &&
    historicalUnchanged &&
    providerGuard.passed;
  if (!finalPassed) {
    throw new Error("e2a35_deterministic_verification_failed");
  }
  for (const filePath of listFiles(outputDirectory)) {
    chmodSync(filePath, 0o444);
  }
  return { summary, artifactValidation, outputDirectory };
}

function latestRunDirectory() {
  assert(existsSync(ARTIFACT_ROOT), "e2a35_artifact_root_missing");
  const latest = readdirSync(ARTIFACT_ROOT)
    .map((name) => path.join(ARTIFACT_ROOT, name))
    .filter((entry) => statSync(entry).isDirectory())
    .sort()
    .at(-1);
  assert(latest, "e2a35_artifact_run_missing");
  return latest;
}

function runSmoke(suite: string) {
  const outputDirectory = mkdtempSync(
    path.join(tmpdir(), "e2a35-scope-resolution-")
  );
  try {
    const result = execute(outputDirectory);
    const summary = result.summary;
    const checks: Record<string, boolean> = {
      all: result.artifactValidation.passed,
      calibration: summary.calibration_passed,
      replay: summary.e2a34_turn_1_replay_passed,
      historical: summary.historical_evidence_unchanged,
      runtime: true,
      artifact: result.artifactValidation.passed,
      "provider-call-guard":
        summary.provider_calls_made === 0 &&
        summary.network_requests_made === 0
    };
    assert(suite in checks, `e2a35_unknown_smoke_suite:${suite}`);
    assert(checks[suite], `e2a35_${suite}_smoke_failed`);
    console.log(JSON.stringify({
      status: "passed",
      suite,
      protocol_hash: summary.protocol_hash,
      composite_runtime_identity_hash:
        summary.composite_runtime_identity_hash,
      calibration_case_count: summary.calibration_case_count,
      historical_e2a34_passed: false,
      e2a34_rerun_performed: false,
      e2a35_live_execution_performed: false,
      provider_calls_made: 0,
      network_requests_made: networkRequestCount
    }, null, 2));
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

function main() {
  const command = process.argv[2] ?? "report";
  if (command === "run") {
    const outputDirectory = path.join(ARTIFACT_ROOT, makeRunId());
    const result = execute(outputDirectory);
    console.log(JSON.stringify({
      ...result.summary,
      artifact_directory: path.relative(process.cwd(), outputDirectory)
    }, null, 2));
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
  throw new Error(`e2a35_unknown_command:${command}`);
}

main();
