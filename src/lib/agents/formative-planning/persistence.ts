import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AgentOutputByName } from "@/lib/agents/contracts";
import { toPrismaJson } from "@/lib/services/json";

type FormativePlanningOutput = AgentOutputByName["formative_value_and_planning_agent"];

function json(value: unknown): Prisma.InputJsonValue {
  return (toPrismaJson(value) ?? []) as Prisma.InputJsonValue;
}

export async function persistInitialFormativeDecision(input: {
  concept_unit_session_db_id: string;
  student_profile_db_id: string;
  based_on_agent_call_db_id: string;
  output: FormativePlanningOutput;
}) {
  return prisma.$transaction(async (tx) => {
    const decision = await tx.formativeDecision.create({
      data: {
        concept_unit_session_db_id: input.concept_unit_session_db_id,
        student_profile_db_id: input.student_profile_db_id,
        formative_value: input.output.formative_value,
        formative_action_plan: input.output.formative_action_plan,
        target_evidence: json(input.output.target_evidence),
        success_criteria: json(input.output.success_criteria),
        followup_prompt_constraints: json(input.output.followup_prompt_constraints),
        profile_update_triggers: json(input.output.profile_update_triggers),
        rationale: input.output.rationale,
        mapping_followed: input.output.mapping_followed,
        mapping_deviation_reason: input.output.mapping_deviation_reason,
        based_on_agent_call_db_id: input.based_on_agent_call_db_id
      },
      include: {
        based_on_agent_call: {
          select: {
            agent_name: true,
            provider: true,
            model_name: true,
            agent_version: true,
            prompt_version: true,
            schema_version: true,
            prompt_hash: true,
            retry_count: true,
            call_status: true,
            output_validated: true,
            live_call_allowed: true,
            blocked_reason: true,
            created_at: true,
            completed_at: true
          }
        }
      }
    });

    await tx.conceptUnitSession.update({
      where: { id: input.concept_unit_session_db_id },
      data: {
        latest_formative_decision_db_id: decision.id
      }
    });

    return decision;
  });
}
