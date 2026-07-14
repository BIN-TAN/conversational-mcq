import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";
import { buildAnalysisReadyResearchDataBundle } from "../src/lib/services/teacher-research-data/analysis-ready-export";
import {
  AGENT_ACTIVITY_RECORDS_COLUMNS,
  ASSESSMENT_CONTENT_COLUMNS,
  ASSESSMENT_SUMMARY_COLUMNS,
  CONVERSATION_TURNS_COLUMNS,
  DATA_DICTIONARY_COLUMNS,
  ITEM_RESPONSES_COLUMNS,
  PROCESS_EVENTS_COLUMNS,
  SESSIONS_COLUMNS
} from "../src/lib/services/teacher-research-data/dictionary";
import {
  cleanupTeacherReviewDemoFixture,
  ensureTeacherReviewDemoFixture,
  teacherReviewAssessmentPublicId
} from "./demo-teacher-review-fixture";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
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

const restrictedDefaultColumns = new Set([
  "correct_option",
  "correctness",
  "correctness_support_level",
  "unsupported_correct_response",
  "estimated_guessing_risk",
  "answer_selection_evidence_weight",
  "teacher_llm_media_description",
  "target_reasoning_note",
  "strong_reasoning_note",
  "distractor_diagnostic_notes"
]);

function assertIsoUtc(value: string, label: string) {
  if (!value) return;
  assert(/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value), `${label} should be ISO UTC.`);
}

