import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { zodTextFormat } from "openai/helpers/zod";
import { compileProductionStructuredAgentRequest } from "../src/lib/agents/provider-request";
import type { StructuredAgentRequest, StructuredAgentResult } from "../src/lib/llm/providers/types";
import { canonicalStructuredAgentRequestHash } from "../src/lib/llm/provider-transport-retry";
import type { FormativeConversationDeliveryReviewConfig } from "../src/lib/llm/config";
import { LUNA_SOL_DELIVERY_REVIEW_POLICY_VERSION } from "../src/lib/operational/luna-conversation-repair-identity";
import { FormativeConversationV18R2AgentOutputSchema } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { FormativeConversationPlannedProposalOutputSchema, FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION } from "../src/lib/services/student-assessment/formative-conversation/profile-update-proposal";
import { CONVERSATION_DELIVERY_REVIEW_VERSION, CONVERSATION_DELIVERY_REVIEW_PROMPT_HASH, ConversationDeliveryReviewSchema, ConversationDeliveryReviewV1Schema, ConversationDeliveryReviewV2Schema, ConversationDeliveryReviewV3Schema, ConversationDeliveryReviewV4Schema, ConversationDeliveryReviewV5Schema, ConversationDeliveryReviewInputV4Schema, ConversationDeliveryReviewInputSchema, buildConversationDeliveryReviewInput, buildConversationDeliveryDraftBlocks, validateConversationDeliveryReview, type ConversationDeliveryReviewInput } from "../src/lib/services/student-assessment/formative-conversation/conversation-continuity";
import { buildFormativeConversationDeliveryReviewRequest, createSingleAttemptFormativeConversationV18R2Execution,
  executeFormativeConversationV18R2, FormativeConversationV18R2ExecutionError,
  type FormativeConversationDeliveryReviewAudit,
  FORMATIVE_CONVERSATION_DELIVERY_REVIEW_ACCOUNTING_VERSION } from "../src/lib/services/student-assessment/formative-conversation/execution-v18r2";
import { ConversationDeliveryReviewV6Schema, ConversationDeliveryReviewV7Schema, buildConversationDeliveryReviewInputV6 } from "../src/lib/services/student-assessment/formative-conversation/conversation-continuity";
import { v18r2TestContext as historicalTestContext, v18r2TestContinueOutput } from "./formative-conversation-v18r2-test-fixtures";

function v18r2TestContext(input: Parameters<typeof historicalTestContext>[0]) {
  const value = historicalTestContext(input);
  value.administered_items = value.assessment_response_evidence.map((item, index) => ({
    item_public_id: item.item_public_id, item_number: index + 1, item_stem: "Synthetic administered item.",
    options: [{ label: "A", text: "Synthetic option A." }, { label: "B", text: "Synthetic option B." }],
    student_answer: item.selected_option, correct_answer: "A", concise_explanation: "Private synthetic key not forwarded.", administered: true
  }));
  return value;
}

globalThis.fetch = async () => { throw new Error("Offline delivery review checks cannot call a provider"); };
let checks = 0;
function check(name: string, fn: () => void) { fn(); checks++; console.log(`PASS ${name}`); }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const context = v18r2TestContext({ student_turn_count: 1, student_messages: ["Give me a brief reminder of our conversation, not a new test."],
  tutor_messages: ["We discussed reliability and validity."] });
