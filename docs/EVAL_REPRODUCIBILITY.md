# Evaluation Reproducibility

Each Phase 7E2A live canary run stores a reproducibility manifest in eval tables.

## Run Identity

Phase 7E2A separates run-instance identity from run-configuration identity:

- `run_public_id` identifies one concrete run instance.
- `run_config_hash` identifies the frozen canary configuration used by that run.

`npm run eval:live-canary -- --confirm-paid-api --new-run` always creates a new
run instance with a new `run_public_id` and new run items. It must never return
an already completed run. Two fresh runs may have the same `run_config_hash` if
they intentionally use the same frozen configuration.

`npm run eval:live-canary -- --confirm-paid-api --resume <run_public_id>`
resumes only the specified nonterminal run. Resume is blocked for completed runs,
budget-unverifiable runs, Structured Outputs schema infrastructure failures, and
runs whose frozen configuration differs from the current canary configuration.

## Frozen Fields

Once a run is created, it freezes:

- run public ID
- run mode
- exact model snapshot
- reasoning effort
- agent order
- case IDs
- case manifest hash
- case payload hash per item
- prompt versions
- schema versions
- prompt hashes
- agent versions
- OpenAI SDK version
- application Git commit
- evaluation configuration hash
- environment configuration hash
- full run configuration fingerprint
- max output token settings
- retry settings
- request timeout
- concurrency
- pricing registry version
- budget limit
- creation time

Prompt, schema, case, model, and budget changes require a new eval run. Failed quality cases should not be selectively rerun under the same canary run after prompt tuning.

The run configuration fingerprint includes:

- exact model snapshot
- reasoning effort
- case manifest hash and manifest version
- exact ordered case IDs and input payload hashes
- repetition count
- agent names and agent versions
- prompt versions and prompt hashes
- schema versions
- per-agent max-output-token values
- semantic-validator version
- safety-validator version
- pricing-registry version
- retry settings
- timeout setting
- concurrency setting
- budget setting
- environment configuration hash
- application Git commit

The baseline run `evr_20260623_1sjeh1q` predates the quality patch and remains
preserved unchanged. The current quality-patch canary configuration must produce
a different `run_config_hash` from that baseline because prompt and evaluator
metadata changed.

## Manifest

The stable canary manifest is:

```text
tests/fixtures/evals/live-canary-manifest.json
```

It contains exactly 25 synthetic case IDs: five per active agent. The runner validates this manifest before dry run or paid execution.

## Export

Eval CSV export includes:

- model snapshot
- reasoning effort
- max output tokens
- provider response/request IDs
- retry count
- token fields
- estimated cost
- automated and human critical failure flags
- annotation source and annotation status
- canary gate status
- case manifest hash
- run config hash
- Git commit

Secrets and internal database UUIDs are not exported.

Annotation adjudication preserves provenance. AI-assisted preliminary imports
remain marked as `ai_assisted_preliminary`; confirmation changes status from
`draft` to `confirmed` and records the confirming teacher and timestamp. The
readiness report preserves automated screening flags, confirmed human critical
flags, human failed case IDs, and auto-human disagreement counts as distinct
fields.

Confirmed annotation amendments are separate administrative events. They require
explicit researcher instruction and are recorded in `eval_annotation_revisions`
with the previous and new annotation snapshots. Amendments preserve original
confirmation provenance and do not rewrite model outputs, automated semantic
results, automated safety results, or automated critical flags. Removing a human
critical-failure flag does not change the human pass/fail judgment.

The Phase 7E2A quality patch preserves baseline run `evr_20260623_1sjeh1q`
unchanged. Fresh canaries after the patch must record the new prompt versions,
prompt hashes, semantic evaluator version `eval-semantic-v2`, safety evaluator
version `eval-safety-v2`, and the `known-failure regression gate` result.

Read-only comparison command:

```bash
npm run eval:live-canary:compare-config -- --run evr_20260623_1sjeh1q
```

