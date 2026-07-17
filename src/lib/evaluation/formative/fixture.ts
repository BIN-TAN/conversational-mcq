import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { hashSecret } from "@/lib/password";
import { normalizeUserId } from "@/lib/services/student-accounts/validation";
import {
  cleanupIsolatedFixedIrtMvpAssessmentFixture,
  createIsolatedFixedIrtMvpAssessmentFixture
} from "../../../../prisma/demo-student-assessment-fixture";

export type FormativeEvaluationFixture = Awaited<
  ReturnType<typeof createIsolatedFixedIrtMvpAssessmentFixture>
> & {
  fixture_key: string;
  student_user_db_id: string;
  student_public_id: string;
  session_public_ids: string[];
};

export async function createFormativeEvaluationFixture(input: {
  prisma: PrismaClient;
  scenario_id: string;
  seed: number;
}) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const fixtureKey = `e1_${input.scenario_id.slice(0, 24)}_${input.seed}_${suffix}`;
  const isolated = await createIsolatedFixedIrtMvpAssessmentFixture(input.prisma, fixtureKey);
  const studentPublicId = `student_${fixtureKey}`;
  const student = await input.prisma.user.create({
    data: {
      user_id: studentPublicId,
      user_id_normalized: normalizeUserId(studentPublicId),
      role: "student",
      access_code_hash: await hashSecret(`access_${fixtureKey}`)
    },
    select: { id: true }
  });
  return {
    ...isolated,
    fixture_key: fixtureKey,
    student_user_db_id: student.id,
    student_public_id: studentPublicId,
    session_public_ids: []
  } satisfies FormativeEvaluationFixture;
}

export async function cleanupFormativeEvaluationFixture(input: {
  prisma: PrismaClient;
  fixture: FormativeEvaluationFixture;
}) {
  const sessions = await input.prisma.assessmentSession.findMany({
    where: {
      OR: [
        { user_db_id: input.fixture.student_user_db_id },
        { session_public_id: { in: input.fixture.session_public_ids } }
      ]
    },
    select: { id: true, session_public_id: true }
  });
  const sessionIds = sessions.map((session) => session.id);
  const sessionPublicIds = sessions.map((session) => session.session_public_id);
  const conceptSessions = await input.prisma.conceptUnitSession.findMany({
    where: { assessment_session_db_id: { in: sessionIds } },
    select: { id: true }
  });
  const conceptSessionIds = conceptSessions.map((session) => session.id);
  const attempts = await input.prisma.activityRuntimeAttempt.findMany({
    where: { session_public_id: { in: sessionPublicIds } },
    select: { activity_attempt_public_id: true }
  });
  const attemptIds = attempts.map((attempt) => attempt.activity_attempt_public_id);
  const evidence = await input.prisma.activityMisconceptionEvidenceRecord.findMany({
    where: { activity_attempt_id: { in: attemptIds } },
    select: { id: true }
  });
  const agentCalls = await input.prisma.agentCall.findMany({
    where: { assessment_session_db_id: { in: sessionIds } },
    select: { id: true }
  });
  const agentCallIds = agentCalls.map((call) => call.id);

  await input.prisma.postActivityDiagnosticSnapshot.deleteMany({
    where: { evidence_record_db_id: { in: evidence.map((record) => record.id) } }
  });
  await input.prisma.activityMisconceptionEvidenceRecord.deleteMany({
    where: { activity_attempt_id: { in: attemptIds } }
  });
  await input.prisma.topicDialogueTurn.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await input.prisma.topicDialogue.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await input.prisma.studentCommunication.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await input.prisma.activityRuntimeAttempt.deleteMany({
    where: { session_public_id: { in: sessionPublicIds } }
  });
  await input.prisma.followupUpdateCycle.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await input.prisma.conceptProgressionRecord.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await input.prisma.workflowJob.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await input.prisma.workflowOverride.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await input.prisma.studentActionIdempotencyKey.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await input.prisma.assessmentLifecycleOperation.deleteMany({
    where: {
      OR: [
        { assessment_session_db_id: { in: sessionIds } },
        { target_session_public_id: { in: sessionPublicIds } },
        { resulting_session_public_id: { in: sessionPublicIds } },
        { target_assessment_public_id: input.fixture.assessment_public_id }
      ]
    }
  });
  await input.prisma.processEvent.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await input.prisma.conversationTurn.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await input.prisma.followupRound.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptSessionIds } }
  });
  await input.prisma.conceptUnitSession.updateMany({
    where: { id: { in: conceptSessionIds } },
    data: {
      latest_student_profile_db_id: null,
      latest_formative_decision_db_id: null
    }
  });
  await input.prisma.formativeDecision.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptSessionIds } }
  });
  await input.prisma.studentProfile.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptSessionIds } }
  });
  await input.prisma.responsePackage.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptSessionIds } }
  });
  await input.prisma.operationalAgentEffectiveResult.deleteMany({
    where: {
      OR: [
        { agent_call_db_id: { in: agentCallIds } },
        { operational_context_public_id: { in: sessionPublicIds } }
      ]
    }
  });
  await input.prisma.agentCall.deleteMany({
    where: { id: { in: agentCallIds } }
  });
  await input.prisma.itemResponse.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptSessionIds } }
  });
  await input.prisma.conceptUnitSession.deleteMany({
    where: { id: { in: conceptSessionIds } }
  });
  await input.prisma.assessmentSession.deleteMany({
    where: { id: { in: sessionIds } }
  });
  await input.prisma.user.deleteMany({ where: { id: input.fixture.student_user_db_id } });
  await cleanupIsolatedFixedIrtMvpAssessmentFixture(input.prisma, input.fixture);
  return {
    session_count: sessions.length,
    concept_session_count: conceptSessions.length,
    attempt_count: attempts.length,
    cleaned: true
  };
}
