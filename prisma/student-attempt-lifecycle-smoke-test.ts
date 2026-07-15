import { PrismaClient } from "@prisma/client";
import { generatePublicId } from "../src/lib/services/ids";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import {
  endStudentAssessmentAttempt,
  exitStudentAssessmentSession,
  listAvailableAssessments,
  startOrResumeStudentAssessmentSession
} from "../src/lib/services/student-assessment/service";
import { recordStudentActivityRuntimeChoice } from "../src/lib/services/student-assessment/activity-runtime-ui";
import { closeAttemptAndAllowAnother } from "../src/lib/services/teacher-review/attempt-controls";
import { assert, cleanupFollowupSmoke } from "./followup-smoke-fixture";

const prisma = new PrismaClient();
const prefix = `p31al2_attempt_${Date.now()}`;

function setNoLiveRuntimeEnv() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.ITEM_ADMIN_TUTOR_MODE = "mock";
  process.env.ALLOW_LOCAL_MOCK_RUNTIME = "true";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "false";
}

async function cleanup() {
  const sessions = await prisma.assessmentSession.findMany({
    where: { assessment: { title: { startsWith: prefix } } },
    select: { session_public_id: true }
  });

  if (sessions.length > 0) {
    await prisma.activityRuntimeAttempt.deleteMany({
      where: { session_public_id: { in: sessions.map((session) => session.session_public_id) } }
    });
  }

  await cleanupFollowupSmoke(prisma, prefix);
}

async function createUser(input: { role: "student" | "teacher_researcher"; suffix: string }) {
  const userId = `${prefix}_${input.suffix}`;

  return prisma.user.create({
    data: {
      user_id: userId,
      user_id_normalized: normalizeUserId(userId),
      role: input.role,
      account_status: "active"
    }
  });
}

async function createAssessment(teacherId: string) {
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: generatePublicId("assessment"),
      title: `${prefix} assessment`,
      description: "Phase 31al2 attempt lifecycle smoke fixture.",
      status: "published",
      workflow_mode: "automatic",
      response_collection_mode: "llm_assisted",
      created_by_user_db_id: teacherId
    }
  });
  const conceptUnit = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: generatePublicId("concept_unit"),
      assessment_db_id: assessment.id,
      title: `${prefix} concept`,
      learning_objective: "Verify assessment attempt lifecycle behavior.",
      related_concept_description: "Synthetic lifecycle test concept.",
      administration_rules: {},
      order_index: 1,
      status: "published",
      version: 1
    }
  });

  for (const itemOrder of [1, 2, 3]) {
    await prisma.item.create({
      data: {
        item_public_id: generatePublicId("item"),
        concept_unit_db_id: conceptUnit.id,
        item_order: itemOrder,
        item_stem: `${prefix} item ${itemOrder}`,
        options: [
          { label: "A", text: "First option" },
          { label: "B", text: "Second option" },
          { label: "C", text: "Third option" },
          { label: "D", text: "Fourth option" }
        ],
        correct_option: "A",
        distractor_rationales: {
          B: "Synthetic distractor.",
          C: "Synthetic distractor.",
          D: "Synthetic distractor."
        },
        expected_reasoning_patterns: ["Explains the selected option."],
        possible_misconception_indicators: ["Uses unsupported evidence."],
        administration_rules: {},
        included_in_published_set: true,
        status: "published",
        version: 1
      }
    });
  }

  return { assessment, conceptUnit };
}

async function availabilityRow(studentDbId: string, assessmentPublicId: string) {
  const available = await listAvailableAssessments({ student_user_db_id: studentDbId });
  const row = available.assessments.find((entry) => entry.assessment_public_id === assessmentPublicId);

  assert(row, `Expected ${assessmentPublicId} in student availability list.`);
  return row;
}

async function eventCount(sessionPublicId: string, eventType: string) {
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: sessionPublicId },
    select: { id: true }
  });

  return prisma.processEvent.count({
    where: {
      assessment_session_db_id: session.id,
      event_type: eventType
    }
  });
}

async function activeAttemptCount(studentDbId: string, assessmentDbId: string) {
  const sessions = await prisma.assessmentSession.findMany({
    where: {
      user_db_id: studentDbId,
      assessment_db_id: assessmentDbId
    },
    select: { status: true, current_phase: true, completed_at: true }
  });

  return sessions.filter(
    (session) =>
      (session.status === "active" || session.status === "paused") &&
      session.current_phase !== "session_completed" &&
      session.current_phase !== "student_exited" &&
      !session.completed_at
  ).length;
}

