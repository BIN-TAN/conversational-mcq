import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import path from "node:path";
import { FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT } from "../src/lib/operational/formative-conversation-v5-evaluation-v16/contracts";
import { validateFormativeConversationV5LiveEnvironment } from "../src/lib/operational/formative-conversation-v5-evaluation-v16/live-environment";
import {
  exactFormativeConversationV5LiveAuthorization,
  loadFormativeConversationV5EvaluationPackage
} from "../src/lib/operational/formative-conversation-v5-evaluation-v16/package";
import { assertFormativeConversationV5LivePreflight } from "../src/lib/operational/formative-conversation-v5-evaluation-v16/service";
import {
  buildFormativeConversationV5TestEnvironment,
  installFormativeConversationV5TestEnvironment
} from "./helpers/formative-conversation-v5-v16-test-environment";

function injected(env: NodeJS.ProcessEnv) {
  env.FORMATIVE_CONVERSATION_V5_V16_INJECTED_ENVIRONMENT_KEYS =
    Object.entries(env)
      .filter(([, value]) => Boolean(value?.trim()))
      .map(([name]) => name)
      .sort()
      .join(",");
  return env;
}

async function exportReadiness() {
  return {
    ready: true,
    environment: "production",
    pseudonymization_method: "HMAC-SHA-256" as const,
    pseudonymization_version: "hmac_sha256_v1",
    key_configured: true,
    safe_key_fingerprint: null,
    required_configuration: ["RESEARCH_PSEUDONYMIZATION_KEY"],
    blocking_reasons: [],
    warnings: [],
    export_schema_version: "deterministic-test-export-schema",
    readiness_version: "research-export-readiness-v1" as const,
    artifact_path_writable: true,
    database_ready: true,
    dictionary_registry_ready: true,
    restricted_export_authorization_supported: true
  };
}

async function migrationReadiness() {
  return {
    ready: true,
    expected_migration_count: 1,
    applied_migration_count: 1,
    expected_migration_set_hash: "a".repeat(64),
    missing_migration_count: 0,
    failed_migration_count: 0
  };
}

async function main() {
const originalFetch = globalThis.fetch;
let networkRequests = 0;
globalThis.fetch = (async () => {
  networkRequests += 1;
  throw new Error("network_forbidden");
}) as typeof fetch;
try {
  const loaded = loadFormativeConversationV5EvaluationPackage();
  const base = buildFormativeConversationV5TestEnvironment();
  const validationInput = {
    candidate: loaded.source_candidate,
    runtime_candidate_hash: loaded.runtime_candidate_hash,
    expected_active_runtime_hash:
      loaded.candidate_manifest.preserved_active_runtime_hash,
    expected_rollback_runtime_hash:
      loaded.candidate_manifest.preserved_rollback_runtime_hash
  };
  const validated = validateFormativeConversationV5LiveEnvironment({
    ...validationInput,
    env: base
  });
  assert.equal(validated.canonical_service.name, "conversational-mcq");
  assert.equal(validated.canonical_service.migrations_current, true);
  assert.notEqual(
    validated.active_approval.runtime_candidate_hash,
    validated.inactive_candidate.runtime_candidate_hash
  );

  const staging = injected({
    ...base,
    FORMATIVE_CONVERSATION_V5_V16_CANONICAL_SERVICE_NAME:
      "conversational-mcq-staging"
  });
  assert.throws(
    () =>
      validateFormativeConversationV5LiveEnvironment({
        ...validationInput,
        env: staging
      }),
    /formative_conversation_v5_environment_value_mismatch/
  );

  const missingApprovalHash = injected({ ...base });
  delete missingApprovalHash.OPERATIONAL_APPROVED_CONFIG_HASH;
  assert.throws(
    () =>
      validateFormativeConversationV5LiveEnvironment({
        ...validationInput,
        env: missingApprovalHash
      }),
    /formative_conversation_v5_required_environment_missing/
  );

  const wrongApprovalHash = injected({
    ...base,
    OPERATIONAL_APPROVED_CONFIG_HASH: "f".repeat(64)
  });
  assert.throws(
    () =>
      validateFormativeConversationV5LiveEnvironment({
        ...validationInput,
        env: wrongApprovalHash
      }),
    /formative_conversation_v5_active_approval_hash_mismatch/
  );

  const missingMigrations = injected({ ...base });
  delete missingMigrations.FORMATIVE_CONVERSATION_V5_V16_MIGRATIONS_CURRENT;
  assert.throws(
    () =>
      validateFormativeConversationV5LiveEnvironment({
        ...validationInput,
        env: missingMigrations
      }),
    /formative_conversation_v5_required_environment_missing/
  );

  const restore = installFormativeConversationV5TestEnvironment();
  try {
    const preflight = await assertFormativeConversationV5LivePreflight(
      {
        runtime_candidate_hash: loaded.runtime_candidate_hash,
        evaluation_protocol_hash: loaded.protocol_hash,
        confirm_live_provider_calls: true,
        authorization:
          exactFormativeConversationV5LiveAuthorization(loaded)
      },
      {
        get_research_export_readiness: exportReadiness,
        get_migration_readiness: migrationReadiness
      }
    );
    assert.equal(
      preflight.dispatch_boundary.status,
      "ready_immediately_before_dispatch_checkpoint"
    );
    assert.equal(preflight.dispatch_boundary.checkpoint_created, false);
    assert.equal(preflight.dispatch_boundary.database_readiness_queries, 2);
  } finally {
    restore();
  }

  const dispatchPath = path.resolve(
    FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
    "dispatch",
    `${loaded.protocol_hash}.json`
  );
  assert.equal(existsSync(dispatchPath), false);
  assert.equal(networkRequests, 0);
  console.log(
    JSON.stringify({
      status: "passed",
      canonical_service: "conversational-mcq",
      deprecated_staging_blocked: true,
      active_approval_and_candidate_separate: true,
      database_identity_checked: true,
      migrations_checked: true,
      plan_live_environment_parity: true,
      provider_calls: 0,
      model_auth_requests: 0,
      network_requests: 0,
      dispatch_checkpoints: 0
    })
  );
} finally {
  globalThis.fetch = originalFetch;
}
}

void main();
