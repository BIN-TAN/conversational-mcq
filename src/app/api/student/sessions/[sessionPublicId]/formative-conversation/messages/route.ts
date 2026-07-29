import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireStudent,
  studentAssessmentRouteError
} from "@/lib/services/student-assessment/api";
import {
  buildFormativeConversationRuntimeContextSeed,
  createLiveFormativeConversationAgentRunner,
  FormativeConversationResponseGenerationError,
  getStudentFormativeConversationProjection,
  processFormativeConversationStudentMessage
} from "@/lib/services/student-assessment/formative-conversation";
import {
  FORMATIVE_CONVERSATION_UNAVAILABLE_MESSAGE
} from "@/lib/services/student-assessment/formative-conversation/availability";
import { StudentAssessmentServiceError } from "@/lib/services/student-assessment/errors";

const messageSchema = z
  .object({
    conversation_public_id: z.string().min(1),
    client_message_id: z.string().min(1),
    message_text: z.string().trim().min(1).max(5_000),
    observable_input_telemetry: z
      .object({
        turn_started_at: z.string().datetime().nullable().optional(),
        submitted_at: z.string().datetime(),
        response_time_ms: z.number().int().nonnegative().nullable().optional(),
        typing_started_at: z.string().datetime().nullable().optional(),
        typing_ended_at: z.string().datetime().nullable().optional(),
        typing_duration_ms: z.number().int().nonnegative().nullable().optional(),
        typing_duration_method: z
          .enum(["active_intervals", "elapsed_first_input_to_submit"])
          .nullable()
          .optional(),
        edit_count: z.number().int().nonnegative(),
        backspace_count: z.number().int().nonnegative(),
        paste_event_count: z.number().int().nonnegative(),
        paste_character_count: z.number().int().nonnegative().default(0)
      })
      .strict()
      .optional()
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
    const body = messageSchema.parse(await request.json());
    const owned = await getStudentFormativeConversationProjection({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: sessionPublicId
    });
    if (
      !owned ||
      owned.conversation_public_id !== body.conversation_public_id
    ) {
      throw new StudentAssessmentServiceError(
        "not_found",
        "The learning conversation was not found.",
        404
      );
    }
    if (owned.opening_status !== "ready") {
      throw new StudentAssessmentServiceError(
        "formative_conversation_unavailable",
        FORMATIVE_CONVERSATION_UNAVAILABLE_MESSAGE,
        503,
        {
          retryable: owned.can_retry_opening
        }
      );
    }
    if (!owned.can_send) {
      throw new StudentAssessmentServiceError(
        "invalid_phase_for_action",
        "The learning conversation is not accepting messages.",
        409
      );
    }
    const seed = await buildFormativeConversationRuntimeContextSeed({
      conversation_public_id: body.conversation_public_id,
      student_user_db_id: auth.user.user_db_id
    });
    try {
      await processFormativeConversationStudentMessage(
        {
          conversation_public_id: body.conversation_public_id,
          client_message_id: body.client_message_id,
          message_text: body.message_text,
          context: seed,
          observable_input_telemetry: body.observable_input_telemetry
            ? {
                turn_started_at: body.observable_input_telemetry.turn_started_at
                  ? new Date(body.observable_input_telemetry.turn_started_at)
                  : null,
                submitted_at: new Date(
                  body.observable_input_telemetry.submitted_at
                ),
                response_time_ms:
                  body.observable_input_telemetry.response_time_ms ?? null,
                typing_started_at: body.observable_input_telemetry.typing_started_at
                  ? new Date(body.observable_input_telemetry.typing_started_at)
                  : null,
                typing_ended_at: body.observable_input_telemetry.typing_ended_at
                  ? new Date(body.observable_input_telemetry.typing_ended_at)
                  : null,
                typing_duration_ms:
                  body.observable_input_telemetry.typing_duration_ms ?? null,
                typing_duration_method:
                  body.observable_input_telemetry.typing_duration_method ?? null,
                edit_count: body.observable_input_telemetry.edit_count,
                backspace_count: body.observable_input_telemetry.backspace_count,
                paste_event_count:
                  body.observable_input_telemetry.paste_event_count,
                paste_character_count:
                  body.observable_input_telemetry.paste_character_count
              }
            : undefined
        },
        { runner_factory: createLiveFormativeConversationAgentRunner }
      );
    } catch (error) {
      if (!(error instanceof FormativeConversationResponseGenerationError)) {
        throw error;
      }
    }
    const conversation = await getStudentFormativeConversationProjection({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: sessionPublicId
    });
    return NextResponse.json({ formative_conversation: conversation });
  } catch (error) {
    return studentAssessmentRouteError(error);
  }
}
