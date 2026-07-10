# LLM-First CBA System Audit

Audit version: `phase31o-llm-first-cba-system-audit-v2`

Phase 31L is a static, no-live audit of the chat-native CBA architecture. It does not claim classroom validity, does not run provider calls, and does not modify production rows. The companion command writes a redacted machine-readable artifact under `.data/llm-first-cba-system-audit/`.

## 1. Executive Summary

The system has matured into a web-based, chat-native MCQ formative assessment platform with app-owned state transitions, answer-key protection, process logging, teacher-managed accounts, assessment lifecycle controls, and LLM-backed interpretation stages.

The main architectural gap is not basic chat flow. The main gap is proof that every substantive production LLM receives the same complete, version-bound, authorized assessment-design context. Current code uses several agent-specific packets and prompts. Those packets include many safe evidence summaries, but they are not yet governed by one shared `assessment-interpretation-context-v1` contract that proves assessment diagnostic focus, target reasoning notes, distractor notes, interpretation cautions, student evidence, process summaries, and post-activity evidence are consistently available and clearly separated.

No P0 classroom blocker was identified from static code review. Phase 31M,
31N, and 31o partially close the original P1 context/version findings by adding
the shared interpretation context, proving bounded no-live propagation, adding
media metadata, and separating student alt text from teacher-only LLM media
description. Several P1 risks remain before a stronger pilot claim:

- prove teacher diagnostic context propagation to all substantive agents, not
  only the currently covered no-live profile-integration path;
- strengthen first-class assessment-level and diagnostic-note snapshot/export
  identifiers;
- keep deterministic evidence features as support signals rather than final substantive diagnoses.

## 2. LLM-First Contract

The desired runtime contract is:

- The student interacts with an LLM-mediated assessment tutor inside app-owned state.
- The LLM has authorized assessment context: assessment title, diagnostic focus, current phase, current item, options, internal key, teacher target reasoning, distractor diagnostic notes, interpretation cautions, student evidence, revisions, timing/process summaries, and prior activity evidence.
- The application owns authentication, authorization, state transitions, answer-key protection, validation, persistence, audit, version binding, idempotency, and fail-closed behavior.
- The LLM performs substantive interpretation: response interpretation, evidence synthesis, misconception hypothesis, uncertainty judgment, formative-value judgment, activity generation, activity-response evaluation, and student-safe language.
- Teacher-authored notes are guidance, not observed evidence or ground truth.
- Selected distractors are indirect evidence only.
- Process data qualify evidence reliability and must not become misconduct accusations.

## 3. Student Experience Findings

### 31L-P2-UX-001

Severity: P2 usability improvement

Observed behavior: The student path is chat-native, but some stages remain visibly app-mediated through chips and structured controls. This is acceptable for protected initial administration, but it is not yet a fully natural conversation with an assessment-design-aware LLM.

Code evidence:

- `src/components/student-assessment/assessment-session-client.tsx`
- `src/lib/student-assessment/state-machine.ts`
- `src/lib/services/student-assessment/item-administration-tutor.ts`

Impact: Students may experience a hybrid chat/control flow. The risk is primarily usability, not answer-key protection.

Recommended fix: Preserve app-owned state while improving conversational framing and ensuring teacher/research audit can show whether a turn came from live LLM, safe fallback, or deterministic mock.

Recommended phase: Later UI polish after Phase 31M context propagation.

## 4. Multi-Assessment Findings

### 31L-P2-MULTI-001

Severity: P2 usability improvement

Observed behavior: Assessment availability, release/close windows, ordering, completed state, and resume paths exist. The current system uses explicit assessment public IDs for student start routes, which lowers wrong-assessment risk. More browser QA is still needed with many concurrently released mini tests.

Code evidence:

- `src/lib/services/assessment-availability/availability.ts`
- `src/components/student-assessment/available-assessments-client.tsx`
- `prisma/schema.prisma`: `Assessment.release_at`, `Assessment.close_at`, `folder_label`, `assessment_order_index`

Impact: Many mini tests may be hard to scan without additional browser QA around grouping and status display.

Data/validity risk: A wrong-assessment start would be P0. Static review did not find that behavior, but high-coverage classroom dry run is required.

Recommended fix: Add multi-assessment browser QA with released, closed, completed, unavailable, and in-progress assessments.

Recommended phase: Pre-pilot QA.

## 5. LLM Context Findings

### 31L-P1-CTX-001

Severity: P1 required before pilot

Observed behavior: Production agents use multiple agent-specific packets rather than one shared assessment interpretation context. The item-administration tutor, profile integration agent, formative value agent, activity generator, reviewer, and activity-response evaluator all have their own context shapes.

Code evidence:

- `src/lib/services/student-assessment/item-administration-tutor.ts`
- `src/lib/services/student-assessment/profile-integration.ts`
- `src/lib/services/student-assessment/formative-value-determination.ts`
- `src/lib/services/student-assessment/formative-activity-live.ts`
- `src/lib/services/student-assessment/activity-misconception-evidence-live.ts`

Impact: A call can be schema-valid and safe but still not fully informed by teacher diagnostic context or assessment phase.

