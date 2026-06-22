import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { executeAgent } from "../src/lib/agents/execute-agent";
import { buildLlmUnavailableStudentMessage } from "../src/lib/llm/student-message";
import { getLlmUsageSnapshot } from "../src/lib/llm/usage/usage-accounting";
import { checkLlmLiveCallReadiness } from "../src/lib/llm/usage/usage-guard";
import { getTeacherLlmUsageStatus } from "../src/lib/llm/usage/usage-serializers";
import { hashSecret } from "../src/lib/password";
import { generatePublicId } from "../src/lib/services/ids";
import { fixtureInputForAgent } from "./llm-fixtures";

const prisma = new PrismaClient();
const llmEnvKeys = [
  "LLM_PROVIDER",
  "LLM_LIVE_CALLS_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_MODEL_RESPONSE_COLLECTION",
  "LLM_DAILY_CLASS_CALL_LIMIT",
  "LLM_DAILY_CLASS_TOKEN_LIMIT",
  "LLM_DAILY_STUDENT_CALL_LIMIT",
  "LLM_DAILY_STUDENT_TOKEN_LIMIT",
  "LLM_SESSION_CALL_LIMIT",
  "LLM_SESSION_TOKEN_LIMIT",
  "LLM_AGENT_CALL_LIMIT_PER_SESSION",
  "LLM_COST_WARNING_LIMIT_USD",
  "LLM_COST_HARD_LIMIT_USD",
  "LLM_USAGE_TIMEZONE"
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function setEnv(values: Partial<Record<(typeof llmEnvKeys)[number], string>>) {
  for (const key of llmEnvKeys) {
    if (values[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  }
}

function setOpenAiEnv(values: Partial<Record<(typeof llmEnvKeys)[number], string>> = {}) {
  setEnv({
    LLM_PROVIDER: "openai",
    LLM_LIVE_CALLS_ENABLED: "true",
    OPENAI_API_KEY: "placeholder-not-a-real-secret",
    OPENAI_MODEL_RESPONSE_COLLECTION: "synthetic-usage-smoke-model",
    LLM_DAILY_CLASS_CALL_LIMIT: "1000",
    LLM_DAILY_CLASS_TOKEN_LIMIT: "1000000",
    LLM_DAILY_STUDENT_CALL_LIMIT: "1000",
    LLM_DAILY_STUDENT_TOKEN_LIMIT: "1000000",
    LLM_SESSION_CALL_LIMIT: "1000",
    LLM_SESSION_TOKEN_LIMIT: "1000000",
    LLM_AGENT_CALL_LIMIT_PER_SESSION: "1000",
    LLM_COST_WARNING_LIMIT_USD: "",
    LLM_COST_HARD_LIMIT_USD: "",
    LLM_USAGE_TIMEZONE: "UTC",
    ...values
  });
}

async function cleanup(prefix: string, assessmentPublicId?: string) {
  await prisma.agentCall.deleteMany({
    where: { agent_invocation_key: { startsWith: prefix } }
  });

  if (assessmentPublicId) {
    const sessions = await prisma.assessmentSession.findMany({
      where: {
        assessment: {
          assessment_public_id: assessmentPublicId
        }
      },
      select: { id: true }
    });
    const sessionIds = sessions.map((session) => session.id);

    await prisma.workflowOverride.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    await prisma.workflowJob.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    await prisma.assessmentSession.deleteMany({
      where: {
        assessment: {
          assessment_public_id: assessmentPublicId
        }
      }
    });
    await prisma.assessment.deleteMany({
      where: { assessment_public_id: assessmentPublicId }
    });
  }
}

async function ensureDemoUsers() {
  const [teacherPasswordHash, studentAccessCodeHash] = await Promise.all([
    hashSecret("teacher_demo_password"),
    hashSecret("student_demo_access_code")
  ]);
  const teacher = await prisma.user.upsert({
    where: { user_id: "teacher_demo" },
    update: {
      role: "teacher_researcher",
      password_hash: teacherPasswordHash,
      access_code_hash: null
    },
    create: {
      user_id: "teacher_demo",
      role: "teacher_researcher",
      password_hash: teacherPasswordHash
    }
  });
  const student = await prisma.user.upsert({
    where: { user_id: "student_demo" },
    update: {
      role: "student",
      password_hash: null,
      access_code_hash: studentAccessCodeHash
    },
    create: {
      user_id: "student_demo",
      role: "student",
      access_code_hash: studentAccessCodeHash
    }
  });

  return { teacher, student };
}

async function createFixture(prefix: string) {
  const { teacher, student } = await ensureDemoUsers();
  const assessmentPublicId = generatePublicId("assessment");
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: assessmentPublicId,
      title: "LLM usage smoke fixture",
      description: prefix,
      status: "draft",
      created_by_user_db_id: teacher.id
    }
  });
  const session = await prisma.assessmentSession.create({
    data: {
      session_public_id: generatePublicId("session"),
      user_db_id: student.id,
      assessment_db_id: assessment.id,
      status: "active",
      current_phase: "profiling_pending",
      started_at: new Date(),
      last_activity_at: new Date()
    }
  });

  return { assessmentPublicId, session };
}

