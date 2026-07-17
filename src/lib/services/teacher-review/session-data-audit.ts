import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { processEventTypes } from "@/lib/domain/enums";
import {
  buildAbilityEvidencePacketForSession,
  type AbilityEvidencePacketV1
} from "@/lib/services/student-assessment/ability-evidence";
import {
  buildEngagementEvidencePacketForSession,
  type EngagementEvidencePacketV1
} from "@/lib/services/student-assessment/engagement-evidence";
import { TeacherReviewServiceError } from "./errors";
import { asArray, asRecord, assertNoInternalIds, serializeDate } from "./serializers";

export const SESSION_DATA_COMPLETENESS_REVIEW_VERSION =
  "session-data-completeness-review-v1" as const;

const PROCESS_CONTEXT_BOUNDARY =
  "Process data are evidence-quality context. They should not be used alone to infer misconception, ability, cheating, or misconduct.";

const expectedInitialAdministrationEvents = [
  "session_started",
  "agent_message_shown",
  "item_presented",
  "option_clicked",
  "answer_changed",
  "reasoning_started",
  "reasoning_submitted",
  "confidence_clicked",
  "tempting_option_submitted",
  "tempting_option_reason_submitted",
  "item_completed",
  "package_review_opened",
  "package_submitted"
] as const;

const focusVisibilityEventTypes = [
  "page_hidden",
  "page_visible",
  "page_visibility_hidden",
  "page_visibility_visible",
  "window_blur",
  "window_focus"
] as const;

const pauseInactivityEventTypes = ["long_pause", "inactivity_detected"] as const;

type CountMap = Record<string, number>;

function increment(counts: CountMap, key: string | null | undefined) {
  const normalized = key || "missing";
  counts[normalized] = (counts[normalized] ?? 0) + 1;
}

function countBy(values: Array<string | null | undefined>) {
  const counts: CountMap = {};
  for (const value of values) {
    increment(counts, value);
  }
  return counts;
}

function countKeys(records: Record<string, unknown>[]) {
  const counts: CountMap = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (value === true || (Array.isArray(value) && value.length > 0)) {
        increment(counts, key);
      }
    }
  }
  return counts;
}

function booleanAvailability(counts: CountMap, eventTypes: readonly string[]) {
  return eventTypes.some((eventType) => (counts[eventType] ?? 0) > 0);
}

