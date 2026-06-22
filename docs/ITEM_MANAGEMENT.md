# Item Management

Phase 3A adds backend-only teacher_researcher content management for assessments, concept units, and MCQ items. Phase 3B adds a manual teacher_researcher UI over those APIs. Phase 3C adds content-governance rules over the same manual content system. It does not add the student assessment conversation, LLM calls, agents, follow-up loop, or CSV export.

## Teacher UI

Teacher researchers manage content at:

- `/teacher/content`
- `/teacher/content/assessments`
- `/teacher/content/assessments/new`
- `/teacher/content/assessments/[assessmentPublicId]`
- `/teacher/content/assessments/[assessmentPublicId]/concept-units/new`
- `/teacher/content/concept-units/[conceptUnitPublicId]`
- `/teacher/content/concept-units/[conceptUnitPublicId]/items/new`
- `/teacher/content/items/[itemPublicId]`
- `/teacher/content/import-json`

All pages require teacher_researcher authentication. Students are redirected away from teacher pages and receive `403` from teacher APIs.

The teacher dashboard has entry links for content management, JSON import, and assessment list. Full dashboard session review, transcripts, profiles, process logs, flags, agent-call views, and export remain deferred.

To create manual content:

1. Open `/teacher/content/assessments/new` and create an assessment.
2. From the assessment detail page, create one concept unit.
3. From the concept-unit detail page, create 3 to 4 MCQ items.
4. Publish the concept unit and resolve any structured validation errors.
5. Publish the assessment after at least one concept unit is actually published.

## Concept-Based Item Sets

A concept-based item set is stored as one `concept_unit` under an `assessment`. The teacher defines the concept boundary; the system does not impose a fixed ontology or infer concepts automatically.

Draft concept units may contain more than 4 candidate items. Publishing counts only active items with `included_in_published_set = true`, and the teacher chooses which items are included.

Required concept-unit fields for publishing:

- `title`
- `learning_objective`
- `related_concept_description`
- `administration_rules`
- `order_index`

## Item Shape

Options are structured JSON, not plain strings:

```json
[
  { "label": "A", "text": "Option A" },
  { "label": "B", "text": "Option B" },
  { "label": "C", "text": "Option C" }
]
```

The schema accepts 2 to 6 options. `correct_option` must match one option label. For publishable items, every incorrect option needs a distractor rationale.

Required item fields for publishing:

- `item_stem`
- `options`
- `correct_option`
- `distractor_rationales`
- `expected_reasoning_patterns`
- `possible_misconception_indicators`
- `administration_rules`
- `item_order`
- `included_in_published_set`

Distractor rationales and misconception indicators matter because later profiling should reason from selected options, reasoning quality, confidence alignment, and distractor-aligned evidence. They are not shown through student-facing endpoints.

## Publishing Validation

A concept unit can be published only if:

- it belongs to an existing teacher-owned assessment
- it has exactly 3 to 4 included active items
- concept metadata fields are nonempty
- every included active item has a nonempty stem
- every included active item has 2 to 6 options
- every included active item has a matching `correct_option`
- every incorrect option has a distractor rationale
- every active item has expected reasoning patterns
- every active item has possible misconception indicators
- item orders are unique
- option labels are unique within each item

An assessment can be published only if at least one concept unit already has `status = "published"`. A draft concept unit that merely passes validation is not enough.

Validation failures return:

```json
{
  "error": {
    "code": "publish_validation_failed",
    "message": "Concept unit did not pass publishing validation.",
    "details": {
      "validation": {
        "ok": false,
        "errors": []
      }
    }
  }
}
```

## Versioning And Archive Policy

Draft content can be edited. Content-relevant updates increment `version`.

Published unused assessments can explicitly return to draft before the first student session starts. Published concept units can explicitly return to draft when the parent assessment is draft and no student session exists. Returning to draft does not reset public IDs or version fields.

Published item content is not edited directly while its concept unit remains published. The teacher returns the concept unit to draft first, revises content or item membership, and republishes through backend validation.

Once any `assessment_sessions` row exists for an assessment, research-relevant content is locked. Assessment metadata, concept-unit order/content, item membership/order/content, correct answers, rationales, and version-relevant fields become read-only.

After locking, whole-assessment archive remains allowed to prevent future new sessions while preserving records. Individual concept-unit or item archive operations that mutate administered content are rejected.

If an item already has student responses, destructive changes to `item_stem`, `options`, `correct_option`, or `distractor_rationales` are rejected. This preserves the research interpretation of `item_responses.item_snapshot` and `item_version_snapshot`.

