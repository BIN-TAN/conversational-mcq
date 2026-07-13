"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type {
  CandidateMisconceptionPattern,
  ChartDatum,
  ItemDiagnosticSummary,
  TeacherAssessmentDashboard
} from "@/lib/services/teacher-dashboard/assessment-dashboard";

type DashboardResponse = {
  dashboard: TeacherAssessmentDashboard;
};

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatMinutes(value: number | null) {
  if (value === null) return "Not available";
  if (value > 0 && value < 1) return "< 1 min";
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)} min`;
}

function timeMetricLabel(value: TeacherAssessmentDashboard["time_indicator"]["time_metric_type"]) {
  if (value === "active_interaction_ms") return "Active interaction time";
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
  description,
  data,
  sampleSize,
  tone
}: {
  title: string;
  description: string;
  data: ChartDatum[];
  sampleSize: number;
  tone?: "green" | "gold" | "slate";
}) {
  return (
    <section className="h-full rounded-lg border border-border-light bg-white p-5 shadow-soft">
      <h2 className="text-lg font-semibold text-ualberta-green-dark">{title}</h2>
      {description ? <p className="mt-2 text-sm leading-6 text-muted">{description}</p> : null}
      <p className="sr-only">Total students: {formatCount(sampleSize)}.</p>
      <div className="mt-4">
        <BarChart data={data} tone={tone} ariaLabel={`${title}: counts and percentages`} />
      </div>
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
            <dt className="font-semibold text-muted">Average time spent</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">{formatMinutes(timeIndicator.average_minutes)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-muted">Median time spent</dt>
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
        <p className="sr-only">Response-time metric: {timeMetricLabel(timeIndicator.time_metric_type)}.</p>
      ) : null}
    </section>
  );
}

function ItemDiagnostic({ item }: { item: ItemDiagnosticSummary }) {
  return (
    <article className="rounded-lg border border-border-light bg-white p-5 shadow-soft">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Question {item.item_order}</p>
          <h3 className="mt-1 max-w-3xl text-base font-semibold leading-6 text-ink">
            {item.item_stem_preview}
          </h3>
          {item.response_count > 0 ? (
            <p className="mt-2 text-sm text-muted">
              {item.response_count} latest-attempt responses. Correct {item.correct_percentage}% / Incorrect {item.incorrect_percentage}%.
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">No latest-attempt responses yet.</p>
          )}
          <p className="mt-1 text-xs text-muted">
            Administered snapshot: {item.item_snapshot_public_id}. Version: {item.item_version ?? "not recorded"}.
          </p>
        </div>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {item.response_count === 0 ? (
          <div className="rounded-md border border-dashed border-line bg-slate-50 p-4 text-sm text-muted lg:col-span-2">
            No response data are available for this item yet.
          </div>
        ) : (
          <>
            <div>
              <h4 className="text-sm font-semibold text-ink">Option selection distribution</h4>
              <div className="mt-3">
                <BarChart
                  data={item.option_distribution}
                  tone="green"
                  ariaLabel={`Question ${item.item_order} option selection distribution`}
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

function CandidatePatterns({ patterns }: { patterns: CandidateMisconceptionPattern[] }) {
  if (patterns.length === 0) {
    return (
      <section className="rounded-lg border border-border-light bg-white p-5 shadow-soft">
        <h2 className="text-lg font-semibold text-ualberta-green-dark">Candidate misconception patterns</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          No repeated wrong-option, medium/high-confidence response patterns met the conservative unique-student threshold yet.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border-light bg-white p-5 shadow-soft">
      <h2 className="text-lg font-semibold text-ualberta-green-dark">Candidate misconception patterns</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
        These are deterministic candidate response patterns for teacher review only. They are not confirmed
        misconceptions and were not generated by an LLM.
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
                  {pattern.unique_student_count} unique students; {pattern.response_count} latest-attempt responses. {pattern.confidence_summary}.
                </p>
                <p className="mt-1 text-xs text-muted">
                  Administered snapshot: {pattern.item_snapshot_public_id}. Threshold: {pattern.threshold_unique_student_count} unique students.
                </p>
              </div>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
                Candidate only
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-ink">
              Reasoning pattern: {pattern.reasoning_group_label}
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
            <p className="mt-3 text-xs leading-5 text-muted">
              {pattern.review_note} Grouping: {pattern.reasoning_grouping_method}.
            </p>
            {pattern.limitations.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-muted">
                {pattern.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>
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

export function AssessmentDashboardClient({ initialDashboard }: { initialDashboard: TeacherAssessmentDashboard }) {
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
    } catch (caught) {
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
            <p className="text-sm font-semibold uppercase tracking-wide text-ualberta-green">
              Assessment-level diagnostic overview
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-ink">{selectedTitle}</h2>
          </div>
          <label className="block min-w-[280px] text-sm font-semibold text-ink">
            Assessment / mini test
            <select
              className="mt-2 w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-normal text-ink"
              disabled={loading || dashboard.assessments.length === 0}
              onChange={(event) => void selectAssessment(event.target.value)}
              value={selectedAssessmentId}
            >
              {dashboard.assessments.map((assessment) => (
                <option key={assessment.assessment_public_id} value={assessment.assessment_public_id}>
                  {assessment.title}
                </option>
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
                  title="Engagement overview"
                  description="Persisted engagement evidence and review signals."
                  data={dashboard.engagement_distribution}
                  sampleSize={dashboard.eligible_student_count}
                  tone="slate"
                />
                <ChartCard
                  title="Understanding overview"
                  description="Persisted assessment-specific understanding signals."
                  data={dashboard.understanding_distribution}
                  sampleSize={dashboard.eligible_student_count}
                  tone="green"
                />
              </section>

          {dashboard.engagement_review_reasons.length > 0 ? (
            <section className="rounded-lg border border-border-light bg-white p-5 shadow-soft">
              <h2 className="text-lg font-semibold text-ualberta-green-dark">Engagement review reasons</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
                These teacher-only reasons explain flagged engagement review signals using persisted evidence. They are not cheating,
                motivation, laziness, ability, or confirmed guessing labels.
              </p>
              <ul className="mt-4 space-y-3 text-sm">
                {dashboard.engagement_review_reasons.map((reason) => (
                  <li className="rounded-md border border-line bg-slate-50 p-3" key={reason.label}>
                    <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                      <span className="font-semibold text-ink">{reason.label}</span>
                      <span className="text-muted">{formatCount(reason.count)} unique students</span>
                    </div>
                    {reason.limitations.length > 0 ? (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-muted">
                        {reason.limitations.map((limitation) => (
                          <li key={limitation}>{limitation}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-ualberta-green-dark">Item-level diagnostic view</h2>
            {sortedItems.map((item) => (
              <ItemDiagnostic item={item} key={item.item_snapshot_public_id} />
            ))}
          </section>

          <CandidatePatterns patterns={dashboard.candidate_misconception_patterns} />
            </>
          )}
        </>
      )}
    </div>
  );
}
