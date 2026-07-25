# E2A.43 CBA Empirical Evaluation Study Protocol Freeze

## Status

E2A.43 is a deterministic, no-live research-study protocol freeze for
empirically evaluating Conversation-Based Assessment (CBA). It creates a
dissertation-level design for REB preparation, pilot planning, and future
evaluation chapters. It does not recruit participants, collect empirical data,
call a provider, approve a candidate, or activate a candidate.

- Protocol version:
  `e2a43-cba-empirical-evaluation-study-freeze-v1`
- Research protocol:
  `cba-empirical-research-protocol-v1`
- Protocol hash:
  `44d56c4789a4f63e6322d0d129ab62e542fdc31a745bd6f8cb65bb9b8dcba137`
- Composite runtime identity:
  `f4b51fcdb9dae9b963fec8b3134a348f065a92f5fbe3906a66287b32a88b3d8a`
- Provider calls: `0`
- Network requests: `0`
- REB approval assumed: `false`
- Participant recruitment authorized: `false`
- Empirical data collection authorized: `false`
- Authoritative 38-artifact packet:
  `.data/e2a43-cba-empirical-evaluation-study-protocol-freeze/e2a43_20260725T172117131Z_0c4b1e5d/`

## Protected Boundary

E2A.43 adds a research-design layer over E2A.42. It does not modify Evaluator
V5, the tutor candidate, runtime architecture, evidence pipeline, learning
profiles, stopping policy, auditability contracts, or E2A.42 evaluation
contracts. Each deterministic run reproduces and verifies the frozen E2A.42
protocol and composite identities.

## Research Questions

`research-question-framework-v1` defines:

1. **RQ1:** How accurately can CBA identify student misconceptions and
   knowledge gaps beyond answer correctness alone?
2. **RQ2:** How does CBA support personalized formative feedback through
   reasoning, confidence, distractor, and process evidence?
3. **RQ3:** How do students' learning profiles change during CBA interactions?
4. **RQ4:** How do students and instructors perceive the usefulness and
   usability of CBA?
5. **RQ5:** How do process data contribute to understanding student reasoning
   and assessment validity?

Each question binds constructs, evidence sources, E2A.42 evaluation dimensions,
and a claim boundary. Within-session profile change is not treated as a stable
learner trait or proof of durable learning.

## Study Design

`empirical-evaluation-study-design-v1` freezes three ordered phases.

### Phase 1: System Validation

Synthetic cases and expert-created scenarios test evidence extraction, profile
transitions, intervention selection, stopping decisions, and audit
traceability. This phase can support bounded technical reliability claims for
defined cases. It cannot support claims of student learning effectiveness,
classroom generalizability, or psychometric validity.

### Phase 2: Expert Evaluation

Subject-matter experts or instructors review misconception identification,
feedback quality, pedagogical appropriateness, actionability, and usefulness
for instruction. `expert-rating-framework-v1` defines independent 1–5 ratings
for diagnostic usefulness, feedback usefulness, pedagogical appropriateness,
instructional value, and actionability. Agreement methods remain conditional
on the final rating design and observed data; no rating or agreement result is
present.

This phase requires appropriate REB review before execution.

### Phase 3: Classroom Pilot

`classroom-pilot-contract-v1` defines a potential EDPY 507 or equivalent
university-course context. The context is not confirmed. With prior approval
and consent, the pilot may collect selected responses, student-authored
reasoning, confidence, distractor selection, revisions, transfer evidence,
process data, and student and instructor feedback.

The pilot is not authorized by this freeze. It requires informed consent,
voluntary participation, a withdrawal procedure, pseudonymous research IDs,
approved access controls, and appropriate REB review.

## Comparison Conditions

`study-comparison-framework-v1` defines three conditions:

1. traditional MCQ with selected-answer evidence;
2. MCQ plus generic AI feedback with an answer and explanation; and
3. CBA with reasoning, confidence, distractor, process, adaptive-feedback, and
   profile-transition evidence.

