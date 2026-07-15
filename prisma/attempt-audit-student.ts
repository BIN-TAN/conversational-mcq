import { PrismaClient } from "@prisma/client";
import { resolveCanonicalAttemptLifecycle } from "../src/lib/services/student-assessment/attempt-lifecycle";

const prisma = new PrismaClient();

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const studentUserId = argValue("--student-user-id");
  const assessmentPublicId = argValue("--assessment-public-id");
  const assessmentTitle = argValue("--assessment-title");

  if (!studentUserId || (!assessmentPublicId && !assessmentTitle)) {
    throw new Error(
      "Provide --student-user-id with --assessment-public-id or --assessment-title."
    );
  }

  const sessions = await prisma.assessmentSession.findMany({
    where: {
      user: { user_id: studentUserId },
      assessment: assessmentPublicId
        ? { assessment_public_id: assessmentPublicId }
        : { title: assessmentTitle }
    },
    select: {
      id: true,
      session_public_id: true,
      attempt_number: true,
      status: true,
      current_phase: true,
      resume_phase: true,
      resume_context: true,
      completed_at: true,
      started_at: true,
      last_activity_at: true,
      created_at: true,
      updated_at: true,
      assessment: { select: { assessment_public_id: true, title: true } }
    },
    orderBy: [{ attempt_number: "asc" }, { created_at: "asc" }]
  });

  if (sessions.length === 0) {
    throw new Error("No matching sessions found.");
  }

  const sessionPublicIds = sessions.map((session) => session.session_public_id);
  const operations = await prisma.assessmentLifecycleOperation.findMany({
    where: {
      OR: [
        { target_session_public_id: { in: sessionPublicIds } },
        { resulting_session_public_id: { in: sessionPublicIds } },
        { target_assessment_public_id: sessions[0]?.assessment.assessment_public_id }
      ]
    },
    select: {
      operation_public_id: true,
      command_type: true,
      actor_type: true,
      target_session_public_id: true,
      requested_at: true,
      mutation_committed: true,
      resulting_session_public_id: true,
      resulting_attempt_number: true,
      resulting_canonical_status: true,
      already_satisfied: true,
      recovered: true,
      safe_failure_stage: true,
      safe_failure_code: true,
      http_status: true,
      safe_response_code: true,
      completed_at: true
    },
    orderBy: { requested_at: "asc" }
  });

  console.log(
    JSON.stringify(
      {
        status: "audited",
        student_user_id: studentUserId,
        assessment_public_id: sessions[0]?.assessment.assessment_public_id,
        assessment_title: sessions[0]?.assessment.title,
        attempt_count: sessions.length,
        operation_count: operations.length,
        attempts: sessions.map((session) => {
          const lifecycle = resolveCanonicalAttemptLifecycle(session);
          return {
            session_public_id: session.session_public_id,
            attempt_number: session.attempt_number,
            created_at: session.created_at,
            started_at: session.started_at,
            last_activity_at: session.last_activity_at,
            updated_at: session.updated_at,
            completed_at_present: Boolean(session.completed_at),
            stored_status: session.status,
            current_phase: session.current_phase,
            canonical_status: lifecycle.canonical_status,
            terminal: lifecycle.terminal,
            resumable: lifecycle.resumable,
            can_resume: lifecycle.can_resume,
            can_end: lifecycle.can_end,
            consistency_issues: lifecycle.consistency_issues,
            operations: operations
              .filter(
                (operation) =>
                  operation.target_session_public_id === session.session_public_id ||
                  operation.resulting_session_public_id === session.session_public_id
              )
              .map((operation) => ({
                operation_public_id: operation.operation_public_id,
                command_type: operation.command_type,
                actor_type: operation.actor_type,
                requested_at: operation.requested_at,
                mutation_committed: operation.mutation_committed,
                resulting_attempt_number: operation.resulting_attempt_number,
                resulting_canonical_status: operation.resulting_canonical_status,
                already_satisfied: operation.already_satisfied,
                recovered: operation.recovered,
                safe_failure_stage: operation.safe_failure_stage,
                safe_failure_code: operation.safe_failure_code,
                http_status: operation.http_status,
                safe_response_code: operation.safe_response_code,
                completed_at: operation.completed_at
              }))
          };
        })
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
