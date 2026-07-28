import { prisma } from "@/lib/db";
import type {
  FormativeConversationAdministeredItem,
  FormativeConversationProfileEvidence
} from "./agent-contract";
import type { FormativeConversationRuntimeContextSeed } from "./runtime";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function textArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.replace(/\s+/g, " ").trim())
        .filter(Boolean)
    : [];
}

function options(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const option = asRecord(entry);
        return typeof option.label === "string" && typeof option.text === "string"
          ? [{ label: option.label, text: option.text }]
          : [];
      })
    : [];
}

function answerExplanation(input: {
  snapshot: JsonRecord;
  correctOption: string;
  itemOptions: Array<{ label: string; text: string }>;
}) {
  const explicit = input.snapshot.student_safe_answer_explanation;
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.trim();
  }
  const patterns = textArray(input.snapshot.expected_reasoning_patterns);
  if (patterns.length > 0) {
    return patterns.slice(0, 2).join(" ");
  }
  const correctText = input.itemOptions.find(
    (option) => option.label === input.correctOption
  )?.text;
  return correctText
    ? `Option ${input.correctOption} states the relevant relationship: ${correctText}`
    : `Option ${input.correctOption} matches the intended concept boundary for this item.`;
}

function profileEvidence(
  profile: {
    id: string;
    integrated_diagnostic_profile: string;
    integrated_profile_rationale: string;
    reasoning_quality_summary: string;
    evidence_sufficiency: string;
    recommended_next_evidence: unknown;
  } | null,
  fallbackVersion: string
): FormativeConversationProfileEvidence {
  if (!profile) {
    return {
      profile_version: fallbackVersion,
      outcome: "not_yet_determined",
      evidence_summary: [],
      unresolved_evidence: [],
      evidence_limitations: ["No validated learning profile is available."]
    };
  }
  const sound =
    profile.integrated_diagnostic_profile === "robust_understanding_ready_for_transfer";
  return {
    profile_version: profile.id,
    outcome: sound ? "sound_understanding" : "not_yet_determined",
    evidence_summary: [
      profile.integrated_profile_rationale,
      profile.reasoning_quality_summary
    ].filter(Boolean),
    unresolved_evidence: textArray(profile.recommended_next_evidence),
    evidence_limitations:
      profile.evidence_sufficiency === "strong"
        ? []
        : [`Evidence sufficiency is ${profile.evidence_sufficiency}.`]
  };
}

export async function buildFormativeConversationRuntimeContextSeed(input: {
  conversation_public_id: string;
  student_user_db_id: string;
}): Promise<FormativeConversationRuntimeContextSeed> {
  const session = await prisma.formativeConversationSession.findFirst({
    where: {
      conversation_public_id: input.conversation_public_id,
      assessment_session: { user_db_id: input.student_user_db_id }
    },
    include: {
      assessment_session: {
        select: {
          assessment: {
            select: {
              assessment_public_id: true
            }
          }
        }
      },
      concept_unit_session: {
        select: {
          concept_unit: {
            select: {
              concept_unit_public_id: true
            }
          },
          item_responses: {
            where: {
              item_submitted_at: { not: null },
              answer_explanation_revealed: true
            },
            orderBy: {
              item: { item_order: "asc" }
            },
            include: {
              item: {
                select: {
                  item_public_id: true,
                  item_order: true,
                  item_stem: true,
                  options: true
                }
              }
            }
          }
        }
      },
      initial_student_profile: true,
      current_student_profile: true
    }
  });
  if (!session) {
    throw new Error("formative_conversation_not_found");
  }

  const administeredItems: FormativeConversationAdministeredItem[] =
    session.concept_unit_session.item_responses.map((response) => {
      const snapshot = asRecord(response.item_snapshot);
      const itemOptions = options(snapshot.options ?? response.item.options);
      return {
        item_public_id: response.item.item_public_id,
        item_number: response.item.item_order,
        item_stem:
          typeof snapshot.item_stem === "string"
            ? snapshot.item_stem
            : response.item.item_stem,
        options: itemOptions,
        student_answer: response.selected_option,
        correct_answer: response.correct_option_snapshot,
        concise_explanation: answerExplanation({
          snapshot,
          correctOption: response.correct_option_snapshot,
          itemOptions
        }),
        administered: true
      };
    });

  return {
    assessment_public_id:
      session.assessment_session.assessment.assessment_public_id,
    concept_unit_public_id:
      session.concept_unit_session.concept_unit.concept_unit_public_id,
    administered_items: administeredItems,
    initial_profile: profileEvidence(
      session.initial_student_profile,
      "initial-profile-unavailable"
    ),
    current_profile: profileEvidence(
      session.current_student_profile ?? session.initial_student_profile,
      "current-profile-unavailable"
    )
  };
}
