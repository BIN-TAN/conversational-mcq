# Engagement Profiling Design

## Scope

Engagement evidence v1 is an internal evidence-packet foundation for future engagement profiling. It does not create a final engagement profile, does not call an LLM, does not label misconduct, and does not change student-facing UI.

The current output is `EngagementEvidencePacketV1` with schema version:

```text
engagement-evidence-packet-v1
```

The packet is provisional. It supports design review and later profile work, but it is not classroom validation and must not be described as a stable trait, motivation diagnosis, GenAI-use finding, or misconduct finding.

## Evidence Sources

The packet is built from existing platform records:

- `response_packages`: source response package trace and included item set.
- `item_responses`: response presence, timing, revision count, selected option marker, and reasoning length band.
- `process_events`: visibility, focus, paste, typing summary, pause, repair, invalid-response, and uncertainty markers.
- `concept_unit_sessions`, `assessment_sessions`, and `users`: public session, concept, assessment, and `user_id` linkage.

The packet does not read summative outcomes, teacher private notes, credentials, cookies, hidden prompts, raw provider output, raw prompts, or environment variables.

## Process Data Inventory

Phase 27b recognizes these process event types as engagement evidence inputs:

```text
page_visibility_hidden
page_visibility_visible
window_blur
window_focus
paste_detected
typing_activity_summary
long_pause
inactivity_detected
answer_changed
reasoning_revised
response_quality_rejected
repeated_invalid_response
missing_evidence_repair_prompted
insufficient_knowledge_marked
idk_selected
```

Older `page_hidden` and `page_visible` events remain readable for compatibility. New browser instrumentation logs only safe aggregates:

- paste detection stores target kind, clipboard type count, and pasted-text length band, not pasted content;
- typing activity stores key counts and duration, not typed text;
- focus and visibility events store timing context only.

## Engagement Categories

Each item receives one provisional `engagement_signal`:

```text
engaged
moderately_engaged
disengaged
insufficient_process_evidence
```

Rules are conservative:

- meaningful reasoning length, revisions, or sustained interaction can support `engaged`;
- sparse but present evidence remains `moderately_engaged`;
- extremely rapid sparse response can support `disengaged`;
- missing responses or missing instrumentation can remain `insufficient_process_evidence`.

These categories describe participation evidence in the session. They are not ability categories and do not directly change the ability evidence packet.

## AI Assistance Signal Policy

The packet may record one contextual `ai_assistance_signal`:

```text
none_indicated
possible_external_assistance_or_reference
likely_external_assistance_pattern
insufficient_evidence
```

This signal is not a cheating label and is not a GenAI-use claim. It is a contextual evidence flag based on process patterns such as paste plus focus loss. It requires human interpretation before any stronger operational use.

The system must never state that a student cheated, used GenAI, or committed misconduct based on this packet.

## Redaction Policy

The review artifact contains only bands, counts, public IDs, safe labels, and interpretation cautions. It omits:

- raw reasoning;
- raw process-event payloads;
- raw conversation turns;
- item stems;
- answer keys;
- correct options;
- distractor metadata;
- raw LLM output;
- provider metadata;
- secrets.

Generated review artifacts are ignored under:

```text
.data/engagement-evidence-review/
```

## Review Commands

Run the no-live smoke:

```bash
npm run student:engagement-evidence-smoke
```

Run the review command:

```bash
npm run student:engagement-evidence-review
```

By default, the review command creates a temporary deterministic fixed-MVP sample session, adds synthetic safe process context, builds an engagement evidence packet, writes a redacted engagement artifact and process-data inventory artifact, and then removes the temporary session.

To review an existing completed package, pass:

```bash
npm run student:engagement-evidence-review -- --session-public-id <session_public_id>
```

## Rule-Based Versus LLM-Based Boundary

Phase 27b is rule-based only. It provides:

- deterministic engagement evidence construction;
- redacted review artifacts;
- process-data inventory;
- safe frontend process instrumentation.

A future LLM may help interpret engagement evidence, but any LLM output must remain schema-validated, audited, and constrained by the same no-misconduct and no-answer-key boundaries.

## Limitations

- Browser typing summaries are aggregate-only and may be absent for server-side smoke sessions.
- Paste detection does not inspect or store clipboard content.
- Process signals can be ambiguous and must not be overinterpreted.
- Engagement evidence is not direct ability evidence.
- The v1 AI-assistance signal is provisional and requires researcher/teacher review before stronger claims.
