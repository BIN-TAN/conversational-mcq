export const RESPONSE_EVIDENCE_VERSION = "accepted-response-evidence-v2";

// Accepted alternative-choice records are complete replacements. A reset must
// not fall back to an older choice; false with null choice is not an explicit No.
export function acceptedTemptingEvidence(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (!["initial_tempting_option", "transfer_tempting_option", "package_review_tempting_option"].includes(String(payload.source))) return null;
  const text = (key: string) => typeof payload[key] === "string" ? payload[key].trim() || null : null;
  const noTempting = payload.no_tempting_option === true;
  const option = text("tempting_option");
  if (!noTempting && !option && payload.tempting_evidence_reset_reason !== "answer_changed_to_tempting_option") return null;
  return { no_tempting_option: noTempting, tempting_option: noTempting ? null : option,
    tempting_option_reason: noTempting ? null : text("tempting_option_reason") };
}
