import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  E2A27A_ARTIFACT_NAMES,
  E2A27A_STATUS,
  latestE2A27ARun,
  runE2A27A
} from "@/lib/evaluation/formative/e2a27a-contradiction-propagation";

type JsonRecord = Record<string, unknown>;

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readJsonl<T>(filePath: string): T[] {
  return readFileSync(filePath, "utf8").split(/\r?\n/u).filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function suiteArgument() {
  const index = process.argv.indexOf("--suite");
  return index >= 0 ? process.argv[index + 1] ?? "all" : "all";
}

function validateLatest(suite: string) {
  const latest = latestE2A27ARun();
  assert(latest, "e2a27a_artifact_run_missing");
  const file = (name: string) => path.join(latest.runDir, name);
  for (const name of E2A27A_ARTIFACT_NAMES) {
    assert(existsSync(file(name)), `e2a27a_artifact_missing:${name}`);
  }
  const summary = readJson<JsonRecord>(file("summary.json"));
  assert.equal(summary.status, E2A27A_STATUS);
  assert.equal(summary.provider_calls_made, 0);
  assert.equal(summary.network_requests_made, 0);
  assert.equal(summary.protected_evidence_unchanged, true);
  assert.equal(summary.candidate_integrity_passed, true);

  if (["all", "evaluator-v4", "mapper-v4", "profile-consistency",
    "contradiction-propagation", "pre-tutor-finalization",
    "tutor-dispatch-order", "replay"].includes(suite)) {
    const replay = readJson<{ turns: Array<JsonRecord> }>(
      file("e2a27-read-only-replay.json")
    );
    assert.equal(replay.turns.length, 4);
    const turn4 = replay.turns[3] as {
      corrected_evaluator_normalization: JsonRecord;
      corrected_profile: JsonRecord & {
        structured_contradictions?: Array<JsonRecord>;
      };
      corrected_platform_mode: string;
      corrected_tutor_dispatch_eligibility: boolean;
    };
    assert.equal(
      turn4.corrected_evaluator_normalization.observed_anchor_application,
      "explicit"
    );
    assert.equal(
      turn4.corrected_evaluator_normalization.observed_anchor_stance,
      "endorses_distractor"
    );
    assert.equal(turn4.corrected_profile.reasoning_quality, "partial");
    assert.equal(turn4.corrected_profile.revision_readiness, false);
    assert.equal(turn4.corrected_platform_mode, "remain_in_dialogue");
    assert.equal(turn4.corrected_tutor_dispatch_eligibility, true);
    assert((turn4.corrected_profile.contradictions as string[]).includes(
      "anchor_conclusion_conceptual_explanation_conflict"
    ));
    assert(turn4.corrected_profile.structured_contradictions?.some((entry) =>
      entry.contradiction_type ===
        "anchor_conclusion_conceptual_explanation_conflict" &&
      entry.blocking === true
    ));
  }
  if (["all", "calibration"].includes(suite)) {
    const corpus = readJsonl<JsonRecord>(file("calibration-corpus.jsonl"));
    const results = readJsonl<JsonRecord>(file("calibration-results.jsonl"));
    assert.equal(corpus.length, 144);
    assert.equal(results.length, 144);
    assert(results.every((entry) => entry.passed === true));
    assert.equal(summary.calibration_non_irt_case_count, 144);
  }
  if (["all", "failure-path"].includes(suite)) {
    const failure = readJson<{ required_fields: string[];
      future_policy_complete: boolean }>(
      file("failure-path-artifact-completeness.json")
    );
    assert.equal(failure.future_policy_complete, true);
    assert(failure.required_fields.includes("failure_stage"));
    assert(failure.required_fields.includes("suppression_reason"));
  }
  if (["all", "human-review-binding"].includes(suite)) {
    const binding = readJson<{ future_required_binding: string[];
      generated_but_not_displayed_tutor_outputs_included: boolean }>(
      file("derived-human-review-binding-audit.json")
    );
    assert(binding.future_required_binding.includes("prior visible conversation"));
    assert.equal(binding.generated_but_not_displayed_tutor_outputs_included,
      true);
  }
  if (["all", "burden"].includes(suite)) {
    const burden = readJson<Record<string, unknown>>(
      file("failed-session-burden-metrics.json")
    );
    assert.equal(burden.attempted_student_turns, 4);
    assert.equal(burden.completed_student_turns, 3);
    assert.equal(burden.generated_tutor_responses, 4);
    assert.equal(burden.effective_tutor_responses, 3);
    assert.equal(burden.burden_status, "partial");
    assert.equal(burden.completed_session_duration_ms, null);
    assert.notEqual(burden.total_visible_words_before_abort, 0);
  }
  if (["all", "approved-runtime"].includes(suite)) {
    const audit = readJson<JsonRecord>(
      file("approved-runtime-assertion-audit.json")
    );
    assert.equal(audit.protected_artifact_integrity_issue, false);
    assert.equal(audit.env_files_modified, false);
  }
  if (["all", "e2a28-protocol", "e2a28-budget"].includes(suite)) {
    const protocol = readJson<JsonRecord>(file("e2a28-frozen-protocol.json"));
    const budget = readJson<{ maximum: Record<string, number> }>(
      file("e2a28-budget.json")
    );
    assert.equal(protocol.authorization_state, "not_authorized_not_executed");
    assert.equal(protocol.provider_calls_made, 0);
    assert.equal(budget.maximum.logical_generation_calls, 29);
    assert.equal(budget.maximum.adapter_attempts, 87);
    assert.equal(budget.maximum.total_tokens, 970000);
    const overlap = readJson<JsonRecord>(
      file("e2a28-held-out-overlap-analysis.json")
    );
    assert.equal(overlap.exact_overlap_passed, true);
    assert.equal(overlap.normalized_overlap_passed, true);
    assert.equal(overlap.token_overlap_passed, true);
    assert.equal(overlap.structural_overlap_passed, true);
    assert.equal(overlap.semantic_overlap_passed, true);
  }
  if (["all", "identity", "candidate-integrity"].includes(suite)) {
    const identity = readJson<JsonRecord>(
      file("composite-runtime-identity.json")
    );
    const candidate = readJson<JsonRecord>(file("candidate-integrity.json"));
    assert.equal(typeof identity.composite_runtime_identity_hash, "string");
    assert.equal(candidate.unchanged, true);
  }
  return { suite, run_dir: latest.runDir, status: summary.status };
}

async function main() {
  const command = process.argv[2] ?? "smoke";
  if (command === "run") {
    const result = runE2A27A();
    console.log(JSON.stringify({
      status: result.summary.status,
      run_id: result.runId,
      run_dir: result.runDir,
      provider_calls_made: 0,
      network_requests_made: 0
    }, null, 2));
    return;
  }
  if (command === "report") {
    const latest = latestE2A27ARun();
    if (!latest) throw new Error("e2a27a_artifact_run_missing");
    console.log(JSON.stringify({
      run_dir: latest.runDir,
      summary: latest.summary
    }, null, 2));
    return;
  }
  if (command === "smoke") {
    console.log(JSON.stringify({ ...validateLatest(suiteArgument()),
      smoke_status: "passed", provider_calls_made: 0,
      network_requests_made: 0 }, null, 2));
    return;
  }
  throw new Error(`e2a27a_unknown_command:${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
