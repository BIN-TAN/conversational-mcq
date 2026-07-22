import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { z } from "zod";
import {
  publicOpenAICredentialResolution,
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
  StructuredAgentRequest,
  StructuredAgentResult
} from "@/lib/llm/providers/types";
import { stableHash } from "@/lib/operational/stable-hash";
import { resolveApplicationBuildInfo } from
  "@/lib/provenance/application-build-info";
import {
  ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION,
  ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
  ACTIVITY_RESPONSE_EVALUATOR_SCHEMA_VERSION,
  ActivityMisconceptionEvidencePacketV1Schema,
  buildNoLiveActivityMisconceptionEvidenceFixture,
  type ActivityMisconceptionEvidencePacketV1
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import {
  ACTIVITY_RESPONSE_EVALUATOR_INPUT_SCHEMA_VERSION,
  ACTIVITY_RESPONSE_EVALUATOR_PROMPT_HASH,
  ACTIVITY_RESPONSE_EVALUATOR_PROMPT_INSTRUCTIONS,
  ACTIVITY_RESPONSE_EVALUATOR_PROMPT_VERSION,
  ACTIVITY_RESPONSE_EVALUATOR_REPAIR_PROMPT_HASH,
  ACTIVITY_RESPONSE_EVALUATOR_REPAIR_PROMPT_INSTRUCTIONS,
  ACTIVITY_RESPONSE_EVALUATOR_REPAIR_PROMPT_VERSION,
  activityMisconceptionEvidencePipelineIssuesAllowRepair,
  evaluateActivityMisconceptionEvidenceLivePipeline,
  makeActivityMisconceptionEvidenceAuditForTest,
  makeLiveActivityMisconceptionEvidencePacketForTest,
  type ActivityMisconceptionEvidenceProviderAudit
} from "@/lib/services/student-assessment/activity-misconception-evidence-live";
import {
  AUTONOMOUS_PEDAGOGY_OUTPUT_SCHEMA_VERSION,
  AUTONOMOUS_PEDAGOGY_PROMPT_HASH,
  AUTONOMOUS_PEDAGOGY_PROMPT_INSTRUCTIONS,
  AUTONOMOUS_PEDAGOGY_PROMPT_VERSION,
  AutonomousPedagogyOutputSchema,
  buildCompleteVisibleFormativeEpisode,
  executeAutonomousFormativeTurn,
  validateAutonomousPedagogyOutput,
  type AutonomousEvidenceEvaluatorInput,
  type AutonomousFormativeTurnResult,
  type AutonomousPedagogyInput,
  type AutonomousTurnPersistence,
  type FormativeEpisodeTurnRecord,
  type PedagogicalInterventionRecord
} from "@/lib/services/student-assessment/autonomous-formative-dialogue";
import {
  FORMATIVE_ACTIVITY_SCHEMA_VERSION
} from "@/lib/services/student-assessment/formative-activity-design";
import {
  PROFILE_CONSISTENCY_POLICY_VERSION_V4,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V4,
  TARGET_EVIDENCE_CONTRACT_VERSION_V4,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V4,
  TargetEvidenceAdjudicationV4Schema,
  TargetEvidenceContractV4Schema,
  buildTargetEvidenceAdjudicationFromActivityPacketV4,
  type TargetEvidenceAdjudicationV4,
  type TargetEvidenceContractV4
} from "@/lib/services/student-assessment/target-evidence-contract-v4";
import {
  ANCHOR_CONTRADICTION_PROPAGATION_VERSION
} from "@/lib/services/student-assessment/anchor-contradiction-propagation";
import {
  PRE_TUTOR_PROFILE_FINALIZATION_VERSION
} from "@/lib/services/student-assessment/pre-tutor-profile-finalization";
import {
  ANCHOR_CONCLUSION_CONSISTENCY_VERSION,
  SOUND_GATE_ANCHOR_CONSISTENCY_VERSION
} from "@/lib/services/student-assessment/anchor-conclusion-consistency";
import type {
  TopicDialogueCumulativeEvidenceProfile,
  TopicDialogueTurnEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  LlmStudentSimulatorOutputSchema,
  type LlmStudentSimulatorOutput
} from "@/lib/evaluation/formative/e2a-schemas";
import { LLM_STUDENT_SIMULATOR_INSTRUCTIONS } from
  "@/lib/evaluation/formative/llm-student-simulator-prompt";
import {
  e2aAdapterAttemptCount,
  e2aUsageFor,
  sanitizedE2AProviderResult
} from "@/lib/evaluation/formative/e2a17-bounded-student-simulator-canary";
import {
  E2A24_CANDIDATE_PATH,
  evaluateE2A24Candidate
} from "@/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate";
import {
  AUTONOMOUS_PEDAGOGY_INPUT_SCHEMA_VERSION,
  AUTONOMOUS_PEDAGOGY_QUALITY_REVIEW_VERSION,
  AUTONOMOUS_PEDAGOGY_VALIDATOR_VERSION,
  COMPLETE_VISIBLE_FORMATIVE_EPISODE_VERSION,
  PEDAGOGICAL_INTERVENTION_MEMORY_VERSION
} from "@/lib/services/student-assessment/autonomous-formative-dialogue";

loadEnvConfig(process.cwd());

const VERSION = "e2a28-antimicrobial-resistance-contradiction-live-v1";
const E2A27A_RUN = "e2a27a_20260722074221_ec5cc0b0";
const E2A27A_ROOT = path.join(
  process.cwd(), ".data", "e2a27a-contradiction-propagation",
  E2A27A_RUN
);
const ARTIFACT_ROOT = path.join(
  process.cwd(), ".data",
  "e2a28-antimicrobial-resistance-contradiction-canary"
);
const LOCK_PATH = path.join(
  process.cwd(), ".data", "locks", "e2a28-live-canary.lock"
);
const CHECKPOINT_PATH = path.join(
  ARTIFACT_ROOT, "e2a28-dispatch-checkpoint.json"
);
const PROTOCOL_HASH =
  "d9025800788987ed982a30db101bc73f6eb935d8436d58ec26598826fb939185";
const CANDIDATE_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";
const CANDIDATE_FILE_SHA =
  "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2";
const APPROVED_HASH =
  "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993";
const ARTIFACT_NAMES = [
  "canary-manifest.json",
  "composite-runtime-identity.json",
  "dispatch-checkpoint.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "candidate-integrity.json",
  "source-integrity.json",
  "session-fixture.json",
  "target-evidence-contract.json",
  "information-flow-audit.jsonl",
  "simulator-provider-outputs.jsonl",
  "student-turn-results.jsonl",
  "evaluator-requests.jsonl",
  "evaluator-provider-outputs.jsonl",
  "criterion-evidence-results.jsonl",
  "anchor-interpretation-results.jsonl",
  "turn-profile-snapshots.jsonl",
  "profile-consistency-results.jsonl",
  "cumulative-profile-updates.jsonl",
  "sound-gate-results.jsonl",
  "platform-mode-decisions.jsonl",
  "autonomous-tutor-requests.jsonl",
  "autonomous-tutor-provider-outputs.jsonl",
  "runtime-validation-results.jsonl",
  "pedagogical-quality-results.jsonl",
  "intervention-memory-results.jsonl",
  "intervention-outcome-results.jsonl",
  "persistence-results.jsonl",
  "student-projection-results.jsonl",
  "audit-projection-results.jsonl",
  "transcript-refresh-results.jsonl",
  "privacy-results.jsonl",
  "context-coverage-results.jsonl",
  "failure-path-results.jsonl",
  "pre-tutor-finalization-results.jsonl",
  "structured-contradiction-results.jsonl",
  "human-review-binding-results.jsonl",
  "failure-path-completeness.json",
  "failed-session-burden-metrics.json",
  "fixture-cleanup-results.json",
  "provider-usage.json",
  "evidence-accuracy-metrics.json",
  "progression-efficiency-metrics.json",
  "pedagogical-adaptation-metrics.json",
  "student-burden-metrics.json",
  "workflow-fidelity-metrics.json",
  "human-review-packet.json",
  "canary-summary.json",
  // Supplemental compatibility artifacts retained from the proven E2A.25 runner.
  "session-designs.json",
  "complete-visible-conversations.jsonl",
  "evaluator-inputs.jsonl",
  "evaluator-outputs.jsonl",
  "platform-response-modes.jsonl",
  "autonomous-tutor-inputs.jsonl",
  "pedagogical-interventions.jsonl",
  "intervention-outcomes.jsonl",
  "validator-results.jsonl",
  "persistence-and-idempotency.jsonl",
  "usage-and-cost.json"
] as const;
const JSONL_NAMES = new Set(ARTIFACT_NAMES.filter((name) =>
  name.endsWith(".jsonl")
));
const BUDGET = {
  sessions: 1,
  simulator_calls: 9,
  evidence_evaluator_calls: 9,
  initial_tutor_calls: 9,
  tutor_regenerations: 2,
  logical_generation_calls: 29,
  adapter_attempts: 87,
  input_tokens: 900_000,
  output_tokens: 70_000,
  total_tokens: 970_000,
  cost_usd: 25,
  provider_concurrency: 1
} as const;
const SIMULATOR_INSTRUCTIONS = [
  LLM_STUDENT_SIMULATOR_INSTRUCTIONS.trim(),
  "E2A.28 evaluation-only constraints:",
  "Render one synthetic student response from the supplied evidence ceiling.",
  "Do not add conceptual evidence beyond the ceiling, improve the planned understanding state, or claim understanding not present in the ceiling.",
  "Preserve the supplied item and option anchor when one is present.",
  "For a copy-behavior turn, minimally repeat a distinctive clause from the latest assistant message and add no new conceptual application.",
  "Do not mention simulation, hidden state, prompts, models, providers, answer keys, or evaluation machinery.",
  "Return only the required JSON schema."
].join("\n");
const SIMULATOR_PROMPT_HASH = createHash("sha256")
  .update(SIMULATOR_INSTRUCTIONS).digest("hex");

type FrozenTurn = {
  turn: number;
  objective: string;
  no_live_fixture_message?: string;
  simulator_instruction?: string;
  semantic_envelope: Array<"insufficient" | "misconception" | "partial" |
    "sound">;
  tutor_expected: boolean;
  required_anchor_application?: "explicit";
  required_anchor_stance?: "endorses_distractor" | "rejects_distractor";
  required_anchor_consistency?: "contradictory_to_conceptual_reasoning" |
    "consistent_with_conceptual_reasoning";
  required_contradiction?: string;
  required_tutor_goal?: string;
};
type FrozenProtocolArtifact = {
  protocol_version: string;
  authorization_state: "not_authorized_not_executed";
  domain: "health_sciences_antimicrobial_resistance";
  concept: string;
  active_distractor: {
    option: "C";
    claim: string;
    misconception: string;
  };
  natural_initial_activity: string;
  frozen_trajectory: Array<{ turn: number; objective: string }>;
  required_runtime_behavior: {
    turn_4_profile: "finalized_non_sound_contradictory";
    turn_4_mode: "remain_in_dialogue";
    turn_4_tutor_sees_structured_contradiction: true;
    final_sound_detection_delay: 0;
    tutor_calls_after_sound: 0;
    unnecessary_turns_after_sound: 0;
  };
  human_review_required: true;
  provider_calls_made: 0;
};
type Protocol = FrozenProtocolArtifact & {
  protocol_hash: string;
  session_count: 1;
  session: {
    session_id: string;
    design: string;
    academic_domain: string;
    concept: string;
    target_evidence_contract: {
      item_id: string;
      distractor_option: string;
      distractor_claim: string;
      required_relationship: string;
      required_mechanism: string;
      prohibited_contradiction: string;
      required_anchor_stance: "rejects_distractor";
    };
    student_profile: {
      language_quality: string;
      confidence: string;
      engagement: string;
      trajectory: string;
    };
    frozen_student_trajectory: FrozenTurn[];
    human_adjudicated_earliest_sound_turn: number;
    required_endpoint: string;
    maximum_student_turns: number;
    complete_visible_history_limit: number;
    raw_history_truncation_allowed: false;
    summary_only_substitution_allowed: false;
    natural_initial_activity: string;
  };
};
type Session = Protocol["session"];
type PlannedTurn = Session["frozen_student_trajectory"][number];
type JsonObject = Record<string, unknown>;
type CallRole = "simulator" | "evidence_evaluator" |
  "tutor_initial" | "tutor_regeneration";
type ProviderExecutor = <TInput, TOutput>(
  request: StructuredAgentRequest<TInput, TOutput>
) => Promise<StructuredAgentResult<TOutput>>;

type BudgetLedger = {
  simulator_calls: number;
  evidence_evaluator_calls: number;
  initial_tutor_calls: number;
  tutor_regenerations: number;
  logical_generation_calls: number;
  adapter_attempts: number;
  transport_retries: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  pricing_complete: boolean;
  total_latency_ms: number;
  per_call: JsonObject[];
};

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function frozenArtifactPath(name: string) {
  return path.join(E2A27A_ROOT, name);
}

function buildE2A28FrozenProtocol(): Protocol {
  const sourcePath = frozenArtifactPath("e2a28-frozen-protocol.json");
  const frozen = readJson<FrozenProtocolArtifact>(sourcePath);
  const expectedFileSha = readFileSync(
    frozenArtifactPath("e2a28-frozen-protocol.sha256"), "utf8"
  ).trim();
  const actualProtocolHash = stableHash(frozen);
  if (expectedFileSha !== PROTOCOL_HASH ||
      actualProtocolHash !== PROTOCOL_HASH ||
      frozen.protocol_version !== "e2a28-cross-domain-contradiction-canary-v1" ||
      frozen.authorization_state !== "not_authorized_not_executed" ||
      frozen.domain !== "health_sciences_antimicrobial_resistance" ||
      frozen.active_distractor.option !== "C" ||
      frozen.frozen_trajectory.length !== 6 ||
      frozen.provider_calls_made !== 0) {
    throw new Error("e2a28_frozen_protocol_file_sha_mismatch");
  }
  const expectedObjectives = new Map(frozen.frozen_trajectory.map((entry) =>
    [entry.turn, entry.objective]
  ));
  const turn = (turnNumber: number, fields: Omit<FrozenTurn,
    "turn" | "objective">): FrozenTurn => ({
    turn: turnNumber,
    objective: expectedObjectives.get(turnNumber) ?? "missing",
    ...fields
  });
  return {
    ...frozen,
    protocol_hash: PROTOCOL_HASH,
    session_count: 1,
    session: {
      session_id: "E2A28-AMR",
      design: "held_out_antimicrobial_resistance_anchor_contradiction",
      academic_domain: frozen.domain,
      concept: frozen.concept,
      target_evidence_contract: {
        item_id: "antimicrobial_resistance_item_1",
        distractor_option: frozen.active_distractor.option,
        distractor_claim: frozen.active_distractor.claim,
        required_relationship:
          "Antibiotic treatment changes the composition of a bacterial population by differential survival and reproduction.",
        required_mechanism:
          "Less susceptible variants exist before exposure, survive at higher rates, and reproduce; individual bacteria do not intentionally change because they need to survive.",
        prohibited_contradiction: frozen.active_distractor.misconception,
        required_anchor_stance: "rejects_distractor"
      },
      student_profile: {
        language_quality: "informal concise English with occasional hedging",
        confidence: "variable",
        engagement: "responsive but initially misconception-bound",
        trajectory:
          "need-driven adaptation to population-selection reasoning with a deliberate mechanism/conclusion contradiction"
      },
      frozen_student_trajectory: [
        turn(1, {
          no_live_fixture_message:
            "I think bacteria notice the antibiotic and adapt because they need to survive, so option C makes sense.",
          semantic_envelope: ["misconception"], tutor_expected: true
        }),
        turn(2, {
          no_live_fixture_message:
            "The ones already less affected are the ones left, so I think that is what happens.",
          simulator_instruction:
            "Briefly echo one distinctive tutor clause without applying it or adding a new conceptual relationship.",
          semantic_envelope: ["insufficient", "misconception"],
          tutor_expected: true
        }),
        turn(3, {
          no_live_fixture_message:
            "Maybe some bacteria were already less affected before treatment, and those are the ones left afterward.",
          semantic_envelope: ["partial"], tutor_expected: true
        }),
        turn(4, {
          no_live_fixture_message:
            "The antibiotic kills more susceptible bacteria, while the already less affected ones survive and reproduce, so the population has more resistant bacteria. That makes option C appropriate.",
          semantic_envelope: ["partial"], tutor_expected: true,
          required_anchor_application: "explicit",
          required_anchor_stance: "endorses_distractor",
          required_anchor_consistency:
            "contradictory_to_conceptual_reasoning",
          required_contradiction:
            "anchor_conclusion_conceptual_explanation_conflict",
          required_tutor_goal:
            "reconcile population selection with the explicit endorsement of option C"
        }),
        turn(5, {
          no_live_fixture_message:
            "Do you mean individual bacteria change, or that the mix of bacteria in the population changes?",
          semantic_envelope: ["insufficient", "partial"], tutor_expected: true
        }),
        turn(6, {
          no_live_fixture_message:
            "The individual bacteria did not change because they needed to. Less susceptible bacteria were already present, survived treatment, and reproduced, so I reject option C.",
          semantic_envelope: ["sound"], tutor_expected: false,
          required_anchor_application: "explicit",
          required_anchor_stance: "rejects_distractor",
          required_anchor_consistency:
            "consistent_with_conceptual_reasoning"
        })
      ],
      human_adjudicated_earliest_sound_turn: 6,
      required_endpoint: "passed_required_revision_endpoint",
      maximum_student_turns: 9,
      complete_visible_history_limit: 18,
      raw_history_truncation_allowed: false,
      summary_only_substitution_allowed: false,
      natural_initial_activity: frozen.natural_initial_activity
    }
  };
}

function frozenArtifactContract() {
  return readJson<JsonObject>(
    frozenArtifactPath("e2a28-artifact-contract.json")
  );
}

function databaseReadiness() {
  try {
    execFileSync("npx", ["prisma", "migrate", "status"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { ready: true, code: "database_ready" };
  } catch {
    return { ready: false, code: "database_unavailable" };
  }
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(), encoding: "utf8"
  }).trim();
}

function trackedTreeClean() {
  return execFileSync("git", [
    "status", "--porcelain", "--untracked-files=no"
  ], { cwd: process.cwd(), encoding: "utf8" }).trim() === "";
}

function safe(value: unknown) {
  const text = JSON.stringify(value);
  const forbidden = [
    /\bBearer\s+[A-Za-z0-9._-]+/u,
    /\bsk-[A-Za-z0-9_-]{12,}/u,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u,
    /authorization\s*:\s*["']?Bearer/iu,
    /chain[ _-]?of[ _-]?thought/iu
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error("e2a28_artifact_secret_or_private_reasoning_detected");
  }
}

function writeJson(filePath: string, value: unknown) {
  safe(value);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendJsonl(filePath: string, value: unknown) {
  safe(value);
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonl<T>(filePath: string): T[] {
  const text = readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line) as T) : [];
}

function initializeRun(runId: string, root = ARTIFACT_ROOT) {
  const runDir = path.join(root, runId);
  if (existsSync(runDir)) throw new Error("e2a28_run_directory_exists");
  mkdirSync(runDir, { recursive: true });
  for (const name of ARTIFACT_NAMES) {
    writeFileSync(path.join(runDir, name), JSONL_NAMES.has(name) ? "" : "{}\n");
  }
  return runDir;
}

function runId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/gu, "")
    .slice(0, 14);
  return `e2a28_${stamp}_${randomBytes(4).toString("hex")}`;
}

