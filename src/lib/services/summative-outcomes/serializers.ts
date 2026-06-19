import type { Prisma, SummativeOutcome } from "@prisma/client";

export function serializeDate(value?: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function serializeDateOnly(value?: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function decimalToString(value: Prisma.Decimal | number | string) {
  return String(value);
}

export function decimalToNumber(value: Prisma.Decimal | number | string) {
  return Number(value);
}

export function serializeSummativeOutcome(
  outcome: Pick<
    SummativeOutcome,
    | "outcome_public_id"
    | "user_id_snapshot"
    | "outcome_name"
    | "outcome_score"
    | "max_score"
    | "assessment_date"
    | "notes"
    | "source_row_number"
    | "record_status"
    | "revision_number"
    | "created_at"
    | "updated_at"
  >
) {
  return {
    outcome_public_id: outcome.outcome_public_id,
    user_id: outcome.user_id_snapshot,
    outcome_name: outcome.outcome_name,
    outcome_score: decimalToString(outcome.outcome_score),
    max_score: decimalToString(outcome.max_score),
    assessment_date: serializeDateOnly(outcome.assessment_date),
    notes: outcome.notes,
    source_row_number: outcome.source_row_number,
    record_status: outcome.record_status,
    revision_number: outcome.revision_number,
    created_at: serializeDate(outcome.created_at),
    updated_at: serializeDate(outcome.updated_at)
  };
}

export function publicPreviewRow(row: Record<string, unknown>) {
  const safe = { ...row };

  delete safe.user_db_id;
  delete safe.existing_outcome_db_id;
  return safe;
}
