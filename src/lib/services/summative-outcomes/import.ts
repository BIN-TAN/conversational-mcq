import { Prisma } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import { SummativeOutcomeServiceError } from "./errors";
import { publicPreviewRow, serializeDate, serializeSummativeOutcome } from "./serializers";

const requiredColumns = [
  "user_id",
  "outcome_name",
  "outcome_score",
  "max_score",
  "assessment_date"
] as const;

const previewInputSchema = z.object({
  csv_text: z.string().min(1, "CSV text is required."),
  source_file_name: z.string().trim().max(255).optional()
});

const replaceOutcomeSchema = z.object({
  outcome_score: z.coerce.number().finite().nonnegative(),
  max_score: z.coerce.number().finite().positive(),
  notes: z.string().max(5000).optional().nullable()
}).strict().refine((value) => value.outcome_score <= value.max_score, {
  path: ["outcome_score"],
  message: "outcome_score must be less than or equal to max_score."
});

type NormalizedRow = {
  source_row_number: number;
  user_id: string;
  user_db_id?: string;
  outcome_name: string;
  outcome_score?: string;
  max_score?: string;
  assessment_date: string;
  notes: string | null;
  logical_key: string;
  row_status:
    | "valid"
    | "invalid"
    | "duplicate_source_row"
    | "unmatched_user"
    | "teacher_user_rejected"
    | "conflict"
    | "exact_duplicate_existing";
  validation_errors: Array<{ code: string; message: string; column?: string }>;
  existing_outcome_public_id?: string;
  existing_outcome_db_id?: string;
};

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return null;
  }

  return date;
}

function parseFiniteNumber(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);

  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeNotes(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";

  return text.length > 0 ? text : null;
}

function logicalKey(row: Pick<NormalizedRow, "user_id" | "outcome_name" | "assessment_date">) {
  return `${row.user_id}||${row.outcome_name}||${row.assessment_date}`;
}

function csvRecords(csvText: string): Array<{ record: Record<string, string>; rowNumber: number }> {
  try {
    const parsed = parse(csvText, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: false,
      info: true
    }) as Array<{ record: Record<string, string>; info: { lines: number } }>;

    return parsed.map((entry) => ({
      record: entry.record,
      rowNumber: entry.info.lines
    }));
  } catch (error) {
    throw new SummativeOutcomeServiceError(
      "csv_parse_failed",
      "CSV could not be parsed.",
      400,
      { message: error instanceof Error ? error.message : String(error) }
    );
  }
}

function exactOutcomeMatch(
  existing: {
    outcome_score: Prisma.Decimal;
    max_score: Prisma.Decimal;
    notes: string | null;
  },
  row: NormalizedRow
) {
  return (
    Number(existing.outcome_score) === Number(row.outcome_score) &&
    Number(existing.max_score) === Number(row.max_score) &&
    (existing.notes ?? null) === (row.notes ?? null)
  );
}

function summarize(rows: NormalizedRow[]) {
  return {
    total_rows: rows.length,
    valid_rows: rows.filter((row) => row.row_status === "valid").length,
    invalid_rows: rows.filter((row) => row.row_status === "invalid").length,
    duplicate_rows: rows.filter((row) => row.row_status === "duplicate_source_row").length,
    conflicting_rows: rows.filter((row) => row.row_status === "conflict").length,
    unmatched_user_rows: rows.filter(
      (row) => row.row_status === "unmatched_user" || row.row_status === "teacher_user_rejected"
    ).length,
    exact_existing_duplicate_rows: rows.filter(
      (row) => row.row_status === "exact_duplicate_existing"
    ).length
  };
}

