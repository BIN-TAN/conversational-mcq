import { Prisma, PrismaClient } from "@prisma/client";
import {
  planAttemptLifecycleReconciliation,
  resolveCanonicalAttemptLifecycle
} from "../src/lib/services/student-assessment/attempt-lifecycle";
import { logProcessEvent } from "../src/lib/services/process-events";

const prisma = new PrismaClient();

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const sessionPublicId = argValue("--session-public-id") ?? argValue("--session");
  const confirmRepair = process.argv.includes("--confirm-repair");

  if (!sessionPublicId) {
    throw new Error("Provide --session-public-id.");
  }

  const session = await prisma.assessmentSession.findUnique({
    where: { session_public_id: sessionPublicId },
    select: {
      id: true,
      session_public_id: true,
      status: true,
      current_phase: true,
      resume_phase: true,
      resume_context: true,
      completed_at: true,
      updated_at: true
    }
  });

  if (!session) {
    throw new Error("Session was not found.");
  }

  const lifecycleBefore = resolveCanonicalAttemptLifecycle(session);
  const plan = planAttemptLifecycleReconciliation(session);

  if (!plan.safe_to_apply || plan.action === "none") {
    console.log(
      JSON.stringify(
        {
          status: "no_safe_repair_available",
          session_public_id: session.session_public_id,
          canonical_lifecycle: lifecycleBefore,
          safe_repair_plan: plan
        },
        null,
        2
      )
    );
    return;
  }

  if (!confirmRepair) {
    console.log(
      JSON.stringify(
        {
          status: "repair_confirmation_required",
          session_public_id: session.session_public_id,
          canonical_lifecycle: lifecycleBefore,
          safe_repair_plan: plan,
          required_flag: "--confirm-repair"
        },
        null,
        2
      )
    );
    return;
  }

  if (plan.action === "clear_stale_resume_fields") {
    const now = new Date();
    await prisma.assessmentSession.update({
      where: { id: session.id },
      data: {
        resume_phase: null,
        resume_context: Prisma.JsonNull,
        last_activity_at: now
      }
    });
    await logProcessEvent({
      assessment_session_db_id: session.id,
      event_type: "attempt_state_reconciled",
      event_category: "attempt_lifecycle",
      event_source: "backend",
      payload: {
        reconciliation_action: "clear_stale_resume_fields",
        prior_lifecycle_version: lifecycleBefore.lifecycle_version,
        reason: plan.reason
      },
      occurred_at: now
    });
  }

  const repaired = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: session.id },
    select: {
      status: true,
      current_phase: true,
      resume_phase: true,
      resume_context: true,
      completed_at: true,
      updated_at: true
    }
  });

  console.log(
    JSON.stringify(
      {
        status: "repaired",
        session_public_id: session.session_public_id,
        action: plan.action,
        canonical_lifecycle_before: lifecycleBefore,
        canonical_lifecycle_after: resolveCanonicalAttemptLifecycle(repaired)
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
