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

Phase 7E1 stores the future target model as configuration metadata only:

```text
EVAL_TARGET_MODEL=gpt-5.4-mini
EVAL_DEFAULT_REPETITIONS=2
EVAL_LIVE_CALLS_ENABLED=false
EVAL_COST_HARD_LIMIT_USD=50
```

Mock runs record `provider=mock` and do not call OpenAI. Future Phase 7E2 may run `gpt-5.4-mini` after the deployment owner manually configures server-side API credentials and live evaluation gates.

## Teacher UI

Routes:

- `/teacher/evals`
- `/teacher/evals/suites`
- `/teacher/evals/runs`
- `/teacher/evals/runs/[runPublicId]`
- `/teacher/evals/run-items/[runItemPublicId]`

The UI supports fixture loading, mock run creation, run review, failure filtering, critical-flag filtering, blind annotation, reference toggling, and CSV export.

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
- `GET /api/teacher/evals/run-items/[runItemPublicId]`
- `POST /api/teacher/evals/run-items/[runItemPublicId]/annotations`
- `GET /api/teacher/evals/summary`

Students receive 403. Unauthenticated requests receive 401.

## Smoke Commands

```bash
npm run eval:seed-fixtures
npm run eval:mock-run
npm run eval:harness-smoke
```

The smoke test verifies fixture loading, mock execution, eval isolation, teacher API access, student 403 responses, annotation create/update, blind-mode behavior, summary metrics, CSV export parsing, critical failure aggregation, and absence of OpenAI network calls.
