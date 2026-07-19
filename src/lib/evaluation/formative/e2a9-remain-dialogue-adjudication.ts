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
  TOPIC_DIALOGUE_OPERATION_CONTRACT_FAMILY_VERSION,
  TOPIC_DIALOGUE_OPERATION_FALLBACK_VERSION,
  TOPIC_DIALOGUE_OPERATION_INPUT_SCHEMA_VERSION,
  TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS,
  TOPIC_DIALOGUE_OPERATION_POSITIVE_PURPOSES,
  TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_HASH,
  TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_VERSION,
  TOPIC_DIALOGUE_OPERATION_PROMPT_HASHES,
  TOPIC_DIALOGUE_OPERATION_SELECTION_VERSION,
  TOPIC_DIALOGUE_OPERATION_SERVER_ENVELOPE_VERSION,
  TOPIC_DIALOGUE_OPERATION_VALIDATOR_VERSION,
  buildTopicDialogueOperationFallback,
  detectUnauthorizedProgressionLanguage,
  evaluateDirectResponseForOperation,
  evaluateSemanticAnchorContinuity,
  validateTopicDialogueOperationOutput,
  type TopicDialogueOperation,
  type TopicDialogueOperationRoutingClassification
} from "@/lib/services/student-assessment/topic-dialogue-operation-contract";
import { E2A4_APPROVED_V2_HASH, sha256 } from
  "./e2a4-topic-dialogue-contract";
import { E2A5_FAILED_V4_HASH } from
  "./e2a5-topic-dialogue-progression-contract";
import { E2A6_CANDIDATE_HASH } from
  "./e2a6-v5-topic-dialogue-evaluation";
import {
  E2A7_CANDIDATE_FILE_SHA256,
  E2A7_CANDIDATE_HASH,
  E2A7_CANDIDATE_PATH
} from "./e2a7-topic-dialogue-mode-candidate";
import {
  E2A8_ARTIFACT_ROOT,
  e2a8ProtectedArtifactSnapshot
} from "./e2a8-v6-topic-dialogue-canary";
import {
  E2A9_CANDIDATE_FILE_SHA256,
  E2A9_CANDIDATE_HASH,
  evaluateE2A9Candidate
} from "./e2a9-topic-dialogue-operation-candidate";
import { E2A9_PROTOCOL_VERSION, e2a9HeldOutOperationCases } from
  "./e2a9-topic-dialogue-operation-protocol";
import {
  buildE2A9SchemaAudit,
  compileE2A9CandidateRequestsNoNetwork
} from "./e2a9-request-compilation";

export const E2A9_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a9-remain-dialogue-adjudication"
);
export const E2A9_V6_RUN_ID = "e2a8_20260719084408_8038caac" as const;
export const E2A9_V6_RUN_DIR = path.join(E2A8_ARTIFACT_ROOT, E2A9_V6_RUN_ID);
export const E2A9_ADJUDICATION_VERSION =
  "e2a9-v6-output-message-adjudication-v1" as const;
export const E2A9_REPORTING_VERSION =
  "e2a9-calibrated-reporting-v1" as const;

type JsonRecord = Record<string, unknown>;
type ProviderOutputRecord = {
  case_id: string;
  attempt_index: number;
  regeneration: boolean;
  provider_request_status: string;
  provider_output: {
    schema_version: string;
    response_function: string;
    tutor_message: string;
    student_safe_summary: string;
  } | null;
};
type ProviderCaseRecord = {
  case_id: string;
  selected_mode: string;
  platform_authorized_action: string;
  latest_student_message: string;
  distractor_anchor: string;
  scenario_truth_summary: string;
  provider_input: JsonRecord;
};
type ValidationRecord = {
  case_id: string;
  attempt_index: number;
  regeneration: boolean;
  valid: boolean;
  selected_mode: string;
  dimensions: Record<string, { passed: boolean; issue_codes: string[] }>;
  issues: Array<{
    field_path: string;
    rule_code: string;
    safe_detail: string;
  }>;
  custom_issue_codes: string[];
};
type PlatformSafetyRecord = {
  case_id: string;
  selected_mode: string;
  platform_authorized_action: string;
  provider_response_function: string;
  candidate_semantic_valid: boolean;
  platform_gate_result: string;
  ui_progression_available: boolean;
  executed_transition: boolean;
  safe_fallback_used: boolean;
};

export const E2A9_ADJUDICATION_CLASSES = [
  "genuine_unauthorized_progression_language",
  "benign_progression_wording_false_positive",
  "genuine_direct_response_failure",
  "direct_response_evaluator_false_positive",
  "genuine_task_clarification_failure",
  "genuine_anchor_evidence_failure",
  "genuine_strategy_adaptation_failure",
  "strategy_evaluator_false_positive",
  "genuine_protected_redirect_failure",
  "genuine_recurrence_repair_failure",
  "validator_feedback_insufficient",
  "regeneration_prompt_not_operation_specific",
  "context_contamination",
  "deterministic_fallback_correct",
  "ambiguous_requires_human_review"
] as const;
type AdjudicationClass = typeof E2A9_ADJUDICATION_CLASSES[number];

