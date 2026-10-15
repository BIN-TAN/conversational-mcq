import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CONVERSATION_PRE_REPLY_PLAN_VERSION, CONVERSATION_STORED_PREFERENCE_RETENTION_VERSION,
  CONVERSATION_STORED_PREFERENCE_TRANSITION_VERSION, CONVERSATION_CURRENT_SOURCE_ACTIVATION_PROJECTION_VERSION,
  CONVERSATION_PRIOR_TUTOR_SOURCE_VERSION, CONVERSATION_CURRENT_REPLY_SOURCE_VERSION,
  CONVERSATION_SUPPORT_PREFERENCE_LINK_VERSION, ConversationReviewSchema, ConversationContinuitySchema, emptyConversationContinuity
} from "../src/lib/services/student-assessment/formative-conversation/conversation-continuity";
import type { FormativeConversationV18R2AgentInput } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import {
  verifyStoredPreferenceRetentionProjection, verifySelectedConversationPlanAudit
} from "../src/lib/operational/luna-conversation-replay-evidence";

// Source/receipt protocol checks only. No provider call, student data or learning
// judgment is created by these explicitly synthetic fixtures.
globalThis.fetch = async () => { throw new Error("network_forbidden_in_stored_retention_evidence_smoke"); };
let checks = 0;
const check = (action: () => void) => { action(); checks++; };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const source = { evidence_id: "ev_" + "a".repeat(24), quote: "Leave the second topic for later." };
const preferences = [
  { preference_id: "active-boundary", kind: "defer_topic" as const, description: "The second topic is deferred.", status: "active" as const, source },
  { preference_id: "released-boundary", kind: "no_quiz" as const, description: "No quiz.", status: "released" as const, source }
].map(preference => ({ ...preference, source_agent_call_public_id: "offline-prior-call", source_tutor_sequence_index: 2 }));
const context = {
  conversation_public_id: "offline-conversation", assessment_public_id: "offline-assessment", concept_unit_public_id: "offline-concept",
  visible_transcript: [{ sequence_index: 1, actor: "student", message_text: source.quote }],
  allowed_evidence_catalog: { evidence_scope_id: "offline-scope", evidence: [{
    evidence_id: source.evidence_id, source_role: "student", evidence_kind: "formative_student_turn", evidence_stage: "formative_conversation",
    evidence_scope_id: "offline-scope", conversation_public_id: "offline-conversation", assessment_public_id: "offline-assessment",
    concept_unit_public_id: "offline-concept", source_sequence_index: 1, content: source.quote
  }] },
  conversation_continuity: { ...emptyConversationContinuity("offline-conversation"), preferences }
} as unknown as FormativeConversationV18R2AgentInput;
const review = ConversationReviewSchema.parse({
  version: "conversation-review-v1", preference_updates: [], need_updates: [],
  student_state: { understanding: "not_reported", understanding_source: null, readiness: "not_reported", readiness_source: null },
  current_support: [], recap_claims: [], closure: { reason: "continue_support", rationale: "OFFLINE protocol fixture only.", unresolved_need_ids: [], instructor_support: null }
});
const wireFor = (comparisons: unknown[]) => ({
  pre_reply_plan: { version: CONVERSATION_PRE_REPLY_PLAN_VERSION, preference_comparisons: comparisons }
});
const rawFor = (wire: unknown) => ({ status: "completed", output: [{ type: "message", role: "assistant", status: "completed",
  content: [{ type: "output_text", text: JSON.stringify(wire) }] }] });
const retained = [
  { preference_id: "released-boundary", decision: "retain" },
  { preference_id: "active-boundary", decision: "retain" }
];
const wire = wireFor(retained);
const binding = (id: string) => ({ preference_id: id, preference_sha256: hash(
  ConversationContinuitySchema.parse(context.conversation_continuity).preferences.find(p => p.preference_id === id)
) });
const projection = {
  version: CONVERSATION_PRE_REPLY_PLAN_VERSION,
  stored_preference_retention_version: CONVERSATION_STORED_PREFERENCE_RETENTION_VERSION,
  original_output_sha256: hash(wire), stored_preference_bindings: retained.map(r => binding(r.preference_id))
};
const verify = (p: Record<string, unknown> = projection, c = context, r = review, w: unknown = wire) =>
  verifyStoredPreferenceRetentionProjection(p, c, r, rawFor(w));

