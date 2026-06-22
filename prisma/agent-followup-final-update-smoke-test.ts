import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  startFollowupRoundForTeacher,
  stopStudentFollowup,
  submitStudentFollowupMessage
} from "../src/lib/agents/followup/service";
import { drainAvailableWorkflowJobsOnce } from "../src/lib/workflow/worker";
import { getStudentSessionState } from "../src/lib/services/student-assessment/service";
import {
  assert,
  assertNoStudentProfileOrPlanningLabels,
  cleanupFollowupSmoke,
  createFollowupSmokeFixture,
  setFollowupSmokeEnv
} from "./followup-smoke-fixture";

const prisma = new PrismaClient();
const prefix = `phase6d2b_final_${Date.now()}_${randomUUID().slice(0, 8)}`;

async function drainAll() {
  const processed = await drainAvailableWorkflowJobsOnce({
    worker_id: `${prefix}_worker`
  });

  assert(processed.length > 0, "Expected final update workflow jobs.");
  assert(
    processed.every((job) => job.outcome === "completed"),
    `Expected completed jobs, received ${JSON.stringify(processed)}.`
  );
}

async function finalUpdateOnStopSmoke() {
  const fixture = await createFollowupSmokeFixture(prisma, {
    prefix,
    suffix: "final_stop",
    withProfile: true,
    withPlanning: true
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
  await submitStudentFollowupMessage({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id,
    message: "I changed my explanation and can now connect the evidence to the concept.",
    client_message_id: `${prefix}_final_message`,
    mock_provider_mode: "followup_evidence_trigger"
  });

  const beforeStopCycles = await prisma.followupUpdateCycle.count({
    where: { concept_unit_session_db_id: fixture.conceptUnitSession.id }
  });
  assert(beforeStopCycles === 0, "Manual-review evidence should wait for stop or teacher action.");

  const stopState = await stopStudentFollowup({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id
  });
  assert(stopState.current_phase === "followup_profile_update_pending", "Stop with evidence should enqueue a final update.");
  assertNoStudentProfileOrPlanningLabels(stopState, "Student stop state with final update");

  const pendingCycle = await prisma.followupUpdateCycle.findFirstOrThrow({
    where: { concept_unit_session_db_id: fixture.conceptUnitSession.id }
  });
  assert(pendingCycle.final_update, "Cycle should be marked as final update.");
  assert(!pendingCycle.create_next_round, "Final update must not create a next round.");
  assert(pendingCycle.stop_after_cycle, "Final update should stop after the cycle.");

  await drainAll();

  const completedCycle = await prisma.followupUpdateCycle.findUniqueOrThrow({
    where: { id: pendingCycle.id }
  });
  assert(completedCycle.status === "completed", "Final update cycle should complete.");
  assert(completedCycle.staged_profile_output, "Final cycle should stage profile output.");
  assert(completedCycle.staged_planning_output, "Final cycle should stage planning output.");
  assert(!completedCycle.staged_opening_output, "Final cycle should not generate an opening output.");

  const after = await prisma.conceptUnitSession.findUniqueOrThrow({
    where: { id: fixture.conceptUnitSession.id },
    select: {
      latest_student_profile_db_id: true,
      latest_formative_decision_db_id: true,
      followup_round_count: true,
      followup_status: true
    }
  });
  assert(after.latest_student_profile_db_id !== before.latest_student_profile_db_id, "Final update should activate updated profile.");
  assert(after.latest_formative_decision_db_id !== before.latest_formative_decision_db_id, "Final update should activate updated planning.");
  assert(after.followup_round_count === 1, "Final update should not create a new follow-up round.");
  assert(after.followup_status === "stopped", "Concept-unit follow-up should be stopped.");

  const activeRoundCount = await prisma.followupRound.count({
    where: { concept_unit_session_db_id: fixture.conceptUnitSession.id, status: "active" }
  });
  assert(activeRoundCount === 0, "No active round should remain after final stop update.");

  const finalState = await getStudentSessionState({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id
  });
  assert(finalState.next_step === "followup_stopped", "Student should see stopped follow-up after final update.");
  assertNoStudentProfileOrPlanningLabels(finalState, "Student final state");
}

async function stopDuringActiveCycleSmoke() {
  const fixture = await createFollowupSmokeFixture(prisma, {
    prefix,
    suffix: "stop_active_cycle",
    withProfile: true,
    withPlanning: true
  });
  await prisma.assessmentSession.update({
    where: { id: fixture.session.id },
    data: { workflow_mode_snapshot: "automatic" }
  });
  await startFollowupRoundForTeacher({
    session_public_id: fixture.session.session_public_id,
    concept_unit_public_id: fixture.conceptUnit.concept_unit_public_id,
    requested_by_user_db_id: fixture.teacher.id
  });
  await submitStudentFollowupMessage({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id,
    message: "Now I can apply the idea to the evidence in the item.",
    client_message_id: `${prefix}_active_cycle_message`,
    mock_provider_mode: "followup_evidence_trigger"
  });

  const pendingCycle = await prisma.followupUpdateCycle.findFirstOrThrow({
    where: { concept_unit_session_db_id: fixture.conceptUnitSession.id }
  });
  assert(!pendingCycle.stop_after_cycle, "Automatic cycle should start as a continuing update.");

  await stopStudentFollowup({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id
  });

  const updatedCycle = await prisma.followupUpdateCycle.findUniqueOrThrow({
    where: { id: pendingCycle.id }
  });
  assert(updatedCycle.stop_after_cycle, "Stop during active cycle should mark stop_after_cycle.");
  assert(updatedCycle.final_update, "Stop during active cycle should mark final_update.");
  assert(!updatedCycle.create_next_round, "Stop during active cycle must suppress next round.");

  await drainAll();

  const completedCycle = await prisma.followupUpdateCycle.findUniqueOrThrow({
    where: { id: pendingCycle.id }
  });
  assert(completedCycle.status === "completed", "Stop-after-active-cycle update should complete.");

  const activeRoundCount = await prisma.followupRound.count({
    where: { concept_unit_session_db_id: fixture.conceptUnitSession.id, status: "active" }
  });
  assert(activeRoundCount === 0, "Stop-after-active-cycle should leave no active round.");
}

async function main() {
  setFollowupSmokeEnv({
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
    FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE: "3"
  });

  await cleanupFollowupSmoke(prisma, prefix);

  try {
    await finalUpdateOnStopSmoke();
    await stopDuringActiveCycleSmoke();
    await cleanupFollowupSmoke(prisma, prefix);
    console.log("follow-up final update smoke passed");
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
