export type AttemptLifecycleSessionSnapshot = {
  status: string;
  current_phase: string;
  completed_at?: Date | string | null;
  resume_phase?: string | null;
  resume_context?: unknown | null;
  updated_at?: Date | string | null;
};

export type CanonicalAttemptStatus =
  | "not_started"
  | "active"
  | "paused"
  | "completed"
  | "ended_by_student"
  | "needs_review"
  | "inconsistent";

export type AttemptLifecycleResolution = {
  canonical_status: CanonicalAttemptStatus;
  canonical_runtime_state: CanonicalAttemptStatus;
  lifecycle_version: string;
  terminal: boolean;
  resumable: boolean;
  can_resume: boolean;
  can_pause: boolean;
  can_end: boolean;
  can_start_another: boolean;
  terminal_status: "completed" | "ended_by_student" | null;
  consistency_issues: string[];
  blocking_reason: string | null;
  safe_recovery_action: "none" | "clear_stale_resume_fields" | "operator_review_required";
};

export type AttemptLifecycleReconciliationPlan = {
  safe_to_apply: boolean;
  action: "none" | "clear_stale_resume_fields";
  reason: string | null;
};

function isoVersion(value: Date | string | null | undefined): string {
  if (!value) {
    return "unknown";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function hasResumeContext(value: unknown | null | undefined): boolean {
  if (value == null) {
    return false;
  }

  if (typeof value === "object" && Object.keys(value as Record<string, unknown>).length === 0) {
    return false;
  }

  return true;
}

export function resolveCanonicalAttemptLifecycle(
  session: AttemptLifecycleSessionSnapshot,
): AttemptLifecycleResolution {
  const completed =
    session.status === "completed" ||
    session.current_phase === "session_completed" ||
    Boolean(session.completed_at);
  const endedByStudent =
    !completed &&
    (session.status === "student_exited" || session.current_phase === "student_exited");
  const needsReview =
    !completed &&
    !endedByStudent &&
    (session.status === "needs_review" || session.current_phase === "needs_review");

  const consistencyIssues: string[] = [];

  if (Boolean(session.completed_at) && session.status !== "completed") {
    consistencyIssues.push("completed_timestamp_status_mismatch");
  }
  if (session.status === "completed" && session.current_phase !== "session_completed") {
    consistencyIssues.push("completed_status_phase_mismatch");
  }
  if (session.current_phase === "session_completed" && session.status !== "completed") {
    consistencyIssues.push("completed_phase_status_mismatch");
  }
  if (session.status === "student_exited" && session.current_phase !== "student_exited") {
    consistencyIssues.push("ended_status_phase_mismatch");
  }
  if (session.current_phase === "student_exited" && session.status !== "student_exited") {
    consistencyIssues.push("ended_phase_status_mismatch");
  }
  if (session.status === "active" && (session.resume_phase || hasResumeContext(session.resume_context))) {
    consistencyIssues.push("active_attempt_has_stale_resume_fields");
  }
  if (session.status === "paused" && !session.resume_phase) {
    consistencyIssues.push("paused_attempt_missing_resume_phase");
  }

  const terminal = completed || endedByStudent;
  let canonicalStatus: CanonicalAttemptStatus;
  if (completed) {
    canonicalStatus = "completed";
  } else if (endedByStudent) {
    canonicalStatus = "ended_by_student";
  } else if (needsReview) {
    canonicalStatus = "needs_review";
  } else if (session.status === "paused") {
    canonicalStatus = "paused";
  } else if (session.status === "active") {
    canonicalStatus = "active";
  } else if (session.status === "not_started" || session.current_phase === "not_started") {
    canonicalStatus = "not_started";
  } else {
    canonicalStatus = "inconsistent";
    consistencyIssues.push("unrecognized_nonterminal_attempt_state");
  }

  const resumable = canonicalStatus === "active" || canonicalStatus === "paused";
  const onlyStaleResumeIssue =
    consistencyIssues.length === 1 &&
    consistencyIssues[0] === "active_attempt_has_stale_resume_fields";
  const safeRecoveryAction =
    onlyStaleResumeIssue && canonicalStatus === "active"
      ? "clear_stale_resume_fields"
      : consistencyIssues.length > 0
        ? "operator_review_required"
        : "none";

  return {
    canonical_status: canonicalStatus,
    canonical_runtime_state: canonicalStatus,
    lifecycle_version: isoVersion(session.updated_at),
    terminal,
    resumable,
    can_resume: resumable,
    can_pause: canonicalStatus === "active",
    can_end: canonicalStatus === "active" || canonicalStatus === "paused",
    can_start_another: terminal,
    terminal_status: completed ? "completed" : endedByStudent ? "ended_by_student" : null,
    consistency_issues: consistencyIssues,
    blocking_reason:
      consistencyIssues.length > 0 && !onlyStaleResumeIssue
        ? "attempt_state_inconsistent"
        : needsReview
          ? "attempt_needs_review"
          : null,
    safe_recovery_action: safeRecoveryAction,
  };
}

export function planAttemptLifecycleReconciliation(
  session: AttemptLifecycleSessionSnapshot,
): AttemptLifecycleReconciliationPlan {
  const resolution = resolveCanonicalAttemptLifecycle(session);

  if (resolution.safe_recovery_action === "clear_stale_resume_fields") {
    return {
      safe_to_apply: true,
      action: "clear_stale_resume_fields",
      reason: "active_attempt_has_stale_resume_fields",
    };
  }

  return {
    safe_to_apply: false,
    action: "none",
    reason: resolution.blocking_reason,
  };
}
