# Formative Value Determination Design

Phase 28a adds a narrow formative-value determination layer after profile integration. It converts a validated `profile-integration-interpretation-v1` packet into a `formative-value-determination-v1` packet.

Phase 30a reframes this layer as **distractor-informed diagnostic purpose selection**. The existing `formative-value-determination-v1` name and five code enum values remain for compatibility in this phase. The dissertation framing should not treat those five values as an all-purpose feedback taxonomy. Instead, they map onto four distractor-informed diagnostic purposes plus modifiers or exit paths.

This layer does not generate activities, tasks, items, explanations, tutoring scripts, scoring changes, or state transitions. It only recommends the broad purpose of the next formative interaction and records the student's preference.

## Phase 30a Reframing Crosswalk

| Previous formative value | New role |
|---|---|
| `diagnostic_clarification` | `conceptual_entry_grounding` or `distractor_misconception_probe` |
| `reasoning_refinement` | `reasoning_boundary_repair` |
| `confidence_calibration` | confidence alignment modifier |
| `independent_understanding_verification` | `independent_misconception_verification` |
| `consolidation_and_transfer` | exit/extension path |

The four central diagnostic purposes are:

- `conceptual_entry_grounding`
- `distractor_misconception_probe`
- `reasoning_boundary_repair`
- `independent_misconception_verification`

Confidence calibration can still be recorded as an important condition, but it is not the central purpose taxonomy for the dissertation. Consolidation and transfer can remain valuable after no actionable distractor-linked misconception evidence remains, but they are not the central diagnostic construct.

## Allowed Values

The allowed values are fixed:

- `diagnostic_clarification`
- `reasoning_refinement`
- `confidence_calibration`
- `independent_understanding_verification`
- `consolidation_and_transfer`

The packet must select exactly one primary value, include student-safe reasons, and offer alternatives. The student may accept the recommendation, choose an alternative, or move on. Overrides and move-on choices are recorded as process events.

The profile-integration pattern is a decision prior, not a hard deterministic mapping. The live agent may interpret the evidence, but it is category-constrained and must respect the validation guardrails below.

## Category Criteria

`diagnostic_clarification` is the default fit when evidence suggests a likely knowledge gap, missing basic concept access, an "I don't know" pattern, vague reasoning due to lack of understanding, or unclear conceptual confusion.

In Phase 30a terms, this may mean `conceptual_entry_grounding` when the student lacks a basic conceptual foothold, or `distractor_misconception_probe` when a selected or tempting distractor anchors a plausible misconception hypothesis.

`reasoning_refinement` fits partial understanding where the student's reasoning is incomplete, unstable, or poorly connected.

In Phase 30a terms, this is primarily `reasoning_boundary_repair`: the student may have part of the target idea but has not clearly separated it from distractor logic.

`confidence_calibration` means the primary need is aligning confidence with already adequate or strong understanding evidence. It is not the same as low confidence. Low confidence can be appropriate when the evidence is weak, unknown, or gap-like.

Confidence calibration can be the primary value only when understanding evidence is adequate or strong and the confidence evidence shows one of:

- underconfident strong understanding;
- underconfident adequate reasoning;
- inconsistent confidence across adequate evidence.

Conceptual gaps, wrong models, weak reasoning, and likely misconceptions take priority over calibration. High confidence with wrong, weak, or misconception evidence is recorded as a secondary confidence consideration and normally maps to `diagnostic_clarification` or `reasoning_refinement`, not primary `confidence_calibration`.

`independent_understanding_verification` fits mixed, conflicting, insufficient, or reliability-limited evidence that needs a clearer in-platform expression of the student's own understanding. Student-facing text must not mention AI assistance, process data, engagement, provenance, integrity, or authenticity.

In Phase 30a terms, this is `independent_misconception_verification`: the system asks for a fresh own-words expression because selected-option evidence, polished reasoning, or reliability context does not yet support a clear distractor-linked diagnosis.

`consolidation_and_transfer` fits stable understanding where the next broad value is to stabilize or extend the idea.

In Phase 30a terms, consolidation and transfer are exit or extension paths after the current misconception hypothesis is weakened, unsupported, or no longer actionable.

## Evidence Sources

The input is allowlisted from the profile integration packet:

- student-safe profile status and message;
- integration pattern;
- status confidence;
- ability evidence consistency;
- broad confidence-calibration summary;
- engagement and response-production context as internal reliability context only;
- uncertainty and limitations.

The provider input must not include answer keys, correct options, distractor metadata, raw reasoning, raw process payloads, raw model output, API keys, cookies, auth headers, database URLs, session secrets, or unrelated records.

## Student-Facing Boundaries

Student-facing text must not expose:

- answer keys;
- correct options or correctness labels;
- distractor metadata;
- misconception IDs;
- raw reasoning or raw process payloads;
- raw LLM output or system prompts;
- engagement categories;
- AI-assistance labels;
- integrity, authenticity, cheating, misconduct, or suspicious-behavior language.

Confidence calibration is allowed as a recommended broad value when the adequate-understanding condition is met, but it must not be forced. The student must be able to choose another focus or move on.

Provider or mock output that selects confidence calibration without an explicit adequate-understanding mismatch reason is rejected. Generic `confidence_mismatch`, low confidence alone, high confidence alone, confidence alignment mixed, or overconfident wrong/weak evidence is not sufficient. A likely knowledge gap with low confidence and weak evidence should generally choose diagnostic clarification, not confidence calibration.

The packet includes `secondary_considerations` for internal audit notes such as overconfident wrong or weak evidence, incomplete reasoning, mixed evidence, or reliability-limited context. These notes are `student_visible=false` and must not override the primary conceptual learning need.

## Storage

Phase 28a avoids a schema migration. `formative_decisions` is not used because it implies activity planning. Instead:

- provider-backed runs persist ordinary `agent_calls` audit rows for `formative_value_determination_agent`;
- determinations are recorded with `formative_value_determined` process events;
- presentation is recorded with `formative_value_presented`;
- choices are recorded with `formative_value_choice_recorded`;
- overrides are additionally recorded with `formative_value_overridden`;
- move-on choices are additionally recorded with `formative_value_moved_on`;
- redacted review artifacts are written under `.data/formative-value-review/`.

## Commands

No-live deterministic smoke:

```bash
npm run student:formative-value-smoke
```

Review artifact generation:

```bash
npm run student:formative-value-review
npm run student:formative-value-review -- --session-public-id <session_public_id>
```

Opt-in live smoke, skipped by default:

```bash
npm run student:formative-value-live-smoke
```

Intentional live execution requires:

```text
RUN_LIVE_FORMATIVE_VALUE_SMOKE=1
DATABASE_URL
SESSION_SECRET
LLM_PROVIDER=openai
LLM_LIVE_CALLS_ENABLED=true
OPENAI_API_KEY or OPENAI_API_KEY_FILE
OPENAI_MODEL_PROFILE_INTEGRATION or OPENAI_MODEL_PLANNING or OPENAI_MODEL_FOLLOWUP
```

The live smoke uses a deterministic profile-integration packet as input and calls only the formative-value determination provider path. It must not run in ordinary local checks or CI.

## Limitations

This phase does not wire a browser choice UI, does not generate a matched formative activity, and does not decide final progression. It prepares the packet, validation, persistence, review, and opt-in live path needed by later activity planning.
