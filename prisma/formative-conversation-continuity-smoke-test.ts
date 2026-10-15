import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  buildConversationContinuity,
  conversationContinuityIssues,
  conversationResultingStateDiagnostics,
  continuityQuoteDiagnostics,
  emptyConversationContinuity,
  CONVERSATION_REVIEW_VERSION,
  CONVERSATION_PRE_REPLY_PLAN_VERSION,
  CONVERSATION_CURRENT_REPLY_SOURCE_VERSION,
  CONVERSATION_CURRENT_SOURCE_ACTIVATION_PROJECTION_VERSION,
  CONVERSATION_DEFERRED_NEED_LINK_VERSION,
  CONVERSATION_STORED_PREFERENCE_RETENTION_VERSION,
  CONVERSATION_CONTINUITY_INSTRUCTIONS,
  conversationCurrentReplySourceHash,
  CONVERSATION_SUPPORT_PREFERENCE_LINK_VERSION,
  ConversationPreReplyPlanSchema,
  ConversationPreReplyPlanV1Schema,
  ConversationPreReplyPlanStoredIdentityV1Schema,
  ConversationPostReplyReviewSchema,
  ConversationPlanProjectionAuditSchema,
  ConversationContinuitySchema,
  projectConversationContinuityWire,
  CONVERSATION_DELIVERY_REVIEW_VERSION,
  CONVERSATION_DELIVERY_REVIEW_INSTRUCTIONS,
  ConversationDeliveryReviewSchema,
  buildConversationDeliveryReviewInput,
  buildConversationDeliveryDraftBlocks,
  validateConversationDeliveryReview,
  type ConversationDeliveryReview,
  type ConversationPreReplyPlan,
  type ConversationReview
} from "../src/lib/services/student-assessment/formative-conversation/conversation-continuity";
import {
  v18r2TestContext as historicalTestContext,
  v18r2TestContinueOutput
} from "./formative-conversation-v18r2-test-fixtures";
import { validateFormativeConversationV18R2CandidateAcceptance } from "../src/lib/services/student-assessment/formative-conversation/candidate-validation-v18r2";
import { FormativeConversationV18R2AgentInputSchema } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";

function v18r2TestContext(input: Parameters<typeof historicalTestContext>[0]) {
  const value = historicalTestContext(input);
  // These continuity fixtures contain no administered item content. Keep the
  // reviewer protocol view explicit rather than inventing an assessment source.
  value.assessment_response_evidence = [];
  return value;
}
type Context = ReturnType<typeof v18r2TestContext>;
globalThis.fetch = async () => { throw new Error("Offline continuity checks cannot call a provider"); };
function source(context: Context, quote: string) {
  const entry = context.allowed_evidence_catalog.evidence.find(item => item.source_role === "student" &&
    item.evidence_kind === "formative_student_turn" && item.content.includes(quote));
  assert.ok(entry, `Missing test student quote ${quote}`);
  return { evidence_id: entry.evidence_id, quote };
}
function review(): ConversationReview {
  return { version: CONVERSATION_REVIEW_VERSION, preference_updates: [], need_updates: [],
    student_state: { understanding: "not_reported", understanding_source: null, readiness: "not_reported", readiness_source: null },
    current_support: [], recap_claims: [],
    closure: { reason: "continue_support", rationale: "Continue the requested explanation.", unresolved_need_ids: [], instructor_support: null } };
}
function output(context: Context, state = review(), text = "We can work through that together.") {
  return { ...v18r2TestContinueOutput({ context }), student_visible_message: text, conversation_review: state };
}
let checks = 0;
function test(name: string, run: () => void) { run(); checks += 1; console.log(`PASS ${name}`); }
function has(issues: string[], code: string) { assert.ok(issues.includes(`conversation_review.${code}`), JSON.stringify(issues)); }

test("historical absence remains readable; prospective metadata is required", () => {
  const context = v18r2TestContext({ student_turn_count: 1 });
  const candidate = v18r2TestContinueOutput({ context });
  assert.deepEqual(conversationContinuityIssues(candidate, context), []);
  has(conversationContinuityIssues(candidate, context, { required: true }), "required_or_invalid");
});

test("quotes require exact, same-conversation visible student evidence", () => {
  const context = v18r2TestContext({ student_turn_count: 1, student_messages: ["Please do not quiz me."] });
  const state = review();
  state.preference_updates.push({ preference_id: "no-quiz", kind: "no_quiz", status: "active", description: "No further quiz.", source: source(context, "Please do not quiz me.") });
  assert.deepEqual(conversationContinuityIssues(output(context, state), context), []);
  state.preference_updates[0].source.quote = "Please quiz me.";
  has(conversationContinuityIssues(output(context, state), context), "student_source_invalid");
  state.preference_updates[0].source = source(context, "Please do not quiz me.");
  context.allowed_evidence_catalog.evidence.find(item => item.evidence_id === state.preference_updates[0].source.evidence_id)!.conversation_public_id = "other-conversation";
  has(conversationContinuityIssues(output(context, state), context), "student_source_invalid");
});

test("no-quiz preference blocks declared practice, not direct explanation or clarification", () => {
  const context = v18r2TestContext({ student_turn_count: 1, student_messages: ["Explain without another quiz."] });
  const state = review();
  state.preference_updates.push({ preference_id: "no-quiz", kind: "no_quiz", status: "active", description: "Direct explanation requested.", source: source(context, "Explain without another quiz.") });
  state.current_support.push({ topic: "Reliability", kind: "explanation", quote: "We can work through that together.", preference_ids: ["no-quiz"], need_ids: [] });
  assert.deepEqual(conversationContinuityIssues(output(context, state), context), []);
  state.current_support[0].kind = "optional_practice";
  has(conversationContinuityIssues(output(context, state), context), "practice_conflicts_with_student_preference");
});

test("preference changes require newer student evidence and stable identity", () => {
  const context = v18r2TestContext({ student_turn_count: 2, student_messages: ["Leave SEM for later.", "Actually, can we return to SEM now?"], tutor_messages: ["Let us discuss reliability.", "We will leave SEM for later."] });
  const earlier = review();
  earlier.preference_updates.push({ preference_id: "sem", kind: "defer_topic", status: "active", description: "Leave SEM for later.", source: source(context, "Leave SEM for later.") });
  const continuity = buildConversationContinuity({ context, records: [{ source_agent_call_public_id: "call-prior", source_tutor_sequence_index: 3, review: earlier }] });
  const state = review();
  state.preference_updates.push({ ...earlier.preference_updates[0], status: "released" });
  has(conversationContinuityIssues(output(context, state), { ...context, conversation_continuity: continuity }), "preference_change_requires_new_student_source");
  state.preference_updates[0].source = source(context, "Actually, can we return to SEM now?");
  assert.deepEqual(conversationContinuityIssues(output(context, state), { ...context, conversation_continuity: continuity }), []);
});

test("empty history may bootstrap a still-active preference from an earlier exact student quote", () => {
  const context = v18r2TestContext({ student_turn_count: 2, student_messages: ["Please leave SEM for another day.", "I am still uncertain about it."], tutor_messages: ["We can discuss reliability first.", "We will leave SEM for later."] });
  const state = review();
  state.preference_updates.push({ preference_id: "sem-deferred", kind: "defer_topic", status: "active", description: "An earlier student preference remains active.", source: source(context, "Please leave SEM for another day.") });
  state.current_support.push({ topic: "Deferred SEM", kind: "acknowledgment", quote: "We can keep SEM for another day.", preference_ids: ["sem-deferred"], need_ids: [] });
  assert.deepEqual(conversationContinuityIssues(output(context, state, "We can keep SEM for another day."),
    { ...context, conversation_continuity: emptyConversationContinuity(context.conversation_public_id) }), []);
  assert.equal(state.preference_updates[0].source.evidence_id, source(context, "Please leave SEM for another day.").evidence_id);
});

test("reported understanding is not mastery; unresolved claims block ready", () => {
  const context = v18r2TestContext({ student_turn_count: 1, student_messages: ["I understand now and am ready to finish. Alpha .90 means ninety percent correct diagnoses."] });
  const state = review();
  state.student_state = { understanding: "reported_understood", understanding_source: source(context, "I understand now"), readiness: "ready", readiness_source: source(context, "am ready to finish") };
  state.closure.reason = "ready";
  const candidate = { ...output(context, state), lifecycle_recommendation: "complete" as const };
  has(conversationContinuityIssues(candidate, context), "ready_has_unresolved_support_or_claims");
  assert.equal(candidate.outcome, "continue_conversation");
});

test("deferred need cannot be addressed or taught by omitting its controlling preference", () => {
  const context = v18r2TestContext({ student_turn_count: 2, student_messages: ["Leave SEM for later.", "I am still unsure about SEM."], tutor_messages: ["Let us discuss reliability.", "We will leave SEM for later."] });
  const earlier = review();
  earlier.preference_updates.push({ preference_id: "sem", kind: "defer_topic", status: "active", description: "SEM is deferred.", source: source(context, "Leave SEM for later.") });
  earlier.need_updates.push({ need_id: "sem-need", kind: "confusion", status: "deferred", description: "Uncertainty about SEM.", source: source(context, "Leave SEM for later."), support: [], deferred_by_preference_id: "sem" });
  const continuity = buildConversationContinuity({ context, records: [{ source_agent_call_public_id: "prior", source_tutor_sequence_index: 3, review: earlier }] });
  const state = review();
  state.current_support.push({ topic: "SEM", kind: "explanation", quote: "SEM is score uncertainty.", need_ids: ["sem-need"], preference_ids: [] });
  const candidate = output(context, state, "SEM is score uncertainty.");
  has(conversationContinuityIssues(candidate, { ...context, conversation_continuity: continuity }), "support_reopens_deferred_topic");
  state.need_updates.push({ ...earlier.need_updates[0], status: "addressed", deferred_by_preference_id: null,
    support: [{ tutor_sequence_index: null, quote: "SEM is score uncertainty." }] });
  has(conversationContinuityIssues(candidate, { ...context, conversation_continuity: continuity }), "reopening_requires_released_preference");
  state.preference_updates.push({ ...earlier.preference_updates[0], status: "released", source: source(context, "I am still unsure about SEM.") });
  // This passes provenance/declared-state checks only. The uncertain statement
  // is NOT a genuine release; the model's speech-act interpretation still needs
  // the prompt and independent qualitative review, not a keyword classifier.
  assert.deepEqual(conversationContinuityIssues(candidate, { ...context, conversation_continuity: continuity }), []);
});

test("ready requires current readiness and understanding, with no remaining need", () => {
  const context = v18r2TestContext({ student_turn_count: 2, student_messages: ["I understand and am ready.", "I now have a question about score uncertainty."] });
  context.current_profile.misconception_claim_catalog = { ...context.allowed_misconception_claim_catalog, indicators: [] };
  context.current_profile.unresolved_evidence = [];
  const state = review();
  state.student_state = { understanding: "reported_understood", understanding_source: source(context, "I understand"), readiness: "ready", readiness_source: source(context, "am ready") };
  state.closure.reason = "ready";
  has(conversationContinuityIssues({ ...output(context, state), lifecycle_recommendation: "complete" }, context), "ready_requires_current_student_report");
  const current = v18r2TestContext({ student_turn_count: 1, student_messages: ["I understand the explanation and feel ready to finish."] });
  current.current_profile.misconception_claim_catalog = { ...current.allowed_misconception_claim_catalog, indicators: [] };
  current.current_profile.unresolved_evidence = [];
  state.student_state = { understanding: "reported_understood", understanding_source: source(current, "I understand the explanation"), readiness: "ready", readiness_source: source(current, "feel ready to finish") };
  assert.deepEqual(conversationContinuityIssues({ ...output(current, state), lifecycle_recommendation: "complete" }, current), []);
  state.need_updates.push({ need_id: "need", kind: "confusion", status: "open", description: "A remaining concern.", source: source(current, "I understand the explanation"), support: [], deferred_by_preference_id: null });
  state.closure.unresolved_need_ids = ["need"];
  has(conversationContinuityIssues({ ...output(current, state), lifecycle_recommendation: "complete" }, current), "ready_has_unresolved_support_or_claims");
});

