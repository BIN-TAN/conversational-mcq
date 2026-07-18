export type StudentPrivacyFinding = {
  path: string;
  rule_code: "forbidden_field" | "internal_label_in_visible_text";
  matched_label: string;
};

const forbiddenFieldNames = new Set([
  "correct_option",
  "correct_option_snapshot",
  "correctness",
  "answer_key",
  "is_correct",
  "scoring_key",
  "distractor_rationales",
  "expected_reasoning_patterns",
  "possible_misconception_indicators",
  "ability_profile",
  "engagement_profile",
  "integrated_diagnostic_profile",
  "misconception_status",
  "profile_confidence",
  "profile_rationale",
  "diagnostic_uncertainty",
  "evidence_sufficiency",
  "independence_interpretability",
  "formative_value",
  "formative_plan",
  "recommended_strategy",
  "readiness_for_revision",
  "readiness_for_transfer",
  "planning_rationale",
  "success_criteria",
  "evidence_to_elicit_next",
  "agent_name",
  "agent_role",
  "agent_call_id",
  "provider_response_id",
  "model_name",
  "prompt_version",
  "schema_version",
  "operational_config_hash",
  "input_context_hash",
  "raw_output",
  "validated_output",
  "fallback_source_version",
  "failure_agent_call_id",
  "stale_profile_used",
  "stale_plan_used",
  "profile_update_failed",
  "planning_update_failed",
  "retry_count",
  "validation_error",
  "internal_limitation"
]);

const visibleTextPatterns: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "internal_profile_enum",
    pattern:
      /\b(?:reasonably_calibrated|overconfident|underconfident|integrated_diagnostic_profile|engagement_profile|ability_profile|misconception_status)\b/iu
  },
  {
    label: "internal_planning_enum",
    pattern:
      /\b(?:readiness_for_revision|readiness_for_transfer|planning_rationale|formative_value|evidence_to_elicit_next)\b/iu
  },
  {
    label: "agent_or_provider_metadata",
    pattern:
      /\b(?:agent_call_id|provider_response_id|operational_config_hash|input_context_hash|prompt_version|schema_version|raw_output|validated_output)\b/iu
  },
  {
    label: "fallback_or_failure_metadata",
    pattern:
      /\b(?:fallback_source_version|failure_agent_call_id|stale_profile_used|stale_plan_used|profile_update_failed|planning_update_failed|retry_count|validation_error|internal_limitation)\b/iu
  }
];

function keyIsForbidden(key: string) {
  const normalized = key.toLowerCase();
  return (
    forbiddenFieldNames.has(normalized) ||
    normalized.endsWith("_db_id") ||
    normalized.endsWith("_schema_version")
  );
}

export function findStudentPayloadPrivacyFindings(
  value: unknown,
  path = "payload"
): StudentPrivacyFinding[] {
  if (typeof value === "string") {
    return findVisibleTextPrivacyFindings(value, path);
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findStudentPayloadPrivacyFindings(entry, `${path}.${index}`)
    );
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    const entryPath = `${path}.${key}`;
    const findings = keyIsForbidden(key)
      ? [{ path: entryPath, rule_code: "forbidden_field" as const, matched_label: key }]
      : [];
    return [...findings, ...findStudentPayloadPrivacyFindings(entry, entryPath)];
  });
}

export function findVisibleTextPrivacyFindings(
  value: string,
  path = "visible_text"
): StudentPrivacyFinding[] {
  return visibleTextPatterns
    .filter(({ pattern }) => pattern.test(value))
    .map(({ label }) => ({
      path,
      rule_code: "internal_label_in_visible_text" as const,
      matched_label: label
    }));
}

export function assertStudentPayloadPrivacy(value: unknown, label: string) {
  const findings = findStudentPayloadPrivacyFindings(value, label);
  if (findings.length > 0) {
    throw new Error(
      `${label} exposed protected fields: ${findings
        .map((finding) => `${finding.path}:${finding.matched_label}`)
        .join(", ")}`
    );
  }
}

export function assertStudentVisibleTextPrivacy(value: string, label: string) {
  const findings = findVisibleTextPrivacyFindings(value, label);
  if (findings.length > 0) {
    throw new Error(
      `${label} exposed internal labels: ${findings
        .map((finding) => `${finding.path}:${finding.matched_label}`)
        .join(", ")}`
    );
  }
}
