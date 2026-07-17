import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AgentInputByName } from "@/lib/agents/contracts";
import { getPromptForAgent } from "@/lib/agents/prompts/registry";
import { stripInternalKeys } from "@/lib/services/teacher-review/serializers";

export type StudentProfilingInput = AgentInputByName["student_profiling_agent"];

export type BuiltStudentProfilingInput = {
  input: StudentProfilingInput;
  response_package: {
    id: string;
    package_type: string;
    created_at: Date;
  };
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  agent_invocation_key: string;
};

const prohibitedKeyFragments = [
  "password",
  "access_code",
  "cookie",
  "authorization",
  "api_key",
  "database_url",
  "session_secret",
  "token"
];

function isoDate(value?: Date | null) {
  return value ? value.toISOString() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeJson(value: unknown): unknown {
  return stripInternalKeys(value);
}

function countByEventType(events: Array<{ event_type: string }>) {
  return events.reduce<Record<string, number>>((counts, event) => {
    counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
    return counts;
  }, {});
}

function eventCount(types: Record<string, number>, keys: string[]) {
  return keys.reduce((total, key) => total + (types[key] ?? 0), 0);
}

function hasRevisionPayload(payload: Prisma.JsonValue | null) {
  const record = asRecord(payload);

  return record.revision === true || Number(record.revision_count ?? 0) > 0;
}

function stableInvocationKey(prefix: string, parts: Array<string | null | undefined>) {
  const hash = createHash("sha256").update(parts.map((part) => part ?? "").join("|")).digest("hex");

  return `${prefix}_${hash}`;
}

function assertNoProhibitedInputFields(value: unknown, path = "input") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoProhibitedInputFields(entry, `${path}.${index}`));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    const prohibited = prohibitedKeyFragments.some((fragment) => normalized.includes(fragment));

    if (prohibited || key.endsWith("_db_id") || key.endsWith("_db_ids") || key === "id") {
      throw new Error(`Prohibited profiling input field at ${path}.${key}`);
    }

    assertNoProhibitedInputFields(entry, `${path}.${key}`);
  }
}

