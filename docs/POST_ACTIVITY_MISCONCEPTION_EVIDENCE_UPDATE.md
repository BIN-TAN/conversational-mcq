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

## Phase 30d Persistence and Review Snapshot

Phase 30d adds an audit-backed persistence layer for post-activity
misconception evidence. It does not implement browser runtime activity
execution, broad profile replacement, or deterministic production diagnosis.

Persisted records are stored in:

```text
activity_misconception_evidence_records
post_activity_diagnostic_snapshots
```

The evidence record keeps the validated packet, public session/student/
assessment/concept/activity references, the source evaluator `agent_call`
reference, evaluation source flags, activity family, response kind, evidence
elicited types, update status, evidence quality, next diagnostic purpose,
student-safe feedback, safety flags, limitations, and creation time.

The snapshot is a review-layer diagnostic state summary. It can include:

- `pre_activity_diagnostic_state`;
- the activity evidence update;
- `post_activity_diagnostic_state`;
- update strength;
- evidence quality;
- next diagnostic purpose;
- student-safe feedback;
- limitations and interpretation boundaries.

The snapshot does not replace an operational profile and does not overwrite the
pre-activity diagnostic state. The LLM evaluator output is the substantive
source for production updates; deterministic code maps fields, validates
safety, enforces audit requirements, and fails closed.

Production persistence requires:

- `evaluation_source=live_llm`;
- `review_only=false`;
- `runtime_servable_to_student=false`;
- no deterministic final diagnostic decision;
- source evaluator `agent_call` exists;
- evaluator call succeeded and output validated;
- provider request or response metadata exists;
- token usage exists;
- student-safe feedback passes protected-term validation.

Production persistence rejects:

- `no_live_fixture`;
- `review_only` packets;
- deterministic final diagnostic decisions;
- missing evaluator audit;
- missing provider metadata;
- missing token usage;
- unsafe student-safe feedback.

No-live fixture packets may be persisted only with explicit
`production_mode=review_artifact` for review artifacts and regression tests.

Review commands:

```bash
npm run student:activity-misconception-update-smoke
npm run student:activity-misconception-update-review
npm run student:activity-misconception-update-review -- --session-public-id <session_public_id>
```

The review command makes no provider call. It writes redacted artifacts under
`.data/activity-misconception-update-review/`. If a requested session has no
persisted post-activity evidence, the command exits with
`completed_with_limitations` and records the missing-evidence limitation.

Artifacts must not include raw provider output, raw prompts, headers, secrets,
answer keys, correct options, correctness labels, raw distractor metadata, raw
misconception IDs, raw process payloads, or raw student responses when they are
not already represented as a safe summary.

## Phase 30e Live Persistence Smoke

Phase 30e adds a backend-only paid-live smoke that proves the live evaluator
output can pass production persistence guards and create a diagnostic update
snapshot without browser runtime execution.

Default command:

```bash
npm run student:activity-misconception-live-persistence-smoke
```

The default command skips and makes no provider call. Manual paid execution
requires explicit live configuration:

```bash
RUN_LIVE_ACTIVITY_MISCONCEPTION_PERSISTENCE_SMOKE=1 \
LLM_PROVIDER=openai \
LLM_LIVE_CALLS_ENABLED=true \
OPENAI_MODEL_PROFILE_INTEGRATION=<model> \
OPENAI_MODEL_PLANNING=<model> \
OPENAI_MODEL_FOLLOWUP=<model> \
npm run student:activity-misconception-live-persistence-smoke
```

The smoke uses three synthetic, redacted cases:

- conceptual-entry partial distinction;
- strong distractor-probe response;
- student move-on response.

Each successful case must:

- call the live `formative_activity_response_evaluator_agent`;
- validate the `student-activity-misconception-evidence-v1` packet;
- confirm the selected update status is allowed for the case;
- pass the Phase 30d production persistence guard;
- persist an `activity_misconception_evidence_records` row;
- create a `post_activity_diagnostic_snapshots` row;
- preserve the pre-activity diagnostic state as snapshot context;
- avoid replacing operational profiles or mutating response packages;
- generate a redacted review artifact.

Outcome mismatches fail before persistence. Deterministic fixtures,
review-only packets, missing evaluator audit, missing provider metadata,
missing token usage, failed evaluator calls, unsafe feedback, and deterministic
final decisions fail closed.

Live persistence smoke artifacts are written under:

```text
.data/activity-misconception-live-persistence-smoke/
```