Data/validity risk: Interpretations may omit relevant assessment design information or merge teacher guidance with observed evidence.

Recommended fix: Implement one internal `assessment-interpretation-context-v1` contract with safe hashes and presence metadata, then use it across all substantive LLM calls.

Recommended phase: Phase 31M.

## 6. Boundary/Prompt Findings

Current prompts and validators include strong boundaries for:

- answer-key protection;
- content-question deferral during protected initial administration;
- no internal labels in student-facing text;
- no misconduct or cheating accusations;
- correctness not being sufficient evidence of understanding.

Remaining Phase 31M need:

- teacher diagnostic guidance must be structurally separated from observed student evidence in every substantive context;
- selected option must be explicitly labeled indirect evidence;
- alternative explanations must be required in the shared contract;
- audit metadata must prove context presence without storing raw teacher notes again.

## 7. Teacher Usability Findings

Teacher UI now supports account management, assessment lifecycle, direct MCQ authoring, item deletion/assessment deletion, simple CSV export, and research export. Remaining usability risks are mainly terminology and workflow density:

- teacher/research views may still expose implementation labels in audit-heavy pages;
- publish warnings and verification status should remain understandable;
- destructive actions need continued browser QA on Render;
- mini-test ordering and folder/week grouping should be checked with real classroom-like data.

No broad teacher UI rewrite is recommended before Phase 31M/31N because context/version correctness should be established first.

## 8. Assessment Lifecycle/Versioning Findings

### 31L-P1-VER-001

Severity: P1 required before pilot

Observed behavior: `ItemResponse` stores `item_snapshot`, `correct_option_snapshot`, and `item_version_snapshot`. Assessment sessions bind to assessment and concept unit rows, but assessment-level diagnostic focus, teacher diagnostic notes, and future media context do not yet have first-class session-bound snapshot public IDs.

Code evidence:

- `prisma/schema.prisma`: `ItemResponse.item_snapshot`
- `prisma/schema.prisma`: `ItemResponse.correct_option_snapshot`
- `prisma/schema.prisma`: `ItemResponse.item_version_snapshot`
- `prisma/schema.prisma`: `AssessmentSession.assessment_db_id`
- `prisma/schema.prisma`: `ConceptUnit.version`, `Item.version`

Impact: Existing item-level responses are interpretable, but assessment-level and teacher-note edits need stronger version binding.

Data/validity risk: Future exports or LLM calls could use mutable current metadata if a context builder loads current assessment rows instead of administered snapshots.

Recommended fix: Bind a versioned assessment interpretation context to each session or fail closed if binding is unavailable. Extend with media snapshot binding in Phase 31N.

Recommended phase: Phase 31M and Phase 31N.

Migration required: likely yes for first-class snapshot identifiers.

## 9. Classroom Operation Findings

### 31L-P2-OPS-001

Severity: P2 usability improvement

Observed behavior: Local and Render readiness scripts exist, and live smoke scripts are opt-in. Classroom operations still require rehearsal of provider failure states, retry behavior, timeout behavior, and teacher-visible audit signals in staging.

Code evidence:

- `docs/RENDER_STAGING_DEPLOYMENT_RUNBOOK.md`
- `src/lib/llm/readiness.ts`
- `prisma/student-classroom-pilot-readiness-smoke-test.ts`

Impact: Teachers need a predictable message when live calls are blocked or fail.

Recommended fix: Run private staging dry runs with synthetic users and document provider-failure response.

Recommended phase: Pre-pilot operations rehearsal.

## 10. Research-Data Findings

### 31L-P2-EXPORT-001

Severity: P2 usability improvement

Observed behavior: Simple and restricted exports include broad conversation, response, activity, process, and diagnostic evidence. Future version-bound context and media support need explicit export fields.

Code evidence:

- `src/lib/services/teacher-research-export/service.ts`
- `docs/DATA_LOGGING_SPEC.md`
- `prisma/schema.prisma`: `ActivityRuntimeAttempt`, `ActivityMisconceptionEvidenceRecord`, `PostActivityDiagnosticSnapshot`

Impact: Researchers can inspect current evidence, but stronger administered-content joins will be needed as teacher-authored content evolves.

Recommended fix: Add assessment/item/media snapshot public IDs to restricted exports after Phase 31M/31N model changes.

Recommended phase: Export follow-up after Phase 31N.

## 11. Substantive LLM Dependence Finding

### 31L-P1-LLM-001

Severity: P1 required before pilot

Observed behavior: Deterministic evidence packets currently classify ability, engagement, response quality, formative value inputs, and evidence sufficiency for no-live and fallback paths. This is useful infrastructure, but it must remain support context rather than final classroom-valid diagnosis.

Code evidence:

- `src/lib/services/student-assessment/ability-evidence.ts`
- `src/lib/services/student-assessment/engagement-evidence.ts`
- `src/lib/services/student-assessment/formative-value-determination.ts`

Impact: Teacher/research displays may over-read deterministic categories if not framed as provisional.

Data/validity risk: Deterministic categories can be mistaken for misconception diagnosis.

