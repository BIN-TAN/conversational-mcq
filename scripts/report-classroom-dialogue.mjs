import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [originalPath, correctionPath, preflightPath, target] = process.argv.slice(2);
assert(originalPath && correctionPath && preflightPath && target,
  "Usage: node scripts/report-classroom-dialogue.mjs original.json correction.json preflight.json output-directory");
const bytes = [originalPath, correctionPath, preflightPath].map(path => readFileSync(path));
const [original, correction] = bytes.slice(0, 2).map(value => JSON.parse(value));
const sha = value => createHash("sha256").update(value).digest("hex");
assert.equal(correction.corrected_projection_parent_sha256, sha(bytes[0]));
assert.equal(correction.cases_sha256, original.cases_sha256);
const finalRows = original.results.map(row => correction.results.find(recheck => recheck.case_id === row.case_id && recheck.turn === row.turn) ?? row);
assert.equal(finalRows.length, 12);
assert(finalRows.every(row => row.accepted && row.checks.every(check => check.pass)));
const attempts = [...original.results, ...correction.results].flatMap(row => row.attempts);
const latencies = finalRows.map(row => row.attempts.reduce((sum, attempt) => sum + attempt.latency_ms, 0)).sort((a, b) => a - b);
const summary = {
  version: "classroom-dialogue-report-v1", synthetic_only: true,
  unique_scenarios: original.cases.length, unique_student_turns: finalRows.length,
  provider_requests: original.http_requests_dispatched + correction.http_requests_dispatched,
  provider_responses_completed: original.provider_responses_completed + correction.provider_responses_completed,
  accepted_evaluation_executions_including_rechecks: original.results.length + correction.results.length,
  invalid_candidates_requiring_regeneration: [...original.results, ...correction.results].flatMap(row => row.audit.attempts).filter(attempt => !attempt.accepted).map(attempt => ({
    category: attempt.failure_class, paths: attempt.invalid_candidate?.validation_issue_paths
  })),
  final_mechanical_checks: finalRows.flatMap(row => row.checks).length,
  final_mechanical_checks_passed: finalRows.flatMap(row => row.checks).filter(check => check.pass).length,
  final_turn_latency_ms: { min: latencies[0], median: (latencies[5] + latencies[6]) / 2, max: latencies.at(-1) },
  total_input_tokens: attempts.reduce((sum, attempt) => sum + (attempt.usage?.input_tokens ?? 0), 0),
  total_output_tokens: attempts.reduce((sum, attempt) => sum + (attempt.usage?.output_tokens ?? 0), 0),
  production_data_changed: false, app_changes: false, deployed: false,
  semantic_validity_certified: false,
  review_warning: "Mechanical acceptance and non-independent developer content review are not independent pedagogical validation or evidence of learning gains.",
  final_rows: finalRows.map(row => ({ case_id: row.case_id, turn: row.turn,
    source_file: correction.results.includes(row) ? "projection-recheck.json" : "original-dialogues.json",
    outcome: row.output.outcome, lifecycle: row.output.lifecycle_recommendation,
    claim_dispositions: row.output.profile_transition_recommendation?.misconception_claim_dispositions ?? [] }))
};
mkdirSync(target, { recursive: true });
const names = ["original-dialogues.json", "projection-recheck.json", "harness-preflight-error.json"];
names.forEach((name, index) => writeFileSync(join(target, name), bytes[index]));
writeFileSync(join(target, "summary.json"), JSON.stringify(summary, null, 2));
const lines = ["# Synthetic Student Dialogue Transcripts", "",
  "Six scripted two-turn scenarios; actual AI tutor replies, not invented tutor examples. The opening and student messages are scripted. This is not a full website or database test.", "",
  "These transcripts use student_visible_message only, matching runtime persistence. Supplemental teaching_artifact fields are retained only in raw audit files, not inserted into the visible transcript. Two affected second turns were re-run with this correction; original results remain preserved.", "",
  "The evaluation reviewer is the coding assistant, not an independent instructor. See REVIEW.md for findings and limitations.", ""];
for (const scenario of original.cases) {
  lines.push(`## ${scenario.id}`, "", `**Scripted opening:** ${original.results.find(row => row.case_id === scenario.id).context.visible_transcript[0].message_text}`, "");
  for (const row of finalRows.filter(row => row.case_id === scenario.id)) {
    lines.push(`### Turn ${row.turn}`, "", `**Expected:** ${row.expected}`, "",
      `**Simulated student:** ${row.context.latest_student_message}`, "", "**Actual AI tutor:**", "", row.output.student_visible_message, "",
      `**Structured result:** ${row.output.outcome}; lifecycle recommendation: ${row.output.lifecycle_recommendation}.`, "",
      "**Evidence interpretation:**", ...row.output.evidence_observations.map(observation => `- ${observation.observation}`), "");
    const profile = row.output.profile_transition_recommendation;
    if (profile) lines.push("**Profile recommendation:**", `- Ability: ${profile.updated_profile.ability_profile}.`,
      `- Confidence alignment: ${profile.updated_profile.confidence_alignment}.`,
      `- Independence: ${profile.updated_profile.independence_interpretability}.`,
      ...profile.misconception_claim_dispositions.map(claim => `- ${claim.disposition}: ${claim.evidence_summary}`), "");
  }
}
writeFileSync(join(target, "READABLE_TRANSCRIPTS.md"), lines.join("\n"));
const generated = [...names, "summary.json", "READABLE_TRANSCRIPTS.md"];
writeFileSync(join(target, "artifact-manifest.json"), JSON.stringify({ version: "sha256-v1", files: Object.fromEntries(generated.map(name => [name, sha(readFileSync(join(target, name)))])) }, null, 2));
console.log(JSON.stringify(summary, null, 2));
