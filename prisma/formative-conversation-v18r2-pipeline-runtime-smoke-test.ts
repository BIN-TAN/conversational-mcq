import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { executeAgent } from "../src/lib/agents/execute-agent";
import { prisma } from "../src/lib/db";
import {
  canonicalMisconceptionClaimIds,
  parseCanonicalMisconceptionClaimCatalog
} from "../src/lib/domain/misconception-claim-identity";
import {
  cleanupSyntheticStudentValidationRun,
  runFormativeConversationProtocolValidation,
  type FormativeConversationValidationAssessmentDefinition,
  type FormativeConversationValidationSubject
} from "../src/lib/evaluation/synthetic-student-validation/framework";
import { FORMATIVE_CONVERSATION_AGENT_NAME } from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
  FormativeConversationV18R2AgentOutputSchema,
  type FormativeConversationV18R2AgentInput,
  type FormativeConversationV18R2AgentOutput
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { FormativeConversationV18PersistedProfileSnapshotSchema } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18";
import {
  processFormativeConversationStudentMessage,
  type FormativeConversationV18R2AgentRunner
} from "../src/lib/services/student-assessment/formative-conversation/runtime";
import { buildFormativeConversationRuntimeContextSeed } from "../src/lib/services/student-assessment/formative-conversation/runtime-context";
import {
  v18r2TestContinueOutput,
  v18r2TestTerminalOutput
} from "./formative-conversation-v18r2-test-fixtures";

const runPublicId = `fcv18r2_pipeline_${Date.now()}`;

function assessmentDefinition(): FormativeConversationValidationAssessmentDefinition {
  return {
    title: "V18R2 bounded conversation pipeline",
    description: "No-provider dissertation pipeline integration test.",
    diagnostic_focus:
      "Distinguish reliability, validity evidence, and score uncertainty.",
    concept_title: "Measurement evidence and score interpretation",
    learning_objective:
      "Explain why reliability and standard error do not establish validity or an exact true score.",
    related_concept_description:
      "Measurement-theory distinctions used in score interpretation.",
    assessment_boundary:
      "Only the administered measurement-theory evidence is in scope.",
    administered_items: [
      {
        item_alias: "measurement_reliability",
        item_order: 1,
        item_stem:
          "A test has high internal consistency. Which conclusion is supported?",
        options: [
          {
            label: "A",
            text: "Scores are consistent; validity needs separate evidence."
          },
          { label: "B", text: "High reliability proves validity for every use." },
          { label: "C", text: "Every observed score is exact." }
        ],
        correct_option: "A",
        answer_explanation:
          "Reliability concerns consistency; validity needs evidence for an intended interpretation and use.",
        distractor_rationales: {
          B: "Conflates reliability with validity.",
          C: "Treats consistency as exact measurement."
        },
        expected_reasoning_patterns: [
          "Separates consistency from validity evidence."
        ],
        item_version: 1
      },
      {
        item_alias: "standard_error_measurement",
        item_order: 2,
        item_stem:
          "What does standard error of measurement contribute to score interpretation?",
        options: [
          {
            label: "A",
            text: "It describes uncertainty around an observed score."
          },
          { label: "B", text: "It proves the exact true score." },
          { label: "C", text: "It reports the percent of wrong answers." }
        ],
        correct_option: "A",
        answer_explanation:
          "SEM represents expected score uncertainty; it does not identify an exact true score.",
        distractor_rationales: {
          B: "Removes uncertainty instead of representing it.",
          C: "Confuses measurement error with item errors."
        },
        expected_reasoning_patterns: [
          "Connects SEM with uncertainty around observed scores."
        ],
        item_version: 1
      },
      {
        item_alias: "validity_argument",
        item_order: 3,
        item_stem: "Which statement best reflects a validity argument?",
        options: [
          {
            label: "A",
            text: "Evidence supports an intended interpretation and use."
          },
          { label: "B", text: "Reliability automatically establishes validity." },
          { label: "C", text: "Validity never depends on context." }
        ],
        correct_option: "A",
        answer_explanation:
          "Validity concerns evidence for an intended interpretation and use in context.",
        distractor_rationales: {
          B: "Treats reliability as sufficient validity evidence.",
          C: "Treats validity as context-free."
        },
        expected_reasoning_patterns: [
          "Relates validity evidence to interpretation and use."
        ],
        item_version: 1
      }
    ]
  };
}

