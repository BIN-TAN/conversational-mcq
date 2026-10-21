"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import type {
  AttemptSection,
  FindingCount,
  InstructorReportV8Finding,
  SectionCounts
} from "@/lib/services/instructor-report/contract";
import type {
  InstructorReportStatus,
  StoredInstructorReportLegacy,
  StoredInstructorReportV8
} from "@/lib/services/instructor-report/service";
import { SERVER_UNAVAILABLE_MESSAGE } from "@/components/server-unavailable-message";

// Instructor reporting module (D8, docs/DESIGN_ALIGNMENT_2026-10-17.md; section 9.7 of
// docs/AI_MODULE_REDESIGN_2026-10-19.md). Every count is computed by the application, with
// first attempts (initial diagnosis) and later attempts (change after feedback) shown
// separately. The narrative, when present, passed the application's checks; each quote links
// to the student's attempt record so the instructor can check it against the evidence.

const SECTIONS: Array<{ key: AttemptSection; title: string; empty: string }> = [
  { key: "first_attempts", title: "First attempts (initial diagnosis)", empty: "No first attempt has been submitted." },
  { key: "later_attempts", title: "Later attempts (change after feedback)", empty: "No student has submitted a later attempt." }
];

const findingTypeLabels: Record<string, string> = {
  shared_difficulty: "Shared difficulty",
  possible_misconception: "Possible misconception",
  sound_understanding: "Sound understanding",
  item_review_needed: "Item review needed"
};

const flagLabels: Record<string, string> = {
  possible_item_issue: "Possible item issue",
  persistent_difficulty: "Persistent difficulty",
  student_requested_instructor: "Student asked for the instructor"
};

const legacyCategoryLabels: Record<string, string> = {
  sound_understanding: "Sound understanding",
  partial_understanding: "Partial understanding",
  possible_misconception: "Possible misconception",
  knowledge_gap: "Knowledge gap",
  engagement_pattern: "Engagement pattern",
  item_review_needed: "Item may need review"
};

const legacySourceLabels: Record<string, string> = {
  initial_response: "justification",
  alternative_reasoning: "alternative-option reasoning",
  conversation: "conversation"
};

const plural = (count: number, singular: string, pluralForm = `${singular}s`) => `${count} ${count === 1 ? singular : pluralForm}`;

function generationLabel(report: StoredInstructorReportV8) {
  if (report.generation_mode === "live_model") return `Narrative by ${report.model_name}, checked by the application`;
  if (report.generation_mode === "local_test") return "Local test report, not AI-generated";
  return "Counts-only report, no narrative";
}

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
      const body = await response.json().catch(() => null);
      if (!body) throw new Error(SERVER_UNAVAILABLE_MESSAGE);
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
      const body = await response.json().catch(() => null);
      if (!body) throw new Error(SERVER_UNAVAILABLE_MESSAGE);
      if (!response.ok) throw new Error(body.error?.message ?? "The instructor report could not be generated.");
      setStatus(body.instructor_report);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The instructor report could not be generated.");
    } finally {
      setGenerating(false);
    }
  }

  const report = status?.latest_report ?? null;

  return (
    <section aria-label="Instructor report" className="space-y-5" data-testid="instructor-report-panel">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
        <div className="max-w-3xl">
          <h2 className="text-xl font-semibold text-ualberta-green-dark">Instructor report</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            A review of every student&apos;s submitted responses and learning conversation for this mini test. The application
            computes every count, with first attempts and later attempts shown separately. The narrative is an interpretation
            to check against the linked student records; it is shown only after it passes the application&apos;s checks.
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
      {status?.narrative_mode === "counts_only" && status.narrative_unavailable_reason ? (
        <p className="rounded-md border border-line bg-slate-50 p-3 text-sm text-muted" data-testid="instructor-report-narrative-unavailable">
          A new report will show the counts only, because {status.narrative_unavailable_reason}
        </p>
      ) : null}
      {loading && !status ? (
        <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading report</p>
      ) : null}
      {!loading && !report ? (
        <p className="rounded-lg border border-dashed border-line bg-white p-6 text-sm text-muted">No report has been generated for this mini test yet.</p>
      ) : null}

      {report?.kind === "v8" ? <ReportV8View report={report} /> : null}
      {report?.kind === "legacy_v1" ? <LegacyReportView report={report} /> : null}
    </section>
  );
}

