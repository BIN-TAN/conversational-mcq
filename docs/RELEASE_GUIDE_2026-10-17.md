# Release guide for the 17 October 2026 changes

## Why there is a separate release folder

Your project folder (`E:\New_Downloads\Conversational MCQ`) also holds the
unfinished V41 tutor-repair work from 13–15 October. That work changes the
profiling prompt (v7 to v10) and the tutor prompt (v7.17 to v7.25), and those
versions have not been approved yet.

The live site checks every prompt against its approved configuration
(release CMCQ-20261013-03, commit `3aaf605`). If the whole folder were deployed,
that check would fail, and the live AI would switch itself off for every student.
The health page would still say "ok", so nobody would notice until a class.

To avoid that, the 17 October work was copied onto the exact live release in a
separate branch, `release/design-alignment-2026-10-17`. That branch changes no
model, prompt or reasoning setting, so the approved configuration stays valid.
The V41 work stays in your main folder, untouched, for a later release.

The branch is in `.data\release-candidate-2026-10-17\design-alignment-2026-10-17.bundle` (the `.data` folder is never committed).

## Step 1. Make a release folder from the bundle (about 5 minutes)

Open PowerShell in the project folder (see `docs/LOCAL_CHECKS_GUIDE.md`, section 1).
Paste each line, press Enter, and wait for the prompt before the next one.

```powershell
cd "E:\New_Downloads\Conversational MCQ"
git fetch ".\.data\release-candidate-2026-10-17\design-alignment-2026-10-17.bundle" "release/design-alignment-2026-10-17:release/design-alignment-2026-10-17"
git worktree add "E:\New_Downloads\cmcq-release" "release/design-alignment-2026-10-17"
Copy-Item ".env.local" "E:\New_Downloads\cmcq-release\.env.local"
cd "E:\New_Downloads\cmcq-release"
npm ci
npx prisma generate
```

This creates a second folder, `E:\New_Downloads\cmcq-release`. Your main folder
and its V41 work are not changed.

## Step 2. Run the local checks in the release folder (about 5 minutes)

```powershell
powershell -ExecutionPolicy Bypass -File "E:\New_Downloads\cmcq-release\scripts\local\run-local-checks.ps1"
```

Every step should say PASS. The results are saved in
`E:\New_Downloads\cmcq-release\local-check-results`.

The live AI approval check was already run on this code (17 October), using the
approved configuration from the 13 October release. The release branch passed. The
full project folder failed on the profiling prompt (v10 instead of the approved v7),
which is why the release is a separate branch. The paid simulation in Step 3
checks this again: if the approval did not match, every AI step would be blocked.

## Step 3. Simulated students with real AI calls (paid, about 15–40 minutes)

This runs simulated students through the real application, database, AI
preparation, tutor conversation, dashboard and research export. It uses the
models that are live now: GPT-5.6 Luna medium, and GPT-6.1 Sol medium for the
tutor. It creates a new, empty database on your computer for each run. It never
touches the live site or the pilot students' records.

Requirements:
- The local database is running (`npm run db:up` with Docker Desktop, or the
  PostgreSQL service).
- `.env.local` has your OpenAI key (`OPENAI_API_KEY`, or `OPENAI_API_KEY_FILE`),
  as it did for the 13 October runs.

First a free practice run, which makes no AI calls and only lists the cases:

```powershell
npm run classroom:ai-students -- --dry-run
```

Then one paid case, about US$0.20–0.40:

```powershell
npm run classroom:ai-students -- --allow-live-synthetic --runtime-env "E:\New_Downloads\Conversational MCQ\.data\release-candidate-2026-10-17\sim\runtime-env.json" --case brief_explanation_then_detail
```

If it ends without an error, run all eight cases, about US$2–4 in total
(at most 240 AI calls):

```powershell
npm run classroom:ai-students -- --allow-live-synthetic --runtime-env "E:\New_Downloads\Conversational MCQ\.data\release-candidate-2026-10-17\sim\runtime-env.json"
```

The results are saved under `E:\New_Downloads\cmcq-release\.data\ai-student-evaluation\`
(one folder per run). Tell Claude when a run finishes, and it can read and check them.

## Step 4. Before deploying

1. **Multi-topic mini tests.** After deployment, a published mini test with more
   than one topic is no longer offered for new attempts (existing attempts can
   still be resumed). In the teacher pages, check that each published mini test
   has one topic. Split or archive any that do not.
2. **Render settings, exactly as written (lowercase):**
   - `OPENAI_MODEL_INSTRUCTOR_REPORT` = `gpt-6.1-sol`
   - `OPENAI_REASONING_EFFORT_INSTRUCTOR_REPORT` = `medium`

   A value such as `Medium` stops the whole application from starting. Use
   "Save only", not "Save and deploy".
3. **Pseudonymization key.** `RESEARCH_PSEUDONYMIZATION_KEY` already exists on
   Render. It must be at least 16 characters.

## Step 5. Deploy

Deploy from the release folder:

```powershell
cd "E:\New_Downloads\cmcq-release"
git push origin "release/design-alignment-2026-10-17:main"
```

If git refuses because `main` has moved, stop and ask Claude. Do not force the push.

Afterwards:
1. Check that Render shows the new commit as Live.
2. Open the teacher AI settings page and check that guarded live AI is ready.
3. Start a test attempt with a test student account.
4. Add the release entry to the Word record (see `AGENTS.md`). Record the source
   files whose hashes changed: `config.ts`, `finish-assessment.ts`, `runtime.ts`,
   `formative-profile.ts`, `profile-record.ts` and `analysis-ready-export.ts`. No
   prompt, model or effort changed.

## Afterwards: the V41 work

The V41 tutor repair continues in your main folder. Before it can be released, it
needs its own approval (see `docs/release-records/handover-2026-10-15.md`). The
17 October changes are already in that folder too, so no work is lost.
