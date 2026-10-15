import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  verifyRejectedConversationDeliveryCandidate,
  verifySelectedConversationDeliveryAudit
} from "../src/lib/operational/luna-conversation-replay-evidence";
import { FormativeConversationV18R2AgentInputSchema,
  FormativeConversationV18R2AgentOutputSchema } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { FormativeConversationPlannedProposalOutputSchema, reconstructFormativeProfileProposal } from "../src/lib/services/student-assessment/formative-conversation/profile-update-proposal";
import { buildConversationDeliveryReviewInput, ConversationDeliveryReviewV7Schema,
  projectConversationContinuityWire } from "../src/lib/services/student-assessment/formative-conversation/conversation-continuity";
import { prepareFormativeInterpretationResult } from "../src/lib/services/student-assessment/formative-conversation/interpretation-policy";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fixtureText = readFileSync("prisma/fixtures/conversation-rejected-planned-wire-native-v28.json", "utf8");
const fixture = JSON.parse(fixtureText);
let checks = 0;
function check(run: () => void) { run(); checks++; }
const rejected = fixture.audit.attempts[0];
const original = hash(fixture);
const candidate = verifyRejectedConversationDeliveryCandidate(rejected, fixture.input);
const verify = (audit: unknown = fixture.audit, input: unknown = fixture.input,
  rows = fixture.transport) => verifySelectedConversationDeliveryAudit(audit, fixture.provider_response_id,
  input, fixture.output, rows, "gpt-6.1-sol");

check(() => assert.equal(createHash("sha256").update(fixtureText.replace(/\r\n/g, "\n")).digest("hex"),
  "6b68b596fa2e903b70ea40d8db775c63389f8f5e3b0794e156d67d83e913f74e"));
check(() => assert.equal(rejected.invalid_candidate.validation_status, "delivery_review_rejected"));
check(() => assert.equal(FormativeConversationV18R2AgentOutputSchema.safeParse(rejected.invalid_candidate.candidate_json).success, false));
check(() => assert.notEqual(hash(rejected.invalid_candidate.candidate_json), rejected.invalid_candidate.candidate_hash));
check(() => assert.equal(hash(FormativeConversationPlannedProposalOutputSchema.parse(rejected.invalid_candidate.candidate_json)),
  rejected.invalid_candidate.candidate_hash));
check(() => assert.deepEqual(buildConversationDeliveryReviewInput(fixture.input, candidate.student_visible_message, candidate),
  rejected.pre_delivery_review.input));
check(() => assert.equal(verify().http_requests_dispatched, 4));
check(() => assert.equal(verify().provider_response_ids.length, 4));
check(() => assert.equal(hash(fixture), original));

const reverseKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(reverseKeys) :
  value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;
check(() => assert.deepEqual(verifyRejectedConversationDeliveryCandidate(reverseKeys(rejected), reverseKeys(fixture.input)), candidate));
check(() => assert.equal(verify(reverseKeys(fixture.audit), reverseKeys(fixture.input)).http_requests_dispatched, 4));

for (const [key, values] of Object.entries({
  conversation_plan_projection: [undefined, { ...rejected.conversation_plan_projection, original_output_sha256: "0".repeat(64) },
    { ...rejected.conversation_plan_projection, reconstructed_output_sha256: "0".repeat(64) },
    { ...rejected.conversation_plan_projection, current_reply_bindings: [] },
    { ...rejected.conversation_plan_projection, prior_needs_sha256: "0".repeat(64) }],
  profile_update_projection: [undefined, { ...rejected.profile_update_projection, original_output_sha256: "0".repeat(64) },
    { ...rejected.profile_update_projection, reconstructed_output_sha256: "0".repeat(64) },
    { ...rejected.profile_update_projection, prior_profile_sha256: "0".repeat(64) },
    { ...rejected.profile_update_projection, retained_fields: ["ability_profile"] }],
  interpretation_projection: [{ policy_version: "formative-interpretation-policy-v6", operation: "unchanged_updated_fields_marked_retained",
    fields: [], original_sha256: hash(candidate), projected_sha256: hash(candidate) }]
})) for (const value of values) {
  check(() => assert.throws(() => verifyRejectedConversationDeliveryCandidate({ ...rejected, [key]: value }, fixture.input), /projection/));
}
for (const patch of [{ candidate_hash: null }, { candidate_hash: "0".repeat(64) },
  { candidate_text: "{}" }, { candidate_json: { ...rejected.invalid_candidate.candidate_json, extra: "must not be stripped" } },
  { candidate_json: { ...rejected.invalid_candidate.candidate_json, conversation_review: candidate.conversation_review } },
  { candidate_json: { ...rejected.invalid_candidate.candidate_json, student_visible_message: "Different draft" } }]) {
  check(() => assert.throws(() => verifyRejectedConversationDeliveryCandidate({ ...rejected,
    invalid_candidate: { ...rejected.invalid_candidate, ...patch } }, fixture.input)));
}
const alteredSource = structuredClone(fixture.input);
alteredSource.visible_transcript.find((turn: { sequence_index: number }) => turn.sequence_index === 29).message_text += " Altered.";
check(() => assert.throws(() => verifyRejectedConversationDeliveryCandidate(rejected, alteredSource), /projection/));
const alteredPrior = structuredClone(fixture.input);
alteredPrior.current_profile.profile_version = "different-prior";
check(() => assert.throws(() => verifyRejectedConversationDeliveryCandidate(rejected, alteredPrior), /profile projection/));
const forgedInput = structuredClone(rejected.pre_delivery_review.input);
forgedInput.proposed_learning_claims.candidate_sha256 = "0".repeat(64);
const forgedReview = { ...rejected.pre_delivery_review, input: forgedInput, input_sha256: hash(forgedInput) };
check(() => assert.throws(() => verify({ ...fixture.audit, attempts: [{ ...rejected, pre_delivery_review: forgedReview }, fixture.audit.attempts[1]] }), /reviewer input/));
check(() => assert.throws(() => verify(fixture.audit, fixture.input, fixture.transport.slice(1)), /physical transport/));
for (let changed = 0; changed < fixture.transport.length; changed++) check(() => assert.throws(() => verify(fixture.audit, fixture.input,
  fixture.transport.map((row: Record<string, unknown>, index: number) => index === changed ? { ...row, request_format_sha256: "0".repeat(64) } : row)), /physical request format/));
