"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Archive, ArrowDown, ArrowUp, CheckCircle, Plus, RefreshCw, RotateCcw, Save } from "lucide-react";
import { apiRequest, errorFromUnknown } from "./api";
import type { AssessmentDetail, ConceptUnitSummary, StructuredApiError } from "./types";
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
  const [description, setDescription] = useState("");
  const [workflowMode, setWorkflowMode] = useState<"automatic" | "manual_review">("automatic");
  const [responseCollectionMode, setResponseCollectionMode] =
    useState<"llm_assisted" | "deterministic">("llm_assisted");
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
      setDescription(data.assessment.description ?? "");
      setWorkflowMode(data.assessment.workflow_mode);
      setResponseCollectionMode(data.assessment.response_collection_mode);
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
            description: description.trim() ? description : null
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
      setSuccess("Assessment metadata saved.");
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
            workflow_mode: workflowMode,
            response_collection_mode: responseCollectionMode,
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
      setWorkflowMode(data.assessment.workflow_mode);
      setResponseCollectionMode(data.assessment.response_collection_mode);
      setReleaseAt(data.assessment.release_at_course_time_input);
      setCloseAt(data.assessment.close_at_course_time_input);
      setSuccess("Assessment availability and workflow saved.");
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
        `Assessment published. Publishable concept units: ${data.publishable_concept_unit_public_ids.join(", ")}`
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

  async function reorderConceptUnit(unit: ConceptUnitSummary, direction: -1 | 1) {
    if (!assessment) {
      return;
    }

    const currentIndex = assessment.concept_units.findIndex(
      (entry) => entry.concept_unit_public_id === unit.concept_unit_public_id
    );
    const nextIndex = currentIndex + direction;

    if (nextIndex < 0 || nextIndex >= assessment.concept_units.length) {
      return;
    }

    const reordered = [...assessment.concept_units];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, moved);
    setBusyAction(`reorder-${unit.concept_unit_public_id}`);
    setError(null);
    setSuccess(null);

    try {
      await apiRequest(
        `/api/teacher/assessments/${assessmentPublicId}/reorder-concept-units`,
        {
          method: "POST",
          body: JSON.stringify({
            ordered_concept_unit_public_ids: reordered.map(
              (entry) => entry.concept_unit_public_id
            )
          })
        }
      );
      setSuccess("Concept-unit order updated.");
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="assessment"
        title={assessment?.title ?? "Assessment detail"}
        description="Metadata, concept units, publish status, and archive actions."
        actions={
          <>
            {isDraftEditable ? (
              <PrimaryLink href={`/teacher/content/assessments/${assessmentPublicId}/concept-units/new`}>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                New concept unit
              </PrimaryLink>
            ) : null}
            <Button disabled={isLoading} onClick={loadAssessment} type="button" variant="secondary">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </Button>
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
                <Field label="Title">
                  <input
                    className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    disabled={isReadOnly}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    value={title}
                  />
                </Field>
                <Field label="Description">
                  <textarea
                    className="min-h-28 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    disabled={isReadOnly}
                    onChange={(event) => setDescription(event.target.value)}
                    value={description}
                  />
                </Field>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button disabled={isReadOnly || isSubmitting} type="submit">
                  <Save className="h-4 w-4" aria-hidden="true" />
                  {isSubmitting ? "Saving" : "Save metadata"}
                </Button>
                <Button
                  disabled={isLocked || isArchived || busyAction === "publish"}
                  onClick={publishAssessment}
                  type="button"
                  variant="secondary"
                >
                  <CheckCircle className="h-4 w-4" aria-hidden="true" />
                  Publish assessment
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
                <h2 className="text-xl font-semibold text-ink">Availability and workflow</h2>
                <p className="mt-1 text-sm leading-6 text-muted">
                  Release and closing dates control when new students may start. Students who already started may continue after the closing date.
                </p>
              </div>
              <div className="mt-5 grid gap-4">
                <Field label="Workflow mode">
                  <select
                    className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    onChange={(event) =>
                      setWorkflowMode(event.target.value as "automatic" | "manual_review")
                    }
                    value={workflowMode}
                  >
                    <option value="automatic">Automatic</option>
                    <option value="manual_review">Manual review</option>
                  </select>
                </Field>
                <Field label="Response collection mode">
                  <select
                    className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:bg-slate-100 disabled:text-muted"
                    disabled={isLocked}
                    onChange={(event) =>
                      setResponseCollectionMode(
                        event.target.value as "llm_assisted" | "deterministic"
                      )
                    }
                    value={responseCollectionMode}
                  >
                    <option value="llm_assisted">LLM-assisted conversation</option>
                    <option value="deterministic">Deterministic collection</option>
                  </select>
                </Field>
                {responseCollectionMode === "llm_assisted" ? (
                  <p className="text-sm leading-6 text-muted">
                    Student free-text messages are interpreted by the Response Collection Agent.
                    Option and confidence selections still use structured controls, and no content
                    help is provided during initial administration.
                  </p>
                ) : (
                  <p className="text-sm leading-6 text-muted">
                    The system uses fixed initial-administration prompts. Free text is collected as
                    reasoning only when the current step explicitly requests reasoning.
                  </p>
                )}
                {isLocked ? (
                  <p className="rounded-md border border-line bg-slate-50 px-3 py-2 text-sm text-muted">
                    Existing student sessions keep their saved response collection mode snapshot.
                  </p>
                ) : null}
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
                <div className="rounded-md border border-line bg-slate-50 p-3 text-sm leading-6 text-muted">
                  <p>
                    Automatic: The system will automatically run profiling, formative planning, and follow-up startup after the student completes the initial item set.
                  </p>
                  <p className="mt-2">
                    Manual review: The system will wait for the teacher/researcher to review and trigger each AI-supported step.
                  </p>
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
                  <h2 className="text-xl font-semibold text-ink">Concept units</h2>
                  <p className="mt-1 text-sm text-muted">
                    You choose the concepts and items. The system checks only the minimum publishing and research-integrity requirements.
                  </p>
                </div>
                {isDraftEditable ? (
                  <PrimaryLink href={`/teacher/content/assessments/${assessmentPublicId}/concept-units/new`}>
                    <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                    Add concept unit
                  </PrimaryLink>
                ) : null}
              </div>

              {assessment.concept_units.length === 0 ? (
                <p className="mt-5 text-sm text-muted">No concept units yet.</p>
              ) : (
                <div className="mt-5 space-y-3">
                  {assessment.concept_units.map((unit, index) => (
                    <article className="rounded-lg border border-line p-4" key={unit.concept_unit_public_id}>
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={unit.status} />
                            <ContentStateBadge state={unit.content_state} />
                            <span className="text-xs text-muted">Order {unit.order_index}</span>
                            <span className="text-xs text-muted">Version {unit.version}</span>
                            <span className="text-xs text-muted">
                              Included {unit.included_active_item_count ?? 0}
                            </span>
                          </div>
                          <h3 className="mt-3 font-semibold text-ink">{unit.title}</h3>
                          <p className="mt-1 text-sm leading-6 text-muted">{unit.learning_objective}</p>
                          <p className="mt-2 font-mono text-xs text-muted">{unit.concept_unit_public_id}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            aria-label="Move concept unit up"
                            disabled={!isDraftEditable || index === 0 || Boolean(busyAction)}
                            onClick={() => reorderConceptUnit(unit, -1)}
                            type="button"
                            variant="secondary"
                          >
                            <ArrowUp className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            aria-label="Move concept unit down"
                            disabled={!isDraftEditable || index === assessment.concept_units.length - 1 || Boolean(busyAction)}
                            onClick={() => reorderConceptUnit(unit, 1)}
                            type="button"
                            variant="secondary"
                          >
                            <ArrowDown className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Link
                            className="inline-flex h-10 items-center rounded-md border border-line px-4 text-sm font-semibold text-ink transition hover:border-accent"
                            href={`/teacher/content/concept-units/${unit.concept_unit_public_id}`}
                          >
                            View
                          </Link>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
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
                  <dt className="text-muted">Concept units</dt>
                  <dd className="font-medium text-ink">{assessment.concept_unit_count ?? assessment.concept_units.length}</dd>
                </div>
                <div>
                  <dt className="text-muted">Workflow mode</dt>
                  <dd className="font-medium text-ink">
                    {assessment.workflow_mode === "automatic" ? "Automatic" : "Manual review"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Response collection</dt>
                  <dd className="font-medium text-ink">
                    {assessment.response_collection_mode === "llm_assisted"
                      ? "LLM-assisted conversation"
                      : "Deterministic collection"}
                  </dd>
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
