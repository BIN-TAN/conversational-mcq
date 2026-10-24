import { PrismaClient, type Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaByDatasource?: Record<string, PrismaClient>;
};

function prismaLogLevels(): Prisma.LogLevel[] {
  return process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];
}

function operationalLiveCanaryDatasourceUrl() {
  if (process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE !== "true") {
    return undefined;
  }

  return process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL?.trim() || undefined;
}

/**
 * Release CMCQ-20261024-09: the connection pool of each server process. When
 * DATABASE_CONNECTION_LIMIT (and optionally DATABASE_POOL_TIMEOUT_SECONDS) is set and the
 * connection string does not already state the parameter, it is added to the string Prisma uses.
 * process.env.DATABASE_URL itself is unchanged and the string is never logged. Unset, Prisma's
 * defaults apply as before. The preparation worker gets its own limit from scripts/start-app.mjs.
 */
export function databaseUrlWithPoolSettings(
  url: string | undefined,
  settings: { connection_limit?: string; pool_timeout_seconds?: string }
): string | undefined {
  if (!url) return undefined;
  const limit = positiveInteger(settings.connection_limit, 100);
  const timeout = positiveInteger(settings.pool_timeout_seconds, 120);
  if (limit === null && timeout === null) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  let changed = false;
  if (limit !== null && !parsed.searchParams.has("connection_limit")) {
    parsed.searchParams.set("connection_limit", String(limit));
    changed = true;
  }
  if (timeout !== null && !parsed.searchParams.has("pool_timeout")) {
    parsed.searchParams.set("pool_timeout", String(timeout));
    changed = true;
  }
  return changed ? parsed.toString() : undefined;
}

function positiveInteger(value: string | undefined, max: number) {
  if (!value?.trim()) return null;
  const number = Number(value.trim());
  return Number.isInteger(number) && number >= 1 && number <= max ? number : null;
}

const datasourceUrl = operationalLiveCanaryDatasourceUrl() ??
  databaseUrlWithPoolSettings(process.env.DATABASE_URL?.trim(), {
    connection_limit: process.env.DATABASE_CONNECTION_LIMIT,
    pool_timeout_seconds: process.env.DATABASE_POOL_TIMEOUT_SECONDS
  });
const cacheKey = datasourceUrl ? `datasource:${datasourceUrl}` : "default";
const cachedPrisma = datasourceUrl
  ? globalForPrisma.prismaByDatasource?.[cacheKey]
  : globalForPrisma.prisma;

export const prisma =
  cachedPrisma ??
  new PrismaClient({
    ...(datasourceUrl
      ? {
          datasources: {
            db: {
              url: datasourceUrl
            }
          }
        }
      : {}),
    log: prismaLogLevels()
  });

if (process.env.NODE_ENV !== "production") {
  if (datasourceUrl) {
    globalForPrisma.prismaByDatasource ??= {};
    globalForPrisma.prismaByDatasource[cacheKey] = prisma;
  } else {
    globalForPrisma.prisma = prisma;
  }
}
