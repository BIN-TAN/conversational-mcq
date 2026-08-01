import assert from "node:assert/strict";
import {
  FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_AUTHORIZATION,
  FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH,
  compileFormativeConversationV9RemoteDatabaseCanaryPreflight
} from "../src/lib/operational/formative-conversation-v5-evaluation-v9/remote-database-canary";
import {
  buildFormativeConversationV5TestEnvironment
} from "./helpers/formative-conversation-v5-v9-test-environment";

function canaryEnvironment() {
  const env = buildFormativeConversationV5TestEnvironment({
    FORMATIVE_CONVERSATION_V5_V9_ENVIRONMENT_SOURCE: "deterministic_test",
    FORMATIVE_CONVERSATION_V5_V9_REMOTE_DATABASE_CANARY_ENABLED: "true",
    FORMATIVE_CONVERSATION_V5_V9_CANARY_SESSION_SECRET_SOURCE:
      "ephemeral_canary"
  });
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_API_KEY_FILE;
  env.FORMATIVE_CONVERSATION_V5_V9_INJECTED_ENVIRONMENT_KEYS =
    Object.entries(env)
      .filter(([, value]) => Boolean(value?.trim()))
      .map(([name]) => name)
      .sort()
      .join(",");
  return env;
}

async function main() {
  let readinessChecks = 0;
  const result =
    await compileFormativeConversationV9RemoteDatabaseCanaryPreflight({
      authorization:
        FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_AUTHORIZATION,
      env: canaryEnvironment(),
      verify_database_readiness: async () => {
        readinessChecks += 1;
      }
    });
  assert.equal(result.status, "ready");
  assert.equal(
    result.contract_hash,
    "046beb25c1e3b66c18f54e196dbc73762aae3915ed34207e13063b41b7266423"
  );
  assert.equal(
    result.contract_hash,
    FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH
  );
  assert.deepEqual(result.waits_ms, [10_000, 60_000, 90_000]);
  assert.equal(result.frozen_scenario_count, 3);
  assert.equal(result.v9_materialization_required, false);
  assert.equal(readinessChecks, 1);
  assert.equal(result.provider_calls, 0);
  assert.equal(result.model_auth_requests, 0);
  assert.equal(result.dispatch_checkpoints, 0);

  await assert.rejects(
    () =>
      compileFormativeConversationV9RemoteDatabaseCanaryPreflight({
        authorization: "not-authorized",
        env: canaryEnvironment(),
        verify_database_readiness: async () => {
          throw new Error("database_readiness_must_not_run");
        }
      }),
    /formative_conversation_v9_remote_database_canary_authorization_mismatch/u
  );

  const providerEnv = canaryEnvironment();
  providerEnv.OPENAI_API_KEY = "must-not-be-accepted";
  providerEnv.FORMATIVE_CONVERSATION_V5_V9_INJECTED_ENVIRONMENT_KEYS +=
    ",OPENAI_API_KEY";
  await assert.rejects(
    () =>
      compileFormativeConversationV9RemoteDatabaseCanaryPreflight({
        authorization:
          FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_AUTHORIZATION,
        env: providerEnv,
        verify_database_readiness: async () => {
          throw new Error("database_readiness_must_not_run");
        }
      }),
    /formative_conversation_v9_canary_provider_credential_injected/u
  );

  console.log(
    JSON.stringify({
      status: "passed",
      contract_hash: result.contract_hash,
      source_only_precanary_gate: true,
      v9_materialized: false,
      frozen_scenarios: result.frozen_scenario_count,
      database_readiness_queries: readinessChecks,
      provider_calls: 0,
      model_auth_requests: 0,
      dispatch_checkpoints: 0
    })
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code:
        error instanceof Error
          ? error.message.split(":", 1)[0]
          : "formative_conversation_v9_precanary_environment_parity_smoke_failed",
      provider_calls: 0,
      model_auth_requests: 0,
      dispatch_checkpoints: 0
    })
  );
  process.exitCode = 1;
});