check(() => assert.deepEqual(verify(), projection.stored_preference_bindings));
check(() => assert.deepEqual(verify({ ...projection, original_output_sha256: hash(wireFor([])), stored_preference_bindings: [] }, context, review, wireFor([])), []));
for (const altered of [undefined, "historical"]) {
  check(() => assert.throws(() => verify({ ...projection, stored_preference_retention_version: altered })));
  check(() => assert.throws(() => verify({ ...projection, version: altered })));
}
for (const altered of [[], projection.stored_preference_bindings.slice(0, 1), [...projection.stored_preference_bindings].reverse(),
  [...projection.stored_preference_bindings, binding("active-boundary")],
  [{ ...projection.stored_preference_bindings[0], preference_sha256: "0".repeat(64) }, projection.stored_preference_bindings[1]]]) {
  check(() => assert.throws(() => verify({ ...projection, stored_preference_bindings: altered })));
}
for (const extra of [{ current_source: null }, { change_basis: "no_change" }, { prior: { origin: "stored_preference" } },
  { kind: "no_quiz" }, { description: "Copying prior identity is forbidden." }, { arbitrary: true },
  { prior: { origin: "stored_preference" }, current_source: null, change_basis: "uncertainty_only" }]) {
  const changed = wireFor([{ ...retained[0], ...extra }, retained[1]]);
  check(() => assert.throws(() => verify({ ...projection, original_output_sha256: hash(changed) }, context, review, changed)));
}
for (const comparisons of [[retained[0], retained[0]], [{ preference_id: "unknown-id", decision: "retain" }]]) {
  const changed = wireFor(comparisons);
  check(() => assert.throws(() => verify({ ...projection, original_output_sha256: hash(changed) }, context, review, changed)));
}
const duplicatedInput = { ...context, conversation_continuity: { ...context.conversation_continuity!, preferences: [...preferences, preferences[0]] } };
check(() => assert.throws(() => verify(projection, duplicatedInput)));
for (const mutation of ["missing-entry", "duplicate-entry", "missing-turn", "duplicate-turn", "nonstudent-turn", "nonstudent-entry",
  "scope", "conversation", "assessment", "concept", "kind", "stage", "null-sequence", "future-sequence", "changed-content", "changed-quote"] as const) {
  const changed = structuredClone(context);
  const entry = changed.allowed_evidence_catalog.evidence[0];
  if (mutation === "missing-entry") changed.allowed_evidence_catalog.evidence = [];
  if (mutation === "duplicate-entry") changed.allowed_evidence_catalog.evidence.push(structuredClone(entry));
  if (mutation === "missing-turn") changed.visible_transcript = [];
  if (mutation === "duplicate-turn") changed.visible_transcript.push(structuredClone(changed.visible_transcript[0]));
  if (mutation === "nonstudent-turn") Object.assign(changed.visible_transcript[0], { actor: "tutor" });
  if (mutation === "nonstudent-entry") Object.assign(entry, { source_role: "tutor" });
  if (mutation === "scope") entry.evidence_scope_id = "wrong-scope";
  if (mutation === "conversation") entry.conversation_public_id = "wrong-conversation";
  if (mutation === "assessment") entry.assessment_public_id = "wrong-assessment";
  if (mutation === "concept") entry.concept_unit_public_id = "wrong-concept";
  if (mutation === "kind") Object.assign(entry, { evidence_kind: "assessment_reasoning" });
  if (mutation === "stage") Object.assign(entry, { evidence_stage: "baseline_assessment" });
  if (mutation === "null-sequence") entry.source_sequence_index = null;
  if (mutation === "future-sequence") entry.source_sequence_index = 999;
  if (mutation === "changed-content") entry.content += " Changed content.";
  if (mutation === "changed-quote") changed.conversation_continuity!.preferences[0].source.quote = "Not in the original source.";
  check(() => assert.throws(() => verify(projection, changed), /Retained stored preference source/u));
}
for (const preference of preferences) {
  check(() => assert.throws(() => verify(projection, context, { ...review, preference_updates: [preference] })));
  check(() => assert.throws(() => verify(projection, context, { ...review, bootstrap_preference_origins: [{
    preference_id: preference.preference_id, kind: preference.kind, description: preference.description, source: preference.source
  }] })));
}
const oldWire = { ...wire, pre_reply_plan: { ...wire.pre_reply_plan, version: "conversation-pre-reply-plan-v1" } };
check(() => assert.throws(() => verify({ ...projection, original_output_sha256: hash(oldWire) }, context, review, oldWire)));
check(() => assert.throws(() => verify({ ...projection, original_output_sha256: "0".repeat(64) })));
check(() => assert.throws(() => verifyStoredPreferenceRetentionProjection(projection, context, review, {
  accepted_output: rawFor(wire), provider_raw_output: rawFor(wire)
})));
// These are stored transitions, not retention. Their receipts must still be in
// the same ordered inventory; current-source permission remains projector-owned.
const transition = { preference_id: "released-boundary", prior: { origin: "stored_preference" },
  decision: "activate", change_basis: "explicit_change", current_source: source };
