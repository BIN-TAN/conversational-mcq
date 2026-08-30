"use client";

import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
  deleteArchivedAssessmentBatch,
  errorFromUnknown,
  previewArchivedAssessmentBatchDeletion
} from "./api";
import type {
  ArchivedAssessmentBatchDeletionPreview,
  ArchivedAssessmentBatchDeletionSummary,
  StructuredApiError
} from "./types";
import { ErrorPanel } from "./ui";

function blockedReasonLabel(reason: string) {
  if (reason === "archived_status_required") return "The mini test is not archived.";
  if (reason === "student_or_operational_records_exist") {
    return "Student sessions or learning evidence still exist. Delete the trial sessions first.";
  }
  if (reason === "unused_delete_requires_draft_or_archived_status") {
    return "The mini test is not eligible for unused-content deletion.";
  }
  return reason.replace(/_/g, " ");
}

export function ArchivedAssessmentBatchDeletionControl({
  assessmentPublicIds,
  onDeleted
}: {
  assessmentPublicIds: string[];
  onDeleted: (summary: ArchivedAssessmentBatchDeletionSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ArchivedAssessmentBatchDeletionPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function openPreview() {
    if (assessmentPublicIds.length === 0) return;
    setOpen(true);
    setPreview(null);
    setConfirmation("");
    setError(null);
    setLoading(true);
    try {
      setPreview(await previewArchivedAssessmentBatchDeletion(assessmentPublicIds));
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setLoading(false);
    }
  }

  async function confirmDeletion() {
    if (
      !preview ||
      !preview.allowed ||
      confirmation !== preview.required_delete_confirmation
    ) {
      return;
    }

    setDeleting(true);
    setError(null);
    try {
      const summary = await deleteArchivedAssessmentBatch({
        assessment_public_ids: preview.assessments.map(
          (assessment) => assessment.assessment_public_id
        ),
        selection_fingerprint: preview.selection_fingerprint,
        delete_confirmation: confirmation
      });
      onDeleted(summary);
      setOpen(false);
      setPreview(null);
      setConfirmation("");
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setDeleting(false);
    }
  }

  function closeDialog() {
    if (deleting) return;
    setOpen(false);
    setPreview(null);
    setConfirmation("");
    setError(null);
  }

  return (
    <>
      <button
        className="inline-flex h-9 items-center gap-2 rounded-md border border-red-300 bg-white px-3 text-sm font-semibold text-red-800 hover:border-red-500 disabled:cursor-not-allowed disabled:border-line disabled:text-muted disabled:opacity-60"
        data-testid="delete-selected-archived-mini-tests"
        disabled={assessmentPublicIds.length === 0}
        onClick={() => void openPreview()}
        type="button"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        Delete selected
      </button>

      {open ? (
        <div
          aria-labelledby="batch-delete-archived-assessments-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4 py-6"
          role="dialog"
        >
          <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-lg border border-line bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  className="flex items-center gap-2 text-lg font-semibold text-red-950"
                  id="batch-delete-archived-assessments-title"
                >
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                  Delete selected archived mini tests?
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  This permanently removes their item-authoring content. Mini tests with student sessions are blocked.
                </p>
              </div>
              <button
                aria-label="Close deletion dialog"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-muted hover:border-red-300 hover:text-red-800 disabled:opacity-50"
                disabled={deleting}
                onClick={closeDialog}
                title="Close"
                type="button"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4">
              <ErrorPanel error={error} />
            </div>
            {loading ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading deletion preview...
              </p>
            ) : null}

            {preview ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  <p className="rounded-md border border-line px-3 py-2 text-sm">
                    <span className="text-muted">Mini tests</span>{" "}
                    <strong className="float-right">{preview.counts.assessment_count}</strong>
                  </p>
                  <p className="rounded-md border border-line px-3 py-2 text-sm">
                    <span className="text-muted">Items</span>{" "}
                    <strong className="float-right">{preview.counts.item_count}</strong>
                  </p>
                  <p className="rounded-md border border-line px-3 py-2 text-sm">
                    <span className="text-muted">Sessions</span>{" "}
                    <strong className="float-right">{preview.counts.assessment_session_count}</strong>
                  </p>
                </div>

                <div className="max-h-56 overflow-y-auto rounded-md border border-line">
                  <ul className="divide-y divide-line">
                    {preview.assessments.map((assessment) => (
                      <li className="px-3 py-2 text-sm" key={assessment.assessment_public_id}>
                        <p className="font-semibold text-ink">{assessment.assessment_title}</p>
                        <p className="mt-1 text-xs text-muted">
                          {assessment.item_count} items · {assessment.assessment_session_count} sessions
                        </p>
                        {!assessment.allowed ? (
                          <ul className="mt-2 space-y-1 text-xs font-medium text-red-800">
                            {assessment.blocked_reasons.map((reason) => (
                              <li key={reason}>{blockedReasonLabel(reason)}</li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>

                <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-950">
                  {preview.warning}
                </p>

                {preview.allowed ? (
                  <label className="flex flex-col gap-2 text-sm font-medium text-red-950">
                    Type {preview.required_delete_confirmation}
                    <input
                      autoComplete="off"
                      className="h-10 rounded-md border border-red-300 bg-white px-3 text-sm text-ink outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                      data-testid="batch-delete-archived-mini-tests-confirmation"
                      onChange={(event) => setConfirmation(event.target.value)}
                      value={confirmation}
                    />
                  </label>
                ) : (
                  <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
                    Delete the listed trial sessions first, then preview this deletion again.
                  </p>
                )}

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    className="inline-flex h-10 items-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent disabled:opacity-50"
                    disabled={deleting}
                    onClick={closeDialog}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="inline-flex h-10 items-center gap-2 rounded-md bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-red-200"
                    data-testid="confirm-batch-delete-archived-mini-tests"
                    disabled={
                      deleting ||
                      !preview.allowed ||
                      confirmation !== preview.required_delete_confirmation
                    }
                    onClick={() => void confirmDeletion()}
                    type="button"
                  >
                    {deleting ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    )}
                    {deleting ? "Deleting..." : "Delete mini tests"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
