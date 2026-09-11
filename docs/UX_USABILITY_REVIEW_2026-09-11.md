# Classroom UX and Usability Review

Date: 2026-09-11

## Verdict

The existing visual direction is suitable for a classroom tool: restrained green/gold branding, consistent teacher navigation, and a compact student conversation. The priority is reliable editing, visible recovery, and keyboard accessibility, not a visual redesign.

Three P1 findings affect teacher work preservation or keyboard interaction. The remaining findings concern error visibility, mobile layout, workflow length, accessibility semantics, and truthful status messaging. No new P0 finding was established by this UX review; that is not a security or production-readiness certification.

This review did not change application code. The preceding reliability audit's uncommitted changes were preserved. No commit, push, deployment, Render access, real student activity, or LLM provider request was performed.

## Method and Scope

- Reviewed the local working tree based on `aabf15118d526f52dd333e35a8eb22742b62eb31`, including the existing local reliability-audit fixes.
- Used the previously built production application on loopback with external network access blocked and live agents disabled.
- Created an isolated local PostgreSQL database containing synthetic teacher/student accounts, two example assessments with sessions, and one draft design. No production database was accessed.
- Inspected 19 screen states using Chromium and axe-core at 1440 x 900 and 390 x 844. Separately verified the completed-attempt review screen at both sizes.
- Exercised keyboard navigation, unsaved navigation, evidence-field typing, slow-save races, and save-error visibility. Save successes/failures were fulfilled entirely in the browser; no real save request was forwarded.
- Inspected student waiting-state code without generating a tutor response.
- Raw observations and synthetic screenshots: `/tmp/cmcq-ux-review-20260911/`. These temporary artifacts are not part of the application or immutable evaluation evidence.

This was an expert inspection and deterministic browser check, not a usability study with representative participants. Mobile emulation does not establish behavior with an actual phone keyboard. Screen-reader behavior, live LLM latency/quality, and the full generated-item review/publish journey were not exercised.

## Findings

### UX-01 / P1: Evidence-field typing destroys spaces and new lines

**Confirmed in the browser.** In Review design, the observable-evidence field normalizes its contents on every keystroke. Typing a space or Enter at the end immediately removes it. Starting with `First evidence`, then typing a space, Enter, and `Second evidence` produced `First evidenceSecondevidence` instead of two readable evidence statements.

The same normalization is used by the student-language examples field. Pasting whole paragraphs may appear to work, which can hide the defect during development.

Source: [normalization helper](</Users/binbin/Documents/Conversational MCQ/src/components/teacher-content/item-design-client.tsx:136>), [evidence editor](</Users/binbin/Documents/Conversational MCQ/src/components/teacher-content/item-design-client.tsx:780>), [student-language examples](</Users/binbin/Documents/Conversational MCQ/src/components/teacher-content/item-design-client.tsx:866>).

**Minimum correction:** keep raw text while editing; normalize and validate at the save boundary. Do not change evidence semantics or provider behavior.

**Acceptance check:** ordinary multi-word typing, blank lines, Enter, paste, and deletion work; saving still produces a valid evidence array.

### UX-02 / P1: Teacher edits can be lost in two ordinary workflows

**Confirmed in the browser.**

1. Editing the design and selecting Return to mini test navigated away without confirmation. Reopening the design restored the earlier saved text; the edit was gone.
2. During a simulated slow save, fields remained editable. A newer edit made while the save was pending was overwritten when the older response arrived. The page nevertheless displayed `Assessment design saved.`

Source: [local state and save response replacement](</Users/binbin/Documents/Conversational MCQ/src/components/teacher-content/item-design-client.tsx:455>), [unguarded return link](</Users/binbin/Documents/Conversational MCQ/src/components/teacher-content/item-design-client.tsx:646>), [editable fields](</Users/binbin/Documents/Conversational MCQ/src/components/teacher-content/item-design-client.tsx:769>).

**Minimum correction:** track dirty state and warn before leaving; either freeze fields while saving or preserve edits made after the submitted revision. Show saved/unsaved status tied to the actual revision. Do not introduce implicit publishing or generation through autosave.

**Acceptance check:** browser navigation, in-app navigation, save failure, and typing during a delayed save cannot silently discard work.

