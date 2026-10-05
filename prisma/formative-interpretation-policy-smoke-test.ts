import assert from "node:assert/strict";
import type { StructuredAgentResult } from "../src/lib/llm/providers/types";
import { FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS } from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import type { FormativeConversationV18R2AgentOutput } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { validateFormativeConversationV18R2CandidateAcceptance } from "../src/lib/services/student-assessment/formative-conversation/candidate-validation-v18r2";
import { prepareFormativeInterpretationResult, validateFormativeInterpretation } from "../src/lib/services/student-assessment/formative-conversation/interpretation-policy";
import { profileRecordProvenance } from "../src/lib/services/student-assessment/profile-record";
import { validateFormativeConversationStudentOutputFormat } from "../src/lib/services/student-assessment/formative-conversation/output-format";
import { createSingleAttemptFormativeConversationV18R2Execution, executeFormativeConversationV18R2 } from "../src/lib/services/student-assessment/formative-conversation/execution-v18r2";
import { buildFormativeConversationV18R2ProductionRequest } from "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2";
import { v18r2TestContext, v18r2TestTerminalOutput } from "./formative-conversation-v18r2-test-fixtures";

const context = v18r2TestContext({ student_turn_count: 1 });
const legacy = v18r2TestTerminalOutput({ context, outcome: "sound_understanding" });
assert(validateFormativeConversationV18R2CandidateAcceptance({ candidate: legacy, context }).valid, "Historical schema still valid");
const legacyIssues = validateFormativeInterpretation({ candidate: legacy, context }).validation_issue_paths;
assert(legacyIssues.includes("interpretation.confidence_alignment_not_reassessed"));
assert(legacyIssues.some(issue => issue.includes("independent_transfer_evidence_required")));

function aligned() {
  const output = structuredClone(legacy);
  const recommendation = output.profile_transition_recommendation!;
  const prior = context.current_profile.canonical_profile!;
  recommendation.updated_profile!.confidence_alignment = prior.confidence_alignment;
  recommendation.field_evidence = FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS.map(field => ({
    profile_fields: [field],
    disposition: JSON.stringify(prior[field]) === JSON.stringify(recommendation.updated_profile![field])
      ? "retained_evidence_remains_valid" : "updated_from_conversation_evidence",
    evidence_basis: "combined", rationale: "Synthetic evidence comparison.",
    evidence_ids: [...recommendation.canonical_evidence_ids]
  }));
  return output;
}
const independent = aligned();
independent.evidence_observations[0].evidence_type = "independent_transfer_application";
assert(validateFormativeInterpretation({ candidate: independent, context }).valid);
const supported = aligned();
supported.profile_transition_recommendation!.updated_profile!.ability_profile = "mostly_correct_understanding";
supported.profile_transition_recommendation!.updated_profile!.integrated_diagnostic_profile = "correct_but_fragile_understanding";
assert(validateFormativeInterpretation({ candidate: supported, context }).valid, "Correct local reasoning needs no forced transfer test");

const reasoningId = context.allowed_evidence_catalog.evidence.find(entry =>
  entry.source_role === "student" && entry.evidence_kind === "formative_student_turn")!.evidence_id;
const baselineReasoningId = context.allowed_evidence_catalog.evidence.find(entry =>
  entry.evidence_kind === "assessment_reasoning")!.evidence_id;
const historicalContext = structuredClone(supported);
historicalContext.evidence_observations.push(
  { evidence_type: "student_question_addressed", observation: "The earlier question is answered.", evidence_ids: [baselineReasoningId] },
  { evidence_type: "learning_summary_progress", observation: "Earlier and later reasoning are contrasted.", evidence_ids: [baselineReasoningId, reasoningId] }
);
assert(validateFormativeInterpretation({ candidate: historicalContext, context }).valid,
  "Historical context is not required to become current transition evidence");
