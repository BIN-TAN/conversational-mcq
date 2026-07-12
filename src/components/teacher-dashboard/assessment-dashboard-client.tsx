"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
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
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)} min`;
}

function barWidth(percentage: number) {
  if (percentage <= 0) return "0%";
  return `${Math.max(percentage, 3)}%`;
}

function SummaryCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <article className="rounded-lg border border-border-light bg-white p-4 shadow-soft">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-ualberta-green-dark">{value}</p>
      {note ? <p className="mt-2 text-xs leading-5 text-muted">{note}</p> : null}
    </article>
  );
}

function BarChart({ data, tone = "green" }: { data: ChartDatum[]; tone?: "green" | "gold" | "slate" }) {
  const color =
    tone === "gold"
      ? "bg-ualberta-gold"
      : tone === "slate"
        ? "bg-slate-500"
        : "bg-ualberta-green";

  return (
    <div className="space-y-3">
      {data.map((entry) => (
        <div key={entry.label}>
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
  tone
}: {
  title: string;
  description: string;
  data: ChartDatum[];
  tone?: "green" | "gold" | "slate";
}) {
  return (
    <section className="rounded-lg border border-border-light bg-white p-5 shadow-soft">
      <h2 className="text-lg font-semibold text-ualberta-green-dark">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
      <div className="mt-4">
        <BarChart data={data} tone={tone} />
      </div>
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
          <p className="mt-2 text-sm text-muted">
            {item.response_count} responses. Correct {item.correct_percentage}% / Incorrect {item.incorrect_percentage}%.
          </p>
        </div>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold text-ink">Option selection distribution</h4>
          <div className="mt-3">
            <BarChart data={item.option_distribution} tone="green" />
          </div>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-ink">Confidence distribution</h4>
          <div className="mt-3">
            <BarChart data={item.confidence_distribution} tone="gold" />
          </div>
        </div>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-line bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Reasoning-quality signal</p>
          <p className="mt-2 text-sm leading-6 text-ink">{item.reasoning_quality_summary}</p>
        </div>
        <div className="rounded-md border border-line bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Teacher-authored diagnostic context</p>
          <p className="mt-2 text-sm leading-6 text-ink">
            {item.teacher_diagnostic_context_summary ?? "No teacher-authored diagnostic context summary is available for this item."}
          </p>
        </div>
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
          No repeated wrong-option, medium/high-confidence response patterns met the conservative threshold yet.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border-light bg-white p-5 shadow-soft">
      <h2 className="text-lg font-semibold text-ualberta-green-dark">Candidate misconception patterns</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
        These are deterministic response patterns for teacher review only. They are not confirmed
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
                  {pattern.response_count} repeated responses. {pattern.confidence_summary}.
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
          </article>
        ))}
      </div>
    </section>
  );
}

function ExportSection({ dashboard }: { dashboard: TeacherAssessmentDashboard }) {
  const links = dashboard.export_links;
  return (
    <section className="rounded-lg border border-border-light bg-white p-5 shadow-soft">
      <h2 className="text-lg font-semibold text-ualberta-green-dark">Export and readable data</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
        Download the data behind this dashboard or the broader teacher/research CSV bundles. Process
        indicators are exported as evidence-quality context, not trait or misconduct labels.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {links.dashboard_csv ? (
          <a className="inline-flex items-center gap-2 rounded-md bg-ualberta-green px-4 py-2 text-sm font-semibold text-white hover:bg-ualberta-green-dark" href={links.dashboard_csv}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Dashboard summary CSV
          </a>
        ) : null}
        {links.assessment_summary_csv ? (
          <a className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-ualberta-green" href={links.assessment_summary_csv}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Assessment CSV
          </a>
        ) : null}
        {links.detailed_process_bundle ? (
          <a className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-ualberta-green" href={links.detailed_process_bundle}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Detailed process bundle
          </a>
        ) : null}
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

  const summary = dashboard.summary_cards;
  const selectedTitle = dashboard.selected_assessment?.title ?? "No assessment selected";
  const hasAssessment = Boolean(dashboard.selected_assessment);

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
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              This dashboard summarizes diagnostic signals for one mini test. It is not a live
              classroom-monitoring view and does not claim stable learner traits.
            </p>
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
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <SummaryCard label="Total students" value={formatCount(summary.total_students)} />
            <SummaryCard label="Not started" value={formatCount(summary.not_started)} />
            <SummaryCard label="In progress" value={formatCount(summary.in_progress)} />
            <SummaryCard label="Completed" value={formatCount(summary.completed)} />
            <SummaryCard label="Flagged for review" value={formatCount(summary.flagged_for_review)} />
            <SummaryCard label="Average time spent" value={formatMinutes(summary.average_time_spent_minutes)} />
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <ChartCard
              title="Status distribution"
              description="Counts by assessment-session state for the selected mini test."
              data={dashboard.status_distribution}
            />
            <ChartCard
              title="Completion progress"
              description="Started versus not-started participation for this assessment."
              data={dashboard.progress_chart}
              tone="gold"
            />
            <section className="rounded-lg border border-border-light bg-white p-5 shadow-soft">
              <h2 className="text-lg font-semibold text-ualberta-green-dark">Time indicator</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Time spent uses session start through completion or latest activity.
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md border border-line bg-slate-50 p-3">
                  <dt className="text-muted">Average</dt>
                  <dd className="mt-1 text-xl font-semibold text-ink">{formatMinutes(dashboard.time_indicator.average_minutes)}</dd>
                </div>
                <div className="rounded-md border border-line bg-slate-50 p-3">
                  <dt className="text-muted">Median</dt>
                  <dd className="mt-1 text-xl font-semibold text-ink">{formatMinutes(dashboard.time_indicator.median_minutes)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted">Sample size: {dashboard.time_indicator.sample_size}</p>
            </section>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <ChartCard
              title="Assessment-specific understanding"
              description="Current diagnostic categories for this assessment only. These are not formal psychometric estimates."
              data={dashboard.understanding_distribution}
              tone="green"
            />
            <ChartCard
              title="Engagement signals"
              description="Deterministic process and response indicators used as evidence-quality context."
              data={dashboard.engagement_distribution}
              tone="slate"
            />
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-ualberta-green-dark">Item-level diagnostic view</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
                Review option choices, correctness percentages, confidence distribution, and item-level
                diagnostic context to see which MCQs produced useful evidence.
              </p>
            </div>
            {sortedItems.map((item) => (
              <ItemDiagnostic item={item} key={item.item_public_id} />
            ))}
          </section>

          <CandidatePatterns patterns={dashboard.candidate_misconception_patterns} />
          <ExportSection dashboard={dashboard} />

          <section className="rounded-lg border border-border-light bg-white p-5 text-sm leading-6 text-muted">
            <h2 className="text-base font-semibold text-ink">Interpretation notes</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {dashboard.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
