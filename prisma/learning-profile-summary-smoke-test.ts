import assert from "node:assert/strict";
import { learningProfileSummary } from "../src/lib/services/student-assessment/learning-profile-summary";

const profile = {
  id: "synthetic-profile", profile_type: "initial", item_level_evidence: [], misconception_indicators: [],
  process_interpretation_cautions: [], confidence_alignment: "well_calibrated",
  ability_profile: "mostly_correct_understanding", integrated_diagnostic_profile: "developing_understanding_with_productive_engagement",
  evidence_sufficiency: "adequate", created_at: new Date("2026-09-28T12:00:00Z"),
  based_on_agent_call: { agent_name: "student_profiling_agent", call_status: "succeeded", output_validated: true }
};
let checks = 0;
function expect(overrides: Partial<typeof profile>, label: string, transfer = "not_established") {
  const value = { ...profile, ...overrides };
  const original = JSON.stringify(value);
  const summary = learningProfileSummary(value);
  assert.equal(summary.understanding_label, label);
  assert.equal(summary.transfer_evidence_status, transfer);
  assert.equal(JSON.stringify(value), original, "Read-only projection must preserve the original profile");
  checks += 3;
}
expect({}, "Mostly understood");
expect({ ability_profile: "robust_transfer_ready_understanding", integrated_diagnostic_profile: "robust_understanding_ready_for_transfer" }, "Mostly understood", "supported_by_profile");
expect({ integrated_diagnostic_profile: "underconfident_but_reasoning_supported" }, "Mostly understood");
for (const ability_profile of ["partial_understanding", "fragile_correct_understanding", "procedural_or_application_error"]) expect({ ability_profile }, "Still developing");
for (const ability_profile of ["minimal_or_no_demonstrated_understanding", "fragmented_or_limited_understanding", "misconception_based_understanding"]) expect({ ability_profile }, "Need more work");
expect({ integrated_diagnostic_profile: "misconception_with_sufficient_engagement" }, "Need more work");
expect({ integrated_diagnostic_profile: "correct_but_fragile_understanding" }, "Mostly understood");
expect({ ability_profile: "fragile_correct_understanding", integrated_diagnostic_profile: "correct_but_fragile_understanding" }, "Still developing");
expect({ integrated_diagnostic_profile: "correct_but_independence_uncertain" }, "Still developing");
for (const integrated_diagnostic_profile of ["insufficient_evidence_for_formative_decision", "low_engagement_limits_interpretability", "conflicting_evidence_needs_clarification"]) expect({ integrated_diagnostic_profile }, "Unavailable / insufficient evidence");
expect({ ability_profile: "insufficient_evidence" }, "Unavailable / insufficient evidence");
expect({ evidence_sufficiency: "insufficient" }, "Unavailable / insufficient evidence");
expect({ integrated_diagnostic_profile: "unknown_future_category" }, "Unavailable / insufficient evidence");
expect({ ability_profile: "unknown_future_category" }, "Unavailable / insufficient evidence");
expect({ based_on_agent_call: { ...profile.based_on_agent_call, output_validated: false } }, "Unavailable / insufficient evidence", "unavailable");
expect({ based_on_agent_call: { ...profile.based_on_agent_call, call_status: "failed" } }, "Unavailable / insufficient evidence", "unavailable");
assert.equal(learningProfileSummary(null).understanding_label, "Unavailable / insufficient evidence");
assert.equal(learningProfileSummary({ ...profile, based_on_agent_call: null }).understanding_profile_stage, "unavailable");
assert.equal(learningProfileSummary({ ...profile, item_level_evidence: { evidence_integrated_profile_v2: {} } }).understanding_profile_stage, "unavailable");
assert.equal(learningProfileSummary({ ...profile, process_interpretation_cautions: ["Fallback-derived profile"] }).understanding_profile_stage, "unavailable");
assert.equal(learningProfileSummary(profile).understanding_profile_stage, "baseline");
assert.equal(learningProfileSummary({ ...profile, profile_type: "updated" }).understanding_profile_stage, "updated");
assert.equal(learningProfileSummary({ ...profile, integrated_diagnostic_profile: "correct_but_fragile_understanding" }).understanding_caution, "reasoning_refinement_needed");
console.log(`Learning-profile summary checks passed: ${checks + 7}.`);
