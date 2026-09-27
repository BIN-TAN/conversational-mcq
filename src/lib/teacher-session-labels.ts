const phases: Record<string, string> = {
  initial_item_administration: "Answering questions",
  initial_concept_unit_completed: "Questions submitted",
  profiling_pending: "Preparing initial feedback",
  profiling_completed: "Preparing learning conversation",
  planning_pending: "Preparing learning conversation",
  planning_completed: "Learning conversation",
  followup_active: "Learning conversation",
  session_completed: "Assessment completed",
  student_exited: "Attempt ended early"
};

export function teacherPhaseLabel(phase: string, conversationStatus?: string | null) {
  if (phase === "planning_completed" && conversationStatus) {
    if (conversationStatus === "paused") return "Learning conversation paused";
    if (["ended", "completed", "teacher_assistance_recommended"].includes(conversationStatus)) return "Conversation ended; assessment not finished";
  }
  return phases[phase] ?? phase.replaceAll("_", " ");
}
