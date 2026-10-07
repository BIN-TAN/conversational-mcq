import { z } from "zod";
import type { CanonicalEvidenceCatalog } from "@/lib/domain/canonical-evidence-identity";
import { FormativeConversationV18EvidenceObservationSchema } from "./agent-contract-v18";

export const ASSISTANCE_HISTORY_VERSION = "conversation-assistance-history-v1";
export const AssistanceHistorySchema = z.object({
  version: z.literal(ASSISTANCE_HISTORY_VERSION),
  observations: z.array(FormativeConversationV18EvidenceObservationSchema.extend({
    source_agent_call_public_id: z.string().min(1),
    source_tutor_sequence_index: z.number().int().positive()
  }).strict())
}).strict();

export function isRecognitionQualification(type: string) {
  return /recognition|support_limitation|understanding_not_demonstrated/.test(type);
}

// Reuse accepted observations, never infer assistance from wording or student fluency.
export function projectAssistanceHistory(input: {
  catalog: CanonicalEvidenceCatalog;
  visible_tutor_indexes: ReadonlySet<number>;
  records: Array<{
    source_agent_call_public_id: string;
    source_tutor_sequence_index: number;
    observation: unknown;
  }>;
}): z.infer<typeof AssistanceHistorySchema> {
  const observations = input.records.flatMap(record => {
    const parsed = FormativeConversationV18EvidenceObservationSchema.safeParse(record.observation);
    if (!parsed.success || !input.visible_tutor_indexes.has(record.source_tutor_sequence_index)) return [];
    const observation = parsed.data;
    if (!isRecognitionQualification(observation.evidence_type) &&
        observation.evidence_type !== "assistance_context_reconsidered") return [];
    if (observation.evidence_ids.some(id => !input.catalog.evidence.some(evidence =>
      evidence.evidence_id === id && evidence.source_role === "student" &&
      (evidence.source_sequence_index === null ||
        evidence.source_sequence_index < record.source_tutor_sequence_index)
    ))) return [];
    return [{ ...observation, source_agent_call_public_id: record.source_agent_call_public_id,
      source_tutor_sequence_index: record.source_tutor_sequence_index }];
  }).sort((a, b) => a.source_tutor_sequence_index - b.source_tutor_sequence_index);
  return { version: ASSISTANCE_HISTORY_VERSION, observations };
}
