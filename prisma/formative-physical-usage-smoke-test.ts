import assert from "node:assert/strict";
import { executeWithBoundedProviderTransportRetry, providerPhysicalUsageFromTransport,
  sumProviderPhysicalUsage, type ProviderPhysicalUsageAudit } from "../src/lib/llm/provider-transport-retry";
import type { LlmProvider, LlmUsage, StructuredAgentRequest, StructuredAgentResult } from "../src/lib/llm/providers/types";
import { logicalExecutionFromTransport } from "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2";
import { executeFormativeConversationV18R2, ProviderPhysicalUsageAuditSchema } from "../src/lib/services/student-assessment/formative-conversation/execution-v18r2";
import { FormativeConversationV18R2AgentOutputSchema } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { buildConversationDeliveryDraftBlocks, CONVERSATION_DELIVERY_REVIEW_VERSION } from "../src/lib/services/student-assessment/formative-conversation/conversation-continuity";
import { v18r2TestContext, v18r2TestContinueOutput } from "./formative-conversation-v18r2-test-fixtures";

globalThis.fetch = async () => { throw new Error("Physical usage regression must not reach a provider"); };
let checks = 0;
const check = (name: string, action: () => void) => { action(); checks++; console.log(`PASS ${name}`); };
const context = v18r2TestContext({ student_turn_count: 1, student_messages: ["Please explain that distinction."], tutor_messages: ["We discussed reliability and validity."] });
context.administered_items = context.assessment_response_evidence.map((item, index) => ({
  item_public_id: item.item_public_id, item_number: index + 1, item_stem: "Synthetic item",
  options: [{ label: "A", text: "First option" }, { label: "B", text: "Second option" }],
  student_answer: item.selected_option, correct_answer: "A", concise_explanation: "Private key", administered: true
}));
const output = v18r2TestContinueOutput({ context });
const tutorUsage = { input_tokens: 100, output_tokens: 20, total_tokens: 120 };
const reviewUsage = { input_tokens: 30, output_tokens: 5, total_tokens: 35, cached_input_tokens: 10, reasoning_tokens: 2 };
const base: StructuredAgentRequest<typeof context, unknown> = {
  agent_name: "formative_conversation_agent", model_config: { model_name: "gpt-5.6-luna", reasoning_effort: "medium", max_output_tokens: 7000 },
  instructions: "Offline physical accounting fixture", input: context, output_schema: FormativeConversationV18R2AgentOutputSchema,
  schema_name: context.contract_version, client_request_id: "physical-test", timeout_ms: 1000
};

async function physicalExecution(request: StructuredAgentRequest<unknown, unknown>, value: unknown,
  usages: Array<LlmUsage | undefined>, role: string, missingMilestone = false) {
  let calls = 0;
  const provider: LlmProvider = {
    async executeStructured<TInput, TOutput>(attempt: StructuredAgentRequest<TInput, TOutput>): Promise<StructuredAgentResult<TOutput>> {
      const index = calls++, final = calls === usages.length;
      return { provider: "openai", client_request_id: attempt.client_request_id,
        provider_response_id: usages[index] ? `${role}-response-${calls}` : undefined,
        status: final ? "completed" : "failed", parsed_output: final ? value as TOutput : undefined,
        raw_output: final ? { output_text: JSON.stringify(value) } : { error: "Synthetic retryable failure" },
        usage: usages[index], latency_ms: 1,
        ...(!final ? { error: { category: "provider_5xx" as const, message: "Synthetic failure", retryable: true } } : {}),
        ...(!missingMilestone ? { transport_telemetry: {
          provider: "openai" as const, transport: "openai_responses" as const, adapter_version: "offline",
          client_request_id: attempt.client_request_id, model_name: attempt.model_config.model_name,
          base_url_host: "api.openai.com", base_url_approved: true, transport_adapter_entered: true,
          request_serialization_completed: true, fetch_invoked: true, response_headers_received: final,
          response_body_received: final, response_body_completed: final, http_status: final ? 200 : 503
        } } : {}) };
    }
  };
  const transport = await executeWithBoundedProviderTransportRetry({ provider, request, logical_call_id: role,
    source_binding_hash: "a".repeat(64), sleep: async () => {}, create_client_request_id: (_, index) => `${role}-client-${index}` });
  return { execution: logicalExecutionFromTransport({ request, transport }), transport, calls };
}

