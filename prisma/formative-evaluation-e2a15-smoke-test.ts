import assert from "node:assert/strict";
import type {
  LlmProvider,
  StructuredAgentRequest,
  StructuredAgentResult
} from "@/lib/llm/providers/types";
import { createOpenAIClient } from "@/lib/llm/openai-client";
import { resolveOpenAICredentialFromEnv } from
  "@/lib/llm/openai-credential-resolver";
import {
  cleanupTemporaryE2A15ArtifactRoot,
  executeE2A15Evaluation,
  inspectE2A15Preflight,
  replayAllE2A13ProviderOutputs,
  temporaryE2A15ArtifactRoot
} from "@/lib/evaluation/formative/e2a15-protected-request-subset";
import {
  E2A15_PROTOCOL_HASH,
  assertE2A15ProtocolFrozen,
  e2a15ProtectedRequestCases
} from "@/lib/evaluation/formative/e2a15-protected-request-subset-protocol";
import { E2A14_CANDIDATE_HASH } from
  "@/lib/evaluation/formative/e2a14-protected-request-validator-candidate";

const networkRequestCount = 0;

class SafeRefusalProvider implements LlmProvider {
  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    const anchor = typeof request.metadata?.case_id === "string"
      ? request.metadata.case_id.replace(/^e2a15_/u, "").replace(/_/gu, " ")
      : "the current item";
    const parsed = request.output_schema.parse({
      schema_version: "topic-dialogue-protected-redirect-output-v1",
      student_facing_message:
        "I can’t provide that protected information. Instead, let’s return " +
        `to ${anchor}: what evidence would help evaluate the active claim?`
    });
    return {
      provider: "mock",
      provider_response_id: `mock_response_${request.client_request_id}`,
      provider_request_id: `mock_request_${request.client_request_id}`,
      client_request_id: request.client_request_id,
      status: "completed",
      parsed_output: parsed as TOutput,
      raw_output: parsed,
      usage: {
        input_tokens: 100,
        output_tokens: 35,
        total_tokens: 135,
        reasoning_tokens: 0,
        cached_input_tokens: 0
      },
      latency_ms: 2
    };
  }
}

async function main() {
  const syntheticCredential = resolveOpenAICredentialFromEnv({
    ...process.env,
    OPENAI_API_KEY: `sk-${"a".repeat(48)}`
  });
  assert.equal(syntheticCredential.ok, true);
  if (!syntheticCredential.ok) throw new Error("synthetic_credential_invalid");
  assert.doesNotThrow(() => createOpenAIClient({
    credential: syntheticCredential.credential,
    isolatedEvaluationRuntime: {
      purpose: "bounded_candidate_evaluation",
      request_timeout_ms: 90_000
    }
  }));
  assert.throws(() => createOpenAIClient({
    credential: syntheticCredential.credential,
    isolatedEvaluationRuntime: {
      purpose: "bounded_candidate_evaluation",
      request_timeout_ms: 999
    }
  }), /bounded candidate evaluation timeout/u);

  assert.equal(assertE2A15ProtocolFrozen(), E2A15_PROTOCOL_HASH);
  const cases = e2a15ProtectedRequestCases();
  assert.equal(cases.length, 6);
  assert.equal(new Set(cases.map((entry) => entry.case_id)).size, 6);
  assert(cases.every((entry) =>
    entry.selected_operation === "protected_redirect" &&
    entry.routing_classification === "protected_request"
  ));

  const replayBefore = replayAllE2A13ProviderOutputs();
  assert.equal(replayBefore.source_provider_output_count, 31);
  assert.equal(replayBefore.replay_attempts.length, 31);
  assert.equal(replayBefore.recomputed_case_outcomes.length, 30);
  assert.equal(new Set(replayBefore.recomputed_case_outcomes.map((entry) =>
    entry.case_id
  )).size, 30);
  assert(replayBefore.recomputed_case_outcomes.every((entry) =>
    ["accepted", "accepted_with_review_flags"].includes(
      entry.final_runtime_acceptance
    )
  ));
  assert(replayBefore.recomputed_case_outcomes.every((entry) =>
    !entry.deterministic_fallback_recomputed && entry.safe_for_student_display
  ));

  const preflight = await inspectE2A15Preflight({
    requireLiveEnvironment: false,
    requireCleanTrackedTree: false
  });
  assert.equal(preflight.passed, true, preflight.blockers.join(","));
  assert.equal(preflight.candidate_hash, E2A14_CANDIDATE_HASH);
  assert.equal(preflight.e2a13_provider_output_count, 31);
  assert.equal(preflight.e2a13_recomputed_case_count, 30);
  assert.equal(preflight.network_request_count, 0);

  const root = temporaryE2A15ArtifactRoot();
  try {
    const result = await executeE2A15Evaluation({
      provider: new SafeRefusalProvider(),
      live: false,
      artifactRoot: root
    });
    assert.equal(result.summary.status, "e2a15_no_live_smoke_pass");
    assert.equal(result.summary.fresh_protected_request_case_count, 6);
    assert.equal(result.summary.fresh_hard_rejected_final_count, 0);
    assert.equal(result.summary.fresh_fallback_count, 0);
    assert.equal(result.summary.e2a13_replayed_attempt_count, 31);
    assert.equal(result.summary.e2a13_recomputed_case_count, 30);
    assert.equal(result.summary.e2a13_recomputed_fallback_count, 0);
    assert.equal(result.summary.human_review_status, "pending");
    assert.equal(result.summary.human_review_completed, false);
    assert.equal(result.summary.human_review_item_count, 36);
    assert.equal(result.summary.human_approval_claimed, false);
    assert.equal(result.summary.candidate_approved, false);
    assert.equal(result.summary.candidate_activated, false);
    assert.equal(result.humanReview.rows.length, 36);
    assert(result.humanReview.rows.filter((entry) =>
      entry.source === "e2a13_recomputed_final_output"
    ).every((entry) =>
      typeof entry.student_request === "string" &&
      entry.student_request.length > 0
    ));
    assert(result.humanReview.rows.every((entry) =>
      entry.human_decision === null && entry.human_notes === null
    ));
    assert.equal(result.summary.provider_usage.generation_provider_calls, 0);
    assert.equal(result.summary.provider_usage.injected_mock_calls, 6);
    assert.equal(networkRequestCount, 0);
  } finally {
    cleanupTemporaryE2A15ArtifactRoot(root);
  }

  const replayAfter = replayAllE2A13ProviderOutputs();
  assert.equal(
    replayAfter.source_provider_outputs_sha256,
    replayBefore.source_provider_outputs_sha256
  );
  assert.equal(
    replayAfter.source_provider_cases_sha256,
    replayBefore.source_provider_cases_sha256
  );

  console.log(JSON.stringify({
    status: "passed",
    protocol_hash: E2A15_PROTOCOL_HASH,
    candidate_hash: E2A14_CANDIDATE_HASH,
    protected_subset_case_count: cases.length,
    e2a13_replayed_attempt_count: replayAfter.replay_attempts.length,
    recomputed_case_count: replayAfter.recomputed_case_outcomes.length,
    human_review_item_count: 36,
    network_request_count: networkRequestCount,
    human_review_completed: false,
    candidate_approved: false,
    candidate_activated: false
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
