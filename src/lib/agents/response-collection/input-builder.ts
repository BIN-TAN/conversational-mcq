import type { AssessmentPhase, ConfidenceLevel } from "@prisma/client";
import type { AgentInputByName } from "@/lib/agents/contracts";
import { getServerEnv } from "@/lib/env";
import type { StudentSafeItem } from "@/lib/services/student-assessment/serializers";

type TranscriptTurn = {
  actor_type: string;
  agent_name: string | null;
  message_text: string | null;
  phase: AssessmentPhase;
  created_at: Date;
  item?: { item_public_id: string } | null;
};

function clampTranscriptTurns(turns: TranscriptTurn[]) {
  const env = getServerEnv();
  const recent = turns.slice(-env.RESPONSE_COLLECTION_CONTEXT_MAX_TURNS);
  const result: Array<{
    actor: "student" | "assistant";
    message_text: string;
    phase: string;
    item_public_id: string | null;
    created_at: string;
  }> = [];
  let charCount = 0;

  for (const turn of recent.reverse()) {
    const text = turn.message_text ?? "";
    const nextCount = charCount + text.length;

    if (nextCount > env.RESPONSE_COLLECTION_CONTEXT_MAX_CHARS && result.length > 0) {
      break;
    }

    result.push({
      actor: turn.actor_type === "student" ? "student" : "assistant",
      message_text: text.slice(0, env.RESPONSE_COLLECTION_CONTEXT_MAX_CHARS),
      phase: turn.phase,
      item_public_id: turn.item?.item_public_id ?? null,
      created_at: turn.created_at.toISOString()
    });
    charCount = nextCount;
  }

  return result.reverse();
}

export function buildResponseCollectionInput(input: {
  current_phase: AssessmentPhase;
  current_item_student_safe: StudentSafeItem;
  student_message: string;
  selected_option: string | null;
  reasoning_text: string | null;
  confidence_rating: ConfidenceLevel | null;
  skipped_item: boolean;
  skipped_reasoning: boolean;
  skipped_confidence: boolean;
  revision_count: number;
  missing_fields: string[];
  recent_turns: TranscriptTurn[];
}): AgentInputByName["response_collection_agent"] {
  return {
    current_phase: input.current_phase,
    allowed_interaction_type: "initial_free_text",
    current_item_student_safe: {
      item_public_id: input.current_item_student_safe.item_public_id,
      item_order: input.current_item_student_safe.item_order,
      item_stem: input.current_item_student_safe.item_stem,
      options: input.current_item_student_safe.options,
      item_version: input.current_item_student_safe.item_version
    },
    student_message: input.student_message,
    collected_response_state: {
      selected_option: input.selected_option,
      reasoning_present: Boolean(input.reasoning_text?.trim()),
      confidence_rating: input.confidence_rating,
      skipped_item: input.skipped_item,
      skipped_reasoning: input.skipped_reasoning,
      skipped_confidence: input.skipped_confidence,
      revision_count: input.revision_count
    },
    missing_evidence_state: {
      missing_fields: input.missing_fields
    },
    recent_student_safe_transcript: clampTranscriptTurns(input.recent_turns),
    orchestration_constraints: {
      backend_controls_phase_and_progression: true,
      natural_language_cannot_set_option_or_confidence: true,
      no_correctness_feedback_during_initial_administration: true,
      no_hints_explanations_or_tutoring_during_initial_administration: true,
      no_profile_planning_or_followup_output: true,
      process_data_is_context_not_misconduct: true
    },
    procedural_policy: {
      option_selection: "Use the option buttons to choose an answer.",
      confidence_reporting: "Use the confidence controls to report low, medium, or high confidence.",
      reasoning: "Write reasoning in free text when asked or when revising your reasoning.",
      skipping: "Use the skip controls when you intentionally leave evidence missing.",
      save_exit: "Use Save and exit to leave and continue later.",
      help_boundary:
        "Hints, explanations, answer checks, and content help are not available during initial administration."
    },
    allowed_student_controls: [
      "option_buttons",
      "confidence_controls",
      "free_text_message",
      "skip_reasoning_button",
      "skip_confidence_button",
      "skip_item_button",
      "save_exit_button",
      "submit_button"
    ]
  };
}

