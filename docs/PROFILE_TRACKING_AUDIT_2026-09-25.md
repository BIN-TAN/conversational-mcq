# In-Test Profile Tracking Audit

Audit date: September 25, 2026 (America/Edmonton).
Live checks completed on September 26, 2026 UTC.

## Conclusion

The audited records have consistent student-attempt-item and conversation-evidence
links. However, the data must not yet be described as a complete sequence of
validated learning-profile changes. One operational fallback, intermediate profile
artifacts, and export-format mismatches require explicit differentiation.

This was a read-only audit. No student responses, profiles, account settings, or
AI outputs were changed or regenerated. No application changes were pushed or
deployed as part of this audit.

## Scope and Method

- Canonical production service: `conversational-mcq`.
- Deployed application revision inspected:
  `a9c04fb3d3d49df5fac47f3ab5e741f7134b4fd8`.
- Local source revision:
  `a45b03ab4f75d2df41ef1dfbd811af79dc712b0c` (documentation follow-up).
- Bounded SQL queries used read-only, repeatable-read transactions. Successive
  queries were separate snapshots, not one database-wide immutable snapshot.
- Compared stored source responses, profile-agent inputs, response packages,
  profile outputs, canonical evidence identities, conversation receipts, and
  source-turn references. Inspected the corresponding export projection code.
- Reviewed all eight currently recorded atomic misconception claims against
  their cited student-authored evidence. This is a grounding review, not an
  independent psychometric validation or a claim that every possible omitted
  misconception has been identified.
- This report contains no credentials, student names, or verbatim transcripts.

## Record Inventory

| Record | Observed count | Interpretation |
| --- | ---: | --- |
| Assessment attempts | 10 | Includes incomplete initial administrations |
| Completed initial response packages | 8 | One initial package for each completed initial administration |
| Responses in completed initial packages | 38 | All 38 present in the corresponding profiling inputs |
| Stored profile rows | 24 | Three initial-processing artifacts per completed package, not 24 learning checkpoints |
| Latest validated AI baseline profiles | 7 | Cover 35 item-level evidence entries |
| Latest conservative fallback profiles | 1 | Three responses exist, but no validated item-level profile evidence |
| Canonical misconception indicators | 6 | Distributed across five validated baseline profiles |
| Atomic misconception claims | 8 | All cited source references found and student-authored |
| Formative conversations | 8 | Four ended by student, one paused, three active |
| Student formative messages | 33 | Each has a persisted response receipt and assistant reply |
| Opening messages | 8 | Expected to have no preceding student message |
| Validated formative-agent calls | 41 | All returned `continue_conversation` |
| Formative profile evidence references | 14 | Each points to an earlier student turn in the same conversation |
| Formal profile transitions | 0 | No updated profile is present in these conversations |

## Findings

### 1. Research Profile Counts Can Include Intermediate and Fallback Records

Severity: high for research interpretation.

`src/lib/services/teacher-research-data/analysis-ready-export.ts:1594` emits every
stored profile as `record_type=profile_result` and
`authority_status=authoritative_profile_record`. The row projection does not
identify the profile itself or its source agent, processing role, or effective
validation/fallback status.

In this sample, that produces 24 profile-result rows from eight initial
administrations. Sixteen rows are earlier integration/planning artifacts; one of
the eight latest rows is a conservative fallback. These are not repeated
measurements of learning change.

Recommended correction: preserve the artifacts, but distinguish intermediate,
validated baseline, validated update, and fallback roles, with stable profile and
source-call identifiers. Do not delete historical artifacts to fix a projection.

### 2. Misconception Counts Are Incorrect in the Legacy Summary Export

Severity: high for research interpretation.

`src/lib/services/teacher-research-export/service.ts:890` uses
`asArray(profile.misconception_indicators).length`. Current canonical profiles
store an object with an `indicators` array, so this expression produces zero.

The live data contain six canonical indicators across five baseline profiles;
the affected legacy `misconception_diagnosis_or_profile_packets.jsonl` projection
would report zero for those profiles. The raw indicators and their eight atomic
claims remain present. This is a projection/counting defect, not loss of the
underlying evidence.

Recommended correction: normalize supported historical and current formats
before counting; export indicator and atomic-claim counts separately. An
unavailable diagnosis must remain distinguishable from a validated diagnosis
with no detected indicators.

### 3. One System Failure Can Be Presented as a Student Learning Status

Severity: high for research interpretation.

One profiling call failed semantic validation because the proposed conflicting
evidence diagnosis lacked the required grounded references. The service
intentionally persisted a conservative fallback to preserve workflow continuity
(`src/lib/agents/student-profiling/service.ts:640`). It has insufficient evidence,
low confidence, no item-level evidence, and an explicit explanatory rationale.
The three underlying responses are intact and match the profiling input.

