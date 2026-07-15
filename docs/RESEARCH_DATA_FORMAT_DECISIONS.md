# Research Data Format Decisions

Status: source-code aligned, domain-owner review pending.

This document separates core research data from supplementary and technical
documentation. It is not a claim that every stored platform field is appropriate
for ordinary analysis.

## Documentation Tiers

| Tier | Definition | Default visibility |
|---|---|---|
| `core_research` | Variables directly needed to describe the assessment, analyze student responses and processes, evaluate formative activity, examine revisions or transfer, or reproduce principal study analyses. | Default Data dictionary view |
| `supplementary_research` | Variables that support sensitivity analysis, system-performance analysis, advanced process analysis, model-usage analysis, or troubleshooting. | Authorized CSV/API documentation, not the ordinary default dictionary browse |
| `technical_documentation` | Internal schema lineage, worker state, serializer internals, raw implementation fields, advanced provider audit information, and developer/operator documentation. | Advanced/operator documentation only |
| `excluded_platform` | PII, authentication, credential, security, account administration, unrestricted raw payloads, and fields intentionally excluded from research exports. | Excluded inventory only |

## Canonical Formats

### Stable scalar data

Stable scalar data with one clear row grain remains tabular CSV.

### Append-only event streams

Append-only event streams use long-format CSV for core analytic event columns.
Variable payloads should move to optional JSONL only when nested values are
safe and intentionally allow-listed.

| Entity / dataset | Row grain | Structural shape | Canonical format | Supplementary format | Core or supplementary | Reason | Privacy restrictions |
|---|---|---|---|---|---|---|---|
| `sessions.csv` | One assessment attempt/session | Stable scalar columns | Tabular CSV | None currently | Core | Attempt status, participation, timing, interpretation, and join fields have a stable session grain. | Uses pseudonymous student IDs; account identifiers excluded. |
| `item_responses.csv` | One item response | Stable scalar columns | Tabular CSV | Restricted columns available only with explicit restricted export confirmation | Core | Response, reasoning, confidence, tempting-option, timing, and diagnostic evidence have a stable item-response grain. | Answer-key and teacher diagnostic fields are restricted. |
| `process_events.csv` | One process event | Long event stream with selected scalar payload fields | Long-format CSV | `process_event_payloads.jsonl` may be added later for allow-listed heterogeneous payloads | Core for selected learning-process fields; full event inventory is supplementary/operational | Append-only process events should not be flattened into an unbounded wide table. | Raw payload JSON, URLs, clipboard text, keystrokes, and secrets are excluded. |
| `conversation_turns.csv` | One visible or logged conversation turn | Stable turn rows | Tabular CSV | Technical turn metadata can be documented separately if needed | Core | Turn ID, actor, timestamp, message text, and sequence are directly useful for review and analysis. | Hidden prompts, raw provider data, and answer keys are excluded. |
| `agent_activity_records.csv` | Heterogeneous agent/activity/workflow record | Union table | Deprecated legacy compatibility CSV | Split logical datasets should be preferred later: `agent_calls.csv`, `diagnostic_snapshots.csv`, `formative_decisions.csv`, `formative_activities.csv`, `activity_attempts.csv`, `activity_evaluations.csv`, `followup_rounds.csv`, `post_activity_evidence.csv` where source entities support them | Supplementary by default, with selected interpretation/activity fields documented as core variables | The current source serializer combines unrelated row grains; keeping it as one ordinary core table would overstate comparability. | Raw prompts, raw provider payloads, hidden schemas, and secrets are excluded. |
| `assessment_content.csv` | One administered item snapshot | Stable scalar item/context columns | Tabular CSV | Restricted answer-key/diagnostic columns only by explicit restricted export | Core context | Assessment and item context are needed to interpret responses. | Correct options and teacher diagnostic notes are restricted. |
| `assessment_summary.csv` | One derived session summary | Derived convenience view | Supplementary compatibility CSV | Can be omitted from a strict core bundle when downstream readers no longer need it | Supplementary | Most fields copy or aggregate canonical `sessions.csv` and other tables; copies should not inflate core variable counts. | Same pseudonymization and restricted-field rules as source tables. |
| `research_data_dictionary.csv` | One documented research variable | Stable documentation rows | Tabular CSV | `core_research_data_dictionary.csv` and `supplementary_research_data_dictionary.csv` views are exposed through the dictionary API | Core plus supplementary documentation | Dictionary rows describe exported variables and should remain machine-readable. | Contains no secrets or raw payloads. |
| `research_category_dictionary.csv` | One research category | Stable documentation rows | Tabular CSV | `research_category_dictionary.json` for application/automation consumers | Core metadata | Shared category registry drives UI guide, validation, and export documentation. | No student data. |
| `process_event_codebook.csv` | One process-event type | Stable codebook rows | Tabular CSV | Core and full codebook views; future `process_event_payloads.jsonl` for variable payload preservation | Core learning-process subset by default; operational events supplementary | Event codes are documentation, not observations. Core subset prevents operational internals from dominating ordinary browsing. | No raw payload values. |
| `duplicate_variable_audit.csv` | One research variable | Stable audit rows | Tabular CSV | None currently | Supplementary documentation | Documents canonical variables, convenience copies, deprecated aliases, and expected consistency checks. | No student data. |
| `internal_schema_appendix.csv` | One internal source-schema field | Technical lineage | Tabular CSV | None currently | Technical documentation | Useful for source lineage and operator audits, not ordinary research analysis. | PII/auth/security fields are documented as excluded, not exported as research data. |
| `excluded_platform_variables.csv` | One excluded platform field | Exclusion inventory | Tabular CSV | None currently | Excluded platform | Documents why fields are excluded from research export. | May name sensitive field categories but must not contain values. |
| `export_manifest.json` | One export bundle | Nested provenance object | Manifest JSON | None currently | Metadata | Bundle-level metadata should not be repeated on every research row. | No secrets, raw database URLs, or raw keys. |
| `file_inventory.csv` | One generated file | Stable scalar rows | Tabular CSV | None currently | Metadata | Enables reproducibility checks for row counts and hashes. | No secrets. |
| `process_event_payloads.jsonl` | One allow-listed payload object | Heterogeneous nested event payload | JSONL when implemented | Redacted long-format CSV remains canonical for core event analysis | Supplementary | Varying payload shapes should be preserved as one JSON object per line rather than flattened into hundreds of mostly empty columns. | Must exclude browser URLs, clipboard text, raw keystrokes, secrets, and unrestricted payloads. |