async function createRuntimeAttempt(sessionPublicId: string, studentPublicId: string, assessmentPublicId: string, conceptUnitPublicId: string) {
  return prisma.activityRuntimeAttempt.create({
    data: {
      activity_attempt_public_id: generatePublicId("concept_progression"),
      session_public_id: sessionPublicId,
      student_public_id: studentPublicId,
      assessment_public_id: assessmentPublicId,
      concept_unit_id: conceptUnitPublicId,
      source_activity_packet_ref: {
        schema_version: "activity-runtime-lifecycle-smoke-v1",
        activity_packet_hash: "activity-runtime-lifecycle-smoke-hash",
        activity_family: "basic_concept_grounding",
        diagnostic_purpose: "conceptual_entry_grounding",
        selected_formative_value: "diagnostic_clarification",
        generation_source: "evidence_integrated_router",
        runtime_servable_to_student: true,
        review_only: false,
        safe_activity_prompt: "Try a short practice explanation.",
        expected_student_action_prompt: "Write one sentence.",
        distractor_role: "Synthetic distractor role",
        distractor_student_safe_description: "Synthetic safe distractor description"
      },
      activity_family: "basic_concept_grounding",
      diagnostic_purpose: "conceptual_entry_grounding",
      generation_source: "evidence_integrated_router",
      status: "awaiting_student_activity_response",
      limitations: []
    }
  });
}

