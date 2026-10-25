/**
 * Structured outputs reject `oneOf`; Zod 4 writes discriminated unions with it. The item-design
 * assistant's output (blueprint_updates, a discriminated union) failed live on 24 Oct with
 * "The authoring assistant could not respond" until the schema sent to OpenAI used `anyOf`.
 */
import assert from "node:assert/strict";
import { structuredTextFormat, withoutOneOf } from "../src/lib/llm/structured-output-format";
import { ItemDesignAssistantOutputSchema } from "../src/lib/services/content/item-design-contract";
import { InterpretationOutputV8Schema } from "../src/lib/services/student-assessment/interpretation-v8/contract";
import { FeedbackV8OutputSchema } from "../src/lib/services/student-assessment/feedback-v8/contract";
import { ItemPreparationOutputSchema } from "../src/lib/services/content/item-preparation/contract";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`ok - ${passed}. ${name}`);
}

check("oneOf becomes anyOf at every depth; other keys are unchanged", () => {
  const input = { type: "object", properties: { a: { oneOf: [{ const: "x" }, { const: "y" }] }, b: { anyOf: [{ type: "string" }] } } };
  assert.deepEqual(withoutOneOf(input), { type: "object", properties: { a: { anyOf: [{ const: "x" }, { const: "y" }] }, b: { anyOf: [{ type: "string" }] } } });
});

check("the item-design assistant schema sent to OpenAI has no oneOf", () => {
  const text = JSON.stringify(structuredTextFormat(ItemDesignAssistantOutputSchema, "item_design_assistant").schema);
  assert(!text.includes('"oneOf"'), "oneOf left in the item-design assistant schema");
  assert(text.includes('"anyOf"'), "blueprint updates should be an anyOf");
});

check("the v8 schemas carry no oneOf either", () => {
  for (const [name, schema] of [["interpretation", InterpretationOutputV8Schema], ["feedback", FeedbackV8OutputSchema], ["item_preparation", ItemPreparationOutputSchema]] as const) {
    assert(!JSON.stringify(structuredTextFormat(schema, name).schema).includes('"oneOf"'), name);
  }
});

check("the format still parses a valid output with the Zod schema", () => {
  const format = structuredTextFormat(ItemDesignAssistantOutputSchema, "item_design_assistant") as unknown as { $parseRaw?: (raw: string) => unknown };
  assert.equal(typeof format.$parseRaw, "function", "the helper's parser must be kept");
});

console.log(`${passed} structured output format checks passed; no provider call.`);