test("student stop preserves unresolved support and does not create mastery or referral", () => {
  const context = v18r2TestContext({ student_turn_count: 1, student_messages: ["I still do not understand. I want to stop now."] });
  const state = review();
  state.student_state = { understanding: "reported_not_understood", understanding_source: source(context, "I still do not understand."), readiness: "stop", readiness_source: source(context, "I want to stop now.") };
  state.need_updates.push({ need_id: "need", kind: "confusion", status: "open", description: "Understanding remains uncertain.", source: source(context, "I still do not understand."), support: [], deferred_by_preference_id: null });
  state.closure.reason = "student_stop"; state.closure.unresolved_need_ids = ["need"];
  const candidate = { ...output(context, state), lifecycle_recommendation: "pause" as const };
  assert.deepEqual(conversationContinuityIssues(candidate, context), []);
  candidate.teacher_assistance_recommendation = { recommended: true, reason_code: "student_stopped" };
  has(conversationContinuityIssues(candidate, context), "instructor_not_implied_by_exit_or_limit");
});

test("30-turn limit is separate from readiness and instructor referral", () => {
  const context = v18r2TestContext({ student_turn_count: 30, max_student_turns: 30 });
  const state = review(); state.closure.reason = "turn_limit";
  const candidate = { ...output(context, state), lifecycle_recommendation: "pause" as const };
  assert.deepEqual(conversationContinuityIssues(candidate, context), []);
  const early = v18r2TestContext({ student_turn_count: 1, max_student_turns: 30 });
  has(conversationContinuityIssues(candidate, early), "turn_limit_not_reached");
  candidate.teacher_assistance_recommendation = { recommended: true, reason_code: "turn_limit" };
  has(conversationContinuityIssues(candidate, context), "instructor_not_implied_by_exit_or_limit");
});

test("requested instructor advice at student exit needs no manufactured profile", () => {
  const context = v18r2TestContext({ student_turn_count: 1, student_messages: ["Please help me ask my instructor about this. I want to stop now."] });
  const state = review(); state.closure.reason = "student_stop";
  state.student_state.readiness = "stop"; state.student_state.readiness_source = source(context, "I want to stop now.");
  state.closure.instructor_support = { reason: "student_requested", rationale: "Give the requested wording for the student's own future contact.",
    student_source: source(context, "Please help me ask my instructor about this."), prior_support: [] };
  const candidate = { ...output(context, state, "You can ask your instructor to clarify the remaining question. You may stop here."), lifecycle_recommendation: "complete" as const };
  const accepted = validateFormativeConversationV18R2CandidateAcceptance({ context, candidate });
  assert.equal(accepted.valid, true, JSON.stringify(accepted.validation_issue_paths));
  assert.equal(accepted.output?.profile_transition_recommendation, null);
  assert.equal(accepted.output?.teacher_assistance_recommendation.recommended, false);
  state.closure.instructor_support.student_source = null;
  has(conversationContinuityIssues(candidate, context), "instructor_not_implied_by_exit_or_limit");
});

test("instructor support requires actual prior support or a current explicit request", () => {
  const context = v18r2TestContext({ student_turn_count: 1, student_messages: ["Please help me ask my instructor about this."] });
  const state = review(); state.closure.reason = "instructor_needed";
  state.closure.instructor_support = { reason: "support_attempts_insufficient", rationale: "More specialized support is needed.", student_source: null, prior_support: [] };
  const candidate = { ...output(context, state), lifecycle_recommendation: "pause" as const,
    teacher_assistance_recommendation: { recommended: true, reason_code: "support_required" } };
  has(conversationContinuityIssues(candidate, context), "instructor_requires_prior_support");
  state.closure.instructor_support = { reason: "student_requested", rationale: "The student requested instructor support.", student_source: source(context, "Please help me ask my instructor about this."), prior_support: [] };
  assert.deepEqual(conversationContinuityIssues(candidate, context), []);
});

test("history builder excludes hidden, unknown, malformed and future-sourced records", () => {
  const context = v18r2TestContext({ student_turn_count: 2, student_messages: ["No quiz please.", "Explain one example."] });
  const state = review(); state.preference_updates.push({ preference_id: "no-quiz", kind: "no_quiz", status: "active", description: "No quiz requested.", source: source(context, "No quiz please.") });
  const future = review(); future.preference_updates.push({ ...state.preference_updates[0], source: source(context, "Explain one example.") });
  const built = buildConversationContinuity({ context, records: [
    { source_agent_call_public_id: "hidden", source_tutor_sequence_index: 99, review: state },
    { source_agent_call_public_id: "future", source_tutor_sequence_index: 1, review: future },
    { source_agent_call_public_id: "valid", source_tutor_sequence_index: 3, review: state },
    { source_agent_call_public_id: "duplicate", source_tutor_sequence_index: 3, review: state },
    { source_agent_call_public_id: "malformed", source_tutor_sequence_index: 1, review: {} }
  ] });
  assert.equal(built.preferences.length, 1); assert.equal(built.preferences[0].source_agent_call_public_id, "valid");
  assert.equal(built.support_history.length, 0);
});

const native = JSON.parse(readFileSync(new URL("./fixtures/conversation-continuity-native-excerpts.json", import.meta.url), "utf8")) as {
  cases: { id: string; student_messages: string[]; tutor_messages: string[]; candidate_message: string }[];
};
for (const fixture of native.cases) {
  test(`frozen native synthetic regression: ${fixture.id}`, () => {
    const context = v18r2TestContext({ student_turn_count: fixture.student_messages.length,
      student_messages: fixture.student_messages, tutor_messages: fixture.tutor_messages });
    const state = review();
    if (fixture.id === "deferred_topic_reopened") {
      const quote = "Please leave SEM for another day.";
      const earlier = review();
      earlier.preference_updates.push({ preference_id: "sem-deferred", kind: "defer_topic", status: "active", description: "The student deferred SEM.", source: source(context, quote) });
      const sourceIndex = context.allowed_evidence_catalog.evidence.find(item => item.evidence_id === earlier.preference_updates[0].source.evidence_id)!.source_sequence_index!;
      const continuity = buildConversationContinuity({ context, records: [{ source_agent_call_public_id: "native-deferral-review-adapter", source_tutor_sequence_index: sourceIndex + 1, review: earlier }] });
      assert.equal(continuity.preferences.length, 1);
      const excerpt = "For the SEM, think of it as a";
      assert.ok(fixture.candidate_message.includes(excerpt));
      state.current_support.push({ topic: "SEM", kind: "explanation", quote: excerpt, need_ids: [], preference_ids: ["sem-deferred"] });
      has(conversationContinuityIssues(output(context, state, fixture.candidate_message), { ...context, conversation_continuity: continuity }), "support_reopens_deferred_topic");
    } else {
      // No earlier tutor said this SEM explanation. The old output was accepted;
      // a prospective review cannot truthfully cite it as prior conversation.
      const absent = "SEM describes score uncertainty";
      assert.ok(fixture.candidate_message.includes(absent));
      assert.ok(!fixture.tutor_messages.some(text => text.includes(absent)));
      state.recap_claims.push({ current_quote: absent, earlier_support: [{ tutor_sequence_index: 1, quote: absent }] });
      has(conversationContinuityIssues(output(context, state, fixture.candidate_message), context), "tutor_source_invalid");
      state.recap_claims[0].earlier_support[0].tutor_sequence_index = null;
      has(conversationContinuityIssues(output(context, state, fixture.candidate_message), context), "tutor_source_invalid");
    }
  });
}

test("honest recap cites visible earlier tutor text; current source is not history", () => {
  const context = v18r2TestContext({ student_turn_count: 1, tutor_messages: ["Reliability concerns consistency across repeated measurements."] });
  const state = review(); const text = "Earlier, we discussed consistency.";
  state.recap_claims.push({ current_quote: "we discussed consistency", earlier_support: [{ tutor_sequence_index: 1, quote: "Reliability concerns consistency" }] });
  assert.deepEqual(conversationContinuityIssues(output(context, state, text), context), []);
  assert.equal(emptyConversationContinuity(context.conversation_public_id).last_student_state, null);
});

test("candidate acceptance permits a sourced student stop with remaining claims", () => {
  const context = v18r2TestContext({ student_turn_count: 1, student_messages: ["I am still unsure but I want to stop now."] });
  const state = review(); state.closure.reason = "student_stop";
  state.student_state.readiness = "stop"; state.student_state.readiness_source = source(context, "I want to stop now.");
  const candidate = { ...output(context, state), lifecycle_recommendation: "complete" as const };
  assert.ok(context.allowed_misconception_claim_catalog.indicators.length);
  const accepted = validateFormativeConversationV18R2CandidateAcceptance({ context, candidate });
  assert.equal(accepted.valid, true, JSON.stringify(accepted.validation_issue_paths));
  state.student_state.readiness_source.quote = "I am ready and understand everything.";
  const invalid = validateFormativeConversationV18R2CandidateAcceptance({ context, candidate });
  assert.equal(invalid.valid, false); has(invalid.validation_issue_paths, "student_source_invalid");
});

test("candidate acceptance closes the 30-turn limit without fabricating a profile or referral", () => {
  const context = v18r2TestContext({ student_turn_count: 30, max_student_turns: 30 });
  const state = review(); state.closure.reason = "turn_limit";
  const candidate = { ...output(context, state), lifecycle_recommendation: "complete" as const };
  const result = validateFormativeConversationV18R2CandidateAcceptance({ context, candidate });
  assert.equal(result.valid, true, JSON.stringify(result.validation_issue_paths));
  assert.equal(result.output?.profile_transition_recommendation, null);
  assert.equal(result.output?.outcome, "continue_conversation");
  assert.equal(result.output?.teacher_assistance_recommendation.recommended, false);
  candidate.teacher_assistance_recommendation = { recommended: true, reason_code: "turn_limit" };
  assert.equal(validateFormativeConversationV18R2CandidateAcceptance({ context, candidate }).valid, false);
  assert.equal(FormativeConversationV18R2AgentInputSchema.safeParse({ ...context, formative_lifecycle: {
    ...context.formative_lifecycle, student_turn_index: 31, another_student_turn_available: false
  } }).success, false);
});

test("legacy final-turn continuation remains rejected without prospective limit review", () => {
  const context = v18r2TestContext({ student_turn_count: 12 });
  const candidate = v18r2TestContinueOutput({ context });
  const result = validateFormativeConversationV18R2CandidateAcceptance({ context, candidate });
  assert.equal(result.valid, false);
  assert.ok(result.validation_issue_paths.some(path => path.includes("continue_conversation_unavailable_on_final_allowed_turn")));
});

const quoteFailures = JSON.parse(readFileSync(new URL("./fixtures/conversation-continuity-native-quote-failures.json", import.meta.url), "utf8")) as {
  synthetic_only: boolean; prior_tutor_text: string; cases: { kind: string; current_text: string;
    current_support: ConversationReview["current_support"]; recap_claims: ConversationReview["recap_claims"]; validation_issue_paths: string[] }[];
};
assert.equal(quoteFailures.synthetic_only, true);
for (const fixture of quoteFailures.cases) test(`native ${fixture.kind} quote failures receive exact, deduplicated diagnostics without acceptance`, () => {
  const context = v18r2TestContext({ student_turn_count: 1, tutor_messages: [quoteFailures.prior_tutor_text] });
  const state = review(); state.current_support = structuredClone(fixture.current_support);
  state.recap_claims = structuredClone(fixture.recap_claims);
  state.recap_claims.forEach(claim => claim.earlier_support.forEach(source => { source.tutor_sequence_index = 1; }));
  const before = JSON.stringify(state);
  const diagnosed = continuityQuoteDiagnostics(state, context, fixture.current_text);
  assert.deepEqual(diagnosed.issues.map(item => item.path), [
    "conversation_review.current_support[0].quote", "conversation_review.recap_claims[0].current_quote",
    "conversation_review.recap_claims[0].earlier_support[0].quote"
  ]);
  assert.deepEqual(diagnosed.sources, { current_reply: fixture.current_text, "tutor-turn:1": quoteFailures.prior_tutor_text });
  assert.equal(diagnosed.omitted_issue_count, 0);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(conversationContinuityIssues(output(context, state, fixture.current_text), context), fixture.validation_issue_paths);
});