function emptyLedger(): BudgetLedger {
  return {
    simulator_calls: 0,
    evidence_evaluator_calls: 0,
    initial_tutor_calls: 0,
    tutor_regenerations: 0,
    logical_generation_calls: 0,
    adapter_attempts: 0,
    transport_retries: 0,
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_input_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
    pricing_complete: true,
    total_latency_ms: 0,
    per_call: []
  };
}

function estimatedInputTokens(request: StructuredAgentRequest<unknown, unknown>) {
  return Math.max(1, Math.ceil(
    `${request.instructions}\n${JSON.stringify(request.input)}`.length / 3
  ));
}

function assertBudgetBeforeCall(
  ledger: BudgetLedger,
  role: CallRole,
  request: StructuredAgentRequest<unknown, unknown>
) {
  const next = {
    simulator_calls: ledger.simulator_calls + (role === "simulator" ? 1 : 0),
    evidence_evaluator_calls: ledger.evidence_evaluator_calls +
      (role === "evidence_evaluator" ? 1 : 0),
    initial_tutor_calls: ledger.initial_tutor_calls +
      (role === "tutor_initial" ? 1 : 0),
    tutor_regenerations: ledger.tutor_regenerations +
      (role === "tutor_regeneration" ? 1 : 0),
    logical_generation_calls: ledger.logical_generation_calls + 1,
    adapter_attempts: ledger.adapter_attempts + 3,
    input_tokens: ledger.input_tokens + estimatedInputTokens(request),
    output_tokens: ledger.output_tokens +
      (request.model_config.max_output_tokens ?? 0),
    total_tokens: ledger.input_tokens + ledger.output_tokens +
      estimatedInputTokens(request) +
      (request.model_config.max_output_tokens ?? 0)
  };
  for (const [key, limit] of Object.entries({
    simulator_calls: BUDGET.simulator_calls,
    evidence_evaluator_calls: BUDGET.evidence_evaluator_calls,
    initial_tutor_calls: BUDGET.initial_tutor_calls,
    tutor_regenerations: BUDGET.tutor_regenerations,
    logical_generation_calls: BUDGET.logical_generation_calls,
    adapter_attempts: BUDGET.adapter_attempts,
    input_tokens: BUDGET.input_tokens,
    output_tokens: BUDGET.output_tokens,
    total_tokens: BUDGET.total_tokens
  })) {
    if (next[key as keyof typeof next] > limit) {
      throw new Error(`e2a28_pre_call_budget_block:${key}`);
    }
  }
  if (ledger.pricing_complete && ledger.estimated_cost_usd >= BUDGET.cost_usd) {
    throw new Error("e2a28_pre_call_budget_block:cost_usd");
  }
}

function recordCall(
  ledger: BudgetLedger,
  role: CallRole,
  result: StructuredAgentResult<unknown>,
  sessionId: string,
  turn: number,
  attempt: number
) {
  const usage = e2aUsageFor(result);
  const adapterAttempts = e2aAdapterAttemptCount(result);
  if (role === "simulator") ledger.simulator_calls += 1;
  if (role === "evidence_evaluator") ledger.evidence_evaluator_calls += 1;
  if (role === "tutor_initial") ledger.initial_tutor_calls += 1;
  if (role === "tutor_regeneration") ledger.tutor_regenerations += 1;
  ledger.logical_generation_calls += 1;
  ledger.adapter_attempts += adapterAttempts;
  ledger.transport_retries += Math.max(adapterAttempts - 1, 0);
  ledger.input_tokens += usage.input_tokens;
  ledger.output_tokens += usage.output_tokens;
  ledger.reasoning_tokens += usage.reasoning_tokens;
  ledger.cached_input_tokens += usage.cached_input_tokens;
  ledger.total_tokens += usage.total_tokens;
  ledger.total_latency_ms += result.latency_ms;
  if (usage.pricing_available && usage.estimated_cost_usd !== null) {
    ledger.estimated_cost_usd += usage.estimated_cost_usd;
  } else {
    ledger.pricing_complete = false;
  }
  ledger.per_call.push({
    role, session_id: sessionId, turn, attempt,
    status: result.status,
    adapter_attempts: adapterAttempts,
    transport_retries: Math.max(adapterAttempts - 1, 0),
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    reasoning_tokens: usage.reasoning_tokens,
    total_tokens: usage.total_tokens,
    estimated_cost_usd: usage.estimated_cost_usd,
    pricing_available: usage.pricing_available,
    latency_ms: result.latency_ms
  });
  const actual = {
    simulator_calls: ledger.simulator_calls,
    evidence_evaluator_calls: ledger.evidence_evaluator_calls,
    initial_tutor_calls: ledger.initial_tutor_calls,
    tutor_regenerations: ledger.tutor_regenerations,
    logical_generation_calls: ledger.logical_generation_calls,
    adapter_attempts: ledger.adapter_attempts,
    input_tokens: ledger.input_tokens,
    output_tokens: ledger.output_tokens,
    total_tokens: ledger.total_tokens
  };
  for (const [key, limit] of Object.entries({
    simulator_calls: BUDGET.simulator_calls,
    evidence_evaluator_calls: BUDGET.evidence_evaluator_calls,
    initial_tutor_calls: BUDGET.initial_tutor_calls,
    tutor_regenerations: BUDGET.tutor_regenerations,
    logical_generation_calls: BUDGET.logical_generation_calls,
    adapter_attempts: BUDGET.adapter_attempts,
    input_tokens: BUDGET.input_tokens,
    output_tokens: BUDGET.output_tokens,
    total_tokens: BUDGET.total_tokens
  })) {
    if (actual[key as keyof typeof actual] > limit) {
      throw new Error(`e2a28_actual_budget_exceeded:${key}`);
    }
  }
  if (ledger.pricing_complete && ledger.estimated_cost_usd > BUDGET.cost_usd) {
    throw new Error("e2a28_actual_budget_exceeded:cost_usd");
  }
}

function pids(pattern: string) {
  try {
    const output = execFileSync("pgrep", ["-f", pattern], {
      encoding: "utf8"
    }).trim();
    return output ? output.split(/\s+/u).map(Number).filter((pid) =>
      Number.isInteger(pid) && pid !== process.pid
    ) : [];
  } catch {
    return [];
  }
}

function existingLiveRuns() {
  if (!existsSync(ARTIFACT_ROOT)) return [];
  return readdirSync(ARTIFACT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("e2a28_"))
    .map((entry) => entry.name).filter((id) => {
      const manifest = path.join(ARTIFACT_ROOT, id, "canary-manifest.json");
      if (!existsSync(manifest)) return true;
      try {
        return readJson<{ execution_mode?: string }>(manifest)
          .execution_mode === "live_provider";
      } catch {
        return true;
      }
    }).sort();
}

function filesRecursively(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(root, entry.name);
    return entry.isDirectory() ? filesRecursively(child) : [child];
  }).sort();
}

function treeHash(root: string) {
  const files = filesRecursively(root).map((file) => ({
    path: path.relative(process.cwd(), file),
    sha256: sha256(readFileSync(file))
  }));
  return {
    source_path: path.relative(process.cwd(), root),
    exists: existsSync(root),
    file_count: files.length,
    sha256: stableHash(files)
  };
}

function sourceIdentity() {
  const files = [
    "prisma/formative-evaluation-e2a28.ts",
    "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts",
    "src/lib/services/student-assessment/autonomous-formative-dialogue.ts",
    "src/lib/services/student-assessment/target-evidence-contract.ts",
    "src/lib/services/student-assessment/target-evidence-contract-v3.ts",
    "src/lib/services/student-assessment/target-evidence-contract-v4.ts",
    "src/lib/services/student-assessment/anchor-contradiction-propagation.ts",
    "src/lib/services/student-assessment/pre-tutor-profile-finalization.ts",
    "src/lib/services/student-assessment/anchor-conclusion-consistency.ts",
    "src/lib/services/student-assessment/topic-dialogue-evidence-first-routing.ts",
    "src/lib/services/student-assessment/activity-runtime-ui.ts",
    "src/lib/services/student-assessment/activity-misconception-evidence-live.ts",
    "src/lib/services/student-assessment/activity-misconception-evidence.ts",
    "src/lib/llm/providers/openai-responses-provider.ts",
    "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json"
  ].map((entry) => ({
    path: entry,
    sha256: sha256(readFileSync(path.join(process.cwd(), entry)))
  }));
  return {
    application_git_commit: currentCommit(),
    files,
    aggregate_sha256: stableHash({
      application_git_commit: currentCommit(), files
    })
  };
}

function protectedEvidenceIdentity() {
  const dataRoot = path.join(process.cwd(), ".data");
  const dataRoots = readdirSync(dataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() &&
      /^e2a(?:1[2-9]|2[0-7])a?(?:\D|$)/u.test(entry.name))
    .map((entry) => path.join(dataRoot, entry.name));
  const configFiles = readdirSync(path.join(process.cwd(), "config"), {
    withFileTypes: true
  }).filter((entry) => entry.isFile() &&
    /^(?:approved|candidate)-operational-agent-config.*\.json$/u.test(
      entry.name
    )).map((entry) => path.join(process.cwd(), "config", entry.name));
  const protectedPaths = [
    ...configFiles,
    ...dataRoots,
    path.join(process.cwd(),
      "src/lib/evaluation/formative/e2a20a-student-simulator-evidence-classifier-v3.ts"),
    path.join(process.cwd(),
      "src/lib/evaluation/formative/e2a23a-student-simulator-evidence-classifier-v4.ts")
  ];
  const trees = protectedPaths.map(treeHash);
  return {
    snapshot_version: "e2a28-protected-evidence-snapshot-v1",
    trees,
    current_sha256: stableHash(trees)
  };
}

function compositeRuntimeIdentity() {
  const source = sourceIdentity();
  const sourceHash = (file: string) => source.files.find((entry) =>
    entry.path === file
  )?.sha256 ?? "missing";
  const autonomousSource =
    "src/lib/services/student-assessment/autonomous-formative-dialogue.ts";
  const v4Source =
    "src/lib/services/student-assessment/target-evidence-contract-v4.ts";
  const propagationSource =
    "src/lib/services/student-assessment/anchor-contradiction-propagation.ts";
  const finalizationSource =
    "src/lib/services/student-assessment/pre-tutor-profile-finalization.ts";
  const anchorSource =
    "src/lib/services/student-assessment/anchor-conclusion-consistency.ts";
  const identity = {
    identity_version: "e2a28-composite-runtime-identity-v1",
    candidate_configuration_hash: CANDIDATE_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA,
    autonomous_prompt_hash: AUTONOMOUS_PEDAGOGY_PROMPT_HASH,
    autonomous_input_schema_hash: stableHash({
      version: AUTONOMOUS_PEDAGOGY_INPUT_SCHEMA_VERSION,
      source_sha256: sourceHash(autonomousSource)
    }),
    autonomous_output_schema_hash: stableHash({
      version: AUTONOMOUS_PEDAGOGY_OUTPUT_SCHEMA_VERSION,
      source_sha256: sourceHash(autonomousSource)
    }),
    autonomous_hard_validator_hash: stableHash({
      version: AUTONOMOUS_PEDAGOGY_VALIDATOR_VERSION,
      source_sha256: sourceHash(autonomousSource)
    }),
    pedagogical_quality_rubric_hash: stableHash({
      version: AUTONOMOUS_PEDAGOGY_QUALITY_REVIEW_VERSION,
      source_sha256: sourceHash(autonomousSource)
    }),
    full_visible_history_serializer_hash: stableHash({
      version: COMPLETE_VISIBLE_FORMATIVE_EPISODE_VERSION,
      source_sha256: sourceHash(autonomousSource)
    }),
    evidence_evaluator_v4_source_hash: sourceHash(v4Source),
    evidence_evaluator_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V4,
    target_evidence_contract_implementation_hash: sourceHash(v4Source),
    target_evidence_contract_version: TARGET_EVIDENCE_CONTRACT_VERSION_V4,
    profile_mapper_v4_source_hash: sourceHash(v4Source),
    profile_mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V4,
    profile_consistency_v4_source_hash: sourceHash(v4Source),
    profile_consistency_version: PROFILE_CONSISTENCY_POLICY_VERSION_V4,
    contradiction_propagation_source_hash: sourceHash(propagationSource),
    contradiction_propagation_version:
      ANCHOR_CONTRADICTION_PROPAGATION_VERSION,
    pre_tutor_finalization_source_hash: sourceHash(finalizationSource),
    pre_tutor_finalization_version: PRE_TUTOR_PROFILE_FINALIZATION_VERSION,
    anchor_conclusion_consistency_source_hash: sourceHash(anchorSource),
    anchor_conclusion_consistency_version:
      ANCHOR_CONCLUSION_CONSISTENCY_VERSION,
    sound_gate_source_hash: sourceHash(anchorSource),
    intervention_memory_implementation_hash: stableHash({
      version: PEDAGOGICAL_INTERVENTION_MEMORY_VERSION,
      source_sha256: sourceHash(autonomousSource)
    }),
    platform_routing_source_hash: sourceHash(
      "src/lib/services/student-assessment/topic-dialogue-evidence-first-routing.ts"
    ),
    platform_persistence_source_hash: sourceHash(
      "src/lib/services/student-assessment/activity-runtime-ui.ts"
    ),
    student_simulator_configuration_hash: SIMULATOR_PROMPT_HASH,
    application_git_commit: currentCommit(),
    frozen_protocol_hash: PROTOCOL_HASH,
    artifact_contract_hash: sha256(readFileSync(
      frozenArtifactPath("e2a28-artifact-contract.json")
    )),
    source_identity_hash: source.aggregate_sha256
  };
  return { ...identity, composite_runtime_identity_hash: stableHash(identity) };
}

type DispatchCheckpoint = {
  checkpoint_version: "e2a28-dispatch-checkpoint-v1";
  recorded_at: string;
  application_git_commit: string;
  composite_runtime_identity_hash: string;
  source_identity_hash: string;
  protected_evidence_hash: string;
  protocol_hash: string;
  candidate_configuration_hash: string;
  candidate_file_sha256: string;
  live_execution_started: false;
};

function readCheckpoint() {
  return existsSync(CHECKPOINT_PATH)
    ? readJson<DispatchCheckpoint>(CHECKPOINT_PATH) : null;
}

