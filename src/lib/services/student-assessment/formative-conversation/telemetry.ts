import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  FormativeConversationAgentTelemetryBindingSchema,
  FormativeConversationInputTelemetryInputSchema,
  FormativeConversationLifecycleEventInputSchema,
  FormativeConversationProfileTransitionInputSchema,
  FormativeConversationTurnTelemetryInputSchema,
  assertObservableOnlyFormativeConversationTelemetry,
  type FormativeConversationAgentTelemetryBinding,
  type FormativeConversationInputTelemetryInput,
  type FormativeConversationLifecycleEventInput,
  type FormativeConversationProfileTransitionInput,
  type FormativeConversationTurnTelemetryInput
} from "./telemetry-contract";

type TelemetryErrorCode =
  | "conversation_not_found"
  | "telemetry_idempotency_mismatch"
  | "telemetry_session_mismatch"
  | "telemetry_turn_mismatch"
  | "telemetry_agent_call_mismatch"
  | "telemetry_profile_mismatch"
  | "telemetry_profile_transition_stale";

export class FormativeConversationTelemetryError extends Error {
  constructor(
    public readonly code: TelemetryErrorCode,
    message: string
  ) {
    super(message);
    this.name = "FormativeConversationTelemetryError";
  }
}

function hashValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function optionalDateValue(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function sameOptionalDate(left: Date | null, right: Date | null | undefined) {
  return optionalDateValue(left) === optionalDateValue(right);
}

function asObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return {};
  }
  return value as Record<string, unknown>;
}

async function getConversationIdentity(conversationPublicId: string) {
  const session = await prisma.formativeConversationSession.findUnique({
    where: { conversation_public_id: conversationPublicId },
    select: {
      id: true,
      assessment_session_db_id: true,
      concept_unit_session_db_id: true,
      current_student_profile_db_id: true
    }
  });
  if (!session) {
    throw new FormativeConversationTelemetryError(
      "conversation_not_found",
      "The formative conversation does not exist."
    );
  }
  return session;
}

export async function recordFormativeConversationLifecycleEvent(
  input: FormativeConversationLifecycleEventInput
) {
  const parsed = FormativeConversationLifecycleEventInputSchema.parse(input);
  assertObservableOnlyFormativeConversationTelemetry(parsed);
  const session = await getConversationIdentity(parsed.conversation_public_id);
  const eventHash = hashValue({
    event_type: parsed.event_type,
    event_source: parsed.event_source,
    observed_interval_duration_ms:
      parsed.observed_interval_duration_ms ?? null,
    client_instance_id: parsed.client_instance_id ?? null,
    occurred_at: parsed.occurred_at.toISOString()
  });
  const existing =
    await prisma.formativeConversationLifecycleEvent.findUnique({
      where: {
        formative_conversation_session_db_id_client_event_id: {
          formative_conversation_session_db_id: session.id,
          client_event_id: parsed.client_event_id
        }
      }
    });
  if (existing) {
    if (existing.event_hash === eventHash) {
      return { event: existing, replayed: true };
    }
    throw new FormativeConversationTelemetryError(
      "telemetry_idempotency_mismatch",
      "The client event ID was already used for different telemetry."
    );
  }

  try {
    const event = await prisma.formativeConversationLifecycleEvent.create({
      data: {
        formative_conversation_session_db_id: session.id,
        client_event_id: parsed.client_event_id,
        event_hash: eventHash,
        event_type: parsed.event_type,
        event_source: parsed.event_source,
        observed_interval_duration_ms:
          parsed.observed_interval_duration_ms ?? null,
        client_instance_id: parsed.client_instance_id ?? null,
        occurred_at: parsed.occurred_at
      }
    });
    return { event, replayed: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const event = await prisma.formativeConversationLifecycleEvent.findUnique({
        where: {
          formative_conversation_session_db_id_client_event_id: {
            formative_conversation_session_db_id: session.id,
            client_event_id: parsed.client_event_id
          }
        }
      });
      if (event?.event_hash === eventHash) {
        return { event, replayed: true };
      }
      throw new FormativeConversationTelemetryError(
        "telemetry_idempotency_mismatch",
        "The client event ID was already used for different telemetry."
      );
    }
    throw error;
  }
}

