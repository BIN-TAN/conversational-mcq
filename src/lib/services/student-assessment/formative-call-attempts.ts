import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { StudentAssessmentServiceError } from "./errors";

export function latestFormativeCallAttempt(key: string, client: Prisma.TransactionClient = prisma) {
  return client.agentCall.findFirst({
    where: { OR: [{ agent_invocation_key: key }, { agent_invocation_key: { startsWith: `${key}:retry:` } }] },
    orderBy: { agent_invocation_key: "desc" }
  });
}

export async function reserveFormativeCallAttempt(data: Prisma.AgentCallUncheckedCreateInput & {
  agent_invocation_key: string;
  concept_unit_session_db_id: string;
}) {
  return prisma.$transaction(async tx => {
    // Reserve under a short topic-session lock; never hold a database lock during an AI call.
    await tx.$queryRaw`SELECT id FROM concept_unit_sessions WHERE id = ${data.concept_unit_session_db_id}::uuid FOR UPDATE`;
    const prior = await latestFormativeCallAttempt(data.agent_invocation_key, tx);
    if (prior && (prior.assessment_session_db_id !== data.assessment_session_db_id ||
        prior.concept_unit_session_db_id !== data.concept_unit_session_db_id || prior.agent_name !== data.agent_name)) {
      throw new StudentAssessmentServiceError("idempotency_conflict", "Preparation evidence does not match the existing operation.", 409);
    }
    if (prior && !["failed", "invalid_output"].includes(prior.call_status)) {
      return { call: prior, created: false };
    }
    const priorIndex = prior?.agent_invocation_key === data.agent_invocation_key ? 0
      : Number(prior?.agent_invocation_key?.split(":retry:").at(-1) ?? 0);
    if (!Number.isSafeInteger(priorIndex) || priorIndex < 0 || priorIndex >= 99_999_999) {
      throw new StudentAssessmentServiceError("idempotency_conflict", "Preparation retry history needs review.", 409);
    }
    const key = prior ? `${data.agent_invocation_key}:retry:${String(priorIndex + 1).padStart(8, "0")}` : data.agent_invocation_key;
    const call = await tx.agentCall.create({ data: { ...data, agent_invocation_key: key } });
    return { call, created: true };
  });
}

export async function recordUnexpectedFormativeCallFailure(callId: string) {
  // Retain earlier outcomes and never put exception text or provider payloads in this diagnostic.
  await prisma.agentCall.updateMany({ where: { id: callId, call_status: "started" }, data: {
    call_status: "failed", output_validated: false, error_category: "provider_execution_interrupted",
    validation_error: "The provider execution did not complete normally.", completed_at: new Date()
  } });
}
