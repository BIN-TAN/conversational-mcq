# E2A.39 Measurement Transfer Readiness and Episode Closure

E2A.39 freezes a held-out, no-live protocol for deciding when conceptual
evidence is sufficient, when optional transfer evidence is useful, and when a
formative episode should close. It does not execute a live session, create a
provider client, approve or activate a candidate, or change any protected
evaluation, profile, stopping, handoff, or tutor component.

## Held-out scenario

The transfer context is educational measurement:

> A blood pressure device gives the same reading every time, but every reading
> is 10 points higher than the true value. Is the device reliable? Is it valid?
> Explain.

The scenario tests whether the student preserves the reliability-versus-
validity mechanism in a novel context. It does not reteach the original
misconception.

## Frozen contracts

The protocol adds four application-controlled contracts:

- `transfer-evidence-contract-v1`
- `transfer-readiness-profile-v1`
- `episode-closure-policy-v1`
- `student-facing-closure-language-v1`

Transfer evidence requires application to the novel context, preservation of
the underlying mechanism, independence from the original surface features, and
a coherent conclusion. Exact wording, textbook phrases, and identical examples
are not required.

Transfer is optional. A sound independent explanation may close through
`close_after_sound` without a transfer request. Successful transfer may close
through `close_after_transfer`. Definition-only or copied language, partial
application, or misconception recurrence keeps the episode open. Successful
transfer followed by regression reopens the transfer-readiness profile.

## Student-facing closure

The only closure outcomes are:

- `close_after_sound`
- `close_after_transfer`
- `continue_learning`
- `instructor_next_step`

The corresponding student-facing messages are bounded and validated. They do
not expose mastery labels, transfer scores, closure rules, profile fields, turn
requirements, or internal routing.

An unrelated question is redirected without replacing the latest valid
conceptual evidence. A legitimate transfer question continues the episode but
is not itself treated as transfer evidence.

## Deterministic verification

Seven held-out cases and 42 deterministic regressions pass. Coverage includes:

- sound evidence without forced transfer;
- successful transfer and closure;
- definition-only evidence requiring application;
- transfer failure after apparent understanding;
- partial understanding;
- legitimate and unrelated questions during closure;
- successful transfer followed by regression;
- no tutor dispatch after closure;
- the bounded instructor-next-step outcome;
- non-copied definition-only evidence;
- student-facing language leakage rejection;
- evidence preservation;
- trajectory-envelope compatibility; and
- different decisions for students with the same initial sound state but
  different transfer evidence.

The deterministic metrics report:

- closure appropriateness: `1.0`
- unnecessary dialogue count: `0`
- missed closure count: `0`
- false closure count: `0`
- transfer-readiness accuracy: `1.0`
- student-facing communication quality: `1.0`
- evidence preservation: `1.0`

These are synthetic protocol metrics, not claims about stable learner traits or
classroom validity.

## Protected boundaries

Byte-level integrity checks preserve:

- Evaluator V5;
- the tutor candidate;
- canonical anchor evidence;
- anchor reference, stance, and scope resolvers;
- the evidence-preserving mapper;
- the self-correction intent envelope;
- `conceptual-evidence-update-source-v1`;
- learning and engagement profile evolution;
- adaptive stopping;
- instructor escalation and handoff;
- `trajectory-envelope-v1`; and
- the approved candidate boundary.

The closure policy consumes frozen upstream evidence and stopping signals. It
does not rewrite those components.

## Frozen identity

Protocol version:

`e2a39-measurement-transfer-readiness-episode-closure-v1`

Protocol hash:

`060db7e1caa6e656f4a6b8f890d57f9ada4c5ef2b48c5e316b06ab27f8ddbd3d`

Composite runtime identity:

`da31c2032f90e1806fc435918239103593873910b4d1f68c7ef47792d560f2ad`

Candidate configuration hash:

`b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b`

## Budget

The frozen, unexecuted budget is:

- one isolated session;
- 29 logical calls maximum;
- 87 adapter attempts maximum;
- two transport retries per logical call;
- 900,000 input tokens;
- 70,000 output tokens;
- 970,000 total tokens;
- USD 25 ceiling when pricing metadata exists; and
- provider concurrency one.

This budget does not authorize execution.

## Artifact packet

The authoritative packet is:

`.data/e2a39-measurement-transfer-readiness-protocol-freeze/e2a39_20260725T131031161Z_39530271/`

It contains 30 read-only artifacts. Artifact validation, candidate integrity,
protected-source integrity, and the provider-call guard all pass.

Provider calls: `0`

Network requests: `0`

## Commands

```bash
npm run eval:formative:e2a39:run
npm run eval:formative:e2a39:report
npm run eval:formative:e2a39:smoke
npm run eval:formative:e2a39:transfer-smoke
npm run eval:formative:e2a39:closure-smoke
npm run eval:formative:e2a39:profile-evolution-smoke
npm run eval:formative:e2a39:stopping-smoke
npm run eval:formative:e2a39:student-facing-communication-smoke
npm run eval:formative:e2a39:evidence-preservation-smoke
npm run eval:formative:e2a39:trajectory-envelope-smoke
npm run eval:formative:e2a39:personalization-smoke
npm run eval:formative:e2a39:budget-smoke
npm run eval:formative:e2a39:protected-components-smoke
npm run eval:formative:e2a39:artifact-smoke
npm run eval:formative:e2a39:provider-call-guard-smoke
```

No command in this set is a live entrypoint. E2A.39 remains frozen,
unauthorized, and unexecuted.