The comparison command reports current-versus-stored differences without making
a provider request and without modifying the compared run or annotations.

## Phase 7E2B Pilot Reproducibility

Full pilot runs freeze:

- approved canary run public ID
- pilot manifest version and hash
- internal-holdout and replication case IDs
- paired case keys and case payload hashes
- exact model snapshot and low reasoning effort
- current agent configuration hash
- prompt versions, schema versions, prompt hashes, and agent versions
- pricing version, budget, retry, timeout, concurrency, and request limits
- application Git commit

Resume is allowed only for a nonterminal pilot run with matching frozen
configuration. Completed pilot items are skipped on resume.

## Phase 7E2C Targeted Remediation Reproducibility

Targeted remediation runs freeze:

- baseline full-pilot public ID `evr_20260623_ga6kzai`
- targeted manifest version and hash
- six affected case IDs and five control case IDs
- two repetitions per case and deterministic run order
- case payload hashes
- exact model snapshot `gpt-5.4-mini-2026-03-17`
- low reasoning effort
- prompt versions, prompt hashes, schema versions, and agent versions
- evaluator versions `eval-semantic-v3` and `eval-safety-v3`
- deterministic duplicate normalizer version
- pricing version, USD 10 budget, request limit 35, retry limit 1, timeout, and concurrency 1
- application Git commit

The run requires explicit `--new-run` or `--resume <run_public_id>`. Completed
runs are not silently reused. Completed run items are skipped on resume, and the
runner must not read or mutate operational classroom records.

## Phase 7E2C AI Review Provenance

AI-agent blind review confirmation is stored separately from human confirmation.
For each AI-confirmed annotation, the system stores reviewer model, review
method, reviewed timestamp, annotation CSV hash, reference JSONL hash, source
run public ID, and import command version.

AI-confirmed annotations use:

- `annotation_source=ai_agent_review`
- `annotation_status=ai_confirmed`
- `review_target=raw_model_output` or `effective_system_output`
- `review_artifact_version=raw-model-output`, `effective-system-eval-v1`, or
  `effective-system-eval-v2`
- `confirmed_by_user_db_id=null`
- `confirmed_at=null`

The confirmation command writes `eval_annotation_revisions` records for created
or promoted annotations. Re-running the same command with the same files is
idempotent and does not create duplicate revisions. Later human review can
supersede AI-confirmed annotations; that human supersession creates another
revision and preserves the original AI-review snapshot.

## Phase 7E2C Effective-System Artifact Reproducibility

Effective-system evaluation derives a versioned artifact from each eval run item
without modifying raw provider output:

- `effective_result_version=effective-system-eval-v2` for the current corrected
  effective-system layer
- raw output status and raw semantic status
- deterministic guard flags and versions
- canonicalization flags and versions
- fallback flags and versions
- effective student-facing message
- effective workflow actions
- effective process events
- effective structured result
- deterministic `effective_result_hash`

The artifact is eval-only evidence. It must not create operational agent calls,
student profiles, formative decisions, follow-up rounds, process events, item
verification runs, workflow jobs, sessions, responses, content changes, roster
changes, account changes, or exports.

`effective-system-eval-v1` remains reproducible for audit. For
`evr_20260624_bltzgtq`, v1 has a stored 20 Pass / 2 Fail AI review; both Fail
judgments are `fua_move_on_offer_010`. `effective-system-eval-v2` corrects the
deterministic move-on fallback only. Its artifact hash includes the artifact
version and fallback version (`followup-move-on-fallback-v2`), so v1 review
judgments must not be applied to v2 artifacts.

Effective blind review packets for v2 are written under
`.data/eval-review/<run_public_id>/effective-system-v2/` and are not tracked by
Git. V1 can be reproduced under `.data/eval-review/<run_public_id>/effective-system/`
with `--effective-result-version effective-system-eval-v1`.
