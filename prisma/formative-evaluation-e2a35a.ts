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
import { stableHash } from "../src/lib/operational/stable-hash";
import {
  buildSelfCorrectionEvidenceContractV1,
  resolveSelfCorrectionEvidenceV1,
  resolveSelfCorrectionIntentSignalV1,
  type SelfCorrectionConceptualEvidenceObservationV1
} from "../src/lib/evaluation/formative/self-correction-evidence-v1";
import {
  buildSelfCorrectionIntentContractV1,
  resolveSelfCorrectionIntentV1,
  SelfCorrectionIntentContractV1Schema
} from "../src/lib/evaluation/formative/self-correction-intent-v1";

const CORRECTION_VERSION =
  "e2a35a-self-correction-evidence-separation-v1" as const;
const E2A36_PROTOCOL_VERSION =
  "e2a36-sampling-bias-self-correction-evidence-canary-v1" as const;
const ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a35a-self-correction-evidence-separation"
);
const HISTORICAL_RUN_ID = "e2a35_20260724224131_d10b5897";
const HISTORICAL_RUN_DIR = path.join(
  process.cwd(),
  ".data",
  "e2a35-sampling-bias-self-correction-canary",
  HISTORICAL_RUN_ID
);
const HISTORICAL_STATUS = "e2a35_canary_failed_stability";
const HISTORICAL_PROTOCOL_HASH =
  "97812ff31dc3af594b992c01706bed8ddda2229ac1e5cbdd96f916c2e569e9b9";
const HISTORICAL_COMPOSITE_IDENTITY =
  "cc6f9a6f1f4000106f599c8221b01fbf9c72ff01360ac6b32b2aff4bc9b88303";
const HISTORICAL_FILE_COUNT = 96;
const HISTORICAL_TREE_SHA256 =
  "b514cfa4a17b391f353ef2de37548c68db74c60bc8a267964e2aa45345fba27b";
const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";

const EXPECTED_HISTORICAL_HASHES = {
  "canary-summary.json":
    "76e58a0723df81e77d65e4d118d0567ee7b1d99f881e40ccb17acb4cb4a49e83",
  "human-review-packet.json":
    "d08cda96756d69335d097c33f4d6a31d19a360085062308481fc1a5a1162821a",
  "simulator-provider-outputs.jsonl":
    "961f80c72ac8c5297311573b66245761148fdc340e2c62be54a2ed781e71ca8a",
  "evaluator-provider-outputs.jsonl":
    "46f64d15cec9e067366c638602aa5bfb5c303f046891a27cad73d0a6b9702c54",
  "autonomous-tutor-provider-outputs.jsonl":
    "d99cdb1fae82e198dd0cf909a877736e17081cdd21e1417c7148cd419490b378",
  "provider-attempt-results.jsonl":
    "edcf8d7ea2367ead93938d9cf71bf9329d39146ae3a58885d19bdd0a43a39589"
} as const;

const EXPECTED_PROTECTED_HASHES = {
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json":
    "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2",
  "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts":
    "b57df1ed269ef1e5f7e2ec7ad3c394d0c7b247afa54c7d067598caa3e47eda09",
  "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts":
    "6ff02d152f95608235d78592a6a1d4970a1ed1f2d7477bbaaaca7e96a878f9cd"
} as const;

const PAYLOAD_NAMES = [
  "correction-manifest.json",
  "self-correction-evidence-contract.json",
  "self-correction-evidence-calibration.json",
  "deterministic-evidence-separation-regressions.json",
  "e2a35-turn2-offline-replay.json",
  "e2a35-historical-integrity-before.json",
  "e2a35-historical-integrity-after.json",
  "protected-source-integrity.json",
  "e2a36-budget.json",
  "e2a36-artifact-contract.json",
  "e2a36-protocol.json",
  "e2a36-protocol.sha256",
  "e2a36-composite-runtime-identity.json",
  "provider-call-guard.json",
  "summary.json"
] as const;
const ARTIFACT_NAMES = [...PAYLOAD_NAMES, "artifact-validation.json"] as const;

type JsonRecord = Record<string, unknown>;
type HistoricalSimulatorRow = {
  session_id: string;
  turn: number;
  attempt: number;
  parsed_structured_output: {
    student_message: string;
    rendered_intent: string;
    expressed_evidence_level: string;
    mentions_focus_option: boolean;
  };
};

let networkRequestCount = 0;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a35a_network_request_prohibited");
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
  const content = readFileSync(filePath, "utf8").trim();
  return content
    ? content.split(/\r?\n/u).map((line) => JSON.parse(line) as T)
    : [];
}

function assertSafe(value: unknown) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    /\bBearer\s+[A-Za-z0-9._-]+/u,
    /\bsk-[A-Za-z0-9_-]{12,}/u,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u,
    /authorization\s*:\s*["']?bearer/iu
  ];
  assert(
    !forbidden.some((pattern) => pattern.test(serialized)),
    "e2a35a_forbidden_secret_detected"
  );
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

function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

