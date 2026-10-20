# Task for Codex: live evaluation of interpretation v8 (fallback rate and label use)

You are working on the user's Windows computer in the repository at `E:\New_Downloads\Conversational MCQ` (PowerShell). The application is a Next.js and Prisma assessment system for a university course (EDPY 507).

The evaluation harness, its fixtures and the plan already exist; do not rebuild them. Read these two files first:

- `docs\INTERPRETATION_V8_EVALUATION_PLAN.md`
- `docs\AI_MODULE_REDESIGN_2026-10-19.md`, sections 4.2 to 4.4, 5, 11.1 and 11.2

## The questions the researcher wants answered

1. **Fallback.** How often does a submission end with a fallback profile, meaning no ratings and no claims? How often is the output salvaged instead (some items left unrated, some claims dropped)? Why, broken down by reason and by rejection code?
2. **Label use against the plan.** How often does the model use each label, and does that match the labels planned in advance? Answer this for each of the following:
   - explanation quality: adequate / limited / incorrect / no usable explanation
   - error source
   - item status
   - topic summary label: Mostly understood / Still developing / Need more work / Pending item review / Unavailable
3. **Strictness.** Are the application's checks rejecting too much, or is the model systematically harsher or more lenient than planned?

The researcher's guidance: the model should not be rejected too often, and the checks must not be stricter than they need to be. Students must never be stuck; that rule is already implemented and must stay intact.

## Hard rules

