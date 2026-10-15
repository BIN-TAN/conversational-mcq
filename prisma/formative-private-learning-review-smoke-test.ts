import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { zodTextFormat } from "openai/helpers/zod";
import type { StructuredAgentRequest, StructuredAgentResult } from "../src/lib/llm/providers/types";
import { compileProductionStructuredAgentRequest } from "../src/lib/agents/provider-request";
import {
  FormativeConversationV18R2AgentInputSchema, FormativeConversationV18R2AgentOutputSchema,
  type FormativeConversationV18R2AgentInput as Context, type FormativeConversationV18R2AgentOutput as Candidate
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import {
  CONVERSATION_DELIVERY_REVIEW_VERSION, ConversationDeliveryReviewSchema, ConversationDeliveryReviewV7Schema,
  buildConversationDeliveryReviewInput, validateConversationDeliveryReview,
  type ConversationDeliveryReviewInput, type ConversationDeliveryReview
} from "../src/lib/services/student-assessment/formative-conversation/conversation-continuity";
import {
  buildConversationPrivateLearningReview, privateLearningHash, privateLearningCanonicalJson,
  PRIVATE_LEARNING_REVIEW_MAX_BLOCKS, PRIVATE_LEARNING_REVIEW_MAX_CLAIMS,
  CONVERSATION_PRIVATE_LEARNING_REVIEW_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/private-learning-review";
import { validateFormativeInterpretation } from "../src/lib/services/student-assessment/formative-conversation/interpretation-policy";
import {
  FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION, FormativeConversationPlannedProposalOutputSchema,
  prepareConversationPlanResult, prepareFormativeProfileProposalResult
} from "../src/lib/services/student-assessment/formative-conversation/profile-update-proposal";
import {
  buildFormativeConversationDeliveryReviewRequest, createSingleAttemptFormativeConversationV18R2Execution,
  executeFormativeConversationV18R2, FormativeConversationV18R2ExecutionError
} from "../src/lib/services/student-assessment/formative-conversation/execution-v18r2";

globalThis.fetch = async () => { throw new Error("Private learning review controls cannot call a provider"); };
type Control = { id: string; authored_synthetic: boolean; expected_verdict: "pass" | "reject"; context: Context; candidate: Candidate };
const fixturePath = new URL("./fixtures/formative-private-learning-native-v26.json", import.meta.url);
const bytes = readFileSync(fixturePath);
const hashText = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const fixture = JSON.parse(bytes.toString("utf8")) as {
  synthetic_only: boolean; real_student_records_used: boolean; call_index_zero_based: number;
  source: { path: string; sha256: string }; context: Context; output: Candidate; controls: Control[];
  original_wire: unknown;
};
assert.equal(hashText(bytes.toString("utf8").replace(/\r\n/g, "\n")), "0e39212e24a5a396bcc9d132f6de2d99e6420c52f1276b7ad5317c1ed78e3a3c");
const [bad, recognition, novel] = fixture.controls;
let checks = 0;
function check(name: string, run: () => void) { run(); checks++; console.log(`PASS ${name}`); }
const inputFor = (control: Control) => buildConversationDeliveryReviewInput(control.context, control.candidate.student_visible_message, control.candidate);
const projection = inputFor(bad).proposed_learning_claims;
type Claim = { path: string; value: unknown; evidence_ids: string[] };
const claims = (input: ReturnType<typeof buildConversationPrivateLearningReview>): Claim[] => input.blocks.flatMap(block => JSON.parse(block.text) as Claim[]);
function reviewFor(input: ConversationDeliveryReviewInput, reject = false): ConversationDeliveryReview {
  const block = input.proposed_learning_claims.blocks.find(item => item.claim_paths.includes("evidence_observations[0]"));
  return ConversationDeliveryReviewSchema.parse({
    version: CONVERSATION_DELIVERY_REVIEW_VERSION,
    teaching_block_audit: input.draft_blocks.map(item => ({ block_id: item.block_id, assessment: "supported",
      check: "Authored offline protocol judgment: the visible explanation remains accurate and scoped." })),
    private_learning_audit: input.proposed_learning_claims.blocks.map(item => ({ block_id: item.block_id,
      assessment: reject ? item.block_id === block?.block_id ? "unsupported" : "uncertain" : "supported",
      check: reject && item.block_id === block?.block_id
        ? "This restatement repeats tutor reasoning; it does not establish new application or misconception resolution."
        : reject ? "This block is not independently accepted after the grounded first-use learning claim rejection."
          : "Authored offline judgment: claims are limited to the cited contribution and its assistance context." })),
    verdict: reject ? "reject" : "pass",
    findings: reject ? [{ kind: "unsupported_learning_claim", targets: [{ learning_block_id: block!.block_id,
      claim_path: "evidence_observations[0]", claim_quote: "supported_application_near_transfer" }],
      source_refs: [
        { sequence_index: 29, actor: "tutor", quote: "such as reading speed, while having little relationship to how well people perform the job" },
        { sequence_index: 31, actor: "tutor", quote: "compare test scores with later job-performance evidence" },
        { sequence_index: 32, actor: "student", quote: "The hiring score could keep measuring reading skill instead of job skill. We need to compare it with relevant job performance." }
      ], rationale: "The student's first response combines ideas already supplied by the tutor. The private application and resolution claims exceed recognition after help." }] : []
  });
}
const rejectedReview = reviewFor(inputFor(bad), true);
// Exact numeric/status extraction from the preserved synthetic V27 probe. This
// contains no provider identifiers, encrypted reasoning, headers or credentials.
const priorIncomplete = {
  source_path: ".data/luna-conversation-repair-2026-10-13/attempts/repair-replay-v27-probe-01/result.json",
  source_sha256: "eeeb00fcb0853048dc594e7baa1a5e1af2a1962b0fae7c12a7f7d780e691df8d",
  output_text_sha256: "23b4c6a927c00c9a21b25032b77c4e5b520352e4cf06000713e9c88a2716a262",
  output_text_utf8_bytes: 7352,
  status: "incomplete" as const, incomplete_reason: "max_output_tokens",
  usage: { input_tokens: 8549, output_tokens: 2500, total_tokens: 11049, reasoning_tokens: 1034, cached_input_tokens: 0 }
};
type PrivateFinding = Extract<ConversationDeliveryReview["findings"][number], { targets: unknown }>;
const firstPrivate = rejectedReview.findings[0] as PrivateFinding;
function allUnsupportedReview(): ConversationDeliveryReview {
  const anchors = [
    ["evidence_observations[0]", "supported_application_near_transfer"],
    ["profile_transition_recommendation", "largely_improved_understanding"],
    ["profile_transition_recommendation.updated_profile.ability_profile", "partial_understanding"],
    ["profile_transition_recommendation.updated_profile.integrated_profile_rationale", "The student now distinguishes stable scores"],
    ["profile_transition_recommendation.updated_profile.rationale", "meaningful improvement"],
    ["profile_transition_recommendation.misconception_claim_dispositions[0]", "resolved"]
  ];
  return ConversationDeliveryReviewSchema.parse({ ...reviewFor(inputFor(bad)), verdict: "reject",
    private_learning_audit: projection.blocks.map(block => ({ block_id: block.block_id, assessment: "unsupported",
      check: "Learning upgrades exceed this assisted restatement; the retained SEM difficulty is supported." })),
    findings: [{ kind: "unsupported_learning_claim", targets: anchors.map(([claim_path, claim_quote]) => ({
      learning_block_id: projection.blocks.find(block => block.claim_paths.includes(claim_path))!.block_id, claim_path, claim_quote })),
    source_refs: firstPrivate.source_refs, rationale: "The same assisted restatement supports recognition, not these application, improvement and resolution claims. Each target anchors the defect in its fully audited block." }]
  });
}
const groupedRejection = allUnsupportedReview();
check("fixture retains exact first-use failure and separately labels both authored positive controls", () => {
  assert.equal(fixture.synthetic_only, true); assert.equal(fixture.real_student_records_used, false);
  assert.equal(fixture.call_index_zero_based, 9);
  assert.equal(fixture.source.sha256, "d87531d4a51e8c556b1aee09276a4f60cd59ccf543630814e4cc07067a4a30fd");
  assert.deepEqual(bad.context, fixture.context); assert.deepEqual(bad.candidate, fixture.output);
  assert.equal(bad.authored_synthetic, false); assert(recognition.authored_synthetic && novel.authored_synthetic);
  assert.equal(bad.context.assistance_history!.observations.length, 0);
  assert.equal(bad.candidate.profile_transition_recommendation!.proposed_outcome, "largely_improved_understanding");
  assert.equal(bad.candidate.profile_transition_recommendation!.misconception_claim_dispositions[0].disposition, "resolved");
});
check("all controls satisfy canonical contracts before the independent semantic review", () => {
  for (const control of fixture.controls) {
    FormativeConversationV18R2AgentInputSchema.parse(control.context);
    FormativeConversationV18R2AgentOutputSchema.parse(control.candidate);
    const validation = validateFormativeInterpretation({ context: control.context, candidate: control.candidate });
    assert.equal(validation.valid, true, JSON.stringify(validation.validation_issue_paths));
  }
});
check("bounded blocks cover all exact observation and actual changed-profile assertions without truncation", () => {
  assert.equal(projection.version, CONVERSATION_PRIVATE_LEARNING_REVIEW_VERSION);
  assert.equal(projection.blocks.length, PRIVATE_LEARNING_REVIEW_MAX_BLOCKS);
  assert.equal(projection.claim_count, 18); assert.equal(claims(projection).length, 18);
  assert.deepEqual(projection.blocks.flatMap(block => block.claim_paths), claims(projection).map(claim => claim.path));
  for (const block of projection.blocks) assert.equal(block.sha256, hashText(block.text));
  assert.equal(projection.candidate_sha256, privateLearningHash(bad.candidate));
  assert.deepEqual(claims(projection).find(claim => claim.path === "evidence_observations[0]")!.value, bad.candidate.evidence_observations[0]);
  assert(claims(projection).some(claim => claim.path === "profile_transition_recommendation.updated_profile.ability_profile"));
  assert(claims(projection).some(claim => claim.path.endsWith("misconception_claim_dispositions[0]")));
});
check("actual profile values determine change coverage even if a model labels a changed field retained", () => {
  const candidate = structuredClone(bad.candidate);
  candidate.profile_transition_recommendation!.field_evidence.find(entry => entry.profile_fields.includes("ability_profile"))!.disposition = "retained_evidence_remains_valid";
  assert(claims(buildConversationPrivateLearningReview(bad.context, candidate)).some(claim => claim.path.endsWith("updated_profile.ability_profile")));
  candidate.profile_transition_recommendation!.updated_profile!.ability_profile = bad.context.current_profile.canonical_profile!.ability_profile;
  candidate.profile_transition_recommendation!.field_evidence.find(entry => entry.profile_fields.includes("ability_profile"))!.disposition = "updated_from_conversation_evidence";
  assert(!claims(buildConversationPrivateLearningReview(bad.context, candidate)).some(claim => claim.path.endsWith("updated_profile.ability_profile")));
});
check("candidate binding ignores JSONB object ordering but preserves changed values and array order", () => {
  const reversed = JSON.parse(JSON.stringify(bad.candidate), (_key, value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).reverse()) : value) as Candidate;
  assert.equal(privateLearningHash(reversed), privateLearningHash(bad.candidate));
  const changed = structuredClone(bad.candidate); changed.evidence_observations[0].observation += " Changed claim.";
  assert.notEqual(buildConversationPrivateLearningReview(bad.context, changed).candidate_sha256, projection.candidate_sha256);
  changed.evidence_observations.reverse(); assert.notEqual(privateLearningHash(changed), privateLearningHash(bad.candidate));
});
check("review input excludes prior profile values, scoring keys and private guidance while preserving student reasoning", () => {
  const context = structuredClone(bad.context);
  context.current_profile.canonical_profile!.rationale = "PRIVATE_PRIOR_SENTINEL";
  context.initial_profile.canonical_profile!.rationale = "PRIVATE_INITIAL_SENTINEL";
  context.teacher_guidance = ["PRIVATE_GUIDANCE_SENTINEL"];
  context.administered_items[0].correct_answer = "PRIVATE_KEY_SENTINEL";
  context.allowed_misconception_claim_catalog.indicators[0].claims[0].claim_text = "PRIVATE_CATALOG_SENTINEL";
  const input = buildConversationDeliveryReviewInput(context, bad.candidate.student_visible_message, bad.candidate);
  assert(!JSON.stringify(input).includes("PRIVATE_"));
  assert.deepEqual(input.initial_student_reasoning.map(item => item.written_reasoning), context.assessment_response_evidence.map(item => item.written_reasoning));
  assert(!Object.hasOwn(input, "current_profile")); assert(!Object.hasOwn(input, "administered_items"));
});
check("unreadable assessment answer sources retain identity but expose neither answer nor correctness", () => {
  const candidate = structuredClone(recognition.candidate);
  const answer = recognition.context.allowed_evidence_catalog.evidence.find(entry => entry.evidence_kind === "assessment_answer")!;
  candidate.evidence_observations = [{ evidence_type: "evidence_limitation", observation: "Assessment answer source is outside this review scope.", evidence_ids: [answer.evidence_id] }];
  const projected = buildConversationPrivateLearningReview(recognition.context, candidate);
  assert.deepEqual(projected.source_bindings[0], { evidence_id: answer.evidence_id, evidence_kind: answer.evidence_kind,
    eligibility: answer.eligibility, source_kind: "outside_review_scope", sequence_index: null, item_public_id: null, content: null });
  assert(!JSON.stringify(projected).includes(answer.content));
});
for (const fault of ["missing", "duplicate", "wrong_role", "wrong_scope", "wrong_text", "duplicate_turn"] as const) {
  check(`source binding rejects ${fault} instead of inventing a readable learning source`, () => {
    const context = structuredClone(bad.context), id = bad.candidate.evidence_observations[0].evidence_ids[0];
    const entry = context.allowed_evidence_catalog.evidence.find(item => item.evidence_id === id)!;
    if (fault === "missing") context.allowed_evidence_catalog.evidence = context.allowed_evidence_catalog.evidence.filter(item => item !== entry);
    if (fault === "duplicate") context.allowed_evidence_catalog.evidence.push(structuredClone(entry));
    if (fault === "wrong_role") entry.source_role = "tutor";
    if (fault === "wrong_scope") entry.conversation_public_id = "different-conversation";
    if (fault === "wrong_text") entry.content += " altered";
    if (fault === "duplicate_turn") context.visible_transcript.push(structuredClone(context.visible_transcript.at(-1)!));
    assert.throws(() => buildConversationPrivateLearningReview(context, bad.candidate), /private_learning_review\./);
  });
}
check("claim and byte limits reject overflow instead of silently omitting late assertions", () => {
  const tooMany = structuredClone(recognition.candidate);
  tooMany.evidence_observations = Array.from({ length: PRIVATE_LEARNING_REVIEW_MAX_CLAIMS + 1 }, () => structuredClone(tooMany.evidence_observations[0]));
  assert.throws(() => buildConversationPrivateLearningReview(recognition.context, tooMany), /claim_limit/);
  const tooLong = structuredClone(recognition.candidate);
  tooLong.evidence_observations = Array.from({ length: 200 }, () => ({ ...tooLong.evidence_observations[0], observation: "Exact assertion. ".repeat(100) }));
  assert.throws(() => buildConversationPrivateLearningReview(recognition.context, tooLong), /byte_limit/);
});
check("exact first-use restatement is rejectable with grounded private findings despite visible-content pass", () => {
  const checked = validateConversationDeliveryReview(rejectedReview, bad.context, bad.candidate.student_visible_message, bad.candidate);
  assert.equal(checked.valid, true, JSON.stringify(checked.validation_issue_paths)); assert.equal(checked.accepted, false);
  assert(rejectedReview.teaching_block_audit.every(item => item.assessment === "supported"));
});
check("one shared cause covers all six unsupported blocks without duplicating source quotes or dropping input claims", () => {
  const checked = validateConversationDeliveryReview(groupedRejection, bad.context, bad.candidate.student_visible_message, bad.candidate);
  assert.equal(checked.valid, true, JSON.stringify(checked.validation_issue_paths)); assert.equal(checked.accepted, false);
  assert.equal(groupedRejection.findings.length, 1);
  const finding = groupedRejection.findings[0]; assert("targets" in finding);
  assert.equal(finding.targets.length, 6); assert.equal(new Set(finding.targets.map(target => target.learning_block_id)).size, 6);
  assert.equal(projection.claim_count, 18); assert.equal(inputFor(bad).proposed_learning_claims.claim_count, 18);
  assert(Buffer.byteLength(JSON.stringify(groupedRejection), "utf8") < priorIncomplete.output_text_utf8_bytes);
  // Byte reduction is observed for this authored compact response, not a token
  // guarantee: variable reasoning still shares the provider's output cap.
});
check("distinct unsupported causes can keep separate source-grounded groups", () => {
  const candidate = structuredClone(recognition.candidate);
  candidate.evidence_observations = [
    { evidence_type: "misconception_claim_resolution", observation: "The student has corrected the SEM subtraction misconception.", evidence_ids: bad.candidate.evidence_observations[0].evidence_ids },
    { evidence_type: "supported_application_near_transfer", observation: "The student independently invented the reading-skill explanation without tutor assistance.", evidence_ids: bad.candidate.evidence_observations[0].evidence_ids }
  ];
  const input = buildConversationDeliveryReviewInput(bad.context, candidate.student_visible_message, candidate);
  const review = ConversationDeliveryReviewSchema.parse({ ...reviewFor(input), verdict: "reject",
    private_learning_audit: input.proposed_learning_claims.blocks.map(block => ({ block_id: block.block_id, assessment: "unsupported", check: "The proposed learning claim conflicts with the actual source and assistance history." })),
    findings: [
      { kind: "unsupported_learning_claim", targets: [{ learning_block_id: 1, claim_path: "evidence_observations[0]", claim_quote: "corrected the SEM subtraction misconception" }],
        source_refs: [{ sequence_index: 32, actor: "student", quote: "But I still think subtracting SEM gives the exact true score." }], rationale: "The student explicitly retains this error; this is a contradiction, not merely uncertain independence." },
      { kind: "unsupported_learning_claim", targets: [{ learning_block_id: 2, claim_path: "evidence_observations[1]", claim_quote: "independently invented" }],
        source_refs: firstPrivate.source_refs, rationale: "The reading-skill explanation was already supplied by the tutor, so its independent invention is unsupported." }
    ] });
  assert.equal(validateConversationDeliveryReview(review, bad.context, candidate.student_visible_message, candidate).valid, true);
  assert.equal(review.findings.length, 2);
});
for (const fault of ["missing_target", "duplicate_target", "duplicate_block_other_claim", "target_on_supported_block", "duplicate_group", "duplicate_source"] as const) {
  check(`grouped finding rejects ${fault} while retaining full private audit coverage`, () => {
    const review = structuredClone(groupedRejection), finding = review.findings[0]; assert("targets" in finding);
    if (fault === "missing_target") finding.targets.pop();
    if (fault === "duplicate_target") finding.targets[5] = structuredClone(finding.targets[0]);
    if (fault === "duplicate_block_other_claim") finding.targets[5] = { learning_block_id: 1, claim_path: "evidence_observations[1]", claim_quote: "supporting resolution" };
    if (fault === "target_on_supported_block") review.private_learning_audit[0].assessment = "supported";
    if (fault === "duplicate_group") review.findings.push(structuredClone(finding));
    if (fault === "duplicate_source") finding.source_refs[1] = structuredClone(finding.source_refs[0]);
    assert.equal(validateConversationDeliveryReview(review, bad.context, bad.candidate.student_visible_message, bad.candidate).valid, false);
  });
}
check("compact schema enforces quote/check/rationale and global target bounds without accepting old V7 shape", () => {
  for (const mutate of [
    (r: ConversationDeliveryReview) => { (r.findings[0] as PrivateFinding).targets[0].claim_quote = "x".repeat(97); },
    (r: ConversationDeliveryReview) => { (r.findings[0] as PrivateFinding).source_refs[0].quote = "x".repeat(161); },
    (r: ConversationDeliveryReview) => { r.private_learning_audit[0].check = "x".repeat(121); },
    (r: ConversationDeliveryReview) => { r.findings[0].rationale = "x".repeat(241); },
    (r: ConversationDeliveryReview) => { (r.findings[0] as PrivateFinding).source_refs.push(structuredClone(firstPrivate.source_refs[0])); }
  ]) { const review = structuredClone(groupedRejection); mutate(review); assert.equal(ConversationDeliveryReviewSchema.safeParse(review).success, false); }
  const legacy = { ...structuredClone(rejectedReview), version: "conversation-delivery-review-v7", findings: [{
    kind: "unsupported_learning_claim", ...firstPrivate.targets[0], source_refs: firstPrivate.source_refs, rationale: firstPrivate.rationale }] };
  assert.equal(ConversationDeliveryReviewV7Schema.safeParse(legacy).success, true);
  assert.equal(ConversationDeliveryReviewSchema.safeParse(legacy).success, false);
});
for (const control of [recognition, novel]) check(`authored ${control.id} accepts without banning support or requiring another student task`, () => {
  const review = reviewFor(inputFor(control));
  assert.equal(validateConversationDeliveryReview(review, control.context, control.candidate.student_visible_message, control.candidate).accepted, true);
  if (control === recognition) { assert.equal(control.candidate.profile_transition_recommendation, null); assert.deepEqual(control.context, bad.context); }
  else {
    assert.notEqual(control.context.latest_student_message, bad.context.latest_student_message);
    const id = control.candidate.evidence_observations[0].evidence_ids[0];
    assert.equal(control.context.allowed_evidence_catalog.evidence.find(entry => entry.evidence_id === id)!.content, control.context.latest_student_message);
    assert(!control.context.visible_transcript.slice(0, -1).some(turn => turn.message_text.includes("supervisors see the test results")));
  }
});
for (const fault of ["omitted_audit", "duplicate_audit", "reordered_audit", "wrong_path", "wrong_quote", "wrong_block", "wrong_source"] as const) {
  check(`private review rejects ${fault} without accepting a partial or misbound judgment`, () => {
    const review = structuredClone(rejectedReview);
    const finding = review.findings[0]; assert("targets" in finding); const target = finding.targets[0];
    if (fault === "omitted_audit") review.private_learning_audit.pop();
    if (fault === "duplicate_audit") review.private_learning_audit[1] = structuredClone(review.private_learning_audit[0]);
    if (fault === "reordered_audit") review.private_learning_audit.reverse();
    if (fault === "wrong_path") target.claim_path = "profile_transition_recommendation.updated_profile.engagement_profile";
    if (fault === "wrong_quote") target.claim_quote = "This assertion was never proposed.";
    if (fault === "wrong_block") target.learning_block_id = 6;
    if (fault === "wrong_source") finding.source_refs[0].quote = "The tutor never supplied this wording.";
    assert.equal(validateConversationDeliveryReview(review, bad.context, bad.candidate.student_visible_message, bad.candidate).valid, false);
  });
}
const base = (context: Context): StructuredAgentRequest<Context, unknown> => ({
  agent_name: "formative_conversation_agent", model_config: { model_name: "gpt-5.6-luna", reasoning_effort: "medium", max_output_tokens: 7000 },
  instructions: "Authored offline private-learning executor control.", input: context,
  output_schema: FormativeConversationV18R2AgentOutputSchema, schema_name: context.contract_version,
  client_request_id: "offline-private-learning", timeout_ms: 120_000, metadata: { synthetic_test: "true" }
});
check("production child request carries unchanged candidate claims with explicit4000 output headroom", () => {
  const request = buildFormativeConversationDeliveryReviewRequest({ base_request: base(bad.context), draft: bad.candidate.student_visible_message, candidate: bad.candidate, sequence: 1,
    delivery_review_config: { policy_version: "formative-conversation-sol-review-policy-v1", model_config: { model_name: "gpt-6.1-sol", reasoning_effort: "medium", max_output_tokens: 4000 } } });
  const body = compileProductionStructuredAgentRequest(request);
  assert.equal(body.max_output_tokens, 4000); assert.deepEqual(request.input, inputFor(bad));
  assert.equal(request.model_config.model_name, "gpt-6.1-sol"); assert.equal(request.model_config.reasoning_effort, "medium");
  const compiled = zodTextFormat(ConversationDeliveryReviewSchema, CONVERSATION_DELIVERY_REVIEW_VERSION).schema;
  const compiledValidator = new Ajv({ allErrors: true }).compile(compiled);
  assert(compiledValidator(rejectedReview)); assert(compiledValidator(groupedRejection));
  const oversized = structuredClone(groupedRejection); (oversized.findings[0] as PrivateFinding).targets[0].claim_quote = "x".repeat(97);
  assert.equal(compiledValidator(oversized), false);
  assert.throws(() => buildConversationDeliveryReviewInput(bad.context, "Different visible draft", bad.candidate), /candidate_draft_mismatch/);
});

async function execute(context: Context, candidates: Candidate[], verdicts: boolean[], tamperHash = false,
  reviewBoundaryOnly = false, options: { groupedFirst?: boolean; incompleteFirst?: boolean } = {}) {
  const tutorRequests: StructuredAgentRequest<unknown, unknown>[] = [], reviewRequests: StructuredAgentRequest<unknown, unknown>[] = [];
  const persisted: Candidate[] = [];
  try {
    const requestBase = reviewBoundaryOnly ? base(context) : { ...base(context),
      output_schema: FormativeConversationPlannedProposalOutputSchema, schema_name: FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION };
    const result = await executeFormativeConversationV18R2({ base_request: requestBase,
      validate_candidate(candidate) {
        // Only the opening defense-in-depth control injects prior acceptance:
        // the real candidate validator already forbids opening observations.
        if (reviewBoundaryOnly) return { valid: true, validation_status: "valid", validation_issue_paths: [] };
        const value = validateFormativeInterpretation({ candidate, context });
        return { valid: value.valid, validation_status: value.validation_status, validation_issue_paths: value.validation_issue_paths };
      },
      async execute_logical_generation({ request, sequence }) {
        tutorRequests.push(request); assert(candidates[sequence - 1], "No third tutor generation is allowed");
        const candidate = candidates[sequence - 1];
        const wire = FormativeConversationPlannedProposalOutputSchema.parse(structuredClone(fixture.original_wire));
        if (!reviewBoundaryOnly && candidate.profile_transition_recommendation === null) {
          wire.outcome = candidate.outcome; wire.profile_transition_recommendation = null;
          wire.student_visible_message = candidate.student_visible_message;
          wire.evidence_observations = structuredClone(candidate.evidence_observations);
          wire.post_reply_review.closure.rationale = candidate.conversation_review!.closure.rationale;
        } else if (!reviewBoundaryOnly) assert.deepEqual(candidate, bad.candidate, "This exact native wire is bound only to the retained negative candidate");
        const rawCandidate = reviewBoundaryOnly ? candidate : wire;
        const raw: StructuredAgentResult<unknown> = { provider: "openai", status: "completed", client_request_id: request.client_request_id,
          provider_response_id: `private-tutor-${sequence}`, parsed_output: structuredClone(rawCandidate),
          raw_output: { output_text: JSON.stringify(rawCandidate) }, usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }, latency_ms: 10 };
        const result = reviewBoundaryOnly ? raw : prepareFormativeProfileProposalResult(prepareConversationPlanResult(raw, context), context);
        return createSingleAttemptFormativeConversationV18R2Execution({ request, result, logical_call_id: `private-tutor-${sequence}` });
      },
      async execute_delivery_review({ request, sequence }) {
        assert.equal(persisted.length, 0, "No candidate may be persisted before review"); reviewRequests.push(request);
        const output = options.groupedFirst && sequence === 1 ? groupedRejection
          : reviewFor(request.input as ConversationDeliveryReviewInput, verdicts[sequence - 1]);
        const result: StructuredAgentResult<unknown> = options.incompleteFirst && sequence === 1
          ? { provider: "openai", status: priorIncomplete.status, incomplete_reason: priorIncomplete.incomplete_reason,
            client_request_id: request.client_request_id, provider_response_id: `private-review-${sequence}`,
            raw_output: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
            usage: structuredClone(priorIncomplete.usage), latency_ms: 45306 }
          : { provider: "openai", status: "completed", client_request_id: request.client_request_id,
            provider_response_id: `private-review-${sequence}`, parsed_output: output, raw_output: { output_text: JSON.stringify(output) },
            usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 }, latency_ms: 3 };
        const execution = createSingleAttemptFormativeConversationV18R2Execution({ request, result, logical_call_id: `private-review-${sequence}` });
        if (tamperHash) execution.canonical_request_hash = "0".repeat(64);
        return execution;
      }
    });
    persisted.push(result.result.parsed_output);
    return { result, error: null, persisted, tutorRequests, reviewRequests };
  } catch (error) { return { result: null, error, persisted, tutorRequests, reviewRequests }; }
}
async function main() {
  const repaired = await execute(bad.context, [bad.candidate, recognition.candidate], [true, false], false, false, { groupedFirst: true });
  check("private claim rejection precedes persistence and uses the same single tutor repair plus fresh review", () => {
    assert(repaired.result, String(repaired.error)); assert.equal(repaired.tutorRequests.length, 2); assert.equal(repaired.reviewRequests.length, 2);
    assert.equal(repaired.result.audit.semantic_regeneration_calls, 1); assert.equal(repaired.result.total_tokens, 360);
    assert.deepEqual(repaired.persisted, [recognition.candidate]);
    assert.equal(repaired.result.audit.attempts[0].pre_delivery_review!.status, "rejected");
    assert.equal(repaired.result.audit.attempts[1].pre_delivery_review!.status, "passed");
    const first = repaired.reviewRequests[0].input as ConversationDeliveryReviewInput;
    const second = repaired.reviewRequests[1].input as ConversationDeliveryReviewInput;
    assert.notEqual(first.proposed_learning_claims.candidate_sha256, second.proposed_learning_claims.candidate_sha256);
    assert.deepEqual(second, inputFor(recognition));
    assert(JSON.stringify(repaired.tutorRequests[1].input).includes("supported_application_near_transfer"));
    assert(JSON.stringify(repaired.tutorRequests[1].input).includes("claim_path"));
    assert(JSON.stringify(repaired.tutorRequests[1].input).includes("targets"));
    assert(JSON.stringify(repaired.tutorRequests[1].input).includes("profile_transition_recommendation.misconception_claim_dispositions[0]"));
  });
  const incomplete = await execute(bad.context, [bad.candidate], [true], false, false, { incompleteFirst: true });
  check("actual V27 incomplete output outcome fails closed without a new retry and retains all known usage", () => {
    assert(incomplete.error instanceof FormativeConversationV18R2ExecutionError);
    assert.equal(incomplete.persisted.length, 0); assert.equal(incomplete.tutorRequests.length, 1); assert.equal(incomplete.reviewRequests.length, 1);
    const review = incomplete.error.audit.attempts[0].pre_delivery_review!;
    assert.equal(review.status, "unreliable"); assert.equal(review.result_status, "incomplete");
    assert(review.validation_issue_paths.includes("conversation_delivery_review.incomplete"));
    assert.equal(review.parsed_output, null); assert.equal(review.total_tokens, priorIncomplete.usage.total_tokens);
    assert.equal(review.output_tokens, 2500); assert.equal(review.reasoning_tokens, 1034);
    assert.equal(incomplete.error.total_tokens, 11199); assert.equal(incomplete.error.audit.semantic_regeneration_calls, 0);
  });
  const exhausted = await execute(bad.context, [bad.candidate, bad.candidate], [true, true]);
  check("unchanged unsupported private claims fail after one repair and never become a persisted profile", () => {
    assert(exhausted.error instanceof FormativeConversationV18R2ExecutionError);
    assert.equal(exhausted.error.failure_category, "semantic_regeneration_exhausted");
    assert.equal(exhausted.tutorRequests.length, 2); assert.equal(exhausted.reviewRequests.length, 2);
    assert.equal(exhausted.persisted.length, 0); assert.equal(exhausted.error.total_tokens, 360);
  });
  const wrongHash = await execute(recognition.context, [recognition.candidate], [false], true);
  check("a forged review request hash cannot authorize persistence even with a passing review body", () => {
    assert(wrongHash.error instanceof FormativeConversationV18R2ExecutionError);
    assert.equal(wrongHash.persisted.length, 0); assert.equal(wrongHash.tutorRequests.length, 1);
    assert(wrongHash.error.audit.attempts[0].pre_delivery_review!.validation_issue_paths.includes("conversation_delivery_review.request_identity_mismatch"));
  });
  const openingContext = structuredClone(recognition.context);
  openingContext.visible_transcript = []; openingContext.latest_student_message = null;
  openingContext.formative_lifecycle.student_turn_index = 0;
  openingContext.telemetry_summary.observable_student_turn_count = 0;
  openingContext.telemetry_summary.observable_tutor_turn_count = 0;
  const openingCandidate = structuredClone(recognition.candidate);
  delete openingCandidate.conversation_review;
  const baseline = openingContext.allowed_evidence_catalog.evidence.find(item => item.evidence_kind === "assessment_reasoning")!;
  openingCandidate.evidence_observations = [{ evidence_type: "recognition_not_yet_observed", observation: "The initial student reasoning expresses a misconception; no new learning is demonstrated before dialogue.", evidence_ids: [baseline.evidence_id] }];
  openingCandidate.student_visible_message = "We can work through your initial reasoning together.";
  const openingValidation = validateFormativeInterpretation({ context: openingContext, candidate: openingCandidate });
  assert.equal(openingValidation.valid, false);
  assert(openingValidation.validation_issue_paths.includes("student_visible_message:opening_must_not_create_student_evidence"));
  const opening = await execute(openingContext, [openingCandidate], [false], false, true);
  check("opening observations remain structurally forbidden and cannot bypass review even with injected prior acceptance", () => {
    assert(opening.result, opening.error instanceof FormativeConversationV18R2ExecutionError ? JSON.stringify(opening.error.audit) : String(opening.error)); assert.equal(opening.reviewRequests.length, 1);
    assert.equal(opening.result.audit.attempts[0].pre_delivery_review!.status, "passed");
    assert.equal((opening.reviewRequests[0].input as ConversationDeliveryReviewInput).proposed_learning_claims.claim_count, 1);
  });
  check("source fixtures and canonical candidate bytes are unchanged by review and repair", () => {
    assert.deepEqual(readFileSync(fixturePath), bytes);
    assert.deepEqual(bad.candidate, fixture.output); assert.deepEqual(bad.context, fixture.context);
    assert.equal(privateLearningCanonicalJson(inputFor(bad).proposed_learning_claims), privateLearningCanonicalJson(projection));
  });
  console.log(`Private learning review checks passed: ${checks}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
