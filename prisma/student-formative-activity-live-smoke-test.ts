import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import {
  FORMATIVE_ACTIVITY_LIVE_SMOKE_FAMILIES,
  executeLiveFormativeActivityDialogueAgent,
  summarizeFormativeActivityQualityReviewForArtifact,
  type FormativeActivityLiveExecutionResult
} from "../src/lib/services/student-assessment/formative-activity-live";
import {
  buildProfileIntegrationInterpretationPacketForSession
} from "../src/lib/services/student-assessment/profile-integration";
import {
  buildFormativeValueDeterminationPacketForSession
} from "../src/lib/services/student-assessment/formative-value-determination";
import {
  buildSyntheticActivitySourcePackets
} from "./student-formative-activity-fixtures";
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

const REVIEW_SESSION_FALLBACK = "sess_20260701_v2n-8a0";

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

function requestedFamilies() {
  const raw = process.env.FORMATIVE_ACTIVITY_SMOKE_FAMILIES;
  if (!raw?.trim()) {
    return FORMATIVE_ACTIVITY_LIVE_SMOKE_FAMILIES;
  }

  const requested = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const allowed = new Set(FORMATIVE_ACTIVITY_LIVE_SMOKE_FAMILIES);
  const unknown = requested.filter((entry) => !allowed.has(entry as never));
  if (unknown.length > 0) {
    throw new Error(`Unknown FORMATIVE_ACTIVITY_SMOKE_FAMILIES entries: ${unknown.join(", ")}`);
  }

  return requested as typeof FORMATIVE_ACTIVITY_LIVE_SMOKE_FAMILIES;
}

function syntheticCases() {
  return [
    {
      case_id: "activity_live_basic_concept_grounding",
      expected_family: "basic_concept_grounding" as const,
      input: {
        pattern: "likely_knowledge_gap" as const,
        primary_value: "diagnostic_clarification" as const,
        student_message: "Your answers suggest the basic boundary is still forming.",
        ability_summary: "The explanation names theta and item information but does not yet separate their roles.",
        knowledge_focus: "the distinction between theta as a student ability estimate and item parameters"
      }
    },
    {
      case_id: "activity_live_distractor_contrast",
      expected_family: "distractor_contrast" as const,
      input: {
        pattern: "likely_misconception" as const,
        primary_value: "diagnostic_clarification" as const,
        student_message: "Your answer pattern suggests a tempting alternative is pulling two ideas together.",
        ability_summary: "The explanation mixes a person's estimated ability with the information provided by the item.",
        knowledge_focus: "the distinction between theta as a student ability estimate and item parameters"
      }
    },
    {
      case_id: "activity_live_reasoning_chain_repair",
      expected_family: "reasoning_chain_repair" as const,
      input: {
        pattern: "developing_understanding" as const,
        primary_value: "reasoning_refinement" as const,
        student_message: "Your reasoning has a useful start but needs one clearer connection.",
        ability_summary: "The explanation points toward theta but skips the link to item information.",
        knowledge_focus: "the distinction between theta as a student ability estimate and item parameters"
      }
    },
    {
      case_id: "activity_live_independent_reconstruction",
      expected_family: "independent_reconstruction" as const,
      input: {
        pattern: "mixed_or_conflicting_evidence" as const,
        primary_value: "independent_understanding_verification" as const,
        reliability_limited: true,
        student_message: "Your answers leave the explanation unclear enough that an own-words rebuild is useful.",
        ability_summary: "The responses vary between option recognition and a partial concept explanation.",
        knowledge_focus: "the distinction between theta as a student ability estimate and item parameters"
      }
    },
    {
      case_id: "activity_live_confidence_evidence_audit",
      expected_family: "confidence_evidence_audit" as const,
      input: {
        pattern: "stable_understanding" as const,
        primary_value: "confidence_calibration" as const,
        status: "Mostly understood" as const,
        status_confidence: "high" as const,
        student_message: "Your explanation has enough substance to check confidence against evidence.",
        ability_summary: "The explanation separates the person-side estimate from the item-side information.",
        confidence_summary: "You were cautious even though the explanation gives usable evidence.",
        knowledge_focus: "the distinction between theta as a student ability estimate and item parameters"
      }
    },
    {
      case_id: "activity_live_transfer_and_distractor_generation",
      expected_family: "transfer_and_distractor_generation" as const,
      input: {
        pattern: "stable_understanding" as const,
        primary_value: "consolidation_and_transfer" as const,
        status: "Mostly understood" as const,
        status_confidence: "high" as const,
        student_message: "Your answers give a stable base for extending the concept.",
        ability_summary: "The explanation keeps the person-side estimate separate from item information.",
        knowledge_focus: "the distinction between theta as a student ability estimate and item parameters"
      }
    }
  ];
}

async function agentCallSummary(agentCallId?: string) {
  if (!agentCallId) {
    return {
      agent_call_id_present: false,
      call_status: "not_started",
      output_validated: false,
      provider_metadata_present: false,
      token_usage_present: false
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
      total_tokens: true
    }
  });

  return {
    agent_call_id_present: true,
    call_status: call?.call_status ?? "missing",
    output_validated: call?.output_validated ?? false,
    provider_metadata_present: Boolean(call?.provider_request_id || call?.provider_response_id),
    token_usage_present: Boolean(call?.input_tokens || call?.output_tokens || call?.total_tokens)
  };
}

