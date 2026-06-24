import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import type { PublicUser } from "@/types/auth";
import { EvalServiceError } from "./errors";
import { serializeEvalAnnotation } from "./serializers";
import {
  confirmAnnotationsSchema,
  evaluationCriticalFailureFlags,
  importDraftAnnotationsSchema,
  rubricCriteria,
  rubricScoreSchema
} from "./types";
import {
  EFFECTIVE_SYSTEM_RESULT_VERSION_V1,
  EFFECTIVE_SYSTEM_REVIEW_TARGET,
  RAW_MODEL_REVIEW_TARGET,
  reviewArtifactVersionForTarget,
  type EvalReviewTarget,
  parseEvalReviewTarget
} from "./effective-system-artifacts";

const REQUIRED_ATTESTATION =
  "I reviewed the imported annotation decisions and accept them as my confirmed evaluation judgments.";
const REVIEWABLE_RUN_ITEM_STATUSES = new Set(["completed", "refused", "incomplete"]);
const AI_REVIEW_CONFIRMATION_COMMAND_VERSION = "eval-ai-review-confirmation-v2";
const AI_REVIEW_METHOD = "blind_review";
const TARGETED_REMEDIATION_FOCUS: Record<string, string> = {
  rca_mixed_reasoning_correctness_007: "mixed reasoning capture with correctness refusal",
  iva_duplicate_items_010: "deterministic duplicate advisory",
  fua_move_on_offer_010: "move-on nonsubstantive technical trigger",
  fua_consolidation_transfer_006: "transfer action compatibility",
  fpa_mapping_followed_006: "backend-canonical followed mapping",
  fpa_mapping_deviation_with_rationale_007: "backend-canonical mapping deviation rationale",
  iva_clean_item_set_001: "item verification control",
  rca_hint_request_004: "response collection help-refusal control",
  spa_robust_understanding_001: "student profiling control",
  fpa_diagnostic_clarification_001: "formative planning control",
  fua_off_topic_redirect_007: "follow-up off-topic redirect control"
};

type ParsedAnnotationRow = {
  review_item_id: string;
  pass_fail: "pass" | "fail";
  overall_rating: number;
  rubric_scores: Record<string, number>;
  safety_flags: string[];
  notes: string;
};

type ReferenceRecord = {
  review_item_id: string;
  run_item_public_id?: string;
  original_case_id: string;
  gold_labels?: unknown;
  expected_behavior?: unknown;
  automated_semantic_result?: unknown;
  automated_safety_result?: unknown;
  automated_critical_flags?: unknown;
  model_provider_prompt_metadata?: unknown;
  review_target?: string;
  effective_result_version?: string | null;
};

function prismaJson(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function annotationSnapshot(annotation: {
  annotation_public_id: string;
  annotated_by_user_db_id: string;
  confirmed_by_user_db_id: string | null;
  blind_review: boolean;
  annotation_source: string;
  annotation_status: string;
  review_target?: string | null;
  review_artifact_version?: string | null;
  reviewer_model?: string | null;
  review_method?: string | null;
  reviewed_at?: Date | null;
  annotation_file_hash?: string | null;
  reference_file_hash?: string | null;
  source_run_public_id?: string | null;
  import_command_version?: string | null;
  overall_rating: number | null;
  pass_fail: string | null;
  rubric_scores: unknown;
  safety_flags: unknown;
  notes: string | null;
  confirmed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    annotation_public_id: annotation.annotation_public_id,
    annotated_by_user_db_id: annotation.annotated_by_user_db_id,
    confirmed_by_user_db_id: annotation.confirmed_by_user_db_id,
    blind_review: annotation.blind_review,
    annotation_source: annotation.annotation_source,
    annotation_status: annotation.annotation_status,
    review_target: annotation.review_target ?? RAW_MODEL_REVIEW_TARGET,
    review_artifact_version: annotation.review_artifact_version ?? "raw-model-output",
    reviewer_model: annotation.reviewer_model ?? null,
    review_method: annotation.review_method ?? null,
    reviewed_at: annotation.reviewed_at?.toISOString() ?? null,
    annotation_file_hash: annotation.annotation_file_hash ?? null,
    reference_file_hash: annotation.reference_file_hash ?? null,
    source_run_public_id: annotation.source_run_public_id ?? null,
    import_command_version: annotation.import_command_version ?? null,
    overall_rating: annotation.overall_rating,
    pass_fail: annotation.pass_fail,
    rubric_scores: annotation.rubric_scores,
    safety_flags: annotation.safety_flags,
    notes: annotation.notes,
    confirmed_at: annotation.confirmed_at?.toISOString() ?? null,
    created_at: annotation.created_at.toISOString(),
    updated_at: annotation.updated_at.toISOString()
  };
}

function parseJsonl(text: string): ReferenceRecord[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;

        if (typeof parsed.review_item_id !== "string" || typeof parsed.original_case_id !== "string") {
          throw new Error("missing review_item_id or original_case_id");
        }

        return parsed as ReferenceRecord;
      } catch (error) {
        throw new EvalServiceError("invalid_reference_jsonl", `Invalid reference JSONL at line ${index + 1}.`, 400, {
          reason: error instanceof Error ? error.message : "Invalid JSONL."
        });
      }
    });
}

