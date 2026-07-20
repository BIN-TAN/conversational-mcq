import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  analyzeE2A25HeldOutOverlap,
  buildE2A25FrozenProtocol,
  E2A24A_ALLOWED_STATUS,
  E2A24A_ARTIFACT_NAMES,
  executeE2A24A
} from "@/lib/evaluation/formative/e2a24a-autonomous-dialogue-live-readiness";
import { FORMATIVE_EVALUATION_SCENARIOS } from
  "@/lib/evaluation/formative/scenario-catalog";
import { evaluateE2A24Candidate } from
  "@/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate";

async function main() {
  const root = mkdtempSync(path.join(os.tmpdir(), "e2a24a-smoke-"));
  const e1Root = path.join(root, "e1");
  const artifactRoot = path.join(root, "artifacts");
  mkdirSync(e1Root, { recursive: true });
  writeFileSync(path.join(e1Root, "scenario-results.jsonl"),
    `${FORMATIVE_EVALUATION_SCENARIOS.map((scenario, index) => JSON.stringify({
      scenario_id: scenario.scenario_id,
      passed: true,
      failed_hard_invariants: [],
      failed_expectations: [],
      critical_invariant_failure_count: 0,
      major_invariant_failure_count: 0,
      seed: index + 1
    })).join("\n")}\n`, "utf8");
  const originalFetch = globalThis.fetch;
  let networkRequestCount = 0;
  globalThis.fetch = (async () => {
    networkRequestCount += 1;
    throw new Error("e2a24a_smoke_network_request_prohibited");
  }) as typeof fetch;
  try {
    const candidate = evaluateE2A24Candidate();
    assert.equal(candidate.candidate_configuration_hash,
      "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b");
    assert.equal(candidate.candidate_file_sha256,
      "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2");
    assert.equal(candidate.candidate_approved, false);
    assert.equal(candidate.candidate_activated, false);

    const protocol = buildE2A25FrozenProtocol();
    assert.equal(protocol.sessions.length, 3);
    assert.equal(protocol.execution_authorized, false);
    assert.equal(protocol.live_execution_performed, false);
    assert.equal(new Set(protocol.sessions.map((entry) =>
      entry.academic_domain
    )).size, 3);
    assert.ok(protocol.sessions.every((entry) =>
      1 + entry.maximum_student_turns * 2 === 17
    ));
    assert.equal(protocol.sessions[0]!.frozen_student_trajectory.at(-1)
      ?.tutor_expected, false);
    assert.equal(protocol.sessions[2]!.frozen_student_trajectory.at(-1)
      ?.tutor_expected, false);

    const overlap = analyzeE2A25HeldOutOverlap(protocol);
    assert.equal(overlap.passed, true);
    assert.equal(overlap.rejected_case_count, 0);

    const result = await executeE2A24A({
      root: artifactRoot,
      e1ArtifactRoot: e1Root
    });
    assert.equal(result.summary.status, E2A24A_ALLOWED_STATUS);
    assert.equal(result.summary.e1_positive_scenarios_passed, 12);
    assert.equal(result.summary.e1_unexpected_failure_count, 0);
    assert.equal(result.summary.maximum_visible_turns_per_session, 17);
    assert.equal(result.summary.expected_normal_logical_generation_calls, 27);
    assert.equal(result.summary.provider_call_count, 0);
    assert.equal(result.summary.network_request_count, 0);
    assert.equal(result.summary.e2a25_executed, false);
    assert.equal(result.summary.candidate_approved, false);
    assert.equal(result.summary.candidate_activated, false);
    assert.equal(result.validation.artifact_count, E2A24A_ARTIFACT_NAMES.length);
    assert.equal(result.validation.passed, true);
    assert.equal(networkRequestCount, 0);
    console.log(JSON.stringify({
      status: "passed",
      suite: process.argv.includes("--suite")
        ? process.argv[process.argv.indexOf("--suite") + 1]
        : "all",
      artifact_count: result.validation.artifact_count,
      held_out_planned_text_count: overlap.planned_text_count,
      provider_call_count: 0,
      network_request_count: networkRequestCount,
      e2a25_executed: false
    }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a24a_smoke_failed");
  process.exitCode = 1;
});
