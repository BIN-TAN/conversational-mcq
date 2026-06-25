# Operational Live Canary Recovery

Phase 8C recovery is conservative and explicit.

## Read-Only Commands

Use read-only forensics first:

```bash
npm run operational:live-canary:forensics -- --run <run_public_id>
npm run operational:live-canary:reconcile -- --run <run_public_id>
```

These commands do not mutate runs, steps, dispatch attempts, annotations, or
classroom records.

## Safe Resume Rules

Resume is allowed only when reconciliation finds:

- no `unknown_legacy_provenance`
- no `unknown_after_dispatch`
- no unverified usage
- no duplicate dispatch risk
- no stale active lease
- at least one pending step
- the run is not completed or terminal failed

If any condition fails, the runner must not redispatch.

## Explicit Recovery

Mutation requires:

```bash
npm run operational:live-canary:recover -- --run <run_public_id> --confirm-recovery
```

Recovery never fabricates provider IDs, token counts, or cost. It only moves
recoverable pre-dispatch running rows back to pending. It must not be used to
alter completed historical runs or backfill legacy provenance.

## Historical Runs

The historical runs:

```text
olcr_20260625_fgdjkha
olcr_20260625_yzrceiu
olcr_20260625_4uiz0nc
```

must remain preserved. If they lack dispatch ledger rows, the correct
classification is `unknown_legacy_provenance` or blocked pre-dispatch,
depending on the stored evidence. They should not be reset, cleaned, rewritten,
or backfilled.
