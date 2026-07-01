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

Phase 27c implements the schema, input builder, deterministic mock output, validator, fallback, redacted review command, provider-audited execution path, and opt-in live smoke wrapper. Normal review and smoke commands remain no-live by default. Paid provider calls occur only when explicitly enabled by a live smoke command and live server-side configuration.

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

Teacher/research summaries are current-evidence summaries only. They may describe what the evidence suggests, what is uncertain, how ability and engagement evidence relate, and what should not be overclaimed. They must not contain planning language, next-step recommendations, activity selection, intervention planning, or tutor-action recommendations.

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
- include next-activity, intervention-planning, instructional-plan, or tutor-action recommendation language;
- expose answer-key or correct-option content;
- expose correctness labels in student-facing text;
- expose distractor metadata;
- expose raw reasoning or process payloads;
- expose raw provider output or prompts;
- expose secrets;
- expose engagement or AI-assistance labels in the student-safe message;
- use a student-facing status outside the three allowed labels;
- overclaim a high-confidence interpretation when evidence is mixed, low-information, reliability-limited, or metadata-limited;
- claim `likely_misconception` without at least two aligned evidence sources;
- use engagement, process, or external-assistance context as direct ability evidence.

No separate reviewer LLM is used. Overclaiming is constrained by the prompt contract, strict schema validation, deterministic safety checks, and conservative fallback.

High `status_confidence` is not allowed when:

- evidence consistency is mixed, conflicting, or insufficient;
- the integration pattern is `mixed_or_conflicting_evidence` or `insufficient_evidence`;
- overall reasoning quality is vague, mixed, or insufficient;
- low-information or explicit uncertainty evidence is present;
- contextual reliability issues are present;
- metadata limitations are substantial.

`likely_misconception` requires multiple aligned sources. A single wrong answer, by itself, is not enough.

Student-facing `knowledge_focus` may name the knowledge point that is unclear, such as "Separating theta as person ability from item difficulty." It must not tell the student to do an activity or prescribe what the tutor should show next.

## Fallback

If the candidate integration output is invalid, the service builds a conservative deterministic fallback:

- internal status: `Insufficient evidence`
- student-facing status: `Still developing` by default
- status confidence: `low`
- no formative value direction
- no activity recommendation

The fallback is marked as `deterministic_fallback` and remains reviewable.

## Live Repair

The provider-backed path may make one repair attempt when the first structured output is schema-shaped but fails only for remediable safety or overclaiming issues:

- formative value direction;
- activity or next-activity recommendation;
- high-confidence overclaim.

The repair request uses the same redacted structured evidence and safe validation issue metadata only: field path, rule code, and safe blocked-pattern label. It does not include the rejected provider output. If the repair validates, the repair attempt is accepted and audited. If the repair fails, the service fails closed and returns the conservative fallback; invalid provider output is never accepted into review artifacts or student-facing projections.

## Review Commands

Run the no-live smoke:

```bash
npm run student:profile-integration-smoke
```

The smoke simulates the provider path with an injected local provider and verifies that valid output is audited in `agent_calls`, invalid output is rejected, and no OpenAI call occurs.

Run the review command:

```bash
npm run student:profile-integration-review
```

To review a specific session:

```bash
npm run student:profile-integration-review -- --session-public-id <session_public_id>
```

To intentionally run the provider-backed review path for a specific existing session, use both live server-side LLM configuration and:

```bash
npm run student:profile-integration-review -- --session-public-id <session_public_id> --live
```

The standalone live smoke is skipped unless explicitly enabled:

```bash
npm run student:profile-integration-live-smoke
```

To run it intentionally after local live configuration:

```bash
RUN_LIVE_PROFILE_INTEGRATION_SMOKE=1 npm run student:profile-integration-live-smoke
```

The live path stores `agent_calls` rows with `agent_name=profile_integration_agent`, schema version `profile-integration-interpretation-v1`, provider/model metadata, provider request or response metadata when available, output validation status, validation errors, and token usage when returned by the provider.

If the opt-in live smoke fails, it prints sanitized diagnostics and writes an ignored local artifact under:

```text
.data/profile-integration-live-smoke/failures/
```

Diagnostics include only public IDs, call status, schema version, safe validation issue paths and rule codes, provider-metadata presence, token-usage presence, and failure stage.

The optional model variable is:

```text
OPENAI_MODEL_PROFILE_INTEGRATION
```

If it is not configured, the live path may use `OPENAI_MODEL_PLANNING` or `OPENAI_MODEL_FOLLOWUP` as the server-side fallback model variable.

Artifacts are written under:

```text
.data/profile-integration-review/
```

The artifacts are local developer/research review files and are ignored by Git.

## Future Use

A later formative layer may consume this packet. That later layer must remain separate from this interpretation packet and must not infer activity selection from engagement context alone.
