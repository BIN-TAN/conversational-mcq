import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import {
  ACTIVITY_MISCONCEPTION_EVIDENCE_LIVE_SMOKE_ARTIFACT_VERSION,
  ACTIVITY_MISCONCEPTION_EVIDENCE_LIVE_SMOKE_EXPECTED_STATUSES,
  ACTIVITY_RESPONSE_EVALUATOR_PROMPT_HASH,
  ACTIVITY_RESPONSE_EVALUATOR_PROMPT_VERSION,
  executeLiveActivityMisconceptionEvidenceEvaluator,
  summarizeActivityMisconceptionEvidenceLiveSmokeOutcome,
  type ActivityMisconceptionEvidenceLiveEvaluationInput,
  type ActivityMisconceptionEvidenceLiveExecutionResult
} from "../src/lib/services/student-assessment/activity-misconception-evidence-live";
import {
  ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION,
  ACTIVITY_RESPONSE_EVALUATOR_SCHEMA_VERSION
} from "../src/lib/services/student-assessment/activity-misconception-evidence";
import { envPresent } from "./student-formative-value-helpers";

const envLoadResult = loadEnvConfig(process.cwd());
const prisma = new PrismaClient();

const REQUIRED_DATABASE_ENV = ["DATABASE_URL", "SESSION_SECRET"] as const;
const REQUIRED_PROVIDER_ENV = ["LLM_PROVIDER", "LLM_LIVE_CALLS_ENABLED"] as const;
const MODEL_ENV_OPTIONS = [
  "OPENAI_MODEL_PROFILE_INTEGRATION",
  "OPENAI_MODEL_PLANNING",
  "OPENAI_MODEL_FOLLOWUP"
] as const;

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

