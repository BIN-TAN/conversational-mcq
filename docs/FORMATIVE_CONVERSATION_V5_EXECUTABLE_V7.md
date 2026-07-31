# Formative Conversation Host V5 Executable V7

## Status

Executable v7 is a no-provider successor package prepared from the immutable
v6 findings. It has not been run live. It is inactive,
approval-ineligible, activation-forbidden, and requires fresh authorization.

The v6 run remains `completed_failed`, immutable, and non-rerunnable:

- source commit: `c33cb7123b0411e8dbfca6ffd95355a70f3292d0`
- runtime candidate:
  `494ed38226f655c19429e0f54dc78c78239a6492f39895cd5231fc5d22a87f59`
- protocol:
  `8dfc63e32166f9117b4cebef550d22bdc81e1b9f3377f5843d50c2dee679b625`
- provider run: `fcv5v6_provider_20260731032817_863a9cdd`
- derived evaluation: `fcv5v6_derived_20260731032817_0bd6f382`
- result: 5 passed, 3 failed, 0 invalid, 0 not exercised
- logical calls / provider attempts / retries: 21 / 21 / 0
- input / output tokens: 135,845 / 13,336
- wall time: 1,214,797 ms

No v6 case was rerun and no v6 run artifact was rewritten.

## V6 Findings

### Cases 5 And 6

Both calls returned HTTP 200 and complete response bodies of 54,764 and 62,483
bytes. The adapter used `responses.parse().withResponse()`, so SDK Zod parsing
ran before the response could be preserved. Structured parsing failed after
the full body was consumed; the catch path then lacked the response identity
and safe schema issues and classified the result as an unknown transport
failure.

This was a complete-response structured-output boundary defect, not a
zero-body transport failure. A transport retry was correctly not attempted.

V7 uses `responses.create().withResponse()`, records the complete response
first, and then applies local JSON and Zod validation. Invalid structured
output is now a typed `schema_validation` result with safe field paths. A
complete body can never authorize a transport retry.

### Case 7

The model recommended `teacher_assistance_recommended`, but marked three
canonically unchanged fields as `updated_from_conversation_evidence`:

- `ability_profile`
- `integrated_diagnostic_profile`
- `evidence_sufficiency`

The shared transition validator correctly rejected all three with
`profile_transition_updated_field_unchanged`. V7 does not weaken that
validator. Prompt version `formative-conversation-host-v5.2` now states that
an exactly unchanged canonical value must be retained and that an updated
field requires an actual value change supported by student evidence.

### Prisma Lifecycle

The v6 process exited successfully and all 23 artifact hashes, database writes,
research exports, and joins were intact. Eleven closed-connection diagnostics
were emitted during finalization. V7 retains the explicit single disconnect
boundary and does not suppress database failures; the diagnostics remain a
human-review concern.

## Runtime Fingerprints

V7 preserves the model, schema, validators, fixtures, call graph, and
pedagogical autonomy. The evaluated runtime changes are:

- prompt: `formative-conversation-host-v5.2`
- prompt hash:
  `b63e10469e071918e29c8bd9ba5c101908302b39c82917d052e81e547d98ef64`
- OpenAI Responses adapter: `openai-responses-adapter-v4`

The fresh v7 identities are:

- runtime candidate:
  `81a60273d33976409e7450bffa6156e89a62e17e36edb7059e30c44979892356`
- evaluation protocol:
  `620ee46412f8ae4389014905249d8ce8fc1004ff55025ec5255bbd005ab6c68d`
- runner implementation:
  `9445d4fdb49b5f2897177f5bc21aec86d83028c0a8c5a114dd4a52fb9c200af1`
- candidate manifest:
  `46de4b32f933cce42236bbc9ad3c1497970915980b7a775734372a1ee5e2f57c`
- fixture manifest:
  `2b94071eb7794653db511393231449b4e862ef4b4689b7ca89e764eedae49152`
