const PROTECTED_KEY = /(^id$|_db_id$|_db_ids$|password|access_code|api_key|authorization|cookie|session_secret|database_url|credential|bearer|private_key|raw_output|input_payload|prompt_text|system_prompt|chain_of_thought)/i;
const SECRET_LIKE_VALUE = /\bsk-[A-Za-z0-9_-]{12,}\b/g;

export function redactEvaluationArtifactValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value.replace(SECRET_LIKE_VALUE, "[REDACTED]");
  if (Array.isArray(value)) return value.map(redactEvaluationArtifactValue);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = PROTECTED_KEY.test(key) ? "[REDACTED]" : redactEvaluationArtifactValue(entry);
  }
  return output;
}

export function assertEvaluationArtifactIsRedacted(value: unknown) {
  const serialized = JSON.stringify(value);
  if (/\bsk-[A-Za-z0-9_-]{12,}\b/.test(serialized)) {
    throw new Error("evaluation_artifact_contains_secret_like_token");
  }
  if (/"(?:password_hash|access_code_hash|authorization|session_secret|database_url|raw_output|input_payload)"\s*:\s*"(?!\[REDACTED\])/.test(serialized)) {
    throw new Error("evaluation_artifact_contains_protected_value");
  }
}
