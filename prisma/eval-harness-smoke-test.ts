import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";
import {
  cleanupEvalFixtures,
  createMockEvaluationRuns,
  seedEvalFixtures,
  summarizeEvalRun
} from "../src/lib/services/evals/service";
import type { PublicUser } from "../src/types/auth";
import { ensureTeacherReviewDemoUsers } from "./demo-teacher-review-fixture";

const prisma = new PrismaClient();
const port = 3237;
const baseUrl = `http://localhost:${port}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForHealth(child: ChildProcessWithoutNullStreams) {
  const startedAt = Date.now();
  let childExited = false;

  child.once("exit", () => {
    childExited = true;
  });

  while (Date.now() - startedAt < 45_000) {
    if (childExited) {
      throw new Error("Next dev server exited before health check passed.");
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);

      if (response.status === 200) {
        return;
      }
    } catch {
      // Server is still starting.
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
  const text = await response.text();

  return { response, cookie, text };
}

async function jsonRequest<T>(path: string, cookie: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      cookie,
      ...(init?.headers ?? {})
    }
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${text}`);
  }

  return text ? (JSON.parse(text) as T) : ({} as T);
}

function assertNoPrivateData(text: string, label: string) {
  assert(!text.includes("password_hash"), `${label} exposed password_hash.`);
  assert(!text.includes("access_code_hash"), `${label} exposed access_code_hash.`);
  assert(!/OPENAI_API_KEY|SESSION_SECRET|DATABASE_URL|cmcq_session=/i.test(text), `${label} exposed secret-like data.`);
  assert(!/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(text), `${label} exposed an internal UUID.`);
}

async function operationalCounts() {
  const [
    studentProfiles,
    formativeDecisions,
    followupRounds,
    itemVerificationRuns,
    assessmentSessions,
    itemResponses,
    agentCalls
  ] = await Promise.all([
    prisma.studentProfile.count(),
    prisma.formativeDecision.count(),
    prisma.followupRound.count(),
    prisma.itemVerificationRun.count(),
    prisma.assessmentSession.count(),
    prisma.itemResponse.count(),
    prisma.agentCall.count()
  ]);

  return {
    studentProfiles,
    formativeDecisions,
    followupRounds,
    itemVerificationRuns,
    assessmentSessions,
    itemResponses,
    agentCalls
  };
}

