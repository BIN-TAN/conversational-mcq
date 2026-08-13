import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  buildFormativeConversationV18EvaluationPlan,
  exactFormativeConversationV18LiveAuthorization,
  loadFormativeConversationV18EvaluationPackage,
  packagePathsExist
} from "../src/lib/operational/formative-conversation-v5-evaluation-v18/package";
import { FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT } from "../src/lib/operational/formative-conversation-v5-evaluation-v18/contracts";

const originalFetch = globalThis.fetch;
let networkRequests = 0;
globalThis.fetch = (async () => {
  networkRequests += 1;
  throw new Error("network_forbidden");
}) as typeof fetch;

try {
  const loaded = loadFormativeConversationV18EvaluationPackage();
  assert.equal(packagePathsExist(), true);
  assert.equal(loaded.fixtures.length, 12);
  assert.equal(loaded.compiled_plan.cases.length, 12);
  assert.equal(
    loaded.compiled_plan.aggregate_call_graph.expected_base_call_count,
    28
  );
  assert.equal(
    loaded.compiled_plan.aggregate_call_graph.maximum_logical_call_count,
    56
  );
  assert.equal(
    loaded.compiled_plan.aggregate_call_graph.maximum_provider_attempt_count,
    168
  );
  assert.equal(
    loaded.authorization_package.exact_future_authorization_text,
    exactFormativeConversationV18LiveAuthorization(loaded)
  );
  const plan = buildFormativeConversationV18EvaluationPlan();
  assert.equal(plan.provider_calls, 0);
  assert.equal(plan.provider_auth_network_requests, 0);
  assert.equal(plan.dispatch_checkpoint.created, false);
  assert.equal(plan.approval_eligible, false);
  assert.equal(plan.activation_permitted, false);
  assert.equal(
    existsSync(
      path.resolve(
        FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
        "dispatch",
        `${loaded.protocol_hash}.json`
      )
    ),
    false
  );
  assert.equal(networkRequests, 0);
  console.log(
    JSON.stringify({
      status: "passed",
      case_count: 12,
      base_profiling_calls: 4,
      base_formative_calls: 24,
      logical_calls: 28,
      maximum_logical_calls: 56,
      maximum_provider_attempts: 168,
      provider_calls: 0,
      model_auth_requests: 0,
      network_requests: 0,
      dispatch_checkpoints: 0
    })
  );
} finally {
  globalThis.fetch = originalFetch;
}
