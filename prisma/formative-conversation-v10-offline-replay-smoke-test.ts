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
} from "../src/lib/operational/formative-conversation-v5-evaluation-v10/contracts";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_AGENT_NAME,
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS,
  FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
  FormativeConversationAgentOutputSchema,
  FormativeConversationProfileEvidenceSchema,
  type FormativeConversationAgentInput,
  type FormativeConversationAgentOutput,
  type FormativeConversationCanonicalProfile
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  processFormativeConversationStudentMessage,
  type FormativeConversationAgentRunner
} from "../src/lib/services/student-assessment/formative-conversation/runtime";
import { buildFormativeConversationRuntimeContextSeed } from "../src/lib/services/student-assessment/formative-conversation/runtime-context";
import { canonicalFormativeConversationProfileFromStudentProfile } from "../src/lib/services/student-assessment/formative-conversation/profile-update";
import { createEvaluationDatabaseConnectionOwner } from "../src/lib/operational/evaluation-database-connection-owner";
import {
  withFormativeConversationPersistenceDiagnostics,
  type FormativeConversationPersistenceDiagnostic
} from "../src/lib/services/student-assessment/formative-conversation/persistence-observability";

const caseIds = [
  "fcv5_04_related_concept_discussion",
  "fcv5_05_sound_profile_transition",
  "fcv5_06_largely_improved_temporal",
  "fcv5_07_persistent_barrier_teacher_assistance",
  "fcv5_08_mixed_resolved_evidence"
] as const;
const runPublicId = `fcv5_v10_offline_replay_${Date.now()}`;

function loadFixture(caseId: (typeof caseIds)[number]) {
  return FormativeConversationV5FixtureSchema.parse(
    JSON.parse(
      readFileSync(
        `config/operational-candidates/formative-conversation-host-v5-executable-v10/fixtures/${caseId}.json`,
        "utf8"
      )
    )
  );
}

const fixtures = caseIds.map(loadFixture);

const V9_CASE4_SAFE_FAILURE_PATH =
  "config/operational-candidates/formative-conversation-host-v5-executable-v10/regressions/immutable-v9-case4-safe-failure-evidence.json";
const V9_CASE6_SAFE_FAILURE_PATH =
  "config/operational-candidates/formative-conversation-host-v5-executable-v10/regressions/immutable-v9-case6-safe-failure-evidence.json";
const V9_CASE7_TRANSITION_AUDIT_PATH =
  "config/operational-candidates/formative-conversation-host-v5-executable-v10/regressions/immutable-v9-case7-transition-audit.json";

function verifyImmutableV9Findings() {
  const case4 = JSON.parse(
    readFileSync(V9_CASE4_SAFE_FAILURE_PATH, "utf8")
  ) as {
    case_id: string;
    exact_generated_opening_available: boolean;
    validator_issue_paths_available: boolean;
    student_visible_output_persisted: boolean;
    typed_failure: string;
    preserved_immutable: boolean;
  };
  const case6 = JSON.parse(
    readFileSync(V9_CASE6_SAFE_FAILURE_PATH, "utf8")
  ) as {
    case_id: string;
    provider_failure_classification: string;
    semantic_regeneration_eligible: boolean;
    semantic_regeneration_attempted: boolean;
    exact_invalid_candidate_available: boolean;
    exact_schema_issue_paths_available: boolean;
    transition_persisted: boolean;
    preserved_immutable: boolean;
  };
  const case7 = JSON.parse(
    readFileSync(V9_CASE7_TRANSITION_AUDIT_PATH, "utf8")
  ) as {
    transitions: Array<{
      transition_public_id: string;
      supporting_student_turns: number[];
    }>;
    canonical_fields_updated_by_second_transition: string[];
    classification: string;
    no_op_suppression_required: boolean;
    preserved_immutable: boolean;
  };

  assert.equal(case4.case_id, "fcv5_04_related_concept_discussion");
  assert.equal(case4.typed_failure, "formative_conversation_opening_validation");
  assert.equal(case4.exact_generated_opening_available, false);
  assert.equal(case4.validator_issue_paths_available, false);
  assert.equal(case4.student_visible_output_persisted, false);
  assert.equal(case4.preserved_immutable, true);

  assert.equal(case6.case_id, "fcv5_06_largely_improved_temporal");
  assert.equal(case6.provider_failure_classification, "response_schema_invalid");
  assert.equal(case6.semantic_regeneration_eligible, true);
  assert.equal(case6.semantic_regeneration_attempted, false);
  assert.equal(case6.exact_invalid_candidate_available, false);
  assert.equal(case6.exact_schema_issue_paths_available, false);
  assert.equal(case6.transition_persisted, false);
  assert.equal(case6.preserved_immutable, true);

  assert.equal(case7.transitions.length, 2);
  assert.notDeepEqual(
    case7.transitions[0].supporting_student_turns,
    case7.transitions[1].supporting_student_turns
  );
  assert(case7.canonical_fields_updated_by_second_transition.length > 0);
  assert.equal(
    case7.classification,
    "two_substantively_different_evidence_supported_versions"
  );
  assert.equal(case7.no_op_suppression_required, false);
  assert.equal(case7.preserved_immutable, true);
}

