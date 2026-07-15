import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  completeInitialConceptUnitAdministration,
  getStudentSessionState,
  ingestFrontendProcessEvents,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession
} from "../src/lib/services/student-assessment/service";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import {
  assert,
  cleanupSmokeStudentSessions,
  completeInitialItem,
  createSmokeStudent,
  eventCounts
} from "./student-mvp-smoke-helpers";

const prisma = new PrismaClient();

process.env.LLM_PROVIDER = "mock";
process.env.LLM_LIVE_CALLS_ENABLED = "false";

async function counts(sessionPublicId: string) {
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: sessionPublicId },
    select: { id: true }
  });
  const conceptUnitSessions = await prisma.conceptUnitSession.findMany({
    where: { assessment_session_db_id: session.id },
    select: { id: true }
  });
  const conceptUnitSessionIds = conceptUnitSessions.map((entry) => entry.id);

  return {
    agent_calls: await prisma.agentCall.count({ where: { assessment_session_db_id: session.id } }),
    profiles: await prisma.studentProfile.count({
      where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
    }),
    decisions: await prisma.formativeDecision.count({
      where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
    }),
    rounds: await prisma.followupRound.count({
      where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
    }),
    response_packages: await prisma.responsePackage.count({
      where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
    }),
    activity_attempts: await prisma.activityRuntimeAttempt.count({ where: { session_public_id: sessionPublicId } }),
    package_feedback_turns: await prisma.conversationTurn.count({
      where: {
        assessment_session_db_id: session.id,
        structured_payload: { path: ["message_type"], equals: "package_feedback" }
      }
    }),
    next_interaction_turns: await prisma.conversationTurn.count({
      where: {
        assessment_session_db_id: session.id,
        structured_payload: { path: ["message_type"], equals: "next_interaction" }
      }
    }),
    events: eventCounts(await prisma.processEvent.findMany({
      where: { assessment_session_db_id: session.id },
      select: { event_type: true }
    }))
  };
}

async function preparePackageReview(prefix: string) {
  await ensureDemoStudentAssessment(prisma);
  const student = await createSmokeStudent({
    prisma,
    prefix,
    accessCode: `${prefix}_access`
  });
  const sessionPublicIds: string[] = [];

  const started = await startOrResumeStudentAssessmentSession({
    student_user_db_id: student.id,
    assessment_public_id: demoAssessmentPublicId
  });
  sessionPublicIds.push(started.session.session_public_id);
  let state = await startConceptUnitInitialAdministration({
    student_user_db_id: student.id,
    session_public_id: started.session.session_public_id,
    concept_unit_public_id: started.state.current_concept_unit?.concept_unit_public_id ?? ""
  });

  for (const itemIndex of [1, 2, 3]) {
    state = await completeInitialItem({
      studentDbId: student.id,
      sessionPublicId: started.session.session_public_id,
      prefix,
      state,
      itemIndex
    });
  }

  assert(state.assessment_state === "PACKAGE_REVIEW", "Synthetic session should reach package review.");

  return {
    student,
    sessionPublicIds,
    state
  };
}

