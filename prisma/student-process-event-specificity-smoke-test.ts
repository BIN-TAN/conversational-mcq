import { buildProcessEventCodebookEntries } from "../src/lib/services/teacher-research-data/dictionary";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function main() {
  const entries = buildProcessEventCodebookEntries();
  const unresolved = entries.filter((entry) =>
    /named lifecycle|named workflow|named step|corresponding action occurs|domain enum|Process event type/i.test(entry.trigger)
  );
  assert(unresolved.length === 0, `Process-event triggers still have unresolved generic wording: ${unresolved.map((entry) => entry.event_type).join(", ")}`);
  assert(entries.every((entry) => entry.source_code_reference), "Every process event must include source_code_reference.");
  assert(entries.every((entry) => entry.source_service_or_function), "Every process event must include source_service_or_function.");
  assert(entries.every((entry) => entry.semantic_review_status === "source_verified"), "Every process event should be source_verified.");
  assert(entries.every((entry) => entry.derived_variables && !/generic|not specified/i.test(entry.derived_variables)), "Derived-variable mappings should be concrete enough for review.");

  const triggerCounts = new Map<string, number>();
  const payloadCounts = new Map<string, number>();
  const derivedCounts = new Map<string, number>();
  for (const entry of entries) {
    triggerCounts.set(entry.trigger, (triggerCounts.get(entry.trigger) ?? 0) + 1);
    payloadCounts.set(entry.payload_fields, (payloadCounts.get(entry.payload_fields) ?? 0) + 1);
    derivedCounts.set(entry.derived_variables, (derivedCounts.get(entry.derived_variables) ?? 0) + 1);
  }

  assert([...triggerCounts.values()].every((count) => count < 30), "No single trigger template should dominate the codebook.");
  assert(new Set(entries.map((entry) => entry.derived_variables)).size >= 8, "Derived-variable mappings should vary by event family.");

  const known = Object.fromEntries(["agent_call_failed", "item_presented", "page_hidden"].map((eventType) => [
    eventType,
    entries.find((entry) => entry.event_type === eventType)
  ]));
  assert(known.agent_call_failed?.trigger.includes("provider transport"), "agent_call_failed should identify provider/validation/readiness failure context.");
  assert(known.item_presented?.trigger.includes("item-presentation step"), "item_presented should identify application-side presentation semantics.");
  assert(known.page_hidden?.trigger.includes("browser visibility API"), "page_hidden should identify browser visibility instrumentation.");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        process_event_rows: entries.length,
        identical_trigger_groups: [...triggerCounts.values()].filter((count) => count > 1).length,
        identical_payload_groups: [...payloadCounts.values()].filter((count) => count > 1).length,
        identical_derived_groups: [...derivedCounts.values()].filter((count) => count > 1).length,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main();
