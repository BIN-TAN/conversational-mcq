import { PrismaClient } from "@prisma/client";
import { canAccessTeacherReview } from "../src/lib/services/teacher-review/api";
import { sessionListQuerySchema, processEventQuerySchema } from "../src/lib/services/teacher-review/filters";
import { getTeacherReviewItemResponses } from "../src/lib/services/teacher-review/item-responses";
import { getTeacherReviewProcessEvents } from "../src/lib/services/teacher-review/process-events";
import { getTeacherReviewResponsePackages } from "../src/lib/services/teacher-review/response-packages";
import { getTeacherReviewSessionDetail } from "../src/lib/services/teacher-review/session-detail";
import { listTeacherReviewSessions } from "../src/lib/services/teacher-review/sessions";
import { assertNoInternalIds } from "../src/lib/services/teacher-review/serializers";
import { getTeacherReviewTranscript } from "../src/lib/services/teacher-review/transcripts";
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

function assertChronological(values: Array<string | null>, message: string) {
  const timestamps = values.filter((value): value is string => Boolean(value));

  for (let index = 1; index < timestamps.length; index += 1) {
    assert(
      new Date(timestamps[index]).getTime() >= new Date(timestamps[index - 1]).getTime(),
      message
    );
  }
}

async function main() {
  await ensureTeacherReviewDemoFixture(prisma);

  try {
    const teacher = await prisma.user.findUniqueOrThrow({ where: { user_id: "teacher_demo" } });
    const student = await prisma.user.findUniqueOrThrow({ where: { user_id: "student_demo" } });

    assert(canAccessTeacherReview(teacher.role), "Teacher should be authorized for review routes.");
    assert(!canAccessTeacherReview(student.role), "Student should not be authorized for review routes.");

    const defaultList = await listTeacherReviewSessions(
      sessionListQuerySchema.parse({ page: "1", page_size: "25" })
    );
    assert(
      defaultList.sessions.some(
        (session) => session.session_public_id === teacherReviewSessionPublicId
      ),
      "Teacher could not list the demo session."
    );
    assertNoInternalIds(defaultList);

    const searched = await listTeacherReviewSessions(
      sessionListQuerySchema.parse({
        search: "student_demo",
        assessment_public_id: teacherReviewAssessmentPublicId,
        page: "1",
        page_size: "25"
      })
    );
    assert(
      searched.sessions.some((session) => session.student_user_id === "student_demo"),
      "Search by student user_id did not return the demo session."
    );

    const statusFiltered = await listTeacherReviewSessions(
      sessionListQuerySchema.parse({
        assessment_public_id: teacherReviewAssessmentPublicId,
        status: "active",
        page: "1",
        page_size: "25"
      })
    );
    assert(statusFiltered.sessions.length === 1, "Status filter did not isolate the active demo session.");

    const phaseFiltered = await listTeacherReviewSessions(
      sessionListQuerySchema.parse({
        assessment_public_id: teacherReviewAssessmentPublicId,
        phase: "profiling_pending",
        page: "1",
        page_size: "25"
      })
    );
    assert(phaseFiltered.sessions.length === 1, "Phase filter did not isolate profiling_pending.");

    const paginated = await listTeacherReviewSessions(
      sessionListQuerySchema.parse({ page: "1", page_size: "1" })
    );
    assert(paginated.pagination.page_size === 1, "Pagination page size was not honored.");

    const detail = await getTeacherReviewSessionDetail(teacherReviewSessionPublicId);
    assert(detail.session.session_public_id === teacherReviewSessionPublicId, "Detail public ID mismatch.");
    assert(detail.student.user_id === "student_demo", "Detail did not return student user_id.");
    assert(detail.future_agent_data.student_profile_count === 0, "Student profiles were fabricated.");
    assert(detail.future_agent_data.formative_decision_count === 0, "Formative decisions were fabricated.");
    assert(detail.future_agent_data.followup_round_count === 0, "Follow-up rounds were fabricated.");
    assert(detail.future_agent_data.agent_call_count === 0, "Agent calls should not exist.");
    assertNoInternalIds(detail);

    const itemResponses = await getTeacherReviewItemResponses(teacherReviewSessionPublicId);
    assertNoInternalIds(itemResponses);
    const rows = itemResponses.concept_units.flatMap((conceptUnit) => conceptUnit.item_responses);
    assert(rows.length === 3, "Expected exactly three item response rows.");
    assert(
      rows.map((row) => row.item_order).join(",") === "1,2,3",
      "Item responses are not ordered by item_order."
    );
    assert(rows[0].correctness === "correct", "Correctness was not visible for the correct row.");
    assert(rows[1].correctness === "incorrect", "Incorrect response was not visible.");
    assert(rows[2].response_state === "explicitly_skipped", "Skipped item was not distinct.");
    assert(rows[2].correctness === "unanswered", "Skipped evidence was collapsed into incorrect.");

    const transcript = await getTeacherReviewTranscript(teacherReviewSessionPublicId);
    assertNoInternalIds(transcript);
    assert(transcript.turns.length === 6, "Expected six transcript turns.");
    assertChronological(
      transcript.turns.map((turn) => turn.created_at),
      "Transcript turns were not chronological."
    );

    const processEvents = await getTeacherReviewProcessEvents(
      teacherReviewSessionPublicId,
      processEventQuerySchema.parse({ page: "1", page_size: "100" })
    );
    assertNoInternalIds(processEvents);
    assertChronological(
      processEvents.events.map((event) => event.occurred_at),
      "Process events were not chronological."
    );
    assert(processEvents.aggregates.page_switch_count === 2, "Page switch count mismatch.");
    assert(processEvents.aggregates.long_pause_count === 1, "Long pause count mismatch.");
    assert(processEvents.aggregates.inactivity_count === 1, "Inactivity count mismatch.");
    assert(processEvents.aggregates.navigation_event_count === 1, "Navigation count mismatch.");
    assert(processEvents.aggregates.invalid_help_request_count === 1, "Invalid help count mismatch.");
    assert(
      processEvents.aggregates.prompt_injection_attempt_count === 1,
      "Prompt-injection boundary count mismatch."
    );
    assert(processEvents.aggregates.reasoning_revision_count === 1, "Reasoning revision count mismatch.");
    assert(processEvents.aggregates.option_revision_count === 1, "Option revision count mismatch.");
    assert(processEvents.aggregates.validation_failure_count === 1, "Validation failure count mismatch.");
    assert(processEvents.aggregates.agent_retry_count === 0, "Agent retry count should be zero.");
    assert(processEvents.aggregates.followup_turn_count === 0, "Follow-up turn count should be zero.");

    const packageBefore = await prisma.responsePackage.findFirstOrThrow({
      where: {
        concept_unit_session: {
          assessment_session: { session_public_id: teacherReviewSessionPublicId }
        }
      },
      select: { created_at: true, payload: true }
    });
    const packages = await getTeacherReviewResponsePackages(teacherReviewSessionPublicId);
    assertNoInternalIds(packages);
    assert(packages.response_packages.length === 1, "Expected one response package.");
    const summary = packages.response_packages[0].payload_summary as {
      item_count?: number;
      completed_response_count?: number;
      skipped_response_count?: number;
      revision_count?: number;
      transcript_turn_count?: number;
    };
    assert(summary.item_count === 3, "Response-package item count mismatch.");
    assert(summary.completed_response_count === 3, "Response-package completed count mismatch.");
    assert(summary.skipped_response_count === 1, "Response-package skipped count mismatch.");
    assert(summary.revision_count === 3, "Response-package revision count mismatch.");
    assert(summary.transcript_turn_count === 6, "Response-package transcript count mismatch.");

    const packageAfter = await prisma.responsePackage.findFirstOrThrow({
      where: {
        concept_unit_session: {
          assessment_session: { session_public_id: teacherReviewSessionPublicId }
        }
      },
      select: { created_at: true, payload: true }
    });
    assert(
      JSON.stringify(packageBefore) === JSON.stringify(packageAfter),
      "Reading the response package mutated stored data."
    );

    await cleanupTeacherReviewDemoFixture(prisma);
    const preservedTeacher = await prisma.user.findUnique({ where: { user_id: "teacher_demo" } });
    const preservedStudent = await prisma.user.findUnique({ where: { user_id: "student_demo" } });
    const deletedAssessment = await prisma.assessment.findUnique({
      where: { assessment_public_id: teacherReviewAssessmentPublicId }
    });

    assert(preservedTeacher, "Cleanup should preserve teacher_demo.");
    assert(preservedStudent, "Cleanup should preserve student_demo.");
    assert(!deletedAssessment, "Cleanup should remove the fixture assessment only.");
    console.log("Teacher review smoke test passed.");
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
