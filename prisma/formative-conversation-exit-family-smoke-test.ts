import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FormativeConversationV18R2AgentInputSchema,
  type FormativeConversationV18R2AgentInput,
  type FormativeConversationV18R2AgentOutput
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import {
  conversationContinuityIssues,
  projectConversationContinuityWire
} from "../src/lib/services/student-assessment/formative-conversation/conversation-continuity";
import { reconstructFormativeProfileProposal } from "../src/lib/services/student-assessment/formative-conversation/profile-update-proposal";
import { validateFormativeInterpretation } from "../src/lib/services/student-assessment/formative-conversation/interpretation-policy";

globalThis.fetch = async () => { throw new Error("Exit-family checks are offline"); };
const fixtureText = readFileSync(new URL("./fixtures/conversation-continuity-native-exit-family.json", import.meta.url), "utf8");
const fixture = JSON.parse(fixtureText);
assert.equal(fixture.synthetic_only, true);
assert.equal(fixture.real_student_records_used, false);
const context = FormativeConversationV18R2AgentInputSchema.parse(fixture.context);
const originalContext = JSON.stringify(context);
const originalCandidates = JSON.stringify(fixture.candidates);
const readyFixtureUrl = new URL("./fixtures/conversation-continuity-native-ready-exit.json", import.meta.url);
const readyFixtureText = readFileSync(readyFixtureUrl, "utf8");
const readyFixture = JSON.parse(readyFixtureText);
assert.equal(readyFixture.synthetic_only, true);
assert.equal(readyFixture.real_student_records_used, false);
const readyContext = FormativeConversationV18R2AgentInputSchema.parse(readyFixture.context);
const originalReadyContext = JSON.stringify(readyContext);
const originalReadyCandidates = JSON.stringify(readyFixture.candidates);
function projected(index = 1, sourceContext = context) {
  const plan = projectConversationContinuityWire(fixture.candidates[index].candidate, sourceContext);
  assert.ok(plan.output, JSON.stringify(plan.audit.validation_issue_paths));
  const profile = reconstructFormativeProfileProposal({ candidate: plan.output, context: sourceContext });
  assert.ok(profile.valid && profile.output, JSON.stringify(profile.validation_issue_paths));
  return profile.output;
}
function projectedReady(index = 1, sourceContext = readyContext) {
  const plan = projectConversationContinuityWire(readyFixture.candidates[index].candidate, sourceContext);
  assert.ok(plan.output, JSON.stringify(plan.audit.validation_issue_paths));
  const profile = reconstructFormativeProfileProposal({ candidate: plan.output, context: sourceContext });
  assert.ok(profile.valid && profile.output, JSON.stringify(profile.validation_issue_paths));
  return profile.output;
}
let checks = 0;
function test(name: string, run: () => void) {
  run(); checks += 1; console.log(`PASS ${name}`);
}
function issues(candidate: FormativeConversationV18R2AgentOutput, input = context) {
  return conversationContinuityIssues(candidate, input, { required: true });
}
function review(candidate: FormativeConversationV18R2AgentOutput) {
  assert.ok(candidate.conversation_review);
  return candidate.conversation_review;
}

test("actual V8 repaired exit passes without relabeling the student's stop-for-today decision", () => {
  assert.deepEqual(fixture.candidates[1].original_validation_issue_paths, ["conversation_review.exit_requires_current_student_request"]);
  const candidate = projected();
  const result = validateFormativeInterpretation({ candidate, context });
  assert.equal(result.valid, true, JSON.stringify(result.validation_issue_paths));
  assert.equal(review(candidate).student_state.readiness, "stop");
  assert.equal(review(candidate).closure.reason, "student_pause");
  assert.equal(candidate.lifecycle_recommendation, "pause");
  assert.equal(candidate.profile_transition_recommendation, null);
  assert.equal(candidate.teacher_assistance_recommendation.recommended, false);
  assert.deepEqual(review(candidate).closure.unresolved_need_ids, ["need_reliability_validity_explanation"]);
});

test("the original base still fails exact quote validation", () => {
  const result = validateFormativeInterpretation({ candidate: projected(0), context });
  assert.equal(result.valid, false);
  assert.deepEqual(result.validation_issue_paths, [
    "conversation_review.current_support_quote_invalid",
    "conversation_review.tutor_source_invalid"
  ]);
});

