import { createHash } from "node:crypto";
import { z } from "zod";

export const CANONICAL_EVIDENCE_IDENTITY_VERSION =
  "canonical-evidence-identity-v2" as const;

export const CanonicalEvidenceIdSchema = z
  .string()
  .regex(/^ev_[a-f0-9]{24}$/u);
export const CanonicalEvidenceScopeIdSchema = z
  .string()
  .regex(/^es_[a-f0-9]{24}$/u);

export const CanonicalEvidenceKindSchema = z.enum([
  "assessment_answer",
  "assessment_reasoning",
  "assessment_confidence",
  "assessment_distractor_reasoning",
  "assessment_process_observation",
  "formative_student_turn",
  "formative_tutor_turn",
  "teacher_private_note"
]);

export const CanonicalEvidenceSourceRoleSchema = z.enum([
  "student",
  "platform_observation",
  "tutor",
  "teacher_private"
]);

export const CanonicalEvidenceEligibilitySchema = z.enum([
  "student_understanding",
  "evidence_quality_context",
  "not_eligible"
]);

export const CanonicalEvidenceStageSchema = z.enum([
  "baseline_assessment",
  "formative_conversation"
]);

export const CanonicalEvidenceRefSchema = z
  .object({
    identity_version: z.literal(CANONICAL_EVIDENCE_IDENTITY_VERSION),
    evidence_id: CanonicalEvidenceIdSchema,
    evidence_scope_id: CanonicalEvidenceScopeIdSchema,
    evidence_kind: CanonicalEvidenceKindSchema,
    source_role: CanonicalEvidenceSourceRoleSchema,
    evidence_stage: CanonicalEvidenceStageSchema,
    eligibility: CanonicalEvidenceEligibilitySchema,
    assessment_public_id: z.string().min(1),
    concept_unit_public_id: z.string().min(1),
    conversation_public_id: z.string().min(1).nullable(),
    item_public_id: z.string().min(1).nullable(),
    source_sequence_index: z.number().int().positive().nullable(),
    source_ordinal: z.number().int().nonnegative().nullable(),
    content: z.string().trim().min(1).max(12_000)
  })
  .strict();

export const CanonicalEvidenceCatalogSchema = z
  .object({
    identity_version: z.literal(CANONICAL_EVIDENCE_IDENTITY_VERSION),
    evidence_scope_id: CanonicalEvidenceScopeIdSchema,
    evidence: z.array(CanonicalEvidenceRefSchema).max(2_000)
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    const assessmentIds = new Set<string>();
    const conceptUnitIds = new Set<string>();
    const conversationIds = new Set<string>();
    value.evidence.forEach((entry, index) => {
      if (entry.evidence_scope_id !== value.evidence_scope_id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence", index, "evidence_scope_id"],
          message: "Evidence references must belong to the catalog scope."
        });
      }
      if (seen.has(entry.evidence_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence", index, "evidence_id"],
          message: "Canonical evidence IDs must be unique within a catalog."
        });
      }
      seen.add(entry.evidence_id);
      assessmentIds.add(entry.assessment_public_id);
      conceptUnitIds.add(entry.concept_unit_public_id);
      if (entry.conversation_public_id) {
        conversationIds.add(entry.conversation_public_id);
      }
      if (
        entry.evidence_stage === "baseline_assessment" &&
        entry.conversation_public_id !== null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence", index, "conversation_public_id"],
          message:
            "Baseline assessment evidence cannot acquire formative-conversation identity."
        });
      }
      if (
        entry.evidence_stage === "formative_conversation" &&
        entry.conversation_public_id === null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence", index, "evidence_stage"],
          message:
            "Formative evidence must identify its conversation."
        });
      }
      if (
        entry.evidence_kind.startsWith("assessment_") &&
        entry.evidence_stage !== "baseline_assessment"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence", index, "evidence_stage"],
          message: "Assessment evidence must retain baseline provenance."
        });
      }
      if (
        (entry.evidence_kind === "formative_student_turn" ||
          entry.evidence_kind === "formative_tutor_turn") &&
        entry.evidence_stage !== "formative_conversation"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence", index, "evidence_stage"],
          message: "Conversation-turn evidence must retain formative provenance."
        });
      }
      if (
        (entry.evidence_kind === "formative_student_turn" ||
          entry.evidence_kind === "formative_tutor_turn") &&
        entry.source_sequence_index === null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence", index, "source_sequence_index"],
          message: "Conversation-turn evidence requires a source sequence."
        });
      }
    });
    if (assessmentIds.size > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence"],
        message: "A canonical evidence catalog cannot cross assessment scopes."
      });
    }
    if (conceptUnitIds.size > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence"],
        message: "A canonical evidence catalog cannot cross concept-unit scopes."
      });
    }
    if (conversationIds.size > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence"],
        message: "A canonical evidence catalog cannot cross conversation scopes."
      });
    }
  });

