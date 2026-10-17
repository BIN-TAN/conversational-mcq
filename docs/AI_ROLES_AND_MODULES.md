# AI roles and the five dissertation modules

Last updated: 2026-10-17 (design decisions D6 and D9 in `DESIGN_ALIGNMENT_2026-10-17.md`).
Source of truth in code: `src/lib/llm/assessment-modules.ts`.

## Why there are more roles than modules

The dissertation (Section 3.1, Appendix A) describes five functional modules, each
supported by an LLM. The application implements each module with one or more
*roles*. A role is one bounded model task with its own prompt, output schema and
validator, for example "classify this justification" or "write the feedback". Keeping
roles separate lets the application validate each output before it affects students
or records. It does not mean the system uses 18 different models.

## Five model configurations, one per module (D9)

The system runs **five model configurations**, one for each module. Every role in a
module uses its module's model and reasoning effort; only the maximum output length
stays task-specific. This is the sense in which "five LLMs" do the work: the 18 roles
are prompts and checks, not separate models.

Merging the roles themselves into five prompts was considered and rejected. Each role
has its own output schema and validator (for example, profiles are checked for exact
quotations and supported claims before they are saved). A single prompt per module
would remove those checks, make failures harder to locate, and invalidate the
evaluation evidence behind the current configuration.

### Selected models (2026-10-17)

| Module | Model | Reasoning | Why |
| --- | --- | --- | --- |
| Item preparation | `gpt-5.6-luna` | medium | Teacher-side drafting and checks; every item is reviewed by the instructor before publishing, so a fast, low-cost model is enough. |
| Item administration | `gpt-5.6-luna` | medium | Runs for every answered item while the student waits, so speed and cost matter most; its wording never reaches students. |
| Profiling and feedback | `gpt-5.6-luna` | medium | Runs once per attempt; the profile-fidelity checks and one audited repair keep it faithful at low cost. |
| Formative conversation | `gpt-6.1-sol` | medium | The hardest task (multi-turn tutoring that must track evidence and respect stop requests); an all-Luna tutor failed review. |
| Instructor reporting | `gpt-6.1-sol` | medium | Synthesises a whole class with exact quotations; run rarely by the instructor, so a stronger model costs little. |

Evidence: modules 1-4 are the configuration verified live in release
CMCQ-20261013-03 (seven reviewed synthetic sessions). Luna **low** failed profile
validation in CMCQ-20261013-01, so no module uses low effort. **High** effort was not
chosen because medium already passed review and higher effort adds latency and
output tokens (GPT-6.1 Sol streams roughly 50 tokens per second).

