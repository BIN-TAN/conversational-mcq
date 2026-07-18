import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import {
  applyTopicDialogueReadinessGate,
  classifyTopicDialogueStudentMessage,
  evaluateTopicDialogueReadinessGate
} from "@/lib/services/student-assessment/topic-dialogue-agent";
import {
  topicDialogueOutputV3ToRuntimeV2,
  type TopicDialogueOutputV3
} from "@/lib/services/student-assessment/topic-dialogue-output-v3";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  e2a3TopicDialogueCases,
  type E2A3TopicDialogueCase
} from "./e2a3-topic-dialogue-protocol";
import {
  E2A4_TOPIC_DIALOGUE_CANDIDATE_PATH,
  sha256
} from "./e2a4-topic-dialogue-contract";
import { e2a4ProtectedArtifactSnapshot } from "./e2a4-topic-dialogue-evaluation";
import {
  E2A5_CANDIDATE_PATH,
  E2A5_FAILED_V4_HASH,
  buildE2A5ProgressionAuthorization,
  evaluateE2A5Candidate,
  parseTopicDialogueOutputV3,
  topicDialogueInputV3ToReadinessGateV2,
  toTopicDialogueInputV4,
  validateTopicDialogueOutputForE2A5
} from "./e2a5-topic-dialogue-progression-contract";

export const E2A5_ADJUDICATION_VERSION =
  "e2a5-progression-adjudication-v1" as const;
export const E2A5_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a5-progression-adjudication"
);
export const E2A4_FAILED_RUN_ID = "e2a4_20260718090055_abb9ff54";
export const E2A4_FAILED_RUN_DIR = path.join(
  process.cwd(),
  ".data",
  "e2a4-topic-dialogue-candidate-evaluation",
  E2A4_FAILED_RUN_ID
);

type V4ProviderOutputRecord = {
  case_id: string;
  provider_request_status: string;
  network_dispatch_count: number;
  parsed_validated_output: TopicDialogueOutputV3;
};

type V4RubricRecord = {
  case_id: string;
  status: string;
  critical_findings: string[];
  major_findings: string[];
  dimensions: Array<{
    dimension: string;
    status: string;
    evidence: string;
  }>;
};