### UX-03 / P1: Modal keyboard behavior does not match a modal

**Confirmed on the password-reset dialog.** Opening it left focus on its background trigger. Tabbing eventually moved to controls behind the overlay, including navigation. Escape did not close the idle dialog.

Source: [password reset dialog](</Users/binbin/Documents/Conversational MCQ/src/components/teacher-students/student-password-reset-control.tsx:98>).

Deletion dialogs use a similar custom overlay pattern and should be included in the eventual correction, but their focus behavior was not separately reproduced here. Automated axe checks did not detect this interaction failure.

**Minimum correction:** place focus inside the dialog, contain focus, make background content inert, support Escape when cancellation is safe, and return focus to the trigger. Preserve all destructive-action confirmations.

**Acceptance check:** a keyboard-only teacher can open, inspect, cancel, and return from reset/deletion dialogs without reaching background controls.

### UX-04 / P2: Save errors appear far outside the teacher's viewport

**Confirmed with a browser-mocked save failure.** Clicking Save design near the bottom of the form showed the error near the top, 2,652 pixels above the viewport. Focus fell to the document body. The error was not an alert/live region, and nothing near the clicked button identified the failure.

Source: [save failure handling](</Users/binbin/Documents/Conversational MCQ/src/components/teacher-content/item-design-client.tsx:515>), [top-of-page error](</Users/binbin/Documents/Conversational MCQ/src/components/teacher-content/item-design-client.tsx:659>), [shared error panel](</Users/binbin/Documents/Conversational MCQ/src/components/teacher-content/ui.tsx:112>).

**Minimum correction:** put actionable error feedback next to the primary action, announce it, and move focus to the error or invalid field when appropriate. Preserve the draft. Keep technical details available under an expandable details control rather than showing raw schema paths/JSON first.

**Acceptance check:** a failed save or generation has an immediately visible next step without scrolling or guessing whether it succeeded.

### UX-05 / P2: Research-export controls overflow a phone screen

**Confirmed at 390 pixels wide.** The document expanded to 498 pixels; scope/assessment selectors were about 453 pixels wide and extended beyond the form. Long option text drives intrinsic sizing.

Source: [research scope controls](</Users/binbin/Documents/Conversational MCQ/src/components/teacher-data/research-data-exports-client.tsx:873>).

**Minimum correction:** constrain the grid children and controls with shrinkable widths; preserve a readable selection summary. Verify long assessment titles and student identifiers. Horizontal scrolling may be appropriate inside data tables, not across the whole page and form.

**Acceptance check:** no document-level horizontal overflow at 320, 390, or 768 pixels, including long synthetic titles.

### UX-06 / P2: Teacher authoring buries the main task and its actions

**Measured with a modest design:** three objectives, four evidence statements, one misconception example, and one exemplar produced a 3,814-pixel desktop page and a 4,787-pixel phone page. Save/generate controls were at the bottom. On the phone, the teacher header occupied about 426 pixels before the New mini test page content; the actual entry field barely began in the first viewport.

The new-test flow still asks for a shell and optional release settings before the material-based assistant. The functionality is present, but it is less direct than the teacher's intended task of bringing material and creating a reviewed assessment.

Source: [shared header](</Users/binbin/Documents/Conversational MCQ/src/components/teacher-workspace-header.tsx:34>), [new-test form](</Users/binbin/Documents/Conversational MCQ/src/components/teacher-content/assessment-form-client.tsx:86>), [bottom action area](</Users/binbin/Documents/Conversational MCQ/src/components/teacher-content/item-design-client.tsx:1019>).

**Recommended design:** keep desktop branding; use compact mobile navigation. Make progress visible as Materials -> Design -> Review items -> Publish, without adding compulsory steps to the student conversation. Use compact objective summaries with expand-to-edit sections and a persistent save/action area. Move optional scheduling to publication. Preserve teacher confirmation of every answer key.

This is a workflow recommendation, not evidence that every teacher will prefer a wizard. Validate it with a short teacher walkthrough before restructuring the interface.

### UX-07 / P2: Upload and tab controls have accessibility gaps

