import { AssessmentPhaseSchema, type AssessmentPhase } from "../domain/enums";

export type PhaseTransitionResult = {
  allowed: boolean;
  reason: string;
};

const activePhaseSet = new Set<AssessmentPhase>([
  "not_started",
  "session_started",
  "concept_unit_intro",
  "initial_item_administration",
  "missing_evidence_repair",
  "initial_concept_unit_completed",
  "profiling_pending",
  "profiling_completed",
  "planning_pending",
  "planning_completed",
  "followup_active",
  "followup_profile_update_pending",
  "followup_planning_update_pending",
  "followup_stopped",
  "between_concept_units"
]);

const phaseTransitions: Record<AssessmentPhase, AssessmentPhase[]> = {
  not_started: ["session_started", "student_exited", "needs_review"],
  session_started: ["concept_unit_intro", "student_exited", "needs_review"],
  concept_unit_intro: ["initial_item_administration", "student_exited", "needs_review"],
  initial_item_administration: [
    "missing_evidence_repair",
    "initial_concept_unit_completed",
    "student_exited",
    "needs_review"
  ],
  missing_evidence_repair: ["initial_item_administration", "student_exited", "needs_review"],
  initial_concept_unit_completed: ["profiling_pending", "student_exited", "needs_review"],
  profiling_pending: ["profiling_completed", "student_exited", "needs_review"],
  profiling_completed: ["planning_pending", "student_exited", "needs_review"],
  planning_pending: ["planning_completed", "student_exited", "needs_review"],
  planning_completed: ["followup_active", "between_concept_units", "student_exited", "needs_review"],
  followup_active: [
    "followup_profile_update_pending",
    "followup_stopped",
    "student_exited",
    "needs_review"
  ],
  followup_profile_update_pending: [
    "followup_planning_update_pending",
    "followup_active",
    "followup_stopped",
    "student_exited",
    "needs_review"
  ],
  followup_planning_update_pending: [
    "followup_active",
    "followup_stopped",
    "student_exited",
    "needs_review"
  ],
  followup_stopped: ["between_concept_units", "student_exited", "needs_review"],
  between_concept_units: ["concept_unit_intro", "session_completed", "student_exited", "needs_review"],
  session_completed: [],
  student_exited: ["session_started", "needs_review"],
  needs_review: []
};

export function validatePhaseTransition(
  fromPhase: AssessmentPhase,
  toPhase: AssessmentPhase
): PhaseTransitionResult {
  const from = AssessmentPhaseSchema.safeParse(fromPhase);
  const to = AssessmentPhaseSchema.safeParse(toPhase);

  if (!from.success) {
    return { allowed: false, reason: `Unknown source phase: ${fromPhase}` };
  }

  if (!to.success) {
    return { allowed: false, reason: `Unknown target phase: ${toPhase}` };
  }

  if (fromPhase === toPhase) {
    return { allowed: true, reason: "Session is already in the requested phase." };
  }

  if (fromPhase === "session_completed") {
    return { allowed: false, reason: "Completed sessions cannot return to active phases." };
  }

  if (toPhase === "student_exited" && activePhaseSet.has(fromPhase)) {
    return { allowed: true, reason: "Active sessions may transition to student_exited." };
  }

  if (toPhase === "needs_review") {
    return { allowed: true, reason: "Blocking failures may transition to needs_review." };
  }

  if (phaseTransitions[fromPhase].includes(toPhase)) {
    return { allowed: true, reason: "Transition is allowed by the deterministic phase map." };
  }

  return {
    allowed: false,
    reason: `Transition from ${fromPhase} to ${toPhase} is not allowed.`
  };
}
