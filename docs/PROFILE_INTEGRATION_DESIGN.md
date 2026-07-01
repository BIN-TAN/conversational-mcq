# Profile Integration Interpretation Design

## Scope

Profile Integration Interpretation v1 combines two internal evidence streams:

- `ability-evidence-packet-v1`
- `engagement-evidence-packet-v1`

The output is `profile-integration-interpretation-v1`.

This layer is interpretation only. It does not determine a formative value, choose a formative activity, recommend an intervention, advance assessment state, score a student, or claim classroom validity.

The agent contract is:

```text
profile_integration_agent
```

Phase 27c implements the schema, input builder, deterministic mock output, validator, fallback, no-live smoke test, and redacted review command. It does not run paid provider calls.

## Why Integration Is Separate

Ability and engagement remain separate evidence streams:

- ability evidence summarizes current knowledge-state evidence from responses, reasoning, confidence, and internal item metadata;
- engagement evidence summarizes participation and evidence-reliability context from response presence, timing bands, revision evidence, process-event counts, and safe contextual signals.

Engagement does not directly change the ability category. It can affect interpretation confidence, reliability context, and uncertainty.

## Input Policy

The integration input is allowlisted and redacted. It may include:

- public session, assessment, student, and concept-unit identifiers;
- ability packet schema version;
- engagement packet schema version;
- item-level ability categories and evidence strengths;
- reasoning quality labels, not raw reasoning text;
- confidence-calibration labels;
- item-level engagement categories and timing/length bands;
- AI-assistance signal labels as internal context only;
- counts, bands, limitations, and safe summaries.

It must not include:

- answer keys;
- correct option values;
- correctness labels in student-facing text;
- distractor metadata;
- raw misconception IDs in student-facing text;
- raw reasoning;
- raw process-event payloads;
- raw conversation turns;
- raw provider output;
- prompts;
- API keys, cookies, auth headers, session secrets, or database URLs;
- summative outcomes;
- teacher private notes.

## Output Schema

The packet includes:

- source packet schema versions;
- internal integrated status;
- student-facing status;
- status confidence;
- integration pattern;
- ability interpretation;
- engagement context;
- evidence rationale;
- uncertainty and limitations;
- student-safe message;
- teacher/research summary;
- deterministic safety check flags.

Internal integrated status may be:

```text
Mostly understood
Still developing
Needs more work
Insufficient evidence
```

Student-facing status must be exactly one of:

```text
Mostly understood
Still developing
Needs more work
```

## Integration Patterns

Allowed integration patterns are:

```text
stable_understanding
developing_understanding
likely_knowledge_gap
likely_misconception
mixed_or_conflicting_evidence
insufficient_evidence
```

Mapping to student-facing status:

- `stable_understanding` -> `Mostly understood`
- `developing_understanding` -> `Still developing`
- `likely_knowledge_gap` -> `Needs more work`
- `likely_misconception` -> `Still developing` or `Needs more work`, depending on strength
- `mixed_or_conflicting_evidence` -> `Still developing`
- `insufficient_evidence` -> `Still developing` by default; it may become `Needs more work` only when low-information evidence is the main usable signal

## Student-Safe Projection

Students may see only:

```ts
{
  status: "Mostly understood" | "Still developing" | "Needs more work";
  message: string;
  knowledge_focus: string;
}
```

Students must not see:

- internal integrated status;
- integration pattern;
- engagement category;
- AI-assistance signal;
- internal evidence rationale;
- confidence calibration details;
- answer keys;
- correct option values;
- correctness labels;
- distractor metadata;
- raw reasoning;
- raw process-event data;
- raw LLM output;
- formative value direction;
- activity recommendation.

## Validation

Validation is deterministic. It rejects outputs that:

- include a formative value direction;
- include an activity recommendation;
- expose answer-key or correct-option content;
- expose correctness labels in student-facing text;
- expose distractor metadata;
- expose raw reasoning or process payloads;
- expose raw provider output or prompts;
- expose secrets;
- expose engagement or AI-assistance labels in the student-safe message;
- use a student-facing status outside the three allowed labels;
- overclaim a high-confidence stable interpretation without limitations.

No separate reviewer LLM is used. Overclaiming is constrained by the prompt contract, strict schema validation, deterministic safety checks, and conservative fallback.

## Fallback

If the candidate integration output is invalid, the service builds a conservative deterministic fallback:

- internal status: `Insufficient evidence`
- student-facing status: `Still developing` by default
- status confidence: `low`
- no formative value direction
- no activity recommendation

The fallback is marked as `deterministic_fallback` and remains reviewable.

## Review Commands

Run the no-live smoke:

```bash
npm run student:profile-integration-smoke
```

Run the review command:

```bash
npm run student:profile-integration-review
```

To review a specific session:

```bash
npm run student:profile-integration-review -- --session-public-id <session_public_id>
```

Artifacts are written under:

```text
.data/profile-integration-review/
```

The artifacts are local developer/research review files and are ignored by Git.

## Future Use

A later formative layer may consume this packet. That later layer must remain separate from this interpretation packet and must not infer activity selection from engagement context alone.
