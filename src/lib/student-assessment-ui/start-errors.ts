import type { StructuredStudentApiError } from "./types";

const ACTIVE_ATTEMPT_ERROR_CODES = new Set([
  "active_attempt_exists",
  "session_start_conflict"
]);

export function startErrorRecoverySessionPublicId(error: StructuredStudentApiError) {
  const value = error.details?.existing_session_public_id;

  return typeof value === "string" && value.trim() ? value : null;
}

export function normalizeAssessmentStartErrorForStudent(
  error: StructuredStudentApiError
): StructuredStudentApiError {
  if (error.status === 409 && ACTIVE_ATTEMPT_ERROR_CODES.has(error.code)) {
    return {
      ...error,
      message: "You already have an activity in progress. Resume your current attempt."
    };
  }

  return error;
}

export function shouldDisplayStudentApiErrorCode(error: StructuredStudentApiError) {
  return error.status !== 409;
}
