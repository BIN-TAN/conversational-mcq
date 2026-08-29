import {
  resolveCanonicalAttemptLifecycle,
  type AttemptLifecycleSessionSnapshot
} from "@/lib/services/student-assessment/attempt-lifecycle";

export const RECENT_REVIEWABLE_ATTEMPT_LIMIT = 3;

type AttemptHistorySession = AttemptLifecycleSessionSnapshot & {
  session_public_id: string;
  attempt_number: number;
  created_at: Date | string;
  updated_at: Date | string;
};

export type RecentReviewableAttempt = {
  session_public_id: string;
  attempt_number: number;
  status: "completed" | "ended";
  ended_at: string;
};

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function recentReviewableAttempts(
  sessions: AttemptHistorySession[]
): RecentReviewableAttempt[] {
  return [...sessions]
    .sort((left, right) => right.attempt_number - left.attempt_number)
    .flatMap((session) => {
      const lifecycle = resolveCanonicalAttemptLifecycle(session);

      if (!lifecycle.terminal || !lifecycle.terminal_status) {
        return [];
      }

      return [{
        session_public_id: session.session_public_id,
        attempt_number: session.attempt_number,
        status: lifecycle.terminal_status === "completed" ? "completed" as const : "ended" as const,
        ended_at: toIsoString(session.completed_at ?? session.updated_at ?? session.created_at)
      }];
    })
    .slice(0, RECENT_REVIEWABLE_ATTEMPT_LIMIT);
}