export async function previewSummativeOutcomeImport(input: {
  teacher_user_db_id: string;
  data: z.input<typeof previewInputSchema>;
}) {
  const parsed = previewInputSchema.parse(input.data);
  const records = csvRecords(parsed.csv_text);
  const sourceRows: NormalizedRow[] = records.map(({ record, rowNumber }) => {
    const validationErrors: NormalizedRow["validation_errors"] = [];
    const userId = (record.user_id ?? "").trim();
    const outcomeName = (record.outcome_name ?? "").trim();
    const outcomeScoreValue = parseFiniteNumber(record.outcome_score ?? "");
    const maxScoreValue = parseFiniteNumber(record.max_score ?? "");
    const assessmentDate = (record.assessment_date ?? "").trim();
    const parsedDate = parseDateOnly(assessmentDate);

    for (const column of requiredColumns) {
      if (!(column in record) || String(record[column] ?? "").trim() === "") {
        validationErrors.push({
          code: "required",
          column,
          message: `${column} is required.`
        });
      }
    }

    if (!outcomeName) {
      validationErrors.push({
        code: "outcome_name_empty",
        column: "outcome_name",
        message: "outcome_name must be nonempty."
      });
    }

    if (outcomeScoreValue === null) {
      validationErrors.push({
        code: "outcome_score_invalid",
        column: "outcome_score",
        message: "outcome_score must be numeric and finite."
      });
    }

    if (maxScoreValue === null || maxScoreValue <= 0) {
      validationErrors.push({
        code: "max_score_invalid",
        column: "max_score",
        message: "max_score must be numeric, finite, and greater than zero."
      });
    }

    if (
      outcomeScoreValue !== null &&
      maxScoreValue !== null &&
      maxScoreValue > 0 &&
      (outcomeScoreValue < 0 || outcomeScoreValue > maxScoreValue)
    ) {
      validationErrors.push({
        code: "outcome_score_out_of_range",
        column: "outcome_score",
        message: "outcome_score must be between zero and max_score."
      });
    }

    if (!parsedDate) {
      validationErrors.push({
        code: "assessment_date_invalid",
        column: "assessment_date",
        message: "assessment_date must be a valid ISO-style date in YYYY-MM-DD format."
      });
    }

    const normalized: NormalizedRow = {
      source_row_number: rowNumber,
      user_id: userId,
      outcome_name: outcomeName,
      outcome_score: outcomeScoreValue === null ? undefined : String(outcomeScoreValue),
      max_score: maxScoreValue === null ? undefined : String(maxScoreValue),
      assessment_date: assessmentDate,
      notes: normalizeNotes(record.notes),
      logical_key: logicalKey({
        user_id: userId,
        outcome_name: outcomeName,
        assessment_date: assessmentDate
      }),
      row_status: validationErrors.length > 0 ? "invalid" : "valid",
      validation_errors: validationErrors
    };

    return normalized;
  });

  const seen = new Map<string, number>();

  for (const row of sourceRows) {
    if (row.row_status !== "valid") {
      continue;
    }

    const firstRowNumber = seen.get(row.logical_key);

    if (firstRowNumber !== undefined) {
      row.row_status = "duplicate_source_row";
      row.validation_errors.push({
        code: "duplicate_source_row",
        message: `Duplicate logical outcome row. First seen at CSV row ${firstRowNumber}.`
      });
    } else {
      seen.set(row.logical_key, row.source_row_number);
    }
  }

  const candidateUserIds = [...new Set(sourceRows.map((row) => row.user_id).filter(Boolean))];
  const users =
    candidateUserIds.length > 0
      ? await prisma.user.findMany({
          where: { user_id: { in: candidateUserIds } },
          select: { id: true, user_id: true, role: true }
        })
      : [];
  const usersByUserId = new Map(users.map((user) => [user.user_id, user]));

  for (const row of sourceRows) {
    if (row.row_status !== "valid") {
      continue;
    }

    const user = usersByUserId.get(row.user_id);

    if (!user) {
      row.row_status = "unmatched_user";
      row.validation_errors.push({
        code: "unmatched_user",
        column: "user_id",
        message: "user_id does not resolve to an existing student user."
      });
      continue;
    }

    if (user.role !== "student") {
      row.row_status = "teacher_user_rejected";
      row.validation_errors.push({
        code: "teacher_user_rejected",
        column: "user_id",
        message: "teacher_researcher accounts cannot receive student outcomes."
      });
      continue;
    }

    row.user_db_id = user.id;
  }

  for (const row of sourceRows) {
    if (row.row_status !== "valid" || !row.user_db_id) {
      continue;
    }

    const existing = await prisma.summativeOutcome.findFirst({
      where: {
        user_db_id: row.user_db_id,
        outcome_name: row.outcome_name,
        assessment_date: parseDateOnly(row.assessment_date) ?? undefined,
        record_status: "active"
      },
      select: {
        id: true,
        outcome_public_id: true,
        outcome_score: true,
        max_score: true,
        notes: true
      }
    });

    if (!existing) {
      continue;
    }

    row.existing_outcome_public_id = existing.outcome_public_id;
    row.existing_outcome_db_id = existing.id;

    if (exactOutcomeMatch(existing, row)) {
      row.row_status = "exact_duplicate_existing";
      row.validation_errors.push({
        code: "exact_duplicate_existing",
        message: "An active outcome with the same values already exists."
      });
    } else {
      row.row_status = "conflict";
      row.validation_errors.push({
        code: "conflicting_active_outcome",
        message:
          "An active outcome with the same user_id, outcome_name, and assessment_date has different values."
      });
    }
  }

  const summary = summarize(sourceRows);
  const previewRows = sourceRows.map((row) => publicPreviewRow(row));
  const validationErrors = previewRows.flatMap((row) =>
    Array.isArray(row.validation_errors)
      ? (row.validation_errors as unknown[]).map((error) => ({
          source_row_number: row.source_row_number,
          user_id: row.user_id,
          ...((error && typeof error === "object" ? error : {}) as Record<string, unknown>)
        }))
      : []
  );
  const batch = await prisma.summativeOutcomeImportBatch.create({
    data: {
      id: crypto.randomUUID(),
      batch_public_id: generatePublicId("summative_import_batch"),
      uploaded_by_user_db_id: input.teacher_user_db_id,
      source_file_name: parsed.source_file_name,
      status: "previewed",
      total_rows: summary.total_rows,
      valid_rows: summary.valid_rows,
      invalid_rows: summary.invalid_rows,
      duplicate_rows: summary.duplicate_rows,
      conflicting_rows: summary.conflicting_rows,
      unmatched_user_rows: summary.unmatched_user_rows,
      committed_rows: 0,
      validation_summary: toPrismaJson({
        ...summary,
        validation_errors: validationErrors,
        preview_rows: previewRows
      }) ?? {},
      normalized_rows: toPrismaJson(sourceRows) ?? []
    }
  });

  return {
    batch_public_id: batch.batch_public_id,
    source_file_name: batch.source_file_name,
    total_rows: summary.total_rows,
    valid_rows: summary.valid_rows,
    invalid_rows: summary.invalid_rows,
    duplicate_rows: summary.duplicate_rows,
    conflicting_rows: summary.conflicting_rows,
    unmatched_user_rows: summary.unmatched_user_rows,
    preview_rows: previewRows,
    validation_errors: validationErrors
  };
}

