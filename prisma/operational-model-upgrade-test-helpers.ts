import type {
  LlmProvider,
  StructuredAgentRequest,
  StructuredAgentResult
} from "../src/lib/llm/providers/types";
import type { CandidateEvaluationOutput } from "../src/lib/operational/model-upgrade-evaluation";

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export class FakeCandidateEvaluationProvider implements LlmProvider {
  calls = 0;
  failAfterCalls: number | null;
  forbiddenText: string | null;

  constructor(input: { failAfterCalls?: number | null; forbiddenText?: string | null } = {}) {
    this.failAfterCalls = input.failAfterCalls ?? null;
    this.forbiddenText = input.forbiddenText ?? null;
  }

  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    this.calls += 1;
    if (this.failAfterCalls !== null && this.calls > this.failAfterCalls) {
      throw new Error("synthetic_interruption_after_successful_case");
    }
    const input = request.input as {
      fixture_id: string;
      target_role: string;
      human_review_requirement?: { student_facing?: boolean; teacher_facing?: boolean };
      synthetic_input_context?: { expected_behavior?: string };
    };
    const output: CandidateEvaluationOutput = {
      fixture_id: input.fixture_id,
      role: input.target_role as CandidateEvaluationOutput["role"],
      response_status: input.fixture_id.includes("unrelated") ? "redirected" : "answered",
      output_kind: input.human_review_requirement?.teacher_facing
        ? "teacher_tool"
        : input.target_role === "connectivity_test" ? "utility" : "student_facing",
      response_summary: `Synthetic candidate response for ${input.fixture_id}.`,
      student_facing_text: input.human_review_requirement?.student_facing
        ? this.forbiddenText ??
          (input.target_role === "student_communication_agent"
            ? "You completed three items. Two explanations used reliability and validity carefully; one still needs a clearer boundary."
            : `Here is a concise response for ${input.fixture_id}.`)
        : null,
      teacher_facing_text: input.human_review_requirement?.teacher_facing
        ? `Teacher review summary for ${input.fixture_id}.`
        : null,
      decision_summary: input.synthetic_input_context?.expected_behavior ?? "Synthetic decision summary.",
      evidence_used: ["fixed synthetic fixture context"],
      safety_notes: [],
      next_action: "Continue the synthetic review.",
      confidence: "medium"
    };

    return {
      provider: "openai",
      provider_request_id: `req_${input.fixture_id}`,
      provider_response_id: `resp_${input.fixture_id}`,
      client_request_id: request.client_request_id,
      status: "completed",
      parsed_output: output as TOutput,
      raw_output: {
        id: `resp_${input.fixture_id}`,
        status: "completed",
        output_parsed: output
      },
      usage: {
        input_tokens: 100,
        output_tokens: 80,
        total_tokens: 180,
        reasoning_tokens: 10
      },
      latency_ms: 25,
      transport_telemetry: {
        provider: "openai",
        transport: "openai_responses",
        adapter_version: "fake-openai-responses-adapter-for-smoke",
        client_request_id: request.client_request_id,
        model_name: request.model_config.model_name,
        base_url_host: "api.openai.com",
        base_url_approved: true,
        transport_adapter_entered: true,
        request_serialization_completed: true,
        fetch_invoked: true,
        response_headers_received: true,
        response_body_received: true,
        provider_request_id: `req_${input.fixture_id}`,
        provider_response_id: `resp_${input.fixture_id}`,
        transport_outcome: "live_provider_success",
        raw_output_outcome: "valid",
        effective_system_outcome: "provider_output_used",
        fallback_reason: null
      }
    };
  }
}
