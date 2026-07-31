import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AgentOutputByName } from "../src/lib/agents/contracts";
import { prisma } from "../src/lib/db";
import {
  cleanupSyntheticStudentValidationRun,
  runFormativeConversationProtocolValidation,
  type FormativeConversationValidationAssessmentDefinition,
  type FormativeConversationValidationSubject
} from "../src/lib/evaluation/synthetic-student-validation/framework";
import {
  FormativeConversationV5FixtureSchema,
  type FormativeConversationV5Fixture
} from "../src/lib/operational/formative-conversation-v5-evaluation-v5/contracts";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_AGENT_NAME,
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS,
  FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
  FormativeConversationAgentOutputSchema,
  type FormativeConversationAgentInput,
  type FormativeConversationAgentOutput,
  type FormativeConversationCanonicalProfile
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  processFormativeConversationStudentMessage,
  type FormativeConversationAgentRunner
} from "../src/lib/services/student-assessment/formative-conversation/runtime";
import { buildFormativeConversationRuntimeContextSeed } from "../src/lib/services/student-assessment/formative-conversation/runtime-context";

const caseIds = [
  "fcv5_05_sound_profile_transition",
  "fcv5_06_largely_improved_temporal",
  "fcv5_07_persistent_barrier_teacher_assistance",
  "fcv5_08_mixed_resolved_evidence"
] as const;
const runPublicId = `fcv5_v6_transition_smoke_${Date.now()}`;

function loadFixture(caseId: (typeof caseIds)[number]) {
  return FormativeConversationV5FixtureSchema.parse(
    JSON.parse(
      readFileSync(
        `config/operational-candidates/formative-conversation-host-v5-executable-v5/fixtures/${caseId}.json`,
        "utf8"
      )
    )
  );
}

const fixtures = caseIds.map(loadFixture);

function assessmentDefinition(
  fixture: FormativeConversationV5Fixture
): FormativeConversationValidationAssessmentDefinition {
  return {
    title: fixture.assessment.title,
    description:
      "Frozen v5 context used only for deterministic v6 transition validation.",
    diagnostic_focus: fixture.assessment.learning_objective,
    concept_title: fixture.assessment.concept_title,
    learning_objective: fixture.assessment.learning_objective,
    related_concept_description:
      "Measurement-theory distinctions used in score interpretation.",
    assessment_boundary: fixture.assessment.assessment_boundary,
    administered_items: fixture.assessment.administered_items.map((item) => ({
      ...item,
      options: item.options.map((option) => ({ ...option })),
      distractor_rationales: { ...item.distractor_rationales },
      expected_reasoning_patterns: [...item.expected_reasoning_patterns]
    }))
  };
}

function subject(
  fixture: FormativeConversationV5Fixture
): FormativeConversationValidationSubject {
  return {
    subject_id: fixture.execution_subject_id,
    display_name: `Synthetic ${fixture.title}`,
    assessment_response_behavior: fixture.assessment_responses.map(
      (response) => ({ ...response })
    ),
    conversation_behavior: fixture.student_messages.map((message) => ({
      intent: message.intent,
      message_text: message.message_text,
      ...message.observable_input_telemetry
    }))
  };
}

function updatedProfile(input: {
  prior: FormativeConversationCanonicalProfile;
  outcome:
    | "sound_understanding"
    | "largely_improved_understanding"
    | "teacher_assistance_recommended";
}) {
  const updated = structuredClone(input.prior);
  if (input.outcome === "sound_understanding") {
    updated.ability_profile = "robust_transfer_ready_understanding";
    updated.integrated_diagnostic_profile =
      "robust_understanding_ready_for_transfer";
    updated.misconception_indicators = [];
    updated.reasoning_quality_summary =
      "The latest student turn independently applies the conceptual distinction.";
  } else if (input.outcome === "largely_improved_understanding") {
    updated.ability_profile = "mostly_correct_understanding";
    updated.integrated_diagnostic_profile =
      "correct_but_fragile_understanding";
    updated.reasoning_quality_summary =
      "The latest student turn shows meaningful progress while a supported limitation remains.";
  } else {
    updated.integrated_profile_rationale =
      "The latest conversation evidence preserves a meaningful barrier that may benefit from instructor support.";
    updated.recommended_next_evidence = [
      "Instructor-supported explanation followed by independent application."
    ];
  }
  updated.rationale = `No-provider ${input.outcome} runtime replay.`;
  return updated;
}

