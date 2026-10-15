import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { executeAgent } from "../src/lib/agents/execute-agent";
import { compileProductionStructuredAgentRequest } from "../src/lib/agents/provider-request";
import { prisma } from "../src/lib/db";
import { FORMATIVE_CONVERSATION_CURRENT_MAX_STUDENT_TURNS as turnLimit } from "../src/lib/services/student-assessment/formative-conversation/lifecycle-contract-v18r2";
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
  FormativeConversationV18R2ExecutionAuditSchema,
  executeFormativeConversationV18R2
} from "../src/lib/services/student-assessment/formative-conversation/execution-v18r2";
import { buildFormativeConversationV18R2ProductionRequest } from "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2";
import { compilePersistedFormativeConversationV18R2Context } from "../src/lib/services/student-assessment/formative-conversation/context-v18r2";
import { type ConversationReview, CONVERSATION_DELIVERY_REVIEW_VERSION, buildConversationDeliveryDraftBlocks } from "../src/lib/services/student-assessment/formative-conversation/conversation-continuity";
import { prepareFormativeInterpretationResult, validateFormativeInterpretation } from "../src/lib/services/student-assessment/formative-conversation/interpretation-policy";
import { FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION, prepareConversationPlanResult, prepareFormativeProfileProposalResult } from "../src/lib/services/student-assessment/formative-conversation/profile-update-proposal";
import {
  FormativeConversationFoundationError,
  FORMATIVE_CONVERSATION_LIFECYCLE_HANDOFF_MESSAGE
} from "../src/lib/services/student-assessment/formative-conversation/service";
import {
  processFormativeConversationStudentMessage,
  type FormativeConversationV18R2AgentRunner
} from "../src/lib/services/student-assessment/formative-conversation/runtime";
import { buildFormativeConversationRuntimeContextSeed } from "../src/lib/services/student-assessment/formative-conversation/runtime-context";
import { canFinishConversationAssessment, finishConversationAssessment } from "../src/lib/services/student-assessment/formative-conversation/finish-assessment";
import { buildAnalysisReadyResearchDataBundle } from "../src/lib/services/teacher-research-data/analysis-ready-export";
import { getTeacherReviewSessionDetail } from "../src/lib/services/teacher-review/session-detail";
import {
  v18r2TestContinueOutput,
  v18r2TestTerminalOutput
} from "./formative-conversation-v18r2-test-fixtures";

