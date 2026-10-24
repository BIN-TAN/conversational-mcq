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
`target_reasoning_note`, `essential_elements` (or the older
`strong_reasoning_should_mention`; one element per line or separated by semicolons),
`rationale_a` ... `rationale_f` (why a student might choose that incorrect option),
`idea_label_a` ... `idea_label_f` (a few words; options in a mini test that share an
idea label show as an answer pattern), the older single `distractor_diagnostic_notes`,
and `source_attribution` are supported. Invalid
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

## Files that do not match the format exactly (release CMCQ-20261021-07)

JSON files written by hand or by other tools rarely match the format exactly. The import reads
them leniently (`src/lib/services/content/mini-test-json-normalize.ts`) and lists every adjustment
in the summary panel under "Adjusted to the import format". It adjusts only what has one safe
reading:

- trailing commas and comments outside strings;
- other names for fields: `question` or `prompt` for `stem`, `choices` or `answers` for `options`,
  `answer` or `correct_answer` for `key`, `explanation` for `target_reasoning_note`, `questions` for
  `items`, and a title at the top level;
- a file that is only a list of items;
- options given as letter and text pairs, as plain strings, with lower-case or bracketed letters, or
  numbered 1, 2, 3 (lettered A, B, C in order);
- keys such as `b`, `(B)`, `Option B` or the option's exact text;
- essential elements given as text, and notes given as lists;
- a note for the key, which becomes the target reasoning note when that is empty;
- notes for options the item does not have;
- links to objectives or misconceptions that are not in the file's design;
- cognitive demand words such as `Analysis`;
- draft settings outside their range.

Fields the format does not use are ignored and named. This includes fields the application sets
itself, such as a status or a confirmed key, so they are never applied. Wording is never changed
or shortened. A key that does not match an option is left blank for the instructor to confirm.
The adjusted file, not the original, is passed to item review. The adjustments are kept with the
review batch (`validation_summary.source_context.format_changes`).

What has no safe reading still stops the import, with one plain sentence per problem naming the
item or field. Examples are repeated option letters, a missing stem, fewer than two options,
over-long text and invalid JSON beyond trailing commas.

For those files, **Let the assistant format this file** sends the text to the item-preparation
model (`mini-test-json-format-v4`, `formatMiniTestJsonWithAssistant` in `item-design.ts`, route
`POST /api/teacher/content/import-json/format`).

- The model copies every title, stem, option, note and design entry word for word.
- It sets a key only where the file states one.
- It lists what it changed, and the entries it could not read.
- Nothing is saved: the formatted JSON replaces the text on the page, with the list of changes,
  and the instructor checks it before continuing.
- The call is audited in `agent_calls`, and the same file returns the same result without a new
  call.
- Files over 400,000 characters are split by the instructor.
- This is teacher authoring and is not hash-gated.

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

`schema_version` is `mini-test-import-v1`. One file represents one mini test on one topic.
The sample items follow the item builder's item-writing rules: one idea per item, a stem
answerable before the options, a short new case, parallel options of similar length with
one fully correct key, distractors from plausible reasoning, no absolute giveaway words, and a
low reading load. The file contains:

- `assessment`: title, optional diagnostic focus and folder label.
- `design` (optional): the existing `evidence-centered-item-design-v1` blueprint,
  including section/topic, objectives and evidence requirements, misconception
  hypotheses, source exemplars, and generation settings. The saved design is
  available to the regular item-design assistant; importing does not call it.
- `items`: ordered stems, labeled options, optional supplied `key`, diagnostic
  notes, objective/hypothesis links, cognitive demand, source references and media.
  Optional per-item notes: `essential_elements` (one to three strings; use it or
  `strong_reasoning_should_mention`, not both), `distractor_rationales`
  (`{ "B": "..." }`, one per incorrect option, never for the key) and `idea_labels`
  (`{ "B": "reliability = validity" }`, at most 60 characters). The older single
  `distractor_diagnostic_notes` is still accepted.
  Each `media_assets` entry has a `placement`: `item_stem` (default), `option` (with
  `option_label`), or `explanation` (shown with the explanation in the answer review only).
  Stems, options and notes may contain formulas in LaTeX between `$` signs (`$\\sigma = F/A$`
  in JSON, since a backslash is written twice) and Markdown pipe tables; they are stored as
  written and rendered for students and instructors.

Every published item needs one to three essential elements; publishing is blocked
without them. An incorrect option without its own rationale is a publishing warning.

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
