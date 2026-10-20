import { randomUUID } from "node:crypto";
import type { AgentModelConfig } from "@/lib/llm/config";
import type { LlmProvider, StructuredAgentResult } from "@/lib/llm/providers/types";
import {
  INTERPRETATION_V8_AGENT_NAME,
  INTERPRETATION_V8_INSTRUCTIONS,
  INTERPRETATION_V8_PROMPT_VERSION,
  INTERPRETATION_V8_SCHEMA_VERSION,
  InterpretationOutputV8Schema,
  type InterpretationInputV8,
  type InterpretationOutputV8
} from "./contract";
import {
  repairInterpretationOutputV8,
  salvageInterpretationOutputV8,
  type InterpretationRepair,
  type InterpretationSalvage
} from "./repair";
import { validateInterpretationOutputV8, type InterpretationIssue } from "./validate";

/**
 * The one generation loop of interpretation v8, without any database access: call the
 * model, check the output with the application's rules, regenerate once with the list of
 * problems. Production (call.ts) records each attempt through the hooks; the evaluation
 * harness uses the same function, so what is evaluated is what runs.
 */
export const INTERPRETATION_V8_MAX_ATTEMPTS = 2;
const PROVIDER_TIMEOUT_MS = 180_000;

/** Provider failures that may pass with time (the preparation job can retry these later). */
export const TRANSIENT_PROVIDER_FAILURES = new Set([
  "rate_limit", "timeout", "network", "provider_5xx", "unexpected_provider_response", "provider_exception", "failed"
]);

/** Wait before the next attempt after a transient provider failure (capped). */
function backoffMs(result: StructuredAgentResult<unknown> | null) {
  const category = result?.error?.category;
  if (category === "rate_limit") {
    const hinted = result?.transport_telemetry?.retry_after_ms;
    return Math.min(30_000, Math.max(5_000, typeof hinted === "number" && Number.isFinite(hinted) ? hinted : 10_000));
  }
  return 3_000;
}

export type InterpretationAttemptRecord = {
  attempt: number;
  client_request_id: string;
  provider_input: unknown;
  result: StructuredAgentResult<InterpretationOutputV8> | null;
  outcome: "validated" | "invalid_output" | "provider_failure" | "provider_exception";
  issues: InterpretationIssue[];
  /** The output after repairs (the checked output); null when there was none. */
  output: InterpretationOutputV8 | null;
  repairs: InterpretationRepair[];
};

export type InterpretationGenerationResult =
  | {
      status: "validated";
      output: InterpretationOutputV8;
      attempts: InterpretationAttemptRecord[];
      repairs: InterpretationRepair[];
      /** Set when no attempt passed every check and the failing parts of the last checked output were removed. */
      salvage: (InterpretationSalvage & { from_attempt: number }) | null;
    }
  | { status: "failed"; reason: string; transient: boolean; attempts: InterpretationAttemptRecord[] };

