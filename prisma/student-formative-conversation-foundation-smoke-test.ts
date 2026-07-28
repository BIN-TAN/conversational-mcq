import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import {
  cleanupResponseCollectionFixture,
  createResponseCollectionFixture
} from "./response-collection-smoke-fixture";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

async function cleanupFoundationFixture(prefix: string) {
  const conversations = await prisma.formativeConversationSession.findMany({
    where: {
      assessment_session: {
        assessment: {
          title: { startsWith: prefix }
        }
      }
    },
    select: { id: true }
  });
  const conversationIds = conversations.map((conversation) => conversation.id);

  await prisma.formativeConversationProfileEvidenceReference.deleteMany({
    where: { formative_conversation_session_db_id: { in: conversationIds } }
  });
  await prisma.formativeConversationProfileTransition.deleteMany({
    where: { formative_conversation_session_db_id: { in: conversationIds } }
  });
  await prisma.formativeConversationInputTelemetry.deleteMany({
    where: { formative_conversation_session_db_id: { in: conversationIds } }
  });
  await prisma.formativeConversationTurnTelemetry.deleteMany({
    where: { formative_conversation_session_db_id: { in: conversationIds } }
  });
  await prisma.formativeConversationLifecycleEvent.deleteMany({
    where: { formative_conversation_session_db_id: { in: conversationIds } }
  });
  await prisma.formativeConversationReviewSignal.deleteMany({
    where: { formative_conversation_session_db_id: { in: conversationIds } }
  });
  await prisma.formativeConversationIntervention.deleteMany({
    where: { formative_conversation_session_db_id: { in: conversationIds } }
  });
  await prisma.formativeConversationMemorySnapshot.deleteMany({
    where: { formative_conversation_session_db_id: { in: conversationIds } }
  });
  await prisma.formativeConversationMessageReceipt.deleteMany({
    where: { formative_conversation_session_db_id: { in: conversationIds } }
  });
  await prisma.formativeConversationSession.deleteMany({
    where: { id: { in: conversationIds } }
  });
  await cleanupResponseCollectionFixture(prisma, prefix);
}

