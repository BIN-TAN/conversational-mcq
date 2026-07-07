import { PrismaClient } from "@prisma/client";
import { canAccessTeacherReview } from "../src/lib/services/teacher-review/api";
import { buildTeacherSessionDataAudit } from "../src/lib/services/teacher-review/session-data-audit";
import { assertNoInternalIds } from "../src/lib/services/teacher-review/serializers";
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

function assertNoProtectedAuditData(value: unknown) {
  assertNoInternalIds(value);
  const serialized = JSON.stringify(value).toLowerCase();
  const forbidden = [
    "correct_option",
    "answer key",
    "distractor_rationales",
    "possible_misconception_indicators",
    "expected_reasoning_patterns",
    "raw_output",
    "process_event_db_id",
    "conversation_turn_db_id",
    "item_response_db_id",
    "password_hash",
    "access_code_hash",
    "api_key"
  ];

  for (const term of forbidden) {
    assert(!serialized.includes(term), `Teacher data audit leaked protected term ${term}.`);
  }
}

async function createNoProcessSession() {
  const fixtureSession = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: teacherReviewSessionPublicId },
    select: {
      user_db_id: true,
      assessment_db_id: true,
      assessment: {
        select: {
          concept_units: {
            orderBy: { order_index: "asc" },
            take: 1,
            select: { id: true }
          }
        }
      }
    }
  });
  const conceptUnitId = fixtureSession.assessment.concept_units[0]?.id;
  assert(conceptUnitId, "Teacher review fixture did not create a concept unit.");

  const session = await prisma.assessmentSession.create({
    data: {
      session_public_id: "session_demo_teacher_review_no_process",
      user_db_id: fixtureSession.user_db_id,
      assessment_db_id: fixtureSession.assessment_db_id,
      attempt_number: 2,
      status: "active",
      current_phase: "initial_item_administration",
      current_concept_unit_db_id: conceptUnitId
    }
  });

  await prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_db_id: conceptUnitId,
      status: "initial_in_progress"
    }
  });

  return session.session_public_id;
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.RUN_LIVE_LLM_SMOKE = "";

  await ensureTeacherReviewDemoFixture(prisma);

  try {
    const teacher = await prisma.user.findUniqueOrThrow({ where: { user_id: "teacher_demo" } });
    const student = await prisma.user.findUniqueOrThrow({ where: { user_id: "student_demo" } });
    assert(canAccessTeacherReview(teacher.role), "Teacher should be authorized for data audit routes.");
    assert(!canAccessTeacherReview(student.role), "Student should be rejected from data audit routes.");

    const beforeCounts = {
      process_events: await prisma.processEvent.count(),
      response_packages: await prisma.responsePackage.count(),
      activity_attempts: await prisma.activityRuntimeAttempt.count(),
      evidence_records: await prisma.activityMisconceptionEvidenceRecord.count(),
      snapshots: await prisma.postActivityDiagnosticSnapshot.count(),
      agent_calls: await prisma.agentCall.count()
    };

    const audit = await buildTeacherSessionDataAudit({
      session_public_id: teacherReviewSessionPublicId,
      write_artifact: false
    });
    assert(audit.session_public_id === teacherReviewSessionPublicId, "Audit returned wrong session.");
    assert(audit.data_completeness.response_package.item_attempt_count === 3, "Expected three item attempts.");
    assert(audit.data_completeness.response_package.initial_package_count === 1, "Expected one initial package.");
    assert(audit.process_data_summary.process_event_count > 0, "Expected process events in fixture.");
    assert(
      audit.process_data_summary.observed_event_type_count > 0,
      "Expected observed process event types."
    );
    assert(
      audit.response_evidence_summary.latest_initial_package_available,
      "Expected latest response package evidence summary."
    );
    assert(
      audit.engagement_evidence_summary.engagement_packet_available,
      "Expected engagement packet to be buildable from response package."
    );
    assert(audit.activity_runtime_summary.attempt_count === 0, "Fixture should not fabricate activity attempts.");
    assert(
      audit.limitations.includes("activity_runtime_attempts_missing"),
      "Missing activity runtime should be reported as a limitation."
    );
    assertNoProtectedAuditData(audit);

    const emptySessionPublicId = await createNoProcessSession();
    const emptyAudit = await buildTeacherSessionDataAudit({
      session_public_id: emptySessionPublicId,
      write_artifact: false
    });
    assert(
      emptyAudit.limitations.includes("process_events_missing"),
      "Missing process events should be reported as a limitation."
    );
    assert(
      emptyAudit.process_data_summary.availability.focus_visibility_events_available === false,
      "Missing process session should not report focus instrumentation."
    );
    assertNoProtectedAuditData(emptyAudit);

    const afterCounts = {
      process_events: await prisma.processEvent.count(),
      response_packages: await prisma.responsePackage.count(),
      activity_attempts: await prisma.activityRuntimeAttempt.count(),
      evidence_records: await prisma.activityMisconceptionEvidenceRecord.count(),
      snapshots: await prisma.postActivityDiagnosticSnapshot.count(),
      agent_calls: await prisma.agentCall.count()
    };
    assert(
      afterCounts.process_events === beforeCounts.process_events &&
        afterCounts.response_packages === beforeCounts.response_packages &&
        afterCounts.activity_attempts === beforeCounts.activity_attempts &&
        afterCounts.evidence_records === beforeCounts.evidence_records &&
        afterCounts.snapshots === beforeCounts.snapshots &&
        afterCounts.agent_calls === beforeCounts.agent_calls,
      "Data audit should be read-only for evidence tables."
    );

    console.log("Student teacher session data audit smoke test passed.");
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