export async function bindFormativeConversationAgentOperationalTelemetry(
  input: FormativeConversationAgentTelemetryBinding
) {
  const parsed = FormativeConversationAgentTelemetryBindingSchema.parse(input);
  assertObservableOnlyFormativeConversationTelemetry(parsed);
  const session = await getConversationIdentity(parsed.conversation_public_id);
  const agentCall = await prisma.agentCall.findUniqueOrThrow({
    where: { id: parsed.agent_call_db_id }
  });

  if (
    (agentCall.assessment_session_db_id &&
      agentCall.assessment_session_db_id !== session.assessment_session_db_id) ||
    (agentCall.concept_unit_session_db_id &&
      agentCall.concept_unit_session_db_id !== session.concept_unit_session_db_id) ||
    (agentCall.formative_conversation_session_db_id &&
      agentCall.formative_conversation_session_db_id !== session.id)
  ) {
    throw new FormativeConversationTelemetryError(
      "telemetry_agent_call_mismatch",
      "The agent call does not belong to this formative conversation."
    );
  }

  if (
    agentCall.formative_conversation_session_db_id === session.id &&
    agentCall.formative_conversation_context_version === parsed.context_version
  ) {
    return { agent_call: agentCall, replayed: true };
  }

  const updated = await prisma.agentCall.update({
    where: { id: agentCall.id },
    data: {
      formative_conversation_session_db_id: session.id,
      formative_conversation_context_version: parsed.context_version
    }
  });
  return { agent_call: updated, replayed: false };
}

export async function recordFormativeConversationTurnTelemetry(
  input: FormativeConversationTurnTelemetryInput
) {
  const parsed = FormativeConversationTurnTelemetryInputSchema.parse(input);
  assertObservableOnlyFormativeConversationTelemetry(parsed);
  const session = await getConversationIdentity(parsed.conversation_public_id);
  const turn = await prisma.conversationTurn.findUniqueOrThrow({
    where: { id: parsed.conversation_turn_db_id }
  });

  if (turn.formative_conversation_session_db_id !== session.id) {
    throw new FormativeConversationTelemetryError(
      "telemetry_turn_mismatch",
      "The conversation turn does not belong to this formative conversation."
    );
  }
  if ((turn.message_text ?? "").length !== parsed.message_length_chars) {
    throw new FormativeConversationTelemetryError(
      "telemetry_turn_mismatch",
      "The recorded message length does not match the persisted turn."
    );
  }

  if (parsed.agent_call_db_id) {
    const agentCall = await prisma.agentCall.findUniqueOrThrow({
      where: { id: parsed.agent_call_db_id }
    });
    if (agentCall.formative_conversation_session_db_id !== session.id) {
      throw new FormativeConversationTelemetryError(
        "telemetry_agent_call_mismatch",
        "The turn's agent call is not bound to this formative conversation."
      );
    }
  }
  const existing =
    await prisma.formativeConversationTurnTelemetry.findUnique({
      where: { conversation_turn_db_id: turn.id }
    });
  if (existing) {
    if (
      existing.formative_conversation_session_db_id === session.id &&
      existing.agent_call_db_id === (parsed.agent_call_db_id ?? null) &&
      sameOptionalDate(existing.turn_started_at, parsed.turn_started_at) &&
      sameOptionalDate(existing.turn_submitted_at, parsed.turn_submitted_at) &&
      existing.response_time_ms === (parsed.response_time_ms ?? null) &&
      existing.message_length_chars === parsed.message_length_chars &&
      existing.input_token_count === (parsed.input_token_count ?? null) &&
      existing.output_token_count === (parsed.output_token_count ?? null)
    ) {
      return { telemetry: existing, replayed: true };
    }
    throw new FormativeConversationTelemetryError(
      "telemetry_idempotency_mismatch",
      "Turn telemetry already exists with different measurements."
    );
  }

  try {
    const telemetry = await prisma.formativeConversationTurnTelemetry.create({
      data: {
        formative_conversation_session_db_id: session.id,
        conversation_turn_db_id: turn.id,
        agent_call_db_id: parsed.agent_call_db_id ?? null,
        turn_sequence_index: turn.sequence_index,
        turn_started_at: parsed.turn_started_at ?? null,
        turn_submitted_at: parsed.turn_submitted_at ?? null,
        response_time_ms: parsed.response_time_ms ?? null,
        message_length_chars: parsed.message_length_chars,
        input_token_count: parsed.input_token_count ?? null,
        output_token_count: parsed.output_token_count ?? null
      }
    });
    return { telemetry, replayed: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const telemetry =
        await prisma.formativeConversationTurnTelemetry.findUnique({
          where: { conversation_turn_db_id: turn.id }
        });
      if (
        telemetry &&
        telemetry.formative_conversation_session_db_id === session.id &&
        telemetry.agent_call_db_id === (parsed.agent_call_db_id ?? null) &&
        sameOptionalDate(telemetry.turn_started_at, parsed.turn_started_at) &&
        sameOptionalDate(telemetry.turn_submitted_at, parsed.turn_submitted_at) &&
        telemetry.response_time_ms === (parsed.response_time_ms ?? null) &&
        telemetry.message_length_chars === parsed.message_length_chars &&
        telemetry.input_token_count === (parsed.input_token_count ?? null) &&
        telemetry.output_token_count === (parsed.output_token_count ?? null)
      ) {
        return { telemetry, replayed: true };
      }
      throw new FormativeConversationTelemetryError(
        "telemetry_idempotency_mismatch",
        "Turn telemetry already exists with different measurements."
      );
    }
    throw error;
  }
}