async function scenario(tutor: Array<LlmUsage | undefined>, reviewer: Array<LlmUsage | undefined>,
  changePrimary?: (execution: Awaited<ReturnType<typeof physicalExecution>>["execution"]) => void) {
  const primary = await physicalExecution(base, output, tutor, "tutor");
  changePrimary?.(primary.execution);
  let child: Awaited<ReturnType<typeof physicalExecution>> | undefined;
  const result = await executeFormativeConversationV18R2({ base_request: base,
    validate_candidate: () => ({ valid: true, validation_status: "valid", validation_issue_paths: [] }),
    execute_logical_generation: async () => primary.execution,
    async execute_delivery_review({ request }) {
      const review = { version: CONVERSATION_DELIVERY_REVIEW_VERSION, verdict: "pass", findings: [],
        teaching_block_audit: buildConversationDeliveryDraftBlocks(output.student_visible_message).map(block => ({
          block_id: block.block_id, assessment: "no_teaching_claims", check: "Authored accounting fixture; this is not a semantic quality test."
        })) };
      child = await physicalExecution(request, review, reviewer, "review");
      return child.execution;
    }
  });
  assert(child);
  return { result, primary, child };
}

async function main() {
  const known = await scenario([tutorUsage], [reviewUsage]);
  check("one known physical request per role remains complete without changing output or state", () => {
    assert.equal(known.result.audit.usage_accounting_complete, true);
    assert.equal(known.result.total_tokens, 155); assert.equal(known.result.audit.http_requests_dispatched, 2);
    assert.deepEqual(known.result.result.parsed_output, output); assert.equal(known.result.result.parsed_output.profile_transition_recommendation, null);
  });
  const unknownPrimary = await scenario([undefined, tutorUsage], [reviewUsage]);
  check("unknown first tutor dispatch followed by success retains lower bound and false completeness", () => {
    const audit = unknownPrimary.result.audit, attempt = audit.attempts[0];
    assert.equal(attempt.usage_accounting_complete, false); assert.equal(audit.usage_accounting_complete, false);
    assert.equal(attempt.physical_usage!.attempts[0].total_tokens, null);
    assert.equal(attempt.physical_usage!.attempts[1].total_tokens, 120);
    assert.equal(attempt.total_tokens, 120); assert.equal(unknownPrimary.result.total_tokens, 155);
    assert.equal(audit.http_requests_dispatched, 3); assert.equal(audit.transport_retries, 1);
    assert.equal(audit.semantic_regeneration_calls, 0); assert.equal(unknownPrimary.primary.calls, 2);
    assert.deepEqual(unknownPrimary.result.result.parsed_output, output);
  });
  const unknownChild = await scenario([tutorUsage], [undefined, reviewUsage]);
  check("unknown first child dispatch followed by valid review marks child and combined incomplete", () => {
    const review = unknownChild.result.audit.attempts[0].pre_delivery_review!;
    assert.equal(review.status, "passed"); assert.equal(review.usage_accounting_complete, false);
    assert.equal(review.total_tokens, 35); assert.equal(unknownChild.result.total_tokens, 155);
    assert.equal(unknownChild.result.audit.usage_accounting_complete, false);
    assert.equal(unknownChild.result.audit.http_requests_dispatched, 3); assert.equal(unknownChild.child.calls, 2);
    assert.equal(unknownChild.result.audit.semantic_regeneration_calls, 0);
  });
  const first = { input_tokens: 8, output_tokens: 2, total_tokens: 10, raw: { private: "must not copy" } };
  const allKnown = await scenario([first, tutorUsage], [first, reviewUsage]);
  check("known usage from every physical retry is added once, keeping original final provider usage unchanged", () => {
    assert.equal(allKnown.result.audit.usage_accounting_complete, true);
    assert.equal(allKnown.result.total_tokens, 175); assert.equal(allKnown.result.input_tokens, 146); assert.equal(allKnown.result.output_tokens, 29);
    assert.equal(allKnown.result.audit.http_requests_dispatched, 4); assert.equal(allKnown.result.audit.transport_retries, 2);
    assert.equal(allKnown.result.audit.attempts[0].total_tokens, 130);
    assert.equal(allKnown.result.audit.attempts[0].pre_delivery_review!.total_tokens, 45);
    assert.deepEqual(allKnown.primary.execution.result.usage, tutorUsage);
    assert(!JSON.stringify(allKnown.primary.transport.attempt_traces).includes("must not copy"));
  });
  const absent = await scenario([undefined], [undefined]);
  check("all dispatched usage absent remains null, never invented zero", () => {
    assert.equal(absent.result.total_tokens, null); assert.equal(absent.result.input_tokens, null); assert.equal(absent.result.output_tokens, null);
    assert.equal(absent.result.audit.usage_accounting_complete, false);
  });
  const inconsistent = await scenario([{ ...tutorUsage, total_tokens: 999 }], [reviewUsage]);
  check("inconsistent input/output/total is retained as observed but cannot be complete", () => {
    assert.equal(inconsistent.result.audit.usage_accounting_complete, false);
    assert.equal(inconsistent.result.audit.attempts[0].physical_usage!.attempts[0].total_tokens, 999);
  });
  const noMilestone = await physicalExecution(base, output, [tutorUsage], "missing-milestone", true);
  check("absent fetch milestone is possibly dispatched, not a proven free attempt", () => {
    assert.equal(noMilestone.execution.physical_usage!.attempts[0].fetch_invoked, null);
    assert.equal(noMilestone.execution.physical_usage!.usage_accounting_complete, false);
    assert.equal(sumProviderPhysicalUsage(noMilestone.execution.physical_usage!).total_tokens, 120);
  });
  const unknownDispatch = await scenario([tutorUsage], [reviewUsage], execution => {
    execution.physical_usage = noMilestone.execution.physical_usage;
    execution.http_request_count = 0;
  });
  check("missing dispatch evidence propagates incomplete token and dispatch accounting", () => {
    assert.equal(unknownDispatch.result.audit.usage_accounting_complete, false);
    assert.equal(unknownDispatch.result.audit.dispatch_accounting_complete, false);
    assert.equal(unknownDispatch.result.total_tokens, 155);
  });
  const mismatchedCount = await scenario([tutorUsage], [reviewUsage], execution => {
    execution.http_request_count = 2;
  });
  const omittedAttempts = await scenario([tutorUsage], [reviewUsage], execution => {
    execution.physical_usage = providerPhysicalUsageFromTransport([]);
  });
  check("missing physical entries and inconsistent dispatch counts cannot claim complete accounting", () => {
    for (const value of [mismatchedCount, omittedAttempts]) {
      assert.equal(value.result.audit.usage_accounting_complete, false);
      assert.equal(value.result.audit.dispatch_accounting_complete, false);
    }
  });
  const legacyMultiple = await scenario([undefined, tutorUsage], [reviewUsage], execution => {
    delete execution.physical_usage;
  });
  check("legacy multi-dispatch final usage stays readable but cannot prove all physical usage", () => {
    assert.equal(legacyMultiple.result.audit.usage_accounting_complete, false);
    assert.equal(legacyMultiple.result.total_tokens, 155);
    assert.equal(legacyMultiple.result.audit.http_requests_dispatched, 3);
  });
  check("ordered distinct physical IDs and derived completeness reject tampered audit claims", () => {
    const original = unknownPrimary.result.audit.attempts[0].physical_usage!;
    for (const changed of [{ ...original, usage_accounting_complete: true },
      { ...original, attempts: [...original.attempts].reverse() },
      { ...original, attempts: original.attempts.map(entry => ({ ...entry, client_request_id: "duplicate" })) }]) {
      assert.equal(ProviderPhysicalUsageAuditSchema.safeParse(changed).success, false);
    }
  });
  const provenZero: ProviderPhysicalUsageAudit = { version: "provider-physical-usage-v1", attempts: [], usage_accounting_complete: true };
  check("empty transport has no invented token count and explicit zero physical attempts", () => {
    assert.deepEqual(providerPhysicalUsageFromTransport([]), provenZero);
    assert.equal(sumProviderPhysicalUsage(provenZero).total_tokens, undefined);
  });
  check("proven pre-dispatch rejection is free only with null or zero usage", () => {
    const rejected = structuredClone(known.primary.execution.physical_usage!);
    rejected.attempts[0] = { ...rejected.attempts[0], fetch_invoked: false,
      input_tokens: null, output_tokens: null, total_tokens: null, cached_input_tokens: null, reasoning_tokens: null };
    assert.equal(ProviderPhysicalUsageAuditSchema.safeParse(rejected).success, true);
    assert.equal(sumProviderPhysicalUsage(rejected).total_tokens, undefined);
    rejected.attempts[0].input_tokens = 100;
    assert.equal(ProviderPhysicalUsageAuditSchema.safeParse(rejected).success, false);
  });
  console.log(JSON.stringify({ status: "passed", checks, provider_calls: 0, database_calls: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
