import { createHash } from "node:crypto";
import { getLlmRuntimeConfig } from "@/lib/llm/config";
import {
  resolveTopicDialogueExecutionPlan,
  type FormativeExecutionMode
} from "@/lib/services/student-assessment/formative-execution-mode";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_AGENT_NAME
} from "./agent-contract";
import {
  FormativeConversationUnavailableError,
  formativeConversationUnavailableFromConfiguration
} from "./availability";
import { createLiveFormativeConversationV18AgentRunner } from "./live-runner-v18";
import { FORMATIVE_CONVERSATION_OPENING_VERSION } from "./opening-contract";
import type {
  AnyFormativeConversationAgentRunner,
  FormativeConversationAgentRunner
} from "./runtime";

const NO_LIVE_OPENING_FIXTURE =
  "You've reviewed your answers. We can now discuss whichever part would be most useful to you.";

function noLiveOpeningTestRunner(): FormativeConversationAgentRunner {
  return {
    identity: {
      agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
      agent_version: FORMATIVE_CONVERSATION_OPENING_VERSION,
      model_name: "deterministic-formative-conversation-opening",
      provider: "mock",
      prompt_version: FORMATIVE_CONVERSATION_OPENING_VERSION,
      schema_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
      prompt_hash: createHash("sha256")
        .update(FORMATIVE_CONVERSATION_OPENING_VERSION)
        .digest("hex"),
      reasoning_effort: null,
      max_output_tokens: 500,
      live_call_allowed: false
    },
    async execute() {
      const startedAt = new Date();
      const completedAt = new Date(startedAt.getTime() + 1);
      return {
        output: {
          contract_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
          student_visible_message: NO_LIVE_OPENING_FIXTURE,
          teaching_artifact: null,
          evidence_observations: [],
          profile_transition_recommendation: null,
          teacher_assistance_recommendation: {
            recommended: false,
            reason_code: null
          },
          lifecycle_recommendation: "continue"
        },
        raw_output: {
          adapter: "deterministic_test",
          opening_version: FORMATIVE_CONVERSATION_OPENING_VERSION
        },
        generation_source: "deterministic_test",
        retry_count: 0,
        latency_ms: 1,
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
        estimated_cost: 0,
        started_at: startedAt,
        completed_at: completedAt
      };
    }
  };
}

export function createFormativeConversationOpeningRunner(
  executionMode: FormativeExecutionMode
): AnyFormativeConversationAgentRunner {
  try {
    const executionPlan = resolveTopicDialogueExecutionPlan(executionMode);

    if (executionPlan.adapter === "configured_live_runtime") {
      const runtime = getLlmRuntimeConfig();
      if (runtime.provider === "openai" && runtime.live_calls_enabled) {
        return createLiveFormativeConversationV18AgentRunner();
      }
      if (runtime.provider === "mock" && process.env.NODE_ENV !== "production") {
        return noLiveOpeningTestRunner();
      }
      throw new FormativeConversationUnavailableError(
        "formative_conversation_opening_live_runtime_not_ready"
      );
    }

    if (executionPlan.adapter === "no_generation") {
      throw new FormativeConversationUnavailableError(
        "formative_conversation_opening_generation_disabled"
      );
    }

    return noLiveOpeningTestRunner();
  } catch (error) {
    const unavailable =
      formativeConversationUnavailableFromConfiguration(error);
    if (unavailable) {
      throw unavailable;
    }
    throw error;
  }
}
