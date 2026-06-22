"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, Eye, Search } from "lucide-react";
import { errorFromUnknown, fetchTeacherSessions } from "./api";
import type { SessionListResponse, StructuredApiError } from "./types";
import { EmptyState, ErrorState, formatDate, LoadingState, StatusPill } from "./ui";

const statuses = ["not_started", "active", "paused", "completed", "student_exited", "needs_review"];
const phases = [
  "not_started",
  "session_started",
  "concept_unit_intro",
  "initial_item_administration",
  "missing_evidence_repair",
  "initial_concept_unit_completed",
  "profiling_pending",
  "profiling_completed",
  "planning_pending",
  "planning_completed",
  "followup_active",
  "followup_profile_update_pending",
  "followup_planning_update_pending",
  "followup_stopped",
  "between_concept_units",
  "session_completed",
  "student_exited",
  "needs_review"
];

type SortField = "started_at" | "last_activity_at" | "completed_at";

function cleanParams(filters: {
  search: string;
  assessment_public_id: string;
  status: string;
  phase: string;
  needs_review: string;
  sort: SortField;
  direction: "asc" | "desc";
  page: number;
  page_size: number;
}) {
  return {
    search: filters.search,
    assessment_public_id: filters.assessment_public_id,
    status: filters.status,
    phase: filters.phase,
    needs_review:
      filters.needs_review === "" ? undefined : filters.needs_review === "true",
    sort: filters.sort,
    direction: filters.direction,
    page: filters.page,
    page_size: filters.page_size
  };
}

export function TeacherSessionListClient() {
  const [filters, setFilters] = useState({
    search: "",
    assessment_public_id: "",
    status: "",
    phase: "",
    needs_review: "",
    sort: "last_activity_at" as SortField,
    direction: "desc" as "asc" | "desc",
    page: 1,
    page_size: 25
  });
  const [data, setData] = useState<SessionListResponse | null>(null);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchTeacherSessions(cleanParams(filters));
      setData(result);
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateFilter(key: keyof typeof filters, value: string | number) {
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === "page" ? Number(value) : 1
    }));
  }

  function sortBy(field: SortField) {
    setFilters((current) => ({
      ...current,
      sort: field,
      direction:
        current.sort === field && current.direction === "desc" ? "asc" : "desc",
      page: 1
    }));
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-line bg-white p-4 shadow-soft">
        <div className="grid gap-3 md:grid-cols-5">
          <label className="flex flex-col gap-2 text-sm font-medium text-ink md:col-span-2">
            Student user_id
            <div className="flex items-center rounded-md border border-line bg-white px-3">
              <Search className="h-4 w-4 text-muted" aria-hidden="true" />
              <input
                className="h-10 min-w-0 flex-1 border-0 bg-transparent px-2 text-sm outline-none"
                onChange={(event) => updateFilter("search", event.target.value)}
                placeholder="Search by user_id"
                value={filters.search}
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
              {data?.filters.assessments.map((assessment) => (
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
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status.replace(/_/g, " ")}
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
              {phases.map((phase) => (
                <option key={phase} value={phase}>
                  {phase.replace(/_/g, " ")}
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
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error ? <ErrorState error={error} /> : null}
      {loading ? <LoadingState label="Loading student sessions" /> : null}

      {!loading && data && data.sessions.length === 0 ? (
        <EmptyState title="No sessions found">
          Change the filters or create a development review fixture with
          <code className="mx-1 rounded bg-slate-100 px-1">npm run demo:teacher-review</code>.
        </EmptyState>
      ) : null}

      {!loading && data && data.sessions.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-line bg-white shadow-soft">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-line bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Assessment</th>
                  <th className="px-4 py-3">Attempt</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Phase</th>
                  <th className="px-4 py-3">Automation</th>
                  <th className="px-4 py-3">Concept progress</th>
                  <th className="px-4 py-3">
                    <button
                      className="inline-flex items-center gap-1 font-semibold"
                      onClick={() => sortBy("last_activity_at")}
                      type="button"
                    >
                      Last activity
                      <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </th>
                  <th className="px-4 py-3">
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
                      <p className="font-semibold text-ink">{session.student_user_id}</p>
                      <p className="text-xs text-muted">
                        {session.student_display_name ?? "No display name"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="max-w-64 font-medium text-ink">{session.assessment_title}</p>
                      <p className="mt-1 text-xs text-muted">{session.assessment_public_id}</p>
                    </td>
                    <td className="px-4 py-3">{session.attempt_number}</td>
                    <td className="px-4 py-3">
                      <StatusPill value={session.session_status} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill value={session.current_phase} tone="warn" />
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill value={session.automation_state} tone={session.automation_state === "automatic_failed" ? "bad" : "neutral"} />
                      <p className="mt-1 text-xs text-muted">
                        {session.workflow_mode_snapshot === "automatic" ? "Automatic" : "Manual review"}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        Response collection:{" "}
                        {session.response_collection_mode_snapshot === "llm_assisted"
                          ? "LLM-assisted"
                          : "Deterministic"}
                      </p>
                      {session.failed_workflow_job_count > 0 || session.pending_workflow_job_count > 0 ? (
                        <p className="mt-1 text-xs text-muted">
                          {session.pending_workflow_job_count} pending, {session.failed_workflow_job_count} failed
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
                            {session.needs_review_reason}
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
