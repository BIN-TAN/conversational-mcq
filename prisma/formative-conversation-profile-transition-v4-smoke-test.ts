import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  formativeConversationV5FixtureSources
} from "../src/lib/operational/formative-conversation-v5-evaluation-v5/fixture-source";
import {
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS,
  FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
  FormativeConversationAgentOutputSchema,
  FormativeConversationTranscriptTurnSchema,
  type FormativeConversationAgentOutput,
  type FormativeConversationCanonicalProfile
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import { compileFormativeConversationContext } from "../src/lib/services/student-assessment/formative-conversation/context";
import {
  validateFormativeConversationAgentOutputForContext,
  validateFormativeConversationStudentOutputFormat
} from "../src/lib/services/student-assessment/formative-conversation/output-format";
import {
  canonicalFormativeConversationProfileFromStudentProfile,
  type FormativeConversationCanonicalProfileSource
} from "../src/lib/services/student-assessment/formative-conversation/profile-update";
import { validateFormativeConversationProfileTransition } from "../src/lib/services/student-assessment/formative-conversation/profile-transition-validator";
import {
  FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_VERSION,
  currentMisconceptionClaims
} from "../src/lib/services/student-assessment/formative-conversation/misconception-evidence-closure";

const ReplayArtifactSchema = z
  .object({
    artifact_version: z.literal(
      "formative-conversation-v5-immutable-output-replay-v1"
    ),
    immutable_source: z
      .object({
        frozen_commit: z.literal(
          "3b55bed5ff20831070c5d5ef1b1902aa77527236"
        ),
        provider_run_id: z.literal(
          "fcv5v5_provider_20260730170219_4ac51142"
        ),
        derived_evaluation_id: z.literal(
          "fcv5v5_derived_20260730170219_0a1eb734"
        ),
        case_id: z.enum([
          "fcv5_07_persistent_barrier_teacher_assistance",
          "fcv5_08_mixed_resolved_evidence"
        ])
      })
      .strict(),
    visible_turns: z.array(FormativeConversationTranscriptTurnSchema),
    stored_output: FormativeConversationAgentOutputSchema,
    immutable_v5_output_validation: z.record(z.string(), z.unknown()),
    immutable_v5_transition: z.unknown().nullable()
  })
  .strict();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function replayArtifact(filename: string) {
  return ReplayArtifactSchema.parse(
    JSON.parse(
      readFileSync(
        path.join(
          process.cwd(),
          "config",
          "operational-candidates",
          "formative-conversation-host-v5-executable-v6",
          "regressions",
          filename
        ),
        "utf8"
      )
    )
  );
}

function canonicalProfileSource(
  caseId:
    | "fcv5_07_persistent_barrier_teacher_assistance"
    | "fcv5_08_mixed_resolved_evidence"
): FormativeConversationCanonicalProfileSource {
  const fixture = formativeConversationV5FixtureSources.find(
    (entry) => entry.case_id === caseId
  );
  assert(fixture, `${caseId}:frozen_fixture_missing`);
  const profile = fixture.initial_profile_source.profile;
  return {
    ability_profile: profile.ability_profile,
    ability_pattern_flags: profile.ability_pattern_flags,
    engagement_profile: profile.engagement_profile,
    engagement_pattern_flags: profile.engagement_pattern_flags,
    integrated_diagnostic_profile:
      profile.integrated_diagnostic_profile,
    integrated_profile_confidence:
      profile.integrated_profile_confidence,
    integrated_profile_rationale:
      profile.integrated_profile_rationale,
    evidence_sufficiency: profile.evidence_sufficiency,
    confidence_alignment: profile.confidence_alignment,
    independence_interpretability:
      profile.independence_interpretability,
    misconception_indicators: profile.misconception_indicators,
    item_level_evidence: profile.item_level_evidence,
    reasoning_quality_summary: profile.reasoning_quality_summary,
    engagement_summary: profile.engagement_summary,
    process_interpretation_cautions:
      profile.process_interpretation_cautions,
    profile_confidence: profile.profile_confidence,
    rationale: profile.rationale,
    recommended_next_evidence: profile.recommended_next_evidence
  };
}

function contextForReplay(
  artifact: z.infer<typeof ReplayArtifactSchema>,
  priorProfile: FormativeConversationCanonicalProfile
) {
  const profileEvidence = {
    profile_version: "immutable-v5-prior-profile",
    outcome: "not_yet_determined" as const,
    evidence_summary: ["Frozen synthetic assessment evidence."],
    unresolved_evidence: [...priorProfile.recommended_next_evidence],
    evidence_limitations: [
      ...priorProfile.process_interpretation_cautions
    ],
    canonical_profile: priorProfile,
    field_evidence: []
  };
  const latestStudentMessage =
    [...artifact.visible_turns]
      .reverse()
      .find((turn) => turn.actor === "student")?.message_text ?? null;
  return compileFormativeConversationContext({
    conversation_public_id: `replay:${artifact.immutable_source.case_id}`,
    assessment_public_id: "assessment_immutable_v5_replay",
    concept_unit_public_id: "concept_immutable_v5_replay",
    latest_student_message: latestStudentMessage,
    visible_transcript: artifact.visible_turns,
    administered_items: [],
    assessment_specification: null,
    assessment_response_evidence: [],
    assessment_process_evidence: [],
    initial_profile: profileEvidence,
    current_profile: profileEvidence,
    profile_history: [],
    telemetry_summary: {
      observable_student_turn_count:
        artifact.visible_turns.filter((turn) => turn.actor === "student")
          .length,
      observable_tutor_turn_count:
        artifact.visible_turns.filter((turn) => turn.actor === "tutor")
          .length,
      lifecycle_event_count: 0,
      latest_activity_at: artifact.visible_turns.at(-1)?.created_at ?? null,
      total_input_tokens: 0,
      total_output_tokens: 0
    },
    teacher_guidance: [],
    intervention_history: [],
    memory: null,
    authorized_administered_item_public_ids: []
  }).context;
}

function updatedProfileForOutcome(
  prior: FormativeConversationCanonicalProfile,
  outcome:
    | "sound_understanding"
    | "largely_improved_understanding"
    | "teacher_assistance_recommended"
) {
  const updated = structuredClone(prior);
  if (outcome === "sound_understanding") {
    updated.ability_profile = "robust_transfer_ready_understanding";
    updated.integrated_diagnostic_profile =
      "robust_understanding_ready_for_transfer";
    updated.misconception_indicators = [];
    updated.reasoning_quality_summary =
      "The student independently explained and applied the distinction.";
  } else if (outcome === "largely_improved_understanding") {
    updated.ability_profile = "mostly_correct_understanding";
    updated.integrated_diagnostic_profile =
      "correct_but_fragile_understanding";
    updated.reasoning_quality_summary =
      "The student made meaningful progress while one application limit remains.";
  } else {
    updated.integrated_profile_rationale =
      "Conversation evidence preserves a meaningful unresolved barrier for instructor review.";
    updated.recommended_next_evidence = [
      "Instructor-supported explanation and application."
    ];
  }
  updated.rationale = `Deterministic ${outcome} transition fixture.`;
  return updated;
}

function validTerminalOutput(input: {
  prior: FormativeConversationCanonicalProfile;
  outcome:
    | "sound_understanding"
    | "largely_improved_understanding"
    | "teacher_assistance_recommended";
}) {
  const updated = updatedProfileForOutcome(input.prior, input.outcome);
  const changed = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
    (field) =>
      JSON.stringify(input.prior[field]) !==
      JSON.stringify(updated[field])
  );
  const retained = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
    (field) => !changed.includes(field)
  );
  return FormativeConversationAgentOutputSchema.parse({
    contract_version: "formative-conversation-agent-contract-v1",
    student_visible_message:
      "Let us use that evidence to continue the learning conversation.",
    teaching_artifact: null,
    evidence_observations: [
      {
        evidence_type: "independent_application",
        observation:
          "The student supplied observable evidence relevant to the proposed profile change.",
        source_turn_sequence_indexes: [1]
      }
    ],
    profile_transition_recommendation: {
      recommendation_version:
        FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
      recommended: true,
      proposed_outcome: input.outcome,
      rationale: `Evidence supports ${input.outcome}.`,
      source_turn_sequence_indexes: [1],
      updated_profile: updated,
      field_evidence: [
        {
          profile_fields: changed,
          disposition: "updated_from_conversation_evidence",
          evidence_basis: "conversation_evidence",
          rationale:
            "Changed fields are supported by the cited student evidence.",
          source_turn_sequence_indexes: [1]
        },
        {
          profile_fields: retained,
          disposition: "retained_evidence_remains_valid",
          evidence_basis: "prior_profile_evidence",
          rationale:
            "Retained fields preserve the canonical prior value.",
          source_turn_sequence_indexes: []
        }
      ],
      misconception_claim_closure: changed.includes(
        "misconception_indicators"
      )
        ? currentMisconceptionClaims(input.prior.misconception_indicators).map(
            (priorIndicator) => ({
              closure_version:
                FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_VERSION,
              prior_indicator: priorIndicator,
              coverage: "all_atomic_claims_represented",
              atomic_claims: [
                {
                  claim_text: priorIndicator,
                  disposition: "resolved_by_conversation_evidence",
                  evidence_basis: "conversation_evidence",
                  evidence_summary:
                    "The cited deterministic student fixture resolves this current claim.",
                  source_turn_sequence_indexes: [1]
                }
              ]
            })
          )
        : []
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

function verifyImmutableReplays() {
  const files = [
    "case7-exact-v5-output-replay.json",
    "case8-exact-v5-output-replay.json"
  ];
  for (const filename of files) {
    const artifact = replayArtifact(filename);
    const priorProfile =
      canonicalFormativeConversationProfileFromStudentProfile(
        canonicalProfileSource(artifact.immutable_source.case_id)
      );
    const context = contextForReplay(artifact, priorProfile);
    const validation =
      validateFormativeConversationAgentOutputForContext({
        output: artifact.stored_output,
        context
      });
    assert(
      artifact.immutable_v5_output_validation.status === "passed" &&
        artifact.immutable_v5_transition === null,
      `${artifact.immutable_source.case_id}:immutable_v5_finding_changed`
    );
    assert(
      !validation.valid &&
        validation.issues.some(
          (entry) =>
            entry.code ===
            "profile_transition_retained_field_changed" &&
            entry.field_path.endsWith(
              ".process_interpretation_cautions"
            )
        ),
      `${artifact.immutable_source.case_id}:retained_field_rewrite_not_rejected_at_output_boundary`
    );
    if (
      artifact.immutable_source.case_id ===
      "fcv5_08_mixed_resolved_evidence"
    ) {
      const tableTurn = artifact.visible_turns.find((turn) =>
        turn.message_text.includes("| Concept | Main question |")
      );
      assert(
        tableTurn &&
          validateFormativeConversationStudentOutputFormat(
            tableTurn.message_text
          ).some(
          (entry) =>
            entry.code ===
            "student_output_markdown_table_unsupported"
          ),
        "Case 8 exact output must be rejected for its unsupported Markdown table."
      );
    }
  }
}

function verifyValidTransitionFixtures() {
  const prior =
    canonicalFormativeConversationProfileFromStudentProfile(
      canonicalProfileSource(
        "fcv5_07_persistent_barrier_teacher_assistance"
      )
    );
  for (const outcome of [
    "sound_understanding",
    "largely_improved_understanding",
    "teacher_assistance_recommended"
  ] as const) {
    const output = validTerminalOutput({ prior, outcome });
    const result = validateFormativeConversationProfileTransition({
      recommendation: output.profile_transition_recommendation,
      prior_profile: prior,
      evidence_observations: output.evidence_observations,
      available_turns: [{ sequence_index: 1, actor: "student" }]
    });
    assert(
      result.valid && result.terminal,
      `${outcome}:valid_transition_fixture_rejected`
    );
  }

  const continueOutput: FormativeConversationAgentOutput =
    FormativeConversationAgentOutputSchema.parse({
      contract_version: "formative-conversation-agent-contract-v1",
      student_visible_message:
        "That is useful evidence, and we can keep exploring the distinction.",
      teaching_artifact: null,
      evidence_observations: [
        {
          evidence_type: "mixed_resolved_evidence",
          observation:
            "The student expressed a supported dominant interpretation while retaining a question.",
          source_turn_sequence_indexes: [1]
        }
      ],
      profile_transition_recommendation: {
        recommendation_version:
          FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
        recommended: false,
        proposed_outcome: "continue_conversation",
        rationale:
          "The evidence is useful but does not require a terminal transition.",
        source_turn_sequence_indexes: [],
        updated_profile: null,
        field_evidence: []
      },
      teacher_assistance_recommendation: {
        recommended: false,
        reason_code: null
      },
      lifecycle_recommendation: "continue"
    });
  const continueResult = validateFormativeConversationProfileTransition({
    recommendation:
      continueOutput.profile_transition_recommendation,
    prior_profile: prior,
    evidence_observations: continueOutput.evidence_observations,
    available_turns: [{ sequence_index: 1, actor: "student" }]
  });
  assert(
    continueResult.valid &&
      !continueResult.terminal &&
      continueResult.updated_profile === null,
    "mixed_resolved_continue_conversation_fixture_invalid"
  );
}

function main() {
  verifyImmutableReplays();
  verifyValidTransitionFixtures();
  console.log(
    JSON.stringify(
      {
        status: "passed",
        provider_calls: 0,
        network_requests: 0,
        exact_v5_replays: 2,
        exact_v5_replay_result:
          "rejected_at_shared_output_validation",
        successful_terminal_fixtures: [
          "sound",
          "largely_improved",
          "teacher_assistance_recommended"
        ],
        successful_nonterminal_fixtures: [
          "mixed_resolved_continue_conversation"
        ]
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code:
        error instanceof Error
          ? error.message
          : "formative_conversation_profile_transition_v4_smoke_failed",
      provider_calls: 0,
      network_requests: 0
    })
  );
  process.exitCode = 1;
}
