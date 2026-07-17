import { FORMATIVE_ACTIVITY_AGENT_NAME } from "@/lib/services/student-assessment/formative-activity-design";
import { STUDENT_COMMUNICATION_AGENT_NAME } from "@/lib/services/student-assessment/student-communication-agent";
import { TOPIC_DIALOGUE_AGENT_NAME } from "@/lib/services/student-assessment/topic-dialogue-agent";

export const FORMATIVE_DIALOGUE_ROUTING_CONTRACT_VERSION =
  "formative-dialogue-routing-v1" as const;

export const FORMATIVE_DIALOGUE_CONTEXT_REQUIREMENTS = [
  "distractor_anchor",
  "current_learning_target",
  "visible_transcript",
  "internal_evidence_history",
  "current_profile",
  "current_formative_plan",
  "latest_student_message",
  "strategies_already_attempted",
  "strategies_not_to_repeat"
] as const;

export type FormativeDialogueRouteCase =
  | "initial_activity_generation"
  | "first_activity_response"
  | "repeated_student_confusion"
  | "activity_instruction_clarification"
  | "replacement_activity_generation"
  | "off_topic_response"
  | "revision_readiness"
  | "transfer_readiness"
  | "provider_failure_recovery";

export type FormativeDialogueRoute = {
  role:
    | typeof FORMATIVE_ACTIVITY_AGENT_NAME
    | typeof TOPIC_DIALOGUE_AGENT_NAME
    | typeof STUDENT_COMMUNICATION_AGENT_NAME;
  responsibility: string;
  platform_owns_transition: boolean;
  deterministic_recovery_allowed: boolean;
};

export const FORMATIVE_DIALOGUE_ROUTING_CONTRACT = {
  initial_activity_generation: {
    role: FORMATIVE_ACTIVITY_AGENT_NAME,
    responsibility: "Generate the first distractor-focused activity prompt from the validated profile and plan.",
    platform_owns_transition: true,
    deterministic_recovery_allowed: false
  },
  first_activity_response: {
    role: TOPIC_DIALOGUE_AGENT_NAME,
    responsibility: "Respond to the first student turn after evaluation, profile update, and planning update.",
    platform_owns_transition: true,
    deterministic_recovery_allowed: true
  },
  repeated_student_confusion: {
    role: TOPIC_DIALOGUE_AGENT_NAME,
    responsibility: "Clarify the active distractor-focused task without switching to generic tutoring.",
    platform_owns_transition: true,
    deterministic_recovery_allowed: true
  },
  activity_instruction_clarification: {
    role: TOPIC_DIALOGUE_AGENT_NAME,
    responsibility: "Clarify what the current activity asks while retaining its distractor anchor and learning target.",
    platform_owns_transition: true,
    deterministic_recovery_allowed: true
  },
  replacement_activity_generation: {
    role: FORMATIVE_ACTIVITY_AGENT_NAME,
    responsibility: "Generate one genuinely different distractor-focused activity as a new immutable attempt.",
    platform_owns_transition: true,
    deterministic_recovery_allowed: false
  },
  off_topic_response: {
    role: TOPIC_DIALOGUE_AGENT_NAME,
    responsibility: "Redirect the student to the active assessment topic and distractor-focused task.",
    platform_owns_transition: true,
    deterministic_recovery_allowed: true
  },
  revision_readiness: {
    role: TOPIC_DIALOGUE_AGENT_NAME,
    responsibility: "Communicate the validated readiness recommendation; the platform decides and executes revision routing.",
    platform_owns_transition: true,
    deterministic_recovery_allowed: true
  },
  transfer_readiness: {
    role: TOPIC_DIALOGUE_AGENT_NAME,
    responsibility: "Communicate the validated readiness recommendation; the platform decides and executes transfer routing.",
    platform_owns_transition: true,
    deterministic_recovery_allowed: true
  },
  provider_failure_recovery: {
    role: TOPIC_DIALOGUE_AGENT_NAME,
    responsibility: "Persist one bounded recovery message under the active dialogue boundary and keep the episode resumable.",
    platform_owns_transition: true,
    deterministic_recovery_allowed: true
  }
} as const satisfies Record<FormativeDialogueRouteCase, FormativeDialogueRoute>;

export const STUDENT_COMMUNICATION_ROUTING_SCOPE = {
  role: STUDENT_COMMUNICATION_AGENT_NAME,
  responsibility:
    "Render fact-locked package results and feedback; it does not implement iterative formative-activity turns."
} as const;

export function formativeDialogueRoute<RouteCase extends FormativeDialogueRouteCase>(routeCase: RouteCase) {
  return FORMATIVE_DIALOGUE_ROUTING_CONTRACT[routeCase];
}