const runPublicId = `fcv18r2_lifecycle_${Date.now()}`;
const prospectiveRunPublicId = `${runPublicId}_prospective`;

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
      conversation_behavior: Array.from({ length: turnLimit }, (_, index) =>
        turn(
          index === turnLimit - 1
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
      conversation_behavior: Array.from({ length: turnLimit - 1 }, (_, index) =>
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
  request: StructuredAgentRequest<unknown, unknown>;
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
          async execute_delivery_review() {
            throw new Error("Invalid terminal fixture must be rejected before delivery review");
          },
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

function createProspectiveRunner() {
  const base = createRunner();
  let invocations = 0;
  let reloadedContinuityChecks = 0;
  const runner: FormativeConversationV18R2AgentRunner = {
    identity: { ...base.runner.identity,
      agent_version: "formative-conversation-prospective-lifecycle-smoke-v1",
      schema_version: FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION },
    async execute({ context, invocation_key }) {
      invocations++;
      const index = context.formative_lifecycle.student_turn_index;
      const final = context.formative_lifecycle.final_allowed_turn;
      const message = index === 0 ? openingOutput().student_visible_message : final
        ? "We have reached the conversation length limit. Validity evidence still needs clarification, and SEM remains deferred as you requested. Your submitted responses are saved; this does not establish mastery."
        : "Validity evidence supports a particular interpretation and use. Consistency by itself does not establish that support.";
      const sourceEntry = context.allowed_evidence_catalog.evidence.find(entry =>
        entry.evidence_kind === "formative_student_turn" && entry.source_sequence_index ===
        context.visible_transcript.filter(turn => turn.actor === "student").at(-1)?.sequence_index);
      const source = sourceEntry ? { evidence_id: sourceEntry.evidence_id, quote: sourceEntry.content } : null;
      if (index > 1) {
        const continuity = context.conversation_continuity;
        assert(continuity);
        assert.equal(continuity.preferences.find(item => item.preference_id === "defer_sem")?.status, "active");
        assert.equal(continuity.needs.find(item => item.need_id === "sem_help")?.status, "deferred");
        assert.equal(continuity.needs.find(item => item.need_id === "validity_help")?.status, "open");
        assert(continuity.preferences.every(item => item.source_agent_call_public_id !== "candidate"));
        reloadedContinuityChecks++;
      }
      const review: ConversationReview = {
        version: "conversation-review-v1",
        preference_updates: index === 1 && source ? [
          { preference_id: "defer_sem", kind: "defer_topic", status: "active", description: "Leave SEM for another day", source },
          { preference_id: "brief", kind: "brief_response", status: "active", description: "Keep explanations brief", source }
        ] : [],
        need_updates: index === 1 && source ? [
          { need_id: "sem_help", kind: "support_request", status: "deferred", description: "SEM support deferred at the student's request", source, support: [], deferred_by_preference_id: "defer_sem" },
          { need_id: "validity_help", kind: "confusion", status: "open", description: "Validity evidence remains unclear", source, support: [], deferred_by_preference_id: null }
        ] : [],
        student_state: { understanding: "not_reported", understanding_source: null, readiness: "not_reported", readiness_source: null },
        current_support: index === 0 ? [] : [{ topic: "Validity evidence", kind: final ? "summary" : "explanation",
          quote: message, need_ids: ["validity_help"], preference_ids: ["brief"] }],
        recap_claims: [],
        closure: { reason: final ? "turn_limit" : "continue_support", rationale: final
          ? "The existing maximum is reached while support remains unresolved."
          : "Continue requested conversational support without reopening the deferred topic.",
          unresolved_need_ids: index === 0 ? [] : ["validity_help"], instructor_support: null }
      };
      const wire = {
        pre_reply_plan: { version: "conversation-pre-reply-plan-v2",
          preference_comparisons: index === 1 ? review.preference_updates.map(preference => ({
            preference_id: preference.preference_id, kind: preference.kind, description: preference.description,
            prior: null, current_source: preference.source, decision: "activate", change_basis: "explicit_change"
          })) : index > 1 ? ["defer_sem", "brief"].map(preference_id => ({
            preference_id, decision: "retain"
          })) : [],
          student_state: review.student_state,
          current_focus: { description: "Synthetic current validity support while respecting existing preferences.", source }
        },
        ...openingOutput(), student_visible_message: message,
        lifecycle_recommendation: final ? "complete" as const : "continue" as const,
        post_reply_review: { need_updates: review.need_updates, current_support: review.current_support.map(item => ({
          topic: item.topic, kind: item.kind, need_ids: item.need_ids,
          preference_links: item.preference_ids.map(preference_id => ({ preference_id, relationship: "honored_constraint" as const })),
          source: { kind: "current_reply" as const }
        })),
          recap_claims: review.recap_claims, closure: { reason: review.closure.reason,
            rationale: review.closure.rationale, instructor_support: review.closure.instructor_support } }
      };
      const request = buildFormativeConversationV18R2ProductionRequest({ context, invocation_key,
        model_config: { model_name: "no-provider-v18r2-lifecycle-fixture", reasoning_effort: "medium", max_output_tokens: 7_000 },
        client_request_id: `${invocation_key}:prospective`, timeout_ms: 60_000 });
      compileProductionStructuredAgentRequest(request);
      request.output_schema.parse(wire);
      const execution = await executeFormativeConversationV18R2({ base_request: request,
        validate_candidate(candidate) { return validateFormativeInterpretation({ candidate, context }); },
        async execute_delivery_review({ request: attempted, sequence }) {
          const reviewInput = attempted.input as { draft_message: string };
          return createSingleAttemptFormativeConversationV18R2Execution({ request: attempted,
            logical_call_id: `${invocation_key}:offline-review:${sequence}`, result: {
              provider: "mock", status: "completed", client_request_id: attempted.client_request_id,
              parsed_output: { version: CONVERSATION_DELIVERY_REVIEW_VERSION,
                teaching_block_audit: buildConversationDeliveryDraftBlocks(reviewInput.draft_message).map(block => ({
                  block_id: block.block_id, assessment: final ? "no_teaching_claims" : "supported",
                  check: final ? "This fixed fixture acknowledges the message boundary without a learning claim."
                    : "Consistency alone does not establish validity. This canned fixture tests persistence, not live review accuracy."
                })),
                verdict: "pass", findings: [] },
              raw_output: { fixture_type: "offline_delivery_review" },
              usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, latency_ms: 0 } });
        },
        async execute_logical_generation({ request: attempted, sequence }) {
          const original: StructuredAgentResult<unknown> = { provider: "mock", status: "completed",
            client_request_id: attempted.client_request_id, parsed_output: wire,
            raw_output: { fixture_type: "prospective_wire", output_text: JSON.stringify(wire) },
            usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 }, latency_ms: 5 };
          return createSingleAttemptFormativeConversationV18R2Execution({ request: attempted,
            logical_call_id: `${invocation_key}:${sequence}`, result: prepareFormativeInterpretationResult(
              prepareFormativeProfileProposalResult(prepareConversationPlanResult(original, context), context), context) });
        }
      });
      return { output: execution.result.parsed_output,
        raw_output: { accepted_output: execution.result.raw_output, provider_execution_audit: execution.audit },
        provider_execution_audit: execution.audit, generation_source: "deterministic_test",
        retry_count: 0, latency_ms: execution.latency_ms, input_tokens: execution.input_tokens,
        output_tokens: execution.output_tokens, total_tokens: execution.total_tokens, estimated_cost: 0,
        started_at: execution.started_at, completed_at: execution.completed_at };
    }
  };
  return { runner, invocations: () => invocations, reloadedContinuityChecks: () => reloadedContinuityChecks };
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
  assert.equal(turnLimit, 30, "Current classroom limit must be 30 student turns");
  assert(process.env.NODE_ENV === "test" && process.env.LLM_PROVIDER === "mock" &&
    process.env.LLM_LIVE_CALLS_ENABLED === "false" && !process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY_FILE,
    "lifecycle_smoke_requires_explicit_no_provider_test_environment");
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
    assert.equal(failedConversation.status, "ended", JSON.stringify({ execution_error: failSafeStudent.execution_error,
      failed_calls: failedConversation.agent_calls.filter(call => call.call_status !== "succeeded").map(call => ({
        status: call.call_status, error_category: call.error_category
      })) }));
    assert.match(
      failedConversation.lifecycle_reason ?? "",
      /^platform_student_turn_limit_terminal_recommendation_unavailable$/u
    );
    assert.equal(
      failedConversation.conversation_turns.filter(
        (entry) => entry.actor_type === "student"
      ).length,
      turnLimit
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
        client_message_id: `${runPublicId}:persistent_non_improvement:message:${turnLimit}`,
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
          client_message_id: `${runPublicId}:persistent_non_improvement:message:${turnLimit + 1}`,
          message_text: "This distinct message must not exceed the turn limit.",
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
      turnLimit - 1
    );
    assert.equal(
      beforeConcurrent.profile_transitions.length,
      0,
      "the conversation before the final allowed turn must remain nonterminal"
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
    assert.equal(
      afterConcurrent.lifecycle_reason ?? "",
      "platform_turn_limit_after_tutor_reply:final_allowed_turn_reply_recorded"
    );
    assert.equal(
      afterConcurrent.conversation_turns.filter(
        (entry) => entry.actor_type === "student"
      ).length,
      turnLimit
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
    assert.equal(failedTeacherConversation?.max_student_turns, 30);
    assert.equal(successfulTeacherConversation?.max_student_turns, 30);
    assert.equal(failedTeacherConversation?.final_allowed_turn, true);
    assert.equal(successfulTeacherConversation?.another_student_turn_available, false);
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
      "platform_lifecycle"
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
    assert.match(sessionsCsv, /platform_turn_limit_after_tutor_reply:final_allowed_turn_reply_recorded/u);
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
    const prospective = createProspectiveRunner();
    const prospectiveSubject: FormativeConversationValidationSubject = {
      ...subjects[0]!, display_name: "Synthetic prospective continuity and unresolved cap student",
      conversation_behavior: Array.from({ length: turnLimit }, (_, index) => turn(index === 0
        ? "Please leave SEM for another day. Please keep this brief. I still need help with validity evidence."
        : `Validity evidence still feels unclear after explanation ${index + 1}.`, index))
    };
    const prospectiveResult = await runFormativeConversationProtocolValidation({
      mode: "contract_test", subjects: [prospectiveSubject], assessment_definition: assessmentDefinition(),
      runner_factory: () => prospective.runner, run_public_id: prospectiveRunPublicId,
      include_production_profiling: true, frozen_initial_profiles: {},
      profiling_mock_provider_mode: "student_profiling_compound_misconception",
      profiling_no_provider_test_executor: input => executeAgent({
        agent_name: input.agentName, input: input.allowlistedInput,
        assessment_session_db_id: input.operationalContext.assessment_session_db_id,
        concept_unit_session_db_id: input.operationalContext.concept_unit_session_db_id,
        followup_round_db_id: input.operationalContext.followup_round_db_id,
        agent_invocation_key: input.invocationKey, force_new_invocation: input.forceNewInvocation,
        metadata: { operational_agent_mode: "v18r2_no_provider_test", ...(input.metadata ?? {}) },
        model_config_override: { model_name: "v18r2-no-provider-structured-request" }
      })
    });
    const prospectiveStudent = prospectiveResult.report.students[0]!;
    assert.equal(prospectiveStudent.execution_error, null, JSON.stringify(prospectiveStudent));
    assert(prospectiveStudent.conversation_public_id);
    const persisted = await conversationRecord(prospectiveStudent.conversation_public_id);
    assert.equal(persisted.status, "ended");
    assert.equal(persisted.lifecycle_reason, "platform_turn_limit_after_tutor_reply:final_allowed_turn_reply_recorded");
    assert.equal(persisted.profile_transitions.length, 0, "the length limit must not invent a learning outcome");
    assert.equal(persisted.review_signals.filter(signal => signal.signal_type === "platform_lifecycle_handoff").length, 0);
    assert.equal(persisted.conversation_turns.filter(entry => entry.actor_type === "student").length, turnLimit);
    assert.equal(prospective.invocations(), turnLimit + 1);
    assert.equal(prospective.reloadedContinuityChecks(), turnLimit - 1);
    const lastCall = persisted.agent_calls.at(-1)!;
    assert.equal(lastCall.call_status, "succeeded");
    assert.equal(lastCall.schema_version, FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION);
    const payload = lastCall.output_payload as unknown as FormativeConversationV18R2AgentOutput;
    assert.equal(payload.outcome, "continue_conversation");
    assert.equal(payload.profile_transition_recommendation, null);
    assert.equal(payload.teacher_assistance_recommendation.recommended, false);
    assert.equal(payload.conversation_review?.closure.reason, "turn_limit");
    assert.deepEqual(payload.conversation_review?.closure.unresolved_need_ids, ["validity_help"]);
    const persistedAudit = lastCall.raw_output as { provider_execution_audit?: { attempts?: {
      profile_update_projection?: { status?: string; original_output_sha256?: string },
      conversation_plan_projection?: { status?: string; original_output_sha256?: string;
        prior_needs_sha256?: string | null; derived_open_need_ids?: string[];
        stored_preference_bindings?: { preference_id: string; preference_sha256: string }[] }
    }[] } };
    const deliveryAudit = FormativeConversationV18R2ExecutionAuditSchema.parse(persistedAudit.provider_execution_audit);
    assert.equal(deliveryAudit.accounting_version, "formative-conversation-v18r2-evaluation-accounting-v2");
    assert.equal(deliveryAudit.review_logical_calls_entered, 1);
    assert.equal(deliveryAudit.attempts[0].pre_delivery_review?.status, "passed");
    const persistedReviewInput = deliveryAudit.attempts[0].pre_delivery_review?.input;
    assert(persistedReviewInput, "A passed delivery review must retain its actual source input");
    assert.equal(persistedReviewInput.draft_message, payload.student_visible_message);
    assert.equal(persistedReviewInput.latest_student_message, prospectiveSubject.conversation_behavior.at(-1)!.message_text);
    const openingCall = persisted.agent_calls[0];
    const openingAudit = FormativeConversationV18R2ExecutionAuditSchema.parse((openingCall.raw_output as { provider_execution_audit: unknown }).provider_execution_audit);
    assert.equal(openingAudit.attempts[0].pre_delivery_review?.status, "skipped_opening");
    assert.equal(openingAudit.review_logical_calls_entered, 0);
    assert.equal(persistedAudit.provider_execution_audit?.attempts?.[0]?.profile_update_projection?.status, "no_profile_transition");
    assert.match(persistedAudit.provider_execution_audit?.attempts?.[0]?.profile_update_projection?.original_output_sha256 ?? "", /^[a-f0-9]{64}$/u);
    const storedPlan = persistedAudit.provider_execution_audit?.attempts?.[0]?.conversation_plan_projection;
    assert.equal(storedPlan?.status, "reconstructed");
    assert.match(storedPlan?.original_output_sha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.match(storedPlan?.prior_needs_sha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.deepEqual(storedPlan?.derived_open_need_ids, ["validity_help"]);
    assert.deepEqual(storedPlan?.stored_preference_bindings?.map(entry => entry.preference_id), ["defer_sem", "brief"]);
    assert(storedPlan?.stored_preference_bindings?.every(entry => /^[a-f0-9]{64}$/u.test(entry.preference_sha256)));
    const prospectiveSeed = await buildFormativeConversationRuntimeContextSeed({
      conversation_public_id: persisted.conversation_public_id,
      student_user_db_id: persisted.assessment_session.user_db_id
    });
    const reloaded = await compilePersistedFormativeConversationV18R2Context({ ...prospectiveSeed,
      conversation_public_id: persisted.conversation_public_id }, turnLimit);
    const deferral = reloaded.context.conversation_continuity?.preferences.find(entry => entry.preference_id === "defer_sem");
    assert(deferral);
    const originalCall = persisted.agent_calls.find(call => call.agent_call_public_id === deferral.source_agent_call_public_id);
    assert(originalCall?.output_validated && originalCall.call_status === "succeeded");
    assert(persisted.message_receipts.some(receipt => receipt.id === originalCall.formative_conversation_message_receipt_db_id && receipt.status === "assistant_turn_persisted"));
    assert.equal(deferral.source.quote, prospectiveSubject.conversation_behavior[0]!.message_text);
    assert.equal(reloaded.context.conversation_continuity?.needs.find(entry => entry.need_id === "sem_help")?.status, "deferred");
    assert.equal(reloaded.context.conversation_continuity?.needs.find(entry => entry.need_id === "validity_help")?.status, "open");
    const prospectiveTeacher = (await getTeacherReviewSessionDetail(prospectiveStudent.session_public_id)).formative_conversations[0];
    assert.equal(prospectiveTeacher?.lifecycle_termination_source, "platform_lifecycle");
    assert.equal(prospectiveTeacher?.learning_outcome, null);
    assert.equal(prospectiveTeacher?.semantic_teacher_assistance_recommended, false);
    const prospectiveReplay = await processFormativeConversationStudentMessage({
      conversation_public_id: persisted.conversation_public_id,
      client_message_id: `${prospectiveRunPublicId}:${prospectiveSubject.subject_id}:message:${turnLimit}`,
      message_text: prospectiveSubject.conversation_behavior.at(-1)!.message_text, context: prospectiveSeed
    }, { runner: prospective.runner });
    assert(prospectiveReplay.replayed);
    assert.equal(prospective.invocations(), turnLimit + 1);
    const capEventId = `final-formative-turn:${prospectiveRunPublicId}:${prospectiveSubject.subject_id}:message:${turnLimit}:conversation-ended`;
    // Recreate the exact interruption window: accepted call and assistant receipt
    // exist, but the subsequent platform closure transaction did not commit.
    await prisma.$transaction(async tx => {
      const removed = await tx.formativeConversationLifecycleEvent.deleteMany({ where: {
        formative_conversation_session_db_id: persisted.id, client_event_id: capEventId
      } });
      assert.equal(removed.count, 1);
      await tx.formativeConversationSession.update({ where: { id: persisted.id }, data: {
        status: "active", ended_at: null, lifecycle_reason: null,
        telemetry_event_sequence_counter: { decrement: 1 }
      } });
    });
    const interrupted = await conversationRecord(persisted.conversation_public_id);
    assert.equal(interrupted.status, "active");
    await processFormativeConversationStudentMessage({
      conversation_public_id: persisted.conversation_public_id,
      client_message_id: `${prospectiveRunPublicId}:${prospectiveSubject.subject_id}:message:1`,
      message_text: prospectiveSubject.conversation_behavior[0]!.message_text, context: prospectiveSeed
    }, { runner: prospective.runner });
    assert.equal((await conversationRecord(persisted.conversation_public_id)).status, "active",
      "an older receipt must not close the current final turn");
    for (const unboundOutput of [{}, { ...payload, student_visible_message: "Synthetic mismatched stored output." }]) {
      await prisma.agentCall.update({ where: { id: lastCall.id }, data: { output_payload: unboundOutput } });
      await processFormativeConversationStudentMessage({
        conversation_public_id: persisted.conversation_public_id,
        client_message_id: `${prospectiveRunPublicId}:${prospectiveSubject.subject_id}:message:${turnLimit}`,
        message_text: prospectiveSubject.conversation_behavior.at(-1)!.message_text, context: prospectiveSeed
      }, { runner: prospective.runner });
      assert.equal((await conversationRecord(persisted.conversation_public_id)).status, "active",
        "malformed output or a message unlike the displayed reply must not close the conversation");
    }
    await prisma.agentCall.update({ where: { id: lastCall.id }, data: { output_payload: payload } });
    const restoredBeforeRecovery = await conversationRecord(persisted.conversation_public_id);
    for (let replayIndex = 0; replayIndex < 2; replayIndex++) {
      const resumed = await processFormativeConversationStudentMessage({
        conversation_public_id: persisted.conversation_public_id,
        client_message_id: `${prospectiveRunPublicId}:${prospectiveSubject.subject_id}:message:${turnLimit}`,
        message_text: prospectiveSubject.conversation_behavior.at(-1)!.message_text, context: prospectiveSeed
      }, { runner: prospective.runner });
      assert(resumed.replayed);
    }
    const recovered = await conversationRecord(persisted.conversation_public_id);
    assert.equal(recovered.status, "ended");
    assert.equal(recovered.lifecycle_reason, "platform_turn_limit_after_tutor_reply:final_allowed_turn_reply_recorded");
    assert.equal(recovered.lifecycle_events.filter(event => event.client_event_id === capEventId).length, 1);
    assert.equal(recovered.telemetry_event_sequence_counter, persisted.telemetry_event_sequence_counter);
    assert.deepEqual(recovered.conversation_turns, interrupted.conversation_turns);
    assert.deepEqual(recovered.agent_calls, restoredBeforeRecovery.agent_calls);
    assert.equal(recovered.profile_transitions.length, 0);
    assert.equal(prospective.invocations(), turnLimit + 1);
    assert.equal(await canFinishConversationAssessment(recovered.assessment_session_db_id,
      recovered.assessment_session.assessment_db_id), true,
    "a successfully persisted final reply permits explicit workflow completion despite unresolved needs");
    // A student/session closure wins over a delayed cap recovery; its reason
    // remains authoritative and is never replaced by replay bookkeeping.
    await prisma.$transaction(async tx => {
      await tx.formativeConversationLifecycleEvent.deleteMany({ where: {
        formative_conversation_session_db_id: persisted.id, client_event_id: capEventId
      } });
      await tx.formativeConversationSession.update({ where: { id: persisted.id }, data: {
        status: "ended", lifecycle_reason: "student_request:ended", telemetry_event_sequence_counter: { decrement: 1 }
      } });
    });
    await processFormativeConversationStudentMessage({
      conversation_public_id: persisted.conversation_public_id,
      client_message_id: `${prospectiveRunPublicId}:${prospectiveSubject.subject_id}:message:${turnLimit}`,
      message_text: prospectiveSubject.conversation_behavior.at(-1)!.message_text, context: prospectiveSeed
    }, { runner: prospective.runner });
    const explicitlyEnded = await conversationRecord(persisted.conversation_public_id);
    assert.equal(explicitlyEnded.lifecycle_reason, "student_request:ended");
    assert.equal(explicitlyEnded.lifecycle_events.filter(event => event.client_event_id === capEventId).length, 0);
    assert.equal(prospective.invocations(), turnLimit + 1);
    // Restore the actual after-reply boundary reason after the synthetic race
    // above, then exercise Finish through its real transaction. No reply,
    // source call, profile or unresolved support record is manufactured.
    await prisma.formativeConversationSession.update({ where: { id: persisted.id }, data: {
      lifecycle_reason: recovered.lifecycle_reason
    } });
    const finishInput = { student_user_db_id: persisted.assessment_session.user_db_id,
      session_public_id: prospectiveStudent.session_public_id };
    await finishConversationAssessment(finishInput);
    const finishedSession = await prisma.assessmentSession.findUniqueOrThrow({ where: { id: persisted.assessment_session_db_id } });
    assert.equal(finishedSession.status, "completed");
    assert.equal(finishedSession.current_phase, "session_completed");
    assert(finishedSession.completed_at);
    await finishConversationAssessment(finishInput);
    const finishReplaySession = await prisma.assessmentSession.findUniqueOrThrow({ where: { id: finishedSession.id } });
    assert.deepEqual(finishReplaySession.completed_at, finishedSession.completed_at);
    assert.equal(await prisma.processEvent.count({ where: { assessment_session_db_id: finishedSession.id,
      event_type: "session_completed" } }), 1);
    const afterFinish = await conversationRecord(persisted.conversation_public_id);
    assert.equal(afterFinish.lifecycle_reason, recovered.lifecycle_reason);
    assert.equal(afterFinish.current_student_profile_db_id, recovered.current_student_profile_db_id);
    assert.deepEqual(afterFinish.profile_transitions, recovered.profile_transitions);
    assert.deepEqual(afterFinish.agent_calls, recovered.agent_calls);
    assert.deepEqual(afterFinish.review_signals, recovered.review_signals);
    assert.deepEqual(afterFinish.conversation_turns, recovered.conversation_turns);
    assert.deepEqual((afterFinish.agent_calls.at(-1)!.output_payload as unknown as FormativeConversationV18R2AgentOutput)
      .conversation_review?.closure.unresolved_need_ids, ["validity_help"]);
    assert.equal(prospective.invocations(), turnLimit + 1);
    assert.equal(networkRequests, 0, "the lifecycle smoke must not use the network");

    console.log(
      JSON.stringify(
        {
          status: "passed",
          assessment_messages_counted_as_formative_turns: 0,
          assistant_opening_counted_as_formative_turns: 0,
          final_allowed_turn_index: turnLimit,
          final_turn_semantic_regenerations: 1,
          final_turn_invalid_candidates_preserved: 2,
          platform_lifecycle_handoff_persisted: true,
          platform_handoff_profile_transitions: 0,
          platform_handoff_semantic_teacher_assistance: false,
          over_limit_distinct_turn_rejected: true,
          exact_replay_after_closure_increment: 0,
          concurrent_final_turn_accepted: 1,
          concurrent_over_limit_turn_accepted: 0,
          terminal_transition_count: 1,
          duplicate_transition_count: 0,
          teacher_export_lifecycle_source_parity: true,
          research_export_lifecycle_source_parity: true,
          prospective_wire_turn_limit_with_null_profile: true,
          prospective_no_automatic_mastery_or_referral: true,
          persisted_continuity_source_and_receipt_verified: true,
          persisted_continuity_reloaded_before_turns: prospective.reloadedContinuityChecks(),
          original_proposal_hash_and_projection_audit_persisted: true,
          pre_delivery_review_and_exact_opening_scope_audits_persisted: true,
          interrupted_final_reply_closure_recovered_on_replay: true,
          resumed_cap_closure_duplicate_events: 0,
          resumed_cap_closure_extra_model_calls: 0,
          older_or_malformed_or_mismatched_receipt_does_not_close: true,
          explicit_student_closure_preserved_after_final_reply_replay: true,
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
    await cleanupSyntheticStudentValidationRun(prospectiveRunPublicId);
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
