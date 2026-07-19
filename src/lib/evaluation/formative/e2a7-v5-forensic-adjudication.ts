import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  buildTopicDialogueModeFallback,
  TOPIC_DIALOGUE_MODE_CONTRACT_FAMILY_VERSION,
  TOPIC_DIALOGUE_MODE_FALLBACK_VERSION,
  TOPIC_DIALOGUE_MODE_INPUT_SCHEMA_VERSION,
  TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS,
  TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_HASH,
  TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_VERSION,
  TOPIC_DIALOGUE_MODE_PROMPT_HASHES,
  TOPIC_DIALOGUE_MODE_SERVER_ENVELOPE_VERSION,
  TOPIC_DIALOGUE_MODE_VALIDATOR_VERSION,
  validateTopicDialogueModeOutput,
  type TopicDialogueResponseMode
} from "@/lib/services/student-assessment/topic-dialogue-response-mode";
import {
  normalizeTopicDialogueProgressionAction
} from "@/lib/services/student-assessment/topic-dialogue-action-normalization";
import type {
  TopicDialogueOutputV3
} from "@/lib/services/student-assessment/topic-dialogue-output-v3";
import {
  E2A4_APPROVED_V2_HASH,
  sha256
} from "./e2a4-topic-dialogue-contract";
import {
  E2A5_FAILED_V4_HASH
} from "./e2a5-topic-dialogue-progression-contract";
import {
  e2a5ProtectedArtifactSnapshot
} from "./e2a5-progression-adjudication";
import {
  E2A6_CANDIDATE_FILE_SHA256,
  E2A6_CANDIDATE_HASH
} from "./e2a6-v5-topic-dialogue-evaluation";
import {
  e2a6DispatchCanaryCases
} from "./e2a6-v5-topic-dialogue-protocol";
import {
  compileE2A7CandidateRequestsNoNetwork
} from "./e2a7-request-compilation";
import {
  E2A7_CANDIDATE_PATH,
  evaluateE2A7Candidate
} from "./e2a7-topic-dialogue-mode-candidate";

export const E2A7_ADJUDICATION_VERSION =
  "e2a7-authorization-specific-topic-dialogue-adjudication-v1" as const;
export const E2A7_SOURCE_V5_RUN_ID = "e2a6_20260719000538_6cd0cec4";
export const E2A7_SOURCE_V5_RUN_DIR = path.join(
  process.cwd(),
  ".data",
  "e2a6-v5-topic-dialogue-evaluation",
  E2A7_SOURCE_V5_RUN_ID
);
export const E2A7_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a7-topic-dialogue-mode-design"
);
export const E2A7_FAILED_V5_CANDIDATE_PATH = path.join(
  process.cwd(),
  "config",
  "candidate-operational-agent-config.e2a5-topic-dialogue-progression-v1.json"
);

type V5ProviderOutputRecord = {
  case_id: string;
  phase: string;
  attempt_index: number;
  regeneration: boolean;
  provider_request_status: string;
  generation_dispatched: boolean;
  parsed_validated_output: TopicDialogueOutputV3;
};

type V5ValidationRecord = {
  case_id: string;
  attempt_index: number;
  regeneration: boolean;
  valid: boolean;
  schema_valid: boolean;
  issues: Array<{
    field_path: string;
    rule_code: string;
    taxonomy_level: string;
    safe_detail: string;
  }>;
};

type V5PlatformGateRecord = {
  case_id: string;
  authorization: {
    authorized_action: TopicDialogueResponseMode;
  };
  normalization: {
    input_action: string;
    normalized_requested_action: TopicDialogueResponseMode;
    effective_action: TopicDialogueResponseMode;
    authorization_aligned: boolean;
    progression_allowed: boolean;
  } | null;
  rejected: boolean | null;
  overridden: boolean | null;
  activity_active: boolean | null;
};

type V5RubricRecord = {
  case_id: string;
  status: string;
  critical_findings: string[];
  major_findings: string[];
};