**Confirmed by automated and keyboard checks.** The screen-reader-only file input has no accessible label. The research tablist contains ordinary buttons without tab semantics. In item design, ArrowRight did not move focus from the first tab; there is no associated tabpanel/keyboard implementation.

Source: [file input](</Users/binbin/Documents/Conversational MCQ/src/components/teacher-content/item-design-client.tsx:296>), [design tabs](</Users/binbin/Documents/Conversational MCQ/src/components/teacher-content/item-design-client.tsx:665>), [research tabs](</Users/binbin/Documents/Conversational MCQ/src/components/teacher-data/research-data-exports-client.tsx:835>).

**Minimum correction:** label the actual file input; implement tab/panel and keyboard behavior consistently, or use a simpler non-tab control where appropriate. Keep Refresh outside the tablist.

The two axe violation types occurred on desktop and mobile. Their tool-assigned impact is not a finding that this application has a P0 incident. These are distinct from the modal focus problem.

### UX-08 / P2: Waiting copy can claim a message is saved before confirmation

**Source-confirmed risk; not simulated with a live tutor.** The client begins a timer before awaiting submission. After ten seconds the copy says `Your message is saved`, regardless of whether the server has acknowledged persistence. A slow or stalled upload can therefore receive a premature assurance.

Source: [timer-driven saved notice](</Users/binbin/Documents/Conversational MCQ/src/components/student-assessment/assessment-session-client.tsx:368>), [submission starts waiting before response](</Users/binbin/Documents/Conversational MCQ/src/components/student-assessment/assessment-session-client.tsx:2568>).

**Minimum correction:** distinguish sending, confirmed saved/waiting for tutor, and recoverable failure. Keep generic wording such as `Preparing a response...`; do not add fake progress or distract students with unrelated activities. Show the review-answers action during genuinely long waits.

## Additional Research-UI Clarification

The export badge labeled `students/sessions` displays only `counts.sessions`, not a distinct student count. Repeated attempts make those quantities different. Rename it to Sessions or provide separately computed students and sessions. This is a presentation ambiguity, not evidence that exported rows are incorrect.

Source: [export counts](</Users/binbin/Documents/Conversational MCQ/src/components/teacher-data/research-data-exports-client.tsx:214>).

Keep dataset scope, incomplete-session inclusion, restricted-field warnings, job history, and the data dictionary. They support deliberate research selection. Less commonly needed implementation details can sit behind Details; meaningful data-scope and irreversible-action warnings should not be removed as redundant copy.

## What Should Stay

- The green/gold teacher header is shared consistently across the inspected sections. Active navigation is visually distinct and uses `aria-current`.
- Assessment management separates creation from managing existing tests. Do not move item generation back into the library as its primary entry.
- The student item screen fits the tested phone viewport and uses conversational presentation with item progress. Do not turn it into a long survey or add micro-step Continue buttons.
- The previous-attempt entry is visible. The synthetic completed-attempt review loaded read-only, with a Back to assessments action and no editable fields, at both viewport sizes.
- Waiting copy is generally context-neutral, and the code offers answer review during longer waits. Retain that direction while correcting the saved-state signal.
- Teacher answer-key confirmation and destructive-action warnings are important safeguards, not clutter to remove.

## Recommended Sequence

1. Correct text entry and work preservation: UX-01 and UX-02.
2. Correct modal focus and visible/announced errors: UX-03 and UX-04.
3. Fix mobile export layout and input/tab semantics: UX-05 and UX-07.
4. Correct saved-status messaging and the research count label.
5. Validate a compact authoring flow and mobile header with a teacher before applying UX-06.

Suggested participant tasks: create a test from a short document; edit evidence and an answer key; leave and resume a draft; recover from a simulated save failure; reset a synthetic student's password; pause/review a student attempt; and export one assessment while correctly identifying the number of students versus attempts. Record task completion, errors, recovery, and requests for help rather than assuming a visual improvement proves usability.

## Verification and Cleanup

Executed local browser review scripts in `/tmp/cmcq-ux-review-20260911/`: `review.mjs`, `followup.mjs`, and `history.mjs`. The final runs completed successfully. Earlier follow-up harness attempts required correction of an asynchronous mock-save wait and a button selector; these were test-harness issues, not additional product failures.

