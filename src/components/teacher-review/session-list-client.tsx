"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { teacherPhaseLabel } from "@/lib/teacher-session-labels";
import { ArrowUpDown, Eye, Loader2, Search } from "lucide-react";
import { errorFromUnknown, fetchTeacherSessions } from "./api";
import type { SessionListResponse, StructuredApiError } from "./types";
import { SessionBatchDeletionControl } from "./session-batch-deletion-control";
import {
  DEFAULT_SESSION_LIST_FILTERS,
  hasActiveSessionListFilters,
  parseSessionListQuery,
  serializeSessionListQuery,
  SESSION_LIST_PAGE_SIZES,
  SESSION_LIST_PHASES,
  SESSION_LIST_STATUSES,
  storeSessionListQuery,
  type SessionListFilters,
  type SessionListSortField
} from "./session-list-query";
import { EmptyState, ErrorState, formatDate, label, LoadingState, plainReviewReason, StatusPill } from "./ui";

const SEARCH_DEBOUNCE_MS = 300;

type SortField = SessionListSortField;
type AssessmentOption = { assessment_public_id: string; title: string };

function canDeleteSession(status: string) {
  return status === "completed" || status === "student_exited";
}

function cleanParams(filters: SessionListFilters, includeFilterOptions: boolean) {
  return {
    search: filters.search.trim(),
    assessment_public_id: filters.assessment_public_id,
    status: filters.status,
    phase: filters.phase,
    needs_review:
      filters.needs_review === "" ? undefined : filters.needs_review === "true",
    sort: filters.sort,
    direction: filters.direction,
    page: filters.page,
    page_size: filters.page_size,
    // The assessment options are loaded with the first request only.
    include_filters: includeFilterOptions ? undefined : false
  };
}

