"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, Download, Loader2, RefreshCw } from "lucide-react";
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
  [key: string]: string;
};

type DataDictionaryResponse = {
  dictionary_version: string;
  entity_type: DictionaryEntityType;
  stats: {
    variable_count: number;
    research_variable_count: number;
    process_event_type_count: number;
    internal_schema_field_count: number;
    excluded_platform_field_count: number;
    selected_entity_count: number;
    by_category?: Record<string, number>;
    by_event_category?: Record<string, number>;
    by_export_policy: Record<string, number>;
    by_privacy_level: Record<string, number>;
    by_source_nature: Record<string, number>;
  };
  rows: DataDictionaryEntry[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  first_visible_row: number;
  last_visible_row: number;
  category_counts: Record<string, number>;
  filters: Record<string, string>;
  filter_options: {
    page_sizes: number[];
    entity_types: Array<{ value: DictionaryEntityType; label: string }>;
    categories: string[];
    table_names: string[];
    source_natures: string[];
    privacy_levels: string[];
    export_policies: string[];
    derivations: string[];
    field_families: string[];
    deprecated_values: string[];
  };
};

type SectionId = "dataset" | "dictionary";
type ScopeMode = "all" | "assessment" | "student";
type DictionaryEntityType =
  | "research_variable"
  | "process_event_code"
  | "internal_schema_field"
  | "excluded_platform_field";

const sections: Array<{ id: SectionId; label: string }> = [
  { id: "dataset", label: "Research dataset" },
  { id: "dictionary", label: "Data dictionary" }
];

const dictionaryEntityLabels: Array<{ id: DictionaryEntityType; label: string }> = [
  { id: "research_variable", label: "Research variables" },
  { id: "process_event_code", label: "Process event codebook" },
  { id: "internal_schema_field", label: "Internal schema appendix" },
  { id: "excluded_platform_field", label: "Platform administration and excluded variables" }
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

async function fetchDictionary(query: URLSearchParams): Promise<DataDictionaryResponse> {
  const response = await fetch(`/api/teacher/research-data/dictionary?${query.toString()}`, {
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

function queryWithDefined(values: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === "" || value === "all") continue;
    params.set(key, String(value));
  }
  return params;
}

function scopeQuery(input: {
  assessmentId: string;
  studentId: string;
  scopeMode: ScopeMode;
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
  scopeMode: ScopeMode;
}) {
  if (input.scopeMode === "assessment") {
    return input.options?.assessments.find((assessment) => assessment.assessment_public_id === input.assessmentId)?.counts ?? null;
  }
  if (input.scopeMode === "student") {
    return input.options?.students.find((student) => student.user_id === input.studentId)?.counts ?? null;
  }
  return (input.options?.assessments ?? []).reduce<ExportAvailabilityCounts>(
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
}

function jobOption(job: ExportJob, key: string) {
  if (!job.options || typeof job.options !== "object") return "";
  const value = (job.options as Record<string, unknown>)[key];
  return value === null || value === undefined ? "" : String(value);
}

function DefinitionRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-sm leading-6 text-ink">{value}</dd>
    </div>
  );
}

function DictionaryCard({ entry, entityType }: { entry: DataDictionaryEntry; entityType: DictionaryEntityType }) {
  if (entityType === "process_event_code") {
    return (
      <article className="rounded-lg border border-line bg-white p-4 shadow-soft" key={entry.event_type}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Process event</p>
            <h3 className="mt-1 break-words font-mono text-base font-semibold text-ink">{entry.event_type}</h3>
          </div>
          <span className="rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-semibold text-ink">
            {entry.event_category}
          </span>
        </div>
        <dl className="mt-4 grid gap-4 md:grid-cols-2">
          <DefinitionRow label="Trigger" value={entry.trigger} />
          <DefinitionRow label="Actor/source" value={entry.actor_or_source} />
          <DefinitionRow label="Measurement level/scope" value={entry.measurement_level} />
          <DefinitionRow label="Session or item scope" value={entry.session_or_item_scope} />
          <DefinitionRow label="Timestamp meaning" value={entry.timestamp_meaning} />
          <DefinitionRow label="Payload fields" value={entry.payload_fields} />
          <DefinitionRow label="Derived variables" value={entry.derived_variables} />
          <DefinitionRow label="Interpretation caution" value={entry.interpretation_caution} />
        </dl>
      </article>
    );
  }

  if (entityType === "internal_schema_field") {
    return (
      <article className="rounded-lg border border-line bg-white p-4 shadow-soft" key={entry.qualified_name}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Internal schema field</p>
            <h3 className="mt-1 break-words font-mono text-base font-semibold text-ink">{entry.qualified_name}</h3>
          </div>
          <span className="rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-semibold text-ink">
            {entry.export_policy}
          </span>
        </div>
        <dl className="mt-4 grid gap-4 md:grid-cols-2">
          <DefinitionRow label="Model / field" value={`${entry.model_name}.${entry.field_name}`} />
          <DefinitionRow label="Database type" value={entry.database_type} />
          <DefinitionRow label="Internal purpose" value={entry.internal_purpose} />
          <DefinitionRow label="Research-variable mapping" value={entry.research_variable_mapping || "No direct research variable."} />
          <DefinitionRow label="Privacy" value={entry.privacy_level} />
          <DefinitionRow label="Audience" value={entry.audience} />
        </dl>
      </article>
    );
  }

  if (entityType === "excluded_platform_field") {
    return (
      <article className="rounded-lg border border-line bg-white p-4 shadow-soft" key={entry.qualified_name}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Excluded/platform field</p>
            <h3 className="mt-1 break-words font-mono text-base font-semibold text-ink">{entry.qualified_name}</h3>
          </div>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
            {entry.exclusion_category}
          </span>
        </div>
        <dl className="mt-4 grid gap-4 md:grid-cols-2">
          <DefinitionRow label="Source table" value={entry.source_table} />
          <DefinitionRow label="Exclusion reason" value={entry.exclusion_reason} />
          <DefinitionRow label="Permitted audience" value={entry.permitted_audience} />
          <DefinitionRow label="Export policy" value={entry.export_policy} />
          <DefinitionRow label="Notes" value={entry.notes} />
        </dl>
      </article>
    );
  }

  return (
    <article className="rounded-lg border border-line bg-white p-4 shadow-soft" key={entry.qualified_name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Variable</p>
          <h3 className="mt-1 break-words font-mono text-base font-semibold text-ink">{entry.qualified_name}</h3>
        </div>
        <span className="rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-semibold text-ink">
          {entry.substantive_category}
        </span>
      </div>
      <dl className="mt-4 grid gap-4 md:grid-cols-2">
        <DefinitionRow label="Dataset/table" value={entry.table_name} />
        <DefinitionRow label="Measurement level" value={entry.measurement_level} />
        <DefinitionRow label="Type" value={entry.data_type} />
        <DefinitionRow label="Category" value={entry.substantive_category} />
        <div className="md:col-span-2">
          <DefinitionRow label="Definition" value={entry.definition} />
        </div>
        <div className="md:col-span-2">
          <DefinitionRow label="Collection or generation method" value={entry.collection_or_generation_method} />
        </div>
        <DefinitionRow label="Missing value meaning" value={entry.missing_value_meaning} />
        <DefinitionRow label="Zero value meaning" value={entry.zero_value_meaning} />
        <DefinitionRow label="Not applicable when" value={entry.not_applicable_condition} />
        <DefinitionRow label="Interpretation caution" value={entry.interpretation_caution} />
        {entry.timing_construct ? (
          <div className="md:col-span-2 rounded-md border border-line bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Timing semantics</p>
            <dl className="mt-3 grid gap-3 md:grid-cols-2">
              <DefinitionRow label="Start event" value={entry.timing_start_event} />
              <DefinitionRow label="End event" value={entry.timing_end_event} />
              <DefinitionRow label="Formula" value={entry.calculation_formula} />
              <DefinitionRow label="Idle handling" value={entry.idle_time_handling} />
              <DefinitionRow label="Page-hidden handling" value={entry.page_hidden_handling} />
            </dl>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

export function ResearchDataExportsClient({ initialSection = "dataset" }: { initialSection?: SectionId }) {
  const [activeSection, setActiveSection] = useState<SectionId>(initialSection);
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [assessmentId, setAssessmentId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("all");
  const [includeIncomplete, setIncludeIncomplete] = useState(true);
  const [includeRestricted, setIncludeRestricted] = useState(false);
  const [dictionary, setDictionary] = useState<DataDictionaryResponse | null>(null);
  const [dictionaryEntityType, setDictionaryEntityType] = useState<DictionaryEntityType>("research_variable");
  const [dictionarySearch, setDictionarySearch] = useState("");
  const [dictionaryCategoryFilter, setDictionaryCategoryFilter] = useState("all");
  const [dictionaryDerivationFilter, setDictionaryDerivationFilter] = useState("all");
  const [dictionaryDeprecatedFilter, setDictionaryDeprecatedFilter] = useState("all");
  const [dictionaryPage, setDictionaryPage] = useState(1);
  const [dictionaryPageSize, setDictionaryPageSize] = useState(100);
  const [dictionaryLoading, setDictionaryLoading] = useState(false);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const section = params.get("section") ?? params.get("tab");
    if (section === "dictionary") setActiveSection("dictionary");
    if (section === "dataset" || section === "quick" || section === "analysis" || section === "archive") {
      setActiveSection("dataset");
    }
    const entityType = params.get("entity_type");
    if (
      entityType === "research_variable" ||
      entityType === "process_event_code" ||
      entityType === "internal_schema_field" ||
      entityType === "excluded_platform_field"
    ) {
      setDictionaryEntityType(entityType);
    }
    const pageSize = Number(params.get("page_size"));
    if ([25, 50, 100, 250, 500].includes(pageSize)) setDictionaryPageSize(pageSize);
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

  const dictionaryQuery = useMemo(
    () =>
      queryWithDefined({
        format: "json",
        entity_type: dictionaryEntityType,
        page: dictionaryPage,
        page_size: dictionaryPageSize,
        search: dictionarySearch.trim(),
        category: dictionaryCategoryFilter,
        derivation: dictionaryDerivationFilter,
        deprecated: dictionaryDeprecatedFilter
      }),
    [
      dictionaryCategoryFilter,
      dictionaryDeprecatedFilter,
      dictionaryDerivationFilter,
      dictionaryEntityType,
      dictionaryPage,
      dictionaryPageSize,
      dictionarySearch,
    ]
  );

  const dictionaryDownloadQuery = useMemo(() => {
    const params = new URLSearchParams(dictionaryQuery);
    params.delete("format");
    params.delete("page");
    params.delete("page_size");
    const query = params.toString();
    return query ? `?${query}` : "";
  }, [dictionaryQuery]);

  useEffect(() => {
    if (activeSection !== "dictionary") return;
    setDictionaryLoading(true);
    setError(null);
    fetchDictionary(dictionaryQuery)
      .then((loadedDictionary) => {
        setDictionary(loadedDictionary);
      })
      .catch((caught) => {
        setError(errorFromUnknown(caught));
      })
      .finally(() => {
        setDictionaryLoading(false);
      });
  }, [activeSection, dictionaryQuery]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("section", activeSection);
    if (activeSection === "dictionary") {
      params.set("page", String(dictionaryPage));
      params.set("page_size", String(dictionaryPageSize));
      for (const [key, value] of dictionaryQuery.entries()) {
        if (key !== "format" && key !== "page" && key !== "page_size") params.set(key, value);
      }
    }
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [activeSection, dictionaryPage, dictionaryPageSize, dictionaryQuery]);

  function resetDictionaryPage() {
    setDictionaryPage(1);
  }

  const counts = selectedCounts({ options, assessmentId, studentId, scopeMode });
  const hasData = (counts?.sessions ?? 0) > 0;
  const datasetHref = `/api/teacher/research-data/analysis-ready${scopeQuery({
    assessmentId,
    studentId,
    scopeMode,
    includeIncomplete,
    includeRestricted
  })}`;

  return (
    <div className="space-y-6">
      <ErrorPanel error={error} />
      <section className="rounded-lg border border-line bg-white p-4 shadow-soft">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Research data export sections">
          {sections.map((section) => (
            <button
              className={[
                "rounded-md px-3 py-2 text-sm font-semibold transition",
                activeSection === section.id ? "bg-accent text-white" : "border border-line bg-white text-ink hover:border-accent"
              ].join(" ")}
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              type="button"
            >
              {section.label}
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

      {activeSection === "dataset" ? (
        <>
          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h2 className="text-xl font-semibold text-ink">Research dataset</h2>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <label className="flex flex-col gap-2 text-sm font-medium text-ink">
                Scope
                <select
                  className="h-10 rounded-md border border-line bg-white px-3 text-sm"
                  onChange={(event) => setScopeMode(event.target.value as ScopeMode)}
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
                  className="h-10 rounded-md border border-line bg-white px-3 text-sm disabled:bg-slate-100"
                  disabled={scopeMode !== "assessment"}
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
                  className="h-10 rounded-md border border-line bg-white px-3 text-sm disabled:bg-slate-100"
                  disabled={scopeMode !== "student"}
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
                No data are available for the selected scope. Choose a scope with student sessions before generating a research dataset.
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
            <div className="mt-5 flex flex-wrap gap-3">
              <DownloadLink disabled={!hasData} href={datasetHref} label="Generate research dataset" />
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h2 className="text-xl font-semibold text-ink">Export job history</h2>
            {jobs.length === 0 ? (
              <EmptyPanel title="No background exports have been generated yet." />
            ) : (
              <div className="mt-4 overflow-x-auto rounded-lg border border-line">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-2">Export ID</th>
                      <th className="px-3 py-2">Scope</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">File/table set</th>
                      <th className="px-3 py-2">Restricted</th>
                      <th className="px-3 py-2">Rows</th>
                      <th className="px-3 py-2">Created</th>
                      <th className="px-3 py-2">Completed</th>
                      <th className="px-3 py-2">Download</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {jobs.slice(0, 8).map((job) => (
                      <tr key={job.export_public_id}>
                        <td className="px-3 py-2 font-mono text-xs">{job.export_public_id}</td>
                        <td className="px-3 py-2">{jobOption(job, "export_scope") || "legacy"}</td>
                        <td className="px-3 py-2">
                          <StatusPill value={job.status} tone={job.status === "completed" ? "good" : job.status === "failed" ? "bad" : "warn"} />
                        </td>
                        <td className="px-3 py-2">{jobOption(job, "export_type") || job.export_schema_version || "legacy export"}</td>
                        <td className="px-3 py-2">{jobOption(job, "restricted_fields_included") || "false"}</td>
                        <td className="px-3 py-2">{job.row_count ?? ""}</td>
                        <td className="px-3 py-2">{formatDate(job.created_at)}</td>
                        <td className="px-3 py-2">{formatDate(job.completed_at)}</td>
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
        </>
      ) : null}

      {activeSection === "dictionary" ? (
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-start gap-3">
            <BookOpen className="mt-1 h-5 w-5 text-accent" aria-hidden="true" />
            <div>
              <h2 className="text-xl font-semibold text-ink">Data dictionary</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Browse research variables, process-event codes, internal schema lineage, and excluded/platform fields without mixing them into one variable list.
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Data dictionary entity sections">
            {dictionaryEntityLabels.map((entity) => (
              <button
                className={[
                  "rounded-md px-3 py-2 text-sm font-semibold transition",
                  dictionaryEntityType === entity.id
                    ? "bg-accent text-white"
                    : "border border-line bg-white text-ink hover:border-accent"
                ].join(" ")}
                key={entity.id}
                onClick={() => {
                  setDictionaryEntityType(entity.id);
                  setDictionaryCategoryFilter("all");
                  resetDictionaryPage();
                }}
                type="button"
              >
                {entity.label}
              </button>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <DownloadLink href={`/api/teacher/research-data/dictionary${dictionaryDownloadQuery}`} label="Download filtered dictionary CSV" />
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <label className="flex flex-col gap-2 text-sm font-medium text-ink">
              Search selected section
              <input
                className="h-10 rounded-md border border-line bg-white px-3 text-sm"
                onChange={(event) => {
                  setDictionarySearch(event.target.value);
                  resetDictionaryPage();
                }}
                placeholder="Variable, event, definition, trigger, method, or source"
                type="search"
                value={dictionarySearch}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-ink">
              Category or code group
              <select
                className="h-10 rounded-md border border-line bg-white px-3 text-sm"
                onChange={(event) => {
                  setDictionaryCategoryFilter(event.target.value);
                  resetDictionaryPage();
                }}
                value={dictionaryCategoryFilter}
              >
                <option value="all">All categories or groups</option>
                {(dictionary?.filter_options.categories ?? []).map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-ink">
              Page size
              <select
                className="h-10 rounded-md border border-line bg-white px-3 text-sm"
                onChange={(event) => {
                  setDictionaryPageSize(Number(event.target.value));
                  resetDictionaryPage();
                }}
                value={dictionaryPageSize}
              >
                {[25, 50, 100, 250, 500].map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {dictionaryEntityType === "research_variable" ? (
              <label className="flex flex-col gap-2 text-sm font-medium text-ink">
                Directly recorded or derived
                <select
                  className="h-10 rounded-md border border-line bg-white px-3 text-sm"
                  onChange={(event) => {
                    setDictionaryDerivationFilter(event.target.value);
                    resetDictionaryPage();
                  }}
                  value={dictionaryDerivationFilter}
                >
                  <option value="all">All derivation types</option>
                  {(dictionary?.filter_options.derivations ?? []).map((derivation) => (
                    <option key={derivation} value={derivation}>{derivation}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="flex flex-col gap-2 text-sm font-medium text-ink">
              Deprecated status
              <select
                className="h-10 rounded-md border border-line bg-white px-3 text-sm"
                onChange={(event) => {
                  setDictionaryDeprecatedFilter(event.target.value);
                  resetDictionaryPage();
                }}
                value={dictionaryDeprecatedFilter}
              >
                <option value="all">All variables</option>
                <option value="false">Active variables</option>
                <option value="true">Deprecated variables</option>
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
                  <p className="text-xs uppercase tracking-wide text-muted">Research variables</p>
                  <p className="mt-1 text-2xl font-semibold text-ink">{dictionary.stats.research_variable_count}</p>
                </div>
                <div className="rounded-lg border border-line bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted">Process event types</p>
                  <p className="mt-1 text-2xl font-semibold text-ink">{dictionary.stats.process_event_type_count}</p>
                </div>
                <div className="rounded-lg border border-line bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted">Internal / excluded</p>
                  <p className="mt-1 text-2xl font-semibold text-ink">
                    {dictionary.stats.internal_schema_field_count} / {dictionary.stats.excluded_platform_field_count}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-slate-50 p-3 text-sm">
                <span>
                  Showing {dictionary.first_visible_row}-{dictionary.last_visible_row} of {dictionary.total} rows in the selected section
                </span>
                <span>
                  Page {dictionary.page} of {dictionary.total_pages}
                </span>
                <div className="flex flex-wrap gap-2">
                  <button className="rounded-md border border-line bg-white px-3 py-1 font-semibold disabled:text-slate-400" disabled={dictionary.page <= 1} onClick={() => setDictionaryPage(1)} type="button">First</button>
                  <button className="rounded-md border border-line bg-white px-3 py-1 font-semibold disabled:text-slate-400" disabled={dictionary.page <= 1} onClick={() => setDictionaryPage((page) => Math.max(1, page - 1))} type="button">Previous</button>
                  <button className="rounded-md border border-line bg-white px-3 py-1 font-semibold disabled:text-slate-400" disabled={dictionary.page >= dictionary.total_pages} onClick={() => setDictionaryPage((page) => page + 1)} type="button">Next</button>
                  <button className="rounded-md border border-line bg-white px-3 py-1 font-semibold disabled:text-slate-400" disabled={dictionary.page >= dictionary.total_pages} onClick={() => setDictionaryPage(dictionary.total_pages)} type="button">Last</button>
                </div>
              </div>
              <div className="space-y-3" aria-label="Data dictionary selected entity list">
                {dictionary.rows.map((entry) => (
                  <DictionaryCard entry={entry} entityType={dictionaryEntityType} key={entry.qualified_name ?? entry.event_type} />
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
