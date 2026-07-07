import { PrismaClient } from "@prisma/client";
import { canAccessTeacherReview } from "../src/lib/services/teacher-review/api";
import { getTeacherReadableTranscript } from "../src/lib/services/teacher-review/readable-transcript";
import { getTeacherReviewTranscript } from "../src/lib/services/teacher-review/transcripts";
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

function assertNoProtectedReadableText(value: unknown) {
  const serialized = JSON.stringify(value).toLowerCase();
  const forbidden = [
    "correct_option",
    "answer key",
    "correctness",
    "distractor_rationales",
    "possible_misconception_indicators",
    "raw_output",
    "api_key",
    "password_hash",
    "access_code_hash"
  ];

  for (const term of forbidden) {
    assert(!serialized.includes(term), `Readable transcript leaked protected term ${term}.`);
  }
}

async function addActivityAndLegacyEditTurns() {
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: teacherReviewSessionPublicId },
    select: {
      id: true,
      concept_unit_sessions: {
        take: 1,
        select: {
          id: true,
          item_responses: {
            orderBy: { item: { item_order: "asc" } },
            take: 1,
            select: { item_db_id: true }
          }
        }
      }
    }
  });
  const conceptUnitSession = session.concept_unit_sessions[0];
  const itemDbId = conceptUnitSession?.item_responses[0]?.item_db_id;
  assert(conceptUnitSession && itemDbId, "Fixture missing concept-unit item response.");

  await prisma.conversationTurn.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: itemDbId,
      phase: "initial_item_administration",
      actor_type: "student",
      message_text: "Edited my response.",
      structured_payload: {
        source: "student_response_in_flow_edit",
        changed_fields: ["reasoning"]
      }
    }
  });

  await prisma.conversationTurn.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      phase: "followup_active",
      actor_type: "agent",
      agent_name: "formative_activity_dialogue_agent",
      message_text: "Let us compare your idea with another possible explanation.",
      structured_payload: {
        source: "activity_runtime",
        safe_summary: true
      }
    }
  });
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.RUN_LIVE_LLM_SMOKE = "";

  await ensureTeacherReviewDemoFixture(prisma);

  try {
    const teacher = await prisma.user.findUniqueOrThrow({ where: { user_id: "teacher_demo" } });
    const student = await prisma.user.findUniqueOrThrow({ where: { user_id: "student_demo" } });
    assert(canAccessTeacherReview(teacher.role), "Teacher should be authorized for transcript routes.");
    assert(!canAccessTeacherReview(student.role), "Student should be rejected from transcript routes.");

    await addActivityAndLegacyEditTurns();

    const readable = await getTeacherReadableTranscript(teacherReviewSessionPublicId);
    assert(readable.session_public_id === teacherReviewSessionPublicId, "Readable transcript session mismatch.");
    assert(readable.turns.length >= 8, "Readable transcript should include fixture turns and added activity turn.");
    assert(
      readable.turns.some((turn) => turn.speaker === "agent") &&
        readable.turns.some((turn) => turn.speaker === "student"),
      "Readable transcript should include agent and student speakers."
    );
    assert(
      readable.turns.some((turn) => turn.phase_label === "Activity dialogue"),
      "Readable transcript should include available activity dialogue turns."
    );
    assert(
      readable.turns.some((turn) =>
        turn.speaker === "agent" &&
        typeof turn.next_student_response_latency_ms === "number" &&
        turn.next_student_response_latency_ms >= 0
      ),
      "Readable transcript should expose safe prompt-to-response latency when available."
    );
    assert(
      readable.turns.every((turn, index, turns) =>
        index === 0 || turn.turn_index > turns[index - 1].turn_index
      ),
      "Readable transcript turn order should be preserved."
    );
    assert(
      !readable.turns.some((turn) => turn.message_text === "Edited my response."),
      "Legacy edit placeholder should not remain visible."
    );
    assertNoProtectedReadableText(readable);

    const structured = await getTeacherReviewTranscript(teacherReviewSessionPublicId);
    assert(
      structured.turns.some((turn) => turn.structured_payload),
      "Structured payload audit transcript should remain available separately."
    );

    console.log("Student teacher readable transcript smoke test passed. No OpenAI calls are made by this script.");
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
