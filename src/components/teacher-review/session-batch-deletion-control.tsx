"use client";

import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
  deleteSessionBatch,
  errorFromUnknown,
  previewSessionBatchDeletion
} from "./api";
import type {
  SessionBatchDeletionPreview,
  SessionBatchDeletionSummary,
  StructuredApiError
} from "./types";
import { ErrorState } from "./ui";

const countLabels: Array<[keyof SessionBatchDeletionPreview["counts"], string]> = [
  ["assessment_session_count", "Student sessions"],
  ["item_response_count", "Item responses"],
  ["conversation_turn_count", "Conversation turns"],
  ["formative_conversation_session_count", "Learning conversations"],
  ["process_event_count", "Process events"],
  ["agent_call_count", "Agent calls"]
];

export function SessionBatchDeletionControl({
  sessionPublicIds,
  onDeleted
}: {
  sessionPublicIds: string[];
  onDeleted: (summary: SessionBatchDeletionSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<SessionBatchDeletionPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function openPreview() {
    if (sessionPublicIds.length === 0) return;
    setOpen(true);
    setPreview(null);
    setConfirmation("");
    setError(null);
    setLoading(true);
    try {
      setPreview(await previewSessionBatchDeletion(sessionPublicIds));
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setLoading(false);
    }
  }

  async function confirmDeletion() {
    if (!preview || confirmation !== preview.required_delete_confirmation) return;
    setDeleting(true);
    setError(null);
    try {
      const summary = await deleteSessionBatch({
        session_public_ids: preview.sessions.map((session) => session.session_public_id),
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
        data-testid="delete-selected-sessions"
        disabled={sessionPublicIds.length === 0}
        onClick={() => void openPreview()}
        type="button"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        Delete selected
      </button>

      {open ? (
        <div
          aria-labelledby="batch-delete-sessions-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4 py-6"
          role="dialog"
        >
          <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-lg border border-line bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold text-red-950" id="batch-delete-sessions-title">
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                  Delete selected student sessions?
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  This removes the selected attempts and their evidence permanently. Student accounts and mini tests remain available.
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

            <div className="mt-4">{error ? <ErrorState error={error} /> : null}</div>
            {loading ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading deletion preview...
              </p>
            ) : null}

            {preview ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {countLabels.map(([key, label]) => (
                    <div className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm" key={key}>
                      <span className="text-muted">{label}</span>
                      <strong className="text-ink">{preview.counts[key]}</strong>
                    </div>
                  ))}
                </div>
                <div className="max-h-52 overflow-y-auto rounded-md border border-line">
                  <ul className="divide-y divide-line">
                    {preview.sessions.map((session) => (
                      <li className="px-3 py-2 text-sm" key={session.session_public_id}>
                        <p className="font-semibold text-ink">
                          {session.student_user_id} · {session.assessment_title}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {session.status.replace(/_/g, " ")} · {session.session_public_id}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-950">
                  {preview.warning}
                </p>
                <label className="flex flex-col gap-2 text-sm font-medium text-red-950">
                  Type {preview.required_delete_confirmation}
                  <input
                    autoComplete="off"
                    className="h-10 rounded-md border border-red-300 bg-white px-3 text-sm text-ink outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                    data-testid="batch-delete-sessions-confirmation"
                    onChange={(event) => setConfirmation(event.target.value)}
                    value={confirmation}
                  />
                </label>
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
                    data-testid="confirm-batch-delete-sessions"
                    disabled={deleting || confirmation !== preview.required_delete_confirmation}
                    onClick={() => void confirmDeletion()}
                    type="button"
                  >
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                    {deleting ? "Deleting..." : "Delete sessions"}
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
