# Agent Contracts

Phase 6A defines contracts for five agents. The contracts are strict TypeScript/Zod schemas. Phase 6B connects `student_profiling_agent` to the backend workflow after initial concept-unit administration. Phase 6C connects `formative_value_and_planning_agent` after a saved profile exists. Phase 6D1 connects `followup_agent` for the first open-ended follow-up conversation round. Phase 6D2B extends follow-up output for substantive evidence detection and uses staged updated profiling/planning. Phase 7C connects `response_collection_agent` to student free-text messages during initial administration. Live Item Preparation remains contract-only.

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
- `evidence_trigger_reasons`
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

The Response Collection Agent handles only student free-text messages during initial administration when the assessment session snapshot is `llm_assisted` and server-side provider readiness permits execution. Option selection and confidence reporting remain structured controls. Natural language cannot set selected option, confidence, correctness, phase, item order, profile, planning, follow-up, or completion.

The output schema uses fixed enums for recognized intents, reasoning capture status, requested control action, and recommended interaction outcome. Reasoning evidence segments must be exact substrings of the student message. Backend semantic validation rejects unsafe assistant text, non-verbatim reasoning segments, content help, correctness feedback, answer recommendations, phase changes, profile/planning fields, or misconduct language.

If the configured path is deterministic, mock calls are not explicitly allowed for student workflow, live provider readiness fails, usage guard blocks a live call, or output validation fails, the service uses a deterministic fallback. Fallback preserves the student turn, may save safe exact reasoning segments, refuses answer help neutrally, and does not create fake agent-call metadata.

## Formative Planning Contract

The Formative Value and Planning Agent contract selects one locked formative value and produces a plan for later follow-up. It primarily uses the integrated diagnostic profile while considering ability profile, engagement profile, evidence sufficiency, confidence alignment, independence interpretability, misconception indicators, and process interpretation cautions.

Phase 6C executes this agent only through the backend planning service. It may create one `formative_decisions` row after semantic validation. It must not create follow-up rounds, deliver activities to students, modify the saved profile, or communicate directly with students.

The approved formative values are:

- `diagnostic_clarification`
- `reasoning_refinement`
- `confidence_calibration`
- `independent_understanding_verification`
- `consolidation_or_transfer`

## Follow-Up Contract

The Follow-up Agent contract produces conversational follow-up turns and trusted event candidates. Phase 6D1 executes it only through the backend follow-up service after a saved profile and saved formative decision exist.

Approved `followup_action_type` values:

- `explanation`
- `hint`
- `clarification_prompt`
- `reasoning_refinement_prompt`
- `misconception_correction`
- `transfer_task`
- `confidence_calibration_prompt`
- `independent_verification_prompt`
- `off_topic_redirect`
- `move_on_offer`

The output must keep `target_formative_value` aligned with the current saved formative decision. It may propose only trusted follow-up event types, and it must not expose profile labels, formative labels, target evidence, success criteria, answer keys, correctness, hidden prompts, or teacher-only metadata to students.

Phase 6D2B adds follow-up output fields:

```ts
student_turn_substantive: boolean;
evidence_trigger_reasons: Array<
  | "substantive_explanation"
  | "reasoning_revision"
  | "task_completion"
  | "transfer_application"
  | "understanding_claim"
  | "move_on_request"
  | "other_relevant_evidence"
>;
```

Opening turns must use `student_turn_substantive=false`, `evidence_trigger_candidate=false`, and `evidence_trigger_reasons=[]`.

The orchestration layer, not the Follow-up Agent, decides whether to create a follow-up evidence update package and enqueue updated profiling/planning. The Follow-up Agent must not update profiles, rerun planning, create follow-up evidence packages, move to the next concept unit, or modify initial item responses.

## Item Preparation Contract

The Item Preparation Agent contract is advisory. The teacher_researcher remains the final content authority. Phase 6C does not implement live item preparation or automatic publishing.

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

Phase 6B preserves that rule for profiling. Refusal, incomplete, invalid output, failed execution, or usage-blocked execution does not create a `student_profiles` row.

Phase 6C preserves that rule for planning. Refusal, incomplete, schema-invalid output, semantically invalid output, failed execution, or usage-blocked execution does not create a `formative_decisions` row and does not create follow-up records.

Phase 6D1 preserves that rule for follow-up. Refusal, incomplete, schema-invalid output, semantically invalid output, failed execution, or usage-blocked execution does not create an assistant reply. Student follow-up messages already saved before provider execution remain stored as conversation evidence.

Phase 6D2B preserves atomic activation for iterative updates. Updated profiling and updated planning candidate outputs are staged on `followup_update_cycles` and do not become active records until the entire cycle succeeds. If profiling, planning, or next-round opening generation fails, no latest pointer changes and no new active follow-up round is created. Final stop updates activate a final profile/decision only if profiling and planning both succeed; they do not create a new round.
