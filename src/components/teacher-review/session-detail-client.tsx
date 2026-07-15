"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { BrainCircuit, ChevronLeft, Loader2, Octagon, Pause, Play, RefreshCw, RotateCcw } from "lucide-react";
import Link from "next/link";
import {
  errorFromUnknown,
  fetchItemResponses,
  fetchProcessEvents,
  fetchReadableTranscript,
  fetchResponsePackages,
  fetchSessionDetail,
  fetchSessionDataAudit,
  fetchTranscript,
  closeAttemptAndAllowAnother,
  pauseAutomation,
  resumeAutomation,
  retryAutomation,
  runFormativePlanning,
  runFollowupUpdate,
  runStudentProfiling,
  startFollowup,
  stopAutomationFollowup
} from "./api";
import type {
  ItemResponsesResponse,
  ProcessEventsResponse,
  ReadableTranscriptResponse,
  ResponsePackagesResponse,
  SessionDataAuditResponse,
  SessionDetailResponse,
  StructuredApiError,
  TeacherConceptProgressionRecord,
  TeacherFormativeDecision,
  TeacherFollowupRound,
  TeacherFollowupUpdateCycle,
  TeacherStudentProfile,
  TranscriptResponse
} from "./types";
import {
  CopyButton,
  EmptyState,
  ErrorState,
  formatDate,
  formatDuration,
  JsonDetails,
  label,
  LoadingState,
  StatusPill
} from "./ui";

const tabs = [
  "overview",
  "item_responses",
  "readable_transcript",
  "conversation_transcript",
  "process_events",
  "session_evidence_audit",
  "response_packages",
  "future_agent_data"
] as const;

const eventTypes = [
  "attempt_started",
  "attempt_paused",
  "attempt_resumed",
  "attempt_end_requested",
  "attempt_ended_by_student",
  "attempt_ended_by_teacher",
  "attempt_expired",
  "new_attempt_available",
  "session_started",
  "session_paused",
  "session_resumed",
  "session_exited",
  "session_completed",
  "phase_entered",
  "phase_exited",
  "transition_validated",
  "transition_rejected",
  "item_presented",
  "option_selected",
  "reasoning_entered",
  "reasoning_revised",
  "confidence_selected",
  "item_submitted",
  "missing_evidence_detected",
  "missing_evidence_repair_prompted",
  "missing_evidence_skipped",
  "invalid_help_request",
  "prompt_injection_attempt",
  "procedural_clarification_request",
  "emotional_or_frustration_response",
  "page_hidden",
  "page_visible",
  "long_pause",
  "inactivity_detected",
  "navigation_event",
  "refresh_recovery",
  "schema_validation_failed",
  "agent_retry_scheduled",
  "response_collection_agent_invoked",
  "response_collection_agent_succeeded",
  "response_collection_agent_failed",
  "response_collection_fallback_used",
  "response_collection_reasoning_extracted",
  "response_collection_reasoning_extraction_failed",
  "formative_planning_started",
  "formative_planning_succeeded",
  "formative_planning_failed",
  "followup_started",
  "followup_turn_completed",
  "followup_task_assigned",
  "followup_update_triggered",
  "followup_evidence_package_created",
  "followup_profile_update_started",
  "followup_profile_update_succeeded",
  "followup_profile_update_failed",
  "followup_planning_update_started",
  "followup_planning_update_succeeded",
  "followup_planning_update_failed",
  "followup_update_cycle_completed",
  "followup_update_cycle_failed",
  "followup_final_update_started",
  "followup_final_update_completed",
  "followup_final_update_failed",
  "off_topic_followup",
  "followup_stopped",
  "formative_activity_skipped",
  "alternative_activity_requested",
  "continue_to_transfer_selected",
  "continue_to_next_concept_selected",
  "finish_assessment_selected",
  "concept_progression_offered",
  "concept_progression_requested",
  "concept_progression_cancelled",
  "concept_progression_final_update_started",
  "concept_progression_final_update_completed",
  "concept_progression_final_update_failed",
  "concept_progression_unresolved_confirmation_requested",
  "concept_progression_unresolved_confirmed",
  "concept_progression_completed",
  "concept_progression_moved_on_with_unresolved_evidence",
  "assessment_completion_requested",
  "assessment_completion_summary_shown",
  "assessment_completed",
  "assessment_completed_with_unresolved_evidence",
  "workflow_job_enqueued",
  "workflow_job_claimed",
  "workflow_job_succeeded",
  "workflow_job_failed",
  "workflow_job_retry_scheduled",
  "workflow_automation_paused",
  "workflow_automation_resumed",
  "workflow_retry_requested",
  "workflow_followup_stop_requested"
];

type Tab = (typeof tabs)[number];

function tabLabel(tab: Tab) {
  if (tab === "readable_transcript") {
    return "Readable transcript";
  }

  if (tab === "conversation_transcript") {
    return "Structured event log";
  }

  return label(tab);
}

function responseStateTone(value: string) {
  if (value === "answered_correctly") {
    return "good" as const;
  }

  if (value === "answered_incorrectly") {
    return "bad" as const;
  }

  if (value === "explicitly_skipped" || value === "response_not_finalized") {
    return "warn" as const;
  }

  return "neutral" as const;
}

function correctnessTone(value: string) {
  if (value === "correct") {
    return "good" as const;
  }

  if (value === "incorrect") {
    return "bad" as const;
  }

  if (value === "unanswered") {
    return "warn" as const;
  }

  return "neutral" as const;
}

function Fact({ labelText, value }: { labelText: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{labelText}</p>
      <div className="mt-2 text-sm font-medium text-ink">{value}</div>
    </div>
  );
}

