"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, Eye, Search, Upload, UserPlus } from "lucide-react";
import { errorFromUnknown, fetchStudents } from "./api";
import type { StructuredApiError, StudentListResponse } from "./types";
import { EmptyPanel, ErrorPanel, formatDate, LoadingPanel, StatusPill } from "./ui";

type SortField = "user_id" | "created_at" | "updated_at" | "last_login_at" | "password_changed_at";

export function StudentListClient() {
  const [filters, setFilters] = useState({
    search: "",
    account_status: "",
    has_sessions: "",
    sort: "user_id" as SortField,
    direction: "asc" as "asc" | "desc",
    page: 1,
    page_size: 25
  });
  const [data, setData] = useState<StudentListResponse | null>(null);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setData(await fetchStudents(filters));
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
      direction: current.sort === field && current.direction === "asc" ? "desc" : "asc",
      page: 1
    }));
  }

  const pagination = data?.pagination;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-line bg-white p-4 shadow-soft">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="grid flex-1 gap-3 md:grid-cols-4">
            <label className="flex flex-col gap-2 text-sm font-medium text-ink md:col-span-2">
              Search
              <div className="flex items-center rounded-md border border-line bg-white px-3">
                <Search className="h-4 w-4 text-muted" aria-hidden="true" />
                <input
                  className="h-10 min-w-0 flex-1 border-0 bg-transparent px-2 text-sm outline-none"
                  onChange={(event) => updateFilter("search", event.target.value)}
                  placeholder="user_id or display name"
                  value={filters.search}
                />
              </div>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-ink">
              Status
              <select
                className="h-10 rounded-md border border-line bg-white px-3 text-sm"
                onChange={(event) => updateFilter("account_status", event.target.value)}
                value={filters.account_status}
              >
                <option value="">All accounts</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-ink">
              Sessions
              <select
                className="h-10 rounded-md border border-line bg-white px-3 text-sm"
                onChange={(event) => updateFilter("has_sessions", event.target.value)}
                value={filters.has_sessions}
              >
                <option value="">Any</option>
                <option value="true">Has sessions</option>
                <option value="false">No sessions</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent"
              href="/teacher/students/import"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Import roster
            </Link>
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white hover:bg-[#176350]"
              href="/teacher/students/new"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Create student
            </Link>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
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

      <ErrorPanel error={error} />
      {loading ? <LoadingPanel label="Loading student accounts" /> : null}

      {!loading && data && data.students.length === 0 ? (
        <EmptyPanel title="No student accounts found">
          Create one student manually or import a roster CSV.
        </EmptyPanel>
      ) : null}

      {!loading && data && data.students.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-line bg-white shadow-soft">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-line bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">
                    <button
                      className="inline-flex items-center gap-1 font-semibold"
                      onClick={() => sortBy("user_id")}
                      type="button"
                    >
                      user_id
                      <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </th>
                  <th className="px-4 py-3">Display name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Password</th>
                  <th className="px-4 py-3">Sessions</th>
                  <th className="px-4 py-3">Completed</th>
                  <th className="px-4 py-3">Outcomes</th>
                  <th className="px-4 py-3">
                    <button
                      className="inline-flex items-center gap-1 font-semibold"
                      onClick={() => sortBy("last_login_at")}
                      type="button"
                    >
                      Last login
                      <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.students.map((student) => (
                  <tr className="align-top" key={student.user_id}>
                    <td className="px-4 py-3 font-semibold text-ink">{student.user_id}</td>
                    <td className="px-4 py-3 text-muted">{student.display_name ?? "No display name"}</td>
                    <td className="px-4 py-3 text-muted">{student.email ?? ""}</td>
                    <td className="px-4 py-3">
                      <StatusPill value={student.account_status} />
                    </td>
                    <td className="px-4 py-3">
                      {student.must_change_password ? (
                        <StatusPill value="temporary_pending" />
                      ) : (
                        formatDate(student.password_changed_at)
                      )}
                    </td>
                    <td className="px-4 py-3">{student.assessment_session_count}</td>
                    <td className="px-4 py-3">{student.completed_session_count}</td>
                    <td className="px-4 py-3">{student.summative_outcome_count}</td>
                    <td className="px-4 py-3">{formatDate(student.last_login_at)}</td>
                    <td className="px-4 py-3">
                      <Link
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-accent"
                        href={`/teacher/students/${encodeURIComponent(student.user_id)}`}
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {pagination ? (
        <section className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>
            Page {pagination.page} of {pagination.total_pages}. {pagination.total} students.
          </span>
          <div className="flex gap-2">
            <button
              className="h-9 rounded-md border border-line bg-white px-3 font-semibold text-ink disabled:opacity-50"
              disabled={pagination.page <= 1 || loading}
              onClick={() => updateFilter("page", Math.max(1, pagination.page - 1))}
              type="button"
            >
              Previous
            </button>
            <button
              className="h-9 rounded-md border border-line bg-white px-3 font-semibold text-ink disabled:opacity-50"
              disabled={pagination.page >= pagination.total_pages || loading}
              onClick={() => updateFilter("page", pagination.page + 1)}
              type="button"
            >
              Next
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