test("valid short verbatim student/current/tutor quotes produce no diagnostics", () => {
  const context = v18r2TestContext({ student_turn_count: 1, student_messages: ["Please keep this brief. I am still unsure."],
    tutor_messages: ["**Reliability** concerns consistency.\nValidity concerns interpretation."] });
  const state = review(); const text = "Earlier we discussed consistency. We can keep this brief.";
  state.preference_updates.push({ preference_id: "brief", kind: "brief_response", status: "active", description: "Brief support requested.", source: source(context, "Please keep this brief.") });
  state.student_state.understanding = "reported_not_understood";
  state.student_state.understanding_source = source(context, "I am still unsure.");
  state.current_support.push({ topic: "Brevity", kind: "acknowledgment", quote: "We can keep this brief.", need_ids: [], preference_ids: ["brief"] });
  state.recap_claims.push({ current_quote: "Earlier we discussed consistency.", earlier_support: [{ tutor_sequence_index: 1, quote: "**Reliability** concerns consistency." }] });
  assert.deepEqual(continuityQuoteDiagnostics(state, context, text), { issues: [], sources: {}, cutoff_sequence_index: 3, omitted_issue_count: 0 });
  assert.deepEqual(conversationContinuityIssues(output(context, state, text), context), []);
});

test("invalid scoped/future/current-as-history references never disclose substitute text", () => {
  const context = v18r2TestContext({ student_turn_count: 1, student_messages: ["Please keep this brief."] });
  const state = review(); const studentSource = source(context, "Please keep this brief.");
  state.preference_updates.push({ preference_id: "brief", kind: "brief_response", status: "active", description: "Brevity.", source: studentSource });
  const entry = context.allowed_evidence_catalog.evidence.find(item => item.evidence_id === studentSource.evidence_id)!;
  entry.conversation_public_id = "unrelated-conversation";
  entry.content = "UNRELATED TEXT MUST NOT BE INCLUDED";
  state.recap_claims.push({ current_quote: "Current reply.", earlier_support: [
    { tutor_sequence_index: 999, quote: "Future text." }, { tutor_sequence_index: null, quote: "Current reply." }
  ] });
  const diagnosed = continuityQuoteDiagnostics(state, context, "Current reply.");
  assert.equal(diagnosed.issues.length, 3);
  assert.ok(diagnosed.issues.every(item => item.source_key === null && item.reason === "source_not_eligible"));
  assert.deepEqual(diagnosed.sources, {});
  entry.conversation_public_id = context.conversation_public_id;
  entry.source_sequence_index = 999;
  assert.equal(continuityQuoteDiagnostics(state, context, "Current reply.").issues[0].source_key, null);
});

test("quote feedback bounds issues and never silently drops the omitted count", () => {
  const context = v18r2TestContext({ student_turn_count: 1, student_messages: ["Please keep helping."] });
  const state = review();
  state.preference_updates = Array.from({ length: 12 }, (_, index) => ({ preference_id: `p-${index}`, kind: "other_support", status: "active",
    description: "Synthetic bound check.", source: { ...source(context, "Please keep helping."), quote: `Absent quote ${index}.` } }));
  const diagnosed = continuityQuoteDiagnostics(state, context, "Current reply.");
  assert.equal(diagnosed.issues.length, 8); assert.equal(diagnosed.omitted_issue_count, 4);
  assert.deepEqual(Object.values(diagnosed.sources), ["Please keep helping."]);
  assert.equal(conversationContinuityIssues(output(context, state), context).includes("conversation_review.student_source_invalid"), true);
});

test("41 accumulated sourced needs fit the same closure capacity as continuity state", () => {
  const messages = Array.from({ length: 4 }, (_, group) => `Please help with topics ${Array.from({ length: group === 3 ? 5 : 12 }, (_, index) => group * 12 + index + 1).join(", ")}.`);
  const context = v18r2TestContext({ student_turn_count: 5, student_messages: [...messages, "These questions remain open."] });
  const records = messages.map((message, group) => {
    const state = review();
    state.need_updates = Array.from({ length: group === 3 ? 5 : 12 }, (_, index) => ({ need_id: `need-${group * 12 + index + 1}`, kind: "support_request",
      status: "open", description: `Support for topic ${group * 12 + index + 1}.`, source: source(context, message), support: [], deferred_by_preference_id: null }));
    return { source_agent_call_public_id: `call-${group}`, source_tutor_sequence_index: 3 + group * 2, review: state };
  });
  const continuity = buildConversationContinuity({ records, context });
  assert.equal(continuity.needs.length, 41);
  const state = review(); state.closure.unresolved_need_ids = continuity.needs.map(item => item.need_id);
  assert.deepEqual(conversationContinuityIssues(output(context, state), { ...context, conversation_continuity: continuity }), []);
  state.closure.unresolved_need_ids.pop();
  has(conversationContinuityIssues(output(context, state), { ...context, conversation_continuity: continuity }), "unresolved_needs_must_match");
});

// Test authoring includes deliberately invalid comparisons. The strict runtime
// schema remains the authority; this superset avoids casting each negative.
type SourcedTestComparison = ReturnType<typeof ConversationPreReplyPlanV1Schema.parse>["preference_comparisons"][number];
type TestComparison = Pick<SourcedTestComparison, "preference_id" | "decision"> &
  Partial<Omit<SourcedTestComparison, "preference_id" | "decision">>;
type TestPlan = Omit<ConversationPreReplyPlan, "preference_comparisons"> & { preference_comparisons: TestComparison[] };
function plan(context: Context): TestPlan {
  const latest = [...context.visible_transcript].reverse().find(item => item.actor === "student");
  return { version: CONVERSATION_PRE_REPLY_PLAN_VERSION, preference_comparisons: [], student_state: review().student_state,
    current_focus: { description: "Respond to the visible student's current request.", source: latest ? source(context, latest.message_text) : null } };
}
function plannedWire(context: Context, pre = plan(context), post = review()) {
  return { ...v18r2TestContinueOutput({ context }), student_visible_message: "We can work through that together.", pre_reply_plan: pre,
    post_reply_review: {
      need_updates: post.need_updates.map(item => ({ ...item,
        support: item.support.map(entry => entry.tutor_sequence_index === null
          ? { kind: "current_reply" as const }
          : { kind: "prior_tutor_turn" as const, tutor_sequence_index: entry.tutor_sequence_index }) })),
      current_support: post.current_support.map(item => ({ topic: item.topic, kind: item.kind,
        source: { kind: "current_reply" as const }, need_ids: item.need_ids,
        // These planned-wire fixtures explicitly model honored constraints.
        // Earlier canonical-only fixtures keep the historical ID semantics.
        preference_links: item.preference_ids.map(preference_id => ({ preference_id,
          relationship: "honored_constraint" as const })) })),
      recap_claims: post.recap_claims.map(item => ({ current_source: { kind: "current_reply" as const }, earlier_support: item.earlier_support.map(source => ({
        kind: "prior_tutor_turn" as const, tutor_sequence_index: source.tutor_sequence_index })) })),
      closure: { reason: post.closure.reason, rationale: post.closure.rationale, instructor_support: post.closure.instructor_support === null ? null : {
        ...post.closure.instructor_support, prior_support: post.closure.instructor_support.prior_support.map(source => ({
          kind: "prior_tutor_turn" as const, tutor_sequence_index: source.tutor_sequence_index })) } } } };
}
function projectedReview(result: ReturnType<typeof projectConversationContinuityWire>): ConversationReview {
  assert.ok(result.output, JSON.stringify(result.audit));
  assert.equal(ConversationPlanProjectionAuditSchema.safeParse(result.audit).success, true);
  return result.output.conversation_review as ConversationReview;
}

test("split schemas bind post-reply references to the exact reply without mutating the wire", () => {
  const context = v18r2TestContext({ student_turn_count: 1 });
  const post = review();
  post.current_support.push({ topic: "Requested support", kind: "acknowledgment", quote: "We can work through that together.",
    need_ids: [], preference_ids: [] });
  const wire = plannedWire(context, plan(context), post); const before = JSON.stringify(wire);
  const result = projectConversationContinuityWire(wire, context);
  const canonical = projectedReview(result);
  assert.equal(result.audit.status, "reconstructed");
  assert.equal(JSON.stringify(wire), before);
  assert.equal(result.output?.pre_reply_plan, undefined);
  assert.equal(result.output?.post_reply_review, undefined);
  assert.deepEqual(canonical.preference_updates, []);
  assert.deepEqual(wire.post_reply_review.current_support[0].source, { kind: "current_reply" });
  assert.equal("quote" in wire.post_reply_review.current_support[0], false);
  assert.deepEqual(canonical.current_support[0], { ...post.current_support[0], quote: wire.student_visible_message,
    preference_linkage: { version: CONVERSATION_SUPPORT_PREFERENCE_LINK_VERSION, links: [] },
    source_binding: { version: CONVERSATION_CURRENT_REPLY_SOURCE_VERSION,
      reply_sha256: conversationCurrentReplySourceHash(wire.student_visible_message) } });
  assert.equal(result.audit.current_reply_source_version, CONVERSATION_CURRENT_REPLY_SOURCE_VERSION);
  assert.deepEqual(result.audit.current_reply_bindings, [{ path: "conversation_review.current_support[0].quote",
    reply_sha256: conversationCurrentReplySourceHash(wire.student_visible_message) }]);
  assert.equal(ConversationPreReplyPlanSchema.safeParse({ ...wire.pre_reply_plan, current_support: [] }).success, false);
  assert.equal(ConversationPostReplyReviewSchema.safeParse({ ...wire.post_reply_review, student_state: review().student_state }).success, false);
  assert.equal(projectConversationContinuityWire({ ...wire, conversation_review: review() }, context).output, null);
  assert.deepEqual(conversationContinuityIssues(output(context, canonical), context), []);
});

test("native residual uncertainty retains the historical boundary and cannot declare a release", () => {
  const native = JSON.parse(readFileSync(new URL("./fixtures/conversation-continuity-native-excerpts.json", import.meta.url), "utf8"));
  const fixture = native.cases.find((item: { id: string }) => item.id === "deferred_topic_reopened");
  const context = v18r2TestContext({ student_turn_count: fixture.student_messages.length,
    student_messages: fixture.student_messages, tutor_messages: fixture.tutor_messages });
  const pre = plan(context);
  pre.preference_comparisons.push({ preference_id: "deferred-topic", kind: "defer_topic", description: "Respect the earlier deferral.",
    prior: { origin: "visible_student_history", source: source(context, "Please leave SEM for another day.") },
    current_source: source(context, "I’m still unsure about the SEM and whether subtracting it might give the true score."),
    decision: "retain", change_basis: "uncertainty_only" });
  const retained = projectedReview(projectConversationContinuityWire(plannedWire(context, pre), context));
  assert.equal(retained.preference_updates[0].status, "active");
  assert.deepEqual(retained.preference_updates[0].source, source(context, "Please leave SEM for another day."));
  assert.equal(retained.bootstrap_preference_origins, undefined);
  pre.preference_comparisons[0].decision = "release";
  const rejected = projectConversationContinuityWire(plannedWire(context, pre), context);
  assert.equal(rejected.output, null);
  assert.ok(rejected.audit.validation_issue_paths.some(path => path.endsWith("change_requires_current_explicit_source")));
});

