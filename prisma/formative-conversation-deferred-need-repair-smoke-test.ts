import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { StructuredAgentRequest, StructuredAgentResult } from "../src/lib/llm/providers/types";
import {
  FORMATIVE_CONVERSATION_SCOPE_NARROWING_INSTRUCTIONS,
  FormativeConversationV18R2AgentOutputSchema,
  type FormativeConversationV18R2AgentInput
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import {
  CONVERSATION_DELIVERY_REVIEW_VERSION, CONVERSATION_PRE_REPLY_PLAN_VERSION, buildConversationDeliveryDraftBlocks,
  conversationContinuityIssues, conversationResultingStateDiagnostics,
  projectConversationContinuityWire, type ConversationReview
} from "../src/lib/services/student-assessment/formative-conversation/conversation-continuity";
import {
  FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION, FormativeConversationPlannedProposalOutputSchema,
  prepareConversationPlanResult, prepareFormativeProfileProposalResult
} from "../src/lib/services/student-assessment/formative-conversation/profile-update-proposal";
import {
  buildFormativeConversationV18R2SemanticRegenerationRequest,
  createSingleAttemptFormativeConversationV18R2Execution, executeFormativeConversationV18R2,
  FormativeConversationV18R2ExecutionError, FORMATIVE_CONVERSATION_PROFILE_PROPOSAL_REGENERATION_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/execution-v18r2";
import { v18r2TestContext } from "./formative-conversation-v18r2-test-fixtures";

globalThis.fetch = async () => { throw new Error("Offline repair checks cannot call a provider"); };
type Wire = z.infer<typeof FormativeConversationPlannedProposalOutputSchema>;
const fixturePath = new URL("./fixtures/conversation-orphaned-deferral-native-v23.json", import.meta.url);
const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes.toString("utf8")) as {
  synthetic_only: boolean; real_student_records_used: boolean;
  projection_context: Pick<FormativeConversationV18R2AgentInput, "assessment_public_id" | "concept_unit_public_id" |
    "conversation_public_id" | "latest_student_message" | "visible_transcript" | "allowed_evidence_catalog" | "conversation_continuity">;
  output: z.infer<typeof FormativeConversationV18R2AgentOutputSchema>; wire: Wire;
};
assert.equal(fixture.synthetic_only, true); assert.equal(fixture.real_student_records_used, false);
assert.equal(createHash("sha256").update(fixtureBytes.toString("utf8").replace(/\r\n/g, "\n")).digest("hex"),
  "7049747f9e962689af5246f5ad0314cd312de175ce1e899dbb95c9867f40a0a7");
// Unrelated executor fields use existing synthetic fixtures. The exact native
// continuity fields/wire remain unchanged; this is no fresh model judgment.
const context: FormativeConversationV18R2AgentInput = {
  ...v18r2TestContext({ student_turn_count: 4 }), ...structuredClone(fixture.projection_context),
  assessment_response_evidence: []
};
// The exact V1 native wire remains immutable; these current request controls
// author only the prospective plan version before exercising the same state issue.
const currentWire = structuredClone(fixture.wire);
currentWire.pre_reply_plan.version = CONVERSATION_PRE_REPLY_PLAN_VERSION;
const original = structuredClone({ context, wire: currentWire, nativeWire: fixture.wire });
const base: StructuredAgentRequest<FormativeConversationV18R2AgentInput, unknown> = {
  agent_name: "formative_conversation_agent",
  model_config: { model_name: "gpt-5.6-luna", reasoning_effort: "medium", max_output_tokens: 7000 },
  instructions: FORMATIVE_CONVERSATION_SCOPE_NARROWING_INSTRUCTIONS, input: context,
  output_schema: FormativeConversationPlannedProposalOutputSchema,
  schema_name: FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION,
  client_request_id: "offline-deferred-need-repair", timeout_ms: 120_000,
  metadata: { synthetic_test: "true" }
};
const code = "conversation_review.resulting_deferred_need_requires_active_preference";
let checks = 0;
function check(name: string, run: () => void) { run(); checks++; console.log(`PASS ${name}`); }
function narrowWire() {
  const wire = structuredClone(currentWire);
  const source = { evidence_id: "ev_6432378fc1372075a091f963", quote: "Please leave SEM for another day." };
  wire.pre_reply_plan.preference_comparisons.push({ preference_id: "authored_sem_only", prior: null,
    kind: "defer_topic", description: "Leave SEM for another day.", decision: "activate",
    change_basis: "explicit_change", current_source: source });
  const need = context.conversation_continuity!.needs.find(item => item.need_id === "need_sem_exact_true_score")!;
  wire.post_reply_review.need_updates.push({ need_id: need.need_id, kind: need.kind,
    description: need.description, status: "deferred", source: need.source, support: [],
    deferred_by_preference_id: "authored_sem_only" });
  wire.post_reply_review.current_support[0].preference_links.push({
    preference_id: "authored_sem_only", relationship: "honored_constraint"
  });
  return wire;
}
const fixed = narrowWire();
const fixedCanonical = projectConversationContinuityWire(fixed, context).output;
assert(fixedCanonical);
check("exact retained native release now rejects the untouched deferred need", () => {
  assert.deepEqual(conversationContinuityIssues(fixture.output, context), [code]);
  assert.deepEqual(conversationResultingStateDiagnostics(fixture.output.conversation_review, context), {
    version: "conversation-resulting-state-feedback-v1", omitted_issue_count: 0, issues: [{
      need_id: "need_sem_exact_true_score", deferred_by_preference_id: "pref_defer_other_assessment_topics",
      need_status: "deferred", preference_status: "released", preference_kind: "defer_topic"
    }]
  });
});
check("authored narrowing preserves teaching text, old identity and deferred need while restoring an active link", () => {
  const output = FormativeConversationV18R2AgentOutputSchema.parse(fixedCanonical);
  assert.deepEqual(conversationContinuityIssues(output, context), []);
  assert.equal(output.student_visible_message, fixture.wire.student_visible_message);
  assert.equal(output.profile_transition_recommendation, null);
  assert.equal(output.conversation_review!.preference_updates[0].description,
    fixture.output.conversation_review!.preference_updates[0].description);
  assert.equal(conversationResultingStateDiagnostics(output.conversation_review, context), null);
});

async function run(wires: Wire[], rejectReview = false) {
  const tutors: StructuredAgentRequest<unknown, unknown>[] = [];
  const reviews: StructuredAgentRequest<unknown, unknown>[] = [];
  try {
    const execution = await executeFormativeConversationV18R2({ base_request: base,
      validate_candidate(output) {
        const issues = conversationContinuityIssues(output, context, { required: true });
        return { valid: !issues.length, validation_status: issues.length ? "semantic_contract_invalid" : "valid",
          validation_issue_paths: issues };
      },
      async execute_logical_generation({ request, sequence }) {
        tutors.push(request); assert(wires[sequence - 1], "Unexpected extra tutor attempt");
        const wire = structuredClone(wires[sequence - 1]);
        const raw: StructuredAgentResult<unknown> = { provider: "openai", status: "completed",
          client_request_id: request.client_request_id, provider_response_id: `offline-tutor-${sequence}`,
          parsed_output: wire, raw_output: { output_text: JSON.stringify(wire) },
          usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }, latency_ms: 10 };
        const result = prepareFormativeProfileProposalResult(prepareConversationPlanResult(raw, context), context);
        return createSingleAttemptFormativeConversationV18R2Execution({ request, result,
          logical_call_id: `offline-tutor-${sequence}` });
      },
      async execute_delivery_review({ request, sequence }) {
        reviews.push(request);
        const input = request.input as { draft_message: string };
        const output = { version: CONVERSATION_DELIVERY_REVIEW_VERSION,
          teaching_block_audit: buildConversationDeliveryDraftBlocks(input.draft_message).map(block => ({
            block_id: block.block_id, assessment: "supported", check: "Authored protocol control, not live semantic verification."
          })), verdict: rejectReview ? "reject" : "pass",
          findings: rejectReview ? [{ kind: "explicit_preference_conflict", draft_block_id: 1,
            draft_quote: input.draft_message.split("\n")[0],
            source_refs: [{ actor: "student", sequence_index: 34, quote: "Please leave SEM for another day." }],
            rationale: "Authored review rejection tests that fixing private state does not bypass delivery review." }] : [] };
        const result: StructuredAgentResult<unknown> = { provider: "openai", status: "completed",
          client_request_id: request.client_request_id, provider_response_id: `offline-review-${sequence}`,
          parsed_output: output, raw_output: { output_text: JSON.stringify(output) },
          usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 }, latency_ms: 3 };
        return createSingleAttemptFormativeConversationV18R2Execution({ request, result,
          logical_call_id: `offline-review-${sequence}` });
      }
    });
    return { execution, error: null, tutors, reviews };
  } catch (error) { return { execution: null, error, tutors, reviews }; }
}

