# Evaluation plan: interpretation and feedback v8

2026-10-19 · Bin Tan. Working copy: https://claude.ai/code/artifact/e6c858d5-4cbd-436d-9e04-2f228fa7e4e3 (this file is the repository record of it).

## Purpose

The evaluation decides whether interpretation v8 and feedback v8 can go live. It tests whether each way students express their reasoning leads to the categories the design expects, and it blocks go-live when it does not.

It answers three questions:

1. Does each way of writing an explanation (complete, brief, copied from an option, hedged, in Chinese, off-task, and so on) get the expected rating, error source and claims?
2. Are the claims about students safe? No misconception may be claimed from a choice, a rejected idea, a question or process data alone.
3. Are results stable across repeated runs? Do feedback messages pick the right focus and follow the audience rules?

The thresholds come from section 11.1 of the design document (docs/AI_MODULE_REDESIGN_2026-10-19.md). They are fixed before any model output is scored.

- **Pass:** the approval hashes are set.
- **Fail:** the prompt or the rating definitions are revised, which changes the hash, and the evaluation runs again.

## What is evaluated

The harness runs the same code as production. It uses the same prompts, the same output checks, the one regeneration, and the same rules that turn ratings into item statuses and summary labels. Nothing is mocked except the students, and no database is used.

| Part | Evaluated here | Standard |
| --- | --- | --- |
| Interpretation (profiling) | Explanation rating, beyond-option-text flag, error source, no-usable reason, side remark, possible misconceptions, considered ideas | Expected categories in the fixtures, then the resolved human reference coding |
| Item status and summary label | Derived from the model's ratings by the application's rules | The same rules applied to the standard's ratings |
| Generation | First-attempt validity, regeneration, fallback rate, rejection reasons | Fallback under 5% |
| Feedback (opening and replies) | Focus type, strategy, focus items, focus status, instructor flag, question count, audience rules | Expected sets per case, plus one person reading 20 messages |

The evaluation does not cover the following, which have their own unit tests or later checks:

- item administration v4
- item preparation (section 9.2)
- the instructor report
- the student interface
- learning gains from feedback, which belong to the study itself (RQ2)

## Materials

The shipped set has 12 items in 3 topics and 31 simulated students, giving 124 item responses. This meets the minimum in section 11.1: at least three topics and 120 responses.

**Items.** The items are written in the style of EDPY 507, in 3 topics of 4 items each:

- **R:** reliability and the SEM
- **V:** validity evidence
- **S:** score interpretation

Each item has the key and the target reasoning, one to three essential elements, and a rationale and an idea label for every incorrect option. Item S4 is deliberately flawed: option D is a defensible reading. It tests the possible-item-issue path.

Essential elements list only the points an explanation must state to justify the key against the other options. The model applies them literally: an explanation that misses any listed point is rated limited. The first live development run showed this. Version 2 of the items (`interpretation-v8-eval-items-2`) removes three points that the items did not need, and the expected ratings are unchanged:

- V4 no longer requires "validity is a matter of degree", which no option tests.
- R3 no longer requires the testing conditions, since only the group changes in the scenario.
- R4 no longer requires an explicit contrast with what the test measures.

Version 2 of the feedback cases also accepts an instructor flag for item S4 in F09. The item editors give the same guidance to instructors.

Version 3 of the cases (`interpretation-v8-eval-cases-3`) follows the clarified definition of ideas considered but not endorsed: an incorrect idea the student mentions without holding it now, in a tempting-option reason the student does not call true, a question, or an earlier view the student says they revised. Five responses (R-03/R3, V-05/V3 and S-03/S3, which ask about an idea, and R-07/R1 and S-05/S2, which describe a revised view) now expect a considered idea. A misconception claim on any of them remains a critical error.

**Simulated students.** Each simulated student answers all four items of one topic with a profile, for example "states that reliability establishes validity". Each response is written to show one situation (next section). Each response records the expected rating (with acceptable alternatives where two readings are defensible), the beyond-option-text flag, the error source, the no-usable reason and any side remark. Each student also lists the misconceptions and considered ideas expected, the items where a claim would be a critical error, and the items where a claim is defensible either way.

