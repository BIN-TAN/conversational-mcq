import assert from "node:assert/strict";
import {
  createCanonicalMisconceptionClaimCatalog,
  emptyCanonicalMisconceptionClaimCatalog,
  MISCONCEPTION_CLAIM_IDENTITY_VERSION,
  requireCanonicalMisconceptionClaimCatalog
} from "../src/lib/domain/misconception-claim-identity";
import type { StructuredAgentRequest } from "../src/lib/llm/providers/types";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS,
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_VERSION,
  FORMATIVE_CONVERSATION_CONTEXT_VERSION,
  FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
  FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION,
  FormativeConversationAgentInputSchema,
  FormativeConversationAgentOutputSchema,
  type FormativeConversationAgentOutput,
  type FormativeConversationCanonicalProfile
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import { validateFormativeConversationCandidateAcceptance } from "../src/lib/services/student-assessment/formative-conversation/candidate-validation";
import {
  FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_ISSUE_CODES,
  projectCanonicalMisconceptionClaimCatalog,
  validateFormativeConversationMisconceptionClaimClosure,
  type FormativeConversationMisconceptionClaimDisposition
} from "../src/lib/services/student-assessment/formative-conversation/misconception-claim-closure-v2";
import { validateFormativeConversationProfileTransition } from "../src/lib/services/student-assessment/formative-conversation/profile-transition-validator";
import { buildFormativeConversationSemanticRegenerationRequest } from "../src/lib/services/student-assessment/formative-conversation/semantic-regeneration";

const studentTurn = {
  sequence_index: 11,
  actor: "student" as const,
  message_text:
    "Reliability does not establish validity, but I still think SEM gives the exact score.",
  created_at: "2026-08-10T00:00:00.000Z"
};

function profile(
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
      "The administered evidence supports the current misconception claims.",
    evidence_sufficiency: "adequate",
    confidence_alignment: "mixed",
    independence_interpretability: "independent_understanding_uncertain",
    misconception_indicators: misconceptionIndicators,
    item_level_evidence: ["Administered assessment evidence."],
    reasoning_quality_summary:
      "The reasoning contains the identified misconception claims.",
    engagement_summary: "The student supplied observable responses.",
    process_interpretation_cautions: [
      "Process observations are descriptive only."
    ],
    profile_confidence: "medium",
    rationale: "The profile is grounded in administered evidence.",
    recommended_next_evidence: [
      "Ask for an independent explanation in a related context."
    ]
  };
}

function catalog(scope = "v17-identity-smoke") {
  return createCanonicalMisconceptionClaimCatalog({
    identity_scope: scope,
    indicators: [
      {
        indicator:
          "Measurement statistics are treated as definitive proof.",
        evidence_reference: "assessment:item:1",
        confidence: "medium",
        rationale: "Two distinct claims are supported by the assessment.",
        atomic_claims: [
          {
            claim_text: "Reliability is treated as proof of validity.",
            source_evidence_references: ["assessment:item:1"]
          },
          {
            claim_text: "SEM is treated as revealing an exact true score.",
            source_evidence_references: ["assessment:item:2"]
          }
        ]
      }
    ]
  });
}

function sequentialCatalog() {
  return createCanonicalMisconceptionClaimCatalog({
    identity_scope: "v17-sequential-identity-smoke",
    indicators: [
      {
        indicator:
          "Measurement statistics are treated as definitive proof.",
        evidence_reference: "assessment:item:1",
        confidence: "medium",
        rationale:
          "The assessment supports three distinct misconception claims.",
        atomic_claims: [
          {
            claim_text: "Reliability is treated as proof of validity.",
            source_evidence_references: ["assessment:item:1"]
          },
          {
            claim_text: "SEM is treated as revealing an exact true score.",
            source_evidence_references: ["assessment:item:2"]
          },
          {
            claim_text:
              "Validity is treated as a permanent context-free property.",
            source_evidence_references: ["assessment:item:3"]
          }
        ]
      }
    ]
  });
}

