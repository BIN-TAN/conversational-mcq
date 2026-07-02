import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import {
  FORMATIVE_VALUE_AGENT_NAME,
  buildFormativeValueAgentInput,
  executeLiveFormativeValueDeterminationAgent,
  validateFormativeValueDeterminationOutput
} from "../src/lib/services/student-assessment/formative-value-determination";
import {
  buildProfileIntegrationInterpretationPacketForSession
} from "../src/lib/services/student-assessment/profile-integration";
import {
  createFormativeValueSampleSession,
  envPresent,
  restoreEnvValue
} from "./student-formative-value-helpers";
import { assert } from "./student-mvp-smoke-helpers";

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

function parseValidationError(value: string | null) {
  if (!value) {
    return {
      issue_count: 0,
      issues: [] as Array<{ field_path: string; rule_code: string; blocked_pattern_label?: string }>
    };
  }

  try {
    const parsed = JSON.parse(value) as {
      issue_count?: unknown;
      issues?: Array<Record<string, unknown>>;
    };
    return {
      issue_count: typeof parsed.issue_count === "number" ? parsed.issue_count : 0,
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.map((issue) => ({
            field_path: typeof issue.field_path === "string" ? issue.field_path : "",
            rule_code: typeof issue.rule_code === "string" ? issue.rule_code : "",
            ...(typeof issue.blocked_pattern_label === "string"
              ? { blocked_pattern_label: issue.blocked_pattern_label }
              : {})
          }))
        : []
    };
  } catch {
    return {
      issue_count: 1,
      issues: [{
        field_path: "validation_error",
        rule_code: "unparsed_validation_error"
      }]
    };
  }
}

async function formativeValueAuditSummaries(sessionPublicId: string) {
  const session = await prisma.assessmentSession.findUnique({
    where: { session_public_id: sessionPublicId },
    select: { id: true }
  });

  if (!session) {
    return [];
  }

  const calls = await prisma.agentCall.findMany({
    where: {
      assessment_session_db_id: session.id,
      agent_name: FORMATIVE_VALUE_AGENT_NAME
    },
    orderBy: [{ created_at: "asc" }],
    select: {
      id: true,
      agent_name: true,
      schema_version: true,
      provider: true,
      client_request_id: true,
      call_status: true,
      output_validated: true,
      validation_error: true,
      provider_request_id: true,
      provider_response_id: true,
      input_tokens: true,
      output_tokens: true,
      total_tokens: true,
      created_at: true,
      completed_at: true
    }
  });

  return calls.map((call) => {
    const validation = parseValidationError(call.validation_error);

    return {
      agent_call_id: call.id,
      agent_name: call.agent_name,
      schema_version: call.schema_version,
      provider: call.provider,
      client_request_id_present: Boolean(call.client_request_id),
      call_status: call.call_status,
      output_validated: call.output_validated,
      validation_issue_count: validation.issue_count,
      validation_issues: validation.issues,
      provider_metadata_present: Boolean(call.provider_request_id || call.provider_response_id),
      token_usage_present: Boolean(call.input_tokens || call.output_tokens || call.total_tokens),
      failure_stage:
        call.call_status === "invalid_output"
          ? "formative_value_validation"
          : call.call_status === "failed"
            ? "provider_execution"
            : call.output_validated
              ? "validated"
              : "unknown",
      created_at: call.created_at.toISOString(),
      completed_at: call.completed_at?.toISOString() ?? null
    };
  });
}

async function writeFailureArtifact(input: {
  session_public_id: string;
  error_message: string;
  agent_calls: Awaited<ReturnType<typeof formativeValueAuditSummaries>>;
}) {
  const outputDir = path.join(process.cwd(), ".data", "formative-value-live-smoke", "failures");
  const outputPath = path.join(
    outputDir,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${input.session_public_id}.json`
  );

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({
      artifact_type: "formative_value_live_smoke_failure",
      artifact_version: "formative-value-live-smoke-failure-v1",
      session_public_id: input.session_public_id,
      error_message: input.error_message.slice(0, 500),
      agent_calls: input.agent_calls
    }, null, 2)}\n`,
    "utf8"
  );

  return outputPath;
}