const draft = "We paused before discussing SEM.";
const goodDraft = "We discussed reliability and validity.";
const protocolAudit = (text: string) => buildConversationDeliveryDraftBlocks(text).map(block => ({
  block_id: block.block_id, assessment: "no_teaching_claims", check: "Authored protocol fixture: this block records conversational scope, not instructional truth."
}));
const pass = { private_learning_audit: [], version: CONVERSATION_DELIVERY_REVIEW_VERSION, teaching_block_audit: protocolAudit(draft), verdict: "pass", findings: [] };
const reject = { private_learning_audit: [], version: CONVERSATION_DELIVERY_REVIEW_VERSION, teaching_block_audit: protocolAudit(draft), verdict: "reject", findings: [{
  kind: "unsupported_pause_agenda", draft_quote: draft,
  draft_block_id: 1,
  source_refs: [{ sequence_index: context.visible_transcript.at(-1)!.sequence_index, actor: "student", quote: context.latest_student_message }],
  rationale: "The visible conversation has no agreed SEM agenda; this request asks only for a reminder."
}] };
const base = {
  agent_name: "formative_conversation_agent", model_config: { model_name: "gpt-5.6-luna", reasoning_effort: "medium" as const, max_output_tokens: 7000 },
  instructions: "Synthetic offline tutor instruction.", input: context,
  output_schema: FormativeConversationV18R2AgentOutputSchema,
  schema_name: context.contract_version, client_request_id: "offline-delivery-review", timeout_ms: 12345,
  metadata: { private_test_metadata: "not forwarded to reviewer" }
};
const request = buildFormativeConversationDeliveryReviewRequest({ candidate: null, base_request: base, draft, sequence: 1 });
const mixedReviewConfig: FormativeConversationDeliveryReviewConfig = {
  model_config: { model_name: "gpt-6.1-sol", reasoning_effort: "medium", max_output_tokens: 4000 },
  policy_version: LUNA_SOL_DELIVERY_REVIEW_POLICY_VERSION
};
check("explicit mixed policy is encoded before the child request is hashed or compiled, without changing primary", () => {
  const original = structuredClone(base.model_config);
  const mixed = buildFormativeConversationDeliveryReviewRequest({ candidate: null, base_request: base, draft, sequence: 1,
    delivery_review_config: mixedReviewConfig });
  assert.deepEqual(base.model_config, original);
  assert.deepEqual(mixed.model_config, mixedReviewConfig.model_config);
  assert.deepEqual(mixed.input, request.input);
  assert.equal(mixed.instructions, request.instructions); assert.equal(mixed.schema_name, request.schema_name);
  assert.equal(mixed.agent_name, base.agent_name); assert.equal(mixed.timeout_ms, base.timeout_ms);
  assert.equal(mixed.metadata!.execution_policy_version, LUNA_SOL_DELIVERY_REVIEW_POLICY_VERSION);
  assert(!Object.hasOwn(request.metadata!, "execution_policy_version"));
  const body = compileProductionStructuredAgentRequest(mixed);
  assert.equal(body.model, "gpt-6.1-sol"); assert.equal(body.max_output_tokens, 4000);
  assert.notEqual(canonicalStructuredAgentRequestHash(mixed), canonicalStructuredAgentRequestHash(request));
  assert.notEqual(canonicalStructuredAgentRequestHash(mixed), canonicalStructuredAgentRequestHash({ ...mixed, metadata: request.metadata }));
});
check("review request includes only exact student initial reasoning and visible dialogue, not keys/profile/plans", () => {
  assert.deepEqual(Object.keys(request.input), ["initial_student_reasoning", "visible_transcript", "latest_student_message", "draft_message", "draft_blocks", "proposed_learning_claims"]);
  assert.deepEqual(request.input.initial_student_reasoning, context.assessment_response_evidence.map(item => ({ item_public_id: item.item_public_id, written_reasoning: item.written_reasoning })));
  assert.equal(request.input.draft_blocks.map(block => block.text).join(""), draft);
  assert.deepEqual(Object.keys(request.input.visible_transcript[0]), ["sequence_index", "actor", "message_text"]);
  assert.equal(request.input.latest_student_message, context.latest_student_message);
  assert.equal(request.input.draft_message, draft);
  assert(!Object.hasOwn(request.input, "current_profile"));
  assert(!Object.hasOwn(request.metadata!, "private_test_metadata"));
  assert(!request.input_encoding);
});
check("review keeps exact tutor role/model/effort and timeout with a bounded 4000 token cap", () => {
  assert.equal(request.agent_name, base.agent_name); assert.equal(request.model_config.model_name, "gpt-5.6-luna");
  assert.equal(request.model_config.reasoning_effort, "medium"); assert.equal(request.model_config.max_output_tokens, 4000);
  assert.equal(request.timeout_ms, base.timeout_ms); assert.equal(base.model_config.max_output_tokens, 7000);
  const lower = buildFormativeConversationDeliveryReviewRequest({ candidate: null, base_request: { ...base, model_config: { ...base.model_config, max_output_tokens: 1000 } }, draft, sequence: 1 });
  assert.equal(lower.model_config.max_output_tokens, 1000);
  assert.equal(request.metadata!.prompt_hash, CONVERSATION_DELIVERY_REVIEW_PROMPT_HASH);
});
check("explicit legacy inheritance preserves 2500 while current mixed policy rejects that old cap", () => {
  const legacy = buildFormativeConversationDeliveryReviewRequest({ candidate: null, base_request: base, draft, sequence: 1,
    delivery_review_config: { model_config: { ...base.model_config, max_output_tokens: 2500 }, policy_version: null } });
  assert.equal(legacy.model_config.max_output_tokens, 2500);
  assert.equal(legacy.model_config.model_name, base.model_config.model_name);
  assert(!Object.hasOwn(legacy.metadata!, "execution_policy_version"));
  assert.throws(() => buildFormativeConversationDeliveryReviewRequest({ candidate: null, base_request: base, draft, sequence: 1,
    delivery_review_config: { ...mixedReviewConfig, model_config: { ...mixedReviewConfig.model_config, max_output_tokens: 2500 } } }),
    /delivery_review_policy_invalid/);
});
check("actual review request compiles strict Responses schema", () => {
  const body = compileProductionStructuredAgentRequest(request);
  assert.equal(body.model, "gpt-5.6-luna"); assert.equal(body.max_output_tokens, 4000);
  const format = zodTextFormat(ConversationDeliveryReviewSchema, CONVERSATION_DELIVERY_REVIEW_VERSION);
  assert.equal(format.schema.type, "object");
  const inspect = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (object.type === "object") { assert.equal(object.additionalProperties, false); assert.deepEqual([...(object.required as string[])].sort(), Object.keys(object.properties as object).sort()); }
    Object.values(object).forEach(inspect);
  }; inspect(format.schema);
});
check("current V8 block audits compile before verdict while explicit V1 through V7 history stays unchanged", () => {
  const historical = { version: "conversation-delivery-review-v1", verdict: "pass", findings: [] };
  assert(ConversationDeliveryReviewV1Schema.safeParse(historical).success);
  assert(!ConversationDeliveryReviewSchema.safeParse(historical).success);
  assert(!validateConversationDeliveryReview(historical, context, draft, null).accepted);
  const v2 = { ...historical, version: "conversation-delivery-review-v2" };
  assert(ConversationDeliveryReviewV2Schema.safeParse(v2).success);
  assert(!ConversationDeliveryReviewSchema.safeParse(v2).success);
  assert(!ConversationDeliveryReviewV2Schema.safeParse(pass).success);
  const v3 = { ...v2, version: "conversation-delivery-review-v3", teaching_claim_audit: { scope: "no_teaching_claims", checks: [] } };
  assert(ConversationDeliveryReviewV3Schema.safeParse(v3).success);
  assert(!ConversationDeliveryReviewSchema.safeParse(v3).success);
  const {private_learning_audit: emptyPrivate, ...historicalPass} = pass; assert.deepEqual(emptyPrivate, []);
  const v7 = { ...pass, version: "conversation-delivery-review-v7" };
  assert(ConversationDeliveryReviewV7Schema.safeParse(v7).success);
  assert(!ConversationDeliveryReviewSchema.safeParse(v7).success);
  const longV7Check = { ...v7, teaching_block_audit: [{ ...v7.teaching_block_audit[0], check: "x".repeat(240) }] };
  assert(ConversationDeliveryReviewV7Schema.safeParse(longV7Check).success);
  assert(!ConversationDeliveryReviewSchema.safeParse({ ...longV7Check, version: CONVERSATION_DELIVERY_REVIEW_VERSION }).success);
  assert(ConversationDeliveryReviewV6Schema.safeParse({...historicalPass,version:"conversation-delivery-review-v6"}).success);
  assert(ConversationDeliveryReviewV4Schema.safeParse({...historicalPass,version:"conversation-delivery-review-v4"}).success);
  assert(!ConversationDeliveryReviewSchema.safeParse({...pass,version:"conversation-delivery-review-v4"}).success);
  assert(ConversationDeliveryReviewV5Schema.safeParse({...historicalPass,version:"conversation-delivery-review-v5"}).success);
  assert(!ConversationDeliveryReviewSchema.safeParse({...pass,version:"conversation-delivery-review-v5"}).success);
  const {initial_student_reasoning: omitted, ...v4Input} = buildConversationDeliveryReviewInputV6(context,draft); assert(omitted.length);
  assert(ConversationDeliveryReviewInputV4Schema.safeParse(v4Input).success);
  assert(!ConversationDeliveryReviewInputSchema.safeParse(v4Input).success);
  const accuracy = { ...reject, findings: [{ ...reject.findings[0], kind: "teaching_accuracy_error" }] };
  const compiled = zodTextFormat(ConversationDeliveryReviewSchema, CONVERSATION_DELIVERY_REVIEW_VERSION).schema;
  assert.deepEqual(Object.keys(compiled.properties!), ["version", "teaching_block_audit", "private_learning_audit", "verdict", "findings"]);
  const validate = new Ajv({ allErrors: true }).compile(compiled);
  assert(validate(accuracy)); assert(!validate(historical));
  assert(!validate({ version: CONVERSATION_DELIVERY_REVIEW_VERSION, verdict: "pass", findings: [] }));
  assert(!ConversationDeliveryReviewV1Schema.safeParse({ ...accuracy, version: historical.version }).success);
  assert(!validate({ ...accuracy, findings: [{ ...accuracy.findings[0], kind: "uncertain_teaching_style" }] }));
  assert(!validate({ ...accuracy, corrected_reply: "Cannot author or replace teaching." }));
});
check("initial reasoning preserves exact whitespace/Markdown and null without transferring protected fields", () => {
  const local = structuredClone(context);
  local.assessment_response_evidence[0].written_reasoning = "  **Student** reasoning\r\nexactly.  ";
  local.assessment_response_evidence[1].written_reasoning = null;
  const input = buildConversationDeliveryReviewInput(local,draft, null);
  assert.equal(input.initial_student_reasoning[0].written_reasoning,"  **Student** reasoning\r\nexactly.  ");
  assert.equal(input.initial_student_reasoning[1].written_reasoning,null);
  input.initial_student_reasoning.forEach(item => assert.deepEqual(Object.keys(item),["item_public_id","written_reasoning"]));
  assert(!JSON.stringify(input).includes("Private synthetic key not forwarded"));
  input.initial_student_reasoning[0].written_reasoning = "Changed copy";
  assert.equal(local.assessment_response_evidence[0].written_reasoning,"  **Student** reasoning\r\nexactly.  ");
});
check("exact initial source refs ground authored attribution findings without asserting model discrimination", () => {
  const local = structuredClone(context); local.assessment_response_evidence[0].written_reasoning = "I subtract three to find the exact true score.";
  const text = "Your initial reasoning said subtraction cannot reveal the exact true score.";
  const source = {source_kind:"initial_student_reasoning",item_public_id:local.assessment_response_evidence[0].item_public_id,quote:"I subtract three to find the exact true score."};
  const review = {...pass,teaching_block_audit:protocolAudit(text),verdict:"reject",findings:[{kind:"unsupported_conversation_history",draft_block_id:1,draft_quote:text,source_refs:[source],rationale:"The draft reverses the supplied student's actual initial reasoning."}]};
  assert.equal(validateConversationDeliveryReview(review,local,text, null).valid,true);
  assert.equal(validateConversationDeliveryReview(review,local,text, null).accepted,false);
  for (const changed of [{...source,item_public_id:"another-item"},{...source,quote:"I did not subtract three."},{...source,sequence_index:1},{...source,source_kind:"profile"}]) {
    assert.equal(validateConversationDeliveryReview({...review,findings:[{...review.findings[0],source_refs:[changed]}]},local,text, null).valid,false);
  }
  const missing = structuredClone(local); missing.assessment_response_evidence[0].written_reasoning = null;
  assert.equal(validateConversationDeliveryReview(review,missing,text, null).valid,false);
  assert.equal(validateConversationDeliveryReview({...review,findings:[{...review.findings[0],source_refs:[source,source]}]},local,text, null).valid,false);
});
check("unadministered and duplicated baseline IDs reject instead of supplying unrelated assessment text", () => {
  const foreign = structuredClone(context); foreign.assessment_response_evidence[0].item_public_id = "foreign-topic-item";
  assert.throws(()=>buildConversationDeliveryReviewInput(foreign,draft, null),/initial_scope_invalid/);
  const duplicate = structuredClone(context); duplicate.assessment_response_evidence.push(structuredClone(duplicate.assessment_response_evidence[0]));
  assert.throws(()=>buildConversationDeliveryReviewInput(duplicate,draft, null),/Duplicate initial student reasoning source/);
});
check("draft blocks preserve every byte across multiline Markdown, Unicode, whitespace and bounded merging", () => {
  for (const text of ["\r\n# 标题🙂\r\n\r\n- **First:** α ≠ β.\r\n- Second with a qualification.\r\n", "   ", "x".repeat(12_000),
    Array.from({ length: 40 }, (_, i) => `- Unit ${i}: premise and qualification remain visible.\n`).join("")]) {
    const blocks = buildConversationDeliveryDraftBlocks(text);
    assert(blocks.length > 0 && blocks.length <= 12);
    assert.equal(Buffer.compare(Buffer.from(blocks.map(block => block.text).join("")), Buffer.from(text)), 0);
    assert.deepEqual(blocks.map(block => block.block_id), blocks.map((_, i) => i + 1));
    for (const block of blocks) assert.equal(block.sha256, createHash("sha256").update(block.text, "utf8").digest("hex"));
    assert.deepEqual(buildConversationDeliveryDraftBlocks(text), blocks);
  }
  assert.equal(buildConversationDeliveryDraftBlocks("one\n\n- two\n- three").length, 3);
  assert.equal(buildConversationDeliveryDraftBlocks(Array.from({ length: 40 }, () => "line\n").join("")).length, 12);
});
check("input rejects missing, reordered, duplicate, tampered, noncovering and wrongly hashed blocks", () => {
  const text = "First premise.\nSecond qualification.\nThird conclusion.";
  const input = { ...request.input, draft_message: text, draft_blocks: buildConversationDeliveryDraftBlocks(text) };
  assert(ConversationDeliveryReviewInputSchema.safeParse(input).success);
  for (const blocks of [input.draft_blocks.slice(1), [...input.draft_blocks].reverse(), [...input.draft_blocks, input.draft_blocks[0]],
    input.draft_blocks.map((block, i) => i ? block : { ...block, text: block.text + "invented" }),
    input.draft_blocks.map((block, i) => i ? block : { ...block, sha256: "a".repeat(64) })]) {
    assert(!ConversationDeliveryReviewInputSchema.safeParse({ ...input, draft_blocks: blocks }).success);
  }
  assert(!ConversationDeliveryReviewInputSchema.safeParse({ ...input, draft_message: "x".repeat(12_001) }).success);
});
check("seven material-error blocks can express a grounded rejection without exceeding the twelve-block contract", () => {
  const text = Array.from({ length: 7 }, (_, i) => `Synthetic false claim ${i + 1}.`).join("\n");
  const blocks = buildConversationDeliveryDraftBlocks(text);
  const review = { private_learning_audit: [], version: CONVERSATION_DELIVERY_REVIEW_VERSION,
    teaching_block_audit: blocks.map(block => ({ block_id: block.block_id, assessment: "material_error", check: "Authored protocol defect." })),
    verdict: "reject", findings: blocks.map(block => ({ kind: "teaching_accuracy_error", draft_block_id: block.block_id,
      draft_quote: block.text.trim(), source_refs: reject.findings[0].source_refs, rationale: "Authored defect used to check the full bounded rejection contract." })) };
  assert.equal(validateConversationDeliveryReview(review, context, text, null).valid, true);
  assert.equal(validateConversationDeliveryReview(review, context, text, null).accepted, false);
  const historicalFindings = review.findings.map(finding => ({ kind: finding.kind, draft_quote: finding.draft_quote,
    source_refs: finding.source_refs, rationale: finding.rationale }));
  assert(!ConversationDeliveryReviewV2Schema.safeParse({ version: "conversation-delivery-review-v2", verdict: "reject", findings: historicalFindings }).success);
  assert(!ConversationDeliveryReviewV3Schema.safeParse({ version: "conversation-delivery-review-v3", teaching_claim_audit: { scope: "no_teaching_claims", checks: [] }, verdict: "reject", findings: historicalFindings }).success);
});

