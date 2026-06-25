# Operational Agent Integration

Phase 8A completes guarded operational wiring for the five active agents behind a fail-closed feature gate. The prior default-off outer guard is preserved, but the operational executor now supports explicit modes, manifest verification, deterministic fallbacks, and immutable effective-result audit records.

## Evidence Boundary

Approved engineering evidence:

- canary run: `evr_20260623_trzkizm`
- full pilot run: `evr_20260623_ga6kzai`
- targeted run: `evr_20260624_bltzgtq`
- raw model review: 20 Pass / 2 Fail
- `effective-system-eval-v1`: 20 Pass / 2 Fail
- `effective-system-eval-v2`: 22 Pass / 0 Fail, 0 critical failures
- recommendation: `ready_for_guarded_integration_patch`
- `classroom_validity=false`
- `human_review_pending=true`

This is provisional engineering readiness only. It is not classroom validation.

## Operational Modes

`OPERATIONAL_AGENT_MODE` is authoritative:

```text
disabled
mock
guarded_live
```

Default mode is `disabled`. The older `OPERATIONAL_AGENT_INTEGRATION_ENABLED` flag is a deprecated alias. If both variables are set inconsistently, readiness fails closed.

In `disabled`, no provider request is made and deterministic behavior or fallback is used. In `mock`, tests and development paths may use injected mock providers. In `guarded_live`, provider execution is allowed only after exact manifest, configuration, usage, database, and live-call readiness checks pass.

## Approved Configuration

The approved manifest is `config/approved-operational-agent-config.json`. It freezes:

- exact model snapshot `gpt-5.4-mini-2026-03-17`
- reasoning effort `low`
- prompt versions and hashes
- schema versions
- max output token limits
- semantic and safety validator versions
- effective-result and effective-validator versions
- deterministic guard, canonicalization, and fallback versions
- canary, pilot, and targeted evaluation evidence
- active configuration hash

Run:

```bash
npm run operational:approval-manifest:verify
npm run operational:agents:preflight
```

The commands make no provider calls and print no secrets.

## Effective Result Rule

Operational services must consume only effective results. The effective result is produced after raw structured output validation, semantic and safety validation, deterministic guards, backend canonicalization, deterministic fallback where needed, and effective validation.

Raw provider output remains in `agent_calls`. The operational result is stored in `operational_agent_effective_results` with public IDs, status metadata, version metadata, sanitized warnings, and an effective result hash.

## Agent Boundaries

- Response Collection captures exact reasoning substrings only, refuses hints/correctness/explanations, and keeps option/confidence backend-owned.
- Student Profiling uses allowlisted input and persists a profile only after effective validation; initial fallback is conservative and deterministic.
- Formative Planning derives default mapping on the backend and canonicalizes or falls back before updating active decision pointers.
- Follow-Up preserves saved formative value, applies off-topic and move-on fallbacks, and never lets an agent advance, complete, or select concepts.
- Item Verification combines raw advisory verification with deterministic duplicate detection and never rewrites or generates items.

## Non-Intervention

Automatic workflow remains asynchronous and student-led. The system does not require an online teacher to progress, does not add teacher approval for next concepts, and keeps save/exit/resume available. Release and close dates block new starts only; existing sessions can resume according to the existing session rules.

## Verification

Phase 8A smoke commands:

```bash
npm run operational:guarded-integration-smoke
npm run operational:approval-manifest-smoke
npm run operational:agent-execution-smoke
npm run operational:workflow-integration-smoke
npm run operational:fallback-smoke
npm run operational:idempotency-smoke
npm run operational:student-payload-smoke
npm run operational:teacher-audit-smoke
npm run operational:nonintervention-smoke
npm run operational:isolation-smoke
```

They run in disabled or injected-mock mode and must not make OpenAI calls.
