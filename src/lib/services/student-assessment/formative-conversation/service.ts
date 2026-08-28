import { createHash } from "node:crypto";
import { Prisma, type AssessmentPhase } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  parseCanonicalMisconceptionClaimCatalog
} from "@/lib/domain/misconception-claim-identity";
import {
  FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID,
  FORMATIVE_CONVERSATION_OPENING_VERSION
} from "./opening-contract";
import {
  FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS,
  formativeConversationPersistenceError
} from "./persistence-errors";
import {
  executeFormativeConversationIdempotentWrite,
  measureFormativeConversationPersistencePhase
} from "./persistence-observability";
import { FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS } from "./lifecycle-contract-v18r2";

export const FORMATIVE_CONVERSATION_CANONICAL_RUNTIME_STATE =
  "FORMATIVE_CONVERSATION" as const;
export const FORMATIVE_CONVERSATION_MAX_STUDENT_TURNS =
  FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS;

export type FormativeConversationFoundationErrorCode =
  | "conversation_session_mismatch"
  | "conversation_profile_mismatch"
  | "conversation_profile_rebind_not_empty"
  | "conversation_profile_rebind_not_canonical"
  | "conversation_not_found"
  | "conversation_not_active"
  | "conversation_turn_limit_reached"
  | "idempotency_hash_mismatch";

export class FormativeConversationFoundationError extends Error {
  constructor(
    public readonly code: FormativeConversationFoundationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "FormativeConversationFoundationError";
  }
}

export type CreateFormativeConversationSessionInput = {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  initial_student_profile_db_id?: string;
  current_student_profile_db_id?: string;
};

export type EmptyFormativeConversationProfileRepairInspection = {
  status: "not_found" | "already_compatible" | "eligible" | "blocked";
  conversation_db_id: string | null;
  profile_db_id: string | null;
  blocking_reasons: string[];
};

export function formativeConversationMessageRequestHash(messageText: string) {
  return createHash("sha256")
    .update(JSON.stringify({ message_text: messageText.trim() }))
    .digest("hex");
}

const messageRequestHash = formativeConversationMessageRequestHash;