function dispositions(input: {
  claimCatalog: ReturnType<typeof catalog>;
  resolvedClaimIds?: ReadonlySet<string>;
}): FormativeConversationMisconceptionClaimDisposition[] {
  const resolved = input.resolvedClaimIds ?? new Set<string>();
  return input.claimCatalog.indicators.flatMap((indicator) =>
    indicator.claims.map((claim) => ({
      identity_version: MISCONCEPTION_CLAIM_IDENTITY_VERSION,
      indicator_id: indicator.indicator_id,
      claim_id: claim.claim_id,
      disposition: resolved.has(claim.claim_id)
        ? ("resolved" as const)
        : ("retained" as const),
      evidence_basis: resolved.has(claim.claim_id)
        ? ("conversation_evidence" as const)
        : ("prior_profile_evidence" as const),
      evidence_summary: resolved.has(claim.claim_id)
        ? "The cited student turn directly rejects the claim."
        : "The prior evidence remains current because this claim was not resolved.",
      source_turn_sequence_indexes: resolved.has(claim.claim_id) ? [11] : []
    }))
  );
}

function terminalOutput(input: {
  priorProfile: FormativeConversationCanonicalProfile;
  claimCatalog: ReturnType<typeof catalog>;
  claimDispositions?: FormativeConversationMisconceptionClaimDisposition[];
  rawMisconceptionIndicators?: string[];
}): FormativeConversationAgentOutput {
  const claimDispositions =
    input.claimDispositions ?? dispositions({ claimCatalog: input.claimCatalog });
  const retainedClaimIds = new Set(
    claimDispositions
      .filter((entry) => entry.disposition === "retained")
      .map((entry) => entry.claim_id)
  );
  const projected = projectCanonicalMisconceptionClaimCatalog({
    prior_catalog: input.claimCatalog,
    retained_claim_ids: retainedClaimIds
  });
  const projectedTexts = projected.indicators.flatMap((indicator) =>
    indicator.claims.map((claim) => claim.claim_text)
  );
  const updatedProfile = {
    ...structuredClone(input.priorProfile),
    misconception_indicators:
      input.rawMisconceptionIndicators ?? projectedTexts
  };
  const changedFields = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
    (field) =>
      JSON.stringify(input.priorProfile[field]) !==
      JSON.stringify(
        field === "misconception_indicators"
          ? projectedTexts
          : updatedProfile[field]
      )
  );
  const retainedFields = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.filter(
    (field) => !changedFields.includes(field)
  );
  return FormativeConversationAgentOutputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
    student_visible_message:
      "Your explanation resolves one claim while another still needs examination.",
    teaching_artifact: null,
    evidence_observations: [
      {
        evidence_type: "conceptual_revision",
        observation: "The student directly addressed the cited claim.",
        source_turn_sequence_indexes: [11]
      }
    ],
    profile_transition_recommendation: {
      recommendation_version:
        FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
      recommended: true,
      proposed_outcome: "largely_improved_understanding",
      rationale:
        "The conversation supplies evidence for a conservative profile update.",
      source_turn_sequence_indexes: [11],
      updated_profile: updatedProfile,
      field_evidence: [
        ...(changedFields.length > 0
          ? [
              {
                profile_fields: changedFields,
                disposition: "updated_from_conversation_evidence" as const,
                evidence_basis: "combined" as const,
                rationale:
                  "The cited student evidence supports the platform-projected change.",
                source_turn_sequence_indexes: [11]
              }
            ]
          : []),
        ...(retainedFields.length > 0
          ? [
              {
                profile_fields: retainedFields,
                disposition: "retained_evidence_remains_valid" as const,
                evidence_basis: "prior_profile_evidence" as const,
                rationale: "The prior evidence remains valid for these fields.",
                source_turn_sequence_indexes: []
              }
            ]
          : [])
      ],
      misconception_claim_closure: [],
      misconception_claim_dispositions: claimDispositions
    },
    teacher_assistance_recommendation: {
      recommended: false,
      reason_code: null
    },
    lifecycle_recommendation: "continue"
  });
}

