# Prompt Versioning

Phase 6A introduces a draft prompt registry for agent execution. Phase 6B uses the registered Student Profiling Agent prompt through a controlled backend service after initial concept-unit administration. Phase 6C uses the registered Formative Value and Planning Agent prompt through a controlled backend service after a saved profile exists. Other agent prompts remain contract-only.

## Registry Fields

Each registered prompt includes:

- `agent_name`
- `agent_version`
- `prompt_version`
- `schema_version`
- `status`
- `description`
- `instructions`
- computed `prompt_hash`

The prompt hash is a SHA-256 digest over the prompt version, schema version, and instructions. It is stored with each `agent_calls` audit row so later research records can be traced to the exact prompt text used.

## Current Draft Prompt Versions

| Agent | Prompt version | Schema version | Status |
| --- | --- | --- | --- |
| `item_preparation_agent` | `item-preparation-v1` | `item-preparation-output-v1` | `draft` |
| `response_collection_agent` | `response-collection-v1` | `response-collection-output-v1` | `draft` |
| `student_profiling_agent` | `student-profiling-v1` | `student-profile-output-v1` | `draft` |
| `formative_value_and_planning_agent` | `formative-planning-v1` | `formative-planning-output-v1` | `draft` |
| `followup_agent` | `followup-v1` | `followup-output-v1` | `draft` |

## Status Meanings

- `draft`: registered for infrastructure and smoke testing only.
- `approved_for_testing`: may be used in controlled later testing after explicit approval.
- `active`: may be connected to a workflow only in a later approved phase.
- `retired`: retained for audit but not used for new calls.

Phase 6B and Phase 6C do not make prompt status a bypass. Profiling and planning calls still require backend authorization, provider configuration, model environment configuration, live-call readiness, usage guard approval, strict input/output validation, and audit logging.

## Change Rules

Prompt text changes require a prompt version review. Breaking output-schema changes require a schema version change. Any active future agent call must persist prompt version, schema version, agent version, model name, and prompt hash.

Model names are configured through environment variables and are not part of prompt source code. Do not hardcode model names or describe any model as currently latest.

## Connectivity Prompt Use

The synthetic connectivity script uses the Response Collection Agent contract because it is lightweight and does not require classroom data. It must remain synthetic-only.

## Live-Call Guarding

Prompt status does not activate classroom use. Future active prompts must still pass server-side live-call readiness and usage-limit checks before any OpenAI call. A configured prompt version is not permission to bypass authentication, authorization, budget safeguards, or usage audit logging.

Phase 6B Student Profiling Agent prompt constraints include:

- separate observed evidence from inference
- correctness is evidence, not the profile itself
- reasoning quality, confidence alignment, distractor rationale, transcript evidence, and process context all matter
- process data are contextual evidence only
- never use cheating, confirmed GenAI use, or misconduct language
- use conservative language when evidence is incomplete or conflicting
- do not infer motivation as a stable trait
- output only the required schema

Phase 6C Formative Value and Planning Agent prompt constraints include:

- primarily use `integrated_diagnostic_profile`
- also consider ability, engagement, evidence sufficiency, confidence alignment, independence interpretability, misconception indicators, and process cautions
- select exactly one approved formative value
- treat the default mapping as a strong guide
- explain any mapping deviation
- distinguish evidence from inference
- do not modify or regenerate the student profile
- do not create or deliver a follow-up activity
- create only a plan for the future Follow-up Agent
- do not communicate directly with the student
- do not use misconduct language
- output only the required schema
