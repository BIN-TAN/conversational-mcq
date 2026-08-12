import { strict as assert } from "node:assert";
import type { AgentOutputByName } from "../src/lib/agents/contracts";
import { createCanonicalMisconceptionClaimCatalog } from "../src/lib/domain/misconception-claim-identity";
import type {
  LlmProvider,
  StructuredAgentRequest,
  StructuredAgentResult
} from "../src/lib/llm/providers/types";
import {
  FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT,
  FORMATIVE_CONVERSATION_V5_PROFILING_CASE_ORDER,
  V17ProfilingCanaryFixtureSchema
} from "../src/lib/operational/formative-conversation-v5-evaluation-v17/contracts";
import {
  createFormativeConversationV17CandidateRunner,
  validateFormativeConversationV17ProfilingCandidate
} from "../src/lib/operational/formative-conversation-v5-evaluation-v17/candidate-runner";
import { loadFormativeConversationV17EvaluationPackage } from "../src/lib/operational/formative-conversation-v5-evaluation-v17/package";
import { readFileSync } from "node:fs";
import path from "node:path";

type Profile = AgentOutputByName["student_profiling_agent"];

function baseProfile(): Profile {
  return {
    agent_name: "student_profiling_agent",
    agent_version: "student-profiling-runtime-v4",
    prompt_version: "student-profiling-v4",
    schema_version: "student-profile-output-v3",
    output_status: "ok",
    warnings: [],
    profile_type: "initial",
    ability_profile: "misconception_based_understanding",
    ability_pattern_flags: ["misconception_indicator_present"],
    engagement_profile: "adequate_engagement",
    engagement_pattern_flags: ["no_clear_pattern"],
    integrated_diagnostic_profile:
      "misconception_with_sufficient_engagement",
    integrated_profile_confidence: "high",
    integrated_profile_rationale:
      "The synthetic assessment reasoning supplies direct evidence for the bounded interpretation.",
    evidence_sufficiency: "strong",
    confidence_alignment: "well_calibrated",
    independence_interpretability: "independent_understanding_likely",
    misconception_indicators: [],
    item_level_evidence: [
      "measurement_reliability",
      "standard_error_measurement",
      "validity_argument"
    ].map((itemPublicId) => ({
      item_public_id: itemPublicId,
      evidence_summary: `Synthetic evidence for ${itemPublicId}.`,
      correctness: "incorrect",
      reasoning_quality: "The response contains independently stated reasoning.",
      confidence_rating: "high" as const
    })),
    reasoning_quality_summary:
      "The synthetic reasoning is explicit enough for contract validation.",
    engagement_summary:
      "The synthetic student supplied an answer, reasoning, and confidence for each item.",
    process_interpretation_cautions: [
      "Process observations are not interpreted as learner traits."
    ],
    profile_confidence: "high",
    rationale:
      "The profile is limited to the observable synthetic assessment evidence.",
    recommended_next_evidence: [
      {
        evidence_type: "conversation_evidence",
        reason: "Further conversation may test transfer and explanation.",
        item_public_id: null
      }
    ]
  };
}

function outputForCase(caseId: string): Profile {
  const output = baseProfile();
  if (caseId === "pcv17_01_no_misconception") {
    return {
      ...output,
      ability_profile: "robust_transfer_ready_understanding",
      ability_pattern_flags: ["transfer_ready"],
      integrated_diagnostic_profile:
        "robust_understanding_ready_for_transfer",
      misconception_indicators: [],
      item_level_evidence: output.item_level_evidence.map((item) => ({
        ...item,
        correctness: "correct",
        confidence_rating: "medium"
      }))
    };
  }
  if (caseId === "pcv17_02_single_atomic_misconception") {
    return {
      ...output,
      item_level_evidence: output.item_level_evidence.map((item, index) => ({
        ...item,
        correctness: index === 0 ? "incorrect" : "correct",
        confidence_rating: index === 0 ? "high" : "medium"
      })),
      misconception_indicators: [
        {
          indicator:
            "Reliability is treated as sufficient evidence of validity.",
          evidence_reference: "measurement_reliability",
          confidence: "high",
          rationale:
            "The response explicitly says high reliability must imply validity.",
          atomic_claims: [
            {
              claim_text:
                "High reliability automatically proves validity for the intended use.",
              source_evidence_references: ["measurement_reliability"]
            }
          ]
        }
      ]
    };
  }
  return {
    ...output,
    misconception_indicators: [
      {
        indicator:
          "Measurement statistics are treated as definitive proof across distinct interpretations.",
        evidence_reference: "measurement_reliability",
        confidence: "high",
        rationale:
          "Three responses state distinct unsupported conclusions.",
        atomic_claims: [
          {
            claim_text: "High reliability automatically proves validity.",
            source_evidence_references: ["measurement_reliability"]
          },
          {
            claim_text:
              "Standard error of measurement identifies an exact true score.",
            source_evidence_references: ["standard_error_measurement"]
          },
          {
            claim_text:
              "Validity is permanent and independent of interpretation or use.",
            source_evidence_references: ["validity_argument"]
          }
        ]
      }
    ]
  };
}