Recommended fix: Keep deterministic features as safety, audit, sufficiency, or process-context signals. Ensure final substantive misconception interpretation remains LLM-mediated and uncertainty-aware.

Recommended phase: Phase 31M and later teacher/research wording polish.

## 12. Prioritized Remediation Roadmap

1. Phase 31M: create a shared, version-bound assessment interpretation context and prove propagation to every substantive LLM agent.
2. Phase 31N: add media-enabled MCQ authoring with safe URL/upload policy and version-bound `llm_media_context`.
3. Export follow-up: include context/media snapshot identifiers in restricted research exports.
4. Browser QA: run multi-assessment, teacher lifecycle, student first-login, provider-failure, and mobile walkthroughs on staging.
5. Teacher/research polish: reduce implementation-focused labels where they are not needed for audit.

## Machine-Readable Audit

Run:

```bash
npm run student:llm-first-cba-system-audit
```

Smoke:

```bash
npm run student:llm-first-cba-system-audit-smoke
```

The artifact is written under `.data/llm-first-cba-system-audit/`, which is ignored by Git. It includes file inventories, agent inventories, boundary inventories, finding counts, P0/P1 finding IDs, and `openai_calls_made: 0`.

## Phase 31M Diagnostic Context Propagation Update

Phase 31M addresses the main P1 finding by adding a shared
`assessment-interpretation-context-v1` contract and proving no-live propagation
to the substantive LLM interpretation paths. The shared context includes
assessment diagnostic focus, administered item snapshot IDs, item stems and
visible options, internal correct-option evidence for provider-side
interpretation, target/strong reasoning guidance, plain-language distractor
diagnostic guidance, interpretation cautions, observed student responses, safe
process summaries, and the current interpretation phase.

Teacher-authored notes remain explicit guidance, not ground truth. The contract
states that observed student evidence takes priority, selected options are
indirect evidence only, correctness alone is not understanding, timing alone is
not guessing or disengagement, and alternative explanations are required.

Safe audit metadata is recorded with agent inputs as context proof: schema
version, assessment snapshot ID, item snapshot IDs, context hash, and boolean
presence flags for teacher context, target reasoning, distractor notes,
interpretation caution, and student evidence. The audit metadata must not carry
raw teacher notes, prompts, answer keys in student-visible payloads, provider
secrets, or credentials.

Verification:

```bash
npm run student:llm-diagnostic-context-propagation-smoke
```

The smoke uses mock provider execution only and reports `openai_calls: 0`.
An optional paid live context smoke is available but skipped by default:

```bash
npm run student:llm-first-context-live-smoke
```

To run the paid version, configure live LLM credentials locally and set
`RUN_LIVE_LLM_FIRST_CONTEXT_SMOKE=1`. It uses one synthetic/redacted response
package and verifies provider metadata, token usage, context hash metadata, and
protected-content boundaries.

## Phase 31o Post-Integration QA Update

Phase 31o reruns the static audit after the teacher diagnostic context,
media-authoring, and deletion-remediation work. The machine-readable artifact
now records media context as present, but direct multimodal input remains out of
scope. The static audit still does not claim classroom validity and still makes
no OpenAI call.

| Prior finding | Status | Evidence | Remaining risk | Next action |
|---|---|---|---|---|
| P0 classroom blocker | resolved | No P0 finding was identified in the original static audit or the Phase 31o rerun. | Browser/staging QA can still reveal runtime blockers. | Continue classroom dry runs with synthetic accounts before pilot use. |
| `31L-P1-CTX-001` shared LLM context | partially resolved | `assessment-interpretation-context-v1`; `student:llm-diagnostic-context-propagation-smoke`; context hash and presence metadata persisted in profile-integration agent input. | Not every substantive live/runtime agent path is proven to consume the same context object. | Extend context-presence assertions to formative activity generation and post-activity evaluator live paths. |
| `31L-P1-VER-001` version/snapshot binding | partially resolved | Item responses freeze item snapshots and `llm_media_context`; Phase 31N media context includes media version/hash; Phase 31o separates `student_alt_text` and `teacher_llm_media_description`. | Assessment-level first-class snapshot IDs and export columns remain future work. | Add restricted export columns for context/media snapshot IDs when export follow-up begins. |
| `31L-P1-LLM-001` deterministic support signals | partially resolved | Product/spec docs frame process and deterministic evidence as reliability/support context; live substantive interpretation remains LLM-mediated in approved paths. | Teacher/research pages may still over-read provisional deterministic categories without careful wording. | Continue teacher/research wording review and keep deterministic labels out of student-facing text. |

Content publication policy was reconciled in this phase:

- Missing item stems, invalid option structure, invalid correct options,
  answer-key leakage, unsafe student-facing content, and content-lock/version
  integrity failures remain blockers.
- Missing teacher distractor diagnostic notes, target-reasoning notes,
  strong-reasoning notes, or expected reasoning guidance are warning-only unless
  a later locked spec makes a specific field structurally required.
- Current item-verification warnings remain advisory quality warnings that can
  require explicit teacher acknowledgement when that verification path is used.
