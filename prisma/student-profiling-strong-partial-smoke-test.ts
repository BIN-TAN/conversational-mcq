import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { ProductionStudentProfilingInput, ProductionStudentProfileOutputV5,
  ProductionStudentProfileOutputV6, StoredStudentProfileOutput, type AgentInputByName,
  type AgentOutputByName } from "../src/lib/agents/contracts";
import { executeAgent } from "../src/lib/agents/execute-agent";
import { buildProductionAgentRequest, compileProductionAgentRequest } from "../src/lib/agents/provider-request";
import { redactForAudit } from "../src/lib/agents/redaction";
import { STUDENT_PROFILE_FACT_BINDING_VERSION, validateStudentProfileOutputSemantics,
  validateStudentProfileStrongPartialReasoningSupport } from "../src/lib/agents/student-profiling/semantic-validation";
import { executeStudentProfileWithSemanticRepair } from "../src/lib/agents/student-profiling/semantic-repair";
import { MockLlmProvider } from "../src/lib/llm/providers/mock-provider";
import type { StructuredAgentRequest, StructuredAgentResult } from "../src/lib/llm/providers/types";

let checks = 0;
const check = (value: unknown, message: string) => { assert(value, message); checks++; };
globalThis.fetch = async () => { throw new Error("Offline strong-partial test forbids network"); };
type Input = AgentInputByName["student_profiling_agent"];
type Output = AgentOutputByName["student_profiling_agent"];
const fixture = JSON.parse(readFileSync(new URL("./fixtures/student-profile-native-strong-partial.json", import.meta.url), "utf8"));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
check(hash(fixture.input_original) === fixture.source.input_sha256, "Native input preserved exactly");
check(hash(fixture.output_original) === fixture.source.output_sha256, "Native output preserved exactly");
check(ProductionStudentProfileOutputV5.safeParse(fixture.output_original).success, "Historical V5 remains readable");
check(StoredStudentProfileOutput.safeParse(fixture.output_original).success, "Stored union retains V5");
check(validateStudentProfileOutputSemantics({ providerInput: fixture.input_original, output: fixture.output_original }).ok,
  "Historical acceptance is not retroactively rewritten by the prospective rule");
check(!ProductionStudentProfileOutputV6.safeParse(fixture.output_original).success, "Current V6 requires typed proof");

function current() {
  const input: Input = structuredClone(fixture.input_original);
  input.profiling_constraints.fact_binding_version = STUDENT_PROFILE_FACT_BINDING_VERSION;
  input.profiling_constraints.output_schema_version = "student-profile-output-v6";
  const output: Output = { ...structuredClone(fixture.output_original), schema_version: "student-profile-output-v6",
    prompt_version: "student-profiling-v9", strong_partial_reasoning_support: [] };
  return { input, output };
}
type Case = ReturnType<typeof current>;
const issues = (v: Case) => validateStudentProfileStrongPartialReasoningSupport({ providerInput: v.input, output: v.output });
const nativeCurrent = current();
check(issues(nativeCurrent).some(x => x.includes("nonempty exactly")), "Exact observed unsupported flag fails current proof contract");
const unflagged = current();
unflagged.output.ability_pattern_flags = unflagged.output.ability_pattern_flags.filter(x => x !== "incorrect_answer_strong_partial_reasoning");
check(validateStudentProfileOutputSemantics({ providerInput: unflagged.input, output: unflagged.output }).ok,
  "Supported misconceptions survive without inventing partial understanding");
check(StoredStudentProfileOutput.safeParse(unflagged.output).success, "Current V6 is readable");

