// Plain-English labels for the stored codes that instructors see on the results pages.
// Presentation only: the stored codes, exports and measures are unchanged.

export const TEACHER_PLAIN_LABELS: Readonly<Record<string, string>> = {
  // Session (attempt) status
  not_started: "Not started",
  active: "In progress",
  paused: "Paused",
  completed: "Completed",
  student_exited: "Ended by the student",
  needs_review: "Needs review",
  not_flagged: "Not flagged",

  // Phases not covered by teacherPhaseLabel
  session_started: "Started",
  concept_unit_intro: "Topic introduction",
  initial_item_administration: "Answering questions",
  missing_evidence_repair: "Completing missing answers",
  initial_concept_unit_completed: "Questions submitted",
  profiling_pending: "Preparing initial feedback",
  profiling_completed: "Preparing learning conversation",
  planning_pending: "Preparing learning conversation",
  planning_completed: "Learning conversation",
  followup_active: "Learning conversation",
  followup_profile_update_pending: "Updating the learning profile",
  followup_planning_update_pending: "Updating the conversation plan",
  followup_stopped: "Conversation stopped",
  between_concept_units: "Between topics",
  session_completed: "Assessment completed",

  // Topic status and learning-conversation status
  initial_in_progress: "Answering questions",
  initial_completed: "Questions submitted",
  followup_completed: "Conversation completed",
  stopped: "Stopped",
  incomplete: "Incomplete",
  ended: "Ended",
  teacher_assistance_recommended: "Instructor assistance recommended",
  conversation_in_progress: "Conversation in progress",
  conversation_paused: "Conversation paused",
  teacher_support_recommended: "Instructor assistance recommended",
  sound: "Sound understanding",
  largely_improved: "Largely improved understanding",

  // How the session runs
  manual: "Manual review",
  manual_review: "Manual review",
  automatic: "Automatic",
  automatic_idle: "Automatic, waiting for the student",
  automatic_processing: "Automatic preparation in progress",
  automatic_paused: "Automatic preparation paused",
  automatic_failed: "Automatic preparation failed",
  automatic_active_followup: "Learning conversation in progress",
  automatic_completed_step: "Automatic step completed",
  deterministic: "Standard answer form",
  llm_assisted: "Answers collected in conversation",

  // Background steps
  pending: "Waiting",
  running: "Running",
  retryable: "Will try again",
  failed: "Failed",
  cancelled: "Cancelled",
  prepare_initial_conversation: "Prepare the learning conversation",
  run_initial_profiling: "Prepare the initial profile",
  run_initial_planning: "Plan the learning conversation",
  start_initial_followup: "Start the learning conversation",
  run_followup_profile_update: "Update the profile during the conversation",
  run_followup_planning_update: "Update the conversation plan",
  finalize_followup_update: "Final profile update",
  finalize_concept_progression: "Finish the topic",
  pause_automation: "Automatic preparation paused",
  resume_automation: "Automatic preparation resumed",
  retry_current_step: "Current step retried",
  stop_followup: "Follow-up stopped",

  // Responses
  correct: "Correct",
  incorrect: "Incorrect",
  unanswered: "Not answered",
  not_scored: "Not scored",
  low: "Low",
  medium: "Medium",
  high: "High",
  answered_correctly: "Answered correctly",
  answered_incorrectly: "Answered incorrectly",
  explicitly_skipped: "Skipped",
  response_not_finalized: "Not finalized",
  skipped_item: "Question skipped",
  skipped_reasoning: "Reasoning skipped",
  skipped_confidence: "Confidence skipped",
  missing_evidence_repair_offered: "Asked to complete missing answers",

  // Content lock
  locked_after_student_session: "Locked because students have started",
  not_locked: "Not locked",

  // Who acted
  student: "Student",
  agent: "AI assistant",
  system: "System",
  orchestrator: "System",
  teacher_researcher: "Instructor"
};

const CODE_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/**
 * Plain label for a stored code. Unknown codes become words ("some_code" -> "Some code");
 * text that is already plain is returned unchanged.
 */
export function plainLabel(value: string | null | undefined): string {
  if (value === null || value === undefined) return "Not recorded";
  const mapped = TEACHER_PLAIN_LABELS[value];
  if (mapped) return mapped;
  if (!CODE_PATTERN.test(value)) return value.replace(/_/g, " ");
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const REVIEW_REASON_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["automatic_workflow_failed", "Automatic preparation failed."],
  ["followup_final_update_failed", "The final profile update after the learning conversation failed."],
  ["followup_update_failed", "A profile update during the learning conversation failed."],
  ["followup_evidence_ready_for_profile_update", "The learning conversation is ready for a profile update."],
  ["initial_feedback_unavailable", "Initial feedback was not available."],
  ["student_requested_end", "Ended by the student."]
];

const REVIEW_CODE_PATTERN = /^[a-z0-9_]+(?::[A-Za-z0-9_.-]+)*$/;

/**
 * Plain wording for a stored review reason. Reasons are either sentences (kept as written)
 * or codes such as "automatic_workflow_failed:run_initial_profiling:timeout", which are
 * replaced by a sentence. Several reasons are stored on separate lines.
 */
export function plainReviewReason(reason: string | null | undefined): string | null {
  if (!reason || !reason.trim()) return null;
  const lines = reason.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    if (!REVIEW_CODE_PATTERN.test(line)) return line;
    const code = line.split(":")[0];
    const known = REVIEW_REASON_LABELS.find(([prefix]) => prefix === code);
    if (known) return known[1];
    return `${plainLabel(code)}.`;
  });
  return [...new Set(lines)].join(" ");
}
