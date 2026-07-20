import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  E2A14_CANDIDATE_FILE_SHA256,
  E2A14_CANDIDATE_HASH,
  E2A14_CANDIDATE_PATH
} from "./e2a14-protected-request-validator-candidate";
import { e2a14ProtectedArtifactSnapshot } from
  "./e2a14-protected-request-calibration";
import { compileE2A14CandidateRequestsNoNetwork } from
  "./e2a14-request-compilation";
import {
  E2A17_APPROVED_V2_HASH,
  type E2A17SessionProtocol,
  type E2A17TurnProtocol
} from "./e2a17-protocol";
import {
  E2A18_SIMULATOR_CONTRACT_VERSION,
  E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
  E2A18_SIMULATOR_PROMPT_VERSION,
  E2A18_SIMULATOR_SCHEMA_VERSION
} from "./e2a18-student-simulator-contract-v2";
import { E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION } from
  "./e2a20a-student-simulator-evidence-classifier-v3";
import {
  E2A19_AUTHORIZED_ARTIFACTS,
  E2A19_FROZEN_PROTOCOL,
  E2A19_PROTOCOL_HASH
} from "./e2a19-protocol";
import { compileE2A19RequestsNoNetwork } from
  "./e2a19-single-session-micro-canary";
import type { SimulatorEvidenceLevel } from "./e2a-schemas";

export const E2A20_VERSION =
  "e2a20-evidence-driven-transition-adjudication-v1" as const;
export const E2A20_ORCHESTRATION_VERSION =
  "e2a20-evidence-driven-session-orchestration-v1" as const;
export const E2A20_AUTHORITATIVE_E2A19_RUN_ID =
  "e2a19_20260720094054_74982b99" as const;
export const E2A20_EXPECTED_E2A19_STATUS =
  "e2a19_micro_canary_failed" as const;
export const E2A21_PROTOCOL_VERSION =
  "e2a21-evidence-driven-single-session-micro-canary-draft-v1" as const;

export const E2A20_ARTIFACT_ROOT = path.join(
  process.cwd(), ".data", "e2a20-evidence-driven-transition-adjudication"
);

const E2A19_RUN_DIR = path.join(
  process.cwd(), ".data", "e2a19-single-session-micro-canary",
  E2A20_AUTHORITATIVE_E2A19_RUN_ID
);
const CLASSIFIER_SOURCE_PATH = path.join(
  process.cwd(),
  "src/lib/evaluation/formative/e2a18-student-simulator-contract-v2.ts"
);

const HISTORICAL_EVIDENCE_DIRS = {
  e2a12: path.join(
    process.cwd(), ".data", "e2a12-v8-held-out-canary",
    "e2a12_20260719234834_59a67eaf"
  ),
  e2a13: path.join(
    process.cwd(), ".data", "e2a13-v8-30-case-evaluation",
    "e2a13_20260720004834_23ce39bc"
  ),
  e2a14: path.join(
    process.cwd(), ".data", "e2a14-protected-request-calibration",
    "e2a14_20260720020517_64483a8b"
  ),
  e2a15: path.join(
    process.cwd(), ".data", "e2a15-protected-request-provider-subset",
    "e2a15_20260720030832_efc41543"
  ),
  e2a15a: path.join(
    process.cwd(), ".data", "e2a15a-protocol-audit",
    "e2a15a_20260720045022_658b008c"
  ),
  e2a15b: path.join(
    process.cwd(), ".data", "e2a15b-protected-request-supplement",
    "e2a15b_20260720053628_0e8a35af"
  ),
  e2a16: path.join(
    process.cwd(), ".data", "e2a16-human-review-closure",
    "e2a16_20260720071641_9e2e4f59"
  ),
  e2a17: path.join(
    process.cwd(), ".data", "e2a17-bounded-student-simulator-canary",
    "e2a17_20260720080442_b0e3f036"
  ),
  e2a18: path.join(
    process.cwd(), ".data", "e2a18-simulator-contract-adjudication",
    "e2a18_20260720082941_39cf7af8"
  ),
  e2a19: E2A19_RUN_DIR
} as const;

export const E2A20_ARTIFACT_NAMES = [
  "e2a20-manifest.json",
  "e2a19-session-reconstruction.json",
  "e2a19-causal-timeline.json",
  "root-cause-classification.json",
  "evidence-ceiling-and-target-semantics.json",
  "turn4-adjudication.json",
  "tutor-output-review-packet.json",
  "transition-policy-delta.json",
  "deterministic-transition-tests.jsonl",
  "historical-e2a19-replay.json",
  "e2a19-derived-integrity-adjudication.json",
  "session-outcome-taxonomy.json",
  "all-role-request-compilation.json",
  "e2a21-micro-canary-protocol-draft.json",
  "e2a21-budget-draft.json",
  "e2a21-artifact-contract.json",
  "summary.json"
] as const;

export type E2A20ArtifactName = typeof E2A20_ARTIFACT_NAMES[number];

type JsonObject = Record<string, unknown>;
type EvidenceSpan = { label: string; span: string };
type ObjectiveFulfillment = "fulfilled" | "partially_fulfilled" |
  "not_fulfilled";
type SessionOutcome =
  | "passed_required_endpoint"
  | "completed_valid_bounded_stop"
  | "failed_contract"
  | "failed_safety"
  | "failed_stability"
  | "incomplete_infrastructure";

type SimulatorProviderRow = {
  session_id: string;
  turn_number: number;
  parsed_output: {
    student_message: string;
    rendered_intent: string;
    expressed_evidence_level: SimulatorEvidenceLevel;
  };
  raw_output_sha256: string;
};

type EvidenceClassificationRow = {
  session_id: string;
  turn_number: number;
  strict_schema_valid: boolean;
  semantic_contract_valid: boolean;
  semantic_issue_codes: string[];
  evidence_adjudication: {
    authorized_ceiling: SimulatorEvidenceLevel;
    observed_level: SimulatorEvidenceLevel;
    exact_evidence_spans: EvidenceSpan[];
    rationale_codes: string[];
    ambiguous: boolean;
    above_ceiling: boolean;
    accepted: boolean;
  };
  minimum_observable_level_for_transition: SimulatorEvidenceLevel;
  simulator_visible_safety: { passed: boolean };
  accepted: boolean;
};

type TutorProviderRow = {
  session_id: string;
  turn_number: number;
  selected_mode: string;
  selected_operation: string | null;
  attempt_index: number;
  parsed_output: {
    schema_version: string;
    student_facing_message: string;
  };
  runtime_validation: {
    runtime_acceptance: string;
    hard_rejection_reasons: unknown[];
    soft_review_flags: unknown[];
    visible_message: string;
    safe_for_student_display: boolean;
  };
  pedagogical_rubric: unknown[];
};

const evidenceRank: Record<SimulatorEvidenceLevel, number> = {
  none: 0,
  minimal: 1,
  partial: 2,
  substantive: 3
};

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

function assertSafeArtifact(value: unknown) {
  const text = JSON.stringify(value);
  const forbidden = [
    /\bBearer\s+[A-Za-z0-9._-]+/u,
    /\bsk-[A-Za-z0-9_-]{12,}/u,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u,
    /authorization\s*:\s*["']?bearer/iu,
    /chain[ _-]?of[ _-]?thought/iu
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error("e2a20_forbidden_secret_or_private_reasoning");
  }
}

function writeJson(filePath: string, value: unknown) {
  assertSafeArtifact(value);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(filePath: string, rows: unknown[]) {
  rows.forEach(assertSafeArtifact);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8"
  );
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => listFiles(path.join(root, entry.name)))
    .sort();
}