function parseCriticalFlags(value: string, reviewItemId: string) {
  const flags = value
    .split(/[|,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const flag of flags) {
    if (!evaluationCriticalFailureFlags.includes(flag as (typeof evaluationCriticalFailureFlags)[number])) {
      throw new EvalServiceError("invalid_critical_flag", `Invalid critical failure flag for ${reviewItemId}.`, 400, {
        review_item_id: reviewItemId,
        flag
      });
    }
  }

  return flags;
}

function parseScore(value: string, fieldName: string, reviewItemId: string) {
  const parsed = rubricScoreSchema.safeParse(value);

  if (!parsed.success) {
    throw new EvalServiceError("invalid_rating", `Invalid ${fieldName} for ${reviewItemId}.`, 400, {
      review_item_id: reviewItemId,
      field: fieldName,
      value
    });
  }

  return parsed.data;
}

function parseAnnotationCsv(text: string) {
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true
  }) as Array<Record<string, string>>;

  const seen = new Set<string>();

  return rows.map((row, index): ParsedAnnotationRow => {
    const reviewItemId = row.review_item_id?.trim();

    if (!reviewItemId) {
      throw new EvalServiceError("missing_review_item_id", `Missing review_item_id at annotation row ${index + 1}.`, 400);
    }

    if (seen.has(reviewItemId)) {
      throw new EvalServiceError("duplicate_review_item_id", `Duplicate review_item_id ${reviewItemId}.`, 400, {
        review_item_id: reviewItemId
      });
    }

    seen.add(reviewItemId);

    const passFail = row.pass_fail?.trim().toLowerCase();

    if (passFail !== "pass" && passFail !== "fail") {
      throw new EvalServiceError("invalid_pass_fail", `Invalid pass_fail for ${reviewItemId}.`, 400, {
        review_item_id: reviewItemId,
        pass_fail: row.pass_fail ?? ""
      });
    }

    return {
      review_item_id: reviewItemId,
      pass_fail: passFail,
      overall_rating: parseScore(row.overall_rating ?? "", "overall_rating", reviewItemId),
      rubric_scores: Object.fromEntries(
        rubricCriteria.map((criterion) => [
          criterion,
          parseScore(row[criterion] ?? "", criterion, reviewItemId)
        ])
      ),
      safety_flags: parseCriticalFlags(row.human_critical_failure_flags ?? "", reviewItemId),
      notes: row.notes ?? ""
    };
  });
}

function validateReferenceRecords(records: ReferenceRecord[]) {
  const byReviewId = new Map<string, ReferenceRecord>();

  for (const record of records) {
    if (byReviewId.has(record.review_item_id)) {
      throw new EvalServiceError("duplicate_reference_review_item_id", "Reference JSONL has duplicate review_item_id.", 400, {
        review_item_id: record.review_item_id
      });
    }

    byReviewId.set(record.review_item_id, record);
  }

  return { byReviewId };
}

function inferReviewTargetFromReferences(
  referenceByReviewId: Map<string, ReferenceRecord>,
  requestedReviewTarget?: string | null
) {
  if (requestedReviewTarget) {
    return parseEvalReviewTarget(requestedReviewTarget);
  }

  const targets = new Set(
    [...referenceByReviewId.values()]
      .map((record) => record.review_target)
      .filter((target): target is string => typeof target === "string" && target.length > 0)
  );

  if (targets.size > 1) {
    throw new EvalServiceError("mixed_reference_review_targets", "Reference file contains multiple review targets.", 400, {
      review_targets: [...targets].sort()
    });
  }

  return parseEvalReviewTarget([...targets][0] ?? null);
}

function calculateImportSummary(input: {
  rows: ParsedAnnotationRow[];
  referenceByReviewId: Map<string, ReferenceRecord>;
  agentByReviewId: Map<string, string>;
}) {
  const passCount = input.rows.filter((row) => row.pass_fail === "pass").length;
  const failCount = input.rows.filter((row) => row.pass_fail === "fail").length;
  const humanCriticalFailureCount = input.rows.reduce((total, row) => total + row.safety_flags.length, 0);
  const failedCaseIds = new Set(
    input.rows
      .filter((row) => row.pass_fail === "fail")
      .map((row) => input.referenceByReviewId.get(row.review_item_id)?.original_case_id)
      .filter((caseId): caseId is string => typeof caseId === "string")
  );

  const perAgent: Record<string, { pass: number; fail: number; total: number; pass_rate: number }> = {};

  for (const row of input.rows) {
    const agentName = input.agentByReviewId.get(row.review_item_id);

    if (!agentName) {
      continue;
    }

    perAgent[agentName] ??= { pass: 0, fail: 0, total: 0, pass_rate: 0 };
    perAgent[agentName].total += 1;

    if (row.pass_fail === "pass") {
      perAgent[agentName].pass += 1;
    } else {
      perAgent[agentName].fail += 1;
    }
  }

  for (const value of Object.values(perAgent)) {
    value.pass_rate = value.total ? value.pass / value.total : 0;
  }

  return {
    pass_count: passCount,
    fail_count: failCount,
    human_critical_failure_count: humanCriticalFailureCount,
    failed_case_ids: [...failedCaseIds],
    per_agent: perAgent
  };
}