function jsonRecord(value: Prisma.JsonValue | null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function openingAttemptFromReceipt(receipt: {
  response_payload: Prisma.JsonValue | null;
}) {
  const attempt = jsonRecord(receipt.response_payload).opening_attempt;
  return typeof attempt === "number" && Number.isInteger(attempt) && attempt > 0
    ? attempt
    : 1;
}

function assistantResponsePayload(input: {
  existing: Prisma.JsonValue | null;
  status: "pending" | "completed" | "failed" | "retrying";
  retry_count: number;
  failure_category?: string | null;
  failed_at?: Date | null;
}) {
  return {
    ...jsonRecord(input.existing),
    assistant_response: {
      status: input.status,
      agent_name: "formative_conversation_agent",
      retry_count: input.retry_count,
      failure_category: input.failure_category ?? null,
      failed_at: input.failed_at?.toISOString() ?? null,
      lifecycle_version:
        "formative-conversation-assistant-response-lifecycle-v1"
    }
  };
}

function isStudentVisiblePayload(value: Prisma.JsonValue | null) {
  return (
    value !== null &&
    !Array.isArray(value) &&
    typeof value === "object" &&
    value.visibility === "student_visible"
  );
}

async function ensureConversationStartedEvent(
  tx: Prisma.TransactionClient,
  session: {
    id: string;
    concept_unit_session_db_id: string;
    started_at: Date;
  }
) {
  const clientEventId = `session-started:${session.concept_unit_session_db_id}`;
  const eventPayload = {
    event_type: "session_started",
    event_source: "backend",
    observed_interval_duration_ms: null,
    client_instance_id: null,
    occurred_at: session.started_at.toISOString()
  };

  const existing =
    await tx.formativeConversationLifecycleEvent.findUnique({
      where: {
        formative_conversation_session_db_id_client_event_id: {
          formative_conversation_session_db_id: session.id,
          client_event_id: clientEventId
        }
      }
    });
  if (existing) {
    return;
  }
  const sequence = await tx.formativeConversationSession.update({
    where: { id: session.id },
    data: {
      telemetry_event_sequence_counter: { increment: 1 }
    },
    select: {
      telemetry_event_sequence_counter: true
    }
  });
  await tx.formativeConversationLifecycleEvent.create({
    data: {
      formative_conversation_session_db_id: session.id,
      conversation_local_event_sequence_index:
        sequence.telemetry_event_sequence_counter,
      client_event_id: clientEventId,
      event_hash: createHash("sha256")
        .update(JSON.stringify(eventPayload))
        .digest("hex"),
      event_type: "session_started",
      event_source: "backend",
      occurred_at: session.started_at
    }
  });
}

async function createConversationStartedEventForNewSession(
  tx: Prisma.TransactionClient,
  session: {
    id: string;
    concept_unit_session_db_id: string;
    started_at: Date;
  }
) {
  const clientEventId = `session-started:${session.concept_unit_session_db_id}`;
  const eventPayload = {
    event_type: "session_started",
    event_source: "backend",
    observed_interval_duration_ms: null,
    client_instance_id: null,
    occurred_at: session.started_at.toISOString()
  };
  await tx.formativeConversationLifecycleEvent.create({
    data: {
      formative_conversation_session_db_id: session.id,
      conversation_local_event_sequence_index: 1,
      client_event_id: clientEventId,
      event_hash: createHash("sha256")
        .update(JSON.stringify(eventPayload))
        .digest("hex"),
      event_type: "session_started",
      event_source: "backend",
      occurred_at: session.started_at
    }
  });
}

function profileSupportsFormativeConversationContext(input: {
  misconception_indicators: Prisma.JsonValue;
}) {
  return Boolean(
    parseCanonicalMisconceptionClaimCatalog(
      input.misconception_indicators
    )
  );
}

function inspectEmptyConversationProfileRepairState(
  conversation: {
    id: string;
    status: string;
    assessment_session_db_id: string;
    initial_student_profile_db_id: string | null;
    current_student_profile_db_id: string | null;
    initial_student_profile: {
      id: string;
      misconception_indicators: Prisma.JsonValue;
    } | null;
    current_student_profile: {
      id: string;
      misconception_indicators: Prisma.JsonValue;
    } | null;
    message_receipts: Array<{
      client_message_id: string;
      status: string;
      student_turn_db_id: string | null;
      assistant_turn_db_id: string | null;
    }>;
    _count: {
      conversation_turns: number;
      agent_calls: number;
      activity_runtime_attempts: number;
      memory_snapshots: number;
      interventions: number;
      review_signals: number;
      turn_telemetry: number;
      input_telemetry: number;
      profile_transitions: number;
      profile_evidence_references: number;
    };
  } | null
): EmptyFormativeConversationProfileRepairInspection {
  if (!conversation) {
    return {
      status: "not_found",
      conversation_db_id: null,
      profile_db_id: null,
      blocking_reasons: ["conversation_not_found"]
    };
  }

  if (
    conversation.initial_student_profile &&
    conversation.current_student_profile_db_id ===
      conversation.initial_student_profile_db_id &&
    profileSupportsFormativeConversationContext({
      misconception_indicators:
        conversation.initial_student_profile.misconception_indicators
    })
  ) {
    return {
      status: "already_compatible",
      conversation_db_id: conversation.id,
      profile_db_id: conversation.initial_student_profile.id,
      blocking_reasons: []
    };
  }

  const blockingReasons: string[] = [];
  if (conversation.status !== "active") {
    blockingReasons.push("conversation_not_active");
  }
  if (conversation._count.conversation_turns > 0) {
    blockingReasons.push("conversation_turns_present");
  }
  if (conversation._count.agent_calls > 0) {
    blockingReasons.push("conversation_agent_calls_present");
  }
  if (conversation._count.activity_runtime_attempts > 0) {
    blockingReasons.push("activity_attempts_present");
  }
  if (conversation._count.memory_snapshots > 0) {
    blockingReasons.push("memory_snapshots_present");
  }
  if (conversation._count.interventions > 0) {
    blockingReasons.push("interventions_present");
  }
  if (conversation._count.review_signals > 0) {
    blockingReasons.push("review_signals_present");
  }
  if (conversation._count.turn_telemetry > 0) {
    blockingReasons.push("turn_telemetry_present");
  }
  if (conversation._count.input_telemetry > 0) {
    blockingReasons.push("input_telemetry_present");
  }
  if (conversation._count.profile_transitions > 0) {
    blockingReasons.push("profile_transitions_present");
  }
  if (conversation._count.profile_evidence_references > 0) {
    blockingReasons.push("profile_evidence_references_present");
  }
  if (
    conversation.current_student_profile_db_id &&
    conversation.initial_student_profile_db_id &&
    conversation.current_student_profile_db_id !==
      conversation.initial_student_profile_db_id
  ) {
    blockingReasons.push("profile_history_already_advanced");
  }

  const unsafeReceipt = conversation.message_receipts.find(
    (receipt) =>
      receipt.client_message_id !==
        FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID ||
      receipt.status !== "failed" ||
      Boolean(receipt.student_turn_db_id) ||
      Boolean(receipt.assistant_turn_db_id)
  );
  if (unsafeReceipt) {
    blockingReasons.push("conversation_message_receipts_present");
  }

  return {
    status: blockingReasons.length === 0 ? "eligible" : "blocked",
    conversation_db_id: conversation.id,
    profile_db_id: conversation.initial_student_profile_db_id,
    blocking_reasons: blockingReasons
  };
}

const emptyConversationProfileRepairSelect = {
  id: true,
  status: true,
  assessment_session_db_id: true,
  initial_student_profile_db_id: true,
  current_student_profile_db_id: true,
  initial_student_profile: {
    select: {
      id: true,
      misconception_indicators: true
    }
  },
  current_student_profile: {
    select: {
      id: true,
      misconception_indicators: true
    }
  },
  message_receipts: {
    select: {
      client_message_id: true,
      status: true,
      student_turn_db_id: true,
      assistant_turn_db_id: true
    }
  },
  _count: {
    select: {
      conversation_turns: true,
      agent_calls: true,
      activity_runtime_attempts: true,
      memory_snapshots: true,
      interventions: true,
      review_signals: true,
      turn_telemetry: true,
      input_telemetry: true,
      profile_transitions: true,
      profile_evidence_references: true
    }
  }
} satisfies Prisma.FormativeConversationSessionSelect;

export async function inspectEmptyFormativeConversationProfileRepair(
  conceptUnitSessionDbId: string
) {
  const conversation = await prisma.formativeConversationSession.findUnique({
    where: { concept_unit_session_db_id: conceptUnitSessionDbId },
    select: emptyConversationProfileRepairSelect
  });
  return inspectEmptyConversationProfileRepairState(conversation);
}

export async function bindCanonicalProfileToEmptyFormativeConversationInTransaction(
  tx: Prisma.TransactionClient,
  input: CreateFormativeConversationSessionInput & {
    canonical_student_profile_db_id: string;
  }
) {
  const candidateProfile = await tx.studentProfile.findFirst({
    where: {
      id: input.canonical_student_profile_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id
    },
    select: {
      id: true,
      misconception_indicators: true
    }
  });
  if (
    !candidateProfile ||
    !parseCanonicalMisconceptionClaimCatalog(
      candidateProfile.misconception_indicators
    )
  ) {
    throw new FormativeConversationFoundationError(
      "conversation_profile_rebind_not_canonical",
      "The replacement profile does not contain a canonical misconception claim catalog."
    );
  }

  const conversation = await tx.formativeConversationSession.findUnique({
    where: { concept_unit_session_db_id: input.concept_unit_session_db_id },
    select: emptyConversationProfileRepairSelect
  });
  if (!conversation) {
    return createOrGetTrustedFormativeConversationSessionInTransaction(tx, {
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      initial_student_profile_db_id: candidateProfile.id,
      current_student_profile_db_id: candidateProfile.id
    });
  }
  if (conversation.assessment_session_db_id !== input.assessment_session_db_id) {
    throw new FormativeConversationFoundationError(
      "conversation_session_mismatch",
      "The existing conversation belongs to another assessment session."
    );
  }
  if (
    conversation.initial_student_profile_db_id === candidateProfile.id &&
    conversation.current_student_profile_db_id === candidateProfile.id
  ) {
    return { session: conversation, created: false, rebound: false };
  }

  const inspection = inspectEmptyConversationProfileRepairState(conversation);
  if (inspection.status === "already_compatible") {
    return { session: conversation, created: false, rebound: false };
  }
  if (inspection.status !== "eligible") {
    throw new FormativeConversationFoundationError(
      "conversation_profile_rebind_not_empty",
      `The conversation profile cannot be rebound after formative evidence exists: ${inspection.blocking_reasons.join(",")}.`
    );
  }

  const session = await tx.formativeConversationSession.update({
    where: { id: conversation.id },
    data: {
      initial_student_profile_db_id: candidateProfile.id,
      current_student_profile_db_id: candidateProfile.id
    }
  });
  return { session, created: false, rebound: true };
}

export async function createOrGetTrustedFormativeConversationSessionInTransaction(
  tx: Prisma.TransactionClient,
  input: CreateFormativeConversationSessionInput
) {
  const existing = await tx.formativeConversationSession.findUnique({
    where: { concept_unit_session_db_id: input.concept_unit_session_db_id }
  });

  if (existing) {
    if (existing.assessment_session_db_id !== input.assessment_session_db_id) {
      throw new FormativeConversationFoundationError(
        "conversation_session_mismatch",
        "The existing conversation belongs to another assessment session."
      );
    }
    const session =
      (!existing.initial_student_profile_db_id &&
        input.initial_student_profile_db_id) ||
      (!existing.current_student_profile_db_id &&
        (input.current_student_profile_db_id ??
          input.initial_student_profile_db_id))
        ? await tx.formativeConversationSession.update({
            where: { id: existing.id },
            data: {
              initial_student_profile_db_id:
                existing.initial_student_profile_db_id ??
                input.initial_student_profile_db_id,
              current_student_profile_db_id:
                existing.current_student_profile_db_id ??
                input.current_student_profile_db_id ??
                input.initial_student_profile_db_id
            }
          })
        : existing;
    await ensureConversationStartedEvent(tx, session);
    return { session, created: false };
  }

  const session = await tx.formativeConversationSession.create({
    data: {
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      initial_student_profile_db_id: input.initial_student_profile_db_id,
      current_student_profile_db_id:
        input.current_student_profile_db_id ??
        input.initial_student_profile_db_id,
      telemetry_event_sequence_counter: 1
    }
  });
  await createConversationStartedEventForNewSession(tx, session);

  return { session, created: true };
}

export async function createOrGetFormativeConversationSessionInTransaction(
  tx: Prisma.TransactionClient,
  input: CreateFormativeConversationSessionInput
) {
  const conceptUnitSession = await tx.conceptUnitSession.findUniqueOrThrow({
    where: { id: input.concept_unit_session_db_id },
    select: { assessment_session_db_id: true }
  });

  if (conceptUnitSession.assessment_session_db_id !== input.assessment_session_db_id) {
    throw new FormativeConversationFoundationError(
      "conversation_session_mismatch",
      "The concept-unit session does not belong to the assessment session."
    );
  }

  const profileIds = [
    input.initial_student_profile_db_id,
    input.current_student_profile_db_id
  ].filter((profileId): profileId is string => Boolean(profileId));

  if (profileIds.length > 0) {
    const profileCount = await tx.studentProfile.count({
      where: {
        id: { in: profileIds },
        concept_unit_session_db_id: input.concept_unit_session_db_id
      }
    });

    if (profileCount !== new Set(profileIds).size) {
      throw new FormativeConversationFoundationError(
        "conversation_profile_mismatch",
        "A supplied profile does not belong to the concept-unit session."
      );
    }
  }

  return createOrGetTrustedFormativeConversationSessionInTransaction(
    tx,
    input
  );
}

export async function createOrGetFormativeConversationSession(
  input: CreateFormativeConversationSessionInput
) {
  const createSession = async () =>
    prisma.$transaction(
      (tx) =>
        createOrGetFormativeConversationSessionInTransaction(tx, input),
      FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS
    );

  try {
    return await createSession();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      try {
        return await createSession();
      } catch (retryError) {
        throw formativeConversationPersistenceError(
          retryError,
          "conversation_creation"
        );
      }
    }
    if (error instanceof FormativeConversationFoundationError) {
      throw error;
    }
    throw formativeConversationPersistenceError(
      error,
      "conversation_creation"
    );
  }
}

