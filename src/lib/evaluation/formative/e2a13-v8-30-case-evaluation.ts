import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { z } from "zod";
import type { AgentModelConfig } from "@/lib/llm/config";
import {
  resolveOpenAICredentialFromEnv,
  withResolvedOpenAICredential
} from "@/lib/llm/openai-credential-resolver";
import {
  isApprovedOpenAIBaseUrl,
  openAIBaseUrlHost,
  resolveOpenAIBaseUrl
} from "@/lib/llm/openai-transport-diagnostics";
import {
  OPENAI_RESPONSES_ADAPTER_VERSION,
  OpenAIResponsesProvider
} from "@/lib/llm/providers/openai-responses-provider";
import type {
  LlmProvider,
  StructuredAgentResult
} from "@/lib/llm/providers/types";
import { stableHash } from "@/lib/operational/stable-hash";
import { resolveApplicationBuildInfo } from
  "@/lib/provenance/application-build-info";
import {
  TOPIC_DIALOGUE_OPERATION_FALLBACK_VERSION,
  TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS,
  TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_HASH,
  TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_VERSION,
  buildTopicDialogueOperationRepairInstructions
} from "@/lib/services/student-assessment/topic-dialogue-operation-contract";
import {
  TOPIC_DIALOGUE_MODE_FALLBACK_VERSION,
  TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS,
  TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_HASH,
  TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_VERSION
} from "@/lib/services/student-assessment/topic-dialogue-response-mode";
import {
  TOPIC_DIALOGUE_PEDAGOGICAL_RUBRIC_V1_VERSION,
  TOPIC_DIALOGUE_REGENERATION_POLICY_V2_VERSION,
  TOPIC_DIALOGUE_REVIEW_FLAG_SCHEMA_V1_VERSION,
  TOPIC_DIALOGUE_RUNTIME_VALIDATOR_V2_VERSION,
  TOPIC_DIALOGUE_VALIDATION_POLICY_V2_VERSION,
  type TopicDialogueRuntimeValidationResult
} from "@/lib/services/student-assessment/topic-dialogue-runtime-validation-v2";
import {
  TOPIC_DIALOGUE_CANDIDATE_EFFECTIVE_RESULT_VERSION,
  TOPIC_DIALOGUE_CANDIDATE_RUNTIME_V2_VERSION,
  executeTopicDialogueCandidateRuntimeV2,
  type CandidateRuntimeExecution
} from "@/lib/services/student-assessment/topic-dialogue-candidate-runtime-v2";
import {
  findVisibleTextPrivacyFindings
} from "./student-privacy-scanner";
import {
  E2A4_APPROVED_V2_HASH,
  sha256
} from "./e2a4-topic-dialogue-contract";
import { E2A5_FAILED_V4_HASH } from
  "./e2a5-topic-dialogue-progression-contract";
import { E2A6_CANDIDATE_HASH } from
  "./e2a6-v5-topic-dialogue-evaluation";
import { E2A7_CANDIDATE_HASH } from
  "./e2a7-topic-dialogue-mode-candidate";
import {
  E2A9_CANDIDATE_HASH
} from "./e2a9-topic-dialogue-operation-candidate";
import {
  E2A11_ARTIFACT_ROOT,
  buildE2A11BorderlineValidCorpus,
  buildE2A11HardNegativeCorpus
} from "./e2a11-validator-calibration";
import {
  E2A11_CANDIDATE_FILE_SHA256,
  E2A11_CANDIDATE_HASH,
  E2A11_CANDIDATE_PATH,
  evaluateE2A11Candidate
} from "./e2a11-v8-validator-candidate";
import {
  compileE2A11CandidateRequestsNoNetwork
} from "./e2a11-request-compilation";
import {
  E2A10_ARTIFACT_ROOT,
  contextCoverage,
  fallbackForCase,
  requestForCase,
  validateE2A10ProviderOutput
} from "./e2a10-v7-topic-dialogue-canary";
import {
  e2a10CanaryCases
} from "./e2a10-v7-topic-dialogue-protocol";
import {
  E2A12_ARTIFACT_ROOT,
  e2a12ProtectedArtifactSnapshot
} from "./e2a12-v8-runtime-canary";
import { e2a12HeldOutCases } from "./e2a12-v8-held-out-protocol";
import {
  E2A13_PROTOCOL_HASH,
  E2A13_PROTOCOL_VERSION,
  assertE2A13ProtocolFrozen,
  deriveE2A13ProtocolHash,
  e2a13HeldOutCases,
  e2a13HeldOutProtocolSnapshot,
  type E2A13TopicDialogueCase
} from "./e2a13-v8-30-case-protocol";

export const E2A13_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a13-v8-30-case-evaluation"
);
export const E2A13_E2A11_RUN_ID =
  "e2a11_20260719230059_c2965f3b" as const;
export const E2A13_E2A12_RUN_ID =
  "e2a12_20260719234834_59a67eaf" as const;
export const E2A13_EVALUATOR_VERSION =
  "e2a13-v8-30-case-bounded-provider-evaluator-v1" as const;
export const E2A13_OVERLAP_POLICY_VERSION =
  "e2a13-held-out-normalized-similarity-v2" as const;

const E2A11_RUN_DIR = path.join(
  E2A11_ARTIFACT_ROOT,
  E2A13_E2A11_RUN_ID
);
const E2A10_PROVIDER_RUN_DIR = path.join(
  E2A10_ARTIFACT_ROOT,
  "e2a10_20260719211316_21a50476"
);
const E2A12_RUN_DIR = path.join(
  E2A12_ARTIFACT_ROOT,
  E2A13_E2A12_RUN_ID
);
const ACTIVE_APPROVAL_ROOT = path.join(
  process.cwd(),
  ".data",
  "operational-model-upgrade",
  "active-approval"
);
const ACTIVE_BUNDLE_PATH = path.join(
  ACTIVE_APPROVAL_ROOT,
  "active-approval-bundle.json"
);
const RUNNER_LOCK_PATH = path.join(E2A13_ARTIFACT_ROOT, ".runner.lock");
const E2A13_SOURCE_PATHS = [
  path.join(
    process.cwd(),
    "src/lib/evaluation/formative/e2a13-v8-30-case-protocol.ts"
  ),
  path.join(
    process.cwd(),
    "src/lib/evaluation/formative/e2a13-v8-30-case-evaluation.ts"
  ),
  path.join(process.cwd(), "prisma/formative-evaluation-e2a13-live.ts")
] as const;

export type E2A13Budget = {
  maximum_cases: 30;
  maximum_initial_generation_calls: 30;
  maximum_regeneration_calls: 30;
  maximum_total_generation_calls: 60;
  maximum_input_tokens: 900000;
  maximum_output_tokens: 150000;
  maximum_estimated_cost_usd: 35;
  maximum_regenerations_per_case: 1;
  provider_case_concurrency: 1;
};

type SafeArtifactPaths = ReturnType<typeof artifactPaths>;
type E2A13CaseResult = {
  case_id: string;
  case_number: number;
  selected_mode: string;
  selected_operation: string | null;
  execution: CandidateRuntimeExecution;
  v7_shadow_attempts: Array<{
    attempt_index: number;
    v7_valid: boolean;
    v7_findings: unknown[];
    v7_would_have_regenerated: boolean;
    v8_runtime_acceptance: string;
    v8_changed_runtime_outcome: boolean;
  }>;
  context_coverage: ReturnType<typeof contextCoverage>;
  privacy_findings: ReturnType<typeof findVisibleTextPrivacyFindings>;
  answer_key_findings: string[];
  final_provider_output_schema_valid: boolean;
  platform_safety_passed: boolean;
  student_projection_passed: boolean;
  audit_projection_passed: boolean;
  transcript_refresh_passed: boolean;
};

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  const text = readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line) as T) : [];
}

function assertArtifactSafe(value: unknown) {
  const text = JSON.stringify(value);
  const forbidden = [
    /\bBearer\s+[A-Za-z0-9._-]+/u,
    /\bsk-[A-Za-z0-9_-]{12,}/u,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u,
    /authorization\s*:/iu,
    /chain[ _-]?of[ _-]?thought/iu
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error("e2a13_artifact_secret_or_hidden_reasoning_detected");
  }
}

function writeJson(filePath: string, value: unknown) {
  assertArtifactSafe(value);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendJsonl(filePath: string, value: unknown) {
  assertArtifactSafe(value);
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => listFiles(path.join(root, entry.name)))
    .sort();
}

function directoryDigest(root: string) {
  if (!existsSync(root)) return { exists: false, file_count: 0, sha256: null };
  const files = listFiles(root);
  return {
    exists: true,
    file_count: files.length,
    sha256: stableHash(files.map((filePath) => ({
      path: path.relative(root, filePath),
      sha256: sha256(readFileSync(filePath))
    })))
  };
}

function relative(filePath: string) {
  return path.relative(process.cwd(), filePath) || ".";
}

export function e2a13EvaluationSourceSnapshot() {
  const files = E2A13_SOURCE_PATHS.map((filePath) => ({
    path: relative(filePath),
    exists: existsSync(filePath),
    sha256: existsSync(filePath)
      ? sha256(readFileSync(filePath))
      : null
  }));
  return {
    snapshot_version: "e2a13-evaluation-source-snapshot-v1",
    files,
    aggregate_sha256: stableHash(files)
  };
}

export function e2a13ProtectedArtifactSnapshot() {
  const inherited = e2a12ProtectedArtifactSnapshot();
  const trackedGroups = {
    ...inherited.tracked_groups,
    v8_candidate_manifest: {
      exists: existsSync(E2A11_CANDIDATE_PATH),
      file_count: existsSync(E2A11_CANDIDATE_PATH) ? 1 : 0,
      sha256: existsSync(E2A11_CANDIDATE_PATH)
        ? sha256(readFileSync(E2A11_CANDIDATE_PATH))
        : null
    },
    e2a11_evidence: directoryDigest(E2A11_RUN_DIR),
    e2a12_evidence: directoryDigest(E2A12_RUN_DIR)
  };
  return {
    snapshot_version: "e2a13-protected-artifact-snapshot-v1",
    approved_v2_hash: E2A4_APPROVED_V2_HASH,
    failed_v4_hash: E2A5_FAILED_V4_HASH,
    failed_v5_hash: E2A6_CANDIDATE_HASH,
    failed_v6_hash: E2A7_CANDIDATE_HASH,
    failed_v7_hash: E2A9_CANDIDATE_HASH,
    v8_candidate_hash: E2A11_CANDIDATE_HASH,
    tracked_groups: trackedGroups,
    environment_metadata: inherited.environment_metadata,
    aggregate_sha256: stableHash({
      tracked_groups: trackedGroups,
      environment_metadata: inherited.environment_metadata
    })
  };
}

function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(allStrings);
  }
  return [];
}

