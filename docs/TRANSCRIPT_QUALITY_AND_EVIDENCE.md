# Transcript quality and evidence safeguards

Effective for newly generated feedback after the September 25, 2026 deployment.
Raw student messages, prior response packages, scores, and stored profiles are
not rewritten or retroactively reclassified by this change.

## Initial item interpretation

The existing initial formative-profile call now returns `semantic_item_reviews`
for every administered item. This does not add a separate provider call.
The application scores answer choices; the model interprets reasoning using the
administered stem, options, objectives, and teacher context. Neither correctness,
word count, uncertainty vocabulary nor confidence establishes reasoning accuracy.

Each review contains:

- `item_public_id`: exact administered item identity.
- `reasoning_judgment`: `supported_precise`, `supported_concise`, `partial`,
  `contradictory`, `insufficient`, or `irrelevant`.
- `reasoning_quote`: an exact excerpt of the student's final explanation.
- `explanation`: the model's interpretation, not a raw student observation.
- `misconceptions[]`: distinct supported hypotheses, each with a `proposition`,
  `source_field` (`reasoning` or `tempting_option_reason`), and `evidence_quote`.

Validation requires exactly one review per administered response, no duplicate
or unknown IDs, and quotations contained in the corresponding original field
(Unicode and whitespace normalization only). Unsupported or incomplete live
output is not accepted as a valid profile. Legacy/mock inputs without validated
reviews produce insufficient reasoning evidence, not assumed understanding.
Quotation validation establishes provenance, not the scientific correctness of
the model's interpretation; teacher review remains necessary.

A live configuration error is surfaced as unavailable/retryable, never silently
converted to a mock profile. Explicit local mock and evaluation runs remain
available. The existing provider limits, usage checks, and durable preparation
retry behavior remain in force.

The stored `evidence_integrated_profile_v2.item_evidence[].semantic_review`
retains these reviews. `semantic_review_audit` records `version`
(`semantic-item-review-v1`), `status`, `issues`, and `source_agent_call_id`.
Agent-call output also retains the structured review. These are derived
diagnostic records, separate from the unchanged raw product/process data.
Existing records without these fields predate this safeguard.

A supported short explanation is not negative evidence merely because it is
short. Correct choices may coexist with multiple incorrect propositions. Missing
semantic evidence is explicitly unverified. Confidence is elicited with the same
neutral question for all choices, without recommending Low, Medium, or High.

## Formative dialogue

The tutor reviews all response fields and carries independent difficulties across
topic changes. Teaching, practice, recognition, and demonstrated reasoning are
distinct. Giving an explanation does not establish that a student learned it.

The central output validator rejects concrete answer-letter examples in response
formatting instructions, not just particular question/letter combinations.
The existing bounded validation/repair path handles these rejections before a
reply is shown. Newly posed practice should wait for student answers; worked
examples and requested explanations remain allowed. This guard is not a proof
against every possible semantic answer disclosure.

Canonical formative evidence treats long verbatim copies of prior tutor text
(at least 80 normalized characters) and clearly request-only messages as
`evidence_quality_context`, not `student_understanding`. They stay in transcripts
and exports; no misconduct label is assigned. This narrow deterministic filter
does not detect paraphrases or establish authorship. Remaining semantic judgment
belongs to the model. Every terminal misconception disposition must still pass
the existing current-student-evidence and complete-claim-coverage validators.

## Readable transcript and timing

Structured answer/confidence clicks without message text are rendered as
`[Recorded action]` lines from allowlisted event fields. They are not invented
student quotations. Legacy edit placeholders use the historical turn's own
payload; if that payload lacks the old wording, the view says it is unavailable.
The latest mutable response is never substituted into an older turn.

Per-prompt latency uses the earliest eligible event/turn within the same session
and context. See `DATA_LOGGING_SPEC.md` for formula, source metadata, missing
values, overlapping-interval warnings, and server-versus-client timing limits.
No new browser observations are invented for old sessions.

## Verification

`npm run student:transcript-quality-regression` covers wrong reasoning despite a
correct answer, negation/length independence, multiple claims, quote and coverage
validation, supported concise reasoning, neutral confidence, historical actions,
practice-format disclosure, copied requests, session isolation, and interval
timing. Existing profile, communication, navigation, transcript, and research
export suites supplement these focused checks.

`npm run student:semantic-profile-runtime-smoke` uses an injected provider and
a disposable local database to check persistence, rejected fabricated quotes,
invalid profiles, and provider audit records without external AI calls.
`prisma/semantic-item-review-live-canary.ts` is separately opt-in and sends only
synthetic responses. The 3-item and 12-item checks completed using the production
model configuration (`gpt-5.6-sol`, medium reasoning, 3,000 output-token ceiling)
on September 25, 2026. This is a bounded canary, not a guarantee that every future
model response will validate or that every possible misconception is detected.