async function main() {
  const prefix = `pkg_feedback_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const prepared = await preparePackageReview(prefix);

  try {
    const conceptUnitPublicId = prepared.state.current_concept_unit?.concept_unit_public_id ?? "";
    const first = await completeInitialConceptUnitAdministration({
      student_user_db_id: prepared.student.id,
      session_public_id: prepared.state.session_public_id,
      concept_unit_public_id: conceptUnitPublicId
    });
    assert(first.state.assessment_state === "FORMATIVE_ACTIVITY", "First completion should render formative activity.");
    assert(first.outcome?.canonical_runtime_state === "AWAIT_FORMATIVE_ACTIVITY_RESPONSE", "Canonical await state missing.");
    assert(first.outcome.activity_status === "awaiting_student_activity_response", "Activity should await student response.");

    const afterFirst = await counts(prepared.state.session_public_id);
    assert(afterFirst.agent_calls === 1, "First completion should create one agent call.");
    assert(afterFirst.profiles >= 1, "First completion should create profile records.");
    assert(afterFirst.decisions === 1, "First completion should create one decision.");
    assert(afterFirst.rounds === 1, "First completion should create one follow-up round.");
    assert(afterFirst.response_packages === 1, "First completion should create one response package.");
    assert(afterFirst.activity_attempts === 1, "First completion should create one runtime activity.");
    assert(afterFirst.package_feedback_turns === 1, "First completion should create one feedback turn.");
    assert(afterFirst.next_interaction_turns === 1, "First completion should create one next-interaction turn.");
    assert(afterFirst.events.package_results_generated === 1, "Backend should emit generated package event.");
    assert(afterFirst.events.package_results_persisted === 1, "Backend should emit persisted package event.");
    assert((afterFirst.events.package_results_shown ?? 0) === 0, "Backend must not emit shown package event.");

    const second = await completeInitialConceptUnitAdministration({
      student_user_db_id: prepared.student.id,
      session_public_id: prepared.state.session_public_id,
      concept_unit_public_id: conceptUnitPublicId
    });
    assert(second.completion_status === "already_completed", "Replay should be idempotent.");
    assert(second.state.assessment_state === "FORMATIVE_ACTIVITY", "Replay should return canonical formative state.");

    const afterSecond = await counts(prepared.state.session_public_id);
    assert(afterSecond.agent_calls === afterFirst.agent_calls, "Replay must not create a second agent call.");
    assert(afterSecond.profiles === afterFirst.profiles, "Replay must not duplicate profile.");
    assert(afterSecond.decisions === afterFirst.decisions, "Replay must not duplicate decision.");
    assert(afterSecond.rounds === afterFirst.rounds, "Replay must not duplicate round.");
    assert(afterSecond.activity_attempts === afterFirst.activity_attempts, "Replay must not duplicate activity.");
    assert(afterSecond.package_feedback_turns === afterFirst.package_feedback_turns, "Replay must not duplicate feedback turn.");
    assert(afterSecond.next_interaction_turns === afterFirst.next_interaction_turns, "Replay must not duplicate next-interaction turn.");
    assert(afterSecond.events.package_results_generated === 1, "Replay must not duplicate generated package event.");
    assert(afterSecond.events.formative_activity_persisted === 1, "Replay must not duplicate persisted activity event.");

    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: prepared.state.session_public_id },
      select: { id: true }
    });
    await prisma.activityRuntimeAttempt.deleteMany({
      where: { session_public_id: prepared.state.session_public_id }
    });
    await prisma.conversationTurn.deleteMany({
      where: {
        assessment_session_db_id: session.id,
        structured_payload: { path: ["message_type"], equals: "next_interaction" }
      }
    });
    await prisma.assessmentSession.update({
      where: { id: session.id },
      data: { current_phase: "planning_pending" }
    });

    const recovered = await completeInitialConceptUnitAdministration({
      student_user_db_id: prepared.student.id,
      session_public_id: prepared.state.session_public_id,
      concept_unit_public_id: conceptUnitPublicId
    });
    assert(recovered.state.assessment_state === "FORMATIVE_ACTIVITY", "Recovery should restore formative activity state.");
    assert(recovered.outcome?.recovery_action === "reconciled", "Recovery should be reported as reconciled.");

    const afterRecovery = await counts(prepared.state.session_public_id);
    assert(afterRecovery.agent_calls === 1, "Recovery must not regenerate agent call.");
    assert(afterRecovery.profiles === afterSecond.profiles, "Recovery must not duplicate profile.");
    assert(afterRecovery.decisions === afterSecond.decisions, "Recovery must not duplicate decision.");
    assert(afterRecovery.rounds === afterSecond.rounds, "Recovery must not duplicate round.");
    assert(afterRecovery.activity_attempts === 1, "Recovery should restore one activity attempt.");
    assert(afterRecovery.next_interaction_turns === 1, "Recovery should restore one next-interaction turn.");
    assert((afterRecovery.events.package_completion_reconciled ?? 0) >= 1, "Recovery event should be recorded.");

    const canonicalState = await getStudentSessionState({
      student_user_db_id: prepared.student.id,
      session_public_id: prepared.state.session_public_id
    });
    assert(canonicalState.assessment_state === "FORMATIVE_ACTIVITY", "Canonical state fetch should not remain package review.");
    assert(canonicalState.activity_runtime?.activity_attempt_public_id, "Canonical state should expose active activity.");

    const ackPayload = {
      display_event_contract_version: "display-ack-v1",
      presenter_version: "package-feedback-presenter-v1",
      rendered_state: "FORMATIVE_ACTIVITY",
      canonical_runtime_state: "AWAIT_FORMATIVE_ACTIVITY_RESPONSE",
      content_id: `${prepared.state.session_public_id}:test-display-ack`,
      activity_attempt_public_id: canonicalState.activity_runtime?.activity_attempt_public_id ?? null
    };
    const firstAck = await ingestFrontendProcessEvents({
      student_user_db_id: prepared.student.id,
      session_public_id: prepared.state.session_public_id,
      data: {
        events: [
          {
            event_type: "package_results_shown",
            event_category: "package_results",
            payload: ackPayload
          }
        ]
      }
    });
    const secondAck = await ingestFrontendProcessEvents({
      student_user_db_id: prepared.student.id,
      session_public_id: prepared.state.session_public_id,
      data: {
        events: [
          {
            event_type: "package_results_shown",
            event_category: "package_results",
            payload: ackPayload
          }
        ]
      }
    });
    assert(firstAck.accepted_event_count === 1, "First display acknowledgement should be accepted.");
    assert(secondAck.accepted_event_count === 0, "Duplicate display acknowledgement should be ignored.");

    const finalCounts = await counts(prepared.state.session_public_id);
    assert(finalCounts.events.package_results_shown === 1, "Exactly one frontend shown event should be stored.");
    const acknowledgedResponses = await prisma.itemResponse.count({
      where: {
        concept_unit_session: {
          assessment_session: { session_public_id: prepared.state.session_public_id }
        },
        answer_explanation_revealed: true,
        student_display_acknowledged_at: { not: null }
      }
    });
    assert(
      acknowledgedResponses === 3,
      "Package-results display acknowledgement should mark all revealed initial item explanations."
    );

    const conceptUnitSession = await prisma.conceptUnitSession.findFirstOrThrow({
      where: { assessment_session: { session_public_id: prepared.state.session_public_id } },
      select: { id: true }
    });
    const responsePackage = await prisma.responsePackage.findFirstOrThrow({
      where: {
        concept_unit_session_db_id: conceptUnitSession.id,
        package_type: "initial_concept_unit_response_package"
      },
      orderBy: [{ created_at: "desc" }]
    });
    await prisma.responsePackage.update({
      where: { id: responsePackage.id },
      data: {
        payload: {
          ...(typeof responsePackage.payload === "object" && responsePackage.payload && !Array.isArray(responsePackage.payload)
            ? responsePackage.payload
            : {}),
          synthetic_changed_after_finalization: true
        }
      }
    });

    let conflictRejected = false;
    try {
      await completeInitialConceptUnitAdministration({
        student_user_db_id: prepared.student.id,
        session_public_id: prepared.state.session_public_id,
        concept_unit_public_id: conceptUnitPublicId
      });
    } catch (error) {
      conflictRejected =
        error instanceof Error &&
        "code" in error &&
        (error as { code?: unknown }).code === "package_completion_conflict" &&
        "details" in error &&
        (error as { details?: Record<string, unknown> }).details?.conflict_reason ===
          "completed_package_payload_changed";
    }
    assert(conflictRejected, "Changed finalized package payload should produce a typed package completion conflict.");

    console.log(JSON.stringify({
      status: "passed",
      session_public_id: prepared.state.session_public_id,
      operation_public_id: first.outcome?.operation_public_id,
      agent_calls: finalCounts.agent_calls,
      profiles: finalCounts.profiles,
      activities: finalCounts.activity_attempts,
      canonical_runtime_state: recovered.outcome?.canonical_runtime_state
    }, null, 2));
  } finally {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: prepared.student.id,
      sessionPublicIds: prepared.sessionPublicIds
    });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