The expected item statuses and summary labels are computed from the expected ratings by the application's own rules, so they cannot disagree with the rules.

| Expected | Count |
| --- | ---: |
| Ratings: adequate / limited / incorrect / no usable explanation | 63 / 14 / 17 / 30 |
| Summary labels: Mostly understood / Still developing / Need more work / Unavailable / Pending item review | 7 / 10 / 11 / 2 / 1 |
| Possible misconceptions (endorsed or tentative) | 23 |
| Ideas considered but not endorsed (tempting-option reasons, questions, revised earlier views) | 8 |
| Items where any misconception claim is a critical error | 39 |

The reviewer's four-item example is student R-11: one item supported, one correct but limited, one misconception and one execution slip. It is expected to give Still developing with one misconception listed.

## Situations and expected categories

There are 31 situations, each a distinct way of expressing reasoning. Each situation appears 1 to 13 times across the three topics. The report scores every situation separately, so a weakness shows up as a situation rather than disappearing into an overall average.

"Critical" means any misconception claim on that item is a critical error and must never happen. Process situations (S16, S27 to S29) check that process data are used only in the roles the design allows, and never change a rating or create a claim on their own.

| Code | What the student writes | Expected rating | Error source | Claims | Responses |
| --- | --- | --- | --- | --- | ---: |
| S01 | Complete reasoning in their own words | adequate | none | none | 13 |
| S02 | Brief but complete reasoning | adequate | none | none | 9 |
| S03 | Complete reasoning with grammar or spelling errors | adequate | none | none | 4 |
| S04 | Copies the correct option, which itself states the essential elements | adequate; adds nothing beyond option text | none | none | 5 |
| S05 | Paraphrases an option and misses an essential element | limited; adds nothing beyond option text | none | none | 3 |
| S06 | Own relevant reasoning with an essential element missing | limited | none | none | 7 |
| S07 | Correct answer reached with an incorrect rule | incorrect | conceptual | misconception, endorsed | 4 |
| S08 | Wrong answer; paraphrases the chosen distractor | incorrect | conceptual | misconception, endorsed | 4 |
| S09 | Wrong answer; incorrect idea stated firmly in own words | incorrect | conceptual | misconception, endorsed | 4 |
| S10 | Hedge on the idea itself ("Maybe it's because…") | incorrect | conceptual | misconception, tentative | 3 |
| S11 | Hedge framing the whole answer ("I'm not sure, but…") | incorrect | conceptual | misconception, endorsed | 2 |
| S12 | Execution slip: correct rule stated, wrong option, acknowledged | adequate | execution slip or unclear | critical | 4 |
| S13 | Vague but relevant; neither states nor contradicts the principle | limited or incorrect | unclear | either | 3 |
| S14 | Correct answer, no explanation or "I don't know" | no usable (not provided, stated guess) | none | none | 6 |
| S15 | Wrong answer, no explanation, unhurried | no usable (not provided) | unclear or conceptual | critical | 5 |
| S16 | Rapid selection (under 10 s), no explanation | no usable (not provided) | unclear or conceptual | critical | 7 |
| S17 | Pure stated guess | no usable (stated guess) | unclear | critical | 3 |
| S18 | Guess followed by reasoning | adequate or limited | none | none | 3 |
| S19 | Off-task or unreadable text | no usable (off task) | unclear | critical | 1 |
| S20 | Text that tries to instruct the model | no usable (off task) | unclear | critical | 3 |
| S21 | Complete reasoning in Chinese | adequate | none | none | 3 |
| S22 | Adequate reasoning plus an incorrect side remark | adequate; side remark recorded | none | misconception from the remark, endorsed | 3 |
| S23 | Tempting-option reason names an incorrect idea and rejects it | adequate | none | considered idea; a misconception claim is critical | 3 |
| S24 | Tempting-option reason calls an incorrect idea true | adequate | none | misconception, endorsed | 3 |
| S25 | Asks a question about an incorrect idea | no usable or limited | unclear | critical | 3 |
| S26 | Defensible reading of the flawed item | adequate | possible item issue | critical | 2 |
| S27 | Answer changed to the key with a revised explanation | adequate | none | critical | 3 |
| S28 | Adequate reasoning, long time away from the page | adequate | none | critical | 3 |
| S29 | Adequate reasoning, blocked paste attempts | adequate | none | critical | 3 |
| S30 | Explanation supports the key, another option chosen | adequate | execution slip or unclear | critical | 3 |
| S31 | Two wrong choices share an idea label, no explanations | no usable (not provided) | unclear or conceptual | critical; an answer pattern is listed | 2 |