const safeOutputSummaries: Record<string, string> = {
  "e2a6_canary_remain_unsupported_understanding:1":
    "Requests an option-A rewrite even though the server selected continued dialogue.",
  "e2a6_canary_remain_unsupported_understanding:2":
    "Uses a bounded sentence-completion question to elicit the reliability-validity distinction.",
  "e2a6_canary_remain_repeated_confusion:1":
    "Directly explains the missing validity evidence, then asks the student to rewrite option A.",
  "e2a6_canary_remain_repeated_confusion:2":
    "Uses a revised explanation but again asks the student to rewrite option A.",
  "e2a6_canary_revision_authorized:1":
    "Requests an explicit one-sentence revision while the structured action remains continued dialogue.",
  "e2a6_canary_revision_authorized:2":
    "Requests a bounded revision while the structured action again remains continued dialogue.",
  "e2a6_canary_transfer_authorized:1":
    "Acknowledges the distinction and transitions to a platform-presented transfer item.",
  "e2a6_canary_transfer_authorized:2":
    "Generates and asks a new transfer question instead of only transitioning to the platform item.",
  "e2a6_canary_completion_authorized:1":
    "Uses appropriate completion language but requests progression choices in the structured action.",
  "e2a6_canary_completion_authorized:2":
    "Acknowledges the accepted evidence and closes the bounded dialogue without a new task."
};

function readJsonLines<T>(filePath: string): T[] {
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonLines(filePath: string, rows: unknown[]) {
  writeFileSync(
    filePath,
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8"
  );
}

function directoryDigest(root: string) {
  if (!existsSync(root)) return { exists: false, file_count: 0, sha256: null };
  const files: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current).sort()) {
      const absolute = path.join(current, entry);
      if (statSync(absolute).isDirectory()) visit(absolute);
      else files.push(absolute);
    }
  };
  visit(root);
  return {
    exists: true,
    file_count: files.length,
    sha256: stableHash(files.map((file) => ({
      path: path.relative(root, file),
      sha256: sha256(readFileSync(file))
    })))
  };
}

export function e2a7ProtectedArtifactSnapshot() {
  const inherited = e2a5ProtectedArtifactSnapshot();
  const failedV5Candidate = sha256(readFileSync(E2A7_FAILED_V5_CANDIDATE_PATH));
  const failedV5Evaluation = directoryDigest(E2A7_SOURCE_V5_RUN_DIR);
  const trackedGroups = {
    ...inherited.tracked_groups,
    failed_v5_candidate: {
      exists: true,
      file_count: 1,
      sha256: failedV5Candidate
    },
    failed_v5_evaluation: failedV5Evaluation
  };
  return {
    snapshot_version: "e2a7-protected-artifact-snapshot-v1",
    approved_runtime_hash: E2A4_APPROVED_V2_HASH,
    failed_v4_candidate_hash: E2A5_FAILED_V4_HASH,
    failed_v5_candidate_hash: E2A6_CANDIDATE_HASH,
    tracked_groups: trackedGroups,
    environment_metadata: inherited.environment_metadata,
    aggregate_sha256: stableHash({
      tracked_groups: trackedGroups,
      environment_metadata: inherited.environment_metadata
    })
  };
}

function legacyResponseFunction(
  mode: TopicDialogueResponseMode,
  output: TopicDialogueOutputV3
) {
  if (mode === "request_revision") return "revision_transition" as const;
  if (mode === "present_transfer") return "transfer_transition" as const;
  if (mode === "complete_episode") return "completion_transition" as const;
  const map: Record<string, string> = {
    clarification: "clarify_task",
    answer_student_question: "explain_concept",
    contrast_distractor: "contrast_distractor",
    worked_example: "use_worked_example",
    foundational_scaffold: "use_concrete_example",
    focused_question: "ask_narrowed_question",
    topic_redirect: "redirect_off_topic",
    readiness_confirmation: "acknowledge_partial_progress"
  };
  return map[output.response_function] ?? "request_student_explanation";
}

function projectHistoricalOutput(
  mode: TopicDialogueResponseMode,
  output: TopicDialogueOutputV3
) {
  const schemaVersion = TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS[mode];
  return {
    schema_version: schemaVersion,
    response_function: legacyResponseFunction(mode, output),
    tutor_message: output.tutor_message,
    evidence_update: output.evidence_update,
    remaining_issue: output.remaining_issue,
    student_safe_summary: output.student_safe_summary,
    expected_response_guidance: mode === "remain_in_dialogue" ||
      mode === "request_revision"
      ? output.expected_response_guidance ?? "Provide the requested bounded response."
      : null,
    safety_flags: output.safety_flags,
    requires_student_response: mode === "remain_in_dialogue" ||
      mode === "request_revision"
  };
}

