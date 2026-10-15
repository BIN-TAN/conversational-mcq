import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { zodTextFormat } from "openai/helpers/zod";
import type { FormativeConversationV18R2AgentInput } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import {
  CONVERSATION_CURRENT_REPLY_SOURCE_VERSION,
  ConversationReviewSchema,
  ConversationTutorSourceSchema,
  buildConversationContinuity,
  conversationContinuityIssues,
  conversationCurrentReplySourceHash,
  projectConversationContinuityWire
} from "../src/lib/services/student-assessment/formative-conversation/conversation-continuity";
import { FormativeConversationPlannedProposalOutputSchema } from "../src/lib/services/student-assessment/formative-conversation/profile-update-proposal";
import { validateFormativeInterpretation } from "../src/lib/services/student-assessment/formative-conversation/interpretation-policy";

globalThis.fetch = async () => { throw new Error("Offline source-reference checks cannot call a provider"); };
let checks = 0;
const check = (name: string, fn: () => void) => { fn(); checks++; console.log(`PASS ${name}`); };
const fixtureBytes = readFileSync("prisma/fixtures/conversation-continuity-native-current-reply-quotes.json");
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
const fixtureHash = createHash("sha256").update(fixtureBytes).digest("hex");
const context = fixture.original_context as FormativeConversationV18R2AgentInput;
const original = JSON.stringify(fixture);
const first = fixture.original_rejected_candidates[0].candidate;
// This is a deliberately authored prospective fixture adaptation. Original
// failed raw objects remain in the fixture and are still rejected as recorded.
function prospective(candidate: typeof first) {
  const copy = structuredClone(candidate);
  copy.pre_reply_plan.preference_comparisons.forEach((item: Record<string, unknown> & { prior?: {origin:string} }) => {
    if (item.prior?.origin === "stored_preference") { delete item.kind; delete item.description; }
  });
  copy.post_reply_review.current_support = copy.post_reply_review.current_support.map((item: Record<string, unknown>) => {
    const rest = { ...item }; delete rest.quote; delete rest.preference_ids;
    return { ...rest, source: { kind: "current_reply" }, preference_links: (item.preference_ids as string[]).map(preference_id => ({
      preference_id, relationship: "honored_constraint"
    })) };
  });
  copy.post_reply_review.need_updates = copy.post_reply_review.need_updates.map((item: Record<string, unknown> & { support: Array<{ tutor_sequence_index: number | null; quote: string }> }) => ({
    ...item, support: item.support.map(source => source.tutor_sequence_index === null
      ? { kind: "current_reply" } : { kind: "prior_tutor_turn", tutor_sequence_index: source.tutor_sequence_index })
  }));
  copy.post_reply_review.recap_claims = copy.post_reply_review.recap_claims.map((item: { earlier_support: Array<{tutor_sequence_index:number}> }) => ({
    current_source: { kind: "current_reply" }, earlier_support: item.earlier_support.map(source => ({kind:"prior_tutor_turn",tutor_sequence_index:source.tutor_sequence_index}))
  }));
  return copy;
}
function reconstruct(wire = prospective(first), ctx = context) {
  const result = projectConversationContinuityWire(wire, ctx);
  assert(result.output, JSON.stringify(result.audit.validation_issue_paths));
  const validated = validateFormativeInterpretation({ candidate: result.output, context: ctx });
  assert(validated.valid, JSON.stringify(validated.validation_issue_paths));
  return { ...result, output: validated.output! };
}
const expectedPaths = ["conversation_review.need_updates[0].support[0].quote", "conversation_review.need_updates[0].support[1].quote",
  "conversation_review.current_support[0].quote", "conversation_review.current_support[1].quote"];
