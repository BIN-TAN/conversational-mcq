# Formative Evaluation Harness E2A

## Scope

E2A is an isolated, opt-in live-provider extension of the deterministic E1
formative evaluation harness. It tests whether natural variation in synthetic
student wording changes routing, distractor continuity, profile/plan evidence,
revision, transfer, recovery, privacy, or workflow reliability. Passing E2A
does not establish classroom effectiveness or validity.

E2A does not add an LLM rubric evaluator and does not implement E2B. Existing
qualitative rubric dimensions remain in the human-review queue.

## Authority boundary

The E1 scenario catalog, hidden student state, branching rules, hard invariants,
fixture isolation, and current operational workflow remain authoritative. The
LLM student simulator only realizes a deterministic permitted intent as natural
text:

```text
scenario truth
-> deterministic E1 branch
-> permitted response contract
-> isolated LLM surface realization
-> strict schema and semantic validation
-> current operational workflow
-> deterministic hidden-state transition
```

The simulator cannot update hidden truth, decide correctness, claim that a
misconception is resolved, select progression, or replace an operational agent.
Its output contains only the student message, rendered intent, evidence level,
four boolean annotations, and bounded warnings. Chain-of-thought is neither
requested nor persisted.

## Configuration isolation

Simulator configuration uses only `EVAL_LLM_STUDENT_SIMULATOR_*` variables and
is excluded from the operational approval bundle. The model name is required at
execution time and is not hardcoded. Live execution additionally requires:

```text
EVAL_E2A_LIVE_PROVIDER=1
EVAL_LLM_STUDENT_SIMULATOR_ENABLED=true
EVAL_LLM_STUDENT_SIMULATOR_MODEL=<evaluation model>
```

Without the explicit opt-in, live E2A commands fail before provider or database
access. Simulator and operational calls have separate provenance records. E2A
requires the active approved operational runtime hash to remain:

```text
8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993
```

It also refuses execution when tracked files under `config/` or
`src/lib/agents/` differ from `HEAD`.

## Approved runtime resolution

Approval, activation, local materialization, and runtime resolution are
separate operations:

```text
requested approved hash
-> immutable approval evidence
-> byte-identical approved candidate manifest
-> verified 17-role derived configuration
-> ignored local active-bundle pointer
-> approved-runtime resolver
-> exact effective role configuration
```

Approval authorizes a candidate. Production activation creates the persistent
production pointer. Local materialization copies an already-approved manifest
and evidence pair into ignored `.data` runtime state; it does not approve,
reapprove, regenerate, or edit either artifact. Runtime resolution verifies the
pointer and copied hashes on every read.

The local materializer deterministically selects the newest complete local
approval record for the requested runtime hash, unless `--derived-evaluation`
or explicit evidence/manifest paths narrow the selection. It revalidates source
evaluation immutability, human review, protocol identity, source-manifest byte
identity, exact role inventory, role version metadata, runtime hash, and
rollback binding. It is idempotent, disabled in production, writes only below
ignored `.data`, stores no secret, and makes no provider request.

```bash
npm run operational:approved-runtime:materialize-local -- \
  --expected-runtime-hash 8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993 \
  --confirm-local-materialization "materialize approved operational runtime locally"
```

If the requested derived bundle is missing, incomplete, corrupt, or bound to a
different hash, E2A reports `none` or the explicit mismatch and stops. A legacy
GPT-5.4 fallback is reported as `legacy_fallback`; it can never satisfy E2A's
approved-runtime requirement.

Before canary execution, readiness reruns the no-live E1 matrix and E1.2 privacy
smoke, verifies the local credential shape without exposing it, checks database
access, exact guarded-live selection, simulator/budget configuration, protected
files, and the complete 17-role bundle. It writes a short-lived, commit- and
simulator-bound attestation below `.data/formative-evaluation-e2a/`. Readiness
makes zero generation requests and currently makes zero metadata requests.
The E1 prerequisite is accepted only when its emitted result reports all 12
scenarios executed, 12 passes, zero failures, and zero provider calls; a zero
process exit alone is insufficient. Readiness also compares the approved topic
dialogue turn limit with the current input-contract maximum and fails closed on
an incompatible value.