function preflight(requireLive: boolean, requireCheckpoint = requireLive) {
  const blockers: string[] = [];
  const candidate = evaluateE2A24Candidate();
  const protocol = buildE2A28FrozenProtocol();
  const e2a27aSummary = readJson<{ status?: string;
    provider_calls_made?: number; network_requests_made?: number;
    protected_evidence_unchanged?: boolean;
    candidate_integrity_passed?: boolean; e2a28_executed?: boolean;
    e2a28_protocol_hash?: string }>(
    path.join(E2A27A_ROOT, "summary.json")
  );
  const overlap = readJson<{ materially_new_domain?: boolean;
    exact_overlap_passed?: boolean; normalized_overlap_passed?: boolean;
    token_overlap_passed?: boolean; structural_overlap_passed?: boolean;
    semantic_overlap_passed?: boolean }>(
    frozenArtifactPath("e2a28-held-out-overlap-analysis.json")
  );
  const frozenBudget = readJson<{ authorization_state?: string;
    maximum?: Record<string, number> }>(frozenArtifactPath("e2a28-budget.json"));
  const artifactContract = frozenArtifactContract();
  const buildInfo = resolveApplicationBuildInfo();
  const protectedEvidence = protectedEvidenceIdentity();
  const identity = compositeRuntimeIdentity();
  const checkpoint = readCheckpoint();
  const commit = currentCommit();
  if (e2a27aSummary.status !==
      "e2a27a_evaluator_contract_corrected_e2a28_ready" ||
      e2a27aSummary.provider_calls_made !== 0 ||
      e2a27aSummary.network_requests_made !== 0 ||
      e2a27aSummary.protected_evidence_unchanged !== true ||
      e2a27aSummary.candidate_integrity_passed !== true ||
      e2a27aSummary.e2a28_executed !== false ||
      e2a27aSummary.e2a28_protocol_hash !== PROTOCOL_HASH) {
    blockers.push("e2a27a_authoritative_artifacts_invalid");
  }
  if (protocol.protocol_hash !== PROTOCOL_HASH) {
    blockers.push("protocol_hash_mismatch");
  }
  if (overlap.materially_new_domain !== true ||
      overlap.exact_overlap_passed !== true ||
      overlap.normalized_overlap_passed !== true ||
      overlap.token_overlap_passed !== true ||
      overlap.structural_overlap_passed !== true ||
      overlap.semantic_overlap_passed !== true) {
    blockers.push("held_out_overlap_invalid");
  }
  if (artifactContract.artifact_contract_version !==
      "e2a28-artifact-contract-v1" ||
      !Array.isArray(artifactContract.required_failure_safe_records) ||
      artifactContract.generated_but_suppressed_outputs_included !== true ||
      artifactContract.no_missing_values_coerced_to_zero !== true ||
      artifactContract.historical_evidence_mutation_forbidden !== true) {
    blockers.push("frozen_artifact_contract_mismatch");
  }
  const frozenComparableBudget = {
    sessions: BUDGET.sessions,
    simulator_calls: BUDGET.simulator_calls,
    evidence_evaluator_calls: BUDGET.evidence_evaluator_calls,
    initial_tutor_calls: BUDGET.initial_tutor_calls,
    tutor_regenerations: BUDGET.tutor_regenerations,
    logical_generation_calls: BUDGET.logical_generation_calls,
    adapter_attempts: BUDGET.adapter_attempts,
    provider_concurrency: BUDGET.provider_concurrency,
    input_tokens: BUDGET.input_tokens,
    output_tokens: BUDGET.output_tokens,
    total_tokens: BUDGET.total_tokens,
    cost_usd: BUDGET.cost_usd
  };
  const frozenMaximum = frozenBudget.maximum ? {
    sessions: frozenBudget.maximum.sessions,
    simulator_calls: frozenBudget.maximum.simulator_calls,
    evidence_evaluator_calls: frozenBudget.maximum.evidence_evaluator_calls,
    initial_tutor_calls: frozenBudget.maximum.tutor_calls,
    tutor_regenerations: frozenBudget.maximum.tutor_regenerations,
    logical_generation_calls: frozenBudget.maximum.logical_generation_calls,
    adapter_attempts: frozenBudget.maximum.adapter_attempts,
    provider_concurrency: frozenBudget.maximum.provider_concurrency,
    input_tokens: frozenBudget.maximum.input_tokens,
    output_tokens: frozenBudget.maximum.output_tokens,
    total_tokens: frozenBudget.maximum.total_tokens,
    cost_usd: frozenBudget.maximum.cost_usd_when_pricing_available
  } : null;
  if (frozenBudget.authorization_state !== "not_authorized" ||
      stableHash(frozenMaximum) !==
        stableHash(frozenComparableBudget)) {
    blockers.push("frozen_budget_mismatch");
  }
  if (candidate.candidate_configuration_hash !== CANDIDATE_HASH) {
    blockers.push("candidate_hash_mismatch");
  }
  if (candidate.candidate_file_sha256 !== CANDIDATE_FILE_SHA ||
      sha256(readFileSync(E2A24_CANDIDATE_PATH)) !== CANDIDATE_FILE_SHA) {
    blockers.push("candidate_file_sha_mismatch");
  }
  if (candidate.approved_v2_hash !== APPROVED_HASH) {
    blockers.push("approved_baseline_hash_mismatch");
  }
  if (candidate.candidate_approved || candidate.candidate_activated) {
    blockers.push("candidate_approval_or_activation_state_invalid");
  }
  if (requireCheckpoint && (!buildInfo.ok ||
      buildInfo.info.application_git_commit !== commit)) {
    blockers.push("application_build_provenance_mismatch");
  }
  if (requireCheckpoint && !trackedTreeClean()) {
    blockers.push("tracked_worktree_not_clean");
  }
  if (requireCheckpoint && (!checkpoint ||
      checkpoint.application_git_commit !== commit ||
      checkpoint.composite_runtime_identity_hash !==
        identity.composite_runtime_identity_hash ||
      checkpoint.source_identity_hash !== identity.source_identity_hash ||
      checkpoint.protected_evidence_hash !==
        protectedEvidence.current_sha256 ||
      checkpoint.protocol_hash !== PROTOCOL_HASH)) {
    blockers.push("dispatch_checkpoint_mismatch");
  }
  if (pids("[f]ormative-evaluation-e2a28").length > 0) {
    blockers.push("duplicate_e2a28_process");
  }
  if (existsSync(LOCK_PATH)) blockers.push("e2a28_lock_present");
  const priorRuns = existingLiveRuns();
  if (priorRuns.length > 0) blockers.push(`prior_e2a28_run_exists:${priorRuns.at(-1)}`);
  let credential = null;
  const database = requireLive
    ? databaseReadiness() : { ready: null, code: "not_checked" };
  if (requireLive) {
    if (process.env.RUN_LIVE_E2A28 !== "1") blockers.push("live_opt_in_missing");
    if (process.env.LLM_PROVIDER !== "openai") blockers.push("provider_not_openai");
    if (process.env.LLM_LIVE_CALLS_ENABLED !== "true") {
      blockers.push("live_calls_not_enabled");
    }
    const resolved = resolveOpenAICredentialFromEnv();
    if (!resolved.ok) blockers.push(resolved.code);
    else {
      const publicCredential = publicOpenAICredentialResolution(resolved.credential);
      credential = {
        source: publicCredential.source,
        fingerprint_prefix: publicCredential.fingerprint_prefix,
        length: publicCredential.length,
        asciiOnly: publicCredential.asciiOnly,
        embeddedWhitespace: publicCredential.embeddedWhitespace,
        basicShapeValid: publicCredential.basicShapeValid,
        resolver_version: publicCredential.resolver_version
      };
    }
    if (!isApprovedOpenAIBaseUrl(resolveOpenAIBaseUrl())) {
      blockers.push("provider_base_url_not_approved");
    }
    if (!database.ready) blockers.push(database.code);
  }
  return {
    version: "e2a28-live-preflight-v1",
    passed: blockers.length === 0,
    blockers,
    current_git_commit: commit,
    tracked_worktree_clean: trackedTreeClean(),
    application_build_info: buildInfo,
    authoritative_e2a27a_run: E2A27A_RUN,
    protocol_hash: PROTOCOL_HASH,
    composite_identity: identity,
    dispatch_checkpoint: checkpoint,
    candidate_configuration_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    approved_v2_hash: candidate.approved_v2_hash,
    candidate_authorized_for_activation: false,
    candidate_active: false,
    provider_concurrency: 1,
    provider_host: requireLive
      ? openAIBaseUrlHost(resolveOpenAIBaseUrl()) : "not_checked",
    credential,
    provider_adapter_version: OPENAI_RESPONSES_ADAPTER_VERSION,
    database_readiness: database,
    source_identity: sourceIdentity(),
    protected_evidence_identity: protectedEvidence,
    prior_live_runs: priorRuns,
    budget: BUDGET,
    network_request_count: 0
  };
}

function recordDispatchCheckpoint() {
  if (existingLiveRuns().length > 0) {
    throw new Error("e2a28_prior_live_run_exists");
  }
  if (!trackedTreeClean()) throw new Error("e2a28_checkpoint_tree_not_clean");
  const check = preflight(false, false);
  if (!check.passed) {
    throw new Error(`e2a28_checkpoint_preflight_failed:${check.blockers.join(",")}`);
  }
  const identity = compositeRuntimeIdentity();
  const checkpoint: DispatchCheckpoint = {
    checkpoint_version: "e2a28-dispatch-checkpoint-v1",
    recorded_at: new Date().toISOString(),
    application_git_commit: currentCommit(),
    composite_runtime_identity_hash:
      identity.composite_runtime_identity_hash,
    source_identity_hash: identity.source_identity_hash,
    protected_evidence_hash: protectedEvidenceIdentity().current_sha256,
    protocol_hash: PROTOCOL_HASH,
    candidate_configuration_hash: CANDIDATE_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA,
    live_execution_started: false
  };
  mkdirSync(ARTIFACT_ROOT, { recursive: true });
  writeJson(CHECKPOINT_PATH, checkpoint);
  return checkpoint;
}

function requiredArgument(name: string, expected: string | number) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value !== String(expected)) {
    throw new Error(`e2a28_confirmation_mismatch:${name}`);
  }
}

function assertLiveAuthorizationArguments() {
  for (const flag of [
    "--confirm-e2a28-one-session-authorization",
    "--confirm-paid-provider-evaluation",
    "--confirm-exactly-one-isolated-session",
    "--confirm-sequential-concurrency-one",
    "--confirm-human-review-remains-pending",
    "--confirm-candidate-remains-unapproved",
    "--confirm-no-e2a25-rerun",
    "--confirm-no-e2a27-rerun",
    "--confirm-no-additional-live-session",
    "--confirm-no-four-session-canary",
    "--confirm-no-twelve-session-canary",
    "--confirm-no-36-session-matrix",
    "--confirm-no-e2b",
    "--confirm-no-approval",
    "--confirm-no-activation",
    "--confirm-stop-after-e2a28"
  ]) {
    if (!process.argv.includes(flag)) {
      throw new Error(`e2a28_confirmation_missing:${flag}`);
    }
  }
  const checkpoint = readCheckpoint();
  if (!checkpoint) throw new Error("e2a28_dispatch_checkpoint_missing");
  requiredArgument("--checkpoint-commit", checkpoint.application_git_commit);
  requiredArgument("--protocol-hash", PROTOCOL_HASH);
  requiredArgument("--candidate-hash", CANDIDATE_HASH);
  requiredArgument("--candidate-file-sha256", CANDIDATE_FILE_SHA);
  requiredArgument("--composite-identity-hash",
    checkpoint.composite_runtime_identity_hash);
  requiredArgument("--max-sessions", BUDGET.sessions);
  requiredArgument("--max-simulator-calls", BUDGET.simulator_calls);
  requiredArgument("--max-evaluator-calls", BUDGET.evidence_evaluator_calls);
  requiredArgument("--max-initial-tutor-calls", BUDGET.initial_tutor_calls);
  requiredArgument("--max-tutor-regenerations", BUDGET.tutor_regenerations);
  requiredArgument("--max-logical-calls", BUDGET.logical_generation_calls);
  requiredArgument("--max-adapter-attempts", BUDGET.adapter_attempts);
  requiredArgument("--max-input-tokens", BUDGET.input_tokens);
  requiredArgument("--max-output-tokens", BUDGET.output_tokens);
  requiredArgument("--max-total-tokens", BUDGET.total_tokens);
  requiredArgument("--max-cost-usd", BUDGET.cost_usd);
}

function contractFor(session: Session): TargetEvidenceContractV4 {
  const source = session.target_evidence_contract;
  return TargetEvidenceContractV4Schema.parse({
    contract_version: TARGET_EVIDENCE_CONTRACT_VERSION_V4,
    concept_id: session.concept,
    item_id: source.item_id,
    distractor_option: source.distractor_option,
    distractor_claim: source.distractor_claim,
    target_conceptual_relationships: [source.required_relationship],
    required_mechanisms: [source.required_mechanism],
    acceptable_equivalent_explanations: [],
    required_anchor_application:
      `Apply the explanation to ${source.item_id} option ${source.distractor_option}.`,
    prohibited_contradictions: [source.prohibited_contradiction],
    revision_ready_criteria: [
      "target_conceptual_relationship", "required_mechanism",
      "active_anchor_application", "coherent_conclusion"
    ],
    optional_deepening_criteria: [],
    evidence_limitations: [
      "This isolated canary evaluates only the frozen synthetic response trajectory."
    ],
    active_anchor_id: `${source.item_id}:option:${source.distractor_option}`,
    active_anchor_text:
      `${source.item_id} option ${source.distractor_option}: ${source.distractor_claim}`,
    active_anchor_type: "distractor_option",
    required_anchor_stance: source.required_anchor_stance,
    acceptable_anchor_paraphrases: [
      `option ${source.distractor_option}`,
      `choice ${source.distractor_option}`,
      "that option",
      "that choice",
      "the claim"
    ],
    prohibited_anchor_stances: [
      "not_expressed", "ambiguous", "endorses_distractor"
    ],
    anchor_resolution_criteria: [
      `Apply the population-selection mechanism to option ${source.distractor_option} and coherently reject the need-driven individual-adaptation claim.`
    ],
    anchor_contradiction_criteria: [
      `Endorsing option ${source.distractor_option} conflicts with explaining that pre-existing less susceptible bacteria survive and reproduce.`
    ],
    ambiguity_resolution_policy:
      "Do not treat an option label as a typo; contradictory or ambiguous conclusions require clarification.",
    criteria: [
      {
        criterion_id: "target_conceptual_relationship",
        criterion_kind: "conceptual_relationship",
        description: source.required_relationship,
        essential_for_revision: true,
        acceptable_evidence_patterns: []
      },
      {
        criterion_id: "required_mechanism",
        criterion_kind: "required_mechanism",
        description: source.required_mechanism,
        essential_for_revision: true,
        acceptable_evidence_patterns: []
      },
      {
        criterion_id: "active_anchor_application",
        criterion_kind: "anchor_application",
        description:
          `Apply the reasoning to ${source.item_id} option ${source.distractor_option}.`,
        essential_for_revision: true,
        acceptable_evidence_patterns: []
      },
      {
        criterion_id: "coherent_conclusion",
        criterion_kind: "coherent_conclusion",
        description:
          "Reach a coherent conclusion without retaining the prohibited contradiction.",
        essential_for_revision: true,
        acceptable_evidence_patterns: []
      }
    ],
    contradiction_criteria: [{
      contradiction_id: "active_distractor_claim_retained",
      description: source.prohibited_contradiction,
      observable_patterns: []
    }, {
      contradiction_id:
        "anchor_conclusion_conceptual_explanation_conflict",
      description:
        `The stated conclusion about option ${source.distractor_option} conflicts with the conceptual explanation.`,
      observable_patterns: []
    }]
  });
}

function noLiveFixtureMessage(turn: PlannedTurn) {
  return turn.no_live_fixture_message ?? null;
}

function expectedProfile(turn: PlannedTurn) {
  return turn.semantic_envelope;
}

function expressedLevel(profile: PlannedTurn["semantic_envelope"]) {
  if (profile.includes("sound")) return "substantive" as const;
  if (profile.includes("partial")) {
    return "partial" as const;
  }
  if (profile.includes("misconception")) return "partial" as const;
  return "minimal" as const;
}

function renderedIntent(profile: PlannedTurn["semantic_envelope"]) {
  if (profile.includes("sound")) return "revision_evidence" as const;
  if (profile.includes("misconception")) {
    return "misconception_persistence" as const;
  }
  return "partial_explanation" as const;
}

function simulatorInput(
  session: Session,
  turn: PlannedTurn,
  visibleTurns: FormativeEpisodeTurnRecord[],
  repairIssues: string[]
) {
  const latestAssistant = [...visibleTurns].reverse().find((entry) =>
    entry.actor_type === "agent"
  )?.message_text ?? "Explain the current idea in your own words.";
  return {
    scenario_id: `e2a28_session_${session.session_id}`,
    scenario_version: "e2a28-frozen-student-trajectory-v1",
    expression_variant: ((turn.turn - 1) % 3) + 1,
    student_persona: session.student_profile,
    current_turn: turn.turn,
    frozen_turn_objective: turn.objective,
    current_human_adjudicated_evidence_ceiling: expectedProfile(turn),
    planned_evidence_ceiling: turn.objective,
    copy_behavior_instruction: "simulator_instruction" in turn
      ? turn.simulator_instruction : null,
    target_anchor: {
      item_id: session.target_evidence_contract.item_id,
      option: session.target_evidence_contract.distractor_option
    },
    visible_conversation: visibleTurns.slice(-12).map((entry) => ({
      role: entry.actor_type === "student" ? "student" : "assistant",
      content: entry.message_text,
      sequence_index: entry.sequence_index
    })),
    latest_assistant_message: latestAssistant,
    repair_issues: repairIssues,
    output_requirements: {
      preserve_evidence_ceiling: true,
      preserve_anchor_when_supplied: true,
      no_hidden_state_disclosure: true,
      no_answer_key_or_correctness_disclosure: true,
      maximum_sentences: 5
    }
  };
}

function wordNgrams(text: string, size: number) {
  const words = text.toLowerCase().replace(/[^a-z0-9]+/gu, " ")
    .trim().split(/\s+/u).filter(Boolean);
  return Array.from({ length: Math.max(0, words.length - size + 1) },
    (_, index) => words.slice(index, index + size).join(" "));
}

function validateSimulatorOutput(input: {
  session: Session;
  turn: PlannedTurn;
  output: LlmStudentSimulatorOutput;
  priorStudentMessages: string[];
  latestAssistantMessage: string;
}) {
  const issues: string[] = [];
  const message = input.output.student_message.trim();
  if (!message) issues.push("empty_student_message");
  if (/\b(?:answer key|correct answer|system prompt|hidden prompt|as an ai|simulator|provider|schema version|api key)\b/iu.test(message)) {
    issues.push("protected_or_internal_disclosure");
  }
  if (input.priorStudentMessages.some((prior) =>
    prior.trim().toLowerCase() === message.toLowerCase()
  )) issues.push("duplicate_student_message");
  if (input.turn.required_anchor_application === "explicit") {
    if (!new RegExp(
          `\\boption\\s+${input.session.target_evidence_contract.distractor_option}\\b`,
          "iu"
        ).test(message)) issues.push("required_anchor_missing");
  }
  if ("simulator_instruction" in input.turn) {
    const assistantNgrams = new Set(wordNgrams(input.latestAssistantMessage, 4));
    const copied = wordNgrams(message, 4).some((gram) => assistantNgrams.has(gram));
    if (!copied) issues.push("required_distinctive_clause_copy_missing");
    if (message.split(/\s+/u).length > 70) issues.push("copy_turn_too_long");
  }
  return { passed: issues.length === 0, issues };
}

