import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { executeAgent } from "../src/lib/agents/execute-agent";
import { compileProductionStructuredAgentRequest } from "../src/lib/agents/provider-request";
import { prisma } from "../src/lib/db";
import {
  cleanupSyntheticStudentValidationRun,
  runFormativeConversationProtocolValidation,
  SYNTHETIC_ASSESSMENT_ITEMS,
  type FormativeConversationValidationAssessmentDefinition,
  type FormativeConversationValidationSubject
} from "../src/lib/evaluation/synthetic-student-validation/framework";
import { syntheticStudentPersonas } from "../src/lib/evaluation/synthetic-student-validation/personas";
import type {
  StructuredAgentRequest,
  StructuredAgentResult
} from "../src/lib/llm/providers/types";
import { FORMATIVE_CONVERSATION_AGENT_NAME } from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
  type FormativeConversationV18R2AgentOutput
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { validateFormativeConversationV18R2CandidateAcceptance } from "../src/lib/services/student-assessment/formative-conversation/candidate-validation-v18r2";
import {
  createSingleAttemptFormativeConversationV18R2Execution,
  executeFormativeConversationV18R2
} from "../src/lib/services/student-assessment/formative-conversation/execution-v18r2";
import { buildFormativeConversationV18R2ProductionRequest } from "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2";
import {
  FormativeConversationFoundationError,
  FORMATIVE_CONVERSATION_LIFECYCLE_HANDOFF_MESSAGE
} from "../src/lib/services/student-assessment/formative-conversation/service";
import {
  processFormativeConversationStudentMessage,
  type FormativeConversationV18R2AgentRunner
} from "../src/lib/services/student-assessment/formative-conversation/runtime";
import { buildFormativeConversationRuntimeContextSeed } from "../src/lib/services/student-assessment/formative-conversation/runtime-context";
import { buildAnalysisReadyResearchDataBundle } from "../src/lib/services/teacher-research-data/analysis-ready-export";
import { getTeacherReviewSessionDetail } from "../src/lib/services/teacher-review/session-detail";
import {
  v18r2TestContinueOutput,
  v18r2TestTerminalOutput
} from "./formative-conversation-v18r2-test-fixtures";

const runPublicId = `fcv18r2_lifecycle_${Date.now()}`;

function assessmentDefinition(): FormativeConversationValidationAssessmentDefinition {
  return {
    title: "V18R2 lifecycle persistence",
    description: "No-provider bounded formative lifecycle persistence test.",
    diagnostic_focus:
      "Distinguish reliability, validity evidence, and score uncertainty.",
    concept_title: "Measurement evidence and score interpretation",
    learning_objective:
      "Explain why reliability and standard error do not establish validity or an exact true score.",
    related_concept_description:
      "Measurement-theory distinctions used in score interpretation.",
    assessment_boundary:
      "Only the administered measurement-theory evidence is in scope.",
    administered_items: SYNTHETIC_ASSESSMENT_ITEMS.map((item, index) => ({
      item_alias: `measurement_${index + 1}`,
      item_order: item.item_order,
      item_stem: item.item_stem,
      options: item.options.map((option) => ({
        label: option.label,
        text: option.text
      })),
      correct_option: item.correct_option,
      answer_explanation: item.explanation,
      distractor_rationales: { ...item.distractor_rationales },
      expected_reasoning_patterns: [...item.expected_reasoning_patterns],
      item_version: 1
    }))
  };
}

function turn(messageText: string, index: number) {
  return {
    intent: "reflection" as const,
    message_text: messageText,
    response_time_ms: 10_000 + index * 500,
    typing_duration_ms: 6_000 + index * 250,
    edit_count: 1,
    backspace_count: 1,
    paste_event_count: 0,
    paste_character_count: 0
  };
}

const compoundAssessmentEvidence: FormativeConversationValidationSubject["assessment_response_behavior"] = [
  {
    item_number: 1,
    selected_option: "B",
    prior_option_selections: [],
    tempting_option: "B",
    tempting_option_reason: "Consistency seems sufficient for validity.",
    reasoning_text:
      "High reliability proves the interpretation is valid for the intended use.",
    confidence_rating: "high",
    response_time_ms: 35_000,
    time_to_first_action_ms: 5_000,
    reasoning_revision_count: 0,
    navigation_observations: []
  },
  {
    item_number: 2,
    selected_option: "B",
    prior_option_selections: [],
    tempting_option: "B",
    tempting_option_reason: "The adjustment seems exact.",
    reasoning_text: "SEM gives the exact true score.",
    confidence_rating: "high",
    response_time_ms: 36_000,
    time_to_first_action_ms: 5_500,
    reasoning_revision_count: 0,
    navigation_observations: []
  },
  {
    item_number: 3,
    selected_option: "A",
    prior_option_selections: [],
    tempting_option: null,
    tempting_option_reason: null,
    reasoning_text:
      "Validity evidence must support the intended interpretation and use.",
    confidence_rating: "medium",
    response_time_ms: 31_000,
    time_to_first_action_ms: 4_500,
    reasoning_revision_count: 0,
    navigation_observations: []
  }
];

