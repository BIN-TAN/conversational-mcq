import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkAssessmentQualityCase, type AssessmentQualityCase } from "../src/lib/evaluation/assessment-quality-cases";
import { ChatNativeLiveFormativeProfileOutputSchema, validateChatNativeProfileStudentOutput } from "../src/lib/services/student-assessment/formative-profile";
import { validateSemanticItemReviews } from "../src/lib/services/student-assessment/semantic-item-review";

const sourcePath = process.argv[2];
assert(sourcePath, "Provide a retained synthetic assessment-quality results.json file.");
const hash = (content: string) => createHash("sha256").update(content).digest("hex");
const sourceText = readFileSync(sourcePath, "utf8");
const source = JSON.parse(sourceText) as { version: string; cases_sha256: string; reference_standard: string;
  results: Array<{ repeat: number; status: string; output: unknown; checks: Array<{ case_id: string }> }> };
assert.equal(source.version, "assessment-quality-probe-v2");
assert.equal(source.reference_standard, "developer_proposed_not_expert_validated");
const references = JSON.parse(readFileSync(join(dirname(sourcePath), "reference-cases.json"), "utf8")) as AssessmentQualityCase[];
assert.equal(hash(JSON.stringify(references)), source.cases_sha256, "Do not revise expectations after seeing results.");
const results = source.results.map(round => {
  const cases = round.checks.map(check => {
    const entry = references.find(entry => entry.id === check.case_id);
    assert(entry, "Each result must match a retained case."); return entry;
  });
  const payload = {
    included_items: cases.map(entry => ({ item_public_id: entry.id,
      options: entry.options.map((text, index) => ({ label: String.fromCharCode(65 + index), text })) })),
    item_responses: cases.map(entry => ({ item_public_id: entry.id, reasoning_text_final: entry.reasoning,
      tempting_option_reason: entry.tempting_reason ?? null }))
  };
  const parsed = ChatNativeLiveFormativeProfileOutputSchema.safeParse(round.output);
  const validated = validateSemanticItemReviews(payload, parsed.success ? parsed.data.semantic_item_reviews : null, true);
  const visible = parsed.success ? validateChatNativeProfileStudentOutput({ output: parsed.data, correct_options: cases.map(entry => entry.correct) }) : null;
  return { repeat: round.repeat, provider_status: round.status, provenance_valid: validated.valid, validation_issues: validated.issues,
    student_output_valid: visible?.ok ?? false,
    checks: cases.map(entry => checkAssessmentQualityCase(entry, validated.reviews.find(review => review.item_public_id === entry.id))) };
});
const directory = mkdtempSync(join(tmpdir(), "cmcq-quality-replay-"));
const report = { version: "assessment-quality-replay-v1", replayed_at: new Date().toISOString(), provider_calls: 0,
  source_result_sha256: hash(sourceText), source_result_path: sourcePath,
  frozen_cases_sha256: source.cases_sha256,
  current_validation_sha256: hash(readFileSync("src/lib/services/student-assessment/semantic-item-review.ts", "utf8")),
  limitations: ["Revalidation of saved outputs, not fresh calls or independent replication.", "Developer-proposed expectations; independent content review remains pending."], results };
writeFileSync(join(directory, "results.json"), JSON.stringify(report, null, 2));
console.log(`Retained-output revalidation: ${results.flatMap(round => round.checks).filter(check => check.expectation_met).length}/${results.flatMap(round => round.checks).length}; ${directory}/results.json`);
assert(results.length === 4 && results.every(round => round.provider_status === "completed" && round.provenance_valid && round.student_output_valid && round.checks.every(check => check.expectation_met)));