async function getConversationPhase(
  transaction: Prisma.TransactionClient,
  conversationPublicId: string,
  options: { require_active?: boolean } = {}
): Promise<{
  session_id: string;
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  status: string;
  phase: AssessmentPhase;
}> {
  const session = await transaction.formativeConversationSession.findUnique({
    where: { conversation_public_id: conversationPublicId },
    select: {
      id: true,
      assessment_session_db_id: true,
      concept_unit_session_db_id: true,
      status: true,
      assessment_session: { select: { current_phase: true } }
    }
  });

  if (!session) {
    throw new FormativeConversationFoundationError(
      "conversation_not_found",
      "The formative conversation does not exist."
    );
  }
  if (options.require_active !== false && session.status !== "active") {
    throw new FormativeConversationFoundationError(
      "conversation_not_active",
      "The formative conversation is not active."
    );
  }

  return {
    session_id: session.id,
    assessment_session_db_id: session.assessment_session_db_id,
    concept_unit_session_db_id: session.concept_unit_session_db_id,
    status: session.status,
    phase: session.assessment_session.current_phase
  };
}

export async function reserveAndPersistFormativeConversationStudentMessage(input: {
  conversation_public_id: string;
  client_message_id: string;
  message_text: string;
}) {
  const messageText = input.message_text.trim();
  if (!messageText || messageText.length > 5_000) {
    throw new Error("formative_conversation_student_message_invalid");
  }
  const requestHash = messageRequestHash(messageText);
  const logicalOperationId =
    `message-reservation:${input.conversation_public_id}:${input.client_message_id}`;

  const persist = async () =>
    measureFormativeConversationPersistencePhase({
      operation_name: "formative_conversation_message_reservation",
      logical_operation_id: logicalOperationId,
      operation_kind: "write",
      phase: "transaction",
      transaction_timeout_ms:
        FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS.timeout,
      mutation_may_have_occurred: true,
      execute: () =>
        prisma.$transaction(async (tx) => {
          const session = await getConversationPhase(
            tx,
            input.conversation_public_id,
            { require_active: false }
          );
          const existing =
            await tx.formativeConversationMessageReceipt.findUnique({
              where: {
                formative_conversation_session_db_id_client_message_id: {
                  formative_conversation_session_db_id: session.session_id,
                  client_message_id: input.client_message_id
                }
              },
              include: { student_turn: true, assistant_turn: true }
            });

          if (existing) {
            if (existing.request_hash !== requestHash) {
              throw new FormativeConversationFoundationError(
                "idempotency_hash_mismatch",
                "The client message ID was already used for different content."
              );
            }
            return { receipt: existing, replayed: true };
          }

          if (session.status !== "active") {
            throw new FormativeConversationFoundationError(
              "conversation_not_active",
              "The formative conversation is not active."
            );
          }

          // Serialize distinct message reservations at the conversation boundary.
          // This makes the phase-local twelfth-turn limit stable across tabs.
          const lockedSession =
            await tx.formativeConversationSession.update({
              where: { id: session.session_id },
              data: { concurrency_version: { increment: 1 } },
              select: { status: true }
            });
          if (lockedSession.status !== "active") {
            throw new FormativeConversationFoundationError(
              "conversation_not_active",
              "The formative conversation is not active."
            );
          }

          const formativeStudentTurnCount =
            await tx.formativeConversationMessageReceipt.count({
              where: {
                formative_conversation_session_db_id: session.session_id,
                student_turn_db_id: { not: null }
              }
            });
          if (
            formativeStudentTurnCount >=
            FORMATIVE_CONVERSATION_MAX_STUDENT_TURNS
          ) {
            throw new FormativeConversationFoundationError(
              "conversation_turn_limit_reached",
              "The formative conversation has reached its student-turn limit."
            );
          }
          const formativeStudentTurnIndex = formativeStudentTurnCount + 1;

          const studentTurn = await tx.conversationTurn.create({
            data: {
              assessment_session_db_id: session.assessment_session_db_id,
              concept_unit_session_db_id: session.concept_unit_session_db_id,
              formative_conversation_session_db_id: session.session_id,
              phase: session.phase,
              actor_type: "student",
              message_text: messageText,
              structured_payload: {
                message_type: "formative_conversation_student_message",
                visibility: "student_visible",
                client_message_id: input.client_message_id,
                formative_student_turn_index: formativeStudentTurnIndex,
                max_formative_student_turns:
                  FORMATIVE_CONVERSATION_MAX_STUDENT_TURNS,
                final_allowed_turn:
                  formativeStudentTurnIndex ===
                  FORMATIVE_CONVERSATION_MAX_STUDENT_TURNS,
                another_student_turn_available:
                  formativeStudentTurnIndex <
                  FORMATIVE_CONVERSATION_MAX_STUDENT_TURNS
              }
            }
          });
          const receipt =
            await tx.formativeConversationMessageReceipt.create({
              data: {
                formative_conversation_session_db_id: session.session_id,
                client_message_id: input.client_message_id,
                request_hash: requestHash,
                status: "student_turn_persisted",
                assistant_response_status: "pending",
                student_turn_db_id: studentTurn.id
              },
              include: { student_turn: true, assistant_turn: true }
            });
          await tx.formativeConversationSession.update({
            where: { id: session.session_id },
            data: {
              last_activity_at: new Date(),
              last_processed_turn_sequence: studentTurn.sequence_index
            }
          });

          return { receipt, replayed: false };
        }, FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS)
    });

  const reconcile = async () => {
    const receipt =
      await prisma.formativeConversationMessageReceipt.findFirst({
        where: {
          client_message_id: input.client_message_id,
          formative_conversation_session: {
            conversation_public_id: input.conversation_public_id
          }
        },
        include: { student_turn: true, assistant_turn: true }
      });
    if (!receipt) {
      return { status: "not_committed" as const };
    }
    if (receipt.request_hash !== requestHash) {
      throw new FormativeConversationFoundationError(
        "idempotency_hash_mismatch",
        "The client message ID was already used for different content."
      );
    }
    return {
      status: "committed" as const,
      value: { receipt, replayed: true }
    };
  };

  try {
    return await executeFormativeConversationIdempotentWrite<
      Awaited<ReturnType<typeof persist>>
    >({
      operation_name: "formative_conversation_message_reservation",
      logical_operation_id: logicalOperationId,
      execute: persist,
      reconcile
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const receipt = await prisma.formativeConversationMessageReceipt.findFirst({
        where: {
          client_message_id: input.client_message_id,
          formative_conversation_session: {
            conversation_public_id: input.conversation_public_id
          }
        },
        include: { student_turn: true, assistant_turn: true }
      });
      if (receipt?.request_hash === requestHash) {
        return { receipt, replayed: true };
      }
    }
    if (error instanceof FormativeConversationFoundationError) {
      throw error;
    }
    throw formativeConversationPersistenceError(
      error,
      "message_reservation",
      {
        logical_operation_id: logicalOperationId,
        mutation_may_have_occurred: true
      }
    );
  }
}

export async function reserveFormativeConversationOpening(
  conversationPublicId: string
) {
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        operation: "formative_conversation_opening",
        version: FORMATIVE_CONVERSATION_OPENING_VERSION
      })
    )
    .digest("hex");
  const reserve = async () =>
    prisma.$transaction(async (tx) => {
      const session = await getConversationPhase(tx, conversationPublicId);
      const existing =
        await tx.formativeConversationMessageReceipt.findUnique({
          where: {
            formative_conversation_session_db_id_client_message_id: {
              formative_conversation_session_db_id: session.session_id,
              client_message_id:
                FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID
            }
          },
          include: { student_turn: true, assistant_turn: true }
        });

      if (existing) {
        if (existing.request_hash !== requestHash) {
          throw new FormativeConversationFoundationError(
            "idempotency_hash_mismatch",
            "The formative conversation opening identity does not match."
          );
        }
        if (existing.status === "failed" && !existing.assistant_turn) {
          const openingAttempt = openingAttemptFromReceipt(existing) + 1;
          const retryReceipt =
            await tx.formativeConversationMessageReceipt.update({
              where: { id: existing.id },
              data: {
                status: "reserved",
                assistant_response_status: "retrying",
                assistant_response_retry_count: { increment: 1 },
                response_payload: {
                  ...assistantResponsePayload({
                    existing: existing.response_payload,
                    status: "retrying",
                    retry_count:
                      existing.assistant_response_retry_count + 1
                  }),
                  opening_attempt: openingAttempt,
                  retry_started: true
                },
                failure_code: null,
                completed_at: null
              },
              include: { student_turn: true, assistant_turn: true }
            });
          return {
            receipt: retryReceipt,
            replayed: false,
            opening_attempt: openingAttempt
          };
        }
        return {
          receipt: existing,
          replayed: true,
          opening_attempt: openingAttemptFromReceipt(existing)
        };
      }

      const receipt = await tx.formativeConversationMessageReceipt.create({
        data: {
          formative_conversation_session_db_id: session.session_id,
          client_message_id:
            FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID,
          request_hash: requestHash,
          status: "reserved",
          assistant_response_status: "pending",
          response_payload: {
            opening_attempt: 1,
            assistant_response: {
              status: "pending",
              agent_name: "formative_conversation_agent",
              retry_count: 0,
              failure_category: null,
              failed_at: null,
              lifecycle_version:
                "formative-conversation-assistant-response-lifecycle-v1"
            }
          }
        },
        include: { student_turn: true, assistant_turn: true }
      });

      return { receipt, replayed: false, opening_attempt: 1 };
    });

  try {
    return await reserve();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return reserve();
    }
    throw error;
  }
}

