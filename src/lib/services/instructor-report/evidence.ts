import type { Prisma } from "@prisma/client";
import { loadItemReviewDecisionsForAssessment } from "@/lib/services/item-review/service";
import {
  FEEDBACK_V8_AGENT_NAME,
  FEEDBACK_V8_CONTRACT_VERSION
} from "@/lib/services/student-assessment/feedback-v8/contract";
import type { LoadedReportAttempt, LoadedReportItem, LoadedReportRecords } from "./assemble";

type Db = Prisma.TransactionClient;

/** Signal type written by the conversation runtime for a feedback v8 instructor-review flag. */
export const FEEDBACK_V8_REVIEW_SIGNAL_TYPE = "feedback_v8_instructor_review";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

function optionList(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const option = record(entry);
        return typeof option.label === "string" ? [{ label: option.label, text: typeof option.text === "string" ? option.text : "" }] : [];
      })
    : [];
}

function expectedReasoning(value: unknown) {
  if (typeof value === "string") return str(value);
  if (!Array.isArray(value)) return null;
  const texts = value.map((entry) => str(entry) ?? str(record(entry).text)).filter((entry): entry is string => Boolean(entry));
  return texts.length ? texts.slice(0, 2).join(" ") : null;
}

function rationaleList(value: unknown) {
  return Object.entries(record(value)).flatMap(([option, rationale]) => {
    const text = str(rationale);
    return text ? [{ option, rationale: text }] : [];
  });
}

/**
 * Loads everything the instructor report needs for one teacher-owned mini-test: the
 * published items, the roster size, and every student attempt with its sealed initial
 * response package, its profile (the conversation's initial profile, otherwise the topic's
 * profile pointer, as on the dashboard), and its conversation with the feedback v8 turn
 * records and instructor-review signals. No process events are read. The counts, labels and
 * model input are built from these records by assembleInstructorReportV8.
 */
export async function loadInstructorReportRecords(db: Db, input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}): Promise<LoadedReportRecords | null> {
  const assessment = await db.assessment.findFirst({
    where: { assessment_public_id: input.assessment_public_id, created_by_user_db_id: input.teacher_user_db_id },
    select: {
      id: true,
      title: true,
      concept_units: {
        where: { status: "published" },
        orderBy: { order_index: "asc" },
        select: {
          title: true,
          learning_objective: true,
          related_concept_description: true,
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

  const items: LoadedReportItem[] = assessment.concept_units.flatMap((unit) => unit.items.map((item) => ({
    item_public_id: item.item_public_id,
    stem: item.item_stem,
    options: optionList(item.options),
    correct_option: item.correct_option,
    expected_reasoning: expectedReasoning(item.expected_reasoning_patterns),
    distractor_rationales: rationaleList(item.distractor_rationales)
  })));

  const roster = await db.user.findMany({
    where: { role: "student", account_status: "active", created_by_teacher_user_id: input.teacher_user_db_id },
    select: { id: true }
  });
  const rosterIds = new Set(roster.map((user) => user.id));

  const sessions = await db.assessmentSession.findMany({
    where: { assessment_db_id: assessment.id, user: { role: "student" } },
    orderBy: [{ attempt_number: "asc" }, { created_at: "asc" }],
    select: {
      session_public_id: true,
      attempt_number: true,
      user_db_id: true,
      status: true,
      created_at: true,
      concept_unit_sessions: {
        orderBy: { created_at: "asc" },
        select: {
          response_packages: {
            where: { package_type: "initial_concept_unit_response_package" },
            orderBy: { created_at: "asc" },
            take: 1,
            select: { payload: true }
          },
          latest_student_profile: { select: { item_level_evidence: true } },
          relabeled_student_profile: { select: { item_level_evidence: true } },
          formative_conversation_session: {
            select: {
              status: true,
              lifecycle_reason: true,
              initial_student_profile: { select: { item_level_evidence: true } },
              conversation_turns: {
                where: { actor_type: { in: ["student", "agent"] }, message_text: { not: null } },
                orderBy: { sequence_index: "asc" },
                select: { id: true, actor_type: true, message_text: true, structured_payload: true }
              },
              agent_calls: {
                where: {
                  agent_name: FEEDBACK_V8_AGENT_NAME,
                  schema_version: FEEDBACK_V8_CONTRACT_VERSION,
                  call_status: "succeeded",
                  output_validated: true
                },
                select: { id: true, output_payload: true }
              },
              review_signals: {
                where: { signal_type: FEEDBACK_V8_REVIEW_SIGNAL_TYPE },
                select: { source_turn_db_id: true, reason_code: true }
              }
            }
          }
        }
      }
    }
  });

  // Same exclusion as the dashboard: an attempt whose chance a teacher restored after a
  // technical problem (waived) is not used as the student's result.
  const restored = new Set((await db.assessmentAttemptChance.findMany({
    where: { session_public_id: { in: sessions.map((session) => session.session_public_id) }, waived_at: { not: null } },
    select: { session_public_id: true }
  })).map((chance) => chance.session_public_id));

  const eligibleUserIds = rosterIds.size > 0 ? rosterIds : new Set(sessions.map((session) => session.user_db_id));
  const attempts: LoadedReportAttempt[] = sessions
    .filter((session) => eligibleUserIds.has(session.user_db_id))
    .map((session) => {
      const units = session.concept_unit_sessions;
      const submittedUnit = units.find((unit) => unit.response_packages.length > 0) ?? null;
      const conversation = submittedUnit?.formative_conversation_session ?? units.find((unit) => unit.formative_conversation_session)?.formative_conversation_session ?? null;
      // An applied one-time reinterpretation under updated rules (release 27) is the interpretation of record.
      const profile = submittedUnit?.relabeled_student_profile ?? conversation?.initial_student_profile ?? submittedUnit?.latest_student_profile ?? null;
      return {
        student_key: session.user_db_id,
        session_public_id: session.session_public_id,
        attempt_number: session.attempt_number,
        created_at: session.created_at.toISOString(),
        finished: session.status === "completed",
        restored: restored.has(session.session_public_id),
        package_payloads: units.flatMap((unit) => unit.response_packages.map((pkg) => pkg.payload)),
        profile_item_level_evidence: profile?.item_level_evidence ?? null,
        conversation: conversation
          ? {
              status: conversation.status,
              lifecycle_reason: conversation.lifecycle_reason,
              turns: conversation.conversation_turns.map((turn) => ({
                turn_id: turn.id,
                actor: turn.actor_type === "student" ? ("student" as const) : ("tutor" as const),
                text: turn.message_text ?? "",
                agent_call_id: str(record(turn.structured_payload).agent_call_db_id)
              })),
              feedback_v8_outputs: conversation.agent_calls.map((call) => ({ agent_call_id: call.id, output: call.output_payload })),
              review_signals: conversation.review_signals.map((signal) => ({ source_turn_id: signal.source_turn_db_id, flag: signal.reason_code }))
            }
          : null
      };
    });

  const topic = assessment.concept_units[0] ?? null;
  return {
    mini_test_title: assessment.title,
    topic: topic ? { title: topic.title, learning_objective: str(topic.learning_objective), description: str(topic.related_concept_description) } : null,
    items,
    eligible_student_count: eligibleUserIds.size,
    attempts,
    // The instructor's current item-review decisions (section 4.4), applied to every label.
    item_decisions: await loadItemReviewDecisionsForAssessment(assessment.id)
  };
}