function liveCases(): Array<{
  case_id: keyof typeof ACTIVITY_MISCONCEPTION_EVIDENCE_LIVE_SMOKE_EXPECTED_STATUSES;
  expected_disallowed_statuses: string[];
  rationale: string;
  input: ActivityMisconceptionEvidenceLiveEvaluationInput;
}> {
  const base = {
    student_public_id: "student_activity_misconception_live_synthetic",
    assessment_public_id: "assessment_fixed_irt_synthetic",
    concept_unit_id: "concept_theta_invariance",
    selected_formative_value: "diagnostic_clarification" as const,
    distractor_role: "A tempting alternative blurs student ability estimates with item-side features.",
    safe_activity_prompt:
      "Explain the difference between a learner ability estimate and the features of a question, then say how that affects the tempting alternative.",
    expected_evidence_focus: "distractor-informed misconception evidence without answer keys or correctness labels"
  };

  return [
    {
      case_id: "activity_misconception_live_001_weak_conceptual_entry",
      expected_disallowed_statuses: ["no_actionable_misconception_evidence", "independent_evidence_supported"],
      rationale: "Weak conceptual entry should remain a gap rather than resolve the hypothesis.",
      input: {
        ...base,
        case_id: "activity_misconception_live_001_weak_conceptual_entry",
        session_public_id: "sess_activity_misconception_live_001",
        activity_attempt_id: "activity_attempt_live_001",
        source_activity_family: "basic_concept_grounding",
        source_diagnostic_purpose: "conceptual_entry_grounding",
        profile_condition: "basic concept distinction is still unclear",
        safe_student_activity_response:
          "Student gives a short answer that still blends learner ability with question features.",
        response_kind_hint: "partial"
      }
    },
    {
      case_id: "activity_misconception_live_002_clear_conceptual_entry",
      expected_disallowed_statuses: ["conceptual_entry_gap_remains", "misconception_persisted"],
      rationale: "Clear concept distinction should improve entry evidence or prepare a distractor probe.",
      input: {
        ...base,
        case_id: "activity_misconception_live_002_clear_conceptual_entry",
        session_public_id: "sess_activity_misconception_live_002",
        activity_attempt_id: "activity_attempt_live_002",
        source_activity_family: "basic_concept_grounding",
        source_diagnostic_purpose: "conceptual_entry_grounding",
        profile_condition: "student can state the basic distinction after grounding",
        safe_student_activity_response:
          "Student explains that theta estimates the learner while item parameters describe the question side.",
        response_kind_hint: "substantive"
      }
    },
    {
      case_id: "activity_misconception_live_003_strong_distractor_boundary",
      expected_disallowed_statuses: ["misconception_persisted", "conceptual_entry_gap_remains"],
      rationale: "Strong distractor contrast should not preserve a misconception.",
      input: {
        ...base,
        case_id: "activity_misconception_live_003_strong_distractor_boundary",
        session_public_id: "sess_activity_misconception_live_003",
        activity_attempt_id: "activity_attempt_live_003",
        source_activity_family: "distractor_contrast",
        source_diagnostic_purpose: "distractor_misconception_probe",
        profile_condition: "distractor hypothesis is actively tested",
        safe_student_activity_response:
          "Student explains why the alternative felt tempting, names the hidden assumption, and contrasts it with the target boundary.",
        response_kind_hint: "substantive"
      }
    },
    {
      case_id: "activity_misconception_live_004_partial_distractor_boundary",
      expected_disallowed_statuses: ["no_actionable_misconception_evidence", "misconception_persisted"],
      rationale: "Partial distractor evidence should weaken but not resolve or fully preserve the hypothesis.",
      input: {
        ...base,
        case_id: "activity_misconception_live_004_partial_distractor_boundary",
        session_public_id: "sess_activity_misconception_live_004",
        activity_attempt_id: "activity_attempt_live_004",
        source_activity_family: "distractor_contrast",
        source_diagnostic_purpose: "distractor_misconception_probe",
        profile_condition: "student partly explains the distractor assumption",
        safe_student_activity_response:
          "Student describes why the alternative was tempting and partially names the assumption, but leaves the boundary incomplete.",
        response_kind_hint: "partial"
      }
    },
    {
      case_id: "activity_misconception_live_005_repeats_distractor_logic",
      expected_disallowed_statuses: ["misconception_unsupported", "no_actionable_misconception_evidence"],
      rationale: "Repeated distractor reasoning should preserve the active misconception hypothesis.",
      input: {
        ...base,
        case_id: "activity_misconception_live_005_repeats_distractor_logic",
        session_public_id: "sess_activity_misconception_live_005",
        activity_attempt_id: "activity_attempt_live_005",
        source_activity_family: "distractor_contrast",
        source_diagnostic_purpose: "distractor_misconception_probe",
        profile_condition: "student repeats the distractor logic after contrast",
        safe_student_activity_response:
          "Student restates the tempting alternative and does not separate the hidden assumption from the target idea.",
        response_kind_hint: "substantive"
      }
    },
    {
      case_id: "activity_misconception_live_006_reasoning_boundary_strong",
      expected_disallowed_statuses: ["reasoning_boundary_still_blurred", "misconception_persisted"],
      rationale: "A strong reasoning repair should improve boundary understanding.",
      input: {
        ...base,
        case_id: "activity_misconception_live_006_reasoning_boundary_strong",
        session_public_id: "sess_activity_misconception_live_006",
        activity_attempt_id: "activity_attempt_live_006",
        source_activity_family: "reasoning_chain_repair",
        selected_formative_value: "reasoning_refinement",
        source_diagnostic_purpose: "reasoning_boundary_repair",
        profile_condition: "reasoning link repair is the current target",
        safe_activity_prompt:
          "Revise the reasoning link so it separates the target idea from the tempting alternative.",
        safe_student_activity_response:
          "Student repairs the missing reasoning link and explains how it changes the conclusion.",
        response_kind_hint: "substantive"
      }
    },
    {
      case_id: "activity_misconception_live_007_independent_reconstruction_strong",
      expected_disallowed_statuses: ["insufficient_new_evidence", "misconception_persisted"],
      rationale: "Strong own-words reconstruction should support independent evidence.",
      input: {
        ...base,
        case_id: "activity_misconception_live_007_independent_reconstruction_strong",
        session_public_id: "sess_activity_misconception_live_007",
        activity_attempt_id: "activity_attempt_live_007",
        source_activity_family: "independent_reconstruction",
        selected_formative_value: "independent_understanding_verification",
        source_diagnostic_purpose: "independent_misconception_verification",
        profile_condition: "independent reconstruction is needed",
        safe_activity_prompt:
          "Setting the option choices aside, reconstruct the idea in your own words.",
        safe_student_activity_response:
          "Student reconstructs the concept independently and explains the target boundary without using option labels.",
        response_kind_hint: "substantive"
      }
    },
    {
      case_id: "activity_misconception_live_008_low_information_understand",
      expected_disallowed_statuses: ["no_actionable_misconception_evidence", "independent_evidence_supported"],
      rationale: "Low-information agreement should remain insufficient new evidence.",
      input: {
        ...base,
        case_id: "activity_misconception_live_008_low_information_understand",
        session_public_id: "sess_activity_misconception_live_008",
        activity_attempt_id: "activity_attempt_live_008",
        source_activity_family: "basic_concept_grounding",
        source_diagnostic_purpose: "conceptual_entry_grounding",
        profile_condition: "student provides agreement without explanation",
        safe_student_activity_response: "Student only says they understand now and provides no new concept explanation.",
        response_kind_hint: "low_information"
      }
    },
    {
      case_id: "activity_misconception_live_009_move_on",
      expected_disallowed_statuses: ["misconception_persisted", "no_actionable_misconception_evidence"],
      rationale: "A move-on choice should preserve the choice, not invent diagnostic evidence.",
      input: {
        ...base,
        case_id: "activity_misconception_live_009_move_on",
        session_public_id: "sess_activity_misconception_live_009",
        activity_attempt_id: "activity_attempt_live_009",
        source_activity_family: "distractor_contrast",
        source_diagnostic_purpose: "distractor_misconception_probe",
        profile_condition: "student chooses to stop the current activity",
        safe_student_activity_response: "Student explicitly chooses to move on rather than continue the activity.",
        response_kind_hint: "move_on"
      }
    },
    {
      case_id: "activity_misconception_live_010_choose_other_activity",
      expected_disallowed_statuses: ["misconception_persisted", "boundary_understanding_improved"],
      rationale: "Alternative-activity request should preserve the choice and avoid diagnostic overclaim.",
      input: {
        ...base,
        case_id: "activity_misconception_live_010_choose_other_activity",
        session_public_id: "sess_activity_misconception_live_010",
        activity_attempt_id: "activity_attempt_live_010",
        source_activity_family: "reasoning_chain_repair",
        selected_formative_value: "reasoning_refinement",
        source_diagnostic_purpose: "reasoning_boundary_repair",
        profile_condition: "student requests a different path",
        safe_student_activity_response:
          "Student asks to choose another activity rather than respond to the current prompt.",
        response_kind_hint: "choose_other_activity"
      }
    }
  ];
}

