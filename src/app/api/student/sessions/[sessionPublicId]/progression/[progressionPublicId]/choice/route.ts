import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonApiError } from "@/lib/http";
import { ConceptProgressionStudentChoiceSchema } from "@/lib/domain/enums";
import {
  chooseStudentConceptProgression,
  ConceptProgressionServiceError
} from "@/lib/services/concept-progression/progression";
import {
  requireStudent,
  studentAssessmentRouteError
} from "@/lib/services/student-assessment/api";

const choiceSchema = z
  .object({
    choice: ConceptProgressionStudentChoiceSchema,
    client_action_id: z.string().min(1).optional()
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionPublicId: string; progressionPublicId: string }> }
) {
  const auth = await requireStudent();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const body = choiceSchema.parse(await request.json());
    const result = await chooseStudentConceptProgression({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: params.sessionPublicId,
      progression_public_id: params.progressionPublicId,
      data: body
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ConceptProgressionServiceError) {
      return jsonApiError(error.code, error.message, error.status, error.details);
    }

    return studentAssessmentRouteError(error);
  }
}