export async function recordFormativeConversationOpeningFailure(input: {
  conversation_public_id: string;
  failure_code: string;
  retryable: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const session = await getConversationPhase(
      tx,
      input.conversation_public_id
    );
    const receipt =
      await tx.formativeConversationMessageReceipt.findUniqueOrThrow({
        where: {
          formative_conversation_session_db_id_client_message_id: {
            formative_conversation_session_db_id: session.session_id,
            client_message_id:
              FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID
          }
        },
        include: { assistant_turn: true }
      });
    if (receipt.assistant_turn) {
      return { receipt, replayed: true };
    }

    const updated = await tx.formativeConversationMessageReceipt.update({
      where: { id: receipt.id },
      data: {
        status: "failed",
        failure_code: input.failure_code,
        assistant_response_status: "failed",
        assistant_response_last_failure_category: input.failure_code,
        assistant_response_last_failed_at: new Date(),
        response_payload: {
          ...assistantResponsePayload({
            existing: receipt.response_payload,
            status: "failed",
            retry_count: receipt.assistant_response_retry_count,
            failure_category: input.failure_code,
            failed_at: new Date()
          }),
          opening_attempt: openingAttemptFromReceipt(receipt),
          retryable: input.retryable,
          failure_record_version:
            "formative-conversation-opening-failure-v1"
        },
        completed_at: new Date()
      },
      include: { student_turn: true, assistant_turn: true }
    });
    return { receipt: updated, replayed: false };
  });
}

