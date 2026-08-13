import type { AgentInputByName, AgentOutputByName } from "@/lib/agents/contracts";

type StudentProfilingInput = AgentInputByName["student_profiling_agent"];
type StudentProfileOutput = AgentOutputByName["student_profiling_agent"];
type JsonRecord = Record<string, unknown>;

export const STUDENT_PROFILE_EVIDENCE_CONSISTENCY_VERSION =
  "student-profile-evidence-consistency-v1" as const;

export const studentProfileEvidenceConsistencyValues = [
  "coherent",
  "mixed_resolved",
  "mixed_unresolved",
  "insufficient"
] as const;

export type StudentProfileEvidenceConsistency =
  (typeof studentProfileEvidenceConsistencyValues)[number];

export type StudentProfileEvidenceConsistencyAssessment = {
  version: typeof STUDENT_PROFILE_EVIDENCE_CONSISTENCY_VERSION;
  classification: StudentProfileEvidenceConsistency;
  supporting_evidence_references: string[];
  observable_evidence_dimensions: Array<
    "item_response" | "reasoning" | "confidence" | "process" | "followup"
  >;
  structured_conflict_signals: Array<
    | "mixed_item_correctness"
    | "correctness_reasoning_mismatch"
    | "confidence_reasoning_mismatch"
  >;
  temporal_change_detected: boolean;
  dominant_interpretation_supported: boolean;
  narrative_conflict_language_present: boolean;
};

type GroundedItemEvidence = {
  item_public_id: string;
  correctness: "correct" | "incorrect" | null;
  reasoning_present: boolean;
  confidence_present: boolean;
};

function jsonRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function arrayRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(jsonRecord).filter((entry): entry is JsonRecord => Boolean(entry))
    : [];
}

function stringValue(record: JsonRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedCorrectness(value: unknown): "correct" | "incorrect" | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "correct") {
    return "correct";
  }
  if (normalized === "incorrect") {
    return "incorrect";
  }
  return null;
}

function packageItemEvidence(value: unknown): GroundedItemEvidence[] {
  const responsePackage = jsonRecord(value);
  if (!responsePackage) {
    return [];
  }

  const items = new Map<string, GroundedItemEvidence>();
  const addItem = (record: JsonRecord, nestedResponse?: JsonRecord | null) => {
    const response = nestedResponse ?? record;
    const itemPublicId =
      stringValue(record, "item_public_id") ?? stringValue(response, "item_public_id");
    if (!itemPublicId) {
      return;
    }

    const reasoningText =
      stringValue(response, "reasoning_text") ??
      stringValue(response, "reasoning_text_final") ??
      stringValue(response, "reasoning");
    const confidence =
      stringValue(response, "confidence_rating") ??
      stringValue(response, "confidence_final");
    const existing = items.get(itemPublicId);

    items.set(itemPublicId, {
      item_public_id: itemPublicId,
      correctness:
        normalizedCorrectness(response.correctness) ?? existing?.correctness ?? null,
      reasoning_present: Boolean(reasoningText) || existing?.reasoning_present === true,
      confidence_present: Boolean(confidence) || existing?.confidence_present === true
    });
  };

  for (const item of arrayRecords(responsePackage.item_evidence)) {
    addItem(item, jsonRecord(item.response));
  }

  const payload = jsonRecord(responsePackage.payload);
  for (const item of arrayRecords(payload?.item_responses)) {
    addItem(item);
  }

  return [...items.values()];
}

function packageHasProcessEvidence(value: unknown) {
  const responsePackage = jsonRecord(value);
  if (!responsePackage) {
    return false;
  }

  const payload = jsonRecord(responsePackage.payload);
  return (
    arrayRecords(responsePackage.process_events).length > 0 ||
    arrayRecords(payload?.process_events).length > 0 ||
    Boolean(jsonRecord(responsePackage.process_event_aggregates)) ||
    Boolean(jsonRecord(payload?.process_counts))
  );
}

function textEvidence(output: StudentProfileOutput) {
  return [
    output.integrated_profile_rationale,
    output.reasoning_quality_summary,
    output.engagement_summary,
    output.rationale,
    ...output.process_interpretation_cautions,
    ...output.item_level_evidence.flatMap((item) => [
      item.evidence_summary,
      item.reasoning_quality ?? "",
      item.correctness ?? ""
    ]),
    ...output.misconception_indicators.flatMap((indicator) => [
      indicator.indicator,
      indicator.rationale ?? "",
      ...(indicator.atomic_claims ?? []).map((claim) => claim.claim_text)
    ]),
    ...output.recommended_next_evidence.flatMap((evidence) => [
      evidence.evidence_type,
      evidence.reason
    ])
  ].join(" ");
}