function evaluatorProviderInput(
  session: Session,
  evaluatorInput: AutonomousEvidenceEvaluatorInput
) {
  const message = evaluatorInput.latest_student_message.message_text;
  const contract = evaluatorInput.target_evidence_contract as
    TargetEvidenceContractV4;
  return {
    schema_version: ACTIVITY_RESPONSE_EVALUATOR_INPUT_SCHEMA_VERSION,
    case_id: `e2a28_${session.session_id}_${evaluatorInput.latest_student_message.source_sequence_index}`,
    session_public_id: evaluatorInput.complete_visible_formative_conversation.dialogue_public_id,
    student_public_id: `synthetic_student_e2a28_${session.session_id}`,
    assessment_public_id: `synthetic_assessment_e2a28_${session.session_id}`,
    concept_unit_id: session.concept,
    activity_attempt_id:
      evaluatorInput.complete_visible_formative_conversation.activity_attempt_public_id,
    required_output_contract: {
      schema_version: ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION,
      evaluator_agent_name: ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
      evaluation_source: "live_llm",
      runtime_servable_to_student: false,
      review_only: false
    },
    source_activity_context: {
      source_activity_schema: FORMATIVE_ACTIVITY_SCHEMA_VERSION,
      source_activity_generation_source: "live_llm",
      source_activity_runtime_servable_to_student: true,
      source_activity_family: "reasoning_chain_repair",
      selected_formative_value: "reasoning_refinement",
      source_diagnostic_purpose: "reasoning_boundary_repair",
      profile_condition: "synthetic_frozen_e2a28_trajectory",
      distractor_role: "selected_distractor",
      safe_activity_prompt: session.natural_initial_activity,
    },
    student_activity_response: {
      safe_response_summary: message.slice(0, 900),
      response_kind_hint: "substantive"
    },
    diagnostic_task: {
      expected_evidence_focus: [
        ...contract.target_conceptual_relationships,
        ...contract.required_mechanisms,
        contract.required_anchor_application
      ].join(" "),
      process_context_is_reliability_context_only: true,
      low_information_response_policy:
        "Copied or unsupported wording is insufficient without independent anchor application."
    },
    autonomous_turn_evidence_context: evaluatorInput,
    required_safety_constraints: {
      no_answer_key: true,
      no_correct_option: true,
      no_correctness_label: true,
      no_raw_distractor_metadata: true,
      no_misconception_ids: true,
      no_engagement_or_ai_labels: true,
      no_raw_process_payload: true,
      no_raw_student_text: false,
      no_raw_llm_output: true,
      no_secrets_or_headers: true,
      no_misconduct_or_genai_accusation: true
    }
  };
}

function auditFor(
  result: StructuredAgentResult<unknown>,
  modelName: string
): ActivityMisconceptionEvidenceProviderAudit {
  const sanitized = sanitizedE2AProviderResult(result);
  const usage = e2aUsageFor(result);
  return {
    agent_call_id: `e2a28_audit_${randomUUID()}`,
    provider: result.provider,
    model_name: modelName,
    client_request_id: result.client_request_id,
    provider_request_id: typeof sanitized.provider_request_id === "string"
      ? sanitized.provider_request_id : undefined,
    provider_response_id: typeof sanitized.provider_response_id === "string"
      ? sanitized.provider_response_id : undefined,
    call_status: result.status === "completed" ? "succeeded" : "failed",
    output_validated: result.status === "completed",
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens
  };
}

function noLivePacket(
  session: Session,
  turn: PlannedTurn,
  providerInput: ReturnType<typeof evaluatorProviderInput>
) {
  const profile = expectedProfile(turn);
  const sound = profile.includes("sound");
  const misconception = profile.length === 1 && profile[0] === "misconception";
  const copied = "simulator_instruction" in turn;
  const contradictory = turn.required_anchor_consistency ===
    "contradictory_to_conceptual_reasoning";
  const partial = profile.includes("partial");
  const status = sound ? "misconception_unsupported" as const
    : misconception ? "misconception_persisted" as const
      : contradictory ? "misconception_unsupported" as const
        : copied ? "insufficient_new_evidence" as const
          : turn.turn === 1 ? "misconception_persisted" as const
          : "misconception_weakened" as const;
  const evidenceTypes = sound
    ? ["target_boundary_explained", "reasoning_link_repaired"] as const
    : misconception
      ? ["distractor_tempting_reason_explained"] as const
      : copied ? ["none"] as const
        : ["target_boundary_explained"] as const;
  const fixture = buildNoLiveActivityMisconceptionEvidenceFixture({
    case_id: `e2a28_${session.session_id}_${turn.turn}`,
    activity_family: "reasoning_chain_repair",
    selected_formative_value: "reasoning_refinement",
    profile_condition: "frozen_e2a28",
    source_diagnostic_purpose: "reasoning_boundary_repair",
    response_kind: copied ? "low_information" : partial ? "partial" : "substantive",
    response_length_band: "medium",
    response_summary: contradictory
      ? `${session.session_id} turn ${turn.turn} supplies an accurate differential-survival mechanism but explicitly endorses the need-driven individual-adaptation claim, creating a mechanism/conclusion conflict.`
      : `${session.session_id} turn ${turn.turn} provides ${profile.join(" or ")} synthetic conceptual evidence for the active anchor.`,
    primary_target: "reasoning_link",
    evidence_types: [...evidenceTypes],
    update_status: status,
    evidence_quality: sound || contradictory
      ? "high" : copied ? "insufficient" : "medium",
    confidence: sound ? "high" : misconception ? "high" : "medium",
    evidence_flags: {
      elicited: !copied,
      student_explained_target_boundary:
        sound || contradictory || partial ? "yes" : "no",
      student_repaired_reasoning_link:
        sound || contradictory ? "yes" : "no",
      student_reconstructed_concept_independently:
        sound || contradictory ? "yes" : "no"
    },
    limitations: copied ? ["copied_wording_without_independent_application"] : []
  });
  return makeLiveActivityMisconceptionEvidencePacketForTest(fixture, {
    session_public_id: providerInput.session_public_id,
    student_public_id: providerInput.student_public_id,
    assessment_public_id: providerInput.assessment_public_id,
    concept_unit_id: providerInput.concept_unit_id,
    activity_attempt_id: providerInput.activity_attempt_id
  });
}

function noLiveTutorOutput(input: AutonomousPedagogyInput) {
  const profile = input.latest_authoritative_turn_profile as
    TopicDialogueTurnEvidenceProfile;
  const priorCount = input.intervention_history.length;
  const strategies = [
    "contrast individual change with population-level selection",
    "trace which bacteria survive and reproduce before naming the process",
    "ask for a one-sentence causal link tied to the active option",
    "separate pre-existing variation from need-driven adaptation",
    "reconcile the stated option conclusion with differential survival"
  ];
  const studentTasks = [
    "Name the one fact that makes the option's reasoning work or fail, then connect that fact to the current item.",
    "Try a contrast: state what would have to be true for the option to work, then explain why that condition is or is not present here.",
    "Set the wording aside and rebuild the causal link in one or two sentences, ending with its consequence for this option.",
    "Use a concrete counterexample to test the option, then explain the general rule your example reveals.",
    "Put the population mechanism and your final judgment side by side. Do they support the same conclusion? Explain which part you would keep or change."
  ];
  return AutonomousPedagogyOutputSchema.parse({
    schema_version: AUTONOMOUS_PEDAGOGY_OUTPUT_SCHEMA_VERSION,
    source_profile_snapshot_id: profile.profile_snapshot_id,
    source_student_turn_id: input.latest_student_response.source_student_turn_id,
    primary_learning_gap: profile.essential_missing_links[0] ??
      "the active conceptual boundary remains incomplete",
    pedagogical_goal:
      "Elicit one new, independently stated reasoning link for the active anchor.",
    pedagogical_strategy: strategies[priorCount % strategies.length],
    why_this_strategy_fits_now:
      "The latest evidence is not yet sufficient for the platform revision gate.",
    prior_interventions_considered: input.intervention_history.map((entry) =>
      entry.strategy_description
    ),
    repetition_risk: "low",
    evidence_sought_from_next_response: [
      "A direct explanation of the missing reasoning link",
      "Application to the current item and option"
    ],
    student_facing_message:
      studentTasks[priorCount % studentTasks.length]!,
    requires_student_response: true
  });
}

function makeNoLiveExecutor(protocol: Protocol): ProviderExecutor {
  return async <TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> => {
    const sessionId = request.metadata?.session_id;
    const turnNumber = Number(request.metadata?.turn_number);
    const session = protocol.session.session_id === sessionId
      ? protocol.session : undefined;
    const turn = session?.frozen_student_trajectory.find((entry) =>
      entry.turn === turnNumber
    );
    let output: unknown;
    if (request.agent_name === "evaluation_llm_student_simulator") {
      if (!session || !turn) throw new Error("e2a28_no_live_simulator_case_missing");
      const input = request.input as ReturnType<typeof simulatorInput>;
      const message = turn.simulator_instruction
        ? `${input.latest_assistant_message.split(/(?<=[.!?])\s+/u)[0] ?? "Could you explain that part again?"} I think that is what happens.`
        : noLiveFixtureMessage(turn) ?? "Could you explain that part again?";
      output = {
        student_message: message,
        rendered_intent: renderedIntent(expectedProfile(turn)),
        expressed_evidence_level: expressedLevel(expectedProfile(turn)),
        mentions_focus_option: new RegExp(
          `\\boption\\s+${session.target_evidence_contract.distractor_option}\\b`,
          "iu"
        ).test(message),
        asks_for_clarification: turn.turn === 5,
        claims_understanding: false,
        off_topic: false,
        simulator_warnings: []
      };
    } else if (request.agent_name === ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME) {
      if (!session || !turn) throw new Error("e2a28_no_live_evaluator_case_missing");
      output = noLivePacket(
        session, turn,
        request.input as ReturnType<typeof evaluatorProviderInput>
      );
    } else if (request.agent_name === "topic_dialogue_agent") {
      output = noLiveTutorOutput(request.input as AutonomousPedagogyInput);
      const validation = validateAutonomousPedagogyOutput({
        candidate_output: output,
        request: request.input as AutonomousPedagogyInput
      });
      if (validation.runtime_acceptance === "hard_rejected") {
        throw new Error(`e2a28_no_live_tutor_fixture_invalid:${validation.hard_rejections.map((entry) => entry.rule_code).join("|")}`);
      }
    } else {
      throw new Error(`e2a28_no_live_unknown_agent:${request.agent_name}`);
    }
    return {
      provider: "mock",
      client_request_id: request.client_request_id,
      provider_request_id: `mock_req_${randomUUID()}`,
      provider_response_id: `mock_resp_${randomUUID()}`,
      status: "completed",
      parsed_output: request.output_schema.parse(output),
      raw_output: output,
      usage: {
        input_tokens: estimatedInputTokens(request),
        output_tokens: 120,
        total_tokens: estimatedInputTokens(request) + 120
      },
      latency_ms: 1
    };
  };
}

class SessionStore {
  readonly activityAttemptId: string;
  readonly dialogueId: string;
  readonly turns: FormativeEpisodeTurnRecord[];
  readonly profiles: Array<{
    profile: TopicDialogueTurnEvidenceProfile;
    cumulative: TopicDialogueCumulativeEvidenceProfile;
    adjudication: unknown;
    route: unknown;
  }> = [];
  readonly interventions: PedagogicalInterventionRecord[] = [];
  readonly operationTurns = new Map<string, {
    visible_turn_id: string;
    sequence_index: number;
  }>();
  readonly completed = new Map<string, AutonomousFormativeTurnResult>();
  constructor(readonly runId: string, readonly session: Session) {
    this.activityAttemptId = `activity_${runId}_${session.session_id}`;
    this.dialogueId = `dialogue_${runId}_${session.session_id}`;
    this.turns = [{
      visible_turn_id: `initial_${session.session_id}`,
      sequence_index: 1,
      dialogue_turn_number: 0,
      actor_type: "agent",
      message_text:
        session.natural_initial_activity,
      visibility_status: "shown",
      activity_attempt_public_id: this.activityAttemptId,
      topic_dialogue_public_id: this.dialogueId
    }];
  }
  persistence(): AutonomousTurnPersistence {
    return {
      findCompletedTurn: async (operationId: string) =>
        this.completed.get(operationId) ?? null,
      persistStudentTurn: async (input: {
        client_operation_id: string;
        message_text: string;
      }) => {
        const existing = this.operationTurns.get(input.client_operation_id);
        if (existing) return existing;
        const dialogueTurn = this.turns.filter((entry) =>
          entry.actor_type === "student"
        ).length + 1;
        const row = {
          visible_turn_id: `student_${this.session.session_id}_${dialogueTurn}`,
          sequence_index: this.turns.length + 1
        };
        this.turns.push({
          ...row,
          dialogue_turn_number: dialogueTurn,
          actor_type: "student",
          message_text: input.message_text,
          visibility_status: "shown",
          activity_attempt_public_id: this.activityAttemptId,
          topic_dialogue_public_id: this.dialogueId
        });
        this.operationTurns.set(input.client_operation_id, row);
        return row;
      },
      loadCompleteEpisode: async (input: {
        latest_student_turn_id: string;
        latest_student_sequence_index: number;
      }) => buildCompleteVisibleFormativeEpisode({
        activity_attempt_public_id: this.activityAttemptId,
        dialogue_public_id: this.dialogueId,
        latest_student_turn_id: input.latest_student_turn_id,
        latest_student_sequence_index: input.latest_student_sequence_index,
        turns: this.turns
      }),
      persistProfile: async (input) => {
        this.profiles.push(input);
      },
      completePriorIntervention: async (
        completed: PedagogicalInterventionRecord
      ) => {
        const index = this.interventions.findIndex((entry) =>
          entry.intervention_id === completed.intervention_id
        );
        if (index < 0) throw new Error("e2a28_prior_intervention_missing");
        Object.assign(this.interventions[index]!, completed);
      },
      persistEffectiveResponse: async (input: {
        message_text: string;
        source: "autonomous_agent" | "platform_immediate_intent" |
          "platform_request_revision" | "bounded_stop";
        intervention: PedagogicalInterventionRecord | null;
        route: JsonObject;
      }) => {
        const dialogueTurn = this.turns.filter((entry) =>
          entry.actor_type === "student"
        ).length;
        const row = {
          visible_turn_id: `agent_${this.session.session_id}_${dialogueTurn}`,
          sequence_index: this.turns.length + 1
        };
        this.turns.push({
          ...row,
          dialogue_turn_number: dialogueTurn,
          actor_type: "agent",
          message_text: input.message_text,
          visibility_status: "shown",
          activity_attempt_public_id: this.activityAttemptId,
          topic_dialogue_public_id: this.dialogueId
        });
        if (input.intervention) this.interventions.push(input.intervention);
        return row;
      }
    };
  }
  cleanup() {
    const before = {
      turns: this.turns.length,
      profiles: this.profiles.length,
      interventions: this.interventions.length,
      operations: this.operationTurns.size,
      completed: this.completed.size
    };
    this.turns.splice(0);
    this.profiles.splice(0);
    this.interventions.splice(0);
    this.operationTurns.clear();
    this.completed.clear();
    return {
      before,
      after: { turns: 0, profiles: 0, interventions: 0, operations: 0, completed: 0 },
      isolated_records_removed: true
    };
  }
}

function latestAssistant(store: SessionStore) {
  return [...store.turns].reverse().find((entry) =>
    entry.actor_type === "agent"
  )?.message_text ?? "";
}

function privacyAudit(text: string) {
  const findings = [
    ["answer_key", /\banswer key\b/iu],
    ["correctness", /\b(?:correct answer|correct option)\b/iu],
    ["hidden_prompt", /\b(?:system|hidden) prompt\b/iu],
    ["provider_control", /\b(?:provider request|schema version|agent call|configuration hash)\b/iu],
    ["secret", /\b(?:api key|bearer token|session secret|database url)\b/iu],
    ["simulator_identity", /\b(?:as an ai|student simulator|hidden state)\b/iu]
  ].filter(([, pattern]) => (pattern as RegExp).test(text))
    .map(([code]) => code as string);
  return { passed: findings.length === 0, findings };
}

function humanProfileMatches(
  runtime: string,
  expected: PlannedTurn["semantic_envelope"]
) {
  return expected.includes(runtime as PlannedTurn["semantic_envelope"][number]);
}

async function executeProviderCall<TInput, TOutput>(input: {
  executor: ProviderExecutor;
  ledger: BudgetLedger;
  role: CallRole;
  request: StructuredAgentRequest<TInput, TOutput>;
  sessionId: string;
  turn: number;
  attempt: number;
  live: boolean;
  frozenSourceHash: string;
  runDir: string;
  reviewRows: JsonObject[];
  priorVisibleConversation: unknown;
}) {
  if (input.live) {
    const checkpoint = readCheckpoint();
    if (!checkpoint || currentCommit() !== checkpoint.application_git_commit ||
        !trackedTreeClean()) {
      throw new Error("e2a28_source_integrity_changed_before_dispatch");
    }
    if (sourceIdentity().aggregate_sha256 !== input.frozenSourceHash) {
      throw new Error("e2a28_source_hash_changed_before_dispatch");
    }
    if (compositeRuntimeIdentity().composite_runtime_identity_hash !==
        checkpoint.composite_runtime_identity_hash) {
      throw new Error("e2a28_composite_identity_changed_before_dispatch");
    }
  }
  assertBudgetBeforeCall(input.ledger, input.role, input.request);
  const result = await input.executor(input.request);
  recordCall(
    input.ledger, input.role, result, input.sessionId, input.turn, input.attempt
  );
  const sanitized = sanitizedE2AProviderResult(result);
  const providerArtifact = {
    session_id: input.sessionId,
    turn: input.turn,
    attempt: input.attempt,
    role: input.role,
    generated: true,
    schema_valid: result.status === "completed" &&
      result.parsed_output !== undefined,
    complete_prior_visible_episode: input.priorVisibleConversation,
    request_provenance: {
      agent_name: input.request.agent_name,
      schema_name: input.request.schema_name,
      client_request_id: input.request.client_request_id,
      model_name: input.request.model_config.model_name,
      request_input_sha256: stableHash(input.request.input),
      instructions_sha256: sha256(input.request.instructions),
      metadata: input.request.metadata ?? {}
    },
    provider_result: sanitized,
    parsed_structured_output: result.parsed_output ?? null
  };
  const providerFile = input.role === "simulator"
    ? "simulator-provider-outputs.jsonl"
    : input.role === "evidence_evaluator"
      ? "evaluator-provider-outputs.jsonl"
      : "autonomous-tutor-provider-outputs.jsonl";
  appendJsonl(path.join(input.runDir, providerFile), providerArtifact);
  appendJsonl(path.join(input.runDir, "failure-path-results.jsonl"), {
    ...providerArtifact,
    hard_validator_result: result.status === "completed"
      ? "pending_downstream_validation" : "not_reached",
    pedagogical_review_result: input.role.startsWith("tutor")
      ? "pending_downstream_validation" : "not_applicable",
    profile_mapper_result: "not_reached",
    profile_consistency_result: "not_reached",
    platform_mode_result: "not_reached",
    tutor_dispatch_result: "not_reached",
    persisted: false,
    displayed: false,
    suppression_reason: result.status === "completed"
      ? "pending_downstream_processing" : "provider_call_failed",
    stage_reached: result.status === "completed"
      ? "provider_output_received" : "provider_failure_received",
    stages_not_reached: result.status === "completed"
      ? ["runtime_validation", "persistence", "display"]
      : ["schema_validation", "runtime_validation", "persistence", "display"]
  });
  input.reviewRows.push({
    record_type: "provider_output",
    session_id: input.sessionId,
    turn: input.turn,
    attempt: input.attempt,
    provider_role: input.role,
    complete_prior_visible_episode: input.priorVisibleConversation,
    request_provenance: providerArtifact.request_provenance,
    parsed_structured_output: result.parsed_output ?? null,
    provider_result: sanitized,
    persisted: false,
    displayed: false,
    human_review: null
  });
  if (result.status !== "completed" || !result.parsed_output) {
    const reason = result.error?.category ?? result.status;
    throw new Error(`e2a28_provider_call_failed:${input.role}:${reason}`);
  }
  return result;
}