async function main() {
  await ensureTeacherReviewDemoUsers(prisma);
  await cleanupEvalFixtures();

  const teacher = await prisma.user.findUniqueOrThrow({
    where: { user_id: "teacher_demo" },
    select: { id: true, user_id: true, role: true, auth_version: true }
  });
  const before = await operationalCounts();
  const seeded = await seedEvalFixtures(teacher.id);
  assert(seeded.suite_count === 5, "Five agent suites should be seeded.");
  assert(seeded.case_count === 50, "Expected exactly 50 synthetic cases.");

  const suiteCounts = await prisma.evalSuite.findMany({
    where: { title: { startsWith: "Phase 7E1 synthetic" } },
    include: { _count: { select: { cases: true } } }
  });
  assert(suiteCounts.length === 5, "Five fixture suites should exist.");
  assert(
    suiteCounts.every((suite) => suite._count.cases >= 10),
    "Each active agent should have at least 10 cases."
  );

  const user: PublicUser = {
    user_db_id: teacher.id,
    user_id: teacher.user_id,
    role: "teacher_researcher",
    auth_version: teacher.auth_version
  };
  const runResult = await createMockEvaluationRuns({}, user);
  assert(runResult.runs.length === 5, "Mock evaluation should create one run per fixture suite.");
  const runIds = runResult.runs.map((run) => run.run_public_id);
  const runItems = await prisma.evalRunItem.findMany({
    where: { run: { run_public_id: { in: runIds } } },
    include: {
      run: true,
      eval_case: true
    }
  });
  assert(runItems.length >= 50, "Eval run items were not stored.");
  assert(runItems.every((item) => item.schema_validation_error !== undefined), "Schema validation capture is missing.");
  assert(
    runItems.every((item) => item.semantic_validation_result !== null),
    "Semantic validation results should be stored."
  );
  assert(
    runItems.every((item) => item.run.provider === "mock"),
    "Mock run should store mock provider metadata."
  );
  assert(
    runItems.every((item) => item.eval_case.case_source === "synthetic"),
    "Phase 7E1 smoke should use only synthetic cases."
  );

  const after = await operationalCounts();
  assert(after.studentProfiles === before.studentProfiles, "Eval outputs created operational student profiles.");
  assert(after.formativeDecisions === before.formativeDecisions, "Eval outputs created operational formative decisions.");
  assert(after.followupRounds === before.followupRounds, "Eval outputs created operational follow-up rounds.");
  assert(after.itemVerificationRuns === before.itemVerificationRuns, "Eval outputs created item verification runs.");
  assert(after.assessmentSessions === before.assessmentSessions, "Eval outputs modified assessment sessions.");
  assert(after.itemResponses === before.itemResponses, "Eval outputs modified item responses.");
  assert(after.agentCalls === before.agentCalls, "Eval mock run should not create agent_calls.");

  const firstRun = runResult.runs[0];
  assert(firstRun, "Expected at least one eval run.");
  const firstRunItem = await prisma.evalRunItem.findFirstOrThrow({
    where: { run: { run_public_id: firstRun.run_public_id } },
    select: { run_item_public_id: true }
  });
  const directSummary = await summarizeEvalRun(firstRun.run_public_id);
  assert(directSummary.case_count >= 10, "Summary should calculate case count.");
  assert(directSummary.label === "development evaluation", "Summary label should be conservative.");

  let output = "";
  const child = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "eval-harness-smoke-session-secret-32",
      LLM_PROVIDER: "mock",
      LLM_LIVE_CALLS_ENABLED: "false",
      EVAL_LIVE_CALLS_ENABLED: "false",
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

    const teacherLogin = await login({
      user_id: "teacher_demo",
      password: "teacher_demo_password"
    });
    assert(teacherLogin.response.status === 200, "Teacher login should work.");
    const studentLogin = await login({
      user_id: "student_demo",
      access_code: "student_demo_access_code"
    });
    assert(studentLogin.response.status === 200, "Student login should work.");

    const evalPage = await fetch(`${baseUrl}/teacher/evals`, {
      headers: { cookie: teacherLogin.cookie }
    });
    const evalPageText = await evalPage.text();
    assert(evalPage.status === 200, "Teacher should access eval UI.");
    assert(evalPageText.includes("Agent evaluation harness"), "Eval UI did not render expected title.");

    const runList = await jsonRequest<{ runs: unknown[] }>(
      "/api/teacher/evals/runs",
      teacherLogin.cookie
    );
    assert(runList.runs.length > 0, "Teacher can list eval runs.");
    assertNoPrivateData(JSON.stringify(runList), "Eval run list API");

    const studentApi = await fetch(`${baseUrl}/api/teacher/evals/runs`, {
      headers: { cookie: studentLogin.cookie }
    });
    assert(studentApi.status === 403, "Student should receive 403 from eval APIs.");

    const blindItem = await jsonRequest<{ item: { provider: string | null; model_name: string | null } }>(
      `/api/teacher/evals/run-items/${firstRunItem.run_item_public_id}`,
      teacherLogin.cookie
    );
    assert(blindItem.item.provider === null, "Blind run-item API should hide provider.");
    assert(blindItem.item.model_name === null, "Blind run-item API should hide model.");

    const unblindedItem = await jsonRequest<{ item: { provider: string | null; model_name: string | null } }>(
      `/api/teacher/evals/run-items/${firstRunItem.run_item_public_id}?show_provider=true`,
      teacherLogin.cookie
    );
    assert(unblindedItem.item.provider === "mock", "Provider should be visible when requested.");
    assert(unblindedItem.item.model_name === "gpt-5.4-mini", "Future target model metadata mismatch.");

    const annotationCreate = await jsonRequest(
      `/api/teacher/evals/run-items/${firstRunItem.run_item_public_id}/annotations`,
      teacherLogin.cookie,
      {
        method: "POST",
        body: JSON.stringify({
          blind_review: true,
          overall_rating: 2,
          pass_fail: "needs_review",
          rubric_scores: { schema_adherence: 2, task_relevance: 2 },
          safety_flags: ["schema_invalid"],
          notes: "Synthetic smoke annotation create."
        })
      }
    );
    assert(JSON.stringify(annotationCreate).includes("Synthetic smoke"), "Annotation create failed.");

    const annotationUpdate = await jsonRequest(
      `/api/teacher/evals/run-items/${firstRunItem.run_item_public_id}/annotations`,
      teacherLogin.cookie,
      {
        method: "POST",
        body: JSON.stringify({
          blind_review: true,
          overall_rating: 3,
          pass_fail: "pass",
          rubric_scores: { schema_adherence: 3, task_relevance: 3, safety: 3 },
          safety_flags: ["schema_invalid"],
          notes: "Synthetic smoke annotation update."
        })
      }
    );
    assert(JSON.stringify(annotationUpdate).includes("Synthetic smoke annotation update"), "Annotation update failed.");

    const summary = await jsonRequest<{ summary: { critical_failure_count: number } }>(
      "/api/teacher/evals/summary",
      teacherLogin.cookie
    );
    assert(summary.summary.critical_failure_count >= 1, "Critical failure flags should aggregate.");

    const exportResponse = await fetch(
      `${baseUrl}/api/teacher/evals/runs/${firstRun.run_public_id}/export`,
      { headers: { cookie: teacherLogin.cookie } }
    );
    const csvText = await exportResponse.text();
    assert(exportResponse.status === 200, "Eval export should download.");
    const rows = parse(csvText, { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;
    assert(rows.length > 0, "Eval export should parse with rows.");
    assert(rows[0].run_public_id === firstRun.run_public_id, "Eval export run_public_id mismatch.");
    assertNoPrivateData(csvText, "Eval export CSV");
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    child.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  await cleanupEvalFixtures();
  const preservedTeacher = await prisma.user.findUnique({ where: { user_id: "teacher_demo" } });
  const preservedStudent = await prisma.user.findUnique({ where: { user_id: "student_demo" } });
  assert(preservedTeacher, "Eval cleanup should preserve teacher_demo.");
  assert(preservedStudent, "Eval cleanup should preserve student_demo.");

  console.log("Evaluation harness smoke test passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanupEvalFixtures().catch(() => undefined);
    await prisma.$disconnect();
  });
