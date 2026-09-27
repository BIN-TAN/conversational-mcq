# Initial feedback budget and instructional evidence boundaries

**Status clarification:** This describes the earlier proposed class-wide 10,000
amendment, not proof that it became active. The subsequent authorized scope is
one student/test at 30,000, with other role-wide budgets unchanged. See
`PROFILING_APPROVAL_REPAIR_2026-09-27.md` and the verified deployment ledger.

## Observed problem

Synthetic live-provider checks completed a three-item initial package with a
3,000-output-token ceiling, but a 12-item package exhausted that ceiling. Both
sizes completed with a 10,000 ceiling. This is evidence of a capacity problem,
not proof that every failed preparation had the same cause. The retained canary
metadata, limitations, and source evidence are in
`acceptance/runs/2026-09-26/post-deployment-simulation/`.

## Changes

- Only the initial feedback/planning output allowance increases to 10,000.
  Model, reasoning effort, validators, and all other role settings remain intact.
- Incomplete provider output retains a safe reason in `agent_calls.incomplete_reason`, failure diagnostics and,
  when raw output is absent, in `raw_output.provider_failure.incomplete_reason`.
  Known reasons are `max_output_tokens` and `content_filter`; other reasons are
  recorded as `unspecified`. No incomplete response becomes student feedback.
- Conversation host v7.9 explicitly separates illustrative individual score
  agreement from population reliability evidence. Teaching examples must not
  imply that one illustration estimates reliability, proves causality, or proves
  generalized learning. Existing validation and teacher review remain necessary.
- Prior host versions remain readable. Confidence is not remeasured merely
  because a student later answers correctly. Historical records are not rewritten.

## Controlled production amendment

Production uses an immutable approved runtime bundle. An environment-only token
change is rejected. The budget amendment is a separately authorized scope, not a
new claim of full human semantic validation. It verifies the original approval,
its file hashes, the same-model canary evidence, and an exact manifest difference:
only `formative_value_and_planning_agent.max_output_tokens` may change from 3,000
to 10,000. Other changes, absent authorization, altered evidence, and invented
new semantic-review assertions are rejected. Original artifacts remain intact.

`prisma/operational-planning-budget-amend.ts` requires an expected parent hash,
an operator authorization reference, a new output directory, and the explicit
confirmation `approve initial feedback budget 10000`. It stages a new bundle and
prints four non-secret Render settings; it does not switch the running service.
Apply those exact settings only after authorization, then redeploy and verify the
resolved runtime allowance, application revision, readiness, and worker.

Budget-only approval inherits earlier semantic approval; the full earlier model
evaluation was not repeated. The two live budget canaries are not a capacity or
psychometric guarantee. A higher ceiling can increase cost and latency. No
student attempt is automatically deleted, renumbered, or reset by this release.
Any technical recovery must be separately authorized and audited with saved
responses and response packages preserved.
