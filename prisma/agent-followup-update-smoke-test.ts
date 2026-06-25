import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { submitStudentFollowupMessage, startFollowupRoundForTeacher } from "../src/lib/agents/followup/service";
import { drainAvailableWorkflowJobsOnce } from "../src/lib/workflow/worker";
import { getStudentSessionState } from "../src/lib/services/student-assessment/service";
import { getTeacherReviewSessionDetail } from "../src/lib/services/teacher-review/session-detail";
import {
  assert,
  assertNoForbiddenSerializedFields,
  assertNoStudentProfileOrPlanningLabels,
  cleanupFollowupSmoke,
  createFollowupSmokeFixture,
  setFollowupSmokeEnv
} from "./followup-smoke-fixture";

const prisma = new PrismaClient();
const prefix = `phase6d2b_update_${Date.now()}_${randomUUID().slice(0, 8)}`;

async function drainAll() {
  const processed = await drainAvailableWorkflowJobsOnce({
    worker_id: `${prefix}_worker`
  });

  assert(processed.length > 0, "Expected at least one follow-up update workflow job.");
  assert(
    processed.every((job) => job.outcome === "completed"),
    `Expected completed jobs, received ${JSON.stringify(processed)}.`
  );

  return processed;
}

async function automaticUpdateCycleSmoke() {
  const fixture = await createFollowupSmokeFixture(prisma, {
    prefix,
    suffix: "automatic_update",
    withProfile: true,
    withPlanning: true
  });
  await prisma.assessmentSession.update({
    where: { id: fixture.session.id },
    data: { workflow_mode_snapshot: "automatic" }
  });
  const before = await prisma.conceptUnitSession.findUniqueOrThrow({
    where: { id: fixture.conceptUnitSession.id },
    select: {
      latest_student_profile_db_id: true,
      latest_formative_decision_db_id: true
    }
  });

  await startFollowupRoundForTeacher({
    session_public_id: fixture.session.session_public_id,
    concept_unit_public_id: fixture.conceptUnit.concept_unit_public_id,
    requested_by_user_db_id: fixture.teacher.id
  });
  const roundOne = await prisma.followupRound.findFirstOrThrow({
    where: { concept_unit_session_db_id: fixture.conceptUnitSession.id, status: "active" },
    orderBy: [{ round_index: "desc" }]
  });
  const response = await submitStudentFollowupMessage({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id,
    message: "I revised my reasoning: now I think the evidence connects A to the concept relationship.",
    client_message_id: `${prefix}_automatic_message`,
    mock_provider_mode: "followup_evidence_trigger"
  });

  assert(response.message_status === "assistant_replied", "Student message should receive a saved assistant reply.");
  assertNoStudentProfileOrPlanningLabels(response, "Student follow-up update response");

  const pendingCycle = await prisma.followupUpdateCycle.findFirstOrThrow({
    where: { concept_unit_session_db_id: fixture.conceptUnitSession.id }
  });
  assert(pendingCycle.status === "pending", "Cycle should be pending before worker drain.");
  assert(pendingCycle.evidence_package_db_id, "Cycle should reference a follow-up evidence package.");

  const packageRecord = await prisma.responsePackage.findUniqueOrThrow({
    where: { id: pendingCycle.evidence_package_db_id ?? "" }
  });
  assert(packageRecord.package_type === "followup_evidence_update_package", "Expected follow-up evidence package.");
  assertNoForbiddenSerializedFields(packageRecord.payload, "Follow-up evidence package payload");

  const duplicateCycleCount = await prisma.followupUpdateCycle.count({
    where: { concept_unit_session_db_id: fixture.conceptUnitSession.id }
  });
  assert(duplicateCycleCount === 1, "One substantive student turn should create one update cycle.");

  await drainAll();

  const completedCycle = await prisma.followupUpdateCycle.findUniqueOrThrow({
    where: { id: pendingCycle.id }
  });
  assert(completedCycle.status === "completed", "Update cycle should complete.");
  assert(completedCycle.staged_profile_output, "Cycle should retain staged profile output for audit.");
  assert(completedCycle.staged_planning_output, "Cycle should retain staged planning output for audit.");
  assert(completedCycle.staged_opening_output, "Cycle should retain staged opening output for audit.");

  const after = await prisma.conceptUnitSession.findUniqueOrThrow({
    where: { id: fixture.conceptUnitSession.id },
    select: {
      latest_student_profile_db_id: true,
      latest_formative_decision_db_id: true,
      followup_round_count: true
    }
  });
  assert(after.latest_student_profile_db_id !== before.latest_student_profile_db_id, "Latest profile pointer should update only after completion.");
  assert(after.latest_formative_decision_db_id !== before.latest_formative_decision_db_id, "Latest decision pointer should update only after completion.");
  assert(after.followup_round_count === 2, "Successful update should create a second active follow-up round.");

  const oldRound = await prisma.followupRound.findUniqueOrThrow({ where: { id: roundOne.id } });
  assert(oldRound.status === "completed", "Source round should be completed after successful update.");
  assert(oldRound.updated_student_profile_db_id === after.latest_student_profile_db_id, "Source round should link to the updated profile.");

  const activeRound = await prisma.followupRound.findFirstOrThrow({
    where: { concept_unit_session_db_id: fixture.conceptUnitSession.id, status: "active" },
    orderBy: [{ round_index: "desc" }]
  });
  assert(activeRound.round_index === 2, "New active round should be round 2.");

  const teacherDetail = await getTeacherReviewSessionDetail(fixture.session.session_public_id);
  const conceptDetail = teacherDetail.concept_unit_sessions[0];
  assert(conceptDetail.latest_student_profile?.profile_type === "updated", "Teacher detail should show the updated saved profile.");
  assert(conceptDetail.followup_update_cycles[0]?.status === "completed", "Teacher detail should serialize completed update cycle.");
  assertNoForbiddenSerializedFields(teacherDetail, "Teacher update-cycle detail");

  const studentState = await getStudentSessionState({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id
  });
  assert(studentState.next_step === "followup_active", "Student should return to active follow-up after successful update.");
  assertNoStudentProfileOrPlanningLabels(studentState, "Student state after follow-up update");

  const openAiCalls = await prisma.agentCall.count({
    where: {
      assessment_session_db_id: fixture.session.id,
      provider: "openai"
    }
  });
  assert(openAiCalls === 0, "Follow-up update smoke must not call OpenAI.");
}