for (const readiness of ["pause", "stop"] as const) {
  for (const reason of ["student_pause", "student_stop"] as const) {
    test(`current exit-family ${readiness}/${reason} preserves authored labels and unresolved needs`, () => {
      const candidate = projected();
      review(candidate).student_state.readiness = readiness;
      review(candidate).closure.reason = reason;
      assert.deepEqual(issues(candidate), []);
      assert.equal(review(candidate).student_state.readiness, readiness);
      assert.equal(review(candidate).closure.reason, reason);
      assert.equal(candidate.lifecycle_recommendation, "pause");
    });
  }
}

for (const readiness of ["not_ready", "not_reported"] as const) {
  test(`${readiness} cannot substitute for explicit exit intent`, () => {
    const candidate = projected();
    review(candidate).student_state.readiness = readiness;
    const found = issues(candidate);
    assert.ok(found.includes("conversation_review.exit_requires_ready_pause_or_stop_readiness"));
    assert.ok(!found.includes("conversation_review.exit_requires_current_student_request"));
  });
}

test("missing source produces the separate source diagnostic", () => {
  const candidate = projected(); review(candidate).student_state.readiness_source = null;
  assert.ok(issues(candidate).includes("conversation_review.exit_requires_current_student_request"));
  assert.ok(!issues(candidate).includes("conversation_review.exit_requires_ready_pause_or_stop_readiness"));
});

test("an earlier genuine stop cannot authorize a current exit", () => {
  const candidate = projected();
  const earlier = context.allowed_evidence_catalog.evidence.find(entry => entry.evidence_kind === "formative_student_turn" && entry.source_sequence_index === 30)!;
  review(candidate).student_state.readiness_source = { evidence_id: earlier.evidence_id, quote: earlier.content };
  assert.ok(issues(candidate).includes("conversation_review.exit_requires_current_student_request"));
});

for (const mutation of ["wrong_quote", "wrong_scope", "wrong_actor", "future_sequence"] as const) {
  test(`${mutation} does not bypass current student provenance`, () => {
    const input: FormativeConversationV18R2AgentInput = structuredClone(context);
    const candidate = projected();
    const source = review(candidate).student_state.readiness_source!;
    const entry = input.allowed_evidence_catalog.evidence.find(item => item.evidence_id === source.evidence_id)!;
    if (mutation === "wrong_quote") source.quote = "I definitely understand everything now.";
    if (mutation === "wrong_scope") entry.conversation_public_id = "different-conversation";
    if (mutation === "wrong_actor") entry.source_role = "tutor";
    if (mutation === "future_sequence") entry.source_sequence_index = 900;
    assert.ok(issues(candidate, input).includes("conversation_review.exit_requires_current_student_request"));
  });
}

test("exit does not authorize referral, readiness mastery or continued lifecycle", () => {
  const candidate = projected();
  candidate.teacher_assistance_recommendation = { recommended: true, reason_code: "student_stopped" };
  assert.ok(issues(candidate).includes("conversation_review.instructor_not_implied_by_exit_or_limit"));
  candidate.teacher_assistance_recommendation = { recommended: false, reason_code: null };
  candidate.lifecycle_recommendation = "continue";
  assert.ok(issues(candidate).includes("conversation_review.closure_lifecycle_mismatch"));
  candidate.lifecycle_recommendation = "complete";
  review(candidate).closure.reason = "ready";
  assert.ok(issues(candidate).includes("conversation_review.ready_requires_current_student_report"));
  assert.ok(issues(candidate).includes("conversation_review.ready_has_unresolved_support_or_claims"));
});

for (const index of [0, 1]) {
  test(`actual V10 ${index === 0 ? "base" : "repaired"} ready-to-finish wire passes without relabeling`, () => {
    assert.deepEqual(readyFixture.candidates[index].original_validation_issue_paths, ["conversation_review.exit_requires_pause_or_stop_readiness"]);
    const candidate = projectedReady(index);
    const result = validateFormativeInterpretation({ candidate, context: readyContext });
    assert.equal(result.valid, true, JSON.stringify(result.validation_issue_paths));
    assert.equal(review(candidate).student_state.readiness, "ready");
    assert.equal(review(candidate).closure.reason, "student_stop");
    assert.equal(candidate.lifecycle_recommendation, index === 0 ? "complete" : "pause");
    assert.equal(candidate.profile_transition_recommendation, null);
    assert.equal(candidate.teacher_assistance_recommendation.recommended, false);
    assert.deepEqual(review(candidate).closure.unresolved_need_ids, []);
  });
}