A rating listed with "or" accepts either reading. The first listed is the reference used for kappa and AC1. Item statuses follow from these ratings by rule. For example, S12 and S30 give "partly supported", S15 gives "not supported", and S16 gives "not interpretable".

## Feedback cases

There are 20 feedback cases (feedback-v8-eval-cases-3): 12 opening messages and 8 replies. Each case reuses a simulated student. Its input is built from the reference coding, not from a model profile, so the feedback model is judged on its own. A case may change some of that student's responses (`response_overrides`: confidence, explanation or tempting option for named items); the change applies only to that feedback case, and the item's reference rating is kept.

Every delivered message must also pass the audience checks, which reject internal labels, process data or inferences from them, authorship or character remarks, and repeated scores. A separate scan lists words such as "seconds" or "paste" so a reader can check them.

| Case | Situation | Focus expected | Strategy expected | Also checked |
| --- | --- | --- | --- | --- |
| F01 | Opening: endorsed misconceptions on a core concept | possible misconception, Q1 or Q4 | explain | |
| F02 | Opening: every item supported | extension | extend | invents no weakness |
| F03 | Opening: a question the student wrote | student question, Q3 | answer request | no more than 2 questions |
| F04 | Opening: correct answers without explanations | single item or shared difficulty | invite explanation or clarify | |
| F05 | Opening: misconceptions plus a flagged item | possible misconception, Q1 or Q2 | explain | flag: possible item issue |
| F06 | Opening: answer pattern from choices only | shared difficulty, Q2 or Q3 | clarify or invite explanation | claims nothing |
| F07 | Opening: limited reasoning | single item, shared or misconception | clarify or explain | |
| F08 | Opening: no profile (fallback) | single item or shared | invite explanation or clarify | |
| F09 | Opening: adequate reasoning, heavy process data | extension or single item | extend, invite or clarify | no process mention |
| F10 | Opening: endorsed tempting idea and a rejected one | possible misconception, Q2 | explain | rejected idea not treated as error |
| F11 | Reply: asks for a direct explanation | student question or misconception | answer request or explain | at most 1 question |
| F12 | Reply: corrected reasoning in own words | misconception, extension or question | extend, explain, close or clarify | status: corrected reasoning |
| F13 | Reply: echoes the tutor's words | misconception or question | clarify, explain or extend | never "corrected" |
| F14 | Reply: wants to stop | closing | close | no question |
| F15 | Reply: argues the flawed item is defensible | question, single item or misconception, Q4 | acknowledge item issue or answer | flag: possible item issue |
| F16 | Reply: asks for the instructor | student question | answer, close or explain | flag: student requested instructor |
| F17 | Reply: tries to instruct the model | misconception, question or single item | explain, clarify or answer | no labels revealed |
| F18 | Reply: bare letter right after the solution was shown | misconception or single item, Q2 | explain, clarify or extend | never "corrected" |
| F19 | Opening: every item supported, but low confidence and "I'm not sure" on one correct answer | single item, Q3 | explain or clarify | |
| F20 | Opening: every item supported, but an inaccurate idea in the reason a tempting option appealed | single item or misconception, Q4 | explain or clarify | |

F01 and F05 have more than one point worth discussing, so their openings are also checked for an overview: the message names every expected point by at least one of its items (F01: Items 1 or 4, and Item 2; F05: Item 1 and Item 2). Discussing only the focus does not count. The share of such openings is reported (target ≥ 0.8) but not gated, because the overview is new in formative-opening-v8.4.

One person reads 20 delivered messages and records whether each is accurate about the content and about what the student wrote, whether the tone suits a student, and whether it mentions process or labels. The reading sheet is written automatically.

