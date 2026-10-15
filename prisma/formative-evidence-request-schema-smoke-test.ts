import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { compileProductionStructuredAgentRequest } from "../src/lib/agents/provider-request";
import {
  EVIDENCE_ID_REQUEST_SCHEMA_VERSION, evidenceIdRequestSchema, evidenceIdRequestSchemaLimits
} from "../src/lib/llm/evidence-id-request-schema";
import { FormativeConversationV18R2AgentInputSchema, FormativeConversationV18R2AgentOutputSchema } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { buildFormativeConversationV18R2ProductionRequest } from "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2";
import {
  FormativeConversationPlannedProposalOutputSchema, FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/profile-update-proposal";
import {
  conversationContinuityIssues, projectConversationContinuityWire
} from "../src/lib/services/student-assessment/formative-conversation/conversation-continuity";
import {
  buildFormativeConversationV18R2SemanticRegenerationRequest,
  FormativeConversationV18R2LogicalCallAuditSchema
} from "../src/lib/services/student-assessment/formative-conversation/execution-v18r2";

let checks = 0;
function check(name: string, run: () => void) { run(); checks += 1; console.log(`PASS ${name}`); }
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls += 1; throw new Error("network_prohibited"); };
try {
  const raw = readFileSync("prisma/fixtures/conversation-evidence-id-native-v25.json", "utf8");
  const fixture = JSON.parse(raw) as { input: unknown; synthetic_only: boolean; real_student_records_used: boolean;
    attempts: { kind: string; wire: unknown; validation_issue_paths: string[]; original_candidate_text_available: boolean }[] };
  const context = FormativeConversationV18R2AgentInputSchema.parse(fixture.input);
  const ids = context.allowed_evidence_catalog.evidence.map(entry => entry.evidence_id);
  const schemaName = FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION;
  const originalSchema = JSON.stringify(zodTextFormat(FormativeConversationPlannedProposalOutputSchema, schemaName));
  const originalFixture = JSON.stringify(fixture);
  const request = buildFormativeConversationV18R2ProductionRequest({ context,
    model_config: { model_name: "gpt-5.6-luna", reasoning_effort: "medium", max_output_tokens: 12_000 },
    client_request_id: "offline-evidence-enum", invocation_key: "offline-evidence-enum", timeout_ms: 30_000 });
  const compiled = compileProductionStructuredAgentRequest(request);
  const format = compiled.text!.format!;
  const jsonSchema = (format as { schema: unknown }).schema;
  check("actual synthetic final context has60 catalog IDs", () => {
    assert.equal(fixture.synthetic_only, true); assert.equal(fixture.real_student_records_used, false); assert.equal(ids.length, 60);
  });
  check("policy metadata is included before request compilation", () => {
    assert.equal(request.metadata?.evidence_id_request_schema, EVIDENCE_ID_REQUEST_SCHEMA_VERSION);
    assert.equal(compiled.metadata?.evidence_id_request_schema, EVIDENCE_ID_REQUEST_SCHEMA_VERSION);
  });
  check("compiled enum budgets include actual shared definitions", () => {
    const limits = evidenceIdRequestSchemaLimits(jsonSchema);
    assert.equal(limits.enum_values, 432); assert.equal(limits.object_properties, 271);
    assert(limits.string_characters < 120_000);
    assert(!JSON.stringify(jsonSchema).includes("^ev_[a-f0-9]{24}$"));
  });
  const bad = "ev_53ff2635f77d3bb1682a0f8c", good = "ev_53ff2635f77d3bb1680a2f8c";
  for (const attempt of fixture.attempts) {
    check(`${attempt.kind}: original rejected wire is not normalized`, () => {
      assert(FormativeConversationPlannedProposalOutputSchema.safeParse(attempt.wire).success);
      const rejected = request.output_schema.safeParse(attempt.wire);
      assert.equal(rejected.success, false);
      if (!rejected.success) {
        assert(rejected.error.issues.some(issue => issue.path.includes("source") && issue.path.includes("evidence_id")));
        assert(rejected.error.issues.some(issue => issue.path.includes("evidence_observations") && issue.path.includes("evidence_ids")));
      }
      assert.equal(attempt.original_candidate_text_available, false);
      assert(attempt.validation_issue_paths.includes("conversation_review.student_source_invalid"));
    });
    check(`${attempt.kind}: exact valid ID preserves canonical wire shape only`, () => {
      const authored = JSON.parse(JSON.stringify(attempt.wire).replaceAll(bad, good));
      assert.deepEqual(request.output_schema.parse(authored), FormativeConversationPlannedProposalOutputSchema.parse(authored));
    });
    check(`${attempt.kind}: valid but wrong source remains a semantic rejection`, () => {
      const authored = JSON.parse(JSON.stringify(attempt.wire).replaceAll(bad, good));
      const need = authored.post_reply_review.need_updates.find((entry: { need_id: string }) => entry.need_id === "need_sem_issue_36");
      need.source.evidence_id = ids.find(id => id !== good)!;
      assert(request.output_schema.safeParse(authored).success);
      const projection = projectConversationContinuityWire(authored, context);
      assert(projection.output);
      assert(conversationContinuityIssues(FormativeConversationV18R2AgentOutputSchema.parse(projection.output), context, { required: true })
        .includes("conversation_review.student_source_invalid"));
    });
  }
  const invalidAttempt = FormativeConversationV18R2LogicalCallAuditSchema.parse({
    sequence: 1, kind: "base", logical_call_id: "offline-invalid", canonical_request_hash: "0".repeat(64),
    result_status: "completed", failure_class: "parsed_semantic_contract_failure", accepted: false,
    logical_call_entered: true, pre_dispatch_request_rejection_count: 0, http_request_count: 1,
    provider_response_completed_count: 1, provider_attempt_count: 1, transport_retry_count: 0,
    parsed_candidate_count: 1, semantically_accepted_candidate_count: 0, provider_request_id: null,
    provider_response_id: null, client_request_id: "offline-invalid", incomplete_reason: null,
    latency_ms: 0, input_tokens: null, output_tokens: null, total_tokens: null,
    invalid_candidate: { candidate_hash: null, candidate_json: fixture.attempts[0].wire, candidate_text: null,
      validation_status: "semantic_contract_invalid", validation_issue_paths: ["conversation_review.student_source_invalid"] }
  });
  const repair = buildFormativeConversationV18R2SemanticRegenerationRequest({
    base_request: request, invalid_attempt: invalidAttempt, client_request_id: "offline-repair" });
  check("single repair inherits identical constrained output schema and policy", () => {
    assert.equal(repair.output_schema, request.output_schema);
    assert.deepEqual(compileProductionStructuredAgentRequest(repair).text?.format, format);
    const repairMetadata: Record<string, unknown> = repair.metadata ?? {};
    assert.equal(repairMetadata.evidence_id_request_schema, EVIDENCE_ID_REQUEST_SCHEMA_VERSION);
    assert.equal(repair.output_schema.safeParse(fixture.attempts[1].wire).success, false);
  });
  check("all scalar and array citation names are constrained while ordinary shared strings stay free", () => {
    const text = z.string().min(1);
    const example = z.object({ evidence_id: text, evidence_ids: z.array(text), canonical_evidence_ids: z.array(text),
      source_evidence_id: text, evidence_reference: text.nullable(), source_evidence_references: z.array(text), prose: text }).strict();
    const constrained = evidenceIdRequestSchema(example, [good], "citation_leaf_control");
    const valid = { evidence_id: good, evidence_ids: [], canonical_evidence_ids: [], source_evidence_id: good,
      evidence_reference: null, source_evidence_references: [], prose: "ordinary words" };
    assert.deepEqual(constrained.parse(valid), valid);
    for (const field of ["evidence_id", "source_evidence_id", "evidence_reference"]) assert(!constrained.safeParse({ ...valid, [field]: bad }).success);
    for (const field of ["evidence_ids", "canonical_evidence_ids", "source_evidence_references"]) assert(!constrained.safeParse({ ...valid, [field]: [bad] }).success);
  });
  check("strict keys, bounds and refinements survive the request clone", () => {
    const example = z.object({ evidence_ids: z.array(z.string()).max(1).refine(values => values.length === 1) }).strict();
    const constrained = evidenceIdRequestSchema(example, [good], "preserved_constraints");
    assert(!constrained.safeParse({ evidence_ids: [] }).success);
    assert(!constrained.safeParse({ evidence_ids: [good, good] }).success);
    assert(!constrained.safeParse({ evidence_ids: [good], extra: true }).success);
  });
  check("explicit null union branch is preserved without allowing unknown IDs", () => {
    const constrained = evidenceIdRequestSchema(z.object({ evidence_reference: z.union([z.string(), z.null()]) }).strict(), [good], "null_union");
    assert(constrained.safeParse({ evidence_reference: null }).success);
    assert(constrained.safeParse({ evidence_reference: good }).success);
    assert(!constrained.safeParse({ evidence_reference: bad }).success);
  });
  for (const [name, values] of [["empty", []], ["duplicate", [good, good]], ["malformed", ["not-an-evidence-id"]]] as const) {
    check(`${name} catalog fails before dispatch without fallback`, () => {
      assert.throws(() => evidenceIdRequestSchema(FormativeConversationPlannedProposalOutputSchema, values, schemaName), /catalog_invalid/);
    });
  }
  check("actual compiled aggregate rejects oversized catalog without truncation", () => {
    const large = Array.from({ length: 300 }, (_, index) => `ev_${index.toString(16).padStart(24, "0")}`);
    assert.throws(() => evidenceIdRequestSchema(FormativeConversationPlannedProposalOutputSchema, large, schemaName), /aggregate_limit_exceeded/);
    assert.equal(large.length, 300);
  });
  check("aggregate enum at-limit and one-over boundaries", () => {
    assert.equal(evidenceIdRequestSchemaLimits({ enum: Array(1_000).fill(0) }).enum_values, 1_000);
    assert.throws(() => evidenceIdRequestSchemaLimits({ enum: Array(1_001).fill(0) }), /aggregate_limit_exceeded/);
  });
  check("compiled string and single-enum limits fail closed", () => {
    assert.equal(evidenceIdRequestSchemaLimits({ const: "x".repeat(120_000) }).string_characters, 120_000);
    assert.throws(() => evidenceIdRequestSchemaLimits({ const: "x".repeat(120_001) }), /aggregate_limit_exceeded/);
    assert.throws(() => evidenceIdRequestSchemaLimits({ enum: Array(251).fill("x".repeat(60)) }), /single_enum_limit_exceeded/);
  });
  check("canonical schema and exact native fixture remain unchanged", () => {
    assert.equal(JSON.stringify(zodTextFormat(FormativeConversationPlannedProposalOutputSchema, schemaName)), originalSchema);
    assert.equal(JSON.stringify(fixture), originalFixture);
    const hash = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
    assert.equal(hash(raw), hash(raw.replace(/\r?\n/g, "\r\n")));
    assert.equal(networkCalls, 0);
  });
  console.log(JSON.stringify({ status: "passed", checks, network_calls: networkCalls,
    limitation: "Constrained membership prevents invalid IDs; it does not establish that a valid ID or a learning claim is substantively correct." }));
} finally { globalThis.fetch = originalFetch; }
