# V18R2 Executable Freeze Deployment Provenance

V18R2 is the executable freeze for the accepted contract-coherence and bounded
lifecycle correction. It is not V19. Its direct immutable live lineage is
V18R1 commit `2147e4d340e9adbfd8014433ceede852fbdc54fc`, provider run
`fcv5v18r1_provider_20260813160503_9f33cf65`, and derived evaluation
`fcv5v18r1_derived_20260813160503_1534d9b2`.

## Preserved provenance architecture

V18R2 carries forward the corrected dual-boundary provenance architecture from
V18R1. Historical V18 and V18R1 candidate, run, research, and security
artifacts remain immutable and are not mutable runtime dependencies of V18R2.
The V18R1 live result is referenced through the frozen immutable-lineage
contract and hashes; it is not rewritten or rerun.

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

The expected deployed SHA is not embedded in this source revision. After V18R2
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

V18R2 retains exactly 12 substantive cases: three profiling cases, eight
formative comparability cases, and one dissertation end-to-end case. It retains
4 profiling and 24 formative base calls, with ceilings of 56 logical calls, 168
provider attempts, 28 semantic regenerations, two transport retries per logical
call, 1,800,000 input tokens, 368,000 output tokens, 2,168,000 total tokens,
7,200,000 milliseconds, concurrency one, and USD 60.
