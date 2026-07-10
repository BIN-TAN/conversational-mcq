"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Archive, Eye, Plus, RefreshCw } from "lucide-react";
import { apiRequest, errorFromUnknown } from "./api";
import type { AssessmentSummary, StructuredApiError } from "./types";
import {
  Button,
  ErrorPanel,
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

export function AssessmentListClient() {
  const [assessments, setAssessments] = useState<AssessmentSummary[]>([]);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="content"
        title="Assessments"
        description="List, create, publish, and archive teacher-owned assessments."
        actions={
          <>
            <PrimaryLink href="/teacher/content/assessments/new">
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              New assessment
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

      {isLoading ? <LoadingRow label="Loading assessments" /> : null}

      {!isLoading && assessments.length === 0 ? (
        <section className="rounded-lg border border-line bg-white p-6 text-sm text-muted">
          No assessments have been created yet.
        </section>
      ) : null}

      {!isLoading && assessments.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-line bg-white shadow-soft">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead className="border-b border-line bg-[#fbfcf8] text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Title</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Public ID</th>
                  <th className="px-4 py-3 font-semibold">Topics</th>
                  <th className="px-4 py-3 font-semibold">Updated</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {assessments.map((assessment) => (
                  <tr className="border-b border-line last:border-0" key={assessment.assessment_public_id}>
                    <td className="px-4 py-4">
                      <p className="font-semibold text-ink">{assessment.title}</p>
                      {assessment.description ? (
                        <p className="mt-1 line-clamp-2 text-muted">{assessment.description}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge status={assessment.status} />
                    </td>
                    <td className="px-4 py-4 font-mono text-xs text-muted">
                      {assessment.assessment_public_id}
                    </td>
                    <td className="px-4 py-4 text-ink">{assessment.concept_unit_count ?? 0}</td>
                    <td className="px-4 py-4 text-muted">{formatDate(assessment.updated_at)}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold text-ink transition hover:border-accent"
                          href={`/teacher/content/assessments/${assessment.assessment_public_id}`}
                        >
                          <Eye className="h-4 w-4" aria-hidden="true" />
                          View
                        </Link>
                        <Button
                          disabled={busyId === assessment.assessment_public_id || assessment.status === "archived"}
                          onClick={() => archiveAssessment(assessment)}
                          type="button"
                          variant="danger"
                        >
                          <Archive className="h-4 w-4" aria-hidden="true" />
                          Archive
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