Artifacts include run status, case summaries, evaluator call summaries,
persistence guard status, persisted public record IDs, snapshot public IDs,
update status, evidence quality, next diagnostic purpose, student-safe feedback
summary, safety flags, and token usage. They do not include raw provider
output, raw prompts, raw protected assessment content, secrets, or headers.

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

## Phase 31M Context Source For Post-Activity Evaluation

The `formative_activity_response_evaluator_agent` receives the shared
`assessment-interpretation-context-v1` when live/runtime evaluation is prepared.
For post-activity evaluation, the context includes the original response
package evidence, teacher diagnostic guidance, administered item snapshot IDs,
safe process summaries, and a prior activity evidence summary. This preserves
the boundary that the student's activity response is the new evidence source
while the original teacher notes remain guidance, not ground truth.

Post-activity evaluator audit metadata may store the context schema version,
snapshot IDs, context hash, and boolean presence flags. It must not store raw
teacher notes, raw activity responses, prompts, raw provider output, answer
keys, correct options in student-visible payloads, API keys, or secrets.

## Phase 30f Backend Runtime Loop Skeleton

Phase 30f adds a backend-only activity runtime loop skeleton. It coordinates
live-servable formative activity packets, student activity responses, the
`formative_activity_response_evaluator_agent`, Phase 30d persistence, and
post-activity diagnostic snapshots. It does not add browser UI, does not update
the operational profile, and does not mutate original response packages.

Runtime attempts are stored in `activity_runtime_attempts`. Each attempt records
public session/student/assessment/concept identifiers, a safe source activity
packet reference, activity family, diagnostic purpose, generation source,
first-turn/reviewer/repair agent-call references, current backend state, a safe
latest student-response reference, latest evidence/snapshot public IDs, and
limitations. The source activity packet must be `generation_source=live_llm`,
`runtime_servable_to_student=true`, and `review_only=false`; deterministic
review packets and no-live fixtures are rejected.

The runtime loop states are:

```text
activity_ready
activity_first_turn_generated
awaiting_student_activity_response
student_activity_response_received
evidence_evaluation_pending
evidence_evaluated
evidence_persisted
post_activity_snapshot_created
continue_recommended
choose_alternative_recommended
move_on_recommended
failed_closed
```

Deterministic runtime code maps already-evaluated fields into backend state and
next-action options only. It does not decide whether a misconception persisted,
weakened, or became unsupported. The LLM evaluator remains the substantive
source for production misconception evidence updates, and Phase 30d production
guards still reject no-live fixtures, review-only packets, missing provider
metadata, missing token usage, failed agent calls, unsafe feedback, and
deterministic final diagnostic decisions.

Runtime routing policy:

- `move_on_or_exit` and `student_chose_move_on` recommend move-on.
- `student_requested_alternative_activity` recommends choosing another
  activity.
- `conceptual_entry_gap_remains` recommends continuing conceptual entry
  grounding.
- `conceptual_entry_improved` and `ready_for_distractor_probe` recommend a
  distractor misconception probe.
- `misconception_persisted` recommends continued distractor probing.
- `misconception_weakened`, `boundary_understanding_improved`, and
  `reasoning_boundary_still_blurred` recommend reasoning-boundary repair.
- `no_actionable_misconception_evidence` recommends move-on or optional
  extension, depending on evaluator next-purpose output.
- `insufficient_new_evidence` recommends retrying, choosing another activity,
  or moving on without claiming improvement.

New commands:

```bash
npm run student:activity-runtime-loop-smoke
npm run student:activity-runtime-loop-review
npm run student:activity-runtime-loop-live-smoke
```

The no-live smoke uses injected synthetic live-shaped evaluator outputs and
makes no OpenAI call. The live smoke skips unless
`RUN_LIVE_ACTIVITY_RUNTIME_LOOP_SMOKE=1` is set with explicit live provider
configuration. Review artifacts are written under:

```text
.data/activity-runtime-loop-review/
.data/activity-runtime-loop-live-smoke/
```

## Phase 30g Minimal Student Runtime UI

Phase 30g adds the first minimal browser-facing runtime surface for the
activity loop. The student UI may prepare an activity, show a student-safe
focus label, show the live activity first turn, collect one activity response,
show safe post-response feedback, and offer **Choose another activity** or
**End assessment**. Choosing another activity must immediately show one
different executable activity, not an abstract menu. End assessment completes
the attempt after confirmation.

The UI receives only a student-safe projection. It must not expose internal
activity-family enum labels, diagnostic-purpose enum labels, misconception
status, evidence-quality labels, engagement or AI labels, provider metadata,
raw process payloads, raw distractor metadata, answer keys, correct options,
correctness labels, raw LLM output, or raw student-response audit data.

