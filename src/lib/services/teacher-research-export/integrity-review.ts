import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import {
  buildItemAbilityEvidence,
  summarizeConceptAbilityEvidence
} from "@/lib/services/student-assessment/ability-evidence";
import { asArray, asRecord } from "@/lib/services/teacher-review/serializers";
import {
  buildTeacherResearchBulkExport,
  TEACHER_RESEARCH_EXPORT_VERSION
} from "./service";

export const RESEARCH_EXPORT_INTEGRITY_REVIEW_VERSION =
  "research-export-integrity-review-v1" as const;

export const REQUIRED_RESEARCH_EXPORT_FILES = [
  "manifest.json",
  "README_EXPORT.md",
  "data_dictionary.json",
  "students.csv",
  "sessions.csv",
  "item_responses.csv",
  "conversation_turns_readable.jsonl",
  "conversation_turns_structured_redacted.jsonl",
  "response_packages.jsonl",
  "process_event_counts.csv",
  "process_events_summary.jsonl",
  "process_events_redacted.jsonl",
  "turn_response_latencies.csv",
  "turn_response_latencies.jsonl",
  "engagement_process_features.csv",
  "engagement_process_features.jsonl",
  "engagement_evidence_packets.jsonl",
  "misconception_diagnosis_or_profile_packets.jsonl",
  "formative_purpose_or_value_packets.jsonl",
  "activity_runtime_attempts.jsonl",
  "activity_misconception_evidence_records.jsonl",
  "post_activity_diagnostic_snapshots.jsonl",
  "agent_calls_summary.jsonl",
  "session_data_completeness.jsonl",
  "limitations.jsonl"
] as const;

const REQUIRED_DICTIONARY_FIELDS = [
  "item_response_time_ms",
  "turn_response_latency_ms",
  "prompt_to_next_student_turn_latency_ms",
  "prompt_to_next_student_action_latency_ms",
  "time_to_first_action_ms",
  "first_action_to_submission_ms",
  "last_action_to_submission_ms",
  "prompt_to_final_submission_ms",
  "active_interaction_time_ms",
  "idle_time_ms",
  "idle_ratio",
  "focus_adjusted_time_ms",
  "reasoning_input_elapsed_time_ms",
  "active_typing_time_ms",
  "unsupported_correct_response",
  "correctness_support_level",
  "estimated_guessing_risk",
  "estimated_guessing_risk_basis",
  "answer_selection_evidence_weight",
  "uncertainty_marker_present",
  "uncertainty_marker_types"
] as const;

const REQUIRED_INTERPRETATION_NOTE_MARKERS = [
  "not equivalent to prompt-to-response latency",
  "reading, thinking, or idle time",
  "evidence-quality context",
  "not a student-facing label",
  "Correctness alone is not evidence of understanding"
] as const;

const ALLOWED_LATENCY_SCOPES = new Set([
  "item",
  "confidence",
  "reasoning",
  "tempting_option",
  "activity",
  "general_dialogue"
]);
const ALLOWED_LATENCY_SOURCES = new Set([
  "conversation_turns",
  "process_events",
  "mixed",
  "unavailable"
]);
const ALLOWED_CORRECTNESS_SUPPORT_LEVELS = new Set([
  "supported_by_reasoning",
  "weakly_supported",
  "unsupported",
  "contradicted_by_reasoning",
  "not_applicable"
]);
const ALLOWED_GUESSING_RISK = new Set(["none", "low", "medium", "high", "unavailable"]);
const ALLOWED_ANSWER_SELECTION_WEIGHTS = new Set(["high", "medium", "low", "minimal"]);
const ALLOWED_UNCERTAINTY_MARKERS = new Set([
  "not_sure_language",
  "dont_know_language",
  "guessed_language",
  "low_confidence_language",
  "other_uncertainty_language"
]);

type ExportResult = Awaited<ReturnType<typeof buildTeacherResearchBulkExport>>;
type ExportEntry = ExportResult["files"][number];
type JsonRecord = Record<string, unknown>;

type Finding = {
  code: string;
  message: string;
  file?: string;
  key?: string;
  severity: "failure" | "limitation";
};

type IntegrityReviewInput = {
  session_public_id?: string;
  write_artifact?: boolean;
  output_dir?: string;
};

function artifactTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function entryText(entry: ExportEntry) {
  return Buffer.isBuffer(entry.data) ? entry.data.toString("utf8") : entry.data;
}

function fileMap(exportResult: ExportResult) {
  return new Map(exportResult.files.map((entry) => [entry.path, entry]));
}

function parseJsonEntry<T = JsonRecord>(files: Map<string, ExportEntry>, filePath: string): T | null {
  const entry = files.get(filePath);
  if (!entry) return null;
  return JSON.parse(entryText(entry)) as T;
}

function parseJsonlRows<T = JsonRecord>(files: Map<string, ExportEntry>, filePath: string): T[] {
  const entry = files.get(filePath);
  if (!entry) return [];
  const text = entryText(entry).trim();
  if (!text) return [];
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
}

function parseCsvRows(files: Map<string, ExportEntry>, filePath: string): JsonRecord[] {
  const entry = files.get(filePath);
  if (!entry) return [];
  const text = entryText(entry);
  return parseCsv(text, {
    bom: true,
    columns: true,
    skip_empty_lines: true
  }) as JsonRecord[];
}

function csvHeaders(files: Map<string, ExportEntry>, filePath: string) {
  const entry = files.get(filePath);
  if (!entry) return [];
  const text = entryText(entry);
  const rows = parseCsv(text, {
    bom: true,
    to_line: 1
  }) as string[][];
  return rows[0] ?? [];
}

