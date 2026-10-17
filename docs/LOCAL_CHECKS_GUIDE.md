# Running the local checks (Windows, step by step)

This guide is for checking the 17 October 2026 changes on your own computer before a
release. You do not need to type any code beyond the commands shown here. Everything
runs on your computer and your local test database only. Nothing is sent to Render
or the live site, and nothing is committed, pushed or deployed.

## 1. Open PowerShell in the project folder

**Option A: from File Explorer (easiest).**

1. Press **Windows key + E** to open File Explorer.
2. Click the address bar at the top (where the folder path is shown), type
   `E:\New_Downloads\Conversational MCQ` and press **Enter**.
3. Click the address bar again, type `powershell` and press **Enter**.
4. A blue or black PowerShell window opens. Its prompt ends with
   `E:\New_Downloads\Conversational MCQ>`, which means it is already in the project
   folder.

**Option B: from the Start menu.**

1. Press the Windows key, type `PowerShell` and open **Windows PowerShell**.
2. Type the following and press **Enter**. Keep the quotation marks, because the
   folder name contains a space.

   ```powershell
   cd "E:\New_Downloads\Conversational MCQ"
   ```

**Typing or pasting commands:**

- Copy a command from this guide, then right-click inside the PowerShell window to
  paste it, or press **Ctrl + V**.
- Press **Enter** to run it.
- Wait until the prompt (`...Conversational MCQ>`) comes back before you type the
  next command.

## 2. Make sure the database is running (for the database checks)

The database checks use your **local** test database. The script reads
`DATABASE_URL` from `.env.local` (then `.env`). It runs the database checks only if
that address points at your own computer (`localhost` or `127.0.0.1`). Otherwise it
skips them and says why. These checks add and then remove temporary test records,
which is why they never run against the live database.

- **If you use Docker Desktop:** start Docker Desktop, wait until it says it is
  running, then run:

  ```powershell
  npm run db:up
  ```

- **If PostgreSQL is installed directly on Windows:** make sure its service is
  running. Open the Windows **Services** app, find "postgresql" and check that it is
  **Running**.

If you are not sure, skip this step and add `-SkipDatabase` in step 3. You can run
the database checks later.

Close any running copy of the app (`npm run dev`) before step 3. Otherwise the first
step can fail with an "EPERM" error.

## 3. Run all checks with one command

Paste this whole line exactly, including the quotation marks, and press **Enter**. It
works from any folder, because it names the script by its full path:

```powershell
powershell -ExecutionPolicy Bypass -File "E:\New_Downloads\Conversational MCQ\scripts\local\run-local-checks.ps1"
```

Typing only the folder path, for example `E:\New_Downloads\Conversational MCQ`, does
not move PowerShell into that folder. Moving there needs `cd` and quotation marks:
`cd "E:\New_Downloads\Conversational MCQ"`.

**What it does, in order:**

1. Shows your Node and npm versions.
2. Prepares the database client (`npx prisma generate`).
3. Runs the type check and the lint (code style) check.
4. Runs the 30 design-alignment checks and the two data-dictionary checks.
5. With the database:
   - shows whether the local database is up to date (`npx prisma migrate status`);
   - runs nine database tests (content, feedback and finish, response quality,
     item-administration audit, profile records, dashboard, item builder,
     research export, script review).
6. Builds the production version of the app (`npm run build`). This is the slowest
   step, about 2–5 minutes.

**Where to look:**

- Each step prints **PASS** in green or **FAIL** in red.
- A summary table appears at the end.
- Everything is also saved in a new folder, `local-check-results`, inside the
  project folder. It holds one `.log` file per step plus `SUMMARY.txt`.

**Variations:**

| You want to | Command |
| --- | --- |
| Skip the database checks | add `-SkipDatabase` at the end of the command |
| Skip the build | add `-SkipBuild` |
| Skip both | add `-SkipDatabase -SkipBuild` |

## 4. Send me the results

You do not need to copy anything out of PowerShell. When it finishes, tell me in the
chat that the checks are done. I can read `local-check-results` directly from your
connected folder. If that folder is not available to me, attach
`local-check-results\SUMMARY.txt` and any `.log` file marked FAIL.

**If PowerShell shows an error before any step runs:**

- **"running scripts is disabled on this system":** use the exact command above,
  which includes `-ExecutionPolicy Bypass`. This setting applies to that one run
  only.
- **"npm is not recognized":** Node.js is not installed or not on the PATH. Install
  the LTS version from nodejs.org, close PowerShell, and open it again.
- **"Can't reach database server":** the database is not running. Go back to step 2,
  or run with `-SkipDatabase`.

## 5. Check the student experience in a browser (about 10 minutes)

This uses the local test database and the built-in mock AI (no OpenAI calls). Make
sure `LLM_PROVIDER=mock` in `.env.local`.

1. The first time only, create the demo accounts. Run these one at a time:

   ```powershell
   npm run prisma:migrate
   npm run prisma:seed
   ```

2. Start the app and leave this window open:

   ```powershell
   npm run dev
   ```

3. Open `http://localhost:3000` in your browser. The demo accounts are
   `teacher_demo` / `teacher_demo_password` and `student_demo` /
   `student_demo_access_code`.

Then check the following.

1. **One topic per mini test:** as the teacher, create a mini test with 3–5
   questions and publish it. The screens offer one topic only, and the item designer
   suggests 4 items.
2. **Typed explanations:** as the student, start the mini test. Try to paste into the
   explanation box. A notice asks you to type, and nothing is pasted.
3. **One active tab:** copy the attempt's address into a second browser tab and open
   it. Go back to the first tab: it shows "This attempt is open somewhere else".
   **Use this tab** switches back.
4. **Ending the conversation:** finish the questions, send a message in the learning
   conversation, and press **End** while the tutor reply is still loading. The
   conversation ends, and **Finish** works.
5. **Teacher views:** check the dashboard's **Instructor report** tab, which shows a
   labelled local test summary because the mock AI is used. Check the **Models by
   module** table under the AI settings page.
6. **Research export:** under Data and outcomes → Research data and exports, tick
   **Restricted research fields** and generate a dataset. The zip contains
   `ai_call_audit.csv` and `ai_call_audit_data_dictionary.csv`, and `sessions.csv`
   has an `evidence_stage` column. Generate one without restricted fields too:
   `ai_call_audit.csv` must not be in it.

To stop the app, click the PowerShell window running `npm run dev` and press
**Ctrl + C**.