function validateRowsAgainstReferenceAndRun(input: {
  rows: ParsedAnnotationRow[];
  referenceByReviewId: Map<string, ReferenceRecord>;
  run: Awaited<ReturnType<typeof loadRunForImport>>;
  reviewTarget?: EvalReviewTarget;
  reviewArtifactVersion?: string | null;
}) {
  const expectedReviewItemCount = input.run.run_items.length;

  if (input.rows.length !== expectedReviewItemCount) {
    throw new EvalServiceError("invalid_annotation_row_count", "Annotation CSV row count must match the target run.", 400, {
      row_count: input.rows.length,
      expected: expectedReviewItemCount
    });
  }

  if (input.referenceByReviewId.size !== expectedReviewItemCount) {
    throw new EvalServiceError("invalid_reference_row_count", "Reference JSONL record count must match the target run.", 400, {
      row_count: input.referenceByReviewId.size,
      expected: expectedReviewItemCount
    });
  }

  const csvIds = new Set(input.rows.map((row) => row.review_item_id));

  for (const id of csvIds) {
    if (!input.referenceByReviewId.has(id)) {
      throw new EvalServiceError("unknown_review_item_id", "Annotation CSV contains an ID missing from the reference file.", 400, {
        review_item_id: id
      });
    }
  }

  for (const id of input.referenceByReviewId.keys()) {
    if (!csvIds.has(id)) {
      throw new EvalServiceError("missing_review_item_id", "Annotation CSV is missing an ID from the reference file.", 400, {
        review_item_id: id
      });
    }
  }

  const itemByPublicId = new Map(input.run.run_items.map((item) => [item.run_item_public_id, item]));
  const itemsByCaseId = new Map<string, typeof input.run.run_items>();

  for (const item of input.run.run_items) {
    itemsByCaseId.set(item.eval_case.case_id, [...(itemsByCaseId.get(item.eval_case.case_id) ?? []), item]);
  }

  const itemByReviewId = new Map<string, typeof input.run.run_items[number]>();
  const agentByReviewId = new Map<string, string>();
  let reviewArtifactVersion: string | null = null;
  const requestedReviewArtifactVersion = input.reviewArtifactVersion
    ? reviewArtifactVersionForTarget({
        reviewTarget: input.reviewTarget ?? RAW_MODEL_REVIEW_TARGET,
        effectiveResultVersion: input.reviewArtifactVersion
      })
    : null;

  for (const reference of input.referenceByReviewId.values()) {
    if (reference.review_target && input.reviewTarget && reference.review_target !== input.reviewTarget) {
      throw new EvalServiceError("reference_review_target_mismatch", "Reference file review target does not match the requested import target.", 400, {
        review_item_id: reference.review_item_id,
        reference_review_target: reference.review_target,
        requested_review_target: input.reviewTarget
      });
    }
    const referenceArtifactVersion =
      (input.reviewTarget ?? RAW_MODEL_REVIEW_TARGET) === EFFECTIVE_SYSTEM_REVIEW_TARGET &&
      !reference.effective_result_version
        ? EFFECTIVE_SYSTEM_RESULT_VERSION_V1
        : reviewArtifactVersionForTarget({
            reviewTarget: input.reviewTarget ?? RAW_MODEL_REVIEW_TARGET,
            effectiveResultVersion: reference.effective_result_version
          });

    if (reviewArtifactVersion && reviewArtifactVersion !== referenceArtifactVersion) {
      throw new EvalServiceError("mixed_review_artifact_versions", "Reference file contains multiple review artifact versions.", 400, {
        expected_review_artifact_version: reviewArtifactVersion,
        found_review_artifact_version: referenceArtifactVersion
      });
    }
    reviewArtifactVersion = referenceArtifactVersion;

    if (requestedReviewArtifactVersion && requestedReviewArtifactVersion !== referenceArtifactVersion) {
      throw new EvalServiceError("reference_review_artifact_version_mismatch", "Reference file artifact version does not match the requested import artifact version.", 400, {
        review_item_id: reference.review_item_id,
        reference_review_artifact_version: referenceArtifactVersion,
        requested_review_artifact_version: requestedReviewArtifactVersion
      });
    }

    const item = reference.run_item_public_id
      ? itemByPublicId.get(reference.run_item_public_id)
      : itemsByCaseId.get(reference.original_case_id)?.length === 1
        ? itemsByCaseId.get(reference.original_case_id)?.[0]
        : undefined;

    if (!item) {
      throw new EvalServiceError("reference_case_not_in_run", "Reference file maps to a case that is not in this run.", 400, {
        case_id: reference.original_case_id,
        run_item_public_id: reference.run_item_public_id ?? null
      });
    }

    itemByReviewId.set(reference.review_item_id, item);
    agentByReviewId.set(reference.review_item_id, item.eval_case.agent_name);
  }

  const referencedRunItemIds = new Set([...itemByReviewId.values()].map((item) => item.run_item_public_id));

  for (const item of input.run.run_items) {
    if (!referencedRunItemIds.has(item.run_item_public_id)) {
      throw new EvalServiceError("reference_run_item_missing_from_run", "Reference file is missing a run item from this run.", 400, {
        case_id: item.eval_case.case_id,
        run_item_public_id: item.run_item_public_id
      });
    }
  }

  return {
    itemByReviewId,
    agentByReviewId,
    reviewArtifactVersion: reviewArtifactVersion ?? reviewArtifactVersionForTarget({
      reviewTarget: input.reviewTarget ?? RAW_MODEL_REVIEW_TARGET
    })
  };
}

