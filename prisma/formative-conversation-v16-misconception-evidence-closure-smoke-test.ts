import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zodTextFormat } from "openai/helpers/zod";
import { StudentProfileOutput } from "../src/lib/agents/contracts";
import {
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS,
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_VERSION,
  FormativeConversationAgentOutputSchema,
  type FormativeConversationCanonicalProfile
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_VERSION,
  FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_ISSUE_CODES,
  type FormativeConversationMisconceptionIndicatorClosure
} from "../src/lib/services/student-assessment/formative-conversation/misconception-evidence-closure";
import {
  canonicalFormativeConversationProfileFromStudentProfile,
  type FormativeConversationCanonicalProfileSource
} from "../src/lib/services/student-assessment/formative-conversation/profile-update";
import {
  FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VALIDATOR_VERSION,
  validateFormativeConversationProfileTransition
} from "../src/lib/services/student-assessment/formative-conversation/profile-transition-validator";

const V15_FIXTURE_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v15/fixtures";

type V15ReplayCase = {
  case_id: string;
  initial_profile_source: {
    profile: unknown;
  };
};

function baseProfile(
  misconceptionIndicators: string[]
): FormativeConversationCanonicalProfile {
  return {
    schema_version: FORMATIVE_CONVERSATION_CANONICAL_PROFILE_VERSION,
    ability_profile: "misconception_based_understanding",
    ability_pattern_flags: ["misconception_indicator_present"],
    engagement_profile: "adequate_engagement",
    engagement_pattern_flags: ["no_clear_pattern"],
    integrated_diagnostic_profile:
      "misconception_with_sufficient_engagement",
    integrated_profile_confidence: "medium",
    integrated_profile_rationale:
      "Assessment evidence supports a current misconception.",
    evidence_sufficiency: "adequate",
    confidence_alignment: "mixed",
    independence_interpretability:
      "independent_understanding_uncertain",
    misconception_indicators: misconceptionIndicators,
    item_level_evidence: ["Administered assessment evidence."],
    reasoning_quality_summary:
      "The reasoning contains a current misconception.",
    engagement_summary: "The student supplied observable responses.",
    process_interpretation_cautions: [
      "Process observations are not interpreted as learner traits."
    ],
    profile_confidence: "medium",
    rationale: "The profile is grounded in administered evidence.",
    recommended_next_evidence: [
      "Elicit an independent explanation in conversation."
    ]
  };
}

function canonicalV15PriorProfile(filename: string) {
  const fixture = JSON.parse(
    readFileSync(`${V15_FIXTURE_ROOT}/${filename}`, "utf8")
  ) as V15ReplayCase;
  const profile = StudentProfileOutput.parse(
    fixture.initial_profile_source.profile
  );
  const source: FormativeConversationCanonicalProfileSource = {
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
  return {
    case_id: fixture.case_id,
    profile: canonicalFormativeConversationProfileFromStudentProfile(source)
  };
}

function outputFor(input: {
  prior: FormativeConversationCanonicalProfile;
  updated: FormativeConversationCanonicalProfile;
  sourceTurnIndexes: number[];
  misconceptionClaimClosure?: FormativeConversationMisconceptionIndicatorClosure[];
}) {
  const changed = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
    (field) =>
      JSON.stringify(input.prior[field]) !==
      JSON.stringify(input.updated[field])
  );
  const retained = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
    (field) => !changed.includes(field)
  );
  return FormativeConversationAgentOutputSchema.parse({
    contract_version: "formative-conversation-agent-contract-v1",
    student_visible_message:
      "Your explanation shows meaningful progress, and one related claim still needs examination.",
    teaching_artifact: null,
    evidence_observations: [
      {
        evidence_type: "conceptual_revision",
        observation:
          "The student supplied an independent correction for the cited claims.",
        source_turn_sequence_indexes: input.sourceTurnIndexes
      }
    ],
    profile_transition_recommendation: {
      recommendation_version:
        "formative-conversation-profile-recommendation-v2",
      recommended: true,
      proposed_outcome: "largely_improved_understanding",
      rationale:
        "The cited conversation evidence resolves part of the prior misconception while preserving the unresolved claim.",
      source_turn_sequence_indexes: input.sourceTurnIndexes,
      updated_profile: input.updated,
      field_evidence: [
        ...(changed.length === 0
          ? []
          : [
              {
                profile_fields: changed,
                disposition: "updated_from_conversation_evidence",
                evidence_basis: "combined",
                rationale:
                  "The cited student explanation supports these updates.",
                source_turn_sequence_indexes: input.sourceTurnIndexes
              }
            ]),
        ...(retained.length === 0
          ? []
          : [
              {
                profile_fields: retained,
                disposition: "retained_evidence_remains_valid",
                evidence_basis: "prior_profile_evidence",
                rationale:
                  "The prior evidence for these unchanged fields remains valid.",
                source_turn_sequence_indexes: []
              }
            ])
      ],
      misconception_claim_closure: input.misconceptionClaimClosure
    },
    teacher_assistance_recommendation: {
      recommended: false,
      reason_code: null
    },
    lifecycle_recommendation: "continue"
  });
}

