"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, BookOpen, Download, Loader2, PackageCheck, RefreshCw, Table2 } from "lucide-react";
import { errorFromUnknown, fetchExportJobs } from "./api";
import { EmptyPanel, ErrorPanel, formatDate, StatusPill } from "./ui";
import type { ExportJob, StructuredApiError } from "./types";

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

type OptionsResponse = {
  export_version: string;
  assessments: AssessmentOption[];
  students: StudentOption[];
  data_dictionary: Array<{ field: string; definition?: string }>;
};

type DataDictionaryEntry = {
  table_name: string;
  variable_name: string;
  display_name: string;
  definition: string;
  row_grain: string;
  data_type: string;
  source_type: string;
  generation_method: string;
  missing_value_meaning: string;
  privacy_level: string;
  export_tier: string;
  interpretation_caution: string;
};

type DataDictionaryResponse = {
  dictionary_version: string;
  stats: {
    variable_count: number;
    process_event_type_count: number;
    by_export_tier: Record<string, number>;
    by_privacy_level: Record<string, number>;
  };
  entries: DataDictionaryEntry[];
};

type TabId = "quick" | "analysis" | "archive" | "dictionary";

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "quick", label: "Quick summary" },
  { id: "analysis", label: "Analysis-ready dataset" },
  { id: "archive", label: "Full archive" },
  { id: "dictionary", label: "Data dictionary" }
];

async function fetchOptions(): Promise<OptionsResponse> {
  const response = await fetch("/api/teacher/data-explorer/options", {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message ?? "Research export options could not be loaded.");
  }
  return response.json() as Promise<OptionsResponse>;
}

async function fetchDictionary(): Promise<DataDictionaryResponse> {
  const response = await fetch("/api/teacher/research-data/dictionary?format=json", {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message ?? "Data dictionary could not be loaded.");
  }
  return response.json() as Promise<DataDictionaryResponse>;
}

function countPills(counts?: ExportAvailabilityCounts | null) {
  if (!counts) return null;
  const entries = [
    ["students/sessions", counts.sessions],
    ["responses", counts.item_responses],
    ["events", counts.process_events],
    ["turns", counts.conversation_turns],
    ["agent calls", counts.agent_calls],
    ["activities", counts.activity_attempts],
    ["evidence", counts.post_activity_evidence],
    ["snapshots", counts.diagnostic_snapshots]
  ] as const;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {entries.map(([label, value]) => (
        <span className="rounded-full border border-line bg-slate-50 px-2.5 py-1 text-xs font-medium text-muted" key={label}>
          {label}: <span className="font-semibold text-ink">{value}</span>
        </span>
      ))}
    </div>
  );
}

function buttonClass(disabled = false) {
  return [
    "inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold transition",
    disabled
      ? "pointer-events-none border border-slate-200 bg-slate-100 text-slate-400"
      : "border border-accent bg-accent text-white hover:bg-accent-dark"
  ].join(" ");
}

function DownloadLink({ href, label, disabled = false }: { href: string; label: string; disabled?: boolean }) {
  return (
    <a aria-disabled={disabled} className={buttonClass(disabled)} href={disabled ? "#" : href}>
      <Download className="h-4 w-4" aria-hidden="true" />
      {label}
    </a>
  );
}

