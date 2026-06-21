# Agent Contracts

Phase 6A defines contracts for five agents. The contracts are strict TypeScript/Zod schemas. Phase 6B connects only `student_profiling_agent` to the backend workflow after initial concept-unit administration; the other agents remain contract-only.

## Agent Names

The only valid agent names are:

- `item_preparation_agent`
- `response_collection_agent`
- `student_profiling_agent`
- `formative_value_and_planning_agent`
- `followup_agent`

## Shared Output Base

Every agent output extends:

```ts
{
  agent_name: AgentName;
  agent_version: string;
  prompt_version: string;
  schema_version: string;
  output_status: "ok" | "blocked" | "needs_review";
  warnings: string[];
}
```

Use `output_status`. Do not reintroduce the older agent-level `status` field.

## Locked Enum Fields

The contracts use fixed enums for:

- `ability_profile`
- `engagement_profile`
- `integrated_diagnostic_profile`
- `evidence_sufficiency`
- `confidence_alignment`
- `independence_interpretability`
- `formative_value`
- `followup_action_type`
- `intervention_type`

Free-form labels are not allowed for these fields.

## Student Profiling Contract

The Student Profiling Agent contract preserves the three-layer design:

- `ability_profile`
- `engagement_profile`
- `integrated_diagnostic_profile`

Correctness is evidence, not the profile itself. Process data are contextual evidence for engagement and evidence sufficiency, not misconduct evidence.

Phase 6B may write a `student_profiles` row only after:

- initial concept-unit administration is completed
- the assessment session is in `profiling_pending`
- an `initial_concept_unit_response_package` exists or is recreated from stored records
- `StudentProfilingInput` is built from allowlisted evidence
- `executeAgent` returns a schema-valid `StudentProfileOutput`
- usage/readiness guards allow the call

Mock provider profile outputs are valid for infrastructure and UI testing only; documentation and research analysis must not treat them as validated student inferences.

## Response Collection Contract

The Response Collection Agent contract may later produce student-facing procedural wording. It must not control phase transitions, correctness, item ordering, evidence requirements, or answer keys. During initial administration it must not provide correctness feedback, hints, explanations, tutoring, or content clarification.

## Formative Planning Contract

The Formative Value and Planning Agent contract selects one locked formative value and produces a plan for later follow-up. It should primarily use the integrated diagnostic profile when that profile exists. Phase 6B does not execute this agent or create formative decisions.

## Follow-Up Contract

The Follow-up Agent contract produces future conversational follow-up turns and event candidates. Phase 6B does not implement follow-up conversation or create follow-up rounds.

## Item Preparation Contract

The Item Preparation Agent contract is advisory. The teacher_researcher remains the final content authority. Phase 6B does not implement live item preparation or automatic publishing.

## Guardrails

All agent input is treated as untrusted. Prompt injection attempts must not change:

- system role
- assessment phase
- scoring rules
- hidden prompts
- answer keys
- orchestration rules
- teacher-only metadata
- model settings
- schema requirements

Provider input is checked for prohibited secret/auth fields before a provider call or audit row is created.

Phase 6A.5 adds a usage/readiness guard before future live OpenAI calls. A blocked call is not a valid agent output and must not be passed downstream as profile, planning, response-collection, follow-up, or item-preparation behavior.

Phase 6B preserves that rule for profiling. Refusal, incomplete, invalid output, failed execution, or usage-blocked execution does not create a `student_profiles` row and does not create planning or follow-up records.
