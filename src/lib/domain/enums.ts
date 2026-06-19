import { z } from "zod";

export const userRoles = ["student", "teacher_researcher"] as const;
export const UserRoleSchema = z.enum(userRoles);

export const assessmentStatuses = ["draft", "published", "archived"] as const;
export const AssessmentStatusSchema = z.enum(assessmentStatuses);

export const conceptUnitStatuses = ["draft", "published", "archived"] as const;
export const ConceptUnitStatusSchema = z.enum(conceptUnitStatuses);

export const itemStatuses = ["draft", "published", "archived"] as const;
export const ItemStatusSchema = z.enum(itemStatuses);

export const assessmentPhases = [
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
  "between_concept_units",
  "session_completed",
  "student_exited",
  "needs_review"
] as const;
export const AssessmentPhaseSchema = z.enum(assessmentPhases);

export const sessionStatuses = [
  "not_started",
  "active",
  "paused",
  "completed",
  "student_exited",
  "needs_review"
] as const;
export const SessionStatusSchema = z.enum(sessionStatuses);

export const conceptUnitSessionStatuses = [
  "not_started",
  "initial_in_progress",
  "initial_completed",
  "followup_active",
  "followup_completed",
  "completed",
  "student_exited",
  "needs_review"
] as const;
export const ConceptUnitSessionStatusSchema = z.enum(conceptUnitSessionStatuses);

export const followupStatuses = [
  "not_started",
  "active",
  "stopped",
  "completed",
  "incomplete",
  "needs_review"
] as const;
export const FollowupStatusSchema = z.enum(followupStatuses);

export const responseCorrectnessValues = [
  "not_scored",
  "correct",
  "incorrect",
  "unanswered"
] as const;
export const ResponseCorrectnessSchema = z.enum(responseCorrectnessValues);

export const confidenceLevels = ["low", "medium", "high"] as const;
export const ConfidenceLevelSchema = z.enum(confidenceLevels);

export const actorTypes = ["student", "agent", "system", "orchestrator", "teacher_researcher"] as const;
export const ActorTypeSchema = z.enum(actorTypes);

export const eventSources = ["frontend", "backend", "agent", "system"] as const;
export const EventSourceSchema = z.enum(eventSources);

export const processEventTypes = [
  "session_started",
  "session_resumed",
  "session_exited",
  "session_completed",
  "session_marked_needs_review",
  "phase_entered",
  "phase_exited",
  "transition_validated",
  "transition_rejected",
  "item_presented",
  "option_selected",
  "reasoning_entered",
  "reasoning_revised",
  "confidence_selected",
  "item_submitted",
  "missing_evidence_detected",
  "missing_evidence_repair_prompted",
  "missing_evidence_skipped",
  "invalid_help_request",
  "prompt_injection_attempt",
  "procedural_clarification_request",
  "emotional_or_frustration_response",
  "disengagement_check",
  "off_topic_followup",
  "page_hidden",
  "page_visible",
  "long_pause",
  "inactivity_detected",
  "navigation_event",
  "refresh_recovery",
  "agent_call_started",
  "agent_call_succeeded",
  "agent_call_failed",
  "schema_validation_succeeded",
  "schema_validation_failed",
  "agent_retry_scheduled",
  "schema_repair_attempted",
  "followup_started",
  "followup_turn_completed",
  "followup_task_assigned",
  "followup_evidence_triggered",
  "followup_stopped",
  "move_next_requested",
  "export_requested",
  "export_completed",
  "export_failed"
] as const;
export const ProcessEventTypeSchema = z.enum(processEventTypes);

export const agentCallStatuses = [
  "started",
  "succeeded",
  "failed",
  "invalid_output",
  "needs_review"
] as const;
export const AgentCallStatusSchema = z.enum(agentCallStatuses);

export const profileTypes = ["initial", "updated"] as const;
export const ProfileTypeSchema = z.enum(profileTypes);