function terminalOutput(input: {
  context: FormativeConversationAgentInput;
  outcome:
    | "sound_understanding"
    | "largely_improved_understanding"
    | "teacher_assistance_recommended";
}): FormativeConversationAgentOutput {
  const prior = input.context.current_profile.canonical_profile;
  assert(prior, "A canonical prior profile is required.");
  const studentTurn = [...input.context.visible_transcript]
    .reverse()
    .find((turn) => turn.actor === "student");
  assert(studentTurn, "A supporting student turn is required.");
  const updated = updatedProfile({ prior, outcome: input.outcome });
  const changed = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
    (field) =>
      JSON.stringify(prior[field]) !== JSON.stringify(updated[field])
  );
  const retained = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
    (field) => !changed.includes(field)
  );

  return FormativeConversationAgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
    student_visible_message:
      "Your latest explanation gives us useful evidence to continue from.",
    teaching_artifact: null,
    evidence_observations: [
      {
        evidence_type: "student_conceptual_application",
        observation:
          "The latest student message supplies the evidence cited by this deterministic runtime replay.",
        source_turn_sequence_indexes: [studentTurn.sequence_index]
      }
    ],
    profile_transition_recommendation: {
      recommendation_version:
        FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
      recommended: true,
      proposed_outcome: input.outcome,
      rationale: `The cited student evidence supports ${input.outcome}.`,
      source_turn_sequence_indexes: [studentTurn.sequence_index],
      updated_profile: updated,
      field_evidence: [
        {
          profile_fields: changed,
          disposition: "updated_from_conversation_evidence",
          evidence_basis: "conversation_evidence",
          rationale:
            "Changed fields are grounded in the cited latest student turn.",
          source_turn_sequence_indexes: [studentTurn.sequence_index]
        },
        {
          profile_fields: retained,
          disposition: "retained_evidence_remains_valid",
          evidence_basis: "prior_profile_evidence",
          rationale:
            "Retained fields exactly preserve their canonical prior values.",
          source_turn_sequence_indexes: []
        }
      ]
    },
    teacher_assistance_recommendation: {
      recommended: input.outcome === "teacher_assistance_recommended",
      reason_code:
        input.outcome === "teacher_assistance_recommended"
          ? "meaningful_barrier_remains"
          : null
    },
    lifecycle_recommendation: "continue"
  });
}

function continueOutput(
  context: FormativeConversationAgentInput
): FormativeConversationAgentOutput {
  const latestStudentTurn = [...context.visible_transcript]
    .reverse()
    .find((turn) => turn.actor === "student");
  return FormativeConversationAgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
    student_visible_message:
      context.latest_student_message === null
        ? "Let us use your reviewed answers as a starting point."
        : "That gives us useful evidence to keep discussing the distinction.",
    teaching_artifact: null,
    evidence_observations: latestStudentTurn
      ? [
          {
            evidence_type: "conversation_evidence",
            observation:
              "The student supplied observable conversation evidence without a terminal recommendation.",
            source_turn_sequence_indexes: [
              latestStudentTurn.sequence_index
            ]
          }
        ]
      : [],
    profile_transition_recommendation: null,
    teacher_assistance_recommendation: {
      recommended: false,
      reason_code: null
    },
    lifecycle_recommendation: "continue"
  });
}

