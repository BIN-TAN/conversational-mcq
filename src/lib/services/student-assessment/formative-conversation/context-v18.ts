import {
  buildCanonicalEvidenceCatalog,
  CanonicalEligibleEvidenceCatalogSchema
} from "@/lib/domain/canonical-evidence-identity";
import { emptyCanonicalMisconceptionClaimCatalog } from "@/lib/domain/misconception-claim-identity";
import {
  FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION,
  type FormativeConversationAgentInput,
  type FormativeConversationProfileEvidence
} from "./agent-contract";
import {
  FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_V18_CONTEXT_VERSION,
  FormativeConversationV18AgentInputSchema,
  FormativeConversationV18ProfileEvidenceSchema,
  type FormativeConversationV18AgentInput,
  type FormativeConversationV18ProfileEvidence
} from "./agent-contract-v18";
import { compilePersistedFormativeConversationContext } from "./context";
import type { FormativeConversationRuntimeContextSeed } from "./runtime";
import { validateFormativeConversationSafetyBoundary } from "./safety-boundary";

function v18ProfileEvidence(
  profile: FormativeConversationProfileEvidence,
  evidenceCutoffSequenceIndex: number
): FormativeConversationV18ProfileEvidence {
  return FormativeConversationV18ProfileEvidenceSchema.parse({
    profile_version: profile.profile_version,
    evidence_cutoff_sequence_index: evidenceCutoffSequenceIndex,
    outcome: profile.outcome,
    evidence_summary: profile.evidence_summary,
    unresolved_evidence: profile.unresolved_evidence,
    evidence_limitations: profile.evidence_limitations,
    canonical_profile: profile.canonical_profile,
    misconception_claim_catalog: profile.misconception_claim_catalog ?? null
  });
}

type V18ContextSource = Pick<
  FormativeConversationAgentInput,
  | "conversation_public_id"
  | "assessment_public_id"
  | "concept_unit_public_id"
  | "latest_student_message"
  | "visible_transcript"
  | "administered_items"
  | "assessment_specification"
  | "assessment_response_evidence"
  | "assessment_process_evidence"
  | "initial_profile"
  | "current_profile"
  | "profile_history"
  | "telemetry_summary"
  | "teacher_guidance"
  | "intervention_history"
  | "memory"
>;

