import type { StudentProfile } from "@prisma/client";
import { prisma } from "@/lib/db";
import { executeFormativeConversationPersistenceRead } from "./persistence-observability";
import { buildAssessmentInterpretationContextFromResponsePackage } from "@/lib/services/student-assessment/assessment-interpretation-context";
import type {
  FormativeConversationAdministeredItem,
  FormativeConversationAssessmentProcessEvidence,
  FormativeConversationAssessmentResponseEvidence,
  FormativeConversationAssessmentSpecification,
  FormativeConversationProfileEvidence
} from "./agent-contract";
import {
  FORMATIVE_CONVERSATION_AGENT_NAME,
  FORMATIVE_CONVERSATION_ASSESSMENT_SPECIFICATION_VERSION
} from "./agent-contract";
import {
  canonicalFormativeConversationProfileFromStudentProfile,
  parseFormativeConversationProfileSnapshot
} from "./profile-update";
import { normalizeInstructionalTeacherGuidance } from "./teacher-guidance-boundary";
import type { FormativeConversationRuntimeContextSeed } from "./runtime";

type JsonRecord = Record<string, unknown>;

const OBSERVABLE_ASSESSMENT_PROCESS_EVENT_TYPES = [
  "item_presented",
  "agent_message_shown",
  "option_clicked",
  "option_selected",
  "answer_changed",
  "reasoning_submitted",
  "reasoning_entered",
  "reasoning_revised",
  "confidence_clicked",
  "confidence_selected",
  "tempting_option_submitted",
  "tempting_option_reason_submitted",
  "item_completed",
  "package_review_opened",
  "package_submitted",
  "page_hidden",
  "page_visible",
  "page_visibility_hidden",
  "page_visibility_visible",
  "window_blur",
  "window_focus",
  "paste_detected",
  "typing_activity_summary",
  "navigation_event",
  "refresh_recovery",
  "student_response_edit_started",
  "student_response_edit_submitted",
  "reasoning_edited",
  "confidence_changed",
  "tempting_option_changed"
] as const;

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

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.replace(/\s+/g, " ").trim()
    : null;
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
  profile: StudentProfile | null,
  fallbackVersion: string,
  persistedSnapshot?: unknown
): FormativeConversationProfileEvidence {
  const snapshot = parseFormativeConversationProfileSnapshot(
    persistedSnapshot
  );
  if (snapshot) {
    return {
      ...snapshot,
      canonical_profile:
        snapshot.canonical_profile ??
        (profile
          ? canonicalFormativeConversationProfileFromStudentProfile(profile)
          : null)
    };
  }
  if (!profile) {
    return {
      profile_version: fallbackVersion,
      outcome: "not_yet_determined",
      evidence_summary: [],
      unresolved_evidence: [],
      evidence_limitations: ["No validated learning profile is available."],
      canonical_profile: null,
      field_evidence: []
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
        : [`Evidence sufficiency is ${profile.evidence_sufficiency}.`],
    canonical_profile:
      canonicalFormativeConversationProfileFromStudentProfile(profile),
    field_evidence: []
  };
}

async function buildRuntimeContextSeed(input: {
  conversation_public_id: string;
  student_user_db_id?: string;
}): Promise<FormativeConversationRuntimeContextSeed> {
  const session = await executeFormativeConversationPersistenceRead({
    operation_name: "formative_conversation_context_read",
    logical_operation_id: `context:${input.conversation_public_id}`,
    execute: () => prisma.formativeConversationSession.findFirst({
    where: {
      conversation_public_id: input.conversation_public_id,
      ...(input.student_user_db_id
        ? {
            assessment_session: {
              user_db_id: input.student_user_db_id
            }
          }
        : {})
    },
    include: {
      assessment_session: {
        select: {
          assessment: {
            select: {
              assessment_public_id: true,
              title: true,
              diagnostic_focus: true
            }
          }
        }
      },
      concept_unit_session: {
        select: {
          concept_unit: {
            select: {
              concept_unit_public_id: true,
              title: true,
              learning_objective: true,
              related_concept_description: true
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
          },
          response_packages: {
            where: {
              package_type: "initial_concept_unit_response_package"
            },
            orderBy: {
              created_at: "desc"
            },
            take: 1,
            select: {
              payload: true
            }
          },
          process_events: {
            where: {
              event_type: {
                in: [...OBSERVABLE_ASSESSMENT_PROCESS_EVENT_TYPES]
              }
            },
            orderBy: {
              occurred_at: "asc"
            },
            take: 500,
            select: {
              event_type: true,
              event_category: true,
              event_source: true,
              visibility_duration_ms: true,
              pause_duration_ms: true,
              occurred_at: true,
              item: {
                select: {
                  item_public_id: true
                }
              }
            }
          }
        }
      },
      initial_student_profile: true,
      current_student_profile: true,
      profile_transitions: {
        orderBy: { transitioned_at: "desc" },
        take: 1,
        include: {
          updated_student_profile: true
        }
      }
    }
    })
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
  const administeredItemPublicIds = new Set(
    administeredItems.map((item) => item.item_public_id)
  );
  const responsePackage =
    session.concept_unit_session.response_packages[0] ?? null;
  const assessmentInterpretationContext = responsePackage
    ? buildAssessmentInterpretationContextFromResponsePackage({
        response_package_payload: responsePackage.payload,
        phase: "post_initial_interpretation"
      })
    : null;
  const interpretedEvidenceByItem = new Map(
    (assessmentInterpretationContext?.observed_student_evidence
      .item_responses ?? []
    ).map((evidence) => [evidence.item_public_id, evidence])
  );
  const assessmentResponseEvidence: FormativeConversationAssessmentResponseEvidence[] =
    session.concept_unit_session.item_responses.map((response) => {
      const interpreted = interpretedEvidenceByItem.get(
        response.item.item_public_id
      );
      return {
        item_public_id: response.item.item_public_id,
        selected_option:
          response.selected_option ?? interpreted?.selected_option ?? null,
        correctness: response.correctness,
        written_reasoning:
          nullableText(response.reasoning_text) ??
          interpreted?.written_reasoning ??
          null,
        confidence:
          response.confidence_rating ?? interpreted?.confidence ?? null,
        revision_summary:
          interpreted?.revision_summary ??
          (response.revision_count > 0
            ? `revision_count=${response.revision_count}`
            : null),
        tempting_option: interpreted?.tempting_option ?? null,
        tempting_option_reason:
          interpreted?.tempting_option_reason ?? null,
        safe_timing_summary: {
          total_item_time_ms:
            response.item_response_time_ms ??
            interpreted?.safe_timing_summary.total_item_time_ms ??
            null,
          response_time_answer_ms:
            interpreted?.safe_timing_summary.response_time_answer_ms ?? null,
          response_time_reasoning_ms:
            interpreted?.safe_timing_summary.response_time_reasoning_ms ??
            null,
          response_time_confidence_ms:
            interpreted?.safe_timing_summary.response_time_confidence_ms ??
            null
        }
      };
    });
  const assessmentSpecification: FormativeConversationAssessmentSpecification =
    {
      schema_version:
        FORMATIVE_CONVERSATION_ASSESSMENT_SPECIFICATION_VERSION,
      assessment_title:
        assessmentInterpretationContext?.assessment.assessment_title ??
        nullableText(session.assessment_session.assessment.title),
      diagnostic_focus:
        assessmentInterpretationContext?.assessment.diagnostic_focus ??
        nullableText(
          session.assessment_session.assessment.diagnostic_focus
        ),
      concept_unit_title:
        assessmentInterpretationContext?.concept_unit.title ??
        nullableText(session.concept_unit_session.concept_unit.title),
      learning_objective:
        assessmentInterpretationContext?.concept_unit.learning_objective ??
        nullableText(
          session.concept_unit_session.concept_unit.learning_objective
        ),
      related_concept_description:
        assessmentInterpretationContext?.concept_unit
          .related_concept_description ??
        nullableText(
          session.concept_unit_session.concept_unit
            .related_concept_description
        ),
      administered_item_guidance: normalizeInstructionalTeacherGuidance(
        (
          assessmentInterpretationContext?.teacher_diagnostic_guidance
            .item_guidance ?? []
        ).filter((guidance) =>
          administeredItemPublicIds.has(guidance.item_public_id)
        )
      ),
      boundaries: {
        administered_items_only: true,
        unadministered_item_content_protected: true,
        administered_answer_discussion_allowed: true,
        raw_teacher_notes_must_not_be_quoted: true,
        pedagogy_owner: FORMATIVE_CONVERSATION_AGENT_NAME,
        legacy_activity_routing_authoritative: false
      }
    };
  const assessmentProcessEvidence: FormativeConversationAssessmentProcessEvidence[] =
    session.concept_unit_session.process_events.map((event) => ({
      event_type: event.event_type,
      event_category: event.event_category,
      event_source: event.event_source,
      item_public_id: event.item?.item_public_id ?? null,
      occurred_at: event.occurred_at.toISOString(),
      visibility_duration_ms: event.visibility_duration_ms,
      pause_duration_ms: event.pause_duration_ms
    }));

  return {
    assessment_public_id:
      session.assessment_session.assessment.assessment_public_id,
    concept_unit_public_id:
      session.concept_unit_session.concept_unit.concept_unit_public_id,
    administered_items: administeredItems,
    assessment_specification: assessmentSpecification,
    assessment_response_evidence: assessmentResponseEvidence,
    assessment_process_evidence: assessmentProcessEvidence,
    initial_profile: profileEvidence(
      session.initial_student_profile,
      "initial-profile-unavailable"
    ),
    current_profile: session.profile_transitions[0]
      ? profileEvidence(
          session.profile_transitions[0].updated_student_profile,
          "current-profile-unavailable",
          session.profile_transitions[0].profile_snapshot
        )
      : profileEvidence(
          session.initial_student_profile,
          "current-profile-unavailable"
        )
  };
}

export async function buildFormativeConversationRuntimeContextSeed(input: {
  conversation_public_id: string;
  student_user_db_id: string;
}) {
  return buildRuntimeContextSeed(input);
}

export async function buildFormativeConversationRuntimeContextSeedForInternalOpening(input: {
  conversation_public_id: string;
}) {
  return buildRuntimeContextSeed(input);
}