type ReviewResult = { status?: StructuredAgentResult<unknown>["status"]; output?: unknown; wrongHash?: boolean; transportRetry?: boolean; throwError?: boolean; missingUsage?: boolean };
async function run(reviews: ReviewResult[], options: { context?: typeof context; drafts?: string[]; invalidFirst?: boolean; missingCallback?: boolean; planned?: boolean; wrongContext?: boolean; deliveryReviewConfig?: FormativeConversationDeliveryReviewConfig } = {}) {
  const localContext = structuredClone(options.context ?? context);
  if (options.wrongContext) localContext.latest_student_message = "Not the last actual turn";
  const baseRequest: StructuredAgentRequest<typeof context, unknown> = { ...base, input: localContext,
    ...(options.planned ? { schema_name: FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION, output_schema: FormativeConversationPlannedProposalOutputSchema } : {}) };
  const tutorRequests: StructuredAgentRequest<unknown, unknown>[] = [];
  const reviewRequests: StructuredAgentRequest<unknown, unknown>[] = [];
  let validationCount = 0;
  const execute = executeFormativeConversationV18R2({ base_request: baseRequest,
    delivery_review_config: options.deliveryReviewConfig,
    validate_candidate() { const invalid = options.invalidFirst && validationCount++ === 0;
      return { valid: !invalid, validation_status: invalid ? "semantic_contract_invalid" : "valid", validation_issue_paths: invalid ? ["synthetic_prior_contract_error"] : [] }; },
    async execute_logical_generation({ request: attempted, sequence }) {
      tutorRequests.push(attempted);
      const output = { ...v18r2TestContinueOutput({ context: localContext, include_observation: false }), student_visible_message: options.drafts?.[sequence - 1] ?? (sequence === 1 ? draft : goodDraft) };
      const result: StructuredAgentResult<unknown> = { provider: "openai", status: "completed", client_request_id: attempted.client_request_id,
        provider_response_id: `tutor-${sequence}`, parsed_output: output, raw_output: { output_text: JSON.stringify(output) },
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }, latency_ms: 10 };
      return { ...createSingleAttemptFormativeConversationV18R2Execution({ request: attempted, result, logical_call_id: `tutor-${sequence}` }), http_request_count: 1, provider_response_completed_count: 1 };
    },
    ...(options.missingCallback ? {} : { async execute_delivery_review({ request: attempted, sequence }: { request: StructuredAgentRequest<unknown, unknown>; sequence: number }) {
      reviewRequests.push(attempted);
      const chosen = reviews[reviewRequests.length - 1]; assert(chosen, "unexpected extra review");
      if (chosen.throwError) throw new Error("Unexpected adapter exception: must not leak provider error text");
      const output = chosen.output ?? pass;
      const result: StructuredAgentResult<unknown> = { provider: "openai", status: chosen.status ?? "completed",
        client_request_id: `${attempted.client_request_id}:adapter-retry-id`, provider_response_id: `review-${sequence}`,
        parsed_output: output, raw_output: { output_text: JSON.stringify(output) },
        ...(chosen.missingUsage ? {} : { usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30, cached_input_tokens: 5, reasoning_tokens: 2 } }), latency_ms: 3 };
      return { ...createSingleAttemptFormativeConversationV18R2Execution({ request: attempted, result, logical_call_id: `review-${sequence}` }),
        canonical_request_hash: chosen.wrongHash ? "a".repeat(64) : canonicalStructuredAgentRequestHash(attempted),
        http_request_count: chosen.transportRetry ? 2 : 1, provider_response_completed_count: 1,
        provider_attempt_count: chosen.transportRetry ? 2 : 1, transport_retry_count: chosen.transportRetry ? 1 : 0 };
    } })
  });
  try { return { result: await execute, error: null, tutorRequests, reviewRequests }; }
  catch (error) { return { result: null, error, tutorRequests, reviewRequests }; }
}

