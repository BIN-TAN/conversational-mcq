# Research Data and Item-Design Corrections

This local revision follows `RESEARCH_DATA_AUDIT_2026-09-11.md`. The original
audit and its generated evidence remain a record of the pre-fix state.

## Item generation

The reported screenshot shows valid option-level misconception references
missing from the redundant item-level index. Validation now computes the union
of those references and then applies the same schema, known-ID, coverage,
option-count, cognitive-demand, and answer-key checks. It does not infer a new
misconception, rewrite an item, or confirm a teacher answer key. The original
provider object is not mutated. A mocked runtime fixture reproduces the omitted
index and reaches the existing teacher-review batch without an extra model call.

## Research corrections

- **Delivery:** HTTP failures are no longer treated as success. Aggregate browser
  events receive stable event IDs and a browser-instance ID. A session-scoped
  server row lock deduplicates retried IDs, including ambiguous acknowledgements.
  The browser keeps up to 200 unacknowledged aggregate events in session storage,
  sends batches of 20, limits each send to 15 seconds, and permits at most five
  attempts before waiting for reload or an online event. A recovered overflow or
  expired queue reports discarded unacknowledged entries, not proven data loss.
  No response text, pasted text, or raw keystrokes enters this queue.
- **Counts:** Initial counts use recorded topic item counts and administered
  roles, not `item_order <= 3`. Historical rows without role snapshots use the
  locked item's administration rules. Completed counts use submitted responses.
  Confidence and option aliases no longer count as independent selections.
  Evidence lookup retains the newest evidence per item across all topics.
- **Timing:** Version 3 unions overlapping idle observations and intersects
  them with active lifecycle windows. Hidden periods outside active windows
  are not subtracted twice. Missing, incomplete, or multi-document visibility
  does not produce a measured visible-time value. Paired visibility estimates
  are not attention measures. Valid active-typing summaries are summed; ordinary
  elapsed typing duration is never converted to active typing.
- **Joins:** Process-event public IDs are namespaced hashes of immutable event
  IDs, independent of export order. Event item-snapshot keys match the actual
  response/content snapshot; unavailable snapshots remain null with a limitation.
- **Completeness:** Content exports retain options E/F. Safe aggregate typing,
  paste-format/length-band, browser-instance, and queue-gap fields are explicitly
  exported and documented. Raw payloads remain excluded.
- **Missingness:** An absent no-tempting-option observation is empty, not false.
- **Reproducibility:** Dataset v2 includes a README and a manifest listing every
  other entry's SHA-256, byte size, CSV row count, database snapshot time,
  source commit, scope, restricted-field policy, and derivation versions.
  Reads remain in one RepeatableRead transaction; serialization is outside it.

## Interpretation and limits

These are corrected collection and export definitions, not a historical data
backfill. Stored student records and previous exported files are not rewritten.
Re-export existing records under dataset v2; do not merge old and new timing
definitions without recording the version. Earlier events that never reached
the server cannot be reconstructed.

Session storage survives reload but not closing the browser tab. Disabled/full
storage, browser termination, and a session never revisited can still lose
unacknowledged events. Absence of a gap marker is not proof of complete capture.
No claim of exactly-once browser observation, continuous active attention, or
complete historical telemetry is made. The server deduplicates delivered IDs.

Legacy alias fallback uses the canonical stream when present; mixed historical
instrumentation requires record-level review. Raw long-pause counts/duration
summaries describe threshold events and are not interchangeable with unioned
idle time. Multi-document visibility is conservatively unavailable. Free-text
responses may contain identifying information and still require study-specific
review and eligible-cohort/consent handling before sharing or analysis.

No deployed classroom data, Render settings, model provider, approval, or
activation is touched by local verification. Deployment requires a separate
commit/push/deploy request.

## Verification

All database work used an isolated local PostgreSQL database with the existing
61 migrations and disposable synthetic records. External HTTP/provider access
was blocked by `scripts/classroom-audit-network-guard.mjs`.

- `npm run classroom:audit`: 43/43 pass, including student isolation,
  lifecycle, authoring, export, teacher/transcript parity, and privacy checks.
- `prisma/research-data-quality-audit.ts`: 28/28 pass on the final source,
  including eight completed items, eight concurrent deliveries of one event,
  stable snapshot joins, timing, safe summary fields, actual ZIP entry bytes,
  CRC checks, manifest hashes, and source-record cleanup.
- Ten additional focused scripts pass: delivery, item timing, visibility,
  pause/resume timing, dictionary specificity/semantics/applicability,
  pseudonymization/token lineage, and the item-design contract.
- The item-design database runtime smoke passes with an omitted item-level
  index. It preserves the original raw output, requires teacher key confirmation,
  and reuses the same review batch on duplicate requests.
- `npm run typecheck`: pass.
- `npm run lint`: no errors; five pre-existing historical-code warnings.
- `npm run build`: pass. The first sandboxed attempt was blocked by local
  TypeScript process permissions; the permitted local build completed.
- `git diff --check`: pass.
- Live provider calls, model-auth requests, and real dispatch checkpoints: zero.

The existing classroom gate excludes an obsolete pre-canonical formative
runtime fixture in favor of current V18R2 runtime/lifecycle checks. This revision
does not change that exclusion or claim to have revalidated every historical
frozen candidate.

## Changed paths

Application:

- `src/lib/services/content/item-design-contract.ts`
- `src/components/student-assessment/api.ts`
- `src/components/student-assessment/process-events.ts`
- `src/components/student-assessment/process-event-delivery.ts` (new)
- `src/lib/services/student-assessment/service.ts`
- `src/lib/services/student-assessment/timing-contract.ts`
- `src/lib/services/teacher-research-data/analysis-ready-export.ts`
- `src/lib/services/teacher-research-data/dictionary.ts`

Tests and documentation:

- `prisma/teacher-evidence-centered-item-design-smoke-test.ts`
- `prisma/teacher-evidence-centered-item-design-runtime-smoke-test.ts`
- `prisma/student-data-dictionary-agent-activity-applicability-smoke-test.ts`
- `prisma/research-process-delivery-smoke-test.ts` (new)
- `prisma/research-data-quality-audit.ts` (extends the preceding audit's uncommitted reproducer)
- `docs/DATA_LOGGING_SPEC.md`
- `docs/RESEARCH_DATA_FIXES_2026-09-11.md` (this report)

The preceding uncommitted `docs/RESEARCH_DATA_AUDIT_2026-09-11.md` is retained
unchanged. No prompt, schema/migration, assessment truth, historical evaluation
artifact, approval bundle, or rollback bundle is edited.