test("a genuine bootstrap release keeps both original sources through canonical validation and persisted replay", () => {
  const context = v18r2TestContext({ student_turn_count: 2, student_messages: ["Leave score uncertainty for later.", "Now please return to score uncertainty."] });
  const pre = plan(context);
  pre.preference_comparisons.push({ preference_id: "deferred", kind: "defer_topic", description: "The earlier topic boundary.",
    prior: { origin: "visible_student_history", source: source(context, "Leave score uncertainty for later.") },
    current_source: source(context, "Now please return to score uncertainty."), decision: "release", change_basis: "explicit_change" });
  const state = projectedReview(projectConversationContinuityWire(plannedWire(context, pre), context));
  assert.deepEqual(state.bootstrap_preference_origins?.[0].source, source(context, "Leave score uncertainty for later."));
  assert.deepEqual(state.preference_updates[0].source, pre.preference_comparisons[0].current_source);
  assert.deepEqual(conversationContinuityIssues(output(context, state), context), []);
  context.visible_transcript.push({ sequence_index: 5, actor: "tutor", message_text: "We can work through that together.", created_at: "2026-08-14T00:00:05.000Z" });
  const rebuilt = buildConversationContinuity({ context, records: [{ source_agent_call_public_id: "accepted-split", source_tutor_sequence_index: 5, review: state }] });
  assert.equal(rebuilt.preferences.length, 1);
  assert.equal(rebuilt.preferences[0].status, "released");
  assert.deepEqual(rebuilt.preferences[0].source, pre.preference_comparisons[0].current_source);
  assert.equal(rebuilt.preferences[0].source_agent_call_public_id, "accepted-split");
  const missingOrigin = structuredClone(state); delete missingOrigin.bootstrap_preference_origins;
  assert.equal(buildConversationContinuity({ context, records: [{ source_agent_call_public_id: "invalid", source_tutor_sequence_index: 5, review: missingOrigin }] }).preferences.length, 0);
});

test("unknown releases need one distinct earlier eligible origin, not a schema bypass", () => {
  const context = v18r2TestContext({ student_turn_count: 2, student_messages: ["Leave this for later.", "Return to it now."] });
  const pre = plan(context);
  pre.preference_comparisons.push({ preference_id: "boundary", kind: "defer_topic", description: "A boundary.", prior: null,
    current_source: source(context, "Return to it now."), decision: "release", change_basis: "explicit_change" });
  assert.equal(projectConversationContinuityWire(plannedWire(context, pre), context).output, null);
  pre.preference_comparisons[0].prior = { origin: "visible_student_history", source: source(context, "Return to it now.") };
  assert.equal(projectConversationContinuityWire(plannedWire(context, pre), context).output, null);
  pre.preference_comparisons[0].prior = { origin: "visible_student_history", source: source(context, "Leave this for later.") };
  const state = projectedReview(projectConversationContinuityWire(plannedWire(context, pre), context));
  for (const mutation of ["duplicate", "extraneous", "same-source", "wrong-kind", "stored-origin"] as const) {
    const changed = structuredClone(state); const origin = changed.bootstrap_preference_origins![0];
    const current = { ...context, conversation_continuity: emptyConversationContinuity(context.conversation_public_id) };
    if (mutation === "duplicate") changed.bootstrap_preference_origins!.push(structuredClone(origin));
    if (mutation === "extraneous") origin.preference_id = "not-released";
    if (mutation === "same-source") origin.source = changed.preference_updates[0].source;
    if (mutation === "wrong-kind") origin.kind = "no_quiz";
    if (mutation === "stored-origin") current.conversation_continuity.preferences.push({ ...origin, status: "active", source_agent_call_public_id: "old", source_tutor_sequence_index: 3 });
    has(conversationContinuityIssues(output(context, changed), current), "bootstrap_preference_origin_invalid");
  }
});

test("stored preference comparison preserves exact identity, status, source and retained description", () => {
  const context = v18r2TestContext({ student_turn_count: 2, student_messages: ["No more quizzes.", "I remain unsure."] });
  const stored = { preference_id: "no-quiz", kind: "no_quiz" as const, status: "active" as const, description: "Keep the conversation free of quizzes.",
    source: source(context, "No more quizzes."), source_agent_call_public_id: "old", source_tutor_sequence_index: 3 };
  context.conversation_continuity = { ...emptyConversationContinuity(context.conversation_public_id), preferences: [stored] };
  const pre = plan(context);
  pre.preference_comparisons.push({ preference_id: stored.preference_id, decision: "retain" });
  const retained = projectConversationContinuityWire(plannedWire(context, pre), context);
  assert.deepEqual(projectedReview(retained).preference_updates, []);
  assert.equal(retained.audit.stored_preference_bindings[0].preference_id, stored.preference_id);
  for (const mutation of ["kind", "historical-substitution", "description", "missing-prior", "unknown-id"] as const) {
    const changed = structuredClone(pre); const item = changed.preference_comparisons[0];
    if (mutation === "kind") Object.assign(item, {kind: "other_support"});
    if (mutation === "historical-substitution") item.prior = { origin: "visible_student_history", source: stored.source };
    if (mutation === "description") Object.assign(item, {description: "Different preference meaning."});
    if (mutation === "missing-prior") item.prior = null;
    if (mutation === "unknown-id") item.preference_id = "unknown-id";
    assert.equal(projectConversationContinuityWire(plannedWire(context, changed), context).output, null, mutation);
  }
});

test("retaining a released preference keeps it released; reactivation requires newer explicit evidence", () => {
  const context = v18r2TestContext({ student_turn_count: 3, student_messages: ["No quiz.", "A practice question is okay now.", "Explain one example instead."] });
  const stored = { preference_id: "quiz-boundary", kind: "no_quiz" as const, status: "released" as const, description: "A quiz boundary.",
    source: source(context, "A practice question is okay now."), source_agent_call_public_id: "old", source_tutor_sequence_index: 5 };
  context.conversation_continuity = { ...emptyConversationContinuity(context.conversation_public_id), preferences: [stored] };
  const pre = plan(context); pre.preference_comparisons.push({ preference_id: stored.preference_id, decision: "retain" });
  assert.deepEqual(projectedReview(projectConversationContinuityWire(plannedWire(context, pre), context)).preference_updates, []);
  pre.preference_comparisons[0].decision = "activate";
  assert.equal(projectConversationContinuityWire(plannedWire(context, pre), context).output, null);
  pre.preference_comparisons[0].change_basis = "explicit_change";
  pre.preference_comparisons[0].prior = { origin: "stored_preference" };
  pre.preference_comparisons[0].current_source = source(context, "Explain one example instead.");
  const state = projectedReview(projectConversationContinuityWire(plannedWire(context, pre), context));
  assert.equal(state.preference_updates[0].status, "active");
  assert.deepEqual(conversationContinuityIssues(output(context, state), context), []);
});

test("plan rejects nonstudent, wrong-scope, future and stale current sources", () => {
  const context = v18r2TestContext({ student_turn_count: 2, student_messages: ["Leave this for later.", "I still have doubts."] });
  const pre = plan(context); pre.preference_comparisons.push({ preference_id: "boundary", kind: "defer_topic", description: "A boundary.",
    prior: { origin: "visible_student_history", source: source(context, "Leave this for later.") }, current_source: source(context, "I still have doubts."), decision: "retain", change_basis: "uncertainty_only" });
  for (const mutation of ["nonstudent", "scope", "future", "stale-current"] as const) {
    const altered = structuredClone(context); const alteredPlan = structuredClone(pre);
    const evidence = altered.allowed_evidence_catalog.evidence.find(item => item.evidence_id === source(context, "Leave this for later.").evidence_id)!;
    if (mutation === "nonstudent") evidence.source_role = "tutor";
    if (mutation === "scope") evidence.conversation_public_id = "other-conversation";
    if (mutation === "future") evidence.source_sequence_index = 999;
    if (mutation === "stale-current") alteredPlan.preference_comparisons[0].current_source = source(context, "Leave this for later.");
    assert.equal(projectConversationContinuityWire(plannedWire(altered, alteredPlan), altered).output, null, mutation);
  }
});

test("current state needs the latest source while an earlier explicit question may anchor vague focus", () => {
  const context = v18r2TestContext({ student_turn_count: 2, student_messages: ["What does alpha mean? I understand consistency.", "I am still unsure about that."] });
  const pre = plan(context); pre.current_focus.source = source(context, "What does alpha mean?");
  pre.current_focus.description = "The student's alpha question remains the focus, not an unrelated baseline topic.";
  assert.ok(projectConversationContinuityWire(plannedWire(context, pre), context).output);
  pre.student_state.understanding = "reported_understood"; pre.student_state.understanding_source = source(context, "I understand consistency.");
  assert.equal(projectConversationContinuityWire(plannedWire(context, pre), context).output, null);
  pre.student_state.understanding = "reported_not_understood"; pre.student_state.understanding_source = source(context, "I am still unsure about that.");
  assert.ok(projectConversationContinuityWire(plannedWire(context, pre), context).output);
  pre.current_focus.source = null;
  assert.equal(projectConversationContinuityWire(plannedWire(context, pre), context).output, null);
});

test("opening creates no student preferences, focus source or reported understanding", () => {
  const context = v18r2TestContext({ student_turn_count: 0 });
  const pre = plan(context);
  const state = projectedReview(projectConversationContinuityWire(plannedWire(context, pre), context));
  assert.deepEqual(state.preference_updates, []); assert.equal(state.student_state.understanding, "not_reported");
  pre.student_state.understanding = "reported_understood";
  assert.equal(projectConversationContinuityWire(plannedWire(context, pre), context).output, null);
});

test("more than twelve stored preferences remain intact without copying them into each plan", () => {
  const context = v18r2TestContext({ student_turn_count: 2, student_messages: ["Please keep these preferences.", "Explain one example."] });
  const stored = Array.from({ length: 41 }, (_, index) => ({ preference_id: `p-${index}`, kind: "other_support" as const,
    status: "active" as const, description: `Synthetic preference ${index}.`, source: source(context, "Please keep these preferences."),
    source_agent_call_public_id: "older", source_tutor_sequence_index: 3 }));
  context.conversation_continuity = { ...emptyConversationContinuity(context.conversation_public_id), preferences: stored };
  const before = JSON.stringify(context.conversation_continuity);
  const state = projectedReview(projectConversationContinuityWire(plannedWire(context), context));
  assert.deepEqual(state.preference_updates, []);
  assert.deepEqual(conversationContinuityIssues(output(context, state), context), []);
  assert.equal(JSON.stringify(context.conversation_continuity), before);
});

test("duplicate comparison IDs fail; current-reply references cannot supply or replace literal quotes", () => {
  const context = v18r2TestContext({ student_turn_count: 1, student_messages: ["Please keep it brief."] });
  const pre = plan(context); pre.preference_comparisons.push({ preference_id: "brief", kind: "brief_response", description: "Brevity.",
    prior: null, current_source: source(context, "Please keep it brief."), decision: "activate", change_basis: "explicit_change" });
  pre.preference_comparisons.push(structuredClone(pre.preference_comparisons[0]));
  assert.equal(projectConversationContinuityWire(plannedWire(context, pre), context).output, null);
  pre.preference_comparisons.pop(); const post = review();
  post.current_support.push({ topic: "Brief response", kind: "acknowledgment", quote: "We can work through that together.", need_ids: [], preference_ids: ["brief"] });
  const wire = plannedWire(context, pre, post);
  assert.equal(projectConversationContinuityWire({ ...wire, post_reply_review: { ...wire.post_reply_review,
    current_support: [{ ...wire.post_reply_review.current_support[0], quote: "An invented reply quote." }] } }, context).output, null);
  const state = projectedReview(projectConversationContinuityWire(wire, context));
  state.current_support[0].quote = "An invented reply quote.";
  has(conversationContinuityIssues(output(context, state), context), "current_support_quote_invalid");
});

