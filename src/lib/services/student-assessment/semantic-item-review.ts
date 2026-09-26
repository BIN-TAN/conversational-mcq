import { z } from "zod";

export const SEMANTIC_ITEM_REVIEW_VERSION = "semantic-item-review-v3" as const;
const SourceFieldSchema = z.enum(["reasoning", "tempting_option_reason"]);
export const ReasoningInterpretationSchema = z.object({
  interpretation_id: z.string().trim().min(1).max(80),
  source_field: SourceFieldSchema,
  student_quote: z.string().trim().min(1).max(600),
  proposition: z.string().trim().min(1).max(350),
  stance: z.enum(["endorsed", "rejected", "uncertain", "quoted"]),
  basis: z.enum(["supplied_explanation", "student_explanation", "answer_only", "fact_restatement"]),
  correctness: z.enum(["supported", "contradicted", "undetermined"]),
  scope: z.enum(["specific_proposition", "compound_unspecified"]),
  option_reference: z.object({ label: z.string().trim().min(1).max(20), quote: z.string().trim().min(1).max(1200) }).strict().nullable(),
  rationale: z.string().trim().min(1).max(600)
}).strict();
const MisconceptionSchema = z.object({
  proposition: z.string().trim().min(1).max(350),
  source_field: SourceFieldSchema,
  evidence_quote: z.string().trim().min(1).max(600),
  interpretation_id: z.string().min(1).max(80).optional()
}).strict();
export const SemanticItemReviewSchema = z.object({
  item_public_id: z.string().min(1),
  reasoning_judgment: z.enum([
    "supported_precise", "supported_concise", "partial", "contradictory", "insufficient", "irrelevant"
  ]),
  reasoning_quote: z.string().max(600),
  explanation: z.string().trim().min(1).max(700),
  misconceptions: z.array(MisconceptionSchema).max(8),
  interpretation_version: z.literal(SEMANTIC_ITEM_REVIEW_VERSION).optional(),
  interpretations: z.array(ReasoningInterpretationSchema).max(12).optional()
}).strict();
// Historical diagnostics remain readable; newly generated diagnostics cannot
// omit the stance record or the link from a claim to its supporting observation.
export const CurrentSemanticItemReviewSchema = SemanticItemReviewSchema.extend({
  interpretation_version: z.literal(SEMANTIC_ITEM_REVIEW_VERSION),
  interpretations: z.array(ReasoningInterpretationSchema).max(12),
  misconceptions: z.array(MisconceptionSchema.extend({ interpretation_id: z.string().min(1).max(80) })).max(8)
});
export type SemanticItemReview = z.infer<typeof SemanticItemReviewSchema>;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();