// Removing both wire fields and their audit cannot switch current evidence to
// an old canonical-reader path, even with a coordinated replacement hash.
for (const candidateHash of [rejected.invalid_candidate.candidate_hash, hash(candidate)]) {
  const stripped = { ...rejected, conversation_plan_projection: undefined,
    invalid_candidate: { ...rejected.invalid_candidate, candidate_json: candidate, candidate_hash: candidateHash } };
  check(() => assert.throws(() => verifyRejectedConversationDeliveryCandidate(stripped, fixture.input)));
  check(() => assert.throws(() => verify({ ...fixture.audit, attempts: [stripped, fixture.audit.attempts[1]] })));
}

// Also exercise the non-null profile-proposal stage. These source values come
// from the separate retained synthetic V26 fixture, not a relabeled V28 verdict.
const profileFixture = JSON.parse(readFileSync("prisma/fixtures/formative-private-learning-native-v26.json", "utf8"));
const profileContext = FormativeConversationV18R2AgentInputSchema.parse(profileFixture.context);
const profileWire = FormativeConversationPlannedProposalOutputSchema.parse(profileFixture.original_wire);
const plan = projectConversationContinuityWire(profileWire, profileContext);
assert(plan.output);
const profile = reconstructFormativeProfileProposal({ candidate: plan.output, context: profileContext });
assert(profile.valid);
const interpreted = prepareFormativeInterpretationResult({ provider: "mock", status: "completed", client_request_id: "OFFLINE",
  latency_ms: 0, parsed_output: profile.output }, profileContext);
const profileAttempt = { client_request_id: "OFFLINE", latency_ms: 0,
  invalid_candidate: { candidate_json: profileWire, candidate_text: null, candidate_hash: hash(profileWire) },
  conversation_plan_projection: plan.audit, profile_update_projection: profile.audit,
  ...(interpreted.raw_output ? { interpretation_projection: (interpreted.raw_output as Record<string, unknown>).interpretation_projection } : {}) };
check(() => assert.equal(profile.audit.status, "reconstructed"));
check(() => assert.deepEqual(verifyRejectedConversationDeliveryCandidate(profileAttempt, profileContext), interpreted.parsed_output));
check(() => assert.throws(() => verifyRejectedConversationDeliveryCandidate({ ...profileAttempt,
  profile_update_projection: { ...profile.audit, changed_fields: [] } }, profileContext), /profile projection/));
// Canonical historical/offline outputs and the historical V7 review reader keep
// their existing contracts; they are not changed into prospective V28 evidence.
check(() => assert.deepEqual(FormativeConversationV18R2AgentOutputSchema.parse(candidate), candidate));
check(() => assert.equal(ConversationDeliveryReviewV7Schema.safeParse({ version: "conversation-delivery-review-v7",
  teaching_block_audit: [{ block_id: 1, assessment: "supported", check: "x".repeat(200) }],
  private_learning_audit: [], verdict: "pass", findings: [] }).success, true));
check(() => assert.equal(hash(fixture), original));
console.log(`Rejected planned-wire evidence: ${checks} checks passed; no provider or database calls.`);
