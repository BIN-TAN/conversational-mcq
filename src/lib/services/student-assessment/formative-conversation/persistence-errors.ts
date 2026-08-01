import { Prisma } from "@prisma/client";

export const FORMATIVE_CONVERSATION_PERSISTENCE_CONTRACT_VERSION =
  "formative-conversation-persistence-contract-v2" as const;

export const FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 30_000
} as const;

export type FormativeConversationPersistenceOperation =
  | "context_read"
  | "conversation_creation"
  | "message_reservation"
  | "assistant_response_persistence"
  | "transition_persistence"
  | "lifecycle_persistence"
  | "evidence_reference_persistence"
  | "transition_reconciliation"
  | "database_reconnect"
  | "finalization";

export type FormativeConversationPersistenceFailureCategory =
  | "context_read_connection_closed"
  | "context_read_retry_exhausted"
  | "context_read_failed"
  | "conversation_creation_failed"
  | "transaction_expired"
  | "database_connection_closed"
  | "database_reconnect_failed"
  | "message_reservation_failed"
  | "assistant_response_persistence_failed"
  | "transition_persistence_failed"
  | "transition_reconciliation_failed"
  | "lifecycle_persistence_failed"
  | "evidence_reference_persistence_failed"
  | "finalization_failed";

export type FormativeConversationPersistenceFailureMetadata = {
  logical_operation_id?: string | null;
  attempt_number?: number;
  mutation_may_have_occurred?: boolean;
  reconciliation_ran?: boolean;
  retry_permitted?: boolean;
  terminal_result?:
    | "failed"
    | "retrying"
    | "reconciled"
    | "retry_exhausted";
};

const FALLBACK_CATEGORY_BY_OPERATION = {
  context_read: "context_read_failed",
  conversation_creation: "conversation_creation_failed",
  message_reservation: "message_reservation_failed",
  assistant_response_persistence:
    "assistant_response_persistence_failed",
  transition_persistence: "transition_persistence_failed",
  lifecycle_persistence: "lifecycle_persistence_failed",
  evidence_reference_persistence: "evidence_reference_persistence_failed",
  transition_reconciliation: "transition_reconciliation_failed",
  database_reconnect: "database_reconnect_failed",
  finalization: "finalization_failed"
} as const satisfies Record<
  FormativeConversationPersistenceOperation,
  FormativeConversationPersistenceFailureCategory
>;

export class FormativeConversationPersistenceError extends Error {
  public readonly logical_operation_id: string | null;
  public readonly attempt_number: number;
  public readonly mutation_may_have_occurred: boolean;
  public readonly reconciliation_ran: boolean;
  public readonly retry_permitted: boolean;
  public readonly terminal_result:
    | "failed"
    | "retrying"
    | "reconciled"
    | "retry_exhausted";

  constructor(
    public readonly category: FormativeConversationPersistenceFailureCategory,
    public readonly operation: FormativeConversationPersistenceOperation,
    public readonly cause_code: string | null,
    public readonly retryable: boolean,
    metadata: FormativeConversationPersistenceFailureMetadata = {}
  ) {
    super(category);
    this.name = "FormativeConversationPersistenceError";
    this.logical_operation_id = metadata.logical_operation_id ?? null;
    this.attempt_number = metadata.attempt_number ?? 1;
    this.mutation_may_have_occurred =
      metadata.mutation_may_have_occurred ?? false;
    this.reconciliation_ran = metadata.reconciliation_ran ?? false;
    this.retry_permitted = metadata.retry_permitted ?? retryable;
    this.terminal_result = metadata.terminal_result ?? "failed";
  }
}

function prismaCauseCode(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code;
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return error.errorCode ?? null;
  }
  return null;
}

function normalizedErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.toLowerCase() : "";
}

export function formativeConversationDatabaseConnectionClosed(
  error: unknown
) {
  const causeCode = prismaCauseCode(error);
  const message = normalizedErrorMessage(error);
  return (
    causeCode === "P1017" ||
    message.includes("server has closed the connection") ||
    message.includes("connection closed") ||
    message.includes("closed database connection") ||
    (message.includes("postgresql connection") &&
      message.includes("closed")) ||
    message.includes("kind: closed") ||
    message.includes("connection reset by peer") ||
    message.includes("socket hang up")
  );
}

export function formativeConversationPersistenceError(
  error: unknown,
  operation: FormativeConversationPersistenceOperation,
  metadata: FormativeConversationPersistenceFailureMetadata = {}
) {
  if (error instanceof FormativeConversationPersistenceError) {
    return error;
  }

  const causeCode = prismaCauseCode(error);
  const message = normalizedErrorMessage(error);
  const transactionExpired =
    causeCode === "P2028" ||
    causeCode === "P1008" ||
    message.includes("transaction is no longer valid") ||
    message.includes("transaction already closed") ||
    message.includes("transaction has expired");
  if (transactionExpired) {
    return new FormativeConversationPersistenceError(
      "transaction_expired",
      operation,
      causeCode,
      true,
      metadata
    );
  }

  const connectionClosed =
    formativeConversationDatabaseConnectionClosed(error);
  if (connectionClosed) {
    return new FormativeConversationPersistenceError(
      operation === "context_read"
        ? "context_read_connection_closed"
        : "database_connection_closed",
      operation,
      causeCode,
      true,
      metadata
    );
  }

  return new FormativeConversationPersistenceError(
    FALLBACK_CATEGORY_BY_OPERATION[operation],
    operation,
    causeCode,
    operation === "context_read",
    metadata
  );
}
