import { createHash } from "node:crypto";
import { stringify } from "csv-stringify/sync";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildEngagementProcessFeatureRows } from "@/lib/services/teacher-review/engagement-process-features";
import { buildTurnResponseLatencyRows } from "@/lib/services/teacher-review/turn-response-latencies";
import { asArray, asRecord } from "@/lib/services/teacher-review/serializers";
import { ContentServiceError } from "@/lib/services/content/errors";
import { createStoreOnlyZip } from "@/lib/services/teacher-research-export/zip";
import {
  buildExportSourceIdentity,
  EXPORT_SOURCE_COLUMNS,
  sourceIdentityRow,
  type ExportSourceIdentity
} from "@/lib/services/teacher-research-export/source-identity";

export const TEACHER_DETAILED_CSV_EXPORT_VERSION = "teacher-detailed-csv-export-v1" as const;

type CsvPrimitive = string | number | boolean | null;
type CsvRow = Record<string, CsvPrimitive>;

const analysisColumns = [
  ...EXPORT_SOURCE_COLUMNS,
  "student_id",
  "student_public_id",
  "assessment_public_id",
  "assessment_snapshot_public_id",
  "session_public_id",
  "attempt_number",
  "item_public_id",
  "item_snapshot_public_id",
  "item_version",
  "media_snapshot_public_ids",
  "context_schema_version",
  "assessment_context_hash",
  "row_type",
  "assessment_title",
  "folder_week_module",
  "assessment_status",
  "session_status",
  "current_phase",
  "started_at",
  "last_activity_at",
  "completed_at",
  "release_at",
  "close_at",
  "item_order",
  "selected_option",
  "selected_answer_initial",
  "selected_answer_final",
  "answer_changed",
  "reasoning_text",
  "reasoning_text_initial",
  "reasoning_text_final",
  "confidence_rating",
  "confidence_initial",
  "confidence_final",
  "no_tempting_option",
  "tempting_option",
  "tempting_option_reason",
  "skipped_item",
  "skipped_reasoning",
  "skipped_confidence",
  "revision_count",
  "response_finalized",
  "item_role",
  "cognitive_demand",
  "difficulty",
  "knowledge_component",
  "misconception_cluster",
  "item_started_at",
  "answer_selected_at",
  "reasoning_started_at",
  "reasoning_submitted_at",
  "confidence_selected_at",
  "tempting_option_submitted_at",
  "item_completed_at",
  "response_time_answer_ms",
  "response_time_reasoning_ms",
  "response_time_confidence_ms",
  "total_item_time_ms",
  "item_presented_at",
  "first_student_action_at",
  "time_to_first_action_ms",
  "first_option_selected_at",
  "time_to_first_option_selection_ms",
  "reasoning_prompted_at",
  "reasoning_prompt_to_submission_ms",
  "reasoning_active_time_ms",
  "confidence_prompted_at",
  "confidence_prompt_to_selection_ms",
  "last_student_action_at",
  "item_submitted_at",
  "last_action_to_submission_ms",
  "item_response_time_ms",
  "page_switch_count",
  "page_hidden_count",
  "total_page_hidden_ms",
  "long_pause_count",
  "total_long_pause_ms",
  "maximum_long_pause_ms",
  "inactivity_count",
  "total_idle_time_ms",
  "active_interaction_time_ms",
  "idle_ratio",
  "typing_activity_event_count",
  "typing_active_time_ms",
  "typing_pause_count",
  "option_selection_count",
  "option_revision_count",
  "reasoning_submission_count",
  "reasoning_revision_count",
  "confidence_selection_count",
  "confidence_revision_count",
  "navigation_event_count",
  "package_review_opened_count",
  "package_submitted_count",
  "initial_free_text_student_message_count",
  "procedural_clarification_count",
  "content_question_count",
  "emotional_response_count",
  "invalid_help_request_count",
  "insufficient_knowledge_count",
  "response_quality_check_count",
  "response_quality_rejection_count",
  "validation_failure_count",
  "response_collection_agent_call_count",
  "response_collection_fallback_count",
  "reasoning_extraction_count",
  "reasoning_extraction_failure_count",
  "agent_call_count",
  "agent_retry_count",
  "agent_failed_call_count",
  "agent_validation_failure_count",
  "input_token_count",
  "output_token_count",
  "total_token_count",
  "followup_turn_count",
  "student_followup_turn_count",
  "agent_followup_turn_count",
  "activity_attempt_count",
  "post_activity_evidence_count",
  "diagnostic_snapshot_count",
  "move_on_count",
  "alternative_activity_request_count",
  "unsupported_correct_response",
  "correctness_support_level",
  "estimated_guessing_risk",
  "answer_selection_evidence_weight",
  "uncertainty_marker_present",
  "response_quality_summary",
  "latest_student_safe_status",
  "latest_diagnostic_purpose",
  "evidence_sufficiency",
  "interpretation_limitations",
  "process_instrumentation_available",
  "process_feature_limitations"
] as const;

