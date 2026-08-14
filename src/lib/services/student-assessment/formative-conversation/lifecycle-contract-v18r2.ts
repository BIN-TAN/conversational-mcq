import { z } from "zod";

export const FORMATIVE_CONVERSATION_V18R2_LIFECYCLE_VERSION =
  "formative-conversation-lifecycle-v1" as const;
export const FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS = 12 as const;

export const FormativeConversationV18R2FormativeLifecycleSchema = z
  .object({
    student_turn_index: z
      .number()
      .int()
      .min(0)
      .max(FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS),
    max_student_turns: z.literal(
      FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS
    ),
    final_allowed_turn: z.boolean(),
    another_student_turn_available: z.boolean()
  })
  .strict()
  .superRefine((value, context) => {
    const finalTurn =
      value.student_turn_index ===
      FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS;
    if (value.final_allowed_turn !== finalTurn) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["final_allowed_turn"],
        message: "Only the twelfth formative student turn is final."
      });
    }
    if (value.another_student_turn_available === finalTurn) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["another_student_turn_available"],
        message: "Another formative student turn is unavailable after turn 12."
      });
    }
  });

export function formativeConversationV18R2LifecycleForTurnCount(
  studentTurnCount: number
) {
  return FormativeConversationV18R2FormativeLifecycleSchema.parse({
    student_turn_index: studentTurnCount,
    max_student_turns: FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS,
    final_allowed_turn:
      studentTurnCount === FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS,
    another_student_turn_available:
      studentTurnCount < FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS
  });
}

export function projectFormativeConversationV18R2LifecycleForTurnCount(
  studentTurnCount: number
) {
  if (!Number.isInteger(studentTurnCount) || studentTurnCount < 0) {
    throw new Error("formative_conversation_student_turn_count_invalid");
  }
  return {
    student_turn_index: studentTurnCount,
    max_student_turns: FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS,
    final_allowed_turn:
      studentTurnCount === FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS,
    another_student_turn_available:
      studentTurnCount < FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS,
    historical_limit_exceeded:
      studentTurnCount > FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS
  } as const;
}