function context(input: {
  priorProfile: FormativeConversationCanonicalProfile;
  claimCatalog: ReturnType<typeof catalog>;
}) {
  const profileEvidence = {
    profile_version: "profile_v17_smoke",
    outcome: "not_yet_determined" as const,
    evidence_summary: ["Administered evidence."],
    unresolved_evidence: [],
    evidence_limitations: [],
    canonical_profile: input.priorProfile,
    field_evidence: [],
    misconception_claim_catalog: input.claimCatalog,
    misconception_claim_dispositions: []
  };
  return FormativeConversationAgentInputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
    context_version: FORMATIVE_CONVERSATION_CONTEXT_VERSION,
    conversation_public_id: "conversation_v17_identity_smoke",
    assessment_public_id: "assessment_v17_identity_smoke",
    concept_unit_public_id: "concept_v17_identity_smoke",
    latest_student_message: studentTurn.message_text,
    visible_transcript: [studentTurn],
    administered_items: [],
    initial_profile: profileEvidence,
    current_profile: profileEvidence,
    allowed_misconception_claim_catalog: input.claimCatalog,
    intervention_history: [],
    memory: null,
    safety_boundary: {
      boundary_version: FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION,
      administered_item_public_ids: [],
      unadministered_item_protection_required: true,
      hidden_prompts_excluded: true,
      raw_teacher_notes_excluded: true,
      credentials_excluded: true
    }
  });
}

function issueCodes(
  result: ReturnType<
    typeof validateFormativeConversationMisconceptionClaimClosure
  >
) {
  return new Set(result.issues.map((entry) => entry.code));
}

