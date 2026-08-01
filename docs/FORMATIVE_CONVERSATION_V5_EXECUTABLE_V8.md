# Formative Conversation Host V5 Executable V8

## Status

V8 is an inactive, no-provider successor to the immutable failed V7
evaluation. It has not been executed live. It remains approval-ineligible and
activation-forbidden and requires separate exact authorization.

V7 remains `completed_failed`, immutable, and non-rerunnable:

- source commit: `c0c05b60755ab1b9b293c8e12a2ac5645a952c17`
- runtime candidate: `81a60273d33976409e7450bffa6156e89a62e17e36edb7059e30c44979892356`
- protocol: `620ee46412f8ae4389014905249d8ce8fc1004ff55025ec5255bbd005ab6c68d`
- provider run: `fcv5v7_provider_20260801013024_27f671a7`
- derived evaluation: `fcv5v7_derived_20260801013024_4da7a38f`
- result: 3 passed, 5 failed, 0 invalid, 0 not exercised
- logical calls / attempts / retries: 16 / 16 / 0
- input / output tokens: 116,737 / 15,475

No V7 case was rerun and no V7 artifact was changed.

## V7 Findings

### Cases 3 And 6

Initial-profile persistence used one default five-second interactive
transaction for profile creation, concept-session updates, ownership reads,
conversation creation, lifecycle-event work, and telemetry-counter work. The
transaction expired before the conversation committed. Neither case reached a
provider call, and rollback left no partial conversation or AgentCall.

### Cases 5, 7, And 8

Provider calls ran outside Prisma transactions. Valid tutor turns and AgentCall
records persisted. A later transition transaction performed prerequisite
reads, canonical validation, profile creation, transition and evidence writes,
session updates, review-signal writes, and final projection. That transaction
expired before commit, so no partial transition remained.

- Case 5 produced a valid `largely_improved_understanding` recommendation.
- Case 7 produced a valid `teacher_assistance_recommended` recommendation.
- Case 8 produced a valid `largely_improved_understanding` recommendation.

The evaluation entrypoint owned the Prisma client and disconnected only after
the run settled. No nested disconnect or unawaited persistence was found. The
closed-connection diagnostics followed expired remote transactions rather
than premature client shutdown.

### Case 5 Oracle

Case 5's student independently corrected and transferred the
reliability-validity distinction but did not demonstrate the unresolved
standard-error-of-measurement distinction. Requiring exactly `sound` rewarded
overclaiming. V8 permits `continue_conversation` or
`largely_improved_understanding` for that frozen evidence. A separate offline
turn containing valid SEM evidence proves that `sound_understanding` persists
when the complete evidence is present.

### Human Review

All 16 V7 student-visible outputs were reviewed. They were conceptually
appropriate, conversational, adaptive, free of excessive praise and
unjustified mastery claims, compatible with the supported Markdown surface,
and free of privacy or unadministered-answer leakage. Cases 3 and 6 generated
no output, so V7 did not exercise the direct-answer case. No teaching-prompt
change was warranted by V7.

## V8 Corrections

- Provider execution has an explicit persistence-free boundary.
- Initial profile and conversation creation use a reduced bounded write
  transaction and trusted in-transaction ownership data.
- Transition reads and canonical validation occur before a short write
  transaction; the final projection is read after commit.
- Transition writes claim the current profile and concurrency version before
  mutation.
- The evaluation entrypoint is the explicit sole Prisma-client lifecycle owner.
- Synthetic protocol cleanup uses its unique run-ID prefix and removes custom
  protocol fixtures before subsequent export tests.
- Persistence failures retain safe typed category, operation, cause code, and
  retryability metadata.

Typed categories are `conversation_creation_failed`, `transaction_expired`,
`database_connection_closed`, `transition_persistence_failed`,
`lifecycle_persistence_failed`, `evidence_reference_persistence_failed`, and
`finalization_failed`.

## Identities

