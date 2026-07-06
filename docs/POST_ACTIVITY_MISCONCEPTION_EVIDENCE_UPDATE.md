# Post-Activity Misconception Evidence Update

## Purpose

Phase 30b defines the post-activity misconception evidence update layer for the distractor-informed MCQ prototype.

The activity output itself does not update the diagnosis. The student's response to the activity is the evidence source. A formative activity must therefore be evidence-eliciting: it should ask the student to explain, contrast, reconstruct, repair, or generate in a way that can support, weaken, or leave uncertain a distractor-linked misconception hypothesis.

A strong response to a single well-targeted activity can support a meaningful update when the response explains why a distractor is tempting, identifies the hidden assumption, contrasts the target idea, and uses the student's own words. The system must still remain conservative: use `no_actionable_misconception_evidence` when the current targeted hypothesis is unsupported, not "the student has no misconceptions."

## Literature Grounding

This design is grounded in evidence-centered design, distractor-informed assessment, self-explanation, active learning, and formative feedback literature. The references below support the design rationale; they do not prove that this implementation works in classrooms.

- Mislevy, Steinberg, and Almond's evidence-centered design frames assessment as a chain from student model to evidence model to task model. Phase 30b uses this framing by separating activity prompts from the evidence produced by student responses.
- Gierl, Bulut, Guo, and Zhang describe distractors in MCQ tests as potentially diagnostic when they are tied to plausible misconception-based reasoning. Phase 30b treats distractor responses as hypotheses to test rather than as generic wrong answers.
- Shin, Guo, and Gierl emphasize plausible distractors generated from misconceptions. Phase 30b uses the same principle when asking students to identify hidden assumptions or generate plausible alternatives.
- Chi, de Leeuw, Chiu, and LaVancher's work on self-explanation supports asking students to produce explanations that reveal conceptual understanding.
- Chi and Wylie's ICAP framework motivates requiring constructive or interactive student responses rather than treating tutor output as learning evidence.
- Shute's formative feedback review supports feedback that is specific, task-focused, and used to guide subsequent evidence collection.
- Hattie and Timperley's feedback model helps distinguish "Where am I going?", "How am I going?", and "Where to next?" questions, while Phase 30b narrows that idea to misconception evidence updating.

## Evidence-Eliciting Activity Principle

Every post-package activity should be designed around what new evidence it can elicit.

Examples:

- Basic concept grounding should elicit whether the student can state the basic concept distinction.
- Distractor contrast should elicit why a distractor is tempting, what hidden assumption it makes, and how the target idea differs.
- Reasoning-chain repair should elicit whether the student can repair a missing reasoning link.
- Independent reconstruction should elicit an own-words explanation without relying on option labels.
- Transfer and distractor generation should elicit whether the student can apply the boundary or generate a plausible non-target alternative.

The activity's explanation, wording, and prompt are not diagnostic evidence by themselves. Only the student's response can update the misconception evidence state.

## Misconception Update States

Phase 30b uses these internal update states:

- `conceptual_entry_gap_remains`
- `conceptual_entry_improved`
- `ready_for_distractor_probe`
- `misconception_persisted`
- `misconception_weakened`
- `misconception_unsupported`
- `no_actionable_misconception_evidence`
- `boundary_understanding_improved`
- `reasoning_boundary_still_blurred`
- `independent_evidence_supported`
- `insufficient_new_evidence`
- `student_chose_move_on`
- `student_requested_alternative_activity`

Key distinctions:

- `conceptual_entry_gap_remains` means the student still lacks enough basic concept access to diagnose a specific distractor-linked misconception.
- `ready_for_distractor_probe` means a basic distinction is now adequate enough to test a distractor-linked hypothesis.
- `misconception_unsupported` and `no_actionable_misconception_evidence` do not mean all misconceptions are absent.
- `student_chose_move_on` and `student_requested_alternative_activity` are student-choice states, not concept states.

## Evidence Quality

Allowed evidence quality values:

- `high`
- `medium`
- `low`
- `insufficient`

High-quality distractor-focused response evidence can be sufficient when it:

- explains why the distractor is tempting;
- identifies the hidden assumption;
- contrasts the target idea;
- uses the student's own words;
- connects the explanation to the current activity prompt.

Low or insufficient evidence includes:

- "I understand now" with no explanation;
- copied or parroted wording;
- unrelated responses;
- procedural-only questions;
- blank or off-task responses;
- activity requests that do not produce concept evidence.

