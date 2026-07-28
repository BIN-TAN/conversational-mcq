import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonApiError, requireRoleApi } from "@/lib/http";
import { logProductionError } from "@/lib/observability/production-safe-logger";
import {
  FORMATIVE_CONVERSATION_UNAVAILABLE_CODE,
  FORMATIVE_CONVERSATION_UNAVAILABLE_MESSAGE,
  FormativeConversationUnavailableError
} from "./formative-conversation/availability";
import { StudentAssessmentServiceError } from "./errors";

export async function requireStudent() {
  const auth = await requireRoleApi("student");

  if (!auth.ok) {
    return auth;
  }

  if (auth.user.must_change_password) {
    return {
      ok: false as const,
      response: jsonApiError(
        "password_change_required",
        "Choose a new password before continuing.",
        403
      )
    };
  }

  return auth;
}

export function studentAssessmentRouteError(error: unknown): NextResponse {
  if (error instanceof FormativeConversationUnavailableError) {
    return jsonApiError(
      FORMATIVE_CONVERSATION_UNAVAILABLE_CODE,
      FORMATIVE_CONVERSATION_UNAVAILABLE_MESSAGE,
      503,
      {
        retryable: error.retryable
      }
    );
  }

  if (error instanceof StudentAssessmentServiceError) {
    return jsonApiError(error.code, error.message, error.status, error.details);
  }

  if (error instanceof z.ZodError) {
    return jsonApiError("validation_failed", "Request validation failed.", 400, {
      issues: error.issues
    });
  }

  logProductionError(error, {
    safe_error_code: "student_assessment_route_unhandled_error"
  });

  return jsonApiError(
    "conflict",
    "Student assessment request could not be completed.",
    500
  );
}