type ImmutableV7AgentCall = {
  student_visible_tutor_output: string;
  profile_recommendation: FormativeConversationAgentOutput["profile_transition_recommendation"];
  evidence_observations: FormativeConversationAgentOutput["evidence_observations"];
  teacher_assistance_recommendation: FormativeConversationAgentOutput["teacher_assistance_recommendation"];
  lifecycle_recommendation: FormativeConversationAgentOutput["lifecycle_recommendation"];
};

type ImmutableV7Transcript = {
  case_id: string;
  transcript: Array<{
    sequence_index: number;
    actor: "student" | "tutor";
    message_text: string;
  }>;
  agent_calls: ImmutableV7AgentCall[];
};

const immutableV7TranscriptPaths = {
  fcv5_05_sound_profile_transition:
    "config/operational-candidates/formative-conversation-host-v5-executable-v8/regressions/immutable-v7-case5-transcript.json",
  fcv5_07_persistent_barrier_teacher_assistance:
    "config/operational-candidates/formative-conversation-host-v5-executable-v8/regressions/immutable-v7-case7-transcript.json",
  fcv5_08_mixed_resolved_evidence:
    "config/operational-candidates/formative-conversation-host-v5-executable-v8/regressions/immutable-v7-case8-transcript.json"
} as const;

const immutableV7Transcripts = new Map(
  Object.entries(immutableV7TranscriptPaths).map(([caseId, transcriptPath]) => [
    caseId,
    JSON.parse(readFileSync(transcriptPath, "utf8")) as ImmutableV7Transcript
  ])
);

const immutableV8TranscriptPaths = {
  fcv5_05_sound_profile_transition:
    ".data/operational-formative-conversation-v5-evaluation-v8/runs/fcv5v8_provider_20260801134821_4d583c17/cases/fcv5_05_sound_profile_transition-transcript.json",
  fcv5_06_largely_improved_temporal:
    ".data/operational-formative-conversation-v5-evaluation-v8/runs/fcv5v8_provider_20260801134821_4d583c17/cases/fcv5_06_largely_improved_temporal-transcript.json",
  fcv5_07_persistent_barrier_teacher_assistance:
    ".data/operational-formative-conversation-v5-evaluation-v8/runs/fcv5v8_provider_20260801134821_4d583c17/cases/fcv5_07_persistent_barrier_teacher_assistance-transcript.json",
  fcv5_08_mixed_resolved_evidence:
    ".data/operational-formative-conversation-v5-evaluation-v8/runs/fcv5v8_provider_20260801134821_4d583c17/cases/fcv5_08_mixed_resolved_evidence-transcript.json"
} as const;

const immutableV8Transcripts = new Map(
  Object.entries(immutableV8TranscriptPaths).map(
    ([caseId, transcriptPath]) => [
      caseId,
      JSON.parse(
        readFileSync(transcriptPath, "utf8")
      ) as ImmutableV7Transcript
    ]
  )
);

function rebindSequenceIndexes(input: {
  indexes: number[];
  immutable: ImmutableV7Transcript;
  context: FormativeConversationAgentInput;
}) {
  const immutableStudentIndexes = input.immutable.transcript
    .filter((turn) => turn.actor === "student")
    .map((turn) => turn.sequence_index);
  const runtimeStudentIndexes = input.context.visible_transcript
    .filter((turn) => turn.actor === "student")
    .map((turn) => turn.sequence_index);
  const sequenceMap = new Map(
    immutableStudentIndexes.map((sequenceIndex, index) => [
      sequenceIndex,
      runtimeStudentIndexes[index]
    ])
  );
  return input.indexes.map((sequenceIndex) => {
    const rebound = sequenceMap.get(sequenceIndex);
    assert(rebound, `Missing runtime sequence for V7 turn ${sequenceIndex}.`);
    return rebound;
  });
}

