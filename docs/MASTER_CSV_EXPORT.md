# Master CSV Export

Phase 5B generates one merged analysis file:

```text
master_assessment_export.csv
```

The internal database remains normalized. The CSV is a derived research file, not the database source of truth.

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

## Column Groups

Every row includes:

- export metadata: `export_generated_at`, `export_schema_version`, `row_type`, `record_key`
- identity and session fields using `users.user_id`, `session_public_id`, and `assessment_public_id`
- concept-unit fields using `concept_unit_public_id`
- item-response fields using `item_public_id`
- neutral process aggregate counts
- transcript text and optional raw JSON columns
- current/future profile fields
- current/future formative fields
- agent audit fields
- summative outcome fields

Internal UUIDs are not normal export identifiers. Phase 7A normalized login matching does not change export identity: the master CSV continues to export canonical `users.user_id`.

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

The export request may select `primary_outcome_name`. Primary outcome columns repeat across that student's rows when an active matching outcome exists:

- `primary_summative_outcome_name`
- `primary_summative_outcome_score`
- `primary_summative_outcome_max_score`
- `primary_summative_outcome_percent`
- `primary_summative_assessment_date`

`summative_outcomes_json` contains all active outcomes for the student. Percent is calculated as `outcome_score / max_score * 100` and exported with four decimal places.

## Profile, Formative, And Agent Columns

Profile-related columns are present for schema stability, including:

- ability profile fields
- engagement profile fields
- integrated diagnostic profile fields
- profile history JSON fields

Formative columns and follow-up history fields are also present.

Before agent implementation, scalar profile/formative fields remain blank, history fields are `[]`, and agent counts are zero. The export must not infer a profile, formative value, or independence interpretation from correctness.

## Formula-Injection Protection

When `spreadsheet_safe_text = true`, user-controlled text beginning with `=`, `+`, `-`, or `@` is prefixed with an apostrophe in the exported CSV only.

This strategy is reversible: researchers who need exact text can remove one leading apostrophe from sanitized text cells during analysis. Database values are not modified.

The export includes:

```text
spreadsheet_formula_sanitization_applied
```

When `spreadsheet_safe_text = false`, text is exported exactly and the UI warns the teacher before download. CSV quotation alone is not treated as sufficient formula protection.

## Local Storage

Phase 5B stores generated files under:

```text
.data/exports
```

Files are outside public static folders. Download routes require teacher_researcher authorization and use server-generated storage keys. Clients cannot supply file paths.

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
MASTER_EXPORT_SCHEMA_VERSION=1.0.0
```

Future breaking column changes require a schema-version increment.

## Fixture And Smoke Test

Create the fixture:

```bash
npm run demo:data-export
```

Run the smoke test:

```bash
npm run export:master-smoke
```

The smoke test verifies job creation, public export ID, storage outside public folders, download, parseable CSV, stable headers, item rows, incomplete placeholder rows, skipped evidence distinction, public IDs, absence of internal UUID and secret data, multiple-outcome behavior, transcript quoting, JSON parsing, formula protection, blank future profile/formative fields, empty agent fields, schema version, row count, cleanup, and no OpenAI calls.