// Validate provenance against the sealed package, not the model's retelling of it.
export function validateSemanticItemReviews(payload: unknown, value: unknown, requireCurrent = false) {
  const parsed = z.array(SemanticItemReviewSchema).max(12).safeParse(value);
  const rawResponses = record(payload).item_responses;
  const responses = Array.isArray(rawResponses) ? rawResponses.map(record) : [];
  const issues: string[] = [];
  if (!parsed.success || !responses.length) {
    return { valid: false, issues: ["semantic_item_reviews_missing_or_invalid"], reviews: [] as SemanticItemReview[] };
  }
  const responseIds = responses.map(response => text(response.item_public_id));
  if (responseIds.some(id => !id.trim()) || new Set(responseIds).size !== responseIds.length) {
    return { valid: false, issues: ["semantic_item_review_source_identity_invalid"], reviews: [] as SemanticItemReview[] };
  }
  const byId = new Map(responses.map(response => [text(response.item_public_id), response]));
  const rawItems = record(payload).included_items;
  const items = Array.isArray(rawItems) ? rawItems.map(record) : [];
  const ids = parsed.data.map(review => review.item_public_id);
  if (ids.length !== byId.size || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) {
    issues.push("semantic_item_review_coverage_mismatch");
  }
  for (const review of parsed.data) {
    const response = byId.get(review.item_public_id) ?? {};
    const reasoning = normalize(text(response.reasoning_text_final ?? response.reasoning_text));
    const sourceText = (field: "reasoning" | "tempting_option_reason") => field === "reasoning"
      ? reasoning : normalize(text(response.tempting_option_reason));
    const quote = normalize(review.reasoning_quote);
    if ((quote && !reasoning.includes(quote)) ||
        (review.reasoning_judgment !== "insufficient" && !quote)) {
      issues.push(`semantic_item_review_quote_mismatch:${review.item_public_id}`);
    }
    const current = requireCurrent || review.interpretation_version !== undefined || review.interpretations !== undefined;
    if (current && !CurrentSemanticItemReviewSchema.safeParse(review).success) {
      issues.push(`semantic_item_review_interpretation_required:${review.item_public_id}`);
    }
    const interpretations = review.interpretations ?? [];
    const interpretationIds = interpretations.map(entry => entry.interpretation_id);
    if (new Set(interpretationIds).size !== interpretationIds.length) {
      issues.push(`semantic_item_review_interpretation_identity_invalid:${review.item_public_id}`);
    }
    if (current && reasoning && !["insufficient", "irrelevant"].includes(review.reasoning_judgment) &&
        !interpretations.some(entry => entry.source_field === "reasoning")) {
      issues.push(`semantic_item_review_reasoning_interpretation_missing:${review.item_public_id}`);
    }
    if (current && ["supported_precise", "supported_concise"].includes(review.reasoning_judgment) &&
        !interpretations.some(entry => entry.source_field === "reasoning" && entry.stance === "endorsed" &&
          entry.correctness === "supported" && entry.scope === "specific_proposition" &&
          ["supplied_explanation", "student_explanation"].includes(entry.basis))) {
      issues.push(`semantic_item_review_supported_reasoning_evidence_missing:${review.item_public_id}`);
    }
    for (const entry of interpretations) {
      if (!sourceText(entry.source_field).includes(normalize(entry.student_quote))) {
        issues.push(`semantic_item_review_interpretation_quote_mismatch:${review.item_public_id}`);
      }
      if (entry.basis === "supplied_explanation" && !entry.option_reference) {
        issues.push(`semantic_item_review_option_reference_required:${review.item_public_id}`);
      }
      if (entry.option_reference) {
        const matchedItems = items.filter(item => item.item_public_id === review.item_public_id);
        const options = matchedItems.length === 1 && Array.isArray(matchedItems[0].options)
          ? matchedItems[0].options.map(record) : [];
        const matchedOptions = options.filter(option => option.label === entry.option_reference?.label);
        if (matchedOptions.length !== 1 || !normalize(text(matchedOptions[0].text)).includes(normalize(entry.option_reference.quote))) {
          issues.push(`semantic_item_review_option_reference_mismatch:${review.item_public_id}`);
        }
      }
    }
    for (const claim of review.misconceptions) {
      const source = claim.source_field === "reasoning"
        ? reasoning : normalize(text(response.tempting_option_reason));
      if (!source.includes(normalize(claim.evidence_quote))) {
        issues.push(`semantic_item_review_claim_quote_mismatch:${review.item_public_id}`);
      }
      if (current) {
        const observation = interpretations.find(entry => entry.interpretation_id === claim.interpretation_id);
        if (!observation || observation.stance !== "endorsed" || observation.correctness !== "contradicted" ||
            observation.scope !== "specific_proposition" || ["answer_only", "fact_restatement"].includes(observation.basis) ||
            observation.source_field !== claim.source_field || normalize(observation.student_quote) !== normalize(claim.evidence_quote) ||
            normalize(observation.proposition) !== normalize(claim.proposition)) {
          issues.push(`semantic_item_review_claim_not_supported_by_endorsement:${review.item_public_id}`);
        }
      }
    }
    const claimIds = review.misconceptions.map(claim => claim.interpretation_id);
    if (current && new Set(claimIds).size !== claimIds.length) {
      issues.push(`semantic_item_review_duplicate_claim:${review.item_public_id}`);
    }
    for (const entry of interpretations) {
      if (entry.stance === "endorsed" && entry.correctness === "contradicted" && entry.scope === "specific_proposition" &&
          !["answer_only", "fact_restatement"].includes(entry.basis) && !claimIds.includes(entry.interpretation_id)) {
        issues.push(`semantic_item_review_endorsed_error_omitted:${review.item_public_id}`);
      }
    }
  }
  return { valid: issues.length === 0, issues, reviews: issues.length ? [] : parsed.data };
}
