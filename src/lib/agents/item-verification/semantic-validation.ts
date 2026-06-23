import type {
  AgentInputByName,
  AgentOutputByName,
  ItemVerificationFinding
} from "@/lib/agents/contracts";

const prohibitedSuggestionPatterns = [
  /\brewrite as\b/i,
  /\breplace with\b/i,
  /\buse this item\b/i,
  /\bchange the answer to\b/i,
  /\badd a new question\b/i,
  /\bsuggested_/i,
  /\bgenerated item\b/i,
  /\brewritten item\b/i,
  /\brecommended replacement\b/i
];

function allFindings(output: AgentOutputByName["item_verification_agent"]) {
  return [
    ...output.set_level_findings,
    ...output.item_results.flatMap((item) => item.findings)
  ];
}

export function validateItemVerificationOutputSemantics(input: {
  providerInput: AgentInputByName["item_verification_agent"];
  output: AgentOutputByName["item_verification_agent"];
}) {
  const itemIds = new Set(input.providerInput.items.map((item) => item.item_public_id));
  const optionLabelsByItem = new Map(
    input.providerInput.items.map((item) => [
      item.item_public_id,
      new Set(item.options.map((option) => option.label))
    ])
  );
  const errors: string[] = [];
  const findings = allFindings(input.output);

  for (const result of input.output.item_results) {
    if (!itemIds.has(result.item_public_id)) {
      errors.push(`Unknown item_result item_public_id ${result.item_public_id}.`);
    }

    for (const finding of result.findings) {
      if (finding.item_public_id === null) {
        errors.push("Item-level findings require item_public_id.");
      } else if (finding.item_public_id !== result.item_public_id) {
        errors.push("Finding item_public_id must match the containing item_result.");
      }
    }
  }

  for (const finding of findings) {
    if (finding.item_public_id !== null && !itemIds.has(finding.item_public_id)) {
      errors.push(`Unknown finding item_public_id ${finding.item_public_id}.`);
    }

    if (finding.option_label !== null) {
      if (finding.item_public_id === null) {
        errors.push("Option-specific findings require item_public_id.");
        continue;
      }

      const labels = optionLabelsByItem.get(finding.item_public_id);

      if (!labels?.has(finding.option_label)) {
        errors.push(`Unknown option label ${finding.option_label}.`);
      }
    }

    if (finding.brief_explanation.length > 600) {
      errors.push("Finding explanation is too long.");
    }

    if (prohibitedSuggestionPatterns.some((pattern) => pattern.test(finding.brief_explanation))) {
      errors.push("Finding explanation contains prohibited rewrite or generation language.");
    }
  }

  if (input.output.verification_status === "verified_no_warnings" && findings.length > 0) {
    errors.push("verified_no_warnings requires no findings.");
  }

  if (input.output.verification_status === "verified_with_warnings" && findings.length === 0) {
    errors.push("verified_with_warnings requires at least one finding.");
  }

  if (
    input.output.verification_status === "unable_to_verify" &&
    !findings.some((finding) => finding.issue_code === "insufficient_information_to_verify")
  ) {
    errors.push("unable_to_verify requires an insufficient_information_to_verify finding.");
  }

  if (findings.length > 0 && !input.output.teacher_review_required) {
    errors.push("Teacher review is required whenever findings exist.");
  }

  for (const result of input.output.item_results) {
    if (result.findings.length > 0 && !result.teacher_review_required) {
      errors.push("Item teacher_review_required must be true whenever item findings exist.");
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function countItemVerificationWarnings(output: AgentOutputByName["item_verification_agent"]) {
  return allFindings(output).length;
}

export function findingHasOnlyAllowedFields(finding: ItemVerificationFinding) {
  return Object.keys(finding).every((key) =>
    ["issue_code", "item_public_id", "location", "option_label", "brief_explanation"].includes(key)
  );
}
