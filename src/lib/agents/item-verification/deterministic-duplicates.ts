import type {
  AgentInputByName,
  AgentOutputByName,
  ItemVerificationFinding
} from "@/lib/agents/contracts";

type ItemVerificationInput = AgentInputByName["item_verification_agent"];
type ItemVerificationOutput = AgentOutputByName["item_verification_agent"];

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^a-z#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableStringArray(value: string[]) {
  return value.map(normalizeText).filter(Boolean).sort().join("|");
}

function stableRecord(value: Record<string, unknown>) {
  return Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${normalizeText(key)}:${normalizeText(String(entry ?? ""))}`)
    .join("|");
}

function diagnosticSignature(item: ItemVerificationInput["items"][number]) {
  return {
    expected_reasoning_patterns: stableStringArray(item.expected_reasoning_patterns),
    possible_misconception_indicators: stableStringArray(item.possible_misconception_indicators),
    distractor_rationales: stableRecord(item.distractor_rationales),
    correct_option: normalizeText(item.correct_option),
    option_count: item.options.length
  };
}

function signaturesMatch(
  left: ReturnType<typeof diagnosticSignature>,
  right: ReturnType<typeof diagnosticSignature>
) {
  return (
    left.option_count === right.option_count &&
    left.correct_option === right.correct_option &&
    left.expected_reasoning_patterns.length > 0 &&
    left.expected_reasoning_patterns === right.expected_reasoning_patterns &&
    left.possible_misconception_indicators === right.possible_misconception_indicators &&
    left.distractor_rationales === right.distractor_rationales
  );
}

function stemNearDuplicate(left: string, right: string) {
  if (/\bverification\s+item\s+\d+\b/i.test(left) || /\bverification\s+item\s+\d+\b/i.test(right)) {
    return false;
  }

  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);

  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

function duplicateFinding(pairCount: number): ItemVerificationFinding {
  return {
    issue_code: "substantially_duplicate_item",
    item_public_id: null,
    location: "item_set",
    option_label: null,
    brief_explanation:
      pairCount === 1
        ? "Deterministic duplicate safeguard found one pair of items with substantially overlapping evidence targets."
        : `Deterministic duplicate safeguard found ${pairCount} pairs of items with substantially overlapping evidence targets.`
  };
}

export function deterministicDuplicateSignal(input: ItemVerificationInput) {
  const duplicate_pairs: Array<{
    left_item_public_id: string;
    right_item_public_id: string;
    reason: string;
  }> = [];

  for (let leftIndex = 0; leftIndex < input.items.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < input.items.length; rightIndex += 1) {
      const left = input.items[leftIndex];
      const right = input.items[rightIndex];
      const templateOrdinalStem =
        /\bverification\s+item\s+\d+\b/i.test(left.item_stem) ||
        /\bverification\s+item\s+\d+\b/i.test(right.item_stem);
      const leftSignature = diagnosticSignature(left);
      const rightSignature = diagnosticSignature(right);
      const signatureMatch = !templateOrdinalStem && signaturesMatch(leftSignature, rightSignature);
      const stemMatch = stemNearDuplicate(left.item_stem, right.item_stem);

      if (signatureMatch || stemMatch) {
        duplicate_pairs.push({
          left_item_public_id: left.item_public_id,
          right_item_public_id: right.item_public_id,
          reason: signatureMatch
            ? "matching_diagnostic_signature"
            : "near_identical_normalized_stem"
        });
      }
    }
  }

  return {
    duplicate_pair_count: duplicate_pairs.length,
    duplicate_pairs,
    advisory_issue_code: duplicate_pairs.length > 0 ? "substantially_duplicate_item" : null,
    teacher_review_required: duplicate_pairs.length > 0,
    normalizer_version: "deterministic-duplicate-normalizer-v1"
  };
}

function outputHasDuplicateFinding(output: ItemVerificationOutput) {
  return [
    ...output.set_level_findings,
    ...output.item_results.flatMap((item) => item.findings)
  ].some((finding) => finding.issue_code === "substantially_duplicate_item");
}

export function combineItemVerificationWithDeterministicDuplicates(input: {
  providerInput: ItemVerificationInput;
  output: ItemVerificationOutput;
}) {
  const duplicateSignal = deterministicDuplicateSignal(input.providerInput);

  if (
    duplicateSignal.duplicate_pair_count === 0 ||
    outputHasDuplicateFinding(input.output)
  ) {
    return {
      output: input.output,
      deterministic_duplicate_signal: duplicateSignal,
      deterministic_duplicate_applied: false
    };
  }

  const finding = duplicateFinding(duplicateSignal.duplicate_pair_count);

  return {
    output: {
      ...input.output,
      verification_status:
        input.output.verification_status === "unable_to_verify"
          ? "unable_to_verify"
          : "verified_with_warnings",
      output_status:
        input.output.output_status === "blocked" ? "blocked" : "needs_review",
      set_level_findings: [...input.output.set_level_findings, finding],
      teacher_review_required: true
    },
    deterministic_duplicate_signal: duplicateSignal,
    deterministic_duplicate_applied: true
  } satisfies {
    output: ItemVerificationOutput;
    deterministic_duplicate_signal: ReturnType<typeof deterministicDuplicateSignal>;
    deterministic_duplicate_applied: boolean;
  };
}
