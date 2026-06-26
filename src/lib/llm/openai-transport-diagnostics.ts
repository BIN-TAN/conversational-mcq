import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { APIError } from "openai";
import { resolveOpenAICredentialFromEnv } from "@/lib/llm/openai-credential-resolver";
import type {
  OpenAITransportMilestone,
  OpenAITransportTypedFailureReason,
  SanitizedOpenAITransportError
} from "@/lib/llm/providers/types";

const require = createRequire(import.meta.url);

export const APPROVED_OPENAI_HOST = "api.openai.com";
export const DEFAULT_OPENAI_BASE_URL = `https://${APPROVED_OPENAI_HOST}/v1`;

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]+/g,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /postgres(?:ql)?:\/\/\S+/gi,
  /OPENAI_API_KEY=\S+/gi,
  /SESSION_SECRET=\S+/gi
];

function safeString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function sanitizeTransportMessage(value: unknown) {
  let message = value instanceof Error ? value.message : String(value ?? "Unknown transport error.");
  for (const pattern of SECRET_PATTERNS) {
    message = message.replace(pattern, "[REDACTED_SECRET]");
  }
  return message.replace(/\s+/g, " ").slice(0, 500);
}

function stringProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const direct = (value as Record<string, unknown>)[key];
  return typeof direct === "string" && direct.trim().length > 0 ? direct : null;
}

function numberProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const direct = (value as Record<string, unknown>)[key];
  return typeof direct === "number" && Number.isFinite(direct) ? direct : null;
}

function headersFromError(value: unknown): Headers | null {
  const headers = value && typeof value === "object"
    ? (value as { headers?: unknown }).headers
    : null;
  if (!headers) {
    return null;
  }
  if (headers instanceof Headers) {
    return headers;
  }
  if (typeof (headers as { get?: unknown }).get === "function") {
    return headers as Headers;
  }
  return null;
}

function retryAfterMs(headers: Headers | null) {
  if (!headers) {
    return null;
  }
  const retryMs = headers.get("retry-after-ms");
  if (retryMs && Number.isFinite(Number(retryMs))) {
    return Number(retryMs);
  }
  const retrySeconds = headers.get("retry-after");
  if (retrySeconds && Number.isFinite(Number(retrySeconds))) {
    return Number(retrySeconds) * 1000;
  }
  return null;
}

function errorCodeText(error: unknown) {
  return [
    stringProperty(error, "code"),
    stringProperty(error, "error_code"),
    stringProperty((error as { error?: unknown })?.error, "code")
  ].filter(Boolean).join(" ").toLowerCase();
}

function causeFromError(error: unknown): unknown {
  return error && typeof error === "object" ? (error as { cause?: unknown }).cause : null;
}

function classifyNetwork(error: unknown, message: string):
  | "dns"
  | "socket"
  | "tls"
  | "timeout"
  | "abort"
  | "http_error"
  | "response_parse"
  | "unknown"
  | null {
  const cause = causeFromError(error);
  const code = safeString(stringProperty(cause, "code") ?? stringProperty(error, "code")).toUpperCase();
  const text = `${message} ${code} ${safeString(stringProperty(error, "name"))}`.toLowerCase();

  if (/json|parse|unexpected end|invalid response/i.test(message)) {
    return "response_parse";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || /dns|getaddrinfo/.test(text)) {
    return "dns";
  }
  if (/tls|ssl|cert|certificate/.test(text)) {
    return "tls";
  }
  if (/timeout|timed out|etimedout/.test(text)) {
    return "timeout";
  }
  if (/abort|aborted/.test(text)) {
    return "abort";
  }
  if (code.startsWith("ECONN") || /socket|network|fetch failed|connection/.test(text)) {
    return "socket";
  }
  return null;
}

function typedReason(input: {
  status: number | null;
  codeText: string;
  networkCategory: ReturnType<typeof classifyNetwork>;
}): OpenAITransportTypedFailureReason {
  if (input.status === 401) {
    return "openai_authentication_failed";
  }
  if (input.status === 403) {
    return "openai_permission_denied";
  }
  if (input.status === 404 || /model.*not.*found|model_not_found/.test(input.codeText)) {
    return "openai_model_not_found";
  }
  if (input.status === 429) {
    return /quota|insufficient_quota|billing/.test(input.codeText)
      ? "openai_quota_exceeded"
      : "openai_rate_limited";
  }
  if (input.status === 400) {
    return "openai_bad_request";
  }
  if (input.status !== null && input.status >= 500) {
    return "openai_server_error";
  }
  if (input.networkCategory === "timeout" || input.networkCategory === "abort") {
    return "openai_request_timeout";
  }
  if (input.networkCategory === "dns") {
    return "openai_dns_failed";
  }
  if (input.networkCategory === "tls") {
    return "openai_tls_failed";
  }
  if (input.networkCategory === "socket") {
    return "openai_connection_failed";
  }
  if (input.networkCategory === "response_parse") {
    return "openai_response_parse_failed";
  }
  return "unknown_transport_error";
}

