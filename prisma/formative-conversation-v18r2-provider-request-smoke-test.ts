import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { agentInputSchemas } from "../src/lib/agents/contracts";
import {
  buildProductionAgentRequest,
  compileProductionAgentRequest,
  compileProductionStructuredAgentRequest
} from "../src/lib/agents/provider-request";
import { buildCanonicalEvidenceCatalog } from "../src/lib/domain/canonical-evidence-identity";
import { buildFormativeConversationV18R2ProductionRequest } from "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2";
import { v18r2TestContext } from "./formative-conversation-v18r2-test-fixtures";

const fixtureRoot =
  "config/operational-candidates/formative-conversation-host-v5-executable-v18r2/fixtures";
const caseIds = [
  "pcv18_01_no_misconception",
  "pcv18_02_single_atomic_misconception",
  "pcv18_03_compound_conceptual_state"
] as const;

function record(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function activeProfilingInput(caseId: (typeof caseIds)[number]) {
  const fixture = record(
    JSON.parse(
      readFileSync(path.join(fixtureRoot, `${caseId}.json`), "utf8")
    )
  );
  const providerInput = record(fixture.provider_input);
  const concept = record(providerInput.concept_unit_metadata);
  const responsePackage = record(providerInput.initial_response_package);
  const payload = record(responsePackage.payload);
  const itemResponses = (payload.item_responses as unknown[]).map(record);
  const processEvents = (responsePackage.process_events as unknown[]).map(record);
  const allowedEvidenceCatalog = buildCanonicalEvidenceCatalog({
    evidence_namespace_public_id: `v18r2-provider-boundary:${caseId}`,
    assessment_public_id: `${caseId}:assessment`,
    concept_unit_public_id: String(concept.concept_unit_public_id),
    assessment_responses: itemResponses.map((response) => ({
      item_public_id: String(response.item_public_id),
      selected_option: stringOrNull(response.selected_option),
      correctness: stringOrNull(response.correctness),
      written_reasoning: stringOrNull(response.reasoning_text),
      confidence: stringOrNull(response.confidence_rating),
      tempting_option: stringOrNull(response.tempting_option),
      tempting_option_reason: stringOrNull(response.tempting_option_reason)
    })),
    assessment_process: processEvents.map((event) => ({
      source_public_id: [
        caseId,
        String(event.event_type),
        stringOrNull(event.occurred_at) ?? "time-unavailable",
        stringOrNull(event.item_public_id) ?? "no-item"
      ].join(":"),
      event_type: String(event.event_type),
      event_category: String(event.event_category),
      event_source: String(event.event_source),
      item_public_id: stringOrNull(event.item_public_id),
      occurred_at: stringOrNull(event.occurred_at)
    }))
  });

  return agentInputSchemas.student_profiling_agent.parse({
    ...providerInput,
    allowed_evidence_catalog: allowedEvidenceCatalog
  });
}

function main() {
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = (async () => {
    networkRequests += 1;
    throw new Error("network_forbidden_in_v18r2_provider_request_smoke");
  }) as typeof fetch;

  try {
    const profilingCases = caseIds.map((caseId) => {
      const input = activeProfilingInput(caseId);
      const request = buildProductionAgentRequest({
        agent_name: "student_profiling_agent",
        model_config: {
          model_name: "gpt-5.6-terra",
          reasoning_effort: "medium",
          max_output_tokens: 4_000
        },
        input,
        client_request_id: `v18r2-provider-boundary:${caseId}`,
        timeout_ms: 60_000
      });
      const compiledFromStructuredRequest =
        compileProductionStructuredAgentRequest(request);
      const compiledFromProductionEntry = compileProductionAgentRequest({
        agent_name: "student_profiling_agent",
        model_config: request.model_config,
        input,
        client_request_id: request.client_request_id,
        timeout_ms: request.timeout_ms
      });

      assert.deepEqual(compiledFromProductionEntry, compiledFromStructuredRequest);
      assert.equal(compiledFromStructuredRequest.model, "gpt-5.6-terra");
      assert.equal(compiledFromStructuredRequest.store, false);
      assert.equal(compiledFromStructuredRequest.max_output_tokens, 4_000);
      assert.match(
        String(compiledFromStructuredRequest.input),
        /allowed_evidence_catalog/u
      );
      assert(
        input.allowed_evidence_catalog?.evidence.every(
          (entry) => entry.evidence_stage === "baseline_assessment"
        )
      );
      const format = record(record(compiledFromStructuredRequest.text).format);
      assert.equal(format.type, "json_schema");
      assert.match(JSON.stringify(format), /atomic_claims/u);

      return {
        case_id: caseId,
        schema_name: request.schema_name,
        evidence_count: input.allowed_evidence_catalog?.evidence.length ?? 0
      };
    });

    const formativeRequest = buildFormativeConversationV18R2ProductionRequest({
      context: v18r2TestContext({ student_turn_count: 1 }),
      model_config: {
        model_name: "gpt-5.6-sol",
        reasoning_effort: "medium",
        max_output_tokens: 7_000
      },
      client_request_id: "v18r2-formative-production-boundary",
      timeout_ms: 60_000,
      invocation_key: "v18r2-formative-production-boundary"
    });
    const compiledFormative =
      compileProductionStructuredAgentRequest(formativeRequest);

    assert.equal(compiledFormative.model, "gpt-5.6-sol");
    assert.equal(compiledFormative.max_output_tokens, 7_000);
    assert.equal(compiledFormative.store, false);
    assert.match(String(compiledFormative.input), /formative_lifecycle/u);
    assert.match(String(compiledFormative.input), /student_turn_index/u);
    assert.match(String(compiledFormative.input), /baseline_assessment/u);
    assert.match(String(compiledFormative.input), /formative_conversation/u);
    assert.match(
      JSON.stringify(compiledFormative.text),
      /profile_transition_recommendation/u
    );
    assert.equal(networkRequests, 0);

    console.log(
      JSON.stringify(
        {
          status: "passed",
          exact_production_profiling_request_compiled: true,
          exact_production_formative_responses_request_compiled: true,
          profiling_model: "gpt-5.6-terra",
          formative_model: "gpt-5.6-sol",
          formative_max_output_tokens: compiledFormative.max_output_tokens,
          profiling_cases: profilingCases,
          provider_calls: 0,
          model_auth_requests: 0,
          generation_network_requests: networkRequests,
          dispatch_checkpoints: 0
        },
        null,
        2
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main();