function assertNoJsonRequired(rows: Array<Record<string, string>>, label: string) {
  const jsonLikeColumns = Object.keys(rows[0] ?? {}).filter((column) =>
    rows.some((row) => /^[\[{]/.test(row[column] ?? ""))
  );
  assert(jsonLikeColumns.length === 0, `${label} should not require JSON parsing in primary columns.`);
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.RUN_LIVE_LLM_SMOKE = "";

  await cleanupTeacherReviewDemoFixture(prisma);
  await ensureTeacherReviewDemoFixture(prisma);

  try {
    const teacher = await prisma.user.findUniqueOrThrow({ where: { user_id: "teacher_demo" } });
    const beforeAgentCalls = await prisma.agentCall.count();
    const result = await buildAnalysisReadyResearchDataBundle({
      teacher_user_db_id: teacher.id,
      scope: "selected_assessment",
      assessment_public_id: teacherReviewAssessmentPublicId
    });

    const expectedFiles = [
      "sessions.csv",
      "item_responses.csv",
      "process_events.csv",
      "conversation_turns.csv",
      "agent_activity_records.csv",
      "assessment_content.csv",
      "assessment_summary.csv",
      "data_dictionary.csv"
    ];
    assert(result.filename.includes("research_dataset.zip"), "Research dataset filename should be explicit.");
    assert(result.no_live_provider_call_made === true, "Research dataset export should not make provider calls.");
    assert(result.files.map((file) => file.path).join("|") === expectedFiles.join("|"), "Unexpected ZIP file list.");

    const sessions = parseCsv<Record<string, string>>(fileData(result.files, "sessions.csv"));
    const itemResponses = parseCsv<Record<string, string>>(fileData(result.files, "item_responses.csv"));
    const processEvents = parseCsv<Record<string, string>>(fileData(result.files, "process_events.csv"));
    const turns = parseCsv<Record<string, string>>(fileData(result.files, "conversation_turns.csv"));
    const agentRecords = parseCsv<Record<string, string>>(fileData(result.files, "agent_activity_records.csv"));
    const contentRows = parseCsv<Record<string, string>>(fileData(result.files, "assessment_content.csv"));
    const summaryRows = parseCsv<Record<string, string>>(fileData(result.files, "assessment_summary.csv"));
    const dictionaryRows = parseCsv<Record<string, string>>(fileData(result.files, "data_dictionary.csv"));

    assert(sessions.length > 0, "sessions.csv should contain rows.");
    assert(itemResponses.length >= 3, "item_responses.csv should contain item-response rows.");
    assert(processEvents.length > 0, "process_events.csv should contain rows.");
    assert(turns.length > 0, "conversation_turns.csv should contain rows.");
    assert(contentRows.length >= 3, "assessment_content.csv should contain administered item snapshots.");
    assert(summaryRows.length > 0, "assessment_summary.csv should contain student-assessment summary rows.");
    assert(dictionaryRows.length > 300, "data_dictionary.csv should contain broad inventory rows.");
    assert(Array.isArray(agentRecords), "agent_activity_records.csv should parse even if sparse.");

    for (const [path, columns] of [
      ["sessions.csv", SESSIONS_COLUMNS],
      ["item_responses.csv", ITEM_RESPONSES_COLUMNS],
      ["process_events.csv", PROCESS_EVENTS_COLUMNS],
      ["conversation_turns.csv", CONVERSATION_TURNS_COLUMNS],
      ["agent_activity_records.csv", AGENT_ACTIVITY_RECORDS_COLUMNS],
      ["assessment_content.csv", ASSESSMENT_CONTENT_COLUMNS],
      ["assessment_summary.csv", ASSESSMENT_SUMMARY_COLUMNS],
      ["data_dictionary.csv", DATA_DICTIONARY_COLUMNS]
    ] as const) {
      const actualHeader = header(fileData(result.files, path));
      for (const column of columns) {
        if (restrictedDefaultColumns.has(column)) continue;
        assert(actualHeader.includes(column), `${path} is missing documented column ${column}.`);
      }
    }

    const itemHeader = header(fileData(result.files, "item_responses.csv"));
    const contentHeader = header(fileData(result.files, "assessment_content.csv"));
    for (const restricted of ["correct_option", "correctness", "distractor_diagnostic_notes", "teacher_llm_media_description"]) {
      assert(!itemHeader.includes(restricted), `Default item_responses.csv should omit ${restricted}.`);
      assert(!contentHeader.includes(restricted), `Default assessment_content.csv should omit ${restricted}.`);
    }

    const dictionaryKeys = new Set(dictionaryRows.map((row) => `${row.table_name}.${row.variable_name}`));
    for (const [path, tableName] of [
      ["sessions.csv", "sessions"],
      ["item_responses.csv", "item_responses"],
      ["process_events.csv", "process_events"],
      ["conversation_turns.csv", "conversation_turns"],
      ["agent_activity_records.csv", "agent_activity_records"],
      ["assessment_content.csv", "assessment_content"],
      ["assessment_summary.csv", "assessment_summary"]
    ] as const) {
      for (const column of header(fileData(result.files, path))) {
        assert(dictionaryKeys.has(`${tableName}.${column}`), `${path}.${column} missing from dictionary.`);
      }
    }

    assert(sessions.every((row) => row.session_public_id), "sessions.csv should use public session IDs.");
    assert(itemResponses.every((row) => row.session_public_id && row.item_snapshot_public_id), "item responses need join keys.");
    assert(new Set(itemResponses.map((row) => `${row.session_public_id}|${row.item_public_id}|${row.response_public_id}`)).size === itemResponses.length, "Item-response rows should be unique by public response key.");
    assertIsoUtc(sessions[0].export_generated_at, "export_generated_at");
    assertIsoUtc(sessions[0].started_at, "started_at");
    assert(header(fileData(result.files, "sessions.csv")).every((column) => !column.endsWith("_milliseconds")), "Millisecond columns should use _ms suffix.");
    assertNoJsonRequired(itemResponses, "item_responses.csv");
    assertNoJsonRequired(processEvents, "process_events.csv");

    const formulaFixture = await buildAnalysisReadyResearchDataBundle({
      teacher_user_db_id: teacher.id,
      scope: "selected_assessment",
      assessment_public_id: teacherReviewAssessmentPublicId,
      include_restricted_fields: true
    });
    assert(
      header(fileData(formulaFixture.files, "item_responses.csv")).includes("correct_option"),
      "Restricted mode should include explicit restricted columns."
    );
    assert(
      formulaFixture.files
        .filter((file) => file.path !== "data_dictionary.csv")
        .every((file) => !/password_hash|access_code_hash|SESSION_SECRET|OPENAI_API_KEY/i.test(file.data)),
      "Research dataset files should not expose secrets."
    );

    const afterAgentCalls = await prisma.agentCall.count();
    assert(beforeAgentCalls === afterAgentCalls, "Research dataset smoke should not create agent calls.");

    console.log(
      JSON.stringify(
        {
          status: "passed",
          file_count: result.files.length,
          session_rows: sessions.length,
          item_response_rows: itemResponses.length,
          process_event_rows: processEvents.length,
          dictionary_rows: dictionaryRows.length,
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
