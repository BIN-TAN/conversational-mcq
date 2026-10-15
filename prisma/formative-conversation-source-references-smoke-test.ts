import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { zodTextFormat } from "openai/helpers/zod";
import type { FormativeConversationV18R2AgentInput } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { FormativeConversationV18R2AgentOutputSchema } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import {
  CONVERSATION_PRIOR_TUTOR_SOURCE_VERSION, CONVERSATION_STORED_PREFERENCE_TRANSITION_VERSION,
  CONVERSATION_PRE_REPLY_PLAN_VERSION,
  ConversationPreReplyPlanV1Schema, ConversationPostReplyReviewV1Schema, ConversationTutorSourceSchema,
  buildConversationContinuity, buildConversationDeliveryReviewInput, conversationContinuityIssues,
  conversationCurrentReplySourceHash, projectConversationContinuityWire
} from "../src/lib/services/student-assessment/formative-conversation/conversation-continuity";
import { FormativeConversationPlannedProposalOutputSchema } from "../src/lib/services/student-assessment/formative-conversation/profile-update-proposal";
import { validateFormativeInterpretation } from "../src/lib/services/student-assessment/formative-conversation/interpretation-policy";

globalThis.fetch = async () => { throw new Error("Offline source-reference regression cannot call a provider"); };
let checks = 0;
const check = (name: string, fn: () => void) => { fn(); checks++; console.log(`PASS ${name}`); };
const fixtureBytes = readFileSync("prisma/fixtures/conversation-continuity-native-source-references.json");
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
const fixtureHash = createHash("sha256").update(fixtureBytes).digest("hex");
const before = JSON.stringify(fixture);
const preferenceCase = fixture.cases[0], baselineCase = fixture.cases[1], priorCase = fixture.cases[2];
type Prior = { tutor_sequence_index: number };
// Deliberately authored prospective fixtures: selecting a whole turn once replaces
// the old repeated spans. Neither original wire nor authored status/text is edited.
function prospective(entry: typeof preferenceCase) {
  const wire = structuredClone(entry.original_rejected_candidate);
  wire.pre_reply_plan.version = CONVERSATION_PRE_REPLY_PLAN_VERSION;
  wire.pre_reply_plan.preference_comparisons = wire.pre_reply_plan.preference_comparisons.map((item: Record<string, unknown> & {prior:{origin:string}|null}) => {
    if (item.prior?.origin === "stored_preference") {
      if (item.decision === "retain") return {preference_id:item.preference_id,decision:"retain"};
      delete item.kind; delete item.description;
    }
    return item;
  });
  const refs = (items: Prior[]) => [...new Set(items.map(item => item.tutor_sequence_index))]
    .map(tutor_sequence_index => ({ kind: "prior_tutor_turn", tutor_sequence_index }));
  wire.post_reply_review.need_updates.forEach((item: {support: Array<Prior & {kind:string}>}) => {
    item.support = item.support.map(source => source.kind === "current_reply" ? source :
      { kind: "prior_tutor_turn", tutor_sequence_index: source.tutor_sequence_index });
  });
  wire.post_reply_review.recap_claims.forEach((item: {earlier_support: Prior[]}) => { item.earlier_support = refs(item.earlier_support); });
  const instructor = wire.post_reply_review.closure.instructor_support;
  if (instructor) instructor.prior_support = refs(instructor.prior_support);
  return wire;
}
function reconstruct(entry = priorCase, wire = prospective(entry), context = entry.original_context as FormativeConversationV18R2AgentInput) {
  const projected = projectConversationContinuityWire(wire, context);
  assert(projected.output, JSON.stringify(projected.audit.validation_issue_paths));
  const accepted = validateFormativeInterpretation({ candidate: projected.output, context });
  if (entry.id === "prior_tutor_markdown_copy") {
    // The original final base also has an independently invalid learning-summary
    // observation. Fixing source copying must not waive that existing guard.
    assert.deepEqual(accepted.validation_issue_paths,["learning_summary.learning_summary_remaining.student_reasoning_required"]);
  } else assert(accepted.valid, JSON.stringify(accepted.validation_issue_paths));
  const output = FormativeConversationV18R2AgentOutputSchema.parse(projected.output);
  assert.deepEqual(conversationContinuityIssues(output,context),[]);
  return { output, audit: projected.audit };
}
check("three exact recovered native failures and source hashes remain immutable", () => {
  assert.equal(fixtureHash, "ff137913a91501f57c806970c59033e7ce93429ed3ae75c2639cbea1c5d63ff4");
  assert.equal(fixture.source.sha256, "f72d9cff6886ca2a7b4a4fd4616ed701b0a2874b10ba35f669ce38c14361c310");
  assert.equal(fixture.synthetic_only, true); assert.equal(fixture.real_student_records_used, false);
  assert.deepEqual(fixture.cases.map((item: {source_agent_call_index_zero_based:number}) => item.source_agent_call_index_zero_based), [31, 35, 36]);
  fixture.cases.forEach((entry: typeof preferenceCase) => {
    assert(ConversationPreReplyPlanV1Schema.safeParse(entry.original_rejected_candidate.pre_reply_plan).success);
    assert(ConversationPostReplyReviewV1Schema.safeParse(entry.original_rejected_candidate.post_reply_review).success);
  });
});
for (const entry of fixture.cases) check(`${entry.id}: prospective references preserve reply, decisions and independent validation guards`, () => {
  const wire = prospective(entry), original = JSON.stringify(wire), {output, audit} = reconstruct(entry, wire);
  assert.equal(output.student_visible_message, entry.original_rejected_candidate.student_visible_message);
  assert.equal(output.lifecycle_recommendation, entry.original_rejected_candidate.lifecycle_recommendation);
  assert.equal(output.profile_transition_recommendation, null);
  assert.equal(audit.stored_preference_transition_version, CONVERSATION_STORED_PREFERENCE_TRANSITION_VERSION);
  assert.equal(audit.prior_tutor_source_version, CONVERSATION_PRIOR_TUTOR_SOURCE_VERSION);
  assert.deepEqual(output.conversation_review!.need_updates.map(item => ({id:item.need_id,status:item.status,description:item.description,source:item.source})),
    wire.post_reply_review.need_updates.map((item:{need_id:string,status:string,description:string,source:unknown}) => ({id:item.need_id,status:item.status,description:item.description,source:item.source})));
  assert.equal(JSON.stringify(wire), original);
});
check("stored release hydrates exact immutable kind/description instead of accepting changed copied text", () => {
  const {output} = reconstruct(preferenceCase);
  const stored = preferenceCase.original_context.conversation_continuity.preferences.find((item:{preference_id:string}) => item.preference_id === "pref_defer_sem");
  const old = preferenceCase.original_rejected_candidate.pre_reply_plan.preference_comparisons.find((item:{preference_id:string}) => item.preference_id === stored.preference_id);
  assert.notEqual(old.description, stored.description);
  const released = output.conversation_review!.preference_updates.find(item => item.preference_id === stored.preference_id)!;
  assert.equal(released.description, stored.description); assert.equal(released.kind, stored.kind);
  assert.equal(released.status, "released"); assert.deepEqual(released.source, old.current_source);
});
for (const mode of ["unknown", "bootstrap", "duplicate", "copy_kind", "copy_description", "stale_source"] as const) check(`stored reference rejects ${mode}`, () => {
  const wire = prospective(preferenceCase);
  const item = wire.pre_reply_plan.preference_comparisons.find((value:{decision:string}) => value.decision === "release");
  if (mode === "unknown") item.preference_id = "missing-preference";
  if (mode === "bootstrap") { item.prior = {origin:"visible_student_history",source:item.current_source}; item.kind = "defer_topic"; item.description = "Replacement identity"; }
  if (mode === "duplicate") wire.pre_reply_plan.preference_comparisons.push(structuredClone(item));
  if (mode === "copy_kind") item.kind = "defer_topic";
  if (mode === "copy_description") item.description = "Changed immutable description";
  if (mode === "stale_source") item.current_source = preferenceCase.original_context.conversation_continuity.preferences.find((value:{preference_id:string}) => value.preference_id === item.preference_id).source;
  assert.equal(projectConversationContinuityWire(wire, preferenceCase.original_context).output, null);
});
check("earlier Markdown references bind exact whole saved tutor turn and stable receipt paths", () => {
  const {output,audit} = reconstruct();
  const source = priorCase.original_context.visible_transcript.find((turn:{sequence_index:number}) => turn.sequence_index === 85);
  const earlier = output.conversation_review!.recap_claims[0].earlier_support[0];
  assert.equal(earlier.quote, source.message_text);
  assert.deepEqual(audit.prior_tutor_bindings, [{path:"conversation_review.recap_claims[0].earlier_support[0].quote",tutor_sequence_index:85,reply_sha256:conversationCurrentReplySourceHash(source.message_text)}]);
  assert.deepEqual("source_binding" in earlier && earlier.source_binding, {version:CONVERSATION_PRIOR_TUTOR_SOURCE_VERSION,reply_sha256:conversationCurrentReplySourceHash(source.message_text)});
  const bad = structuredClone(output);
  bad.conversation_review!.recap_claims[0].earlier_support = priorCase.original_rejected_candidate.post_reply_review.recap_claims[0].earlier_support;
  assert(conversationContinuityIssues(bad, priorCase.original_context).includes("conversation_review.tutor_source_invalid"));
});
for (const mode of ["missing", "student", "future", "duplicate_ref", "ambiguous_turn", "cross_scope", "extra_quote"] as const) check(`prior turn reference rejects ${mode}`, () => {
  const wire = prospective(priorCase), context = structuredClone(priorCase.original_context);
  const refs = wire.post_reply_review.recap_claims[0].earlier_support;
  if (mode === "missing") refs[0].tutor_sequence_index = 999;
  if (mode === "student") refs[0].tutor_sequence_index = 84;
  if (mode === "future") { refs[0].tutor_sequence_index = 87; context.visible_transcript.push({...context.visible_transcript.at(-2),sequence_index:87}); }
  if (mode === "duplicate_ref") refs.push(structuredClone(refs[0]));
  if (mode === "ambiguous_turn") context.visible_transcript.push(structuredClone(context.visible_transcript.find((turn:{sequence_index:number}) => turn.sequence_index === 85)));
  if (mode === "cross_scope") context.conversation_public_id = "another-conversation";
  if (mode === "extra_quote") refs[0].quote = "Copied text";
  assert.equal(projectConversationContinuityWire(wire, context).output, null);
});
check("marked prior receipts retain12000 exact Unicode/Markdown bytes and reject larger sources", () => {
  const context = structuredClone(priorCase.original_context);
  const turn = context.visible_transcript.find((item:{sequence_index:number}) => item.sequence_index === 85);
  turn.message_text = "**Évidence**\r\n" + "x".repeat(12000 - "**Évidence**\r\n".length);
  const {output} = reconstruct(priorCase, prospective(priorCase), context);
  assert.equal(output.conversation_review!.recap_claims[0].earlier_support[0].quote, turn.message_text);
  turn.message_text += "x";
  assert.equal(projectConversationContinuityWire(prospective(priorCase), context).output, null);
});
for (const mode of ["hash", "substring", "null_current", "unknown_marker", "extra_binding"] as const) check(`canonical prior binding rejects ${mode}`, () => {
  const {output} = reconstruct(); const source = output.conversation_review!.recap_claims[0].earlier_support[0];
  assert("source_binding" in source);
  if (mode === "hash") source.source_binding.reply_sha256 = "0".repeat(64);
  if (mode === "substring") source.quote = source.quote.slice(0,100);
  if (mode === "null_current") source.tutor_sequence_index = null;
  if (mode === "unknown_marker") Object.assign(source.source_binding,{version:"unknown"});
  if (mode === "extra_binding") Object.assign(source.source_binding,{extra:true});
  assert(conversationContinuityIssues(output,priorCase.original_context).length > 0);
});
check("unmarked literal historical sources retain original1200-character meaning", () => {
  assert(ConversationTutorSourceSchema.safeParse({tutor_sequence_index:85,quote:"x".repeat(1200)}).success);
  assert(!ConversationTutorSourceSchema.safeParse({tutor_sequence_index:85,quote:"x".repeat(1201)}).success);
});
check("prior marker survives canonical memory rebuilding without changing original source index", () => {
  const {output} = reconstruct(baselineCase), originalContext = baselineCase.original_context;
  const context = {...originalContext,visible_transcript:[...originalContext.visible_transcript,{sequence_index:85,actor:"tutor",message_text:output.student_visible_message,created_at:"2026-10-13T00:00:00.000Z"}]};
  const continuity = buildConversationContinuity({context, records:[{source_agent_call_public_id:"synthetic-source-review",source_tutor_sequence_index:85,review:output.conversation_review}]});
  const need = continuity.needs.find(item => item.need_id === "need_consistency_everyday_example")!;
  assert.equal(need.support[0].tutor_sequence_index,71);
  assert("source_binding" in need.support[0]);
  assert.equal(need.support[0].source_binding.version,CONVERSATION_PRIOR_TUTOR_SOURCE_VERSION);
});
check("real compiled provider schema requires explicit references and rejects old stored copies", () => {
  const validate = new Ajv({allErrors:true}).compile(zodTextFormat(FormativeConversationPlannedProposalOutputSchema,"source-reference-check").schema);
  assert(validate(prospective(priorCase)),JSON.stringify(validate.errors));
  assert(!validate(priorCase.original_rejected_candidate));
});
check("baseline attribution receives exact student-written reasons without keys or profile state", () => {
  const input = buildConversationDeliveryReviewInput(baselineCase.original_context,baselineCase.original_rejected_candidate.student_visible_message, null);
  assert.deepEqual(input.initial_student_reasoning,baselineCase.original_context.assessment_response_evidence.map((item:{item_public_id:string,written_reasoning:string|null}) => ({item_public_id:item.item_public_id,written_reasoning:item.written_reasoning})));
  assert(input.initial_student_reasoning.some(item => item.written_reasoning?.includes("subtract three")));
  input.initial_student_reasoning.forEach(item => assert.deepEqual(Object.keys(item),["item_public_id","written_reasoning"]));
});
check("separate authored repair removes only ineligible confidence corroboration and passes the unchanged summary guard",()=>{
  const projected = projectConversationContinuityWire(prospective(priorCase),priorCase.original_context);
  assert(projected.output);
  const repaired = FormativeConversationV18R2AgentOutputSchema.parse(projected.output);
  const observation = repaired.evidence_observations.find(item=>item.evidence_type==="learning_summary_remaining")!;
  const originalIds=[...observation.evidence_ids];
  const ineligible="ev_66cadb51de357439b7d20a54";
  const source=priorCase.original_context.allowed_evidence_catalog.evidence.find((item:{evidence_id:string})=>item.evidence_id===ineligible);
  assert.equal(source.evidence_kind,"assessment_confidence"); assert.equal(source.eligibility,"evidence_quality_context");
  observation.evidence_ids=originalIds.filter(id=>id!==ineligible);
  assert.equal(observation.evidence_ids.length,originalIds.length-1);
  const accepted=validateFormativeInterpretation({candidate:repaired,context:priorCase.original_context});
  assert(accepted.valid,JSON.stringify(accepted.validation_issue_paths));
  assert.equal(repaired.student_visible_message,priorCase.original_rejected_candidate.student_visible_message);
  assert.equal(repaired.profile_transition_recommendation,null);
  assert.equal(repaired.lifecycle_recommendation,priorCase.original_rejected_candidate.lifecycle_recommendation);
  assert.equal(priorCase.original_rejected_candidate.evidence_observations.find((item:{evidence_type:string})=>item.evidence_type==="learning_summary_remaining").evidence_ids.includes(ineligible),true);
});
assert.equal(JSON.stringify(fixture),before);
console.log(JSON.stringify({status:"passed",checks,fixture_sha256:fixtureHash,paid_calls:0,limitation:"Exact coarse source reconstruction preserves authored classifications; it does not establish semantic teaching truth."}));