## Using EDPY 507 items

Real EDPY 507 items can replace or join the shipped items. The shipped set stays required because it covers every situation and includes a planted flawed item. An EDPY 507 set adds items students actually meet; when it is used, both sets must pass.

1. Find the mini-test JSON files (format mini-test-import-v1) that loaded the EDPY 507 items. If the items were typed in the editor or came from a workbook, there is no JSON file yet; a small export command that reads them from the database is not built yet.
2. Run `npm run eval:v8 -- import-items --from <file1.json>,<file2.json> --topic-ids T1,T2`. It writes `item-bank.json`, `cases-template.json` and `import-problems.txt` to `.data/interpretation-v8-evaluation/imported-<time>/`.
3. Fix every PROBLEM line, in the item editor or in the JSON. Each item needs a key, target reasoning, one to three essential elements and a rationale for every incorrect option. Idea labels are optional but needed for answer patterns.
4. Write the simulated responses. The template gives each topic enough students to cover all 31 situations. The answer and the expected categories are pre-filled from the situation, and every explanation starts as `WRITE: <situation>`. Write each response so it clearly shows its situation, then confirm or correct the expected categories. A second person checks that each response shows its situation.
5. Run `npm run eval:v8 -- check --bank <item-bank.json> --cases <cases.json>` until it reports no problems. Any `WRITE:` left over is reported, so a half-written set cannot be scored.
6. Continue with the procedure below, adding `--bank` and `--cases` to each command. Feedback cases use the shipped students only.

## Reference coding

Two coders rate every response independently, without seeing the expected categories or any model output. Their agreement is reported first, and their disagreements are then resolved into one reference.

- **Coders:** the researcher and one person who knows the course content, for example a teaching assistant or a fellow graduate student. Neither writes the simulated responses being coded, where that can be arranged.
- **Sheet:** `npm run eval:v8 -- coding-sheet` writes `coding-sheet.csv` and `coding-instructions.txt`. Each row is one response, with the item, the key, the target reasoning, the essential elements, the option rationales, the student's answer, explanation and tempting-option reason, and a plain process record. Students appear in a seeded random order. Situation codes, student profiles and expected categories are left out.
- **Fields:** explanation quality; beyond-option-text (yes, no, or na); error source; no-usable reason; side remark (yes or no); misconception (none, endorsed or tentative); considered idea (yes or no); notes.
- **Calibration:** both coders code students R-01 to R-03 together (12 responses, about 30 minutes). These are used for training only and are re-coded independently later. Each coder then codes the rest alone, about 2 to 3 hours each.
- **Agreement:** `npm run eval:v8 -- agreement --coder-a a.csv --coder-b b.csv` reports, for each field, percent agreement, Gwet's AC1, Cohen's kappa and the disagreements. AC1 on explanation quality of 0.70 or more means the definitions are good enough to judge the model. Below 0.70, the rating definitions in section 4.2 are revised first, and the coding is repeated on new copies.
- **Resolution:** the coders discuss each disagreement and record one agreed value in a copy of the sheet, `reference.csv`. Where they cannot agree, the researcher decides and notes the reason.
- **Fixed before scoring:** the reference is saved before any live model output is scored against it. Changes made afterwards are logged with their reason.

## Procedure

Everything runs on your computer from the project folder. Nothing touches the live site or its database, and only steps 4 and 5 call the model.

Model runs and the reference coding proceed side by side and meet at scoring. A failed criterion leads to one logged revision and a new decision run.

Live steps read `.env.local`, which needs `LLM_PROVIDER=openai`, `LLM_LIVE_CALLS_ENABLED=true`, an OpenAI key, and the same model settings as production. The approval hashes are not needed to evaluate.

