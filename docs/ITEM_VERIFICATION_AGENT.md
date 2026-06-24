# Item Verification Agent

Phase 7D replaces the former Item Preparation Agent idea with the narrower `item_verification_agent`.

The Item Verification Agent verifies teacher-authored concept-based item sets. It does not generate concepts, learning objectives, MCQ items, alternative versions, rewritten stems, rewritten options, replacement distractors, replacement correct answers, or course-content recommendations.

## Scope

The agent may identify possible issues in:

- concept relevance
- learning-objective alignment
- stem ambiguity
- possible multiple defensible answers
- possible answer-key inconsistency
- weak, trivial, overlapping, or indistinguishable distractors
- obvious answer cues
- substantially duplicated items
- insufficient metadata for verification

Findings are advisory warnings. They never override teacher subject-matter judgment and never publish or edit content.

## Input

`ItemVerificationInput` contains only teacher-authored content needed for verification:

- concept-unit public ID, title, learning objective, related concept description, and version
- included item public IDs, order, stems, options, correct option, distractor rationales, expected reasoning patterns, possible misconception indicators, and versions
- verification constraints

The input excludes student data, student responses, transcripts, profiles, formative decisions, process events, summative outcomes, credentials, session cookies, internal auth tokens, API keys, database URLs, and raw environment variables.

## Output

`ItemVerificationOutput` includes:

- `verification_status`
- set-level findings
- per-item findings
- teacher-review-required flags

Findings contain only:

- issue code
- item public ID when relevant
- location
- option label when relevant
- concise explanation

The output schema rejects generated or rewritten content. Semantic validation also rejects phrases such as `rewrite as`, `replace with`, `use this item`, `change the answer to`, and `add a new question`.

## Mock And Live Behavior

Mock mode is the normal local-development default. Mock findings are infrastructure fixtures and should not be treated as validated item-quality judgments.

Live verification may occur later only when server-side environment variables explicitly enable OpenAI live calls and configure `OPENAI_MODEL_ITEM_VERIFICATION`, and usage guards allow the call.

No normal smoke test makes an OpenAI network call.

Synthetic mock cases live in `tests/fixtures/item-verification-cases.json`. They cover no-warning output, each advisory issue-code family, structural validation blocking, invalid generated/rewrite-like output, refusal, incomplete output, and timeout behavior. The cases use synthetic teacher-authored content and no student data.

## Audit

Each successful or failed verification call is audited through `agent_calls` with `agent_name=item_verification_agent`. Verification runs are stored in `item_verification_runs` with content fingerprint, deterministic validation result, optional agent-call link, output payload, warning counts, acknowledgement fields, and timestamps.

Historical `agent_calls.agent_name=item_preparation_agent` rows are preserved if they exist. They are retired audit data and are not rewritten.

## Phase 7E2A Quality Patch

Prompt version `item-verification-v3` explicitly requires
`teacher_review_required=true` whenever any finding exists, including set-level
duplicate-item findings. Item-specific findings also require the containing
`item_result.teacher_review_required=true`.

Semantic validation rejects empty-string substitutes for null, option labels on
non-option findings, unknown item/option references, duplicate findings without a
valid affected item or set-level location, and any rewrite or generation
suggestion.

## Phase 7E2C Deterministic Duplicate Safeguard

Prompt version `item-verification-v4` keeps Item Verification advisory and does
not generate replacement items. Phase 7E2C adds a deterministic supplementary
duplicate check that normalizes stems, options, and diagnostic signatures to
detect substantially duplicate item structures.

The system stores raw LLM verification, deterministic duplicate signal, and the
effective combined advisory result separately. The effective result can include
a set-level `substantially_duplicate_item` warning requiring teacher review,
but teacher publish override remains available and no item content is rewritten.