function lifecycleSubjects(): FormativeConversationValidationSubject[] {
  const [persistent] = syntheticStudentPersonas(["persistent_non_improvement"]);
  const [improving] = syntheticStudentPersonas(["sudden_improvement"]);
  assert(persistent && improving);
  return [
    {
      subject_id: persistent.persona_id,
      display_name: "Synthetic V18R2 lifecycle fail-safe student",
      assessment_response_behavior: structuredClone(
        compoundAssessmentEvidence
      ),
      conversation_behavior: Array.from({ length: 12 }, (_, index) =>
        turn(
          index === 11
            ? "Even after all these explanations, I still cannot separate consistency, validity evidence, and score uncertainty."
            : `I am still uncertain after formative explanation ${index + 1}; can we keep working through the distinction?`,
          index
        )
      )
    },
    {
      subject_id: improving.persona_id,
      display_name: "Synthetic V18R2 concurrent final-turn student",
      assessment_response_behavior: structuredClone(
        compoundAssessmentEvidence
      ),
      conversation_behavior: Array.from({ length: 11 }, (_, index) =>
        turn(
          `I am continuing to compare reliability, validity, and SEM in formative turn ${index + 1}.`,
          index
        )
      )
    }
  ];
}

function openingOutput(): FormativeConversationV18R2AgentOutput {
  return {
    contract_version: FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
    outcome: "continue_conversation",
    student_visible_message:
      "You noticed some important measurement ideas in your responses. We can work through the distinctions together; where would you like to begin?",
    teaching_artifact: null,
    evidence_observations: [],
    profile_transition_recommendation: null,
    teacher_assistance_recommendation: {
      recommended: false,
      reason_code: null
    },
    lifecycle_recommendation: "continue"
  };
}

function completedResult(input: {
  request: StructuredAgentRequest<unknown, FormativeConversationV18R2AgentOutput>;
  output: FormativeConversationV18R2AgentOutput;
  sequence: number;
}) {
  const result: StructuredAgentResult<FormativeConversationV18R2AgentOutput> = {
    provider: "mock",
    client_request_id: input.request.client_request_id,
    status: "completed",
    parsed_output: input.output,
    raw_output: {
      status: "completed",
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify(input.output)
            }
          ]
        }
      ]
    },
    usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    latency_ms: 5
  };
  return createSingleAttemptFormativeConversationV18R2Execution({
    logical_call_id: `v18r2-lifecycle-semantic-${input.sequence}`,
    request: input.request,
    result
  });
}

