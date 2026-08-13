import type {
  AgentInputByName,
  AgentOutputByName
} from "../src/lib/agents/contracts";
import {
  STUDENT_PROFILE_EVIDENCE_CONSISTENCY_VERSION,
  validateStudentProfileOutputSemantics
} from "../src/lib/agents/student-profiling/semantic-validation";

process.env.DATABASE_URL ??=
  "postgresql://local-smoke:local-smoke@127.0.0.1:5432/local-smoke";
process.env.SESSION_SECRET ??=
  "local-student-profiling-semantic-validation-smoke-secret";

type ProfileInput = AgentInputByName["student_profiling_agent"];
type ProfileOutput = AgentOutputByName["student_profiling_agent"];
type ItemFixture = {
  item_public_id: string;
  correctness: "correct" | "incorrect";
  reasoning_text: string;
  confidence_rating: "low" | "medium" | "high";
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function items(
  correctness: Array<"correct" | "incorrect">
): ItemFixture[] {
  return correctness.map((value, index) => ({
    item_public_id: `semantic_profile_item_${index + 1}`,
    correctness: value,
    reasoning_text:
      value === "correct"
        ? "The response distinguishes the relevant concepts."
        : "The response applies the same unsupported interpretation.",
    confidence_rating: index === 1 ? "medium" : "high"
  }));
}

function responsePackage(itemFixtures: ItemFixture[]) {
  return {
    package_type: "initial_concept_unit_response_package",
    payload: {
      item_responses: itemFixtures,
      process_counts: {
        answer_revision_count: 1,
        page_hidden_count: 1
      }
    },
    process_events: [
      {
        event_type: "answer_selected",
        event_category: "response",
        event_source: "student",
        occurred_at: "2026-07-29T00:00:00.000Z"
      }
    ]
  };
}

function profileInput(input: {
  initial: ItemFixture[];
  followup?: ItemFixture[];
}): ProfileInput {
  return {
    concept_unit_metadata: {
      concept_unit_public_id: "semantic_profile_concept"
    },
    initial_response_package: responsePackage(input.initial),
    previous_profile: input.followup
      ? {
          profile_public_id: "semantic_previous_profile"
        }
      : null,
    followup_evidence_package: input.followup
      ? responsePackage(input.followup)
      : null,
    profile_type: input.followup ? "updated" : "initial",
    profiling_constraints: {
      conservative_inference_required: true
    }
  };
}

function profileOutput(input: {
  itemFixtures: ItemFixture[];
  overrides?: Partial<ProfileOutput>;
}): ProfileOutput {
  return {
    agent_name: "student_profiling_agent",
    agent_version: "semantic-validation-smoke",
    prompt_version: "student-profiling-v3",
    schema_version: "student-profile-output-v2",
    output_status: "ok",
    warnings: [],
    profile_type: "initial",
    ability_profile: "misconception_based_understanding",
    ability_pattern_flags: [
      "misconception_indicator_present",
      "distractor_aligned_reasoning"
    ],
    engagement_profile: "adequate_engagement",
    engagement_pattern_flags: ["repeated_revision_present"],
    integrated_diagnostic_profile: "misconception_with_sufficient_engagement",
    integrated_profile_confidence: "medium",
    integrated_profile_rationale:
      "Observed responses support a repeated interpretation. The diagnostic inference is a misconception pattern, with uncertainty limited to its breadth.",
    evidence_sufficiency: "adequate",
    confidence_alignment: "mixed",
    independence_interpretability: "independent_understanding_likely",
    misconception_indicators: [
      {
        indicator: "The same unsupported interpretation appears across responses.",
        evidence_reference: input.itemFixtures[0]?.item_public_id ?? null,
        confidence: "medium",
        rationale: "The response reasoning applies the same interpretation.",
        atomic_claims: [
          {
            claim_text:
              "The unsupported interpretation is treated as sufficient across the cited responses.",
            source_evidence_references: [
              input.itemFixtures[0]?.item_public_id ??
                "semantic_profile_item_unavailable"
            ]
          }
        ]
      }
    ],
    item_level_evidence: input.itemFixtures.map((item) => ({
      item_public_id: item.item_public_id,
      evidence_summary: `The recorded response was ${item.correctness}.`,
      correctness: item.correctness,
      reasoning_quality: "The reasoning provides observable evidence.",
      confidence_rating: item.confidence_rating
    })),
    reasoning_quality_summary:
      "Observed reasoning supports a specific interpretation rather than a global evidence conflict.",
    engagement_summary:
      "Observed responses include reasoning and confidence for each administered item.",
    process_interpretation_cautions: [
      "Process data provide context only and do not establish motivation or misconduct."
    ],
    profile_confidence: "medium",
    rationale:
      "Observed evidence supports the diagnostic inference. Recommended next evidence should test the interpretation in another context.",
    recommended_next_evidence: [
      {
        evidence_type: "related_context_reasoning",
        reason: "Recommended next evidence should test the interpretation.",
        item_public_id: input.itemFixtures[0]?.item_public_id ?? null
      }
    ],
    ...input.overrides
  };
}

function expectValid(input: {
  caseId: string;
  providerInput: ProfileInput;
  output: ProfileOutput;
  classification: "coherent" | "mixed_resolved" | "mixed_unresolved";
}) {
  const result = validateStudentProfileOutputSemantics({
    providerInput: input.providerInput,
    output: input.output
  });
  assert(result.ok, `${input.caseId} should pass: ${result.issues.join("; ")}`);
  assert(
    result.evidence_consistency.version ===
      STUDENT_PROFILE_EVIDENCE_CONSISTENCY_VERSION,
    `${input.caseId} should expose the versioned evidence consistency result.`
  );
  assert(
    result.evidence_consistency.classification === input.classification,
    `${input.caseId} expected ${input.classification}, received ${result.evidence_consistency.classification}.`
  );
  return result;
}

function expectInvalid(input: {
  caseId: string;
  providerInput: ProfileInput;
  output: ProfileOutput;
  issueFragment: string;
}) {
  const result = validateStudentProfileOutputSemantics({
    providerInput: input.providerInput,
    output: input.output
  });
  assert(!result.ok, `${input.caseId} should fail.`);
  assert(
    result.issues.some((issue) => issue.includes(input.issueFragment)),
    `${input.caseId} should include issue fragment "${input.issueFragment}": ${result.issues.join("; ")}`
  );
}

function main() {
  const fragmentedItems = items(["correct", "incorrect", "incorrect"]);
  const fragmented = expectValid({
    caseId: "fragmented_inconsistent_offline_replay",
    providerInput: profileInput({ initial: fragmentedItems }),
    output: profileOutput({
      itemFixtures: fragmentedItems,
      overrides: {
        process_interpretation_cautions: [
          "The mixed evidence is local to item performance; repeated reasoning supports a dominant misconception interpretation."
        ]
      }
    }),
    classification: "mixed_resolved"
  });
  assert(
    fragmented.warnings.some((warning) =>
      warning.includes("Narrative conflict language")
    ),
    "Fragmented replay should retain lexical conflict language as a warning."
  );
  assert(
    ["item_response", "reasoning", "confidence", "process"].every((dimension) =>
      fragmented.evidence_consistency.observable_evidence_dimensions.includes(
        dimension as
          | "item_response"
          | "reasoning"
          | "confidence"
          | "process"
          | "followup"
      )
    ),
    "Evidence consistency should inspect response, reasoning, confidence, and process evidence."
  );

  const suddenImprovementItems = items(["incorrect", "incorrect", "incorrect"]);
  const suddenImprovement = expectValid({
    caseId: "sudden_improvement_offline_replay",
    providerInput: profileInput({ initial: suddenImprovementItems }),
    output: profileOutput({
      itemFixtures: suddenImprovementItems,
      overrides: {
        integrated_profile_rationale:
          "Observed responses support one interpretation. The evidence is not conflicting, and the diagnostic inference remains evidence bounded."
      }
    }),
    classification: "coherent"
  });
  assert(
    suddenImprovement.warnings.some((warning) =>
      warning.includes("Narrative conflict language")
    ),
    "Negated conflict language should be a warning rather than a terminal rejection."
  );

  const persistentItems = items(["incorrect", "incorrect", "incorrect"]);
  const persistentOutput = profileOutput({ itemFixtures: persistentItems });
  persistentOutput.item_level_evidence[1] = {
    ...persistentOutput.item_level_evidence[1],
    reasoning_quality:
      "A local statement is contradictory, while the repeated misconception remains coherent across the package."
  };
  expectValid({
    caseId: "persistent_non_improvement_offline_replay",
    providerInput: profileInput({ initial: persistentItems }),
    output: persistentOutput,
    classification: "coherent"
  });

  const unresolvedItems = items(["correct", "incorrect", "correct"]);
  expectValid({
    caseId: "true_unresolved_conflict",
    providerInput: profileInput({ initial: unresolvedItems }),
    output: profileOutput({
      itemFixtures: unresolvedItems,
      overrides: {
        ability_profile: "partial_understanding",
        ability_pattern_flags: [
          "correctness_reasoning_mismatch",
          "confidence_reasoning_mismatch"
        ],
        integrated_diagnostic_profile:
          "conflicting_evidence_needs_clarification",
        integrated_profile_confidence: "low",
        integrated_profile_rationale:
          "Observed item correctness, reasoning, and confidence point in different directions. No stronger inference is supported.",
        misconception_indicators: [],
        profile_confidence: "low"
      }
    }),
    classification: "mixed_unresolved"
  });

  const negatedItems = items(["incorrect", "incorrect", "incorrect"]);
  expectValid({
    caseId: "negated_conflict_language",
    providerInput: profileInput({ initial: negatedItems }),
    output: profileOutput({
      itemFixtures: negatedItems,
      overrides: {
        rationale:
          "Observed evidence is not contradictory. The diagnostic inference is supported, and recommended next evidence should test its scope."
      }
    }),
    classification: "coherent"
  });

  const localContradictionOutput = profileOutput({
    itemFixtures: negatedItems
  });
  localContradictionOutput.item_level_evidence[0] = {
    ...localContradictionOutput.item_level_evidence[0],
    evidence_summary:
      "The student's sentence contains a local contradiction, but the package-level pattern remains interpretable."
  };
  expectValid({
    caseId: "local_contradiction",
    providerInput: profileInput({ initial: negatedItems }),
    output: localContradictionOutput,
    classification: "coherent"
  });

  expectValid({
    caseId: "dominant_evidence_pattern",
    providerInput: profileInput({ initial: fragmentedItems }),
    output: profileOutput({ itemFixtures: fragmentedItems }),
    classification: "mixed_resolved"
  });

  const followupItems = items(["correct", "correct", "correct"]);
  const temporalChange = expectValid({
    caseId: "temporal_learning_change",
    providerInput: profileInput({
      initial: suddenImprovementItems,
      followup: followupItems
    }),
    output: profileOutput({
      itemFixtures: followupItems,
      overrides: {
        profile_type: "updated",
        ability_profile: "mostly_correct_understanding",
        ability_pattern_flags: ["correct_answer_weak_reasoning"],
        integrated_diagnostic_profile:
          "developing_understanding_with_productive_engagement",
        misconception_indicators: [],
        integrated_profile_rationale:
          "Observed later evidence differs from earlier evidence and supports an updated interpretation. Recommended next evidence should test stability."
      }
    }),
    classification: "mixed_resolved"
  });
  assert(
    temporalChange.evidence_consistency.temporal_change_detected,
    "Earlier and later evidence should be represented as temporal learning change, not simultaneous unresolved conflict."
  );

  expectInvalid({
    caseId: "unsupported_unresolved_conflict",
    providerInput: profileInput({ initial: persistentItems }),
    output: profileOutput({
      itemFixtures: persistentItems,
      overrides: {
        integrated_diagnostic_profile:
          "conflicting_evidence_needs_clarification",
        integrated_profile_confidence: "low",
        misconception_indicators: []
      }
    }),
    issueFragment:
      "conflicting_evidence_needs_clarification requires grounded structured conflict evidence"
  });

  const inventedEvidenceOutput = profileOutput({
    itemFixtures: persistentItems
  });
  inventedEvidenceOutput.item_level_evidence[0] = {
    ...inventedEvidenceOutput.item_level_evidence[0],
    item_public_id: "invented_item"
  };
  expectInvalid({
    caseId: "invented_evidence_reference",
    providerInput: profileInput({ initial: persistentItems }),
    output: inventedEvidenceOutput,
    issueFragment: "references unprovided item invented_item"
  });

  expectInvalid({
    caseId: "unsupported_certainty",
    providerInput: profileInput({ initial: persistentItems }),
    output: profileOutput({
      itemFixtures: persistentItems,
      overrides: {
        evidence_sufficiency: "limited",
        rationale:
          "Observed evidence definitely proves the cause. Recommended next evidence is unnecessary."
      }
    }),
    issueFragment: "must not state unsupported causes with certainty"
  });

  expectInvalid({
    caseId: "mutually_exclusive_pattern_states",
    providerInput: profileInput({ initial: persistentItems }),
    output: profileOutput({
      itemFixtures: persistentItems,
      overrides: {
        ability_pattern_flags: [
          "no_clear_pattern",
          "misconception_indicator_present"
        ]
      }
    }),
    issueFragment: "must not combine no_clear_pattern"
  });

  expectInvalid({
    caseId: "unsupported_transfer_claim",
    providerInput: profileInput({ initial: persistentItems }),
    output: profileOutput({
      itemFixtures: persistentItems,
      overrides: {
        ability_profile: "partial_understanding",
        ability_pattern_flags: ["transfer_ready"],
        integrated_diagnostic_profile:
          "developing_understanding_with_productive_engagement",
        integrated_profile_rationale:
          "Observed reasoning is limited to the administered items. Recommended next evidence should examine another task.",
        reasoning_quality_summary:
          "Reasoning is limited to the administered item context.",
        misconception_indicators: []
      }
    }),
    issueFragment: "transfer_ready requires explicit transfer evidence"
  });

  const missingAtomicClaims = profileOutput({ itemFixtures: persistentItems });
  missingAtomicClaims.misconception_indicators[0] = {
    ...missingAtomicClaims.misconception_indicators[0],
    atomic_claims: undefined
  };
  expectInvalid({
    caseId: "missing_atomic_misconception_claims",
    providerInput: profileInput({ initial: persistentItems }),
    output: missingAtomicClaims,
    issueFragment: "requires validated atomic_claims before persistence"
  });

  const metadataPseudoClaim = profileOutput({ itemFixtures: persistentItems });
  metadataPseudoClaim.misconception_indicators[0] = {
    ...metadataPseudoClaim.misconception_indicators[0],
    atomic_claims: [
      {
        claim_text: "Confidence: medium",
        source_evidence_references: [persistentItems[0].item_public_id]
      }
    ]
  };
  expectInvalid({
    caseId: "metadata_is_not_atomic_misconception_claim",
    providerInput: profileInput({ initial: persistentItems }),
    output: metadataPseudoClaim,
    issueFragment: "contains profile metadata instead of a misconception claim"
  });

  const ungroundedAtomicClaim = profileOutput({ itemFixtures: persistentItems });
  ungroundedAtomicClaim.misconception_indicators[0] = {
    ...ungroundedAtomicClaim.misconception_indicators[0],
    atomic_claims: [
      {
        claim_text: "The unsupported interpretation is sufficient.",
        source_evidence_references: ["invented_atomic_claim_evidence"]
      }
    ]
  };
  expectInvalid({
    caseId: "ungrounded_atomic_claim_evidence",
    providerInput: profileInput({ initial: persistentItems }),
    output: ungroundedAtomicClaim,
    issueFragment:
      "references evidence outside the eligible baseline assessment catalog"
  });

  const duplicateAtomicClaim = profileOutput({ itemFixtures: persistentItems });
  const originalAtomicClaim =
    duplicateAtomicClaim.misconception_indicators[0].atomic_claims?.[0];
  if (!originalAtomicClaim) {
    throw new Error("atomic_claim_fixture_missing");
  }
  duplicateAtomicClaim.misconception_indicators[0] = {
    ...duplicateAtomicClaim.misconception_indicators[0],
    atomic_claims: [originalAtomicClaim, structuredClone(originalAtomicClaim)]
  };
  expectInvalid({
    caseId: "duplicate_atomic_misconception_claim",
    providerInput: profileInput({ initial: persistentItems }),
    output: duplicateAtomicClaim,
    issueFragment: "duplicates a prior atomic claim"
  });

  console.log(
    "Student profiling semantic validation smoke passed: evidence consistency and V17 atomic misconception claims validated offline; no OpenAI call was made."
  );
}

main();
