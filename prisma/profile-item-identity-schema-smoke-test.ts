import assert from "node:assert/strict";
import { zodTextFormat } from "openai/helpers/zod";
import { chatNativeProfileSchemaForPackage } from "../src/lib/services/student-assessment/formative-profile";
import { semanticItemReviewSchemaForPackage, validateSemanticItemReviews } from "../src/lib/services/student-assessment/semantic-item-review";

const ids = ["item_b54e012a-ddcb-4eae-88ba-a4e4c9fb4d6b", "item_4d628521-3f59-4336-95e5-e81221ec989d", "item_34d8f6d9-13c8-4265-a4c5-249567fb06e3"];
const payload = { item_responses: ids.map((id, i) => ({ item_public_id: id, reasoning_text_final: `I am unsure about item ${i + 1}.` })) };
const reviews = payload.item_responses.map(response => ({ item_public_id: response.item_public_id,
  reasoning_judgment: "insufficient", reasoning_quote: response.reasoning_text_final,
  explanation: "The student expresses uncertainty without an explanation.", misconceptions: [],
  interpretation_version: "semantic-item-review-v3", interpretations: [] }));
const schema = semanticItemReviewSchemaForPackage(payload);
assert(schema.safeParse(reviews).success);
assert(validateSemanticItemReviews(payload, reviews, true).valid);
const malformed = structuredClone(reviews);
malformed[2].item_public_id = "item_34d8f6d9-13c8-4265-a4e4c9fb4d6b";
assert(!schema.safeParse(malformed).success, "Reject the live malformed hybrid ID, without repairing or reassigning it");
assert(!schema.safeParse(reviews.slice(0, 2)).success, "All submitted items need a review");
assert(!schema.safeParse([...reviews, reviews[0]]).success);
assert(!validateSemanticItemReviews(payload, [reviews[0], reviews[0], reviews[2]], true).valid, "Coverage validation still rejects duplicates");
const wrongQuote = structuredClone(reviews);
wrongQuote[2].reasoning_quote = reviews[0].reasoning_quote;
assert(!validateSemanticItemReviews(payload, wrongQuote, true).valid, "A valid ID must still have source-matched evidence");
assert.throws(() => semanticItemReviewSchemaForPackage({ item_responses: [] }));
assert.throws(() => semanticItemReviewSchemaForPackage({ item_responses: [payload.item_responses[0], payload.item_responses[0]] }));
assert.throws(() => semanticItemReviewSchemaForPackage({ item_responses: [{ item_public_id: " " }] }));
const format = zodTextFormat(chatNativeProfileSchemaForPackage(payload), "bounded_profile");
const json = JSON.parse(JSON.stringify(format.schema));
const array = json.properties.semantic_item_reviews;
assert.deepEqual(array.items.properties.item_public_id.enum, ids, "The provider receives the actual finite ID set");
assert.equal(array.minItems, 3);
assert.equal(array.maxItems, 3);
assert.equal(format.strict, true);
assert.equal(payload.item_responses[2].item_public_id, ids[2], "Source evidence stays unchanged");
for (const count of [1, 12]) {
  const boundary = { item_responses: Array.from({ length: count }, (_, index) => ({ item_public_id: `boundary_${index}` })) };
  const boundaryFormat = JSON.parse(JSON.stringify(zodTextFormat(chatNativeProfileSchemaForPackage(boundary), "bounded_profile").schema));
  assert.equal(boundaryFormat.properties.semantic_item_reviews.minItems, count);
  assert.equal(boundaryFormat.properties.semantic_item_reviews.maxItems, count);
}
assert.throws(() => semanticItemReviewSchemaForPackage({ item_responses: Array.from({ length: 13 }, (_, index) => ({ item_public_id: `extra_${index}` })) }));
console.log("PASS profile identity schema: exact provider enums/count, malformed/foreign identity rejection, duplicate and quotation validation, source preservation.");
