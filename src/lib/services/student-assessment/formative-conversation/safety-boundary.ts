import type { FormativeConversationAgentInput } from "./agent-contract";

export type FormativeConversationSafetyIssueCode =
  | "administered_item_boundary_mismatch"
  | "duplicate_administered_item"
  | "forbidden_internal_key";

export type FormativeConversationSafetyResult = {
  valid: boolean;
  boundary_version: string;
  issue_codes: FormativeConversationSafetyIssueCode[];
};

export type FormativeConversationSafetyBoundaryValidator = (
  input: FormativeConversationAgentInput
) => FormativeConversationSafetyResult;

const forbiddenInternalKeys = new Set([
  "api_key",
  "authorization",
  "chain_of_thought",
  "cookie",
  "database_url",
  "hidden_prompt",
  "openai_api_key",
  "password_hash",
  "raw_provider_payload",
  "raw_teacher_diagnostic_notes",
  "session_secret",
  "system_prompt"
]);

function collectForbiddenKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectForbiddenKeys(entry, found);
    }
    return found;
  }

  if (!value || typeof value !== "object") {
    return found;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenInternalKeys.has(key.toLowerCase())) {
      found.add(key.toLowerCase());
    }
    collectForbiddenKeys(entry, found);
  }

  return found;
}

export const validateFormativeConversationSafetyBoundary: FormativeConversationSafetyBoundaryValidator = (
  input
) => {
  const issueCodes = new Set<FormativeConversationSafetyIssueCode>();
  const itemIds = input.administered_items.map((item) => item.item_public_id);
  const boundaryIds = input.safety_boundary.administered_item_public_ids;

  if (
    itemIds.length !== boundaryIds.length ||
    itemIds.some((itemId) => !boundaryIds.includes(itemId))
  ) {
    issueCodes.add("administered_item_boundary_mismatch");
  }

  if (new Set(itemIds).size !== itemIds.length) {
    issueCodes.add("duplicate_administered_item");
  }

  if (collectForbiddenKeys(input).size > 0) {
    issueCodes.add("forbidden_internal_key");
  }

  return {
    valid: issueCodes.size === 0,
    boundary_version: input.safety_boundary.boundary_version,
    issue_codes: [...issueCodes].sort()
  };
};
