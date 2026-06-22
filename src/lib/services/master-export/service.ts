import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sessionStatuses } from "@/lib/domain/enums";
import { generatePublicId } from "@/lib/services/ids";
import { stripInternalKeys } from "@/lib/services/teacher-review/serializers";
import { MasterExportServiceError } from "./errors";
import {
  MASTER_EXPORT_SCHEMA_VERSION,
  serializeMasterCsv,
  stableJson,
  type MasterExportRow
} from "./csv";
import {
  readExportFile,
  storageKeyForExport,
  writeExportFile
} from "./storage";

const masterExportOptionsSchema = z.object({
  assessment_public_id: z.string().trim().min(1).optional(),
  session_status: z.array(z.enum(sessionStatuses)).optional(),
  include_incomplete_sessions: z.boolean().default(true),
  primary_outcome_name: z.string().trim().min(1).optional(),
  include_raw_json_columns: z.boolean().default(true),
  spreadsheet_safe_text: z.boolean().default(true)
}).strict();

export type MasterExportOptions = z.infer<typeof masterExportOptionsSchema>;

function iso(value?: Date | null) {
  return value ? value.toISOString() : "";
}

function dateOnly(value?: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function decimalString(value: Prisma.Decimal | number | string | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function numberValue(value: Prisma.Decimal | number | string | null | undefined) {
  return value === null || value === undefined ? null : Number(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function snapshotField(snapshot: unknown, key: string, fallback: unknown = "") {
  const record = asRecord(snapshot);
  return record[key] ?? fallback;
}

function countEvent(events: Array<{ event_type: string; payload: unknown }>, keys: string[]) {
  return events.filter((event) => keys.includes(event.event_type)).length;
}

function hasRevisionPayload(payload: unknown) {
  const record = asRecord(payload);
  return record.revision === true || Number(record.revision_count ?? 0) > 0;
}

function aggregateEvents(events: Array<{ event_type: string; payload: unknown }>, followupTurnCount: number) {
  return {
    page_switch_count: countEvent(events, ["page_hidden", "page_visible"]),
    long_pause_count: countEvent(events, ["long_pause"]),
    inactivity_count: countEvent(events, ["inactivity_detected"]),
    navigation_event_count: countEvent(events, ["navigation_event"]),
    invalid_help_request_count: countEvent(events, ["invalid_help_request"]),
    prompt_injection_attempt_count: countEvent(events, ["prompt_injection_attempt"]),
    procedural_clarification_count: countEvent(events, ["procedural_clarification_request"]),
    emotional_response_count: countEvent(events, ["emotional_or_frustration_response"]),
    reasoning_revision_count: countEvent(events, ["reasoning_revised"]),
    option_revision_count: events.filter(
      (event) => event.event_type === "option_selected" && hasRevisionPayload(event.payload)
    ).length,
    validation_failure_count: countEvent(events, ["schema_validation_failed"]),
    agent_retry_count: countEvent(events, ["agent_retry_scheduled"]),
    followup_turn_count: followupTurnCount
  };
}

function transcriptText(
  turns: Array<{ actor_type: string; agent_name: string | null; message_text: string | null; created_at: Date }>
) {
  return turns
    .map((turn) => {
      const actor = turn.agent_name ? `${turn.actor_type}:${turn.agent_name}` : turn.actor_type;
      return `[${turn.created_at.toISOString()}] ${actor}: ${turn.message_text ?? ""}`;
    })
    .join("\n");
}

function isFollowupPhase(phase: string) {
  return [
    "followup_active",
    "followup_profile_update_pending",
    "followup_planning_update_pending",
    "followup_stopped"
  ].includes(phase);
}

function profileFields(profiles: Array<Record<string, unknown>>) {
  const sorted = [...profiles].sort(
    (left, right) =>
      new Date(String(left.created_at)).getTime() - new Date(String(right.created_at)).getTime()
  );
  const initial =
    sorted.find((profile) => profile.profile_type === "initial") ?? sorted[0] ?? null;
  const latest = sorted.at(-1) ?? null;

  return {
    initial_ability_profile: String(initial?.ability_profile ?? ""),
    latest_ability_profile: String(latest?.ability_profile ?? ""),
    ability_pattern_flags_latest: latest ? stableJson(latest.ability_pattern_flags ?? []) : "[]",
    initial_engagement_profile: String(initial?.engagement_profile ?? ""),
    latest_engagement_profile: String(latest?.engagement_profile ?? ""),
    engagement_pattern_flags_latest: latest ? stableJson(latest.engagement_pattern_flags ?? []) : "[]",
    initial_integrated_diagnostic_profile: String(initial?.integrated_diagnostic_profile ?? ""),
    latest_integrated_diagnostic_profile: String(latest?.integrated_diagnostic_profile ?? ""),
    integrated_profile_confidence_latest: String(latest?.integrated_profile_confidence ?? ""),
    integrated_profile_rationale_latest: String(latest?.integrated_profile_rationale ?? ""),
    evidence_sufficiency_latest: String(latest?.evidence_sufficiency ?? ""),
    confidence_alignment_latest: String(latest?.confidence_alignment ?? ""),
    independence_interpretability_latest: String(latest?.independence_interpretability ?? ""),
    misconception_indicators_latest: latest ? stableJson(latest.misconception_indicators ?? []) : "[]",
    reasoning_quality_summary_latest: String(latest?.reasoning_quality_summary ?? ""),
    engagement_summary_latest: String(latest?.engagement_summary ?? ""),
    process_interpretation_cautions_latest: latest
      ? stableJson(latest.process_interpretation_cautions ?? [])
      : "[]",
    profile_change_count: Math.max(0, sorted.length - 1),
    profile_history_json: stableJson(sorted),
    integrated_profile_history_json: stableJson(
      sorted.map((profile) => ({
        created_at: profile.created_at,
        integrated_diagnostic_profile: profile.integrated_diagnostic_profile,
        integrated_profile_confidence: profile.integrated_profile_confidence,
        integrated_profile_rationale: profile.integrated_profile_rationale
      }))
    )
  };
}

function formativeFields(decisions: Array<Record<string, unknown>>, followupRounds: unknown[]) {
  const sorted = [...decisions].sort(
    (left, right) =>
      new Date(String(left.created_at)).getTime() - new Date(String(right.created_at)).getTime()
  );
  const initial = sorted[0] ?? null;
  const latest = sorted.at(-1) ?? null;

  return {
    initial_formative_value: String(initial?.formative_value ?? ""),
    latest_formative_value: String(latest?.formative_value ?? ""),
    formative_action_plan_latest: String(latest?.formative_action_plan ?? ""),
    formative_value_change_count: Math.max(0, sorted.length - 1),
    formative_value_history_json: stableJson(sorted),
    followup_rounds_json: stableJson(followupRounds)
  };
}

function agentFields(agentCalls: Array<Record<string, unknown>>) {
  const stringSet = (key: string) =>
    [...new Set(agentCalls.map((call) => call[key]).filter((value) => typeof value === "string"))].join("|");

  return {
    agent_model_names: stringSet("model_name"),
    agent_versions: stringSet("agent_version"),
    prompt_versions: stringSet("prompt_version"),
    schema_versions: stringSet("schema_version"),
    agent_call_count: agentCalls.length,
    agent_validation_failure_count: agentCalls.filter(
      (call) => call.output_validated === false && call.validation_error
    ).length,
    agent_calls_json: stableJson(agentCalls)
  };
}

function outcomeFields(input: {
  outcomes: Array<{
    outcome_name: string;
    outcome_score: Prisma.Decimal;
    max_score: Prisma.Decimal;
    assessment_date: Date;
    notes: string | null;
    outcome_public_id: string;
    revision_number: number;
  }>;
  primaryOutcomeName?: string;
}) {
  const primary = input.primaryOutcomeName
    ? input.outcomes.find((outcome) => outcome.outcome_name === input.primaryOutcomeName)
    : null;
  const score = numberValue(primary?.outcome_score);
  const max = numberValue(primary?.max_score);

  return {
    primary_summative_outcome_name: primary?.outcome_name ?? "",
    primary_summative_outcome_score: decimalString(primary?.outcome_score),
    primary_summative_outcome_max_score: decimalString(primary?.max_score),
    primary_summative_outcome_percent:
      score !== null && max !== null && max > 0 ? ((score / max) * 100).toFixed(4) : "",
    primary_summative_assessment_date: dateOnly(primary?.assessment_date),
    summative_outcomes_json: stableJson(
      input.outcomes.map((outcome) => ({
        outcome_public_id: outcome.outcome_public_id,
        outcome_name: outcome.outcome_name,
        outcome_score: decimalString(outcome.outcome_score),
        max_score: decimalString(outcome.max_score),
        assessment_date: dateOnly(outcome.assessment_date),
        notes: outcome.notes,
        revision_number: outcome.revision_number
      }))
    )
  };
}

function baseEmptyRow(): MasterExportRow {
  return Object.fromEntries(
    [
      "export_generated_at",
      "export_schema_version",
      "row_type",
      "record_key",
      "spreadsheet_formula_sanitization_applied",
      "user_id",
      "student_display_name",
      "session_id",
      "assessment_id",
      "assessment_title",
      "attempt_number",
      "session_status",
      "current_phase",
      "needs_review",
      "needs_review_reason",
      "session_started_at",
      "session_last_activity_at",
      "session_completed_at",
      "student_chose_exit",
      "concept_unit_id",
      "concept_unit_title",
      "concept_unit_order",
      "concept_unit_status",
      "initial_started_at",
      "initial_completed_at",
      "followup_started_at",
      "followup_completed_at",
      "followup_status",
      "followup_round_count",
      "completed_initial_item_set",
      "completed_followup",
      "item_id",
      "item_order",
      "item_stem",
      "item_version_snapshot",
      "options_snapshot_json",
      "selected_option",
      "correct_option",
      "correctness",
      "reasoning_text",
      "confidence_rating",
      "item_response_time_ms",
      "item_started_at",
      "item_submitted_at",
      "skipped_item",
      "skipped_reasoning",
      "skipped_confidence",
      "revision_count",
      "missing_evidence_repair_offered",
      "response_finalized",
      "page_switch_count",
      "long_pause_count",
      "inactivity_count",
      "navigation_event_count",
      "invalid_help_request_count",
      "prompt_injection_attempt_count",
      "procedural_clarification_count",
      "emotional_response_count",
      "reasoning_revision_count",
      "option_revision_count",
      "validation_failure_count",
      "agent_retry_count",
      "followup_turn_count",
      "initial_conversation_transcript_text",
      "followup_conversation_transcript_text",
      "full_conversation_transcript_text",
      "conversation_turns_json",
      "process_events_json",
      "response_packages_json",
      "initial_ability_profile",
      "latest_ability_profile",
      "ability_pattern_flags_latest",
      "initial_engagement_profile",
      "latest_engagement_profile",
      "engagement_pattern_flags_latest",
      "initial_integrated_diagnostic_profile",
      "latest_integrated_diagnostic_profile",
      "integrated_profile_confidence_latest",
      "integrated_profile_rationale_latest",
      "evidence_sufficiency_latest",
      "confidence_alignment_latest",
      "independence_interpretability_latest",
      "misconception_indicators_latest",
      "reasoning_quality_summary_latest",
      "engagement_summary_latest",
      "process_interpretation_cautions_latest",
      "profile_change_count",
      "profile_history_json",
      "integrated_profile_history_json",
      "initial_formative_value",
      "latest_formative_value",
      "formative_action_plan_latest",
      "formative_value_change_count",
      "formative_value_history_json",
      "followup_rounds_json",
      "agent_model_names",
      "agent_versions",
      "prompt_versions",
      "schema_versions",
      "agent_call_count",
      "agent_validation_failure_count",
      "agent_calls_json",
      "primary_summative_outcome_name",
      "primary_summative_outcome_score",
      "primary_summative_outcome_max_score",
      "primary_summative_outcome_percent",
      "primary_summative_assessment_date",
      "summative_outcomes_json"
    ].map((column) => [column, ""])
  ) as MasterExportRow;
}

async function buildMasterExportRows(options: MasterExportOptions) {
  const generatedAt = new Date().toISOString();
  const sessionWhere: Prisma.AssessmentSessionWhereInput = {
    ...(options.assessment_public_id
      ? { assessment: { assessment_public_id: options.assessment_public_id } }
      : {}),
    ...(options.session_status?.length ? { status: { in: options.session_status } } : {}),
    ...(!options.include_incomplete_sessions && !options.session_status?.length
      ? { status: "completed" }
      : {})
  };
  const sessions = await prisma.assessmentSession.findMany({
    where: sessionWhere,
    include: {
      user: { select: { id: true, user_id: true, display_name: true } },
      assessment: {
        select: {
          assessment_public_id: true,
          title: true
        }
      },
      concept_unit_sessions: {
        include: {
          concept_unit: true,
          item_responses: {
            include: { item: true },
            orderBy: [{ item: { item_order: "asc" } }, { created_at: "asc" }]
          },
          conversation_turns: {
            orderBy: { created_at: "asc" }
          },
          process_events: {
            orderBy: [{ occurred_at: "asc" }, { created_at: "asc" }]
          },
          response_packages: {
            orderBy: { created_at: "asc" }
          },
          student_profiles: {
            orderBy: { created_at: "asc" }
          },
          formative_decisions: {
            orderBy: { created_at: "asc" }
          },
          followup_rounds: {
            orderBy: { round_index: "asc" }
          },
          agent_calls: {
            orderBy: { created_at: "asc" }
          }
        }
      },
      conversation_turns: {
        orderBy: { created_at: "asc" }
      },
      process_events: {
        orderBy: [{ occurred_at: "asc" }, { created_at: "asc" }]
      },
      agent_calls: {
        orderBy: { created_at: "asc" }
      }
    }
  });
  const sortedSessions = sessions.sort((left, right) =>
    [
      left.user.user_id.localeCompare(right.user.user_id),
      left.assessment.assessment_public_id.localeCompare(right.assessment.assessment_public_id),
      left.session_public_id.localeCompare(right.session_public_id)
    ].find((result) => result !== 0) ?? 0
  );
  const userDbIds = [...new Set(sortedSessions.map((session) => session.user.id))];
  const outcomes = await prisma.summativeOutcome.findMany({
    where: {
      user_db_id: { in: userDbIds },
      record_status: "active"
    },
    orderBy: [{ outcome_name: "asc" }, { assessment_date: "asc" }],
    select: {
      outcome_public_id: true,
      user_db_id: true,
      outcome_name: true,
      outcome_score: true,
      max_score: true,
      assessment_date: true,
      notes: true,
      revision_number: true
    }
  });
  const outcomesByUser = new Map<string, typeof outcomes>();

  for (const outcome of outcomes) {
    const current = outcomesByUser.get(outcome.user_db_id) ?? [];
    current.push(outcome);
    outcomesByUser.set(outcome.user_db_id, current);
  }

  const rows: MasterExportRow[] = [];

  for (const session of sortedSessions) {
    const sessionOutcomes = outcomesByUser.get(session.user.id) ?? [];
    const sessionOutcomeFields = outcomeFields({
      outcomes: sessionOutcomes,
      primaryOutcomeName: options.primary_outcome_name
    });
    const sessionTurns = session.conversation_turns;
    const sessionFollowupTurns = sessionTurns.filter((turn) => isFollowupPhase(turn.phase));
    const sessionProcessEvents = session.process_events;
    const sessionFollowupTurnCount = sessionFollowupTurns.length;
    const sortedConceptUnitSessions = [...session.concept_unit_sessions].sort(
      (left, right) =>
        left.concept_unit.order_index - right.concept_unit.order_index ||
        left.created_at.getTime() - right.created_at.getTime()
    );

    const makeBaseRow = (
      rowType: MasterExportRow["row_type"],
      conceptUnitSession?: (typeof sortedConceptUnitSessions)[number]
    ) => {
      const row = baseEmptyRow();
      const turns = conceptUnitSession?.conversation_turns ?? sessionTurns;
      const initialTurns = turns.filter((turn) => !isFollowupPhase(turn.phase));
      const followupTurns = turns.filter((turn) => isFollowupPhase(turn.phase));
      const processEvents = conceptUnitSession?.process_events ?? sessionProcessEvents;
      const responsePackages = conceptUnitSession?.response_packages ?? [];
      const aggregates = aggregateEvents(
        processEvents.map((event) => ({ event_type: event.event_type, payload: event.payload })),
        conceptUnitSession ? followupTurns.length : sessionFollowupTurnCount
      );
      const profiles = profileFields(
        (conceptUnitSession?.student_profiles ?? []).map((profile) => stripInternalKeys(profile) as Record<string, unknown>)
      );
      const formatives = formativeFields(
        (conceptUnitSession?.formative_decisions ?? []).map((decision) => stripInternalKeys(decision) as Record<string, unknown>),
        (conceptUnitSession?.followup_rounds ?? []).map((round) => stripInternalKeys(round))
      );
      const agents = agentFields(
        (conceptUnitSession?.agent_calls ?? session.agent_calls).map((call) => stripInternalKeys(call) as Record<string, unknown>)
      );

      row.export_generated_at = generatedAt;
      row.export_schema_version = MASTER_EXPORT_SCHEMA_VERSION;
      row.row_type = rowType;
      row.user_id = session.user.user_id;
      row.student_display_name = session.user.display_name ?? "";
      row.session_id = session.session_public_id;
      row.assessment_id = session.assessment.assessment_public_id;
      row.assessment_title = session.assessment.title;
      row.attempt_number = session.attempt_number;
      row.session_status = session.status;
      row.current_phase = session.current_phase;
      row.needs_review = session.needs_review;
      row.needs_review_reason = session.needs_review_reason ?? "";
      row.session_started_at = iso(session.started_at);
      row.session_last_activity_at = iso(session.last_activity_at);
      row.session_completed_at = iso(session.completed_at);
      row.student_chose_exit =
        session.status === "student_exited" || session.current_phase === "student_exited";

      if (conceptUnitSession) {
        row.concept_unit_id = conceptUnitSession.concept_unit.concept_unit_public_id;
        row.concept_unit_title = conceptUnitSession.concept_unit.title;
        row.concept_unit_order = conceptUnitSession.concept_unit.order_index;
        row.concept_unit_status = conceptUnitSession.status;
        row.initial_started_at = iso(conceptUnitSession.initial_started_at);
        row.initial_completed_at = iso(conceptUnitSession.initial_completed_at);
        row.followup_started_at = iso(conceptUnitSession.followup_started_at);
        row.followup_completed_at = iso(conceptUnitSession.followup_completed_at);
        row.followup_status = conceptUnitSession.followup_status;
        row.followup_round_count = conceptUnitSession.followup_round_count;
        row.completed_initial_item_set = Boolean(conceptUnitSession.initial_completed_at);
        row.completed_followup =
          conceptUnitSession.followup_status === "completed" ||
          Boolean(conceptUnitSession.followup_completed_at);
      }

      Object.assign(row, aggregates);
      row.initial_conversation_transcript_text = transcriptText(initialTurns);
      row.followup_conversation_transcript_text = transcriptText(followupTurns);
      row.full_conversation_transcript_text = transcriptText(turns);
      row.conversation_turns_json = options.include_raw_json_columns
        ? stableJson(turns.map((turn) => stripInternalKeys(turn)))
        : "";
      row.process_events_json = options.include_raw_json_columns
        ? stableJson(processEvents.map((event) => stripInternalKeys(event)))
        : "";
      row.response_packages_json = options.include_raw_json_columns
        ? stableJson(responsePackages.map((responsePackage) => stripInternalKeys(responsePackage)))
        : "";
      Object.assign(row, profiles, formatives, agents, sessionOutcomeFields);

      return row;
    };

    if (sortedConceptUnitSessions.length === 0) {
      const row = makeBaseRow("session_without_item_response");
      row.record_key = [
        row.row_type,
        session.user.user_id,
        session.assessment.assessment_public_id,
        session.session_public_id,
        "no_concept_unit",
        "no_item"
      ].join(":");
      rows.push(row);
      continue;
    }

    for (const conceptUnitSession of sortedConceptUnitSessions) {
      const itemResponses = [...conceptUnitSession.item_responses].sort(
        (left, right) =>
          left.item.item_order - right.item.item_order ||
          left.created_at.getTime() - right.created_at.getTime()
      );

      if (itemResponses.length === 0) {
        const row = makeBaseRow("concept_unit_without_item_response", conceptUnitSession);
        row.record_key = [
          row.row_type,
          session.user.user_id,
          session.assessment.assessment_public_id,
          session.session_public_id,
          conceptUnitSession.concept_unit.concept_unit_public_id,
          "no_item"
        ].join(":");
        rows.push(row);
        continue;
      }

      for (const response of itemResponses) {
        const row = makeBaseRow("item_response", conceptUnitSession);
        const itemStem = snapshotField(response.item_snapshot, "item_stem", response.item.item_stem);
        const optionsSnapshot = snapshotField(response.item_snapshot, "options", response.item.options);

        row.record_key = [
          row.row_type,
          session.user.user_id,
          session.assessment.assessment_public_id,
          session.session_public_id,
          conceptUnitSession.concept_unit.concept_unit_public_id,
          response.item.item_public_id
        ].join(":");
        row.item_id = response.item.item_public_id;
        row.item_order = response.item.item_order;
        row.item_stem = typeof itemStem === "string" ? itemStem : String(itemStem ?? "");
        row.item_version_snapshot = response.item_version_snapshot;
        row.options_snapshot_json = stableJson(optionsSnapshot);
        row.selected_option = response.selected_option ?? "";
        row.correct_option = response.correct_option_snapshot;
        row.correctness = response.correctness;
        row.reasoning_text = response.reasoning_text ?? "";
        row.confidence_rating = response.confidence_rating ?? "";
        row.item_response_time_ms = response.item_response_time_ms ?? "";
        row.item_started_at = iso(response.item_started_at);
        row.item_submitted_at = iso(response.item_submitted_at);
        row.skipped_item = response.skipped_item;
        row.skipped_reasoning = response.skipped_reasoning;
        row.skipped_confidence = response.skipped_confidence;
        row.revision_count = response.revision_count;
        row.missing_evidence_repair_offered = response.missing_evidence_repair_offered;
        row.response_finalized = Boolean(response.item_submitted_at);
        rows.push(row);
      }
    }
  }

  return rows;
}

function serializeExportJob(job: {
  export_public_id: string;
  status: string;
  file_name: string | null;
  row_count: number | null;
  options: unknown;
  export_schema_version: string | null;
  created_at: Date;
  completed_at: Date | null;
  expires_at: Date | null;
  error_message: string | null;
}) {
  return {
    export_public_id: job.export_public_id,
    status: job.status,
    file_name: job.file_name,
    row_count: job.row_count,
    options: stripInternalKeys(job.options),
    export_schema_version: job.export_schema_version,
    created_at: iso(job.created_at),
    completed_at: iso(job.completed_at),
    expires_at: iso(job.expires_at),
    error_message: job.error_message,
    download_url:
      job.status === "completed"
        ? `/api/teacher/export/${job.export_public_id}/download`
        : null
  };
}

export async function createMasterCsvExport(input: {
  teacher_user_db_id: string;
  data: unknown;
}) {
  const options = masterExportOptionsSchema.parse(input.data ?? {});
  const exportPublicId = generatePublicId("export");
  const fileName = "master_assessment_export.csv";
  const storageKey = storageKeyForExport(exportPublicId);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const job = await prisma.exportJob.create({
    data: {
      id: crypto.randomUUID(),
      export_public_id: exportPublicId,
      requested_by_user_db_id: input.teacher_user_db_id,
      status: "pending",
      file_name: fileName,
      storage_key: storageKey,
      row_count: 0,
      options: options as Prisma.InputJsonObject,
      export_schema_version: MASTER_EXPORT_SCHEMA_VERSION,
      expires_at: expiresAt
    }
  });

  try {
    await prisma.exportJob.update({
      where: { id: job.id },
      data: { status: "processing" }
    });

    const rows = await buildMasterExportRows(options);
    const csv = serializeMasterCsv(rows, {
      spreadsheet_safe_text: options.spreadsheet_safe_text
    });

    await writeExportFile(storageKey, csv);

    const completed = await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        row_count: rows.length,
        completed_at: new Date()
      }
    });

    return serializeExportJob(completed);
  } catch (error) {
    const failed = await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        error_message: error instanceof Error ? error.message : String(error),
        completed_at: new Date()
      }
    });

    return serializeExportJob(failed);
  }
}

export async function listExportJobs() {
  const jobs = await prisma.exportJob.findMany({
    orderBy: { created_at: "desc" },
    take: 100
  });

  return {
    export_jobs: jobs.map(serializeExportJob)
  };
}

export async function getExportJob(exportPublicId: string) {
  const job = await prisma.exportJob.findUnique({
    where: { export_public_id: exportPublicId }
  });

  if (!job) {
    throw new MasterExportServiceError("not_found", "Export job was not found.", 404, {
      export_public_id: exportPublicId
    });
  }

  return serializeExportJob(job);
}

export async function getExportDownload(exportPublicId: string) {
  const job = await prisma.exportJob.findUnique({
    where: { export_public_id: exportPublicId }
  });

  if (!job) {
    throw new MasterExportServiceError("not_found", "Export job was not found.", 404, {
      export_public_id: exportPublicId
    });
  }

  if (job.status !== "completed" || !job.storage_key || !job.file_name) {
    throw new MasterExportServiceError(
      "export_not_available",
      "Export file is not available for download.",
      409,
      { status: job.status }
    );
  }

  return {
    file_name: job.file_name,
    bytes: await readExportFile(job.storage_key)
  };
}