const processEventColumns = [
  ...EXPORT_SOURCE_COLUMNS,
  "session_public_id",
  "student_id",
  "assessment_public_id",
  "assessment_snapshot_public_id",
  "item_public_id",
  "item_snapshot_public_id",
  "event_sequence_index",
  "event_type",
  "event_category",
  "event_source",
  "occurred_at",
  "created_at",
  "pause_duration_ms",
  "visibility_duration_ms",
  "item_order",
  "phase",
  "payload_source",
  "payload_action_status",
  "payload_prompt_type",
  "payload_text_length",
  "payload_selected_option",
  "payload_confidence_rating",
  "payload_no_tempting_option",
  "limitations"
] as const;

const latencyColumns = [
  ...EXPORT_SOURCE_COLUMNS,
  "session_public_id",
  "student_id",
  "assessment_public_id",
  "assessment_snapshot_public_id",
  "item_public_id",
  "item_snapshot_public_id",
  "prompt_turn_index",
  "prompt_actor",
  "prompt_phase",
  "prompt_type",
  "prompt_shown_at",
  "next_student_turn_index",
  "next_student_event_type",
  "next_student_response_at",
  "response_latency_ms",
  "response_latency_seconds",
  "latency_source",
  "latency_scope",
  "student_response_text_present",
  "limitations"
] as const;

const conversationColumns = [
  ...EXPORT_SOURCE_COLUMNS,
  "session_public_id",
  "student_id",
  "assessment_public_id",
  "assessment_snapshot_public_id",
  "item_public_id",
  "turn_index",
  "actor_type",
  "agent_name",
  "phase",
  "context_label",
  "created_at",
  "message_text",
  "next_student_response_or_action_latency_ms",
  "limitations"
] as const;

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /authorization\s*:/i,
  /bearer\s+[A-Za-z0-9._-]{10,}/i,
  /password_hash/i,
  /access_code_hash/i,
  /database_url/i,
  /session_secret/i
];

const PROTECTED_DEFAULT_PATTERNS = [
  /\bcorrect_option\b/i,
  /\banswer_key\b/i,
  /\bcorrectness\b/i,
  /\bdistractor_rationales\b/i,
  /\bpossible_misconception_indicators\b/i,
  /\braw_output\b/i,
  /\binput_payload\b/i,
  /\boutput_payload\b/i,
  /\bpayload\s*:/i
];

const detailedSessionSelect = {
  id: true,
  session_public_id: true,
  attempt_number: true,
  status: true,
  current_phase: true,
  started_at: true,
  last_activity_at: true,
  completed_at: true,
  created_at: true,
  user: {
    select: {
      user_id: true,
      display_name: true,
      role: true,
      account_status: true,
      created_by_teacher_user_id: true
    }
  },
  assessment: {
    select: {
      assessment_public_id: true,
      title: true,
      status: true,
      folder_label: true,
      release_at: true,
      close_at: true,
      created_by_user_db_id: true
    }
  },
  concept_unit_sessions: {
    orderBy: [{ concept_unit: { order_index: "asc" } }, { created_at: "asc" }],
    include: {
      concept_unit: {
        select: {
          concept_unit_public_id: true,
          title: true,
          order_index: true,
          version: true
        }
      },
      item_responses: {
        orderBy: [{ item: { item_order: "asc" } }, { created_at: "asc" }],
        include: {
          item: {
            select: {
              item_public_id: true,
              item_order: true,
              version: true,
              media_assets: {
                where: { active: true },
                orderBy: [{ order_index: "asc" }, { created_at: "asc" }],
                select: {
                  media_public_id: true,
                  media_version: true
                }
              }
            }
          }
        }
      },
      response_packages: {
        orderBy: [{ created_at: "asc" }],
        select: {
          package_type: true,
          payload: true,
          created_at: true
        }
      },
      student_profiles: {
        orderBy: { created_at: "desc" },
        take: 1,
        select: {
          integrated_diagnostic_profile: true,
          evidence_sufficiency: true,
          recommended_next_evidence: true,
          item_level_evidence: true,
          created_at: true
        }
      },
      formative_decisions: {
        orderBy: { created_at: "desc" },
        take: 1,
        select: {
          formative_value: true,
          created_at: true
        }
      }
    }
  },
  conversation_turns: {
    orderBy: [{ created_at: "asc" }],
    include: {
      item: { select: { item_public_id: true, item_order: true } },
      concept_unit_session: {
        select: {
          concept_unit: {
            select: { concept_unit_public_id: true, title: true }
          }
        }
      }
    }
  },
  process_events: {
    orderBy: [{ occurred_at: "asc" }, { created_at: "asc" }],
    include: {
      item: { select: { item_public_id: true, item_order: true } },
      concept_unit_session: {
        select: {
          concept_unit: {
            select: { concept_unit_public_id: true, title: true }
          }
        }
      }
    }
  },
  agent_calls: {
    orderBy: [{ created_at: "asc" }],
    select: {
      agent_name: true,
      call_status: true,
      output_validated: true,
      retry_count: true,
      input_tokens: true,
      output_tokens: true,
      total_tokens: true
    }
  }
} satisfies Prisma.AssessmentSessionSelect;