function hasPattern(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function noClearPatternIsExclusive(flags: string[]) {
  return !flags.includes("no_clear_pattern") || flags.length === 1;
}

function correctnessSignature(items: GroundedItemEvidence[]) {
  const counts = {
    correct: 0,
    incorrect: 0,
    unknown: 0
  };

  for (const item of items) {
    counts[item.correctness ?? "unknown"] += 1;
  }

  return `correct:${counts.correct}|incorrect:${counts.incorrect}|unknown:${counts.unknown}`;
}

function hasMixedCorrectness(items: GroundedItemEvidence[]) {
  const values = new Set(
    items
      .map((item) => item.correctness)
      .filter((value): value is "correct" | "incorrect" => value !== null)
  );
  return values.has("correct") && values.has("incorrect");
}

function outputSupportsDominantInterpretation(
  output: StudentProfileOutput,
  groundedItemReferences: Set<string>,
  groundedMisconceptionReferences: Set<string>
) {
  const groundedOutputReferences = output.item_level_evidence
    .map((item) => item.item_public_id)
    .filter(
      (itemPublicId): itemPublicId is string =>
        Boolean(itemPublicId && groundedItemReferences.has(itemPublicId))
    );
  const groundedMisconceptionReference = output.misconception_indicators.some(
    (indicator) =>
      Boolean(
        indicator.evidence_reference &&
          groundedMisconceptionReferences.has(indicator.evidence_reference)
      )
  );

  return (
    output.ability_profile !== "insufficient_evidence" &&
    groundedOutputReferences.length > 0 &&
    (output.ability_pattern_flags.some((flag) =>
      ![
        "no_clear_pattern",
        "correctness_reasoning_mismatch",
        "confidence_reasoning_mismatch"
      ].includes(flag)
    ) ||
      groundedMisconceptionReference)
  );
}

function narrativeConflictLanguagePresent(output: StudentProfileOutput) {
  return hasPattern(textEvidence(output), [
    /\bconflict(?:ing|ed)?\b/i,
    /\bmixed evidence\b/i,
    /\bcontradict(?:ory|ion|s)?\b/i,
    /\bpoint in different directions\b/i,
    /\bdivergent evidence\b/i
  ]);
}

export function assessStudentProfileEvidenceConsistency(input: {
  providerInput?: StudentProfilingInput;
  output: StudentProfileOutput;
}): StudentProfileEvidenceConsistencyAssessment {
  const initialItems = packageItemEvidence(input.providerInput?.initial_response_package);
  const followupItems = packageItemEvidence(input.providerInput?.followup_evidence_package);
  const currentItems = followupItems.length > 0 ? followupItems : initialItems;
  const initialSignature = correctnessSignature(initialItems);
  const followupSignature = correctnessSignature(followupItems);
  const temporalChangeDetected =
    initialItems.length > 0 &&
    followupItems.length > 0 &&
    initialSignature !== followupSignature;
  const structuredConflictSignals: StudentProfileEvidenceConsistencyAssessment["structured_conflict_signals"] =
    [];

  if (hasMixedCorrectness(currentItems)) {
    structuredConflictSignals.push("mixed_item_correctness");
  }
  if (
    input.output.ability_pattern_flags.includes("correctness_reasoning_mismatch") &&
    currentItems.some((item) => item.correctness && item.reasoning_present)
  ) {
    structuredConflictSignals.push("correctness_reasoning_mismatch");
  }
  if (
    input.output.ability_pattern_flags.includes("confidence_reasoning_mismatch") &&
    currentItems.some((item) => item.confidence_present && item.reasoning_present)
  ) {
    structuredConflictSignals.push("confidence_reasoning_mismatch");
  }

  const observableEvidenceDimensions: StudentProfileEvidenceConsistencyAssessment["observable_evidence_dimensions"] =
    [];
  if (currentItems.length > 0) {
    observableEvidenceDimensions.push("item_response");
  }
  if (currentItems.some((item) => item.reasoning_present)) {
    observableEvidenceDimensions.push("reasoning");
  }
  if (currentItems.some((item) => item.confidence_present)) {
    observableEvidenceDimensions.push("confidence");
  }
  if (packageHasProcessEvidence(input.providerInput?.initial_response_package)) {
    observableEvidenceDimensions.push("process");
  }
  if (followupItems.length > 0) {
    observableEvidenceDimensions.push("followup");
  }

  const groundedItemReferences = new Set(
    currentItems.map((item) => item.item_public_id)
  );
  const groundedMisconceptionReferences = new Set([
    ...groundedItemReferences,
    ...(input.providerInput?.allowed_evidence_catalog?.evidence ?? [])
      .filter(
        (evidence) =>
          evidence.source_role === "student" &&
          evidence.evidence_stage === "baseline_assessment" &&
          evidence.eligibility === "student_understanding"
      )
      .map((evidence) => evidence.evidence_id)
  ]);
  const dominantInterpretationSupported = outputSupportsDominantInterpretation(
    input.output,
    groundedItemReferences,
    groundedMisconceptionReferences
  );
  const evidenceInsufficient =
    !input.providerInput ||
    currentItems.length === 0 ||
    input.output.evidence_sufficiency === "insufficient";
  let classification: StudentProfileEvidenceConsistency;

  if (evidenceInsufficient) {
    classification = "insufficient";
  } else if (structuredConflictSignals.length === 0) {
    classification = temporalChangeDetected ? "mixed_resolved" : "coherent";
  } else if (
    input.output.integrated_diagnostic_profile ===
      "conflicting_evidence_needs_clarification" &&
    !dominantInterpretationSupported
  ) {
    classification = "mixed_unresolved";
  } else {
    classification = dominantInterpretationSupported
      ? "mixed_resolved"
      : "mixed_unresolved";
  }

  return {
    version: STUDENT_PROFILE_EVIDENCE_CONSISTENCY_VERSION,
    classification,
    supporting_evidence_references: currentItems.map(
      (item) => item.item_public_id
    ),
    observable_evidence_dimensions: observableEvidenceDimensions,
    structured_conflict_signals: structuredConflictSignals,
    temporal_change_detected: temporalChangeDetected,
    dominant_interpretation_supported: dominantInterpretationSupported,
    narrative_conflict_language_present: narrativeConflictLanguagePresent(
      input.output
    )
  };
}

function validateGroundedItemEvidence(input: {
  providerInput?: StudentProfilingInput;
  output: StudentProfileOutput;
}) {
  const issues: string[] = [];
  if (!input.providerInput) {
    return issues;
  }

  const groundedItems = [
    ...packageItemEvidence(input.providerInput.initial_response_package),
    ...packageItemEvidence(input.providerInput.followup_evidence_package)
  ];
  const groundedById = new Map(
    groundedItems.map((item) => [item.item_public_id, item])
  );

  for (const item of input.output.item_level_evidence) {
    if (!item.item_public_id) {
      continue;
    }

    const grounded = groundedById.get(item.item_public_id);
    if (!grounded) {
      issues.push(
        `item_level_evidence references unprovided item ${item.item_public_id}.`
      );
      continue;
    }

    const outputCorrectness = normalizedCorrectness(item.correctness);
    if (
      outputCorrectness &&
      grounded.correctness &&
      outputCorrectness !== grounded.correctness
    ) {
      issues.push(
        `item_level_evidence correctness for ${item.item_public_id} does not match the response package.`
      );
    }
  }

  return issues;
}

function validateAtomicMisconceptionClaims(input: {
  providerInput?: StudentProfilingInput;
  output: StudentProfileOutput;
}) {
  const issues: string[] = [];
  const canonicalCatalog = input.providerInput?.allowed_evidence_catalog;
  const groundedReferences = canonicalCatalog
    ? new Set(
        canonicalCatalog.evidence
          .filter(
            (evidence) =>
              evidence.source_role === "student" &&
              evidence.evidence_stage === "baseline_assessment" &&
              evidence.eligibility === "student_understanding"
          )
          .map((evidence) => evidence.evidence_id)
      )
    : new Set([
        ...packageItemEvidence(input.providerInput?.initial_response_package),
        ...packageItemEvidence(input.providerInput?.followup_evidence_package)
      ].map((item) => item.item_public_id));
  const seenIndicators = new Set<string>();

  input.output.misconception_indicators.forEach((indicator, indicatorIndex) => {
    const indicatorKey = indicator.indicator.replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
    if (seenIndicators.has(indicatorKey)) {
      issues.push(`misconception_indicators[${indicatorIndex}] duplicates a prior indicator.`);
    }
    seenIndicators.add(indicatorKey);

    if (
      canonicalCatalog &&
      indicator.evidence_reference !== null &&
      !groundedReferences.has(indicator.evidence_reference)
    ) {
      issues.push(
        `misconception_indicators[${indicatorIndex}].evidence_reference must use an eligible canonical baseline evidence_id.`
      );
    }

    const atomicClaims = indicator.atomic_claims;
    if (!atomicClaims || atomicClaims.length === 0) {
      issues.push(
        `misconception_indicators[${indicatorIndex}] requires validated atomic_claims before persistence.`
      );
      return;
    }
    const seenClaims = new Set<string>();
    atomicClaims.forEach((claim, claimIndex) => {
      const claimKey = claim.claim_text.replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
      if (seenClaims.has(claimKey)) {
        issues.push(
          `misconception_indicators[${indicatorIndex}].atomic_claims[${claimIndex}] duplicates a prior atomic claim.`
        );
      }
      seenClaims.add(claimKey);
      if (/^(?:confidence|rationale|evidence reference)\s*:/iu.test(claim.claim_text)) {
        issues.push(
          `misconception_indicators[${indicatorIndex}].atomic_claims[${claimIndex}] contains profile metadata instead of a misconception claim.`
        );
      }
      if (
        input.providerInput &&
        claim.source_evidence_references.some(
          (reference) => !groundedReferences.has(reference)
        )
      ) {
        issues.push(
          `misconception_indicators[${indicatorIndex}].atomic_claims[${claimIndex}] references evidence outside the eligible baseline assessment catalog.`
        );
      }
    });
  });

  return issues;
}

export function validateStudentProfileOutputSemantics(input: {
  providerInput?: StudentProfilingInput;
  output: StudentProfileOutput;
}) {
  const issues: string[] = [];
  const warnings: string[] = [];
  const output = input.output;
  const evidenceText = textEvidence(output);
  const evidenceConsistency = assessStudentProfileEvidenceConsistency(input);

  if (!noClearPatternIsExclusive(output.ability_pattern_flags)) {
    issues.push("ability_pattern_flags must not combine no_clear_pattern with specific flags.");
  }

  if (!noClearPatternIsExclusive(output.engagement_pattern_flags)) {
    issues.push("engagement_pattern_flags must not combine no_clear_pattern with specific flags.");
  }

  issues.push(...validateGroundedItemEvidence(input));
  issues.push(...validateAtomicMisconceptionClaims(input));

  if (evidenceConsistency.narrative_conflict_language_present) {
    warnings.push(
      "Narrative conflict language was detected; only structured, grounded evidence consistency controls terminal validation."
    );
  }

  if (
    output.integrated_diagnostic_profile ===
      "conflicting_evidence_needs_clarification" &&
    input.providerInput &&
    evidenceConsistency.classification !== "mixed_unresolved"
  ) {
    issues.push(
      "conflicting_evidence_needs_clarification requires grounded structured conflict evidence with identifiable supporting references."
    );
  }

  if (
    output.integrated_diagnostic_profile !==
      "conflicting_evidence_needs_clarification" &&
    evidenceConsistency.classification === "mixed_unresolved"
  ) {
    issues.push(
      "Structured mixed evidence requires either a supported dominant interpretation or conflicting_evidence_needs_clarification."
    );
  }

  if (output.ability_pattern_flags.includes("guessing_possible")) {
    const guessingEvidencePresent = hasPattern(evidenceText, [
      /\bguess(?:ed|ing)?\b/i,
      /\brandom(?:ly)?\b/i,
      /\bselected without reasoning\b/i,
      /\blow confidence\b[^.?!]{0,80}\bcorrect\b/i,
      /\bcorrect\b[^.?!]{0,80}\blow confidence\b/i
    ]);

    if (!guessingEvidencePresent) {
      issues.push("guessing_possible requires explicit evidence supporting possible guessing.");
    }
  }

  if (output.ability_pattern_flags.includes("transfer_ready")) {
    const transferEvidencePresent = hasPattern(evidenceText, [
      /\btransfer\b/i,
      /\bapply(?:ing|ied|ication)?\b/i,
      /\bnew context\b/i,
      /\bgeneraliz(?:e|es|ed|ing)\b/i
    ]);
    const robustProfilePresent =
      output.ability_profile === "robust_transfer_ready_understanding" ||
      output.integrated_diagnostic_profile === "robust_understanding_ready_for_transfer";

    if (!transferEvidencePresent && !robustProfilePresent) {
      issues.push("transfer_ready requires explicit transfer evidence or a robust transfer-ready profile.");
    }
  }

  if (
    ["insufficient", "limited"].includes(output.evidence_sufficiency) &&
    hasPattern(evidenceText, [/\b(definitely|proves?|certainly|without a doubt)\b/i])
  ) {
    issues.push("Rationale must not state unsupported causes with certainty when evidence is insufficient or limited.");
  }

  const rationaleText = `${output.integrated_profile_rationale} ${output.rationale}`;
  const rationaleSectionsPresent = [
    /\bobserv(?:ed|ation|ations)\b/i,
    /\binfer(?:ence|red|s)?\b/i,
    /\buncertain(?:ty)?\b/i,
    /\bnext evidence\b|\brecommended next\b/i
  ].filter((pattern) => pattern.test(rationaleText)).length;

  if (rationaleSectionsPresent < 2) {
    warnings.push(
      "Rationale should more clearly distinguish observed evidence, diagnostic inference, uncertainty, and recommended next evidence."
    );
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    evidence_consistency: evidenceConsistency
  };
}
