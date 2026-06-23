# Evaluation Case Design

Phase 7E1 cases are synthetic by default. They must not include real student transcripts, identifiable student responses, summative outcome data, copyrighted course passages, provider secrets, or hidden prompts.

## Case Source Policy

Allowed source labels:

- `synthetic`
- `teacher_authored`
- `deidentified`

Phase 7E1 fixtures use only `synthetic`. Deidentified cases may be intentionally created later, but the system does not automatically mine classroom records.

## Fixture Files

Synthetic cases live in:

```text
tests/fixtures/evals/item-verification-cases.json
tests/fixtures/evals/response-collection-cases.json
tests/fixtures/evals/student-profiling-cases.json
tests/fixtures/evals/formative-planning-cases.json
tests/fixtures/evals/followup-cases.json
```

Each file contains 10 cases for the matching active agent.

## Case Shape

Each case includes:

```ts
{
  case_id: string;
  agent_name: string;
  title: string;
  description: string;
  input_payload: object;
  expected_output_shape: object;
  gold_labels: object;
  rubric_expectations: object;
  safety_expectations: object;
  notes: string;
}
```

`input_payload` must match the relevant agent input schema. `gold_labels.mock_mode` may select deterministic mock-provider behavior. Gold labels and references are hidden by default in blind annotation mode.

## Agent Coverage

The 50 fixture cases cover:

- item verification warnings and no-warning item sets
- response collection reasoning, revisions, invalid help requests, and prompt injection
- student profiling with robust, partial, misconception-based, fragile, insufficient, and conflicting evidence patterns
- formative planning mapping, justified deviations, and expected failure cases
- follow-up opening, clarification, refinement, calibration, independent verification, transfer, redirects, evidence triggers, and move-on offers

These cases are reusable for live evaluation, but Phase 7E1 runs them only through the mock provider.

## Phase 7E2A Canary Manifest

Phase 7E2A uses `tests/fixtures/evals/live-canary-manifest.json`.

The manifest selects exactly five synthetic cases per active agent, covering:

- Item Verification: clean item set, ambiguity, multiple correct answers, answer-key inconsistency, duplicate items
- Response Collection: reasoning, disallowed help, mixed reasoning and disallowed help, natural-language option, prompt injection
- Student Profiling: robust understanding, misconception, insufficient evidence, independence uncertain, conflicting evidence
- Formative Planning: diagnostic clarification, reasoning refinement, confidence calibration, independent verification, consolidation or transfer
- Follow-up: reasoning refinement, independent verification, consolidation or transfer, off-topic redirect, prompt-injection redirect

Phase 7E2A rejects teacher-authored and deidentified cases. Those sources remain for later evaluation designs only.

## Targeted Quality Regression Cases

`tests/fixtures/evals/targeted-quality-regressions.json` contains synthetic
regression cases for the post-baseline quality patch. It covers the three
human-fail cases from `evr_20260623_1sjeh1q`, the two automated false-positive
patterns, and Response Collection missing-evidence/help-metadata consistency.

These targeted cases are not a replacement for the 25-case live canary manifest.
They are an additional pre-canary engineering check.
