import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  E2A15B_PROTOCOL_HASH,
  E2A15BSafeRefusalMockProvider,
  analyzeFrozenProtocolOverlap,
  cleanupTemporaryE2A15BArtifactRoot,
  executeE2A15BSupplement,
  inspectE2A15BPreflight,
  readFrozenE2A15BProtocol,
  resolveE2A15BBudget,
  temporaryE2A15BArtifactRoot,
  validateE2A15BArtifacts
} from "@/lib/evaluation/formative/e2a15b-protected-request-supplement";
import { E2A14_CANDIDATE_HASH } from
  "@/lib/evaluation/formative/e2a14-protected-request-validator-candidate";
import { sha256 } from
  "@/lib/evaluation/formative/e2a4-topic-dialogue-contract";

const suiteIndex = process.argv.indexOf("--suite");
const suite = suiteIndex >= 0 ? process.argv[suiteIndex + 1] : "all";

function staticChecks() {
  const frozen = readFrozenE2A15BProtocol();
  assert.equal(frozen.fileHash, E2A15B_PROTOCOL_HASH);
  assert.equal(frozen.protocol.candidate_hash, E2A14_CANDIDATE_HASH);
  assert.equal(frozen.protocol.cases.length, 2);
  assert.deepEqual(frozen.protocol.cases.map((entry) =>
    entry.required_category
  ).sort(), [
    "informal_or_grammatically_imperfect_protected_request",
    "long_history_refusal_and_distractor_continuity_stress"
  ].sort());
  const longHistory = frozen.protocol.cases.find((entry) =>
    entry.require_tenth_turn_context
  );
  assert(longHistory);
  assert.equal(longHistory.dialogue_input.visible_dialogue_history.length, 18);
  assert.equal(longHistory.dialogue_input.visible_dialogue_history.filter(
    (entry) => entry.actor_type === "student"
  ).length, 9);
  assert.equal(longHistory.dialogue_input.visible_dialogue_history.filter(
    (entry) => entry.actor_type === "agent"
  ).length, 9);
  const overlap = analyzeFrozenProtocolOverlap();
  assert.equal(overlap.all_cases_passed, true);
  assert.equal(overlap.exact_overlap_count, 0);
  assert(overlap.maximum_recorded_similarity < 0.8);
  const budget = resolveE2A15BBudget();
  assert.deepEqual(
    Object.fromEntries(Object.keys(frozen.protocol.budget).map((key) => [
      key,
      budget[key as keyof typeof budget]
    ])),
    frozen.protocol.budget
  );
  assert.equal(budget.maximum_cases, 2);
  assert.equal(budget.maximum_total_generation_calls, 4);
  assert.equal(budget.maximum_provider_adapter_attempts, 12);
  assert.equal(budget.provider_case_concurrency, 1);
  return frozen;
}

async function main() {
  const originalFetch = globalThis.fetch;
  let networkRequestCount = 0;
  globalThis.fetch = (async () => {
    networkRequestCount += 1;
    throw new Error("e2a15b_smoke_network_forbidden");
  }) as typeof fetch;
  try {
    const frozen = staticChecks();
    const preflight = await inspectE2A15BPreflight({
      requireLiveEnvironment: false,
      requireCleanTrackedTree: false
    });
    assert.equal(preflight.passed, true, preflight.blockers.join(","));
    assert.equal(preflight.network_request_count, 0);
    if (!["all", "artifact", "runtime"].includes(suite ?? "")) {
      console.log(JSON.stringify({
        status: "passed",
        suite,
        protocol_hash: E2A15B_PROTOCOL_HASH,
        candidate_hash: E2A14_CANDIDATE_HASH,
        case_count: frozen.protocol.cases.length,
        network_request_count: networkRequestCount
      }, null, 2));
      return;
    }
    const root = temporaryE2A15BArtifactRoot();
    const provider = new E2A15BSafeRefusalMockProvider();
    try {
      const result = await executeE2A15BSupplement({
        provider,
        live: false,
        artifactRoot: root
      });
      assert.equal(result.finalSummary.status, "e2a15b_no_live_smoke_pass");
      assert.equal(result.reviewValidation.review_item_count, 40);
      assert.equal(result.reviewValidation.passed, true);
      assert.equal(result.artifactValidation.passed, true);
      assert.equal(provider.requestCount, 2);
      const artifactValidation = validateE2A15BArtifacts(result.runDir);
      assert.equal(artifactValidation.passed, true);
      assert.equal(
        sha256(readFileSync(result.paths.frozenSupplementalProtocol)),
        frozen.sourceFileSha256
      );
    } finally {
      cleanupTemporaryE2A15BArtifactRoot(root);
    }
    assert.equal(networkRequestCount, 0);
    console.log(JSON.stringify({
      status: "passed",
      suite,
      protocol_hash: E2A15B_PROTOCOL_HASH,
      candidate_hash: E2A14_CANDIDATE_HASH,
      provider_mock_calls: provider.requestCount,
      review_item_count: 40,
      network_request_count: networkRequestCount,
      candidate_approved: false,
      candidate_activated: false
    }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
