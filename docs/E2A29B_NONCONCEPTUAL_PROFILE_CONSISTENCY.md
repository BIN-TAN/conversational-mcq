# E2A.29b Non-Conceptual Profile Consistency

## Scope

E2A.29b is a deterministic, no-provider correction to the boundary between a
latest-turn evidence observation and the authoritative cumulative learning
profile. It preserves the uncommitted E2A.29a transport implementation,
historical evidence, evaluator V5, the autonomous tutor candidate, and the
approved V2 baseline. It does not rerun E2A.29 or execute E2A.30.

## Root cause

The E1 `off_topic_then_reengages` scenario failed before routing because the
frozen V5 consistency check required a pure off-topic observation with no
assessable anchor evidence to equal a different semantic layer: the retained
authoritative learning profile. The same failure reproduced at untouched HEAD
and in the dirty E2A.29a tree. E2A.29a transport work was not causal.

## Versioned contracts

`turn-evidence-observation-v1` records only evidence observable in the latest
accepted student turn. `learning-profile-update-disposition-v1` records how
that observation affects the authoritative profile. Its dispositions are:

- `update_from_latest_evidence`;
- `preserve_prior_profile`;
- `reopen_from_latest_contradiction`;
- `initialize_unresolved_profile`.

`turn-evidence-cross-artifact-consistency-v2` compares turn observations only
with other turn-observation artifacts and authoritative profiles only with
other authoritative-profile artifacts. It separately verifies the explicit
profile update transition. It does not treat an expected difference between a
non-conceptual turn and a preserved conceptual profile as disagreement.

The runtime uses `turn-evidence-profile-mapper-v6`,
`turn-evidence-profile-consistency-v6`, and
`pre-tutor-profile-finalization-v3`. Evaluator V5 and its provider contract are
unchanged.

## Runtime behavior

A pure off-topic, task-confused, or protected turn with no conceptual evidence
records `not_assessable_nonconceptual`. With a prior profile, it explicitly
preserves the prior conceptual fields and records preservation provenance.
Without a prior topic-dialogue profile, it initializes an unresolved profile.
The platform applies the immediate redirect without a conceptual tutor call.

A mixed-intent turn retains valid conceptual evidence first, updates or
reopens the profile, then applies the immediate redirect. A later ordinary
turn sees that updated profile. An unsupported claim such as "I understand
now" is normalized to insufficient observable evidence and cannot become
sound or authorize revision by itself.

## Verification

The no-provider gate includes:

- all 12 E1 scenarios;
- 140 deterministic boundary cases covering non-conceptual, mixed-intent,
  unsupported-claim, preservation, re-engagement, and ordinary conceptual
  behavior;
- an injected same-layer disagreement that must fail closed;
- all 87 E2A.29a transport calibration cases;
- historical E2A.25 through E2A.29 regression checks;
- protected-evidence and candidate integrity checks.

Artifacts are written under
`.data/e2a29b-nonconceptual-profile-consistency/<run_id>/` and contain no
provider output, environment values, secrets, or private reasoning.

```bash
npm run eval:formative:e2a29b:smoke
npm run eval:formative:e2a29b:report
npm run eval:formative:e2a29b:audit
```

E2A.30 remains prepared only. No candidate is approved or activated by this
phase.