function normalizeText(value: string) {
  return value.toLocaleLowerCase().normalize("NFKC")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function tokenDice(left: string, right: string) {
  const a = new Set(normalizeText(left).split(" ").filter(Boolean));
  const b = new Set(normalizeText(right).split(" ").filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

function priorCorpusSources() {
  const e2a10Cases = e2a10CanaryCases();
  const e2a12Cases = e2a12HeldOutCases();
  const e2a10Outputs = readJsonl<Record<string, unknown>>(path.join(
    E2A10_PROVIDER_RUN_DIR,
    "provider-outputs.jsonl"
  ));
  const e2a12Outputs = readJsonl<Record<string, unknown>>(path.join(
    E2A12_RUN_DIR,
    "provider-outputs.jsonl"
  ));
  return {
    e2a10_student_messages: e2a10Cases.flatMap((entry) => [
      entry.dialogue_input.latest_student_message,
      ...entry.dialogue_input.visible_dialogue_history
        .filter((turn) => turn.actor_type === "student")
        .map((turn) => turn.message_text)
    ]),
    e2a10_assistant_outputs: e2a10Outputs.flatMap((entry) =>
      allStrings(entry.safe_provider_output)
    ),
    e2a12_student_messages: e2a12Cases.flatMap((entry) => [
      entry.dialogue_input.latest_student_message,
      ...entry.dialogue_input.visible_dialogue_history
        .filter((turn) => turn.actor_type === "student")
        .map((turn) => turn.message_text)
    ]),
    e2a12_assistant_outputs: e2a12Outputs.flatMap((entry) =>
      allStrings(entry.safe_provider_output)
    ),
    e2a11_hard_negative_corpus: allStrings(buildE2A11HardNegativeCorpus()),
    e2a11_borderline_corpus: allStrings(buildE2A11BorderlineValidCorpus())
  };
}

export function analyzeE2A13ProtocolOverlap() {
  const cases = e2a13HeldOutCases();
  const sources = priorCorpusSources();
  const freshRows = cases.flatMap((entry) => [
    {
      case_id: entry.case_id,
      field_path: "latest_student_message",
      value: entry.dialogue_input.latest_student_message
    },
    ...entry.dialogue_input.visible_dialogue_history.map((turn, index) => ({
      case_id: entry.case_id,
      field_path: `visible_dialogue_history.${index}.${turn.actor_type}`,
      value: turn.message_text
    })),
    ...entry.dialogue_input.safe_item_context.flatMap((item, index) =>
      item.option_text ? [{
      case_id: entry.case_id,
      field_path: `safe_item_context.${index}.option_text`,
      value: item.option_text
      }] : []
    )
  ]);
  const comparisons = freshRows.map((fresh) => {
    let best = {
      corpus: "none",
      score: 0,
      exact: false,
      compared_sha256: null as string | null
    };
    for (const [corpus, values] of Object.entries(sources)) {
      for (const value of values) {
        const normalizedFresh = normalizeText(fresh.value);
        const normalizedPrior = normalizeText(value);
        if (!normalizedFresh || !normalizedPrior) continue;
        const exact = normalizedFresh === normalizedPrior;
        const score = exact ? 1 : tokenDice(fresh.value, value);
        if (score > best.score) {
          best = {
            corpus,
            score,
            exact,
            compared_sha256: sha256(value)
          };
        }
      }
    }
    return {
      case_id: fresh.case_id,
      field_path: fresh.field_path,
      text_sha256: sha256(fresh.value),
      best_match_corpus: best.corpus,
      best_normalized_token_dice: Number(best.score.toFixed(4)),
      exact_match: best.exact,
      best_match_text_sha256: best.compared_sha256,
      near_duplicate: best.score >= 0.82
    };
  });
  return {
    overlap_policy_version: E2A13_OVERLAP_POLICY_VERSION,
    exact_match_rejected: true,
    near_duplicate_threshold: 0.82,
    comparison_source_counts: Object.fromEntries(
      Object.entries(sources).map(([key, value]) => [key, value.length])
    ),
    checked_text_count: freshRows.length,
    comparisons,
    exact_match_count: comparisons.filter((entry) => entry.exact_match).length,
    near_duplicate_count:
      comparisons.filter((entry) => entry.near_duplicate).length,
    passed: comparisons.every((entry) =>
      !entry.exact_match && !entry.near_duplicate
    )
  };
}

export function validateE2A13HeldOutProtocol() {
  const cases = e2a13HeldOutCases();
  const remainInDialogue = cases.filter((entry) =>
    entry.selected_mode === "remain_in_dialogue"
  );
  const progression = cases.filter((entry) =>
    entry.selected_mode !== "remain_in_dialogue"
  );
  const operations = new Set(cases.map((entry) => entry.selected_operation)
    .filter((value): value is NonNullable<typeof value> => Boolean(value)));
  const modes = new Set(cases.map((entry) => entry.selected_mode));
  const tenth = cases.filter((entry) => entry.require_tenth_turn_context);
  const tenthChecks = tenth.map((entry) => contextCoverage(entry));
  const operationCounts = Object.fromEntries([...operations].map((operation) => [
    operation,
    cases.filter((entry) => entry.selected_operation === operation).length
  ]));
  const progressionCounts = Object.fromEntries([
    "request_revision",
    "present_transfer",
    "complete_episode"
  ].map((mode) => [
    mode,
    cases.filter((entry) => entry.selected_mode === mode).length
  ]));
  const checks = {
    case_count_30: cases.length === 30,
    remain_in_dialogue_at_least_21: remainInDialogue.length >= 21,
    progression_at_least_6: progression.length >= 6,
    distinct_anchors_at_least_3:
      new Set(cases.map((entry) => entry.item_anchor_id)).size >= 3,
    distinct_targets_at_least_2:
      new Set(cases.map((entry) => entry.conceptual_target_id)).size >= 2,
    long_history_count_at_least_6: tenth.length >= 6,
    near_tenth_turn_count_at_least_4: tenth.length >= 4,
    tenth_turn_context_complete: tenthChecks.every((entry) =>
      entry.complete_tenth_turn_context
    ),
    all_seven_operations: operations.size === 7,
    every_operation_at_least_3: Object.values(operationCounts).every((count) =>
      count >= 3
    ),
    all_progression_modes: [
      "request_revision",
      "present_transfer",
      "complete_episode"
    ].every((mode) => modes.has(mode as never)),
    every_progression_mode_at_least_2:
      Object.values(progressionCounts).every((count) => count >= 2),
    stress_variants_at_least_3:
      cases.filter((entry) => entry.held_out_stress_variant).length >= 3,
    protocol_schema_valid: cases.every((entry) => Boolean(entry.dialogue_input)),
    overlap_passed: analyzeE2A13ProtocolOverlap().passed
  };
  return {
    protocol_version: E2A13_PROTOCOL_VERSION,
    derived_protocol_hash: deriveE2A13ProtocolHash(),
    frozen_protocol_hash: E2A13_PROTOCOL_HASH,
    checks,
    passed: Object.values(checks).every(Boolean),
    remain_in_dialogue_count: remainInDialogue.length,
    progression_count: progression.length,
    operation_counts: operationCounts,
    progression_mode_counts: progressionCounts,
    stress_case_count:
      cases.filter((entry) => entry.held_out_stress_variant).length,
    tenth_turn_checks: tenthChecks
  };
}

function positiveInteger(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  cap: number
) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > cap) {
    throw new Error(`e2a13_invalid_budget:${name}`);
  }
  return value;
}

function positiveNumber(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  cap: number
) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > cap) {
    throw new Error(`e2a13_invalid_budget:${name}`);
  }
  return value;
}

export function resolveE2A13Budget(
  env: Readonly<Record<string, string | undefined>> = process.env
): E2A13Budget {
  return {
    maximum_cases: positiveInteger(
      env, "EVAL_E2A13_MAX_CASES", 30, 30
    ) as 30,
    maximum_initial_generation_calls: positiveInteger(
      env, "EVAL_E2A13_MAX_INITIAL_CALLS", 30, 30
    ) as 30,
    maximum_regeneration_calls: positiveInteger(
      env, "EVAL_E2A13_MAX_REGENERATION_CALLS", 30, 30
    ) as 30,
    maximum_total_generation_calls: positiveInteger(
      env, "EVAL_E2A13_MAX_TOTAL_CALLS", 60, 60
    ) as 60,
    maximum_input_tokens: positiveInteger(
      env, "EVAL_E2A13_MAX_INPUT_TOKENS", 900_000, 900_000
    ) as 900000,
    maximum_output_tokens: positiveInteger(
      env, "EVAL_E2A13_MAX_OUTPUT_TOKENS", 150_000, 150_000
    ) as 150000,
    maximum_estimated_cost_usd: positiveNumber(
      env, "EVAL_E2A13_MAX_COST_USD", 35, 35
    ) as 35,
    maximum_regenerations_per_case: 1,
    provider_case_concurrency: 1
  };
}

function postgresHealthy() {
  try {
    const output = execFileSync("docker", [
      "inspect",
      "--format",
      "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}",
      "conversational-mcq-postgres"
    ], { encoding: "utf8" }).trim();
    return output === "running healthy" || output === "running no-healthcheck";
  } catch {
    return false;
  }
}

function duplicateRunnerPids() {
  try {
    return execFileSync("ps", ["-axo", "pid=,command="], {
      encoding: "utf8"
    }).split("\n").flatMap((line) => {
      if (!/formative-evaluation-e2a13-(?:live|preflight)/u.test(line)) return [];
      const pid = Number(line.trim().split(/\s+/u)[0]);
      return Number.isInteger(pid) && pid !== process.pid && pid !== process.ppid
        ? [pid]
        : [];
    });
  } catch {
    return [];
  }
}

