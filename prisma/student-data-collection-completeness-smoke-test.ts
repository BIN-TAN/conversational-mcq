import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";
import { buildTeacherDetailedCsvBundle } from "../src/lib/services/teacher-detailed-csv-export/service";
import { buildTeacherSessionDataAudit } from "../src/lib/services/teacher-review/session-data-audit";
import {
  cleanupTeacherReviewDemoFixture,
  ensureTeacherReviewDemoFixture,
  teacherReviewAssessmentPublicId,
  teacherReviewSessionPublicId
} from "./demo-teacher-review-fixture";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parseCsv<T extends Record<string, string>>(content: string): T[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true
  }) as T[];
}

function fileData(files: Array<{ path: string; data: string }>, path: string) {
  const file = files.find((entry) => entry.path === path);
  assert(file, `Missing ${path}.`);
  return file.data;
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.RUN_LIVE_LLM_SMOKE = "";

  await cleanupTeacherReviewDemoFixture(prisma);
  await ensureTeacherReviewDemoFixture(prisma);

  try {
    const teacher = await prisma.user.findUniqueOrThrow({ where: { user_id: "teacher_demo" } });
    const beforeCounts = {
      agent_calls: await prisma.agentCall.count(),
      process_events: await prisma.processEvent.count(),
      conversation_turns: await prisma.conversationTurn.count(),
      item_responses: await prisma.itemResponse.count()
    };

    const audit = await buildTeacherSessionDataAudit({
      session_public_id: teacherReviewSessionPublicId,
      write_artifact: false
    });

    assert(audit.no_live_provider_call_made === true, "Session data audit should not make provider calls.");
    assert(audit.data_completeness.response_package.item_attempt_count >= 3, "Audit should see initial item attempts.");
    assert(audit.process_data_summary.process_event_count > 0, "Audit should see process events.");
    assert(
      audit.process_data_summary.observed_event_type_count > 0,
      "Audit should summarize observed process event types."
    );
    assert(
      audit.interpretation_boundary.includes("Process data are evidence-quality context"),
      "Audit should carry the process-data interpretation boundary."
    );

    const bundle = await buildTeacherDetailedCsvBundle({
      teacher_user_db_id: teacher.id,
      scope: "selected_assessment",
      assessment_public_id: teacherReviewAssessmentPublicId
    });
    const analysisRows = parseCsv<Record<string, string>>(fileData(bundle.files, "analysis_rows.csv"));
    const processRows = parseCsv<Record<string, string>>(fileData(bundle.files, "process_events.csv"));
    const latencyRows = parseCsv<Record<string, string>>(fileData(bundle.files, "turn_response_latencies.csv"));
    const conversationRows = parseCsv<Record<string, string>>(fileData(bundle.files, "conversation_turns.csv"));

    assert(analysisRows.length >= 3, "Analysis rows should expose item-level collected evidence.");
    assert(processRows.length === audit.process_data_summary.process_event_count, "Process CSV should match audit event count.");
    assert(latencyRows.length > 0, "Latency CSV should expose prompt-to-student timing rows.");
    assert(conversationRows.length > 0, "Conversation CSV should expose readable transcript turns.");
    assert(
      analysisRows.every((row) => row.reasoning_text !== undefined),
      "Analysis rows should include response reasoning columns."
    );
    assert(
      analysisRows.some((row) => Number(row.option_selection_count) > 0),
      "Analysis rows should include scalar process feature counts."
    );
    assert(
      processRows.every((row) => row.limitations === "raw_payload_excluded"),
      "Process event rows should document that raw payloads are excluded."
    );
    assert(
      latencyRows.every((row) => !row.response_latency_ms || Number(row.response_latency_ms) >= 0),
      "Latency rows should be nonnegative when measured."
    );
    assert(
      conversationRows.every((row) => !row.message_text.toLowerCase().includes("answer_key")),
      "Conversation export should not expose answer-key labels."
    );

    const afterCounts = {
      agent_calls: await prisma.agentCall.count(),
      process_events: await prisma.processEvent.count(),
      conversation_turns: await prisma.conversationTurn.count(),
      item_responses: await prisma.itemResponse.count()
    };
    assert(
      JSON.stringify(beforeCounts) === JSON.stringify(afterCounts),
      "Data collection completeness smoke should be read-only after fixture setup."
    );

    console.log("Data collection completeness smoke test passed.");
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