Runtime start is allowed only from a validated formative activity packet with:

```text
generation_source = live_llm
runtime_servable_to_student = true
review_only = false
```

Deterministic review packets and no-live evidence fixtures remain QA-only and
fail closed if used as runtime student-facing content or production
misconception evidence.

Student activity responses are evaluated through the existing Phase 30f runtime
loop. A valid response may create an `activity_misconception_evidence_records`
row and a `post_activity_diagnostic_snapshots` row, but it does not replace the
student profile, mutate the original response package, change item content, or
alter scoring. Provider/evaluator failure, unsafe student-facing feedback, or
missing live provenance produces a safe fail-closed state with options to try
again, choose another activity, or move on.

New no-live smoke:

```bash
npm run student:activity-runtime-ui-smoke
```

The smoke creates synthetic sessions, injects live-shaped activity and
evaluator outputs, verifies the student projection, confirms deterministic and
no-live artifacts are rejected for runtime use, and makes no OpenAI call.

## Teacher/Research Completeness Visibility

Phase 30h adds a read-only session data audit that summarizes post-activity
runtime and evidence-update completeness without changing runtime behavior. It
reports:

- `activity_runtime_attempts` count, latest state, generation-source counts,
  student choice-state counts, failed-closed count, and limitations.
- `activity_misconception_evidence_records` count, evaluation-source counts,
  production-mode counts, update-status counts, evidence-quality counts, safe
  safety-flag key counts, and recommended next-purpose counts.
- `post_activity_diagnostic_snapshots` count, before/after state availability,
  update-status counts, and recommended next-purpose counts.

The audit is available from:

```bash
npm run student:session-data-completeness-review -- --session-public-id <session_public_id>
```

and from the teacher session-review **Session evidence audit** tab. It is
aggregate-only and must not expose raw student responses, raw process payloads,
raw provider outputs, answer keys, correct options, correctness labels,
distractor metadata, raw misconception IDs, internal database UUIDs, or secrets.

## Phase 30k Evidence-Quality Safeguards

Post-activity updates must preserve the same anti-overclaiming rule used for
initial response packages: correct option selection is not sufficient evidence
of understanding. If a response is target-aligned but reasoning is weak,
missing, unrelated, contradicted, low-confidence, or marked by uncertainty,
the update should treat the answer-selection evidence as weak or unsupported
until the student provides reasoning, conceptual-boundary evidence, or
distractor-boundary evidence.

Internal/research evidence-quality fields such as
`unsupported_correct_response`, `correctness_support_level`,
`estimated_guessing_risk`, `answer_selection_evidence_weight`, and
`uncertainty_marker_types` may inform sufficiency and anti-overclaiming
decisions. They must not be shown to students and must not be interpreted as
misconduct labels, cheating detection, motivation diagnoses, direct ability
estimates, or final misconception evaluations.

## References

- Mislevy, R. J., Steinberg, L. S., & Almond, R. G. Evidence-centered assessment design.
- Gierl, M. J., Bulut, O., Guo, Q., & Zhang, X. Developing, analyzing, and using distractors for multiple-choice tests in education.
- Shin, J., Guo, Q., & Gierl, M. J. Multiple-choice item distractor development using misconceptions.
- Chi, M. T. H., de Leeuw, N., Chiu, M.-H., & LaVancher, C. Eliciting self-explanations improves understanding.
- Chi, M. T. H., & Wylie, R. The ICAP framework.
- Shute, V. J. Focus on formative feedback.
- Hattie, J., & Timperley, H. The power of feedback.

## Current Per-Turn Runtime Correction

The earlier Phase 30g one-response note is superseded for the active formative
episode. A validated activity response still creates immutable misconception
evidence and a post-activity snapshot, and it now also feeds the existing
profile-update and planning-update roles before the next topic-dialogue reply is
generated. Those candidate records do not become active independently:
profile, plan, active pointers, visible assistant turn, and final activity state
commit together.

Visible transcript entries contain only messages actually shown to the student.
Evaluator outputs, rejected candidates, routing recommendations, validation
issues, and fallback metadata remain in a separate internal history. If
evaluation or later orchestration cannot complete safely, the attempt returns
to an awaiting state with an immutable neutral recovery reply. A self-report of
understanding alone cannot set misconception evidence to resolved; substantive
reasoning, revision, transfer, or consistent later evidence is required, and
contradictory evidence may weaken or reopen a prior judgment.
