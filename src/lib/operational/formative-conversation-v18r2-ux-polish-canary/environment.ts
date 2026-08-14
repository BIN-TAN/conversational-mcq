import { prisma } from "@/lib/db";
import {
  resolveFormativeConversationV5ApplicationReadiness,
  validateFormativeConversationV5LiveEnvironment
} from "@/lib/operational/formative-conversation-v5-evaluation-v18r2/live-environment";
import type { FormativeConversationV18CandidateConfiguration } from "@/lib/operational/formative-conversation-v5-evaluation-v18r2/package";
import type { V18R2UxPolishCanaryPackage } from "./package";

function assertCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

export function validateV18R2UxCanaryLiveEnvironment(input: {
  loaded: V18R2UxPolishCanaryPackage;
  env: NodeJS.ProcessEnv;
  expected_deployed_git_sha: string;
}) {
  assertCondition(
    /^[a-f0-9]{40}$/u.test(input.expected_deployed_git_sha),
    "v18r2_ux_canary_expected_deployed_git_sha_invalid"
  );
  assertCondition(
    input.env.RENDER_GIT_COMMIT === input.expected_deployed_git_sha,
    "v18r2_ux_canary_deployed_git_sha_mismatch"
  );
  assertCondition(
    input.env.FORMATIVE_CONVERSATION_V18R2_UX_CANARY_LIVE_EVALUATION_ENABLED ===
      "true",
    "v18r2_ux_canary_live_evaluation_not_enabled"
  );
  const candidate =
    input.loaded.source_candidate as unknown as FormativeConversationV18CandidateConfiguration;
  const expectedActive = String(
    input.loaded.source_configuration.active_runtime_hash
  );
  const expectedRollback = String(
    input.loaded.source_configuration.rollback_runtime_hash
  );
  const environment = validateFormativeConversationV5LiveEnvironment({
    env: input.env,
    candidate,
    runtime_candidate_hash: input.loaded.runtime_candidate_hash,
    expected_active_runtime_hash: expectedActive,
    expected_rollback_runtime_hash: expectedRollback,
    allowed_environment_sources: ["render_process_local", "render_runtime"]
  });
  const readiness = resolveFormativeConversationV5ApplicationReadiness({
    env: input.env,
    candidate,
    runtime_candidate_hash: input.loaded.runtime_candidate_hash,
    expected_active_runtime_hash: expectedActive,
    expected_rollback_runtime_hash: expectedRollback,
    allowed_environment_sources: ["render_process_local", "render_runtime"]
  });
  assertCondition(
    readiness.runtime_assertions.model_name === "gpt-5.6-sol" &&
      readiness.runtime_assertions.reasoning_effort === "medium" &&
      readiness.runtime_assertions.max_output_tokens === 7_000 &&
      readiness.runtime_assertions.formative_conversation_live_calls_enabled ===
        true,
    "v18r2_ux_canary_formative_configuration_mismatch"
  );
  return {
    environment,
    readiness,
    deployed_git_sha: input.expected_deployed_git_sha,
    candidate_runtime_hash: input.loaded.runtime_candidate_hash,
    candidate_protocol_hash: input.loaded.protocol_hash,
    provider_calls: 0,
    model_auth_requests: 0
  } as const;
}

export async function verifyV18R2UxCanaryDatabaseReadiness() {
  const connectivity = await prisma.$queryRaw<Array<{ ready: number }>>`
    SELECT 1::int AS ready
  `;
  const migrations = await prisma.$queryRaw<Array<{ migration_count: bigint }>>`
    SELECT COUNT(*)::bigint AS migration_count
    FROM "_prisma_migrations"
    WHERE "finished_at" IS NOT NULL
      AND "rolled_back_at" IS NULL
  `;
  const migrationCount = Number(migrations[0]?.migration_count ?? -1);
  assertCondition(
    connectivity[0]?.ready === 1,
    "v18r2_ux_canary_database_unreachable"
  );
  assertCondition(
    migrationCount === 60,
    "v18r2_ux_canary_migration_count_mismatch"
  );
  return {
    database_reachable: true,
    schema_ready: true,
    migration_count: migrationCount,
    migrations_current: true,
    migrations_run: false
  } as const;
}
