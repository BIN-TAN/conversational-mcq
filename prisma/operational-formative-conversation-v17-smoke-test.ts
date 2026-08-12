import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  FORMATIVE_CONVERSATION_V5_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT
} from "../src/lib/operational/formative-conversation-v5-evaluation-v17/contracts";
import {
  exactFormativeConversationV17LiveAuthorization,
  loadFormativeConversationV17EvaluationPackage,
  packagePathsExist
} from "../src/lib/operational/formative-conversation-v5-evaluation-v17/package";

function readJson(filename: string) {
  return JSON.parse(
    readFileSync(
      path.join(FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT, filename),
      "utf8"
    )
  ) as Record<string, unknown>;
}

const originalFetch = globalThis.fetch;
let networkRequests = 0;
globalThis.fetch = (async () => {
  networkRequests += 1;
  throw new Error("network_forbidden");
}) as typeof fetch;

try {
  const loaded = loadFormativeConversationV17EvaluationPackage();
  const identity = readJson("candidate-identity.json");
  const candidate = readJson("candidate-manifest.json");
  const fixtureManifest = readJson("fixture-manifest.json");
  const authorization = readJson("live-execution-authorization.json");
  assert.equal(
    identity.pre_freeze_candidate_identity,
    "03c27761a59e45341cc76834450b19b89453004cece79325767dad6883660e23"
  );
  assert.equal(
    candidate.pre_freeze_candidate_identity,
    identity.pre_freeze_candidate_identity
  );
  assert.equal(packagePathsExist(), true);
  assert.equal(loaded.fixtures.length, 11);
  assert.equal(loaded.compiled_plan.cases.length, 11);
  assert.deepEqual(
    loaded.fixtures.map((fixture) => fixture.case_id),
    [...FORMATIVE_CONVERSATION_V5_CASE_ORDER]
  );
  assert.equal(
    loaded.fixtures.filter(
      (fixture) => fixture.case_type === "profiling_contract_canary"
    ).length,
    3
  );
  assert.equal(
    loaded.fixtures.filter(
      (fixture) => fixture.case_type === "formative_conversation"
    ).length,
    8
  );
  assert.equal(loaded.protocol.budget.base_profiling_call_count, 3);
  assert.equal(loaded.protocol.budget.base_formative_call_count, 21);
  assert.equal(loaded.protocol.budget.maximum_logical_call_count, 35);
  assert.equal(loaded.protocol.budget.maximum_provider_attempt_count, 105);
  assert.equal(candidate.live_execution_prepared, true);
  assert.equal(
    (candidate.approval as Record<string, unknown>).eligible,
    false
  );
  assert.equal(
    (candidate.activation as Record<string, unknown>).permitted,
    false
  );
  assert.equal(identity.approval_eligible, false);
  assert.equal(identity.activation_permitted, false);
  assert.equal(fixtureManifest.fixture_count, 11);
  assert.equal(
    authorization.exact_future_authorization_text,
    exactFormativeConversationV17LiveAuthorization(loaded)
  );
  assert.deepEqual(readdirSync(path.join(
    FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT,
    "fixtures"
  )).sort(), FORMATIVE_CONVERSATION_V5_CASE_ORDER.map((caseId) => `${caseId}.json`).sort());
  assert.equal(networkRequests, 0);
  console.log(JSON.stringify({
    status: "passed",
    runtime_candidate_hash: loaded.runtime_candidate_hash,
    protocol_hash: loaded.protocol_hash,
    runner_implementation_hash:
      loaded.protocol.runner_implementation_hash,
    fixture_manifest_hash: loaded.fixture_manifest_hash,
    aggregate_fixture_hash: loaded.aggregate_fixture_hash,
    compiled_plan_hash: loaded.compiled_plan.compiled_plan_hash,
    case_count: 11,
    profiling_canary_count: 3,
    formative_case_count: 8,
    live_execution_prepared: true,
    approval_eligible: false,
    activation_permitted: false,
    provider_calls: 0,
    model_auth_requests: 0,
    network_requests: 0,
    dispatch_checkpoints: 0
  }));
} finally {
  globalThis.fetch = originalFetch;
}
