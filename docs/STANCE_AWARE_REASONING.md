# Stance-Aware Reasoning Evidence

## Intended interpretation

This is a teacher-supervised formative classroom tool. Mistaken instruction,
unsupported diagnosis, missed difficulties and excessive conversational burden
can harm learning. Engineering checks alone do not establish instructional
validity. This change does not introduce grading, selection or qualification
decisions, nor certify learning gains.

The unit of interpretation is an item-linked proposition in the student's sealed
response, not the originality of the wording. Explicit adoption of an explanation
already supplied in an option is meaningful evidence. A correct adopted
explanation supports recognition; a false adopted explanation can support a
candidate misconception. Neither establishes independently generated reasoning
or transfer. Choosing a letter without expressing adoption is weaker evidence.

Initial administration stays neutral: no correctness feedback, remedial probe or
extra submission step is introduced. The interpretation runs after submission.
In the formative conversation, the tutor can acknowledge recognition and request
a focused check when necessary, without demanding paraphrasing for its own sake.

## Versioned records

New live initial diagnostics require `semantic-item-review-v3`. Each item review
contains `interpretations`, with these fields:

| Variable | Meaning |
| --- | --- |
| `interpretation_id` | Model-supplied item-local link, unique within this review; not a canonical conversation evidence ID. |
| `source_field` | `reasoning` or `tempting_option_reason`, from the sealed response. |
| `student_quote` | Actual excerpt from that field, never replaced by option/tutor wording. |
| `proposition` | The position interpreted, not necessarily endorsed by the student. |
| `stance` | `endorsed`, `rejected`, `uncertain`, or `quoted`, considering negation, contrast and self-correction in context. |
| `basis` | `supplied_explanation`, `student_explanation`, `answer_only`, or `fact_restatement`. These concern the evidence supplied, not authorship detection. |
| `correctness` | `supported`, `contradicted`, or `undetermined` for the proposition itself. A rejected false proposition is still contradicted, but is not a current misconception. |
| `scope` | `specific_proposition` or `compound_unspecified`. Broad agreement with a multi-claim option does not separately verify every clause. |
| `option_reference` | Nullable exact label and excerpt from the same item's sealed options; mandatory for supplied explanations. |
| `rationale` | Short contextual explanation of the interpretation and its limits. |

Current `misconceptions` entries link by `interpretation_id`. They must copy the
linked proposition, source field and student quote exactly after Unicode NFKC
and whitespace normalization. Eligibility requires endorsed + contradicted +
specific proposition + explanatory basis. Each eligible observation must be
represented once; other observations must not become claims. This is a
mechanical consistency rule, not proof that the model judged the meaning well.

For example, "I agree with B" can quote those exact words while separately
referencing B's single explanatory proposition. "A was tempting, but I reject
it" records rejection, not belief. "I agree with C" when C includes two claims
records compound agreement and a scope limitation, not two established errors.
Explicit separate endorsement of two false claims should record both.

The backend checks item identity/coverage, observation identity, actual source
quotes, same-item option references and claim eligibility/coverage. It does not
use string similarity, keyword counts, response length, speed or confidence as
a semantic correctness detector. Unsupported structure enters the existing
repair/failure path; it is not silently accepted as a diagnosis.

## Persistence and limits

Records are retained in the original AgentCall structured output and in:
`StudentProfile.item_level_evidence.evidence_integrated_profile_v2.item_evidence[].semantic_review`.
The profile includes `semantic_review_audit` (version, validation status, issues,
source AgentCall ID) and the existing effective evidence-package hash. The
sealed package supplies item/option snapshots; no lookup against later edited
teacher content is used for quote validation. Existing research JSON containing
these profile records retains the nested metadata; this is not a new flat CSV
variable table. Reviewers should follow the source profile and call, not infer
evidence from a dashboard label alone.

Recognition-only evidence is capped at `accurate_but_concise` rather than
`well_supported_and_precise`, with `recognition_without_independent_explanation`.
Compound agreement receives `endorsement_scope_unclear`. These are evidence
limitations, not additional misconceptions. Existing observed correctness is
unchanged. No numerical mastery score is calculated by the new fields.

Historical records without the new fields remain readable and are not rewritten
or retrospectively classified. An absent field means not recorded. A new bundle
constructed from such records uses `semantic-item-review-legacy-or-unavailable`
in its audit rather than falsely assigning v3. Student-visible projections do
not expose the interpretation objects or protected keys.

The formative tutor uses the same stance/recognition distinctions and retains
its existing canonical student evidence IDs, evidence observations, claim
dispositions and all-claim closure validation. A generic agreement does not
resolve an error or demonstrate independent application. This prompt policy
still needs live and human review; source-ID checks cannot verify pedagogy.

The canonical profiling handoff also uses the updated `student-profiling-v6`
prompt. It retains its existing canonical evidence IDs and schema: stance,
evidence origin and exact quote are requested in the item evidence summary and
indicator rationale, with recognition limits in the reasoning summary and next
evidence recommendations. These prose records are distinct from the structured
v3 semantic review. Do not mistake a model-written rationale for an independently
verified stance annotation or claim that the two diagnostic calls cannot disagree.

Before deployment, verify the effective approved model configuration and output
budget for both profiling roles. The new synthetic planning probe was evaluated
with 16,000 output tokens, not the old 3,000-token planning default. This change
does not bypass approved-runtime configuration or modify production settings.
A local mock pass does not validate capacity, latency, cost or semantics under
a different production configuration. Preserve the actual effective configuration
with any subsequent release or live end-to-end evaluation.

## Reproducible testing and review

- `prisma/stance-evidence-smoke-test.ts` retains each expected/actual result,
  rationale, time and source hashes. It covers quote/source integrity, rejected
  or uncertain positions, compounds, omitted/duplicate claims, historical
  compatibility, schema round trips and recognition limits. These are synthetic
  contract tests, not semantic accuracy measurements.
- The initial-profile database smoke additionally verifies saved stance, quote,
  rationale, version and AgentCall link after the actual persistence service.
- `classroom:assessment-quality` freezes and saves 24 developer-proposed cases
  before calling the model. Two 12-case banks each run forward and reverse,
  four logical requests total. Output allowance is 16,000 tokens per request;
  production limits are not changed. It retains inputs, expected distinctions,
  actual interpretations, failures, prompt/configuration hashes and validation
  issues. Provider failure stops the run; failures are not discarded.
- Automated semantic expectations check judgment, claim count and expected
  stance/basis/scope/source distinctions. They do not verify every proposition's
  content. Independent reviewers must inspect exact quotes, content, omissions,
  false diagnoses, instructional response and closure using the review template.
- Tuning cases are regression cases, not a held-out validation set. Repeated
  calls are not independent students. Real classroom piloting should examine
  comprehension, burden, accessibility, teacher intervention and harmful/missed
  instruction. Learning-gain claims require separate outcome evidence.

Any failure correction changes the evaluated candidate. Keep previous results,
rerun affected checks, and report both versions rather than replacing a failed
record with a later success.
