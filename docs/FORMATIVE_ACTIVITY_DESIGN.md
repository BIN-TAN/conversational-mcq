# Formative Activity Design

Phase 29a added the no-live design layer for the formative activity that follows profile integration and formative value determination. Phase 29b adds a live-capable first-turn generation and quality-review path for controlled smoke testing. It still does not render a browser UI, execute a full runtime activity, or update the profile after the activity.

## Scope

Formative value determination chooses the broad purpose of the next interaction. The formative activity layer implements that purpose through a complete explanation plus multi-turn dialogue. It is not a single feedback string and it is not a new scored item. It should eventually help the student revise thinking, produce new evidence, choose another activity, or move on.

The activity packet uses:

- `profile-integration-interpretation-v1`
- `formative-value-determination-v1`
- safe response-package summaries
- safe distractor summaries
- internal engagement context only as reliability context

The output schema is `student-formative-activity-v1`. The live generator agent name is `formative_activity_dialogue_agent`, and the quality reviewer agent name is `formative_activity_quality_reviewer_agent`.

## Review-Only Generation Boundary

The deterministic Phase 29a builder is QA infrastructure only. Packets created
by this builder have:

```text
generation_source = deterministic_review
runtime_servable_to_student = false
review_only = true
```

These packets may be used for schemas, validators, redaction and safety
scanning, no-live fixtures, review artifacts, and regression tests. They must
not be served as the real student-facing formative activity dialogue.

Production activity generation must come from the future live LLM
`formative_activity_dialogue_agent` path with:

```text
generation_source = live_llm
runtime_servable_to_student = true
review_only = false
```

The runtime helper `assertFormativeActivityPacketIsNotReviewOnlyForRuntime`
rejects deterministic review packets. Provider failure must fail closed or
offer a safe student choice/move-on path; it must not silently serve
deterministic templates as a fallback.

## Live Generator and Quality Review

Phase 29b adds a controlled live-capable pipeline for first-turn generation:

1. `formative_activity_dialogue_agent` generates a `student-formative-activity-v1` packet.
2. Deterministic schema, privacy, and safety validators run before acceptance.
3. `formative_activity_quality_reviewer_agent` reviews the packet using schema `formative-activity-quality-review-v1`.
4. The reviewer may return `pass`, `repair_needed`, or `fail_closed`.
5. A single bounded repair attempt is allowed only for safe text-quality issues.
6. Deterministic validators run again after repair.
7. The packet is accepted only if all hard gates pass.

Reviewer approval never overrides deterministic hard gates. Protected leakage,
wrong source metadata, missing provider/audit metadata, missing token usage,
provider failure, quota failure, repeated timeout, and severe schema mismatch
fail closed. Deterministic review packets remain invalid for runtime student
serving.

The live smoke is opt-in:

```bash
RUN_LIVE_FORMATIVE_ACTIVITY_SMOKE=1 npm run student:formative-activity-live-smoke
```

By default, `npm run student:formative-activity-live-smoke` skips without
making a provider call. When enabled, it covers all six activity families and
writes redacted summaries under `.data/formative-activity-live-smoke/`. The
optional `FORMATIVE_ACTIVITY_SMOKE_FAMILIES` comma-separated variable can limit
the family set for local diagnostics.

## Activity Families

| Family | Typical formative value | Profile conditions | Distractor use | First-turn style |
|---|---|---|---|---|
| `basic_concept_grounding` | `diagnostic_clarification` | likely knowledge gap or insufficient concept access | optional contrast only | start from the basic concept, connect to the response pattern, ask one simple explanation prompt |
| `distractor_contrast` | `diagnostic_clarification` or `reasoning_refinement` | likely misconception, selected diagnostic alternative, or tempting alternative | selected, tempting, or contrast distractor | explain why the alternative feels tempting, name the hidden assumption in safe language, ask for comparison |
| `reasoning_chain_repair` | `reasoning_refinement` | developing understanding with a missing reasoning link | optional contrast | preserve the useful part of reasoning, show the missing link, ask for one revised sentence |
| `independent_reconstruction` | `independent_understanding_verification` | mixed, conflicting, insufficient, or reliability-limited evidence | optional reactivation | ask for the student's own reconstruction without mentioning AI or process labels |
| `confidence_evidence_audit` | `confidence_calibration` | adequate understanding evidence with underconfidence or inconsistent confidence | optional contrast | connect confidence to evidence, not to a feeling alone |
| `transfer_and_distractor_generation` | `consolidation_and_transfer` | stable understanding and student-safe status of Mostly understood | generated distractor or near transfer | extend the idea without creating a scored item |

## Dialogue Protocol

The mode is `complete_explanation_plus_dialogue`.

The first turn must:

