"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Clipboard, RefreshCw, Save, ShieldOff, ShieldCheck } from "lucide-react";
import {
  deactivateStudent,
  errorFromUnknown,
  fetchStudent,
  reactivateStudent,
  resetStudentAccessCode,
  updateStudentDisplayName
} from "./api";
import type { CredentialResponse, StructuredApiError, StudentDetailResponse } from "./types";
import {
  CredentialResult,
  EmptyPanel,
  ErrorPanel,
  formatDate,
  LoadingPanel,
  StatusPill
} from "./ui";

export function StudentDetailClient({ userId }: { userId: string }) {
  const [data, setData] = useState<StudentDetailResponse | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [credentials, setCredentials] = useState<CredentialResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchStudent(userId);
      setData(result);
      setDisplayName(result.student.display_name ?? "");
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveDisplayName() {
    setError(null);
    setMessage(null);
    setCredentials(null);

    try {
      await updateStudentDisplayName(userId, displayName);
      setMessage("Display name updated.");
      await load();
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    }
  }

  async function resetCode() {
    if (
      !window.confirm(
        "The previous access code will stop working, and active login sessions will be invalidated."
      )
    ) {
      return;
    }

    setError(null);
    setMessage(null);

    try {
      const result = await resetStudentAccessCode(userId);
      setCredentials({
        one_time_credentials: result.one_time_credentials,
        credential_csv: result.credential_csv,
        credential_warning: result.credential_warning
      });
      setMessage("Access code reset. Record the new code now.");
      await load();
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    }
  }

  async function setStatus(nextStatus: "active" | "inactive") {
    const prompt =
      nextStatus === "inactive"
        ? "The student will not be able to log in until the account is reactivated. Existing assessment and research data will be preserved."
        : "The student will be able to log in again using the current access code.";

    if (!window.confirm(prompt)) {
      return;
    }

    setError(null);
    setMessage(null);
    setCredentials(null);

    try {
      if (nextStatus === "inactive") {
        await deactivateStudent(userId);
        setMessage("Student account deactivated.");
      } else {
        await reactivateStudent(userId);
        setMessage("Student account reactivated.");
      }
      await load();
    } catch (requestError) {
      setError(errorFromUnknown(requestError));
    }
  }

  const student = data?.student;
  const firstCode = credentials?.one_time_credentials[0]?.temporary_access_code;

  return (
    <div className="space-y-5">
      <ErrorPanel error={error} />
      {loading ? <LoadingPanel label="Loading student detail" /> : null}
      {message ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          {message}
        </section>
      ) : null}

      {student ? (
        <>
          <section className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-line bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">user_id</p>
              <p className="mt-2 font-semibold text-ink">{student.user_id}</p>
            </div>
            <div className="rounded-lg border border-line bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Status</p>
              <p className="mt-2">
                <StatusPill value={student.account_status} />
              </p>
            </div>
            <div className="rounded-lg border border-line bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Last login</p>
              <p className="mt-2 text-sm text-ink">{formatDate(student.last_login_at)}</p>
            </div>
            <div className="rounded-lg border border-line bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Credential updated
              </p>
              <p className="mt-2 text-sm text-ink">{formatDate(student.credential_updated_at)}</p>
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h2 className="text-xl font-semibold text-ink">Account actions</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
              <label className="flex flex-col gap-2 text-sm font-medium text-ink">
                Display name
                <input
                  className="h-10 rounded-md border border-line px-3 text-sm"
                  onChange={(event) => setDisplayName(event.target.value)}
                  value={displayName}
                />
              </label>
              <button
                className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent"
                onClick={() => void saveDisplayName()}
                type="button"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                Save display name
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent"
                onClick={() => void resetCode()}
                type="button"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Reset access code
              </button>
              {student.account_status === "active" ? (
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-950 hover:border-amber-500"
                  onClick={() => void setStatus("inactive")}
                  type="button"
                >
                  <ShieldOff className="h-4 w-4" aria-hidden="true" />
                  Deactivate
                </button>
              ) : (
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 text-sm font-semibold text-emerald-950 hover:border-emerald-500"
                  onClick={() => void setStatus("active")}
                  type="button"
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  Reactivate
                </button>
              )}
            </div>
            <p className="mt-4 text-sm leading-6 text-muted">
              user_id is immutable in this UI. There is no delete action; deactivate incorrect
              accounts to preserve research linkage.
            </p>
          </section>

          {firstCode ? (
            <button
              className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent"
              onClick={() => navigator.clipboard.writeText(firstCode)}
              type="button"
            >
              <Clipboard className="h-4 w-4" aria-hidden="true" />
              Copy temporary access code
            </button>
          ) : null}
          {credentials ? (
            <CredentialResult
              credentials={credentials.one_time_credentials}
              credentialCsv={credentials.credential_csv}
              warning={credentials.credential_warning}
            />
          ) : null}

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h2 className="text-xl font-semibold text-ink">Assessment sessions</h2>
            {student.assessment_sessions.length === 0 ? (
              <EmptyPanel title="No assessment sessions for this student." />
            ) : (
              <div className="mt-4 overflow-x-auto rounded-lg border border-line">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-2">Session</th>
                      <th className="px-3 py-2">Assessment</th>
                      <th className="px-3 py-2">Attempt</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Phase</th>
                      <th className="px-3 py-2">Last activity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {student.assessment_sessions.map((session) => (
                      <tr key={session.session_public_id}>
                        <td className="px-3 py-2">
                          <Link
                            className="font-semibold text-accent hover:underline"
                            href={`/teacher/sessions/${session.session_public_id}`}
                          >
                            {session.session_public_id}
                          </Link>
                        </td>
                        <td className="px-3 py-2">{session.assessment_title}</td>
                        <td className="px-3 py-2">{session.attempt_number}</td>
                        <td className="px-3 py-2">{session.status}</td>
                        <td className="px-3 py-2">{session.current_phase}</td>
                        <td className="px-3 py-2">{formatDate(session.last_activity_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h2 className="text-xl font-semibold text-ink">Summative outcomes</h2>
            {student.summative_outcomes.length === 0 ? (
              <EmptyPanel title="No active summative outcomes for this student." />
            ) : (
              <div className="mt-4 overflow-x-auto rounded-lg border border-line">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-2">Outcome</th>
                      <th className="px-3 py-2">Score</th>
                      <th className="px-3 py-2">Max</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {student.summative_outcomes.map((outcome) => (
                      <tr key={outcome.outcome_public_id}>
                        <td className="px-3 py-2">{outcome.outcome_name}</td>
                        <td className="px-3 py-2">{outcome.outcome_score}</td>
                        <td className="px-3 py-2">{outcome.max_score}</td>
                        <td className="px-3 py-2">{outcome.assessment_date}</td>
                        <td className="px-3 py-2">{outcome.notes ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h2 className="text-xl font-semibold text-ink">Account event history</h2>
            {student.account_events.length === 0 ? (
              <EmptyPanel title="No account events recorded." />
            ) : (
              <div className="mt-4 overflow-x-auto rounded-lg border border-line">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-2">Event</th>
                      <th className="px-3 py-2">Performed by</th>
                      <th className="px-3 py-2">Roster batch</th>
                      <th className="px-3 py-2">Created</th>
                      <th className="px-3 py-2">Metadata</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {student.account_events.map((event) => (
                      <tr key={event.event_public_id}>
                        <td className="px-3 py-2">{event.event_type.replace(/_/g, " ")}</td>
                        <td className="px-3 py-2">{event.performed_by_user_id}</td>
                        <td className="px-3 py-2">
                          {event.roster_import_batch?.batch_public_id ?? ""}
                        </td>
                        <td className="px-3 py-2">{formatDate(event.created_at)}</td>
                        <td className="px-3 py-2">
                          <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs">
                            {JSON.stringify(event.metadata, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
