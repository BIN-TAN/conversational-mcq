import type { ItemResponse } from "@prisma/client";
import { prisma } from "@/lib/db";
import { TeacherReviewServiceError } from "./errors";
import { asRecord, serializeDate, stripInternalKeys } from "./serializers";

type ItemResponseState =
  | "unanswered"
  | "explicitly_skipped"
  | "answered_correctly"
  | "answered_incorrectly"
  | "response_not_finalized"
  | "answered_not_scored";

function responseState(response?: Pick<
  ItemResponse,
  "item_submitted_at" | "skipped_item" | "correctness"
> | null): ItemResponseState {
  if (!response) {
    return "unanswered";
  }

  if (!response.item_submitted_at) {
    return "response_not_finalized";
  }

  if (response.skipped_item) {
    return "explicitly_skipped";
  }

  if (response.correctness === "correct") {
    return "answered_correctly";
  }

  if (response.correctness === "incorrect") {
    return "answered_incorrectly";
  }

  return "answered_not_scored";
}

function snapshotValue(snapshot: unknown, key: string, fallback: unknown = null) {
  const record = asRecord(snapshot);

  return record[key] ?? fallback;
}

export async function getTeacherReviewItemResponses(sessionPublicId: string) {
  const session = await prisma.assessmentSession.findUnique({
    where: { session_public_id: sessionPublicId },
    select: { id: true, session_public_id: true }
  });

  if (!session) {
    throw new TeacherReviewServiceError(
      "not_found",
      "Assessment session was not found.",
      404,
      { session_public_id: sessionPublicId }
    );
  }

  const conceptUnitSessions = await prisma.conceptUnitSession.findMany({
    where: { assessment_session_db_id: session.id },
    orderBy: [
      {
        concept_unit: {
          order_index: "asc"
        }
      },
      { created_at: "asc" }
    ],
    include: {
      concept_unit: {
        include: {
          items: {
            where: {
              included_in_published_set: true
            },
            orderBy: [{ item_order: "asc" }, { created_at: "asc" }],
            select: {
              id: true,
              item_public_id: true,
              item_order: true,
              item_stem: true,
              options: true,
              correct_option: true,
              version: true,
              status: true
            }
          }
        }
      },
      item_responses: {
        include: {
          item: {
            select: {
              id: true,
              item_public_id: true,
              item_order: true,
              item_stem: true,
              options: true,
              correct_option: true,
              version: true
            }
          }
        }
      }
    }
  });

  return {
    session_public_id: session.session_public_id,
    concept_units: conceptUnitSessions.map((conceptUnitSession) => {
      const responsesByItemDbId = new Map(
        conceptUnitSession.item_responses.map((response) => [response.item_db_id, response])
      );
      const currentItems = conceptUnitSession.concept_unit.items;
      const currentItemIds = new Set(currentItems.map((item) => item.id));
      const responseOnlyItems = conceptUnitSession.item_responses
        .filter((response) => !currentItemIds.has(response.item_db_id))
        .map((response) => response.item);
      const allItems = [...currentItems, ...responseOnlyItems].sort(
        (left, right) => left.item_order - right.item_order
      );

      return {
        concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id,
        title: conceptUnitSession.concept_unit.title,
        order_index: conceptUnitSession.concept_unit.order_index,
        item_responses: allItems.map((item) => {
          const response = responsesByItemDbId.get(item.id) ?? null;

          return {
            item_public_id: item.item_public_id,
            item_order: item.item_order,
            response_state: responseState(response),
            item_stem_snapshot: response
              ? snapshotValue(response.item_snapshot, "item_stem", item.item_stem)
              : item.item_stem,
            options_snapshot: response
              ? stripInternalKeys(snapshotValue(response.item_snapshot, "options", item.options))
              : stripInternalKeys(item.options),
            selected_option: response?.selected_option ?? null,
            correct_option_snapshot: response?.correct_option_snapshot ?? item.correct_option,
            correctness: response?.correctness ?? "unanswered",
            reasoning_text: response?.reasoning_text ?? null,
            confidence_rating: response?.confidence_rating ?? null,
            skipped_item: response?.skipped_item ?? false,
            skipped_reasoning: response?.skipped_reasoning ?? false,
            skipped_confidence: response?.skipped_confidence ?? false,
            revision_count: response?.revision_count ?? 0,
            missing_evidence_repair_offered:
              response?.missing_evidence_repair_offered ?? false,
            item_response_time_ms: response?.item_response_time_ms ?? null,
            item_started_at: serializeDate(response?.item_started_at),
            item_submitted_at: serializeDate(response?.item_submitted_at),
            item_version_snapshot: response?.item_version_snapshot ?? null,
            administered_snapshot: response ? stripInternalKeys(response.item_snapshot) : null,
            current_content_version: item.version
          };
        })
      };
    })
  };
}
