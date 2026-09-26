import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getPromptForAgent } from "../src/lib/agents/prompts/registry";
import {
  CurrentSemanticItemReviewSchema, SEMANTIC_ITEM_REVIEW_VERSION, SemanticItemReviewSchema,
  validateSemanticItemReviews, type SemanticItemReview
} from "../src/lib/services/student-assessment/semantic-item-review";
import { buildEvidenceIntegratedProfileBundle, EvidenceIntegratedProfileV2Schema, packageResultsForStudent } from "../src/lib/services/student-assessment/evidence-integrated-profile";

const payload = {
  included_items: [{ item_public_id: "stance-item", options: [
    { label: "A", text: "High alpha proves leadership validity." },
    { label: "B", text: "High alpha does not establish leadership validity." }
  ] }],
  item_responses: [{ item_public_id: "stance-item", selected_answer_final: "A", correctness: "incorrect",
    reasoning_text_final: "I agree with A's explanation.", tempting_option_reason: "B was tempting, but I am unsure.",
    confidence_final: "medium", correct_option_snapshot: "B", item_version_snapshot: 1 }]
};
const review: SemanticItemReview = {
  item_public_id: "stance-item", reasoning_judgment: "contradictory", reasoning_quote: payload.item_responses[0].reasoning_text_final,
  explanation: "The supplied false inference was explicitly adopted, not independently generated.",
  interpretation_version: SEMANTIC_ITEM_REVIEW_VERSION,
  interpretations: [{ interpretation_id: "belief-a", source_field: "reasoning",
    student_quote: payload.item_responses[0].reasoning_text_final, proposition: "High alpha proves leadership validity.",
    stance: "endorsed", basis: "supplied_explanation", correctness: "contradicted", scope: "specific_proposition",
    option_reference: { label: "A", quote: "High alpha proves leadership validity." }, rationale: "An explicit reference adopts this single explanation." }],
  misconceptions: [{ proposition: "High alpha proves leadership validity.", source_field: "reasoning",
    evidence_quote: payload.item_responses[0].reasoning_text_final, interpretation_id: "belief-a" }]
};
const startedAt = new Date().toISOString();
const checks: Array<{ id: string; rationale: string; expected: unknown; actual: unknown; passed: boolean }> = [];
function check(id: string, rationale: string, actual: unknown, expected: unknown) {
  checks.push({ id, rationale, expected, actual, passed: isDeepStrictEqual(actual, expected) });
}
const valid = (value = review, source: unknown = payload, requireCurrent = true) => validateSemanticItemReviews(source, [value], requireCurrent);
check("endorsed-error-valid", "A quoted student endorsement can support a linked option proposition without inventing a student quote.", valid().valid, true);
const mutations: Array<[string, string, (value: SemanticItemReview) => void]> = [
  ["rejected-not-error", "Rejection cannot support a current misconception.", value => { value.interpretations![0].stance = "rejected"; }],
  ["uncertain-not-error", "Uncertainty cannot support a current misconception.", value => { value.interpretations![0].stance = "uncertain"; }],
  ["quotation-not-error", "Quotation without endorsement cannot support a current misconception.", value => { value.interpretations![0].stance = "quoted"; }],
  ["compound-not-atomic", "Broad compound agreement cannot establish each constituent belief.", value => { value.interpretations![0].scope = "compound_unspecified"; }],
  ["correct-not-error", "A supported proposition cannot be a misconception.", value => { value.interpretations![0].correctness = "supported"; }],
  ["selection-not-error", "An answer-only observation is not reasoning evidence.", value => { value.interpretations![0].basis = "answer_only"; }],
  ["givens-not-error", "Restating supplied facts alone is not a conceptual misconception.", value => { value.interpretations![0].basis = "fact_restatement"; }],
  ["missing-option-ref", "Adopting a supplied explanation requires its source.", value => { value.interpretations![0].option_reference = null; }],
  ["wrong-option-ref", "The referenced label must exist in this sealed item.", value => { value.interpretations![0].option_reference!.label = "Z"; }],
  ["wrong-option-quote", "An existing label must also match its quoted content.", value => { value.interpretations![0].option_reference!.quote = "Other wording"; }],
  ["blank-option-quote", "Whitespace is not a source quote.", value => { value.interpretations![0].option_reference!.quote = " "; }],
  ["invented-student-quote", "Option wording cannot be substituted for the student's own words.", value => { value.interpretations![0].student_quote = "High alpha proves leadership validity."; }],
  ["wrong-student-field", "A reasoning observation must not be attributed to the tempting field.", value => { value.interpretations![0].source_field = "tempting_option_reason"; }],
  ["wrong-claim-link", "A claim must link to the actual supporting interpretation.", value => { value.misconceptions[0].interpretation_id = "missing"; }],
  ["rewritten-claim", "A linked claim must preserve the reviewed proposition.", value => { value.misconceptions[0].proposition = "Reliability never changes."; }],
  ["omitted-endorsed-error", "An eligible reviewed error must not vanish from coverage.", value => { value.misconceptions = []; }],
  ["duplicate-claim", "One observation must not inflate the misconception count.", value => { value.misconceptions.push(value.misconceptions[0]); }],
  ["duplicate-interpretation", "Ambiguous observation IDs cannot ground a claim.", value => { value.interpretations!.push(value.interpretations![0]); }],
  ["missing-new-metadata", "New live diagnostics must not silently revert to the old contract.", value => { delete value.interpretations; delete value.interpretation_version; }]
];
for (const [id, rationale, mutate] of mutations) {
  const value = structuredClone(review); mutate(value);
  check(id, rationale, valid(value).valid, false);
}
for (const stance of ["rejected", "uncertain", "quoted"] as const) {
  const value = structuredClone(review);
  value.interpretations![0].stance = stance;
  value.misconceptions = [];
  value.reasoning_judgment = "insufficient";
  check(`${stance}-observation-preserved`, "Non-endorsed propositions remain observations, not deleted evidence.", valid(value).reviews[0]?.interpretations?.[0].stance, stance);
}
const legacy = structuredClone(review);
delete legacy.interpretation_version; delete legacy.interpretations; delete legacy.misconceptions[0].interpretation_id;
check("legacy-readable", "Stored prior diagnostics remain readable without fabricated stance metadata.", valid(legacy, payload, false).valid, true);
check("legacy-not-new", "Historical readability is not permission to generate incomplete new records.", valid(legacy).valid, false);
const irrelevant = { ...review, reasoning_judgment: "irrelevant" as const, interpretations: [], misconceptions: [] };
check("no-invented-proposition-for-irrelevance", "Off-topic instructions need not be recast as beliefs about the assessed concept.", valid(irrelevant).valid, true);
check("substantive-review-needs-observation", "The irrelevant exception must not permit supported reasoning without an observation.", valid({ ...irrelevant, reasoning_judgment: "supported_concise" }).valid, false);
const legacyBundle = buildEvidenceIntegratedProfileBundle({ response_package_payload: payload, semantic_item_reviews: [legacy] });
check("legacy-version-honest", "A legacy diagnosis must not acquire the current interpretation version.", legacyBundle.profile.semantic_review_audit?.version, "semantic-item-review-legacy-or-unavailable");
check("cross-item-reference-rejected", "Options from a different item cannot ground the observation.", valid(review, { ...payload, included_items: [{ ...payload.included_items[0], item_public_id: "other" }] }).valid, false);
const otherVersion = structuredClone(payload);
otherVersion.included_items[0].options[0].text = "Corrected option from another version.";
check("changed-snapshot-rejected", "A changed option must not validate against the original reference.", valid(review, otherVersion).valid, false);

