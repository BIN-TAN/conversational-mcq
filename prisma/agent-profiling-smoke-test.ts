import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { StudentProfileOutput } from "../src/lib/agents/contracts";
import { buildInitialStudentProfilingInput } from "../src/lib/agents/student-profiling/input-builder";
import { runInitialStudentProfiling } from "../src/lib/agents/student-profiling/service";
import { serializeStudentProfileForStudent } from "../src/lib/agents/student-profiling/serializers";
import { getStudentSessionState } from "../src/lib/services/student-assessment/service";
import { assertStudentPayloadIsSafe } from "../src/lib/services/student-assessment/serializers";
import { getTeacherReviewSessionDetail } from "../src/lib/services/teacher-review/session-detail";
import { hashSecret } from "../src/lib/password";
import { generatePublicId } from "../src/lib/services/ids";
import { createResponsePackage } from "../src/lib/services/response-packages";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

const prisma = new PrismaClient();
const port = 3216;
const baseUrl = `http://localhost:${port}`;
const llmEnvKeys = [
  "LLM_PROVIDER",
  "LLM_LIVE_CALLS_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_MODEL_PROFILING",
  "LLM_DAILY_STUDENT_CALL_LIMIT",
  "LLM_DAILY_STUDENT_TOKEN_LIMIT",
  "LLM_DAILY_CLASS_CALL_LIMIT",
  "LLM_DAILY_CLASS_TOKEN_LIMIT",
  "LLM_SESSION_CALL_LIMIT",
  "LLM_SESSION_TOKEN_LIMIT",
  "LLM_AGENT_CALL_LIMIT_PER_SESSION",
  "LLM_USAGE_TIMEZONE"
] as const;

type Fixture = Awaited<ReturnType<typeof createProfilingFixture>>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function minutesAfter(base: Date, minutes: number) {
  return new Date(base.getTime() + minutes * 60_000);
}

function setEnv(values: Partial<Record<(typeof llmEnvKeys)[number], string | undefined>>) {
  for (const key of llmEnvKeys) {
    if (values[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  }
}

function assertNoForbiddenSerializedFields(value: unknown, label: string) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    "password_hash",
    "access_code_hash",
    "session_cookie",
    "authorization_header",
    "api_key",
    "database_url",
    "session_secret",
    "_db_id",
    "\"id\""
  ];

  for (const field of forbidden) {
    assert(!serialized.toLowerCase().includes(field), `${label} leaked ${field}.`);
  }
}

async function cleanup(prefix: string, fixture?: Fixture) {
  const assessmentIds = fixture
    ? [fixture.assessment.id]
    : (
        await prisma.assessment.findMany({
          where: { title: { startsWith: prefix } },
          select: { id: true }
        })
      ).map((assessment) => assessment.id);

  if (assessmentIds.length > 0) {
    const sessions = await prisma.assessmentSession.findMany({
      where: { assessment_db_id: { in: assessmentIds } },
      select: { id: true }
    });
    const sessionIds = sessions.map((session) => session.id);
    const conceptUnitSessions = await prisma.conceptUnitSession.findMany({
      where: { assessment_session_db_id: { in: sessionIds } },
      select: { id: true }
    });
    const conceptUnitSessionIds = conceptUnitSessions.map((session) => session.id);

    await prisma.conceptUnitSession.updateMany({
      where: { id: { in: conceptUnitSessionIds } },
      data: {
        latest_student_profile_db_id: null,
        latest_formative_decision_db_id: null
      }
    });
    await prisma.followupRound.deleteMany({
      where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
    });
    await prisma.formativeDecision.deleteMany({
      where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
    });
    await prisma.studentProfile.deleteMany({
      where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
    });
    await prisma.responsePackage.deleteMany({
      where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
    });
    await prisma.workflowOverride.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    await prisma.workflowJob.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    await prisma.agentCall.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    await prisma.processEvent.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    await prisma.conversationTurn.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    await prisma.itemResponse.deleteMany({
      where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
    });
    await prisma.conceptUnitSession.deleteMany({
      where: { id: { in: conceptUnitSessionIds } }
    });
    await prisma.assessmentSession.deleteMany({
      where: { id: { in: sessionIds } }
    });
    await prisma.item.deleteMany({
      where: { concept_unit: { assessment_db_id: { in: assessmentIds } } }
    });
    await prisma.conceptUnit.deleteMany({
      where: { assessment_db_id: { in: assessmentIds } }
    });
    await prisma.assessment.deleteMany({
      where: { id: { in: assessmentIds } }
    });
  }

  await prisma.user.deleteMany({
    where: {
      user_id: {
        startsWith: prefix
      }
    }
  });
}

