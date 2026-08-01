import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  FormativeConversationPersistenceError,
  formativeConversationDatabaseConnectionClosed,
  formativeConversationPersistenceError
} from "@/lib/services/student-assessment/formative-conversation/persistence-errors";
import {
  FORMATIVE_CONVERSATION_PERSISTENCE_OBSERVABILITY_VERSION,
  measureFormativeConversationPersistencePhase,
  recordFormativeConversationPersistenceDiagnostic,
  type FormativeConversationPersistenceDiagnostic
} from "@/lib/services/student-assessment/formative-conversation/persistence-observability";

export const EVALUATION_DATABASE_CONNECTION_OWNER_VERSION =
  "evaluation-database-connection-owner-v1" as const;
export const EVALUATION_DATABASE_READ_RECOVERY_VERSION =
  "evaluation-database-read-recovery-v1" as const;

type EvaluationOwnedPrismaClient = Pick<
  PrismaClient,
  "$connect" | "$disconnect"
>;

export type EvaluationDatabaseReadOperation = {
  operation_name: string;
  logical_operation_id: string;
};

export type EvaluationDatabaseWriteReconciliation<T> =
  | { status: "committed"; value: T }
  | { status: "not_committed" };

export type EvaluationDatabaseConnectionOwner = ReturnType<
  typeof createEvaluationDatabaseConnectionOwner
>;