## Core Research Categories

The authoritative category registry lives in
`src/lib/services/teacher-research-data/dictionary.ts` and generates both the UI
category guide and `research_category_dictionary.csv/json`.

The core categories are:

1. Research identifiers and joins
2. Assessment and item context
3. Session and participation
4. Item responses and metacognitive reports
5. Timing and interaction
6. Conversation and revision process
7. Diagnostic interpretations
8. Formative activity and follow-up
9. Transfer and outcomes
10. Data quality and research provenance

## Duplicate Variable Rules

- Exact duplicate qualified names are invalid.
- Repeated unqualified names can be valid when they are required join keys at
  different row grains.
- `assessment_summary.csv` copies identify their canonical `sessions.csv`
  source and are hidden from default core-variable browsing.
- Deprecated aliases are compatibility fields and are hidden by default.
- Convenience-view copies must document a consistency check when equality is
  expected.

## Export Compatibility

The current standard research dataset keeps legacy file paths for compatibility.
The Data dictionary UI and dictionary API now default to Research dataset
variables and core learning-process event definitions. Technical appendices and
excluded-field inventories are selected through the same dictionary-section
selector, with one contextual CSV download for the selected section.
The heterogeneous `agent_activity_records.csv` table is retained as a
deprecated legacy compatibility view until split logical datasets are promoted.

Domain-owner wording review remains pending.

## Phase 31al Evidence Profile Export Fields

The evidence-integrated package profile is exported through normalized,
readable session/summary columns rather than an unreadable wide item-evidence
table. Current columns include assessment-specific understanding, reasoning
quality, confidence calibration, evidence limitation codes, growth target,
answer-reveal policy, correctness-status reveal policy, next-interaction type,
activity type, routing-policy version, activity-taxonomy version, profile schema
version, and effective evidence package hash.

Detailed item-level evidence remains in the operational teacher/research
session detail and stored JSON artifact. If a later analysis requires item-level
evidence as rows, add a normalized item-evidence dataset with one row per
administered item rather than widening `sessions.csv`.
