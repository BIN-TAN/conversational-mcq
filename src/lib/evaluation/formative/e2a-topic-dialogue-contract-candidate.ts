import { z } from "zod";
import {
  TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS_DEFAULT,
  TopicDialogueInputV1Schema
} from "@/lib/services/student-assessment/topic-dialogue-agent";

export const TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V3 =
  "topic-dialogue-input-v3" as const;
export const TOPIC_DIALOGUE_E2A2_CANDIDATE_MAX_STUDENT_TURNS = 10;
export const TOPIC_DIALOGUE_E2A2_CANDIDATE_HISTORY_TURN_LIMIT =
  (TOPIC_DIALOGUE_E2A2_CANDIDATE_MAX_STUDENT_TURNS - 1) * 2;

export const TopicDialogueVisibleHistoryTurnV3Schema = z.object({
  visible_turn_id: z.string().min(1).max(80),
  sequence_index: z.number().int().nonnegative(),
  dialogue_turn_number: z.number().int().positive(),
  actor_type: z.enum(["student", "agent"]),
  message_text: z.string().min(1).max(TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS_DEFAULT)
}).strict();

// Candidate-only input contract. The approved v1/v2 module remains unchanged.
// At the tenth student turn, this carries the nine completed student/assistant
// exchanges exactly and carries the tenth student message separately.
export const TopicDialogueInputV3Schema = TopicDialogueInputV1Schema.omit({
  dialogue_schema_version: true,
  recent_relevant_dialogue_turns: true,
  dialogue_summary: true,
  maximum_dialogue_turns: true
}).extend({
  dialogue_schema_version: z.literal(TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V3),
  visible_dialogue_history: z.array(TopicDialogueVisibleHistoryTurnV3Schema)
    .max(TOPIC_DIALOGUE_E2A2_CANDIDATE_HISTORY_TURN_LIMIT),
  latest_student_turn_id: z.string().min(1).max(80),
  maximum_dialogue_turns: z.number().int().positive()
    .max(TOPIC_DIALOGUE_E2A2_CANDIDATE_MAX_STUDENT_TURNS)
}).strict();
export type TopicDialogueInputV3 = z.infer<typeof TopicDialogueInputV3Schema>;

export type TopicDialogueVisibleHistorySourceTurn = {
  visible_turn_id: string;
  actor_type: "student" | "agent";
  message_text: string | null;
  visibility_status: "shown" | "hidden";
};

export function buildExactTopicDialogueVisibleHistory(input: {
  prior_turns: TopicDialogueVisibleHistorySourceTurn[];
  maximum_student_turns: number;
}) {
  const visible = input.prior_turns.filter((turn) =>
    turn.visibility_status === "shown" && Boolean(turn.message_text?.trim())
  );
  const maximumPriorTurns = (input.maximum_student_turns - 1) * 2;
  if (visible.length > maximumPriorTurns) {
    throw new Error("topic_dialogue_visible_history_exceeds_policy_contract");
  }

  let studentTurnNumber = 0;
  return visible.map((turn, sequenceIndex) => {
    if (turn.actor_type === "student") studentTurnNumber += 1;
    return TopicDialogueVisibleHistoryTurnV3Schema.parse({
      visible_turn_id: turn.visible_turn_id,
      sequence_index: sequenceIndex + 1,
      dialogue_turn_number: Math.max(studentTurnNumber, 1),
      actor_type: turn.actor_type,
      message_text: turn.message_text
    });
  });
}
