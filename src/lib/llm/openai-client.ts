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
  isolatedEvaluationRuntime?: {
    purpose: "bounded_candidate_evaluation";
    request_timeout_ms: number;
  };
  onFetchInvoked?: (input: { url: string; method: string }) => void | Promise<void>;
  onResponseHeadersReceived?: (input: {
    url: string;
    status: number;
    request_id: string | null;
    retry_after_ms: number | null;
  }) => void | Promise<void>;
  onResponseBodyStarted?: (input: {
    url: string;
    bytes_received: number;
  }) => void | Promise<void>;
  onResponseBodyProgress?: (input: {
    url: string;
    bytes_received: number;
  }) => void | Promise<void>;
  onResponseBodyCompleted?: (input: {
    url: string;
    bytes_received: number;
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

export async function instrumentOpenAIResponseBody(
  response: Response,
  url: string,
  instrumentation?: OpenAIClientTransportInstrumentation
) {
  if (!response.body) {
    await instrumentation?.onResponseBodyCompleted?.({
      url,
      bytes_received: 0
    });
    return response;
  }

  const reader = response.body.getReader();
  let bytesReceived = 0;
  let bodyStarted = false;
  const observedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          await instrumentation?.onResponseBodyCompleted?.({
            url,
            bytes_received: bytesReceived
          });
          controller.close();
          return;
        }
        bytesReceived += chunk.value.byteLength;
        if (!bodyStarted) {
          bodyStarted = true;
          await instrumentation?.onResponseBodyStarted?.({
            url,
            bytes_received: bytesReceived
          });
        }
        await instrumentation?.onResponseBodyProgress?.({
          url,
          bytes_received: bytesReceived
        });
        controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    }
  });
  return new Response(observedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

export function createOpenAIClient(instrumentation?: OpenAIClientTransportInstrumentation) {
  const isolatedRuntime = instrumentation?.isolatedEvaluationRuntime;
  if (isolatedRuntime && (
    !Number.isInteger(isolatedRuntime.request_timeout_ms) ||
    isolatedRuntime.request_timeout_ms < 1_000 ||
    isolatedRuntime.request_timeout_ms > 120_000
  )) {
    throw new LlmConfigurationError(
      "isolated_evaluation_timeout_invalid",
      "The bounded candidate evaluation timeout must be between 1000 and 120000 milliseconds."
    );
  }
  const runtime = isolatedRuntime
    ? {
        request_timeout_ms: isolatedRuntime.request_timeout_ms,
        max_retries: 0
      }
    : getLlmRuntimeConfig();
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
    return instrumentOpenAIResponseBody(
      response,
      url,
      instrumentation
    );
  };

  return new OpenAI({
    apiKey: credential.credential,
    ...(isApprovedOpenAIBaseUrl(baseURL) ? {} : { baseURL }),
    timeout: runtime.request_timeout_ms,
    maxRetries: 0,
    ...(instrumentation ? { fetch: fetchWithTelemetry } : {})
  });
}
