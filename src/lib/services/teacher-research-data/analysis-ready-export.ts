import { createHash } from "node:crypto";
import { stringify } from "csv-stringify/sync";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ContentServiceError } from "@/lib/services/content/errors";
import { asArray, asRecord } from "@/lib/services/teacher-review/serializers";
import { createStoreOnlyZip } from "@/lib/services/teacher-research-export/zip";
import {
  buildExportSourceIdentity,
  sourceIdentityRow,
  type ExportSourceIdentity
} from "@/lib/services/teacher-research-export/source-identity";
import {
  AGENT_ACTIVITY_RECORDS_COLUMNS,
  ANALYSIS_READY_EXPORT_VERSION,
  ASSESSMENT_CONTENT_COLUMNS,
  ASSESSMENT_SUMMARY_COLUMNS,
  CONVERSATION_TURNS_COLUMNS,
  dataDictionaryCsv,
  ITEM_RESPONSES_COLUMNS,
  processEventCodebookCsv,
  PROCESS_EVENTS_COLUMNS,
  SESSIONS_COLUMNS
} from "./dictionary";
import {
  ResearchPseudonymizationConfigError,
  assertResearchPseudonymizationReadyForExport,
  researchPseudonymizationMetadata,
  researchStudentId
} from "./pseudonymization";

type CsvPrimitive = string | number | boolean | null;
type CsvRow = Record<string, CsvPrimitive>;

const restrictedDefaultColumns = new Set([
  "correct_option",
  "correctness",
  "correctness_support_level",
  "unsupported_correct_response",
  "estimated_guessing_risk",
  "answer_selection_evidence_weight",
  "teacher_llm_media_description",
  "target_reasoning_note",
  "strong_reasoning_note",
  "distractor_diagnostic_notes"
]);

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /authorization\s*:/i,
  /bearer\s+[A-Za-z0-9._-]{10,}/i,
  /password_hash/i,
  /access_code_hash/i,
  /session_secret/i,
  /database_url/i,
  /postgresql:\/\//i
];

