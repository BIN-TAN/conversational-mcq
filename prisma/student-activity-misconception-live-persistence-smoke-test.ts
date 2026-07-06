import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  ACTIVITY_MISCONCEPTION_EVIDENCE_LIVE_SMOKE_EXPECTED_STATUSES,
  executeLiveActivityMisconceptionEvidenceEvaluator,
  type ActivityMisconceptionEvidenceLiveEvaluationInput,
  type ActivityMisconceptionEvidenceProviderAudit
} from "../src/lib/services/student-assessment/activity-misconception-evidence-live";
import {
  persistActivityMisconceptionEvidenceUpdate,
  validateActivityMisconceptionEvidencePersistence,
  writePostActivityMisconceptionUpdateReview
} from "../src/lib/services/student-assessment/activity-misconception-update";
import {
  ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION,
  ACTIVITY_RESPONSE_EVALUATOR_SCHEMA_VERSION
} from "../src/lib/services/student-assessment/activity-misconception-evidence";
import { prisma } from "../src/lib/db";
import { envPresent } from "./student-formative-value-helpers";
import { assert } from "./student-mvp-smoke-helpers";

const envLoadResult = loadEnvConfig(process.cwd());

const REQUIRED_DATABASE_ENV = ["DATABASE_URL", "SESSION_SECRET"] as const;
const REQUIRED_PROVIDER_ENV = ["LLM_PROVIDER", "LLM_LIVE_CALLS_ENABLED"] as const;
const MODEL_ENV_OPTIONS = [
  "OPENAI_MODEL_PROFILE_INTEGRATION",
  "OPENAI_MODEL_PLANNING",
  "OPENAI_MODEL_FOLLOWUP"
] as const;

type LivePersistenceCase = {
  case_id: keyof typeof ACTIVITY_MISCONCEPTION_EVIDENCE_LIVE_SMOKE_EXPECTED_STATUSES;
  label: string;
  allowed_statuses: string[];
  expected_disallowed_statuses: string[];
  pre_activity_diagnostic_state: string;
  input: ActivityMisconceptionEvidenceLiveEvaluationInput;
};

type AgentCallSummary = {
  agent_call_present: boolean;
  call_status: string;
  output_validated: boolean;
  provider_metadata_present: boolean;
  token_usage_present: boolean;
  provider: string | null;
  model_name: string | null;
  schema_version: string | null;
  prompt_version: string | null;
  token_usage: {
    input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
  };
};