async function agentCallSummary(agentCallId?: string) {
  if (!agentCallId) {
    return {
      agent_call_present: false,
      call_status: "not_started",
      output_validated: false,
      provider_metadata_present: false,
      token_usage_present: false,
      provider: null
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
      prompt_version: true,
      prompt_hash: true,
      schema_version: true
    }
  });

  return {
    agent_call_present: Boolean(call),
    call_status: call?.call_status ?? "missing",
    output_validated: call?.output_validated ?? false,
    provider_metadata_present: Boolean(call?.provider_request_id || call?.provider_response_id),
    token_usage_present: Boolean(call?.input_tokens || call?.output_tokens || call?.total_tokens),
    provider: call?.provider ?? null,
    model_name: call?.model_name ?? null,
    prompt_version: call?.prompt_version ?? null,
    prompt_hash_present: Boolean(call?.prompt_hash),
    schema_version: call?.schema_version ?? null
  };
}

async function resultSummary(
  caseId: string,
  result: ActivityMisconceptionEvidenceLiveExecutionResult,
  allowedStatuses: string[],
  disallowedStatuses: string[],
  rationale: string
) {
  const evaluator = await agentCallSummary(result.evaluator_agent_call_id);
  const repair = await agentCallSummary(result.repair_agent_call_id);

  if (result.status !== "succeeded") {
    return {
      case_id: caseId,
      status: result.status,
      blocked_reason: result.blocked_reason,
      validation_issues: result.validation_issues,
      evaluator,
      repair,
      repair_attempted: result.repair_attempted,
      repair_status: result.repair_status ?? "not_attempted",
      allowed_statuses: allowedStatuses,
      disallowed_statuses: disallowedStatuses,
      rationale
    };
  }

  const updateStatus = result.packet.misconception_evidence_update.status;
  return {
    case_id: caseId,
    status: result.status,
    schema_version: result.packet.schema_version,
    evaluator_agent_name: result.packet.evaluator_agent_name,
    evaluation_source: result.packet.evaluation_source,
    runtime_servable_to_student: result.packet.runtime_servable_to_student,
    review_only: result.packet.review_only,
    update_status: updateStatus,
    evidence_quality: result.packet.misconception_evidence_update.evidence_quality,
    recommended_next_diagnostic_purpose: result.packet.recommended_next_diagnostic_purpose,
    allowed_statuses: allowedStatuses,
    disallowed_statuses: disallowedStatuses,
    status_allowed: allowedStatuses.includes(updateStatus),
    status_disallowed: disallowedStatuses.includes(updateStatus),
    rationale,
    student_safe_feedback: result.packet.student_safe_feedback,
    repair_attempted: result.repair_attempted,
    repair_status: result.repair_status,
    evaluator,
    repair,
    output_validated: true
  };
}

