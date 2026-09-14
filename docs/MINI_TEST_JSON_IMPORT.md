# Mini-test JSON and Excel import

The teacher page `/teacher/content/import-json` accepts a `.json` upload or pasted
JSON. **Download sample JSON** and **Use sample** use the same versioned file:
[`public/samples/mini-test-import.json`](../public/samples/mini-test-import.json).

## Excel workbooks

Assessment management > **Import items** > **Excel workbook** accepts a standard
XLSX workbook up to 2 MB. **Download sample Excel** supplies an example directly on
the page. Each selected item sheet becomes one separately owned draft mini test.
The inspection step writes nothing. Preparation creates all selected tests and
review batches atomically. Re-uploading identical bytes (including a renamed
file) reuses the teacher's existing drafts. Previously published, archived or
used tests are not overwritten or silently copied.

The first nonempty row of each item sheet must contain `stem` (or `item_stem`),
`option_a`, and `option_b`. Options C-F, `key`, `item_label`,
`target_reasoning_note`, `strong_reasoning_should_mention`,
`distractor_diagnostic_notes`, and `source_attribution` are supported. Invalid
keys, malformed item sheets, oversized ranges, formulas, spreadsheet errors,
macros and embedded media/objects are rejected rather than silently dropped.
Additional named columns remain in original-source provenance with a warning.
Limits: 24 sheets, 501 rows per sheet including headers, 32 columns, 1,500 total
nonempty rows, 500 item candidates and 1,000,000 extracted characters.

Non-item sheets are displayed as reference sheets and retained in each selected
test's review batch. Hidden sheets are excluded with a visible warning. A guide
table headed `Item ID` or `item_label` is linked to candidates only for an
unambiguous workbook-wide item label. Exact guide rows, original item rows,
sheet names, row numbers, workbook hash and parser version remain teacher-only
provenance. No objectives, initial-evidence requirements or misconception claims
are invented. Guide follow-up notes are not turned into active student rules.
The existing blueprint editor remains the place to review and configure design.

Each mini-test detail page retains **Open item review** links, so teachers can
leave and resume review. The new JSON/workbook staging path enforces explicit
key confirmation on the server as well as in the reviewer UI. Existing legacy
draft-only imports with blank keys retain their compatibility behavior; normal
publication validation still blocks incomplete content.

The older per-assessment XLSX importer now rejects multiple visible worksheets
and points teachers to this workbook workflow instead of reading only one sheet.

## Current workflow

1. Load or paste a file. Local validation and a readable summary do not create records.
2. **Continue to item review** creates one teacher-owned draft mini test, its primary
   topic, and a review batch atomically. No items are created or published yet.
3. Review/edit the candidates, choose which to include, and confirm each answer key
   in the existing MCQ import reviewer. **Review design** opens the current design editor.
4. Import the selected drafts and publish through the normal mini-test workflow.

The same file, including changes to JSON whitespace or property ordering, reopens
the same review for that teacher. Concurrent identical submissions are retried
within the same content identity. They do not create duplicate tests or batches.
Files already imported into published, used, or archived tests cannot create a
second copy through this retry path. Intentional copies use the existing revision
workflow, or a new import with a distinct assessment title/content.

## Format

`schema_version` is `mini-test-import-v1`. One file represents one related mini test:

- `assessment`: title, optional diagnostic focus and folder label.
- `design` (optional): the existing `evidence-centered-item-design-v1` blueprint,
  including section/topic, objectives and evidence requirements, misconception
  hypotheses, source exemplars, and generation settings. The saved design is
  available to the regular item-design assistant; importing does not call it.
- `items`: ordered stems, labeled options, optional supplied `key`, diagnostic
  notes, objective/hypothesis links, cognitive demand, source references and media.

Keys in a file are proposals, never teacher confirmation. Missing keys, design,
or notes are not inferred. References must resolve to the supplied design. Unknown
fields are rejected so content is not silently dropped. Ownership, publication
state, confirmation flags, and arbitrary runtime rules are not file inputs.

The upload limit is 2 MB and the staging limit is 500 candidates. The existing
mini-test publication range remains 3-12 included items. Larger input sets can be
reviewed and selected; there is no automatic grouping into multiple tests yet.

Media uses the existing external-URL fields and safety checks. JSON cannot attach
private storage IDs. URLs are validated but not fetched by the importer. Source
checksum, original item content, locations, mappings, blueprint hash, and supplied
versus confirmed keys are preserved in review/import provenance. Student-facing
projections and assessment lifecycle rules are unchanged.

## Compatibility and future work

The per-assessment MCQ importer also parses this versioned item format. Importing
there does not replace the destination assessment's existing design. Source-design
references remain source provenance, not claims that its design was applied.
The legacy `concept_units` service/API and unversioned per-assessment JSON parser
remain supported for existing integrations; the new page does not invoke the
legacy direct-create API.

Future LLM-assisted organization of existing item banks should propose coherent
section-level blueprints and candidate groups while preserving source references.
Teachers must review groupings, wording, evidence mappings, and answer keys before
import/publication. No LLM grouping or automatic publication is implemented here.

## Verification

- `node --import tsx prisma/mini-test-json-import-smoke-test.ts`
- `node --import tsx prisma/mini-test-workbook-smoke-test.ts`
- `node scripts/mini-test-json-import-ux-smoke.mjs` (after a production build)
- `node --import tsx prisma/teacher-mcq-import-smoke-test.ts`
- `npm run typecheck`, `npm run lint`, `npm run build`

The smoke scripts require a disposable localhost database named
`conversational_mcq_classroom_audit_*`. Use the local network guard and disable live
providers. They are not production-data tests.
Set `WORKBOOK_TEST_FILE` to a local workbook path to include it in workbook and
browser verification; otherwise those checks use synthetic fixtures.