type DetailedSession = Prisma.AssessmentSessionGetPayload<{ select: typeof detailedSessionSelect }>;

function iso(value?: Date | null) {
  return value ? value.toISOString() : null;
}

function csvSafe(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function csv(columns: readonly string[], rows: CsvRow[]) {
  return stringify(
    rows.map((row) => Object.fromEntries(columns.map((column) => [column, csvSafe(row[column])]))),
    { header: true, columns: [...columns] }
  );
}

function ms(value?: Date | null) {
  return value ? value.getTime() : null;
}

function eventMs(event: Pick<DetailedSession["process_events"][number], "occurred_at" | "created_at">) {
  return ms(event.occurred_at) ?? ms(event.created_at);
}

function optionalEventMs(
  event?: Pick<DetailedSession["process_events"][number], "occurred_at" | "created_at"> | null
) {
  return event ? eventMs(event) : null;
}

function diff(start: number | null, end: number | null) {
  if (start === null || end === null) return null;
  return Math.max(0, end - start);
}

function sha(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function authorizedSessionOr(teacherUserDbId: string): Prisma.AssessmentSessionWhereInput[] {
  return [
    { assessment: { created_by_user_db_id: teacherUserDbId } },
    { user: { created_by_teacher_user_id: teacherUserDbId } }
  ];
}

function detailedSessionWhere(input: {
  teacher_user_db_id: string;
  assessment_public_id?: string;
  student_user_id?: string;
  session_public_id?: string;
}): Prisma.AssessmentSessionWhereInput {
  return {
    session_public_id: input.session_public_id,
    assessment: { assessment_public_id: input.assessment_public_id },
    user: {
      role: "student",
      account_status: "active",
      user_id: input.student_user_id
    },
    OR: authorizedSessionOr(input.teacher_user_db_id)
  };
}

function latestInitialPackage(session: DetailedSession) {
  return session.concept_unit_sessions
    .flatMap((conceptUnitSession) => conceptUnitSession.response_packages)
    .filter((responsePackage) => responsePackage.package_type === "initial_concept_unit_response_package")
    .sort((left, right) => right.created_at.getTime() - left.created_at.getTime())[0] ?? null;
}

function packageItemEvidence(session: DetailedSession) {
  const latest = latestInitialPackage(session);
  const itemResponses = asArray(asRecord(latest?.payload).item_responses).map(asRecord);
  return new Map(itemResponses.map((entry) => [String(entry.item_public_id ?? ""), entry]));
}

function payloadString(payload: unknown, keys: string[]) {
  const record = asRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function payloadNumber(payload: unknown, keys: string[]) {
  const record = asRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function countEvents(events: DetailedSession["process_events"], types: string[]) {
  const typeSet = new Set(types);
  return events.filter((event) => typeSet.has(event.event_type)).length;
}

function sumDurations(events: DetailedSession["process_events"], field: "pause_duration_ms" | "visibility_duration_ms") {
  const values = events
    .map((event) => event[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function maxDuration(events: DetailedSession["process_events"], field: "pause_duration_ms" | "visibility_duration_ms") {
  const values = events
    .map((event) => event[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

function firstEvent(events: DetailedSession["process_events"], types: string[]) {
  const typeSet = new Set(types);
  return events.find((event) => typeSet.has(event.event_type)) ?? null;
}

function lastEvent(events: DetailedSession["process_events"], types: string[]) {
  const typeSet = new Set(types);
  return [...events].reverse().find((event) => typeSet.has(event.event_type)) ?? null;
}

function itemSnapshotRecord(response: DetailedSession["concept_unit_sessions"][number]["item_responses"][number]) {
  return asRecord(response.item_snapshot);
}

function mediaPublicIds(response: DetailedSession["concept_unit_sessions"][number]["item_responses"][number]) {
  const snapshotMedia = asArray(itemSnapshotRecord(response).media_assets).map(asRecord);
  const fromSnapshot = snapshotMedia
    .map((entry) => {
      const id = typeof entry.media_public_id === "string" ? entry.media_public_id : null;
      const version = typeof entry.media_version === "number" ? entry.media_version : null;
      return id ? `${id}${version ? `:v${version}` : ""}` : null;
    })
    .filter((value): value is string => Boolean(value));
  if (fromSnapshot.length > 0) return fromSnapshot.join(";");
  return response.item.media_assets
    .map((asset) => `${asset.media_public_id}:v${asset.media_version}`)
    .join(";");
}

function safeStatus(profile: DetailedSession["concept_unit_sessions"][number]["student_profiles"][number] | undefined) {
  if (!profile) return "";
  switch (profile.integrated_diagnostic_profile) {
    case "robust_understanding_ready_for_transfer":
    case "underconfident_but_reasoning_supported":
      return "Mostly understood";
    case "insufficient_evidence_for_formative_decision":
    case "low_engagement_limits_interpretability":
      return "Needs more work";
    default:
      return "Still developing";
  }
}

async function supplementalCounts(sessionIds: string[]) {
  const [activityAttempts, evidenceRecords, snapshots] = await Promise.all([
    prisma.activityRuntimeAttempt.groupBy({
      by: ["session_public_id"],
      where: { session_public_id: { in: sessionIds } },
      _count: { _all: true }
    }),
    prisma.activityMisconceptionEvidenceRecord.groupBy({
      by: ["session_public_id"],
      where: { session_public_id: { in: sessionIds } },
      _count: { _all: true }
    }),
    prisma.postActivityDiagnosticSnapshot.groupBy({
      by: ["session_public_id"],
      where: { session_public_id: { in: sessionIds } },
      _count: { _all: true }
    })
  ]);
  return {
    activity: new Map(activityAttempts.map((entry) => [entry.session_public_id, entry._count._all])),
    evidence: new Map(evidenceRecords.map((entry) => [entry.session_public_id, entry._count._all])),
    snapshots: new Map(snapshots.map((entry) => [entry.session_public_id, entry._count._all]))
  };
}

function buildEngagementRowsForSession(session: DetailedSession) {
  const itemResponses = session.concept_unit_sessions.flatMap((conceptUnitSession) =>
    conceptUnitSession.item_responses.map((response) => ({
      session_public_id: session.session_public_id,
      student_user_id: session.user.user_id,
      assessment_public_id: session.assessment.assessment_public_id,
      concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id,
      item_public_id: response.item.item_public_id,
      item_order: response.item.item_order,
      item_started_at: response.item_started_at,
      item_submitted_at: response.item_submitted_at,
      item_response_time_ms: response.item_response_time_ms,
      revision_count: response.revision_count
    }))
  );
  return buildEngagementProcessFeatureRows({
    itemResponses,
    processEvents: session.process_events.map((event) => ({
      session_public_id: session.session_public_id,
      concept_unit_public_id:
        event.concept_unit_session?.concept_unit.concept_unit_public_id ?? null,
      item_public_id: event.item?.item_public_id ?? null,
      item_order: event.item?.item_order ?? null,
      event_type: event.event_type,
      event_category: event.event_category,
      event_source: event.event_source,
      visibility_duration_ms: event.visibility_duration_ms,
      pause_duration_ms: event.pause_duration_ms,
      payload: event.payload,
      occurred_at: event.occurred_at,
      created_at: event.created_at
    }))
  });
}

function sourcePrefixed(source: ExportSourceIdentity, row: CsvRow): CsvRow {
  return { ...sourceIdentityRow(source), ...row };
}

function analysisRows(input: {
  source: ExportSourceIdentity;
  sessions: DetailedSession[];
  supplemental: Awaited<ReturnType<typeof supplementalCounts>>;
}) {
  const rows: CsvRow[] = [];
  for (const session of input.sessions) {
    const packageEvidence = packageItemEvidence(session);
    const engagementRows = buildEngagementRowsForSession(session);
    const engagementByItem = new Map(engagementRows.map((row) => [row.item_public_id ?? "", row]));
    const agentFailedCount = session.agent_calls.filter((call) => ["failed", "invalid_output"].includes(call.call_status)).length;
    const agentValidationFailureCount = session.agent_calls.filter((call) => call.output_validated === false).length;
    const latestProfile = session.concept_unit_sessions.flatMap((entry) => entry.student_profiles)[0];
    const latestDecision = session.concept_unit_sessions.flatMap((entry) => entry.formative_decisions)[0];
    const allResponses = session.concept_unit_sessions.flatMap((entry) => entry.item_responses);
    const commonSession = {
      student_id: session.user.user_id,
      student_public_id: session.user.user_id,
      assessment_public_id: session.assessment.assessment_public_id,
      assessment_snapshot_public_id: `${session.assessment.assessment_public_id}:session:${session.session_public_id}`,
      session_public_id: session.session_public_id,
      attempt_number: session.attempt_number,
      context_schema_version: "assessment-session-context-v1",
      assessment_context_hash: sha({
        assessment_public_id: session.assessment.assessment_public_id,
        assessment_title: session.assessment.title,
        assessment_status: session.assessment.status,
        session_public_id: session.session_public_id,
        item_snapshots: allResponses.map((response) => response.item_snapshot)
      }),
      assessment_title: session.assessment.title,
      folder_week_module: session.assessment.folder_label ?? "",
      assessment_status: session.assessment.status,
      session_status: session.status,
      current_phase: session.current_phase,
      started_at: iso(session.started_at),
      last_activity_at: iso(session.last_activity_at),
      completed_at: iso(session.completed_at),
      release_at: iso(session.assessment.release_at),
      close_at: iso(session.assessment.close_at),
      agent_call_count: session.agent_calls.length,
      agent_retry_count: session.agent_calls.reduce((total, call) => total + call.retry_count, 0),
      agent_failed_call_count: agentFailedCount,
      agent_validation_failure_count: agentValidationFailureCount,
      input_token_count: session.agent_calls.reduce((total, call) => total + (call.input_tokens ?? 0), 0),
      output_token_count: session.agent_calls.reduce((total, call) => total + (call.output_tokens ?? 0), 0),
      total_token_count: session.agent_calls.reduce((total, call) => total + (call.total_tokens ?? 0), 0),
      followup_turn_count: session.conversation_turns.filter((turn) => String(turn.phase).includes("followup")).length,
      student_followup_turn_count: session.conversation_turns.filter((turn) => turn.actor_type === "student" && String(turn.phase).includes("followup")).length,
      agent_followup_turn_count: session.conversation_turns.filter((turn) => turn.actor_type !== "student" && String(turn.phase).includes("followup")).length,
      activity_attempt_count: input.supplemental.activity.get(session.session_public_id) ?? 0,
      post_activity_evidence_count: input.supplemental.evidence.get(session.session_public_id) ?? 0,
      diagnostic_snapshot_count: input.supplemental.snapshots.get(session.session_public_id) ?? 0,
      latest_student_safe_status: safeStatus(latestProfile),
      latest_diagnostic_purpose: latestDecision?.formative_value ?? "",
      evidence_sufficiency: latestProfile?.evidence_sufficiency ?? "",
      interpretation_limitations: "process_indicators_are_contextual_not_misconduct_or_ability_labels"
    };

    if (allResponses.length === 0) {
      rows.push(sourcePrefixed(input.source, {
        ...commonSession,
        row_type: "session_without_item_response",
        process_instrumentation_available: session.process_events.length > 0,
        process_feature_limitations: "session_without_item_response"
      }));
      continue;
    }

    for (const conceptUnitSession of session.concept_unit_sessions) {
      for (const response of conceptUnitSession.item_responses) {
        const itemEvents = session.process_events.filter((event) => event.item?.item_public_id === response.item.item_public_id);
        const feature = engagementByItem.get(response.item.item_public_id);
        const itemEvidence = packageEvidence.get(response.item.item_public_id) ?? {};
        const firstAction = firstEvent(itemEvents, [
          "option_clicked",
          "option_selected",
          "reasoning_started",
          "reasoning_submitted",
          "confidence_clicked",
          "confidence_selected",
          "tempting_option_submitted"
        ]);
        const firstOption = firstEvent(itemEvents, ["option_clicked", "option_selected"]);
        const reasoningPrompt = firstEvent(itemEvents, ["agent_message_shown"]);
        const reasoningSubmitted = firstEvent(itemEvents, ["reasoning_submitted"]);
        const confidencePrompt = firstEvent(itemEvents, ["agent_message_shown"]);
        const confidenceSelected = firstEvent(itemEvents, ["confidence_clicked", "confidence_selected"]);
        const temptingSubmitted = firstEvent(itemEvents, ["tempting_option_submitted"]);
        const itemCompleted = lastEvent(itemEvents, ["item_completed", "item_submitted"]);
        const lastAction = lastEvent(itemEvents, [
          "option_clicked",
          "option_selected",
          "reasoning_submitted",
          "confidence_clicked",
          "confidence_selected",
          "tempting_option_submitted",
          "tempting_option_reason_submitted"
        ]);
        const totalHiddenMs = sumDurations(
          itemEvents.filter((event) => /page.*hidden|window_blur/i.test(event.event_type)),
          "visibility_duration_ms"
        );
        const totalLongPauseMs = sumDurations(
          itemEvents.filter((event) => event.event_type === "long_pause"),
          "pause_duration_ms"
        );
        const totalIdleMs = sumDurations(
          itemEvents.filter((event) => event.event_type === "long_pause" || event.event_type === "inactivity_detected"),
          "pause_duration_ms"
        );
        rows.push(sourcePrefixed(input.source, {
          ...commonSession,
          item_public_id: response.item.item_public_id,
          item_snapshot_public_id: `${response.item.item_public_id}:v${response.item_version_snapshot}`,
          item_version: response.item_version_snapshot,
          media_snapshot_public_ids: mediaPublicIds(response),
          row_type: "item_response",
          item_order: response.item.item_order,
          selected_option: response.selected_option ?? "",
          selected_answer_initial:
            payloadString(firstOption?.payload, ["selected_option", "option", "answer"]) ?? response.selected_option ?? "",
          selected_answer_final: response.selected_option ?? "",
          answer_changed: response.revision_count > 0 || countEvents(itemEvents, ["answer_changed"]) > 0,
          reasoning_text: response.reasoning_text ?? "",
          reasoning_text_initial: response.reasoning_text ?? "",
          reasoning_text_final: response.reasoning_text ?? "",
          confidence_rating: response.confidence_rating ?? "",
          confidence_initial: response.confidence_rating ?? "",
          confidence_final: response.confidence_rating ?? "",
          no_tempting_option: itemEvidence.no_tempting_option === true,
          tempting_option: typeof itemEvidence.tempting_option === "string" ? itemEvidence.tempting_option : "",
          tempting_option_reason: typeof itemEvidence.tempting_option_reason === "string" ? itemEvidence.tempting_option_reason : "",
          skipped_item: response.skipped_item,
          skipped_reasoning: response.skipped_reasoning,
          skipped_confidence: response.skipped_confidence,
          revision_count: response.revision_count,
          response_finalized: Boolean(response.item_submitted_at),
          item_role: typeof itemEvidence.item_role === "string" ? itemEvidence.item_role : "",
          cognitive_demand: typeof itemEvidence.cognitive_demand === "string" ? itemEvidence.cognitive_demand : "",
          difficulty: typeof itemEvidence.difficulty === "string" ? itemEvidence.difficulty : "",
          knowledge_component: typeof itemEvidence.knowledge_component === "string" ? itemEvidence.knowledge_component : "",
          misconception_cluster: typeof itemEvidence.misconception_cluster === "string" ? itemEvidence.misconception_cluster : "",
          item_started_at: iso(response.item_started_at),
          answer_selected_at: iso(firstOption?.occurred_at ?? null),
          reasoning_started_at: iso(firstEvent(itemEvents, ["reasoning_started"])?.occurred_at ?? null),
          reasoning_submitted_at: iso(reasoningSubmitted?.occurred_at ?? null),
          confidence_selected_at: iso(confidenceSelected?.occurred_at ?? null),
          tempting_option_submitted_at: iso(temptingSubmitted?.occurred_at ?? null),
          item_completed_at: iso(itemCompleted?.occurred_at ?? response.item_submitted_at),
          response_time_answer_ms: diff(ms(response.item_started_at), optionalEventMs(firstOption)),
          response_time_reasoning_ms: diff(optionalEventMs(reasoningPrompt), optionalEventMs(reasoningSubmitted)),
          response_time_confidence_ms: diff(optionalEventMs(confidencePrompt), optionalEventMs(confidenceSelected)),
          total_item_time_ms: response.item_response_time_ms,
          item_presented_at: iso(firstEvent(itemEvents, ["item_presented"])?.occurred_at ?? response.item_started_at),
          first_student_action_at: iso(firstAction?.occurred_at ?? null),
          time_to_first_action_ms: feature?.time_to_first_action_ms ?? null,
          first_option_selected_at: iso(firstOption?.occurred_at ?? null),
          time_to_first_option_selection_ms: diff(ms(response.item_started_at), optionalEventMs(firstOption)),
          reasoning_prompted_at: iso(reasoningPrompt?.occurred_at ?? null),
          reasoning_prompt_to_submission_ms: diff(optionalEventMs(reasoningPrompt), optionalEventMs(reasoningSubmitted)),
          reasoning_active_time_ms: feature?.reasoning_input_elapsed_time_ms ?? null,
          confidence_prompted_at: iso(confidencePrompt?.occurred_at ?? null),
          confidence_prompt_to_selection_ms: feature?.confidence_selection_latency_ms ?? null,
          last_student_action_at: iso(lastAction?.occurred_at ?? null),
          item_submitted_at: iso(response.item_submitted_at),
          last_action_to_submission_ms: feature?.last_action_to_submission_ms ?? null,
          item_response_time_ms: response.item_response_time_ms,
          page_switch_count: countEvents(itemEvents, ["page_hidden", "page_visible", "page_visibility_hidden", "page_visibility_visible"]),
          page_hidden_count: countEvents(itemEvents, ["page_hidden", "page_visibility_hidden", "window_blur"]),
          total_page_hidden_ms: totalHiddenMs,
          long_pause_count: countEvents(itemEvents, ["long_pause"]),
          total_long_pause_ms: totalLongPauseMs,
          maximum_long_pause_ms: maxDuration(itemEvents.filter((event) => event.event_type === "long_pause"), "pause_duration_ms"),
          inactivity_count: countEvents(itemEvents, ["inactivity_detected"]),
          total_idle_time_ms: totalIdleMs,
          active_interaction_time_ms: feature?.active_interaction_time_ms ?? null,
          idle_ratio: feature?.idle_ratio ?? null,
          typing_activity_event_count: countEvents(itemEvents, ["typing_activity_summary"]),
          typing_active_time_ms: feature?.active_typing_time_ms ?? null,
          typing_pause_count: countEvents(itemEvents, ["typing_activity_summary"]),
          option_selection_count: countEvents(itemEvents, ["option_clicked", "option_selected"]),
          option_revision_count: feature?.option_revision_count ?? countEvents(itemEvents, ["answer_changed"]),
          reasoning_submission_count: countEvents(itemEvents, ["reasoning_submitted"]),
          reasoning_revision_count: feature?.reasoning_revision_count ?? countEvents(itemEvents, ["reasoning_revised", "reasoning_edited"]),
          confidence_selection_count: countEvents(itemEvents, ["confidence_clicked", "confidence_selected"]),
          confidence_revision_count: feature?.confidence_revision_count ?? countEvents(itemEvents, ["confidence_changed"]),
          navigation_event_count: countEvents(itemEvents, ["navigation_event"]),
          package_review_opened_count: countEvents(session.process_events, ["package_review_opened"]),
          package_submitted_count: countEvents(session.process_events, ["package_submitted"]),
          initial_free_text_student_message_count: countEvents(itemEvents, ["initial_free_text_message"]),
          procedural_clarification_count: countEvents(itemEvents, ["procedural_clarification_request"]),
          content_question_count: countEvents(itemEvents, ["content_question_deferred"]),
          emotional_response_count: countEvents(itemEvents, ["emotional_or_frustration_response"]),
          invalid_help_request_count: countEvents(itemEvents, ["invalid_help_request"]),
          insufficient_knowledge_count: countEvents(itemEvents, ["insufficient_knowledge_marked", "idk_selected"]),
          response_quality_check_count: countEvents(itemEvents, ["response_quality_checked"]),
          response_quality_rejection_count: countEvents(itemEvents, ["response_quality_rejected"]),
          validation_failure_count: countEvents(itemEvents, ["schema_validation_failed"]),
          response_collection_agent_call_count: countEvents(itemEvents, ["response_collection_agent_invoked"]),
          response_collection_fallback_count: countEvents(itemEvents, ["response_collection_fallback_used"]),
          reasoning_extraction_count: countEvents(itemEvents, ["response_collection_reasoning_extracted"]),
          reasoning_extraction_failure_count: countEvents(itemEvents, ["response_collection_reasoning_extraction_failed"]),
          move_on_count: countEvents(session.process_events, ["move_next_requested", "move_on_requested"]),
          alternative_activity_request_count: countEvents(session.process_events, ["choose_another_activity", "activity_choice_submitted"]),
          unsupported_correct_response: itemEvidence.unsupported_correct_response === true,
          correctness_support_level: typeof itemEvidence.correctness_support_level === "string" ? itemEvidence.correctness_support_level : "",
          estimated_guessing_risk: typeof itemEvidence.estimated_guessing_risk === "string" ? itemEvidence.estimated_guessing_risk : "",
          answer_selection_evidence_weight: typeof itemEvidence.answer_selection_evidence_weight === "string" ? itemEvidence.answer_selection_evidence_weight : "",
          uncertainty_marker_present: itemEvidence.uncertainty_marker_present === true,
          response_quality_summary: typeof itemEvidence.response_quality_summary === "string" ? itemEvidence.response_quality_summary : "",
          process_instrumentation_available: itemEvents.length > 0,
          process_feature_limitations: feature?.limitations.join(";") ?? "process_feature_unavailable"
        }));
      }
    }
  }
  return rows;
}

function processEventRows(source: ExportSourceIdentity, sessions: DetailedSession[]) {
  return sessions.flatMap((session) =>
    session.process_events.map((event, index) => {
      const payload = asRecord(event.payload);
      return sourcePrefixed(source, {
        session_public_id: session.session_public_id,
        student_id: session.user.user_id,
        assessment_public_id: session.assessment.assessment_public_id,
        assessment_snapshot_public_id: `${session.assessment.assessment_public_id}:session:${session.session_public_id}`,
        item_public_id: event.item?.item_public_id ?? "",
        item_snapshot_public_id: event.item ? `${event.item.item_public_id}:event` : "",
        event_sequence_index: index + 1,
        event_type: event.event_type,
        event_category: event.event_category,
        event_source: event.event_source,
        occurred_at: iso(event.occurred_at),
        created_at: iso(event.created_at),
        pause_duration_ms: event.pause_duration_ms,
        visibility_duration_ms: event.visibility_duration_ms,
        item_order: event.item?.item_order ?? null,
        phase: typeof payload.phase === "string" ? payload.phase : "",
        payload_source: payloadString(payload, ["source"]),
        payload_action_status: payloadString(payload, ["action_status"]),
        payload_prompt_type: payloadString(payload, ["prompt_type", "message_type"]),
        payload_text_length: payloadNumber(payload, ["text_length", "message_length"]),
        payload_selected_option: payloadString(payload, ["selected_option", "option"]),
        payload_confidence_rating: payloadString(payload, ["confidence_rating", "confidence"]),
        payload_no_tempting_option: payload.no_tempting_option === true,
        limitations: "raw_payload_excluded"
      });
    })
  );
}

function latencyRows(source: ExportSourceIdentity, sessions: DetailedSession[]) {
  return sessions.flatMap((session) =>
    buildTurnResponseLatencyRows({
      turns: session.conversation_turns.map((turn, index) => ({
        session_public_id: session.session_public_id,
        student_user_id: session.user.user_id,
        assessment_public_id: session.assessment.assessment_public_id,
        turn_index: index + 1,
        actor_type: turn.actor_type,
        phase: turn.phase,
        agent_name: turn.agent_name,
        message_text: turn.message_text,
        structured_payload: turn.structured_payload,
        created_at: turn.created_at,
        concept_unit_public_id:
          turn.concept_unit_session?.concept_unit.concept_unit_public_id ?? null,
        item_public_id: turn.item?.item_public_id ?? null,
        item_order: turn.item?.item_order ?? null
      })),
      processEvents: session.process_events.map((event) => ({
        session_public_id: session.session_public_id,
        concept_unit_public_id:
          event.concept_unit_session?.concept_unit.concept_unit_public_id ?? null,
        item_public_id: event.item?.item_public_id ?? null,
        item_order: event.item?.item_order ?? null,
        event_type: event.event_type,
        event_category: event.event_category,
        event_source: event.event_source,
        occurred_at: event.occurred_at,
        created_at: event.created_at
      }))
    }).map((row) => sourcePrefixed(source, {
      ...row,
      student_id: row.student_user_id,
      assessment_snapshot_public_id: `${session.assessment.assessment_public_id}:session:${session.session_public_id}`,
      item_snapshot_public_id: row.item_public_id ? `${row.item_public_id}:latency` : "",
      limitations: row.limitations.join(";")
    }))
  );
}

function conversationRows(source: ExportSourceIdentity, sessions: DetailedSession[]) {
  return sessions.flatMap((session) => {
    const latencyByPrompt = new Map(
      latencyRows(source, [session]).map((row) => [String(row.prompt_turn_index), row.response_latency_ms])
    );
    return session.conversation_turns.map((turn, index) =>
      sourcePrefixed(source, {
        session_public_id: session.session_public_id,
        student_id: session.user.user_id,
        assessment_public_id: session.assessment.assessment_public_id,
        assessment_snapshot_public_id: `${session.assessment.assessment_public_id}:session:${session.session_public_id}`,
        item_public_id: turn.item?.item_public_id ?? "",
        turn_index: index + 1,
        actor_type: turn.actor_type,
        agent_name: turn.agent_name ?? "",
        phase: turn.phase,
        context_label:
          turn.item?.item_public_id ??
          turn.concept_unit_session?.concept_unit.concept_unit_public_id ??
          "session",
        created_at: iso(turn.created_at),
        message_text: turn.message_text ?? "",
        next_student_response_or_action_latency_ms: latencyByPrompt.get(String(index + 1)) ?? null,
        limitations: "structured_payload_excluded"
      })
    );
  });
}

function assertDetailedCsvSafety(files: Array<{ path: string; data: string }>) {
  const serialized = files.map((file) => file.data).join("\n");
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) {
      throw new Error("Detailed CSV export safety scan blocked secret-like content.");
    }
  }
  for (const file of files) {
    if (file.path === "analysis_rows.csv" || file.path === "conversation_turns.csv") {
      continue;
    }
    for (const pattern of PROTECTED_DEFAULT_PATTERNS) {
      if (pattern.test(file.data)) {
        throw new Error(`Detailed CSV export safety scan blocked protected data in ${file.path}.`);
      }
    }
  }
}

async function loadDetailedSessions(input: {
  teacher_user_db_id: string;
  assessment_public_id?: string;
  student_user_id?: string;
  session_public_id?: string;
}) {
  return prisma.assessmentSession.findMany({
    where: detailedSessionWhere(input),
    orderBy: [
      { assessment: { title: "asc" } },
      { user: { user_id: "asc" } },
      { attempt_number: "asc" },
      { created_at: "asc" }
    ],
    select: detailedSessionSelect
  });
}

export async function buildTeacherDetailedCsvBundle(input: {
  teacher_user_db_id: string;
  scope: "all_authorized" | "selected_assessment" | "selected_student" | "selected_session";
  assessment_public_id?: string;
  student_user_id?: string;
  session_public_id?: string;
}) {
  const sessions = await loadDetailedSessions(input);
  if (sessions.length === 0) {
    throw new ContentServiceError(
      "no_session_data",
      input.scope === "selected_assessment"
        ? "No student sessions are available for this assessment."
        : input.scope === "selected_student"
          ? "No student sessions are available for this student."
          : "No student sessions are available for this export scope.",
      409
    );
  }
  const source = buildExportSourceIdentity({
    export_schema_version: TEACHER_DETAILED_CSV_EXPORT_VERSION,
    export_scope: input.scope,
    selected_assessment_public_id: input.assessment_public_id,
    selected_student_id: input.student_user_id,
    selected_session_public_id: input.session_public_id
  });
  const supplemental = await supplementalCounts(sessions.map((session) => session.session_public_id));
  const files = [
    {
      path: "analysis_rows.csv",
      data: csv(analysisColumns, analysisRows({ source, sessions, supplemental }))
    },
    {
      path: "process_events.csv",
      data: csv(processEventColumns, processEventRows(source, sessions))
    },
    {
      path: "turn_response_latencies.csv",
      data: csv(latencyColumns, latencyRows(source, sessions))
    },
    {
      path: "conversation_turns.csv",
      data: csv(conversationColumns, conversationRows(source, sessions))
    }
  ];
  assertDetailedCsvSafety(files);
  const filename =
    input.scope === "selected_assessment" && input.assessment_public_id
      ? `assessment_${input.assessment_public_id}_detailed_csv.zip`
      : input.scope === "selected_student" && input.student_user_id
        ? `student_${input.student_user_id}_detailed_csv.zip`
        : input.scope === "selected_session" && input.session_public_id
          ? `session_${input.session_public_id}_detailed_csv.zip`
          : "all_authorized_research_csv.zip";

  return {
    filename,
    content_type: "application/zip",
    buffer: createStoreOnlyZip(files),
    files,
    source,
    no_live_provider_call_made: true
  };
}
