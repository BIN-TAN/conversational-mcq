import { APIError } from "openai";
import type { SanitizedAgentError } from "./providers/types";

export function sanitizeUnknownError(error: unknown): SanitizedAgentError {
  if (error instanceof APIError) {
    const status = error.status;
    const code = typeof error.code === "string" ? error.code : "";
    const message = error.message ?? "";

    if (!status) {
      if (/timeout|timed out|abort/i.test(message)) {
        return {
          category: "timeout",
          message: "Provider request timed out.",
          retryable: true
        };
      }

      if (/network|fetch|econnreset|enotfound|connection/i.test(message)) {
        return {
          category: "network",
          message: "Provider network request failed.",
          retryable: true
        };
      }

      if (/structured outputs?|zodTextFormat|optional\(\)|json schema/i.test(message)) {
        return {
          category: "provider_request_schema_invalid",
          message: "Provider-facing Structured Outputs schema is invalid.",
          retryable: false
        };
      }
    }

    if (status === 401) {
      return {
        category: "authentication",
        message: "OpenAI authentication failed.",
        retryable: false
      };
    }

    if (status === 403) {
      return {
        category: "permission",
        message: "OpenAI request is forbidden for this project, model, or account.",
        retryable: false
      };
    }

    if (status === 429) {
      return {
        category: code.includes("quota") ? "quota" : "rate_limit",
        message: code.includes("quota")
          ? "OpenAI quota was exhausted."
          : "OpenAI rate limit was reached.",
        retryable: !code.includes("quota")
      };
    }

    if (status && status >= 500) {
      return {
        category: "provider_5xx",
        message: "OpenAI returned a temporary server error.",
        retryable: true
      };
    }

    return {
      category: "invalid_request",
      message: "OpenAI rejected the request.",
      retryable: false
    };
  }

  if (error instanceof Error && /timeout|timed out|abort/i.test(error.message)) {
    return {
      category: "timeout",
      message: "Provider request timed out.",
      retryable: true
    };
  }

  if (error instanceof Error && /network|fetch|econnreset|enotfound/i.test(error.message)) {
    return {
      category: "network",
      message: "Provider network request failed.",
      retryable: true
    };
  }

  if (
    error instanceof Error &&
    /structured outputs?|zodTextFormat|optional\(\)|json schema/i.test(error.message)
  ) {
    return {
      category: "provider_request_schema_invalid",
      message: "Provider-facing Structured Outputs schema is invalid.",
      retryable: false
    };
  }

  return {
    category: "unexpected_provider_response",
    message: error instanceof Error ? error.message : "Unexpected provider error.",
    retryable: false
  };
}