test("post-reply wire cannot supply the redundant canonical open-ID list", () => {
  const context = v18r2TestContext({ student_turn_count: 1 }); const wire = plannedWire(context);
  const invalid = { ...wire, post_reply_review: { ...wire.post_reply_review, closure: {
    ...wire.post_reply_review.closure, unresolved_need_ids: []
  } } };
  assert.equal(projectConversationContinuityWire(invalid, context).output, null);
  const audit = projectConversationContinuityWire(wire, context).audit;
  assert.equal(typeof audit.prior_needs_sha256, "string");
  assert.deepEqual(audit.derived_open_need_ids, []);
  const historicalAudit = { ...audit }; delete historicalAudit.prior_needs_sha256; delete historicalAudit.derived_open_need_ids;
  assert.equal(ConversationPlanProjectionAuditSchema.safeParse(historicalAudit).success, true);
});

test("derived IDs preserve untouched open needs and exactly apply authored addressed/deferred/open updates", () => {
  const context = v18r2TestContext({ student_turn_count: 2, student_messages: ["Please help with these questions.", "Keep the deferred topic for later. Continue the other questions."] });
  const priorSource = source(context, "Please help with these questions."); const currentSource = source(context, "Keep the deferred topic for later.");
  const pref = { preference_id: "defer", kind: "defer_topic" as const, status: "active" as const, description: "Topic is deferred.",
    source: priorSource, source_agent_call_public_id: "prior", source_tutor_sequence_index: 3 };
  const priorNeed = (id: string, status: "open" | "addressed" | "deferred") => ({ need_id: id, kind: "support_request" as const, status,
    description: `Synthetic need ${id}.`, source: priorSource, support: [], deferred_by_preference_id: status === "deferred" ? "defer" : null,
    source_agent_call_public_id: "prior", source_tutor_sequence_index: 3 });
  context.conversation_continuity = { ...emptyConversationContinuity(context.conversation_public_id), preferences: [pref],
    needs: [priorNeed("untouched", "open"), priorNeed("to-address", "open"), priorNeed("to-defer", "open"),
      priorNeed("already-deferred", "deferred"), priorNeed("reopened", "addressed")] };
  const post = review();
  post.need_updates = [
    { need_id: "to-address", kind: "support_request", status: "addressed", description: "Supported without claiming mastery.",
      source: currentSource, support: [{ tutor_sequence_index: null, quote: "We can work through that together." }], deferred_by_preference_id: null },
    { need_id: "to-defer", kind: "support_request", status: "deferred", description: "Still unresolved and intentionally deferred.",
      source: currentSource, support: [], deferred_by_preference_id: "defer" },
    { need_id: "reopened", kind: "support_request", status: "open", description: "The student requests additional support.",
      source: currentSource, support: [], deferred_by_preference_id: null },
    { need_id: "new", kind: "question", status: "open", description: "A new current question.",
      source: currentSource, support: [], deferred_by_preference_id: null }
  ];
  const wire = plannedWire(context, plan(context), post); const beforeWire = JSON.stringify(wire); const beforeContext = JSON.stringify(context);
  const result = projectConversationContinuityWire(wire, context); const canonical = projectedReview(result);
  assert.deepEqual(canonical.closure.unresolved_need_ids, ["new", "reopened", "untouched"]);
  assert.deepEqual(result.audit.derived_open_need_ids, canonical.closure.unresolved_need_ids);
  const expectedNeeds = structuredClone(post.need_updates);
  expectedNeeds[0].support = [{ tutor_sequence_index: null, quote: wire.student_visible_message,
    source_binding: { version: CONVERSATION_CURRENT_REPLY_SOURCE_VERSION,
      reply_sha256: conversationCurrentReplySourceHash(wire.student_visible_message) } }];
  assert.deepEqual(canonical.need_updates, expectedNeeds);
  assert.deepEqual(conversationContinuityIssues(output(context, canonical), context), []);
  assert.equal(JSON.stringify(wire), beforeWire); assert.equal(JSON.stringify(context), beforeContext);
  const changedPrior = structuredClone(context); changedPrior.conversation_continuity!.needs[0].description = "Different prior source state.";
  assert.notEqual(projectConversationContinuityWire(wire, changedPrior).audit.prior_needs_sha256, result.audit.prior_needs_sha256);
});

test("derived-list projection does not hide duplicate updates, invalid deferral references or unknown statuses", () => {
  const context = v18r2TestContext({ student_turn_count: 1, student_messages: ["Please help with this question."] });
  const post = review(); post.need_updates = [{ need_id: "question", kind: "question", status: "open", description: "A current question.",
    source: source(context, "Please help with this question."), support: [], deferred_by_preference_id: null }];
  post.need_updates.push({ ...post.need_updates[0], status: "deferred", deferred_by_preference_id: "unknown-preference" });
  const result = projectConversationContinuityWire(plannedWire(context, plan(context), post), context);
  const canonical = projectedReview(result);
  const issues = conversationContinuityIssues(output(context, canonical), context);
  has(issues, "duplicate_update_id"); has(issues, "deferral_requires_active_student_preference");
  assert.deepEqual(canonical.need_updates, post.need_updates);
  const wire = plannedWire(context, plan(context), post);
  const invalid = { ...wire, post_reply_review: { ...wire.post_reply_review, need_updates: [{ ...post.need_updates[0], status: "made-up" }] } };
  assert.equal(projectConversationContinuityWire(invalid, context).output, null);
});

function authoredDeliveryReview(draft: string, review: { verdict: "pass" | "reject"; findings: Array<Omit<Extract<ConversationDeliveryReview["findings"][number], {draft_block_id:number}>, "draft_block_id">> }): ConversationDeliveryReview {
  const blocks = buildConversationDeliveryDraftBlocks(draft);
  return { private_learning_audit: [], version: CONVERSATION_DELIVERY_REVIEW_VERSION,
    teaching_block_audit: blocks.map(block => ({ block_id: block.block_id, assessment: "uncertain",
      check: "This offline continuity fixture tests source integrity, not an actual model's teaching-accuracy judgment." })),
    ...review, findings: review.findings.map(finding => ({ ...finding,
      draft_block_id: blocks.find(block => block.text.includes(finding.draft_quote))?.block_id ?? 12 })) };
}
const passingDeliveryReview = (draft: string) => authoredDeliveryReview(draft, { verdict: "pass", findings: [] });
function deliverySource(context: Context, quote: string) {
  const turn = context.visible_transcript.find(item => item.message_text.includes(quote));
  assert.ok(turn, `Missing visible test source ${quote}`);
  return { sequence_index: turn.sequence_index, actor: turn.actor, quote };
}

test("delivery review sees full dialogue and explicit empty initial reasoning but no private profile/plan", () => {
  const context = v18r2TestContext({ student_turn_count: 3, student_messages: ["Leave this topic for later.", "Explain an example.", "I still have a question."],
    tutor_messages: ["The first explanation.", "We can defer that.", "A new example."] });
  const draft = "We can address your question.";
  const before = JSON.stringify(context);
  const input = buildConversationDeliveryReviewInput(context, draft, null);
  assert.deepEqual(Object.keys(input), ["initial_student_reasoning", "visible_transcript", "latest_student_message", "draft_message", "draft_blocks", "proposed_learning_claims"]);
  assert.deepEqual(input.initial_student_reasoning, []);
  assert.equal(input.draft_blocks.map(block => block.text).join(""), draft);
  assert.equal(input.visible_transcript.length, context.visible_transcript.length);
  assert.deepEqual(input.visible_transcript.map(item => item.sequence_index), context.visible_transcript.map(item => item.sequence_index));
  assert.deepEqual(Object.keys(input.visible_transcript[0]), ["sequence_index", "actor", "message_text"]);
  assert.equal(input.latest_student_message, context.latest_student_message);
  assert.equal(input.draft_message, draft);
  assert.equal(JSON.stringify(context), before);
  input.visible_transcript[0].message_text = "The separate review input was changed for this test.";
  assert.equal(JSON.stringify(context), before);
  assert.ok(CONVERSATION_DELIVERY_REVIEW_INSTRUCTIONS.includes("untrusted quoted data"));
  assert.ok(CONVERSATION_DELIVERY_REVIEW_INSTRUCTIONS.includes("Do NOT reject a reply merely"));
});

test("authored finding for exact rejected V7 pause-agenda draft binds actual visible history", () => {
  const native = JSON.parse(readFileSync(new URL("./fixtures/conversation-continuity-native-excerpts.json", import.meta.url), "utf8"));
  const fixture = native.cases.find((item: { id: string }) => item.id === "pause_return_false_history");
  const context = v18r2TestContext({ student_turn_count: fixture.student_messages.length,
    student_messages: fixture.student_messages, tutor_messages: fixture.tutor_messages });
  // Verbatim synthetic V7 draft; historical result/review files stay unchanged.
  const draft = "We were distinguishing reliability from validity: **consistent scores show reliability, but evidence about what the scores measure and how they should be used is needed for validity.** We paused before discussing SEM: it estimates score uncertainty; it is not a value to subtract to obtain an exact true score.";
  const review = authoredDeliveryReview(draft, { verdict: "reject", findings: [{
    kind: "unsupported_pause_agenda", draft_quote: "We paused before discussing SEM",
    source_refs: [deliverySource(context, "you can return to the reliability-versus-validity distinction later."),
      deliverySource(context, "Give me a brief reminder, not a new test.")],
    rationale: "The pause and return concerned reliability and validity; no visible turn identifies SEM as the next planned discussion."
  }] });
  const before = JSON.stringify(review);
  const verdict = validateConversationDeliveryReview(review, context, draft, null);
  assert.equal(verdict.valid, true); assert.equal(verdict.accepted, false); assert.deepEqual(verdict.validation_issue_paths, []);
  assert.equal(JSON.stringify(review), before);
  // This checks source-bound authored feedback, not an unrun model's ability to
  // discover the defect. Live reviewer sensitivity needs separate paid evidence.
});

test("authored pass controls allow respected deferral, honest stop and ordinary new explanation", () => {
  const controls = [
    { messages: ["Leave SEM for another day.", "I am still unsure about it."], reply: "We can keep SEM for another day and continue with the current example." },
    { messages: ["Please explain alpha without a quiz.", "I will ask my teacher and stop here."], reply: "We’ll stop here. You could ask how alpha differs from classification accuracy." },
    { messages: ["Can you use a different everyday example?"], reply: "A clock can be consistently five minutes fast. Consistency does not make its reading accurate." },
    { messages: ["Leave SEM for another day.", "Now please return to SEM. What does it mean?"], reply: "SEM describes uncertainty around an observed score; it is not your known individual error." },
    { messages: ["Please give me a whole-assessment overview, including topics we have not discussed."], reply: "One assessment concern not discussed here is score uncertainty. Our conversation so far focused on reliability and validity." }
  ];
  for (const control of controls) {
    const context = v18r2TestContext({ student_turn_count: control.messages.length, student_messages: control.messages,
      tutor_messages: control.messages.map(() => "Our conversation concerns reliability and validity.") });
    assert.deepEqual(validateConversationDeliveryReview(passingDeliveryReview(control.reply), context, control.reply, null), {
      valid: true, accepted: true, validation_issue_paths: [], review: passingDeliveryReview(control.reply)
    });
  }
});