export async function buildInitialStudentProfilingInput(
  conceptUnitSessionDbId: string,
  responsePackageId: string
): Promise<BuiltStudentProfilingInput> {
  const conceptUnitSession = await prisma.conceptUnitSession.findUniqueOrThrow({
    where: { id: conceptUnitSessionDbId },
    include: {
      assessment_session: {
        select: {
          id: true,
          session_public_id: true,
          attempt_number: true,
          status: true,
          current_phase: true,
          started_at: true,
          last_activity_at: true,
          completed_at: true,
          user: {
            select: {
              user_id: true
            }
          },
          assessment: {
            select: {
              assessment_public_id: true,
              title: true,
              description: true,
              status: true
            }
          }
        }
      },
      concept_unit: {
        include: {
          items: {
            where: {
              included_in_published_set: true,
              status: "published"
            },
            orderBy: [{ item_order: "asc" }, { created_at: "asc" }]
          }
        }
      },
      item_responses: {
        orderBy: [{ item: { item_order: "asc" } }, { created_at: "asc" }],
        include: {
          item: true
        }
      },
      conversation_turns: {
        orderBy: [{ sequence_index: "asc" }],
        include: {
          item: {
            select: {
              item_public_id: true,
              item_order: true
            }
          }
        }
      },
      process_events: {
        orderBy: [{ occurred_at: "asc" }, { created_at: "asc" }],
        include: {
          item: {
            select: {
              item_public_id: true,
              item_order: true
            }
          }
        }
      }
    }
  });
  const responsePackage = await prisma.responsePackage.findFirstOrThrow({
    where: {
      id: responsePackageId,
      concept_unit_session_db_id: conceptUnitSessionDbId,
      package_type: "initial_concept_unit_response_package"
    },
    select: {
      id: true,
      package_type: true,
      payload: true,
      created_at: true
    }
  });
  const eventCounts = countByEventType(conceptUnitSession.process_events);
  const optionRevisionCount = conceptUnitSession.process_events.filter(
    (event) => event.event_type === "option_selected" && hasRevisionPayload(event.payload)
  ).length;
  const processAggregates = {
    event_count_by_type: eventCounts,
    page_switch_count: eventCount(eventCounts, ["page_hidden", "page_visible"]),
    long_pause_count: eventCount(eventCounts, ["long_pause"]),
    inactivity_count: eventCount(eventCounts, ["inactivity_detected"]),
    navigation_event_count: eventCount(eventCounts, ["navigation_event"]),
    invalid_help_request_count: eventCount(eventCounts, ["invalid_help_request"]),
    prompt_injection_attempt_count: eventCount(eventCounts, ["prompt_injection_attempt"]),
    procedural_clarification_count: eventCount(eventCounts, [
      "procedural_clarification_request"
    ]),
    emotional_response_count: eventCount(eventCounts, [
      "emotional_or_frustration_response"
    ]),
    reasoning_revision_count: eventCount(eventCounts, ["reasoning_revised"]),
    option_revision_count: optionRevisionCount,
    validation_failure_count: eventCount(eventCounts, ["schema_validation_failed"]),
    agent_retry_count: eventCount(eventCounts, ["agent_retry_scheduled"]),
    followup_turn_count: 0
  };
  const itemResponsesByItemId = new Map(
    conceptUnitSession.item_responses.map((response) => [response.item_db_id, response])
  );
  const itemEvidence = conceptUnitSession.concept_unit.items.map((item) => {
    const response = itemResponsesByItemId.get(item.id);

    return {
      item_public_id: item.item_public_id,
      item_order: item.item_order,
      administered_snapshot: response ? safeJson(response.item_snapshot) : null,
      current_item_metadata: {
        item_public_id: item.item_public_id,
        item_order: item.item_order,
        item_stem: item.item_stem,
        options: safeJson(item.options),
        correct_option: item.correct_option,
        distractor_rationales: safeJson(item.distractor_rationales),
        expected_reasoning_patterns: safeJson(item.expected_reasoning_patterns),
        possible_misconception_indicators: safeJson(
          item.possible_misconception_indicators
        ),
        administration_rules: safeJson(item.administration_rules),
        version: item.version
      },
      response: response
        ? {
            selected_option: response.selected_option,
            correct_option_snapshot: response.correct_option_snapshot,
            correctness: response.correctness,
            reasoning_text: response.reasoning_text,
            confidence_rating: response.confidence_rating,
            skipped_item: response.skipped_item,
            skipped_reasoning: response.skipped_reasoning,
            skipped_confidence: response.skipped_confidence,
            revision_count: response.revision_count,
            missing_evidence_repair_offered: response.missing_evidence_repair_offered,
            item_response_time_ms: response.item_response_time_ms,
            item_started_at: isoDate(response.item_started_at),
            item_submitted_at: isoDate(response.item_submitted_at),
            item_version_snapshot: response.item_version_snapshot,
            response_finalized: Boolean(response.item_submitted_at)
          }
        : null
    };
  });
  const prompt = getPromptForAgent("student_profiling_agent");
  const input: StudentProfilingInput = {
    concept_unit_metadata: {
      assessment: {
        assessment_public_id:
          conceptUnitSession.assessment_session.assessment.assessment_public_id,
        title: conceptUnitSession.assessment_session.assessment.title,
        description: conceptUnitSession.assessment_session.assessment.description,
        status: conceptUnitSession.assessment_session.assessment.status
      },
      assessment_session: {
        session_public_id: conceptUnitSession.assessment_session.session_public_id,
        attempt_number: conceptUnitSession.assessment_session.attempt_number,
        status: conceptUnitSession.assessment_session.status,
        current_phase: conceptUnitSession.assessment_session.current_phase,
        started_at: isoDate(conceptUnitSession.assessment_session.started_at),
        last_activity_at: isoDate(conceptUnitSession.assessment_session.last_activity_at),
        completed_at: isoDate(conceptUnitSession.assessment_session.completed_at)
      },
      student: {
        user_id: conceptUnitSession.assessment_session.user.user_id
      },
      concept_unit: {
        concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id,
        title: conceptUnitSession.concept_unit.title,
        learning_objective: conceptUnitSession.concept_unit.learning_objective,
        related_concept_description:
          conceptUnitSession.concept_unit.related_concept_description,
        administration_rules: safeJson(conceptUnitSession.concept_unit.administration_rules),
        order_index: conceptUnitSession.concept_unit.order_index,
        version: conceptUnitSession.concept_unit.version,
        initial_started_at: isoDate(conceptUnitSession.initial_started_at),
        initial_completed_at: isoDate(conceptUnitSession.initial_completed_at)
      }
    },
    initial_response_package: {
      package_type: responsePackage.package_type,
      created_at: responsePackage.created_at.toISOString(),
      payload: safeJson(responsePackage.payload),
      item_evidence: itemEvidence,
      conversation_turns: conceptUnitSession.conversation_turns.map((turn) => ({
        actor_type: turn.actor_type,
        agent_name: turn.agent_name,
        phase: turn.phase,
        message_text: turn.message_text,
        structured_payload: safeJson(turn.structured_payload),
        created_at: turn.created_at.toISOString(),
        item_public_id: turn.item?.item_public_id ?? null,
        item_order: turn.item?.item_order ?? null
      })),
      process_event_aggregates: processAggregates,
      process_events: conceptUnitSession.process_events.map((event) => ({
        event_type: event.event_type,
        event_category: event.event_category,
        event_source: event.event_source,
        visibility_duration_ms: event.visibility_duration_ms,
        pause_duration_ms: event.pause_duration_ms,
        payload: safeJson(event.payload),
        occurred_at: event.occurred_at.toISOString(),
        item_public_id: event.item?.item_public_id ?? null,
        item_order: event.item?.item_order ?? null
      }))
    },
    previous_profile: null,
    followup_evidence_package: null,
    profile_type: "initial",
    profiling_constraints: {
      profile_layers: [
        "ability_profile",
        "engagement_profile",
        "integrated_diagnostic_profile"
      ],
      correctness_is_evidence_not_profile: true,
      process_data_boundary:
        "Process data are contextual evidence for engagement and evidence sufficiency, not misconduct evidence.",
      prohibited_claims: ["cheating", "dishonesty", "confirmed GenAI use", "misconduct"],
      independence_language: [
        "independent_understanding_likely",
        "independent_understanding_uncertain",
        "insufficient_evidence"
      ],
      conservative_inference_required: true,
      output_schema_version: prompt.schema_version
    }
  };

  assertNoProhibitedInputFields(input);

  return {
    input,
    response_package: responsePackage,
    assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
    concept_unit_session_db_id: conceptUnitSession.id,
    agent_invocation_key: stableInvocationKey("student_profile_initial", [
      conceptUnitSession.id,
      responsePackage.id,
      "initial",
      prompt.prompt_version,
      prompt.schema_version,
      prompt.prompt_hash
    ])
  };
}

