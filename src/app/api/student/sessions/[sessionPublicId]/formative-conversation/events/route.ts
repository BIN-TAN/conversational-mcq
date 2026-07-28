import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireStudent,
  studentAssessmentRouteError
} from "@/lib/services/student-assessment/api";
import {
  getStudentFormativeConversationProjection,
  recordFormativeConversationLifecycleEvent
} from "@/lib/services/student-assessment/formative-conversation";

const eventSchema = z
  .object({
    conversation_public_id: z.string().min(1),
    client_event_id: z.string().min(1),
    event_type: z.enum([
      "page_visible",
      "page_hidden",
      "left",
      "reentered",
      "refreshed",
      "disconnected",
      "reconnected"
    ]),
    occurred_at: z.string().datetime(),
    observed_interval_duration_ms: z.number().int().nonnegative().nullable(),
    client_instance_id: z.string().min(1).max(200).nullable()
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionPublicId: string }> }
) {
  const auth = await requireStudent();
  if (!auth.ok) {
    return auth.response;
  }
  try {
    const { sessionPublicId } = await context.params;
    const body = eventSchema.parse(await request.json());
    const owned = await getStudentFormativeConversationProjection({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: sessionPublicId
    });
    if (!owned || owned.conversation_public_id !== body.conversation_public_id) {
      throw new Error("formative_conversation_not_found");
    }
    await recordFormativeConversationLifecycleEvent({
      conversation_public_id: body.conversation_public_id,
      client_event_id: body.client_event_id,
      event_type: body.event_type,
      event_source: "frontend",
      observed_interval_duration_ms: body.observed_interval_duration_ms,
      client_instance_id: body.client_instance_id,
      occurred_at: new Date(body.occurred_at)
    });
    return NextResponse.json({ recorded: true });
  } catch (error) {
    return studentAssessmentRouteError(error);
  }
}
