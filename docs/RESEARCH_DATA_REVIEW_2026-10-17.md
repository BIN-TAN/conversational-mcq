# Research data collection review (2026-10-17)

**Question asked:** are the research data collected reasonably and defensibly, and
what are the issues?

**Method.**

1. **Live records (read-only).** The pilot records on the Render service
   (`conversational-mcq.onrender.com`) were read through the teacher interface and
   its JSON endpoints, signed in by the researcher. Only aggregate counts were
   computed. Nothing was changed, exported or downloaded, and no student is named
   here.
2. **Code audit** of collection, export and dictionary code in the working copy,
   including the D1–D11 changes. `docs/DESIGN_ALIGNMENT_2026-10-17.md` lists those
   changes.

## Pilot data at a glance (read 2026-10-17)

| Measure | Value |
| --- | --- |
| Students with data | 8 |
| Attempts | 54, across 7 mini tests: 49 first attempts, 4 second, 1 third. Test 1, Test 2 and Test 4 each exist twice; use `assessment_public_id`, not the title |
| Item responses / process events / transcript turns / AI calls | 225 / 16,855 / 2,226 / 606 |
| Sealed initial response packages | 53 of 54 attempts. The one without a package is a second attempt with no answers |
| Attempt status | 16 completed; 21 ended by the student before Finish; 17 still "active" or "paused", 12–26 days after the last activity |
| Learning support preparation | 48 completed; 2 failed; 1 stuck as retryable; 2 cancelled |
| Learning conversations | 49 started. 22 (45%) have no student message; median 1 student message, maximum 9 |
| Post-conversation profile update | 4 validated, 36 incomplete, 9 not attempted |
| Message length (characters) | Tutor: median 995, maximum 9,779. Student: median 82, maximum 1,275 |
| Live model settings | GPT-5.6 Luna medium for 17 roles; GPT-6.1 Sol medium for the conversation tutor. This matches the five-module policy |
| Research export | Ready. HMAC-SHA-256 with a secret key (fingerprint `1d1bfcb0c640`, not the public test key) |

## Findings

Severity reflects the risk to the dissertation's claims, not to the application.

### Consent (resolved by process)

The researcher collects consent separately with Google Forms. Before analysis, filter
`research_student_id` against the consent list and keep a dated record of who was
excluded and why. The system keeps no consent field, and none is needed for this
study design.

### High

**H1. Attempt status does not say whether the evidence is usable. Fixed in the export.**
- **Cause:** early pilot attempts were made before later fixes. Some never reached
  "completed" although the student had done everything (the researcher confirmed
  these are defect traces).
- 17 of 54 attempts have stayed "active" or "paused" for weeks.
- 21 are "ended early", although nearly all of these students submitted every
  answer, and several had conversations.
- **Fixed (R4):** `sessions.csv` now has `initial_package_sealed`,
  `feedback_shown`, `conversation_started`, `conversation_student_message_count`,
  `finish_chosen` and `evidence_stage`. `evidence_stage` takes one of
  `responses_incomplete`, `package_sealed`, `feedback_shown`,
  `conversation_participated` or `finished`.
- **Analysis rule:** select attempts by evidence stage, not by Finish status:
  - initial package sealed (53 of 54);
  - feedback shown;
  - conversation started;
  - number of student messages;
  - Finish chosen.
- Pre-register that rule. Consider closing idle attempts automatically after a set
  period, with a recorded reason, so the status field is final.

**H2. Thin conversation data for RQ3.**
- 45% of conversations have no student message, and the median is one message.
- Report participation explicitly. Treat conversational-reasoning analyses as
  descriptive with small denominators.
- Tutor messages are explanatory by design (median about 1,000 characters). Report
  their length descriptively under RQ4 feasibility, alongside student feedback.

**H3. Missing AI output: a defect from earlier versions, fixed in later releases.**
- **Investigation** (live process events and the 13 Oct export):
  - In 4 of the 5 attempts without prepared feedback, the feedback-writing role
    (`formative_value_and_planning_agent`) returned output that failed the
    application's validation on every try, including after its repair attempt.
    These were 2 on 27 Sep, 1 on 4 Oct and 1 on 5 Oct.
  - In the fifth (4 Oct), the opening tutor message failed validation.
  - Across the pilot, validation rejected 25 feedback drafts, 19 profile-integration
    drafts and 3 profiling drafts, almost all on 4–5 Oct.