function classificationLabels(input: {
  caseId: string;
  attemptIndex: number;
  v5Validation: V5ValidationRecord;
  v6LanguageValid: boolean;
  providerActionAligned: boolean;
  v6IssueCodes: string[];
}) {
  const labels = new Set<string>();
  const v5Codes = input.v5Validation.issues.map((issue) => issue.rule_code);
  if (v5Codes.includes("student_facing_progression_language")) {
    labels.add("unauthorized_progression_language");
  }
  if (v5Codes.includes("student_message_function_mismatch")) {
    labels.add("response_function_mismatch");
  }
  if (v5Codes.includes("recommendation_exceeds_authorization")) {
    labels.add("wrong_response_mode");
    labels.add("authorized_progression_omitted");
  }
  if (input.v6IssueCodes.includes("revision_transfer_conflation")) {
    labels.add("revision_transfer_conflation");
  }
  if (input.v6IssueCodes.includes("transfer_task_presented_by_provider")) {
    labels.add("wrong_response_mode");
    labels.add("response_function_mismatch");
  }
  if (input.v6IssueCodes.includes("completion_overclaim")) {
    labels.add("completion_overclaim");
  }
  if (!input.v5Validation.valid && !input.v6LanguageValid &&
      input.caseId !== "e2a6_canary_transfer_authorized") {
    labels.add("candidate_validator_correct_rejection");
  }
  if (
    !input.v5Validation.valid && input.v6LanguageValid &&
    input.caseId === "e2a6_canary_transfer_authorized"
  ) {
    labels.add("candidate_validator_false_positive");
  }
  if (!input.providerActionAligned) labels.add("platform_gate_correct_rejection");
  if (input.attemptIndex === 2 && (
    input.caseId === "e2a6_canary_remain_repeated_confusion" ||
    input.caseId === "e2a6_canary_revision_authorized"
  )) labels.add("safe_fallback_used");
  if (
    input.caseId === "e2a6_canary_completion_authorized" &&
    input.attemptIndex === 2
  ) labels.add("reporting_aggregation_error");
  return [...labels];
}