async function createSyntheticCall(input: {
  prefix: string;
  sessionId?: string | null;
  agentName?: string;
  totalTokens?: number;
  estimatedCost?: Prisma.Decimal | null;
}) {
  const totalTokens = input.totalTokens ?? 10;

  await prisma.agentCall.create({
    data: {
      assessment_session_db_id: input.sessionId ?? null,
      agent_name: input.agentName ?? "response_collection_agent",
      agent_version: "usage-smoke",
      model_name: "synthetic-usage-smoke-model",
      provider: "openai",
      client_request_id: `${input.prefix}_client_${randomUUID()}`,
      agent_invocation_key: `${input.prefix}_${randomUUID()}`,
      prompt_hash: "usage-smoke-prompt-hash",
      prompt_version: "usage-smoke-prompt",
      schema_version: "usage-smoke-schema",
      input_payload: { synthetic: true },
      raw_output: { synthetic: true },
      output_payload: { synthetic: true },
      output_validated: true,
      retry_count: 0,
      call_status: "succeeded",
      live_call_allowed: true,
      input_tokens: Math.floor(totalTokens / 2),
      output_tokens: totalTokens - Math.floor(totalTokens / 2),
      total_tokens: totalTokens,
      estimated_cost: input.estimatedCost ?? null,
      started_at: new Date(),
      completed_at: new Date()
    }
  });
}

async function resetCalls(prefix: string) {
  await prisma.agentCall.deleteMany({
    where: { agent_invocation_key: { startsWith: prefix } }
  });
}

