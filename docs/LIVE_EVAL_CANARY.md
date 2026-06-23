# Live Evaluation Canary

Phase 7E2A adds a controlled live-evaluation canary path for the five active agents. It is evaluation-only and does not enable classroom live calls.

## Scope

The canary design is fixed:

- model snapshot: `gpt-5.4-mini-2026-03-17`
- reasoning effort: `low`
- agents: `item_verification_agent`, `response_collection_agent`, `student_profiling_agent`, `formative_value_and_planning_agent`, `followup_agent`
- cases: 5 synthetic cases per agent
- repetitions: 1
- total run items: 25
- hard budget: USD 50
- concurrency: 1
- max retries: 1

The canary rejects the `gpt-5.4-mini` alias, GPT-5.5, nano models, nonsynthetic cases, more than 25 run items, and more than one repetition.

## Configuration

Evaluation live calls are separate from classroom live calls:

```text
EVAL_PROVIDER=openai
EVAL_LIVE_CALLS_ENABLED=true
EVAL_TARGET_MODEL=gpt-5.4-mini-2026-03-17
EVAL_REASONING_EFFORT=low
EVAL_COST_HARD_LIMIT_USD=50
OPENAI_API_KEY=<set locally, never commit>
```

Classroom settings should remain:

```text
LLM_PROVIDER=mock
LLM_LIVE_CALLS_ENABLED=false
```

Do not enter an API key in the browser or chat. Store it only in `.env.local`, which is ignored by Git.

## Manual Procedure

After editing `.env.local` locally:

```bash
npm run eval:live-canary:preflight
npm run eval:live-canary:dry-run
npm run eval:live-canary -- --confirm-paid-api --new-run
```

After completion:

```bash
npm run eval:live-canary:report -- --run <run_public_id>
```

Without `--confirm-paid-api`, the paid command refuses to run. The paid command
also refuses to run unless the caller explicitly chooses one run-instance mode:

```bash
npm run eval:live-canary -- --confirm-paid-api --new-run
npm run eval:live-canary -- --confirm-paid-api --resume <run_public_id>
```

`--new-run` always creates a new `run_public_id` and new run items. It never
returns an already completed run, even when the completed run has the same case
manifest or the same configuration fingerprint. `--resume` resumes only the
specified nonterminal run, skips completed items, and blocks resume if the
current prompt, schema, evaluator, manifest, model, or canary controls no longer
match the frozen run configuration.

To inspect an existing live canary run without making any provider request:

```bash
npm run eval:live-canary:inspect -- --run <run_public_id>
```

The inspect command is read-only. It displays the run status, item statuses,
provider response/request IDs where present, whether raw output and usage are
persisted, where usage was found, sanitized error categories/messages, whether
the run is safe to resume, and whether a fresh run is recommended. It never
prints API keys, authorization headers, database URLs, session secrets, cookies,
or raw environment values.

To compare the current canary configuration with a historical run without making
any provider request:

```bash
npm run eval:live-canary:compare-config -- --run <run_public_id>
```

This reports differences in model snapshot, reasoning effort, manifest hash,
prompt versions, prompt hashes, schema versions, semantic/safety evaluator
versions, pricing registry version, Git commit, and the full run configuration
fingerprint. It does not modify the compared run or its annotations.

To generate a local blind-review packet for a completed 25-item live canary:

```bash
npm run eval:blind-review-export -- --run <run_public_id>
```

The export is read-only. It writes files under `.data/eval-review/<run_public_id>/`,
which is Git-ignored:

- `blind_review_packet.jsonl`: 25 records in deterministic shuffled order with opaque `review_item_id` values, synthetic input payloads, model outputs, agent-specific rubrics, safety expectations, and relevant critical-failure definitions.
- `review_reference.jsonl`: the mapping from opaque IDs to original case IDs, gold labels, expected behavior, automated semantic/safety results, automated critical flags, and model/provider/prompt metadata.
- `annotation_template.csv`: one blank annotation row per opaque review item.
- `redaction_summary.json`: export-only safety findings with field paths, categories, lengths, and irreversible hashes, but no detected values.