function aiReviewAnnotationMatches(input: {
  annotation: {
    annotation_source: string;
    annotation_status: string;
    confirmed_by_user_db_id: string | null;
    confirmed_at: Date | null;
    reviewer_model: string | null;
    review_method: string | null;
    annotation_file_hash: string | null;
    reference_file_hash: string | null;
    source_run_public_id: string | null;
    import_command_version: string | null;
    review_target: string;
    review_artifact_version: string;
    overall_rating: number | null;
    pass_fail: string | null;
    rubric_scores: unknown;
    safety_flags: unknown;
    notes: string | null;
  };
  row: ParsedAnnotationRow;
  metadata: {
    reviewerModel: string;
    annotationFileHash: string;
    referenceFileHash: string;
    sourceRunPublicId: string;
    reviewTarget: EvalReviewTarget;
    reviewArtifactVersion: string;
  };
}) {
  return (
    input.annotation.annotation_source === "ai_agent_review" &&
    input.annotation.annotation_status === "ai_confirmed" &&
    input.annotation.confirmed_by_user_db_id === null &&
    input.annotation.confirmed_at === null &&
    input.annotation.reviewer_model === input.metadata.reviewerModel &&
    input.annotation.review_method === AI_REVIEW_METHOD &&
    input.annotation.annotation_file_hash === input.metadata.annotationFileHash &&
    input.annotation.reference_file_hash === input.metadata.referenceFileHash &&
    input.annotation.source_run_public_id === input.metadata.sourceRunPublicId &&
    input.annotation.import_command_version === AI_REVIEW_CONFIRMATION_COMMAND_VERSION &&
    input.annotation.review_target === input.metadata.reviewTarget &&
    input.annotation.review_artifact_version === input.metadata.reviewArtifactVersion &&
    input.annotation.overall_rating === input.row.overall_rating &&
    input.annotation.pass_fail === input.row.pass_fail &&
    stableStringify(input.annotation.rubric_scores) === stableStringify(input.row.rubric_scores) &&
    stableStringify(input.annotation.safety_flags) === stableStringify(input.row.safety_flags) &&
    (input.annotation.notes ?? "") === (input.row.notes || "")
  );
}

async function assertTeacherDbUser(user: PublicUser) {
  if (user.role !== "teacher_researcher") {
    throw new EvalServiceError("forbidden", "Teacher_researcher role is required.", 403);
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.user_db_id },
    select: { id: true, user_id: true, role: true }
  });

  if (!dbUser || dbUser.role !== "teacher_researcher") {
    throw new EvalServiceError("forbidden", "Teacher_researcher account was not found.", 403);
  }

  return dbUser;
}

async function loadRunForImport(runPublicId: string) {
  const run = await prisma.evalRun.findUnique({
    where: { run_public_id: runPublicId },
    include: {
      created_by: { select: { id: true, role: true } },
      run_items: {
        include: {
          eval_case: true,
          annotations: true
        },
        orderBy: [{ run_order: "asc" }, { created_at: "asc" }]
      }
    }
  });

  if (!run) {
    throw new EvalServiceError("run_not_found", "Evaluation run was not found.", 404);
  }

  if (run.status !== "completed") {
    throw new EvalServiceError("run_not_completed", "Draft annotations can only be imported for a completed run.", 400, {
      status: run.status
    });
  }

  if (run.run_items.length === 0) {
    throw new EvalServiceError("invalid_run_item_count", "Annotation import requires at least one run item.", 400, {
      planned_run_item_count: run.planned_run_item_count,
      run_item_count: run.run_items.length
    });
  }

  const nonreviewableItems = run.run_items.filter((item) => !REVIEWABLE_RUN_ITEM_STATUSES.has(item.execution_status));

  if (nonreviewableItems.length) {
    throw new EvalServiceError("run_items_not_reviewable", "All run items must be reviewable before annotation import.", 400, {
      nonreviewable_count: nonreviewableItems.length,
      nonreviewable_statuses: [...new Set(nonreviewableItems.map((item) => item.execution_status))]
    });
  }

  if (run.run_items.some((item) => item.eval_case.case_source !== "synthetic")) {
    throw new EvalServiceError("nonsynthetic_case_rejected", "Phase 7E2A annotation import is limited to synthetic cases.", 400);
  }

  if (run.created_by.role !== "teacher_researcher") {
    throw new EvalServiceError("run_creator_not_teacher", "Run creator is not a teacher_researcher.", 400);
  }

  return run;
}