function itemSeed(itemOrder: number) {
  return {
    item_order: itemOrder,
    item_stem: `Profiling smoke item ${itemOrder}`,
    options: [
      { label: "A", text: "Best-supported answer" },
      { label: "B", text: "Partial distractor" },
      { label: "C", text: "Misconception distractor" }
    ],
    correct_option: "A",
    distractor_rationales: {
      B: "B reflects a partially correct but incomplete relationship.",
      C: "C reflects a plausible misconception about the target concept."
    },
    expected_reasoning_patterns: [
      "Connects the selected option to evidence in the item stem."
    ],
    possible_misconception_indicators: [
      "Selects C with reasoning that reverses or ignores the target relationship."
    ],
    administration_rules: {
      no_feedback_during_initial_administration: true
    }
  };
}

async function createProfilingFixture(input: {
  prefix: string;
  suffix: string;
  currentPhase?: "profiling_pending" | "initial_item_administration";
  initialCompleted?: boolean;
  createPackage?: boolean;
}) {
  const base = new Date("2026-06-21T15:00:00.000Z");
  const [teacherPasswordHash, studentAccessCodeHash] = await Promise.all([
    hashSecret(`${input.prefix}_teacher_password`),
    hashSecret(`${input.prefix}_student_access_code`)
  ]);
  const teacher = await prisma.user.create({
    data: {
      user_id: `${input.prefix}_${input.suffix}_teacher`,
      user_id_normalized: normalizeUserId(`${input.prefix}_${input.suffix}_teacher`),
      role: "teacher_researcher",
      password_hash: teacherPasswordHash
    }
  });
  const student = await prisma.user.create({
    data: {
      user_id: `${input.prefix}_${input.suffix}_student`,
      user_id_normalized: normalizeUserId(`${input.prefix}_${input.suffix}_student`),
      role: "student",
      access_code_hash: studentAccessCodeHash
    }
  });
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: generatePublicId("assessment"),
      title: `${input.prefix} ${input.suffix}`,
      description: "Temporary Phase 6B profiling smoke fixture.",
      status: "published",
      created_by_user_db_id: teacher.id
    }
  });
  const conceptUnit = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: generatePublicId("concept_unit"),
      assessment_db_id: assessment.id,
      title: `Profiling smoke concept ${input.suffix}`,
      learning_objective: "Verify Student Profiling Agent integration.",
      related_concept_description:
        "Temporary concept for response-package-to-profile smoke testing.",
      administration_rules: { no_feedback_during_initial_administration: true },
      order_index: 1,
      status: "published",
      version: 1
    }
  });
  const items = [];

  for (const order of [1, 2, 3]) {
    const seed = itemSeed(order);
    const item = await prisma.item.create({
      data: {
        item_public_id: generatePublicId("item"),
        concept_unit_db_id: conceptUnit.id,
        item_order: seed.item_order,
        item_stem: seed.item_stem,
        options: seed.options,
        correct_option: seed.correct_option,
        distractor_rationales: seed.distractor_rationales,
        expected_reasoning_patterns: seed.expected_reasoning_patterns,
        possible_misconception_indicators: seed.possible_misconception_indicators,
        administration_rules: seed.administration_rules,
        included_in_published_set: true,
        status: "published",
        version: 1
      }
    });
    items.push(item);
  }

  const session = await prisma.assessmentSession.create({
    data: {
      session_public_id: generatePublicId("session"),
      user_db_id: student.id,
      assessment_db_id: assessment.id,
      attempt_number: 1,
      status: "active",
      current_phase: input.currentPhase ?? "profiling_pending",
      current_concept_unit_db_id: conceptUnit.id,
      started_at: base,
      last_activity_at: minutesAfter(base, 20)
    }
  });
  const conceptUnitSession = await prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_db_id: conceptUnit.id,
      status: input.initialCompleted === false ? "initial_in_progress" : "initial_completed",
      initial_started_at: minutesAfter(base, 1),
      initial_completed_at:
        input.initialCompleted === false ? null : minutesAfter(base, 19),
      followup_status: "not_started",
      followup_round_count: 0
    }
  });
  const snapshots = items.map((item) => ({
    item_public_id: item.item_public_id,
    item_order: item.item_order,
    item_stem: item.item_stem,
    options: item.options,
    correct_option: item.correct_option,
    version: item.version
  }));

  if (input.initialCompleted !== false) {
    await prisma.itemResponse.createMany({
      data: [
        {
          concept_unit_session_db_id: conceptUnitSession.id,
          item_db_id: items[0].id,
          selected_option: "A",
          correct_option_snapshot: "A",
          correctness: "correct",
          reasoning_text:
            "I chose A because it matches the evidence relationship in the prompt.",
          confidence_rating: "high",
          item_response_time_ms: 90_000,
          item_started_at: minutesAfter(base, 2),
          item_submitted_at: minutesAfter(base, 5),
          revision_count: 0,
          item_version_snapshot: 1,
          item_snapshot: snapshots[0],
          client_submission_id: `${input.suffix}_item_1`
        },
        {
          concept_unit_session_db_id: conceptUnitSession.id,
          item_db_id: items[1].id,
          selected_option: "B",
          correct_option_snapshot: "A",
          correctness: "incorrect",
          reasoning_text:
            "I was unsure and selected B because part of the statement sounded related.",
          confidence_rating: "medium",
          item_response_time_ms: 140_000,
          item_started_at: minutesAfter(base, 6),
          item_submitted_at: minutesAfter(base, 11),
          revision_count: 2,
          item_version_snapshot: 1,
          item_snapshot: snapshots[1],
          client_submission_id: `${input.suffix}_item_2`
        },
        {
          concept_unit_session_db_id: conceptUnitSession.id,
          item_db_id: items[2].id,
          selected_option: null,
          correct_option_snapshot: "A",
          correctness: "unanswered",
          reasoning_text: null,
          confidence_rating: null,
          item_response_time_ms: 70_000,
          item_started_at: minutesAfter(base, 12),
          item_submitted_at: minutesAfter(base, 18),
          skipped_item: true,
          skipped_reasoning: true,
          skipped_confidence: true,
          missing_evidence_repair_offered: true,
          revision_count: 0,
          item_version_snapshot: 1,
          item_snapshot: snapshots[2],
          client_submission_id: `${input.suffix}_item_3`
        }
      ]
    });
    await prisma.conversationTurn.createMany({
      data: [
        {
          assessment_session_db_id: session.id,
          concept_unit_session_db_id: conceptUnitSession.id,
          item_db_id: items[0].id,
          phase: "initial_item_administration",
          actor_type: "orchestrator",
          message_text: "Choose an option for item 1.",
          created_at: minutesAfter(base, 2)
        },
        {
          assessment_session_db_id: session.id,
          concept_unit_session_db_id: conceptUnitSession.id,
          item_db_id: items[0].id,
          phase: "initial_item_administration",
          actor_type: "student",
          message_text:
            "I chose A because it matches the evidence relationship in the prompt.",
          structured_payload: { selected_option: "A", confidence_rating: "high" },
          created_at: minutesAfter(base, 4)
        },
        {
          assessment_session_db_id: session.id,
          concept_unit_session_db_id: conceptUnitSession.id,
          item_db_id: items[1].id,
          phase: "initial_item_administration",
          actor_type: "student",
          message_text: "I am not fully sure, but I think B is related.",
          structured_payload: { selected_option: "B", revision_count: 2 },
          created_at: minutesAfter(base, 10)
        }
      ]
    });
    await prisma.processEvent.createMany({
      data: [
        {
          assessment_session_db_id: session.id,
          concept_unit_session_db_id: conceptUnitSession.id,
          item_db_id: items[0].id,
          event_type: "item_presented",
          event_category: "student_response",
          event_source: "backend",
          payload: { item_public_id: items[0].item_public_id },
          occurred_at: minutesAfter(base, 2)
        },
        {
          assessment_session_db_id: session.id,
          concept_unit_session_db_id: conceptUnitSession.id,
          item_db_id: items[1].id,
          event_type: "reasoning_revised",
          event_category: "student_response",
          event_source: "backend",
          payload: { revision_count: 2 },
          occurred_at: minutesAfter(base, 9)
        },
        {
          assessment_session_db_id: session.id,
          concept_unit_session_db_id: conceptUnitSession.id,
          event_type: "long_pause",
          event_category: "student_process",
          event_source: "frontend",
          pause_duration_ms: 45_000,
          payload: { threshold_ms: 30_000 },
          occurred_at: minutesAfter(base, 13)
        },
        {
          assessment_session_db_id: session.id,
          concept_unit_session_db_id: conceptUnitSession.id,
          event_type: "missing_evidence_skipped",
          event_category: "validation",
          event_source: "backend",
          payload: { skipped_item: true },
          occurred_at: minutesAfter(base, 18)
        }
      ]
    });
  }

  const responsePackage =
    input.createPackage === false || input.initialCompleted === false
      ? null
      : await createResponsePackage({
          concept_unit_session_db_id: conceptUnitSession.id,
          package_type: "initial_concept_unit_response_package",
          created_at: minutesAfter(base, 19)
        });

  return {
    teacher,
    student,
    assessment,
    conceptUnit,
    items,
    session,
    conceptUnitSession,
    responsePackage
  };
}

