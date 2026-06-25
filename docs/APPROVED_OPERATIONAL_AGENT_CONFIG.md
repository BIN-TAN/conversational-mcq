# Approved Operational Agent Config

The Phase 8A approved operational manifest is:

```text
config/approved-operational-agent-config.json
```

It freezes the exact model snapshot, reasoning effort, agent versions, prompt versions and hashes, schema versions, output-token limits, validator versions, deterministic guard versions, canonicalization versions, fallback versions, evaluation evidence, and configuration hashes approved for guarded operational integration.

## Approved Runtime

- model snapshot: `gpt-5.4-mini-2026-03-17`
- reasoning effort: `low`
- effective result version: `effective-system-eval-v2`
- effective validator version: `effective-validator-v1`
- recommendation: `ready_for_guarded_integration_patch`
- classroom validity: `false`
- human review pending: `true`

This is provisional engineering readiness. It is not classroom validation.

## Verification

Run:

```bash
npm run operational:approval-manifest:verify
npm run operational:agents:preflight
```

The verification command compares the manifest against the active code registry. A mismatch blocks guarded-live execution. The preflight command reports the active and approved hashes, mode, provider state, database readiness, worker readiness, and sanitized blocking reasons without making a provider request or printing secrets.

## Configuration Hash

`OPERATIONAL_APPROVED_CONFIG_HASH` must match the manifest's approved active configuration hash before guarded live can run. Configuration changes to prompts, provider schemas, model snapshot, validators, canonicalizers, deterministic guards, or fallbacks require new evaluation evidence and a manifest update.

