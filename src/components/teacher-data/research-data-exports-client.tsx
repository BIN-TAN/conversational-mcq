"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BookOpen, Download, Loader2, RefreshCw } from "lucide-react";
import { errorFromUnknown, fetchExportJobs, fetchResearchExportReadiness } from "./api";
import { EmptyPanel, ErrorPanel, formatDate, StatusPill } from "./ui";
import type { ExportJob, ResearchExportReadiness, StructuredApiError } from "./types";

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
    core_research_variable_count: number;
    supplementary_research_variable_count: number;
    process_event_type_count: number;
    core_process_event_count: number;
    operational_process_event_count: number;
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
  research_category_counts: Record<string, number>;
  research_category_dictionary: Array<{
    category_id: string;
    display_name: string;
    definition: string;
    inclusion_criteria: string;
    exclusion_criteria: string;
    typical_measurement_levels: string;
    included_datasets: string;
    examples_of_data_collected: string;
    interpretation_boundaries: string;
    variable_count: string;
    display_order: string;
  }>;
  filters: Record<string, string>;
  filter_options: {
    page_sizes: number[];
    entity_types: Array<{ value: DictionaryEntityType; label: string }>;
    categories: string[];
    table_names: string[];
    measurement_levels: string[];
    documentation_tiers: string[];
    process_event_tiers: string[];
    actor_or_sources: string[];
    scopes: string[];
    source_natures: string[];
    privacy_levels: string[];
    permitted_audiences: string[];
    export_policies: string[];
    derivations: string[];
    field_families: string[];
    deprecated_values: string[];
  };
};

type SectionId = "dataset" | "dictionary";
type ScopeMode = "all" | "assessment" | "student" | "session";
type DictionaryEntityType =
  | "research_variable"
  | "process_event_code"
  | "internal_schema_field"
  | "excluded_platform_field";

const sections: Array<{ id: SectionId; label: string }> = [
  { id: "dataset", label: "Research dataset" },
  { id: "dictionary", label: "Data dictionary" }
];

const dictionarySectionGroups: Array<{
  label: string;
  options: Array<{ id: DictionaryEntityType; label: string }>;
}> = [
  {
    label: "Research documentation",
    options: [
      { id: "research_variable", label: "Research dataset variables" },
      { id: "process_event_code", label: "Learning-process event definitions" }
    ]
  },
  {
    label: "Technical documentation",
    options: [
      { id: "internal_schema_field", label: "Internal database schema — Technical" },
      { id: "excluded_platform_field", label: "Excluded platform and security fields — Not exported" }
    ]
  }
];

const dictionarySectionMeta: Record<
  DictionaryEntityType,
  {
    description: string;
    downloadLabel: string;
    resultNoun: string;
    searchLabel: string;
    searchPlaceholder: string;
  }
> = {
  research_variable: {
    description: "Columns and derived measures available in research data exports. Restricted fields require explicit authorization.",
    downloadLabel: "Download research variable dictionary CSV",
    resultNoun: "research variables",
    searchLabel: "Search variable name",
    searchPlaceholder: "Variable name, definition, method, or source"
  },
  process_event_code: {
    description: "Definitions of logged learning-process event types. Actual event occurrences are stored as rows in the process-events dataset.",
    downloadLabel: "Download learning-process event codebook CSV",
    resultNoun: "learning-process event definitions",
    searchLabel: "Search event name",
    searchPlaceholder: "Event type, trigger, actor, or payload field"
  },
  internal_schema_field: {
    description: "Developer-facing source-schema and lineage documentation. These internal fields are not ordinary research export columns.",
    downloadLabel: "Download internal schema appendix CSV",
    resultNoun: "internal schema fields",
    searchLabel: "Search field name",
    searchPlaceholder: "Model, field, purpose, or mapping"
  },
  excluded_platform_field: {
    description: "Account, security, credential, infrastructure, and other fields intentionally excluded from ordinary research exports. Values are never shown here.",
    downloadLabel: "Download excluded-field inventory CSV",
    resultNoun: "excluded fields",
    searchLabel: "Search field name",
    searchPlaceholder: "Source table, field, exclusion reason, or policy"
  }
};

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