The blind packet excludes original case IDs, model/provider metadata,
response/request IDs, prompt versions and hashes, automated results, gold labels,
token usage, costs, and existing annotations. Use the reference file only after
blind review when adjudication context is needed.

Use `npm run eval:blind-review-export:inspect -- --run <run_public_id>` to
diagnose export safety without writing review files. The inspect report
distinguishes exact configured-secret matches, standalone credential-shaped
tokens, synthetic placeholders, and benign references such as `API key`, `system
prompt`, or `hidden instructions`. Actual or credential-shaped tokens are
redacted in exported review copies; benign words alone do not block export.

Completed offline annotations are imported as draft, AI-assisted preliminary
records:

```bash
npm run eval:annotations:import-draft -- \
  --run <run_public_id> \
  --annotations <completed_annotation_csv_path> \
  --reference .data/eval-review/<run_public_id>/review_reference.jsonl
```

Draft imports make no provider request and do not modify live run outputs. They
must be reviewed in the teacher UI before they count toward human annotation
completion. Batch confirmation requires the teacher_researcher to type:

```text
I reviewed the imported annotation decisions and accept them as my confirmed evaluation judgments.
```

After confirmation, canary readiness uses confirmed human judgments for
annotation pass rates and human critical-failure gates. Automated flags remain
visible as automated screening findings and disagreement context.

The import step validates CSV/reference structure and one-to-one mapping to the
target run. It does not enforce a fixed pass/fail split, fixed failed-case IDs,
or predetermined per-agent pass rates. Pass/fail totals and per-agent rates are
reported as calculated results, so a legitimate 25-pass/0-fail review can be
imported for a fresh canary when that is the reviewer judgment.

## Execution Rules

Live-provider canary execution:

- uses the server-only OpenAI provider and Responses API
- uses Structured Outputs with the exact agent output schema
- sends no tools, web search, file search, code interpreter, remote MCP, or function calls
- sets `store: false`
- sends each synthetic case as one stateless provider request
- persists only eval records
- never creates operational `agent_calls`, profiles, decisions, follow-up rounds, item verification runs, process events, workflow jobs, sessions, responses, or content changes

The teacher UI can display live-run metadata and results, but it does not contain a paid-run start button, API-key field, or budget-bypass control.

## Structured Outputs Compatibility

Before preflight, dry run, or paid execution can proceed, the canary compiles all
five provider-facing output schemas with the same OpenAI `zodTextFormat` helper
used by the live provider path. This local compatibility check makes no provider
request.

Provider-facing output schemas must compile to a strict root object. Every object
property must be required; logical optionality must be represented as a required
nullable field. Open maps, `z.any`, `z.unknown`, non-strict objects, and root
unions are rejected at the provider boundary.

Nullable semantics used by the current canary schemas include:

- `ItemVerificationFinding.item_public_id=null` only for set-level findings.
- item-level item verification findings must use a known `item_public_id`.
- `ItemVerificationFinding.option_label=null` when the finding is not option-specific.
- option-specific item verification findings must use a known option label for a known item.
- `mapping_deviation_reason=null` when formative planning follows the default mapping.
- `evidence_request=null` when the follow-up output has no explicit evidence request.

If schema construction fails locally, the run item is marked
`structured_output_schema_incompatible`, no provider request is dispatched, and
`provider_request_count` is not incremented. Historical failed runs that counted
a request before this guard remain preserved for audit; inspection treats their
legacy schema-construction messages as non-resumable infrastructure failures and
recommends a fresh run after schema correction.

## Resume

