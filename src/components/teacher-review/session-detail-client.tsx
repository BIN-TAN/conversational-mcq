"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { BrainCircuit, ChevronLeft, Loader2, Octagon, Pause, Play, RefreshCw, RotateCcw } from "lucide-react";
import Link from "next/link";
import {
  errorFromUnknown,
  fetchItemResponses,
  fetchProcessEvents,
  fetchResponsePackages,
  fetchSessionDetail,
  fetchTranscript,
  pauseAutomation,
  resumeAutomation,
  retryAutomation,
  runFormativePlanning,
  runStudentProfiling,
  startFollowup,
  stopAutomationFollowup
} from "./api";
import type {
  ItemResponsesResponse,
  ProcessEventsResponse,
  ResponsePackagesResponse,
  SessionDetailResponse,
  StructuredApiError,
  TeacherFormativeDecision,
  TeacherFollowupRound,
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
  "conversation_transcript",
  "process_events",
  "response_packages",
  "future_agent_data"
] as const;

const eventTypes = [
  "session_started",
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
  "formative_planning_started",
  "formative_planning_succeeded",
  "formative_planning_failed",
  "followup_started",
  "followup_turn_completed",
  "followup_task_assigned",
  "off_topic_followup",
  "followup_stopped",
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
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [responsePackages, setResponsePackages] = useState<ResponsePackagesResponse | null>(null);
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
      const [detailResult, itemResult, transcriptResult, packageResult] =
        await Promise.all([
          fetchSessionDetail(sessionPublicId),
          fetchItemResponses(sessionPublicId),
          fetchTranscript(sessionPublicId),
          fetchResponsePackages(sessionPublicId)
        ]);

      setDetail(detailResult);
      setItemResponses(itemResult);
      setTranscript(transcriptResult);
      setResponsePackages(packageResult);
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
                {label(tab)}
              </button>
            ))}
          </div>

          {activeTab === "overview" ? (
            <Overview
              automationAction={automationAction}
              detail={detail}
              onAutomationAction={handleAutomationAction}
            />
          ) : null}
          {activeTab === "item_responses" && itemResponses ? (
            <ItemResponsesSection data={itemResponses} />
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
          {activeTab === "response_packages" && responsePackages ? (
            <ResponsePackagesSection data={responsePackages} />
          ) : null}
          {activeTab === "future_agent_data" ? (
            <FutureAgentSection
              detail={detail}
              followupAction={followupAction}
              onRunPlanning={(conceptUnitPublicId) => void handleRunPlanning(conceptUnitPublicId)}
              onRunProfiling={(conceptUnitPublicId) => void handleRunProfiling(conceptUnitPublicId)}
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
  automationAction,
  detail,
  onAutomationAction
}: {
  automationAction: { action: string; error: StructuredApiError | null; status: string | null } | null;
  detail: SessionDetailResponse;
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
        <Fact labelText="Current concept unit" value={detail.current_concept_unit?.title ?? "Not recorded"} />
        <Fact labelText="Concept-unit progress" value={`${detail.summary.completed_concept_unit_count} / ${detail.summary.concept_unit_count}`} />
        <Fact labelText="Item responses" value={detail.summary.item_response_count} />
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
            <h3 className="font-semibold text-ink">Automation</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              Automatic jobs prepare profiling, planning, and follow-up startup after the initial item set. Manual sessions keep teacher-triggered controls.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill value={detail.automation.workflow_mode_snapshot} />
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
          <h3 className="font-semibold text-ink">Concept-unit progress</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-line bg-slate-50 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Concept unit</th>
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
    return <EmptyState title="No concept-unit responses are recorded yet." />;
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

function TranscriptSection({ data }: { data: TranscriptResponse }) {
  if (data.turns.length === 0) {
    return <EmptyState title="No transcript turns are recorded yet." />;
  }

  return (
    <section className="space-y-3">
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
            {turn.concept_unit_public_id ? `Concept unit: ${turn.concept_unit_public_id}` : "No concept-unit association"}
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
            Concept unit
            <select
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
              onChange={(event) => onUpdateFilter("concept_unit_public_id", event.target.value)}
              value={filters.concept_unit_public_id}
            >
              <option value="">All concept units</option>
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
                      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Concept unit</dt>
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

function FutureAgentSection({
  detail,
  followupAction,
  onRunPlanning,
  onRunProfiling,
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
                    No student profile has been generated for this concept unit.
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
                    No formative decision has been generated for this concept unit.
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
              Phase 6D1 starts one first follow-up round and records open-ended conversation. It does not update profiles or replan.
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
                    No follow-up round has been generated for this concept unit.
                  </p>
                )}
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
    </section>
  );
}