export function buildE2A7ForensicAccounting() {
  const outputs = readJsonLines<V5ProviderOutputRecord>(
    path.join(E2A7_SOURCE_V5_RUN_DIR, "provider-outputs.jsonl")
  );
  const validations = readJsonLines<V5ValidationRecord>(
    path.join(E2A7_SOURCE_V5_RUN_DIR, "candidate-validation.jsonl")
  );
  const gates = readJsonLines<V5PlatformGateRecord>(
    path.join(E2A7_SOURCE_V5_RUN_DIR, "platform-gate-results.jsonl")
  );
  const rubrics = readJsonLines<V5RubricRecord>(
    path.join(E2A7_SOURCE_V5_RUN_DIR, "deterministic-rubric.jsonl")
  );
  const cases = e2a6DispatchCanaryCases();
  if (outputs.length !== 10 || validations.length !== 10 ||
      gates.length !== 5 || rubrics.length !== 5 || cases.length !== 5) {
    throw new Error("e2a7_v5_evidence_inventory_mismatch");
  }

  const outputRows = outputs.map((record) => {
    const testCase = cases.find((entry) => entry.case_id === record.case_id);
    const validation = validations.find((entry) =>
      entry.case_id === record.case_id &&
      entry.attempt_index === record.attempt_index
    );
    if (!testCase || !validation) {
      throw new Error(`e2a7_v5_output_mapping_missing:${record.case_id}`);
    }
    const mode = testCase.expected_authorized_action;
    const normalization = normalizeTopicDialogueProgressionAction({
      provider_action: record.parsed_validated_output.next_action,
      authorization: testCase.input.progression_authorization
    });
    const projected = projectHistoricalOutput(mode, record.parsed_validated_output);
    const replay = validateTopicDialogueModeOutput({
      selected_mode: mode,
      output: projected,
      latest_student_message: testCase.input.latest_student_message,
      latest_response_classification:
        testCase.input.latest_student_message_classification ??
          "server_classification_unavailable",
      distractor_anchor: `Item ${testCase.input.safe_item_context[0]?.item_number ?? 2} option ${testCase.input.safe_item_context[0]?.option_label ?? "A"}`,
      misconception_target: testCase.input.remaining_issue,
      strategies_already_attempted: testCase.prior_strategy_functions,
      platform_evidence_summary:
        testCase.input.progression_authorization.authorization_evidence_summary
    });
    const replayAccepted = replay.valid && normalization.authorization_aligned;
    return {
      case_id: record.case_id,
      intended_server_authorization: mode,
      provider_attempt_number: record.attempt_index,
      regeneration: record.regeneration,
      raw_structured_action: record.parsed_validated_output.next_action,
      normalized_action: normalization.normalized_requested_action,
      response_function: record.parsed_validated_output.response_function,
      safe_student_message_summary:
        safeOutputSummaries[`${record.case_id}:${record.attempt_index}`] ??
          "Synthetic student-facing output was retained only as a hashed historical record.",
      provider_schema_valid: validation.schema_valid,
      v5_candidate_validator_valid: validation.valid,
      v5_validator_rejection_reasons: validation.issues.map((issue) => ({
        field_path: issue.field_path,
        rule_code: issue.rule_code,
        safe_detail: issue.safe_detail
      })),
      provider_action_aligned: normalization.authorization_aligned,
      v6_selected_response_mode: mode,
      v6_projected_output_schema: TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS[mode],
      v6_language_contract_valid: replay.valid,
      v6_validator_rejection_reasons: replay.issues,
      v6_historical_replay_accepted: replayAccepted,
      v6_historical_replay_status: replayAccepted ? "recognized" : "rejected",
      adjudication_classification: classificationLabels({
        caseId: record.case_id,
        attemptIndex: record.attempt_index,
        v5Validation: validation,
        v6LanguageValid: replay.valid,
        providerActionAligned: normalization.authorization_aligned,
        v6IssueCodes: replay.issues.map((issue) => issue.rule_code)
      }),
      no_provider_dispatch_during_replay: true
    };
  });

  const caseRows = cases.map((testCase) => {
    const attempts = outputRows.filter((entry) =>
      entry.case_id === testCase.case_id
    );
    const validationsForCase = validations.filter((entry) =>
      entry.case_id === testCase.case_id
    );
    const finalAttempt = attempts.at(-1);
    const finalValidation = validationsForCase.at(-1);
    const gate = gates.find((entry) => entry.case_id === testCase.case_id);
    const rubric = rubrics.find((entry) => entry.case_id === testCase.case_id);
    if (!finalAttempt || !finalValidation || !gate || !rubric) {
      throw new Error(`e2a7_v5_case_mapping_missing:${testCase.case_id}`);
    }
    const acceptedReplayAttempt = attempts.find((entry) =>
      entry.v6_historical_replay_accepted
    );
    const fallbackUsed = !finalValidation.valid || gate.rejected === true;
    return {
      case_id: testCase.case_id,
      intended_server_authorization: testCase.expected_authorized_action,
      latest_student_message: testCase.input.latest_student_message,
      current_distractor_anchor:
        `Item ${testCase.input.safe_item_context[0]?.item_number ?? 2} option ${testCase.input.safe_item_context[0]?.option_label ?? "A"}`,
      current_misconception_target: testCase.input.remaining_issue,
      attempt_accounting: attempts.map((entry) => ({
        provider_attempt_number: entry.provider_attempt_number,
        raw_structured_action: entry.raw_structured_action,
        normalized_action: entry.normalized_action,
        response_function: entry.response_function,
        safe_student_message_summary: entry.safe_student_message_summary,
        candidate_validator_result: entry.v5_candidate_validator_valid,
        validator_rejection_reasons: entry.v5_validator_rejection_reasons,
        regeneration_requested: entry.provider_attempt_number === 1 &&
          validationsForCase.length > 1,
        regeneration_result: entry.provider_attempt_number === 2
          ? entry.v5_candidate_validator_valid ? "valid" : "still_invalid"
          : "not_applicable",
        platform_gate_decision: entry.provider_attempt_number === attempts.length
          ? gate.rejected ? "rejected" : "authorized"
          : "not_applied_regeneration_requested",
        platform_override_or_fallback: entry.provider_attempt_number === attempts.length
          ? gate.overridden ? "platform_override_and_safe_fallback"
            : fallbackUsed ? "safe_fallback" : "none"
          : "none",
        visible_message_ultimately_selected:
          entry.provider_attempt_number !== attempts.length
            ? "not_selected_regeneration_requested"
            : fallbackUsed
              ? "safe_fallback_projection"
              : "validated_provider_output_projection",
        ui_progression_availability: entry.provider_attempt_number === attempts.length
          ? gate.normalization?.progression_allowed ?? false
          : false,
        executed_state_transition: false,
        automated_case_result: rubric.status,
        adjudication_classification: entry.adjudication_classification
      })),
      provider_schema_valid: validationsForCase.every((entry) => entry.schema_valid),
      candidate_semantic_valid: finalValidation.valid,
      candidate_validation_failure_count: validationsForCase.filter((entry) =>
        !entry.valid
      ).length,
      regeneration_attempted: validationsForCase.length > 1,
      regeneration_succeeded: validationsForCase.length > 1 && finalValidation.valid,
      platform_authorization_action: testCase.expected_authorized_action,
      provider_requested_action: finalAttempt.normalized_action,
      provider_action_aligned: finalAttempt.provider_action_aligned,
      student_facing_language_aligned: finalAttempt.v6_language_contract_valid,
      platform_gate_authorized: gate.rejected === false,
      platform_override_applied: gate.overridden === true,
      safe_fallback_used: fallbackUsed,
      ui_progression_available: gate.normalization?.progression_allowed ?? false,
      executed_transition: false,
      automated_case_pass: rubric.status === "passed_automated",
      corrected_v6_replay_has_compatible_historical_output:
        acceptedReplayAttempt !== undefined,
      corrected_v6_replay_compatible_attempt:
        acceptedReplayAttempt?.provider_attempt_number ?? null,
      human_adjudication_required: true
    };
  });

  const countTrue = (field: keyof typeof caseRows[number]) =>
    caseRows.filter((row) => row[field] === true).length;
  const aggregate = {
    case_count: caseRows.length,
    provider_output_count: outputRows.length,
    provider_schema_valid_case_count: countTrue("provider_schema_valid"),
    candidate_semantic_valid_case_count: countTrue("candidate_semantic_valid"),
    candidate_validation_failure_count: caseRows.reduce((sum, row) =>
      sum + row.candidate_validation_failure_count, 0),
    regeneration_attempted_case_count: countTrue("regeneration_attempted"),
    regeneration_succeeded_case_count: countTrue("regeneration_succeeded"),
    provider_action_aligned_case_count: countTrue("provider_action_aligned"),
    student_facing_language_aligned_case_count:
      countTrue("student_facing_language_aligned"),
    platform_gate_authorized_case_count: countTrue("platform_gate_authorized"),
    platform_override_applied_case_count: countTrue("platform_override_applied"),
    safe_fallback_used_case_count: countTrue("safe_fallback_used"),
    ui_progression_available_case_count: countTrue("ui_progression_available"),
    executed_transition_case_count: countTrue("executed_transition"),
    automated_case_pass_count: countTrue("automated_case_pass"),
    automated_case_failure_count: caseRows.length - countTrue("automated_case_pass"),
    v6_replay_compatible_output_count: outputRows.filter((row) =>
      row.v6_historical_replay_accepted
    ).length,
    v6_replay_compatible_case_count: countTrue(
      "corrected_v6_replay_has_compatible_historical_output"
    )
  };
  return { caseRows, outputRows, aggregate };
}

