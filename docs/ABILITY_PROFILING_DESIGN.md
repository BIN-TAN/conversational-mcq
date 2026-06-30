# Ability Profiling Design

## Scope

Ability profiling v1 is an internal evidence-packet foundation for future ability profiling. It does not create a final ability profile, does not integrate a new LLM agent, and does not render new student-facing UI.

The current output is `AbilityEvidencePacketV1` with schema version:

```text
ability-evidence-packet-v1
```

The packet is formative and provisional. It must not be described as a calibrated theta score, IRT precision estimate, stable trait score, or classroom-valid ability classification.

## Evidence Sources

The packet is built from existing platform records:

- `response_packages`: source response package payload and package trace.
- `item_responses`: selected option, correctness snapshot for internal use, reasoning text, confidence, timing, revisions, and item snapshots.
- `conversation_turns`: tempting-option and tempting-option-reason evidence through structured payloads already packaged into response packages.
- `process_events`: repair, validation, pause, and timing context.
- `items`: item public ID, options, correct option, distractor rationales, expected reasoning patterns, possible misconception indicators, and administration rules.
- `concept_units`: concept-unit public ID and concept-level context.
- `assessment_sessions` and `users`: public session and classroom `user_id` linkage.

The packet does not read summative outcomes, teacher private notes, credentials, cookies, hidden prompts, or raw provider output.

## Item Diagnostic Metadata

The v1 metadata shape is:

```ts
{
  concept_id: string;
  cognitive_level: string;
  subskills: string[];
  expected_solution_actions: string[];
  correct_option: "A" | "B" | "C" | "D";
  option_misconception_map: Record<string, string[]>;
  option_diagnostic_notes: Record<string, string>;
  optional_future_calibration: {
    difficulty_label: string;
    discrimination_label: string;
    empirical_ctt_item_difficulty: number | null;
    empirical_ctt_discrimination: number | null;
    calibration_sample_notes: string | null;
  };
}
```

The fixed IRT MVP and teacher-review demo items now include provisional subskills, expected solution actions, option misconception maps, and option diagnostic notes in `administration_rules`.

These fields are marked:

```text
metadata_source = llm_proposed_v1
metadata_review_status = unreviewed
metadata_provisional = true
```

They are useful for internal packet construction and design review, but they require researcher/teacher review before stronger claims. They are not calibrated numeric item parameters. Missing optional calibration fields do not block packet generation; they become explicit evidence limitations.

## Evidence Categories

Each item receives one `ability_signal_category`:

```text
strong_understanding
emerging_understanding
misconception_signal
knowledge_gap
shallow_or_guess
ambiguous_mixed_evidence
insufficient_evidence
```

The rules are conservative:

- Correct option plus adequate reasoning and appropriate confidence can support `strong_understanding`.
- Correct option plus vague reasoning and high confidence becomes `shallow_or_guess`.
- Diagnostic distractor plus aligned misconception evidence and high confidence can become `misconception_signal`.
- Wrong answers do not automatically become misconceptions.
- E or explicit low-information evidence with low confidence becomes `knowledge_gap`.
- Correct answer plus low confidence becomes `emerging_understanding` with underconfidence evidence.
- Correct answer with diagnostic tempting option becomes `emerging_understanding` or fragile evidence rather than an unqualified strong claim.
- Wrong answer with correct tempting option and partial reasoning becomes `emerging_understanding`.
- Conflicting evidence remains `ambiguous_mixed_evidence` or `insufficient_evidence`.

## Reasoning Analysis

Phase 27a uses a deterministic v1 analyzer. It compares student reasoning against expected solution actions and safe diagnostic notes. The analyzer records:

- whether reasoning is available;
- quality: adequate, partial, vague, off-track, unknown, not analyzed;
- key ideas present and missing;
- misconception matches and support level;
- contradiction detection;
- analysis source.

A future LLM may be used as a semantic evidence extractor, but the final ability category must remain rule-aggregated and traceable. The system must not treat a raw LLM opinion as the final ability band.