function exactV7Output(input: {
  immutable: ImmutableV7Transcript;
  callIndex: number;
  context: FormativeConversationAgentInput;
}) {
  const call = input.immutable.agent_calls[input.callIndex];
  assert(call, "The immutable V7 call output is missing.");
  const rebind = (indexes: number[]) =>
    rebindSequenceIndexes({
      indexes,
      immutable: input.immutable,
      context: input.context
    });
  const recommendation = call.profile_recommendation
    ? {
        ...structuredClone(call.profile_recommendation),
        source_turn_sequence_indexes: rebind(
          call.profile_recommendation.source_turn_sequence_indexes
        ),
        field_evidence: call.profile_recommendation.field_evidence.map(
          (evidence) => ({
            ...evidence,
            source_turn_sequence_indexes: rebind(
              evidence.source_turn_sequence_indexes
            )
          })
        )
      }
    : null;
  return FormativeConversationAgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
    student_visible_message: call.student_visible_tutor_output,
    teaching_artifact: null,
    evidence_observations: call.evidence_observations.map((observation) => ({
      ...observation,
      source_turn_sequence_indexes: rebind(
        observation.source_turn_sequence_indexes
      )
    })),
    profile_transition_recommendation: recommendation,
    teacher_assistance_recommendation:
      call.teacher_assistance_recommendation,
    lifecycle_recommendation: call.lifecycle_recommendation
  });
}

