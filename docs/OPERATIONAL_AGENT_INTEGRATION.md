# Guarded Operational Agent Integration

Phase 8A connects evaluated agent infrastructure to local operational workflow
boundaries behind a default-off gate. It does not authorize classroom use and
does not enable live OpenAI calls.

## Approved Evidence

The Phase 8A guard records this approved engineering evidence:

- targeted run: `evr_20260624_bltzgtq`
- raw model review: 20 Pass / 2 Fail
- `effective-system-eval-v1`: 20 Pass / 2 Fail
- `effective-system-eval-v2`: 22 Pass / 0 Fail
- v2 critical failures: 0
- final recommendation: `ready_for_guarded_integration_patch`
- `classroom_validity=false`
- `human_review_pending=true`

This is provisional engineering readiness only. It is not classroom validation.

## Feature Gate

Default local configuration:

```text
OPERATIONAL_AGENT_INTEGRATION_ENABLED=false
OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED=true
OPERATIONAL_AGENT_INTEGRATION_APPROVED_TARGETED_RUN_ID=evr_20260624_bltzgtq
LLM_PROVIDER=mock
LLM_LIVE_CALLS_ENABLED=false
```

When the gate is disabled:

- automatic profiling/planning/follow-up startup jobs are not enqueued
- queued automatic agent workflow jobs are blocked before agent execution
- automatic follow-up evidence updates become teacher-review-required
- Response Collection Agent execution in student initial chat falls back to the
  deterministic response-collection fallback
- no operational OpenAI calls are possible from this gate

Existing teacher review pages remain available for inspection. Agent-backed
workflow actions that enqueue guarded jobs require the Phase 8A gate to allow
local mock-mode execution.

## Mock-Only Local Testing

For synthetic local smoke tests only, the gate may be enabled with live calls
still disabled:

```text
OPERATIONAL_AGENT_INTEGRATION_ENABLED=true
OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED=false
LLM_PROVIDER=mock
LLM_LIVE_CALLS_ENABLED=false
```

`OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED=false` is for synthetic
smoke fixtures that do not create the real targeted eval run. Do not use that as
classroom evidence.

For a local database that contains the approved targeted run, verify readiness
without provider calls:

```bash
npm run operational:guarded-integration-status -- --check-eval
```

Run the Phase 8A smoke:

```bash
npm run operational:guarded-integration-smoke
```

The smoke uses synthetic fixtures, mock provider configuration, and no OpenAI
network call.

## Live-Call Boundary

Phase 8A explicitly blocks guarded operational integration when classroom live
calls are configured:

```text
LLM_PROVIDER=openai
LLM_LIVE_CALLS_ENABLED=true
```

Evaluation live-call settings remain separate from classroom workflow settings.
No browser form accepts API keys, and frontend code must never receive provider
secrets.

## Prompt And Schema Boundary

The guard verifies active prompt and schema versions against the evaluated
configuration:

- `item_verification_agent`: `item-verification-v4`, `item-verification-output-v2`
- `response_collection_agent`: `response-collection-v5`, `response-collection-output-v3`
- `student_profiling_agent`: `student-profiling-v3`, `student-profile-output-v2`
- `formative_value_and_planning_agent`: `formative-planning-v2`, `formative-planning-output-v1`
- `followup_agent`: `followup-v6`, `followup-output-v4`

Changing active prompts or provider schemas requires new evaluation evidence
before guarded integration can be considered again.