## E2A.2 contract reconciliation

The approved policy value `10` means ten accepted student messages within one
bounded topic dialogue. It is not ten total transcript rows or ten formative
rounds. On the tenth call, complete visible history therefore consists of nine
prior student/assistant pairs plus the tenth student message identified
separately.

The approved `topic-dialogue-input-v2` contract has a different boundary. Its
`maximum_dialogue_turns` field is capped at eight, and
`recent_relevant_dialogue_turns` carries at most twelve message summaries.
`latest_student_message` is separate. Earlier visible turns are not carried
exactly in another approved field, so V2 cannot satisfy the ten-message policy.
This is classified as `approved candidate inconsistency`, not a readiness false
positive. Readiness for the currently approved runtime remains fail-closed.

The separate, unapproved candidate
`config/candidate-operational-agent-config.e2a2-topic-dialogue-contract-v1.json`
introduces `topic-dialogue-input-v3` and raises only the topic-dialogue recent
window from 12 to 18. V3 carries the 18 prior visible turns exactly, carries the
tenth student message separately, excludes hidden turns, and keeps protected
formative context separate. Its no-live candidate configuration hash is
`681ab5f96c9c18dfdd9aa17f335d3594a37cd7696bee6cbfe7c2e010c6943404`.
It is neither approved nor activated and cannot authorize E2A execution.

The focused reconciliation smoke emits expected and serialized visible turn
IDs, missing and duplicated IDs, order and exact-content checks, and the
context sections used. It proves that V2 remains incompatible while V3 is
semantically compatible.

## E2A.3 V3 candidate provider evaluation

E2A.3 evaluates only the separate, inactive V3 topic-dialogue contract
candidate. It does not run the E2A canary or 36-session student-simulator
matrix, and it does not approve or activate the candidate. The candidate hash
is `681ab5f96c9c18dfdd9aa17f335d3594a37cd7696bee6cbfe7c2e010c6943404`;
the approved V2 runtime remains
`8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993`.

The delta protocol contains 30 fixed synthetic provider cases: 18
tenth-student-message cases covering six critical long-history categories
three times each, plus 12 ordinary or boundary cases covering 1, 3, 5, and 8
student messages, revision-versus-transfer, and failed-transfer re-entry.

For a tenth-message call, the V3 input must carry all nine prior
student/assistant pairs as 18 exact, chronologically ordered visible-history
entries. The tenth student message remains separate. The initial formative
activity remains in the protected activity context, and invisible drafts are
excluded. A single missing, duplicated, reordered, or changed visible turn is
a critical failure.

Provider execution is sequential and bounded to at most 36 cases, 120
generation calls, 600,000 input tokens, 120,000 output tokens, and USD 25 when
complete versioned pricing exists. The repository default runs 30 cases with
at most two bounded retries per case. Pricing remains explicitly unavailable
when the registry lacks the exact candidate model; no cost is invented.

The current approval CLI does not support merging a role-scoped provider run
with inherited evidence into a new full-candidate approval. E2A.3 therefore
records immutable references to the active evidence for the 16 unchanged roles
and produces new evidence only for `topic_dialogue_agent`. Its approval packet
is a draft for human review, not final approval evidence. Every provider output
is included in the review packet; at minimum, a human must review every
tenth-turn and every flagged case. No LLM judge is used.

Artifacts are written below the ignored directory
`.data/e2a3-topic-dialogue-candidate-evaluation/<run-id>/`. Parsed validated
outputs and sanitized provider metadata are retained. Raw provider responses,
hidden prompts, chain-of-thought, credentials, and unrelated private data are
not retained. The run also compares protected approval, activation, prompt,
schema, validator, prior-run, and environment-metadata hashes before and after.

