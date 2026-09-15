# Classroom Preparation Latency

These optimizations accompany the durable initial-preparation worker described in
`BACKGROUND_PREPARATION.md`. They do not switch models, reduce reasoning effort,
lower output ceilings, stream unvalidated text, or remove profile validators.

## Shared Assessment Content

Publication compiles the included items, media descriptions, and diagnostic
guidance into a private `ConceptUnit.prepared_response_context` cache.
The immutable assessment identifiers, revision, ordered content, and guidance
bind the cache to its source. The stored content also has an integrity hash.
Any source change, unknown cache version, or corrupt entry causes recompilation.
Already-published assessments initialize their cache lazily on the next package.

Only authoring content enters the cache. Student answers, confidence, timing,
process events, and profiles are never shared. Response packages retain their
existing complete content and historical snapshots. No cache field is added to
student projections or research exports. Apply migration
`20260914210000_prepared_assessment_context` before running this version.

## Static Prompt Reuse

The current profiling and formative requests opt in to explicit-only static
instruction caching for `gpt-5.6-sol` and `gpt-5.6-terra`. The same code-owned
instructions are sent as a developer message, with a breakpoint before the user
message containing all dynamic evidence. Other models and requests without the
explicit opt-in preserve the original request format. Semantic-repair suffixes
remain code-owned instructions; rejected candidate content stays in the dynamic
user message.

`store: false`, model settings, schema, validation, and retention defaults are
unchanged. There is no breakpoint on student information. The cache flag is
included in canonical request provenance. Provider cache reuse is opportunistic,
not guaranteed, and an initial cache write can cost more than an ordinary input.
See the official [prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching).

## Independent Initial Interpretation

Background preparation captures the integration source evidence before allowing
the legacy package-profile request to begin. Their provider work can overlap;
the package profile waits for integration persistence before changing phases,
creating the formative plan, or running canonical profiling and the opening.
The legacy synchronous evaluation entry point retains its sequential ordering.

Both branches settle before a failed job can retry. Existing leases, cancellation,
usage admission, and validation remain active. Each worker job may have at most
two initial provider requests in flight, so the default two jobs can produce four
such requests across different students. The remaining dependent stages are
sequential. No diagnostic role or evidence category is collapsed or removed.

A validated integration receipt is reusable only for the same session, topic,
exact redacted input, prompt/schema, provider, model, reasoning, temperature,
verbosity, live-call permission, and token ceiling.
The result is validated again before reuse. Failed or invalid results are not
reused. This repairs the gap where generation succeeded but a worker stopped
before saving the profile; it is not an exactly-once provider-billing guarantee.

## Necessary Repetition

The teaching prompt is unchanged: detail and repetition remain available when
they help the student. There is no word cap, forced summary, transcript trimming,
or removal of student evidence. Only an exactly duplicated item diagnostic note
in a formative provider payload is replaced with a reference to its included
item. Differing historical guidance stays inline. Stored evidence is not changed.

## Verification

### Lossless Profiling Transport (2026-09-15)

Canonical profiling opts in to `lossless-profiling-json-v1` at the provider
serialization boundary. Exact repeated large strings and objects are stored
once in a request-local dictionary; occurrences use content-addressed references.
Arrays retain every position, so repeated actions are not merged. Different
historical/current snapshots, revised reasoning, timestamps, evidence IDs, and
ordering remain distinct. Object keys are ordered canonically so hashes and
references can be reproduced after PostgreSQL JSONB storage. A recursive
expansion must reproduce that canonical source JSON exactly before dispatch.
Small inputs or inputs containing the reserved reference
key stay in plain JSON. The projection never summarizes or truncates evidence.

Validation, response packages, AgentCall source inputs, research exports, and
historical records retain their original expanded form. Model, reasoning, output
ceiling, output schema, and pedagogical instructions are unchanged. Static
transport-reading instructions explain references without treating dictionary
values as instructions or introducing new evidence IDs. The encoding version
participates in request identity; only code-opted-in canonical profiling uses it.

The backend-only `agent_input_projection_prepared` event records the AgentCall
reference, encoding version, source/wire hashes, byte counts, reference counts,
and round-trip result. It contains no response text and is not student activity.

Profile integration now validates its student-safe projection before accepting
or reusing a provider receipt, not only at later persistence. Bare pronouns are
not safety violations. Explicit third-person student wording is a non-blocking
style warning; substantive disclosure rules remain blocking. Accepted integration
events retain the style-warning codes and projection acceptance status. Rejected
outputs remain invalid, not successfully validated receipts.

`student:profiling-compaction-smoke` verifies round-trip fidelity, separate event
occurrences, snapshots, malicious reference keys, cache privacy, unchanged model
settings, opt-in request identity, the preserved live sentence, and disclosure
negative controls. It optionally accepts a local file of redacted demo inputs
for offline replay; those inputs must not be committed as fixtures.

- `student:latency-smoke`: cache equivalence/invalidation, private suffixes,
  request provenance, lossless diagnostic references, and parallel failure joins.
- `student:latency-database-smoke`: actual PostgreSQL cache round trips,
  historical-package preservation, and validated receipt reuse/rejection.
- `student:initial-preparation-smoke` and `student:initial-preparation-ux-smoke`:
  durable work, ownership, recovery, cancellation, and browser behavior.

Use an isolated loopback test database, mock providers, live calls disabled, no
provider credential, and the classroom network guard for verification. Production
latency improvements and cache hit rates require subsequent authorized use;
local mock timings are not estimates of model-generation speed.

### Final Local Gate (2026-09-14)

- Latency contracts: 9/9; PostgreSQL cache and receipt recovery: 4/4.
- Durable preparation: 15/15; production-build browser checks: 8/8.
- Browser layouts checked at 320px, 390px, and 1440px. HTTP submission returned
  202 in 158ms in the isolated test environment, before any mock generation.
- Content governance, formative profile, profile integration, profile handoff,
  package-feedback recovery, attempt lifecycle, workflow worker, research export,
  data-collection completeness, and item-timing regressions passed.
- V18R2 provider-request and contract checks passed without provider dispatch.
  Request-shape assertions now inspect the static/dynamic message array. Two
  older test fixtures now have an explicit demo-teacher owner; access policy is
  unchanged.
- Typecheck, lint, production build, and whitespace checks passed. Existing lint
  warnings in frozen evaluation files remain unchanged.
- Application verification used synthetic local data and mock providers with
  external network requests blocked. No live generation benchmark was performed.
- The separate dependency advisory check queried the public npm registry and
  reported zero vulnerabilities, with publisher integrity verified.
- The earlier unrelated automation-smoke limitation remains documented in
  `BACKGROUND_PREPARATION.md`; approval gates were not weakened.

Deployment must apply both additive migrations before starting the updated
service. The canonical Docker service uses `npm start`, which now supervises the
web application and its preparation worker. Do not use the historical staging
blueprint for this deployment.
