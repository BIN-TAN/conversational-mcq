import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { submitStudentFollowupMessage } from "../src/lib/agents/followup/service";
import { drainAvailableWorkflowJobsOnce } from "../src/lib/workflow/worker";
import {
  chooseStudentConceptProgression,
  requestStudentConceptProgression
} from "../src/lib/services/concept-progression/progression";
import {
  getStudentSessionState,
  recordSelectedOption
} from "../src/lib/services/student-assessment/service";
import { StudentAssessmentServiceError } from "../src/lib/services/student-assessment/errors";
import {
  assert,
  assertNoStudentProfileOrPlanningLabels,
  cleanupFollowupSmoke
} from "./followup-smoke-fixture";
import {
  assertNoOpenAiCalls,
  createReadyFollowupFixture,
  setPhase6D3SmokeEnv
} from "./concept-progression-smoke-helpers";

const prisma = new PrismaClient();
const prefix = `phase6d3_progression_${Date.now()}_${randomUUID().slice(0, 8)}`;

async function drainAll() {
  for (let index = 0; index < 5; index += 1) {
    const processed = await drainAvailableWorkflowJobsOnce({
      worker_id: `${prefix}_worker_${index}`
    });

    if (processed.length === 0) {
      return;
    }

    assert(
      processed.every((job) => job.outcome === "completed"),
      `Expected completed progression jobs, received ${JSON.stringify(processed)}.`
    );
  }
}

async function assertPriorConceptReadOnly(input: {
  student_user_db_id: string;
  session_public_id: string;
  prior_item_public_id: string;
}) {
  try {
    await recordSelectedOption({
      student_user_db_id: input.student_user_db_id,
      session_public_id: input.session_public_id,
      item_public_id: input.prior_item_public_id,
      data: {
        selected_option: "A",
        client_action_id: `${prefix}_prior_edit`
      }
    });
  } catch (error) {
    assert(error instanceof StudentAssessmentServiceError, "Prior concept edit should return student assessment error.");
    assert(error.code === "concept_no_longer_current", `Expected concept_no_longer_current, received ${error.code}.`);
    return;
  }

  throw new Error("Prior concept edit should have failed.");
}

async function simpleNextConceptProgression() {
  const fixture = await createReadyFollowupFixture({
    prisma,
    prefix,
    suffix: "simple_next",
    extra_concept_count: 1
  });

  const request = await requestStudentConceptProgression({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id,
    data: { client_action_id: `${prefix}_request_simple` }
  });
  assert(request.progression?.progression_public_id, "Progression request should return a public progression ID.");
  assertNoStudentProfileOrPlanningLabels(request, "Progression request response");

  const choice = await chooseStudentConceptProgression({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id,
    progression_public_id: request.progression.progression_public_id,
    data: {
      choice: "next_concept",
      client_action_id: `${prefix}_choice_simple`
    }
  });
  assert(choice.choice_status === "next_concept_ready", "Student choice should activate the next concept.");

  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: fixture.session.id },
    include: { current_concept_unit: true }
  });
  assert(session.current_phase === "concept_unit_intro", "Next concept should open at concept_unit_intro.");
  assert(
    session.current_concept_unit?.id === fixture.extraConcepts[0].id,
    "Next concept should follow teacher-defined order_index."
  );

  const currentState = await getStudentSessionState({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id
  });
  assert(currentState.next_step === "concept_unit_intro", "Student should see the next concept intro.");
  assertNoStudentProfileOrPlanningLabels(currentState, "Student next-concept state");
  await assertPriorConceptReadOnly({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id,
    prior_item_public_id: fixture.items[0].item_public_id
  });
  await assertNoOpenAiCalls(prisma, fixture.session.id);
}

async function finalUpdateBeforeProgression() {
  const fixture = await createReadyFollowupFixture({
    prisma,
    prefix,
    suffix: "final_update_next",
    extra_concept_count: 1
  });

  await submitStudentFollowupMessage({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id,
    message: "I can now apply the idea to a new case and explain why it transfers.",
    client_message_id: `${prefix}_substantive_message`,
    mock_provider_mode: "followup_evidence_trigger"
  });
  const request = await requestStudentConceptProgression({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id,
    data: { client_action_id: `${prefix}_request_final_update` }
  });
  const progressionPublicId = request.progression?.progression_public_id;
  assert(progressionPublicId, "Progression request should have public ID.");

  const firstChoice = await chooseStudentConceptProgression({
    student_user_db_id: fixture.student.id,
    session_public_id: fixture.session.session_public_id,
    progression_public_id: progressionPublicId,
    data: {
      choice: "next_concept",
      client_action_id: `${prefix}_choice_final_update`
    }
  });
  assert(firstChoice.choice_status === "final_update_pending", "Substantive evidence should trigger final update before movement.");

  const pendingProgression = await prisma.conceptProgressionRecord.findUniqueOrThrow({
    where: { progression_public_id: progressionPublicId },
    include: { final_update_cycle: true }
  });
  assert(pendingProgression.status === "final_update_pending", "Progression should wait for final update.");
  assert(pendingProgression.final_update_cycle?.post_cycle_action === "advance_to_next_concept", "Final update should carry advance post-cycle action.");

  await drainAll();

  const afterDrain = await prisma.conceptProgressionRecord.findUniqueOrThrow({
    where: { progression_public_id: progressionPublicId }
  });

  if (afterDrain.status === "awaiting_unresolved_confirmation") {
    await chooseStudentConceptProgression({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id,
      progression_public_id: progressionPublicId,
      data: {
        choice: "next_concept",
        client_action_id: `${prefix}_choice_unresolved_confirm`
      }
    });
  }

  const completed = await prisma.conceptProgressionRecord.findUniqueOrThrow({
    where: { progression_public_id: progressionPublicId }
  });
  assert(completed.status === "completed", "Progression should complete after final update/resolution workflow.");

  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: fixture.session.id }
  });
  assert(session.current_phase === "concept_unit_intro", "Session should progress to the next concept intro.");
  await assertNoOpenAiCalls(prisma, fixture.session.id);
}

async function main() {
  setPhase6D3SmokeEnv();
  await cleanupFollowupSmoke(prisma, prefix);

  try {
    await simpleNextConceptProgression();
    await finalUpdateBeforeProgression();
    await cleanupFollowupSmoke(prisma, prefix);
    console.log("concept progression smoke passed");
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
