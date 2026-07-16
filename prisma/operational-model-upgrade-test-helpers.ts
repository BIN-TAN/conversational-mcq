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
    const studentFacingText = this.forbiddenText ?? safeStudentText(input.fixture_id, input.target_role);
    const teacherFacingText = safeTeacherText(input.fixture_id);
    const output: CandidateEvaluationOutput = {
      fixture_id: input.fixture_id,
      role: input.target_role as CandidateEvaluationOutput["role"],
      response_status: input.fixture_id.includes("unrelated") ? "redirected" : "answered",
      output_kind: input.human_review_requirement?.teacher_facing
        ? "teacher_tool"
        : input.target_role === "connectivity_test" ? "utility" : "student_facing",
      response_summary: `Synthetic candidate response for ${input.fixture_id}.`,
      student_facing_text: input.human_review_requirement?.student_facing
        ? studentFacingText
        : null,
      teacher_facing_text: input.human_review_requirement?.teacher_facing
        ? teacherFacingText
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

function safeStudentText(fixtureId: string, role: string) {
  switch (fixtureId) {
    case "item_administration_what":
      return "For Item 2, explain in one or two sentences why you chose option C. Describe the idea you used to make your choice.";
    case "item_administration_about_what":
      return "For Item 2, write why you chose option C. Describe the idea in the item that guided your choice.";
    case "item_administration_which_item_do_you_mean":
      return "I mean Item 2. Your current task is to explain why you chose your answer in one or two sentences.";
    case "item_administration_request_for_an_example":
      return "For example, you might write: I chose this option because the key idea is... Use your own idea from the item.";
    case "followup_assessment_system_question":
      return "You have completed the initial three questions. After this activity, you can choose whether to continue to the transfer item.";
    case "formative_value_determination_conceptual_need":
      return "Validity concerns evidence supporting intended interpretations and uses of scores.";
    case "student_communication_package_feedback":
      return "You completed three items. Two explanations used reliability and validity carefully; one reliability-validity explanation needs a clearer boundary. You reported high confidence there, so focus on explaining why consistency evidence is not enough for validity.";
    case "topic_dialogue_unrelated_question":
      return "I can help with this assessment or explain how to use it. Let’s return to reliability and validity. What would you like to clarify?";
    case "formative_activity_distractor_probe":
      return "For this item, option A says reliability proves validity. You now know option C is correct. Identify the exact flaw in option A, then rewrite option A so it becomes accurate.";
    default:
      return role === "student_communication_agent"
        ? "You completed the required steps and provided brief reasoning. Focus next on making the reliability-validity boundary explicit."
        : `Here is a concise response for ${fixtureId}.`;
  }
}

function safeTeacherText(fixtureId: string) {
  switch (fixtureId) {
    case "profile_integration_mixed_correctness":
      return "Evidence summary: two accurate explanations and one overgeneralized reliability-validity claim. The student completed all required response steps and provided brief reasoning. No misconduct inference is supported. Treat this as a limited, mixed snapshot rather than evidence of stable ability.";
    case "formative_activity_quality_review":
      return "The first turn is safe for review: it targets the reliability-validity misconception and asks for a rewrite in the context of score interpretation and use.";
    default:
      return `Teacher review summary for ${fixtureId}.`;
  }
}