Prices at selection (OpenAI, per million tokens, input / output): GPT-5.6 Luna
$0.20 / $1.20; GPT-6.1 Sol $2 / $10. Sources: OpenAI model pages for
[gpt-5.6-luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) and
[gpt-6.1-sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

Candidates for a later, evaluated change (do not switch without the evaluation and
approval steps used for CMCQ-20261013-03):

- `gpt-6-luna` (released 22 Sept 2026, $0.10 / $0.50) could halve the cost of modules
  1-3. Independent benchmarks show it level with GPT-5.6 Luna overall, with some
  regressions, so it needs the seven-case profile and conversation review first.
- `gpt-6.1-sol` medium for item preparation could improve ambiguity and distractor
  checks at small cost, because teacher authoring is low volume.

### How the configuration is resolved

1. An active operational approval bundle (`OPERATIONAL_APPROVAL_BUNDLE_PATH`) overrides
   environment configuration, as before. Live classroom runs use the approved bundle,
   which pins every role. The teacher LLM status page (`/teacher/system/llm`, "Models
   by module") shows whether the bundle follows the five-module policy.
2. Without a bundle, the module variable is authoritative (for example
   `OPENAI_MODEL_MODULE_PROFILING_FEEDBACK` with
   `OPENAI_REASONING_EFFORT_MODULE_PROFILING_FEEDBACK`).
3. An older role-specific variable (for example `OPENAI_MODEL_PROFILING`) applies only
   when its module variable is empty.

The selection lives in code as `MODULE_MODEL_POLICY` in
`src/lib/llm/assessment-modules.ts`; `moduleModelPolicyStatus()` compares it with
the resolved configuration.

Each role also has an allow-list of model families in `src/lib/llm/config.ts`
(`roleAllowsModel`). For example, the formative conversation role accepts
`gpt-5.6-sol`, `gpt-5.6-luna` and the mixed-tutor model, but not `gpt-5.6-terra`. If
a module-level model is not allowed for one of its roles, that role reports
`model_not_allowed_for_agent` and needs a role-specific override.

## Module map

"Current" means the role is reached by the current student or teacher workflow.
"Conditional" means it may be called depending on configuration; confirm with
`agent_calls.agent_name` in the database. "Retained" roles serve earlier-phase
workflows, evaluations and replays and are not reached by the current student flow.

### 1. Item preparation (Section 3.1.1)

Module variables: `OPENAI_MODEL_MODULE_ITEM_PREPARATION`,
`OPENAI_REASONING_EFFORT_MODULE_ITEM_PREPARATION`.

| Role | Status | Responsibility |
| --- | --- | --- |
| `mcq_diagnostic_authoring_assistant_agent` | Current | Evidence-centred blueprint conversation and draft item generation for teacher review |
| `mcq_import_formatting_assistant_agent` | Current | Formatting and structure suggestions for imported MCQs; never changes a confirmed key |
| `item_verification_agent` | Current | Structural completeness, ambiguity, cue and distractor checks before publishing |

### 2. Item administration (Section 3.1.2)

Module variables: `OPENAI_MODEL_MODULE_ITEM_ADMINISTRATION`,
`OPENAI_REASONING_EFFORT_MODULE_ITEM_ADMINISTRATION`.

| Role | Status | Responsibility |
| --- | --- | --- |
| `item_administration_tutor_agent` | Current | Classifies typed justifications and alternative reasons. Its wording is replaced by fixed neutral text, so no correctness feedback or hints reach students |
| `response_collection_agent` | Retained | Free-text collection; its `initial/messages` route was retired on 2026-10-17 (returns 410) and the role is reached only by evaluations |

### 3. Student profiling and feedback generation (Section 3.1.3)

Module variables: `OPENAI_MODEL_MODULE_PROFILING_FEEDBACK`,
`OPENAI_REASONING_EFFORT_MODULE_PROFILING_FEEDBACK`.

| Role | Status | Responsibility |
| --- | --- | --- |
| `student_profiling_agent` | Current | Canonical initial understanding profile (instructor-facing) |
| `profile_integration_agent` | Current | Integrates item evidence and engagement context |
| `formative_value_and_planning_agent` | Current | Student-facing tailored feedback and the formative plan |
| `formative_value_determination_agent` | Conditional | Formative value decision within the evidence-integrated bundle |
| `student_communication_agent` | Conditional | Student-facing feedback wording when its live toggle is on |

### 4. Formative conversation (Section 3.1.4)

Module variables: `OPENAI_MODEL_MODULE_FORMATIVE_CONVERSATION`,
`OPENAI_REASONING_EFFORT_MODULE_FORMATIVE_CONVERSATION`.

| Role | Status | Responsibility |
| --- | --- | --- |
| `formative_conversation_agent` | Current | The optional conversation (v18r2 runtime), up to 30 student turns per mini test, with the bounded delivery reviewer configured in `luna-conversation-repair-identity.ts` |
| `followup_agent`, `topic_dialogue_agent`, `formative_activity_dialogue_agent`, `formative_activity_quality_reviewer_agent`, `formative_activity_response_evaluator_agent`, `post_activity_evidence_evaluator_agent` | Retained | Earlier follow-up, topic-dialogue and structured-activity paths |

### 5. Instructor reporting (Section 3.1.5)

Module variables: `OPENAI_MODEL_MODULE_INSTRUCTOR_REPORTING`,
`OPENAI_REASONING_EFFORT_MODULE_INSTRUCTOR_REPORTING`. Older role variables (used only when the module variable is empty):
`OPENAI_MODEL_INSTRUCTOR_REPORT`, `OPENAI_REASONING_EFFORT_INSTRUCTOR_REPORT`,
`OPENAI_MAX_OUTPUT_TOKENS_INSTRUCTOR_REPORT`.

| Role | Status | Responsibility |
| --- | --- | --- |
| `instructor_report_agent` | Current (new) | Reviews all included students' sealed response packages and conversation transcripts for one mini test and writes an evidence-linked instructor report (`src/lib/services/instructor-report/`) |

The dashboard's other summaries (participation, distributions, attempt comparisons)
remain deterministic calculations.

The instructor report role is outside the operational approval bundle. It is a
teacher-side tool and its model comes only from the variables above. With
`LLM_PROVIDER=mock`, a clearly labelled local test summary (not AI-generated) is
produced instead.

### Utility

`connectivity_test`: provider connectivity check.

## Suggested Appendix A wording

See `DISSERTATION_TEXT_UPDATES_2026-10-17.md` → "Appendix A" for the replacement
Table A1 (the five rows above) and its note.
