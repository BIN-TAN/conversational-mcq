# Lossless AI input deduplication

Effective for requests made by the release that introduces
`lossless-agent-json-v1`; historical records are not rewritten.

## Scope and preservation

The OpenAI Responses request boundary compacts inputs for
`student_profiling_agent`, `profile_integration_agent`,
`formative_value_and_planning_agent`, and `formative_conversation_agent`.
Application state, validation, research exports, and saved `input_payload` use
the original expanded input. This is not a summary or deletion of observations.
Student text, item content, profile fields, evidence IDs, earlier/current
responses, nulls, zeroes, booleans, and array positions are preserved.

Exact repeated JSON strings, objects, and arrays are stored once in a request's
`definitions`; references use a sole-key `$input_ref` object. Same-shaped arrays
of at least three records with at least three fields can use `$input_rows`: one
header row followed by values for every original record. Each reference is
expanded before testing exact equality with the canonical source JSON. Object
keys are sorted for reproducibility; observation order is unchanged. Hash
collisions, malformed references, and round-trip mismatches are errors, not
silent evidence loss.

Source-supplied reserved transport keys cause a plain-JSON fallback. Small
inputs also remain plain JSON: encoding is used only when encoded input bytes
plus its interpretation instructions are below 90% of source bytes. Identical
records still occupy distinct positions. Values that differ by even one field
are not treated as interchangeable. Transport instructions expressly prohibit
student-facing disclosure of reference labels or internal IDs.

This removes repetition **within each request**. Stateless calls still receive
the context needed for their own task. Existing static-instruction caching is
retained; no cross-student conversation state or provider-side response storage
is introduced (`store: false`). Byte savings do not equal token or bill savings.

## Audit variables and calculations

`agent_calls.raw_output.input_projection` contains the following text-free
metadata when the provider returns a response. A caller that wraps raw output
may retain it inside its provider-output field. Central agent execution also
emits `agent_input_projection_prepared`; direct provider paths retain the raw
output audit instead. A transport failure before a response may lack that audit.

Accepted-output wrappers can place it at
`raw_output.accepted_output.provider_raw_output.input_projection`. The canonical
source hash covers the provider input, not later audit-only additions to a saved
record. In particular, initial feedback adds `runtime_budget` to `input_payload`
after constructing the request; exclude that field when reconstructing its
provider-input hash. The original instructional evidence remains unchanged.

| Variable | Definition |
| --- | --- |
| `encoding` | `lossless-agent-json-v1`, legacy `lossless-profiling-json-v1`, or `plain-json`. |
| `source_sha256` | SHA-256 of compact, recursively key-sorted source JSON, with array order preserved. |
| `wire_input_sha256` | SHA-256 of the exact user-input text sent to the provider, excluding instructions/schema. |
| `source_bytes` | UTF-8 byte length of canonical source JSON. |
| `wire_input_bytes` | UTF-8 byte length of transmitted user-input text, excluding instructions/schema. |
| `definition_count` | Number of factored values in the transmitted definitions dictionary; zero for plain JSON. |
| `reference_count` | Number of reference objects constructed in the envelope, including definitions; not a count of student actions. |
| `table_count` | Number of columnar record arrays constructed in the generic envelope; zero for plain JSON. |
| `roundtrip_verified` | Exact reconstruction check succeeded, or unchanged plain JSON was used. |

Input-body reduction = `1 - wire_input_bytes / source_bytes` for nonzero source
bytes. Total request savings must also account for instructions, output schema,
tokenization, and provider caching. Compare these variables with actual provider
`input_tokens`, `output_tokens`, `reasoning_tokens`, cache usage, latency, and
retry counts. Reasoning tokens are already included in output tokens: do not
charge them twice. Missing usage is missing, not zero.

## Reasoning configuration and approval

The operator-authorized runtime amendment changes only initial feedback and
ongoing conversation from `gpt-5.6-sol` / `medium` to `gpt-5.6-sol` / `low`.
Other models, reasoning settings, output ceilings, student limits, and validators
retain their approved values. The CLI `prisma/sol-low-reasoning-amend.ts` stages
an immutable child of the verified active approval bundle; it does not mutate
the running service. Its inherited evidence hashes and exact two-role diff are
verified before activation. Rollback remains available through the previous
bundle and previous role environment settings.

