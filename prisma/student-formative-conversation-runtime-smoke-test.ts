import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { agentOutputSchemas } from "../src/lib/agents/contracts";
import { mockOutputForAgent } from "../src/lib/agents/mock-fixtures";
import type { FormativeConversationAgentRunner } from "../src/lib/services/student-assessment/formative-conversation/runtime";
import {
  cleanupResponseCollectionFixture,
  createResponseCollectionFixture
} from "./response-collection-smoke-fixture";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

async function cleanupRuntimeFixture(prefix: string) {
  const sessions = await prisma.formativeConversationSession.findMany({
    where: {
      assessment_session: {
        assessment: { title: { startsWith: prefix } }
      }
    },
    select: { id: true }
  });
  const sessionIds = sessions.map((session) => session.id);

  await prisma.formativeConversationProfileEvidenceReference.deleteMany({
    where: { formative_conversation_session_db_id: { in: sessionIds } }
  });
  await prisma.formativeConversationProfileTransition.deleteMany({
    where: { formative_conversation_session_db_id: { in: sessionIds } }
  });
  await prisma.formativeConversationInputTelemetry.deleteMany({
    where: { formative_conversation_session_db_id: { in: sessionIds } }
  });
  await prisma.formativeConversationTurnTelemetry.deleteMany({
    where: { formative_conversation_session_db_id: { in: sessionIds } }
  });
  await prisma.formativeConversationLifecycleEvent.deleteMany({
    where: { formative_conversation_session_db_id: { in: sessionIds } }
  });
  await prisma.formativeConversationReviewSignal.deleteMany({
    where: { formative_conversation_session_db_id: { in: sessionIds } }
  });
  await prisma.formativeConversationIntervention.deleteMany({
    where: { formative_conversation_session_db_id: { in: sessionIds } }
  });
  await prisma.formativeConversationMemorySnapshot.deleteMany({
    where: { formative_conversation_session_db_id: { in: sessionIds } }
  });
  await prisma.formativeConversationMessageReceipt.deleteMany({
    where: { formative_conversation_session_db_id: { in: sessionIds } }
  });
  await prisma.formativeConversationSession.deleteMany({
    where: { id: { in: sessionIds } }
  });
  await cleanupResponseCollectionFixture(prisma, prefix);
}

