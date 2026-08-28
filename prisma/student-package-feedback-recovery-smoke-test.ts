import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  completeInitialConceptUnitAdministration,
  getStudentSessionState,
  getStudentSafeTranscript,
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
import { reconcilePackageCompletionState } from "../src/lib/services/student-assessment/formative-profile";
import { createOrGetFormativeConversationSession } from "../src/lib/services/student-assessment/formative-conversation";
import { buildTeacherSessionDataAudit } from "../src/lib/services/teacher-review/session-data-audit";
import { parseCanonicalMisconceptionClaimCatalog } from "../src/lib/domain/misconception-claim-identity";

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
    agent_names: (
      await prisma.agentCall.findMany({
        where: { assessment_session_db_id: session.id },
        orderBy: { created_at: "asc" },
        select: { agent_name: true }
      })
    ).map((call) => call.agent_name),
    student_profiling_calls: await prisma.agentCall.count({
      where: {
        assessment_session_db_id: session.id,
        agent_name: "student_profiling_agent"
      }
    }),
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
    formative_conversations: await prisma.formativeConversationSession.count({
      where: { assessment_session_db_id: session.id }
    }),
    activity_attempts: await prisma.activityRuntimeAttempt.count({ where: { session_public_id: sessionPublicId } }),
    package_feedback_turns: await prisma.conversationTurn.count({
      where: {
        assessment_session_db_id: session.id,
        structured_payload: { path: ["message_type"], equals: "package_feedback" }
      }
    }),
    formative_conversation_opening_turns:
      await prisma.conversationTurn.count({
        where: {
          assessment_session_db_id: session.id,
          structured_payload: {
            path: ["message_type"],
            equals: "formative_conversation_opening"
          }
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
    assert(
      first.outcome?.canonical_runtime_state === "FORMATIVE_CONVERSATION",
      "Formative conversation should be the canonical runtime."
    );
    assert(
      first.outcome.activity_status === "unavailable",
      "Conversation-hosted sessions should not expose an active activity."
    );
    assert(
      first.outcome.next_interaction_status === "not_applicable",
      "Conversation-hosted sessions must not depend on a legacy next interaction."
    );
    assert(
      first.state.next_step === "formative_conversation",
      "The student state should identify the conversation-owned handoff."
    );

    const afterFirst = await counts(prepared.state.session_public_id);
    assert(
      afterFirst.agent_names.includes("formative_value_and_planning_agent") &&
        afterFirst.agent_names.includes("formative_conversation_agent"),
      `First completion should create planning and formative opening calls; found ${afterFirst.agent_names.join(",")}.`
    );
    assert(
      afterFirst.student_profiling_calls <= 1,
      "Canonical profile preparation must create at most one student-profiling call."
    );
    assert(afterFirst.profiles >= 1, "First completion should create profile records.");
    assert(afterFirst.decisions === 1, "First completion should create one decision.");
    assert(afterFirst.rounds === 1, "First completion should create one follow-up round.");
    assert(afterFirst.response_packages === 1, "First completion should create one response package.");
    assert(
      afterFirst.formative_conversations === 1,
      "First completion should create one formative conversation."
    );
    const formativeConversation =
      await prisma.formativeConversationSession.findFirstOrThrow({
        where: {
          assessment_session: {
            session_public_id: prepared.state.session_public_id
          }
        },
        include: { initial_student_profile: true }
      });
    assert(
      parseCanonicalMisconceptionClaimCatalog(
        formativeConversation.initial_student_profile
          ?.misconception_indicators
      ),
      "The conversation handoff must bind a canonical misconception claim profile."
    );
    assert(
      afterFirst.activity_attempts === 0,
      "Conversation-hosted completion must not create a dormant runtime activity."
    );
    assert(afterFirst.package_feedback_turns === 1, "First completion should create one feedback turn.");
    assert(
      afterFirst.formative_conversation_opening_turns === 1,
      "First completion should persist one tutor opening."
    );
    assert(
      afterFirst.next_interaction_turns === 0,
      "Conversation-hosted completion must not create a legacy next-interaction turn."
    );
    assert(afterFirst.events.package_results_generated === 1, "Backend should emit generated package event.");
    assert(afterFirst.events.package_results_persisted === 1, "Backend should emit persisted package event.");
    assert(
      (afterFirst.events.formative_activity_generated ?? 0) === 0,
      "Conversation-hosted completion must not emit activity-generation telemetry."
    );
    assert(
      (afterFirst.events.formative_activity_persisted ?? 0) === 0,
      "Conversation-hosted completion must not emit activity-persistence telemetry."
    );
    assert(
      (afterFirst.events.student_communication_generated ?? 0) === 0 &&
        (afterFirst.events.student_communication_persisted ?? 0) === 0,
      "The legacy student-communication transition must not run for a formative conversation."
    );
    assert(
      (afterFirst.events.next_interaction_generated ?? 0) === 0 &&
        (afterFirst.events.next_interaction_persisted ?? 0) === 0,
      "The legacy evidence-to-activity route must not run for a formative conversation."
    );
    assert((afterFirst.events.package_results_shown ?? 0) === 0, "Backend must not emit shown package event.");
    const firstTranscript = await getStudentSafeTranscript({
      student_user_db_id: prepared.student.id,
      session_public_id: prepared.state.session_public_id
    });
    assert(
      firstTranscript.transcript.filter(
        (turn) => turn.interaction_type === "package_feedback"
      ).length === 0,
      "Conversation-hosted completion must keep legacy package feedback out of the student transcript."
    );
    assert(
      firstTranscript.transcript.filter((turn) => turn.interaction_type === "formative_activity").length === 0,
      "Conversation-hosted completion must not dispatch a legacy activity message."
    );
    const opening = first.state.formative_conversation?.transcript[0];
    assert(opening?.actor === "tutor", "The formative conversation should start with a tutor opening.");
    assert(
      opening.agent_name === "formative_conversation_agent",
      "The opening should be owned by formative_conversation_agent."
    );
    assert(
      !/\b(?:you answered \d+|profile|diagnosis|growth target|recommended activity|try this next)\b/i.test(
        opening.message_text
      ),
      "The opening should not repeat the report or expose internal/activity language."
    );
    const retainedFeedback = await prisma.conversationTurn.findFirstOrThrow({
      where: {
        assessment_session: {
          session_public_id: prepared.state.session_public_id
        },
        structured_payload: {
          path: ["message_type"],
          equals: "package_feedback"
        }
      },
      select: { structured_payload: true }
    });
    assert(
      (
        retainedFeedback.structured_payload as Record<string, unknown>
      ).visibility_status === "internal",
      "Package feedback should remain persisted as internal audit evidence."
    );
    const openingCall = await prisma.agentCall.findFirstOrThrow({
      where: {
        assessment_session: {
          session_public_id: prepared.state.session_public_id
        },
        agent_name: "formative_conversation_agent"
      },
      orderBy: { created_at: "desc" },
      select: {
        input_payload: true
      }
    });
    const openingContext =
      openingCall.input_payload &&
      typeof openingCall.input_payload === "object" &&
      !Array.isArray(openingCall.input_payload)
        ? (openingCall.input_payload as Record<string, unknown>)
        : {};
    const responseEvidence = Array.isArray(
      openingContext.assessment_response_evidence
    )
      ? openingContext.assessment_response_evidence
      : [];
    const processEvidence = Array.isArray(
      openingContext.assessment_process_evidence
    )
      ? openingContext.assessment_process_evidence
      : [];
    const assessmentSpecification =
      openingContext.assessment_specification &&
      typeof openingContext.assessment_specification === "object" &&
      !Array.isArray(openingContext.assessment_specification)
        ? (openingContext.assessment_specification as Record<string, unknown>)
        : {};
    assert(
      responseEvidence.length === 3 &&
        responseEvidence.every((entry) => {
          const evidence =
            entry && typeof entry === "object" && !Array.isArray(entry)
              ? (entry as Record<string, unknown>)
              : {};
          return Boolean(evidence.written_reasoning) &&
            Boolean(evidence.confidence);
        }),
      "The opening agent should receive reasoning and confidence for every administered response."
    );
    assert(
      typeof assessmentSpecification.learning_objective === "string" &&
        assessmentSpecification.learning_objective.length > 0,
      "The opening agent should receive the assessment learning objective."
    );
    assert(
      processEvidence.length > 0,
      "The opening agent should receive observable assessment process evidence."
    );
    for (const legacyRoutingKey of [
      "package_feedback",
      "next_interaction",
      "matched_activity",
      "recommended_activity",
      "student_communication"
    ]) {
      assert(
        !(legacyRoutingKey in openingContext),
        `The conversation context must not contain legacy routing key ${legacyRoutingKey}.`
      );
    }

    const second = await completeInitialConceptUnitAdministration({
      student_user_db_id: prepared.student.id,
      session_public_id: prepared.state.session_public_id,
      concept_unit_public_id: conceptUnitPublicId
    });
    assert(second.completion_status === "already_completed", "Replay should be idempotent.");
    assert(second.state.assessment_state === "FORMATIVE_ACTIVITY", "Replay should return canonical formative state.");
    assert(
      second.state.next_step === "formative_conversation",
      "Replay should preserve the conversation-owned handoff."
    );

    const afterSecond = await counts(prepared.state.session_public_id);
    assert(afterSecond.agent_calls === afterFirst.agent_calls, "Replay must not create a second agent call.");
    assert(afterSecond.profiles === afterFirst.profiles, "Replay must not duplicate profile.");
    assert(afterSecond.decisions === afterFirst.decisions, "Replay must not duplicate decision.");
    assert(afterSecond.rounds === afterFirst.rounds, "Replay must not duplicate round.");
    assert(
      afterSecond.formative_conversations === afterFirst.formative_conversations,
      "Replay must not duplicate the formative conversation."
    );
    assert(afterSecond.activity_attempts === afterFirst.activity_attempts, "Replay must not duplicate activity.");
    assert(afterSecond.package_feedback_turns === afterFirst.package_feedback_turns, "Replay must not duplicate feedback turn.");
    assert(
      afterSecond.formative_conversation_opening_turns ===
        afterFirst.formative_conversation_opening_turns,
      "Replay must not duplicate the formative conversation opening."
    );
    assert(afterSecond.next_interaction_turns === afterFirst.next_interaction_turns, "Replay must not duplicate next-interaction turn.");
    assert(afterSecond.events.package_results_generated === 1, "Replay must not duplicate generated package event.");
    assert(
      (afterSecond.events.formative_activity_persisted ?? 0) === 0,
      "Replay must not emit legacy activity persistence."
    );
    const replayTranscript = await getStudentSafeTranscript({
      student_user_db_id: prepared.student.id,
      session_public_id: prepared.state.session_public_id
    });
    assert(
      replayTranscript.transcript.filter(
        (turn) => turn.interaction_type === "package_feedback"
      ).length === 0,
      "Refresh/replay must continue hiding the legacy package-feedback report."
    );
    assert(
      replayTranscript.transcript.filter((turn) => turn.interaction_type === "formative_activity").length === 0,
      "Idempotent package replay must not create a legacy activity dispatch."
    );
    assert(
      second.state.formative_conversation?.transcript[0]?.turn_id ===
        opening.turn_id,
      "Refresh/replay should return the same persisted opening turn."
    );

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
    const recoveryDebug = await prisma.conceptUnitSession.findMany({
      where: { assessment_session_db_id: session.id },
      select: {
        id: true,
        followup_rounds: {
          select: { id: true, status: true },
          orderBy: [{ round_index: "desc" }],
          take: 3
        },
        student_profiles: {
          select: { id: true, item_level_evidence: true },
          orderBy: [{ created_at: "desc" }],
          take: 3
        }
      }
    });
    const safeRecoveryDebug = recoveryDebug.map((entry) => ({
      concept_unit_session_id: entry.id,
      round_statuses: entry.followup_rounds.map((round) => round.status),
      profile_evidence_keys: entry.student_profiles.map((profile) =>
        profile.item_level_evidence && typeof profile.item_level_evidence === "object" && !Array.isArray(profile.item_level_evidence)
          ? Object.keys(profile.item_level_evidence as Record<string, unknown>)
          : []
      )
    }));
    assert(
      afterRecovery.agent_calls === afterSecond.agent_calls,
      "Recovery must not regenerate any agent call."
    );
    assert(afterRecovery.profiles === afterSecond.profiles, "Recovery must not duplicate profile.");
    assert(afterRecovery.decisions === afterSecond.decisions, "Recovery must not duplicate decision.");
    assert(afterRecovery.rounds === afterSecond.rounds, "Recovery must not duplicate round.");
    assert(
      afterRecovery.activity_attempts === 0,
      `Recovery must not restore an activity for a formative conversation; found ${afterRecovery.activity_attempts}. ` +
        `Recovery=${JSON.stringify(recovered.outcome?.operation_audit.conflict_recovery_metadata ?? {})}; ` +
        `warnings=${JSON.stringify(recovered.outcome?.safe_warnings ?? [])}; ` +
        `debug=${JSON.stringify(safeRecoveryDebug)}.`
    );
    assert(
      afterRecovery.next_interaction_turns === 0,
      "Recovery must not recreate a legacy next-interaction turn for a formative conversation."
    );
    assert((afterRecovery.events.package_completion_reconciled ?? 0) >= 1, "Recovery event should be recorded.");

    const canonicalState = await getStudentSessionState({
      student_user_db_id: prepared.student.id,
      session_public_id: prepared.state.session_public_id
    });
    assert(canonicalState.assessment_state === "FORMATIVE_ACTIVITY", "Canonical state fetch should not remain package review.");
    assert(
      canonicalState.formative_conversation?.conversation_public_id,
      "Canonical state should expose the formative conversation."
    );
    assert(
      canonicalState.activity_runtime === null,
      "Canonical conversation state must not expose an active activity."
    );
    const conversationAudit = await buildTeacherSessionDataAudit({
      session_public_id: prepared.state.session_public_id,
      write_artifact: false
    });
    assert(
      conversationAudit.activity_runtime_summary.runtime_mode ===
        "formative_conversation",
      "Teacher audit should identify formative-conversation runtime."
    );
    assert(
      conversationAudit.activity_runtime_summary.active_attempt_count === 0,
      "Teacher audit should not infer an active activity."
    );
    assert(
      !conversationAudit.limitations.includes("activity_runtime_attempts_missing"),
      "An activity attempt is not required when a formative conversation exists."
    );

    const ackPayload = {
      display_event_contract_version: "display-ack-v1",
      presenter_version: "package-feedback-presenter-v1",
      rendered_state: "FORMATIVE_ACTIVITY",
      canonical_runtime_state: "FORMATIVE_CONVERSATION",
      content_id: `${prepared.state.session_public_id}:test-display-ack`,
      activity_attempt_public_id: null
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
      select: {
        id: true,
        assessment_session_db_id: true,
        latest_student_profile_db_id: true
      }
    });
    await prisma.formativeConversationSession.deleteMany({
      where: {
        assessment_session_db_id: conceptUnitSession.assessment_session_db_id
      }
    });
    const legacyRecovery = await reconcilePackageCompletionState({
      concept_unit_session_db_id: conceptUnitSession.id,
      reason: "legacy_activity_regression"
    });
    assert(
      legacyRecovery.recovered_stages.includes("activity_runtime_attempt_restored"),
      "A legacy session without a formative conversation should restore its activity."
    );
    assert(
      (
        await counts(prepared.state.session_public_id)
      ).next_interaction_turns === 1,
      "A true legacy session should retain next-interaction reconciliation."
    );
    const legacyAttempt = await prisma.activityRuntimeAttempt.findFirstOrThrow({
      where: { session_public_id: prepared.state.session_public_id },
      select: { id: true, activity_attempt_public_id: true }
    });
    const legacyState = await getStudentSessionState({
      student_user_db_id: prepared.student.id,
      session_public_id: prepared.state.session_public_id
    });
    assert(
      legacyState.formative_conversation === null,
      "Legacy runtime should not fabricate a formative conversation."
    );
    assert(
      legacyState.activity_runtime?.activity_attempt_public_id ===
        legacyAttempt.activity_attempt_public_id,
      "Legacy runtime should continue exposing its active activity."
    );
    const legacyTranscript = await getStudentSafeTranscript({
      student_user_db_id: prepared.student.id,
      session_public_id: prepared.state.session_public_id
    });
    assert(
      legacyTranscript.transcript.some(
        (turn) => turn.interaction_type === "package_feedback"
      ),
      "A legacy session without FormativeConversationSession should keep its package feedback."
    );

    assert(
      conceptUnitSession.latest_student_profile_db_id,
      "A current profile is required to restore the formative conversation."
    );
    await createOrGetFormativeConversationSession({
      assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
      concept_unit_session_db_id: conceptUnitSession.id,
      initial_student_profile_db_id:
        conceptUnitSession.latest_student_profile_db_id ?? undefined,
      current_student_profile_db_id:
        conceptUnitSession.latest_student_profile_db_id ?? undefined
    });
    await reconcilePackageCompletionState({
      concept_unit_session_db_id: conceptUnitSession.id,
      reason: "historical_activity_preservation_regression"
    });
    const preservedHistoricalAttempt =
      await prisma.activityRuntimeAttempt.findUniqueOrThrow({
        where: { id: legacyAttempt.id },
        select: { activity_attempt_public_id: true }
      });
    assert(
      preservedHistoricalAttempt.activity_attempt_public_id ===
        legacyAttempt.activity_attempt_public_id,
      "Creating a formative conversation must not delete historical activity records."
    );
    const migratedState = await getStudentSessionState({
      student_user_db_id: prepared.student.id,
      session_public_id: prepared.state.session_public_id
    });
    assert(
      migratedState.formative_conversation?.conversation_public_id,
      "Migrated state should expose its formative conversation."
    );
    assert(
      migratedState.activity_runtime === null,
      "Historical activity records must not be projected as active after migration."
    );
    const migratedTranscript = await getStudentSafeTranscript({
      student_user_db_id: prepared.student.id,
      session_public_id: prepared.state.session_public_id
    });
    assert(
      migratedTranscript.transcript.every(
        (turn) => turn.interaction_type !== "package_feedback"
      ),
      "Once a formative conversation owns the runtime, the legacy package-feedback report should be hidden."
    );
    const migratedAudit = await buildTeacherSessionDataAudit({
      session_public_id: prepared.state.session_public_id,
      write_artifact: false
    });
    assert(
      migratedAudit.activity_runtime_summary.attempt_count === 0 &&
        migratedAudit.activity_runtime_summary
          .legacy_non_authoritative_attempt_count === 1 &&
        migratedAudit.activity_runtime_summary.active_attempt_count === 0,
      "Teacher audit should preserve the historical row without treating it as active."
    );
    assert(
      migratedAudit.activity_runtime_summary.limitations.includes(
        "historical_activity_records_preserved"
      ),
      "Teacher audit should label preserved activity rows as historical."
    );

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