The initial live synthetic evaluation and deployment evidence are recorded in
the release ledger. Synthetic success is first-round engineering and content
review evidence, not an independent classroom comparison of learning outcomes.

## Regression checks

- `node --import tsx prisma/agent-input-deduplication-smoke-test.ts`
- `node --import tsx prisma/profiling-input-compaction-smoke-test.ts`
- `node --import tsx prisma/profiling-repair-smoke-test.ts`

The first command can additionally accept saved synthetic agent-call JSON files
to verify exact reconstruction of real-shaped request data. Never commit
identifiable student payloads as fixtures.

## Prospective readable tutor input

The current v18r2 tutor request can explicitly select `formative-tutor-input-v1`.
This is a role-specific provider representation, not a new stored evidence shape.
Other roles and historical request encodings retain the codec described above.

The tutor reads named sections rather than generic `$input_ref` dictionaries or
`$input_rows` tables. Each distinct canonical profile appears once in
`canonical_profiles`; current and initial profile metadata select it by name.
If the entire initial and current profile states are equal, an explicit
`same_as_current_profile` marker represents that equality. Distinct baseline
profiles, cutoffs, outcomes, limitations and history remain separate. Claim
catalogs similarly retain their complete original identities in named catalogs.

Evidence records retain literal `evidence_id` and `content` fields. Identical
scope metadata is declared once for all records, or for a particular evidence
kind. Eligibility that differs within a kind remains on each record. Process
observations use shared scalar metadata with full ordered records; repetitions,
timestamps, nulls and observed zeroes remain distinct. Complete visible transcript,
responses, assistance qualifications, continuity input when present, lifecycle,
teacher guidance and safety boundaries remain unchanged. No quote is summarized,
no historical turn is dropped, and no student-understanding judgment is computed.

Prospective whole-reply receipts marked `conversation-current-reply-source-v1`
or `conversation-prior-tutor-source-v1`
remain expanded in stored continuity and audit records. At the provider boundary
only, a matching support-history or need-support quote may use `quote_source`
with `kind: tutor_turn`, its exact tutor sequence index and reply SHA-256. The
complete message still appears in `visible_transcript`. Compaction requires a
unique tutor turn, exact full-text equality and the SHA-256 of its original UTF-8
bytes; unknown markers or unavailable/mismatching sources retain literal text.
Student quotes and unmarked historical excerpts are never converted. Conflicting
source layout markers cause unchanged plain-JSON fallback. The decoder verifies
the reference and restores the original full quote before the mandatory complete
round-trip comparison. Whole-reply binding establishes source identity, not the
semantic truth of each support claim or evidence of learning.

Typed support preference relationships, when present, remain literal and unchanged
through this projection. `honored_constraint` and `topic_of_support` are distinct
authored relationships; sharing a whole-reply quote never converts one into the
other or derives a relationship from text similarity. Legacy unmarked preference
IDs remain unchanged as well.

Semantic regeneration retains the rejected draft and diagnostics. Catalog and
lifecycle fields identical to the original context use explicit named context
links; differing repair fields remain literal. The provider instructions explain
this layout and retain the boundary between rejected drafts and student evidence.

Every projected input is exactly reconstructed and compared with recursively
key-sorted source JSON before dispatch. Unknown/legacy shapes or conflicting
source layout fields retain plain JSON instead of guessing at their meaning.
Saved `input_payload`, validation input, transcript, exports and research records
remain expanded originals. The existing provider audit records projection version,
source/wire SHA-256 hashes, byte lengths, distinct profile/catalog counts and
`roundtrip_verified`; it adds no student text. The explicit request encoding also
participates in the canonical request hash.

Run `node --import tsx prisma/formative-tutor-input-smoke-test.ts`, optionally
followed by saved **synthetic** AgentCall JSON files, to verify source preservation
and compare byte sizes with the earlier codec. The helper makes no provider calls.
Byte savings are not token/cost savings or evidence of improved tutoring; actual
model comprehension and conversation quality require separately labeled evaluation.