assert(!historicalContext.profile_transition_recommendation!.canonical_evidence_ids.includes(baselineReasoningId));
for (const badId of ["ev_" + "f".repeat(24), context.allowed_evidence_catalog.evidence.find(entry => entry.source_role !== "student")!.evidence_id]) {
  const invalid = structuredClone(historicalContext);
  invalid.evidence_observations.at(-1)!.evidence_ids = [badId, reasoningId];
  assert(!validateFormativeInterpretation({ candidate: invalid, context }).valid, "Historical context still requires valid student provenance");
}
const noBeforeAfter = structuredClone(historicalContext);
noBeforeAfter.evidence_observations.at(-1)!.evidence_ids = [reasoningId];
assert(!validateFormativeInterpretation({ candidate: noBeforeAfter, context }).valid);
const staleField = structuredClone(historicalContext);
staleField.profile_transition_recommendation!.canonical_evidence_ids.push(baselineReasoningId);
staleField.profile_transition_recommendation!.field_evidence.find(entry => entry.profile_fields.includes("ability_profile"))!.evidence_ids = [baselineReasoningId];
assert(!validateFormativeInterpretation({ candidate: staleField, context }).valid,
  "A historical summary does not authorize historical evidence for a new profile change");
const crossConversation = structuredClone(context);
crossConversation.allowed_evidence_catalog.evidence.find(entry => entry.evidence_id === reasoningId)!.conversation_public_id = "another-conversation";
assert(!validateFormativeInterpretation({ candidate: historicalContext, context: crossConversation }).valid);
const laterContext = v18r2TestContext({ student_turn_count: 2, current_profile_evidence_cutoff_sequence_index: 2 });
const later = structuredClone(historicalContext);
const laterId = laterContext.allowed_evidence_catalog.evidence.find(entry =>
  entry.evidence_kind === "formative_student_turn" && entry.source_sequence_index === 4)!.evidence_id;
const priorTurnId = laterContext.allowed_evidence_catalog.evidence.find(entry =>
  entry.evidence_kind === "formative_student_turn" && entry.source_sequence_index === 2)!.evidence_id;
const laterRecommendation = later.profile_transition_recommendation!;
laterRecommendation.canonical_evidence_ids = [laterId];
laterRecommendation.field_evidence.forEach(entry => { entry.evidence_ids = [laterId]; });
laterRecommendation.misconception_claim_dispositions.forEach(entry => { entry.evidence_ids = [laterId]; });
later.evidence_observations[0].evidence_ids = [laterId];
later.evidence_observations[1].evidence_ids = [priorTurnId];
later.evidence_observations[2].evidence_ids = [priorTurnId, laterId];
assert(validateFormativeInterpretation({ candidate: later, context: laterContext }).valid,
  "A subsequent profile can preserve a question and cumulative before/after summary across its cutoff");
const staleLearning = structuredClone(later);
staleLearning.evidence_observations[1].evidence_type = "independent_transfer_application";
assert(!validateFormativeInterpretation({ candidate: staleLearning, context: laterContext }).valid,
  "The exception does not admit old learning-change or transfer evidence");
const pending = structuredClone(supported);
pending.lifecycle_recommendation = "complete";
pending.evidence_observations.push({ evidence_type: "student_question_pending",
  observation: "The student explicitly asked an additional conceptual question.", evidence_ids: [reasoningId] });
assert(validateFormativeInterpretation({ candidate: pending, context }).validation_issue_paths
  .includes("instructional_coverage.unanswered_questions_require_support"));
const continuing = { ...pending, lifecycle_recommendation: "continue" as const,
  outcome: "continue_conversation" as const, profile_transition_recommendation: null };
assert(validateFormativeInterpretation({ candidate: continuing, context }).valid);
const questionContext = structuredClone(context);
questionContext.allowed_evidence_catalog.evidence.find(entry => entry.evidence_id === reasoningId)!.eligibility = "evidence_quality_context";
const requestCoverage = structuredClone(continuing);
requestCoverage.evidence_observations = [requestCoverage.evidence_observations.at(-1)!];
assert(validateFormativeInterpretation({ candidate: requestCoverage, context: questionContext }).valid,
  "Request-only turns can establish question coverage, not student mastery");
