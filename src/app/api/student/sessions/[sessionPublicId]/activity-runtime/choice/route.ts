import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonApiError } from "@/lib/http";
import { requireStudent, studentAssessmentRouteError } from "@/lib/services/student-assessment/api";
import { recordStudentActivityRuntimeChoice } from "@/lib/services/student-assessment/activity-runtime-ui";
import { StudentAssessmentServiceError } from "@/lib/services/student-assessment/errors";

const choiceSchema = z.object({
  activity_attempt_public_id: z.string().min(1).nullable().optional(),
  choice_state: z.enum([
    "choose_another_activity",
    "skip_activity_to_transfer",
    "skip_activity_to_next_concept",
    "finish_assessment",
    "return_to_summary",
    "move_on"
  ]),
  selected_alternative_activity_family: z.enum([
    "basic_concept_grounding",
    "distractor_contrast",
    "reasoning_chain_repair",
    "independent_reconstruction",
    "confidence_evidence_audit",
    "transfer_and_distractor_generation"
  ]).nullable().optional(),
  client_action_id: z.string().min(1).optional()
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionPublicId: string }> }
) {
  const auth = await requireStudent();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const body = choiceSchema.parse(await request.json());
    const clientActionId = body.client_action_id;

    if (!clientActionId) {
      return jsonApiError("validation_failed", "client_action_id is required.", 400);
    }

    const activityRuntime = await recordStudentActivityRuntimeChoice({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: params.sessionPublicId,
      activity_attempt_public_id: body.activity_attempt_public_id ?? null,
      choice_state: body.choice_state,
      selected_alternative_activity_family: body.selected_alternative_activity_family ?? null,
      client_action_id: clientActionId
    });

    return NextResponse.json({ activity_runtime: activityRuntime });
  } catch (error) {
    if (error instanceof StudentAssessmentServiceError) {
      return jsonApiError(error.code, error.message, error.status, error.details);
    }

    return studentAssessmentRouteError(error);
  }
}