```bash
npm run eval:formative:e2a3:contract-smoke
npm run eval:formative:e2a3:no-live-smoke
npm run eval:formative:e2a3:preflight

EVAL_E2A3_LIVE_PROVIDER=1 \
LLM_PROVIDER=openai \
LLM_LIVE_CALLS_ENABLED=true \
npm run eval:formative:e2a3:live -- \
  --confirm-paid-api \
  --new-run \
  --expected-candidate-hash 681ab5f96c9c18dfdd9aa17f335d3594a37cd7696bee6cbfe7c2e010c6943404 \
  --expected-candidate-file-sha256 1c8ac4e1400fb68b22133a157ec856f6b2ce64a701cd50055e6a3c83d6306bde \
  --expected-evaluation-protocol-hash <printed-preflight-hash>

npm run eval:formative:e2a3:report
```

Until human review and a later explicit approval architecture step are
complete, the correct successful automated result is
`candidate_evaluation_incomplete`, with `human_review_pending`. The E2A canary
remains blocked.

The E2A.3 execution on 2026-07-18 ended as `candidate_evaluation_failed` before
network dispatch. All 18 tenth-turn context records passed, but the existing
`topic-dialogue-output-v2` runtime schema contains an optional non-nullable
`schema_version` field. OpenAI's Responses structured-output formatter requires
every field to be required, so all 30 fixed cases were rejected locally as
`provider_request_schema_invalid`. The corrected run recorded 30 adapter
attempts, zero generation dispatches, zero tokens, zero retries, and unchanged
protected artifacts. No student-facing output exists for human scoring. A
separate output-contract correction and fresh provider evaluation are required;
the V3 input candidate remains unapproved and inactive.

## E2A.4 strict output-contract candidate

E2A.4 preserves both earlier candidates and adds the separate unapproved file
`config/candidate-operational-agent-config.e2a4-topic-dialogue-contract-v2.json`.
Its configuration hash is
`34323b51adef1839b42be2f93b50874f6c649d2cb31e7f2434fbda132532fbab`
and its file SHA-256 is
`8178b5a0262c02a60c1e8cd7b436ad2c95013a1be446a625543b22c168806e18`.
The delta adds input V3, an exact visible-history window of 18, provider output
`topic-dialogue-output-v3`, and validator `eval-topic-boundary-v3`; all model,
prompt, token, fallback, and other-role settings remain inherited unchanged.

The V3 provider payload keeps `dialogue_schema_version` V2-compatible for the
existing semantic adapter and requires `schema_version` to be the exact,
non-null `topic-dialogue-output-v3` literal. Every generated object property is
required. Logical absence is represented by a required nullable field or an
empty array. Server code adapts validated V3 output to the existing V2 runtime
shape while retaining V3 schema and validator provenance in audit projection;
student projection omits schema metadata. Historical V2 records are not
rewritten.

The no-network audit compiles the exact production schema objects for all 17
roles through the installed OpenAI formatter. All corrected-candidate schemas
compile. The preserved V2 topic-dialogue schema is separately classified as an
approved-runtime latent incompatibility because it contains eight optional
object properties. The production request builder reached its pre-fetch
dispatch boundary for all 17 roles with zero network requests and no fallback.

The bounded live run `e2a4_20260718090055_abb9ff54` dispatched both canary
requests and received two schema-valid outputs. It had zero schema-request
failures, zero retries, zero privacy or answer-key findings, 3,955 input tokens,
823 output tokens, 231 reasoning tokens, and 17,133 ms aggregate latency. Exact
pricing was unavailable and was not invented. The canary failed because both
outputs violated the fixed no-premature-progression invariant; the tenth-turn
case also used an unexpected response function. The remaining 28 cases were
not run. Final status is `candidate_evaluation_failed`, human review remains
pending, and approval and activation remain forbidden.

```bash
npm run eval:formative:e2a4:schema-audit
npm run eval:formative:e2a4:request-compilation
npm run eval:formative:e2a4:contract-smoke
npm run eval:formative:e2a4:preflight

EVAL_E2A4_LIVE_PROVIDER=1 \
LLM_PROVIDER=openai \
LLM_LIVE_CALLS_ENABLED=true \
OPERATIONAL_APPROVED_CONFIG_HASH=8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993 \
npm run eval:formative:e2a4:live -- \
  --confirm-paid-provider-evaluation \
  --candidate-hash 34323b51adef1839b42be2f93b50874f6c649d2cb31e7f2434fbda132532fbab \
  --max-cases 30 \
  --max-calls 120 \
  --max-cost-usd 25

npm run eval:formative:e2a4:report
```