function nextDevServerPids() {
  try {
    return execFileSync("ps", ["-axo", "pid=,command="], {
      encoding: "utf8"
    }).split("\n").flatMap((line) => {
      if (!/(?:next dev|next-server \(v)/u.test(line)) return [];
      const pid = Number(line.trim().split(/\s+/u)[0]);
      return Number.isInteger(pid) ? [pid] : [];
    });
  } catch {
    return [];
  }
}

function activeBundle() {
  if (!existsSync(ACTIVE_BUNDLE_PATH)) {
    throw new Error("e2a13_active_approval_bundle_missing");
  }
  return readJson<{ runtime_candidate_hash?: string }>(ACTIVE_BUNDLE_PATH);
}

function filesContainingUnder(root: string, value: string) {
  return listFiles(root).filter((filePath) =>
    /\.json(?:l)?$/u.test(filePath) &&
    readFileSync(filePath, "utf8").includes(value)
  ).map(relative);
}

function latestSuccessfulE1Exists() {
  const root = path.join(process.cwd(), ".data", "formative-evaluation-smoke");
  return listFiles(root).filter((filePath) =>
    path.basename(filePath) === "summary.json"
  ).some((filePath) => {
    try {
      const summary = readJson<Record<string, unknown>>(filePath);
      return summary.run_count === 12 &&
        summary.scenario_pass_rate === 1 &&
        summary.critical_invariant_failure_rate === 0 &&
        summary.provider_call_count === 0;
    } catch {
      return false;
    }
  });
}

function latestSuccessfulPrivacyE2EExists() {
  const root = path.join(process.cwd(), ".data", "e2e");
  return listFiles(root).filter((filePath) =>
    path.basename(filePath) === "report.json"
  ).some((filePath) => {
    try {
      const report = readJson<{
        suite?: string;
        external_llm_calls?: number;
        gates?: Array<{ status?: string }>;
      }>(filePath);
      return report.suite === "privacy-smoke" &&
        report.external_llm_calls === 0 &&
        Boolean(report.gates?.length) &&
        report.gates?.every((gate) => gate.status === "pass");
    } catch {
      return false;
    }
  });
}

export async function inspectE2A13Preflight(input: {
  requireLiveEnvironment?: boolean;
  requireCleanTrackedTree?: boolean;
  artifactRoot?: string;
} = {}) {
  const candidate = evaluateE2A11Candidate();
  const active = activeBundle();
  const protocol = validateE2A13HeldOutProtocol();
  const overlap = analyzeE2A13ProtocolOverlap();
  const protectedArtifacts = e2a13ProtectedArtifactSnapshot();
  const evaluationSource = e2a13EvaluationSourceSnapshot();
  const compilationPath = path.join(
    os.tmpdir(),
    `e2a13-compilation-${randomBytes(5).toString("hex")}.json`
  );
  const compilation = await compileE2A11CandidateRequestsNoNetwork(
    compilationPath
  );
  rmSync(compilationPath, { force: true });
  const budget = resolveE2A13Budget();
  const baseUrl = resolveOpenAIBaseUrl();
  const credential = input.requireLiveEnvironment
    ? resolveOpenAICredentialFromEnv(process.env)
    : null;
  const blockers: string[] = [];
  const v8References = filesContainingUnder(
    ACTIVE_APPROVAL_ROOT,
    E2A11_CANDIDATE_HASH
  );
  const e2a11ManifestPath = path.join(
    E2A11_RUN_DIR,
    "calibration-manifest.json"
  );
  const e2a12ManifestPath = path.join(E2A12_RUN_DIR, "canary-manifest.json");
  if (candidate.candidate_configuration_hash !== E2A11_CANDIDATE_HASH) {
    blockers.push("v8_candidate_hash_mismatch");
  }
  if (candidate.candidate_file_sha256 !== E2A11_CANDIDATE_FILE_SHA256) {
    blockers.push("v8_candidate_file_sha_mismatch");
  }
  if (candidate.approved_v2_hash !== E2A4_APPROVED_V2_HASH) {
    blockers.push("approved_v2_hash_mismatch");
  }
  if (active.runtime_candidate_hash !== E2A4_APPROVED_V2_HASH) {
    blockers.push("approved_v2_not_active");
  }
  if (v8References.length > 0 || candidate.candidate_approved ||
    candidate.candidate_activated) {
    blockers.push("v8_approval_or_activation_evidence_exists");
  }
  if (!existsSync(e2a11ManifestPath)) {
    blockers.push("e2a11_evidence_missing");
  } else {
    const manifest = readJson<{ status?: string }>(e2a11ManifestPath);
    if (manifest.status !== "e2a11_passed_v8_unapproved_pending_fresh_canary") {
      blockers.push("e2a11_evidence_not_eligible");
    }
  }
  if (!existsSync(e2a12ManifestPath)) {
    blockers.push("e2a12_evidence_missing");
  } else {
    const manifest = readJson<{ canary_status?: string }>(e2a12ManifestPath);
    if (manifest.canary_status !==
      "v8_canary_automated_pass_pending_human_review") {
      blockers.push("e2a12_evidence_not_eligible");
    }
  }
  if (!protocol.passed) blockers.push("held_out_protocol_invalid");
  if (!overlap.passed) blockers.push("held_out_protocol_overlap_detected");
  try {
    assertE2A13ProtocolFrozen();
  } catch {
    blockers.push("held_out_protocol_hash_mismatch");
  }
  if (Object.keys(candidate.role_config_hashes).length !== 17) {
    blockers.push("v8_role_inventory_mismatch");
  }
  if (!compilation.artifact.all_17_roles_compile ||
    compilation.artifact.request_count !== 26 ||
    compilation.artifact.network_request_count !== 0) {
    blockers.push("v8_request_compilation_gate_failed");
  }
  if (input.requireLiveEnvironment && !latestSuccessfulE1Exists()) {
    blockers.push("e1_12_of_12_evidence_missing");
  }
  if (input.requireLiveEnvironment && !latestSuccessfulPrivacyE2EExists()) {
    blockers.push("privacy_e2e_pass_evidence_missing");
  }
  if (input.requireLiveEnvironment && !postgresHealthy()) {
    blockers.push("local_postgresql_not_healthy");
  }
  const duplicatePids = duplicateRunnerPids();
  if (duplicatePids.length > 0) blockers.push("duplicate_e2a13_runner_active");
  const devServerPids = input.requireLiveEnvironment ? nextDevServerPids() : [];
  if (devServerPids.length > 0) blockers.push("next_dev_server_active");
  const root = input.artifactRoot ?? E2A13_ARTIFACT_ROOT;
  if (input.requireLiveEnvironment && existsSync(path.join(root, "latest-run.json"))) {
    blockers.push("e2a13_live_evaluation_already_exists");
  }
  if (input.requireLiveEnvironment && existsSync(RUNNER_LOCK_PATH)) {
    blockers.push("e2a13_runner_lock_exists");
  }
  let trackedTreeClean: boolean | null = null;
  if (input.requireCleanTrackedTree) {
    const status = execFileSync("git", [
      "status",
      "--porcelain",
      "--untracked-files=no"
    ], { cwd: process.cwd(), encoding: "utf8" }).trim();
    trackedTreeClean = status.length === 0;
    if (!trackedTreeClean) blockers.push("tracked_worktree_not_clean");
  }
  if (input.requireLiveEnvironment) {
    if (process.env.EVAL_E2A13_LIVE_PROVIDER !== "1") {
      blockers.push("live_e2a13_opt_in_missing");
    }
    if (process.env.LLM_PROVIDER !== "openai") blockers.push("provider_not_openai");
    if (process.env.LLM_LIVE_CALLS_ENABLED !== "true") {
      blockers.push("live_calls_not_enabled");
    }
    if (process.env.OPERATIONAL_APPROVED_CONFIG_HASH !== E2A4_APPROVED_V2_HASH) {
      blockers.push("approved_config_hash_mismatch");
    }
    if (!isApprovedOpenAIBaseUrl(baseUrl)) {
      blockers.push("openai_base_url_not_approved");
    }
    if (!credential?.ok) blockers.push(credential?.code ?? "credential_missing");
  }
  return {
    preflight_version: "e2a13-v8-30-case-provider-evaluation-preflight-v1",
    passed: blockers.length === 0,
    blockers,
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    protocol_hash: deriveE2A13ProtocolHash(),
    frozen_protocol_hash: E2A13_PROTOCOL_HASH,
    protocol_valid: protocol.passed,
    protocol_overlap_passed: overlap.passed,
    approved_v2_hash: candidate.approved_v2_hash,
    active_runtime_hash: active.runtime_candidate_hash ?? null,
    active_runtime_references_v8:
      active.runtime_candidate_hash === E2A11_CANDIDATE_HASH,
    v8_candidate_approved: false,
    v8_candidate_activated: false,
    existing_v8_approval_or_activation_paths: v8References,
    e2a12_run_id: E2A13_E2A12_RUN_ID,
    e2a12_evidence_verified: existsSync(e2a12ManifestPath) &&
      readJson<{ canary_status?: string }>(e2a12ManifestPath)
        .canary_status === "v8_canary_automated_pass_pending_human_review",
    role_count: Object.keys(candidate.role_config_hashes).length,
    all_17_roles_compile: compilation.artifact.all_17_roles_compile,
    request_count: compilation.artifact.request_count,
    request_compilation_network_count:
      compilation.artifact.network_request_count,
    e1_12_of_12_verified: latestSuccessfulE1Exists(),
    privacy_e2e_verified: latestSuccessfulPrivacyE2EExists(),
    credential_configured: credential?.ok ?? false,
    provider_host: input.requireLiveEnvironment
      ? openAIBaseUrlHost(baseUrl)
      : "not_checked",
    explicit_live_opt_in_required: true,
    local_postgresql_healthy: postgresHealthy(),
    duplicate_runner_pids: duplicatePids,
    next_dev_server_pids: devServerPids,
    tracked_worktree_clean: trackedTreeClean,
    budget,
    provider_case_concurrency: 1,
    protected_artifact_hash: protectedArtifacts.aggregate_sha256,
    protected_artifact_groups: protectedArtifacts.tracked_groups,
    evaluation_source_hash: evaluationSource.aggregate_sha256,
    evaluation_source_files: evaluationSource.files,
    e2a11_evidence_sha256: directoryDigest(E2A11_RUN_DIR).sha256
  };
}

type Fixture = {
  run_id: string;
  user_db_id: string;
  assessment_db_id: string;
  concept_unit_db_id: string;
  sessions: Map<string, {
    assessment_session_db_id: string;
    concept_unit_session_db_id: string;
    session_public_id: string;
  }>;
};

export async function createE2A13Fixture(
  prisma: PrismaClient,
  runId: string,
  cases = e2a13HeldOutCases()
): Promise<Fixture> {
  const user = await prisma.user.create({
    data: {
      user_id: `e2a13_${runId}`,
      user_id_normalized: `e2a13_${runId}`.toLocaleLowerCase(),
      display_name: "E2A13 synthetic student",
      role: "student"
    }
  });
  const teacher = await prisma.user.create({
    data: {
      user_id: `e2a13_teacher_${runId}`,
      user_id_normalized: `e2a13_teacher_${runId}`.toLocaleLowerCase(),
      display_name: "E2A13 synthetic teacher",
      role: "teacher_researcher"
    }
  });
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: `e2a13_asmt_${runId}`,
      title: "E2A13 isolated 30-case evaluation fixture",
      status: "draft",
      workflow_mode: "automatic",
      response_collection_mode: "llm_assisted",
      created_by_user_db_id: teacher.id
    }
  });
  const concept = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: `e2a13_cu_${runId}`,
      assessment_db_id: assessment.id,
      title: "Held-out psychometric boundaries",
      learning_objective:
        "Distinguish related measurement claims without unsupported inference.",
      related_concept_description:
        "Synthetic E2A.12 runtime fixture; contains no classroom records.",
      order_index: 1,
      status: "draft"
    }
  });
  const sessions = new Map<string, {
    assessment_session_db_id: string;
    concept_unit_session_db_id: string;
    session_public_id: string;
  }>();
  for (const testCase of cases) {
    const session = await prisma.assessmentSession.create({
      data: {
        session_public_id: `e2a13_${runId}_${testCase.case_number}`,
        user_db_id: user.id,
        assessment_db_id: assessment.id,
        attempt_number: testCase.case_number,
        status: "active",
        current_phase: "followup_active",
        workflow_mode_snapshot: "automatic",
        response_collection_mode_snapshot: "llm_assisted",
        current_concept_unit_db_id: concept.id,
        started_at: new Date(),
        last_activity_at: new Date()
      }
    });
    const conceptSession = await prisma.conceptUnitSession.create({
      data: {
        assessment_session_db_id: session.id,
        concept_unit_db_id: concept.id,
        status: "followup_active",
        followup_status: "active",
        followup_started_at: new Date()
      }
    });
    for (const turn of testCase.dialogue_input.visible_dialogue_history) {
      await prisma.conversationTurn.create({
        data: {
          assessment_session_db_id: session.id,
          concept_unit_session_db_id: conceptSession.id,
          phase: "followup_active",
          actor_type: turn.actor_type,
          agent_name: turn.actor_type === "agent"
            ? "topic_dialogue_agent"
            : null,
          message_text: turn.message_text,
          structured_payload: {
            visible_turn_id: turn.visible_turn_id,
            protocol_sequence_index: turn.sequence_index
          }
        }
      });
    }
    await prisma.conversationTurn.create({
      data: {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptSession.id,
        phase: "followup_active",
        actor_type: "student",
        message_text: testCase.dialogue_input.latest_student_message,
        structured_payload: {
          visible_turn_id: testCase.dialogue_input.latest_student_turn_id,
          latest_student_message: true
        }
      }
    });
    sessions.set(testCase.case_id, {
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptSession.id,
      session_public_id: session.session_public_id
    });
  }
  return {
    run_id: runId,
    user_db_id: user.id,
    assessment_db_id: assessment.id,
    concept_unit_db_id: concept.id,
    sessions
  };
}

