import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createOpenAIClient } from "@/lib/llm/openai-client";
import { getServerEnv } from "@/lib/env";
import {
  resolveOpenAICredentialFromEnv,
  type ResolvedOpenAICredential,
  type OpenAICredentialResolution
} from "@/lib/llm/openai-credential-resolver";
import { sanitizeUnknownError } from "@/lib/llm/errors";

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
  auth_checked_at: string | null;
  auth_check_error_code: string | null;
  auth_cache_status: "hit" | "miss" | "skipped";
  config_conflict_detected: boolean;
  public_key_configured: boolean;
  model_names: {
    item_admin: string | null;
    followup: string | null;
    effective_item_admin: string | null;
  };
  local_mock_allowed: boolean;
  reason_codes: string[];
  warning_codes: string[];
  env_file_sources: string[];
  env_file_key_fingerprints: Array<{
    file_name: string;
    fingerprint_prefix: string;
  }>;
  last_checked_at: string;
};

type EnvKeyRead = {
  key: string;
  file_name: string;
  value: string;
};

type AuthCheckResult = {
  auth_status: AssessmentTutorAuthStatus;
  auth_checked_at: string;
  auth_check_error_code: string | null;
  http_status?: number | null;
  provider_request_id?: string | null;
};

type AuthCheckInput = {
  credential: ResolvedOpenAICredential;
  model_name: string;
  timeout_ms: number;
};

type AuthCheck = (input: AuthCheckInput) => Promise<AuthCheckResult>;

const AUTH_CHECK_CACHE_TTL_MS = 3 * 60 * 1000;
const authCheckCache = new Map<string, { expires_at_ms: number; result: AuthCheckResult }>();
let authCheckOverrideForTest: AuthCheck | null = null;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

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

function statusCodeFromError(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  return typeof record.status === "number" ? record.status : null;
}

function providerCodeFromError(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  return typeof record.code === "string" ? record.code : null;
}

function authCheckErrorCode(error: unknown) {
  const status = statusCodeFromError(error);
  const code = providerCodeFromError(error);
  const sanitized = sanitizeUnknownError(error);

  if (status === 401 || code === "invalid_api_key") {
    return "invalid_api_key";
  }
  if (status === 403 || sanitized.category === "permission") {
    return "permission_denied";
  }
  if (status === 404) {
    return "model_not_accessible";
  }
  if (sanitized.category === "timeout") {
    return "auth_check_timeout";
  }
  if (sanitized.category === "network") {
    return "auth_check_network_failed";
  }
  if (sanitized.category === "rate_limit") {
    return "auth_check_rate_limited";
  }
  if (sanitized.category === "quota") {
    return "auth_check_quota_blocked";
  }
  return "auth_check_failed";
}

async function defaultAuthCheck(input: AuthCheckInput): Promise<AuthCheckResult> {
  let httpStatus: number | null = null;
  let providerRequestId: string | null = null;
  const client = createOpenAIClient({
    credential: input.credential,
    onResponseHeadersReceived: ({ status, request_id }) => {
      httpStatus = status;
      providerRequestId = request_id;
    }
  });

  try {
    const { request_id: requestId } = await client.models
      .retrieve(input.model_name, {
        timeout: input.timeout_ms,
        maxRetries: 0
      })
      .withResponse();

    return {
      auth_status: "valid",
      auth_checked_at: new Date().toISOString(),
      auth_check_error_code: null,
      http_status: httpStatus,
      provider_request_id: requestId ?? providerRequestId
    };
  } catch (error) {
    const errorCode = authCheckErrorCode(error);
    return {
      auth_status:
        errorCode === "auth_check_network_failed" ||
        errorCode === "auth_check_timeout" ||
        errorCode === "auth_check_rate_limited"
          ? "unknown"
          : "invalid",
      auth_checked_at: new Date().toISOString(),
      auth_check_error_code: errorCode,
      http_status: httpStatus ?? statusCodeFromError(error),
      provider_request_id: providerRequestId
    };
  }
}

function authCacheKey(input: AuthCheckInput) {
  return [
    input.credential.fingerprint,
    input.credential.source,
    input.model_name,
    process.env.OPENAI_BASE_URL ?? "",
    process.env.OPERATIONAL_LIVE_CANARY_LOOPBACK_OPENAI_BASE_URL ?? ""
  ].join(":");
}

async function cachedAuthCheck(input: AuthCheckInput, checkedAt: Date) {
  const key = authCacheKey(input);
  const cached = authCheckCache.get(key);
  if (cached && cached.expires_at_ms > checkedAt.getTime()) {
    return { result: cached.result, cache_status: "hit" as const };
  }

  const result = await (authCheckOverrideForTest ?? defaultAuthCheck)(input);
  authCheckCache.set(key, {
    result,
    expires_at_ms: checkedAt.getTime() + AUTH_CHECK_CACHE_TTL_MS
  });
  return { result, cache_status: "miss" as const };
}

export async function withAssessmentTutorAuthCheckForTest<T>(
  authCheck: AuthCheck,
  callback: () => Promise<T>
): Promise<T> {
  const previous = authCheckOverrideForTest;
  authCheckOverrideForTest = authCheck;
  clearAssessmentTutorReadinessCacheForTest();
  try {
    return await callback();
  } finally {
    authCheckOverrideForTest = previous;
    clearAssessmentTutorReadinessCacheForTest();
  }
}

