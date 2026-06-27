import type { PrismaClient } from "@prisma/client";
import { listAvailableAssessments } from "../src/lib/services/student-assessment/service";
import { demoAssessmentPublicId } from "./demo-student-assessment-fixture";

export const demoResetStudentUserId = "student_demo";
export const demoResetDashboardPath = "/student/assessment";

export type DemoStudentMvpResetResult = {
  student_user_id: string;
  assessment_public_id: string;
  assessment_title: string;
  sessions_deleted: number;
  concept_unit_sessions_deleted: number;
  item_responses_deleted: number;
  conversation_turns_deleted: number;
  process_events_deleted: number;
  response_packages_deleted: number;
  agent_calls_deleted: number;
  student_profiles_deleted: number;
  formative_decisions_deleted: number;
  followup_rounds_deleted: number;
  followup_update_cycles_deleted: number;
  concept_progression_records_deleted: number;
  workflow_jobs_deleted: number;
  workflow_overrides_deleted: number;
  idempotency_keys_deleted: number;
  operational_effective_results_deleted: number;
  can_start_after_reset: boolean;
  availability_status_after_reset: string | null;
  student_safe_availability_message: string | null;
  dashboard_path: string;
};

function assertDevelopmentResetAllowed() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to reset demo MVP attempts when NODE_ENV=production.");
  }
}

export async function resetStudentDemoFixedMvpAttempt(
  prisma: PrismaClient
): Promise<DemoStudentMvpResetResult> {
  assertDevelopmentResetAllowed();

  const [student, assessment] = await Promise.all([
    prisma.user.findUnique({
      where: { user_id: demoResetStudentUserId },
      select: { id: true, user_id: true, role: true, account_status: true }
    }),
    prisma.assessment.findUnique({
      where: { assessment_public_id: demoAssessmentPublicId },
      select: { id: true, assessment_public_id: true, title: true }
    })
  ]);

  if (!student) {
    throw new Error("student_demo was not found. Run npm run prisma:seed before resetting the demo attempt.");
  }

  if (student.role !== "student") {
    throw new Error("student_demo is not a student account. Refusing to reset demo assessment data.");
  }

  if (student.account_status !== "active") {
    throw new Error("student_demo is not active. Run npm run prisma:seed or reactivate the demo account first.");
  }

  if (!assessment) {
    throw new Error(
      "The fixed IRT MVP assessment was not found. Run npm run prisma:seed before resetting the demo attempt."
    );
  }

  const deleted = await prisma.$transaction(async (tx) => {
    const sessions = await tx.assessmentSession.findMany({
      where: {
        user_db_id: student.id,
        assessment_db_id: assessment.id
      },
      select: { id: true }
    });
    const sessionIds = sessions.map((session) => session.id);

    const conceptUnitSessions = await tx.conceptUnitSession.findMany({
      where: { assessment_session_db_id: { in: sessionIds } },
      select: { id: true }
    });
    const conceptUnitSessionIds = conceptUnitSessions.map((session) => session.id);

    const agentCalls = await tx.agentCall.findMany({
      where: { assessment_session_db_id: { in: sessionIds } },
      select: { id: true }
    });
    const agentCallIds = agentCalls.map((call) => call.id);

    const operationalEffectiveResults = await tx.operationalAgentEffectiveResult.deleteMany({
      where: { agent_call_db_id: { in: agentCallIds } }
    });
    const workflowJobs = await tx.workflowJob.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    const workflowOverrides = await tx.workflowOverride.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    const idempotencyKeys = await tx.studentActionIdempotencyKey.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    const followupUpdateCycles = await tx.followupUpdateCycle.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    const conceptProgressionRecords = await tx.conceptProgressionRecord.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    const responsePackages = await tx.responsePackage.deleteMany({
      where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
    });
    const processEvents = await tx.processEvent.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    const conversationTurns = await tx.conversationTurn.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    const agentCallRows = await tx.agentCall.deleteMany({
      where: { assessment_session_db_id: { in: sessionIds } }
    });
    const followupRounds = await tx.followupRound.deleteMany({
      where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
    });
    const formativeDecisions = await tx.formativeDecision.deleteMany({
      where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
    });
    const studentProfiles = await tx.studentProfile.deleteMany({
      where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
    });
    const itemResponses = await tx.itemResponse.deleteMany({
      where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
    });
    const conceptUnitSessionRows = await tx.conceptUnitSession.deleteMany({
      where: { id: { in: conceptUnitSessionIds } }
    });
    const assessmentSessionRows = await tx.assessmentSession.deleteMany({
      where: { id: { in: sessionIds } }
    });

    return {
      sessions_deleted: assessmentSessionRows.count,
      concept_unit_sessions_deleted: conceptUnitSessionRows.count,
      item_responses_deleted: itemResponses.count,
      conversation_turns_deleted: conversationTurns.count,
      process_events_deleted: processEvents.count,
      response_packages_deleted: responsePackages.count,
      agent_calls_deleted: agentCallRows.count,
      student_profiles_deleted: studentProfiles.count,
      formative_decisions_deleted: formativeDecisions.count,
      followup_rounds_deleted: followupRounds.count,
      followup_update_cycles_deleted: followupUpdateCycles.count,
      concept_progression_records_deleted: conceptProgressionRecords.count,
      workflow_jobs_deleted: workflowJobs.count,
      workflow_overrides_deleted: workflowOverrides.count,
      idempotency_keys_deleted: idempotencyKeys.count,
      operational_effective_results_deleted: operationalEffectiveResults.count
    };
  });

  const availability = await listAvailableAssessments({ student_user_db_id: student.id });
  const fixedRow = availability.assessments.find(
    (row) => row.assessment_public_id === assessment.assessment_public_id
  );

  return {
    student_user_id: student.user_id,
    assessment_public_id: assessment.assessment_public_id,
    assessment_title: assessment.title,
    ...deleted,
    can_start_after_reset: Boolean(fixedRow?.can_start),
    availability_status_after_reset: fixedRow?.availability_status ?? null,
    student_safe_availability_message: fixedRow?.student_safe_availability_message ?? null,
    dashboard_path: demoResetDashboardPath
  };
}