Short "I don't know" or uncertainty responses can still be useful evidence about a conceptual entry gap, but they do not by themselves support a strong misconception update.

## LLM Evaluator Requirement

Production post-activity misconception update must be LLM-evaluated.

The future evaluator is:

```text
formative_activity_response_evaluator_agent
```

Future output schema:

```text
formative-activity-response-evaluation-v1
```

The evaluator input should include:

- redacted activity packet;
- safe student response text or safe summary;
- distractor role and student-safe distractor description;
- diagnostic purpose;
- concept focus;
- previous misconception diagnostic state;
- evidence-quality context summary.

The LLM evaluator makes the substantive diagnostic judgment:

- whether the response identifies a hidden assumption;
- whether the response explains a concept boundary;
- whether the response repairs a reasoning link;
- whether a generated distractor is meaningful;
- whether the current misconception hypothesis persisted, weakened, or is unsupported.

Deterministic logic may only enforce:

- schema validation;
- required fields;
- safety and privacy scans;
- protected-term scans;
- audit metadata;
- fail-closed behavior;
- redaction.

Deterministic logic must not be the final production decision-maker for:

- final misconception update status;
- hidden-assumption interpretation;
- conceptual-boundary judgment;
- response-substance diagnosis.

No deterministic fallback can count as live evaluation. A deterministic fixture can be used for smoke tests and review artifacts only.

## Packet Contract

The Phase 30b no-live schema is:

```text
student-activity-misconception-evidence-v1
```

Required packet properties include:

- `schema_version`
- `evaluator_agent_name`
- `evaluation_source`
- `runtime_servable_to_student`
- `review_only`
- public session/student/assessment/concept/activity identifiers;
- source activity schema, family, purpose, generation source, and runtime flag;
- student response kind and safe summary;
- evidence-elicitation target;
- evidence elicited;
- misconception evidence update;
- recommended next diagnostic purpose;
- student-safe feedback;
- safety checks.

No-live fixtures use:

```text
evaluation_source = no_live_fixture
runtime_servable_to_student = false
review_only = true
```

Phase 30c live evaluator smoke output uses:

```text
evaluation_source = live_llm
runtime_servable_to_student = false
review_only = false
```

The packet is internal and not directly student-servable. Student-facing UI may use only the separate `student_safe_feedback` projection after validation.

## Phase 30c Live Evaluator Smoke

Phase 30c adds an opt-in live smoke path for the
`formative_activity_response_evaluator_agent`. It does not wire the evaluator
into browser runtime activity execution, does not update profiles or diagnosis,
and does not mutate operational classroom records.

Default command:

```bash
npm run student:activity-misconception-evidence-live-smoke
```

The default command skips safely and makes no provider call. Paid live execution
requires explicitly setting:

```bash
RUN_LIVE_ACTIVITY_MISCONCEPTION_EVIDENCE_SMOKE=1
LLM_PROVIDER=openai
LLM_LIVE_CALLS_ENABLED=true
OPENAI_MODEL_PROFILE_INTEGRATION=<model>
OPENAI_MODEL_PLANNING=<model>
OPENAI_MODEL_FOLLOWUP=<model>
npm run student:activity-misconception-evidence-live-smoke
```

The live smoke runs eleven synthetic, redacted activity-response cases covering
conceptual entry with no usable distinction, conceptual entry with partial
improvement, conceptual entry ready for a distractor probe, strong and partial
distractor reasoning, persisted distractor logic, reasoning-boundary repair,
independent reconstruction, low-information agreement, move-on, and
alternative-activity requests.

Weak conceptual-entry evidence may remain a gap or show early improvement
depending on whether the response contains an emerging distinction. Stronger
conceptual-entry evidence may be reported as high-quality
`conceptual_entry_improved` or as `ready_for_distractor_probe`, depending on how
conservatively the evaluator separates improvement from next-step readiness.
The live smoke therefore keeps separate cases for no usable distinction,
partial improvement, and ready-for-probe evidence.

For `conceptual_entry_grounding`, the evaluator must stay in the conceptual
entry status family: `conceptual_entry_gap_remains`,
`conceptual_entry_improved`, or `ready_for_distractor_probe`. It must not use
distractor-update statuses such as `misconception_weakened` for conceptual-entry
grounding evidence.

