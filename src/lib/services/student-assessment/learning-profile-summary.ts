import type { Prisma } from "@prisma/client";
import { abilityProfiles, integratedDiagnosticProfiles, evidenceSufficiencyValues } from "@/lib/domain/enums";
import { profileRecordIdentity, profileRecordProvenance, profileSourceCallSelect, type ProfileRecord } from "./profile-record";
import {
  canonicalPersistedFormativeConversationProfileTransitions,
  latestPersistedFormativeConversationProfileTransition
} from "./formative-conversation/profile-projection";

export const UNDERSTANDING_SUMMARY_VERSION = "understanding-summary-v1" as const;
export const learningProfileInclude = { based_on_agent_call: { select: profileSourceCallSelect } } as const;

// Reuse the transition validator without loading student messages or provider payloads.
export const learningConversationSelect = {
  concept_unit_session_db_id: true,
  initial_student_profile: { include: learningProfileInclude },
  profile_transitions: {
    select: {
      transition_public_id: true,
      learning_outcome: true,
      transitioned_at: true,
      profile_snapshot: true,
      learning_observations: true,
      evidence_interpretation: true,
      prior_student_profile: { include: learningProfileInclude },
      updated_student_profile: { include: learningProfileInclude },
      supporting_turn_references: {
        select: { conversation_turn: { select: { sequence_index: true, actor_type: true } } }
      }
    }
  }
} as const satisfies Prisma.FormativeConversationSessionSelect;

export type LearningProfile = Prisma.StudentProfileGetPayload<{ include: typeof learningProfileInclude }>;
type LearningSession = {
  concept_unit_sessions: Array<{ id: string; latest_student_profile: LearningProfile | null }>;
  formative_conversation_sessions: Array<Prisma.FormativeConversationSessionGetPayload<{ select: typeof learningConversationSelect }>>;
};

export function latestLearningProfile(session: LearningSession): LearningProfile | null {
  const profiles = session.concept_unit_sessions.flatMap(entry => {
    const conversation = session.formative_conversation_sessions.find(candidate => candidate.concept_unit_session_db_id === entry.id);
    const transition = conversation && latestPersistedFormativeConversationProfileTransition(
      canonicalPersistedFormativeConversationProfileTransitions(conversation.profile_transitions)
    );
    const profile = conversation
      ? transition?.updated_student_profile ?? conversation.initial_student_profile
      : entry.latest_student_profile;
    return profile ? [profile] : [];
  });
  return profiles.sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || a.id.localeCompare(b.id))[0] ?? null;
}

export const UNDERSTANDING_LABELS = [
  "Need more work", "Still developing", "Mostly understood", "Unavailable / insufficient evidence"
] as const;
export type UnderstandingLabel = typeof UNDERSTANDING_LABELS[number];
type SummaryProfile = ProfileRecord & {
  ability_profile: string;
  integrated_diagnostic_profile: string;
  evidence_sufficiency: string;
  created_at: Date;
};