function artifactPaths(runDir: string) {
  return {
    manifest: path.join(runDir, "adjudication-manifest.json"),
    caseAccounting: path.join(runDir, "v5-case-accounting.jsonl"),
    outputReclassification: path.join(runDir, "v5-output-reclassification.jsonl"),
    reportingSemantics: path.join(runDir, "reporting-semantics.json"),
    responseModeContract: path.join(runDir, "response-mode-contract.json"),
    schemaAudit: path.join(runDir, "mode-specific-schema-audit.json"),
    requestCompilation: path.join(runDir, "request-compilation.json"),
    fallbacks: path.join(runDir, "deterministic-fallbacks.json"),
    candidateDelta: path.join(runDir, "candidate-delta.json"),
    candidateDecision: path.join(runDir, "candidate-decision.json"),
    humanReview: path.join(runDir, "human-review-summary.json")
  };
}

function assertArtifactsContainNoProtectedMaterial(values: unknown[]) {
  const serialized = JSON.stringify(values);
  const forbidden = [
    /sk-[A-Za-z0-9_-]{12,}/u,
    /authorization:\s*bearer/iu,
    /cookie:/iu,
    /chain[- ]of[- ]thought/iu,
    /system_prompt/iu,
    /hidden_prompt[^_]/iu
  ];
  if (forbidden.some((pattern) => pattern.test(serialized))) {
    throw new Error("e2a7_artifact_protected_material_detected");
  }
}