export async function cleanupE2A13Fixture(
  prisma: PrismaClient,
  fixture: Fixture
) {
  const sessionIds = [...fixture.sessions.values()].map((entry) =>
    entry.assessment_session_db_id
  );
  const sessionPublicIds = [...fixture.sessions.values()].map((entry) =>
    entry.session_public_id
  );
  await prisma.operationalAgentEffectiveResult.deleteMany({
    where: {
      agent_name: "topic_dialogue_agent",
      operational_context_public_id: { in: sessionPublicIds },
      invocation_key: { startsWith: "e2a13:" }
    }
  });
  await prisma.processEvent.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.conversationTurn.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.agentCall.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.conceptUnitSession.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.assessmentSession.deleteMany({
    where: { id: { in: sessionIds } }
  });
  await prisma.conceptUnit.delete({ where: { id: fixture.concept_unit_db_id } });
  await prisma.assessment.delete({ where: { id: fixture.assessment_db_id } });
  await prisma.user.deleteMany({
    where: { user_id: { in: [
      `e2a13_${fixture.run_id}`,
      `e2a13_teacher_${fixture.run_id}`
    ] } }
  });
}

function requestForE2A13Case(testCase: E2A13TopicDialogueCase) {
  return requestForCase(testCase);
}

function repairInstructionsForE2A13(input: {
  testCase: E2A13TopicDialogueCase;
  originalInstructions: string;
  validation: TopicDialogueRuntimeValidationResult;
}) {
  const failedRequirements = input.validation.hard_rejection_reasons.map(
    (reason) => reason.rule_code
  );
  if (input.testCase.selected_mode === "remain_in_dialogue") {
    if (!input.testCase.selected_operation) {
      throw new Error("e2a13_operation_repair_missing_operation");
    }
    return buildTopicDialogueOperationRepairInstructions({
      operation: input.testCase.selected_operation,
      original_instructions: input.originalInstructions,
      latest_student_message:
        input.testCase.dialogue_input.latest_student_message,
      distractor_anchor: input.testCase.distractor_anchor,
      failed_requirements: failedRequirements,
      prohibited_repeated_strategies:
        input.testCase.strategies_marked_unsuccessful
    });
  }
  return `${input.originalInstructions}\n\n` +
    "The prior output was hard rejected by the runtime contract. " +
    `The server-selected response mode remains exactly ${input.testCase.selected_mode}. ` +
    "Do not select another mode, operation, action, readiness state, or runtime state.\n" +
    `Latest student message: ${input.testCase.dialogue_input.latest_student_message}\n` +
    `Active distractor anchor: ${input.testCase.distractor_anchor}\n` +
    `Correct these hard violations: ${failedRequirements.join(", ") || "strict contract failure"}.\n` +
    "Return one complete object for the same strict mode-specific schema.";
}

function estimatedInputTokens(testCase: E2A13TopicDialogueCase) {
  const request = requestForE2A13Case(testCase);
  return Math.ceil(
    `${request.instructions}\n${JSON.stringify(request.provider_input)}`.length / 3
  );
}

function aggregateAttempts(results: E2A13CaseResult[]) {
  return results.flatMap((result) => result.execution.attempts);
}

function aggregateUsageFromAttempts(
  attempts: CandidateRuntimeExecution["attempts"]
) {
  const costs = attempts.map((attempt) => attempt.usage.estimated_cost_usd);
  const completePricing = costs.every((cost) => cost !== null);
  return {
    provider_adapter_attempts: attempts.reduce((sum, attempt) =>
      sum + attempt.adapter_attempt_count, 0
    ),
    generation_provider_calls: attempts.filter((attempt) =>
      attempt.generation_dispatched
    ).length,
    initial_generation_calls: attempts.filter((attempt) =>
      attempt.generation_dispatched && attempt.attempt_index === 1
    ).length,
    regeneration_generation_calls: attempts.filter((attempt) =>
      attempt.generation_dispatched && attempt.attempt_index === 2
    ).length,
    metadata_only_requests: 0,
    input_tokens: attempts.reduce((sum, attempt) =>
      sum + attempt.usage.input_tokens, 0
    ),
    output_tokens: attempts.reduce((sum, attempt) =>
      sum + attempt.usage.output_tokens, 0
    ),
    reasoning_tokens: attempts.reduce((sum, attempt) =>
      sum + attempt.usage.reasoning_tokens, 0
    ),
    cached_input_tokens: attempts.reduce((sum, attempt) =>
      sum + attempt.usage.cached_input_tokens, 0
    ),
    total_tokens: attempts.reduce((sum, attempt) =>
      sum + attempt.usage.total_tokens, 0
    ),
    usage_verified: attempts.every((attempt) => attempt.usage.usage_verified),
    pricing_available: completePricing,
    estimated_cost_usd: completePricing
      ? costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)
      : null,
    latency_ms: attempts.reduce((sum, attempt) =>
      sum + attempt.latency_ms, 0
    ),
    transport_retries: attempts.reduce((sum, attempt) =>
      sum + attempt.transport_retry_count, 0
    )
  };
}

function assertBudgetBeforeDispatch(input: {
  budget: E2A13Budget;
  completedResults: E2A13CaseResult[];
  currentResults: StructuredAgentResult<unknown>[];
  testCase: E2A13TopicDialogueCase;
  modelConfig: AgentModelConfig;
  attemptIndex: 1 | 2;
}) {
  const priorAttempts = aggregateAttempts(input.completedResults);
  const currentInitial = input.currentResults.length > 0 ? 1 : 0;
  const currentRegens = Math.max(input.currentResults.length - 1, 0);
  const currentInput = input.currentResults.reduce((sum, result) =>
    sum + (result.usage?.input_tokens ?? 0), 0
  );
  const currentOutput = input.currentResults.reduce((sum, result) =>
    sum + (result.usage?.output_tokens ?? 0), 0
  );
  const priorUsage = aggregateUsageFromAttempts(priorAttempts);
  if (input.attemptIndex === 1 && input.completedResults.length + 1 >
    input.budget.maximum_cases) {
    throw new Error("e2a13_case_budget_exceeded");
  }
  if (input.attemptIndex === 1 && priorUsage.initial_generation_calls +
    currentInitial + 1 > input.budget.maximum_initial_generation_calls) {
    throw new Error("e2a13_initial_call_budget_exceeded");
  }
  if (input.attemptIndex === 2 &&
    priorUsage.regeneration_generation_calls + currentRegens + 1 >
      input.budget.maximum_regeneration_calls) {
    throw new Error("e2a13_regeneration_call_budget_exceeded");
  }
  if (priorUsage.generation_provider_calls + input.currentResults.length + 1 >
    input.budget.maximum_total_generation_calls) {
    throw new Error("e2a13_total_call_budget_exceeded");
  }
  if (priorUsage.input_tokens + currentInput +
    estimatedInputTokens(input.testCase) > input.budget.maximum_input_tokens) {
    throw new Error("e2a13_input_token_budget_insufficient");
  }
  if (priorUsage.output_tokens + currentOutput +
    (input.modelConfig.max_output_tokens ?? 3500) >
      input.budget.maximum_output_tokens) {
    throw new Error("e2a13_output_token_budget_insufficient");
  }
  const completedCosts = priorAttempts.map((attempt) =>
    attempt.usage.estimated_cost_usd
  );
  const currentCosts = input.currentResults.map((result) =>
    result.transport_telemetry?.normalized_response?.usage.calculatedCostUsd ??
      null
  );
  const costs = [...completedCosts, ...currentCosts];
  if (costs.length > 0 && costs.every((cost) => cost !== null)) {
    const priorCost = costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0);
    const reserve = priorCost / costs.length;
    if (priorCost + reserve > input.budget.maximum_estimated_cost_usd) {
      throw new Error("e2a13_cost_budget_insufficient");
    }
  }
}

function artifactPaths(runDir: string) {
  return {
    manifest: path.join(runDir, "evaluation-manifest.json"),
    protocol: path.join(runDir, "evaluation-protocol.json"),
    protocolHash: path.join(runDir, "evaluation-protocol.sha256"),
    overlap: path.join(runDir, "protocol-overlap-analysis.json"),
    candidateManifest: path.join(runDir, "candidate-manifest.json"),
    candidateDelta: path.join(runDir, "candidate-delta.json"),
    runtimePolicy: path.join(runDir, "runtime-validator-policy.json"),
    rubricPolicy: path.join(runDir, "pedagogical-rubric-policy.json"),
    requestCompilation: path.join(runDir, "all-role-request-compilation.json"),
    providerCases: path.join(runDir, "provider-cases.jsonl"),
    providerOutputs: path.join(runDir, "provider-outputs.jsonl"),
    runtimeValidation: path.join(runDir, "runtime-validation-results.jsonl"),
    rubricResults: path.join(runDir, "pedagogical-rubric-results.jsonl"),
    v7Shadow: path.join(runDir, "v7-shadow-validation.jsonl"),
    regeneration: path.join(runDir, "regeneration-results.jsonl"),
    persistence: path.join(runDir, "persistence-results.jsonl"),
    studentProjection: path.join(runDir, "student-projection-results.jsonl"),
    auditProjection: path.join(runDir, "audit-projection-results.jsonl"),
    transcript: path.join(runDir, "transcript-results.jsonl"),
    platformSafety: path.join(runDir, "platform-safety.jsonl"),
    contextCoverage: path.join(runDir, "context-coverage.jsonl"),
    privacy: path.join(runDir, "privacy-results.jsonl"),
    providerUsage: path.join(runDir, "provider-usage.json"),
    humanReviewPacket: path.join(runDir, "human-review-packet.json"),
    summary: path.join(runDir, "evaluation-summary.json")
  };
}

function initializeJsonlArtifacts(paths: SafeArtifactPaths) {
  for (const filePath of [
    paths.providerCases,
    paths.providerOutputs,
    paths.runtimeValidation,
    paths.rubricResults,
    paths.v7Shadow,
    paths.regeneration,
    paths.persistence,
    paths.studentProjection,
    paths.auditProjection,
    paths.transcript,
    paths.platformSafety,
    paths.contextCoverage,
    paths.privacy
  ]) writeFileSync(filePath, "", "utf8");
}

function answerKeyFindings(message: string) {
  return /\b(?:the correct answer is|correct option is|answer key|unadministered answer)\b/iu
    .test(message) ? ["answer_key_language_detected"] : [];
}

function studentProjectionIsSafe(execution: CandidateRuntimeExecution) {
  const value = JSON.stringify({
    student_projection: execution.student_projection,
    action_response: execution.action_response,
    rendered_text: execution.rendered_text,
    transcript: execution.refreshed_transcript
  });
  return !/review_flag|hard_rejection|validator_version|rubric_version|candidate_hash|fallback_applied|provider_request_id|provider_response_id/iu
    .test(value);
}