function main() {
  const canonical = catalog();
  const repeated = catalog();
  assert.deepEqual(repeated, canonical, "The same profile scope must reproduce IDs.");
  assert.notEqual(
    catalog("v17-identity-smoke-other-profile").profile_scope_id,
    canonical.profile_scope_id,
    "A different profile scope must not reuse claim identities."
  );
  assert.equal(
    emptyCanonicalMisconceptionClaimCatalog("empty-profile").indicators.length,
    0
  );
  assert.equal(
    requireCanonicalMisconceptionClaimCatalog({
      value: [],
      legacy_profile_scope: "legacy-empty"
    }).indicators.length,
    0
  );
  assert.throws(
    () =>
      requireCanonicalMisconceptionClaimCatalog({
        value: [{ indicator: "Legacy compound free text." }],
        legacy_profile_scope: "legacy-nonempty"
      }),
    /cannot enter V17 generation/iu
  );

  const noMisconceptionCatalog = emptyCanonicalMisconceptionClaimCatalog(
    "v17-no-misconception-structure"
  );
  assert.equal(noMisconceptionCatalog.indicators.length, 0);
  const oneAtomicClaimCatalog = createCanonicalMisconceptionClaimCatalog({
    identity_scope: "v17-one-atomic-claim-structure",
    indicators: [
      {
        indicator: "Reliability is treated as proof of validity.",
        evidence_reference: "assessment:item:1",
        confidence: "medium",
        rationale: "One misconception proposition is supported.",
        atomic_claims: [
          {
            claim_text: "Reliability is treated as proof of validity.",
            source_evidence_references: ["assessment:item:1"]
          }
        ]
      }
    ]
  });
  assert.equal(oneAtomicClaimCatalog.indicators[0]?.claims.length, 1);

  const sequential = sequentialCatalog();
  const [claimA, claimB, claimC] = sequential.indicators[0]?.claims ?? [];
  assert(claimA && claimB && claimC);
  assert.equal(sequential.indicators[0]?.claims.length, 3);
  assert.equal(
    new Set(sequential.indicators[0]?.claims.map((claim) => claim.claim_id))
      .size,
    3,
    "Semantically distinct atomic claims must receive distinct platform IDs."
  );
  const firstSequentialTransition =
    validateFormativeConversationMisconceptionClaimClosure({
      prior_catalog: sequential,
      claim_dispositions: dispositions({
        claimCatalog: sequential,
        resolvedClaimIds: new Set([claimA.claim_id])
      }),
      available_turns: [studentTurn]
    });
  assert.equal(firstSequentialTransition.valid, true);
  assert.deepEqual(
    firstSequentialTransition.updated_catalog.indicators[0]?.claims,
    [claimB, claimC],
    "Resolving A must preserve B and C byte-for-byte."
  );
  const secondSequentialTransition =
    validateFormativeConversationMisconceptionClaimClosure({
      prior_catalog: firstSequentialTransition.updated_catalog,
      claim_dispositions: dispositions({
        claimCatalog: firstSequentialTransition.updated_catalog,
        resolvedClaimIds: new Set([claimB.claim_id])
      }),
      available_turns: [studentTurn]
    });
  assert.equal(secondSequentialTransition.valid, true);
  assert.deepEqual(
    secondSequentialTransition.updated_catalog.indicators[0]?.claims,
    [claimC],
    "Resolving B must preserve C byte-for-byte."
  );
  assert.equal(
    secondSequentialTransition.updated_catalog.indicators[0]?.claims[0]
      ?.claim_id,
    claimC.claim_id,
    "Claim C must retain the same ID through both transitions."
  );
  assert.equal(
    JSON.stringify(
      secondSequentialTransition.updated_catalog.indicators[0]?.claims[0]
    ),
    JSON.stringify(claimC),
    "Claim C must remain byte-identical through sequential transitions."
  );

  const [reliabilityClaim, semClaim] = canonical.indicators[0].claims;
  assert.ok(reliabilityClaim && semClaim);

  const partial = validateFormativeConversationMisconceptionClaimClosure({
    prior_catalog: canonical,
    claim_dispositions: dispositions({
      claimCatalog: canonical,
      resolvedClaimIds: new Set([reliabilityClaim.claim_id])
    }),
    available_turns: [studentTurn]
  });
  assert.equal(partial.valid, true);
  assert.deepEqual(
    partial.updated_catalog.indicators.flatMap((indicator) =>
      indicator.claims.map((claim) => claim.claim_id)
    ),
    [semClaim.claim_id],
    "A retained claim must remain in the platform-projected profile."
  );

  const allResolved = validateFormativeConversationMisconceptionClaimClosure({
    prior_catalog: canonical,
    claim_dispositions: dispositions({
      claimCatalog: canonical,
      resolvedClaimIds: new Set([reliabilityClaim.claim_id, semClaim.claim_id])
    }),
    available_turns: [studentTurn]
  });
  assert.equal(allResolved.valid, true);
  assert.equal(allResolved.updated_catalog.indicators.length, 0);

  const unchanged = validateFormativeConversationMisconceptionClaimClosure({
    prior_catalog: canonical,
    claim_dispositions: dispositions({ claimCatalog: canonical }),
    available_turns: [studentTurn]
  });
  assert.equal(unchanged.valid, true);
  assert.deepEqual(unchanged.updated_catalog, canonical);

  const missing = validateFormativeConversationMisconceptionClaimClosure({
    prior_catalog: canonical,
    claim_dispositions: dispositions({ claimCatalog: canonical }).slice(0, 1),
    available_turns: [studentTurn]
  });
  assert(
    issueCodes(missing).has(
      FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_ISSUE_CODES.missingClaim
    )
  );

  const duplicate = validateFormativeConversationMisconceptionClaimClosure({
    prior_catalog: canonical,
    claim_dispositions: [
      ...dispositions({ claimCatalog: canonical }),
      dispositions({ claimCatalog: canonical })[0]
    ],
    available_turns: [studentTurn]
  });
  assert(
    issueCodes(duplicate).has(
      FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_ISSUE_CODES.duplicateClaim
    )
  );

  const unknown = validateFormativeConversationMisconceptionClaimClosure({
    prior_catalog: canonical,
    claim_dispositions: dispositions({ claimCatalog: canonical }).map(
      (entry, index) =>
        index === 0
          ? { ...entry, claim_id: `mc_${"0".repeat(24)}` }
          : entry
    ),
    available_turns: [studentTurn]
  });
  assert(
    issueCodes(unknown).has(
      FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_ISSUE_CODES.unknownClaim
    )
  );

  const withoutEvidence = validateFormativeConversationMisconceptionClaimClosure({
    prior_catalog: canonical,
    claim_dispositions: dispositions({
      claimCatalog: canonical,
      resolvedClaimIds: new Set([reliabilityClaim.claim_id])
    }).map((entry) =>
      entry.claim_id === reliabilityClaim.claim_id
        ? { ...entry, source_turn_sequence_indexes: [] }
        : entry
    ),
    available_turns: [studentTurn]
  });
  assert(
    issueCodes(withoutEvidence).has(
      FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_ISSUE_CODES.resolvedEvidenceMissing
    )
  );

  const foreignCatalog = catalog("v17-identity-smoke-foreign-profile");
  const foreign = validateFormativeConversationMisconceptionClaimClosure({
    prior_catalog: canonical,
    claim_dispositions: dispositions({ claimCatalog: foreignCatalog }),
    available_turns: [studentTurn]
  });
  assert(
    issueCodes(foreign).has(
      FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_ISSUE_CODES.unknownIndicator
    )
  );
  assert(
    issueCodes(foreign).has(
      FORMATIVE_CONVERSATION_MISCONCEPTION_CLAIM_CLOSURE_ISSUE_CODES.unknownClaim
    )
  );

  const priorProfile = profile(
    canonical.indicators.flatMap((indicator) =>
      indicator.claims.map((claim) => claim.claim_text)
    )
  );
  const validOutput = terminalOutput({
    priorProfile,
    claimCatalog: canonical,
    claimDispositions: dispositions({
      claimCatalog: canonical,
      resolvedClaimIds: new Set([reliabilityClaim.claim_id])
    })
  });
  const runtimeContext = context({ priorProfile, claimCatalog: canonical });
  const accepted = validateFormativeConversationCandidateAcceptance({
    candidate: validOutput,
    context: runtimeContext
  });
  assert.equal(accepted.valid, true);
  assert.deepEqual(
    accepted.output?.profile_transition_recommendation?.updated_profile
      ?.misconception_indicators,
    [semClaim.claim_text],
    "Candidate acceptance must use the ID-derived profile projection."
  );

  const freeTextSubstitution = structuredClone(validOutput);
  if (!freeTextSubstitution.profile_transition_recommendation) {
    throw new Error("v17_transition_recommendation_missing");
  }
  delete freeTextSubstitution.profile_transition_recommendation
    .misconception_claim_dispositions;
  freeTextSubstitution.profile_transition_recommendation.updated_profile = {
    ...freeTextSubstitution.profile_transition_recommendation.updated_profile!,
    misconception_indicators: ["A paraphrase without a canonical claim ID."]
  };
  const substitutionResult =
    validateFormativeConversationCandidateAcceptance({
      candidate: freeTextSubstitution,
      context: runtimeContext
    });
  assert.equal(substitutionResult.valid, false);
  assert(
    substitutionResult.validation_issue_paths.includes(
      "profile_transition_recommendation.misconception_claim_dispositions"
    )
  );

  const limitationCandidate = terminalOutput({
    priorProfile,
    claimCatalog: canonical,
    rawMisconceptionIndicators: [
      "Transfer to another context needs further evidence."
    ]
  });
  const limitationValidation = validateFormativeConversationProfileTransition({
    recommendation: limitationCandidate.profile_transition_recommendation,
    prior_profile: priorProfile,
    prior_misconception_claim_catalog: canonical,
    evidence_observations: limitationCandidate.evidence_observations,
    available_turns: [studentTurn]
  });
  assert.equal(limitationValidation.valid, false);
  assert(
    limitationValidation.issues.some(
      (entry) =>
        entry.code ===
        "profile_transition_misconception_field_semantics_invalid"
    )
  );

  const invalidAttempt = {
    logical_call_id: "logical-v17-invalid",
    sequence: 1,
    kind: "primary" as const,
    client_request_id: "request-v17-invalid",
    canonical_request_hash: "a".repeat(64),
    result_status: "completed" as const,
    accepted: false,
    failure_category: "semantic_validation_failed" as const,
    provider_request_id: null,
    provider_response_id: null,
    safe_invalid_output_evidence: {
      evidence_version: "formative-conversation-invalid-output-evidence-v1" as const,
      output_presence: "decoded_json" as const,
      candidate_hash: "b".repeat(64),
      candidate_text: null,
      candidate_json: freeTextSubstitution,
      validation_status: "output_contract_invalid" as const,
      validation_issue_paths: [
        "profile_transition_recommendation.misconception_claim_dispositions"
      ]
    },
    provider_attempt_count: 1,
    transport_retry_count: 0,
    provider_attempts: [],
    latency_ms: 1,
    input_tokens: 1,
    output_tokens: 1,
    total_tokens: 2
  };
  const baseRequest: StructuredAgentRequest<
    typeof runtimeContext,
    FormativeConversationAgentOutput
  > = {
    agent_name: "formative_conversation_agent",
    model_config: {
      model_name: "deterministic-v17-smoke",
      reasoning_effort: "medium",
      max_output_tokens: 4_000
    },
    instructions: "Deterministic no-provider V17 identity smoke.",
    input: runtimeContext,
    output_schema: FormativeConversationAgentOutputSchema,
    schema_name: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
    client_request_id: "v17-base-request",
    timeout_ms: 90_000
  };
  const regeneration = buildFormativeConversationSemanticRegenerationRequest({
    base_request: baseRequest,
    invalid_attempt: invalidAttempt,
    client_request_id: "v17-regeneration-request"
  });
  const regenerationInput = regeneration.input as {
    semantic_regeneration: {
      canonical_misconception_claim_catalog: typeof canonical;
      allowed_indicator_ids: string[];
      allowed_claim_ids: string[];
      prior_invalid_candidate: unknown;
      validation_issue_paths: string[];
    };
  };
  assert.deepEqual(
    regenerationInput.semantic_regeneration.canonical_misconception_claim_catalog,
    canonical
  );
  assert.deepEqual(regenerationInput.semantic_regeneration.allowed_indicator_ids, [
    canonical.indicators[0].indicator_id
  ]);
  assert.deepEqual(
    regenerationInput.semantic_regeneration.allowed_claim_ids,
    canonical.indicators[0].claims.map((claim) => claim.claim_id)
  );
  assert.deepEqual(
    regenerationInput.semantic_regeneration.prior_invalid_candidate,
    freeTextSubstitution
  );
  assert.deepEqual(
    regenerationInput.semantic_regeneration.validation_issue_paths,
    invalidAttempt.safe_invalid_output_evidence.validation_issue_paths
  );

  console.log(
    JSON.stringify(
      {
        status: "passed",
        stable_platform_ids: true,
        structural_catalog_gates: true,
        sequential_retained_claim_identity_stable: true,
        legacy_nonempty_profile_failed_closed: true,
        full_partial_and_unchanged_projection: true,
        unknown_duplicate_missing_and_foreign_ids_rejected: true,
        resolved_without_student_evidence_rejected: true,
        free_text_identity_substitution_rejected: true,
        limitation_as_misconception_rejected: true,
        semantic_regeneration_identity_preserved: true,
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