Strong distractor-boundary evidence may conservatively weaken the current
hypothesis before fully marking it unsupported or no longer actionable.
Low-information agreement may remain `insufficient_new_evidence` or leave the
`conceptual_entry_gap_remains` state in place. It must not become conceptual
improvement, independent evidence, or no-actionable misconception evidence by
itself.

For `distractor_misconception_probe`, partial evidence that names some tempting
assumption evidence but leaves the target boundary incomplete should remain in
the distractor-update family, normally `misconception_weakened`. Reserve
`boundary_understanding_improved` for `reasoning_boundary_repair`. Process-only
limitation wording must not be combined with a substantive response-evidence
update such as `misconception_persisted`.

A response that restates the targeted tempting assumption is still elicited
response evidence, even when the reasoning remains problematic. It may support
`misconception_persisted`; it should not be marked as `none` evidence solely
because the misconception appears to persist.

Move-on and choose-other-activity responses are student-choice states. The
evaluator should preserve them as `student_chose_move_on` or
`student_requested_alternative_activity` rather than converting them into
concept-evidence states such as `insufficient_new_evidence`.

Optional local controls:

```text
ACTIVITY_MISCONCEPTION_EVIDENCE_SMOKE_CASES=<comma-separated case IDs>
MAX_LIVE_ACTIVITY_MISCONCEPTION_EVIDENCE_CASES=<positive integer>
```

By default, the opt-in live smoke covers all planned representative cases unless
a hard provider, quota, configuration, or validation failure stops execution.

Each live success must have:

- `evaluation_source=live_llm`;
- `runtime_servable_to_student=false`;
- `review_only=false`;
- a valid `student-activity-misconception-evidence-v1` packet;
- persisted `agent_calls` audit metadata;
- provider request or response ID metadata;
- token usage;
- no protected student-facing or artifact leakage.

One live repair attempt is allowed only for repairable schema or safe wording
issues. Protected leaks, no-live source mismatch, deterministic final decisions,
missing provider metadata, missing token usage, and missing audit metadata fail
closed and are not repaired.

Free-text evaluator fields must not repeat protected category names such as
answer-key terms, correctness terms, raw metadata terms, raw model-output terms,
or secret/header terms. When the evaluator needs to refer to these boundaries,
it should use a generic phrase such as "protected assessment details." This
keeps the safety scanner strict while avoiding self-referential blocked output.

A provider/schema-valid output can still fail the smoke if the selected
misconception evidence status is outside the case's allowed outcome set. Such
failures are reported as `outcome_mismatch`, not provider failures.

## Safety And Student-Facing Language

Student-facing text may say:

- "Your response gives useful evidence for this idea."
- "The next step can move forward without making a stronger claim than the evidence supports."
- "We can try a different activity."
- "Your explanation helped clarify the boundary between the ideas."

Student-facing text must not say:

- "You have no misconceptions."
- "Your misconception is fixed."
- "You used AI."
- "This looks suspicious."
- "Your engagement profile is low."
- "The correct answer is..."
- "The answer key shows..."
- raw distractor metadata or raw misconception identifiers.

Internal review artifacts must not include raw response text, raw process payloads, answer keys, correct option values, raw distractor metadata, raw misconception IDs, raw provider output, prompts, API keys, headers, cookies, database URLs, or session secrets.

## Commands

No-live smoke:

```bash
npm run student:activity-misconception-evidence-smoke
```

No-live review artifact:

```bash
npm run student:activity-misconception-evidence-review
npm run student:activity-misconception-evidence-review -- --session-public-id <session_public_id>
```

The review command writes redacted artifacts under:

```text
.data/activity-misconception-evidence-review/
```

The optional session argument reports whether post-activity response evidence appears available. Phase 30b does not execute runtime activity dialogue and therefore does not evaluate real activity responses yet.

## References

- Mislevy, R. J., Steinberg, L. S., & Almond, R. G. Evidence-centered assessment design.
- Gierl, M. J., Bulut, O., Guo, Q., & Zhang, X. Developing, analyzing, and using distractors for multiple-choice tests in education.
- Shin, J., Guo, Q., & Gierl, M. J. Multiple-choice item distractor development using misconceptions.
- Chi, M. T. H., de Leeuw, N., Chiu, M.-H., & LaVancher, C. Eliciting self-explanations improves understanding.
- Chi, M. T. H., & Wylie, R. The ICAP framework.
- Shute, V. J. Focus on formative feedback.
- Hattie, J., & Timperley, H. The power of feedback.