for (const reason of ["student_pause", "student_stop"] as const) {
  test(`current ready-to-finish report can accompany ${reason} while unresolved profile evidence remains`, () => {
    const input = structuredClone(readyContext);
    input.current_profile.unresolved_evidence.push("An observed conceptual explanation still needs support.");
    const candidate = projectedReady(1, input);
    review(candidate).closure.reason = reason;
    assert.deepEqual(issues(candidate, input), []);
    assert.equal(review(candidate).student_state.readiness, "ready");
    assert.equal(review(candidate).closure.reason, reason);
    assert.deepEqual(input.current_profile.unresolved_evidence, ["An observed conceptual explanation still needs support."]);
    assert.equal(candidate.profile_transition_recommendation, null);
  });
}

for (const mutation of ["missing_source", "earlier_source", "wrong_quote", "wrong_scope", "wrong_actor", "future_sequence"] as const) {
  test(`ready-to-finish ${mutation} cannot bypass the exact current student source`, () => {
    const input = structuredClone(readyContext);
    const candidate = projectedReady();
    const state = review(candidate).student_state;
    const entry = input.allowed_evidence_catalog.evidence.find(item => item.evidence_id === state.readiness_source!.evidence_id)!;
    if (mutation === "missing_source") state.readiness_source = null;
    if (mutation === "earlier_source") {
      const earlier = input.allowed_evidence_catalog.evidence.find(item => item.evidence_kind === "formative_student_turn" && item.source_sequence_index === 28)!;
      state.readiness_source = { evidence_id: earlier.evidence_id, quote: earlier.content };
    }
    if (mutation === "wrong_quote") state.readiness_source!.quote = "A finish request that the student did not make.";
    if (mutation === "wrong_scope") entry.conversation_public_id = "another-conversation";
    if (mutation === "wrong_actor") entry.source_role = "tutor";
    if (mutation === "future_sequence") entry.source_sequence_index = 900;
    assert.ok(issues(candidate, input).includes("conversation_review.exit_requires_current_student_request"));
  });
}

for (const readiness of ["not_ready", "not_reported"] as const) {
  test(`V10 current finish quote cannot make ${readiness} an accepted readiness report`, () => {
    const candidate = projectedReady();
    review(candidate).student_state.readiness = readiness;
    assert.ok(issues(candidate, readyContext).includes("conversation_review.exit_requires_ready_pause_or_stop_readiness"));
  });
}

test("strong ready closure still rejects unresolved evidence despite an exact current ready-to-finish report", () => {
  const input = structuredClone(readyContext);
  input.current_profile.unresolved_evidence.push("The student's explanation still conflicts with an observed concept.");
  const candidate = projectedReady(1, input);
  review(candidate).closure.reason = "ready";
  const found = issues(candidate, input);
  assert.ok(found.includes("conversation_review.ready_has_unresolved_support_or_claims"));
  assert.ok(!found.includes("conversation_review.ready_requires_current_student_report"));
  assert.equal(candidate.profile_transition_recommendation, null);
});

test("history and exact native wire remain unchanged", () => {
  assert.equal(JSON.stringify(context), originalContext);
  assert.equal(JSON.stringify(fixture.candidates), originalCandidates);
  assert.equal(readFileSync(new URL("./fixtures/conversation-continuity-native-exit-family.json", import.meta.url), "utf8"), fixtureText);
  assert.equal(JSON.stringify(readyContext), originalReadyContext);
  assert.equal(JSON.stringify(readyFixture.candidates), originalReadyCandidates);
  assert.equal(readFileSync(readyFixtureUrl, "utf8"), readyFixtureText);
});
console.log(JSON.stringify({ checks_passed: checks, provider_calls: 0, source_agent_calls_sha256: fixture.source_agent_calls_sha256, ready_source_agent_calls_sha256: readyFixture.source_agent_calls_sha256 }));
