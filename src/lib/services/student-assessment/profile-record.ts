import { createHash } from "node:crypto";
import { parseCanonicalMisconceptionClaimCatalog } from "@/lib/domain/misconception-claim-identity";
import { asArray, asRecord } from "@/lib/services/teacher-review/serializers";

export const PROFILE_PROJECTION_VERSION = "profile-record-projection-v2";
export const PROFILE_PROVENANCE_COLUMNS = [
  "profile_projection_version", "profile_record_id", "profile_record_role",
  "profile_validation_status", "profile_valid_for_learning_analysis",
  "profile_source_agent_call_public_id", "profile_source_agent_name",
  "profile_source_call_status", "profile_source_output_validated",
  "profile_source_prompt_version", "profile_source_schema_version", "profile_unavailable_reason",
  "profile_dimensions_status", "profile_native_confidence_alignment", "profile_confidence_alignment_scope"
] as const;
export const PROFILE_EVIDENCE_COLUMNS = [
  "misconception_indicator_count", "misconception_claim_count", "item_level_evidence_count",
  "item_level_evidence_available", "item_level_evidence_format"
] as const;

export const profileSourceCallSelect = {
  agent_call_public_id: true,
  agent_name: true,
  call_status: true,
  output_validated: true,
  prompt_version: true,
  schema_version: true
} as const;

export type ProfileRecord = {
  id: string;
  profile_type: string;
  item_level_evidence: unknown;
  misconception_indicators: unknown;
  process_interpretation_cautions: unknown;
  confidence_alignment: string;
  based_on_agent_call?: {
    agent_call_public_id?: string;
    agent_name: string;
    call_status: string;
    output_validated: boolean;
    prompt_version?: string;
    schema_version?: string;
  } | null;
};

