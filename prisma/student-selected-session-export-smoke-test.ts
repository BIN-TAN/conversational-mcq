import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";
import { buildAnalysisReadyResearchDataBundle } from "../src/lib/services/teacher-research-data/analysis-ready-export";
import {
  cleanupTeacherReviewDemoFixture,
  ensureTeacherReviewDemoFixture
} from "./demo-teacher-review-fixture";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parseCsv<T extends Record<string, string>>(content: string): T[] {
  return parse(content, { columns: true, skip_empty_lines: true }) as T[];
}

function fileData(files: Array<{ path: string; data: string }>, filePath: string) {
  const file = files.find((candidate) => candidate.path === filePath);
  assert(file, `Missing ${filePath}.`);
  return file.data;
}

async function main() {
  process.env.APP_ENV = "production";
  process.env.RESEARCH_PSEUDONYMIZATION_KEY = "phase31ak-selected-session-smoke-key";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";

  await cleanupTeacherReviewDemoFixture(prisma);
  await ensureTeacherReviewDemoFixture(prisma);

  try {
    const teacher = await prisma.user.findUniqueOrThrow({ where: { user_id: "teacher_demo" } });
    const session = await prisma.assessmentSession.findFirstOrThrow({
      where: { user: { user_id: "student_demo" } },
      orderBy: { created_at: "asc" }
    });
    const beforeAgentCalls = await prisma.agentCall.count();
    const standard = await buildAnalysisReadyResearchDataBundle({
      teacher_user_db_id: teacher.id,
      scope: "selected_session",
      session_public_id: session.session_public_id,
      include_incomplete_sessions: true
    });
    const restricted = await buildAnalysisReadyResearchDataBundle({
      teacher_user_db_id: teacher.id,
      scope: "selected_session",
      session_public_id: session.session_public_id,
      include_incomplete_sessions: true,
      include_restricted_fields: true
    });

    assert(standard.filename.includes(session.session_public_id), "Selected-session filename should include public session ID.");
    assert(standard.files.some((file) => file.path === "session_diagnostic_manifest.json"), "Selected-session export should include diagnostic manifest.");
    assert(!fileData(standard.files, "item_responses.csv").split(/\r?\n/, 1)[0].includes("correct_option"), "Standard session export should omit restricted correctness fields.");
    assert(fileData(restricted.files, "item_responses.csv").split(/\r?\n/, 1)[0].includes("correct_option"), "Restricted session export should include restricted fields.");

    const sessionRows = parseCsv<Record<string, string>>(fileData(standard.files, "sessions.csv"));
    assert(sessionRows.length === 1, "Selected-session export should contain one session row.");
    assert(sessionRows[0].session_public_id === session.session_public_id, "Session row should match selected public session.");
    assert(sessionRows[0].student_id?.startsWith("rs_"), "Student ID should be pseudonymous.");
    assert(!JSON.stringify(standard.files).includes("student_demo"), "Selected-session export should not expose operational login username.");
    assert(
      (await prisma.agentCall.count()) === beforeAgentCalls,
      "Selected-session export smoke should not create provider calls."
    );

    console.log(
      JSON.stringify(
        {
          status: "passed",
          session_public_id: session.session_public_id,
          standard_file_count: standard.files.length,
          restricted_mode_checked: true,
          no_openai_call_occurred: true
        },
        null,
        2
      )
    );
  } finally {
    await cleanupTeacherReviewDemoFixture(prisma);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
