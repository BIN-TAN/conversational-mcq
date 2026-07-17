const prohibitedFragments = [
  "password_hash",
  "access_code_hash",
  "session_cookie",
  "authorization_header",
  "authorization",
  "api_key",
  "database_url",
  "session_secret",
  "internal_authentication_token",
  "auth_token",
  "cookie"
];

export class ProhibitedProviderInputError extends Error {
  paths: string[];

  constructor(paths: string[]) {
    super("Provider input contains prohibited secret or authentication fields.");
    this.name = "ProhibitedProviderInputError";
    this.paths = paths;
  }
}

function isProhibitedKey(key: string) {
  const normalized = key.toLowerCase();

  return prohibitedFragments.some((fragment) => normalized.includes(fragment));
}

export function findProhibitedProviderInputPaths(value: unknown, path = "input"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findProhibitedProviderInputPaths(entry, `${path}[${index}]`)
    );
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const paths: string[] = [];

  for (const [key, entry] of Object.entries(value)) {
    const currentPath = `${path}.${key}`;

    if (isProhibitedKey(key)) {
      paths.push(currentPath);
      continue;
    }

    paths.push(...findProhibitedProviderInputPaths(entry, currentPath));
  }

  return paths;
}

export function assertNoProhibitedProviderInput(value: unknown) {
  const paths = findProhibitedProviderInputPaths(value);

  if (paths.length > 0) {
    throw new ProhibitedProviderInputError(paths);
  }
}

export function omitProhibitedProviderInputFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => omitProhibitedProviderInputFields(entry)) as T;
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      isProhibitedKey(key)
        ? []
        : [[key, omitProhibitedProviderInputFields(entry)]]
    )
  ) as T;
}

export function redactForAudit(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactForAudit);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isProhibitedKey(key) ? "[REDACTED]" : redactForAudit(entry)
    ])
  );
}
