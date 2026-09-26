import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [source, target, correctionSource] = process.argv.slice(2);
assert(source && target, "Provide a completed probe JSON and a new report directory");
assert(!existsSync(join(target, "live-results.json")), "Never overwrite prior live evidence");
const bytes = readFileSync(source);
const sha = value => createHash("sha256").update(value).digest("hex");
const original = JSON.parse(bytes);
const correctionBytes = correctionSource ? readFileSync(correctionSource) : null;
const correction = correctionBytes ? JSON.parse(correctionBytes) : null;
if (correction) {
  assert.equal(correction.corrected_projection_parent_sha256, sha(bytes));
  assert.equal(correction.cases_sha256, original.cases_sha256);
  assert.equal(correction.correction_kind, "persisted_profile_context_projection");
}
const report = { ...original,
  results: original.results.map(row => correction?.results.find(recheck => recheck.case_id === row.case_id && recheck.turn === row.turn) ?? row),
  http_requests_dispatched: original.http_requests_dispatched + (correction?.http_requests_dispatched ?? 0),
  provider_responses_completed: original.provider_responses_completed + (correction?.provider_responses_completed ?? 0),
  source_unchanged: original.source_unchanged && (!correction || correction.source_unchanged),
  derived_projection: { original_sha256: sha(bytes), correction_sha256: correctionBytes ? sha(correctionBytes) : null }
};
const allRows = [...original.results, ...(correction?.results ?? [])];
const checks = report.results.flatMap(row => row.checks ?? []);
const attempts = allRows.flatMap(row => row.attempts ?? []);
const latencies = report.results.map(row => (row.attempts ?? []).reduce((sum, attempt) => sum + attempt.latency_ms, 0)).sort((a, b) => a - b);
const summary = {
  version: "fresh-dialogue-report-v1", synthetic_only: true, actual_live_provider: true,
  production_data_changed: false, deployed: false, original_sha256: sha(bytes),
  correction_sha256: correctionBytes ? sha(correctionBytes) : null,
  accepted_executions_including_rechecks: allRows.filter(row => row.accepted).length,
  prompt_version: report.prompt_version, prompt_sha256: report.prompt_sha256, config: report.config,
  unique_scenarios: report.cases.length, tested_student_turns: report.results.length,
  expected_student_turns: report.cases.reduce((sum, scenario) => sum + scenario.messages.length, 0),
  accepted_turns: report.results.filter(row => row.accepted).length,
  http_requests_dispatched: report.http_requests_dispatched,
  provider_responses_completed: report.provider_responses_completed,
  mechanical_checks: checks.length, mechanical_checks_passed: checks.filter(check => check.pass).length,
  normalizations: attempts.filter(attempt => attempt.projection_applied).length,
  rejected_candidates: allRows.flatMap(row => (row.audit?.attempts ?? []).filter(attempt => !attempt.accepted).map(attempt => ({
    case_id: row.case_id, turn: row.turn, failure_class: attempt.failure_class, issues: attempt.invalid_candidate?.validation_issue_paths
  }))),
  source_unchanged_during_live_run: report.source_unchanged,
  latency_ms_including_regeneration: { min: latencies[0], median: (latencies[Math.floor((latencies.length - 1) / 2)] + latencies[Math.floor(latencies.length / 2)]) / 2, max: latencies.at(-1) },
  total_input_tokens: attempts.reduce((sum, attempt) => sum + (attempt.usage?.input_tokens ?? 0), 0),
  total_output_tokens: attempts.reduce((sum, attempt) => sum + (attempt.usage?.output_tokens ?? 0), 0),
  semantic_validity_certified: false, independent_human_review: "pending",
  scope: report.intended_scope,
  warning: "Prewritten synthetic student inputs; actual generated tutor messages. These checks are not a semantic accuracy rate, student learning trial, production load test, or live database run."
};
mkdirSync(target, { recursive: true });
writeFileSync(join(target, "live-results.json"), bytes);
if (correctionBytes) writeFileSync(join(target, "profile-projection-recheck.json"), correctionBytes);
writeFileSync(join(target, "final-results.json"), JSON.stringify(report, null, 2));
writeFileSync(join(target, "summary.json"), JSON.stringify(summary, null, 2));
const lines = ["# Fresh Synthetic Dialogues", "", summary.warning, "", `Prompt: ${report.prompt_version}; model: ${report.config.model_name}.`, ""];
for (const scenario of report.cases) {
  lines.push(`## ${scenario.id}`, "");
  for (const row of report.results.filter(row => row.case_id === scenario.id)) {
    lines.push(`### Turn ${row.turn}`, "", `**Expected:** ${row.expected}`, "", `**Scripted student:** ${row.context.latest_student_message}`, "", "**Actual AI reply:**", "", row.output?.student_visible_message ?? "No accepted output.", "");
    if (row.output) {
      const profile = row.output.profile_transition_recommendation?.updated_profile;
      lines.push(`**Outcome:** ${row.output.outcome}; lifecycle: ${row.output.lifecycle_recommendation}.`, "", "**Evidence observations:**",
        ...row.output.evidence_observations.map(entry => `- ${entry.evidence_type}: ${entry.observation}`), "");
      if (profile) lines.push(`**Ability:** ${profile.ability_profile}. **Confidence alignment:** ${profile.confidence_alignment} (prior value, not reassessed).`, "");
      lines.push("**Checks:**", ...row.checks.map(check => `- ${check.pass ? "PASS" : "FAIL"}: ${check.name}`), "");
    }
  }
}
writeFileSync(join(target, "READABLE_TRANSCRIPTS.md"), lines.join("\n"));
writeFileSync(join(target, "artifact-manifest.json"), JSON.stringify({ version: "sha256-v1", files: Object.fromEntries(
  ["live-results.json", "final-results.json", "summary.json", "READABLE_TRANSCRIPTS.md", ...(correctionBytes ? ["profile-projection-recheck.json"] : [])].map(name => [name, sha(readFileSync(join(target, name)))])
) }, null, 2));
console.log(JSON.stringify(summary, null, 2));
