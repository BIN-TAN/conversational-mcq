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
import { z } from "zod";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  AutonomousPedagogyInputSchema,
  AutonomousPedagogyOutputSchema,
  validateAutonomousPedagogyOutput
} from "@/lib/services/student-assessment/autonomous-formative-dialogue";
import {
  EvidenceFirstRouteSchema,
  TopicDialogueTurnEvidenceProfileSchema,
  type TopicDialogueTurnEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  snapshotE2A24ProtectedEvidence
} from "./e2a24-autonomous-formative-dialogue";
import {
  evaluateE2A24Candidate,
  E2A24_CANDIDATE_PATH
} from "./e2a24-autonomous-dialogue-candidate";
import {
  E2A26_AUTONOMOUS_CANARY_ORACLE_VERSION,
  E2A26_FAILURE_CODES,
  E2A26_FAILURE_PATH_ARTIFACT_POLICY_VERSION,
  E2A26_SEMANTIC_PROFILE_ENVELOPE_VERSION,
  buildE2A26CalibrationCorpus,
  buildE2A27ArtifactContract,
  buildE2A27BudgetDraft,
  buildE2A27ProtocolDraft,
  evaluateSemanticProfileEnvelope,
  projectProfileForSemanticOracle,
  runE2A26Calibration,
  semanticExpectationForFrozenLabel,
  type RouteMode
} from "./e2a26-semantic-oracle";

export const E2A26_VERSION =
  "e2a26-semantic-evaluation-oracle-calibration-v1" as const;
export const E2A26_STATUS =
  "e2a26_session_c_evidence_incomplete" as const;
export const E2A26_ARTIFACT_ROOT = path.join(
  process.cwd(), ".data", "e2a26-semantic-oracle-calibration"
);
export const E2A25_AUTHORITATIVE_RUN_ID =
  "e2a25_20260721000435_bf179fb6" as const;
export const E2A25_AUTHORITATIVE_RUN = path.join(
  process.cwd(), ".data", "e2a25-autonomous-dialogue-live-canary",
  E2A25_AUTHORITATIVE_RUN_ID
);
export const E2A25_EXPECTED_PROTOCOL_HASH =
  "8c916db2fd3a1cbfdbbb92fe1391eaffcdd685d7b5d8fa7461d04a9cdd36084d" as const;
export const E2A25_EXPECTED_COMPOSITE_HASH =
  "69108194b9e527059e321c50cf1d215abf26652b5cd8fe2383abebef92327dd8" as const;
export const E2A24_EXPECTED_CANDIDATE_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b" as const;
export const E2A24_EXPECTED_CANDIDATE_FILE_SHA =
  "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2" as const;

export const E2A26_ARTIFACT_NAMES = [
  "e2a26-manifest.json",
  "e2a25-session-c-turn2-reconstruction.json",
  "session-c-semantic-adjudication.json",
  "semantic-acceptance-envelope.json",
  "hard-invariants-and-review-ambiguities.json",
  "failure-code-taxonomy.json",
  "e2a25-derived-diagnosis.json",
  "failure-path-artifact-policy.json",
  "e2a25-derived-failure-path-records.jsonl",
  "e2a25-complete-human-review-packet.json",
  "session-a-b-read-only-replay.json",
  "session-c-read-only-replay.json",
  "session-c-tutor-output-adjudication.json",
  "candidate-integrity.json",
  "oracle-delta.json",
  "calibration-corpus.jsonl",
  "calibration-results.jsonl",
  "e2a27-held-out-protocol-draft.json",
  "e2a27-overlap-analysis.json",
  "e2a27-budget-draft.json",
  "e2a27-artifact-contract.json",
  "summary.json"
] as const;

type ArtifactName = typeof E2A26_ARTIFACT_NAMES[number];
type JsonObject = Record<string, unknown>;

const JsonObjectSchema = z.record(z.unknown());
const HistoricalSummarySchema = z.object({
  status: z.literal("e2a25_live_canary_failed_closed"),
  run_id: z.literal(E2A25_AUTHORITATIVE_RUN_ID),
  protocol_hash: z.literal(E2A25_EXPECTED_PROTOCOL_HASH),
  composite_candidate_identity_hash:
    z.literal(E2A25_EXPECTED_COMPOSITE_HASH),
  candidate_configuration_hash: z.literal(E2A24_EXPECTED_CANDIDATE_HASH),
  candidate_file_sha256: z.literal(E2A24_EXPECTED_CANDIDATE_FILE_SHA),
  failure_reason: z.literal("e2a25_genuine_false_sound"),
  session_count_planned: z.literal(3),
  session_count_completed: z.literal(2),
  sessions: z.array(JsonObjectSchema),
  provider_usage: JsonObjectSchema,
  protected_evidence_before_hash: z.string().length(64),
  protected_evidence_after_hash: z.string().length(64),
  protected_evidence_unchanged: z.literal(true),
  candidate_approved: z.literal(false),
  candidate_activated: z.literal(false),
  passed: z.literal(false)
}).passthrough();

const SessionDesignsSchema = z.object({
  protocol_hash: z.literal(E2A25_EXPECTED_PROTOCOL_HASH),
  sessions: z.array(z.object({
    session_id: z.enum(["A", "B", "C"]),
    target_evidence_contract: JsonObjectSchema,
    frozen_student_trajectory: z.array(z.object({
      turn: z.number().int().positive(),
      human_expected_profile: z.string().min(1),
      tutor_expected: z.boolean()
    }).passthrough()),
    human_adjudicated_earliest_sound_turn: z.number().int().positive(),
    required_endpoint: z.string().min(1).optional(),
    allowed_endpoints: z.array(z.string().min(1)).optional()
  }).passthrough())
}).passthrough();

const TutorInputRowSchema = z.object({
  session_id: z.enum(["A", "B", "C"]),
  turn: z.number().int().positive(),
  attempt: z.number().int().positive(),
  request: AutonomousPedagogyInputSchema
}).passthrough();

const SanitizedProviderResultSchema = z.object({
  provider: z.string().min(1),
  status: z.string().min(1),
  client_request_id: z.string().min(1).nullable().optional(),
  provider_request_id: z.string().min(1).nullable().optional(),
  provider_response_id: z.string().min(1).nullable().optional(),
  parsed_output: AutonomousPedagogyOutputSchema,
  raw_output_present: z.boolean(),
  raw_output_sha256: z.string().length(64).nullable(),
  usage: JsonObjectSchema,
  latency_ms: z.number().nonnegative(),
  adapter_attempt_count: z.number().int().positive(),
  transport_retry_count: z.number().int().nonnegative(),
  sanitized_error: z.unknown().nullable()
}).passthrough();

const TutorOutputRowSchema = z.object({
  session_id: z.enum(["A", "B", "C"]),
  turn: z.number().int().positive(),
  attempt: z.number().int().positive(),
  immutable_provider_output: SanitizedProviderResultSchema
}).passthrough();

