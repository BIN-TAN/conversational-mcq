export const PRODUCTION_SAFE_LOG_VERSION = "production-safe-log-v1" as const;

const SAFE_CODE_PATTERN = /^[a-z][a-z0-9_]{2,95}$/u;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export type ProductionSafeErrorCategory =
  | "application_error"
  | "application_range_error"
  | "application_syntax_error"
  | "application_type_error"
  | "unknown_error";

export type ProductionSafeErrorContext = {
  safe_error_code: string;
  request_id?: string | null;
  session_id?: string | null;
};

export type ProductionSafeErrorRecord = {
  event: "production_error";
  log_version: typeof PRODUCTION_SAFE_LOG_VERSION;
  severity: "error";
  timestamp: string;
  error_category: ProductionSafeErrorCategory;
  safe_error_code: string;
  request_id?: string;
  session_id?: string;
};

const ALLOWED_RECORD_KEYS = new Set([
  "event",
  "log_version",
  "severity",
  "timestamp",
  "error_category",
  "safe_error_code",
  "request_id",
  "session_id"
]);

function classifyError(error: unknown): ProductionSafeErrorCategory {
  if (error instanceof TypeError) return "application_type_error";
  if (error instanceof RangeError) return "application_range_error";
  if (error instanceof SyntaxError) return "application_syntax_error";
  if (error instanceof Error) return "application_error";
  return "unknown_error";
}

function safeCode(value: string) {
  return SAFE_CODE_PATTERN.test(value)
    ? value
    : "invalid_safe_error_code";
}

function safeIdentifier(value: string | null | undefined) {
  return value && SAFE_IDENTIFIER_PATTERN.test(value)
    ? value
    : undefined;
}

export function buildProductionSafeErrorRecord(
  error: unknown,
  context: ProductionSafeErrorContext,
  timestamp = new Date()
): ProductionSafeErrorRecord {
  const requestId = safeIdentifier(context.request_id);
  const sessionId = safeIdentifier(context.session_id);

  return {
    event: "production_error",
    log_version: PRODUCTION_SAFE_LOG_VERSION,
    severity: "error",
    timestamp: timestamp.toISOString(),
    error_category: classifyError(error),
    safe_error_code: safeCode(context.safe_error_code),
    ...(requestId ? { request_id: requestId } : {}),
    ...(sessionId ? { session_id: sessionId } : {})
  };
}

export function isProductionSafeErrorRecord(
  value: unknown
): value is ProductionSafeErrorRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;

  return (
    Object.keys(record).every((key) => ALLOWED_RECORD_KEYS.has(key)) &&
    record.event === "production_error" &&
    record.log_version === PRODUCTION_SAFE_LOG_VERSION &&
    record.severity === "error" &&
    typeof record.timestamp === "string" &&
    !Number.isNaN(Date.parse(record.timestamp)) &&
    typeof record.error_category === "string" &&
    [
      "application_error",
      "application_range_error",
      "application_syntax_error",
      "application_type_error",
      "unknown_error"
    ].includes(record.error_category) &&
    typeof record.safe_error_code === "string" &&
    SAFE_CODE_PATTERN.test(record.safe_error_code) &&
    (record.request_id === undefined ||
      (
        typeof record.request_id === "string" &&
        SAFE_IDENTIFIER_PATTERN.test(record.request_id)
      )) &&
    (record.session_id === undefined ||
      (
        typeof record.session_id === "string" &&
        SAFE_IDENTIFIER_PATTERN.test(record.session_id)
      ))
  );
}

export function logProductionError(
  error: unknown,
  context: ProductionSafeErrorContext
) {
  const record = buildProductionSafeErrorRecord(error, context);
  console.error(JSON.stringify(record));
  return record;
}
