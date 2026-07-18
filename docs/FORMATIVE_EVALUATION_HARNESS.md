# Formative Evaluation Harness (E1 and E2A)

## Purpose and boundary

Phase E1 is a deterministic, no-provider evaluation harness for the existing
formative workflow. It asks two separate questions:

1. **Engineering reliability:** did persisted turns, profile/plan activation,
   activity state, transcript reconstruction, fallback, idempotency, privacy,
   and platform-owned transitions behave correctly?
2. **Pedagogical behavior:** did the visible exchange remain distractor-focused,
   respond to the latest evidence, change instructional operation when needed,
   and avoid unsupported learning claims?

An engineering invariant is never replaced by a pedagogical score. Qualitative
rubric dimensions that cannot be established from structured evidence are
marked `manual_review_required` rather than assigned an invented score.

> Passing the E1 harness demonstrates workflow reliability and scenario-consistent behavior under deterministic simulation. It does not establish effectiveness with real students.

E1 does not implement an LLM student, an LLM judge, prompt approval, runtime
activation, or a teacher evaluation dashboard. It never dispatches a provider
request.

## Architecture

The implementation is under `src/lib/evaluation/formative/`. It calls the real
student assessment services for initial administration, response-package
completion, profile and plan persistence, activity runtime, topic dialogue,
idempotent replay, transcript projection, refresh reconstruction, and transfer.
The only injected boundaries are deterministic student behavior and existing
mock-safe agent results.

The central no-live guard sets operational execution to disabled/mock-safe,
disables both student-facing role toggles, rejects all E1 live opt-in variables,
and verifies zero provider evidence before a run artifact can be written.

## Scenario contract

`FormativeEvaluationScenarioSchema` is strict. Each scenario contains:

- stable snake-case ID, version, title, and description;
- the `fixed_irt_e1_v1` isolated fixture with exactly three initial items and
  one transfer item;
- `scripted` or `branching` simulator mode;
- hidden initial student state;
- exactly three initial response records;
- an administered focus item, option, evidence source, and misconception;
- mode-specific scripted turns or branching policy;
- minimum replies and strategy changes, non-resolution timing, permitted final
  states, prohibited transitions, and distractor-focus expectations;
- selected hard invariant IDs and pedagogical expectations; and
- human-readable tags.

Cross-field validation rejects missing/duplicate initial items, a transfer item
used as the initial focus, mismatch between the declared focus option and the
selected/tempting evidence, a missing mode policy, mixed simulator contracts,
unknown transitions, invalid item counts, unstable IDs, and duplicate catalog
IDs.

## Hidden simulated state

The hidden truth model records conceptual state, misconception status, task
understanding, engagement, confidence, communication style, independence
interpretability, evidence changes, and turn index. It controls deterministic
student behavior and is written only to internal evaluation artifacts. It is
never supplied to operational profiling, planning, activity, communication, or
topic-dialogue agents. Operational interpretations are compared cautiously;
one-to-one ontology agreement is not assumed.

## Student simulation

Scripted scenarios apply authored messages and explicit state patches in order.
Branching scenarios inspect only observable assistant output and structured
policy state. Seeded phrase banks vary wording without changing misconception,
item/option focus, expected resolution timing, or final-state constraints.

Branch rules cover repeated abstract explanation, concrete clarification,
partial evidence, unsupported understanding claims, off-topic redirection,
substantive revision, transfer failure, recurrence, and direct answer dumping.
Every branch artifact records the rule, observed condition, prior state,
generated message, resulting state, and the reason for change or non-change.

The catalog contains:

1. `confirmed_misconception_high_confidence`
2. `repeated_conceptual_confusion`
3. `task_language_confusion`
4. `correct_answer_weak_reasoning`
5. `correct_answer_robust_reasoning`
6. `partial_understanding_improves`
7. `unsupported_understanding_claim`
8. `low_information_engaged`
9. `off_topic_then_reengages`
10. `revision_succeeds_transfer_fails`
11. `misconception_recurs_after_improvement`
12. `direct_answer_and_prompt_injection`

## Engineering invariants

The evaluator records strict pass/fail results, severity, evidence reference,
and message for these invariants:

- accepted turn receives a later visible assistant turn;
- assistant and transcript sequence indexes remain causal and increasing;
- profile and plan update, or an explicit stale-version fallback is recorded;
- the activity retains a distractor anchor;
- answer-key, internal profile/plan, agent, and fallback metadata stay hidden;
- at most one activity is active and replacement preserves prior history;
- refresh projection and immutable visible turns match their original snapshot;
- approved runtime hash remains
  `8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993`;
- no provider call or invalid transition occurs;
- idempotent replay creates no extra cycle; and
- every recovery is typed.

Critical failures always fail a scenario. `--fail-on-major` also gives the CLI
a failing exit status when any completed run has a major invariant finding.

## Pedagogical rubric