async function main() {
  const prefix = `formative_conversation_runtime_${Date.now()}`;
  await cleanupRuntimeFixture(prefix);

  try {
    const {
      FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
      FORMATIVE_CONVERSATION_AGENT_NAME,
      FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID,
      formativeConversationInvocationKey,
      getFormativeConversationTranscript,
      processFormativeConversationOpening,
      processFormativeConversationStudentMessage,
      reserveAndPersistFormativeConversationStudentMessage,
      validateFormativeConversationOpeningOutput
    } = await import(
      "../src/lib/services/student-assessment/formative-conversation/index"
    );
    const { persistInitialStudentProfile } = await import(
      "../src/lib/agents/student-profiling/persistence"
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
    await prisma.itemResponse.create({
      data: {
        concept_unit_session_db_id: fixture.conceptUnitSession.id,
        item_db_id: fixture.items[0].id,
        selected_option: "B",
        correct_option_snapshot: "A",
        correctness: "incorrect",
        reasoning_text:
          "I focused on consistency and did not separate it from interpretation.",
        confidence_rating: "medium",
        item_started_at: new Date("2026-07-28T08:00:00.000Z"),
        item_submitted_at: new Date("2026-07-28T08:01:00.000Z"),
        item_version_snapshot: fixture.items[0].version,
        item_snapshot: {
          item_public_id: fixture.items[0].item_public_id,
          item_stem: fixture.items[0].item_stem
        }
      }
    });

    const profileOutput = agentOutputSchemas.student_profiling_agent.parse(
      mockOutputForAgent("student_profiling_agent")
    );
    const initialProfile = await persistInitialStudentProfile({
      concept_unit_session_db_id: fixture.conceptUnitSession.id,
      based_on_agent_call_db_id: null,
      output: profileOutput
    });
    const conversation =
      await prisma.formativeConversationSession.findUniqueOrThrow({
        where: {
          concept_unit_session_db_id: fixture.conceptUnitSession.id
        }
      });
    assert.equal(
      conversation.initial_student_profile_db_id,
      initialProfile.id,
      "Initial profile persistence should create and bind the conversation."
    );
    assert.equal(conversation.current_student_profile_db_id, initialProfile.id);

    const beforeTopicDialogueCount = await prisma.topicDialogue.count({
      where: { assessment_session_db_id: fixture.session.id }
    });
    const profileEvidence = {
      profile_version: "runtime-foundation-profile-v1",
      outcome: "not_yet_determined" as const,
      evidence_summary: [
        "The initial package shows a distinction that needs further explanation."
      ],
      unresolved_evidence: [
        "Independent application of the distinction has not been observed."
      ],
      evidence_limitations: ["Only the initial package is available."]
    };
    const context = {
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
      assessment_specification: {
        schema_version:
          "formative-conversation-assessment-specification-v1" as const,
        assessment_title: fixture.assessment.title,
        diagnostic_focus: null,
        concept_unit_title: fixture.conceptUnit.title,
        learning_objective: fixture.conceptUnit.learning_objective,
        related_concept_description:
          fixture.conceptUnit.related_concept_description,
        administered_item_guidance: [],
        boundaries: {
          administered_items_only: true as const,
          unadministered_item_content_protected: true as const,
          administered_answer_discussion_allowed: true as const,
          raw_teacher_notes_must_not_be_quoted: true as const,
          pedagogy_owner: "formative_conversation_agent" as const,
          legacy_activity_routing_authoritative: false as const
        }
      },
      assessment_response_evidence: [
        {
          item_public_id: fixture.items[0].item_public_id,
          selected_option: "B",
          correctness: "incorrect" as const,
          written_reasoning:
            "I focused on consistency and did not separate it from interpretation.",
          confidence: "medium",
          revision_summary: null,
          tempting_option: null,
          tempting_option_reason: null,
          safe_timing_summary: {
            total_item_time_ms: 60_000,
            response_time_answer_ms: null,
            response_time_reasoning_ms: null,
            response_time_confidence_ms: null
          }
        }
      ],
      assessment_process_evidence: [
        {
          event_type: "item_completed",
          event_category: "initial_administration",
          event_source: "backend",
          item_public_id: fixture.items[0].item_public_id,
          occurred_at: "2026-07-28T08:01:00.000Z",
          visibility_duration_ms: null,
          pause_duration_ms: null
        }
      ],
      initial_profile: profileEvidence,
      current_profile: profileEvidence
    };
    let runnerCallCount = 0;
    let latestCompiledContext:
      | {
          visible_transcript: Array<{
            actor: "student" | "tutor";
            message_text: string;
          }>;
          latest_student_message: string | null;
          assessment_specification: {
            learning_objective: string | null;
          } | null;
          assessment_response_evidence: unknown[];
          assessment_process_evidence: unknown[];
        }
      | undefined;
    const readLatestCompiledContext = () => latestCompiledContext;
    const runner: FormativeConversationAgentRunner = {
      identity: {
        agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
        agent_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
        model_name: "deterministic-formative-conversation-fixture",
        provider: "mock",
        prompt_version: "formative-conversation-runtime-smoke-v1",
        schema_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
        prompt_hash: createHash("sha256")
          .update("formative-conversation-runtime-smoke-v1")
          .digest("hex"),
        reasoning_effort: null,
        max_output_tokens: 1_000,
        live_call_allowed: false
      },
      async execute(input) {
        runnerCallCount += 1;
        latestCompiledContext = input.context;
        const latestStudentTurn = [...input.context.visible_transcript]
          .reverse()
          .find((turn) => turn.actor === "student");
        const startedAt = new Date();
        const completedAt = new Date(startedAt.getTime() + 25);
        if (!latestStudentTurn) {
          return {
            output: {
              contract_version:
                FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
              student_visible_message:
                "You've reviewed your answers. We can begin with the distinction between score consistency and the evidence needed for an intended interpretation.",
              teaching_artifact: null,
              evidence_observations: [],
              teacher_assistance_recommendation: {
                recommended: false,
                reason_code: null
              },
              profile_transition_recommendation: null,
              lifecycle_recommendation: "continue" as const
            },
            raw_output: {
              fixture: "deterministic_no_provider_opening",
              contract_version:
                FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION
            },
            generation_source: "deterministic_test",
            provider_request_id: "mock-request-runtime-opening",
            provider_response_id: "mock-response-runtime-opening",
            client_request_id: "mock-client-runtime-opening",
            retry_count: 0,
            latency_ms: 25,
            input_tokens: 70,
            output_tokens: 25,
            total_tokens: 95,
            estimated_cost: 0,
            started_at: startedAt,
            completed_at: completedAt
          };
        }
        return {
          output: {
            contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
            student_visible_message:
              "Consistency tells you how steadily scores behave. What additional evidence would you need before using those scores for an intended interpretation?",
            teaching_artifact: null,
            evidence_observations: [
              {
                evidence_type: "student_question",
                observation:
                  "The student asks about the boundary between consistency and interpretation.",
                source_turn_sequence_indexes: [
                  latestStudentTurn.sequence_index
                ]
              }
            ],
            teacher_assistance_recommendation: {
              recommended: false,
              reason_code: null
            },
            profile_transition_recommendation: {
              recommended: true,
              proposed_outcome: "teacher_assistance_recommended",
              rationale:
                "The conversation has not yet produced independent application evidence.",
              source_turn_sequence_indexes: [
                latestStudentTurn.sequence_index
              ]
            },
            lifecycle_recommendation: "continue"
          },
          raw_output: {
            fixture: "deterministic_no_provider",
            contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION
          },
          generation_source: "deterministic_test",
          provider_request_id: "mock-request-runtime-1",
          provider_response_id: "mock-response-runtime-1",
          client_request_id: "mock-client-runtime-1",
          retry_count: 0,
          latency_ms: 25,
          input_tokens: 80,
          output_tokens: 30,
          total_tokens: 110,
          estimated_cost: 0,
          started_at: startedAt,
          completed_at: completedAt
        };
      }
    };
    const blockedOpening = validateFormativeConversationOpeningOutput({
      contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
      student_visible_message:
        "Your profile has a growth target. Try this next activity.",
      teaching_artifact: null,
      evidence_observations: [],
      profile_transition_recommendation: null,
      teacher_assistance_recommendation: {
        recommended: false,
        reason_code: null
      },
      lifecycle_recommendation: "continue"
    });
    assert.equal(blockedOpening.valid, false);
    assert(
      blockedOpening.issue_codes.includes(
        "opening_exposes_profile_language"
      )
    );
    assert(
      blockedOpening.issue_codes.includes(
        "opening_exposes_growth_target_language"
      )
    );
    assert(
      blockedOpening.issue_codes.includes("opening_prescribes_activity")
    );
    const naturalOpeningWithoutFixedQuestion =
      validateFormativeConversationOpeningOutput({
        contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
        student_visible_message:
          "You've reviewed your answers. We can begin with the distinction that matters most in your reasoning.",
        teaching_artifact: null,
        evidence_observations: [],
        profile_transition_recommendation: null,
        teacher_assistance_recommendation: {
          recommended: false,
          reason_code: null
        },
        lifecycle_recommendation: "continue"
      });
    assert.equal(
      naturalOpeningWithoutFixedQuestion.valid,
      true,
      "Opening validation must not impose a fixed question or invitation format."
    );

    const opening = await processFormativeConversationOpening(
      {
        conversation_public_id: conversation.conversation_public_id,
        context
      },
      { runner }
    );
    assert.equal(opening.replayed, false);
    assert.equal(runnerCallCount, 1);
    const openingCompiledContext = readLatestCompiledContext();
    assert.equal(openingCompiledContext?.latest_student_message, null);
    assert.deepEqual(openingCompiledContext?.visible_transcript, []);
    assert.equal(
      openingCompiledContext?.assessment_specification?.learning_objective,
      fixture.conceptUnit.learning_objective
    );
    assert.equal(
      openingCompiledContext?.assessment_response_evidence.length,
      1
    );
    assert.equal(
      openingCompiledContext?.assessment_process_evidence.length,
      1
    );
    assert.equal(opening.tutor_turn.agent_name, FORMATIVE_CONVERSATION_AGENT_NAME);
    assert.equal(
      (
        opening.tutor_turn.structured_payload as Record<string, unknown>
      ).message_type,
      "formative_conversation_opening"
    );
    assert.equal(
      opening.agent_call?.formative_conversation_session_db_id,
      conversation.id
    );
    assert.equal(
      opening.agent_call?.agent_invocation_key,
      formativeConversationInvocationKey(
        conversation.conversation_public_id,
        FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID
      )
    );
    const replayedOpening = await processFormativeConversationOpening(
      {
        conversation_public_id: conversation.conversation_public_id,
        context
      },
      { runner }
    );
    assert.equal(replayedOpening.replayed, true);
    assert.equal(replayedOpening.tutor_turn.id, opening.tutor_turn.id);
    assert.equal(
      runnerCallCount,
      1,
      "Refreshing the conversation must not regenerate its opening."
    );

    const firstClientMessageId = `${prefix}_message_1`;
    const firstMessage = "Why is consistency not enough?";
    const firstResult = await processFormativeConversationStudentMessage(
      {
        conversation_public_id: conversation.conversation_public_id,
        client_message_id: firstClientMessageId,
        message_text: firstMessage,
        context,
        observable_input_telemetry: {
          turn_started_at: new Date("2026-07-28T08:02:00.000Z"),
          submitted_at: new Date("2026-07-28T08:02:05.000Z"),
          response_time_ms: 5_000,
          typing_started_at: new Date("2026-07-28T08:02:01.000Z"),
          typing_ended_at: new Date("2026-07-28T08:02:04.000Z"),
          typing_duration_ms: 2_500,
          typing_duration_method: "active_intervals",
          edit_count: 2,
          backspace_count: 1,
          paste_event_count: 0
        }
      },
      { runner }
    );
    assert.equal(firstResult.replayed, false);
    assert.equal(firstResult.resumed, false);
    assert.equal(runnerCallCount, 2);
    const firstCompiledContext = readLatestCompiledContext();
    assert.equal(firstCompiledContext?.latest_student_message, firstMessage);
    assert.deepEqual(
      firstCompiledContext?.visible_transcript.map((turn) => turn.actor),
      ["tutor", "student"]
    );
    assert.equal(
      firstResult.agent_call?.formative_conversation_session_db_id,
      conversation.id
    );
    assert.equal(
      firstResult.agent_call?.formative_conversation_context_version,
      "formative-conversation-context-v1"
    );
    assert.equal(firstResult.evidence_references.length, 1);
    assert(firstResult.profile_transition_recommendation);
    assert.deepEqual(
      firstResult.evidence_references[0].source_turn_sequence_indexes,
      [firstResult.student_turn.sequence_index]
    );
    assert.equal(
      (
        await prisma.formativeConversationSession.findUniqueOrThrow({
          where: { id: conversation.id }
        })
      ).current_student_profile_db_id,
      initialProfile.id,
      "Agent evidence must not directly mutate the current profile."
    );

    const replayed = await processFormativeConversationStudentMessage(
      {
        conversation_public_id: conversation.conversation_public_id,
        client_message_id: firstClientMessageId,
        message_text: firstMessage,
        context,
        observable_input_telemetry: {
          turn_started_at: new Date("2026-07-28T08:02:00.000Z"),
          submitted_at: new Date("2026-07-28T08:02:05.000Z"),
          response_time_ms: 5_000,
          typing_started_at: new Date("2026-07-28T08:02:01.000Z"),
          typing_ended_at: new Date("2026-07-28T08:02:04.000Z"),
          typing_duration_ms: 2_500,
          typing_duration_method: "active_intervals",
          edit_count: 2,
          backspace_count: 1,
          paste_event_count: 0
        }
      },
      { runner }
    );
    assert.equal(replayed.replayed, true);
    assert.equal(runnerCallCount, 2, "A duplicate message must not call the agent again.");
    assert.equal(replayed.tutor_turn.id, firstResult.tutor_turn.id);

    const secondClientMessageId = `${prefix}_message_2`;
    const secondMessage = "So interpretation needs more evidence than consistency.";
    const reserved =
      await reserveAndPersistFormativeConversationStudentMessage({
        conversation_public_id: conversation.conversation_public_id,
        client_message_id: secondClientMessageId,
        message_text: secondMessage
      });
    assert(reserved.receipt.student_turn);
    const resumedOutput = {
      contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
      student_visible_message:
        "Yes. Apply that distinction to one claim the scores are being used to support.",
      teaching_artifact: null,
      evidence_observations: [
        {
          evidence_type: "conceptual_distinction",
          observation:
            "The student distinguishes consistency evidence from interpretation evidence.",
          source_turn_sequence_indexes: [
            reserved.receipt.student_turn.sequence_index
          ]
        }
      ],
      teacher_assistance_recommendation: {
        recommended: false,
        reason_code: null
      },
      lifecycle_recommendation: "continue" as const
    };
    const resumeStartedAt = new Date();
    const resumeCompletedAt = new Date(resumeStartedAt.getTime() + 15);
    await prisma.agentCall.create({
      data: {
        assessment_session_db_id: fixture.session.id,
        concept_unit_session_db_id: fixture.conceptUnitSession.id,
        formative_conversation_session_db_id: conversation.id,
        formative_conversation_context_version:
          "formative-conversation-context-v1",
        agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
        agent_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
        model_name: "deterministic-formative-conversation-resume-fixture",
        provider: "mock",
        provider_request_id: "mock-request-runtime-resume",
        provider_response_id: "mock-response-runtime-resume",
        agent_invocation_key: formativeConversationInvocationKey(
          conversation.conversation_public_id,
          secondClientMessageId
        ),
        prompt_hash: createHash("sha256")
          .update("formative-conversation-runtime-resume-v1")
          .digest("hex"),
        prompt_version: "formative-conversation-runtime-resume-v1",
        schema_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
        input_payload: { fixture: "persisted_before_tutor_turn" },
        raw_output: resumedOutput,
        output_payload: resumedOutput,
        output_validated: true,
        usage_guard_snapshot: { generation_source: "deterministic_test" },
        live_call_allowed: false,
        retry_count: 0,
        call_status: "succeeded",
        latency_ms: 15,
        input_tokens: 90,
        output_tokens: 20,
        total_tokens: 110,
        token_usage: {
          input_tokens: 90,
          output_tokens: 20,
          total_tokens: 110
        },
        started_at: resumeStartedAt,
        completed_at: resumeCompletedAt
      }
    });
    const resumed = await processFormativeConversationStudentMessage(
      {
        conversation_public_id: conversation.conversation_public_id,
        client_message_id: secondClientMessageId,
        message_text: secondMessage,
        context
      },
      { runner }
    );
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.replayed, false);
    assert.equal(runnerCallCount, 2, "Resume should use the persisted validated agent result.");

    const transcript = await getFormativeConversationTranscript(
      conversation.conversation_public_id
    );
    assert.deepEqual(
      transcript.conversation_turns.map((turn) => turn.message_text),
      [
        opening.tutor_turn.message_text,
        firstMessage,
        firstResult.tutor_turn.message_text,
        secondMessage,
        resumedOutput.student_visible_message
      ]
    );
    const lifecycleEvents =
      await prisma.formativeConversationLifecycleEvent.findMany({
        where: { formative_conversation_session_db_id: conversation.id },
        orderBy: { sequence_index: "asc" },
        select: { sequence_index: true, event_type: true }
      });
    assert.deepEqual(
      lifecycleEvents.slice(0, 5).map((event) => event.event_type),
      [
        "session_started",
        "agent_call_started",
        "agent_call_completed",
        "tutor_message_persisted",
        "student_message_persisted"
      ]
    );
    assert(
      lifecycleEvents.every(
        (event, index) =>
          index === 0 ||
          event.sequence_index > lifecycleEvents[index - 1].sequence_index
      ),
      "Runtime events should have a stable persisted order."
    );
    assert.equal(
      await prisma.formativeConversationMessageReceipt.count({
        where: { formative_conversation_session_db_id: conversation.id }
      }),
      3
    );
    assert.equal(
      await prisma.agentCall.count({
        where: {
          formative_conversation_session_db_id: conversation.id,
          agent_name: FORMATIVE_CONVERSATION_AGENT_NAME
        }
      }),
      3
    );
    assert.equal(
      await prisma.agentCall.count({
        where: {
          formative_conversation_session_db_id: conversation.id,
          provider: { not: "mock" }
        }
      }),
      0
    );
    assert.equal(
      await prisma.topicDialogue.count({
        where: { assessment_session_db_id: fixture.session.id }
      }),
      beforeTopicDialogueCount,
      "The legacy topic-dialogue runtime must remain unchanged."
    );
    const studentUiSource = readFileSync(
      "src/components/student-assessment/assessment-session-client.tsx",
      "utf8"
    );
    assert(
      studentUiSource.includes(
        "const activePrompt = state.formative_conversation ?"
      ),
      "The formative conversation must take precedence over legacy activity controls."
    );
    for (const marker of [
      "formative-conversation-controls",
      "formative-conversation-input",
      "send-formative-conversation-message",
      "handleSendFormativeConversationMessage",
      "handleFormativeConversationLifecycle"
    ]) {
      assert(
        studentUiSource.includes(marker),
        `Student formative conversation UI is missing ${marker}.`
      );
    }

    const {
      getStudentFormativeConversationProjection,
      updateStudentFormativeConversationLifecycle
    } = await import(
      "../src/lib/services/student-assessment/formative-conversation/projection"
    );
    const projection = await getStudentFormativeConversationProjection({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id
    });
    assert(projection);
    assert.equal(projection.transcript.length, 5);
    assert.equal(projection.transcript[0].turn_id, opening.tutor_turn.id);
    assert.equal(projection.can_send, true);
    assert.equal(
      await getStudentFormativeConversationProjection({
        student_user_db_id: fixture.teacher.id,
        session_public_id: fixture.session.session_public_id
      }),
      null,
      "A different user must not receive the student conversation projection."
    );
    const pausedProjection =
      await updateStudentFormativeConversationLifecycle({
        student_user_db_id: fixture.student.id,
        session_public_id: fixture.session.session_public_id,
        action: "pause"
      });
    assert(pausedProjection);
    assert.equal(pausedProjection.status, "paused");
    assert.equal(pausedProjection.can_send, false);
    assert.equal(pausedProjection.can_resume, true);
    const resumedProjection =
      await updateStudentFormativeConversationLifecycle({
        student_user_db_id: fixture.student.id,
        session_public_id: fixture.session.session_public_id,
        action: "resume"
      });
    assert(resumedProjection);
    assert.equal(resumedProjection.status, "active");
    assert.equal(resumedProjection.can_send, true);
    assert.equal(resumedProjection.can_pause, true);
    assert.deepEqual(
      (
        await prisma.formativeConversationLifecycleEvent.findMany({
          where: {
            formative_conversation_session_db_id: conversation.id,
            event_type: { in: ["paused", "resumed"] }
          },
          orderBy: { sequence_index: "asc" },
          select: { event_type: true }
        })
      ).map((event) => event.event_type),
      ["paused", "resumed"]
    );

    const { getTeacherReviewSessionDetail } = await import(
      "../src/lib/services/teacher-review/session-detail"
    );
    const teacherDetail = await getTeacherReviewSessionDetail(
      fixture.session.session_public_id
    );
    assert.equal(teacherDetail.formative_conversations.length, 1);
    assert.equal(
      teacherDetail.formative_conversations[0].timeline.length,
      5
    );
    assert.equal(
      teacherDetail.formative_conversations[0].learning_outcome,
      "teacher_assistance_recommended"
    );
    const teacherFormativeProjection = JSON.stringify(
      teacherDetail.formative_conversations
    );
    for (const prohibitedTeacherField of [
      "input_payload",
      "raw_output",
      "provider_request_id",
      "provider_response_id",
      "model_name",
      "prompt_version",
      "prompt_hash",
      "token_usage",
      "latency_ms",
      "agent_name"
    ]) {
      assert.equal(
        teacherFormativeProjection.includes(prohibitedTeacherField),
        false,
        `Teacher formative review must not expose ${prohibitedTeacherField}.`
      );
    }
    const teacherReviewUiSource = readFileSync(
      "src/components/teacher-review/session-detail-client.tsx",
      "utf8"
    );
    assert(
      teacherReviewUiSource.includes(
        'data-testid="teacher-formative-conversation-review"'
      )
    );
    for (const legacyActivityReviewLabel of [
      'labelText="Activity attempts"',
      'labelText="Failed-closed activity attempts"',
      ">Activity runtime states<",
      ">Activity student choices<"
    ]) {
      assert.equal(
        teacherReviewUiSource.includes(legacyActivityReviewLabel),
        false,
        `Teacher review must not display legacy activity completion UI: ${legacyActivityReviewLabel}.`
      );
    }

    const previousPseudonymizationKey =
      process.env.RESEARCH_PSEUDONYMIZATION_KEY;
    process.env.RESEARCH_PSEUDONYMIZATION_KEY =
      "formative-conversation-runtime-smoke-research-key";
    try {
      const { buildAnalysisReadyResearchDataBundle } = await import(
        "../src/lib/services/teacher-research-data/analysis-ready-export"
      );
      const exportResult = await buildAnalysisReadyResearchDataBundle({
        teacher_user_db_id: fixture.teacher.id,
        scope: "selected_session",
        session_public_id: fixture.session.session_public_id,
        include_incomplete_sessions: true
      });
      const repeatedExport = await buildAnalysisReadyResearchDataBundle({
        teacher_user_db_id: fixture.teacher.id,
        scope: "selected_session",
        session_public_id: fixture.session.session_public_id,
        include_incomplete_sessions: true
      });
      const file = (path: string) =>
        exportResult.files.find((entry) => entry.path === path)?.data ?? "";
      for (const path of [
        "formative_conversation_sessions.csv",
        "formative_conversation_turns.csv",
        "formative_conversation_events.csv",
        "formative_conversation_llm_calls.csv",
        "formative_conversation_profile_transitions.csv",
        "formative_conversation_interventions.csv",
        "formative_conversation_data_dictionary.csv"
      ]) {
        assert(file(path), `${path} should be included in the research export.`);
        assert.equal(
          repeatedExport.files.find((entry) => entry.path === path)?.data,
          file(path),
          `${path} should be reproducible from unchanged source records.`
        );
      }
      assert(
        file("formative_conversation_turns.csv").includes(firstMessage)
      );
      assert(
        file("formative_conversation_llm_calls.csv").includes(
          FORMATIVE_CONVERSATION_AGENT_NAME
        )
      );
      const sessionRows = parse(file("sessions.csv"), {
        columns: true,
        skip_empty_lines: true
      }) as Array<Record<string, string>>;
      const sessionRow = sessionRows.find(
        (row) => row.session_public_id === fixture.session.session_public_id
      );
      assert(sessionRow, "The formative conversation session should be exported.");
      assert.equal(
        sessionRow.canonical_runtime_state,
        "FORMATIVE_CONVERSATION"
      );
      assert.equal(sessionRow.active_activity_id, "");
      assert.equal(sessionRow.formative_activity_completion_status, "");
      const exportedText = exportResult.files
        .filter((entry) => entry.path.startsWith("formative_conversation_"))
        .map((entry) => entry.data)
        .join("\n");
      assert(!exportedText.includes("Teacher-only distractor rationale."));
      assert(!exportedText.includes("password_hash"));
      assert(!exportedText.includes("input_payload"));
      assert(!exportedText.includes("raw_output"));
    } finally {
      if (previousPseudonymizationKey === undefined) {
        delete process.env.RESEARCH_PSEUDONYMIZATION_KEY;
      } else {
        process.env.RESEARCH_PSEUDONYMIZATION_KEY =
          previousPseudonymizationKey;
      }
    }

    console.log(
      JSON.stringify(
        {
          status: "passed",
          smoke: "student-formative-conversation-runtime",
          assertions: [
            "automatic_session_creation_after_initial_profile",
            "assistant_first_opening_and_opening_language_validation",
            "idempotent_opening_refresh_resume",
            "student_and_tutor_message_persistence",
            "observable_event_ordering",
            "agent_call_binding",
            "validated_agent_result_resume",
            "idempotent_duplicate_message",
            "profile_evidence_reference_without_profile_mutation",
            "student_conversation_projection_and_privacy_isolation",
            "student_pause_and_resume_lifecycle",
            "teacher_formative_trajectory_review",
            "phase_separated_research_export_and_dictionary",
            "legacy_topic_dialogue_preserved"
          ],
          provider_calls: 0
        },
        null,
        2
      )
    );
  } finally {
    await cleanupRuntimeFixture(prefix);
  }
}

main()
  .catch((error: unknown) => {
    const safeMessage =
      error instanceof Error
        ? error.message
        : "Unknown formative conversation runtime smoke failure.";
    console.error(safeMessage);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