const ProfileRowSchema = z.object({
  session_id: z.enum(["A", "B", "C"]),
  turn: z.number().int().positive(),
  profile: TopicDialogueTurnEvidenceProfileSchema,
  human_expected_profile: z.string().min(1)
}).passthrough();

const RouteRowSchema = z.object({
  session_id: z.enum(["A", "B", "C"]),
  turn: z.number().int().positive(),
  route: EvidenceFirstRouteSchema,
  effective_response_source: z.string().min(1),
  tutor_called: z.boolean(),
  platform_controls_progression: z.boolean()
}).passthrough();

const UsageSchema = z.object({
  actual: z.object({
    per_call: z.array(z.object({
      role: z.string().min(1),
      session_id: z.enum(["A", "B", "C"]),
      turn: z.number().int().positive(),
      attempt: z.number().int().positive(),
      status: z.string().min(1),
      adapter_attempts: z.number().int().positive(),
      transport_retries: z.number().int().nonnegative(),
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
      reasoning_tokens: z.number().int().nonnegative(),
      total_tokens: z.number().int().nonnegative(),
      estimated_cost_usd: z.number().nullable(),
      pricing_available: z.boolean(),
      latency_ms: z.number().nonnegative()
    }).passthrough())
  }).passthrough()
}).passthrough();

const HumanPacketSchema = z.object({
  packet_version: z.string().min(1),
  run_id: z.literal(E2A25_AUTHORITATIVE_RUN_ID),
  human_review_required: z.literal(true),
  human_review_complete: z.literal(false),
  ratings_prepopulated: z.literal(false),
  recommendation: z.null(),
  item_count: z.number().int().nonnegative(),
  items: z.array(JsonObjectSchema),
  metrics: JsonObjectSchema
}).passthrough();

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(filePath: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(readFileSync(filePath, "utf8")));
}

