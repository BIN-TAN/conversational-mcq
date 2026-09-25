import { z } from "zod";

export const SEMANTIC_ITEM_REVIEW_VERSION = "semantic-item-review-v1" as const;
export const SemanticItemReviewSchema = z.object({
  item_public_id: z.string().min(1),
  reasoning_judgment: z.enum([
    "supported_precise", "supported_concise", "partial", "contradictory", "insufficient", "irrelevant"
  ]),
  reasoning_quote: z.string().max(600),
  explanation: z.string().trim().min(1).max(700),
  misconceptions: z.array(z.object({
    proposition: z.string().trim().min(1).max(350),
    source_field: z.enum(["reasoning", "tempting_option_reason"]),
    evidence_quote: z.string().trim().min(1).max(600)
  }).strict()).max(8)
}).strict();
export type SemanticItemReview = z.infer<typeof SemanticItemReviewSchema>;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();

// Validate provenance against the sealed package, not the model's retelling of it.
export function validateSemanticItemReviews(payload: unknown, value: unknown) {
  const parsed = z.array(SemanticItemReviewSchema).max(12).safeParse(value);
  const rawResponses = record(payload).item_responses;
  const responses = Array.isArray(rawResponses) ? rawResponses.map(record) : [];
  const issues: string[] = [];
  if (!parsed.success || !responses.length) {
    return { valid: false, issues: ["semantic_item_reviews_missing_or_invalid"], reviews: [] as SemanticItemReview[] };
  }
  const byId = new Map(responses.map(response => [text(response.item_public_id), response]));
  const ids = parsed.data.map(review => review.item_public_id);
  if (ids.length !== byId.size || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) {
    issues.push("semantic_item_review_coverage_mismatch");
  }
  for (const review of parsed.data) {
    const response = byId.get(review.item_public_id) ?? {};
    const reasoning = normalize(text(response.reasoning_text_final ?? response.reasoning_text));
    const quote = normalize(review.reasoning_quote);
    if ((quote && !reasoning.includes(quote)) ||
        (review.reasoning_judgment !== "insufficient" && !quote)) {
      issues.push(`semantic_item_review_quote_mismatch:${review.item_public_id}`);
    }
    for (const claim of review.misconceptions) {
      const source = claim.source_field === "reasoning"
        ? reasoning : normalize(text(response.tempting_option_reason));
      if (!source.includes(normalize(claim.evidence_quote))) {
        issues.push(`semantic_item_review_claim_quote_mismatch:${review.item_public_id}`);
      }
    }
  }
  return { valid: issues.length === 0, issues, reviews: issues.length ? [] : parsed.data };
}