export async function generateInterpretationV8(input: {
  provider: LlmProvider;
  model_config: AgentModelConfig;
  model_input: InterpretationInputV8;
  max_attempts?: number;
  timeout_ms?: number;
  /** Called before each provider call (production creates the AgentCall row here). */
  on_attempt_start?: (attempt: { attempt: number; client_request_id: string; provider_input: unknown }) => Promise<void>;
  /** Called after each attempt with its outcome (production updates the AgentCall row). */
  on_attempt_end?: (record: InterpretationAttemptRecord) => Promise<void>;
  /** Waits between attempts after a transient provider failure (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}): Promise<InterpretationGenerationResult> {
  const attempts: InterpretationAttemptRecord[] = [];
  let previousIssues: InterpretationIssue[] = [];
  let lastReason = "provider_failure";
  let lastInvalid: { attempt: number; output: InterpretationOutputV8; issues: InterpretationIssue[]; repairs: InterpretationRepair[] } | null = null;
  let lastFailureResult: StructuredAgentResult<InterpretationOutputV8> | null = null;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = input.max_attempts ?? INTERPRETATION_V8_MAX_ATTEMPTS;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1 && (lastReason === "provider_exception" || TRANSIENT_PROVIDER_FAILURES.has(lastReason))) {
      await sleep(backoffMs(lastFailureResult));
    }
    const clientRequestId = `interpretation_v8_${randomUUID()}`;
    const providerInput = previousIssues.length
      ? { ...input.model_input, previous_attempt_rejected_for: previousIssues.slice(0, 30) }
      : input.model_input;
    await input.on_attempt_start?.({ attempt, client_request_id: clientRequestId, provider_input: providerInput });
    let result: StructuredAgentResult<InterpretationOutputV8>;
    try {
      result = await input.provider.executeStructured({
        agent_name: INTERPRETATION_V8_AGENT_NAME,
        model_config: input.model_config,
        instructions: INTERPRETATION_V8_INSTRUCTIONS,
        input: providerInput,
        output_schema: InterpretationOutputV8Schema,
        schema_name: INTERPRETATION_V8_SCHEMA_VERSION.replace(/[^a-zA-Z0-9_-]/g, "_"),
        client_request_id: clientRequestId,
        timeout_ms: input.timeout_ms ?? PROVIDER_TIMEOUT_MS,
        metadata: { purpose: "student_interpretation_v8", prompt_version: INTERPRETATION_V8_PROMPT_VERSION, attempt: String(attempt) }
      });
    } catch {
      lastReason = "provider_exception";
      lastFailureResult = null;
      const record: InterpretationAttemptRecord = {
        attempt, client_request_id: clientRequestId, provider_input: providerInput, result: null,
        outcome: "provider_exception", issues: [], output: null, repairs: []
      };
      attempts.push(record);
      await input.on_attempt_end?.(record);
      continue;
    }
    if (result.status !== "completed" || !result.parsed_output) {
      lastReason = result.error?.category ?? result.status;
      lastFailureResult = result;
      const record: InterpretationAttemptRecord = {
        attempt, client_request_id: clientRequestId, provider_input: providerInput, result,
        outcome: "provider_failure", issues: [], output: null, repairs: []
      };
      attempts.push(record);
      await input.on_attempt_end?.(record);
      if (result.error?.retryable === false) break;
      continue;
    }
    const parsed = InterpretationOutputV8Schema.safeParse(result.parsed_output);
    const repaired = parsed.success ? repairInterpretationOutputV8(input.model_input, parsed.data) : null;
    const issues = repaired
      ? validateInterpretationOutputV8(input.model_input, repaired.output)
      : [{ path: "$", code: "schema_mismatch", message: "The output did not match the required format." }];
    if (!repaired || issues.length > 0) {
      previousIssues = issues;
      lastReason = "validation_failed";
      if (repaired) lastInvalid = { attempt, output: repaired.output, issues, repairs: repaired.repairs };
      const record: InterpretationAttemptRecord = {
        attempt, client_request_id: clientRequestId, provider_input: providerInput, result,
        outcome: "invalid_output", issues, output: repaired?.output ?? null, repairs: repaired?.repairs ?? []
      };
      attempts.push(record);
      await input.on_attempt_end?.(record);
      continue;
    }
    const record: InterpretationAttemptRecord = {
      attempt, client_request_id: clientRequestId, provider_input: providerInput, result,
      outcome: "validated", issues: [], output: repaired.output, repairs: repaired.repairs
    };
    attempts.push(record);
    await input.on_attempt_end?.(record);
    return { status: "validated", output: repaired.output, attempts, repairs: repaired.repairs, salvage: null };
  }
  // No attempt passed every check. When the last checked output can be salvaged (only its
  // failing parts removed), it is used; the fallback profile is the last resort.
  if (lastInvalid) {
    const salvaged = salvageInterpretationOutputV8(input.model_input, lastInvalid.output, lastInvalid.issues);
    if (salvaged) {
      return {
        status: "validated", output: salvaged.output, attempts, repairs: lastInvalid.repairs,
        salvage: { ...salvaged.salvage, from_attempt: lastInvalid.attempt }
      };
    }
  }
  return {
    status: "failed",
    reason: lastReason,
    transient: lastReason === "provider_exception" || TRANSIENT_PROVIDER_FAILURES.has(lastReason),
    attempts
  };
}