async function createSyntheticOpenAiCall(prefix: string, sessionId: string) {
  await prisma.agentCall.create({
    data: {
      assessment_session_db_id: sessionId,
      agent_name: "student_profiling_agent",
      agent_version: "profiling-smoke",
      model_name: "synthetic-profiling-smoke-model",
      provider: "openai",
      client_request_id: `${prefix}_client_${randomUUID()}`,
      agent_invocation_key: `${prefix}_usage_${randomUUID()}`,
      prompt_hash: "profiling-smoke-prompt-hash",
      prompt_version: "profiling-smoke-prompt",
      schema_version: "profiling-smoke-schema",
      input_payload: { synthetic: true },
      raw_output: { synthetic: true },
      output_payload: { synthetic: true },
      output_validated: true,
      retry_count: 0,
      call_status: "succeeded",
      live_call_allowed: true,
      input_tokens: 5,
      output_tokens: 5,
      total_tokens: 10,
      started_at: new Date(),
      completed_at: new Date()
    }
  });
}

async function waitForHealth(child: ChildProcessWithoutNullStreams) {
  const startedAt = Date.now();
  let childExited = false;

  child.once("exit", () => {
    childExited = true;
  });

  while (Date.now() - startedAt < 30_000) {
    if (childExited) {
      throw new Error("Next dev server exited before health check passed.");
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);

      if (response.status === 200) {
        return;
      }
    } catch {
      // Server not ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("Timed out waiting for Next dev server.");
}

async function login(payload: Record<string, string>) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";

  return { response, cookie };
}