Scores use `0` (contradicted), `1` (partial/ambiguous), and `2` (clearly met),
plus separate `not_applicable` and `manual_review_required` statuses.

E1 deterministically scores direct response, visible-history continuity,
distractor focus, strategy adaptation, failed-strategy repetition,
generic-tutoring avoidance, answer dumping, substantive evidence elicitation,
and premature resolution when structured records support the judgment.
Task-versus-concept confusion and revision/transfer dimensions are scored only
in applicable scenarios. Misconception targeting, distractor plausibility,
reasoning-failure diagnosis, target-concept support, profile/plan evidence
quality, and student-facing naturalness remain manual when qualitative judgment
is required.

Strategy changes come from structured activity and dialogue functions, not
wording variation. The operation classes include clarification, example,
contrast, narrowed question, distractor comparison, revision, transfer,
off-topic redirect, and safe recovery.

## Fixture isolation

Each run creates a uniquely namespaced assessment, concept unit, three initial
items, one transfer item, and disposable student. It does not use
`student_demo`. Cleanup deletes only records linked to that fixture and runs in
success and failure paths. Generated artifacts are ignored by Git.

## Artifacts and reports

Every run directory contains the sixteen files defined in the E1 specification:
manifest, scenario, initial/final hidden states, student/assistant/branch turns,
profile and plan histories, activity attempts, internal evaluations, state
transitions, hard invariants, rubric, safety findings, and run summary.

The manifest records source commit, runtime hash, fixture public IDs, timestamps,
cleanup outcome, `provider_access_enabled=false`, and
`provider_call_count=0`. Redaction blocks credentials, database IDs, payloads,
prompts, raw model output, and secret-like tokens.

Aggregate output is `summary.json`, `scenario-results.jsonl`, and
`human-review-queue.csv`. Reports group by scenario, simulator, seed,
misconception, initial conceptual/engagement/confidence state, and final outcome.
The review queue always includes failures, critical/major findings, resolution,
transfer, recovery, privacy findings, and manual rubric work, then uses a stable
deterministic sample for otherwise unselected passing runs.

## E1.1 failure classification and correction record

E1.1 reproduced the four original failures independently with seeds 1001-1004
before changing runtime behavior. The following classifications are part of the
completion record; no hard invariant, required turn, severity, or scenario risk
was removed.

| Finding | Classification | Divergence evidence | Responsible correction |
| --- | --- | --- | --- |
| `repeated_conceptual_confusion` | dialogue-routing defect; scenario-runner observation defect | The first branch message said it understood the task but retained the item-difficulty misconception. A broad substring readiness check ended the exchange after one reply. The runner also labelled ordinary deterministic fallback as safe recovery and therefore obscured actual strategy changes. | Platform readiness now rejects continued-confusion evidence, deterministic dialogue changes instructional operation by turn, and runner strategy extraction reads persisted `response_function` metadata. |
| `unsupported_understanding_claim` | dialogue-routing defect | `I understand now.` produced readiness language despite supplying no substantive, distractor-specific evidence. | A code-level readiness gate keeps the misconception unresolved and requests evidence tied to the current item/option anchor. |
| `misconception_recurs_after_improvement` | state-transition defect | The second turn produced apparent resolution and the persisted evaluator recommendation became terminal before the third contradictory turn could be accepted. | Evaluator progression is advisory; only a platform/student progression action is terminal. Contradictory evidence can run a new profile, plan, and visible dialogue cycle. |
| `revision_succeeds_transfer_fails` | state-transition defect; scenario-runner defect | Revision readiness was treated as episode completion, and the scripted transfer-failure evidence was submitted as ordinary activity chat instead of through the transfer-item administration path. | Revision and transfer readiness remain separate. The runner completes the actual transfer item, and an incorrect transfer response reprofiles, replans, and reopens formative dialogue. |
| exact replay after terminal completion | idempotency-semantics defect | Terminal-state validation ran before a completed-key lookup, and completion rows did not retain the exact returned projection. | The completed-key lookup runs first and returns the stored completed projection without new records; a new key is still rejected as terminal. |

There was no invalid scenario expectation and no deterministic mock-adapter
contract change. The runner changes correct scenario sequencing and structured
strategy observation; the production runtime changes correct the application
behavior. `npm run eval:formative:e1.1-smoke` asserts the nine focused E1.1
contracts. `npm run eval:formative:compare -- --before <old-root> --after
<new-root> --output <path>` writes a read-only before/after comparison from the
emitted run summaries.

## E1.2 production-like privacy alignment

E1.2 aligns `npm run e2e:privacy-smoke` with the current production workflow.
It uses one uniquely namespaced disposable student, one published assessment,
one published concept, exactly three included initial items, and exactly one
transfer item. The fixture owns deterministic keys, distractor rationales,
reasoning expectations, and misconception indicators, and cleanup removes only
that namespace in both success and failure paths.