const transitionWire = wireFor([retained[1], transition]);
const transitionBindings = [binding("active-boundary"), binding("released-boundary")];
check(() => assert.deepEqual(verify({ ...projection, original_output_sha256: hash(transitionWire), stored_preference_bindings: transitionBindings },
  context, { ...review, preference_updates: [{ ...preferences[1], status: "active" }] }, transitionWire), transitionBindings));
check(() => assert.throws(() => verify({ ...projection, original_output_sha256: hash(transitionWire), stored_preference_bindings: [binding("active-boundary")] },
  context, review, transitionWire)));
const fullProjection = {
  ...projection, status: "reconstructed", reconstructed_output_sha256: "1".repeat(64),
  stored_preference_transition_version: CONVERSATION_STORED_PREFERENCE_TRANSITION_VERSION,
  current_source_activation_projection_version: CONVERSATION_CURRENT_SOURCE_ACTIVATION_PROJECTION_VERSION,
  current_source_activation_bindings: [], prior_tutor_source_version: CONVERSATION_PRIOR_TUTOR_SOURCE_VERSION,
  prior_tutor_bindings: [], prior_needs_sha256: hash([]), derived_open_need_ids: [],
  current_reply_source_version: CONVERSATION_CURRENT_REPLY_SOURCE_VERSION, current_reply_bindings: [],
  support_preference_link_version: CONVERSATION_SUPPORT_PREFERENCE_LINK_VERSION, support_preference_link_bindings: [], validation_issue_paths: []
};
const fullAudit = { attempts: [{ accepted: true, provider_response_id: "offline-response", result_status: "completed", failure_class: null,
  conversation_plan_projection: fullProjection }] };
check(() => assert.deepEqual(verifySelectedConversationPlanAudit(fullAudit, "offline-response", context,
  { student_visible_message: "OFFLINE protocol fixture.", conversation_review: review }, rawFor(wire)).stored_preference_bindings,
projection.stored_preference_bindings));
const missingInventory = structuredClone(fullAudit);
missingInventory.attempts[0].conversation_plan_projection.stored_preference_bindings = [];
check(() => assert.throws(() => verifySelectedConversationPlanAudit(missingInventory, "offline-response", context,
  { student_visible_message: "OFFLINE protocol fixture.", conversation_review: review }, rawFor(wire))));

console.log(JSON.stringify({ passed: true, checks, network_calls: 0, provider_calls: 0, database_calls: 0 }));
