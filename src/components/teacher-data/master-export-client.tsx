"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, Table } from "lucide-react";
import {
  createMasterExport,
  errorFromUnknown,
  fetchAssessments,
  fetchExportJobs,
  fetchOutcomeNames
} from "./api";
import type {
  AssessmentOption,
  ExportJob,
  OutcomeNamesResponse,
  StructuredApiError
} from "./types";
import { EmptyPanel, ErrorPanel, formatDate, LoadingPanel, StatusPill } from "./ui";

const statuses = ["not_started", "active", "paused", "completed", "student_exited", "needs_review"];

export function MasterExportClient() {
  const [assessments, setAssessments] = useState<AssessmentOption[]>([]);
  const [outcomeNames, setOutcomeNames] = useState<OutcomeNamesResponse["outcome_names"]>([]);
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [assessmentPublicId, setAssessmentPublicId] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [includeIncomplete, setIncludeIncomplete] = useState(true);
  const [includeRawJson, setIncludeRawJson] = useState(true);
  const [spreadsheetSafe, setSpreadsheetSafe] = useState(true);
  const [primaryOutcomeName, setPrimaryOutcomeName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [assessmentResult, outcomeResult, jobResult] = await Promise.all([
        fetchAssessments(),
        fetchOutcomeNames(),
        fetchExportJobs()
      ]);
      setAssessments(assessmentResult.assessments);
      setOutcomeNames(outcomeResult.outcome_names);
      setJobs(jobResult.export_jobs);
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function toggleStatus(status: string) {
    setSelectedStatuses((current) =>
      current.includes(status)
        ? current.filter((entry) => entry !== status)
        : [...current, status]
    );
  }

  async function generateExport() {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const result = await createMasterExport({
        assessment_public_id: assessmentPublicId || undefined,
        session_status: selectedStatuses.length > 0 ? selectedStatuses : undefined,
        include_incomplete_sessions: includeIncomplete,
        primary_outcome_name: primaryOutcomeName || undefined,
        include_raw_json_columns: includeRawJson,
        spreadsheet_safe_text: spreadsheetSafe
      });
      setMessage(
        result.export_job.status === "completed"
          ? `Export completed with ${result.export_job.row_count ?? 0} rows.`
          : `Export finished with status ${result.export_job.status}.`
      );
      await refresh();
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h2 className="text-xl font-semibold text-ink">Generate master assessment CSV</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Generate one merged analysis file at item-response grain with placeholder rows for
          incomplete sessions. Persisted profiles, decisions, follow-up, progression, workflow,
          and audit records are exported from the normalized database without modifying them.
        </p>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Assessment
            <select
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
              onChange={(event) => setAssessmentPublicId(event.target.value)}
              value={assessmentPublicId}
            >
              <option value="">All assessments</option>
              {assessments.map((assessment) => (
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
            Primary summative outcome
            <select
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
              onChange={(event) => setPrimaryOutcomeName(event.target.value)}
              value={primaryOutcomeName}
            >
              <option value="">No primary outcome</option>
              {outcomeNames.map((entry) => (
                <option key={entry.outcome_name} value={entry.outcome_name}>
                  {entry.outcome_name} ({entry.active_outcome_count})
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="mt-5 rounded-lg border border-line p-4">
          <legend className="px-1 text-sm font-semibold text-ink">Session status filter</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {statuses.map((status) => (
              <label
                className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm"
                key={status}
              >
                <input
                  checked={selectedStatuses.includes(status)}
                  onChange={() => toggleStatus(status)}
                  type="checkbox"
                />
                {status.replace(/_/g, " ")}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm">
            <input
              checked={includeIncomplete}
              onChange={(event) => setIncludeIncomplete(event.target.checked)}
              type="checkbox"
            />
            <span>
              <span className="font-semibold text-ink">Include incomplete sessions</span>
              <span className="mt-1 block text-muted">Keep interrupted sessions in the export.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm">
            <input
              checked={includeRawJson}
              onChange={(event) => setIncludeRawJson(event.target.checked)}
              type="checkbox"
            />
            <span>
              <span className="font-semibold text-ink">Include raw JSON columns</span>
              <span className="mt-1 block text-muted">Transcript, process, package, and audit JSON.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm">
            <input
              checked={spreadsheetSafe}
              onChange={(event) => setSpreadsheetSafe(event.target.checked)}
              type="checkbox"
            />
            <span>
              <span className="font-semibold text-ink">Spreadsheet-safe text</span>
              <span className="mt-1 block text-muted">Prefix formula-like text with a reversible apostrophe.</span>
            </span>
          </label>
        </div>

        {!spreadsheetSafe ? (
          <section className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            Spreadsheet-safe text is disabled. Formula-like student text will be exported exactly
            as stored and may execute if opened directly in spreadsheet software.
          </section>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white hover:bg-[#176350] disabled:opacity-50"
            disabled={loading}
            onClick={() => void generateExport()}
            type="button"
          >
            <Table className="h-4 w-4" aria-hidden="true" />
            Generate export
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent"
            onClick={() => void refresh()}
            type="button"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh jobs
          </button>
        </div>
      </section>

      {message ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          {message}
        </section>
      ) : null}
      <ErrorPanel error={error} />
      {loading ? <LoadingPanel label="Updating export jobs" /> : null}

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h2 className="text-xl font-semibold text-ink">Export jobs</h2>
        {jobs.length === 0 ? (
          <EmptyPanel title="No exports have been generated yet." />
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-line">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Export ID</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Rows</th>
                  <th className="px-3 py-2">Schema</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Completed</th>
                  <th className="px-3 py-2">Message</th>
                  <th className="px-3 py-2">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {jobs.map((job) => (
                  <tr key={job.export_public_id}>
                    <td className="px-3 py-2 font-mono text-xs">{job.export_public_id}</td>
                    <td className="px-3 py-2">
                      <StatusPill value={job.status} tone={job.status === "completed" ? "good" : job.status === "failed" ? "bad" : "warn"} />
                    </td>
                    <td className="px-3 py-2">{job.row_count ?? ""}</td>
                    <td className="px-3 py-2">{job.export_schema_version ?? ""}</td>
                    <td className="px-3 py-2">{formatDate(job.created_at)}</td>
                    <td className="px-3 py-2">{formatDate(job.completed_at)}</td>
                    <td className="max-w-xs px-3 py-2 text-xs text-muted">{job.error_message}</td>
                    <td className="px-3 py-2">
                      {job.download_url ? (
                        <a
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-xs font-semibold text-ink hover:border-accent"
                          href={job.download_url}
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                          Download
                        </a>
                      ) : (
                        <span className="text-xs text-muted">Unavailable</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
