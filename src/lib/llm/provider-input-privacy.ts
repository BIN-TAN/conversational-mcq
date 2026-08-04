export const PROVIDER_INPUT_IDENTITY_MINIMIZATION_VERSION =
  "provider-input-identity-minimization-v1" as const;

const rawStudentIdentifierKeys = new Set([
  "account_id",
  "display_name",
  "email",
  "login_username",
  "student_account_id",
  "student_db_id",
  "student_id",
  "student_public_id",
  "student_user_id",
  "user_id",
  "username"
]);

export type ProviderInputPrivacyFinding = {
  code: "raw_student_identifier_field";
  path: string;
};

export class ProviderInputPrivacyError extends Error {
  readonly code = "raw_student_identifier_in_provider_payload" as const;
  readonly findings: ProviderInputPrivacyFinding[];

  constructor(findings: ProviderInputPrivacyFinding[]) {
    super(
      `Provider payload contains raw student identifier fields: ${findings
        .map((finding) => finding.path)
        .join(", ")}`
    );
    this.name = "ProviderInputPrivacyError";
    this.findings = findings;
  }
}

export function findRawStudentIdentifierFields(
  value: unknown,
  path = "provider_payload"
): ProviderInputPrivacyFinding[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findRawStudentIdentifierFields(entry, `${path}.${index}`)
    );
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, entry]) => {
    const fieldPath = `${path}.${key}`;
    const ownFindings: ProviderInputPrivacyFinding[] =
      rawStudentIdentifierKeys.has(key.toLowerCase())
        ? [{ code: "raw_student_identifier_field", path: fieldPath }]
        : [];
    return [
      ...ownFindings,
      ...findRawStudentIdentifierFields(entry, fieldPath)
    ];
  });
}

export function assertNoRawStudentIdentifiersInProviderPayload(
  value: unknown
) {
  const findings = findRawStudentIdentifierFields(value);
  if (findings.length > 0) {
    throw new ProviderInputPrivacyError(findings);
  }
}
