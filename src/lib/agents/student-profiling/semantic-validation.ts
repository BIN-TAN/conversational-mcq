import type { AgentInputByName, AgentOutputByName } from "@/lib/agents/contracts";

type StudentProfileOutput = AgentOutputByName["student_profiling_agent"];

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
      indicator.rationale ?? ""
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

export function validateStudentProfileOutputSemantics(input: {
  providerInput?: AgentInputByName["student_profiling_agent"];
  output: StudentProfileOutput;
}) {
  const issues: string[] = [];
  const warnings: string[] = [];
  const output = input.output;
  const evidenceText = textEvidence(output);

  if (!noClearPatternIsExclusive(output.ability_pattern_flags)) {
    issues.push("ability_pattern_flags must not combine no_clear_pattern with specific flags.");
  }

  if (!noClearPatternIsExclusive(output.engagement_pattern_flags)) {
    issues.push("engagement_pattern_flags must not combine no_clear_pattern with specific flags.");
  }

  const conflictLanguagePresent = hasPattern(evidenceText, [
    /\bconflict(?:ing|ed)?\b/i,
    /\bmixed evidence\b/i,
    /\bcontradict(?:ory|ion|s)?\b/i,
    /\bpoint in different directions\b/i,
    /\bdivergent evidence\b/i
  ]);

  if (
    conflictLanguagePresent &&
    output.integrated_diagnostic_profile !== "conflicting_evidence_needs_clarification"
  ) {
    issues.push(
      "Conflicting evidence should use integrated_diagnostic_profile=conflicting_evidence_needs_clarification unless a stronger supported explanation is explicit."
    );
  }

  if (
    conflictLanguagePresent &&
    output.integrated_diagnostic_profile === "correct_but_independence_uncertain"
  ) {
    issues.push(
      "correct_but_independence_uncertain must not be used as a generic label for conflicting cognitive evidence."
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
    warnings
  };
}
