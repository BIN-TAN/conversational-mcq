"use client";

import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
  deleteStudentBatch,
  errorFromUnknown,
  previewStudentBatchDeletion
} from "./api";
import type {
  StudentBatchDeletionPreview,
  StudentBatchDeletionSummary,
  StructuredApiError
} from "./types";
import { ErrorPanel } from "./ui";

const aggregateCountLabels: Array<
  [keyof StudentBatchDeletionPreview["counts"], string]
> = [
  ["student_account_count", "Student accounts"],
  ["assessment_session_count", "Assessment sessions"],
  ["item_response_count", "Item responses"],
  ["conversation_turn_count", "Conversation turns"],
  ["formative_conversation_session_count", "Learning conversations"],
  ["agent_call_summary_count", "Agent-call audit rows"]
];

export function StudentBatchDeletionControl({
  studentIds,
  onDeleted
}: {
  studentIds: string[];
  onDeleted: (summary: StudentBatchDeletionSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<StudentBatchDeletionPreview | null>(null);
  const [summary, setSummary] = useState<StudentBatchDeletionSummary | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function openPreview() {
    if (studentIds.length === 0) {
      return;
    }

    setOpen(true);
    setPreview(null);
    setSummary(null);
    setConfirmation("");
    setError(null);
    setLoadingPreview(true);

    try {
      setPreview(await previewStudentBatchDeletion(studentIds));
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    } finally {
      setLoadingPreview(false);
    }
  }

  async function confirmDeletion() {
    if (!preview || confirmation !== preview.required_delete_confirmation) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      const result = await deleteStudentBatch({
        student_ids: preview.students.map((student) => student.student_id),
        selection_fingerprint: preview.selection_fingerprint,
        delete_confirmation: confirmation
      });
      setSummary(result);
      setPreview(null);
      setConfirmation("");
      onDeleted(result);
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    } finally {
      setDeleting(false);
    }
  }

  function closeDialog() {
    if (deleting) {
      return;
    }

    setOpen(false);
    setPreview(null);
    setSummary(null);
    setConfirmation("");
    setError(null);
  }

  return (
    <>
      <button
        className="inline-flex h-9 items-center gap-2 rounded-md border border-red-300 bg-white px-3 text-sm font-semibold text-red-800 hover:border-red-500 disabled:cursor-not-allowed disabled:border-line disabled:text-muted disabled:opacity-60"
        data-testid="delete-selected-students"
        disabled={studentIds.length === 0}
        onClick={() => void openPreview()}
        type="button"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        Delete selected
      </button>

      {open ? (
        <div
          aria-labelledby="batch-delete-students-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4 py-6"
          data-testid="batch-delete-students-dialog"
          role="dialog"
        >
          <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-lg border border-line bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold text-red-950" id="batch-delete-students-title">
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                  Delete selected student accounts?
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  This action is permanent and includes associated assessment and learning-conversation data.
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

            {loadingPreview ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading deletion preview...
              </div>
            ) : null}

            {preview ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {aggregateCountLabels.map(([key, label]) => (
                    <div className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm" key={key}>
                      <span className="text-muted">{label}</span>
                      <span className="font-semibold text-ink">{preview.counts[key]}</span>
                    </div>
                  ))}
                </div>

                <div className="overflow-hidden rounded-md border border-line">
                  <div className="border-b border-line bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-muted">
                    Selected accounts
                  </div>
                  <ul className="max-h-48 divide-y divide-line overflow-y-auto">
                    {preview.students.map((student) => (
                      <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm" key={student.student_id}>
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-ink">{student.student_id}</div>
                          <div className="truncate text-muted">{student.display_name ?? "No display name"}</div>
                        </div>
                        <span className="shrink-0 text-muted">
                          {student.assessment_session_count} {student.assessment_session_count === 1 ? "session" : "sessions"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-950">
                  {preview.warning}
                </div>

                <label className="flex flex-col gap-2 text-sm font-medium text-red-950">
                  Type {preview.required_delete_confirmation}
                  <input
                    autoComplete="off"
                    autoFocus
                    className="h-10 rounded-md border border-red-300 bg-white px-3 text-sm text-ink outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                    data-testid="batch-delete-students-confirmation"
                    onChange={(event) => setConfirmation(event.target.value)}
                    value={confirmation}
                  />
                </label>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent disabled:opacity-50"
                    disabled={deleting}
                    onClick={closeDialog}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-red-200"
                    data-testid="confirm-batch-delete-students"
                    disabled={deleting || confirmation !== preview.required_delete_confirmation}
                    onClick={() => void confirmDeletion()}
                    type="button"
                  >
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                    {deleting ? "Deleting..." : "Delete accounts"}
                  </button>
                </div>
              </div>
            ) : null}

            {summary ? (
              <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
                <h3 className="font-semibold">{summary.deleted_counts.student_account_count} student accounts deleted.</h3>
                <p className="mt-1">The account list and future exports now exclude these students.</p>
                <div className="mt-4 flex justify-end">
                  <button
                    className="inline-flex h-10 items-center rounded-md border border-emerald-300 bg-white px-4 font-semibold hover:border-emerald-500"
                    onClick={closeDialog}
                    type="button"
                  >
                    Done
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
