import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  createActivityRuntimeAttemptFromLiveActivityPacket,
  submitStudentActivityResponseForEvidenceUpdate,
  writeActivityRuntimeLoopReview
} from "../src/lib/services/student-assessment/activity-runtime-loop";
import {
  FORMATIVE_ACTIVITY_AGENT_NAME,
  FormativeActivityPacketV1Schema,
  buildFormativeActivityDesignPacketFromPackets,
  type FormativeActivityFamily
} from "../src/lib/services/student-assessment/formative-activity-design";
import { prisma } from "../src/lib/db";
import { envPresent } from "./student-formative-value-helpers";
import { buildSyntheticActivitySourcePackets } from "./student-formative-activity-fixtures";
import { assert } from "./student-mvp-smoke-helpers";

const envLoadResult = loadEnvConfig(process.cwd());
const REQUIRED_DATABASE_ENV = ["DATABASE_URL", "SESSION_SECRET"] as const;
const REQUIRED_PROVIDER_ENV = ["LLM_PROVIDER", "LLM_LIVE_CALLS_ENABLED"] as const;
const MODEL_ENV_OPTIONS = [
  "OPENAI_MODEL_PROFILE_INTEGRATION",
  "OPENAI_MODEL_PLANNING",
  "OPENAI_MODEL_FOLLOWUP"
] as const;