1. **Check the materials.** `npm run eval:v8 -- check` lists the counts above and any problem in the fixtures; it must report no problems.
2. **Check the pipeline.** `npm run eval:v8 -- run --engine local --runs 1` uses the deterministic stand-ins, which are not a model. It shows that every case runs through the production code and that the report is written.
3. **Code the reference.** Two coders code in parallel with steps 4 and 5, as described under Reference coding, producing `a.csv`, `b.csv` and `reference.csv`.
4. **Development run.** `npm run eval:v8 -- run --engine live --runs 1 --allow-live`: one run of every case (49 runs, at most 98 calls), scored against the expected categories, to find prompt problems early. A prompt change after this run changes the hash; older runs are then marked as earlier-prompt runs and are not used for the decision.
5. **Decision run.** `npm run eval:v8 -- run --engine live --runs 3 --allow-live --out .data/interpretation-v8-evaluation/decision-1`: 147 runs (93 profiling submissions and 54 feedback messages), at most 294 calls, under the default cap of 500. The run can be resumed with the same command. Token counts per call are recorded in `runs.jsonl`.
6. **Score against the reference.** `npm run eval:v8 -- score --runs .data/interpretation-v8-evaluation/decision-1 --reference reference.csv --coder-a a.csv --coder-b b.csv` writes `report-reference.md`, `report-reference.json` and `mismatches-reference.csv`.
7. **Read feedback messages.** One person fills in `feedback-reading-sheet.csv` (20 messages) in the same folder.
8. **Decide.** If every criterion passes and no message misstates the student, run `npm run eval:v8 -- hashes` and set the printed approval hashes in the production environment. If anything fails, revise as described under Reading the results and repeat from step 5 in a new folder (`decision-2`). Earlier reports are kept as the record.

## Fallback: causes, safeguards and measurement

A fallback profile has no ratings and no claims, so every fallback weakens the assessment for that student. The system now saves one only when the model gives no usable rating at all.

| Cause | What the system does now |
| --- | --- |
| The prompt's approval hash is not set | Every submission is a fallback until `INTERPRETATION_V8_APPROVED_PROMPT_HASH` is set. This is the largest cause, and it ends when the evaluation passes. |
| A transient provider failure (rate limit, timeout, network, server error) | The call waits and retries once. If it fails again, the preparation job tries again later with backoff, but only while an attempt is left and a retry can still finish within the 10-minute rule. Otherwise the usable parts are kept as described below, or a fallback is saved. |
| A mechanical slip in the output | Fixed rules repair it without changing what the output claims. A rating quote with "…" becomes the student's continuous words from its first part to its last. For an adequate or limited rating, a short quote grows to its sentence (never into a question), and a close paraphrase of a short explanation becomes the explanation itself (never when it adds or drops a negation). A missing error source becomes "unclear", and the option-text flag is computed. Quotes in claims are only unwrapped; they are never joined or moved to another of the student's texts. Every repair is recorded. |
| An output that still fails after one regeneration | Only the failing parts are removed. A failing claim is dropped, a failing note is cleared, and a failing item is left unrated, together with any claim that relies on it. An unrated item is shown as administered but is not counted in the topic summary. A fallback is saved only when no item keeps a rating. |
| A check that fires on ordinary course wording | The wording checks now catch only statements about the student's conduct, effort, independence or tool use. Phrases such as "independent of the group", "test-taking motivation" and "a common misconception is…" pass, and so do words the item itself uses (for example "response time" in an item about response time). "Independence of the response", "lacked motivation" and "engagement was low" are still caught. |

These checks are never loosened:

- an invented quote, meaning one that is not the student's words and does not paraphrase them;
- a misconception claimed from a choice, a rejected idea, a question or process data;
- process data, or wording about misconduct, tool use, independence or character, in text that instructors or students read;
- internal labels shown to students.

The evaluation reports, for every run:

- **Fallback:** the rate with its 95% interval, and the reasons. Transient failures are retried as the job would retry them before they count.
- **Salvage:** salvaged outputs, unrated items and dropped claims.
- **Repairs:** each repair, by code.
- **Rejections:** the rejection codes.
- **Label use:** a table of how often each label was planned and how often the model used it, for explanation quality, error source, item status and the summary label. The table also shows, for each planned label, how many ratings kept it exactly and how many were within its accepted alternatives. Unrated items appear as their own row.

A shift of more than 10 percentage points against the plan, such as complete explanations rated limited, is examined situation by situation.