export function clearAssessmentTutorReadinessCacheForTest() {
  authCheckCache.clear();
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
  const envFingerprint = envValue ? sha256(envValue) : null;
  const localFingerprint = localValue ? sha256(localValue) : null;
  const fingerprintEntries = apiKeyReads.map((entry) => ({
    file_name: entry.file_name,
    fingerprint_prefix: sha256(entry.value).slice(0, 12)
  }));
  const uniqueFingerprintEntries = Array.from(
    new Map(
      fingerprintEntries.map((entry) => [
        `${entry.file_name}:${entry.fingerprint_prefix}`,
        entry
      ])
    ).values()
  );

  return {
    env_file_sources: [...new Set(envKeySources)],
    env_file_key_fingerprints: uniqueFingerprintEntries,
    config_conflict_detected: Boolean(envFingerprint && localFingerprint && envFingerprint !== localFingerprint),
    duplicate_matching_key_detected: Boolean(envFingerprint && localFingerprint && envFingerprint === localFingerprint),
    public_key_configured: configured(env.NEXT_PUBLIC_OPENAI_API_KEY) || publicReads.length > 0
  };
}

function credentialReasonCode(credential: OpenAICredentialResolution) {
  return credential.ok ? null : credential.code;
}

export async function getAssessmentTutorRuntimeStatus(input?: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  checkedAt?: Date;
}): Promise<AssessmentTutorRuntimeStatus> {
  const env = input?.env ?? process.env;
  const checkedAt = input?.checkedAt ?? new Date();
  const cwd = input?.cwd ?? process.cwd();
  const reasonCodes: string[] = [];
  const warningCodes: string[] = [];
  let authResult: AuthCheckResult | null = null;
  let authCacheStatus: AssessmentTutorRuntimeStatus["auth_cache_status"] = "skipped";
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
    reasonCodes.push("model_not_configured");
  }
  const credentialCode = credentialReasonCode(credential);
  if (credentialCode) {
    reasonCodes.push(credentialCode === "credential_missing" ? "openai_key_missing" : credentialCode);
  }
  if (envDiagnostics.config_conflict_detected) {
    reasonCodes.push("conflicting_env_keys");
  }
  if (envDiagnostics.public_key_configured) {
    reasonCodes.push("public_openai_key_detected");
  }
  if (envDiagnostics.duplicate_matching_key_detected) {
    warningCodes.push("duplicate_env_key_same_fingerprint");
  }
  if (mockRequested && !mockAllowed) {
    reasonCodes.push("local_mock_runtime_not_allowed");
  }
  if (mockRequested) {
    reasonCodes.push("item_admin_tutor_mode_mock");
  }

  const staticLiveReady =
    mode !== "mock" &&
    provider === "openai" &&
    liveCallsEnabled &&
    configured(effectiveItemAdminModel) &&
    credential.ok &&
    !envDiagnostics.config_conflict_detected &&
    !envDiagnostics.public_key_configured &&
    !reasonCodes.includes("server_env_invalid") &&
    !reasonCodes.includes("server_env_unreadable");

  if (staticLiveReady && credential.ok && configured(effectiveItemAdminModel)) {
    const checked = await cachedAuthCheck({
      credential: credential.credential,
      model_name: effectiveItemAdminModel!,
      timeout_ms: serverEnv?.OPENAI_REQUEST_TIMEOUT_MS ?? 60000
    }, checkedAt);
    authResult = checked.result;
    authCacheStatus = checked.cache_status;

    if (authResult.auth_status !== "valid") {
      reasonCodes.push(authResult.auth_check_error_code ?? "auth_check_failed");
    }
  } else if (!credential.ok) {
    authResult = {
      auth_status: "invalid",
      auth_checked_at: checkedAt.toISOString(),
      auth_check_error_code: credentialCode === "credential_missing" ? "openai_key_missing" : credentialCode,
      http_status: null,
      provider_request_id: null
    };
  }

  const liveReady = staticLiveReady && authResult?.auth_status === "valid";
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
    auth_status: authResult?.auth_status ?? "unknown",
    auth_checked_at: authResult?.auth_checked_at ?? null,
    auth_check_error_code: authResult?.auth_check_error_code ?? null,
    auth_cache_status: authCacheStatus,
    config_conflict_detected: envDiagnostics.config_conflict_detected,
    public_key_configured: envDiagnostics.public_key_configured,
    model_names: {
      item_admin: configured(itemAdminModel) ? itemAdminModel : null,
      followup: configured(followupModel) ? followupModel : null,
      effective_item_admin: configured(effectiveItemAdminModel) ? effectiveItemAdminModel : null
    },
    local_mock_allowed: mockAllowed,
    reason_codes: [...new Set(reasonCodes)],
    warning_codes: [...new Set(warningCodes)],
    env_file_sources: envDiagnostics.env_file_sources,
    env_file_key_fingerprints: envDiagnostics.env_file_key_fingerprints,
    last_checked_at: checkedAt.toISOString()
  };
}

export async function assertAssessmentTutorRuntimeReady() {
  const status = await getAssessmentTutorRuntimeStatus();

  if (!status.ready) {
    return {
      ok: false as const,
      status,
      student_message: "This assessment is temporarily unavailable. Please try again later."
    };
  }

  return { ok: true as const, status };
}