export async function prepareFormativeConversationAssistantResponseAttempt(input: {
  conversation_public_id: string;
  client_message_id: string;
}) {
  return prisma.$transaction(async (tx) => {
    const session = await getConversationPhase(
      tx,
      input.conversation_public_id
    );
    const receipt =
      await tx.formativeConversationMessageReceipt.findUniqueOrThrow({
        where: {
          formative_conversation_session_db_id_client_message_id: {
            formative_conversation_session_db_id: session.session_id,
            client_message_id: input.client_message_id
          }
        },
        include: {
          student_turn: true,
          assistant_turn: true
        }
      });

    if (receipt.assistant_turn) {
      return {
        receipt,
        attempt_index: receipt.assistant_response_retry_count + 1,
        response_completed: true
      };
    }

    if (receipt.assistant_response_status === "failed") {
      const shouldReuseCompletedCall =
        receipt.assistant_response_last_failure_category ===
        "assistant_response_persistence_failure";
      const nextRetryCount =
        receipt.assistant_response_retry_count +
        (shouldReuseCompletedCall ? 0 : 1);
      const claimed =
        await tx.formativeConversationMessageReceipt.updateMany({
          where: {
            id: receipt.id,
            assistant_turn_db_id: null,
            assistant_response_status: "failed"
          },
          data: {
            status: "student_turn_persisted",
            assistant_response_status: "retrying",
            assistant_response_retry_count: shouldReuseCompletedCall
              ? receipt.assistant_response_retry_count
              : { increment: 1 },
            failure_code: null,
            completed_at: null,
            response_payload: assistantResponsePayload({
              existing: receipt.response_payload,
              status: "retrying",
              retry_count: nextRetryCount
            })
          }
        });
      if (claimed.count === 1) {
        const claimedReceipt =
          await tx.formativeConversationMessageReceipt.findUniqueOrThrow({
            where: { id: receipt.id },
            include: {
              student_turn: true,
              assistant_turn: true
            }
          });
        return {
          receipt: claimedReceipt,
          attempt_index:
            claimedReceipt.assistant_response_retry_count + 1,
          response_completed: false
        };
      }
    }

    const current =
      await tx.formativeConversationMessageReceipt.findUniqueOrThrow({
        where: { id: receipt.id },
        include: {
          student_turn: true,
          assistant_turn: true
        }
      });
    return {
      receipt: current,
      attempt_index: current.assistant_response_retry_count + 1,
      response_completed: Boolean(current.assistant_turn)
    };
  });
}