The candidate-wide evidence draft inventories all 17 roles, references the
active immutable evidence for the 16 unchanged roles, and attaches new
topic-dialogue evidence. Those inherited references are not represented as
human approval for this candidate. Every generated output is included in a
pending human-review packet. The E2A four-session canary and 36-session matrix
remain blocked.

## Execution isolation

Formative evaluation scopes execution mode to each command or service call:

| Mode | Provider behavior | Safe recovery |
| --- | --- | --- |
| `deterministic_e1` | deterministic/mock-safe adapters | not eligible because live access is absent |
| `no_live_e2a_contract` | deterministic injected behavior | not eligible because live opt-in is absent |
| `e2a_readiness` | configuration and provenance validation only | no generation |
| `live_e2a_canary` | approved configured live runtime after explicit opt-in | eligible for genuine bounded failures |
| `production` | existing configured runtime | eligible for genuine bounded failures |

The mode is not stored in mutable process-global state. Read-only projection
prefers the dialogue limit persisted with the workflow, and bounded recovery
may read approved policy without treating that read as dispatch authorization.
Actual live dispatch and readiness still enforce approved-hash, environment,
credential, and provider checks. Deterministic E1 therefore does not become a
provider-unavailable recovery run when an approved runtime is materialized.

## Contracts and validation

The simulator receives the scenario/version and expression variant, controlled
persona state, one controlled misconception description and focus reference,
the permitted response contract, at most 12 relevant visible activity/dialogue
turns, the latest assistant message, and style constraints. It does not receive
operational profiles, plans, evaluator output, prompts, answer-key structures,
teacher rationales, provider metadata, configuration internals, or rubric
scores.

Strict validation rejects malformed output, unsupported intent, empty or
oversized messages, intent mismatch, evidence stronger than permitted, missing
clarification, forbidden mastery claims, hidden-state contradiction, changed
item or misconception, off-topic mismatch, unrelated topics, simulator
self-disclosure, internal terminology, answer-key language, and near-duplicate
expression. At most two regeneration attempts are allowed. Exhaustion ends the
session without submitting invalid text and places it in human review.

## Canary and full matrix

The canary contains one expression variant for:

- `repeated_conceptual_confusion`
- `unsupported_understanding_claim`
- `revision_succeeds_transfer_fails`
- `direct_answer_and_prompt_injection`

The gate requires four completed sessions, scenario-contract compliance, zero
critical or major invariant failures, zero privacy or answer-key findings, zero
missing replies or invalid transitions, zero unrecovered simulator contract
failures, the approved runtime hash, and all call/token/cost limits. The full
command refuses to start unless a canary artifact from the same source commit,
simulator configuration, and operational runtime passed.

The full matrix is the 12 E1 scenarios times three expression variants, for 36
isolated sessions. Variants change wording, length, directness, uncertainty, and
minor grammar only. They preserve scenario truth, misconception identity,
permitted evidence, expected resolution timing, and hard invariants.

## Budget and retries

| Stage | Sessions | Simulator calls | Total provider calls | Maximum cost |
| --- | ---: | ---: | ---: | ---: |
| Canary | 4 | 24 | 150 | USD 15 |
| Full | 36 | 216 | 1200 | USD 100 |

Input/output token caps are also enforced. Environment values may lower but not
raise these defaults. The harness checks budget before each simulator call and
new session, reserves a conservative per-session provider estimate, and
reconciles sanitized operational usage before fixture cleanup, including on
failure. Operational retries remain governed by the approved runtime. The
simulator transport performs no provider retry and permits at most two contract
regenerations.

Dollar estimates are recorded only when complete versioned pricing is
available. Otherwise cost status is `unavailable`; the harness does not invent a
price and continues to enforce call and token caps.

## Privacy, artifacts, and review

