import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { FormativePlanningOutput } from "../src/lib/agents/contracts";
import { buildInitialFormativePlanningInput } from "../src/lib/agents/formative-planning/input-builder";
import { defaultFormativeValueForIntegratedProfile } from "../src/lib/agents/formative-planning/mapping";
import { runInitialFormativePlanning } from "../src/lib/agents/formative-planning/service";
import { serializeFormativeDecisionForStudent } from "../src/lib/agents/formative-planning/serializers";
import { runInitialStudentProfiling } from "../src/lib/agents/student-profiling/service";
import { createResponsePackage } from "../src/lib/services/response-packages";
import { getStudentSessionState } from "../src/lib/services/student-assessment/service";
import { assertStudentPayloadIsSafe } from "../src/lib/services/student-assessment/serializers";
import { getTeacherReviewSessionDetail } from "../src/lib/services/teacher-review/session-detail";
import { generatePublicId } from "../src/lib/services/ids";
import { hashSecret } from "../src/lib/password";

const prisma = new PrismaClient();
const port = 3217;
const baseUrl = `http://localhost:${port}`;
const llmEnvKeys = [
  "LLM_PROVIDER",
  "LLM_LIVE_CALLS_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_MODEL_PLANNING",
  "LLM_DAILY_STUDENT_CALL_LIMIT",
  "LLM_DAILY_STUDENT_TOKEN_LIMIT",
  "LLM_DAILY_CLASS_CALL_LIMIT",
  "LLM_DAILY_CLASS_TOKEN_LIMIT",
  "LLM_SESSION_CALL_LIMIT",
  "LLM_SESSION_TOKEN_LIMIT",
  "LLM_AGENT_CALL_LIMIT_PER_SESSION",
  "LLM_USAGE_TIMEZONE"
] as const;

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
  const serialized = JSON.stringify(value).toLowerCase();
  const forbidden = [
    "password_hash",
    "access_code_hash",
    "session_cookie",
    "authorization_header",
    "api_key",
    "database_url",
    "session_secret",
    "summative",
    "_db_id",
    "\"id\""
  ];

  for (const field of forbidden) {
    assert(!serialized.includes(field), `${label} leaked ${field}.`);
  }
}

async function cleanup(prefix: string) {
  const assessments = await prisma.assessment.findMany({
    where: { title: { startsWith: prefix } },
    select: { id: true }
  });
  const assessmentIds = assessments.map((assessment) => assessment.id);

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
    where: { user_id: { startsWith: prefix } }
  });
}

function itemSeed(itemOrder: number) {
  return {
    item_order: itemOrder,
    item_stem: `Planning smoke item ${itemOrder}`,
    options: [
      { label: "A", text: "Best-supported answer" },
      { label: "B", text: "Partial distractor" },
      { label: "C", text: "Misconception distractor" }
    ],
    correct_option: "A",
    distractor_rationales: {
      B: "B reflects partial understanding.",
      C: "C reflects a plausible misconception."
    },
    expected_reasoning_patterns: ["Connects the option to concept evidence."],
    possible_misconception_indicators: ["Selects C with reversed reasoning."]
  };
}

