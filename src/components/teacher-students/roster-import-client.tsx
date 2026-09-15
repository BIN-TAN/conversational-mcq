"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Eye, EyeOff, RefreshCw, Upload } from "lucide-react";
import {
  commitRoster,
  errorFromUnknown,
  fetchRosterImportBatches,
  previewRoster
} from "./api";
import type {
  CredentialResponse,
  RosterImportBatch,
  RosterPreview,
  StructuredApiError
} from "./types";
import {
  CredentialResult,
  EmptyPanel,
  ErrorPanel,
  formatDate,
  LoadingPanel,
  StatusPill,
  downloadTextFile
} from "./ui";

const sampleRoster = [
  "user_id,display_name,email",
  "student_alpha,Avery Student,avery@example.edu",
  "student_beta,,"
].join("\n");

function numberCard(label: string, value: number) {
  return (
    <div className="rounded-lg border border-line bg-white p-4" key={label}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-ink">{value}</p>
    </div>
  );
}

export function RosterImportClient() {
  const [csvText, setCsvText] = useState(sampleRoster);
  const [sourceFileName, setSourceFileName] = useState("sample-student-roster.csv");
  const [preview, setPreview] = useState<RosterPreview | null>(null);
  const [credentials, setCredentials] = useState<CredentialResponse | null>(null);
  const [batches, setBatches] = useState<RosterImportBatch[]>([]);
  const [applyDisplayNameUpdates, setApplyDisplayNameUpdates] = useState(false);
  const [passwordMode, setPasswordMode] = useState("individual");
  const [sharedPassword, setSharedPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [replacePendingPasswords, setReplacePendingPasswords] = useState(false);
  const [commitSummary, setCommitSummary] = useState<string | null>(null);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshBatches = useCallback(async () => {
    try {
      setBatches((await fetchRosterImportBatches()).import_batches);
    } catch {
      // Batch history is supplemental on this page; preview/commit errors stay visible.
    }
  }, []);

  useEffect(() => {
    void refreshBatches();
  }, [refreshBatches]);

  async function loadFile(file?: File | null) {
    if (!file) {
      return;
    }

    setLoading(true);
    invalidatePreview();
    try {
      setSourceFileName(file.name);
      setCsvText(await file.text());
    } catch {
      setError(errorFromUnknown(new Error("Unable to read this CSV. Please try again.")));
    } finally { setLoading(false); }
  }

  function invalidatePreview() {
    setPreview(null);
    setCredentials(null);
    setCommitSummary(null);
    setReplacePendingPasswords(false);
  }

  async function runPreview() {
    setLoading(true);
    setError(null);
    setPreview(null);
    setCredentials(null);
    setCommitSummary(null);
    setReplacePendingPasswords(false);

    try {
      setPreview(await previewRoster({ csv_text: csvText, source_file_name: sourceFileName }));
      await refreshBatches();
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function runCommit() {
    if (!preview || loading || commitSummary) {
      return;
    }

    setLoading(true);
    setError(null);
    setCredentials(null);

    try {
      const result = await commitRoster(preview.batch_public_id, applyDisplayNameUpdates,
        passwordMode === "shared" ? { shared_temporary_password: sharedPassword, replace_pending_passwords: replacePendingPasswords } : {});
      setCredentials({
        one_time_credentials: result.one_time_credentials,
        credential_csv: result.credential_csv,
        credential_warning: result.credential_warning
      });
      setSharedPassword("");
      setShowPassword(false);
      setCommitSummary(result.already_committed ? "This roster was already imported. No passwords were changed again." :
        `${result.committed_new_students} accounts created. ${result.replaced_pending_passwords} unused temporary passwords replaced. ${result.committed_display_name_updates} profiles updated.` +
        (result.skipped_password_user_ids.length ? ` Passwords left unchanged: ${result.skipped_password_user_ids.join(", ")}.` : ""));
      await refreshBatches();
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    } finally {
      setLoading(false);
    }
  }

  const previewCounts = useMemo(
    () =>
      preview
        ? [
            ["Total rows", preview.total_rows],
            ["New students", preview.new_student_rows],
            ["Existing unchanged", preview.existing_unchanged_rows],
            ["Profile changes", preview.display_name_change_rows],
            ["Invalid rows", preview.invalid_rows],
            ["Duplicate rows", preview.duplicate_rows],
            ["Role conflicts", preview.role_conflict_rows]
          ]
        : [],
    [preview]
  );

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h2 className="text-xl font-semibold text-ink">Roster CSV preview</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Preview validates normalized user IDs and stores an audit batch, but it does not create
          students or generate temporary passwords/access codes. Email is optional and teacher-facing.
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Upload CSV
            <input
              accept=".csv,text/csv"
              disabled={loading}
              className="rounded-md border border-line bg-white px-3 py-2 text-sm"
              onChange={(event) => void loadFile(event.target.files?.[0])}
              type="file"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Source file name
            <input
              className="h-10 rounded-md border border-line px-3 text-sm"
              disabled={loading}
              onChange={(event) => { invalidatePreview(); setSourceFileName(event.target.value); }}
              value={sourceFileName}
            />
          </label>
        </div>
        <label className="mt-4 flex flex-col gap-2 text-sm font-medium text-ink">
          Paste CSV
          <textarea
            aria-label="Paste CSV"
            className="min-h-56 rounded-md border border-line p-3 font-mono text-sm"
            disabled={loading}
            onChange={(event) => { invalidatePreview(); setCsvText(event.target.value); }}
            value={csvText}
          />
        </label>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white hover:bg-[#176350] disabled:opacity-50"
            disabled={loading}
            onClick={() => void runPreview()}
            type="button"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            Preview roster
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent"
            onClick={() => downloadTextFile("sample-student-roster.csv", sampleRoster)}
            type="button"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download sample
          </button>
        </div>
      </section>

      <ErrorPanel error={error} />
      {loading ? <LoadingPanel label="Processing roster request" /> : null}

      {preview ? (
        <section className="space-y-4 rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-ink">Preview results</h2>
              <p className="mt-1 text-sm text-muted">Batch ID: {preview.batch_public_id}</p>
            </div>
            <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm">
              <input
                checked={applyDisplayNameUpdates}
                disabled={loading || Boolean(commitSummary)}
                onChange={(event) => setApplyDisplayNameUpdates(event.target.checked)}
                type="checkbox"
              />
              <span>
                <span className="font-semibold text-ink">Update names and email addresses</span>
              </span>
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            {previewCounts.map(([label, value]) => numberCard(String(label), Number(value)))}
          </div>
          <fieldset className="space-y-4 border-y border-line py-5" disabled={loading || Boolean(commitSummary)}>
            <legend className="font-semibold text-ink">Temporary passwords</legend>
            <label className="flex max-w-lg flex-col gap-2 text-sm font-medium text-ink">
              Password assignment
              <select className="h-11 w-full rounded-md border border-line bg-white px-3" value={passwordMode}
                onChange={(event) => { setPasswordMode(event.target.value); setReplacePendingPasswords(false); setSharedPassword(""); setShowPassword(false); }}>
                <option value="individual">Individual temporary passwords</option>
                <option value="shared">Shared temporary password</option>
              </select>
            </label>
            {passwordMode === "shared" ? <>
              <label className="flex max-w-lg flex-col gap-2 text-sm font-medium text-ink">
                Shared temporary password
                <span className="flex gap-2">
                  <input className="min-w-0 flex-1 rounded-md border border-line px-3 py-2" autoComplete="new-password"
                    aria-label="Shared temporary password"
                    type={showPassword ? "text" : "password"} minLength={7} maxLength={200}
                    value={sharedPassword} onChange={(event) => setSharedPassword(event.target.value)} />
                  <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line"
                    aria-label={showPassword ? "Hide temporary password" : "Show temporary password"}
                    title={showPassword ? "Hide temporary password" : "Show temporary password"} onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </span>
              </label>
              <p className="text-sm text-muted">At least 7 characters. Students must choose a different private password of at least 8 characters at first login.</p>
              <p className="text-sm text-amber-900">Anyone who knows a shared password and another student&apos;s username could sign in before that student changes it.</p>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input className="mt-1" type="checkbox" checked={replacePendingPasswords}
                  disabled={!preview.pending_password_reset_rows} onChange={(event) => setReplacePendingPasswords(event.target.checked)} />
                <span>Replace unused temporary passwords for {preview.pending_password_reset_rows ?? 0} existing accounts in this roster.
                  <span className="mt-1 block text-muted">Old temporary passwords will stop working. Accounts that have signed in or changed their password are excluded.</span>
                </span>
              </label>
            </> : null}
          </fieldset>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">user_id</th>
                  <th className="px-3 py-2">Display name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Existing name</th>
                  <th className="px-3 py-2">Existing email</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Validation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.preview_rows.map((row) => (
                  <tr key={`${row.source_row_number}-${row.user_id}`}>
                    <td className="px-3 py-2">{String(row.source_row_number)}</td>
                    <td className="px-3 py-2 font-semibold text-ink">{String(row.user_id ?? "")}</td>
                    <td className="px-3 py-2">{String(row.display_name ?? "")}</td>
                    <td className="px-3 py-2">{String(row.email ?? "")}</td>
                    <td className="px-3 py-2">{String(row.existing_display_name ?? "")}</td>
                    <td className="px-3 py-2">{String(row.existing_email ?? "")}</td>
                    <td className="px-3 py-2">
                      <StatusPill value={String(row.row_status)} />
                    </td>
                    <td className="px-3 py-2">
                      {Array.isArray(row.validation_errors) && row.validation_errors.length > 0
                        ? JSON.stringify(row.validation_errors)
                        : "OK"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white hover:bg-[#176350] disabled:opacity-50"
            disabled={loading || Boolean(commitSummary) || (passwordMode === "shared" && sharedPassword.length < 7)}
            onClick={() => void runCommit()}
            type="button"
          >
            {commitSummary ? "Imported" : "Import valid rows"}
          </button>
        </section>
      ) : null}

      {commitSummary ? <p role="status" className="rounded-md border border-line bg-white p-4 text-ink">{commitSummary}</p> : null}

      {credentials ? (
        <CredentialResult
          credentials={credentials.one_time_credentials}
          credentialCsv={credentials.credential_csv}
          warning={credentials.credential_warning}
        />
      ) : null}

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-ink">Roster import history</h2>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-accent"
            onClick={() => void refreshBatches()}
            type="button"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </button>
        </div>
        {batches.length === 0 ? (
          <EmptyPanel title="No roster batches yet." />
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-line">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Batch ID</th>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Rows</th>
                  <th className="px-3 py-2">New</th>
                  <th className="px-3 py-2">Committed</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Committed at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {batches.map((batch) => (
                  <tr key={batch.batch_public_id}>
                    <td className="px-3 py-2 font-mono text-xs">{batch.batch_public_id}</td>
                    <td className="px-3 py-2">{batch.source_file_name ?? ""}</td>
                    <td className="px-3 py-2">
                      <StatusPill value={batch.status} />
                    </td>
                    <td className="px-3 py-2">{batch.total_rows}</td>
                    <td className="px-3 py-2">{batch.new_student_rows}</td>
                    <td className="px-3 py-2">{batch.committed_new_students}</td>
                    <td className="px-3 py-2">{formatDate(batch.created_at)}</td>
                    <td className="px-3 py-2">{formatDate(batch.committed_at)}</td>
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
