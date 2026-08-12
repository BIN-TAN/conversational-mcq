# V17 Canonical Misconception Claim Identity

V17 is an inactive runtime candidate that replaces authoritative free-text
misconception identity with platform-assigned indicator and atomic-claim IDs.
Its executable freeze covers the profiling contract and the formative
transition contract, but has not been authorized or executed.

## Identity lifecycle

1. The student profiling agent returns validated semantic atomic claims. It
   does not assign IDs.
2. The platform assigns deterministic IDs scoped to the persisted profile
   state and stores each ID with canonical text and source evidence.
3. Every formative generation receives the same machine-readable allowed claim
   catalog before generation.
4. A terminal recommendation must provide one `resolved` or `retained`
   disposition for every allowed claim ID.
5. The platform derives the resulting misconception state from retained IDs.
   Model-provided free text is not an identity key.
6. Persistence records the prior catalog, dispositions, cited student turns,
   resulting catalog, AgentCall, and append-only transition.

## Compatibility

Existing V17 catalogs are accepted. Empty legacy misconception lists are mapped
to an empty catalog. A nonempty legacy profile without validated atomic claims
fails closed; V16 synthetic records and artifacts remain historical and are not
mutated or migrated.

## Scope and governance

No database migration is required because the existing JSON profile and
transition snapshot fields carry the versioned catalog. Teacher views display
canonical human-readable claim text. Research exports include IDs, text, source
evidence, and claim dispositions.

The candidate package is under
`config/operational-candidates/formative-conversation-host-v5-executable-v17`.
It contains three profiling-contract canaries followed by the eight frozen
formative cases. V16 Cases 5, 6, and 8 are preserved as hash-checked offline
replays in that package; the original V16 run data is not a readiness
dependency.

The package includes one canonical `node --import tsx` launcher path for plan
and live modes, a shared exactly-once dispatch boundary, process-local secret
injection, and preventive artifact scanning. It remains inactive, not approval
eligible, and not activation permitted. A future live run requires committed
source verification and the exact separately supplied authorization text.