export function compileFormativeConversationV18Context(input: {
  evidence_namespace_public_id: string;
  assessment_process_evidence_source_public_ids: readonly string[];
  current_profile_evidence_cutoff_sequence_index: number;
  source: V18ContextSource;
  authorized_administered_item_public_ids: string[];
}) {
  if (
    input.assessment_process_evidence_source_public_ids.length !==
    input.source.assessment_process_evidence.length
  ) {
    throw new Error(
      "formative_conversation_v18_process_evidence_identity_unavailable"
    );
  }
  const initialProfile = v18ProfileEvidence(input.source.initial_profile, 0);
  const currentProfile = v18ProfileEvidence(
    input.source.current_profile,
    input.current_profile_evidence_cutoff_sequence_index
  );
  if (
    currentProfile.canonical_profile &&
    currentProfile.canonical_profile.misconception_indicators.length > 0 &&
    !currentProfile.misconception_claim_catalog
  ) {
    throw new Error(
      "formative_conversation_v18_misconception_claim_catalog_unavailable"
    );
  }
  const allowedClaimCatalog =
    currentProfile.misconception_claim_catalog ??
    emptyCanonicalMisconceptionClaimCatalog(
      `conversation:${input.source.conversation_public_id}:empty`
    );
  const allowedEvidenceCatalog = CanonicalEligibleEvidenceCatalogSchema.parse(
    buildCanonicalEvidenceCatalog({
      evidence_namespace_public_id: input.evidence_namespace_public_id,
      assessment_public_id: input.source.assessment_public_id,
      concept_unit_public_id: input.source.concept_unit_public_id,
      conversation_public_id: input.source.conversation_public_id,
      assessment_responses: input.source.assessment_response_evidence.map(
        (response) => ({
          item_public_id: response.item_public_id,
          selected_option: response.selected_option,
          correctness: response.correctness,
          written_reasoning: response.written_reasoning,
          confidence: response.confidence,
          tempting_option: response.tempting_option,
          tempting_option_reason: response.tempting_option_reason
        })
      ),
      assessment_process: input.source.assessment_process_evidence.map(
        (event, index) => ({
          source_public_id:
            input.assessment_process_evidence_source_public_ids[index],
          event_type: event.event_type,
          event_category: event.event_category,
          event_source: event.event_source,
          item_public_id: event.item_public_id,
          occurred_at: event.occurred_at
        })
      ),
      transcript: input.source.visible_transcript.map((turn) => ({
        sequence_index: turn.sequence_index,
        actor: turn.actor,
        message_text: turn.message_text
      }))
    })
  );
  const parsed = FormativeConversationV18AgentInputSchema.parse({
    contract_version: FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
    context_version: FORMATIVE_CONVERSATION_V18_CONTEXT_VERSION,
    conversation_public_id: input.source.conversation_public_id,
    assessment_public_id: input.source.assessment_public_id,
    concept_unit_public_id: input.source.concept_unit_public_id,
    latest_student_message: input.source.latest_student_message,
    visible_transcript: [...input.source.visible_transcript].sort(
      (left, right) => left.sequence_index - right.sequence_index
    ),
    administered_items: input.source.administered_items,
    assessment_specification: input.source.assessment_specification,
    assessment_response_evidence:
      input.source.assessment_response_evidence,
    assessment_process_evidence: input.source.assessment_process_evidence,
    initial_profile: initialProfile,
    current_profile: currentProfile,
    allowed_misconception_claim_catalog: allowedClaimCatalog,
    allowed_evidence_catalog: allowedEvidenceCatalog,
    profile_history: input.source.profile_history,
    telemetry_summary: input.source.telemetry_summary,
    teacher_guidance: input.source.teacher_guidance,
    intervention_history: input.source.intervention_history,
    memory: input.source.memory,
    safety_boundary: {
      boundary_version: FORMATIVE_CONVERSATION_SAFETY_BOUNDARY_VERSION,
      administered_item_public_ids: [
        ...input.authorized_administered_item_public_ids
      ].sort(),
      unadministered_item_protection_required: true,
      hidden_prompts_excluded: true,
      raw_teacher_notes_excluded: true,
      credentials_excluded: true
    }
  });
  const safety = validateFormativeConversationSafetyBoundary(parsed);
  if (!safety.valid) {
    throw new Error(
      `formative_conversation_v18_context_unsafe:${safety.issue_codes.join(",")}`
    );
  }
  return { context: parsed, safety };
}

export async function compilePersistedFormativeConversationV18Context(
  input: FormativeConversationRuntimeContextSeed & {
    conversation_public_id: string;
  }
): Promise<{
  context: FormativeConversationV18AgentInput;
  safety: ReturnType<typeof validateFormativeConversationSafetyBoundary>;
}> {
  const legacy = await compilePersistedFormativeConversationContext({
    conversation_public_id: input.conversation_public_id,
    assessment_public_id: input.assessment_public_id,
    concept_unit_public_id: input.concept_unit_public_id,
    administered_items: input.administered_items,
    assessment_specification: input.assessment_specification,
    assessment_response_evidence: input.assessment_response_evidence,
    assessment_process_evidence: input.assessment_process_evidence,
    initial_profile: input.initial_profile,
    current_profile: input.current_profile
  });
  return compileFormativeConversationV18Context({
    evidence_namespace_public_id:
      input.evidence_namespace_public_id ?? input.conversation_public_id,
    assessment_process_evidence_source_public_ids:
      input.assessment_process_evidence_source_public_ids ?? [],
    current_profile_evidence_cutoff_sequence_index:
      input.current_profile_evidence_cutoff_sequence_index ?? 0,
    source: legacy.context,
    authorized_administered_item_public_ids:
      legacy.context.safety_boundary.administered_item_public_ids
  });
}