- runtime candidate: `132d69caab27b6e94f8bfa416c89d843da97676f41dcefb11c0e03ec95d3af80`
- prompt: `b63e10469e071918e29c8bd9ba5c101908302b39c82917d052e81e547d98ef64`
- evaluation protocol: `6359d96e27ed727e0eb1797f621bb08b4e6877f8065f5d6d7be6492a1d8eac15`
- runner implementation: `2426fd1edab546eadfee3c81263a317d50250317623ea3c06917b7b1275918e1`
- candidate manifest: `a0a0a63485cae20885b8e9d4d0468302ecdc6bac13403afe9ad82aed0d030f64`
- fixture manifest: `1685fbabd1530adf3dcd7174e775ee0c50ddbcaf13b2c62b752e924f08a98b40`
- aggregate fixtures: `0f36e10c34bd3c59fea33f2c9e46e032c954106a7ab9fba08b625e771d34c345`
- compiled plan: `ae5a3784df302aae5a2b285e1bcda84c711bf645cdb9eb777bbb1e036aa96dcd`
- live environment contract: `30ff9294f85a4831214ffbf40a261a1909c1e07bfa8bbed669b9519e76e1efa4`
- no-provider plan artifact: `e4900ecc3a81e008327c2eb9a4d19e527a1b31964e08743501b314fa32ec78a2`

The prompt remains `formative-conversation-host-v5.2`; its text did not
change. The runtime candidate changed because production persistence and
database-lifecycle fingerprints changed. The active approved hash remains
`8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993`.
The rollback hash remains
`58219c34888076486db21c723a99ac4f4dfa5c29ce78dd162cadbc0566ce9ea2`.

## Offline Verification

An isolated local PostgreSQL database was created, all 60 migrations were
applied, and the database was dropped after testing. Classroom and Render data
were not used.

The suite verified:

- Cases 3 and 6 conversation creation and lifecycle persistence;
- exact stored V7 Case 5, 7, and 8 output replay;
- largely improved, teacher assistance, and sound transition persistence;
- canonical field disposition, provenance, evidence references, and
  idempotency;
- teacher and research-export transition parity;
- 10-, 60-, and 90-second virtual provider waits with no open transaction;
- one entrypoint-owned disconnect after persistence, export, and cleanup;
- research-export integrity and formative runtime compatibility;
- no activity-runtime or topic-dialogue contamination.

The exact plan launcher wrote:

`/Users/binbin/Documents/Conversational MCQ/.data/operational-formative-conversation-v5-evaluation-v8/plans/fcv5_plan_20260801073900_0eb07d21.json`

It stopped at `ready_immediately_before_dispatch_checkpoint` with all eight
cases executable, 21 planned logical calls, zero provider calls, zero
model-auth requests, and zero dispatch checkpoints.

## Frozen Budget

- exactly 8 cases in committed order
- logical calls: expected and maximum 21
- provider attempts: expected 21, maximum 63
- transport retries: maximum 2 per logical call
- input tokens: maximum 900,000
- output tokens: maximum 73,500
- total tokens: maximum 973,500
- wall time: maximum 7,200,000 ms
- concurrency: 1
- cost ceiling: USD 30

Selective execution and selective reruns are forbidden.

## Future Authorization

Required exact authorization:

```text
I authorize one live execution of formative-conversation-host-v5-executable-v8 for runtime candidate hash 132d69caab27b6e94f8bfa416c89d843da97676f41dcefb11c0e03ec95d3af80 and evaluation protocol hash 6359d96e27ed727e0eb1797f621bb08b4e6877f8065f5d6d7be6492a1d8eac15, using exactly 8 isolated synthetic cases with at most 21 logical calls, 63 provider attempts, 900000 input tokens, 73500 output tokens, 973500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling.
```

Future live command after separate exact authorization and secure process-local
environment injection:

```bash
npm run operational:formative-conversation-v5-v8-evaluate -- --mode=live --runtime-candidate-hash 132d69caab27b6e94f8bfa416c89d843da97676f41dcefb11c0e03ec95d3af80 --evaluation-protocol-hash 6359d96e27ed727e0eb1797f621bb08b4e6877f8065f5d6d7be6492a1d8eac15 --confirm-live-provider-calls --authorization "I authorize one live execution of formative-conversation-host-v5-executable-v8 for runtime candidate hash 132d69caab27b6e94f8bfa416c89d843da97676f41dcefb11c0e03ec95d3af80 and evaluation protocol hash 6359d96e27ed727e0eb1797f621bb08b4e6877f8065f5d6d7be6492a1d8eac15, using exactly 8 isolated synthetic cases with at most 21 logical calls, 63 provider attempts, 900000 input tokens, 73500 output tokens, 973500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling."
```

Authorization alone does not approve or activate the candidate.