type LiveSmokeArtifactRow = Record<string, unknown> & {
  case_id?: unknown;
  status?: unknown;
  status_allowed?: unknown;
  status_disallowed?: unknown;
  evaluator?: {
    provider_metadata_present?: boolean;
    token_usage_present?: boolean;
    provider?: string | null;
    call_status?: string;
    output_validated?: boolean;
  };
};

async function writeArtifact(results: LiveSmokeArtifactRow[]) {
  const outputDir = path.join(process.cwd(), ".data", "activity-misconception-evidence-live-smoke");
  await mkdir(outputDir, { recursive: true });
  const artifactPath = path.join(outputDir, `activity-misconception-evidence-live-smoke-${timestampSlug()}.json`);
  const outcome = summarizeActivityMisconceptionEvidenceLiveSmokeOutcome(results);
  await writeFile(
    artifactPath,
    `${JSON.stringify({
      artifact_type: "activity_misconception_evidence_live_smoke",
      artifact_version: ACTIVITY_MISCONCEPTION_EVIDENCE_LIVE_SMOKE_ARTIFACT_VERSION,
      generated_at: new Date().toISOString(),
      no_raw_provider_output_in_artifact: true,
      no_raw_prompts_in_artifact: true,
      no_raw_student_text_in_artifact: true,
      evaluator_schema_version: ACTIVITY_RESPONSE_EVALUATOR_SCHEMA_VERSION,
      packet_schema_version: ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION,
      prompt_version: ACTIVITY_RESPONSE_EVALUATOR_PROMPT_VERSION,
      prompt_hash_present: Boolean(ACTIVITY_RESPONSE_EVALUATOR_PROMPT_HASH),
      ...outcome,
      results
    }, null, 2)}\n`,
    "utf8"
  );

  return artifactPath;
}

function assertLiveSummaryPassed(summary: LiveSmokeArtifactRow) {
  if (summary.status !== "succeeded") {
    throw new Error(`Live activity misconception evidence case failed: ${String(summary.case_id)}`);
  }
  if (summary.status_allowed !== true || summary.status_disallowed === true) {
    throw new Error(`Live activity misconception evidence status mismatch: ${String(summary.case_id)}`);
  }
  if (summary.evaluator?.provider !== "openai") {
    throw new Error(`Live activity misconception evidence case did not use OpenAI provider: ${String(summary.case_id)}`);
  }
  if (summary.evaluator?.call_status !== "succeeded" || summary.evaluator?.output_validated !== true) {
    throw new Error(`Live activity misconception evidence case did not validate output: ${String(summary.case_id)}`);
  }
  if (!summary.evaluator?.provider_metadata_present) {
    throw new Error(`Live activity misconception evidence case lacks provider metadata: ${String(summary.case_id)}`);
  }
  if (!summary.evaluator?.token_usage_present) {
    throw new Error(`Live activity misconception evidence case lacks token usage: ${String(summary.case_id)}`);
  }
}

async function main() {
  if (process.env.RUN_LIVE_ACTIVITY_MISCONCEPTION_EVIDENCE_SMOKE !== "1") {
    console.log(JSON.stringify({
      status: "skipped",
      reason: "RUN_LIVE_ACTIVITY_MISCONCEPTION_EVIDENCE_SMOKE is not set to 1.",
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
    throw new Error("Live activity misconception evidence smoke is not configured. No provider call was made.");
  }

  const summaries: LiveSmokeArtifactRow[] = [];
  for (const entry of liveCases()) {
    const allowedStatuses = ACTIVITY_MISCONCEPTION_EVIDENCE_LIVE_SMOKE_EXPECTED_STATUSES[entry.case_id];
    const result = await executeLiveActivityMisconceptionEvidenceEvaluator({
      evaluation_input: entry.input
    });
    const summary = await resultSummary(
      entry.case_id,
      result,
      allowedStatuses,
      entry.expected_disallowed_statuses,
      entry.rationale
    );
    summaries.push(summary);

    try {
      assertLiveSummaryPassed(summary);
    } catch (error) {
      const artifactPath = await writeArtifact(summaries);
      const outcome = summarizeActivityMisconceptionEvidenceLiveSmokeOutcome(summaries);
      console.log(JSON.stringify({
        status: "failed",
        ...outcome,
        diagnostic_artifact_path: artifactPath,
        failed_case_id: entry.case_id,
        results: summaries
      }, null, 2));
      throw error;
    }
  }

  const artifactPath = await writeArtifact(summaries);
  const outcome = summarizeActivityMisconceptionEvidenceLiveSmokeOutcome(summaries);
  console.log(JSON.stringify({
    status: outcome.overall_status,
    ...outcome,
    artifact_path: artifactPath,
    live_case_count: summaries.length,
    provider_dispatch_count: summaries.length,
    results: summaries
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