export async function executeE2A7Adjudication(input: {
  artifactRoot?: string;
  runId?: string;
} = {}) {
  const root = input.artifactRoot ?? E2A7_ARTIFACT_ROOT;
  const runId = input.runId ??
    `e2a7_${new Date().toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14)}_${randomBytes(4).toString("hex")}`;
  const runDir = path.join(root, runId);
  mkdirSync(root, { recursive: true });
  mkdirSync(runDir, { recursive: false });
  const paths = artifactPaths(runDir);
  const protectedBefore = e2a7ProtectedArtifactSnapshot();
  const candidate = evaluateE2A7Candidate();
  const accounting = buildE2A7ForensicAccounting();
  const compilation = await compileE2A7CandidateRequestsNoNetwork(
    paths.requestCompilation
  );
  const schemaAudit = compilation.modeSchemaAudit;

  const reportingSemantics = {
    reporting_version: "e2a7-nonexclusive-result-accounting-v1",
    source_v5_status_preserved: "candidate_evaluation_failed",
    source_v5_automated_result_preserved: { passed: 1, failed: 4 },
    original_reporting_defect:
      "An else-if aggregate treated accepted, rejected, and overridden as mutually exclusive even though a gate can be both rejected and overridden.",
    corrected_independent_counts: accounting.aggregate,
    interpretation:
      "Historical V6 replay compatibility is deterministic design evidence only; it is not new provider evidence and does not change the failed V5 decision.",
    dimensions_are_nonexclusive: true
  };
  const responseModeContract = {
    contract_family_version: TOPIC_DIALOGUE_MODE_CONTRACT_FAMILY_VERSION,
    input_schema_version: TOPIC_DIALOGUE_MODE_INPUT_SCHEMA_VERSION,
    prompt_family_version: TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_VERSION,
    prompt_family_hash: TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_HASH,
    prompt_hashes: TOPIC_DIALOGUE_MODE_PROMPT_HASHES,
    output_schema_versions: TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS,
    validator_version: TOPIC_DIALOGUE_MODE_VALIDATOR_VERSION,
    server_envelope_version: TOPIC_DIALOGUE_MODE_SERVER_ENVELOPE_VERSION,
    provider_generates_progression_action: false,
    platform_selects_response_mode_before_request: true,
    platform_gate_remains_independent: true,
    modes: {
      remain_in_dialogue: {
        positive_function: "Directly answer or clarify, preserve the distractor anchor, and elicit the next evidence without progression claims."
      },
      request_revision: {
        positive_function: "Request one bounded revision tied to the accepted conceptual boundary."
      },
      present_transfer: {
        positive_function: "Transition to a new-context check that the platform presents."
      },
      complete_episode: {
        positive_function: "Acknowledge accepted evidence and close the bounded episode without a new task."
      }
    }
  };
  const fallbackArtifact = {
    fallback_version: TOPIC_DIALOGUE_MODE_FALLBACK_VERSION,
    fallback_metadata_student_visible: false,
    selected_mode_is_preserved: true,
    fallbacks: Object.fromEntries(([
      "remain_in_dialogue",
      "request_revision",
      "present_transfer",
      "complete_episode"
    ] as TopicDialogueResponseMode[]).map((mode) => [
      mode,
      buildTopicDialogueModeFallback({
        selected_mode: mode,
        distractor_anchor: "Item 2 option A",
        misconception_target:
          "Distinguish score consistency from evidence for an intended interpretation.",
        platform_evidence_summary: "Synthetic no-live evidence summary."
      })
    ]))
  };
  const candidateDelta = {
    candidate_file: path.relative(process.cwd(), E2A7_CANDIDATE_PATH),
    candidate_configuration_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    approved_v2_hash: candidate.approved_v2_hash,
    failed_v4_hash: candidate.failed_v4_hash,
    failed_v5_hash: candidate.failed_v5_hash,
    exact_delta_paths_from_approved_v2:
      candidate.exact_delta_paths_from_approved_v2,
    exact_delta_paths_from_failed_v5: candidate.exact_delta_paths_from_failed_v5,
    inherited_role_hashes: candidate.inherited_role_hashes,
    unrelated_role_configuration_changed: false
  };
  const candidateDecision = {
    decision_version: "e2a7-v6-candidate-decision-v1",
    candidate_status: "designed_no_live",
    approval_state: "not_approved",
    activation_state: "not_activated",
    provider_evaluation_required: true,
    human_review_required: true,
    fresh_provider_canary_required: true,
    blocker:
      "Mode-specific contracts have only deterministic replay and request-compilation evidence; fresh provider behavior and human review are still required.",
    source_v5_remains_failed: true
  };
  const humanReview = {
    review_version: "e2a7-human-review-summary-v1",
    review_status: "pending",
    human_review_required: true,
    human_review_completed: false,
    human_reviewer: null,
    approval_recommendation: "do_not_approve_without_fresh_provider_canary",
    provider_outputs_reviewed_in_e2a7: 0,
    no_human_review_fabricated: true
  };

  assertArtifactsContainNoProtectedMaterial([
    accounting,
    reportingSemantics,
    responseModeContract,
    schemaAudit,
    compilation.artifact,
    fallbackArtifact,
    candidateDelta,
    candidateDecision,
    humanReview
  ]);
  writeJsonLines(paths.caseAccounting, accounting.caseRows);
  writeJsonLines(paths.outputReclassification, accounting.outputRows);
  writeJson(paths.reportingSemantics, reportingSemantics);
  writeJson(paths.responseModeContract, responseModeContract);
  writeJson(paths.schemaAudit, schemaAudit);
  writeJson(paths.fallbacks, fallbackArtifact);
  writeJson(paths.candidateDelta, candidateDelta);
  writeJson(paths.candidateDecision, candidateDecision);
  writeJson(paths.humanReview, humanReview);

  const protectedAfter = e2a7ProtectedArtifactSnapshot();
  if (protectedBefore.aggregate_sha256 !== protectedAfter.aggregate_sha256) {
    throw new Error("e2a7_protected_artifact_hash_changed");
  }
  const manifest = {
    adjudication_version: E2A7_ADJUDICATION_VERSION,
    run_id: runId,
    generated_at: new Date().toISOString(),
    source_v5_run_id: E2A7_SOURCE_V5_RUN_ID,
    source_v5_status: "candidate_evaluation_failed",
    provider_generation_call_count: 0,
    llm_judge_call_count: 0,
    v5_canary_rerun: false,
    full_protocol_rerun: false,
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    candidate_approved: false,
    candidate_activated: false,
    case_count: accounting.caseRows.length,
    provider_output_replay_count: accounting.outputRows.length,
    accounting: accounting.aggregate,
    four_mode_schema_compilation_passed: schemaAudit.all_mode_schemas_compile,
    all_17_role_request_compilation_passed:
      compilation.artifact.all_17_roles_compile,
    protected_artifacts_before_sha256: protectedBefore.aggregate_sha256,
    protected_artifacts_after_sha256: protectedAfter.aggregate_sha256,
    protected_artifacts_unchanged: true,
    artifact_files: Object.values(paths).map((file) => path.basename(file))
  };
  writeJson(paths.manifest, manifest);
  return {
    runId,
    runDir,
    paths,
    manifest,
    accounting,
    candidate,
    protectedBefore,
    protectedAfter
  };
}