function normalizedRowsFromBatch(value: unknown): NormalizedRow[] {
  if (!Array.isArray(value)) {
    throw new SummativeOutcomeServiceError(
      "invalid_batch_state",
      "Import batch does not contain normalized rows.",
      409
    );
  }

  return value as NormalizedRow[];
}

export async function commitSummativeOutcomeImport(input: {
  teacher_user_db_id: string;
  batch_public_id: string;
}) {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.summativeOutcomeImportBatch.findUnique({
      where: { batch_public_id: input.batch_public_id }
    });

    if (!batch) {
      throw new SummativeOutcomeServiceError(
        "not_found",
        "Import batch was not found.",
        404,
        { batch_public_id: input.batch_public_id }
      );
    }

    if (batch.uploaded_by_user_db_id !== input.teacher_user_db_id) {
      throw new SummativeOutcomeServiceError(
        "forbidden",
        "This import batch belongs to another teacher_researcher account.",
        403
      );
    }

    if (batch.status === "committed") {
      return {
        batch_public_id: batch.batch_public_id,
        status: batch.status,
        committed_rows: batch.committed_rows,
        message: "Import batch was already committed."
      };
    }

    if (batch.status !== "previewed") {
      throw new SummativeOutcomeServiceError(
        "invalid_batch_status",
        "Only previewed import batches can be committed.",
        409,
        { status: batch.status }
      );
    }

    if (
      batch.invalid_rows > 0 ||
      batch.duplicate_rows > 0 ||
      batch.conflicting_rows > 0 ||
      batch.unmatched_user_rows > 0
    ) {
      throw new SummativeOutcomeServiceError(
        "batch_has_validation_errors",
        "Import batch contains invalid, duplicate, unmatched, or conflicting rows.",
        409,
        {
          invalid_rows: batch.invalid_rows,
          duplicate_rows: batch.duplicate_rows,
          conflicting_rows: batch.conflicting_rows,
          unmatched_user_rows: batch.unmatched_user_rows
        }
      );
    }

    const rows = normalizedRowsFromBatch(batch.normalized_rows);
    let committedRows = 0;

    for (const row of rows) {
      if (row.row_status !== "valid" || !row.user_db_id || !row.outcome_score || !row.max_score) {
        continue;
      }

      const assessmentDate = parseDateOnly(row.assessment_date);

      if (!assessmentDate) {
        throw new SummativeOutcomeServiceError(
          "invalid_batch_state",
          "Validated import batch contains an invalid assessment date.",
          409,
          { source_row_number: row.source_row_number }
        );
      }

      const existing = await tx.summativeOutcome.findFirst({
        where: {
          user_db_id: row.user_db_id,
          outcome_name: row.outcome_name,
          assessment_date: assessmentDate,
          record_status: "active"
        },
        select: {
          outcome_score: true,
          max_score: true,
          notes: true
        }
      });

      if (existing) {
        if (exactOutcomeMatch(existing, row)) {
          continue;
        }

        throw new SummativeOutcomeServiceError(
          "conflicting_active_outcome",
          "A conflicting active outcome was created after preview.",
          409,
          { source_row_number: row.source_row_number }
        );
      }

      await tx.summativeOutcome.create({
        data: {
          id: crypto.randomUUID(),
          outcome_public_id: generatePublicId("summative_outcome"),
          user_db_id: row.user_db_id,
          user_id_snapshot: row.user_id,
          outcome_name: row.outcome_name,
          outcome_score: new Prisma.Decimal(row.outcome_score),
          max_score: new Prisma.Decimal(row.max_score),
          assessment_date: assessmentDate,
          notes: row.notes,
          uploaded_by_user_db_id: input.teacher_user_db_id,
          import_batch_db_id: batch.id,
          source_row_number: row.source_row_number,
          record_status: "active",
          revision_number: 1
        }
      });
      committedRows += 1;
    }

    const updated = await tx.summativeOutcomeImportBatch.update({
      where: { id: batch.id },
      data: {
        status: "committed",
        committed_rows: committedRows,
        committed_at: new Date()
      }
    });

    return {
      batch_public_id: updated.batch_public_id,
      status: updated.status,
      committed_rows: updated.committed_rows
    };
  });
}

