import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import { stableHash, readActiveApprovedOperationalRuntimeConfig } from "./approved-config";

export type OperationalEffectiveStatus =
  | "not_run"
  | "blocked"
  | "succeeded"
  | "failed"
  | "invalid_output"
  | "semantic_validation_failed"
  | "fallback_applied";

export type PersistOperationalEffectiveResultInput = {
  agent_call_db_id?: string | null;
  agent_name: string;
  operational_context_type: string;
  operational_context_public_id: string;
  invocation_key: string;
  deterministic_guard_version?: string | null;
  canonicalization_version?: string | null;
  fallback_version?: string | null;
  raw_output_status: string;
  raw_semantic_status: string;
  raw_safety_status?: string;
  effective_semantic_status: string;
  effective_safety_status?: string;
  effective_overall_status: string;
  effective_student_facing_usable: boolean;
  effective_workflow_usable: boolean;
  deterministic_guard_applied?: boolean;
  canonicalization_applied?: boolean;
  fallback_applied?: boolean;
  effective_output: unknown;
  effective_actions?: unknown;
  warnings?: string[];
  prismaClient?: PrismaClient;
};

function prismaJson(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

export async function persistOperationalEffectiveResult(
  input: PersistOperationalEffectiveResultInput
) {
  const db = input.prismaClient ?? prisma;
  const manifest = readActiveApprovedOperationalRuntimeConfig();
  const effectiveResultHash = stableHash({
    agent_name: input.agent_name,
    operational_context_type: input.operational_context_type,
    operational_context_public_id: input.operational_context_public_id,
    invocation_key: input.invocation_key,
    effective_result_version: manifest.effective_result_version,
    effective_validator_version: manifest.effective_validator_version,
    effective_output: input.effective_output,
    effective_actions: input.effective_actions ?? {}
  });
  const existing = await db.operationalAgentEffectiveResult.findUnique({
    where: {
      invocation_key_effective_result_version: {
        invocation_key: input.invocation_key,
        effective_result_version: manifest.effective_result_version
      }
    }
  });

  if (existing) {
    return existing;
  }

  return db.operationalAgentEffectiveResult.create({
    data: {
      public_id: generatePublicId("operational_effective_result"),
      agent_call_db_id: input.agent_call_db_id ?? null,
      agent_name: input.agent_name,
      operational_context_type: input.operational_context_type,
      operational_context_public_id: input.operational_context_public_id,
      invocation_key: input.invocation_key,
      effective_result_version: manifest.effective_result_version,
      effective_validator_version: manifest.effective_validator_version,
      deterministic_guard_version: input.deterministic_guard_version ?? null,
      canonicalization_version: input.canonicalization_version ?? null,
      fallback_version: input.fallback_version ?? null,
      raw_output_status: input.raw_output_status,
      raw_semantic_status: input.raw_semantic_status,
      raw_safety_status: input.raw_safety_status ?? "not_run",
      effective_semantic_status: input.effective_semantic_status,
      effective_safety_status: input.effective_safety_status ?? "pass",
      effective_overall_status: input.effective_overall_status,
      effective_student_facing_usable: input.effective_student_facing_usable,
      effective_workflow_usable: input.effective_workflow_usable,
      deterministic_guard_applied: input.deterministic_guard_applied ?? false,
      canonicalization_applied: input.canonicalization_applied ?? false,
      fallback_applied: input.fallback_applied ?? false,
      effective_output_json: prismaJson(input.effective_output),
      effective_actions_json: prismaJson(input.effective_actions ?? {}),
      warnings_json: prismaJson(input.warnings ?? []),
      effective_result_hash: effectiveResultHash
    }
  });
}