check("exact synthetic failure fixture is pinned and retains both rejected originals", () => {
  assert.equal(fixtureHash, "dbef3b67e31db4ae39a7da523f4e8dd3d8606a0ad2e12c1c377e44460907cc29");
  assert.equal(fixture.source_agent_calls_sha256, "6bdb69d6888cc9a450ce9a5de9d2d061adeefb579e906d5fb3164e1f034c1298");
  assert.equal(fixture.synthetic_only, true); assert.equal(fixture.real_student_records_used, false);
  assert.equal(fixture.original_rejected_candidates.length, 2);
});
for (const { kind, candidate } of fixture.original_rejected_candidates) {
  check(`${kind}: historical literal Markdown mismatch remains rejected`, () => {
    const oldReview = { version: "conversation-review-v1", preference_updates: [],
      student_state: candidate.pre_reply_plan.student_state, ...candidate.post_reply_review,
      closure: { ...candidate.post_reply_review.closure, unresolved_need_ids: [] } };
    const issues = conversationContinuityIssues({ ...candidate, conversation_review: oldReview }, context);
    assert(issues.includes("conversation_review.current_support_quote_invalid"));
    assert(issues.includes("conversation_review.tutor_source_invalid"));
    assert.equal(FormativeConversationPlannedProposalOutputSchema.safeParse(candidate).success, false);
  });
  check(`${kind}: explicit current references bind the exact unchanged whole reply`, () => {
    const wire = prospective(candidate), before = JSON.stringify(wire), { output, audit } = reconstruct(wire);
    assert.equal(output.student_visible_message, candidate.student_visible_message);
    assert.equal(output.profile_transition_recommendation, null); assert.equal(output.lifecycle_recommendation, candidate.lifecycle_recommendation);
    assert.equal(audit.current_reply_source_version, CONVERSATION_CURRENT_REPLY_SOURCE_VERSION);
    assert.deepEqual(audit.current_reply_bindings?.map(item => item.path), expectedPaths);
    for (const binding of audit.current_reply_bindings!) assert.equal(binding.reply_sha256, conversationCurrentReplySourceHash(candidate.student_visible_message));
    const review = output.conversation_review!;
    for (const support of [...review.current_support, ...review.need_updates.flatMap(item => item.support)]) {
      assert.equal(support.quote, candidate.student_visible_message);
      assert("source_binding" in support); assert.deepEqual(support.source_binding, {
        version: CONVERSATION_CURRENT_REPLY_SOURCE_VERSION,
        reply_sha256: conversationCurrentReplySourceHash(candidate.student_visible_message)
      });
    }
    assert.deepEqual(review.need_updates.map(item => ({ id: item.need_id, status: item.status, source: item.source })),
      candidate.post_reply_review.need_updates.map((item: { need_id: string; status: string; source: unknown }) => ({ id: item.need_id, status: item.status, source: item.source })));
    assert.equal(JSON.stringify(wire), before);
  });
}
const compiled = zodTextFormat(FormativeConversationPlannedProposalOutputSchema, "current-reply-source-offline").schema;
const wireValidator = new Ajv({ allErrors: true }).compile(compiled);
check("real compiled provider schema accepts current references and refuses old duplicated quotes", () => {
  assert(wireValidator(prospective(first)), JSON.stringify(wireValidator.errors));
  assert(!wireValidator(first));
});
for (const field of ["quote", "source_binding"]) check(`wire current reference rejects extra ${field}`, () => {
  const wire = prospective(first); wire.post_reply_review.current_support[0].source[field] = "invented";
  assert.equal(FormativeConversationPlannedProposalOutputSchema.safeParse(wire).success, false);
});
check("wire cannot call a current reference a prior source", () => {
  const wire = prospective(first); wire.post_reply_review.need_updates[0].support[0] = { kind: "prior_tutor", tutor_sequence_index: null, quote: "Consistent" };
  assert.equal(FormativeConversationPlannedProposalOutputSchema.safeParse(wire).success, false);
});
check("wire cannot add current bindings to a student source", () => {
  const wire = prospective(first); wire.post_reply_review.need_updates[0].source.source_binding = { version: CONVERSATION_CURRENT_REPLY_SOURCE_VERSION, reply_sha256: "a".repeat(64) };
  assert.equal(FormativeConversationPlannedProposalOutputSchema.safeParse(wire).success, false);
});
check("maximum12000-character reply is preserved in explicit canonical variants", () => {
  const wire = prospective(first); wire.student_visible_message = "**Évidence**\n" + "x".repeat(12000 - "**Évidence**\n".length);
  const { output } = reconstruct(wire);
  assert.equal(output.student_visible_message.length, 12000);
  assert.equal(output.conversation_review!.current_support[0].quote, wire.student_visible_message);
  assert(ConversationReviewSchema.safeParse(output.conversation_review).success);
});
check("reply above12000 is refused instead of truncating source", () => {
  const wire = prospective(first); wire.student_visible_message = "x".repeat(12001);
  assert.equal(projectConversationContinuityWire(wire, context).output, null);
});
check("legacy unmarked sources keep1200 cap and literal meaning", () => {
  assert(ConversationTutorSourceSchema.safeParse({ tutor_sequence_index: null, quote: "x".repeat(1200) }).success);
  assert(!ConversationTutorSourceSchema.safeParse({ tutor_sequence_index: null, quote: "x".repeat(1201) }).success);
  const { output } = reconstruct(), review = structuredClone(output.conversation_review!);
  const item = review.current_support[0]; assert("source_binding" in item);
  delete (item as { source_binding?: unknown }).source_binding;
  item.quote = "x".repeat(1201);
  assert.equal(ConversationReviewSchema.safeParse(review).success, false);
});
check("short marked quote with wrong hash cannot fall through the strict legacy branch", () => {
  const { output } = reconstruct(), review = structuredClone(output.conversation_review!);
  const item = review.current_support[0]; assert("source_binding" in item); item.source_binding.reply_sha256 = "0".repeat(64);
  assert(conversationContinuityIssues({ ...output, conversation_review: review }, context).includes("conversation_review.current_support_quote_invalid"));
});
check("full-source marker cannot authorize a substring even with the right reply hash", () => {
  const { output } = reconstruct(), review = structuredClone(output.conversation_review!);
  review.current_support[0].quote = "Consistent";
  assert(conversationContinuityIssues({ ...output, conversation_review: review }, context).includes("conversation_review.current_support_quote_invalid"));
});
check("binding with unknown version or extra fields is rejected rather than stripped", () => {
  for (const binding of [{ version: "unknown", reply_sha256: "a".repeat(64) },
    { version: CONVERSATION_CURRENT_REPLY_SOURCE_VERSION, reply_sha256: "a".repeat(64), extra: true }]) {
    assert(!ConversationTutorSourceSchema.safeParse({ tutor_sequence_index: null, quote: "short", source_binding: binding }).success);
  }
});
check("changed visible reply invalidates every exact current source binding", () => {
  const { output } = reconstruct();
  const issues = conversationContinuityIssues({ ...output, student_visible_message: output.student_visible_message + " Changed." }, context);
  assert(issues.includes("conversation_review.current_support_quote_invalid"));assert(issues.includes("conversation_review.tutor_source_invalid"));
});
check("recap current and prior sides bind exact distinct whole tutor sources", () => {
  const wire = prospective(first), prior = context.visible_transcript.find(turn => turn.actor === "tutor")!;
  wire.post_reply_review.recap_claims = [{ current_source: { kind: "current_reply" }, earlier_support: [{ kind: "prior_tutor_turn", tutor_sequence_index: prior.sequence_index }] }];
  const { output, audit } = reconstruct(wire);
  assert.equal(output.conversation_review!.recap_claims[0].current_quote, wire.student_visible_message);
  assert(audit.current_reply_bindings!.some(item => item.path === "conversation_review.recap_claims[0].current_quote"));
  assert.equal(output.conversation_review!.recap_claims[0].earlier_support[0].quote, prior.message_text);
  wire.post_reply_review.recap_claims[0].earlier_support[0].tutor_sequence_index = 999999;
  const result = projectConversationContinuityWire(wire, context);assert.equal(result.output,null);
});
check("persisted current need source retains its binding when assigned the actual tutor index", () => {
  const { output } = reconstruct(), index = Math.max(...context.visible_transcript.map(turn => turn.sequence_index)) + 1;
  const historyContext = { ...context, visible_transcript: [...context.visible_transcript, { sequence_index: index, actor: "tutor" as const, message_text: output.student_visible_message, created_at: "2026-10-13T00:00:00.000Z" }] };
  const state = buildConversationContinuity({ context: historyContext, records: [{ source_agent_call_public_id: "offline-current-source", source_tutor_sequence_index: index, review: output.conversation_review }] });
  const support = state.needs[0].support[0];assert.equal(support.tutor_sequence_index, index);assert("source_binding" in support);
  assert.equal(support.source_binding.reply_sha256, conversationCurrentReplySourceHash(output.student_visible_message));
  const reused = structuredClone(output);
  reused.conversation_review!.current_support = [];
  reused.conversation_review!.need_updates[0].support = [support];
  assert.deepEqual(conversationContinuityIssues(reused, historyContext), []);
  for (const badIndex of [index + 1, context.visible_transcript.find(turn => turn.actor === "student")!.sequence_index,
    context.visible_transcript.find(turn => turn.actor === "tutor")!.sequence_index]) {
    reused.conversation_review!.need_updates[0].support[0].tutor_sequence_index = badIndex;
    assert(conversationContinuityIssues(reused, historyContext).includes("conversation_review.tutor_source_invalid"));
  }
});
check("corrupt whole-source review is excluded from rebuilt accepted history", () => {
  const { output } = reconstruct(), index = Math.max(...context.visible_transcript.map(turn => turn.sequence_index)) + 1;
  const historyContext = { ...context, visible_transcript: [...context.visible_transcript, { sequence_index: index, actor: "tutor" as const, message_text: output.student_visible_message + " tampered", created_at: "2026-10-13T00:00:00.000Z" }] };
  const state = buildConversationContinuity({ context: historyContext, records: [{ source_agent_call_public_id: "offline-tampered", source_tutor_sequence_index: index, review: output.conversation_review }] });
  assert.deepEqual(state.needs, []);assert.deepEqual(state.support_history, []);
});
check("fixture and original rejected wire bytes remain unchanged after all checks", () => {
  assert.equal(JSON.stringify(fixture), original);assert.equal(createHash("sha256").update(readFileSync("prisma/fixtures/conversation-continuity-native-current-reply-quotes.json")).digest("hex"), fixtureHash);
});
console.log(JSON.stringify({ suite: "formative-conversation-current-reply-source", passed: checks, failed: 0, provider_calls: 0 }));