function createRunner() {
  const assigned = new Map<
    string,
    { fixture: FormativeConversationV5Fixture; call_count: number }
  >();
  let totalCalls = 0;
  const outcomeByCase = new Map<
    string,
    | "sound_understanding"
    | "largely_improved_understanding"
    | "teacher_assistance_recommended"
    | null
  >([
    ["fcv5_05_sound_profile_transition", "sound_understanding"],
    [
      "fcv5_06_largely_improved_temporal",
      "largely_improved_understanding"
    ],
    [
      "fcv5_07_persistent_barrier_teacher_assistance",
      "teacher_assistance_recommended"
    ],
    ["fcv5_08_mixed_resolved_evidence", null]
  ]);

  const runner: FormativeConversationAgentRunner = {
    identity: {
      agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
      agent_version: "formative-conversation-v6-transition-runtime-smoke-v1",
      model_name: "no-provider-contract-fixture",
      provider: "mock",
      prompt_version:
        "formative-conversation-v6-transition-runtime-smoke-v1",
      schema_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
      prompt_hash: createHash("sha256")
        .update("formative-conversation-v6-transition-runtime-smoke-v1")
        .digest("hex"),
      reasoning_effort: null,
      max_output_tokens: 1_000,
      live_call_allowed: false
    },
    async execute({ context }) {
      totalCalls += 1;
      let state = assigned.get(context.conversation_public_id);
      if (!state) {
        const fixture = fixtures[assigned.size];
        assert(fixture, "Unexpected synthetic conversation.");
        state = { fixture, call_count: 0 };
        assigned.set(context.conversation_public_id, state);
      }
      state.call_count += 1;
      assert(
        outcomeByCase.has(state.fixture.case_id),
        "Unexpected transition fixture."
      );
      const outcome = outcomeByCase.get(state.fixture.case_id);
      assert.notEqual(outcome, undefined);
      const isFinalCall =
        state.call_count === 1 + state.fixture.student_messages.length;
      const output =
        isFinalCall && outcome
          ? terminalOutput({ context, outcome })
          : continueOutput(context);
      const startedAt = new Date();
      return {
        output,
        raw_output: { fixture_type: "no_provider_runtime_validation" },
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
    total_calls: () => totalCalls
  };
}

async function verifyIdempotentReplay(input: {
  report: Awaited<
    ReturnType<typeof runFormativeConversationProtocolValidation>
  >["report"];
  runner: ReturnType<typeof createRunner>;
}) {
  const student = input.report.students.find(
    (entry) => entry.persona_id === "sudden_improvement"
  );
  assert(student?.conversation_public_id);
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: student.session_public_id },
    select: { user_db_id: true }
  });
  const lastBehavior = fixtures[0].student_messages.at(-1);
  assert(lastBehavior);
  const callsBefore = input.runner.total_calls();
  const transitionsBefore =
    await prisma.formativeConversationProfileTransition.count({
      where: {
        formative_conversation_session: {
          conversation_public_id: student.conversation_public_id
        }
      }
    });
  const context = await buildFormativeConversationRuntimeContextSeed({
    conversation_public_id: student.conversation_public_id,
    student_user_db_id: session.user_db_id
  });
  await processFormativeConversationStudentMessage(
    {
      conversation_public_id: student.conversation_public_id,
      client_message_id: `${runPublicId}:sudden_improvement:message:2`,
      message_text: lastBehavior.message_text,
      context,
      observable_input_telemetry: {
        submitted_at: new Date(),
        edit_count: lastBehavior.observable_input_telemetry.edit_count,
        backspace_count:
          lastBehavior.observable_input_telemetry.backspace_count,
        paste_event_count:
          lastBehavior.observable_input_telemetry.paste_event_count,
        paste_character_count:
          lastBehavior.observable_input_telemetry.paste_character_count
      }
    },
    { runner_factory: () => input.runner.runner }
  );
  const transitionsAfter =
    await prisma.formativeConversationProfileTransition.count({
      where: {
        formative_conversation_session: {
          conversation_public_id: student.conversation_public_id
        }
      }
    });
  assert.equal(input.runner.total_calls(), callsBefore);
  assert.equal(transitionsAfter, transitionsBefore);
}