test("grounded preference/exit conflicts are feedback only, never a replacement or transition", () => {
  const context = v18r2TestContext({ student_turn_count: 1, student_messages: ["No quiz. I want to stop now."] });
  const draft = "You must answer another quiz before you can stop.";
  const review = authoredDeliveryReview(draft, { verdict: "reject", findings: [{
    kind: "student_exit_conflict", draft_quote: "You must answer another quiz before you can stop.",
    source_refs: [deliverySource(context, "I want to stop now.")], rationale: "The draft makes a requested exit conditional on a new exercise."
  }] });
  assert.equal(validateConversationDeliveryReview(review, context, draft, null).valid, true);
  assert.equal(validateConversationDeliveryReview(review, context, draft, null).accepted, false);
  assert.equal(ConversationDeliveryReviewSchema.safeParse({ ...review, replacement_reply: "A replacement is forbidden." }).success, false);
  assert.equal(ConversationDeliveryReviewSchema.safeParse({ ...review, profile_transition_recommendation: null }).success, false);
});

test("closing discrimination permits faithful recaps while retaining grounded unwanted-teaching rejection", () => {
  // These are authored verdicts over verbatim synthetic drafts, not a claim
  // that an offline test measures model discrimination. The eight live probes
  // separately retain the exact original contexts and expected labels.
  const ready = "I understand that distinction now, and my questions have been answered. I feel ready to finish.";
  const prior = "So validity is use-specific: the same test may provide useful evidence for one decision while being insufficient for another.";
  const context = v18r2TestContext({ student_turn_count: 1, student_messages: [ready], tutor_messages: [prior] });
  const recap = "Understood. We can finish here.\n\nThe key distinction is that validity depends on the intended use: evidence relevant to understanding safety instructions does not automatically justify broader claims about overall job performance.";
  assert.equal(validateConversationDeliveryReview(passingDeliveryReview(recap), context, recap, null).accepted, true);
  const stop = "I am still not sure. I will ask my teacher and stop here.";
  const stopped = v18r2TestContext({ student_turn_count: 1, student_messages: [stop] });
  const unwanted = "It makes sense to pause and ask your teacher. The distinction that still needs clarification is that consistent scores can be dependable without necessarily supporting the interpretation you want—such as concluding that a test measures wellbeing or predicts job performance. Also, an SEM describes score uncertainty; it is not a known amount that can be subtracted to reveal an exact true score.\n\nYou can bring those two specific questions to your teacher. We can stop here without treating your remaining uncertainty as resolved.";
  const verdict = authoredDeliveryReview(unwanted, { verdict: "reject", findings: [{
    kind: "student_exit_conflict", draft_quote: "Also, an SEM describes score uncertainty; it is not a known amount that can be subtracted to reveal an exact true score.",
    source_refs: [deliverySource(stopped, stop)], rationale: "The draft adds an unsolicited explanation after the student asked to stop."
  }] });
  assert.equal(validateConversationDeliveryReview(verdict, stopped, unwanted, null).valid, true);
  assert.equal(validateConversationDeliveryReview(verdict, stopped, unwanted, null).accepted, false);
  const invalid = structuredClone(verdict); invalid.findings[0].source_refs[0].quote = "Please teach me about SEM before I stop.";
  assert.equal(validateConversationDeliveryReview(invalid, stopped, unwanted, null).valid, false);
});

test("invalid reviewer verdicts, failures, missing output and unsupported source quotes fail closed", () => {
  const context = v18r2TestContext({ student_turn_count: 1, student_messages: ["Please stop now."] });
  const draft = "You must continue.";
  const review = authoredDeliveryReview(draft, { verdict: "reject", findings: [{
    kind: "student_exit_conflict", draft_quote: "You must continue.", source_refs: [deliverySource(context, "Please stop now.")], rationale: "The exit is refused."
  }] });
  for (const malformed of [null, undefined, { status: "failed" }, { ...passingDeliveryReview(draft), verdict: "reject" },
    { ...review, verdict: "pass" }, { ...review, findings: [{ ...review.findings[0], draft_quote: "A nonexistent draft statement." }] },
    { ...review, findings: [{ ...review.findings[0], source_refs: [] }] }]) {
    const checked = validateConversationDeliveryReview(malformed, context, draft, null);
    assert.equal(checked.valid, false); assert.equal(checked.accepted, false); assert.ok(checked.validation_issue_paths.length);
  }
  for (const mutation of ["future", "actor", "paraphrase", "punctuation", "duplicate"] as const) {
    const changed = structuredClone(review); const ref = changed.findings[0].source_refs[0];
    if (mutation === "future") Object.assign(ref, { sequence_index: 999 });
    if (mutation === "actor") Object.assign(ref, { actor: "tutor" });
    if (mutation === "paraphrase") ref.quote = "I have mastered it and can finish.";
    if (mutation === "punctuation") ref.quote = ".";
    if (mutation === "duplicate") changed.findings[0].source_refs.push(structuredClone(ref));
    const checked = validateConversationDeliveryReview(changed, context, draft, null);
    assert.equal(checked.valid, false, mutation); assert.equal(checked.accepted, false, mutation);
  }
});

test("review context rejects changed latest text, duplicate or out-of-order visible turns", () => {
  const context = v18r2TestContext({ student_turn_count: 2 });
  for (const mutation of ["latest", "duplicate", "order"] as const) {
    const changed = structuredClone(context);
    if (mutation === "latest") changed.latest_student_message = "Not the actual latest text.";
    if (mutation === "duplicate") changed.visible_transcript[1].sequence_index = changed.visible_transcript[0].sequence_index;
    if (mutation === "order") changed.visible_transcript.reverse();
    assert.throws(() => buildConversationDeliveryReviewInput(changed, "Draft.", null), /context_invalid/);
    assert.equal(validateConversationDeliveryReview(passingDeliveryReview("Draft."), changed, "Draft.", null).accepted, false);
  }
});

test("an empty visible history can ground unsupported-history rejection but not invented student preferences", () => {
  const context = v18r2TestContext({ student_turn_count: 0 }); const draft = "Earlier we discussed this together.";
  const review = authoredDeliveryReview(draft, { verdict: "reject", findings: [{
    kind: "unsupported_conversation_history", draft_quote: "Earlier we discussed this together.", source_refs: [],
    rationale: "The supplied visible conversation is empty, so the draft has no supported prior discussion."
  }] });
  assert.equal(validateConversationDeliveryReview(review, context, draft, null).valid, true);
  review.findings[0].kind = "explicit_preference_conflict";
  assert.equal(validateConversationDeliveryReview(review, context, draft, null).valid, false);
});

const currentActivationFixtureText = readFileSync(new URL("./fixtures/conversation-current-source-activation-native-v22.json", import.meta.url), "utf8");
const currentActivationFixture = JSON.parse(currentActivationFixtureText) as {
  synthetic_only: boolean;
  projection_context: Pick<Context, "assessment_public_id" | "concept_unit_public_id" | "conversation_public_id" |
    "latest_student_message" | "visible_transcript" | "conversation_continuity" | "allowed_evidence_catalog">;
  base: ReturnType<typeof plannedWire>;
  rejected_repair_plan: TestPlan;
  historical_base_issue_paths: string[];
  historical_repair_issue_paths: string[];
};
const activationHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function currentActivationCase() {
  const wire = structuredClone(currentActivationFixture.base);
  // Explicit prospective control only: original V1 fixture bytes stay intact.
  wire.pre_reply_plan.version = CONVERSATION_PRE_REPLY_PLAN_VERSION;
  return { context: { ...v18r2TestContext({ student_turn_count: 4 }), ...structuredClone(currentActivationFixture.projection_context) },
    wire };
}

test("authored V2 version control retains the exact native activation fields and binds raw hashes", () => {
  assert.equal(createHash("sha256").update(currentActivationFixtureText.replace(/\r\n/g, "\n")).digest("hex"),
    "a705aad20e13f0274ca7862ba252be2d1ddb0bfdb691142dd1003d6c1318c3a4");
  assert.equal(currentActivationFixture.synthetic_only, true);
  assert(currentActivationFixture.historical_base_issue_paths.some(path => path.endsWith(":bootstrap_prior_invalid")));
  const { context, wire } = currentActivationCase();
  const before = JSON.stringify(wire), comparison = wire.pre_reply_plan.preference_comparisons[0];
  assert("kind" in comparison && "description" in comparison);
  const projected = projectConversationContinuityWire(wire, context), canonical = projectedReview(projected);
  assert.equal(JSON.stringify(wire), before);
  assert.equal(projected.output?.student_visible_message, wire.student_visible_message);
  assert.equal(projected.audit.current_source_activation_projection_version, CONVERSATION_CURRENT_SOURCE_ACTIVATION_PROJECTION_VERSION);
  assert.deepEqual(projected.audit.current_source_activation_bindings, [{
    path: "pre_reply_plan.preference_comparisons[0].prior", preference_id: comparison.preference_id,
    source_evidence_id: comparison.current_source!.evidence_id, source_sequence_index: 34,
    source_sha256: activationHash({ evidence_id: comparison.current_source!.evidence_id, quote: comparison.current_source!.quote }),
    original_preference_comparison_sha256: activationHash(comparison),
    projected_preference_comparison_sha256: activationHash({ ...comparison, prior: null })
  }]);
  assert.deepEqual(canonical.preference_updates, [{ preference_id: comparison.preference_id, kind: comparison.kind,
    description: comparison.description, status: "active", source: comparison.current_source }]);
  const explicit = structuredClone(wire); explicit.pre_reply_plan.preference_comparisons[0].prior = null;
  const explicitResult = projectConversationContinuityWire(explicit, context);
  assert.deepEqual(projected.output, explicitResult.output);
  assert.deepEqual(explicitResult.audit.current_source_activation_bindings, []);
  assert.deepEqual(conversationContinuityIssues(projected.output as ReturnType<typeof output>, context), []);
  const accepted = validateFormativeConversationV18R2CandidateAcceptance({ candidate: projected.output, context });
  assert.equal(accepted.valid, true, JSON.stringify(accepted.validation_issue_paths));
  // Authored protocol verdict, not a live claim that source timing proves intent.
  assert.equal(validateConversationDeliveryReview(passingDeliveryReview(wire.student_visible_message), context, wire.student_visible_message, null).accepted, true);
});

test("actual failed retain repair is not rewritten into a new activation", () => {
  const { context, wire } = currentActivationCase();
  wire.pre_reply_plan = structuredClone(currentActivationFixture.rejected_repair_plan);
  wire.pre_reply_plan.version = CONVERSATION_PRE_REPLY_PLAN_VERSION;
  const result = projectConversationContinuityWire(wire, context);
  assert.equal(result.output, null);
  assert.deepEqual(result.audit.current_source_activation_bindings, []);
  assert(result.audit.validation_issue_paths.some(path => path.endsWith(":bootstrap_prior_invalid")));
});

test("current-source projection does not bypass grounded delivery rejection or change raw object hashing", () => {
  const { context, wire } = currentActivationCase();
  const row = wire.pre_reply_plan.preference_comparisons[0];
  // Explicit reconstruction avoids relying on JSONB's property order.
  const { preference_id: id, ...rest } = row;
  wire.pre_reply_plan.preference_comparisons[0] = { preference_id: id, ...rest };
  assert.notEqual(activationHash(wire.pre_reply_plan.preference_comparisons[0]), activationHash(row));
  wire.student_visible_message = "We will work through SEM now despite your request to leave it for another day.";
  const projected = projectConversationContinuityWire(wire, context);
  assert(projected.output);
  assert.equal(projected.audit.current_source_activation_bindings![0].original_preference_comparison_sha256,
    activationHash(wire.pre_reply_plan.preference_comparisons[0]));
  const rejected = authoredDeliveryReview(wire.student_visible_message, { verdict: "reject", findings: [{
    kind: "explicit_preference_conflict", draft_quote: wire.student_visible_message,
    source_refs: [deliverySource(context, "Please leave SEM for another day.")],
    rationale: "The draft explicitly teaches the topic the student currently asked to defer."
  }] });
  const result = validateConversationDeliveryReview(rejected, context, wire.student_visible_message, null);
  assert.equal(result.valid, true);
  assert.equal(result.accepted, false);
});

