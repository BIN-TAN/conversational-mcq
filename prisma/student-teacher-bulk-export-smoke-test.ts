import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { canAccessTeacherReview } from "../src/lib/services/teacher-review/api";
import { buildTeacherResearchBulkExport } from "../src/lib/services/teacher-research-export/service";
import {
  cleanupTeacherReviewDemoFixture,
  ensureTeacherReviewDemoFixture,
  teacherReviewSessionPublicId
} from "./demo-teacher-review-fixture";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function entryText(exportResult: Awaited<ReturnType<typeof buildTeacherResearchBulkExport>>, pathName: string) {
  const entry = exportResult.files.find((file) => file.path === pathName);
  assert(entry, `Export entry ${pathName} missing.`);
  return Buffer.isBuffer(entry.data) ? entry.data.toString("utf8") : entry.data;
}

function assertNoUnsafeDefaultExportData(exportResult: Awaited<ReturnType<typeof buildTeacherResearchBulkExport>>) {
  const serializedDataFiles = exportResult.files
    .filter((file) => !["manifest.json", "README_EXPORT.md", "data_dictionary.json"].includes(file.path))
    .map((file) => Buffer.isBuffer(file.data) ? file.data.toString("utf8") : file.data)
    .join("\n")
    .toLowerCase();
  const forbidden = [
    "correct_option",
    "answer_key",
    "distractor_rationales",
    "possible_misconception_indicators",
    "raw_output",
    "input_payload",
    "output_payload",
    "api_key",
    "authorization:",
    "bearer "
  ];

  for (const term of forbidden) {
    assert(!serializedDataFiles.includes(term), `Default export leaked protected term ${term}.`);
  }
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.RUN_LIVE_LLM_SMOKE = "";

  await ensureTeacherReviewDemoFixture(prisma);

  try {
    const teacher = await prisma.user.findUniqueOrThrow({ where: { user_id: "teacher_demo" } });
    const student = await prisma.user.findUniqueOrThrow({ where: { user_id: "student_demo" } });
    assert(canAccessTeacherReview(teacher.role), "Teacher should be authorized for research export routes.");
    assert(!canAccessTeacherReview(student.role), "Student should be rejected from research export routes.");

    const beforeCounts = {
      sessions: await prisma.assessmentSession.count(),
      agent_calls: await prisma.agentCall.count(),
      response_packages: await prisma.responsePackage.count()
    };

    const exportResult = await buildTeacherResearchBulkExport({
      generated_by_role: "teacher_researcher"
    });
    assert(exportResult.buffer.subarray(0, 2).toString("utf8") === "PK", "Research export should be a ZIP.");
    const outputDir = path.join(process.cwd(), ".data", "teacher-research-export-smoke");
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, exportResult.filename), exportResult.buffer);

    const requiredEntries = [
      "manifest.json",
      "README_EXPORT.md",
      "data_dictionary.json",
      "students.csv",
      "sessions.csv",
      "item_responses.csv",
      "conversation_turns_readable.jsonl",
      "conversation_turns_structured_redacted.jsonl",
      "response_packages.jsonl",
      "process_events_summary.jsonl",
      "process_event_counts.csv",
      "engagement_evidence_packets.jsonl",
      "misconception_diagnosis_or_profile_packets.jsonl",
      "formative_purpose_or_value_packets.jsonl",
      "activity_runtime_attempts.jsonl",
      "activity_misconception_evidence_records.jsonl",
      "post_activity_diagnostic_snapshots.jsonl",
      "agent_calls_summary.jsonl",
      "session_data_completeness.jsonl",
      "limitations.jsonl"
    ];
    for (const pathName of requiredEntries) {
      assert(exportResult.files.some((file) => file.path === pathName), `${pathName} missing from export.`);
      assert(
        Number(exportResult.manifest.row_counts[pathName] ?? 0) >= 0,
        `${pathName} row count should be non-negative.`
      );
    }

    assert(!exportResult.files.some((file) => file.path === "restricted_item_keys.csv"), "Default export should not include restricted item keys.");
    assert(exportResult.manifest.restricted_item_keys_included === false, "Default manifest should mark restricted keys absent.");
    assert(entryText(exportResult, "sessions.csv").includes(teacherReviewSessionPublicId), "Sessions CSV should include fixture session.");
    assert(entryText(exportResult, "students.csv").includes("student_demo"), "Students CSV should include fixture student.");
    assert(entryText(exportResult, "conversation_turns_readable.jsonl").includes("Please choose an option"), "Readable transcript rows should be included.");
    assert(entryText(exportResult, "limitations.jsonl").length > 0, "Missing optional data should be represented as limitations.");
    assertNoUnsafeDefaultExportData(exportResult);

    const restrictedExport = await buildTeacherResearchBulkExport({
      session_public_id: teacherReviewSessionPublicId,
      generated_by_role: "teacher_researcher",
      include_restricted_item_keys: true
    });
    assert(
      restrictedExport.files.some((file) => file.path === "restricted_item_keys.csv"),
      "Restricted export should include item-key file when explicitly requested."
    );
    assert(
      restrictedExport.files.some((file) => file.path === "restricted_item_metadata_manifest.json"),
      "Restricted export should include restricted manifest when explicitly requested."
    );
    assert(restrictedExport.manifest.restricted_item_keys_included === true, "Restricted manifest flag should be true.");

    const afterCounts = {
      sessions: await prisma.assessmentSession.count(),
      agent_calls: await prisma.agentCall.count(),
      response_packages: await prisma.responsePackage.count()
    };
    assert(
      afterCounts.sessions === beforeCounts.sessions &&
        afterCounts.agent_calls === beforeCounts.agent_calls &&
        afterCounts.response_packages === beforeCounts.response_packages,
      "Research export should not mutate operational records."
    );

    console.log("Student teacher bulk export smoke test passed. No OpenAI calls are made by this script.");
  } finally {
    await cleanupTeacherReviewDemoFixture(prisma);
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