function actualRowCount(entry: ExportEntry) {
  const text = entryText(entry);
  if (entry.path.endsWith(".csv")) {
    return parseCsv(text, {
      bom: true,
      columns: true,
      skip_empty_lines: true
    }).length as number;
  }
  if (entry.path.endsWith(".jsonl")) {
    return text.trim() ? text.trim().split("\n").filter(Boolean).length : 0;
  }
  if (entry.path.endsWith(".json")) return 1;
  return entry.path.endsWith(".md") ? 0 : entry.row_count;
}

function collectTopLevelFields(files: Map<string, ExportEntry>, entry: ExportEntry) {
  if (entry.path.endsWith(".csv")) {
    return csvHeaders(files, entry.path);
  }
  if (entry.path.endsWith(".jsonl")) {
    const fields = new Set<string>();
    for (const row of parseJsonlRows(files, entry.path)) {
      for (const key of Object.keys(asRecord(row))) {
        fields.add(key);
      }
    }
    return [...fields].sort();
  }
  return [];
}

function dictionaryHasDefinition(dictionary: JsonRecord, fieldName: string) {
  const mergedDefinitions = {
    ...asRecord(dictionary.column_definitions),
    ...asRecord(dictionary.response_time_definitions),
    ...asRecord(dictionary.engagement_process_feature_definitions),
    ...asRecord(dictionary.correctness_inflation_definitions),
    ...asRecord(dictionary.process_event_definitions)
  };

  if (Object.prototype.hasOwnProperty.call(mergedDefinitions, fieldName)) return true;
  return JSON.stringify(dictionary).includes(fieldName);
}

function pushFinding(findings: Finding[], finding: Finding) {
  findings.push(finding);
}

function recordKeys(records: JsonRecord[], key: string) {
  return new Set(records.map((record) => record[key]).filter((value): value is string => typeof value === "string"));
}

function findOrphans(rows: JsonRecord[], key: string, allowed: Set<string>) {
  return rows
    .map((row) => row[key])
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .filter((value) => !allowed.has(value));
}