async function verifyPersistedCase(input: {
  prisma: PrismaClient;
  fixtureSession: Fixture["sessions"] extends Map<string, infer T> ? T : never;
  execution: CandidateRuntimeExecution;
}) {
  const effective = await input.prisma.operationalAgentEffectiveResult.findUnique({
    where: {
      invocation_key_effective_result_version: {
        invocation_key: `e2a13:${input.fixtureSession.session_public_id}`,
        effective_result_version:
          TOPIC_DIALOGUE_CANDIDATE_EFFECTIVE_RESULT_VERSION
      }
    },
    select: {
      public_id: true,
      warnings_json: true,
      fallback_applied: true,
      effective_output_json: true
    }
  });
  const calls = await input.prisma.agentCall.findMany({
    where: {
      assessment_session_db_id:
        input.fixtureSession.assessment_session_db_id,
      agent_name: "topic_dialogue_agent"
    },
    orderBy: { created_at: "asc" },
    select: {
      client_request_id: true,
      call_status: true,
      output_payload: true,
      validation_error: true
    }
  });
  const visible = await input.prisma.conversationTurn.findMany({
    where: {
      assessment_session_db_id:
        input.fixtureSession.assessment_session_db_id,
      actor_type: "agent",
      agent_name: "topic_dialogue_agent",
      message_text: input.execution.persisted_visible_message
    },
    select: { sequence_index: true, message_text: true }
  });
  return {
    effective_result_found: Boolean(effective),
    effective_result_public_id: effective?.public_id ?? null,
    effective_result_matches_execution:
      effective?.public_id ===
        input.execution.persisted_effective_result_public_id,
    provider_attempt_record_count: calls.length,
    rejected_attempts_auditable: calls.filter((call) =>
      call.call_status === "invalid_output"
    ).length === input.execution.attempts.filter((attempt) =>
      attempt.runtime_validation.runtime_acceptance === "hard_rejected"
    ).length,
    visible_final_turn_count: visible.length,
    exactly_one_final_response_visible: visible.length === 1,
    visible_message_matches:
      visible[0]?.message_text === input.execution.persisted_visible_message,
    warnings_internal_only: Boolean(effective?.warnings_json),
    fallback_applied: effective?.fallback_applied ?? null
  };
}

function writeCaseArtifacts(input: {
  paths: SafeArtifactPaths;
  testCase: E2A13TopicDialogueCase;
  result: E2A13CaseResult;
  persistence: Awaited<ReturnType<typeof verifyPersistedCase>>;
}) {
  const { paths, testCase, result, persistence } = input;
  for (const attempt of result.execution.attempts) {
    appendJsonl(paths.providerOutputs, {
      case_id: testCase.case_id,
      attempt_index: attempt.attempt_index,
      regeneration: attempt.attempt_index === 2,
      provider_status: attempt.provider_status,
      generation_dispatched: attempt.generation_dispatched,
      provider_request_id: attempt.provider_request_id,
      provider_response_id: attempt.provider_response_id,
      client_request_id: attempt.client_request_id,
      parsed_output: attempt.parsed_output,
      raw_output_present: attempt.raw_output_present,
      usage: attempt.usage,
      latency_ms: attempt.latency_ms,
      adapter_attempt_count: attempt.adapter_attempt_count,
      transport_retry_count: attempt.transport_retry_count,
      sanitized_provider_error: attempt.sanitized_provider_error
    });
    appendJsonl(paths.runtimeValidation, {
      case_id: testCase.case_id,
      attempt_index: attempt.attempt_index,
      ...attempt.runtime_validation
    });
    appendJsonl(paths.rubricResults, {
      case_id: testCase.case_id,
      attempt_index: attempt.attempt_index,
      rubric_version: TOPIC_DIALOGUE_PEDAGOGICAL_RUBRIC_V1_VERSION,
      findings: attempt.pedagogical_rubric,
      runtime_acceptance_mutated: false
    });
  }
  for (const shadow of result.v7_shadow_attempts) {
    appendJsonl(paths.v7Shadow, { case_id: testCase.case_id, ...shadow });
  }
  appendJsonl(paths.regeneration, {
    case_id: testCase.case_id,
    regeneration_count: result.execution.regeneration_count,
    initial_runtime_acceptance:
      result.execution.attempts[0]?.runtime_validation.runtime_acceptance,
    final_runtime_acceptance: result.execution.final_runtime_acceptance,
    regeneration_triggered_only_by_hard_rejection:
      result.execution.regeneration_count === 0 ||
      result.execution.attempts[0]?.runtime_validation.runtime_acceptance ===
        "hard_rejected",
    deterministic_fallback_used:
      result.execution.deterministic_fallback_used
  });
  appendJsonl(paths.persistence, {
    case_id: testCase.case_id,
    ...persistence,
    visible_chronological_order_valid:
      result.execution.visible_chronological_order_valid,
    refreshed_transcript_visible_message_matches:
      result.execution.refreshed_transcript.at(-1)?.message_text ===
        result.execution.persisted_visible_message
  });
  appendJsonl(paths.studentProjection, {
    case_id: testCase.case_id,
    projection: result.execution.student_projection,
    action_response: result.execution.action_response,
    rendered_text: result.execution.rendered_text,
    review_flags_absent: result.student_projection_passed,
    provider_message_displayed_unchanged:
      result.execution.deterministic_fallback_used ||
      result.execution.persisted_visible_message ===
        result.execution.attempts.at(-1)?.runtime_validation.visible_message
  });
  appendJsonl(paths.auditProjection, {
    case_id: testCase.case_id,
    projection: result.execution.audit_projection,
    authorized_audit_contains_review_provenance:
      result.audit_projection_passed
  });
  appendJsonl(paths.transcript, {
    case_id: testCase.case_id,
    visible_turn_ids:
      result.execution.refreshed_transcript.map((turn) => turn.sequence_index),
    visible_message_count: result.execution.refreshed_transcript.length,
    visible_chronological_order_valid:
      result.execution.visible_chronological_order_valid,
    no_duplicate_visible_turns:
      new Set(result.execution.refreshed_transcript.map((turn) =>
        turn.sequence_index
      )).size === result.execution.refreshed_transcript.length,
    persisted_visible_message_matches:
      result.execution.refreshed_transcript.at(-1)?.message_text ===
        result.execution.persisted_visible_message,
    passed: result.transcript_refresh_passed
  });
  appendJsonl(paths.platformSafety, {
    case_id: testCase.case_id,
    selected_mode: testCase.selected_mode,
    selected_operation: testCase.selected_operation,
    provider_cannot_select_mode_or_operation: true,
    platform_transition_executed:
      result.execution.platform_transition_executed,
    safe: result.platform_safety_passed
  });
  appendJsonl(paths.contextCoverage, result.context_coverage);
  appendJsonl(paths.privacy, {
    case_id: testCase.case_id,
    privacy_safe: result.privacy_findings.length === 0,
    answer_key_safe: result.answer_key_findings.length === 0,
    privacy_findings: result.privacy_findings,
    answer_key_findings: result.answer_key_findings
  });
}

async function executeCases(input: {
  prisma: PrismaClient;
  fixture: Fixture;
  cases: E2A13TopicDialogueCase[];
  provider: LlmProvider;
  modelConfig: AgentModelConfig;
  timeoutMs: number;
  budget: E2A13Budget;
  paths: SafeArtifactPaths;
  runId: string;
}) {
  const results: E2A13CaseResult[] = [];
  let stopReason: string | null = null;
  for (const testCase of input.cases) {
    const fixtureSession = input.fixture.sessions.get(testCase.case_id);
    if (!fixtureSession) {
      throw new Error(`e2a13_fixture_session_missing:${testCase.case_id}`);
    }
    const request = requestForE2A13Case(testCase);
    appendJsonl(input.paths.providerCases, {
      case_id: testCase.case_id,
      case_number: testCase.case_number,
      selected_mode: testCase.selected_mode,
      selected_operation: testCase.selected_operation,
      item_anchor_id: testCase.item_anchor_id,
      conceptual_target_id: testCase.conceptual_target_id,
      distractor_anchor: testCase.distractor_anchor,
      latest_student_message: testCase.dialogue_input.latest_student_message,
      safe_visible_history_excerpt:
        testCase.dialogue_input.visible_dialogue_history.slice(-4),
      visible_history_turn_count:
        testCase.dialogue_input.visible_dialogue_history.length,
      request_schema_name: request.schema_name,
      output_schema_version: request.output_schema_version,
      dispatch_status: stopReason ? "skipped" : "planned",
      dispatch_skipped_reason: stopReason
    });
    if (stopReason) continue;
    const currentProviderResults: StructuredAgentResult<unknown>[] = [];
    try {
      const execution = await executeTopicDialogueCandidateRuntimeV2({
        prisma: input.prisma,
        assessment_session_db_id:
          fixtureSession.assessment_session_db_id,
        concept_unit_session_db_id:
          fixtureSession.concept_unit_session_db_id,
        session_public_id: fixtureSession.session_public_id,
        invocation_key: `e2a13:${fixtureSession.session_public_id}`,
        candidate_hash: E2A11_CANDIDATE_HASH,
        protocol_hash: E2A13_PROTOCOL_HASH,
        model_config: input.modelConfig,
        validation_context: {
          selected_mode: testCase.selected_mode,
          selected_operation: testCase.selected_operation,
          latest_student_message:
            testCase.dialogue_input.latest_student_message,
          distractor_anchor: testCase.distractor_anchor,
          misconception_target: testCase.misconception_target,
          strategies_already_attempted:
            testCase.strategies_already_attempted,
          prohibited_repeated_strategies:
            testCase.strategies_marked_unsuccessful
        },
        deterministic_fallback_output: fallbackForCase(testCase),
        invoke_provider: async ({ attempt_index, prior_validation }) => {
          assertBudgetBeforeDispatch({
            budget: input.budget,
            completedResults: results,
            currentResults: currentProviderResults,
            testCase,
            modelConfig: input.modelConfig,
            attemptIndex: attempt_index
          });
          const providerResult = await input.provider.executeStructured<
            typeof request.provider_input,
            unknown
          >({
            agent_name: "topic_dialogue_agent",
            model_config: input.modelConfig,
            instructions: attempt_index === 1 || !prior_validation
              ? request.instructions
              : repairInstructionsForE2A13({
                  testCase,
                  originalInstructions: request.instructions,
                  validation: prior_validation
                }),
            input: request.provider_input,
            output_schema: request.output_schema as z.ZodType<unknown>,
            schema_name: request.schema_name,
            client_request_id:
              `${input.runId}_${testCase.case_id}_${attempt_index}`,
            timeout_ms: input.timeoutMs,
            metadata: {
              evaluation: "e2a13_v8_30_case_bounded_provider_evaluation",
              case_id: testCase.case_id,
              selected_response_mode: testCase.selected_mode,
              selected_dialogue_operation:
                testCase.selected_operation ?? "none",
              candidate_hash_prefix: E2A11_CANDIDATE_HASH.slice(0, 12),
              protocol_hash_prefix: E2A13_PROTOCOL_HASH.slice(0, 12)
            }
          });
          currentProviderResults.push(providerResult);
          return providerResult;
        }
      });
      const shadows = execution.attempts.map((attempt) => {
        const v7 = validateE2A10ProviderOutput({
          testCase,
          value: attempt.parsed_output
        });
        return {
          attempt_index: attempt.attempt_index,
          v7_valid: v7.valid,
          v7_findings: v7.findings,
          v7_would_have_regenerated: !v7.valid,
          v8_runtime_acceptance:
            attempt.runtime_validation.runtime_acceptance,
          v8_changed_runtime_outcome:
            !v7.valid &&
            attempt.runtime_validation.runtime_acceptance !== "hard_rejected"
        };
      });
      const coverage = contextCoverage(testCase);
      const visible = execution.persisted_visible_message;
      const privacy = findVisibleTextPrivacyFindings(
        visible,
        "student_facing_message"
      );
      const answerKey = answerKeyFindings(visible);
      const controlViolations = execution.attempts.flatMap((attempt) =>
        attempt.runtime_validation.hard_rejection_reasons
      ).filter((reason) =>
        reason.rule_code.startsWith("provider_generated_")
      );
      const studentSafe = studentProjectionIsSafe(execution);
      const result: E2A13CaseResult = {
        case_id: testCase.case_id,
        case_number: testCase.case_number,
        selected_mode: testCase.selected_mode,
        selected_operation: testCase.selected_operation,
        execution,
        v7_shadow_attempts: shadows,
        context_coverage: coverage,
        privacy_findings: privacy,
        answer_key_findings: answerKey,
        final_provider_output_schema_valid:
          execution.attempts.at(-1)?.runtime_validation.parsed_output !== null,
        platform_safety_passed:
          controlViolations.length === 0 &&
          !execution.platform_transition_executed,
        student_projection_passed: studentSafe,
        audit_projection_passed:
          execution.audit_projection.candidate_hash === E2A11_CANDIDATE_HASH &&
          execution.audit_projection.protocol_hash === E2A13_PROTOCOL_HASH,
        transcript_refresh_passed:
          execution.visible_chronological_order_valid &&
          execution.refreshed_transcript.at(-1)?.message_text === visible
      };
      const persistence = await verifyPersistedCase({
        prisma: input.prisma,
        fixtureSession,
        execution
      });
      results.push(result);
      writeCaseArtifacts({
        paths: input.paths,
        testCase,
        result,
        persistence
      });
      if (execution.attempts.some((attempt) =>
        attempt.provider_status !== "completed"
      )) {
        stopReason = `provider_failure_after:${testCase.case_id}`;
      }
    } catch (error) {
      const safeError = error instanceof Error
        ? error.message
        : `e2a13_case_execution_failed:${testCase.case_id}`;
      const existingEffectiveCount = await input.prisma
        .operationalAgentEffectiveResult.count({
          where: {
            invocation_key: `e2a13:${fixtureSession.session_public_id}`,
            effective_result_version:
              TOPIC_DIALOGUE_CANDIDATE_EFFECTIVE_RESULT_VERSION
          }
        });
      stopReason = `${safeError};case_id=${testCase.case_id};` +
        `existing_effective_count=${existingEffectiveCount}`;
      appendJsonl(input.paths.regeneration, {
        case_id: testCase.case_id,
        execution_failed: true,
        safe_failure_reason: stopReason,
        provider_result_count: currentProviderResults.length
      });
    }
  }
  return { results, stop_reason: stopReason };
}