function latestByDate<T extends { created_at: Date }>(records: T[]) {
  return [...records].sort((left, right) => right.created_at.getTime() - left.created_at.getTime())[0] ?? null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function publicIdFromResponsePayload(response: Record<string, unknown>) {
  const itemPublicId = response.item_public_id;
  return typeof itemPublicId === "string" ? itemPublicId : null;
}

function isTemptingPayload(value: unknown) {
  const payload = asRecord(value);
  return payload.source === "initial_tempting_option" &&
    (payload.no_tempting_option === true || isNonEmptyString(payload.tempting_option));
}

function countInitialTemptingEvidence(conversationTurns: Array<{ structured_payload: unknown }>) {
  return conversationTurns.filter((turn) => isTemptingPayload(turn.structured_payload)).length;
}

function summarizeResponsePackagePayload(payload: unknown) {
  const record = asRecord(payload);
  const itemResponses = asArray(record.item_responses).map(asRecord);
  const includedItems = asArray(record.included_items).map(asRecord);

  return {
    item_response_count: itemResponses.length,
    included_item_count: includedItems.length,
    item_public_ids: itemResponses.map(publicIdFromResponsePayload).filter(Boolean),
    answer_choice_count: itemResponses.filter((response) =>
      isNonEmptyString(response.selected_answer_final) || isNonEmptyString(response.selected_option)
    ).length,
    reasoning_count: itemResponses.filter((response) =>
      isNonEmptyString(response.reasoning_text_final) || isNonEmptyString(response.reasoning_text)
    ).length,
    confidence_count: itemResponses.filter((response) =>
      isNonEmptyString(response.confidence_final) || isNonEmptyString(response.confidence_rating)
    ).length,
    tempting_option_evidence_count: itemResponses.filter((response) =>
      response.no_tempting_option === true || isNonEmptyString(response.tempting_option)
    ).length,
    item_role_count: itemResponses.filter((response) => isNonEmptyString(response.item_role)).length,
    cognitive_demand_count: itemResponses.filter((response) =>
      isNonEmptyString(response.cognitive_demand)
    ).length,
    difficulty_count: itemResponses.filter((response) => isNonEmptyString(response.difficulty)).length,
    knowledge_component_count: itemResponses.filter((response) =>
      isNonEmptyString(response.knowledge_component)
    ).length,
    misconception_cluster_count: itemResponses.filter((response) =>
      isNonEmptyString(response.misconception_cluster)
    ).length,
    timing_field_counts: {
      item_started_at: itemResponses.filter((response) => isNonEmptyString(response.item_started_at)).length,
      answer_selected_at: itemResponses.filter((response) => isNonEmptyString(response.answer_selected_at)).length,
      reasoning_submitted_at: itemResponses.filter((response) =>
        isNonEmptyString(response.reasoning_submitted_at)
      ).length,
      confidence_selected_at: itemResponses.filter((response) =>
        isNonEmptyString(response.confidence_selected_at)
      ).length,
      item_completed_at: itemResponses.filter((response) => isNonEmptyString(response.item_completed_at)).length
    },
    logging_limitations: asRecord(record.logging_limitations)
  };
}

function summarizeEngagementPacket(packet: EngagementEvidencePacketV1 | null, error: unknown) {
  if (!packet) {
    return {
      engagement_packet_available: false,
      internal_only_engagement_category: null,
      category_confidence: null,
      ai_assistance_signal: null,
      evidence_item_count: 0,
      process_data_limitation_flags: [
        error instanceof Error ? error.message : "engagement_packet_unavailable"
      ],
      threshold_policy: null
    };
  }

  return {
    engagement_packet_available: true,
    internal_only_engagement_category:
      packet.session_engagement_summary.provisional_engagement_category,
    category_confidence: packet.session_engagement_summary.category_confidence,
    ai_assistance_signal: packet.session_engagement_summary.ai_assistance_signal,
    evidence_item_count: packet.item_engagement_evidence.length,
    process_data_limitation_flags: [
      ...packet.session_engagement_summary.limitations,
      ...packet.process_data_inventory.instrumentation_limitations
    ],
    threshold_policy: packet.session_engagement_summary.threshold_policy
  };
}

function summarizeCorrectnessInflation(packet: AbilityEvidencePacketV1 | null, error: unknown) {
  if (!packet) {
    return {
      ability_packet_available: false,
      unsupported_correct_response_count: 0,
      estimated_guessing_risk_counts: {},
      correctness_support_level_counts: {},
      answer_selection_evidence_weight_distribution: {},
      uncertainty_marker_count: 0,
      uncertainty_marker_type_counts: {},
      interpretation_boundary:
        "These are internal evidence-quality indicators. They should not be interpreted as misconduct labels or as direct ability estimates.",
      limitations: [error instanceof Error ? error.message : "ability_packet_unavailable"]
    };
  }

  return {
    ability_packet_available: true,
    unsupported_correct_response_count:
      packet.concept_level_summary.unsupported_correct_response_count,
    estimated_guessing_risk_counts:
      packet.concept_level_summary.estimated_guessing_risk_counts,
    correctness_support_level_counts:
      packet.concept_level_summary.correctness_support_level_counts,
    answer_selection_evidence_weight_distribution:
      packet.concept_level_summary.answer_selection_evidence_weight_counts,
    uncertainty_marker_count:
      packet.concept_level_summary.uncertainty_marker_count,
    uncertainty_marker_type_counts:
      packet.concept_level_summary.uncertainty_marker_type_counts,
    interpretation_boundary:
      "These are internal evidence-quality indicators. They should not be interpreted as misconduct labels or as direct ability estimates.",
    limitations: packet.concept_level_summary.evidence_limitations
  };
}

function summarizeActivityResponseChoices(attempts: Array<{ latest_activity_response_reference: unknown }>) {
  const counts: CountMap = { continue: 0, choose_another_activity: 0, move_on: 0, missing: 0 };

  for (const attempt of attempts) {
    const reference = asRecord(attempt.latest_activity_response_reference);
    const state = typeof reference.student_choice_state === "string"
      ? reference.student_choice_state
      : "missing";
    increment(counts, state);
  }

  return counts;
}

function cleanLimitations(values: unknown[]) {
  return [...new Set(values.flatMap((value) => {
    if (Array.isArray(value)) {
      return value.filter(isNonEmptyString);
    }
    return isNonEmptyString(value) ? [value] : [];
  }))];
}

async function resolveSessionPublicId(sessionPublicId?: string) {
  if (sessionPublicId) {
    return sessionPublicId;
  }

  const latest = await prisma.assessmentSession.findFirst({
    orderBy: [{ last_activity_at: "desc" }, { created_at: "desc" }],
    select: { session_public_id: true }
  });

  if (!latest) {
    throw new TeacherReviewServiceError(
      "not_found",
      "No assessment sessions were found for data completeness review.",
      404
    );
  }

  return latest.session_public_id;
}

function artifactTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function buildTeacherSessionDataAudit(input: {
  session_public_id?: string;
  write_artifact?: boolean;
  output_dir?: string;
} = {}) {
  const sessionPublicId = await resolveSessionPublicId(input.session_public_id);
  const session = await prisma.assessmentSession.findUnique({
    where: { session_public_id: sessionPublicId },
    include: {
      user: {
        select: {
          user_id: true,
          display_name: true
        }
      },
      assessment: {
        select: {
          assessment_public_id: true,
          title: true
        }
      },
      concept_unit_sessions: {
        orderBy: [{ concept_unit: { order_index: "asc" } }, { created_at: "asc" }],
        include: {
          concept_unit: {
            select: {
              concept_unit_public_id: true,
              title: true,
              order_index: true
            }
          },
          item_responses: {
            orderBy: [{ item: { item_order: "asc" } }],
            include: {
              item: {
                select: {
                  item_public_id: true,
                  item_order: true
                }
              }
            }
          },
          conversation_turns: {
            orderBy: [{ sequence_index: "asc" }],
            select: {
              actor_type: true,
              phase: true,
              structured_payload: true,
              created_at: true
            }
          },
          process_events: {
            orderBy: [{ occurred_at: "asc" }, { created_at: "asc" }],
            select: {
              event_type: true,
              event_category: true,
              event_source: true,
              item_db_id: true,
              visibility_duration_ms: true,
              pause_duration_ms: true,
              occurred_at: true,
              created_at: true
            }
          },
          response_packages: {
            orderBy: [{ created_at: "asc" }]
          }
        }
      }
    }
  });

  if (!session) {
    throw new TeacherReviewServiceError(
      "not_found",
      "Assessment session was not found.",
      404,
      { session_public_id: sessionPublicId }
    );
  }

  const conceptUnitSessionIds = session.concept_unit_sessions.map((conceptUnitSession) => conceptUnitSession.id);
  const allItemResponses = session.concept_unit_sessions.flatMap((conceptUnitSession) =>
    conceptUnitSession.item_responses
  );
  const allConversationTurns = session.concept_unit_sessions.flatMap((conceptUnitSession) =>
    conceptUnitSession.conversation_turns
  );
  const allProcessEvents = session.concept_unit_sessions.flatMap((conceptUnitSession) =>
    conceptUnitSession.process_events.map((event) => ({
      ...event,
      concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id
    }))
  );
  const allResponsePackages = session.concept_unit_sessions.flatMap((conceptUnitSession) =>
    conceptUnitSession.response_packages.map((responsePackage) => ({
      ...responsePackage,
      concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id,
      concept_unit_title: conceptUnitSession.concept_unit.title
    }))
  );
  const initialPackages = allResponsePackages.filter((responsePackage) =>
    responsePackage.package_type === "initial_concept_unit_response_package"
  );
  const latestInitialPackage = latestByDate(initialPackages);
  const latestPackageSummary = latestInitialPackage
    ? summarizeResponsePackagePayload(latestInitialPackage.payload)
    : null;

  const eventCounts = countBy(allProcessEvents.map((event) => event.event_type));
  const observedEventTypes = Object.keys(eventCounts).sort();
  const missingExpectedEventTypes = expectedInitialAdministrationEvents.filter(
    (eventType) => (eventCounts[eventType] ?? 0) === 0
  );
  const firstEvent = allProcessEvents[0] ?? null;
  const lastEvent = allProcessEvents.at(-1) ?? null;

  let engagementPacket: EngagementEvidencePacketV1 | null = null;
  let engagementPacketError: unknown = null;
  let abilityPacket: AbilityEvidencePacketV1 | null = null;
  let abilityPacketError: unknown = null;
  try {
    engagementPacket = await buildEngagementEvidencePacketForSession(session.session_public_id);
  } catch (error) {
    engagementPacketError = error;
  }
  try {
    abilityPacket = await buildAbilityEvidencePacketForSession(session.session_public_id);
  } catch (error) {
    abilityPacketError = error;
  }

  const activityAttempts = await prisma.activityRuntimeAttempt.findMany({
    where: { session_public_id: session.session_public_id },
    orderBy: [{ created_at: "asc" }]
  });
  const evidenceRecords = await prisma.activityMisconceptionEvidenceRecord.findMany({
    where: { session_public_id: session.session_public_id },
    orderBy: [{ created_at: "asc" }]
  });
  const diagnosticSnapshots = await prisma.postActivityDiagnosticSnapshot.findMany({
    where: { session_public_id: session.session_public_id },
    orderBy: [{ created_at: "asc" }]
  });
  const agentCalls = await prisma.agentCall.findMany({
    where: {
      OR: [
        { assessment_session_db_id: session.id },
        { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
      ]
    },
    orderBy: [{ created_at: "asc" }],
    select: {
      agent_name: true,
      provider: true,
      provider_request_id: true,
      provider_response_id: true,
      client_request_id: true,
      agent_invocation_key: true,
      prompt_hash: true,
      prompt_version: true,
      call_status: true,
      output_validated: true,
      input_tokens: true,
      output_tokens: true,
      total_tokens: true,
      token_usage: true,
      created_at: true,
      completed_at: true
    }
  });

  const latestActivityAttempt = activityAttempts.at(-1) ?? null;
  const dataCompleteness = {
    session: {
      session_public_id: session.session_public_id,
      status: session.status,
      current_phase: session.current_phase,
      started_at: serializeDate(session.started_at),
      last_activity_at: serializeDate(session.last_activity_at),
      completed_at: serializeDate(session.completed_at)
    },
    assessment: {
      assessment_public_id: session.assessment.assessment_public_id,
      title: session.assessment.title
    },
    student: {
      user_id: session.user.user_id,
      display_name_present: Boolean(session.user.display_name)
    },
    response_package: {
      concept_unit_session_count: session.concept_unit_sessions.length,
      item_attempt_count: allItemResponses.length,
      submitted_answer_count: allItemResponses.filter((response) => Boolean(response.selected_option)).length,
      reasoning_response_count: allItemResponses.filter((response) =>
        isNonEmptyString(response.reasoning_text)
      ).length,
      confidence_response_count: allItemResponses.filter((response) =>
        isNonEmptyString(response.confidence_rating)
      ).length,
      tempting_option_response_count: latestPackageSummary?.tempting_option_evidence_count ??
        countInitialTemptingEvidence(allConversationTurns),
      revisions_count: allItemResponses.reduce((total, response) => total + response.revision_count, 0),
      conversation_turns_count: allConversationTurns.length,
      package_count: allResponsePackages.length,
      initial_package_count: initialPackages.length,
      latest_initial_package_created_at: serializeDate(latestInitialPackage?.created_at),
      package_completion_state: latestInitialPackage ? "initial_package_present" : "missing_initial_package"
    }
  };

  const processDataSummary = {
    process_event_count: allProcessEvents.length,
    observed_event_type_count: observedEventTypes.length,
    observed_event_counts: eventCounts,
    expected_initial_administration_event_types: [...expectedInitialAdministrationEvents],
    missing_expected_initial_event_types: missingExpectedEventTypes,
    supported_process_event_type_count: processEventTypes.length,
    item_scoped_event_count: allProcessEvents.filter((event) => Boolean(event.item_db_id)).length,
    session_scoped_event_count: allProcessEvents.filter((event) => !event.item_db_id).length,
    concept_unit_scoped_counts: countBy(allProcessEvents.map((event) => event.concept_unit_public_id)),
    event_source_counts: countBy(allProcessEvents.map((event) => event.event_source)),
    first_event_at: serializeDate(firstEvent?.occurred_at),
    last_event_at: serializeDate(lastEvent?.occurred_at),
    availability: {
      focus_visibility_events_available: booleanAvailability(eventCounts, focusVisibilityEventTypes),
      paste_events_available: (eventCounts.paste_detected ?? 0) > 0,
      typing_summary_events_available: (eventCounts.typing_activity_summary ?? 0) > 0,
      pause_or_inactivity_events_available: booleanAvailability(eventCounts, pauseInactivityEventTypes)
    },
    inventory_summary: {
      observed_event_types: observedEventTypes,
      unobserved_supported_event_types: processEventTypes.filter(
        (eventType) => (eventCounts[eventType] ?? 0) === 0
      )
    }
  };

  const responseEvidenceSummary = {
    latest_initial_package_available: Boolean(latestInitialPackage),
    latest_initial_package_summary: latestPackageSummary,
    response_package_evidence_complete_for_initial_three:
      Boolean(latestPackageSummary && latestPackageSummary.item_response_count >= 3),
    answer_choices_present: (latestPackageSummary?.answer_choice_count ?? 0) > 0,
    reasoning_present: (latestPackageSummary?.reasoning_count ?? 0) > 0,
    confidence_present: (latestPackageSummary?.confidence_count ?? 0) > 0,
    tempting_option_evidence_present:
      (latestPackageSummary?.tempting_option_evidence_count ?? 0) > 0,
    fixed_item_metadata_present: {
      item_roles: (latestPackageSummary?.item_role_count ?? 0) > 0,
      cognitive_demand: (latestPackageSummary?.cognitive_demand_count ?? 0) > 0,
      difficulty: (latestPackageSummary?.difficulty_count ?? 0) > 0,
      knowledge_component: (latestPackageSummary?.knowledge_component_count ?? 0) > 0,
      misconception_cluster: (latestPackageSummary?.misconception_cluster_count ?? 0) > 0
    }
  };

  const engagementEvidenceSummary = summarizeEngagementPacket(
    engagementPacket,
    engagementPacketError
  );
  const correctnessInflationSummary = summarizeCorrectnessInflation(
    abilityPacket,
    abilityPacketError
  );

  const activityRuntimeSummary = {
    attempt_count: activityAttempts.length,
    status_counts: countBy(activityAttempts.map((attempt) => attempt.status)),
    activity_family_counts: countBy(activityAttempts.map((attempt) => attempt.activity_family)),
    generation_source_counts: countBy(activityAttempts.map((attempt) => attempt.generation_source)),
    latest_state: latestActivityAttempt?.status ?? null,
    latest_activity_response_reference_count: activityAttempts.filter((attempt) =>
      Boolean(attempt.latest_activity_response_reference)
    ).length,
    student_choice_state_counts: summarizeActivityResponseChoices(activityAttempts),
    failed_closed_count: activityAttempts.filter((attempt) => attempt.status === "failed_closed").length,
    limitations: activityAttempts.length > 0
      ? cleanLimitations(activityAttempts.map((attempt) => attempt.limitations))
      : ["no_activity_runtime_attempts_found"]
  };

  const safetyFlagRecords = evidenceRecords.map((record) => asRecord(record.safety_flags));
  const misconceptionEvidenceSummary = {
    record_count: evidenceRecords.length,
    evaluation_source_counts: countBy(evidenceRecords.map((record) => record.evaluation_source)),
    production_mode_counts: countBy(evidenceRecords.map((record) => record.production_mode)),
    live_record_count: evidenceRecords.filter((record) => record.evaluation_source === "live_llm").length,
    no_live_record_count: evidenceRecords.filter((record) => record.evaluation_source !== "live_llm").length,
    safety_flag_key_counts: countKeys(safetyFlagRecords),
    update_status_counts: countBy(evidenceRecords.map((record) => record.misconception_update_status)),
    evidence_quality_counts: countBy(evidenceRecords.map((record) => record.evidence_quality)),
    recommended_next_purpose_counts: countBy(
      evidenceRecords.map((record) => record.recommended_next_diagnostic_purpose)
    )
  };

  const diagnosticSnapshotSummary = {
    snapshot_count: diagnosticSnapshots.length,
    before_state_available_count: diagnosticSnapshots.filter((snapshot) =>
      isNonEmptyString(snapshot.pre_activity_diagnostic_state)
    ).length,
    after_state_available_count: diagnosticSnapshots.filter((snapshot) =>
      isNonEmptyString(snapshot.post_activity_diagnostic_state)
    ).length,
    update_status_counts: countBy(diagnosticSnapshots.map((snapshot) => snapshot.activity_update_status)),
    recommended_next_purpose_counts: countBy(
      diagnosticSnapshots.map((snapshot) => snapshot.next_diagnostic_purpose)
    )
  };

  const providerMetadataPresent = agentCalls.filter((call) =>
    Boolean(call.provider_request_id || call.provider_response_id || call.client_request_id)
  ).length;
  const tokenUsagePresent = agentCalls.filter((call) =>
    Number.isFinite(call.input_tokens) ||
    Number.isFinite(call.output_tokens) ||
    Number.isFinite(call.total_tokens) ||
    Boolean(call.token_usage)
  ).length;
  const failedCalls = agentCalls.filter((call) =>
    ["failed", "invalid_output", "needs_review"].includes(call.call_status)
  );
  const repairCalls = agentCalls.filter((call) => {
    const haystack = `${call.agent_name} ${call.prompt_version} ${call.agent_invocation_key ?? ""}`.toLowerCase();
    return haystack.includes("repair");
  });

  const agentAuditSummary = {
    call_count: agentCalls.length,
    agent_name_counts: countBy(agentCalls.map((call) => call.agent_name)),
    provider_counts: countBy(agentCalls.map((call) => call.provider)),
    call_status_counts: countBy(agentCalls.map((call) => call.call_status)),
    provider_metadata_present_count: providerMetadataPresent,
    token_usage_present_count: tokenUsagePresent,
    failed_call_count: failedCalls.length,
    failed_call_summaries: failedCalls.map((call) => ({
      agent_name: call.agent_name,
      call_status: call.call_status,
      output_validated: call.output_validated,
      created_at: serializeDate(call.created_at),
      completed_at: serializeDate(call.completed_at)
    })),
    repair_call_count: repairCalls.length,
    unique_prompt_hash_count: new Set(
      agentCalls.map((call) => call.prompt_hash).filter(isNonEmptyString)
    ).size
  };

  const limitations = [
    ...(!latestInitialPackage ? ["initial_response_package_missing"] : []),
    ...(allProcessEvents.length === 0 ? ["process_events_missing"] : []),
    ...(missingExpectedEventTypes.length > 0
      ? [`missing_expected_process_events:${missingExpectedEventTypes.join(",")}`]
      : []),
    ...(!processDataSummary.availability.focus_visibility_events_available
      ? ["focus_visibility_process_events_unobserved"]
      : []),
    ...(!processDataSummary.availability.paste_events_available ? ["paste_process_events_unobserved"] : []),
    ...(!processDataSummary.availability.typing_summary_events_available
      ? ["typing_activity_summary_events_unobserved"]
      : []),
    ...(!processDataSummary.availability.pause_or_inactivity_events_available
      ? ["pause_or_inactivity_events_unobserved"]
      : []),
    ...(activityAttempts.length === 0 ? ["activity_runtime_attempts_missing"] : []),
    ...(evidenceRecords.length === 0 ? ["post_activity_misconception_evidence_missing"] : []),
    ...(diagnosticSnapshots.length === 0 ? ["post_activity_diagnostic_snapshots_missing"] : [])
  ];

  const audit = {
    artifact_version: SESSION_DATA_COMPLETENESS_REVIEW_VERSION,
    generated_at: new Date().toISOString(),
    no_live_provider_call_made: true,
    interpretation_boundary: PROCESS_CONTEXT_BOUNDARY,
    session_public_id: session.session_public_id,
    data_completeness: dataCompleteness,
    process_data_summary: processDataSummary,
    response_evidence_summary: responseEvidenceSummary,
    engagement_evidence_summary: engagementEvidenceSummary,
    correctness_inflation_summary: correctnessInflationSummary,
    activity_runtime_summary: activityRuntimeSummary,
    misconception_evidence_summary: misconceptionEvidenceSummary,
    diagnostic_snapshot_summary: diagnosticSnapshotSummary,
    agent_audit_summary: agentAuditSummary,
    limitations
  };

  assertNoInternalIds(audit);

  let artifactPath: string | null = null;
  if (input.write_artifact) {
    const outputDir =
      input.output_dir ?? path.join(process.cwd(), ".data", "session-data-completeness-review");
    await mkdir(outputDir, { recursive: true });
    artifactPath = path.join(
      outputDir,
      `session-data-completeness-${session.session_public_id}-${artifactTimestamp()}.json`
    );
    await writeFile(artifactPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  }

  return {
    ...audit,
    artifact_path: artifactPath
  };
}

export type TeacherSessionDataAudit = Awaited<ReturnType<typeof buildTeacherSessionDataAudit>>;