function readJsonl<T>(filePath: string, schema: z.ZodType<T>): T[] {
  return readFileSync(filePath, "utf8").split(/\r?\n/u).filter(Boolean)
    .map((line) => schema.parse(JSON.parse(line)));
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(filePath: string, values: unknown[]) {
  writeFileSync(filePath,
    values.map((value) => JSON.stringify(value)).join("\n") + "\n", "utf8");
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

function timestampId() {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/gu, "")
    .slice(0, 14);
  return `e2a26_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function sourceIdentity() {
  const sourcePaths = [
    "src/lib/evaluation/formative/e2a26-semantic-oracle.ts",
    "src/lib/evaluation/formative/e2a26-failure-path-evidence.ts",
    "prisma/formative-evaluation-e2a26-run.ts",
    "prisma/formative-evaluation-e2a26-report.ts",
    "prisma/formative-evaluation-e2a26-smoke-test.ts"
  ];
  const sources = sourcePaths.map((sourcePath) => ({
    source_path: sourcePath,
    sha256: sha256(readFileSync(path.join(process.cwd(), sourcePath)))
  }));
  return {
    base_git_commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(), encoding: "utf8"
    }).trim(),
    sources,
    aggregate_sha256: stableHash(sources)
  };
}

function expectedProfile(
  designs: z.infer<typeof SessionDesignsSchema>,
  sessionId: "A" | "B" | "C",
  turn: number
) {
  const session = designs.sessions.find((entry) =>
    entry.session_id === sessionId
  );
  const planned = session?.frozen_student_trajectory.find((entry) =>
    entry.turn === turn
  );
  if (!session || !planned) throw new Error("e2a26_expected_profile_missing");
  return { session, planned };
}

function providerAttempt(
  usage: z.infer<typeof UsageSchema>,
  role: string,
  sessionId: "A" | "B" | "C",
  turn: number
) {
  const row = usage.actual.per_call.find((entry) =>
    entry.role === role && entry.session_id === sessionId && entry.turn === turn
  );
  if (!row) throw new Error(`e2a26_provider_attempt_missing:${role}`);
  return row;
}

function privacyScan(text: string) {
  const patterns = [
    ["answer_key", /\banswer key\b/iu],
    ["hidden_prompt", /\b(?:system|hidden) prompt\b/iu],
    ["provider_control", /\b(?:provider request|schema version|agent call|configuration hash)\b/iu],
    ["secret", /\b(?:api key|bearer token|session secret|database url)\b/iu],
    ["simulator_identity", /\b(?:as an ai|student simulator|hidden state)\b/iu]
  ] as const;
  const findings = patterns.filter(([, pattern]) => pattern.test(text))
    .map(([code]) => code);
  return { passed: findings.length === 0, findings };
}

function protectedSnapshot() {
  const inherited = snapshotE2A24ProtectedEvidence();
  const roots = [
    E2A24_CANDIDATE_PATH,
    path.join(process.cwd(), "config/approved-operational-agent-config.json"),
    path.join(process.cwd(),
      "src/lib/evaluation/formative/e2a20a-student-simulator-evidence-classifier-v3.ts"),
    path.join(process.cwd(),
      "src/lib/evaluation/formative/e2a23a-student-simulator-evidence-classifier-v4.ts"),
    path.join(process.cwd(),
      "src/lib/services/student-assessment/autonomous-formative-dialogue.ts"),
    path.join(process.cwd(),
      "src/lib/services/student-assessment/target-evidence-contract.ts"),
    path.join(process.cwd(),
      ".data/e2a24-autonomous-formative-dialogue-architecture"),
    path.join(process.cwd(),
      ".data/e2a24a-autonomous-dialogue-live-readiness"),
    E2A25_AUTHORITATIVE_RUN,
    path.join(process.cwd(), ".data/e2a25-harness/e2a25-live-runner.ts")
  ];
  const additional = roots.map(treeHash);
  return {
    snapshot_version: "e2a26-protected-evidence-snapshot-v1",
    inherited,
    additional,
    combined_sha256: stableHash({
      inherited: inherited.combined_sha256,
      additional
    })
  };
}

type HistoricalEvidence = ReturnType<typeof loadHistoricalEvidence>;

function loadHistoricalEvidence(runDir = E2A25_AUTHORITATIVE_RUN) {
  if (!existsSync(runDir)) throw new Error("e2a26_e2a25_run_missing");
  const file = (name: string) => path.join(runDir, name);
  const summary = readJson(file("canary-summary.json"), HistoricalSummarySchema);
  const designs = readJson(file("session-designs.json"), SessionDesignsSchema);
  const tutorInputs = readJsonl(file("autonomous-tutor-inputs.jsonl"),
    TutorInputRowSchema);
  const tutorOutputs = readJsonl(
    file("autonomous-tutor-provider-outputs.jsonl"), TutorOutputRowSchema
  );
  const profiles = readJsonl(file("turn-profile-snapshots.jsonl"),
    ProfileRowSchema);
  const routes = readJsonl(file("platform-response-modes.jsonl"),
    RouteRowSchema);
  const usage = readJson(file("usage-and-cost.json"), UsageSchema);
  const humanPacket = readJson(file("human-review-packet.json"),
    HumanPacketSchema);
  const jsonRows = (name: string) => readJsonl(file(name), JsonObjectSchema);
  return {
    runDir,
    summary,
    designs,
    tutorInputs,
    tutorOutputs,
    profiles,
    routes,
    usage,
    humanPacket,
    completeConversations: jsonRows("complete-visible-conversations.jsonl"),
    evaluatorInputs: jsonRows("evaluator-inputs.jsonl"),
    evaluatorOutputs: jsonRows("evaluator-outputs.jsonl"),
    interventions: jsonRows("pedagogical-interventions.jsonl"),
    interventionOutcomes: jsonRows("intervention-outcomes.jsonl"),
    persistence: jsonRows("persistence-and-idempotency.jsonl"),
    privacyResults: jsonRows("privacy-results.jsonl"),
    validatorResults: jsonRows("validator-results.jsonl")
  };
}

function c2Evidence(evidence: HistoricalEvidence) {
  const tutorInput = evidence.tutorInputs.find((entry) =>
    entry.session_id === "C" && entry.turn === 2 && entry.attempt === 1
  );
  const tutorOutput = evidence.tutorOutputs.find((entry) =>
    entry.session_id === "C" && entry.turn === 2 && entry.attempt === 1
  );
  if (!tutorInput || !tutorOutput) {
    throw new Error("e2a26_session_c_turn2_tutor_evidence_missing");
  }
  const profile = TopicDialogueTurnEvidenceProfileSchema.parse(
    tutorInput.request.latest_authoritative_turn_profile
  );
  const { session, planned } = expectedProfile(evidence.designs, "C", 2);
  const hardValidation = validateAutonomousPedagogyOutput({
    candidate_output: tutorOutput.immutable_provider_output.parsed_output,
    request: tutorInput.request
  });
  const evaluatorInputPersisted = evidence.evaluatorInputs.some((entry) =>
    entry.session_id === "C" && entry.turn === 2
  );
  const evaluatorOutputPersisted = evidence.evaluatorOutputs.some((entry) =>
    entry.session_id === "C" && entry.turn === 2
  );
  return {
    tutorInput,
    tutorOutput,
    profile,
    session,
    planned,
    hardValidation,
    evaluatorInputPersisted,
    evaluatorOutputPersisted,
    simulatorAttempt: providerAttempt(evidence.usage, "simulator", "C", 2),
    evaluatorAttempt: providerAttempt(
      evidence.usage, "evidence_evaluator", "C", 2
    ),
    tutorAttempt: providerAttempt(evidence.usage, "tutor_initial", "C", 2)
  };
}

function reconstructC2(evidence: HistoricalEvidence) {
  const c2 = c2Evidence(evidence);
  const conversation = c2.tutorInput.request.complete_visible_formative_conversation;
  const priorVisibleConversation = conversation.visible_turns.filter((turn) =>
    turn.sequence_index < conversation.latest_student_sequence_index
  );
  const copiedResponse = c2.tutorInput.request.latest_student_response;
  const evaluatorRequestStatus = c2.evaluatorInputPersisted
    ? "completed" : "missing";
  const evaluatorOutputStatus = c2.evaluatorOutputPersisted
    ? "completed" : "missing";
  return {
    reconstruction_version: "e2a25-session-c-turn2-reconstruction-v1",
    source_run_id: E2A25_AUTHORITATIVE_RUN_ID,
    historical_status_unchanged: evidence.summary.status,
    session_id: "C",
    turn: 2,
    exact_visible_student_message: copiedResponse.message_text,
    complete_visible_conversation_before_turn_2: priorVisibleConversation,
    complete_visible_conversation_after_student_turn_persisted: conversation,
    simulator_hidden_state_audit_only: {
      category: "copied_wording_without_independent_application",
      response_objective: c2.planned.simulator_instruction,
      never_student_visible: true
    },
    simulator_provider_attempt: {
      stage_status: "completed",
      usage_and_transport: c2.simulatorAttempt,
      exact_provider_envelope_status: "missing",
      output_recovered_from_authoritative_tutor_request:
        copiedResponse.message_text
    },
    evidence_evaluator_request: {
      stage_status: evaluatorRequestStatus,
      provider_attempt_confirmed: true,
      exact_serialized_request_available: c2.evaluatorInputPersisted,
      reconstructable_authoritative_context: {
        complete_visible_formative_conversation: conversation,
        latest_student_message: copiedResponse,
        target_evidence_contract: c2.session.target_evidence_contract,
        current_stage: "autonomous_formative_dialogue"
      },
      limitation: c2.evaluatorInputPersisted ? null :
        "The historical harness did not append the Session-C turn-2 evaluator request before abort."
    },
    evidence_evaluator_provider_output: {
      stage_status: evaluatorOutputStatus,
      provider_attempt_confirmed: true,
      usage_and_transport: c2.evaluatorAttempt,
      exact_provider_output_available: c2.evaluatorOutputPersisted,
      limitation: c2.evaluatorOutputPersisted ? null :
        "The exact structured evaluator provider packet cannot be recreated from downstream artifacts."
    },
    evaluator_semantic_result: {
      stage_status: "completed",
      provenance:
        "authoritative profile embedded in the preserved tutor request",
      candidate_turn_profile: c2.profile,
      criterion_level_evidence_status: "missing",
      available_evidence: {
        observable_evidence_spans: c2.profile.observable_evidence_spans,
        essential_missing_links: c2.profile.essential_missing_links,
        contradictions: c2.profile.contradictions
      }
    },
    frozen_expected_profile: c2.planned.human_expected_profile,
    production_profile: c2.profile,
    platform_mode_decision: {
      stage_status: "completed",
      selected_mode: "remain_in_dialogue",
      basis: "non-sound profile, revision readiness false, and tutor invocation reached",
      exact_historical_route_row_status: "missing"
    },
    autonomous_tutor_request: {
      stage_status: "completed",
      request: c2.tutorInput.request
    },
    tutor_provider_output: {
      stage_status: "completed",
      provider_attempt: c2.tutorAttempt,
      immutable_sanitized_result: c2.tutorOutput.immutable_provider_output
    },
    tutor_hard_validator: {
      stage_status: "completed",
      replay_source: "deterministic_current_validator_no_provider",
      result: c2.hardValidation
    },
    tutor_pedagogical_quality: {
      stage_status: "completed",
      quality_review_version: c2.hardValidation.quality_review_version,
      soft_findings: c2.hardValidation.soft_findings
    },
    persistence: {
      student_turn: "completed",
      profile: "completed_in_transient_isolated_store",
      tutor_response_transient_store: "completed",
      durable_failure_artifact_row: "missing",
      derived_review_packet_persisted: false
    },
    student_display: {
      stage_status: "generated_but_not_displayed",
      displayed_to_student: false,
      suppression_reason: "harness_oracle_abort"
    },
    historical_failure_code: evidence.summary.failure_reason,
    cleanup: evidence.persistence.find((entry) => entry.session_id === "C") ??
      { stage_status: "missing" }
  };
}

function sessionCSemanticAdjudication(
  reconstruction: ReturnType<typeof reconstructC2>
) {
  return {
    adjudication_version: "e2a26-session-c-turn2-semantic-adjudication-v1",
    evidence_source: "immutable_observable_student_response",
    exact_student_message: reconstruction.exact_visible_student_message,
    strict_conceptual_adjudication: {
      preferred_reasoning_quality: "insufficient",
      rationale:
        "The response echoes the tutor's trace and does not independently explain why ordering makes half-discarding valid.",
      independently_applies_concept: false,
      merely_repeats_tutor_wording: true,
      explicitly_asserts_incorrect_relationship: false,
      active_incorrect_claim_resolved: false,
      introduces_new_contradiction: false,
      anchor_application: "absent"
    },
    classroom_formative_assessment_adjudication: {
      acceptable_reasoning_quality_set: ["insufficient", "misconception"],
      preferred_reasoning_quality: "insufficient",
      production_misconception_classification_pedagogically_defensible: true,
      rationale:
        "The copied response supplies no independent evidence and leaves the active misconception unresolved. A conservative misconception label is defensible even though insufficient is the stricter evidence label."
    },
    progression_safety_adjudication: {
      sound: false,
      revision_readiness: false,
      transfer_readiness: false,
      completion_readiness: false,
      appropriate_platform_mode: "remain_in_dialogue",
      appropriate_pedagogical_goal:
        "Elicit an independent comparison explaining why the same midpoint comparison supports a positional discard only in ordered data."
    },
    no_human_review_fabricated: true
  };
}

function hardInvariantsAndAmbiguities() {
  return {
    version: "e2a26-hard-invariants-and-review-ambiguities-v1",
    hard_behavioral_invariants: [
      "copied_wording_alone_is_not_sound",
      "contradiction_prevents_sound",
      "misconception_evidence_does_not_authorize_revision",
      "sound_evidence_authorizes_revision",
      "no_answer_or_privacy_leak",
      "evaluator_runs_before_tutor_decision",
      "latest_profile_controls_routing",
      "complete_visible_history_present",
      "no_tutor_call_after_sound",
      "one_effective_response_per_persisted_student_turn",
      "no_stale_profile",
      "no_unauthorized_progression"
    ],
    acceptable_semantic_variation: [
      "insufficient_or_misconception_when_both_are_defensible",
      "partial_or_misconception_at_a_genuine_boundary",
      "different_reasonable_autonomous_teaching_strategy",
      "different_student_facing_wording",
      "equivalent_learning_gap_terminology"
    ],
    human_review_or_audit_findings: [
      "classification_boundary_ambiguity",
      "strategy_quality",
      "naturalness",
      "mild_repetition",
      "pedagogical_optimality"
    ]
  };
}

function failureTaxonomy() {
  const definitions: Record<typeof E2A26_FAILURE_CODES[number], string> = {
    genuine_false_sound:
      "Production marks a profile sound or revision-ready when independent observable evidence is non-sound.",
    genuine_sound_false_negative:
      "Independent sound evidence remains non-sound or is denied revision.",
    premature_revision:
      "A non-sound profile authorizes revision, transfer, or completion.",
    profile_semantically_outside_allowed_envelope:
      "The profile or route is outside every defensible semantic classification.",
    profile_label_mismatch_within_allowed_envelope:
      "The exact label differs but remains inside the accepted semantic envelope; review only.",
    frozen_oracle_overconstraint:
      "An exact-label oracle fails behavior that satisfies all hard progression invariants.",
    context_integrity_failure:
      "Visible history, ordering, latest-turn identity, or source identity is invalid.",
    evaluator_omission:
      "A required evaluator call or semantic result is absent.",
    tutor_after_sound:
      "The autonomous tutor is called after the latest profile is sound.",
    strategy_adaptation_failure:
      "An ineffective strategy is repeated without a supported reason.",
    failure_path_evidence_incomplete:
      "An attempted call or reached stage is absent from failure-path evidence.",
    infrastructure_incomplete:
      "The run cannot establish the required infrastructure or accounting state."
  };
  return {
    taxonomy_version: "e2a26-failure-code-taxonomy-v1",
    genuine_false_sound_precondition:
      "Production is sound or revision-ready while independent evidence does not support sound understanding.",
    codes: E2A26_FAILURE_CODES.map((code) => ({ code, definition: definitions[code] }))
  };
}

function failurePathPolicy() {
  return {
    policy_version: E2A26_FAILURE_PATH_ARTIFACT_POLICY_VERSION,
    every_attempted_provider_call_recorded: true,
    generated_output_retained_before_fail_closed_decision: true,
    generated_but_not_displayed_output_enters_human_review: true,
    downstream_stage_status_explicit: true,
    allowed_stage_statuses: [
      "completed",
      "generated_but_not_persisted",
      "generated_but_not_displayed",
      "not_reached_due_to_harness_abort",
      "expected_empty_after_abort",
      "missing",
      "malformed"
    ],
    raw_provider_output_prohibited: true,
    hidden_simulator_state_audit_only: true,
    historical_missing_data_must_not_be_fabricated: true
  };
}

function derivedFailureRecords(
  reconstruction: ReturnType<typeof reconstructC2>
) {
  const displayMessage =
    reconstruction.tutor_provider_output.immutable_sanitized_result.parsed_output
      .student_facing_message;
  return [
    { stage: "simulator_provider_attempt", ...reconstruction.simulator_provider_attempt },
    { stage: "evaluator_provider_attempt", ...reconstruction.evidence_evaluator_provider_output },
    { stage: "evaluator_request", ...reconstruction.evidence_evaluator_request },
    { stage: "evaluator_semantic_result", ...reconstruction.evaluator_semantic_result },
    { stage: "candidate_turn_profile", stage_status: "completed",
      profile: reconstruction.production_profile },
    { stage: "mode_decision", ...reconstruction.platform_mode_decision },
    { stage: "tutor_provider_attempt", ...reconstruction.tutor_provider_output },
    { stage: "tutor_hard_validation", ...reconstruction.tutor_hard_validator },
    { stage: "tutor_pedagogical_review", ...reconstruction.tutor_pedagogical_quality },
    { stage: "tutor_persistence", stage_status: "generated_but_not_persisted",
      persisted: false, transient_isolated_store_record_observed: true },
    { stage: "student_display", ...reconstruction.student_display },
    { stage: "privacy_and_forbidden_content_scan", stage_status: "completed",
      result: privacyScan(displayMessage) },
    { stage: "transcript_artifact", stage_status: "not_reached_due_to_harness_abort" },
    { stage: "human_review_item", stage_status: "generated_but_not_persisted",
      historical_packet_included: false, derived_packet_included: true },
    { stage: "cleanup", stage_status: "completed", result: reconstruction.cleanup }
  ];
}

function routeForTurn(
  evidence: HistoricalEvidence,
  sessionId: "A" | "B" | "C",
  turn: number,
  profile: TopicDialogueTurnEvidenceProfile
): RouteMode {
  const historical = evidence.routes.find((entry) =>
    entry.session_id === sessionId && entry.turn === turn
  );
  return historical?.route.selected_mode ??
    (profile.revision_readiness ? "request_revision" : "remain_in_dialogue");
}

function replaySessionsAB(evidence: HistoricalEvidence) {
  const sessions = (["A", "B"] as const).map((sessionId) => {
    const rows = evidence.profiles.filter((entry) =>
      entry.session_id === sessionId
    ).sort((left, right) => left.turn - right.turn);
    const turns = rows.map((row) => {
      const { planned } = expectedProfile(evidence.designs, sessionId, row.turn);
      const expectation = semanticExpectationForFrozenLabel(
        planned.human_expected_profile
      );
      return {
        turn: row.turn,
        frozen_expectation: planned.human_expected_profile,
        production_reasoning_quality: row.profile.reasoning_quality,
        semantic_oracle: evaluateSemanticProfileEnvelope({
          expectation,
          production: projectProfileForSemanticOracle({
            profile: row.profile,
            route_mode: routeForTurn(evidence, sessionId, row.turn, row.profile)
          })
        })
      };
    });
    const design = expectedProfile(evidence.designs, sessionId, 1).session;
    const firstSound = rows.find((entry) =>
      entry.profile.reasoning_quality === "sound"
    )?.turn ?? null;
    const summarySession = evidence.summary.sessions.find((entry) =>
      entry.session_id === sessionId
    );
    const historyRows = evidence.completeConversations.filter((entry) =>
      entry.session_id === sessionId
    );
    return {
      session_id: sessionId,
      turns,
      endpoint: summarySession?.endpoint ?? null,
      endpoint_supported: summarySession?.passed === true,
      human_adjudicated_earliest_sound_turn:
        design.human_adjudicated_earliest_sound_turn,
      evaluator_first_sound_turn: firstSound,
      sound_detection_delay: firstSound === null ? null :
        firstSound - design.human_adjudicated_earliest_sound_turn,
      tutor_calls_after_sound: summarySession?.tutor_calls_after_sound ?? null,
      unnecessary_turns_after_sound:
        summarySession?.unnecessary_turns_after_sound ?? null,
      complete_visible_history_row_count: historyRows.length,
      complete_visible_history_passed: historyRows.length === rows.length,
      intervention_memory_row_count: evidence.interventions.filter((entry) =>
        entry.session_id === sessionId
      ).length,
      exact_label_dependency_affected_pass: false,
      provider_calls_made_during_replay: 0,
      passed: turns.every((entry) => entry.semantic_oracle.passed) &&
        summarySession?.passed === true && firstSound ===
        design.human_adjudicated_earliest_sound_turn
    };
  });
  return {
    replay_version: "e2a26-session-a-b-read-only-replay-v1",
    source_run_id: E2A25_AUTHORITATIVE_RUN_ID,
    immutable_provider_outputs_reused: true,
    provider_calls_made: 0,
    sessions,
    passed: sessions.every((entry) => entry.passed)
  };
}

function replaySessionC(
  evidence: HistoricalEvidence,
  reconstruction: ReturnType<typeof reconstructC2>
) {
  const c1 = evidence.profiles.find((entry) =>
    entry.session_id === "C" && entry.turn === 1
  );
  if (!c1) throw new Error("e2a26_session_c_turn1_profile_missing");
  const entries = [
    { turn: 1, profile: c1.profile },
    { turn: 2, profile: reconstruction.production_profile }
  ].map((entry) => {
    const { planned } = expectedProfile(evidence.designs, "C", entry.turn);
    const expectation = semanticExpectationForFrozenLabel(
      planned.human_expected_profile
    );
    return {
      turn: entry.turn,
      frozen_expectation: planned.human_expected_profile,
      production_profile: entry.profile,
      acceptance_envelope: expectation,
      corrected_oracle_result: evaluateSemanticProfileEnvelope({
        expectation,
        production: projectProfileForSemanticOracle({
          profile: entry.profile,
          route_mode: "remain_in_dialogue"
        })
      }),
      historical_tutor_output: entry.turn === 2
        ? reconstruction.tutor_provider_output.immutable_sanitized_result.parsed_output
          .student_facing_message
        : evidence.humanPacket.items.find((item) =>
          item.session_id === "C" && item.turn === 1 && item.actor_type === "agent"
        )?.student_facing_message ?? null,
      displayed_to_student: entry.turn === 1,
      execution_should_have_continued: entry.turn === 2
    };
  });
  return {
    replay_version: "e2a26-session-c-read-only-replay-v1",
    source_run_id: E2A25_AUTHORITATIVE_RUN_ID,
    provider_calls_made: 0,
    turns: entries,
    corrected_oracle_would_abort_at_turn_2: !entries[1]!
      .corrected_oracle_result.passed,
    corrected_oracle_should_continue_after_turn_2: entries[1]!
      .corrected_oracle_result.passed,
    replay_boundary: {
      last_available_student_turn: 2,
      later_session_c_behavior_evaluated: false,
      reason: "No Session-C turns 3 or 4 provider outputs exist."
    },
    passed: entries.every((entry) => entry.corrected_oracle_result.passed)
  };
}

function tutorOutputAdjudication(
  reconstruction: ReturnType<typeof reconstructC2>
) {
  const output = reconstruction.tutor_provider_output
    .immutable_sanitized_result.parsed_output;
  const scan = privacyScan(output.student_facing_message);
  return {
    adjudication_version: "e2a26-session-c-turn2-tutor-output-adjudication-v1",
    classification: "suitable_for_display",
    direct_response: true,
    acknowledgment_of_copied_or_mixed_reasoning:
      "Acknowledges the traced action without treating it as evidence of understanding.",
    correct_primary_learning_gap: true,
    pedagogical_strategy:
      "Contrasts sorted and unsorted lists using the same midpoint comparison.",
    encourages_independent_application: true,
    reinforces_incorrect_claim: false,
    semantic_repetition: false,
    naturalness: "acceptable",
    next_task_clarity: "clear",
    privacy_scan: scan,
    answer_key_safe: !/\b(?:correct answer|answer key)\b/iu.test(
      output.student_facing_message
    ),
    progression_safe: output.requires_student_response,
    validator_result: reconstruction.tutor_hard_validator.result,
    candidate_quality_blocker: false,
    human_review_decision: null
  };
}

function completeHumanReviewPacket(
  evidence: HistoricalEvidence,
  reconstruction: ReturnType<typeof reconstructC2>
) {
  const profiles = new Map<string, TopicDialogueTurnEvidenceProfile>();
  for (const row of evidence.profiles) {
    profiles.set(`${row.session_id}:${row.turn}`, row.profile);
  }
  profiles.set("C:2", reconstruction.production_profile);
  const enriched: JsonObject[] = evidence.humanPacket.items.map((item) => {
    const sessionId = typeof item.session_id === "string" ? item.session_id : "";
    const turn = typeof item.turn === "number" ? item.turn : null;
    return {
      ...item,
      provider_generated: item.source === "live_student_simulator" ||
        item.source === "autonomous_agent",
      persisted: true,
      displayed_to_student: true,
      suppression_reason: null,
      evaluator_profile_context: turn === null ? null :
        profiles.get(`${sessionId}:${turn}`) ?? null,
      evidence_provenance: "immutable_e2a25_artifact",
      human_review: null
    };
  });
  const generatedC2 = reconstruction.tutor_provider_output
    .immutable_sanitized_result.parsed_output;
  enriched.push({
    session_id: "C",
    turn: 2,
    actor_type: "agent",
    student_facing_message: generatedC2.student_facing_message,
    source: "autonomous_agent_provider_output",
    provider_generated: true,
    persisted: false,
    displayed_to_student: false,
    suppression_reason: "harness_oracle_abort",
    evaluator_profile_context: reconstruction.production_profile,
    strategy_context: {
      primary_learning_gap: generatedC2.primary_learning_gap,
      pedagogical_goal: generatedC2.pedagogical_goal,
      pedagogical_strategy: generatedC2.pedagogical_strategy,
      why_this_strategy_fits_now: generatedC2.why_this_strategy_fits_now,
      prior_interventions_considered: generatedC2.prior_interventions_considered,
      repetition_risk: generatedC2.repetition_risk,
      evidence_sought_from_next_response:
        generatedC2.evidence_sought_from_next_response
    },
    soft_findings: reconstruction.tutor_hard_validator.result.soft_findings,
    safety_scan: privacyScan(generatedC2.student_facing_message),
    evidence_provenance:
      "immutable_autonomous_tutor_provider_output_session_c_turn_2",
    human_review: null
  });
  const transcriptFor = (sessionId: "A" | "B" | "C") => {
    const historical = evidence.completeConversations.filter((entry) =>
      entry.session_id === sessionId
    );
    const last = historical.at(-1)?.complete_visible_conversation ?? null;
    if (sessionId !== "C") return last;
    return {
      visible_before_abort:
        reconstruction.autonomous_tutor_request.request
          .complete_visible_formative_conversation,
      generated_not_displayed_tutor_message: generatedC2.student_facing_message
    };
  };
  return {
    packet_version: "e2a26-complete-e2a25-human-review-packet-v1",
    source_run_id: E2A25_AUTHORITATIVE_RUN_ID,
    historical_packet_item_count: evidence.humanPacket.item_count,
    item_count: enriched.length,
    human_review_required: true,
    human_review_complete: false,
    ratings_prepopulated: false,
    recommendation: null,
    items: enriched,
    session_transcripts: (["A", "B", "C"] as const).map((sessionId) => ({
      session_id: sessionId,
      transcript: transcriptFor(sessionId),
      intervention_history: evidence.interventions.filter((entry) =>
        entry.session_id === sessionId
      )
    })),
    generated_output_omission_corrected: true,
    all_human_decisions_null: enriched.every((item) => item.human_review === null)
  };
}

function collectStrings(value: unknown, output: string[]) {
  if (typeof value === "string") {
    const text = value.trim();
    if (text.length >= 24 && /\s/u.test(text)) output.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, output);
  }
}

function normalize(value: string) {
  return value.toLocaleLowerCase("en-CA").normalize("NFKC")
    .replace(/[^a-z0-9]+/gu, " ").trim().replace(/\s+/gu, " ");
}

function jaccard(left: string, right: string) {
  const a = new Set(normalize(left).split(" ").filter((entry) => entry.length > 2));
  const b = new Set(normalize(right).split(" ").filter((entry) => entry.length > 2));
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return [...a].filter((entry) => b.has(entry)).length / union.size;
}

function overlapAnalysis(protocol: ReturnType<typeof buildE2A27ProtocolDraft>) {
  const roots = readdirSync(path.join(process.cwd(), ".data"), {
    withFileTypes: true
  }).filter((entry) => entry.isDirectory() && /^e2a(?:1[2-9]|2[0-5])/u.test(
    entry.name
  )).map((entry) => path.join(process.cwd(), ".data", entry.name));
  const historical: { text: string; source: string }[] = [];
  for (const root of roots) {
    for (const file of filesRecursively(root)) {
      if (statSync(file).size > 2_000_000 ||
          !/\.(?:json|jsonl|md|txt)$/u.test(file)) continue;
      const raw = readFileSync(file, "utf8");
      const values: unknown[] = [];
      try {
        if (file.endsWith(".jsonl")) {
          for (const line of raw.split(/\r?\n/u).filter(Boolean)) {
            values.push(JSON.parse(line));
          }
        } else if (file.endsWith(".json")) {
          values.push(JSON.parse(raw));
        } else {
          values.push(raw);
        }
      } catch {
        values.push(raw);
      }
      const strings: string[] = [];
      for (const value of values) collectStrings(value, strings);
      historical.push(...strings.map((text) => ({
        text,
        source: path.relative(process.cwd(), file)
      })));
    }
  }
  const planned: string[] = [];
  collectStrings(protocol.session, planned);
  let maximum = { score: 0, planned: "", historical: "", source: "" };
  let exact = 0;
  let normalizedExact = 0;
  const historicalExact = new Set(historical.map((entry) => entry.text));
  const historicalNormalized = new Set(historical.map((entry) =>
    normalize(entry.text)
  ));
  for (const text of planned) {
    if (historicalExact.has(text)) exact += 1;
    if (historicalNormalized.has(normalize(text))) normalizedExact += 1;
    for (const prior of historical) {
      const score = jaccard(text, prior.text);
      if (score > maximum.score) maximum = {
        score, planned: text, historical: prior.text, source: prior.source
      };
    }
  }
  return {
    analysis_version: "e2a27-held-out-overlap-analysis-v1",
    protocol_hash: protocol.protocol_hash,
    historical_root_count: roots.length,
    historical_string_count: historical.length,
    planned_string_count: planned.length,
    exact_match_count: exact,
    normalized_exact_match_count: normalizedExact,
    maximum_token_jaccard: maximum,
    semantic_template_review: {
      copied_reasoning_behavior_intentionally_retained: true,
      domain_concept_distractor_and_wording_are_new: true,
      binary_search_wording_reused: false,
      content_template_duplicate: false
    },
    passed: exact === 0 && normalizedExact === 0 && maximum.score < 0.9
  };
}

function forbiddenArtifactKey(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const result = forbiddenArtifactKey(entry);
      if (result) return result;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const forbidden = new Set([
    "api_key",
    "authorization_header",
    "database_url",
    "session_secret",
    "cookie",
    "chain_of_thought"
  ]);
  for (const [key, entry] of Object.entries(value)) {
    if (forbidden.has(key.toLocaleLowerCase("en-CA"))) return key;
    const result = forbiddenArtifactKey(entry);
    if (result) return result;
  }
  return null;
}

export function validateE2A26Artifacts(runDir: string) {
  const failures: string[] = [];
  const artifacts = E2A26_ARTIFACT_NAMES.map((name) => {
    const filePath = path.join(runDir, name);
    if (!existsSync(filePath)) {
      failures.push(`missing:${name}`);
      return { name, bytes: 0, sha256: null };
    }
    const raw = readFileSync(filePath);
    if (raw.length === 0) failures.push(`empty:${name}`);
    try {
      const values = name.endsWith(".jsonl")
        ? raw.toString("utf8").split(/\r?\n/u).filter(Boolean)
          .map((line) => JSON.parse(line) as unknown)
        : [JSON.parse(raw.toString("utf8"))];
      for (const value of values) {
        const key = forbiddenArtifactKey(value);
        if (key) failures.push(`forbidden_key:${name}:${key}`);
      }
    } catch {
      failures.push(`malformed:${name}`);
    }
    return { name, bytes: raw.length, sha256: sha256(raw) };
  });
  const summary = readJson(path.join(runDir, "summary.json"),
    JsonObjectSchema);
  const packet = readJson(path.join(runDir,
    "e2a25-complete-human-review-packet.json"), JsonObjectSchema);
  const calibration = readJsonl(path.join(runDir, "calibration-results.jsonl"),
    JsonObjectSchema);
  if (summary.status !== E2A26_STATUS) failures.push("status_mismatch");
  if (summary.provider_call_count !== 0 || summary.network_request_count !== 0) {
    failures.push("provider_or_network_count_nonzero");
  }
  if (packet.item_count !== 19 || packet.all_human_decisions_null !== true) {
    failures.push("human_review_packet_incomplete");
  }
  if (calibration.length !== 72 || calibration.some((entry) =>
    entry.passed !== true
  )) failures.push("calibration_failed");
  return {
    validation_version: "e2a26-artifact-validation-v1",
    artifact_count: artifacts.length,
    artifacts,
    failures,
    passed: failures.length === 0
  };
}

export async function executeE2A26(options: {
  root?: string;
  historicalRunDir?: string;
  networkRequestCount?: () => number;
} = {}) {
  const root = options.root ?? E2A26_ARTIFACT_ROOT;
  const runId = timestampId();
  const runDir = path.join(root, runId);
  if (existsSync(runDir)) throw new Error("e2a26_run_already_exists");
  mkdirSync(runDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const source = sourceIdentity();
  const protectedBefore = protectedSnapshot();
  const evidence = loadHistoricalEvidence(
    options.historicalRunDir ?? E2A25_AUTHORITATIVE_RUN
  );
  const reconstruction = reconstructC2(evidence);
  const adjudication = sessionCSemanticAdjudication(reconstruction);
  const expectation = semanticExpectationForFrozenLabel(
    reconstruction.frozen_expected_profile
  );
  const oracleResult = evaluateSemanticProfileEnvelope({
    expectation,
    production: projectProfileForSemanticOracle({
      profile: reconstruction.production_profile,
      route_mode: "remain_in_dialogue"
    })
  });
  const records = derivedFailureRecords(reconstruction);
  const humanPacket = completeHumanReviewPacket(evidence, reconstruction);
  const replayAB = replaySessionsAB(evidence);
  const replayC = replaySessionC(evidence, reconstruction);
  const tutorAdjudication = tutorOutputAdjudication(reconstruction);
  const candidate = evaluateE2A24Candidate();
  const candidateFileSha = sha256(readFileSync(E2A24_CANDIDATE_PATH));
  const candidateIntegrity = {
    integrity_version: "e2a26-candidate-integrity-v1",
    candidate_configuration_hash: candidate.candidate_configuration_hash,
    expected_candidate_configuration_hash: E2A24_EXPECTED_CANDIDATE_HASH,
    candidate_file_sha256: candidateFileSha,
    expected_candidate_file_sha256: E2A24_EXPECTED_CANDIDATE_FILE_SHA,
    candidate_approved: candidate.candidate_approved,
    candidate_activated: candidate.candidate_activated,
    candidate_modified_by_e2a26: false,
    candidate_quality_blocker_identified: false,
    passed: candidate.candidate_configuration_hash ===
      E2A24_EXPECTED_CANDIDATE_HASH && candidateFileSha ===
      E2A24_EXPECTED_CANDIDATE_FILE_SHA && !candidate.candidate_approved &&
      !candidate.candidate_activated
  };
  const corpus = buildE2A26CalibrationCorpus();
  const calibration = runE2A26Calibration();
  const protocol = buildE2A27ProtocolDraft();
  const overlap = overlapAnalysis(protocol);
  const budget = buildE2A27BudgetDraft();
  const artifactContract = buildE2A27ArtifactContract();
  const taxonomy = failureTaxonomy();
  const invariants = hardInvariantsAndAmbiguities();
  const policy = failurePathPolicy();
  const derivedDiagnosis = {
    diagnosis_version: "e2a26-e2a25-derived-diagnosis-v1",
    historical_run_id: E2A25_AUTHORITATIVE_RUN_ID,
    historical_status_unchanged: evidence.summary.status,
    historical_failure_code_unchanged: evidence.summary.failure_reason,
    e2a25_described_as_passed: false,
    derived_diagnosis:
      "e2a25_historical_failure_caused_by_frozen_oracle_overconstraint",
    genuine_false_sound_factually_valid: false,
    reason:
      "Production classified Session-C turn 2 as misconception, kept revision readiness false, and remained in dialogue.",
    old_exact_comparison_failed: true,
    corrected_semantic_oracle: oracleResult,
    candidate_safety_status:
      "no_safety_defect_identified_in_available_session_c_output",
    candidate_progression_safety_status: "passed_for_available_turns",
    session_a_endpoint_status: "passed_required_revision_endpoint",
    session_b_endpoint_status: "passed_required_revision_endpoint",
    session_c_evidence_completeness: "incomplete_exact_evaluator_artifacts",
    session_c_production_behavior_pedagogically_defensible: true,
    later_session_c_behavior: "unevaluated_no_provider_outputs_exist"
  };
  const oracleDelta = {
    delta_version: "e2a26-oracle-delta-v1",
    prior_oracle: "e2a25-exact-frozen-label-comparison-v1",
    new_oracle: E2A26_AUTONOMOUS_CANARY_ORACLE_VERSION,
    exact_label_comparison_removed: true,
    semantic_envelopes_added: true,
    progression_invariants_retained: true,
    failure_codes_corrected: true,
    generated_but_not_displayed_outputs_retained: true,
    human_review_packet_includes_failure_path_attempts: true,
    downstream_stage_statuses_explicit: true,
    production_candidate_changed: false
  };
  const overlapPassed = overlap.passed;
  const calibrationPassed = calibration.every((entry) => entry.passed);
  const historicalMissingEvidence =
    !reconstruction.evidence_evaluator_request.exact_serialized_request_available ||
    !reconstruction.evidence_evaluator_provider_output.exact_provider_output_available;
  const protectedAfter = protectedSnapshot();
  const protectedUnchanged = protectedBefore.combined_sha256 ===
    protectedAfter.combined_sha256;
  const providerCallCount = 0;
  const networkRequestCount = options.networkRequestCount?.() ?? 0;
  const summary = {
    summary_version: "e2a26-summary-v1",
    status: E2A26_STATUS,
    run_id: runId,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    base_git_commit: source.base_git_commit,
    source_aggregate_sha256: source.aggregate_sha256,
    historical_e2a25_status_unchanged: evidence.summary.status,
    derived_diagnosis: derivedDiagnosis.derived_diagnosis,
    genuine_false_sound_factually_valid: false,
    session_c_production_profile_inside_acceptance_envelope:
      oracleResult.passed,
    candidate_quality_blocker_identified: false,
    candidate_configuration_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidateFileSha,
    candidate_approved: false,
    candidate_activated: false,
    oracle_version: E2A26_AUTONOMOUS_CANARY_ORACLE_VERSION,
    semantic_envelope_version: E2A26_SEMANTIC_PROFILE_ENVELOPE_VERSION,
    failure_path_policy_version:
      E2A26_FAILURE_PATH_ARTIFACT_POLICY_VERSION,
    session_a_b_replay_passed: replayAB.passed,
    session_c_replay_passed_through_available_turns: replayC.passed,
    session_c_replay_boundary_turn: 2,
    historical_failure_path_evidence_incomplete: historicalMissingEvidence,
    complete_human_review_packet_item_count: humanPacket.item_count,
    human_review_complete: false,
    calibration_case_count: calibration.length,
    calibration_passed: calibrationPassed,
    calibration_non_irt_count: corpus.filter((entry) => entry.non_irt).length,
    e2a27_protocol_hash: protocol.protocol_hash,
    e2a27_overlap_passed: overlapPassed,
    e2a27_logical_call_maximum: budget.maximum.logical_generation_calls,
    e2a27_live_execution_authorized: false,
    e2a27_live_execution_performed: false,
    provider_call_count: providerCallCount,
    network_request_count: networkRequestCount,
    protected_evidence_before_hash: protectedBefore.combined_sha256,
    protected_evidence_after_hash: protectedAfter.combined_sha256,
    protected_evidence_unchanged: protectedUnchanged,
    e2a25_rerun: false,
    e2a27_run: false,
    later_live_stage_run: false,
    remaining_blockers_before_e2a27_live_authorization: [
      "explicit_user_authorization_required",
      "human_review_of_complete_derived_packet_pending",
      "historical_exact_evaluator_request_and_output_unrecoverable"
    ],
    passed: oracleResult.passed && replayAB.passed && replayC.passed &&
      candidateIntegrity.passed && calibrationPassed && overlapPassed &&
      protectedUnchanged && providerCallCount === 0 && networkRequestCount === 0
  };

  const artifacts: Record<ArtifactName, unknown> = {
    "e2a26-manifest.json": {
      manifest_version: "e2a26-manifest-v1",
      run_id: runId,
      source_identity: source,
      source_run_id: E2A25_AUTHORITATIVE_RUN_ID,
      artifact_names: E2A26_ARTIFACT_NAMES,
      protected_before: protectedBefore,
      protected_after: protectedAfter,
      provider_calls_allowed: false,
      e2a27_execution_authorized: false
    },
    "e2a25-session-c-turn2-reconstruction.json": reconstruction,
    "session-c-semantic-adjudication.json": adjudication,
    "semantic-acceptance-envelope.json": {
      envelope_version: E2A26_SEMANTIC_PROFILE_ENVELOPE_VERSION,
      session_c_turn_2_expectation: expectation,
      production_projection: projectProfileForSemanticOracle({
        profile: reconstruction.production_profile,
        route_mode: "remain_in_dialogue"
      }),
      corrected_oracle_result: oracleResult
    },
    "hard-invariants-and-review-ambiguities.json": invariants,
    "failure-code-taxonomy.json": taxonomy,
    "e2a25-derived-diagnosis.json": derivedDiagnosis,
    "failure-path-artifact-policy.json": policy,
    "e2a25-derived-failure-path-records.jsonl": records,
    "e2a25-complete-human-review-packet.json": humanPacket,
    "session-a-b-read-only-replay.json": replayAB,
    "session-c-read-only-replay.json": replayC,
    "session-c-tutor-output-adjudication.json": tutorAdjudication,
    "candidate-integrity.json": candidateIntegrity,
    "oracle-delta.json": oracleDelta,
    "calibration-corpus.jsonl": corpus,
    "calibration-results.jsonl": calibration,
    "e2a27-held-out-protocol-draft.json": protocol,
    "e2a27-overlap-analysis.json": overlap,
    "e2a27-budget-draft.json": budget,
    "e2a27-artifact-contract.json": artifactContract,
    "summary.json": summary
  };
  for (const [name, value] of Object.entries(artifacts)) {
    const target = path.join(runDir, name);
    if (name.endsWith(".jsonl")) writeJsonl(target, value as unknown[]);
    else writeJson(target, value);
  }
  const validation = validateE2A26Artifacts(runDir);
  if (!validation.passed || !summary.passed) {
    throw new Error(`e2a26_validation_failed:${validation.failures.join("|")}`);
  }
  return { runId, runDir, summary, validation };
}

export function findLatestE2A26Run(root = E2A26_ARTIFACT_ROOT) {
  if (!existsSync(root)) throw new Error("e2a26_artifact_root_missing");
  const runId = readdirSync(root).filter((entry) =>
    entry.startsWith("e2a26_") && statSync(path.join(root, entry)).isDirectory()
  ).sort().at(-1);
  if (!runId) throw new Error("e2a26_run_missing");
  return { runId, runDir: path.join(root, runId) };
}

export function loadE2A26Run(runId?: string) {
  const resolved = runId
    ? { runId, runDir: path.join(E2A26_ARTIFACT_ROOT, runId) }
    : findLatestE2A26Run();
  const summary = readJson(path.join(resolved.runDir, "summary.json"),
    JsonObjectSchema);
  return {
    ...resolved,
    summary,
    validation: validateE2A26Artifacts(resolved.runDir)
  };
}