export const abilityProfiles = [
  "insufficient_evidence",
  "minimal_or_no_demonstrated_understanding",
  "fragmented_or_limited_understanding",
  "partial_understanding",
  "misconception_based_understanding",
  "fragile_correct_understanding",
  "procedural_or_application_error",
  "mostly_correct_understanding",
  "robust_transfer_ready_understanding"
] as const;
export const AbilityProfileSchema = z.enum(abilityProfiles);

export const abilityPatternFlags = [
  "misconception_indicator_present",
  "distractor_aligned_reasoning",
  "correct_answer_weak_reasoning",
  "incorrect_answer_strong_partial_reasoning",
  "correctness_reasoning_mismatch",
  "confidence_reasoning_mismatch",
  "guessing_possible",
  "procedural_error_possible",
  "conceptual_error_possible",
  "incomplete_reasoning",
  "transfer_ready",
  "no_clear_pattern"
] as const;
export const AbilityPatternFlagSchema = z.enum(abilityPatternFlags);

export const engagementProfiles = [
  "insufficient_process_evidence",
  "low_engagement",
  "variable_engagement",
  "adequate_engagement",
  "productive_engagement",
  "sustained_high_engagement"
] as const;
export const EngagementProfileSchema = z.enum(engagementProfiles);

export const engagementPatternFlags = [
  "sustained_engagement",
  "productive_struggle",
  "incomplete_participation",
  "skipped_reasoning",
  "skipped_confidence",
  "low_information_response",
  "long_pause_present",
  "page_switching_present",
  "repeated_revision_present",
  "resource_mediated_engagement_possible",
  "off_topic_pattern",
  "no_clear_pattern"
] as const;
export const EngagementPatternFlagSchema = z.enum(engagementPatternFlags);

export const integratedDiagnosticProfiles = [
  "insufficient_evidence_for_formative_decision",
  "low_engagement_limits_interpretability",
  "conflicting_evidence_needs_clarification",
  "developing_understanding_with_productive_engagement",
  "misconception_with_sufficient_engagement",
  "correct_but_fragile_understanding",
  "correct_but_independence_uncertain",
  "underconfident_but_reasoning_supported",
  "robust_understanding_ready_for_transfer"
] as const;
export const IntegratedDiagnosticProfileSchema = z.enum(integratedDiagnosticProfiles);

export const evidenceSufficiencyValues = ["insufficient", "limited", "adequate", "strong"] as const;
export const EvidenceSufficiencySchema = z.enum(evidenceSufficiencyValues);

export const confidenceAlignmentValues = [
  "insufficient_evidence",
  "underconfident",
  "well_calibrated",
  "overconfident",
  "mixed"
] as const;
export const ConfidenceAlignmentSchema = z.enum(confidenceAlignmentValues);

export const independenceInterpretabilityValues = [
  "not_applicable",
  "independent_understanding_likely",
  "independent_understanding_uncertain",
  "insufficient_evidence"
] as const;
export const IndependenceInterpretabilitySchema = z.enum(independenceInterpretabilityValues);

export const formativeValues = [
  "diagnostic_clarification",
  "reasoning_refinement",
  "confidence_calibration",
  "independent_understanding_verification",
  "consolidation_or_transfer"
] as const;
export const FormativeValueSchema = z.enum(formativeValues);

export const followupRoundStatuses = [
  "not_started",
  "active",
  "completed",
  "stopped",
  "needs_review"
] as const;
export const FollowupRoundStatusSchema = z.enum(followupRoundStatuses);

export const exportJobStatuses = ["pending", "processing", "completed", "failed", "expired"] as const;
export const ExportJobStatusSchema = z.enum(exportJobStatuses);

export const responsePackageTypes = [
  "initial_concept_unit_response_package",
  "followup_evidence_update_package",
  "combined_concept_unit_evidence_package"
] as const;
export const ResponsePackageTypeSchema = z.enum(responsePackageTypes);

export type AssessmentPhase = z.infer<typeof AssessmentPhaseSchema>;
export type ActorType = z.infer<typeof ActorTypeSchema>;
export type EventSource = z.infer<typeof EventSourceSchema>;
export type ProcessEventType = z.infer<typeof ProcessEventTypeSchema>;
export type ResponsePackageType = z.infer<typeof ResponsePackageTypeSchema>;