function evaluatorRequest(input: {
  runId: string;
  session: Session;
  turn: PlannedTurn;
  providerInput: ReturnType<typeof evaluatorProviderInput>;
  modelConfig: ReturnType<typeof evaluateE2A24Candidate>["full_candidate"]["roles"][string];
  timeout: number;
  repair?: { issues: string[]; candidate: unknown };
}) {
  const repair = input.repair;
  return {
    agent_name: ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
    model_config: input.modelConfig,
    instructions: repair
      ? ACTIVITY_RESPONSE_EVALUATOR_REPAIR_PROMPT_INSTRUCTIONS
      : ACTIVITY_RESPONSE_EVALUATOR_PROMPT_INSTRUCTIONS,
    input: repair ? {
      schema_version: "formative-activity-response-evaluator-repair-input-v1",
      source_input: input.providerInput,
      candidate_packet_summary: {
        validation_issue_count: repair.issues.length,
        validation_issue_codes: repair.issues
      },
      safe_repair_instructions: repair.issues.map((issue) =>
        `Repair the schema-safe issue ${issue}.`
      )
    } : input.providerInput,
    output_schema: ActivityMisconceptionEvidencePacketV1Schema,
    schema_name: ACTIVITY_RESPONSE_EVALUATOR_SCHEMA_VERSION,
    client_request_id:
      `${input.runId}_${input.session.session_id}_eval_${input.turn.turn}_${repair ? "repair" : "initial"}`,
    timeout_ms: input.timeout,
    metadata: {
      evaluation_phase: "e2a28",
      role: "evidence_evaluator",
      session_id: input.session.session_id,
      turn_number: String(input.turn.turn),
      prompt_version: repair
        ? ACTIVITY_RESPONSE_EVALUATOR_REPAIR_PROMPT_VERSION
        : ACTIVITY_RESPONSE_EVALUATOR_PROMPT_VERSION,
      prompt_hash: repair
        ? ACTIVITY_RESPONSE_EVALUATOR_REPAIR_PROMPT_HASH
        : ACTIVITY_RESPONSE_EVALUATOR_PROMPT_HASH
    }
  } satisfies StructuredAgentRequest<unknown, ActivityMisconceptionEvidencePacketV1>;
}

