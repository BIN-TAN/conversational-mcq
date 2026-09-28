import assert from "node:assert/strict";
import { conversationVisibility } from "../src/lib/services/student-assessment/conversation-visibility";
import { buildTurnResponseLatencyRows, type LatencyConversationTurn } from "../src/lib/services/teacher-review/turn-response-latencies";
import { validateFormativeConversationOpeningDisclosureScope } from "../src/lib/services/student-assessment/formative-conversation/opening-contract";

const hidden = [{ student_visible: false }, { shown_to_student: false },
  ...["draft", "internal", "not_shown"].flatMap(value => [{ visibility_status: value }, { visibility: value }]),
  { message_type: "next_interaction", student_visible: true },
  { student_visible: true, visibility_status: "internal" }];
for (const payload of hidden) assert.equal(conversationVisibility(payload), "internal_only");
for (const payload of [{ student_visible: true }, { shown_to_student: true }, { visibility: "student_visible" }, { visibility_status: "shown" }]) {
  assert.equal(conversationVisibility(payload), "student_visible");
}
for (const payload of [null, [], {}, { source: "initial_answer" }]) assert.equal(conversationVisibility(payload), "legacy_unspecified");
for (const message_type of ["package_feedback", "pattern_statement"]) {
  assert.equal(conversationVisibility({ message_type }, true), "internal_only");
  assert.equal(conversationVisibility({ message_type }, false), "legacy_unspecified");
}
const base: LatencyConversationTurn = { session_public_id: "synthetic", student_user_id: "synthetic", assessment_public_id: "synthetic",
  turn_index: 1, actor_type: "agent", phase: "planning_completed", agent_name: "tutor", message_text: "Internal summary",
  structured_payload: { student_visible: false }, created_at: "2026-09-28T00:00:00Z",
  concept_unit_public_id: null, item_public_id: null, item_order: null };
const rows = buildTurnResponseLatencyRows({ turns: [base,
  { ...base, turn_index: 2, structured_payload: { visibility: "student_visible" }, message_text: "What did you mean by that comparison?", created_at: "2026-09-28T00:00:10Z" },
  { ...base, turn_index: 3, actor_type: "student", created_at: "2026-09-28T00:00:15Z" },
  { ...base, turn_index: 4, actor_type: "student", structured_payload: {}, created_at: "2026-09-28T00:00:30Z" }
], processEvents: [] });
assert.equal(rows.length, 1);
assert.equal(rows[0].prompt_turn_index, 2);
assert.equal(rows[0].next_student_turn_index, 4);
assert.equal(rows[0].response_latency_ms, 20000);
for (const message of ["The reasoning evidence needs additional review before making a stronger claim.", "This first package does not yet show transfer to a new item."]) {
  assert(validateFormativeConversationOpeningDisclosureScope(message).includes("opening_exposes_internal_evidence_report"));
}
assert.deepEqual(validateFormativeConversationOpeningDisclosureScope("You wrote that the findings should be considered together. What would conflicting findings mean for this decision?"), []);
console.log("Conversation visibility, hidden-prompt latency, legacy preservation and opening language checks passed.");
