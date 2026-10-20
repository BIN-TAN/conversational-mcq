import type { AgentModelConfig } from "@/lib/llm/config";
import type { LlmProvider, StructuredAgentRequest, StructuredAgentResult } from "@/lib/llm/providers/types";
import {
  FEEDBACK_V8_AGENT_NAME,
  FEEDBACK_V8_PROMPT_HASH,
  type FeedbackV8Input,
  type FeedbackV8Output
} from "@/lib/services/student-assessment/feedback-v8/contract";
import { buildLocalTestFeedbackV8 } from "@/lib/services/student-assessment/feedback-v8/local-test";
import { FeedbackV8ExecutionError, generateFeedbackV8 } from "@/lib/services/student-assessment/feedback-v8/runner";
import {
  INTERPRETATION_V8_AGENT_NAME,
  INTERPRETATION_V8_PROMPT_HASH,
  type InterpretationInputV8,
  type InterpretationOutputV8
} from "@/lib/services/student-assessment/interpretation-v8/contract";
import { generateInterpretationV8 } from "@/lib/services/student-assessment/interpretation-v8/generate";
import { buildLocalTestInterpretationV8 } from "@/lib/services/student-assessment/interpretation-v8/local-test";
import { buildCaseInput, type EvaluationCase, type ItemBank } from "./case-model";
import { buildFeedbackCaseInput, type FeedbackCase } from "./feedback-case-model";

/**
 * Runs the evaluation cases through the production generation loops (generateInterpretationV8
 * and generateFeedbackV8): the same prompts, output checks and single regeneration. Nothing
 * here touches the database. "local" uses the deterministic stand-ins, which only exercise
 * the pipeline; "live" calls the configured model and costs money.
 */
export type EvaluationEngine =
  | { kind: "local" }
  | {
      kind: "live";
      provider: LlmProvider;
      interpretation_model: AgentModelConfig;
      feedback_model: AgentModelConfig;
    };

export type AttemptSummary = {
  attempt: number;
  outcome: string;
  issues: Array<{ path: string; code: string; message: string }>;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
};

export type InterpretationRunRecord = {
  kind: "interpretation";
  case_id: string;
  run: number;
  engine: EvaluationEngine["kind"];
  model_name: string;
  prompt_hash: string;
  status: "validated" | "failed";
  reason: string | null;
  attempts: AttemptSummary[];
  output: InterpretationOutputV8 | null;
  /** Mechanical repairs applied to the accepted output. */
  repairs?: Array<{ path: string; code: string }>;
  /** Set when the accepted output was salvaged (failing parts removed). */
  salvage?: {
    unrated_item_ids: string[];
    dropped_misconceptions: number;
    dropped_considered_ideas: number;
    cleared_fields: string[];
    remaining_issue_codes: string[];
    from_attempt: number;
  } | null;
  started_at: string;
  completed_at: string;
};

export type FeedbackRunRecord = {
  kind: "feedback";
  feedback_case_id: string;
  run: number;
  engine: EvaluationEngine["kind"];
  model_name: string;
  prompt_hash: string;
  status: "validated" | "failed";
  reason: string | null;
  attempts: AttemptSummary[];
  output: FeedbackV8Output | null;
  started_at: string;
  completed_at: string;
};

export type RunRecord = InterpretationRunRecord | FeedbackRunRecord;

function withoutRejections<T>(input: T): T {
  if (!input || typeof input !== "object") return input;
  const { previous_attempt_rejected_for: _ignored, ...rest } = input as Record<string, unknown>;
  return rest as T;
}

/** A provider that answers with the deterministic local-test outputs. */
export const localStandInProvider: LlmProvider = {
  async executeStructured<TInput, TOutput>(request: StructuredAgentRequest<TInput, TOutput>): Promise<StructuredAgentResult<TOutput>> {
    const input = withoutRejections(request.input);
    const output = request.agent_name === INTERPRETATION_V8_AGENT_NAME
      ? buildLocalTestInterpretationV8(input as unknown as InterpretationInputV8)
      : request.agent_name === FEEDBACK_V8_AGENT_NAME
        ? buildLocalTestFeedbackV8(input as unknown as FeedbackV8Input)
        : null;
    if (!output) {
      return {
        provider: "mock", client_request_id: request.client_request_id, status: "failed", latency_ms: 0,
        error: { category: "configuration", message: `No local stand-in for ${request.agent_name}.`, retryable: false }
      };
    }
    return { provider: "mock", client_request_id: request.client_request_id, status: "completed", parsed_output: output as TOutput, latency_ms: 1 };
  }
};

