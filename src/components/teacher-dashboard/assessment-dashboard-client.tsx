"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { plainReviewReason } from "@/lib/teacher-plain-labels";
import { AttemptComparisonPanel } from "./attempt-comparison-panel";
import { InstructorReportPanel } from "./instructor-report-panel";
import { InterpretationV8Panel } from "./interpretation-v8-panel";
import { ItemReviewPanel } from "./item-review-panel";
import type {
  CandidateMisconceptionPattern,
  ChartDatum,
  ItemDiagnosticSummary,
  StudentFollowUpRow,
  TeacherAssessmentDashboard
} from "@/lib/services/teacher-dashboard/assessment-dashboard";
import { followUpPriority } from "@/lib/services/teacher-dashboard/follow-up";
import { ItemContent } from "@/components/item-content";
import { hasRichItemContent } from "@/lib/item-content/rich-text";
import { assessmentLibraryFolder } from "@/lib/assessment-library-order";


type DashboardResponse = {
  dashboard: TeacherAssessmentDashboard;
};

/** Consecutive mini tests of one category, in the order the server sends them (the library's). */
function assessmentGroups(assessments: TeacherAssessmentDashboard["assessments"]) {
  const groups: Array<{ folder: string; assessments: TeacherAssessmentDashboard["assessments"] }> = [];
  for (const assessment of assessments) {
    const folder = assessmentLibraryFolder(assessment);
    const last = groups.at(-1);
    if (last && last.folder === folder) last.assessments.push(assessment);
    else groups.push({ folder, assessments: [assessment] });
  }
  return groups;
}

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatMinutes(value: number | null) {
  if (value === null) return "Not available";
  if (value > 0 && value < 1) return "< 1 min";
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)} min`;
}

function timeMetricLabel(value: TeacherAssessmentDashboard["time_indicator"]["time_metric_type"]) {
  if (value === "recorded_item_response_ms") return "Recorded item-time totals; may include pauses and omit unrecorded intervals. Conversation time is separate";
  if (value === "elapsed_wall_clock_ms") return "Elapsed wall-clock time";
  return "Unavailable";
}

function barWidth(percentage: number) {
  if (percentage <= 0) return "0%";
  return `${Math.max(percentage, 3)}%`;
}

function BarChart({
  data,
  tone = "green",
  ariaLabel
}: {
  data: ChartDatum[];
  tone?: "green" | "gold" | "slate";
  ariaLabel: string;
}) {
  const color =
    tone === "gold"
      ? "bg-ualberta-gold"
      : tone === "slate"
        ? "bg-slate-500"
        : "bg-ualberta-green";
  const summary = data.map((entry) => `${entry.label}: ${entry.count} (${entry.percentage}%)`).join("; ");

  return (
    <div className="space-y-3" aria-label={ariaLabel} role="list">
      <p className="sr-only">{summary}</p>
      {data.map((entry) => (
        <div key={entry.label} role="listitem">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-ink">{entry.label}</span>
            <span className="text-muted">
              {formatCount(entry.count)} ({entry.percentage}%)
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100" aria-hidden="true">
            <div className={`h-2 rounded-full ${color}`} style={{ width: barWidth(entry.percentage) }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ChartCard({
  title,
  data,
  sampleSize,
  tone,
  understanding
}: {
  title: string;
  data: ChartDatum[];
  sampleSize: number;
  tone?: "green" | "gold" | "slate";
  /** Which submitted attempt the understanding labels come from. */
  understanding?: { basis: "initial" | "latest"; studentsWithLaterAttempt: number };
}) {
  return (
    <section className="h-full rounded-lg border border-border-light bg-white p-5 shadow-soft">
      <h2 className="text-lg font-semibold text-ualberta-green-dark">{title}</h2>
      <p className="sr-only">Total students: {formatCount(sampleSize)}.</p>
      <div className="mt-4">
        <BarChart data={data} tone={tone} ariaLabel={`${title}: counts and percentages`} />
      </div>
      {understanding && <div className="mt-4 border-t border-line pt-3 text-sm text-muted">
        <p>
          {understanding.basis === "initial"
            ? "Each student's first submitted attempt, before any feedback."
            : `Each student's most recent submitted attempt. ${formatCount(understanding.studentsWithLaterAttempt)} ${understanding.studentsWithLaterAttempt === 1 ? "student has" : "students have"} a later attempt; for the others this matches the initial label.`}
        </p>
        <details className="mt-2">
          <summary className="cursor-pointer font-semibold text-ink">Evidence behind these labels</summary>
          <div className="mt-2 space-y-2 leading-6">
            <p>Percentages include all {sampleSize} students, including those who have not submitted. Missing or uncertain evidence is not a finding of poor understanding.</p>
            <p>Mostly understood means supported understanding of most assessed content, not complete mastery. The mini-test does not assess transfer to new situations. A profile of partial or fragile understanding remains Still developing.</p>
            <p>
              {understanding.basis === "initial"
                ? "Each label comes from the profile produced when that attempt was submitted. Later attempts and conversations never change it."
                : "A later attempt follows the answer review and any conversation, so a change from the initial label reflects feedback, memory and further study together."}
            </p>
          </div>
        </details>
      </div>}
    </section>
  );
}

