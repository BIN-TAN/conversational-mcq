# E2A.20a Turn-4 Classification Adjudication

E2A.20a independently adjudicates the exact visible turn-4 response from the
preserved E2A.19 run `e2a19_20260720094054_74982b99`. It is a no-live
classifier-boundary phase. It does not change the tutor candidate, historical
provider outputs, approved configuration, or historical E2A.18-E2A.20
artifacts.

## Decision

The exact response is `substantive` and revision-ready. Three separate
structured analytic rubrics agree:

- strict conceptual rubric;
- classroom formative-assessment rubric;
- revision-readiness rubric.

The response identifies and rejects option A's universal-information claim,
localizes information around item difficulty, relates information to response
predictability, explains why information decreases away from the item
location, and applies that distinction directly to option A. No formal
item-information equation or specialist terminology is needed to correct this
misconception.

These are deterministic analytic adjudications, not fabricated human ratings.
All human-review fields remain null.

## Classifier Boundary

Classifier V2 remains immutable at
`student-simulator-evidence-classifier-v2`, SHA-256
`5839e68b24bbdfe437fe133a86da201b2df96d769e9d24b966d370727d4d9037`.
It assigned `partial` because its theta-information substantive patterns
require a narrow canonical word order. The turn-4 response expresses the same
relationship through closeness, distinguishability, predictability, and the
far-from-difficulty boundary, so the V2 result is a false negative.

The new simulator-only
`student-simulator-evidence-classifier-v3` promotes a V2 result only when all
three observable feature groups are present:

- correct conceptual relationship;
- explanatory mechanism;
- direct distractor or boundary application.

Promotion is blocked for explicit tutor repetition and tentative or explicitly
incomplete language. Every promoted result includes exact visible spans.
Above-ceiling protection and provider-self-report non-authority are unchanged.

## Calibration

The no-live calibration contains 36 fixed cases across all six existing
conceptual anchors:

- 6 clearly partial;
- 6 clearly substantive;
- 6 revision-ready but informal;
- 6 technically worded but incomplete;
- 6 correct paraphrases without canonical keywords;
- 6 boundary cases.

Twelve substantive cases intentionally avoid preferred canonical wording. The
historical replay includes all 48 E2A.18 calibration cases, all four E2A.19
simulator outputs, and five explicit boundary regressions.

## E2A.21 Boundary

Only the future E2A.21 protocol draft now references classifier V3. Its tutor
candidate, session objective, evidence-driven orchestration, call and token
budgets, cost ceiling, and concurrency are unchanged. E2A.21 remains
undispatched and requires separate explicit authorization.

## Deterministic Result

The final no-live adjudication run is
`e2a20a_20260720103109_e94fce3d`. It produced all 13 required artifacts with
status `e2a20a_classifier_false_negative_corrected_e2a21_ready`.

- turn-4 classification: `substantive`;
- revision eligible: `true`;
- independent rubric agreement: `true`;
- calibration: 36/36 passed, including 12 substantive paraphrases that V2
  under-classified;
- historical regression replay: 57/57 passed;
- final classifier: `student-simulator-evidence-classifier-v3`;
- classifier file SHA-256:
  `9fd28385a6b70d72c02ec7e73adcc54d179e80226abda0edecad8771377bc899`;
- provider calls and network requests: 0;
- tutor candidate approved or activated: `false`;
- E2A.21 executed: `false`.

## Commands

Run the complete no-provider smoke:

```bash
npm run eval:formative:e2a20a:smoke
```

Generate adjudication artifacts:

```bash
npm run eval:formative:e2a20a:run
```

Read a generated report:

```bash
npm run eval:formative:e2a20a:report -- --run <run_id>
```

Artifacts are written under
`.data/e2a20a-turn4-classification-adjudication/<run_id>/` and remain ignored
by Git.

No command in E2A.20a dispatches a provider request.