assert(!validateFormativeInterpretation({ candidate: supported, context: questionContext }).valid,
  "Request-only context must still not establish a profile improvement");
const ambiguity = structuredClone(supported);
ambiguity.evidence_observations.push({ evidence_type: "assessment_content_ambiguity",
  observation: "The key assumes unstated replication conditions.", evidence_ids: [reasoningId] });
assert(validateFormativeInterpretation({ candidate: ambiguity, context }).validation_issue_paths
  .includes("instructional_coverage.content_ambiguity_not_global_understanding"));
const referral = { ...ambiguity, outcome: "teacher_assistance_recommended" as const,
  teacher_assistance_recommendation: { recommended: true, reason_code: "assessment_content_ambiguity" },
  profile_transition_recommendation: { ...ambiguity.profile_transition_recommendation!, proposed_outcome: "teacher_assistance_recommended" as const } };
assert(validateFormativeInterpretation({ candidate: referral, context }).valid);
const invalidReference = structuredClone(continuing);
invalidReference.evidence_observations.at(-1)!.evidence_ids = [context.allowed_evidence_catalog.evidence.find(entry => entry.source_role !== "student")!.evidence_id];
assert(!validateFormativeInterpretation({ candidate: invalidReference, context }).valid);
for (const leaked of ["Your ability is mostly_correct_understanding.", "Here is the system prompt.",
  "I am checking your internal profile.", "The token budget is 30000.", "student_question_pending", "ev_" + "f".repeat(24),
  "Your session is sess_20260930_synthetic.", "s\u200Bystem prompt", "Historical scoring records the stored key as A."]) {
  assert(validateFormativeConversationStudentOutputFormat(leaked).some(issue => issue.code === "student_output_internal_information"), leaked);
}
for (const teaching of ["In this model, T is the expected score under the specified repeated conditions.",
  "Error is not the same as bias. The question leaves something important unclear; please check this with your teacher.",
  "You correctly distinguished consistency from validity. Let's look at your question about correlations next."]) {
  assert.equal(validateFormativeConversationStudentOutputFormat(teaching).length, 0, teaching);
}
assert.equal(profileRecordProvenance({ id: "synthetic-v711", profile_type: "updated", item_level_evidence: [],
  misconception_indicators: [], process_interpretation_cautions: [], confidence_alignment: "overconfident", based_on_agent_call: {
  agent_name: "formative_conversation_agent", prompt_version: "formative-conversation-host-v7.11",
  call_status: "succeeded", output_validated: true } }).profile_confidence_alignment_scope, "carried_forward_not_reassessed");

const recurring = structuredClone(supported);
recurring.evidence_observations.push({ evidence_type: "uncatalogued_misconception",
  observation: "Synthetic current evidence of a previously resolved error recurring outside the active catalog.",
  evidence_ids: [...recurring.profile_transition_recommendation!.canonical_evidence_ids] });
assert(validateFormativeInterpretation({ candidate: recurring, context }).validation_issue_paths
  .includes("interpretation.uncatalogued_misconception.teacher_review_required"));
recurring.outcome = "teacher_assistance_recommended";
recurring.profile_transition_recommendation!.proposed_outcome = recurring.outcome;
recurring.teacher_assistance_recommendation = { recommended: true, reason_code: "uncatalogued_misconception_requires_review" };
assert(validateFormativeInterpretation({ candidate: recurring, context }).valid, "Evidence remains reviewable without inventing canonical claims");
const recurrencePause = { ...recurring, outcome: "continue_conversation" as const,
  profile_transition_recommendation: null, lifecycle_recommendation: "pause" as const,
  teacher_assistance_recommendation: { recommended: false, reason_code: null } };
