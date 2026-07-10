"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { ErrorPanel } from "./ui";
import type { StructuredApiError } from "./types";

type AssessmentOption = {
  assessment_public_id: string;
  title: string;
  status: string;
  counts: ExportAvailabilityCounts;
  availability: string;
};

type StudentOption = {
  user_id: string;
  display_name: string | null;
  account_status: string;
  counts: ExportAvailabilityCounts;
  availability: string;
};

type ExportAvailabilityCounts = {
  sessions: number;
  item_responses: number;
  process_events: number;
  latency_rows: number;
  conversation_turns: number;
  response_packages: number;
  agent_calls: number;
  activity_attempts: number;
  post_activity_evidence: number;
  diagnostic_snapshots: number;
};

type DictionaryEntry = {
  field: string;
  assessment_csv?: string;
  student_csv?: string;
  matrix_csv?: string;
  definition?: string;
};

type OptionsResponse = {
  export_version: string;
  assessments: AssessmentOption[];
  students: StudentOption[];
  data_dictionary: DictionaryEntry[];
};

function errorFromUnknown(error: unknown): StructuredApiError {
  if (error && typeof error === "object" && "message" in error) {
    return {
      code: "request_failed",
      message: String((error as { message?: unknown }).message ?? "Request failed.")
    };
  }

  return { code: "request_failed", message: "Request failed." };
}

async function fetchOptions(): Promise<OptionsResponse> {
  const response = await fetch("/api/teacher/data-explorer/options", {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message ?? "Data explorer options could not be loaded.");
  }

  return response.json() as Promise<OptionsResponse>;
}

function downloadClassName(disabled: boolean) {
  return [
    "inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold transition",
    disabled
      ? "pointer-events-none border border-slate-200 bg-slate-100 text-slate-400"
      : "border border-accent bg-accent text-white hover:bg-accent-dark"
  ].join(" ");
}

function CountPill({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-full border border-line bg-slate-50 px-2.5 py-1 text-xs font-medium text-muted">
      {label}: <span className="font-semibold text-ink">{value}</span>
    </span>
  );
}

function CountsSummary({ counts }: { counts: ExportAvailabilityCounts }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <CountPill label="sessions" value={counts.sessions} />
      <CountPill label="responses" value={counts.item_responses} />
      <CountPill label="events" value={counts.process_events} />
      <CountPill label="turns" value={counts.conversation_turns} />
      <CountPill label="latencies" value={counts.latency_rows} />
      <CountPill label="packages" value={counts.response_packages} />
      <CountPill label="agent calls" value={counts.agent_calls} />
      <CountPill label="activities" value={counts.activity_attempts} />
    </div>
  );
}

function DownloadLink({
  disabled,
  href,
  label
}: {
  disabled: boolean;
  href: string;
  label: string;
}) {
  return (
    <a aria-disabled={disabled} className={downloadClassName(disabled)} href={disabled ? "#" : href}>
      <Download className="h-4 w-4" aria-hidden="true" />
      {label}
    </a>
  );
}

