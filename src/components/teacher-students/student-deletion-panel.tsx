"use client";

import Link from "next/link";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  deleteStudentData,
  errorFromUnknown,
  previewStudentDeletion
} from "./api";
import type {
  StudentDeletionPreview,
  StudentDeletionSummary,
  StructuredApiError
} from "./types";
import { ErrorPanel } from "./ui";

const countLabels: Array<[keyof StudentDeletionPreview["counts"], string]> = [
  ["assessment_session_count", "Assessment sessions"],
  ["item_response_count", "Item responses"],
  ["conversation_turn_count", "Conversation turns"],
  ["process_event_count", "Process events"],
  ["response_package_count", "Response packages"],
  ["student_profile_count", "Profile packets"],
  ["formative_decision_count", "Formative decisions"],
  ["followup_round_count", "Follow-up rounds"],
  ["activity_runtime_count", "Activity runtime attempts"],
  ["post_activity_evidence_count", "Post-activity evidence records"],
  ["diagnostic_snapshot_count", "Diagnostic snapshots"],
  ["agent_call_summary_count", "Agent-call audit rows"],
  ["summative_outcome_count", "Summative outcomes"],
  ["student_account_event_count", "Student account events"]
];

function CountGrid({ preview }: { preview: StudentDeletionPreview }) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {countLabels.map(([key, label]) => (
        <div
          className="flex items-center justify-between rounded-md border border-red-100 bg-white px-3 py-2 text-sm"
          key={key}
        >
          <span className="text-muted">{label}</span>
          <span className="font-semibold text-ink">{preview.counts[key]}</span>
        </div>
      ))}
    </div>
  );
}

export function StudentDeletionPanel({ userId }: { userId: string }) {
  const [preview, setPreview] = useState<StudentDeletionPreview | null>(null);
  const [summary, setSummary] = useState<StudentDeletionSummary | null>(null);
  const [studentConfirmation, setStudentConfirmation] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<StructuredApiError | null>(null);

  async function loadPreview() {
    setLoadingPreview(true);
    setError(null);
    setSummary(null);

    try {
      setPreview(await previewStudentDeletion(userId));
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    } finally {
      setLoadingPreview(false);
    }
  }

  async function confirmDelete() {
    if (!preview) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      const result = await deleteStudentData(userId, {
        student_id: studentConfirmation,
        delete_confirmation: deleteConfirmation
      });
      setSummary(result);
      setPreview(null);
      setStudentConfirmation("");
      setDeleteConfirmation("");
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    } finally {
      setDeleting(false);
    }
  }

  const confirmationReady =
    preview &&
    studentConfirmation === preview.student_id &&
    deleteConfirmation === "DELETE" &&
    !deleting;

  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-5 shadow-soft">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-red-950">
            <Trash2 className="h-5 w-5" aria-hidden="true" />
            Delete student data
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-red-950">
            Deactivate/reactivate remains the reversible account control. Deletion permanently
            removes this student account and associated system records.
          </p>
        </div>
        {!preview && !summary ? (
          <button
            className="inline-flex h-10 items-center justify-center rounded-md border border-red-300 bg-white px-4 text-sm font-semibold text-red-950 hover:border-red-500 disabled:opacity-60"
            disabled={loadingPreview}
            onClick={() => void loadPreview()}
            type="button"
          >
            {loadingPreview ? "Loading preview..." : "Preview deletion"}
          </button>
        ) : null}
      </div>

      <div className="mt-4">
        <ErrorPanel error={error} />
      </div>

      {preview ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-md border border-red-300 bg-white p-4 text-sm text-red-950">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>{preview.warning}</p>
            </div>
          </div>
          <CountGrid preview={preview} />
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-medium text-red-950">
              Type student_id exactly: {preview.student_id}
              <input
                className="h-10 rounded-md border border-red-200 bg-white px-3 text-sm text-ink"
                onChange={(event) => setStudentConfirmation(event.target.value)}
                value={studentConfirmation}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-red-950">
              Type DELETE
              <input
                className="h-10 rounded-md border border-red-200 bg-white px-3 text-sm text-ink"
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                value={deleteConfirmation}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex h-10 items-center justify-center rounded-md border border-red-700 bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:border-red-200 disabled:bg-red-200"
              disabled={!confirmationReady}
              onClick={() => void confirmDelete()}
              type="button"
            >
              {deleting ? "Deleting..." : "Confirm irreversible deletion"}
            </button>
            <button
              className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent"
              onClick={() => {
                setPreview(null);
                setStudentConfirmation("");
                setDeleteConfirmation("");
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {summary ? (
        <div className="mt-4 rounded-md border border-emerald-200 bg-white p-4 text-sm text-emerald-950">
          <h3 className="font-semibold">Student data deletion completed.</h3>
          <p className="mt-2">
            Audit event: <span className="font-mono">{summary.deletion_event_public_id}</span>
          </p>
          <p className="mt-1">Deleted at: {summary.deleted_at}</p>
          <div className="mt-3">
            <CountGrid preview={summary} />
          </div>
          <Link
            className="mt-4 inline-flex h-10 items-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent"
            href="/teacher/students"
          >
            Return to student account list
          </Link>
        </div>
      ) : null}
    </section>
  );
}