const reasoning = "Consistent scores support reliability because repeated measurement should produce similar results under comparable conditions; however, I think reliability alone proves the test measures job performance.";
function positive(): Case {
  const v = current(), id = v.output.item_level_evidence[0].item_public_id!;
  const payload = v.input.initial_response_package.payload as { item_responses: Array<Record<string, unknown>> };
  payload.item_responses.find(x => x.item_public_id === id)!.reasoning_text = reasoning;
  const source = v.input.allowed_evidence_catalog!.evidence.find(x => x.item_public_id === id && x.evidence_kind === "assessment_reasoning")!;
  source.content = reasoning;
  v.output.item_level_evidence[0].reasoning_basis!.source_quote = reasoning;
  v.output.strong_partial_reasoning_support = [{ item_public_id: id, source_evidence_id: source.evidence_id,
    source_quote: reasoning.split("; however")[0],
    correct_component: "The student explains reliability as repeated measurement producing similar results under comparable conditions.",
    remaining_error: "The student then claims that reliability alone proves job-performance validity." }];
  return v;
}
check(issues(positive()).length === 0, "Known incorrect selection can have explicitly supported partial correct reasoning");
check(positive().output.item_level_evidence.every(x => x.correctness === "incorrect"), "Positive control is not a blanket all-incorrect exclusion");
function rejects(change: (v: Case) => void, expected: string) {
  const v = positive(); change(v); check(issues(v).some(x => x.includes(expected)), expected);
}
rejects(v => { delete v.output.strong_partial_reasoning_support; }, "required");
rejects(v => { v.output.strong_partial_reasoning_support = []; }, "nonempty exactly");
rejects(v => { v.output.ability_pattern_flags = ["conceptual_error_possible"]; }, "nonempty exactly");
rejects(v => { v.output.strong_partial_reasoning_support!.push(structuredClone(v.output.strong_partial_reasoning_support![0])); }, "duplicates");
rejects(v => { v.output.strong_partial_reasoning_support![0].item_public_id = "unknown_item"; }, "incorrect sealed item");
rejects(v => { v.output.strong_partial_reasoning_support![0].source_evidence_id = "unknown_source"; }, "eligible student reasoning source");
rejects(v => { v.output.strong_partial_reasoning_support![0].source_evidence_id = v.input.allowed_evidence_catalog!.evidence.find(x => x.evidence_kind === "assessment_reasoning" && x.item_public_id !== v.output.item_level_evidence[0].item_public_id)!.evidence_id; }, "eligible student reasoning source");
rejects(v => { v.output.strong_partial_reasoning_support![0].source_quote = "A fabricated correct explanation"; }, "verbatim");
rejects(v => { v.output.strong_partial_reasoning_support![0].source_quote = " "; }, "verbatim");
rejects(v => { v.output.strong_partial_reasoning_support![0].correct_component = " "; }, "explicit correct_component");
rejects(v => { v.output.strong_partial_reasoning_support![0].remaining_error = " "; }, "explicit correct_component");
rejects(v => { const id = v.output.strong_partial_reasoning_support![0].source_evidence_id;
  v.input.allowed_evidence_catalog!.evidence.find(x => x.evidence_id === id)!.source_role = "tutor"; }, "eligible student reasoning source");
rejects(v => { const id = v.output.strong_partial_reasoning_support![0].source_evidence_id;
  v.input.allowed_evidence_catalog!.evidence.find(x => x.evidence_id === id)!.eligibility = "evidence_quality_context"; }, "eligible student reasoning source");
rejects(v => { const id = v.output.strong_partial_reasoning_support![0].source_evidence_id;
  v.input.allowed_evidence_catalog!.evidence.find(x => x.evidence_id === id)!.evidence_kind = "assessment_answer"; }, "eligible student reasoning source");
rejects(v => { const id = v.output.strong_partial_reasoning_support![0].source_evidence_id;
  v.input.allowed_evidence_catalog!.evidence.find(x => x.evidence_id === id)!.evidence_stage = "formative_conversation"; }, "eligible student reasoning source");
rejects(v => { const id = v.output.strong_partial_reasoning_support![0].source_evidence_id;
  v.input.allowed_evidence_catalog!.evidence.push(structuredClone(v.input.allowed_evidence_catalog!.evidence.find(x => x.evidence_id === id)!)); }, "eligible student reasoning source");
for (const correctness of ["correct", null]) rejects(v => {
  const payload = v.input.initial_response_package.payload as { item_responses: Array<Record<string, unknown>> };
  payload.item_responses[0].correctness = correctness;
}, "incorrect sealed item");
rejects(v => { const payload = v.input.initial_response_package.payload as { item_responses: Array<Record<string, unknown>> };
  payload.item_responses.push({ ...payload.item_responses[0], correctness: "correct" }); }, "incorrect sealed item");
rejects(v => { v.input.followup_evidence_package = { payload: { item_responses: [{
  item_public_id: v.output.item_level_evidence[0].item_public_id, correctness: "correct", reasoning_text: reasoning }] } }; }, "incorrect sealed item");

const extra = positive().output;
Object.assign(extra.strong_partial_reasoning_support![0], { invented_field: true });
check(!ProductionStudentProfileOutputV6.safeParse(extra).success, "Strict current proof rejects extraneous fields");
const before = hash(positive());
const requestInput = positive();
const request = { agent_name: "student_profiling_agent" as const, input: requestInput.input,
  model_config: { model_name: "gpt-5.6-luna", reasoning_effort: "medium" as const, max_output_tokens: 7000 },
  client_request_id: "synthetic-v6-proof", timeout_ms: 60000 };
