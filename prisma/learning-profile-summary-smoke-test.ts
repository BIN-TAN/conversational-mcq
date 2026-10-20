import assert from "node:assert/strict";
import { conversationUpdateSummary, initialLearningProfile, latestLearningProfile, learningProfileSummary } from "../src/lib/services/student-assessment/learning-profile-summary";

const profile = {
  id: "synthetic-profile", profile_type: "initial", item_level_evidence: [], misconception_indicators: [],
  process_interpretation_cautions: [], confidence_alignment: "well_calibrated",
  ability_profile: "mostly_correct_understanding", integrated_diagnostic_profile: "developing_understanding_with_productive_engagement",
  evidence_sufficiency: "adequate", created_at: new Date("2026-09-28T12:00:00Z"),
  based_on_agent_call: { agent_name: "student_profiling_agent", call_status: "succeeded", output_validated: true }
};
let checks = 0;
function expect(overrides: Partial<typeof profile>, label: string) {
  const value = { ...profile, ...overrides };
  const original = JSON.stringify(value);
  const summary = learningProfileSummary(value);
  assert.equal(summary.understanding_label, label);
  assert.equal("transfer_evidence_status" in summary, false, "The mini-test has no transfer task, so no transfer status is reported");
  assert.equal(JSON.stringify(value), original, "Read-only projection must preserve the original profile");
  checks += 3;
}
expect({}, "Mostly understood");
expect({ ability_profile: "robust_transfer_ready_understanding", integrated_diagnostic_profile: "robust_understanding_ready_for_transfer" }, "Mostly understood");
expect({ integrated_diagnostic_profile: "underconfident_but_reasoning_supported" }, "Mostly understood");
for (const ability_profile of ["partial_understanding", "fragile_correct_understanding", "procedural_or_application_error"]) expect({ ability_profile }, "Still developing");
for (const ability_profile of ["minimal_or_no_demonstrated_understanding", "fragmented_or_limited_understanding", "misconception_based_understanding"]) expect({ ability_profile }, "Need more work");
expect({ integrated_diagnostic_profile: "misconception_with_sufficient_engagement" }, "Need more work");
expect({ integrated_diagnostic_profile: "correct_but_fragile_understanding" }, "Mostly understood");
expect({ ability_profile: "fragile_correct_understanding", integrated_diagnostic_profile: "correct_but_fragile_understanding" }, "Still developing");
expect({ integrated_diagnostic_profile: "correct_but_independence_uncertain" }, "Mostly understood");
expect({ ability_profile: "fragile_correct_understanding", integrated_diagnostic_profile: "correct_but_independence_uncertain" }, "Still developing");
expect({ ability_profile: "partial_understanding", integrated_diagnostic_profile: "correct_but_independence_uncertain" }, "Still developing");
expect({ ability_profile: "misconception_based_understanding", integrated_diagnostic_profile: "correct_but_independence_uncertain" }, "Need more work");
expect({ evidence_sufficiency: "insufficient", integrated_diagnostic_profile: "correct_but_independence_uncertain" }, "Unavailable / insufficient evidence");
const independentCaution = learningProfileSummary({ ...profile, integrated_diagnostic_profile: "correct_but_independence_uncertain" });
assert.equal(independentCaution.understanding_caution, "independent_understanding_uncertain");
assert.equal(independentCaution.understanding_summary_version, "understanding-summary-v4");
for (const integrated_diagnostic_profile of ["insufficient_evidence_for_formative_decision", "low_engagement_limits_interpretability", "conflicting_evidence_needs_clarification"]) expect({ integrated_diagnostic_profile }, "Unavailable / insufficient evidence");
expect({ ability_profile: "insufficient_evidence" }, "Unavailable / insufficient evidence");
expect({ evidence_sufficiency: "insufficient" }, "Unavailable / insufficient evidence");
expect({ integrated_diagnostic_profile: "unknown_future_category" }, "Unavailable / insufficient evidence");
expect({ ability_profile: "unknown_future_category" }, "Unavailable / insufficient evidence");
expect({ based_on_agent_call: { ...profile.based_on_agent_call, output_validated: false } }, "Unavailable / insufficient evidence");
expect({ based_on_agent_call: { ...profile.based_on_agent_call, call_status: "failed" } }, "Unavailable / insufficient evidence");
assert.equal(learningProfileSummary(null).understanding_label, "Unavailable / insufficient evidence");
assert.equal(learningProfileSummary({ ...profile, based_on_agent_call: null }).understanding_profile_stage, "unavailable");
assert.equal(learningProfileSummary({ ...profile, item_level_evidence: { evidence_integrated_profile_v2: {} } }).understanding_profile_stage, "unavailable");
assert.equal(learningProfileSummary({ ...profile, process_interpretation_cautions: ["Fallback-derived profile"] }).understanding_profile_stage, "unavailable");
assert.equal(learningProfileSummary(profile).understanding_profile_stage, "baseline");
assert.equal(learningProfileSummary({ ...profile, profile_type: "updated" }).understanding_profile_stage, "updated");
assert.equal(learningProfileSummary({ ...profile, integrated_diagnostic_profile: "correct_but_fragile_understanding" }).understanding_caution, "reasoning_refinement_needed");