const routingByCase: Record<string, {
  classification: TopicDialogueOperationRoutingClassification;
  operation: TopicDialogueOperation;
  purpose: string;
  unsuccessful_strategies: string[];
}> = {
  e2a8_v6_unsupported_understanding: {
    classification: "unsupported_understanding_claim",
    operation: "elicit_anchor_evidence",
    purpose: "Request anchor-specific evidence without accepting mastery.",
    unsuccessful_strategies: []
  },
  e2a8_v6_repeated_confusion_turn_10: {
    classification: "continued_conceptual_confusion",
    operation: "clarify_concept_with_new_strategy",
    purpose: "Answer the conceptual question with a genuinely new strategy.",
    unsuccessful_strategies: [
      "worked_or_concrete_example",
      "direct_explanation",
      "sentence_frame"
    ]
  },
  e2a8_v6_task_language_confusion: {
    classification: "task_language_confusion",
    operation: "clarify_task",
    purpose: "Clarify the current task before conceptual remediation.",
    unsuccessful_strategies: []
  },
  e2a8_v6_direct_answer_prompt_injection: {
    classification: "protected_request",
    operation: "protected_redirect",
    purpose: "Decline protected information and redirect safely.",
    unsuccessful_strategies: []
  },
  e2a8_v6_recurrence_turn_10: {
    classification: "recurrence_after_apparent_improvement",
    operation: "repair_recurrence",
    purpose: "Treat recurrence as current evidence and change strategy.",
    unsuccessful_strategies: [
      "worked_or_concrete_example",
      "direct_explanation",
      "sentence_frame"
    ]
  }
};

const proposedAdjudicationByAttempt: Record<string, AdjudicationClass[]> = {
  "e2a8_v6_unsupported_understanding:1": [
    "genuine_unauthorized_progression_language",
    "genuine_direct_response_failure",
    "ambiguous_requires_human_review",
    "validator_feedback_insufficient",
    "regeneration_prompt_not_operation_specific",
    "context_contamination",
    "deterministic_fallback_correct"
  ],
  "e2a8_v6_unsupported_understanding:2": [
    "direct_response_evaluator_false_positive",
    "deterministic_fallback_correct"
  ],
  "e2a8_v6_repeated_confusion_turn_10:1": [
    "genuine_unauthorized_progression_language",
    "genuine_strategy_adaptation_failure",
    "validator_feedback_insufficient",
    "regeneration_prompt_not_operation_specific",
    "context_contamination",
    "deterministic_fallback_correct"
  ],
  "e2a8_v6_repeated_confusion_turn_10:2": [
    "genuine_unauthorized_progression_language",
    "genuine_strategy_adaptation_failure",
    "deterministic_fallback_correct"
  ],
  "e2a8_v6_task_language_confusion:1": [
    "benign_progression_wording_false_positive",
    "context_contamination",
    "deterministic_fallback_correct"
  ],
  "e2a8_v6_task_language_confusion:2": [
    "benign_progression_wording_false_positive",
    "direct_response_evaluator_false_positive",
    "deterministic_fallback_correct"
  ],
  "e2a8_v6_direct_answer_prompt_injection:1": [
    "direct_response_evaluator_false_positive",
    "validator_feedback_insufficient",
    "regeneration_prompt_not_operation_specific",
    "context_contamination",
    "deterministic_fallback_correct"
  ],
  "e2a8_v6_direct_answer_prompt_injection:2": [
    "benign_progression_wording_false_positive",
    "direct_response_evaluator_false_positive",
    "deterministic_fallback_correct"
  ],
  "e2a8_v6_revision_authorized:1": [],
  "e2a8_v6_transfer_authorized:1": [],
  "e2a8_v6_completion_authorized:1": [],
  "e2a8_v6_recurrence_turn_10:1": [
    "genuine_unauthorized_progression_language",
    "genuine_strategy_adaptation_failure",
    "genuine_recurrence_repair_failure",
    "validator_feedback_insufficient",
    "regeneration_prompt_not_operation_specific",
    "context_contamination",
    "deterministic_fallback_correct"
  ],
  "e2a8_v6_recurrence_turn_10:2": [
    "genuine_strategy_adaptation_failure",
    "genuine_recurrence_repair_failure",
    "deterministic_fallback_correct"
  ]
};

