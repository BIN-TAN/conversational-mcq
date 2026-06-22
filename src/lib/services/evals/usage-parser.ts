import type { ResponseUsage } from "openai/resources/responses/responses";
import type { LlmUsage } from "@/lib/llm/providers/types";

type ResponseUsageLike = Partial<ResponseUsage> & {
  cached_input_tokens?: number;
  reasoning_tokens?: number;
  input_token_details?: { cached_tokens?: number };
  output_token_details?: { reasoning_tokens?: number };
  input_details?: { cached_tokens?: number };
  output_details?: { reasoning_tokens?: number };
};

type UsagePathCandidate = {
  path: string;
  value: unknown;
};

export type EvalUsageParseResult =
  | {
      ok: true;
      usage: LlmUsage;
      usage_found_at: string;
      warnings: string[];
    }
  | {
      ok: false;
      reason: "usage_missing" | "usage_malformed";
      message: string;
      usage_found_at: string | null;
      warnings: string[];
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getAtPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!isPlainObject(current)) {
      return undefined;
    }

    return current[segment];
  }, value);
}

function optionalToken(value: unknown, label: string, warnings: string[]) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    warnings.push(`${label} is not a non-negative integer.`);
    return null;
  }

  return value;
}

function requiredToken(value: unknown, label: string, warnings: string[]) {
  const parsed = optionalToken(value, label, warnings);

  return typeof parsed === "number" ? parsed : null;
}

function firstNumberAtPath(value: unknown, paths: string[], warnings: string[], label: string) {
  for (const path of paths) {
    const parsed = optionalToken(getAtPath(value, path), label, warnings);

    if (typeof parsed === "number") {
      return parsed;
    }

    if (parsed === null) {
      return null;
    }
  }

  return undefined;
}

function parseUsageObject(value: unknown, path: string): EvalUsageParseResult {
  const warnings: string[] = [];

  if (!isPlainObject(value)) {
    return {
      ok: false,
      reason: "usage_malformed",
      message: `Provider usage at ${path} is not an object.`,
      usage_found_at: path,
      warnings
    };
  }

  const usage = value as ResponseUsageLike;
  const inputTokens = requiredToken(usage.input_tokens, "input_tokens", warnings);
  const outputTokens = requiredToken(usage.output_tokens, "output_tokens", warnings);
  const totalTokens = firstNumberAtPath(
    value,
    ["total_tokens"],
    warnings,
    "total_tokens"
  );
  const cachedInputTokens = firstNumberAtPath(
    value,
    [
      "cached_input_tokens",
      "input_tokens_details.cached_tokens",
      "input_token_details.cached_tokens",
      "input_details.cached_tokens"
    ],
    warnings,
    "cached_input_tokens"
  );
  const reasoningTokens = firstNumberAtPath(
    value,
    [
      "reasoning_tokens",
      "output_tokens_details.reasoning_tokens",
      "output_token_details.reasoning_tokens",
      "output_details.reasoning_tokens"
    ],
    warnings,
    "reasoning_tokens"
  );

  if (inputTokens === null || outputTokens === null) {
    return {
      ok: false,
      reason: "usage_malformed",
      message: "Provider usage is missing valid input_tokens or output_tokens.",
      usage_found_at: path,
      warnings
    };
  }

  if (cachedInputTokens === null || reasoningTokens === null || totalTokens === null) {
    return {
      ok: false,
      reason: "usage_malformed",
      message: "Provider usage contains malformed optional token details.",
      usage_found_at: path,
      warnings
    };
  }

  return {
    ok: true,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      cached_input_tokens: cachedInputTokens,
      reasoning_tokens: reasoningTokens,
      raw: value
    },
    usage_found_at: path,
    warnings
  };
}

export function parseEvalProviderUsage(input: {
  usage?: LlmUsage;
  raw_output?: unknown;
}): EvalUsageParseResult {
  const candidates: UsagePathCandidate[] = [
    { path: "result.usage", value: input.usage },
    { path: "raw_output.usage", value: getAtPath(input.raw_output, "usage") },
    { path: "raw_output.response.usage", value: getAtPath(input.raw_output, "response.usage") },
    { path: "raw_output.data.usage", value: getAtPath(input.raw_output, "data.usage") },
    { path: "raw_output.raw.usage", value: getAtPath(input.raw_output, "raw.usage") }
  ];
  const warnings: string[] = [];

  for (const candidate of candidates) {
    if (candidate.value === undefined || candidate.value === null) {
      continue;
    }

    const parsed = parseUsageObject(candidate.value, candidate.path);

    if (parsed.ok) {
      return parsed;
    }

    return parsed;
  }

  return {
    ok: false,
    reason: "usage_missing",
    message: "Provider usage was unavailable; budget cannot be verified.",
    usage_found_at: null,
    warnings
  };
}

export function usageTokenCounts(result: EvalUsageParseResult) {
  if (!result.ok) {
    return {
      input_tokens: null,
      cached_input_tokens: null,
      output_tokens: null,
      reasoning_tokens: null,
      total_tokens: null
    };
  }

  return {
    input_tokens: result.usage.input_tokens ?? null,
    cached_input_tokens: result.usage.cached_input_tokens ?? null,
    output_tokens: result.usage.output_tokens ?? null,
    reasoning_tokens: result.usage.reasoning_tokens ?? null,
    total_tokens: result.usage.total_tokens ?? null
  };
}