function historicalSnapshot() {
  assert(existsSync(HISTORICAL_RUN_DIR), "e2a35a_historical_run_missing");
  const files = listFiles(HISTORICAL_RUN_DIR).map((filePath) => ({
    path: path.relative(HISTORICAL_RUN_DIR, filePath),
    sha256: fileSha(filePath),
    bytes: statSync(filePath).size,
    owner_writable: (statSync(filePath).mode & 0o200) !== 0
  }));
  const criticalHashes = Object.fromEntries(
    Object.keys(EXPECTED_HISTORICAL_HASHES).map((name) => [
      name,
      fileSha(path.join(HISTORICAL_RUN_DIR, name))
    ])
  );
  const criticalMismatches = Object.entries(EXPECTED_HISTORICAL_HASHES)
    .filter(([name, expected]) => criticalHashes[name] !== expected)
    .map(([name, expected]) => ({
      artifact: name,
      expected_sha256: expected,
      actual_sha256: criticalHashes[name]
    }));
  const summary = readJson<JsonRecord>(
    path.join(HISTORICAL_RUN_DIR, "canary-summary.json")
  );
  const aggregate = stableHash(files.map((entry) => ({
    path: entry.path,
    sha256: entry.sha256,
    bytes: entry.bytes
  })));
  return {
    snapshot_version: "e2a35a-historical-evidence-snapshot-v1",
    historical_run_id: HISTORICAL_RUN_ID,
    historical_status: summary.status,
    historical_passed: summary.passed,
    historical_protocol_hash: summary.protocol_hash,
    historical_composite_runtime_identity_hash:
      summary.frozen_composite_runtime_identity_hash,
    file_count: files.length,
    owner_writable_file_count:
      files.filter((entry) => entry.owner_writable).length,
    aggregate_sha256: aggregate,
    critical_hashes: criticalHashes,
    critical_mismatches: criticalMismatches,
    expected_aggregate_sha256: HISTORICAL_TREE_SHA256,
    files,
    passed:
      summary.status === HISTORICAL_STATUS &&
      summary.passed === false &&
      summary.protocol_hash === HISTORICAL_PROTOCOL_HASH &&
      summary.frozen_composite_runtime_identity_hash ===
        HISTORICAL_COMPOSITE_IDENTITY &&
      files.length === HISTORICAL_FILE_COUNT &&
      files.filter((entry) => entry.owner_writable).length === 0 &&
      aggregate === HISTORICAL_TREE_SHA256 &&
      criticalMismatches.length === 0
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
  const candidate = readJson<{ candidate_configuration_hash: string }>(
    path.join(
      process.cwd(),
      "config",
      "candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json"
    )
  );
  return {
    integrity_version: "e2a35a-protected-source-integrity-v1",
    candidate_configuration_hash:
      candidate.candidate_configuration_hash,
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
    candidate_file_unchanged: actual[
      "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json"
    ] === EXPECTED_PROTECTED_HASHES[
      "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json"
    ],
    expected_sha256: EXPECTED_PROTECTED_HASHES,
    actual_sha256: actual,
    mismatches,
    passed:
      candidate.candidate_configuration_hash ===
        CANDIDATE_CONFIGURATION_HASH &&
      mismatches.length === 0
  };
}

type CalibrationContext = {
  context_id: string;
  topic_term: string;
  anchor_alias: string;
  mechanism: string;
  complete_boundary: string;
  copied_phrase: string;
  misconception_reason: string;
  unrelated_topic: string;
};

const CALIBRATION_CONTEXTS: CalibrationContext[] = [
  {
    context_id: "sampling",
    topic_term: "volunteer sample",
    anchor_alias: "option D",
    mechanism: "volunteers may differ systematically from non-volunteers",
    complete_boundary: "the result cannot generalize to the full population",
    copied_phrase: "sampling bias affects generalization",
    misconception_reason: "anyone could volunteer",
    unrelated_topic: "hockey game"
  },
  {
    context_id: "measurement",
    topic_term: "reliability coefficient",
    anchor_alias: "option C",
    mechanism: "score consistency does not establish validity",
    complete_boundary: "the intended interpretation needs separate evidence",
    copied_phrase: "reliability is not validity",
    misconception_reason: "a high coefficient proves the interpretation",
    unrelated_topic: "concert"
  },
  {
    context_id: "causal",
    topic_term: "observed correlation",
    anchor_alias: "option B",
    mechanism: "a confounder may affect both measured variables",
    complete_boundary: "correlation alone cannot establish causation",
    copied_phrase: "correlation is not causation",
    misconception_reason: "the variables move together",
    unrelated_topic: "weather"
  },
  {
    context_id: "algorithm",
    topic_term: "search procedure",
    anchor_alias: "option A",
    mechanism: "the discarded interval can still contain the target",
    complete_boundary: "the update rule must preserve the search invariant",
    copied_phrase: "the invariant must be preserved",
    misconception_reason: "the midpoint looked too large",
    unrelated_topic: "movie"
  },
  {
    context_id: "optics",
    topic_term: "ray diagram",
    anchor_alias: "option D",
    mechanism: "the rays diverge after passing the lens",
    complete_boundary: "the image location follows from backward extensions",
    copied_phrase: "ray direction determines image type",
    misconception_reason: "the image appears on the far side",
    unrelated_topic: "music"
  },
  {
    context_id: "ecology",
    topic_term: "population response",
    anchor_alias: "option C",
    mechanism: "density dependence changes per-capita growth",
    complete_boundary: "the observed total is not a constant growth rate",
    copied_phrase: "density affects population growth",
    misconception_reason: "more organisms always means more growth",
    unrelated_topic: "travel"
  },
  {
    context_id: "circuits",
    topic_term: "parallel branch",
    anchor_alias: "option B",
    mechanism: "branch currents sum at the junction",
    complete_boundary: "equal voltage does not imply equal total current",
    copied_phrase: "current is conserved",
    misconception_reason: "each branch receives the same current",
    unrelated_topic: "lunch"
  },
  {
    context_id: "thermal",
    topic_term: "thermal contact",
    anchor_alias: "option A",
    mechanism: "net energy transfer depends on temperature difference",
    complete_boundary: "equilibrium means no net transfer, not no motion",
    copied_phrase: "heat flows down a temperature gradient",
    misconception_reason: "both objects contain energy",
    unrelated_topic: "sports"
  },
  {
    context_id: "statistics",
    topic_term: "p-value",
    anchor_alias: "option D",
    mechanism: "the probability is calculated under the null hypothesis",
    complete_boundary: "it is not the probability that a hypothesis is true",
    copied_phrase: "p-value is conditional on the null",
    misconception_reason: "one minus p is hypothesis probability",
    unrelated_topic: "television"
  },
  {
    context_id: "health",
    topic_term: "treatment comparison",
    anchor_alias: "option C",
    mechanism: "baseline differences can explain the observed outcome",
    complete_boundary: "a fair comparison requires control of those differences",
    copied_phrase: "confounding limits causal inference",
    misconception_reason: "the treated group improved more",
    unrelated_topic: "vacation"
  }
];

type CalibrationArchetype = {
  archetype_id: string;
  message: (context: CalibrationContext) => string;
  expected_intent: boolean;
  evidence: (
    context: CalibrationContext
  ) => SelfCorrectionConceptualEvidenceObservationV1;
  expected_update: boolean;
  expected_disposition:
    | "preserve_prior_profile"
    | "update_from_latest_evidence"
    | "reopen_from_latest_contradiction";
  expected_sound: boolean;
};

function evidence(input: Partial<
  SelfCorrectionConceptualEvidenceObservationV1
> = {}): SelfCorrectionConceptualEvidenceObservationV1 {
  return {
    evidence_source: "deterministic_fixture",
    evidence_kind: "none",
    reasoning_quality: "insufficient",
    observable_evidence_spans: [],
    independent_application_present: false,
    copied_or_formulaic_language_detected: false,
    topic_relevant: true,
    anchor_application: "absent",
    anchor_stance: "not_expressed",
    anchor_consistency: "not_assessable",
    misconception_status: "uncertain",
    essential_missing_links: ["observable_conceptual_evidence"],
    contradictions: [],
    prior_profile_status: "persists",
    ...input
  };
}

function conceptualEvidence(
  context: CalibrationContext,
  input: Partial<SelfCorrectionConceptualEvidenceObservationV1> = {}
) {
  return evidence({
    evidence_kind: "conceptual_reasoning",
    reasoning_quality: "partial",
    observable_evidence_spans: [{
      label: "independent_mechanism",
      span: context.mechanism
    }],
    independent_application_present: true,
    anchor_application: "implicit",
    anchor_stance: "not_expressed",
    anchor_consistency: "unresolved",
    misconception_status: "uncertain",
    essential_missing_links: [context.complete_boundary],
    ...input
  });
}

const CALIBRATION_ARCHETYPES: CalibrationArchetype[] = [
  {
    archetype_id: "bare_correction_claim",
    message: () => "I was wrong.",
    expected_intent: true,
    evidence: () => evidence(),
    expected_update: false,
    expected_disposition: "preserve_prior_profile",
    expected_sound: false
  },
  {
    archetype_id: "prior_answer_correction_claim",
    message: () => "I think my previous answer was wrong.",
    expected_intent: true,
    evidence: () => evidence(),
    expected_update: false,
    expected_disposition: "preserve_prior_profile",
    expected_sound: false
  },
  {
    archetype_id: "answer_revision_only",
    message: (context) => `I meant ${context.anchor_alias}.`,
    expected_intent: true,
    evidence: (context) => evidence({
      evidence_kind: "answer_revision_only",
      observable_evidence_spans: [{
        label: "answer_revision",
        span: context.anchor_alias
      }],
      anchor_application: "explicit",
      essential_missing_links: ["conceptual_reasoning"]
    }),
    expected_update: false,
    expected_disposition: "preserve_prior_profile",
    expected_sound: false
  },
  {
    archetype_id: "option_mention_without_evidence",
    message: (context) => `I was wrong about ${context.anchor_alias}.`,
    expected_intent: true,
    evidence: (context) => evidence({
      evidence_kind: "answer_revision_only",
      observable_evidence_spans: [{
        label: "anchor_reference_only",
        span: context.anchor_alias
      }],
      anchor_application: "explicit",
      essential_missing_links: ["conceptual_reasoning"]
    }),
    expected_update: false,
    expected_disposition: "preserve_prior_profile",
    expected_sound: false
  },
  {
    archetype_id: "conceptual_correction",
    message: (context) =>
      `I was wrong because ${context.mechanism}.`,
    expected_intent: true,
    evidence: (context) => conceptualEvidence(context),
    expected_update: true,
    expected_disposition: "update_from_latest_evidence",
    expected_sound: false
  },
  {
    archetype_id: "conceptual_correction_with_rejection",
    message: (context) =>
      `I was wrong: ${context.anchor_alias} is wrong because ${context.mechanism}.`,
    expected_intent: true,
    evidence: (context) => conceptualEvidence(context, {
      anchor_application: "explicit",
      anchor_stance: "rejects_distractor",
      anchor_consistency: "consistent_with_conceptual_reasoning"
    }),
    expected_update: true,
    expected_disposition: "update_from_latest_evidence",
    expected_sound: false
  },
  {
    archetype_id: "complete_sound_correction",
    message: (context) =>
      `I was wrong: ${context.mechanism}, so ${context.complete_boundary}. I reject ${context.anchor_alias}.`,
    expected_intent: true,
    evidence: (context) => conceptualEvidence(context, {
      reasoning_quality: "sound",
      observable_evidence_spans: [{
        label: "independent_mechanism",
        span: context.mechanism
      }, {
        label: "independent_boundary",
        span: context.complete_boundary
      }],
      anchor_application: "explicit",
      anchor_stance: "rejects_distractor",
      anchor_consistency: "consistent_with_conceptual_reasoning",
      misconception_status: "resolved_for_current_anchor",
      essential_missing_links: []
    }),
    expected_update: true,
    expected_disposition: "update_from_latest_evidence",
    expected_sound: true
  },
  {
    archetype_id: "copied_correction_stem",
    message: () => "I was wrong because sampling bias affects generalization.",
    expected_intent: true,
    evidence: () => evidence({
      evidence_kind: "copied_or_formulaic",
      observable_evidence_spans: [{
        label: "copied_phrase",
        span: "sampling bias affects generalization"
      }],
      copied_or_formulaic_language_detected: true
    }),
    expected_update: false,
    expected_disposition: "preserve_prior_profile",
    expected_sound: false
  },
  {
    archetype_id: "copied_context_phrase",
    message: (context) => `I was wrong because ${context.copied_phrase}.`,
    expected_intent: true,
    evidence: (context) => evidence({
      evidence_kind: "copied_or_formulaic",
      observable_evidence_spans: [{
        label: "copied_phrase",
        span: context.copied_phrase
      }],
      copied_or_formulaic_language_detected: true
    }),
    expected_update: false,
    expected_disposition: "preserve_prior_profile",
    expected_sound: false
  },
  {
    archetype_id: "correction_preserving_misconception",
    message: (context) =>
      `I was wrong, but ${context.anchor_alias} is still correct.`,
    expected_intent: true,
    evidence: (context) => evidence({
      evidence_kind: "anchor_stance_evidence",
      reasoning_quality: "misconception",
      observable_evidence_spans: [{
        label: "continued_anchor_endorsement",
        span: `${context.anchor_alias} is still correct`
      }],
      anchor_application: "explicit",
      anchor_stance: "endorses_distractor",
      anchor_consistency: "consistent_with_conceptual_reasoning",
      misconception_status: "persists",
      essential_missing_links: [context.complete_boundary]
    }),
    expected_update: true,
    expected_disposition: "update_from_latest_evidence",
    expected_sound: false
  },
  {
    archetype_id: "contradiction_after_correction",
    message: (context) =>
      `I was wrong because ${context.mechanism}, but ${context.anchor_alias} is still correct.`,
    expected_intent: true,
    evidence: (context) => conceptualEvidence(context, {
      evidence_kind: "contradictory_reasoning",
      observable_evidence_spans: [{
        label: "mechanism",
        span: context.mechanism
      }, {
        label: "contradictory_anchor_endorsement",
        span: `${context.anchor_alias} is still correct`
      }],
      anchor_application: "explicit",
      anchor_stance: "endorses_distractor",
      anchor_consistency: "contradictory_to_conceptual_reasoning",
      misconception_status: "persists",
      contradictions: ["mechanism_conclusion_conflict"],
      prior_profile_status: "resolved_for_current_anchor"
    }),
    expected_update: true,
    expected_disposition: "reopen_from_latest_contradiction",
    expected_sound: false
  },
  {
    archetype_id: "regression_after_correction",
    message: (context) =>
      `I changed my answer again: ${context.anchor_alias} is correct because ${context.misconception_reason}.`,
    expected_intent: true,
    evidence: (context) => evidence({
      evidence_kind: "anchor_stance_evidence",
      reasoning_quality: "misconception",
      observable_evidence_spans: [{
        label: "regressed_misconception",
        span: context.misconception_reason
      }],
      independent_application_present: true,
      anchor_application: "explicit",
      anchor_stance: "endorses_distractor",
      anchor_consistency: "consistent_with_conceptual_reasoning",
      misconception_status: "persists",
      essential_missing_links: [context.complete_boundary],
      prior_profile_status: "resolved_for_current_anchor"
    }),
    expected_update: true,
    expected_disposition: "reopen_from_latest_contradiction",
    expected_sound: false
  },
  {
    archetype_id: "topic_changed_correction",
    message: (context) =>
      `I was wrong because the ${context.unrelated_topic} was interesting.`,
    expected_intent: true,
    evidence: () => evidence({
      topic_relevant: false
    }),
    expected_update: false,
    expected_disposition: "preserve_prior_profile",
    expected_sound: false
  },
  {
    archetype_id: "conceptual_evidence_without_correction_intent",
    message: (context) =>
      `${context.mechanism}, so ${context.anchor_alias} is wrong.`,
    expected_intent: false,
    evidence: (context) => conceptualEvidence(context, {
      anchor_application: "explicit",
      anchor_stance: "rejects_distractor",
      anchor_consistency: "consistent_with_conceptual_reasoning"
    }),
    expected_update: true,
    expected_disposition: "update_from_latest_evidence",
    expected_sound: false
  },
  {
    archetype_id: "uncertain_correction_claim",
    message: (context) =>
      `I may have been wrong about ${context.anchor_alias}.`,
    expected_intent: true,
    evidence: (context) => evidence({
      evidence_kind: "answer_revision_only",
      observable_evidence_spans: [{
        label: "uncertain_anchor_reference",
        span: context.anchor_alias
      }],
      anchor_application: "explicit",
      anchor_stance: "ambiguous"
    }),
    expected_update: false,
    expected_disposition: "preserve_prior_profile",
    expected_sound: false
  },
  {
    archetype_id: "partial_correction_with_missing_link",
    message: (context) =>
      `I was wrong because ${context.mechanism}.`,
    expected_intent: true,
    evidence: (context) => conceptualEvidence(context),
    expected_update: true,
    expected_disposition: "update_from_latest_evidence",
    expected_sound: false
  }
];

function runCalibration() {
  const contract = buildSelfCorrectionEvidenceContractV1();
  const results = CALIBRATION_CONTEXTS.flatMap((context) => {
    const intentContract = buildSelfCorrectionIntentContractV1({
      active_topic_terms: [context.topic_term, context.mechanism],
      active_anchor_aliases: [context.anchor_alias],
      unrelated_topic_terms: [context.unrelated_topic]
    });
    return CALIBRATION_ARCHETYPES.map((archetype) => {
      const message = archetype.message(context);
      const intent = resolveSelfCorrectionIntentSignalV1({
        message,
        intent_contract: intentContract
      });
      const resolution = resolveSelfCorrectionEvidenceV1({
        contract,
        intent_signal: intent,
        conceptual_evidence: archetype.evidence(context)
      });
      return {
        case_id: `${context.context_id}:${archetype.archetype_id}`,
        context_id: context.context_id,
        archetype_id: archetype.archetype_id,
        message,
        expected_self_correction_intent: archetype.expected_intent,
        observed_self_correction_intent:
          resolution.self_correction_intent,
        expected_conceptual_evidence_update:
          archetype.expected_update,
        observed_conceptual_evidence_update:
          resolution.conceptual_evidence_update,
        expected_profile_update_disposition:
          archetype.expected_disposition,
        observed_profile_update_disposition:
          resolution.profile_update_disposition,
        expected_sound_update: archetype.expected_sound,
        observed_sound_update: resolution.sound_update_eligible,
        passed:
          resolution.self_correction_intent ===
            archetype.expected_intent &&
          resolution.conceptual_evidence_update ===
            archetype.expected_update &&
          resolution.profile_update_disposition ===
            archetype.expected_disposition &&
          resolution.sound_update_eligible === archetype.expected_sound
      };
    });
  });
  return {
    calibration_version: "e2a35a-self-correction-evidence-calibration-v1",
    contract_version: contract.contract_version,
    context_count: CALIBRATION_CONTEXTS.length,
    archetype_count: CALIBRATION_ARCHETYPES.length,
    case_count: results.length,
    minimum_case_count: 150,
    passed_case_count: results.filter((entry) => entry.passed).length,
    required_distinctions: [
      "self_correction_intent",
      "conceptual_evidence_update",
      "profile_update_eligibility"
    ],
    results,
    passed: results.length >= 150 && results.every((entry) => entry.passed)
  };
}

function runRegressions() {
  const context = CALIBRATION_CONTEXTS[0]!;
  const required = [
    "bare_correction_claim",
    "answer_revision_only",
    "conceptual_correction",
    "copied_correction_stem",
    "contradiction_after_correction",
    "regression_after_correction",
    "option_mention_without_evidence",
    "complete_sound_correction",
    "correction_preserving_misconception",
    "conceptual_evidence_without_correction_intent"
  ];
  const calibration = runCalibration();
  const results = required.map((archetypeId) => {
    const source = calibration.results.find((entry) =>
      entry.context_id === context.context_id &&
      entry.archetype_id === archetypeId
    );
    assert(source, `e2a35a_regression_source_missing:${archetypeId}`);
    return {
      case_id: archetypeId === "complete_sound_correction"
        ? "self_correction_plus_valid_anchor_rejection"
        : archetypeId,
      source_case_id: source.case_id,
      passed: source.passed,
      self_correction_intent: source.observed_self_correction_intent,
      conceptual_evidence_update:
        source.observed_conceptual_evidence_update,
      profile_update_disposition:
        source.observed_profile_update_disposition,
      sound_update_eligible: source.observed_sound_update
    };
  });
  const byId = Object.fromEntries(
    results.map((entry) => [entry.case_id, entry])
  );
  const invariants = {
    correction_intent_alone_is_not_evidence:
      byId.bare_correction_claim?.self_correction_intent === true &&
      byId.bare_correction_claim?.conceptual_evidence_update === false,
    answer_revision_without_reasoning_preserves_profile:
      byId.answer_revision_only?.conceptual_evidence_update === false &&
      byId.answer_revision_only?.profile_update_disposition ===
        "preserve_prior_profile",
    conceptual_correction_updates_profile:
      byId.conceptual_correction?.conceptual_evidence_update === true,
    copied_correction_is_not_evidence:
      byId.copied_correction_stem?.conceptual_evidence_update === false,
    contradiction_reopens_resolved_profile:
      byId.contradiction_after_correction?.profile_update_disposition ===
        "reopen_from_latest_contradiction",
    regression_reopens_resolved_profile:
      byId.regression_after_correction?.profile_update_disposition ===
        "reopen_from_latest_contradiction",
    option_mention_alone_is_not_evidence:
      byId.option_mention_without_evidence?.conceptual_evidence_update ===
        false,
    valid_anchor_rejection_can_be_sound:
      byId.self_correction_plus_valid_anchor_rejection
        ?.sound_update_eligible === true,
    continued_endorsement_is_not_sound:
      byId.correction_preserving_misconception?.sound_update_eligible ===
        false,
    conceptual_evidence_can_update_without_correction_intent:
      byId.conceptual_evidence_without_correction_intent
        ?.self_correction_intent === false &&
      byId.conceptual_evidence_without_correction_intent
        ?.conceptual_evidence_update === true
  };
  return {
    suite_version: "e2a35a-evidence-separation-regressions-v1",
    required_case_count: required.length,
    results,
    invariants,
    passed:
      results.every((entry) => entry.passed) &&
      Object.values(invariants).every(Boolean)
  };
}

function replayHistoricalTurn2() {
  const intentContract = SelfCorrectionIntentContractV1Schema.parse(
    readJson<unknown>(
      path.join(HISTORICAL_RUN_DIR, "self-correction-intent-contract.json")
    )
  );
  const contract = buildSelfCorrectionEvidenceContractV1();
  const rows = readJsonl<HistoricalSimulatorRow>(
    path.join(HISTORICAL_RUN_DIR, "simulator-provider-outputs.jsonl")
  ).filter((entry) => entry.turn === 2);
  assert(rows.length === 2, "e2a35a_turn2_replay_source_count_mismatch");
  const results = rows.map((row) => {
    const message = row.parsed_structured_output.student_message;
    const legacy = resolveSelfCorrectionIntentV1({
      message,
      contract: intentContract
    });
    const intent = resolveSelfCorrectionIntentSignalV1({
      message,
      intent_contract: intentContract
    });
    const optionMention = row.parsed_structured_output.mentions_focus_option;
    const replayEvidence = evidence({
      evidence_source: "immutable_provider_output_replay",
      evidence_kind: optionMention ? "answer_revision_only" : "none",
      observable_evidence_spans: optionMention ? [{
        label: "anchor_reference_only",
        span: "D"
      }] : [],
      anchor_application: optionMention ? "explicit" : "absent",
      anchor_stance: "not_expressed",
      essential_missing_links: ["observable_conceptual_evidence"]
    });
    const corrected = resolveSelfCorrectionEvidenceV1({
      contract,
      intent_signal: intent,
      conceptual_evidence: replayEvidence
    });
    return {
      session_id: row.session_id,
      turn: row.turn,
      attempt: row.attempt,
      immutable_student_message: message,
      immutable_output_expressed_evidence_level:
        row.parsed_structured_output.expressed_evidence_level,
      immutable_output_rendered_intent:
        row.parsed_structured_output.rendered_intent,
      legacy_intent: legacy.intent,
      legacy_evidence_status: legacy.evidence_status,
      legacy_downstream_disposition: legacy.downstream_disposition,
      separated_intent_signal: intent,
      separated_evidence_resolution: corrected,
      expected_conceptual_evidence_update: false,
      expected_profile_update_disposition: "preserve_prior_profile",
      passed:
        corrected.self_correction_intent &&
        !corrected.conceptual_evidence_update &&
        !corrected.profile_update_eligible &&
        !corrected.latest_valid_evidence_eligible &&
        !corrected.sound_update_eligible &&
        corrected.profile_update_disposition === "preserve_prior_profile"
    };
  });
  return {
    replay_version: "e2a35a-turn2-immutable-offline-replay-v1",
    source_run_id: HISTORICAL_RUN_ID,
    source_run_status: HISTORICAL_STATUS,
    source_artifact:
      "simulator-provider-outputs.jsonl",
    replay_mode: "immutable_provider_output_no_provider_dispatch",
    source_provider_outputs_modified: false,
    e2a35_passed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    results,
    passed:
      results.every((entry) => entry.passed) &&
      networkRequestCount === 0
  };
}

function buildBudget() {
  return {
    budget_version: "e2a36-bounded-live-budget-v1",
    protocol_only_not_authorized: true,
    sessions: 1,
    simulator_calls: 9,
    evidence_evaluator_calls: 9,
    initial_tutor_calls: 9,
    tutor_regenerations: 2,
    logical_generation_calls: 29,
    adapter_attempts: 87,
    adapter_attempts_per_logical_call: 3,
    transport_retries_per_logical_call: 2,
    input_tokens: 900000,
    output_tokens: 70000,
    total_tokens: 970000,
    cost_usd: 25,
    provider_concurrency: 1
  };
}

function buildArtifactContract() {
  return {
    artifact_contract_version: "e2a36-artifact-contract-v1",
    preparation_artifacts: [...ARTIFACT_NAMES],
    future_live_artifact_requirements: [
      "dispatch-checkpoint.json",
      "simulator-provider-outputs.jsonl",
      "evaluator-provider-outputs.jsonl",
      "autonomous-tutor-provider-outputs.jsonl",
      "self-correction-intent-results.jsonl",
      "self-correction-evidence-results.jsonl",
      "profile-update-dispositions.jsonl",
      "human-review-packet.json",
      "provider-usage.json",
      "artifact-validation.json"
    ],
    preserve_all_provider_outputs: true,
    human_review_required: true,
    no_live_artifacts_created_by_preparation: true
  };
}

function buildProtocol(input: {
  historical: ReturnType<typeof historicalSnapshot>;
  protectedIntegrity: ReturnType<typeof protectedSourceIntegrity>;
  calibration: ReturnType<typeof runCalibration>;
  regressions: ReturnType<typeof runRegressions>;
  replay: ReturnType<typeof replayHistoricalTurn2>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
}) {
  const evidenceContract = buildSelfCorrectionEvidenceContractV1();
  const protocol = {
    protocol_version: E2A36_PROTOCOL_VERSION,
    correction_version: CORRECTION_VERSION,
    protocol_state: "prepared_for_separate_authorization_not_executable",
    execution_authorized: false,
    live_execution_performed: false,
    provider_dispatch_path_present: false,
    source_historical_run_id: HISTORICAL_RUN_ID,
    source_historical_status: HISTORICAL_STATUS,
    source_historical_passed: false,
    source_historical_protocol_hash: HISTORICAL_PROTOCOL_HASH,
    source_historical_composite_identity:
      HISTORICAL_COMPOSITE_IDENTITY,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    self_correction_evidence_contract_version:
      evidenceContract.contract_version,
    self_correction_evidence_contract_hash: stableHash(evidenceContract),
    source_files: {
      self_correction_evidence_contract:
        "src/lib/evaluation/formative/self-correction-evidence-v1.ts",
      evaluator_v5:
        "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts",
      tutor_candidate:
        "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
    },
    required_separation: {
      self_correction_intent: "independent_signal",
      conceptual_evidence_update: "observable_evidence_decision",
      profile_update_eligibility: "derived_from_conceptual_evidence_only"
    },
    profile_rules: {
      correction_claim_only: "preserve_prior_profile",
      answer_revision_only: "preserve_prior_profile",
      copied_correction: "preserve_prior_profile",
      valid_conceptual_correction: "update_from_latest_evidence",
      regression_after_resolution: "reopen_from_latest_contradiction",
      correction_preserving_misconception:
        "update_or_reopen_but_never_sound",
      sound_correction:
        "requires_complete_consistent_independent_evidence"
    },
    trajectory_policy: {
      exact_turn_label_required: false,
      evidence_accuracy_precedes_simulator_intent: true,
      correction_language_alone_is_not_understanding: true,
      latest_valid_evidence_has_precedence: true,
      earlier_evidence_remains_historical: true,
      sound_evidence_authorizes_immediate_revision: true
    },
    gates: {
      historical_evidence_unchanged: input.historical.passed,
      evaluator_v5_unchanged:
        input.protectedIntegrity.evaluator_v5_unchanged,
      tutor_candidate_unchanged:
        input.protectedIntegrity.tutor_candidate_unchanged,
      calibration_at_least_150:
        input.calibration.case_count >= 150 &&
        input.calibration.passed,
      required_regressions_passed: input.regressions.passed,
      immutable_turn2_replay_passed: input.replay.passed,
      no_provider_calls: networkRequestCount === 0
    },
    budget_hash: stableHash(input.budget),
    artifact_contract_hash: stableHash(input.artifactContract)
  };
  return {
    ...protocol,
    protocol_hash: stableHash(protocol),
    passed: Object.values(protocol.gates).every(Boolean)
  };
}

function buildCompositeIdentity(input: {
  protocol: ReturnType<typeof buildProtocol>;
  historical: ReturnType<typeof historicalSnapshot>;
  protectedIntegrity: ReturnType<typeof protectedSourceIntegrity>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
}) {
  const identity = {
    identity_version: "e2a36-composite-runtime-identity-v1",
    preparation_parent_git_commit: currentCommit(),
    protocol_version: input.protocol.protocol_version,
    protocol_hash: input.protocol.protocol_hash,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    candidate_file_sha256: input.protectedIntegrity.actual_sha256[
      "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json"
    ],
    evaluator_v5_source_sha256: input.protectedIntegrity.actual_sha256[
      "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
    ],
    tutor_candidate_source_sha256: input.protectedIntegrity.actual_sha256[
      "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
    ],
    self_correction_evidence_source_sha256: relativeFileSha(
      "src/lib/evaluation/formative/self-correction-evidence-v1.ts"
    ),
    preparation_harness_source_sha256: relativeFileSha(
      "prisma/formative-evaluation-e2a35a.ts"
    ),
    historical_e2a35_evidence_sha256:
      input.historical.aggregate_sha256,
    budget_hash: stableHash(input.budget),
    artifact_contract_hash: stableHash(input.artifactContract)
  };
  return {
    ...identity,
    composite_runtime_identity_hash: stableHash(identity)
  };
}

function validateArtifacts(runDirectory: string) {
  const expected = new Set(ARTIFACT_NAMES);
  const files = readdirSync(runDirectory).sort();
  const missing = [...expected].filter((name) => !files.includes(name));
  const unexpected = files.filter((name) => !expected.has(
    name as typeof ARTIFACT_NAMES[number]
  ));
  const artifacts = files
    .filter((name) => name !== "artifact-validation.json")
    .map((name) => ({
      name,
      sha256: fileSha(path.join(runDirectory, name)),
      bytes: statSync(path.join(runDirectory, name)).size
    }));
  return {
    validation_version: "e2a35a-artifact-validation-v1",
    expected_artifact_count: ARTIFACT_NAMES.length,
    actual_artifact_count_before_validation:
      files.filter((name) => name !== "artifact-validation.json").length,
    missing_artifacts: missing.filter((name) =>
      name !== "artifact-validation.json"
    ),
    unexpected_artifacts: unexpected,
    artifacts,
    passed:
      missing.filter((name) => name !== "artifact-validation.json").length ===
        0 &&
      unexpected.length === 0 &&
      files.filter((name) => name !== "artifact-validation.json").length ===
        ARTIFACT_NAMES.length - 1
  };
}

function buildAndWriteArtifacts(outputDirectory: string) {
  assert(
    !existsSync(outputDirectory) ||
      readdirSync(outputDirectory).length === 0,
    "e2a35a_artifact_directory_not_empty"
  );
  mkdirSync(outputDirectory, { recursive: true });
  const historicalBefore = historicalSnapshot();
  const protectedIntegrity = protectedSourceIntegrity();
  const evidenceContract = buildSelfCorrectionEvidenceContractV1();
  const calibration = runCalibration();
  const regressions = runRegressions();
  const replay = replayHistoricalTurn2();
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const protocol = buildProtocol({
    historical: historicalBefore,
    protectedIntegrity,
    calibration,
    regressions,
    replay,
    budget,
    artifactContract
  });
  const composite = buildCompositeIdentity({
    protocol,
    historical: historicalBefore,
    protectedIntegrity,
    budget,
    artifactContract
  });
  const historicalAfter = historicalSnapshot();
  const historicalUnchanged =
    historicalBefore.aggregate_sha256 === historicalAfter.aggregate_sha256 &&
    historicalBefore.file_count === historicalAfter.file_count &&
    historicalBefore.passed &&
    historicalAfter.passed;
  const providerGuard = {
    guard_version: "e2a35a-provider-call-guard-v1",
    execution_mode: "deterministic_no_live",
    provider_client_created: false,
    provider_dispatch_path_present: false,
    fetch_requests_observed: networkRequestCount,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    passed: networkRequestCount === 0
  };
  const summary = {
    summary_version: "e2a35a-summary-v1",
    status:
      protocol.passed && historicalUnchanged && providerGuard.passed
        ? "e2a35a_correction_verified_e2a36_protocol_prepared"
        : "e2a35a_correction_not_ready",
    correction_version: CORRECTION_VERSION,
    contract_version: evidenceContract.contract_version,
    calibration_case_count: calibration.case_count,
    calibration_passed: calibration.passed,
    regression_case_count: regressions.required_case_count,
    regressions_passed: regressions.passed,
    historical_replay_passed: replay.passed,
    e2a35_historical_run_id: HISTORICAL_RUN_ID,
    e2a35_historical_status: HISTORICAL_STATUS,
    e2a35_historical_passed: false,
    e2a35_historical_evidence_unchanged: historicalUnchanged,
    e2a35_rerun: false,
    e2a36_protocol_version: protocol.protocol_version,
    e2a36_protocol_hash: protocol.protocol_hash,
    e2a36_composite_runtime_identity_hash:
      composite.composite_runtime_identity_hash,
    e2a36_execution_authorized: false,
    e2a36_live_execution_performed: false,
    evaluator_v5_unchanged: protectedIntegrity.evaluator_v5_unchanged,
    tutor_candidate_unchanged: protectedIntegrity.tutor_candidate_unchanged,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    passed:
      protocol.passed &&
      historicalUnchanged &&
      providerGuard.passed
  };

  writeJson(path.join(outputDirectory, "correction-manifest.json"), {
    correction_version: CORRECTION_VERSION,
    execution_mode: "deterministic_no_live_correction",
    application_git_commit: currentCommit(),
    e2a35_rerun: false,
    evaluator_v5_modified: false,
    tutor_candidate_modified: false,
    provider_calls_made: 0
  });
  writeJson(
    path.join(outputDirectory, "self-correction-evidence-contract.json"),
    evidenceContract
  );
  writeJson(
    path.join(outputDirectory, "self-correction-evidence-calibration.json"),
    calibration
  );
  writeJson(
    path.join(
      outputDirectory,
      "deterministic-evidence-separation-regressions.json"
    ),
    regressions
  );
  writeJson(
    path.join(outputDirectory, "e2a35-turn2-offline-replay.json"),
    replay
  );
  writeJson(
    path.join(outputDirectory, "e2a35-historical-integrity-before.json"),
    historicalBefore
  );
  writeJson(
    path.join(outputDirectory, "e2a35-historical-integrity-after.json"),
    historicalAfter
  );
  writeJson(
    path.join(outputDirectory, "protected-source-integrity.json"),
    protectedIntegrity
  );
  writeJson(path.join(outputDirectory, "e2a36-budget.json"), budget);
  writeJson(
    path.join(outputDirectory, "e2a36-artifact-contract.json"),
    artifactContract
  );
  writeJson(path.join(outputDirectory, "e2a36-protocol.json"), protocol);
  writeFileSync(
    path.join(outputDirectory, "e2a36-protocol.sha256"),
    `${protocol.protocol_hash}\n`,
    "utf8"
  );
  writeJson(
    path.join(outputDirectory, "e2a36-composite-runtime-identity.json"),
    composite
  );
  writeJson(
    path.join(outputDirectory, "provider-call-guard.json"),
    providerGuard
  );
  writeJson(path.join(outputDirectory, "summary.json"), summary);

  const validation = validateArtifacts(outputDirectory);
  writeJson(
    path.join(outputDirectory, "artifact-validation.json"),
    validation
  );
  const finalFiles = readdirSync(outputDirectory).sort();
  const complete =
    finalFiles.length === ARTIFACT_NAMES.length &&
    ARTIFACT_NAMES.every((name) => finalFiles.includes(name));
  assert(
    summary.passed,
    `e2a35a_deterministic_gates_failed:${JSON.stringify({
      protocol_gates: protocol.gates,
      historical_unchanged: historicalUnchanged,
      provider_guard_passed: providerGuard.passed,
      calibration_passed: calibration.passed,
      calibration_failures: calibration.results
        .filter((entry) => !entry.passed)
        .slice(0, 8),
      regression_invariants: regressions.invariants,
      replay_passed: replay.passed
    })}`
  );
  assert(validation.passed, "e2a35a_artifact_validation_failed");
  assert(complete, "e2a35a_artifact_set_incomplete");

  for (const filePath of listFiles(outputDirectory)) {
    chmodSync(filePath, 0o444);
  }
  chmodSync(outputDirectory, 0o555);
  return {
    run_directory: outputDirectory,
    summary,
    protocol,
    composite,
    validation: {
      ...validation,
      final_artifact_count: finalFiles.length,
      complete
    }
  };
}

function makeRunId() {
  const timestamp = new Date().toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/u, "Z");
  return `e2a35a_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function latestRunDirectory() {
  assert(existsSync(ARTIFACT_ROOT), "e2a35a_artifact_root_missing");
  const latest = readdirSync(ARTIFACT_ROOT)
    .map((name) => path.join(ARTIFACT_ROOT, name))
    .filter((entry) => statSync(entry).isDirectory())
    .sort()
    .at(-1);
  assert(latest, "e2a35a_artifact_run_missing");
  return latest;
}

function runSmoke(suite: string) {
  const tempRoot = mkdtempSync(path.join(
    tmpdir(),
    "e2a35a-evidence-separation-"
  ));
  const runDirectory = path.join(tempRoot, "run");
  try {
    const result = buildAndWriteArtifacts(runDirectory);
    const checks: Record<string, boolean> = {
      calibration:
        result.summary.calibration_case_count >= 150 &&
        result.summary.calibration_passed,
      regressions: result.summary.regressions_passed,
      replay:
        result.summary.historical_replay_passed &&
        !result.summary.e2a35_historical_passed,
      historical:
        result.summary.e2a35_historical_evidence_unchanged &&
        !result.summary.e2a35_rerun,
      "e2a36-protocol":
        result.protocol.passed &&
        !result.protocol.execution_authorized &&
        !result.protocol.live_execution_performed,
      artifact:
        result.validation.complete &&
        result.validation.final_artifact_count === ARTIFACT_NAMES.length,
      "provider-call-guard":
        result.summary.provider_calls_made === 0 &&
        result.summary.network_requests_made === 0
    };
    checks.all = Object.values(checks).every(Boolean);
    assert(suite in checks, `e2a35a_unknown_smoke_suite:${suite}`);
    assert(checks[suite], `e2a35a_${suite}_smoke_failed`);
    console.log(JSON.stringify({
      status: "passed",
      suite,
      checks,
      calibration_case_count: result.summary.calibration_case_count,
      e2a35_historical_status: result.summary.e2a35_historical_status,
      e2a35_historical_passed: false,
      e2a35_rerun: false,
      e2a36_protocol_hash: result.protocol.protocol_hash,
      e2a36_composite_runtime_identity_hash:
        result.composite.composite_runtime_identity_hash,
      e2a36_execution_authorized: false,
      provider_calls_made: 0,
      network_requests_made: 0
    }, null, 2));
  } finally {
    if (existsSync(runDirectory)) chmodSync(runDirectory, 0o755);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function main() {
  const [command = "run", ...args] = process.argv.slice(2);
  if (command === "run") {
    mkdirSync(ARTIFACT_ROOT, { recursive: true });
    const result = buildAndWriteArtifacts(
      path.join(ARTIFACT_ROOT, makeRunId())
    );
    console.log(JSON.stringify({
      status: result.summary.status,
      run_directory: result.run_directory,
      calibration_case_count: result.summary.calibration_case_count,
      e2a35_historical_evidence_unchanged:
        result.summary.e2a35_historical_evidence_unchanged,
      e2a35_rerun: false,
      e2a36_protocol_hash: result.protocol.protocol_hash,
      e2a36_composite_runtime_identity_hash:
        result.composite.composite_runtime_identity_hash,
      e2a36_execution_authorized: false,
      provider_calls_made: 0,
      network_requests_made: 0
    }, null, 2));
    return;
  }
  if (command === "report") {
    const runFlag = args.indexOf("--run");
    const runDirectory = runFlag >= 0 && args[runFlag + 1]
      ? path.join(ARTIFACT_ROOT, args[runFlag + 1])
      : latestRunDirectory();
    console.log(JSON.stringify({
      run_directory: runDirectory,
      summary: readJson(path.join(runDirectory, "summary.json")),
      protocol: readJson(path.join(runDirectory, "e2a36-protocol.json")),
      composite: readJson(path.join(
        runDirectory,
        "e2a36-composite-runtime-identity.json"
      )),
      artifact_validation: readJson(path.join(
        runDirectory,
        "artifact-validation.json"
      ))
    }, null, 2));
    return;
  }
  if (command === "smoke") {
    const suiteFlag = args.indexOf("--suite");
    runSmoke(suiteFlag >= 0 ? args[suiteFlag + 1] ?? "all" : "all");
    return;
  }
  throw new Error(`e2a35a_unknown_command:${command}`);
}

main();