function ParticipationStatusCard({ dashboard }: { dashboard: TeacherAssessmentDashboard }) {
  const timeIndicator = dashboard.time_indicator;
  const responseTimeNote =
    timeIndicator.sample_size > 0 && timeIndicator.sample_size < dashboard.eligible_student_count
      ? `Response-time data available for ${formatCount(timeIndicator.sample_size)} completed attempts.`
      : null;

  return (
    <section className="h-full rounded-lg border border-border-light bg-white p-5 shadow-soft">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ualberta-green-dark">Participation status</h2>
          <p className="sr-only">Mutually exclusive latest-attempt participation categories.</p>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
          <div>
            <dt className="font-semibold text-muted">Total students</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">{formatCount(dashboard.eligible_student_count)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-muted">{timeIndicator.time_metric_type === "recorded_item_response_ms" ? "Average item-time total" : "Average elapsed time"}</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">{formatMinutes(timeIndicator.average_minutes)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-muted">{timeIndicator.time_metric_type === "recorded_item_response_ms" ? "Median item-time total" : "Median elapsed time"}</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">{formatMinutes(timeIndicator.median_minutes)}</dd>
          </div>
        </dl>
      </div>
      <div className="mt-5">
        <BarChart
          data={dashboard.status_distribution}
          ariaLabel="Participation status: counts and percentages"
        />
      </div>
      {responseTimeNote ? (
        <p className="mt-3 text-xs leading-5 text-muted">{responseTimeNote}</p>
      ) : null}
      {timeIndicator.time_metric_type !== "unavailable" ? (
        <p className="mt-2 text-xs leading-5 text-muted">{timeMetricLabel(timeIndicator.time_metric_type)}{timeIndicator.time_metric_type === "elapsed_wall_clock_ms" ? "; includes pauses and the learning conversation" : ""}.</p>
      ) : null}
    </section>
  );
}

