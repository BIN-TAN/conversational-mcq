# E2A.42 CBA Evaluation Framework Protocol Freeze

## Status

E2A.42 is a deterministic, no-live protocol freeze for evaluating
Conversation-Based Assessment (CBA). It does not execute an autonomous
dialogue, call a provider, approve a candidate, or activate a candidate.

- Protocol version:
  `e2a42-cba-evaluation-framework-freeze-v1`
- Framework version:
  `evaluation-framework-v1`
- Protocol hash:
  `8e3e42352ba285620e6fd01903b2d4eb9b380c8b29cb77ec4d7fa60620d8b169`
- Composite runtime identity:
  `3715fc851a07b69e80cffd4744da50478b61163505781d28b87bb28a53ab7bcc`
- Provider calls: `0`
- Network requests: `0`
- Authoritative packet:
  `.data/e2a42-cba-evaluation-framework-protocol-freeze/e2a42_20260725T163409246Z_dc8f8ce2/`

## Purpose

The framework evaluates whether CBA:

1. diagnoses misconceptions and knowledge gaps accurately;
2. uses observable evidence rather than keywords or unsupported claims;
3. selects appropriate personalized interventions;
4. supports measurable learning progression;
5. avoids unnecessary or prematurely terminated dialogue;
6. produces clear, useful, bounded student communication; and
7. creates useful, reproducible teacher and research evidence.

The framework supports dissertation-level study design, but its deterministic
fixtures are not empirical estimates of effectiveness. Any efficacy,
generalization, or causal claim requires a separately approved research design,
human review, and appropriate data.

## Protected Boundary

E2A.42 adds an evaluation layer only. It does not modify:

- Evaluator V5 or the tutor candidate;
- canonical anchor evidence;
- anchor reference, stance, or scope resolution;
- evidence-preservation mapping;
- learning or engagement profile evolution;
- intervention memory;
- stopping or instructor-handoff policy;
- E2A.40 multi-student isolation; or
- E2A.41 research auditability.

Every deterministic run verifies protected source hashes and reproduces the
frozen E2A.40 and E2A.41 protocol and composite identities.

## Contracts

The freeze defines:

- `evaluation-framework-contract-v1`
- `diagnostic-evaluation-contract-v1`
- `intervention-quality-contract-v1`
- `learning-progression-contract-v1`
- `dialogue-efficiency-contract-v1`
- `student-experience-contract-v1`
- `teacher-utility-contract-v1`
- `baseline-comparison-contract-v1`
- `evaluation-replay-contract-v1`
- `e2a42-artifact-contract-v1`
- `e2a42-budget-contract-v1`
- `e2a42-composite-runtime-identity-v1`

The student-experience and teacher-utility contracts also retain the requested
evaluation identities:

- `student-experience-evaluation-v1`
- `teacher-research-utility-evaluation-v1`

## Evaluation Dimensions

### Diagnostic Accuracy

Metrics cover misconception detection, false sound, missed misconceptions,
sound detection, knowledge-gap identification, and profile-transition
accuracy. False sound is a critical error: observable evidence must satisfy
the sound criteria before readiness can be assigned.

### Evidence Quality

The framework records whether decisions use reasoning, confidence, distractor
stance, conceptual application, revision, and transfer evidence. Keyword-only
responses, copied wording without understanding, unsupported understanding
claims, and dropped essential evidence must remain non-sound.

### Intervention Quality

The fixture includes three students with the same misconception but different
needs:

- a conceptual distinction;
- confidence calibration; and
- a counterexample.

Their intervention strategies must differ. Reusing generic identical feedback
is evaluated as a personalization weakness.

### Learning Progression

The framework evaluates evidence gain, profile improvement, turns to
resolution, regression reopening, and transfer evidence. It does not require
an exact scripted trajectory, and observable sound evidence takes priority.

### Dialogue Efficiency

The framework detects unnecessary tutoring after sound, missed revision,
premature closure, ineffective strategy repetition, and inappropriate stopping.

### Student Experience

Synthetic ratings cover clarity, usefulness, personalization, cognitive
burden, and communication quality. Student-visible messages are scanned using
the E2A.41 separation contract and must not expose internal labels, profiles,
stopping rules, escalation reasons, policy metadata, or model decisions.

### Teacher and Research Utility

The teacher/research evidence package must support identifying a student who
needs support, understanding the observed misconception, planning instruction,
and reviewing the AI decision with evidence provenance. It excludes
chain-of-thought, hidden prompts, private identifiers, and hidden model
reasoning.

## Baseline Comparison

The frozen comparison includes:

1. traditional MCQ with selected-answer evidence;
2. MCQ plus a generic AI explanation; and
3. CBA with reasoning, confidence, distractor stance, profiles, adaptive
   dialogue, and process evidence.

The comparison covers diagnostic accuracy, personalization, traceability,
learning progression, teacher usefulness, and efficiency. It classifies which
evidence and evaluation operations each baseline supports. It does not assign
synthetic effect scores, observed effect sizes, or causal estimates.

## Failure Evaluation

Deterministic mutations verify detection of:

- false sound;
- premature closure;
- excessive tutoring;
- wrong intervention;
- evidence loss; and
- student-facing leakage.

## Replay and Isolation

`evaluation-replay-contract-v1` extends the E2A.41 structured replay. A
researcher can reconstruct accepted evidence, profile transitions,
interventions, stopping decisions, outcomes, and evaluation metrics from
structured records.

Replay does not require:

- chain-of-thought;
- hidden model reasoning;
- hidden prompts;
- provider transport payloads; or
- private identifiers.

The replay is stable under input-order changes. E2A.40 scope boundaries keep
student profiles, transcripts, interventions, and audit evidence separate.

## Deterministic Regressions

The protocol includes the twelve required regressions:

1. correct misconception diagnosis;
2. false sound detection;
3. missed misconception detection;
4. appropriate personalized intervention;
5. generic feedback weakness;
6. early closure;
7. excessive dialogue;
8. evidence preservation;
9. student/audit separation;
10. baseline comparison validity;
11. replay consistency; and
12. teacher evidence package completeness.

## Frozen Budget

- Maximum logical calls: `29`
- Maximum adapter attempts: `87`
- Provider concurrency: `1`
- Maximum transport retries per logical call: `2`
- Maximum input tokens: `900000`
- Maximum output tokens: `70000`
- Maximum total tokens: `970000`
- Maximum cost when pricing metadata exists: `USD 25`

The budget is frozen metadata only. E2A.42 has no live entrypoint and is not
authorized for provider execution.

## Commands

Generate a read-only evidence packet:

```bash
npm run eval:formative:e2a42:run
```

Inspect the latest packet:

```bash
npm run eval:formative:e2a42:report
```

Run the complete deterministic suite:

```bash
npm run eval:formative:e2a42:smoke
```

Focused commands are available for the framework, baselines, diagnostics,
evidence, interventions, progression, efficiency, student experience, teacher
utility, replay, multi-student behavior, failure detection, regressions,
historical integrity, budget, protected components, artifact validation, and
the provider-call guard.

## Interpretation Boundary

Passing E2A.42 means the frozen contracts, synthetic fixtures, metric formulas,
failure detectors, replay behavior, isolation checks, and artifact package are
internally consistent. It does not demonstrate production effectiveness,
psychometric validity, real-student learning gain, classroom generalization,
or live-provider quality.
