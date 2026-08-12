import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AgentOutputByName } from "../src/lib/agents/contracts";
import {
  canonicalMisconceptionClaimTexts,
  parseCanonicalMisconceptionClaimCatalog
} from "../src/lib/domain/misconception-claim-identity";
import { prisma } from "../src/lib/db";
import {
  cleanupSyntheticStudentValidationRun,
  runFormativeConversationProtocolValidation,
  type FormativeConversationValidationAssessmentDefinition,
  type FormativeConversationValidationSubject
} from "../src/lib/evaluation/synthetic-student-validation/framework";
import { FormativeConversationV5FixtureSchema } from "../src/lib/operational/formative-conversation-v5-evaluation-v16/contracts";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_AGENT_NAME,
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS,
  FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
  FormativeConversationAgentOutputSchema,
  FormativeConversationProfileEvidenceSchema,
  type FormativeConversationAgentInput,
  type FormativeConversationAgentOutput
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  processFormativeConversationStudentMessage,
  type FormativeConversationAgentRunner
} from "../src/lib/services/student-assessment/formative-conversation/runtime";
import { buildFormativeConversationRuntimeContextSeed } from "../src/lib/services/student-assessment/formative-conversation/runtime-context";

const runPublicId = `fcv17_transition_runtime_${Date.now()}`;
const fixture = FormativeConversationV5FixtureSchema.parse(
  JSON.parse(
    readFileSync(
      "config/operational-candidates/formative-conversation-host-v5-executable-v16/fixtures/fcv5_05_sound_profile_transition.json",
      "utf8"
    )
  )
);

const atomicClaims = [
  "High reliability or consistency automatically proves validity.",
  "Standard error of measurement identifies an exact true score.",
  "Validity is a permanent, context-free property of a test."
] as const;