export const CanonicalEligibleEvidenceCatalogSchema =
  CanonicalEvidenceCatalogSchema.superRefine((value, context) => {
    value.evidence.forEach((entry, index) => {
      if (
        entry.source_role === "tutor" ||
        entry.source_role === "teacher_private" ||
        entry.eligibility === "not_eligible"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence", index, "source_role"],
          message:
            "Tutor and teacher-private records cannot enter the eligible learning-evidence catalog."
        });
      }
    });
  });

export type CanonicalEvidenceId = z.infer<typeof CanonicalEvidenceIdSchema>;
export type CanonicalEvidenceRef = z.infer<typeof CanonicalEvidenceRefSchema>;
export type CanonicalEvidenceCatalog = z.infer<
  typeof CanonicalEvidenceCatalogSchema
>;

type AssessmentEvidenceResponse = {
  item_public_id: string;
  selected_option: string | null;
  correctness?: string | null;
  written_reasoning: string | null;
  confidence: string | null;
  tempting_option: string | null;
  tempting_option_reason: string | null;
};

type AssessmentProcessEvidence = {
  source_public_id: string;
  event_type: string;
  event_category: string;
  event_source: string;
  item_public_id: string | null;
  occurred_at?: string | null;
};

type FormativeTranscriptTurn = {
  sequence_index: number;
  actor: "student" | "tutor";
  message_text: string;
};