The smoke exercises initial administration, package review, internal profile
and plan creation, a distractor-anchored `FORMATIVE_ACTIVITY`, two iterative
topic-dialogue turns, revision, transfer, failed-transfer re-entry, refresh,
transcript reconstruction, and safe recovery. All provider boundaries are
injected mock-safe boundaries and the run asserts zero OpenAI calls.

Student privacy is checked across serialized state, review, transcript,
activity-runtime and action responses, plus rendered page text. The recursive
scanner rejects protected fields at any depth, including answer/scoring data,
internal profile and plan objects, agent provenance, and fallback/failure
metadata. A visible-text scanner separately rejects internal enums and obvious
serialized labels. Controlled leaking fixtures prove both scanners can fail.
Authorized teacher audit output must contain the corresponding profile, plan,
prompt/schema version, and agent-call provenance while the student payload
omits them; hidden prompts and chain-of-thought are not exported to either
surface.

### Legacy-to-current assertion mapping

| Legacy assertion | Current replacement assertion | Reason for change |
| --- | --- | --- |
| Package completion immediately reaches `followup_active` | Package completion persists profile and plan records, then exposes `FORMATIVE_ACTIVITY` and an active runtime attempt | `followup_active` is not the authoritative post-package student phase. |
| One follow-up message proves the interaction path | Two accepted activity/topic-dialogue messages each persist a later assistant turn with a greater `sequence_index` | Current instruction is iterative and ordering is persistence-backed. |
| One flat serialized payload contains no forbidden tokens | Recursive key/value scanning covers state, review, transcript, runtime, command responses, and rendered text | Protected data may be nested or transformed into visible enum labels. |
| A generic seeded classroom fixture is sufficient | A unique one-student, one-concept, three-initial-plus-one-transfer fixture is created and removed per run | Isolation prevents mutable demo progress and unrelated records from affecting privacy evidence. |
| Follow-up completion is the terminal privacy boundary | Revision and transfer are distinct; an insufficient transfer re-enters formative dialogue and preserves prior transcript order | Current platform progression separates evidence revision, transfer, and re-planning. |
| Student omission alone proves access separation | The same versioned profile/plan/agent provenance is present in authorized teacher audit and absent from student surfaces | The inverse assertion proves intentional boundary separation rather than missing persistence. |
| Generic fallback output is accepted when student-safe | Recovery text is scanned while typed provider, retry, stale-profile, stale-plan, and failed-call details remain audit-only | Current recovery is resumable but must not expose operational failure internals. |

Focused scanner diagnostics are available through:

```bash
npm run student:formative-privacy-smoke
npm run e2e:privacy-smoke
```

E1.2 changes no prompt, provider schema, validator, manifest, approval evidence,
activation history, or approved runtime hash. It does not add E2 simulation or
rubric judging.

## Commands

```bash
npm run eval:formative:scripted -- --scenario confirmed_misconception_high_confidence --seed 1001 --runs 3
npm run eval:formative:branching -- --seed 1001 --runs 1
npm run eval:formative:scenario -- --scenario task_language_confusion --seed 1001
npm run eval:formative:all -- --artifact-dir artifacts/formative-evaluation
npm run eval:formative:report -- --artifact-dir artifacts/formative-evaluation
npm run eval:formative:smoke
npm run eval:formative:e1.1-smoke
npm run eval:formative:compare -- --before artifacts/formative-evaluation --after .data/formative-evaluation-e1-1-final
```

All execution commands support `--scenario`, `--seed`, `--runs`,
`--artifact-dir`, `--keep-fixture-on-failure`, and `--fail-on-major` where the
option is meaningful. Default behavior always cleans the fixture.

## Limitations and E2 extension points

Deterministic students cover declared policies, not the variation, ambiguity,
motivation, language, or unanticipated behavior of real students. Mock-safe
operational outputs cannot estimate live model variance, latency, token use, or
cost. Manual rubric dimensions still require a reviewer.

E2A implements only the separately opt-in LLM student surface-realization
adapter documented in `docs/FORMATIVE_EVALUATION_E2A.md`. It preserves the same
scenario truth, branching authority, workflow, invariants, fixture cleanup, and
privacy scanner. It does not implement an LLM rubric judge. E2B remains outside
the implemented scope and requires a separate specification and approval.

E2A live execution additionally requires a fresh readiness attestation for the
exact source commit, simulator configuration, and approved derived runtime.
Local development may materialize an existing immutable approval record into
ignored `.data` with `operational:approved-runtime:materialize-local`; this is
not production activation or reapproval. Missing state and explicit legacy
fallback remain fail-closed for E2A. The E2A.1 scope ends after the four-session
canary and does not run the 36-session matrix.
Readiness parses the E1 result counts rather than trusting only the command exit
status. It also rejects an approved dialogue-policy turn limit that exceeds the
current topic-dialogue input contract; this mismatch must be resolved through a
separately reviewed configuration or contract change before paid execution.