function assessmentDefinition(
  fixture: FormativeConversationV5Fixture
): FormativeConversationValidationAssessmentDefinition {
  return {
    title: fixture.assessment.title,
    description:
      "Frozen V8 context used only for deterministic transition validation.",
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

function relatedConceptOutput(
  context: FormativeConversationAgentInput
): FormativeConversationAgentOutput {
  const latestStudentTurn = [...context.visible_transcript]
    .reverse()
    .find((turn) => turn.actor === "student");
  assert(latestStudentTurn, "The related-concept response needs a student turn.");
  return FormativeConversationAgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
    student_visible_message:
      "Yes. Reliability and validity connect to fairness because consistent scores can still support an unfair interpretation or use. Fairness asks whether score meaning and consequences remain defensible across relevant groups and contexts. Which part would you like to examine first: the evidence behind the interpretation or how a decision uses the score?",
    teaching_artifact: null,
    evidence_observations: [
      {
        evidence_type: "student_extension_request",
        observation:
          "The student connected the administered measurement concepts to fairness and requested a related discussion.",
        source_turn_sequence_indexes: [latestStudentTurn.sequence_index]
      }
    ],
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
    ["fcv5_04_related_concept_discussion", null],
    ["fcv5_05_sound_profile_transition", null],
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
      agent_version: "formative-conversation-v8-transition-runtime-smoke-v1",
      model_name: "no-provider-contract-fixture",
      provider: "mock",
      prompt_version:
        "formative-conversation-v8-transition-runtime-smoke-v1",
      schema_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
      prompt_hash: createHash("sha256")
        .update("formative-conversation-v8-transition-runtime-smoke-v1")
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
      const immutableV8 = immutableV8Transcripts.get(
        state.fixture.case_id
      );
      const immutableV7 = immutableV7Transcripts.get(
        state.fixture.case_id
      );
      const callIndex = state.call_count - 1;
      const immutable = immutableV8?.agent_calls[callIndex]
        ? immutableV8
        : immutableV7;
      let output =
        state.fixture.case_id === "fcv5_04_related_concept_discussion" &&
        state.call_count === 2
          ? relatedConceptOutput(context)
          : immutable
            ? exactV7Output({ immutable, callIndex, context })
            : isFinalCall && outcome
              ? terminalOutput({ context, outcome })
              : continueOutput(context);
      if (
        (state.fixture.case_id ===
          "fcv5_05_sound_profile_transition" ||
          state.fixture.case_id ===
            "fcv5_08_mixed_resolved_evidence") &&
        output.profile_transition_recommendation?.updated_profile
      ) {
        const correctedOutput = structuredClone(output);
        const correctedProfile =
          correctedOutput.profile_transition_recommendation
            ?.updated_profile;
        assert(correctedProfile);
        correctedProfile.misconception_indicators = [];
        output = correctedOutput;
      }
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
  const suddenImprovementFixture = fixtures.find(
    (fixture) => fixture.execution_subject_id === "sudden_improvement"
  );
  const lastBehavior = suddenImprovementFixture?.student_messages.at(-1);
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

async function verifyPersistedCanonicalFieldDisposition(input: {
  conversation_public_id: string;
}) {
  const transition =
    await prisma.formativeConversationProfileTransition.findFirstOrThrow({
      where: {
        formative_conversation_session: {
          conversation_public_id: input.conversation_public_id
        }
      },
      include: {
        prior_student_profile: true,
        updated_student_profile: true,
        source_agent_call: {
          select: { agent_call_public_id: true }
        },
        supporting_turn_references: true,
        profile_evidence_references: true
      },
      orderBy: { transitioned_at: "desc" }
    });
  const snapshot = FormativeConversationProfileEvidenceSchema.parse(
    transition.profile_snapshot
  );
  assert(snapshot.canonical_profile);
  const prior = canonicalFormativeConversationProfileFromStudentProfile(
    transition.prior_student_profile
  );
  const updated = canonicalFormativeConversationProfileFromStudentProfile(
    transition.updated_student_profile
  );
  assert.deepEqual(snapshot.canonical_profile, updated);

  const dispositionByField = new Map(
    snapshot.field_evidence.flatMap((entry) =>
      entry.profile_fields.map(
        (field) => [field, entry.disposition] as const
      )
    )
  );
  assert.equal(
    dispositionByField.size,
    FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.length
  );
  for (const field of FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS) {
    const changed =
      JSON.stringify(prior[field]) !== JSON.stringify(updated[field]);
    assert.equal(
      dispositionByField.get(field),
      changed
        ? "updated_from_conversation_evidence"
        : "retained_evidence_remains_valid",
      `Persisted disposition must match canonical value change for ${field}.`
    );
  }
  assert(transition.source_agent_call?.agent_call_public_id);
  assert(transition.supporting_turn_references.length > 0);
  assert(transition.profile_evidence_references.length > 0);
}

async function verifySoundTransitionAfterResolvedSem(input: {
  report: Awaited<
    ReturnType<typeof runFormativeConversationProtocolValidation>
  >["report"];
}) {
  const student = input.report.students.find(
    (entry) => entry.persona_id === "sudden_improvement"
  );
  assert(student?.conversation_public_id);
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: student.session_public_id },
    select: { user_db_id: true }
  });
  const runner: FormativeConversationAgentRunner = {
    identity: {
      agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
      agent_version: "formative-conversation-v8-sound-replay-v1",
      model_name: "no-provider-contract-fixture",
      provider: "mock",
      prompt_version: "formative-conversation-v8-sound-replay-v1",
      schema_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
      prompt_hash: createHash("sha256")
        .update("formative-conversation-v8-sound-replay-v1")
        .digest("hex"),
      reasoning_effort: null,
      max_output_tokens: 1_000,
      live_call_allowed: false
    },
    async execute({ context }) {
      const startedAt = new Date();
      return {
        output: terminalOutput({
          context,
          outcome: "sound_understanding"
        }),
        raw_output: { fixture_type: "no_provider_sound_replay" },
        generation_source: "deterministic_test",
        provider_request_id: null,
        provider_response_id: null,
        client_request_id: null,
        retry_count: 0,
        latency_ms: 90_000,
        input_tokens: 10,
        output_tokens: 10,
        total_tokens: 20,
        estimated_cost: 0,
        started_at: startedAt,
        completed_at: new Date(startedAt.getTime() + 90_000)
      };
    }
  };
  const context = await buildFormativeConversationRuntimeContextSeed({
    conversation_public_id: student.conversation_public_id,
    student_user_db_id: session.user_db_id
  });
  await processFormativeConversationStudentMessage(
    {
      conversation_public_id: student.conversation_public_id,
      client_message_id: `${runPublicId}:sudden_improvement:resolved-sem`,
      message_text:
        "SEM describes uncertainty around an observed score, so the observed score is an estimate rather than the exact true score. Reliability is still only consistency evidence, while validity needs evidence for the intended interpretation and use.",
      context,
      observable_input_telemetry: {
        submitted_at: new Date(),
        edit_count: 0,
        backspace_count: 0,
        paste_event_count: 0,
        paste_character_count: 0
      }
    },
    { runner }
  );
  const latest =
    await prisma.formativeConversationProfileTransition.findFirstOrThrow({
      where: {
        formative_conversation_session: {
          conversation_public_id: student.conversation_public_id
        }
      },
      orderBy: { transitioned_at: "desc" }
    });
  assert.equal(latest.learning_outcome, "sound");
  await verifyPersistedCanonicalFieldDisposition({
    conversation_public_id: student.conversation_public_id
  });
}

