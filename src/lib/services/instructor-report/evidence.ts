import type { Prisma } from "@prisma/client";
import {
  INSTRUCTOR_REPORT_INPUT_VERSION,
  INSTRUCTOR_REPORT_LIMITS,
  type InstructorReportEvidenceIndex,
  type InstructorReportInput,
  type InstructorReportItemInput,
  type InstructorReportStudentInput
} from "./contract";

type Db = Prisma.TransactionClient;

const IDK_OPTION_LABEL = "E";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function optionList(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const record = asRecord(entry);
        return typeof record.label === "string"
          ? [{ label: record.label, text: typeof record.text === "string" ? record.text : "" }]
          : [];
      })
    : [];
}

/**
 * Builds the instructor-report input for one teacher-owned mini-test.
 *
 * Inclusion rule (matches the dashboard's results rule): for each eligible student,
 * the latest attempt that has a sealed initial response package. The sealed package
 * is the initial assessment record; later conversation turns are added separately so
 * the report can distinguish initial evidence from conversation evidence.
 */
export async function buildInstructorReportInput(db: Db, input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}): Promise<{ input: InstructorReportInput; index: InstructorReportEvidenceIndex } | null> {
  const assessment = await db.assessment.findFirst({
    where: { assessment_public_id: input.assessment_public_id, created_by_user_db_id: input.teacher_user_db_id },
    select: {
      id: true,
      title: true,
      concept_units: {
        where: { status: "published" },
        orderBy: { order_index: "asc" },
        select: {
          id: true,
          title: true,
          learning_objective: true,
          items: {
            where: { status: "published", included_in_published_set: true },
            orderBy: [{ item_order: "asc" }, { created_at: "asc" }],
            select: {
              item_public_id: true,
              item_stem: true,
              options: true,
              correct_option: true,
              distractor_rationales: true,
              expected_reasoning_patterns: true
            }
          }
        }
      }
    }
  });
  if (!assessment) return null;

  const items: InstructorReportItemInput[] = [];
  const itemRefByPublicId = new Map<string, string>();
  const itemHasRealOptionE = new Map<string, boolean>();
  for (const unit of assessment.concept_units) {
    for (const item of unit.items) {
      const ref = `Q${items.length + 1}`;
      const options = optionList(item.options);
      itemRefByPublicId.set(item.item_public_id, ref);
      itemHasRealOptionE.set(item.item_public_id, options.some((option) => option.label === IDK_OPTION_LABEL));
      items.push({
        item_ref: ref,
        stem: item.item_stem,
        options,
        correct_option: item.correct_option,
        expected_reasoning: item.expected_reasoning_patterns,
        distractor_rationales: item.distractor_rationales
      });
    }
  }

  const roster = await db.user.findMany({
    where: { role: "student", account_status: "active", created_by_teacher_user_id: input.teacher_user_db_id },
    select: { id: true }
  });
  const rosterIds = new Set(roster.map((user) => user.id));

  const sessions = await db.assessmentSession.findMany({
    where: { assessment_db_id: assessment.id, user: { role: "student" } },
    orderBy: [{ attempt_number: "desc" }, { created_at: "desc" }],
    select: {
      session_public_id: true,
      attempt_number: true,
      user_db_id: true,
      concept_unit_sessions: {
        select: {
          response_packages: {
            where: { package_type: "initial_concept_unit_response_package" },
            orderBy: { created_at: "asc" },
            take: 1,
            select: { payload: true }
          },
          formative_conversation_session: {
            select: {
              status: true,
              lifecycle_reason: true,
              conversation_turns: {
                where: { actor_type: { in: ["student", "agent"] }, message_text: { not: null } },
                orderBy: { sequence_index: "asc" },
                select: { actor_type: true, message_text: true }
              }
            }
          }
        }
      }
    }
  });

  // Same exclusion as the dashboard: an attempt whose chance a teacher restored after
  // a technical problem (waived) is not used as the student's result.
  const waived = new Set((await db.assessmentAttemptChance.findMany({
    where: { session_public_id: { in: sessions.map((session) => session.session_public_id) }, waived_at: { not: null } },
    select: { session_public_id: true }
  })).map((chance) => chance.session_public_id));

  const eligibleUserIds = rosterIds.size > 0 ? rosterIds : new Set(sessions.map((session) => session.user_db_id));
  const chosen = new Map<string, (typeof sessions)[number]>();
  for (const session of sessions) {
    if (!eligibleUserIds.has(session.user_db_id) || chosen.has(session.user_db_id) || waived.has(session.session_public_id)) continue;
    if (session.concept_unit_sessions.some((unit) => unit.response_packages.length > 0)) {
      chosen.set(session.user_db_id, session);
    }
  }

  const truncationNotes: string[] = [];
  // Stable order that does not depend on attempt number, so truncation at
  // max_students does not systematically drop students with more attempts.
  const selected = [...chosen.values()].sort((left, right) => left.session_public_id.localeCompare(right.session_public_id));
  if (selected.length > INSTRUCTOR_REPORT_LIMITS.max_students) {
    truncationNotes.push(`Only the first ${INSTRUCTOR_REPORT_LIMITS.max_students} of ${selected.length} students were included.`);
  }

  const index: InstructorReportEvidenceIndex = {
    students: {},
    items: Object.fromEntries([...itemRefByPublicId.entries()].map(([itemPublicId, ref]) => [ref, { item_public_id: itemPublicId }]))
  };
  let droppedResponseCount = 0;
  const students: InstructorReportStudentInput[] = selected
    .slice(0, INSTRUCTOR_REPORT_LIMITS.max_students)
    .map((session, position) => {
      const studentRef = `S${position + 1}`;
      index.students[studentRef] = { session_public_id: session.session_public_id, attempt_number: session.attempt_number };
      const responses = session.concept_unit_sessions.flatMap((unit) => {
        const payload = asRecord(unit.response_packages[0]?.payload);
        const rows = Array.isArray(payload.item_responses) ? payload.item_responses : [];
        return rows.flatMap((row) => {
          const response = asRecord(row);
          const itemPublicId = typeof response.item_public_id === "string" ? response.item_public_id : "";
          const itemRef = itemRefByPublicId.get(itemPublicId);
          if (!itemRef) {
            droppedResponseCount += 1;
            return [];
          }
          const selectedOption = typeof response.selected_option === "string" ? response.selected_option : null;
          return [{
            item_ref: itemRef,
            selected_option: selectedOption,
            selected_i_dont_know: selectedOption === IDK_OPTION_LABEL && !itemHasRealOptionE.get(itemPublicId),
            correctness: typeof response.correctness === "string" ? response.correctness : "not_scored",
            reasoning: text(response.reasoning_text, INSTRUCTOR_REPORT_LIMITS.max_reasoning_chars),
            confidence: typeof response.confidence_rating === "string" ? response.confidence_rating : null,
            no_other_option_tempting: typeof response.no_tempting_option === "boolean" ? response.no_tempting_option : null,
            tempting_option: typeof response.tempting_option === "string" ? response.tempting_option : null,
            tempting_option_reason: text(response.tempting_option_reason, INSTRUCTOR_REPORT_LIMITS.max_reasoning_chars)
          }];
        });
      });
      const conversation = session.concept_unit_sessions
        .map((unit) => unit.formative_conversation_session)
        .find((entry) => entry !== null) ?? null;
      const allTurns = (conversation?.conversation_turns ?? []).flatMap((turn) => {
        const message = text(turn.message_text, INSTRUCTOR_REPORT_LIMITS.max_conversation_turn_chars);
        return message ? [{ speaker: turn.actor_type === "student" ? "student" as const : "tutor" as const, text: message }] : [];
      });
      if (allTurns.length > INSTRUCTOR_REPORT_LIMITS.max_conversation_turns_per_student) {
        truncationNotes.push(`${studentRef}: only the first ${INSTRUCTOR_REPORT_LIMITS.max_conversation_turns_per_student} conversation messages were included.`);
      }
      return {
        student_ref: studentRef,
        attempt_number: session.attempt_number,
        responses,
        conversation: conversation
          ? {
              status: conversation.status,
              ended_by_student: conversation.lifecycle_reason === "student_ended_conversation",
              student_turn_count: allTurns.filter((turn) => turn.speaker === "student").length,
              turns: allTurns.slice(0, INSTRUCTOR_REPORT_LIMITS.max_conversation_turns_per_student)
            }
          : null
      };
    });

  if (droppedResponseCount > 0) {
    truncationNotes.push(`${droppedResponseCount} recorded responses were left out because their questions are no longer in the published mini test.`);
  }

  const primaryTopic = assessment.concept_units[0] ?? null;
  return {
    input: {
      input_version: INSTRUCTOR_REPORT_INPUT_VERSION,
      mini_test_title: assessment.title,
      topic_title: primaryTopic?.title ?? null,
      learning_objective: primaryTopic?.learning_objective ?? null,
      eligible_student_count: eligibleUserIds.size,
      students_with_submitted_responses: selected.length,
      items,
      students,
      truncation_notes: truncationNotes
    },
    index
  };
}