// Interpretation v8 profiles take the rule label stored with their item ratings (understanding-summary-v4).
const v8Evidence = (label: string, reason: string) => ({ profile_schema: "student-interpretation-profile-v8", topic_summary: { label, reason } });
assert.equal(learningProfileSummary({ ...profile, ability_profile: "insufficient_evidence", item_level_evidence: v8Evidence("Still developing", "mixed") }).understanding_label, "Still developing");
const pendingV8 = learningProfileSummary({ ...profile, item_level_evidence: v8Evidence("Pending item review", "flagged_items_change_label") });
assert.equal(pendingV8.understanding_label, "Pending item review");
assert.equal(pendingV8.understanding_reason, "interpretation_v8_flagged_items_change_label");
assert.equal(learningProfileSummary({ ...profile, item_level_evidence: v8Evidence("Mostly understood", "supported_majority_none_unsupported"),
  process_interpretation_cautions: ["Fallback-derived profile"] }).understanding_label, "Unavailable / insufficient evidence", "A fallback v8 profile has no label");
checks += 4;

// The mini-test profile stays the reporting category; conversation updates are a separate variable.
const updatedProfile = { ...profile, id: "synthetic-updated-profile", profile_type: "updated",
  ability_profile: "robust_transfer_ready_understanding", created_at: new Date("2026-09-28T12:30:00Z") };
const conversationSession = (transitions: unknown[]) => ({
  concept_unit_sessions: [{ id: "unit-session", latest_student_profile: profile }],
  formative_conversation_sessions: [{ concept_unit_session_db_id: "unit-session", initial_student_profile: profile, profile_transitions: transitions }]
}) as unknown as Parameters<typeof initialLearningProfile>[0];
const noUpdate = conversationSession([]);
assert.equal(initialLearningProfile(noUpdate)?.id, profile.id);
assert.deepEqual(
  { label: conversationUpdateSummary(noUpdate).conversation_profile_update, count: conversationUpdateSummary(noUpdate).conversation_profile_update_count,
    updated: conversationUpdateSummary(noUpdate).conversation_updated_understanding_label },
  { label: "No profile update", count: 0, updated: null }
);
// An unvalidated transition never counts as a conversation update, and never replaces the mini-test profile.
const unvalidated = conversationSession([{ transition_public_id: "t1", learning_outcome: "sound", transitioned_at: new Date("2026-09-28T12:30:00Z"),
  profile_snapshot: {}, learning_observations: [], evidence_interpretation: null, supporting_turn_references: [],
  prior_student_profile: profile, updated_student_profile: updatedProfile }]);
assert.equal(initialLearningProfile(unvalidated)?.id, profile.id);
assert.equal(latestLearningProfile(unvalidated)?.id, profile.id);
assert.equal(conversationUpdateSummary(unvalidated).conversation_profile_update, "No profile update");
const withoutConversation = { concept_unit_sessions: [{ id: "unit-session", latest_student_profile: profile }], formative_conversation_sessions: [] } as unknown as Parameters<typeof initialLearningProfile>[0];
assert.equal(initialLearningProfile(withoutConversation)?.id, profile.id);
assert.equal(conversationUpdateSummary(withoutConversation).conversation_profile_update_count, 0);
console.log(`Learning-profile summary checks passed: ${checks + 18}.`);