async function createPlanningFixture(input: {
  prefix: string;
  suffix: string;
  withProfile?: boolean;
}) {
  const base = new Date("2026-06-21T17:00:00.000Z");
  const [teacherPasswordHash, studentAccessCodeHash] = await Promise.all([
    hashSecret(`${input.prefix}_teacher_password`),
    hashSecret(`${input.prefix}_student_access_code`)
  ]);
  const teacher = await prisma.user.create({
    data: {
      user_id: `${input.prefix}_${input.suffix}_teacher`,
      role: "teacher_researcher",
      password_hash: teacherPasswordHash
    }
  });
  const student = await prisma.user.create({
    data: {
      user_id: `${input.prefix}_${input.suffix}_student`,
      role: "student",
      access_code_hash: studentAccessCodeHash
    }
  });
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: generatePublicId("assessment"),
      title: `${input.prefix} ${input.suffix}`,
      description: "Temporary Phase 6C planning smoke fixture.",
      status: "published",
      created_by_user_db_id: teacher.id
    }
  });
  const conceptUnit = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: generatePublicId("concept_unit"),
      assessment_db_id: assessment.id,
      title: `Planning smoke concept ${input.suffix}`,
      learning_objective: "Verify Formative Value and Planning Agent integration.",
      related_concept_description: "Temporary concept for profile-to-planning smoke testing.",
      administration_rules: { no_feedback_during_initial_administration: true },
      order_index: 1,
      status: "published",
      version: 1
    }
  });
  const items = [];

  for (const order of [1, 2, 3]) {
    const seed = itemSeed(order);
    items.push(
      await prisma.item.create({
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
          administration_rules: { no_feedback_during_initial_administration: true },
          included_in_published_set: true,
          status: "published",
          version: 1
        }
      })
    );
  }

  const session = await prisma.assessmentSession.create({
    data: {
      session_public_id: generatePublicId("session"),
      user_db_id: student.id,
      assessment_db_id: assessment.id,
      attempt_number: 1,
      status: "active",
      current_phase: "profiling_pending",
      current_concept_unit_db_id: conceptUnit.id,
      started_at: base,
      last_activity_at: minutesAfter(base, 20)
    }
  });
  const conceptUnitSession = await prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_db_id: conceptUnit.id,
      status: "initial_completed",
      initial_started_at: minutesAfter(base, 1),
      initial_completed_at: minutesAfter(base, 19),
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

  await prisma.itemResponse.createMany({
    data: [
      {
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[0].id,
        selected_option: "A",
        correct_option_snapshot: "A",
        correctness: "correct",
        reasoning_text: "A matches the evidence in the prompt.",
        confidence_rating: "high",
        item_response_time_ms: 90_000,
        item_started_at: minutesAfter(base, 2),
        item_submitted_at: minutesAfter(base, 5),
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
        reasoning_text: "B sounded partly related, but I am not sure.",
        confidence_rating: "medium",
        item_response_time_ms: 120_000,
        item_started_at: minutesAfter(base, 6),
        item_submitted_at: minutesAfter(base, 11),
        revision_count: 1,
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
        item_response_time_ms: 60_000,
        item_started_at: minutesAfter(base, 12),
        item_submitted_at: minutesAfter(base, 18),
        skipped_item: true,
        skipped_reasoning: true,
        skipped_confidence: true,
        missing_evidence_repair_offered: true,
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
        actor_type: "student",
        message_text: "I choose A because it matches the evidence.",
        structured_payload: { selected_option: "A", confidence_rating: "high" },
        created_at: minutesAfter(base, 4)
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[1].id,
        phase: "initial_item_administration",
        actor_type: "student",
        message_text: "I think B is related, but I am uncertain.",
        structured_payload: { selected_option: "B", confidence_rating: "medium" },
        created_at: minutesAfter(base, 10)
      }
    ]
  });
  await prisma.processEvent.createMany({
    data: [
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: items[1].id,
        event_type: "reasoning_revised",
        event_category: "student_response",
        event_source: "backend",
        payload: { revision_count: 1 },
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
      }
    ]
  });

  const responsePackage = await createResponsePackage({
    concept_unit_session_db_id: conceptUnitSession.id,
    package_type: "initial_concept_unit_response_package",
    created_at: minutesAfter(base, 19)
  });

  if (input.withProfile !== false) {
    const profiling = await runInitialStudentProfiling({
      concept_unit_session_db_id: conceptUnitSession.id,
      invocation_reason: "phase6c_fixture_profile"
    });

    assert(profiling.status === "profile_created", "Fixture profile was not created.");
  }

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
      agent_name: "formative_value_and_planning_agent",
      agent_version: "planning-smoke",
      model_name: "synthetic-planning-smoke-model",
      provider: "openai",
      client_request_id: `${prefix}_client_${randomUUID()}`,
      agent_invocation_key: `${prefix}_usage_${randomUUID()}`,
      prompt_hash: "planning-smoke-prompt-hash",
      prompt_version: "planning-smoke-prompt",
      schema_version: "planning-smoke-schema",
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
  const fixture = await createPlanningFixture({
    prefix,
    suffix: "api",
    withProfile: true
  });
  const noProfileFixture = await createPlanningFixture({
    prefix,
    suffix: "api_no_profile",
    withProfile: false
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
    const route = `/api/teacher/sessions/${fixture.session.session_public_id}/concept-units/${fixture.conceptUnit.concept_unit_public_id}/run-planning`;
    const unauthenticated = await fetch(`${baseUrl}${route}`, { method: "POST" });
    assert(unauthenticated.status === 401, "Unauthenticated planning trigger should return 401.");

    const studentLogin = await login({
      user_id: fixture.student.user_id,
      access_code: `${prefix}_student_access_code`
    });
    assert(studentLogin.response.status === 200, "Student login failed.");
    const studentTrigger = await fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { cookie: studentLogin.cookie }
    });
    assert(studentTrigger.status === 403, "Student planning trigger should return 403.");

    const teacherLogin = await login({
      user_id: fixture.teacher.user_id,
      password: `${prefix}_teacher_password`
    });
    assert(teacherLogin.response.status === 200, "Teacher login failed.");

    const noProfileRoute = `/api/teacher/sessions/${noProfileFixture.session.session_public_id}/concept-units/${noProfileFixture.conceptUnit.concept_unit_public_id}/run-planning`;
    const noProfileTrigger = await fetch(`${baseUrl}${noProfileRoute}`, {
      method: "POST",
      headers: { cookie: teacherLogin.cookie }
    });
    assert(noProfileTrigger.status === 409, "Planning should not run before a profile exists.");

    const teacherTrigger = await fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { cookie: teacherLogin.cookie }
    });
    const triggerText = await teacherTrigger.text();
    assert(teacherTrigger.status === 200, `Teacher planning trigger failed: ${triggerText}`);
    const triggerJson = JSON.parse(triggerText) as { result?: { status?: string; decision?: unknown } };
    assert(triggerJson.result?.status === "decision_created", "Teacher trigger should create a decision.");
    assert(triggerJson.result.decision, "Teacher trigger should return a decision summary.");
    assertNoForbiddenSerializedFields(triggerJson, "Planning trigger response");

    const duplicateTrigger = await fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { cookie: teacherLogin.cookie }
    });
    const duplicateJson = (await duplicateTrigger.json()) as { result?: { status?: string } };
    assert(duplicateTrigger.status === 200, "Repeated planning trigger should return 200.");
    assert(duplicateJson.result?.status === "already_planned", "Repeated trigger should be idempotent.");

    const detail = await fetch(
      `${baseUrl}/api/teacher/sessions/${fixture.session.session_public_id}`,
      { headers: { cookie: teacherLogin.cookie } }
    );
    const detailJson = (await detail.json()) as {
      concept_unit_sessions?: Array<{ latest_formative_decision?: unknown }>;
      future_agent_data?: { followup_round_count?: number };
    };
    assert(
      detailJson.concept_unit_sessions?.some((entry) => entry.latest_formative_decision),
      "Teacher session detail should include saved formative decision."
    );
    assert(detailJson.future_agent_data?.followup_round_count === 0, "Follow-up round count should remain zero.");
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    child.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function assertNoDecision(conceptUnitSessionId: string, message: string) {
  assert(
    (await prisma.formativeDecision.count({
      where: { concept_unit_session_db_id: conceptUnitSessionId }
    })) === 0,
    message
  );
}

