"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle, FileText, RefreshCw, Upload } from "lucide-react";
import {
  commitSummativeImport,
  errorFromUnknown,
  fetchImportBatches,
  fetchOutcomeNames,
  previewSummativeImport
} from "./api";
import type {
  ImportBatchSummary,
  OutcomeNamesResponse,
  StructuredApiError,
  SummativeImportPreview
} from "./types";
import { EmptyPanel, ErrorPanel, formatDate, LoadingPanel, StatusPill } from "./ui";

const sampleCsv = `user_id,outcome_name,outcome_score,max_score,assessment_date,notes
student_demo,final_exam,88,100,2026-06-19,Supervised final exam
student_demo,final_course_score,91,100,2026-06-19,Supervised final course score`;

export function SummativeOutcomesClient() {
  const [csvText, setCsvText] = useState(sampleCsv);
  const [sourceFileName, setSourceFileName] = useState("pasted-summative-outcomes.csv");
  const [preview, setPreview] = useState<SummativeImportPreview | null>(null);
  const [batches, setBatches] = useState<ImportBatchSummary[]>([]);
  const [outcomeNames, setOutcomeNames] = useState<OutcomeNamesResponse["outcome_names"]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(true);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);

    try {
      const [batchResult, outcomeResult] = await Promise.all([
        fetchImportBatches(),
        fetchOutcomeNames()
      ]);
      setBatches(batchResult.import_batches);
      setOutcomeNames(outcomeResult.outcome_names);
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function readFile(file: File) {
    setSourceFileName(file.name);
    setCsvText(await file.text());
    setPreview(null);
    setMessage(null);
  }

  async function previewCsv() {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const result = await previewSummativeImport({
        csv_text: csvText,
        source_file_name: sourceFileName
      });
      setPreview(result);
      setMessage("Preview created. Inspect validation results before committing.");
      await refresh();
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function commitPreview() {
    if (!preview) {
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const result = await commitSummativeImport(preview.batch_public_id);
      setMessage(`Committed ${result.committed_rows} outcome rows.`);
      await refresh();
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    } finally {
      setLoading(false);
    }
  }

  const hasBlockingRows = preview
    ? (
    (preview.invalid_rows > 0 ||
      preview.duplicate_rows > 0 ||
      preview.conflicting_rows > 0 ||
      preview.unmatched_user_rows > 0)
    )
    : false;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-ink">Import summative outcomes</h2>
          </div>
          <a
            className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent"
            download="sample-summative-outcomes.csv"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(sampleCsv)}`}
          >
            <FileText className="mr-2 h-4 w-4" aria-hidden="true" />
            Sample template
          </a>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Upload CSV file
            <input
              accept=".csv,text/csv"
              className="rounded-md border border-line bg-white px-3 py-2 text-sm"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void readFile(file);
                }
              }}
              type="file"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Source file name
            <input
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
              onChange={(event) => setSourceFileName(event.target.value)}
              value={sourceFileName}
            />
          </label>
        </div>

        <label className="mt-4 flex flex-col gap-2 text-sm font-medium text-ink">
          Paste CSV text
          <textarea
            className="min-h-48 rounded-md border border-line bg-white p-3 font-mono text-sm"
            onChange={(event) => {
              setCsvText(event.target.value);
              setPreview(null);
            }}
            value={csvText}
          />
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white hover:bg-[#176350] disabled:opacity-50"
            disabled={loading || csvText.trim().length === 0}
            onClick={() => void previewCsv()}
            type="button"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            Preview import
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent disabled:opacity-50"
            disabled={loading || !preview || hasBlockingRows || preview.valid_rows === 0}
            onClick={() => void commitPreview()}
            type="button"
          >
            <CheckCircle className="h-4 w-4" aria-hidden="true" />
            Commit valid preview
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent"
            onClick={() => void refresh()}
            type="button"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh history
          </button>
        </div>
      </section>

      {message ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          {message}
        </section>
      ) : null}
      <ErrorPanel error={error} />
      {loading || refreshing ? <LoadingPanel label="Updating summative outcomes" /> : null}

      {preview ? (
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="text-xl font-semibold text-ink">Preview results</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-6">
            <Metric label="Total" value={preview.total_rows} />
            <Metric label="Valid" value={preview.valid_rows} />
            <Metric label="Invalid" value={preview.invalid_rows} />
            <Metric label="Duplicates" value={preview.duplicate_rows} />
            <Metric label="Conflicts" value={preview.conflicting_rows} />
            <Metric label="Unmatched" value={preview.unmatched_user_rows} />
          </div>
          {hasBlockingRows ? (
            <p className="mt-4 text-sm text-amber-900">
              This preview has blocking validation results. Fix the CSV and preview again before
              committing.
            </p>
          ) : null}
          <PreviewTable rows={preview.preview_rows} />
        </section>
      ) : null}

      <section className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="text-xl font-semibold text-ink">Active outcome names</h2>
          {outcomeNames.length === 0 ? (
            <EmptyPanel title="No active outcomes yet." />
          ) : (
            <div className="mt-4 space-y-2">
              {outcomeNames.map((entry) => (
                <div className="flex items-center justify-between rounded-md border border-line p-3" key={entry.outcome_name}>
                  <span className="font-medium text-ink">{entry.outcome_name}</span>
                  <span className="text-sm text-muted">{entry.active_outcome_count} active</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="text-xl font-semibold text-ink">Import batches</h2>
          {batches.length === 0 ? (
            <EmptyPanel title="No import batches yet." />
          ) : (
            <div className="mt-4 space-y-3">
              {batches.map((batch) => (
                <article className="rounded-md border border-line p-3" key={batch.batch_public_id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill value={batch.status} tone={batch.status === "committed" ? "good" : "warn"} />
                    <span className="text-sm font-semibold text-ink">{batch.batch_public_id}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted">
                    {batch.source_file_name ?? "No file name"} · {formatDate(batch.created_at)}
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    {batch.committed_rows} committed / {batch.valid_rows} valid / {batch.invalid_rows} invalid / {batch.conflicting_rows} conflicts
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
    </div>
  );
}

function PreviewTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (rows.length === 0) {
    return <EmptyPanel title="No rows parsed." />;
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-line">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2">Row</th>
            <th className="px-3 py-2">user_id</th>
            <th className="px-3 py-2">Outcome</th>
            <th className="px-3 py-2">Score</th>
            <th className="px-3 py-2">Max</th>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Errors</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.slice(0, 50).map((row, index) => (
            <tr key={`${String(row.source_row_number)}-${index}`}>
              <td className="px-3 py-2">{String(row.source_row_number ?? "")}</td>
              <td className="px-3 py-2">{String(row.user_id ?? "")}</td>
              <td className="px-3 py-2">{String(row.outcome_name ?? "")}</td>
              <td className="px-3 py-2">{String(row.outcome_score ?? "")}</td>
              <td className="px-3 py-2">{String(row.max_score ?? "")}</td>
              <td className="px-3 py-2">{String(row.assessment_date ?? "")}</td>
              <td className="px-3 py-2">
                <StatusPill
                  value={String(row.row_status ?? "")}
                  tone={row.row_status === "valid" ? "good" : "warn"}
                />
              </td>
              <td className="max-w-md px-3 py-2 text-xs text-muted">
                {Array.isArray(row.validation_errors)
                  ? row.validation_errors
                      .map((error) =>
                        typeof error === "object" && error && "message" in error
                          ? String((error as { message: unknown }).message)
                          : String(error)
                      )
                      .join("; ")
                  : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