However, `studentSafeStatus` in
`src/lib/services/teacher-research-data/analysis-ready-export.ts:930` maps
`insufficient_evidence_for_formative_decision` to `Needs more work`. The export
also labels this fallback as an authoritative profile record. A technical failure
must not be interpreted as evidence of weaker understanding.

Recommended correction: show and export a machine-readable unavailable/fallback
state, its failure reason, and its source. Exclude it from validated learning
outcome counts. Preserve the failed call and original fallback for audit; any
later reanalysis must be separately versioned and must not overwrite history.

The Phase 6B rules in `docs/DATA_MODEL.md:502` also need correction: they currently
say failed or invalid profiling executions never create profile rows, which does
not describe the conservative fallback path.

### 4. Profile Summary Columns Read an Earlier Artifact Format

Severity: moderate for research completeness.

`evidenceProfileV2` in
`src/lib/services/teacher-research-data/analysis-ready-export.ts:889` expects
`item_level_evidence.evidence_integrated_profile_v2` on the latest profile. All
eight latest profiles in this audit instead store `item_level_evidence` as an
array. Earlier planning artifacts retain the object-form field.

Consequently, the existing projection cannot populate such columns as
`reasoning_quality_category`, `confidence_calibration_category`, and
`evidence_profile_schema_version` from these latest profiles. Those blank cells
must not be interpreted as missing student responses. Do not silently relabel an
earlier artifact as the current profile; retain separate sources and versions or
define an explicit supported mapping.

### 5. Longitudinal Profiling Is Not Complete in the Observed Sessions

This is an observed coverage limitation, not evidence of a failed transition
write.

All 41 validated formative outputs proposed `continue_conversation` and no
profile transition. All eight current conversation profile pointers therefore
still equal their initial profile pointers. Four students ended their
conversations themselves; one conversation is paused and three remain active.

The absence of an updated profile is consistent with the saved agent outputs.
It does not prove the student did not learn or still holds every initial
misconception. Existing messages and the 14 evidence references remain usable
as source records, but do not constitute a validated before/after profile pair.

Recommended correction: expose evaluation coverage and an explicit
`not_reassessed` or `reassessment_incomplete` state. Keep per-turn observations,
formal profile transitions, and pause/exit lifecycle events separate. Do not
invent an unchanged or improved final diagnosis when a student exits.

## Checks That Passed

- No profile source call, latest-profile pointer, conversation initial/current
  profile, or evidence-reference link crossed the audited session/conversation
  boundaries.
- All eight profiling inputs matched their assessment, attempt number, and
  session. All 38 item inputs matched stored selected options, reasoning,
  confidence, correctness, answer-key snapshots, and item-version numbers.
- Every completed initial administration had exactly one initial response
  package, with a matching source-package timestamp. Compared answer, reasoning,
  confidence, correctness, and tempting-option fields matched the agent input.
- Seven validated baseline profiles covered all 35 corresponding items once,
  with no foreign or duplicate item references. Output correctness and confidence
  matched the responses. Saved item evidence matched the validated agent output.
- Canonical evidence catalogs had no wrong scope, assessment, concept, or item
  references in the checks performed.
- All eight existing atomic claims had identifiable, eligible student evidence.
  The claim text was substantively traceable to the cited response; this does not
  establish exhaustive detection, calibrated confidence, or post-chat mastery.
- All 14 formative evidence references pointed to earlier student-authored turns
  in the same conversation and validated source calls.
- All 33 student formative turns had receipts and assistant replies. Eight
  additional receipts were legitimate opening messages, not missing responses.

## Limitations and Operational Note

- Export defects above were verified by comparing live record shapes with the
  current projection code. A complete newly downloaded research archive was not
  regenerated in production during this audit.
- Whole-transcript educational re-scoring and a fresh live terminal-transition
  AI test were not performed. No claims of complete misconception detection or
  complete longitudinal learning measurement are made.
- An initial larger read attempt did not complete. During that attempt, the
  service returned HTTP 502 and the SSH connection closed. Render recorded an
  instance failure and recovery approximately one minute later. The cause was
  not established; temporal coincidence does not prove the audit caused it.
  Subsequent checks used small bounded read-only queries and succeeded.
- Post-recovery health reported database reachability and schema readiness. This
  does not retroactively make the abandoned larger check a passing check.
- Application behavior and historical records were left unchanged. This audit
  report is not a deployment record or a claim that the findings are fixed.

## Follow-up Implementation

The subsequent application change adds `profile-record-projection-v1` to teacher
review and both research-export formats. It separates source artifacts, marks
fallback/unverified results unavailable, repairs canonical misconception counts,
preserves per-item judgments in a dedicated table, and adds stable profile joins
and explicit reassessment status. The original audit findings above describe the
pre-fix state and remain unchanged. See `DATA_LOGGING_SPEC.md` for definitions
and `release-records/releases.json` for actual tests, application commit, push,
deployment verification and remaining limitations. Historical AI outputs were
not regenerated; missing reassessments remain missing.
