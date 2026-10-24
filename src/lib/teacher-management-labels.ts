// Plain-English labels for the instructor's management pages (assessment management, student
// accounts, data and outcomes). Pure functions only, so they can be shared by client
// components and checked by database-free tests. They change on-screen wording only: stored
// values, export files and their column names are untouched.

export type AssessmentStatusInput = {
  status: string;
  release_at?: string | null;
  close_at?: string | null;
  /** Course-time text for the release date, when the server provides it. */
  release_at_course_time?: string | null;
  close_at_course_time?: string | null;
  has_student_sessions?: boolean;
  assessment_session_count?: number;
};

export type AssessmentStatusPhrase = {
  tone: "draft" | "scheduled" | "open" | "closed" | "archived";
  /** Short phrase for a badge, e.g. "Draft – students cannot see it". */
  label: string;
  /** One sentence that explains what students can do, for detail views. */
  detail: string;
};

function fallbackDateText(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function hasSessions(input: AssessmentStatusInput) {
  return Boolean(input.has_student_sessions) || (input.assessment_session_count ?? 0) > 0;
}

/**
 * One phrase that combines the stored status, the release and closing dates and whether any
 * student has started. It mirrors computeAssessmentAvailability: a draft is hidden from
 * students, an archived mini test takes no new attempts, and release/close dates control new
 * starts for a published one.
 */
export function assessmentStatusPhrase(
  input: AssessmentStatusInput,
  now: Date = new Date()
): AssessmentStatusPhrase {
  const started = hasSessions(input);
  const releaseText = input.release_at_course_time || fallbackDateText(input.release_at);
  const closeText = input.close_at_course_time || fallbackDateText(input.close_at);

  if (input.status === "archived") {
    return {
      tone: "archived",
      label: "Archived",
      detail: started
        ? "Students cannot start new attempts. Past attempts are kept."
        : "Students cannot start it. No student has started it."
    };
  }

  if (input.status === "draft") {
    return {
      tone: "draft",
      label: "Draft – students cannot see it",
      detail: "Students cannot see this mini test until you publish it."
    };
  }

  const releaseAt = input.release_at ? new Date(input.release_at) : null;
  const closeAt = input.close_at ? new Date(input.close_at) : null;

  if (releaseAt && now < releaseAt) {
    return {
      tone: "scheduled",
      label: releaseText ? `Scheduled – opens ${releaseText}` : "Scheduled",
      detail: releaseText
        ? `Students can start this mini test from ${releaseText}${closeText ? ` until ${closeText}` : ""}.`
        : "Students can start this mini test once it opens."
    };
  }

  if (closeAt && now >= closeAt) {
    return {
      tone: "closed",
      label: "Closed to new attempts",
      detail: started
        ? "New attempts are closed. Students who already started can still finish."
        : "New attempts are closed. No student started it."
    };
  }

  return {
    tone: "open",
    label: "Open to students",
    detail: closeText
      ? `Students can start this mini test until ${closeText}.`
      : "Students can start this mini test. There is no closing date."
  };
}

/** Plain label for a stored content status shown on its own (items, topics). */
export function contentStatusLabel(status: string) {
  if (status === "draft") return "Draft";
  if (status === "published") return "Published";
  if (status === "archived") return "Archived";
  return plainWords(status);
}

/** A sentence explaining why content is read-only, instead of a lock-reason code. */
export function contentLockSentence(reason: string | null | undefined) {
  if (!reason) return "Not locked. You can still change the questions.";
  if (reason === "student_session_exists") {
    return "Locked because students have started it, so its questions and answer keys stay the same for every attempt.";
  }
  return "Locked, so its questions and answer keys stay the same for every attempt.";
}

/** Plain words for an internal code that has no specific label. */
export function plainWords(code: string) {
  const text = code.replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

const studentStatusLabels: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  temporary_pending: "Must change password",
  committed: "Imported",
  previewed: "Not imported yet",
  new_student: "New student",
  existing_unchanged: "Already exists, no change",
  display_name_change: "Display name will change",
  invalid: "Needs correction",
  duplicate_file_row: "Repeated in the file",
  role_conflict: "Belongs to an instructor account"
};

/** Labels for student-account and roster statuses. */
export function studentStatusLabel(value: string) {
  return studentStatusLabels[value] ?? plainWords(value);
}

const exportScopeLabels: Record<string, string> = {
  all_authorized: "All your data",
  selected_assessment: "One mini test",
  selected_student: "One student",
  selected_session: "One session"
};

export function exportScopeLabel(code: string | null | undefined) {
  if (!code) return "Earlier export";
  return exportScopeLabels[code] ?? plainWords(code);
}

const exportTypeLabels: Record<string, string> = {
  research_dataset: "Research dataset"
};

export function exportTypeLabel(code: string | null | undefined) {
  if (!code) return "Earlier export";
  return exportTypeLabels[code] ?? plainWords(code);
}

const exportStatusLabels: Record<string, string> = {
  pending: "Waiting",
  processing: "Generating",
  completed: "Ready",
  failed: "Failed"
};

export function exportStatusLabel(code: string) {
  return exportStatusLabels[code] ?? plainWords(code);
}

const exportFailureLabels: Record<string, string> = {
  research_pseudonymization_key_missing:
    "The server has no pseudonymization key, so research files cannot be generated yet.",
  research_export_not_ready: "Research export is not set up on the server yet.",
  research_export_artifact_path_unwritable: "The server could not save the export file.",
  research_export_configuration_unreadable: "The server's export settings could not be read.",
  research_export_database_unavailable: "The database could not be reached.",
  research_export_dictionary_registry_unavailable: "The data dictionary could not be loaded.",
  research_export_generation_failed: "The file could not be generated.",
  no_session_data: "There were no student sessions in the chosen scope.",
  not_found: "The chosen mini test, student or session was not found.",
  validation_failed: "The export settings were not accepted."
};

export function exportFailureLabel(code: string | null | undefined) {
  if (!code) return "The file could not be generated.";
  return exportFailureLabels[code] ?? "The file could not be generated.";
}

/**
 * The query that reruns a failed research export with its own recorded settings, or null when
 * the job does not record enough to rerun it (a single-student job stores only a fingerprint
 * of the student ID, and a consent filter stores only a hash of the list).
 */
export function researchExportRetryQuery(options: unknown): {
  query: string;
  restricted: boolean;
} | null {
  if (!options || typeof options !== "object") return null;
  const record = options as Record<string, unknown>;
  if (record.export_type !== "research_dataset") return null;
  if (record.participant_filter_mode && record.participant_filter_mode !== "none") return null;
  const params = new URLSearchParams();
  const scope = record.export_scope;
  if (scope === "selected_assessment") {
    if (typeof record.selected_assessment_public_id !== "string" || !record.selected_assessment_public_id) return null;
    params.set("assessment_public_id", record.selected_assessment_public_id);
  } else if (scope === "selected_session") {
    if (typeof record.selected_session_public_id !== "string" || !record.selected_session_public_id) return null;
    params.set("session_public_id", record.selected_session_public_id);
  } else if (scope !== "all_authorized") {
    return null;
  }
  params.set("include_incomplete_sessions", record.include_incomplete_sessions === false ? "false" : "true");
  const restricted = record.restricted_fields_included === true;
  if (restricted) params.set("include_restricted_fields", "true");
  return { query: `?${params.toString()}`, restricted };
}

export type ConfirmationCopy = {
  question: string;
  sentences: string[];
  confirmLabel: string;
};

type ConfirmationInput = AssessmentStatusInput & {
  title?: string;
  supersedes_assessment_public_id?: string | null;
};

/**
 * Publishing makes the mini test visible to students under its release and closing dates
 * (computeAssessmentAvailability). Publishing a corrected version archives the version it
 * replaces; attempts already made stay attached to that earlier version.
 */
export function publishConfirmation(input: ConfirmationInput, now: Date = new Date()): ConfirmationCopy {
  const releaseText = input.release_at_course_time || fallbackDateText(input.release_at);
  const closeText = input.close_at_course_time || fallbackDateText(input.close_at);
  const releaseAt = input.release_at ? new Date(input.release_at) : null;
  const closeAt = input.close_at ? new Date(input.close_at) : null;
  const sentences: string[] = [];

  if (closeAt && now >= closeAt) {
    sentences.push(
      `Its closing date${closeText ? `, ${closeText},` : ""} has already passed, so students will see it but cannot start it until you change the dates.`
    );
  } else if (releaseAt && now < releaseAt && releaseText) {
    sentences.push(
      closeText
        ? `Students can start this mini test from ${releaseText} until ${closeText}.`
        : `Students can start this mini test from ${releaseText}. There is no closing date.`
    );
  } else {
    sentences.push(
      closeText
        ? `Students can start this mini test as soon as it is published, until ${closeText}.`
        : "Students can start this mini test as soon as it is published. There is no closing date."
    );
  }

  if (input.supersedes_assessment_public_id) {
    sentences.push("The previous version will be archived; existing attempts stay attached to it.");
  }

  sentences.push("Once a student starts, its questions and answer keys can no longer be edited.");

  return {
    question: input.supersedes_assessment_public_id
      ? "Publish this corrected version?"
      : "Publish this mini test?",
    sentences,
    confirmLabel: "Publish"
  };
}

/**
 * Archiving blocks new attempts. Archived mini tests stay listed for students who took them,
 * and a student with an unfinished attempt may still finish it (computeAssessmentAvailability).
 */
export function archiveConfirmation(input: ConfirmationInput): ConfirmationCopy {
  const sentences =
    input.status === "draft"
      ? [
          "Students cannot see this draft now, and it will move out of the active list.",
          "You can restore it later."
        ]
      : [
          "Students will no longer be able to start this mini test.",
          "A student who has already started can still finish that attempt. Their past attempts are kept.",
          "You can restore it later."
        ];

  return {
    question: input.title ? `Archive “${input.title}”?` : "Archive this mini test?",
    sentences,
    confirmLabel: "Archive"
  };
}

/**
 * Restoring publishes the mini test again when students have attempts, and returns it to
 * draft when nobody has started it (restoreArchivedAssessment).
 */
export function restoreConfirmation(input: ConfirmationInput): ConfirmationCopy {
  const started = hasSessions(input);
  return {
    question: input.title ? `Restore “${input.title}”?` : "Restore this mini test?",
    sentences: started
      ? [
          "It will be published again because students have attempts on it.",
          "Students can start it again whenever its release and closing dates allow."
        ]
      : [
          "It will return as a draft because no student has started it.",
          "Students will not see it until you publish it."
        ],
    confirmLabel: "Restore"
  };
}

/** Returning to draft is allowed only before any student starts (returnAssessmentToDraft). */
export function returnToDraftConfirmation(): ConfirmationCopy {
  return {
    question: "Return this mini test to draft?",
    sentences: [
      "Students will no longer see this mini test until you publish it again.",
      "No student has started it, so no attempts are affected."
    ],
    confirmLabel: "Return to draft"
  };
}

/**
 * Teacher pages that render their own <h1> (a PageHeader or TeacherPageHeader). On these the
 * workspace header shows its section title as plain text, so each page has exactly one <h1>.
 */
export function pageRendersOwnHeading(pathname: string | null | undefined) {
  if (!pathname) return false;
  const path = pathname.replace(/\/+$/, "");
  if (path.startsWith("/teacher/content/")) return true;
  if (path === "/teacher/students/new" || path === "/teacher/students/import") return true;
  if (/^\/teacher\/students\/[^/]+$/.test(path) && path !== "/teacher/students/invitations") return true;
  if (path === "/teacher/data/research" || path === "/teacher/data/summative-outcomes") return true;
  if (/^\/teacher\/sessions\/[^/]+$/.test(path)) return true;
  if (path === "/teacher/evals") return true;
  return false;
}