The E1.2 recursive privacy scanner runs on major student projections and
refreshes. Simulator metadata is never added to the student projection. Local
artifacts are written below `.data/formative-evaluation-e2a/`, which Git ignores.
Per-session evidence includes simulator turns and validation, hidden-state
transitions, hidden-truth compatibility, separated provider usage, sanitized
core artifacts, and failure state. Aggregate outputs are:

```text
e2a-canary-summary.json
e2a-full-summary.json
e2a-scenario-variants.jsonl
e2a-human-review-queue.csv
e2a-provider-usage.json
variant-comparison.json
```

Artifacts redact credentials, authentication data, database IDs, raw provider
output, hidden prompts, and secret-like values. API keys, cookies, session
secrets, authentication headers, and chain-of-thought are never stored.

The queue includes failed or invariant-affected runs, privacy findings,
premature resolution, hidden-truth conflicts, significant cross-variant
differences, recovery, simulator contract failures, transfer, and resolved
misconceptions. It also includes at least one passing run per scenario. A human
must review student-facing quality; E2A does not use an LLM judge.

## Commands

```bash
npm run eval:formative:e2a:contract-smoke
npm run eval:formative:e2a:contract-reconciliation-smoke
npm run eval:formative:e2a:no-live-smoke
npm run eval:formative:e2a:readiness-smoke

OPERATIONAL_APPROVED_CONFIG_HASH=8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993 \
OPERATIONAL_AGENT_MODE=guarded_live \
LLM_PROVIDER=openai \
LLM_LIVE_CALLS_ENABLED=true \
EVAL_E2A_LIVE_PROVIDER=1 \
EVAL_LLM_STUDENT_SIMULATOR_ENABLED=true \
EVAL_LLM_STUDENT_SIMULATOR_MODEL=<evaluation-model> \
npm run eval:formative:e2a:readiness

# Use the same variables and simulator settings after readiness passes:
OPERATIONAL_APPROVED_CONFIG_HASH=8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993 \
OPERATIONAL_AGENT_MODE=guarded_live \
LLM_PROVIDER=openai \
LLM_LIVE_CALLS_ENABLED=true \
EVAL_E2A_LIVE_PROVIDER=1 \
EVAL_LLM_STUDENT_SIMULATOR_ENABLED=true \
EVAL_LLM_STUDENT_SIMULATOR_MODEL=<evaluation-model> \
npm run eval:formative:e2a:canary

# E2A.1 stops after the canary. Only a later, separately authorized phase may run:
npm run eval:formative:e2a:full

npm run eval:formative:e2a:report
```

## Limitations and E2B boundary

Synthetic expression variation is not real student evidence. Hidden-truth
compatibility uses bounded deterministic rules, not exact ontology equality.
Unavailable pricing prevents a complete dollar estimate. Passing E2A supports
engineering robustness under controlled language variability only.

E2B may be considered only after E2A engineering acceptance, completed human
review, reconciled provider accounting, and an explicit new specification. E2B
must not be inferred or activated by this harness.

## E2A.5 progression adjudication

E2A.5 is a no-provider forensic and candidate-design phase. It preserves the
failed E2A.4 run and separates six progression levels that the earlier binary
rubric collapsed: `internal_recommendation`,
`student_facing_progression_offer`, `platform_authorization`,
`ui_progression_availability`, `executed_transition`, and
`terminal_completion`. A provider recommendation is advisory and is not proof
that the platform authorized, displayed, or executed a transition.

The two E2A.4 responses came from a synthetic provider harness that created no
session, activity runtime, UI projection, or progression command. No
operational transition occurred. The three-turn response nevertheless
recommended progression and visibly said the student was ready while the
server-owned readiness inputs remained not ready. The tenth-turn response
directly answered the student's conceptual question, so its original
`direct_response_function` failure was a deterministic false positive; its
structured final-support recommendation still exceeded authorization.

Path C therefore creates inactive candidate
`candidate-operational-agent-config.e2a5-topic-dialogue-progression-v1.json`.
Input V4 adds required server-owned progression authorization, the prompt
forbids broadening that authorization, and validator V4 rejects unauthorized
recommendations, visible progression claims, response-function mismatch, lost
distractor focus, unsupported mastery, and progression in place of help.
Rejection permits at most one bounded regeneration. No provider call was rerun,
human review remains pending, and V5 is neither approved nor active.