async function main() {
  const prefix = `llm_usage_smoke_${Date.now()}`;
  const originalEnv = Object.fromEntries(llmEnvKeys.map((key) => [key, process.env[key]]));
  const before = {
    profiles: await prisma.studentProfile.count(),
    decisions: await prisma.formativeDecision.count(),
    followups: await prisma.followupRound.count(),
    phaseSnapshot: await prisma.assessmentSession.findMany({
      select: { id: true, current_phase: true },
      orderBy: { id: "asc" }
    })
  };
  let assessmentPublicId: string | undefined;

  try {
    await cleanup(prefix);
    const fixture = await createFixture(prefix);
    assessmentPublicId = fixture.assessmentPublicId;

    setEnv({ LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false", LLM_USAGE_TIMEZONE: "UTC" });
    const providerBlocked = await checkLlmLiveCallReadiness({
      agent_name: "response_collection_agent",
      assessment_session_db_id: fixture.session.id,
      model_configured: true
    });
    assert(!providerBlocked.allowed, "Mock provider should not be live-call ready.");
    assert(providerBlocked.reason === "provider_not_configured", "Missing provider config reason mismatch.");

    setEnv({
      LLM_PROVIDER: "openai",
      LLM_LIVE_CALLS_ENABLED: "false",
      OPENAI_API_KEY: "placeholder-not-a-real-secret",
      OPENAI_MODEL_RESPONSE_COLLECTION: "synthetic-usage-smoke-model",
      LLM_USAGE_TIMEZONE: "UTC"
    });
    const liveDisabled = await checkLlmLiveCallReadiness({
      agent_name: "response_collection_agent",
      assessment_session_db_id: fixture.session.id,
      model_configured: true
    });
    assert(!liveDisabled.allowed, "Live calls disabled should block readiness.");
    assert(liveDisabled.reason === "live_calls_disabled", "Live disabled reason mismatch.");

    setOpenAiEnv({ OPENAI_MODEL_RESPONSE_COLLECTION: "" });
    const modelBlocked = await checkLlmLiveCallReadiness({
      agent_name: "response_collection_agent",
      assessment_session_db_id: fixture.session.id,
      model_configured: false
    });
    assert(!modelBlocked.allowed, "Missing model should block readiness.");
    assert(modelBlocked.reason === "model_not_configured", "Missing model reason mismatch.");

    setOpenAiEnv({ LLM_DAILY_STUDENT_CALL_LIMIT: "2" });
    await createSyntheticCall({ prefix, sessionId: fixture.session.id });
    await createSyntheticCall({ prefix, sessionId: fixture.session.id });
    const studentLimit = await checkLlmLiveCallReadiness({
      agent_name: "response_collection_agent",
      assessment_session_db_id: fixture.session.id,
      model_configured: true
    });
    assert(!studentLimit.allowed, "Student daily call limit should block.");
    assert(studentLimit.reason === "student_daily_call_limit_exceeded", "Student call limit reason mismatch.");
    assert(studentLimit.usage_snapshot.student_daily?.call_count === 2, "Student usage snapshot missing.");

    await resetCalls(prefix);
    setOpenAiEnv({ LLM_SESSION_CALL_LIMIT: "2" });
    await createSyntheticCall({ prefix, sessionId: fixture.session.id });
    await createSyntheticCall({ prefix, sessionId: fixture.session.id });
    const sessionLimit = await checkLlmLiveCallReadiness({
      agent_name: "response_collection_agent",
      assessment_session_db_id: fixture.session.id,
      model_configured: true
    });
    assert(!sessionLimit.allowed, "Session call limit should block.");
    assert(sessionLimit.reason === "session_call_limit_exceeded", "Session call limit reason mismatch.");

    await resetCalls(prefix);
    setOpenAiEnv({ LLM_AGENT_CALL_LIMIT_PER_SESSION: "2" });
    await createSyntheticCall({ prefix, sessionId: fixture.session.id });
    await createSyntheticCall({ prefix, sessionId: fixture.session.id });
    const agentSessionLimit = await checkLlmLiveCallReadiness({
      agent_name: "response_collection_agent",
      assessment_session_db_id: fixture.session.id,
      model_configured: true
    });
    assert(!agentSessionLimit.allowed, "Agent session call limit should block.");
    assert(
      agentSessionLimit.reason === "agent_session_call_limit_exceeded",
      "Agent session limit reason mismatch."
    );

    await resetCalls(prefix);
    setOpenAiEnv({ LLM_DAILY_CLASS_CALL_LIMIT: "2" });
    await createSyntheticCall({ prefix, sessionId: fixture.session.id });
    await createSyntheticCall({ prefix, sessionId: null });
    const classLimit = await checkLlmLiveCallReadiness({
      agent_name: "response_collection_agent",
      assessment_session_db_id: fixture.session.id,
      model_configured: true
    });
    assert(!classLimit.allowed, "Class daily call limit should block.");
    assert(classLimit.reason === "class_daily_call_limit_exceeded", "Class call limit reason mismatch.");

    await resetCalls(prefix);
    setOpenAiEnv({ LLM_DAILY_CLASS_TOKEN_LIMIT: "100" });
    await createSyntheticCall({ prefix, sessionId: fixture.session.id, totalTokens: 100 });
    const tokenLimit = await checkLlmLiveCallReadiness({
      agent_name: "response_collection_agent",
      assessment_session_db_id: fixture.session.id,
      model_configured: true
    });
    assert(!tokenLimit.allowed, "Token limit should block when token usage exists.");
    assert(tokenLimit.reason === "class_daily_token_limit_exceeded", "Token limit reason mismatch.");

    await resetCalls(prefix);
    setOpenAiEnv({ LLM_COST_HARD_LIMIT_USD: "0.01" });
    await createSyntheticCall({ prefix, sessionId: fixture.session.id, totalTokens: 10 });
    const costCheck = await checkLlmLiveCallReadiness({
      agent_name: "response_collection_agent",
      assessment_session_db_id: fixture.session.id,
      model_configured: true
    });
    assert(costCheck.allowed, "Null estimated cost should not falsely trigger hard cost limit.");
    assert(
      costCheck.warnings.includes("cost_limits_configured_but_no_pricing_registry_or_estimated_cost"),
      "Cost unavailable warning should be present."
    );

    await resetCalls(prefix);
    setOpenAiEnv({ LLM_DAILY_STUDENT_CALL_LIMIT: "1" });
    await createSyntheticCall({ prefix, sessionId: fixture.session.id });
    const blockedExecution = await executeAgent({
      agent_name: "response_collection_agent",
      input: fixtureInputForAgent("response_collection_agent"),
      assessment_session_db_id: fixture.session.id,
      agent_invocation_key: `${prefix}_blocked_execute`,
      metadata: {
        smoke_test: "llm_usage",
        data_classification: "synthetic_only"
      }
    });
    assert(
      blockedExecution.status === "blocked_by_usage_limit",
      "executeAgent should return blocked_by_usage_limit without provider call."
    );
    const blockedCall = await prisma.agentCall.findUniqueOrThrow({
      where: { agent_invocation_key: `${prefix}_blocked_execute` }
    });
    assert(blockedCall.provider === "openai", "Blocked audit row should preserve provider.");
    assert(blockedCall.live_call_allowed === false, "Blocked audit row should not allow live call.");
    assert(blockedCall.blocked_reason === "student_daily_call_limit_exceeded", "Blocked reason mismatch.");
    assert(blockedCall.provider_response_id === null, "Blocked call should not have provider response ID.");

    const snapshot = await getLlmUsageSnapshot({
      agent_name: "response_collection_agent",
      assessment_session_db_id: fixture.session.id
    });
    assert(snapshot.window_start && snapshot.window_end, "Usage snapshot should include usage window.");

    const teacherUsage = await getTeacherLlmUsageStatus();
    const teacherJson = JSON.stringify(teacherUsage);
    assert(!/OPENAI_API_KEY|SESSION_SECRET|DATABASE_URL|authorization|cookie|placeholder-not-a-real-secret/i.test(teacherJson), "Teacher usage serializer exposed secret data.");

    const studentMessage = buildLlmUnavailableStudentMessage("student_daily_call_limit_exceeded");
    assert(!/budget|cost|api key|rate limit|provider|OpenAI/i.test(studentMessage), "Student message exposed operational details.");

    assert((await prisma.studentProfile.count()) === before.profiles, "No student profile should be created.");
    assert(
      (await prisma.formativeDecision.count()) === before.decisions,
      "No formative decision should be created."
    );
    assert((await prisma.followupRound.count()) === before.followups, "No follow-up round should be created.");
    const afterPhaseSnapshot = await prisma.assessmentSession.findMany({
      select: { id: true, current_phase: true },
      orderBy: { id: "asc" }
    });
    const afterFixtureRemoved = afterPhaseSnapshot.filter((row) => row.id !== fixture.session.id);
    assert(
      JSON.stringify(afterFixtureRemoved) === JSON.stringify(before.phaseSnapshot),
      "Usage smoke test should not change existing student session phases."
    );

    console.log("LLM usage smoke test passed. No OpenAI call was made.");
  } finally {
    setEnv(originalEnv);
    await cleanup(prefix, assessmentPublicId);
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