function scopeQuery(input: {
  assessmentId: string;
  studentId: string;
  scopeMode: "all" | "assessment" | "student";
  includeIncomplete: boolean;
  includeRestricted: boolean;
}) {
  const params = new URLSearchParams();
  if (input.scopeMode === "assessment" && input.assessmentId) {
    params.set("assessment_public_id", input.assessmentId);
  }
  if (input.scopeMode === "student" && input.studentId) {
    params.set("student_id", input.studentId);
  }
  params.set("include_incomplete_sessions", input.includeIncomplete ? "true" : "false");
  if (input.includeRestricted) {
    params.set("include_restricted_fields", "true");
    params.set("confirm_restricted_fields", "true");
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function selectedCounts(input: {
  options: OptionsResponse | null;
  assessmentId: string;
  studentId: string;
  scopeMode: "all" | "assessment" | "student";
}) {
  if (input.scopeMode === "assessment") {
    return input.options?.assessments.find((assessment) => assessment.assessment_public_id === input.assessmentId)?.counts ?? null;
  }
  if (input.scopeMode === "student") {
    return input.options?.students.find((student) => student.user_id === input.studentId)?.counts ?? null;
  }
  const counts = (input.options?.assessments ?? []).reduce<ExportAvailabilityCounts>(
    (total, assessment) => ({
      sessions: total.sessions + assessment.counts.sessions,
      item_responses: total.item_responses + assessment.counts.item_responses,
      process_events: total.process_events + assessment.counts.process_events,
      latency_rows: total.latency_rows + assessment.counts.latency_rows,
      conversation_turns: total.conversation_turns + assessment.counts.conversation_turns,
      response_packages: total.response_packages + assessment.counts.response_packages,
      agent_calls: total.agent_calls + assessment.counts.agent_calls,
      activity_attempts: total.activity_attempts + assessment.counts.activity_attempts,
      post_activity_evidence: total.post_activity_evidence + assessment.counts.post_activity_evidence,
      diagnostic_snapshots: total.diagnostic_snapshots + assessment.counts.diagnostic_snapshots
    }),
    {
      sessions: 0,
      item_responses: 0,
      process_events: 0,
      latency_rows: 0,
      conversation_turns: 0,
      response_packages: 0,
      agent_calls: 0,
      activity_attempts: 0,
      post_activity_evidence: 0,
      diagnostic_snapshots: 0
    }
  );
  return counts;
}

export function ResearchDataExportsClient({ initialTab = "quick" }: { initialTab?: TabId }) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [assessmentId, setAssessmentId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [scopeMode, setScopeMode] = useState<"all" | "assessment" | "student">("all");
  const [includeIncomplete, setIncludeIncomplete] = useState(true);
  const [includeRestricted, setIncludeRestricted] = useState(false);
  const [dictionary, setDictionary] = useState<DataDictionaryResponse | null>(null);
  const [dictionarySearch, setDictionarySearch] = useState("");
  const [dictionaryTableFilter, setDictionaryTableFilter] = useState("all");
  const [dictionaryPrivacyFilter, setDictionaryPrivacyFilter] = useState("all");
  const [dictionaryTierFilter, setDictionaryTierFilter] = useState("all");
  const [dictionaryLoading, setDictionaryLoading] = useState(false);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const urlTab = new URLSearchParams(window.location.search).get("tab") as TabId | null;
    if (urlTab && tabs.some((tab) => tab.id === urlTab)) {
      setActiveTab(urlTab);
    }
  }, []);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [loadedOptions, loadedJobs] = await Promise.all([fetchOptions(), fetchExportJobs()]);
      setOptions(loadedOptions);
      setJobs(loadedJobs.export_jobs);
      setAssessmentId((current) => current || loadedOptions.assessments[0]?.assessment_public_id || "");
      setStudentId((current) => current || loadedOptions.students[0]?.user_id || "");
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (activeTab !== "dictionary" || dictionary || dictionaryLoading) return;
    setDictionaryLoading(true);
    fetchDictionary()
      .then((loadedDictionary) => {
        setDictionary(loadedDictionary);
      })
      .catch((caught) => {
        setError(errorFromUnknown(caught));
      })
      .finally(() => {
        setDictionaryLoading(false);
      });
  }, [activeTab, dictionary, dictionaryLoading]);

  const counts = selectedCounts({ options, assessmentId, studentId, scopeMode });
  const hasData = (counts?.sessions ?? 0) > 0;
  const query = scopeQuery({ assessmentId, studentId, scopeMode, includeIncomplete, includeRestricted });
  const quickAssessmentHref = assessmentId
    ? `/api/teacher/data-explorer/assessments/${encodeURIComponent(assessmentId)}/csv`
    : "#";
  const quickStudentHref = studentId
    ? `/api/teacher/data-explorer/students/${encodeURIComponent(studentId)}/csv`
    : "#";
  const analysisHref = `/api/teacher/research-data/analysis-ready${query}`;
  const archiveHref = includeRestricted
    ? "/api/teacher/research-export?include_restricted_item_keys=true"
    : "/api/teacher/research-export";
  const selectedAssessment = useMemo(
    () => options?.assessments.find((assessment) => assessment.assessment_public_id === assessmentId) ?? null,
    [assessmentId, options]
  );
  const selectedStudent = useMemo(
    () => options?.students.find((student) => student.user_id === studentId) ?? null,
    [studentId, options]
  );
  const dictionaryTables = useMemo(
    () => [...new Set((dictionary?.entries ?? []).map((entry) => entry.table_name))].sort(),
    [dictionary]
  );
  const dictionaryPrivacyLevels = useMemo(
    () => [...new Set((dictionary?.entries ?? []).map((entry) => entry.privacy_level))].sort(),
    [dictionary]
  );
  const dictionaryTiers = useMemo(
    () => [...new Set((dictionary?.entries ?? []).map((entry) => entry.export_tier))].sort(),
    [dictionary]
  );
  const filteredDictionaryEntries = useMemo(() => {
    const queryText = dictionarySearch.trim().toLowerCase();
    return (dictionary?.entries ?? [])
      .filter((entry) => dictionaryTableFilter === "all" || entry.table_name === dictionaryTableFilter)
      .filter((entry) => dictionaryPrivacyFilter === "all" || entry.privacy_level === dictionaryPrivacyFilter)
      .filter((entry) => dictionaryTierFilter === "all" || entry.export_tier === dictionaryTierFilter)
      .filter((entry) => {
        if (!queryText) return true;
        return [
          entry.table_name,
          entry.variable_name,
          entry.display_name,
          entry.definition,
          entry.source_type,
          entry.privacy_level,
          entry.export_tier
        ].some((value) => value.toLowerCase().includes(queryText));
      })
      .slice(0, 80);
  }, [dictionary, dictionaryPrivacyFilter, dictionarySearch, dictionaryTableFilter, dictionaryTierFilter]);

  return (
    <div className="space-y-6">
      <ErrorPanel error={error} />
      <section className="rounded-lg border border-line bg-white p-4 shadow-soft">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Research data export sections">
          {tabs.map((tab) => (
            <button
              className={[
                "rounded-md px-3 py-2 text-sm font-semibold transition",
                activeTab === tab.id ? "bg-accent text-white" : "border border-line bg-white text-ink hover:border-accent"
              ].join(" ")}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
          <button
            className="ml-auto inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:border-accent"
            onClick={() => void refresh()}
            type="button"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </button>
        </div>
      </section>

      {loading ? (
        <section className="rounded-lg border border-line bg-white p-4 text-sm text-muted">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading export options
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h2 className="text-xl font-semibold text-ink">Export scope</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Scope
            <select
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
              onChange={(event) => setScopeMode(event.target.value as "all" | "assessment" | "student")}
              value={scopeMode}
            >
              <option value="all">All authorized data</option>
              <option value="assessment">Selected assessment</option>
              <option value="student">Selected student</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Assessment
            <select
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
              disabled={scopeMode === "student"}
              onChange={(event) => setAssessmentId(event.target.value)}
              value={assessmentId}
            >
              {(options?.assessments ?? []).map((assessment) => (
                <option key={assessment.assessment_public_id} value={assessment.assessment_public_id}>
                  {assessment.title} ({assessment.availability})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Student
            <select
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
              disabled={scopeMode === "assessment"}
              onChange={(event) => setStudentId(event.target.value)}
              value={studentId}
            >
              {(options?.students ?? []).map((student) => (
                <option key={student.user_id} value={student.user_id}>
                  {student.user_id}
                  {student.display_name ? ` - ${student.display_name}` : ""} ({student.availability})
                </option>
              ))}
            </select>
          </label>
        </div>
        {countPills(counts)}
        {!hasData ? (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            No data are available for the selected scope. Choose a scope with student sessions before
            generating analysis files.
          </p>
        ) : null}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm">
            <input
              checked={includeIncomplete}
              onChange={(event) => setIncludeIncomplete(event.target.checked)}
              type="checkbox"
            />
            <span>
              <span className="font-semibold text-ink">Include incomplete sessions</span>
              <span className="mt-1 block text-muted">Represent interrupted attempts explicitly instead of hiding them.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <input
              checked={includeRestricted}
              onChange={(event) => setIncludeRestricted(event.target.checked)}
              type="checkbox"
            />
            <span>
              <span className="font-semibold text-amber-950">Restricted research fields</span>
              <span className="mt-1 block text-amber-900">
                Include answer-key and teacher diagnostic fields only for authorized research review.
              </span>
            </span>
          </label>
        </div>
      </section>

      {activeTab === "quick" ? (
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-start gap-3">
            <Table2 className="mt-1 h-5 w-5 text-accent" aria-hidden="true" />
            <div>
              <h2 className="text-xl font-semibold text-ink">Quick summary</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Spreadsheet summaries for assessment, student, and student x assessment matrix review.
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <DownloadLink disabled={!selectedAssessment || selectedAssessment.counts.sessions === 0} href={quickAssessmentHref} label="Selected assessment summary" />
            <DownloadLink disabled={!selectedStudent || selectedStudent.counts.sessions === 0} href={quickStudentHref} label="Selected student summary" />
            <DownloadLink href="/api/teacher/data-explorer/matrix/csv" label="Student x assessment matrix" />
          </div>
        </section>
      ) : null}

      {activeTab === "analysis" ? (
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-start gap-3">
            <PackageCheck className="mt-1 h-5 w-5 text-accent" aria-hidden="true" />
            <div>
              <h2 className="text-xl font-semibold text-ink">Analysis-ready dataset</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                One ZIP containing normalized CSV tables: sessions, item responses, process events,
                conversation turns, agent/activity records, administered content, and the data dictionary.
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <DownloadLink disabled={!hasData} href={analysisHref} label="Generate analysis-ready ZIP" />
            <DownloadLink href="/api/teacher/research-data/dictionary" label="Download data dictionary CSV" />
          </div>
        </section>
      ) : null}

      {activeTab === "archive" ? (
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-start gap-3">
            <Archive className="mt-1 h-5 w-5 text-accent" aria-hidden="true" />
            <div>
              <h2 className="text-xl font-semibold text-ink">Full archive</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Comprehensive restricted research ZIP with audit manifests and redacted structured records.
                Use this when reproducibility or audit context matters.
              </p>
            </div>
          </div>
          <div className="mt-5">
            <DownloadLink href={archiveHref} label="Generate full archive" />
          </div>
        </section>
      ) : null}

      {activeTab === "dictionary" ? (
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-start gap-3">
            <BookOpen className="mt-1 h-5 w-5 text-accent" aria-hidden="true" />
            <div>
              <h2 className="text-xl font-semibold text-ink">Data dictionary</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Search row grain, source, generation method, missingness, privacy level, export tier,
                and interpretation cautions before downloading the CSV.
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <DownloadLink href="/api/teacher/research-data/dictionary" label="Download data dictionary CSV" />
            <a className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent" href="/api/teacher/research-data/dictionary?format=json">
              View data dictionary JSON
            </a>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-4">
            <label className="flex flex-col gap-2 text-sm font-medium text-ink lg:col-span-1">
              Search variables
              <input
                className="h-10 rounded-md border border-line bg-white px-3 text-sm"
                onChange={(event) => setDictionarySearch(event.target.value)}
                placeholder="Variable, definition, or source"
                type="search"
                value={dictionarySearch}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-ink">
              Table
              <select
                className="h-10 rounded-md border border-line bg-white px-3 text-sm"
                onChange={(event) => setDictionaryTableFilter(event.target.value)}
                value={dictionaryTableFilter}
              >
                <option value="all">All tables</option>
                {dictionaryTables.map((table) => (
                  <option key={table} value={table}>
                    {table}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-ink">
              Privacy
              <select
                className="h-10 rounded-md border border-line bg-white px-3 text-sm"
                onChange={(event) => setDictionaryPrivacyFilter(event.target.value)}
                value={dictionaryPrivacyFilter}
              >
                <option value="all">All privacy levels</option>
                {dictionaryPrivacyLevels.map((privacyLevel) => (
                  <option key={privacyLevel} value={privacyLevel}>
                    {privacyLevel}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-ink">
              Export tier
              <select
                className="h-10 rounded-md border border-line bg-white px-3 text-sm"
                onChange={(event) => setDictionaryTierFilter(event.target.value)}
                value={dictionaryTierFilter}
              >
                <option value="all">All export tiers</option>
                {dictionaryTiers.map((tier) => (
                  <option key={tier} value={tier}>
                    {tier}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {dictionaryLoading ? (
            <p className="mt-4 inline-flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading data dictionary
            </p>
          ) : null}
          {dictionary ? (
            <div className="mt-5 space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-line bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted">Variables</p>
                  <p className="mt-1 text-2xl font-semibold text-ink">{dictionary.stats.variable_count}</p>
                </div>
                <div className="rounded-lg border border-line bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted">Process-event types</p>
                  <p className="mt-1 text-2xl font-semibold text-ink">{dictionary.stats.process_event_type_count}</p>
                </div>
                <div className="rounded-lg border border-line bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted">Shown rows</p>
                  <p className="mt-1 text-2xl font-semibold text-ink">{filteredDictionaryEntries.length}</p>
                </div>
              </div>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-2">Variable</th>
                      <th className="px-3 py-2">Table</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Privacy</th>
                      <th className="px-3 py-2">Export tier</th>
                      <th className="px-3 py-2">Definition</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {filteredDictionaryEntries.map((entry) => (
                      <tr key={`${entry.table_name}.${entry.variable_name}`}>
                        <td className="px-3 py-2 font-mono text-xs">{entry.variable_name}</td>
                        <td className="px-3 py-2">{entry.table_name}</td>
                        <td className="px-3 py-2">{entry.data_type}</td>
                        <td className="px-3 py-2">{entry.source_type}</td>
                        <td className="px-3 py-2">{entry.privacy_level}</td>
                        <td className="px-3 py-2">{entry.export_tier}</td>
                        <td className="max-w-xl px-3 py-2 text-muted">
                          <span>{entry.definition}</span>
                          {entry.interpretation_caution ? (
                            <span className="mt-1 block text-amber-800">{entry.interpretation_caution}</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h2 className="text-xl font-semibold text-ink">Current export job history</h2>
        {jobs.length === 0 ? (
          <EmptyPanel title="No background exports have been generated yet." />
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-line">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Export ID</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Rows</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {jobs.slice(0, 8).map((job) => (
                  <tr key={job.export_public_id}>
                    <td className="px-3 py-2 font-mono text-xs">{job.export_public_id}</td>
                    <td className="px-3 py-2">
                      <StatusPill value={job.status} tone={job.status === "completed" ? "good" : job.status === "failed" ? "bad" : "warn"} />
                    </td>
                    <td className="px-3 py-2">{job.row_count ?? ""}</td>
                    <td className="px-3 py-2">{formatDate(job.created_at)}</td>
                    <td className="px-3 py-2">
                      {job.download_url ? <a className="font-semibold text-accent hover:underline" href={job.download_url}>Download</a> : "Not available"}
                    </td>
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