function ReportV8View({ report }: { report: StoredInstructorReportV8 }) {
  const { counts, narrative } = report;
  const sessionLink = (label: string, section: AttemptSection) => {
    const entry = report.evidence_index.students[label]?.[section];
    return entry ? `/teacher/sessions/${encodeURIComponent(entry.session_public_id)}` : null;
  };
  const numbered = (narrative?.findings ?? []).map((finding, index) => ({ finding, number: index + 1, counts: report.finding_counts[index] ?? null }));

  return (
    <article className="space-y-6" data-testid="instructor-report">
      <p className="text-xs text-muted">
        {generationLabel(report)} · {new Date(report.generated_at).toLocaleString()} · {plural(report.student_count, "student")} · {plural(report.item_count, "item")}
      </p>

      {report.narrative_note ? (
        <p role="note" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950" data-testid="instructor-report-counts-only-note">
          {report.narrative_note}
        </p>
      ) : null}

      {narrative ? <p className="text-sm leading-6 text-ink">{narrative.overview}</p> : null}

      <div>
        <h3 className="text-lg font-semibold text-ualberta-green-dark">Participation</h3>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <CountRow label="Eligible students" value={counts.eligible_students} />
          <CountRow label="Students with a submitted attempt" value={counts.students_with_submitted_attempt} />
          <CountRow label="Students with a first attempt" value={counts.students_with_first_attempt} />
          <CountRow label="Students with a later attempt" value={counts.students_with_later_attempt} />
          <CountRow label="Attempts submitted" value={counts.attempts_submitted} />
          <CountRow
            label="Students by attempts submitted"
            value={counts.students_by_submitted_attempts.map((entry) => `${entry.submitted_attempts}: ${entry.students}`).join(" · ") || "None"}
          />
        </dl>
      </div>

      {SECTIONS.map((section) => (
        <SectionView
          key={section.key}
          title={section.title}
          empty={section.empty}
          counts={counts[section.key]}
          findings={numbered.filter((entry) => entry.finding.attempts === section.key)}
          link={(label) => sessionLink(label, section.key)}
        />
      ))}

      {narrative?.item_notes.length ? (
        <div>
          <h3 className="text-lg font-semibold text-ualberta-green-dark">Item notes</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
            {narrative.item_notes.map((note, index) => <li key={index}><span className="font-semibold">{note.item_label}:</span> {note.note}</li>)}
          </ul>
        </div>
      ) : null}

      {narrative?.suggested_teaching_actions.length ? (
        <div>
          <h3 className="text-lg font-semibold text-ualberta-green-dark">Suggested teaching actions</h3>
          <ul className="mt-2 space-y-2 text-sm leading-6">
            {narrative.suggested_teaching_actions.map((action, index) => (
              <li key={index} className="rounded-md border border-border-light bg-white p-3">
                <p className="text-ink">{action.action}</p>
                <p className="text-xs text-muted">
                  Addresses: {action.addresses}
                  {action.finding_numbers.length ? ` · Finding${action.finding_numbers.length === 1 ? "" : "s"} ${action.finding_numbers.join(", ")}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {narrative?.limits_of_evidence.length || report.application_notes.length ? (
        <div>
          <h3 className="text-sm font-semibold text-muted">Limits of the evidence</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5 text-muted">
            {(narrative?.limits_of_evidence ?? []).map((limit, index) => <li key={`limit-${index}`}>{limit}</li>)}
            {report.application_notes.map((note, index) => <li key={`note-${index}`}>{note}</li>)}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

function CountRow({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-1">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

function SectionView({ title, empty, counts, findings, link }: {
  title: string;
  empty: string;
  counts: SectionCounts;
  findings: Array<{ finding: InstructorReportV8Finding; number: number; counts: FindingCount | null }>;
  link: (label: string) => string | null;
}) {
  const statusById = new Map(counts.item_status.map((row) => [row.item_label, row]));
  return (
    <section className="space-y-4 rounded-lg border border-border-light bg-white p-4 shadow-soft" aria-label={title} data-testid={`instructor-report-${counts.attempts}`}>
      <div>
        <h3 className="text-lg font-semibold text-ualberta-green-dark">{title}</h3>
        <p className="mt-1 text-xs text-muted">
          {plural(counts.students, "student")} · {plural(counts.attempts_submitted, "attempt")} submitted
          {counts.attempts_by_number.length ? ` (${counts.attempts_by_number.map((entry) => `attempt ${entry.attempt_number}: ${entry.attempts}`).join(", ")})` : ""}
          {" "}· {counts.attempts_finished} finished · current-version profiles {counts.records.current_version}, fallback profiles {counts.records.current_version_fallback}, earlier-version records {counts.records.earlier_version}
        </p>
      </div>

      {counts.students === 0 ? <p className="text-sm text-muted">{empty}</p> : (
        <>
          <div>
            <h4 className="text-sm font-semibold text-ink">Summary distribution</h4>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {counts.summary_distribution.labels.map((entry) => <li key={entry.label}>{entry.label}: <span className="font-medium">{entry.students}</span></li>)}
              <li className="text-muted">Earlier-version records (no summary under the current rules): {counts.summary_distribution.earlier_version_records}</li>
            </ul>
            {counts.summary_distribution.fallback_profiles ? (
              <p className="mt-1 text-xs text-muted">Unavailable includes {plural(counts.summary_distribution.fallback_profiles, "fallback profile")}.</p>
            ) : null}
          </div>

          <div className="overflow-x-auto border-y border-line" tabIndex={0} role="region" aria-label={`${title}: responses and item status`}>
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2">Item</th>
                  <th className="p-2">Options chosen (key marked)</th>
                  <th className="p-2">I don&apos;t know yet</th>
                  <th className="p-2">No answer</th>
                  <th className="p-2">Supported</th>
                  <th className="p-2">Partly supported</th>
                  <th className="p-2">Not supported</th>
                  <th className="p-2">Not interpretable</th>
                  <th className="p-2">Possible item issue flags</th>
                </tr>
              </thead>
              <tbody>
                {counts.option_distribution.map((row) => {
                  const statusRow = statusById.get(row.item_label);
                  return (
                    <tr key={row.item_label} className="border-t border-line align-top">
                      <th className="p-2 font-medium">{row.item_label}<span className="block text-xs font-normal text-muted">{plural(row.responses, "response")}</span></th>
                      <td className="p-2">
                        {row.options.map((option) => (
                          <span key={option.option} className="mr-3 inline-block">
                            {option.option}{option.correct ? " (key)" : ""}: <span className="font-medium">{option.count}</span>
                          </span>
                        ))}
                      </td>
                      <td className="p-2">{row.i_dont_know}</td>
                      <td className="p-2">{row.no_answer}</td>
                      <td className="p-2">{statusRow?.supported ?? 0}</td>
                      <td className="p-2">{statusRow?.partly_supported ?? 0}</td>
                      <td className="p-2">{statusRow?.not_supported ?? 0}</td>
                      <td className="p-2">{statusRow?.not_interpretable ?? 0}<span className="block text-xs text-muted">of {statusRow?.rated ?? 0} rated</span></td>
                      <td className="p-2">{statusRow?.possible_item_issue_flags ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {counts.possible_misconceptions.length ? (
            <GroupTable
              title="Possible misconceptions (students with each)"
              rows={counts.possible_misconceptions.map((group) => ({
                key: group.grouped_by,
                cells: [group.grouped_by, group.item_labels.join(", "), String(group.students), String(group.endorsed_students), String(group.tentative_students), group.example_ideas.join(" | ")]
              }))}
              headings={["Grouped by", "Items", "Students", "Endorsed", "Tentative", "Ideas as recorded"]}
            />
          ) : <p className="text-xs text-muted">No possible misconception is recorded in the current-version profiles.</p>}

          {counts.considered_ideas.length ? (
            <GroupTable
              title="Ideas considered but not endorsed (unconfirmed)"
              rows={counts.considered_ideas.map((group) => ({
                key: group.grouped_by,
                cells: [group.grouped_by, group.item_labels.join(", "), String(group.students), group.example_ideas.join(" | ")]
              }))}
              headings={["Grouped by", "Items", "Students", "Ideas as recorded"]}
            />
          ) : null}

          {counts.answer_patterns.length ? (
            <GroupTable
              title="Answer patterns from choices only (unconfirmed)"
              rows={counts.answer_patterns.map((pattern) => ({
                key: pattern.shared_tag,
                cells: [`Answer choices consistent with ${pattern.shared_tag}`, pattern.item_labels.join(", "), String(pattern.students)]
              }))}
              headings={["Pattern", "Items", "Students"]}
            />
          ) : null}

          <div>
            <h4 className="text-sm font-semibold text-ink">Learning conversations</h4>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <li>Held: <span className="font-medium">{counts.conversations.held}</span></li>
              <li>Ended by the student: <span className="font-medium">{counts.conversations.ended_by_student}</span></li>
              <li>With turn records: <span className="font-medium">{counts.conversations.students_with_turn_records}</span></li>
              <li>Corrected reasoning expressed after support: <span className="font-medium">{counts.conversations.corrected_reasoning_expressed_after_support}</span></li>
              <li>Difficulty still evident: <span className="font-medium">{counts.conversations.difficulty_still_evident}</span></li>
              {counts.conversations.instructor_review_flags.map((flag) => (
                <li key={flag.flag}>{flagLabels[flag.flag] ?? flag.flag}: <span className="font-medium">{flag.students}</span></li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted">Counts of students. Corrected reasoning expressed after support describes what a student wrote with help; it is not evidence of mastery.</p>
          </div>
        </>
      )}

      {findings.length ? (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-ink">Findings</h4>
          {findings.map((entry) => <FindingView key={entry.number} {...entry} link={link} />)}
        </div>
      ) : null}
    </section>
  );
}

function GroupTable({ title, headings, rows }: { title: string; headings: string[]; rows: Array<{ key: string; cells: string[] }> }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-ink">{title}</h4>
      <div className="mt-1 overflow-x-auto border-y border-line" tabIndex={0} role="region" aria-label={title}>
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="bg-gray-50"><tr>{headings.map((heading) => <th key={heading} className="p-2">{heading}</th>)}</tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-line align-top">
                {row.cells.map((cell, index) => <td key={index} className="p-2">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FindingView({ finding, number, counts, link }: {
  finding: InstructorReportV8Finding;
  number: number;
  counts: FindingCount | null;
  link: (label: string) => string | null;
}) {
  const labels = counts?.student_labels ?? [...new Set(finding.students_covered)];
  return (
    <div className="rounded-lg border border-border-light bg-white p-4" data-testid="instructor-report-finding">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h5 className="font-semibold text-ink">Finding {number}: {finding.title}</h5>
        <span className="text-xs text-muted">{findingTypeLabels[finding.type] ?? finding.type}{finding.item_labels.length ? ` · ${finding.item_labels.join(", ")}` : ""}</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        Students covered (counted by the application): <span className="font-medium text-ink">{counts?.students_covered ?? labels.length}</span>
        {labels.length ? " · " : ""}
        {labels.map((label, index) => {
          const href = link(label);
          return (
            <span key={label}>
              {index ? ", " : ""}
              {href ? <a className="underline" href={href} target="_blank" rel="noreferrer">{label}</a> : label}
            </span>
          );
        })}
        {counts?.earlier_version_students ? ` · ${plural(counts.earlier_version_students, "earlier-version record")}` : ""}
      </p>
      {counts?.profile_misconceptions ? (
        <p className="text-xs text-muted">
          Profiles of these students on these items: {counts.profile_misconceptions.endorsed} endorsed, {counts.profile_misconceptions.tentative} tentative,
          {" "}{counts.profile_misconceptions.none_recorded} with no possible misconception recorded.
        </p>
      ) : null}
      <p className="mt-2 text-sm leading-6 text-ink">{finding.description}</p>
      {finding.quotes.length ? (
        <ul className="mt-3 space-y-2">
          {finding.quotes.map((quote, index) => {
            const href = link(quote.student_label);
            return (
              <li key={index} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                <span className="text-ink">&ldquo;{quote.quote}&rdquo;</span>
                <span className="ml-2 text-xs text-muted">
                  {href ? <a className="underline" href={href} target="_blank" rel="noreferrer">{quote.student_label}</a> : quote.student_label}
                  {quote.item_label ? `, ${quote.item_label}` : ""}, {quote.source === "conversation" ? "conversation" : "response"}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="mt-2 text-xs leading-5 text-muted">Caution: {finding.caution}</p>
    </div>
  );
}

/** Reports saved by the first version of the module, shown as saved. */
function LegacyReportView({ report }: { report: StoredInstructorReportLegacy }) {
  const sessionLink = (studentRef: string) => {
    const entry = report.evidence_index.students[studentRef];
    return entry ? `/teacher/sessions/${encodeURIComponent(entry.session_public_id)}` : null;
  };
  return (
    <article className="space-y-5" data-testid="instructor-report">
      <p role="note" className="rounded-md border border-line bg-slate-50 p-3 text-sm text-muted">
        This report was produced by an earlier version of the report module. Its counts were written by the model and its findings
        combine first and later attempts. Generate a new report for application counts with first and later attempts shown separately.
      </p>
      <p className="text-xs text-muted">
        {report.generation_mode === "local_test_summary" ? "Local test summary, not AI-generated." : `Generated by ${report.model_name}`} · {new Date(report.generated_at).toLocaleString()} · {plural(report.student_count, "student")} · {plural(report.item_count, "item")}
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
                <span className="text-xs text-muted">{legacyCategoryLabels[finding.category] ?? finding.category} · {finding.evidence_strength} evidence</span>
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
                        {evidence.item_ref ? `, ${evidence.item_ref}` : ""}, {legacySourceLabels[evidence.source] ?? evidence.source}
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
  );
}