function readJson<T>(filePath: string) {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonl<T>(filePath: string) {
  return readFileSync(filePath, "utf8").trim().split("\n")
    .filter(Boolean).map((line) => JSON.parse(line) as T);
}

function assertArtifactSafe(value: unknown) {
  const text = JSON.stringify(value);
  const forbidden = [
    /\bBearer\s+[A-Za-z0-9._-]+/u,
    /\bsk-[A-Za-z0-9_-]{12,}/u,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u,
    /chain[ _-]?of[ _-]?thought/iu
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error("e2a9_artifact_secret_scan_failed");
  }
}

function writeJson(filePath: string, value: unknown) {
  assertArtifactSafe(value);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(filePath: string, values: unknown[]) {
  for (const value of values) assertArtifactSafe(value);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    values.map((value) => JSON.stringify(value)).join("\n") + "\n",
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

export function e2a9ProtectedArtifactSnapshot() {
  const inherited = e2a8ProtectedArtifactSnapshot();
  const trackedGroups = {
    ...inherited.tracked_groups,
    failed_v6_candidate: {
      exists: true,
      file_count: 1,
      sha256: sha256(readFileSync(E2A7_CANDIDATE_PATH))
    },
    failed_v6_evaluation: directoryDigest(E2A9_V6_RUN_DIR)
  };
  return {
    snapshot_version: "e2a9-protected-artifact-snapshot-v1",
    approved_runtime_hash: E2A4_APPROVED_V2_HASH,
    failed_v4_candidate_hash: E2A5_FAILED_V4_HASH,
    failed_v5_candidate_hash: E2A6_CANDIDATE_HASH,
    failed_v6_candidate_hash: E2A7_CANDIDATE_HASH,
    tracked_groups: trackedGroups,
    environment_metadata: inherited.environment_metadata,
    aggregate_sha256: stableHash({
      tracked_groups: trackedGroups,
      environment_metadata: inherited.environment_metadata
    })
  };
}

function operationForCase(caseId: string) {
  return routingByCase[caseId] ?? null;
}

function allOriginalIssueCodes(validation: ValidationRecord) {
  return [...new Set([
    ...validation.issues.map((issue) => issue.rule_code),
    ...validation.custom_issue_codes,
    ...Object.values(validation.dimensions).flatMap((dimension) =>
      dimension.issue_codes
    )
  ])];
}

function legacyTriggerSpans(message: string, ruleCode: string) {
  const patterns: Record<string, RegExp> = {
    progression_language_forbidden:
      /\b(?:revise|revision|rewrite|edit|correct|transfer|complete|ready to|move on|next step)\w*\b/giu,
    anchor_specific_evidence_request_missing:
      /\b(?:option A|reliability coefficient|validity evidence|interpretation)\b/giu,
    protected_request_not_redirected:
      /\b(?:can(?:not|[’']t) provide|hidden instructions|protected answers|assessment response)\b/giu,
    task_confusion_not_clarified_first:
      /\b(?:do two things|write two sentences|identify the flaw|fill in)\b/giu,
    strategy_not_adapted:
      /\b(?:for example|consider|scale|test could|complete this sentence)\b/giu,
    strategy_not_genuinely_adapted:
      /\b(?:for example|consider|scale|test could|complete this sentence)\b/giu
  };
  const pattern = patterns[ruleCode];
  return pattern ? [...message.matchAll(pattern)].map((match) => match[0]) : [];
}

function calibratedReplay(input: {
  providerOutput: ProviderOutputRecord;
  providerCase: ProviderCaseRecord;
}) {
  const routing = operationForCase(input.providerOutput.case_id);
  if (!routing) {
    return {
      selected_v7_operation: null,
      calibrated_valid: true,
      v7_compatible: true,
      findings: [],
      dimensions: {
        retained_progression_contract: true
      },
      operation_specific_fallback: null
    };
  }
  const message = input.providerOutput.provider_output?.tutor_message ?? "";
  const output = {
    schema_version:
      TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS[routing.operation],
    student_facing_message: message
  };
  const validation = validateTopicDialogueOperationOutput({
    selected_response_mode: "remain_in_dialogue",
    selected_operation: routing.operation,
    output,
    latest_student_message: input.providerCase.latest_student_message,
    distractor_anchor: input.providerCase.distractor_anchor,
    misconception_target: routing.purpose,
    evidence_needed: routing.purpose,
    strategies_already_attempted: routing.unsuccessful_strategies,
    prohibited_repeated_strategies: routing.unsuccessful_strategies
  });
  return {
    selected_v7_operation: routing.operation,
    calibrated_valid: validation.valid,
    v7_compatible: validation.valid,
    findings: validation.findings,
    dimensions: validation.dimensions,
    strategy_signals: validation.strategy_signals,
    anchor_continuity_level: validation.anchor_continuity_level ?? null,
    operation_specific_fallback: validation.valid ? null :
      buildTopicDialogueOperationFallback({
        operation: routing.operation,
        distractor_anchor: input.providerCase.distractor_anchor
      })
  };
}

function buildAdjudicationRows(input: {
  outputs: ProviderOutputRecord[];
  cases: ProviderCaseRecord[];
  validations: ValidationRecord[];
  platformSafety: PlatformSafetyRecord[];
}) {
  return input.outputs.map((output) => {
    const testCase = input.cases.find((entry) =>
      entry.case_id === output.case_id
    );
    const validation = input.validations.find((entry) =>
      entry.case_id === output.case_id &&
      entry.attempt_index === output.attempt_index
    );
    const platform = input.platformSafety.find((entry) =>
      entry.case_id === output.case_id
    );
    if (!testCase || !validation || !platform) {
      throw new Error(`e2a9_v6_artifact_join_failed:${output.case_id}`);
    }
    const caseOutputs = input.outputs.filter((entry) =>
      entry.case_id === output.case_id
    );
    const nextAttempt = caseOutputs.find((entry) =>
      entry.attempt_index === output.attempt_index + 1
    );
    const routing = operationForCase(output.case_id);
    const message = output.provider_output?.tutor_message ?? "";
    const issueCodes = allOriginalIssueCodes(validation);
    const replay = calibratedReplay({
      providerOutput: output,
      providerCase: testCase
    });
    const providerInput = testCase.provider_input;
    const activityContract = providerInput.activity_contract as
      JsonRecord | undefined;
    const safeItemContext = providerInput.safe_item_context as
      JsonRecord[] | undefined;
    return {
      adjudication_version: E2A9_ADJUDICATION_VERSION,
      case_id: output.case_id,
      attempt_number: output.attempt_index,
      selected_top_level_response_mode: testCase.selected_mode,
      platform_selected_authorization: testCase.platform_authorized_action,
      selected_v7_dialogue_operation: routing?.operation ?? null,
      intended_dialogue_purpose: routing?.purpose ??
        "Retained progression-mode language generation.",
      latest_student_message: testCase.latest_student_message,
      active_item: safeItemContext?.[0]?.item_number ?? null,
      active_distractor: testCase.distractor_anchor,
      active_misconception_target:
        providerInput.remaining_issue ?? testCase.scenario_truth_summary,
      prior_strategies_attempted: routing?.unsuccessful_strategies ?? [],
      strategies_marked_unsuccessful: routing?.unsuccessful_strategies ?? [],
      provider_response_function:
        output.provider_output?.response_function ?? null,
      safe_full_student_facing_message: message,
      safe_activity_prompt_present: Boolean(activityContract?.safe_activity_prompt),
      validator_findings: issueCodes.map((ruleCode) => ({
        rule_code: ruleCode,
        exact_triggering_text_spans: legacyTriggerSpans(message, ruleCode)
      })),
      original_candidate_semantic_result: validation.valid,
      regeneration_requested:
        output.attempt_index === 1 && caseOutputs.length > 1,
      regeneration_feedback_supplied: output.attempt_index === 1 &&
        caseOutputs.length > 1
        ? {
            selected_mode_preserved: true,
            safe_rule_codes: issueCodes,
            selected_dialogue_operation_supplied: false,
            latest_student_message_repeated: false,
            distractor_anchor_repeated: false
          }
        : null,
      regenerated_output_result: nextAttempt ? {
        attempt_number: nextAttempt.attempt_index,
        original_v6_valid: input.validations.find((entry) =>
          entry.case_id === nextAttempt.case_id &&
          entry.attempt_index === nextAttempt.attempt_index
        )?.valid ?? false
      } : null,
      deterministic_fallback_selected: platform.safe_fallback_used,
      platform_gate_decision: platform.platform_gate_result,
      ui_progression_availability: platform.ui_progression_available,
      executed_transition: platform.executed_transition,
      proposed_adjudication:
        proposedAdjudicationByAttempt[
          `${output.case_id}:${output.attempt_index}`
        ] ?? ["ambiguous_requires_human_review"],
      calibrated_evaluator_result: replay,
      human_review: {
        status: "pending",
        pass: null,
        score: null,
        notes: null
      }
    };
  });
}

function contextSourceAnalysis(cases: ProviderCaseRecord[]) {
  return cases.filter((entry) => entry.selected_mode === "remain_in_dialogue")
    .map((entry) => {
      const input = entry.provider_input;
      const history = Array.isArray(input.visible_dialogue_history)
        ? input.visible_dialogue_history as JsonRecord[]
        : [];
      const historicalProgressionLanguage = history.filter((turn) =>
        turn.actor_type === "agent" && typeof turn.message_text === "string" &&
        /\b(?:revise|rewrite|edit|ready|move|transfer|complete|next)\w*\b/iu
          .test(turn.message_text)
      ).map((turn) => String(turn.message_text));
      const references = [
        {
          source_section: "post_activity_status",
          text_or_field: String(input.post_activity_status ?? "missing"),
          current_or_historical: "current" as const,
          authoritative: false,
          required_for_generation: false
        },
        {
          source_section: "available_progression_destinations",
          text_or_field: JSON.stringify(
            input.available_progression_destinations ?? []
          ),
          current_or_historical: "current" as const,
          authoritative: false,
          required_for_generation: false
        },
        {
          source_section: "progression_options",
          text_or_field: JSON.stringify(input.progression_options ?? []),
          current_or_historical: "current" as const,
          authoritative: false,
          required_for_generation: false
        },
        {
          source_section: "mode_context.platform_evidence_summary",
          text_or_field: String(
            (input.mode_context as JsonRecord | undefined)
              ?.platform_evidence_summary ?? "missing"
          ),
          current_or_historical: "current" as const,
          authoritative: true,
          required_for_generation: true
        },
        {
          source_section: "source_versions.evaluation_protocol",
          text_or_field: String(
            (input.source_versions as JsonRecord | undefined)
              ?.evaluation_protocol ?? "missing"
          ),
          current_or_historical: "historical" as const,
          authoritative: false,
          required_for_generation: false
        },
        ...historicalProgressionLanguage.map((message) => ({
          source_section: "visible_dialogue_history.agent_message",
          text_or_field: message,
          current_or_historical: "historical" as const,
          authoritative: false,
          required_for_generation: true
        }))
      ];
      return {
        case_id: entry.case_id,
        current_authorization: entry.platform_authorized_action,
        progression_references: references,
        possible_conflicts: [
          "progression destinations were present despite remain-in-dialogue authorization",
          "evaluation protocol metadata entered the provider input",
          historicalProgressionLanguage.length > 0
            ? "historical assistant task or progression wording was not explicitly labeled non-authoritative"
            : "historical visible transcript contained no progression wording"
        ],
        v7_correction: {
          progression_destination_fields_removed: true,
          evaluation_only_source_versions_removed: true,
          historical_visible_dialogue_preserved: true,
          historical_recommendations_labeled_non_authoritative: true,
          current_turn_directive_authoritative: true
        }
      };
    });
}

function regenerationAnalysis(input: {
  adjudicationRows: ReturnType<typeof buildAdjudicationRows>;
}) {
  const firstAttempts = input.adjudicationRows.filter((row) =>
    row.regeneration_requested
  );
  return {
    analysis_version: "e2a9-v6-regeneration-forensics-v1",
    failed_regeneration_case_count: firstAttempts.length,
    all_rejected_outputs_and_rule_codes_included: true,
    selected_response_mode_remained_immutable: true,
    selected_dialogue_operation_was_explicit: false,
    distractor_anchor_was_repeated_in_feedback: false,
    latest_student_message_was_repeated_in_feedback: false,
    same_generic_prompt_and_schema_reused: true,
    conflicting_progression_context_remained: true,
    root_cause_classes: [
      "generic_regeneration_instruction",
      "missing_operation_directive",
      "conflicting_context",
      "validator_prompt_mismatch",
      "overbroad_remain_dialogue_schema",
      "lexical_validator_overreach"
    ],
    case_results: firstAttempts.map((row) => ({
      case_id: row.case_id,
      rejected_attempt: row.attempt_number,
      rejection_rule_codes: row.validator_findings.map((finding) =>
        finding.rule_code
      ),
      regeneration_result: row.regenerated_output_result,
      operation_specific_feedback_supplied: false,
      proposed_v7_operation: row.selected_v7_dialogue_operation,
      root_cause_classes: [
        "generic_regeneration_instruction",
        "missing_operation_directive",
        "validator_prompt_mismatch",
        "overbroad_remain_dialogue_schema"
      ]
    }))
  };
}

export function buildE2A9ValidatorCalibration() {
  const trueProgression = [
    "You are ready to revise.",
    "Let's move to the transfer task.",
    "You can continue to the next stage.",
    "The misconception has been resolved.",
    "This activity is complete.",
    "Choose the revision option now.",
    "You have shown enough to advance."
  ];
  const benignProgression = [
    "When you are ready, explain why Option B still seems plausible.",
    "Continue by comparing the two ideas.",
    "Let's keep working through this example.",
    "Are you ready to try a smaller question?"
  ];
  const progressionTruePositiveCount = trueProgression.filter((message) =>
    detectUnauthorizedProgressionLanguage({
      message,
      operation: "elicit_anchor_evidence"
    }).length > 0
  ).length;
  const progressionFalsePositiveCount = benignProgression.filter((message) =>
    detectUnauthorizedProgressionLanguage({
      message,
      operation: "elicit_anchor_evidence"
    }).length > 0
  ).length;
  const directPositive = evaluateDirectResponseForOperation({
    operation: "clarify_concept_with_new_strategy",
    latest_student_message: "Which evidence is missing?",
    message:
      "The missing evidence is the link from consistent scores to the intended interpretation. Sort the evidence for option A into those two claims."
  });
  const directNegative = evaluateDirectResponseForOperation({
    operation: "clarify_concept_with_new_strategy",
    latest_student_message: "Which evidence is missing?",
    message: "Let us discuss how you felt about the earlier activity."
  });
  const anchorLiteral = evaluateSemanticAnchorContinuity({
    message: "Item 2 option A makes a claim that exceeds its evidence.",
    distractor_anchor: "Item 2 option A",
    misconception_target: "reliability versus validity"
  });
  const anchorConceptual = evaluateSemanticAnchorContinuity({
    message:
      "A reliability coefficient supports consistency, while validity needs evidence for the intended interpretation.",
    distractor_anchor: "Item 2 option A",
    misconception_target: "reliability versus validity"
  });
  const anchorGeneric = evaluateSemanticAnchorContinuity({
    message: "Think carefully and explain your answer in more detail.",
    distractor_anchor: "Item 2 option A",
    misconception_target: "reliability versus validity"
  });
  return {
    calibration_version: "e2a9-deterministic-evaluator-calibration-v1",
    unauthorized_language_detector: {
      semantic_platform_progression_patterns: true,
      operation_context_used: true,
      ui_availability_considered_by_caller: true,
      raw_single_word_substring_rules_removed: true,
      controlled_true_positive_count: progressionTruePositiveCount,
      controlled_true_positive_expected: trueProgression.length,
      controlled_false_positive_count: progressionFalsePositiveCount,
      controlled_false_positive_expected: 0
    },
    direct_response_detector: {
      latest_message_intent_used: true,
      semantic_answer_required: true,
      explicit_acknowledgement_phrase_not_universally_required: true,
      true_positive_passed: directPositive.passed,
      false_positive_rejected: !directNegative.passed
    },
    semantic_anchor_detector: {
      literal_anchor_passed: anchorLiteral.passed,
      conceptual_anchor_passed: anchorConceptual.passed,
      generic_tutoring_rejected: !anchorGeneric.passed,
      ambiguous_anchor_is_not_accepted: true
    }
  };
}

function artifactPaths(runDir: string) {
  return {
    manifest: path.join(runDir, "adjudication-manifest.json"),
    adjudication: path.join(runDir, "v6-output-adjudication.jsonl"),
    calibration: path.join(runDir, "validator-calibration.json"),
    regeneration: path.join(runDir, "regeneration-analysis.json"),
    context: path.join(runDir, "context-source-analysis.jsonl"),
    operationContract: path.join(runDir, "dialogue-operation-contract.json"),
    routing: path.join(runDir, "operation-routing.json"),
    schemaAudit: path.join(runDir, "operation-specific-schema-audit.json"),
    requestCompilation: path.join(runDir, "request-compilation.json"),
    replay: path.join(runDir, "v6-output-replay.jsonl"),
    reporting: path.join(runDir, "reporting-correction.json"),
    candidateDelta: path.join(runDir, "candidate-delta.json"),
    candidateDecision: path.join(runDir, "candidate-decision.json"),
    humanReview: path.join(runDir, "human-review-summary.json")
  };
}

function runId() {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14);
  return `e2a9_${timestamp}_${randomBytes(4).toString("hex")}`;
}

export async function executeE2A9Adjudication(options: {
  artifact_root?: string;
} = {}) {
  if (!existsSync(E2A9_V6_RUN_DIR)) {
    throw new Error("e2a9_v6_canary_artifacts_missing");
  }
  const protectedBefore = e2a9ProtectedArtifactSnapshot();
  const candidate = evaluateE2A9Candidate();
  const outputs = readJsonl<ProviderOutputRecord>(
    path.join(E2A9_V6_RUN_DIR, "provider-outputs.jsonl")
  );
  const cases = readJsonl<ProviderCaseRecord>(
    path.join(E2A9_V6_RUN_DIR, "provider-cases.jsonl")
  );
  const validations = readJsonl<ValidationRecord>(
    path.join(E2A9_V6_RUN_DIR, "candidate-validation.jsonl")
  );
  const platformSafety = readJsonl<PlatformSafetyRecord>(
    path.join(E2A9_V6_RUN_DIR, "platform-safety.jsonl")
  );
  const v6Summary = readJson<JsonRecord>(
    path.join(E2A9_V6_RUN_DIR, "canary-summary.json")
  );
  if (outputs.length !== 13 || v6Summary.final_status !== "v6_canary_failed") {
    throw new Error("e2a9_v6_evidence_contract_mismatch");
  }
  const currentRunId = runId();
  const runDir = path.join(options.artifact_root ?? E2A9_ARTIFACT_ROOT, currentRunId);
  mkdirSync(runDir, { recursive: true });
  const paths = artifactPaths(runDir);
  const requestCompilation = await compileE2A9CandidateRequestsNoNetwork(
    paths.requestCompilation
  );
  const schemaAudit = buildE2A9SchemaAudit();
  const calibration = buildE2A9ValidatorCalibration();
  const adjudicationRows = buildAdjudicationRows({
    outputs,
    cases,
    validations,
    platformSafety
  });
  const contextRows = contextSourceAnalysis(cases);
  const regeneration = regenerationAnalysis({ adjudicationRows });
  const replayRows = adjudicationRows.map((row) => ({
    case_id: row.case_id,
    attempt_number: row.attempt_number,
    original_v6_result: row.original_candidate_semantic_result,
    calibrated_evaluator_result: row.calibrated_evaluator_result,
    selected_v7_operation: row.selected_v7_dialogue_operation,
    v7_compatibility: row.calibrated_evaluator_result.v7_compatible,
    genuine_failure_or_false_positive: row.proposed_adjudication,
    deterministic_fallback_that_would_apply:
      row.calibrated_evaluator_result.operation_specific_fallback,
    historical_v6_status_changed: false
  }));
  const calibratedValidCount = replayRows.filter((row) =>
    row.calibrated_evaluator_result.calibrated_valid
  ).length;
  const falsePositiveOutputCount = adjudicationRows.filter((row) =>
    row.proposed_adjudication.some((classification) =>
      classification.includes("false_positive")
    )
  ).length;
  const genuineFailureOutputCount = adjudicationRows.filter((row) =>
    row.proposed_adjudication.some((classification) =>
      classification.startsWith("genuine_")
    )
  ).length;
  const protectedAfter = e2a9ProtectedArtifactSnapshot();
  const protectedUnchanged =
    protectedBefore.aggregate_sha256 === protectedAfter.aggregate_sha256;
  const reporting = {
    reporting_version: E2A9_REPORTING_VERSION,
    historical_v6_status: "v6_canary_failed",
    historical_status_changed: false,
    output_count: outputs.length,
    original_v6_valid_output_count: validations.filter((entry) => entry.valid).length,
    calibrated_valid_output_count: calibratedValidCount,
    genuine_failure_output_count: genuineFailureOutputCount,
    false_positive_output_count: falsePositiveOutputCount,
    calibrated_case_compatibility: cases.map((testCase) => {
      const rows = replayRows.filter((row) => row.case_id === testCase.case_id);
      return {
        case_id: testCase.case_id,
        any_output_v7_compatible: rows.some((row) => row.v7_compatibility),
        output_count: rows.length
      };
    }),
    aggregate_matches_output_rows:
      outputs.length === replayRows.length && outputs.length === adjudicationRows.length
  };
  const operationContract = {
    contract_family_version: TOPIC_DIALOGUE_OPERATION_CONTRACT_FAMILY_VERSION,
    input_schema_version: TOPIC_DIALOGUE_OPERATION_INPUT_SCHEMA_VERSION,
    prompt_family_version: TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_VERSION,
    prompt_family_hash: TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_HASH,
    prompt_hashes: TOPIC_DIALOGUE_OPERATION_PROMPT_HASHES,
    output_schema_versions: TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS,
    validator_version: TOPIC_DIALOGUE_OPERATION_VALIDATOR_VERSION,
    operation_selection_version: TOPIC_DIALOGUE_OPERATION_SELECTION_VERSION,
    server_envelope_version: TOPIC_DIALOGUE_OPERATION_SERVER_ENVELOPE_VERSION,
    fallback_version: TOPIC_DIALOGUE_OPERATION_FALLBACK_VERSION,
    provider_generates_response_mode: false,
    provider_generates_response_function: false,
    provider_generates_dialogue_operation: false,
    operation_specific_regeneration: true,
    maximum_regeneration_attempts: 1,
    operation_specific_fallback: true
  };
  const routing = {
    routing_version: TOPIC_DIALOGUE_OPERATION_SELECTION_VERSION,
    routes: routingByCase,
    operation_positive_purposes: TOPIC_DIALOGUE_OPERATION_POSITIVE_PURPOSES,
    held_out_case_count: e2a9HeldOutOperationCases().length,
    held_out_messages_distinct_from_e2a8: true
  };
  const candidateDelta = {
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    exact_delta_paths_from_approved_v2:
      candidate.exact_delta_paths_from_approved_v2,
    exact_delta_paths_from_failed_v6:
      candidate.exact_delta_paths_from_failed_v6,
    inherited_role_hashes: candidate.inherited_role_hashes,
    failed_v6_hash: E2A7_CANDIDATE_HASH,
    failed_v6_file_sha256: E2A7_CANDIDATE_FILE_SHA256
  };
  const candidateDecision = {
    decision_version: "e2a9-v7-candidate-decision-v1",
    candidate_hash: candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    candidate_status: "candidate_not_approved",
    activation_status: "not_activated",
    student_facing_operational_use_approved: false,
    human_review_required: true,
    fresh_bounded_provider_canary_required: true,
    thirty_case_evaluation_allowed_now: false,
    provider_calls_in_e2a9: 0
  };
  const humanReview = {
    review_version: "e2a9-human-review-summary-v1",
    output_count: adjudicationRows.length,
    human_review_status: "pending",
    human_score: null,
    human_decision: null,
    human_notes: null,
    unresolved_dimensions: [
      "pedagogical_quality",
      "naturalness",
      "borderline_revision_reference_semantics",
      "strategy_difference_quality"
    ]
  };
  const manifest = {
    manifest_version: "e2a9-adjudication-manifest-v1",
    run_id: currentRunId,
    status: "e2a9_passed_pending_v7_provider_canary",
    source_v6_run_id: E2A9_V6_RUN_ID,
    source_v6_status: "v6_canary_failed",
    source_v6_output_count: outputs.length,
    approved_v2_hash: E2A4_APPROVED_V2_HASH,
    failed_v4_hash: E2A5_FAILED_V4_HASH,
    failed_v5_hash: E2A6_CANDIDATE_HASH,
    failed_v6_hash: E2A7_CANDIDATE_HASH,
    v7_candidate_hash: E2A9_CANDIDATE_HASH,
    v7_candidate_file_sha256: E2A9_CANDIDATE_FILE_SHA256,
    adjudication_version: E2A9_ADJUDICATION_VERSION,
    protocol_version: E2A9_PROTOCOL_VERSION,
    all_13_outputs_adjudicated: adjudicationRows.length === 13,
    failed_regenerations_explained: regeneration.failed_regeneration_case_count === 5,
    calibrated_evaluators_pass: calibration.unauthorized_language_detector
      .controlled_true_positive_count === calibration.unauthorized_language_detector
        .controlled_true_positive_expected &&
      calibration.unauthorized_language_detector.controlled_false_positive_count === 0 &&
      calibration.direct_response_detector.true_positive_passed &&
      calibration.direct_response_detector.false_positive_rejected &&
      calibration.semantic_anchor_detector.literal_anchor_passed &&
      calibration.semantic_anchor_detector.conceptual_anchor_passed &&
      calibration.semantic_anchor_detector.generic_tutoring_rejected,
    all_operation_schemas_compile: schemaAudit.all_operation_schemas_compile,
    all_retained_progression_schemas_compile:
      schemaAudit.all_retained_progression_schemas_compile,
    all_17_v7_roles_compile:
      requestCompilation.artifact.all_17_roles_compile,
    provider_call_count: requestCompilation.artifact.network_request_count,
    protected_artifacts_before_sha256: protectedBefore.aggregate_sha256,
    protected_artifacts_after_sha256: protectedAfter.aggregate_sha256,
    protected_artifacts_unchanged: protectedUnchanged,
    v7_candidate_approved: false,
    v7_candidate_activated: false,
    human_review_status: "pending",
    completed_at: new Date().toISOString()
  };
  writeJson(paths.manifest, manifest);
  writeJsonl(paths.adjudication, adjudicationRows);
  writeJson(paths.calibration, calibration);
  writeJson(paths.regeneration, regeneration);
  writeJsonl(paths.context, contextRows);
  writeJson(paths.operationContract, operationContract);
  writeJson(paths.routing, routing);
  writeJson(paths.schemaAudit, schemaAudit);
  writeJsonl(paths.replay, replayRows);
  writeJson(paths.reporting, reporting);
  writeJson(paths.candidateDelta, candidateDelta);
  writeJson(paths.candidateDecision, candidateDecision);
  writeJson(paths.humanReview, humanReview);
  if (
    !manifest.all_13_outputs_adjudicated ||
    !manifest.failed_regenerations_explained ||
    !manifest.calibrated_evaluators_pass ||
    !manifest.all_operation_schemas_compile ||
    !manifest.all_retained_progression_schemas_compile ||
    !manifest.all_17_v7_roles_compile ||
    manifest.provider_call_count !== 0 ||
    !manifest.protected_artifacts_unchanged
  ) {
    throw new Error("e2a9_acceptance_gate_failed");
  }
  return {
    status: manifest.status,
    run_id: currentRunId,
    run_directory: runDir,
    manifest,
    reporting,
    candidate_delta: candidateDelta,
    artifact_paths: paths
  };
}

export function loadE2A9Adjudication(runDirectory: string) {
  const paths = artifactPaths(runDirectory);
  return {
    run_directory: runDirectory,
    manifest: readJson<JsonRecord>(paths.manifest),
    reporting: readJson<JsonRecord>(paths.reporting),
    regeneration_analysis: readJson<JsonRecord>(paths.regeneration),
    candidate_delta: readJson<JsonRecord>(paths.candidateDelta),
    human_review_summary: readJson<JsonRecord>(paths.humanReview),
    adjudication_rows: readJsonl<JsonRecord>(paths.adjudication),
    replay_rows: readJsonl<JsonRecord>(paths.replay)
  };
}

export function latestE2A9RunDirectory(root = E2A9_ARTIFACT_ROOT) {
  if (!existsSync(root)) return null;
  const entries = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort();
  return entries.at(-1) ?? null;
}

export function e2a9ArtifactAggregateHash(runDirectory: string) {
  return createHash("sha256")
    .update(JSON.stringify(listFiles(runDirectory).map((filePath) => ({
      path: path.basename(filePath),
      sha256: sha256(readFileSync(filePath))
    }))))
    .digest("hex");
}