async function main() {
  const repaired = await run([currentWire, fixed]); assert(repaired.execution);
  const feedback = repaired.tutors[1].input as { original_context: unknown; semantic_regeneration: {
    policy_version: string; invalid_candidate: unknown; issue_paths: string[];
    deferred_need_link_feedback: ReturnType<typeof conversationResultingStateDiagnostics> } };
  check("planned repair contains exact merged-state IDs/statuses and original context, with no invented sources", () => {
    assert.equal(feedback.semantic_regeneration.policy_version, FORMATIVE_CONVERSATION_PROFILE_PROPOSAL_REGENERATION_VERSION);
    assert.equal(feedback.semantic_regeneration.policy_version, "formative-conversation-v18r2-semantic-regeneration-v5");
    assert.deepEqual(feedback.original_context, original.context);
    assert.deepEqual(feedback.semantic_regeneration.invalid_candidate, original.wire);
    assert(feedback.semantic_regeneration.issue_paths.includes(code));
    assert.deepEqual(feedback.semantic_regeneration.deferred_need_link_feedback,
      conversationResultingStateDiagnostics(fixture.output.conversation_review, context));
    assert(!JSON.stringify(feedback.semantic_regeneration.deferred_need_link_feedback).includes("quote"));
  });
  check("one structural repair is followed by delivery review, with original rejection and all usage retained", () => {
    assert.equal(repaired.tutors.length, 2); assert.equal(repaired.reviews.length, 1);
    assert.equal(repaired.execution!.audit.semantic_regeneration_calls, 1);
    assert.equal(repaired.execution!.total_tokens, 330);
    assert.equal(repaired.execution!.audit.attempts[0].pre_delivery_review, undefined);
    assert.equal(repaired.execution!.audit.attempts[1].pre_delivery_review!.status, "passed");
    assert.deepEqual(repaired.execution!.audit.attempts[0].invalid_candidate!.candidate_json, original.wire);
    assert.equal(repaired.execution!.result.parsed_output.student_visible_message, fixed.student_visible_message);
    assert(repaired.tutors.every(request => request.model_config.model_name === base.model_config.model_name && request.model_config.max_output_tokens === 7000));
  });
  check("no orphan and malformed projection do not invent diagnostics; legacy request remains separate", () => {
    const audit = structuredClone(repaired.execution!.audit.attempts[0]);
    const build = (candidate: unknown, legacy = false) => {
      audit.invalid_candidate!.candidate_json = candidate;
      return buildFormativeConversationV18R2SemanticRegenerationRequest({
        base_request: legacy ? { ...base, schema_name: context.contract_version, output_schema: FormativeConversationV18R2AgentOutputSchema } : base,
        invalid_attempt: audit, client_request_id: "offline-feedback-absence"
      });
    };
    for (const request of [build(fixed), build({ pre_reply_plan: {} }), build(fixture.output, true)]) {
      assert(!Object.hasOwn(request.input.semantic_regeneration, "deferred_need_link_feedback"));
    }
  });
  const exhausted = await run([currentWire, currentWire]);
  check("an unchanged orphan fails after the same single repair, without a reviewer call or third tutor call", () => {
    assert(exhausted.error instanceof FormativeConversationV18R2ExecutionError);
    assert.equal(exhausted.error.failure_category, "semantic_regeneration_exhausted");
    assert.equal(exhausted.tutors.length, 2); assert.equal(exhausted.reviews.length, 0);
    assert.equal(exhausted.error.total_tokens, 300);
    assert(exhausted.error.audit.attempts.every(attempt => attempt.invalid_candidate!.validation_issue_paths.includes(code)));
  });
  const reviewerBlocked = await run([currentWire, fixed], true);
  check("state consistency never substitutes for an independent delivery decision", () => {
    assert(reviewerBlocked.error instanceof FormativeConversationV18R2ExecutionError);
    assert.equal(reviewerBlocked.error.failure_category, "semantic_regeneration_exhausted");
    assert.equal(reviewerBlocked.tutors.length, 2); assert.equal(reviewerBlocked.reviews.length, 1);
    assert.equal(reviewerBlocked.error.audit.attempts[1].pre_delivery_review!.status, "rejected");
    assert.equal(reviewerBlocked.error.total_tokens, 330);
  });
  check("all fixture bytes, authored raw outputs and source context remain immutable", () => {
    assert.deepEqual(readFileSync(fixturePath), fixtureBytes);
    assert.deepEqual(context, original.context); assert.deepEqual(currentWire, original.wire);
    assert.deepEqual(fixture.wire, original.nativeWire);
    assert(fixedCanonical);
    const review = fixedCanonical.conversation_review as ConversationReview;
    assert.equal(review.need_updates.find(need => need.need_id === "need_sem_exact_true_score")!.status, "deferred");
  });
  console.log(`Deferred-need repair checks passed: ${checks}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