class QueuedProfilingProvider implements LlmProvider {
  readonly requests: Array<StructuredAgentRequest<unknown, unknown>> = [];

  constructor(private readonly outputs: Profile[]) {}

  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    this.requests.push(request as StructuredAgentRequest<unknown, unknown>);
    const output = this.outputs.shift();
    assert.ok(output, "The deterministic profiling provider queue was exhausted.");
    return {
      provider: "mock",
      client_request_id: request.client_request_id,
      provider_request_id: `v17_profile_request_${this.requests.length}`,
      provider_response_id: `v17_profile_response_${this.requests.length}`,
      status: "completed",
      parsed_output: output as TOutput,
      raw_output: output,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150
      },
      latency_ms: 1
    };
  }
}

function profilingFixture(caseId: string) {
  return V17ProfilingCanaryFixtureSchema.parse(
    JSON.parse(
      readFileSync(
        path.join(FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT, `${caseId}.json`),
        "utf8"
      )
    )
  );
}

async function verifyProfilingSemanticRegeneration() {
  const loaded = loadFormativeConversationV17EvaluationPackage();
  const fixture = profilingFixture("pcv17_02_single_atomic_misconception");
  const invalid = outputForCase("pcv17_03_compound_conceptual_state");
  const valid = outputForCase("pcv17_02_single_atomic_misconception");
  const provider = new QueuedProfilingProvider([invalid, valid]);
  let dispatchAuthorizations = 0;
  const evaluationId = "v17_offline_profiling_regeneration";
  const runner = createFormativeConversationV17CandidateRunner({
    loaded,
    evaluation_id: evaluationId,
    provider,
    before_first_generation_request: async () => {
      dispatchAuthorizations += 1;
    }
  });
  const result = await runner.run_profiling_canary(fixture);
  assert.equal(result.status, "passed");
  assert.equal(result.provider_execution_audit.logical_generation_call_count, 2);
  assert.equal(result.provider_execution_audit.provider_attempt_count, 2);
  assert.equal(result.provider_execution_audit.transport_retry_count, 0);
  assert.equal(result.provider_execution_audit.semantic_regeneration_count, 1);
  assert.equal(dispatchAuthorizations, 1);
  assert.equal(runner.dispatch_state().first_generation_request_authorized, true);
  assert.equal(provider.requests.length, 2);

  const firstAttempt = result.provider_execution_audit.attempts[0];
  const invalidEvidence = firstAttempt.safe_invalid_output_evidence as {
    candidate_hash?: unknown;
    candidate?: unknown;
  };
  assert.match(String(invalidEvidence.candidate_hash), /^[a-f0-9]{64}$/u);
  assert.deepEqual(invalidEvidence.candidate, invalid);
  assert.ok(
    (firstAttempt.validation_issue_paths as string[]).includes(
      "claim_count_mismatch"
    )
  );

  const regeneratedInput = provider.requests[1].input as {
    original_profile_input?: unknown;
    semantic_regeneration?: {
      invalid_candidate?: unknown;
      invalid_candidate_hash?: unknown;
      issue_paths?: unknown;
      canonical_evidence_set?: unknown;
    };
  };
  assert.deepEqual(regeneratedInput.original_profile_input, fixture.provider_input);
  assert.deepEqual(
    regeneratedInput.semantic_regeneration?.invalid_candidate,
    invalid
  );
  assert.equal(
    regeneratedInput.semantic_regeneration?.invalid_candidate_hash,
    invalidEvidence.candidate_hash
  );
  assert.deepEqual(
    regeneratedInput.semantic_regeneration?.canonical_evidence_set,
    fixture.provider_input.initial_response_package
  );
  assert.ok(
    (regeneratedInput.semantic_regeneration?.issue_paths as string[]).includes(
      "claim_count_mismatch"
    )
  );
  assert.ok(result.canonical_catalog);
  const expectedCatalog = createCanonicalMisconceptionClaimCatalog({
    identity_scope:
      `${evaluationId}:pcv17_02_single_atomic_misconception:initial-profile`,
    indicators: valid.misconception_indicators.map((indicator) => ({
      ...indicator,
      atomic_claims: indicator.atomic_claims ?? []
    }))
  });
  assert.deepEqual(result.canonical_catalog, expectedCatalog);
  assert.match(result.canonical_catalog.profile_scope_id, /^mp_[a-f0-9]{24}$/u);
  assert.equal(
    result.canonical_catalog.indicators.flatMap((indicator) => indicator.claims)
      .length,
    1
  );
  assert.equal(runner.ledger.base_profiling_calls_completed, 1);
  assert.equal(runner.ledger.semantic_regeneration_calls_completed, 1);
  assert.equal(runner.ledger.adapter_attempts_used, 2);

  const exhaustedProvider = new QueuedProfilingProvider([invalid, invalid]);
  const exhaustedRunner = createFormativeConversationV17CandidateRunner({
    loaded,
    evaluation_id: "v17_offline_profiling_exhausted",
    provider: exhaustedProvider,
    before_first_generation_request: async () => undefined
  });
  const exhausted = await exhaustedRunner.run_profiling_canary(fixture);
  assert.equal(exhausted.status, "failed");
  assert.equal(exhausted.canonical_catalog, null);
  assert.equal(exhausted.provider_execution_audit.logical_generation_call_count, 2);
  assert.equal(exhausted.provider_execution_audit.semantic_regeneration_count, 1);
  assert.equal(
    exhausted.provider_execution_audit.attempts.filter(
      (attempt) => attempt.safe_invalid_output_evidence !== null
    ).length,
    2
  );
}