```bash
npm run eval:formative:e2a5:smoke
npm run eval:formative:e2a5:adjudicate
npm run eval:formative:e2a5:report
```

## E2A.6 V5 topic-dialogue provider evaluation

E2A.6 evaluates only the inactive V5 topic-dialogue delta. Before dispatch it
normalizes every provider or legacy action to `remain_in_dialogue`,
`request_revision`, `present_transfer`, or `complete_episode`. Unknown,
obsolete, contradictory, or broader actions are rejected by a platform gate
independently of candidate validator V4 and leave the activity active with a
student-safe response. Authorization fields and their concise evidence summary
are server-owned, retained in audit projection, and omitted from student
projection.

The no-network gate compiles all 17 production request mappings with topic
input V4, output V3, and validator V4. The live evaluator first runs five fixed
authorization cases. Only a 5/5 pass permits the fixed 30-case provider
protocol, including 18 exact tenth-turn histories. Every provider attempt,
including the one permitted validator regeneration, enters the human-review
packet. Six progression levels remain separate and no operational transition
is executed.

```bash
npm run eval:formative:e2a6:smoke
npm run eval:formative:e2a6:preflight
npm run eval:formative:e2a6:request-compilation

EVAL_E2A6_LIVE_PROVIDER=1 \
LLM_PROVIDER=openai \
LLM_LIVE_CALLS_ENABLED=true \
OPERATIONAL_APPROVED_CONFIG_HASH=8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993 \
npm run eval:formative:e2a6:live -- \
  --confirm-paid-provider-evaluation \
  --candidate-hash 37e563710ae04ff1004f8e20b5484ee56189f964b0afb5ee5f818d324c11a712 \
  --canary-max-cases 5 --canary-max-calls 15 --canary-max-cost-usd 8 \
  --full-max-cases 30 --full-max-calls 120 --full-max-cost-usd 25

npm run eval:formative:e2a6:report
```

Allowed automated outcomes are
`provider_evidence_ready_for_human_review`, `candidate_evaluation_failed`, or
`candidate_evaluation_incomplete`. None approves or activates V5. Human scores
and decisions remain null until explicit human review. The E2A four-session
student-simulator canary and 36-session matrix remain blocked.

## E2A.7 authorization-specific topic-dialogue design

E2A.7 is a no-provider forensic adjudication and V6 contract-design phase. It
preserves the failed V5 run `e2a6_20260719000538_6cd0cec4`, whose historical
result remains 1/5 automated passes, 7 invalid attempts, and 5 bounded
regenerations. The original summary undercounted overrides because accepted,
rejected, and overridden gate outcomes were aggregated with an exclusive
`else if` chain. E2A.7 instead records schema validity, candidate semantics,
regeneration, action alignment, visible-language alignment, gate authorization,
override, fallback, UI availability, and execution as independent dimensions.

V5 was unstable because one generic generation contract asked the model both
to write the message and to choose or echo the progression action across four
authorization modes. V6 removes that responsibility. The platform selects one
of `remain_in_dialogue`, `request_revision`, `present_transfer`, or
`complete_episode` before request construction, then selects the matching
prompt and strict output schema. Provider output contains no action
recommendation. After semantic validation, the independent platform gate
applies the action it already authorized.

Each mode has a positive communication function, a restricted
`response_function`, and a deterministic mode-specific safe fallback. Failed
generation never changes the selected mode. Deterministic replay of all ten V5
outputs and no-network production request compilation are design evidence only;
they do not change the failed V5 decision or establish provider quality for V6.
A fresh bounded provider canary and explicit human review remain required.

```bash
npm run eval:formative:e2a7:smoke
npm run eval:formative:e2a7:request-compilation
npm run eval:formative:e2a7:adjudicate
npm run eval:formative:e2a7:report -- --run <run_id>
```

These commands make no provider request. Candidate
`candidate-operational-agent-config.e2a7-topic-dialogue-mode-contract-v1.json`
is unapproved and inactive.
