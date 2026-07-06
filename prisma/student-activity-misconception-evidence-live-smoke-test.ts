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
    expected_evidence_focus: "safe misconception evidence from redacted synthetic activity and response summaries only"
  };

  return [
    {
      case_id: "activity_misconception_live_001_conceptual_entry_no_usable_distinction",
      expected_disallowed_statuses: [
        "conceptual_entry_improved",
        "ready_for_distractor_probe",
        "no_actionable_misconception_evidence",
        "independent_evidence_supported",
        "misconception_weakened",
        "misconception_persisted"
      ],
      rationale: "No usable conceptual distinction should remain a conceptual entry gap.",
      input: {
        ...base,
        case_id: "activity_misconception_live_001_conceptual_entry_no_usable_distinction",
        session_public_id: "sess_activity_misconception_live_001",
        activity_attempt_id: "activity_attempt_live_001",
        source_activity_family: "basic_concept_grounding",
        source_diagnostic_purpose: "conceptual_entry_grounding",
        profile_condition: "basic concept distinction is not yet available",
        safe_student_activity_response:
          "Student gives a very short response that does not state a usable distinction between learner ability and question features.",
        response_kind_hint: "partial"
      }
    },
    {
      case_id: "activity_misconception_live_002_conceptual_entry_partial_improvement",
      expected_disallowed_statuses: [
        "ready_for_distractor_probe",
        "no_actionable_misconception_evidence",
        "misconception_persisted",
        "misconception_weakened",
        "misconception_unsupported"
      ],
      rationale:
        "Weak conceptual-entry evidence may remain a gap or show early improvement depending on whether the response contains an emerging distinction.",
      input: {
        ...base,
        case_id: "activity_misconception_live_002_conceptual_entry_partial_improvement",
        session_public_id: "sess_activity_misconception_live_002",
        activity_attempt_id: "activity_attempt_live_002",
        source_activity_family: "basic_concept_grounding",
        source_diagnostic_purpose: "conceptual_entry_grounding",
        profile_condition: "student has an emerging but incomplete distinction after grounding",
        safe_student_activity_response:
          "Student starts to separate learner ability from question features, but the distinction is still incomplete.",
        response_kind_hint: "partial"
      }
    },
    {
      case_id: "activity_misconception_live_003_conceptual_entry_ready_for_probe",
      expected_disallowed_statuses: ["conceptual_entry_gap_remains", "misconception_persisted", "misconception_weakened"],
      rationale: "A strong basic distinction can show conceptual entry improvement or make the next distractor probe appropriate.",
      input: {
        ...base,
        case_id: "activity_misconception_live_003_conceptual_entry_ready_for_probe",
        session_public_id: "sess_activity_misconception_live_003",
        activity_attempt_id: "activity_attempt_live_003",
        source_activity_family: "basic_concept_grounding",
        source_diagnostic_purpose: "conceptual_entry_grounding",
        profile_condition: "student states the basic distinction strongly enough to test a distractor path",
        safe_student_activity_response:
          "Student clearly explains that theta estimates the learner and item parameters describe the question side, and says the tempting alternative mixes those roles.",
        response_kind_hint: "substantive"
      }
    },
    {
      case_id: "activity_misconception_live_004_strong_distractor_boundary",
      expected_disallowed_statuses: ["misconception_persisted", "conceptual_entry_gap_remains"],
      rationale: "Strong distractor contrast should weaken, unsupported, or clear the current targeted hypothesis, not preserve it.",
      input: {
        ...base,
        case_id: "activity_misconception_live_004_strong_distractor_boundary",
        session_public_id: "sess_activity_misconception_live_004",
        activity_attempt_id: "activity_attempt_live_004",
        source_activity_family: "distractor_contrast",
        source_diagnostic_purpose: "distractor_misconception_probe",
        profile_condition: "distractor hypothesis is actively tested",
        safe_student_activity_response:
          "Student explains why the alternative felt tempting, names the hidden assumption, and contrasts it with the target boundary.",
        response_kind_hint: "substantive"
      }
    },
    {
      case_id: "activity_misconception_live_005_partial_distractor_boundary",
      expected_disallowed_statuses: ["no_actionable_misconception_evidence", "misconception_persisted"],
      rationale: "Partial distractor evidence should weaken but not resolve or fully preserve the hypothesis.",
      input: {
        ...base,
        case_id: "activity_misconception_live_005_partial_distractor_boundary",
        session_public_id: "sess_activity_misconception_live_005",
        activity_attempt_id: "activity_attempt_live_005",
        source_activity_family: "distractor_contrast",
        source_diagnostic_purpose: "distractor_misconception_probe",
        profile_condition: "student partly explains the distractor assumption",
        safe_student_activity_response:
          "Student describes why the alternative was tempting and partially names the assumption, but leaves the boundary incomplete.",
        response_kind_hint: "partial"
      }
    },
    {
      case_id: "activity_misconception_live_006_repeats_distractor_logic",
      expected_disallowed_statuses: ["misconception_unsupported", "no_actionable_misconception_evidence"],
      rationale: "Repeated distractor reasoning should preserve the active misconception hypothesis.",
      input: {
        ...base,
        case_id: "activity_misconception_live_006_repeats_distractor_logic",
        session_public_id: "sess_activity_misconception_live_006",
        activity_attempt_id: "activity_attempt_live_006",
        source_activity_family: "distractor_contrast",
        source_diagnostic_purpose: "distractor_misconception_probe",
        profile_condition: "student repeats the distractor logic after contrast",
        safe_student_activity_response:
          "Student explains the tempting alternative using the same hidden assumption and does not separate that assumption from the target idea.",
        response_kind_hint: "substantive"
      }
    },
    {
      case_id: "activity_misconception_live_007_reasoning_boundary_strong",
      expected_disallowed_statuses: ["reasoning_boundary_still_blurred", "misconception_persisted"],
      rationale: "A strong reasoning repair should improve boundary understanding.",
      input: {
        ...base,
        case_id: "activity_misconception_live_007_reasoning_boundary_strong",
        session_public_id: "sess_activity_misconception_live_007",
        activity_attempt_id: "activity_attempt_live_007",
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
      case_id: "activity_misconception_live_008_independent_reconstruction_strong",
      expected_disallowed_statuses: ["insufficient_new_evidence", "misconception_persisted"],
      rationale: "Strong own-words reconstruction should support independent evidence.",
      input: {
        ...base,
        case_id: "activity_misconception_live_008_independent_reconstruction_strong",
        session_public_id: "sess_activity_misconception_live_008",
        activity_attempt_id: "activity_attempt_live_008",
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
      case_id: "activity_misconception_live_009_low_information_understand",
      expected_disallowed_statuses: ["no_actionable_misconception_evidence", "independent_evidence_supported"],
      rationale: "Low-information agreement should remain insufficient new evidence or leave the conceptual entry gap in place.",
      input: {
        ...base,
        case_id: "activity_misconception_live_009_low_information_understand",
        session_public_id: "sess_activity_misconception_live_009",
        activity_attempt_id: "activity_attempt_live_009",
        source_activity_family: "basic_concept_grounding",
        source_diagnostic_purpose: "conceptual_entry_grounding",
        profile_condition: "student provides agreement without explanation",
        safe_student_activity_response: "Student only says they understand now and provides no new concept explanation.",
        response_kind_hint: "low_information"
      }
    },
    {
      case_id: "activity_misconception_live_010_move_on",
      expected_disallowed_statuses: ["insufficient_new_evidence", "misconception_persisted", "no_actionable_misconception_evidence"],
      rationale: "A move-on choice should preserve the choice, not invent diagnostic evidence.",
      input: {
        ...base,
        case_id: "activity_misconception_live_010_move_on",
        session_public_id: "sess_activity_misconception_live_010",
        activity_attempt_id: "activity_attempt_live_010",
        source_activity_family: "distractor_contrast",
        source_diagnostic_purpose: "distractor_misconception_probe",
        profile_condition: "student chooses to stop the current activity",
        safe_student_activity_response: "Student explicitly chooses to move on rather than continue the activity.",
        response_kind_hint: "move_on"
      }
    },
    {
      case_id: "activity_misconception_live_011_choose_other_activity",
      expected_disallowed_statuses: ["misconception_persisted", "boundary_understanding_improved"],
      rationale: "Alternative-activity request should preserve the choice and avoid diagnostic overclaim.",
      input: {
        ...base,
        case_id: "activity_misconception_live_011_choose_other_activity",
        session_public_id: "sess_activity_misconception_live_011",
        activity_attempt_id: "activity_attempt_live_011",
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

function requestedCaseIds() {
  const raw = process.env.ACTIVITY_MISCONCEPTION_EVIDENCE_SMOKE_CASES;
  if (!raw?.trim()) {
    return null;
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function selectedLiveCases() {
  let cases = liveCases();
  const requested = requestedCaseIds();
  if (requested) {
    const knownIds = new Set(cases.map((entry) => entry.case_id));
    const unknown = requested.filter((caseId) => !knownIds.has(caseId));
    if (unknown.length > 0) {
      throw new Error(`Unknown ACTIVITY_MISCONCEPTION_EVIDENCE_SMOKE_CASES entries: ${unknown.join(", ")}`);
    }
    const requestedSet = new Set(requested);
    cases = cases.filter((entry) => requestedSet.has(entry.case_id));
  }

  const maxRaw = process.env.MAX_LIVE_ACTIVITY_MISCONCEPTION_EVIDENCE_CASES;
  if (maxRaw?.trim()) {
    const max = Number(maxRaw);
    if (!Number.isInteger(max) || max <= 0) {
      throw new Error("MAX_LIVE_ACTIVITY_MISCONCEPTION_EVIDENCE_CASES must be a positive integer when set.");
    }
    cases = cases.slice(0, max);
  }

  return cases;
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

function classifyLiveSummary(summary: LiveSmokeArtifactRow) {
  if (summary.status !== "succeeded") {
    return "provider_or_validation_failure" as const;
  }
  if (summary.status_allowed === false || summary.status_disallowed === true) {
    return "outcome_mismatch" as const;
  }
  return "passed" as const;
}

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

  const cases = selectedLiveCases();
  const summaries: LiveSmokeArtifactRow[] = [];
  for (const entry of cases) {
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
    ) as LiveSmokeArtifactRow;
    summary.outcome_classification = classifyLiveSummary(summary);
    summaries.push(summary);

    if (summary.outcome_classification === "provider_or_validation_failure") {
      const artifactPath = await writeArtifact(summaries);
      const outcome = summarizeActivityMisconceptionEvidenceLiveSmokeOutcome(summaries);
      console.log(JSON.stringify({
        status: "failed",
        ...outcome,
        diagnostic_artifact_path: artifactPath,
        failed_case_id: entry.case_id,
        results: summaries
      }, null, 2));
      throw new Error(`Live activity misconception evidence provider/validation failure: ${entry.case_id}.`);
    }
  }

  const artifactPath = await writeArtifact(summaries);
  const outcome = summarizeActivityMisconceptionEvidenceLiveSmokeOutcome(summaries);
  if (outcome.overall_status !== "passed") {
    console.log(JSON.stringify({
      status: "failed",
      ...outcome,
      diagnostic_artifact_path: artifactPath,
      live_case_count: summaries.length,
      provider_dispatch_count: summaries.length,
      case_filter: requestedCaseIds(),
      max_case_count: process.env.MAX_LIVE_ACTIVITY_MISCONCEPTION_EVIDENCE_CASES ?? null,
      results: summaries
    }, null, 2));
    throw new Error("Live activity misconception evidence smoke completed with outcome mismatches.");
  }

  console.log(JSON.stringify({
    status: outcome.overall_status,
    ...outcome,
    artifact_path: artifactPath,
    live_case_count: summaries.length,
    provider_dispatch_count: summaries.length,
    case_filter: requestedCaseIds(),
    max_case_count: process.env.MAX_LIVE_ACTIVITY_MISCONCEPTION_EVIDENCE_CASES ?? null,
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
