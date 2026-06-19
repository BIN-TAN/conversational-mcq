import { prisma } from "@/lib/db";
import { TeacherReviewServiceError } from "./errors";
import { serializeDate, stripInternalKeys } from "./serializers";

export async function getTeacherReviewTranscript(sessionPublicId: string) {
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

  const turns = await prisma.conversationTurn.findMany({
    where: { assessment_session_db_id: session.id },
    orderBy: [{ created_at: "asc" }],
    select: {
      phase: true,
      actor_type: true,
      agent_name: true,
      message_text: true,
      structured_payload: true,
      created_at: true,
      concept_unit_session: {
        select: {
          concept_unit: {
            select: {
              concept_unit_public_id: true,
              title: true
            }
          }
        }
      },
      item: {
        select: {
          item_public_id: true,
          item_order: true,
          concept_unit: {
            select: {
              concept_unit_public_id: true
            }
          }
        }
      },
      followup_round: {
        select: {
          round_index: true
        }
      }
    }
  });

  return {
    session_public_id: session.session_public_id,
    turns: turns.map((turn) => ({
      actor_type: turn.actor_type,
      agent_name: turn.agent_name,
      phase: turn.phase,
      message_text: turn.message_text,
      created_at: serializeDate(turn.created_at),
      concept_unit_public_id:
        turn.concept_unit_session?.concept_unit.concept_unit_public_id ??
        turn.item?.concept_unit.concept_unit_public_id ??
        null,
      concept_unit_title: turn.concept_unit_session?.concept_unit.title ?? null,
      item_public_id: turn.item?.item_public_id ?? null,
      item_order: turn.item?.item_order ?? null,
      followup_round_index: turn.followup_round?.round_index ?? null,
      structured_payload: stripInternalKeys(turn.structured_payload)
    }))
  };
}
