"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ChevronDown, ChevronRight, Eye, Plus, RefreshCw, RotateCcw, Search } from "lucide-react";
import { apiRequest, errorFromUnknown } from "./api";
import type { AssessmentSummary, StructuredApiError } from "./types";
import {
  Button,
  ErrorPanel,
  Field,
  LoadingRow,
  PageHeader,
  PrimaryLink,
  StatusBadge,
  SuccessPanel,
  formatDate
} from "./ui";

type AssessmentListResponse = {
  assessments: AssessmentSummary[];
};

type StatusFilter = "active" | "draft" | "published" | "closed" | "archived" | "all";
type SortMode = "updated_desc" | "title_asc" | "release_asc" | "folder_order";

function folderName(assessment: AssessmentSummary) {
  return assessment.folder_label?.trim() || "Unfiled";
}

function isClosed(assessment: AssessmentSummary) {
  return Boolean(assessment.close_at && new Date(assessment.close_at) < new Date());
}

function statusMatches(assessment: AssessmentSummary, statusFilter: StatusFilter) {
  if (statusFilter === "all") {
    return true;
  }

  if (statusFilter === "active") {
    return assessment.status !== "archived";
  }

  if (statusFilter === "closed") {
    return assessment.status !== "archived" && isClosed(assessment);
  }

  return assessment.status === statusFilter;
}

