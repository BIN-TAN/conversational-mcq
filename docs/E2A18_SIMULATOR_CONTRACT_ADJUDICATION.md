# E2A.18 Simulator Contract Adjudication

E2A.18 is a no-provider adjudication of the simulator contract failure in the
immutable E2A.17 run `e2a17_20260720080442_b0e3f036`. It does not rerun
E2A.17, execute E2A.19, approve or activate the tutor candidate, or modify the
tutor candidate and runtime boundary.

## Result

- E2A.18 run: `e2a18_20260720082941_39cf7af8`
- Status: `e2a18_classifier_calibrated_micro_canary_ready`
- Simulator contract: `e2a18-student-simulator-contract-v2`
- Evidence classifier: `student-simulator-evidence-classifier-v2`
- Provider calls: `0`
- E2A.17 historical status: `e2a17_canary_incomplete` (unchanged)
- Tutor candidate: unapproved, inactive, and byte-identical

The failed simulator message was:

> For Item 16, I think option A is right because an extremely difficult item
> separates students by whether they can answer it, so it gives a lot of
> information at every theta level.

The platform-owned evidence ceiling was `partial`. The E2A.17 checker inferred
`substantive` because the message had at least 24 words and contained
`because`. Independent adjudication classified it as `partial`: the message
provides a developed rationale, but the rationale preserves the misconception
that an extremely difficult item is informative at every theta. It does not
state or apply the correct theta-to-item-difficulty information boundary.

The root-cause category is
`evidence_level_classifier_false_positive`. It is not genuine simulator
overperformance, a contradictory response objective, or a hidden-state
transition failure.

## Contract Delta

The simulator prompt, output schema, response-objective mapping, and hidden
state mapping are unchanged. The provider self-reported evidence level remains
non-authoritative.

The V2 classifier:

- removes message length plus discourse markers as authority for substantive
  evidence;
- treats fluent misconception rationales as partial evidence;
- requires a conceptually complete exact evidence span for a substantive
  above-ceiling rejection;
- treats tentative correct language and repeated tutor wording without
  independent application as partial;
- records exact supporting spans for every rejection.

The original E2A.17 checker remains unchanged for historical replay. The exact
historical output remains rejected by V1 and is accepted by V2.

## Calibration

The deterministic corpus contains 48 cases across six conceptual anchors and
six required categories. Results are `48/48` passing. All eight rejected cases
contain exact supporting spans. Tentative, repeated, and ambiguous language
does not produce an ungrounded hard rejection.

Ten mutation cases pass. The progressive sequence changes level only when the
observable conceptual content changes. The historical message is rejected by
the original lexical heuristic; removing its length/marker trigger changes the
original result, while the corrected conceptual classifier accepts both the
exact and weakened misconception-consistent messages.

## Abort-Aware Integrity

E2A.17 historical artifact integrity remains `false`. E2A.18 adds a derived,
abort-aware classification only. The 13 empty downstream JSONL artifacts are
classified `expected_empty_due_to_early_abort` because the simulator contract
failed after provider output and before student persistence, tutor request
construction, runtime validation, progression, or projection.

The derived result is:

`evidence_complete_for_documented_early_abort`

This means the failure evidence is complete. It does not mean that E2A.17 or
its historical artifact-integrity check passed, or that a session completed.

## E2A.19 Draft

E2A.19 is prepared but not authorized or executed. Frozen draft protocol hash:

`66b63f107ad6b2cc2141720ed3d644935a5a99dd5962934eb914968541a0b46c`

The draft permits one isolated Session 1 fixture, six student turns, twelve
visible dialogue turns, six simulator calls, six initial tutor calls, and at
most two tutor regenerations. The hard ceilings are:

- logical generation calls: `14`
- adapter attempts: `42`
- input tokens: `400000`
- output tokens: `31000`
- total tokens: `431000`
- cost when complete pricing is available: `USD 10`
- provider concurrency: `1`

Pricing must remain null when complete pricing metadata is unavailable. E2A.19
requires separate explicit review and authorization before any provider call.