Future Phase 4 session start must atomically verify that the assessment is published, not archived, contains at least one valid published concept unit, and still satisfies the 3-to-4 included active item rule before creating the first session and establishing the lock.

## JSON Import

`POST /api/teacher/content/import-json` accepts either a new assessment with one or more concept units, or one or more concept units under an existing assessment.

New assessment import:

```json
{
  "assessment": {
    "title": "Demo assessment",
    "description": "Optional description"
  },
  "concept_units": [
    {
      "title": "Concept unit title",
      "learning_objective": "Learning objective",
      "related_concept_description": "Related concept description",
      "administration_rules": {},
      "items": [
        {
          "item_stem": "Question text",
          "options": [
            { "label": "A", "text": "Option A" },
            { "label": "B", "text": "Option B" },
            { "label": "C", "text": "Option C" }
          ],
          "correct_option": "A",
          "distractor_rationales": {
            "B": "Why B may indicate partial understanding",
            "C": "Why C may indicate a misconception"
          },
          "expected_reasoning_patterns": [
            "Expected correct reasoning pattern"
          ],
          "possible_misconception_indicators": [
            "Possible misconception indicator"
          ],
          "administration_rules": {}
        }
      ]
    }
  ]
}
```

Existing assessment import:

```json
{
  "assessment_public_id": "asmt_...",
  "concept_units": []
}
```

The import is validated before writes where possible and uses a database transaction for writes. It generates public IDs with the shared helper and returns created public IDs plus validation results. It is manual JSON import only; no LLM Item Preparation Agent is implemented.

The UI import page is `/teacher/content/import-json`. A sample import payload is available at `docs/sample-concept-unit-import.json`.

## Teacher API Routes

- `GET /api/teacher/assessments`
- `POST /api/teacher/assessments`
- `GET /api/teacher/assessments/[assessmentPublicId]`
- `PUT /api/teacher/assessments/[assessmentPublicId]`
- `POST /api/teacher/assessments/[assessmentPublicId]/archive`
- `POST /api/teacher/assessments/[assessmentPublicId]/publish`
- `POST /api/teacher/assessments/[assessmentPublicId]/return-to-draft`
- `GET /api/teacher/assessments/[assessmentPublicId]/concept-units`
- `POST /api/teacher/assessments/[assessmentPublicId]/concept-units`
- `POST /api/teacher/assessments/[assessmentPublicId]/reorder-concept-units`
- `GET /api/teacher/concept-units/[conceptUnitPublicId]`
- `PUT /api/teacher/concept-units/[conceptUnitPublicId]`
- `POST /api/teacher/concept-units/[conceptUnitPublicId]/archive`
- `POST /api/teacher/concept-units/[conceptUnitPublicId]/publish`
- `POST /api/teacher/concept-units/[conceptUnitPublicId]/return-to-draft`
- `POST /api/teacher/concept-units/[conceptUnitPublicId]/reorder-items`
- `GET /api/teacher/concept-units/[conceptUnitPublicId]/items`
- `POST /api/teacher/concept-units/[conceptUnitPublicId]/items`
- `GET /api/teacher/items/[itemPublicId]`
- `PUT /api/teacher/items/[itemPublicId]`
- `POST /api/teacher/items/[itemPublicId]/archive`
- `POST /api/teacher/content/import-json`

All routes require teacher_researcher authentication. Student users receive `403`.

## Smoke Test

Run:

```bash
npm run content:smoke
```

The smoke test creates temporary teacher-owned content, validates publishability, publishes a concept unit, checks invalid publish cases, verifies version incrementing and archive behavior, verifies public-ID-only service outputs, and cleans up only the temporary records it created.

Run the Phase 3C governance smoke test:

```bash
npm run content:governance-smoke
```

The governance smoke test verifies teacher-defined concept names, more than 4 draft candidate items, teacher-selected included item membership, assessment publication requiring an actually published concept unit, return-to-draft before sessions, lock-after-session behavior, archive restrictions, whole-assessment archive after locking, and cleanup of temporary records. It makes no OpenAI calls.

## Phase 6D2A Assessment Controls

Assessment content remains governed by the existing lock rules after student sessions begin. Phase 6D2A adds separate assessment-level controls that may be edited without changing administered content:

- workflow mode: `automatic` or `manual_review`
- release date/time in the configured course timezone
- closing date/time in the configured course timezone

Changing workflow mode affects future sessions only because each session stores `workflow_mode_snapshot` at creation. Changing release/close dates affects new starts only; existing sessions may resume.