function sortAssessments(assessments: AssessmentSummary[], sortMode: SortMode) {
  const copy = [...assessments];

  if (sortMode === "title_asc") {
    return copy.sort((left, right) => left.title.localeCompare(right.title));
  }

  if (sortMode === "release_asc") {
    return copy.sort((left, right) => {
      const leftTime = left.release_at ? new Date(left.release_at).getTime() : Number.MAX_SAFE_INTEGER;
      const rightTime = right.release_at ? new Date(right.release_at).getTime() : Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime || left.title.localeCompare(right.title);
    });
  }

  if (sortMode === "folder_order") {
    return copy.sort((left, right) => {
      return (
        left.folder_order_index - right.folder_order_index ||
        folderName(left).localeCompare(folderName(right)) ||
        left.assessment_order_index - right.assessment_order_index ||
        left.title.localeCompare(right.title)
      );
    });
  }

  return copy.sort(
    (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
  );
}

export function AssessmentListClient() {
  const [assessments, setAssessments] = useState<AssessmentSummary[]>([]);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [folderFilter, setFolderFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("folder_order");
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});

  async function loadAssessments() {
    setIsLoading(true);
    setError(null);

    try {
      const data = await apiRequest<AssessmentListResponse>("/api/teacher/assessments");
      setAssessments(data.assessments);
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadAssessments();
  }, []);

  async function archiveAssessment(assessment: AssessmentSummary) {
    setBusyId(assessment.assessment_public_id);
    setError(null);
    setSuccess(null);

    try {
      await apiRequest(`/api/teacher/assessments/${assessment.assessment_public_id}/archive`, {
        method: "POST"
      });
      setSuccess(`Archived ${assessment.title}.`);
      await loadAssessments();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function restoreAssessment(assessment: AssessmentSummary) {
    setBusyId(assessment.assessment_public_id);
    setError(null);
    setSuccess(null);

    try {
      await apiRequest(`/api/teacher/assessments/${assessment.assessment_public_id}/restore`, {
        method: "POST"
      });
      setSuccess(`Restored ${assessment.title}.`);
      await loadAssessments();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyId(null);
    }
  }

  const folderOptions = useMemo(() => {
    return [
      "all",
      ...[...new Set(assessments.map(folderName))]
        .sort((left, right) => {
          if (left === "Unfiled") return 1;
          if (right === "Unfiled") return -1;
          return left.localeCompare(right);
        })
    ];
  }, [assessments]);

  const filteredAssessments = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    const filtered = assessments.filter((assessment) => {
      const searchable = [
        assessment.title,
        assessment.assessment_public_id,
        assessment.diagnostic_focus ?? "",
        folderName(assessment)
      ]
        .join(" ")
        .toLowerCase();

      return (
        statusMatches(assessment, statusFilter) &&
        (folderFilter === "all" || folderName(assessment) === folderFilter) &&
        (!normalizedSearch || searchable.includes(normalizedSearch))
      );
    });

    return sortAssessments(filtered, sortMode);
  }, [assessments, folderFilter, searchText, sortMode, statusFilter]);

  const groupedAssessments = filteredAssessments.reduce<
    Array<{ folder: string; assessments: AssessmentSummary[] }>
  >((groups, assessment) => {
    const folder = folderName(assessment);
    const existing = groups.find((group) => group.folder === folder);

    if (existing) {
      existing.assessments.push(assessment);
    } else {
      groups.push({ folder, assessments: [assessment] });
    }

    return groups;
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="content"
        title="Mini tests"
        description="Create and organize assessment mini tests by folder, week, or module."
        actions={
          <>
            <PrimaryLink href="/teacher/content/assessments/new">
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              New mini test
            </PrimaryLink>
            <Button disabled={isLoading} onClick={loadAssessments} type="button" variant="secondary">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </Button>
          </>
        }
      />

      <ErrorPanel error={error} />
      <SuccessPanel message={success} />

      <section className="rounded-lg border border-line bg-white p-4 shadow-soft">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <Field label="Search">
            <div className="flex items-center gap-2 rounded-md border border-line px-3 py-2">
              <Search className="h-4 w-4 text-muted" aria-hidden="true" />
              <input
                className="min-w-0 flex-1 outline-none"
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Name, ID, focus, folder"
                value={searchText}
              />
            </div>
          </Field>
          <Field label="Status">
            <select
              className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              value={statusFilter}
            >
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="closed">Closed</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </select>
          </Field>
          <Field label="Folder">
            <select
              className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
              onChange={(event) => setFolderFilter(event.target.value)}
              value={folderFilter}
            >
              {folderOptions.map((folder) => (
                <option key={folder} value={folder}>
                  {folder === "all" ? "All folders" : folder}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sort">
            <select
              className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              value={sortMode}
            >
              <option value="folder_order">Folder order</option>
              <option value="updated_desc">Recently updated</option>
              <option value="title_asc">Title</option>
              <option value="release_asc">Release date</option>
            </select>
          </Field>
        </div>
      </section>

      {isLoading ? <LoadingRow label="Loading assessments" /> : null}

      {!isLoading && assessments.length === 0 ? (
        <section className="rounded-lg border border-line bg-white p-6 text-sm text-muted">
          No assessments have been created yet.
        </section>
      ) : null}

      {!isLoading && assessments.length > 0 && filteredAssessments.length === 0 ? (
        <section className="rounded-lg border border-line bg-white p-6 text-sm text-muted">
          No mini tests match the current filters.
        </section>
      ) : null}

      {!isLoading && filteredAssessments.length > 0 ? (
        <div className="space-y-6">
          {groupedAssessments.map((group) => {
            const collapsed = Boolean(collapsedFolders[group.folder]);

            return (
              <section
                className="overflow-hidden rounded-lg border border-line bg-white shadow-soft"
                key={group.folder}
              >
                <button
                  className="flex w-full items-center justify-between border-b border-line bg-[#fbfcf8] px-4 py-3 text-left"
                  onClick={() =>
                    setCollapsedFolders((previous) => ({
                      ...previous,
                      [group.folder]: !previous[group.folder]
                    }))
                  }
                  type="button"
                >
                  <span className="flex items-center gap-2">
                    {collapsed ? (
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span className="font-semibold text-ink">{group.folder}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {group.assessments.length} mini test{group.assessments.length === 1 ? "" : "s"}
                  </span>
                </button>
                {collapsed ? null : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                      <thead className="border-b border-line bg-[#fbfcf8] text-xs uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Mini test</th>
                          <th className="px-4 py-3 font-semibold">Status</th>
                          <th className="px-4 py-3 font-semibold">Focus</th>
                          <th className="px-4 py-3 font-semibold">Items</th>
                          <th className="px-4 py-3 font-semibold">Sessions</th>
                          <th className="px-4 py-3 font-semibold">Updated</th>
                          <th className="px-4 py-3 font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.assessments.map((assessment) => (
                          <tr className="border-b border-line last:border-0" key={assessment.assessment_public_id}>
                            <td className="px-4 py-4">
                              <p className="font-semibold text-ink">{assessment.title}</p>
                              <p className="mt-1 font-mono text-xs text-muted">{assessment.assessment_public_id}</p>
                            </td>
                            <td className="px-4 py-4">
                              <StatusBadge status={assessment.status} />
                              {isClosed(assessment) ? (
                                <p className="mt-1 text-xs font-semibold text-muted">Closed</p>
                              ) : null}
                            </td>
                            <td className="px-4 py-4">
                              {assessment.diagnostic_focus ? (
                                <p className="line-clamp-2 text-muted">{assessment.diagnostic_focus}</p>
                              ) : (
                                <p className="text-muted">No diagnostic focus recorded.</p>
                              )}
                            </td>
                            <td className="px-4 py-4 text-muted">{assessment.item_count ?? 0}</td>
                            <td className="px-4 py-4 text-muted">{assessment.assessment_session_count ?? 0}</td>
                            <td className="px-4 py-4 text-muted">{formatDate(assessment.updated_at)}</td>
                            <td className="px-4 py-4">
                              <div className="flex flex-wrap gap-2">
                                <Link
                                  className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold text-ink transition hover:border-accent"
                                  href={`/teacher/content/assessments/${assessment.assessment_public_id}`}
                                >
                                  <Eye className="h-4 w-4" aria-hidden="true" />
                                  Open builder
                                </Link>
                                {assessment.status === "archived" ? (
                                  <Button
                                    disabled={busyId === assessment.assessment_public_id}
                                    onClick={() => restoreAssessment(assessment)}
                                    type="button"
                                    variant="secondary"
                                  >
                                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                                    Restore
                                  </Button>
                                ) : (
                                  <Button
                                    disabled={busyId === assessment.assessment_public_id}
                                    onClick={() => archiveAssessment(assessment)}
                                    type="button"
                                    variant="danger"
                                  >
                                    <Archive className="h-4 w-4" aria-hidden="true" />
                                    Archive
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
