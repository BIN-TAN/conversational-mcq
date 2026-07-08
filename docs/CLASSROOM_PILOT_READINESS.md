# Classroom Pilot Readiness

Phase 31a is a local readiness audit for a small classroom pilot of the fixed IRT, chat-native MVP. It is not a classroom-validity claim and does not authorize public deployment.

## Scope

The readiness layer checks that the implemented teacher-student workflow can be exercised with synthetic accounts and that teacher/research evidence surfaces are available after a session. It does not change item content, correct answers, scoring, misconception logic, provider prompts, or live provider configuration.

Run the no-live smoke:

```bash
npm run student:classroom-pilot-readiness-smoke
```

Run the latest-session workflow review:

```bash
npm run student:classroom-pilot-workflow-review
```

The review command writes a redacted local artifact under:

```text
.data/classroom-pilot-workflow-review/
```

Generated artifacts are ignored and must not be committed.

## Teacher Setup Flow

1. Seed local users and the fixed IRT MVP assessment.
2. Confirm the `teacher_demo` account exists and is active as `teacher_researcher`.
3. Confirm the fixed IRT MVP assessment remains published for the synthetic student start path.
4. Confirm teacher review routes load session detail, readable transcript, structured event log, session evidence audit, and research export.
5. Confirm default research export integrity is ready or ready with documented limitations.

Teacher/research surfaces may show aggregate counts, safe public IDs, timestamps, safe labels, provider metadata presence, token usage presence, and explicit limitations. They must not show answer keys, correct options, raw provider input/output, raw process payloads, raw distractor metadata, raw misconception IDs, internal database UUIDs, credentials, cookies, or secrets.

## Student Flow

The student pathway remains:

```text
student login
-> start fixed IRT MVP assessment
-> three protected initial items
-> package review
-> package analysis
-> activity runtime
-> activity response
-> choose another activity or move on
-> later completion path
```

The app owns assessment state, persistence, answer-key protection, and process-event logging. The LLM may generate conversational content only inside validated backend boundaries. The student UI must remain chat-native and must not show survey-style item submits during protected initial administration.

## Research Data Flow

After a completed or partially completed classroom session, teacher/research review should provide:

- response package;
- process-event summary;
- readable transcript;
- structured redacted transcript;
- turn-level response latency rows;
- engagement process feature rows;
- activity runtime attempt when the activity phase was reached;
- activity misconception evidence when a response was evaluated;
- post-activity diagnostic snapshot when the evaluator persisted evidence;
- agent audit summaries when LLM calls occurred;
- session data-completeness record;
- bulk research export;
- research export integrity review.

Older sessions or sessions stopped before activity runtime may legitimately lack activity attempts, post-activity evidence, or diagnostic snapshots. These are limitations, not automatic integrity failures.

## Failure Modes

Student-facing failure states must fail closed and preserve progress. Safe wording is:

```text
I could not safely review this response right now. You can try again, choose another activity, or move on.
```

```text
I could not safely prepare this activity right now. You can try again or move on.
```

The system must handle duplicate submit, refresh during an active item, refresh during activity, empty activity response, missing live activity packet, stale/missing activity attempt, old sessions without newer records, and export of incomplete sessions. Student-facing errors must not mention provider, validator, LLM, schema, agent, prompt, raw output, metadata, answer keys, or internal error details.

## Readiness Criteria

Phase 31a readiness requires:

- synthetic teacher and student accounts exist;
- a student session can initialize;
- the initial flow reaches package completion without live provider calls;
- the activity runtime projection is student-safe;
- injected evaluator output can create post-activity evidence in no-live smoke;
- move-on and choose-another paths are safe;
- teacher session detail, session evidence audit, readable transcript, structured event log, and bulk export load;
- research export integrity passes or reports only documented limitations;
- student projection excludes teacher/research/internal fields;
- teacher/research projection excludes protected raw data;
- activity runtime does not overwrite operational profile records;
- activity runtime does not mutate response packages;
- no OpenAI call occurs.

Readiness is a local engineering and workflow check. It does not establish learning impact, psychometric validity, classroom validity, or deployment readiness.

## Manual Dry Run

1. Start the local app.
2. Run `npm run llm:readiness`.
3. Log in as teacher and confirm classroom/student accounts.
4. Log in as student.
5. Complete the three-item package.
6. Enter the activity phase.
7. Submit an activity response.
8. Use continue, choose another, or move on.
9. Log in as teacher.
10. Open the session detail.
11. Inspect readable transcript, structured event log, process events, and session evidence audit.
12. Download all research data.
13. Run `npm run student:research-export-integrity-review`.
14. Confirm no protected data leaks.

Record only pass/fail observations, session public IDs, artifact paths, status fields, and limitations. Do not record secrets, raw provider payloads, answer keys, raw process payloads, or raw student text outside approved research artifacts.