- aggregate fixtures:
  `e6450e0b61afb81ad98cfbcde782b9d148d9a56c3af550e7c4b30b73dde516fc`
- compiled plan:
  `1a72a91e75c3f62bdb23f17c6d98dc425c25af15c3ddaefe9b53a1f27e19ca9a`
- live environment contract:
  `cf684b7fdd16326e28c3af6d17cffdc9d269288952e01d2869c9eb37ecb4271a`

The active approved configuration remains
`8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993`.
The rollback configuration remains
`58219c34888076486db21c723a99ac4f4dfa5c29ce78dd162cadbc0566ce9ea2`.

## Frozen Call Graph And Budget

The eight unchanged cases remain in committed order. Their logical-call counts
are `1, 3, 2, 2, 3, 3, 4, 3`.

- logical calls: exactly 21, maximum 21
- provider attempts: expected 21, maximum 63
- transport retries: maximum 2 per logical call
- input tokens: maximum 900,000
- output tokens: maximum 73,500
- total tokens: maximum 973,500
- wall time: maximum 7,200,000 ms
- concurrency: 1
- cost ceiling: USD 30

Selective execution and selective reruns are forbidden.

## No-Provider Verification

No-provider checks verify:

- complete-response schema failures are typed and non-retryable;
- unchanged-as-updated fields remain invalid;
- unchanged-as-retained fields pass the strict transition contract;
- all eight cases compile to 21 calls;
- v6 checkpoint, run, evaluation, review, analysis, and advisory hashes;
- plan/live launcher and process-local environment parity;
- database and research-export readiness;
- a freshly created, fully migrated local `_live_canary_smoke_e2e` database
  covering all three terminal transition outcomes, canonical field
  disposition, provenance, idempotency, teacher/export parity, research-export
  integrity, selected-session export, and formative runtime behavior;
- inactive candidate and fail-closed approval/activation state;
- zero provider calls and zero provider network requests.

The isolated database is dropped after the gate. Classroom, Render, and the
long-lived development database are not used or mutated by this verification.

The v7 plan must stop at
`ready_immediately_before_dispatch_checkpoint`. No v7 dispatch checkpoint,
provider run, or derived evaluation may exist before a separate authorization.

## Future Authorization

The required authorization text is:

```text
I authorize one live execution of formative-conversation-host-v5-executable-v7 for runtime candidate hash 81a60273d33976409e7450bffa6156e89a62e17e36edb7059e30c44979892356 and evaluation protocol hash 620ee46412f8ae4389014905249d8ce8fc1004ff55025ec5255bbd005ab6c68d, using exactly 8 isolated synthetic cases with at most 21 logical calls, 63 provider attempts, 900000 input tokens, 73500 output tokens, 973500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling.
```

After separate exact authorization and secure process-local environment
injection, the live command is:

```bash
npm run operational:formative-conversation-v5-v7-evaluate -- --mode=live --runtime-candidate-hash 81a60273d33976409e7450bffa6156e89a62e17e36edb7059e30c44979892356 --evaluation-protocol-hash 620ee46412f8ae4389014905249d8ce8fc1004ff55025ec5255bbd005ab6c68d --confirm-live-provider-calls --authorization "I authorize one live execution of formative-conversation-host-v5-executable-v7 for runtime candidate hash 81a60273d33976409e7450bffa6156e89a62e17e36edb7059e30c44979892356 and evaluation protocol hash 620ee46412f8ae4389014905249d8ce8fc1004ff55025ec5255bbd005ab6c68d, using exactly 8 isolated synthetic cases with at most 21 logical calls, 63 provider attempts, 900000 input tokens, 73500 output tokens, 973500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling."
```

The required live flag is
`FORMATIVE_CONVERSATION_V5_V7_LIVE_EVALUATION_ENABLED=true`. Existing active
and rollback bundles remain unchanged. Authorization alone does not approve or
activate the candidate.
