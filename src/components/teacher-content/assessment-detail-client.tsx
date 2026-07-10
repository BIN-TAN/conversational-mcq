"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Archive, CheckCircle, Download, Plus, RefreshCw, RotateCcw, Save } from "lucide-react";
import { apiRequest, errorFromUnknown } from "./api";
import type { AssessmentDetail, StructuredApiError } from "./types";
import {
  Button,
  ContentStateBadge,
  ErrorPanel,
  Field,
  LoadingRow,
  PageHeader,
  PrimaryLink,
  StatusBadge,
  SuccessPanel,
  formatDate
} from "./ui";

type AssessmentDetailResponse = {
  assessment: AssessmentDetail;
};

type PublishAssessmentResponse = {
  assessment: AssessmentDetail;
  publishable_concept_unit_public_ids: string[];
};

export function AssessmentDetailClient({
  assessmentPublicId
}: {
  assessmentPublicId: string;
}) {
  const [assessment, setAssessment] = useState<AssessmentDetail | null>(null);
  const [title, setTitle] = useState("");
  const [diagnosticFocus, setDiagnosticFocus] = useState("");
  const [folderLabel, setFolderLabel] = useState("");
  const [releaseAt, setReleaseAt] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAvailabilitySubmitting, setIsAvailabilitySubmitting] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadAssessment = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await apiRequest<AssessmentDetailResponse>(
        `/api/teacher/assessments/${assessmentPublicId}`
      );
      setAssessment(data.assessment);
      setTitle(data.assessment.title);
      setDiagnosticFocus(data.assessment.diagnostic_focus ?? data.assessment.description ?? "");
      setFolderLabel(data.assessment.folder_label ?? "");
      setReleaseAt(data.assessment.release_at_course_time_input);
      setCloseAt(data.assessment.close_at_course_time_input);
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsLoading(false);
    }
  }, [assessmentPublicId]);

  useEffect(() => {
    void loadAssessment();
  }, [loadAssessment]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("item_saved") === "1") {
      setSuccess("MCQ item saved.");
    }
  }, []);

  async function saveAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      const data = await apiRequest<AssessmentDetailResponse>(
        `/api/teacher/assessments/${assessmentPublicId}`,
        {
          method: "PUT",
          body: JSON.stringify({
            title,
            diagnostic_focus: diagnosticFocus.trim() ? diagnosticFocus : null,
            folder_label: folderLabel.trim() ? folderLabel : null
          })
        }
      );
      setAssessment((previous) =>
        previous
          ? {
              ...previous,
              ...data.assessment,
              concept_units: previous.concept_units
            }
          : previous
      );
      setSuccess("Mini test details saved.");
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsAvailabilitySubmitting(true);

    try {
      const data = await apiRequest<AssessmentDetailResponse>(
        `/api/teacher/assessments/${assessmentPublicId}`,
        {
          method: "PUT",
          body: JSON.stringify({
            release_at_course_time: releaseAt || null,
            close_at_course_time: closeAt || null
          })
        }
      );
      setAssessment((previous) =>
        previous
          ? {
              ...previous,
              ...data.assessment,
              concept_units: previous.concept_units
            }
          : previous
      );
      setReleaseAt(data.assessment.release_at_course_time_input);
      setCloseAt(data.assessment.close_at_course_time_input);
      setSuccess("Availability saved.");
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsAvailabilitySubmitting(false);
    }
  }

  async function archiveAssessment() {
    setBusyAction("archive");
    setError(null);
    setSuccess(null);

    try {
      await apiRequest(`/api/teacher/assessments/${assessmentPublicId}/archive`, {
        method: "POST"
      });
      setSuccess("Assessment archived.");
      await loadAssessment();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function publishAssessment() {
    setBusyAction("publish");
    setError(null);
    setSuccess(null);

    try {
      const data = await apiRequest<PublishAssessmentResponse>(
        `/api/teacher/assessments/${assessmentPublicId}/publish`,
        { method: "POST" }
      );
      setSuccess(
        `Assessment published. Publishable topics: ${data.publishable_concept_unit_public_ids.join(", ")}`
      );
      await loadAssessment();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function returnAssessmentToDraft() {
    const confirmed = window.confirm(
      "This assessment can still be returned to draft because no student session has started."
    );

    if (!confirmed) {
      return;
    }

    setBusyAction("return-to-draft");
    setError(null);
    setSuccess(null);

    try {
      await apiRequest(`/api/teacher/assessments/${assessmentPublicId}/return-to-draft`, {
        method: "POST"
      });
      setSuccess("Assessment returned to draft.");
      await loadAssessment();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyAction(null);
    }
  }

  const isDraftEditable = assessment?.content_state === "draft_editable";
  const isPublishedUnused = assessment?.content_state === "published_unused";
  const isLocked = Boolean(assessment?.is_content_locked);
  const isArchived = assessment?.status === "archived";
  const isReadOnly = Boolean(assessment && !isDraftEditable);
  const canReturnToDraft = Boolean(assessment && isPublishedUnused && !assessment.has_student_sessions);
  const miniTestItems = assessment?.mini_test_items ?? [];
  const includedMiniTestItems = miniTestItems.filter(
    (item) => item.status !== "archived" && item.included_in_published_set
  );
  const minimumRequiredItems = 3;
  const addItemHref = `/teacher/content/assessments/${assessmentPublicId}/items/new`;

  function optionCount(value: unknown) {
    return Array.isArray(value) ? value.length : 0;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="mini test"
        title={assessment?.title ?? "Assessment detail"}
        description="Build the MCQ items students will answer in the initial chat administration."
        actions={
          <>
            {isDraftEditable ? (
              <PrimaryLink href={addItemHref}>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                Add MCQ item
              </PrimaryLink>
            ) : null}
            <Button disabled={isLoading} onClick={loadAssessment} type="button" variant="secondary">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </Button>
            <a
              className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent"
              href={`/api/teacher/data-explorer/assessments/${encodeURIComponent(assessmentPublicId)}/csv`}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download assessment CSV
            </a>
          </>
        }
      />

      <ErrorPanel error={error} />
      <SuccessPanel message={success} />

      {isLoading ? <LoadingRow label="Loading assessment" /> : null}

      {assessment ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-6">
            <form className="rounded-lg border border-line bg-white p-5 shadow-soft" onSubmit={saveAssessment}>
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={assessment.status} />
                <ContentStateBadge state={assessment.content_state} />
                <span className="font-mono text-xs text-muted">{assessment.assessment_public_id}</span>
              </div>
              {isReadOnly ? (
                <p className="mt-4 rounded-md border border-line bg-slate-50 p-3 text-sm leading-6 text-muted">
                  {isLocked
                    ? "Student data collection has started. The administered content is now read-only to preserve research consistency."
                    : "This assessment can still be returned to draft because no student session has started."}
                </p>
              ) : null}
              <div className="mt-5 grid gap-4">
                <Field label="Assessment name">
                  <input
                    className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    disabled={isReadOnly}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    value={title}
                  />
                </Field>
                <Field
                  label="Diagnostic focus"
                  hint="What misconception, cognitive process, or diagnostic framework does this assessment target? Students do not see this note."
                >
                  <textarea
                    className="min-h-28 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    disabled={isReadOnly}
                    onChange={(event) => setDiagnosticFocus(event.target.value)}
                    value={diagnosticFocus}
                  />
                </Field>
                <Field label="Folder / week / module">
                  <input
                    className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    disabled={isReadOnly}
                    onChange={(event) => setFolderLabel(event.target.value)}
                    placeholder="e.g. Week 3"
                    value={folderLabel}
                  />
                </Field>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button disabled={isReadOnly || isSubmitting} type="submit">
                  <Save className="h-4 w-4" aria-hidden="true" />
                  {isSubmitting ? "Saving" : "Save mini test"}
                </Button>
                <Button
                  disabled={isLocked || isArchived || busyAction === "publish"}
                  onClick={publishAssessment}
                  type="button"
                  variant="secondary"
                >
                  <CheckCircle className="h-4 w-4" aria-hidden="true" />
                  Publish mini test
                </Button>
                {canReturnToDraft ? (
                  <Button
                    disabled={busyAction === "return-to-draft"}
                    onClick={returnAssessmentToDraft}
                    type="button"
                    variant="secondary"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Return to draft
                  </Button>
                ) : null}
                <Button
                  disabled={assessment.status === "archived" || busyAction === "archive"}
                  onClick={archiveAssessment}
                  type="button"
                  variant="danger"
                >
                  <Archive className="h-4 w-4" aria-hidden="true" />
                  Archive
                </Button>
              </div>
            </form>

            <form className="rounded-lg border border-line bg-white p-5 shadow-soft" onSubmit={saveAvailability}>
              <div>
                <h2 className="text-xl font-semibold text-ink">Availability</h2>
                <p className="mt-1 text-sm leading-6 text-muted">
                  Release and closing dates control when new students may start. Students who already started may continue after the closing date.
                </p>
              </div>
              <div className="mt-5 grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={`Release date/time (${assessment.course_timezone})`}>
                    <input
                      className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                      onChange={(event) => setReleaseAt(event.target.value)}
                      type="datetime-local"
                      value={releaseAt}
                    />
                  </Field>
                  <Field label={`Closing date/time (${assessment.course_timezone})`}>
                    <input
                      className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                      onChange={(event) => setCloseAt(event.target.value)}
                      type="datetime-local"
                      value={closeAt}
                    />
                  </Field>
                </div>
              </div>
              <div className="mt-5">
                <Button disabled={isAvailabilitySubmitting} type="submit">
                  <Save className="h-4 w-4" aria-hidden="true" />
                  {isAvailabilitySubmitting ? "Saving" : "Save availability"}
                </Button>
              </div>
            </form>

            <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
              <div className="flex flex-col gap-3 border-b border-line pb-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-ink">MCQ items</h2>
                  <p className="mt-1 text-sm text-muted">
                    Add the MCQ items students will answer in this mini test.
                  </p>
                  <div className="mt-3 space-y-1 text-sm">
                    <p className="font-medium text-ink">
                      {includedMiniTestItems.length} of {minimumRequiredItems} required MCQ items added.
                    </p>
                    <p className="text-muted">
                      {includedMiniTestItems.length >= minimumRequiredItems
                        ? "Minimum item requirement met."
                        : "Add more included MCQ items before publishing."}{" "}
                      This count is a structural authoring check, not a claim that the mini test is pedagogically valid.
                    </p>
                  </div>
                </div>
                <PrimaryLink href={addItemHref}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                  Add MCQ item
                </PrimaryLink>
              </div>

              {miniTestItems.length === 0 ? (
                <p className="mt-5 text-sm text-muted">No MCQ items yet.</p>
              ) : (
                <div className="mt-5 space-y-3">
                  {miniTestItems.map((item) => (
                    <article className="rounded-lg border border-line p-4" key={item.item_public_id}>
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={item.status} />
                            {item.content_state ? <ContentStateBadge state={item.content_state} /> : null}
                            <span className="text-xs text-muted">Order {item.item_order}</span>
                            <span className="text-xs text-muted">Options {optionCount(item.options)}</span>
                            <span className="text-xs text-muted">
                              {item.included_in_published_set ? "Included" : "Candidate"}
                            </span>
                          </div>
                          <h3 className="mt-3 font-semibold text-ink">
                            Item {item.item_order}
                          </h3>
                          <p className="mt-1 line-clamp-3 text-sm leading-6 text-muted">{item.item_stem}</p>
                          <p className="mt-2 font-mono text-xs text-muted">{item.item_public_id}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Link
                            className="inline-flex h-10 items-center rounded-md border border-line px-4 text-sm font-semibold text-ink transition hover:border-accent"
                            href={`/teacher/content/items/${item.item_public_id}`}
                          >
                            Edit
                          </Link>
                          <Link
                            className="inline-flex h-10 items-center rounded-md border border-line px-4 text-sm font-semibold text-ink transition hover:border-accent"
                            href={`/teacher/content/items/${item.item_public_id}#teacher-preview`}
                          >
                            Teacher preview
                          </Link>
                          <Link
                            className="inline-flex h-10 items-center rounded-md border border-line px-4 text-sm font-semibold text-ink transition hover:border-accent"
                            href={`/teacher/content/items/${item.item_public_id}#student-preview`}
                          >
                            Student preview
                          </Link>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              <div className="mt-5 border-t border-line pt-4">
                <PrimaryLink href={addItemHref}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                  Add another MCQ item
                </PrimaryLink>
              </div>
            </section>

          </section>

          <aside className="space-y-4">
            <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
              <h2 className="font-semibold text-ink">Assessment facts</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-muted">Created</dt>
                  <dd className="font-medium text-ink">{formatDate(assessment.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Updated</dt>
                  <dd className="font-medium text-ink">{formatDate(assessment.updated_at)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Folder / week / module</dt>
                  <dd className="font-medium text-ink">{assessment.folder_label ?? "Unfiled"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Items</dt>
                  <dd className="font-medium text-ink">{miniTestItems.length}</dd>
                </div>
                <div>
                  <dt className="text-muted">Release</dt>
                  <dd className="font-medium text-ink">
                    {assessment.release_at_course_time ?? "Immediately after publishing"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Closing</dt>
                  <dd className="font-medium text-ink">
                    {assessment.close_at_course_time ?? "No closing date"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Student sessions</dt>
                  <dd className="font-medium text-ink">
                    {assessment.has_student_sessions ? "Started" : "None"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Lock reason</dt>
                  <dd className="font-medium text-ink">{assessment.content_lock_reason ?? "None"}</dd>
                </div>
              </dl>
            </section>
            <section className="rounded-lg border border-line bg-white p-5 text-sm leading-6 text-muted shadow-soft">
              Archive the assessment to prevent new sessions while preserving existing research records.
            </section>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