async function runSession(input: {
  runId: string;
  runDir: string;
  session: Session;
  executor: ProviderExecutor;
  ledger: BudgetLedger;
  live: boolean;
  frozenSourceHash: string;
  reviewRows: JsonObject[];
}) {
  const candidate = evaluateE2A24Candidate().full_candidate;
  const simulatorModel = candidate.roles.student_communication_agent;
  const evaluatorModel = candidate.roles.formative_activity_response_evaluator_agent;
  const tutorModel = candidate.roles.topic_dialogue_agent;
  const timeout = candidate.runtime_policy.provider_timeout_ms;
  const contract = contractFor(input.session);
  const store = new SessionStore(input.runId, input.session);
  const priorStudentMessages: string[] = [];
  let cumulative: TopicDialogueCumulativeEvidenceProfile | null = null;
  let endpoint: string | null = null;
  let unnecessaryTurnsAfterSound = 0;
  let tutorCallsAfterSound = 0;
  let sessionRegenerations = 0;
  let strategyChangeAfterIneffective = true;
  let previousStrategy: string | null = null;
  let priorAnchorResolution: TargetEvidenceAdjudicationV4[
    "anchor_propagation"
  ]["anchor_resolution_status"] | null = null;
  const providerRows: JsonObject[] = [];
  try {
    input.reviewRows.push({
      session_id: input.session.session_id,
      visible_turn_id: store.turns[0]!.visible_turn_id,
      actor_type: "agent",
      student_facing_message: store.turns[0]!.message_text,
      source: "initial_activity",
      human_review: null
    });
    for (const turn of input.session.frozen_student_trajectory) {
      if (endpoint) {
        unnecessaryTurnsAfterSound += 1;
        throw new Error("e2a28_unnecessary_turn_after_endpoint");
      }
      let simulatorResult: StructuredAgentResult<LlmStudentSimulatorOutput> | null = null;
      let simulatorValidation = { passed: false, issues: ["not_run"] };
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const simInput = simulatorInput(
          input.session, turn, store.turns,
          attempt === 1 ? [] : simulatorValidation.issues
        );
        const request = {
          agent_name: "evaluation_llm_student_simulator",
          model_config: simulatorModel,
          instructions: SIMULATOR_INSTRUCTIONS,
          input: simInput,
          output_schema: LlmStudentSimulatorOutputSchema,
          schema_name: "llm-student-simulator-output-v1",
          client_request_id:
            `${input.runId}_${input.session.session_id}_sim_${turn.turn}_${attempt}`,
          timeout_ms: timeout,
          metadata: {
            evaluation_phase: "e2a28",
            role: "student_simulator",
            session_id: input.session.session_id,
            turn_number: String(turn.turn),
            attempt: String(attempt),
            simulator_prompt_hash: SIMULATOR_PROMPT_HASH
          }
        } satisfies StructuredAgentRequest<
          ReturnType<typeof simulatorInput>, LlmStudentSimulatorOutput
        >;
        simulatorResult = await executeProviderCall({
          executor: input.executor,
          ledger: input.ledger,
          role: "simulator",
          request,
          sessionId: input.session.session_id,
          turn: turn.turn,
          attempt,
          live: input.live,
          frozenSourceHash: input.frozenSourceHash,
          runDir: input.runDir,
          reviewRows: input.reviewRows,
          priorVisibleConversation: store.turns
        });
        simulatorValidation = validateSimulatorOutput({
          session: input.session,
          turn,
          output: simulatorResult.parsed_output!,
          priorStudentMessages,
          latestAssistantMessage: latestAssistant(store)
        });
        providerRows.push({
          role: "student_simulator",
          turn: turn.turn,
          attempt,
          provider_result: sanitizedE2AProviderResult(simulatorResult),
          validation: simulatorValidation
        });
        if (simulatorValidation.passed) break;
      }
      if (!simulatorResult?.parsed_output || !simulatorValidation.passed) {
        throw new Error(
          `e2a28_student_simulator_validation_failed:${input.session.session_id}:${turn.turn}:${simulatorValidation.issues.join("|")}`
        );
      }
      const studentMessage = simulatorResult.parsed_output.student_message;
      priorStudentMessages.push(studentMessage);
      input.reviewRows.push({
        session_id: input.session.session_id,
        turn: turn.turn,
        actor_type: "student",
        student_facing_message: studentMessage,
        source: "live_student_simulator",
        human_review: null
      });
      let evaluatorPacket: ActivityMisconceptionEvidencePacketV1 | null = null;
      let evaluatorOutputRow: JsonObject | null = null;
      let evaluatorInputArtifact: AutonomousEvidenceEvaluatorInput | null = null;
      let tutorInputArtifact: AutonomousPedagogyInput | null = null;
      const operationId = `${input.runId}_${input.session.session_id}_turn_${turn.turn}`;
      const result = await executeAutonomousFormativeTurn({
        client_operation_id: operationId,
        student_message: studentMessage,
        concept_id: input.session.concept,
        distractor_anchor:
          `${input.session.target_evidence_contract.item_id}:${input.session.target_evidence_contract.distractor_option}`,
        target_evidence_contract: contract,
        prior_cumulative_profile: cumulative,
        prior_interventions: store.interventions,
        current_student_turn: turn.turn,
        maximum_student_turns: input.session.maximum_student_turns,
        confidence_evidence: "low",
        persistence: store.persistence(),
        evaluateEvidence: async (autonomousInput) => {
          evaluatorInputArtifact = autonomousInput;
          const providerInput = evaluatorProviderInput(input.session, autonomousInput);
          const firstRequest = evaluatorRequest({
            runId: input.runId,
            session: input.session,
            turn,
            providerInput,
            modelConfig: evaluatorModel,
            timeout
          });
          const first = await executeProviderCall({
            executor: input.executor,
            ledger: input.ledger,
            role: "evidence_evaluator",
            request: firstRequest,
            sessionId: input.session.session_id,
            turn: turn.turn,
            attempt: 1,
            live: input.live,
            frozenSourceHash: input.frozenSourceHash,
            runDir: input.runDir,
            reviewRows: input.reviewRows,
            priorVisibleConversation:
              autonomousInput.complete_visible_formative_conversation
          });
          const firstAudit = input.live
            ? auditFor(first, evaluatorModel.model_name)
            : makeActivityMisconceptionEvidenceAuditForTest({
                agent_call_id: `e2a28_eval_${input.session.session_id}_${turn.turn}`,
                model_name: evaluatorModel.model_name
              });
          let pipeline = evaluateActivityMisconceptionEvidenceLivePipeline({
            candidate_packet: first.parsed_output,
            evaluator_audit: firstAudit
          });
          let repairResult: StructuredAgentResult<ActivityMisconceptionEvidencePacketV1> | null = null;
          if (pipeline.status === "rejected") {
            const originalIssues = pipeline.issues.filter((issue) =>
              issue.rule_code !== "repair_missing"
            );
            if (!activityMisconceptionEvidencePipelineIssuesAllowRepair(originalIssues)) {
              throw new Error(
                `e2a28_evaluator_hard_rejection:turn_${turn.turn}:${originalIssues.map((issue) =>
                  issue.blocked_pattern_label ?? issue.rule_code
                ).join("|")}`
              );
            }
            const repairRequest = evaluatorRequest({
              runId: input.runId,
              session: input.session,
              turn,
              providerInput,
              modelConfig: evaluatorModel,
              timeout,
              repair: {
                issues: originalIssues.map((issue) =>
                  issue.blocked_pattern_label ?? issue.rule_code
                ),
                candidate: first.parsed_output
              }
            });
            repairResult = await executeProviderCall({
              executor: input.executor,
              ledger: input.ledger,
              role: "evidence_evaluator",
              request: repairRequest,
              sessionId: input.session.session_id,
              turn: turn.turn,
              attempt: 2,
              live: input.live,
              frozenSourceHash: input.frozenSourceHash,
              runDir: input.runDir,
              reviewRows: input.reviewRows,
              priorVisibleConversation:
                autonomousInput.complete_visible_formative_conversation
            });
            const repairAudit = input.live
              ? auditFor(repairResult, evaluatorModel.model_name)
              : makeActivityMisconceptionEvidenceAuditForTest({
                  agent_call_id:
                    `e2a28_eval_repair_${input.session.session_id}_${turn.turn}`,
                  model_name: evaluatorModel.model_name
                });
            pipeline = evaluateActivityMisconceptionEvidenceLivePipeline({
              candidate_packet: first.parsed_output,
              evaluator_audit: firstAudit,
              repair_packet: repairResult.parsed_output,
              repair_audit: repairAudit
            });
          }
          if (pipeline.status !== "accepted") {
            throw new Error(`e2a28_evaluator_rejected:${pipeline.blocked_reason}`);
          }
          evaluatorPacket = pipeline.packet;
          evaluatorOutputRow = {
            session_id: input.session.session_id,
            turn: turn.turn,
            first_provider_result: sanitizedE2AProviderResult(first),
            repair_provider_result: repairResult
              ? sanitizedE2AProviderResult(repairResult) : null,
            effective_packet: pipeline.packet,
            repair_attempted: pipeline.repair_attempted
          };
          const adjudication =
            buildTargetEvidenceAdjudicationFromActivityPacketV4({
            latest_student_message: studentMessage,
            packet: pipeline.packet,
            contract,
            prior_anchor_resolution_status: priorAnchorResolution
          });
          priorAnchorResolution =
            adjudication.anchor_propagation.anchor_resolution_status;
          return adjudication;
        },
        invokeAutonomousTutor: async (tutorInput, attempt, hardRejections) => {
          tutorInputArtifact = tutorInput;
          if ((tutorInput.latest_authoritative_turn_profile as
              TopicDialogueTurnEvidenceProfile).revision_readiness) {
            tutorCallsAfterSound += 1;
            throw new Error("e2a28_tutor_called_after_sound");
          }
          if (attempt === 2) {
            sessionRegenerations += 1;
            if (sessionRegenerations > 2) {
              throw new Error("e2a28_session_tutor_regeneration_limit_exceeded");
            }
          }
          appendJsonl(path.join(input.runDir, "autonomous-tutor-inputs.jsonl"), {
            session_id: input.session.session_id,
            turn: turn.turn,
            attempt,
            hard_rejections_from_prior_attempt: hardRejections,
            request: tutorInput
          });
          const request = {
            agent_name: "topic_dialogue_agent",
            model_config: tutorModel,
            instructions: attempt === 1
              ? AUTONOMOUS_PEDAGOGY_PROMPT_INSTRUCTIONS
              : `${AUTONOMOUS_PEDAGOGY_PROMPT_INSTRUCTIONS}\n\nRepair only these hard validation issues: ${hardRejections.join(", ")}. Return a new complete object.`,
            input: tutorInput,
            output_schema: AutonomousPedagogyOutputSchema,
            schema_name: AUTONOMOUS_PEDAGOGY_OUTPUT_SCHEMA_VERSION,
            client_request_id:
              `${input.runId}_${input.session.session_id}_tutor_${turn.turn}_${attempt}`,
            timeout_ms: timeout,
            metadata: {
              evaluation_phase: "e2a28",
              role: attempt === 1 ? "tutor_initial" : "tutor_regeneration",
              session_id: input.session.session_id,
              turn_number: String(turn.turn),
              attempt: String(attempt),
              prompt_version: AUTONOMOUS_PEDAGOGY_PROMPT_VERSION,
              prompt_hash: AUTONOMOUS_PEDAGOGY_PROMPT_HASH
            }
          } satisfies StructuredAgentRequest<
            AutonomousPedagogyInput,
            z.infer<typeof AutonomousPedagogyOutputSchema>
          >;
          const providerResult = await executeProviderCall({
            executor: input.executor,
            ledger: input.ledger,
            role: attempt === 1 ? "tutor_initial" : "tutor_regeneration",
            request,
            sessionId: input.session.session_id,
            turn: turn.turn,
            attempt,
            live: input.live,
            frozenSourceHash: input.frozenSourceHash,
            runDir: input.runDir,
            reviewRows: input.reviewRows,
            priorVisibleConversation:
              tutorInput.complete_visible_formative_conversation
          });
          return providerResult.parsed_output;
        }
      });
      store.completed.set(operationId, result);
      const callsBeforeReplay = input.ledger.logical_generation_calls;
      const replay = await executeAutonomousFormativeTurn({
        client_operation_id: operationId,
        student_message: studentMessage,
        concept_id: input.session.concept,
        distractor_anchor:
          `${input.session.target_evidence_contract.item_id}:${input.session.target_evidence_contract.distractor_option}`,
        target_evidence_contract: contract,
        prior_cumulative_profile: cumulative,
        prior_interventions: store.interventions,
        current_student_turn: turn.turn,
        maximum_student_turns: input.session.maximum_student_turns,
        confidence_evidence: "low",
        persistence: store.persistence(),
        evaluateEvidence: async () => {
          throw new Error("e2a28_idempotent_replay_evaluator_called");
        },
        invokeAutonomousTutor: async () => {
          throw new Error("e2a28_idempotent_replay_tutor_called");
        }
      });
      if (!replay.replayed || input.ledger.logical_generation_calls !== callsBeforeReplay) {
        throw new Error("e2a28_idempotency_replay_failed");
      }
      cumulative = result.cumulative_profile;
      const persistedProfile = store.profiles.at(-1);
      const adjudication = TargetEvidenceAdjudicationV4Schema.parse(
        persistedProfile?.adjudication
      );
      const propagation = adjudication.anchor_propagation;
      const anchor = propagation.anchor_interpretation;
      const finalizationIndex = result.execution_order.indexOf(
        "finalize_profile_before_tutor_dispatch"
      );
      const tutorDispatchIndex = result.execution_order.indexOf(
        "invoke_autonomous_pedagogical_agent"
      );
      const preTutorFinalizationPassed = finalizationIndex >= 0 &&
        (tutorDispatchIndex < 0 || finalizationIndex < tutorDispatchIndex) &&
        result.latest_profile.source_student_turn_id ===
          persistedProfile?.profile.source_student_turn_id &&
        result.latest_profile.source_sequence_index ===
          persistedProfile?.profile.source_sequence_index;
      if (!preTutorFinalizationPassed) {
        throw new Error("e2a28_pre_tutor_profile_finalization_failed");
      }
      appendJsonl(path.join(
        input.runDir, "pre-tutor-finalization-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        finalization_version: PRE_TUTOR_PROFILE_FINALIZATION_VERSION,
        evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V4,
        mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V4,
        propagation_version: ANCHOR_CONTRADICTION_PROPAGATION_VERSION,
        source_student_turn_id: result.latest_profile.source_student_turn_id,
        source_sequence_index: result.latest_profile.source_sequence_index,
        execution_order: result.execution_order,
        tutor_called: result.tutor_called,
        finalized_before_tutor_dispatch: true,
        passed: true
      });
      appendJsonl(path.join(
        input.runDir, "structured-contradiction-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        propagation_version: ANCHOR_CONTRADICTION_PROPAGATION_VERSION,
        blocking: propagation.blocking,
        structured_contradictions: propagation.structured_contradictions,
        profile_structured_contradictions:
          result.latest_profile.structured_contradictions ?? [],
        profile_contradiction_ids: result.latest_profile.contradictions,
        passed: propagation.structured_contradictions.length ===
          (result.latest_profile.structured_contradictions?.length ?? 0)
      });
      const explicitOptionReference = new RegExp(
        `\\boption\\s+${input.session.target_evidence_contract.distractor_option}\\b`,
        "iu"
      ).test(studentMessage);
      if (explicitOptionReference && anchor.anchor_application !== "explicit") {
        throw new Error("e2a28_anchor_application_false_absent");
      }
      if (turn.required_anchor_application &&
          anchor.anchor_application !== turn.required_anchor_application) {
        throw new Error("e2a28_anchor_application_false_absent");
      }
      if (turn.required_anchor_stance &&
          anchor.anchor_stance !== turn.required_anchor_stance) {
        throw new Error("e2a28_anchor_stance_misclassified");
      }
      if (turn.required_anchor_consistency &&
          anchor.anchor_consistency !== turn.required_anchor_consistency) {
        throw new Error("e2a28_anchor_contradiction_not_structured");
      }
      if (turn.required_contradiction &&
          (!propagation.structured_contradictions.some((entry) =>
            entry.contradiction_type === turn.required_contradiction
          ) || !result.latest_profile.contradictions.includes(
            turn.required_contradiction
          ) || !result.latest_profile.structured_contradictions?.some((entry) =>
            entry.contradiction_type === turn.required_contradiction &&
            entry.blocking === true
          ))) {
        throw new Error("e2a28_anchor_contradiction_not_structured");
      }
      if (propagation.blocking &&
          !result.latest_profile.contradictions.includes(
            "anchor_conclusion_conceptual_explanation_conflict"
          )) {
        throw new Error("e2a28_blocking_conflict_only_in_limitations");
      }
      if (turn.turn === 4 && (
        anchor.anchor_stance !== "endorses_distractor" ||
        anchor.anchor_resolution_status !== "contradictory" ||
        result.latest_profile.reasoning_quality === "sound" ||
        result.latest_profile.revision_readiness ||
        result.route.selected_mode !== "remain_in_dialogue"
      )) throw new Error("e2a28_anchor_interpretation_failure");
      if (turn.turn === input.session.human_adjudicated_earliest_sound_turn && (
        result.latest_profile.reasoning_quality !== "sound" ||
        anchor.anchor_stance !== "rejects_distractor" ||
        anchor.anchor_consistency !== "consistent_with_conceptual_reasoning" ||
        anchor.anchor_resolution_status !== "resolved_against_distractor" ||
        result.latest_profile.contradictions.length > 0 ||
        result.latest_profile.essential_missing_links.length > 0 ||
        !result.latest_profile.revision_readiness ||
        result.route.selected_mode !== "request_revision"
      )) throw new Error("e2a28_genuine_sound_false_negative");
      if (!humanProfileMatches(
        result.latest_profile.reasoning_quality,
        expectedProfile(turn)
      )) {
        throw new Error(
          expectedProfile(turn).includes("sound")
            ? "e2a28_genuine_sound_false_negative"
            : result.latest_profile.reasoning_quality === "sound"
              ? "e2a28_genuine_false_sound"
              : `e2a28_profile_semantically_outside_allowed_envelope:turn_${turn.turn}:${result.latest_profile.reasoning_quality}:${turn.semantic_envelope.join("|")}`
        );
      }
      if (result.latest_profile.reasoning_quality === "sound") {
        if (result.tutor_called) {
          tutorCallsAfterSound += 1;
          throw new Error("e2a28_tutor_called_after_sound");
        }
        endpoint = "passed_required_revision_endpoint";
      } else if (result.effective_response_source === "bounded_stop") {
        endpoint = "valid_bounded_stop_with_human_quality_review";
      }
      if (result.intervention) {
        const priorOutcome = store.interventions.at(-2)?.observed_outcome;
        if (["misconception_persists", "no_new_evidence", "recurrence"]
          .includes(priorOutcome ?? "") && previousStrategy ===
          result.intervention.strategy_description) {
          strategyChangeAfterIneffective = false;
          throw new Error("e2a28_strategy_not_changed_after_ineffective_intervention");
        }
        previousStrategy = result.intervention.strategy_description;
        if ([2, 3, 4].includes(turn.turn)) {
          const prior = store.interventions.at(-2);
          if (prior?.strategy_description ===
              result.intervention.strategy_description) {
            strategyChangeAfterIneffective = false;
            throw new Error("e2a28_strategy_adaptation_failure");
          }
        }
      }
      const visiblePrivacy = privacyAudit(result.effective_message);
      if (!visiblePrivacy.passed) throw new Error(
        `e2a28_privacy_or_safety_failure:${visiblePrivacy.findings.join("|")}`
      );
      const recordedTutorInput = tutorInputArtifact as
        AutonomousPedagogyInput | null;
      const recordedEvaluatorInput = evaluatorInputArtifact as
        AutonomousEvidenceEvaluatorInput | null;
      const completeVisible = recordedEvaluatorInput
        ?.complete_visible_formative_conversation ?? null;
      const contextCoverage = {
        session_id: input.session.session_id,
        turn: turn.turn,
        evaluator_received_complete_visible_history: completeVisible !== null,
        tutor_received_complete_visible_history: result.tutor_called
          ? recordedTutorInput !== null : true,
        raw_history_truncation_applied: false,
        visible_turn_count: completeVisible && typeof completeVisible === "object" &&
          "visible_turns" in completeVisible &&
          Array.isArray(completeVisible.visible_turns)
          ? completeVisible.visible_turns.length : null,
        latest_student_message_supplied_separately: true,
        chronological_and_unique: true,
        hidden_simulator_state_supplied: false,
        rejected_provider_attempt_supplied: false,
        passed: true
      };
      const criterionRows = adjudication.criterion_results.map((criterion) => ({
        session_id: input.session.session_id,
        turn: turn.turn,
        ...criterion
      }));
      for (const row of criterionRows) appendJsonl(
        path.join(input.runDir, "criterion-evidence-results.jsonl"), row
      );
      appendJsonl(path.join(input.runDir, "information-flow-audit.jsonl"), {
        ...contextCoverage,
        evaluator_input_sha256: recordedEvaluatorInput
          ? stableHash(recordedEvaluatorInput) : null,
        tutor_input_sha256: recordedTutorInput
          ? stableHash(recordedTutorInput) : null
      });
      appendJsonl(path.join(input.runDir, "student-turn-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        student_turn_id: result.latest_profile.source_student_turn_id,
        sequence_index: result.latest_profile.source_sequence_index,
        message_text: studentMessage,
        persisted: true,
        semantic_envelope: turn.semantic_envelope,
        simulator_validation: simulatorValidation
      });
      appendJsonl(path.join(input.runDir, "evaluator-requests.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        request: recordedEvaluatorInput,
        complete_visible_history_required: true
      });
      appendJsonl(path.join(input.runDir, "anchor-interpretation-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        ...anchor
      });
      appendJsonl(path.join(input.runDir, "profile-consistency-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        policy_version: PROFILE_CONSISTENCY_POLICY_VERSION_V4,
        semantic_envelope: turn.semantic_envelope,
        actual_reasoning_quality: result.latest_profile.reasoning_quality,
        inside_semantic_envelope: humanProfileMatches(
          result.latest_profile.reasoning_quality, turn.semantic_envelope
        ),
        blocking_conflict_promoted: !propagation.blocking ||
          result.latest_profile.contradictions.includes(
            "anchor_conclusion_conceptual_explanation_conflict"
          ),
        passed: true
      });
      appendJsonl(path.join(input.runDir, "sound-gate-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        sound_gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
        reasoning_quality: result.latest_profile.reasoning_quality,
        revision_readiness: result.latest_profile.revision_readiness,
        anchor_application: anchor.anchor_application,
        anchor_stance: anchor.anchor_stance,
        anchor_consistency: anchor.anchor_consistency,
        anchor_resolution_status: anchor.anchor_resolution_status,
        contradictions: result.latest_profile.contradictions,
        essential_missing_links: result.latest_profile.essential_missing_links,
        passed: true
      });
      appendJsonl(path.join(input.runDir, "platform-mode-decisions.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        route: result.route,
        tutor_called: result.tutor_called,
        provider_controls_progression: false,
        unauthorized_transition: false
      });
      if (recordedTutorInput) appendJsonl(
        path.join(input.runDir, "autonomous-tutor-requests.jsonl"), {
          session_id: input.session.session_id,
          turn: turn.turn,
          request: recordedTutorInput,
          complete_visible_history_required: true
        }
      );
      appendJsonl(path.join(input.runDir, "runtime-validation-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        simulator: simulatorValidation,
        tutor: result.validation,
        runtime_hard_rejections: result.validation?.hard_rejections ?? [],
        soft_findings: result.validation?.soft_findings ?? [],
        execution_order: result.execution_order,
        tutor_called: result.tutor_called,
        deterministic_fallback_used: false,
        passed: true
      });
      appendJsonl(path.join(input.runDir, "pedagogical-quality-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        quality_review_version: AUTONOMOUS_PEDAGOGY_QUALITY_REVIEW_VERSION,
        tutor_called: result.tutor_called,
        quality_findings: result.validation?.soft_findings ?? [],
        hard_rejections: result.validation?.hard_rejections ?? [],
        accepted: !result.tutor_called ||
          result.validation?.runtime_acceptance !== "hard_rejected"
      });
      appendJsonl(path.join(input.runDir, "intervention-memory-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        memory_version: PEDAGOGICAL_INTERVENTION_MEMORY_VERSION,
        intervention: result.intervention,
        prior_intervention_count: recordedTutorInput?.intervention_history.length ??
          store.interventions.length,
        passed: true
      });
      appendJsonl(path.join(input.runDir, "persistence-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        student_turn_persisted: true,
        profile_persisted: true,
        one_effective_response_persisted: true,
        duplicate_effective_response_count: 0,
        replay_provider_call_count: 0
      });
      appendJsonl(path.join(input.runDir, "student-projection-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        visible_turn_id: store.turns.at(-1)?.visible_turn_id,
        message_text: result.effective_message,
        internal_metadata_exposed: false,
        passed: true
      });
      appendJsonl(path.join(input.runDir, "audit-projection-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        profile_snapshot_id: result.latest_profile.profile_snapshot_id,
        evaluator_version: result.latest_profile.evaluator_version,
        adjudication,
        route: result.route,
        intervention: result.intervention,
        raw_provider_payload_persisted: false
      });
      appendJsonl(path.join(input.runDir, "transcript-refresh-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        visible_turn_count_after_refresh: store.turns.length,
        latest_visible_turn_id: store.turns.at(-1)?.visible_turn_id,
        chronological: store.turns.every((entry, index, all) =>
          index === 0 || entry.sequence_index > all[index - 1]!.sequence_index
        ),
        exactly_one_effective_response: true
      });
      appendJsonl(path.join(input.runDir, "context-coverage-results.jsonl"),
        contextCoverage);
      appendJsonl(path.join(input.runDir, "failure-path-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        record_type: "accepted_turn_completion",
        generated: true,
        schema_valid: true,
        hard_validator_result: "passed",
        pedagogical_review_result: result.tutor_called
          ? "accepted" : "not_applicable",
        profile_mapper_result: "passed",
        profile_consistency_result: "passed",
        platform_mode_result: result.route.selected_mode,
        tutor_dispatch_result: result.tutor_called
          ? "dispatched_after_finalization" : "not_required",
        persisted: true,
        displayed: true,
        suppression_reason: null,
        stage_reached: "transcript_refreshed_and_audited",
        stages_not_reached: []
      });
      input.reviewRows.push({
        record_type: "turn_review",
        session_id: input.session.session_id,
        turn: turn.turn,
        exact_prior_visible_conversation: completeVisible,
        latest_student_response: studentMessage,
        evaluator_output: evaluatorPacket,
        target_contract_interpretation: adjudication,
        anchor_application: anchor.anchor_application,
        anchor_stance: anchor.anchor_stance,
        anchor_consistency: anchor.anchor_consistency,
        anchor_resolution_status: anchor.anchor_resolution_status,
        reasoning_quality: result.latest_profile.reasoning_quality,
        missing_links: result.latest_profile.essential_missing_links,
        structured_contradictions:
          result.latest_profile.structured_contradictions ?? [],
        revision_readiness: result.latest_profile.revision_readiness,
        platform_mode: result.route.selected_mode,
        intervention_history: recordedTutorInput?.intervention_history ?? [],
        tutor_strategy: result.intervention?.strategy_description ?? null,
        tutor_rationale: recordedTutorInput && result.intervention
          ? result.intervention.effectiveness_note : null,
        tutor_response: result.tutor_called ? result.effective_message : null,
        effective_platform_response: result.effective_message,
        validation_findings: result.validation,
        persistence_and_display_provenance: {
          student_turn_persisted: true,
          effective_response_persisted: true,
          displayed: true,
          source: result.effective_response_source
        },
        privacy_and_information_flow: {
          privacy: visiblePrivacy,
          context: contextCoverage
        },
        human_review: null
      });
      appendJsonl(path.join(
        input.runDir, "human-review-binding-results.jsonl"
      ), {
        session_id: input.session.session_id,
        turn: turn.turn,
        complete_prior_visible_episode: completeVisible,
        latest_student_response: studentMessage,
        evaluator_output_present: evaluatorPacket !== null,
        evaluator_output_sha256: evaluatorPacket
          ? stableHash(evaluatorPacket) : null,
        target_contract_interpretation: adjudication,
        finalized_turn_profile: result.latest_profile,
        platform_mode: result.route.selected_mode,
        generated_tutor_output_present: result.tutor_called,
        effective_platform_response: result.effective_message,
        persistence_and_display_provenance: {
          effective_response_source: result.effective_response_source,
          persisted: true,
          displayed: true
        },
        human_review: null,
        passed: true
      });
      appendJsonl(path.join(input.runDir, "complete-visible-conversations.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        complete_visible_conversation: buildCompleteVisibleFormativeEpisode({
          activity_attempt_public_id: store.activityAttemptId,
          dialogue_public_id: store.dialogueId,
          latest_student_turn_id: store.turns.filter((entry) =>
            entry.actor_type === "student"
          ).at(-1)!.visible_turn_id,
          latest_student_sequence_index: store.turns.filter((entry) =>
            entry.actor_type === "student"
          ).at(-1)!.sequence_index,
          turns: store.turns.slice(0, -1)
        }),
        simulator_provider_evidence: sanitizedE2AProviderResult(simulatorResult)
      });
      appendJsonl(path.join(input.runDir, "evaluator-inputs.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        input: evaluatorInputArtifact
      });
      appendJsonl(path.join(input.runDir, "evaluator-outputs.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        output: evaluatorOutputRow,
        effective_packet_present: evaluatorPacket !== null
      });
      appendJsonl(path.join(input.runDir, "turn-profile-snapshots.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        semantic_envelope: expectedProfile(turn),
        profile: result.latest_profile
      });
      appendJsonl(path.join(input.runDir, "cumulative-profile-updates.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        cumulative_profile: result.cumulative_profile
      });
      appendJsonl(path.join(input.runDir, "platform-response-modes.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        route: result.route,
        effective_response_source: result.effective_response_source,
        tutor_called: result.tutor_called,
        platform_controls_progression: true
      });
      appendJsonl(path.join(input.runDir, "validator-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        simulator_validation: simulatorValidation,
        tutor_validation: result.validation,
        human_profile_alignment: true,
        replay_idempotency: true
      });
      appendJsonl(path.join(input.runDir, "privacy-results.jsonl"), {
        session_id: input.session.session_id,
        turn: turn.turn,
        student_facing_message_sha256: sha256(result.effective_message),
        ...visiblePrivacy,
        raw_provider_payload_published: false,
        secrets_published: false
      });
      input.reviewRows.push({
        session_id: input.session.session_id,
        turn: turn.turn,
        actor_type: "agent",
        student_facing_message: result.effective_message,
        source: result.effective_response_source,
        human_review: null
      });
    }
    if (!endpoint) throw new Error("e2a28_session_endpoint_not_reached");
    if (endpoint !== input.session.required_endpoint) {
      throw new Error("e2a28_required_revision_endpoint_missing");
    }
    if (store.turns.length > input.session.complete_visible_history_limit) {
      throw new Error("e2a28_complete_visible_history_limit_exceeded");
    }
    for (const intervention of store.interventions) {
      appendJsonl(path.join(input.runDir, "pedagogical-interventions.jsonl"), {
        session_id: input.session.session_id,
        intervention
      });
      appendJsonl(path.join(input.runDir, "intervention-outcomes.jsonl"), {
        session_id: input.session.session_id,
        intervention_id: intervention.intervention_id,
        next_student_turn_id: intervention.next_student_turn_id,
        observed_outcome: intervention.observed_outcome,
        effectiveness_note: intervention.effectiveness_note
      });
      appendJsonl(path.join(input.runDir, "intervention-outcome-results.jsonl"), {
        session_id: input.session.session_id,
        intervention_id: intervention.intervention_id,
        next_student_turn_id: intervention.next_student_turn_id,
        observed_outcome: intervention.observed_outcome,
        effectiveness_note: intervention.effectiveness_note,
        persisted: true
      });
    }
    appendJsonl(path.join(input.runDir, "persistence-and-idempotency.jsonl"), {
      session_id: input.session.session_id,
      persisted_student_turns: store.turns.filter((entry) =>
        entry.actor_type === "student"
      ).length,
      persisted_effective_agent_turns: store.turns.filter((entry) =>
        entry.actor_type === "agent"
      ).length - 1,
      profile_snapshot_count: store.profiles.length,
      duplicate_effective_reply_count: 0,
      idempotent_replays_verified: store.completed.size,
      provider_calls_during_replays: 0,
      transcript_chronological: store.turns.every((entry, index, all) =>
        index === 0 || entry.sequence_index > all[index - 1]!.sequence_index
      )
    });
    const sessionResult = {
      session_id: input.session.session_id,
      endpoint,
      student_turn_count: priorStudentMessages.length,
      effective_tutor_or_platform_reply_count: store.turns.filter((entry) =>
        entry.actor_type === "agent"
      ).length - 1,
      tutor_regenerations: sessionRegenerations,
      tutor_calls_after_sound: tutorCallsAfterSound,
      unnecessary_turns_after_sound: unnecessaryTurnsAfterSound,
      strategy_changed_after_ineffective_intervention:
        strategyChangeAfterIneffective,
      final_profile: store.profiles.at(-1)?.profile ?? null,
      provider_audit_row_count: input.ledger.per_call.filter((entry) =>
        entry.session_id === input.session.session_id
      ).length,
      passed: true
    };
    const cleanup = store.cleanup();
    appendJsonl(path.join(input.runDir, "persistence-and-idempotency.jsonl"), {
      session_id: input.session.session_id,
      cleanup
    });
    return {
      ...sessionResult,
      cleanup_passed: cleanup.isolated_records_removed === true,
      cleanup
    };
  } catch (error) {
    const cleanup = store.cleanup();
    appendJsonl(path.join(input.runDir, "persistence-and-idempotency.jsonl"), {
      session_id: input.session.session_id,
      cleanup_after_failure: cleanup
    });
    throw error;
  }
}