export function createEvaluationDatabaseConnectionOwner(input: {
  client: EvaluationOwnedPrismaClient;
  max_read_attempts?: number;
  client_id?: string;
  on_diagnostic?: (
    diagnostic: FormativeConversationPersistenceDiagnostic
  ) => void;
}) {
  const maxReadAttempts = input.max_read_attempts ?? 2;
  if (!Number.isInteger(maxReadAttempts) || maxReadAttempts < 1) {
    throw new Error("evaluation_database_read_attempt_limit_invalid");
  }

  const clientId =
    input.client_id ?? `evaluation-prisma-${randomUUID()}`;
  let clientGeneration = 1;
  let finalDisconnectStarted = false;
  let finalDisconnectCompleted = false;
  let reconnectCount = 0;

  const identity = () => ({
    client_id: clientId,
    client_generation: clientGeneration
  });

  const reconnect = async (logicalOperationId: string) => {
    const reconnectAttempt = reconnectCount + 1;
    await measureFormativeConversationPersistencePhase({
      operation_name: "evaluation_database_reconnect",
      logical_operation_id: logicalOperationId,
      operation_kind: "reconciliation",
      phase: "database_reconnect",
      attempt_number: reconnectAttempt,
      mutation_may_have_occurred: false,
      reconciliation_ran: true,
      retry_permitted: false,
      execute: async () => {
        try {
          await input.client.$disconnect();
        } catch {
          // A failed connection may already be detached. The subsequent
          // explicit connect is the authoritative recovery check.
        }
        clientGeneration += 1;
        try {
          await input.client.$connect();
        } catch (error) {
          throw formativeConversationPersistenceError(
            error,
            "database_reconnect",
            {
              logical_operation_id: logicalOperationId,
              attempt_number: reconnectAttempt,
              mutation_may_have_occurred: false,
              reconciliation_ran: true,
              retry_permitted: false,
              terminal_result: "failed"
            }
          );
        }
        reconnectCount += 1;
      }
    });
  };

  const runRead = async <T>(
    operation: EvaluationDatabaseReadOperation,
    execute: () => Promise<T>
  ): Promise<T> => {
    for (
      let attemptNumber = 1;
      attemptNumber <= maxReadAttempts;
      attemptNumber += 1
    ) {
      try {
        return await measureFormativeConversationPersistencePhase({
          operation_name: operation.operation_name,
          logical_operation_id: operation.logical_operation_id,
          operation_kind: "read",
          phase: "context_read",
          attempt_number: attemptNumber,
          mutation_may_have_occurred: false,
          reconciliation_ran: attemptNumber > 1,
          retry_permitted: attemptNumber < maxReadAttempts,
          execute
        });
      } catch (error) {
        const connectionClosed =
          formativeConversationDatabaseConnectionClosed(error) ||
          (error instanceof FormativeConversationPersistenceError &&
            (error.category === "context_read_connection_closed" ||
              error.category === "database_connection_closed"));
        if (!connectionClosed) {
          throw formativeConversationPersistenceError(
            error,
            "context_read",
            {
              logical_operation_id: operation.logical_operation_id,
              attempt_number: attemptNumber,
              mutation_may_have_occurred: false,
              reconciliation_ran: false,
              retry_permitted: false,
              terminal_result: "failed"
            }
          );
        }
        if (attemptNumber >= maxReadAttempts) {
          throw new FormativeConversationPersistenceError(
            "context_read_retry_exhausted",
            "context_read",
            error instanceof FormativeConversationPersistenceError
              ? error.cause_code
              : null,
            false,
            {
              logical_operation_id: operation.logical_operation_id,
              attempt_number: attemptNumber,
              mutation_may_have_occurred: false,
              reconciliation_ran: true,
              retry_permitted: false,
              terminal_result: "retry_exhausted"
            }
          );
        }
        const failedIdentity = identity();
        recordFormativeConversationPersistenceDiagnostic({
          diagnostic_version:
            FORMATIVE_CONVERSATION_PERSISTENCE_OBSERVABILITY_VERSION,
          operation_name: operation.operation_name,
          logical_operation_id: operation.logical_operation_id,
          operation_kind: "read",
          phase: "context_read",
          attempt_number: attemptNumber,
          client_id: failedIdentity.client_id,
          client_generation: failedIdentity.client_generation,
          pool_state: "opaque_prisma_pool",
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: 0,
          transaction_timeout_ms: null,
          duration_status: "failed",
          failure_category: "context_read_connection_closed",
          cause_code:
            error instanceof FormativeConversationPersistenceError
              ? error.cause_code
              : null,
          mutation_may_have_occurred: false,
          reconciliation_ran: false,
          retry_permitted: true,
          terminal_result: "retrying"
        });
        await reconnect(operation.logical_operation_id);
      }
    }
    throw new Error("evaluation_database_read_loop_unreachable");
  };

  const runIdempotentWrite = async <T>(input: {
    operation_name: string;
    logical_operation_id: string;
    execute: () => Promise<T>;
    reconcile: () => Promise<EvaluationDatabaseWriteReconciliation<T>>;
  }): Promise<T> => {
    const maxWriteAttempts = 2;
    for (
      let attemptNumber = 1;
      attemptNumber <= maxWriteAttempts;
      attemptNumber += 1
    ) {
      try {
        return await measureFormativeConversationPersistencePhase({
          operation_name: input.operation_name,
          logical_operation_id: input.logical_operation_id,
          operation_kind: "write",
          phase: "write_operation",
          attempt_number: attemptNumber,
          mutation_may_have_occurred: true,
          reconciliation_ran: attemptNumber > 1,
          retry_permitted: attemptNumber < maxWriteAttempts,
          execute: input.execute
        });
      } catch (error) {
        const connectionClosed =
          formativeConversationDatabaseConnectionClosed(error) ||
          (error instanceof FormativeConversationPersistenceError &&
            (error.category === "database_connection_closed" ||
              error.category === "context_read_connection_closed"));
        if (!connectionClosed) {
          throw error;
        }

        await reconnect(input.logical_operation_id);
        const reconciliation =
          await measureFormativeConversationPersistencePhase({
            operation_name: input.operation_name,
            logical_operation_id: input.logical_operation_id,
            operation_kind: "reconciliation",
            phase: "post_transaction_reconciliation",
            attempt_number: attemptNumber,
            mutation_may_have_occurred: true,
            reconciliation_ran: true,
            retry_permitted: false,
            execute: input.reconcile
          });
        if (reconciliation.status === "committed") {
          return reconciliation.value;
        }
        if (attemptNumber >= maxWriteAttempts) {
          throw new FormativeConversationPersistenceError(
            "database_connection_closed",
            "finalization",
            error instanceof FormativeConversationPersistenceError
              ? error.cause_code
              : null,
            false,
            {
              logical_operation_id: input.logical_operation_id,
              attempt_number: attemptNumber,
              mutation_may_have_occurred: true,
              reconciliation_ran: true,
              retry_permitted: false,
              terminal_result: "retry_exhausted"
            }
          );
        }
      }
    }
    throw new Error("evaluation_database_write_loop_unreachable");
  };

  const disconnectFinal = async () => {
    if (finalDisconnectStarted) {
      throw new Error("evaluation_database_final_disconnect_duplicate");
    }
    finalDisconnectStarted = true;
    await input.client.$disconnect();
    finalDisconnectCompleted = true;
  };

  return {
    owner_version: EVALUATION_DATABASE_CONNECTION_OWNER_VERSION,
    recovery_version: EVALUATION_DATABASE_READ_RECOVERY_VERSION,
    identity,
    record_diagnostic: input.on_diagnostic ?? (() => undefined),
    run_read: runRead,
    run_idempotent_write: runIdempotentWrite,
    disconnect_final: disconnectFinal,
    state: () => ({
      client_id: clientId,
      client_generation: clientGeneration,
      reconnect_count: reconnectCount,
      max_read_attempts: maxReadAttempts,
      final_disconnect_started: finalDisconnectStarted,
      final_disconnect_completed: finalDisconnectCompleted,
      pool_state: "opaque_prisma_pool" as const
    })
  };
}