type RuntimeLiveCase = {
  case_id: string;
  expected_family: FormativeActivityFamily;
  source: Parameters<typeof buildSyntheticActivitySourcePackets>[0];
  student_response_text: string;
  student_choice_state: "continue" | "choose_another_activity" | "move_on";
  pre_activity_diagnostic_state: string;
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

function liveCases(runSlug: string): RuntimeLiveCase[] {
  return [
    {
      case_id: "activity_runtime_loop_live_001_conceptual_entry_partial_distinction",
      expected_family: "basic_concept_grounding",
      source: {
        pattern: "likely_knowledge_gap",
        primary_value: "diagnostic_clarification",
        session_public_id: `sess_activity_runtime_loop_live_001_${runSlug}`,
        student_choice: "accepted_recommendation"
      },
      student_response_text:
        "The student says theta is about the learner while item difficulty and information are features of the question, but the explanation is still brief.",
      student_choice_state: "continue",
      pre_activity_diagnostic_state: "conceptual_entry_gap"
    },
    {
      case_id: "activity_runtime_loop_live_002_distractor_probe_strong_response",
      expected_family: "distractor_contrast",
      source: {
        pattern: "likely_misconception",
        primary_value: "diagnostic_clarification",
        session_public_id: `sess_activity_runtime_loop_live_002_${runSlug}`,
        student_choice: "accepted_recommendation"
      },
      student_response_text:
        "The student explains why the tempting alternative can feel plausible, names the hidden assumption, and contrasts it with the target boundary.",
      student_choice_state: "continue",
      pre_activity_diagnostic_state: "suspected_distractor_linked_misconception"
    }
  ];
}

function buildLiveActivityPacket(entry: RuntimeLiveCase) {
  const source = buildSyntheticActivitySourcePackets(entry.source);
  const packet = buildFormativeActivityDesignPacketFromPackets({
    profile_integration_packet: source.profile,
    formative_value_packet: source.formative
  });
  const livePacket = FormativeActivityPacketV1Schema.parse({
    ...packet,
    generation_source: "live_llm",
    runtime_servable_to_student: true,
    review_only: false
  });
  assert(
    livePacket.activity_family === entry.expected_family,
    `${entry.case_id}: expected ${entry.expected_family}, got ${livePacket.activity_family}.`
  );
  return livePacket;
}

async function createSyntheticSourceActivityAgentCall(entry: RuntimeLiveCase) {
  return prisma.agentCall.create({
    data: {
      agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
      agent_version: "formative-activity-dialogue-v1",
      model_name: "synthetic-live-shaped-formative-activity-source",
      provider: "openai",
      provider_request_id: `req_activity_runtime_loop_source_${entry.case_id}`,
      provider_response_id: `resp_activity_runtime_loop_source_${entry.case_id}`,
      client_request_id: `client_activity_runtime_loop_source_${entry.case_id}`,
      prompt_version: "formative-activity-dialogue-prompt-v1",
      schema_version: "student-formative-activity-v1",
      input_payload: { live_smoke_source: true, redacted: true },
      raw_output: { live_smoke_source: true, redacted: true },
      output_payload: { live_smoke_source: true, redacted: true },
      output_validated: true,
      live_call_allowed: true,
      call_status: "succeeded",
      input_tokens: 8,
      output_tokens: 13,
      total_tokens: 21,
      token_usage: { input_tokens: 8, output_tokens: 13, total_tokens: 21 },
      started_at: new Date(),
      completed_at: new Date()
    }
  });
}

function protectedArtifactPattern() {
  return /answer key|correct option|correct answer|raw provider output|raw prompt|api key|authorization header|bearer token|session secret|database url|mis_[a-z0-9_]+/i;
}

async function writeArtifact(input: {
  run_slug: string;
  status: "passed" | "failed";
  case_results: unknown[];
  review_artifact_paths: string[];
  profile_count_before: number;
  profile_count_after: number;
  response_package_count_before: number;
  response_package_count_after: number;
  failure_reason?: string;
}) {
  const outputDir = path.join(process.cwd(), ".data", "activity-runtime-loop-live-smoke");
  await mkdir(outputDir, { recursive: true });
  const artifactPath = path.join(outputDir, `activity-runtime-loop-live-smoke-${input.run_slug}.json`);
  const artifact = {
    artifact_type: "activity_runtime_loop_live_smoke",
    artifact_version: "activity-runtime-loop-live-smoke-v1",
    generated_at: new Date().toISOString(),
    status: input.status,
    failure_reason: input.failure_reason ?? null,
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
  assert(!protectedArtifactPattern().test(serialized), "Runtime loop live smoke artifact contains protected content.");
  return artifactPath;
}

async function processCase(entry: RuntimeLiveCase) {
  const sourceCall = await createSyntheticSourceActivityAgentCall(entry);
  const packet = buildLiveActivityPacket(entry);
  const attempt = await createActivityRuntimeAttemptFromLiveActivityPacket({
    activity_packet: packet,
    first_turn_agent_call_db_id: sourceCall.id,
    limitations: ["synthetic_live_smoke_activity_attempt_source_packet"]
  });
  const result = await submitStudentActivityResponseForEvidenceUpdate({
    activity_attempt_public_id: attempt.activity_attempt_public_id,
    session_public_id: attempt.session_public_id,
    student_response_text: entry.student_response_text,
    student_choice_state: entry.student_choice_state,
    pre_activity_diagnostic_state: entry.pre_activity_diagnostic_state
  });
  const review = await writeActivityRuntimeLoopReview({
    session_public_id: attempt.session_public_id
  });

  return {
    case_id: entry.case_id,
    status: result.status,
    runtime_state: result.runtime_state,
    next_runtime_recommendation: result.next_runtime_recommendation,
    evidence_record_public_id: result.evidence_record_public_id,
    snapshot_public_id: result.post_activity_snapshot_public_id,
    student_safe_feedback_present: Boolean(result.student_safe_feedback.message),
    student_safe_next_options: result.student_safe_feedback.next_options,
    review_summary: {
      runtime_attempt_count: review.runtime_attempt_count,
      evidence_record_count: review.evidence_record_count,
      snapshot_count: review.snapshot_count,
      artifact_path: review.artifact_path
    }
  };
}

async function main() {
  if (process.env.RUN_LIVE_ACTIVITY_RUNTIME_LOOP_SMOKE !== "1") {
    console.log(JSON.stringify({
      status: "skipped",
      reason: "RUN_LIVE_ACTIVITY_RUNTIME_LOOP_SMOKE is not set to 1.",
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
    throw new Error("Live activity runtime loop smoke is not configured. No provider call was made.");
  }

  const runSlug = timestampSlug();
  const profileCountBefore = await prisma.studentProfile.count();
  const responsePackageCountBefore = await prisma.responsePackage.count();
  const caseResults = [];
  const reviewArtifactPaths: string[] = [];

  for (const entry of liveCases(runSlug)) {
    const result = await processCase(entry);
    caseResults.push(result);
    reviewArtifactPaths.push(result.review_summary.artifact_path);
    if (result.status !== "ok") {
      const artifactPath = await writeArtifact({
        run_slug: runSlug,
        status: "failed",
        case_results: caseResults,
        review_artifact_paths: reviewArtifactPaths,
        profile_count_before: profileCountBefore,
        profile_count_after: await prisma.studentProfile.count(),
        response_package_count_before: responsePackageCountBefore,
        response_package_count_after: await prisma.responsePackage.count(),
        failure_reason: `${entry.case_id}:${result.status}`
      });
      console.log(JSON.stringify({
        status: "failed",
        artifact_path: artifactPath,
        results: caseResults
      }, null, 2));
      throw new Error(`Live activity runtime loop smoke failed for ${entry.case_id}.`);
    }
  }

  const profileCountAfter = await prisma.studentProfile.count();
  const responsePackageCountAfter = await prisma.responsePackage.count();
  const artifactPath = await writeArtifact({
    run_slug: runSlug,
    status: "passed",
    case_results: caseResults,
    review_artifact_paths: reviewArtifactPaths,
    profile_count_before: profileCountBefore,
    profile_count_after: profileCountAfter,
    response_package_count_before: responsePackageCountBefore,
    response_package_count_after: responsePackageCountAfter
  });

  console.log(JSON.stringify({
    status: "passed",
    artifact_path: artifactPath,
    live_case_count: caseResults.length,
    persisted_count: caseResults.filter((result) => result.evidence_record_public_id).length,
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
