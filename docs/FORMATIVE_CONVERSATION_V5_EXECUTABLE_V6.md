# Formative Conversation Host V5 Executable V6

## Status

Executable v6 is prepared for a future separately authorized live evaluation.
It has not been run live. It is inactive, approval-ineligible, and cannot be
activated.

The immutable v5 result remains `completed_failed`, inactive,
approval-ineligible, and non-rerunnable:

- frozen commit: `3b55bed5ff20831070c5d5ef1b1902aa77527236`
- runtime candidate: `a408b08c39aa614d967552e1fd321fabf0b83c96a3d83c82a7bd381fa8e899b3`
- protocol: `7b42d2b1ffd3c5cfa1bef52cf60759b6eea7e891327077144d81e7f09788aa4c`
- provider run: `fcv5v5_provider_20260730170219_4ac51142`
- derived evaluation: `fcv5v5_derived_20260730170219_0a1eb734`
- dispatch checkpoint SHA-256:
  `1aceb19602ca99e5b26733a59cc565d2552d0a9f8d243e7a0243fcbd1ccdba4a`

No v5 case was rerun and no v5 artifact was rewritten.

## Root Causes

### Cases 5 and 6

The provider returned successful response headers, then body consumption ended
with zero bytes and no semantic content. The failures occurred at about 41 and
45 seconds, so the 90-second operational timeout was not the direct cause.
Remote provider completion cannot be excluded.

This was a provider transport interruption combined with three harness defects:

- body start, byte count, and EOF completion were not recorded;
- the retry policy treated all post-header failures as non-retryable;
- the evaluation runner could not prove the narrow safe retry boundary.

V6 records body milestones and permits a bounded transport retry only after 2xx
headers when no body started, zero bytes and no semantic content were received,
and no tutor turn or transition was persisted. Partial-body failures and
complete-body persistence failures remain non-retryable.

### Cases 7 and 8

The candidate labeled `process_interpretation_cautions` as retained while
rewriting or appending text. Structural output validation accepted the result,
but persistence used a stricter field-evidence rule and rejected it.

V6 uses one canonical transition validator at agent-output validation, runtime
preparation, persistence, teacher projection, and research export. Retained
fields must preserve their canonical prior value exactly. Any append, rewrite,
replacement, or deletion is an update and must cite supporting student
evidence.

The exact stored Case 7 and Case 8 outputs now fail at the shared output
boundary with a typed reason. They can no longer appear to succeed and then
disappear during persistence.

### Case 8 Rendering

The exact Markdown table is not supported by the safe student renderer and
degrades into literal pipe syntax. V6 keeps the renderer and stored historical
text unchanged, rejects unsupported tables before new tutor text is persisted,
and asks the model to use the already supported safe Markdown subset.

### Case 7 Tone

The final wording is unusually directive but remains accurate, relevant, safe,
and pedagogically defensible. It is an advisory human-review issue, not a
blocking prompt defect. No prompt change was made solely for this stylistic
concern.

### Prisma Lifecycle

The v5 CLI did not explicitly own the singleton Prisma client's final
disconnect. V6 disconnects once after all cases, exports, audits, and artifact
writes finish, including failure paths. Deterministic lifecycle tests found no
lost database writes or artifacts and no successful-finalization connection
noise.

## Runtime Changes

The teaching prompt changed only to constrain student-visible formatting to the
safe renderer's supported subset. Pedagogical autonomy, transition discretion,
and qualitative outcome guidance are unchanged.

Changed fingerprints:

- prompt: `formative-conversation-host-v5.1`
- prompt SHA-256:
  `fd5eca05cd8d0cea050bce9fc0aa7dc6ae3c2ab284d8f963730a591038d1ca31`
- profile transition: `formative-conversation-profile-transition-v4`
- transition validator:
  `formative-conversation-profile-transition-validator-v4`
- student output format:
  `formative-conversation-student-output-format-v1`
- provider failure taxonomy: `provider-failure-taxonomy-v3`
- provider retry policy: `bounded-provider-transport-retry-v2`
- provider tracing: `provider-request-tracing-policy-v3`
- OpenAI Responses adapter: `openai-responses-adapter-v3`

These evaluated runtime changes require a new runtime candidate hash.

## Frozen V6 Identity

- runtime candidate:
  `494ed38226f655c19429e0f54dc78c78239a6492f39895cd5231fc5d22a87f59`