function validate(input: {
  prior: FormativeConversationCanonicalProfile;
  updated: FormativeConversationCanonicalProfile;
  sourceTurnIndexes: number[];
  misconceptionClaimClosure?: FormativeConversationMisconceptionIndicatorClosure[];
}) {
  const output = outputFor(input);
  return validateFormativeConversationProfileTransition({
    recommendation: output.profile_transition_recommendation,
    prior_profile: input.prior,
    evidence_observations: output.evidence_observations,
    available_turns: input.sourceTurnIndexes.map((sequenceIndex) => ({
      sequence_index: sequenceIndex,
      actor: "student" as const
    }))
  });
}

function closure(input: {
  priorIndicator: string;
  resolvedClaims: Array<{ claim: string; turn: number }>;
  retainedClaims: string[];
}): FormativeConversationMisconceptionIndicatorClosure[] {
  return [
    {
      closure_version:
        FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_VERSION,
      prior_indicator: input.priorIndicator,
      coverage: "all_atomic_claims_represented",
      atomic_claims: [
        ...input.resolvedClaims.map(({ claim, turn }) => ({
          claim_text: claim,
          disposition: "resolved_by_conversation_evidence" as const,
          evidence_basis: "combined" as const,
          evidence_summary:
            "The cited student turn independently rejects this claim.",
          source_turn_sequence_indexes: [turn]
        })),
        ...input.retainedClaims.map((claim) => ({
          claim_text: claim,
          disposition: "retained_current_misconception" as const,
          evidence_basis: "prior_profile_evidence" as const,
          evidence_summary:
            "No conversation evidence resolves this prior claim.",
          source_turn_sequence_indexes: []
        }))
      ]
    }
  ];
}

function correctedLargelyImprovedProfile(
  prior: FormativeConversationCanonicalProfile,
  residualMisconception: string
) {
  const updated = structuredClone(prior);
  updated.ability_profile = "mostly_correct_understanding";
  updated.integrated_diagnostic_profile =
    "developing_understanding_with_productive_engagement";
  updated.integrated_profile_rationale =
    "Conversation evidence resolves the reliability-validity claim while SEM score exactness remains a current misconception.";
  updated.misconception_indicators = [residualMisconception];
  updated.reasoning_quality_summary =
    "The student correctly applies the reliability-validity distinction; SEM score exactness remains unresolved.";
  updated.rationale =
    "The profile represents meaningful improvement without erasing the unresolved SEM claim.";
  updated.recommended_next_evidence = [
    "Ask the student to explain what SEM does and does not establish about an observed score."
  ];
  return updated;
}