async function runApiSmoke(prefix: string) {
  const fixture = await createProfilingFixture({
    prefix,
    suffix: "api",
    createPackage: true
  });
  const incompleteFixture = await createProfilingFixture({
    prefix,
    suffix: "api_incomplete",
    currentPhase: "initial_item_administration",
    initialCompleted: false,
    createPackage: false
  });
  let output = "";
  const child = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DEVELOPMENT_ACTIVE_SESSION_CONTROLS_ENABLED: "true",
      LLM_PROVIDER: "mock",
      LLM_LIVE_CALLS_ENABLED: "false",
      OPENAI_API_KEY: ""
    }
  });

  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });

  try {
    await waitForHealth(child);
    const route = `/api/teacher/sessions/${fixture.session.session_public_id}/concept-units/${fixture.conceptUnit.concept_unit_public_id}/run-profiling`;
    const unauthenticated = await fetch(`${baseUrl}${route}`, { method: "POST" });
    assert(unauthenticated.status === 401, "Unauthenticated profiling trigger should return 401.");

    const studentLogin = await login({
      user_id: fixture.student.user_id,
      access_code: `${prefix}_student_access_code`
    });
    assert(studentLogin.response.status === 200, "Student login failed.");
    const studentTrigger = await fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { cookie: studentLogin.cookie }
    });
    assert(studentTrigger.status === 403, "Student profiling trigger should return 403.");

    const teacherLogin = await login({
      user_id: fixture.teacher.user_id,
      password: `${prefix}_teacher_password`
    });
    assert(teacherLogin.response.status === 200, "Teacher login failed.");
    const incompleteRoute = `/api/teacher/sessions/${incompleteFixture.session.session_public_id}/concept-units/${incompleteFixture.conceptUnit.concept_unit_public_id}/run-profiling`;
    const incompleteTrigger = await fetch(`${baseUrl}${incompleteRoute}`, {
      method: "POST",
      headers: { cookie: teacherLogin.cookie }
    });
    assert(
      incompleteTrigger.status === 409,
      "Profiling should not run before initial concept-unit completion."
    );

    const teacherTrigger = await fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { cookie: teacherLogin.cookie }
    });
    const triggerText = await teacherTrigger.text();
    assert(teacherTrigger.status === 200, `Teacher profiling trigger failed: ${triggerText}`);
    const triggerJson = JSON.parse(triggerText) as { result?: { status?: string; profile?: unknown } };
    assert(
      triggerJson.result?.status === "profile_created",
      "Teacher trigger should create a profile."
    );
    assert(triggerJson.result.profile, "Teacher trigger should return profile summary.");
    assertNoForbiddenSerializedFields(triggerJson, "Profiling trigger response");

    const duplicateTrigger = await fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { cookie: teacherLogin.cookie }
    });
    const duplicateJson = (await duplicateTrigger.json()) as { result?: { status?: string } };
    assert(duplicateTrigger.status === 200, "Repeated teacher trigger should return 200.");
    assert(
      duplicateJson.result?.status === "already_profiled",
      "Repeated teacher trigger should be idempotent."
    );

    const detail = await fetch(
      `${baseUrl}/api/teacher/sessions/${fixture.session.session_public_id}`,
      { headers: { cookie: teacherLogin.cookie } }
    );
    const detailText = await detail.text();
    assert(detail.status === 200, `Teacher session detail failed: ${detailText}`);
    const detailJson = JSON.parse(detailText) as {
      concept_unit_sessions?: Array<{ latest_student_profile?: unknown }>;
      future_agent_data?: { formative_decision_count?: number; followup_round_count?: number };
    };
    assert(
      detailJson.concept_unit_sessions?.some((entry) => entry.latest_student_profile),
      "Teacher session detail should include saved profile fields."
    );
    assert(
      detailJson.future_agent_data?.formative_decision_count === 0,
      "Teacher detail should not fabricate formative decisions."
    );
    assert(
      detailJson.future_agent_data?.followup_round_count === 0,
      "Teacher detail should not fabricate follow-up rounds."
    );
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    child.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function main() {
  const prefix = `phase6b_profile_smoke_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const originalEnv = Object.fromEntries(llmEnvKeys.map((key) => [key, process.env[key]]));
  let fixture: Fixture | undefined;
  let invalidFixture: Fixture | undefined;
  let blockedFixture: Fixture | undefined;

  try {
    setEnv({ LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false", LLM_USAGE_TIMEZONE: "UTC" });
    fixture = await createProfilingFixture({ prefix, suffix: "service", createPackage: true });
    assert(
      fixture.conceptUnitSession.initial_completed_at,
      "Temporary completed initial concept-unit session was not created."
    );
    assert(fixture.responsePackage, "Initial response package was not created.");
    assert(fixture.session.current_phase === "profiling_pending", "Session should start in profiling_pending.");

    const built = await buildInitialStudentProfilingInput(
      fixture.conceptUnitSession.id,
      fixture.responsePackage.id
    );
    assert(
      JSON.stringify(built.input).includes("distractor_rationales"),
      "Profiling input should include teacher-side distractor rationales."
    );
    assertNoForbiddenSerializedFields(built.input, "StudentProfilingInput");

    const result = await runInitialStudentProfiling({
      concept_unit_session_db_id: fixture.conceptUnitSession.id,
      invocation_reason: "phase6b_service_smoke"
    });
    assert(result.status === "profile_created", "Profiling service should create a profile.");
    assert(result.profile?.integrated_diagnostic_profile, "Profile summary missing integrated profile.");

    const agentCall = await prisma.agentCall.findUniqueOrThrow({
      where: { agent_invocation_key: built.agent_invocation_key }
    });
    assert(agentCall.agent_name === "student_profiling_agent", "Agent call name mismatch.");
    assert(agentCall.provider === "mock", "Profiling smoke should use mock provider.");
    assert(agentCall.call_status === "succeeded", "Agent call should be succeeded.");
    assert(agentCall.output_validated, "Agent output should be validated.");
    assert(
      StudentProfileOutput.safeParse(agentCall.output_payload).success,
      "Saved agent output should validate against StudentProfileOutput."
    );

    const profile = await prisma.studentProfile.findFirstOrThrow({
      where: { concept_unit_session_db_id: fixture.conceptUnitSession.id }
    });
    const updatedConceptUnitSession = await prisma.conceptUnitSession.findUniqueOrThrow({
      where: { id: fixture.conceptUnitSession.id }
    });
    const updatedSession = await prisma.assessmentSession.findUniqueOrThrow({
      where: { id: fixture.session.id }
    });
    assert(
      updatedConceptUnitSession.latest_student_profile_db_id === profile.id,
      "Latest profile pointer was not updated."
    );
    assert(updatedSession.current_phase === "profiling_completed", "Session phase did not complete profiling.");

    const detail = await getTeacherReviewSessionDetail(fixture.session.session_public_id);
    assert(
      detail.concept_unit_sessions[0]?.latest_student_profile?.ability_profile,
      "Teacher serializer should return saved profile fields."
    );
    assert(detail.future_agent_data.formative_decision_count === 0, "No formative decision should be created.");
    assert(detail.future_agent_data.followup_round_count === 0, "No follow-up round should be created.");

    const studentState = await getStudentSessionState({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id
    });
    assertStudentPayloadIsSafe(studentState);
    assertNoForbiddenSerializedFields(studentState, "Student session state");
    const studentProfileSummary = serializeStudentProfileForStudent();
    assert(
      !JSON.stringify(studentProfileSummary).includes("ability_profile"),
      "Student-facing serializer should not return profile labels."
    );

    const replay = await runInitialStudentProfiling({
      concept_unit_session_db_id: fixture.conceptUnitSession.id,
      invocation_reason: "phase6b_idempotency_smoke"
    });
    assert(replay.status === "already_profiled", "Repeated profiling should be idempotent.");
    const profileCount = await prisma.studentProfile.count({
      where: { concept_unit_session_db_id: fixture.conceptUnitSession.id }
    });
    assert(profileCount === 1, "Repeated profiling created a duplicate profile.");

    invalidFixture = await createProfilingFixture({
      prefix,
      suffix: "invalid",
      createPackage: true
    });
    const invalidResult = await runInitialStudentProfiling({
      concept_unit_session_db_id: invalidFixture.conceptUnitSession.id,
      invocation_reason: "phase6b_invalid_output_smoke",
      mock_provider_mode: "invalid_output"
    });
    assert(invalidResult.status === "invalid_output", "Invalid mock output should be rejected.");
    assert(
      (await prisma.studentProfile.count({
        where: { concept_unit_session_db_id: invalidFixture.conceptUnitSession.id }
      })) === 0,
      "Invalid output should not create a profile."
    );

    blockedFixture = await createProfilingFixture({
      prefix,
      suffix: "blocked",
      createPackage: true
    });
    setEnv({
      LLM_PROVIDER: "openai",
      LLM_LIVE_CALLS_ENABLED: "true",
      OPENAI_API_KEY: "placeholder-not-a-real-secret",
      OPENAI_MODEL_PROFILING: "synthetic-profiling-smoke-model",
      LLM_DAILY_STUDENT_CALL_LIMIT: "1",
      LLM_DAILY_STUDENT_TOKEN_LIMIT: "1000000",
      LLM_DAILY_CLASS_CALL_LIMIT: "1000",
      LLM_DAILY_CLASS_TOKEN_LIMIT: "1000000",
      LLM_SESSION_CALL_LIMIT: "1000",
      LLM_SESSION_TOKEN_LIMIT: "1000000",
      LLM_AGENT_CALL_LIMIT_PER_SESSION: "1000",
      LLM_USAGE_TIMEZONE: "UTC"
    });
    await createSyntheticOpenAiCall(prefix, blockedFixture.session.id);
    const blocked = await runInitialStudentProfiling({
      concept_unit_session_db_id: blockedFixture.conceptUnitSession.id,
      invocation_reason: "phase6b_usage_blocked_smoke"
    });
    assert(
      blocked.status === "blocked_by_usage_limit",
      "Usage-blocked execution should return blocked_by_usage_limit."
    );
    assert(
      (await prisma.studentProfile.count({
        where: { concept_unit_session_db_id: blockedFixture.conceptUnitSession.id }
      })) === 0,
      "Usage-blocked execution should not create a profile."
    );
    const blockedCall = blocked.agent_call_id
      ? await prisma.agentCall.findUniqueOrThrow({ where: { id: blocked.agent_call_id } })
      : null;
    assert(blockedCall?.provider === "openai", "Blocked audit row should preserve provider.");
    assert(blockedCall.provider_response_id === null, "Blocked execution should not call OpenAI.");
    assert(blockedCall.blocked_reason, "Blocked execution should persist blocked reason.");

    setEnv({ LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false", LLM_USAGE_TIMEZONE: "UTC" });
    await runApiSmoke(prefix);

    assert(
      (await prisma.formativeDecision.count({
        where: { concept_unit_session: { assessment_session: { assessment: { title: { startsWith: prefix } } } } }
      })) === 0,
      "Profiling smoke should not create formative decisions."
    );
    assert(
      (await prisma.followupRound.count({
        where: { concept_unit_session: { assessment_session: { assessment: { title: { startsWith: prefix } } } } }
      })) === 0,
      "Profiling smoke should not create follow-up rounds."
    );

    console.log("Student profiling agent smoke test passed. Mock provider only; no OpenAI network call was made.");
  } finally {
    setEnv(originalEnv);
    await cleanup(prefix);
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
