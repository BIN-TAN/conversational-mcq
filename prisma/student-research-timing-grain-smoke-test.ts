import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";
import { buildAnalysisReadyResearchDataBundle } from "../src/lib/services/teacher-research-data/analysis-ready-export";
import {
  cleanupTeacherReviewDemoFixture,
  ensureTeacherReviewDemoFixture,
  teacherReviewAssessmentPublicId,
  teacherReviewSessionPublicId
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

async function addTimingFixtureTurns() {
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: teacherReviewSessionPublicId },
    select: {
      id: true,
      concept_unit_sessions: {
        take: 1,
        select: { id: true }
      }
    }
  });
  const conceptUnitSession = session.concept_unit_sessions[0];
  assert(conceptUnitSession, "Teacher review timing fixture missing concept-unit session.");
  const firstItem = await prisma.item.findFirstOrThrow({
    where: { item_public_id: "item_demo_teacher_review_1" },
    select: { id: true }
  });
  const base = new Date("2026-06-19T16:00:00.000Z");

  await prisma.conversationTurn.createMany({
    data: [
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: firstItem.id,
        phase: "initial_item_administration",
        actor_type: "agent",
        agent_name: "item_administration_tutor_agent",
        message_text: "How confident are you now?",
        structured_payload: { prompt_type: "confidence" },
        created_at: base
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: firstItem.id,
        phase: "initial_item_administration",
        actor_type: "student",
        message_text: "Medium",
        structured_payload: { confidence_rating: "medium" },
        created_at: new Date(base.getTime() + 4_000)
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: null,
        phase: "initial_concept_unit_completed",
        actor_type: "agent",
        agent_name: "assessment_orchestrator",
        message_text: "Review your three responses when you are ready.",
        structured_payload: { prompt_type: "package_review" },
        created_at: new Date(base.getTime() + 8_000)
      }
    ]
  });
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.RUN_LIVE_LLM_SMOKE = "";

  await cleanupTeacherReviewDemoFixture(prisma);
  const fixture = await ensureTeacherReviewDemoFixture(prisma);
  await addTimingFixtureTurns();

  try {
    const beforeAgentCalls = await prisma.agentCall.count();
    const result = await buildAnalysisReadyResearchDataBundle({
      teacher_user_db_id: fixture.teacher.id,
      scope: "selected_assessment",
      assessment_public_id: teacherReviewAssessmentPublicId
    });
    const itemRows = parseCsv<Record<string, string>>(fileData(result.files, "item_responses.csv"));
    const turnRows = parseCsv<Record<string, string>>(fileData(result.files, "conversation_turns.csv"));

    assert(itemRows.length === 3, `Expected exactly three item-response rows, received ${itemRows.length}.`);
    assert(
      new Set(itemRows.map((row) => row.item_public_id)).size === 3,
      "Each item-response duration should bind to a distinct administered item."
    );
    assert(
      itemRows.every((row) => Number(row.item_response_time_ms) > 0),
      "Each completed item-response row should preserve its own item_response_time_ms."
    );
    assert(
      itemRows.every((row) => row.session_public_id && row.research_student_id && row.attempt_number && row.item_public_id),
      "Item-response timing rows should include documented join keys."
    );

    const itemScopedLatencyRows = turnRows.filter((row) => row.item_public_id && row.response_or_action_latency_ms);
    const firstItemLatencies = itemScopedLatencyRows.filter((row) => row.item_public_id === "item_demo_teacher_review_1");
    const sessionScopedTurns = turnRows.filter((row) => !row.item_public_id);
    const nullLatencyRows = turnRows.filter((row) => row.response_or_action_latency_ms === "");

    assert(itemScopedLatencyRows.length >= 3, "Conversation-turn latency should be stored per applicable turn.");
    assert(firstItemLatencies.length >= 2, "One item can have multiple conversation-turn latency values.");
    assert(sessionScopedTurns.some((row) => row.phase === "initial_concept_unit_completed"), "Package-review turns may be session scoped.");
    assert(nullLatencyRows.length > 0, "Unavailable turn latency should remain null/blank.");
    assert(!turnRows.some((row) => row.response_or_action_latency_ms === "0"), "Null timing should not be coerced to zero.");
    assert(
      turnRows.every((row) => row.session_public_id && row.turn_index && row.actor_type && row.phase),
      "Conversation-turn timing rows should include documented join keys."
    );

    const afterAgentCalls = await prisma.agentCall.count();
    assert(beforeAgentCalls === afterAgentCalls, "Timing-grain smoke should not create agent calls.");

    console.log(JSON.stringify({
      status: "passed",
      item_response_rows: itemRows.length,
      item_scoped_latency_rows: itemScopedLatencyRows.length,
      first_item_latency_rows: firstItemLatencies.length,
      session_scoped_turn_rows: sessionScopedTurns.length,
      null_latency_rows: nullLatencyRows.length,
      no_openai_call_occurred: true
    }, null, 2));
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