function directRegressionCases() {
  const single = "Reliability proves validity.";
  const singlePrior = baseProfile([single]);
  const singleUpdated = structuredClone(singlePrior);
  singleUpdated.misconception_indicators = [];
  assert.equal(
    validate({
      prior: singlePrior,
      updated: singleUpdated,
      sourceTurnIndexes: [101],
      misconceptionClaimClosure: closure({
        priorIndicator: single,
        resolvedClaims: [{ claim: single, turn: 101 }],
        retainedClaims: []
      })
    }).valid,
    true,
    "A fully resolved single misconception should pass."
  );

  const compound =
    "Reliability proves validity; SEM gives an exact true score.";
  const reliabilityClaim = "Reliability proves validity.";
  const semClaim = "SEM gives an exact true score.";
  const compoundPrior = baseProfile([compound]);
  const partialUpdated = structuredClone(compoundPrior);
  partialUpdated.misconception_indicators = [semClaim];
  const partialClosure = closure({
    priorIndicator: compound,
    resolvedClaims: [{ claim: reliabilityClaim, turn: 201 }],
    retainedClaims: [semClaim]
  });
  assert.equal(
    validate({
      prior: compoundPrior,
      updated: partialUpdated,
      sourceTurnIndexes: [201],
      misconceptionClaimClosure: partialClosure
    }).valid,
    true,
    "A compound misconception may be partially resolved when the residual claim remains current."
  );

  const removedAfterPartial = structuredClone(compoundPrior);
  removedAfterPartial.misconception_indicators = [];
  const partialRemoval = validate({
    prior: compoundPrior,
    updated: removedAfterPartial,
    sourceTurnIndexes: [201],
    misconceptionClaimClosure: partialClosure
  });
  assert.equal(partialRemoval.valid, false);
  if (partialRemoval.valid) {
    throw new Error("compound_partial_removal_unexpectedly_valid");
  }
  assert(
    partialRemoval.issues.some(
      (entry) =>
        entry.code ===
        FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_ISSUE_CODES.retainedMissing
    )
  );

  const semPrior = baseProfile([semClaim]);
  const semRemoved = structuredClone(semPrior);
  semRemoved.misconception_indicators = [];
  const semRemoval = validate({
    prior: semPrior,
    updated: semRemoved,
    sourceTurnIndexes: [301],
    misconceptionClaimClosure: closure({
      priorIndicator: semClaim,
      resolvedClaims: [],
      retainedClaims: [semClaim]
    })
  });
  assert.equal(semRemoval.valid, false);
  if (semRemoval.valid) {
    throw new Error("sem_partial_removal_unexpectedly_valid");
  }
  assert(
    semRemoval.issues.some(
      (entry) =>
        entry.code ===
        FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_ISSUE_CODES.retainedMissing
    )
  );

  const limitationUpdated = structuredClone(compoundPrior);
  limitationUpdated.misconception_indicators = [
    "SEM understanding remains untested."
  ];
  const limitationResult = validate({
    prior: compoundPrior,
    updated: limitationUpdated,
    sourceTurnIndexes: [201],
    misconceptionClaimClosure: closure({
      priorIndicator: compound,
      resolvedClaims: [{ claim: reliabilityClaim, turn: 201 }],
      retainedClaims: ["SEM understanding remains untested."]
    })
  });
  assert.equal(limitationResult.valid, false);
  if (limitationResult.valid) {
    throw new Error("limitation_as_misconception_unexpectedly_valid");
  }
  assert(
    limitationResult.issues.some(
      (entry) =>
        entry.code ===
          FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_ISSUE_CODES.retainedSemanticsInvalid ||
        entry.code ===
          "profile_transition_misconception_field_semantics_invalid"
    )
  );
}

