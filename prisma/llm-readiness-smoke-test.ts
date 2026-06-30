import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assert } from "./student-mvp-smoke-helpers";
import {
  clearAssessmentTutorReadinessCacheForTest,
  getAssessmentTutorRuntimeStatus,
  withAssessmentTutorAuthCheckForTest
} from "../src/lib/llm/assessment-tutor-readiness";

const baseEnv: Record<string, string> = {
  DATABASE_URL: "postgresql://readiness:readiness@localhost:5432/readiness?schema=public",
  SESSION_SECRET: "readiness-smoke-session-secret-000000",
  NODE_ENV: "development",
  npm_lifecycle_event: "",
  ITEM_ADMIN_TUTOR_MODE: "auto",
  ALLOW_LOCAL_MOCK_RUNTIME: "false",
  LLM_PROVIDER: "openai",
  LLM_LIVE_CALLS_ENABLED: "true",
  OPENAI_API_KEY_FILE: "",
  OPENAI_MODEL_ITEM_ADMIN: "gpt-test-item-admin",
  OPENAI_MODEL_FOLLOWUP: "",
  NEXT_PUBLIC_OPENAI_API_KEY: ""
};

function fakeKey(label: string) {
  return `sk-${label.replace(/[^A-Za-z0-9_-]/g, "")}-000000000000000000000000`;
}

async function withTemporaryEnv<T>(values: Record<string, string | undefined>, callback: () => Promise<T>) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );
  clearAssessmentTutorReadinessCacheForTest();
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearAssessmentTutorReadinessCacheForTest();
  }
}

async function withTempEnvDir(files: Record<string, string>, callback: (cwd: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "llm-readiness-smoke-"));
  try {
    for (const [fileName, contents] of Object.entries(files)) {
      await writeFile(path.join(dir, fileName), contents, "utf8");
    }
    await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  await withTemporaryEnv(
    {
      ...baseEnv,
      OPENAI_API_KEY: ""
    },
    async () => {
      const status = await getAssessmentTutorRuntimeStatus();
      assert(!status.ready, "Missing key should block readiness.");
      assert(status.auth_status === "invalid", "Missing key should produce invalid auth status.");
      assert(status.reason_codes.includes("openai_key_missing"), "Missing key reason code absent.");
    }
  );

  await withTemporaryEnv(
    {
      ...baseEnv,
      OPENAI_API_KEY: fakeKey("invalid")
    },
    async () => {
      await withAssessmentTutorAuthCheckForTest(
        async () => ({
          auth_status: "invalid",
          auth_checked_at: new Date().toISOString(),
          auth_check_error_code: "invalid_api_key",
          http_status: 401,
          provider_request_id: "synthetic_auth_request"
        }),
        async () => {
          const status = await getAssessmentTutorRuntimeStatus();
          assert(!status.ready, "Invalid auth should block readiness.");
          assert(status.auth_status === "invalid", "Invalid auth response should be stored.");
          assert(status.auth_check_error_code === "invalid_api_key", "Invalid API key code missing.");
          assert(status.reason_codes.includes("invalid_api_key"), "Invalid API key reason code absent.");
        }
      );
    }
  );

  await withTemporaryEnv(
    {
      ...baseEnv,
      OPENAI_API_KEY: fakeKey("network")
    },
    async () => {
      await withAssessmentTutorAuthCheckForTest(
        async () => ({
          auth_status: "unknown",
          auth_checked_at: new Date().toISOString(),
          auth_check_error_code: "auth_check_network_failed",
          http_status: null,
          provider_request_id: null
        }),
        async () => {
          const status = await getAssessmentTutorRuntimeStatus();
          assert(!status.ready, "Network-failed auth should block readiness.");
          assert(status.auth_status === "unknown", "Network failure should produce unknown auth status.");
          assert(status.reason_codes.includes("auth_check_network_failed"), "Network failure code absent.");
        }
      );
    }
  );

  await withTemporaryEnv(
    {
      ...baseEnv,
      OPENAI_API_KEY: fakeKey("local")
    },
    async () => {
      await withTempEnvDir(
        {
          ".env": `OPENAI_API_KEY=${fakeKey("env")}\n`,
          ".env.local": `OPENAI_API_KEY=${fakeKey("local")}\n`
        },
        async (cwd) => {
          const status = await getAssessmentTutorRuntimeStatus({ cwd });
          assert(!status.ready, "Conflicting env files should block readiness.");
          assert(status.config_conflict_detected, "Env-file conflict should be detected.");
          assert(status.reason_codes.includes("conflicting_env_keys"), "Conflict reason code absent.");
          assert(status.env_file_key_fingerprints.length === 2, "Safe fingerprint prefixes should be reported.");
          assert(!JSON.stringify(status).includes(fakeKey("env")), "Readiness status must not expose .env key.");
          assert(!JSON.stringify(status).includes(fakeKey("local")), "Readiness status must not expose .env.local key.");
        }
      );
    }
  );

  await withTemporaryEnv(
    {
      ...baseEnv,
      OPENAI_API_KEY: fakeKey("public"),
      NEXT_PUBLIC_OPENAI_API_KEY: fakeKey("public")
    },
    async () => {
      const status = await getAssessmentTutorRuntimeStatus();
      assert(!status.ready, "Public OpenAI key configuration should block readiness.");
      assert(status.public_key_configured, "Public key diagnostic missing.");
      assert(status.reason_codes.includes("public_openai_key_detected"), "Public key reason code absent.");
    }
  );

  await withTemporaryEnv(
    {
      ...baseEnv,
      OPENAI_API_KEY: fakeKey("valid")
    },
    async () => {
      let authChecks = 0;
      await withAssessmentTutorAuthCheckForTest(
        async () => {
          authChecks += 1;
          return {
            auth_status: "valid",
            auth_checked_at: new Date().toISOString(),
            auth_check_error_code: null,
            http_status: 200,
            provider_request_id: "synthetic_auth_request"
          };
        },
        async () => {
          const first = await getAssessmentTutorRuntimeStatus();
          const second = await getAssessmentTutorRuntimeStatus();
          assert(first.ready, "Valid mocked auth should permit readiness.");
          assert(first.auth_status === "valid", "Valid mocked auth status missing.");
          assert(second.auth_cache_status === "hit", "Second readiness call should use auth cache.");
          assert(authChecks === 1, "Auth check should be cached.");
        }
      );
    }
  );

  await withTemporaryEnv(
    {
      ...baseEnv,
      LLM_PROVIDER: "mock",
      LLM_LIVE_CALLS_ENABLED: "false",
      OPENAI_API_KEY: "",
      OPENAI_MODEL_ITEM_ADMIN: "",
      ITEM_ADMIN_TUTOR_MODE: "mock",
      ALLOW_LOCAL_MOCK_RUNTIME: "true"
    },
    async () => {
      const status = await getAssessmentTutorRuntimeStatus();
      assert(status.ready, "Explicit local mock mode should remain allowed.");
      assert(status.runtime_source === "deterministic_mock", "Mock source mismatch.");
    }
  );

  console.log("LLM readiness smoke test passed. No OpenAI call was made.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
