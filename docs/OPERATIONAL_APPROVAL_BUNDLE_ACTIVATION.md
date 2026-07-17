# Operational Approval Bundle Activation

The operational runtime has one approval authority: the active approval bundle
on the persistent disk. A derived approval bundle contains integrity-bound
copies of the approved candidate manifest and approval evidence, the runtime
candidate hash, evaluation protocol hash, source and derived run IDs, human
review evidence, approval timestamp, and the preserved GPT-5.4 rollback
manifest.

The tracked `config/approved-operational-agent-config.json` remains unchanged as
the GPT-5.4 rollback baseline. When a valid derived bundle is active, runtime
verification, guarded readiness, model resolution, extension-role resolution,
student live dispatch, and diagnostics must not fall back to that baseline.

## Activate The Approved GPT-5.6 Bundle

Run this as an explicit operator step from Render Shell after the persistent
approval artifacts are present:

```bash
npm run operational:model-upgrade:activate -- \
  --approval-evidence /app/.data/operational-model-upgrade/derived-evaluations/omude_20260717_c8d79302/approval/approval_evidence.json \
  --approved-manifest /app/.data/operational-model-upgrade/derived-evaluations/omude_20260717_c8d79302/approval/approved-candidate-manifest.json \
  --expected-runtime-hash 8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993 \
  --expected-evaluation-protocol-hash c2f4ae7cf46cb592dd29ef8bb406de52c2dc7cdf86eddeae476bbf4d8dfecc2d \
  --expected-approval-evidence-hash 60968f9a45bee09b6641503f481dcdc88ef283bf27116cb51f3ba3a011ad657b \
  --expected-source-provider-run omur_20260716_cc847973 \
  --expected-derived-evaluation omude_20260717_c8d79302 \
  --confirm "activate approved gpt-5.6 operational candidate v2"
```

The command makes no provider call and does not mutate historical evaluation
artifacts. It verifies the candidate runtime identity, protocol identity,
approval evidence identity, source and derived run IDs, manifest linkage, human
approval, rollback binding, and copied-file hashes before atomically replacing
the active pointer.

The active pointer is:

```text
/app/.data/operational-model-upgrade/active-approval/active-approval-bundle.json
```

The command prints the exact immutable manifest and evidence copy paths. Apply
the printed values in Render. The required non-secret variables are:

```text
OPERATIONAL_APPROVED_CONFIG_HASH=8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993
OPERATIONAL_APPROVAL_BUNDLE_PATH=/app/.data/operational-model-upgrade/active-approval/active-approval-bundle.json
OPERATIONAL_APPROVED_MANIFEST_PATH=/app/.data/operational-model-upgrade/active-approval/artifacts/8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993-60968f9a45be/approved-candidate-manifest.json
OPERATIONAL_APPROVAL_EVIDENCE_PATH=/app/.data/operational-model-upgrade/active-approval/artifacts/8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993-60968f9a45be/approval_evidence.json
OPERATIONAL_AGENT_MODE=guarded_live
LLM_PROVIDER=openai
LLM_LIVE_CALLS_ENABLED=true
OPERATIONAL_EFFECTIVE_RESULT_VERSION=effective-system-eval-v2
OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION=effective-validator-v1
```

`OPENAI_API_KEY` remains a server-side secret and must be configured separately.
Role model, reasoning, token, live-toggle, timeout, and dialogue-policy variables
are optional deployment assertions. If any are set, they must exactly match the
active bundle. The activation output prints every accepted assertion value.
Unset role variables resolve from the approved manifest; extension roles never
inherit another role's environment variables.

## Verify Deployment

After updating Render variables and redeploying, run:

```bash
npm run operational:approval-manifest:verify
npm run operational:agents:preflight
npm run operational:guarded-integration-status
```

The verifier must report the runtime hash above and 17 compatible roles. The
preflight must contain no GPT-5.4 role resolution. Guarded status must report
`evaluation_evidence_source=derived_approval_bundle`, evidence found, and no
blocking reasons. Database, credential, usage, and worker readiness still fail
closed independently.

## Roll Back

Rollback switches the active pointer to the preserved baseline; it does not
delete the GPT-5.6 manifest, approval evidence, or pointer history.

```bash
npm run operational:model-upgrade:rollback -- \
  --expected-current-runtime-hash 8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993 \
  --expected-rollback-hash 58219c34888076486db21c723a99ac4f4dfa5c29ce78dd162cadbc0566ce9ea2 \
  --confirm "rollback to approved gpt-5.4 baseline"
```

Then set `OPERATIONAL_APPROVED_CONFIG_HASH` to the printed rollback hash, keep
`OPERATIONAL_APPROVAL_BUNDLE_PATH`, unset
`OPERATIONAL_APPROVED_MANIFEST_PATH` and
`OPERATIONAL_APPROVAL_EVIDENCE_PATH`, restore the prior GPT-5.4 environment
assertions if used, redeploy, and run the three verification commands again.

## Architecture Boundary

The active bundle changes control-plane authorization and model resolution
only. GPT-5.6 remains the normal generator for diagnosis, feedback, activities,
dialogue, and teacher recommendations. Deterministic code remains limited to
state, immutable facts, permissions, safety and schema boundaries, logging,
usage controls, answer-key protection, and minimal provider-failure fallback.