export async function recordFormativeConversationAssistantResponseFailure(input: {
  conversation_public_id: string;
  client_message_id: string;
  failure_category: string;
  failed_at: Date;
}) {
  return prisma.$transaction(async (tx) => {
    const session = await getConversationPhase(
      tx,
      input.conversation_public_id
    );
    const receipt =
      await tx.formativeConversationMessageReceipt.findUniqueOrThrow({
        where: {
          formative_conversation_session_db_id_client_message_id: {
            formative_conversation_session_db_id: session.session_id,
            client_message_id: input.client_message_id
          }
        },
        include: {
          student_turn: true,
          assistant_turn: true
        }
      });
    if (receipt.assistant_turn) {
      return { receipt, replayed: true };
    }

    const updated =
      await tx.formativeConversationMessageReceipt.update({
        where: { id: receipt.id },
        data: {
          status: "failed",
          failure_code: input.failure_category,
          assistant_response_status: "failed",
          assistant_response_last_failure_category:
            input.failure_category,
          assistant_response_last_failed_at: input.failed_at,
          response_payload: assistantResponsePayload({
            existing: receipt.response_payload,
            status: "failed",
            retry_count: receipt.assistant_response_retry_count,
            failure_category: input.failure_category,
            failed_at: input.failed_at
          }),
          completed_at: input.failed_at
        },
        include: {
          student_turn: true,
          assistant_turn: true
        }
      });
    return { receipt: updated, replayed: false };
  });
}

export async function getFormativeConversationStudentMessageForRetry(input: {
  conversation_public_id: string;
  receipt_public_id: string;
}) {
  const receipt =
    await prisma.formativeConversationMessageReceipt.findFirst({
      where: {
        receipt_public_id: input.receipt_public_id,
        formative_conversation_session: {
          conversation_public_id: input.conversation_public_id
        }
      },
      include: {
        student_turn: true,
        assistant_turn: true
      }
    });
  if (
    !receipt ||
    receipt.client_message_id ===
      FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID ||
    !receipt.student_turn?.message_text
  ) {
    throw new FormativeConversationFoundationError(
      "conversation_not_found",
      "The formative conversation response was not found."
    );
  }
  return {
    receipt,
    client_message_id: receipt.client_message_id,
    message_text: receipt.student_turn.message_text
  };
}

export async function persistFormativeConversationAssistantMessage(input: {
  conversation_public_id: string;
  client_message_id: string;
  message_text: string;
  generation_source: string;
  validator_status: string;
  agent_call_db_id?: string;
  fallback_used?: boolean;
  message_type?:
    | "formative_conversation_tutor_message"
    | "formative_conversation_opening"
    | "formative_conversation_lifecycle_handoff";
  opening_version?: string;
}) {
  const messageText = input.message_text.trim();
  if (!messageText || messageText.length > 12_000) {
    throw new Error("formative_conversation_assistant_message_invalid");
  }
  const logicalOperationId =
    `assistant-response:${input.conversation_public_id}:${input.client_message_id}`;

  const persist = () =>
    measureFormativeConversationPersistencePhase({
      operation_name: "formative_conversation_assistant_response",
      logical_operation_id: logicalOperationId,
      operation_kind: "write",
      phase: "transaction",
      transaction_timeout_ms:
        FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS.timeout,
      mutation_may_have_occurred: true,
      execute: () =>
        prisma.$transaction(async (tx) => {
          const session = await getConversationPhase(
            tx,
            input.conversation_public_id
          );
          const receipt =
            await tx.formativeConversationMessageReceipt.findUniqueOrThrow({
              where: {
                formative_conversation_session_db_id_client_message_id: {
                  formative_conversation_session_db_id: session.session_id,
                  client_message_id: input.client_message_id
                }
              },
              include: { assistant_turn: true }
            });

          if (receipt.assistant_turn) {
            return {
              receipt,
              assistant_turn: receipt.assistant_turn,
              replayed: true
            };
          }

          const assistantTurn = await tx.conversationTurn.create({
            data: {
              assessment_session_db_id: session.assessment_session_db_id,
              concept_unit_session_db_id: session.concept_unit_session_db_id,
              formative_conversation_session_db_id: session.session_id,
              phase: session.phase,
              actor_type: "agent",
              agent_name: "formative_conversation_agent",
              message_text: messageText,
              structured_payload: {
                message_type:
                  input.message_type ??
                  "formative_conversation_tutor_message",
                visibility: "student_visible",
                generation_source: input.generation_source,
                validator_status: input.validator_status,
                agent_call_db_id: input.agent_call_db_id ?? null,
                fallback_used: input.fallback_used ?? false,
                opening_version: input.opening_version ?? null
              }
            }
          });
          const updatedReceipt =
            await tx.formativeConversationMessageReceipt.update({
              where: { id: receipt.id },
              data: {
                status: "assistant_turn_persisted",
                assistant_response_status: "completed",
                assistant_turn_db_id: assistantTurn.id,
                failure_code: null,
                response_payload: {
                  ...assistantResponsePayload({
                    existing: receipt.response_payload,
                    status: "completed",
                    retry_count:
                      receipt.assistant_response_retry_count
                  }),
                  agent_name: "formative_conversation_agent",
                  agent_call_db_id: input.agent_call_db_id ?? null,
                  generation_source: input.generation_source,
                  validator_status: input.validator_status,
                  fallback_used: input.fallback_used ?? false,
                  message_type:
                    input.message_type ??
                    "formative_conversation_tutor_message",
                  opening_version: input.opening_version ?? null
                },
                completed_at: new Date()
              },
              include: { student_turn: true, assistant_turn: true }
            });
          await tx.formativeConversationSession.update({
            where: { id: session.session_id },
            data: {
              last_activity_at: new Date(),
              last_processed_turn_sequence:
                assistantTurn.sequence_index,
              concurrency_version: { increment: 1 }
            }
          });

          return {
            receipt: updatedReceipt,
            assistant_turn: assistantTurn,
            replayed: false
          };
        }, FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS)
    });

  const reconcile = async () => {
    const receipt =
      await prisma.formativeConversationMessageReceipt.findFirst({
        where: {
          client_message_id: input.client_message_id,
          formative_conversation_session: {
            conversation_public_id: input.conversation_public_id
          }
        },
        include: { student_turn: true, assistant_turn: true }
      });
    if (!receipt?.assistant_turn) {
      return { status: "not_committed" as const };
    }
    return {
      status: "committed" as const,
      value: {
        receipt,
        assistant_turn: receipt.assistant_turn,
        replayed: true
      }
    };
  };

  try {
    return await executeFormativeConversationIdempotentWrite<
      Awaited<ReturnType<typeof persist>>
    >({
      operation_name: "formative_conversation_assistant_response",
      logical_operation_id: logicalOperationId,
      execute: persist,
      reconcile
    });
  } catch (error) {
    throw formativeConversationPersistenceError(
      error,
      "assistant_response_persistence",
      {
        logical_operation_id: logicalOperationId,
        mutation_may_have_occurred: true
      }
    );
  }
}