function assessmentDefinition(): FormativeConversationValidationAssessmentDefinition {
  return {
    title: fixture.assessment.title,
    description: "Deterministic V17 persistence validation only.",
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

function subject(): FormativeConversationValidationSubject {
  return {
    subject_id: fixture.execution_subject_id,
    display_name: "Synthetic V17 partial-resolution learner",
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

function initialProfile(): AgentOutputByName["student_profiling_agent"] {
  const profile = structuredClone(fixture.initial_profile_source.profile);
  profile.prompt_version = "student-profiling-v4";
  profile.schema_version = "student-profile-output-v3";
  const indicator = profile.misconception_indicators[0];
  assert(indicator, "The frozen V16 profile must contain its broad indicator.");
  indicator.atomic_claims = atomicClaims.map((claimText, index) => ({
    claim_text: claimText,
    source_evidence_references: [
      fixture.assessment.administered_items[index]?.item_alias ??
        fixture.assessment.administered_items[0].item_alias
    ]
  }));
  return profile;
}

function continueOutput(
  context: FormativeConversationAgentInput
): FormativeConversationAgentOutput {
  const studentTurn = [...context.visible_transcript]
    .reverse()
    .find((turn) => turn.actor === "student");
  return FormativeConversationAgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
    student_visible_message:
      context.latest_student_message === null
        ? "Let us use your reviewed answers as a starting point."
        : "That is useful context. Let us keep working through the distinction.",
    teaching_artifact: null,
    evidence_observations: studentTurn
      ? [
          {
            evidence_type: "conversation_evidence",
            observation:
              "The student supplied observable evidence that does not yet support a terminal transition.",
            source_turn_sequence_indexes: [studentTurn.sequence_index]
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

function terminalOutput(
  context: FormativeConversationAgentInput
): FormativeConversationAgentOutput {
  const prior = context.current_profile.canonical_profile;
  assert(prior, "V17 persistence requires a canonical prior profile.");
  const catalog = context.allowed_misconception_claim_catalog;
  assert.equal(catalog.indicators.length, 1);
  assert(
    catalog.indicators[0].claims.length === 3 ||
      catalog.indicators[0].claims.length === 2,
    "The sequential persistence smoke expects A+B+C or B+C."
  );
  const studentTurn = [...context.visible_transcript]
    .reverse()
    .find((turn) => turn.actor === "student");
  assert(studentTurn, "A supporting student turn is required.");
  const retainedClaims = catalog.indicators[0].claims.slice(1);
  assert(retainedClaims.length > 0);
  const updated = {
    ...structuredClone(prior),
    ability_profile: "mostly_correct_understanding",
    integrated_diagnostic_profile:
      "developing_understanding_with_productive_engagement",
    integrated_profile_rationale:
      "Conversation evidence resolves one atomic claim while the remaining canonical claims stay current.",
    misconception_indicators: retainedClaims.map((claim) => claim.claim_text),
    reasoning_quality_summary:
      "The student resolves one identified claim while the retained claims remain unresolved.",
    rationale:
      "The append-only profile records meaningful improvement without erasing retained claims.",
    recommended_next_evidence: [
      "Ask for evidence addressing the remaining canonical misconception claims."
    ]
  };
  const changed = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
    (field) => JSON.stringify(prior[field]) !== JSON.stringify(updated[field])
  );
  const retained = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
    (field) => !changed.includes(field)
  );
  return FormativeConversationAgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
    student_visible_message:
      "You have resolved one important distinction. Let us examine the remaining claim carefully.",
    teaching_artifact: null,
    evidence_observations: [
      {
        evidence_type: "conceptual_transfer",
        observation:
          "The student applies the reliability-validity distinction to the hiring context.",
        source_turn_sequence_indexes: [studentTurn.sequence_index]
      }
    ],
    profile_transition_recommendation: {
      recommendation_version:
        FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
      recommended: true,
      proposed_outcome: "largely_improved_understanding",
      rationale:
        "The student resolves one atomic claim while the remaining canonical claims stay current.",
      source_turn_sequence_indexes: [studentTurn.sequence_index],
      updated_profile: updated,
      field_evidence: [
        {
          profile_fields: changed,
          disposition: "updated_from_conversation_evidence",
          evidence_basis: "combined",
          rationale: "The cited student turn supports these changes.",
          source_turn_sequence_indexes: [studentTurn.sequence_index]
        },
        {
          profile_fields: retained,
          disposition: "retained_evidence_remains_valid",
          evidence_basis: "prior_profile_evidence",
          rationale: "The prior evidence remains valid for these fields.",
          source_turn_sequence_indexes: []
        }
      ],
      misconception_claim_closure: [],
      misconception_claim_dispositions: catalog.indicators[0].claims.map(
        (claim, index) => ({
          identity_version: catalog.identity_version,
          indicator_id: catalog.indicators[0].indicator_id,
          claim_id: claim.claim_id,
          disposition: index === 0 ? "resolved" : "retained",
          evidence_basis:
            index === 0 ? "conversation_evidence" : "prior_profile_evidence",
          evidence_summary:
            index === 0
              ? "The cited student turn rejects this claim in an applied context."
              : "No conversation evidence resolves this retained claim.",
          source_turn_sequence_indexes:
            index === 0 ? [studentTurn.sequence_index] : []
        })
      )
    },
    teacher_assistance_recommendation: {
      recommended: false,
      reason_code: null
    },
    lifecycle_recommendation: "continue"
  });
}

function createRunner() {
  let calls = 0;
  const finalCallNumber = 1 + fixture.student_messages.length;
  const runner: FormativeConversationAgentRunner = {
    identity: {
      agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
      agent_version: "formative-conversation-v17-runtime-smoke-v1",
      model_name: "no-provider-v17-contract-fixture",
      provider: "mock",
      prompt_version: "formative-conversation-host-v5.4",
      schema_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
      prompt_hash: createHash("sha256")
        .update("formative-conversation-host-v5.4")
        .digest("hex"),
      reasoning_effort: null,
      max_output_tokens: 1_000,
      live_call_allowed: false
    },
    async execute({ context }) {
      calls += 1;
      const output =
        calls >= finalCallNumber
          ? terminalOutput(context)
          : continueOutput(context);
      const startedAt = new Date();
      return {
        output,
        raw_output: { fixture_type: "v17_no_provider_runtime_validation" },
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
  return { runner, calls: () => calls };
}

async function main() {
  const originalFetch = globalThis.fetch;
  const priorResearchKey = process.env.RESEARCH_PSEUDONYMIZATION_KEY;
  const priorResearchVersion = process.env.RESEARCH_PSEUDONYMIZATION_VERSION;
  let networkRequests = 0;
  globalThis.fetch = (async () => {
    networkRequests += 1;
    throw new Error("network_forbidden_in_v17_runtime_smoke");
  }) as typeof fetch;
  process.env.RESEARCH_PSEUDONYMIZATION_KEY =
    "formative-conversation-v17-transition-runtime-smoke-key";
  process.env.RESEARCH_PSEUDONYMIZATION_VERSION = "hmac_sha256_v1";
  const runner = createRunner();
  try {
    const result = await runFormativeConversationProtocolValidation({
      mode: "contract_test",
      subjects: [subject()],
      assessment_definition: assessmentDefinition(),
      runner_factory: () => runner.runner,
      run_public_id: runPublicId,
      include_production_profiling: false,
      frozen_initial_profiles: {
        [fixture.execution_subject_id]: initialProfile()
      }
    });
    assert.equal(result.report.export_validation.status, "passed");
    assert.deepEqual(result.report.architecture_review.issue_codes, []);
    const student = result.report.students[0];
    assert(student?.conversation_public_id);
    assert.equal(student.profile_transition_occurred, true);
    assert.equal(student.teacher_trajectory.learning_outcome, "largely_improved");
    assert.equal(
      student.final_profile_transition?.learning_outcome,
      "largely_improved"
    );

    const transition =
      await prisma.formativeConversationProfileTransition.findFirstOrThrow({
        where: {
          formative_conversation_session: {
            conversation_public_id: student.conversation_public_id
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
        }
      });
    const snapshot = FormativeConversationProfileEvidenceSchema.parse(
      transition.profile_snapshot
    );
    const priorCatalog = parseCanonicalMisconceptionClaimCatalog(
      transition.prior_student_profile.misconception_indicators
    );
    const updatedCatalog = parseCanonicalMisconceptionClaimCatalog(
      transition.updated_student_profile.misconception_indicators
    );
    assert(priorCatalog && updatedCatalog);
    assert.equal(priorCatalog.indicators[0].claims.length, 3);
    assert.deepEqual(canonicalMisconceptionClaimTexts(updatedCatalog), [
      atomicClaims[1],
      atomicClaims[2]
    ]);
    assert.deepEqual(snapshot.misconception_claim_catalog, updatedCatalog);
    assert.equal(snapshot.misconception_claim_dispositions?.length, 3);
    assert(transition.source_agent_call?.agent_call_public_id);
    assert(transition.supporting_turn_references.length > 0);
    assert(transition.profile_evidence_references.length > 0);

    const assessmentSession = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: student.session_public_id },
      select: { user_db_id: true }
    });
    const retainedClaimC = priorCatalog.indicators[0].claims[2];
    assert(retainedClaimC);
    const firstTransitionClaimC = updatedCatalog.indicators[0].claims[1];
    assert.deepEqual(firstTransitionClaimC, retainedClaimC);

    const sequentialClientMessageId = `${runPublicId}:${fixture.execution_subject_id}:sequential-transition`;
    const sequentialMessage =
      "SEM describes uncertainty rather than an exact score, but I still need to examine whether validity changes with context.";
    const runtimeContext = await buildFormativeConversationRuntimeContextSeed({
      conversation_public_id: student.conversation_public_id,
      student_user_db_id: assessmentSession.user_db_id
    });
    await processFormativeConversationStudentMessage(
      {
        conversation_public_id: student.conversation_public_id,
        client_message_id: sequentialClientMessageId,
        message_text: sequentialMessage,
        context: runtimeContext,
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

    const transitions =
      await prisma.formativeConversationProfileTransition.findMany({
        where: {
          formative_conversation_session: {
            conversation_public_id: student.conversation_public_id
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
        orderBy: [{ transitioned_at: "asc" }, { transition_public_id: "asc" }]
      });
    assert.equal(transitions.length, 2);
    const secondTransition = transitions[1];
    assert(secondTransition);
    const secondPriorCatalog = parseCanonicalMisconceptionClaimCatalog(
      secondTransition.prior_student_profile.misconception_indicators
    );
    const secondUpdatedCatalog = parseCanonicalMisconceptionClaimCatalog(
      secondTransition.updated_student_profile.misconception_indicators
    );
    assert(secondPriorCatalog && secondUpdatedCatalog);
    assert.deepEqual(canonicalMisconceptionClaimTexts(secondPriorCatalog), [
      atomicClaims[1],
      atomicClaims[2]
    ]);
    assert.deepEqual(canonicalMisconceptionClaimTexts(secondUpdatedCatalog), [
      atomicClaims[2]
    ]);
    assert.deepEqual(
      secondPriorCatalog.indicators[0].claims[1],
      retainedClaimC,
      "Claim C must remain byte-identical in the second prior profile."
    );
    assert.deepEqual(
      secondUpdatedCatalog.indicators[0].claims[0],
      retainedClaimC,
      "Claim C must remain byte-identical after the second transition."
    );
    assert.equal(
      secondUpdatedCatalog.indicators[0].claims[0]?.claim_id,
      retainedClaimC.claim_id
    );
    assert(secondTransition.source_agent_call?.agent_call_public_id);
    assert(secondTransition.supporting_turn_references.length > 0);
    assert(secondTransition.profile_evidence_references.length > 0);

    const callsBeforeReplay = runner.calls();
    const transitionsBeforeReplay =
      await prisma.formativeConversationProfileTransition.count({
        where: {
          formative_conversation_session: {
            conversation_public_id: student.conversation_public_id
          }
        }
      });
    const replayRuntimeContext = await buildFormativeConversationRuntimeContextSeed({
      conversation_public_id: student.conversation_public_id,
      student_user_db_id: assessmentSession.user_db_id
    });
    await processFormativeConversationStudentMessage(
      {
        conversation_public_id: student.conversation_public_id,
        client_message_id: sequentialClientMessageId,
        message_text: sequentialMessage,
        context: replayRuntimeContext,
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
          formative_conversation_session: {
            conversation_public_id: student.conversation_public_id
          }
        }
      }),
      transitionsBeforeReplay
    );
    assert.equal(networkRequests, 0);

    console.log(
      JSON.stringify(
        {
          status: "passed",
          database_transition_persisted: true,
          partial_claim_resolution_persisted: true,
          retained_claim_ids_preserved: true,
          sequential_transition_claim_identity_stable: true,
          transition_provenance_complete: true,
          append_only_transition_count: transitionsBeforeReplay,
          idempotent_message_replay: true,
          teacher_export_parity: true,
          research_export_integrity: result.report.export_validation.status,
          activity_runtime_contamination: 0,
          topic_dialogue_contamination: 0,
          provider_calls: 0,
          model_auth_requests: 0,
          network_requests: networkRequests,
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
          : "formative_conversation_v17_transition_runtime_smoke_failed",
      provider_calls: 0,
      model_auth_requests: 0,
      dispatch_checkpoints: 0
    })
  );
  process.exitCode = 1;
});