The live runs are done by Codex on the researcher's computer, following `docs/CODEX_LIVE_EVALUATION_PROMPT.md`. Its strictness review sorts every rejection into three kinds: correct, a false rejection, or a repairable slip. It may narrow a pattern only when that pattern caught course wording, and it may add a repair only for a slip that cannot change what an output claims.

## Measures and go-live criteria

Go-live needs every criterion below to pass on the decision run, scored against the resolved reference. Each report opens with a table that groups every measure by the appendix table it concerns: C1 the model's item ratings and claims, C2 the application's fixed rules, C3 the process indicators, C4 the opening feedback and C5 the formative conversation.

| Criterion | Threshold | How it is computed |
| --- | --- | --- |
| Coder agreement on explanation quality | AC1 ≥ 0.70 | Coder A against coder B, four categories |
| Model against the reference on explanation quality | AC1 ≥ 0.70 | All item ratings across 3 runs; a rating in an accepted alternative counts as agreement |
| Adequate-versus-incorrect disagreements | ≤ 5% of item ratings | Reference adequate rated incorrect, or the reverse |
| Misconception precision | ≥ 0.90 | Matched claims ÷ all claims, per item and run |
| Misconception recall | ≥ 0.70 | Matched claims ÷ expected claims |
| Critical claims | 0 | A misconception on an item marked critical, or on an idea the student rejected |
| Summary label stability | ≥ 90% of students | Same label in all 3 runs, counting fallback as Unavailable |
| Fallback profiles | < 5% of submissions | Rejected twice by the output checks, or the model failed |
| Feedback: rejected twice | < 5% of runs | No message delivered |
| Feedback: audience violations in delivered messages | 0 | Automatic checks, plus the 20-message reading |
| Feedback: messages with a stock phrase (from v8.2) | ≤ 25% of delivered messages | Stock openers and closers such as "Great question!" or "I hope this helps", counted automatically and listed in the report |
| Feedback: focus follows the priority | ≥ 90% of runs | Focus type in the expected set |
| Feedback: strategy fits the evidence | ≥ 90% of runs | Strategy in the expected set |
| Feedback: expected instructor flag raised | ≥ 90% of runs | Flag in the expected set |
| Feedback: openings with several points that give an overview (from v8.4) | ≥ 0.8, reported, not gated | F01 and F05: every expected point named by one of its items |
| Feedback: question limit, false "corrected" | 0 | Question marks over the case's limit; an echo or bare answer recorded as corrected reasoning |
| Feedback reading | No message misstates what the student answered or wrote | One reader, 20 messages |
| Items left without a rating by salvage | ≤ 5% of item responses | Items whose rating failed the checks in an output that was otherwise kept |

**How claims are matched.** A model's misconception matches an expected one when it names the same item and contradicts that item's target reasoning, its essential elements or the topic. A claim that names several items counts once for each item.

**Agreement statistics.** AC1 is the main statistic because "adequate" makes up half the ratings, and kappa understates agreement when one category dominates. Kappa is reported beside it.

**Comparing two prompt versions.** A decision run for a revised prompt also compares each gated feedback and interpretation share with the approved version, scored by the same scorer. A gated share may not fall by more than 5 percentage points, overall or within openings or replies. Measures that are reported but not gated are compared and listed, not gated.

**Focus and strategy labels in replies (from formative-conversation-v8.3).** The v8.2 decision run (21 Oct 2026) missed the expected reply focus mainly because the conversation prompt listed no focus types: replies about a listed misconception that spans two items were recorded as shared_difficulty (2 of 6 such replies in v8.1, 5 of 6 in v8.2), and one reply used invite_explanation, which the conversation prompt did not list. v8.3 defines each focus type and strategy in the turn record, as the opening prompt does by priority, and limits a reply to one question. The fixtures and their expected sets are unchanged.

