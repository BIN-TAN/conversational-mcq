import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { StructuredAgentRequest, StructuredAgentResult } from "../src/lib/llm/providers/types";
import {
  FORMATIVE_CONVERSATION_SCOPE_NARROWING_INSTRUCTIONS,
  FormativeConversationV18R2AgentInputSchema,
  type FormativeConversationV18R2AgentInput
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import {
  CONVERSATION_PRE_REPLY_PLAN_VERSION, CONVERSATION_DELIVERY_REVIEW_VERSION,
  ConversationPreReplyPlanStoredIdentityV1Schema, buildConversationDeliveryDraftBlocks,
  projectConversationContinuityWire
} from "../src/lib/services/student-assessment/formative-conversation/conversation-continuity";
import {
  FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION, FormativeConversationPlannedProposalOutputSchema,
  prepareConversationPlanResult, prepareFormativeProfileProposalResult
} from "../src/lib/services/student-assessment/formative-conversation/profile-update-proposal";
import {
  createSingleAttemptFormativeConversationV18R2Execution, executeFormativeConversationV18R2,
  FormativeConversationV18R2ExecutionError
} from "../src/lib/services/student-assessment/formative-conversation/execution-v18r2";
import { validateFormativeConversationV18R2CandidateAcceptance } from "../src/lib/services/student-assessment/formative-conversation/candidate-validation-v18r2";

globalThis.fetch = async () => { throw new Error("Offline retained-preference checks cannot call a provider"); };
const fixturePath = new URL("./fixtures/conversation-stored-retain-native-v24.json", import.meta.url);
const bytes = readFileSync(fixturePath);
const fixture = JSON.parse(bytes.toString("utf8")) as {
  synthetic_only: boolean; real_student_records_used: boolean;
  input: FormativeConversationV18R2AgentInput;
  attempts: { wire: Record<string, unknown> & { pre_reply_plan: Record<string, unknown> };
    validation_issue_paths: string[]; expected_acceptance: false }[];
};
assert.equal(fixture.synthetic_only, true); assert.equal(fixture.real_student_records_used, false);
assert.equal(createHash("sha256").update(bytes.toString("utf8").replace(/\r\n/g, "\n")).digest("hex"),
  "4a24d0448b8ce972132552df671ed0cd9873f25e4dd291706e21c6d74bbe6f7d");
const context = FormativeConversationV18R2AgentInputSchema.parse(fixture.input);
const original = structuredClone(fixture);
const retainedId = "pref_defer_sem";
// Explicitly authored prospective controls; never rewrite the retained failed wires.
function prospective(index: number, retain = true) {
  const wire = structuredClone(fixture.attempts[index].wire);
  wire.pre_reply_plan.version = CONVERSATION_PRE_REPLY_PLAN_VERSION;
  if (retain) wire.pre_reply_plan.preference_comparisons = [{ preference_id: retainedId, decision: "retain" }];
  return wire;
}
const fixed = prospective(1);
// A schema-valid unknown stored ID exercises the existing semantic repair.
// Extra old fields are structural failures, not a new semantic-retry allowance.
const badReference = prospective(1);
badReference.pre_reply_plan.preference_comparisons = [{ preference_id: "absent", decision: "retain" }];
const base: StructuredAgentRequest<FormativeConversationV18R2AgentInput, unknown> = {
  agent_name: "formative_conversation_agent",
  model_config: { model_name: "gpt-5.6-luna", reasoning_effort: "medium", max_output_tokens: 7000 },
  instructions: FORMATIVE_CONVERSATION_SCOPE_NARROWING_INSTRUCTIONS, input: context,
  output_schema: FormativeConversationPlannedProposalOutputSchema,
  schema_name: FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION,
  client_request_id: "offline-stored-retain", timeout_ms: 120_000, metadata: { synthetic_test: "true" }
};
let checks = 0;
function check(name: string, run: () => void) { run(); checks++; console.log(`PASS ${name}`); }

check("exact historical bad drafts remain readable and rejected; V2 never strips their invalid bookkeeping", () => {
  for (const [index, attempt] of fixture.attempts.entries()) {
    assert(ConversationPreReplyPlanStoredIdentityV1Schema.safeParse(attempt.wire.pre_reply_plan).success);
    assert.equal(attempt.expected_acceptance, false);
    assert(attempt.validation_issue_paths.some(issue => issue.endsWith("uncertainty_requires_current_source")));
    assert.equal(FormativeConversationPlannedProposalOutputSchema.safeParse(attempt.wire).success, false);
    assert.equal(FormativeConversationPlannedProposalOutputSchema.safeParse(prospective(index, false)).success, false);
    assert.equal(projectConversationContinuityWire(prospective(index, false), context).output, null);
  }
});
check("authored two-field retention preserves closing text and passes the real candidate validator", () => {
  assert(FormativeConversationPlannedProposalOutputSchema.safeParse(fixed).success);
  const projected = projectConversationContinuityWire(fixed, context); assert(projected.output);
  assert.equal(projected.audit.stored_preference_retention_version, "conversation-stored-preference-retention-v1");
  assert.equal(projected.output.student_visible_message, fixture.attempts[1].wire.student_visible_message);
  assert.deepEqual((projected.output.conversation_review as { preference_updates: unknown[] }).preference_updates, []);
  const validation = validateFormativeConversationV18R2CandidateAcceptance({ candidate: projected.output, context });
  assert.equal(validation.valid, true, JSON.stringify(validation.validation_issue_paths));
  assert.equal(validation.output!.profile_transition_recommendation, null);
  assert.equal(validation.output!.lifecycle_recommendation, "pause");
  assert.equal(validation.output!.conversation_review!.closure.reason, "student_pause");
});
check("retention cannot reactivate a released record or repair an invalid deferred link", () => {
  const released = structuredClone(context);
  released.conversation_continuity!.preferences[0].status = "released";
  const before = structuredClone(released);
  const projected = projectConversationContinuityWire(fixed, released); assert(projected.output);
  assert.deepEqual((projected.output.conversation_review as { preference_updates: unknown[] }).preference_updates, []);
  const result = validateFormativeConversationV18R2CandidateAcceptance({ candidate: projected.output, context: released });
  assert.equal(result.valid, false);
  assert(result.validation_issue_paths.includes("conversation_review.resulting_deferred_need_requires_active_preference"));
  assert.deepEqual(released, before);
});
check("unknown and duplicate stored IDs cannot be treated as retention", () => {
  const unknown = structuredClone(fixed);
  unknown.pre_reply_plan.preference_comparisons = [{ preference_id: "absent", decision: "retain" }];
  assert.equal(projectConversationContinuityWire(unknown, context).output, null);
  const duplicate = structuredClone(context);
  duplicate.conversation_continuity!.preferences.push(structuredClone(duplicate.conversation_continuity!.preferences[0]));
  assert.equal(projectConversationContinuityWire(fixed, duplicate).output, null);
});

async function run(wires: unknown[], rejectReview = false) {
  const tutors: StructuredAgentRequest<unknown, unknown>[] = [];
  const reviews: StructuredAgentRequest<unknown, unknown>[] = [];
  try {
    const execution = await executeFormativeConversationV18R2({ base_request: base,
      validate_candidate(candidate) { return validateFormativeConversationV18R2CandidateAcceptance({ candidate, context }); },
      async execute_logical_generation({ request, sequence }) {
        tutors.push(request); assert(wires[sequence - 1], "No third generation allowed");
        const wire = structuredClone(wires[sequence - 1]);
        const raw: StructuredAgentResult<unknown> = { provider: "openai", status: "completed",
          client_request_id: request.client_request_id, provider_response_id: `offline-retain-tutor-${sequence}`,
          parsed_output: wire, raw_output: { output_text: JSON.stringify(wire) },
          usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }, latency_ms: 10 };
        const result = prepareFormativeProfileProposalResult(prepareConversationPlanResult(raw, context), context);
        return createSingleAttemptFormativeConversationV18R2Execution({ request, result, logical_call_id: `offline-retain-${sequence}` });
      },
      async execute_delivery_review({ request, sequence }) {
        reviews.push(request); const input = request.input as { draft_message: string };
        const output = { version: CONVERSATION_DELIVERY_REVIEW_VERSION,
          teaching_block_audit: buildConversationDeliveryDraftBlocks(input.draft_message).map(block => ({
            block_id: block.block_id, assessment: "supported", check: "Authored protocol control, not an actual model judgment."
          })), verdict: rejectReview ? "reject" : "pass",
          findings: rejectReview ? [{ kind: "unsupported_learning_claim", draft_block_id: 1,
            draft_quote: input.draft_message.split("\n")[0],
            source_refs: [{ actor: "student", sequence_index: 38, quote: "That is enough today." }],
            rationale: "Authored negative proves a private retention fix does not bypass the separate delivery decision." }] : [] };
        const result: StructuredAgentResult<unknown> = { provider: "openai", status: "completed",
          client_request_id: request.client_request_id, provider_response_id: `offline-retain-review-${sequence}`,
          parsed_output: output, raw_output: { output_text: JSON.stringify(output) },
          usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 }, latency_ms: 3 };
        return createSingleAttemptFormativeConversationV18R2Execution({ request, result, logical_call_id: `offline-retain-review-${sequence}` });
      }
    });
    return { execution, error: null, tutors, reviews };
  } catch (error) { return { execution: null, error, tutors, reviews }; }
}
async function main() {
  const direct = await run([fixed]); assert(direct.execution);
  check("valid closing needs one tutor call and one independent delivery call, without learning promotion", () => {
    assert.equal(direct.tutors.length, 1); assert.equal(direct.reviews.length, 1);
    assert.equal(direct.execution!.audit.semantic_regeneration_calls, 0);
    assert.equal(direct.execution!.total_tokens, 180);
    assert.equal(direct.execution!.result.parsed_output.profile_transition_recommendation, null);
    assert.equal(direct.execution!.result.parsed_output.lifecycle_recommendation, "pause");
  });
  const repaired = await run([badReference, fixed]); assert(repaired.execution);
  check("one repair receives exact original context/bad wire and explicit retention guidance", () => {
    const request = repaired.tutors[1];
    const input = request.input as { original_context: unknown; semantic_regeneration: { invalid_candidate: unknown; policy_version: string } };
    assert.deepEqual(input.original_context, context);
    assert.deepEqual(input.semantic_regeneration.invalid_candidate, badReference);
    assert.equal(input.semantic_regeneration.policy_version, "formative-conversation-v18r2-semantic-regeneration-v5");
    assert(request.instructions.includes('{preference_id,decision:"retain"}'));
    assert(request.instructions.includes("do not treat the invalid old wire as normalized or accepted"));
    assert.equal(repaired.tutors.length, 2); assert.equal(repaired.reviews.length, 1);
    assert.equal(repaired.execution!.audit.semantic_regeneration_calls, 1);
    assert.equal(repaired.execution!.total_tokens, 330);
    assert.equal(repaired.execution!.audit.attempts[0].pre_delivery_review, undefined);
  });
  const exhausted = await run([badReference, badReference]);
  check("two unknown-ID drafts exhaust the existing single repair without delivery or silent cleanup", () => {
    assert(exhausted.error instanceof FormativeConversationV18R2ExecutionError);
    assert.equal(exhausted.error.failure_category, "semantic_regeneration_exhausted");
    assert.equal(exhausted.tutors.length, 2); assert.equal(exhausted.reviews.length, 0);
    assert.equal(exhausted.error.total_tokens, 300);
  });
  const rejected = await run([badReference, fixed], true);
  check("a repaired retention plan cannot bypass rejected visible content", () => {
    assert(rejected.error instanceof FormativeConversationV18R2ExecutionError);
    assert.equal(rejected.error.audit.attempts[1].pre_delivery_review!.status, "rejected");
    assert.equal(rejected.tutors.length, 2); assert.equal(rejected.reviews.length, 1);
    assert.equal(rejected.error.total_tokens, 330);
  });
  check("native fixture, context and original rejected values stay unchanged", () => {
    assert.deepEqual(readFileSync(fixturePath), bytes); assert.deepEqual(fixture, original);
    assert.deepEqual(context, FormativeConversationV18R2AgentInputSchema.parse(original.input));
  });
  console.log(`Stored-retain closing checks passed: ${checks}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