const activationNearMatches = ["release", "retain", "uncertainty", "missing-current", "different-quote", "whitespace-prior",
  "whitespace-both", "older-source", "different-prior-id", "unknown-source", "future-source", "student-role", "other-conversation",
  "other-assessment", "other-concept", "other-scope", "duplicate-catalog", "duplicate-visible", "duplicate-preference",
  "stored-id", "empty-kind", "empty-description", "changed-latest", "changed-source-content"] as const;
for (const mutation of activationNearMatches) test(`current-source activation rejects non-exact ${mutation}`, () => {
  const { context, wire } = currentActivationCase();
  const row = wire.pre_reply_plan.preference_comparisons[0];
  assert(row.prior?.origin === "visible_student_history" && row.current_source && "kind" in row && "description" in row);
  const current = row.current_source;
  const entry = context.allowed_evidence_catalog.evidence.find(item => item.evidence_id === current.evidence_id)!;
  const earlier = context.allowed_evidence_catalog.evidence.find(item => item.source_sequence_index === 28)!;
  const turn = context.visible_transcript.find(item => item.sequence_index === 34)!;
  if (mutation === "release") row.decision = "release";
  if (mutation === "retain") { row.decision = "retain"; row.change_basis = "no_change"; }
  if (mutation === "uncertainty") row.change_basis = "uncertainty_only";
  if (mutation === "missing-current") row.current_source = null;
  if (mutation === "different-quote") row.prior.source.quote = "SEM";
  if (mutation === "whitespace-prior") row.prior.source.quote += " ";
  if (mutation === "whitespace-both") { row.prior.source.quote += " "; current.quote += " "; }
  if (mutation === "older-source") { row.prior.source = { evidence_id: earlier.evidence_id, quote: earlier.content }; row.current_source = { ...row.prior.source }; }
  if (mutation === "different-prior-id") row.prior.source = { evidence_id: earlier.evidence_id, quote: earlier.content };
  if (mutation === "unknown-source") { current.evidence_id = "ev_000000000000000000000000"; row.prior.source.evidence_id = current.evidence_id; }
  if (mutation === "future-source") entry.source_sequence_index = 999;
  if (mutation === "student-role") entry.source_role = "tutor";
  if (mutation === "other-conversation") entry.conversation_public_id = "other-conversation";
  if (mutation === "other-assessment") entry.assessment_public_id = "other-assessment";
  if (mutation === "other-concept") entry.concept_unit_public_id = "other-concept";
  if (mutation === "other-scope") entry.evidence_scope_id = "other-scope";
  if (mutation === "duplicate-catalog") context.allowed_evidence_catalog.evidence.push(structuredClone(entry));
  if (mutation === "duplicate-visible") context.visible_transcript.push(structuredClone(turn));
  if (mutation === "duplicate-preference") wire.pre_reply_plan.preference_comparisons.push(structuredClone(row));
  if (mutation === "stored-id") context.conversation_continuity!.preferences.push({ preference_id: row.preference_id,
    kind: "defer_topic", description: "Existing immutable preference.", status: "active",
    source: { evidence_id: earlier.evidence_id, quote: earlier.content }, source_agent_call_public_id: "old-call", source_tutor_sequence_index: 29 });
  if (mutation === "empty-kind") row.kind = null;
  if (mutation === "empty-description") row.description = " ";
  if (mutation === "changed-latest") context.latest_student_message = "Different current request.";
  if (mutation === "changed-source-content") entry.content += " Extra content not present in the visible turn.";
  const result = projectConversationContinuityWire(wire, context);
  assert.equal(result.output, null, mutation);
  assert.deepEqual(result.audit.current_source_activation_bindings, [], mutation);
});

test("historical audit omission remains readable and real earlier retention is not projected", () => {
  const { context, wire } = currentActivationCase();
  const row = wire.pre_reply_plan.preference_comparisons[0];
  const earlier = context.allowed_evidence_catalog.evidence.find(item => item.source_sequence_index === 28)!;
  row.prior = { origin: "visible_student_history", source: { evidence_id: earlier.evidence_id, quote: earlier.content } };
  row.decision = "retain"; row.change_basis = "no_change"; row.current_source = null;
  const result = projectConversationContinuityWire(wire, context);
  assert(result.output);
  assert.deepEqual(result.audit.current_source_activation_bindings, []);
  const historical = { ...result.audit };
  delete historical.current_source_activation_projection_version;
  delete historical.current_source_activation_bindings;
  assert.equal(ConversationPlanProjectionAuditSchema.safeParse(historical).success, true);
});

const orphanFixtureText = readFileSync(new URL("./fixtures/conversation-orphaned-deferral-native-v23.json", import.meta.url), "utf8");
const orphanFixture = JSON.parse(orphanFixtureText) as {
  synthetic_only: boolean; real_student_records_used: boolean;
  projection_context: typeof currentActivationFixture.projection_context;
  output: ReturnType<typeof output>; wire: ReturnType<typeof plannedWire>;
};
function orphanNativeCase() {
  return { context: { ...v18r2TestContext({ student_turn_count: 4 }), ...structuredClone(orphanFixture.projection_context) },
    candidate: structuredClone(orphanFixture.output) };
}
function authoredDeferredCase(latest = "Please work on the deferred topic now.") {
  const context = v18r2TestContext({ student_turn_count: 2,
    student_messages: ["Leave this topic for later.", latest], tutor_messages: ["What would help?", "We can leave that topic for later."] });
  const prior = review();
  prior.preference_updates.push({ preference_id: "topic", kind: "defer_topic", status: "active", description: "Leave this topic for later.",
    source: source(context, "Leave this topic for later.") });
  prior.need_updates.push({ need_id: "topic-need", kind: "confusion", status: "deferred", description: "Remaining topic uncertainty.",
    source: source(context, "Leave this topic for later."), support: [], deferred_by_preference_id: "topic" });
  context.conversation_continuity = buildConversationContinuity({ context, records: [{ source_agent_call_public_id: "prior",
    source_tutor_sequence_index: 3, review: prior }] });
  const next = review();
  next.preference_updates.push({ ...prior.preference_updates[0], status: "released", source: source(context, latest) });
  return { context, prior, next };
}

test("exact originally delivered native35 is rejected before orphaning its untouched deferred need", () => {
  assert.equal(createHash("sha256").update(orphanFixtureText.replace(/\r\n/g, "\n")).digest("hex"),
    "7049747f9e962689af5246f5ad0314cd312de175ce1e899dbb95c9867f40a0a7");
  assert.equal(orphanFixture.synthetic_only, true); assert.equal(orphanFixture.real_student_records_used, false);
  assert.equal(CONVERSATION_DEFERRED_NEED_LINK_VERSION, "conversation-deferred-need-link-v1");
  const { context, candidate } = orphanNativeCase(), before = JSON.stringify({ context, candidate });
  assert.deepEqual(conversationContinuityIssues(candidate, context), ["conversation_review.resulting_deferred_need_requires_active_preference"]);
  assert(ConversationPreReplyPlanStoredIdentityV1Schema.safeParse(orphanFixture.wire.pre_reply_plan).success);
  const prospectiveWire = structuredClone(orphanFixture.wire);
  prospectiveWire.pre_reply_plan.version = CONVERSATION_PRE_REPLY_PLAN_VERSION;
  const projected = projectConversationContinuityWire(prospectiveWire, context);
  assert(projected.output);
  has(conversationContinuityIssues(projected.output as ReturnType<typeof output>, context), "resulting_deferred_need_requires_active_preference");
  assert.equal(projected.output.student_visible_message, candidate.student_visible_message);
  assert.deepEqual(conversationResultingStateDiagnostics(candidate.conversation_review, context), {
    version: "conversation-resulting-state-feedback-v1", issues: [{ need_id: "need_sem_exact_true_score",
      deferred_by_preference_id: "pref_defer_other_assessment_topics", need_status: "deferred", preference_status: "released", preference_kind: "defer_topic" }],
    omitted_issue_count: 0 });
  assert.equal(JSON.stringify({ context, candidate }), before);
});

test("source-grounded narrowing may release the broad preference and explicitly relink to a new active one", () => {
  const { context, candidate } = orphanNativeCase(), state = candidate.conversation_review;
  const earlier = context.conversation_continuity!.needs.find(item => item.need_id === "need_sem_exact_true_score")!;
  const current = source(context, "Please leave SEM for another day.");
  state.preference_updates.push({ preference_id: "narrow-sem", kind: "defer_topic", description: "Leave SEM for another day.", status: "active", source: current });
  state.need_updates.push({ need_id: earlier.need_id, kind: earlier.kind, description: earlier.description, status: "deferred", source: current,
    support: [], deferred_by_preference_id: "narrow-sem" });
  assert.deepEqual(conversationContinuityIssues(candidate, context), []);
  assert.equal(conversationResultingStateDiagnostics(state, context), null);
  assert.equal(candidate.student_visible_message, orphanFixture.output.student_visible_message);
  state.preference_updates.at(-1)!.source.quote = "Please work on SEM immediately.";
  has(conversationContinuityIssues(candidate, context), "student_source_invalid");
});

for (const status of ["open", "addressed"] as const) test(`explicit release with valid ${status} need update remains eligible`, () => {
  const { context, prior, next } = authoredDeferredCase(); const text = "Here is the explanation you requested.";
  next.need_updates.push({ ...prior.need_updates[0], status, deferred_by_preference_id: null,
    source: source(context, context.latest_student_message!), support: status === "addressed" ? [{ tutor_sequence_index: null, quote: text }] : [] });
  next.closure.unresolved_need_ids = status === "open" ? ["topic-need"] : [];
  assert.deepEqual(conversationContinuityIssues(output(context, next, text), context), []);
  assert.equal(conversationResultingStateDiagnostics(next, context), null);
});

test("unrelated preference release preserves a retained active deferral", () => {
  const { context, prior } = authoredDeferredCase("Longer explanations are fine, but leave this topic for later.");
  context.conversation_continuity!.preferences.push({ ...context.conversation_continuity!.preferences[0],
    preference_id: "brief", kind: "brief_response", description: "Brief replies." });
  const next = review(); next.preference_updates.push({ ...prior.preference_updates[0], preference_id: "brief", kind: "brief_response",
    description: "Brief replies.", status: "released", source: source(context, context.latest_student_message!) });
  assert.deepEqual(conversationContinuityIssues(output(context, next), context), []);
});

test("explicit stop with a retained active deferral needs no new answer or assessment", () => {
  const { context } = authoredDeferredCase("I want to stop now."); const next = review();
  next.student_state.readiness = "stop"; next.student_state.readiness_source = source(context, "I want to stop now.");
  next.closure.reason = "student_stop";
  assert.deepEqual(conversationContinuityIssues({ ...output(context, next, "We can stop here."), lifecycle_recommendation: "complete" }, context), []);
  assert.equal(conversationResultingStateDiagnostics(next, context), null);
});

for (const mutation of ["missing", "released", "wrong-kind", "null-id"] as const) test(`untouched inherited deferred need rejects ${mutation} controller`, () => {
  const { context } = authoredDeferredCase(); const next = review(), state = context.conversation_continuity!;
  if (mutation === "missing") state.preferences = [];
  if (mutation === "released") state.preferences[0].status = "released";
  if (mutation === "wrong-kind") state.preferences[0].kind = "no_quiz";
  if (mutation === "null-id") state.needs[0].deferred_by_preference_id = null;
  const before = JSON.stringify(state);
  has(conversationContinuityIssues(output(context, next), context), "resulting_deferred_need_requires_active_preference");
  const diagnostic = conversationResultingStateDiagnostics(next, context)!;
  assert.equal(diagnostic.issues.length, 1);
  assert.equal(diagnostic.issues[0].deferred_by_preference_id, mutation === "null-id" ? null : "topic");
  assert.equal(diagnostic.issues[0].preference_status, ["missing", "null-id"].includes(mutation) ? null : mutation === "released" ? "released" : "active");
  assert.equal(diagnostic.issues[0].preference_kind, ["missing", "null-id"].includes(mutation) ? null : mutation === "wrong-kind" ? "no_quiz" : "defer_topic");
  assert.equal(JSON.stringify(state), before);
});