export function readE2A7Adjudication(runId: string) {
  const runDir = path.join(E2A7_ARTIFACT_ROOT, runId);
  return {
    runDir,
    manifest: readJson<Record<string, unknown>>(
      path.join(runDir, "adjudication-manifest.json")
    ),
    cases: readJsonLines<Record<string, unknown>>(
      path.join(runDir, "v5-case-accounting.jsonl")
    ),
    outputs: readJsonLines<Record<string, unknown>>(
      path.join(runDir, "v5-output-reclassification.jsonl")
    )
  };
}

export function latestE2A7RunId() {
  if (!existsSync(E2A7_ARTIFACT_ROOT)) return null;
  return readdirSync(E2A7_ARTIFACT_ROOT)
    .filter((entry) => entry.startsWith("e2a7_") &&
      existsSync(path.join(E2A7_ARTIFACT_ROOT, entry, "adjudication-manifest.json")))
    .sort()
    .at(-1) ?? null;
}

export function e2a7SourceEvidenceSha256() {
  return createHash("sha256")
    .update(JSON.stringify({
      v5_candidate: E2A6_CANDIDATE_FILE_SHA256,
      v5_evaluation: directoryDigest(E2A7_SOURCE_V5_RUN_DIR).sha256
    }))
    .digest("hex");
}