The framework does not fabricate expected outcomes, effect sizes, or
superiority. Assignment and causal interpretation depend on the eventual
approved design.

## E2A.42 Measurement Integration

`e2a43-e2a42-measurement-integration-v1` binds the empirical study to the
frozen E2A.42 framework:

- **Diagnostic:** misconception identification, knowledge-gap identification,
  false sound, and missed misconceptions.
- **Learning:** profile improvement, revision quality, and transfer
  performance.
- **Process:** response revision, confidence change, help seeking, and
  interaction trajectory.
- **Experience:** usability, perceived usefulness, and cognitive burden.
- **Instructor utility:** evidence usefulness and instructional-planning
  support.

These are measurement definitions, not empirical findings.

## Research Data

`research-data-schema-v1` defines 15 variables at three levels:

- **Student:** pseudonymous research ID, selected response, student reasoning,
  confidence, tempting distractor, revision record, and process indicators.
- **Item:** public item ID, item characteristics, target concept, and candidate
  misconception category.
- **Interaction:** intervention decision, profile transition, stopping
  decision, and bounded interaction outcome.

Every variable includes a source, data type, research purpose, and
interpretation caution. The schema prohibits chain-of-thought, hidden model
reasoning, hidden prompts, API keys, password hashes, and access-code hashes.
Direct identifiers are not part of the analysis schema.

## Ethics Boundary

`research-ethics-boundary-v1` requires informed consent, voluntary
participation, student privacy, a defined teacher role, separation of research
use from course operations, withdrawal procedures, retention and access
controls, and a contact path for concerns.

The protocol specifically requires review of the instructor-student power
differential. Ordinary course decisions must not depend on research
participation. This protocol does not represent an REB submission or approval
and authorizes neither recruitment nor data collection.

## Analysis Framework

`analysis-framework-v1` defines four conditional analysis families:

- diagnostic classification and expert agreement;
- learning, revision, and transfer;
- process and trajectory analysis; and
- student and instructor perception.

Candidate methods are planning options only. No method is selected before
sample, measurement, assumption, missing-data, and multiplicity review. No
inferential result or effect size is present.

## Limitations

`empirical-study-limitations-v1` records:

1. pilot-context dependence;
2. small-sample constraints;
3. limited generalizability;
4. dependency on the frozen AI model and system configuration; and
5. the need for independent replication across domains, courses, models, and
   institutions.

## Frozen Artifacts and Budget

The immutable packet contains the research protocol, research questions,
three-phase design, expert framework, classroom pilot, comparison framework,
E2A.42 measurement integration, research-data schema, ethics boundary, analysis
framework, limitations, validations, deterministic replay, protected-source
integrity, and composite identity.

The protocol-freeze budget is exactly zero provider calls and zero network
requests. Future participant compensation, empirical execution, and storage
budgets are intentionally not estimated; they require institutional and REB
review. E2A.43 has no live entrypoint.

## Commands

Generate a read-only protocol packet:

```bash
npm run eval:formative:e2a43:run
```

Inspect the latest packet:

```bash
npm run eval:formative:e2a43:report
```

Run the complete deterministic suite:

```bash
npm run eval:formative:e2a43:smoke
```

Focused commands cover protocol, research questions, study design, expert
review, classroom pilot, comparison, E2A.42 measurement integration, research
schema, ethics, analysis, privacy, limitations, replay, regressions,
historical integrity, budget, protected components, artifact validation, and
the provider-call guard.

## Interpretation Boundary

Passing E2A.43 means the research-design contracts, privacy boundaries,
artifact package, and deterministic validation are internally consistent with
the protected E2A.42 framework. It does not establish diagnostic accuracy,
learning effectiveness, student or instructor acceptance, psychometric
validity, generalizability, or causal effects. Those questions require an
approved study, appropriate participants and comparison design, empirical
data, human review, and analysis suited to the observed sample.
