# Engagement Profiling Design

## Scope

Engagement evidence v1 is an internal evidence-packet foundation for future engagement profiling. It does not create a final engagement profile, does not call an LLM, does not label misconduct, and does not change student-facing UI.

Phase 30a reframes this layer as **engagement/evidence-quality context**, not the dissertation's primary profile. The historical `EngagementEvidencePacketV1` name remains for compatibility, but the packet's role is to qualify how reliable, sparse, or interpretable the distractor-linked response evidence is. Engagement does not determine misconception by itself.

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
insufficient_evidence
```

Rules are conservative:

- meaningful reasoning length, revisions, or sustained interaction can support `engaged`;
- sparse but present evidence remains `moderately_engaged`;
- a single weak process signal is not enough to assign `disengaged`;
- multiple weak participation signals together can support `disengaged`;
- missing responses or too little usable process evidence can remain `insufficient_evidence`.

These categories describe participation evidence in the session. They are not ability categories and do not directly change the ability evidence packet.

Under the distractor-informed misconception diagnosis framing, these categories should be used only to qualify diagnostic confidence and evidence sufficiency. They must not be used as student-facing labels, direct ability labels, or direct misconception labels.

## Provisional V1 Thresholds And Decision Trace

Engagement evidence v1 includes an explicit rule configuration:

```text
answer_selection_rapid_ms = 3000
reasoning_response_rapid_ms = 5000
full_item_completion_rapid_ms = 25000
initial_package_ultra_rapid_ms = 8000
initial_package_extreme_rapid_ms = 15000
initial_package_rapid_warning_ms = 30000
package_reasoning_typing_very_low_ms = 8000
package_reasoning_typing_low_ms = 15000
item_reasoning_typing_rapid_ms = 3000
minimal_reasoning_character_threshold = 20
minimal_reasoning_token_threshold = 4
substantive_reasoning_character_threshold = 90
repeated_invalid_response_threshold = 2
disengaged_min_convergent_signal_count = 2
disengaged_min_item_count = 2
likely_ai_min_convergent_signal_count = 2
long_focus_loss_ms = 10000
long_inactivity_ms = 60000
```

These are provisional engineering thresholds, not empirically calibrated psychometric thresholds. They are included in packets and review artifacts so a teacher/researcher can inspect how a category was produced.

The current packet builder receives `item_response_time_ms`, which represents the full item package interval currently available to engagement evidence: answer selection, reasoning, confidence, and tempting-option evidence. The `full_item_completion_rapid_ms` threshold is therefore wider than answer-selection or reasoning-only thresholds. `answer_selection_rapid_ms` and `reasoning_response_rapid_ms` are retained in the config for stage-specific traces when those intervals are supplied by a later packet builder.

The session trace also derives initial three-item package timing from existing item/process timestamps. It records wall-clock package time separately from active package time:

- `package_wall_clock_duration_ms`: first `item_presented` to `package_submitted`; this can include idle time.
- `package_focus_adjusted_task_duration_ms`: first item presented to package submitted, minus safe hidden, blur, pause, or inactivity intervals when such intervals are available.
- `package_sum_item_focus_adjusted_duration_ms`: sum of per-item focus-adjusted task intervals where safe interval data are available.
- `package_response_production_duration_ms`: first student response action to `package_submitted`; this excludes reading time and is supporting evidence when focus-adjusted task time is unavailable.
- `package_reasoning_input_elapsed_time_ms`: aggregate safe item-scoped `typing_activity_summary` duration. The current browser instrumentation measures elapsed time from first keydown in an item text input until the summary is flushed; it is not active keystroke time and can include idle time inside the segment. It never stores raw keystrokes, typed text, or clipboard content.
- `package_reasoning_typing_duration_ms`: backwards-compatible alias for the same elapsed input timing. New diagnostics should treat `package_reasoning_input_elapsed_time_ms` as the clearer name.

Rapid sparse classification prefers timing sources in this order:

```text
focus_adjusted_task
sum_item_focus_adjusted
response_production
wall_clock_fallback
unavailable
```

If active timing is unavailable and only a typical/long wall-clock fallback exists, the packet must not infer rapid completion. It records `active_package_timing_unavailable` as a limitation instead.

The review artifact also includes a safe timing reconstruction for diagnosis. It may include event type, source table, timestamp, duration in milliseconds, timing band, timing source used for the rapid rule, per-item active timing bands, and aggregate reasoning-input elapsed bands. It must not include raw process-event payloads, raw conversation text, browser URLs, typed text, pasted text, answer keys, or item distractor metadata. If a process-event student action is missing, the reconstruction may fall back to `item_response_created` or a student conversation-turn timestamp and must label that fallback in `timing_limitations`.

Typing timing reconstruction is intentionally conservative. Each per-item record can include `field_type`, `typing_duration_band`, `typing_duration_ms`, `typing_event_count`, start/end event labels, `includes_idle_time`, `includes_blur_time`, and timing limitations. In v1, `field_type=item_text_input_elapsed_time` means the frontend scoped the summary to the current item but did not persist a specific input field name. `includes_idle_time=true` means the duration can include pauses between the first keydown and summary flush. Active typing time is unavailable because per-keystroke timestamps are not stored.

Initial package timing bands are:

```text
package_ultra_rapid <= 8000 ms
package_extreme_rapid <= 15000 ms
package_rapid_warning <= 30000 ms
package_typical_or_long > 30000 ms
package_timing_unavailable
```

The `package_typical_or_long` band covers durations above the rapid-warning threshold. The older 60-second rapid band is no longer used for package-level rapid sparse classification.

`initial_package_ultra_rapid_sparse` and `initial_package_extreme_rapid_sparse` can support `disengaged` when the preferred active timing source is at or below the threshold, at least two items have sparse/low-information/uncertainty-without-elaboration or repair/invalid evidence, and no strong substantive reasoning counterevidence exists. `initial_package_rapid_warning_sparse` is weaker: it records rapid-warning timing with weak evidence but only supports `disengaged` when additional weak-engagement signals converge. Rapid timing alone never classifies a session as disengaged.

`very_low_reasoning_typing_sparse` is a supporting rule. It can strengthen a repeated sparse-evidence pattern when aggregate package reasoning typing is at or below `package_reasoning_typing_very_low_ms` or at least two item reasoning summaries are at or below `item_reasoning_typing_rapid_ms`. Reasoning typing time alone never classifies a session as `disengaged`; pasted-response context is recorded as a limitation/context signal rather than direct disengagement evidence.

Each item includes `decision_trace` with matched and non-matched deterministic rules, threshold names and values, duration/length bands, why-not category reasons, and limitations. Each session includes `session_decision_trace` with item category counts, dominant signal counts, package timing bands, sparse/substantive item counts, matched session rules, counterevidence, and why-not category reasons.

Important semantics:

- Rapid response is a time-based signal only. It must state which interval was measured: answer selection time, reasoning response time, or full item package completion time. It does not by itself imply disengagement.
- Minimal reasoning is based on length band and character/token thresholds. A short uncertainty statement such as "I don't know" is uncertainty or knowledge-gap evidence, not invalid engagement evidence.
- Completed initial items are baseline completion context, not strong engagement counterevidence when package-level rapid sparse evidence is present.
- Observed process events indicate data availability and instrumentation context. They are not engagement counterevidence by themselves.
- Meaningful reasoning counterevidence requires task-relevant content, an adequate or usable response-quality signal, or a key idea/action signal. Length alone is not sufficient. Generic low-information text such as "because", repeated placeholders, long irrelevant text, and uncertainty statements such as "I don't know" do not count as meaningful reasoning counterevidence by themselves.
- Invalid pattern means repeated unusable/off-task/irrelevant/low-information responses after repair opportunities. Wrong answers, low confidence, content questions, and procedural questions are not invalid engagement patterns.
- `disengaged` requires convergent signals at item level, repeated item-level disengagement across the session, or conservative active package-level rapid sparse rules.
- `insufficient_evidence` is used when records are missing, too sparse, or too ambiguous.

## AI Assistance Signal Policy

The packet may record one contextual `ai_assistance_signal`:

```text
none_indicated
likely_external_assistance_pattern
insufficient_evidence
```

This signal is behavioral process context only. AI assistance is allowed, and the signal is not a misconduct finding or a confirmed GenAI-use claim. A single weak signal such as one paste event or one focus change remains `insufficient_evidence`; stronger language requires convergent observable signals such as paste plus focus loss or pause context.

The signal should be compared with future student self-report when that feature exists. Phase 27b-refine does not implement self-report collection.

In Phase 30a terminology, AI or external-assistance context is an evidence-reliability context. It may explain why a polished answer needs independent reconstruction or distractor reactivation, but it must not become a cheating, misconduct, provenance, or authenticity claim.

Packet limitations use stable labels:

```text
ai_assistance_signal_is_behavioral_not_misconduct
ai_assistance_signal_should_be_compared_with_self_report
single_weak_signal_is_not_enough
process_data_are_ambiguous
```

The system must never turn this packet into a student accusation or a student-facing profile.

The packet includes `ai_assistance_decision_trace` at item and session level. One focus loss alone or one paste event alone remains `insufficient_evidence`, not `likely_external_assistance_pattern`. `likely_external_assistance_pattern` requires convergent contextual signals. `none_indicated` means no relevant signal pattern was observed; it is not proof that no AI or external assistance was used.

## Possible Interpretation

Each item now includes:

```ts
possible_interpretation: string;
interpretation_source: "deterministic_v1";
```

The interpretation is generated by deterministic templates from structured observable signals. It is a cautious design-review aid, not an LLM-generated judgment and not a category override.

A future LLM may produce an interpretation from redacted structured signals only after a later approval. It must not decide the final category or read raw logs/text unless explicitly approved.

## Redaction Policy

The review artifact contains only bands, counts, public IDs, safe labels, safe timing event metadata, threshold names and values, rule IDs, reason codes, and interpretation cautions. It omits:

- raw reasoning;
- raw process-event payloads;
- raw typed text;
- raw clipboard text;
- raw keystrokes;
- raw browser URLs;
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
- safe frontend process instrumentation;
- deterministic item-level possible interpretations.

A future LLM may help phrase possible interpretations from redacted structured signals, but final categories remain rule-aggregated and traceable. LLM output must remain schema-validated, audited, and constrained by the same no-accusation and no-answer-key boundaries.

## Limitations

- Browser typing summaries are aggregate-only and may be absent for server-side smoke sessions.
- Paste detection does not inspect or store clipboard content.
- Process signals can be ambiguous and must not be overinterpreted.
- Engagement evidence is not direct ability evidence.
- Engagement evidence is not direct misconception evidence.
- Engagement or process labels must not be shown to students.
- The v1 AI-assistance signal is behavioral only and should be compared with student self-report when self-report is implemented.

## Session Data Completeness Audit

Phase 30h exposes engagement evidence availability through a teacher/research
audit projection. The projection reports whether an engagement packet can be
built, the internal-only provisional engagement category, process-data
limitation flags, threshold policy, and event inventory counts.

This is a visibility layer over existing evidence. It does not change the
engagement category, does not add misconduct detection, and does not expose raw
reasoning, raw process-event payloads, raw typed text, clipboard text, answer
keys, correct options, distractor metadata, raw LLM output, provider payloads,
or secrets.

Run:

```bash
npm run student:session-data-completeness-review -- --session-public-id <session_public_id>
```

The teacher session page shows the same aggregate information in **Session
evidence audit**. Process data are evidence-quality context only and should not
be used alone to infer misconception, ability, cheating, or misconduct.
