# Formative Conversation Host V5 Executable V12

## Status

V12 is an inactive, unapproved launcher-governance successor to V11. It does
not change the formative-conversation prompt, runtime behavior, semantic
regeneration, profile transitions, schemas, validators, fixtures, budgets, or
security-release behavior. `approval.eligible` and `activation.permitted`
remain `false`.

V11 remains immutable and blocked before dispatch. It created no dispatch
checkpoint, provider run, derived evaluation, provider call, model-auth
request, or synthetic evaluation record.

## V11 Launcher Failure

The frozen V11 live command invoked the outer process-local runner with bare
Node:

```text
node scripts/operational-formative-conversation-v5-v11-process-local-runner.mjs
```

That runner imported TypeScript modules containing `@/` aliases before a
TypeScript loader was installed. The no-provider module probe, environment
preflight, and plan paths used a loader-aware launcher, so they did not test
the exact outer live invocation.

The canonical V11 failure analysis is:

```text
config/operational-candidates/formative-conversation-host-v5-executable-v12/v11-launcher-failure-analysis.json
```

Its SHA-256 is
`1c5c4f182a650c67d4938f9ab7f3fc061846b3c09823cd54d445aab326fad0fd`.

## V12 Correction

Every executable V12 path uses the same loader mechanism:

```text
node --import tsx
```

The outer process-local runner verifies that loader before importing any
TypeScript module. It then starts the canonical launcher with the same loader;
the launcher validates its invocation and starts the TypeScript CLI with the
same loader. The CLI requires the launcher marker, and live mode additionally
requires the outer-runner marker. An invalid invocation fails with a typed
error before dispatch-checkpoint creation.

Canonical paths are:

```bash
node --import tsx scripts/operational-formative-conversation-v5-v12-launcher.mjs --mode=module-load-probe
node --import tsx scripts/operational-formative-conversation-v5-v12-process-local-runner.mjs --env-fifo "$FORMATIVE_CONVERSATION_V12_ENV_FIFO" -- --mode=environment-preflight
node --import tsx scripts/operational-formative-conversation-v5-v12-launcher.mjs --mode=plan
node --import tsx scripts/operational-formative-conversation-v5-v12-process-local-runner.mjs --env-fifo "$FORMATIVE_CONVERSATION_V12_ENV_FIFO" -- --mode=live
```

The process-local runner retains the V11 owner-only FIFO, control channel,
preventive scan, attestation, secret clearing, atomic artifact release, and
failure-cleanup boundary.

## Frozen Identities

- runtime candidate: `2e85c274e3c89d98ee5cbe60516f9cb91f33504ce2045eed63f762d329512b6c`
- prompt: `30b616483a48c1f01e1a33d911d9dc1c27ed906dae421a99c9b0e2d7eeac945d`
- evaluation protocol: `72e0c28ea5b1735c28baa83f97843280795bad4c818bcf79b2590dae81c956cd`
- runner implementation: `870878ad565edc7360cf429a93ea7559e21911056ba3fcd813b3c5b5bc2a9a1b`
- source candidate manifest: `333aa84f6ce81833b308da6967bd20925702f0232b240ceda928267110093b47`
- candidate revision manifest: `10e1e24276d34fc5485d5956e4fe250b8b8d20ec142aa8875bc4b58f10692d21`
- fixture manifest: `8969fc263f2fd5408280869c0ebba191992b357c54517cbf0a88e9f39f71a148`
- aggregate fixture content: `9b2db2c1d3631e26cd3a3143a2c74277a0c02aa58448408c58541bd8a4a933fd`
- compiled plan: `ba5718ae8d98c44c6c25843e9a60010155bd81f0f724ca5144797bc307a77398`
- environment contract: `0bc70bb7dbdaa5f5ba50840d63edb92abc789ae85ee40fa0d905972839bf1cc0`
- security wrapper: `3127a0d7238ed595ab8778ec28a0e614ccc5169d7633f92d8b25110111eceba2`
- scan-attestation schema: `f707f232053ea64dde1a244c8e71a63d62c7eac17d3ac646bd11c5e299a4ef97`

The runtime candidate, prompt, and aggregate fixture content hashes are
unchanged from V11. Protocol, runner, manifest, compiled-plan, environment,
and versioned security-governance hashes change because V12 binds the corrected
launcher chain and its own inactive namespace.

## No-Provider Plan

The final no-provider plan is:

```text
.data/operational-formative-conversation-v5-evaluation-v12/plans/fcv5_plan_20260803125001_a9a92491.json
```

SHA-256:
`8aa96b4158c1bd3bbf2a90eeee844d45302746b78de9496ef22383065d96d4dd`.

It reached `ready_immediately_before_dispatch_checkpoint` with all eight
fixtures compiled, 21 expected logical calls, no checkpoint, zero provider
calls, zero provider-network requests, and zero model-auth requests.

## Future Authorization

No prior authorization applies to V12. Exact fresh authorization text:

```text
I authorize one live execution of formative-conversation-host-v5-executable-v12 for runtime candidate hash 2e85c274e3c89d98ee5cbe60516f9cb91f33504ce2045eed63f762d329512b6c and evaluation protocol hash 72e0c28ea5b1735c28baa83f97843280795bad4c818bcf79b2590dae81c956cd, using exactly 8 isolated synthetic cases with at most 29 logical calls, 87 provider attempts, 900000 input tokens, 101500 output tokens, 1001500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling.
```

Exact future live command:

```bash
node --import tsx scripts/operational-formative-conversation-v5-v12-process-local-runner.mjs --env-fifo "$FORMATIVE_CONVERSATION_V12_ENV_FIFO" -- --mode=live --runtime-candidate-hash 2e85c274e3c89d98ee5cbe60516f9cb91f33504ce2045eed63f762d329512b6c --evaluation-protocol-hash 72e0c28ea5b1735c28baa83f97843280795bad4c818bcf79b2590dae81c956cd --confirm-live-provider-calls --authorization "I authorize one live execution of formative-conversation-host-v5-executable-v12 for runtime candidate hash 2e85c274e3c89d98ee5cbe60516f9cb91f33504ce2045eed63f762d329512b6c and evaluation protocol hash 72e0c28ea5b1735c28baa83f97843280795bad4c818bcf79b2590dae81c956cd, using exactly 8 isolated synthetic cases with at most 29 logical calls, 87 provider attempts, 900000 input tokens, 101500 output tokens, 1001500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling."
```

This local V12 preparation is not committed, pushed, deployed, approved, or
authorized for live execution.