export async function recordFormativeConversationInputTelemetry(
  input: FormativeConversationInputTelemetryInput
) {
  const parsed = FormativeConversationInputTelemetryInputSchema.parse(input);
  assertObservableOnlyFormativeConversationTelemetry(parsed);
  const session = await getConversationIdentity(parsed.conversation_public_id);
  const turn = await prisma.conversationTurn.findUniqueOrThrow({
    where: { id: parsed.conversation_turn_db_id }
  });
  const turnPayload = asObject(turn.structured_payload);

  if (
    turn.formative_conversation_session_db_id !== session.id ||
    turn.actor_type !== "student" ||
    (turn.message_text ?? "").length !== parsed.final_message_length_chars ||
    (typeof turnPayload.client_message_id === "string" &&
      turnPayload.client_message_id !== parsed.client_message_id)
  ) {
    throw new FormativeConversationTelemetryError(
      "telemetry_turn_mismatch",
      "Input telemetry does not match the persisted student turn."
    );
  }
  const existing =
    await prisma.formativeConversationInputTelemetry.findUnique({
      where: { conversation_turn_db_id: turn.id }
    });
  if (existing) {
    if (
      existing.formative_conversation_session_db_id === session.id &&
      existing.client_message_id === parsed.client_message_id &&
      sameOptionalDate(existing.typing_started_at, parsed.typing_started_at) &&
      sameOptionalDate(existing.typing_ended_at, parsed.typing_ended_at) &&
      existing.typing_duration_ms === (parsed.typing_duration_ms ?? null) &&
      existing.typing_duration_method ===
        (parsed.typing_duration_method ?? null) &&
      existing.edit_count === parsed.edit_count &&
      existing.backspace_count === parsed.backspace_count &&
      existing.paste_event_count === parsed.paste_event_count &&
      existing.final_message_length_chars ===
        parsed.final_message_length_chars &&
      existing.submitted_at.toISOString() === parsed.submitted_at.toISOString()
    ) {
      return { telemetry: existing, replayed: true };
    }
    throw new FormativeConversationTelemetryError(
      "telemetry_idempotency_mismatch",
      "Input telemetry already exists with different measurements."
    );
  }

  try {
    const telemetry = await prisma.formativeConversationInputTelemetry.create({
      data: {
        formative_conversation_session_db_id: session.id,
        conversation_turn_db_id: turn.id,
        client_message_id: parsed.client_message_id,
        typing_started_at: parsed.typing_started_at ?? null,
        typing_ended_at: parsed.typing_ended_at ?? null,
        typing_duration_ms: parsed.typing_duration_ms ?? null,
        typing_duration_method: parsed.typing_duration_method ?? null,
        edit_count: parsed.edit_count,
        backspace_count: parsed.backspace_count,
        paste_event_count: parsed.paste_event_count,
        final_message_length_chars: parsed.final_message_length_chars,
        submitted_at: parsed.submitted_at
      }
    });
    return { telemetry, replayed: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const telemetry =
        await prisma.formativeConversationInputTelemetry.findUnique({
          where: { conversation_turn_db_id: turn.id }
        });
      if (
        telemetry &&
        telemetry.formative_conversation_session_db_id === session.id &&
        telemetry.client_message_id === parsed.client_message_id &&
        sameOptionalDate(telemetry.typing_started_at, parsed.typing_started_at) &&
        sameOptionalDate(telemetry.typing_ended_at, parsed.typing_ended_at) &&
        telemetry.typing_duration_ms === (parsed.typing_duration_ms ?? null) &&
        telemetry.typing_duration_method ===
          (parsed.typing_duration_method ?? null) &&
        telemetry.edit_count === parsed.edit_count &&
        telemetry.backspace_count === parsed.backspace_count &&
        telemetry.paste_event_count === parsed.paste_event_count &&
        telemetry.final_message_length_chars ===
          parsed.final_message_length_chars &&
        telemetry.submitted_at.toISOString() === parsed.submitted_at.toISOString()
      ) {
        return { telemetry, replayed: true };
      }
      throw new FormativeConversationTelemetryError(
        "telemetry_idempotency_mismatch",
        "Input telemetry already exists with different measurements."
      );
    }
    throw error;
  }
}