export async function listSummativeOutcomeImportBatches() {
  const batches = await prisma.summativeOutcomeImportBatch.findMany({
    orderBy: { created_at: "desc" },
    take: 100,
    select: {
      batch_public_id: true,
      source_file_name: true,
      status: true,
      total_rows: true,
      valid_rows: true,
      invalid_rows: true,
      duplicate_rows: true,
      conflicting_rows: true,
      unmatched_user_rows: true,
      committed_rows: true,
      validation_summary: true,
      created_at: true,
      committed_at: true
    }
  });

  return {
    import_batches: batches.map((batch) => ({
      batch_public_id: batch.batch_public_id,
      source_file_name: batch.source_file_name,
      status: batch.status,
      total_rows: batch.total_rows,
      valid_rows: batch.valid_rows,
      invalid_rows: batch.invalid_rows,
      duplicate_rows: batch.duplicate_rows,
      conflicting_rows: batch.conflicting_rows,
      unmatched_user_rows: batch.unmatched_user_rows,
      committed_rows: batch.committed_rows,
      created_at: serializeDate(batch.created_at),
      committed_at: serializeDate(batch.committed_at)
    }))
  };
}

export async function getSummativeOutcomeImportBatch(batchPublicId: string) {
  const batch = await prisma.summativeOutcomeImportBatch.findUnique({
    where: { batch_public_id: batchPublicId },
    select: {
      batch_public_id: true,
      source_file_name: true,
      status: true,
      total_rows: true,
      valid_rows: true,
      invalid_rows: true,
      duplicate_rows: true,
      conflicting_rows: true,
      unmatched_user_rows: true,
      committed_rows: true,
      validation_summary: true,
      created_at: true,
      committed_at: true,
      summative_outcomes: {
        orderBy: [{ user_id_snapshot: "asc" }, { outcome_name: "asc" }],
        select: {
          outcome_public_id: true,
          user_id_snapshot: true,
          outcome_name: true,
          outcome_score: true,
          max_score: true,
          assessment_date: true,
          notes: true,
          source_row_number: true,
          record_status: true,
          revision_number: true,
          created_at: true,
          updated_at: true
        }
      }
    }
  });

  if (!batch) {
    throw new SummativeOutcomeServiceError("not_found", "Import batch was not found.", 404, {
      batch_public_id: batchPublicId
    });
  }

  const summary =
    batch.validation_summary && typeof batch.validation_summary === "object"
      ? (batch.validation_summary as Record<string, unknown>)
      : {};

  return {
    batch_public_id: batch.batch_public_id,
    source_file_name: batch.source_file_name,
    status: batch.status,
    total_rows: batch.total_rows,
    valid_rows: batch.valid_rows,
    invalid_rows: batch.invalid_rows,
    duplicate_rows: batch.duplicate_rows,
    conflicting_rows: batch.conflicting_rows,
    unmatched_user_rows: batch.unmatched_user_rows,
    committed_rows: batch.committed_rows,
    created_at: serializeDate(batch.created_at),
    committed_at: serializeDate(batch.committed_at),
    preview_rows: Array.isArray(summary.preview_rows) ? summary.preview_rows : [],
    validation_errors: Array.isArray(summary.validation_errors)
      ? summary.validation_errors
      : [],
    outcomes: batch.summative_outcomes.map(serializeSummativeOutcome)
  };
}