## Confidence And Tempting Options

Confidence is used as evidence about calibration, not as a direct ability score. V1 records:

- well calibrated;
- overconfident;
- underconfident;
- uncertain;
- insufficient evidence.

Tempting options are diagnostic evidence. A diagnostic tempting option can reveal a misconception risk even when the selected answer is correct. A correct tempting option after a wrong answer can indicate partial access rather than complete lack of understanding.

## Process Data Boundary

Process data does not directly determine ability. It only modifies confidence in the evidence interpretation.

Examples:

- extremely rapid responses may lower inference confidence;
- repeated repair loops may lower inference confidence;
- enough deliberation may increase confidence in the evidence;
- pause/resume or interruption remains contextual and does not imply low ability.

Process data must not be used to infer misconduct, GenAI use, dishonesty, motivation as a stable trait, or engagement profile in this phase.

## Difficulty And Discrimination Policy

Numeric item difficulty and discrimination are not required for v1 ability evidence. Teacher labels such as easy, medium, hard, low, medium, and high are optional descriptors, not calibrated psychometric parameters.

Future calibration may add:

- empirical CTT item difficulty;
- empirical CTT discrimination;
- IRT calibration summaries;
- DCM-style diagnostic parameters;
- sample-size and population notes.

Any future calibrated values must include enough sample and model context to prevent overclaiming.

## Student Safety

The full packet is internal. It may include correct-option-derived internal scoring, diagnostic distractor mappings, misconception IDs, and evidence trace. These must not be exposed to students.

The only student-safe projection is:

```ts
{
  status: "Mostly understood" | "Still developing" | "Needs more work";
  short_explanation: string;
  next_focus: string;
}
```

Phase 27a does not render this projection. If a later phase renders it, the serializer must continue to hide answer keys, correctness labels, distractor metadata, misconception IDs, raw reasoning, raw provider output, and internal evidence trace.

## Smoke Test

Run:

```bash
npm run student:ability-evidence-smoke
```

The smoke test is no-live. It verifies deterministic evidence combinations, optional calibration behavior, process-data confidence modifiers, student-safe projection safety, and response-package packet generation for the fixed IRT MVP.

## Ability Evidence Packet Review

Run the review command:

```bash
npm run student:ability-evidence-review
```

By default, the command:

1. audits diagnostic metadata for current assessment items;
2. creates a temporary deterministic fixed-MVP sample session;
3. builds an internal ability evidence packet from the generated response package;
4. writes redacted artifacts under `.data/ability-evidence-review/`;
5. prints a concise JSON summary.

To review an existing completed package, pass a session public ID:

```bash
npm run student:ability-evidence-review -- --session-public-id <session_public_id>
```

Generated artifacts:

- `ability-evidence-review-<timestamp>.json`
- `item-diagnostic-metadata-review-<timestamp>.json`

These artifacts are intended for local design review and are ignored by Git. The ability review artifact includes item-level evidence summaries and the student-safe projection, but omits raw reasoning, raw item stems, correct option values, answer keys, distractor diagnostic text, raw misconception IDs in the student projection, raw process-event payloads, raw LLM output, and secrets.

Metadata status meanings:

- `complete`: concept, cognitive level, subskills, expected solution actions, internal correct option, and option-level diagnostic roles are present.
- `usable_with_limitations`: enough data exist to generate an ability packet, but one or more important diagnostic fields are missing.
- `insufficient`: concept, internal correct option, or option roles/diagnostic mapping are too incomplete for meaningful interpretation.

Incomplete metadata does not block packet generation when the packet can still be interpreted cautiously. Missing subskills, expected solution actions, or distractor diagnostics are limitations because they reduce the defensibility of ability interpretation. Missing numeric difficulty or discrimination does not reduce status by itself because those fields are optional future calibration fields, not required v1 evidence.

Use the review output to decide what teacher/researcher metadata should be filled before moving from evidence packets to stronger ability-profile inference. Engagement evidence should be designed separately; process data in this packet remains only an evidence-confidence modifier.
