import { getLlmRuntimeConfig } from "@/lib/llm/config";
import { MockLlmProvider } from "./mock-provider";
import {
  OPENAI_RESPONSES_ADAPTER_VERSION,
  OpenAIResponsesProvider
} from "./openai-responses-provider";
import type { LlmProvider } from "./types";

export type LlmProviderDescriptor =
  | {
      provider: "mock";
      transport: "mock";
      adapter_version: "mock-provider-v1";
      network_dispatch_expected: false;
    }
  | {
      provider: "openai";
      transport: "openai_responses";
      adapter_version: typeof OPENAI_RESPONSES_ADAPTER_VERSION;
      network_dispatch_expected: true;
    };

export function resolveLlmProviderDescriptor(): LlmProviderDescriptor {
  const config = getLlmRuntimeConfig();

  if (config.provider === "mock") {
    return {
      provider: "mock",
      transport: "mock",
      adapter_version: "mock-provider-v1",
      network_dispatch_expected: false
    };
  }

  return {
    provider: "openai",
    transport: "openai_responses",
    adapter_version: OPENAI_RESPONSES_ADAPTER_VERSION,
    network_dispatch_expected: true
  };
}

export function createLlmProvider(): LlmProvider {
  const config = getLlmRuntimeConfig();

  if (config.provider === "mock") {
    return new MockLlmProvider();
  }

  return new OpenAIResponsesProvider();
}