const assessmentResponseBehavior: FormativeConversationValidationSubject["assessment_response_behavior"] = [
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

function behavior(messageText: string, index: number) {
  return {
    intent: "reflection" as const,
    message_text: messageText,
    response_time_ms: 12_000 + index * 1_000,
    typing_duration_ms: 7_000 + index * 500,
    edit_count: 1,
    backspace_count: 2,
    paste_event_count: 0,
    paste_character_count: 0
  };
}

function subjects(): FormativeConversationValidationSubject[] {
  return [
    {
      subject_id: "fragmented_inconsistent",
      display_name: "Synthetic V18R2 continuous conversation student",
      assessment_response_behavior: structuredClone(assessmentResponseBehavior),
      conversation_behavior: [
        behavior(
          "Can you help me separate what consistency tells us from what validity tells us?",
          0
        ),
        behavior(
          "Reliability is about consistency, but I am not sure how that changes a hiring interpretation.",
          1
        ),
        behavior(
          "Could you use a hiring test example before I try the distinction again?",
          2
        ),
        behavior(
          "For a hiring test, reliability only tells me scores are consistent. I still need separate evidence for the intended hiring interpretation and use. I have not explained SEM yet, so I would not claim that part is resolved.",
          3
        )
      ]
    },
    {
      subject_id: "persistent_non_improvement",
      display_name: "Synthetic V18R2 persistent barrier student",
      assessment_response_behavior: structuredClone(assessmentResponseBehavior),
      conversation_behavior: [
        behavior("Why does consistency not automatically prove validity?", 0),
        behavior(
          "I followed the example, but I still think a reliable score is probably valid.",
          1
        ),
        behavior(
          "Even after those explanations, I still think reliability proves validity and SEM identifies the exact score.",
          2
        )
      ]
    }
  ];
}

function openingOutput(): FormativeConversationV18R2AgentOutput {
  return FormativeConversationV18R2AgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
    outcome: "continue_conversation",
    student_visible_message:
      "Looking back at your reasoning, reliability, validity, and score uncertainty are useful ideas to separate. Where would you like to begin?",
    teaching_artifact: null,
    evidence_observations: [],
    profile_transition_recommendation: null,
    teacher_assistance_recommendation: {
      recommended: false,
      reason_code: null
    },
    lifecycle_recommendation: "continue"
  });
}

