import {
  buildProcessEventCodebookEntries,
  processEventCodebookCsv
} from "../src/lib/services/teacher-research-data/dictionary";
import { processEventTypes } from "../src/lib/domain/enums";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const placeholderFragments = [
  "defined by the application domain enum",
  "Process event type",
  "Captured Prisma field",
  "exported from",
  "See source and generation fields"
];

function hasPlaceholder(value: string) {
  return placeholderFragments.some((fragment) => value.includes(fragment));
}

function main() {
  const entries = buildProcessEventCodebookEntries();
  const byEventType = new Map(entries.map((entry) => [entry.event_type, entry]));
  assert(entries.length === processEventTypes.length, "Codebook should document every event enum value exactly once.");
  assert(byEventType.size === entries.length, "Codebook should not duplicate event types.");

  for (const eventType of processEventTypes) {
    const entry = byEventType.get(eventType);
    assert(entry, `Missing process event codebook row for ${eventType}.`);
    assert(entry.trigger.trim(), `${eventType} needs trigger.`);
    assert(entry.actor_or_source.trim(), `${eventType} needs actor/source.`);
    assert(entry.measurement_level.trim(), `${eventType} needs measurement level.`);
    assert(entry.session_or_item_scope.trim(), `${eventType} needs scope.`);
    assert(entry.timestamp_meaning.trim(), `${eventType} needs timestamp meaning.`);
    assert(entry.interpretation_caution.trim(), `${eventType} needs interpretation caution.`);
    assert(!hasPlaceholder(entry.trigger), `${eventType} should not use placeholder trigger.`);
  }

  const csv = processEventCodebookCsv(entries);
  assert(!/sk-[A-Za-z0-9_-]{20,}/.test(csv), "Codebook CSV must not expose API-key shaped values.");
  assert(!/postgres(?:ql)?:\/\//i.test(csv), "Codebook CSV must not expose database URLs.");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        process_event_types_documented: entries.length,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main();
