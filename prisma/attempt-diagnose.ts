import { PrismaClient } from "@prisma/client";
import {
  planAttemptLifecycleReconciliation,
  resolveCanonicalAttemptLifecycle
} from "../src/lib/services/student-assessment/attempt-lifecycle";

const prisma = new PrismaClient();

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function resolveSessionSelector() {
  const sessionPublicId = argValue("--session-public-id") ?? argValue("--session");
  if (sessionPublicId) {
    return { session_public_id: sessionPublicId };
  }

  const studentUserId = argValue("--student-user-id");
  const assessmentPublicId = argValue("--assessment-public-id");
  const assessmentTitle = argValue("--assessment-title");

  if (!studentUserId || (!assessmentPublicId && !assessmentTitle)) {
    throw new Error(
      "Provide --session-public-id, or --student-user-id with --assessment-public-id or --assessment-title."
    );
  }

  const session = await prisma.assessmentSession.findFirst({
    where: {
      user: { user_id: studentUserId },
      assessment: assessmentPublicId
        ? { assessment_public_id: assessmentPublicId }
        : { title: assessmentTitle }
    },
    select: { session_public_id: true },
    orderBy: [{ attempt_number: "desc" }, { created_at: "desc" }]
  });

  if (!session) {
    throw new Error("No matching session found.");
  }

  return { session_public_id: session.session_public_id };
}

async function main() {
  const selector = await resolveSessionSelector();
  const session = await prisma.assessmentSession.findUnique({
    where: selector,
    select: {
      id: true,
      user_db_id: true,
      assessment_db_id: true,
      session_public_id: true,
      attempt_number: true,
      status: true,
      current_phase: true,
      resume_phase: true,
      resume_context: true,
      completed_at: true,
      current_concept_unit_db_id: true,
      started_at: true,
      last_activity_at: true,
      updated_at: true,
      user: { select: { user_id: true, role: true } },
      assessment: { select: { assessment_public_id: true, title: true } }
    }
  });

  if (!session) {
    throw new Error("Session was not found.");
  }

  const lifecycle = resolveCanonicalAttemptLifecycle(session);
  const repairPlan = planAttemptLifecycleReconciliation(session);
  const siblingSessions = await prisma.assessmentSession.findMany({
    where: {
      user_db_id: session.user_db_id,
      assessment_db_id: session.assessment_db_id
    },
    select: {
      session_public_id: true,
      attempt_number: true,
      status: true,
      current_phase: true,
      completed_at: true,
      updated_at: true
    },
    orderBy: [{ attempt_number: "desc" }, { created_at: "desc" }]
  });
  const lifecycleEvents = await prisma.processEvent.findMany({
    where: {
      assessment_session_db_id: session.id,
      event_category: "attempt_lifecycle"
    },
    select: {
      event_type: true,
      occurred_at: true,
      payload: true
    },
    orderBy: { occurred_at: "desc" },
    take: 12
  });

  const eventCounts = lifecycleEvents.reduce<Record<string, number>>((counts, event) => {
    counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
    return counts;
  }, {});

  console.log(
    JSON.stringify(
      {
        status: "diagnosed",
        session_public_id: session.session_public_id,
        student_user_id: session.user.user_id,
        assessment_public_id: session.assessment.assessment_public_id,
        assessment_title: session.assessment.title,
        attempt_number: session.attempt_number,
        stored_state: {
          status: session.status,
          current_phase: session.current_phase,
          completed_at_present: Boolean(session.completed_at),
          current_concept_unit_present: Boolean(session.current_concept_unit_db_id),
          resume_phase_present: Boolean(session.resume_phase),
          resume_context_present: session.resume_context != null,
          started_at: session.started_at,
          last_activity_at: session.last_activity_at,
          updated_at: session.updated_at
        },
        canonical_lifecycle: lifecycle,
        safe_repair_plan: repairPlan,
        sibling_attempts: siblingSessions.map((sibling) => ({
          session_public_id: sibling.session_public_id,
          attempt_number: sibling.attempt_number,
          status: sibling.status,
          current_phase: sibling.current_phase,
          completed_at_present: Boolean(sibling.completed_at),
          lifecycle_version: sibling.updated_at.toISOString()
        })),
        recent_lifecycle_event_counts: eventCounts,
        recent_lifecycle_events: lifecycleEvents.map((event) => ({
          event_type: event.event_type,
          occurred_at: event.occurred_at,
          payload_keys:
            event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
              ? Object.keys(event.payload as Record<string, unknown>).sort()
              : []
        }))
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