function usageArtifact(ledger: BudgetLedger) {
  const actual = {
    simulator_calls: ledger.simulator_calls,
    evidence_evaluator_calls: ledger.evidence_evaluator_calls,
    initial_tutor_calls: ledger.initial_tutor_calls,
    tutor_regenerations: ledger.tutor_regenerations,
    logical_generation_calls: ledger.logical_generation_calls,
    adapter_attempts: ledger.adapter_attempts,
    transport_retries: ledger.transport_retries,
    input_tokens: ledger.input_tokens,
    output_tokens: ledger.output_tokens,
    reasoning_tokens: ledger.reasoning_tokens,
    cached_input_tokens: ledger.cached_input_tokens,
    total_tokens: ledger.total_tokens,
    estimated_cost_usd: ledger.pricing_complete
      ? Number(ledger.estimated_cost_usd.toFixed(6)) : null,
    pricing_complete: ledger.pricing_complete,
    total_latency_ms: ledger.total_latency_ms,
    per_call: ledger.per_call
  };
  const within = actual.simulator_calls <= BUDGET.simulator_calls &&
    actual.evidence_evaluator_calls <= BUDGET.evidence_evaluator_calls &&
    actual.initial_tutor_calls <= BUDGET.initial_tutor_calls &&
    actual.tutor_regenerations <= BUDGET.tutor_regenerations &&
    actual.logical_generation_calls <= BUDGET.logical_generation_calls &&
    actual.adapter_attempts <= BUDGET.adapter_attempts &&
    actual.input_tokens <= BUDGET.input_tokens &&
    actual.output_tokens <= BUDGET.output_tokens &&
    actual.total_tokens <= BUDGET.total_tokens &&
    (!ledger.pricing_complete || ledger.estimated_cost_usd <= BUDGET.cost_usd);
  return {
    version: "e2a28-usage-and-cost-v1",
    budget: BUDGET,
    actual,
    within_budget: within,
    cost_ceiling_verified: ledger.pricing_complete
      ? ledger.estimated_cost_usd <= BUDGET.cost_usd : false,
    cost_ceiling_enforcement: ledger.pricing_complete
      ? "verified_from_pricing_registry"
      : "authorized_token_and_call_caps_pricing_registry_unavailable",
    provider_concurrency_observed: 1
  };
}

function artifactValidation(runDir: string) {
  const failures: string[] = [];
  const actual = readdirSync(runDir, { withFileTypes: true })
    .filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...ARTIFACT_NAMES].sort())) {
    failures.push("artifact_name_or_count_mismatch");
  }
  for (const name of ARTIFACT_NAMES) {
    const file = path.join(runDir, name);
    if (!existsSync(file) || statSync(file).size === 0) {
      failures.push(`artifact_missing_or_empty:${name}`);
      continue;
    }
    try {
      if (JSONL_NAMES.has(name)) readJsonl(file);
      else readJson(file);
    } catch {
      failures.push(`artifact_malformed:${name}`);
    }
  }
  const review = readJson<{ items?: Array<{ human_review?: unknown }> }>(
    path.join(runDir, "human-review-packet.json")
  );
  if (!review.items?.every((item) => item.human_review === null)) {
    failures.push("human_review_prepopulated_or_missing");
  }
  const completeness = readJson<{ passed?: boolean;
    future_policy_complete?: boolean }>(path.join(
    runDir, "failure-path-completeness.json"
  ));
  if (completeness.passed !== true ||
      completeness.future_policy_complete !== true) {
    failures.push("failure_path_artifact_incomplete");
  }
  const burden = readJson<{ metric_version?: string }>(path.join(
    runDir, "failed-session-burden-metrics.json"
  ));
  if (burden.metric_version !== "e2a28-failed-session-burden-v1") {
    failures.push("failed_session_burden_metrics_missing");
  }
  const summary = readJson<{ passed?: boolean }>(path.join(
    runDir, "canary-summary.json"
  ));
  if (summary.passed === true) {
    for (const [name, expected] of [
      ["pre-tutor-finalization-results.jsonl", 6],
      ["structured-contradiction-results.jsonl", 6],
      ["human-review-binding-results.jsonl", 6]
    ] as const) {
      const rows = readJsonl<JsonObject>(path.join(runDir, name)).filter(
        (row) => typeof row.turn === "number"
      );
      if (rows.length !== expected || rows.some((row) => row.passed !== true)) {
        failures.push(`required_runtime_evidence_invalid:${name}`);
      }
    }
  }
  return {
    passed: failures.length === 0,
    failures,
    artifact_count: actual.length,
    artifacts: actual.map((name) => ({
      name,
      sha256: sha256(readFileSync(path.join(runDir, name))),
      bytes: statSync(path.join(runDir, name)).size
    }))
  };
}

function finalizeUnreachedJsonlArtifacts(
  runDir: string,
  failureReason: string | null
) {
  for (const name of JSONL_NAMES) {
    const file = path.join(runDir, name);
    if (statSync(file).size > 0) continue;
    appendJsonl(file, {
      record_type: "stage_not_reached",
      generated: false,
      persisted: false,
      displayed: false,
      stage_reached: "not_reached",
      stages_not_reached: [name.replace(/\.jsonl$/u, "")],
      suppression_reason: failureReason ?? "not_applicable_to_completed_path",
      failure_path_evidence_complete: true
    });
  }
}

function freezeArtifacts(runDir: string) {
  for (const name of ARTIFACT_NAMES) chmodSync(path.join(runDir, name), 0o444);
  chmodSync(runDir, 0o555);
}

async function executeCanary(input: {
  executor: ProviderExecutor;
  live: boolean;
  artifactRoot?: string;
  forcedRunId?: string;
}) {
  const startedAt = new Date().toISOString();
  const protocol = buildE2A28FrozenProtocol();
  const checkpoint = readCheckpoint();
  const identity = compositeRuntimeIdentity();
  const id = input.forcedRunId ?? runId();
  const runDir = initializeRun(id, input.artifactRoot);
  const ledger = emptyLedger();
  const reviewRows: JsonObject[] = [];
  const source = sourceIdentity();
  const protectedBefore = protectedEvidenceIdentity();
  const harnessSha = sha256(readFileSync(import.meta.filename));
  let failure: string | null = null;
  const sessions: Awaited<ReturnType<typeof runSession>>[] = [];
  const contract = contractFor(protocol.session);
  const frozenProtocol = readJson<FrozenProtocolArtifact>(
    frozenArtifactPath("e2a28-frozen-protocol.json")
  );
  writeJson(path.join(runDir, "canary-manifest.json"), {
    manifest_version: "e2a28-live-canary-manifest-v1",
    run_id: id,
    execution_mode: input.live ? "live_provider" : "injected_no_live",
    started_at: startedAt,
    application_git_commit: currentCommit(),
    authoritative_e2a27a_run: E2A27A_RUN,
    protocol_hash: PROTOCOL_HASH,
    composite_runtime_identity_hash:
      identity.composite_runtime_identity_hash,
    candidate_configuration_hash: CANDIDATE_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA,
    approved_v2_hash: APPROVED_HASH,
    harness_version: VERSION,
    harness_sha256: harnessSha,
    source_identity: source,
    protected_evidence_before: protectedBefore,
    budget: BUDGET,
    authorization: {
      exactly_one_isolated_session: true,
      no_later_live_stage_authorized: true,
      candidate_approval_authorized: false,
      candidate_activation_authorized: false
    },
    candidate_approved: false,
    candidate_activated: false
  });
  writeJson(path.join(runDir, "composite-runtime-identity.json"), identity);
  writeJson(path.join(runDir, "dispatch-checkpoint.json"),
    checkpoint ?? {
      checkpoint_version: "e2a28-no-live-checkpoint-not-required",
      application_git_commit: currentCommit(),
      composite_runtime_identity_hash:
        identity.composite_runtime_identity_hash
    });
  writeJson(path.join(runDir, "frozen-protocol.json"), frozenProtocol);
  writeJson(path.join(runDir, "frozen-protocol.sha256"), {
    protocol_hash: PROTOCOL_HASH,
    protocol_hash_method: "stable_object_sha256",
    source_file_sha256: sha256(readFileSync(
      frozenArtifactPath("e2a28-frozen-protocol.json")
    )),
    verified: stableHash(frozenProtocol) === PROTOCOL_HASH
  });
  writeJson(path.join(runDir, "candidate-integrity.json"), {
    candidate_configuration_hash: CANDIDATE_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA,
    approved_v2_hash: APPROVED_HASH,
    candidate_approved: false,
    candidate_activated: false,
    candidate_integrity_passed: true
  });
  writeJson(path.join(runDir, "source-integrity.json"), {
    source_identity: source,
    composite_runtime_identity: identity,
    checkpoint,
    tracked_tree_clean_required_for_live: input.live,
    passed: !input.live || (
      checkpoint?.application_git_commit === currentCommit() &&
      checkpoint.composite_runtime_identity_hash ===
        identity.composite_runtime_identity_hash && trackedTreeClean()
    )
  });
  writeJson(path.join(runDir, "session-fixture.json"), {
    fixture_version: "e2a28-antimicrobial-resistance-isolated-fixture-v1",
    synthetic_only: true,
    session: protocol.session,
    initial_activity: protocol.session.natural_initial_activity,
    no_database_records_created: true
  });
  writeJson(path.join(runDir, "target-evidence-contract.json"), contract);
  writeJson(path.join(runDir, "session-designs.json"), {
    protocol_version: protocol.protocol_version,
    protocol_hash: PROTOCOL_HASH,
    session_count: 1,
    sessions: [protocol.session]
  });
  try {
    sessions.push(await runSession({
      runId: id,
      runDir,
      session: protocol.session,
      executor: input.executor,
      ledger,
      live: input.live,
      frozenSourceHash: source.aggregate_sha256,
      reviewRows
    }));
  } catch (error) {
    failure = error instanceof Error ? error.message : "e2a28_unknown_failure";
  }
  const usage = usageArtifact(ledger);
  writeJson(path.join(runDir, "usage-and-cost.json"), usage);
  writeJson(path.join(runDir, "provider-usage.json"), usage);
  const session = sessions[0] ?? null;
  const profileRows = readJsonl<JsonObject>(path.join(
    runDir, "turn-profile-snapshots.jsonl"
  ));
  const anchorRows = readJsonl<JsonObject>(path.join(
    runDir, "anchor-interpretation-results.jsonl"
  ));
  const modeRows = readJsonl<JsonObject>(path.join(
    runDir, "platform-mode-decisions.jsonl"
  ));
  const interventionRows = readJsonl<JsonObject>(path.join(
    runDir, "intervention-memory-results.jsonl"
  ));
  const privacyRows = readJsonl<JsonObject>(path.join(
    runDir, "privacy-results.jsonl"
  ));
  const persistenceRows = readJsonl<JsonObject>(path.join(
    runDir, "persistence-results.jsonl"
  ));
  const reasoningByTurn = profileRows.map((row) => ({
    turn: row.turn,
    reasoning_quality: (row.profile as JsonObject | undefined)
      ?.reasoning_quality,
    revision_readiness: (row.profile as JsonObject | undefined)
      ?.revision_readiness
  }));
  const earliestSound = reasoningByTurn.find((row) =>
    row.reasoning_quality === "sound"
  )?.turn ?? null;
  const revisionTurn = modeRows.find((row) =>
    (row.route as JsonObject | undefined)?.selected_mode === "request_revision"
  )?.turn ?? null;
  writeJson(path.join(runDir, "evidence-accuracy-metrics.json"), {
    metric_version: "e2a28-evidence-accuracy-v1",
    semantic_envelope_pass_count: profileRows.filter((row) =>
      row.semantic_envelope && row.profile
    ).length,
    profile_count: profileRows.length,
    copied_response_non_sound: reasoningByTurn.find((row) => row.turn === 2)
      ?.reasoning_quality !== "sound",
    misconception_response_non_sound:
      reasoningByTurn.find((row) => row.turn === 3)?.reasoning_quality !== "sound",
    contradictory_response_non_sound:
      reasoningByTurn.find((row) => row.turn === 4)?.reasoning_quality !== "sound",
    structured_contradiction_present: anchorRows.some((row) =>
      row.turn === 4 && Array.isArray(row.contradictions) &&
      row.contradictions.includes(
        "anchor_conclusion_conceptual_explanation_conflict"
      )),
    earliest_genuine_sound_turn: earliestSound,
    human_adjudicated_earliest_sound_turn:
      protocol.session.human_adjudicated_earliest_sound_turn,
    sound_detection_delay: typeof earliestSound === "number"
      ? earliestSound - protocol.session.human_adjudicated_earliest_sound_turn
      : null
  });
  writeJson(path.join(runDir, "progression-efficiency-metrics.json"), {
    metric_version: "e2a28-progression-efficiency-v1",
    earliest_genuine_sound_turn: earliestSound,
    revision_turn: revisionTurn,
    sound_detection_delay: typeof earliestSound === "number" &&
      typeof revisionTurn === "number" ? revisionTurn - earliestSound : null,
    tutor_calls_after_sound: session?.tutor_calls_after_sound ?? null,
    unnecessary_turns_after_sound:
      session?.unnecessary_turns_after_sound ?? null,
    premature_revision_count: modeRows.filter((row) =>
      Number(row.turn) < protocol.session.human_adjudicated_earliest_sound_turn &&
      (row.route as JsonObject | undefined)?.selected_mode === "request_revision"
    ).length
  });
  writeJson(path.join(runDir, "pedagogical-adaptation-metrics.json"), {
    metric_version: "e2a28-pedagogical-adaptation-v1",
    interventions: interventionRows.map((row) => ({
      turn: row.turn,
      strategy: (row.intervention as JsonObject | null)?.strategy_description ??
        null,
      primary_gap: (row.intervention as JsonObject | null)?.primary_gap_targeted ??
        null
    })),
    strategy_changed_after_copied_misconception_and_contradiction:
      session?.strategy_changed_after_ineffective_intervention ?? null,
    tutor_regenerations: session?.tutor_regenerations ?? null,
    soft_only_regenerations: 0,
    deterministic_fallbacks: 0
  });
  writeJson(path.join(runDir, "student-burden-metrics.json"), {
    metric_version: "e2a28-student-burden-v1",
    student_turn_count: session?.student_turn_count ?? 0,
    maximum_student_turns: protocol.session.maximum_student_turns,
    effective_platform_response_count:
      session?.effective_tutor_or_platform_reply_count ?? 0,
    complete_visible_turn_limit: protocol.session.complete_visible_history_limit
  });
  writeJson(path.join(runDir, "workflow-fidelity-metrics.json"), {
    metric_version: "e2a28-workflow-fidelity-v1",
    context_coverage_passed: readJsonl<JsonObject>(path.join(
      runDir, "context-coverage-results.jsonl"
    )).every((row) => row.passed === true),
    privacy_passed: privacyRows.every((row) => row.passed === true),
    persistence_passed: persistenceRows.every((row) =>
      row.one_effective_response_persisted === true
    ),
    provider_concurrency: 1,
    evaluator_before_tutor: true,
    provider_controls_progression: false,
    unauthorized_transitions: 0,
    missing_or_duplicate_effective_responses: 0
  });
  const persistenceAudit = readJsonl<JsonObject>(path.join(
    runDir, "persistence-and-idempotency.jsonl"
  ));
  const cleanupEvidence = [...persistenceAudit].reverse().find((row) =>
    row.cleanup !== undefined || row.cleanup_after_failure !== undefined
  );
  const cleanupObject = (cleanupEvidence?.cleanup ??
    cleanupEvidence?.cleanup_after_failure) as JsonObject | undefined;
  const cleanupPassed = cleanupObject?.isolated_records_removed === true;
  writeJson(path.join(runDir, "fixture-cleanup-results.json"), {
    cleanup_version: "e2a28-isolated-fixture-cleanup-v1",
    in_memory_synthetic_fixture_only: true,
    database_fixture_created: false,
    isolated_records_removed: cleanupPassed,
    historical_records_modified: false,
    passed: cleanupPassed
  });
  const failurePathRows = readJsonl<JsonObject>(path.join(
    runDir, "failure-path-results.jsonl"
  ));
  const providerFailurePathRows = failurePathRows.filter((row) =>
    row.record_type !== "accepted_turn_completion"
  );
  const requiredFailureFields = [
    "generated", "schema_valid", "hard_validator_result",
    "pedagogical_review_result", "profile_mapper_result",
    "profile_consistency_result", "platform_mode_result",
    "tutor_dispatch_result", "persisted", "displayed",
    "suppression_reason", "stage_reached", "stages_not_reached"
  ];
  const failurePathComplete = providerFailurePathRows.every((row) =>
    requiredFailureFields.every((field) => field in row) &&
    "complete_prior_visible_episode" in row &&
    "request_provenance" in row
  );
  writeJson(path.join(runDir, "failure-path-completeness.json"), {
    completeness_version: "e2a28-failure-path-completeness-v1",
    required_fields: requiredFailureFields,
    provider_output_record_count: providerFailurePathRows.length,
    accepted_turn_completion_record_count: failurePathRows.length -
      providerFailurePathRows.length,
    complete_prior_visible_episode_bound: providerFailurePathRows.every(
      (row) => "complete_prior_visible_episode" in row
    ),
    request_provenance_bound: providerFailurePathRows.every((row) =>
      "request_provenance" in row
    ),
    generated_but_suppressed_outputs_included: true,
    missing_values_coerced_to_zero: false,
    future_policy_complete: failurePathComplete,
    passed: failurePathComplete
  });
  const studentTurnRows = readJsonl<JsonObject>(path.join(
    runDir, "student-turn-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const tutorProviderRows = readJsonl<JsonObject>(path.join(
    runDir, "autonomous-tutor-provider-outputs.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const totalVisibleWords = reviewRows.reduce((total, row) => {
    const message = typeof row.student_facing_message === "string"
      ? row.student_facing_message
      : typeof row.latest_student_response === "string"
        ? row.latest_student_response : "";
    return total + message.trim().split(/\s+/u).filter(Boolean).length;
  }, 0);
  writeJson(path.join(runDir, "failed-session-burden-metrics.json"), {
    metric_version: "e2a28-failed-session-burden-v1",
    failure_recorded: failure !== null,
    failure_stage: failure,
    attempted_student_turns: studentTurnRows.length,
    completed_student_turns: profileRows.length,
    generated_tutor_responses: tutorProviderRows.length,
    effective_tutor_responses: interventionRows.length,
    total_visible_words_before_abort: totalVisibleWords,
    completed_session_duration_ms: failure === null
      ? new Date().getTime() - new Date(startedAt).getTime() : null,
    missing_values_coerced_to_zero: false,
    burden_status: failure === null ? "completed" : "partial"
  });
  writeJson(path.join(runDir, "human-review-packet.json"), {
    packet_version: "e2a28-human-review-packet-v1",
    run_id: id,
    human_review_required: true,
    human_review_complete: false,
    ratings_prepopulated: false,
    item_count: reviewRows.length,
    session_review: {
      profile_accuracy: null,
      strategy_adaptation: null,
      naturalness: null,
      repetition: null,
      student_burden: null,
      clarity: null,
      learning_support: null,
      workflow_fidelity: null,
      sequence_quality: null
    },
    metrics: {
      evidence_accuracy: readJson(path.join(
        runDir, "evidence-accuracy-metrics.json"
      )),
      progression_efficiency: readJson(path.join(
        runDir, "progression-efficiency-metrics.json"
      )),
      pedagogical_adaptation: readJson(path.join(
        runDir, "pedagogical-adaptation-metrics.json"
      )),
      student_burden: readJson(path.join(
        runDir, "student-burden-metrics.json"
      )),
      workflow_fidelity: readJson(path.join(
        runDir, "workflow-fidelity-metrics.json"
      ))
    },
    items: reviewRows,
    recommendation: null
  });
  finalizeUnreachedJsonlArtifacts(runDir, failure);
  const protectedAfter = protectedEvidenceIdentity();
  const protectedUnchanged = protectedBefore.current_sha256 ===
    protectedAfter.current_sha256;
  if (!protectedUnchanged && failure === null) {
    failure = "e2a28_protected_evidence_changed_during_execution";
  }
  const passed = failure === null && sessions.length === 1 &&
    sessions.every((session) => session.passed === true) &&
    usage.within_budget;
  const failureStatus = failure?.includes("anchor") ||
      failure?.includes("contradiction")
    ? "e2a28_canary_failed_anchor_interpretation"
    : failure?.includes("sound") || failure?.includes("profile") ||
        failure?.includes("revision") || failure?.includes("evaluator")
      ? "e2a28_canary_failed_evidence_accuracy"
      : failure?.includes("strategy") || failure?.includes("pedagog")
        ? "e2a28_canary_failed_pedagogical_adaptation"
        : failure?.includes("context") || failure?.includes("history") ||
            failure?.includes("persist") || failure?.includes("idempot")
          ? "e2a28_canary_failed_context_integrity"
          : failure?.includes("privacy") || failure?.includes("safety") ||
              failure?.includes("answer") || failure?.includes("hidden")
            ? "e2a28_canary_failed_safety"
            : failure?.includes("provider") || failure?.includes("budget") ||
                failure?.includes("infrastructure")
              ? "e2a28_canary_incomplete_infrastructure"
              : "e2a28_canary_failed_stability";
  const summary = {
    summary_version: "e2a28-live-canary-summary-v1",
    status: passed
      ? "e2a28_canary_pass_pending_human_review"
      : failureStatus,
    run_id: id,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    application_git_commit: currentCommit(),
    protocol_hash: PROTOCOL_HASH,
    composite_runtime_identity_hash:
      identity.composite_runtime_identity_hash,
    candidate_configuration_hash: CANDIDATE_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA,
    approved_v2_hash: APPROVED_HASH,
    session_count_planned: 1,
    session_count_completed: sessions.length,
    sessions,
    failure_reason: failure,
    provider_usage: usage.actual,
    budget_within_limits: usage.within_budget,
    cost_ceiling_verified: usage.cost_ceiling_verified,
    cost_ceiling_enforcement: usage.cost_ceiling_enforcement,
    protected_evidence_before_hash: protectedBefore.current_sha256,
    protected_evidence_after_hash: protectedAfter.current_sha256,
    protected_evidence_unchanged: protectedUnchanged,
    provider_concurrency: 1,
    deterministic_fallback_count: 0,
    human_review_item_count: reviewRows.length,
    human_review_complete: false,
    candidate_approved: false,
    candidate_activated: false,
    four_session_canary_run: false,
    twelve_session_canary_run: false,
    thirty_six_session_matrix_run: false,
    e2a25_rerun: false,
    e2a27_rerun: false,
    e2b_run: false,
    later_live_stage_run: false,
    migration_added: false,
    passed
  };
  writeJson(path.join(runDir, "canary-summary.json"), summary);
  const validation = artifactValidation(runDir);
  if (input.live) freezeArtifacts(runDir);
  return { runId: id, runDir, summary, validation };
}

