# E2A.29a Provider Infrastructure Reconciliation

## Scope

E2A.29a is a deterministic, no-provider correction to failure classification,
transport retry policy, attempt tracing, and semantic-effect idempotency. It
does not rerun E2A.29 and does not execute E2A.30.

The authoritative E2A.29 run remains:

- run: `e2a29_20260722120813_3fd136e6`
- stored status: `e2a29_canary_failed_evidence_accuracy`
- immutable failure reason:
  `e2a29_provider_call_failed:evidence_evaluator:provider_5xx`

E2A.29a does not rewrite that historical classification. Its separate derived
diagnosis is:

`e2a29_historical_failure_caused_by_provider_infrastructure_5xx`

## Exact causal boundary

E2A.29 completed one student-simulator call, appended the resulting student
message to the complete visible history, and dispatched the first evidence
evaluator call. The evaluator adapter received HTTP 520 on adapter attempt 1.
No evaluator output, profile, sound-gate decision, tutor call, or progression
decision existed after that failure.

The evidence-accuracy, semantic-envelope, structured-contradiction, profile,
sound-gate, tutor, pedagogy, and progression metrics are therefore not
applicable. The derived applicability artifact records the reason as
`provider_infrastructure_failure_before_evidence_evaluation`.

## Failure taxonomy

`provider-failure-taxonomy-v1` separates:

- retryable provider infrastructure and transport failures;
- nonretryable authentication, authorization, quota, model, and request
  contract failures;
- received model results that fail schema, safety, or evidence validation;
- internal persistence and orchestration failures.

HTTP 520 is retryable unless immutable evidence proves that the request itself
was defective. A provider 5xx response cannot be classified as evidence
accuracy, pedagogical adaptation, safety, or candidate-quality failure.

## Transport retries

`bounded-provider-transport-retry-v1` permits at most three adapter attempts
per logical generation call: the initial attempt and two transport retries.
SDK-managed retries remain disabled. Retry backoff is deterministic at 2,000 ms
and 8,000 ms, without jitter, and provider concurrency remains one.

All transport attempts retain the same logical call ID, canonical request
hash, source binding hash, logical idempotency key, model, and output contract.
Each adapter attempt receives a distinct adapter-attempt ID and
`X-Client-Request-Id`. Budget and source-currentness checks run before every
retry. No model substitution, schema substitution, deterministic
student-facing fallback, or state progression is allowed on transport failure.

## Semantic regeneration

Transport retries and semantic regenerations are different controls. A
transport retry resends the same canonical request after a retryable
infrastructure failure. Semantic regeneration is available only after a
provider response is received but fails schema, hard safety, evidence, or
semantic validation. Neither counter increments the other.

## Exactly-once effects

`exactly-once-semantic-effects-policy-v1` accepts at most one valid provider
result for a logical call. Profile, tutor, persistence, display, and progression
effects may commit only after that accepted result. Replayed identical results
are reused; conflicting duplicate successes fail closed.

## E2A.29 counterfactual

The no-provider counterfactual retains the historical first evaluator attempt
as HTTP 520. Under the corrected policy it would be eligible for one retry
after 2,000 ms, then at most one further retry after 8,000 ms. The workflow
could continue only if a bounded retry returned a valid accepted result.
E2A.29a fabricates no retry response and makes no claim that E2A.29 would pass.

## E2A.30 preparation

E2A.30 is frozen but not authorized or executed. Its held-out domain is thermal
physics: metal can feel colder than wood at the same room temperature because
metal transfers thermal energy away from skin faster. The sensation does not,
by itself, establish a lower object temperature.

The six student turns cover eight checkpoints: initial misconception, copied
wording, partial improvement, correct transfer mechanism plus an explicit
wrong temperature conclusion, an evaluator-created structured contradiction,
clarification, independent rejection, and immediate revision.

Normal call arithmetic remains 17 logical generation calls: six simulator,
six evaluator, and five tutor calls. Maximum limits remain 29 logical calls,
87 adapter attempts, 900,000 input tokens, 70,000 output tokens, 970,000 total
tokens, USD 25 when pricing is available, and provider concurrency one.

E2A.30 requires separate explicit authorization before any provider dispatch.

## Commands

```bash
npm run eval:formative:e2a29a:run
npm run eval:formative:e2a29a:report
npm run eval:formative:e2a29a:audit
npm run eval:formative:e2a29a:smoke
```

Artifacts are written under
`.data/e2a29a-provider-infrastructure-reconciliation/<run_id>/`. There is
intentionally no E2A.30 live command in this phase.