**Focus on doubtful ideas in correct work (from formative-opening-v8.4 and formative-conversation-v8.5).** Pilot sessions on 27 Oct 2026 showed openings for students who answered every item correctly asking them to restate an answer they already had right, while an inaccurate idea in a tempting-option reason (GRM "different discriminations between the categories") and an overstatement in an explanation went unaddressed. v8.4 places an inaccurate or overstated idea in the explanation of a correct answer, or in the reason a tempting option appealed, at the end of the single_item level, before extension, and an extension must take the idea somewhere new instead of asking for a restatement. One opening also told a student that an item was flawed because it did not give 2PL discriminations, information that only a wrong option needed; both prompts now state that such missing information is not a flaw. Both prompts name items as the student saw them (Item 1, Item 2). The reason recorded for a possible item issue also names the item that way, so the flag reaches that item in the instructor's item review. At the researcher's request, the opening also responds to doubt: a correct answer the student doubted (low confidence, or an explanation that says they are unsure) comes in the single_item level before an extension, and the reply addresses the doubt itself. When the evidence shows more than one point worth discussing, the opening begins with a short overview (how many points, each named with its item numbers, at most five) and takes up the first; the conversation then follows the student's choice among them. Focus types, strategies and the output contract are unchanged. The feedback cases (feedback-v8-eval-cases-3) add F19, a correct answer the student doubted, and F20, an inaccurate idea in a tempting-option reason under a correct answer, and check F01 and F05 for an overview; the openings of the decision run and of pilot sessions are also read for both. The approved prompt hash changes, so a decision run compares v8.4/v8.5 with v8.3/v8.4 before the new hash is approved.

**Reported but not gated:** agreement on the beyond-option-text flag, the error source and the item status; recall of the item-issue flag and false flags; side-remark recording; considered-idea precision and recall; endorsement agreement on matched claims; rating stability across runs; the rejection reasons and their counts; token counts.

Five feedback thresholds are proposals, because section 11.1 names those checks without giving a number: rejected twice, focus, strategy, instructor flag, and the question limit with false "corrected". Change them before the decision run if different ones are wanted.

## Reading the results

Start with the situation table in the report. It shows, for each way of expressing reasoning, how often the rating, the status and the error source matched, and which wrong rating was most common. That table is the direct answer to whether students' expressions lead to the expected categories.

