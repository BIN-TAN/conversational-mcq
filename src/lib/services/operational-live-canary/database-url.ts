export const OPERATIONAL_LIVE_CANARY_DATABASE_SUFFIX = "_live_canary_e2e";

export const DEFAULT_OPERATIONAL_LIVE_CANARY_BASE_DATABASE_URL =
  "postgresql://conversational_mcq:conversational_mcq_dev_password@localhost:5432/conversational_mcq?schema=public";

export class OperationalLiveCanaryDatabaseUrlError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly databaseName?: string
  ) {
    super(message);
    this.name = "OperationalLiveCanaryDatabaseUrlError";
  }
}

export type OperationalLiveCanaryDatabaseResolution = {
  base_database_url: string;
  isolated_canary_database_url: string;
  base_database_name: string;
  effective_canary_database_name: string;
  database_name_was_already_isolated: boolean;
  resolver_idempotency_passed: boolean;
  guard_suffix: string;
  guard_passed: boolean;
};

export function databaseNameFromUrl(databaseUrl: string) {
  return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
}

export function redactedOperationalLiveCanaryDatabaseUrl(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (url.password) {
    url.password = "REDACTED";
  }
  return url.toString();
}

function isCanonicalLiveCanaryDatabaseName(databaseName: string) {
  if (!databaseName.endsWith(OPERATIONAL_LIVE_CANARY_DATABASE_SUFFIX)) {
    return false;
  }

  const prefix = databaseName.slice(0, -OPERATIONAL_LIVE_CANARY_DATABASE_SUFFIX.length);
  return !prefix.includes("_live_canary");
}

function assertNoMalformedLiveCanaryName(databaseName: string) {
  const containsLiveCanaryMarker = databaseName.includes("_live_canary");
  if (!containsLiveCanaryMarker) {
    return;
  }

  if (!isCanonicalLiveCanaryDatabaseName(databaseName)) {
    throw new OperationalLiveCanaryDatabaseUrlError(
      "malformed_live_canary_database_name",
      `Operational live canary database name '${databaseName}' is malformed. It must contain exactly one '${OPERATIONAL_LIVE_CANARY_DATABASE_SUFFIX}' suffix.`,
      databaseName
    );
  }
}

function deriveCanaryDatabaseName(databaseName: string) {
  if (!databaseName.trim()) {
    throw new OperationalLiveCanaryDatabaseUrlError(
      "database_name_empty",
      "Operational live canary database URL must include a database name."
    );
  }

  assertNoMalformedLiveCanaryName(databaseName);

  if (isCanonicalLiveCanaryDatabaseName(databaseName)) {
    return {
      name: databaseName,
      wasAlreadyIsolated: true
    };
  }

  const baseName = databaseName.endsWith("_e2e")
    ? databaseName.slice(0, -"_e2e".length)
    : databaseName;

  if (!baseName.trim()) {
    throw new OperationalLiveCanaryDatabaseUrlError(
      "database_name_empty",
      "Operational live canary database URL must include a non-empty base database name."
    );
  }

  return {
    name: `${baseName}${OPERATIONAL_LIVE_CANARY_DATABASE_SUFFIX}`,
    wasAlreadyIsolated: false
  };
}

export function assertOperationalLiveCanaryDatabaseUrl(databaseUrl: string) {
  const databaseName = databaseNameFromUrl(databaseUrl);
  assertNoMalformedLiveCanaryName(databaseName);

  if (!isCanonicalLiveCanaryDatabaseName(databaseName)) {
    throw new OperationalLiveCanaryDatabaseUrlError(
      "database_suffix_invalid",
      `Operational live canary database '${databaseName}' must end with exactly '${OPERATIONAL_LIVE_CANARY_DATABASE_SUFFIX}'.`,
      databaseName
    );
  }

  if (databaseName === "conversational_mcq" || databaseName === "conversational_mcq_e2e") {
    throw new OperationalLiveCanaryDatabaseUrlError(
      "reserved_database_name",
      `Operational live canary refuses to use reserved database '${databaseName}'.`,
      databaseName
    );
  }
}

export function resolveOperationalLiveCanaryDatabaseUrl(baseUrl: string): OperationalLiveCanaryDatabaseResolution {
  const trimmedBaseUrl = baseUrl.trim();
  if (!trimmedBaseUrl) {
    throw new OperationalLiveCanaryDatabaseUrlError(
      "database_url_empty",
      "Operational live canary database URL cannot be blank."
    );
  }

  const url = new URL(trimmedBaseUrl);
  const baseDatabaseName = databaseNameFromUrl(trimmedBaseUrl);
  const derived = deriveCanaryDatabaseName(baseDatabaseName);
  const idempotencyCheck = deriveCanaryDatabaseName(derived.name);

  url.pathname = `/${derived.name}`;
  const isolatedCanaryDatabaseUrl = url.toString();
  assertOperationalLiveCanaryDatabaseUrl(isolatedCanaryDatabaseUrl);

  return {
    base_database_url: trimmedBaseUrl,
    isolated_canary_database_url: isolatedCanaryDatabaseUrl,
    base_database_name: baseDatabaseName,
    effective_canary_database_name: derived.name,
    database_name_was_already_isolated: derived.wasAlreadyIsolated,
    resolver_idempotency_passed: idempotencyCheck.name === derived.name && idempotencyCheck.wasAlreadyIsolated,
    guard_suffix: OPERATIONAL_LIVE_CANARY_DATABASE_SUFFIX,
    guard_passed: true
  };
}