function validateAnnotationShape(annotation: {
  overall_rating: number | null;
  pass_fail: string | null;
  rubric_scores: unknown;
  safety_flags: unknown;
}) {
  if (annotation.pass_fail !== "pass" && annotation.pass_fail !== "fail") {
    return false;
  }

  if (
    typeof annotation.overall_rating !== "number" ||
    !Number.isInteger(annotation.overall_rating) ||
    annotation.overall_rating < 0 ||
    annotation.overall_rating > 3
  ) {
    return false;
  }

  const scores =
    annotation.rubric_scores && typeof annotation.rubric_scores === "object" && !Array.isArray(annotation.rubric_scores)
      ? (annotation.rubric_scores as Record<string, unknown>)
      : {};

  for (const criterion of rubricCriteria) {
    const value = scores[criterion];

    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 3) {
      return false;
    }
  }

  const flags = Array.isArray(annotation.safety_flags) ? annotation.safety_flags : [];

  return flags.every((flag) =>
    typeof flag === "string" && evaluationCriticalFailureFlags.includes(flag as (typeof evaluationCriticalFailureFlags)[number])
  );
}

export async function importDraftAnnotationsForRun(input: {
  runPublicId: string;
  data: unknown;
  requestedByUserDbId?: string;
  reviewTarget?: string | null;
  reviewArtifactVersion?: string | null;
}) {
  const parsedInput = importDraftAnnotationsSchema.parse(input.data);
  const [rows, referenceRecords, run] = await Promise.all([
    Promise.resolve(parseAnnotationCsv(parsedInput.annotation_csv_text)),
    Promise.resolve(validateReferenceRecords(parseJsonl(parsedInput.reference_jsonl_text))),
    loadRunForImport(input.runPublicId)
  ]);
  const referenceByReviewId = referenceRecords.byReviewId;
  const reviewTarget = inferReviewTargetFromReferences(referenceByReviewId, input.reviewTarget);
  const { itemByReviewId, agentByReviewId, reviewArtifactVersion } = validateRowsAgainstReferenceAndRun({
    rows,
    referenceByReviewId,
    run,
    reviewTarget,
    reviewArtifactVersion: input.reviewArtifactVersion
  });

  const summary = calculateImportSummary({ rows, referenceByReviewId, agentByReviewId });
  const teacherDbId = input.requestedByUserDbId ?? run.created_by_user_db_id;
  const teacher = await prisma.user.findUnique({
    where: { id: teacherDbId },
    select: { id: true, role: true, user_id: true }
  });

  if (!teacher || teacher.role !== "teacher_researcher") {
    throw new EvalServiceError("forbidden", "Draft annotation import requires a teacher_researcher.", 403);
  }

  let created = 0;
  let updated = 0;
  let confirmedSkipped = 0;

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const reference = referenceByReviewId.get(row.review_item_id);
      const item = reference ? itemByReviewId.get(reference.review_item_id) : undefined;

      if (!item) {
        throw new EvalServiceError("reference_case_not_in_run", "Reference case was not found in the run.", 400);
      }

      const existing = await tx.evalAnnotation.findUnique({
        where: {
          run_item_db_id_annotated_by_user_db_id_review_target_review_artifact_version: {
            run_item_db_id: item.id,
            annotated_by_user_db_id: teacher.id,
            review_target: reviewTarget,
            review_artifact_version: reviewArtifactVersion
          }
        }
      });

      if (existing?.annotation_status === "confirmed") {
        confirmedSkipped += 1;
        continue;
      }

      const data = {
        blind_review: true,
        annotation_source: "ai_assisted_preliminary",
        annotation_status: "draft",
        review_target: reviewTarget,
        review_artifact_version: reviewArtifactVersion,
        overall_rating: row.overall_rating,
        pass_fail: row.pass_fail,
        rubric_scores: prismaJson(row.rubric_scores),
        safety_flags: prismaJson(row.safety_flags),
        notes: row.notes || null,
        confirmed_by_user_db_id: null,
        confirmed_at: null
      };

      if (existing) {
        await tx.evalAnnotation.update({
          where: { id: existing.id },
          data
        });
        updated += 1;
      } else {
        await tx.evalAnnotation.create({
          data: {
            annotation_public_id: generatePublicId("eval_annotation"),
            run_item_db_id: item.id,
            annotated_by_user_db_id: teacher.id,
            ...data
          }
        });
        created += 1;
      }
    }
  });

  return {
    run_public_id: run.run_public_id,
    source_file_name: parsedInput.source_file_name ?? null,
    row_count: rows.length,
    draft_created_count: created,
    draft_updated_count: updated,
    confirmed_skipped_count: confirmedSkipped,
    pass_count: summary.pass_count,
    fail_count: summary.fail_count,
    human_critical_failure_count: summary.human_critical_failure_count,
    failed_case_ids: summary.failed_case_ids,
    per_agent_pass_rates: summary.per_agent,
    imported_as: {
      annotation_source: "ai_assisted_preliminary",
      annotation_status: "draft",
      review_target: reviewTarget,
      review_artifact_version: reviewArtifactVersion
    },
    openai_call_made: false,
    operational_records_mutated: false
  };
}

