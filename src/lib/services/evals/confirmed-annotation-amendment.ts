import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import { EvalServiceError } from "./errors";
import { evaluationCriticalFailureFlags } from "./types";

export const CONFIRMED_ANNOTATION_AMENDMENT_NOTE =
  "The selected formative value may be pedagogically defensible because the profile indicates overconfidence. The failure is that mapping_followed=true is inconsistent with the default mapping, while mapping_deviation_reason is blank.";

export const CONFIRMED_ANNOTATION_AMENDMENT_REASON =
  "Unblinded engineering adjudication determined that the selected formative value was pedagogically defensible. The confirmed failure remains, but the critical-failure classification was too strong.";

type AnnotationForSnapshot = {
  annotation_public_id: string;
  annotated_by_user_db_id: string;
  confirmed_by_user_db_id: string | null;
  blind_review: boolean;
  annotation_source: string;
  annotation_status: string;
  overall_rating: number | null;
  pass_fail: string | null;
  rubric_scores: unknown;
  safety_flags: unknown;
  notes: string | null;
  confirmed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function prismaJson(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

function flagsFrom(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function blankish(value: unknown) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function annotationSnapshot(annotation: AnnotationForSnapshot) {
  return {
    annotation_public_id: annotation.annotation_public_id,
    annotated_by_user_db_id: annotation.annotated_by_user_db_id,
    confirmed_by_user_db_id: annotation.confirmed_by_user_db_id,
    blind_review: annotation.blind_review,
    annotation_source: annotation.annotation_source,
    annotation_status: annotation.annotation_status,
    overall_rating: annotation.overall_rating,
    pass_fail: annotation.pass_fail,
    rubric_scores: annotation.rubric_scores,
    safety_flags: flagsFrom(annotation.safety_flags),
    notes: annotation.notes,
    confirmed_at: annotation.confirmed_at?.toISOString() ?? null,
    created_at: annotation.created_at.toISOString(),
    updated_at: annotation.updated_at.toISOString()
  };
}

function assertExpectedAnnotationState(input: {
  annotation: AnnotationForSnapshot;
  removeCriticalFlag: string;
  allowAlreadyAmended: boolean;
}) {
  const flags = flagsFrom(input.annotation.safety_flags);

  if (input.annotation.pass_fail !== "fail") {
    throw new EvalServiceError("unexpected_pass_fail", "Target annotation pass/fail did not match expected Fail.", 400, {
      annotation_public_id: input.annotation.annotation_public_id,
      pass_fail: input.annotation.pass_fail
    });
  }

  if (input.annotation.overall_rating !== 1) {
    throw new EvalServiceError("unexpected_overall_rating", "Target annotation overall rating did not match expected 1.", 400, {
      annotation_public_id: input.annotation.annotation_public_id,
      overall_rating: input.annotation.overall_rating
    });
  }

  if (input.annotation.annotation_status !== "confirmed") {
    throw new EvalServiceError("unexpected_annotation_status", "Target annotation was not confirmed.", 400, {
      annotation_public_id: input.annotation.annotation_public_id,
      annotation_status: input.annotation.annotation_status
    });
  }

  if (flags.includes(input.removeCriticalFlag)) {
    return "needs_amendment" as const;
  }

  if (input.allowAlreadyAmended && input.annotation.notes === CONFIRMED_ANNOTATION_AMENDMENT_NOTE) {
    return "already_amended" as const;
  }

  throw new EvalServiceError("missing_target_critical_flag", "Target annotation did not contain the requested human critical flag.", 400, {
    annotation_public_id: input.annotation.annotation_public_id,
    remove_critical_flag: input.removeCriticalFlag,
    current_safety_flags: flags
  });
}

export async function amendConfirmedEvalAnnotations(input: {
  runPublicId: string;
  caseId: string;
  removeCriticalFlag: string;
  confirmResearcherInstruction: boolean;
  requestedByUserDbId?: string;
}) {
  if (!input.confirmResearcherInstruction) {
    throw new EvalServiceError(
      "researcher_instruction_confirmation_required",
      "Confirmed annotation amendment requires --confirm-researcher-instruction.",
      400
    );
  }

  if (!evaluationCriticalFailureFlags.includes(input.removeCriticalFlag as (typeof evaluationCriticalFailureFlags)[number])) {
    throw new EvalServiceError("invalid_critical_flag", "Requested critical failure flag is not approved.", 400, {
      remove_critical_flag: input.removeCriticalFlag
    });
  }

  return prisma.$transaction(async (tx) => {
    const run = await tx.evalRun.findUnique({
      where: { run_public_id: input.runPublicId },
      include: {
        created_by: { select: { id: true, role: true, user_id: true } },
        run_items: {
          include: {
            eval_case: true,
            annotations: true
          },
          orderBy: [{ run_order: "asc" }]
        }
      }
    });

    if (!run) {
      throw new EvalServiceError("run_not_found", "Evaluation run was not found.", 404);
    }

    if (run.planned_run_item_count !== 100 || run.run_items.length !== 100) {
      throw new EvalServiceError("unexpected_run_item_count", "Target run did not have exactly 100 run items.", 400, {
        planned_run_item_count: run.planned_run_item_count,
        run_item_count: run.run_items.length
      });
    }

    const confirmed = run.run_items.flatMap((item) =>
      item.annotations
        .filter((annotation) => annotation.annotation_status === "confirmed")
        .map((annotation) => ({ item, annotation }))
    );

    if (confirmed.length !== 100) {
      throw new EvalServiceError("unexpected_confirmed_annotation_count", "Target run did not have exactly 100 confirmed annotations.", 400, {
        confirmed_annotation_count: confirmed.length
      });
    }

    const targets = confirmed.filter(
      ({ item }) =>
        item.eval_case.case_id === input.caseId &&
        (item.repetition_index === 1 || item.repetition_index === 2)
    );

    if (targets.length !== 2) {
      throw new EvalServiceError("unexpected_target_match_count", "Confirmed annotation amendment requires exactly two target repetitions.", 400, {
        case_id: input.caseId,
        target_match_count: targets.length
      });
    }

    const amendedByUserDbId = input.requestedByUserDbId ?? run.created_by_user_db_id;
    const amendedBy = await tx.user.findUnique({
      where: { id: amendedByUserDbId },
      select: { id: true, role: true, user_id: true }
    });

    if (!amendedBy || amendedBy.role !== "teacher_researcher") {
      throw new EvalServiceError("forbidden", "Confirmed annotation amendment requires a teacher_researcher.", 403);
    }

    const amended: Array<{
      run_item_public_id: string;
      annotation_public_id: string;
      repetition_index: number;
      previous_safety_flags: string[];
      new_safety_flags: string[];
      revision_public_id: string;
    }> = [];
    const alreadyAmended: Array<{
      run_item_public_id: string;
      annotation_public_id: string;
      repetition_index: number;
      current_safety_flags: string[];
    }> = [];

    for (const { item, annotation } of targets) {
      const output = asRecord(item.parsed_output);

      if (output.formative_value !== "confidence_calibration") {
        throw new EvalServiceError("unexpected_formative_value", "Target model output formative_value did not match expected confidence_calibration.", 400, {
          run_item_public_id: item.run_item_public_id,
          formative_value: output.formative_value
        });
      }

      if (output.mapping_followed !== true) {
        throw new EvalServiceError("unexpected_mapping_followed", "Target model output mapping_followed did not match expected true.", 400, {
          run_item_public_id: item.run_item_public_id,
          mapping_followed: output.mapping_followed
        });
      }

      if (!blankish(output.mapping_deviation_reason)) {
        throw new EvalServiceError("unexpected_mapping_deviation_reason", "Target model output mapping_deviation_reason was not blank.", 400, {
          run_item_public_id: item.run_item_public_id
        });
      }

      const state = assertExpectedAnnotationState({
        annotation,
        removeCriticalFlag: input.removeCriticalFlag,
        allowAlreadyAmended: true
      });
      const previousFlags = flagsFrom(annotation.safety_flags);

      if (state === "already_amended") {
        alreadyAmended.push({
          run_item_public_id: item.run_item_public_id,
          annotation_public_id: annotation.annotation_public_id,
          repetition_index: item.repetition_index,
          current_safety_flags: previousFlags
        });
        continue;
      }

      const nextFlags = previousFlags.filter((flag) => flag !== input.removeCriticalFlag);
      const previousSnapshot = annotationSnapshot(annotation);
      const newSnapshot = {
        ...previousSnapshot,
        safety_flags: nextFlags,
        notes: CONFIRMED_ANNOTATION_AMENDMENT_NOTE
      };
      const revisionPublicId = generatePublicId("eval_annotation_revision");

      await tx.evalAnnotation.update({
        where: { id: annotation.id },
        data: {
          safety_flags: prismaJson(nextFlags),
          notes: CONFIRMED_ANNOTATION_AMENDMENT_NOTE
        }
      });

      await tx.evalAnnotationRevision.create({
        data: {
          revision_public_id: revisionPublicId,
          annotation_db_id: annotation.id,
          run_item_db_id: item.id,
          amended_by_user_db_id: amendedBy.id,
          amendment_source: "researcher_instruction",
          amendment_reason: CONFIRMED_ANNOTATION_AMENDMENT_REASON,
          previous_annotation_snapshot: prismaJson(previousSnapshot),
          new_annotation_snapshot: prismaJson(newSnapshot)
        }
      });

      amended.push({
        run_item_public_id: item.run_item_public_id,
        annotation_public_id: annotation.annotation_public_id,
        repetition_index: item.repetition_index,
        previous_safety_flags: previousFlags,
        new_safety_flags: nextFlags,
        revision_public_id: revisionPublicId
      });
    }

    return {
      run_public_id: run.run_public_id,
      case_id: input.caseId,
      remove_critical_flag: input.removeCriticalFlag,
      target_match_count: targets.length,
      amended_count: amended.length,
      already_amended_count: alreadyAmended.length,
      amended,
      already_amended: alreadyAmended,
      notes: CONFIRMED_ANNOTATION_AMENDMENT_NOTE,
      pass_fail_preserved: true,
      overall_rating_preserved: true,
      rubric_scores_preserved: true,
      annotation_source_preserved: true,
      confirmation_provenance_preserved: true,
      automated_findings_preserved: true,
      openai_call_made: false,
      operational_records_mutated: false
    };
  });
}