const production = buildProductionAgentRequest(request);
check(production.output_schema.safeParse(requestInput.output).success, "Actual production request accepts the typed support");
const compiled = compileProductionAgentRequest(request);
check(JSON.stringify(compiled.text.format.schema).includes("strong_partial_reasoning_support"), "Compiled strict provider schema includes proof");
check(hash(requestInput) === before, "No projection mutates sealed evidence or model classification");
check(hash(redactForAudit(requestInput.output)) === hash(requestInput.output), "Audit redaction preserves this nonsecret synthetic proof exactly");

async function checksWithEffects() {
  const mock = await new MockLlmProvider().executeStructured(production);
  check(mock.status === "completed" && ProductionStudentProfileOutputV6.safeParse(mock.parsed_output).success,
    "Actual current mock provider emits V6 without inventing partial reasoning support");
  const valid = unflagged.output, invalid = nativeCurrent.output;
  let calls = 0; const recorded: Output[] = [];
  const repairRequest = { agentName: "student_profiling_agent" as const, invocationKey: "synthetic-proof",
    allowlistedInput: nativeCurrent.input, operationalContext: {} };
  const repaired = await executeStudentProfileWithSemanticRepair({ request: repairRequest,
    execute: async r => { calls++; if (calls === 2) {
      check(r.invocationKey === "synthetic-proof:semantic-repair:1", "Same bounded repair key");
      assert.deepEqual(r.allowlistedInput.initial_response_package, nativeCurrent.input.initial_response_package);
    } return { status: "succeeded", output: calls === 1 ? invalid : valid, agent_call_id: `mock_${calls}`, retry_count: 0 }; },
    recordRejected: async r => { recorded.push(structuredClone(r.output)); } });
  check(repaired.status === "succeeded" && calls === 2 && recorded.length === 1, "One audited repair may remove unsupported flag");
  assert.deepEqual(recorded[0], invalid); checks++;
  calls = 0;
  const failed = await executeStudentProfileWithSemanticRepair({ request: repairRequest,
    execute: async () => { calls++; return { status: "succeeded", output: invalid, agent_call_id: `bad_${calls}`, retry_count: 0 }; },
    recordRejected: async () => {} });
  check(failed.status === "semantic_validation_failed" && calls === 2, "Repeated unsupported proof fails closed without third call");

  check(process.env.LLM_PROVIDER === "mock", "Executor retention test must run under local mock guard");
  const original = MockLlmProvider.prototype.executeStructured;
  const retained = positive().output;
  const rows = new Map<string, Record<string, unknown>>();
  const db = { agentCall: {
    findUnique: async () => null,
    create: async ({ data }: { data: Record<string, unknown> }) => { rows.set(String(data.id), { ...data }); return data; },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = rows.get(where.id)!; Object.assign(row, data); return row;
    }
  } } as unknown as PrismaClient;
  MockLlmProvider.prototype.executeStructured = async function<TInput, TOutput>(actualRequest: StructuredAgentRequest<TInput, TOutput>) {
    check(actualRequest.schema_name === "student-profile-output-v6", "Actual executor uses the new production schema identity");
    return { provider: "mock", status: "completed", parsed_output: retained as TOutput,
      raw_output: { synthetic_only: true, output: retained }, latency_ms: 1 } as StructuredAgentResult<TOutput>;
  };
  try {
    const result = await executeAgent({ agent_name: "student_profiling_agent", input: ProductionStudentProfilingInput.parse(positive().input),
      agent_invocation_key: "synthetic-proof-retention", model_config_override: request.model_config, prismaClient: db });
    check(result.status === "succeeded", "Actual executor accepts current V6 proof");
    const saved = [...rows.values()][0];
    assert.deepEqual(saved.output_payload, retained); checks++;
    assert.deepEqual((saved.raw_output as { output: unknown }).output, retained); checks++;
    check(rows.size === 1, "One audit record, no real DB write");
  } finally { MockLlmProvider.prototype.executeStructured = original; }
  console.log(JSON.stringify({ status: "passed", checks, provider_calls: 0, database_calls: 0,
    scope: "Exact historical V5 fixture; prospective V6 provenance; existing bounded semantic repair; actual executor with in-memory DB and stubbed mock transport",
    limitation: "Source binding and explicit claims do not prove conceptual truth. This initial profiling source annotation is not a nineteenth mutable profile dimension or an ordinary teacher export field." }));
}
void checksWithEffects().catch(error => { console.error(error); process.exitCode = 1; });