- evaluation protocol:
  `8dfc63e32166f9117b4cebef550d22bdc81e1b9f3377f5843d50c2dee679b625`
- runner implementation:
  `83f47424bf51e236e5143e206cd7a4e2ac5058b37439f5451122527db353bdf2`
- candidate manifest:
  `df37e0105669896bf8d649527622f718cea97fe6b69a1e2b46a8c192b94bb93c`
- fixture manifest:
  `98f61fbd3a776b5a4c3b2e7ee65a01ecc0c67c8842a61219a48e3c00830832e2`
- aggregate fixtures:
  `e6450e0b61afb81ad98cfbcde782b9d148d9a56c3af550e7c4b30b73dde516fc`
- compiled plan:
  `07434ae13df026a468af34a385f11208d5d86a34a2f5b4176c39673974f282b4`
- live environment contract:
  `3cafb8a2d80b7520d2c4c14657b789cac8265da14e4dd8457b5c0de01c33ad9e`

## Frozen Call Graph And Budget

The eight cases remain in their committed order. Per-case logical calls are:

`1, 3, 2, 2, 3, 3, 4, 3`

This is eight opening calls plus thirteen student-message calls:

- logical calls: exactly 21, maximum 21
- provider attempts: expected 21, maximum 63
- transport retries: maximum 2 per logical call
- input tokens: maximum 900,000
- output tokens: maximum 73,500
- total tokens: maximum 973,500
- wall time: maximum 7,200,000 ms
- concurrency: 1
- cost ceiling: USD 30

Selective cases and selective reruns remain forbidden.

## No-Provider Verification

The v6 plan reached
`ready_immediately_before_dispatch_checkpoint` with all eight cases compiled,
zero provider calls, zero model-auth requests, and zero dispatch checkpoints.

Offline verification covered:

- exact immutable Case 7 and Case 8 output rejection at the shared validator;
- deterministic Case 5 `sound` persistence;
- deterministic Case 6 `largely_improved` persistence;
- deterministic Case 7 `teacher_assistance_recommended` persistence;
- deterministic Case 8 mixed-resolved `continue_conversation`;
- idempotent profile replay and teacher/export parity;
- pre-header, zero-body, partial-body, timeout, exhaustion, persistence, and
  duplicate-effect transport boundaries;
- actual safe Markdown rendering of the Case 8 output;
- Prisma cleanup ordering;
- all-eight compilation and plan/live environment parity;
- research export integrity in an isolated migrated database;
- approval architecture and source provenance checks.

The long-lived local development database separately contains a historical
transcript with prohibited `correct option` wording. That existing record was
not changed or deleted. It is not present in the isolated v6 verification
database and remains a historical-data review concern.

## Future Authorization

The required authorization text is:

```text
I authorize one live execution of formative-conversation-host-v5-executable-v6 for runtime candidate hash 494ed38226f655c19429e0f54dc78c78239a6492f39895cd5231fc5d22a87f59 and evaluation protocol hash 8dfc63e32166f9117b4cebef550d22bdc81e1b9f3377f5843d50c2dee679b625, using exactly 8 isolated synthetic cases with at most 21 logical calls, 63 provider attempts, 900000 input tokens, 73500 output tokens, 973500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling.
```

After a separate exact authorization and secure process-local environment
injection, the future live command is:

```bash
npm run operational:formative-conversation-v5-v6-evaluate -- --mode=live --runtime-candidate-hash 494ed38226f655c19429e0f54dc78c78239a6492f39895cd5231fc5d22a87f59 --evaluation-protocol-hash 8dfc63e32166f9117b4cebef550d22bdc81e1b9f3377f5843d50c2dee679b625 --confirm-live-provider-calls --authorization "I authorize one live execution of formative-conversation-host-v5-executable-v6 for runtime candidate hash 494ed38226f655c19429e0f54dc78c78239a6492f39895cd5231fc5d22a87f59 and evaluation protocol hash 8dfc63e32166f9117b4cebef550d22bdc81e1b9f3377f5843d50c2dee679b625, using exactly 8 isolated synthetic cases with at most 21 logical calls, 63 provider attempts, 900000 input tokens, 73500 output tokens, 973500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling."
```

The required live flag is
`FORMATIVE_CONVERSATION_V5_V6_LIVE_EVALUATION_ENABLED=true`. Existing active
and rollback bundles remain unchanged. Authorization does not approve or
activate the candidate.
