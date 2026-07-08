# Distractor-Informed Misconception Diagnosis

## Core Construct

The revised dissertation and system framing is **distractor-informed misconception diagnosis in AI-assisted MCQ assessment**.

Distractors are diagnostic representations of plausible but non-target reasoning paths. In AI-assisted MCQ contexts, students may reach correct answers without engaging with distractors, which can reduce the diagnostic value of option selection. The system reactivates distractors through dialogue to recover interpretable evidence about students' misconception states.

Key terms:

- `distractor-informed misconception diagnosis`: an evidence-centered interpretation process that uses selected options, tempting options, reasoning, confidence, and dialogue responses to form, test, weaken, or reject misconception hypotheses tied to distractor logic.
- `distractor as diagnostic reasoning path`: a distractor is not merely an incorrect option. It represents a plausible reasoning route that can reveal how a student is construing the concept.
- `distractor-linked misconception evidence`: evidence that a student's answer, tempting-option evidence, reasoning, confidence, or later dialogue response aligns with a plausible but non-target reasoning path represented by a distractor.
- `conceptual entry gap`: evidence that the student lacks enough conceptual access to diagnose a specific distractor-linked misconception. This is not the same as a misconception.
- `evidence-quality context`: process, timing, response-production, and engagement context used to judge how much weight to place on response evidence. It is not a misconduct label and not direct misconception evidence.

## Dissertation Claim Boundary

This dissertation designs and evaluates a distractor-informed conversational assessment system for diagnosing and updating students' misconception evidence in AI-assisted MCQ contexts. Rather than treating distractors as options to be avoided, the system uses them as diagnostic representations of plausible reasoning paths. When students reach correct answers directly or with AI assistance, distractor-focused dialogue can reactivate the diagnostic value of distractors by asking students to explain why a plausible alternative is tempting, what assumption it makes, and how it differs from the target concept.

This claim is narrower than a broad adaptive tutoring claim. It concerns the design and evaluation of an evidence-centered diagnostic workflow, not proof of complete learning gain, general ability measurement, or all-purpose tutoring effectiveness.

## What The System Does

The system:

- collects response packages from protected initial MCQ administration;
- links selected and tempting options to distractor-misconception hypotheses;
- interprets reasoning and confidence as evidence about the student's current conceptual model;
- uses process data as evidence-quality context for deciding how strongly to interpret response evidence;
- integrates response, distractor, reasoning, confidence, and evidence-quality context into a misconception diagnosis profile;
- selects a distractor-informed diagnostic purpose for the next interaction;
- uses activity dialogue to elicit new diagnostic evidence;
- updates misconception evidence conservatively after the student responds to the activity.

The existing implementation still contains compatibility names such as ability evidence, engagement evidence, profile integration, formative value, and formative activity. In the Phase 30a framing, these are implementation layers that support misconception diagnosis rather than the dissertation's central constructs.

## What The System Does Not Claim

The system must not be represented as:

- a general ability profiling system;
- a broad adaptive tutoring system;
- a complete learning gain intervention;
- a cheating detection system;
- an all-purpose feedback taxonomy;
- proof that all activity families are equally central;
- proof that no other misconceptions exist when no actionable evidence is found.

The system also does not claim that distractor-linked evidence is always available. If evidence is weak, mixed, sparse, or low reliability, the system should preserve uncertainty rather than force a misconception label.

## Diagnosis States

Internal diagnosis states:

- `strong_distractor_linked_misconception`
- `suspected_distractor_linked_misconception`
- `conceptual_entry_gap`
- `insufficient_or_low_reliability_evidence`
- `misconception_weakened_after_activity`
- `no_actionable_misconception_evidence`

Definitions:

- `strong_distractor_linked_misconception`: multiple aligned evidence sources support a specific distractor-linked misconception hypothesis.
- `suspected_distractor_linked_misconception`: one or more evidence sources suggest a plausible distractor-linked misconception, but support is not yet strong enough for a high-confidence diagnosis.
- `conceptual_entry_gap`: the student does not yet show enough basic conceptual model to diagnose a specific misconception path.
- `insufficient_or_low_reliability_evidence`: response evidence is missing, sparse, conflicting, or process/context limitations prevent a confident diagnostic interpretation.
- `misconception_weakened_after_activity`: later activity response evidence suggests that the targeted misconception hypothesis is less supported than before.
- `no_actionable_misconception_evidence`: current evidence does not support a specific actionable distractor-linked misconception. This is not proof that no misconception exists.