function hardEvidenceValid(result: E2A13CaseResult) {
  return result.execution.attempts.flatMap((attempt) =>
    attempt.runtime_validation.hard_rejection_reasons
  ).every((reason) =>
    reason.evidence_spans.length > 0 || reason.structured_evidence.length > 0
  );
}

function allHardReasons(results: E2A13CaseResult[]) {
  return results.flatMap((result) => result.execution.attempts.flatMap(
    (attempt) => attempt.runtime_validation.hard_rejection_reasons
      .map((reason) => ({ case_id: result.case_id, ...reason }))
  ));
}

function buildSummary(input: {
  results: E2A13CaseResult[];
  stopReason: string | null;
  budget: E2A13Budget;
  protectedBefore: ReturnType<typeof e2a13ProtectedArtifactSnapshot>;
  protectedAfter: ReturnType<typeof e2a13ProtectedArtifactSnapshot>;
  evaluationSourceBefore: ReturnType<typeof e2a13EvaluationSourceSnapshot>;
  evaluationSourceAfter: ReturnType<typeof e2a13EvaluationSourceSnapshot>;
  fixtureCleanupComplete: boolean;
}) {
  const attempts = aggregateAttempts(input.results);
  const usage = aggregateUsageFromAttempts(attempts);
  const hardReasons = allHardReasons(input.results);
  const initialAttempts = input.results.map((result) =>
    result.execution.attempts[0]
  ).filter((attempt): attempt is NonNullable<typeof attempt> =>
    Boolean(attempt)
  );
  const finalAccepted = input.results.every((result) => [
    "accepted",
    "accepted_with_review_flags"
  ].includes(result.execution.final_runtime_acceptance));
  const regenerationCount = input.results.reduce((sum, result) =>
    sum + result.execution.regeneration_count, 0
  );
  const fallbackCount = input.results.filter((result) =>
    result.execution.deterministic_fallback_used
  ).length;
  const softOnlyRegenerationCount = input.results.filter((result) =>
    result.execution.regeneration_count > 0 &&
    result.execution.attempts[0]?.runtime_validation.runtime_acceptance !==
      "hard_rejected"
  ).length;
  const controlFieldCount = hardReasons.filter((reason) =>
    reason.rule_code.startsWith("provider_generated_")
  ).length;
  const unauthorizedProgressionCount = hardReasons.filter((reason) =>
    /unauthorized|conflation|new_task_after_completion|fabricated_transfer/iu
      .test(reason.rule_code)
  ).length;
  const privacyFindingCount = input.results.reduce((sum, result) =>
    sum + result.privacy_findings.length, 0
  );
  const answerKeyFindingCount = input.results.reduce((sum, result) =>
    sum + result.answer_key_findings.length, 0
  );
  const v7RejectedCases = input.results.filter((result) =>
    result.v7_shadow_attempts.some((attempt) =>
      attempt.v7_would_have_regenerated
    )
  );
  const v7RejectedV8AcceptedCases = v7RejectedCases.filter((result) => [
    "accepted",
    "accepted_with_review_flags"
  ].includes(result.execution.final_runtime_acceptance));
  const protectedUnchanged = input.protectedBefore.aggregate_sha256 ===
    input.protectedAfter.aggregate_sha256;
  const evaluationSourceUnchanged =
    input.evaluationSourceBefore.aggregate_sha256 ===
      input.evaluationSourceAfter.aggregate_sha256;
  const contextRequired = input.results.filter((result) =>
    result.context_coverage.required_for_acceptance
  );
  const budgetWithinLimits =
    usage.generation_provider_calls <= input.budget.maximum_total_generation_calls &&
    usage.initial_generation_calls <=
      input.budget.maximum_initial_generation_calls &&
    usage.regeneration_generation_calls <=
      input.budget.maximum_regeneration_calls &&
    usage.input_tokens <= input.budget.maximum_input_tokens &&
    usage.output_tokens <= input.budget.maximum_output_tokens &&
    (!usage.pricing_available ||
      (usage.estimated_cost_usd ?? Infinity) <=
        input.budget.maximum_estimated_cost_usd);
  const baseGate = input.results.length === 30 &&
    initialAttempts.length === 30 &&
    initialAttempts.every((attempt) => attempt.generation_dispatched) &&
    initialAttempts.every((attempt) =>
      attempt.runtime_validation.parsed_output !== null
    ) &&
    finalAccepted &&
    fallbackCount === 0 &&
    softOnlyRegenerationCount === 0 &&
    input.results.every(hardEvidenceValid) &&
    controlFieldCount === 0 &&
    unauthorizedProgressionCount === 0 &&
    privacyFindingCount === 0 &&
    answerKeyFindingCount === 0 &&
    input.results.every((result) => result.platform_safety_passed) &&
    contextRequired.length >= 6 &&
    contextRequired.every((result) =>
      result.context_coverage.complete_tenth_turn_context
    ) &&
    input.results.every((result) =>
      result.student_projection_passed &&
      result.audit_projection_passed &&
      result.transcript_refresh_passed
    ) &&
    protectedUnchanged &&
    evaluationSourceUnchanged &&
    budgetWithinLimits &&
    input.fixtureCleanupComplete;
  const incomplete = input.stopReason !== null ||
    input.results.length !== 30 ||
    initialAttempts.length !== 30;
  const finalStatus = incomplete
    ? "v8_30case_incomplete" as const
    : baseGate && regenerationCount <= 6
      ? "v8_30case_pass_pending_human_review" as const
      : baseGate && regenerationCount > 6
        ? "v8_30case_failed_stability" as const
        : "v8_30case_failed" as const;
  const findingCount = (dimension: string) => attempts.filter((attempt) =>
    attempt.pedagogical_rubric.some((flag) => flag.dimension === dimension)
  ).length;
  return {
    summary_version: "e2a13-v8-30-case-bounded-provider-summary-v1",
    final_status: finalStatus,
    automated_evaluation_passed:
      finalStatus === "v8_30case_pass_pending_human_review",
    human_review_status: "pending",
    human_review_required: true,
    human_approval_claimed: false,
    candidate_approved: false,
    candidate_activated: false,
    thirty_case_evaluation_executed: input.results.length === 30,
    e2a_student_simulator_canary_executed: false,
    full_36_session_matrix_executed: false,
    case_count: input.results.length,
    initial_cases_dispatched: initialAttempts.filter((attempt) =>
      attempt.generation_dispatched
    ).length,
    initial_schema_valid_count: initialAttempts.filter((attempt) =>
      attempt.runtime_validation.parsed_output !== null
    ).length,
    runtime_accepted_count: input.results.filter((result) =>
      result.execution.final_runtime_acceptance === "accepted"
    ).length,
    accepted_with_review_flags_count: input.results.filter((result) =>
      result.execution.final_runtime_acceptance ===
        "accepted_with_review_flags"
    ).length,
    final_accepted_or_flagged_count: input.results.filter((result) => [
      "accepted",
      "accepted_with_review_flags"
    ].includes(result.execution.final_runtime_acceptance)).length,
    hard_rejected_attempt_count: attempts.filter((attempt) =>
      attempt.runtime_validation.runtime_acceptance === "hard_rejected"
    ).length,
    regeneration_count: regenerationCount,
    regeneration_success_count: input.results.filter((result) =>
      result.execution.regeneration_count === 1 &&
      result.execution.final_runtime_acceptance !== "deterministic_fallback"
    ).length,
    fallback_count: fallbackCount,
    v7_shadow_would_reject_count: input.results.reduce((sum, result) =>
      sum + result.v7_shadow_attempts.filter((attempt) =>
        attempt.v7_would_have_regenerated
      ).length, 0
    ),
    v8_changed_runtime_outcome_count: input.results.reduce((sum, result) =>
      sum + result.v7_shadow_attempts.filter((attempt) =>
        attempt.v8_changed_runtime_outcome
      ).length, 0
    ),
    v7_shadow_case_reject_count: v7RejectedCases.length,
    v7_shadow_v8_accept_case_count: v7RejectedV8AcceptedCases.length,
    v7_shadow_unnecessary_regeneration_avoided_count:
      v7RejectedV8AcceptedCases.length,
    v7_shadow_fallback_avoided_count: 0,
    v7_shadow_fallback_avoided_status:
      "not_claimed_without_a_second_v7_provider_attempt",
    soft_only_regeneration_count: softOnlyRegenerationCount,
    soft_review_flag_count: attempts.reduce((sum, attempt) =>
      sum + attempt.runtime_validation.soft_review_flags.length, 0
    ),
    hard_rejection_evidence_valid:
      input.results.every(hardEvidenceValid),
    provider_control_field_count: controlFieldCount,
    unauthorized_progression_count: unauthorizedProgressionCount,
    invalid_platform_transition_count: input.results.filter((result) =>
      result.execution.platform_transition_executed
    ).length,
    context_coverage_pass_count: contextRequired.filter((result) =>
      result.context_coverage.complete_tenth_turn_context
    ).length,
    context_coverage_required_count: contextRequired.length,
    privacy_finding_count: privacyFindingCount,
    answer_key_finding_count: answerKeyFindingCount,
    student_projection_pass_count: input.results.filter((result) =>
      result.student_projection_passed
    ).length,
    audit_projection_pass_count: input.results.filter((result) =>
      result.audit_projection_passed
    ).length,
    transcript_refresh_pass_count: input.results.filter((result) =>
      result.transcript_refresh_passed
    ).length,
    direct_response_review_finding_count: findingCount("directness_quality"),
    strategy_review_finding_count: findingCount("strategy_quality"),
    distractor_focus_review_finding_count:
      findingCount("anchor_continuity_quality"),
    task_clarification_review_finding_count:
      findingCount("task_clarification_quality"),
    recurrence_review_finding_count: findingCount("recurrence_repair"),
    partial_reasoning_review_finding_count:
      findingCount("partial_reasoning_quality"),
    soft_review_flag_counts_by_category: {
      strategy_adaptation_uncertainty: attempts.reduce((sum, attempt) =>
        sum + attempt.runtime_validation.soft_review_flags.filter((flag) =>
          flag.rule_code === "strategy_adaptation_uncertain"
        ).length, 0),
      semantic_anchor_uncertainty: attempts.reduce((sum, attempt) =>
        sum + attempt.runtime_validation.soft_review_flags.filter((flag) =>
          flag.rule_code === "semantic_anchor_uncertain"
        ).length, 0),
      naturalness_concerns: attempts.reduce((sum, attempt) =>
        sum + attempt.runtime_validation.soft_review_flags.filter((flag) =>
          flag.dimension === "naturalness_and_specificity"
        ).length, 0),
      pedagogical_precision_concerns:
        findingCount("conceptual_precision"),
      partial_reasoning_quality_concerns: attempts.reduce((sum, attempt) =>
        sum + attempt.runtime_validation.soft_review_flags.filter((flag) =>
          flag.rule_code === "partial_reasoning_refinement_uncertain"
        ).length, 0)
    },
    regeneration_stability_threshold: 6,
    provider_usage: usage,
    budget: input.budget,
    budget_within_limits: budgetWithinLimits,
    protected_artifacts_before_sha256:
      input.protectedBefore.aggregate_sha256,
    protected_artifacts_after_sha256:
      input.protectedAfter.aggregate_sha256,
    protected_artifacts_unchanged: protectedUnchanged,
    evaluation_source_before_sha256:
      input.evaluationSourceBefore.aggregate_sha256,
    evaluation_source_after_sha256:
      input.evaluationSourceAfter.aggregate_sha256,
    evaluation_source_unchanged: evaluationSourceUnchanged,
    database_fixture_records_created: input.results.length,
    database_fixture_cleanup_complete: input.fixtureCleanupComplete,
    stop_reason: input.stopReason,
    case_results: input.results.map((result) => ({
      case_id: result.case_id,
      case_number: result.case_number,
      selected_mode: result.selected_mode,
      selected_operation: result.selected_operation,
      final_runtime_acceptance: result.execution.final_runtime_acceptance,
      regeneration_count: result.execution.regeneration_count,
      fallback_used: result.execution.deterministic_fallback_used,
      soft_review_flag_count:
        result.execution.attempts.at(-1)?.runtime_validation
          .soft_review_flags.length ?? 0,
      v7_shadow_would_reject: result.v7_shadow_attempts.some((attempt) =>
        attempt.v7_would_have_regenerated
      )
    }))
  };
}

