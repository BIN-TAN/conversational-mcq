import { Prisma } from "@prisma/client";

export const FORMATIVE_CONVERSATION_PERSISTENCE_CONTRACT_VERSION =
  "formative-conversation-persistence-contract-v1" as const;

export const FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 30_000
} as const;

export type FormativeConversationPersistenceOperation =
  | "conversation_creation"
  | "transition_persistence"
  | "lifecycle_persistence"
  | "evidence_reference_persistence"
  | "finalization";

export type FormativeConversationPersistenceFailureCategory =
  | "conversation_creation_failed"
  | "transaction_expired"
  | "database_connection_closed"
  | "transition_persistence_failed"
  | "lifecycle_persistence_failed"
  | "evidence_reference_persistence_failed"
  | "finalization_failed";

const FALLBACK_CATEGORY_BY_OPERATION = {
  conversation_creation: "conversation_creation_failed",
  transition_persistence: "transition_persistence_failed",
  lifecycle_persistence: "lifecycle_persistence_failed",
  evidence_reference_persistence: "evidence_reference_persistence_failed",
  finalization: "finalization_failed"
} as const satisfies Record<
  FormativeConversationPersistenceOperation,
  FormativeConversationPersistenceFailureCategory
>;

export class FormativeConversationPersistenceError extends Error {
  constructor(
    public readonly category: FormativeConversationPersistenceFailureCategory,
    public readonly operation: FormativeConversationPersistenceOperation,
    public readonly cause_code: string | null,
    public readonly retryable: boolean
  ) {
    super(category);
    this.name = "FormativeConversationPersistenceError";
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

export function formativeConversationPersistenceError(
  error: unknown,
  operation: FormativeConversationPersistenceOperation
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
      true
    );
  }

  const connectionClosed =
    causeCode === "P1017" ||
    message.includes("server has closed the connection") ||
    message.includes("connection closed") ||
    message.includes("closed database connection");
  if (connectionClosed) {
    return new FormativeConversationPersistenceError(
      "database_connection_closed",
      operation,
      causeCode,
      true
    );
  }

  return new FormativeConversationPersistenceError(
    FALLBACK_CATEGORY_BY_OPERATION[operation],
    operation,
    causeCode,
    true
  );
}