export function TeacherSessionDetailClient({ sessionPublicId }: { sessionPublicId: string }) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [detail, setDetail] = useState<SessionDetailResponse | null>(null);
  const [itemResponses, setItemResponses] = useState<ItemResponsesResponse | null>(null);
  const [readableTranscript, setReadableTranscript] = useState<ReadableTranscriptResponse | null>(null);
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [responsePackages, setResponsePackages] = useState<ResponsePackagesResponse | null>(null);
  const [dataAudit, setDataAudit] = useState<SessionDataAuditResponse | null>(null);
  const [processEvents, setProcessEvents] = useState<ProcessEventsResponse | null>(null);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [processError, setProcessError] = useState<StructuredApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [processLoading, setProcessLoading] = useState(true);
  const [profilingAction, setProfilingAction] = useState<{
    concept_unit_public_id: string;
    error: StructuredApiError | null;
    status: string | null;
  } | null>(null);
  const [planningAction, setPlanningAction] = useState<{
    concept_unit_public_id: string;
    error: StructuredApiError | null;
    status: string | null;
  } | null>(null);
  const [followupAction, setFollowupAction] = useState<{
    concept_unit_public_id: string;
    error: StructuredApiError | null;
    status: string | null;
  } | null>(null);
  const [automationAction, setAutomationAction] = useState<{
    action: string;
    error: StructuredApiError | null;
    status: string | null;
  } | null>(null);
  const [attemptAction, setAttemptAction] = useState<{
    error: StructuredApiError | null;
    status: string | null;
  } | null>(null);
  const [processFilters, setProcessFilters] = useState({
    event_type: "",
    event_source: "",
    concept_unit_public_id: "",
    page: 1,
    page_size: 100
  });

  const loadCore = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [detailResult, itemResult, readableTranscriptResult, transcriptResult, packageResult, dataAuditResult] =
        await Promise.all([
          fetchSessionDetail(sessionPublicId),
          fetchItemResponses(sessionPublicId),
          fetchReadableTranscript(sessionPublicId),
          fetchTranscript(sessionPublicId),
          fetchResponsePackages(sessionPublicId),
          fetchSessionDataAudit(sessionPublicId)
        ]);

      setDetail(detailResult);
      setItemResponses(itemResult);
      setReadableTranscript(readableTranscriptResult);
      setTranscript(transcriptResult);
      setResponsePackages(packageResult);
      setDataAudit(dataAuditResult);
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    } finally {
      setLoading(false);
    }
  }, [sessionPublicId]);

  const loadProcessEvents = useCallback(async () => {
    setProcessLoading(true);
    setProcessError(null);

    try {
      const result = await fetchProcessEvents(sessionPublicId, processFilters);
      setProcessEvents(result);
    } catch (requestError) {
      setProcessError(errorFromUnknown(requestError));
    } finally {
      setProcessLoading(false);
    }
  }, [processFilters, sessionPublicId]);

  useEffect(() => {
    void loadCore();
  }, [loadCore]);

  useEffect(() => {
    void loadProcessEvents();
  }, [loadProcessEvents]);

  function updateProcessFilter(key: keyof typeof processFilters, value: string | number) {
    setProcessFilters((current) => ({
      ...current,
      [key]: value,
      page: key === "page" ? Number(value) : 1
    }));
  }

  async function handleRunProfiling(conceptUnitPublicId: string) {
    setProfilingAction({
      concept_unit_public_id: conceptUnitPublicId,
      error: null,
      status: "running"
    });

    try {
      const result = await runStudentProfiling(sessionPublicId, conceptUnitPublicId);
      setProfilingAction({
        concept_unit_public_id: conceptUnitPublicId,
        error: null,
        status: result.result.status
      });
      await loadCore();
      await loadProcessEvents();
    } catch (requestError) {
      setProfilingAction({
        concept_unit_public_id: conceptUnitPublicId,
        error: errorFromUnknown(requestError),
        status: null
      });
    }
  }

  async function handleRunPlanning(conceptUnitPublicId: string) {
    setPlanningAction({
      concept_unit_public_id: conceptUnitPublicId,
      error: null,
      status: "running"
    });

    try {
      const result = await runFormativePlanning(sessionPublicId, conceptUnitPublicId);
      setPlanningAction({
        concept_unit_public_id: conceptUnitPublicId,
        error: null,
        status: result.result.status
      });
      await loadCore();
      await loadProcessEvents();
    } catch (requestError) {
      setPlanningAction({
        concept_unit_public_id: conceptUnitPublicId,
        error: errorFromUnknown(requestError),
        status: null
      });
    }
  }

  async function handleStartFollowup(conceptUnitPublicId: string) {
    setFollowupAction({
      concept_unit_public_id: conceptUnitPublicId,
      error: null,
      status: "running"
    });

    try {
      const result = await startFollowup(sessionPublicId, conceptUnitPublicId);
      setFollowupAction({
        concept_unit_public_id: conceptUnitPublicId,
        error: null,
        status: result.result.status
      });
      await loadCore();
      await loadProcessEvents();
    } catch (requestError) {
      setFollowupAction({
        concept_unit_public_id: conceptUnitPublicId,
        error: errorFromUnknown(requestError),
        status: null
      });
    }
  }

  async function handleRunFollowupUpdate(conceptUnitPublicId: string) {
    setFollowupAction({
      concept_unit_public_id: conceptUnitPublicId,
      error: null,
      status: "running"
    });

    try {
      const result = await runFollowupUpdate(sessionPublicId, conceptUnitPublicId);
      setFollowupAction({
        concept_unit_public_id: conceptUnitPublicId,
        error: null,
        status: result.result.status
      });
      await loadCore();
      await loadProcessEvents();
    } catch (requestError) {
      setFollowupAction({
        concept_unit_public_id: conceptUnitPublicId,
        error: errorFromUnknown(requestError),
        status: null
      });
    }
  }

  async function handleAutomationAction(action: "pause" | "resume" | "retry" | "stop_followup") {
    setAutomationAction({
      action,
      error: null,
      status: "running"
    });

    try {
      const conceptUnitPublicId = detail?.current_concept_unit?.concept_unit_public_id;
      const result =
        action === "pause"
          ? await pauseAutomation(sessionPublicId)
          : action === "resume"
            ? await resumeAutomation(sessionPublicId)
            : action === "retry"
              ? await retryAutomation(sessionPublicId)
              : await stopAutomationFollowup(sessionPublicId, conceptUnitPublicId);

      setAutomationAction({
        action,
        error: null,
        status: result.result.status
      });
      await loadCore();
      await loadProcessEvents();
    } catch (requestError) {
      setAutomationAction({
        action,
        error: errorFromUnknown(requestError),
        status: null
      });
    }
  }

  async function handleCloseAttempt() {
    const confirmed = window.confirm(
      "Close this attempt and allow another?\n\nThe existing attempt and all records will be preserved. The student can start a new attempt only when the assessment policy allows it."
    );

    if (!confirmed) {
      return;
    }

    setAttemptAction({
      error: null,
      status: "running"
    });

    try {
      const result = await closeAttemptAndAllowAnother(
        sessionPublicId,
        "teacher_closed_stuck_or_test_attempt"
      );
      setAttemptAction({
        error: null,
        status: result.result.status
      });
      await loadCore();
      await loadProcessEvents();
    } catch (requestError) {
      setAttemptAction({
        error: errorFromUnknown(requestError),
        status: null
      });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-accent"
          href="/teacher/sessions"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Back to sessions
        </Link>
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-accent"
          onClick={() => {
            void loadCore();
            void loadProcessEvents();
          }}
          type="button"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </button>
      </div>

      {error ? <ErrorState error={error} /> : null}
      {loading ? <LoadingState /> : null}

      {!loading && detail ? (
        <>
          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-accent">
                  session review
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-ink">
                  {detail.student.user_id} · {detail.assessment.title}
                </h2>
                <p className="mt-2 text-sm text-muted">
                  Session public ID: {detail.session.session_public_id}
                </p>
              </div>
              <CopyButton value={detail.session.session_public_id} />
            </div>
          </section>

          <div className="flex flex-wrap gap-2 border-b border-line">
            {tabs.map((tab) => (
              <button
                className={`border-b-2 px-3 py-3 text-sm font-semibold ${
                  activeTab === tab
                    ? "border-accent text-accent"
                    : "border-transparent text-muted hover:text-ink"
                }`}
                key={tab}
                onClick={() => setActiveTab(tab)}
                type="button"
              >
                {tabLabel(tab)}
              </button>
            ))}
          </div>

          {activeTab === "overview" ? (
            <Overview
              attemptAction={attemptAction}
              automationAction={automationAction}
              detail={detail}
              onCloseAttempt={handleCloseAttempt}
              onAutomationAction={handleAutomationAction}
            />
          ) : null}
          {activeTab === "item_responses" && itemResponses ? (
            <ItemResponsesSection data={itemResponses} />
          ) : null}
          {activeTab === "readable_transcript" && readableTranscript ? (
            <ReadableTranscriptSection
              data={readableTranscript}
              sessionPublicId={sessionPublicId}
            />
          ) : null}
          {activeTab === "conversation_transcript" && transcript ? (
            <TranscriptSection data={transcript} />
          ) : null}
          {activeTab === "process_events" ? (
            <ProcessEventsSection
              data={processEvents}
              error={processError}
              filters={processFilters}
              loading={processLoading}
              onUpdateFilter={updateProcessFilter}
            />
          ) : null}
          {activeTab === "session_evidence_audit" && dataAudit ? (
            <SessionEvidenceAuditSection data={dataAudit} />
          ) : null}
          {activeTab === "response_packages" && responsePackages ? (
            <ResponsePackagesSection data={responsePackages} />
          ) : null}
          {activeTab === "future_agent_data" ? (
            <FutureAgentSection
              detail={detail}
              followupAction={followupAction}
              onRunPlanning={(conceptUnitPublicId) => void handleRunPlanning(conceptUnitPublicId)}
              onRunProfiling={(conceptUnitPublicId) => void handleRunProfiling(conceptUnitPublicId)}
              onRunFollowupUpdate={(conceptUnitPublicId) => void handleRunFollowupUpdate(conceptUnitPublicId)}
              onStartFollowup={(conceptUnitPublicId) => void handleStartFollowup(conceptUnitPublicId)}
              planningAction={planningAction}
              profilingAction={profilingAction}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Overview({
  attemptAction,
  automationAction,
  detail,
  onCloseAttempt,
  onAutomationAction
}: {
  attemptAction: { error: StructuredApiError | null; status: string | null } | null;
  automationAction: { action: string; error: StructuredApiError | null; status: string | null } | null;
  detail: SessionDetailResponse;
  onCloseAttempt: () => void;
  onAutomationAction: (action: "pause" | "resume" | "retry" | "stop_followup") => void;
}) {
  return (
    <section className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <Fact labelText="Student user_id" value={detail.student.user_id} />
        <Fact labelText="Assessment" value={detail.assessment.title} />
        <Fact
          labelText="Assessment public ID"
          value={
            <div className="flex flex-wrap items-center gap-2">
              <span>{detail.assessment.assessment_public_id}</span>
              <CopyButton value={detail.assessment.assessment_public_id} />
            </div>
          }
        />
        <Fact labelText="Attempt" value={detail.session.attempt_number} />
        <Fact labelText="Status" value={<StatusPill value={detail.session.status} />} />
        <Fact labelText="Current phase" value={<StatusPill value={detail.session.current_phase} tone="warn" />} />
        <Fact labelText="Started" value={<time title={detail.session.started_at ?? undefined}>{formatDate(detail.session.started_at)}</time>} />
        <Fact labelText="Last activity" value={<time title={detail.session.last_activity_at ?? undefined}>{formatDate(detail.session.last_activity_at)}</time>} />
        <Fact labelText="Completed" value={<time title={detail.session.completed_at ?? undefined}>{formatDate(detail.session.completed_at)}</time>} />
        <Fact labelText="Current topic" value={detail.current_concept_unit?.title ?? "Not recorded"} />
        <Fact labelText="Topic progress" value={`${detail.summary.completed_concept_unit_count} / ${detail.summary.concept_unit_count}`} />
        <Fact labelText="Item responses" value={detail.summary.item_response_count} />
        <Fact
          labelText="Response collection"
          value={
            detail.session.response_collection_mode_snapshot === "llm_assisted"
              ? "LLM-assisted conversation"
              : "Deterministic collection"
          }
        />
        <Fact
          labelText="Needs review"
          value={
            detail.session.needs_review ? (
              <div>
                <StatusPill value="needs_review" tone="bad" />
                <p className="mt-2 text-xs text-muted">{detail.session.needs_review_reason}</p>
              </div>
            ) : (
              <StatusPill value="not_flagged" tone="good" />
            )
          }
        />
        <Fact
          labelText="Content lock"
          value={
            detail.summary.assessment_content_locked ? (
              <StatusPill value="locked_after_student_session" tone="warn" />
            ) : (
              <StatusPill value="not_locked" tone="neutral" />
            )
          }
        />
        <Fact labelText="Response packages" value={detail.summary.response_package_count} />
      </div>

      <section className="rounded-lg border border-line bg-white p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="font-semibold text-ink">Attempt controls</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              Close a stuck or test attempt without deleting records. The prior attempt remains
              auditable, and a new attempt may be started only when the assessment policy allows it.
            </p>
          </div>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-900 transition hover:border-red-300 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="teacher-close-attempt-allow-another"
            disabled={!detail.attempt_controls.can_close_attempt || attemptAction?.status === "running"}
            onClick={onCloseAttempt}
            type="button"
          >
            <Octagon className="h-4 w-4" aria-hidden="true" />
            {detail.attempt_controls.close_label}
          </button>
        </div>
        {!detail.attempt_controls.can_close_attempt ? (
          <p className="mt-4 rounded-md border border-line bg-slate-50 px-3 py-2 text-sm text-muted">
            This attempt is already terminal and cannot be closed again.
          </p>
        ) : null}
        {attemptAction?.error ? (
          <div className="mt-4">
            <ErrorState error={attemptAction.error} />
          </div>
        ) : null}
        {attemptAction?.status && attemptAction.status !== "running" ? (
          <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Attempt action: {label(attemptAction.status)}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-line bg-white p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="font-semibold text-ink">Automation</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              Automatic jobs prepare profiling, planning, and follow-up startup after the initial item set. Manual sessions keep teacher-triggered controls.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill value={detail.automation.workflow_mode_snapshot} />
            <StatusPill value={detail.session.response_collection_mode_snapshot} />
            <StatusPill
              value={detail.automation.automation_state}
              tone={detail.automation.automation_state === "automatic_failed" ? "bad" : "neutral"}
            />
          </div>
        </div>
        {detail.automation.automation_exception_reason ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {detail.automation.automation_exception_reason}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {detail.automation.can_pause ? (
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              disabled={automationAction?.action === "pause" && automationAction.status === "running"}
              onClick={() => onAutomationAction("pause")}
              type="button"
            >
              <Pause className="h-4 w-4" aria-hidden="true" />
              Pause automation
            </button>
          ) : null}
          {detail.automation.can_resume ? (
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              disabled={automationAction?.action === "resume" && automationAction.status === "running"}
              onClick={() => onAutomationAction("resume")}
              type="button"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Resume automation
            </button>
          ) : null}
          {detail.automation.can_retry_current_step ? (
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              disabled={automationAction?.action === "retry" && automationAction.status === "running"}
              onClick={() => onAutomationAction("retry")}
              type="button"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Retry current step
            </button>
          ) : null}
          {detail.automation.can_stop_followup ? (
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-900 transition hover:border-red-300 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={automationAction?.action === "stop_followup" && automationAction.status === "running"}
              onClick={() => onAutomationAction("stop_followup")}
              type="button"
            >
              <Octagon className="h-4 w-4" aria-hidden="true" />
              Stop follow-up
            </button>
          ) : null}
        </div>
        {automationAction?.error ? (
          <div className="mt-4">
            <ErrorState error={automationAction.error} />
          </div>
        ) : null}
        {automationAction?.status && automationAction.status !== "running" ? (
          <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Automation action: {label(automationAction.status)}
          </p>
        ) : null}
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <div>
            <h4 className="text-sm font-semibold text-ink">Workflow jobs</h4>
            {detail.automation.workflow_jobs.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No workflow jobs recorded.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {detail.automation.workflow_jobs.map((job) => (
                  <div className="rounded-md border border-line p-3 text-sm" key={job.job_public_id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill value={job.status} tone={job.status === "failed" ? "bad" : "neutral"} />
                      <span className="font-medium text-ink">{label(job.job_type)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Attempts {job.attempt_count} / {job.max_attempts} · Run after {formatDate(job.run_after)}
                    </p>
                    {job.last_error_category ? (
                      <p className="mt-1 text-xs text-muted">
                        {job.last_error_category}: {job.last_error_message}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-ink">Overrides</h4>
            {detail.automation.workflow_overrides.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No teacher overrides recorded.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {detail.automation.workflow_overrides.map((override) => (
                  <div className="rounded-md border border-line p-3 text-sm" key={override.override_public_id}>
                    <p className="font-medium text-ink">{label(override.action_type)}</p>
                    <p className="mt-1 text-xs text-muted">{formatDate(override.created_at)}</p>
                    {override.reason ? (
                      <p className="mt-1 text-xs text-muted">{override.reason}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="border-b border-line p-4">
          <h3 className="font-semibold text-ink">Topic progress</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-line bg-slate-50 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Topic</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Initial completed</th>
                <th className="px-4 py-3">Follow-up</th>
                <th className="px-4 py-3">Responses</th>
                <th className="px-4 py-3">Packages</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {detail.concept_unit_sessions.map((conceptUnitSession) => (
                <tr key={conceptUnitSession.concept_unit_public_id}>
                  <td className="px-4 py-3">{conceptUnitSession.order_index}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{conceptUnitSession.title}</p>
                    <p className="mt-1 text-xs text-muted">
                      {conceptUnitSession.concept_unit_public_id}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill value={conceptUnitSession.status} />
                  </td>
                  <td className="px-4 py-3">
                    {formatDate(conceptUnitSession.initial_completed_at)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill value={conceptUnitSession.followup_status} />
                    <p className="mt-1 text-xs text-muted">
                      {conceptUnitSession.followup_round_count} rounds
                    </p>
                  </td>
                  <td className="px-4 py-3">{conceptUnitSession.item_response_count}</td>
                  <td className="px-4 py-3">{conceptUnitSession.response_package_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function ItemResponsesSection({ data }: { data: ItemResponsesResponse }) {
  if (data.concept_units.length === 0) {
    return <EmptyState title="No topic responses are recorded yet." />;
  }

  return (
    <section className="space-y-4">
      {data.concept_units.map((conceptUnit) => (
        <article className="rounded-lg border border-line bg-white p-5" key={conceptUnit.concept_unit_public_id}>
          <div className="border-b border-line pb-3">
            <h3 className="text-lg font-semibold text-ink">{conceptUnit.title}</h3>
            <p className="mt-1 text-sm text-muted">{conceptUnit.concept_unit_public_id}</p>
          </div>
          <div className="mt-4 space-y-4">
            {conceptUnit.item_responses.map((response) => (
              <div className="rounded-lg border border-line p-4" key={response.item_public_id}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Item {response.item_order} · {response.item_public_id}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-ink">
                      {String(response.item_stem_snapshot)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill
                      value={response.response_state}
                      tone={responseStateTone(response.response_state)}
                    />
                    <StatusPill
                      value={response.correctness}
                      tone={correctnessTone(response.correctness)}
                    />
                  </div>
                </div>
                <dl className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Selected</dt>
                    <dd className="mt-1 text-ink">{response.selected_option ?? "Not selected"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Correct option</dt>
                    <dd className="mt-1 text-ink">{response.correct_option_snapshot}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Confidence</dt>
                    <dd className="mt-1 text-ink">{response.confidence_rating ?? "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Response time</dt>
                    <dd className="mt-1 text-ink">{formatDuration(response.item_response_time_ms)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Submitted</dt>
                    <dd className="mt-1 text-ink">{formatDate(response.item_submitted_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Revisions</dt>
                    <dd className="mt-1 text-ink">{response.revision_count}</dd>
                  </div>
                </dl>
                <div className="mt-4 rounded-md bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Student reasoning</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">
                    {response.reasoning_text ?? "No reasoning text recorded."}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {response.skipped_item ? <StatusPill value="skipped_item" tone="warn" /> : null}
                  {response.skipped_reasoning ? <StatusPill value="skipped_reasoning" tone="warn" /> : null}
                  {response.skipped_confidence ? <StatusPill value="skipped_confidence" tone="warn" /> : null}
                  {response.missing_evidence_repair_offered ? (
                    <StatusPill value="missing_evidence_repair_offered" tone="warn" />
                  ) : null}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <JsonDetails value={response.options_snapshot} labelText="Administered options snapshot" />
                  <JsonDetails value={response.administered_snapshot} labelText="Full administered item snapshot" />
                </div>
                <p className="mt-3 text-xs text-muted">
                  Current content version: {response.current_content_version}; administered version:{" "}
                  {response.item_version_snapshot ?? "not recorded"}.
                </p>
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

function ReadableTranscriptSection({
  data,
  sessionPublicId
}: {
  data: ReadableTranscriptResponse;
  sessionPublicId: string;
}) {
  if (data.turns.length === 0) {
    return <EmptyState title="No readable transcript turns are recorded yet." />;
  }

  return (
    <section className="space-y-4">
      <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="font-semibold text-emerald-950">Readable transcript</h3>
            <p className="mt-1">
              Conversation-only teacher/research view. Structured payloads, answer keys,
              correctness labels, provider output, process payloads, and internal metadata are
              omitted here.
            </p>
            <p className="mt-1">
              Item response time and prompt-to-response latency are different: latency is measured
              from a prompt being shown to the next recorded student response or action.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              className="inline-flex h-9 items-center rounded-md border border-emerald-300 bg-white px-3 text-sm font-semibold text-emerald-950 hover:border-emerald-500"
              href={`/api/teacher/sessions/${sessionPublicId}/readable-transcript/download`}
            >
              Download readable transcript
            </a>
            <a
              className="inline-flex h-9 items-center rounded-md border border-emerald-300 bg-white px-3 text-sm font-semibold text-emerald-950 hover:border-emerald-500"
              href={`/teacher/data/research?section=dataset&session_public_id=${encodeURIComponent(sessionPublicId)}`}
            >
              Export this session
            </a>
            <a
              className="inline-flex h-9 items-center rounded-md border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-950 hover:border-amber-500"
              href={`/teacher/data/research?section=dataset&session_public_id=${encodeURIComponent(sessionPublicId)}&include_restricted_fields=true`}
            >
              Restricted session bundle
            </a>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-4">
        <dl className="grid gap-3 text-sm md:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Student</dt>
            <dd className="mt-1 text-ink">{data.student_display_label}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Assessment</dt>
            <dd className="mt-1 text-ink">{data.assessment_label}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Turns</dt>
            <dd className="mt-1 text-ink">{data.turns.length}</dd>
          </div>
        </dl>
        {data.limitations.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {data.limitations.map((limitation) => (
              <StatusPill key={limitation} value={limitation} tone="warn" />
            ))}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        {data.turns.map((turn) => (
          <article
            className={`rounded-lg border border-line bg-white p-4 ${
              turn.speaker === "student" ? "ml-auto max-w-4xl" : "mr-auto max-w-4xl"
            }`}
            key={`${turn.turn_index}-${turn.timestamp}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill value={turn.speaker} />
              <StatusPill value={turn.phase_label} tone="warn" />
              <span className="text-xs text-muted">{formatDate(turn.timestamp)}</span>
            </div>
            {turn.safe_context_label ? (
              <p className="mt-2 text-xs font-medium text-muted">{turn.safe_context_label}</p>
            ) : null}
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink">
              {turn.message_text}
            </p>
            {turn.has_structured_payload_available_elsewhere ? (
              <p className="mt-2 text-xs text-muted">
                Structured metadata is available in the Structured event log.
              </p>
            ) : null}
            {turn.next_student_response_latency_seconds !== null ? (
              <p className="mt-2 text-xs text-muted">
                Next student response/action after: {formatDuration(turn.next_student_response_latency_ms)}
                {turn.next_student_response_latency_source
                  ? ` (${turn.next_student_response_latency_source})`
                  : ""}
              </p>
            ) : null}
          </article>
        ))}
      </section>
    </section>
  );
}

function TranscriptSection({ data }: { data: TranscriptResponse }) {
  if (data.turns.length === 0) {
    return <EmptyState title="No transcript turns are recorded yet." />;
  }

  return (
    <section className="space-y-3">
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        <h3 className="font-semibold">Structured event log</h3>
        <p className="mt-1">
          Audit view with redacted structured payloads. Use the Readable transcript tab for a
          conversation-only view.
        </p>
      </section>
      {data.turns.map((turn, index) => (
        <article className="rounded-lg border border-line bg-white p-4" key={`${turn.created_at}-${index}`}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill value={turn.actor_type} />
            <StatusPill value={turn.phase} tone="warn" />
            {turn.agent_name ? <StatusPill value={turn.agent_name} /> : null}
            <span className="text-xs text-muted">{formatDate(turn.created_at)}</span>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink">
            {turn.message_text ?? "No text message recorded."}
          </p>
          <p className="mt-2 text-xs text-muted">
            {turn.concept_unit_public_id ? `Topic: ${turn.concept_unit_public_id}` : "No topic association"}
            {turn.item_public_id ? ` · Item: ${turn.item_public_id}` : ""}
            {turn.followup_round_index !== null ? ` · Follow-up round ${turn.followup_round_index}` : ""}
          </p>
          <JsonDetails value={turn.structured_payload} labelText="Structured payload" />
        </article>
      ))}
    </section>
  );
}

function ProcessEventsSection({
  data,
  error,
  filters,
  loading,
  onUpdateFilter
}: {
  data: ProcessEventsResponse | null;
  error: StructuredApiError | null;
  filters: {
    event_type: string;
    event_source: string;
    concept_unit_public_id: string;
    page: number;
    page_size: number;
  };
  loading: boolean;
  onUpdateFilter: (key: keyof typeof filters, value: string | number) => void;
}) {
  return (
    <section className="space-y-4">
      <section className="rounded-lg border border-line bg-white p-4">
        <p className="text-sm leading-6 text-muted">
          {data?.interpretation_boundary ??
            "Process events are contextual evidence for engagement and evidence sufficiency; they are not misconduct labels."}
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Event type
            <select
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
              onChange={(event) => onUpdateFilter("event_type", event.target.value)}
              value={filters.event_type}
            >
              <option value="">All event types</option>
              {eventTypes.map((eventType) => (
                <option key={eventType} value={eventType}>
                  {label(eventType)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Event source
            <select
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
              onChange={(event) => onUpdateFilter("event_source", event.target.value)}
              value={filters.event_source}
            >
              <option value="">All sources</option>
              {["frontend", "backend", "agent", "system"].map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Topic
            <select
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
              onChange={(event) => onUpdateFilter("concept_unit_public_id", event.target.value)}
              value={filters.concept_unit_public_id}
            >
              <option value="">All topics</option>
              {data?.concept_units.map((conceptUnit) => (
                <option
                  key={conceptUnit.concept_unit_public_id}
                  value={conceptUnit.concept_unit_public_id}
                >
                  {conceptUnit.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Page size
            <select
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
              onChange={(event) => onUpdateFilter("page_size", Number(event.target.value))}
              value={filters.page_size}
            >
              {[50, 100, 250, 500].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error ? <ErrorState error={error} /> : null}
      {loading ? <LoadingState label="Loading process events" /> : null}

      {data ? (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            {[
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
              "response_collection_agent_call_count",
              "response_collection_fallback_count",
              "response_collection_reasoning_extraction_count",
              "response_collection_reasoning_extraction_failure_count",
              "followup_turn_count"
            ].map((key) => (
              <Fact key={key} labelText={label(key)} value={String(data.aggregates[key] ?? 0)} />
            ))}
          </div>

          {data.events.length === 0 ? (
            <EmptyState title="No process events match the current filters." />
          ) : (
            <section className="space-y-3">
              {data.events.map((event, index) => (
                <article className="rounded-lg border border-line bg-white p-4" key={`${event.occurred_at}-${index}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill value={event.event_type} tone="warn" />
                    <StatusPill value={event.event_source} />
                    <StatusPill value={event.event_category} />
                    <span className="text-xs text-muted">{formatDate(event.occurred_at)}</span>
                  </div>
                  <dl className="mt-3 grid gap-3 text-sm md:grid-cols-4">
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Topic</dt>
                      <dd className="mt-1 text-ink">{event.concept_unit_public_id ?? "Not associated"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Item</dt>
                      <dd className="mt-1 text-ink">{event.item_public_id ?? "Not associated"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Visibility duration</dt>
                      <dd className="mt-1 text-ink">{formatDuration(event.visibility_duration_ms)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Pause duration</dt>
                      <dd className="mt-1 text-ink">{formatDuration(event.pause_duration_ms)}</dd>
                    </div>
                  </dl>
                  <JsonDetails value={event.payload} labelText="Technical process payload" />
                </article>
              ))}
            </section>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <p>
              Page {data.pagination.page} of {data.pagination.total_pages} ·{" "}
              {data.pagination.total} events
            </p>
            <div className="flex gap-2">
              <button
                className="h-9 rounded-md border border-line bg-white px-3 font-semibold text-ink disabled:opacity-50"
                disabled={filters.page <= 1}
                onClick={() => onUpdateFilter("page", filters.page - 1)}
                type="button"
              >
                Previous
              </button>
              <button
                className="h-9 rounded-md border border-line bg-white px-3 font-semibold text-ink disabled:opacity-50"
                disabled={filters.page >= data.pagination.total_pages}
                onClick={() => onUpdateFilter("page", filters.page + 1)}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

function CountList({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));

  if (entries.length === 0) {
    return <p className="mt-2 text-sm text-muted">No counts recorded.</p>;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {entries.map(([key, count]) => (
        <span
          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700"
          key={key}
        >
          {label(key)}: {count}
        </span>
      ))}
    </div>
  );
}

function AvailabilityPill({ labelText, value }: { labelText: string; value: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{labelText}</p>
      <div className="mt-2">
        <StatusPill value={value ? "available" : "not observed"} tone={value ? "good" : "warn"} />
      </div>
    </div>
  );
}

function SessionEvidenceAuditSection({ data }: { data: SessionDataAuditResponse }) {
  return (
    <section className="space-y-4">
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        <h3 className="font-semibold text-amber-950">Session evidence audit</h3>
        <p className="mt-1">{data.interpretation_boundary}</p>
        <p className="mt-1">
          This teacher/research panel summarizes data completeness. It does not expose raw
          process payloads, provider output, answer keys, or correctness labels.
        </p>
        <p className="mt-1">
          Item response time summarizes a full item interval; prompt-to-response latency measures
          the next response/action after a specific prompt and may include reading, thinking, or idle time.
        </p>
      </section>

      <div className="grid gap-3 md:grid-cols-4">
        <Fact labelText="Item attempts" value={data.data_completeness.response_package.item_attempt_count} />
        <Fact labelText="Answers recorded" value={data.data_completeness.response_package.submitted_answer_count} />
        <Fact labelText="Reasoning responses" value={data.data_completeness.response_package.reasoning_response_count} />
        <Fact labelText="Confidence ratings" value={data.data_completeness.response_package.confidence_response_count} />
        <Fact labelText="Tempting-option evidence" value={data.data_completeness.response_package.tempting_option_response_count} />
        <Fact labelText="Conversation turns" value={data.data_completeness.response_package.conversation_turns_count} />
        <Fact labelText="Initial packages" value={data.data_completeness.response_package.initial_package_count} />
        <Fact labelText="Package state" value={<StatusPill value={data.data_completeness.response_package.package_completion_state} />} />
      </div>

      <section className="rounded-lg border border-line bg-white p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="font-semibold text-ink">Process data summary</h3>
            <p className="mt-1 text-sm text-muted">
              Counts and availability only. Raw process payloads stay out of this audit panel.
            </p>
          </div>
          <StatusPill
            value={`${data.process_data_summary.observed_event_type_count} observed event types`}
            tone={data.process_data_summary.process_event_count > 0 ? "good" : "warn"}
          />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Fact labelText="Process events" value={data.process_data_summary.process_event_count} />
          <Fact labelText="Item-scoped events" value={data.process_data_summary.item_scoped_event_count} />
          <Fact labelText="Session-scoped events" value={data.process_data_summary.session_scoped_event_count} />
          <Fact labelText="Supported event types" value={data.process_data_summary.supported_process_event_type_count} />
          <AvailabilityPill
            labelText="Focus/visibility"
            value={data.process_data_summary.availability.focus_visibility_events_available}
          />
          <AvailabilityPill
            labelText="Paste context"
            value={data.process_data_summary.availability.paste_events_available}
          />
          <AvailabilityPill
            labelText="Typing summary"
            value={data.process_data_summary.availability.typing_summary_events_available}
          />
          <AvailabilityPill
            labelText="Pause/inactivity"
            value={data.process_data_summary.availability.pause_or_inactivity_events_available}
          />
        </div>
        <JsonDetails
          value={{
            observed_event_counts: data.process_data_summary.observed_event_counts,
            missing_expected_initial_event_types:
              data.process_data_summary.missing_expected_initial_event_types,
            event_source_counts: data.process_data_summary.event_source_counts,
            first_event_at: data.process_data_summary.first_event_at,
            last_event_at: data.process_data_summary.last_event_at
          }}
          labelText="Process data inventory summary"
        />
      </section>

      <section className="rounded-lg border border-line bg-white p-5">
        <h3 className="font-semibold text-ink">Evidence packet and runtime summaries</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Fact
            labelText="Engagement packet"
            value={
              <StatusPill
                value={data.engagement_evidence_summary.engagement_packet_available ? "available" : "missing"}
                tone={data.engagement_evidence_summary.engagement_packet_available ? "good" : "warn"}
              />
            }
          />
          <Fact
            labelText="Internal engagement category"
            value={data.engagement_evidence_summary.internal_only_engagement_category ?? "Not available"}
          />
          <Fact
            labelText="Unsupported correct responses"
            value={data.correctness_inflation_summary.unsupported_correct_response_count}
          />
          <Fact
            labelText="Uncertainty markers"
            value={data.correctness_inflation_summary.uncertainty_marker_count}
          />
          <Fact labelText="Activity attempts" value={data.activity_runtime_summary.attempt_count} />
          <Fact labelText="Post-activity evidence records" value={data.misconception_evidence_summary.record_count} />
          <Fact labelText="Diagnostic snapshots" value={data.diagnostic_snapshot_summary.snapshot_count} />
          <Fact labelText="Failed-closed activity attempts" value={data.activity_runtime_summary.failed_closed_count} />
          <Fact labelText="Agent calls" value={data.agent_audit_summary.call_count} />
          <Fact labelText="Failed agent calls" value={data.agent_audit_summary.failed_call_count} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-line p-4">
            <h4 className="text-sm font-semibold text-ink">Evidence-quality indicators</h4>
            <p className="mt-1 text-xs text-muted">
              These are internal evidence-quality indicators. They should not be interpreted as misconduct labels or as direct ability estimates.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Support levels</p>
                <CountList counts={data.correctness_inflation_summary.correctness_support_level_counts} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Uncertainty-risk bands</p>
                <CountList counts={data.correctness_inflation_summary.estimated_guessing_risk_counts} />
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-line p-4">
            <h4 className="text-sm font-semibold text-ink">Activity runtime states</h4>
            <CountList counts={data.activity_runtime_summary.status_counts} />
          </div>
          <div className="rounded-lg border border-line p-4">
            <h4 className="text-sm font-semibold text-ink">Activity student choices</h4>
            <CountList counts={data.activity_runtime_summary.student_choice_state_counts} />
          </div>
          <div className="rounded-lg border border-line p-4">
            <h4 className="text-sm font-semibold text-ink">Evidence update statuses</h4>
            <CountList counts={data.misconception_evidence_summary.update_status_counts} />
          </div>
          <div className="rounded-lg border border-line p-4">
            <h4 className="text-sm font-semibold text-ink">Agent calls by name</h4>
            <CountList counts={data.agent_audit_summary.agent_name_counts} />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-5">
        <h3 className="font-semibold text-ink">Limitations</h3>
        {data.limitations.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No completeness limitations detected by this audit.</p>
        ) : (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
            {data.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        )}
        <JsonDetails
          value={{
            response_evidence_summary: data.response_evidence_summary,
            engagement_process_data_limitations:
              data.engagement_evidence_summary.process_data_limitation_flags,
            activity_runtime_limitations: data.activity_runtime_summary.limitations,
            agent_audit_summary: data.agent_audit_summary,
            no_live_provider_call_made: data.no_live_provider_call_made,
            generated_at: data.generated_at
          }}
          labelText="Read-only audit details"
        />
      </section>
    </section>
  );
}

function ResponsePackagesSection({ data }: { data: ResponsePackagesResponse }) {
  if (data.response_packages.length === 0) {
    return <EmptyState title="No response packages are recorded yet." />;
  }

  return (
    <section className="space-y-4">
      {data.response_packages.map((responsePackage) => (
        <article className="rounded-lg border border-line bg-white p-5" key={`${responsePackage.package_type}-${responsePackage.sequence}`}>
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-ink">
                {label(responsePackage.package_type)}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {responsePackage.concept_unit_title} · {responsePackage.concept_unit_public_id}
              </p>
            </div>
            <div className="text-sm text-muted">
              Sequence {responsePackage.sequence} · {formatDate(responsePackage.created_at)}
            </div>
          </div>
          <JsonDetails value={responsePackage.payload_summary} labelText="Readable package summary" />
          <JsonDetails value={responsePackage.payload} labelText="Full stored package JSON" />
        </article>
      ))}
    </section>
  );
}

function ProfileDetails({ profile }: { profile: TeacherStudentProfile }) {
  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Fact labelText="Ability profile" value={<StatusPill value={profile.ability_profile} />} />
        <Fact labelText="Engagement profile" value={<StatusPill value={profile.engagement_profile} />} />
        <Fact labelText="Integrated diagnostic profile" value={<StatusPill value={profile.integrated_diagnostic_profile} tone="warn" />} />
        <Fact labelText="Integrated confidence" value={profile.integrated_profile_confidence} />
        <Fact labelText="Evidence sufficiency" value={profile.evidence_sufficiency} />
        <Fact labelText="Confidence alignment" value={profile.confidence_alignment} />
        <Fact labelText="Independence interpretability" value={profile.independence_interpretability} />
        <Fact labelText="Profile confidence" value={profile.profile_confidence} />
        <Fact labelText="Created" value={formatDate(profile.created_at)} />
      </div>
      <section className="rounded-lg border border-line bg-slate-50 p-4">
        <h4 className="text-sm font-semibold text-ink">Integrated rationale</h4>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">
          {profile.integrated_profile_rationale}
        </p>
      </section>
      <section className="rounded-lg border border-line bg-slate-50 p-4">
        <h4 className="text-sm font-semibold text-ink">Reasoning and engagement summaries</h4>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">
          {profile.reasoning_quality_summary}
        </p>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink">
          {profile.engagement_summary}
        </p>
      </section>
      <section className="rounded-lg border border-line bg-slate-50 p-4">
        <h4 className="text-sm font-semibold text-ink">Profile rationale</h4>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">
          {profile.rationale}
        </p>
      </section>
      <div className="grid gap-3 md:grid-cols-2">
        <JsonDetails value={profile.ability_pattern_flags} labelText="Ability pattern flags" />
        <JsonDetails value={profile.engagement_pattern_flags} labelText="Engagement pattern flags" />
        <JsonDetails value={profile.misconception_indicators} labelText="Misconception indicators" />
        <JsonDetails value={profile.item_level_evidence} labelText="Item-level evidence" />
        <JsonDetails value={profile.process_interpretation_cautions} labelText="Process interpretation cautions" />
        <JsonDetails value={profile.recommended_next_evidence} labelText="Recommended next evidence" />
        <JsonDetails value={profile.based_on_agent_call} labelText="Based-on agent call metadata" />
      </div>
    </div>
  );
}

function DecisionDetails({ decision }: { decision: TeacherFormativeDecision }) {
  return (
    <div className="mt-4 space-y-4">
      {decision.mock_output_notice ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          {decision.mock_output_notice}
        </section>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        <Fact labelText="Formative value" value={<StatusPill value={decision.formative_value} tone="warn" />} />
        <Fact labelText="Mapping followed" value={decision.mapping_followed ? "yes" : "no"} />
        <Fact labelText="Created" value={formatDate(decision.created_at)} />
      </div>
      <section className="rounded-lg border border-line bg-slate-50 p-4">
        <h4 className="text-sm font-semibold text-ink">Formative action plan</h4>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">
          {decision.formative_action_plan}
        </p>
      </section>
      <section className="rounded-lg border border-line bg-slate-50 p-4">
        <h4 className="text-sm font-semibold text-ink">Rationale</h4>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">
          {decision.rationale}
        </p>
        {decision.mapping_deviation_reason ? (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink">
            Mapping deviation: {decision.mapping_deviation_reason}
          </p>
        ) : null}
      </section>
      <div className="grid gap-3 md:grid-cols-2">
        <JsonDetails value={decision.target_evidence} labelText="Target evidence" />
        <JsonDetails value={decision.success_criteria} labelText="Success criteria" />
        <JsonDetails value={decision.followup_prompt_constraints} labelText="Future follow-up constraints" />
        <JsonDetails value={decision.profile_update_triggers} labelText="Profile update triggers" />
        <JsonDetails value={decision.based_on_agent_call} labelText="Based-on agent call metadata" />
      </div>
    </div>
  );
}

function FollowupRoundDetails({ round }: { round: TeacherFollowupRound }) {
  return (
    <div className="mt-4 space-y-4">
      {round.mock_output_notice ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          {round.mock_output_notice}
        </section>
      ) : null}
      <div className="grid gap-3 md:grid-cols-4">
        <Fact labelText="Round" value={round.round_index} />
        <Fact labelText="Status" value={<StatusPill value={round.status} />} />
        <Fact labelText="Started" value={formatDate(round.started_at)} />
        <Fact labelText="Completed" value={formatDate(round.completed_at)} />
      </div>
      <section className="rounded-lg border border-line bg-slate-50 p-4">
        <h4 className="text-sm font-semibold text-ink">Follow-up transcript</h4>
        <div className="mt-3 space-y-3">
          {round.transcript.length === 0 ? (
            <p className="text-sm text-muted">No follow-up transcript turns are recorded.</p>
          ) : (
            round.transcript.map((turn, index) => (
              <article className="rounded-md border border-line bg-white p-3" key={`${turn.created_at}-${index}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill value={turn.actor_type} />
                  {turn.agent_name ? <StatusPill value={turn.agent_name} /> : null}
                  <span className="text-xs text-muted">{formatDate(turn.created_at)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">
                  {turn.message_text ?? "No text message recorded."}
                </p>
                <JsonDetails value={turn.structured_payload} labelText="Safe structured metadata" />
              </article>
            ))
          )}
        </div>
      </section>
      <section className="rounded-lg border border-line bg-slate-50 p-4">
        <h4 className="text-sm font-semibold text-ink">Follow-up agent calls</h4>
        <div className="mt-3 space-y-3">
          {round.agent_calls.length === 0 ? (
            <p className="text-sm text-muted">No Follow-up Agent calls are recorded.</p>
          ) : (
            round.agent_calls.map((call, index) => (
              <article className="rounded-md border border-line bg-white p-3" key={`${call.created_at}-${index}`}>
                <div className="flex flex-wrap gap-2">
                  <StatusPill value={call.provider} />
                  <StatusPill value={call.call_status} />
                  <StatusPill value={call.mock_or_live} tone={call.mock_or_live === "mock" ? "warn" : "good"} />
                </div>
                <dl className="mt-3 grid gap-3 text-sm md:grid-cols-3">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Model</dt>
                    <dd className="mt-1 text-ink">{call.model_name}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Prompt</dt>
                    <dd className="mt-1 text-ink">{call.prompt_version}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Schema</dt>
                    <dd className="mt-1 text-ink">{call.schema_version}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Latency</dt>
                    <dd className="mt-1 text-ink">{formatDuration(call.latency_ms)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Tokens</dt>
                    <dd className="mt-1 text-ink">{call.total_tokens ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Output validated</dt>
                    <dd className="mt-1 text-ink">{call.output_validated ? "yes" : "no"}</dd>
                  </div>
                </dl>
                <JsonDetails value={{ prompt_hash: call.prompt_hash, blocked_reason: call.blocked_reason }} labelText="Audit metadata" />
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function FollowupUpdateCycleDetails({ cycle }: { cycle: TeacherFollowupUpdateCycle }) {
  return (
    <section className="rounded-lg border border-line bg-slate-50 p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-semibold text-ink">{cycle.cycle_public_id}</p>
          <p className="mt-1 text-xs text-muted">
            Staged outputs are not active unless the cycle status is completed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill value={cycle.status} tone={cycle.status === "failed" ? "bad" : cycle.status === "completed" ? "good" : "warn"} />
          <StatusPill value={cycle.trigger_type} />
          {cycle.final_update || cycle.stop_after_cycle ? <StatusPill value="final_stop_update" tone="warn" /> : null}
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Fact labelText="Evidence cutoff" value={formatDate(cycle.evidence_cutoff_at)} />
        <Fact labelText="Profile staged" value={cycle.staged_profile_present ? "yes" : "no"} />
        <Fact labelText="Planning staged" value={cycle.staged_planning_present ? "yes" : "no"} />
        <Fact labelText="Opening staged" value={cycle.staged_opening_present ? "yes" : "no"} />
        <Fact labelText="Profile call" value={cycle.profile_agent_call_present ? "recorded" : "none"} />
        <Fact labelText="Planning call" value={cycle.planning_agent_call_present ? "recorded" : "none"} />
        <Fact labelText="Opening call" value={cycle.opening_agent_call_present ? "recorded" : "none"} />
        <Fact labelText="Pointers changed" value={cycle.active_pointers_changed ? "yes" : "no"} />
      </div>
      {cycle.failure_category || cycle.failure_message ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-950">
          <p className="font-semibold">Failure: {cycle.failure_category ?? "unknown"}</p>
          <p className="mt-1">{cycle.failure_message ?? "No failure message recorded."}</p>
          {cycle.failure_stage ? <p className="mt-1 text-xs">Stage: {cycle.failure_stage}</p> : null}
        </div>
      ) : null}
      <JsonDetails value={cycle.trigger_details} labelText="Trigger details" />
      <p className="mt-3 text-xs text-muted">{cycle.interpretation_boundary}</p>
    </section>
  );
}

function ConceptProgressionDetails({
  progression
}: {
  progression: TeacherConceptProgressionRecord;
}) {
  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-semibold text-ink">{progression.progression_public_id}</p>
          <p className="mt-1 text-xs text-muted">
            Student-controlled progression record; teacher review is read-only.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill
            value={progression.status}
            tone={
              progression.status === "completed"
                ? "good"
                : progression.status === "failed"
                  ? "bad"
                  : "warn"
            }
          />
          <StatusPill value={progression.progression_type} />
          <StatusPill value={progression.resolution_status} />
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Fact labelText="Trigger" value={label(progression.trigger_type)} />
        <Fact labelText="Student choice" value={progression.student_choice ? label(progression.student_choice) : "none"} />
        <Fact labelText="Requested" value={formatDate(progression.requested_at)} />
        <Fact labelText="Confirmed" value={formatDate(progression.confirmed_at)} />
        <Fact labelText="Completed" value={formatDate(progression.completed_at)} />
        <Fact
          labelText="Destination"
          value={
            progression.destination_concept_unit
              ? `${progression.destination_concept_unit.order_index}. ${progression.destination_concept_unit.title}`
              : "assessment completion"
          }
        />
        <Fact
          labelText="Unresolved move-on"
          value={progression.moved_on_with_unresolved_evidence ? "yes" : "no"}
        />
        <Fact
          labelText="Unresolved completion"
          value={progression.completed_with_unresolved_evidence ? "yes" : "no"}
        />
      </div>
      {progression.final_update_cycle ? (
        <div className="mt-4 rounded-md border border-line bg-slate-50 px-3 py-2 text-sm text-muted">
          Final update cycle: {progression.final_update_cycle.cycle_public_id} /{" "}
          {label(progression.final_update_cycle.status)}
        </div>
      ) : null}
      <p className="mt-3 text-xs text-muted">{progression.interpretation_boundary}</p>
    </section>
  );
}

function FutureAgentSection({
  detail,
  followupAction,
  onRunPlanning,
  onRunProfiling,
  onRunFollowupUpdate,
  onStartFollowup,
  planningAction,
  profilingAction
}: {
  detail: SessionDetailResponse;
  followupAction: {
    concept_unit_public_id: string;
    error: StructuredApiError | null;
    status: string | null;
  } | null;
  onRunPlanning: (conceptUnitPublicId: string) => void;
  onRunProfiling: (conceptUnitPublicId: string) => void;
  onRunFollowupUpdate: (conceptUnitPublicId: string) => void;
  onStartFollowup: (conceptUnitPublicId: string) => void;
  planningAction: {
    concept_unit_public_id: string;
    error: StructuredApiError | null;
    status: string | null;
  } | null;
  profilingAction: {
    concept_unit_public_id: string;
    error: StructuredApiError | null;
    status: string | null;
  } | null;
}) {
  const counts = detail.future_agent_data;

  return (
    <section className="space-y-4">
      <section className="rounded-lg border border-line bg-white p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-ink">Student profiling</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              Process data are contextual evidence for engagement and evidence sufficiency; they are not misconduct labels.
            </p>
          </div>
          <StatusPill value={counts.student_profile_count > 0 ? "profiles_available" : "profiling_not_generated"} />
        </div>
        <div className="mt-4 space-y-4">
          {detail.concept_unit_sessions.map((conceptUnitSession) => {
            const actionMatches =
              profilingAction?.concept_unit_public_id === conceptUnitSession.concept_unit_public_id;
            const isRunning = actionMatches && profilingAction?.status === "running";

            return (
              <article className="rounded-lg border border-line p-4" key={conceptUnitSession.concept_unit_public_id}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-semibold text-ink">{conceptUnitSession.title}</p>
                    <p className="mt-1 text-xs text-muted">
                      {conceptUnitSession.concept_unit_public_id}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <StatusPill value={conceptUnitSession.status} />
                      {conceptUnitSession.latest_student_profile ? (
                        <StatusPill value="profiling_completed" tone="good" />
                      ) : conceptUnitSession.can_run_profiling ? (
                        <StatusPill value="profiling_pending" tone="warn" />
                      ) : (
                        <StatusPill value="no_profile" />
                      )}
                    </div>
                  </div>
                  {conceptUnitSession.can_run_profiling ? (
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isRunning}
                      onClick={() => onRunProfiling(conceptUnitSession.concept_unit_public_id)}
                      type="button"
                    >
                      {isRunning ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <BrainCircuit className="h-4 w-4" aria-hidden="true" />
                      )}
                      Run profiling
                    </button>
                  ) : null}
                </div>
                {actionMatches && profilingAction?.error ? (
                  <div className="mt-4">
                    <ErrorState error={profilingAction.error} />
                  </div>
                ) : null}
                {actionMatches && profilingAction?.status && profilingAction.status !== "running" ? (
                  <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    Profiling result: {label(profilingAction.status)}
                  </p>
                ) : null}
                {conceptUnitSession.latest_student_profile ? (
                  <ProfileDetails profile={conceptUnitSession.latest_student_profile} />
                ) : conceptUnitSession.can_run_profiling ? (
                  <p className="mt-4 text-sm text-muted">Profiling pending.</p>
                ) : (
                  <p className="mt-4 text-sm text-muted">
                    No student profile has been generated for this topic.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>
      <section className="rounded-lg border border-line bg-white p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-ink">Formative planning</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              Planning creates a saved future-support plan only. It does not deliver follow-up to students.
            </p>
          </div>
          <StatusPill value={counts.formative_decision_count > 0 ? "decisions_available" : "planning_not_generated"} />
        </div>
        <div className="mt-4 space-y-4">
          {detail.concept_unit_sessions.map((conceptUnitSession) => {
            const actionMatches =
              planningAction?.concept_unit_public_id === conceptUnitSession.concept_unit_public_id;
            const isRunning = actionMatches && planningAction?.status === "running";
            const planningPending =
              detail.session.current_phase === "planning_pending" &&
              Boolean(conceptUnitSession.latest_student_profile) &&
              !conceptUnitSession.latest_formative_decision;

            return (
              <article className="rounded-lg border border-line p-4" key={`planning-${conceptUnitSession.concept_unit_public_id}`}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-semibold text-ink">{conceptUnitSession.title}</p>
                    <p className="mt-1 text-xs text-muted">
                      {conceptUnitSession.concept_unit_public_id}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {conceptUnitSession.latest_student_profile ? (
                        <StatusPill value="profile_completed" tone="good" />
                      ) : (
                        <StatusPill value="profile_required" />
                      )}
                      {conceptUnitSession.latest_formative_decision ? (
                        <StatusPill value="planning_completed" tone="good" />
                      ) : conceptUnitSession.can_run_planning ? (
                        <StatusPill value={planningPending ? "planning_pending" : "planning_ready"} tone="warn" />
                      ) : (
                        <StatusPill value="no_decision" />
                      )}
                    </div>
                  </div>
                  {conceptUnitSession.can_run_planning ? (
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isRunning}
                      onClick={() => onRunPlanning(conceptUnitSession.concept_unit_public_id)}
                      type="button"
                    >
                      {isRunning ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <BrainCircuit className="h-4 w-4" aria-hidden="true" />
                      )}
                      Run formative planning
                    </button>
                  ) : null}
                </div>
                {actionMatches && planningAction?.error ? (
                  <div className="mt-4">
                    <ErrorState error={planningAction.error} />
                  </div>
                ) : null}
                {actionMatches && planningAction?.status && planningAction.status !== "running" ? (
                  <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    Planning result: {label(planningAction.status)}
                  </p>
                ) : null}
                {conceptUnitSession.latest_formative_decision ? (
                  <DecisionDetails decision={conceptUnitSession.latest_formative_decision} />
                ) : conceptUnitSession.can_run_planning ? (
                  <p className="mt-4 text-sm text-muted">
                    {planningPending ? "Planning pending." : "Planning ready."}
                  </p>
                ) : (
                  <p className="mt-4 text-sm text-muted">
                    No formative decision has been generated for this topic.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>
      <section className="rounded-lg border border-line bg-white p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-ink">Follow-up conversation</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              Follow-up remains open-ended. Meaningful new evidence can queue a staged profile and planning update before the next round opens.
            </p>
          </div>
          <StatusPill value={counts.followup_round_count > 0 ? "rounds_available" : "followup_not_started"} />
        </div>
        <div className="mt-4 space-y-4">
          {detail.concept_unit_sessions.map((conceptUnitSession) => {
            const actionMatches =
              followupAction?.concept_unit_public_id === conceptUnitSession.concept_unit_public_id;
            const isRunning = actionMatches && followupAction?.status === "running";
            const hasActiveRound = conceptUnitSession.followup_rounds.some((round) => round.status === "active");

            return (
              <article className="rounded-lg border border-line p-4" key={`followup-${conceptUnitSession.concept_unit_public_id}`}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-semibold text-ink">{conceptUnitSession.title}</p>
                    <p className="mt-1 text-xs text-muted">{conceptUnitSession.concept_unit_public_id}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {conceptUnitSession.latest_formative_decision ? (
                        <StatusPill value="planning_completed" tone="good" />
                      ) : (
                        <StatusPill value="decision_required" />
                      )}
                      {hasActiveRound ? (
                        <StatusPill value="followup_active" tone="good" />
                      ) : conceptUnitSession.can_start_followup ? (
                        <StatusPill value="followup_ready" tone="warn" />
                      ) : conceptUnitSession.followup_rounds.length > 0 ? (
                        <StatusPill value="followup_recorded" />
                      ) : (
                        <StatusPill value="no_round" />
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                  {conceptUnitSession.can_run_followup_update ? (
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isRunning}
                      onClick={() => onRunFollowupUpdate(conceptUnitSession.concept_unit_public_id)}
                      type="button"
                    >
                      {isRunning ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <BrainCircuit className="h-4 w-4" aria-hidden="true" />
                      )}
                      Run follow-up update
                    </button>
                  ) : null}
                  {conceptUnitSession.can_start_followup ? (
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isRunning}
                      onClick={() => onStartFollowup(conceptUnitSession.concept_unit_public_id)}
                      type="button"
                    >
                      {isRunning ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <BrainCircuit className="h-4 w-4" aria-hidden="true" />
                      )}
                      Start follow-up
                    </button>
                  ) : null}
                  </div>
                </div>
                {actionMatches && followupAction?.error ? (
                  <div className="mt-4">
                    <ErrorState error={followupAction.error} />
                  </div>
                ) : null}
                {actionMatches && followupAction?.status && followupAction.status !== "running" ? (
                  <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    Follow-up result: {label(followupAction.status)}
                  </p>
                ) : null}
                {conceptUnitSession.followup_rounds.length > 0 ? (
                  <div className="space-y-4">
                    {conceptUnitSession.followup_rounds.map((round) => (
                      <FollowupRoundDetails round={round} key={round.round_index} />
                    ))}
                  </div>
                ) : conceptUnitSession.can_start_followup ? (
                  <p className="mt-4 text-sm text-muted">Follow-up ready.</p>
                ) : (
                  <p className="mt-4 text-sm text-muted">
                    No follow-up round has been generated for this topic.
                  </p>
                )}
                {conceptUnitSession.followup_update_cycles.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Follow-up update cycles
                    </p>
                    {conceptUnitSession.followup_update_cycles.map((cycle) => (
                      <FollowupUpdateCycleDetails cycle={cycle} key={cycle.cycle_public_id} />
                    ))}
                  </div>
                ) : null}
                {conceptUnitSession.concept_progression_records.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Concept progression history
                    </p>
                    {conceptUnitSession.concept_progression_records.map((progression) => (
                      <ConceptProgressionDetails
                        progression={progression}
                        key={progression.progression_public_id}
                      />
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
      <div className="grid gap-3 md:grid-cols-4">
        <Fact labelText="Student profile rows" value={counts.student_profile_count} />
        <Fact labelText="Formative decision rows" value={counts.formative_decision_count} />
        <Fact labelText="Follow-up round rows" value={counts.followup_round_count} />
        <Fact labelText="Agent call rows" value={counts.agent_call_count} />
      </div>
      <section className="rounded-lg border border-line bg-white p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-ink">Operational agent audit</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              Read-only effective-result records show backend safeguards and fallback use. Raw
              provider output, API keys, local environment values, and internal UUIDs are not shown.
            </p>
          </div>
          <StatusPill value={detail.operational_agent_audit.operational_mode} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Fact
            labelText="Manifest"
            value={label(detail.operational_agent_audit.approved_manifest_status)}
          />
          <Fact
            labelText="Live permitted"
            value={detail.operational_agent_audit.live_call_permitted ? "yes" : "no"}
          />
          <Fact
            labelText="Effective records"
            value={detail.operational_agent_audit.effective_results.length}
          />
          <Fact
            labelText="Blocking reasons"
            value={
              detail.operational_agent_audit.blocking_reasons.length > 0
                ? detail.operational_agent_audit.blocking_reasons.map(label).join(", ")
                : "none"
            }
          />
        </div>
        <div className="mt-4 rounded-md border border-line bg-slate-50 p-3 text-xs text-muted">
          <p>Active hash: {detail.operational_agent_audit.active_configuration_hash}</p>
          <p className="mt-1">
            Approved hash: {detail.operational_agent_audit.approved_configuration_hash}
          </p>
        </div>
        {detail.operational_agent_audit.effective_results.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No operational effective-result records are associated with this session yet.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {detail.operational_agent_audit.effective_results.map((result) => (
              <article className="rounded-lg border border-line p-4" key={result.public_id}>
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-semibold text-ink">{label(result.agent_name)}</p>
                    <p className="mt-1 text-xs text-muted">{result.public_id}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill value={result.effective_overall_status} />
                    {result.fallback_applied ? <StatusPill value="fallback_applied" tone="warn" /> : null}
                    {result.deterministic_guard_applied ? <StatusPill value="guard_applied" /> : null}
                    {result.canonicalization_applied ? <StatusPill value="canonicalized" /> : null}
                  </div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <Fact labelText="Raw status" value={label(result.raw_output_status)} />
                  <Fact labelText="Workflow usable" value={result.effective_workflow_usable ? "yes" : "no"} />
                  <Fact labelText="Created" value={formatDate(result.created_at)} />
                </div>
                <JsonDetails
                  labelText="Version metadata and sanitized warnings"
                  value={{
                    effective_result_version: result.effective_result_version,
                    effective_validator_version: result.effective_validator_version,
                    deterministic_guard_version: result.deterministic_guard_version,
                    canonicalization_version: result.canonicalization_version,
                    fallback_version: result.fallback_version,
                    warnings: result.sanitized_warnings,
                    agent_call: result.agent_call
                  }}
                />
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