const originalFetch = globalThis.fetch;
let networkRequests = 0;
globalThis.fetch = (async () => {
  networkRequests += 1;
  throw new Error("network_forbidden");
}) as typeof fetch;

async function main() {
  const results = FORMATIVE_CONVERSATION_V5_PROFILING_CASE_ORDER.map(
    (caseId) => {
      const fixture = profilingFixture(caseId);
      const result = validateFormativeConversationV17ProfilingCandidate({
        fixture,
        candidate: outputForCase(caseId),
        identity_scope: `offline-v17-canary:${caseId}:initial-profile`
      });
      assert.equal(result.valid, true, result.issues.join(","));
      assert.ok(result.catalog);
      assert.equal(result.catalog.profile_scope_id.includes("<"), false);
      const claims = result.catalog.indicators.flatMap(
        (indicator) => indicator.claims
      );
      if (caseId === "pcv17_01_no_misconception") {
        assert.equal(result.catalog.indicators.length, 0);
        assert.equal(claims.length, 0);
      } else if (caseId === "pcv17_02_single_atomic_misconception") {
        assert.equal(result.catalog.indicators.length, 1);
        assert.equal(claims.length, 1);
      } else {
        assert.equal(claims.length, 3);
        assert.equal(new Set(claims.map((claim) => claim.claim_id)).size, 3);
        assert.ok(result.partial_resolution_projection);
        assert.equal(
          result.partial_resolution_projection.indicators.flatMap(
            (indicator) => indicator.claims
          ).length,
          2
        );
      }
      assert.equal(
        claims.some((claim) =>
          /rationale|confidence|metadata/iu.test(claim.claim_text)
        ),
        false
      );
      return {
        case_id: caseId,
        indicator_count: result.catalog.indicators.length,
        claim_count: claims.length,
        status: "passed"
      };
    }
  );
  await verifyProfilingSemanticRegeneration();
  assert.equal(networkRequests, 0);
  console.log(JSON.stringify({
    status: "passed",
    results,
    provider_calls: 0,
    model_auth_requests: 0,
    network_requests: 0,
    dispatch_checkpoints: 0
  }));
}

main().finally(() => {
  globalThis.fetch = originalFetch;
});
