import type { AssessmentStatus, AssessmentWorkflowMode, Prisma } from "@prisma/client";
import { INCLUDED_ITEM_RANGE } from "@/lib/services/content/governance";
import { formatCourseDateTime, getCourseTimezone } from "./timezone";

export const assessmentAvailabilityStates = [
  "draft",
  "archived",
  "not_released",
  "open",
  "closed_to_new_starts",
  "invalid_content"
] as const;

export type AssessmentAvailabilityState = (typeof assessmentAvailabilityStates)[number];

type AssessmentAvailabilityInput = {
  assessment: {
    status: AssessmentStatus;
    release_at: Date | null;
    close_at: Date | null;
  };
  has_valid_content: boolean;
  existing_session?: {
    status: string;
    current_phase: string;
    completed_at: Date | null;
  } | null;
  now?: Date;
};

export type AssessmentAvailability = {
  availability_state: AssessmentAvailabilityState;
  can_start_new_session: boolean;
  can_resume_existing_session: boolean;
  release_at_utc: string | null;
  close_at_utc: string | null;
  release_at_course_time: string | null;
  close_at_course_time: string | null;
  course_timezone: string;
  availability_message: string;
  student_safe_availability_message: string;
};

function sessionIsResumable(
  session: AssessmentAvailabilityInput["existing_session"] | undefined
) {
  if (!session) {
    return false;
  }

  return (
    (session.status === "active" || session.status === "paused") &&
    session.current_phase !== "session_completed" &&
    session.current_phase !== "student_exited" &&
    !session.completed_at
  );
}

function studentMessage(input: {
  state: AssessmentAvailabilityState;
  releaseAtText: string | null;
  closeAtText: string | null;
  canResume: boolean;
}) {
  if (input.state === "not_released") {
    return input.releaseAtText
      ? `This assessment will be available on ${input.releaseAtText}.`
      : "This assessment has not been released yet.";
  }

  if (input.state === "closed_to_new_starts") {
    return input.canResume
      ? "The assessment is closed to new starts, but you may continue your existing session."
      : "This assessment is closed to new starts.";
  }

  if (input.state === "invalid_content") {
    return "This assessment is not available yet.";
  }

  if (input.state === "draft") {
    return "This assessment has not been published yet.";
  }

  if (input.state === "archived") {
    return input.canResume
      ? "This assessment is archived, but you may continue your existing session."
      : "This assessment is not available.";
  }

  if (input.closeAtText) {
    return `This assessment is available. New starts close on ${input.closeAtText}.`;
  }

  return "This assessment is available.";
}

export function computeAssessmentAvailability(
  input: AssessmentAvailabilityInput
): AssessmentAvailability {
  const now = input.now ?? new Date();
  const releaseAt = input.assessment.release_at;
  const closeAt = input.assessment.close_at;
  const canResume = sessionIsResumable(input.existing_session);
  let state: AssessmentAvailabilityState = "open";

  if (input.assessment.status === "draft") {
    state = "draft";
  } else if (input.assessment.status === "archived") {
    state = "archived";
  } else if (!input.has_valid_content) {
    state = "invalid_content";
  } else if (releaseAt && now < releaseAt) {
    state = "not_released";
  } else if (closeAt && now >= closeAt) {
    state = "closed_to_new_starts";
  }

  const releaseAtText = formatCourseDateTime(releaseAt);
  const closeAtText = formatCourseDateTime(closeAt);
  const canStart = state === "open" && !input.existing_session;
  const message = studentMessage({
    state,
    releaseAtText,
    closeAtText,
    canResume
  });

  return {
    availability_state: state,
    can_start_new_session: canStart,
    can_resume_existing_session: canResume,
    release_at_utc: releaseAt?.toISOString() ?? null,
    close_at_utc: closeAt?.toISOString() ?? null,
    release_at_course_time: releaseAtText,
    close_at_course_time: closeAtText,
    course_timezone: getCourseTimezone(),
    availability_message: message,
    student_safe_availability_message: message
  };
}

type TxClient = Pick<Prisma.TransactionClient, "conceptUnit">;

export async function assessmentHasValidPublishedContent(
  tx: TxClient,
  assessmentDbId: string
) {
  const conceptUnits = await tx.conceptUnit.findMany({
    where: {
      assessment_db_id: assessmentDbId,
      status: "published"
    },
    select: {
      id: true,
      items: {
        where: {
          status: "published",
          included_in_published_set: true
        },
        select: { id: true }
      }
    }
  });

  return (
    conceptUnits.length > 0 &&
    conceptUnits.every(
      (conceptUnit) =>
        conceptUnit.items.length >= INCLUDED_ITEM_RANGE.min &&
        conceptUnit.items.length <= INCLUDED_ITEM_RANGE.max
    )
  );
}

export function workflowModeLabel(mode: AssessmentWorkflowMode) {
  return mode === "automatic" ? "Automatic" : "Manual review";
}
