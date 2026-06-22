export type StudentAssessmentErrorCode =
  | "assessment_not_available"
  | "assessment_archived"
  | "assessment_not_published"
  | "assessment_not_released"
  | "assessment_closed_to_new_starts"
  | "assessment_manual_review_not_available"
  | "invalid_assessment_availability_window"
  | "assessment_has_no_valid_published_concept_unit"
  | "assessment_already_completed"
  | "current_concept_unit_unavailable"
  | "session_start_conflict"
  | "session_not_owned"
  | "invalid_phase_for_action"
  | "concept_unit_not_current"
  | "concept_no_longer_current"
  | "item_not_in_current_concept_unit"
  | "item_not_included_in_published_set"
  | "invalid_option"
  | "missing_evidence_repair_required"
  | "missing_evidence_confirmation_required"
  | "initial_response_locked_after_concept_completion"
  | "response_already_finalized"
  | "progression_request_in_progress"
  | "progression_processing"
  | "progression_not_found"
  | "active_followup_round_required"
  | "invalid_progression_choice"
  | "next_concept_not_found"
  | "idempotency_conflict"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "conflict";

export class StudentAssessmentServiceError extends Error {
  code: StudentAssessmentErrorCode;
  status: number;
  details: Record<string, unknown>;

  constructor(
    code: StudentAssessmentErrorCode,
    message: string,
    status: number,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "StudentAssessmentServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