export function learningProfileSummary(profile: SummaryProfile | null) {
  const provenance = profile && profileRecordProvenance(profile);
  let label: UnderstandingLabel = "Unavailable / insufficient evidence";
  let reason = profile ? provenance?.profile_unavailable_reason ?? "unsupported_profile_category" : "no_current_profile";
  const eligible = provenance?.profile_valid_for_learning_analysis === true;
  if (profile && eligible) {
    const diagnostic = profile.integrated_diagnostic_profile;
    if (!(abilityProfiles as readonly string[]).includes(profile.ability_profile) ||
      !(integratedDiagnosticProfiles as readonly string[]).includes(diagnostic) ||
      !(evidenceSufficiencyValues as readonly string[]).includes(profile.evidence_sufficiency)) {
      reason = "unsupported_profile_category";
    } else if (profile.evidence_sufficiency === "insufficient" || profile.ability_profile === "insufficient_evidence" ||
      ["insufficient_evidence_for_formative_decision", "low_engagement_limits_interpretability", "conflicting_evidence_needs_clarification"].includes(diagnostic)) {
      reason = "insufficient_or_conflicting_evidence";
    } else if (diagnostic === "misconception_with_sufficient_engagement" ||
      ["minimal_or_no_demonstrated_understanding", "fragmented_or_limited_understanding", "misconception_based_understanding"].includes(profile.ability_profile)) {
      label = "Need more work";
      reason = "supported_difficulty_or_misconception";
    } else if (diagnostic === "correct_but_independence_uncertain" ||
      ["partial_understanding", "fragile_correct_understanding", "procedural_or_application_error"].includes(profile.ability_profile)) {
      label = "Still developing";
      reason = "partial_fragile_or_uncertain_understanding";
    } else if (["mostly_correct_understanding", "robust_transfer_ready_understanding"].includes(profile.ability_profile)) {
      label = "Mostly understood";
      reason = "supported_understanding_in_assessed_context";
    }
  }
  return {
    understanding_summary_version: UNDERSTANDING_SUMMARY_VERSION,
    understanding_label: label,
    understanding_reason: reason,
    understanding_caution: !eligible ? "profile_unavailable" : profile?.integrated_diagnostic_profile === "correct_but_fragile_understanding"
      ? "reasoning_refinement_needed" : profile?.integrated_diagnostic_profile === "correct_but_independence_uncertain"
        ? "independent_understanding_uncertain" : "none_added",
    understanding_profile_record_id: profile ? profileRecordIdentity(profile.id) : null,
    understanding_profile_stage: eligible ? provenance!.profile_record_role : "unavailable",
    understanding_profile_created_at: profile?.created_at.toISOString() ?? null,
    transfer_evidence_status: !eligible ? "unavailable" : label === "Mostly understood" &&
      profile?.ability_profile === "robust_transfer_ready_understanding" &&
      profile.integrated_diagnostic_profile === "robust_understanding_ready_for_transfer"
      ? "supported_by_profile" : "not_established"
  };
}

export const UNDERSTANDING_SUMMARY_DEFINITIONS = {
  understanding_summary_version: "Read-only classification version. Does not rewrite stored profiles, answers or historical AI messages.",
  understanding_label: "Shared dashboard/export label from the current canonical profile. Missing, fallback, intermediate, unverified, insufficient or conflicting evidence is unavailable, never a deficit. Supported difficulty/misconception maps to Need more work; native partial/fragile/error ability or uncertain independence to Still developing; native mostly-correct or robust understanding otherwise to Mostly understood. An integrated fragile-reasoning focus alone does not override native mostly-correct understanding; the caution is retained separately. Not a grade or proof of transfer.",
  understanding_reason: "Deterministic mapping reason, not a new AI judgment; see understanding_label and the linked original profile.",
  understanding_caution: "reasoning_refinement_needed for the stored correct-but-fragile integrated diagnosis; independent_understanding_uncertain for that stored integrated diagnosis; profile_unavailable without eligible provenance; none_added otherwise. This is a retained diagnostic qualifier, not proof that no other limitations exist. Native mostly-correct understanding may coexist with a need to refine some reasoning.",
  understanding_profile_record_id: "Profile used for this summary; join profile_record_id. Current means the latest validated conversation transition or its initial profile, otherwise the topic's current profile pointer. Multiple topics use the most recently created current profile, not an average across topics.",
  understanding_profile_stage: "baseline or updated for an eligible current profile, unavailable otherwise. Reusing a baseline is not reassessment; completion alone does not update it.",
  understanding_profile_created_at: "Original profile creation time, not the export time. Does not represent a new observation when re-exported.",
  transfer_evidence_status: "supported_by_profile only when both native ability and integrated diagnosis indicate robust transfer and the shared label is Mostly understood; otherwise not_established, or unavailable without eligible provenance. This preserves a validated model interpretation, not proof of general transfer. Missing transfer evidence does not lower otherwise supported understanding."
} as const;
export const UNDERSTANDING_SUMMARY_COLUMNS = Object.keys(UNDERSTANDING_SUMMARY_DEFINITIONS) as Array<keyof typeof UNDERSTANDING_SUMMARY_DEFINITIONS>;