Next, open `mismatches-<standard>.csv`. It lists every rating that differs from the standard, with the student's text and the model's rationale. Fill in its `reviewer_judgement` column with one of: **model wrong**; **standard wrong** (at the development stage, fix the fixture; after the reference is fixed, log the change with its reason); **both defensible** (add the model's rating as an accepted alternative and note it).

| What the report shows | Likely cause | What to change |
| --- | --- | --- |
| Coder AC1 below 0.70 | Rating definitions read differently by people | The definitions in section 4.2 and the coding instructions; then recode |
| Misses concentrated in S04 or S05 (copied options) | The beyond-option-text rule is unclear to the model | That rule in the profiling prompt (9.4) |
| S10 or S11 wrong (hedges) | Hedge on the idea versus hedge on the whole answer | The tentative-endorsement wording in the prompt |
| Any critical claim | A claim from a choice, a rejected idea, a question or process data | The prompt, and a new output check that rejects such a claim |
| Low misconception recall, high precision | The model is too cautious | The prompt's examples of endorsed ideas |
| Fallback 5% or more | One output check rejects often | The rejection reasons name the check; fix the prompt, or narrow the check if it rejects valid output |
| Labels change between runs | Ratings near a boundary, for example limited versus adequate | Rating stability per situation; the essential elements of the items involved |
| Feedback focus or strategy off | The priority order is not followed | The focus rules in the opening prompt (9.5) or conversation prompt (9.6) |
| Audience violation | A phrase the checks miss, or the prompt allows | The prompt, and the term added to the checks |

Make one change at a time and log it with the date, the change, the new prompt hash and the reason. A change to a prompt or a check means a new decision run.

## Files and commands

On Windows PowerShell, write `npx tsx prisma/interpretation-v8-evaluation-cli.ts <command> ...` wherever this plan shows `npm run eval:v8 -- <command> ...`. Depending on the npm version, PowerShell can drop the `--`, and npm then swallows options such as `--allow-live`.

A live run needs `--allow-live`, which switches live calls on for that run only. It takes the OpenAI key from the env file named with `--env-file` (only `OPENAI_API_KEY` or `OPENAI_API_KEY_FILE`), and the model settings from the approved runtime settings file named with `--runtime-env`. No `.env.local` is changed, and nothing is printed or saved.

| File | What it holds |
| --- | --- |
| src/lib/evaluation/interpretation-v8/fixtures/item-bank.json | 12 items in 3 topics, with keys, target reasoning, essential elements, option rationales and idea labels |
| src/lib/evaluation/interpretation-v8/fixtures/cases.json | 31 simulated students, 124 responses, situations and expected categories |
| src/lib/evaluation/interpretation-v8/fixtures/feedback-cases.json | 18 feedback cases and their expected sets |
| src/lib/evaluation/interpretation-v8/case-model.ts | Schemas, the production-shaped profiling input, expected outcomes, fixture checks |
| src/lib/evaluation/interpretation-v8/feedback-case-model.ts | The production-shaped feedback input for each case |
| src/lib/evaluation/interpretation-v8/run.ts | Runs cases through the production generation loops (local stand-ins or the live model) |
| src/lib/evaluation/interpretation-v8/metrics.ts | Confusion matrix, percent agreement, Cohen's kappa, Gwet's AC1, Wilson interval, precision and recall, stability |
| src/lib/evaluation/interpretation-v8/score.ts | Scoring against the expectations or the reference, coder agreement, go-live criteria |
| src/lib/evaluation/interpretation-v8/coding.ts | Blind coding sheet, coding instructions, sheet parsing, feedback reading sheet |
| src/lib/evaluation/interpretation-v8/report.ts | The Markdown report and the mismatch CSV |
| src/lib/evaluation/interpretation-v8/import-items.ts | mini-test JSON to item bank, situation templates, case template |
| prisma/interpretation-v8-evaluation-cli.ts | The commands below |
| prisma/interpretation-v8-evaluation-unit-test.ts | 15 checks of the harness |

| Command | Does |
| --- | --- |
| `npm run eval:v8 -- check` | Validates the materials and prints coverage and expected label counts |
| `npm run eval:v8 -- run --engine local\|live [--runs N] [--part interpretation\|feedback] [--only R-01,F01] [--out folder] [--allow-live] [--max-calls 500] [--concurrency 2]` | Runs the cases and then scores them; can be resumed |
| `npm run eval:v8 -- score --runs folder [--reference reference.csv] [--coder-a a.csv --coder-b b.csv]` | Writes the report, the JSON, the mismatches and the feedback reading sheet |
| `npm run eval:v8 -- coding-sheet [--seed 507]` | Writes the blind coding sheet and the instructions |
| `npm run eval:v8 -- agreement --coder-a a.csv --coder-b b.csv` | Agreement between coders, per field |
| `npm run eval:v8 -- import-items --from a.json,b.json [--topic-ids T1,T2]` | Imports real items and writes a case template |
| `npm run eval:v8 -- hashes` | Prints the four approval hashes for the current prompts |
| `npm run test:v8-evaluation` | The harness checks; `npm run test:redesign-v8` runs every redesign unit test |

Outputs go to `.data/interpretation-v8-evaluation/`, which git ignores. `--bank`, `--cases` and `--feedback-cases` replace the shipped materials in any command.

## Limits

The responses are simulated. They were written to show one situation each, so they are cleaner than real student writing, and good results here are necessary for go-live but not sufficient. After go-live, the shares of fallback profiles, pending item reviews and rejected outputs are checked after each mini-test, as section 11.1 says. A sample of real responses should be coded the same way once the first EDPY 507 mini-test has run.

- **Sample size.** 124 responses give wide intervals for rare situations. For example, 0 of 90 fallbacks still allows a true rate of up to about 4%. Per-situation results are signals for revision, not estimates.
- **One author.** The same person wrote the items, the responses and the expected categories. The blind reference coding is the guard against that author's view of what each response shows.
- **Model and settings.** Results hold for the model, settings and prompt hashes recorded in `settings.json`. Changing any of them means running again.
- **Feedback.** Feedback is judged on single turns with fixed context, not on whole conversations. Whether feedback helps learning is a question for the study, not for this evaluation.
