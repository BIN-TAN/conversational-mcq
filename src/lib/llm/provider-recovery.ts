import type { StructuredAgentResult } from "./providers/types";

export const PROVIDER_RECOVERY_VERSION = "provider-recovery-v1";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function isOpenAIQuotaError(error: unknown) {
  const outer = record(error);
  const nested = record(outer.error);
  const markers = [outer.code, outer.type, outer.error_code, nested.code, nested.type]
    .filter((value): value is string => typeof value === "string")
    .join(" ").toLowerCase();
  return /quota|billing|credit_balance_exhausted|(?:organization|project)_(?:spend|usage)_limit_exceeded/.test(markers);
}

export function parseProviderRetryAfter(headers: Headers | null, nowMs = Date.now()) {
  if (!headers) return null;
  for (const [name, multiplier] of [["retry-after-ms", 1], ["retry-after", 1000]] as const) {
    const raw = headers.get(name)?.trim();
    if (!raw) continue;
    const numeric = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * multiplier : NaN;
    const value = Number.isFinite(numeric) ? numeric
      : name === "retry-after" && /^[A-Za-z]{3},/.test(raw) ? Date.parse(raw) - nowMs : NaN;
    if (Number.isFinite(value) && value >= 0) return Math.ceil(value);
  }
  return null;
}

export function providerRetryDelayMs(
  result: StructuredAgentResult<unknown>,
  baseDelayMs: number,
  random = Math.random
): number | null {
  const telemetry = result.transport_telemetry;
  const delay = telemetry?.normalized_error?.retry_after_ms ?? telemetry?.retry_after_ms;
  const floor = typeof delay === "number" && Number.isFinite(delay) && delay >= 0 ? delay : 0;
  // Never shorten a server-directed delay to fit the synchronous retry budget.
  if (floor > 30_000) return null;
  const rateLimited = result.error?.category === "rate_limit" || telemetry?.http_status === 429;
  const jitter = rateLimited ? Math.floor(Math.max(0, Math.min(1, random())) * 500) : 0;
  return Math.min(30_000, Math.max(baseDelayMs, floor) + jitter);
}

export function providerFailureAudit(result: StructuredAgentResult<unknown>) {
  const error = result.transport_telemetry?.normalized_error;
  if (!error) return null;
  // Persist operational evidence only, never provider message text or request contents.
  const code = (value: string | null) => value && /^[a-zA-Z0-9_.-]{1,120}$/.test(value) ? value : null;
  return {
    recovery_version: PROVIDER_RECOVERY_VERSION,
    http_status: error.http_status,
    provider_error_code: code(error.provider_error_code),
    provider_error_type: code(error.provider_error_type),
    typed_failure_reason: error.typed_failure_reason,
    retry_after_ms: error.retry_after_ms,
    retryable: result.error?.retryable ?? false
  };
}