async function main() {
  for (const config of [
    { ...mixedReviewConfig, policy_version: null },
    { ...mixedReviewConfig, policy_version: "unapproved-policy" },
    ...[{ model_name: "gpt-5.6-luna" }, { reasoning_effort: "high" }, { max_output_tokens: 7000 }, { temperature: 0.1 }]
      .map(change => ({ ...mixedReviewConfig, model_config: { ...mixedReviewConfig.model_config, ...change } }))
  ]) {
    const blocked = await run([], { deliveryReviewConfig: config as FormativeConversationDeliveryReviewConfig });
    assert(blocked.error instanceof Error);
    assert.equal(blocked.error.message, "formative_conversation_delivery_review_policy_invalid");
    assert.equal(blocked.tutorRequests.length, 0); assert.equal(blocked.reviewRequests.length, 0);
  }
  check("unapproved child model, unknown policy, effort, budget or sampling overrides reject before any dispatch", () => {});
  check("mixed child policy cannot attach to another primary model or exceed its approved allowance", () => {
    for (const model_config of [{ ...base.model_config, model_name: "gpt-6.1-sol" },
      { ...base.model_config, reasoning_effort: "low" as const }, { ...base.model_config, max_output_tokens: 1000 }]) {
      assert.throws(() => buildFormativeConversationDeliveryReviewRequest({ candidate: null, base_request: { ...base, model_config }, draft, sequence: 1,
        delivery_review_config: mixedReviewConfig }), /delivery_review_policy_invalid/);
    }
    assert.throws(() => buildFormativeConversationDeliveryReviewRequest({ candidate: null, base_request: { ...base, agent_name: "student_profiling_agent" }, draft, sequence: 1,
      delivery_review_config: mixedReviewConfig }), /delivery_review_policy_invalid/);
  });
  const mixedRepaired = await run([{ output: reject }, { output: pass }], { deliveryReviewConfig: mixedReviewConfig });
  check("mixed reviews preserve both Sol costs and Luna drafts across the single tutor repair", () => {
    assert(mixedRepaired.result); assert.equal(mixedRepaired.result.total_tokens, 360);
    assert.equal(mixedRepaired.result.audit.logical_calls_entered, 4);
    assert.equal(mixedRepaired.result.audit.semantic_regeneration_calls, 1);
    assert.equal(mixedRepaired.tutorRequests.length, 2); assert.equal(mixedRepaired.reviewRequests.length, 2);
    for (const primary of mixedRepaired.tutorRequests) assert.deepEqual(primary.model_config, base.model_config);
    for (const [index, child] of mixedRepaired.reviewRequests.entries()) {
      assert.deepEqual(child.model_config, mixedReviewConfig.model_config);
      const audit: FormativeConversationDeliveryReviewAudit = mixedRepaired.result.audit.attempts[index].pre_delivery_review!;
      assert.equal(audit.model_name, "gpt-6.1-sol"); assert.equal(audit.reasoning_effort, "medium");
      assert.equal(audit.execution_policy_version, LUNA_SOL_DELIVERY_REVIEW_POLICY_VERSION);
      assert.equal(audit.canonical_request_hash, canonicalStructuredAgentRequestHash(child));
      assert.equal(audit.total_tokens, 30); assert.equal(audit.input_tokens, 20); assert.equal(audit.output_tokens, 10);
      assert.deepEqual(audit.raw_output, { output_text: JSON.stringify(index === 0 ? reject : pass) });
    }
  });
  const mixedOpening = await run([], { context: v18r2TestContext({ student_turn_count: 0 }), deliveryReviewConfig: mixedReviewConfig });
  check("mixed opening honestly records intended child policy with zero child requests or usage", () => {
    assert(mixedOpening.result); const audit = mixedOpening.result.audit.attempts[0].pre_delivery_review!;
    assert.equal(audit.status, "skipped_opening"); assert.equal(audit.model_name, "gpt-6.1-sol");
    assert.equal(audit.execution_policy_version, LUNA_SOL_DELIVERY_REVIEW_POLICY_VERSION);
    assert.equal(audit.logical_call_entered, false); assert.equal(audit.total_tokens, null);
    assert.equal(audit.http_request_count, 0); assert.equal(mixedOpening.reviewRequests.length, 0);
  });
  const mixedMissing = await run([], { deliveryReviewConfig: mixedReviewConfig, missingCallback: true });
  check("an explicit mixed policy cannot bypass its reviewer with a historical output schema", () => {
    assert(mixedMissing.error instanceof Error); assert.equal(mixedMissing.error.message, "formative_conversation_delivery_review_runner_required");
    assert.equal(mixedMissing.tutorRequests.length, 0);
  });
  const mixedUnknown = await run([{ missingUsage: true }], { deliveryReviewConfig: mixedReviewConfig });
  check("missing mixed child usage remains unknown instead of being priced or counted as free", () => {
    assert(mixedUnknown.result); assert.equal(mixedUnknown.result.total_tokens, 150);
    assert.equal(mixedUnknown.result.audit.attempts[0].pre_delivery_review!.total_tokens, null);
    assert.equal(mixedUnknown.result.audit.usage_accounting_complete, false);
    assert.equal(mixedUnknown.result.audit.attempts[0].pre_delivery_review!.model_name, "gpt-6.1-sol");
  });
  const inherited = await run([{ output: pass }], { deliveryReviewConfig: {
    model_config: { ...base.model_config, max_output_tokens: 4000 }, policy_version: null } });
  check("explicit current inheritance retains its request identity and unmarked receipt", () => {
    assert(inherited.result);
    const expected = buildFormativeConversationDeliveryReviewRequest({base_request:base,draft,sequence:1,candidate:inherited.result.result.parsed_output!});
    assert.equal(canonicalStructuredAgentRequestHash(inherited.reviewRequests[0]), canonicalStructuredAgentRequestHash(expected));
    assert(!Object.hasOwn(inherited.result.audit.attempts[0].pre_delivery_review!, "execution_policy_version"));
  });
  for (const fixtureName of ["conversation-teaching-accuracy-native.json", "conversation-teaching-accuracy-native-v14.json"]) {
  const fixturePath = new URL(`./fixtures/${fixtureName}`, import.meta.url);
  const nativeBytes = readFileSync(fixturePath);
  const fixture = JSON.parse(nativeBytes.toString("utf8")) as { synthetic_only: boolean; real_student_records_used: boolean; cases: Array<{
    id: string; input: Omit<ConversationDeliveryReviewInput, "draft_blocks">; historical_scope_only_review?: unknown; historical_accuracy_review?: unknown;
    paired_control: { id: string; authored_synthetic: boolean; input: Omit<ConversationDeliveryReviewInput, "draft_blocks"> };
  }> };
  assert(fixture.synthetic_only && !fixture.real_student_records_used);
  assert.equal(fixture.cases.length, 2);
  for (const saved of fixture.cases) {
    const nativeContext = { ...structuredClone(context), latest_student_message: saved.input.latest_student_message,
      visible_transcript: saved.input.visible_transcript.map(turn => ({ ...turn, created_at: "2026-10-14T00:00:00.000Z" })) };
    const student = saved.input.visible_transcript.at(-1)!; assert.equal(student.actor, "student");
    const bad = saved.input.draft_message, good = saved.paired_control.input.draft_message;
    const constant = saved.id.includes("constant_score");
    const checkedQuote = saved.id === "repeated_constant_score_reliability_error" ? "**Reliable:** The same result appears every time."
      : saved.id === "repeated_offset_clock_inconsistency" ? "It gives the same wrong time every time, so it is consistent—but not correct."
      : bad.split("\n\n")[0];
    const finding = {
      kind: "teaching_accuracy_error", draft_quote: checkedQuote,
      draft_block_id: buildConversationDeliveryDraftBlocks(bad).find(block => block.text.includes(checkedQuote))!.block_id,
      source_refs: [{ sequence_index: student.sequence_index, actor: student.actor, quote: student.message_text }],
      rationale: constant
        ? "The question specifies the same score for every person. Repeatability does not establish a high ordinary reliability coefficient when observed-score variance is zero."
        : "A moving clock with a fixed offset advances with time; saying it shows the same displayed time on every check contradicts that premise."
    };
    const checks = buildConversationDeliveryDraftBlocks(bad).map(block => ({ block_id: block.block_id,
      assessment: block.block_id === finding.draft_block_id ? "material_error" : "supported",
      check: block.block_id === finding.draft_block_id
        ? constant ? "Zero observed-score variance prevents the asserted ordinary reliability conclusion."
          : "A moving fixed-offset clock cannot show an unchanged displayed time."
        : "Authored protocol check: this surrounding block does not establish or excuse the defective inference."
    }));
    const accuracyReject = { private_learning_audit: [], version: CONVERSATION_DELIVERY_REVIEW_VERSION,
      teaching_block_audit: checks, verdict: "reject", findings: [finding] };
    const goodPass = { ...pass, teaching_block_audit: buildConversationDeliveryDraftBlocks(good).map(block => ({
      block_id: block.block_id, assessment: "supported",
      check: constant ? "The reply distinguishes repeatability from a high reliability coefficient and describes the zero-variance limitation."
        : "The clock's reading changes with time while the offset remains fixed; the reply makes only this limited comparison."
    })) };
    check(`${saved.id}: exact native input and paired claim/finding checks validate without rewriting prior receipts`, () => {
      const built = buildFormativeConversationDeliveryReviewRequest({ candidate: null, base_request: { ...base, input: nativeContext }, draft: bad, sequence: 1 });
      const { draft_blocks, initial_student_reasoning, proposed_learning_claims, ...originalInput } = built.input;
      assert.equal(proposed_learning_claims.claim_count, 0);
      assert.deepEqual(initial_student_reasoning, nativeContext.assessment_response_evidence.map(item => ({ item_public_id: item.item_public_id, written_reasoning: item.written_reasoning })));
      assert.deepEqual(originalInput, saved.input);
      assert.equal(draft_blocks.map(block => block.text).join(""), bad);
      assert.equal(validateConversationDeliveryReview(accuracyReject, nativeContext, bad, null).valid, true);
      assert.equal(validateConversationDeliveryReview(accuracyReject, nativeContext, bad, null).accepted, false);
      const historical = saved.historical_scope_only_review ?? saved.historical_accuracy_review;
      assert((saved.historical_scope_only_review ? ConversationDeliveryReviewV1Schema : ConversationDeliveryReviewV2Schema).safeParse(historical).success);
      assert(!ConversationDeliveryReviewSchema.safeParse(historical).success);
    });
    check(`${saved.paired_control.id}: authored accurate control may pass without forced advanced explanation`, () => {
      assert(saved.paired_control.authored_synthetic);
      assert.deepEqual(saved.paired_control.input.visible_transcript, saved.input.visible_transcript);
      assert.equal(validateConversationDeliveryReview(goodPass, nativeContext, good, null).accepted, true);
      for (const changed of [
        { ...accuracyReject, findings: [{ ...finding, draft_quote: "This is not in the draft." }] },
        { ...accuracyReject, findings: [{ ...finding, source_refs: [] }] },
        { ...accuracyReject, findings: [{ ...finding, source_refs: [{ ...finding.source_refs[0], sequence_index: 999999 }] }] }
      ]) assert.equal(validateConversationDeliveryReview(changed, nativeContext, bad, null).valid, false);
    });
    const fixed = await run([{ output: accuracyReject }, { output: goodPass }], { context: nativeContext, drafts: [bad, good] });
    check(`${saved.id}: one accuracy rejection uses the existing repair, preserving both drafts and all four costs`, () => {
      assert(fixed.result); assert.equal(fixed.tutorRequests.length, 2); assert.equal(fixed.reviewRequests.length, 2);
      assert.equal(fixed.result.audit.semantic_regeneration_calls, 1); assert.equal(fixed.result.total_tokens, 360);
      assert.equal(fixed.result.result.parsed_output.student_visible_message, good);
      assert.equal(fixed.result.result.parsed_output.profile_transition_recommendation, null);
      const feedback = (fixed.tutorRequests[1].input as { semantic_regeneration: { delivery_review_feedback: { review: unknown; source_input: unknown } } }).semantic_regeneration.delivery_review_feedback;
      assert.deepEqual(feedback.review, accuracyReject);
      assert.deepEqual(feedback.source_input, buildConversationDeliveryReviewInput(nativeContext, bad, {...v18r2TestContinueOutput({context:nativeContext,include_observation:false}),student_visible_message:bad}));
      assert.equal(fixed.result.audit.attempts[0].pre_delivery_review!.review_output_sha256, hash(accuracyReject));
    });
    const exhaustedAccuracy = await run([{ output: accuracyReject }, { output: accuracyReject }], { context: nativeContext, drafts: [bad, bad] });
    check(`${saved.id}: repeated accuracy defect fails closed without a third tutor call or substitute response`, () => {
      assert(exhaustedAccuracy.error instanceof FormativeConversationV18R2ExecutionError);
      assert.equal(exhaustedAccuracy.error.failure_category, "semantic_regeneration_exhausted");
      assert.equal(exhaustedAccuracy.tutorRequests.length, 2); assert.equal(exhaustedAccuracy.reviewRequests.length, 2);
      assert.equal(exhaustedAccuracy.error.total_tokens, 360); assert.equal(exhaustedAccuracy.result, null);
    });
    check(`${saved.id}: block/finding disagreement, omitted or reordered blocks and incorrect quote locations fail closed`, () => {
      for (const changed of [
        { ...accuracyReject, teaching_block_audit: [] },
        { ...accuracyReject, teaching_block_audit: checks.filter(check => check.block_id !== finding.draft_block_id) },
        { ...accuracyReject, teaching_block_audit: [...checks].reverse() },
        { ...accuracyReject, teaching_block_audit: [...checks.slice(1), checks.at(-1)!] },
        { ...accuracyReject, verdict: "pass", findings: [] },
        { ...accuracyReject, teaching_block_audit: checks.map(check => ({ ...check, assessment: "supported" })) },
        { ...accuracyReject, teaching_block_audit: checks.map(check => ({ ...check, assessment: "uncertain" })) },
        { ...accuracyReject, findings: [{ ...finding, draft_block_id: 12 }] },
        { ...accuracyReject, findings: [{ ...finding, draft_quote: "Invented instructional statement." }] },
        { ...accuracyReject, findings: [{ ...finding, source_refs: [{ ...finding.source_refs[0], quote: "Invented source." }] }] }
      ]) assert.equal(validateConversationDeliveryReview(changed, nativeContext, bad, null).valid, false);
    });
    check(`${saved.paired_control.id}: uncertainty alone is not a rejection and the audit does not certify factual truth`, () => {
      const uncertain = { ...goodPass, teaching_block_audit: goodPass.teaching_block_audit.map(item => ({ ...item, assessment: "uncertain" })) };
      assert.equal(validateConversationDeliveryReview(uncertain, nativeContext, good, null).accepted, true);
      // Complete block coverage cannot decide whether a model's judgment is true.
      const falselySupported = { ...accuracyReject, verdict: "pass", findings: [], teaching_block_audit: checks.map(check => ({ ...check, assessment: "supported" })) };
      assert.equal(validateConversationDeliveryReview(falselySupported, nativeContext, bad, null).valid, true);
    });
  }
  check("native inaccurate outputs and prior scope-only verdicts remain byte-exact historical fixtures", () => {
    assert.deepEqual(readFileSync(fixturePath), nativeBytes);
  });
  }
  const assistedFixturePath = "prisma/fixtures/conversation-assisted-summary-native-v20.json";
  const assistedBytes = readFileSync(assistedFixturePath);
  const assisted = JSON.parse(assistedBytes.toString("utf8")) as {
    context: typeof context; output: { student_visible_message: string };
    review_input: ConversationDeliveryReviewInput; historical_review: unknown;
    controls: { id: string; authored_synthetic: boolean; draft_message: string; replacement_latest_student_message?: string }[];
  };
  const assistedDraft = assisted.output.student_visible_message;
  const transcriptSource = (sequence: number, quote: string) => {
    const turn = assisted.context.visible_transcript.find(turn => turn.sequence_index === sequence)!;
    assert(turn.message_text.includes(quote));
    return { sequence_index: sequence, actor: turn.actor, quote };
  };
  const learningFinding = { kind: "unsupported_learning_claim", draft_block_id: 1,
    draft_quote: "Understanding you demonstrated",
    source_refs: [
      transcriptSource(31, "The test may be consistently measuring reading skill, but reading skill is not enough evidence for this hiring decision."),
      transcriptSource(32, "The hiring score could keep measuring reading skill instead of job skill. We need to compare it with relevant job performance."),
      transcriptSource(35, "The scores could be stable, but we would still need relevant evidence that they actually support a wellbeing interpretation."),
      transcriptSource(36, "We would need other evidence to support the wellbeing interpretation.")
    ],
    rationale: "The draft presents restatements of supplied hiring and wellbeing reasoning as demonstrated understanding without preserving their assistance qualification."
  };
  const learningReject = { private_learning_audit: [], version: CONVERSATION_DELIVERY_REVIEW_VERSION,
    teaching_block_audit: protocolAudit(assistedDraft), verdict: "reject", findings: [learningFinding] };
  check("exact failed native learning recap and its historical V5 pass remain preserved", () => {
    const portable = assistedBytes.toString("utf8").replace(/\r\n/g, "\n");
    assert.equal(createHash("sha256").update(portable).digest("hex"), "bb3c908e129877871d6e8e57e15153f0a188dda0bfcb368b6e102231db74c85b");
    assert.deepEqual(buildConversationDeliveryReviewInputV6(assisted.context, assistedDraft), assisted.review_input);
    assert(ConversationDeliveryReviewV5Schema.safeParse(assisted.historical_review).success);
    assert(!ConversationDeliveryReviewSchema.safeParse(assisted.historical_review).success);
    assert(assisted.context.assistance_history, "The retained fixture must include its recorded assistance history");
    assert.equal(assisted.context.assistance_history.observations.filter(item => item.evidence_type === "supported_reasoning_recognition").length, 2);
  });
  check("learner overclaim can reject a non-instructional heading with exact prior help and student sources", () => {
    const result = validateConversationDeliveryReview(learningReject, assisted.context, assistedDraft, null);
    assert.equal(result.valid, true); assert.equal(result.accepted, false);
    assert(!ConversationDeliveryReviewV5Schema.safeParse({ ...learningReject, version: "conversation-delivery-review-v5" }).success);
    const compiled = zodTextFormat(ConversationDeliveryReviewSchema, CONVERSATION_DELIVERY_REVIEW_VERSION).schema;
    assert(new Ajv({ allErrors: true }).compile(compiled)(learningReject));
  });
  check("learner-claim findings cannot fabricate, relocate or omit their quoted source bindings", () => {
    const sources = learningFinding.source_refs;
    for (const finding of [
      { ...learningFinding, source_refs: [] },
      { ...learningFinding, source_refs: [{ ...sources[0], quote: "Tutor invented these words." }, ...sources.slice(1)] },
      { ...learningFinding, source_refs: [{ ...sources[0], actor: "student" }, ...sources.slice(1)] },
      { ...learningFinding, source_refs: [{ ...sources[0], sequence_index: 999999 }, ...sources.slice(1)] },
      { ...learningFinding, source_refs: [...sources, sources[0]] },
      { ...learningFinding, draft_block_id: 2 },
      { ...learningFinding, draft_quote: "You independently mastered everything." }
    ]) assert.equal(validateConversationDeliveryReview({ ...learningReject, findings: [finding] }, assisted.context, assistedDraft, null).valid, false);
    assert.equal(validateConversationDeliveryReview({ ...learningReject, verdict: "pass" }, assisted.context, assistedDraft, null).valid, false);
  });
  for (const control of assisted.controls) {
    const controlContext = structuredClone(assisted.context);
    if (control.replacement_latest_student_message) {
      controlContext.latest_student_message = control.replacement_latest_student_message;
      controlContext.visible_transcript.at(-1)!.message_text = control.replacement_latest_student_message;
    }
    check(`${control.id}: authored positive fits the unchanged source-only contract without forcing new assessment`, () => {
      assert.equal(control.authored_synthetic, true);
      const input = buildConversationDeliveryReviewInput(controlContext, control.draft_message, null);
      assert.deepEqual(Object.keys(input).sort(), [...Object.keys(assisted.review_input), "proposed_learning_claims"].sort());
      assert.deepEqual(input.initial_student_reasoning, assisted.review_input.initial_student_reasoning);
      const authoredPass = { private_learning_audit: [], version: CONVERSATION_DELIVERY_REVIEW_VERSION,
        teaching_block_audit: protocolAudit(control.draft_message), verdict: "pass", findings: [] };
      assert.equal(validateConversationDeliveryReview(authoredPass, controlContext, control.draft_message, null).accepted, true);
    });
  }
  const qualifiedDraft = assisted.controls[0].draft_message;
  const qualifiedPass = { private_learning_audit: [], version: CONVERSATION_DELIVERY_REVIEW_VERSION,
    teaching_block_audit: protocolAudit(qualifiedDraft), verdict: "pass", findings: [] };
  const learningRepaired = await run([{ output: learningReject }, { output: qualifiedPass }],
    { context: assisted.context, drafts: [assistedDraft, qualifiedDraft], deliveryReviewConfig: mixedReviewConfig });
  check("learner-claim rejection uses the existing single tutor repair and preserves original feedback and all four requests", () => {
    assert(learningRepaired.result); assert.equal(learningRepaired.tutorRequests.length, 2); assert.equal(learningRepaired.reviewRequests.length, 2);
    assert.equal(learningRepaired.result.audit.semantic_regeneration_calls, 1);
    assert.equal(learningRepaired.result.total_tokens, 360);
    assert.equal(learningRepaired.result.result.parsed_output.student_visible_message, qualifiedDraft);
    assert.equal(learningRepaired.result.result.parsed_output.profile_transition_recommendation, null);
    const feedback = (learningRepaired.tutorRequests[1].input as { semantic_regeneration: { delivery_review_feedback: { review: unknown; source_input: unknown } } }).semantic_regeneration.delivery_review_feedback;
    assert.deepEqual(feedback.review, learningReject); assert.deepEqual(feedback.source_input,
      buildConversationDeliveryReviewInput(assisted.context, assistedDraft,
        {...v18r2TestContinueOutput({context:assisted.context,include_observation:false}),student_visible_message:assistedDraft}));
    assert.equal(learningRepaired.result.audit.attempts[0].pre_delivery_review!.review_output_sha256, hash(learningReject));
    assert(learningRepaired.reviewRequests.every(item => item.model_config.model_name === "gpt-6.1-sol" && item.model_config.max_output_tokens === 4000));
  });
  const learningExhausted = await run([{ output: learningReject }, { output: learningReject }],
    { context: assisted.context, drafts: [assistedDraft, assistedDraft] });
  check("repeated learner-claim rejection fails closed with no third tutor attempt and retains historical fixture bytes", () => {
    assert(learningExhausted.error instanceof FormativeConversationV18R2ExecutionError);
    assert.equal(learningExhausted.error.failure_category, "semantic_regeneration_exhausted");
    assert.equal(learningExhausted.tutorRequests.length, 2); assert.equal(learningExhausted.reviewRequests.length, 2);
    assert.equal(learningExhausted.error.total_tokens, 360);
    assert.deepEqual(readFileSync(assistedFixturePath), assistedBytes);
  });
  // These fixed verdicts exercise schema/source integrity and bounded execution,
  // not the live reviewer's ability to detect or discriminate teaching errors.
  const accepted = await run([{ output: pass }]); assert(accepted.result);
  check("valid draft plus review uses two calls and preserves authoritative candidate", () => {
    assert.equal(accepted.tutorRequests.length, 1); assert.equal(accepted.reviewRequests.length, 1);
    assert.equal(accepted.result!.result.parsed_output.student_visible_message, draft);
    assert.equal(accepted.result!.result.parsed_output.profile_transition_recommendation, null);
    assert.equal(accepted.result!.audit.logical_calls_entered, 2); assert.equal(accepted.result!.audit.attempts.length, 1);
  });
  check("review costs, cached usage and latency are retained without excluding failed/rejected drafts", () => {
    const execution = accepted.result!; assert.equal(execution.total_tokens, 180); assert.equal(execution.input_tokens, 120);
    assert.equal(execution.output_tokens, 60); assert.equal(execution.latency_ms, 13);
    assert.equal(execution.audit.http_requests_dispatched, 2); assert.equal(execution.audit.accounting_version, FORMATIVE_CONVERSATION_DELIVERY_REVIEW_ACCOUNTING_VERSION);
    const review = execution.audit.attempts[0].pre_delivery_review!;
    assert.equal(review.cached_input_tokens, 5); assert.equal(review.reasoning_tokens, 2);
    assert.equal(review.review_output_sha256, hash(pass)); assert.equal(review.input_sha256, hash(review.input));
    assert.equal(review.draft_sha256, hash(draft)); assert.equal(review.provider_response_id, "review-1");
    assert.deepEqual(review.raw_output, { output_text: JSON.stringify(pass) });
  });
  const repaired = await run([{ output: reject }, { output: pass }]); assert(repaired.result);
  check("grounded reject permits exactly one tutor repair then re-review: four calls", () => {
    assert.equal(repaired.tutorRequests.length, 2); assert.equal(repaired.reviewRequests.length, 2);
    assert.equal(repaired.result!.audit.logical_calls_entered, 4); assert.equal(repaired.result!.audit.semantic_regeneration_calls, 1);
    assert.equal(repaired.result!.audit.attempts[0].pre_delivery_review!.status, "rejected");
    assert.equal(repaired.result!.audit.attempts[1].pre_delivery_review!.status, "passed");
    assert.equal(repaired.result!.total_tokens, 360); assert.equal(repaired.result!.result.parsed_output.student_visible_message, goodDraft);
    const input = repaired.tutorRequests[1].input as { semantic_regeneration: { delivery_review_feedback: unknown; invalid_candidate: unknown } };
    assert.deepEqual(input.semantic_regeneration.delivery_review_feedback, { version: CONVERSATION_DELIVERY_REVIEW_VERSION,
      source_input: buildConversationDeliveryReviewInput(context,draft,{...v18r2TestContinueOutput({context,include_observation:false}),student_visible_message:draft}), review: reject });
    assert.equal((input.semantic_regeneration.invalid_candidate as {student_visible_message:string}).student_visible_message, draft);
  });
  const twiceReject = structuredClone(reject); twiceReject.findings[0].draft_quote = goodDraft;
  const exhausted = await run([{ output: reject }, { output: twiceReject }]);
  check("second grounded rejection stops with both reviews and no third tutor call", () => {
    assert(exhausted.error instanceof FormativeConversationV18R2ExecutionError);
    assert.equal(exhausted.error.failure_category, "semantic_regeneration_exhausted"); assert.equal(exhausted.error.total_tokens, 360);
    assert.equal(exhausted.error.audit.http_requests_dispatched, 4); assert.equal(exhausted.tutorRequests.length, 2);
  });
  for (const status of ["failed", "refused", "incomplete"] as const) {
    const blocked = await run([{ status }]);
    check(`${status} reviewer blocks delivery without spending a tutor repair`, () => {
      assert(blocked.error instanceof FormativeConversationV18R2ExecutionError); assert.equal(blocked.error.failure_class, "pre_delivery_review_failure");
      assert.equal(blocked.tutorRequests.length, 1); assert.equal(blocked.error.total_tokens, 180);
      assert.equal(blocked.error.audit.attempts[0].pre_delivery_review!.status, "unreliable");
    });
  }
  const ungrounded = structuredClone(reject); ungrounded.findings[0].source_refs[0].quote = "Invented source";
  for (const choice of [{ output: ungrounded }, { output: { ...pass, findings: reject.findings } }, { wrongHash: true },
    { output: { ...pass, version: "conversation-delivery-review-v1" } }]) {
    const blocked = await run([choice]);
    check("ungrounded/inconsistent/misbound review fails closed, never silently repairs reviewer output", () => {
      assert(blocked.error instanceof FormativeConversationV18R2ExecutionError); assert.equal(blocked.error.failure_class, "pre_delivery_review_failure");
      assert.equal(blocked.tutorRequests.length, 1);
    });
  }
  const invalidFirst = await run([{ output: pass }], { invalidFirst: true }); assert(invalidFirst.result);
  check("mechanically rejected tutor draft is not reviewed; repaired valid draft is reviewed once", () => {
    assert.equal(invalidFirst.tutorRequests.length, 2); assert.equal(invalidFirst.reviewRequests.length, 1);
    assert.equal(invalidFirst.result!.audit.attempts[0].pre_delivery_review, undefined);
    assert.equal(invalidFirst.result!.audit.logical_calls_entered, 3); assert.equal(invalidFirst.result!.total_tokens, 330);
  });
  const opening = await run([], { context: v18r2TestContext({ student_turn_count: 0 }) }); assert(opening.result);
  check("only exact empty opening records a zero-dispatch review scope skip", () => {
    const audit = opening.result!.audit.attempts[0].pre_delivery_review!;
    assert.equal(audit.status, "skipped_opening"); assert.equal(opening.reviewRequests.length, 0);
    assert.equal(audit.logical_call_id, null); assert.equal(audit.total_tokens, null); assert.equal(audit.http_request_count, 0);
    assert.equal(opening.result!.audit.logical_calls_entered, 1);
  });
  const noSkip = v18r2TestContext({ student_turn_count: 0 }); noSkip.formative_lifecycle.student_turn_index = 1;
  const notOpening = await run([{ output: pass }], { context: noSkip });
  check("empty transcript alone does not skip review for a non-opening turn", () => { assert.equal(notOpening.reviewRequests.length, 1); });
  const missing = await run([], { planned: true, missingCallback: true });
  check("current planned wire cannot bypass reviewer by omitting the callback", () => {
    assert(missing.error instanceof Error); assert.equal(missing.error.message, "formative_conversation_delivery_review_runner_required");
    assert.equal(missing.tutorRequests.length, 0);
  });
  const malformedContext = await run([], { wrongContext: true });
  check("invalid visible-context boundary blocks review before dispatch while retaining tutor costs", () => {
    assert(malformedContext.error instanceof FormativeConversationV18R2ExecutionError); assert.equal(malformedContext.error.total_tokens, 150);
    assert.equal(malformedContext.reviewRequests.length, 0);
    const review = malformedContext.error.audit.attempts[0].pre_delivery_review!;
    assert.equal(review.input,null); assert.equal(review.input_sha256,null); assert.equal(review.logical_call_entered,false);
  });
  const foreignContext = structuredClone(context); foreignContext.assessment_response_evidence[0].item_public_id = "unadministered-item";
  const malformedBaseline = await run([],{context:foreignContext});
  check("out-of-scope baseline after a paid tutor draft fails closed with complete primary audit and no invented review input",()=>{
    assert(malformedBaseline.error instanceof FormativeConversationV18R2ExecutionError);
    assert.equal(malformedBaseline.error.failure_class,"pre_delivery_review_failure");
    assert.equal(malformedBaseline.error.total_tokens,150); assert.equal(malformedBaseline.error.audit.http_requests_dispatched,1);
    assert.equal(malformedBaseline.error.audit.usage_accounting_complete,true);
    assert.equal(malformedBaseline.tutorRequests.length,1); assert.equal(malformedBaseline.reviewRequests.length,0);
    const attempt=malformedBaseline.error.audit.attempts[0];
    assert.equal(attempt.invalid_candidate!.candidate_json !== null,true);
    assert.equal(attempt.pre_delivery_review!.input,null); assert.equal(attempt.pre_delivery_review!.input_sha256,null);
    assert.equal(attempt.pre_delivery_review!.status,"unreliable"); assert.equal(attempt.pre_delivery_review!.logical_call_entered,false);
  });
  const retry = await run([{ output: pass, transportRetry: true }]); assert(retry.result);
  check("reviewer transport retries count every HTTP attempt without consuming another tutor turn", () => {
    assert.equal(retry.result!.audit.http_requests_dispatched, 3); assert.equal(retry.result!.audit.transport_retries, 1);
    assert.equal(retry.result!.audit.logical_calls_entered, 2); assert.equal(retry.result!.audit.attempts.length, 1);
  });
  const thrown = await run([{ throwError: true }]);
  check("unexpected reviewer exception preserves primary evidence and explicitly unknown cost/dispatch totals", () => {
    assert(thrown.error instanceof FormativeConversationV18R2ExecutionError);
    assert.equal(thrown.error.failure_class, "pre_delivery_review_failure"); assert.equal(thrown.error.total_tokens, 150);
    assert.equal(thrown.error.audit.attempts[0].input_tokens, 100);
    assert.equal(thrown.error.audit.logical_calls_entered, 2);
    assert.equal(thrown.error.audit.dispatch_accounting_complete, false);
    assert.equal(thrown.error.audit.usage_accounting_complete, false);
    assert(!JSON.stringify(thrown.error.audit).includes("must not leak")); assert.equal(thrown.tutorRequests.length, 1);
  });
  const unknownUsage = await run([{ output: pass, missingUsage: true }]); assert(unknownUsage.result);
  check("missing entered reviewer usage leaves known tokens as an explicitly incomplete lower bound", () => {
    assert.equal(unknownUsage.result!.total_tokens, 150); assert.equal(unknownUsage.result!.input_tokens, 100);
    assert.equal(unknownUsage.result!.audit.usage_accounting_complete, false);
    assert.equal(unknownUsage.result!.audit.attempts[0].total_tokens, 150);
  });
  console.log(JSON.stringify({ status: "passed", checks, paid_calls: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