const positiveSource = structuredClone(payload);
positiveSource.item_responses[0].reasoning_text_final = "I agree with B's explanation.";
positiveSource.item_responses[0].selected_answer_final = "B";
positiveSource.item_responses[0].correctness = "correct";
const positive = structuredClone(review);
positive.reasoning_judgment = "supported_precise";
positive.reasoning_quote = positiveSource.item_responses[0].reasoning_text_final;
positive.explanation = "The supplied correct explanation was adopted; independent application remains unobserved.";
positive.misconceptions = [];
Object.assign(positive.interpretations![0], { student_quote: positive.reasoning_quote, correctness: "supported",
  proposition: positiveSource.included_items[0].options[1].text, option_reference: { label: "B", quote: positiveSource.included_items[0].options[1].text } });
const bundle = buildEvidenceIntegratedProfileBundle({ response_package_payload: positiveSource, semantic_item_reviews: [positive], source_agent_call_public_id: "synthetic-call" });
check("recognition-quality-cap", "The application must not upgrade supplied explanation endorsement to independently precise reasoning.", bundle.profile.item_evidence[0].reasoning_quality, "accurate_but_concise");
check("recognition-limit-retained", "Teachers/researchers need the distinction even when the answer is correct.", bundle.profile.item_evidence[0].evidence_limitations.includes("recognition_without_independent_explanation"), true);
check("recognition-not-strong", "Recognizing a supplied explanation is not strong independent explanatory evidence.", bundle.profile.item_evidence[0].evidence_sufficiency, "adequate");
const roundTrip = EvidenceIntegratedProfileV2Schema.parse(JSON.parse(JSON.stringify(bundle.profile)));
check("profile-roundtrip", "Versioned interpretations survive the persisted-profile JSON contract.", roundTrip.item_evidence[0].semantic_review, positive);
check("agent-source-link", "Review provenance is traceable to the generating call.", roundTrip.semantic_review_audit?.source_agent_call_id, "synthetic-call");
const visible = JSON.stringify(packageResultsForStudent(bundle.profile));
check("teacher-only-record", "Detailed interpretations and quoted option references are not projected into the student summary.", visible.includes("interpretation_id"), false);
check("strict-provider-schema", "The current structured-output schema must compile for the provider.",
  Boolean(zodTextFormat(z.object({ reviews: z.array(CurrentSemanticItemReviewSchema) }).strict(), "stance_test")), true);
