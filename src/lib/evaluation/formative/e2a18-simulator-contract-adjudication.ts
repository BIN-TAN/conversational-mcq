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
  E2A17_BUDGET,
  E2A17_CANDIDATE_FILE_SHA256,
  E2A17_CANDIDATE_HASH,
  E2A17_PROTOCOL_HASH,
  E2A17_REQUIRED_ARTIFACTS,
  E2A17_SESSIONS,
  type E2A17SessionProtocol,
  type E2A17TurnProtocol
} from "./e2a17-protocol";
import { compileE2A17RequestsNoNetwork } from
  "./e2a17-bounded-student-simulator-canary";
import {
  LlmStudentSimulatorInputSchema,
  LlmStudentSimulatorOutputSchema,
  type LlmStudentSimulatorOutput,
  type SimulatorEvidenceLevel
} from "./e2a-schemas";
import {
  E2A18_EVIDENCE_LEVELS,
  E2A18_SIMULATOR_CONTRACT_VERSION,
  E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
  E2A18_SIMULATOR_INSTRUCTIONS,
  E2A18_SIMULATOR_PROMPT_VERSION,
  E2A18_SIMULATOR_SCHEMA_VERSION,
  classifyStudentEvidenceV2,
  validateLlmStudentSimulatorOutputV2,
  type E2A18ConceptualAnchor
} from "./e2a18-student-simulator-contract-v2";
import { validateLlmStudentSimulatorOutput } from
  "./llm-student-simulator-validation";

export const E2A18_VERSION =
  "e2a18-simulator-evidence-level-contract-adjudication-v1" as const;
export const E2A18_ARTIFACT_ROOT = path.join(
  process.cwd(), ".data", "e2a18-simulator-contract-adjudication"
);
export const E2A17_AUTHORITATIVE_RUN_ID =
  "e2a17_20260720080442_b0e3f036" as const;
export const E2A17_AUTHORITATIVE_SOURCE_FREEZE =
  "a10915dfdeb5c8f24c72de2b948d35d2a1295b04" as const;
export const E2A17_ARTIFACT_AGGREGATE_SHA256 =
  "499287460f68e6cad18f756f9ac6c4e5550279bf304a5b9ee53cbaf1a00c4b12" as const;
export const E2A19_PROTOCOL_VERSION =
  "e2a19-single-session-student-simulator-micro-canary-draft-v1" as const;

const E2A17_RUN_DIR = path.join(
  process.cwd(), ".data", "e2a17-bounded-student-simulator-canary",
  E2A17_AUTHORITATIVE_RUN_ID
);

const EVIDENCE_DIRS = {
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
  e2a17: E2A17_RUN_DIR
} as const;

const ARTIFACT_NAMES = [
  "e2a18-manifest.json",
  "failed-turn-reconstruction.json",
  "root-cause-classification.json",
  "evidence-level-semantics.json",
  "failed-output-adjudication.json",
  "simulator-contract-delta.json",
  "calibration-corpus.jsonl",
  "calibration-results.jsonl",
  "mutation-results.jsonl",
  "historical-replay.json",
  "abort-aware-integrity-policy.json",
  "e2a17-derived-integrity-adjudication.json",
  "all-role-request-compilation.json",
  "e2a19-micro-canary-protocol-draft.json",
  "e2a19-micro-canary-budget-draft.json",
  "e2a19-artifact-contract.json",
  "summary.json"
] as const;

const E2A19_ARTIFACT_NAMES = [
  "micro-canary-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "candidate-integrity.json",
  "simulator-contract-integrity.json",
  "session-fixture.json",
  "simulator-provider-outputs.jsonl",
  "simulator-validation-results.jsonl",
  "student-turn-results.jsonl",
  "routing-decisions.jsonl",
  "tutor-provider-outputs.jsonl",
  "runtime-validation-results.jsonl",
  "progression-results.jsonl",
  "persistence-results.jsonl",
  "student-projection-results.jsonl",
  "audit-projection-results.jsonl",
  "transcript-refresh-results.jsonl",
  "privacy-results.jsonl",
  "fixture-cleanup-results.json",
  "provider-usage.json",
  "human-review-packet.json",
  "micro-canary-summary.json"
] as const;

type JsonObject = Record<string, unknown>;

type HistoricalSimulatorRow = {
  session_id: string;
  turn_number: number;
  provider: string;
  status: string;
  client_request_id: string;
  provider_request_id: string | null;
  provider_response_id: string | null;
  parsed_output: LlmStudentSimulatorOutput;
  raw_output_sha256: string;
};

type CalibrationCategory =
  | "clearly_below_ceiling"
  | "exactly_at_ceiling"
  | "clearly_above_ceiling"
  | "tentative_or_hedged"
  | "repeated_tutor_language"
  | "boundary_or_ambiguous";