function buildHumanReviewPacket(input: {
  cases: E2A13TopicDialogueCase[];
  results: E2A13CaseResult[];
}) {
  return {
    packet_version: "e2a13-v8-30-case-human-review-packet-v1",
    review_target: "v8_30_case_runtime_effective_output",
    protocol_hash: E2A13_PROTOCOL_HASH,
    candidate_hash: E2A11_CANDIDATE_HASH,
    review_status: "pending",
    human_review_required: true,
    human_review_completed: false,
    human_reviewer: null,
    human_decision: null,
    human_scores: null,
    no_human_review_fabricated: true,
    provider_output_count: input.results.reduce((sum, result) =>
      sum + result.execution.attempts.length, 0
    ),
    cases: input.cases.map((testCase) => {
      const result = input.results.find((entry) =>
        entry.case_id === testCase.case_id
      );
      return {
        case_id: testCase.case_id,
        protocol_hash: E2A13_PROTOCOL_HASH,
        item_and_distractor_anchor: testCase.distractor_anchor,
        selected_mode: testCase.selected_mode,
        selected_operation: testCase.selected_operation,
        latest_student_message:
          testCase.dialogue_input.latest_student_message,
        safe_visible_history_excerpt:
          testCase.dialogue_input.visible_dialogue_history.slice(-4),
        provider_attempts: result?.execution.attempts.map((attempt) => ({
          attempt_index: attempt.attempt_index,
          regeneration: attempt.attempt_index === 2,
          provider_output: attempt.parsed_output,
          runtime_acceptance:
            attempt.runtime_validation.runtime_acceptance,
          hard_rejection_reasons:
            attempt.runtime_validation.hard_rejection_reasons,
          soft_review_flags:
            attempt.runtime_validation.soft_review_flags,
          pedagogical_rubric: attempt.pedagogical_rubric
        })) ?? [],
        regeneration_history: result ? {
          regeneration_count: result.execution.regeneration_count,
          deterministic_fallback_used:
            result.execution.deterministic_fallback_used
        } : null,
        persisted_visible_response:
          result?.execution.persisted_visible_message ?? null,
        student_projection_result:
          result?.execution.student_projection ?? null,
        audit_projection_result:
          result?.execution.audit_projection ?? null,
        v7_shadow_validator_result:
          result?.v7_shadow_attempts ?? [],
        platform_safety_result: result ? {
          passed: result.platform_safety_passed,
          transition_executed:
            result.execution.platform_transition_executed
        } : null,
        context_coverage_result: result?.context_coverage ?? null,
        privacy_result: result ? {
          privacy_findings: result.privacy_findings,
          answer_key_findings: result.answer_key_findings
        } : null,
        unresolved_human_dimensions: [
          "naturalness",
          "conceptual_precision",
          "student_specificity",
          "directness_quality",
          "strategy_quality",
          "distractor_focus",
          "evidence_elicitation",
          "recurrence_repair",
          "partial_reasoning_refinement"
        ],
        human_review: {
          status: "pending",
          pass: null,
          notes: null,
          critical_failure: null
        }
      };
    })
  };
}

export function validateE2A13Artifacts(runDir: string) {
  const paths = artifactPaths(runDir);
  const required = Object.values(paths);
  const missing = required.filter((filePath) => !existsSync(filePath));
  const jsonlLineCounts = Object.fromEntries(Object.entries(paths)
    .filter(([, filePath]) => filePath.endsWith(".jsonl"))
    .map(([name, filePath]) => [name, readJsonl<unknown>(filePath).length]));
  const secretFindings = required.filter((filePath) => {
    if (!existsSync(filePath)) return false;
    try {
      assertArtifactSafe(readFileSync(filePath, "utf8"));
      return false;
    } catch {
      return true;
    }
  });
  const manifest = missing.length === 0
    ? readJson<Record<string, unknown>>(paths.manifest)
    : null;
  const summary = missing.length === 0
    ? readJson<Record<string, unknown>>(paths.summary)
    : null;
  const protocolHashText = existsSync(paths.protocolHash)
    ? readFileSync(paths.protocolHash, "utf8").trim()
    : null;
  const perResultJsonlArtifacts = [
    "regeneration",
    "persistence",
    "studentProjection",
    "auditProjection",
    "transcript",
    "platformSafety",
    "contextCoverage",
    "privacy"
  ];
  const resultCount = Number(summary?.case_count ?? -1);
  const resultLineCountsValid = jsonlLineCounts.providerCases === 30 &&
    perResultJsonlArtifacts.every((name) =>
      jsonlLineCounts[name] === resultCount
  );
  const attemptArtifactLineCountsValid = [
    "providerOutputs",
    "runtimeValidation",
    "rubricResults",
    "v7Shadow"
  ].every((name) =>
    Number(jsonlLineCounts[name]) >= resultCount &&
      Number(jsonlLineCounts[name]) <= resultCount * 2
  );
  return {
    artifact_validation_version: "e2a13-artifact-validation-v1",
    required_artifact_count: required.length,
    missing_artifacts: missing.map(relative),
    jsonl_line_counts: jsonlLineCounts,
    protocol_hash_file_matches: protocolHashText === E2A13_PROTOCOL_HASH,
    manifest_candidate_hash_matches:
      manifest?.candidate_hash === E2A11_CANDIDATE_HASH,
    manifest_protocol_hash_matches:
      manifest?.protocol_hash === E2A13_PROTOCOL_HASH,
    summary_status_allowed: [
      "v8_30case_pass_pending_human_review",
      "v8_30case_failed",
      "v8_30case_failed_stability",
      "v8_30case_incomplete"
    ].includes(String(summary?.final_status)),
    result_line_counts_valid: resultLineCountsValid,
    attempt_artifact_line_counts_valid: attemptArtifactLineCountsValid,
    secret_or_hidden_reasoning_findings: secretFindings.map(relative),
    passed: missing.length === 0 &&
      protocolHashText === E2A13_PROTOCOL_HASH &&
      manifest?.candidate_hash === E2A11_CANDIDATE_HASH &&
      manifest?.protocol_hash === E2A13_PROTOCOL_HASH &&
      resultCount >= 0 && resultCount <= 30 &&
      resultLineCountsValid &&
      attemptArtifactLineCountsValid &&
      secretFindings.length === 0
  };
}

