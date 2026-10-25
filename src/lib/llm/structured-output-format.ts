import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";

/**
 * The text format sent to OpenAI structured outputs.
 *
 * Zod 4 writes a discriminated union as `oneOf`, which strict structured outputs reject (they accept
 * `anyOf`). Under Zod 3 the same unions were written as `anyOf`. Because every branch of a
 * discriminated union fixes a different constant for the discriminator, `anyOf` accepts exactly
 * the same outputs, so the schema is rewritten before it is sent. The returned object keeps the
 * helper's parser, so responses are still validated by the Zod schema itself.
 */
export function structuredTextFormat<T extends z.ZodType>(schema: T, name: string) {
  const format = zodTextFormat(schema, name);
  format.schema = withoutOneOf(format.schema) as typeof format.schema;
  return format;
}

export function withoutOneOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutOneOf);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "oneOf" && !("anyOf" in (value as Record<string, unknown>))) {
      result.anyOf = withoutOneOf(entry);
    } else {
      result[key] = withoutOneOf(entry);
    }
  }
  return result;
}
