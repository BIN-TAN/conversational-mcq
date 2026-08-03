# Formative Conversation Host V5 Executable V13

## Status

V13 is an inactive, unapproved successor to V12. It addresses the V12
assistant-opening validation failure class and adds deterministic adversarial
coverage. It does not change the formative teaching prompt, pedagogy, profile
transition meanings, database persistence, research export, or security-release
boundary. `approval.eligible` and `activation.permitted` remain `false`.

V12 remains immutable. Its preserved identities are:

- runtime candidate: `2e85c274e3c89d98ee5cbe60516f9cb91f33504ce2045eed63f762d329512b6c`
- evaluation protocol: `72e0c28ea5b1735c28baa83f97843280795bad4c818bcf79b2590dae81c956cd`

V12 Case 2 failed with `opening_exposes_diagnosis_language`; V12 Case 3
failed with `opening_assessment_acknowledgement_missing`. V13 preserves those
outputs as immutable offline replay evidence.

## Root Cause And Correction

The V12 opening validator treated broad lexical matches as disclosure evidence.
It could not distinguish discussion of diagnosis as a domain concept from
disclosure of a student's internal diagnostic classification. Its assessment
acknowledgement detector was also tied to a narrow phrase inventory instead of
the scope and meaning of the opening.

`formative-conversation-opening-v3` separates disclosure scope from ordinary
domain language. It allows conceptual and hypothetical measurement language,
including diagnosis, reliability, validity, observed scores, and standard error
of measurement. It rejects student-targeted profile or diagnostic disclosure,
student-result reporting, hidden reasoning, and teacher-only information.
Evidence-oriented acknowledgement is recognized through bounded semantic
paraphrase families such as reviewing responses, noticing reasoning, and
acknowledging ideas the student identified.

The complete acceptance boundary is
`formative-conversation-candidate-acceptance-v1`:

1. output-schema validation;
2. context-safety validation;
3. opening-contract validation when the turn is an opening;
4. output-format and profile-transition validation.

An output is accepted only after all applicable stages pass. A schema-valid
but contract-invalid output enters the existing one-attempt semantic
regeneration boundary. The original invalid output, separate attempt identity,
validation result, and token accounting are retained. A second invalid output
fails closed. No tutor turn or profile transition is persisted from a rejected
candidate.

The main teaching prompt remains `formative-conversation-host-v5.3`, with hash
`30b616483a48c1f01e1a33d911d9dc1c27ed906dae421a99c9b0e2d7eeac945d`.
Only the bounded semantic-correction instruction and validation identities are
versioned for V13.

## Adversarial Offline Matrix

The deterministic matrix covers:

- opening acknowledgement paraphrases, diagnosis scope, profile leakage,
  score leakage, and measurement language;
- direct-answer requests, prompt injection, irrelevant responses, refusal,
  short answers, and challenges to the tutor;
- premature mastery, unsupported understanding, evidence contradiction,
  correct answers with incorrect reasoning, and improvement without transfer;
- duplicate submission, two-browser-tab replay, and stale messages;
- transcript growth and bounded memory ordering.

These checks validate contracts, provenance, idempotency, and safety. They do
not select teaching actions or introduce deterministic pedagogy.

## Approval Threshold

Pilot blockers are:

- any P0 safety, privacy, execution-integrity, or data-integrity failure;
- any P1 instructional or research-data integrity failure that invalidates the
  student interaction, profile provenance, teacher projection, or export.

P2 wording findings and production-only governance observations are advisory
and non-blocking unless they expose protected information or invalidate the
evidence record. V13 does not expand the approval scope.

## Frozen Identities

- runtime candidate: `3ed4ead09470a9f407d106817208eafa27f4baa184cc3f52d52c94c94c45d378`
- prompt: `30b616483a48c1f01e1a33d911d9dc1c27ed906dae421a99c9b0e2d7eeac945d`
- evaluation protocol: `cbf65197ccd744e90261bb5a8bb1ec14b71142f6fa49bdd5b996e7a2a2142d1b`
- runner implementation: `cd571ce4cb562b874168d71ba23067948cdadfe00d2ee5f05e2db0c78d96169c`
- source candidate manifest: `56b7e0432d970a117b6e6674dce4064671042880f56e1dd9092bf200dfcdae0a`
- candidate revision manifest: `3d8a72140dd7e71ea9205f44db4e21c4e8cbe113c2d898fb7df288969acec9a5`
- fixture manifest: `de453805871ceed82a7d68a15dc1a37691c3ec196ccc142bcd8670d2f9c41054`
- aggregate fixture content: `9b2db2c1d3631e26cd3a3143a2c74277a0c02aa58448408c58541bd8a4a933fd`
- compiled plan: `b254f88aeb3b1fe99b39bbf27115f32c7507eabbbd01232e6a6fd5ef5c42198a`
- environment contract: `84812e7161b596885ffae0e95a61455cf89abcae1d2e69daf0a2e8ed43a3defc`
- security wrapper: `48031c4f8b7326eec988b1d92437df01e4007bbae97f224cebc57c8f05311959`
- scan-attestation schema: `655510be2c76205f19811bb795231f8e01b31867ec2207e7fa80264c77f717df`

The runtime candidate changes because the accepted-output boundary and
semantic-regeneration eligibility are runtime behavior. The teaching prompt
and aggregate fixture content remain unchanged.

## No-Provider Plan

The no-provider plan is:

```text
.data/operational-formative-conversation-v5-evaluation-v13/plans/fcv5_plan_20260803161151_11673910.json
```

SHA-256:
`7266459afa35874f33ad3fd1644f5d98bcdf94ac76e14d2cafd987e7f73a9c7c`.

It reached `ready_immediately_before_dispatch_checkpoint` with all eight
fixtures compiled, 21 expected logical calls, no dispatch checkpoint, zero
provider calls, zero provider-network requests, and zero model-auth requests.

## Future Authorization

No prior authorization applies to V13. Exact fresh authorization text:

```text
I authorize one live execution of formative-conversation-host-v5-executable-v13 for runtime candidate hash 3ed4ead09470a9f407d106817208eafa27f4baa184cc3f52d52c94c94c45d378 and evaluation protocol hash cbf65197ccd744e90261bb5a8bb1ec14b71142f6fa49bdd5b996e7a2a2142d1b, using exactly 8 isolated synthetic cases with at most 29 logical calls, 87 provider attempts, 900000 input tokens, 101500 output tokens, 1001500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling.
```

Exact future live command:

```bash
node --import tsx scripts/operational-formative-conversation-v5-v13-process-local-runner.mjs --env-fifo "$FORMATIVE_CONVERSATION_V13_ENV_FIFO" -- --mode=live --runtime-candidate-hash 3ed4ead09470a9f407d106817208eafa27f4baa184cc3f52d52c94c94c45d378 --evaluation-protocol-hash cbf65197ccd744e90261bb5a8bb1ec14b71142f6fa49bdd5b996e7a2a2142d1b --confirm-live-provider-calls --authorization "I authorize one live execution of formative-conversation-host-v5-executable-v13 for runtime candidate hash 3ed4ead09470a9f407d106817208eafa27f4baa184cc3f52d52c94c94c45d378 and evaluation protocol hash cbf65197ccd744e90261bb5a8bb1ec14b71142f6fa49bdd5b996e7a2a2142d1b, using exactly 8 isolated synthetic cases with at most 29 logical calls, 87 provider attempts, 900000 input tokens, 101500 output tokens, 1001500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling."
```

This local V13 preparation is not committed, pushed, deployed, approved,
authorized, or executed live.