function replayV15Cases() {
  const cases = [
    {
      filename: "fcv5_05_sound_profile_transition.json",
      expectedCaseId: "fcv5_05_sound_profile_transition",
      evidenceTurn: 823,
      resolvedClaims: [
        "Reliability is treated as proof of validity.",
        "Validity is treated as context-independent."
      ],
      residualClaim: "SEM is treated as revealing an exact true score."
    },
    {
      filename: "fcv5_06_largely_improved_temporal.json",
      expectedCaseId: "fcv5_06_largely_improved_temporal",
      evidenceTurn: 828,
      resolvedClaims: ["Reliability is treated as proof of validity."],
      residualClaim: "SEM is treated as revealing an exact true score."
    }
  ] as const;

  return cases.map((replayCase) => {
    const loaded = canonicalV15PriorProfile(replayCase.filename);
    assert.equal(loaded.case_id, replayCase.expectedCaseId);
    const priorIndicator =
      loaded.profile.misconception_indicators.find((entry) =>
        entry.startsWith("indicator:")
      )?.slice("indicator:".length).trim() ??
      loaded.profile.misconception_indicators[0];
    assert(priorIndicator, `${loaded.case_id}:prior_indicator_missing`);

    const v15Updated = correctedLargelyImprovedProfile(
      loaded.profile,
      replayCase.residualClaim
    );
    v15Updated.misconception_indicators = [];
    const v15Boundary = validate({
      prior: loaded.profile,
      updated: v15Updated,
      sourceTurnIndexes: [replayCase.evidenceTurn]
    });
    assert.equal(v15Boundary.valid, false);
    if (v15Boundary.valid) {
      throw new Error(`${loaded.case_id}:v15_boundary_unexpectedly_valid`);
    }
    assert(
      v15Boundary.issues.some(
        (entry) =>
          entry.code ===
          FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_ISSUE_CODES.missing
      )
    );

    const corrected = correctedLargelyImprovedProfile(
      loaded.profile,
      replayCase.residualClaim
    );
    const claimClosure = closure({
      priorIndicator,
      resolvedClaims: replayCase.resolvedClaims.map((claim) => ({
        claim,
        turn: replayCase.evidenceTurn
      })),
      retainedClaims: [replayCase.residualClaim]
    });
    const first = validate({
      prior: loaded.profile,
      updated: corrected,
      sourceTurnIndexes: [replayCase.evidenceTurn],
      misconceptionClaimClosure: claimClosure
    });
    const replay = validate({
      prior: loaded.profile,
      updated: corrected,
      sourceTurnIndexes: [replayCase.evidenceTurn],
      misconceptionClaimClosure: claimClosure
    });
    assert.equal(first.valid, true);
    assert.deepEqual(replay, first);
    assert.equal(
      outputFor({
        prior: loaded.profile,
        updated: corrected,
        sourceTurnIndexes: [replayCase.evidenceTurn],
        misconceptionClaimClosure: claimClosure
      }).profile_transition_recommendation?.proposed_outcome,
      "largely_improved_understanding"
    );
    assert.deepEqual(corrected.misconception_indicators, [
      replayCase.residualClaim
    ]);
    return {
      case_id: loaded.case_id,
      original_empty_field_rejected: true,
      corrected_outcome: "largely_improved_understanding",
      retained_current_misconception: replayCase.residualClaim,
      deterministic_replay_idempotent: true
    };
  });
}

function main() {
  const structuredOutputFormat = zodTextFormat(
    FormativeConversationAgentOutputSchema,
    "formative-conversation-agent-contract-v1"
  );
  assert.equal(structuredOutputFormat.type, "json_schema");
  assert.equal(structuredOutputFormat.strict, true);
  directRegressionCases();
  const v15Replay = replayV15Cases();
  console.log(
    JSON.stringify(
      {
        status: "passed",
        validator_version:
          FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VALIDATOR_VERSION,
        closure_version:
          FORMATIVE_CONVERSATION_MISCONCEPTION_EVIDENCE_CLOSURE_VERSION,
        single_misconception_fully_resolved: "accepted",
        compound_partial_resolution_with_residual: "accepted",
        compound_partial_resolution_without_residual: "rejected",
        sem_limitation_removed_without_evidence: "rejected",
        limitation_not_converted_to_misconception: "rejected",
        strict_responses_schema_compilation: "passed",
        v15_offline_replay: v15Replay,
        provider_calls: 0,
        model_auth_requests: 0,
        network_requests: 0,
        dispatch_checkpoints: 0
      },
      null,
      2
    )
  );
}

main();