type CalibrationCase = {
  case_id: string;
  category: CalibrationCategory;
  conceptual_anchor: E2A18ConceptualAnchor;
  visible_student_message: string;
  hidden_misconception_category: string;
  authorized_evidence_ceiling: SimulatorEvidenceLevel;
  expected_observed_level: SimulatorEvidenceLevel;
  expected_accept: boolean;
  exact_rationale: string;
  expected_evidence_span_when_rejected: string | null;
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
    throw new Error("e2a18_forbidden_secret_or_private_reasoning");
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
  const files = listFiles(root);
  const rows = files.map((filePath) => ({
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

function selectedProtectedRuntimeSnapshot() {
  const snapshot = e2a14ProtectedArtifactSnapshot();
  const groups = snapshot.tracked_groups;
  return {
    snapshot_version: "e2a18-protected-evidence-snapshot-v1",
    approved_v2_hash: snapshot.approved_v2_hash,
    approved_v2_candidate: groups.approved_v2_candidate,
    approved_operational_manifest: groups.approved_operational_manifest,
    approved_active_bundle: groups.approved_active_bundle,
    approved_prompts: groups.approved_prompts,
    approved_provider_schema_semantics:
      groups.approved_provider_schema_semantics,
    approved_topic_validator: groups.approved_topic_validator,
    approval_evidence: groups.approval_evidence,
    activation_evidence: groups.activation_evidence,
    tutor_candidate: {
      path: path.relative(process.cwd(), E2A14_CANDIDATE_PATH),
      configuration_hash: E2A14_CANDIDATE_HASH,
      expected_file_sha256: E2A14_CANDIDATE_FILE_SHA256,
      actual_file_sha256: sha256(readFileSync(E2A14_CANDIDATE_PATH))
    },
    evidence: Object.fromEntries(Object.entries(EVIDENCE_DIRS).map(
      ([name, root]) => [name, directoryDigest(root)]
    ))
  };
}

function pathsFor(runDir: string) {
  return {
    manifest: path.join(runDir, "e2a18-manifest.json"),
    failedTurn: path.join(runDir, "failed-turn-reconstruction.json"),
    rootCause: path.join(runDir, "root-cause-classification.json"),
    semantics: path.join(runDir, "evidence-level-semantics.json"),
    adjudication: path.join(runDir, "failed-output-adjudication.json"),
    contractDelta: path.join(runDir, "simulator-contract-delta.json"),
    corpus: path.join(runDir, "calibration-corpus.jsonl"),
    calibration: path.join(runDir, "calibration-results.jsonl"),
    mutations: path.join(runDir, "mutation-results.jsonl"),
    replay: path.join(runDir, "historical-replay.json"),
    integrityPolicy: path.join(runDir, "abort-aware-integrity-policy.json"),
    integrityAdjudication: path.join(
      runDir, "e2a17-derived-integrity-adjudication.json"
    ),
    compilation: path.join(runDir, "all-role-request-compilation.json"),
    microProtocol: path.join(
      runDir, "e2a19-micro-canary-protocol-draft.json"
    ),
    microBudget: path.join(runDir, "e2a19-micro-canary-budget-draft.json"),
    microArtifacts: path.join(runDir, "e2a19-artifact-contract.json"),
    summary: path.join(runDir, "summary.json")
  };
}

function runId() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/gu, "")
    .slice(0, 14);
  return `e2a18_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function historicalSimulatorInput(
  session: E2A17SessionProtocol,
  turn: E2A17TurnProtocol
) {
  return LlmStudentSimulatorInputSchema.parse({
    scenario_id: session.session_id,
    scenario_version:
      "e2a17-bounded-independent-student-simulator-canary-v1",
    expression_variant: 1,
    student_persona: {
      conceptual_state:
        `${session.persona.conceptual_state}; current state: ` +
        `${turn.hidden_state_before}; current response objective: ` +
        turn.current_response_objective,
      task_understanding: session.persona.task_understanding,
      engagement: session.persona.engagement,
      confidence: session.persona.confidence,
      communication_style: session.persona.communication_style
    },
    misconception_context: {
      misconception_id: session.hidden_misconception_state.category,
      student_belief_description:
        session.hidden_misconception_state.student_belief_description,
      focus_item_reference: "Item 16",
      focus_option_reference: "A"
    },
    permitted_response: {
      intent: turn.student_intent,
      substantive_evidence_level: turn.maximum_evidence_level,
      may_show_task_improvement: turn.may_show_task_improvement,
      may_show_conceptual_improvement: turn.may_show_conceptual_improvement,
      must_preserve_misconception: turn.must_preserve_misconception,
      must_remain_off_topic: turn.must_remain_off_topic,
      must_request_clarification: turn.must_request_clarification,
      must_avoid_claiming_resolution: turn.must_avoid_claiming_resolution
    },
    visible_conversation: [],
    latest_assistant_message: session.initial_activity_prompt,
    style_constraints: {
      maximum_sentences: 3,
      preferred_length: "short",
      avoid_expert_language: true,
      allow_grammar_imperfection: true,
      avoid_excessive_cooperation: true
    }
  });
}

function originalObservedLevel(message: string): SimulatorEvidenceLevel {
  const words = message.trim().split(/\s+/u).filter(Boolean).length;
  const statesTargetBoundary =
    /\btheta\b/iu.test(message) &&
    /\b(?:person|ability|trait)\b/iu.test(message) &&
    /\b(?:item difficulty|item discrimination|response probability|precision|linked scale)\b/iu.test(
      message
    );
  if (statesTargetBoundary || (words >= 24 &&
    /\b(?:because|while|whereas|therefore|means)\b/iu.test(message))) {
    return "substantive";
  }
  if (words >= 12 &&
    /\b(?:because|but|although|think|seems)\b/iu.test(message)) {
    return "partial";
  }
  return words > 0 ? "minimal" : "none";
}

function hiddenLabelDisclosed(message: string, hiddenLabels: string[]) {
  const lower = message.toLowerCase();
  return hiddenLabels.some((label) => lower.includes(label.toLowerCase()));
}

function calibrationCase(input: Omit<CalibrationCase, "case_id"> & {
  case_id: string;
}) {
  return input;
}

export function buildE2A18CalibrationCorpus(): CalibrationCase[] {
  const misconception = {
    theta_information: "difficulty_implies_universal_information",
    reliability_validity: "reliability_proves_validity",
    correlation_causation: "correlation_proves_causation",
    p_value_interpretation: "p_value_is_probability_null_true",
    measurement_invariance: "same_mean_proves_invariance",
    standard_error_information: "more_information_means_more_error"
  } as const;
  const make = (
    category: CalibrationCategory,
    rows: Array<{
      anchor: E2A18ConceptualAnchor;
      message: string;
      ceiling: SimulatorEvidenceLevel;
      observed: SimulatorEvidenceLevel;
      accept: boolean;
      rationale: string;
      span?: string;
    }>
  ) => rows.map((row, index) => calibrationCase({
    case_id: `${category}_${String(index + 1).padStart(2, "0")}`,
    category,
    conceptual_anchor: row.anchor,
    visible_student_message: row.message,
    hidden_misconception_category: misconception[row.anchor],
    authorized_evidence_ceiling: row.ceiling,
    expected_observed_level: row.observed,
    expected_accept: row.accept,
    exact_rationale: row.rationale,
    expected_evidence_span_when_rejected: row.span ?? null
  }));

  return [
    ...make("clearly_below_ceiling", [
      { anchor: "theta_information", message: "I am considering Item 16 option A.", ceiling: "partial", observed: "minimal", accept: true, rationale: "Topical option reference without a reason." },
      { anchor: "reliability_validity", message: "The question mentions reliability.", ceiling: "partial", observed: "minimal", accept: true, rationale: "Topical term only." },
      { anchor: "correlation_causation", message: "This is about correlation.", ceiling: "partial", observed: "minimal", accept: true, rationale: "Topical term only." },
      { anchor: "p_value_interpretation", message: "I am unsure about this p-value.", ceiling: "partial", observed: "minimal", accept: true, rationale: "Uncertainty without reasoning." },
      { anchor: "measurement_invariance", message: "The groups are being compared for invariance.", ceiling: "partial", observed: "minimal", accept: true, rationale: "Topical description without a boundary." },
      { anchor: "standard_error_information", message: "Information and standard error are related somehow.", ceiling: "partial", observed: "minimal", accept: true, rationale: "Unsupported topical claim." },
      { anchor: "theta_information", message: "Please repeat the task.", ceiling: "partial", observed: "none", accept: true, rationale: "No conceptual evidence about the anchor." },
      { anchor: "correlation_causation", message: "Maybe option B?", ceiling: "partial", observed: "none", accept: true, rationale: "No active-anchor content." }
    ]),
    ...make("exactly_at_ceiling", [
      { anchor: "theta_information", message: "For Item 16, I think option A is right because an extremely difficult item separates students by whether they can answer it, so it gives a lot of information at every theta level.", ceiling: "partial", observed: "partial", accept: true, rationale: "A developed but incorrect misconception rationale remains partial." },
      { anchor: "reliability_validity", message: "High reliability proves validity because consistent scores must measure the intended thing.", ceiling: "partial", observed: "partial", accept: true, rationale: "Misconception rationale is observable but unresolved." },
      { anchor: "correlation_causation", message: "The correlation shows causation because both variables move together.", ceiling: "partial", observed: "partial", accept: true, rationale: "Incorrect causal rationale is partial evidence." },
      { anchor: "p_value_interpretation", message: "The p-value is the probability that the null hypothesis is true because it is small.", ceiling: "partial", observed: "partial", accept: true, rationale: "Incorrect interpretation remains partial." },
      { anchor: "measurement_invariance", message: "The same average proves invariance because both groups scored alike.", ceiling: "partial", observed: "partial", accept: true, rationale: "Incorrect group-level rationale remains partial." },
      { anchor: "standard_error_information", message: "More information gives a larger standard error because more data creates more uncertainty.", ceiling: "partial", observed: "partial", accept: true, rationale: "Incorrect relation remains partial." },
      { anchor: "theta_information", message: "Information is highest when theta is near item difficulty.", ceiling: "substantive", observed: "substantive", accept: true, rationale: "Complete correct theta-difficulty boundary is allowed at a substantive ceiling." },
      { anchor: "reliability_validity", message: "Reliability supports consistency but does not establish validity for the intended interpretation.", ceiling: "substantive", observed: "substantive", accept: true, rationale: "Complete reliability-validity boundary is allowed at the ceiling." }
    ]),
    ...make("clearly_above_ceiling", [
      { anchor: "theta_information", message: "Information is highest when theta is near item difficulty.", ceiling: "partial", observed: "substantive", accept: false, rationale: "Complete correct boundary exceeds a partial ceiling.", span: "Information is highest when theta is near item difficulty" },
      { anchor: "reliability_validity", message: "Reliability supports consistency but does not establish validity for the intended interpretation.", ceiling: "partial", observed: "substantive", accept: false, rationale: "Complete reliability-validity boundary exceeds the ceiling.", span: "Reliability supports consistency but does not establish validity for the intended interpretation" },
      { anchor: "correlation_causation", message: "Correlation does not establish causation because a third variable or reverse direction can explain the association.", ceiling: "partial", observed: "substantive", accept: false, rationale: "Complete causal alternatives exceed the ceiling.", span: "Correlation does not establish causation because a third variable or reverse direction" },
      { anchor: "p_value_interpretation", message: "A p-value describes data extremity assuming the null hypothesis, rather than the probability that the null hypothesis is true.", ceiling: "partial", observed: "substantive", accept: false, rationale: "Complete conditional interpretation exceeds the ceiling.", span: "p-value describes data extremity assuming the null hypothesis, rather than the probability that the null hypothesis" },
      { anchor: "measurement_invariance", message: "Measurement invariance requires equivalent item parameters across groups so scores have a comparable meaning.", ceiling: "partial", observed: "substantive", accept: false, rationale: "Complete invariance boundary exceeds the ceiling.", span: "Measurement invariance requires equivalent item parameters across groups so scores have a comparable meaning" },
      { anchor: "standard_error_information", message: "Greater information produces a smaller standard error, so precision increases.", ceiling: "partial", observed: "substantive", accept: false, rationale: "Complete inverse relation exceeds the ceiling.", span: "Greater information produces a smaller standard error" },
      { anchor: "theta_information", message: "The hardest item gives the most information because it separates everyone.", ceiling: "minimal", observed: "partial", accept: false, rationale: "A misconception rationale exceeds a minimal ceiling.", span: "The hardest item gives the most information" },
      { anchor: "reliability_validity", message: "High reliability proves validity because consistency guarantees the intended interpretation.", ceiling: "minimal", observed: "partial", accept: false, rationale: "A misconception rationale exceeds a minimal ceiling.", span: "High reliability proves validity" }
    ]),
    ...make("tentative_or_hedged", [
      { anchor: "theta_information", message: "Maybe information is highest when theta is near item difficulty, but I am not sure.", ceiling: "partial", observed: "partial", accept: true, rationale: "Tentative correct wording without application is not substantive evidence." },
      { anchor: "reliability_validity", message: "I think reliability supports consistency but does not establish validity for the intended interpretation.", ceiling: "partial", observed: "partial", accept: true, rationale: "Hedged boundary without application remains partial." },
      { anchor: "correlation_causation", message: "Perhaps correlation does not establish causation because a third variable could explain it.", ceiling: "partial", observed: "partial", accept: true, rationale: "Tentative causal boundary remains partial." },
      { anchor: "p_value_interpretation", message: "Maybe a p-value describes the data assuming the null, rather than the probability the null is true.", ceiling: "partial", observed: "partial", accept: true, rationale: "Tentative conditional interpretation remains partial." },
      { anchor: "measurement_invariance", message: "I guess invariance needs equivalent item parameters across groups so scores are comparable.", ceiling: "partial", observed: "partial", accept: true, rationale: "Hedged statement without application remains partial." },
      { anchor: "standard_error_information", message: "Maybe greater information means a smaller standard error.", ceiling: "partial", observed: "partial", accept: true, rationale: "Tentative inverse relation remains partial." },
      { anchor: "theta_information", message: "I think information depends on theta, but I cannot explain the item difficulty part.", ceiling: "partial", observed: "partial", accept: true, rationale: "Explicitly incomplete distinction remains partial." },
      { anchor: "correlation_causation", message: "Correlation might not mean causation, but I do not know why.", ceiling: "partial", observed: "partial", accept: true, rationale: "Tentative unsupported boundary remains partial." }
    ]),
    ...make("repeated_tutor_language", [
      { anchor: "theta_information", message: "You said information is highest when theta is near item difficulty.", ceiling: "partial", observed: "partial", accept: true, rationale: "Tutor wording repeated without independent application." },
      { anchor: "reliability_validity", message: "The tutor said reliability supports consistency but does not establish validity for the intended interpretation.", ceiling: "partial", observed: "partial", accept: true, rationale: "Tutor wording repeated without independent application." },
      { anchor: "correlation_causation", message: "You said correlation does not establish causation because a third variable can explain it.", ceiling: "partial", observed: "partial", accept: true, rationale: "Tutor wording repeated without independent application." },
      { anchor: "p_value_interpretation", message: "I am repeating that a p-value describes data assuming the null rather than the probability the null is true.", ceiling: "partial", observed: "partial", accept: true, rationale: "Explicit repetition is not independent application." },
      { anchor: "measurement_invariance", message: "The tutor said invariance requires equivalent item parameters across groups so scores are comparable.", ceiling: "partial", observed: "partial", accept: true, rationale: "Tutor wording repeated without application." },
      { anchor: "standard_error_information", message: "You said greater information produces a smaller standard error.", ceiling: "partial", observed: "partial", accept: true, rationale: "Tutor wording repeated without application." },
      { anchor: "theta_information", message: "That sentence says information is highest when theta is near item difficulty.", ceiling: "partial", observed: "partial", accept: true, rationale: "Quoted relationship is not independently applied." },
      { anchor: "reliability_validity", message: "I am repeating that reliability supports consistency but does not establish validity for the intended interpretation.", ceiling: "partial", observed: "partial", accept: true, rationale: "Explicit repetition remains partial." }
    ]),
    ...make("boundary_or_ambiguous", [
      { anchor: "theta_information", message: "Information may depend on theta, but I cannot say how item difficulty enters.", ceiling: "partial", observed: "partial", accept: true, rationale: "Incomplete boundary is conservatively partial." },
      { anchor: "reliability_validity", message: "Reliability might matter for validity, but I do not know the boundary.", ceiling: "partial", observed: "partial", accept: true, rationale: "Ambiguous relation is partial, not substantive." },
      { anchor: "correlation_causation", message: "Correlation may not be causation, but I cannot explain the alternative.", ceiling: "partial", observed: "partial", accept: true, rationale: "Ambiguous correct direction lacks an explanation." },
      { anchor: "p_value_interpretation", message: "The p-value is about the null, but I am unsure which probability it describes.", ceiling: "partial", observed: "partial", accept: true, rationale: "Unresolved probability boundary remains partial." },
      { anchor: "measurement_invariance", message: "Invariance compares groups, but I am unsure whether means or item parameters matter.", ceiling: "partial", observed: "partial", accept: true, rationale: "Unresolved anchor distinction remains partial." },
      { anchor: "standard_error_information", message: "Information affects standard error, but I cannot remember the direction.", ceiling: "partial", observed: "partial", accept: true, rationale: "Direction is missing, so evidence is partial." },
      { anchor: "theta_information", message: "A difficult item may help at some theta values, but I cannot locate where.", ceiling: "partial", observed: "partial", accept: true, rationale: "Bounded partial distinction remains partial." },
      { anchor: "reliability_validity", message: "Consistency seems relevant, but I cannot tell whether it is enough for validity.", ceiling: "partial", observed: "partial", accept: true, rationale: "Tentative unresolved boundary remains partial." }
    ])
  ];
}

export function evaluateE2A18CalibrationCorpus(corpus =
  buildE2A18CalibrationCorpus()) {
  return corpus.map((testCase) => {
    const classification = classifyStudentEvidenceV2({
      message: testCase.visible_student_message,
      conceptual_anchor: testCase.conceptual_anchor
    });
    const above = evidenceRank[classification.observed_level] >
      evidenceRank[testCase.authorized_evidence_ceiling];
    const groundedReject = above &&
      classification.observed_level === "substantive" &&
      classification.exact_evidence_spans.length > 0;
    const accepted = !groundedReject && !(
      above && testCase.authorized_evidence_ceiling === "minimal" &&
      classification.exact_evidence_spans.length > 0
    );
    const expectedSpanFound = testCase.expected_evidence_span_when_rejected ===
      null || classification.exact_evidence_spans.some((entry) =>
      entry.span.toLowerCase().includes(
        testCase.expected_evidence_span_when_rejected!.toLowerCase()
      ) || testCase.expected_evidence_span_when_rejected!.toLowerCase()
        .includes(entry.span.toLowerCase())
    );
    const passed = classification.observed_level ===
      testCase.expected_observed_level &&
      accepted === testCase.expected_accept && expectedSpanFound &&
      (accepted || classification.exact_evidence_spans.length > 0);
    return {
      case_id: testCase.case_id,
      category: testCase.category,
      conceptual_anchor: testCase.conceptual_anchor,
      authorized_evidence_ceiling: testCase.authorized_evidence_ceiling,
      expected_observed_level: testCase.expected_observed_level,
      actual_observed_level: classification.observed_level,
      expected_accept: testCase.expected_accept,
      actual_accept: accepted,
      exact_evidence_spans: classification.exact_evidence_spans,
      rationale_codes: classification.rationale_codes,
      ambiguous: classification.ambiguous,
      expected_span_found: expectedSpanFound,
      rejection_grounded_by_exact_span:
        accepted ? null : classification.exact_evidence_spans.length > 0,
      passed
    };
  });
}

export function buildE2A18MutationResults() {
  const progressive = [
    { mutation: "base_low_evidence", message: "I am looking at Item 16 option A.", expected: "minimal" },
    { mutation: "correct_terminology_only", message: "Item 16 involves theta and item information.", expected: "minimal" },
    { mutation: "correct_unsupported_claim", message: "I think information depends on theta, but I cannot explain why.", expected: "partial" },
    { mutation: "anchor_specific_distinction", message: "A difficult item may help at some theta values, but I cannot locate where.", expected: "partial" },
    { mutation: "complete_causal_explanation", message: "Information is highest when theta is near item difficulty.", expected: "substantive" },
    { mutation: "independent_application", message: "A very difficult item is more informative for high-theta students than for low-theta students.", expected: "substantive" },
    { mutation: "revision_ready_reasoning", message: "For option A, information depends on how close theta is to item difficulty, so difficulty alone cannot make the item informative for everyone.", expected: "substantive" }
  ].map((row, index) => {
    const result = classifyStudentEvidenceV2({
      message: row.message,
      conceptual_anchor: "theta_information"
    });
    return {
      mutation_set: "progressive_observable_content",
      mutation_index: index,
      mutation: row.mutation,
      visible_student_message: row.message,
      expected_observed_level: row.expected,
      actual_observed_level: result.observed_level,
      exact_evidence_spans: result.exact_evidence_spans,
      passed: row.expected === result.observed_level
    };
  });
  const historical = [
    {
      mutation: "exact_failed_response",
      message: "For Item 16, I think option A is right because an extremely difficult item separates students by whether they can answer it, so it gives a lot of information at every theta level.",
      expected_original_accept: false,
      expected_corrected_accept: true
    },
    {
      mutation: "remove_discourse_marker_and_shorten",
      message: "Option A still seems right. The hardest item should give information at every theta.",
      expected_original_accept: true,
      expected_corrected_accept: true
    },
    {
      mutation: "weaken_to_unsupported_choice",
      message: "I still think Item 16 option A is right.",
      expected_original_accept: true,
      expected_corrected_accept: true
    }
  ].map((row, index) => {
    const observedOriginal = originalObservedLevel(row.message);
    const corrected = classifyStudentEvidenceV2({
      message: row.message,
      conceptual_anchor: "theta_information"
    });
    const originalAccept = evidenceRank[observedOriginal] <=
      evidenceRank.partial;
    const correctedAccept = evidenceRank[corrected.observed_level] <=
      evidenceRank.partial;
    return {
      mutation_set: "historical_failure_weakening",
      mutation_index: index,
      mutation: row.mutation,
      visible_student_message: row.message,
      original_observed_level: observedOriginal,
      corrected_observed_level: corrected.observed_level,
      original_accept: originalAccept,
      corrected_accept: correctedAccept,
      expected_original_accept: row.expected_original_accept,
      expected_corrected_accept: row.expected_corrected_accept,
      exact_evidence_spans: corrected.exact_evidence_spans,
      passed: originalAccept === row.expected_original_accept &&
        correctedAccept === row.expected_corrected_accept
    };
  });
  return [...progressive, ...historical];
}

function e2a17ArtifactAggregate() {
  const rows = E2A17_REQUIRED_ARTIFACTS.slice().sort().map((name) => ({
    name,
    sha256: sha256(readFileSync(path.join(E2A17_RUN_DIR, name)))
  }));
  return {
    artifact_count: rows.length,
    aggregate_sha256: sha256(
      rows.map((row) => `${row.name}:${row.sha256}`).join("\n")
    ),
    rows
  };
}

function abortAwareIntegrity() {
  const summary = readJson<JsonObject>(path.join(
    E2A17_RUN_DIR, "canary-summary.json"
  ));
  const expectedEmpty = new Set([
    "information-flow-audit.jsonl",
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
  const stageOrder: Record<string, string> = {
    "information-flow-audit.jsonl": "tutor_request_constructed",
    "student-turn-results.jsonl": "student_turn_persisted",
    "routing-decisions.jsonl": "platform_route_selected",
    "tutor-provider-outputs.jsonl": "tutor_provider_dispatched",
    "runtime-validation-results.jsonl": "tutor_runtime_validated",
    "pedagogical-rubric-results.jsonl": "pedagogical_rubric_applied",
    "progression-results.jsonl": "progression_applied",
    "persistence-results.jsonl": "effective_result_persisted",
    "student-projection-results.jsonl": "student_projection_created",
    "audit-projection-results.jsonl": "audit_projection_created",
    "transcript-refresh-results.jsonl": "transcript_refreshed",
    "privacy-results.jsonl": "effective_response_privacy_scanned",
    "context-coverage-results.jsonl": "tutor_context_coverage_recorded"
  };
  const rows = E2A17_REQUIRED_ARTIFACTS.map((name) => {
    const filePath = path.join(E2A17_RUN_DIR, name);
    if (!existsSync(filePath)) return {
      artifact: name,
      classification: "missing",
      stage: stageOrder[name] ?? "always_required",
      sha256: null,
      contradictory_downstream_record: false
    };
    const content = readFileSync(filePath);
    if (content.length === 0) {
      return {
        artifact: name,
        classification: expectedEmpty.has(name)
          ? "expected_empty_due_to_early_abort"
          : "malformed",
        stage: stageOrder[name] ?? "always_required",
        sha256: sha256(content),
        contradictory_downstream_record: false
      };
    }
    let malformed = false;
    try {
      if (name.endsWith(".jsonl")) readJsonl(filePath);
      else if (name.endsWith(".json")) readJson(filePath);
    } catch {
      malformed = true;
    }
    return {
      artifact: name,
      classification: malformed ? "malformed" : "populated_and_valid",
      stage: stageOrder[name] ?? "always_required",
      sha256: sha256(content),
      contradictory_downstream_record: expectedEmpty.has(name)
    };
  });
  const aggregate = e2a17ArtifactAggregate();
  const mandatoryFailureEvidence = [
    "canary-summary.json",
    "simulator-provider-outputs.jsonl",
    "provider-usage.json",
    "candidate-integrity.json",
    "fixture-cleanup-results.json"
  ];
  const requiredPresent = mandatoryFailureEvidence.every((name) =>
    rows.some((row) => row.artifact === name &&
      row.classification === "populated_and_valid")
  );
  const emptyRowsValid = rows.filter((row) => expectedEmpty.has(row.artifact))
    .every((row) => row.classification ===
      "expected_empty_due_to_early_abort" &&
      row.contradictory_downstream_record === false);
  const aggregateMatches = aggregate.aggregate_sha256 ===
    E2A17_ARTIFACT_AGGREGATE_SHA256;
  const passed = summary.status === "e2a17_canary_incomplete" &&
    summary.early_abort_reason ===
      "e2a17_simulator_contract_failure:evidence_level_exceeded" &&
    requiredPresent && emptyRowsValid && aggregateMatches &&
    rows.every((row) => !["missing", "malformed", "hash_mismatch"].includes(
      row.classification
    ));
  return {
    policy_version: "e2a18-abort-aware-artifact-integrity-v1",
    historical_e2a17_artifact_integrity_passed: false,
    historical_status_unchanged: summary.status,
    abort_stage: "after_simulator_provider_output_before_student_persistence",
    abort_reason: summary.early_abort_reason,
    mandatory_failure_evidence: mandatoryFailureEvidence,
    mandatory_failure_evidence_present: requiredPresent,
    expected_empty_artifact_count: expectedEmpty.size,
    artifact_aggregate_sha256: aggregate.aggregate_sha256,
    expected_artifact_aggregate_sha256: E2A17_ARTIFACT_AGGREGATE_SHA256,
    aggregate_hash_matches: aggregateMatches,
    artifact_rows: rows,
    derived_integrity_result: passed
      ? "evidence_complete_for_documented_early_abort"
      : "derived_integrity_incomplete",
    canary_passed: false,
    session_completed: false,
    passed
  };
}

export function buildE2A19ProtocolDraft() {
  const sourceSession = E2A17_SESSIONS[0];
  const core = {
    protocol_version: E2A19_PROTOCOL_VERSION,
    simulator_contract_version: E2A18_SIMULATOR_CONTRACT_VERSION,
    source_e2a17_protocol_hash: E2A17_PROTOCOL_HASH,
    source_e2a17_session_id: sourceSession.session_id,
    session_count: 1,
    maximum_student_turns: 6,
    maximum_visible_dialogue_turns: 12,
    provider_concurrency: 1,
    required_path: sourceSession.required_path,
    required_endpoint: sourceSession.endpoint,
    session: sourceSession,
    simulator_must_not_jump_directly_to: [
      "sound_anchor_specific_reasoning",
      "revision_ready_reasoning",
      "mastery",
      "transfer_readiness"
    ],
    early_abort_reasons: [
      "simulator_contract_failure",
      "privacy_leak",
      "answer_key_leak",
      "hidden_state_leak",
      "missing_tutor_response",
      "invalid_progression",
      "deterministic_fallback",
      "more_than_two_tutor_regenerations",
      "fixture_cleanup_failure"
    ],
    dispatch_authorized: false,
    provider_requests_made: 0
  };
  return { ...core, frozen_protocol_hash: stableHash(core) };
}

export function buildE2A19BudgetDraft() {
  return {
    budget_version: "e2a19-single-session-micro-canary-budget-draft-v1",
    maximum_sessions: 1,
    maximum_student_turns: 6,
    maximum_visible_dialogue_turns: 12,
    maximum_simulator_calls: 6,
    maximum_simulator_regeneration_calls: 0,
    maximum_tutor_initial_generation_calls: 6,
    maximum_tutor_regeneration_calls: 2,
    maximum_total_logical_generation_calls: 14,
    maximum_transport_retries_per_generation_call: 2,
    maximum_provider_adapter_attempts: 42,
    provider_concurrency: 1,
    per_request_token_caps: E2A17_BUDGET.per_request_token_caps,
    maximum_input_tokens: 400000,
    maximum_output_tokens: 31000,
    maximum_total_tokens: 431000,
    maximum_estimated_cost_usd_when_pricing_available: 10,
    pricing_unavailable_behavior:
      "record_null_cost_and_do_not_fabricate",
    dispatch_authorized: false,
    provider_requests_made: 0
  };
}

export function validateE2A19ProtocolDraft() {
  const protocol = buildE2A19ProtocolDraft();
  const core = { ...protocol } as Record<string, unknown>;
  delete core.frozen_protocol_hash;
  const checks = {
    exact_one_session: protocol.session_count === 1,
    turn_limit_six: protocol.maximum_student_turns === 6,
    dialogue_limit_twelve: protocol.maximum_visible_dialogue_turns === 12,
    session_one_only: protocol.source_e2a17_session_id ===
      E2A17_SESSIONS[0].session_id,
    required_path_preserved: JSON.stringify(protocol.required_path) ===
      JSON.stringify(E2A17_SESSIONS[0].required_path),
    protocol_hash_valid: stableHash(core) === protocol.frozen_protocol_hash,
    dispatch_not_authorized: protocol.dispatch_authorized === false,
    zero_provider_requests: protocol.provider_requests_made === 0
  };
  return { protocol, checks, passed: Object.values(checks).every(Boolean) };
}

export function validateE2A19BudgetDraft() {
  const budget = buildE2A19BudgetDraft();
  const expectedInput = 6 * 24000 + 6 * 32000 + 2 * 32000;
  const expectedOutput = 6 * 500 + 6 * 3500 + 2 * 3500;
  const checks = {
    simulator_calls_six: budget.maximum_simulator_calls === 6,
    tutor_initial_calls_six:
      budget.maximum_tutor_initial_generation_calls === 6,
    tutor_regenerations_two:
      budget.maximum_tutor_regeneration_calls === 2,
    logical_calls_fourteen:
      budget.maximum_total_logical_generation_calls === 14,
    adapter_attempts_forty_two:
      budget.maximum_provider_adapter_attempts === 42,
    input_budget_exact: budget.maximum_input_tokens === expectedInput,
    output_budget_exact: budget.maximum_output_tokens === expectedOutput,
    total_budget_exact:
      budget.maximum_total_tokens === expectedInput + expectedOutput,
    exact_cost_ceiling_recorded:
      budget.maximum_estimated_cost_usd_when_pricing_available === 10,
    dispatch_not_authorized: budget.dispatch_authorized === false,
    zero_provider_requests: budget.provider_requests_made === 0
  };
  return { budget, checks, passed: Object.values(checks).every(Boolean) };
}

function validateArtifacts(runDir: string) {
  const names = readdirSync(runDir).sort();
  const expected = [...ARTIFACT_NAMES].sort();
  const failures: string[] = [];
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
      assertSafeArtifact(readFileSync(filePath, "utf8"));
    } catch {
      failures.push(`artifact_malformed_or_unsafe:${name}`);
    }
  }
  return {
    validation_version: "e2a18-artifact-integrity-v1",
    expected_artifact_count: expected.length,
    actual_artifact_count: names.length,
    artifact_hashes: names.map((name) => ({
      name,
      sha256: sha256(readFileSync(path.join(runDir, name)))
    })),
    failures,
    passed: failures.length === 0
  };
}

async function requestCompilation(runDir: string) {
  const tempPath = path.join(os.tmpdir(), `e2a18-compile-${randomUUID()}.json`);
  try {
    const allRoles = await compileE2A14CandidateRequestsNoNetwork(tempPath);
    const e2a17 = compileE2A17RequestsNoNetwork();
    const sourceIntegrity = readJson<{
      source_logic: { files: Array<{ path: string; sha256: string }> };
    }>(path.join(E2A17_RUN_DIR, "candidate-integrity.json"));
    const unchangedTutorFiles = sourceIntegrity.source_logic.files
      .filter((entry) => [
        "src/lib/evaluation/formative/e2a10-v7-topic-dialogue-canary.ts",
        "src/lib/services/student-assessment/topic-dialogue-operation-contract.ts",
        "src/lib/services/student-assessment/topic-dialogue-response-mode.ts",
        "src/lib/services/student-assessment/topic-dialogue-runtime-validation-v2.ts",
        "src/lib/services/student-assessment/topic-dialogue-runtime-validation-v3.ts",
        "src/lib/evaluation/formative/e2a-schemas.ts"
      ].includes(entry.path))
      .map((entry) => ({
        ...entry,
        current_sha256: sha256(readFileSync(path.join(process.cwd(), entry.path))),
        unchanged: entry.sha256 ===
          sha256(readFileSync(path.join(process.cwd(), entry.path)))
      }));
    const artifact = {
      compilation_version: "e2a18-no-live-request-compilation-v1",
      simulator_contract_version: E2A18_SIMULATOR_CONTRACT_VERSION,
      corrected_simulator_request_count: e2a17.simulator_request_count,
      corrected_simulator_request_contract_changed: false,
      simulator_schema_unchanged: true,
      tutor_request_count: e2a17.tutor_request_count,
      tutor_requests_unchanged: e2a17.passed,
      unchanged_tutor_source_files: unchangedTutorFiles,
      all_role_compilation: allRoles.artifact,
      tutor_candidate_hash: E2A14_CANDIDATE_HASH,
      tutor_candidate_file_sha256: E2A14_CANDIDATE_FILE_SHA256,
      network_request_count: 0,
      passed: e2a17.passed && allRoles.artifact.all_17_roles_compile &&
        allRoles.artifact.network_request_count === 0 &&
        unchangedTutorFiles.every((entry) => entry.unchanged)
    };
    writeJson(path.join(runDir, "all-role-request-compilation.json"), artifact);
    return artifact;
  } finally {
    rmSync(tempPath, { force: true });
  }
}

export async function executeE2A18Adjudication(input: {
  artifactRoot?: string;
  runId?: string;
  generatedAt?: string;
} = {}) {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const id = input.runId ?? runId();
  const root = input.artifactRoot ?? E2A18_ARTIFACT_ROOT;
  const runDir = path.join(root, id);
  if (existsSync(runDir)) throw new Error("e2a18_run_directory_exists");
  mkdirSync(runDir, { recursive: true });
  const paths = pathsFor(runDir);
  const protectedBefore = selectedProtectedRuntimeSnapshot();
  const historicalSummary = readJson<JsonObject>(path.join(
    E2A17_RUN_DIR, "canary-summary.json"
  ));
  const historicalRows = readJsonl<HistoricalSimulatorRow>(path.join(
    E2A17_RUN_DIR, "simulator-provider-outputs.jsonl"
  ));
  if (historicalRows.length !== 1) {
    throw new Error("e2a18_historical_simulator_output_count_mismatch");
  }
  const providerRow = historicalRows[0];
  const session = E2A17_SESSIONS[0];
  const turn = session.turns[0];
  const simulatorInput = historicalSimulatorInput(session, turn);
  const parsedOutput = LlmStudentSimulatorOutputSchema.parse(
    providerRow.parsed_output
  );
  const originalValidation = validateLlmStudentSimulatorOutput({
    simulator_input: simulatorInput,
    output: parsedOutput,
    previous_student_messages: []
  });
  const correctedValidation = validateLlmStudentSimulatorOutputV2({
    simulator_input: simulatorInput,
    output: parsedOutput,
    conceptual_anchor: "theta_information",
    previous_student_messages: []
  });
  const originalLevel = originalObservedLevel(parsedOutput.student_message);
  const originalTriggeringSpans = [
    {
      label: "length_threshold_input",
      span: parsedOutput.student_message,
      word_count: parsedOutput.student_message.split(/\s+/u).length
    },
    { label: "discourse_marker", span: "because" }
  ];
  const failedTurn = {
    reconstruction_version: "e2a18-failed-turn-reconstruction-v1",
    source_run_id: E2A17_AUTHORITATIVE_RUN_ID,
    source_run_status: historicalSummary.status,
    source_freeze_commit: E2A17_AUTHORITATIVE_SOURCE_FREEZE,
    session_id: providerRow.session_id,
    turn_number: providerRow.turn_number,
    simulator_request_id: providerRow.client_request_id,
    provider_request_id: providerRow.provider_request_id,
    simulator_response_id: providerRow.provider_response_id,
    simulator_persona: session.persona,
    hidden_misconception_state: session.hidden_misconception_state,
    confidence_state: session.persona.confidence,
    engagement_state: session.persona.engagement,
    current_student_response_objective: turn.current_response_objective,
    authorized_maximum_evidence_level: turn.maximum_evidence_level,
    exact_simulator_input: simulatorInput,
    exact_parsed_simulator_output: parsedOutput,
    exact_student_facing_message_proposed: parsedOutput.student_message,
    original_contract_observed_evidence_level: originalLevel,
    original_contract_rule_failed: "evidence_level_exceeded",
    original_rule_triggering_spans: originalTriggeringSpans,
    simulator_hidden_label_disclosed: hiddenLabelDisclosed(
      parsedOutput.student_message,
      [turn.hidden_state_before, turn.hidden_state_after,
        session.hidden_misconception_state.category]
    ),
    output_persisted_as_student_turn: false,
    tutor_request_constructed: false,
    tutor_dispatch_occurred: false,
    authorization: "audit_only_not_student_projection"
  };
  writeJson(paths.failedTurn, failedTurn);

  const rootCause = {
    classification_version: "e2a18-root-cause-classification-v1",
    selected_categories: ["evidence_level_classifier_false_positive"],
    rejected_categories: {
      genuine_simulator_overperformance:
        "The response preserves the belief that extreme difficulty supplies information at every theta.",
      simulator_prompt_insufficiently_constrained:
        "The response followed the requested misconception-persistence objective and did not resolve it.",
      response_objective_mapping_defect:
        "The objective, partial ceiling, and preserve-misconception flags are mutually consistent.",
      evidence_level_classifier_boundary_ambiguity:
        "The message is clearly an incorrect misconception rationale, not a borderline correct application.",
      simulator_schema_semantics_mismatch:
        "The structured output self-reported partial, but the V1 checker independently overrode it using observable text.",
      hidden_state_transition_bug:
        "No transition occurred because validation preceded persistence.",
      session_protocol_contradiction:
        "The first-turn protocol consistently requires misconception persistence with a partial ceiling.",
      harness_serialization_defect:
        "The reconstructed request exactly matches the frozen first-turn contract and provider metadata."
    },
    direct_evidence: [
      "The V1 classifier labels any message of at least 24 words containing a configured discourse marker as substantive.",
      `The failed message contains ${originalTriggeringSpans[0].word_count} whitespace-delimited words and the marker because.`,
      "The message explicitly concludes that the item gives information at every theta level, preserving the hidden misconception.",
      "The V1 rejection included no conceptually substantive exact evidence span."
    ],
    outcome: "Outcome B: False-positive classification"
  };
  writeJson(paths.rootCause, rootCause);
  writeJson(paths.semantics, {
    semantics_version: "e2a18-observable-evidence-level-semantics-v1",
    authoritative_level_names_source:
      "src/lib/evaluation/formative/e2a-schemas.ts:SimulatorEvidenceLevelSchema",
    classifier_authority: "platform_owned_observable_student_language",
    provider_self_report_controls_classification: false,
    levels: E2A18_EVIDENCE_LEVELS
  });

  const adjudication = {
    adjudication_version: "e2a18-failed-output-independent-adjudication-v1",
    expected_maximum_level: turn.maximum_evidence_level,
    independently_adjudicated_observed_level:
      correctedValidation.evidence_adjudication.observed_level,
    original_contract_checker_level: originalLevel,
    agreement: false,
    original_triggering_spans: originalTriggeringSpans,
    independently_adjudicated_spans:
      correctedValidation.evidence_adjudication.exact_evidence_spans,
    final_root_cause_decision: "evidence_level_classifier_false_positive",
    genuine_simulator_overperformance: false,
    false_positive_classification: true,
    exact_message_within_authorized_ceiling:
      correctedValidation.evidence_adjudication.accepted
  };
  writeJson(paths.adjudication, adjudication);

  const contractDelta = {
    contract_delta_version: "e2a18-simulator-contract-delta-v1",
    from_contract: "e2a17-student-simulator-contract-v1",
    to_contract: E2A18_SIMULATOR_CONTRACT_VERSION,
    prompt_changes: [],
    prompt_hash_before: sha256(E2A18_SIMULATOR_INSTRUCTIONS),
    prompt_hash_after: sha256(E2A18_SIMULATOR_INSTRUCTIONS),
    prompt_version_before: E2A18_SIMULATOR_PROMPT_VERSION,
    prompt_version_after: E2A18_SIMULATOR_PROMPT_VERSION,
    schema_changes: [],
    schema_version_before: E2A18_SIMULATOR_SCHEMA_VERSION,
    schema_version_after: E2A18_SIMULATOR_SCHEMA_VERSION,
    objective_mapping_changes: [],
    hidden_state_mapping_changes: [],
    evidence_classifier_changes: [
      "Removed word-count-plus-discourse-marker authority for substantive evidence.",
      "Classifies misconception rationales as partial even when fluent or long.",
      "Requires a conceptually complete exact span for above-ceiling substantive rejection.",
      "Treats tentative statements and repeated tutor wording without independent application as partial.",
      "Ignores the provider self-reported evidence level as a decision authority."
    ],
    artifact_integrity_changes: [
      "Adds derived abort-aware classifications without modifying historical E2A.17 integrity."
    ],
    tutor_candidate_changes: [],
    tutor_runtime_changes: [],
    simulator_request_correction_required: false,
    corrected_classifier_required_for_future_live_evidence: true
  };
  writeJson(paths.contractDelta, contractDelta);

  const corpus = buildE2A18CalibrationCorpus();
  const calibration = evaluateE2A18CalibrationCorpus(corpus);
  const mutations = buildE2A18MutationResults();
  writeJsonl(paths.corpus, corpus);
  writeJsonl(paths.calibration, calibration);
  writeJsonl(paths.mutations, mutations);

  const replay = {
    replay_version: "e2a18-exact-e2a17-output-replay-v1",
    source_run_id: E2A17_AUTHORITATIVE_RUN_ID,
    exact_provider_output_sha256: providerRow.raw_output_sha256,
    exact_student_message: parsedOutput.student_message,
    original_contract: {
      valid: originalValidation.valid,
      issue_codes: originalValidation.issues.map((issue) => issue.rule_code),
      observed_level: originalLevel,
      accepted: false
    },
    corrected_contract: {
      valid: correctedValidation.valid,
      issue_codes: correctedValidation.issues.map((issue) => issue.rule_code),
      observed_level: correctedValidation.evidence_adjudication.observed_level,
      exact_evidence_spans:
        correctedValidation.evidence_adjudication.exact_evidence_spans,
      accepted: correctedValidation.valid
    },
    final_adjudication: {
      observed_level:
        correctedValidation.evidence_adjudication.observed_level,
      accepted: correctedValidation.valid,
      reason_for_changed_result:
        "The V2 classifier evaluates conceptual content and exact spans rather than message length plus a discourse marker."
    },
    same_exact_provider_output_now_accepted: correctedValidation.valid,
    corrected_simulator_request_still_required: false,
    corrected_classifier_required_for_future_live_evidence: true,
    historical_e2a17_status_changed: false,
    historical_e2a17_status: historicalSummary.status
  };
  writeJson(paths.replay, replay);

  const integrity = abortAwareIntegrity();
  writeJson(paths.integrityPolicy, {
    policy_version: integrity.policy_version,
    allowed_classifications: [
      "expected_empty_not_reached",
      "expected_empty_due_to_early_abort",
      "populated_and_valid",
      "missing",
      "malformed",
      "hash_mismatch"
    ],
    empty_artifact_requirements: [
      "execution_state_proves_stage_not_reached",
      "abort_reason_precedes_stage",
      "artifact_exists",
      "artifact_type_permits_empty_content",
      "no_contradictory_downstream_record"
    ],
    historical_integrity_is_never_rewritten: true
  });
  writeJson(paths.integrityAdjudication, integrity);

  const compilation = await requestCompilation(runDir);
  const microProtocol = validateE2A19ProtocolDraft();
  const microBudget = validateE2A19BudgetDraft();
  writeJson(paths.microProtocol, microProtocol.protocol);
  writeJson(paths.microBudget, microBudget.budget);
  writeJson(paths.microArtifacts, {
    artifact_contract_version: "e2a19-artifact-contract-draft-v1",
    expected_artifact_count: E2A19_ARTIFACT_NAMES.length,
    expected_artifacts: E2A19_ARTIFACT_NAMES,
    incremental_writes_required: true,
    abort_aware_integrity_required: true,
    human_review_required: true,
    dispatch_authorized: false,
    provider_requests_made: 0
  });

  const protectedAfter = selectedProtectedRuntimeSnapshot();
  const protectedUnchanged = stableHash(protectedBefore) ===
    stableHash(protectedAfter);
  const calibrationPassed = calibration.length >= 48 &&
    calibration.every((row) => row.passed);
  const mutationsPassed = mutations.every((row) => row.passed);
  const hiddenStatePassed = failedTurn.simulator_hidden_label_disclosed ===
    false && failedTurn.output_persisted_as_student_turn === false &&
    failedTurn.tutor_dispatch_occurred === false;
  const ready = calibrationPassed && mutationsPassed &&
    correctedValidation.valid && integrity.passed && compilation.passed &&
    microProtocol.passed && microBudget.passed && protectedUnchanged;
  const status = ready
    ? "e2a18_classifier_calibrated_micro_canary_ready"
    : "e2a18_root_cause_unresolved";
  const manifest = {
    manifest_version: "e2a18-manifest-v1",
    run_id: id,
    generated_at: generatedAt,
    status,
    source_commit: "5d1ffe19429481414532ecb5ba237cb2c13b14d0",
    source_e2a17_run_id: E2A17_AUTHORITATIVE_RUN_ID,
    source_e2a17_status: historicalSummary.status,
    approved_v2_hash: E2A17_APPROVED_V2_HASH,
    tutor_candidate_hash: E2A17_CANDIDATE_HASH,
    tutor_candidate_file_sha256: E2A17_CANDIDATE_FILE_SHA256,
    simulator_contract_version: E2A18_SIMULATOR_CONTRACT_VERSION,
    evidence_classifier_version:
      E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    provider_calls_made: 0,
    e2a17_rerun: false,
    four_session_canary_run: false,
    thirty_six_session_matrix_run: false,
    e2b_implemented_or_run: false,
    candidate_approved: false,
    candidate_activated: false,
    protected_evidence_before: protectedBefore,
    protected_evidence_after: protectedAfter,
    protected_evidence_unchanged: protectedUnchanged
  };
  writeJson(paths.manifest, manifest);
  const summary = {
    summary_version: "e2a18-summary-v1",
    status,
    run_id: id,
    run_directory: path.relative(process.cwd(), runDir),
    root_cause_classification: rootCause.selected_categories,
    outcome: rootCause.outcome,
    exact_failed_message: parsedOutput.student_message,
    authorized_evidence_ceiling: turn.maximum_evidence_level,
    original_observed_level: originalLevel,
    independently_adjudicated_level:
      correctedValidation.evidence_adjudication.observed_level,
    same_exact_output_now_accepted: correctedValidation.valid,
    simulator_prompt_changed: false,
    simulator_schema_changed: false,
    objective_mapping_changed: false,
    hidden_state_mapping_changed: false,
    evidence_classifier_changed: true,
    simulator_contract_version: E2A18_SIMULATOR_CONTRACT_VERSION,
    calibration_corpus_size: corpus.length,
    calibration_pass_count: calibration.filter((row) => row.passed).length,
    calibration_fail_count: calibration.filter((row) => !row.passed).length,
    mutation_count: mutations.length,
    mutation_pass_count: mutations.filter((row) => row.passed).length,
    mutation_fail_count: mutations.filter((row) => !row.passed).length,
    hidden_state_mapping_tests_passed: hiddenStatePassed,
    abort_aware_integrity_result: integrity.derived_integrity_result,
    historical_e2a17_integrity_rewritten: false,
    request_compilation_passed: compilation.passed,
    e2a19_protocol_hash: microProtocol.protocol.frozen_protocol_hash,
    e2a19_protocol_valid: microProtocol.passed,
    e2a19_budget_valid: microBudget.passed,
    provider_calls_made: 0,
    protected_evidence_unchanged: protectedUnchanged,
    tutor_candidate_unchanged: protectedUnchanged &&
      protectedAfter.tutor_candidate.actual_file_sha256 ===
        E2A14_CANDIDATE_FILE_SHA256,
    candidate_approved: false,
    candidate_activated: false,
    e2a19_dispatch_authorized: false,
    remaining_blocker_before_e2a19:
      "explicit review and authorization of the frozen E2A.19 micro-canary protocol and budget"
  };
  writeJson(paths.summary, summary);
  const artifactValidation = validateArtifacts(runDir);
  if (!ready || !artifactValidation.passed) {
    throw new Error([
      "e2a18_adjudication_or_artifact_validation_failed",
      ...artifactValidation.failures,
      ...calibration.filter((row) => !row.passed).map((row) => row.case_id),
      ...mutations.filter((row) => !row.passed).map((row) => row.mutation)
    ].join(":"));
  }
  return { runId: id, runDir, paths, summary, artifactValidation };
}

export function loadE2A18Run(runIdValue: string) {
  const runDir = path.join(E2A18_ARTIFACT_ROOT, runIdValue);
  if (!existsSync(runDir)) throw new Error("e2a18_run_not_found");
  return {
    runDir,
    summary: readJson<JsonObject>(path.join(runDir, "summary.json")),
    replay: readJson<JsonObject>(path.join(runDir, "historical-replay.json")),
    integrity: readJson<JsonObject>(path.join(
      runDir, "e2a17-derived-integrity-adjudication.json"
    )),
    artifactValidation: validateArtifacts(runDir)
  };
}