export async function recordFormativeConversationProfileTransition(
  input: FormativeConversationProfileTransitionInput
) {
  const parsed = FormativeConversationProfileTransitionInputSchema.parse(input);
  assertObservableOnlyFormativeConversationTelemetry(parsed);
  const session = await getConversationIdentity(parsed.conversation_public_id);
  const existing = await prisma.formativeConversationProfileTransition.findUnique({
    where: {
      formative_conversation_session_db_id_updated_student_profile_db_id: {
        formative_conversation_session_db_id: session.id,
        updated_student_profile_db_id: parsed.updated_student_profile_db_id
      }
    }
  });
  if (existing) {
    if (
      existing.prior_student_profile_db_id ===
        parsed.prior_student_profile_db_id &&
      existing.assessment_student_profile_db_id ===
        parsed.assessment_student_profile_db_id &&
      existing.source_turn_db_id === parsed.source_turn_db_id &&
      existing.source_agent_call_db_id ===
        parsed.source_agent_call_db_id &&
      existing.learning_outcome === parsed.learning_outcome &&
      existing.evidence_interpretation ===
        parsed.evidence_interpretation &&
      existing.transitioned_at.toISOString() ===
        parsed.transitioned_at.toISOString()
    ) {
      return { transition: existing, replayed: true };
    }
    throw new FormativeConversationTelemetryError(
      "telemetry_idempotency_mismatch",
      "The updated profile already has different transition provenance."
    );
  }

  return prisma.$transaction(async (tx) => {
    const expectedProfileIds = [
      ...new Set([
        parsed.prior_student_profile_db_id,
        parsed.updated_student_profile_db_id,
        parsed.assessment_student_profile_db_id
      ])
    ];
    const profiles = await tx.studentProfile.findMany({
      where: {
        id: {
          in: expectedProfileIds
        },
        concept_unit_session_db_id: session.concept_unit_session_db_id
      },
      select: { id: true }
    });
    if (profiles.length !== expectedProfileIds.length) {
      throw new FormativeConversationTelemetryError(
        "telemetry_profile_mismatch",
        "A profile does not belong to this formative conversation."
      );
    }
    const supportingTurnIds = [
      ...new Set([
        ...parsed.supporting_turn_db_ids,
        parsed.source_turn_db_id
      ])
    ];
    const supportingTurns = await tx.conversationTurn.findMany({
      where: {
        id: { in: supportingTurnIds },
        formative_conversation_session_db_id: session.id
      },
      select: {
        id: true,
        actor_type: true
      }
    });
    if (
      supportingTurns.length !== supportingTurnIds.length ||
      !supportingTurns.some((turn) => turn.actor_type === "student") ||
      !supportingTurns.some((turn) => turn.actor_type === "agent")
    ) {
      throw new FormativeConversationTelemetryError(
        "telemetry_turn_mismatch",
        "Profile transition evidence turns must include student and tutor turns from this conversation."
      );
    }
    const sourceAgentCall = await tx.agentCall.findUniqueOrThrow({
      where: { id: parsed.source_agent_call_db_id },
      select: { formative_conversation_session_db_id: true }
    });
    if (sourceAgentCall.formative_conversation_session_db_id !== session.id) {
      throw new FormativeConversationTelemetryError(
        "telemetry_agent_call_mismatch",
        "The profile transition agent call belongs to another conversation."
      );
    }

    const updated = await tx.formativeConversationSession.updateMany({
      where: {
        id: session.id,
        current_student_profile_db_id: parsed.prior_student_profile_db_id
      },
      data: {
        current_student_profile_db_id: parsed.updated_student_profile_db_id,
        last_activity_at: parsed.transitioned_at,
        concurrency_version: { increment: 1 }
      }
    });
    if (updated.count !== 1) {
      throw new FormativeConversationTelemetryError(
        "telemetry_profile_transition_stale",
        "The current profile changed before this transition was recorded."
      );
    }

    const transition = await tx.formativeConversationProfileTransition.create({
      data: {
        formative_conversation_session_db_id: session.id,
        prior_student_profile_db_id: parsed.prior_student_profile_db_id,
        updated_student_profile_db_id: parsed.updated_student_profile_db_id,
        assessment_student_profile_db_id:
          parsed.assessment_student_profile_db_id,
        source_turn_db_id: parsed.source_turn_db_id,
        source_agent_call_db_id: parsed.source_agent_call_db_id,
        transition_version: parsed.transition_version,
        learning_outcome: parsed.learning_outcome,
        learning_observations:
          parsed.learning_observations as Prisma.InputJsonValue,
        evidence_interpretation: parsed.evidence_interpretation,
        profile_snapshot:
          parsed.profile_snapshot as Prisma.InputJsonValue,
        transitioned_at: parsed.transitioned_at
      }
    });
    await tx.formativeConversationProfileTransitionTurnReference.createMany({
      data: supportingTurns.map((turn) => ({
        profile_transition_db_id: transition.id,
        conversation_turn_db_id: turn.id,
        evidence_role:
          turn.actor_type === "student"
            ? "student_evidence"
            : "tutor_interpretation"
      }))
    });
    return { transition, replayed: false };
  });
}