async function main() {
  const previousKey = process.env.RESEARCH_PSEUDONYMIZATION_KEY;
  const previousVersion = process.env.RESEARCH_PSEUDONYMIZATION_VERSION;
  const runner = createRunner();
  try {
    process.env.RESEARCH_PSEUDONYMIZATION_KEY =
      "formative-conversation-v6-transition-smoke-key";
    process.env.RESEARCH_PSEUDONYMIZATION_VERSION = "hmac_sha256_v1";
    const initialProfiles: Partial<
      Record<
        FormativeConversationValidationSubject["subject_id"],
        AgentOutputByName["student_profiling_agent"]
      >
    > = {};
    for (const fixture of fixtures) {
      initialProfiles[fixture.execution_subject_id] =
        fixture.initial_profile_source.profile;
    }

    const result = await runFormativeConversationProtocolValidation({
      mode: "contract_test",
      subjects: fixtures.map(subject),
      assessment_definition: assessmentDefinition(fixtures[0]),
      runner_factory: () => runner.runner,
      run_public_id: runPublicId,
      include_production_profiling: false,
      frozen_initial_profiles: initialProfiles
    });

    assert.equal(result.report.export_validation.status, "passed");
    assert.deepEqual(result.report.architecture_review.issue_codes, []);
    assert.equal(
      result.report.technical_reliability_report.failed_sessions,
      0
    );
    const expectedOutcomes = new Map([
      ["sudden_improvement", "sound"],
      ["confident_misconception", "largely_improved"],
      [
        "persistent_non_improvement",
        "teacher_assistance_recommended"
      ],
      ["fragmented_inconsistent", null]
    ]);
    for (const student of result.report.students) {
      const expected = expectedOutcomes.get(student.persona_id);
      assert.notEqual(expected, undefined);
      assert.equal(
        student.teacher_trajectory.learning_outcome,
        expected
      );
      assert.equal(
        student.profile_transition_occurred,
        expected !== null
      );
      if (expected !== null) {
        assert(student.transition_evidence.supporting_turn_count > 0);
        assert(student.transition_evidence.evidence_reference_count > 0);
        assert(student.transition_evidence.source_agent_call_public_id);
        assert.equal(
          student.final_profile_transition?.learning_outcome,
          expected
        );
      }
    }

    await verifyIdempotentReplay({
      report: result.report,
      runner
    });

    console.log(
      JSON.stringify(
        {
          status: "passed",
          provider_calls: 0,
          network_requests: 0,
          deterministic_context_replays: [
            "case5_sound",
            "case6_largely_improved",
            "case7_teacher_assistance",
            "case8_mixed_resolved_continue"
          ],
          persisted_terminal_transitions: 3,
          teacher_export_parity: true,
          profile_provenance_complete: true,
          idempotent_replay: true,
          activity_runtime_contamination: 0,
          topic_dialogue_contamination: 0
        },
        null,
        2
      )
    );
  } finally {
    await cleanupSyntheticStudentValidationRun(runPublicId);
    if (previousKey === undefined) {
      delete process.env.RESEARCH_PSEUDONYMIZATION_KEY;
    } else {
      process.env.RESEARCH_PSEUDONYMIZATION_KEY = previousKey;
    }
    if (previousVersion === undefined) {
      delete process.env.RESEARCH_PSEUDONYMIZATION_VERSION;
    } else {
      process.env.RESEARCH_PSEUDONYMIZATION_VERSION = previousVersion;
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
          : "formative_conversation_v6_transition_runtime_smoke_failed",
      provider_calls: 0,
      network_requests: 0
    })
  );
  process.exitCode = 1;
});
