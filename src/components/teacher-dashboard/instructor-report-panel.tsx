"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import type { InstructorReportStatus } from "@/lib/services/instructor-report/service";

// Instructor reporting module (D8, docs/DESIGN_ALIGNMENT_2026-10-17.md). The report is
// a system-generated interpretation; every quoted claim links to the student's
// attempt record so the instructor can check it against the evidence.

const categoryLabels: Record<string, string> = {
  sound_understanding: "Sound understanding",
  partial_understanding: "Partial understanding",
  possible_misconception: "Possible misconception",
  knowledge_gap: "Knowledge gap",
  engagement_pattern: "Engagement pattern",
  item_review_needed: "Item may need review"
};

const sourceLabels: Record<string, string> = {
  initial_response: "justification",
  alternative_reasoning: "alternative-option reasoning",
  conversation: "conversation"
};

export function InstructorReportPanel({ assessmentPublicId }: { assessmentPublicId: string }) {
  const [status, setStatus] = useState<InstructorReportStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/teacher/assessments/${encodeURIComponent(assessmentPublicId)}/instructor-report`, {
        cache: "no-store",
        signal
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "The instructor report could not be loaded.");
      setStatus(body.instructor_report);
    } catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : "The instructor report could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [assessmentPublicId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function generate() {
    setGenerating(true);
    setError("");
    try {
      const response = await fetch(`/api/teacher/assessments/${encodeURIComponent(assessmentPublicId)}/instructor-report`, {
        method: "POST",
        cache: "no-store"
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "The instructor report could not be generated.");
      setStatus(body.instructor_report);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The instructor report could not be generated.");
    } finally {
      setGenerating(false);
    }
  }

  const report = status?.latest_report ?? null;
  const sessionLink = (studentRef: string) => {
    const entry = report?.evidence_index.students[studentRef];
    return entry ? `/teacher/sessions/${encodeURIComponent(entry.session_public_id)}` : null;
  };

  return (
    <section aria-label="Instructor report" className="space-y-5" data-testid="instructor-report-panel">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
        <div className="max-w-3xl">
          <h2 className="text-xl font-semibold text-ualberta-green-dark">Instructor report</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            An AI review of every student&apos;s submitted responses and learning conversation for this mini test.
            Findings are interpretations to check against the linked student records, not verified measures.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          disabled={generating || loading || !status?.generation_available}
          onClick={() => void generate()}
          data-testid="generate-instructor-report"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCcw className="h-4 w-4" aria-hidden="true" />}
          {generating ? "Generating report" : report ? "Generate new report" : "Generate report"}
        </button>
      </div>

      {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p> : null}
      {status && !status.generation_available && status.generation_unavailable_reason ? (
        <p className="rounded-md border border-line bg-slate-50 p-3 text-sm text-muted">{status.generation_unavailable_reason}</p>
      ) : null}
      {loading && !status ? (
        <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading report</p>
      ) : null}
      {!loading && !report ? (
        <p className="rounded-lg border border-dashed border-line bg-white p-6 text-sm text-muted">No report has been generated for this mini test yet.</p>
      ) : null}

      {report ? (
        <article className="space-y-5" data-testid="instructor-report">
          <p className="text-xs text-muted">
            {report.generation_mode === "local_test_summary"
              ? "Local test summary — not AI-generated."
              : `Generated by ${report.model_name}`} · {new Date(report.generated_at).toLocaleString()} · {report.student_count} students · {report.item_count} items
          </p>
          <div className="space-y-2 text-sm leading-6 text-ink">
            <p>{report.report.overview}</p>
            <p className="text-muted">{report.report.participation_summary}</p>
          </div>

          {report.report.findings.length ? (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-ualberta-green-dark">Findings</h3>
              {report.report.findings.map((finding, index) => (
                <div key={`${finding.title}-${index}`} className="rounded-lg border border-border-light bg-white p-4 shadow-soft">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h4 className="font-semibold text-ink">{finding.title}</h4>
                    <span className="text-xs text-muted">
                      {categoryLabels[finding.category] ?? finding.category} · {finding.student_count} students · {finding.evidence_strength} evidence
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-ink">{finding.description}</p>
                  <ul className="mt-3 space-y-2">
                    {finding.evidence.map((evidence, evidenceIndex) => {
                      const href = sessionLink(evidence.student_ref);
                      return (
                        <li key={evidenceIndex} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                          <span className="text-ink">&ldquo;{evidence.quote}&rdquo;</span>
                          <span className="ml-2 text-xs text-muted">
                            {href ? <a className="underline" href={href} target="_blank" rel="noreferrer">{evidence.student_ref}</a> : evidence.student_ref}
                            {evidence.item_ref ? `, ${evidence.item_ref}` : ""}, {sourceLabels[evidence.source] ?? evidence.source}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2 text-xs leading-5 text-muted">Caution: {finding.interpretation_caution}</p>
                </div>
              ))}
            </div>
          ) : null}

          {report.report.item_notes.length ? (
            <div>
              <h3 className="text-lg font-semibold text-ualberta-green-dark">Item notes</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
                {report.report.item_notes.map((note, index) => <li key={index}><span className="font-semibold">{note.item_ref}:</span> {note.note}</li>)}
              </ul>
            </div>
          ) : null}

          <div>
            <h3 className="text-lg font-semibold text-ualberta-green-dark">Learning conversations</h3>
            <p className="mt-2 text-sm leading-6">{report.report.conversation_summary}</p>
          </div>

          {report.report.suggested_instructional_actions.length ? (
            <div>
              <h3 className="text-lg font-semibold text-ualberta-green-dark">Suggested next steps</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
                {report.report.suggested_instructional_actions.map((action, index) => <li key={index}>{action}</li>)}
              </ul>
            </div>
          ) : null}

          {report.report.limitations.length ? (
            <div>
              <h3 className="text-sm font-semibold text-muted">Limitations</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5 text-muted">
                {report.report.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}
              </ul>
            </div>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