export function profileRecordIdentity(id: string) {
  return `profile_${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
}

export function profileRecordProvenance(profile: ProfileRecord) {
  const call = profile.based_on_agent_call;
  const evidence = asRecord(profile.item_level_evidence);
  const fallback = asArray(profile.process_interpretation_cautions).some(
    (entry) => typeof entry === "string" && /fallback-derived profile/i.test(entry)
  );
  const intermediate = Boolean(evidence.evidence_integrated_profile_v2) ||
    Boolean(evidence.source_packets) || call?.agent_name === "formative_value_and_planning_agent";
  const validated = !fallback && !intermediate && call?.output_validated === true &&
    call.call_status === "succeeded" &&
    ["student_profiling_agent", "formative_conversation_agent"].includes(call.agent_name);
  const status = fallback ? "fallback" : intermediate ? "intermediate" : validated ? "validated" : "unverified";
  const role = intermediate ? "intermediate" : profile.profile_type === "updated" ? "updated" : "baseline";
  return {
    profile_projection_version: PROFILE_PROJECTION_VERSION,
    profile_record_id: profileRecordIdentity(profile.id),
    profile_record_role: role,
    profile_validation_status: status,
    profile_valid_for_learning_analysis: validated,
    profile_source_agent_call_public_id: call?.agent_call_public_id ?? null,
    profile_source_agent_name: call?.agent_name ?? null,
    profile_source_call_status: call?.call_status ?? null,
    profile_source_output_validated: call?.output_validated ?? null,
    profile_source_prompt_version: call?.prompt_version ?? null,
    profile_source_schema_version: call?.schema_version ?? null,
    profile_dimensions_status: status === "fallback" || status === "unverified" ? "unavailable"
      : evidence.evidence_integrated_profile_v2 ? "integrated_dimensions" : "item_level_dimensions",
    profile_native_confidence_alignment: validated ? profile.confidence_alignment : null,
    profile_confidence_alignment_scope: !validated ? "unavailable" : role === "baseline"
      ? "initial_assessment" : call?.agent_name === "formative_conversation_agent" &&
        ["formative-conversation-host-v7.6", "formative-conversation-host-v7.7"].includes(call.prompt_version ?? "")
        ? "carried_forward_not_reassessed" : "legacy_scope_unrecorded",
    profile_unavailable_reason: fallback ? "profiling_fallback" :
      intermediate ? "intermediate_artifact" : validated ? null : "validation_provenance_unavailable"
  };
}

export function profileEvidenceCounts(profile: ProfileRecord) {
  const provenance = profileRecordProvenance(profile);
  const catalog = parseCanonicalMisconceptionClaimCatalog(profile.misconception_indicators);
  const legacy = Array.isArray(profile.misconception_indicators) ? profile.misconception_indicators : null;
  const unavailable = provenance.profile_validation_status === "fallback";
  const evidence = asRecord(profile.item_level_evidence);
  const v2 = asRecord(evidence.evidence_integrated_profile_v2);
  const itemEvidence = Array.isArray(profile.item_level_evidence)
    ? profile.item_level_evidence : Array.isArray(v2.item_evidence) ? v2.item_evidence : null;
  const linkedCount = itemEvidence?.filter(entry => typeof asRecord(entry).item_public_id === "string").length ?? 0;
  const narrativeCount = itemEvidence?.filter(entry => typeof entry === "string").length ?? 0;
  return {
    misconception_indicator_count: unavailable ? null : catalog?.indicators.length ?? legacy?.length ?? null,
    misconception_claim_count: unavailable ? null : catalog
      ? catalog.indicators.reduce((sum, indicator) => sum + indicator.claims.length, 0) : null,
    item_level_evidence_count: unavailable ? null : itemEvidence?.length ?? null,
    item_level_evidence_available: !unavailable && linkedCount > 0,
    item_level_evidence_format: unavailable || !itemEvidence ? "unavailable" : itemEvidence.length === 0 ? "empty"
      : linkedCount === itemEvidence.length ? "structured_item_records"
        : narrativeCount === itemEvidence.length ? "narrative_summaries" : "mixed_or_unrecognized"
  };
}

export function profileItemEvidence(profile: ProfileRecord) {
  if (profileRecordProvenance(profile).profile_validation_status === "fallback") return [];
  const v2 = asRecord(asRecord(profile.item_level_evidence).evidence_integrated_profile_v2);
  return asArray(Array.isArray(profile.item_level_evidence) ? profile.item_level_evidence : v2.item_evidence)
    .map(asRecord).filter((entry) => typeof entry.item_public_id === "string")
    .map((entry) => ({
      item_public_id: entry.item_public_id as string,
      reasoning_quality: typeof entry.reasoning_quality === "string" ? entry.reasoning_quality : null,
      confidence_rating: typeof entry.confidence_rating === "string" ? entry.confidence_rating
        : typeof entry.confidence === "string" ? entry.confidence : null
    }));
}

export const PROFILE_FIELD_DEFINITIONS: Record<string, string> = {
  profile_projection_version: "Version of the read-only profile classification and export projection; not a retroactive change to collected data.",
  profile_record_id: "Stable profile_ prefix plus the first 24 hexadecimal SHA-256 characters of the stored profile ID; joins profile artifacts without exporting database UUIDs.",
  initial_profile_record_id: "Stable profile_record_id of the conversation's original baseline, including a flagged fallback if that is what was retained.",
  current_profile_record_id: "Stable profile_record_id of the latest canonical transition's updated profile, or the initial profile when no validated transition exists. Reusing the baseline is not a new measurement.",
  prior_profile_record_id: "Stable profile_record_id of the prior profile referenced by this canonical transition.",
  updated_profile_record_id: "Stable profile_record_id of the updated profile referenced by this canonical transition.",
  profile_record_role: "baseline, updated, or intermediate. Integration/planning artifacts are intermediate, not repeated learning measurements.",
  profile_validation_status: "validated, fallback, intermediate, or unverified. Success requires a successful validated profiling or conversation source call; fallback cautions override it.",
  profile_valid_for_learning_analysis: "True only for validated non-intermediate, non-fallback profile records. This is provenance eligibility, not proof of diagnostic validity or student mastery.",
  profile_source_agent_call_public_id: "Public source AgentCall join key; blank when no source call was retained.",
  profile_source_agent_name: "Stored source agent role, kept separate from the profile's processing role.",
  profile_source_call_status: "Stored source call status; no status is inferred when the call is absent.",
  profile_source_output_validated: "Stored source output-validation flag. A validated planning call does not make its intermediate artifact a canonical learning profile.",
  profile_source_prompt_version: "Prompt version stored on the source call, not the current application prompt.",
  profile_source_schema_version: "Output schema version stored on the source call, not the export projection version.",
  profile_unavailable_reason: "profiling_fallback, intermediate_artifact, validation_provenance_unavailable, or blank for a validated record.",
  profile_dimensions_status: "integrated_dimensions for stored V2 integration artifacts; item_level_dimensions for canonical profiles; unavailable for fallback or unverified provenance. Missing aggregate categories are not reconstructed from per-item judgments.",
  profile_native_confidence_alignment: "Native confidence_alignment from a validated profile. It is not converted to the different legacy confidence_calibration vocabulary.",
  profile_confidence_alignment_scope: "Read-only provenance: initial_assessment for validated baseline profiles; carried_forward_not_reassessed for validated updated formative profiles from host-v7.6 or host-v7.7; legacy_scope_unrecorded for other updated profiles; unavailable without eligible validation provenance. No confidence change is calculated. Carry-forward preserves the prior value, which may itself be historical; it is not a new confidence measurement.",
  prior_confidence_alignment_scope: "profile_confidence_alignment_scope of the transition's prior profile; join prior_profile_record_id for source provenance.",
  updated_confidence_alignment_scope: "profile_confidence_alignment_scope of the transition's updated profile; join updated_profile_record_id for source provenance. Repeated values do not represent repeated confidence measurements.",
  misconception_indicator_count: "Length of the canonical indicators array or supported legacy array. Blank for fallback or unrecognized format; zero means an explicitly empty supported array, not missing diagnosis.",
  misconception_claim_count: "Sum of claims.length across canonical indicators. Blank for fallback or legacy records without atomic claims; indicators and claims are distinct units.",
  item_level_evidence_count: "Number of stored evidence entries, not necessarily number of linked items. May count narrative summaries; inspect item_level_evidence_format. Blank for fallback or unavailable schema; no row is manufactured for missing evidence.",
  item_level_evidence_available: "True only when a non-fallback evidence array has at least one structured record with an item_public_id. Narrative-only formative summaries are not advertised as joinable item records; not a guarantee of complete coverage.",
  item_level_evidence_format: "structured_item_records when every stored entry has item_public_id; narrative_summaries when every entry is text; mixed_or_unrecognized otherwise; empty for an explicit empty array; unavailable for fallback or missing schema. Narrative summaries remain in original profiles and canonical snapshots, not fabricated per-item rows.",
  profile_reassessment_status: "validated_reassessment when at least one canonical transition exists; otherwise reassessment_incomplete after student turns or a non-active lifecycle, and not_reassessed before either. No learning outcome is inferred from pause/exit.",
  reasoning_quality: "Stored per-item model interpretation, not rescored or aggregated during export. Compare only with its source schema and validation status.",
  confidence_rating: "Confidence retained in the profile's item evidence; original student products are in item_responses.csv.",
  item_public_id: "Public item identifier; join with session_public_id to the administered item response.",
  session_public_id: "Public attempt identifier; join to sessions.csv.",
  concept_unit_public_id: "Public concept-unit identifier for this profile.",
  created_at: "Original profile persistence timestamp, not the re-export time."
};

export function profileReassessmentStatus(input: {
  validated_transition_count: number;
  student_turn_count: number;
  conversation_status: string;
}): "validated_reassessment" | "reassessment_incomplete" | "not_reassessed" {
  if (input.validated_transition_count > 0) return "validated_reassessment";
  if (input.student_turn_count > 0 || input.conversation_status !== "active") return "reassessment_incomplete";
  return "not_reassessed";
}
