# MCQ draft review improvements

## Optional assistance

- **Suggest missing notes** proposes target reasoning, evidence of strong
  reasoning, and distractor interpretation notes for selected, not-yet-added
  items with empty note fields. Existing teacher notes are preserved. The
  existing assistant can also propose an unofficial answer key; this is never
  automatically confirmed. At most ten eligible items per explicit request.
- **Repair imported layout** uses the existing formatting assistant to recover
  stems/options/source keys from imported text without rewriting the content.
  It is omitted for structured generated drafts. At most eight selected items
  per explicit request. Proposals still require individual teacher review.
- **Review suggested notes** replaces the ambiguous bulk acceptance action.
  A preview lists the actual proposed text and target field. Teachers may
  deselect individual notes before applying. Only empty fields without a prior
  decision are eligible; rejected suggestions, keys, existing notes, and added
  items are excluded. Accepted text appears immediately in the editable fields.

## Reliability

An explicit **Save review** persists edits without importing or calling an LLM.
Unsaved navigation prompts protect local edits. Editing is disabled during
requests, failures preserve local input, and version conflicts return HTTP 409
instead of overwriting another request's changes.

Question/option edits clear the UI's answer-key confirmation. The add action
requires confirmed keys for selected items; the existing backend draft-only
import contract can still retain an unconfirmed key as blank. Publication and
student answer-key boundaries are unchanged.

Previously added candidates become read-only summaries with an **Open item**
link. They are excluded from new imports and assistant requests. An atomic
review-revision claim prevents competing imports of the same batch from
creating duplicate items. Later retries skip already-added candidates and
preserve cumulative imported IDs/counts. Corrections to administered items
continue through the existing linked-revision workflow.

Fresh assistant proposals reset earlier acceptance decisions so new content
cannot inherit an old approval. Provider requests do not run inside database
transactions. No prompts, models, student pedagogy, database schema, operational
approval, or rollback bundle are changed by this review UX correction.

## Verification

The combined local no-provider gate includes 52 classroom/security/import/
research scripts. Added tests cover saved reviews, stale versions, concurrent
imports, repeated imports, imported-item immutability, note application, and
teacher-key preservation. `scripts/mcq-review-ux-smoke.mjs` exercises the
browser workflow with intercepted assistant responses, failure handling, and
320/390/768/1440 pixel viewports. It never requests a real provider or modifies
production records.

Dependency and archive protections are documented separately in
`DEPENDENCY_SECURITY_REVIEW_2026-09-11.md` and are included in this release.