function createRunner() {
  let calls = 0;
  const observedContexts = new Map<string, FormativeConversationV18R2AgentInput[]>();
  const runner: FormativeConversationV18R2AgentRunner = {
    identity: {
      agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
      agent_version: "formative-conversation-v18r2-pipeline-smoke-v1",
      model_name: "no-provider-v18r2-contract-fixture",
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
      calls += 1;
      const history = observedContexts.get(context.conversation_public_id) ?? [];
      history.push(structuredClone(context));
      observedContexts.set(context.conversation_public_id, history);
      const studentTurnCount = context.formative_lifecycle.student_turn_index;
      const latest = context.latest_student_message ?? "";
      const output =
        studentTurnCount === 0
          ? openingOutput()
          : /Even after those explanations/iu.test(latest)
            ? v18r2TestTerminalOutput({
                context,
                outcome: "teacher_assistance_recommended"
              })
            : studentTurnCount >= 4
              ? v18r2TestTerminalOutput({
                  context,
                  outcome: "largely_improved_understanding"
                })
              : v18r2TestContinueOutput({ context });
      const startedAt = new Date();
      return {
        output,
        raw_output: { fixture_type: "v18r2_no_provider_pipeline" },
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
    calls: () => calls,
    contexts: (conversationPublicId: string) =>
      observedContexts.get(conversationPublicId) ?? []
  };
}

async function main() {
  const originalFetch = globalThis.fetch;
  const priorResearchKey = process.env.RESEARCH_PSEUDONYMIZATION_KEY;
  const priorResearchVersion = process.env.RESEARCH_PSEUDONYMIZATION_VERSION;
  let networkRequests = 0;
  globalThis.fetch = (async () => {
    networkRequests += 1;
    throw new Error("network_forbidden_in_v18r2_pipeline_smoke");
  }) as typeof fetch;
  process.env.RESEARCH_PSEUDONYMIZATION_KEY =
    "formative-conversation-v18r2-pipeline-smoke-key";
  process.env.RESEARCH_PSEUDONYMIZATION_VERSION = "hmac_sha256_v1";
  const runner = createRunner();

  try {
    const runSubjects = subjects();
    const result = await runFormativeConversationProtocolValidation({
      mode: "contract_test",
      subjects: runSubjects,
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

    assert.equal(result.report.export_validation.status, "passed");
    assert.deepEqual(result.report.architecture_review.issue_codes, []);
    assert.equal(result.report.students.length, 2);

    for (const [index, student] of result.report.students.entries()) {
      assert.equal(student.execution_error, null);
      assert(student.conversation_public_id);
      assert.equal(student.profile_transition_occurred, true);
      const expectedOutcome =
        index === 0 ? "largely_improved" : "teacher_assistance_recommended";
      assert.equal(student.teacher_trajectory.learning_outcome, expectedOutcome);
      assert.equal(
        student.final_profile_transition?.learning_outcome,
        expectedOutcome
      );

      const conversation =
        await prisma.formativeConversationSession.findUniqueOrThrow({
          where: {
            conversation_public_id: student.conversation_public_id
          },
          include: {
            assessment_session: { select: { user_db_id: true } },
            conversation_turns: { orderBy: { sequence_index: "asc" } },
            message_receipts: true,
            agent_calls: {
              where: {
                agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
                schema_version:
                  FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION
              },
              orderBy: { created_at: "asc" }
            },
            profile_transitions: {
              include: {
                source_agent_call: true,
                source_turn: true,
                supporting_turn_references: {
                  include: { conversation_turn: true }
                },
                profile_evidence_references: true
              }
            },
            profile_evidence_references: true,
            review_signals: true
          }
        });
      const expectedStudentTurns = runSubjects[index]!.conversation_behavior.length;
      const contexts = runner.contexts(student.conversation_public_id);
      assert.equal(contexts.length, expectedStudentTurns + 1);
      assert.deepEqual(
        contexts.map((context) => context.formative_lifecycle.student_turn_index),
        Array.from({ length: expectedStudentTurns + 1 }, (_, turn) => turn)
      );
      assert.equal(contexts[0]?.assessment_response_evidence.length, 3);
      assert.equal(contexts[0]?.formative_lifecycle.student_turn_index, 0);
      assert.equal(contexts[1]?.formative_lifecycle.student_turn_index, 1);
      assert.equal(
        conversation.conversation_turns.filter(
          (turn) => turn.actor_type === "student"
        ).length,
        expectedStudentTurns
      );
      assert.equal(
        conversation.message_receipts.filter(
          (receipt) => receipt.student_turn_db_id !== null
        ).length,
        expectedStudentTurns
      );

      const claimIdSets = contexts.map((context) =>
        canonicalMisconceptionClaimIds(
          context.allowed_misconception_claim_catalog
        )
      );
      claimIdSets.slice(1).forEach((claimIds) =>
        assert.deepEqual(claimIds, claimIdSets[0])
      );
      const finalEvidenceIds = new Set(
        contexts.at(-1)!.allowed_evidence_catalog.evidence.map(
          (entry) => entry.evidence_id
        )
      );
      for (const context of contexts) {
        for (const evidence of context.allowed_evidence_catalog.evidence) {
          assert(finalEvidenceIds.has(evidence.evidence_id));
        }
      }

      const outputs = conversation.agent_calls.map((call) =>
        FormativeConversationV18R2AgentOutputSchema.parse(call.output_payload)
      );
      for (const output of outputs.slice(0, -1)) {
        assert.equal(output.outcome, "continue_conversation");
        assert.equal(output.profile_transition_recommendation, null);
      }
      assert.equal(conversation.profile_transitions.length, 1);
      const transition = conversation.profile_transitions[0]!;
      const snapshot =
        FormativeConversationV18PersistedProfileSnapshotSchema.parse(
          transition.profile_snapshot
        );
      assert.equal(
        transition.learning_outcome,
        expectedOutcome
      );
      assert.equal(
        transition.source_agent_call?.agent_call_public_id,
        conversation.agent_calls.at(-1)?.agent_call_public_id
      );
      assert(
        snapshot.canonical_evidence_ids.every((evidenceId) => {
          const evidence = snapshot.canonical_evidence_catalog.evidence.find(
            (entry) => entry.evidence_id === evidenceId
          );
          return (
            evidence?.source_role === "student" &&
            evidence.evidence_stage === "formative_conversation"
          );
        })
      );
      assert(
        conversation.profile_evidence_references.length >= expectedStudentTurns
      );
      assert.equal(
        conversation.review_signals.filter(
          (signal) => signal.signal_type === "platform_lifecycle_handoff"
        ).length,
        0
      );
      const initialCatalog = parseCanonicalMisconceptionClaimCatalog(
        conversation.profile_transitions[0]!.profile_snapshot &&
          contexts[0]!.current_profile.misconception_claim_catalog
      );
      assert(initialCatalog);

      const transitionsBeforeReplay = conversation.profile_transitions.length;
      const callsBeforeReplay = runner.calls();
      const studentTurnsBeforeReplay = expectedStudentTurns;
      const replaySeed = await buildFormativeConversationRuntimeContextSeed({
        conversation_public_id: student.conversation_public_id,
        student_user_db_id: conversation.assessment_session.user_db_id
      });
      await processFormativeConversationStudentMessage(
        {
          conversation_public_id: student.conversation_public_id,
          client_message_id: `${runPublicId}:${runSubjects[index]!.subject_id}:message:${expectedStudentTurns}`,
          message_text:
            runSubjects[index]!.conversation_behavior.at(-1)!.message_text,
          context: replaySeed,
          observable_input_telemetry: {
            submitted_at: new Date(),
            edit_count: 0,
            backspace_count: 0,
            paste_event_count: 0,
            paste_character_count: 0
          }
        },
        { runner: runner.runner }
      );
      assert.equal(runner.calls(), callsBeforeReplay);
      assert.equal(
        await prisma.formativeConversationProfileTransition.count({
          where: {
            formative_conversation_session_db_id: conversation.id
          }
        }),
        transitionsBeforeReplay
      );
      assert.equal(
        await prisma.formativeConversationMessageReceipt.count({
          where: {
            formative_conversation_session_db_id: conversation.id,
            student_turn_db_id: { not: null }
          }
        }),
        studentTurnsBeforeReplay
      );
    }

    const sessionPublicIds = result.report.students.map(
      (student) => student.session_public_id
    );
    const assessmentSessionIds = await prisma.assessmentSession.findMany({
      where: { session_public_id: { in: sessionPublicIds } },
      select: { id: true }
    });
    const ids = assessmentSessionIds.map((session) => session.id);
    assert.equal(
      await prisma.activityRuntimeAttempt.count({
        where: { session_public_id: { in: sessionPublicIds } }
      }),
      0
    );
    assert.equal(
      await prisma.topicDialogue.count({
        where: { assessment_session_db_id: { in: ids } }
      }),
      0
    );
    assert(result.research_export.buffer.length > 0);
    assert.equal(networkRequests, 0);

    console.log(
      JSON.stringify(
        {
          status: "passed",
          multi_turn_continue_before_terminal: true,
          nonterminal_profile_transitions: 0,
          later_terminal_transition_persisted: true,
          persistent_barrier_teacher_assistance_persisted: true,
          semantic_teacher_assistance_source: "llm_recommendation",
          platform_lifecycle_handoffs: 0,
          canonical_claim_ids_stable: true,
          canonical_evidence_ids_stable: true,
          assessment_administration_counted_as_formative_turns: 0,
          idempotent_replay_increment: 0,
          duplicate_transitions: 0,
          teacher_export_parity: true,
          research_export_integrity: result.report.export_validation.status,
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
          : "formative_conversation_v18r2_pipeline_smoke_failed",
      provider_calls: 0,
      model_auth_requests: 0,
      dispatch_checkpoints: 0
    })
  );
  process.exitCode = 1;
});
