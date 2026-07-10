"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { ErrorPanel } from "./ui";
import type { StructuredApiError } from "./types";

type AssessmentOption = {
  assessment_public_id: string;
  title: string;
  status: string;
};

type StudentOption = {
  user_id: string;
  display_name: string | null;
  account_status: string;
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
  const studentHref = useMemo(
    () =>
      studentId ? `/api/teacher/data-explorer/students/${encodeURIComponent(studentId)}/csv` : "#",
    [studentId]
  );

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
          <h2 className="text-lg font-semibold text-ink">Assessment CSV</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            One selected assessment, with one row per student session attempt.
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
                  {assessment.title} ({assessment.status})
                </option>
              ))}
            </select>
          </label>
          <a className={`mt-4 ${downloadClassName(!assessmentId)}`} href={assessmentHref}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Download assessment CSV
          </a>
        </article>

        <article className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="text-lg font-semibold text-ink">Student CSV</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            One selected student, with one row per assessment session attempt.
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
                </option>
              ))}
            </select>
          </label>
          <a className={`mt-4 ${downloadClassName(!studentId)}`} href={studentHref}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Download student CSV
          </a>
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
        </article>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h2 className="text-xl font-semibold text-ink">Data dictionary</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Simple CSVs summarize counts and safe status fields only. Use the full research export
          when you need row-level transcripts, process timelines, or structured evidence packets.
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