Misconception means a plausible but non-target reasoning path is visible. It should not be used for every wrong answer, every weak answer, every low-confidence answer, or every sparse response.

## Role Of Process Data

Process data are evidence-quality context only.

Process data may influence:

- confidence in the diagnosis;
- whether independent reconstruction is needed;
- whether evidence is too sparse or low reliability;
- whether the system should avoid strong claims.

Process data must not be used to:

- label cheating;
- accuse misconduct;
- directly infer ability;
- directly infer misconception without response evidence;
- expose engagement, AI-assistance, or process labels to students.

AI or external-assistance context is allowed as a reliability context only. It is not a cheating finding and must not become student-facing accusation language.

## Distractor Functions

### A. Diagnostic Anchoring

A selected or tempting distractor activates a possible misconception hypothesis. The system can use selected answer, tempting option, reasoning, confidence, and item-level distractor metadata to decide whether the distractor logic is relevant.

### B. Diagnostic Reactivation

When a student gives a correct or polished answer with weak distractor evidence, the system may reactivate a plausible distractor through dialogue. The goal is not to trick the student. The goal is to recover interpretable evidence about whether a plausible non-target reasoning path is active.

### C. Diagnostic Updating

After activity dialogue, the system updates whether the misconception persisted, weakened, was unsupported, or remains unclear. Activity output itself is not evidence of learning. Only the student's response to the activity can update the diagnosis.

Phase 30b defines this post-activity update as a separate evidence layer in
`docs/POST_ACTIVITY_MISCONCEPTION_EVIDENCE_UPDATE.md`. The update uses the
student's activity response as evidence, not the tutor's activity message. A
single high-quality distractor-focused response can support a meaningful
current-hypothesis update, but the system must use
`no_actionable_misconception_evidence` rather than claiming the absence of all
misconceptions.

## Formative Purposes

The dissertation framing replaces broad formative-value language with four distractor-informed diagnostic purposes:

| Purpose | Used when | Activity direction |
|---|---|---|
| `conceptual_entry_grounding` | The student has a conceptual entry gap, very weak reasoning, low confidence with weak evidence, or no clear misconception path. | Build a basic conceptual foothold before testing a specific misconception. |
| `distractor_misconception_probe` | Selected option, tempting option, reasoning, or confidence suggests a distractor-linked misconception. | Reactivate or contrast the plausible distractor path and ask the student to explain its assumption. |
| `reasoning_boundary_repair` | The student has partial understanding but does not clearly separate the target concept from distractor logic. | Repair the conceptual boundary between target reasoning and distractor reasoning. |
| `independent_misconception_verification` | The answer is correct or polished but diagnostic evidence is weak, mixed, or reliability-limited. | Ask for an own-words reconstruction that can support or weaken a misconception hypothesis. |

Confidence calibration is a modifier, not a core formative purpose. Transfer and consolidation are exit or extension paths, not the central taxonomy for this dissertation framing.

## Activity Role

Activities should be distractor-aware by design and distractor-focused only when evidence warrants it.

Core activity family reframing:

- Basic concept grounding serves conceptual entry gaps.
- Distractor contrast serves suspected or strong distractor-linked misconception evidence.
- Reasoning boundary repair serves partial understanding where the target idea and distractor logic are not clearly separated.
- Independent reconstruction with distractor reactivation serves weak, mixed, polished, or reliability-limited evidence.

Not every activity must directly use a distractor. Every activity should serve misconception diagnosis, weakening, or verification. The activity prompt is not itself evidence of learning; the student's response to that activity is the evidence that can update the misconception diagnosis.

## Loop Policy

The loop policy is:

> Loop until no actionable distractor-linked misconception evidence remains, until the current misconception hypothesis is weakened or unsupported, until evidence becomes insufficient, until the student chooses to move on, or until a runtime guard stops the loop.

The system must not be described as looping until all misconceptions are eliminated.

