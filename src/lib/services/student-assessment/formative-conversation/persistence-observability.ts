import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

export const FORMATIVE_CONVERSATION_PERSISTENCE_OBSERVABILITY_VERSION =
  "formative-conversation-persistence-observability-v1" as const;

export const FORMATIVE_CONVERSATION_TRANSACTION_WARNING_MS = 25_000;

export type FormativeConversationPersistencePhase =
  | "context_read"
  | "write_operation"
  | "validation"
  | "pre_transaction_read"
  | "transaction"
  | "post_transaction_reconciliation"
  | "post_transaction_telemetry"
  | "teacher_projection"
  | "export_projection"
  | "artifact_generation"
  | "database_reconnect";

export type FormativeConversationPersistenceDiagnostic = {
  diagnostic_version: typeof FORMATIVE_CONVERSATION_PERSISTENCE_OBSERVABILITY_VERSION;
  operation_name: string;
  logical_operation_id: string;
  operation_kind: "read" | "write" | "reconciliation" | "projection";
  phase: FormativeConversationPersistencePhase;
  attempt_number: number;
  client_id: string | null;
  client_generation: number | null;
  pool_state: "opaque_prisma_pool";
  started_at: string;
  completed_at: string;
  duration_ms: number;
  transaction_timeout_ms: number | null;
  duration_status:
    | "within_budget"
    | "warning_threshold_exceeded"
    | "failed";
  failure_category: string | null;
  cause_code: string | null;
  mutation_may_have_occurred: boolean;
  reconciliation_ran: boolean;
  retry_permitted: boolean;
  terminal_result:
    | "succeeded"
    | "failed"
    | "retrying"
    | "reconciled"
    | "retry_exhausted";
};

export type FormativeConversationPersistenceReconciliation<T> =
  | { status: "committed"; value: T }
  | { status: "not_committed" };

type PersistenceReadOperation = {
  operation_name: string;
  logical_operation_id: string;
};

type PersistenceIdempotentWriteOperation<T> =
  PersistenceReadOperation & {
    execute: () => Promise<T>;
    reconcile: () => Promise<
      FormativeConversationPersistenceReconciliation<T>
    >;
  };

type PersistenceDiagnosticScope = {
  record: (
    diagnostic: FormativeConversationPersistenceDiagnostic
  ) => void;
  connection_identity?: () => {
    client_id: string;
    client_generation: number;
  };
  run_read?: <T>(
    operation: PersistenceReadOperation,
    execute: () => Promise<T>
  ) => Promise<T>;
  run_idempotent_write?: <T>(
    operation: PersistenceIdempotentWriteOperation<T>
  ) => Promise<T>;
};

const diagnosticStorage =
  new AsyncLocalStorage<PersistenceDiagnosticScope>();

export function withFormativeConversationPersistenceDiagnostics<T>(
  scope: PersistenceDiagnosticScope,
  operation: () => Promise<T>
) {
  return diagnosticStorage.run(scope, operation);
}

export function currentFormativeConversationConnectionIdentity() {
  return diagnosticStorage.getStore()?.connection_identity?.() ?? null;
}

export function recordFormativeConversationPersistenceDiagnostic(
  diagnostic: FormativeConversationPersistenceDiagnostic
) {
  diagnosticStorage.getStore()?.record(diagnostic);
}

export async function executeFormativeConversationPersistenceRead<T>(input: {
  operation_name: string;
  logical_operation_id: string;
  execute: () => Promise<T>;
}): Promise<T> {
  const scoped = diagnosticStorage.getStore()?.run_read;
  return scoped
    ? scoped<T>(
        {
          operation_name: input.operation_name,
          logical_operation_id: input.logical_operation_id
        },
        input.execute
      )
    : input.execute();
}

export async function executeFormativeConversationIdempotentWrite<T>(
  input: PersistenceIdempotentWriteOperation<T>
): Promise<T> {
  const scoped =
    diagnosticStorage.getStore()?.run_idempotent_write;
  return scoped ? scoped<T>(input) : input.execute();
}

export async function measureFormativeConversationPersistencePhase<T>(input: {
  operation_name: string;
  logical_operation_id: string;
  operation_kind: FormativeConversationPersistenceDiagnostic["operation_kind"];
  phase: FormativeConversationPersistencePhase;
  attempt_number?: number;
  transaction_timeout_ms?: number | null;
  mutation_may_have_occurred?: boolean;
  reconciliation_ran?: boolean;
  retry_permitted?: boolean;
  execute: () => Promise<T>;
}) {
  const startedAt = new Date();
  const startedMonotonic = performance.now();
  try {
    const result = await input.execute();
    const completedAt = new Date();
    const durationMs = Math.max(
      0,
      Math.round(performance.now() - startedMonotonic)
    );
    const identity =
      currentFormativeConversationConnectionIdentity();
    recordFormativeConversationPersistenceDiagnostic({
      diagnostic_version:
        FORMATIVE_CONVERSATION_PERSISTENCE_OBSERVABILITY_VERSION,
      operation_name: input.operation_name,
      logical_operation_id: input.logical_operation_id,
      operation_kind: input.operation_kind,
      phase: input.phase,
      attempt_number: input.attempt_number ?? 1,
      client_id: identity?.client_id ?? null,
      client_generation: identity?.client_generation ?? null,
      pool_state: "opaque_prisma_pool",
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      duration_ms: durationMs,
      transaction_timeout_ms:
        input.transaction_timeout_ms ?? null,
      duration_status:
        input.phase === "transaction" &&
        durationMs >= FORMATIVE_CONVERSATION_TRANSACTION_WARNING_MS
          ? "warning_threshold_exceeded"
          : "within_budget",
      failure_category: null,
      cause_code: null,
      mutation_may_have_occurred:
        input.mutation_may_have_occurred ?? false,
      reconciliation_ran: input.reconciliation_ran ?? false,
      retry_permitted: input.retry_permitted ?? false,
      terminal_result: "succeeded"
    });
    return result;
  } catch (error) {
    const completedAt = new Date();
    const durationMs = Math.max(
      0,
      Math.round(performance.now() - startedMonotonic)
    );
    const identity =
      currentFormativeConversationConnectionIdentity();
    const safeError = error as {
      category?: unknown;
      cause_code?: unknown;
      terminal_result?: unknown;
    };
    recordFormativeConversationPersistenceDiagnostic({
      diagnostic_version:
        FORMATIVE_CONVERSATION_PERSISTENCE_OBSERVABILITY_VERSION,
      operation_name: input.operation_name,
      logical_operation_id: input.logical_operation_id,
      operation_kind: input.operation_kind,
      phase: input.phase,
      attempt_number: input.attempt_number ?? 1,
      client_id: identity?.client_id ?? null,
      client_generation: identity?.client_generation ?? null,
      pool_state: "opaque_prisma_pool",
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      duration_ms: durationMs,
      transaction_timeout_ms:
        input.transaction_timeout_ms ?? null,
      duration_status: "failed",
      failure_category:
        typeof safeError.category === "string"
          ? safeError.category
          : "unclassified_database_failure",
      cause_code:
        typeof safeError.cause_code === "string"
          ? safeError.cause_code
          : null,
      mutation_may_have_occurred:
        input.mutation_may_have_occurred ?? false,
      reconciliation_ran: input.reconciliation_ran ?? false,
      retry_permitted: input.retry_permitted ?? false,
      terminal_result:
        safeError.terminal_result === "retrying" ||
        safeError.terminal_result === "retry_exhausted" ||
        safeError.terminal_result === "reconciled"
          ? safeError.terminal_result
          : "failed"
    });
    throw error;
  }
}