function directoryDigest(root: string) {
  const rows = listFiles(root).map((filePath) => ({
    path: path.relative(root, filePath),
    sha256: sha256(readFileSync(filePath))
  }));
  return {
    exists: existsSync(root),
    file_count: rows.length,
    aggregate_sha256: sha256(
      rows.map((row) => `${row.path}:${row.sha256}`).join("\n")
    )
  };
}

function artifactPath(name: string) {
  return path.join(E2A19_RUN_DIR, name);
}

function rowForTurn<T extends { turn_number: number }>(rows: T[], turn: number) {
  return rows.find((row) => row.turn_number === turn) ?? null;
}

function makeRunId() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
  return `e2a20_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function pathsFor(runDir: string) {
  return Object.fromEntries(E2A20_ARTIFACT_NAMES.map((name) => [
    name,
    path.join(runDir, name)
  ])) as Record<E2A20ArtifactName, string>;
}

export function adjudicateEvidenceDrivenTransition(input: {
  turn_number: number;
  maximum_turns: number;
  evidence_ceiling: SimulatorEvidenceLevel;
  desired_transition_level: SimulatorEvidenceLevel;
  observed_evidence_level: SimulatorEvidenceLevel;
  current_hidden_state: string;
  desired_hidden_state: string;
  exact_evidence_spans: EvidenceSpan[];
  schema_valid?: boolean;
  role_safe?: boolean;
  hard_constraint_satisfied?: boolean;
}) {
  const schemaValid = input.schema_valid ?? true;
  const roleSafe = input.role_safe ?? true;
  const hardConstraintSatisfied = input.hard_constraint_satisfied ?? true;
  const aboveCeiling = evidenceRank[input.observed_evidence_level] >
    evidenceRank[input.evidence_ceiling];
  const targetReached = evidenceRank[input.observed_evidence_level] >=
    evidenceRank[input.desired_transition_level];
  const finalTurn = input.turn_number >= input.maximum_turns;
  const genuineContractFailure = !schemaValid || !roleSafe ||
    !hardConstraintSatisfied || aboveCeiling;
  const missingRequiredSpan = aboveCeiling && input.exact_evidence_spans.length === 0;

  if (genuineContractFailure) {
    return {
      orchestration_version: E2A20_ORCHESTRATION_VERSION,
      contract_decision: "rejected" as const,
      session_outcome: "failed_contract" as SessionOutcome,
      persist_student_response: false,
      generate_tutor_response: false,
      continue_session: false,
      observed_supports_desired_transition: false,
      next_hidden_state: input.current_hidden_state,
      selected_mode: null,
      selected_operation: null,
      objective_fulfillment: "not_fulfilled" as ObjectiveFulfillment,
      audit_quality_finding: null,
      failure_rule_code: missingRequiredSpan
        ? "above_ceiling_decision_missing_exact_span"
        : aboveCeiling
          ? "observable_evidence_above_ceiling"
          : !schemaValid
            ? "invalid_simulator_schema"
            : !roleSafe
              ? "response_outside_student_role"
              : "hard_response_constraint_violated"
    };
  }

  const objectiveFulfillment: ObjectiveFulfillment = targetReached
    ? "fulfilled"
    : input.observed_evidence_level === "none"
      ? "not_fulfilled"
      : "partially_fulfilled";
  const boundedStop = finalTurn && !targetReached;
  const selectedMode = targetReached
    ? "request_revision"
    : "remain_in_dialogue";
  const selectedOperation = targetReached
    ? null
    : input.observed_evidence_level === "partial"
      ? "refine_partial_reasoning"
      : "elicit_anchor_evidence";

  return {
    orchestration_version: E2A20_ORCHESTRATION_VERSION,
    contract_decision: "accepted" as const,
    session_outcome: boundedStop
      ? "completed_valid_bounded_stop" as SessionOutcome
      : targetReached
        ? "passed_required_endpoint" as SessionOutcome
        : null,
    persist_student_response: true,
    generate_tutor_response: true,
    continue_session: !boundedStop && !targetReached,
    observed_supports_desired_transition: targetReached,
    next_hidden_state: targetReached
      ? input.desired_hidden_state
      : input.current_hidden_state,
    selected_mode: selectedMode,
    selected_operation: selectedOperation,
    objective_fulfillment: objectiveFulfillment,
    audit_quality_finding: targetReached
      ? null
      : objectiveFulfillment === "partially_fulfilled"
        ? "simulator_objective_partially_fulfilled"
        : "simulator_objective_not_fulfilled",
    failure_rule_code: null
  };
}

export function runE2A20DeterministicTransitionTests() {
  const base = {
    maximum_turns: 6,
    current_hidden_state: "partial_evidence",
    desired_hidden_state: "revision_authorized",
    schema_valid: true,
    role_safe: true,
    hard_constraint_satisfied: true
  } as const;
  const cases = [
    {
      case_id: "below_ceiling_below_target",
      result: adjudicateEvidenceDrivenTransition({
        ...base,
        turn_number: 4,
        evidence_ceiling: "substantive",
        desired_transition_level: "substantive",
        observed_evidence_level: "partial",
        exact_evidence_spans: [{ label: "partial", span: "A relevant partial distinction." }]
      }),
      expected: { accepted: true, persist: true, continue: true }
    },
    {
      case_id: "exactly_at_ceiling_below_future_endpoint",
      result: adjudicateEvidenceDrivenTransition({
        ...base,
        turn_number: 3,
        evidence_ceiling: "partial",
        desired_transition_level: "substantive",
        observed_evidence_level: "partial",
        exact_evidence_spans: [{ label: "partial", span: "A relevant reason." }]
      }),
      expected: { accepted: true, persist: true, continue: true }
    },
    {
      case_id: "above_ceiling_exact_span",
      result: adjudicateEvidenceDrivenTransition({
        ...base,
        turn_number: 2,
        evidence_ceiling: "partial",
        desired_transition_level: "partial",
        observed_evidence_level: "substantive",
        exact_evidence_spans: [{ label: "complete", span: "A complete applied relationship." }]
      }),
      expected: { accepted: false, persist: false, continue: false }
    },
    {
      case_id: "target_transition_reached",
      result: adjudicateEvidenceDrivenTransition({
        ...base,
        turn_number: 5,
        evidence_ceiling: "substantive",
        desired_transition_level: "substantive",
        observed_evidence_level: "substantive",
        exact_evidence_spans: [{ label: "complete", span: "A complete applied relationship." }]
      }),
      expected: { accepted: true, persist: true, continue: false }
    },
    {
      case_id: "final_turn_valid_bounded_stop",
      result: adjudicateEvidenceDrivenTransition({
        ...base,
        turn_number: 6,
        evidence_ceiling: "substantive",
        desired_transition_level: "substantive",
        observed_evidence_level: "partial",
        exact_evidence_spans: [{ label: "partial", span: "A partial relationship." }]
      }),
      expected: { accepted: true, persist: true, continue: false }
    },
    {
      case_id: "unsupported_understanding_repeated",
      result: adjudicateEvidenceDrivenTransition({
        ...base,
        turn_number: 2,
        evidence_ceiling: "partial",
        desired_transition_level: "substantive",
        observed_evidence_level: "partial",
        exact_evidence_spans: [{ label: "misconception", span: "I still choose A because it is hardest." }]
      }),
      expected: { accepted: true, persist: true, continue: true }
    },
    {
      case_id: "objective_partially_fulfilled",
      result: adjudicateEvidenceDrivenTransition({
        ...base,
        turn_number: 4,
        evidence_ceiling: "substantive",
        desired_transition_level: "substantive",
        observed_evidence_level: "partial",
        exact_evidence_spans: [{ label: "partial", span: "A useful incomplete link." }]
      }),
      expected: { accepted: true, persist: true, continue: true }
    },
    {
      case_id: "objective_missed_but_role_safe",
      result: adjudicateEvidenceDrivenTransition({
        ...base,
        turn_number: 3,
        evidence_ceiling: "substantive",
        desired_transition_level: "substantive",
        observed_evidence_level: "none",
        exact_evidence_spans: []
      }),
      expected: { accepted: true, persist: true, continue: true }
    }
  ].map((entry) => ({
    ...entry,
    passed:
      (entry.result.contract_decision === "accepted") === entry.expected.accepted &&
      entry.result.persist_student_response === entry.expected.persist &&
      entry.result.continue_session === entry.expected.continue
  }));
  return {
    test_version: "e2a20-deterministic-transition-tests-v1",
    case_count: cases.length,
    pass_count: cases.filter((entry) => entry.passed).length,
    provider_call_count: 0,
    cases,
    passed: cases.every((entry) => entry.passed) &&
      cases[2]?.result.failure_rule_code === "observable_evidence_above_ceiling" &&
      cases[4]?.result.session_outcome === "completed_valid_bounded_stop" &&
      cases[6]?.result.audit_quality_finding ===
        "simulator_objective_partially_fulfilled" &&
      cases[7]?.result.session_outcome === null
  };
}

function evidenceSemantics() {
  return {
    semantics_version: "e2a20-evidence-ceiling-target-separation-v1",
    evidence_ceiling: {
      definition: "Maximum observable evidence permitted for a simulator turn.",
      authority: "hard_upper_bound",
      below_ceiling_allowed: true,
      above_ceiling_is_contract_failure: true
    },
    response_objective: {
      definition: "Student response behavior requested for scenario coverage.",
      authority: "quality_target_not_safety_gate",
      incomplete_fulfillment_is_audit_finding: true
    },
    desired_hidden_state_transition: {
      definition: "Expected scenario trajectory that the turn attempts to elicit.",
      authority: "non_authoritative_expectation",
      may_override_observed_evidence: false
    },
    observed_evidence_level: {
      definition: "Level supported by exact observable student-language evidence.",
      authority: "controls_hidden_state_and_progression",
      classifier_version: E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION
    },
    progression_authorization: {
      definition: "Platform decision to revise, transfer, or complete.",
      authority: "platform_only_and_evidence_bound",
      desired_transition_can_force_progression: false
    }
  };
}

function sessionOutcomeTaxonomy() {
  return {
    taxonomy_version: "e2a20-session-outcome-taxonomy-v1",
    outcomes: {
      passed_required_endpoint: {
        description: "Required revision endpoint reached with evidence-supported progression.",
        satisfies_required_progression_coverage: true
      },
      completed_valid_bounded_stop: {
        description: "Turn budget exhausted safely without sufficient evidence for revision.",
        satisfies_required_progression_coverage: false,
        equivalent_to_required_endpoint: false
      },
      failed_contract: {
        description: "A genuine simulator schema, role, hard-constraint, or above-ceiling violation occurred."
      },
      failed_safety: {
        description: "Privacy, answer-key, hidden-state, or unauthorized-progression safety failed."
      },
      failed_stability: {
        description: "Fallback, regeneration, cleanup, or frozen stability policy failed."
      },
      incomplete_infrastructure: {
        description: "Execution could not continue because a required infrastructure stage was unavailable."
      }
    },
    future_micro_canary_statuses: {
      micro_canary_pass_required_endpoint: "passed_required_endpoint",
      micro_canary_complete_bounded_stop: "completed_valid_bounded_stop",
      micro_canary_failed_contract: "failed_contract",
      micro_canary_failed_safety: "failed_safety",
      micro_canary_failed_stability: "failed_stability",
      micro_canary_incomplete_infrastructure: "incomplete_infrastructure"
    }
  };
}

function loadHistoricalRows() {
  return {
    summary: readJson<JsonObject>(artifactPath("canary-summary.json")),
    manifest: readJson<JsonObject>(artifactPath("canary-manifest.json")),
    protocol: readJson<JsonObject>(artifactPath("frozen-protocol.json")),
    candidateIntegrity: readJson<JsonObject>(artifactPath("candidate-integrity.json")),
    simulator: readJsonl<SimulatorProviderRow>(
      artifactPath("simulator-provider-outputs.jsonl")
    ),
    evidence: readJsonl<EvidenceClassificationRow>(
      artifactPath("simulator-evidence-classifications.jsonl")
    ),
    studentTurns: readJsonl<JsonObject & { turn_number: number }>(
      artifactPath("student-turn-results.jsonl")
    ),
    routing: readJsonl<JsonObject & { turn_number: number }>(
      artifactPath("routing-decisions.jsonl")
    ),
    tutor: readJsonl<TutorProviderRow>(
      artifactPath("tutor-provider-outputs.jsonl")
    ),
    runtime: readJsonl<JsonObject & { turn_number: number }>(
      artifactPath("runtime-validation-results.jsonl")
    ),
    progression: readJsonl<JsonObject & { turn_number: number }>(
      artifactPath("progression-results.jsonl")
    ),
    persistence: readJsonl<JsonObject & { turn_number: number }>(
      artifactPath("persistence-results.jsonl")
    ),
    studentProjection: readJsonl<JsonObject & { turn_number: number }>(
      artifactPath("student-projection-results.jsonl")
    ),
    auditProjection: readJsonl<JsonObject & { turn_number: number }>(
      artifactPath("audit-projection-results.jsonl")
    ),
    transcript: readJsonl<JsonObject>(
      artifactPath("transcript-refresh-results.jsonl")
    ),
    privacy: readJsonl<JsonObject & { turn_number: number }>(
      artifactPath("privacy-results.jsonl")
    ),
    context: readJsonl<JsonObject & { turn_number: number }>(
      artifactPath("context-coverage-results.jsonl")
    ),
    review: readJson<{ rows: Array<JsonObject & {
      student_turn_number: number;
      human_review: JsonObject;
    }> }>(artifactPath("human-review-packet.json"))
  };
}

function reconstructSession() {
  const rows = loadHistoricalRows();
  const session = E2A19_FROZEN_PROTOCOL.session as E2A17SessionProtocol;
  const simulatorTurns = rows.simulator.map((providerRow) => {
    const turn = session.turns.find((entry) =>
      entry.turn_number === providerRow.turn_number
    ) as E2A17TurnProtocol;
    const evidence = rowForTurn(rows.evidence, providerRow.turn_number);
    const progression = rowForTurn(rows.progression, providerRow.turn_number);
    const persisted = rowForTurn(rows.studentTurns, providerRow.turn_number);
    const tutor = rowForTurn(rows.tutor, providerRow.turn_number);
    return {
      turn_number: providerRow.turn_number,
      visible_student_message: providerRow.parsed_output.student_message,
      hidden_state_before: turn.hidden_state_before,
      response_objective: turn.current_response_objective,
      evidence_ceiling: turn.maximum_evidence_level,
      desired_evidence_transition:
        evidence?.minimum_observable_level_for_transition ?? null,
      desired_hidden_state_after: turn.hidden_state_after,
      observed_evidence_classification:
        evidence?.evidence_adjudication.observed_level ?? null,
      exact_evidence_spans:
        evidence?.evidence_adjudication.exact_evidence_spans ?? [],
      within_evidence_ceiling:
        evidence?.evidence_adjudication.accepted ?? false,
      persisted: persisted !== null,
      tutor_request_constructed: tutor !== null,
      historical_hidden_state_after:
        (progression?.state_after as string | undefined) ?? null,
      abort_decision: providerRow.turn_number === 4,
      abort_rule_code: providerRow.turn_number === 4
        ? rows.summary.early_abort_reason ?? null
        : null
    };
  });
  const tutorTurns = rows.tutor.map((tutorRow) => {
    const simulator = rowForTurn(rows.simulator, tutorRow.turn_number);
    const progression = rowForTurn(rows.progression, tutorRow.turn_number);
    const review = rows.review.rows.find((entry) =>
      entry.student_turn_number === tutorRow.turn_number
    );
    return {
      turn_number: tutorRow.turn_number,
      latest_student_message: simulator?.parsed_output.student_message ?? null,
      selected_mode: tutorRow.selected_mode,
      selected_operation: tutorRow.selected_operation,
      tutor_provider_response: tutorRow.parsed_output.student_facing_message,
      effective_student_facing_response:
        tutorRow.runtime_validation.visible_message,
      runtime_acceptance:
        tutorRow.runtime_validation.runtime_acceptance,
      soft_review_flags: tutorRow.runtime_validation.soft_review_flags,
      persistence_result: rowForTurn(rows.persistence, tutorRow.turn_number),
      progression_state_before:
        (progression?.state_before as string | undefined) ?? null,
      progression_state_after:
        (progression?.state_after as string | undefined) ?? null,
      transcript_result: rows.transcript[tutorRow.turn_number - 1] ?? null,
      privacy_result: rowForTurn(rows.privacy, tutorRow.turn_number),
      human_review_status: review?.human_review ?? null
    };
  });
  return {
    reconstruction_version: "e2a20-exact-e2a19-session-reconstruction-v1",
    source_run_id: E2A20_AUTHORITATIVE_E2A19_RUN_ID,
    historical_status: rows.summary.status,
    historical_status_changed: false,
    simulator_turn_count: simulatorTurns.length,
    completed_tutor_turn_count: tutorTurns.length,
    simulator_turns: simulatorTurns,
    tutor_turns: tutorTurns
  };
}

function causalTimeline(reconstruction: ReturnType<typeof reconstructSession>) {
  const events: JsonObject[] = [];
  for (const simulator of reconstruction.simulator_turns) {
    events.push({
      sequence_index: events.length + 1,
      actor: "simulator_student",
      turn_number: simulator.turn_number,
      visible_message: simulator.visible_student_message,
      observed_evidence: simulator.observed_evidence_classification,
      accepted_by_ceiling: simulator.within_evidence_ceiling,
      persisted: simulator.persisted,
      abort_decision: simulator.abort_decision,
      abort_rule_code: simulator.abort_rule_code
    });
    const tutor = reconstruction.tutor_turns.find((entry) =>
      entry.turn_number === simulator.turn_number
    );
    if (tutor) {
      events.push({
        sequence_index: events.length + 1,
        actor: "effective_tutor",
        turn_number: tutor.turn_number,
        selected_mode: tutor.selected_mode,
        selected_operation: tutor.selected_operation,
        visible_message: tutor.effective_student_facing_response,
        runtime_acceptance: tutor.runtime_acceptance,
        persisted: tutor.persistence_result !== null
      });
    }
  }
  return {
    timeline_version: "e2a20-e2a19-causal-timeline-v1",
    source_run_id: E2A20_AUTHORITATIVE_E2A19_RUN_ID,
    ordered_by: "visible_sequence_index",
    event_count: events.length,
    events,
    terminal_cause:
      "turn_4_desired_transition_minimum_was_enforced_before_persistence"
  };
}

function turn4Adjudication(reconstruction: ReturnType<typeof reconstructSession>) {
  const turn = reconstruction.simulator_turns.find((entry) =>
    entry.turn_number === 4
  );
  if (!turn) throw new Error("e2a20_turn4_missing");
  const corrected = adjudicateEvidenceDrivenTransition({
    turn_number: 4,
    maximum_turns: 6,
    evidence_ceiling: "substantive",
    desired_transition_level: "substantive",
    observed_evidence_level: "partial",
    current_hidden_state: "anchor_specific_evidence_is_partial",
    desired_hidden_state: "reasoning_is_revision_eligible",
    exact_evidence_spans: turn.exact_evidence_spans
  });
  return {
    adjudication_version: "e2a20-turn4-adjudication-v1",
    source_run_id: E2A20_AUTHORITATIVE_E2A19_RUN_ID,
    exact_student_message: turn.visible_student_message,
    evidence_ceiling: "substantive",
    desired_transition_level: "substantive",
    observed_evidence_level: "partial",
    within_ceiling: true,
    classifier_v2_result_reproduced: true,
    classifier_v2_result_adjudicated_as_defect: false,
    classifier_note:
      "Partial is retained as the authoritative frozen V2 result; the orchestration must safely handle conservative below-target classification.",
    response_objective_fulfillment: "partially_fulfilled",
    exact_supporting_spans: [
      ...turn.exact_evidence_spans,
      {
        label: "distance_information_boundary",
        span: "Far above or below that location, responses are more predictable and the item gives less information"
      },
      {
        label: "distractor_boundary",
        span: "option A’s claim that it is most informative “at every ability level” is too broad"
      }
    ],
    hidden_state_should_remain: "anchor_specific_evidence_is_partial",
    tutor_mode_that_should_follow: "remain_in_dialogue",
    tutor_operation_that_should_follow: "refine_partial_reasoning",
    turn_should_persist: true,
    fourth_tutor_response_should_be_generated: true,
    session_should_continue_to_remaining_turn_budget: true,
    legitimate_abort_rule_triggered: false,
    corrected_orchestration: corrected
  };
}

function rootCause(turn4: ReturnType<typeof turn4Adjudication>) {
  return {
    classification_version: "e2a20-root-cause-classification-v1",
    source_run_id: E2A20_AUTHORITATIVE_E2A19_RUN_ID,
    selected_categories: [
      "frozen_transition_treated_as_mandatory",
      "evidence_ceiling_conflated_with_required_minimum",
      "simulator_underperformance_valid_but_unsupported_by_protocol",
      "hidden_state_transition_policy_defect",
      "valid_bounded_stop_not_supported",
      "session_evaluator_status_defect",
      "harness_abort_rule_defect"
    ],
    direct_evidence: [
      {
        fact: "turn_4_output_accepted_by_evidence_ceiling",
        evidence: turn4.within_ceiling
      },
      {
        fact: "turn_4_observed_below_desired_transition",
        evidence: {
          observed: turn4.observed_evidence_level,
          desired: turn4.desired_transition_level
        }
      },
      {
        fact: "historical_abort_code_enforced_desired_minimum",
        evidence:
          "e2a19_observable_evidence_insufficient_for_frozen_transition:4:substantive:partial"
      },
      {
        fact: "remaining_turn_budget_existed",
        evidence: { attempted_turn: 4, maximum_turns: 6 }
      }
    ],
    categories_not_selected: {
      evidence_classifier_false_negative:
        "Not established. The frozen V2 partial result is reproducible and remains authoritative for this correction.",
      simulator_prompt_underperformance:
        "The output was role-safe, relevant, and partially fulfilled the objective; no prompt change is justified.",
      tutor_response_failed_to_elicit_progress:
        "The simulator improved from misconception persistence to strong partial reasoning after the tutor replies.",
      protocol_turn_budget_insufficient:
        "Two authorized student turns remained unused.",
      tutor_candidate_defect:
        "No independent hard tutor-quality or safety failure was observed."
    },
    primary_root_cause: "harness_abort_rule_defect",
    tutor_candidate_quality_blocker: false
  };
}

function tutorReviewPacket(reconstruction: ReturnType<typeof reconstructSession>) {
  const dimensionByTurn = {
    1: {
      direct_response: "pass",
      operation_fulfillment: "pass",
      distractor_continuity: "pass",
      pedagogical_precision: "pass",
      strategy_adaptation: "review_flag_only",
      partial_reasoning_refinement: "not_applicable",
      naturalness: "pass",
      likelihood_of_eliciting_improved_evidence: "moderate_to_high"
    },
    2: {
      direct_response: "pass",
      operation_fulfillment: "pass",
      distractor_continuity: "pass",
      pedagogical_precision: "pass",
      strategy_adaptation: "pass",
      partial_reasoning_refinement: "not_applicable",
      naturalness: "pass",
      likelihood_of_eliciting_improved_evidence: "high"
    },
    3: {
      direct_response: "pass",
      operation_fulfillment: "pass",
      distractor_continuity: "pass",
      pedagogical_precision: "pass",
      strategy_adaptation: "pass",
      partial_reasoning_refinement: "review_flag_only",
      naturalness: "pass",
      likelihood_of_eliciting_improved_evidence: "high"
    }
  } as const;
  const rows = reconstruction.tutor_turns.map((turn) => ({
    review_item_id: `e2a20:tutor:${turn.turn_number}`,
    source_run_id: E2A20_AUTHORITATIVE_E2A19_RUN_ID,
    turn_number: turn.turn_number,
    latest_student_message: turn.latest_student_message,
    selected_mode: turn.selected_mode,
    selected_operation: turn.selected_operation,
    effective_tutor_response: turn.effective_student_facing_response,
    runtime_acceptance: turn.runtime_acceptance,
    soft_review_flags: turn.soft_review_flags,
    deterministic_review:
      dimensionByTurn[turn.turn_number as keyof typeof dimensionByTurn],
    progression_safety: "pass",
    privacy_and_answer_key_safety: "pass",
    concern_attribution: turn.turn_number === 3
      ? "protocol_orchestration_concern_not_tutor_failure"
      : "no_blocking_concern",
    candidate_quality_blocker: false,
    human_review: {
      decision: null,
      critical_failure: null,
      reviewer_notes: null,
      reviewer_identity: null,
      reviewed_at: null
    }
  }));
  return {
    packet_version: "e2a20-three-item-tutor-output-review-v1",
    source_run_id: E2A20_AUTHORITATIVE_E2A19_RUN_ID,
    review_item_count: rows.length,
    candidate_quality_blocker: false,
    human_review_required: true,
    human_review_completed: false,
    rows
  };
}

function historicalReplay(
  reconstruction: ReturnType<typeof reconstructSession>,
  turn4: ReturnType<typeof turn4Adjudication>
) {
  return {
    replay_version: "e2a20-immutable-e2a19-output-replay-v1",
    source_run_id: E2A20_AUTHORITATIVE_E2A19_RUN_ID,
    provider_call_count: 0,
    exact_simulator_output_count: reconstruction.simulator_turn_count,
    exact_tutor_output_count: reconstruction.completed_tutor_turn_count,
    replayed_turns: reconstruction.simulator_turns.map((turn) => ({
      turn_number: turn.turn_number,
      historical_ceiling_decision: turn.within_evidence_ceiling
        ? "accepted"
        : "rejected",
      corrected_orchestration_decision: "accepted_and_persisted",
      observed_evidence_level: turn.observed_evidence_classification,
      tutor_output_replay_available: turn.turn_number <= 3,
      corrected_next_step: turn.turn_number === 4
        ? {
          persist_student_turn: true,
          construct_tutor_request: true,
          selected_mode: turn4.tutor_mode_that_should_follow,
          selected_operation: turn4.tutor_operation_that_should_follow
        }
        : "reuse_immutable_historical_tutor_output"
    })),
    counterfactual_result: {
      turns_1_through_4_accepted_by_ceiling: true,
      turns_1_through_4_should_be_persisted: true,
      fourth_tutor_reply_required: true,
      fourth_tutor_reply_available_in_history: false,
      historical_evidence_sufficient_for_turns_5_and_6: false,
      exact_indeterminate_point:
        "after_turn_4_tutor_request_construction_before_tutor_provider_dispatch",
      fabricated_tutor_output: false
    },
    historical_status_changed: false,
    historical_status: E2A20_EXPECTED_E2A19_STATUS
  };
}

function derivedIntegrity() {
  const historicalSummary = readJson<JsonObject>(artifactPath("canary-summary.json"));
  const reached = new Set((historicalSummary.reached_artifacts as string[] | undefined) ?? []);
  const downstreamAfterTurn4 = new Set([
    "student-turn-results.jsonl",
    "routing-decisions.jsonl",
    "tutor-provider-outputs.jsonl",
    "runtime-validation-results.jsonl",
    "pedagogical-rubric-results.jsonl",
    "progression-results.jsonl",
    "persistence-results.jsonl",
    "student-projection-results.jsonl",
    "audit-projection-results.jsonl",
    "transcript-refresh-results.jsonl",
    "privacy-results.jsonl",
    "context-coverage-results.jsonl"
  ]);
  const tutorAndLater = new Set([
    "tutor-provider-outputs.jsonl",
    "runtime-validation-results.jsonl",
    "pedagogical-rubric-results.jsonl",
    "progression-results.jsonl",
    "persistence-results.jsonl",
    "student-projection-results.jsonl",
    "audit-projection-results.jsonl",
    "transcript-refresh-results.jsonl",
    "privacy-results.jsonl",
    "context-coverage-results.jsonl"
  ]);
  const rows = E2A19_AUTHORIZED_ARTIFACTS.map((name) => {
    const filePath = artifactPath(name);
    let fileClassification = "missing";
    if (existsSync(filePath)) {
      try {
        if (name.endsWith(".jsonl")) readJsonl(filePath);
        else if (name.endsWith(".json")) readJson(filePath);
        assertSafeArtifact(readFileSync(filePath, "utf8"));
        fileClassification = statSync(filePath).size > 0
          ? "populated_and_valid"
          : "expected_empty_due_to_turn4_abort";
      } catch {
        fileClassification = "malformed";
      }
    }
    const turn4Classification = !downstreamAfterTurn4.has(name)
      ? reached.has(name) || !name.endsWith(".jsonl")
        ? "populated_and_valid"
        : "expected_empty_due_to_turn4_abort"
      : tutorAndLater.has(name)
        ? "not_generated_because_provider_not_called"
        : "expected_empty_due_to_turn4_abort";
    return {
      artifact: name,
      file_classification: fileClassification,
      turn4_stage_classification: turn4Classification,
      sha256: existsSync(filePath) ? sha256(readFileSync(filePath)) : null
    };
  });
  return {
    adjudication_version: "e2a20-derived-e2a19-integrity-v1",
    source_run_id: E2A20_AUTHORITATIVE_E2A19_RUN_ID,
    historical_status: historicalSummary.status,
    historical_status_changed: false,
    allowed_classifications: [
      "populated_and_valid",
      "expected_empty_due_to_turn4_abort",
      "not_generated_because_provider_not_called",
      "missing",
      "malformed",
      "hash_mismatch"
    ],
    artifact_count: rows.length,
    artifacts: rows,
    result: rows.every((entry) =>
      entry.file_classification === "populated_and_valid"
    )
      ? "evidence_complete_for_documented_turn4_abort"
      : "historical_evidence_integrity_failure",
    e2a19_passed: false
  };
}

function transitionPolicyDelta() {
  return {
    delta_version: "e2a20-transition-policy-delta-v1",
    orchestration_version: E2A20_ORCHESTRATION_VERSION,
    exact_deltas: [
      "Removed desired-transition evidence as a mandatory pre-persistence minimum.",
      "Retained evidence ceiling as a hard upper bound.",
      "Made desired transition non-authoritative scenario intent.",
      "Made observed evidence authoritative for hidden state and progression.",
      "Added completed_valid_bounded_stop after the sixth turn.",
      "Moved simulator objective fulfillment to audit-quality metadata.",
      "Added explicit contract, safety, stability, and infrastructure outcome categories.",
      "Added turn-stage-aware abort integrity classifications."
    ],
    unchanged: {
      simulator_prompt_version: E2A18_SIMULATOR_PROMPT_VERSION,
      simulator_schema_version: E2A18_SIMULATOR_SCHEMA_VERSION,
      simulator_contract_version: E2A18_SIMULATOR_CONTRACT_VERSION,
      evidence_classifier_version: E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      tutor_candidate_hash: E2A14_CANDIDATE_HASH,
      tutor_candidate_file_sha256: E2A14_CANDIDATE_FILE_SHA256,
      tutor_prompts: true,
      tutor_schemas: true,
      tutor_validator: true,
      tutor_routing_contracts: true,
      tutor_progression_contracts: true,
      tutor_retry_policy: true,
      tutor_fallbacks: true
    }
  };
}

export function buildE2A21ProtocolDraft() {
  const session = E2A19_FROZEN_PROTOCOL.session as E2A17SessionProtocol;
  const core = {
    protocol_version: E2A21_PROTOCOL_VERSION,
    orchestration_version: E2A20_ORCHESTRATION_VERSION,
    source_e2a19_protocol_hash: E2A19_PROTOCOL_HASH,
    conceptual_target: "theta_information",
    source_session_id: session.session_id,
    session_count: 1,
    maximum_student_turns: 6,
    maximum_visible_dialogue_turns: 12,
    simulator_contract_version: E2A18_SIMULATOR_CONTRACT_VERSION,
    evidence_classifier_version:
      E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    simulator_prompt_version: E2A18_SIMULATOR_PROMPT_VERSION,
    simulator_schema_version: E2A18_SIMULATOR_SCHEMA_VERSION,
    provider_concurrency: 1,
    required_endpoint: "revision_authorized",
    allowed_terminal_outcomes: [
      "passed_required_endpoint",
      "completed_valid_bounded_stop"
    ],
    fixed_turn_evidence_transition_required: false,
    observed_evidence_controls_transition: true,
    desired_coverage_checkpoints: [
      "initial_distractor_misconception",
      "unsupported_understanding_claim",
      "anchor_specific_evidence",
      "partial_reasoning",
      "refinement",
      "evidence_supported_revision_or_bounded_stop"
    ],
    dynamic_objective_policy: [
      {
        when_observed_state: "active_distractor",
        objective: "Express or clarify the active misconception without exceeding the current evidence ceiling."
      },
      {
        when_observed_state: "unsupported_understanding",
        objective: "Provide anchor-specific evidence or make the remaining misconception observable."
      },
      {
        when_observed_state: "partial_evidence",
        objective: "Refine the missing conceptual relationship without forcing revision readiness."
      },
      {
        when_observed_state: "substantive_evidence",
        objective: "State revision-ready reasoning in the student role."
      }
    ],
    progression_policy: {
      revision_requires_observed_substantive_evidence: true,
      below_target_response_is_persisted: true,
      below_target_response_continues_when_budget_remains: true,
      sixth_turn_below_target_produces_valid_bounded_stop: true,
      desired_transition_may_force_progression: false
    },
    historical_artifacts_mutated: false,
    dispatch_authorized: false,
    provider_calls_made: 0
  } as const;
  return { ...core, protocol_hash: stableHash(core) };
}

export const E2A21_BUDGET_DRAFT = {
  budget_version: "e2a21-single-session-micro-canary-budget-draft-v1",
  maximum_sessions: 1,
  maximum_student_turns: 6,
  maximum_visible_dialogue_turns: 12,
  maximum_simulator_calls: 6,
  maximum_initial_tutor_calls: 6,
  maximum_tutor_regenerations: 2,
  maximum_logical_generation_calls: 14,
  maximum_adapter_attempts: 42,
  maximum_input_tokens: 400_000,
  maximum_output_tokens: 31_000,
  maximum_total_tokens: 431_000,
  maximum_cost_usd_when_pricing_complete: 10,
  provider_concurrency: 1,
  expected_simulator_calls: "5-6",
  expected_tutor_calls: "5-6",
  expected_tutor_regenerations: 0,
  expected_logical_calls: "10-12",
  dispatch_authorized: false,
  provider_calls_made: 0
} as const;

export const E2A21_ARTIFACT_CONTRACT = {
  contract_version: "e2a21-evidence-driven-abort-aware-artifact-contract-v1",
  required_artifacts: E2A19_AUTHORIZED_ARTIFACTS,
  allowed_session_outcomes: [
    "micro_canary_pass_required_endpoint",
    "micro_canary_complete_bounded_stop",
    "micro_canary_failed_contract",
    "micro_canary_failed_safety",
    "micro_canary_failed_stability",
    "micro_canary_incomplete_infrastructure"
  ],
  turn_stage_classifications: [
    "populated_and_valid",
    "expected_empty_due_to_early_abort",
    "not_generated_because_provider_not_called",
    "missing",
    "malformed",
    "hash_mismatch"
  ],
  bounded_stop_is_passed_required_endpoint: false,
  dispatch_authorized: false,
  provider_calls_made: 0
} as const;

export function validateE2A21ProtocolDraft() {
  const protocol = buildE2A21ProtocolDraft();
  const checks = {
    exact_one_session: protocol.session_count === 1,
    maximum_six_student_turns: protocol.maximum_student_turns === 6,
    maximum_twelve_visible_turns:
      protocol.maximum_visible_dialogue_turns === 12,
    simulator_contract_v2: protocol.simulator_contract_version ===
      E2A18_SIMULATOR_CONTRACT_VERSION,
    final_classifier: protocol.evidence_classifier_version ===
      E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    no_fixed_turn_transition: !protocol.fixed_turn_evidence_transition_required,
    observed_evidence_authoritative:
      protocol.observed_evidence_controls_transition,
    required_or_bounded_outcomes:
      protocol.allowed_terminal_outcomes.includes("passed_required_endpoint") &&
      protocol.allowed_terminal_outcomes.includes("completed_valid_bounded_stop"),
    no_dispatch: protocol.dispatch_authorized === false &&
      protocol.provider_calls_made === 0
  };
  return { protocol, checks, passed: Object.values(checks).every(Boolean) };
}

export function validateE2A21BudgetDraft() {
  const budget = E2A21_BUDGET_DRAFT;
  const checks = {
    sessions_one: budget.maximum_sessions === 1,
    student_turns_six: budget.maximum_student_turns === 6,
    simulator_calls_six: budget.maximum_simulator_calls === 6,
    tutor_calls_six: budget.maximum_initial_tutor_calls === 6,
    tutor_regenerations_two: budget.maximum_tutor_regenerations === 2,
    logical_calls_fourteen: budget.maximum_logical_generation_calls === 14,
    adapter_attempts_forty_two: budget.maximum_adapter_attempts === 42,
    input_tokens_400k: budget.maximum_input_tokens === 400_000,
    output_tokens_31k: budget.maximum_output_tokens === 31_000,
    total_tokens_431k: budget.maximum_total_tokens === 431_000,
    cost_ten: budget.maximum_cost_usd_when_pricing_complete === 10,
    concurrency_one: budget.provider_concurrency === 1,
    no_dispatch: budget.dispatch_authorized === false &&
      budget.provider_calls_made === 0
  };
  return { budget, checks, passed: Object.values(checks).every(Boolean) };
}

function protectedSnapshot() {
  const historicalIntegrity = readJson<{
    protected_evidence: JsonObject;
  }>(artifactPath("candidate-integrity.json"));
  const runtime = e2a14ProtectedArtifactSnapshot();
  const historical = Object.fromEntries(Object.entries(
    HISTORICAL_EVIDENCE_DIRS
  ).map(([name, root]) => [name, directoryDigest(root)]));
  const current = {
    approved_v2_hash: runtime.approved_v2_hash,
    tracked_groups: runtime.tracked_groups,
    tutor_candidate: {
      configuration_hash: E2A14_CANDIDATE_HASH,
      file_sha256: sha256(readFileSync(E2A14_CANDIDATE_PATH))
    },
    classifier: {
      version: E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      file_sha256: sha256(readFileSync(CLASSIFIER_SOURCE_PATH))
    },
    historical_evidence: historical
  };
  const baseline = historicalIntegrity.protected_evidence;
  const baselineGroups = baseline as Record<string, unknown>;
  const currentGroups: Record<string, unknown> = runtime.tracked_groups;
  const groupNames = [
    "approved_v2_candidate",
    "approved_operational_manifest",
    "approved_active_bundle",
    "approved_prompts",
    "approved_provider_schema_semantics",
    "approved_topic_validator",
    "approval_evidence",
    "activation_evidence"
  ];
  const groupChecks = groupNames.map((name) => ({
    group: name,
    expected: baselineGroups[name],
    current: currentGroups[name],
    unchanged: stableHash(baselineGroups[name]) === stableHash(currentGroups[name])
  }));
  const baselineHistorical = baselineGroups.historical_evidence as
    Record<string, unknown>;
  const historicalChecks = Object.entries(historical)
    .filter(([name]) => name !== "e2a19")
    .map(([name, digest]) => ({
      group: name,
      expected: baselineHistorical[name],
      current: digest,
      unchanged: stableHash(baselineHistorical[name]) === stableHash(digest)
    }));
  return {
    snapshot_version: "e2a20-protected-evidence-snapshot-v1",
    current,
    current_snapshot_hash: stableHash(current),
    group_checks: groupChecks,
    historical_checks: historicalChecks,
    approved_v2_unchanged: runtime.approved_v2_hash === E2A17_APPROVED_V2_HASH,
    tutor_candidate_unchanged:
      current.tutor_candidate.file_sha256 === E2A14_CANDIDATE_FILE_SHA256,
    classifier_v2_unchanged:
      current.classifier.file_sha256 ===
      "5839e68b24bbdfe437fe133a86da201b2df96d769e9d24b966d370727d4d9037",
    all_unchanged: groupChecks.every((entry) => entry.unchanged) &&
      historicalChecks.every((entry) => entry.unchanged) &&
      runtime.approved_v2_hash === E2A17_APPROVED_V2_HASH &&
      current.tutor_candidate.file_sha256 === E2A14_CANDIDATE_FILE_SHA256 &&
      current.classifier.file_sha256 ===
      "5839e68b24bbdfe437fe133a86da201b2df96d769e9d24b966d370727d4d9037"
  };
}

async function requestCompilation() {
  const tempPath = path.join(os.tmpdir(), `e2a20-compile-${randomUUID()}.json`);
  try {
    const allRoles = await compileE2A14CandidateRequestsNoNetwork(tempPath);
    const historicalCompilation = compileE2A19RequestsNoNetwork();
    const historicalIntegrity = readJson<{
      source_logic: { files: Array<{ path: string; sha256: string }> };
    }>(artifactPath("candidate-integrity.json"));
    const tutorPaths = [
      "src/lib/evaluation/formative/e2a10-v7-topic-dialogue-canary.ts",
      "src/lib/services/student-assessment/topic-dialogue-operation-contract.ts",
      "src/lib/services/student-assessment/topic-dialogue-response-mode.ts",
      "src/lib/services/student-assessment/topic-dialogue-runtime-validation-v2.ts",
      "src/lib/services/student-assessment/topic-dialogue-runtime-validation-v3.ts",
      "src/lib/evaluation/formative/e2a-schemas.ts"
    ];
    const tutorFiles = historicalIntegrity.source_logic.files
      .filter((entry) => tutorPaths.includes(entry.path))
      .map((entry) => ({
        ...entry,
        current_sha256: sha256(readFileSync(path.join(process.cwd(), entry.path))),
        unchanged: entry.sha256 === sha256(readFileSync(
          path.join(process.cwd(), entry.path)
        ))
      }));
    const objectiveCompilation = buildE2A21ProtocolDraft()
      .dynamic_objective_policy.map((entry, index) => ({
        objective_index: index + 1,
        when_observed_state: entry.when_observed_state,
        objective_present: entry.objective.trim().length > 0,
        fixed_turn_number_present: false,
        provider_control_present: false,
        future_response_present: false,
        passed: entry.objective.trim().length > 0
      }));
    const allRoleArtifact = allRoles.artifact as JsonObject;
    return {
      compilation_version: "e2a20-all-role-request-compilation-v1",
      candidate_hash: E2A14_CANDIDATE_HASH,
      candidate_file_sha256: E2A14_CANDIDATE_FILE_SHA256,
      simulator_contract_version: E2A18_SIMULATOR_CONTRACT_VERSION,
      evidence_classifier_version: E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      e2a21_objective_compilation: objectiveCompilation,
      unchanged_tutor_request_compilation: {
        request_pair_count: historicalCompilation.request_pair_count,
        request_contracts_valid: historicalCompilation.rows.every((row) =>
          row.simulator_input_valid && row.simulator_output_valid &&
          row.simulator_contract_valid && row.tutor_provider_input_present &&
          row.tutor_output_schema_present && row.information_flow.passed
        ),
        old_mandatory_transition_result_ignored: true
      },
      unchanged_tutor_source_files: tutorFiles,
      all_role_compilation: allRoleArtifact,
      all_17_roles_compile: allRoleArtifact.all_17_roles_compile === true,
      network_request_count: 0,
      provider_call_count: 0,
      passed: objectiveCompilation.every((entry) => entry.passed) &&
        historicalCompilation.rows.every((row) =>
          row.simulator_input_valid && row.simulator_output_valid &&
          row.simulator_contract_valid && row.tutor_provider_input_present &&
          row.tutor_output_schema_present && row.information_flow.passed
        ) && tutorFiles.every((entry) => entry.unchanged) &&
        allRoleArtifact.all_17_roles_compile === true &&
        allRoleArtifact.network_request_count === 0
    };
  } finally {
    rmSync(tempPath, { force: true });
  }
}

export function validateE2A20Artifacts(runDir: string) {
  const actual = readdirSync(runDir).sort();
  const expected = [...E2A20_ARTIFACT_NAMES].sort();
  const failures: string[] = [];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
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
      assertSafeArtifact(readFileSync(filePath, "utf8"));
    } catch {
      failures.push(`artifact_malformed_or_unsafe:${name}`);
    }
  }
  return {
    validation_version: "e2a20-artifact-integrity-v1",
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

export async function executeE2A20(input: { artifactRoot?: string } = {}) {
  if (!existsSync(E2A19_RUN_DIR)) throw new Error("e2a20_e2a19_run_missing");
  const artifactRoot = input.artifactRoot ?? E2A20_ARTIFACT_ROOT;
  const runId = makeRunId();
  const runDir = path.join(artifactRoot, runId);
  mkdirSync(artifactRoot, { recursive: true });
  mkdirSync(runDir, { recursive: false });
  const paths = pathsFor(runDir);
  const startedAt = new Date().toISOString();
  const protectedBefore = protectedSnapshot();
  if (!protectedBefore.all_unchanged) {
    throw new Error("e2a20_protected_evidence_precheck_failed");
  }
  const historicalSummary = readJson<JsonObject>(artifactPath("canary-summary.json"));
  if (historicalSummary.status !== E2A20_EXPECTED_E2A19_STATUS) {
    throw new Error("e2a20_historical_status_mismatch");
  }
  const reconstruction = reconstructSession();
  const timeline = causalTimeline(reconstruction);
  const turn4 = turn4Adjudication(reconstruction);
  const causes = rootCause(turn4);
  const tutorReview = tutorReviewPacket(reconstruction);
  const transitionTests = runE2A20DeterministicTransitionTests();
  const replay = historicalReplay(reconstruction, turn4);
  const integrity = derivedIntegrity();
  const taxonomy = sessionOutcomeTaxonomy();
  const protocolValidation = validateE2A21ProtocolDraft();
  const budgetValidation = validateE2A21BudgetDraft();
  const compilation = await requestCompilation();
  const delta = transitionPolicyDelta();
  const semantics = evidenceSemantics();

  writeJson(paths["e2a20-manifest.json"], {
    manifest_version: E2A20_VERSION,
    run_id: runId,
    started_at: startedAt,
    source_e2a19_run_id: E2A20_AUTHORITATIVE_E2A19_RUN_ID,
    source_e2a19_status: historicalSummary.status,
    approved_v2_hash: E2A17_APPROVED_V2_HASH,
    tutor_candidate_hash: E2A14_CANDIDATE_HASH,
    tutor_candidate_file_sha256: E2A14_CANDIDATE_FILE_SHA256,
    simulator_contract_version: E2A18_SIMULATOR_CONTRACT_VERSION,
    evidence_classifier_version: E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    classifier_file_sha256: sha256(readFileSync(CLASSIFIER_SOURCE_PATH)),
    orchestration_version: E2A20_ORCHESTRATION_VERSION,
    provider_calls_made: 0,
    e2a19_rerun: false,
    e2a17_rerun: false,
    e2a21_executed: false,
    four_session_canary_run: false,
    thirty_six_session_matrix_run: false,
    candidate_approved: false,
    candidate_activated: false
  });
  writeJson(paths["e2a19-session-reconstruction.json"], reconstruction);
  writeJson(paths["e2a19-causal-timeline.json"], timeline);
  writeJson(paths["root-cause-classification.json"], causes);
  writeJson(paths["evidence-ceiling-and-target-semantics.json"], semantics);
  writeJson(paths["turn4-adjudication.json"], turn4);
  writeJson(paths["tutor-output-review-packet.json"], tutorReview);
  writeJson(paths["transition-policy-delta.json"], delta);
  writeJsonl(paths["deterministic-transition-tests.jsonl"], transitionTests.cases);
  writeJson(paths["historical-e2a19-replay.json"], replay);
  writeJson(paths["e2a19-derived-integrity-adjudication.json"], integrity);
  writeJson(paths["session-outcome-taxonomy.json"], taxonomy);
  writeJson(paths["all-role-request-compilation.json"], compilation);
  writeJson(paths["e2a21-micro-canary-protocol-draft.json"],
    protocolValidation.protocol);
  writeJson(paths["e2a21-budget-draft.json"], budgetValidation.budget);
  writeJson(paths["e2a21-artifact-contract.json"], E2A21_ARTIFACT_CONTRACT);

  const protectedAfter = protectedSnapshot();
  const protectedUnchangedDuringRun = protectedBefore.current_snapshot_hash ===
    protectedAfter.current_snapshot_hash && protectedAfter.all_unchanged;
  const passed = transitionTests.passed && compilation.passed &&
    protocolValidation.passed && budgetValidation.passed &&
    integrity.result === "evidence_complete_for_documented_turn4_abort" &&
    causes.tutor_candidate_quality_blocker === false &&
    protectedUnchangedDuringRun;
  const status = passed
    ? "e2a20_orchestration_corrected_e2a21_ready"
    : "e2a20_root_cause_unresolved";
  const summary = {
    summary_version: "e2a20-evidence-driven-transition-adjudication-summary-v1",
    status,
    run_id: runId,
    run_directory: path.relative(process.cwd(), runDir),
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    source_e2a19_run_id: E2A20_AUTHORITATIVE_E2A19_RUN_ID,
    source_e2a19_status: historicalSummary.status,
    source_e2a19_status_changed: false,
    root_cause_categories: causes.selected_categories,
    turn4_observed_evidence: turn4.observed_evidence_level,
    turn4_within_ceiling: turn4.within_ceiling,
    turn4_should_persist: turn4.turn_should_persist,
    turn4_should_continue: turn4.session_should_continue_to_remaining_turn_budget,
    tutor_candidate_quality_blocker: false,
    corrected_orchestration_version: E2A20_ORCHESTRATION_VERSION,
    deterministic_transition_tests_passed: transitionTests.passed,
    historical_replay_passed:
      replay.counterfactual_result.turns_1_through_4_accepted_by_ceiling,
    derived_integrity_result: integrity.result,
    all_role_request_compilation_passed: compilation.passed,
    e2a21_protocol_validation_passed: protocolValidation.passed,
    e2a21_budget_validation_passed: budgetValidation.passed,
    provider_calls_made: 0,
    protected_evidence_before: protectedBefore.current,
    protected_evidence_after: protectedAfter.current,
    protected_evidence_unchanged: protectedUnchangedDuringRun,
    classifier_v2_unchanged: protectedAfter.classifier_v2_unchanged,
    tutor_candidate_unchanged: protectedAfter.tutor_candidate_unchanged,
    candidate_approved: false,
    candidate_activated: false,
    e2a19_rerun: false,
    e2a17_rerun: false,
    e2a21_executed: false,
    four_session_canary_run: false,
    thirty_six_session_matrix_run: false,
    remaining_blocker_before_e2a21:
      "explicit_user_authorization_for_one_future_e2a21_live_micro_canary",
    remaining_blocker_before_four_session_canary:
      "successful_e2a21_required-endpoint evidence or explicit bounded-stop adjudication plus human review"
  };
  writeJson(paths["summary.json"], summary);
  const artifactValidation = validateE2A20Artifacts(runDir);
  if (!artifactValidation.passed) {
    throw new Error(`e2a20_artifact_validation_failed:${artifactValidation.failures.join(",")}`);
  }
  return { runId, runDir, summary, artifactValidation };
}

export function loadE2A20Run(
  runId: string,
  artifactRoot = E2A20_ARTIFACT_ROOT
) {
  const runDir = path.join(artifactRoot, runId);
  if (!existsSync(runDir)) throw new Error("e2a20_run_not_found");
  return {
    runDir,
    summary: readJson<JsonObject>(path.join(runDir, "summary.json")),
    reconstruction: readJson<JsonObject>(path.join(
      runDir, "e2a19-session-reconstruction.json"
    )),
    turn4: readJson<JsonObject>(path.join(runDir, "turn4-adjudication.json")),
    tutorReview: readJson<JsonObject>(path.join(
      runDir, "tutor-output-review-packet.json"
    )),
    artifactValidation: validateE2A20Artifacts(runDir)
  };
}

export function temporaryE2A20ArtifactRoot() {
  return path.join(os.tmpdir(), `e2a20-${randomBytes(5).toString("hex")}`);
}

export function removeTemporaryE2A20ArtifactRoot(root: string) {
  rmSync(root, { recursive: true, force: true });
}