test("artificial addressed status without actual quoted support cannot evade orphan validation", () => {
  const { context, prior, next } = authoredDeferredCase();
  next.need_updates.push({ ...prior.need_updates[0], status: "addressed", deferred_by_preference_id: null, support: [] });
  has(conversationContinuityIssues(output(context, next), context), "addressed_need_requires_support");
});

test("an inherited orphan can be explicitly repaired without rewriting the historical snapshot", () => {
  const { context, prior } = authoredDeferredCase(); context.conversation_continuity!.preferences[0].status = "released";
  const before = JSON.stringify(context.conversation_continuity), next = review();
  next.need_updates.push({ ...prior.need_updates[0], status: "open", deferred_by_preference_id: null,
    source: source(context, context.latest_student_message!) }); next.closure.unresolved_need_ids = ["topic-need"];
  assert.deepEqual(conversationContinuityIssues(output(context, next), context), []);
  assert.equal(JSON.stringify(context.conversation_continuity), before);
});

test("historical reconstruction retains a delivered orphan rather than hiding or normalizing it", () => {
  const context = v18r2TestContext({ student_turn_count: 3, student_messages: ["Leave this topic for later.", "Please work on this topic now.", "I want to stop."],
    tutor_messages: ["What would help?", "We can leave it for later.", "Here is the requested help."] });
  const prior = review(); prior.preference_updates.push({ preference_id: "topic", kind: "defer_topic", status: "active", description: "Deferred topic.", source: source(context, "Leave this topic for later.") });
  prior.need_updates.push({ need_id: "topic-need", kind: "confusion", status: "deferred", description: "Remaining uncertainty.", source: prior.preference_updates[0].source, support: [], deferred_by_preference_id: "topic" });
  const released = review(); released.preference_updates.push({ ...prior.preference_updates[0], status: "released", source: source(context, "Please work on this topic now.") });
  const records = [{ source_agent_call_public_id: "old-active", source_tutor_sequence_index: 3, review: prior },
    { source_agent_call_public_id: "old-orphan", source_tutor_sequence_index: 5, review: released }];
  const before = JSON.stringify(records), history = buildConversationContinuity({ context, records });
  assert.equal(history.preferences[0].status, "released"); assert.equal(history.needs[0].status, "deferred");
  assert.equal(history.needs[0].deferred_by_preference_id, "topic"); assert.equal(JSON.stringify(records), before);
  has(conversationContinuityIssues(output(context), { ...context, conversation_continuity: history }), "resulting_deferred_need_requires_active_preference");
});

test("resulting-state feedback is deterministic and bounded without concealing the total omitted count", () => {
  const { context } = authoredDeferredCase(); context.conversation_continuity!.preferences[0].status = "released";
  const template = context.conversation_continuity!.needs[0];
  context.conversation_continuity!.needs = Array.from({ length: 14 }, (_, index) => ({ ...template, need_id: `need-${index}` }));
  const diagnostic = conversationResultingStateDiagnostics(review(), context)!;
  assert.equal(diagnostic.issues.length, 12); assert.equal(diagnostic.omitted_issue_count, 2);
  assert.deepEqual(diagnostic.issues.map(item => item.need_id), Array.from({ length: 12 }, (_, index) => `need-${index}`));
  assert.deepEqual(conversationResultingStateDiagnostics(review(), context), diagnostic);
  assert.equal(conversationResultingStateDiagnostics(null, context), null);
});

const retainedFixtureText = readFileSync(new URL("./fixtures/conversation-stored-retain-native-v24.json", import.meta.url), "utf8");
const retainedFixture = JSON.parse(retainedFixtureText) as {
  synthetic_only: boolean; real_student_records_used: boolean; input: Context;
  attempts: Array<{ wire: ReturnType<typeof plannedWire>; validation_issue_paths: string[]; expected_acceptance: false }>;
};
function storedRetainCase() {
  const context = structuredClone(retainedFixture.input), wire = structuredClone(retainedFixture.attempts[1].wire);
  wire.pre_reply_plan.version = CONVERSATION_PRE_REPLY_PLAN_VERSION;
  wire.pre_reply_plan.preference_comparisons = [{ preference_id: "pref_defer_sem", decision: "retain" }];
  return { context, wire };
}

test("current instructions agree with V2 strict stored retention and sourced transitions", () => {
  assert(CONVERSATION_CONTINUITY_INSTRUCTIONS.includes(`pre_reply_plan.version is ${CONVERSATION_PRE_REPLY_PLAN_VERSION}`));
  assert(!CONVERSATION_CONTINUITY_INSTRUCTIONS.includes("pre_reply_plan.version is conversation-pre-reply-plan-v1"));
  assert(CONVERSATION_CONTINUITY_INSTRUCTIONS.includes('return exactly {preference_id,decision:"retain"}'));
  assert(CONVERSATION_CONTINUITY_INSTRUCTIONS.includes("Omit prior,\nkind, description, change_basis and current_source entirely in this stored-retain"));
  assert(CONVERSATION_CONTINUITY_INSTRUCTIONS.includes("For an actual release or reactivation of an existing snapshot preference"));
  assert(CONVERSATION_CONTINUITY_INSTRUCTIONS.includes("explicit_change and an exact latest-student current_source"));
  assert(!CONVERSATION_CONTINUITY_INSTRUCTIONS.includes('snapshot preference, set prior to {origin:"stored_preference"}'));
});

test("exact V24 failures remain historical V1 wires and are never normalized into V2", () => {
  assert.equal(createHash("sha256").update(retainedFixtureText.replace(/\r\n/g, "\n")).digest("hex"),
    "4a24d0448b8ce972132552df671ed0cd9873f25e4dd291706e21c6d74bbe6f7d");
  assert.equal(retainedFixture.synthetic_only, true); assert.equal(retainedFixture.real_student_records_used, false);
  const before = JSON.stringify(retainedFixture);
  for (const item of retainedFixture.attempts) {
    assert.equal(item.expected_acceptance, false);
    assert(ConversationPreReplyPlanStoredIdentityV1Schema.safeParse(item.wire.pre_reply_plan).success);
    assert.equal(ConversationPreReplyPlanSchema.safeParse(item.wire.pre_reply_plan).success, false);
    assert.equal(projectConversationContinuityWire(item.wire, retainedFixture.input).output, null);
    const versionOnly = structuredClone(item.wire); versionOnly.pre_reply_plan.version = CONVERSATION_PRE_REPLY_PLAN_VERSION;
    assert.equal(projectConversationContinuityWire(versionOnly, retainedFixture.input).output, null);
  }
  assert.equal(JSON.stringify(retainedFixture), before);
});

test("authored two-field V2 retention preserves exact native stored state while allowing the requested pause projection", () => {
  const { context, wire } = storedRetainCase(), before = JSON.stringify({ context, wire });
  const result = projectConversationContinuityWire(wire, context), canonical = projectedReview(result);
  assert.deepEqual(canonical.preference_updates, []);
  assert.equal(canonical.closure.reason, wire.post_reply_review.closure.reason);
  assert.equal(canonical.closure.reason, "student_pause");
  assert.equal(result.audit.version, "conversation-pre-reply-plan-v2");
  assert.equal(result.audit.stored_preference_retention_version, CONVERSATION_STORED_PREFERENCE_RETENTION_VERSION);
  assert.deepEqual(result.audit.stored_preference_bindings, [{ preference_id: "pref_defer_sem",
    preference_sha256: activationHash(ConversationContinuitySchema.parse(context.conversation_continuity).preferences[0]) }]);
  assert.equal(JSON.stringify({ context, wire }), before);
  assert.deepEqual(conversationContinuityIssues(result.output as ReturnType<typeof output>, context), []);
});

for (const extra of ["prior", "current_source", "change_basis", "kind", "description"] as const) test(`stored retain rejects extra ${extra} rather than discarding it`, () => {
  const { context, wire } = storedRetainCase();
  Object.assign(wire.pre_reply_plan.preference_comparisons[0], { [extra]: extra === "change_basis" ? "no_change" : null });
  assert.equal(ConversationPreReplyPlanSchema.safeParse(wire.pre_reply_plan).success, false);
  assert.equal(projectConversationContinuityWire(wire, context).output, null);
});

for (const mutation of ["unknown-id", "duplicate-comparison", "duplicate-stored-id", "duplicate-evidence", "duplicate-turn",
  "nonstudent", "wrong-scope", "future-source", "changed-content", "changed-quote"] as const) test(`stored retain rejects ${mutation} source ambiguity`, () => {
  const { context, wire } = storedRetainCase(), stored = context.conversation_continuity!.preferences[0];
  const entry = context.allowed_evidence_catalog.evidence.find(item => item.evidence_id === stored.source.evidence_id)!;
  const turn = context.visible_transcript.find(item => item.sequence_index === entry.source_sequence_index)!;
  if (mutation === "unknown-id") wire.pre_reply_plan.preference_comparisons[0].preference_id = "not-stored";
  if (mutation === "duplicate-comparison") wire.pre_reply_plan.preference_comparisons.push(structuredClone(wire.pre_reply_plan.preference_comparisons[0]));
  if (mutation === "duplicate-stored-id") context.conversation_continuity!.preferences.push(structuredClone(stored));
  if (mutation === "duplicate-evidence") context.allowed_evidence_catalog.evidence.push(structuredClone(entry));
  if (mutation === "duplicate-turn") context.visible_transcript.push(structuredClone(turn));
  if (mutation === "nonstudent") entry.source_role = "tutor";
  if (mutation === "wrong-scope") entry.conversation_public_id = "another-conversation";
  if (mutation === "future-source") entry.source_sequence_index = 999;
  if (mutation === "changed-content") entry.content += " fabricated extra source words";
  if (mutation === "changed-quote") stored.source.quote = "A quotation not present in the source.";
  assert.equal(projectConversationContinuityWire(wire, context).output, null);
});

test("retention binds every stored record in authored order and preserves released as well as active status", () => {
  const { context, wire } = storedRetainCase(), first = context.conversation_continuity!.preferences[0];
  const released = { ...structuredClone(first), preference_id: "released-boundary", status: "released" as const };
  context.conversation_continuity!.preferences.push(released);
  wire.pre_reply_plan.preference_comparisons = [{ preference_id: released.preference_id, decision: "retain" }, { preference_id: first.preference_id, decision: "retain" }];
  const before = JSON.stringify(context.conversation_continuity), result = projectConversationContinuityWire(wire, context);
  assert.deepEqual(projectedReview(result).preference_updates, []);
  const parsed = ConversationContinuitySchema.parse(context.conversation_continuity);
  assert.deepEqual(result.audit.stored_preference_bindings, [released, first].map(item => ({ preference_id: item.preference_id,
    preference_sha256: activationHash(parsed.preferences.find(value => value.preference_id === item.preference_id)) })));
  assert.equal(JSON.stringify(context.conversation_continuity), before);
});

test("historical V1 projection audit remains readable without the new retention marker", () => {
  const { context, wire } = storedRetainCase(), result = projectConversationContinuityWire(wire, context);
  const historical = { ...result.audit, version: "conversation-pre-reply-plan-v1" };
  delete historical.stored_preference_retention_version;
  assert(ConversationPlanProjectionAuditSchema.safeParse(historical).success);
  assert.equal(ConversationPlanProjectionAuditSchema.safeParse({ ...result.audit, stored_preference_retention_version: "wrong" }).success, false);
});

console.log(JSON.stringify({ status: "passed", tests: checks, paid_calls: 0, synthetic_only: true,
  limitation: "Source and declared-state checks do not establish semantic truth, pedagogical quality, or classroom learning." }));
