import { z } from "zod";

export const FORMATIVE_CONVERSATION_V18R2_LIFECYCLE_VERSION =
  "formative-conversation-lifecycle-v1" as const;
export const FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS = 12 as const;
export const FORMATIVE_CONVERSATION_CURRENT_MAX_STUDENT_TURNS = 30 as const;
export type FormativeConversationTurnLimit = 12 | 30;

// Closed histories retain the policy recorded on their turns, including legacy runs.
export function formativeConversationTurnLimit(input: {
  status: string;
  conversation_turns: readonly { structured_payload: unknown }[];
}): FormativeConversationTurnLimit {
  if (["active", "paused"].includes(input.status)) {
    return FORMATIVE_CONVERSATION_CURRENT_MAX_STUDENT_TURNS;
  }
  for (const turn of [...input.conversation_turns].reverse()) {
    const payload = turn.structured_payload as Record<string, unknown> | null;
    const limit = payload?.max_formative_student_turns ?? payload?.max_student_turns;
    if (limit === 12 || limit === 30) return limit;
  }
  return FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS;
}

export const FormativeConversationV18R2FormativeLifecycleSchema = z
  .object({
    student_turn_index: z
      .number()
      .int()
      .min(0)
      .max(FORMATIVE_CONVERSATION_CURRENT_MAX_STUDENT_TURNS),
    max_student_turns: z.union([z.literal(12), z.literal(30)]),
    final_allowed_turn: z.boolean(),
    another_student_turn_available: z.boolean()
  })
  .strict()
  .superRefine((value, context) => {
    const finalTurn =
      value.student_turn_index ===
      value.max_student_turns;
    if (value.student_turn_index > value.max_student_turns) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["student_turn_index"],
        message: "The formative student turn exceeds the recorded limit." });
    }
    if (value.final_allowed_turn !== finalTurn) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["final_allowed_turn"],
        message: "Only the last allowed formative student turn is final."
      });
    }
    if (value.another_student_turn_available !== (value.student_turn_index < value.max_student_turns)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["another_student_turn_available"],
        message: "Another formative student turn is unavailable at the limit."
      });
    }
  });

export function formativeConversationV18R2LifecycleForTurnCount(
  studentTurnCount: number,
  maxStudentTurns: FormativeConversationTurnLimit = FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS
) {
  return FormativeConversationV18R2FormativeLifecycleSchema.parse({
    student_turn_index: studentTurnCount,
    max_student_turns: maxStudentTurns,
    final_allowed_turn:
      studentTurnCount === maxStudentTurns,
    another_student_turn_available:
      studentTurnCount < maxStudentTurns
  });
}

export function projectFormativeConversationV18R2LifecycleForTurnCount(
  studentTurnCount: number,
  maxStudentTurns: FormativeConversationTurnLimit = FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS
) {
  if (!Number.isInteger(studentTurnCount) || studentTurnCount < 0) {
    throw new Error("formative_conversation_student_turn_count_invalid");
  }
  return {
    student_turn_index: studentTurnCount,
    max_student_turns: maxStudentTurns,
    final_allowed_turn:
      studentTurnCount === maxStudentTurns,
    another_student_turn_available:
      studentTurnCount < maxStudentTurns,
    historical_limit_exceeded:
      studentTurnCount > maxStudentTurns
  } as const;
}
