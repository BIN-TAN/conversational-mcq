import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";
import { buildAnalysisReadyResearchDataBundle } from "../src/lib/services/teacher-research-data/analysis-ready-export";
import {
  buildAnalysisReadyDictionaryEntries,
  buildExcludedPlatformVariableEntries
} from "../src/lib/services/teacher-research-data/dictionary";
import {
  cleanupTeacherReviewDemoFixture,
  ensureTeacherReviewDemoFixture,
  teacherReviewAssessmentPublicId
} from "./demo-teacher-review-fixture";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parseCsv<T extends Record<string, string>>(content: string): T[] {
  return parse(content, { columns: true, skip_empty_lines: true }) as T[];
}

function fileData(files: Array<{ path: string; data: string }>, path: string) {
  const file = files.find((entry) => entry.path === path);
  assert(file, `Missing ${path}.`);
  return file.data;
}

function header(content: string) {
  return content.split(/\r?\n/, 1)[0]?.split(",") ?? [];
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.RUN_LIVE_LLM_SMOKE = "";

  const researchVariables = buildAnalysisReadyDictionaryEntries();
  const excluded = buildExcludedPlatformVariableEntries();
  assert(excluded.some((entry) => entry.field_name === "password_hash" && entry.export_policy === "never_exported"), "Password hashes must be never exported.");
  assert(excluded.some((entry) => entry.field_name === "access_code_hash" && entry.export_policy === "never_exported"), "Access-code hashes must be never exported.");
  assert(excluded.some((entry) => entry.field_name === "email"), "Emails should be in the excluded inventory.");
  assert(!researchVariables.some((entry) => /email|password|access_code|auth_token|session_token|secret|database_url/i.test(entry.variable_name)), "PII/secrets must not be research variables.");

  await cleanupTeacherReviewDemoFixture(prisma);
  await ensureTeacherReviewDemoFixture(prisma);
  try {
    const teacher = await prisma.user.findUniqueOrThrow({ where: { user_id: "teacher_demo" } });
    const result = await buildAnalysisReadyResearchDataBundle({
      teacher_user_db_id: teacher.id,
      scope: "selected_assessment",
      assessment_public_id: teacherReviewAssessmentPublicId
    });
    const sessions = parseCsv<Record<string, string>>(fileData(result.files, "sessions.csv"));
    const itemResponses = parseCsv<Record<string, string>>(fileData(result.files, "item_responses.csv"));
    const processEvents = parseCsv<Record<string, string>>(fileData(result.files, "process_events.csv"));

    assert(sessions.length > 0, "Fixture should export session rows.");
    assert(sessions.every((row) => row.research_student_id?.startsWith("rs_")), "research_student_id should be pseudonymous.");
    assert(sessions.every((row) => row.student_id === row.research_student_id), "legacy student_id should be pseudonymous.");
    assert(itemResponses.every((row) => row.research_student_id === sessions[0].research_student_id), "Pseudonym should be consistent across item responses.");
    assert(processEvents.every((row) => row.research_student_id === sessions[0].research_student_id), "Pseudonym should be consistent across process events.");
    assert(!result.files.some((file) => /teacher_demo|student_demo|@|password_hash|access_code_hash|OPENAI_API_KEY/i.test(file.data)), "Default research export must not expose usernames, emails, hashes, or secrets.");
    assert(!result.files.some((file) => header(file.data).some((column) => /^id$|_db_id$/.test(column))), "Default research export must not expose internal DB IDs.");
    assert(!result.files.some((file) => file.path === "internal_schema_appendix.csv"), "Internal schema appendix should not be in the default ZIP.");
    assert(!result.files.some((file) => file.path === "excluded_platform_variables.csv"), "Excluded field inventory should not be in the default ZIP.");

    const restricted = await buildAnalysisReadyResearchDataBundle({
      teacher_user_db_id: teacher.id,
      scope: "selected_assessment",
      assessment_public_id: teacherReviewAssessmentPublicId,
      include_restricted_fields: true
    });
    assert(header(fileData(restricted.files, "item_responses.csv")).includes("correct_option"), "Restricted keys require restricted export mode.");

    console.log(
      JSON.stringify(
        {
          status: "passed",
          research_student_id: sessions[0].research_student_id,
          excluded_fields_documented: excluded.length,
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