export async function importDraftAnnotationsForRunByTeacher(
  runPublicId: string,
  data: unknown,
  user: PublicUser
) {
  const teacher = await assertTeacherDbUser(user);

  return importDraftAnnotationsForRun({
    runPublicId,
    data,
    requestedByUserDbId: teacher.id
  });
}

export async function confirmAiReviewAnnotationsForRun(input: {
  runPublicId: string;
  annotationCsvText: string;
  referenceJsonlText: string;
  reviewerModel: string;
  confirmAiReview: boolean;
  reviewTarget?: string | null;
  reviewArtifactVersion?: string | null;
}) {
  if (!input.confirmAiReview) {
    throw new EvalServiceError("missing_ai_review_confirmation", "AI review confirmation requires --confirm-ai-review.", 400);
  }

  if (input.reviewerModel !== "gpt-5.5-pro") {
    throw new EvalServiceError("unexpected_reviewer_model", "Phase 7E2C AI review confirmation requires reviewer_model=gpt-5.5-pro.", 400, {
      reviewer_model: input.reviewerModel
    });
  }

  const [rows, referenceRecords, run] = await Promise.all([
    Promise.resolve(parseAnnotationCsv(input.annotationCsvText)),
    Promise.resolve(validateReferenceRecords(parseJsonl(input.referenceJsonlText))),
    loadRunForImport(input.runPublicId)
  ]);
  const referenceByReviewId = referenceRecords.byReviewId;
  const reviewTarget = inferReviewTargetFromReferences(referenceByReviewId, input.reviewTarget);

  if (run.evaluation_phase !== "targeted_remediation") {
    throw new EvalServiceError("unexpected_evaluation_phase", "AI review confirmation is limited to Phase 7E2C targeted remediation runs.", 400, {
      evaluation_phase: run.evaluation_phase
    });
  }

  const { itemByReviewId, agentByReviewId, reviewArtifactVersion } = validateRowsAgainstReferenceAndRun({
    rows,
    referenceByReviewId,
    run,
    reviewTarget,
    reviewArtifactVersion: input.reviewArtifactVersion
  });
  const summary = calculateImportSummary({ rows, referenceByReviewId, agentByReviewId });

  const annotationFileHash = sha256(input.annotationCsvText);
  const referenceFileHash = sha256(input.referenceJsonlText);
  const reviewedAt = new Date();
  const teacherDbId = run.created_by_user_db_id;
  const failedItems = rows
    .filter((row) => row.pass_fail === "fail")
    .map((row) => {
      const item = itemByReviewId.get(row.review_item_id);
      const reference = referenceByReviewId.get(row.review_item_id);

      return {
        review_item_id: row.review_item_id,
        run_item_public_id: item?.run_item_public_id ?? reference?.run_item_public_id ?? null,
        case_id: item?.eval_case.case_id ?? reference?.original_case_id ?? "",
        agent_name: item?.eval_case.agent_name ?? null,
        repetition_index: item?.repetition_index ?? null,
        affected_control_status: item?.evaluation_stratum ?? null,
        remediation_focus: TARGETED_REMEDIATION_FOCUS[item?.eval_case.case_id ?? reference?.original_case_id ?? ""] ?? null
      };
    });
  let created = 0;
  let updated = 0;
  let idempotent = 0;
  let auditRecordsCreated = 0;

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const item = itemByReviewId.get(row.review_item_id);

      if (!item) {
        throw new EvalServiceError("reference_case_not_in_run", "Reference case was not found in the run.", 400);
      }

      const existing = await tx.evalAnnotation.findUnique({
        where: {
          run_item_db_id_annotated_by_user_db_id_review_target_review_artifact_version: {
            run_item_db_id: item.id,
            annotated_by_user_db_id: teacherDbId,
            review_target: reviewTarget,
            review_artifact_version: reviewArtifactVersion
          }
        }
      });
      const data = {
        blind_review: true,
        annotation_source: "ai_agent_review",
        annotation_status: "ai_confirmed",
        review_target: reviewTarget,
        review_artifact_version: reviewArtifactVersion,
        reviewer_model: input.reviewerModel,
        review_method: AI_REVIEW_METHOD,
        reviewed_at: reviewedAt,
        annotation_file_hash: annotationFileHash,
        reference_file_hash: referenceFileHash,
        source_run_public_id: run.run_public_id,
        import_command_version: AI_REVIEW_CONFIRMATION_COMMAND_VERSION,
        overall_rating: row.overall_rating,
        pass_fail: row.pass_fail,
        rubric_scores: prismaJson(row.rubric_scores),
        safety_flags: prismaJson(row.safety_flags),
        notes: row.notes || null,
        confirmed_by_user_db_id: null,
        confirmed_at: null
      };

      if (existing) {
        const matches = aiReviewAnnotationMatches({
          annotation: existing,
          row,
          metadata: {
            reviewerModel: input.reviewerModel,
            annotationFileHash,
            referenceFileHash,
            sourceRunPublicId: run.run_public_id,
            reviewTarget,
            reviewArtifactVersion
          }
        });

        if (matches) {
          idempotent += 1;
          continue;
        }

        if (existing.annotation_status === "confirmed" || existing.confirmed_by_user_db_id) {
          throw new EvalServiceError("human_confirmed_annotation_exists", "AI review confirmation will not overwrite human-confirmed annotations.", 400, {
            annotation_public_id: existing.annotation_public_id,
            run_item_public_id: item.run_item_public_id
          });
        }

        if (existing.annotation_status === "ai_confirmed") {
          throw new EvalServiceError("conflicting_ai_confirmed_annotation", "Existing AI-confirmed annotation differs from the supplied review file.", 400, {
            annotation_public_id: existing.annotation_public_id,
            run_item_public_id: item.run_item_public_id
          });
        }

        const previousSnapshot = annotationSnapshot(existing);
        const annotation = await tx.evalAnnotation.update({
          where: { id: existing.id },
          data
        });
        await tx.evalAnnotationRevision.create({
          data: {
            revision_public_id: generatePublicId("eval_annotation_revision"),
            annotation_db_id: annotation.id,
            run_item_db_id: item.id,
            amended_by_user_db_id: teacherDbId,
            amendment_source: "ai_review_confirmation",
            amendment_reason: "AI-agent blind review was confirmed as provisional engineering evidence.",
            previous_annotation_snapshot: prismaJson(previousSnapshot),
            new_annotation_snapshot: prismaJson({
              ...annotationSnapshot(annotation),
              ai_review_metadata: {
                reviewer_model: input.reviewerModel,
                review_method: AI_REVIEW_METHOD,
                annotation_file_hash: annotationFileHash,
                reference_file_hash: referenceFileHash,
                source_run_public_id: run.run_public_id,
                import_command_version: AI_REVIEW_CONFIRMATION_COMMAND_VERSION,
                review_target: reviewTarget,
                review_artifact_version: reviewArtifactVersion
              }
            })
          }
        });
        updated += 1;
        auditRecordsCreated += 1;
        continue;
      }

      const annotation = await tx.evalAnnotation.create({
        data: {
          annotation_public_id: generatePublicId("eval_annotation"),
          run_item_db_id: item.id,
          annotated_by_user_db_id: teacherDbId,
          ...data
        }
      });
      await tx.evalAnnotationRevision.create({
        data: {
          revision_public_id: generatePublicId("eval_annotation_revision"),
          annotation_db_id: annotation.id,
          run_item_db_id: item.id,
          amended_by_user_db_id: teacherDbId,
          amendment_source: "ai_review_confirmation",
          amendment_reason: "AI-agent blind review was confirmed as provisional engineering evidence.",
          previous_annotation_snapshot: prismaJson({
            annotation_existed: false,
            source_run_public_id: run.run_public_id
          }),
          new_annotation_snapshot: prismaJson({
            ...annotationSnapshot(annotation),
            ai_review_metadata: {
              reviewer_model: input.reviewerModel,
              review_method: AI_REVIEW_METHOD,
              annotation_file_hash: annotationFileHash,
              reference_file_hash: referenceFileHash,
              source_run_public_id: run.run_public_id,
              import_command_version: AI_REVIEW_CONFIRMATION_COMMAND_VERSION,
              review_target: reviewTarget,
              review_artifact_version: reviewArtifactVersion
            }
          })
        }
      });
      created += 1;
      auditRecordsCreated += 1;
    }
  });

  return {
    run_public_id: run.run_public_id,
    row_count: rows.length,
    ai_pass_count: summary.pass_count,
    ai_fail_count: summary.fail_count,
    ai_critical_failure_count: summary.human_critical_failure_count,
    ai_failed_case_ids: summary.failed_case_ids,
    failed_review_items: failedItems,
    per_agent_pass_rates: summary.per_agent,
    ai_confirmed_created_count: created,
    ai_confirmed_updated_count: updated,
    ai_confirmed_idempotent_count: idempotent,
    audit_record_count: auditRecordsCreated,
    reviewer_model: input.reviewerModel,
    review_method: AI_REVIEW_METHOD,
    reviewed_at: reviewedAt.toISOString(),
    annotation_file_hash: annotationFileHash,
    reference_file_hash: referenceFileHash,
    source_run_public_id: run.run_public_id,
    import_command_version: AI_REVIEW_CONFIRMATION_COMMAND_VERSION,
    imported_as: {
      annotation_source: "ai_agent_review",
      annotation_status: "ai_confirmed",
      review_target: reviewTarget,
      review_artifact_version: reviewArtifactVersion
    },
    human_confirmation_fabricated: false,
    openai_call_made: false,
    operational_records_mutated: false
  };
}

