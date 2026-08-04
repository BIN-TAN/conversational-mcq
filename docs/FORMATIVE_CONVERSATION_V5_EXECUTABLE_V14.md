# Formative Conversation Host V5 Executable V14

## Status

V14 is an inactive, unapproved successor to V13. It corrects only transition
evidence closure and evaluation accounting. It does not change the teaching
prompt, formative pedagogy, profile meanings, transition semantics, database
schema, persistence architecture, security wrapper, export architecture, or
the eight frozen fixtures. `approval.eligible` and `activation.permitted`
remain `false`.

V13 remains immutable. Its failed run is
`fcv5v13_provider_20260803174047_46ca2888`: seven cases passed and Case 5
failed because retained field evidence cited tutor turn 789 while the
canonical transition evidence set contained only student turns 788 and 790.
No partial transition was persisted and the conversation turn was preserved.

## Corrections

`formative-conversation-transition-evidence-closure-v1` requires every turn
reference in field evidence and supporting observations to be present in the
canonical transition evidence set. A closure failure is recorded as
`profile_transition_evidence_closure_violation`; the invalid recommendation is
preserved, no transition is written, and semantic regeneration must pass the
same final acceptance boundary.

`formative-conversation-v14-evaluation-accounting-v1` separates the frozen
base graph from bounded recovery work:

- `base_calls_expected` and `base_calls_completed` describe the original
  21-call graph;
- semantic regeneration and transport retries are reported as recovery calls;
- `total_provider_attempts` remains the authoritative provider-attempt total;
- authorized recovery does not make a complete base graph appear incomplete.

The V13 Case 5 recommendation is preserved by hash and replayed offline. The
original `[788, 790]` evidence set is rejected with missing turn 789; a
corrected `[788, 789, 790]` set is accepted without creating a duplicate
transition.

## Frozen Identities

- runtime candidate: `b831e1bc85eeee7fc4afc4e0700bacda5f4c17c77fe379795bdbbf5c72bc7075`
- prompt: `30b616483a48c1f01e1a33d911d9dc1c27ed906dae421a99c9b0e2d7eeac945d`
- evaluation protocol: `666e7d1c9e11825366e6d483c5e5578fd99a1b480d40cc250888974ac64563ac`
- runner implementation: `a3d55a19e11114787b6fac05d96e97ea92794511a6733efe31ff2a8824086146`
- candidate revision manifest: `c98865a618171fb8ec0df93e38c80434072a579d560e1439cea8e3a93ee11ecd`
- fixture manifest: `c874db90c80c046dc79547adc70279f1fafe4d07c44da3b58899764f6fbc7b74`
- aggregate fixture content: `9b2db2c1d3631e26cd3a3143a2c74277a0c02aa58448408c58541bd8a4a933fd`
- compiled plan: `9b7494ee0866b89fe9dbc6b48a3d89dbcc6e37d1f914a57ffc705e43bdfaf456`
- environment contract: `a6ba012daca0e5c1094f0c9d364472d5925f4393878bd4e736a168ca5baceefa`
- security wrapper: `d87cf8dc61dca623f22bd4873f4aa6544c411e3f0a6f25a6fc897937488ea6f2`
- scan-attestation schema: `655510be2c76205f19811bb795231f8e01b31867ec2207e7fa80264c77f717df`

The runtime and protocol identities change because evidence closure is part of
accepted transition behavior and accounting is part of the frozen evaluation
runner. The security behavior and semantic version remain V13; its source
fingerprint changes only because the V14 launcher and accounting-enabled
service are included in the wrapper source set. The prompt hash and aggregate
fixture hash are unchanged.

## Verification Boundary

V14 preparation is no-provider only. Materialization, all-eight-case
compilation, immutable V13 replay, transition persistence, export parity,
security, provenance, typecheck, lint, and production build must pass before
any future authorization is requested. Preparation creates no dispatch
checkpoint, provider run, derived evaluation, approval evidence, or activation.

## Future Authorization

No prior authorization applies to V14. Exact fresh authorization text:

```text
I authorize one live execution of formative-conversation-host-v5-executable-v14 for runtime candidate hash b831e1bc85eeee7fc4afc4e0700bacda5f4c17c77fe379795bdbbf5c72bc7075 and evaluation protocol hash 666e7d1c9e11825366e6d483c5e5578fd99a1b480d40cc250888974ac64563ac, using exactly 8 isolated synthetic cases with at most 29 logical calls, 87 provider attempts, 900000 input tokens, 101500 output tokens, 1001500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling.
```

Exact future live command:

```bash
node --import tsx scripts/operational-formative-conversation-v5-v14-process-local-runner.mjs --env-fifo "$FORMATIVE_CONVERSATION_V14_ENV_FIFO" -- --mode=live --runtime-candidate-hash b831e1bc85eeee7fc4afc4e0700bacda5f4c17c77fe379795bdbbf5c72bc7075 --evaluation-protocol-hash 666e7d1c9e11825366e6d483c5e5578fd99a1b480d40cc250888974ac64563ac --confirm-live-provider-calls --authorization "I authorize one live execution of formative-conversation-host-v5-executable-v14 for runtime candidate hash b831e1bc85eeee7fc4afc4e0700bacda5f4c17c77fe379795bdbbf5c72bc7075 and evaluation protocol hash 666e7d1c9e11825366e6d483c5e5578fd99a1b480d40cc250888974ac64563ac, using exactly 8 isolated synthetic cases with at most 29 logical calls, 87 provider attempts, 900000 input tokens, 101500 output tokens, 1001500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling."
```

This V14 successor is local only. It has not been committed, pushed, deployed,
authorized, executed live, approved, or activated.