export const FORMATIVE_CONVERSATION_LIFECYCLE_HANDOFF_MESSAGE =
  "We've reached the end of this conversation. It may help to ask your instructor for another explanation or work through this concept with them." as const;

export async function persistFormativeConversationLifecycleHandoff(input: {
  conversation_public_id: string;
  client_message_id: string;
  agent_call_db_id: string;
  reason_code: string;
}) {
  const logicalOperationId =
    `lifecycle-handoff:${input.conversation_public_id}:${input.client_message_id}`;
  const persist = () =>
    prisma.$transaction(async (tx) => {
      const session = await tx.formativeConversationSession.findUniqueOrThrow({
        where: { conversation_public_id: input.conversation_public_id },
        select: {
          id: true,
          assessment_session_db_id: true,
          concept_unit_session_db_id: true,
          status: true,
          current_student_profile_db_id: true,
          assessment_session: { select: { current_phase: true } }
        }
      });
      const receipt =
        await tx.formativeConversationMessageReceipt.findUniqueOrThrow({
          where: {
            formative_conversation_session_db_id_client_message_id: {
              formative_conversation_session_db_id: session.id,
              client_message_id: input.client_message_id
            }
          },
          include: { student_turn: true, assistant_turn: true }
        });
      if (receipt.assistant_turn) {
        return {
          receipt,
          assistant_turn: receipt.assistant_turn,
          replayed: true
        };
      }
      if (!receipt.student_turn) {
        throw new Error("formative_conversation_lifecycle_handoff_student_turn_missing");
      }
      if (session.status !== "active") {
        throw new FormativeConversationFoundationError(
          "conversation_not_active",
          "The formative conversation lifecycle is already closed."
        );
      }
      const now = new Date();
      const sourceAgentCall = await tx.agentCall.findUniqueOrThrow({
        where: { id: input.agent_call_db_id },
        select: {
          formative_conversation_session_db_id: true,
          agent_call_public_id: true
        }
      });
      if (sourceAgentCall.formative_conversation_session_db_id !== session.id) {
        throw new Error("formative_conversation_lifecycle_handoff_agent_call_mismatch");
      }
      const assistantTurn = await tx.conversationTurn.create({
        data: {
          assessment_session_db_id: session.assessment_session_db_id,
          concept_unit_session_db_id: session.concept_unit_session_db_id,
          formative_conversation_session_db_id: session.id,
          phase: session.assessment_session.current_phase,
          actor_type: "agent",
          agent_name: "platform_lifecycle",
          message_text: FORMATIVE_CONVERSATION_LIFECYCLE_HANDOFF_MESSAGE,
          structured_payload: {
            message_type: "formative_conversation_lifecycle_handoff",
            visibility: "student_visible",
            generation_source: "platform_lifecycle",
            validator_status: "lifecycle_fail_safe",
            agent_call_db_id: input.agent_call_db_id,
            fallback_used: false,
            recommendation_source: "platform_lifecycle",
            lifecycle_termination_reason: input.reason_code,
            profile_transition_created: false,
            teacher_assistance_recommended: false,
            student_formative_turn_count:
              FORMATIVE_CONVERSATION_MAX_STUDENT_TURNS,
            max_student_turns: FORMATIVE_CONVERSATION_MAX_STUDENT_TURNS,
            final_allowed_turn: true,
            another_student_turn_available: false
          }
        }
      });
      const updatedReceipt =
        await tx.formativeConversationMessageReceipt.update({
          where: { id: receipt.id },
          data: {
            status: "assistant_turn_persisted",
            assistant_response_status: "completed",
            assistant_turn_db_id: assistantTurn.id,
            failure_code: null,
            response_payload: {
              ...assistantResponsePayload({
                existing: receipt.response_payload,
                status: "completed",
                retry_count: receipt.assistant_response_retry_count
              }),
              agent_name: "platform_lifecycle",
              agent_call_db_id: input.agent_call_db_id,
              generation_source: "platform_lifecycle",
              validator_status: "lifecycle_fail_safe",
              fallback_used: false,
              message_type: "formative_conversation_lifecycle_handoff",
              recommendation_source: "platform_lifecycle",
              lifecycle_termination_reason: input.reason_code,
              profile_transition_created: false,
              teacher_assistance_recommended: false
            },
            completed_at: now
          },
          include: { student_turn: true, assistant_turn: true }
        });
      await tx.formativeConversationReviewSignal.create({
        data: {
          formative_conversation_session_db_id: session.id,
          source_student_profile_db_id:
            session.current_student_profile_db_id,
          source_turn_db_id: assistantTurn.id,
          signal_type: "platform_lifecycle_handoff",
          reason_code: input.reason_code,
          evidence_summary: {
            recommendation_source: "platform_lifecycle",
            profile_transition_created: false,
            semantic_teacher_assistance_recommended: false,
            student_formative_turn_count:
              FORMATIVE_CONVERSATION_MAX_STUDENT_TURNS,
            max_student_turns: FORMATIVE_CONVERSATION_MAX_STUDENT_TURNS,
            final_allowed_turn: true,
            another_student_turn_available: false,
            source_agent_call_public_id:
              sourceAgentCall.agent_call_public_id
          }
        }
      });
      const endedSession = await tx.formativeConversationSession.update({
        where: { id: session.id },
        data: {
          status: "ended",
          ended_at: now,
          lifecycle_reason: `platform_${input.reason_code}`,
          last_activity_at: now,
          last_processed_turn_sequence: assistantTurn.sequence_index,
          concurrency_version: { increment: 1 },
          telemetry_event_sequence_counter: { increment: 1 }
        },
        select: { telemetry_event_sequence_counter: true }
      });
      const lifecycleEventPayload = {
        event_type: "conversation_ended",
        event_source: "system",
        agent_call_db_id: input.agent_call_db_id,
        agent_name: "formative_conversation_agent",
        failure_category: input.reason_code,
        retry_count: 0,
        observed_interval_duration_ms: null,
        client_instance_id: null,
        occurred_at: now.toISOString()
      };
      await tx.formativeConversationLifecycleEvent.create({
        data: {
          formative_conversation_session_db_id: session.id,
          conversation_local_event_sequence_index:
            endedSession.telemetry_event_sequence_counter,
          client_event_id: `platform-lifecycle-handoff:${input.client_message_id}`,
          event_hash: createHash("sha256")
            .update(JSON.stringify(lifecycleEventPayload))
            .digest("hex"),
          event_type: "conversation_ended",
          event_source: "system",
          agent_call_db_id: input.agent_call_db_id,
          agent_name: "formative_conversation_agent",
          failure_category: input.reason_code,
          retry_count: 0,
          occurred_at: now
        }
      });
      return {
        receipt: updatedReceipt,
        assistant_turn: assistantTurn,
        replayed: false
      };
    }, FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS);

  return executeFormativeConversationIdempotentWrite({
    operation_name: "formative_conversation_lifecycle_handoff",
    logical_operation_id: logicalOperationId,
    execute: persist,
    reconcile: async () => {
      const receipt =
        await prisma.formativeConversationMessageReceipt.findFirst({
          where: {
            client_message_id: input.client_message_id,
            formative_conversation_session: {
              conversation_public_id: input.conversation_public_id
            }
          },
          include: { student_turn: true, assistant_turn: true }
        });
      return receipt?.assistant_turn &&
        jsonRecord(receipt.assistant_turn.structured_payload).message_type ===
          "formative_conversation_lifecycle_handoff"
        ? {
            status: "committed" as const,
            value: {
              receipt,
              assistant_turn: receipt.assistant_turn,
              replayed: true
            }
          }
        : { status: "not_committed" as const };
    }
  });
}

