import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getServerEnv } from "@/lib/env";
import {
  resolveOpenAICredentialFromEnv,
  type OpenAICredentialResolution
} from "@/lib/llm/openai-credential-resolver";

export const ASSESSMENT_TUTOR_READINESS_VERSION = "assessment-tutor-readiness-v1";

export type AssessmentTutorAuthStatus = "valid" | "invalid" | "unknown";

export type AssessmentTutorRuntimeStatus = {
  readiness_version: typeof ASSESSMENT_TUTOR_READINESS_VERSION;
  ready: boolean;
  runtime_source: "live_llm" | "deterministic_mock" | "configuration_blocked";
  configured_mode: "auto" | "mock" | "live";
  provider: "mock" | "openai" | "invalid";
  live_calls_enabled: boolean;
  key_present: boolean;
  key_fingerprint_prefix: string | null;
  key_source: string | null;
  auth_status: AssessmentTutorAuthStatus;
  config_conflict_detected: boolean;
  public_key_configured: boolean;
  model_names: {
    item_admin: string | null;
    followup: string | null;
    effective_item_admin: string | null;
  };
  local_mock_allowed: boolean;
  reason_codes: string[];
  env_file_sources: string[];
  last_checked_at: string;
};

type EnvKeyRead = {
  key: string;
  file_name: string;
  value: string;
};

function configured(value?: string | null) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSmokeCommand(env: NodeJS.ProcessEnv = process.env) {
  const lifecycleEvent = env.npm_lifecycle_event ?? "";
  return /\bsmoke\b/.test(lifecycleEvent);
}

export function localMockRuntimeAllowed(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.NODE_ENV === "test" ||
    env.ALLOW_LOCAL_MOCK_RUNTIME === "true" ||
    isSmokeCommand(env)
  );
}

