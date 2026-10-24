// "Students to follow up" on the dashboard: ordering only. Every value in a row is computed
// by the dashboard service for its overview charts; nothing here is a new measure.

export type StudentFollowUpRow = {
  student_user_id: string;
  student_name: string;
  session_public_id: string;
  attempt_number: number;
  initial_understanding: string;
  latest_understanding: string;
  conversation_update: string;
  needs_review: boolean;
  needs_review_reason: string | null;
};

const FOLLOW_UP_LATEST_LABEL = "Need more work";
const FOLLOW_UP_CONVERSATION_LABEL = "Instructor assistance recommended";

/**
 * 0: latest result "Need more work" or the conversation recommended instructor assistance;
 * 1: flagged for review; 2: everyone else.
 */
export function followUpPriority(row: Pick<StudentFollowUpRow, "latest_understanding" | "conversation_update" | "needs_review">) {
  if (row.latest_understanding === FOLLOW_UP_LATEST_LABEL || row.conversation_update === FOLLOW_UP_CONVERSATION_LABEL) return 0;
  if (row.needs_review) return 1;
  return 2;
}

/** Priority first, then by name, then by user ID. */
export function sortStudentsToFollowUp<T extends StudentFollowUpRow>(rows: T[]): T[] {
  return [...rows].sort((left, right) =>
    followUpPriority(left) - followUpPriority(right)
    || left.student_name.localeCompare(right.student_name)
    || left.student_user_id.localeCompare(right.student_user_id));
}