Live canary runs are resumable only by explicit run ID. Completed run items are
skipped. Pending or retryable items may continue according to the retry policy.
Permanent failures remain preserved and are not silently replaced. Completed
runs are never silently reused and cannot be resumed; create a fresh run with
`--new-run`.

Runs with status `budget_unverifiable` are not automatically resumable. If a
provider request was counted but usage was not persisted, the budget guard cannot
verify cost for that request. Use the inspect command and start a fresh canary
run unless a teacher/researcher intentionally performs a documented manual
recovery action outside the automated runner.

Runs with a provider-facing Structured Outputs schema failure are not resumed
under corrected schemas. Preserve the failed run and create a fresh canary run so
prompt versions, schema versions, prompt hashes, and case payload hashes remain
auditable.

## Usage Parsing

The live canary parser accepts the current Responses API usage shape:

```text
usage.input_tokens
usage.output_tokens
usage.total_tokens
usage.input_tokens_details.cached_tokens
usage.output_tokens_details.reasoning_tokens
```

It also accepts the normalized internal provider shape and optional missing
cached/reasoning-token details. If usage is missing or token fields are
malformed, the run pauses as `budget_unverifiable`; the runner does not
fabricate token counts or continue through remaining cases.

## Offline Smoke Tests

```bash
npm run eval:blind-review-export-smoke
npm run eval:blind-review-secret-scan-smoke
npm run eval:annotation-import-smoke
npm run eval:annotation-adjudication-smoke
npm run eval:structured-output-compat-smoke
npm run eval:live-canary-runner-smoke
npm run eval:usage-parser-smoke
npm run eval:budget-smoke
npm run eval:live-isolation-smoke
npm run eval:canary-report-smoke
```

These tests use mock/fake provider paths and make no OpenAI calls.

## Post-Baseline Quality Patch

Do not resume or modify baseline run `evr_20260623_1sjeh1q`. After applying the
quality patch, create a fresh 25-case canary with the same exact snapshot,
reasoning effort, and manifest case IDs unless a case itself is invalid.

The live canary stores two separate identities:

- `run_public_id`: the run instance identity. Every `--new-run` receives a fresh
  run public ID and fresh run items.
- `run_config_hash`: the reproducibility fingerprint. It includes the exact
  model snapshot, reasoning effort, case manifest hash, ordered case IDs, one
  repetition, agent names, agent versions, prompt versions, prompt hashes, schema
  versions, max-output-token values, semantic and safety evaluator versions,
  pricing registry version, retry settings, timeout setting, concurrency
  setting, budget setting, environment config hash, and Git commit.

Multiple fresh runs may share the same `run_config_hash`; that means they used
the same frozen configuration, not that they are the same run. A prompt or
evaluator patch must change the hash relative to earlier runs such as
`evr_20260623_1sjeh1q`.

Before the next preflight and dry run, run:

```bash
npm run eval:targeted-quality-regression-smoke
```

Then use the read-only checks:

```bash
npm run eval:live-canary:preflight
npm run eval:live-canary:dry-run
npm run eval:live-canary:compare-config -- --run evr_20260623_1sjeh1q
```

The readiness report now includes `targeted_regression_gate`, an engineering
gate for the three known human-fail cases. The 100-call pilot remains out of
scope for Phase 7E2A.

## Phase 7E2B Transition

After a fresh canary is approved as `ready_for_full_pilot`, the next step is the
guarded full pilot, not classroom activation. The full pilot uses
`tests/fixtures/evals/live-pilot-manifest.json`, 100 synthetic outputs, and an
approved canary ID supplied at the command line or through
`EVAL_PILOT_APPROVED_CANARY_RUN_ID`.

```bash
npm run eval:live-pilot:preflight -- --approved-canary <run_public_id>
npm run eval:live-pilot:dry-run -- --approved-canary <run_public_id>
npm run eval:live-pilot -- --approved-canary <run_public_id> --confirm-paid-api --new-run
```

The canary run remains unchanged; the pilot creates a separate eval run.
