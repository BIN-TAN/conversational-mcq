import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { startOrResumeStudentAssessmentSession, listAvailableAssessments } from "../src/lib/services/student-assessment/service";
import { StudentAssessmentServiceError } from "../src/lib/services/student-assessment/errors";
import { getTeacherReviewSessionDetail } from "../src/lib/services/teacher-review/session-detail";
import { pauseWorkflowAutomation, WorkflowOverrideError } from "../src/lib/workflow/overrides";
import {
  assert,
  cleanupFollowupSmoke
} from "./followup-smoke-fixture";
import {
  createReadyFollowupFixture,
  setPhase6D3SmokeEnv
} from "./concept-progression-smoke-helpers";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

const prisma = new PrismaClient();
const prefix = `phase6d3_nonintervention_${Date.now()}_${randomUUID().slice(0, 8)}`;

async function assertStudentStartBlocked(studentDbId: string, assessmentPublicId: string) {
  try {
    await startOrResumeStudentAssessmentSession({
      student_user_db_id: studentDbId,
      assessment_public_id: assessmentPublicId
    });
  } catch (error) {
    assert(error instanceof StudentAssessmentServiceError, "Manual-review start should fail with student service error.");
    assert(
      error.code === "assessment_manual_review_not_available",
      `Expected assessment_manual_review_not_available, received ${error.code}.`
    );
    return;
  }

  throw new Error("Manual-review start should be blocked by default.");
}

async function main() {
  setPhase6D3SmokeEnv({
    developmentControlsEnabled: false,
    allowManualReviewStarts: false
  });
  await cleanupFollowupSmoke(prisma, prefix);

  try {
    const fixture = await createReadyFollowupFixture({
      prisma,
      prefix,
      suffix: "default_controls",
      extra_concept_count: 1
    });
    await prisma.assessment.update({
      where: { id: fixture.assessment.id },
      data: { workflow_mode: "manual_review" }
    });
    await prisma.assessmentSession.update({
      where: { id: fixture.session.id },
      data: { workflow_mode_snapshot: "automatic" }
    });

    const detail = await getTeacherReviewSessionDetail(fixture.session.session_public_id);
    assert(!detail.automation.can_pause, "Teacher pause control should be hidden by default.");
    assert(!detail.automation.can_resume, "Teacher resume control should be hidden by default.");
    assert(!detail.automation.can_retry_current_step, "Teacher retry control should be hidden by default.");
    assert(!detail.automation.can_stop_followup, "Teacher stop-followup control should be hidden by default.");
    assert(
      detail.concept_unit_sessions.every(
        (unit) =>
          !unit.can_run_profiling &&
          !unit.can_run_planning &&
          !unit.can_start_followup &&
          !unit.can_run_followup_update
      ),
      "Teacher manual active-session trigger controls should be hidden by default."
    );

    let pauseRejected = false;

    try {
      await pauseWorkflowAutomation({
        session_public_id: fixture.session.session_public_id,
        teacher_user_db_id: fixture.teacher.id
      });
    } catch (error) {
      pauseRejected = true;
      assert(error instanceof WorkflowOverrideError, "Pause should fail with workflow override error.");
      assert(
        error.code === "active_session_controls_disabled",
        `Expected active_session_controls_disabled, received ${error.code}.`
      );
    }
    assert(pauseRejected, "Pause automation should be rejected when development controls are disabled.");

    const accessCodeHash = await hashSecret(`${prefix}_ordinary_access`);
    const ordinaryStudent = await prisma.user.create({
      data: {
        user_id: `${prefix}_ordinary_student`,
        user_id_normalized: normalizeUserId(`${prefix}_ordinary_student`),
        role: "student",
        access_code_hash: accessCodeHash
      }
    });
    const availability = await listAvailableAssessments({
      student_user_db_id: ordinaryStudent.id
    });
    const row = availability.assessments.find(
      (assessment) => assessment.assessment_public_id === fixture.assessment.assessment_public_id
    );
    assert(row, "Manual-review assessment should be listed for visibility.");
    assert(!row.can_start, "Manual-review assessment should not allow ordinary new starts by default.");
    await assertStudentStartBlocked(ordinaryStudent.id, fixture.assessment.assessment_public_id);

    await cleanupFollowupSmoke(prisma, prefix);
    console.log("classroom non-intervention smoke passed");
  } catch (error) {
    await cleanupFollowupSmoke(prisma, prefix).catch(() => null);
    throw error;
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