function readJsonLines<T>(filePath: string): T[] {
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonLines(filePath: string, values: unknown[]) {
  writeFileSync(
    filePath,
    values.map((value) => JSON.stringify(value)).join("\n") + "\n",
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

export function e2a5ProtectedArtifactSnapshot() {
  const base = e2a4ProtectedArtifactSnapshot();
  const failedV4CandidateSha = sha256(readFileSync(E2A4_TOPIC_DIALOGUE_CANDIDATE_PATH));
  const failedV4Evaluation = directoryDigest(E2A4_FAILED_RUN_DIR);
  const protectedGroups = {
    ...base.tracked_groups,
    failed_v4_candidate: {
      exists: true,
      file_count: 1,
      sha256: failedV4CandidateSha
    },
    failed_v4_evaluation: failedV4Evaluation
  };
  return {
    snapshot_version: "e2a5-protected-artifact-snapshot-v1",
    approved_runtime_hash: base.tracked_groups.approved_v2_candidate.exists
      ? "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993"
      : null,
    failed_v4_candidate_hash: E2A5_FAILED_V4_HASH,
    tracked_groups: protectedGroups,
    environment_metadata: base.environment_metadata,
    aggregate_sha256: stableHash({
      protected_groups: protectedGroups,
      environment_metadata: base.environment_metadata
    })
  };
}

function progressionRecommendation(output: TopicDialogueOutputV3) {
  if (output.next_action === "show_progression_choices") return "revision_or_progression_choices";
  if (output.next_action === "continue_to_transfer") return "transfer";
  if (output.next_action === "continue_to_next_topic") return "move_on";
  if (output.next_action === "end_assessment") return "completion";
  if (output.next_action === "show_final_support_options") return "final_support_options";
  return "remain_in_dialogue";
}

function currentProfileStatus(caseRecord: E2A3TopicDialogueCase) {
  return {
    learning_profile_status: "not_supplied_in_synthetic_provider_protocol",
    engagement_profile_status: "not_supplied_in_synthetic_provider_protocol",
    source_profile_version: caseRecord.input.source_profile_version
  };
}

function originalRubricFinding(
  rubric: V4RubricRecord,
  dimension: string
) {
  return rubric.dimensions.find((entry) => entry.dimension === dimension) ?? null;
}

function adjudicateCase(input: {
  testCase: E2A3TopicDialogueCase;
  provider: V4ProviderOutputRecord;
  rubric: V4RubricRecord;
}) {
  const output = parseTopicDialogueOutputV3(input.provider.parsed_validated_output);
  const authorization = buildE2A5ProgressionAuthorization({
    dialogue_input: input.testCase.input,
    requested_authorized_action: "request_revision"
  });
  const v5Input = toTopicDialogueInputV4({
    dialogue_input: input.testCase.input,
    requested_authorized_action: "request_revision"
  });
  const runtimeInput = topicDialogueInputV3ToReadinessGateV2(input.testCase.input);
  const gate = evaluateTopicDialogueReadinessGate(runtimeInput);
  const existingGateApplication = applyTopicDialogueReadinessGate({
    dialogue_input: runtimeInput,
    candidate_output: topicDialogueOutputV3ToRuntimeV2(output)
  });
  const v5Validation = validateTopicDialogueOutputForE2A5({
    output,
    dialogue_input: v5Input
  });
  const latestClassification = classifyTopicDialogueStudentMessage(
    input.testCase.input.latest_student_message
  );
  const directResponseFalsePositive =
    input.testCase.case_id === "e2a3_repeated_conceptual_confusion_01" &&
    output.student_message_function === "conceptual_question" &&
    output.response_function === "answer_student_question";
  const studentProgressionIssues = v5Validation.issues.filter(
    (issue) => issue.taxonomy_level === "student_facing_progression_offer"
  );
  const classifications = ["model_structured_recommendation_only"];
  if (studentProgressionIssues.length) classifications.push("student_facing_progression_language");
  if (existingGateApplication.overridden) {
    classifications.push("platform_readiness_gate_rejected_recommendation");
  }
  if (!existingGateApplication.overridden && output.next_action === "show_final_support_options") {
    classifications.push("platform_readiness_gate_failed");
  }
  if (directResponseFalsePositive) classifications.push("deterministic_evaluator_false_positive");
  if (studentProgressionIssues.length) classifications.push("ambiguous_requires_human_adjudication");

  const taxonomy = {
    internal_recommendation: {
      present: output.next_action !== "await_topic_dialogue_response",
      recommendation: progressionRecommendation(output),
      authorized_action: authorization.authorized_action,
      passed: authorization.authorized_action !== "remain_in_dialogue" ||
        output.next_action === "await_topic_dialogue_response"
    },
    student_facing_progression_offer: {
      present: studentProgressionIssues.length > 0,
      safe_pattern_labels: studentProgressionIssues.map((issue) => issue.safe_detail),
      passed: studentProgressionIssues.length === 0
    },
    platform_authorization: {
      evaluated_in_live_harness: false,
      controlled_gate_ready: gate.ready,
      controlled_gate_reason: gate.reason_code,
      controlled_existing_gate_overrode_candidate: existingGateApplication.overridden,
      authorized_action: authorization.authorized_action
    },
    ui_progression_availability: {
      evaluated_in_live_harness: false,
      revision_presented: false,
      transfer_presented: false
    },
    executed_transition: {
      evaluated_in_live_harness: false,
      occurred: false
    },
    terminal_completion: {
      evaluated_in_live_harness: false,
      occurred: false
    }
  };

  return {
    case_id: input.testCase.case_id,
    scenario: input.testCase.description,
    student_turn_count: input.testCase.student_turn_count,
    latest_student_message: input.testCase.input.latest_student_message,
    active_focus_item: 2,
    active_focus_distractor: {
      option_label: "A",
      student_safe_text: input.testCase.input.safe_item_context[0]?.option_text ?? null
    },
    active_misconception_target: input.testCase.input.frozen_growth_target,
    ...currentProfileStatus(input.testCase),
    current_formative_plan_action:
      input.testCase.input.activity_contract.expected_student_action_prompt,
    current_readiness_gate_inputs: {
      post_activity_status: input.testCase.input.post_activity_status,
      latest_student_message_classification: latestClassification.student_message_function,
      substantive_evidence_present: gate.substantive_evidence_present,
      distractor_specific_evidence_present: gate.distractor_specific_evidence_present,
      unsupported_understanding_claim: gate.unsupported_understanding_claim,
      continued_confusion_present: gate.continued_confusion_present,
      evaluator_status_supports_progression: gate.evaluator_status_supports_progression
    },
    permitted_platform_transitions: [authorization.authorized_action],
    prohibited_platform_transitions: [
      "request_revision",
      "present_transfer",
      "complete_episode"
    ].filter((action) => action !== authorization.authorized_action),
    topic_dialogue_response_function: output.response_function,
    topic_dialogue_structured_progression_recommendation: {
      next_action: output.next_action,
      next_runtime_state: output.next_runtime_state,
      progression_readiness: output.progression_readiness,
      evidence_sufficiency: output.evidence_sufficiency
    },
    student_facing_assistant_message: output.tutor_message,
    validator_findings: {
      v4_schema_and_safety_validator: [],
      original_automated_findings: {
        critical: input.rubric.critical_findings,
        major: input.rubric.major_findings
      },
      e2a5_candidate_validator: v5Validation.issues
    },
    readiness_gate_decision: {
      ready: gate.ready,
      reason_code: gate.reason_code,
      existing_gate_overrode_candidate: existingGateApplication.overridden,
      controlled_only_not_executed_in_live_harness: true
    },
    progression_service_decision: "not_invoked_by_synthetic_provider_evaluation",
    persisted_state_before_processing: "no_operational_runtime_record_created",
    persisted_state_after_processing: "no_operational_runtime_record_created",
    revision_actually_presented: false,
    transfer_actually_presented: false,
    episode_actually_completed: false,
    later_visible_assistant_response_persisted: false,
    provider_output_preserved_in_evaluation_artifact: true,
    automated_invariant_evidence: {
      original_no_premature_progression:
        originalRubricFinding(input.rubric, "no_premature_progression"),
      original_direct_response_function:
        originalRubricFinding(input.rubric, "direct_response_function"),
      refined_progression_taxonomy: taxonomy
    },
    proposed_adjudication: {
      classifications,
      no_premature_progression: "confirmed_at_internal_recommendation_level",
      direct_response_function: directResponseFalsePositive
        ? "deterministic_check_false_positive"
        : "original_result_supported",
      platform_transition: "none_executed",
      candidate_contract_result: v5Validation.valid ? "accepted" : "rejected_and_regenerate",
      human_adjudication_required: true
    }
  };
}

export function buildE2A5Adjudication() {
  const providerRecords = readJsonLines<V4ProviderOutputRecord>(
    path.join(E2A4_FAILED_RUN_DIR, "provider-outputs.jsonl")
  );
  const rubricRecords = readJsonLines<V4RubricRecord>(
    path.join(E2A4_FAILED_RUN_DIR, "deterministic-rubric.jsonl")
  );
  const cases = e2a3TopicDialogueCases();
  const caseEvidence = providerRecords.map((provider) => {
    const testCase = cases.find((entry) => entry.case_id === provider.case_id);
    const rubric = rubricRecords.find((entry) => entry.case_id === provider.case_id);
    if (!testCase || !rubric) throw new Error(`e2a5_v4_case_evidence_missing:${provider.case_id}`);
    return adjudicateCase({ testCase, provider, rubric });
  });
  if (caseEvidence.length !== 2) throw new Error("e2a5_expected_two_v4_cases");
  const candidate = evaluateE2A5Candidate();
  return {
    caseEvidence,
    progressionTaxonomy: {
      taxonomy_version: "e2a5-progression-taxonomy-v1",
      levels: [
        {
          level: "internal_recommendation",
          definition: "Provider structured output recommends a next action; this is advisory only."
        },
        {
          level: "student_facing_progression_offer",
          definition: "Visible wording tells or implies that progression is available or authorized."
        },
        {
          level: "platform_authorization",
          definition: "Server-owned readiness evidence authorizes one bounded action."
        },
        {
          level: "ui_progression_availability",
          definition: "The student projection makes a revision, transfer, or completion control available."
        },
        {
          level: "executed_transition",
          definition: "A platform command changes authoritative workflow state."
        },
        {
          level: "terminal_completion",
          definition: "The platform persists terminal episode or assessment completion."
        }
      ],
      non_equivalent_signals: [
        "asking_for_evidence",
        "saying_when_you_are_ready",
        "offering_to_continue_dialogue",
        "internal_readiness_recommendation",
        "displaying_progression_controls",
        "executing_transition"
      ]
    },
    directResponseAnalysis: caseEvidence.map((entry) => ({
      case_id: entry.case_id,
      latest_student_message_classification:
        entry.current_readiness_gate_inputs.latest_student_message_classification,
      response_function: entry.topic_dialogue_response_function,
      retained_distractor_anchor: true,
      original_finding:
        entry.validator_findings.original_automated_findings.major.includes("direct_response_function")
          ? "failed"
          : "passed",
      adjudication: entry.proposed_adjudication.direct_response_function
    })),
    platformGateAnalysis: caseEvidence.map((entry) => ({
      case_id: entry.case_id,
      platform_gate_invoked_by_v4_live_harness: false,
      controlled_readiness_gate_decision: entry.readiness_gate_decision,
      operational_state_transition_executed: false,
      ui_projection_created: false,
      candidate_v5_authorized_action: entry.permitted_platform_transitions[0],
      candidate_v5_result: entry.proposed_adjudication.candidate_contract_result
    })),
    findingReanalysis: {
      no_premature_progression_before:
        "Binary failure when next_action was not await_topic_dialogue_response or evidence_sufficiency was sufficient_to_advance.",
      no_premature_progression_after:
        "Reports internal recommendation, student-facing offer, platform authorization, UI availability, executed transition, and terminal completion separately.",
      baseline_case:
        "Genuine candidate-level authorization and student-language defects; no platform transition occurred.",
      repeated_confusion_case:
        "Genuine candidate-level authorization defect; direct-response failure was a deterministic false positive; no platform transition occurred."
    },
    candidateDecision: {
      selected_path: "path_c_model_output_or_student_facing_contract_defect",
      v5_required: true,
      rationale: [
        "Both V4 outputs recommended actions beyond explicit platform authorization reconstructed from server-owned readiness inputs.",
        "The baseline assistant message visibly claimed readiness while authorization remained remain_in_dialogue.",
        "The repeated-confusion response directly answered the latest question, but its structured final-support recommendation exceeded authorization.",
        "The synthetic provider evaluation executed no operational transition, so Path B actual-transition criterion was not met."
      ],
      v4_status: "candidate_evaluation_failed_unchanged",
      v5_candidate_hash: candidate.candidate_configuration_hash,
      v5_candidate_file_sha256: candidate.candidate_file_sha256,
      v5_approval_state: "not_approved",
      v5_activation_state: "not_activated",
      provider_re_evaluation_required: true,
      provider_re_evaluation_executed: false
    },
    humanReviewSummary: {
      review_version: "e2a5-human-adjudication-summary-v1",
      review_status: "pending_human_review",
      human_decisions: null,
      human_scores: null,
      cases: caseEvidence.map((entry) => ({
        case_id: entry.case_id,
        scenario: entry.scenario,
        latest_student_message: entry.latest_student_message,
        student_facing_assistant_message: entry.student_facing_assistant_message,
        structured_recommendation:
          entry.topic_dialogue_structured_progression_recommendation,
        automated_proposed_adjudication: entry.proposed_adjudication,
        human_decision: null,
        human_notes: null
      }))
    },
    candidate
  };
}

export function runE2A5Adjudication(input: { artifactRoot?: string } = {}) {
  const before = e2a5ProtectedArtifactSnapshot();
  const adjudication = buildE2A5Adjudication();
  const timestamp = new Date().toISOString().replaceAll(/[-:.TZ]/gu, "").slice(0, 14);
  const runId = `e2a5_${timestamp}_${randomBytes(4).toString("hex")}`;
  const root = input.artifactRoot ?? E2A5_ARTIFACT_ROOT;
  const runDir = path.join(root, runId);
  mkdirSync(runDir, { recursive: true });
  const after = e2a5ProtectedArtifactSnapshot();
  if (before.aggregate_sha256 !== after.aggregate_sha256) {
    throw new Error("e2a5_protected_artifact_hash_changed");
  }
  const manifest = {
    adjudication_version: E2A5_ADJUDICATION_VERSION,
    run_id: runId,
    source_v4_run_id: E2A4_FAILED_RUN_ID,
    source_v4_candidate_hash: E2A5_FAILED_V4_HASH,
    v5_candidate_hash: adjudication.candidate.candidate_configuration_hash,
    provider_calls: 0,
    provider_evaluation_reran: false,
    e2a_canary_ran: false,
    full_matrix_ran: false,
    human_review_required: true,
    human_review_completed: false,
    candidate_approved: false,
    candidate_activated: false,
    protected_artifacts_unchanged: true,
    protected_artifacts_before_sha256: before.aggregate_sha256,
    protected_artifacts_after_sha256: after.aggregate_sha256
  };
  const valuesToScan = [manifest, adjudication, before, after];
  const serialized = JSON.stringify(valuesToScan);
  if (/authorization:\s*bearer|openai_api_key|cookie|chain.of.thought/iu.test(serialized)) {
    throw new Error("e2a5_artifact_secret_scan_failed");
  }
  writeJson(path.join(runDir, "adjudication-manifest.json"), manifest);
  writeJsonLines(path.join(runDir, "case-evidence.jsonl"), adjudication.caseEvidence);
  writeJson(path.join(runDir, "progression-taxonomy.json"), adjudication.progressionTaxonomy);
  writeJson(path.join(runDir, "direct-response-analysis.json"), adjudication.directResponseAnalysis);
  writeJson(path.join(runDir, "platform-gate-analysis.json"), adjudication.platformGateAnalysis);
  writeJson(path.join(runDir, "automated-finding-reanalysis.json"), adjudication.findingReanalysis);
  writeJson(path.join(runDir, "candidate-decision.json"), adjudication.candidateDecision);
  writeJson(path.join(runDir, "human-review-summary.json"), adjudication.humanReviewSummary);
  writeJson(path.join(runDir, "protected-artifacts-before.json"), before);
  writeJson(path.join(runDir, "protected-artifacts-after.json"), after);
  writeJson(path.join(root, "latest-run.json"), { run_id: runId, run_dir: runDir });
  return { runId, runDir, manifest, adjudication };
}

export function loadLatestE2A5Adjudication(root = E2A5_ARTIFACT_ROOT) {
  const latest = JSON.parse(readFileSync(path.join(root, "latest-run.json"), "utf8")) as {
    run_id: string;
    run_dir: string;
  };
  return {
    run_id: latest.run_id,
    run_dir: latest.run_dir,
    manifest: JSON.parse(readFileSync(path.join(latest.run_dir, "adjudication-manifest.json"), "utf8")),
    candidate_decision: JSON.parse(readFileSync(path.join(latest.run_dir, "candidate-decision.json"), "utf8")),
    human_review_summary: JSON.parse(readFileSync(path.join(latest.run_dir, "human-review-summary.json"), "utf8"))
  };
}

export function e2a5CandidateFileExists() {
  return existsSync(E2A5_CANDIDATE_PATH);
}
