import { getLlmRuntimeConfig } from "@/lib/llm/config";
import { MockLlmProvider } from "./mock-provider";
import { OpenAIResponsesProvider } from "./openai-responses-provider";
import type { LlmProvider } from "./types";

export function createLlmProvider(): LlmProvider {
  const config = getLlmRuntimeConfig();

  if (config.provider === "mock") {
    return new MockLlmProvider();
  }

  return new OpenAIResponsesProvider();
}
