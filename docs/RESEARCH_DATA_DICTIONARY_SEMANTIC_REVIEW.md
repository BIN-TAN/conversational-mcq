# Research Data Dictionary Semantic Review

Reviewer: Codex  
Date: 2026-07-14  
Dictionary schema version: `research-data-dictionary-v3`

## Summary

Phase 31af rebuilt the research data dictionary from one generated schema-like
inventory into four explicit documentation entities. Phase 31ag corrected
residual semantic drift, added source-code evidence and review status fields,
and separated source-code verification from domain-owner approval. Phase 31ah
hardened remaining union-table semantics, process-event specificity, excluded
field mappings, token lineage, and versioned keyed pseudonymization:

- Research dataset variables: 286
- Process event types: 156
- Internal schema fields: 281
- Platform administration and excluded fields: 102

The semantic audit reported zero placeholder research definitions, zero
placeholder process-event definitions, zero timing variables missing measurement
level or formula, zero duplicate variables without qualified names, zero
privacy/export contradictions, zero PII fields in the ordinary research export,
zero undocumented exported columns, and zero documented-but-absent research
columns. The Phase 31ag specificity audit additionally reports zero generic
row-based definitions, zero generic serialization-path methods, zero unresolved
formula references, zero count/duration formula mismatches, zero ratio formula
mismatches, zero generic process-event triggers, zero internal nullable
placeholders, and zero internal privacy/audience mismatches. The Phase 31ah
artifact verifier additionally reports zero unresolved agent/activity
applicability rows, correct provider-versus-aggregate token lineage, and
HMAC pseudonymization provenance in the emitted CSV artifacts.

## Fields Reviewed

The review covered:

- 20+ response and process variables, including selected options, reasoning,
  confidence, tempting-option evidence, process event fields, and conversation
  latency fields.
- Every exported timing or timestamp variable, including session elapsed time,
  active interaction time, idle/page-hidden durations, item response time,
  prompt-to-response latencies, process-event durations, and agent-call latency.
- Every understanding, engagement, misconception, evidence-sufficiency, and
  interpretation field in the research variable registry.
- Every LLM-derived substantive output field exported through
  `agent_activity_records`, `sessions`, `item_responses`, or
  `assessment_summary`.
- Every account, PII, credential, hash, authentication, worker-lock, raw-provider,
  raw-prompt, and internal database identifier field listed in the internal
  schema inventory.
- Every restricted answer-key or teacher diagnostic context field exported only
  through restricted research mode.
- At least 20 process-event definitions, including item presentation, option
  selection, answer changes, reasoning submission, confidence selection,
  tempting-option submission, package submission, typing summaries, session
  lifecycle events, page visibility events, agent workflow events, formative
  activity events, and follow-up/revision events.

## Corrections Made

- Split process-event enum values out of the research-variable registry and
  documented them in `process_event_codebook.csv`.
- Split Prisma/source-schema fields out of the research-variable registry and
  documented non-export source fields in the internal schema appendix.
- Moved account PII, credentials, hashes, auth fields, internal database IDs,
  raw prompt/provider fields, worker/storage internals, and external URLs into
  the platform administration/excluded inventory.
- Replaced generated placeholder definitions and methods with source-grounded
  definitions based on row grain, triggering workflow, source nature, timing
  construct, and interpretation boundary.
- Added `qualified_name`, `dataset_name`, `measurement_level`, `source_nature`,
  `audience`, `privacy_level`, and `export_policy`.
- Clarified null, zero, false, and not-applicable semantics separately.
- Classified timing and latency variables as timing data regardless of source
  table and documented start event, end event, formula, idle handling, and
  page-hidden handling.
- Added pseudonymous `research_student_id` and deprecated the legacy
  `student_id` and `student_public_id` research-export aliases as pseudonymous
  compatibility columns.
- Replaced the ordinary research-export pseudonymization path with
  versioned keyed HMAC-SHA-256 using `RESEARCH_PSEUDONYMIZATION_KEY`, and
  added row-level pseudonymization provenance fields:
  `research_pseudonym_version`, `pseudonymization_method`,
  `pseudonymization_version`, and `pseudonymization_key_fingerprint`.
- Updated default analysis-ready export contents to include
  `research_data_dictionary.csv` and `process_event_codebook.csv`, while
  excluding the internal schema appendix and excluded-variable inventory.
- Added `source_code_reference`, `source_service_or_function`,
  `semantic_review_status`, and `semantic_review_notes` to research variables
  and process-event codebook rows.
- Corrected known category/source-nature errors for item response fields,
  pseudonymous identifiers, correctness and guessing-risk fields, conversation
  message text, and LLM/effective-system interpretation fields.
- Repaired timing formulas so exported timing definitions reference exported
  variables or documented event/payload names, not hidden implementation fields
  such as `item_started_at`.
- Made process-event codebook rows event-specific enough to remove unresolved
  `named step` / `named workflow` language while retaining source-code
  verification status.
- Marked `assessment_summary.csv` as a derived convenience view over canonical
  session-level data and documented `agent_activity_records.csv` as a
  record-type union requiring `record_type`.
- Corrected `agent_activity_records` applicability from the actual
  `agentAndActivityRows()` serializer branches: `agent_call`,
  `profile_result`, `formative_decision`, `activity_attempt`, `workflow_job`,
  `formative_activity`, `post_activity_evidence`, and
  `diagnostic_snapshot`.
- Corrected token lineage so provider-returned call token counts are
  `provider_reported_usage_metadata`, session-level token totals are
  `aggregate_derived`, and token-limit configuration remains internal
  usage/audit metadata rather than a credential.

## Unresolved Questions

- Every row is source-code verified, but domain-owner review remains pending.
  Do not treat `source_verified` as substantive domain approval.
- The pseudonymous `research_student_id` is stable for export joins only when
  the same pseudonymization version, canonical operational user identifier,
  and HMAC key are used. Changing the key changes pseudonyms. A separate
  restricted linkage-file workflow remains intentionally unimplemented.
- Some source-schema mappings are approximate because one internal Prisma field
  can feed multiple flattened research variables. The appendix flags these as
  lineage aids, not ordinary research variables.
- Timing semantics depend on available browser/process instrumentation. Missing
  timing still requires analysts to consult limitation and availability fields.

## Acceptance Notes

The rebuilt dictionary is suitable for ordinary teacher/research export review
because it separates research variables from event codes, source-schema fields,
and excluded/platform fields; documents measurement level and timing constructs;
uses a pseudonymous student join key; and blocks known privacy/export
contradictions in smoke tests.
