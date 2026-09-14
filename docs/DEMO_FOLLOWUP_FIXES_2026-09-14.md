# Classroom demo follow-up corrections

## Scope

Follow-up to the ten-demo review of commit a571d7e82f5ae14fd083bff4c3aef69c2a3add09.
Historical evaluation packages, prior demo evidence, stored responses, profile semantics,
teaching prompts, answer keys, schemas, and approval/activation artifacts are unchanged.

## Corrections

- Student assessment and formative transcript projections share one pseudonymous turn
  identifier. The review screen can deduplicate a message appearing in both projections
  without matching message text or suppressing genuine repeated student messages.
- The compatibility understanding label now distinguishes partial understanding and
  specific misconceptions from sound understanding. This changes presentation, not
  the underlying evidence classification or a mastery threshold.
- Teacher review uses the parent attempt's terminal state for legacy follow-up controls
  and labels. Original round status remains available as historical status; no stored
  round is rewritten. Timeline labels use local message numbers rather than global
  storage sequence indexes. Storage/evidence reference indexes remain unchanged.
- Tutoring, profile integration (including its repair attempt), and chat-native
  formative planning now check the common usage admission guard before provider
  dispatch. A reserved call does not count against itself, while other pending calls
  do. Blocked calls retain the exact usage reason and no provider response ID.

## Verification

- `node scripts/student-demo-regression.mjs`: 22/22 focused checks passed against a
  disposable local audit database, with external network/provider requests blocked.
- `npm run typecheck`: passed.
- `npm run lint`: passed with five pre-existing unused-variable warnings in historical
  evaluation files.
- `git diff --check`: passed.
- `npm run build`: passed, all 77 static pages generated.
- `node scripts/classroom-ux-smoke.mjs`: 26/26 browser checks passed against local
  synthetic data, including 320/390/768/1440px layouts, accessibility checks, waiting
  notices, read-only past attempts, and ended-attempt controls. External requests
  and provider calls were blocked.

## Operational allowance change

The user authorized increases if needed for the ten new demo scenarios. On the
canonical conversational-mcq service only, the requested configuration is:

- LLM_DAILY_STUDENT_TOKEN_LIMIT: 300000 -> 5000000.
- LLM_SESSION_TOKEN_LIMIT: 250000 -> 1000000.
- LLM_DAILY_CLASS_TOKEN_LIMIT remains 8000000; model/reasoning/output limits and
  operational approval/activation settings are unchanged.

These are cumulative admission limits, not exact prepaid token reservations or a
guaranteed dollar ceiling. Calls already in flight can finish across a token limit.
Increasing allowances avoids quota-blocked profiling; it does not reduce model latency.

## Repeat-demo evidence

New live results belong in `outputs/live-demos-2026-09-14-r2/`, separate from the first
run. Test only the authorized synthetic test_01 account. Preserve request/response
evidence and distinguish live validated profiles from conservative fallback profiles.
API scenario timing is not genuine student typing, attention, or dwell-time evidence.
Ten sequential scenarios are not a multi-student load test.
