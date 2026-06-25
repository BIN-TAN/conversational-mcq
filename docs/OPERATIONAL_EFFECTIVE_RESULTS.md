# Operational Effective Results

Phase 8A adds immutable operational effective-result records. These records separate raw provider audit from the backend result that operational workflow is allowed to consume.

## Table

`operational_agent_effective_results` stores:

- public effective-result ID
- linked `agent_calls` row when a provider call was actually attempted
- agent name
- operational context type and public ID
- invocation key
- effective result and validator versions
- deterministic guard, canonicalization, and fallback versions
- raw output, raw semantic, and raw safety statuses
- effective semantic, safety, and overall statuses
- student-facing and workflow usability flags
- deterministic guard, canonicalization, and fallback application flags
- effective output JSON and effective action JSON
- sanitized warnings
- effective result hash
- creation timestamp

The table is append-only for normal runtime behavior. A uniqueness constraint on `invocation_key + effective_result_version` prevents duplicate successful records for the same logical invocation version.

## Serialization

Teacher review surfaces expose public IDs, safe status fields, version metadata, sanitized warnings, token usage, and estimated cost when available. Student payloads expose none of this metadata and never expose raw provider output, prompt/schema versions, model/provider identity, profile labels, formative-value labels, correctness, answer keys, token usage, cost, or guard internals.

Raw provider payloads remain in the existing `agent_calls` audit layer. No operational effective result stores API keys, Authorization headers, cookies, password hashes, access-code hashes, database URLs, or session secrets.