function parseEnvLine(line: string) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
    return null;
  }

  const equalsIndex = trimmed.indexOf("=");
  const key = trimmed.slice(0, equalsIndex).trim();
  let value = trimmed.slice(equalsIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function readEnvKeyValues(cwd: string, fileName: ".env" | ".env.local", keys: Set<string>) {
  const filePath = path.join(cwd, fileName);

  if (!existsSync(filePath)) {
    return [] as EnvKeyRead[];
  }

  const values: EnvKeyRead[] = [];
  const text = readFileSync(filePath, "utf8");

  for (const line of text.split(/\r?\n/u)) {
    const parsed = parseEnvLine(line);
    if (parsed && keys.has(parsed.key) && configured(parsed.value)) {
      values.push({ key: parsed.key, file_name: fileName, value: parsed.value });
    }
  }

  return values;
}

function localEnvFileDiagnostics(cwd: string, env: NodeJS.ProcessEnv) {
  const keys = new Set(["OPENAI_API_KEY", "NEXT_PUBLIC_OPENAI_API_KEY"]);
  const reads = [
    ...readEnvKeyValues(cwd, ".env", keys),
    ...readEnvKeyValues(cwd, ".env.local", keys)
  ];
  const apiKeyReads = reads.filter((entry) => entry.key === "OPENAI_API_KEY");
  const publicReads = reads.filter((entry) => entry.key === "NEXT_PUBLIC_OPENAI_API_KEY");
  const envKeySources = apiKeyReads.map((entry) => entry.file_name);
  const envValue = apiKeyReads.find((entry) => entry.file_name === ".env")?.value;
  const localValue = apiKeyReads.find((entry) => entry.file_name === ".env.local")?.value;

  return {
    env_file_sources: [...new Set(envKeySources)],
    config_conflict_detected: Boolean(envValue && localValue && envValue !== localValue),
    public_key_configured: configured(env.NEXT_PUBLIC_OPENAI_API_KEY) || publicReads.length > 0
  };
}

function credentialReasonCode(credential: OpenAICredentialResolution) {
  return credential.ok ? null : credential.code;
}

export function getAssessmentTutorRuntimeStatus(input?: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  checkedAt?: Date;
}): AssessmentTutorRuntimeStatus {
  const env = input?.env ?? process.env;
  const checkedAt = input?.checkedAt ?? new Date();
  const cwd = input?.cwd ?? process.cwd();
  const reasonCodes: string[] = [];
  let serverEnv: ReturnType<typeof getServerEnv> | null = null;

  try {
    serverEnv = getServerEnv();
  } catch (error) {
    reasonCodes.push(
      error instanceof Error ? "server_env_invalid" : "server_env_unreadable"
    );
  }

  const mode =
    env.ITEM_ADMIN_TUTOR_MODE === "mock" || env.ITEM_ADMIN_TUTOR_MODE === "live"
      ? env.ITEM_ADMIN_TUTOR_MODE
      : "auto";
  const provider =
    env.LLM_PROVIDER === "openai" || env.LLM_PROVIDER === "mock"
      ? env.LLM_PROVIDER
      : serverEnv?.LLM_PROVIDER ?? "invalid";
  const liveCallsEnabled =
    env.LLM_LIVE_CALLS_ENABLED === "true" || serverEnv?.LLM_LIVE_CALLS_ENABLED === true;
  const itemAdminModel = env.OPENAI_MODEL_ITEM_ADMIN ?? serverEnv?.OPENAI_MODEL_ITEM_ADMIN ?? null;
  const followupModel = env.OPENAI_MODEL_FOLLOWUP ?? serverEnv?.OPENAI_MODEL_FOLLOWUP ?? null;
  const effectiveItemAdminModel = configured(itemAdminModel) ? itemAdminModel : followupModel;
  const credential = resolveOpenAICredentialFromEnv(env);
  const envDiagnostics = localEnvFileDiagnostics(cwd, env);
  const mockRequested = mode === "mock" || provider === "mock";
  const mockAllowed = mockRequested && localMockRuntimeAllowed(env);

  if (provider !== "openai") {
    reasonCodes.push("llm_provider_not_openai");
  }
  if (!liveCallsEnabled) {
    reasonCodes.push("llm_live_calls_disabled");
  }
  if (!configured(effectiveItemAdminModel)) {
    reasonCodes.push("item_admin_model_missing");
  }
  const credentialCode = credentialReasonCode(credential);
  if (credentialCode) {
    reasonCodes.push(credentialCode === "credential_missing" ? "openai_key_missing" : credentialCode);
  }
  if (envDiagnostics.config_conflict_detected) {
    reasonCodes.push("conflicting_env_keys");
  }
  if (envDiagnostics.public_key_configured) {
    reasonCodes.push("public_openai_key_configured");
  }
  if (mockRequested && !mockAllowed) {
    reasonCodes.push("local_mock_runtime_not_allowed");
  }
  if (mockRequested) {
    reasonCodes.push("item_admin_tutor_mode_mock");
  }

  const liveReady =
    mode !== "mock" &&
    provider === "openai" &&
    liveCallsEnabled &&
    configured(effectiveItemAdminModel) &&
    credential.ok &&
    !envDiagnostics.config_conflict_detected &&
    !envDiagnostics.public_key_configured &&
    !reasonCodes.includes("server_env_invalid") &&
    !reasonCodes.includes("server_env_unreadable");
  const ready = liveReady || mockAllowed;
  const runtimeSource = liveReady
    ? "live_llm"
    : mockAllowed
      ? "deterministic_mock"
      : "configuration_blocked";

  return {
    readiness_version: ASSESSMENT_TUTOR_READINESS_VERSION,
    ready,
    runtime_source: runtimeSource,
    configured_mode: mode,
    provider,
    live_calls_enabled: liveCallsEnabled,
    key_present: credential.ok || credential.source !== "none",
    key_fingerprint_prefix: credential.ok
      ? credential.credential.fingerprint_prefix
      : credential.public_resolution?.fingerprint_prefix ?? null,
    key_source: credential.ok ? credential.credential.source : credential.source,
    auth_status: credential.ok ? "unknown" : "invalid",
    config_conflict_detected: envDiagnostics.config_conflict_detected,
    public_key_configured: envDiagnostics.public_key_configured,
    model_names: {
      item_admin: configured(itemAdminModel) ? itemAdminModel : null,
      followup: configured(followupModel) ? followupModel : null,
      effective_item_admin: configured(effectiveItemAdminModel) ? effectiveItemAdminModel : null
    },
    local_mock_allowed: mockAllowed,
    reason_codes: [...new Set(reasonCodes)],
    env_file_sources: envDiagnostics.env_file_sources,
    last_checked_at: checkedAt.toISOString()
  };
}

export function assertAssessmentTutorRuntimeReady() {
  const status = getAssessmentTutorRuntimeStatus();

  if (!status.ready) {
    return {
      ok: false as const,
      status,
      student_message: "This assessment is temporarily unavailable. Please try again later."
    };
  }

  return { ok: true as const, status };
}