export async function closeFormativeConversationAtStudentTurnLimit(input: {
  conversation_public_id: string;
  client_message_id: string;
  agent_call_db_id: string;
  source: "llm_terminal_recommendation";
  reason_code: string;
}) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const session = await tx.formativeConversationSession.findUniqueOrThrow({
      where: { conversation_public_id: input.conversation_public_id },
      select: { id: true, status: true }
    });
    const clientEventId =
      `final-formative-turn:${input.client_message_id}:conversation-ended`;
    const existingEvent =
      await tx.formativeConversationLifecycleEvent.findUnique({
        where: {
          formative_conversation_session_db_id_client_event_id: {
            formative_conversation_session_db_id: session.id,
            client_event_id: clientEventId
          }
        }
      });
    if (existingEvent) {
      return { event: existingEvent, replayed: true };
    }
    if (session.status !== "active") {
      throw new FormativeConversationFoundationError(
        "conversation_not_active",
        "The formative conversation lifecycle is already closed."
      );
    }
    const endedSession = await tx.formativeConversationSession.update({
      where: { id: session.id },
      data: {
        status: "ended",
        ended_at: now,
        lifecycle_reason: `${input.source}:${input.reason_code}`,
        last_activity_at: now,
        telemetry_event_sequence_counter: { increment: 1 }
      },
      select: { telemetry_event_sequence_counter: true }
    });
    const eventPayload = {
      event_type: "conversation_ended",
      event_source: "system",
      agent_call_db_id: input.agent_call_db_id,
      agent_name: "formative_conversation_agent",
      failure_category: null,
      retry_count: 0,
      observed_interval_duration_ms: null,
      client_instance_id: null,
      occurred_at: now.toISOString()
    };
    const event = await tx.formativeConversationLifecycleEvent.create({
      data: {
        formative_conversation_session_db_id: session.id,
        conversation_local_event_sequence_index:
          endedSession.telemetry_event_sequence_counter,
        client_event_id: clientEventId,
        event_hash: createHash("sha256")
          .update(JSON.stringify(eventPayload))
          .digest("hex"),
        event_type: "conversation_ended",
        event_source: "system",
        agent_call_db_id: input.agent_call_db_id,
        agent_name: "formative_conversation_agent",
        retry_count: 0,
        occurred_at: now
      }
    });
    return { event, replayed: false };
  }, FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS);
}

export async function getFormativeConversationTranscript(conversationPublicId: string) {
  const session = await prisma.formativeConversationSession.findUnique({
    where: { conversation_public_id: conversationPublicId },
    select: {
      conversation_public_id: true,
      conversation_turns: {
        where: {
          message_text: { not: null },
          actor_type: { in: ["student", "agent"] }
        },
        orderBy: { sequence_index: "asc" },
        select: {
          sequence_index: true,
          actor_type: true,
          agent_name: true,
          message_text: true,
          structured_payload: true,
          created_at: true
        }
      }
    }
  });

  if (!session) {
    throw new FormativeConversationFoundationError(
      "conversation_not_found",
      "The formative conversation does not exist."
    );
  }

  return {
    ...session,
    conversation_turns: session.conversation_turns
      .filter((turn) => isStudentVisiblePayload(turn.structured_payload))
      .map((turn) => ({
        sequence_index: turn.sequence_index,
        actor_type: turn.actor_type,
        agent_name: turn.agent_name,
        message_text: turn.message_text,
        created_at: turn.created_at
      }))
  };
}
