# Model Evaluation

Phase 7E1 adds an internal development-evaluation harness for the five active agents:

- `item_verification_agent`
- `response_collection_agent`
- `student_profiling_agent`
- `formative_value_and_planning_agent`
- `followup_agent`

The harness exists so teacher_researchers can review schema adherence, semantic behavior, safety boundaries, and expert annotations before any future live classroom model evaluation.

## Scope

Implemented in Phase 7E1:

- normalized eval tables for suites, cases, runs, run items, annotations, and rubrics
- 50 synthetic fixture cases, 10 per active agent
- mock evaluation runs with schema, semantic, and safety validation capture
- blind expert annotation UI
- aggregate summary metrics
- CSV export of eval results
- teacher-only APIs and pages under `/teacher/evals`

Not implemented:

- live provider evaluation
- OpenAI calls
- real student data evaluation
- summative outcome use
- classroom workflow mutation
- GPT-5.5 or nano comparison

## Model Candidate Policy

Phase 7E1 stored the future target model as configuration metadata only. Phase 7E2A adds a guarded live canary runner for one exact snapshot:

```text
EVAL_PROVIDER=openai
EVAL_LIVE_CALLS_ENABLED=false
EVAL_TARGET_MODEL=gpt-5.4-mini-2026-03-17
EVAL_REASONING_EFFORT=low
EVAL_DEFAULT_REPETITIONS=2
EVAL_CANARY_REPETITIONS=1
EVAL_CANARY_CASES_PER_AGENT=5
EVAL_COST_HARD_LIMIT_USD=50
```

Normal mock runs record `provider=mock` and do not call OpenAI. The paid canary
is CLI-only and refuses to run without `--confirm-paid-api`, live eval
enablement, exact snapshot configuration, a locally configured server-side API
key, and an explicit run-instance mode:

```bash
npm run eval:live-canary -- --confirm-paid-api --new-run
npm run eval:live-canary -- --confirm-paid-api --resume <run_public_id>
```

`--new-run` always creates a new run instance. `--resume` can continue only the
specified nonterminal run and cannot resume completed runs or runs whose frozen
prompt, schema, evaluator, manifest, model, or canary controls differ from the
current configuration.

Phase 7E2A does not compare GPT-5.5 or nano models. It does not run the future 100-call pilot.

## Teacher UI

Routes:

- `/teacher/evals`
- `/teacher/evals/suites`
- `/teacher/evals/runs`
- `/teacher/evals/runs/[runPublicId]`
- `/teacher/evals/run-items/[runItemPublicId]`

The UI supports fixture loading, mock run creation, run review, failure filtering, critical-flag filtering, blind annotation, reference toggling, annotation confirmation, and CSV export.

Completed 25-item live canary runs can also be exported as local blind-review
packets with `npm run eval:blind-review-export -- --run <run_public_id>`. The
blind packet, reference mapping, and blank annotation template are written under
ignored `.data/eval-review/` storage and do not modify eval or classroom records.
Completed annotation CSVs can be imported as `ai_assisted_preliminary` draft
annotations and must be teacher-confirmed before readiness gates count them as
human review.

Annotation import validates structure, review-ID mapping, run compatibility,
rubric-score ranges, pass/fail labels, and approved critical-failure flags. It
does not enforce any predetermined pass/fail split or previous failed-case set.
Pass counts, fail counts, failed case IDs, critical-failure counts, and
per-agent pass rates are calculated import results. The same import service is
intended to support the 25-item canary and future larger pilot runs.

## APIs

Teacher-only APIs:

- `GET /api/teacher/evals/suites`
- `POST /api/teacher/evals/suites`
- `GET /api/teacher/evals/suites/[suitePublicId]`
- `POST /api/teacher/evals/fixtures/seed`
- `GET /api/teacher/evals/runs`
- `POST /api/teacher/evals/runs/mock`
- `GET /api/teacher/evals/runs/[runPublicId]`
- `GET /api/teacher/evals/runs/[runPublicId]/items`
- `GET /api/teacher/evals/runs/[runPublicId]/export`
- `POST /api/teacher/evals/runs/[runPublicId]/annotations/import-draft`
- `POST /api/teacher/evals/runs/[runPublicId]/annotations/confirm-all`
- `GET /api/teacher/evals/run-items/[runItemPublicId]`
- `POST /api/teacher/evals/run-items/[runItemPublicId]/annotations`
- `POST /api/teacher/evals/run-items/[runItemPublicId]/annotations/confirm`
- `GET /api/teacher/evals/summary`

Students receive 403. Unauthenticated requests receive 401.

## Smoke Commands

```bash
npm run eval:seed-fixtures
npm run eval:mock-run
npm run eval:harness-smoke
```

The smoke test verifies fixture loading, mock execution, eval isolation, teacher API access, student 403 responses, annotation create/update, blind-mode behavior, summary metrics, CSV export parsing, critical failure aggregation, and absence of OpenAI network calls.

Phase 7E2A smoke commands:

```bash
npm run eval:structured-output-compat-smoke
npm run eval:annotation-import-smoke
npm run eval:annotation-adjudication-smoke
npm run eval:live-canary-runner-smoke
npm run eval:targeted-quality-regression-smoke
npm run eval:budget-smoke
npm run eval:live-isolation-smoke
npm run eval:canary-report-smoke
```

These smoke tests use mock/fake provider paths and make no OpenAI calls.

## Phase 7E2A Quality Patch

Baseline run `evr_20260623_1sjeh1q` remains frozen. The patch adds targeted
semantic regressions for duplicate item review, conflicting profile evidence,
pure off-topic follow-up redirects, safe hint refusals, safe hidden-prompt
refusals, response-collection blocked-help metadata, and backend-consistent
missing evidence status.

Future eval results expose `eval-semantic-v2` and `eval-safety-v2` metadata
where practical. Future canary readiness reports include a `known-failure
regression gate`; it is an engineering gate and not classroom validation.

The quality-patch canary fingerprint includes prompt versions, prompt hashes,
schema versions, agent versions, semantic/safety evaluator versions,
max-output-token controls, retry/timeout/concurrency settings, pricing version,
ordered cases, model snapshot, reasoning effort, and Git commit. This
fingerprint is separate from the run public ID; multiple fresh runs may share the
same fingerprint but must have distinct run IDs and fresh annotations.

Run:

```bash
npm run eval:targeted-quality-regression-smoke
npm run eval:live-canary:compare-config -- --run evr_20260623_1sjeh1q
```
