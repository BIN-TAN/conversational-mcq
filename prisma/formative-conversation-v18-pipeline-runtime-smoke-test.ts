import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { executeAgent } from "../src/lib/agents/execute-agent";
import { ProductionStudentProfileOutput } from "../src/lib/agents/contracts";
import { validateStudentProfileOutputSemantics } from "../src/lib/agents/student-profiling/semantic-validation";
import { prisma } from "../src/lib/db";
import type { CanonicalEvidenceRef } from "../src/lib/domain/canonical-evidence-identity";
import {
  canonicalMisconceptionClaimTexts,
  parseCanonicalMisconceptionClaimCatalog
} from "../src/lib/domain/misconception-claim-identity";
import {
  cleanupSyntheticStudentValidationRun,
  runFormativeConversationProtocolValidation,
  type FormativeConversationValidationAssessmentDefinition,
  type FormativeConversationValidationSubject
} from "../src/lib/evaluation/synthetic-student-validation/framework";
import {
  FORMATIVE_CONVERSATION_AGENT_NAME,
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_V18_PROFILE_RECOMMENDATION_VERSION,
  FormativeConversationV18AgentInputSchema,
  FormativeConversationV18AgentOutputSchema,
  FormativeConversationV18PersistedProfileSnapshotSchema,
  type FormativeConversationV18AgentInput,
  type FormativeConversationV18AgentOutput
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18";
import {
  FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES,
  validateFormativeConversationV18Transition,
  validatePersistedFormativeConversationV18Transition
} from "../src/lib/services/student-assessment/formative-conversation/evidence-identity-validator-v18";
import {
  canonicalFormativeConversationProfileStateFromStudentProfile
} from "../src/lib/services/student-assessment/formative-conversation/profile-update";
import {
  processFormativeConversationStudentMessage,
  type FormativeConversationV18AgentRunner
} from "../src/lib/services/student-assessment/formative-conversation/runtime";
import { buildFormativeConversationRuntimeContextSeed } from "../src/lib/services/student-assessment/formative-conversation/runtime-context";
import { compilePersistedFormativeConversationV18Context } from "../src/lib/services/student-assessment/formative-conversation/context-v18";

const runPublicId = `fcv18_pipeline_${Date.now()}`;

function assessmentDefinition(): FormativeConversationValidationAssessmentDefinition {
  return {
    title: "V18 canonical evidence pipeline",
    description: "No-provider dissertation pipeline integration canary.",
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
          { label: "A", text: "Scores are consistent; validity needs separate evidence." },
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
          { label: "A", text: "It describes uncertainty around an observed score." },
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
          { label: "A", text: "Evidence supports an intended interpretation and use." },
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

function subject(): FormativeConversationValidationSubject {
  return {
    subject_id: "fragmented_inconsistent",
    display_name: "Synthetic V18 partial-resolution student",
    assessment_response_behavior: [
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
    ],
    conversation_behavior: [
      {
        intent: "clarification_request",
        message_text:
          "Can you help me separate what consistency tells us from what validity tells us?",
        response_time_ms: 12_000,
        typing_duration_ms: 7_000,
        edit_count: 1,
        backspace_count: 2,
        paste_event_count: 0,
        paste_character_count: 0
      },
      {
        intent: "reflection",
        message_text:
          "For a hiring test, reliability only tells me the scores are consistent. I still need evidence that the score interpretation is valid for that hiring use. I have not yet explained what SEM means, so I would not claim that part is resolved.",
        response_time_ms: 21_000,
        typing_duration_ms: 13_000,
        edit_count: 3,
        backspace_count: 4,
        paste_event_count: 0,
        paste_character_count: 0
      }
    ]
  };
}

function openingOutput(): FormativeConversationV18AgentOutput {
  return FormativeConversationV18AgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
    student_visible_message:
      "Looking back at your reasoning, reliability and validity are a useful distinction to explore together. Where would you like to start?",
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

function continueOutput(): FormativeConversationV18AgentOutput {
  return FormativeConversationV18AgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
    student_visible_message:
      "Consistency tells us whether scores behave dependably; validity asks whether evidence supports the interpretation and use. Try applying that distinction to a hiring decision.",
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

function terminalOutput(
  context: FormativeConversationV18AgentInput
): FormativeConversationV18AgentOutput {
  const prior = context.current_profile.canonical_profile;
  assert(prior);
  const claims = context.allowed_misconception_claim_catalog.indicators.flatMap(
    (indicator) =>
      indicator.claims.map((claim) => ({ indicator, claim }))
  );
  assert.equal(claims.length, 2);
  const resolved = claims.find((entry) =>
    /reliability.*validity/iu.test(entry.claim.claim_text)
  );
  const retained = claims.find((entry) =>
    /standard error|\bsem\b|exact true score/iu.test(entry.claim.claim_text)
  );
  assert(resolved && retained);
  const latestStudentEvidence = context.allowed_evidence_catalog.evidence.find(
    (entry) =>
      entry.evidence_kind === "formative_student_turn" &&
      entry.source_sequence_index ===
        Math.max(
          ...context.visible_transcript
            .filter((turn) => turn.actor === "student")
            .map((turn) => turn.sequence_index)
        )
  );
  assert(latestStudentEvidence);
  const evidenceIds = [latestStudentEvidence.evidence_id];
  const updated = {
    ...structuredClone(prior),
    ability_profile: "mostly_correct_understanding",
    ability_pattern_flags: ["incorrect_answer_strong_partial_reasoning"],
    integrated_diagnostic_profile:
      "developing_understanding_with_productive_engagement",
    integrated_profile_confidence: "medium",
    integrated_profile_rationale:
      "Current student evidence resolves the reliability-validity claim while SEM remains explicitly untested.",
    evidence_sufficiency: "adequate",
    confidence_alignment: "mixed",
    misconception_indicators: [retained.claim.claim_text],
    reasoning_quality_summary:
      "The student independently applies the reliability-validity distinction and explicitly limits the claim about SEM.",
    profile_confidence: "medium",
    rationale:
      "The conversation supports partial improvement while retaining the unresolved SEM claim.",
    recommended_next_evidence: [
      "Ask the student to explain what SEM represents around an observed score."
    ]
  };
  const changed = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
    (field) => JSON.stringify(prior[field]) !== JSON.stringify(updated[field])
  );
  const unchanged = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
    (field) => !changed.includes(field)
  );
  return FormativeConversationV18AgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
    student_visible_message:
      "That hiring example separates reliability from validity clearly. You also correctly held back on SEM, so that remains the next idea to examine.",
    teaching_artifact: null,
    evidence_observations: [
      {
        evidence_type: "conceptual_application",
        observation:
          "The student applies the reliability-validity distinction and identifies the limit of the current evidence.",
        evidence_ids: evidenceIds
      }
    ],
    profile_transition_recommendation: {
      recommendation_version:
        FORMATIVE_CONVERSATION_V18_PROFILE_RECOMMENDATION_VERSION,
      recommended: true,
      proposed_outcome: "largely_improved_understanding",
      rationale:
        "Current student evidence resolves one canonical claim while the untested SEM claim retains its prior evidence.",
      canonical_evidence_ids: evidenceIds,
      updated_profile: updated,
      field_evidence: [
        {
          profile_fields: changed,
          disposition: "updated_from_conversation_evidence",
          evidence_basis: "combined",
          rationale: "The current student turn supports these changes.",
          evidence_ids: evidenceIds
        },
        {
          profile_fields: unchanged,
          disposition: "retained_evidence_remains_valid",
          evidence_basis: "prior_profile_evidence",
          rationale: "Prior evidence remains valid for these unchanged fields.",
          evidence_ids: []
        }
      ],
      misconception_claim_dispositions: [
        {
          identity_version:
            context.allowed_misconception_claim_catalog.identity_version,
          indicator_id: resolved.indicator.indicator_id,
          claim_id: resolved.claim.claim_id,
          disposition: "resolved",
          evidence_basis: "conversation_evidence",
          evidence_summary:
            "The current student turn independently applies the corrected distinction.",
          evidence_ids: evidenceIds
        },
        {
          identity_version:
            context.allowed_misconception_claim_catalog.identity_version,
          indicator_id: retained.indicator.indicator_id,
          claim_id: retained.claim.claim_id,
          disposition: "retained",
          evidence_basis: "prior_profile_evidence",
          evidence_summary:
            "SEM remains untested and retains its original assessment provenance.",
          evidence_ids: []
        }
      ]
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
  const runner: FormativeConversationV18AgentRunner = {
    identity: {
      agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
      agent_version: "formative-conversation-v18-pipeline-smoke-v1",
      model_name: "no-provider-v18-contract-fixture",
      provider: "mock",
      prompt_version: "formative-conversation-host-v7",
      schema_version: FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
      prompt_hash: createHash("sha256")
        .update("formative-conversation-host-v7")
        .digest("hex"),
      reasoning_effort: null,
      max_output_tokens: 7_000,
      live_call_allowed: false
    },
    async execute({ context }) {
      calls += 1;
      let output: FormativeConversationV18AgentOutput;
      try {
        output =
          context.latest_student_message === null
            ? openingOutput()
            : context.visible_transcript.filter(
                  (turn) => turn.actor === "student"
                ).length >= 2
              ? terminalOutput(context)
              : continueOutput();
      } catch (error) {
        console.error(
          JSON.stringify({
            v18_fixture_generation_error: {
              name: error instanceof Error ? error.name : "unknown",
              message: error instanceof Error ? error.message : "unknown",
              issue_paths:
                error &&
                typeof error === "object" &&
                "issues" in error &&
                Array.isArray(error.issues)
                  ? error.issues.map((entry) =>
                      entry && typeof entry === "object" && "path" in entry
                        ? String(entry.path)
                        : "unknown"
                    )
                  : []
            }
          })
        );
        throw error;
      }
      const startedAt = new Date();
      return {
        output,
        raw_output: { fixture_type: "v18_no_provider_pipeline" },
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
    throw new Error("network_forbidden_in_v18_pipeline_smoke");
  }) as typeof fetch;
  process.env.RESEARCH_PSEUDONYMIZATION_KEY =
    "formative-conversation-v18-pipeline-smoke-key";
  process.env.RESEARCH_PSEUDONYMIZATION_VERSION = "hmac_sha256_v1";
  const runner = createRunner();
  try {
    const result = await runFormativeConversationProtocolValidation({
      mode: "contract_test",
      subjects: [subject()],
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
            operational_agent_mode: "v18_no_provider_test",
            ...(input.metadata ?? {})
          },
          model_config_override: {
            model_name: "v18-no-provider-structured-request"
          }
        })
    });
    assert.equal(result.report.export_validation.status, "passed");
    assert.deepEqual(result.report.architecture_review.issue_codes, []);
    const student = result.report.students[0];
    assert(student?.conversation_public_id);
    if (student.execution_error !== null) {
      const diagnostic =
        await prisma.formativeConversationSession.findUnique({
          where: {
            conversation_public_id: student.conversation_public_id
          },
          include: {
            agent_calls: {
              orderBy: { created_at: "asc" },
              select: {
                agent_name: true,
                call_status: true,
                output_validated: true,
                error_category: true,
                validation_error: true
              }
            },
            conversation_turns: {
              select: { actor_type: true, sequence_index: true }
            },
            message_receipts: {
              select: {
                assistant_response_status: true,
                assistant_response_last_failure_category: true
              }
            }
          }
        });
      console.error(
        JSON.stringify({
          v18_pipeline_diagnostic: {
            execution_error: student.execution_error,
            agent_calls: diagnostic?.agent_calls ?? [],
            turns: diagnostic?.conversation_turns ?? [],
            receipts: diagnostic?.message_receipts ?? []
          }
        })
      );
    }
    assert.equal(student.execution_error, null);
    assert.equal(student.profile_transition_occurred, true);
    assert.equal(student.teacher_trajectory.learning_outcome, "largely_improved");
    assert.equal(student.final_profile_transition?.learning_outcome, "largely_improved");

    const conversation =
      await prisma.formativeConversationSession.findUniqueOrThrow({
        where: { conversation_public_id: student.conversation_public_id },
        include: {
          initial_student_profile: {
            include: { based_on_agent_call: true }
          },
          agent_calls: {
            where: {
              agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
              schema_version: FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION
            },
            orderBy: { created_at: "asc" },
            select: {
              agent_call_public_id: true,
              input_payload: true
            }
          },
          profile_transitions: {
            include: {
              prior_student_profile: true,
              updated_student_profile: true,
              source_turn: true,
              source_agent_call: true,
              supporting_turn_references: {
                include: { conversation_turn: true }
              },
              profile_evidence_references: true
            }
          }
        }
      });
    const initialProfile = conversation.initial_student_profile;
    assert(initialProfile);
    const profilingCall = initialProfile.based_on_agent_call;
    assert(profilingCall);
    assert.equal(profilingCall.schema_version, "student-profile-output-v4");
    assert.equal(profilingCall.prompt_version, "student-profiling-v5");
    assert.equal(profilingCall.call_status, "succeeded");
    assert.equal(profilingCall.output_validated, true);
    const profileOutput = ProductionStudentProfileOutput.parse(
      profilingCall.output_payload
    );
    const providerInput = profilingCall.input_payload as Parameters<
      typeof validateStudentProfileOutputSemantics
    >[0]["providerInput"];
    const semantic = validateStudentProfileOutputSemantics({
      providerInput,
      output: profileOutput
    });
    assert.equal(semantic.ok, true);
    const priorCatalog = parseCanonicalMisconceptionClaimCatalog(
      initialProfile.misconception_indicators
    );
    assert(priorCatalog);
    assert.equal(priorCatalog.indicators[0]?.claims.length, 2);
    const profilingEvidenceCatalog = providerInput?.allowed_evidence_catalog;
    assert(profilingEvidenceCatalog);
    assert(
      profilingEvidenceCatalog.evidence.every(
        (entry) => entry.evidence_stage === "baseline_assessment"
      )
    );
    for (const indicator of priorCatalog.indicators) {
      for (const claim of indicator.claims) {
        assert(claim.source_evidence_refs.length > 0);
        assert(
          claim.source_evidence_refs.every((evidenceId) =>
            profilingEvidenceCatalog.evidence.some(
              (entry) =>
                entry.evidence_id === evidenceId &&
                entry.evidence_stage === "baseline_assessment" &&
                entry.source_role === "student"
            )
          )
        );
      }
    }
    const formativeCallContexts = conversation.agent_calls.map((call) =>
      FormativeConversationV18AgentInputSchema.parse(call.input_payload)
    );
    assert.equal(formativeCallContexts.length, 3);
    const finalCallContext = formativeCallContexts.at(-1);
    assert(finalCallContext);
    const finalEvidenceIds = new Set(
      finalCallContext.allowed_evidence_catalog.evidence.map(
        (entry) => entry.evidence_id
      )
    );
    for (const callContext of formativeCallContexts) {
      assert.equal(
        callContext.allowed_evidence_catalog.evidence_scope_id,
        finalCallContext.allowed_evidence_catalog.evidence_scope_id
      );
      for (const evidence of callContext.allowed_evidence_catalog.evidence) {
        assert(
          finalEvidenceIds.has(evidence.evidence_id),
          "Canonical evidence IDs must survive every later formative context reconstruction."
        );
      }
    }
    const initialClaimEvidenceIds = new Set(
      priorCatalog.indicators.flatMap((indicator) =>
        indicator.claims.flatMap((claim) => claim.source_evidence_refs)
      )
    );
    for (const baselineEvidence of profilingEvidenceCatalog.evidence.filter(
      (entry) => initialClaimEvidenceIds.has(entry.evidence_id)
    )) {
      const reconstructed: CanonicalEvidenceRef | undefined =
        finalCallContext.allowed_evidence_catalog.evidence.find(
          (entry) => entry.evidence_id === baselineEvidence.evidence_id
        );
      assert(reconstructed);
      assert.deepEqual(
        reconstructed,
        baselineEvidence,
        "Initial claim evidence must reconstruct byte-identically in formative context."
      );
    }

    assert.equal(conversation.profile_transitions.length, 1);
    const transition = conversation.profile_transitions[0];
    assert(transition);
    assert(transition.source_turn);
    const snapshot = FormativeConversationV18PersistedProfileSnapshotSchema.parse(
      transition.profile_snapshot
    );
    const updatedProfile = snapshot.profile.canonical_profile;
    assert(updatedProfile);
    assert(
      transition.learning_outcome === "sound" ||
        transition.learning_outcome === "largely_improved" ||
        transition.learning_outcome === "teacher_assistance_recommended"
    );
    const sourceAgentCall = transition.source_agent_call;
    assert(sourceAgentCall);
    const updatedCatalog = parseCanonicalMisconceptionClaimCatalog(
      transition.updated_student_profile.misconception_indicators
    );
    assert(updatedCatalog);
    assert.deepEqual(canonicalMisconceptionClaimTexts(updatedCatalog), [
      "Standard error of measurement identifies an exact true score."
    ]);
    const priorRetainedClaim = priorCatalog.indicators[0]?.claims.find((claim) =>
      /standard error|\bsem\b|exact true score/iu.test(claim.claim_text)
    );
    const updatedRetainedClaim = updatedCatalog.indicators[0]?.claims[0];
    assert(priorRetainedClaim && updatedRetainedClaim);
    assert.deepEqual(updatedRetainedClaim, priorRetainedClaim);
    assert.equal(snapshot.canonical_evidence_ids.length, 1);
    assert.deepEqual(
      snapshot.canonical_evidence_catalog,
      finalCallContext.allowed_evidence_catalog,
      "Transition persistence must retain the exact final canonical evidence catalog."
    );
    const transitionEvidence =
      snapshot.canonical_evidence_catalog.evidence.find(
        (entry) => entry.evidence_id === snapshot.canonical_evidence_ids[0]
      );
    assert.equal(transitionEvidence?.source_role, "student");
    assert.equal(
      transitionEvidence?.evidence_stage,
      "formative_conversation"
    );
    assert(
      (transitionEvidence?.source_sequence_index ?? 0) >
        snapshot.prior_profile_evidence_cutoff_sequence_index
    );
    assert.equal(snapshot.prior_profile_evidence_cutoff_sequence_index, 0);
    assert.equal(
      snapshot.profile.evidence_cutoff_sequence_index,
      transition.source_turn.sequence_index
    );
    assert.equal(
      snapshot.misconception_claim_dispositions.find(
        (entry) => entry.claim_id === updatedRetainedClaim.claim_id
      )?.evidence_ids.length,
      0
    );
    const persistedValidation =
      validatePersistedFormativeConversationV18Transition({
        prior_profile:
          canonicalFormativeConversationProfileStateFromStudentProfile(
            transition.prior_student_profile
          ).canonical_profile,
        prior_misconception_claim_catalog: priorCatalog,
        updated_profile: updatedProfile,
        updated_misconception_claim_catalog: updatedCatalog,
        profile_snapshot: transition.profile_snapshot,
        learning_outcome: transition.learning_outcome,
        evidence_interpretation: transition.evidence_interpretation,
        supporting_turns: transition.supporting_turn_references.map((entry) => ({
          sequence_index: entry.conversation_turn.sequence_index,
          actor:
            entry.conversation_turn.actor_type === "student"
              ? ("student" as const)
              : ("tutor" as const)
        }))
      });
    assert.equal(persistedValidation.valid, true);
    const teacherTransition = student.final_profile_transition;
    assert(teacherTransition);
    const teacherProvenance = teacherTransition.canonical_evidence_provenance as {
      canonical_evidence_ids: string[];
      canonical_evidence: Array<{
        evidence_id: string;
        evidence_scope_id: string;
        evidence_kind: string;
        evidence_stage: string;
        source_role: string;
        source_sequence_index: number | null;
      }>;
      misconception_claim_provenance: Array<{
        indicator_id: string;
        claim_id: string;
        source_evidence_refs: string[];
      }>;
    } | null;
    assert(teacherProvenance);
    assert.deepEqual(
      teacherProvenance.canonical_evidence_ids,
      snapshot.canonical_evidence_ids
    );
    assert.deepEqual(
      teacherProvenance.canonical_evidence,
      snapshot.canonical_evidence_catalog.evidence
        .filter((entry) =>
          snapshot.canonical_evidence_ids.includes(entry.evidence_id)
        )
        .map((entry) => ({
          evidence_id: entry.evidence_id,
          evidence_scope_id: entry.evidence_scope_id,
          evidence_kind: entry.evidence_kind,
          evidence_stage: entry.evidence_stage,
          source_role: entry.source_role,
          source_sequence_index: entry.source_sequence_index
        }))
    );
    assert.deepEqual(teacherProvenance.misconception_claim_provenance, [
      {
        indicator_id: updatedCatalog.indicators[0]?.indicator_id,
        claim_id: priorRetainedClaim.claim_id,
        source_evidence_refs: priorRetainedClaim.source_evidence_refs
      }
    ]);
    for (const evidenceId of priorRetainedClaim.source_evidence_refs) {
      const historicalEvidence =
        snapshot.canonical_evidence_catalog.evidence.find(
          (entry) => entry.evidence_id === evidenceId
        );
      assert(historicalEvidence);
      assert.equal(historicalEvidence.evidence_stage, "baseline_assessment");
    }
    for (const evidenceId of [
      ...snapshot.canonical_evidence_ids,
      ...priorRetainedClaim.source_evidence_refs
    ]) {
      assert(
        result.research_export.buffer.includes(Buffer.from(evidenceId, "utf8")),
        `The research export must preserve canonical evidence ID ${evidenceId}.`
      );
    }

    const persistedRecommendation = {
      recommendation_version:
        FORMATIVE_CONVERSATION_V18_PROFILE_RECOMMENDATION_VERSION,
      recommended: true as const,
      proposed_outcome: "largely_improved_understanding" as const,
      rationale: snapshot.rationale,
      canonical_evidence_ids: snapshot.canonical_evidence_ids,
      updated_profile: snapshot.profile.canonical_profile,
      field_evidence: snapshot.field_evidence,
      misconception_claim_dispositions:
        snapshot.misconception_claim_dispositions
    };
    const resolvedDisposition =
      persistedRecommendation.misconception_claim_dispositions.find(
        (entry) => entry.disposition === "resolved"
      );
    assert(resolvedDisposition);
    const baselineResolutionId =
      priorCatalog.indicators[0]?.claims.find(
        (claim) => claim.claim_id === resolvedDisposition.claim_id
      )?.source_evidence_refs[0];
    assert(baselineResolutionId);
    const baselineOnlyRecommendation = structuredClone(
      persistedRecommendation
    );
    baselineOnlyRecommendation.canonical_evidence_ids = [
      baselineResolutionId
    ];
    baselineOnlyRecommendation.field_evidence.forEach((entry) => {
      if (entry.disposition === "updated_from_conversation_evidence") {
        entry.evidence_ids = [baselineResolutionId];
      }
    });
    baselineOnlyRecommendation.misconception_claim_dispositions.forEach(
      (entry) => {
        if (entry.disposition === "resolved") {
          entry.evidence_ids = [baselineResolutionId];
        }
      }
    );
    const baselineOnlyValidation =
      validateFormativeConversationV18Transition({
        conversation_public_id: student.conversation_public_id,
        prior_profile_evidence_cutoff_sequence_index: 0,
        recommendation: baselineOnlyRecommendation,
        prior_profile:
          canonicalFormativeConversationProfileStateFromStudentProfile(
            transition.prior_student_profile
          ).canonical_profile,
        prior_misconception_claim_catalog: priorCatalog,
        allowed_evidence_catalog: snapshot.canonical_evidence_catalog,
        evidence_observations: snapshot.evidence_observations.map(
          (observation) => ({
            ...observation,
            evidence_ids: [baselineResolutionId]
          })
        )
      });
    assert.equal(baselineOnlyValidation.valid, false);
    assert(
      baselineOnlyValidation.issues.some(
        (entry) =>
          entry.code ===
          FORMATIVE_CONVERSATION_EVIDENCE_ID_ISSUE_CODES.temporal
      )
    );

    const assessmentSession = await prisma.assessmentSession.findUniqueOrThrow({
      where: { session_public_id: student.session_public_id },
      select: { user_db_id: true }
    });
    const replayClientMessageId = `${runPublicId}:fragmented_inconsistent:message:2`;
    const transitionsBeforeReplay =
      await prisma.formativeConversationProfileTransition.count({
        where: {
          formative_conversation_session_db_id: conversation.id
        }
      });
    const callsBeforeReplay = runner.calls();
    const replayContext = await buildFormativeConversationRuntimeContextSeed({
      conversation_public_id: student.conversation_public_id,
      student_user_db_id: assessmentSession.user_db_id
    });
    assert.equal(
      replayContext.current_profile_evidence_cutoff_sequence_index,
      transition.source_turn.sequence_index
    );
    const replayCompiled = await compilePersistedFormativeConversationV18Context({
      conversation_public_id: student.conversation_public_id,
      ...replayContext
    });
    assert.deepEqual(
      replayCompiled.context.allowed_evidence_catalog,
      snapshot.canonical_evidence_catalog,
      "Idempotent replay must reconstruct the persisted canonical evidence catalog byte-for-byte."
    );
    await processFormativeConversationStudentMessage(
      {
        conversation_public_id: student.conversation_public_id,
        client_message_id: replayClientMessageId,
        message_text: subject().conversation_behavior[1].message_text,
        context: replayContext,
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

    assert.equal(sourceAgentCall.output_validated, true);
    assert(transition.supporting_turn_references.length >= 2);
    assert(transition.profile_evidence_references.length > 0);
    assert.equal(networkRequests, 0);
    assert(result.research_export.filename.endsWith(".zip"));
    assert(result.research_export.buffer.length > 0);

    console.log(
      JSON.stringify(
        {
          status: "passed",
          production_profiling_contract_validated: true,
          production_profiling_semantic_validation: semantic.evidence_consistency,
          canonical_claim_assignment: true,
          canonical_evidence_namespace_stable: true,
          partial_resolution_persisted: true,
          retained_claim_id_and_provenance_preserved: true,
          v18_snapshot_revalidation: true,
          idempotent_replay: true,
          duplicate_transition_count: 0,
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
          : "formative_conversation_v18_pipeline_smoke_failed",
      provider_calls: 0,
      model_auth_requests: 0,
      dispatch_checkpoints: 0
    })
  );
  process.exitCode = 1;
});
