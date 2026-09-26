# Formative Interpretation and Confidence Provenance

This is a versioned interpretation policy, not a new student questionnaire or a
claim of validated learning outcomes. Existing transcripts and profiles are not
rewritten. Host prompts v7.6 and v7.7 use the original V18R2 contracts with additional
live-candidate checks.

## Evidence strength

- Recognizing or explicitly adopting a supplied correct explanation is meaningful
  evidence. Rewording is not required. Recognition is not independent transfer.
- A correct explanation or supported application can resolve a specific prior
  misconception and support `sound_understanding`, without assigning the strongest
  transfer categories. The judgment is limited to the observed concepts.
- An upgrade to `robust_transfer_ready_understanding` or
  `robust_understanding_ready_for_transfer` requires an
  `independent_transfer_application` observation sharing current eligible student
  evidence with that field's justification. The model must describe the novel,
  independently justified application and sampling limits. A substituted number
  in an immediately supplied worked example is insufficient.
- The validator checks the reference contract, not whether an application is
  semantically independent. Human content review and representative-student
  evaluation remain necessary. No fixed word count, number of turns, or required
  paraphrase is a mastery criterion.

Teaching explanations retain the distinction between score consistency and
evidence supporting specified score interpretations/uses. SEM is not a known
signed individual error or a guaranteed true-score interval. Content review
uses the [NCME Assessment Glossary](https://ncme.org/resources/professional-learning/glossary/)
as a reference, not as certification of generated instruction.

## Confidence is not silently remeasured

The formative phase does not collect a comparable structured confidence rating
on every turn. Hosts v7.6 and v7.7 therefore preserve the prior `confidence_alignment`.
Correctness, assent, and requests for help do not replace that measurement.
Explicit new self-confidence statements may be captured as
`self_reported_confidence` observations with current evidence IDs and remain in
the transcript. They are not automatically put on the baseline rating scale.

Read-only projection v2 adds `profile_confidence_alignment_scope`:

| Value | Meaning |
| --- | --- |
| `initial_assessment` | Validated baseline profile interpretation |
| `carried_forward_not_reassessed` | Prior value retained by validated host-v7.6/v7.7 transition; not a new rating |
| `legacy_scope_unrecorded` | Other updated profile; temporal meaning not retrospectively inferred |
| `unavailable` | No eligible validation provenance, or intermediate/fallback artifact |

The same scope appears in teacher profile labels and research exports.
Transitions additionally export `prior_confidence_alignment_scope` and
`updated_confidence_alignment_scope`, linked through the profile record IDs.
There is no calculated confidence difference or new learning metric. The
carry-forward value may originate in an older updated profile; do not assume it
necessarily reproduces the first assessment rating. Future prompt versions must
explicitly opt into this provenance mapping after confirming the same policy.

## Mechanical correction versus substantive validation

`prepareFormativeInterpretationResult` handles only fully parsed, complete output.
For each field marked updated, compare the prior and proposed canonical value
using the same JSON equality as the existing transition validator. If identical,
mark that field retained. Split mixed groups without losing any field, evidence
ID, rationale, or evidence basis. No assessment value, claim decision, or student
message changes. Missing/invalid evidence is never supplied or removed.

When this projection occurs, retain the original provider output, original parsed
output, affected field names, policy version, and SHA-256 digests of original and
projected JSON in the AgentCall raw-output envelope. The normal provenance,
temporal, safety, claim-coverage and changed-field validators then run on the
projected candidate. A substantive error still requires regeneration or failure;
the projection is not another AI call. Old stored snapshots use the historical
validator and are not silently reinterpreted under this live policy.
Each logical call audit also retains projection metadata. A normalized candidate
that is subsequently rejected preserves its original, not merely projected,
candidate in the failed-attempt audit even if a later regeneration succeeds.

Formative `item_level_evidence` can contain narrative summaries under the existing
canonical contract. Exports now distinguish `structured_item_records`,
`narrative_summaries`, `mixed_or_unrecognized`, `empty`, and `unavailable` through
`item_level_evidence_format`. The count is stored entry count, not unique item
count. Only entries with an actual item ID are advertised as joinable item
evidence. Narrative text is retained; no item association is guessed from prose.

The current UI persists and displays `student_visible_message` only. The prompt
requests a null `teaching_artifact` to avoid generating unused duplicate content;
the schema retains the nullable field for historical compatibility.

## New or recurring errors outside the active catalog

The canonical claim catalog represents retained claims, not every error ever
observed. A resolved claim is absent from the next active catalog. Automatically
adding new claims or reactivating historical IDs is not implemented by this
policy; raw histories are never rewritten to make it appear otherwise.

Host v7.7 reviews current student reasoning alongside the initial profile and
visible history. When it identifies a supported, still-unresolved misconception
outside the active catalog, including a previously resolved error that recurs,
it records an evidence observation with `evidence_type=uncatalogued_misconception`.
This is a model interpretation, not a keyword-derived student trait. Quoted or
rejected reasoning, questions and uncertainty alone must not trigger it.

The observation must reference eligible student evidence after the current
profile's cutoff. The validator refuses historical-only references, invented
references and teacher evidence. Continuing instruction or pausing remains
possible without a profile update. A proposed transition containing this
observation must use `teacher_assistance_recommended` and
`reason_code=uncatalogued_misconception_requires_review`; neither strongest
transfer category is allowed. The model must preserve the concern in its
rationale, cautions and recommended next evidence. The actual observations,
original student turns and source call remain available for review and export.

This is a safety and review mechanism, not full automatic claim reactivation.
Canonical claim counts alone are therefore not a complete count of newly
observed or recurring errors. The model can still miss a semantic recurrence;
reference validation does not prove recognition accuracy. If later evidence
corrects the error, the model should record the correction rather than retain a
permanent label. Content accuracy and appropriate escalation require review.

## Verification scope

The policy regression covers unsupported strong labels, supported local reasoning,
confidence carry-forward, group splitting, unchanged source values, idempotence,
unknown and ineligible references, malformed input, historical compatibility, and
read-only scope projection. Database tests separately reconcile profile provenance
with teacher and research exports. Synthetic live dialogues test the actual
request/prompt, generated replies, current evidence catalogs, profile transitions
in memory, and bounded regeneration. They are not classroom learning trials or
full browser/provider/database end-to-end evidence.
