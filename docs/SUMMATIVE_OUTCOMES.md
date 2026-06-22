# Summative Outcomes

Phase 5B supports teacher_researcher import of supervised summative outcome scores for later research linkage. It does not call OpenAI and does not generate student profiles, formative decisions, or follow-up rounds.

## CSV Template

Required columns:

```text
user_id,outcome_name,outcome_score,max_score,assessment_date
```

Optional column:

```text
notes
```

See `docs/sample-summative-outcomes.csv`.

## Validation Rules

- `user_id` must match an existing student through normalized `users.user_id_normalized` lookup. The matched student's canonical `users.user_id` remains the research linkage ID.
- Teacher_researcher accounts are rejected as outcome recipients.
- `outcome_name` must be nonempty.
- `outcome_score` must be numeric, finite, and between zero and `max_score`.
- `max_score` must be numeric, finite, and greater than zero.
- `assessment_date` must be an ISO-style `YYYY-MM-DD` date.
- Blank notes are allowed.
- Duplicate logical rows inside one upload are detected.
- Unmatched users are reported and not silently ignored.
- Invalid rows are never committed.

Password hashes, access-code hashes, cookies, tokens, and environment values are not used in matching output.

## Preview And Commit

The workflow is:

```text
upload or paste CSV -> preview -> inspect validation -> commit valid preview
```

Preview creates a `summative_outcome_import_batches` audit row and stores a server-normalized representation. Preview does not create `summative_outcomes`.

Commit uses the stored normalized preview batch. It does not trust client-modified preview payloads.

Commit is blocked when the batch has invalid rows, duplicate source rows, unmatched users, or conflicts.

## Duplicate, Conflict, And Revision Behavior

The active logical key is:

```text
user_db_id + outcome_name + assessment_date
```

An exact duplicate of an existing active outcome is reported as an existing duplicate and can be treated as idempotent. A row with the same logical key and different score, max score, or notes is a conflict and is not silently overwritten.

Explicit replacement is audited:

- previous active record becomes `superseded`
- new record becomes `active`
- `revision_number` increments
- `supersedes_outcome_db_id` links the new record to the prior record

Historical versions remain in the database. Normal export uses active outcomes by default.

## APIs

- `POST /api/teacher/summative-outcomes/import/preview`
- `POST /api/teacher/summative-outcomes/import/[batchPublicId]/commit`
- `GET /api/teacher/summative-outcomes/import-batches`
- `GET /api/teacher/summative-outcomes/import-batches/[batchPublicId]`
- `GET /api/teacher/summative-outcomes/outcome-names`
- `POST /api/teacher/summative-outcomes/[outcomePublicId]/replace`

All routes require `teacher_researcher`, use public IDs at route boundaries, return structured errors, and avoid internal UUID and secret leakage.

## UI

Use:

```text
/teacher/data/summative-outcomes
```

The page supports CSV file upload, pasted CSV text, sample template download, preview counts, invalid row details, unmatched users, duplicates, conflicts, commit, import-batch history, active outcome names, and outcome counts.

This is not a gradebook. It does not edit student identity or display password/access-code data.

## Fixture And Smoke Test

Create the fixture:

```bash
npm run demo:data-export
```

Cleanup fixture-owned records:

```bash
npm run demo:data-export:cleanup
```

Run the smoke test:

```bash
npm run summative:import-smoke
```

The smoke test verifies valid preview/commit, preview nonmutation, invalid score/max/date validation, unknown user reporting, teacher account rejection, duplicate detection, idempotent duplicate reporting, conflict rejection, explicit replacement revision auditability, student authorization exclusion, cleanup behavior, and no OpenAI calls.

Phase 7B master export coverage is verified separately with:

```bash
npm run export:master-smoke
npm run export:master-complete-smoke
```

Multiple active outcomes remain in `summative_outcomes_json`; selecting a primary outcome does not multiply item-response rows.
