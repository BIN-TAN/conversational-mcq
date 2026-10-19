import type { Prisma } from "@prisma/client";
import { abilityProfiles, integratedDiagnosticProfiles, evidenceSufficiencyValues } from "@/lib/domain/enums";
import { profileRecordIdentity, profileRecordProvenance, profileSourceCallSelect, type ProfileRecord } from "./profile-record";
import {
  canonicalPersistedFormativeConversationProfileTransitions,
  latestPersistedFormativeConversationProfileTransition
} from "./formative-conversation/profile-projection";

// v3: the label always comes from the profile produced from the submitted mini-test; conversation
// updates are reported separately (conversationUpdateSummary). v3 has no transfer_evidence_status:
// the mini-test has no transfer task (D13, initial-profile-transfer-labels.ts).
export const UNDERSTANDING_SUMMARY_VERSION = "understanding-summary-v3" as const;
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

// Latest validated profile, including updates recommended during the formative conversation.
// Used where the conversation's current state matters; reporting categories use initialLearningProfile.
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

type LearningConversation = LearningSession["formative_conversation_sessions"][number];

// The profile produced from the submitted mini-test, paired with its conversation. Conversation
// updates are stored as separate profile records and never replace this profile in reports.
function initialLearningProfilePair(session: LearningSession): { profile: LearningProfile; conversation: LearningConversation | null } | null {
  const pairs = session.concept_unit_sessions.flatMap(entry => {
    const conversation = session.formative_conversation_sessions.find(candidate => candidate.concept_unit_session_db_id === entry.id) ?? null;
    const profile = conversation?.initial_student_profile ?? entry.latest_student_profile;
    return profile ? [{ profile, conversation }] : [];
  });
  return pairs.sort((a, b) => b.profile.created_at.getTime() - a.profile.created_at.getTime() ||
    a.profile.id.localeCompare(b.profile.id))[0] ?? null;
}

export function initialLearningProfile(session: LearningSession): LearningProfile | null {
  return initialLearningProfilePair(session)?.profile ?? null;
}

export const CONVERSATION_UPDATE_SUMMARY_VERSION = "conversation-update-summary-v1" as const;
export const CONVERSATION_UPDATE_LABELS = [
  "Sound understanding", "Largely improved understanding", "Instructor assistance recommended", "No profile update"
] as const;
export type ConversationUpdateLabel = typeof CONVERSATION_UPDATE_LABELS[number];
const conversationOutcomeLabels: Record<string, ConversationUpdateLabel> = {
  sound: "Sound understanding",
  largely_improved: "Largely improved understanding",
  teacher_assistance_recommended: "Instructor assistance recommended"
};

// Separate variable for what the formative conversation recommended after the mini-test profile.
export function conversationUpdateSummary(session: LearningSession) {
  const conversation = initialLearningProfilePair(session)?.conversation ?? null;
  const transitions = conversation
    ? canonicalPersistedFormativeConversationProfileTransitions(conversation.profile_transitions)
    : [];
  const latest = latestPersistedFormativeConversationProfileTransition(transitions);
  const updatedProfile = latest?.updated_student_profile ?? null;
  return {
    conversation_update_summary_version: CONVERSATION_UPDATE_SUMMARY_VERSION,
    conversation_profile_update: (latest?.learning_outcome
      ? conversationOutcomeLabels[latest.learning_outcome] ?? "No profile update"
      : "No profile update") as ConversationUpdateLabel,
    conversation_profile_update_count: transitions.length,
    conversation_updated_understanding_label: updatedProfile ? learningProfileSummary(updatedProfile).understanding_label : null,
    conversation_updated_profile_record_id: updatedProfile ? profileRecordIdentity(updatedProfile.id) : null
  };
}

export const CONVERSATION_UPDATE_SUMMARY_DEFINITIONS = {
  conversation_update_summary_version: "Read-only classification version for the conversation update variables. Does not rewrite stored profiles or transitions.",
  conversation_profile_update: "Outcome of the latest validated profile update recommended during the formative conversation for the same mini-test: Sound understanding, Largely improved understanding, or Instructor assistance recommended. No profile update when the student did not converse, stopped, or no recommendation passed validation. Stored separately from understanding_label, which always describes the profile produced from the submitted mini-test.",
  conversation_profile_update_count: "Number of validated profile updates recorded during the conversation for this mini-test.",
  conversation_updated_understanding_label: "Dashboard label derived with the same fixed rules from the latest updated profile; blank when no update was recorded. Not a reassessment of the original responses.",
  conversation_updated_profile_record_id: "Updated profile record behind conversation_updated_understanding_label; join profile_record_id. Blank when no update was recorded."
} as const;
export const CONVERSATION_UPDATE_SUMMARY_COLUMNS = Object.keys(CONVERSATION_UPDATE_SUMMARY_DEFINITIONS) as Array<keyof typeof CONVERSATION_UPDATE_SUMMARY_DEFINITIONS>;

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
    } else if (["partial_understanding", "fragile_correct_understanding", "procedural_or_application_error"].includes(profile.ability_profile)) {
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
    understanding_profile_created_at: profile?.created_at.toISOString() ?? null
  };
}

export const UNDERSTANDING_SUMMARY_DEFINITIONS = {
  understanding_summary_version: "Read-only classification version. Does not rewrite stored profiles, answers or historical AI messages.",
  understanding_label: "Shared dashboard/export label from the profile produced from the submitted mini-test, before any conversation. Updates recommended during the conversation never change it; they are reported in the conversation update variables. Missing, fallback, intermediate, unverified, insufficient or conflicting evidence is unavailable, never a deficit. Supported difficulty/misconception maps to Need more work; native partial/fragile/error ability to Still developing; native mostly-correct or robust understanding otherwise to Mostly understood. An integrated fragile-reasoning focus or uncertain-independence qualifier alone does not override native mostly-correct understanding; the caution is retained separately. Not a grade. The mini-test has no transfer task, so transfer is not assessed; from the 2026-10-19 rule (initial-profile-transfer-labels-blocked-v1) the mini-test profile is saved without transfer labels, so robust_transfer_ready_understanding appears only in mini-test profiles saved before that rule or in conversation updates backed by independent transfer evidence.",
  understanding_reason: "Deterministic mapping reason, not a new AI judgment; see understanding_label and the linked original profile.",
  understanding_caution: "reasoning_refinement_needed for the stored correct-but-fragile integrated diagnosis; independent_understanding_uncertain for that stored integrated diagnosis; profile_unavailable without eligible provenance; none_added otherwise. This is a retained diagnostic qualifier, not proof that no other limitations exist. Native mostly-correct understanding may coexist with a need to refine some reasoning.",
  understanding_profile_record_id: "Profile used for this summary; join profile_record_id. This is the conversation's initial profile, otherwise the topic's profile pointer for attempts without a conversation. Multiple topics use the most recently created profile, not an average across topics.",
  understanding_profile_stage: "baseline for an eligible mini-test profile, unavailable otherwise. updated appears only for legacy attempts whose profile pointer was replaced before conversation updates were stored separately.",
  understanding_profile_created_at: "Original profile creation time, not the export time. Does not represent a new observation when re-exported."
} as const;
export const UNDERSTANDING_SUMMARY_COLUMNS = Object.keys(UNDERSTANDING_SUMMARY_DEFINITIONS) as Array<keyof typeof UNDERSTANDING_SUMMARY_DEFINITIONS>;