check("legacy-schema-readable", "The legacy parser remains backward-compatible.", SemanticItemReviewSchema.safeParse(legacy).success, true);
const canonicalPrompt = getPromptForAgent("student_profiling_agent");
check("canonical-handoff-version", "The separate canonical profiling call must record the revised policy version too.", canonicalPrompt.prompt_version, "student-profiling-v6");
check("canonical-handoff-policy", "Verify policy wiring, not model semantic accuracy: the canonical handoff must receive stance and recognition limits.",
  canonicalPrompt.instructions.includes("current stance separately") && canonicalPrompt.instructions.includes("meaningful recognition evidence") &&
  canonicalPrompt.instructions.includes("compound option") && canonicalPrompt.instructions.includes("exact student wording"), true);

const directory = mkdtempSync(join(tmpdir(), "cmcq-stance-contract-"));
const files = ["prisma/stance-evidence-smoke-test.ts", "src/lib/services/student-assessment/semantic-item-review.ts", "src/lib/services/student-assessment/evidence-integrated-profile.ts", "src/lib/agents/prompts/student-profiling/v1.ts"];
const report = { version: "stance-contract-tests-v1", started_at: startedAt, completed_at: new Date().toISOString(),
  interpretation_version: SEMANTIC_ITEM_REVIEW_VERSION, synthetic_only: true,
  evidence_scope: "Mechanical provenance and consistency; does not test semantic correctness of model interpretations.",
  source_hashes: Object.fromEntries(files.map(file => [file, createHash("sha256").update(readFileSync(file)).digest("hex")])), checks };
writeFileSync(join(directory, "results.json"), JSON.stringify(report, null, 2));
console.log(`Stance contract: ${checks.filter(entry => entry.passed).length}/${checks.length}; record: ${directory}/results.json`);
assert(checks.every(entry => entry.passed), JSON.stringify(checks.filter(entry => !entry.passed), null, 2));
