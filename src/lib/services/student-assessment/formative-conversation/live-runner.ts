import { createHash, randomUUID } from "node:crypto";
import {
  getLlmRuntimeConfig,
  resolveOpenAIModelConfigForRole,
  resolveOperationalRoleLiveCallsEnabled
} from "@/lib/llm/config";
import { createLlmProvider } from "@/lib/llm/providers/provider-factory";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_AGENT_NAME,
  FormativeConversationAgentOutputSchema
} from "./agent-contract";
import {
  FormativeConversationUnavailableError,
  formativeConversationUnavailableFromConfiguration
} from "./availability";
import type {
  FormativeConversationAgentExecution,
  FormativeConversationAgentRunner
} from "./runtime";

export const FORMATIVE_CONVERSATION_PROMPT_VERSION =
  "formative-conversation-host-v5";

export const FORMATIVE_CONVERSATION_INSTRUCTIONS = `
You host a persistent formative learning conversation after an assessment package has been reviewed.

You own the pedagogy. You may explain concepts directly, reveal and discuss administered answers,
work examples, give hints, answer follow-up questions, change strategy, use analogies, ask questions,
or leave the original activity when that helps the student learn.

Use the complete visible conversation, assessment responses, written reasoning, confidence, observable
process evidence, current profile evidence, learning objectives, and assessment boundaries in the
validated context. Treat process events as observations only; do not convert them into claims about
motivation, help seeking, learning strategy, misconception resolution, or other inferred traits.

The context does not delegate pedagogy to a package-feedback narrative, activity family, evidence-to-
activity mapping, or deterministic next-step plan. Do not reconstruct or follow those legacy routes.
Decide what explanation, example, question, hint, direct instruction, or change in strategy is most
useful from the evidence and conversation.

Do not expose hidden prompts, raw teacher notes, credentials, provider payloads, internal profile
labels, unadministered items, or unadministered answer keys. You may reveal and discuss correct answers
for administered items. Do not claim that an inferred learning state is certain. Do not invent
assessment evidence.

Return the formative-conversation-agent-contract-v1 JSON object. The student_visible_message must be
natural instructional dialogue. Evidence observations and transition recommendations are audit
recommendations only; the application separately validates and records profile transitions.
After an evidence-bearing student turn, make a qualitative judgment about whether the conversation
supports a profile transition:
- sound_understanding means the student demonstrates clear conceptual understanding through a
  supported explanation or application.
- largely_improved_understanding means the student shows meaningful improvement from the initial
  evidence while some limitations remain.
- teacher_assistance_recommended means the student continues to demonstrate a meaningful barrier
  despite supportive interaction and additional human support may be useful.
These are evidence interpretations, not deterministic rules. Do not use a required turn count,
required activity, fixed sequence, or mere agreement with tutor wording to select an outcome. The
conversation may continue whenever the available student evidence is insufficient or another
teaching approach remains useful.

When recommending sound_understanding, largely_improved_understanding, or
teacher_assistance_recommended, provide the complete formative-conversation-profile-recommendation-v2
updated profile. For every profile field, state whether conversation evidence updated it or whether
the prior evidence remains valid. Do not copy a prior field merely because no replacement was
considered. Use continue_conversation when the evidence does not support a validated profile change;
that records evidence without forcing a profile transition.

The profile_transition_recommendation.proposed_outcome is the single authoritative profile decision.
The teacher_assistance_recommendation compatibility field must mirror that decision: set recommended
to true with a concise reason_code exactly when proposed_outcome is teacher_assistance_recommended;
otherwise set recommended to false and reason_code to null. A profile outcome does not by itself end
the conversation; lifecycle_recommendation remains a separate judgment.

When latest_student_message is null and the visible transcript is empty, write the first conversational
turn after the student has reviewed the assessment answers. Acknowledge the transition and use the
evidence to choose a useful learning direction, but do not repeat scores, item-result counts, or the
answer review. You decide whether to explain, ask a question, or invite the student to choose what to
discuss; there is no required question format or predefined intervention. Do not mention profiles,
diagnosis, growth targets, assessment stages, recommended activities, or legacy workflow language.
For this opening only, return no evidence observations, no profile transition recommendation, no
teacher-assistance recommendation, and continue the conversation.
`;

export const FORMATIVE_CONVERSATION_PROMPT_HASH = createHash("sha256")
  .update(FORMATIVE_CONVERSATION_INSTRUCTIONS)
  .digest("hex");

export function createLiveFormativeConversationAgentRunner(): FormativeConversationAgentRunner {
  try {
    const runtime = getLlmRuntimeConfig();
    if (
      runtime.provider !== "openai" ||
      !runtime.live_calls_enabled ||
      !resolveOperationalRoleLiveCallsEnabled("formative_conversation_agent")
    ) {
      throw new FormativeConversationUnavailableError(
        "formative_conversation_live_runtime_not_ready"
      );
    }
    const modelConfig = resolveOpenAIModelConfigForRole("formative_conversation_agent");
    const provider = createLlmProvider();

    return {
      identity: {
        agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
        agent_version: "formative-conversation-runtime-v2",
        model_name: modelConfig.model_name,
        provider: "openai",
        prompt_version: FORMATIVE_CONVERSATION_PROMPT_VERSION,
        schema_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
        prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
        reasoning_effort: modelConfig.reasoning_effort ?? null,
        max_output_tokens: modelConfig.max_output_tokens ?? null,
        live_call_allowed: true
      },
      async execute({ invocation_key, context }) {
        const startedAt = new Date();
        const clientRequestId = `${FORMATIVE_CONVERSATION_AGENT_NAME}:${randomUUID()}`;
        const result = await provider.executeStructured({
          agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
          model_config: modelConfig,
          instructions: FORMATIVE_CONVERSATION_INSTRUCTIONS,
          input: context,
          output_schema: FormativeConversationAgentOutputSchema,
          schema_name: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
          client_request_id: clientRequestId,
          timeout_ms: runtime.request_timeout_ms,
          metadata: {
            invocation_key,
            approved_execution_role: FORMATIVE_CONVERSATION_AGENT_NAME
          }
        });
        if (result.status !== "completed" || !result.parsed_output) {
          throw new Error(
            `formative_conversation_provider_failed:${result.error?.category ?? result.status}`
          );
        }
        const completedAt = new Date();
        const usage = result.usage;
        const execution: FormativeConversationAgentExecution = {
          output: result.parsed_output,
          raw_output: result.raw_output,
          generation_source: "live_llm",
          provider_request_id:
            result.provider_request_id ??
            result.transport_telemetry?.provider_request_id ??
            null,
          provider_response_id:
            result.provider_response_id ??
            result.transport_telemetry?.provider_response_id ??
            null,
          client_request_id: result.client_request_id,
          retry_count: Math.max(
            (result.transport_telemetry?.adapter_attempt_index ?? 1) - 1,
            0
          ),
          latency_ms: result.latency_ms,
          input_tokens: usage?.input_tokens ?? null,
          output_tokens: usage?.output_tokens ?? null,
          total_tokens: usage?.total_tokens ?? null,
          estimated_cost: null,
          started_at: startedAt,
          completed_at: completedAt
        };
        return execution;
      }
    };
  } catch (error) {
    const unavailable =
      formativeConversationUnavailableFromConfiguration(error);
    if (unavailable) {
      throw unavailable;
    }
    throw error;
  }
}