function safeRecordSample(values: string[], limit = 10) {
  return [...new Set(values)].slice(0, limit);
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function validateManifest(input: {
  exportResult: ExportResult;
  files: Map<string, ExportEntry>;
  findings: Finding[];
}) {
  const manifest = parseJsonEntry<JsonRecord>(input.files, "manifest.json");
  if (!manifest) {
    pushFinding(input.findings, {
      code: "manifest_missing",
      message: "manifest.json is missing or invalid.",
      file: "manifest.json",
      severity: "failure"
    });
    return { manifest: null, passed: false };
  }

  const requiredKeys = [
    "generated_at",
    "export_version",
    "redaction_policy",
    "restricted_item_keys_included",
    "row_counts",
    "limitations"
  ];
  for (const key of requiredKeys) {
    if (!(key in manifest)) {
      pushFinding(input.findings, {
        code: "manifest_required_key_missing",
        message: `manifest.json is missing ${key}.`,
        file: "manifest.json",
        key,
        severity: "failure"
      });
    }
  }

  if (!("included_sources" in manifest) && !("included_tables_or_sources" in manifest)) {
    pushFinding(input.findings, {
      code: "manifest_included_sources_missing",
      message: "manifest.json is missing included_sources.",
      file: "manifest.json",
      severity: "failure"
    });
  }

  if (manifest.restricted_item_keys_included !== false) {
    pushFinding(input.findings, {
      code: "default_restricted_item_keys_not_false",
      message: "Default manifest must mark restricted item keys as excluded.",
      file: "manifest.json",
      severity: "failure"
    });
  }

  const rowCounts = asRecord(manifest.row_counts);
  for (const entry of input.exportResult.files) {
    if (!(entry.path in rowCounts)) {
      pushFinding(input.findings, {
        code: "manifest_row_count_missing",
        message: `manifest.json has no row count for ${entry.path}.`,
        file: "manifest.json",
        key: entry.path,
        severity: "failure"
      });
      continue;
    }

    const expected = Number(rowCounts[entry.path]);
    const actual = actualRowCount(entry);
    if (expected !== actual) {
      pushFinding(input.findings, {
        code: "manifest_row_count_mismatch",
        message: `${entry.path} manifest row count ${expected} does not match actual ${actual}.`,
        file: entry.path,
        severity: "failure"
      });
    }
  }

  const includedSources = new Set([
    ...asArray(manifest.included_sources),
    ...asArray(manifest.included_tables_or_sources)
  ].filter((value): value is string => typeof value === "string"));
  for (const entry of input.exportResult.files) {
    if (!includedSources.has(entry.path)) {
      pushFinding(input.findings, {
        code: "manifest_exported_file_not_listed",
        message: `${entry.path} is exported but not listed in manifest sources.`,
        file: "manifest.json",
        key: entry.path,
        severity: "failure"
      });
    }
  }

  return {
    manifest,
    passed: !input.findings.some((finding) => finding.code.startsWith("manifest") || finding.code === "default_restricted_item_keys_not_false")
  };
}

function validateDataDictionary(input: {
  exportResult: ExportResult;
  files: Map<string, ExportEntry>;
  findings: Finding[];
}) {
  const dictionary = parseJsonEntry<JsonRecord>(input.files, "data_dictionary.json");
  if (!dictionary) {
    pushFinding(input.findings, {
      code: "data_dictionary_missing",
      message: "data_dictionary.json is missing or invalid.",
      file: "data_dictionary.json",
      severity: "failure"
    });
    return { dictionary: null, passed: false };
  }

  const fileDefinitions = asRecord(dictionary.files);
  for (const entry of input.exportResult.files) {
    if (!(entry.path in fileDefinitions)) {
      pushFinding(input.findings, {
        code: "data_dictionary_file_missing",
        message: `data_dictionary.json does not describe ${entry.path}.`,
        file: "data_dictionary.json",
        key: entry.path,
        severity: "failure"
      });
    }
  }

  for (const entry of input.exportResult.files) {
    if (["manifest.json", "README_EXPORT.md", "data_dictionary.json"].includes(entry.path)) continue;
    for (const field of collectTopLevelFields(input.files, entry)) {
      if (!dictionaryHasDefinition(dictionary, field)) {
        pushFinding(input.findings, {
          code: "data_dictionary_field_missing",
          message: `data_dictionary.json does not define ${field} from ${entry.path}.`,
          file: entry.path,
          key: field,
          severity: "failure"
        });
      }
    }
  }

  for (const field of REQUIRED_DICTIONARY_FIELDS) {
    if (!dictionaryHasDefinition(dictionary, field)) {
      pushFinding(input.findings, {
        code: "data_dictionary_required_field_missing",
        message: `data_dictionary.json does not define required field ${field}.`,
        file: "data_dictionary.json",
        key: field,
        severity: "failure"
      });
    }
  }

  const serialized = JSON.stringify(dictionary);
  for (const marker of REQUIRED_INTERPRETATION_NOTE_MARKERS) {
    if (!serialized.includes(marker)) {
      pushFinding(input.findings, {
        code: "data_dictionary_interpretation_note_missing",
        message: `data_dictionary.json is missing interpretation note marker: ${marker}.`,
        file: "data_dictionary.json",
        key: marker,
        severity: "failure"
      });
    }
  }

  return {
    dictionary,
    passed: !input.findings.some((finding) => finding.code.startsWith("data_dictionary"))
  };
}

function validateJoinability(input: { files: Map<string, ExportEntry>; findings: Finding[] }) {
  const sessions = parseCsvRows(input.files, "sessions.csv");
  const students = parseCsvRows(input.files, "students.csv");
  const sessionIds = recordKeys(sessions, "session_public_id");
  const studentIds = recordKeys(students, "user_id");
  const activityAttempts = parseJsonlRows(input.files, "activity_runtime_attempts.jsonl");
  const activityAttemptIds = recordKeys(activityAttempts, "activity_attempt_public_id");
  const evidenceRecords = parseJsonlRows(input.files, "activity_misconception_evidence_records.jsonl");
  const evidenceIds = recordKeys(evidenceRecords, "evidence_public_id");
  const snapshots = parseJsonlRows(input.files, "post_activity_diagnostic_snapshots.jsonl");

  const sessionLevelFiles: Array<[string, () => JsonRecord[]]> = [
    ["item_responses.csv", () => parseCsvRows(input.files, "item_responses.csv")],
    ["conversation_turns_readable.jsonl", () => parseJsonlRows(input.files, "conversation_turns_readable.jsonl")],
    ["conversation_turns_structured_redacted.jsonl", () => parseJsonlRows(input.files, "conversation_turns_structured_redacted.jsonl")],
    ["response_packages.jsonl", () => parseJsonlRows(input.files, "response_packages.jsonl")],
    ["process_event_counts.csv", () => parseCsvRows(input.files, "process_event_counts.csv")],
    ["process_events_summary.jsonl", () => parseJsonlRows(input.files, "process_events_summary.jsonl")],
    ["process_events_redacted.jsonl", () => parseJsonlRows(input.files, "process_events_redacted.jsonl")],
    ["turn_response_latencies.csv", () => parseCsvRows(input.files, "turn_response_latencies.csv")],
    ["turn_response_latencies.jsonl", () => parseJsonlRows(input.files, "turn_response_latencies.jsonl")],
    ["engagement_process_features.csv", () => parseCsvRows(input.files, "engagement_process_features.csv")],
    ["engagement_process_features.jsonl", () => parseJsonlRows(input.files, "engagement_process_features.jsonl")],
    ["activity_runtime_attempts.jsonl", () => activityAttempts],
    ["activity_misconception_evidence_records.jsonl", () => evidenceRecords],
    ["post_activity_diagnostic_snapshots.jsonl", () => snapshots],
    ["agent_calls_summary.jsonl", () => parseJsonlRows(input.files, "agent_calls_summary.jsonl")],
    ["session_data_completeness.jsonl", () => parseJsonlRows(input.files, "session_data_completeness.jsonl")],
    ["limitations.jsonl", () => parseJsonlRows(input.files, "limitations.jsonl")]
  ];

  const studentOrphans = sessions
    .map((row) => row.student_user_id)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .filter((value) => !studentIds.has(value));
  if (studentOrphans.length > 0) {
    pushFinding(input.findings, {
      code: "student_session_join_orphan",
      message: `sessions.csv has student_user_id values not present in students.csv: ${safeRecordSample(studentOrphans).join(", ")}`,
      file: "sessions.csv",
      severity: "failure"
    });
  }

  for (const [fileName, rows] of sessionLevelFiles) {
    const orphans = findOrphans(rows(), "session_public_id", sessionIds);
    if (orphans.length > 0) {
      pushFinding(input.findings, {
        code: "session_join_orphan",
        message: `${fileName} has session_public_id values not present in sessions.csv: ${safeRecordSample(orphans).join(", ")}`,
        file: fileName,
        severity: "failure"
      });
    }
  }

  const evidenceAttemptOrphans = findOrphans(evidenceRecords, "activity_attempt_public_id", activityAttemptIds);
  if (evidenceAttemptOrphans.length > 0) {
    pushFinding(input.findings, {
      code: "activity_evidence_attempt_join_orphan",
      message: `activity_misconception_evidence_records.jsonl has activity attempts not present in activity_runtime_attempts.jsonl: ${safeRecordSample(evidenceAttemptOrphans).join(", ")}`,
      file: "activity_misconception_evidence_records.jsonl",
      severity: "failure"
    });
  }

  const snapshotEvidenceOrphans = findOrphans(snapshots, "evidence_public_id", evidenceIds);
  if (snapshotEvidenceOrphans.length > 0) {
    pushFinding(input.findings, {
      code: "post_activity_snapshot_evidence_join_orphan",
      message: `post_activity_diagnostic_snapshots.jsonl has evidence_public_id values not present in activity_misconception_evidence_records.jsonl: ${safeRecordSample(snapshotEvidenceOrphans).join(", ")}`,
      file: "post_activity_diagnostic_snapshots.jsonl",
      severity: "failure"
    });
  }

  for (const sessionId of sessionIds) {
    if (!activityAttempts.some((row) => row.session_public_id === sessionId)) {
      pushFinding(input.findings, {
        code: "session_activity_runtime_missing",
        message: `Session ${sessionId} has no activity runtime rows; old or pre-activity sessions may legitimately have this gap.`,
        file: "activity_runtime_attempts.jsonl",
        key: sessionId,
        severity: "limitation"
      });
    }
    if (!evidenceRecords.some((row) => row.session_public_id === sessionId)) {
      pushFinding(input.findings, {
        code: "session_post_activity_evidence_missing",
        message: `Session ${sessionId} has no post-activity evidence rows; old or pre-activity sessions may legitimately have this gap.`,
        file: "activity_misconception_evidence_records.jsonl",
        key: sessionId,
        severity: "limitation"
      });
    }
  }

  return !input.findings.some((finding) => finding.code.includes("_join_orphan"));
}

function validateLatencyAndProcessFeatures(input: { files: Map<string, ExportEntry>; findings: Finding[] }) {
  const latencyRows = parseJsonlRows(input.files, "turn_response_latencies.jsonl");
  const processFeatureRows = parseJsonlRows(input.files, "engagement_process_features.jsonl");
  const structuredTurns = parseJsonlRows(input.files, "conversation_turns_structured_redacted.jsonl");

  for (const row of latencyRows) {
    const promptShownAt = row.prompt_shown_at;
    if (typeof promptShownAt !== "string" || promptShownAt.length === 0) {
      pushFinding(input.findings, {
        code: "latency_prompt_shown_at_missing",
        message: "A latency row is missing prompt_shown_at.",
        file: "turn_response_latencies.jsonl",
        severity: "failure"
      });
    }

    const latencyMs = numberValue(row.response_latency_ms);
    const latencySeconds = numberValue(row.response_latency_seconds);
    if (latencyMs !== null && latencyMs < 0) {
      pushFinding(input.findings, {
        code: "latency_negative",
        message: "A latency row has negative response_latency_ms.",
        file: "turn_response_latencies.jsonl",
        severity: "failure"
      });
    }
    if (latencyMs !== null && latencySeconds !== null && Math.abs(latencyMs / 1000 - latencySeconds) > 0.01) {
      pushFinding(input.findings, {
        code: "latency_seconds_mismatch",
        message: "A latency row has response_latency_seconds inconsistent with response_latency_ms.",
        file: "turn_response_latencies.jsonl",
        severity: "failure"
      });
    }
    if (row.response_latency_ms === null && !arrayValue(row.limitations).includes("next_student_response_or_action_missing")) {
      pushFinding(input.findings, {
        code: "null_latency_limitation_missing",
        message: "A null latency row is missing next_student_response_or_action_missing limitation.",
        file: "turn_response_latencies.jsonl",
        severity: "failure"
      });
    }
    if (typeof row.latency_scope !== "string" || !ALLOWED_LATENCY_SCOPES.has(row.latency_scope)) {
      pushFinding(input.findings, {
        code: "latency_scope_invalid",
        message: `Invalid latency_scope ${String(row.latency_scope)}.`,
        file: "turn_response_latencies.jsonl",
        severity: "failure"
      });
    }
    if (typeof row.latency_source !== "string" || !ALLOWED_LATENCY_SOURCES.has(row.latency_source)) {
      pushFinding(input.findings, {
        code: "latency_source_invalid",
        message: `Invalid latency_source ${String(row.latency_source)}.`,
        file: "turn_response_latencies.jsonl",
        severity: "failure"
      });
    }
  }

  const promptScopes = new Set(latencyRows.map((row) => row.latency_scope).filter((value): value is string => typeof value === "string"));
  const turnText = JSON.stringify(structuredTurns).toLowerCase();
  for (const scope of ["item", "reasoning", "confidence", "tempting_option", "activity"]) {
    const hasScopeCue = scope === "item"
      ? structuredTurns.some((turn) => typeof turn.item_public_id === "string")
      : turnText.includes(scope.replace("_", " "));
    if (hasScopeCue && !promptScopes.has(scope)) {
      pushFinding(input.findings, {
        code: "latency_scope_expected_missing",
        message: `No latency row was found for expected scope ${scope}.`,
        file: "turn_response_latencies.jsonl",
        severity: "limitation"
      });
    }
  }

  const timingFields = [
    "time_to_first_action_ms",
    "first_action_to_submission_ms",
    "last_action_to_submission_ms",
    "prompt_to_final_submission_ms",
    "active_interaction_time_ms",
    "idle_time_ms",
    "focus_adjusted_time_ms",
    "confidence_selection_latency_ms",
    "reasoning_input_elapsed_time_ms",
    "active_typing_time_ms",
    "pre_submit_pause_ms",
    "activity_prompt_to_first_action_ms",
    "activity_response_elapsed_ms",
    "activity_move_on_latency_ms",
    "choose_another_activity_latency_ms"
  ];

  for (const row of processFeatureRows) {
    for (const field of timingFields) {
      const value = numberValue(row[field]);
      if (value !== null && value < 0) {
        pushFinding(input.findings, {
          code: "process_feature_negative_timing",
          message: `${field} must be non-negative when present.`,
          file: "engagement_process_features.jsonl",
          key: field,
          severity: "failure"
        });
      }
    }

    const idleRatio = numberValue(row.idle_ratio);
    if (idleRatio !== null && (idleRatio < 0 || idleRatio > 1)) {
      pushFinding(input.findings, {
        code: "process_feature_idle_ratio_invalid",
        message: "idle_ratio must be between 0 and 1 when present.",
        file: "engagement_process_features.jsonl",
        severity: "failure"
      });
    }

    if (row.active_interaction_time_ms !== null && !arrayValue(row.limitations).some((value) =>
      typeof value === "string" && value.includes("active")
    )) {
      pushFinding(input.findings, {
        code: "active_interaction_without_instrumentation_note",
        message: "active_interaction_time_ms is present without an explicit active instrumentation limitation/source note.",
        file: "engagement_process_features.jsonl",
        severity: "failure"
      });
    }

    if (row.active_typing_time_ms !== null) {
      pushFinding(input.findings, {
        code: "active_typing_time_unexpected",
        message: "active_typing_time_ms should remain null unless explicit active typing instrumentation exists.",
        file: "engagement_process_features.jsonl",
        severity: "failure"
      });
    }
  }

  return {
    latencyPassed: !input.findings.some((finding) => finding.code.startsWith("latency") || finding.code.startsWith("null_latency")),
    processFeaturePassed: !input.findings.some((finding) => finding.code.startsWith("process_feature") || finding.code.startsWith("active_"))
  };
}

function validateCorrectnessInflation(input: { files: Map<string, ExportEntry>; findings: Finding[] }) {
  const rows = parseJsonlRows(input.files, "engagement_evidence_packets.jsonl");
  for (const row of rows) {
    const summary = asRecord(row.correctness_inflation_summary);
    const required = [
      "unsupported_correct_response_count",
      "estimated_guessing_risk_counts",
      "correctness_support_level_counts",
      "answer_selection_evidence_weight_distribution",
      "uncertainty_marker_count",
      "uncertainty_marker_type_counts"
    ];
    for (const key of required) {
      if (!(key in summary)) {
        pushFinding(input.findings, {
          code: "correctness_inflation_field_missing",
          message: `correctness_inflation_summary is missing ${key}.`,
          file: "engagement_evidence_packets.jsonl",
          key,
          severity: "failure"
        });
      }
    }

    for (const key of Object.keys(asRecord(summary.correctness_support_level_counts))) {
      if (!ALLOWED_CORRECTNESS_SUPPORT_LEVELS.has(key)) {
        pushFinding(input.findings, {
          code: "correctness_support_level_invalid",
          message: `Invalid correctness support level ${key}.`,
          file: "engagement_evidence_packets.jsonl",
          key,
          severity: "failure"
        });
      }
    }
    for (const key of Object.keys(asRecord(summary.estimated_guessing_risk_counts))) {
      if (!ALLOWED_GUESSING_RISK.has(key)) {
        pushFinding(input.findings, {
          code: "estimated_guessing_risk_invalid",
          message: `Invalid estimated guessing risk ${key}.`,
          file: "engagement_evidence_packets.jsonl",
          key,
          severity: "failure"
        });
      }
    }
    for (const key of Object.keys(asRecord(summary.answer_selection_evidence_weight_distribution))) {
      if (!ALLOWED_ANSWER_SELECTION_WEIGHTS.has(key)) {
        pushFinding(input.findings, {
          code: "answer_selection_evidence_weight_invalid",
          message: `Invalid answer selection evidence weight ${key}.`,
          file: "engagement_evidence_packets.jsonl",
          key,
          severity: "failure"
        });
      }
    }
    for (const key of Object.keys(asRecord(summary.uncertainty_marker_type_counts))) {
      if (!ALLOWED_UNCERTAINTY_MARKERS.has(key)) {
        pushFinding(input.findings, {
          code: "uncertainty_marker_type_invalid",
          message: `Invalid uncertainty marker type ${key}.`,
          file: "engagement_evidence_packets.jsonl",
          key,
          severity: "failure"
        });
      }
    }
  }

  const readableTranscript = entryText(input.files.get("conversation_turns_readable.jsonl") as ExportEntry).toLowerCase();
  const forbiddenReadableTerms = [
    "estimated_guessing_risk",
    "unsupported_correct_response",
    "correctness_support_level",
    "answer key",
    "correct option",
    "correctness"
  ];
  for (const term of forbiddenReadableTerms) {
    if (readableTranscript.includes(term)) {
      pushFinding(input.findings, {
        code: "readable_transcript_correctness_inflation_leak",
        message: `Readable transcript contains prohibited student-facing/research-readable term ${term}.`,
        file: "conversation_turns_readable.jsonl",
        key: term,
        severity: "failure"
      });
    }
  }

  return !input.findings.some((finding) =>
    finding.code.startsWith("correctness_") ||
    finding.code.startsWith("estimated_guessing") ||
    finding.code.startsWith("answer_selection") ||
    finding.code.startsWith("uncertainty_marker") ||
    finding.code.startsWith("readable_transcript_correctness")
  );
}

export function runCorrectnessInflationFixtureAssertions() {
  const metadata = {
    concept_id: "research_export_integrity_fixture",
    cognitive_level: "conceptual",
    subskills: ["distinguish-person-ability-from-item-parameters"],
    expected_solution_actions: ["separate person ability from item difficulty"],
    correct_option: "C" as const,
    option_misconception_map: {
      A: ["item_difficulty_as_person_ability"],
      B: ["sample_size_as_person_ability"],
      C: [],
      D: ["guessing_parameter_as_person_ability"]
    },
    option_diagnostic_notes: {
      A: "Treats item difficulty as if it were the student's ability.",
      B: "Confuses sample-level information with person-level ability.",
      C: "Separates person ability from item parameters.",
      D: "Confuses response-process uncertainty with ability."
    },
    optional_future_calibration: {
      difficulty_label: "moderate",
      discrimination_label: "unknown",
      empirical_ctt_item_difficulty: null,
      empirical_ctt_discrimination: null,
      calibration_sample_notes: null
    }
  };

  const weakCorrect = buildItemAbilityEvidence({
    item_public_id: "research_export_integrity_weak_correct",
    metadata,
    selected_option: "C",
    correctness: "correct",
    confidence: "Low",
    reasoning_text: "I don't know, maybe C.",
    no_tempting_option: true,
    total_item_time_ms: 10_000
  });
  const supportedCorrect = buildItemAbilityEvidence({
    item_public_id: "research_export_integrity_supported_correct",
    metadata,
    selected_option: "C",
    correctness: "correct",
    confidence: "High",
    reasoning_text:
      "Theta is the person location on the latent trait scale, while item difficulty and discrimination describe item behavior rather than person ability.",
    tempting_option: "A",
    tempting_option_reason: "A was tempting because difficulty sounds similar to ability, but it describes the item rather than the person.",
    total_item_time_ms: 45_000
  });
  const uncertainty = buildItemAbilityEvidence({
    item_public_id: "research_export_integrity_uncertainty",
    metadata,
    selected_option: "B",
    correctness: "incorrect",
    confidence: "Low",
    reasoning_text: "I am not sure and I don't know the reason yet.",
    no_tempting_option: true,
    total_item_time_ms: 30_000
  });
  const summary = summarizeConceptAbilityEvidence([weakCorrect, supportedCorrect, uncertainty]);

  if (!weakCorrect.unsupported_correct_response) {
    throw new Error("Correct weak low-confidence fixture should be marked unsupported or weakly supported.");
  }
  if (weakCorrect.correctness_support_level !== "unsupported" && weakCorrect.correctness_support_level !== "weakly_supported") {
    throw new Error("Correct weak low-confidence fixture should have unsupported or weakly supported correctness support.");
  }
  if (supportedCorrect.correctness_support_level !== "supported_by_reasoning") {
    throw new Error("Correct strong distractor-boundary fixture should be supported by reasoning.");
  }
  if (!uncertainty.uncertainty_marker_present || uncertainty.uncertainty_marker_types.length === 0) {
    throw new Error("Uncertainty language should become an uncertainty marker.");
  }
  if (summary.unsupported_correct_response_count < 1) {
    throw new Error("Concept summary should count unsupported correct responses.");
  }

  return {
    weak_correct_support_level: weakCorrect.correctness_support_level,
    weak_correct_guessing_risk: weakCorrect.estimated_guessing_risk,
    supported_correct_support_level: supportedCorrect.correctness_support_level,
    uncertainty_marker_types: uncertainty.uncertainty_marker_types,
    unsupported_correct_response_count: summary.unsupported_correct_response_count
  };
}

function validateSafety(input: { exportResult: ExportResult; files: Map<string, ExportEntry>; findings: Finding[] }) {
  const secretPatterns = [
    { code: "api_key_like_value", pattern: /sk-[A-Za-z0-9_-]{20,}/ },
    { code: "authorization_header", pattern: /authorization\s*:/i },
    { code: "bearer_token", pattern: /bearer\s+[A-Za-z0-9._-]{10,}/i },
    { code: "database_url", pattern: /database_url/i },
    { code: "session_secret", pattern: /session_secret/i }
  ];
  const protectedDataPatterns = [
    { code: "answer_key_field", pattern: /\banswer_key\b/i },
    { code: "correct_option_field", pattern: /\bcorrect_option\b/i },
    { code: "raw_distractor_metadata", pattern: /\bdistractor_rationales\b/i },
    { code: "raw_misconception_metadata", pattern: /\bpossible_misconception_indicators\b/i },
    { code: "raw_reasoning_metadata", pattern: /\bexpected_reasoning_patterns\b/i },
    { code: "raw_provider_output", pattern: /\braw_output\b/i },
    { code: "raw_provider_input_payload", pattern: /\binput_payload\b/i },
    { code: "raw_provider_output_payload", pattern: /\boutput_payload\b/i },
    { code: "raw_misconception_id", pattern: /\bmisconception_ids?\b/i },
    { code: "raw_process_payload", pattern: /"payload"\s*:/i },
    { code: "internal_db_id_field", pattern: /"(?:id|[A-Za-z0-9_]+_db_id|[A-Za-z0-9_]+_db_ids)"\s*:/i }
  ];
  const documentationFiles = new Set(["manifest.json", "README_EXPORT.md", "data_dictionary.json"]);
  const structuredPayloadAllowed = new Set(["conversation_turns_structured_redacted.jsonl"]);

  for (const entry of input.exportResult.files) {
    const text = entryText(entry);
    for (const { code, pattern } of secretPatterns) {
      if (pattern.test(text)) {
        pushFinding(input.findings, {
          code: `safety_${code}`,
          message: `${entry.path} contains secret-like content.`,
          file: entry.path,
          severity: "failure"
        });
      }
    }

    if (documentationFiles.has(entry.path)) continue;

    for (const { code, pattern } of protectedDataPatterns) {
      if (code === "raw_process_payload" && structuredPayloadAllowed.has(entry.path)) continue;
      if (pattern.test(text)) {
        pushFinding(input.findings, {
          code: `safety_${code}`,
          message: `${entry.path} contains protected raw/internal content category ${code}.`,
          file: entry.path,
          severity: "failure"
        });
      }
    }
  }

  const processEventsRedacted = entryText(input.files.get("process_events_redacted.jsonl") as ExportEntry);
  if (/"payload"\s*:/.test(processEventsRedacted)) {
    pushFinding(input.findings, {
      code: "process_events_redacted_payload_leak",
      message: "process_events_redacted.jsonl includes raw payload.",
      file: "process_events_redacted.jsonl",
      severity: "failure"
    });
  }

  return !input.findings.some((finding) => finding.code.startsWith("safety_") || finding.code === "process_events_redacted_payload_leak");
}

function missingnessSummary(input: { files: Map<string, ExportEntry> }) {
  const sessions = parseCsvRows(input.files, "sessions.csv");
  const sessionIds = sessions
    .map((row) => row.session_public_id)
    .filter((value): value is string => typeof value === "string");
  const activityAttempts = parseJsonlRows(input.files, "activity_runtime_attempts.jsonl");
  const evidenceRecords = parseJsonlRows(input.files, "activity_misconception_evidence_records.jsonl");
  const latencyRows = parseJsonlRows(input.files, "turn_response_latencies.jsonl");

  return {
    session_count: sessionIds.length,
    sessions_with_no_activity_runtime_data: sessionIds.filter((sessionId) =>
      !activityAttempts.some((row) => row.session_public_id === sessionId)
    ),
    sessions_with_no_post_activity_evidence: sessionIds.filter((sessionId) =>
      !evidenceRecords.some((row) => row.session_public_id === sessionId)
    ),
    sessions_with_null_turn_latency_rows: sessionIds.filter((sessionId) =>
      latencyRows.some((row) => row.session_public_id === sessionId && row.response_latency_ms === null)
    )
  };
}

function buildAnalysisReadinessMarkdown(input: {
  exportResult: ExportResult;
  summary: ResearchExportIntegritySummary;
  findings: Finding[];
  missingness: ReturnType<typeof missingnessSummary>;
}) {
  const rowCounts = input.exportResult.manifest.row_counts;
  const lines = [
    "# Research Analysis Readiness Summary",
    "",
    `Generated by ${RESEARCH_EXPORT_INTEGRITY_REVIEW_VERSION}.`,
    "",
    "## Available Datasets",
    "",
    ...REQUIRED_RESEARCH_EXPORT_FILES.map((file) => `- ${file}: ${Number(rowCounts[file] ?? 0)} rows`),
    "",
    "## Recommended Primary Analysis Tables",
    "",
    "- `sessions.csv` as the session index.",
    "- `item_responses.csv` for item-level answer, reasoning, confidence, revision, and timing analysis.",
    "- `conversation_turns_readable.jsonl` for safe transcript review.",
    "- `turn_response_latencies.csv` and `engagement_process_features.csv` for timing/process features.",
    "- `engagement_evidence_packets.jsonl` for evidence-quality and correctness-inflation aggregates.",
    "- `activity_runtime_attempts.jsonl`, `activity_misconception_evidence_records.jsonl`, and `post_activity_diagnostic_snapshots.jsonl` for post-activity misconception-evidence analysis when available.",
    "",
    "## Join Keys",
    "",
    "- `sessions.session_public_id` joins all session-level files.",
    "- `students.user_id` joins `sessions.student_user_id`.",
    "- `activity_runtime_attempts.activity_attempt_public_id` joins post-activity evidence `activity_attempt_public_id`.",
    "- `activity_misconception_evidence_records.evidence_public_id` joins diagnostic snapshots `evidence_public_id` when snapshots exist.",
    "",
    "## Timing Variables And Caveats",
    "",
    "- `item_response_time_ms` is a full item response interval, not prompt-to-response/action latency.",
    "- Turn-level latency can include reading, thinking, idle time, or off-task time.",
    "- `active_typing_time_ms` is null unless explicitly instrumented; elapsed input timing is not used as active typing.",
    "",
    "## Process Feature Caveats",
    "",
    "- Process features are evidence-quality context only.",
    "- Process features must not be used as misconduct, cheating, GenAI-use, or ability labels.",
    "",
    "## Correctness-Inflation Safeguards",
    "",
    "- Correctness alone is not evidence of understanding.",
    "- `estimated_guessing_risk`, `unsupported_correct_response`, `correctness_support_level`, `answer_selection_evidence_weight`, and uncertainty markers are internal/research evidence-quality safeguards.",
    "- These fields are not student-facing labels and are not misconduct labels.",
    "",
    "## Missingness Summary",
    "",
    `- Sessions exported: ${input.missingness.session_count}`,
    `- Sessions with no activity runtime data: ${input.missingness.sessions_with_no_activity_runtime_data.length}`,
    `- Sessions with no post-activity evidence: ${input.missingness.sessions_with_no_post_activity_evidence.length}`,
    `- Sessions with null turn latency rows: ${input.missingness.sessions_with_null_turn_latency_rows.length}`,
    "",
    "## Dissertation Limitations",
    "",
    "- Local MVP export is analysis-ready for pilot/dissertation workflow checks, not classroom-validity proof.",
    "- Missing activity or post-activity evidence can reflect old or pre-activity sessions and should be modeled as missingness, not failure.",
    "- Timing and process features are contextual and may include idle or off-task time unless explicitly marked otherwise.",
    "- Distractor-informed misconception evidence remains bounded to available response and activity evidence; no export field proves all misconceptions are absent.",
    "",
    "## Integrity Review Result",
    "",
    `- Status: ${input.summary.status}`,
    `- Analysis readiness: ${input.summary.analysis_readiness}`,
    `- Safety check passed: ${input.summary.safety_check_passed}`,
    `- Findings: ${input.findings.length}`,
    "",
    "## Findings",
    "",
    ...(input.findings.length === 0
      ? ["- No findings."]
      : input.findings.map((finding) => `- ${finding.severity}: ${finding.code}${finding.file ? ` (${finding.file})` : ""} - ${finding.message}`)),
    ""
  ];

  return `${lines.join("\n")}\n`;
}

export type ResearchExportIntegritySummary = {
  status: "passed" | "review_has_findings" | "failed";
  export_artifact_path: string | null;
  analysis_readiness_summary_path: string | null;
  files_checked: number;
  required_files_present: boolean;
  manifest_present: boolean;
  data_dictionary_present: boolean;
  row_count_consistency_passed: boolean;
  joinability_passed: boolean;
  latency_checks_passed: boolean;
  process_feature_checks_passed: boolean;
  correctness_inflation_feature_checks_passed: boolean;
  safety_check_passed: boolean;
  analysis_readiness: "ready" | "ready_with_limitations" | "not_ready";
  limitations: string[];
};

export type ResearchExportIntegrityReview = {
  review_version: typeof RESEARCH_EXPORT_INTEGRITY_REVIEW_VERSION;
  export_version: typeof TEACHER_RESEARCH_EXPORT_VERSION;
  generated_at: string;
  export_filename: string;
  no_live_provider_call_made: true;
  summary: ResearchExportIntegritySummary;
  findings: Finding[];
  row_counts_actual: Record<string, number>;
  row_counts_manifest: Record<string, unknown>;
  missingness_summary: ReturnType<typeof missingnessSummary>;
  correctness_inflation_fixture_summary: ReturnType<typeof runCorrectnessInflationFixtureAssertions>;
};

export async function buildResearchExportIntegrityReview(input: IntegrityReviewInput = {}) {
  const exportResult = await buildTeacherResearchBulkExport({
    session_public_id: input.session_public_id,
    generated_by_role: "teacher_researcher"
  });
  const files = fileMap(exportResult);
  const findings: Finding[] = [];

  const requiredFilesPresent = REQUIRED_RESEARCH_EXPORT_FILES.every((file) => files.has(file));
  for (const file of REQUIRED_RESEARCH_EXPORT_FILES) {
    if (!files.has(file)) {
      pushFinding(findings, {
        code: "required_file_missing",
        message: `${file} is required in the default research export.`,
        file,
        severity: "failure"
      });
    }
  }

  const manifestResult = validateManifest({ exportResult, files, findings });
  validateDataDictionary({ exportResult, files, findings });
  const joinabilityPassed = validateJoinability({ files, findings });
  const latencyProcessResult = validateLatencyAndProcessFeatures({ files, findings });
  const correctnessInflationPassed = validateCorrectnessInflation({ files, findings });
  const safetyPassed = validateSafety({ exportResult, files, findings });
  const correctnessFixtureSummary = runCorrectnessInflationFixtureAssertions();
  const missingness = missingnessSummary({ files });
  const rowCountsActual = Object.fromEntries(exportResult.files.map((entry) => [entry.path, actualRowCount(entry)]));
  const rowCountsManifest = asRecord(manifestResult.manifest?.row_counts);
  const rowCountConsistencyPassed = exportResult.files.every((entry) =>
    Number(rowCountsManifest[entry.path]) === rowCountsActual[entry.path]
  );
  const failurePresent = findings.some((finding) => finding.severity === "failure");
  const limitationMessages = findings
    .filter((finding) => finding.severity === "limitation")
    .map((finding) => `${finding.code}: ${finding.message}`);
  const analysisReadiness = failurePresent
    ? "not_ready"
    : limitationMessages.length > 0
      ? "ready_with_limitations"
      : "ready";
  const summary: ResearchExportIntegritySummary = {
    status: failurePresent ? "failed" : findings.length > 0 ? "review_has_findings" : "passed",
    export_artifact_path: null,
    analysis_readiness_summary_path: null,
    files_checked: exportResult.files.length,
    required_files_present: requiredFilesPresent,
    manifest_present: files.has("manifest.json"),
    data_dictionary_present: files.has("data_dictionary.json"),
    row_count_consistency_passed: rowCountConsistencyPassed,
    joinability_passed: joinabilityPassed,
    latency_checks_passed: latencyProcessResult.latencyPassed,
    process_feature_checks_passed: latencyProcessResult.processFeaturePassed,
    correctness_inflation_feature_checks_passed: correctnessInflationPassed,
    safety_check_passed: safetyPassed,
    analysis_readiness: analysisReadiness,
    limitations: limitationMessages
  };

  const review: ResearchExportIntegrityReview = {
    review_version: RESEARCH_EXPORT_INTEGRITY_REVIEW_VERSION,
    export_version: TEACHER_RESEARCH_EXPORT_VERSION,
    generated_at: new Date().toISOString(),
    export_filename: exportResult.filename,
    no_live_provider_call_made: true,
    summary,
    findings,
    row_counts_actual: rowCountsActual,
    row_counts_manifest: rowCountsManifest,
    missingness_summary: missingness,
    correctness_inflation_fixture_summary: correctnessFixtureSummary
  };

  if (input.write_artifact) {
    const outputDir = input.output_dir ?? path.join(process.cwd(), ".data", "research-export-integrity-review");
    await mkdir(outputDir, { recursive: true });
    const artifactPath = path.join(outputDir, `research-export-integrity-${artifactTimestamp()}.json`);
    const summaryPath = path.join(outputDir, "research-analysis-readiness-summary.md");
    const reviewWithPaths = {
      ...review,
      summary: {
        ...summary,
        export_artifact_path: artifactPath,
        analysis_readiness_summary_path: summaryPath
      }
    };
    await writeFile(artifactPath, `${JSON.stringify(reviewWithPaths, null, 2)}\n`, "utf8");
    await writeFile(
      summaryPath,
      buildAnalysisReadinessMarkdown({
        exportResult,
        summary: reviewWithPaths.summary,
        findings,
        missingness
      }),
      "utf8"
    );

    return reviewWithPaths;
  }

  return review;
}
