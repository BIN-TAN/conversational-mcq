import { z } from "zod";

export const FORMATIVE_CONVERSATION_TELEMETRY_CONTRACT_VERSION =
  "formative-conversation-telemetry-v1";

export const FormativeConversationLifecycleEventInputSchema = z
  .object({
    conversation_public_id: z.string().min(1),
    client_event_id: z.string().min(1).max(200),
    event_type: z.enum([
      "session_started",
      "student_message_persisted",
      "agent_call_started",
      "agent_call_completed",
      "tutor_message_persisted",
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
    ]),
    event_source: z.enum(["frontend", "backend", "agent", "system"]),
    observed_interval_duration_ms: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional(),
    client_instance_id: z.string().min(1).max(200).nullable().optional(),
    occurred_at: z.coerce.date()
  })
  .strict();

export const FormativeConversationTurnTelemetryInputSchema = z
  .object({
    conversation_public_id: z.string().min(1),
    conversation_turn_db_id: z.string().uuid(),
    agent_call_db_id: z.string().uuid().nullable().optional(),
    turn_started_at: z.coerce.date().nullable().optional(),
    turn_submitted_at: z.coerce.date().nullable().optional(),
    response_time_ms: z.number().int().nonnegative().nullable().optional(),
    message_length_chars: z.number().int().nonnegative(),
    input_token_count: z.number().int().nonnegative().nullable().optional(),
    output_token_count: z.number().int().nonnegative().nullable().optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.turn_started_at &&
      value.turn_submitted_at &&
      value.turn_submitted_at < value.turn_started_at
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["turn_submitted_at"],
        message: "turn_submitted_at must not precede turn_started_at"
      });
    }
  });

export const FormativeConversationInputTelemetryInputSchema = z
  .object({
    conversation_public_id: z.string().min(1),
    conversation_turn_db_id: z.string().uuid(),
    client_message_id: z.string().min(1).max(200),
    typing_started_at: z.coerce.date().nullable().optional(),
    typing_ended_at: z.coerce.date().nullable().optional(),
    typing_duration_ms: z.number().int().nonnegative().nullable().optional(),
    typing_duration_method: z
      .enum(["active_intervals", "elapsed_first_input_to_submit"])
      .nullable()
      .optional(),
    edit_count: z.number().int().nonnegative(),
    backspace_count: z.number().int().nonnegative(),
    paste_event_count: z.number().int().nonnegative(),
    final_message_length_chars: z.number().int().nonnegative(),
    submitted_at: z.coerce.date()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.typing_started_at &&
      value.typing_ended_at &&
      value.typing_ended_at < value.typing_started_at
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["typing_ended_at"],
        message: "typing_ended_at must not precede typing_started_at"
      });
    }
    if (
      (value.typing_duration_ms === null ||
        value.typing_duration_ms === undefined) !==
      (value.typing_duration_method === null ||
        value.typing_duration_method === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["typing_duration_method"],
        message: "typing duration and its measurement method must be recorded together"
      });
    }
  });

export const FormativeConversationAgentTelemetryBindingSchema = z
  .object({
    conversation_public_id: z.string().min(1),
    agent_call_db_id: z.string().uuid(),
    context_version: z.string().min(1).max(200)
  })
  .strict();

export const FormativeConversationProfileTransitionInputSchema = z
  .object({
    conversation_public_id: z.string().min(1),
    prior_student_profile_db_id: z.string().uuid(),
    updated_student_profile_db_id: z.string().uuid(),
    source_turn_db_id: z.string().uuid().nullable().optional(),
    source_agent_call_db_id: z.string().uuid().nullable().optional(),
    transitioned_at: z.coerce.date()
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.source_turn_db_id && !value.source_agent_call_db_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source_turn_db_id"],
        message: "at least one persisted evidence source reference is required"
      });
    }
    if (value.prior_student_profile_db_id === value.updated_student_profile_db_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["updated_student_profile_db_id"],
        message: "updated profile must differ from prior profile"
      });
    }
  });

const INFERRED_TELEMETRY_KEYS = new Set([
  "help_seeking",
  "misconception_resolution",
  "learning_strategy",
  "conversational_depth",
  "confidence_behavior"
]);

export function findInferredTelemetryKeys(value: unknown): string[] {
  const found = new Set<string>();

  const visit = (entry: unknown) => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (!entry || typeof entry !== "object") {
      return;
    }
    for (const [key, nested] of Object.entries(entry)) {
      if (INFERRED_TELEMETRY_KEYS.has(key.toLowerCase())) {
        found.add(key);
      }
      visit(nested);
    }
  };

  visit(value);
  return [...found].sort();
}

export function assertObservableOnlyFormativeConversationTelemetry(value: unknown) {
  const inferredKeys = findInferredTelemetryKeys(value);
  if (inferredKeys.length > 0) {
    throw new Error(
      `formative_conversation_telemetry_inferred_fields_forbidden:${inferredKeys.join(",")}`
    );
  }
}

export type FormativeConversationLifecycleEventInput = z.input<
  typeof FormativeConversationLifecycleEventInputSchema
>;
export type FormativeConversationTurnTelemetryInput = z.input<
  typeof FormativeConversationTurnTelemetryInputSchema
>;
export type FormativeConversationInputTelemetryInput = z.input<
  typeof FormativeConversationInputTelemetryInputSchema
>;
export type FormativeConversationAgentTelemetryBinding = z.input<
  typeof FormativeConversationAgentTelemetryBindingSchema
>;
export type FormativeConversationProfileTransitionInput = z.input<
  typeof FormativeConversationProfileTransitionInputSchema
>;
