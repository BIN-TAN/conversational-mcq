# V18R1 Deployment Provenance Correction

V18R1 is a deployment-provenance successor to immutable V18 commit
`9fd41e1139b7e80f433aff76a6985095333e6b7d`. It is not V19 and changes no
research runtime, prompt, pedagogy, profile semantics, case meaning, or budget.

## V18 lineage

The V18 attempt stopped before dispatch because its production provenance guard
invoked `git` inside the canonical Render image. The preserved failure is
`spawnSync git ENOENT`; it created zero dispatch checkpoints, provider requests,
database records, logical calls, provider attempts, and tokens. The prior
authorization was not consumed, but it cannot authorize V18R1 identities.

The immutable failed pre-dispatch evidence is referenced by SHA-256 only:

- failure artifact: `7dc167b68ff09abebb79c5c4e3e7da1ce67b1cb371831f1fa7b7e749126a6940`;
- runner log: `9d5250f0bacc39c4318a84aa2502be879193c4447b1095c73ecb65fbf4a4d708`.

V18 candidate and run artifacts remain immutable and are not runtime
dependencies of V18R1.

## Two explicit boundaries

The local committed-source verifier is Git-aware. Before deployment it verifies
`HEAD`, `origin/main`, a clean working tree, committed source closure, and
reproducible materialization.

The deployed verifier is Git-independent. It accepts only
`render_deployed_artifact` mode and verifies:

- `RENDER_GIT_COMMIT`;
- the separately supplied `--expected-deployed-git-sha`;
- exact equality of those normalized 40-character SHAs;
- the runtime, protocol, runner, fixture manifest, aggregate fixtures, compiled
  plan, environment, provenance, deployed source closure, security wrapper,
  prompt, canonical evidence implementation, and misconception claim
  implementation identities loaded from the deployed package.

The deployed verifier does not import `node:child_process`, invoke Git, inspect
`.git`, or fall back to a local verifier. Installing Git in production would
preserve the wrong abstraction and make provenance depend on mutable image
tooling, so it is explicitly rejected as a solution.

## Future authorization

The expected deployed SHA is not embedded in this source revision. After V18R1
is committed and deployed, a future authorization must replace
`<expected_deployed_git_sha>` in the frozen template and pass the same value to
the launcher:

```text
--expected-deployed-git-sha=<40-character-authorized-commit>
```

That SHA, the source and deployment-reported SHAs, the deployed artifact status
and provenance hash, the authorization identity, and the frozen executable
identities are bound into the exactly-once dispatch checkpoint. The executable
freeze is `live_execution_prepared=true`, while `approval.eligible=false` and
`activation.permitted=false`. Preparation does not authorize execution: an
exact committed/deployed SHA and the complete frozen identities still require
a separate post-deployment authorization.

## Preserved evaluation

V18R1 retains exactly 12 substantive cases: three profiling cases, eight
formative comparability cases, and one dissertation end-to-end case. It retains
4 profiling and 24 formative base calls, with ceilings of 56 logical calls, 168
provider attempts, 28 semantic regenerations, two transport retries per logical
call, 1,800,000 input tokens, 368,000 output tokens, 2,168,000 total tokens,
7,200,000 milliseconds, concurrency one, and USD 60.