async function main() {
  setNoLiveRuntimeEnv();
  await cleanup();

  const openAiCallsBefore = await prisma.agentCall.count({ where: { provider: "openai" } });
  const teacher = await createUser({ role: "teacher_researcher", suffix: "teacher" });
  const student = await createUser({ role: "student", suffix: "student" });
  const { assessment, conceptUnit } = await createAssessment(teacher.id);

  const initial = await availabilityRow(student.id, assessment.assessment_public_id);
  assert(initial.can_start === true, "Fresh assessment should be startable.");
  assert(initial.can_resume === false, "Fresh assessment should not have a resumable attempt.");
  assert(initial.attempt_policy?.attempts_used === 0, "Fresh attempt policy should report zero attempts.");

  const first = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: assessment.assessment_public_id
  });
  assert(first.session.attempt_number === 1, "First attempt should use attempt_number 1.");
  assert(await eventCount(first.session.session_public_id, "attempt_started") === 1, "attempt_started event missing.");

  const resumeOnly = await availabilityRow(student.id, assessment.assessment_public_id);
  assert(resumeOnly.can_start === false, "Active attempt should block a second active start.");
  assert(resumeOnly.can_resume === true, "Active attempt should be resumable.");
  assert(resumeOnly.attempt_policy?.resumable_attempt_present === true, "Attempt policy should expose resumable attempt.");
  assert(resumeOnly.attempt_policy?.student_may_end_attempt === true, "Attempt policy should expose student end action.");
  assert(
    /resume or end it/i.test(resumeOnly.student_safe_availability_message),
    "Availability message should tell the student to resume or end the current attempt."
  );

  const duplicate = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: assessment.assessment_public_id,
    new_attempt: true
  });
  assert(
    duplicate.session.session_public_id === first.session.session_public_id,
    "Explicit new attempt request must not create a concurrent active attempt."
  );
  assert(
    await activeAttemptCount(student.id, assessment.id) === 1,
    "Only one active/resumable attempt should exist."
  );

  const paused = await exitStudentAssessmentSession({
    student_user_db_id: student.id,
    session_public_id: first.session.session_public_id
  });
  assert(paused.exit_status === "paused" && paused.can_resume, "Pause and leave should remain resumable.");
  assert(await eventCount(first.session.session_public_id, "attempt_paused") === 1, "attempt_paused event missing.");
  assert(await eventCount(first.session.session_public_id, "session_paused") === 1, "session_paused event missing.");

  const resumed = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: assessment.assessment_public_id
  });
  assert(
    resumed.session.session_public_id === first.session.session_public_id,
    "Resume should reuse the paused session."
  );
  assert(await eventCount(first.session.session_public_id, "attempt_resumed") >= 1, "attempt_resumed event missing.");

  const ended = await endStudentAssessmentAttempt({
    student_user_db_id: student.id,
    session_public_id: first.session.session_public_id
  });
  assert(ended.end_status === "ended_by_student", "End attempt should terminalize the current attempt.");
  assert(ended.can_resume === false, "Ended attempt should not be resumable.");
  assert(await eventCount(first.session.session_public_id, "attempt_end_requested") === 1, "attempt_end_requested event missing.");
  assert(await eventCount(first.session.session_public_id, "attempt_ended_by_student") === 1, "attempt_ended_by_student event missing.");

  const afterStudentEnd = await availabilityRow(student.id, assessment.assessment_public_id);
  assert(afterStudentEnd.can_resume === false, "Student-ended attempt should not be resumable.");
  assert(afterStudentEnd.can_start === true, "Student-ended attempt should permit a later start when policy allows.");
  assert(afterStudentEnd.latest_terminal_attempt_number === 1, "Latest terminal attempt should be recorded.");

  const second = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: assessment.assessment_public_id,
    new_attempt: true
  });
  assert(second.session.session_public_id !== first.session.session_public_id, "Second attempt should get a new session ID.");
  assert(second.session.attempt_number === 2, "Second attempt should increment attempt_number.");
  assert(await activeAttemptCount(student.id, assessment.id) === 1, "Second start should leave one active attempt.");
  const secondSessionRecord = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: second.session.session_public_id },
    select: { id: true }
  });

  const conceptUnitSession = await prisma.conceptUnitSession.findUniqueOrThrow({
    where: {
      assessment_session_db_id_concept_unit_db_id: {
        assessment_session_db_id: secondSessionRecord.id,
        concept_unit_db_id: conceptUnit.id
      }
    }
  });
  await prisma.conceptUnitSession.update({
    where: { id: conceptUnitSession.id },
    data: { status: "initial_completed", initial_completed_at: new Date() }
  });
  await prisma.assessmentSession.update({
    where: { id: secondSessionRecord.id },
    data: {
      current_phase: "planning_completed",
      current_concept_unit_db_id: conceptUnit.id
    }
  });
  const activityAttempt = await createRuntimeAttempt(
    second.session.session_public_id,
    student.user_id,
    assessment.assessment_public_id,
    conceptUnit.concept_unit_public_id
  );
  const skippedProjection = await recordStudentActivityRuntimeChoice({
    student_user_db_id: student.id,
    session_public_id: second.session.session_public_id,
    activity_attempt_public_id: activityAttempt.activity_attempt_public_id,
    choice_state: "move_on",
    client_action_id: `${prefix}_skip_activity`
  });
  assert(skippedProjection.ui_state === "moved_on", "Activity skip should enter the moved_on compatibility state.");
  assert(skippedProjection.status_message !== "Moved on", "Student-facing status should not show generic Move on.");
  assert(
    !JSON.stringify(skippedProjection.feedback ?? {}).match(/\bmove on\b/i),
    "Student-facing feedback should not show generic move on wording."
  );
  const skippedAttempt = await prisma.activityRuntimeAttempt.findUniqueOrThrow({
    where: { activity_attempt_public_id: activityAttempt.activity_attempt_public_id }
  });
  assert(skippedAttempt.status === "move_on_recommended", "Skipped activity should use compatibility runtime status.");
  const postSkipSession = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: secondSessionRecord.id },
    select: { current_phase: true }
  });
  assert(postSkipSession.current_phase === "followup_stopped", "Activity skip should route to the next deterministic step.");
  assert(await eventCount(second.session.session_public_id, "formative_activity_skipped") === 1, "formative_activity_skipped event missing.");
  assert(await eventCount(second.session.session_public_id, "continue_to_transfer_selected") === 1, "continue_to_transfer_selected event missing.");

  const teacherClosed = await closeAttemptAndAllowAnother({
    session_public_id: second.session.session_public_id,
    teacher_user_db_id: teacher.id
  });
  assert(teacherClosed.status === "attempt_ended_by_teacher", "Teacher close should terminalize the attempt.");
  assert(await eventCount(second.session.session_public_id, "attempt_ended_by_teacher") === 1, "attempt_ended_by_teacher event missing.");
  assert(await eventCount(second.session.session_public_id, "new_attempt_available") === 1, "new_attempt_available event missing.");

  const third = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: assessment.assessment_public_id,
    new_attempt: true
  });
  assert(third.session.attempt_number === 3, "Teacher-closed attempt should allow an incremented new attempt.");
  assert(
    third.session.session_public_id !== second.session.session_public_id,
    "Teacher-closed attempt should not be overwritten or reused."
  );

  const sessionCount = await prisma.assessmentSession.count({
    where: {
      user_db_id: student.id,
      assessment_db_id: assessment.id
    }
  });
  assert(sessionCount === 3, "Historical attempts should be preserved.");
  const openAiCallsAfter = await prisma.agentCall.count({ where: { provider: "openai" } });
  assert(openAiCallsAfter === openAiCallsBefore, "Attempt lifecycle smoke must not create OpenAI calls.");

  console.log(JSON.stringify({
    status: "passed",
    assessment_public_id: assessment.assessment_public_id,
    attempts_preserved: sessionCount,
    no_openai_call_made: true
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  });