export function normalizeOpenAITransportError(
  error: unknown,
  milestones: OpenAITransportMilestone
): SanitizedOpenAITransportError {
  const message = sanitizeTransportMessage(error);
  const headers = headersFromError(error);
  const status = error instanceof APIError
    ? error.status ?? null
    : numberProperty(error, "status");
  const codeText = errorCodeText(error);
  const networkCategory = status ? "http_error" : classifyNetwork(error, message) ?? "unknown";
  const typed = typedReason({ status, codeText, networkCategory });
  const cause = causeFromError(error);
  const providerRequestHeaderId =
    headers?.get("x-request-id") ??
    headers?.get("request-id") ??
    stringProperty(error, "request_id") ??
    null;

  return {
    typed_failure_reason: typed,
    error_class: error instanceof Error && error.constructor?.name ? error.constructor.name : typeof error,
    error_name: error instanceof Error ? error.name : stringProperty(error, "name"),
    error_type: stringProperty(error, "type") ?? stringProperty((error as { error?: unknown })?.error, "type"),
    http_status: status,
    provider_error_code:
      stringProperty(error, "code") ?? stringProperty((error as { error?: unknown })?.error, "code"),
    provider_error_type:
      stringProperty(error, "type") ?? stringProperty((error as { error?: unknown })?.error, "type"),
    provider_error_param:
      stringProperty(error, "param") ?? stringProperty((error as { error?: unknown })?.error, "param"),
    provider_request_id: stringProperty(error, "request_id"),
    provider_request_header_id: providerRequestHeaderId,
    retry_after_ms: retryAfterMs(headers),
    node_cause_name: cause instanceof Error ? cause.name : stringProperty(cause, "name"),
    node_cause_code: stringProperty(cause, "code"),
    network_category: networkCategory,
    sanitized_message: message,
    has_http_response: status !== null || Boolean(providerRequestHeaderId),
    before_request_serialization: !milestones.request_serialization_completed,
    fetch_invoked: milestones.fetch_invoked,
    response_headers_received: milestones.response_headers_received,
    response_body_received: milestones.response_body_received
  };
}

export function resolveOpenAIBaseUrl() {
  return process.env.OPENAI_BASE_URL?.trim() ||
    process.env.OPERATIONAL_LIVE_CANARY_LOOPBACK_OPENAI_BASE_URL?.trim() ||
    DEFAULT_OPENAI_BASE_URL;
}

export function openAIBaseUrlHost(baseURL = resolveOpenAIBaseUrl()) {
  try {
    return new URL(baseURL).host;
  } catch {
    return "invalid";
  }
}

export function isApprovedOpenAIBaseUrl(baseURL = resolveOpenAIBaseUrl()) {
  return openAIBaseUrlHost(baseURL) === APPROVED_OPENAI_HOST;
}

export function openaiSdkVersion() {
  try {
    let current = path.dirname(require.resolve("openai"));
    for (let index = 0; index < 8; index += 1) {
      const candidate = path.join(current, "package.json");
      if (existsSync(candidate)) {
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string; version?: string };
        if (parsed.name === "openai" && parsed.version) {
          return parsed.version;
        }
      }
      current = path.dirname(current);
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function createOpenAITransportEnvironmentReport() {
  const baseURL = resolveOpenAIBaseUrl();
  const host = openAIBaseUrlHost(baseURL);
  const testProviderOverrideActive = process.env.OPERATIONAL_LIVE_CANARY_TEST_PROVIDER_OVERRIDE === "true";
  const testFetchActive = process.env.OPERATIONAL_LIVE_CANARY_TEST_FETCH_ACTIVE === "true";
  const noNetworkAbortActive =
    process.env.OPERATIONAL_LIVE_CANARY_TEST_ABORT_AT_TRANSPORT_BOUNDARY === "true";
  const loopbackCredentialCheckTestAllowed =
    process.env.OPERATIONAL_LIVE_CANARY_TEST_ALLOW_LOOPBACK_CREDENTIAL_CHECK === "true" &&
    (host.startsWith("127.0.0.1:") || host.startsWith("localhost:"));
  const credential = resolveOpenAICredentialFromEnv(process.env);
  const configured = credential.ok;
  const shapeValid = credential.ok ? credential.credential.basicShapeValid : false;
  const proxyActive = Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY);
  const baseURLApproved = host === APPROVED_OPENAI_HOST;
  const baseURLAllowed = baseURLApproved || loopbackCredentialCheckTestAllowed;
  const paidTransportEligible =
    baseURLAllowed &&
    !testProviderOverrideActive &&
    !testFetchActive &&
    !noNetworkAbortActive;
  const blockingReasons = [
    baseURLAllowed ? null : "nonapproved_base_url",
    testProviderOverrideActive ? "test_transport_hook_active" : null,
    testFetchActive ? "test_transport_hook_active" : null,
    noNetworkAbortActive ? "test_transport_hook_active" : null
  ].filter((value): value is string => Boolean(value));

  return {
    approved_provider: "openai",
    approved_transport: "openai_responses",
    approved_host: APPROVED_OPENAI_HOST,
    resolved_base_url_host: host,
    base_url_approved: baseURLApproved,
    test_loopback_host_allowed: loopbackCredentialCheckTestAllowed,
    test_provider_override_active: testProviderOverrideActive,
    test_fetch_active: testFetchActive,
    no_network_abort_active: noNetworkAbortActive,
    proxy_configured: proxyActive,
    node_fetch_available: typeof fetch === "function",
    openai_sdk_package_version: openaiSdkVersion(),
    openai_sdk_adapter_version: "openai-responses-adapter-v2",
    responses_transport_available: true,
    api_key_configured: configured,
    api_key_basic_shape_valid: shapeValid,
    credential_source: credential.ok ? credential.credential.source : credential.source,
    credential_resolver_version: credential.ok
      ? credential.credential.resolver_version
      : credential.public_resolution?.resolver_version ?? "openai-credential-resolver-v1",
    credential_fingerprint_prefix: credential.ok ? credential.credential.fingerprint_prefix : null,
    credential_resolution_status: credential.ok ? "resolved" : credential.code,
    model_snapshot: process.env.OPERATIONAL_LIVE_CANARY_TARGET_MODEL ?? null,
    paid_transport_eligible: paidTransportEligible,
    blocking_reasons: blockingReasons,
    no_external_request_made: true
  };
}