- **Fix history:**
  - Release CMCQ-20261005-01, later on 5 Oct, fixed the cause of the repeated
    feedback blocks ("misplaced answer-only quotations that repeatedly blocked
    preparation").
  - CMCQ-20261005-02 and CMCQ-20261007-03 corrected further validator mismatches.
  - CMCQ-20261013-03 added the profile-fidelity rules and one audited repair.
  - Synthetic runs after each fix completed (8 of 8 on 5 Oct; 7 of 7 on 13 Oct).
  - No pilot attempt has started since 5 Oct, so classroom confirmation is still
    pending.
- **Current safeguards:**
  - six automatic tries;
  - a student-triggered retry that adds three more;
  - "continue without feedback", so the student is never stuck;
  - the stuck-reply sweep (F-D2a);
  - every rejected draft kept for audit (now exported, see H4).
- **Monitoring for 2027:** check how often `feedback_shown` is false among sealed
  packages after each class. A rate above about 5% should trigger review of
  `ai_call_audit.csv`.
- 5 of 53 submitted attempts never received prepared feedback or a conversation
  (2 failed, 1 stuck, 2 cancelled).
- Only 4 of 49 conversations produced a validated post-conversation profile.
- For RQ2, report these as "AI output unavailable" categories with denominators, as
  §3.6.3 already plans for fallbacks.
- Do not use post-conversation profiles as an outcome unless they become reliably
  available.

**H4. AI calls cannot be audited from the exports. Fixed (R3) for researchers only.**
- The database stores each call's input, raw output, validated output and reasoning
  effort, but the research export omits them, and omits the prompt hash.
- Instructor reports (D8) appear in no export.
- **Fixed:** research exports generated with **Restricted research fields** now include
  `ai_call_audit.csv` and `ai_call_audit_data_dictionary.csv`. They list every model
  call per attempt, plus instructor reports. Each row gives role, module, model,
  reasoning effort, prompt version and hash, input, raw output (including rejected
  drafts), validated output, status, validation error, tokens and timing.
- **Privacy:** students never see these files, and default exports never include
  them. Model inputs contain only the allow-listed evidence the application sends
  (no names or account IDs). Join to `conversation_turns.csv` and
  `feedback_exposure_events.csv` to see which validated outputs were displayed.

**H5. Variables changed meaning mid-study without a version marker. Fixed for new attempts.**
- The pilot ran across several software releases (21 Sep – 5 Oct). The 17 Oct
  changes alter some variables: timing start (D4), skipping (D5), the engagement
  label (D3) and paste handling (D10).
- **Fixed:** each new attempt now records the application commit and
  `data_collection_rules_version` when it starts. Both are exported as session
  columns: `collecting_application_git_commit` and `data_collection_rules_version`.
  Earlier attempts show `pre_2026_10_17_unversioned`.
- The dictionary now ties the timing definition to that version instead of a
  calendar date.
- **Still to do:** tag the pilot attempts with the release that served them, using
  their start times and `docs/release-records/releases.json`.

### Medium

| ID | Issue | Status |
| --- | --- | --- |
| M1 | `insufficient_knowledge_selected` combined three different things: final IDK, ever chose IDK, and an AI flag | **Fixed:** added `final_idk_selected`, `ever_idk_selected` and `ai_flagged_insufficient_knowledge`; the old column is kept |
| M2 | Blocked pastes (D10) were indistinguishable from real pastes in the export | **Fixed:** `payload_paste_blocked` column, with a dictionary entry |
| M3 | Typing and paste events are attributed to the first unfinished item, not to the field typed in. Edits to earlier items or on the review screen are misattributed | Open: tag each event with the item and field |
| M4 | Browser and server clocks are mixed when ordering events and hidden intervals | Open: order by `server_received_at` and export a per-session skew estimate |
| M5 | `attempt_number` counts per mini-test version; the three-attempt cap counts per family. The dashboard and report use the latest attempt | Open: add a family attempt index and pre-register which attempt each RQ uses, for example the first sealed attempt |
| M6 | Item time runs from presentation to submission, including hidden or paused time. The focus-adjusted time is computed but not exported | Open: export it with the number of presentations |
| M7 | Exports are key-coded, not de-identified. Session IDs and exact timestamps appear throughout, and free text is not redacted | Open: give Appendix D coders per-export aliases and text with names redacted |
| M8 | Older exports might have used the public test key | **Checked:** all 18 export jobs since 15 Jul used the secret key (fingerprint `1d1bfcb0c640`); the one from 10 Jul recorded no fingerprint. Resolved |

### Low

- New events (`attempt_tab_claimed`, `formative_conversation_ended_by_student`) have
  generic codebook text and are not yet described in `DATA_LOGGING_SPEC.md`.
- `key_count` counts every key, including arrows and modifier keys.
- Typing `duration_ms` includes pauses.
- Blocked drag-and-drop attempts are prevented but not logged.

## Verification of the downloaded research export (13 Oct export, 34,927 rows)

The researcher asked for the export to be inspected. It was read inside the signed-in
browser session; only aggregate counts left the browser.

| Check | Result |
| --- | --- |
| Tables present and joinable | 43 files; every `item_responses` row joins to `sessions` (0 orphans); 54 sessions, 225 responses, 2,226 transcript turns |
| Core response fields | 225 of 225 have an option, reasoning, confidence and the alternative question answered; no skip flags; all finalised |
| Alternative reasoning | 183 of 225 (81%) answered "no other option was tempting". Alternative-option evidence for RQ1 is therefore thin; report its frequency |
| "I don't know yet" | Final choice E: 1. The old combined flag: 11, mostly AI flags or earlier choices. This confirms the need for the split columns (M1, fixed) |
| Very short reasoning (under 15 characters) | 14 of 225 |
| Item time (presentation to submission) | 220 recorded and 5 missing; median 2.6 min; 95th percentile 7.9 min; maximum 55 min; none negative. All marked `partial` because active typing time is not measured, as designed |
| Pseudonymization | HMAC with the secret key; no raw usernames in the research tables |
| Empty student turns in `conversation_turns.csv` | 450 student turns have no message text (structured actions such as option choices). Filter on `message_text` for language analyses |
| AI validation outcomes | Rejected drafts are recorded with status and repair state (see H3) |

## Student experience in the conversation (context for H2)

The researcher attributes the low participation in the pilot partly to early
usability problems and technical defects. These were fixed in later releases (see
H3).

**Design decision (researcher, 17 Oct):** the conversation stays free-text, with no
suggested-reply buttons. Tutor messages stay explanatory and fully accessible to
students at every level of understanding, even when this makes them longer. Message
length is therefore not treated as a problem to reduce.

**Monitoring:** track `conversation_student_message_count` and the share of
conversations with no student message after each class. Read them alongside the
student questionnaire item on manageable time and effort (Appendix C.1).

## What is done well

- Each response stores the item snapshot and version the student saw, and exports
  read from that snapshot, so later teacher edits do not change the record.
- The sealed initial package preserves the first answer, justification, confidence
  and alternative reasoning. Revisions keep their before and after values.
- Pseudonyms use a keyed hash, and the key is required in deployed environments. The
  live export uses a secret key and records its fingerprint.
- Answer keys and teacher diagnostic fields appear only in restricted exports.
- Timing rows carry quality and limitation codes. Fallback profiles and the profile's
  source provider are flagged.
- Each export is a single consistent snapshot. Process events are delivered once,
  with delivery-gap markers, and browser events never contain response text.

## Recommended order before the 2027 data collection

1. Write down the analysis rules: the consent filter from the Google Forms list,
   attempt selection (for example the first attempt with `evidence_stage` of at
   least `package_sealed`, per mini test and student), and how missing AI output is
   counted (H1, H3, M5).
2. Release the export changes (R1–R4) so new attempts carry provenance and evidence
   stages, and restricted exports carry the AI audit.
3. Monitor conversation participation after each class (H2). The conversation stays
   free-text, with explanatory tutor messages.
4. Item and field attribution of typing events, clock handling and focus-adjusted
   time (M3, M4, M6), if process data will support any claim.