export async function buildUpdatedStudentProfilingInput(input: {
  concept_unit_session_db_id: string;
  followup_evidence_package_db_id: string;
  previous_student_profile_db_id: string;
  cycle_public_id: string;
}): Promise<BuiltStudentProfilingInput> {
  const initialPackage = await prisma.responsePackage.findFirstOrThrow({
    where: {
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      package_type: "initial_concept_unit_response_package"
    },
    orderBy: [{ created_at: "desc" }],
    select: { id: true }
  });
  const built = await buildInitialStudentProfilingInput(
    input.concept_unit_session_db_id,
    initialPackage.id
  );
  const followupPackage = await prisma.responsePackage.findFirstOrThrow({
    where: {
      id: input.followup_evidence_package_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      package_type: "followup_evidence_update_package"
    },
    select: {
      id: true,
      package_type: true,
      payload: true,
      created_at: true
    }
  });
  const previousProfile = await prisma.studentProfile.findFirstOrThrow({
    where: {
      id: input.previous_student_profile_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id
    }
  });
  const prompt = getPromptForAgent("student_profiling_agent");
  const updatedInput: StudentProfilingInput = {
    ...built.input,
    previous_profile: {
      profile_type: previousProfile.profile_type,
      ability_profile: previousProfile.ability_profile,
      ability_pattern_flags: safeJson(previousProfile.ability_pattern_flags),
      engagement_profile: previousProfile.engagement_profile,
      engagement_pattern_flags: safeJson(previousProfile.engagement_pattern_flags),
      integrated_diagnostic_profile: previousProfile.integrated_diagnostic_profile,
      integrated_profile_confidence: previousProfile.integrated_profile_confidence,
      integrated_profile_rationale: previousProfile.integrated_profile_rationale,
      evidence_sufficiency: previousProfile.evidence_sufficiency,
      confidence_alignment: previousProfile.confidence_alignment,
      independence_interpretability: previousProfile.independence_interpretability,
      misconception_indicators: safeJson(previousProfile.misconception_indicators),
      item_level_evidence: safeJson(previousProfile.item_level_evidence),
      reasoning_quality_summary: previousProfile.reasoning_quality_summary,
      engagement_summary: previousProfile.engagement_summary,
      process_interpretation_cautions: safeJson(
        previousProfile.process_interpretation_cautions
      ),
      profile_confidence: previousProfile.profile_confidence,
      rationale: previousProfile.rationale,
      recommended_next_evidence: safeJson(previousProfile.recommended_next_evidence),
      created_at: previousProfile.created_at.toISOString()
    },
    followup_evidence_package: {
      package_type: followupPackage.package_type,
      created_at: followupPackage.created_at.toISOString(),
      payload: safeJson(followupPackage.payload)
    },
    profile_type: "updated",
    profiling_constraints: {
      ...built.input.profiling_constraints,
      update_cycle_public_id: input.cycle_public_id,
      previous_active_profile_supplied: true,
      updated_profile_must_reflect_followup_evidence: true
    }
  };

  assertNoProhibitedInputFields(updatedInput);

  return {
    input: updatedInput,
    response_package: followupPackage,
    assessment_session_db_id: built.assessment_session_db_id,
    concept_unit_session_db_id: built.concept_unit_session_db_id,
    agent_invocation_key: stableInvocationKey("student_profile_updated", [
      input.concept_unit_session_db_id,
      followupPackage.id,
      previousProfile.id,
      input.cycle_public_id,
      "updated",
      prompt.prompt_version,
      prompt.schema_version,
      prompt.prompt_hash
    ])
  };
}
