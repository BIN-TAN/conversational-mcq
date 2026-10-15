import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { zodTextFormat } from "openai/helpers/zod";
import { compileProductionAgentRequest, compileProductionStructuredAgentRequest } from "../src/lib/agents/provider-request";
import { StudentProfilingInput, ProductionStudentProfileOutputV6 } from "../src/lib/agents/contracts";
import { selectedConversationRequestFormatSha256 } from "../src/lib/operational/luna-conversation-replay-evidence";
import { selectedProfileRequestFormatSha256, verifySelectedProfileRequestFormats } from "../src/lib/operational/luna-low-validation-evidence";
import { FormativeConversationV18R2AgentInputSchema } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { buildFormativeConversationV18R2ProductionRequest } from "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2";
import { buildFormativeConversationV18R2SemanticRegenerationRequest, FormativeConversationV18R2LogicalCallAuditSchema } from "../src/lib/services/student-assessment/formative-conversation/execution-v18r2";
import { FormativeConversationPlannedProposalOutputSchema, FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION } from "../src/lib/services/student-assessment/formative-conversation/profile-update-proposal";

// These are protocol checks using retained synthetic fixtures. They generate no
// student content and do not reinterpret the original failed paid attempts.
let checks = 0;
const check = (action: () => void) => { action(); checks++; };
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("network_forbidden_in_evidence_request_gate_smoke"); };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const tutorFixture = JSON.parse(readFileSync("prisma/fixtures/conversation-evidence-id-native-v25.json", "utf8"));
const context = FormativeConversationV18R2AgentInputSchema.parse(tutorFixture.input);
const before = JSON.stringify(context);
const base = buildFormativeConversationV18R2ProductionRequest({ context,
  model_config: { model_name: "gpt-5.6-luna", reasoning_effort: "medium", max_output_tokens: 7000 },
  client_request_id: "OFFLINE-enum-base", invocation_key: "OFFLINE-enum-base", timeout_ms: 30000 });
const invalid = FormativeConversationV18R2LogicalCallAuditSchema.parse({ sequence: 1, kind: "base",
  logical_call_id: "OFFLINE-invalid", canonical_request_hash: "0".repeat(64), result_status: "completed",
  failure_class: "parsed_semantic_contract_failure", accepted: false, logical_call_entered: true,
  pre_dispatch_request_rejection_count: 0, http_request_count: 1, provider_response_completed_count: 1,
  provider_attempt_count: 1, transport_retry_count: 0, parsed_candidate_count: 1, semantically_accepted_candidate_count: 0,
  provider_request_id: null, provider_response_id: null, client_request_id: "OFFLINE-invalid", incomplete_reason: null,
  latency_ms: 0, input_tokens: null, output_tokens: null, total_tokens: null,
  invalid_candidate: { candidate_hash: null, candidate_json: null, candidate_text: null,
    validation_status: "semantic_contract_invalid", validation_issue_paths: ["conversation_review.student_source_invalid"] } });
const repair = buildFormativeConversationV18R2SemanticRegenerationRequest({ base_request: base, invalid_attempt: invalid,
  client_request_id: "OFFLINE-enum-repair" });
const expectedTutor = selectedConversationRequestFormatSha256(context);
for (const format of [compileProductionStructuredAgentRequest(base).text.format,
  compileProductionStructuredAgentRequest(repair).text.format]) check(() => assert.equal(hash(format), expectedTutor));
check(() => assert.notEqual(expectedTutor, hash(zodTextFormat(FormativeConversationPlannedProposalOutputSchema, FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION))));
for (const evidence of [context.allowed_evidence_catalog.evidence.slice(1), [...context.allowed_evidence_catalog.evidence].reverse()]) {
  check(() => assert.notEqual(selectedConversationRequestFormatSha256({ ...context,
    allowed_evidence_catalog: { ...context.allowed_evidence_catalog, evidence } }), expectedTutor));
}
for (const evidence of [[], [...context.allowed_evidence_catalog.evidence, context.allowed_evidence_catalog.evidence[0]]]) {
  check(() => assert.throws(() => selectedConversationRequestFormatSha256({ ...context,
    allowed_evidence_catalog: { ...context.allowed_evidence_catalog, evidence } })));
}
check(() => assert.equal(JSON.stringify(context), before));

const profileFixture = JSON.parse(readFileSync("prisma/fixtures/student-profile-mismatch-native-v18.json", "utf8"));
const profileInputs = profileFixture.drafts.map((entry: { input: unknown }) => StudentProfilingInput.parse(entry.input));
const profileFormat = (input: typeof profileInputs[number]) => compileProductionAgentRequest({
  agent_name: "student_profiling_agent", input,
  model_config: { model_name: "gpt-5.6-luna", reasoning_effort: "medium", max_output_tokens: 4000 },
  client_request_id: "OFFLINE-profile-format", timeout_ms: 30000 }).text.format;
const calls = profileInputs.map((input: typeof profileInputs[number], index: number) => ({
  agent_name: "student_profiling_agent", provider: "openai", provider_response_id: `OFFLINE-profile-${index}`,
  call_status: index === 0 ? "invalid_output" : "succeeded", output_validated: index !== 0, input_payload: input }));
const rows = calls.map((call: typeof calls[number], index: number) => ({ request_index: index + 1,
  category: "application", agent_name: "student_profiling_agent", model_name: "gpt-5.6-luna", status: "completed",
  provider_response_id: call.provider_response_id, request_format_sha256: hash(profileFormat(call.input_payload)) }));
check(() => assert.equal(verifySelectedProfileRequestFormats(calls, rows).bound_requests, 2));
for (const input of profileInputs) check(() => assert.equal(hash(profileFormat(input)), selectedProfileRequestFormatSha256(input)));
for (const position of [0, 1]) for (const bad of [undefined, "0".repeat(64), hash(zodTextFormat(ProductionStudentProfileOutputV6, "student-profile-output-v6"))]) {
  check(() => assert.throws(() => verifySelectedProfileRequestFormats(calls,
    rows.map((row: typeof rows[number], index: number) => index === position ? { ...row, request_format_sha256: bad } : row)), /request format/));
}
check(() => assert.throws(() => verifySelectedProfileRequestFormats(calls, rows.slice(1))));
check(() => assert.throws(() => verifySelectedProfileRequestFormats(calls, [...rows, rows[0]])));
check(() => assert.throws(() => verifySelectedProfileRequestFormats(calls, [...rows, { ...rows[0], provider_response_id: "OFFLINE-unbound-retry" }]), /persisted input context/));
check(() => assert.throws(() => verifySelectedProfileRequestFormats([...calls, calls[0]], rows)));
const changed = structuredClone(calls);
changed[1].input_payload.allowed_evidence_catalog.evidence.reverse();
check(() => assert.throws(() => verifySelectedProfileRequestFormats(changed, rows), /request format/));
const empty = structuredClone(profileInputs[0]);
empty.allowed_evidence_catalog.evidence = [];
check(() => assert.equal(hash(profileFormat(empty)), selectedProfileRequestFormatSha256(empty)));
check(() => assert.notEqual(selectedProfileRequestFormatSha256(empty), rows[0].request_format_sha256));
check(() => assert.throws(() => selectedProfileRequestFormatSha256({ ...empty, allowed_evidence_catalog: undefined })));
check(() => assert.equal(networkCalls, 0));
console.log(JSON.stringify({ checks, status: "passed", provider_calls: 0, scope: "Exact current base/repair request formats; historical failed evidence unchanged." }, null, 2));