function ActionButton({
  children,
  disabled = false,
  onClick
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={buttonClass(disabled)} disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
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
  sessionId: string;
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
  if (input.scopeMode === "session" && input.sessionId) {
    params.set("session_public_id", input.sessionId);
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
  sessionId: string;
  scopeMode: ScopeMode;
}) {
  if (input.scopeMode === "assessment") {
    return input.options?.assessments.find((assessment) => assessment.assessment_public_id === input.assessmentId)?.counts ?? null;
  }
  if (input.scopeMode === "student") {
    return input.options?.students.find((student) => student.user_id === input.studentId)?.counts ?? null;
  }
  if (input.scopeMode === "session") {
    return input.sessionId
      ? {
          sessions: 1,
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
      : null;
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

function dictionaryEntryType(entry: DataDictionaryEntry, fallback: DictionaryEntityType): DictionaryEntityType {
  const entityType = entry.entity_type;
  if (
    entityType === "research_variable" ||
    entityType === "process_event_code" ||
    entityType === "internal_schema_field" ||
    entityType === "excluded_platform_field"
  ) {
    return entityType;
  }
  return fallback;
}

function dictionaryEntryKey(entry: DataDictionaryEntry, index: number) {
  return entry.qualified_name || entry.event_type || `${entry.entity_type || "dictionary-row"}:${index}`;
}

function DictionaryCard({ entry, entityType }: { entry: DataDictionaryEntry; entityType: DictionaryEntityType }) {
  const effectiveEntityType = dictionaryEntryType(entry, entityType);

  if (effectiveEntityType === "process_event_code") {
    const eventType = entry.event_type || entry.qualified_name || "Unknown process event";
    return (
      <details className="group rounded-lg border border-line bg-white p-4 shadow-soft">
        <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Event type</p>
            <h3 className="mt-1 break-words font-mono text-base font-semibold text-ink">{eventType}</h3>
            <p className="mt-1 text-sm text-muted">
              {entry.event_category || "Uncategorized"} · {entry.process_event_tier || "process event"} · {entry.measurement_level}
            </p>
          </div>
          <span className="rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-semibold text-ink">
            {entry.process_event_tier || entry.event_category}
          </span>
        </summary>
        <dl className="mt-4 grid gap-4 md:grid-cols-2">
          <DefinitionRow label="Trigger" value={entry.trigger} />
          <DefinitionRow label="Actor/source" value={entry.actor_or_source} />
          <DefinitionRow label="Measurement level/scope" value={entry.measurement_level} />
          <DefinitionRow label="Session or item scope" value={entry.session_or_item_scope} />
          <DefinitionRow label="Timestamp meaning" value={entry.timestamp_meaning} />
          <DefinitionRow label="Payload fields" value={entry.payload_fields} />
          <DefinitionRow label="Derived variables" value={entry.derived_variables} />
          <DefinitionRow label="Source code reference" value={entry.source_code_reference} />
          <DefinitionRow label="Review status" value={entry.semantic_review_status} />
          <DefinitionRow label="Interpretation caution" value={entry.interpretation_caution} />
        </dl>
      </details>
    );
  }

  if (effectiveEntityType === "internal_schema_field") {
    const qualifiedName = entry.qualified_name || [entry.model_name, entry.field_name].filter(Boolean).join(".") || "Unknown internal field";
    return (
      <details className="group rounded-lg border border-line bg-white p-4 shadow-soft">
        <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Internal field</p>
            <h3 className="mt-1 break-words font-mono text-base font-semibold text-ink">{qualifiedName}</h3>
            <p className="mt-1 text-sm text-muted">{entry.model_name || "Internal schema"} · {entry.database_type || "field"}</p>
          </div>
          <span className="rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-semibold text-ink">
            {entry.export_policy}
          </span>
        </summary>
        <dl className="mt-4 grid gap-4 md:grid-cols-2">
          <DefinitionRow label="Model / field" value={`${entry.model_name}.${entry.field_name}`} />
          <DefinitionRow label="Database type" value={entry.database_type} />
          <DefinitionRow label="Internal purpose" value={entry.internal_purpose} />
          <DefinitionRow label="Research-variable mapping" value={entry.research_variable_mapping || "No direct research variable."} />
          <DefinitionRow label="Privacy" value={entry.privacy_level} />
          <DefinitionRow label="Audience" value={entry.audience} />
        </dl>
      </details>
    );
  }

  if (effectiveEntityType === "excluded_platform_field") {
    const qualifiedName = entry.qualified_name || [entry.source_table, entry.field_name].filter(Boolean).join(".") || "Unknown excluded field";
    return (
      <details className="group rounded-lg border border-line bg-white p-4 shadow-soft">
        <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Excluded field</p>
            <h3 className="mt-1 break-words font-mono text-base font-semibold text-ink">{qualifiedName}</h3>
            <p className="mt-1 text-sm text-muted">{entry.exclusion_reason || entry.exclusion_category || "Excluded from ordinary research exports"}</p>
          </div>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
            {entry.exclusion_category}
          </span>
        </summary>
        <dl className="mt-4 grid gap-4 md:grid-cols-2">
          <DefinitionRow label="Source table" value={entry.source_table} />
          <DefinitionRow label="Research-variable mapping" value={entry.research_variable_mapping || "No direct research variable."} />
          <DefinitionRow label="Exclusion reason" value={entry.exclusion_reason} />
          <DefinitionRow label="Permitted audience" value={entry.permitted_audience} />
          <DefinitionRow label="Export policy" value={entry.export_policy} />
          <DefinitionRow label="Notes" value={entry.notes} />
        </dl>
      </details>
    );
  }

  const qualifiedName = entry.qualified_name || [entry.table_name, entry.variable_name].filter(Boolean).join(".") || "Unknown variable";
  const category = entry.research_category_display_name || entry.substantive_category || "Uncategorized";
  return (
    <details className="group rounded-lg border border-line bg-white p-4 shadow-soft">
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Research variable</p>
          <h3 className="mt-1 break-words font-mono text-base font-semibold text-ink">{qualifiedName}</h3>
          <p className="mt-1 text-sm text-muted">
            {entry.display_name || entry.variable_name} · {category} · {entry.data_type || "value"}
          </p>
        </div>
        <span className="rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-semibold text-ink">
          {entry.documentation_tier || "core_research"}
        </span>
      </summary>
      <dl className="mt-4 grid gap-4 md:grid-cols-2">
        <DefinitionRow label="Dataset/table" value={entry.table_name} />
        <DefinitionRow label="Core category" value={category} />
        <DefinitionRow label="Documentation tier" value={entry.documentation_tier} />
        <DefinitionRow label="Measurement level" value={entry.measurement_level} />
        <DefinitionRow label="Type" value={entry.data_type} />
        <DefinitionRow label="Legacy category" value={entry.substantive_category} />
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
        <DefinitionRow label="Source code reference" value={entry.source_code_reference} />
        <DefinitionRow label="Source service/function" value={entry.source_service_or_function} />
        <DefinitionRow label="Review status" value={entry.semantic_review_status} />
        <DefinitionRow label="Applicable record types" value={entry.applicable_record_types} />
        <DefinitionRow label="Canonical variable" value={entry.canonical_qualified_name} />
        <DefinitionRow label="Duplicate relationship" value={entry.duplicate_relationship} />
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
    </details>
  );
}

function TimingDataGuide() {
  return (
    <div className="rounded-md border border-line bg-white p-3">
      <p className="text-sm font-semibold text-ink">Timing data guide</p>
      <div className="mt-3 grid gap-3 text-sm leading-6 text-muted md:grid-cols-3">
        <div>
          <p className="font-semibold text-ink">Item level</p>
          <p>
            Overall item elapsed response time, time to first action, time to first option selection, reasoning-stage time,
            and confidence-stage time are collected separately for each administered item.
          </p>
        </div>
        <div>
          <p className="font-semibold text-ink">Conversation-turn level</p>
          <p>
            Prompt-to-next-student-turn or action latency can occur multiple times for one item because answer, reasoning,
            confidence, and tempting-option stages may each create turns or actions.
          </p>
        </div>
        <div>
          <p className="font-semibold text-ink">Session level</p>
          <p>
            Session elapsed time, active interaction time, idle time, page-hidden time, and long pauses are contextual
            process signals. Missing instrumentation is null, not zero.
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted">
        Elapsed time is not equivalent to active cognitive-processing time. Conversational latency is not equivalent to
        ability, effort, or motivation, and page-hidden or idle time does not prove disengagement.
      </p>
    </div>
  );
}

function CategoryGuide({
  dictionary,
  selectedCategory
}: {
  dictionary: DataDictionaryResponse;
  selectedCategory: string;
}) {
  if (dictionary.entity_type !== "research_variable") return null;
  const categories = [...dictionary.research_category_dictionary].sort(
    (left, right) => Number(left.display_order) - Number(right.display_order)
  );
  const selected =
    selectedCategory === "all"
      ? null
      : categories.find((category) => category.display_name === selectedCategory || category.category_id === selectedCategory) ?? null;
  const selectedIsTiming = selected?.display_name === "Timing and interaction data" || selected?.category_id === "timing_and_interaction";

  return (
    <section className="rounded-lg border border-line bg-slate-50 p-4" aria-labelledby="category-guide-heading">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted" id="category-guide-heading">
        Category guide
      </h3>
      {selected ? (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-base font-semibold text-ink">{selected.display_name}</p>
            <p className="mt-1 text-sm leading-6 text-muted">{selected.definition}</p>
          </div>
          <dl className="grid gap-3 md:grid-cols-2">
            <DefinitionRow label="What data are collected" value={selected.examples_of_data_collected} />
            <DefinitionRow label="Main datasets" value={selected.included_datasets} />
            <DefinitionRow label="Typical row grain" value={selected.typical_measurement_levels} />
            <DefinitionRow label="Number of active core variables" value={selected.variable_count} />
            <div className="md:col-span-2">
              <DefinitionRow label="Interpretation boundaries" value={selected.interpretation_boundaries} />
            </div>
          </dl>
          {selectedIsTiming ? <TimingDataGuide /> : null}
        </div>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {categories.map((category) => (
            <div className="rounded-md border border-line bg-white p-3" key={category.category_id}>
              <p className="font-semibold text-ink">{category.display_name}</p>
              <p className="mt-1 text-sm leading-6 text-muted">{category.definition}</p>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">
                {category.variable_count} active core variables
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function ResearchDataExportsClient({ initialSection = "dataset" }: { initialSection?: SectionId }) {
  const [activeSection, setActiveSection] = useState<SectionId>(initialSection);
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [readiness, setReadiness] = useState<ResearchExportReadiness | null>(null);
  const [assessmentId, setAssessmentId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("all");
  const [includeIncomplete, setIncludeIncomplete] = useState(true);
  const [includeRestricted, setIncludeRestricted] = useState(false);
  const [dictionary, setDictionary] = useState<DataDictionaryResponse | null>(null);
  const [dictionaryEntityType, setDictionaryEntityType] = useState<DictionaryEntityType>("research_variable");
  const [dictionarySearch, setDictionarySearch] = useState("");
  const [dictionaryCategoryFilter, setDictionaryCategoryFilter] = useState("all");
  const [dictionaryDeprecatedFilter, setDictionaryDeprecatedFilter] = useState("false");
  const [dictionaryPage, setDictionaryPage] = useState(1);
  const [dictionaryPageSize, setDictionaryPageSize] = useState(100);
  const [dictionaryLoading, setDictionaryLoading] = useState(false);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingDataset, setGeneratingDataset] = useState(false);

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
    const requestedSessionId = params.get("session_public_id")?.trim();
    if (requestedSessionId) {
      setSessionId(requestedSessionId);
      setScopeMode("session");
      setIncludeIncomplete(true);
    }
    if (params.get("include_restricted_fields") === "true") {
      setIncludeRestricted(true);
    }
  }, []);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [loadedOptions, loadedJobs, loadedReadiness] = await Promise.all([
        fetchOptions(),
        fetchExportJobs(),
        fetchResearchExportReadiness()
      ]);
      setOptions(loadedOptions);
      setJobs(loadedJobs.export_jobs);
      setReadiness(loadedReadiness.readiness);
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
        category: dictionaryEntityType === "research_variable" ? dictionaryCategoryFilter : undefined,
        documentation_tier: dictionaryEntityType === "research_variable" ? "core_research" : undefined,
        process_event_tier: dictionaryEntityType === "process_event_code" ? "core_learning_process" : undefined,
        deprecated: dictionaryEntityType === "research_variable" || dictionaryEntityType === "process_event_code" ? dictionaryDeprecatedFilter : undefined
      }),
    [
      dictionaryCategoryFilter,
      dictionaryDeprecatedFilter,
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
    let cancelled = false;
    setDictionaryLoading(true);
    setError(null);
    fetchDictionary(dictionaryQuery)
      .then((loadedDictionary) => {
        if (!cancelled) setDictionary(loadedDictionary);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorFromUnknown(caught));
      })
      .finally(() => {
        if (!cancelled) setDictionaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
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
    if (activeSection === "dataset" && scopeMode === "session" && sessionId) {
      params.set("session_public_id", sessionId);
    }
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [activeSection, dictionaryPage, dictionaryPageSize, dictionaryQuery, scopeMode, sessionId]);

  function resetDictionaryPage() {
    setDictionaryPage(1);
  }

  function resetDictionaryFiltersForSection(nextType: DictionaryEntityType) {
    setDictionaryEntityType(nextType);
    setDictionarySearch("");
    setDictionaryCategoryFilter("all");
    setDictionaryDeprecatedFilter(nextType === "research_variable" || nextType === "process_event_code" ? "false" : "all");
    resetDictionaryPage();
  }

  const counts = selectedCounts({ options, assessmentId, studentId, sessionId, scopeMode });
  const hasData = scopeMode === "session" ? Boolean(sessionId) : (counts?.sessions ?? 0) > 0;
  const datasetQuery = scopeQuery({
    assessmentId,
    studentId,
    sessionId,
    scopeMode,
    includeIncomplete,
    includeRestricted
  });
  const readinessBlocked = readiness ? !readiness.ready : true;

  async function generateDataset() {
    setGeneratingDataset(true);
    setError(null);
    try {
      const response = await fetch(`/api/teacher/research-data/analysis-ready${datasetQuery}`, {
        method: "POST",
        headers: { Accept: "application/json" }
      });
      const payload = (await response.json().catch(() => null)) as
        | { export_job?: ExportJob; error?: StructuredApiError }
        | null;
      if (!response.ok) {
        setError(
          payload?.error ?? {
            code: "research_export_request_failed",
            message: "Research dataset generation could not be started."
          }
        );
        await refresh();
        return;
      }
      const job = payload?.export_job;
      if (!job?.download_url) {
        setError({
          code: "research_export_download_unavailable",
          message: "The research dataset was generated but no download URL was returned."
        });
        await refresh();
        return;
      }
      await refresh();
      window.location.assign(job.download_url);
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setGeneratingDataset(false);
    }
  }

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
            <div className="mt-4 grid gap-4 lg:grid-cols-4">
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
                  <option value="session">Selected session</option>
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
              <label className="flex flex-col gap-2 text-sm font-medium text-ink">
                Session
                <input
                  className="h-10 rounded-md border border-line bg-white px-3 text-sm disabled:bg-slate-100"
                  disabled={scopeMode !== "session"}
                  onChange={(event) => setSessionId(event.target.value)}
                  placeholder="sess_..."
                  value={sessionId}
                />
              </label>
            </div>
            {countPills(counts)}
            {readiness && !readiness.ready ? (
              <section className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="font-semibold">Research export is not configured</h3>
                    <p className="mt-1">
                      Production research exports require a server-side pseudonymization key. Assessment and session data remain
                      available, but research files cannot be generated until the deployment is configured.
                    </p>
                    <p className="mt-2 font-medium">
                      {readiness.blocking_reasons[0]?.label ?? "Research export readiness is blocked."}
                    </p>
                  </div>
                  <button
                    className="inline-flex h-9 items-center justify-center rounded-md border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-950 hover:border-amber-500"
                    onClick={() => void refresh()}
                    type="button"
                  >
                    Refresh readiness
                  </button>
                </div>
              </section>
            ) : readiness ? (
              <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                Research export ready. Pseudonymization: {readiness.pseudonymization_version}; key fingerprint:{" "}
                {readiness.safe_key_fingerprint ?? "non-production fixture"}.
              </p>
            ) : null}
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
              <ActionButton disabled={!hasData || readinessBlocked || generatingDataset} onClick={() => void generateDataset()}>
                {generatingDataset ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="h-4 w-4" aria-hidden="true" />
                )}
                Generate research dataset
              </ActionButton>
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
                      <th className="px-3 py-2">Failure</th>
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
                        <td className="max-w-xs px-3 py-2 text-xs text-muted">
                          {job.status === "failed" ? jobOption(job, "failure_code") || job.error_message || "Export failed" : ""}
                        </td>
                        <td className="px-3 py-2">{formatDate(job.created_at)}</td>
                        <td className="px-3 py-2">{formatDate(job.completed_at)}</td>
                        <td className="px-3 py-2">
                          {job.download_url ? (
                            <a className="font-semibold text-accent hover:underline" href={job.download_url}>Download</a>
                          ) : job.status === "failed" && jobOption(job, "retryable") === "true" ? (
                            <button className="font-semibold text-accent hover:underline" onClick={() => void generateDataset()} type="button">
                              Retry
                            </button>
                          ) : (
                            "Not available"
                          )}
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
                This page documents research fields. Use Research dataset to generate and download the actual student/session data.
              </p>
              <button
                className="mt-3 inline-flex h-9 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-accent"
                onClick={() => setActiveSection("dataset")}
                type="button"
              >
                Go to Research dataset
              </button>
            </div>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <label className="flex flex-col gap-2 text-sm font-medium text-ink">
              Dictionary section
              <select
                className="h-10 rounded-md border border-line bg-white px-3 text-sm"
                onChange={(event) => resetDictionaryFiltersForSection(event.target.value as DictionaryEntityType)}
                value={dictionaryEntityType}
              >
                {dictionarySectionGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((entity) => (
                      <option key={entity.id} value={entity.id}>{entity.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="text-sm font-normal leading-6 text-muted">
                {dictionarySectionMeta[dictionaryEntityType].description}
              </span>
            </label>
            <div className="self-end">
              <DownloadLink
                href={`/api/teacher/research-data/dictionary${dictionaryDownloadQuery}`}
                label={dictionarySectionMeta[dictionaryEntityType].downloadLabel}
              />
              <p className="mt-2 text-xs text-muted">Download includes all matching records, not only the current page.</p>
            </div>
          </div>
          <div className={dictionaryEntityType === "research_variable" ? "mt-5 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]" : "mt-5 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"}>
            <label className="flex flex-col gap-2 text-sm font-medium text-ink">
              {dictionarySectionMeta[dictionaryEntityType].searchLabel}
              <input
                className="h-10 rounded-md border border-line bg-white px-3 text-sm"
                onChange={(event) => {
                  setDictionarySearch(event.target.value);
                  resetDictionaryPage();
                }}
                placeholder={dictionarySectionMeta[dictionaryEntityType].searchPlaceholder}
                type="search"
                value={dictionarySearch}
              />
            </label>
            {dictionaryEntityType === "research_variable" ? (
              <label className="flex flex-col gap-2 text-sm font-medium text-ink">
                Category
                <select
                  className="h-10 rounded-md border border-line bg-white px-3 text-sm"
                  onChange={(event) => {
                    setDictionaryCategoryFilter(event.target.value);
                    resetDictionaryPage();
                  }}
                  value={dictionaryCategoryFilter}
                >
                  <option value="all">All categories</option>
                  {(dictionary?.filter_options.categories ?? []).map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </label>
            ) : null}
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
          {dictionaryLoading ? (
            <p className="mt-4 inline-flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading data dictionary
            </p>
          ) : null}
          {dictionary ? (
            <div className="mt-5 space-y-4">
              <CategoryGuide dictionary={dictionary} selectedCategory={dictionaryCategoryFilter} />
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-slate-50 p-3 text-sm">
                <span>
                  Showing {dictionary.first_visible_row}-{dictionary.last_visible_row} of {dictionary.total} {dictionarySectionMeta[dictionary.entity_type].resultNoun}
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
                {dictionary.rows.map((entry, index) => (
                  <DictionaryCard
                    entry={entry}
                    entityType={dictionary.entity_type}
                    key={`${dictionaryQuery.toString()}:${dictionaryEntryKey(entry, index)}`}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
