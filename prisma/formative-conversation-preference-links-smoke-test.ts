import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { zodTextFormat } from "openai/helpers/zod";
import type { FormativeConversationV18R2AgentInput } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import {
  CONVERSATION_SUPPORT_PREFERENCE_LINK_VERSION,
  ConversationReviewSchema,
  buildConversationContinuity,
  conversationContinuityIssues,
  projectConversationContinuityWire
} from "../src/lib/services/student-assessment/formative-conversation/conversation-continuity";
import { FormativeConversationPlannedProposalOutputSchema } from "../src/lib/services/student-assessment/formative-conversation/profile-update-proposal";
import { validateFormativeInterpretation } from "../src/lib/services/student-assessment/formative-conversation/interpretation-policy";

globalThis.fetch = async () => { throw new Error("Offline preference-link verification cannot dispatch"); };
const fixturePath = "prisma/fixtures/conversation-continuity-native-preference-links.json";
const bytes = readFileSync(fixturePath), fixture = JSON.parse(bytes.toString("utf8"));
const fixtureHash = "6afd5156154f544e8fa4d16c9dc87414daaed4213117b64c78e77530cb16e597";
const context = fixture.original_context as FormativeConversationV18R2AgentInput;
const original = JSON.stringify(fixture);
let checks = 0;
const check = (name: string, run: () => void) => { run(); checks++; console.log(`PASS ${name}`); };
function prospective(candidate = fixture.original_rejected_candidates[0].candidate) {
  const copy = structuredClone(candidate);
  copy.pre_reply_plan.preference_comparisons.forEach((item: Record<string, unknown> & { prior?: {origin:string} }) => {
    if (item.prior?.origin === "stored_preference") { delete item.kind; delete item.description; }
  });
  copy.post_reply_review.current_support = copy.post_reply_review.current_support.map((support: Record<string, unknown> & { preference_ids: string[] }) => {
    const revised = { ...support }; delete (revised as { preference_ids?: unknown }).preference_ids;
    // Authored prospective fixture adaptation only, never an automatic production
    // interpretation or rewrite of the original rejected model record.
    return { ...revised, preference_links: support.preference_ids.map(preference_id => ({ preference_id, relationship: "honored_constraint" })) };
  });
  return copy;
}
function reconstruct(wire = prospective()) {
  const result = projectConversationContinuityWire(wire, context);
  assert(result.output, JSON.stringify(result.audit.validation_issue_paths));
  const validated = validateFormativeInterpretation({ candidate: result.output, context });
  assert(validated.valid, JSON.stringify(validated.validation_issue_paths));
  return { ...result, output: validated.output! };
}
type CanonicalSupport = NonNullable<ReturnType<typeof reconstruct>["output"]["conversation_review"]>["current_support"][number];
check("exact two failed native wires and sealed context remain pinned", () => {
  assert.equal(createHash("sha256").update(bytes).digest("hex"), fixtureHash);
  assert.equal(fixture.source_agent_calls_sha256, "0f4ba0259c4a1e9e14f68f7e97ce75586c9993fdf1690386734cf7bb4deb256c");
  assert.equal(fixture.original_rejected_candidates.length, 2);
  assert.equal(fixture.synthetic_only, true); assert.equal(fixture.real_student_records_used, false);
});
for (const { kind, candidate } of fixture.original_rejected_candidates) {
  check(`${kind}: explicit honored links preserve visible draft and all authored states`, () => {
    const wire = prospective(candidate), before = JSON.stringify(wire), result = reconstruct(wire);
    assert.equal(result.output.student_visible_message, candidate.student_visible_message);
    assert.equal(result.output.outcome, candidate.outcome);
    assert.equal(result.output.lifecycle_recommendation, candidate.lifecycle_recommendation);
    assert.equal(result.output.profile_transition_recommendation, candidate.profile_transition_recommendation);
    assert.deepEqual(result.output.conversation_review!.need_updates, candidate.post_reply_review.need_updates);
    assert.equal(result.audit.support_preference_link_version, CONVERSATION_SUPPORT_PREFERENCE_LINK_VERSION);
    const support = result.output.conversation_review!.current_support[0];
    assert.deepEqual(support.preference_ids, candidate.post_reply_review.current_support[0].preference_ids);
    assert.deepEqual(support.preference_linkage, { version: CONVERSATION_SUPPORT_PREFERENCE_LINK_VERSION, links: wire.post_reply_review.current_support[0].preference_links });
    assert.deepEqual(result.audit.support_preference_link_bindings, [{ path: "conversation_review.current_support[0].preference_linkage", links: support.preference_linkage!.links }]);
    assert.equal(JSON.stringify(wire), before);
  });
  check(`${kind}: original ambiguous wire and legacy canonical semantics are not retroactively accepted`, () => {
    assert.equal(FormativeConversationPlannedProposalOutputSchema.safeParse(candidate).success, false);
    const { output } = reconstruct(prospective(candidate)), legacy = structuredClone(output);
    for (const support of legacy.conversation_review!.current_support) delete support.preference_linkage;
    assert(conversationContinuityIssues(legacy, context).includes("conversation_review.support_reopens_deferred_topic"));
  });
}
check("real provider schema requires explicit typed links and rejects old or extra relation data", () => {
  const schema = zodTextFormat(FormativeConversationPlannedProposalOutputSchema, "preference-links-offline").schema;
  const validate = new Ajv({ allErrors: true }).compile(schema);
  assert(validate(prospective()), JSON.stringify(validate.errors));
  assert(!validate(fixture.original_rejected_candidates[0].candidate));
  const extra = prospective(); extra.post_reply_review.current_support[0].preference_links[0].inferred = true;
  assert(!validate(extra));
});
check("active deferred topic cannot be taught under a topic_of_support link", () => {
  for (const kind of ["explanation", "summary", "acknowledgment"]) {
    const wire = prospective(); wire.post_reply_review.current_support[0].kind = kind;
    wire.post_reply_review.current_support[0].preference_links[1].relationship = "topic_of_support";
    const projected = projectConversationContinuityWire(wire, context); assert(projected.output);
    assert(validateFormativeInterpretation({ candidate: projected.output, context }).validation_issue_paths.includes("conversation_review.support_reopens_deferred_topic"));
  }
});
check("an honored boundary cannot bypass an actually deferred need", () => {
  const wire = prospective(), deferral = wire.pre_reply_plan.preference_comparisons[1];
  wire.post_reply_review.need_updates = [{ need_id: "deferred_topic_need", kind: "support_request", status: "deferred",
    description: "The explicitly deferred topic remains deferred.", source: deferral.current_source,
    support: [], deferred_by_preference_id: deferral.preference_id }];
  wire.post_reply_review.current_support[0].need_ids = ["deferred_topic_need"];
  const result = projectConversationContinuityWire(wire, context); assert(result.output);
  assert(validateFormativeInterpretation({ candidate: result.output, context }).validation_issue_paths.includes("conversation_review.support_reopens_deferred_topic"));
});
check("no-quiz protection is global even with empty or honored links", () => {
  for (const links of [[], prospective().post_reply_review.current_support[0].preference_links]) {
    const wire = prospective(); wire.post_reply_review.current_support[0].kind = "optional_practice";
    wire.post_reply_review.current_support[0].preference_links = links;
    const result = projectConversationContinuityWire(wire, context); assert(result.output);
    assert(validateFormativeInterpretation({ candidate: result.output, context }).validation_issue_paths.includes("conversation_review.practice_conflicts_with_student_preference"));
  }
});
check("typed linkage requires exact unique ID parity without duplicates or omissions", () => {
  for (const mutate of [
    (s: CanonicalSupport) => { s.preference_ids.reverse(); },
    (s: CanonicalSupport) => { s.preference_linkage!.links.push(s.preference_linkage!.links[0]); s.preference_ids.push(s.preference_ids[0]); }
  ]) {
    const { output } = reconstruct(); mutate(output.conversation_review!.current_support[0]);
    assert(conversationContinuityIssues(output, context).includes("conversation_review.support_preference_link_ids_must_match"));
  }
});
check("unknown and released honored preferences are rejected", () => {
  const { output } = reconstruct(), support = output.conversation_review!.current_support[0];
  support.preference_ids[0] = "missing_preference"; support.preference_linkage!.links[0].preference_id = "missing_preference";
  assert(conversationContinuityIssues(output, context).includes("conversation_review.unknown_support_reference"));
  const valid = reconstruct().output;
  valid.conversation_review!.preference_updates[0].status = "released";
  assert(conversationContinuityIssues(valid, context).includes("conversation_review.honored_constraint_requires_active_preference"));
});
check("non-topic constraints cannot be relabeled as topics of support", () => {
  const { output } = reconstruct(); output.conversation_review!.current_support[0].preference_linkage!.links[0].relationship = "topic_of_support";
  assert(conversationContinuityIssues(output, context).includes("conversation_review.topic_support_requires_topic_preference"));
});
check("unknown linkage version or extra keys cannot be stripped into legacy behavior", () => {
  for (const change of [{ version: "unknown", links: [] }, { version: CONVERSATION_SUPPORT_PREFERENCE_LINK_VERSION, links: [], extra: true }]) {
    const review = structuredClone(reconstruct().output.conversation_review!);
    Object.assign(review.current_support[0], { preference_linkage: change });
    assert.equal(ConversationReviewSchema.safeParse(review).success, false);
  }
});
check("exact current source and release guards remain required", () => {
  const wire = prospective(); wire.pre_reply_plan.preference_comparisons[1].current_source.quote = "Invented permission";
  assert.equal(projectConversationContinuityWire(wire, context).output, null);
  const release = prospective(); release.pre_reply_plan.preference_comparisons[1].decision = "release";
  assert.equal(projectConversationContinuityWire(release, context).output, null);
});
check("accepted history retains typed relationships and unaltered full reply source", () => {
  const { output } = reconstruct(), index = Math.max(...context.visible_transcript.map(t => t.sequence_index)) + 1;
  const withReply = { ...context, visible_transcript: [...context.visible_transcript,
    { actor: "tutor" as const, sequence_index: index, message_text: output.student_visible_message, created_at: "2026-10-14T00:00:00.000Z" }] };
  const history = buildConversationContinuity({ context: withReply, records: [{ source_agent_call_public_id: "offline-preference-links",
    source_tutor_sequence_index: index, review: output.conversation_review }] });
  const support = history.support_history.at(-1)!;
  assert.deepEqual(support.preference_linkage, output.conversation_review!.current_support[0].preference_linkage);
  assert.equal(support.quote, output.student_visible_message);
  assert.equal(support.source_tutor_sequence_index, index);
});
check("frozen failed fixture remains byte-exact", () => {
  assert.equal(JSON.stringify(fixture), original);
  assert.equal(createHash("sha256").update(readFileSync(fixturePath)).digest("hex"), fixtureHash);
});
console.log(JSON.stringify({ suite: "formative-conversation-preference-links", passed: checks, failed: 0, provider_calls: 0 }));