function createRunner() {
  let invocations = 0;
  let logicalGenerationCalls = 0;
  const runner: FormativeConversationV18R2AgentRunner = {
    identity: {
      agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
      agent_version: "formative-conversation-v18r2-lifecycle-smoke-v1",
      model_name: "no-provider-v18r2-lifecycle-fixture",
      provider: "mock",
      prompt_version: "formative-conversation-host-v7.1",
      schema_version: FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
      prompt_hash: createHash("sha256")
        .update("formative-conversation-host-v7.1")
        .digest("hex"),
      reasoning_effort: null,
      max_output_tokens: 7_000,
      live_call_allowed: false
    },
    async execute({ context }) {
      invocations += 1;
      const startedAt = new Date();
      if (
        context.formative_lifecycle.final_allowed_turn &&
        /Even after all these explanations/iu.test(
          context.latest_student_message ?? ""
        )
      ) {
        const request = buildFormativeConversationV18R2ProductionRequest({
          context,
          model_config: {
            model_name: "no-provider-v18r2-lifecycle-fixture",
            reasoning_effort: "medium",
            max_output_tokens: 7_000
          },
          client_request_id: `v18r2-lifecycle-final-${context.conversation_public_id}`,
          timeout_ms: 60_000,
          invocation_key: `v18r2-lifecycle-final-${context.conversation_public_id}`
        });
        compileProductionStructuredAgentRequest(request);
        const invalidContinue = v18r2TestContinueOutput({ context });
        return executeFormativeConversationV18R2({
          base_request: request,
          validate_candidate(output) {
            const validation =
              validateFormativeConversationV18R2CandidateAcceptance({
                context,
                candidate: output
              });
            return {
              valid: validation.valid,
              validation_status: validation.validation_status,
              validation_issue_paths: validation.validation_issue_paths
            };
          },
          execute_logical_generation({ sequence, request: attemptedRequest }) {
            logicalGenerationCalls += 1;
            return Promise.resolve(
              completedResult({
                request: attemptedRequest,
                output: invalidContinue,
                sequence
              })
            );
          }
        }).then(() => {
          throw new Error("v18r2_final_turn_invalid_candidate_unexpectedly_accepted");
        });
      }

      const output =
        context.formative_lifecycle.student_turn_index === 0
          ? openingOutput()
          : context.formative_lifecycle.final_allowed_turn
            ? v18r2TestTerminalOutput({
                context,
                outcome: "sound_understanding"
              })
            : v18r2TestContinueOutput({ context });
      return {
        output,
        raw_output: { fixture_type: "v18r2_no_provider_lifecycle" },
        generation_source: "deterministic_test",
        provider_request_id: null,
        provider_response_id: null,
        client_request_id: null,
        retry_count: 0,
        latency_ms: 5,
        input_tokens: 10,
        output_tokens: 10,
        total_tokens: 20,
        estimated_cost: 0,
        started_at: startedAt,
        completed_at: new Date(startedAt.getTime() + 5)
      };
    }
  };
  return {
    runner,
    invocations: () => invocations,
    logicalGenerationCalls: () => logicalGenerationCalls
  };
}

async function conversationRecord(conversationPublicId: string) {
  return prisma.formativeConversationSession.findUniqueOrThrow({
    where: { conversation_public_id: conversationPublicId },
    include: {
      assessment_session: {
        include: { assessment: { select: { created_by_user_db_id: true } } }
      },
      conversation_turns: {
        orderBy: { sequence_index: "asc" },
        include: {
          formative_conversation_turn_telemetry: {
            include: {
              agent_call: {
                select: { agent_call_public_id: true }
              }
            }
          }
        }
      },
      message_receipts: true,
      agent_calls: {
        orderBy: { created_at: "asc" },
        include: {
          formative_conversation_turn_telemetry: {
            select: {
              conversation_turn_db_id: true,
              conversation_local_turn_sequence_index: true
            }
          }
        }
      },
      profile_transitions: true,
      lifecycle_events: { orderBy: { conversation_local_event_sequence_index: "asc" } },
      review_signals: true
    }
  });
}

