export type ContentErrorCode =
  | "validation_failed"
  | "not_found"
  | "conflict"
  | "no_session_data"
  | "cannot_modify_published_with_responses"
  | "content_locked_after_student_session"
  | "assessment_has_no_published_concept_units"
  | "concept_unit_item_count_invalid"
  | "item_archive_would_invalidate_published_concept_unit"
  | "concept_unit_archive_would_invalidate_published_assessment"
  | "published_content_must_return_to_draft_before_editing"
  | "cannot_return_to_draft_after_student_session"
  | "assessment_archived"
  | "assessment_not_archived"
  | "assessment_delete_confirmation_mismatch"
  | "assessment_delete_all_confirmation_mismatch"
  | "assessment_unused_delete_blocked"
  | "forbidden"
  | "publish_validation_failed"
  | "warnings_need_acknowledgement"
  | "current_verification_missing_or_stale"
  | "research_pseudonymization_key_missing"
  | "research_pseudonymization_version_invalid"
  | "legacy_pseudonymization_not_allowed_in_production"
  | "internal_error";

export type ContentValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export class ContentServiceError extends Error {
  code: ContentErrorCode;
  status: number;
  details: Record<string, unknown>;

  constructor(
    code: ContentErrorCode,
    message: string,
    status: number,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ContentServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function validationIssue(
  path: string,
  code: string,
  message: string
): ContentValidationIssue {
  return { path, code, message };
}
