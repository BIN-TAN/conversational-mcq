import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ContentServiceError } from "./errors";
import { MAX_ITEM_BATCH_DELETION, type ItemDeletionPreview, type ItemDeletionResult } from "./item-deletion-contract";

const selectionSchema = z.object({
  item_public_ids: z.array(z.string().trim().min(1).max(200)).min(1).max(MAX_ITEM_BATCH_DELETION)
    .refine((ids) => new Set(ids).size === ids.length, "Select each item only once.")
}).strict();
const deletionSchema = selectionSchema.extend({
  selection_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  delete_confirmation: z.string()
}).strict();
type Scope = { teacher_user_db_id: string; assessment_public_id: string; data: unknown };

async function inspectSelection(tx: Prisma.TransactionClient, input: Scope, ids: string[], lock: boolean) {
  const teacher = await tx.user.findFirst({
    where: { id: input.teacher_user_db_id, role: "teacher_researcher", account_status: "active" },
    select: { id: true }
  });
  if (!teacher) throw new ContentServiceError("forbidden", "A teacher account is required.", 403);

  // Lock the parent before checking sessions/status. Session inserts and publication
  // cannot race the confirmation; selected item locks also protect evidence FKs.
  if (lock) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM assessments
      WHERE assessment_public_id = ${input.assessment_public_id}
      AND created_by_user_db_id = ${teacher.id}::uuid FOR UPDATE`);
  }
  const assessment = await tx.assessment.findFirst({
    where: { assessment_public_id: input.assessment_public_id, created_by_user_db_id: teacher.id },
    include: { _count: { select: { assessment_sessions: true } } }
  });
  if (!assessment) throw new ContentServiceError("not_found", "Mini test was not found.", 404);
  if (assessment._count.assessment_sessions > 0) {
    throw new ContentServiceError("content_locked_after_student_session",
      "Student attempts already exist. Create a corrected version to change its items.", 409);
  }
  if (assessment.status === "archived") {
    throw new ContentServiceError("assessment_archived", "Restore this mini test and return it to draft before deleting items.", 409);
  }
  if (assessment.status !== "draft") {
    throw new ContentServiceError("published_content_must_return_to_draft_before_editing",
      "Return this unused mini test to draft before deleting items.", 409);
  }
  if (lock) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM concept_units
      WHERE assessment_db_id = ${assessment.id}::uuid ORDER BY id FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT i.id FROM items i JOIN concept_units c ON c.id = i.concept_unit_db_id
      WHERE c.assessment_db_id = ${assessment.id}::uuid ORDER BY i.id FOR UPDATE OF i`);
    await tx.$queryRaw(Prisma.sql`SELECT m.id FROM item_media_assets m JOIN items i ON i.id = m.item_db_id
      JOIN concept_units c ON c.id = i.concept_unit_db_id
      WHERE c.assessment_db_id = ${assessment.id}::uuid ORDER BY m.id FOR UPDATE OF m`);
  }
  const items = await tx.item.findMany({
    where: { concept_unit: { assessment_db_id: assessment.id } },
    orderBy: [{ concept_unit: { order_index: "asc" } }, { item_order: "asc" }, { id: "asc" }],
    include: {
      concept_unit: { select: { status: true, updated_at: true } },
      media_assets: { orderBy: { id: "asc" } },
      _count: { select: { item_responses: true, conversation_turns: true, process_events: true } }
    }
  });
  const selected = items.filter((item) => ids.includes(item.item_public_id));
  if (selected.length !== ids.length) {
    throw new ContentServiceError("not_found", "One or more selected items are no longer in this mini test. Refresh the item list.", 404);
  }
  if (selected.some((item) => item._count.item_responses + item._count.conversation_turns + item._count.process_events > 0)) {
    throw new ContentServiceError("content_locked_after_student_session", "Selected items have student evidence and cannot be deleted.", 409);
  }
  if (selected.some((item) => item.concept_unit.status !== "draft")) {
    throw new ContentServiceError("published_content_must_return_to_draft_before_editing",
      "Return the selected items' topic to draft before deleting items.", 409);
  }
  const remaining = items.filter((item) => !ids.includes(item.item_public_id));
  const fingerprint = createHash("sha256").update(JSON.stringify({
    teacher: teacher.id, assessment, items, selected: [...ids].sort()
  })).digest("hex");
  const preview: ItemDeletionPreview = {
    assessment_public_id: assessment.assessment_public_id,
    items: selected.map(({ item_public_id, item_order, item_stem }) => ({ item_public_id, item_order, item_stem })),
    selection_fingerprint: fingerprint,
    required_delete_confirmation: `DELETE ${selected.length} ${selected.length === 1 ? "ITEM" : "ITEMS"}`,
    remaining_item_count: remaining.length,
    remaining_included_item_count: remaining.filter((item) => item.status !== "archived" && item.included_in_published_set).length
  };
  return { assessment, selected, preview };
}

export async function previewItemDeletion(input: Scope): Promise<ItemDeletionPreview> {
  const parsed = selectionSchema.parse(input.data);
  return prisma.$transaction(async (tx) => (await inspectSelection(tx, input, parsed.item_public_ids, false)).preview,
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function deleteSelectedItems(input: Scope): Promise<ItemDeletionResult> {
  const parsed = deletionSchema.parse(input.data);
  try {
    return await prisma.$transaction(async (tx) => {
      const { assessment, selected, preview } = await inspectSelection(tx, input, parsed.item_public_ids, true);
      if (parsed.selection_fingerprint !== preview.selection_fingerprint) {
        throw new ContentServiceError("conflict", "The mini test changed. Refresh and preview the deletion again.", 409);
      }
      if (parsed.delete_confirmation !== preview.required_delete_confirmation) {
        throw new ContentServiceError("validation_failed", "Enter the exact deletion confirmation shown in the preview.", 400);
      }
      await tx.item.deleteMany({ where: { id: { in: selected.map((item) => item.id) } } });
      await tx.conceptUnit.updateMany({
        where: { id: { in: [...new Set(selected.map((item) => item.concept_unit_db_id))] } },
        data: { latest_item_verification_run_db_id: null, version: { increment: 1 } }
      });
      await tx.assessment.update({ where: { id: assessment.id }, data: { updated_at: new Date() } });
      const operationId = `item_batch_deletion_${randomUUID()}`;
      const deletedIds = selected.map((item) => item.item_public_id);
      // Retain original import batches and verification runs as authoring provenance.
      // The deletion audit stores identifiers/counts, never item content or keys.
      await tx.assessmentLifecycleOperation.create({ data: {
        operation_public_id: operationId,
        command_type: "teacher_delete_unused_items",
        actor_type: "teacher_researcher",
        target_assessment_public_id: assessment.assessment_public_id,
        mutation_committed: true,
        http_status: 200,
        safe_response_code: "unused_items_deleted",
        response_payload: {
          teacher_user_db_id: input.teacher_user_db_id,
          deleted_item_public_ids: deletedIds,
          deleted_item_count: selected.length,
          deleted_media_metadata_count: selected.reduce((count, item) => count + item.media_assets.length, 0),
          selection_fingerprint: preview.selection_fingerprint
        },
        completed_at: new Date()
      } });
      return { deleted_item_public_ids: deletedIds, deletion_operation_public_id: operationId };
    }, { maxWait: 10_000, timeout: 30_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2003", "P2034"].includes(error.code)) {
      throw new ContentServiceError("conflict", "The mini test changed or now has student evidence. Refresh before trying again.", 409);
    }
    throw error;
  }
}