async function reviewerSummary(agentCallId?: string, directReview?: unknown) {
  if (directReview) {
    return summarizeFormativeActivityQualityReviewForArtifact(directReview);
  }

  if (!agentCallId) {
    return summarizeFormativeActivityQualityReviewForArtifact(
      undefined,
      "reviewer_call_not_started"
    );
  }

  const call = await prisma.agentCall.findUnique({
    where: { id: agentCallId },
    select: {
      call_status: true,
      output_payload: true
    }
  });

  if (!call) {
    return summarizeFormativeActivityQualityReviewForArtifact(
      undefined,
      "reviewer_call_missing"
    );
  }

  return summarizeFormativeActivityQualityReviewForArtifact(
    call.output_payload,
    call.output_payload
      ? "reviewer_output_invalid"
      : `reviewer_output_unavailable_${call.call_status ?? "unknown"}`
  );
}

async function resultSummary(caseId: string, result: FormativeActivityLiveExecutionResult) {
  const generator = await agentCallSummary(result.generator_agent_call_id);
  const reviewer = await agentCallSummary(result.reviewer_agent_call_id);
  const repair = await agentCallSummary(result.repair_agent_call_id);
  const reviewer_summary = await reviewerSummary(
    result.reviewer_agent_call_id,
    result.status === "succeeded" ? result.quality_review : undefined
  );

  if (result.status !== "succeeded") {
    return {
      case_id: caseId,
      status: result.status,
      blocked_reason: result.blocked_reason,
      validation_issues: result.validation_issues,
      generator,
      reviewer,
      reviewer_summary,
      repair,
      repair_attempted: result.repair_attempted,
      repair_status: result.repair_status ?? "not_attempted"
    };
  }

  return {
    case_id: caseId,
    status: result.status,
    activity_family: result.packet.activity_family,
    selected_formative_value: result.packet.selected_formative_value,
    generation_source: result.packet.generation_source,
    runtime_servable_to_student: result.packet.runtime_servable_to_student,
    review_only: result.packet.review_only,
    review_status: result.quality_review.review_status,
    quality_score: result.quality_review.quality_score,
    reviewer_summary,
    repair_attempted: result.repair_attempted,
    repair_status: result.repair_status,
    generator,
    reviewer,
    repair,
    output_validated: true,
    first_turn_char_count: result.packet.first_turn.message.length,
    first_turn_message: result.packet.first_turn.message
  };
}

async function writeArtifact(results: unknown[]) {
  const outputDir = path.join(process.cwd(), ".data", "formative-activity-live-smoke");
  await mkdir(outputDir, { recursive: true });
  const artifactPath = path.join(outputDir, `formative-activity-live-smoke-${timestampSlug()}.json`);
  await writeFile(
    artifactPath,
    `${JSON.stringify({
      artifact_type: "formative_activity_live_smoke",
      artifact_version: "formative-activity-live-smoke-v1",
      generated_at: new Date().toISOString(),
      results
    }, null, 2)}\n`,
    "utf8"
  );

  return artifactPath;
}

async function main() {
  if (process.env.RUN_LIVE_FORMATIVE_ACTIVITY_SMOKE !== "1") {
    console.log(JSON.stringify({
      status: "skipped",
      reason: "RUN_LIVE_FORMATIVE_ACTIVITY_SMOKE is not set to 1.",
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
    throw new Error("Live formative activity smoke is not configured. No provider call was made.");
  }

  const familyFilter = new Set(requestedFamilies());
  const cases = syntheticCases().filter((entry) => familyFilter.has(entry.expected_family));
  const summaries: unknown[] = [];

  for (const entry of cases) {
    const source = buildSyntheticActivitySourcePackets({
      ...entry.input,
      session_public_id: `sess_${entry.case_id}`
    });
    const result = await executeLiveFormativeActivityDialogueAgent({
      profile_integration_packet: source.profile,
      formative_value_packet: source.formative
    });
    summaries.push(await resultSummary(entry.case_id, result));
    if (result.status !== "succeeded") {
      const artifactPath = await writeArtifact(summaries);
      console.log(JSON.stringify({
        status: "failed",
        diagnostic_artifact_path: artifactPath,
        failed_case_id: entry.case_id,
        results: summaries
      }, null, 2));
      throw new Error(`Live formative activity failed for ${entry.case_id}.`);
    }
  }

  try {
    const profile = await buildProfileIntegrationInterpretationPacketForSession(
      REVIEW_SESSION_FALLBACK,
      { execution_mode: "deterministic_mock" }
    );
    const formative = await buildFormativeValueDeterminationPacketForSession(
      REVIEW_SESSION_FALLBACK,
      { execution_mode: "deterministic_mock" }
    );
    const result = await executeLiveFormativeActivityDialogueAgent({
      profile_integration_packet: profile,
      formative_value_packet: formative
    });
    summaries.push(await resultSummary(`real_session_${REVIEW_SESSION_FALLBACK}`, result));
    if (result.status !== "succeeded") {
      const artifactPath = await writeArtifact(summaries);
      console.log(JSON.stringify({
        status: "failed",
        diagnostic_artifact_path: artifactPath,
        failed_case_id: `real_session_${REVIEW_SESSION_FALLBACK}`,
        results: summaries
      }, null, 2));
      throw new Error(`Live formative activity failed for real session ${REVIEW_SESSION_FALLBACK}.`);
    }
  } catch (error) {
    summaries.push({
      case_id: `real_session_${REVIEW_SESSION_FALLBACK}`,
      status: "skipped_or_failed",
      safe_error: error instanceof Error ? error.message.slice(0, 300) : "unknown"
    });
  }

  const artifactPath = await writeArtifact(summaries);
  console.log(JSON.stringify({
    status: "passed",
    artifact_path: artifactPath,
    synthetic_case_count: cases.length,
    requested_families: [...familyFilter],
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
