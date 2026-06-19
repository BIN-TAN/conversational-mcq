import type { ResponseCorrectness } from "@prisma/client";

const secretKeyFragments = [
  "password",
  "access_code",
  "cookie",
  "token",
  "secret",
  "api_key"
];

export function serializeDate(value?: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function stripInternalKeys(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => stripInternalKeys(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const output: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    const isInternalIdKey =
      key === "id" || key.endsWith("_db_id") || key.endsWith("_db_ids");
    const isSecretKey = secretKeyFragments.some((fragment) => normalizedKey.includes(fragment));

    if (isInternalIdKey || isSecretKey) {
      continue;
    }

    output[key] = stripInternalKeys(entry);
  }

  return output;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];

  return typeof value === "string" ? value : null;
}

export function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function countByString(values: Array<string | null | undefined>) {
  return values.reduce<Record<string, number>>((counts, value) => {
    const key = value ?? "missing";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

export function emptyCorrectnessDistribution(): Record<ResponseCorrectness | "missing", number> {
  return {
    not_scored: 0,
    correct: 0,
    incorrect: 0,
    unanswered: 0,
    missing: 0
  };
}

export function summarizeResponsePackagePayload(payload: unknown) {
  const record = asRecord(payload);
  const itemResponses = asArray(record.item_responses).map(asRecord);
  const processEvents = asArray(record.process_events).map(asRecord);
  const conversationTurns = asArray(record.conversation_turns);
  const conceptUnit = stripInternalKeys(record.concept_unit);
  const includedItems = asArray(record.included_items);
  const correctnessDistribution = emptyCorrectnessDistribution();

  for (const response of itemResponses) {
    const correctness = stringField(response, "correctness") as ResponseCorrectness | null;

    if (correctness && correctness in correctnessDistribution) {
      correctnessDistribution[correctness] += 1;
    } else {
      correctnessDistribution.missing += 1;
    }
  }

  const confidenceDistribution = countByString(
    itemResponses.map((response) => stringField(response, "confidence_rating"))
  );
  const processCounts =
    Object.keys(asRecord(record.process_counts)).length > 0
      ? stripInternalKeys(record.process_counts)
      : countByString(processEvents.map((event) => stringField(event, "event_type")));

  return {
    concept_unit: conceptUnit,
    item_count: includedItems.length,
    completed_response_count: itemResponses.filter((response) =>
      Boolean(stringField(response, "item_submitted_at"))
    ).length,
    skipped_response_count: itemResponses.filter((response) => response.skipped_item === true)
      .length,
    correctness_distribution: correctnessDistribution,
    confidence_distribution: confidenceDistribution,
    revision_count: itemResponses.reduce(
      (total, response) => total + (numberField(response, "revision_count") ?? 0),
      0
    ),
    process_event_counts: processCounts,
    transcript_turn_count: conversationTurns.length,
    initial_completion_time: stringField(asRecord(record.concept_unit), "initial_completed_at")
  };
}

export function assertNoInternalIds(value: unknown, path = "response") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoInternalIds(entry, `${path}.${index}`));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (key === "id" || key.endsWith("_db_id") || key.endsWith("_db_ids")) {
      throw new Error(`Internal database identifier leaked at ${path}.${key}.`);
    }

    if (key === "password_hash" || key === "access_code_hash") {
      throw new Error(`Secret auth hash leaked at ${path}.${key}.`);
    }

    assertNoInternalIds(entry, `${path}.${key}`);
  }
}
