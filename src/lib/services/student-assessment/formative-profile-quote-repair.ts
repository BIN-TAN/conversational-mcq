import { stableHash } from "@/lib/operational/stable-hash";

export const FORMATIVE_PROFILE_QUOTE_REPAIR_VERSION = "formative-profile-source-quote-repair-v1" as const;

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};

// Only the two observed verbatim-source failures qualify. Other evidence,
// student-safety, identity, schema and provider failures retain their behavior.
export function sourceQuoteRepairIssues(validationError: string | null): string[] | null {
  let value: JsonRecord;
  try { value = record(JSON.parse(validationError ?? "null")); } catch { return null; }
  if (value.category !== "student_facing_validation" || !Array.isArray(value.issues) ||
      value.issues.length === 0 || value.issue_count !== value.issues.length) return null;
  const issues = value.issues.map(record);
  if (!issues.every(issue => issue.field_path === "semantic_item_reviews" &&
      issue.rule_code === "semantic_item_evidence_invalid" && typeof issue.message === "string" &&
      /^(?:semantic_item_review_quote_mismatch|semantic_item_review_interpretation_quote_mismatch):[^\s:]+$/.test(issue.message))) return null;
  return issues.map(issue => issue.message as string);
}

export function sourceQuoteRepairInvocationKey(originalKey: string) {
  return `${originalKey}:source-quote-repair:1`;
}

export function sourceQuoteRepairBaseInput(value: unknown) {
  const input = { ...record(value) };
  // Audit-only selected-budget metadata was not part of the provider request.
  delete input.runtime_budget;
  return input;
}

export function sourceQuoteRepairInputMatches(retained: unknown, current: unknown) {
  return stableHash(sourceQuoteRepairBaseInput(retained)) === stableHash(sourceQuoteRepairBaseInput(current));
}

export function buildSourceQuoteRepairInput(retained: unknown, originalCallId: string, issues: string[]) {
  const input = sourceQuoteRepairBaseInput(retained);
  return { ...input, constraints: { ...record(input.constraints), source_quote_repair: {
    policy_version: FORMATIVE_PROFILE_QUOTE_REPAIR_VERSION,
    original_agent_call_id: originalCallId,
    attempt: 1, maximum_regenerations: 1, validation_issues: issues,
    instruction: "Regenerate the complete response using the unchanged sealed evidence. Copy reasoning_quote and interpretation student_quote from their exact source fields; do not paraphrase quoted text, invent evidence, or change the source responses. All original validation requirements still apply."
  } } };
}

// The attempt adapter must reserve the deterministic repair key atomically with
// failed retries disabled. Loading the retained rejection first resumes that
// one attempt after a crash; it never repeats the original paid request.
export async function executeWithSourceQuoteRepair<T extends { agent_call_id: string }, R>(input: {
  readRejected: (agentCallId?: string) => Promise<R | null>;
  executeOriginal: () => Promise<T>;
  executeRepair: (rejection: R) => Promise<T>;
}): Promise<T> {
  const prior = await input.readRejected();
  if (prior) return input.executeRepair(prior);
  let original: T;
  try { original = await input.executeOriginal(); } catch (error) {
    // Another caller can finish/reject the original between the first read and
    // reservation. The locked reservation reuses it; both callers converge on
    // the same bounded repair instead of creating another original attempt.
    const rejection = await input.readRejected();
    if (rejection) return input.executeRepair(rejection);
    throw error;
  }
  const rejection = await input.readRejected(original.agent_call_id);
  return rejection ? input.executeRepair(rejection) : original;
}
