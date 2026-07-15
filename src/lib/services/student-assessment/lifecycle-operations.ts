import { Prisma } from "@prisma/client";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import type { AttemptLifecycleResolution } from "@/lib/services/student-assessment/attempt-lifecycle";

export const LIFECYCLE_OPERATION_RESULT_VERSION = "assessment-lifecycle-operation-result-v1" as const;

export type LifecycleCommandType =
  | "start_attempt"
  | "resume_attempt"
  | "pause_attempt"
  | "end_attempt"
  | "teacher_end_attempt";

export type LifecycleCanonicalDestination = "session" | "assessment_list" | "none";

export type LifecycleCommandResult = {
  result_version: typeof LIFECYCLE_OPERATION_RESULT_VERSION;
  operation_public_id: string;
  command_type: LifecycleCommandType;
  command_succeeded: boolean;
  mutation_committed: boolean;
  already_satisfied: boolean;
  recovered: boolean;
  session_public_id: string | null;
  attempt_number: number | null;
  canonical_status: string | null;
  canonical_destination: LifecycleCanonicalDestination;
  presenter_ready: boolean;
  recovery_required: boolean;
  safe_warning: string | null;
  safe_response_code: string;
};

export type CreateLifecycleOperationInput = {
  command_type: LifecycleCommandType;
  actor_type: "student" | "teacher";
  target_assessment_public_id?: string | null;
  target_session_public_id?: string | null;
  request_id?: string | null;
  prior_lifecycle?: AttemptLifecycleResolution | null;
  resulting_lifecycle: AttemptLifecycleResolution;
  resulting_session_public_id: string;
  resulting_attempt_number: number;
  assessment_session_db_id: string;
  mutation_committed?: boolean;
  already_satisfied?: boolean;
  recovered?: boolean;
  canonical_destination: LifecycleCanonicalDestination;
  safe_response_code: string;
};

export type LifecycleOperationRecord = Awaited<ReturnType<typeof createCommittedLifecycleOperation>>;

export function safePostCommitFailureCode(error: unknown): string {
  if (error instanceof Error) {
    if (error.name) {
      return error.name;
    }
    return "post_commit_error";
  }

  return "unknown_post_commit_error";
}

function commandResult(input: {
  operation_public_id: string;
  command_type: LifecycleCommandType;
  mutation_committed: boolean;
  already_satisfied: boolean;
  recovered: boolean;
  session_public_id: string | null;
  attempt_number: number | null;
  canonical_status: string | null;
  canonical_destination: LifecycleCanonicalDestination;
  presenter_ready: boolean;
  recovery_required: boolean;
  safe_warning: string | null;
  safe_response_code: string;
}): LifecycleCommandResult {
  return {
    result_version: LIFECYCLE_OPERATION_RESULT_VERSION,
    operation_public_id: input.operation_public_id,
    command_type: input.command_type,
    command_succeeded: true,
    mutation_committed: input.mutation_committed,
    already_satisfied: input.already_satisfied,
    recovered: input.recovered,
    session_public_id: input.session_public_id,
    attempt_number: input.attempt_number,
    canonical_status: input.canonical_status,
    canonical_destination: input.canonical_destination,
    presenter_ready: input.presenter_ready,
    recovery_required: input.recovery_required,
    safe_warning: input.safe_warning,
    safe_response_code: input.safe_response_code
  };
}

export async function createCommittedLifecycleOperation(
  tx: Prisma.TransactionClient,
  input: CreateLifecycleOperationInput
) {
  const operationPublicId = generatePublicId("attempt_control");
  const result = commandResult({
    operation_public_id: operationPublicId,
    command_type: input.command_type,
    mutation_committed: input.mutation_committed ?? true,
    already_satisfied: input.already_satisfied ?? false,
    recovered: input.recovered ?? false,
    session_public_id: input.resulting_session_public_id,
    attempt_number: input.resulting_attempt_number,
    canonical_status: input.resulting_lifecycle.canonical_status,
    canonical_destination: input.canonical_destination,
    presenter_ready: true,
    recovery_required: false,
    safe_warning: null,
    safe_response_code: input.safe_response_code
  });

  await tx.assessmentLifecycleOperation.create({
    data: {
      operation_public_id: operationPublicId,
      command_type: input.command_type,
      actor_type: input.actor_type,
      target_assessment_public_id: input.target_assessment_public_id ?? null,
      target_session_public_id: input.target_session_public_id ?? null,
      request_id: input.request_id ?? null,
      prior_canonical_status: input.prior_lifecycle?.canonical_status ?? null,
      prior_lifecycle_version: input.prior_lifecycle?.lifecycle_version ?? null,
      mutation_committed: input.mutation_committed ?? true,
      resulting_session_public_id: input.resulting_session_public_id,
      resulting_attempt_number: input.resulting_attempt_number,
      resulting_canonical_status: input.resulting_lifecycle.canonical_status,
      already_satisfied: input.already_satisfied ?? false,
      recovered: input.recovered ?? false,
      safe_response_code: input.safe_response_code,
      http_status: 200,
      response_payload: toPrismaJson(result),
      completed_at: new Date(),
      assessment_session_db_id: input.assessment_session_db_id
    }
  });

  return result;
}

export async function markLifecycleOperationPostCommitWarning(input: {
  prisma: Pick<Prisma.TransactionClient, "assessmentLifecycleOperation">;
  operation_public_id: string;
  result: LifecycleCommandResult;
  safe_failure_stage: string;
  safe_failure_code: string;
}) {
  const warned = commandResult({
    ...input.result,
    presenter_ready: false,
    recovery_required: true,
    safe_warning: input.safe_failure_stage,
    safe_response_code: "committed_presenter_recovery_required"
  });

  await input.prisma.assessmentLifecycleOperation.update({
    where: { operation_public_id: input.operation_public_id },
    data: {
      safe_failure_stage: input.safe_failure_stage,
      safe_failure_code: input.safe_failure_code,
      safe_response_code: warned.safe_response_code,
      http_status: 200,
      response_payload: toPrismaJson(warned),
      completed_at: new Date()
    }
  });

  return warned;
}