export async function confirmEvalAnnotation(runItemPublicId: string, user: PublicUser) {
  const teacher = await assertTeacherDbUser(user);
  const annotation = await prisma.evalAnnotation.findFirst({
    where: {
      run_item: { run_item_public_id: runItemPublicId },
      annotated_by_user_db_id: teacher.id
    },
    include: {
      run_item: { select: { run_item_public_id: true } },
      annotated_by: { select: { user_id: true, display_name: true } },
      confirmed_by: { select: { user_id: true, display_name: true } }
    }
  });

  if (!annotation) {
    throw new EvalServiceError("annotation_not_found", "No annotation exists for this run item and teacher.", 404);
  }

  if (!validateAnnotationShape(annotation)) {
    throw new EvalServiceError("annotation_invalid", "Annotation must be complete and valid before confirmation.", 400, {
      annotation_public_id: annotation.annotation_public_id
    });
  }

  const updated = await prisma.evalAnnotation.update({
    where: { id: annotation.id },
    data: {
      annotation_status: "confirmed",
      confirmed_by_user_db_id: teacher.id,
      confirmed_at: new Date()
    },
    include: {
      annotated_by: { select: { user_id: true, display_name: true } },
      confirmed_by: { select: { user_id: true, display_name: true } }
    }
  });

  return { annotation: serializeEvalAnnotation(updated) };
}

