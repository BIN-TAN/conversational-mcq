import { prisma } from "@/lib/db";
import { StudentAssessmentServiceError } from "./errors";

/**
 * One question after each mini-test (release 40): whether the student used another AI tool while
 * answering its questions. The question covers the answers only, not the conversation that follows.
 * The answer is stored with the attempt (AssessmentSession.other_ai_tool_use) and appears only in
 * the research dataset. Instructor pages never show it, and interpretation, feedback and the
 * attempt summary never read it.
 */
export const AI_USE_QUESTION_VERSION = "ai-use-question-v1" as const;
export const AI_USE_QUESTION_TEXT = "Did you use another AI tool while answering the questions?" as const;
export const AI_USE_QUESTION_NOTE = "Your answer is not used for your feedback, and your instructor will not see it." as const;

/**
 * The question is asked once per attempt, after the answers of the attempt's last topic are
 * submitted, while the attempt is still open. A terminal attempt is never asked again.
 */
export function aiUseQuestionNeeded(input: {
  answered: boolean;
  terminal: boolean;
  current_topic_submitted: boolean;
  current_topic_is_last: boolean;
}) {
  return !input.answered && !input.terminal && input.current_topic_submitted && input.current_topic_is_last;
}

export async function recordOtherAiToolUse(input: {
  student_user_db_id: string;
  session_public_id: string;
  used: boolean;
}) {
  const session = await prisma.assessmentSession.findFirst({
    where: { session_public_id: input.session_public_id, user_db_id: input.student_user_db_id },
    select: { id: true, other_ai_tool_use: true }
  });
  if (!session) {
    throw new StudentAssessmentServiceError(
      "session_not_owned",
      "We could not find this attempt. Go back to your assessments and open it again.",
      403
    );
  }
  const submitted = await prisma.conceptUnitSession.count({
    where: { assessment_session_db_id: session.id, initial_completed_at: { not: null } }
  });
  if (!submitted) {
    throw new StudentAssessmentServiceError(
      "conflict",
      "Please submit your answers first.",
      409
    );
  }
  // The first answer stands; a repeated request (a double click or a retry) changes nothing.
  const updated = await prisma.assessmentSession.updateMany({
    where: { id: session.id, other_ai_tool_use: null },
    data: { other_ai_tool_use: input.used, other_ai_tool_use_reported_at: new Date() }
  });
  return { recorded: updated.count === 1, already_answered: updated.count === 0 };
}