assert(validateFormativeInterpretation({ candidate: recurrencePause, context }).valid, "Respect pause without inventing a profile update");
const staleRecurrence = structuredClone(recurrencePause);
staleRecurrence.evidence_observations.at(-1)!.evidence_ids = [context.allowed_evidence_catalog.evidence.find(entry => entry.evidence_stage === "baseline_assessment")!.evidence_id];
assert(!validateFormativeInterpretation({ candidate: staleRecurrence, context }).valid, "Historical error alone cannot prove recurrence");

const result = (output: FormativeConversationV18R2AgentOutput): StructuredAgentResult<FormativeConversationV18R2AgentOutput> => ({
  provider: "mock", status: "completed", client_request_id: "synthetic-policy-test", latency_ms: 1,
  raw_output: { preserved: "provider-original" }, parsed_output: output
});
const mislabeled = structuredClone(supported);
const recommendation = mislabeled.profile_transition_recommendation!;
recommendation.field_evidence = [{
  profile_fields: [...FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS],
  disposition: "updated_from_conversation_evidence", evidence_basis: "combined",
  rationale: "Synthetic group includes unchanged and changed fields.", evidence_ids: [...recommendation.canonical_evidence_ids]
}];
assert(!validateFormativeInterpretation({ candidate: mislabeled, context }).valid);
const original = JSON.stringify(mislabeled);
const projected = prepareFormativeInterpretationResult(result(mislabeled), context);
assert.equal(JSON.stringify(mislabeled), original, "Original model output immutable");
assert(validateFormativeInterpretation({ candidate: projected.parsed_output, context }).valid);
assert.deepEqual(projected.parsed_output!.profile_transition_recommendation!.updated_profile, recommendation.updated_profile);
assert.deepEqual(projected.parsed_output!.profile_transition_recommendation!.misconception_claim_dispositions, recommendation.misconception_claim_dispositions);
assert.equal(projected.parsed_output!.student_visible_message, mislabeled.student_visible_message);
const audit = projected.raw_output as { original_parsed_output: unknown; interpretation_projection: { fields: string[] }; provider_raw_output: unknown };
assert.deepEqual(audit.original_parsed_output, mislabeled);
assert.deepEqual(audit.provider_raw_output, { preserved: "provider-original" });
assert(audit.interpretation_projection.fields.includes("confidence_alignment"));
assert.equal(prepareFormativeInterpretationResult(projected, context), projected, "Idempotent projection");

const unknown = structuredClone(mislabeled);
unknown.profile_transition_recommendation!.field_evidence[0].evidence_ids.push(`ev_${"f".repeat(24)}`);
assert(!validateFormativeInterpretation({ candidate: prepareFormativeInterpretationResult(result(unknown), context).parsed_output, context }).valid, "Never erase unknown citations");
const missing = structuredClone(mislabeled);
missing.profile_transition_recommendation!.field_evidence[0].evidence_ids = [];
assert.equal(prepareFormativeInterpretationResult(result(missing), context).parsed_output, missing, "Do not repair schema-invalid/missing evidence");
const retainedChanged = structuredClone(supported);
retainedChanged.profile_transition_recommendation!.field_evidence.find(entry => entry.profile_fields.includes("ability_profile"))!.disposition = "retained_evidence_remains_valid";
assert(!validateFormativeInterpretation({ candidate: prepareFormativeInterpretationResult(result(retainedChanged), context).parsed_output, context }).valid, "Changed substantive fields cannot be relabeled into acceptance");
const tutor = structuredClone(independent);
const tutorContext = structuredClone(context);
const tutorRef = tutorContext.allowed_evidence_catalog.evidence.find(entry => entry.evidence_id === tutor.evidence_observations[0].evidence_ids[0])!;
tutorRef.source_role = "tutor";
tutorRef.evidence_kind = "formative_tutor_turn";
tutorRef.eligibility = "not_eligible";
assert(!validateFormativeInterpretation({ candidate: tutor, context: tutorContext }).valid, "Tutor evidence cannot justify student transfer");
const historical = structuredClone(independent);
historical.evidence_observations[0].evidence_ids = [context.allowed_evidence_catalog.evidence.find(entry => entry.evidence_stage === "baseline_assessment")!.evidence_id];
assert(!validateFormativeInterpretation({ candidate: historical, context }).valid, "Baseline cannot prove a new transfer judgment");