function liveReadiness() {
  const missingDatabaseOrSession = REQUIRED_DATABASE_ENV.filter((name) => !envPresent(name));
  const missingProvider = REQUIRED_PROVIDER_ENV.filter((name) => !envPresent(name));
  const invalidProvider: string[] = [];

  if (envPresent("LLM_PROVIDER") && process.env.LLM_PROVIDER !== "openai") {
    invalidProvider.push("LLM_PROVIDER");
  }
  if (envPresent("LLM_LIVE_CALLS_ENABLED") && process.env.LLM_LIVE_CALLS_ENABLED !== "true") {
    invalidProvider.push("LLM_LIVE_CALLS_ENABLED");
  }

  const credentialConfigured = envPresent("OPENAI_API_KEY") || envPresent("OPENAI_API_KEY_FILE");
  const modelConfigured = MODEL_ENV_OPTIONS.some((name) => envPresent(name));

  return {
    ready:
      missingDatabaseOrSession.length === 0 &&
      missingProvider.length === 0 &&
      invalidProvider.length === 0 &&
      credentialConfigured &&
      modelConfigured,
    env_files_loaded: envLoadResult.loadedEnvFiles.map((file) => file.path),
    missing_database_or_session_variables: missingDatabaseOrSession,
    missing_provider_variables: missingProvider,
    invalid_provider_variable_names: invalidProvider,
    credential_configured: credentialConfigured,
    model_configured_by_one_of: modelConfigured ? MODEL_ENV_OPTIONS : [],
    missing_model_variable_options: modelConfigured ? [] : MODEL_ENV_OPTIONS
  };
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function livePersistenceCases(runSlug: string): LivePersistenceCase[] {
  const base = {
    student_public_id: "student_activity_misconception_persistence_synthetic",
    assessment_public_id: "assessment_fixed_irt_synthetic",
    concept_unit_id: "concept_theta_invariance",
    selected_formative_value: "diagnostic_clarification" as const,
    distractor_role: "A tempting alternative blurs student ability estimates with item-side features.",
    safe_activity_prompt:
      "Explain the difference between a learner ability estimate and the features of a question, then say how that affects the tempting alternative.",
    expected_evidence_focus: "safe misconception evidence from redacted synthetic activity and response summaries only"
  };

  return [
    {
      case_id: "activity_misconception_live_002_conceptual_entry_partial_improvement",
      label: "conceptual entry partial distinction",
      allowed_statuses: ["conceptual_entry_improved", "ready_for_distractor_probe"],
      expected_disallowed_statuses: [
        "conceptual_entry_gap_remains",
        "no_actionable_misconception_evidence",
        "misconception_persisted",
        "misconception_weakened",
        "misconception_unsupported"
      ],
      pre_activity_diagnostic_state: "conceptual_entry_gap",
      input: {
        ...base,
        case_id: "activity_misconception_live_002_conceptual_entry_partial_improvement",
        session_public_id: `sess_activity_misconception_persist_002_${runSlug}`,
        activity_attempt_id: `activity_attempt_persist_002_${runSlug}`,
        source_activity_family: "basic_concept_grounding",
        source_diagnostic_purpose: "conceptual_entry_grounding",
        profile_condition: "student has an emerging but incomplete distinction after grounding",
        safe_student_activity_response:
          "Student starts to separate learner ability from question features, but the distinction is still incomplete.",
        response_kind_hint: "partial"
      }
    },
    {
      case_id: "activity_misconception_live_004_strong_distractor_boundary",
      label: "distractor probe strong response",
      allowed_statuses: ["misconception_unsupported", "no_actionable_misconception_evidence", "misconception_weakened"],
      expected_disallowed_statuses: ["misconception_persisted", "conceptual_entry_gap_remains"],
      pre_activity_diagnostic_state: "suspected_distractor_linked_misconception",
      input: {
        ...base,
        case_id: "activity_misconception_live_004_strong_distractor_boundary",
        session_public_id: `sess_activity_misconception_persist_004_${runSlug}`,
        activity_attempt_id: `activity_attempt_persist_004_${runSlug}`,
        source_activity_family: "distractor_contrast",
        source_diagnostic_purpose: "distractor_misconception_probe",
        profile_condition: "distractor hypothesis is actively tested",
        safe_student_activity_response:
          "Student explains why the alternative felt tempting, names the hidden assumption, and contrasts it with the target boundary.",
        response_kind_hint: "substantive"
      }
    },
    {
      case_id: "activity_misconception_live_010_move_on",
      label: "student move-on response",
      allowed_statuses: ["student_chose_move_on"],
      expected_disallowed_statuses: ["insufficient_new_evidence", "misconception_persisted", "no_actionable_misconception_evidence"],
      pre_activity_diagnostic_state: "suspected_distractor_linked_misconception",
      input: {
        ...base,
        case_id: "activity_misconception_live_010_move_on",
        session_public_id: `sess_activity_misconception_persist_010_${runSlug}`,
        activity_attempt_id: `activity_attempt_persist_010_${runSlug}`,
        source_activity_family: "distractor_contrast",
        source_diagnostic_purpose: "distractor_misconception_probe",
        profile_condition: "student chooses to stop the current activity",
        safe_student_activity_response: "Student explicitly chooses to move on rather than continue the activity.",
        response_kind_hint: "move_on"
      }
    }
  ];
}

async function agentCallSummary(agentCallId?: string): Promise<AgentCallSummary> {
  if (!agentCallId) {
    return {
      agent_call_present: false,
      call_status: "not_started",
      output_validated: false,
      provider_metadata_present: false,
      token_usage_present: false,
      provider: null,
      model_name: null,
      schema_version: null,
      prompt_version: null,
      token_usage: {
        input_tokens: null,
        output_tokens: null,
        total_tokens: null
      }
    };
  }

  const call = await prisma.agentCall.findUnique({
    where: { id: agentCallId },
    select: {
      call_status: true,
      output_validated: true,
      provider_request_id: true,
      provider_response_id: true,
      input_tokens: true,
      output_tokens: true,
      total_tokens: true,
      provider: true,
      model_name: true,
      schema_version: true,
      prompt_version: true
    }
  });

  return {
    agent_call_present: Boolean(call),
    call_status: call?.call_status ?? "missing",
    output_validated: call?.output_validated ?? false,
    provider_metadata_present: Boolean(call?.provider_request_id || call?.provider_response_id),
    token_usage_present: Boolean(
      Number.isFinite(call?.input_tokens) &&
        Number.isFinite(call?.output_tokens) &&
        Number.isFinite(call?.total_tokens)
    ),
    provider: call?.provider ?? null,
    model_name: call?.model_name ?? null,
    schema_version: call?.schema_version ?? null,
    prompt_version: call?.prompt_version ?? null,
    token_usage: {
      input_tokens: call?.input_tokens ?? null,
      output_tokens: call?.output_tokens ?? null,
      total_tokens: call?.total_tokens ?? null
    }
  };
}

async function auditFromAgentCall(agentCallId: string): Promise<ActivityMisconceptionEvidenceProviderAudit> {
  const call = await prisma.agentCall.findUnique({
    where: { id: agentCallId },
    select: {
      id: true,
      provider: true,
      model_name: true,
      client_request_id: true,
      provider_request_id: true,
      provider_response_id: true,
      call_status: true,
      output_validated: true,
      input_tokens: true,
      output_tokens: true,
      total_tokens: true
    }
  });
  assert(call, "Source evaluator agent_call must exist before persistence.");
  return {
    agent_call_id: call.id,
    provider: call.provider === "openai" ? "openai" : "mock",
    model_name: call.model_name,
    client_request_id: call.client_request_id ?? undefined,
    provider_request_id: call.provider_request_id ?? undefined,
    provider_response_id: call.provider_response_id ?? undefined,
    call_status:
      call.call_status === "succeeded"
        ? "succeeded"
        : call.call_status === "invalid_output"
          ? "invalid_output"
          : call.call_status === "started"
            ? "started"
            : "failed",
    output_validated: call.output_validated,
    input_tokens: call.input_tokens ?? undefined,
    output_tokens: call.output_tokens ?? undefined,
    total_tokens: call.total_tokens ?? undefined
  };
}

function protectedArtifactPattern() {
  return /answer key|correct option|correct answer|raw provider output|raw prompt|api key|authorization header|bearer token|session secret|database url|mis_[a-z0-9_]+/i;
}

async function writeArtifact(input: {
  runSlug: string;
  status: "passed" | "failed";
  case_results: unknown[];
  review_artifact_paths: string[];
  profile_count_before: number;
  profile_count_after: number;
  response_package_count_before: number;
  response_package_count_after: number;
  failure_reason?: string;
}) {
  const outputDir = path.join(process.cwd(), ".data", "activity-misconception-live-persistence-smoke");
  await mkdir(outputDir, { recursive: true });
  const artifactPath = path.join(outputDir, `activity-misconception-live-persistence-smoke-${input.runSlug}.json`);
  const artifact = {
    artifact_type: "activity_misconception_live_persistence_smoke",
    artifact_version: "activity-misconception-live-persistence-smoke-v1",
    generated_at: new Date().toISOString(),
    status: input.status,
    failure_reason: input.failure_reason ?? null,
    evaluator_schema_version: ACTIVITY_RESPONSE_EVALUATOR_SCHEMA_VERSION,
    packet_schema_version: ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION,
    live_case_count: input.case_results.length,
    no_raw_provider_output_in_artifact: true,
    no_raw_prompts_in_artifact: true,
    no_raw_student_text_in_artifact: true,
    no_answer_key_or_correctness_in_artifact: true,
    operational_profile_unchanged: input.profile_count_before === input.profile_count_after,
    response_package_count_unchanged: input.response_package_count_before === input.response_package_count_after,
    review_artifact_paths: input.review_artifact_paths,
    case_results: input.case_results
  };
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  const serialized = await readFile(artifactPath, "utf8");
  assert(!protectedArtifactPattern().test(serialized), "Live persistence artifact contains protected content.");
  return artifactPath;
}

async function processCase(entry: LivePersistenceCase) {
  const result = await executeLiveActivityMisconceptionEvidenceEvaluator({
    evaluation_input: entry.input
  });
  const evaluator = await agentCallSummary(result.evaluator_agent_call_id);
  const repair = await agentCallSummary(result.repair_agent_call_id);

  if (result.status !== "succeeded") {
    return {
      case_id: entry.case_id,
      label: entry.label,
      evaluator_status: result.status,
      blocked_reason: result.blocked_reason,
      validation_issues: result.validation_issues,
      evaluator,
      repair,
      persisted: false,
      result: "failed_before_persistence"
    };
  }

  const updateStatus = result.packet.misconception_evidence_update.status;
  const statusAllowed = entry.allowed_statuses.includes(updateStatus);
  const statusDisallowed = entry.expected_disallowed_statuses.includes(updateStatus);
  if (!statusAllowed || statusDisallowed) {
    return {
      case_id: entry.case_id,
      label: entry.label,
      evaluator_status: result.status,
      update_status: updateStatus,
      allowed_statuses: entry.allowed_statuses,
      expected_disallowed_statuses: entry.expected_disallowed_statuses,
      status_allowed: statusAllowed,
      status_disallowed: statusDisallowed,
      evaluator,
      repair,
      persisted: false,
      result: "outcome_mismatch_before_persistence"
    };
  }

  const sourceAgentCallId = result.repair_agent_call_id ?? result.evaluator_agent_call_id;
  const evaluatorAudit = await auditFromAgentCall(sourceAgentCallId);
  const guard = await validateActivityMisconceptionEvidencePersistence({
    packet: result.packet,
    evaluator_audit: evaluatorAudit,
    mode: "production_diagnosis"
  });
  if (!guard.passed) {
    return {
      case_id: entry.case_id,
      label: entry.label,
      evaluator_status: result.status,
      update_status: updateStatus,
      evaluator,
      repair,
      persistence_guard: guard,
      persisted: false,
      result: "persistence_guard_failed"
    };
  }

  const persisted = await persistActivityMisconceptionEvidenceUpdate({
    packet: result.packet,
    evaluator_audit: evaluatorAudit,
    mode: "production_diagnosis",
    source_activity_packet_ref: {
      case_id: entry.case_id,
      source_activity_family: result.packet.source_activity_family,
      source_diagnostic_purpose: result.packet.source_diagnostic_purpose,
      activity_attempt_id: result.packet.activity_attempt_id,
      final_source_agent_call: result.repair_agent_call_id ? "repair" : "evaluator"
    },
    pre_activity_diagnostic_state: entry.pre_activity_diagnostic_state
  });

  assert(persisted.record.evaluation_source === "live_llm", `${entry.case_id}: persisted record must be live_llm.`);
  assert(persisted.record.review_only === false, `${entry.case_id}: persisted record must not be review-only.`);
  assert(persisted.record.runtime_servable_to_student === false, `${entry.case_id}: persisted record must not be runtime student-servable.`);
  assert(persisted.record.source_evaluator_agent_call_db_id === sourceAgentCallId, `${entry.case_id}: source agent call must be linked.`);
  assert(persisted.snapshot, `${entry.case_id}: post-activity diagnostic snapshot must be created.`);
  assert(
    persisted.snapshot?.pre_activity_diagnostic_state === entry.pre_activity_diagnostic_state,
    `${entry.case_id}: pre-activity diagnostic state should be preserved.`
  );

  const review = await writePostActivityMisconceptionUpdateReview({
    session_public_id: result.packet.session_public_id
  });
  assert(review.records_reviewed > 0, `${entry.case_id}: update review should find persisted record.`);
  assert(review.evidence_record_source === "live_llm", `${entry.case_id}: review should expose live_llm source.`);
  assert(review.post_activity_snapshot_generated, `${entry.case_id}: review should report snapshot.`);
  assert(review.student_safe_feedback_present, `${entry.case_id}: review should report student-safe feedback.`);
  assert(review.safety_check_passed, `${entry.case_id}: review safety should pass.`);

  return {
    case_id: entry.case_id,
    label: entry.label,
    evaluator_status: result.status,
    update_status: updateStatus,
    evidence_quality: result.packet.misconception_evidence_update.evidence_quality,
    recommended_next_diagnostic_purpose: result.packet.recommended_next_diagnostic_purpose,
    status_allowed: statusAllowed,
    status_disallowed: statusDisallowed,
    evaluator,
    repair,
    repair_attempted: result.repair_attempted,
    source_agent_call: result.repair_agent_call_id ? "repair" : "evaluator",
    persistence_guard_passed: persisted.guard.passed,
    persisted: true,
    evidence_record_public_id: persisted.record.evidence_public_id,
    source_evaluator_agent_call_db_id_present: Boolean(persisted.record.source_evaluator_agent_call_db_id),
    snapshot_public_id: persisted.snapshot?.snapshot_public_id ?? null,
    diagnostic_state_before: persisted.snapshot?.pre_activity_diagnostic_state ?? null,
    diagnostic_state_after: persisted.snapshot?.post_activity_diagnostic_state ?? null,
    student_safe_feedback_summary: {
      message_length: result.packet.student_safe_feedback.message.length,
      next_options: result.packet.student_safe_feedback.next_options
    },
    safety_flags: result.packet.safety_check,
    review_summary: {
      records_reviewed: review.records_reviewed,
      evidence_record_source: review.evidence_record_source,
      post_activity_snapshot_generated: review.post_activity_snapshot_generated,
      diagnostic_state_after: review.diagnostic_state_after,
      recommended_next_diagnostic_purpose: review.recommended_next_diagnostic_purpose,
      student_safe_feedback_present: review.student_safe_feedback_present,
      safety_check_passed: review.safety_check_passed,
      artifact_path: review.artifact_path
    },
    result: "persisted"
  };
}

async function main() {
  if (process.env.RUN_LIVE_ACTIVITY_MISCONCEPTION_PERSISTENCE_SMOKE !== "1") {
    console.log(JSON.stringify({
      status: "skipped",
      reason: "RUN_LIVE_ACTIVITY_MISCONCEPTION_PERSISTENCE_SMOKE is not set to 1.",
      env_files_loaded: envLoadResult.loadedEnvFiles.map((file) => file.path)
    }, null, 2));
    return;
  }

  const readiness = liveReadiness();
  if (!readiness.ready) {
    console.log(JSON.stringify({
      status: "not_ready",
      ...readiness
    }, null, 2));
    throw new Error("Live activity misconception persistence smoke is not configured. No provider call was made.");
  }

  const runSlug = timestampSlug();
  const profileCountBefore = await prisma.studentProfile.count();
  const responsePackageCountBefore = await prisma.responsePackage.count();
  const cases = livePersistenceCases(runSlug);
  const caseResults = [];
  const reviewArtifactPaths: string[] = [];

  for (const entry of cases) {
    const result = await processCase(entry);
    caseResults.push(result);
    const reviewPath = typeof result === "object" &&
      result !== null &&
      "review_summary" in result &&
      result.review_summary &&
      typeof result.review_summary === "object" &&
      "artifact_path" in result.review_summary
      ? String((result.review_summary as { artifact_path?: unknown }).artifact_path)
      : null;
    if (reviewPath) {
      reviewArtifactPaths.push(reviewPath);
    }
    if (!("persisted" in result) || result.persisted !== true) {
      const profileCountAfterFailure = await prisma.studentProfile.count();
      const responsePackageCountAfterFailure = await prisma.responsePackage.count();
      const artifactPath = await writeArtifact({
        runSlug,
        status: "failed",
        case_results: caseResults,
        review_artifact_paths: reviewArtifactPaths,
        profile_count_before: profileCountBefore,
        profile_count_after: profileCountAfterFailure,
        response_package_count_before: responsePackageCountBefore,
        response_package_count_after: responsePackageCountAfterFailure,
        failure_reason: `${entry.case_id}:${result.result}`
      });
      console.log(JSON.stringify({
        status: "failed",
        artifact_path: artifactPath,
        failed_case_id: entry.case_id,
        results: caseResults
      }, null, 2));
      throw new Error(`Live activity misconception persistence smoke failed for ${entry.case_id}.`);
    }
  }

  const profileCountAfter = await prisma.studentProfile.count();
  const responsePackageCountAfter = await prisma.responsePackage.count();
  const artifactPath = await writeArtifact({
    runSlug,
    status: "passed",
    case_results: caseResults,
    review_artifact_paths: reviewArtifactPaths,
    profile_count_before: profileCountBefore,
    profile_count_after: profileCountAfter,
    response_package_count_before: responsePackageCountBefore,
    response_package_count_after: responsePackageCountAfter
  });

  const totalTokenUsage = caseResults.reduce((sum, result) => {
    const evaluatorTokens = result.evaluator.token_usage.total_tokens ?? 0;
    const repairTokens = result.repair.token_usage.total_tokens ?? 0;
    return sum + evaluatorTokens + repairTokens;
  }, 0);

  console.log(JSON.stringify({
    status: "passed",
    artifact_path: artifactPath,
    live_case_count: caseResults.length,
    persisted_count: caseResults.filter((result) => result.persisted === true).length,
    provider_request_count: caseResults.reduce((sum, result) =>
      sum + (result.evaluator.agent_call_present ? 1 : 0) + (result.repair.agent_call_present ? 1 : 0), 0),
    total_token_usage: totalTokenUsage,
    operational_profile_unchanged: profileCountBefore === profileCountAfter,
    response_package_count_unchanged: responsePackageCountBefore === responsePackageCountAfter,
    review_artifact_paths: reviewArtifactPaths,
    results: caseResults
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
