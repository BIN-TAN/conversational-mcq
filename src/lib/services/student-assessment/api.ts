import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonApiError, requireRoleApi } from "@/lib/http";
import { logProductionError } from "@/lib/observability/production-safe-logger";
import {
  FORMATIVE_CONVERSATION_UNAVAILABLE_CODE,
  FORMATIVE_CONVERSATION_UNAVAILABLE_MESSAGE,
  FormativeConversationUnavailableError
} from "./formative-conversation/availability";
import { FormativeConversationFoundationError } from "./formative-conversation/service";
import { StudentAssessmentServiceError } from "./errors";
import {
  ATTEMPT_OPEN_ELSEWHERE_CODE,
  ATTEMPT_OPEN_ELSEWHERE_MESSAGE,
  ATTEMPT_TAB_HEADER,
  attemptTabHeaderIsCurrent
} from "./attempt-tab";

async function attemptTabHeaderValue() {
  try {
    return (await headers()).get(ATTEMPT_TAB_HEADER);
  } catch {
    // Called outside a request (scripts and tests): nothing to check.
    return null;
  }
}

export async function requireStudent(options: { checkAttemptTab?: boolean } = {}) {
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

  // D11: a saving request from a tab that no longer holds the attempt is refused.
  if (options.checkAttemptTab !== false &&
      !(await attemptTabHeaderIsCurrent(auth.user.user_db_id, await attemptTabHeaderValue()))) {
    return {
      ok: false as const,
      response: jsonApiError(ATTEMPT_OPEN_ELSEWHERE_CODE, ATTEMPT_OPEN_ELSEWHERE_MESSAGE, 409)
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

  if (error instanceof FormativeConversationFoundationError) {
    if (error.code === "assistant_response_pending") {
      return jsonApiError(error.code, error.message, 409);
    }
    if (error.code === "conversation_not_found") {
      return jsonApiError(
        "not_found",
        "The learning conversation was not found.",
        404
      );
    }
    if (
      error.code === "conversation_not_active" ||
      error.code === "conversation_turn_limit_reached"
    ) {
      return jsonApiError(
        "invalid_phase_for_action",
        "This learning conversation is no longer accepting new messages.",
        409,
        { retryable: false }
      );
    }
    return jsonApiError(
      "conflict",
      "This conversation changed in another tab or window. Refresh the page to see the latest messages.",
      409
    );
  }

  if (error instanceof z.ZodError) {
    return jsonApiError("validation_failed", "Something in that request was not right. Refresh the page and try again.", 400, {
      issues: error.issues
    });
  }

  logProductionError(error, {
    safe_error_code: "student_assessment_route_unhandled_error"
  });

  return jsonApiError(
    "conflict",
    "Something went wrong. Your saved answers are safe. Refresh the page and try again.",
    500
  );
}