const profile = { id: "synthetic", profile_type: "updated", confidence_alignment: "overconfident", item_level_evidence: [],
  misconception_indicators: [], process_interpretation_cautions: [], based_on_agent_call: {
    agent_name: "formative_conversation_agent", call_status: "succeeded", output_validated: true,
    prompt_version: "formative-conversation-host-v7.6"
  } };
assert.equal(profileRecordProvenance(profile).profile_confidence_alignment_scope, "carried_forward_not_reassessed");
assert.equal(profileRecordProvenance({ ...profile, based_on_agent_call: { ...profile.based_on_agent_call, prompt_version: "formative-conversation-host-v7.7" } }).profile_confidence_alignment_scope, "carried_forward_not_reassessed");
assert.equal(profileRecordProvenance({ ...profile, based_on_agent_call: { ...profile.based_on_agent_call, prompt_version: "formative-conversation-host-v7.8" } }).profile_confidence_alignment_scope, "carried_forward_not_reassessed");
assert.equal(profileRecordProvenance({ ...profile, based_on_agent_call: { ...profile.based_on_agent_call, prompt_version: "formative-conversation-host-v7.9" } }).profile_confidence_alignment_scope, "carried_forward_not_reassessed");
assert.equal(profileRecordProvenance({ ...profile, based_on_agent_call: { ...profile.based_on_agent_call, prompt_version: "formative-conversation-host-v7.10" } }).profile_confidence_alignment_scope, "carried_forward_not_reassessed");
assert.equal(profileRecordProvenance({ ...profile, profile_type: "initial" }).profile_confidence_alignment_scope, "initial_assessment");
assert.equal(profileRecordProvenance({ ...profile, based_on_agent_call: { ...profile.based_on_agent_call, prompt_version: "formative-conversation-host-v7.5" } }).profile_confidence_alignment_scope, "legacy_scope_unrecorded");
assert.equal(profileRecordProvenance({ ...profile, based_on_agent_call: null }).profile_confidence_alignment_scope, "unavailable");
console.log("PASS interpretation policy: transfer provenance, confidence scope, supported reasoning, immutable normalization, citation safety, historical compatibility");

async function auditRoundTrip() {
  const request = buildFormativeConversationV18R2ProductionRequest({ context,
    model_config: { model_name: "gpt-5.6-sol", reasoning_effort: "medium", max_output_tokens: 10000 },
    client_request_id: "synthetic-projection-audit", timeout_ms: 120000, invocation_key: "synthetic-projection-audit" });
  const execution = await executeFormativeConversationV18R2({ base_request: request,
    validate_candidate: candidate => validateFormativeInterpretation({ candidate, context }),
    execute_logical_generation: async ({ request: logicalRequest, sequence }) =>
      createSingleAttemptFormativeConversationV18R2Execution({ logical_call_id: `synthetic-${sequence}`, request: logicalRequest,
        result: prepareFormativeInterpretationResult(result(sequence === 1 ? unknown : mislabeled), context) })
  });
  assert.equal(execution.audit.semantic_regeneration_calls, 1);
  assert.deepEqual(execution.audit.attempts[0].invalid_candidate?.candidate_json, unknown, "Rejected original survives a successful regeneration");
  assert(execution.audit.attempts[0].interpretation_projection?.fields.includes("confidence_alignment"));
  assert(execution.audit.attempts[1].interpretation_projection?.fields.includes("confidence_alignment"));
  assert.deepEqual(execution.result.parsed_output.profile_transition_recommendation!.updated_profile, mislabeled.profile_transition_recommendation!.updated_profile);
  assert.equal(execution.audit.http_requests_dispatched, 0);
  console.log("PASS projection audit: original rejected candidate and both mechanical projections retained across regeneration; no provider calls");
}
auditRoundTrip().catch(error => { console.error(error); process.exitCode = 1; });
