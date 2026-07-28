import { createHash } from "node:crypto";
import { Prisma, type AssessmentPhase } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID,
  FORMATIVE_CONVERSATION_OPENING_VERSION
} from "./opening-contract";

export const FORMATIVE_CONVERSATION_CANONICAL_RUNTIME_STATE =
  "FORMATIVE_CONVERSATION" as const;

export type FormativeConversationFoundationErrorCode =
  | "conversation_session_mismatch"
  | "conversation_profile_mismatch"
  | "conversation_not_found"
  | "conversation_not_active"
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

function messageRequestHash(messageText: string) {
  return createHash("sha256")
    .update(JSON.stringify({ message_text: messageText.trim() }))
    .digest("hex");
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

  await tx.formativeConversationLifecycleEvent.upsert({
    where: {
      formative_conversation_session_db_id_client_event_id: {
        formative_conversation_session_db_id: session.id,
        client_event_id: clientEventId
      }
    },
    create: {
      formative_conversation_session_db_id: session.id,
      client_event_id: clientEventId,
      event_hash: createHash("sha256")
        .update(JSON.stringify(eventPayload))
        .digest("hex"),
      event_type: "session_started",
      event_source: "backend",
      occurred_at: session.started_at
    },
    update: {}
  });
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
        input.current_student_profile_db_id ?? input.initial_student_profile_db_id
    }
  });
  await ensureConversationStartedEvent(tx, session);

  return { session, created: true };
}

export async function createOrGetFormativeConversationSession(
  input: CreateFormativeConversationSessionInput
) {
  const createSession = async () =>
    prisma.$transaction((tx) =>
      createOrGetFormativeConversationSessionInTransaction(tx, input)
    );

  try {
    return await createSession();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return createSession();
    }
    throw error;
  }
}

async function getConversationPhase(
  transaction: Prisma.TransactionClient,
  conversationPublicId: string
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
  if (session.status !== "active") {
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

  const persist = async () =>
    prisma.$transaction(async (tx) => {
      const session = await getConversationPhase(tx, input.conversation_public_id);
      const existing = await tx.formativeConversationMessageReceipt.findUnique({
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
            client_message_id: input.client_message_id
          }
        }
      });
      const receipt = await tx.formativeConversationMessageReceipt.create({
        data: {
          formative_conversation_session_db_id: session.session_id,
          client_message_id: input.client_message_id,
          request_hash: requestHash,
          status: "student_turn_persisted",
          student_turn_db_id: studentTurn.id
        },
        include: { student_turn: true, assistant_turn: true }
      });
      await tx.formativeConversationSession.update({
        where: { id: session.session_id },
        data: {
          last_activity_at: new Date(),
          last_processed_turn_sequence: studentTurn.sequence_index,
          concurrency_version: { increment: 1 }
        }
      });

      return { receipt, replayed: false };
    });

  try {
    return await persist();
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
    throw error;
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
        return { receipt: existing, replayed: true };
      }

      const receipt = await tx.formativeConversationMessageReceipt.create({
        data: {
          formative_conversation_session_db_id: session.session_id,
          client_message_id:
            FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID,
          request_hash: requestHash,
          status: "reserved"
        },
        include: { student_turn: true, assistant_turn: true }
      });

      return { receipt, replayed: false };
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
    | "formative_conversation_opening";
  opening_version?: string;
}) {
  const messageText = input.message_text.trim();
  if (!messageText || messageText.length > 12_000) {
    throw new Error("formative_conversation_assistant_message_invalid");
  }

  return prisma.$transaction(async (tx) => {
    const session = await getConversationPhase(tx, input.conversation_public_id);
    const receipt = await tx.formativeConversationMessageReceipt.findUniqueOrThrow({
      where: {
        formative_conversation_session_db_id_client_message_id: {
          formative_conversation_session_db_id: session.session_id,
          client_message_id: input.client_message_id
        }
      },
      include: { assistant_turn: true }
    });

    if (receipt.assistant_turn) {
      return { receipt, assistant_turn: receipt.assistant_turn, replayed: true };
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
            input.message_type ?? "formative_conversation_tutor_message",
          visibility: "student_visible",
          generation_source: input.generation_source,
          validator_status: input.validator_status,
          agent_call_db_id: input.agent_call_db_id ?? null,
          fallback_used: input.fallback_used ?? false,
          opening_version: input.opening_version ?? null
        }
      }
    });
    const updatedReceipt = await tx.formativeConversationMessageReceipt.update({
      where: { id: receipt.id },
      data: {
        status: "assistant_turn_persisted",
        assistant_turn_db_id: assistantTurn.id,
        response_payload: {
          agent_name: "formative_conversation_agent",
          agent_call_db_id: input.agent_call_db_id ?? null,
          generation_source: input.generation_source,
          validator_status: input.validator_status,
          fallback_used: input.fallback_used ?? false,
          message_type:
            input.message_type ?? "formative_conversation_tutor_message",
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
        last_processed_turn_sequence: assistantTurn.sequence_index,
        concurrency_version: { increment: 1 }
      }
    });

    return {
      receipt: updatedReceipt,
      assistant_turn: assistantTurn,
      replayed: false
    };
  });
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