async function createSampleSessionWithMockSetup() {
  const liveEnvSnapshot = {
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_LIVE_CALLS_ENABLED: process.env.LLM_LIVE_CALLS_ENABLED,
    ITEM_ADMIN_TUTOR_MODE: process.env.ITEM_ADMIN_TUTOR_MODE,
    ALLOW_LOCAL_MOCK_RUNTIME: process.env.ALLOW_LOCAL_MOCK_RUNTIME
  };

  const sample = await createFormativeValueSampleSession(prisma);

  restoreEnvValue("LLM_PROVIDER", liveEnvSnapshot.LLM_PROVIDER);
  restoreEnvValue("LLM_LIVE_CALLS_ENABLED", liveEnvSnapshot.LLM_LIVE_CALLS_ENABLED);
  restoreEnvValue("ITEM_ADMIN_TUTOR_MODE", liveEnvSnapshot.ITEM_ADMIN_TUTOR_MODE);
  restoreEnvValue("ALLOW_LOCAL_MOCK_RUNTIME", liveEnvSnapshot.ALLOW_LOCAL_MOCK_RUNTIME);

  return sample;
}

async function main() {
  if (process.env.RUN_LIVE_FORMATIVE_VALUE_SMOKE !== "1") {
    console.log(JSON.stringify({
      status: "skipped",
      reason: "RUN_LIVE_FORMATIVE_VALUE_SMOKE is not set to 1.",
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
    throw new Error("Live formative value smoke is not configured. No provider call was made.");
  }

  const sample = await createSampleSessionWithMockSetup();

  try {
    const profilePacket = await buildProfileIntegrationInterpretationPacketForSession(
      sample.session_public_id,
      { execution_mode: "deterministic_mock" }
    );
    const agentInput = buildFormativeValueAgentInput({
      profile_integration_packet: profilePacket
    });
    const liveResult = await executeLiveFormativeValueDeterminationAgent({
      agent_input: agentInput,
      session_public_id: sample.session_public_id
    });

    if (liveResult.status !== "succeeded") {
      const agentCalls = await formativeValueAuditSummaries(sample.session_public_id);
      const artifactPath = await writeFailureArtifact({
        session_public_id: sample.session_public_id,
        error_message: liveResult.blocked_reason,
        agent_calls: agentCalls
      });
      console.log(JSON.stringify({
        status: "failed",
        diagnostic_artifact_path: artifactPath,
        session_public_id: sample.session_public_id,
        blocked_reason: liveResult.blocked_reason,
        validation_issue_count: liveResult.validation_issues.length,
        validation_issues: liveResult.validation_issues,
        agent_calls: agentCalls
      }, null, 2));
      throw new Error(`Live formative value determination failed: ${liveResult.blocked_reason}`);
    }

    const validation = validateFormativeValueDeterminationOutput(liveResult.packet);
    if (!validation.valid) {
      const agentCalls = await formativeValueAuditSummaries(sample.session_public_id);
      const artifactPath = await writeFailureArtifact({
        session_public_id: sample.session_public_id,
        error_message: `Live formative value packet failed validation with ${validation.issues.length} issues.`,
        agent_calls: agentCalls
      });
      console.log(JSON.stringify({
        status: "failed",
        diagnostic_artifact_path: artifactPath,
        session_public_id: sample.session_public_id,
        validation_issue_count: validation.issues.length,
        validation_issues: validation.issues,
        agent_calls: agentCalls
      }, null, 2));
      throw new Error("Live formative value packet failed validation.");
    }

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: sample.session_public_id },
      select: { id: true }
    });
    const agentCall = await prisma.agentCall.findFirstOrThrow({
      where: {
        assessment_session_db_id: session.id,
        agent_name: FORMATIVE_VALUE_AGENT_NAME
      },
      orderBy: [{ created_at: "desc" }],
      select: {
        id: true,
        provider: true,
        call_status: true,
        output_validated: true,
        provider_request_id: true,
        provider_response_id: true,
        input_tokens: true,
        output_tokens: true,
        total_tokens: true
      }
    });

    assert(agentCall.provider === "openai", "Live formative value should use the OpenAI provider.");
    assert(agentCall.call_status === "succeeded", "Live formative value agent call should succeed.");
    assert(agentCall.output_validated, "Live formative value output should validate.");
    assert(
      Boolean(agentCall.provider_request_id || agentCall.provider_response_id),
      "Live formative value provider metadata should be audited."
    );

    console.log(JSON.stringify({
      status: "passed",
      session_public_id: sample.session_public_id,
      primary_value: liveResult.packet.primary_value,
      primary_value_confidence: liveResult.packet.primary_value_confidence,
      alternative_count: liveResult.packet.alternative_values.length,
      formative_value_call_status: agentCall.call_status,
      formative_value_output_validated: agentCall.output_validated,
      provider_metadata_present: Boolean(agentCall.provider_request_id || agentCall.provider_response_id),
      token_usage_present: Boolean(agentCall.input_tokens || agentCall.output_tokens || agentCall.total_tokens)
    }, null, 2));
  } finally {
    await sample.cleanup();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
