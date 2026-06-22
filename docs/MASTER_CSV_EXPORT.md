# Master CSV Export

Phase 7B completes the one-file analysis export for all platform data implemented through Phase 7A. Phase 7C increments the schema for Response Collection Agent mode and free-text process aggregates:

```text
master_assessment_export.csv
```

The internal database remains normalized. The CSV is a derived research file, not the database source of truth.

## Scope Boundaries

Phase 7B is export-only. Phase 7C adds columns for response collection mode snapshots, initial free-text message counts, Response Collection Agent call counts, deterministic fallback counts, and reasoning-extraction counts. The export still does not call OpenAI, run agents, create profiles, create formative decisions, create follow-up rounds, create update cycles, create progression records, modify student answers, or change classroom workflow state.

The export reads persisted records only. Active/latest profile and formative scalar columns are populated only from saved activated `student_profiles` and `formative_decisions` rows. Failed or staged update-cycle payloads remain audit/history data and must not populate latest scalar profile or planning columns.

Correctness remains evidence, not a profile. Process data remain context for engagement and evidence sufficiency, not misconduct evidence.

## Row Grain

Primary grain:

```text
one row per student
per assessment session
per concept unit
per item response
```

`row_type` is one of:

- `item_response`
- `concept_unit_without_item_response`
- `session_without_item_response`

Placeholder rows keep item fields blank so incomplete and interrupted sessions remain visible.

## Concept-Specific Histories

For an item-response row, profile, formative, follow-up, update-cycle, and progression fields describe the row's own `concept_unit_session`.

The export does not repeat a final concept's latest profile across earlier concept rows. A session-only placeholder leaves concept-specific scalar fields blank and concept-specific histories as `[]`.

Session-level fields, including account status, assessment availability, session completion, workflow aggregates, and summative outcomes, may repeat across rows for the same session/student.

## Column Groups

Every row includes:

- export metadata and formula-sanitization flag
- classroom identity and account status using canonical `users.user_id`
- assessment availability and workflow-mode snapshots
- response collection mode and session snapshot
- session state, automation state, needs-review state, and completion state
- concept-unit metadata and version
- item response evidence and administered item snapshots
- neutral process aggregate counts
- transcript text and optional raw JSON columns
- saved active profile and profile-history columns
- saved active formative decision and decision-history columns
- follow-up round, update-cycle, progression, and workflow histories
- agent audit metadata for actual recorded calls only
- active summative outcome linkage

See `docs/MASTER_EXPORT_DATA_DICTIONARY.md` for the complete column list.

## Ordering

Rows are ordered deterministically by:

```text
user_id
assessment_public_id
session_public_id
concept_unit order_index
item item_order
```

`record_key` is a deterministic public composite identifier and does not use internal UUIDs.

## Summative Outcomes

Multiple outcomes per student are supported without row multiplication.

The export request may select `primary_outcome_name`. Primary outcome columns repeat across that student's rows when an active matching outcome exists. `summative_outcomes_json` contains all active outcomes for the student. Percent is calculated as `outcome_score / max_score * 100` and exported with four decimal places.

## Raw JSON Option

When `include_raw_json_columns = false`, raw evidence/audit JSON columns such as `conversation_turns_json`, `process_events_json`, `response_packages_json`, `agent_calls_json`, `workflow_jobs_json`, and `workflow_overrides_json` are blank.

Analysis history columns such as `profile_history_json`, `formative_decision_history_json`, `followup_rounds_json`, `followup_update_cycles_json`, and `concept_progression_history_json` remain available because they are part of the flattened master analysis schema.

## Formula-Injection Protection

When `spreadsheet_safe_text = true`, user-controlled or teacher-provided text beginning with `=`, `+`, `-`, or `@` is prefixed with an apostrophe in the exported CSV only.

This strategy is reversible: researchers who need exact text can remove one leading apostrophe from sanitized text cells during analysis. Database values are not modified.

The export includes:

```text
spreadsheet_formula_sanitization_applied
```

When `spreadsheet_safe_text = false`, text is exported exactly and the UI warns the teacher before download. CSV quotation alone is not treated as sufficient formula protection.

## Local Storage

Generated files are stored under:

```text
.data/exports
```

Files are outside public static folders. Download routes require `teacher_researcher` authorization and use server-generated storage keys. Clients cannot supply file paths.

Production deployment should replace local filesystem storage with persistent object storage.

Expired local exports can be cleaned up with:

```bash
npm run export:cleanup
```

## APIs

- `POST /api/teacher/export/master-csv`
- `GET /api/teacher/export/jobs`
- `GET /api/teacher/export/[exportPublicId]`
- `GET /api/teacher/export/[exportPublicId]/download`

Create-export options:

```ts
{
  assessment_public_id?: string;
  session_status?: string[];
  include_incomplete_sessions?: boolean;
  primary_outcome_name?: string;
  include_raw_json_columns?: boolean;
  spreadsheet_safe_text?: boolean;
}
```

Defaults:

- `include_incomplete_sessions = true`
- `include_raw_json_columns = true`
- `spreadsheet_safe_text = true`

Arbitrary SQL fields and raw query fragments are not accepted.

## UI

Use:

```text
/teacher/data/export
```

The page supports assessment filter, session status filter, primary outcome selection, include-incomplete checkbox, raw JSON checkbox, spreadsheet-safe checkbox, export generation, job list, row count, schema version, generated/completed time, failure message, and download link.

## Schema Version

Current version:

```text
MASTER_EXPORT_SCHEMA_VERSION=1.2.0
```

Future breaking column changes require a schema-version increment.

## Phase 7C Response Collection Columns

Phase 7C adds these stable columns without changing row grain or multiplying rows:

- `assessment_response_collection_mode`
- `session_response_collection_mode_snapshot`
- `initial_free_text_student_message_count`
- `response_collection_agent_call_count`
- `response_collection_fallback_count`
- `response_collection_reasoning_extraction_count`
- `response_collection_reasoning_extraction_failure_count`

The agent-call count summarizes actual audited `response_collection_agent` calls only. Deterministic fallback turns are counted separately and must not be treated as successful model calls.

## Fixture And Smoke Tests

Create the fixture:

```bash
npm run demo:data-export
```

Cleanup fixture-owned records:

```bash
npm run demo:data-export:cleanup
```

Run export checks:

```bash
npm run export:master-smoke
npm run export:master-complete-smoke
```

The complete smoke verifies stable headers, placeholder rows, skipped evidence distinction, profile/decision/follow-up/update/progression/workflow columns, concept-specific history behavior, active versus staged profile behavior, multiple summative outcomes without row multiplication, raw JSON suppression, formula protection, public identifiers, secret exclusion, parseable JSON columns, cleanup behavior, and no OpenAI calls.