Phase 30f implements this as a backend runtime loop skeleton only. The loop
stores activity attempts, accepts a safe student activity response, invokes the
live response evaluator only through explicit runtime paths, persists validated
post-activity evidence and snapshots, and maps evaluator output into next-action
recommendations. The mapping is routing policy, not diagnostic inference. It
must respect student choices to move on or choose another activity.

## Terminology Crosswalk

| Previous term | New dissertation framing | Notes |
|---|---|---|
| ability profile | misconception diagnosis profile | Do not claim general ability. |
| engagement profile | evidence-quality context | Supports confidence in diagnosis. |
| profile integration | misconception diagnostic integration | Integrates distractor, reasoning, confidence, and process context. |
| formative value | distractor-informed diagnostic purpose | Four-purpose taxonomy. |
| formative activity | misconception/distractor-aware dialogue | Collects new diagnostic evidence. |
| AI assistance signal | evidence reliability context | Not cheating detection. |
| confidence calibration | confidence alignment modifier | Not core taxonomy. |
| consolidation and transfer | exit/extension path | Not central dissertation construct. |

## Compatibility With Current Implementation

Phase 30a does not rename code enums, database fields, scripts, or provider schemas. Existing names remain for compatibility:

- `ability-evidence-packet-v1` supports misconception diagnosis by organizing response and distractor-linked evidence.
- `engagement-evidence-packet-v1` supports evidence-quality context.
- `profile-integration-interpretation-v1` should be read as misconception diagnostic integration.
- `formative-value-determination-v1` should be read as distractor-informed diagnostic purpose selection.
- `student-formative-activity-v1` should be read as misconception/distractor-aware dialogue output.
- `student-activity-misconception-evidence-v1` should be read as the
  post-activity student-response evidence packet for future LLM-evaluated
  misconception updates.
- `activity_misconception_evidence_records` and
  `post_activity_diagnostic_snapshots` should be read as persisted review/audit
  records for post-activity misconception evidence, not as replacement ability
  profiles or claims of classroom validity.
- `activity_runtime_attempts` should be read as backend attempt lifecycle
  records for the post-activity runtime loop skeleton. They are not browser UI
  records, not operational profile replacements, and not classroom-validity
  evidence.

Future implementation phases may rename or introduce schemas only after migration, compatibility, and audit implications are explicitly approved.

## Teacher/Research Export Boundary

Phase 30i research exports support misconception-diagnosis analysis without
dumping raw diagnostic metadata. Default exports include safe summaries of
profile, formative-purpose, activity, post-activity evidence, and diagnostic
snapshot records. They do not include raw misconception IDs, raw distractor
rationales, raw provider outputs, answer keys, or correct options.

If a researcher needs item keys for separate controlled analysis, they must use
the explicit restricted item-key export option. The default ZIP manifest marks
`restricted_item_keys_included=false`.

## Phase 30k Correctness-Inflation Safeguard

Correct option selection is not sufficient evidence of understanding. A
target-aligned answer can be strong evidence only when reasoning, confidence,
and conceptual-boundary or distractor-boundary evidence support it.

Phase 30k adds internal/research-only evidence-quality indicators:

- `unsupported_correct_response`
- `correctness_support_level`
- `estimated_guessing_risk`
- `estimated_guessing_risk_basis`
- `answer_selection_evidence_weight`
- `uncertainty_marker_present`
- `uncertainty_marker_types`

These indicators prevent the system from treating a target-aligned selection
with weak reasoning, low confidence, uncertainty markers, or missing
distractor-boundary explanation as stable understanding. Such cases should be
routed toward conceptual entry grounding, distractor misconception probing, or
independent misconception verification rather than consolidation/transfer.

The indicators are not shown to students. Student-facing language may say that
the explanation needs clearer reasoning or that the idea still needs
clarification. It must not say the student guessed, has a guessing risk, has an
unsupported correct response, has a correctness support level, selected the
correct answer, or reveal answer keys/correctness.

These safeguards are not cheating detection, misconduct detection, direct
ability estimates, or final misconception evaluations. Deterministic code may
enforce evidence sufficiency and anti-overclaiming; substantive misconception
evaluation remains the role of validated LLM/evidence workflows where
approved.