export function TeacherSessionListClient() {
  const [filters, setFilters] = useState<SessionListFilters>(DEFAULT_SESSION_LIST_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  // Filters are read from the URL on mount before the first request.
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<SessionListResponse | null>(null);
  const [assessmentOptions, setAssessmentOptions] = useState<AssessmentOption[] | null>(null);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const activeRequest = useRef<AbortController | null>(null);
  const optionsLoaded = useRef(false);

  useEffect(() => {
    const initial = parseSessionListQuery(window.location.search);
    setFilters(initial);
    setSearchInput(initial.search);
    setReady(true);
  }, []);

  const load = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError(null);

    try {
      const result = await fetchTeacherSessions(cleanParams(filters, !optionsLoaded.current), controller.signal);
      if (controller.signal.aborted) return;
      if (result.filters) {
        optionsLoaded.current = true;
        setAssessmentOptions(result.filters.assessments);
      }
      setData(result);
    } catch (requestError) {
      if (controller.signal.aborted) return;
      setError(errorFromUnknown(requestError));
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setLoading(false);
      }
    }
  }, [filters]);

  useEffect(() => {
    if (!ready) return;
    void load();
  }, [load, ready]);

  useEffect(() => () => activeRequest.current?.abort(), []);

  // Keep the list state in the address so a reload or "Back to sessions" shows the same list.
  useEffect(() => {
    if (!ready) return;
    const query = serializeSessionListQuery(filters);
    storeSessionListQuery(query);
    try {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    } catch {
      // Some embedded browsers refuse history changes; the list still works.
    }
  }, [filters, ready]);

  // Search waits until typing pauses.
  useEffect(() => {
    if (!ready || searchInput === filters.search) return;
    const timer = window.setTimeout(() => {
      setSelectedSessionIds(new Set());
      setSuccess(null);
      setFilters((current) => ({ ...current, search: searchInput, page: 1 }));
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput, filters.search, ready]);

  function updateFilter(key: keyof SessionListFilters, value: string | number) {
    setSelectedSessionIds(new Set());
    setSuccess(null);
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === "page" ? Number(value) : 1
    }));
  }

  function sortBy(field: SortField) {
    setSelectedSessionIds(new Set());
    setSuccess(null);
    setFilters((current) => ({
      ...current,
      sort: field,
      direction:
        current.sort === field && current.direction === "desc" ? "asc" : "desc",
      page: 1
    }));
  }

  function ariaSort(field: SortField) {
    if (filters.sort !== field) return "none" as const;
    return filters.direction === "asc" ? "ascending" as const : "descending" as const;
  }

  const deletablePageSessionIds = useMemo(
    () =>
      data?.sessions
        .filter((session) => canDeleteSession(session.session_status))
        .map((session) => session.session_public_id) ?? [],
    [data]
  );
  const allDeletablePageSessionsSelected =
    deletablePageSessionIds.length > 0 &&
    deletablePageSessionIds.every((sessionPublicId) => selectedSessionIds.has(sessionPublicId));

  function toggleSession(sessionPublicId: string) {
    setSuccess(null);
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(sessionPublicId)) next.delete(sessionPublicId);
      else next.add(sessionPublicId);
      return next;
    });
  }

  function toggleAllDeletablePageSessions() {
    setSuccess(null);
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      if (allDeletablePageSessionsSelected) {
        for (const sessionPublicId of deletablePageSessionIds) next.delete(sessionPublicId);
      } else {
        for (const sessionPublicId of deletablePageSessionIds) next.add(sessionPublicId);
      }
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-line bg-white p-4 shadow-soft">
        <div className="grid gap-3 md:grid-cols-5">
          <label className="flex flex-col gap-2 text-sm font-medium text-ink md:col-span-2">
            Student user ID or name
            <div className="flex items-center rounded-md border border-line bg-white px-3">
              <Search className="h-4 w-4 text-muted" aria-hidden="true" />
              <input
                className="h-10 min-w-0 flex-1 border-0 bg-transparent px-2 text-sm outline-none"
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search by student ID or name"
                type="search"
                value={searchInput}
              />
            </div>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Assessment
            <select
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
              onChange={(event) => updateFilter("assessment_public_id", event.target.value)}
              value={filters.assessment_public_id}
            >
              <option value="">All assessments</option>
              {(assessmentOptions ?? []).map((assessment) => (
                <option
                  key={assessment.assessment_public_id}
                  value={assessment.assessment_public_id}
                >
                  {assessment.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Status
            <select
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
              onChange={(event) => updateFilter("status", event.target.value)}
              value={filters.status}
            >
              <option value="">All statuses</option>
              {SESSION_LIST_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {label(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Current phase
            <select
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
              onChange={(event) => updateFilter("phase", event.target.value)}
              value={filters.phase}
            >
              <option value="">All phases</option>
              {SESSION_LIST_PHASES.map((phase) => (
                <option key={phase} value={phase}>
                  {teacherPhaseLabel(phase)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Needs review
            <select
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
              onChange={(event) => updateFilter("needs_review", event.target.value)}
              value={filters.needs_review}
            >
              <option value="">All</option>
              <option value="true">Needs review</option>
              <option value="false">No review flag</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Page size
            <select
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
              onChange={(event) => updateFilter("page_size", Number(event.target.value))}
              value={filters.page_size}
            >
              {SESSION_LIST_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error ? <ErrorState error={error} /> : null}
      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
          {success}
        </p>
      ) : null}
      {loading && !data ? <LoadingState label="Loading student sessions" /> : null}
      <p aria-live="polite" className={loading && data ? "flex items-center gap-2 text-sm text-muted" : "sr-only"}>
        {loading && data ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Updating the list...</> : ""}
      </p>

      {data && data.sessions.length === 0 ? (
        hasActiveSessionListFilters(filters) ? (
          <EmptyState title="No sessions match these filters">
            Change or clear the search and filters to see more sessions.
          </EmptyState>
        ) : (
          <EmptyState title="No sessions yet">
            Student sessions appear here once students start a mini test.
          </EmptyState>
        )
      ) : null}

      {data && data.sessions.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-line bg-white shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-ink">
                {selectedSessionIds.size} selected
              </p>
              <p className="mt-1 text-xs text-muted">
                Only completed or exited sessions can be deleted.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedSessionIds.size > 0 ? (
                <button
                  className="h-9 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-accent"
                  onClick={() => setSelectedSessionIds(new Set())}
                  type="button"
                >
                  Clear selection
                </button>
              ) : null}
              <SessionBatchDeletionControl
                onDeleted={(summary) => {
                  setSelectedSessionIds(new Set());
                  setSuccess(
                    `${summary.deleted_counts.assessment_session_count} student ${summary.deleted_counts.assessment_session_count === 1 ? "session" : "sessions"} deleted.`
                  );
                  void load();
                }}
                sessionPublicIds={[...selectedSessionIds].sort()}
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-line bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="w-12 px-4 py-3">
                    <input
                      aria-label="Select all deletable sessions on this page"
                      checked={allDeletablePageSessionsSelected}
                      className="h-4 w-4 rounded border-line accent-emerald-700"
                      disabled={deletablePageSessionIds.length === 0}
                      onChange={toggleAllDeletablePageSessions}
                      type="checkbox"
                    />
                  </th>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Assessment</th>
                  <th className="px-4 py-3">Attempt</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Phase</th>
                  <th className="px-4 py-3">Automation</th>
                  <th className="px-4 py-3">Topics with questions submitted</th>
                  <th className="px-4 py-3" aria-sort={ariaSort("last_activity_at")}>
                    <button
                      className="inline-flex items-center gap-1 font-semibold"
                      onClick={() => sortBy("last_activity_at")}
                      type="button"
                    >
                      Last activity
                      <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </th>
                  <th className="px-4 py-3" aria-sort={ariaSort("completed_at")}>
                    <button
                      className="inline-flex items-center gap-1 font-semibold"
                      onClick={() => sortBy("completed_at")}
                      type="button"
                    >
                      Completed
                      <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </th>
                  <th className="px-4 py-3">Review</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.sessions.map((session) => (
                  <tr className="align-top" key={session.session_public_id}>
                    <td className="px-4 py-3">
                      <input
                        aria-label={`Select session for ${session.student_user_id}`}
                        checked={selectedSessionIds.has(session.session_public_id)}
                        className="h-4 w-4 rounded border-line accent-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={!canDeleteSession(session.session_status)}
                        onChange={() => toggleSession(session.session_public_id)}
                        title={
                          canDeleteSession(session.session_status)
                            ? "Select session"
                            : "Only completed or exited sessions can be deleted"
                        }
                        type="checkbox"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink">{session.student_user_id}</p>
                      <p className="text-xs text-muted">
                        {session.student_display_name ?? "No display name"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="max-w-64 font-medium text-ink">{session.assessment_title}</p>
                    </td>
                    <td className="px-4 py-3">{session.attempt_number}</td>
                    <td className="px-4 py-3">
                      <StatusPill value={session.session_status} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill value={teacherPhaseLabel(session.current_phase, session.formative_conversation_status)} tone="warn" />
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill value={session.automation_state} tone={session.automation_state === "automatic_failed" ? "bad" : "neutral"} />
                      <p className="mt-1 text-xs text-muted">
                        {session.workflow_mode_snapshot === "automatic" ? "Automatic" : "Manual review"}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        Answers: {label(session.response_collection_mode_snapshot)}
                      </p>
                      {session.failed_workflow_job_count > 0 || session.pending_workflow_job_count > 0 ? (
                        <p className="mt-1 text-xs text-muted">
                          Background steps: {session.pending_workflow_job_count} waiting, {session.failed_workflow_job_count} failed
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">
                        {session.completed_concept_unit_count} / {session.concept_unit_count}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {session.item_response_count} item responses
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        Current: {session.current_concept_unit_title ?? "Not recorded"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <time title={session.last_activity_at ?? undefined}>
                        {formatDate(session.last_activity_at)}
                      </time>
                    </td>
                    <td className="px-4 py-3">
                      <time title={session.completed_at ?? undefined}>
                        {formatDate(session.completed_at)}
                      </time>
                    </td>
                    <td className="px-4 py-3">
                      {session.needs_review ? (
                        <div>
                          <StatusPill value="needs_review" tone="bad" />
                          <p className="mt-1 max-w-48 text-xs text-muted">
                            {plainReviewReason(session.needs_review_reason)}
                          </p>
                        </div>
                      ) : (
                        <StatusPill value="not_flagged" tone="good" />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-xs font-semibold text-ink hover:border-accent"
                        href={`/teacher/sessions/${session.session_public_id}`}
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        View session
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
            <p>
              Page {data.pagination.page} of {data.pagination.total_pages} ·{" "}
              {data.pagination.total} sessions
            </p>
            <div className="flex gap-2">
              <button
                className="h-9 rounded-md border border-line bg-white px-3 font-semibold text-ink disabled:opacity-50"
                disabled={filters.page <= 1}
                onClick={() => updateFilter("page", filters.page - 1)}
                type="button"
              >
                Previous
              </button>
              <button
                className="h-9 rounded-md border border-line bg-white px-3 font-semibold text-ink disabled:opacity-50"
                disabled={filters.page >= data.pagination.total_pages}
                onClick={() => updateFilter("page", filters.page + 1)}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
