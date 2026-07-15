import {
  TIMING_CONTRACT_VERSION,
  deriveItemTiming,
  type TimingEventLike
} from "../src/lib/services/student-assessment/timing-contract";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function event(event_type: string, at: Date, payload: Record<string, unknown> = {}): TimingEventLike {
  return {
    event_type,
    event_source: event_type === "agent_message_shown" || event_type === "item_submitted" ? "backend" : "frontend",
    occurred_at: at,
    created_at: at,
    payload
  };
}

function plus(base: Date, ms: number) {
  return new Date(base.getTime() + ms);
}

const observedFixture = [
  { item: 1, firstOptionMs: 5_253, itemElapsedMs: 52_939, reasoningElapsedMs: 42_083 },
  { item: 2, firstOptionMs: 11_408, itemElapsedMs: 62_542, reasoningElapsedMs: 48_025 },
  { item: 3, firstOptionMs: 19_680, itemElapsedMs: 80_781, reasoningElapsedMs: 56_979 }
];

for (const fixture of observedFixture) {
  const presentedAt = new Date(`2026-07-01T21:0${fixture.item}:00.000Z`);
  const submittedAt = plus(presentedAt, fixture.itemElapsedMs);
  const timing = deriveItemTiming({
    item_submitted_at: submittedAt,
    persisted_item_response_time_ms: fixture.itemElapsedMs - fixture.firstOptionMs,
    events: [
      event("item_presented", presentedAt, { item_public_id: `item_${fixture.item}` }),
      event("option_clicked", plus(presentedAt, fixture.firstOptionMs), {
        item_public_id: `item_${fixture.item}`,
        selected_option: "C"
      }),
      event("agent_message_shown", plus(submittedAt, -fixture.reasoningElapsedMs), {
        item_public_id: `item_${fixture.item}`,
        prompt_type: "request_reasoning"
      }),
      event("reasoning_submitted", submittedAt, { item_public_id: `item_${fixture.item}` }),
      event("item_submitted", submittedAt, { item_public_id: `item_${fixture.item}` })
    ]
  });

  assert(timing.timing_contract_version === TIMING_CONTRACT_VERSION, "Timing contract version mismatch.");
  assert(
    timing.time_to_first_option_selection_ms === fixture.firstOptionMs,
    `Item ${fixture.item} first-option timing mismatch.`
  );
  assert(
    timing.time_to_first_response_action_ms === fixture.firstOptionMs,
    `Item ${fixture.item} first-action timing mismatch.`
  );
  assert(timing.item_elapsed_response_time_ms === fixture.itemElapsedMs, `Item ${fixture.item} elapsed mismatch.`);
  assert(
    timing.reasoning_elapsed_time_ms === fixture.reasoningElapsedMs,
    `Item ${fixture.item} reasoning elapsed mismatch.`
  );
  assert(
    timing.reasoning_active_typing_time_ms === null,
    `Item ${fixture.item} should not manufacture active typing time.`
  );
  assert(
    timing.post_option_completion_time_ms === fixture.itemElapsedMs - fixture.firstOptionMs,
    `Item ${fixture.item} post-option completion mismatch.`
  );
  assert(
    timing.legacy_item_response_time_ms === fixture.itemElapsedMs - fixture.firstOptionMs,
    `Item ${fixture.item} should preserve legacy compatibility value separately.`
  );
}

console.log(
  JSON.stringify(
    {
      status: "passed",
      contract_version: TIMING_CONTRACT_VERSION,
      observed_fixture_item_count: observedFixture.length,
      expected_first_option_ms: observedFixture.map((entry) => entry.firstOptionMs),
      expected_item_elapsed_ms: observedFixture.map((entry) => entry.itemElapsedMs),
      expected_reasoning_elapsed_ms: observedFixture.map((entry) => entry.reasoningElapsedMs),
      no_openai_call_occurred: true
    },
    null,
    2
  )
);