async function main() {
  const originalFetch = globalThis.fetch;
  const priorResearchKey = process.env.RESEARCH_PSEUDONYMIZATION_KEY;
  const priorResearchVersion = process.env.RESEARCH_PSEUDONYMIZATION_VERSION;
  let networkRequests = 0;
  globalThis.fetch = (async () => {
    networkRequests += 1;
    throw new Error("network_forbidden_in_v18r2_lifecycle_smoke");
  }) as typeof fetch;
  process.env.RESEARCH_PSEUDONYMIZATION_KEY =
    "formative-conversation-v18r2-lifecycle-smoke-key";
  process.env.RESEARCH_PSEUDONYMIZATION_VERSION = "hmac_sha256_v1";
  const runner = createRunner();

  try {
    const subjects = lifecycleSubjects();
    const result = await runFormativeConversationProtocolValidation({
      mode: "contract_test",
      subjects,
      assessment_definition: assessmentDefinition(),
      runner_factory: () => runner.runner,
      run_public_id: runPublicId,
      include_production_profiling: true,
      frozen_initial_profiles: {},
      profiling_mock_provider_mode: "student_profiling_compound_misconception",
      profiling_no_provider_test_executor: (input) =>
        executeAgent({
          agent_name: input.agentName,
          input: input.allowlistedInput,
          assessment_session_db_id:
            input.operationalContext.assessment_session_db_id,
          concept_unit_session_db_id:
            input.operationalContext.concept_unit_session_db_id,
          followup_round_db_id:
            input.operationalContext.followup_round_db_id,
          agent_invocation_key: input.invocationKey,
          force_new_invocation: input.forceNewInvocation,
          metadata: {
            operational_agent_mode: "v18r2_no_provider_test",
            ...(input.metadata ?? {})
          },
          model_config_override: {
            model_name: "v18r2-no-provider-structured-request"
          }
        })
    });
    const initialExportValidation = result.report.export_validation;
    const failSafeStudent = result.report.students.find(
      (student) => student.persona_id === "persistent_non_improvement"
    );
    const concurrentStudent = result.report.students.find(
      (student) => student.persona_id === "sudden_improvement"
    );
    assert(failSafeStudent?.conversation_public_id);
    assert(concurrentStudent?.conversation_public_id);
    const failSafeConversationPublicId = failSafeStudent.conversation_public_id;
    const concurrentConversationPublicId =
      concurrentStudent.conversation_public_id;
    const failedConversation = await conversationRecord(
      failSafeConversationPublicId
    );
    assert.equal(failedConversation.status, "ended");
    assert.match(
      failedConversation.lifecycle_reason ?? "",
      /^platform_student_turn_limit_terminal_recommendation_unavailable$/u
    );
    assert.equal(
      failedConversation.conversation_turns.filter(
        (entry) => entry.actor_type === "student"
      ).length,
      12
    );
    assert.equal(
      failedConversation.profile_transitions.length,
      0,
      "platform handoff must not create a profile transition"
    );
    assert.equal(
      failedConversation.review_signals.filter(
        (signal) => signal.signal_type === "platform_lifecycle_handoff"
      ).length,
      1
    );
    const handoffTurn = failedConversation.conversation_turns.find(
      (entry) => entry.agent_name === "platform_lifecycle"
    );
    assert.equal(
      handoffTurn?.message_text,
      FORMATIVE_CONVERSATION_LIFECYCLE_HANDOFF_MESSAGE
    );
    const missingTurnTelemetry = failedConversation.conversation_turns
      .filter((entry) => !entry.formative_conversation_turn_telemetry)
      .map((entry) => ({
        sequence_index: entry.sequence_index,
        actor_type: entry.actor_type,
        agent_name: entry.agent_name
      }));
    assert.deepEqual(
      missingTurnTelemetry,
      [],
      JSON.stringify({
        telemetry_turn_sequence_counter:
          failedConversation.telemetry_turn_sequence_counter,
        persisted_turn_telemetry_count:
          failedConversation.conversation_turns.length -
          missingTurnTelemetry.length,
        agent_call_telemetry: failedConversation.agent_calls.map((call) => ({
          agent_call_public_id: call.agent_call_public_id,
          call_status: call.call_status,
          telemetry: call.formative_conversation_turn_telemetry
        }))
      })
    );
    assert.deepEqual(
      failedConversation.conversation_turns
        .map(
          (entry) =>
            entry.formative_conversation_turn_telemetry
              ?.conversation_local_turn_sequence_index
        )
        .sort((left, right) => (left ?? 0) - (right ?? 0)),
      Array.from(
        { length: failedConversation.conversation_turns.length },
        (_, index) => index + 1
      )
    );
    assert(
      handoffTurn?.formative_conversation_turn_telemetry?.agent_call
        ?.agent_call_public_id
    );
    assert.equal(
      failSafeStudent.execution_error,
      null,
      JSON.stringify(failSafeStudent)
    );
    assert.equal(
      concurrentStudent.execution_error,
      null,
      JSON.stringify(concurrentStudent)
    );
    const failedFinalCall = failedConversation.agent_calls.at(-1);
    assert.equal(failedFinalCall?.call_status, "invalid_output");
    assert.equal(failedFinalCall?.error_category, "semantic_regeneration_exhausted");
    const failedAudit = failedFinalCall?.raw_output as {
      provider_execution_audit?: {
        semantic_regeneration_calls?: number;
        attempts?: unknown[];
      };
    } | null;
    assert.equal(
      failedAudit?.provider_execution_audit?.semantic_regeneration_calls,
      1
    );
    assert.equal(
      failedAudit?.provider_execution_audit?.attempts?.length,
      2
    );
    assert.equal(runner.logicalGenerationCalls(), 2);

    const failedTurnsBeforeReplay = failedConversation.conversation_turns.length;
    const failedInvocationsBeforeReplay = runner.invocations();
    const failedSeed = await buildFormativeConversationRuntimeContextSeed({
      conversation_public_id: failSafeConversationPublicId,
      student_user_db_id: failedConversation.assessment_session.user_db_id
    });
    const failSafeFinalMessage = subjects[0]!.conversation_behavior.at(-1)!;
    await processFormativeConversationStudentMessage(
      {
        conversation_public_id: failSafeConversationPublicId,
        client_message_id: `${runPublicId}:persistent_non_improvement:message:12`,
        message_text: failSafeFinalMessage.message_text,
        context: failedSeed
      },
      { runner: runner.runner }
    );
    assert.equal(runner.invocations(), failedInvocationsBeforeReplay);
    assert.equal(
      (
        await conversationRecord(failSafeConversationPublicId)
      ).conversation_turns.length,
      failedTurnsBeforeReplay
    );
    await assert.rejects(
      processFormativeConversationStudentMessage(
        {
          conversation_public_id: failSafeConversationPublicId,
          client_message_id: `${runPublicId}:persistent_non_improvement:message:13`,
          message_text: "This distinct message must not become turn 13.",
          context: failedSeed
        },
        { runner: runner.runner }
      ),
      (error) =>
        error instanceof FormativeConversationFoundationError &&
        (error.code === "conversation_not_active" ||
          error.code === "conversation_turn_limit_reached")
    );

    const beforeConcurrent = await conversationRecord(
      concurrentConversationPublicId
    );
    assert.equal(beforeConcurrent.status, "active");
    assert.equal(
      beforeConcurrent.conversation_turns.filter(
        (entry) => entry.actor_type === "student"
      ).length,
      11
    );
    assert.equal(
      beforeConcurrent.profile_transitions.length,
      0,
      "the 11-turn conversation must remain nonterminal"
    );
    const staleSeed = await buildFormativeConversationRuntimeContextSeed({
      conversation_public_id: concurrentConversationPublicId,
      student_user_db_id: beforeConcurrent.assessment_session.user_db_id
    });
    const finalMessages = [
      {
        id: `${runPublicId}:sudden_improvement:concurrent:a`,
        text: "Reliability is consistency; validity requires separate evidence for the intended use, and SEM represents uncertainty rather than an exact score."
      },
      {
        id: `${runPublicId}:sudden_improvement:concurrent:b`,
        text: "A reliable score can still lack validity evidence for its use, and SEM describes uncertainty instead of identifying an exact true score."
      }
    ];
    const concurrentResults = await Promise.allSettled(
      finalMessages.map((message) =>
        processFormativeConversationStudentMessage(
          {
            conversation_public_id: concurrentConversationPublicId,
            client_message_id: message.id,
            message_text: message.text,
            context: staleSeed
          },
          { runner: runner.runner }
        )
      )
    );
    assert.equal(
      concurrentResults.filter((entry) => entry.status === "fulfilled").length,
      1
    );
    assert.equal(
      concurrentResults.filter((entry) => entry.status === "rejected").length,
      1
    );
    const winnerIndex = concurrentResults.findIndex(
      (entry) => entry.status === "fulfilled"
    );
    assert(winnerIndex >= 0);
    const winner = finalMessages[winnerIndex]!;
    const afterConcurrent = await conversationRecord(
      concurrentConversationPublicId
    );
    assert.equal(afterConcurrent.status, "ended");
    assert.match(
      afterConcurrent.lifecycle_reason ?? "",
      /^llm_terminal_recommendation:/u
    );
    assert.equal(
      afterConcurrent.conversation_turns.filter(
        (entry) => entry.actor_type === "student"
      ).length,
      12
    );
    assert.equal(afterConcurrent.profile_transitions.length, 1);
    assert.equal(
      afterConcurrent.review_signals.filter(
        (signal) => signal.signal_type === "platform_lifecycle_handoff"
      ).length,
      0,
      "an accepted LLM terminal recommendation must not create a platform handoff signal"
    );
    assert.equal(
      afterConcurrent.review_signals.filter(
        (signal) => signal.signal_type === "profile_transition_recommendation"
      ).length,
      1
    );
    const successfulInvocationsBeforeReplay = runner.invocations();
    const winnerReplay = await processFormativeConversationStudentMessage(
      {
        conversation_public_id: concurrentConversationPublicId,
        client_message_id: winner.id,
        message_text: winner.text,
        context: staleSeed
      },
      { runner: runner.runner }
    );
    assert.equal(winnerReplay.replayed, true);
    assert.equal(runner.invocations(), successfulInvocationsBeforeReplay);
    assert.equal(
      await prisma.formativeConversationProfileTransition.count({
        where: {
          formative_conversation_session_db_id: afterConcurrent.id
        }
      }),
      1
    );

    const failedTeacher = await getTeacherReviewSessionDetail(
      failSafeStudent.session_public_id
    );
    const successfulTeacher = await getTeacherReviewSessionDetail(
      concurrentStudent.session_public_id
    );
    const failedTeacherConversation = failedTeacher.formative_conversations[0];
    const successfulTeacherConversation =
      successfulTeacher.formative_conversations[0];
    assert.equal(
      failedTeacherConversation?.lifecycle_termination_source,
      "platform_lifecycle"
    );
    assert.equal(
      failedTeacherConversation?.semantic_teacher_assistance_recommended,
      false
    );
    assert(failedTeacherConversation?.platform_lifecycle_handoff);
    assert.equal(failedTeacherConversation?.learning_outcome, null);
    assert.equal(
      successfulTeacherConversation?.lifecycle_termination_source,
      "llm_terminal_recommendation"
    );
    assert.equal(successfulTeacherConversation?.profile_evolution.length, 1);
    assert.equal(successfulTeacherConversation?.platform_lifecycle_handoff, null);

    const assessment = await prisma.assessment.findUniqueOrThrow({
      where: { id: failedConversation.assessment_session.assessment_db_id },
      select: { assessment_public_id: true }
    });
    const research = await buildAnalysisReadyResearchDataBundle({
      teacher_user_db_id:
        failedConversation.assessment_session.assessment.created_by_user_db_id,
      scope: "selected_assessment",
      assessment_public_id: assessment.assessment_public_id,
      include_incomplete_sessions: true
    });
    const sessionsCsv = research.files.find(
      (entry) => entry.path === "formative_conversation_sessions.csv"
    )?.data;
    assert(sessionsCsv);
    assert.match(sessionsCsv, /platform_lifecycle/u);
    assert.match(sessionsCsv, /llm_terminal_recommendation/u);
    assert.match(sessionsCsv, /student_formative_turn_count/u);
    assert.match(sessionsCsv, /semantic_teacher_assistance_recommended/u);
    assert.equal(
      initialExportValidation.status,
      "passed",
      JSON.stringify(initialExportValidation)
    );
    assert.equal(
      await prisma.activityRuntimeAttempt.count({
        where: {
          session_public_id: {
            in: [
              failSafeStudent.session_public_id,
              concurrentStudent.session_public_id
            ]
          }
        }
      }),
      0
    );
    assert.equal(
      await prisma.topicDialogue.count({
        where: {
          assessment_session_db_id: {
            in: [
              failedConversation.assessment_session_db_id,
              afterConcurrent.assessment_session_db_id
            ]
          }
        }
      }),
      0
    );
    assert.equal(networkRequests, 0, "the lifecycle smoke must not use the network");

    console.log(
      JSON.stringify(
        {
          status: "passed",
          assessment_messages_counted_as_formative_turns: 0,
          assistant_opening_counted_as_formative_turns: 0,
          final_allowed_turn_index: 12,
          final_turn_semantic_regenerations: 1,
          final_turn_invalid_candidates_preserved: 2,
          platform_lifecycle_handoff_persisted: true,
          platform_handoff_profile_transitions: 0,
          platform_handoff_semantic_teacher_assistance: false,
          thirteenth_distinct_turn_rejected: true,
          exact_replay_after_closure_increment: 0,
          concurrent_turn_12_accepted: 1,
          concurrent_turn_13_accepted: 0,
          terminal_transition_count: 1,
          duplicate_transition_count: 0,
          teacher_export_lifecycle_source_parity: true,
          research_export_lifecycle_source_parity: true,
          activity_runtime_contamination: 0,
          topic_dialogue_contamination: 0,
          provider_calls: 0,
          model_auth_requests: 0,
          generation_network_requests: networkRequests,
          dispatch_checkpoints: 0
        },
        null,
        2
      )
    );
  } finally {
    await cleanupSyntheticStudentValidationRun(runPublicId);
    globalThis.fetch = originalFetch;
    if (priorResearchKey === undefined) {
      delete process.env.RESEARCH_PSEUDONYMIZATION_KEY;
    } else {
      process.env.RESEARCH_PSEUDONYMIZATION_KEY = priorResearchKey;
    }
    if (priorResearchVersion === undefined) {
      delete process.env.RESEARCH_PSEUDONYMIZATION_VERSION;
    } else {
      process.env.RESEARCH_PSEUDONYMIZATION_VERSION = priorResearchVersion;
    }
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code:
        error instanceof Error
          ? error.message
          : "formative_conversation_v18r2_lifecycle_smoke_failed",
      provider_calls: 0,
      model_auth_requests: 0,
      dispatch_checkpoints: 0
    })
  );
  process.exitCode = 1;
});
