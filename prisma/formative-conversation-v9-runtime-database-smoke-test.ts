import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  createLiveCanaryDatabaseIfMissing,
  databaseExists,
  databaseName,
  dropLiveCanaryDatabaseIfPresent,
  migrateDeploy
} from "./operational-live-canary-shared";
import {
  DEFAULT_OPERATIONAL_LIVE_CANARY_BASE_DATABASE_URL,
  OPERATIONAL_LIVE_CANARY_SMOKE_DATABASE_SUFFIX,
  assertOperationalLiveCanaryDatabaseUrl,
  databaseNameFromUrl
} from "../src/lib/services/operational-live-canary/database-url";

const baseUrl = new URL(DEFAULT_OPERATIONAL_LIVE_CANARY_BASE_DATABASE_URL);
const baseName = databaseNameFromUrl(baseUrl.toString()).replace(/_e2e$/u, "");
baseUrl.pathname = `/${baseName}${OPERATIONAL_LIVE_CANARY_SMOKE_DATABASE_SUFFIX}`;
const isolatedDatabaseUrl = baseUrl.toString();

function installIsolatedDatabaseEnvironment() {
  const parsed = new URL(isolatedDatabaseUrl);
  assert(
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1",
    "The V9 runtime smoke must use local PostgreSQL."
  );
  assertOperationalLiveCanaryDatabaseUrl(isolatedDatabaseUrl);
  process.env.DATABASE_URL = isolatedDatabaseUrl;
  process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL = isolatedDatabaseUrl;
  process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE = "true";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED = "false";
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY_FILE;
}

async function main() {
  installIsolatedDatabaseEnvironment();
  const childTests = [
    "prisma/formative-conversation-v8-persistence-boundary-smoke-test.ts",
    "prisma/formative-conversation-v9-database-recovery-smoke-test.ts",
    "prisma/formative-conversation-v9-profile-semantics-smoke-test.ts",
    "prisma/formative-conversation-v9-secret-scanner-smoke-test.ts",
    "prisma/formative-conversation-v9-remote-database-canary-smoke-test.ts",
    "prisma/formative-conversation-v9-offline-replay-smoke-test.ts",
    "prisma/student-research-export-integrity-smoke-test.ts",
    "prisma/student-teacher-bulk-export-smoke-test.ts",
    "prisma/student-selected-session-export-smoke-test.ts",
    "prisma/student-formative-conversation-runtime-smoke-test.ts"
  ] as const;
  const completedTests: string[] = [];
  try {
    await dropLiveCanaryDatabaseIfPresent();
    assert.equal(await createLiveCanaryDatabaseIfMissing(), true);
    assert.equal(await databaseExists(), true);
    migrateDeploy();

    for (const testPath of childTests) {
      const child = spawnSync(
        process.execPath,
        ["--import", "tsx", testPath],
        {
          cwd: process.cwd(),
          env: { ...process.env },
          encoding: "utf8",
          stdio: "inherit",
          timeout: 600_000
        }
      );
      assert.equal(
        child.status,
        0,
        child.error?.message ?? `The isolated smoke failed: ${testPath}`
      );
      completedTests.push(testPath);
    }
  } finally {
    const dropped = await dropLiveCanaryDatabaseIfPresent();
    assert.equal(dropped, true);
    assert.equal(await databaseExists(), false);
  }

  assert.deepEqual(completedTests, childTests);
  console.log(
    JSON.stringify(
      {
        status: "passed",
        database_isolation: "temporary_local_live_canary_smoke_database",
        database_name: databaseName(),
        database_dropped_after_test: true,
        classroom_or_render_database_used: false,
        isolated_test_files: completedTests,
        provider_calls: 0,
        model_auth_requests: 0
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code:
        error instanceof Error
          ? error.message
          : "formative_conversation_v9_runtime_database_smoke_failed",
      provider_calls: 0,
      model_auth_requests: 0
    })
  );
  process.exitCode = 1;
});