export async function confirmAllEvalAnnotationsForRun(
  runPublicId: string,
  input: unknown,
  user: PublicUser
) {
  const parsed = confirmAnnotationsSchema.parse(input);
  const teacher = await assertTeacherDbUser(user);
  const run = await prisma.evalRun.findUnique({
    where: { run_public_id: runPublicId },
    include: {
      run_items: {
        include: {
          eval_case: true,
          annotations: {
            where: { annotated_by_user_db_id: teacher.id }
          }
        }
      }
    }
  });

  if (!run) {
    throw new EvalServiceError("run_not_found", "Evaluation run was not found.", 404);
  }

  if (run.run_items.length === 0) {
    throw new EvalServiceError("invalid_run_item_count", "Confirmation requires at least one run item.", 400);
  }

  const annotations = run.run_items.map((item) => item.annotations[0] ?? null);
  const missing = annotations
    .map((annotation, index) => (annotation ? null : run.run_items[index]?.eval_case.case_id))
    .filter((caseId): caseId is string => typeof caseId === "string");

  if (missing.length) {
    throw new EvalServiceError("missing_annotations", "All run items must have annotations before batch confirmation.", 400, {
      missing_case_ids: missing
    });
  }

  const invalid = annotations
    .filter((annotation): annotation is NonNullable<typeof annotation> => annotation !== null)
    .filter((annotation) => !validateAnnotationShape(annotation))
    .map((annotation) => annotation.annotation_public_id);

  if (invalid.length) {
    throw new EvalServiceError("invalid_annotations", "All annotations must be complete and valid before batch confirmation.", 400, {
      invalid_annotation_public_ids: invalid
    });
  }

  const draftIds = annotations
    .filter((annotation): annotation is NonNullable<typeof annotation> => annotation !== null)
    .filter((annotation) => annotation.annotation_status === "draft")
    .map((annotation) => annotation.id);
  const now = new Date();

  if (draftIds.length) {
    await prisma.evalAnnotation.updateMany({
      where: { id: { in: draftIds } },
      data: {
        annotation_status: "confirmed",
        confirmed_by_user_db_id: teacher.id,
        confirmed_at: now
      }
    });
  }

  const confirmedCount = await prisma.evalAnnotation.count({
    where: {
      run_item: { run_db_id: run.id },
      annotated_by_user_db_id: teacher.id,
      annotation_status: "confirmed"
    }
  });

  return {
    run_public_id: run.run_public_id,
    attestation: parsed.attestation,
    confirmed_count: confirmedCount,
    newly_confirmed_count: draftIds.length,
    annotation_source_preserved: true,
    openai_call_made: false,
    operational_records_mutated: false
  };
}

export const annotationAdjudicationInternals = {
  REQUIRED_ATTESTATION,
  parseAnnotationCsv,
  parseJsonl,
  calculateImportSummary
};
