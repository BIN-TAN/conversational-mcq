# Prompt Versioning

Phase 6A introduces a draft prompt registry for future agent execution. These prompts are contracts for infrastructure testing and are not active classroom prompts.

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

Phase 6A uses only `draft`.

## Change Rules

Prompt text changes require a prompt version review. Breaking output-schema changes require a schema version change. Any active future agent call must persist prompt version, schema version, agent version, model name, and prompt hash.

Model names are configured through environment variables and are not part of prompt source code. Do not hardcode model names or describe any model as currently latest.

## Connectivity Prompt Use

The synthetic connectivity script uses the Response Collection Agent contract because it is lightweight and does not require classroom data. It must remain synthetic-only.