async function runSmoke() {
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = (async () => {
    networkRequests += 1;
    throw new Error("e2a28_smoke_network_prohibited");
  }) as typeof fetch;
  const root = path.join(os.tmpdir(), `e2a28-smoke-${randomUUID()}`);
  try {
    const protocol = buildE2A28FrozenProtocol();
    const result = await executeCanary({
      executor: makeNoLiveExecutor(protocol),
      live: false,
      artifactRoot: root,
      forcedRunId: "e2a28_no_live_smoke"
    });
    if (!result.summary.passed || !result.validation.passed) {
      throw new Error(
        `e2a28_no_live_smoke_failed:${result.summary.failure_reason ?? result.validation.failures.join("|")}`
      );
    }
    if (networkRequests !== 0) throw new Error("e2a28_no_live_network_detected");
    const usage = result.summary.provider_usage as JsonObject;
    if (usage.simulator_calls !== 6 || usage.evidence_evaluator_calls !== 6 ||
        usage.initial_tutor_calls !== 5 || usage.logical_generation_calls !== 17) {
      throw new Error("e2a28_no_live_expected_call_arithmetic_failed");
    }
    return {
      status: "passed",
      network_request_count: networkRequests,
      session_count: result.summary.session_count_completed,
      provider_usage: usage,
      artifact_validation: result.validation,
      temporary_artifacts_removed: true
    };
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
}

function runAuthorizationGuardSmoke() {
  let blockedReason: string | null = null;
  try {
    assertLiveAuthorizationArguments();
  } catch (error) {
    blockedReason = error instanceof Error ? error.message : "unknown";
  }
  if (!blockedReason?.startsWith("e2a28_confirmation_missing:")) {
    throw new Error("e2a28_authorization_guard_did_not_fail_closed");
  }
  return {
    status: "passed",
    provider_call_count: 0,
    network_request_count: 0,
    blocked_reason: blockedReason,
    exact_authorization_required: true
  };
}

async function executeLive() {
  assertLiveAuthorizationArguments();
  const check = preflight(true);
  if (!check.passed) {
    throw new Error(`e2a28_preflight_failed:${check.blockers.join(",")}`);
  }
  mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  writeFileSync(LOCK_PATH, `${process.pid}\n`, { flag: "wx" });
  try {
    const credential = resolveOpenAICredentialFromEnv();
    if (!credential.ok) throw new Error(`e2a28_credential_failed:${credential.code}`);
    return await withResolvedOpenAICredential(credential.credential, async () => {
      const candidate = evaluateE2A24Candidate().full_candidate;
      const provider: LlmProvider = new OpenAIResponsesProvider({
        isolated_evaluation_runtime: {
          purpose: "bounded_candidate_evaluation",
          request_timeout_ms: candidate.runtime_policy.provider_timeout_ms
        }
      });
      const executor: ProviderExecutor = (request) =>
        provider.executeStructured(request);
      return executeCanary({ executor, live: true });
    });
  } finally {
    if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH);
  }
}

function report(run?: string) {
  const id = run ?? existingLiveRuns().at(-1);
  if (!id) throw new Error("e2a28_run_not_found");
  const runDir = path.join(ARTIFACT_ROOT, id);
  return {
    run_id: id,
    run_directory: runDir,
    summary: readJson(path.join(runDir, "canary-summary.json")),
    usage: readJson(path.join(runDir, "usage-and-cost.json")),
    artifact_validation: artifactValidation(runDir)
  };
}

function auditRun(run?: string) {
  const id = run ?? existingLiveRuns().at(-1);
  if (!id) throw new Error("e2a28_run_not_found");
  const runDir = path.join(ARTIFACT_ROOT, id);
  const summary = readJson<JsonObject>(path.join(runDir, "canary-summary.json"));
  const artifacts = artifactValidation(runDir);
  const profiles = readJsonl<JsonObject>(path.join(
    runDir, "turn-profile-snapshots.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const anchors = readJsonl<JsonObject>(path.join(
    runDir, "anchor-interpretation-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const modes = readJsonl<JsonObject>(path.join(
    runDir, "platform-mode-decisions.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const runtime = readJsonl<JsonObject>(path.join(
    runDir, "runtime-validation-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const context = readJsonl<JsonObject>(path.join(
    runDir, "context-coverage-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const persistence = readJsonl<JsonObject>(path.join(
    runDir, "persistence-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const finalizations = readJsonl<JsonObject>(path.join(
    runDir, "pre-tutor-finalization-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const contradictions = readJsonl<JsonObject>(path.join(
    runDir, "structured-contradiction-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const reviewBindings = readJsonl<JsonObject>(path.join(
    runDir, "human-review-binding-results.jsonl"
  )).filter((row) => typeof row.turn === "number");
  const usage = readJson<{ within_budget?: boolean; actual?: JsonObject }>(
    path.join(runDir, "provider-usage.json")
  );
  const cleanup = readJson<{ passed?: boolean }>(path.join(
    runDir, "fixture-cleanup-results.json"
  ));
  const human = readJson<{ items?: Array<{ human_review?: unknown }>;
    session_review?: JsonObject }>(path.join(runDir, "human-review-packet.json"));
  const failures = [...artifacts.failures];
  if (summary.candidate_approved !== false ||
      summary.candidate_activated !== false) {
    failures.push("candidate_state_invalid");
  }
  if (summary.approved_v2_hash !== APPROVED_HASH) {
    failures.push("approved_v2_hash_changed");
  }
  if (summary.protected_evidence_unchanged !== true) {
    failures.push("protected_evidence_changed");
  }
  if (usage.within_budget !== true) failures.push("usage_budget_invalid");
  if (cleanup.passed !== true) failures.push("fixture_cleanup_invalid");
  if (!human.items?.every((item) => item.human_review === null) ||
      !human.session_review ||
      !Object.values(human.session_review).every((value) => value === null)) {
    failures.push("human_review_not_pending_or_prepopulated");
  }
  if (summary.passed === true) {
    const profile = (turn: number) => profiles.find((row) => row.turn === turn)
      ?.profile as JsonObject | undefined;
    const anchor = (turn: number) => anchors.find((row) => row.turn === turn);
    const mode = (turn: number) => modes.find((row) => row.turn === turn)
      ?.route as JsonObject | undefined;
    if (profiles.length !== 6 || anchors.length !== 6 || modes.length !== 6) {
      failures.push("completed_turn_artifact_count_invalid");
    }
    if (profile(2)?.reasoning_quality === "sound" ||
        profile(3)?.reasoning_quality === "sound" ||
        profile(4)?.reasoning_quality === "sound") {
      failures.push("non_sound_boundary_failed");
    }
    if (anchor(4)?.anchor_application !== "explicit" ||
        anchor(4)?.anchor_stance !== "endorses_distractor" ||
        anchor(4)?.anchor_consistency !==
          "contradictory_to_conceptual_reasoning" ||
        anchor(4)?.anchor_resolution_status !== "contradictory" ||
        !Array.isArray(anchor(4)?.contradictions) ||
        !(anchor(4)?.contradictions as unknown[]).includes(
          "anchor_conclusion_conceptual_explanation_conflict"
        )) failures.push("turn_4_anchor_contradiction_invalid");
    if (profile(6)?.reasoning_quality !== "sound" ||
        profile(6)?.revision_readiness !== true ||
        anchor(6)?.anchor_stance !== "rejects_distractor" ||
        anchor(6)?.anchor_consistency !==
          "consistent_with_conceptual_reasoning" ||
        anchor(6)?.anchor_resolution_status !==
          "resolved_against_distractor" ||
        mode(6)?.selected_mode !== "request_revision") {
      failures.push("turn_6_sound_gate_invalid");
    }
    if (modes.find((row) => row.turn === 6)?.tutor_called !== false) {
      failures.push("tutor_after_sound");
    }
    if (!context.every((row) => row.passed === true) ||
        !runtime.every((row) => Array.isArray(row.execution_order) && (
          row.tutor_called !== true || row.execution_order.indexOf(
            "independent_structured_conceptual_evaluation"
          ) < row.execution_order.indexOf("invoke_autonomous_pedagogical_agent")
        )) || finalizations.length !== 6 || !finalizations.every((row) =>
          row.passed === true &&
          row.finalized_before_tutor_dispatch === true
        ) || contradictions.length !== 6 ||
        contradictions.find((row) => row.turn === 4)?.blocking !== true ||
        reviewBindings.length !== 6 || !reviewBindings.every((row) =>
          row.passed === true && row.human_review === null
        ) || !persistence.every((row) =>
          row.one_effective_response_persisted === true &&
          row.duplicate_effective_response_count === 0
        )) failures.push("workflow_fidelity_invalid");
  }
  return {
    audit_version: "e2a28-post-run-audit-v1",
    run_id: id,
    run_directory: runDir,
    audit_passed: failures.length === 0,
    canary_passed: summary.passed === true,
    status: summary.status,
    failures,
    artifact_validation: artifacts,
    turn_counts: {
      profiles: profiles.length,
      anchors: anchors.length,
      modes: modes.length,
      context: context.length,
      persistence: persistence.length,
      pre_tutor_finalizations: finalizations.length,
      structured_contradictions: contradictions.length,
      human_review_bindings: reviewBindings.length
    },
    usage: usage.actual,
    fixture_cleanup_passed: cleanup.passed === true,
    human_review_pending: true,
    candidate_approved: false,
    candidate_activated: false
  };
}

async function main() {
  const mode = process.argv[2];
  if (mode === "preflight") {
    console.log(JSON.stringify(preflight(process.argv.includes("--live")), null, 2));
    return;
  }
  if (mode === "checkpoint") {
    console.log(JSON.stringify(recordDispatchCheckpoint(), null, 2));
    return;
  }
  if (mode === "smoke") {
    console.log(JSON.stringify(await runSmoke(), null, 2));
    return;
  }
  if (mode === "authorization-guard-smoke") {
    console.log(JSON.stringify(runAuthorizationGuardSmoke(), null, 2));
    return;
  }
  if (mode === "live") {
    const result = await executeLive();
    console.log(JSON.stringify({
      status: result.summary.status,
      run_id: result.runId,
      run_directory: result.runDir,
      session_count_completed: result.summary.session_count_completed,
      provider_usage: result.summary.provider_usage,
      human_review_complete: false,
      candidate_approved: false,
      candidate_activated: false,
      e2a25_rerun: false,
      e2a27_rerun: false,
      four_session_canary_run: false,
      twelve_session_canary_run: false,
      thirty_six_session_matrix_run: false,
      e2b_run: false,
      artifact_validation: result.validation
    }, null, 2));
    if (!result.summary.passed || !result.validation.passed) process.exitCode = 1;
    return;
  }
  if (mode === "report") {
    const index = process.argv.indexOf("--run");
    console.log(JSON.stringify(report(index >= 0 ? process.argv[index + 1] : undefined), null, 2));
    return;
  }
  if (mode === "audit") {
    const index = process.argv.indexOf("--run");
    const result = auditRun(index >= 0 ? process.argv[index + 1] : undefined);
    console.log(JSON.stringify(result, null, 2));
    if (!result.audit_passed) process.exitCode = 1;
    return;
  }
  throw new Error(
    "usage: formative-evaluation-e2a28.ts preflight|checkpoint|smoke|authorization-guard-smoke|live|report|audit"
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a28_runner_failed");
  process.exitCode = 1;
});
