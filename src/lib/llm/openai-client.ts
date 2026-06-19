import OpenAI from "openai";
import { getServerEnv } from "@/lib/env";
import { LlmConfigurationError } from "./config";

export function createOpenAIClient() {
  const env = getServerEnv();

  if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY.trim().length === 0) {
    throw new LlmConfigurationError(
      "openai_key_missing",
      "OPENAI_API_KEY is required only when live OpenAI calls are explicitly enabled."
    );
  }

  return new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    timeout: env.OPENAI_REQUEST_TIMEOUT_MS,
    maxRetries: 0
  });
}
