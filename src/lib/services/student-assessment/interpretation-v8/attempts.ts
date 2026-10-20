import { prisma } from "@/lib/db";

/**
 * Attempts (docs/AI_MODULE_REDESIGN_2026-10-19.md, section 4.6). Every submission has its
 * own profile, created once. The first attempt is the initial diagnosis; a later attempt's
 * profile records the feedback from earlier attempts that existed before the student
 * started it, so the report can show initial difficulties and later change separately.
 *
 * The answer review is recorded as "shown after submission" (the application shows it
 * once a mini-test is submitted; viewing is not tracked separately). Conversation counts
 * include only turns created before this attempt started.
 */
export const ATTEMPT_CONTEXT_VERSION = "attempt-context-v1" as const;

export type EarlierAttemptFeedback = {
  session_public_id: string;
  attempt_number: number;
  submitted_at: string | null;
  answer_review_shown: boolean;
  opening_message_at: string | null;
  student_turns: number;
  tutor_turns: number;
  last_conversation_turn_at: string | null;
};

export type AttemptContext = {
  attempt_context_version: typeof ATTEMPT_CONTEXT_VERSION;
  session_public_id: string;
  attempt_number: number;
  role: "initial_diagnosis" | "after_feedback";
  started_at: string | null;
  feedback_seen_before: EarlierAttemptFeedback[];
};

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

export async function attemptContextForSession(assessmentSessionDbId: string): Promise<AttemptContext> {
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: assessmentSessionDbId },
    select: {
      session_public_id: true,
      user_db_id: true,
      attempt_number: true,
      started_at: true,
      created_at: true,
      assessment: { select: { id: true, revision_family_public_id: true } }
    }
  });
  const cutoff = session.started_at ?? session.created_at;
  const family = session.assessment.revision_family_public_id;
  const earlier = await prisma.assessmentSession.findMany({
    where: {
      user_db_id: session.user_db_id,
      id: { not: assessmentSessionDbId },
      created_at: { lt: cutoff },
      assessment: family ? { revision_family_public_id: family } : { id: session.assessment.id }
    },
    orderBy: [{ attempt_number: "asc" }, { created_at: "asc" }],
    select: {
      id: true,
      session_public_id: true,
      attempt_number: true,
      concept_unit_sessions: {
        select: {
          response_packages: {
            where: { package_type: "initial_concept_unit_response_package" },
            orderBy: [{ created_at: "asc" }],
            take: 1,
            select: { created_at: true }
          }
        }
      }
    }
  });

  const feedback: EarlierAttemptFeedback[] = [];
  for (const attempt of earlier) {
    const submittedAt = attempt.concept_unit_sessions
      .flatMap((unit) => unit.response_packages.map((pkg) => pkg.created_at))
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const turns = await prisma.conversationTurn.findMany({
      where: {
        assessment_session_db_id: attempt.id,
        formative_conversation_session_db_id: { not: null },
        created_at: { lt: cutoff }
      },
      orderBy: [{ sequence_index: "asc" }],
      select: { actor_type: true, created_at: true }
    });
    const tutorTurns = turns.filter((turn) => turn.actor_type === "agent");
    feedback.push({
      session_public_id: attempt.session_public_id,
      attempt_number: attempt.attempt_number,
      submitted_at: iso(submittedAt),
      answer_review_shown: submittedAt !== null,
      opening_message_at: iso(tutorTurns[0]?.created_at),
      student_turns: turns.filter((turn) => turn.actor_type === "student").length,
      tutor_turns: tutorTurns.length,
      last_conversation_turn_at: iso(turns.at(-1)?.created_at)
    });
  }

  const submittedEarlier = feedback.some((entry) => entry.submitted_at !== null);
  return {
    attempt_context_version: ATTEMPT_CONTEXT_VERSION,
    session_public_id: session.session_public_id,
    attempt_number: session.attempt_number,
    // A later attempt number with no earlier submission (an abandoned first attempt) is
    // still the student's first diagnosis.
    role: submittedEarlier ? "after_feedback" : "initial_diagnosis",
    started_at: iso(session.started_at),
    feedback_seen_before: feedback
  };
}