function sumNullable(values: Array<number | null>) {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export async function getFormativeConversationTelemetrySummary(
  conversationPublicId: string
) {
  const session = await prisma.formativeConversationSession.findUnique({
    where: { conversation_public_id: conversationPublicId },
    include: {
      lifecycle_events: { orderBy: { occurred_at: "asc" } },
      conversation_turns: {
        select: { id: true }
      },
      turn_telemetry: { orderBy: { turn_sequence_index: "asc" } },
      agent_calls: {
        orderBy: { created_at: "asc" },
        select: {
          input_tokens: true,
          output_tokens: true,
          total_tokens: true,
          latency_ms: true,
          retry_count: true,
          completed_at: true
        }
      },
      profile_transitions: {
        orderBy: { transitioned_at: "asc" },
        select: { transitioned_at: true }
      }
    }
  });
  if (!session) {
    throw new FormativeConversationTelemetryError(
      "conversation_not_found",
      "The formative conversation does not exist."
    );
  }

  const completionEvent = session.lifecycle_events.find(
    (event) => event.event_type === "completed"
  );
  const observedTimes = [
    session.started_at,
    session.last_activity_at,
    session.completed_at,
    completionEvent?.occurred_at,
    ...session.lifecycle_events.map((event) => event.occurred_at),
    ...session.turn_telemetry.flatMap((turn) => [
      turn.turn_started_at,
      turn.turn_submitted_at
    ]),
    ...session.agent_calls.map((call) => call.completed_at),
    ...session.profile_transitions.map((transition) => transition.transitioned_at)
  ].filter((value): value is Date => Boolean(value));
  const observedEnd = observedTimes.reduce(
    (latest, value) => (value > latest ? value : latest),
    session.started_at
  );
  const lifecycleEventCounts = Object.fromEntries(
    [
      "page_visible",
      "page_hidden",
      "left",
      "reentered",
      "refreshed",
      "paused",
      "resumed",
      "disconnected",
      "reconnected",
      "completed"
    ].map((eventType) => [
      eventType,
      session.lifecycle_events.filter((event) => event.event_type === eventType)
        .length
    ])
  );
  const latencies = session.agent_calls.flatMap((call) =>
    call.latency_ms === null ? [] : [call.latency_ms]
  );

  const summary = {
    conversation_public_id: session.conversation_public_id,
    session_duration_ms: Math.max(
      0,
      observedEnd.getTime() - session.started_at.getTime()
    ),
    turn_count: session.conversation_turns.length,
    turn_telemetry_count: session.turn_telemetry.length,
    input_token_count: sumNullable(
      session.agent_calls.map((call) => call.input_tokens)
    ),
    output_token_count: sumNullable(
      session.agent_calls.map((call) => call.output_tokens)
    ),
    total_token_count: sumNullable(
      session.agent_calls.map((call) => call.total_tokens)
    ),
    llm_call_count: session.agent_calls.length,
    llm_latency_ms_total: latencies.reduce(
      (total, latency) => total + latency,
      0
    ),
    llm_latency_ms_average:
      latencies.length > 0
        ? Math.round(
            latencies.reduce((total, latency) => total + latency, 0) /
              latencies.length
          )
        : null,
    retry_count: session.agent_calls.reduce(
      (total, call) => total + call.retry_count,
      0
    ),
    lifecycle_event_counts: lifecycleEventCounts,
    pause_count: lifecycleEventCounts.paused,
    resume_count: lifecycleEventCounts.resumed,
    completion_observed:
      session.status === "completed" || Boolean(completionEvent),
    completed_at:
      session.completed_at?.toISOString() ??
      completionEvent?.occurred_at.toISOString() ??
      null,
    profile_transition_count: session.profile_transitions.length,
    latest_profile_transition_at:
      session.profile_transitions.at(-1)?.transitioned_at.toISOString() ?? null
  };
  assertObservableOnlyFormativeConversationTelemetry(summary);
  return summary;
}