const LOCAL_MODEL: AgentModelConfig = { model_name: "local-test-stand-in" };

export async function runInterpretationCase(input: {
  bank: ItemBank;
  evaluation_case: EvaluationCase;
  run: number;
  engine: EvaluationEngine;
}): Promise<InterpretationRunRecord> {
  const startedAt = new Date();
  const provider = input.engine.kind === "live" ? input.engine.provider : localStandInProvider;
  const modelConfig = input.engine.kind === "live" ? input.engine.interpretation_model : LOCAL_MODEL;
  const result = await generateInterpretationV8({
    provider,
    model_config: modelConfig,
    model_input: buildCaseInput(input.bank, input.evaluation_case),
    sleep: input.engine.kind === "live" ? undefined : async () => undefined
  });
  return {
    kind: "interpretation",
    case_id: input.evaluation_case.case_id,
    run: input.run,
    engine: input.engine.kind,
    model_name: modelConfig.model_name,
    prompt_hash: INTERPRETATION_V8_PROMPT_HASH,
    status: result.status,
    reason: result.status === "failed" ? result.reason : null,
    attempts: result.attempts.map((attempt) => ({
      attempt: attempt.attempt,
      outcome: attempt.outcome,
      issues: attempt.issues.map(({ path, code, message }) => ({ path, code, message })),
      latency_ms: attempt.result?.latency_ms ?? null,
      input_tokens: attempt.result?.usage?.input_tokens ?? null,
      output_tokens: attempt.result?.usage?.output_tokens ?? null
    })),
    output: result.status === "validated" ? result.output : null,
    repairs: result.status === "validated" ? result.repairs : [],
    salvage: result.status === "validated" ? result.salvage : null,
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString()
  };
}

export async function runFeedbackCase(input: {
  bank: ItemBank;
  base_case: EvaluationCase;
  feedback_case: FeedbackCase;
  run: number;
  engine: EvaluationEngine;
}): Promise<FeedbackRunRecord> {
  const startedAt = new Date();
  const provider = input.engine.kind === "live" ? input.engine.provider : localStandInProvider;
  const modelConfig = input.engine.kind === "live" ? input.engine.feedback_model : LOCAL_MODEL;
  const base = {
    kind: "feedback" as const,
    feedback_case_id: input.feedback_case.feedback_case_id,
    run: input.run,
    engine: input.engine.kind,
    model_name: modelConfig.model_name,
    prompt_hash: FEEDBACK_V8_PROMPT_HASH,
    started_at: startedAt.toISOString()
  };
  try {
    const execution = await generateFeedbackV8({
      provider,
      model_config: modelConfig,
      invocation_key: `evaluation:${input.feedback_case.feedback_case_id}:${input.run}`,
      context: buildFeedbackCaseInput(input.bank, input.base_case, input.feedback_case)
    });
    const rejected = (execution.raw_output as { rejected_attempts?: Array<{ attempt: number; status: string; issues: AttemptSummary["issues"]; latency_ms: number }> })?.rejected_attempts ?? [];
    return {
      ...base,
      status: "validated",
      reason: null,
      attempts: [
        ...rejected.map((attempt) => ({ attempt: attempt.attempt, outcome: attempt.status, issues: attempt.issues, latency_ms: attempt.latency_ms, input_tokens: null, output_tokens: null })),
        { attempt: execution.retry_count + 1, outcome: "validated", issues: [], latency_ms: execution.latency_ms, input_tokens: execution.input_tokens ?? null, output_tokens: execution.output_tokens ?? null }
      ],
      output: execution.output,
      completed_at: new Date().toISOString()
    };
  } catch (error) {
    if (!(error instanceof FeedbackV8ExecutionError)) throw error;
    return {
      ...base,
      status: "failed",
      reason: error.failure_class,
      attempts: error.attempts.map((attempt) => ({
        attempt: attempt.attempt, outcome: attempt.status, issues: attempt.issues, latency_ms: attempt.latency_ms, input_tokens: null, output_tokens: null
      })),
      output: null,
      completed_at: new Date().toISOString()
    };
  }
}
