import { z } from "zod";
import { prisma } from "../db";
import { ActorTypeSchema, AssessmentPhaseSchema } from "../domain/enums";
import { toPrismaJson } from "./json";

const logConversationTurnSchema = z.object({
  assessment_session_db_id: z.string().uuid(),
  concept_unit_session_db_id: z.string().uuid().optional(),
  item_db_id: z.string().uuid().optional(),
  followup_round_db_id: z.string().uuid().optional(),
  phase: AssessmentPhaseSchema,
  actor_type: ActorTypeSchema,
  agent_name: z.string().min(1).optional(),
  message_text: z.string().optional(),
  structured_payload: z.unknown().optional(),
  created_at: z.coerce.date().optional()
});

export type LogConversationTurnInput = z.input<typeof logConversationTurnSchema>;

export async function logConversationTurn(input: LogConversationTurnInput) {
  const parsed = logConversationTurnSchema.parse(input);

  return prisma.conversationTurn.create({
    data: {
      assessment_session_db_id: parsed.assessment_session_db_id,
      concept_unit_session_db_id: parsed.concept_unit_session_db_id,
      item_db_id: parsed.item_db_id,
      followup_round_db_id: parsed.followup_round_db_id,
      phase: parsed.phase,
      actor_type: parsed.actor_type,
      agent_name: parsed.agent_name,
      message_text: parsed.message_text,
      structured_payload: toPrismaJson(parsed.structured_payload),
      created_at: parsed.created_at ?? new Date()
    }
  });
}
