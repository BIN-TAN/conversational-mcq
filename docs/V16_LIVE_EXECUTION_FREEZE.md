# V16 Live Evaluation Freeze

V16 freezes the atomic misconception evidence-closure correction as an
inactive executable evaluation candidate. It inherits the V15 model, prompt,
fixtures, budgets, launcher mechanics, database lifecycle, and security-release
boundary. V15 candidate files and completed evaluation evidence are immutable.

## Runtime Scope

The only runtime change is the terminal profile-transition acceptance boundary:

- changed misconception indicators require claim-level closure;
- every removed atomic claim requires cited student evidence;
- every unresolved atomic claim remains represented as a current misconception;
- limitations and uncertainty are not converted into misconceptions;
- no partial transition is persisted after closure validation fails.

The teaching prompt, formative pedagogy, profile outcomes, privacy behavior,
exports, database schema, and assessment logic are unchanged.

## Frozen Execution Boundary

Plan and live modes use the same outer process-local runner, canonical
`node --import tsx` launcher, TypeScript alias loading, environment projection,
database lifecycle, and evaluation CLI. Bare Node invocation is rejected before
checkpoint creation.

The environment contract validates the canonical service and database identity,
migration readiness, active and rollback approval identities, OpenAI and research
configuration presence, and the distinct inactive V16 runtime and protocol
identities. Secrets may enter only through an owner-only one-use FIFO and are
cleared only after the committed artifact scan and attestation boundary.

Exactly one immutable dispatch checkpoint is permitted immediately before the
first provider generation request. Plan and no-provider verification create no
checkpoint. A protocol cannot be dispatched again after its checkpoint exists.

## Governance

- `approval.eligible`: false
- `activation.permitted`: false
- live execution: not authorized or executed by this freeze task
- future execution: requires a clean committed-source freeze and exact fresh
  authorization matching the materialized runtime and protocol hashes

The generated `LIVE_EXECUTION.md` inside the V16 candidate directory is the
authoritative source for the future authorization text and executable command.
