import OpenAI from "openai";
import {
  isApprovedOpenAIBaseUrl,
  resolveOpenAIBaseUrl
} from "@/lib/llm/openai-transport-diagnostics";
import {
  currentResolvedOpenAICredential,
  resolveOpenAICredentialFromEnv,
  type ResolvedOpenAICredential
} from "@/lib/llm/openai-credential-resolver";
import { getLlmRuntimeConfig, LlmConfigurationError } from "./config";

export type OpenAIClientTransportInstrumentation = {
  credential?: ResolvedOpenAICredential;
  onFetchInvoked?: (input: { url: string; method: string }) => void | Promise<void>;
  onResponseHeadersReceived?: (input: {
    url: string;
    status: number;
    request_id: string | null;
    retry_after_ms: number | null;
  }) => void | Promise<void>;
};

function retryAfterMs(headers: Headers) {
  const retryAfterMsHeader = headers.get("retry-after-ms");
  if (retryAfterMsHeader && Number.isFinite(Number(retryAfterMsHeader))) {
    return Number(retryAfterMsHeader);
  }
  const retryAfter = headers.get("retry-after");
  if (retryAfter && Number.isFinite(Number(retryAfter))) {
    return Number(retryAfter) * 1000;
  }
  return null;
}

export function createOpenAIClient(instrumentation?: OpenAIClientTransportInstrumentation) {
  const runtime = getLlmRuntimeConfig();
  const credential =
    instrumentation?.credential ??
    currentResolvedOpenAICredential() ??
    (() => {
      const resolved = resolveOpenAICredentialFromEnv(process.env);
      if (!resolved.ok) {
        throw new LlmConfigurationError(resolved.code, resolved.message);
      }
      return resolved.credential;
    })();

  if (!credential.credential || credential.credential.length === 0) {
    throw new LlmConfigurationError(
      "openai_key_missing",
      "A resolved OpenAI credential is required only when live OpenAI calls are explicitly enabled."
    );
  }

  const baseURL = resolveOpenAIBaseUrl();
  const fetchWithTelemetry: typeof fetch = async (input, init) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const method = init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "POST");
    await instrumentation?.onFetchInvoked?.({ url, method: method ?? "POST" });
    const response = await fetch(input, init);
    await instrumentation?.onResponseHeadersReceived?.({
      url,
      status: response.status,
      request_id: response.headers.get("x-request-id") ?? response.headers.get("request-id"),
      retry_after_ms: retryAfterMs(response.headers)
    });
    return response;
  };

  return new OpenAI({
    apiKey: credential.credential,
    ...(isApprovedOpenAIBaseUrl(baseURL) ? {} : { baseURL }),
    timeout: runtime.request_timeout_ms,
    maxRetries: 0,
    ...(instrumentation ? { fetch: fetchWithTelemetry } : {})
  });
}