export function SimpleCsvExplorerClient() {
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [assessmentId, setAssessmentId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const loaded = await fetchOptions();
        if (!cancelled) {
          setOptions(loaded);
          setAssessmentId(loaded.assessments[0]?.assessment_public_id ?? "");
          setStudentId(loaded.students[0]?.user_id ?? "");
        }
      } catch (caught) {
        if (!cancelled) {
          setError(errorFromUnknown(caught));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const assessmentHref = useMemo(
    () =>
      assessmentId
        ? `/api/teacher/data-explorer/assessments/${encodeURIComponent(assessmentId)}/csv`
        : "#",
    [assessmentId]
  );
  const detailedAssessmentHref = useMemo(
    () =>
      assessmentId
        ? `/api/teacher/data-explorer/assessments/${encodeURIComponent(assessmentId)}/detailed-csv`
        : "#",
    [assessmentId]
  );
  const studentHref = useMemo(
    () =>
      studentId ? `/api/teacher/data-explorer/students/${encodeURIComponent(studentId)}/csv` : "#",
    [studentId]
  );
  const detailedStudentHref = useMemo(
    () =>
      studentId
        ? `/api/teacher/data-explorer/students/${encodeURIComponent(studentId)}/detailed-csv`
        : "#",
    [studentId]
  );
  const selectedAssessment = useMemo(
    () =>
      (options?.assessments ?? []).find(
        (assessment) => assessment.assessment_public_id === assessmentId
      ) ?? null,
    [assessmentId, options]
  );
  const selectedStudent = useMemo(
    () => (options?.students ?? []).find((student) => student.user_id === studentId) ?? null,
    [studentId, options]
  );
  const assessmentHasSessions = (selectedAssessment?.counts.sessions ?? 0) > 0;
  const studentHasSessions = (selectedStudent?.counts.sessions ?? 0) > 0;

  return (
    <div className="space-y-5">
      <ErrorPanel error={error} />
      {loading ? (
        <section className="rounded-lg border border-line bg-white p-4 text-sm text-muted">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading data explorer
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="text-lg font-semibold text-ink">Assessment CSVs</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Select one assessment for summary rows or the complete process-data bundle.
          </p>
          <label className="mt-4 flex flex-col gap-2 text-sm font-medium text-ink">
            Assessment
            <select
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
              onChange={(event) => setAssessmentId(event.target.value)}
              value={assessmentId}
            >
              {(options?.assessments ?? []).map((assessment) => (
                <option
                  key={assessment.assessment_public_id}
                  value={assessment.assessment_public_id}
                >
                  {assessment.title} ({assessment.status}) - {assessment.availability}
                </option>
              ))}
            </select>
          </label>
          {selectedAssessment ? (
            <>
              <CountsSummary counts={selectedAssessment.counts} />
              <p className="mt-3 text-sm text-muted">
                {assessmentHasSessions
                  ? selectedAssessment.availability
                  : "No student sessions are available for this assessment."}
              </p>
            </>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <DownloadLink
              disabled={!assessmentId || !assessmentHasSessions}
              href={assessmentHref}
              label="Download summary assessment CSV"
            />
            <DownloadLink
              disabled={!assessmentId || !assessmentHasSessions}
              href={detailedAssessmentHref}
              label="Download detailed assessment ZIP"
            />
          </div>
        </article>

        <article className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="text-lg font-semibold text-ink">Student CSVs</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Select one student for summary rows or the complete process-data bundle.
          </p>
          <label className="mt-4 flex flex-col gap-2 text-sm font-medium text-ink">
            Student
            <select
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
              onChange={(event) => setStudentId(event.target.value)}
              value={studentId}
            >
              {(options?.students ?? []).map((student) => (
                <option key={student.user_id} value={student.user_id}>
                  {student.user_id}
                  {student.display_name ? ` - ${student.display_name}` : ""} ({student.account_status})
                  {" - "}
                  {student.availability}
                </option>
              ))}
            </select>
          </label>
          {selectedStudent ? (
            <>
              <CountsSummary counts={selectedStudent.counts} />
              <p className="mt-3 text-sm text-muted">
                {studentHasSessions
                  ? selectedStudent.availability
                  : "No student sessions are available for this student."}
              </p>
            </>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <DownloadLink
              disabled={!studentId || !studentHasSessions}
              href={studentHref}
              label="Download summary student CSV"
            />
            <DownloadLink
              disabled={!studentId || !studentHasSessions}
              href={detailedStudentHref}
              label="Download detailed student ZIP"
            />
          </div>
        </article>

        <article className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="text-lg font-semibold text-ink">Student x Assessment Matrix</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            All current students crossed with all teacher-owned assessments.
          </p>
          <a
            className={`mt-4 ${downloadClassName(false)}`}
            href="/api/teacher/data-explorer/matrix/csv"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download matrix CSV
          </a>
          <div className="mt-3">
            <DownloadLink
              disabled={false}
              href="/api/teacher/data-explorer/complete-csv"
              label="Download complete authorized ZIP"
            />
          </div>
        </article>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h2 className="text-xl font-semibold text-ink">Data dictionary</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Summary CSVs provide one row per session or student-assessment pair. Detailed ZIPs
          include analysis rows, process events, turn latencies, and readable conversation turns.
        </p>
        <div className="mt-4 overflow-x-auto rounded-lg border border-line">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Field</th>
                <th className="px-3 py-2">Definition</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(options?.data_dictionary ?? []).map((entry) => (
                <tr key={entry.field}>
                  <td className="px-3 py-2 font-mono text-xs text-ink">{entry.field}</td>
                  <td className="px-3 py-2 text-muted">
                    {entry.definition ??
                      [entry.assessment_csv, entry.student_csv, entry.matrix_csv]
                        .filter(Boolean)
                        .join(" ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
