# Item Verification Workflow

Phase 7D adds advisory semantic verification to teacher content governance.

## Deterministic Validation

Deterministic structural validation remains authoritative and runs before any Item Verification Agent call. Structural errors block publication and cannot be bypassed.

Checks include required concept-unit metadata, exactly 3 to 4 included active items, unique item order, valid stems, valid options, correct option matching one option label, distractor rationales for incorrect options, expected reasoning patterns, possible misconception indicators, valid JSON structures, included items belonging to the concept unit, and exclusion of archived items from the published set.

If deterministic validation fails, the agent is not called.

## Semantic Verification

When deterministic validation passes, a teacher_researcher may run AI semantic verification from the concept-unit detail page or API:

```text
POST /api/teacher/concept-units/[conceptUnitPublicId]/verify
GET  /api/teacher/concept-units/[conceptUnitPublicId]/verification
POST /api/teacher/concept-units/[conceptUnitPublicId]/verification/[verificationPublicId]/acknowledge
```

The verification result applies only to the exact content fingerprint.

## Content Fingerprint

The fingerprint includes concept-unit title, learning objective, related concept description, version, included item membership, item order, item stems, options, correct options, distractor rationales, expected reasoning patterns, possible misconception indicators, and item versions.

Content-relevant edits, reordering, item membership changes, or item-version changes make previous verification stale. Display-name, release-date, close-date, workflow-mode, and response-collection-mode changes do not satisfy or invalidate verification by themselves.

## Advisory Warnings

Warnings are advisory. They do not automatically change content and do not permanently block publication.

When warnings exist, the teacher may acknowledge them:

```text
These are advisory AI-generated warnings. Review them using your subject-matter judgment. Acknowledging them does not mean the warnings are correct; it confirms that you reviewed them before publishing.
```

Acknowledgement applies only to the verification run and content fingerprint. It becomes stale after content changes.

## Publication Policy

A concept unit may be published when deterministic validation passes and one of these is true:

- current verification has no warnings
- current verification warnings were explicitly acknowledged
- teacher explicitly confirms publication without current AI verification

Publishing without current AI verification requires explicit confirmation:

```text
The deterministic format checks passed, but there is no current AI semantic verification for this exact item-set version. You may still publish based on your own review.
```

AI verification is not mandatory expert validation. Teacher subject-matter judgment remains final.

## Boundaries

Phase 7D does not generate items, rewrite items, apply AI edits, recommend replacement content, move items across concepts, publish automatically, expose findings to students, change student workflows, or change the master analytical CSV schema.

## Verification Commands

```bash
npm run llm:contracts-smoke
npm run agent:item-verification-smoke
npm run content:verification-publish-smoke
npm run item:verification-ui-smoke
npm run agent:item-verification-rename-smoke
```

These commands use synthetic data and mock provider behavior only.