- **No pushing.** Never push, never deploy, and never change anything on Render or on the live site https://conversational-mcq.onrender.com. Do not run anything against the live site or its database. The evaluation needs no database.
- **Keys and logs.** Never print, log, copy or commit the OpenAI key or any other secret. Never commit `.env.local` or anything under `.data\`.
- **No approval hashes.** Do not set the approval hashes (`*_APPROVED_PROMPT_HASH`). Only the researcher decides that, after the evaluation.
- **Fixtures stay fixed.** Do not change the expected categories in `src\lib\evaluation\interpretation-v8\fixtures\` to match the model. If a fixture is demonstrably wrong (for example a typo, or an expectation that contradicts the rules in section 4.2), stop and list it in your report with the evidence; do not edit it.
- **Thresholds stay fixed.** Do not change the go-live thresholds.
- **Prompts stay fixed.** Do not change any model prompt; the prompts are copied verbatim from the design document. Propose prompt changes in your report instead.
- **Only the code changes in Phase 4,** on a separate branch, each with a unit test.
- **Budget.**
  - Stop and report if more than 1,000 model calls would be needed in total.
  - Stop if the provider returns quota or authentication errors.
  - The commands print the expected number of calls before they start.

## Phase 0: get the code and check it (no model calls)

```powershell
cd "E:\New_Downloads\Conversational MCQ"
git status    # if there are uncommitted changes, stop and report them; do not discard anything
git fetch origin
git bundle verify ".data\redesign-2026-10-19\redesign-interpretation-2026-10-19-v2.bundle"
git fetch ".data\redesign-2026-10-19\redesign-interpretation-2026-10-19-v2.bundle" redesign/interpretation-2026-10:eval/live-2026-10
git switch eval/live-2026-10
npm install
npx prisma generate
npm run test:redesign-v8
npm run eval:v8 -- check
npm run eval:v8 -- run --engine local --runs 1 --out .data\interpretation-v8-evaluation\local-check
```

What to expect:

- **`test:redesign-v8`** must pass.
- **`check`** must report 31 simulated students, 124 item responses, 18 feedback cases and no problems.
- **The local run** uses deterministic stand-ins, which are not a model. It only shows that the pipeline runs. Its quality numbers are meaningless; do not report them.

If any of these fail, stop and report the exact output.

## Phase 1: one live development run

**Environment.** The live run reads `.env.local`. It needs `LLM_PROVIDER=openai`, `LLM_LIVE_CALLS_ENABLED=true` and the OpenAI key; these are already present if the researcher uses live calls locally.

- Do not add or edit secrets. If something is missing, stop and say which variable name is missing, without its value.
- The model settings must be the same as production. If you can see which model names Render uses, record them. If you cannot, record what `.env.local` resolves to (in `settings.json` of the run folder) and flag that it may differ from production.

```powershell
npm run eval:v8 -- run --engine live --runs 1 --allow-live --out .data\interpretation-v8-evaluation\dev-1
```

This runs 49 cases: 31 profiling submissions and 18 feedback messages.

- **Expected calls:** usually about 64, at most 222.
- **Retries:** a transient failure (rate limit, timeout, network or server error) is retried as the production preparation job would retry it, before it counts as a fallback.
- **Resuming:** if the run stops, the same command resumes where it stopped.

The command writes these files to the run folder:

- `report-design.md` and `report-design.json`, scored against the planned (design) categories
- `mismatches-design.csv`
- `feedback-reading-sheet.csv`
- `runs.jsonl`, the raw outputs

## Phase 2: stability and fallback rate (three runs)

```powershell
npm run eval:v8 -- run --engine live --runs 3 --allow-live --out .data\interpretation-v8-evaluation\stability-1
```

This makes 147 runs: 93 profiling submissions and 54 feedback messages. Expect about 190 calls, at most 666.

## Phase 3 (optional, only if the researcher's OpenAI quota comfortably allows it): class-sized burst

This simulates a class submitting at the same time, to see whether rate limits cause fallbacks.

```powershell
npm run eval:v8 -- run --engine live --runs 1 --part interpretation --concurrency 10 --allow-live --out .data\interpretation-v8-evaluation\burst-1
```

## Phase 4: analysis, then only the allowed fixes

Analyse Phase 1 and Phase 2 from the report files and `runs.jsonl`.

1. **Fallback and salvage.** Report all of the following, for the three-run set and for each run:
   - the fallback rate with its 95% interval (shown in the report)
   - fallback broken down by reason (`fallback_by_reason`)
   - salvaged outputs, unrated items and dropped claims
   - the mechanical repairs applied, counted by code
   - first-attempt success
2. **Label use against the plan.** Copy the tables under "How often each label was used: plan against model" for the four fields. Name every label whose share differs from the plan by more than 10 percentage points, and say which way the shift goes. For example, "limited 25% vs 11% planned: the model rates complete explanations as limited". Use the situation table to show which ways of expressing reasoning cause each shift.
3. **Strictness review.** For every rejected attempt in `runs.jsonl` (`attempts[].issues`), classify each issue code:
   - **Correct rejection:** the output really broke a rule.
   - **False rejection:** the output was acceptable and the check fired anyway, for example a wording pattern matched course content, or a quote differed only in punctuation or spacing.
   - **Mechanical slip:** something a fixed rule could repair without changing what the output claims.

   Give a table with the columns code, count, share of attempts, two real examples (path plus the offending text), verdict and proposed change.
4. **Allowed fixes.** Make these only on a new branch, `eval/strictness-fixes`, created from `eval/live-2026-10`. Make one commit per change, each with a unit test in `prisma\interpretation-v8-unit-test.ts` or `prisma\feedback-v8-unit-test.ts`.
   - **(a) Narrow a wording pattern** that produced a false rejection on course content or neutral description. The patterns are in `src\lib\services\student-assessment\interpretation-v8\validate.ts` and `src\lib\services\student-assessment\feedback-v8\validate.ts`. The test must show the false positive now passes and a true positive still fails.
   - **(b) Add a deterministic repair** in `src\lib\services\student-assessment\interpretation-v8\repair.ts`, for a mechanical slip seen at least twice that a fixed rule can correct without changing what the output claims about the student. Record it with its own repair code.
5. **Never loosen these, even if they reject often:**
   - an invented or unfound quote that does not paraphrase the student's own words;
   - a misconception claim from a choice alone, a rejected idea, a question or process data;
   - process data or misconduct, tool-use, independence or character language in instructor-facing or student-facing text;
   - internal labels shown to students.

   Propose changes to these in the report only.
6. **After any fix:**
   - run `npm run test:redesign-v8`;
   - run `npx tsc --noEmit -p tsconfig.json`, and report only new errors in the files you changed;
   - repeat Phase 1 into `dev-2` and compare it with `dev-1`.

## Phase 5: materials for the human reference coding (no model calls)

```powershell
npm run eval:v8 -- coding-sheet --out .data\interpretation-v8-evaluation\coding
```

Do not fill in the sheet. Two human coders do that, without seeing any model output. The formal go-live decision uses their resolved reference (`score --reference`), which comes later.

## Your report

Write `.data\interpretation-v8-evaluation\CODEX_REPORT.md`, in plain English with short sentences, and include:

1. **The three answers:**
   - the fallback rate and the main reasons for it;
   - the label-use shifts against the plan;
   - whether any checks are too strict.

   Give each answer as two or three sentences with numbers.
2. **The criteria tables** from the Phase 2 report (pass, fail or not assessed), saying that "not assessed" items need the human coders.
3. **The tables** from Phase 4, steps 1 to 3.
4. **The changes made in Phase 4:** branch, commits, tests, and before/after numbers.
5. **Proposed prompt changes** with the evidence, not applied.
6. **Fixture doubts,** if any, with the evidence, not applied.
7. **Calls and tokens used** (from the reports), and anything that did not run and why.
8. **The full path of every file written.**

Do not commit anything under `.data\`. Do not merge `eval/strictness-fixes` into any other branch; the researcher will review it.