const analysisSessionSelect = {
  id: true,
  session_public_id: true,
  attempt_number: true,
  status: true,
  current_phase: true,
  resume_phase: true,
  started_at: true,
  last_activity_at: true,
  completed_at: true,
  created_at: true,
  updated_at: true,
  user: {
    select: {
      user_id: true,
      display_name: true,
      account_status: true,
      role: true,
      created_by_teacher_user_id: true
    }
  },
  assessment: {
    select: {
      assessment_public_id: true,
      title: true,
      description: true,
      diagnostic_focus: true,
      folder_label: true,
      status: true,
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
              item_stem: true,
              options: true,
              correct_option: true,
              distractor_rationales: true,
              expected_reasoning_patterns: true,
              possible_misconception_indicators: true,
              version: true,
              media_assets: {
                where: { active: true },
                orderBy: [{ order_index: "asc" }, { created_at: "asc" }],
                select: {
                  media_public_id: true,
                  media_version: true,
                  student_alt_text: true,
                  alt_text_or_description: true,
                  teacher_llm_media_description: true
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
        orderBy: [{ created_at: "desc" }],
        select: {
          profile_type: true,
          ability_profile: true,
          engagement_profile: true,
          integrated_diagnostic_profile: true,
          evidence_sufficiency: true,
          reasoning_quality_summary: true,
          engagement_summary: true,
          item_level_evidence: true,
          recommended_next_evidence: true,
          created_at: true
        }
      },
      formative_decisions: {
        orderBy: [{ created_at: "desc" }],
        select: {
          formative_value: true,
          formative_action_plan: true,
          rationale: true,
          mapping_followed: true,
          mapping_deviation_reason: true,
          created_at: true
        }
      },
      followup_rounds: {
        orderBy: [{ round_index: "asc" }],
        select: {
          round_index: true,
          status: true,
          evidence_trigger_type: true,
          started_at: true,
          completed_at: true,
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
          concept_unit: { select: { concept_unit_public_id: true, title: true } }
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
          concept_unit: { select: { concept_unit_public_id: true, title: true } }
        }
      }
    }
  },
  agent_calls: {
    orderBy: [{ created_at: "asc" }],
    select: {
      agent_name: true,
      agent_version: true,
      provider: true,
      model_name: true,
      call_status: true,
      blocked_reason: true,
      started_at: true,
      completed_at: true,
      retry_count: true,
      input_tokens: true,
      output_tokens: true,
      total_tokens: true,
      prompt_version: true,
      schema_version: true,
      output_validated: true,
      validation_error: true,
      client_request_id: true,
      agent_invocation_key: true,
      created_at: true
    }
  },
  workflow_jobs: {
    orderBy: [{ created_at: "asc" }],
    select: {
      job_public_id: true,
      job_type: true,
      status: true,
      attempt_count: true,
      max_attempts: true,
      last_error_category: true,
      last_error_message: true,
      created_at: true,
      completed_at: true
    }
  }
} satisfies Prisma.AssessmentSessionSelect;

type AnalysisSession = Prisma.AssessmentSessionGetPayload<{ select: typeof analysisSessionSelect }>;

type SupplementalRecords = Awaited<ReturnType<typeof loadSupplementalRecords>>;

function iso(value?: Date | null) {
  return value ? value.toISOString() : null;
}

function ms(value?: Date | null) {
  return value ? value.getTime() : null;
}

function diff(start: number | null, end: number | null) {
  if (start === null || end === null) return null;
  return Math.max(0, end - start);
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

function columnsFor(columns: readonly string[], includeRestricted: boolean) {
  return includeRestricted ? [...columns] : columns.filter((column) => !restrictedDefaultColumns.has(column));
}

function eventMs(event: Pick<AnalysisSession["process_events"][number], "occurred_at" | "created_at">) {
  return ms(event.occurred_at) ?? ms(event.created_at);
}

function optionalEventMs(
  event?: Pick<AnalysisSession["process_events"][number], "occurred_at" | "created_at"> | null
) {
  return event ? eventMs(event) : null;
}

function firstEvent(events: AnalysisSession["process_events"], types: string[]) {
  const typeSet = new Set(types);
  return events.find((event) => typeSet.has(event.event_type)) ?? null;
}

function lastEvent(events: AnalysisSession["process_events"], types: string[]) {
  const typeSet = new Set(types);
  return [...events].reverse().find((event) => typeSet.has(event.event_type)) ?? null;
}

function countEvents(events: AnalysisSession["process_events"], types: string[]) {
  const typeSet = new Set(types);
  return events.filter((event) => typeSet.has(event.event_type)).length;
}

function sumEventDuration(events: AnalysisSession["process_events"], field: "pause_duration_ms" | "visibility_duration_ms") {
  const values = events
    .map((event) => event[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function maxEventDuration(events: AnalysisSession["process_events"], field: "pause_duration_ms" | "visibility_duration_ms") {
  const values = events
    .map((event) => event[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
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

function payloadBoolean(payload: unknown, keys: string[]) {
  const record = asRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

function sourceRefString(sourceRef: unknown, keys: string[]) {
  return payloadString(sourceRef, keys);
}

function jsonString(value: unknown) {
  return value === null || value === undefined ? null : JSON.stringify(value);
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

function sessionWhere(input: {
  teacher_user_db_id: string;
  assessment_public_id?: string;
  student_user_id?: string;
  session_public_id?: string;
  include_incomplete_sessions?: boolean;
}): Prisma.AssessmentSessionWhereInput {
  return {
    session_public_id: input.session_public_id,
    status: input.include_incomplete_sessions === false ? "completed" : undefined,
    assessment: { assessment_public_id: input.assessment_public_id },
    user: {
      role: "student",
      account_status: "active",
      user_id: input.student_user_id
    },
    OR: authorizedSessionOr(input.teacher_user_db_id)
  };
}

async function loadSessions(input: {
  teacher_user_db_id: string;
  assessment_public_id?: string;
  student_user_id?: string;
  session_public_id?: string;
  include_incomplete_sessions?: boolean;
}) {
  return prisma.assessmentSession.findMany({
    where: sessionWhere(input),
    orderBy: [
      { assessment: { title: "asc" } },
      { user: { user_id: "asc" } },
      { attempt_number: "asc" },
      { created_at: "asc" }
    ],
    select: analysisSessionSelect
  });
}

async function loadSupplementalRecords(sessionPublicIds: string[]) {
  const [activityAttempts, evidenceRecords, snapshots] = await Promise.all([
    prisma.activityRuntimeAttempt.findMany({
      where: { session_public_id: { in: sessionPublicIds } },
      orderBy: [{ created_at: "asc" }]
    }),
    prisma.activityMisconceptionEvidenceRecord.findMany({
      where: { session_public_id: { in: sessionPublicIds } },
      orderBy: [{ created_at: "asc" }]
    }),
    prisma.postActivityDiagnosticSnapshot.findMany({
      where: { session_public_id: { in: sessionPublicIds } },
      orderBy: [{ created_at: "asc" }]
    })
  ]);

  return { activityAttempts, evidenceRecords, snapshots };
}

function sourceFor(input: {
  scope: string;
  assessment_public_id?: string;
  student_user_id?: string;
  session_public_id?: string;
}) {
  return buildExportSourceIdentity({
    export_schema_version: ANALYSIS_READY_EXPORT_VERSION,
    export_scope: input.scope,
    selected_assessment_public_id: input.assessment_public_id,
    selected_student_id: input.student_user_id,
    selected_session_public_id: input.session_public_id
  });
}

function assessmentSnapshotId(session: AnalysisSession) {
  return `${session.assessment.assessment_public_id}:session:${session.session_public_id}`;
}

function itemSnapshotId(response: AnalysisSession["concept_unit_sessions"][number]["item_responses"][number]) {
  return `${response.item.item_public_id}:v${response.item_version_snapshot}`;
}

function itemSnapshotRecord(response: AnalysisSession["concept_unit_sessions"][number]["item_responses"][number]) {
  return asRecord(response.item_snapshot);
}

function packageEvidenceByItem(session: AnalysisSession) {
  const packages = session.concept_unit_sessions
    .flatMap((conceptUnitSession) => conceptUnitSession.response_packages)
    .filter((responsePackage) => responsePackage.package_type === "initial_concept_unit_response_package")
    .sort((left, right) => right.created_at.getTime() - left.created_at.getTime());
  const itemEvidence = asArray(asRecord(packages[0]?.payload).item_responses).map(asRecord);
  return new Map(itemEvidence.map((entry) => [String(entry.item_public_id ?? ""), entry]));
}

function mediaPublicIds(response: AnalysisSession["concept_unit_sessions"][number]["item_responses"][number]) {
  const snapshotMedia = asArray(itemSnapshotRecord(response).media_assets).map(asRecord);
  const fromSnapshot = snapshotMedia
    .map((entry) => {
      const id = typeof entry.media_public_id === "string" ? entry.media_public_id : null;
      const version = typeof entry.media_version === "number" ? entry.media_version : null;
      return id ? `${id}${version ? `:v${version}` : ""}` : null;
    })
    .filter((value): value is string => Boolean(value));
  if (fromSnapshot.length) return fromSnapshot.join(";");
  return response.item.media_assets
    .map((asset) => `${asset.media_public_id}:v${asset.media_version}`)
    .join(";");
}

function optionsByLabel(value: unknown) {
  const result = new Map<string, string>();
  for (const option of asArray(value).map(asRecord)) {
    const label = typeof option.label === "string" ? option.label.toUpperCase() : null;
    const text = typeof option.text === "string" ? option.text : null;
    if (label && text) result.set(label, text);
  }
  return result;
}

function latestProfile(session: AnalysisSession) {
  return session.concept_unit_sessions.flatMap((entry) => entry.student_profiles)[0] ?? null;
}

function evidenceProfileV2(profile: ReturnType<typeof latestProfile>) {
  const evidence = asRecord(profile?.item_level_evidence);
  const profileV2 = asRecord(evidence.evidence_integrated_profile_v2);
  return profileV2.profile_schema_version ? profileV2 : null;
}

function evidenceNextInteractionV2(profile: ReturnType<typeof latestProfile>) {
  const evidence = asRecord(profile?.item_level_evidence);
  const nextInteraction = asRecord(evidence.next_interaction_v2);
  return nextInteraction.next_interaction_schema_version ? nextInteraction : null;
}

function profileString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function nestedProfileValue(record: Record<string, unknown> | null, key: string) {
  const nested = asRecord(record?.[key]);
  return typeof nested.value === "string" ? nested.value : null;
}

function evidenceLimitationCodes(record: Record<string, unknown> | null) {
  const limitations = Array.isArray(record?.evidence_limitations)
    ? record.evidence_limitations
    : [];
  return limitations
    .map((entry) => asRecord(entry).code)
    .filter((code): code is string => typeof code === "string" && code.length > 0)
    .join("|") || null;
}

function growthTargetValue(record: Record<string, unknown> | null) {
  const target = asRecord(record?.growth_target).target;
  return typeof target === "string" ? target : null;
}

function answerRevealState(record: Record<string, unknown> | null) {
  return asRecord(asRecord(record?.outcome_summary).restricted_answer_reveal_state);
}

function studentSafeStatus(profile: ReturnType<typeof latestProfile>) {
  if (!profile) return null;
  const profileV2 = evidenceProfileV2(profile);
  const summary = asRecord(profileV2?.student_safe_summary);
  if (typeof summary.understanding_label === "string") {
    return summary.understanding_label;
  }
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

function sessionBase(source: ExportSourceIdentity, session: AnalysisSession) {
  const responses = session.concept_unit_sessions.flatMap((entry) => entry.item_responses);
  const pseudonymousStudentId = researchStudentId(session.user.user_id);
  const pseudonymization = researchPseudonymizationMetadata();
  return {
    ...sourceIdentityRow(source),
    research_student_id: pseudonymousStudentId,
    student_id: pseudonymousStudentId,
    student_public_id: pseudonymousStudentId,
    research_pseudonym_version: pseudonymization.research_pseudonym_version,
    pseudonymization_method: pseudonymization.pseudonymization_method,
    pseudonymization_version: pseudonymization.research_pseudonym_version,
    pseudonymization_key_fingerprint: pseudonymization.pseudonymization_key_fingerprint,
    assessment_public_id: session.assessment.assessment_public_id,
    assessment_snapshot_public_id: assessmentSnapshotId(session),
    session_public_id: session.session_public_id,
    attempt_number: session.attempt_number,
    context_schema_version: "assessment-session-context-v1",
    assessment_context_hash: sha({
      assessment_public_id: session.assessment.assessment_public_id,
      session_public_id: session.session_public_id,
      item_snapshots: responses.map((response) => response.item_snapshot)
    }),
    assessment_title: session.assessment.title,
    assessment_status: session.assessment.status,
    folder_week_module: session.assessment.folder_label ?? null,
    release_at: iso(session.assessment.release_at),
    close_at: iso(session.assessment.close_at)
  };
}

function sessionRows(source: ExportSourceIdentity, sessions: AnalysisSession[], supplemental: SupplementalRecords) {
  const activityCounts = new Map<string, number>();
  for (const activity of supplemental.activityAttempts) {
    activityCounts.set(activity.session_public_id, (activityCounts.get(activity.session_public_id) ?? 0) + 1);
  }
  const evidenceCounts = new Map<string, number>();
  for (const evidence of supplemental.evidenceRecords) {
    evidenceCounts.set(evidence.session_public_id, (evidenceCounts.get(evidence.session_public_id) ?? 0) + 1);
  }
  const snapshotCounts = new Map<string, number>();
  for (const snapshot of supplemental.snapshots) {
    snapshotCounts.set(snapshot.session_public_id, (snapshotCounts.get(snapshot.session_public_id) ?? 0) + 1);
  }

  return sessions.map((session) => {
    const responses = session.concept_unit_sessions.flatMap((entry) => entry.item_responses);
    const sessionEvents = session.process_events;
    const initialResponses = responses.filter((response) => response.item.item_order <= 3);
    const longPauseEvents = session.process_events.filter((event) => event.event_type === "long_pause");
    const hiddenEvents = session.process_events.filter((event) =>
      ["page_hidden", "page_visibility_hidden", "window_blur"].includes(event.event_type)
    );
    const idleEvents = session.process_events.filter((event) =>
      ["long_pause", "inactivity_detected"].includes(event.event_type)
    );
    const totalIdle = sumEventDuration(idleEvents, "pause_duration_ms");
    const elapsed = diff(ms(session.started_at ?? session.created_at), ms(session.completed_at ?? session.last_activity_at ?? session.updated_at));
    const activeTime = elapsed !== null && totalIdle !== null ? Math.max(0, elapsed - totalIdle) : null;
    const profile = latestProfile(session);
    const profileV2 = evidenceProfileV2(profile);
    const nextInteraction = evidenceNextInteractionV2(profile);
    const revealState = answerRevealState(profileV2);
    const profileEvidence = asRecord(profile?.item_level_evidence);
    const unsupportedCorrectCount = responses.filter((response) => {
      const evidence = packageEvidenceByItem(session).get(response.item.item_public_id);
      return asRecord(evidence).unsupported_correct_response === true;
    }).length;
    const activityAttempts = supplemental.activityAttempts.filter(
      (activity) => activity.session_public_id === session.session_public_id
    );
    const latestActivityAttempt = activityAttempts.at(-1) ?? null;
    const activitySkippedEvent = lastEvent(sessionEvents, ["formative_activity_skipped"]);
    const teacherEndedEvent = lastEvent(sessionEvents, ["attempt_ended_by_teacher"]);
    const studentEndedEvent = lastEvent(sessionEvents, ["attempt_ended_by_student"]);
    const completionEvent = lastEvent(sessionEvents, [
      "assessment_completed",
      "assessment_completed_with_unresolved_evidence",
      "session_completed"
    ]);
    const attemptStartedEvent = firstEvent(sessionEvents, ["attempt_started"]);
    const teacherOverrideMetadata = teacherEndedEvent
      ? {
          request_id: payloadString(teacherEndedEvent.payload, ["request_id"]),
          terminal_status: payloadString(teacherEndedEvent.payload, ["terminal_status"]),
          override_applied: payloadBoolean(teacherEndedEvent.payload, ["override_applied"])
        }
      : null;
    const attemptLifecycleStatus =
      session.status === "completed" || session.current_phase === "session_completed" || session.completed_at
        ? "completed"
        : teacherEndedEvent
          ? "ended_by_teacher"
          : studentEndedEvent || session.status === "student_exited" || session.current_phase === "student_exited"
            ? "ended_by_student"
            : session.status === "paused"
              ? "paused"
              : session.status === "active"
                ? "active"
                : session.status;
    const terminalReason =
      attemptLifecycleStatus === "completed"
        ? "completed"
        : attemptLifecycleStatus === "ended_by_teacher"
          ? "ended_by_teacher"
          : attemptLifecycleStatus === "ended_by_student"
            ? "ended_by_student"
            : attemptLifecycleStatus === "paused"
              ? "paused"
              : null;
    const formativeActivityCompletionStatus =
      latestActivityAttempt?.status === "move_on_recommended"
        ? "skipped"
        : latestActivityAttempt?.completed_at
          ? "completed"
          : latestActivityAttempt?.status ?? null;
    const packageCompletionEvent = lastEvent(sessionEvents, ["package_completion_operation_completed"]);
    const recoveryEvent = lastEvent(sessionEvents, ["package_completion_reconciled"]);
    const displayAckEvent = lastEvent(sessionEvents, [
      "package_results_shown",
      "profile_feedback_shown",
      "next_interaction_shown",
      "formative_activity_shown"
    ]);
    const nextInteractionTurn = [...session.conversation_turns].reverse().find((turn) => {
      const payload = asRecord(turn.structured_payload);
      return payload.message_type === "next_interaction";
    });
    const canonicalRuntimeState =
      session.current_phase === "planning_completed" &&
      latestActivityAttempt?.status === "awaiting_student_activity_response"
        ? "AWAIT_FORMATIVE_ACTIVITY_RESPONSE"
        : session.current_phase;
    const conflictRecoveryMetadata = {
      package_completion_event: packageCompletionEvent
        ? {
            operation_public_id: payloadString(packageCompletionEvent.payload, ["operation_public_id"]),
            workflow_stage: payloadString(packageCompletionEvent.payload, ["workflow_stage"]),
            recovery_status: payloadString(packageCompletionEvent.payload, ["recovery_status"]),
            already_completed: payloadBoolean(packageCompletionEvent.payload, ["already_completed"])
          }
        : null,
      recovery_event: recoveryEvent
        ? {
            recovered_stages: asRecord(recoveryEvent.payload).recovered_stages ?? null,
            reason: payloadString(recoveryEvent.payload, ["reason"])
          }
        : null
    };
    return {
      ...sessionBase(source, session),
      session_status: session.status,
      current_phase: session.current_phase,
      started_at: iso(session.started_at),
      last_activity_at: iso(session.last_activity_at),
      completed_at: iso(session.completed_at),
      resumed_at: iso(firstEvent(session.process_events, ["session_resumed"])?.occurred_at ?? null),
      exited_at: iso(firstEvent(session.process_events, ["session_exited"])?.occurred_at ?? null),
      attempt_lifecycle_status: attemptLifecycleStatus,
      terminal_reason: terminalReason,
      ended_by_actor:
        attemptLifecycleStatus === "ended_by_teacher"
          ? "teacher"
          : attemptLifecycleStatus === "ended_by_student"
            ? "student"
            : null,
      pause_count: countEvents(sessionEvents, ["attempt_paused", "session_paused"]),
      resume_count: countEvents(sessionEvents, ["attempt_resumed", "session_resumed"]),
      last_runtime_state: latestActivityAttempt?.status ?? null,
      formative_activity_completion_status: formativeActivityCompletionStatus,
      activity_skip_reason: activitySkippedEvent
        ? payloadString(activitySkippedEvent.payload, ["skip_reason", "reason"]) ?? "student_selected_skip_activity"
        : null,
      selected_navigation_destination: payloadString(activitySkippedEvent?.payload, [
        "selected_navigation_destination",
        "destination_type"
      ]),
      assessment_completion_reason:
        completionEvent?.event_type ??
        (attemptLifecycleStatus === "completed" ? "session_completed" : terminalReason),
      attempt_policy_version:
        payloadString(attemptStartedEvent?.payload, ["attempt_policy_version"]) ??
        "assessment-attempt-policy-v1",
      teacher_override_metadata: jsonString(teacherOverrideMetadata),
      actual_initial_item_count: initialResponses.length,
      completed_initial_item_count: initialResponses.filter((response) => response.item_submitted_at).length,
      current_item_index: responses.length ? Math.max(...responses.map((response) => response.item.item_order)) : null,
      session_completion_status: session.status,
      session_limitations: responses.length ? "" : "no_item_responses_recorded",
      active_interaction_time_ms: activeTime,
      elapsed_session_time_ms: elapsed,
      timing_metric_available: elapsed !== null,
      timing_metric_type: elapsed !== null ? "elapsed_session_time_minus_recorded_idle_when_available" : null,
      total_idle_time_ms: totalIdle,
      total_page_hidden_ms: sumEventDuration(hiddenEvents, "visibility_duration_ms"),
      idle_ratio: elapsed && totalIdle !== null ? Number((totalIdle / elapsed).toFixed(4)) : null,
      long_pause_count: longPauseEvents.length,
      total_long_pause_ms: sumEventDuration(longPauseEvents, "pause_duration_ms"),
      maximum_long_pause_ms: maxEventDuration(longPauseEvents, "pause_duration_ms"),
      item_response_count: responses.length,
      process_event_count: session.process_events.length,
      conversation_turn_count: session.conversation_turns.length,
      agent_call_count: session.agent_calls.length,
      total_input_tokens: session.agent_calls.reduce((total, call) => total + (call.input_tokens ?? 0), 0),
      total_output_tokens: session.agent_calls.reduce((total, call) => total + (call.output_tokens ?? 0), 0),
      total_tokens: session.agent_calls.reduce((total, call) => total + (call.total_tokens ?? 0), 0),
      formative_activity_attempt_count: activityCounts.get(session.session_public_id) ?? 0,
      post_activity_evidence_count: evidenceCounts.get(session.session_public_id) ?? 0,
      diagnostic_snapshot_count: snapshotCounts.get(session.session_public_id) ?? 0,
      assessment_specific_understanding_category:
        nestedProfileValue(profileV2, "assessment_specific_understanding") ??
        profile?.integrated_diagnostic_profile ??
        null,
      reasoning_quality_category: nestedProfileValue(profileV2, "reasoning_quality"),
      confidence_calibration_category: nestedProfileValue(profileV2, "confidence_calibration"),
      evidence_limitation_codes: evidenceLimitationCodes(profileV2),
      growth_target: growthTargetValue(profileV2),
      answer_reveal_policy:
        typeof revealState.answer_reveal_policy === "string"
          ? revealState.answer_reveal_policy
          : null,
      correctness_status_reveal_policy:
        typeof revealState.correctness_status_reveal_policy === "string"
          ? revealState.correctness_status_reveal_policy
          : null,
      next_interaction_type: profileString(nextInteraction, "interaction_type"),
      package_completion_operation_id: payloadString(packageCompletionEvent?.payload, ["operation_public_id"]),
      package_completion_workflow_stage: payloadString(packageCompletionEvent?.payload, ["workflow_stage"]),
      package_completion_recovery_status: payloadString(packageCompletionEvent?.payload, ["recovery_status"]),
      canonical_runtime_state: canonicalRuntimeState,
      active_next_interaction_id: nextInteractionTurn ? `${session.session_public_id}:turn:${nextInteractionTurn.created_at.toISOString()}` : null,
      active_activity_id: latestActivityAttempt?.activity_attempt_public_id ?? null,
      display_acknowledgement: displayAckEvent ? "acknowledged" : "not_acknowledged",
      display_event_contract_version: payloadString(displayAckEvent?.payload, ["display_event_contract_version"]),
      conflict_recovery_metadata: jsonString(conflictRecoveryMetadata),
      activity_type: profileString(nextInteraction, "activity_type"),
      routing_policy_version: profileString(nextInteraction, "routing_policy_version"),
      activity_taxonomy_version: profileString(nextInteraction, "activity_taxonomy_version"),
      evidence_profile_schema_version: profileString(profileV2, "profile_schema_version"),
      effective_evidence_package_hash:
        typeof profileEvidence.effective_evidence_package_hash === "string"
          ? profileEvidence.effective_evidence_package_hash
          : null,
      engagement_review_category: profile?.engagement_profile ?? null,
      latest_student_safe_status: studentSafeStatus(profile),
      evidence_sufficiency: profile?.evidence_sufficiency ?? null,
      interpretation_limitations: profile
        ? "interpretive_assessment_specific_signal_not_stable_trait"
        : "no_valid_profile_output_recorded",
      unsupported_correct_response_count: unsupportedCorrectCount,
      estimated_guessing_risk_max: null
    } satisfies CsvRow;
  });
}

function itemResponseRows(sessions: AnalysisSession[], includeRestricted: boolean) {
  const rows: CsvRow[] = [];
  for (const session of sessions) {
    const packageEvidence = packageEvidenceByItem(session);
    for (const conceptUnitSession of session.concept_unit_sessions) {
      for (const response of conceptUnitSession.item_responses) {
        const itemEvents = session.process_events.filter((event) => event.item?.item_public_id === response.item.item_public_id);
        const evidence = asRecord(packageEvidence.get(response.item.item_public_id));
        const firstAction = firstEvent(itemEvents, [
          "option_clicked",
          "option_selected",
          "reasoning_started",
          "reasoning_entered",
          "reasoning_submitted",
          "confidence_clicked",
          "confidence_selected",
          "tempting_option_submitted"
        ]);
        const firstOption = firstEvent(itemEvents, ["option_clicked", "option_selected", "transfer_answer_selected"]);
        const reasoningPrompt = firstEvent(
          itemEvents.filter((event) => payloadString(event.payload, ["prompt_type", "message_type"])?.includes("reason")),
          ["agent_message_shown"]
        ) ?? firstEvent(itemEvents, ["agent_message_shown"]);
        const confidencePrompt = firstEvent(
          itemEvents.filter((event) => payloadString(event.payload, ["prompt_type", "message_type"])?.includes("confidence")),
          ["agent_message_shown"]
        ) ?? firstEvent(itemEvents, ["agent_message_shown"]);
        const reasoningSubmitted = firstEvent(itemEvents, ["reasoning_submitted", "transfer_reasoning_submitted"]);
        const confidenceSelected = firstEvent(itemEvents, ["confidence_clicked", "confidence_selected", "transfer_confidence_clicked"]);
        const lastAction = lastEvent(itemEvents, [
          "option_clicked",
          "option_selected",
          "transfer_answer_selected",
          "reasoning_submitted",
          "transfer_reasoning_submitted",
          "confidence_clicked",
          "confidence_selected",
          "transfer_confidence_clicked",
          "tempting_option_submitted",
          "transfer_tempting_option_submitted",
          "tempting_option_reason_submitted",
          "transfer_tempting_option_reason_submitted"
        ]);
        const row: CsvRow = {
          session_public_id: session.session_public_id,
          attempt_number: session.attempt_number,
          research_student_id: researchStudentId(session.user.user_id),
          student_id: researchStudentId(session.user.user_id),
          assessment_public_id: session.assessment.assessment_public_id,
          assessment_snapshot_public_id: assessmentSnapshotId(session),
          item_public_id: response.item.item_public_id,
          item_snapshot_public_id: itemSnapshotId(response),
          item_version: response.item_version_snapshot,
          item_order: response.item.item_order,
          response_public_id: `${session.session_public_id}:${response.item.item_public_id}:response`,
          media_snapshot_public_ids: mediaPublicIds(response),
          selected_option: response.selected_option,
          reasoning_text: response.reasoning_text,
          confidence_rating: response.confidence_rating,
          tempting_option: typeof evidence.tempting_option === "string" ? evidence.tempting_option : null,
          tempting_option_reason: typeof evidence.tempting_option_reason === "string" ? evidence.tempting_option_reason : null,
          insufficient_knowledge_selected: countEvents(itemEvents, ["idk_selected", "insufficient_knowledge_marked"]) > 0,
          skipped_item: response.skipped_item,
          skipped_reasoning: response.skipped_reasoning,
          skipped_confidence: response.skipped_confidence,
          response_finalized: Boolean(response.item_submitted_at),
          submitted_at: iso(response.item_submitted_at),
          revised_at: response.revision_count > 0 ? iso(response.updated_at) : null,
          revision_count: response.revision_count,
          item_presented_at: iso(firstEvent(itemEvents, ["item_presented", "transfer_item_presented"])?.occurred_at ?? response.item_started_at),
          first_student_action_at: iso(firstAction?.occurred_at ?? null),
          time_to_first_action_ms: diff(ms(response.item_started_at), optionalEventMs(firstAction)),
          first_option_selected_at: iso(firstOption?.occurred_at ?? null),
          time_to_first_option_selection_ms: diff(ms(response.item_started_at), optionalEventMs(firstOption)),
          reasoning_prompted_at: iso(reasoningPrompt?.occurred_at ?? null),
          reasoning_started_at: iso(firstEvent(itemEvents, ["reasoning_entered"])?.occurred_at ?? null),
          reasoning_submitted_at: iso(reasoningSubmitted?.occurred_at ?? null),
          reasoning_prompt_to_submission_ms: diff(optionalEventMs(reasoningPrompt), optionalEventMs(reasoningSubmitted)),
          reasoning_active_time_ms: payloadNumber(firstEvent(itemEvents, ["typing_activity_summary"])?.payload, [
            "active_typing_time_ms",
            "reasoning_input_elapsed_time_ms",
            "typing_duration_ms"
          ]),
          confidence_prompted_at: iso(confidencePrompt?.occurred_at ?? null),
          confidence_selected_at: iso(confidenceSelected?.occurred_at ?? null),
          confidence_prompt_to_selection_ms: diff(optionalEventMs(confidencePrompt), optionalEventMs(confidenceSelected)),
          last_student_action_at: iso(lastAction?.occurred_at ?? null),
          item_submitted_at: iso(response.item_submitted_at),
          last_action_to_submission_ms: diff(optionalEventMs(lastAction), ms(response.item_submitted_at)),
          item_response_time_ms: response.item_response_time_ms,
          option_selection_count: countEvents(itemEvents, ["option_clicked", "option_selected", "transfer_answer_selected"]),
          option_revision_count: countEvents(itemEvents, ["answer_changed"]),
          reasoning_submission_count: countEvents(itemEvents, ["reasoning_submitted", "transfer_reasoning_submitted"]),
          reasoning_revision_count: countEvents(itemEvents, ["reasoning_revised", "reasoning_edited"]),
          confidence_selection_count: countEvents(itemEvents, ["confidence_clicked", "confidence_selected", "transfer_confidence_clicked"]),
          confidence_revision_count: countEvents(itemEvents, ["confidence_changed"]),
          navigation_event_count: countEvents(itemEvents, ["navigation_event"]),
          page_hidden_count: countEvents(itemEvents, ["page_hidden", "page_visibility_hidden", "window_blur"]),
          typing_activity_event_count: countEvents(itemEvents, ["typing_activity_summary"]),
          response_quality_check_count: countEvents(itemEvents, ["response_quality_checked"]),
          response_quality_rejection_count: countEvents(itemEvents, ["response_quality_rejected"]),
          insufficient_knowledge_count: countEvents(itemEvents, ["idk_selected", "insufficient_knowledge_marked"]),
          procedural_clarification_count: countEvents(itemEvents, ["procedural_clarification_request", "clarification_answered"]),
          content_question_count: countEvents(itemEvents, ["content_question_deferred"]),
          invalid_help_request_count: countEvents(itemEvents, ["invalid_help_request"]),
          reasoning_quality_signal: typeof evidence.response_quality_summary === "string" ? evidence.response_quality_summary : null,
          observed_evidence_summary: typeof evidence.observed_evidence_summary === "string" ? evidence.observed_evidence_summary : null,
          misconception_hypothesis: typeof evidence.misconception_hypothesis === "string" ? evidence.misconception_hypothesis : null,
          alternative_explanations: typeof evidence.alternative_explanations === "string" ? evidence.alternative_explanations : null,
          evidence_sufficiency: typeof evidence.evidence_sufficiency === "string" ? evidence.evidence_sufficiency : null,
          interpretation_limitations: "item interpretation fields are provisional and depend on available package/profile evidence",
          teacher_diagnostic_guidance_available: Boolean(asRecord(response.item_snapshot).teacher_diagnostic_context),
          teacher_guidance_considered: Boolean(asRecord(response.item_snapshot).teacher_diagnostic_context),
          diagnostic_snapshot_before: null,
          diagnostic_snapshot_after: null
        };
        if (includeRestricted) {
          row.correct_option = response.correct_option_snapshot;
          row.correctness = response.correctness;
          row.correctness_support_level = typeof evidence.correctness_support_level === "string" ? evidence.correctness_support_level : null;
          row.unsupported_correct_response = evidence.unsupported_correct_response === true;
          row.estimated_guessing_risk = typeof evidence.estimated_guessing_risk === "string" ? evidence.estimated_guessing_risk : null;
          row.answer_selection_evidence_weight =
            typeof evidence.answer_selection_evidence_weight === "string" ? evidence.answer_selection_evidence_weight : null;
        }
        rows.push(row);
      }
    }
  }
  return rows;
}

function assessmentSummaryRows(source: ExportSourceIdentity, sessions: AnalysisSession[], supplemental: SupplementalRecords) {
  const sessionRowsById = new Map(
    sessionRows(source, sessions, supplemental).map((row) => [String(row.session_public_id), row])
  );
  return sessions.map((session) => {
    const row = sessionRowsById.get(session.session_public_id);
    if (!row) {
      throw new Error(`Missing session summary row for ${session.session_public_id}.`);
    }
    return {
      research_student_id: row.research_student_id,
      student_id: row.student_id,
      student_public_id: row.student_public_id,
      research_pseudonym_version: row.research_pseudonym_version,
      pseudonymization_method: row.pseudonymization_method,
      pseudonymization_version: row.pseudonymization_version,
      pseudonymization_key_fingerprint: row.pseudonymization_key_fingerprint,
      assessment_public_id: row.assessment_public_id,
      assessment_title: row.assessment_title,
      session_public_id: row.session_public_id,
      attempt_number: row.attempt_number,
      session_status: row.session_status ?? session.status,
      completion_status: row.session_completion_status ?? session.status,
      started_at: row.started_at ?? iso(session.started_at),
      completed_at: row.completed_at ?? iso(session.completed_at),
      item_response_count: row.item_response_count ?? 0,
      completed_initial_item_count: row.completed_initial_item_count ?? 0,
      process_event_count: row.process_event_count ?? session.process_events.length,
      conversation_turn_count: row.conversation_turn_count ?? session.conversation_turns.length,
      agent_call_count: row.agent_call_count ?? session.agent_calls.length,
      formative_activity_attempt_count: row.formative_activity_attempt_count ?? 0,
      latest_student_safe_status: row.latest_student_safe_status ?? null,
      assessment_specific_understanding_category: row.assessment_specific_understanding_category ?? null,
      reasoning_quality_category: row.reasoning_quality_category ?? null,
      confidence_calibration_category: row.confidence_calibration_category ?? null,
      growth_target: row.growth_target ?? null,
      next_interaction_type: row.next_interaction_type ?? null,
      activity_type: row.activity_type ?? null,
      engagement_review_category: row.engagement_review_category ?? null,
      evidence_sufficiency: row.evidence_sufficiency ?? null,
      elapsed_session_time_ms: row.elapsed_session_time_ms ?? null,
      active_interaction_time_ms: row.active_interaction_time_ms ?? null,
      unsupported_correct_response_count: row.unsupported_correct_response_count ?? 0,
      estimated_guessing_risk_max: row.estimated_guessing_risk_max ?? null,
      summary_limitations: "assessment_specific_summary_not_psychometric_ability_estimate"
    } satisfies CsvRow;
  });
}

function processEventRows(sessions: AnalysisSession[]) {
  return sessions.flatMap((session) =>
    session.process_events.map((event, index) => {
      const payload = asRecord(event.payload);
      const duration = event.pause_duration_ms ?? event.visibility_duration_ms ?? payloadNumber(payload, ["duration_ms"]);
      return {
        event_public_id: `${session.session_public_id}:event:${index + 1}`,
        session_public_id: session.session_public_id,
        research_student_id: researchStudentId(session.user.user_id),
        student_id: researchStudentId(session.user.user_id),
        assessment_public_id: session.assessment.assessment_public_id,
        assessment_snapshot_public_id: assessmentSnapshotId(session),
        item_public_id: event.item?.item_public_id ?? null,
        item_snapshot_public_id: event.item ? `${event.item.item_public_id}:event` : null,
        event_sequence_index: index + 1,
        event_type: event.event_type,
        event_category: event.event_category,
        event_source: event.event_source,
        phase: payloadString(payload, ["phase"]),
        occurred_at: iso(event.occurred_at),
        created_at: iso(event.created_at),
        item_position: event.item?.item_order ?? null,
        actual_total_item_count: session.concept_unit_sessions.flatMap((entry) => entry.item_responses).length,
        payload_source: payloadString(payload, ["source"]),
        payload_action_status: payloadString(payload, ["action_status", "status"]),
        payload_prompt_type: payloadString(payload, ["prompt_type", "message_type"]),
        payload_text_length: payloadNumber(payload, ["text_length", "message_length", "reasoning_length"]),
        payload_selected_option: payloadString(payload, ["selected_option", "option", "answer"]),
        payload_confidence_rating: payloadString(payload, ["confidence_rating", "confidence"]),
        payload_no_tempting_option: payload.no_tempting_option === true,
        duration_ms: duration,
        visibility_duration_ms: event.visibility_duration_ms,
        pause_duration_ms: event.pause_duration_ms,
        limitation_code: "raw_payload_excluded"
      } satisfies CsvRow;
    })
  );
}

function conversationRows(sessions: AnalysisSession[]) {
  return sessions.flatMap((session) =>
    session.conversation_turns.map((turn, index) => {
      const nextStudentTurn = session.conversation_turns
        .slice(index + 1)
        .find((candidate) => candidate.actor_type === "student");
      return {
        session_public_id: session.session_public_id,
        research_student_id: researchStudentId(session.user.user_id),
        student_id: researchStudentId(session.user.user_id),
        assessment_public_id: session.assessment.assessment_public_id,
        assessment_snapshot_public_id: assessmentSnapshotId(session),
        item_public_id: turn.item?.item_public_id ?? null,
        turn_index: index + 1,
        actor_type: turn.actor_type,
        actor_name: turn.actor_type === "agent" ? turn.agent_name ?? "assessment_agent" : turn.actor_type,
        phase: turn.phase,
        context_label:
          turn.item?.item_public_id ??
          turn.concept_unit_session?.concept_unit.concept_unit_public_id ??
          "session",
        created_at: iso(turn.created_at),
        message_text: turn.message_text,
        response_or_action_latency_ms:
          turn.actor_type !== "student" && nextStudentTurn ? diff(ms(turn.created_at), ms(nextStudentTurn.created_at)) : null,
        response_text_present: Boolean(turn.message_text?.trim()),
        turn_status: "recorded",
        limitation_code: "structured_payload_excluded"
      } satisfies CsvRow;
    })
  );
}

function agentAndActivityRows(sessions: AnalysisSession[], supplemental: SupplementalRecords) {
  const rows: CsvRow[] = [];
  for (const session of sessions) {
    for (const [index, call] of session.agent_calls.entries()) {
      rows.push({
        record_type: "agent_call",
        session_public_id: session.session_public_id,
        research_student_id: researchStudentId(session.user.user_id),
        student_id: researchStudentId(session.user.user_id),
        assessment_public_id: session.assessment.assessment_public_id,
        assessment_snapshot_public_id: assessmentSnapshotId(session),
        item_snapshot_public_id: null,
        agent_call_public_id:
          call.client_request_id ?? call.agent_invocation_key ?? `${session.session_public_id}:agent_call:${index + 1}`,
        agent_name: call.agent_name,
        provider: call.provider,
        model: call.model_name,
        status: call.call_status,
        blocked_reason: call.blocked_reason,
        started_at: iso(call.started_at ?? call.created_at),
        completed_at: iso(call.completed_at),
        retry_count: call.retry_count,
        input_token_count: call.input_tokens,
        output_token_count: call.output_tokens,
        total_token_count: call.total_tokens,
        prompt_version: call.prompt_version,
        schema_version: call.schema_version,
        output_validated: call.output_validated,
        repair_attempted: Boolean(call.validation_error),
        repair_status: call.validation_error ? "validation_error_recorded" : null,
        context_schema_version: "assessment-session-context-v1",
        assessment_context_hash: sha({ session_public_id: session.session_public_id, agent_name: call.agent_name }),
        teacher_diagnostic_context_present: null,
        interpretation_caution_present: true,
        student_evidence_present: true,
        context_version_bound: true,
        answer_key_internal_only: true,
        protected_content_exposed: false,
        limitations: call.validation_error ? "validation_error_sanitized" : null
      });
    }

    for (const conceptUnitSession of session.concept_unit_sessions) {
      for (const profile of conceptUnitSession.student_profiles) {
        rows.push({
          record_type: "profile_result",
          session_public_id: session.session_public_id,
          research_student_id: researchStudentId(session.user.user_id),
          student_id: researchStudentId(session.user.user_id),
          assessment_public_id: session.assessment.assessment_public_id,
          assessment_snapshot_public_id: assessmentSnapshotId(session),
          understanding_category: profile.integrated_diagnostic_profile,
          engagement_category: profile.engagement_profile,
          response_profile: profile.ability_profile,
          evidence_sufficiency: profile.evidence_sufficiency,
          uncertainty: profile.profile_type === "updated" ? "updated_profile" : "initial_profile",
          status: "recorded",
          started_at: iso(profile.created_at),
          completed_at: iso(profile.created_at),
          limitations: "interpretive_assessment_specific_profile"
        });
      }
      for (const decision of conceptUnitSession.formative_decisions) {
        rows.push({
          record_type: "formative_decision",
          session_public_id: session.session_public_id,
          research_student_id: researchStudentId(session.user.user_id),
          student_id: researchStudentId(session.user.user_id),
          assessment_public_id: session.assessment.assessment_public_id,
          assessment_snapshot_public_id: assessmentSnapshotId(session),
          formative_value: decision.formative_value,
          selected_strategy: decision.mapping_followed ? "mapped_strategy" : "mapped_with_deviation",
          status: "recorded",
          started_at: iso(decision.created_at),
          completed_at: iso(decision.created_at),
          limitations: decision.mapping_deviation_reason
        });
      }
      for (const followup of conceptUnitSession.followup_rounds) {
        rows.push({
          record_type: "activity_attempt",
          session_public_id: session.session_public_id,
          research_student_id: researchStudentId(session.user.user_id),
          student_id: researchStudentId(session.user.user_id),
          assessment_public_id: session.assessment.assessment_public_id,
          assessment_snapshot_public_id: assessmentSnapshotId(session),
          activity_public_id: `${session.session_public_id}:followup:${followup.round_index}`,
          activity_type: "followup_round",
          attempt_number: followup.round_index,
          status: followup.status,
          started_at: iso(followup.started_at ?? followup.created_at),
          completed_at: iso(followup.completed_at),
          limitations: followup.evidence_trigger_type
        });
      }
    }
    for (const job of session.workflow_jobs) {
      rows.push({
        record_type: "workflow_job",
        session_public_id: session.session_public_id,
        research_student_id: researchStudentId(session.user.user_id),
        student_id: researchStudentId(session.user.user_id),
        assessment_public_id: session.assessment.assessment_public_id,
        assessment_snapshot_public_id: assessmentSnapshotId(session),
        activity_public_id: job.job_public_id,
        activity_type: job.job_type,
        status: job.status,
        retry_count: job.attempt_count,
        started_at: iso(job.created_at),
        completed_at: iso(job.completed_at),
        limitations: job.last_error_category ?? null
      });
    }
  }

  for (const activity of supplemental.activityAttempts) {
    rows.push({
      record_type: "formative_activity",
      session_public_id: activity.session_public_id,
      research_student_id: researchStudentId(activity.student_public_id),
      student_id: researchStudentId(activity.student_public_id),
      assessment_public_id: activity.assessment_public_id,
      assessment_snapshot_public_id: `${activity.assessment_public_id}:session:${activity.session_public_id}`,
      activity_public_id: activity.activity_attempt_public_id,
      activity_type: activity.activity_family,
      diagnostic_purpose: activity.diagnostic_purpose,
      activity_target: activity.concept_unit_id,
      activity_prompt: sourceRefString(activity.source_activity_packet_ref, ["safe_activity_prompt"]),
      attempt_number: 1,
      status: activity.status,
      started_at: iso(activity.started_at),
      completed_at: iso(activity.completed_at),
      limitations: payloadString(activity.limitations, ["summary", "code"])
    });
  }
  for (const evidence of supplemental.evidenceRecords) {
    rows.push({
      record_type: "post_activity_evidence",
      session_public_id: evidence.session_public_id,
      research_student_id: researchStudentId(evidence.student_public_id),
      student_id: researchStudentId(evidence.student_public_id),
      assessment_public_id: evidence.assessment_public_id,
      assessment_snapshot_public_id: `${evidence.assessment_public_id}:session:${evidence.session_public_id}`,
      activity_public_id: evidence.activity_attempt_id,
      diagnostic_purpose: evidence.diagnostic_purpose,
      activity_type: evidence.activity_family,
      evaluation_status: evidence.evaluation_source,
      misconception_persisted: evidence.misconception_update_status === "misconception_persisted",
      misconception_weakened: evidence.misconception_update_status === "misconception_weakened",
      misconception_changed: evidence.misconception_update_status === "misconception_changed",
      misconception_resolved: evidence.misconception_update_status === "misconception_resolved",
      evidence_insufficient: evidence.evidence_quality === "insufficient",
      next_action: evidence.recommended_next_diagnostic_purpose,
      status: "recorded",
      started_at: iso(evidence.created_at),
      completed_at: iso(evidence.created_at),
      limitations: payloadString(evidence.limitations, ["summary", "code"])
    });
  }
  for (const snapshot of supplemental.snapshots) {
    rows.push({
      record_type: "diagnostic_snapshot",
      session_public_id: snapshot.session_public_id,
      research_student_id: researchStudentId(snapshot.student_public_id),
      student_id: researchStudentId(snapshot.student_public_id),
      assessment_public_id: snapshot.assessment_public_id,
      assessment_snapshot_public_id: `${snapshot.assessment_public_id}:session:${snapshot.session_public_id}`,
      activity_public_id: snapshot.activity_attempt_id,
      status: snapshot.activity_update_status,
      diagnostic_purpose: snapshot.next_diagnostic_purpose,
      evaluation_status: snapshot.evidence_quality,
      next_action: snapshot.next_diagnostic_purpose,
      started_at: iso(snapshot.created_at),
      completed_at: iso(snapshot.created_at),
      limitations: payloadString(snapshot.limitations, ["summary", "code"])
    });
  }
  return rows;
}

function assessmentContentRows(sessions: AnalysisSession[], includeRestricted: boolean) {
  const rows = new Map<string, CsvRow>();
  for (const session of sessions) {
    for (const conceptUnitSession of session.concept_unit_sessions) {
      for (const response of conceptUnitSession.item_responses) {
        const snapshot = itemSnapshotRecord(response);
        const options = optionsByLabel(snapshot.options ?? response.item.options);
        const media = response.item.media_assets;
        const key = `${session.session_public_id}:${response.item.item_public_id}:${response.item_version_snapshot}`;
        const row: CsvRow = {
          assessment_public_id: session.assessment.assessment_public_id,
          assessment_snapshot_public_id: assessmentSnapshotId(session),
          assessment_title: session.assessment.title,
          assessment_diagnostic_focus: session.assessment.diagnostic_focus,
          folder_week_module: session.assessment.folder_label,
          item_public_id: response.item.item_public_id,
          item_snapshot_public_id: itemSnapshotId(response),
          item_version: response.item_version_snapshot,
          item_order: response.item.item_order,
          stem: typeof snapshot.item_stem === "string" ? snapshot.item_stem : response.item.item_stem,
          option_a_text: options.get("A") ?? null,
          option_b_text: options.get("B") ?? null,
          option_c_text: options.get("C") ?? null,
          option_d_text: options.get("D") ?? null,
          media_public_ids: mediaPublicIds(response),
          student_alt_text: media.map((asset) => asset.student_alt_text ?? asset.alt_text_or_description).filter(Boolean).join("; "),
          snapshot_created_at: iso(response.created_at)
        };
        if (includeRestricted) {
          row.teacher_llm_media_description = media
            .map((asset) => asset.teacher_llm_media_description)
            .filter(Boolean)
            .join("; ");
          row.target_reasoning_note = asArray(snapshot.expected_reasoning_patterns).join("; ");
          row.strong_reasoning_note = asArray(snapshot.expected_reasoning_patterns).join("; ");
          row.distractor_diagnostic_notes = JSON.stringify(snapshot.possible_misconception_indicators ?? response.item.possible_misconception_indicators ?? null);
          row.correct_option = response.correct_option_snapshot;
        }
        rows.set(key, row);
      }
    }
  }
  return [...rows.values()].sort((left, right) =>
    `${left.assessment_public_id}.${left.session_public_id ?? ""}.${left.item_order}`.localeCompare(
      `${right.assessment_public_id}.${right.session_public_id ?? ""}.${right.item_order}`
    )
  );
}

function assertAnalysisReadySafety(files: Array<{ path: string; data: string }>, includeRestricted: boolean) {
  for (const file of files) {
    const patterns =
      file.path === "research_data_dictionary.csv" || file.path === "process_event_codebook.csv"
        ? SECRET_PATTERNS.filter((pattern) => !/password_hash|access_code_hash|database_url|session_secret/i.test(pattern.source))
        : SECRET_PATTERNS;
    for (const pattern of patterns) {
      if (pattern.test(file.data)) {
        throw new Error(`Analysis-ready export safety scan blocked secret-like content in ${file.path}.`);
      }
    }
  }
  if (!includeRestricted) {
    for (const file of files) {
      if (file.path === "research_data_dictionary.csv" || file.path === "process_event_codebook.csv") continue;
      const header = file.data.split(/\r?\n/, 1)[0] ?? "";
      for (const column of restrictedDefaultColumns) {
        if (header.split(",").includes(column)) {
          throw new Error(`Default analysis-ready export included restricted column ${column}.`);
        }
      }
    }
  }
}

function sessionDiagnosticManifest(source: ExportSourceIdentity, sessions: AnalysisSession[], supplemental: SupplementalRecords) {
  return JSON.stringify(
    {
      bundle_type: "assessment_workflow_diagnostic_bundle",
      export_schema_version: source.export_schema_version,
      export_run_public_id: source.export_run_public_id,
      export_scope: source.export_scope,
      selected_session_public_id: source.selected_session_public_id ?? null,
      generated_at: source.export_generated_at,
      preservation_note:
        "Export first and preserve existing profile, formative decision, follow-up, activity, process-event, conversation-turn, and agent-call records before rerunning assessment intelligence.",
      included_files: [
        "sessions.csv",
        "item_responses.csv",
        "process_events.csv",
        "conversation_turns.csv",
        "agent_activity_records.csv",
        "assessment_content.csv",
        "assessment_summary.csv",
        "research_data_dictionary.csv",
        "process_event_codebook.csv"
      ],
      sessions: sessions.map((session) => {
        const conceptUnitSessions = session.concept_unit_sessions;
        return {
          session_public_id: session.session_public_id,
          assessment_public_id: session.assessment.assessment_public_id,
          assessment_snapshot_public_id: assessmentSnapshotId(session),
          status: session.status,
          current_phase: session.current_phase,
          resume_phase: session.resume_phase,
          attempt_number: session.attempt_number,
          started_at: iso(session.started_at),
          completed_at: iso(session.completed_at),
          item_response_count: conceptUnitSessions.reduce((total, entry) => total + entry.item_responses.length, 0),
          response_package_count: conceptUnitSessions.reduce((total, entry) => total + entry.response_packages.length, 0),
          student_profile_count: conceptUnitSessions.reduce((total, entry) => total + entry.student_profiles.length, 0),
          formative_decision_count: conceptUnitSessions.reduce((total, entry) => total + entry.formative_decisions.length, 0),
          followup_round_count: conceptUnitSessions.reduce((total, entry) => total + entry.followup_rounds.length, 0),
          formative_activity_attempt_count: supplemental.activityAttempts.filter(
            (attempt) => attempt.session_public_id === session.session_public_id
          ).length,
          post_activity_evidence_count: supplemental.evidenceRecords.filter(
            (record) => record.session_public_id === session.session_public_id
          ).length,
          diagnostic_snapshot_count: supplemental.snapshots.filter(
            (snapshot) => snapshot.session_public_id === session.session_public_id
          ).length,
          conversation_turn_count: session.conversation_turns.length,
          process_event_count: session.process_events.length,
          agent_calls: session.agent_calls.map((call) => ({
            agent_name: call.agent_name,
            agent_version: call.agent_version,
            provider: call.provider,
            model_name: call.model_name,
            call_status: call.call_status,
            prompt_version: call.prompt_version,
            schema_version: call.schema_version,
            output_validated: call.output_validated,
            validation_error_present: Boolean(call.validation_error),
            retry_count: call.retry_count,
            started_at: iso(call.started_at),
            completed_at: iso(call.completed_at)
          })),
          workflow_jobs: session.workflow_jobs.map((job) => ({
            job_public_id: job.job_public_id,
            job_type: job.job_type,
            status: job.status,
            attempt_count: job.attempt_count,
            max_attempts: job.max_attempts,
            last_error_category: job.last_error_category,
            last_error_message_present: Boolean(job.last_error_message),
            created_at: iso(job.created_at),
            completed_at: iso(job.completed_at)
          }))
        };
      }),
      protected_values_absent: [
        "password",
        "email",
        "login_username",
        "api_key",
        "database_connection_secret",
        "raw_provider_payload",
        "hidden_system_prompt"
      ]
    },
    null,
    2
  );
}

export async function buildAnalysisReadyResearchDataBundle(input: {
  teacher_user_db_id: string;
  scope: "all_authorized" | "selected_assessment" | "selected_student" | "selected_session";
  assessment_public_id?: string;
  student_user_id?: string;
  session_public_id?: string;
  include_incomplete_sessions?: boolean;
  include_restricted_fields?: boolean;
}) {
  try {
    assertResearchPseudonymizationReadyForExport();
  } catch (error) {
    if (error instanceof ResearchPseudonymizationConfigError) {
      throw new ContentServiceError(error.code, error.message, 503, {
        retryable: true,
        operator_action: "Run research-export:preflight and configure the server-side research pseudonymization key."
      });
    }
    throw error;
  }

  const sessions = await loadSessions(input);
  if (sessions.length === 0) {
    throw new ContentServiceError(
      "no_session_data",
      "No student sessions are available for this export scope.",
      409
    );
  }

  const source = sourceFor(input);
  const supplemental = await loadSupplementalRecords(sessions.map((session) => session.session_public_id));
  const includeRestricted = input.include_restricted_fields === true;
  const files = [
    {
      path: "sessions.csv",
      data: csv(SESSIONS_COLUMNS, sessionRows(source, sessions, supplemental))
    },
    {
      path: "item_responses.csv",
      data: csv(columnsFor(ITEM_RESPONSES_COLUMNS, includeRestricted), itemResponseRows(sessions, includeRestricted))
    },
    {
      path: "process_events.csv",
      data: csv(PROCESS_EVENTS_COLUMNS, processEventRows(sessions))
    },
    {
      path: "conversation_turns.csv",
      data: csv(CONVERSATION_TURNS_COLUMNS, conversationRows(sessions))
    },
    {
      path: "agent_activity_records.csv",
      data: csv(AGENT_ACTIVITY_RECORDS_COLUMNS, agentAndActivityRows(sessions, supplemental))
    },
    {
      path: "assessment_content.csv",
      data: csv(columnsFor(ASSESSMENT_CONTENT_COLUMNS, includeRestricted), assessmentContentRows(sessions, includeRestricted))
    },
    {
      path: "assessment_summary.csv",
      data: csv(ASSESSMENT_SUMMARY_COLUMNS, assessmentSummaryRows(source, sessions, supplemental))
    },
    {
      path: "research_data_dictionary.csv",
      data: dataDictionaryCsv()
    },
    {
      path: "process_event_codebook.csv",
      data: processEventCodebookCsv()
    }
  ];
  if (input.scope === "selected_session") {
    files.push({
      path: "session_diagnostic_manifest.json",
      data: sessionDiagnosticManifest(source, sessions, supplemental)
    });
  }
  assertAnalysisReadySafety(files, includeRestricted);

  const suffix =
    input.scope === "selected_assessment" && input.assessment_public_id
      ? `assessment_${input.assessment_public_id}`
      : input.scope === "selected_student" && input.student_user_id
        ? `student_${input.student_user_id}`
        : input.scope === "selected_session" && input.session_public_id
          ? `session_${input.session_public_id}`
          : "all_authorized";

  return {
    filename: `${suffix}_research_dataset.zip`,
    content_type: "application/zip",
    buffer: createStoreOnlyZip(files),
    files,
    source,
    row_counts: Object.fromEntries(files.map((file) => [file.path, Math.max(0, file.data.trim().split(/\r?\n/).length - 1)])),
    restricted_fields_included: includeRestricted,
    no_live_provider_call_made: true
  };
}