async function manualReviewReadinessSmoke() {
  const fixture = await createFollowupSmokeFixture(prisma, {
    prefix,
    suffix: "manual_ready",
    withProfile: true,
    withPlanning: true
  });

  await startFollowupRoundForTeacher({
    session_public_id: fixture.session.session_public_id,
    concept_unit_public_id: fixture.conceptUnit.concept_unit_public_id,
    requested_by_user_db_id: fixture.teacher.id
  });
  await submitStudentFollowupMessage({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id,
    message: "I can now explain the concept evidence in a clearer way.",
    client_message_id: `${prefix}_manual_message`,
    mock_provider_mode: "followup_evidence_trigger"
  });

  const cycleCount = await prisma.followupUpdateCycle.count({
    where: { concept_unit_session_db_id: fixture.conceptUnitSession.id }
  });
  assert(cycleCount === 0, "Manual-review sessions should not auto-create update cycles.");

  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: fixture.session.id },
    select: { needs_review: true, needs_review_reason: true }
  });
  assert(session.needs_review, "Manual-review substantive evidence should flag teacher review.");
  assert(
    session.needs_review_reason === "followup_evidence_ready_for_profile_update",
    "Manual-review readiness reason should be explicit."
  );

  const teacherDetail = await getTeacherReviewSessionDetail(fixture.session.session_public_id);
  assert(
    teacherDetail.concept_unit_sessions[0]?.can_run_followup_update,
    "Teacher detail should expose manual follow-up update trigger readiness."
  );
}

async function main() {
  setFollowupSmokeEnv({
    DEVELOPMENT_ACTIVE_SESSION_CONTROLS_ENABLED: "true",
    LLM_PROVIDER: "mock",
    LLM_LIVE_CALLS_ENABLED: "false",
    OPENAI_API_KEY: "",
    LLM_DAILY_STUDENT_CALL_LIMIT: "100",
    LLM_DAILY_STUDENT_TOKEN_LIMIT: "100000",
    LLM_DAILY_CLASS_CALL_LIMIT: "100",
    LLM_DAILY_CLASS_TOKEN_LIMIT: "100000",
    LLM_SESSION_CALL_LIMIT: "100",
    LLM_SESSION_TOKEN_LIMIT: "100000",
    LLM_AGENT_CALL_LIMIT_PER_SESSION: "50",
    LLM_USAGE_TIMEZONE: "UTC",
    FOLLOWUP_CONTEXT_MAX_TURNS: "8",
    FOLLOWUP_MESSAGE_MAX_CHARS: "1000",
    FOLLOWUP_CONTEXT_MAX_CHARS: "8000",
    FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE: "3",
    OPERATIONAL_AGENT_INTEGRATION_ENABLED: "true",
    OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED: "false"
  });

  await cleanupFollowupSmoke(prisma, prefix);

  try {
    await automaticUpdateCycleSmoke();
    await manualReviewReadinessSmoke();
    await cleanupFollowupSmoke(prisma, prefix);
    console.log("follow-up iterative update smoke passed");
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