async function main() {
  const prefix = `phase6c_planning_smoke_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const originalEnv = Object.fromEntries(llmEnvKeys.map((key) => [key, process.env[key]]));

  try {
    setEnv({ LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false", LLM_USAGE_TIMEZONE: "UTC" });

    const fixture = await createPlanningFixture({ prefix, suffix: "service", withProfile: true });
    const profiledSession = await prisma.assessmentSession.findUniqueOrThrow({
      where: { id: fixture.session.id }
    });
    assert(profiledSession.current_phase === "profiling_completed", "Session should begin planning at profiling_completed.");
    assert(fixture.responsePackage, "Valid initial response package should exist.");

    const built = await buildInitialFormativePlanningInput(fixture.conceptUnitSession.id);
    assertNoForbiddenSerializedFields(built.input, "FormativePlanningInput");
    assert(
      !JSON.stringify(built.input).toLowerCase().includes("summative"),
      "Planning input should not include summative outcomes."
    );
    assert(
      built.default_formative_value ===
        defaultFormativeValueForIntegratedProfile(
          built.student_profile.integrated_diagnostic_profile
        ),
      "Default formative value was not derived from the integrated profile."
    );

    const profileBefore = await prisma.studentProfile.findUniqueOrThrow({
      where: { id: built.student_profile.id }
    });
    const packageBefore = await prisma.responsePackage.findUniqueOrThrow({
      where: { id: built.response_package.id }
    });
    const result = await runInitialFormativePlanning({
      concept_unit_session_db_id: fixture.conceptUnitSession.id,
      invocation_reason: "phase6c_service_smoke"
    });
    assert(result.status === "decision_created", "Planning service should create a decision.");
    assert(result.decision?.formative_value === built.default_formative_value, "Default mapping should be followed.");

    const agentCall = await prisma.agentCall.findUniqueOrThrow({
      where: { agent_invocation_key: built.agent_invocation_key }
    });
    assert(agentCall.agent_name === "formative_value_and_planning_agent", "Agent call name mismatch.");
    assert(agentCall.provider === "mock", "Planning smoke should use mock provider.");
    assert(agentCall.call_status === "succeeded", "Agent call should be succeeded.");
    assert(agentCall.output_validated, "Agent output should be validated.");
    assert(
      FormativePlanningOutput.safeParse(agentCall.output_payload).success,
      "Saved agent output should validate against FormativePlanningOutput."
    );

    const decision = await prisma.formativeDecision.findFirstOrThrow({
      where: { concept_unit_session_db_id: fixture.conceptUnitSession.id }
    });
    assert(decision.student_profile_db_id === built.student_profile.id, "Decision should reference latest profile.");
    const updatedConceptUnitSession = await prisma.conceptUnitSession.findUniqueOrThrow({
      where: { id: fixture.conceptUnitSession.id }
    });
    const updatedSession = await prisma.assessmentSession.findUniqueOrThrow({
      where: { id: fixture.session.id }
    });
    assert(
      updatedConceptUnitSession.latest_formative_decision_db_id === decision.id,
      "Latest decision pointer was not updated."
    );
    assert(updatedSession.current_phase === "planning_completed", "Session did not move to planning_completed.");

    const profileAfter = await prisma.studentProfile.findUniqueOrThrow({
      where: { id: built.student_profile.id }
    });
    const packageAfter = await prisma.responsePackage.findUniqueOrThrow({
      where: { id: built.response_package.id }
    });
    assert(
      JSON.stringify(profileBefore) === JSON.stringify(profileAfter),
      "Planning should not modify the student profile."
    );
    assert(
      JSON.stringify(packageBefore.payload) === JSON.stringify(packageAfter.payload),
      "Planning should not modify the response package."
    );

    const detail = await getTeacherReviewSessionDetail(fixture.session.session_public_id);
    assert(
      detail.concept_unit_sessions[0]?.latest_formative_decision?.formative_value,
      "Teacher serializer should return saved planning fields."
    );
    assert(detail.future_agent_data.followup_round_count === 0, "No follow-up round should be created.");

    const studentState = await getStudentSessionState({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id
    });
    assertStudentPayloadIsSafe(studentState);
    assertNoForbiddenSerializedFields(studentState, "Student session state");
    const studentDecisionSummary = serializeFormativeDecisionForStudent();
    assert(
      !JSON.stringify(studentDecisionSummary).includes("formative_value"),
      "Student-facing serializer should not return formative labels."
    );

    const replay = await runInitialFormativePlanning({
      concept_unit_session_db_id: fixture.conceptUnitSession.id,
      invocation_reason: "phase6c_idempotency_smoke"
    });
    assert(replay.status === "already_planned", "Repeated planning should be idempotent.");
    const decisionCount = await prisma.formativeDecision.count({
      where: { concept_unit_session_db_id: fixture.conceptUnitSession.id }
    });
    assert(decisionCount === 1, "Repeated planning created a duplicate decision.");

    const deviationFixture = await createPlanningFixture({ prefix, suffix: "deviation", withProfile: true });
    const deviation = await runInitialFormativePlanning({
      concept_unit_session_db_id: deviationFixture.conceptUnitSession.id,
      invocation_reason: "phase6c_deviation_smoke",
      mock_provider_mode: "planning_mapping_deviation"
    });
    assert(deviation.status === "decision_created", "Valid mapping deviation should be accepted.");

    const badDeviationFixture = await createPlanningFixture({ prefix, suffix: "bad_deviation", withProfile: true });
    const badDeviation = await runInitialFormativePlanning({
      concept_unit_session_db_id: badDeviationFixture.conceptUnitSession.id,
      invocation_reason: "phase6c_bad_deviation_smoke",
      mock_provider_mode: "planning_bad_mapping_deviation"
    });
    assert(
      badDeviation.status === "semantic_validation_failed",
      "Mapping deviation without rationale should be rejected."
    );
    await assertNoDecision(
      badDeviationFixture.conceptUnitSession.id,
      "Bad mapping deviation should not create a decision."
    );

    const contradictoryFixture = await createPlanningFixture({ prefix, suffix: "contradictory", withProfile: true });
    const contradictory = await runInitialFormativePlanning({
      concept_unit_session_db_id: contradictoryFixture.conceptUnitSession.id,
      invocation_reason: "phase6c_contradictory_smoke",
      mock_provider_mode: "planning_contradictory_mapping"
    });
    assert(
      contradictory.status === "semantic_validation_failed",
      "Contradictory mapping metadata should be rejected."
    );
    await assertNoDecision(
      contradictoryFixture.conceptUnitSession.id,
      "Contradictory mapping should not create a decision."
    );

    const invalidFixture = await createPlanningFixture({ prefix, suffix: "invalid", withProfile: true });
    const invalid = await runInitialFormativePlanning({
      concept_unit_session_db_id: invalidFixture.conceptUnitSession.id,
      invocation_reason: "phase6c_invalid_output_smoke",
      mock_provider_mode: "invalid_output"
    });
    assert(invalid.status === "invalid_output", "Invalid output should be rejected.");
    await assertNoDecision(invalidFixture.conceptUnitSession.id, "Invalid output should not create a decision.");

    const refusalFixture = await createPlanningFixture({ prefix, suffix: "refusal", withProfile: true });
    const refusal = await runInitialFormativePlanning({
      concept_unit_session_db_id: refusalFixture.conceptUnitSession.id,
      invocation_reason: "phase6c_refusal_smoke",
      mock_provider_mode: "refusal"
    });
    assert(refusal.status === "refused", "Refusal should return refused.");
    await assertNoDecision(refusalFixture.conceptUnitSession.id, "Refusal should not create a decision.");

    const incompleteFixture = await createPlanningFixture({ prefix, suffix: "incomplete", withProfile: true });
    const incomplete = await runInitialFormativePlanning({
      concept_unit_session_db_id: incompleteFixture.conceptUnitSession.id,
      invocation_reason: "phase6c_incomplete_smoke",
      mock_provider_mode: "incomplete"
    });
    assert(incomplete.status === "incomplete", "Incomplete output should return incomplete.");
    await assertNoDecision(incompleteFixture.conceptUnitSession.id, "Incomplete output should not create a decision.");

    const noProfileFixture = await createPlanningFixture({ prefix, suffix: "no_profile", withProfile: false });
    try {
      await runInitialFormativePlanning({
        concept_unit_session_db_id: noProfileFixture.conceptUnitSession.id,
        invocation_reason: "phase6c_no_profile_smoke"
      });
      throw new Error("Planning should fail before a profile exists.");
    } catch (error) {
      assert(
        error instanceof Error && error.message.includes("valid latest student profile"),
        "Planning without profile should fail with profile-required error."
      );
    }

    const blockedFixture = await createPlanningFixture({ prefix, suffix: "blocked", withProfile: true });
    setEnv({
      LLM_PROVIDER: "openai",
      LLM_LIVE_CALLS_ENABLED: "true",
      OPENAI_API_KEY: "placeholder-not-a-real-secret",
      OPENAI_MODEL_PLANNING: "synthetic-planning-smoke-model",
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
    const blocked = await runInitialFormativePlanning({
      concept_unit_session_db_id: blockedFixture.conceptUnitSession.id,
      invocation_reason: "phase6c_usage_blocked_smoke"
    });
    assert(
      blocked.status === "blocked_by_usage_limit",
      "Usage-blocked execution should return blocked_by_usage_limit."
    );
    await assertNoDecision(blockedFixture.conceptUnitSession.id, "Usage-blocked execution should not create a decision.");
    const blockedCall = blocked.agent_call_id
      ? await prisma.agentCall.findUniqueOrThrow({ where: { id: blocked.agent_call_id } })
      : null;
    assert(blockedCall?.provider === "openai", "Blocked audit row should preserve provider.");
    assert(blockedCall.provider_response_id === null, "Blocked execution should not call OpenAI.");

    setEnv({ LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false", LLM_USAGE_TIMEZONE: "UTC" });
    await runApiSmoke(prefix);

    assert(
      (await prisma.followupRound.count({
        where: { concept_unit_session: { assessment_session: { assessment: { title: { startsWith: prefix } } } } }
      })) === 0,
      "Planning smoke should not create follow-up rounds."
    );

    console.log("Formative planning agent smoke test passed. Mock provider only; no OpenAI network call was made.");
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
