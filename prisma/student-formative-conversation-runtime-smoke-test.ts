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
      FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS,
      FORMATIVE_CONVERSATION_CANONICAL_PROFILE_VERSION,
      FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID,
      FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
      FormativeConversationResponseGenerationError,
      FormativeConversationUnavailableError,
      FormativeConversationProfileEvidenceSchema,
      canonicalFormativeConversationProfileFromStudentProfile,
      formativeConversationInvocationKey,
      getFormativeConversationTranscript,
      getStudentFormativeConversationProjection,
      persistedFormativeConversationOutcome,
      processFormativeConversationOpening,
      processFormativeConversationStudentMessage,
      reserveAndPersistFormativeConversationStudentMessage,
      validateFormativeConversationOpeningOutput
    } = await import(
      "../src/lib/services/student-assessment/formative-conversation/index"
    );
    assert.equal(
      persistedFormativeConversationOutcome([]),
      null,
      "No persisted transition must produce no validated formative outcome."
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
    const persistedInitialProfile = await persistInitialStudentProfile({
      concept_unit_session_db_id: fixture.conceptUnitSession.id,
      based_on_agent_call_db_id: null,
      output: profileOutput
    });
    const initialProfile = await prisma.studentProfile.update({
      where: { id: persistedInitialProfile.id },
      data: {
        ability_profile: "misconception_based_understanding",
        integrated_diagnostic_profile:
          "misconception_with_sufficient_engagement",
        integrated_profile_confidence: "medium",
        integrated_profile_rationale:
          "The assessment evidence supports a consistency-versus-validity misconception.",
        evidence_sufficiency: "limited",
        confidence_alignment: "overconfident",
        misconception_indicators: [
          "Consistency evidence alone establishes validity."
        ],
        reasoning_quality_summary:
          "The reasoning treats consistency as sufficient validity evidence.",
        profile_confidence: "medium",
        rationale:
          "The initial profile is based on the administered assessment evidence.",
        recommended_next_evidence: [
          "Explain why consistency evidence is not enough for an intended interpretation."
        ]
      }
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
    const { getTeacherReviewSessionDetail } = await import(
      "../src/lib/services/teacher-review/session-detail"
    );
    await prisma.studentProfile.update({
      where: { id: initialProfile.id },
      data: {
        integrated_diagnostic_profile:
          "robust_understanding_ready_for_transfer",
        integrated_profile_rationale:
          "This temporary test value must not imply a persisted formative outcome."
      }
    });
    const noTransitionTeacherDetail =
      await getTeacherReviewSessionDetail(
        fixture.session.session_public_id
      );
    assert.equal(
      noTransitionTeacherDetail.formative_conversations[0]
        .learning_outcome,
      null,
      "Teacher review must not infer an outcome from a profile field when no transition exists."
    );
    await prisma.studentProfile.update({
      where: { id: initialProfile.id },
      data: {
        integrated_diagnostic_profile:
          initialProfile.integrated_diagnostic_profile,
        integrated_profile_rationale:
          initialProfile.integrated_profile_rationale
      }
    });

    const beforeTopicDialogueCount = await prisma.topicDialogue.count({
      where: { assessment_session_db_id: fixture.session.id }
    });
    const beforeActivityAttemptCount =
      await prisma.activityRuntimeAttempt.count({
        where: { session_public_id: fixture.session.session_public_id }
      });
    const initialCanonicalProfile =
      canonicalFormativeConversationProfileFromStudentProfile(
        initialProfile
      );
    const profileEvidence = {
      profile_version: initialProfile.id,
      outcome: "not_yet_determined" as const,
      evidence_summary: [
        "The initial package shows a distinction that needs further explanation."
      ],
      unresolved_evidence: [
        "Independent application of the distinction has not been observed."
      ],
      evidence_limitations: ["Only the initial package is available."],
      canonical_profile: initialCanonicalProfile,
      field_evidence: []
    };
    const fieldEvidenceFor = (
      priorProfile: typeof initialCanonicalProfile,
      updatedProfile: typeof initialCanonicalProfile,
      sourceTurnSequenceIndex: number
    ) => {
      const changedFields =
        FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
          (field) =>
            JSON.stringify(priorProfile[field]) !==
            JSON.stringify(updatedProfile[field])
        );
      const retainedFields =
        FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
          (field) => !changedFields.includes(field)
        );
      return [
        ...(changedFields.length > 0
          ? [
              {
                profile_fields: changedFields,
                disposition:
                  "updated_from_conversation_evidence" as const,
                evidence_basis: "conversation_evidence" as const,
                rationale:
                  "The cited student response provides new evidence for these profile fields.",
                source_turn_sequence_indexes: [
                  sourceTurnSequenceIndex
                ]
              }
            ]
          : []),
        ...(retainedFields.length > 0
          ? [
              {
                profile_fields: retainedFields,
                disposition:
                  "retained_evidence_remains_valid" as const,
                evidence_basis: "prior_profile_evidence" as const,
                rationale:
                  "The prior evidence for these fields remains valid and is not contradicted by this turn.",
                source_turn_sequence_indexes: []
              }
            ]
          : [])
      ];
    };
    const largelyImprovedProfile: typeof initialCanonicalProfile = {
      ...initialCanonicalProfile,
      schema_version:
        FORMATIVE_CONVERSATION_CANONICAL_PROFILE_VERSION,
      ability_profile: "mostly_correct_understanding" as const,
      ability_pattern_flags: [
        "The student distinguishes score consistency from validity evidence when prompted."
      ],
      integrated_diagnostic_profile:
        "developing_understanding_with_productive_engagement" as const,
      integrated_profile_confidence: "medium" as const,
      integrated_profile_rationale:
        "Conversation evidence shows an improved conceptual distinction, while independent application is still developing.",
      evidence_sufficiency: "adequate" as const,
      confidence_alignment: "well_calibrated" as const,
      misconception_indicators: [],
      reasoning_quality_summary:
        "The student now distinguishes consistency evidence from evidence for an intended interpretation.",
      profile_confidence: "medium" as const,
      rationale:
        "The updated profile reflects the cited conversation evidence.",
      recommended_next_evidence: [
        "Apply the distinction independently to a new score-use claim."
      ]
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
    const markdownTutorMessage =
      "**Consistency** tells you how steadily scores behave.\n\nWhat additional `evidence` would you need before using those scores for an intended interpretation?";
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
            student_visible_message: markdownTutorMessage,
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
              recommendation_version:
                FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
              recommended: true,
              proposed_outcome: "largely_improved_understanding",
              rationale:
                "The student is engaging with the distinction, while independent application evidence is still developing.",
              source_turn_sequence_indexes: [
                latestStudentTurn.sequence_index
              ],
              updated_profile: largelyImprovedProfile,
              field_evidence: fieldEvidenceFor(
                initialCanonicalProfile,
                largelyImprovedProfile,
                latestStudentTurn.sequence_index
              )
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

    const beforeOpeningProjection =
      await getStudentFormativeConversationProjection({
        student_user_db_id: fixture.student.id,
        session_public_id: fixture.session.session_public_id
      });
    assert(beforeOpeningProjection);
    assert.equal(beforeOpeningProjection.opening_status, "retry_available");
    assert.equal(beforeOpeningProjection.can_retry_opening, true);
    assert.equal(
      beforeOpeningProjection.can_send,
      false,
      "A new conversation must not accept student messages before its opening is persisted."
    );
    const agentCallsBeforeUnavailableOpening = await prisma.agentCall.count({
      where: {
        formative_conversation_session_db_id: conversation.id
      }
    });
    await assert.rejects(
      processFormativeConversationOpening(
        {
          conversation_public_id: conversation.conversation_public_id,
          context
        },
        {
          runner_factory() {
            throw new FormativeConversationUnavailableError(
              "approved_config_hash_mismatch"
            );
          }
        }
      ),
      (error) =>
        error instanceof FormativeConversationUnavailableError &&
        error.reason_code === "approved_config_hash_mismatch"
    );
    assert.equal(runnerCallCount, 0);
    assert.equal(
      await prisma.agentCall.count({
        where: {
          formative_conversation_session_db_id: conversation.id
        }
      }),
      agentCallsBeforeUnavailableOpening,
      "Unavailable operational configuration must fail before AgentCall creation."
    );
    const failedOpeningReceipt =
      await prisma.formativeConversationMessageReceipt.findUniqueOrThrow({
        where: {
          formative_conversation_session_db_id_client_message_id: {
            formative_conversation_session_db_id: conversation.id,
            client_message_id:
              FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID
          }
        }
      });
    assert.equal(failedOpeningReceipt.status, "failed");
    assert.equal(
      failedOpeningReceipt.failure_code,
      "approved_config_hash_mismatch"
    );
    const retryProjection = await getStudentFormativeConversationProjection({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id
    });
    assert(retryProjection);
    assert.equal(retryProjection.opening_status, "retry_available");
    assert.equal(retryProjection.can_retry_opening, true);
    assert.equal(retryProjection.can_send, false);
    const { studentAssessmentRouteError } = await import(
      "../src/lib/services/student-assessment/api"
    );
    const unavailableResponse = studentAssessmentRouteError(
      new FormativeConversationUnavailableError(
        "approved_config_hash_mismatch"
      )
    );
    assert.equal(unavailableResponse.status, 503);
    assert.deepEqual(await unavailableResponse.json(), {
      error: {
        code: "formative_conversation_unavailable",
        message:
          "The learning conversation is temporarily unavailable. Please try again.",
        details: {
          retryable: true
        }
      }
    });

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
        FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID,
        2
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
          paste_event_count: 1,
          paste_character_count: 18
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
    assert(firstResult.agent_call);
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
      ).current_student_profile_db_id === initialProfile.id,
      false,
      "A validated agent recommendation should append a new current profile version."
    );
    const firstTransition =
      await prisma.formativeConversationProfileTransition.findFirstOrThrow({
        where: {
          formative_conversation_session_db_id: conversation.id,
          source_agent_call_db_id: firstResult.agent_call.id
        },
        include: {
          prior_student_profile: true,
          updated_student_profile: true,
          supporting_turn_references: {
            include: {
              conversation_turn: {
                select: {
                  sequence_index: true,
                  actor_type: true
                }
              }
            }
          },
          profile_evidence_references: true
        }
      });
    assert.equal(firstTransition.learning_outcome, "largely_improved");
    assert.equal(
      firstTransition.transition_version,
      "formative-conversation-profile-transition-v2"
    );
    assert.equal(
      firstTransition.assessment_student_profile_db_id,
      initialProfile.id
    );
    assert.equal(
      firstTransition.updated_student_profile.ability_profile,
      "mostly_correct_understanding"
    );
    assert.equal(
      firstTransition.updated_student_profile.evidence_sufficiency,
      "adequate"
    );
    assert.equal(
      firstTransition.updated_student_profile.confidence_alignment,
      "well_calibrated"
    );
    assert.deepEqual(
      firstTransition.updated_student_profile.misconception_indicators,
      [],
      "The complete agent recommendation must remove a stale misconception instead of cloning it."
    );
    assert.equal(
      firstTransition.updated_student_profile.engagement_profile,
      firstTransition.prior_student_profile.engagement_profile,
      "An unchanged evidence-backed field may be retained explicitly."
    );
    assert.deepEqual(
      firstTransition.updated_student_profile.item_level_evidence,
      firstTransition.prior_student_profile.item_level_evidence,
      "Explicitly retained structured assessment evidence must not be replaced by its normalized agent-context summary."
    );
    const firstProfileSnapshot =
      FormativeConversationProfileEvidenceSchema.parse(
        firstTransition.profile_snapshot
      );
    assert.deepEqual(
      firstProfileSnapshot.canonical_profile,
      largelyImprovedProfile
    );
    assert(
      firstProfileSnapshot.field_evidence.some(
        (evidence) =>
          evidence.disposition ===
            "retained_evidence_remains_valid" &&
          evidence.profile_fields.includes("engagement_profile")
      ),
      "Retained profile fields must carry explicit evidence-validity provenance."
    );
    assert.deepEqual(
      firstTransition.supporting_turn_references
        .map((reference) => reference.conversation_turn.actor_type)
        .sort(),
      ["agent", "student"]
    );
    assert.equal(firstTransition.profile_evidence_references.length, 1);
    assert.equal(
      firstTransition.profile_evidence_references[0]
        .profile_transition_db_id,
      firstTransition.id
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
          paste_event_count: 1,
          paste_character_count: 18
        }
      },
      { runner }
    );
    assert.equal(replayed.replayed, true);
    assert.equal(runnerCallCount, 2, "A duplicate message must not call the agent again.");
    assert.equal(replayed.tutor_turn.id, firstResult.tutor_turn.id);
    assert.equal(
      replayed.profile_transition_recommendation?.transition.id,
      firstTransition.id,
      "Idempotent replay must return the authoritative existing transition."
    );
    assert.equal(
      await prisma.formativeConversationProfileTransition.count({
        where: {
          formative_conversation_session_db_id: conversation.id
        }
      }),
      1,
      "Idempotent replay must not append another profile version."
    );

    let continueRunnerCallCount = 0;
    const continueRunner: FormativeConversationAgentRunner = {
      identity: runner.identity,
      async execute(input) {
        continueRunnerCallCount += 1;
        const latestStudentTurn = [...input.context.visible_transcript]
          .reverse()
          .find((turn) => turn.actor === "student");
        assert(latestStudentTurn);
        const startedAt = new Date();
        const completedAt = new Date(startedAt.getTime() + 20);
        return {
          output: {
            contract_version:
              FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
            student_visible_message:
              "That is useful evidence, but let us test the distinction with one more example before changing the profile again.",
            teaching_artifact: null,
            evidence_observations: [
              {
                evidence_type: "developing_application",
                observation:
                  "The student asks for another opportunity to apply the distinction.",
                source_turn_sequence_indexes: [
                  latestStudentTurn.sequence_index
                ]
              }
            ],
            profile_transition_recommendation: {
              recommendation_version:
                FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
              recommended: false,
              proposed_outcome: "continue_conversation" as const,
              rationale:
                "The conversation contains useful evidence but does not yet support another validated profile change.",
              source_turn_sequence_indexes: [
                latestStudentTurn.sequence_index
              ],
              updated_profile: null,
              field_evidence: []
            },
            teacher_assistance_recommendation: {
              recommended: false,
              reason_code: null
            },
            lifecycle_recommendation: "continue" as const
          },
          raw_output: {
            fixture: "deterministic_no_provider_continue"
          },
          generation_source: "deterministic_test",
          provider_request_id: "mock-request-runtime-continue",
          provider_response_id: "mock-response-runtime-continue",
          client_request_id: "mock-client-runtime-continue",
          retry_count: 0,
          latency_ms: 20,
          input_tokens: 75,
          output_tokens: 25,
          total_tokens: 100,
          estimated_cost: 0,
          started_at: startedAt,
          completed_at: completedAt
        };
      }
    };
    const continueMessageId = `${prefix}_message_continue`;
    const continueResult =
      await processFormativeConversationStudentMessage(
        {
          conversation_public_id: conversation.conversation_public_id,
          client_message_id: continueMessageId,
          message_text:
            "Can I try one more example before we decide?",
          context
        },
        { runner: continueRunner }
      );
    assert.equal(continueRunnerCallCount, 1);
    assert.equal(continueResult.evidence_references.length, 1);
    assert.equal(continueResult.profile_transition_recommendation, null);
    assert.equal(
      await prisma.formativeConversationProfileTransition.count({
        where: {
          formative_conversation_session_db_id: conversation.id
        }
      }),
      1,
      "continue_conversation must preserve evidence without forcing a profile transition."
    );

    const secondClientMessageId = `${prefix}_message_2`;
    const secondMessage = "So interpretation needs more evidence than consistency.";
    const reserved =
      await reserveAndPersistFormativeConversationStudentMessage({
        conversation_public_id: conversation.conversation_public_id,
        client_message_id: secondClientMessageId,
        message_text: secondMessage
      });
    assert(reserved.receipt.student_turn);
    const soundProfile: typeof initialCanonicalProfile = {
      ...largelyImprovedProfile,
      ability_profile:
        "robust_transfer_ready_understanding" as const,
      ability_pattern_flags: [
        "The student independently states the distinction and applies it to the intended interpretation."
      ],
      integrated_diagnostic_profile:
        "robust_understanding_ready_for_transfer" as const,
      integrated_profile_confidence: "high" as const,
      integrated_profile_rationale:
        "The cited conversation evidence supports sound understanding and independent application.",
      evidence_sufficiency: "strong" as const,
      independence_interpretability:
        "independent_understanding_likely" as const,
      reasoning_quality_summary:
        "The student independently explains why consistency evidence does not establish validity.",
      profile_confidence: "high" as const,
      rationale:
        "The complete profile reflects the latest valid conversation evidence.",
      recommended_next_evidence: []
    };
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
      profile_transition_recommendation: {
        recommendation_version:
          FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
        recommended: true,
        proposed_outcome: "sound_understanding" as const,
        rationale:
          "The student now states the conceptual boundary in their own words.",
        source_turn_sequence_indexes: [
          reserved.receipt.student_turn.sequence_index
        ],
        updated_profile: soundProfile,
        field_evidence: fieldEvidenceFor(
          largelyImprovedProfile,
          soundProfile,
          reserved.receipt.student_turn.sequence_index
        )
      },
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
    assert(resumed.profile_transition_recommendation);
    assert.equal(runnerCallCount, 2, "Resume should use the persisted validated agent result.");
    const profileTransitions =
      await prisma.formativeConversationProfileTransition.findMany({
        where: {
          formative_conversation_session_db_id: conversation.id
        },
        orderBy: { transitioned_at: "asc" },
        include: {
          supporting_turn_references: true,
          profile_evidence_references: true
        }
      });
    assert.equal(profileTransitions.length, 2);
    assert.equal(profileTransitions[0].learning_outcome, "largely_improved");
    assert.equal(profileTransitions[1].learning_outcome, "sound");
    assert.equal(
      profileTransitions[1].prior_student_profile_db_id,
      profileTransitions[0].updated_student_profile_db_id,
      "Profile history must form an append-only provenance chain."
    );
    assert.notEqual(
      profileTransitions[0].updated_student_profile_db_id,
      profileTransitions[1].updated_student_profile_db_id
    );
    assert.equal(
      (
        await prisma.formativeConversationSession.findUniqueOrThrow({
          where: { id: conversation.id },
          select: { status: true }
        })
      ).status,
      "active",
      "A validated profile outcome must not automatically end the conversation."
    );
    assert.equal(
      await prisma.studentProfile.count({
        where: {
          concept_unit_session_db_id: fixture.conceptUnitSession.id
        }
      }),
      3,
      "The initial profile and both formative updates must remain preserved."
    );
    assert.equal(
      (
        await prisma.formativeConversationSession.findUniqueOrThrow({
          where: { id: conversation.id }
        })
      ).current_student_profile_db_id,
      profileTransitions[1].updated_student_profile_db_id
    );
    const { compilePersistedFormativeConversationContext } = await import(
      "../src/lib/services/student-assessment/formative-conversation/context"
    );
    const evolvedContext =
      await compilePersistedFormativeConversationContext({
        conversation_public_id: conversation.conversation_public_id,
        ...context
      });
    assert.equal(
      evolvedContext.context.current_profile.outcome,
      "sound_understanding"
    );
    assert.deepEqual(
      evolvedContext.context.profile_history
        .filter(
          (profile) =>
            profile.evidence_source === FORMATIVE_CONVERSATION_AGENT_NAME
        )
        .map((profile) => profile.outcome),
      ["largely_improved_understanding", "sound_understanding"]
    );
    assert.deepEqual(
      evolvedContext.context.current_profile.canonical_profile,
      soundProfile,
      "The latest persisted transition must supply the canonical current profile."
    );
    assert.deepEqual(
      evolvedContext.context.profile_history.map(
        (profile) => profile.profile_version
      ),
      [
        initialProfile.id,
        profileTransitions[0].updated_student_profile_db_id,
        profileTransitions[1].updated_student_profile_db_id
      ],
      "Only the initial profile and append-only formative transitions belong in canonical history."
    );

    const transcript = await getFormativeConversationTranscript(
      conversation.conversation_public_id
    );
    assert.deepEqual(
      transcript.conversation_turns.map((turn) => turn.message_text),
      [
        opening.tutor_turn.message_text,
        firstMessage,
        firstResult.tutor_turn.message_text,
        "Can I try one more example before we decide?",
        continueResult.tutor_turn.message_text,
        secondMessage,
        resumedOutput.student_visible_message
      ]
    );
    const lifecycleEvents =
      await prisma.formativeConversationLifecycleEvent.findMany({
        where: { formative_conversation_session_db_id: conversation.id },
        orderBy: {
          conversation_local_event_sequence_index: "asc"
        },
        select: {
          sequence_index: true,
          conversation_local_event_sequence_index: true,
          event_type: true
        }
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
    assert.deepEqual(
      lifecycleEvents.map(
        (event) =>
          event.conversation_local_event_sequence_index
      ),
      lifecycleEvents.map((_, index) => index + 1),
      "Lifecycle events must retain a conversation-local sequence."
    );
    const turnTelemetry =
      await prisma.formativeConversationTurnTelemetry.findMany({
        where: {
          formative_conversation_session_db_id: conversation.id
        },
        orderBy: {
          conversation_local_turn_sequence_index: "asc"
        },
        select: {
          conversation_local_turn_sequence_index: true,
          agent_call: {
            select: {
              agent_call_public_id: true
            }
          }
        }
      });
    assert.deepEqual(
      turnTelemetry.map(
        (telemetry) =>
          telemetry.conversation_local_turn_sequence_index
      ),
      turnTelemetry.map((_, index) => index + 1),
      "Turn telemetry must retain a conversation-local sequence."
    );
    assert(
      turnTelemetry
        .filter((telemetry) => telemetry.agent_call)
        .every(
          (telemetry) =>
            (telemetry.agent_call?.agent_call_public_id.length ?? 0) > 0
        ),
      "Tutor telemetry must link through a safe public AgentCall key."
    );
    const firstInputTelemetry =
      await prisma.formativeConversationInputTelemetry.findUniqueOrThrow({
        where: {
          conversation_turn_db_id: firstResult.student_turn.id
        }
      });
    assert.equal(firstInputTelemetry.paste_event_count, 1);
    assert.equal(firstInputTelemetry.paste_character_count, 18);
    assert.equal(
      await prisma.formativeConversationMessageReceipt.count({
        where: { formative_conversation_session_db_id: conversation.id }
      }),
      4
    );
    assert.equal(
      await prisma.agentCall.count({
        where: {
          formative_conversation_session_db_id: conversation.id,
          agent_name: FORMATIVE_CONVERSATION_AGENT_NAME
        }
      }),
      4
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
    assert.equal(
      await prisma.activityRuntimeAttempt.count({
        where: { session_public_id: fixture.session.session_public_id }
      }),
      beforeActivityAttemptCount,
      "Profile evolution must not invoke deterministic activity routing."
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
      "formative-conversation-opening-retry",
      "formative-conversation-response-retry",
      "handleRetryFormativeConversationOpening",
      "handleRetryFormativeConversationResponse",
      "handleSendFormativeConversationMessage",
      "handleFormativeConversationLifecycle",
      "student-safe-error-message",
      "end-conversation-dialog",
      "confirm-end-conversation"
    ]) {
      assert(
        studentUiSource.includes(marker),
        `Student formative conversation UI is missing ${marker}.`
      );
    }
    assert.equal(
      studentUiSource.includes("{error.code}"),
      false,
      "Student-visible errors must not render internal API error codes."
    );
    assert(
      studentUiSource.includes("This does not") &&
        studentUiSource.includes("end the assessment attempt."),
      "Ending a learning conversation must remain visibly distinct from ending the assessment attempt."
    );
    const formativeMessageRouteSource = readFileSync(
      "src/app/api/student/sessions/[sessionPublicId]/formative-conversation/messages/route.ts",
      "utf8"
    );
    const formativeRetryRouteSource = readFileSync(
      "src/app/api/student/sessions/[sessionPublicId]/formative-conversation/messages/retry/route.ts",
      "utf8"
    );
    assert(
      formativeMessageRouteSource.includes(
        "FormativeConversationResponseGenerationError"
      ) &&
        formativeMessageRouteSource.includes(
          "runner_factory: createLiveFormativeConversationAgentRunner"
        ),
      "A terminal tutor-generation failure must return the persisted conversation state instead of a generic conflict."
    );
    assert(
      formativeRetryRouteSource.includes("requireStudent()") &&
        formativeRetryRouteSource.includes(
          "getFormativeConversationStudentMessageForRetry"
        ),
      "Tutor-response retry must remain authenticated and reuse the persisted student message."
    );

    const { updateStudentFormativeConversationLifecycle } = await import(
      "../src/lib/services/student-assessment/formative-conversation/projection"
    );
    const projection = await getStudentFormativeConversationProjection({
      student_user_db_id: fixture.student.id,
      session_public_id: fixture.session.session_public_id
    });
    assert(projection);
    assert.equal(projection.transcript.length, 7);
    assert.equal(projection.transcript[0].turn_id, opening.tutor_turn.id);
    assert.equal(projection.opening_status, "ready");
    assert.equal(projection.can_retry_opening, false);
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
    assert(
      studentUiSource.includes("Pause conversation") &&
        studentUiSource.includes("Resume conversation") &&
        studentUiSource.includes("End conversation") &&
        studentUiSource.includes("End attempt") &&
        studentUiSource.includes('record("left", true)') &&
        studentUiSource.includes('record("reentered")'),
      "Conversation pause/end controls and assessment-attempt termination must remain visibly distinct."
    );

    const { canAccessTeacherReview } = await import(
      "../src/lib/services/teacher-review/api"
    );
    assert.equal(canAccessTeacherReview("teacher_researcher"), true);
    assert.equal(canAccessTeacherReview("student"), false);
    const teacherDetail = await getTeacherReviewSessionDetail(
      fixture.session.session_public_id
    );
    assert.equal(teacherDetail.formative_conversations.length, 1);
    assert.equal(
      teacherDetail.formative_conversations[0].timeline.length,
      7
    );
    assert.equal(
      teacherDetail.formative_conversations[0].learning_outcome,
      "sound"
    );
    assert.equal(
      teacherDetail.formative_conversations[0].current_learning_profile
        ?.assessment_specific_understanding,
      soundProfile.ability_profile
    );
    assert.equal(
      teacherDetail.formative_conversations[0].current_learning_profile
        ?.evidence_sufficiency,
      soundProfile.evidence_sufficiency
    );
    assert.deepEqual(
      teacherDetail.formative_conversations[0].current_learning_profile
        ?.misconception_evidence,
      soundProfile.misconception_indicators
    );
    assert.deepEqual(
      teacherDetail.formative_conversations[0].profile_evolution.map(
        (transition) => transition.learning_outcome
      ),
      ["largely_improved", "sound"]
    );
    assert(
      teacherDetail.formative_conversations[0].profile_evolution.every(
        (transition) =>
          transition.supporting_turns.some(
            (turn) =>
              turn.actor === "student" && turn.message_text.length > 0
          ) &&
          transition.supporting_turns.some(
            (turn) =>
              turn.actor === "tutor" && turn.message_text.length > 0
          )
      )
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
      "agent_name",
      "based_on_agent_call",
      "ability_pattern_flags",
      "engagement_pattern_flags",
      "evidence_reference_public_ids",
      "turn_id"
    ]) {
      assert.equal(
        teacherFormativeProjection.includes(prohibitedTeacherField),
        false,
        `Teacher formative review must not expose ${prohibitedTeacherField}.`
      );
    }
    const { getTeacherReviewItemResponses } = await import(
      "../src/lib/services/teacher-review/item-responses"
    );
    const teacherItemResponses = await getTeacherReviewItemResponses(
      fixture.session.session_public_id
    );
    const React = await import("react");
    Object.assign(globalThis, { React: React.default });
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { FormativeConversationEvidenceSection } = await import(
      "../src/components/teacher-review/session-detail-client"
    );
    const teacherTrajectoryMarkup = renderToStaticMarkup(
      React.createElement(FormativeConversationEvidenceSection, {
        conversations: teacherDetail.formative_conversations,
        itemResponses: teacherItemResponses,
        sessionPublicId: fixture.session.session_public_id
      })
    );
    for (const requiredTeacherText of [
      "Initial assessment evidence",
      "Initial learning profile",
      "Student reasoning",
      "Formative conversation trajectory",
      "Latest validated learning summary",
      "What changed",
      "Remaining concern",
      "Suggested teacher attention",
      "Profile evolution",
      "Largely improved",
      "Sound",
      firstMessage,
      "I focused on consistency and did not separate it from interpretation."
    ]) {
      assert(
        teacherTrajectoryMarkup.includes(requiredTeacherText),
        `Teacher trajectory rendering must include ${requiredTeacherText}.`
      );
    }
    for (const prohibitedTeacherText of [
      "Based-on agent call metadata",
      "prompt_version",
      "provider_request_id",
      "raw_output",
      "input_payload",
      "activity routing",
      "deterministic workflow"
    ]) {
      assert.equal(
        teacherTrajectoryMarkup.includes(prohibitedTeacherText),
        false,
        `Teacher trajectory rendering must not include ${prohibitedTeacherText}.`
      );
    }
    assert.equal(
      teacherTrajectoryMarkup.includes("Conversation ID:"),
      false,
      "Routine teacher review should not foreground a technical conversation identifier."
    );
    const noTransitionTeacherTrajectoryMarkup = renderToStaticMarkup(
      React.createElement(FormativeConversationEvidenceSection, {
        conversations: noTransitionTeacherDetail.formative_conversations,
        itemResponses: teacherItemResponses,
        sessionPublicId: fixture.session.session_public_id
      })
    );
    assert(
      noTransitionTeacherTrajectoryMarkup.includes(
        "No validated learning change yet. Evidence collection continues."
      ) &&
        noTransitionTeacherTrajectoryMarkup.includes(
          "No validated teacher-attention recommendation yet."
        ),
      "Teacher summary must report the absence of a persisted transition without inferring an outcome."
    );
    const teacherReviewUiSource = readFileSync(
      "src/components/teacher-review/session-detail-client.tsx",
      "utf8"
    );
    assert(
      teacherReviewUiSource.includes(
        'data-testid="teacher-formative-conversation-review"'
      )
    );
    const teacherSessionRouteSource = readFileSync(
      "src/app/api/teacher/sessions/[sessionPublicId]/route.ts",
      "utf8"
    );
    assert(
      teacherSessionRouteSource.includes("await requireTeacherReview()"),
      "The teacher trajectory API must retain teacher/research authorization."
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

    const failedMessageId = `${prefix}_message_failed_generation`;
    const failedMessage =
      "Can you explain how the distinction applies here?";
    let failedRunnerCallCount = 0;
    const failedRunner: FormativeConversationAgentRunner = {
      identity: runner.identity,
      async execute() {
        failedRunnerCallCount += 1;
        throw new Error(
          "provider payload and sensitive transport detail must not persist"
        );
      }
    };
    await assert.rejects(
      processFormativeConversationStudentMessage(
        {
          conversation_public_id:
            conversation.conversation_public_id,
          client_message_id: failedMessageId,
          message_text: failedMessage,
          context
        },
        { runner: failedRunner }
      ),
      (error) =>
        error instanceof
          FormativeConversationResponseGenerationError &&
        error.response_status === "failed" &&
        error.retryable
    );
    assert.equal(failedRunnerCallCount, 1);
    const failedReceipt =
      await prisma.formativeConversationMessageReceipt.findFirstOrThrow({
        where: {
          formative_conversation_session_db_id: conversation.id,
          client_message_id: failedMessageId
        },
        include: {
          student_turn: true,
          assistant_turn: true,
          agent_calls: true
        }
      });
    assert(failedReceipt.student_turn);
    assert.equal(failedReceipt.assistant_turn, null);
    assert.equal(failedReceipt.assistant_response_status, "failed");
    assert.equal(failedReceipt.assistant_response_retry_count, 0);
    assert.equal(
      failedReceipt.assistant_response_last_failure_category,
      "agent_execution_failure"
    );
    assert(failedReceipt.assistant_response_last_failed_at);
    assert.equal(failedReceipt.agent_calls.length, 1);
    assert.equal(failedReceipt.agent_calls[0].call_status, "failed");
    assert.equal(
      JSON.stringify(failedReceipt).includes(
        "provider payload and sensitive transport detail"
      ),
      false,
      "Response lifecycle state must not retain raw provider errors."
    );
    const failedEvent =
      await prisma.formativeConversationLifecycleEvent.findFirstOrThrow({
        where: {
          formative_conversation_session_db_id: conversation.id,
          event_type: "agent_call_failed",
          agent_call_db_id: failedReceipt.agent_calls[0].id
        }
      });
    assert.equal(
      failedEvent.failure_category,
      "agent_execution_failure"
    );
    assert.equal(
      failedEvent.agent_name,
      FORMATIVE_CONVERSATION_AGENT_NAME
    );
    assert.equal(failedEvent.retry_count, 0);
    const failedProjection =
      await getStudentFormativeConversationProjection({
        student_user_db_id: fixture.student.id,
        session_public_id: fixture.session.session_public_id
      });
    assert(failedProjection);
    assert.equal(failedProjection.can_send, false);
    assert.equal(failedProjection.assistant_response?.status, "failed");
    assert.equal(failedProjection.assistant_response?.can_retry, true);
    assert(
      failedProjection.transcript.some(
        (turn) =>
          turn.message_text === failedMessage &&
          turn.assistant_response_status === "failed"
      ),
      "An orphan student turn must project as failed rather than as a completed exchange."
    );
    const failedTeacherDetail = await getTeacherReviewSessionDetail(
      fixture.session.session_public_id
    );
    const failedTeacherMarkup = renderToStaticMarkup(
      React.createElement(FormativeConversationEvidenceSection, {
        conversations:
          failedTeacherDetail.formative_conversations,
        itemResponses: teacherItemResponses,
        sessionPublicId: fixture.session.session_public_id
      })
    );
    assert(
      failedTeacherMarkup.includes("Tutor response incomplete"),
      "Teacher review must identify a preserved student turn without a completed tutor response."
    );

    let recoveryRunnerCallCount = 0;
    const recoveryRunner: FormativeConversationAgentRunner = {
      identity: runner.identity,
      async execute() {
        recoveryRunnerCallCount += 1;
        const startedAt = new Date();
        const completedAt = new Date(startedAt.getTime() + 30);
        return {
          output: {
            contract_version:
              FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
            student_visible_message:
              "Yes. Consistency asks whether scores hold together; validity asks whether the evidence supports how the scores will be interpreted and used.",
            teaching_artifact: null,
            evidence_observations: [],
            profile_transition_recommendation: null,
            teacher_assistance_recommendation: {
              recommended: false,
              reason_code: null
            },
            lifecycle_recommendation: "continue" as const
          },
          raw_output: {
            fixture: "deterministic_response_recovery"
          },
          generation_source: "deterministic_test",
          provider_request_id: "mock-request-runtime-recovery",
          provider_response_id: "mock-response-runtime-recovery",
          client_request_id: "mock-client-runtime-recovery",
          retry_count: 0,
          latency_ms: 30,
          input_tokens: 80,
          output_tokens: 25,
          total_tokens: 105,
          estimated_cost: 0,
          started_at: startedAt,
          completed_at: completedAt
        };
      }
    };
    const recovered = await processFormativeConversationStudentMessage(
      {
        conversation_public_id:
          conversation.conversation_public_id,
        client_message_id: failedMessageId,
        message_text: failedMessage,
        context
      },
      { runner: recoveryRunner }
    );
    assert.equal(recoveryRunnerCallCount, 1);
    assert.equal(recovered.replayed, false);
    assert(recovered.agent_call);
    assert.equal(
      recovered.agent_call.agent_invocation_key,
      formativeConversationInvocationKey(
        conversation.conversation_public_id,
        failedMessageId,
        2
      )
    );
    const recoveredReceipt =
      await prisma.formativeConversationMessageReceipt.findUniqueOrThrow({
        where: { id: failedReceipt.id },
        include: {
          assistant_turn: true,
          agent_calls: {
            orderBy: { created_at: "asc" }
          }
        }
      });
    assert.equal(
      recoveredReceipt.assistant_response_status,
      "completed"
    );
    assert.equal(recoveredReceipt.assistant_response_retry_count, 1);
    assert(recoveredReceipt.assistant_turn);
    assert.equal(recoveredReceipt.agent_calls.length, 2);
    assert.deepEqual(
      recoveredReceipt.agent_calls.map((call) => call.call_status),
      ["failed", "succeeded"]
    );
    const recoveredReplay =
      await processFormativeConversationStudentMessage(
        {
          conversation_public_id:
            conversation.conversation_public_id,
          client_message_id: failedMessageId,
          message_text: failedMessage,
          context
        },
        { runner: recoveryRunner }
      );
    assert.equal(recoveredReplay.replayed, true);
    assert.equal(
      recoveryRunnerCallCount,
      1,
      "A completed retry must replay without another provider attempt."
    );
    assert.equal(
      await prisma.conversationTurn.count({
        where: {
          formative_conversation_session_db_id: conversation.id,
          id: recoveredReceipt.assistant_turn?.id
        }
      }),
      1,
      "Retry recovery must persist exactly one tutor turn."
    );
    const recoveredProjection =
      await getStudentFormativeConversationProjection({
        student_user_db_id: fixture.student.id,
        session_public_id: fixture.session.session_public_id
      });
    assert(recoveredProjection);
    assert.equal(recoveredProjection.assistant_response, null);
    assert.equal(recoveredProjection.can_send, true);

    const assessmentLifecycleBeforeConversationEnd =
      await prisma.assessmentSession.findUniqueOrThrow({
        where: { id: fixture.session.id },
        select: {
          status: true,
          current_phase: true
        }
      });
    const endedProjection =
      await updateStudentFormativeConversationLifecycle({
        student_user_db_id: fixture.student.id,
        session_public_id: fixture.session.session_public_id,
        action: "end"
      });
    assert(endedProjection);
    assert.equal(endedProjection.status, "ended");
    assert.equal(endedProjection.can_send, false);
    assert.equal(
      await prisma.formativeConversationLifecycleEvent.count({
        where: {
          formative_conversation_session_db_id: conversation.id,
          event_type: "conversation_ended"
        }
      }),
      1,
      "Ending a formative conversation must use its own observable lifecycle event."
    );
    assert.deepEqual(
      await prisma.assessmentSession.findUniqueOrThrow({
        where: { id: fixture.session.id },
        select: {
          status: true,
          current_phase: true
        }
      }),
      assessmentLifecycleBeforeConversationEnd,
      "Ending the conversation must not end the assessment attempt."
    );

    const previousPseudonymizationKey =
      process.env.RESEARCH_PSEUDONYMIZATION_KEY;
    process.env.RESEARCH_PSEUDONYMIZATION_KEY =
      "formative-conversation-runtime-smoke-research-key";
    try {
      const legacyDecision = await prisma.formativeDecision.create({
        data: {
          concept_unit_session_db_id:
            fixture.conceptUnitSession.id,
          student_profile_db_id: initialProfile.id,
          formative_value: "reasoning_refinement",
          formative_action_plan:
            "Historical fixture retained for export classification.",
          target_evidence: {},
          success_criteria: {},
          followup_prompt_constraints: {},
          profile_update_triggers: {},
          rationale:
            "Historical fixture retained for export classification.",
          mapping_followed: true
        }
      });
      await prisma.followupRound.create({
        data: {
          concept_unit_session_db_id:
            fixture.conceptUnitSession.id,
          round_index: 1,
          formative_decision_db_id: legacyDecision.id,
          status: "active",
          evidence_trigger_type: "historical_fixture"
        }
      });
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
      const formativeDictionaryRows = parse(
        file("formative_conversation_data_dictionary.csv"),
        {
          columns: true,
          skip_empty_lines: true
        }
      ) as Array<Record<string, string>>;
      const formativeDictionaryVariables = new Set(
        formativeDictionaryRows.map((row) => row.variable)
      );
      for (const requiredVariable of [
        "agent_call_public_id",
        "source_agent_call_public_id",
        "response_receipt_public_id",
        "assistant_response_status",
        "assistant_response_retry_count",
        "assistant_response_failure_category",
        "assistant_response_failed_at",
        "failure_category",
        "conversation_local_turn_sequence_index",
        "conversation_local_event_sequence_index",
        "message_length_chars",
        "typing_duration_ms",
        "typing_duration_method",
        "edit_count",
        "backspace_count",
        "paste_event_count",
        "paste_character_count",
        "final_message_length_chars"
      ]) {
        assert(
          formativeDictionaryVariables.has(requiredVariable),
          `The emitted formative data dictionary must define ${requiredVariable}.`
        );
      }
      const researchDictionaryRows = parse(
        file("research_data_dictionary.csv"),
        {
          columns: true,
          skip_empty_lines: true
        }
      ) as Array<Record<string, string>>;
      assert(
        researchDictionaryRows.some(
          (row) =>
            row.table_name === "agent_activity_records" &&
            row.variable_name === "authority_status"
        ),
        "The emitted research data dictionary must define authority_status."
      );
      assert(
        file("formative_conversation_turns.csv").includes(firstMessage)
      );
      assert(
        file("formative_conversation_turns.csv").includes(
          markdownTutorMessage
        ),
        "Research transcript export must retain the exact Markdown source text."
      );
      assert(
        file("formative_conversation_llm_calls.csv").includes(
          FORMATIVE_CONVERSATION_AGENT_NAME
        )
      );
      const itemResponseRows = parse(file("item_responses.csv"), {
        columns: true,
        skip_empty_lines: true
      }) as Array<Record<string, string>>;
      assert(
        itemResponseRows.some(
          (row) =>
            row.session_public_id === fixture.session.session_public_id &&
            row.reasoning_text ===
              "I focused on consistency and did not separate it from interpretation." &&
            row.confidence_rating === "medium"
        ),
        "The assessment-phase export must preserve response, reasoning, and confidence evidence."
      );
      assert(
        file("formative_conversation_events.csv").includes(
          "student_message_persisted"
        ),
        "The formative export must preserve observable conversation telemetry."
      );
      assert(
        file("formative_conversation_events.csv").includes(
          "conversation_ended"
        ),
        "The formative export must distinguish explicit conversation end from assessment-attempt termination."
      );
      const transitionRows = parse(
        file("formative_conversation_profile_transitions.csv"),
        {
          columns: true,
          skip_empty_lines: true
        }
      ) as Array<Record<string, string>>;
      assert.deepEqual(
        transitionRows.map((row) => row.formative_outcome),
        ["largely_improved", "sound"]
      );
      assert(
        transitionRows.every(
          (row) =>
            row.transition_version ===
              "formative-conversation-profile-transition-v2" &&
            row.prior_profile_created_at.length > 0 &&
            row.updated_profile_created_at.length > 0 &&
            row.supporting_turn_sequence_indexes.length > 0 &&
            row.supporting_turn_evidence_roles.length > 0 &&
            row.evidence_reference_public_ids.length > 0 &&
            row.assessment_profile_created_at.length > 0 &&
            row.source_agent_call_public_id.length > 0
        ),
        "Profile transition exports must preserve the assessment-to-conversation provenance chain."
      );
      assert.equal(
        transitionRows[0].prior_understanding_category,
        initialCanonicalProfile.ability_profile
      );
      assert.equal(
        transitionRows[0].updated_understanding_category,
        largelyImprovedProfile.ability_profile
      );
      assert.equal(
        transitionRows[0].updated_confidence_alignment,
        largelyImprovedProfile.confidence_alignment
      );
      assert.equal(
        transitionRows[0].updated_misconception_indicators,
        "[]"
      );
      const latestTransitionSnapshot =
        FormativeConversationProfileEvidenceSchema.parse(
          JSON.parse(transitionRows[1].canonical_profile_snapshot)
        );
      assert.deepEqual(
        latestTransitionSnapshot.canonical_profile,
        soundProfile
      );
      const formativeSessionRows = parse(
        file("formative_conversation_sessions.csv"),
        {
          columns: true,
          skip_empty_lines: true
        }
      ) as Array<Record<string, string>>;
      const formativeSessionRow = formativeSessionRows.find(
        (row) =>
          row.conversation_public_id ===
          conversation.conversation_public_id
      );
      assert(
        formativeSessionRow,
        "The canonical formative conversation session should be exported."
      );
      assert.equal(
        formativeSessionRow.latest_profile_transition_public_id,
        profileTransitions[1].transition_public_id
      );
      assert.equal(formativeSessionRow.validated_formative_outcome, "sound");
      assert.equal(
        formativeSessionRow.current_learning_profile,
        soundProfile.integrated_diagnostic_profile
      );
      assert.equal(
        formativeSessionRow.current_profile_evidence_sufficiency,
        soundProfile.evidence_sufficiency
      );
      assert.equal(
        teacherDetail.formative_conversations[0].learning_outcome,
        formativeSessionRow.validated_formative_outcome,
        "Teacher and research projections must read the same persisted transition."
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
      assert.equal(
        sessionRow.formative_activity_attempt_count,
        "0",
        "Historical activity-era records must not inflate the current formative-conversation activity count."
      );
      const formativeTurnRows = parse(
        file("formative_conversation_turns.csv"),
        {
          columns: true,
          skip_empty_lines: true
        }
      ) as Array<Record<string, string>>;
      const formativeEventRows = parse(
        file("formative_conversation_events.csv"),
        {
          columns: true,
          skip_empty_lines: true
        }
      ) as Array<Record<string, string>>;
      const formativeLlmRows = parse(
        file("formative_conversation_llm_calls.csv"),
        {
          columns: true,
          skip_empty_lines: true
        }
      ) as Array<Record<string, string>>;
      assert.deepEqual(
        formativeTurnRows.map((row) =>
          Number(row.conversation_local_turn_sequence_index)
        ),
        formativeTurnRows.map((_, index) => index + 1)
      );
      assert.deepEqual(
        formativeEventRows.map((row) =>
          Number(row.conversation_local_event_sequence_index)
        ),
        formativeEventRows.map((_, index) => index + 1)
      );
      assert(
        formativeTurnRows.some(
          (row) =>
            row.paste_event_count === "1" &&
            row.paste_character_count === "18"
        ),
        "Formative turn export must preserve paste event and character counts without pasted text."
      );
      const exportedAgentCallIds = new Set(
        formativeLlmRows.map((row) => row.agent_call_public_id)
      );
      assert(
        formativeTurnRows
          .filter((row) => row.actor_type === "agent")
          .every((row) =>
            exportedAgentCallIds.has(row.agent_call_public_id)
          ),
        "Every tutor turn must join to the formative LLM-call export through a safe public AgentCall key."
      );
      assert(
        transitionRows.every((row) =>
          exportedAgentCallIds.has(
            row.source_agent_call_public_id
          )
        ),
        "Every profile transition must join to its formative LLM call through the same public key."
      );
      const recoveredStudentRow = formativeTurnRows.find(
        (row) =>
          row.actor_type === "student" &&
          row.message_text === failedMessage
      );
      assert(recoveredStudentRow);
      assert.equal(
        recoveredStudentRow.response_receipt_public_id,
        failedReceipt.receipt_public_id
      );
      assert.equal(
        recoveredStudentRow.assistant_response_status,
        "completed"
      );
      assert.equal(
        recoveredStudentRow.assistant_response_retry_count,
        "1"
      );
      assert.equal(
        recoveredStudentRow.assistant_response_failure_category,
        "agent_execution_failure"
      );
      const failedLlmRow = formativeLlmRows.find(
        (row) =>
          row.agent_call_public_id ===
          failedReceipt.agent_calls[0].agent_call_public_id
      );
      assert(failedLlmRow);
      assert.equal(failedLlmRow.call_status, "failed");
      assert.equal(
        failedLlmRow.response_receipt_public_id,
        failedReceipt.receipt_public_id
      );
      const failedEventRow = formativeEventRows.find(
        (row) =>
          row.event_type === "agent_call_failed" &&
          row.agent_call_public_id ===
            failedReceipt.agent_calls[0].agent_call_public_id
      );
      assert(failedEventRow);
      assert.equal(
        failedEventRow.failure_category,
        "agent_execution_failure"
      );
      assert.equal(
        formativeTurnRows.filter(
          (row) => row.actor_type === "agent"
        ).length,
        formativeLlmRows.filter(
          (row) => row.call_status === "succeeded"
        ).length,
        "Failed generations must remain in the call/event audit without being counted as completed tutor turns."
      );
      assert.equal(
        Object.hasOwn(
          transitionRows[0],
          "source_agent_invocation_key"
        ),
        false,
        "Transition exports must not expose internal invocation keys."
      );
      const agentActivityRows = parse(
        file("agent_activity_records.csv"),
        {
          columns: true,
          skip_empty_lines: true
        }
      ) as Array<Record<string, string>>;
      const legacyFollowupRows = agentActivityRows.filter(
        (row) => row.record_type === "legacy_followup_round"
      );
      assert.equal(legacyFollowupRows.length, 1);
      assert.equal(
        legacyFollowupRows[0].authority_status,
        "legacy_non_authoritative"
      );
      assert.equal(
        agentActivityRows.some(
          (row) =>
            row.record_type === "activity_attempt" &&
            row.activity_type === "followup_round"
        ),
        false,
        "FollowupRound records must not be emitted as active activity attempts."
      );
      assert.equal(
        exportResult.row_counts[
          "formative_conversation_turns.csv"
        ],
        formativeTurnRows.length,
        "Multiline tutor text must not inflate serialized CSV row counts."
      );
      const exportedText = exportResult.files
        .filter((entry) => entry.path.startsWith("formative_conversation_"))
        .map((entry) => entry.data)
        .join("\n");
      assert(!exportedText.includes("Teacher-only distractor rationale."));
      assert(!exportedText.includes("password_hash"));
      assert(!exportedText.includes("input_payload"));
      assert(!exportedText.includes("raw_output"));
      assert(!exportedText.includes("system_prompt"));
      assert(!exportedText.includes("chain_of_thought"));
      assert(!exportedText.includes("provider_request_id"));
      assert(!exportedText.includes("client_request_id"));
      assert(!exportedText.includes("agent_invocation_key"));
      assert(!exportedText.includes("agent_call_db_id"));
      assert(!exportedText.includes("source_agent_call_db_id"));
      const internalAgentCallIds = await prisma.agentCall.findMany({
        where: {
          formative_conversation_session_db_id: conversation.id
        },
        select: {
          id: true
        }
      });
      assert(
        internalAgentCallIds.every(
          (call) => !exportedText.includes(call.id)
        ),
        "Formative exports must not expose internal AgentCall database IDs."
      );
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
            "opening_write_gate_before_assistant_persistence",
            "typed_configuration_failure_and_retry_state",
            "configuration_failure_before_agent_call",
            "assistant_first_opening_and_opening_language_validation",
            "idempotent_opening_refresh_resume",
            "student_and_tutor_message_persistence",
            "observable_event_ordering",
            "agent_call_binding",
            "validated_agent_result_resume",
            "idempotent_duplicate_message",
            "failed_agent_call_response_lifecycle",
            "idempotent_failed_response_retry",
            "no_orphan_completed_exchange",
            "safe_terminal_failure_telemetry",
            "teacher_incomplete_generation_rendering",
            "failed_generation_export_integrity",
            "append_only_agent_owned_profile_evolution",
            "complete_canonical_profile_field_updates",
            "stale_misconception_removal",
            "evidence_backed_field_retention",
            "structured_assessment_evidence_retention",
            "continue_conversation_evidence_without_transition",
            "no_heuristic_formative_outcome",
            "profile_transition_turn_call_and_assessment_provenance",
            "student_conversation_projection_and_privacy_isolation",
            "student_pause_and_resume_lifecycle",
            "conversation_leave_pause_end_attempt_lifecycle_distinction",
            "profile_outcome_does_not_end_conversation",
            "teacher_research_access_and_privacy_separation",
            "teacher_formative_trajectory_review",
            "teacher_profile_timeline_rendering",
            "teacher_and_export_transition_consistency",
            "phase_separated_research_export_and_dictionary",
            "assessment_formative_outcome_export_integrity",
            "safe_public_agent_call_export_joins",
            "conversation_local_turn_and_event_ordering",
            "paste_character_count_without_pasted_text",
            "legacy_non_authoritative_activity_classification",
            "multiline_csv_record_count_integrity",
            "new_export_fields_documented_in_emitted_dictionaries",
            "markdown_source_preserved_in_research_export",
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