/** Option counts with the answer key marked. Labels such as "B (not in administered option set)" stay as computed. */
function ItemDiagnostic({ item }: { item: ItemDiagnosticSummary }) {
  // A stem with formulas or a table is always offered in full, drawn by the item renderer.
  const stemShortened =
    item.item_stem.replace(/\s+/g, " ").trim() !== item.item_stem_preview || hasRichItemContent(item.item_stem);
  return (
    <article className="rounded-lg border border-border-light bg-white p-5 shadow-soft">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Question {item.item_order}</p>
          <h3 className="mt-1 max-w-3xl break-words text-base font-semibold leading-6 text-ink">
            {item.item_stem_preview}
          </h3>
          {stemShortened ? (
            <details className="mt-2 max-w-3xl text-sm">
              <summary className="cursor-pointer font-semibold text-accent">Show the full question</summary>
              <ItemContent className="mt-2 whitespace-pre-wrap break-words leading-6 text-ink" text={item.item_stem} />
            </details>
          ) : null}
        </div>
        <Link
          className="inline-flex h-9 w-fit shrink-0 items-center gap-2 rounded-md border border-line bg-white px-3 text-xs font-semibold text-ink hover:border-accent"
          href={`/teacher/content/items/${encodeURIComponent(item.item_public_id)}`}
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          Open question {item.item_order}
        </Link>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {item.response_count === 0 ? (
          <div className="rounded-md border border-dashed border-line bg-slate-50 p-4 text-sm text-muted lg:col-span-3">
            No initial responses to this item yet.
          </div>
        ) : (
          <>
            <div>
              <h4 className="text-sm font-semibold text-ink">Correct and incorrect</h4>
              <div className="mt-3">
                <BarChart
                  data={item.correctness_distribution}
                  tone="green"
                  ariaLabel={`Question ${item.item_order} correct and incorrect initial responses`}
                />
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-ink">Confidence distribution</h4>
              <div className="mt-3">
                <BarChart
                  data={item.confidence_distribution}
                  tone="gold"
                  ariaLabel={`Question ${item.item_order} confidence distribution`}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

export function candidatePatternRuleText(threshold: number) {
  return `Shown when at least ${threshold} students chose this wrong answer with medium or high confidence and gave the same reasoning.`;
}

const CANDIDATE_PATTERN_GROUPING_TEXT =
  "Reasons count as the same when their words match after ignoring capitalization, punctuation and openings such as \"I think\" or \"because\"; very short reasons are not grouped. Each student's first submitted attempt is counted once.";

function CandidatePatterns({ patterns, threshold }: { patterns: CandidateMisconceptionPattern[]; threshold: number }) {
  if (patterns.length === 0) {
    return (
      <section className="rounded-lg border border-border-light bg-white p-5 shadow-soft">
        <h2 className="text-lg font-semibold text-ualberta-green-dark">Candidate misconception patterns</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          No wrong answer has yet been chosen by at least {threshold} students with medium or high confidence and the same reasoning.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border-light bg-white p-5 shadow-soft">
      <h2 className="text-lg font-semibold text-ualberta-green-dark">Candidate misconception patterns</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
        Wrong answers that several students chose for the same reason in their first submitted attempt. They are
        possible misconceptions for you to review, not confirmed ones, found by matching students&apos; answers and reasons.
      </p>
      <div className="mt-4 space-y-4">
        {patterns.map((pattern) => (
          <article className="rounded-md border border-line bg-slate-50 p-4" key={pattern.pattern_id}>
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <h3 className="font-semibold text-ink">
                  Question {pattern.item_order}, option {pattern.option_selected}
                </h3>
                <p className="mt-1 text-sm text-muted">
                  Chosen by {pattern.unique_student_count} students with the same reasoning. {pattern.confidence_summary}.
                </p>
                <p className="mt-1 text-xs text-muted">
                  {candidatePatternRuleText(pattern.threshold_unique_student_count)}
                </p>
              </div>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
                Candidate only
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-ink">
              Shared reasoning: {pattern.reasoning_group_label}
            </p>
            {pattern.representative_reasoning_snippets.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
                {pattern.representative_reasoning_snippets.map((snippet) => (
                  <li className="rounded border border-line bg-white px-3 py-2" key={snippet}>
                    {snippet}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 text-xs leading-5 text-muted">{CANDIDATE_PATTERN_GROUPING_TEXT}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function understandingTone(value: string) {
  if (value === "Need more work") return "text-red-800 font-semibold";
  if (value === "Mostly understood") return "text-emerald-800";
  return "text-ink";
}

function StudentsToFollowUp({ rows }: { rows: StudentFollowUpRow[] }) {
  const [showAll, setShowAll] = useState(false);
  if (rows.length === 0) return null;
  const priorityCount = rows.filter((row) => followUpPriority(row) < 2).length;
  const visible = showAll || priorityCount === 0 ? rows : rows.slice(0, priorityCount);
  return (
    <section className="rounded-lg border border-border-light bg-white p-5 shadow-soft" aria-labelledby="students-to-follow-up">
      <h2 id="students-to-follow-up" className="text-lg font-semibold text-ualberta-green-dark">Students to follow up</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
        Students whose latest result is Need more work, or whose learning conversation recommended instructor
        assistance, are listed first, then students flagged for review.
        {priorityCount === 0 ? " No student needs follow-up right now." : ""}
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[640px] w-full text-left text-sm">
          <caption className="sr-only">Students to follow up, most urgent first</caption>
          <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="py-2 pr-3">Student</th>
              <th scope="col" className="py-2 pr-3">Initial understanding</th>
              <th scope="col" className="py-2 pr-3">Latest understanding</th>
              <th scope="col" className="py-2 pr-3">Learning conversation</th>
              <th scope="col" className="py-2 pr-3">Review</th>
              <th scope="col" className="py-2"><span className="sr-only">Session</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visible.map((row) => (
              <tr key={row.session_public_id} className="align-top">
                <th scope="row" className="py-2 pr-3 font-semibold text-ink">
                  <span className="block break-words">{row.student_name}</span>
                  {row.student_name !== row.student_user_id ? <span className="block text-xs font-normal text-muted">{row.student_user_id}</span> : null}
                  <span className="block text-xs font-normal text-muted">Attempt {row.attempt_number}</span>
                </th>
                <td className={`py-2 pr-3 ${understandingTone(row.initial_understanding)}`}>{row.initial_understanding}</td>
                <td className={`py-2 pr-3 ${understandingTone(row.latest_understanding)}`}>{row.latest_understanding}</td>
                <td className={`py-2 pr-3 ${row.conversation_update === "Instructor assistance recommended" ? "font-semibold text-amber-900" : "text-ink"}`}>{row.conversation_update}</td>
                <td className="py-2 pr-3 text-ink">
                  {row.needs_review ? (
                    <>
                      <span className="font-semibold text-red-800">Needs review</span>
                      {plainReviewReason(row.needs_review_reason) ? <span className="mt-1 block max-w-64 text-xs text-muted">{plainReviewReason(row.needs_review_reason)}</span> : null}
                    </>
                  ) : <span className="text-muted">Not flagged</span>}
                </td>
                <td className="py-2">
                  <Link className="inline-flex h-8 items-center whitespace-nowrap rounded-md border border-line bg-white px-3 text-xs font-semibold text-ink hover:border-accent"
                    href={`/teacher/sessions/${encodeURIComponent(row.session_public_id)}`} aria-label={`Open the session of ${row.student_name}`}>
                    Open session
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {priorityCount > 0 && rows.length > priorityCount ? (
        <button type="button" className="mt-3 text-sm font-semibold text-accent" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show only students to follow up" : `Show all ${formatCount(rows.length)} students`}
        </button>
      ) : null}
    </section>
  );
}

async function fetchDashboard(assessmentPublicId: string) {
  const params = new URLSearchParams();
  if (assessmentPublicId) {
    params.set("assessment_public_id", assessmentPublicId);
  }
  const response = await fetch(`/api/teacher/dashboard?${params.toString()}`, {
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Assessment dashboard could not be loaded.");
  }

  return (payload as DashboardResponse).dashboard;
}

type DashboardView = "overview" | "attempts" | "items" | "report";
const dashboardTabs: ReadonlyArray<readonly [DashboardView, string]> = [
  ["overview", "Overview"],
  ["attempts", "Compare attempts"],
  ["items", "Item review"],
  ["report", "Instructor report"]
];

export function AssessmentDashboardClient({ initialDashboard }: { initialDashboard: TeacherAssessmentDashboard }) {
  const [view, setViewState] = useState<DashboardView>("overview");
  // Panels stay mounted (hidden) once opened, so switching tabs does not reload them.
  const [visited, setVisited] = useState<ReadonlySet<DashboardView>>(() => new Set<DashboardView>(["overview"]));
  function setView(next: DashboardView) {
    setViewState(next);
    setVisited((current) => current.has(next) ? current : new Set([...current, next]));
  }
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState(initialDashboard.selected_assessment_public_id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTitle = dashboard.selected_assessment?.title ?? "No assessment selected";
  const hasAssessment = Boolean(dashboard.selected_assessment);
  const hasStudentData = dashboard.has_student_data;

  const sortedItems = useMemo(
    () => [...dashboard.item_diagnostics].sort((left, right) => left.item_order - right.item_order),
    [dashboard.item_diagnostics]
  );

  async function selectAssessment(nextAssessmentId: string) {
    setSelectedAssessmentId(nextAssessmentId);
    setLoading(true);
    setError(null);
    try {
      setDashboard(await fetchDashboard(nextAssessmentId));
      // Other tabs load again for the new mini test only when opened.
      setVisited(new Set<DashboardView>([view]));
    } catch (caught) {
      setSelectedAssessmentId(dashboard.selected_assessment_public_id ?? "");
      setError(caught instanceof Error ? caught.message : "Assessment dashboard could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border-light bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-ink">{selectedTitle}</h2>
          </div>
          <label className="block w-full text-sm font-semibold text-ink sm:w-auto sm:min-w-[280px]">
            Assessment / mini test
            <select
              className="mt-2 w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-normal text-ink"
              disabled={loading || dashboard.assessments.length === 0}
              onChange={(event) => void selectAssessment(event.target.value)}
              value={selectedAssessmentId}
            >
              {/* Grouped by category, in the assessment library's order (the server sends them in that order). */}
              {assessmentGroups(dashboard.assessments).map((group) => (
                <optgroup key={group.folder} label={group.folder}>
                  {group.assessments.map((assessment) => (
                    <option key={assessment.assessment_public_id} value={assessment.assessment_public_id}>
                      {assessment.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        </section>
      ) : null}
      {loading ? (
        <section className="rounded-lg border border-line bg-white p-4 text-sm text-muted">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading assessment dashboard
          </div>
        </section>
      ) : null}

      {hasAssessment && <div role="tablist" aria-label="Dashboard view" className="-mx-1 flex gap-x-5 overflow-x-auto border-b border-line px-1">
        {dashboardTabs.map(([value, title], index) =>
          <button key={value} type="button" role="tab" id={`dashboard-tab-${value}`} aria-selected={view === value}
            aria-controls={`dashboard-panel-${value}`} tabIndex={view === value ? 0 : -1}
            onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const last = dashboardTabs.length - 1;
              const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? last
                : event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : (index === 0 ? last : index - 1);
              const next = dashboardTabs[nextIndex][0];
              setView(next); document.getElementById(`dashboard-tab-${next}`)?.focus();
            } }} onClick={() => setView(value)} className={`shrink-0 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-semibold ${view === value ? "border-accent text-accent" : "border-transparent text-muted"}`}>{title}</button>)}
      </div>}
      {hasAssessment && visited.has("report") && <div role="tabpanel" id="dashboard-panel-report" aria-labelledby="dashboard-tab-report" hidden={view !== "report"}>
        <InstructorReportPanel key={dashboard.selected_assessment_public_id} assessmentPublicId={dashboard.selected_assessment_public_id!} />
      </div>}
      {hasAssessment && visited.has("items") && <div role="tabpanel" id="dashboard-panel-items" aria-labelledby="dashboard-tab-items" hidden={view !== "items"}>
        <ItemReviewPanel key={dashboard.selected_assessment_public_id} assessmentPublicId={dashboard.selected_assessment_public_id!} />
      </div>}
      {hasAssessment && visited.has("attempts") && <div role="tabpanel" id="dashboard-panel-attempts" aria-labelledby="dashboard-tab-attempts" hidden={view !== "attempts"}>
        <AttemptComparisonPanel key={dashboard.selected_assessment_public_id} assessmentPublicId={dashboard.selected_assessment_public_id!} />
      </div>}
      <div role="tabpanel" id="dashboard-panel-overview" aria-labelledby="dashboard-tab-overview" className="space-y-6" hidden={view !== "overview"}>
      {!hasAssessment ? (
        <section className="rounded-lg border border-dashed border-line bg-white p-6 text-sm text-muted">
          No mini tests are available yet.
        </section>
      ) : (
        <>
          {!hasStudentData ? (
            <section className="rounded-lg border border-dashed border-line bg-white p-6 text-sm leading-6 text-muted">
              No student data are available for this assessment.
            </section>
          ) : (
            <>
              <section className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
                <ParticipationStatusCard dashboard={dashboard} />
                <ChartCard
                  title="Initial understanding overview"
                  data={dashboard.initial_understanding_distribution}
                  sampleSize={dashboard.eligible_student_count}
                  tone="green"
                  understanding={{ basis: "initial", studentsWithLaterAttempt: dashboard.students_with_later_attempt }}
                />
                <ChartCard
                  title="Latest understanding overview"
                  data={dashboard.understanding_distribution}
                  sampleSize={dashboard.eligible_student_count}
                  tone="gold"
                  understanding={{ basis: "latest", studentsWithLaterAttempt: dashboard.students_with_later_attempt }}
                />
              </section>

              <StudentsToFollowUp key={dashboard.selected_assessment_public_id} rows={dashboard.students_to_follow_up} />

              {dashboard.interpretation_v8 ? (
                <InterpretationV8Panel data={dashboard.interpretation_v8} onOpenItemReview={() => setView("items")} />
              ) : null}

          <section className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-ualberta-green-dark">Item-level diagnostic view</h2>
              <p className="mt-1 text-sm text-muted">Initial responses: each student&apos;s first submitted attempt, before any feedback.</p>
            </div>
            {sortedItems.map((item) => (
              <ItemDiagnostic item={item} key={item.item_snapshot_public_id} />
            ))}
          </section>

          <CandidatePatterns patterns={dashboard.candidate_misconception_patterns} threshold={dashboard.candidate_pattern_threshold} />
            </>
          )}
        </>
      )}
      </div>
    </div>
  );
}