No regressions, typecheck, or build were rerun in this review because no product code changed; the existing audit build was reused. This report is the only new repository file from the UX task. Prior reliability-audit edits remain uncommitted and unchanged by this review.

The loopback preview and disposable UX database are removed after the checks. Synthetic screenshots and observation files remain in the temporary evidence directory, not in the production database or evaluation packages.

## Approved Revision Follow-up

The original findings above describe the inspection before implementation. The
subsequent user-approved revision addresses them as follows:

- UX-01: preserve spaces, new lines, and blank entries while typing. Normalize
  evidence and student-language arrays only at explicit save time.
- UX-02: warn before in-app navigation, browser Back, reload, or closing a dirty
  editor. Cancelled navigation retains the draft. Disable editing while saving
  or generating, and show a saved/unsaved status tied to the current blueprint.
- UX-03: share native modal-dialog behavior across password reset, all three
  batch-deletion controls, and student end-conversation/end-assessment dialogs.
  Idle Escape cancels, background content is inert, and focus returns to the
  trigger. Busy destructive requests cannot be dismissed with Escape.
- UX-04: show and focus save/generation errors beside the persistent actions.
  Preserve the draft and place technical details behind an expandable control.
- UX-05: constrain export selectors and grid children to the available width.
  Label session counts as sessions, not students/sessions.
- UX-06: use a compact mobile menu, collapse optional scheduling on New mini
  test, expand objectives/misconceptions/exemplars only for editing, contain
  assistant-transcript scrolling, and keep save/generate actions visible.
  The existing creation, assistant, design, generated-item review, and explicit
  publication flow is retained; no mandatory wizard or automatic publication
  was introduced. A teacher walkthrough remains appropriate before further
  restructuring or moving scheduling exclusively to publication.
- UX-07: label the actual upload input and implement shared tab/panel semantics,
  arrow-key navigation, Home/End, and a single keyboard tab stop per tablist.
- UX-08: show sending/waiting-for-confirmation until the server acknowledges
  the message. Only a confirmed pending/retrying response can show saved copy.
  Also prevent Enter during IME composition from sending a formative message.

### Revision Verification

`npm run classroom:ux-smoke` passed 24 browser checks against a production build,
including 12 viewport/axe checks at widths 320, 390, 768, and 1440. All inspected
new-test, design-review, and research-export states had no document-level
horizontal overflow and no axe WCAG A/AA violations. Save/error responses and
password-reset responses were browser mocks; no corresponding write reached
the server. Student wait-state checks used mocked response projections and an
accelerated browser clock, not provider requests. The past-attempt check used
persisted synthetic history and confirmed read-only rendering on mobile.

Synthetic screenshots and structured results from the final browser run are in
`/var/folders/rx/k94y88g53hnfdy9hf6j6dt1c0000gn/T/cmcq-ux-smoke-MTCJXk/`.
Initial harness runs required corrections to the login URL, unique synthetic
identities, route-announcer selector, and attempt-review text selector. These
were test-harness corrections; the final browser run passed without application
changes after those corrections.

The reusable runner requires a migrated, disposable loopback database named
`conversational_mcq_classroom_audit_ux*` and an existing production build. It
starts/stops its own loopback server, blocks external HTTP and non-mocked browser
writes, uses synthetic identities only, and writes evidence outside the repo.
Run it before `classroom:audit`, which includes a development-server test that
changes the generated Next.js cache; rebuild separately after that audit.

Work is not auto-saved or cached in browser storage. Browser/OS process death
can still lose unsaved drafts; this revision adds deliberate navigation guards,
not a durable offline editor. Screen-reader and physical-phone testing, actual
classroom load, and representative teacher/student usability studies remain
unverified. Model quality, answer-key policy, research schema, and immutable
evaluation evidence are unchanged by the UX changes. The separate reliability
audit documents outstanding backend interruption/reconciliation risks.

The combined release regression run passed 43/43 no-provider scripts, including
the original 37-script reliability suite and six affected teacher/navigation/
waiting-state checks. Older assertions for removed explanatory copy and the
former creation-button labels were updated to assert the current controls;
runtime validation, draft review, answer-key confirmation, and authorization
checks were retained. The local release log is
`/tmp/cmcq-release-audit-20260911.log`.