export async function listSummativeOutcomeNames() {
  const grouped = await prisma.summativeOutcome.groupBy({
    by: ["outcome_name"],
    where: { record_status: "active" },
    _count: { _all: true },
    orderBy: { outcome_name: "asc" }
  });

  return {
    outcome_names: grouped.map((entry) => ({
      outcome_name: entry.outcome_name,
      active_outcome_count: entry._count._all
    }))
  };
}

export async function replaceSummativeOutcome(input: {
  teacher_user_db_id: string;
  outcome_public_id: string;
  data: z.input<typeof replaceOutcomeSchema>;
}) {
  const parsed = replaceOutcomeSchema.parse(input.data);

  return prisma.$transaction(async (tx) => {
    const current = await tx.summativeOutcome.findUnique({
      where: { outcome_public_id: input.outcome_public_id }
    });

    if (!current || current.record_status !== "active") {
      throw new SummativeOutcomeServiceError(
        "not_found",
        "Active summative outcome was not found.",
        404,
        { outcome_public_id: input.outcome_public_id }
      );
    }

    await tx.summativeOutcome.update({
      where: { id: current.id },
      data: { record_status: "superseded" }
    });

    const replacement = await tx.summativeOutcome.create({
      data: {
        id: crypto.randomUUID(),
        outcome_public_id: generatePublicId("summative_outcome"),
        user_db_id: current.user_db_id,
        user_id_snapshot: current.user_id_snapshot,
        outcome_name: current.outcome_name,
        outcome_score: new Prisma.Decimal(parsed.outcome_score),
        max_score: new Prisma.Decimal(parsed.max_score),
        assessment_date: current.assessment_date,
        notes: normalizeNotes(parsed.notes),
        uploaded_by_user_db_id: input.teacher_user_db_id,
        import_batch_db_id: null,
        source_row_number: null,
        record_status: "active",
        revision_number: current.revision_number + 1,
        supersedes_outcome_db_id: current.id
      }
    });

    return {
      replaced_outcome_public_id: current.outcome_public_id,
      outcome: serializeSummativeOutcome(replacement)
    };
  });
}
