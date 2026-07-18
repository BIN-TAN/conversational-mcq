import { randomUUID } from "node:crypto";
import { OpenAIResponsesProvider } from "@/lib/llm/providers/openai-responses-provider";
import type { StructuredAgentResult } from "@/lib/llm/providers/types";
import { E2ABudgetGuard } from "./e2a-budget";
import {
  E2A_SIMULATOR_SCHEMA_VERSION,
  LlmStudentSimulatorInputSchema,
  LlmStudentSimulatorOutputSchema,
  type E2ASimulatorConfiguration,
  type E2ASimulatorTurnRecord,
  type E2ASimulatorValidationIssue,
  type LlmStudentSimulatorInput,
  type LlmStudentSimulatorOutput
} from "./e2a-schemas";
import { LLM_STUDENT_SIMULATOR_INSTRUCTIONS } from "./llm-student-simulator-prompt";
import { validateLlmStudentSimulatorOutput } from "./llm-student-simulator-validation";

export type E2ASimulatorProviderExecutor = (
  input: LlmStudentSimulatorInput,
  attempt: number
) => Promise<StructuredAgentResult<LlmStudentSimulatorOutput>>;

function estimatedInputTokens(input: LlmStudentSimulatorInput) {
  return Math.max(1, Math.ceil((LLM_STUDENT_SIMULATOR_INSTRUCTIONS.length + JSON.stringify(input).length) / 3));
}

export class LlmStudentSimulatorContractError extends Error {
  constructor(
    readonly validation_failures: E2ASimulatorValidationIssue[],
    readonly simulator_call_ids: string[]
  ) {
    super("e2a_simulator_contract_failure");
    this.name = "LlmStudentSimulatorContractError";
  }
}

export class LlmStudentSimulator {
  private readonly provider = new OpenAIResponsesProvider();

  constructor(
    private readonly configuration: E2ASimulatorConfiguration,
    private readonly budget: E2ABudgetGuard,
    private readonly providerExecutor?: E2ASimulatorProviderExecutor
  ) {}

  private execute(input: LlmStudentSimulatorInput, attempt: number) {
    if (this.providerExecutor) return this.providerExecutor(input, attempt);
    return this.provider.executeStructured({
      agent_name: "evaluation_llm_student_simulator",
      model_config: {
        model_name: this.configuration.model_name,
        temperature: this.configuration.temperature,
        max_output_tokens: this.configuration.max_output_tokens
      },
      instructions: LLM_STUDENT_SIMULATOR_INSTRUCTIONS,
      input,
      output_schema: LlmStudentSimulatorOutputSchema,
      schema_name: E2A_SIMULATOR_SCHEMA_VERSION,
      client_request_id: `e2a_sim_${randomUUID()}`,
      timeout_ms: this.configuration.timeout_ms,
      metadata: {
        evaluation_phase: "e2a",
        call_role: "llm_student_simulator",
        scenario_id: input.scenario_id,
        expression_variant: String(input.expression_variant)
      }
    });
  }

  async render(input: {
    turn_id: string;
    simulator_input: LlmStudentSimulatorInput;
    previous_student_messages?: string[];
  }): Promise<{ output: LlmStudentSimulatorOutput; record: E2ASimulatorTurnRecord }> {
    const simulatorInput = LlmStudentSimulatorInputSchema.parse(input.simulator_input);
    const callIds: string[] = [];
    const validationFailures: E2ASimulatorValidationIssue[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalLatency = 0;

    for (let attempt = 0; attempt <= this.configuration.max_regeneration_attempts; attempt += 1) {
      this.budget.assertCanCallSimulator({
        estimated_input_tokens: estimatedInputTokens(simulatorInput),
        maximum_output_tokens: this.configuration.max_output_tokens
      });
      const result = await this.execute(simulatorInput, attempt);
      callIds.push(result.provider_response_id ?? result.provider_request_id ?? result.client_request_id);
      const inputTokens = result.usage?.input_tokens ?? estimatedInputTokens(simulatorInput);
      const outputTokens = result.usage?.output_tokens ?? 0;
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      totalLatency += result.latency_ms;
      this.budget.recordSimulatorCall({ input_tokens: inputTokens, output_tokens: outputTokens });

      if (result.status !== "completed" || !result.parsed_output) {
        validationFailures.push({
          rule_code: "provider_failure",
          field_path: "provider_result",
          safe_detail: `Provider result was ${result.status}.`
        });
        continue;
      }
      const validation = validateLlmStudentSimulatorOutput({
        simulator_input: simulatorInput,
        output: result.parsed_output,
        previous_student_messages: input.previous_student_messages
      });
      validationFailures.push(...validation.issues);
      if (!validation.valid) continue;

      const output = validation.output;
      return {
        output,
        record: {
          turn_id: input.turn_id,
          scenario_id: simulatorInput.scenario_id,
          expression_variant: simulatorInput.expression_variant,
          deterministic_intent: simulatorInput.permitted_response.intent,
          rendered_message: output.student_message,
          rendered_intent: output.rendered_intent,
          expressed_evidence_level: output.expressed_evidence_level,
          provider: this.providerExecutor ? "injected_no_live_test" : "openai",
          simulator_call_ids: callIds,
          input_token_count: totalInputTokens,
          output_token_count: totalOutputTokens,
          latency_ms: totalLatency,
          retry_count: attempt,
          validation_failures: validationFailures,
          configuration_hash: this.configuration.configuration_hash
        }
      };
    }

    throw new LlmStudentSimulatorContractError(validationFailures, callIds);
  }
}