- be specific to the current profile/formative value;
- include a concept explanation;
- connect to a safe summary of the student's prior response package;
- use distractor contrast when relevant;
- avoid generic "good job" or "review the concept" feedback;
- avoid template-spliced field phrasing such as repeated "Your responses" clauses or internal summary labels;
- avoid internal labels such as ability evidence, ability packet, profile integration, formative value packet, engagement category, AI-assistance signal, and process data;
- use family-specific wording rather than one shared template for every activity family;
- end with exactly one clear student action prompt;
- avoid answer keys, correctness labels, raw distractor metadata, raw misconception IDs, raw process payloads, and internal labels.

For human-review samples, the first turn must also be genuinely readable prose,
not a sequence of stitched field labels. `basic_concept_grounding` needs a
short conceptual explanation with several sentences, a concrete analogy or
contrast, a safe link to the prior response pattern, and one own-words prompt.
`reasoning_chain_repair` must name the useful part, the missing link, and why a
tempting alternative becomes plausible when the link is skipped. `confidence_evidence_audit`
must connect the student's confidence to safe evidence in the explanation,
not to internal evidence labels. `transfer_and_distractor_generation` must make
clear that the task is unscored, that transfer means using the same distinction
in a nearby situation, and that creating a plausible alternative is for showing
the concept boundary rather than tricking anyone.

The protocol allows up to three turns before a summary. The student can continue the activity, choose another activity, or move on. Evidence updates are planned but gated: ability evidence, engagement evidence, profile integration, and formative value may be updated only after the student responds to the activity. Production post-activity update is intentionally not implemented in Phase 29a.

## Distractor Policy

Distractors are diagnostic reasoning paths, not just wrong options to eliminate. The activity may use:

- `selected_distractor`: the selected alternative as a safe contrast point;
- `tempting_distractor`: the tempting alternative named by the student;
- `contrast_distractor`: a plausible alternative reasoning path;
- `reactivation_distractor`: a contrast point when option-choice evidence has limited diagnostic value;
- `generated_distractor`: a student-generated, unscored plausible alternative for transfer;
- `none`: no distractor contrast needed.

Student-facing text may discuss a "tempting option" or "alternative reasoning path" but must not reveal answer keys, correct options, raw diagnostic metadata, or raw misconception identifiers.

Distractor-focused samples must include a concrete student-safe distractor
description. Generic language such as "a tempting alternative" or "surface
clue" is not enough unless the text also explains the safe conceptual contrast,
why the alternative feels plausible, the hidden assumption, and how the target
idea differs.

## Safety

The validator rejects student-facing output containing:

- answer-key language;
- correct-option or correctness labels tied to options;
- raw distractor metadata or raw misconception IDs;
- raw reasoning labels, raw process payloads, or raw provider output;
- API keys, authorization headers, session secrets, or database URLs;
- engagement category, AI-assistance signal, or process-data labels;
- cheating, misconduct, integrity, authenticity, suspicious, low-engagement, disengaged, or low-participation language;
- activity-planning leakage that creates a scored item;
- unstructured wall-of-text output with no next student action.

The validator also rejects broken concept-focus instructions such as "Focus on..." embedded inside an explanation, impersonal student-facing wording such as "the student appears", fake distractor contrast that relies only on generic surface-clue language, missing hidden assumptions, missing basic-concept depth, missing transfer or distractor-generation logic, colon-spliced field labels, duplicated label sentences, and distractor-focused families that have no meaningful distractor role or safe contrast description.

Review artifacts are written under `.data/formative-activity-review/` and are redacted. They include safe packet metadata, a non-null sample ID, activity family, formative value, safe profile status, safe distractor role, first-turn text only if validation passes, expected student action, quality issues, safety checklist, and limitations. Human-readable first-turn sample artifacts include all six families and, when available, the current real-session review target.

## Commands

No-live activity smoke:

```bash
npm run student:formative-activity-smoke
```

No-live activity review with synthetic fallback:

```bash
npm run student:formative-activity-review
```

No-live activity review for an existing session:

```bash
npm run student:formative-activity-review -- --session-public-id <session_public_id>
```

The current known review target is:

```bash
npm run student:formative-activity-review -- --session-public-id sess_20260701_v2n-8a0
```

## Future Phases

Phase 29c may add post-activity evidence, profile integration, and formative value updates after the student responds. Phase 29d may add the student UI dialogue. Runtime execution and browser display remain outside Phase 29b.

## Research-Facing Rationale

The design follows the idea that useful formative feedback is specific, supportive, and aimed at helping the learner modify thinking. The activity can target task understanding, reasoning process, or self-regulation. Self-explanation and dialogue are used because they ask the student to produce new evidence rather than simply read feedback. Distractors can represent plausible alternative reasoning paths; using them safely can help the student contrast assumptions and refine the concept boundary.