function normalized(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function opaqueId(prefix: "es" | "ev", material: string) {
  return `${prefix}_${createHash("sha256")
    .update(`${CANONICAL_EVIDENCE_IDENTITY_VERSION}\u0000${material}`)
    .digest("hex")
    .slice(0, 24)}`;
}

export function canonicalEvidenceScopeId(input: {
  evidence_namespace_public_id: string;
  assessment_public_id: string;
  concept_unit_public_id: string;
}) {
  return CanonicalEvidenceScopeIdSchema.parse(
    opaqueId(
      "es",
      `${normalized(input.evidence_namespace_public_id)}\u0000${normalized(input.assessment_public_id)}\u0000${normalized(input.concept_unit_public_id)}`
    )
  );
}

function canonicalEvidenceRef(input: Omit<CanonicalEvidenceRef, "identity_version" | "evidence_id" | "evidence_scope_id"> & {
  evidence_scope_id: string;
  source_key: string;
}): CanonicalEvidenceRef {
  const { source_key: sourceKey, ...value } = input;
  return CanonicalEvidenceRefSchema.parse({
    ...value,
    identity_version: CANONICAL_EVIDENCE_IDENTITY_VERSION,
    evidence_scope_id: input.evidence_scope_id,
    evidence_id: opaqueId("ev", `${input.evidence_scope_id}\u0000${sourceKey}`)
  });
}

export function buildCanonicalEvidenceCatalog(input: {
  evidence_namespace_public_id: string;
  assessment_public_id: string;
  concept_unit_public_id: string;
  conversation_public_id?: string | null;
  assessment_responses?: readonly AssessmentEvidenceResponse[];
  assessment_process?: readonly AssessmentProcessEvidence[];
  transcript?: readonly FormativeTranscriptTurn[];
}): CanonicalEvidenceCatalog {
  const evidenceScopeId = canonicalEvidenceScopeId(input);
  const evidence: CanonicalEvidenceRef[] = [];

  for (const response of input.assessment_responses ?? []) {
    if (response.selected_option) {
      evidence.push(
        canonicalEvidenceRef({
          evidence_scope_id: evidenceScopeId,
          source_key: `assessment-answer:${response.item_public_id}`,
          evidence_kind: "assessment_answer",
          source_role: "student",
          evidence_stage: "baseline_assessment",
          eligibility: "student_understanding",
          assessment_public_id: input.assessment_public_id,
          concept_unit_public_id: input.concept_unit_public_id,
          conversation_public_id: null,
          item_public_id: response.item_public_id,
          source_sequence_index: null,
          source_ordinal: null,
          content: `Selected option ${response.selected_option}${
            response.correctness ? `; scored ${response.correctness}` : ""
          }.`
        })
      );
    }
    if (response.written_reasoning) {
      evidence.push(
        canonicalEvidenceRef({
          evidence_scope_id: evidenceScopeId,
          source_key: `assessment-reasoning:${response.item_public_id}`,
          evidence_kind: "assessment_reasoning",
          source_role: "student",
          evidence_stage: "baseline_assessment",
          eligibility: "student_understanding",
          assessment_public_id: input.assessment_public_id,
          concept_unit_public_id: input.concept_unit_public_id,
          conversation_public_id: null,
          item_public_id: response.item_public_id,
          source_sequence_index: null,
          source_ordinal: null,
          content: normalized(response.written_reasoning)
        })
      );
    }
    if (response.confidence) {
      evidence.push(
        canonicalEvidenceRef({
          evidence_scope_id: evidenceScopeId,
          source_key: `assessment-confidence:${response.item_public_id}`,
          evidence_kind: "assessment_confidence",
          source_role: "student",
          evidence_stage: "baseline_assessment",
          eligibility: "evidence_quality_context",
          assessment_public_id: input.assessment_public_id,
          concept_unit_public_id: input.concept_unit_public_id,
          conversation_public_id: null,
          item_public_id: response.item_public_id,
          source_sequence_index: null,
          source_ordinal: null,
          content: `Submitted confidence: ${normalized(response.confidence)}.`
        })
      );
    }
    if (response.tempting_option || response.tempting_option_reason) {
      evidence.push(
        canonicalEvidenceRef({
          evidence_scope_id: evidenceScopeId,
          source_key: `assessment-distractor:${response.item_public_id}`,
          evidence_kind: "assessment_distractor_reasoning",
          source_role: "student",
          evidence_stage: "baseline_assessment",
          eligibility: "student_understanding",
          assessment_public_id: input.assessment_public_id,
          concept_unit_public_id: input.concept_unit_public_id,
          conversation_public_id: null,
          item_public_id: response.item_public_id,
          source_sequence_index: null,
          source_ordinal: null,
          content: normalized(
            [
              response.tempting_option
                ? `Tempting option ${response.tempting_option}.`
                : "",
              response.tempting_option_reason ?? ""
            ]
              .filter(Boolean)
              .join(" ")
          )
        })
      );
    }
  }

  (input.assessment_process ?? []).forEach((event) => {
    evidence.push(
      canonicalEvidenceRef({
        evidence_scope_id: evidenceScopeId,
        source_key: `assessment-process:${normalized(event.source_public_id)}`,
        evidence_kind: "assessment_process_observation",
        source_role: "platform_observation",
        evidence_stage: "baseline_assessment",
        eligibility: "evidence_quality_context",
        assessment_public_id: input.assessment_public_id,
        concept_unit_public_id: input.concept_unit_public_id,
        conversation_public_id: null,
        item_public_id: event.item_public_id,
        source_sequence_index: null,
        source_ordinal: null,
        content: normalized(
          `Observed ${event.event_type} (${event.event_category}, ${event.event_source})${
            event.occurred_at ? ` at ${event.occurred_at}` : ""
          }.`
        )
      })
    );
  });

  for (const turn of input.transcript ?? []) {
    if (turn.actor !== "student") {
      continue;
    }
    evidence.push(
      canonicalEvidenceRef({
        evidence_scope_id: evidenceScopeId,
        source_key: `formative-student-turn:${input.conversation_public_id ?? "none"}:${turn.sequence_index}`,
        evidence_kind: "formative_student_turn",
        source_role: "student",
        evidence_stage: "formative_conversation",
        eligibility: "student_understanding",
        assessment_public_id: input.assessment_public_id,
        concept_unit_public_id: input.concept_unit_public_id,
        conversation_public_id: input.conversation_public_id ?? null,
        item_public_id: null,
        source_sequence_index: turn.sequence_index,
        source_ordinal: null,
        content: normalized(turn.message_text)
      })
    );
  }

  return CanonicalEvidenceCatalogSchema.parse({
    identity_version: CANONICAL_EVIDENCE_IDENTITY_VERSION,
    evidence_scope_id: evidenceScopeId,
    evidence
  });
}

export function canonicalEvidenceById(catalog: CanonicalEvidenceCatalog) {
  return new Map(catalog.evidence.map((entry) => [entry.evidence_id, entry]));
}

export function canonicalEvidenceSequenceIndexes(
  catalog: CanonicalEvidenceCatalog,
  evidenceIds: readonly string[]
) {
  const byId = canonicalEvidenceById(catalog);
  return [
    ...new Set(
      evidenceIds.flatMap((evidenceId) => {
        const sequence = byId.get(evidenceId)?.source_sequence_index;
        return sequence === null || sequence === undefined ? [] : [sequence];
      })
    )
  ].sort((left, right) => left - right);
}
