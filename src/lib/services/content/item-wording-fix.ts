import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { toPrismaJson } from "@/lib/services/json";
import { ContentServiceError } from "./errors";
import { serializeAssessmentContentState } from "./governance";
import { planItemWordingFix, type ItemWordingFixField } from "./item-wording-fix-plan";
import { itemSerializerInclude, serializeItem } from "./serializers";

/**
 * Saves a wording fix (item-wording-fix-plan.ts) for an item whose mini test students have
 * started. The item keeps its public ID and version; the fix is recorded in
 * item_wording_corrections (prisma/migrations/20261028120000_item_wording_corrections).
 * The table is read and written with SQL, like item_review_decisions, so this module does not
 * depend on a regenerated Prisma client.
 */

export type ItemWordingCorrectionSummary = {
  correction_public_id: string;
  reason: string;
  changed_fields: ItemWordingFixField[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  item_version: number;
  responses_before: number;
  sessions_before: number;
  corrected_at: string;
  corrected_by: string | null;
};

type CorrectionRow = {
  correction_public_id: string;
  reason: string;
  changed_fields: string[];
  before_content: unknown;
  after_content: unknown;
  item_version: number;
  responses_before: number;
  sessions_before: number;
  corrected_at: Date;
  corrected_by: string | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function correctionPublicId() {
  return `iwc_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_${randomBytes(5).toString("base64url").toLowerCase()}`;
}

async function ownedItem(teacherUserDbId: string, itemPublicId: string) {
  const item = await prisma.item.findFirst({
    where: {
      item_public_id: itemPublicId,
      concept_unit: { assessment: { created_by_user_db_id: teacherUserDbId } }
    },
    select: {
      id: true,
      item_public_id: true,
      status: true,
      concept_unit: {
        select: {
          assessment: {
            select: {
              id: true,
              assessment_public_id: true,
              status: true,
              _count: { select: { assessment_sessions: true } }
            }
          }
        }
      }
    }
  });
  if (!item) throw new ContentServiceError("not_found", "Item was not found.", 404);
  return item;
}

export async function listItemWordingCorrections(input: {
  teacher_user_db_id: string;
  item_public_id: string;
}): Promise<ItemWordingCorrectionSummary[]> {
  const item = await ownedItem(input.teacher_user_db_id, input.item_public_id);
  const rows = await prisma.$queryRaw<CorrectionRow[]>`
    SELECT c.correction_public_id, c.reason, c.changed_fields, c.before_content, c.after_content,
      c.item_version, c.responses_before, c.sessions_before, c.corrected_at, u.user_id AS corrected_by
    FROM item_wording_corrections c
    LEFT JOIN users u ON u.id = c.corrected_by_user_db_id
    WHERE c.item_db_id = ${item.id}::uuid
    ORDER BY c.corrected_at DESC, c.correction_public_id DESC`;
  return rows.map((row) => ({
    correction_public_id: row.correction_public_id,
    reason: row.reason,
    changed_fields: row.changed_fields as ItemWordingFixField[],
    before: record(row.before_content),
    after: record(row.after_content),
    item_version: Number(row.item_version),
    responses_before: Number(row.responses_before),
    sessions_before: Number(row.sessions_before),
    corrected_at: new Date(row.corrected_at).toISOString(),
    corrected_by: row.corrected_by
  }));
}

export async function correctItemWording(input: {
  teacher_user_db_id: string;
  item_public_id: string;
  data: unknown;
}) {
  const owned = await ownedItem(input.teacher_user_db_id, input.item_public_id);
  const assessment = owned.concept_unit.assessment;
  if (owned.status === "archived" || assessment.status === "archived") {
    throw new ContentServiceError(
      "wording_fix_not_available",
      "Archived items and mini tests are kept as they are and cannot be changed.",
      409,
      { item_public_id: owned.item_public_id }
    );
  }
  if (!serializeAssessmentContentState(assessment).is_content_locked) {
    throw new ContentServiceError(
      "wording_fix_not_available",
      "No student has started this mini test yet, so you can edit the item normally. Return the mini test to draft if it is published.",
      409,
      { item_public_id: owned.item_public_id }
    );
  }

  const correctionId = correctionPublicId();
  const result = await prisma.$transaction(async (tx) => {
    // Lock the item so two fixes saved at the same moment are recorded one after the other.
    await tx.$queryRaw`SELECT id FROM items WHERE id = ${owned.id}::uuid FOR UPDATE`;
    const item = await tx.item.findUniqueOrThrow({ where: { id: owned.id } });
    const plan = planItemWordingFix(item, input.data);
    const [responsesBefore, sessionsBefore] = await Promise.all([
      tx.itemResponse.count({ where: { item_db_id: item.id } }),
      tx.assessmentSession.count({ where: { assessment_db_id: assessment.id } })
    ]);
    // The version stays the same on purpose: dashboards and exports group answers by item and
    // version, and a wording fix must not split one item's data in two.
    await tx.item.update({
      where: { id: item.id },
      data: {
        item_stem: plan.next.item_stem,
        options: toPrismaJson(plan.next.options) ?? [],
        distractor_rationales: toPrismaJson(plan.next.distractor_rationales),
        expected_reasoning_patterns: toPrismaJson(plan.next.expected_reasoning_patterns),
        administration_rules: toPrismaJson(plan.next.administration_rules)
      }
    });
    await tx.$executeRaw`
      INSERT INTO item_wording_corrections (id, correction_public_id, item_db_id, corrected_by_user_db_id, reason,
        changed_fields, before_content, after_content, item_version, responses_before, sessions_before, corrected_at)
      VALUES (${randomUUID()}::uuid, ${correctionId}, ${item.id}::uuid, ${input.teacher_user_db_id}::uuid, ${plan.reason},
        ${plan.changed_fields}::text[], ${JSON.stringify(plan.before)}::jsonb, ${JSON.stringify(plan.after)}::jsonb,
        ${item.version}, ${responsesBefore}, ${sessionsBefore}, NOW())`;
    const saved = await tx.item.findUniqueOrThrow({ where: { id: item.id }, include: itemSerializerInclude });
    return { saved, plan, responsesBefore };
  });

  return {
    item: serializeItem(result.saved),
    correction: {
      correction_public_id: correctionId,
      changed_fields: result.plan.changed_fields,
      responses_before: result.responsesBefore
    },
    wording_corrections: await listItemWordingCorrections(input)
  };
}