async function main() {
  const prefix = `formative_conversation_foundation_${Date.now()}`;
  await cleanupFoundationFixture(prefix);

  try {
    const {
      appendFormativeConversationMemorySnapshot,
      compilePersistedFormativeConversationContext,
      createOrGetFormativeConversationSession,
      FormativeConversationFoundationError,
      FormativeConversationTelemetryError,
      assertObservableOnlyFormativeConversationTelemetry,
      bindFormativeConversationAgentOperationalTelemetry,
      formativeConversationTranscriptHash,
      getFormativeConversationTranscript,
      getFormativeConversationTelemetrySummary,
      persistFormativeConversationAssistantMessage,
      recordFormativeConversationInputTelemetry,
      recordFormativeConversationLifecycleEvent,
      recordFormativeConversationProfileTransition,
      recordFormativeConversationTurnTelemetry,
      reserveAndPersistFormativeConversationStudentMessage
    } = await import(
      "../src/lib/services/student-assessment/formative-conversation/index"
    );
    const fixture = await createResponseCollectionFixture({
      prisma,
      prefix,
      responseCollectionMode: "deterministic"
    });
    await prisma.assessmentSession.update({
      where: { id: fixture.session.id },
      data: { current_phase: "profiling_completed" }
    });

    const beforeAgentCalls = await prisma.agentCall.count({
      where: { assessment_session_db_id: fixture.session.id }
    });
    const beforeTopicDialogues = await prisma.topicDialogue.count({
      where: { assessment_session_db_id: fixture.session.id }
    });
    const beforeActivityAttempts = await prisma.activityRuntimeAttempt.count({
      where: { session_public_id: fixture.session.session_public_id }
    });

    const created = await createOrGetFormativeConversationSession({
      assessment_session_db_id: fixture.session.id,
      concept_unit_session_db_id: fixture.conceptUnitSession.id
    });
    assert.equal(created.created, true);
    assert.equal(created.session.status, "active");
    assert.equal(created.session.host_agent_name, "formative_conversation_agent");

    const repeatedCreation = await createOrGetFormativeConversationSession({
      assessment_session_db_id: fixture.session.id,
      concept_unit_session_db_id: fixture.conceptUnitSession.id
    });
    assert.equal(repeatedCreation.created, false);
    assert.equal(repeatedCreation.session.id, created.session.id);

    const clientMessageId = `${prefix}_student_message_1`;
    const studentMessage = "Could you explain why consistency alone is not enough?";
    const firstReservation =
      await reserveAndPersistFormativeConversationStudentMessage({
        conversation_public_id: created.session.conversation_public_id,
        client_message_id: clientMessageId,
        message_text: studentMessage
      });
    assert.equal(firstReservation.replayed, false);
    assert.equal(firstReservation.receipt.status, "student_turn_persisted");
    assert.equal(firstReservation.receipt.student_turn?.message_text, studentMessage);

    const replayedReservation =
      await reserveAndPersistFormativeConversationStudentMessage({
        conversation_public_id: created.session.conversation_public_id,
        client_message_id: clientMessageId,
        message_text: studentMessage
      });
    assert.equal(replayedReservation.replayed, true);
    assert.equal(
      replayedReservation.receipt.student_turn_db_id,
      firstReservation.receipt.student_turn_db_id
    );

    await assert.rejects(
      reserveAndPersistFormativeConversationStudentMessage({
        conversation_public_id: created.session.conversation_public_id,
        client_message_id: clientMessageId,
        message_text: "Different content using the same client message ID."
      }),
      (error: unknown) =>
        error instanceof FormativeConversationFoundationError &&
        error.code === "idempotency_hash_mismatch"
    );

    const assistantMessage =
      "Consistency describes how dependably scores behave. Validity also needs evidence that the scores support the interpretation you want to make.";
    const persistedAssistant = await persistFormativeConversationAssistantMessage({
      conversation_public_id: created.session.conversation_public_id,
      client_message_id: clientMessageId,
      message_text: assistantMessage,
      generation_source: "deterministic_test_fixture",
      validator_status: "passed"
    });
    assert.equal(persistedAssistant.replayed, false);
    assert.equal(persistedAssistant.receipt.status, "assistant_turn_persisted");

    const replayedAssistant = await persistFormativeConversationAssistantMessage({
      conversation_public_id: created.session.conversation_public_id,
      client_message_id: clientMessageId,
      message_text: assistantMessage,
      generation_source: "deterministic_test_fixture",
      validator_status: "passed"
    });
    assert.equal(replayedAssistant.replayed, true);
    assert.equal(replayedAssistant.assistant_turn.id, persistedAssistant.assistant_turn.id);

    const telemetryStart = created.session.started_at;
    const at = (milliseconds: number) =>
      new Date(telemetryStart.getTime() + milliseconds);
    const studentTurn = firstReservation.receipt.student_turn;
    assert(studentTurn);
    const inputTelemetry = await recordFormativeConversationInputTelemetry({
      conversation_public_id: created.session.conversation_public_id,
      conversation_turn_db_id: studentTurn.id,
      client_message_id: clientMessageId,
      typing_started_at: at(1_000),
      typing_ended_at: at(5_000),
      typing_duration_ms: 2_600,
      typing_duration_method: "active_intervals",
      edit_count: 3,
      backspace_count: 2,
      paste_event_count: 1,
      final_message_length_chars: studentMessage.length,
      submitted_at: at(6_000)
    });
    assert.equal(inputTelemetry.replayed, false);
    const replayedInputTelemetry =
      await recordFormativeConversationInputTelemetry({
        conversation_public_id: created.session.conversation_public_id,
        conversation_turn_db_id: studentTurn.id,
        client_message_id: clientMessageId,
        typing_started_at: at(1_000),
        typing_ended_at: at(5_000),
        typing_duration_ms: 2_600,
        typing_duration_method: "active_intervals",
        edit_count: 3,
        backspace_count: 2,
        paste_event_count: 1,
        final_message_length_chars: studentMessage.length,
        submitted_at: at(6_000)
      });
    assert.equal(replayedInputTelemetry.replayed, true);

    const studentTurnTelemetry =
      await recordFormativeConversationTurnTelemetry({
        conversation_public_id: created.session.conversation_public_id,
        conversation_turn_db_id: studentTurn.id,
        turn_started_at: at(0),
        turn_submitted_at: at(6_000),
        response_time_ms: 6_000,
        message_length_chars: studentMessage.length,
        input_token_count: 11,
        output_token_count: null
      });
    assert.equal(studentTurnTelemetry.telemetry.turn_sequence_index, studentTurn.sequence_index);

    const fixtureAgentCall = await prisma.agentCall.create({
      data: {
        assessment_session_db_id: fixture.session.id,
        concept_unit_session_db_id: fixture.conceptUnitSession.id,
        agent_name: "formative_conversation_agent",
        agent_version: "formative-conversation-agent-contract-v1",
        model_name: "deterministic-telemetry-fixture",
        provider: "mock",
        agent_invocation_key: `${prefix}_formative_conversation_agent`,
        prompt_hash: `${prefix}_prompt_hash`,
        prompt_version: "formative-conversation-prompt-v1",
        schema_version: "formative-conversation-agent-contract-v1",
        input_payload: { fixture: "observable_telemetry_no_provider" },
        raw_output: { fixture: true },
        output_payload: { fixture: true },
        output_validated: true,
        live_call_allowed: false,
        retry_count: 1,
        call_status: "succeeded",
        latency_ms: 420,
        input_tokens: 120,
        output_tokens: 45,
        total_tokens: 165,
        token_usage: {
          input_tokens: 120,
          output_tokens: 45,
          total_tokens: 165
        },
        started_at: at(6_000),
        completed_at: at(6_420)
      }
    });
    const agentBinding =
      await bindFormativeConversationAgentOperationalTelemetry({
        conversation_public_id: created.session.conversation_public_id,
        agent_call_db_id: fixtureAgentCall.id,
        context_version: "formative-conversation-context-v1"
      });
    assert.equal(agentBinding.agent_call.formative_conversation_session_db_id, created.session.id);
    assert.equal(
      agentBinding.agent_call.formative_conversation_context_version,
      "formative-conversation-context-v1"
    );
    assert.equal(agentBinding.agent_call.model_name, "deterministic-telemetry-fixture");
    assert.equal(agentBinding.agent_call.prompt_version, "formative-conversation-prompt-v1");

    const assistantTurnTelemetry =
      await recordFormativeConversationTurnTelemetry({
        conversation_public_id: created.session.conversation_public_id,
        conversation_turn_db_id: persistedAssistant.assistant_turn.id,
        agent_call_db_id: fixtureAgentCall.id,
        turn_started_at: at(6_000),
        turn_submitted_at: at(6_420),
        response_time_ms: 420,
        message_length_chars: assistantMessage.length,
        input_token_count: 120,
        output_token_count: 45
      });
    assert.equal(
      assistantTurnTelemetry.telemetry.agent_call_db_id,
      fixtureAgentCall.id
    );

    for (const [index, event] of [
      { event_type: "page_hidden" as const, duration_ms: null, at: 7_000 },
      { event_type: "page_visible" as const, duration_ms: 2_000, at: 9_000 },
      { event_type: "paused" as const, duration_ms: null, at: 10_000 },
      { event_type: "left" as const, duration_ms: null, at: 11_000 },
      { event_type: "reentered" as const, duration_ms: 1_000, at: 12_000 },
      { event_type: "refreshed" as const, duration_ms: null, at: 13_000 },
      { event_type: "resumed" as const, duration_ms: 4_000, at: 14_000 },
      { event_type: "disconnected" as const, duration_ms: null, at: 15_000 },
      { event_type: "reconnected" as const, duration_ms: 1_000, at: 16_000 },
      { event_type: "completed" as const, duration_ms: null, at: 20_000 }
    ].entries()) {
      const recorded = await recordFormativeConversationLifecycleEvent({
        conversation_public_id: created.session.conversation_public_id,
        client_event_id: `${prefix}_event_${index}`,
        event_type: event.event_type,
        event_source: "frontend",
        observed_interval_duration_ms: event.duration_ms,
        client_instance_id: `${prefix}_browser`,
        occurred_at: at(event.at)
      });
      assert.equal(recorded.replayed, false);
    }
    const replayedLifecycleEvent =
      await recordFormativeConversationLifecycleEvent({
        conversation_public_id: created.session.conversation_public_id,
        client_event_id: `${prefix}_event_0`,
        event_type: "page_hidden",
        event_source: "frontend",
        observed_interval_duration_ms: null,
        client_instance_id: `${prefix}_browser`,
        occurred_at: at(7_000)
      });
    assert.equal(replayedLifecycleEvent.replayed, true);
    await assert.rejects(
      recordFormativeConversationLifecycleEvent({
        conversation_public_id: created.session.conversation_public_id,
        client_event_id: `${prefix}_event_0`,
        event_type: "page_visible",
        event_source: "frontend",
        observed_interval_duration_ms: null,
        client_instance_id: `${prefix}_browser`,
        occurred_at: at(7_000)
      }),
      (error: unknown) =>
        error instanceof FormativeConversationTelemetryError &&
        error.code === "telemetry_idempotency_mismatch"
    );

    const transcript = await getFormativeConversationTranscript(
      created.session.conversation_public_id
    );
    assert.equal(transcript.conversation_turns.length, 2);
    assert.deepEqual(
      transcript.conversation_turns.map((turn) => turn.message_text),
      [studentMessage, assistantMessage]
    );
    assert(
      transcript.conversation_turns[0].sequence_index <
        transcript.conversation_turns[1].sequence_index
    );

    const transcriptForHash = transcript.conversation_turns.map((turn) => ({
      sequence_index: turn.sequence_index,
      actor: turn.actor_type === "student" ? ("student" as const) : ("tutor" as const),
      message_text: turn.message_text ?? "",
      created_at: turn.created_at.toISOString()
    }));
    const transcriptHash = formativeConversationTranscriptHash(transcriptForHash);
    const memory = await appendFormativeConversationMemorySnapshot({
      conversation_public_id: created.session.conversation_public_id,
      through_turn_db_id: persistedAssistant.assistant_turn.id,
      source_transcript_hash: transcriptHash,
      summary_payload: {
        established: ["Consistency and validity are distinct."],
        unresolved: ["Apply the distinction to the item claim."]
      }
    });
    assert.equal(memory.snapshot_index, 1);

    const createProfile = (profileType: "initial" | "updated") =>
      prisma.studentProfile.create({
        data: {
          concept_unit_session_db_id: fixture.conceptUnitSession.id,
          profile_type: profileType,
          ability_profile:
            profileType === "initial"
              ? "partial_understanding"
              : "mostly_correct_understanding",
          ability_pattern_flags: [],
          engagement_profile: "insufficient_process_evidence",
          engagement_pattern_flags: [],
          integrated_diagnostic_profile:
            profileType === "initial"
              ? "conflicting_evidence_needs_clarification"
              : "correct_but_fragile_understanding",
          integrated_profile_confidence: "medium",
          integrated_profile_rationale: "Synthetic no-provider profile fixture.",
          evidence_sufficiency: "adequate",
          confidence_alignment: "insufficient_evidence",
          independence_interpretability: "insufficient_evidence",
          misconception_indicators: [],
          item_level_evidence: [],
          reasoning_quality_summary: "Synthetic no-provider profile fixture.",
          engagement_summary: "No engagement inference is stored in telemetry.",
          process_interpretation_cautions: [],
          profile_confidence: "medium",
          rationale: "Synthetic no-provider profile fixture.",
          recommended_next_evidence: []
        }
      });
    const initialProfile = await createProfile("initial");
    const updatedProfile = await createProfile("updated");
    await prisma.formativeConversationSession.update({
      where: { id: created.session.id },
      data: {
        initial_student_profile_db_id: initialProfile.id,
        current_student_profile_db_id: initialProfile.id
      }
    });
    const profileTransition =
      await recordFormativeConversationProfileTransition({
        conversation_public_id: created.session.conversation_public_id,
        prior_student_profile_db_id: initialProfile.id,
        updated_student_profile_db_id: updatedProfile.id,
        assessment_student_profile_db_id: initialProfile.id,
        source_turn_db_id: persistedAssistant.assistant_turn.id,
        source_agent_call_db_id: fixtureAgentCall.id,
        learning_outcome: "largely_improved",
        learning_observations: [
          {
            evidence_type: "conceptual_distinction",
            observation:
              "The student distinguishes consistency from interpretation evidence.",
            source_turn_sequence_indexes: [studentTurn.sequence_index]
          }
        ],
        evidence_interpretation:
          "The persisted student and tutor turns support a formative profile update.",
        profile_snapshot: {
          profile_version: updatedProfile.id,
          outcome: "largely_improved_understanding",
          evidence_summary: [
            "The student distinguishes consistency from interpretation evidence."
          ],
          unresolved_evidence: [],
          evidence_limitations: []
        },
        supporting_turn_db_ids: [
          studentTurn.id,
          persistedAssistant.assistant_turn.id
        ],
        transitioned_at: at(18_000)
      });
    assert.equal(profileTransition.replayed, false);
    assert.equal(
      (
        await prisma.formativeConversationSession.findUniqueOrThrow({
          where: { id: created.session.id }
        })
      ).current_student_profile_db_id,
      updatedProfile.id
    );
    const replayedProfileTransition =
      await recordFormativeConversationProfileTransition({
        conversation_public_id: created.session.conversation_public_id,
        prior_student_profile_db_id: initialProfile.id,
        updated_student_profile_db_id: updatedProfile.id,
        assessment_student_profile_db_id: initialProfile.id,
        source_turn_db_id: persistedAssistant.assistant_turn.id,
        source_agent_call_db_id: fixtureAgentCall.id,
        learning_outcome: "largely_improved",
        learning_observations: [
          {
            evidence_type: "conceptual_distinction",
            observation:
              "The student distinguishes consistency from interpretation evidence.",
            source_turn_sequence_indexes: [studentTurn.sequence_index]
          }
        ],
        evidence_interpretation:
          "The persisted student and tutor turns support a formative profile update.",
        profile_snapshot: {
          profile_version: updatedProfile.id,
          outcome: "largely_improved_understanding",
          evidence_summary: [
            "The student distinguishes consistency from interpretation evidence."
          ],
          unresolved_evidence: [],
          evidence_limitations: []
        },
        supporting_turn_db_ids: [
          studentTurn.id,
          persistedAssistant.assistant_turn.id
        ],
        transitioned_at: at(18_000)
      });
    assert.equal(replayedProfileTransition.replayed, true);

    const telemetrySummary = await getFormativeConversationTelemetrySummary(
      created.session.conversation_public_id
    );
    assert.equal(telemetrySummary.session_duration_ms, 20_000);
    assert.equal(telemetrySummary.turn_count, 2);
    assert.equal(telemetrySummary.turn_telemetry_count, 2);
    assert.equal(telemetrySummary.total_token_count, 165);
    assert.equal(telemetrySummary.llm_latency_ms_average, 420);
    assert.equal(telemetrySummary.retry_count, 1);
    assert.equal(telemetrySummary.pause_count, 1);
    assert.equal(telemetrySummary.resume_count, 1);
    assert.equal(telemetrySummary.lifecycle_event_counts.left, 1);
    assert.equal(telemetrySummary.lifecycle_event_counts.reentered, 1);
    assert.equal(telemetrySummary.lifecycle_event_counts.refreshed, 1);
    assert.equal(telemetrySummary.lifecycle_event_counts.disconnected, 1);
    assert.equal(telemetrySummary.lifecycle_event_counts.reconnected, 1);
    assert.equal(telemetrySummary.completion_observed, true);
    assert.equal(telemetrySummary.profile_transition_count, 1);
    assert.doesNotMatch(
      JSON.stringify(telemetrySummary),
      /help_seeking|misconception_resolution|learning_strategy|conversational_depth|confidence_behavior/
    );
    assert.throws(
      () =>
        assertObservableOnlyFormativeConversationTelemetry({
          help_seeking: true
        }),
      /formative_conversation_telemetry_inferred_fields_forbidden/
    );

    const intervention = await prisma.formativeConversationIntervention.create({
      data: {
        formative_conversation_session_db_id: created.session.id,
        strategy_type: "conceptual_contrast",
        targeted_evidence_gap: "Connect consistency evidence to validity claims.",
        status: "active",
        started_by_turn_db_id: persistedAssistant.assistant_turn.id,
        adaptation_history: []
      }
    });
    await prisma.itemResponse.create({
      data: {
        concept_unit_session_db_id: fixture.conceptUnitSession.id,
        item_db_id: fixture.items[0].id,
        selected_option: "B",
        correct_option_snapshot: "A",
        correctness: "incorrect",
        item_started_at: new Date("2026-07-27T12:00:00.000Z"),
        item_submitted_at: new Date("2026-07-27T12:01:00.000Z"),
        item_version_snapshot: fixture.items[0].version,
        item_snapshot: {
          item_public_id: fixture.items[0].item_public_id,
          item_stem: fixture.items[0].item_stem
        }
      }
    });

    const profile = {
      profile_version: "foundation-smoke-profile-v1",
      outcome: "not_yet_determined" as const,
      evidence_summary: ["The student distinguishes consistency from interpretation."],
      unresolved_evidence: ["The distinction has not yet been independently applied."],
      evidence_limitations: ["One short formative exchange is available."]
    };
    const compiled = await compilePersistedFormativeConversationContext({
      conversation_public_id: created.session.conversation_public_id,
      assessment_public_id: fixture.assessment.assessment_public_id,
      concept_unit_public_id: fixture.conceptUnit.concept_unit_public_id,
      administered_items: [
        {
          item_public_id: fixture.items[0].item_public_id,
          item_number: 1,
          item_stem: fixture.items[0].item_stem,
          options: [
            { label: "A", text: "Synthetic option A" },
            { label: "B", text: "Synthetic option B" },
            { label: "C", text: "Synthetic option C" }
          ],
          student_answer: "B",
          correct_answer: "A",
          concise_explanation:
            "Consistency evidence does not by itself justify an intended interpretation.",
          administered: true as const
        }
      ],
      initial_profile: profile,
      current_profile: profile
    });

    assert.equal(compiled.safety.valid, true);
    assert.equal(compiled.context.visible_transcript.length, 2);
    assert.equal(compiled.context.latest_student_message, studentMessage);
    assert.equal(compiled.context.memory?.source_transcript_hash, transcriptHash);
    assert.equal(
      compiled.context.intervention_history[0].intervention_public_id,
      intervention.intervention_public_id
    );
    assert.deepEqual(compiled.context.safety_boundary.administered_item_public_ids, [
      fixture.items[0].item_public_id
    ]);
    await assert.rejects(
      compilePersistedFormativeConversationContext({
        conversation_public_id: created.session.conversation_public_id,
        assessment_public_id: fixture.assessment.assessment_public_id,
        concept_unit_public_id: fixture.conceptUnit.concept_unit_public_id,
        administered_items: [
          ...compiled.context.administered_items,
          {
            item_public_id: fixture.items[1].item_public_id,
            item_number: 2,
            item_stem: fixture.items[1].item_stem,
            options: [
              { label: "A", text: "Synthetic option A" },
              { label: "B", text: "Synthetic option B" },
              { label: "C", text: "Synthetic option C" }
            ],
            student_answer: null,
            correct_answer: "A",
            concise_explanation: "This unadministered item must not enter context.",
            administered: true as const
          }
        ],
        initial_profile: profile,
        current_profile: profile
      }),
      /formative_conversation_context_unsafe:administered_item_boundary_mismatch/
    );
    assert.doesNotMatch(
      JSON.stringify(compiled.context),
      /password_hash|access_code_hash|system_prompt|raw_teacher_diagnostic_notes|openai_api_key/i
    );

    assert.equal(
      await prisma.agentCall.count({
        where: { assessment_session_db_id: fixture.session.id }
      }),
      beforeAgentCalls + 1
    );
    assert.equal(
      await prisma.agentCall.count({
        where: {
          assessment_session_db_id: fixture.session.id,
          provider: { not: "mock" }
        }
      }),
      0
    );
    assert.equal(
      await prisma.topicDialogue.count({
        where: { assessment_session_db_id: fixture.session.id }
      }),
      beforeTopicDialogues
    );
    assert.equal(
      await prisma.activityRuntimeAttempt.count({
        where: { session_public_id: fixture.session.session_public_id }
      }),
      beforeActivityAttempts
    );

    console.log(
      JSON.stringify(
        {
          status: "passed",
          smoke: "student-formative-conversation-foundation",
          assertions: [
            "session_creation",
            "idempotency",
            "transcript_persistence",
            "context_compilation",
            "observable_lifecycle_telemetry",
            "turn_and_input_telemetry",
            "llm_operational_telemetry_binding",
            "profile_transition_provenance",
            "inferred_telemetry_rejection"
          ],
          openai_calls: 0
        },
        null,
        2
      )
    );
  } finally {
    await cleanupFoundationFixture(prefix);
  }
}

main()
  .catch((error: unknown) => {
    const safeMessage =
      error instanceof Error ? error.message : "Unknown foundation smoke failure.";
    console.error(safeMessage);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