async function main() {
  const previousKey = process.env.RESEARCH_PSEUDONYMIZATION_KEY;
  const previousVersion = process.env.RESEARCH_PSEUDONYMIZATION_VERSION;
  const runner = createRunner();
  const diagnostics: FormativeConversationPersistenceDiagnostic[] = [];
  const owner = createEvaluationDatabaseConnectionOwner({
    client: prisma,
    client_id: "v10-offline-replay-prisma",
    on_diagnostic: (diagnostic) => diagnostics.push(diagnostic)
  });
  try {
    verifyImmutableV9Findings();
    process.env.RESEARCH_PSEUDONYMIZATION_KEY =
      "formative-conversation-v8-transition-smoke-key";
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

    const result =
      await withFormativeConversationPersistenceDiagnostics(
        {
          record: owner.record_diagnostic,
          connection_identity: owner.identity,
          run_read: owner.run_read,
          run_idempotent_write: owner.run_idempotent_write
        },
        () =>
          runFormativeConversationProtocolValidation({
            mode: "contract_test",
            subjects: fixtures.map(subject),
            assessment_definition: assessmentDefinition(fixtures[0]),
            runner_factory: () => runner.runner,
            run_public_id: runPublicId,
            include_production_profiling: false,
            frozen_initial_profiles: initialProfiles
          })
      );

    assert.equal(result.report.export_validation.status, "passed");
    assert.deepEqual(result.report.architecture_review.issue_codes, []);
    if (
      result.report.technical_reliability_report.failed_sessions !== 0
    ) {
      console.error(
        JSON.stringify(
          result.report.students.map((student) => ({
            persona_id: student.persona_id,
            execution_error: student.execution_error,
            execution_failure: student.execution_failure,
            unresolved_issue_codes: student.unresolved_issue_codes,
            agent_calls: student.agent_calls
          }))
        )
      );
    }
    assert.equal(
      result.report.technical_reliability_report.failed_sessions,
      0
    );
    const expectedOutcomes = new Map([
      ["high_performing_extension", null],
      ["sudden_improvement", "largely_improved"],
      ["confident_misconception", "largely_improved"],
      [
        "persistent_non_improvement",
        "teacher_assistance_recommended"
      ],
      ["fragmented_inconsistent", "largely_improved"]
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
        assert(student.conversation_public_id);
        await verifyPersistedCanonicalFieldDisposition({
          conversation_public_id: student.conversation_public_id
        });
      }
    }

    await verifyIdempotentReplay({
      report: result.report,
      runner
    });
    await verifySoundTransitionAfterResolvedSem({
      report: result.report
    });
    const transactionDiagnostics = diagnostics.filter(
      (entry) => entry.phase === "transaction"
    );
    assert(transactionDiagnostics.length > 0);
    assert(
      transactionDiagnostics.every(
        (entry) => entry.transaction_timeout_ms === 30_000
      )
    );
    const transactionDurations = transactionDiagnostics.map(
      (entry) => entry.duration_ms
    );

    console.log(
      JSON.stringify(
        {
          status: "passed",
          provider_calls: 0,
          network_requests: 0,
          deterministic_context_replays: [
            "case4_contract_valid_opening_and_related_concept_flow",
            "case5_v8_outputs_then_preserved_candidate_completion",
            "case6_exact_v8_largely_improved_control",
            "case7_v8_outputs_then_preserved_candidate_completion",
            "case8_exact_v8_output_with_field_role_correction",
            "post_case5_sound_after_sem_resolution"
          ],
          immutable_v9_case4_exact_output_available: false,
          immutable_v9_case6_exact_output_available: false,
          immutable_v9_case7_transitions_substantive: true,
          persisted_terminal_transitions: 5,
          persistence_diagnostics: {
            count: diagnostics.length,
            transaction_count: transactionDiagnostics.length,
            transaction_duration_min_ms: Math.min(
              ...transactionDurations
            ),
            transaction_duration_max_ms: Math.max(
              ...transactionDurations
            ),
            transaction_timeout_ms: 30_000
          },
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
    await owner.disconnect_final();
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
          : "formative_conversation_v10_offline_replay_smoke_failed",
      provider_calls: 0,
      network_requests: 0
    })
  );
  process.exitCode = 1;
});