function newRunId() {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/gu, "")
    .slice(0, 14);
  return `e2a13_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function acquireRunnerLock(live: boolean, runId: string) {
  if (!live) return () => undefined;
  mkdirSync(E2A13_ARTIFACT_ROOT, { recursive: true });
  const descriptor = openSync(RUNNER_LOCK_PATH, "wx", 0o600);
  writeFileSync(descriptor, `${JSON.stringify({
    pid: process.pid,
    run_id: runId,
    created_at: new Date().toISOString()
  })}\n`, "utf8");
  closeSync(descriptor);
  return () => {
    if (existsSync(RUNNER_LOCK_PATH)) unlinkSync(RUNNER_LOCK_PATH);
  };
}

export async function executeE2A13Evaluation(input: {
  live: boolean;
  provider?: LlmProvider;
  artifactRoot?: string;
  runId?: string;
}) {
  const candidate = evaluateE2A11Candidate();
  const budget = resolveE2A13Budget();
  const cases = e2a13HeldOutCases();
  const preflight = await inspectE2A13Preflight({
    requireLiveEnvironment: input.live,
    requireCleanTrackedTree: false,
    artifactRoot: input.artifactRoot
  });
  if (!preflight.passed) {
    throw new Error(`e2a13_preflight_failed:${preflight.blockers.join(",")}`);
  }
  if (input.live) assertE2A13ProtocolFrozen();
  const runId = input.runId ?? newRunId();
  const root = input.artifactRoot ?? E2A13_ARTIFACT_ROOT;
  const runDir = path.join(root, runId);
  if (existsSync(runDir)) throw new Error("e2a13_run_already_exists");
  mkdirSync(runDir, { recursive: true });
  const releaseLock = acquireRunnerLock(input.live, runId);
  const paths = artifactPaths(runDir);
  const protectedBefore = e2a13ProtectedArtifactSnapshot();
  const evaluationSourceBefore = e2a13EvaluationSourceSnapshot();
  const buildInfo = resolveApplicationBuildInfo(input.live ? {} : {
    artifactPath: path.join(
      os.tmpdir(),
      `e2a13-no-live-build-info-${randomBytes(4).toString("hex")}.json`
    ),
    allowGitFallback: true
  });
  if (!buildInfo.ok) {
    releaseLock();
    throw new Error(buildInfo.code);
  }
  const compilation = await compileE2A11CandidateRequestsNoNetwork(
    paths.requestCompilation
  );
  const overlap = analyzeE2A13ProtocolOverlap();
  const modelConfig = candidate.full_candidate.roles.topic_dialogue_agent;
  const provider = input.provider ?? new OpenAIResponsesProvider();
  const dispatchCommit = buildInfo.info.application_git_commit;
  const manifestBase = {
    manifest_version: "e2a13-v8-30-case-bounded-provider-manifest-v1",
    run_id: runId,
    evaluation_status: "running",
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    protocol_version: E2A13_PROTOCOL_VERSION,
    protocol_hash: E2A13_PROTOCOL_HASH,
    dispatch_git_commit: dispatchCommit,
    dispatch_git_commit_source:
      buildInfo.info.application_git_commit_source,
    evaluator_version: E2A13_EVALUATOR_VERSION,
    evaluator_source_sha256: evaluationSourceBefore.aggregate_sha256,
    approved_v2_hash: candidate.approved_v2_hash,
    failed_v4_hash: E2A5_FAILED_V4_HASH,
    failed_v5_hash: E2A6_CANDIDATE_HASH,
    failed_v6_hash: E2A7_CANDIDATE_HASH,
    failed_v7_hash: E2A9_CANDIDATE_HASH,
    candidate_approved: false,
    candidate_activated: false,
    provider: input.live ? "openai" : "injected_no_live_provider",
    model: modelConfig.model_name,
    reasoning_effort: modelConfig.reasoning_effort,
    max_output_tokens: modelConfig.max_output_tokens,
    provider_timeout_ms:
      candidate.full_candidate.runtime_policy.provider_timeout_ms,
    provider_case_concurrency: 1,
    adapter_version: input.live
      ? OPENAI_RESPONSES_ADAPTER_VERSION
      : "injected-test-provider",
    runtime_validator_version: TOPIC_DIALOGUE_RUNTIME_VALIDATOR_V2_VERSION,
    validation_policy_version: TOPIC_DIALOGUE_VALIDATION_POLICY_V2_VERSION,
    pedagogical_rubric_version:
      TOPIC_DIALOGUE_PEDAGOGICAL_RUBRIC_V1_VERSION,
    regeneration_policy_version:
      TOPIC_DIALOGUE_REGENERATION_POLICY_V2_VERSION,
    review_flag_schema_version:
      TOPIC_DIALOGUE_REVIEW_FLAG_SCHEMA_V1_VERSION,
    candidate_runtime_version:
      TOPIC_DIALOGUE_CANDIDATE_RUNTIME_V2_VERSION,
    operation_prompt_family_version:
      TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_VERSION,
    operation_prompt_family_hash:
      TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_HASH,
    progression_prompt_family_version:
      TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_VERSION,
    progression_prompt_family_hash:
      TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_HASH,
    budget,
    preflight,
    protected_artifacts_before: protectedBefore,
    human_review_required: true,
    human_review_status: "pending",
    thirty_case_evaluation_executed: false,
    e2a_student_simulator_canary_executed: false,
    full_36_session_matrix_executed: false,
    started_at: new Date().toISOString()
  };
  writeJson(paths.manifest, manifestBase);
  writeJson(paths.protocol, e2a13HeldOutProtocolSnapshot());
  writeFileSync(paths.protocolHash, `${E2A13_PROTOCOL_HASH}\n`, "utf8");
  writeJson(paths.overlap, overlap);
  writeJson(paths.candidateManifest, {
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    candidate_manifest_path: relative(E2A11_CANDIDATE_PATH),
    full_candidate: candidate.full_candidate,
    candidate_approved: false,
    candidate_activated: false
  });
  writeJson(paths.candidateDelta, {
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    approved_v2_hash: candidate.approved_v2_hash,
    failed_v7_hash: candidate.failed_v7_hash,
    exact_delta_paths_from_v7: candidate.exact_delta_paths_from_v7,
    exact_delta_paths_from_approved_v2:
      candidate.exact_delta_paths_from_approved_v2,
    inherited_role_hashes: candidate.inherited_role_hashes,
    unrelated_role_configuration_changed: false,
    prompts_unchanged_from_v7: candidate.v7_prompt_metadata_unchanged,
    schemas_unchanged_from_v7: candidate.v7_schema_metadata_unchanged
  });
  writeJson(paths.runtimePolicy, {
    validator_version: TOPIC_DIALOGUE_RUNTIME_VALIDATOR_V2_VERSION,
    validation_policy_version: TOPIC_DIALOGUE_VALIDATION_POLICY_V2_VERSION,
    runtime_acceptance_values: [
      "accepted",
      "accepted_with_review_flags",
      "hard_rejected"
    ],
    hard_rejection_only_regeneration: true,
    maximum_regenerations_per_case: 1,
    second_hard_rejection_uses_deterministic_fallback: true,
    operation_output_schema_versions:
      TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS,
    progression_output_schema_versions:
      TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS,
    operation_fallback_version: TOPIC_DIALOGUE_OPERATION_FALLBACK_VERSION,
    progression_fallback_version: TOPIC_DIALOGUE_MODE_FALLBACK_VERSION,
    text_hard_rejection_requires_evidence_span: true,
    structured_contradiction_may_use_structured_evidence: true
  });
  writeJson(paths.rubricPolicy, {
    rubric_version: TOPIC_DIALOGUE_PEDAGOGICAL_RUBRIC_V1_VERSION,
    evaluated_separately_from_runtime_acceptance: true,
    may_mutate_runtime_acceptance: false,
    may_trigger_regeneration: false,
    may_trigger_fallback: false,
    human_review_required: true,
    dimensions: [
      "directness_quality",
      "strategy_quality",
      "naturalness_and_specificity",
      "conceptual_precision",
      "student_specificity",
      "evidence_elicitation",
      "recurrence_repair",
      "partial_reasoning_quality"
    ]
  });
  initializeJsonlArtifacts(paths);
  if (!compilation.artifact.all_17_roles_compile ||
    compilation.artifact.network_request_count !== 0) {
    releaseLock();
    throw new Error("e2a13_request_compilation_gate_failed");
  }

  const prisma = new PrismaClient();
  let fixture: Fixture | null = null;
  let fixtureCleanupComplete = false;
  let executionResult: Awaited<ReturnType<typeof executeCases>> = {
    results: [],
    stop_reason: null
  };
  try {
    fixture = await createE2A13Fixture(prisma, runId, cases);
    executionResult = await executeCases({
      prisma,
      fixture,
      cases,
      provider,
      modelConfig,
      timeoutMs: candidate.full_candidate.runtime_policy.provider_timeout_ms,
      budget,
      paths,
      runId
    });
  } finally {
    if (fixture) {
      try {
        await cleanupE2A13Fixture(prisma, fixture);
        fixtureCleanupComplete = true;
      } catch {
        fixtureCleanupComplete = false;
      }
    }
    await prisma.$disconnect();
    releaseLock();
  }
  const protectedAfter = e2a13ProtectedArtifactSnapshot();
  const evaluationSourceAfter = e2a13EvaluationSourceSnapshot();
  const summary = buildSummary({
    results: executionResult.results,
    stopReason: executionResult.stop_reason,
    budget,
    protectedBefore,
    protectedAfter,
    evaluationSourceBefore,
    evaluationSourceAfter,
    fixtureCleanupComplete
  });
  const review = buildHumanReviewPacket({
    cases,
    results: executionResult.results
  });
  writeJson(paths.providerUsage, summary.provider_usage);
  writeJson(paths.humanReviewPacket, review);
  writeJson(paths.summary, summary);
  writeJson(paths.manifest, {
    ...manifestBase,
    evaluation_status: summary.final_status,
    completed_at: new Date().toISOString(),
    protected_artifacts_after: protectedAfter,
    protected_artifacts_unchanged:
      summary.protected_artifacts_unchanged,
    provider_adapter_attempt_count:
      summary.provider_usage.provider_adapter_attempts,
    generation_call_count:
      summary.provider_usage.generation_provider_calls,
    metadata_only_request_count:
      summary.provider_usage.metadata_only_requests,
    input_tokens: summary.provider_usage.input_tokens,
    output_tokens: summary.provider_usage.output_tokens,
    reasoning_tokens: summary.provider_usage.reasoning_tokens,
    estimated_cost_usd: summary.provider_usage.estimated_cost_usd,
    cost_status: summary.provider_usage.pricing_available
      ? "complete_pricing_available"
      : "pricing_unavailable_or_incomplete",
    database_fixture_cleanup_complete: fixtureCleanupComplete,
    thirty_case_evaluation_executed: summary.thirty_case_evaluation_executed,
    artifact_paths: Object.fromEntries(
      Object.entries(paths).map(([key, value]) => [key, relative(value)])
    )
  });
  const artifactValidation = validateE2A13Artifacts(runDir);
  if (!artifactValidation.passed) {
    throw new Error(
      `e2a13_artifact_validation_failed:${JSON.stringify({
        artifact_validation: artifactValidation,
        final_status: summary.final_status,
        stop_reason: summary.stop_reason
      })}`
    );
  }
  writeJson(path.join(root, "latest-run.json"), {
    run_id: runId,
    run_directory: relative(runDir),
    final_status: summary.final_status,
    candidate_hash: E2A11_CANDIDATE_HASH,
    protocol_hash: E2A13_PROTOCOL_HASH,
    dispatch_git_commit: dispatchCommit,
    updated_at: new Date().toISOString()
  });
  return {
    runId,
    runDir,
    paths,
    results: executionResult.results,
    summary,
    review,
    artifactValidation
  };
}

export async function executeLiveE2A13Evaluation() {
  const credential = resolveOpenAICredentialFromEnv(process.env);
  if (!credential.ok) throw new Error(credential.code);
  return withResolvedOpenAICredential(
    credential.credential,
    () => executeE2A13Evaluation({ live: true })
  );
}

export function loadE2A13Evaluation(
  runId?: string,
  artifactRoot = E2A13_ARTIFACT_ROOT
) {
  const latestPath = path.join(artifactRoot, "latest-run.json");
  if (!runId && !existsSync(latestPath)) {
    throw new Error("e2a13_latest_run_missing");
  }
  const latest = runId ? {
    run_id: runId,
    run_directory: path.join(artifactRoot, runId)
  } : readJson<{ run_id: string; run_directory: string }>(latestPath);
  const runDir = path.isAbsolute(latest.run_directory)
    ? latest.run_directory
    : path.join(process.cwd(), latest.run_directory);
  if (!existsSync(runDir)) throw new Error("e2a13_run_missing");
  return {
    latest,
    run_directory: runDir,
    manifest: readJson(path.join(runDir, "evaluation-manifest.json")),
    summary: readJson(path.join(runDir, "evaluation-summary.json")),
    human_review_packet: readJson(
      path.join(runDir, "human-review-packet.json")
    ),
    provider_usage: readJson(path.join(runDir, "provider-usage.json")),
    artifact_validation: validateE2A13Artifacts(runDir)
  };
}

export function temporaryE2A13ArtifactRoot() {
  return path.join(
    os.tmpdir(),
    `e2a13-v8-30-case-evaluation-${randomBytes(5).toString("hex")}`
  );
}
